// Recording from the app: the pickers (one per display), the countdown over the target, the HUD,
// the recorder host, and what happens after the stop: the take becomes the project's, the editor
// opens on it, and `suggest` cuts it in the background.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rmdir, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BrowserWindow, dialog, globalShortcut, screen, session, type Rectangle } from 'electron';
import { PROJECT_FILE, newProjectFile, projectExists, readProjectFile, recoverTake, useTake, writeProjectFile } from '@cuttle/core';
import { focusWindow, recentClaudeFolders, type Devices, type RecorderEvent, type Take } from '@cuttle/recorder';
import type { HudState, PickedTarget, PickerSetup, RecordChoices } from '../shared/ipc';
import { captureSourceFor, hudPosition, hudWarning, monitorAt, recordingFailure, stopOptionsFor, type PickerDisplay, type PickerWindow } from '../shared/recording';
import { COUNTDOWN, HIDDEN, TEST_BACKEND } from './check';
import { bindRequests, send } from './ipc';
import { cutTake } from './media-service';
import { APP_ORIGIN, serveApp, bundlePath } from './protocols';
import { recorderHost, RecordingError } from './recorder-host';
import { loadSettings, updateSettings } from './settings';
import { editorWindowOf, guard, reopenEditor, setEditorStatus, showPill, webPreferences } from './windows';

/** The HUD's window (the HUD and a margin for its shadow): never in the video, and a dead zone for the input log. */
const HUD_SIZE = { width: 380, height: 64 };
/** The recorder host answers a listing in this time, or the picker says it cannot record. */
const LISTING_TIMEOUT_MS = 10_000;

interface Picker {
  window: BrowserWindow;
  display: number;
  setup?: PickerSetup;
}

let pickers: Picker[] = [];
let pickerSession: Electron.Session | undefined;
/** The project folder the next take goes into; undefined: a new project. */
let pickingFor: string | undefined;
/** From the pick until the take is in its project: one recording at a time. */
let busy = false;
/** The pill was shown when "New recording" hid it: it comes back when the pick is cancelled. */
let pillHidden = false;
/** Projects whose take is being finished or cut: they record again once their editor has the cut. */
const finishing = new Set<string>();
/** The running recording until its take is written into the project, for a quit to wait on. */
let writing: Promise<void> | undefined;

const keyOf = (dir: string) => (process.platform === 'win32' ? resolve(dir).toLowerCase() : resolve(dir));

function pickerSessionOnce(): Electron.Session {
  if (pickerSession) return pickerSession;
  const ses = session.fromPartition('picker');
  // Camera and mic previews, for the picker's own pages only (checked by the requesting contents).
  const isPicker = (contents: Electron.WebContents | null) => contents !== null && pickers.some((picker) => !picker.window.isDestroyed() && picker.window.webContents.id === contents.id);
  ses.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'media' && isPicker(contents)));
  ses.setPermissionCheckHandler((contents, permission) => permission === 'media' && isPicker(contents));
  ses.on('will-download', (event) => event.preventDefault());
  serveApp(ses, bundlePath('renderer'));
  pickerSession = ses;
  return ses;
}

/** A frameless, transparent, content-protected window over everything (the taskbar included). */
function overlay(bounds: Rectangle, preload: string, options: Electron.BrowserWindowConstructorOptions = {}): BrowserWindow {
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Cuttle',
    webPreferences: webPreferences(preload, pickerSessionOnce()),
    ...options,
  });
  // Electron fits a new window into the work area; the overlay covers the taskbar's strip too.
  window.setBounds(bounds);
  guard(window.webContents);
  window.setContentProtection(true);
  window.setAlwaysOnTop(true, 'screen-saver');
  return window;
}

/**
 * Electron's displays with the recorder's monitors: the monitor that contains the display's centre
 * (by order with the test backend, whose monitors are its own).
 */
function pickerDisplays(devices: Devices): PickerDisplay[] {
  return screen.getAllDisplays().map((display, order) => {
    const physical = screen.dipToScreenRect(null, display.bounds);
    const centre = screen.dipToScreenPoint({ x: display.bounds.x + display.bounds.width / 2, y: display.bounds.y + display.bounds.height / 2 });
    const monitor = TEST_BACKEND ? devices.monitors[order] : monitorAt(devices.monitors, centre);
    return {
      id: display.id,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      ...(monitor && { monitor: monitor.index }),
      pixels: monitor ? { width: monitor.bounds.width, height: monitor.bounds.height } : { width: physical.width, height: physical.height },
      label: display.label || monitor?.name || `Display ${order + 1}`,
    };
  });
}

/** The recorder's windows on a display, in DIP, front to back; the app's own windows left out. */
function windowsOn(display: PickerDisplay, devices: Devices): PickerWindow[] {
  return devices.windows
    .filter((window) => window.pid !== process.pid && window.monitor === display.monitor)
    .map((window) => ({
      id: window.id,
      title: window.title,
      className: window.className,
      bounds: TEST_BACKEND ? window.bounds : screen.screenToDipRect(null, window.bounds),
      pixels: { width: window.bounds.width, height: window.bounds.height },
    }));
}

/** The bar's choices as saved; the devices only once they are listed and still there. */
async function choicesNow(devices?: Pick<Devices, 'cameras' | 'mics'>): Promise<RecordChoices> {
  const saved = (await loadSettings()).record;
  const claudeFolder = saved.claudeFolder ?? (await recentClaudeFolders(1).catch(() => []))[0]?.cwd;
  const keep = (name: string | undefined, list: string[] | undefined) => (name && (!list || list.includes(name)) ? name : undefined);
  const camera = keep(saved.camera, devices?.cameras);
  const mic = keep(saved.mic, devices?.mics);
  return { stop: saved.stop, ...(camera && { camera }), ...(mic && { mic }), ...(claudeFolder && { claudeFolder }) };
}

const countdownSeconds = async () => COUNTDOWN ?? (await loadSettings()).countdown;

const GB = 1024 ** 3;

/** Free bytes on the drive that holds `folder` (its nearest existing parent); undefined when that cannot be read. */
async function freeBytes(folder: string): Promise<number | undefined> {
  let path = resolve(folder);
  while (!existsSync(path) && resolve(path, '..') !== path) path = resolve(path, '..');
  try {
    const info = await statfs(path);
    return info.bavail * info.bsize;
  } catch {
    return undefined;
  }
}

/**
 * About ten minutes of a take of the largest display, in bytes: the screen at about 0.1 bit per pixel
 * and frame (30 fps), plus a camera and the mic. A warning below it, not a refusal.
 */
function tenMinutes(displays: readonly PickerDisplay[]): number {
  const pixels = Math.max(0, ...displays.map((display) => display.pixels.width * display.pixels.height));
  return ((pixels * 30 * 0.1 + 2_500_000 + 128_000) / 8) * 600;
}

const gigabytes = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} did not answer in ${ms / 1000} s`)), ms))]);
}

/** Why the recorder cannot list the devices, said for people. */
function listingProblem(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ffmpeg/i.test(message) && /ENOENT|not found|cannot find/i.test(message)) return 'Cuttle needs ffmpeg to record. Install it (winget install Gyan.FFmpeg), then press Try again.';
  return `Cuttle cannot record: ${message.split('\n')[0]}`;
}

/**
 * Shows the pickers on every display: a new recording (`projectDir` undefined: a new project in the
 * projects folder) or the next take of an open project. The displays and windows are listed first
 * (fast); the cameras and mics follow (DirectShow takes a moment). Does nothing while one records
 * or picks.
 */
export async function startPicking(projectDir?: string, options: { fromPill?: boolean } = {}): Promise<void> {
  if (busy || recorderHost.recording) return;
  if (projectDir && finishing.has(keyOf(projectDir))) {
    return say('Cuttle is still cutting the last take of this project. Record again once the cut is in the editor.');
  }
  busy = true;
  pillHidden = options.fromPill ?? false;
  pickingFor = projectDir;
  try {
    let devices: Devices;
    let problem: string | undefined;
    try {
      devices = await withTimeout(recorderHost.devices(false), LISTING_TIMEOUT_MS, 'The recorder');
    } catch (error) {
      devices = { monitors: [], windows: [], cameras: [], mics: [] };
      problem = listingProblem(error);
    }
    const displays = pickerDisplays(devices);
    const choices = await choicesNow();
    const free = await freeBytes(projectDir ?? (await loadSettings()).projectsFolder);
    const warning = free !== undefined && free < tenMinutes(displays) ? `Only ${gigabytes(free)} free on this drive: a take longer than a few minutes may not fit.` : undefined;
    const countdown = await countdownSeconds();
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    for (const picker of pickers) if (!picker.window.isDestroyed()) picker.window.destroy();
    pickers = displays.map((display) => openPicker(display, displays, devices, choices, countdown, cursor.id, problem, warning));
    if (!problem) void listMedia();
  } catch (error) {
    endPicking(true);
    say(`Cuttle cannot record: ${(error as Error).message}`);
  }
}

function openPicker(display: PickerDisplay, displays: PickerDisplay[], devices: Devices, choices: RecordChoices, countdown: number, active: number, problem: string | undefined, warning: string | undefined): Picker {
  const window = overlay(display.bounds, 'picker.cjs', { focusable: true });
  const picker: Picker = { window, display: display.id };
  const unknown = display.monitor === undefined ? 'The recorder does not know this display; pick another one.' : undefined;
  picker.setup = {
    display,
    windows: windowsOn(display, devices),
    cameras: [],
    mics: [],
    choices,
    active: display.id === active,
    countdown,
    listingDevices: !problem,
    ...((problem ?? unknown) && { problem: problem ?? unknown }),
    ...(warning && { warning }),
  };
  bindRequests(window.webContents, 'picker', {
    'picker:setup': () => picker.setup,
    'picker:hover': () => activate(display.id),
    'picker:choices': async (next) => {
      await updateSettings((settings) => {
        settings.record = { ...settings.record, ...next, stop: next.stop };
        if (next.camera === undefined) delete settings.record.camera;
        if (next.mic === undefined) delete settings.record.mic;
      });
      for (const other of pickers) {
        if (other.setup) other.setup.choices = next;
        if (other !== picker) send(other.window.webContents, 'picker:choices', next);
      }
    },
    'picker:record': (target) => void beginRecording(target, displays),
    'picker:cancel': () => endPicking(true),
    'picker:retry': () => {
      const project = pickingFor;
      const fromPill = pillHidden;
      endPicking(false);
      busy = false;
      void startPicking(project, { fromPill });
    },
    'picker:claude-folder': async () => {
      const result = await dialog.showOpenDialog(window, { title: 'The folder Claude Code runs in', properties: ['openDirectory'] });
      return result.canceled ? undefined : result.filePaths[0];
    },
  });
  // Alt+F4 or a crashed page ends the pick (else "New recording" would wait for it for good).
  const closed = () => pickers.includes(picker) && endPicking(true);
  window.on('closed', closed);
  window.webContents.on('render-process-gone', closed);
  // A picker closed before its page loaded (Esc at once) rejects the load: nothing to show then.
  void window.loadURL(`${APP_ORIGIN}/picker.html`).then(
    () => {
      if (window.isDestroyed()) return;
      if (!HIDDEN) window.show();
      if (display.id === active) window.focus();
    },
    () => {},
  );
  return picker;
}

/** The cameras and mics for every picker, once DirectShow has listed them. */
async function listMedia(): Promise<void> {
  const listed = pickers;
  let update: Pick<PickerSetup, 'cameras' | 'mics' | 'choices'> & { problem?: string };
  try {
    const devices = await withTimeout(recorderHost.devices(true), LISTING_TIMEOUT_MS, 'The device listing');
    update = { cameras: devices.cameras, mics: devices.mics, choices: await choicesNow(devices) };
  } catch (error) {
    update = { cameras: [], mics: [], choices: await choicesNow({ cameras: [], mics: [] }), problem: listingProblem(error) };
  }
  if (pickers !== listed) return;
  for (const picker of pickers) {
    if (!picker.setup) continue;
    picker.setup = { ...picker.setup, ...update, listingDevices: false, ...(update.problem && { problem: update.problem }) };
    send(picker.window.webContents, 'picker:devices', { cameras: update.cameras, mics: update.mics, choices: update.choices });
    if (update.problem) send(picker.window.webContents, 'picker:open', picker.setup);
  }
}

function activate(display: number): void {
  for (const picker of pickers) {
    if (picker.setup) picker.setup.active = picker.display === display;
    send(picker.window.webContents, 'picker:active', { display });
    if (picker.display === display && !picker.window.isFocused()) picker.window.focus();
  }
}

/** Closes the pickers; a cancelled pick ends the busy state and brings back the pill "New recording" hid. */
function endPicking(cancelled: boolean): void {
  const closing = pickers;
  pickers = [];
  for (const picker of closing) if (!picker.window.isDestroyed()) picker.window.destroy();
  if (!cancelled) return;
  busy = false;
  if (pillHidden) void showPill();
  pillHidden = false;
}

/** The rectangle (DIP) a pick covers. */
function targetRect(target: PickedTarget, display: PickerDisplay, picked: PickerSetup | undefined): Rectangle {
  if (target.kind === 'region') return roundRect(target.rect);
  if (target.kind === 'window') {
    const window = picked?.windows.find((candidate) => candidate.id === target.window);
    if (window) return roundRect(window.bounds);
  }
  return display.bounds;
}

const roundRect = (rect: { x: number; y: number; width: number; height: number }): Rectangle => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  width: Math.max(1, Math.round(rect.width)),
  height: Math.max(1, Math.round(rect.height)),
});

/** The part of `rect` inside `area` (the countdown stays clear of the taskbar). */
function inside(rect: Rectangle, area: Rectangle): Rectangle {
  const x = Math.max(rect.x, area.x);
  const y = Math.max(rect.y, area.y);
  return { x, y, width: Math.max(1, Math.min(rect.x + rect.width, area.x + area.width) - x), height: Math.max(1, Math.min(rect.y + rect.height, area.y + area.height) - y) };
}

/** A new project's folder in the projects folder: the local date and time (no colons on Windows), "(2)" … when it is taken. */
async function newProjectDir(): Promise<string> {
  const { projectsFolder } = await loadSettings();
  await mkdir(projectsFolder, { recursive: true });
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}.${two(now.getMinutes())}.${two(now.getSeconds())}`;
  for (let n = 1; ; n++) {
    const dir = join(projectsFolder, n === 1 ? stamp : `${stamp} (${n})`);
    try {
      await mkdir(dir);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** Removes a new project's folder that a cancelled or failed start left empty. */
async function removeIfEmpty(dir: string): Promise<void> {
  if ((await readdir(dir).catch(() => ['?'])).length === 0) await rmdir(dir).catch(() => {});
}

/** The take folder number a project uses now (`takes/<n>/screen.mp4`), if any. */
function currentTake(raw: Record<string, unknown>): string | undefined {
  const screen = (raw.sources as { screen?: unknown } | undefined)?.screen;
  const match = typeof screen === 'string' ? /^takes\/(\d+)\//.exec(screen.replaceAll('\\', '/')) : null;
  return match?.[1];
}

/**
 * Stops a recording for the app to quit, and waits until its take is written into its project
 * (the cut is left for the next open). Resolves at once when nothing records.
 */
export function stopForQuit(): Promise<void> {
  if (!writing) return Promise.resolve();
  recorderHost.stop();
  return writing;
}

/** Whether a recording runs (or is being written): a quit waits for it. */
export const recordingRuns = () => writing !== undefined;

async function beginRecording(target: PickedTarget, displays: PickerDisplay[]): Promise<void> {
  const display = displays.find((candidate) => candidate.id === target.display);
  const picked = pickers.find((picker) => picker.display === target.display)?.setup;
  const choices = picked?.choices ?? { stop: 'none' as const };
  const blocked = picked?.problem;
  endPicking(false);
  // The picked window gets the focus back now, while Cuttle still has it to hand on.
  if (target.kind === 'window' && !TEST_BACKEND) void focusWindow(target.window).catch(() => false);
  let finished: () => void = () => {};
  writing = new Promise<void>((done) => (finished = done));
  try {
    if (!display || blocked) {
      if (blocked) say(blocked);
      return;
    }
    await record(target, display, displays, picked, choices);
  } catch (error) {
    say(`Cuttle cannot record: ${(error as Error).message}`);
  } finally {
    writing = undefined;
    finished();
    busy = false;
    pillHidden = false;
  }
}

async function record(target: PickedTarget, display: PickerDisplay, displays: PickerDisplay[], picked: PickerSetup | undefined, choices: RecordChoices): Promise<void> {
  const source = captureSourceFor(target, display);
  const created = !pickingFor;
  const projectDir = pickingFor ?? (await newProjectDir());
  const project = keyOf(projectDir);
  // The project's editor is not in its own take: hidden (its player paused) while it records again, shown after.
  const editor = pickingFor ? await editorWindowOf(pickingFor) : undefined;
  if (editor) {
    await setEditorStatus(projectDir, { text: 'Recording a new take…', state: 'recording' });
    editor.hide();
  }
  const showEditor = async () => {
    if (!editor || editor.isDestroyed()) return;
    await setEditorStatus(projectDir, undefined);
    if (!HIDDEN) editor.show();
  };
  const giveUp = async () => {
    await showEditor();
    if (created) await removeIfEmpty(projectDir);
  };
  finishing.add(project);
  let cutting = false;
  try {
    // The edit of the take the project uses now stays restorable ("Back to take n").
    if (projectExists(projectDir)) {
      const file = await readProjectFile(projectDir).catch(() => undefined);
      const take = file && currentTake(file.raw);
      if (take && existsSync(join(projectDir, 'takes', take))) await copyFile(join(projectDir, PROJECT_FILE), join(projectDir, 'takes', take, PROJECT_FILE)).catch(() => {});
    }

    const area = targetRect(target, display, picked);
    const countdown = overlay(inside(area, display.workArea), 'countdown.cjs', { focusable: false });
    countdown.setIgnoreMouseEvents(true);
    // Without a countdown (0 s) it closes before its page loaded, which rejects the load.
    void countdown.loadURL(`${APP_ORIGIN}/countdown.html`).then(
      () => !HIDDEN && !countdown.isDestroyed() && countdown.showInactive(),
      () => {},
    );
    const hud = overlay({ ...hudPosition(displays, display.id, area, HUD_SIZE), ...HUD_SIZE }, 'hud.cjs', { focusable: false, movable: true });
    const hudState: HudState = { phase: 'countdown', markers: 0 };
    const showHud = () => send(hud.webContents, 'hud:state', { ...hudState });
    const note = (message: string, detail: string, tone: HudState['tone']) => {
      hudState.message = message;
      hudState.detail = detail;
      hudState.tone = tone;
      showHud();
    };
    bindRequests(hud.webContents, 'hud', {
      'hud:stop': () => {
        hudState.phase = 'stopping';
        note('Stopping…', 'Writing the take', 'info');
        recorderHost.stop();
      },
      'hud:marker': () => recorderHost.marker(),
    });
    bindRequests(countdown.webContents, 'countdown', {});
    const deadZone = () => screen.dipToScreenRect(null, hud.getBounds());
    hud.on('moved', () => recorderHost.setDeadZones([deadZone()]));
    // Windows ends the session (sign out, shut down): the take is stopped and kept.
    hud.on('session-end', () => recorderHost.stop());
    void hud.loadURL(`${APP_ORIGIN}/hud.html`).catch(() => {});
    const cancelKey = 'Escape';
    globalShortcut.register(cancelKey, () => recorderHost.stop());
    const closeOverlays = () => {
      if (globalShortcut.isRegistered(cancelKey)) globalShortcut.unregister(cancelKey);
      if (!countdown.isDestroyed()) countdown.destroy();
    };

    // While it records: a warning when the drive fills up, or when a recorded window moves (its area
    // stays where it was picked).
    let takeDir: string | undefined;
    let watch: ReturnType<typeof setInterval> | undefined;
    let lastSpaceCheck = 0;
    const pickedWindow = target.kind === 'window' ? picked?.windows.find((candidate) => candidate.id === target.window) : undefined;
    /** Whether a window's physical bounds left where it was picked (DIP bounds converted back). */
    const moved = (bounds: { x: number; y: number }) => {
      if (!pickedWindow) return false;
      const origin = TEST_BACKEND ? pickedWindow.bounds : screen.dipToScreenRect(null, roundRect(pickedWindow.bounds));
      return Math.abs(bounds.x - origin.x) > 2 || Math.abs(bounds.y - origin.y) > 2;
    };
    const watchTake = async () => {
      if (hudState.phase !== 'recording') return;
      if (Date.now() - lastSpaceCheck > 30_000) {
        lastSpaceCheck = Date.now();
        const left = await freeBytes(projectDir);
        if (left !== undefined && left < 2 * GB && hudState.message === undefined) note(`Disk almost full: ${gigabytes(left)}`, `Only ${gigabytes(left)} free on the drive of ${projectDir}.`, 'warn');
      }
      if (pickedWindow && hudState.message === undefined) {
        const now = (await recorderHost.devices(false).catch(() => undefined))?.windows.find((window) => window.id === pickedWindow.id);
        const before = pickedWindow.pixels;
        if (now && (now.bounds.width !== before.width || now.bounds.height !== before.height || moved(now.bounds))) {
          note('The window moved', 'The window moved or changed size: the area where it was picked is still recorded.', 'warn');
        }
      }
    };

    const onEvent = (event: RecorderEvent) => {
      switch (event.type) {
        case 'countdown':
          send(countdown.webContents, 'countdown:tick', { seconds: event.seconds });
          return;
        case 'recording':
          closeOverlays();
          takeDir = event.dir;
          hudState.phase = 'recording';
          hudState.startedAt = Date.now();
          if (!HIDDEN) hud.showInactive();
          showHud();
          watch = setInterval(() => void watchTake(), 2000);
          return;
        case 'marker':
          hudState.markers++;
          showHud();
          return;
        case 'warning': {
          const warning = hudWarning(event.message);
          note(warning.text, warning.detail, 'warn');
          return;
        }
        case 'stopping':
          hudState.phase = 'stopping';
          note('Stopping…', 'Writing the take', 'info');
          return;
      }
    };

    // The picker's camera preview lets go of the camera a moment after the picker closed.
    const countdownFor = await countdownSeconds();
    if (choices.camera && countdownFor < 1) await new Promise((resolve) => setTimeout(resolve, 600));
    let take: Take;
    try {
      take = await recorderHost.record(
        {
          projectDir,
          source,
          ...(choices.camera && { webcam: choices.camera }),
          ...(choices.mic && { mic: choices.mic }),
          stop: stopOptionsFor(choices),
          countdownSeconds: countdownFor,
          deadZones: [deadZone()],
        },
        onEvent,
      );
    } catch (error) {
      clearInterval(watch);
      closeOverlays();
      if (!hud.isDestroyed()) hud.destroy();
      if (error instanceof RecordingError && error.code === 'cancelled') return await giveUp();
      // A take that had started is kept: repaired with recover, then opened like any other.
      if (takeDir) {
        cutting = await recoverAndOpen(projectDir, takeDir, (error as Error).message, showEditor);
        return;
      }
      await giveUp();
      const failure = recordingFailure((error as Error).message);
      return say(`The recording could not start. ${failure.text}`, failure.detail);
    }
    clearInterval(watch);
    closeOverlays();
    if (!hud.isDestroyed()) hud.destroy();
    cutting = await finishTake(projectDir, take, showEditor);
  } finally {
    if (!cutting) finishing.delete(project);
  }
}

/**
 * A take that ended badly (the capture failed after it started): `recover` repairs it and points the
 * project at it, and it is cut like any other. Returns whether the cut started.
 */
async function recoverAndOpen(projectDir: string, takeDir: string, why: string, showEditor: () => Promise<void>): Promise<boolean> {
  const dir = resolve(projectDir);
  const failure = recordingFailure(why);
  try {
    const result = await recoverTake(dir, takeDir);
    say(`The recording stopped early. ${failure.text} Cuttle kept the ${Math.round(result.seconds)} s it had and opened it.`, [failure.detail, ...result.repaired].join('\n'));
  } catch (error) {
    await showEditor();
    say(`The recording stopped early. ${failure.text} Its take in ${takeDir} could not be recovered: ${(error as Error).message.split('\n')[0]}`, failure.detail);
    return false;
  }
  void cutAndShow(dir);
  return true;
}

/** The take becomes the project's (its previous version kept as a backup), the editor opens on it, and `suggest` cuts it. Returns whether the cut started. */
async function finishTake(projectDir: string, take: Take, showEditor: () => Promise<void>): Promise<boolean> {
  try {
    const file = projectExists(projectDir) ? await readProjectFile(projectDir) : newProjectFile(projectDir);
    const hadEdit = useTake(file, take);
    await writeProjectFile(file, 'record', { backup: hadEdit });
  } catch (error) {
    await showEditor();
    say(`The take is saved in ${take.dir}, but cuttle.json could not be pointed at it: ${(error as Error).message.split('\n')[0]}. Run "cuttle recover ${take.dir}".`);
    return false;
  }
  void cutAndShow(resolve(projectDir));
  return true;
}

/** Opens the editor on the take at once, and reloads it once `suggest` has cut it in the background. */
async function cutAndShow(dir: string): Promise<void> {
  finishing.add(keyOf(dir));
  try {
    await reopenEditor(dir);
    await cut(dir);
  } finally {
    finishing.delete(keyOf(dir));
  }
}

/** Cuts the project's take with `suggest`; the editor says so, and says when it could not (with Try again). */
async function cut(dir: string): Promise<void> {
  await setEditorStatus(dir, { text: 'Cutting the take…', state: 'working' });
  try {
    await cutTake(dir);
  } catch (error) {
    await setEditorStatus(dir, { text: `The take could not be cut: ${(error as Error).message.split('\n')[0]}`, state: 'failed' });
    return;
  }
  await setEditorStatus(dir, undefined);
  // Only an editor still open takes the cut: one closed meanwhile is not opened again.
  if (await editorWindowOf(dir)) await reopenEditor(dir, { reload: true });
}

/** "Try again" in the editor after a failed cut. */
export async function recut(dir: string): Promise<void> {
  if (finishing.has(keyOf(dir))) return;
  finishing.add(keyOf(dir));
  try {
    await cut(dir);
  } finally {
    finishing.delete(keyOf(dir));
  }
}

/** Says something to the person in a dialog (a log line in the check), with the details apart. */
function say(message: string, detail?: string): void {
  if (HIDDEN) {
    console.error(detail ? `${message}\n${detail}` : message);
    return;
  }
  void dialog.showMessageBox({ type: 'warning', title: 'Cuttle', message, ...(detail && { detail }) });
}

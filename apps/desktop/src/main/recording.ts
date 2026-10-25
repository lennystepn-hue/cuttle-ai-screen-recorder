// Recording from the app: the pickers (one per display), the countdown over the target, the HUD,
// the recorder host, and what happens after the stop: the take becomes the project's, the editor
// opens on it, and `suggest` cuts it in the background.
import { existsSync, realpathSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rmdir, statfs } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { BrowserWindow, desktopCapturer, dialog, globalShortcut, screen, session, systemPreferences, type Rectangle } from 'electron';
import { PROJECT_FILE, newProjectFile, projectExists, readProjectFile, recoverTake, useTake, writeProjectFile } from '@cuttle/core';
import { usedIds } from '@cuttle/project';
import { focusWindow, inputAllowed, recentClaudeFolders, type Devices, type RecorderEvent, type Take } from '@cuttle/recorder';
import type { HudState, PermissionNote, PickedTarget, PickerSetup, RecordChoices, ShotDelay } from '../shared/ipc';
import { captureSourceFor, hudPosition, hudWarning, recordingFailure, scriptForTake, stopOptionsFor, type PickerDisplay, type PickerWindow, type ScriptStep } from '../shared/recording';
import { takeSeconds, type TakeActions } from '../shared/take-status';
import { displayPixels, monitorOf, setMonitors, toDesktopPixels, toDip } from './desktop-pixels';
import { CHECK, COUNTDOWN, HIDDEN, TEST_BACKEND } from './check';
import { bindRequests, send } from './ipc';
import { cutTake } from './media-service';
import { APP_ORIGIN, serveApp, bundlePath } from './protocols';
import { recorderHost, RecordingError, type LiveNews } from './recorder-host';
import { findFfmpeg } from './tools';
import { hudPlaceOf, loadSettings, updateSettings } from './settings';
import { maskPrivacy } from './privacy';
import { openPermission } from './permissions';
import { openPrompter, type Prompter } from './prompter';
import { liveRequest, transcribeProject } from './speech';
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, sendToEditor, setEditorStatus, showPill, webPreferences } from './windows';
import { freezeDisplays, frozenDisplay, onNewShot, takePicked, thawDisplays } from './shots';
import { showTake, takeChanged } from './tray';
import { hudAtTop, hudTopPlace, type HudAtTop } from './hud-top';
import { islandRect } from '../shared/drawer';

/** The HUD's window (the HUD and a margin for its shadow): never in the video, and a dead zone for the input log. */
const HUD_SIZE = { width: 552, height: 64 };
/** With live captions: the strip of words under the bar. */
const HUD_CAPTIONED_SIZE = { width: 552, height: 102 };
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
/** The pick is for a screenshot, not a take. */
let shooting = false;
/** Who waits for the screenshot's pick to end, taken or cancelled. */
const shotWaiters: (() => void)[] = [];
const endShooting = () => {
  shooting = false;
  for (const done of shotWaiters.splice(0)) done();
};
/** Resolves once the screenshot being picked is taken or cancelled (at once when none is). */
const shootingEnded = (): Promise<void> => (shooting ? new Promise((done) => shotWaiters.push(done)) : Promise.resolve());
/** Projects whose take is being finished or cut: they record again once their editor has the cut. */
const finishing = new Set<string>();
/** The running recording until its take is written into the project, for a quit to wait on. */
let writing: Promise<void> | undefined;
/** The app quits: no recording starts any more, and a take written now is cut at its next open. */
let quitting = false;
/** The script the open pick records with: every display's picker edits this one. */
let pickScript: ScriptStep[] = [];
/** The project's script when the pick opened (JSON), what `pickScript` started from. */
let pickBase = '[]';
/**
 * Scripts typed in a picker and not recorded with yet (the pick was cancelled), per project key
 * ('' for a new project), with the project's script they started from: they come back in the next
 * pick unless the project's script changed meanwhile (Claude wrote one).
 */
const scriptDrafts = new Map<string, { base: string; steps: ScriptStep[] }>();
const draftKey = (dir: string | undefined) => (dir === undefined ? '' : keyOf(dir));

/** Whether a take is being recorded into this project, or finished or cut for it: its takes stay as they are meanwhile. */
export function takesBusy(dir: string): boolean {
  const key = keyOf(dir);
  return finishing.has(key) || (busy && pickingFor !== undefined && keyOf(pickingFor) === key);
}

/** A project's key, as the editors key it: the real path (a junction or a short name is the same folder). */
export function keyOf(dir: string): string {
  let path = resolve(dir);
  try {
    path = realpathSync.native(path);
  } catch {
    // not there (yet): its resolved path
  }
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

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
    // macOS keeps windows below the menu bar: the overlay covers it too, as the page expects
    enableLargerThanScreen: true,
    webPreferences: webPreferences(preload, pickerSessionOnce()),
    ...options,
  });
  // Electron fits a new window into the work area; the overlay covers the taskbar's strip too.
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setBounds(bounds);
  guard(window.webContents);
  window.setContentProtection(true);
  return window;
}

/**
 * Electron's displays with the recorder's monitors: the monitor that contains the display's centre
 * (by order with the test backend, whose monitors are its own).
 */
function pickerDisplays(devices: Devices): PickerDisplay[] {
  setMonitors(devices.monitors);
  return screen.getAllDisplays().map((display, order) => {
    const physical = displayPixels(display);
    const monitor = TEST_BACKEND ? devices.monitors[order] : monitorOf(display, devices.monitors);
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
      bounds: TEST_BACKEND ? window.bounds : toDip(window.bounds),
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
  return { stop: saved.stop, ...(camera && { camera }), ...(mic && { mic }), ...(saved.systemAudio && { systemAudio: true }), ...(claudeFolder && { claudeFolder }) };
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

/** How ffmpeg is installed on this OS. */
const FFMPEG_INSTALL = process.platform === 'darwin' ? 'brew install ffmpeg' : 'winget install Gyan.FFmpeg';
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const ffmpegMissing = (error: unknown) => /ffmpeg/i.test(messageOf(error)) && /ENOENT|not found|cannot find/i.test(messageOf(error));

/** Why the recorder cannot list the devices, said for people. */
function listingProblem(error: unknown): string {
  if (ffmpegMissing(error)) return `Cuttle needs ffmpeg to record. Install it (${FFMPEG_INSTALL}), then press Try again.`;
  return `Cuttle cannot record: ${messageOf(error).split('\n')[0]}`;
}

/**
 * Shows the pickers on every display: a new recording (`projectDir` undefined: a new project in the
 * projects folder) or the next take of an open project. The displays and windows are listed first
 * (fast); the cameras and mics follow (DirectShow takes a moment). Does nothing while one records
 * or picks.
 */
export async function startPicking(projectDir?: string, options: { fromPill?: boolean; shot?: boolean } = {}): Promise<void> {
  if (busy || recorderHost.recording || quitting) return;
  if (!options.shot && projectDir && finishing.has(keyOf(projectDir))) {
    return say('Cuttle is still cutting the last take of this project. Record again once the cut is in the editor.');
  }
  if (!(await screenAllowed())) return;
  busy = true;
  shooting = options.shot ?? false;
  // "New recording" on the pill: the pill is not in the video; it comes back when no editor opens.
  pillHidden = options.fromPill ?? false;
  if (pillHidden) hidePill();
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
    // a screenshot: each display as it is now, under its picker (an open menu stays)
    if (shooting && !problem) await freezeDisplays(displays);
    const shot = shooting ? { delay: (await loadSettings()).shots.delay } : undefined;
    const choices = await choicesNow();
    const saved = JSON.stringify(projectDir ? await savedScript(projectDir) : []);
    const draft = scriptDrafts.get(draftKey(projectDir));
    pickBase = saved;
    pickScript = draft && draft.base === saved ? draft.steps : (JSON.parse(saved) as ScriptStep[]);
    const free = shot ? undefined : await freeBytes(projectDir ?? (await loadSettings()).projectsFolder);
    const short = free !== undefined && free < tenMinutes(displays) ? `Only ${gigabytes(free)} free on this drive: a take longer than a few minutes may not fit.` : undefined;
    const permissions = shot ? [] : [await inputNote(), accessibilityNote()].filter((note) => note !== undefined);
    const countdown = await countdownSeconds();
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    for (const picker of pickers) if (!picker.window.isDestroyed()) picker.window.destroy();
    pickers = displays.map((display) => openPicker(display, displays, devices, choices, countdown, cursor.id, problem, short, permissions, shot));
    if (!problem && !shot) void listMedia();
  } catch (error) {
    endPicking(true);
    say(`Cuttle cannot record: ${(error as Error).message}`);
  }
}

function openPicker(
  display: PickerDisplay,
  displays: PickerDisplay[],
  devices: Devices,
  choices: RecordChoices,
  countdown: number,
  active: number,
  problem: string | undefined,
  warning: string | undefined,
  permissions: PermissionNote[],
  shot: PickerSetup['shot'],
): Picker {
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
    listingDevices: !problem && !shot,
    ...(shot && { shot }),
    ...((problem ?? unknown) && { problem: problem ?? unknown }),
    ...(warning && { warning }),
    ...(permissions.length > 0 && { permissions }),
    script: pickScript,
  };
  bindRequests(window.webContents, 'picker', {
    'picker:setup': () => picker.setup,
    'picker:hover': () => activate(display.id),
    'picker:choices': async (next) => {
      await updateSettings((settings) => {
        settings.record = { ...settings.record, ...next, stop: next.stop };
        if (next.camera === undefined) delete settings.record.camera;
        if (next.mic === undefined) delete settings.record.mic;
        if (!next.systemAudio) delete settings.record.systemAudio;
      });
      for (const other of pickers) {
        if (other.setup) other.setup.choices = next;
        if (other !== picker) send(other.window.webContents, 'picker:choices', next);
      }
    },
    'picker:script': (steps) => {
      pickScript = steps;
      scriptDrafts.set(draftKey(pickingFor), { base: pickBase, steps });
      for (const other of pickers) {
        if (other.setup) other.setup.script = steps;
        if (other !== picker) send(other.window.webContents, 'picker:script', steps);
      }
    },
    'picker:record': (target) => void beginRecording(target, displays),
    'picker:frozen': () => frozenDisplay(display.id),
    'picker:shot': ({ target, delay }) => void beginShot(target, delay, displays),
    'picker:cancel': () => endPicking(true),
    'picker:retry': async () => {
      const project = pickingFor;
      const fromPill = pillHidden;
      endPicking(false);
      busy = false;
      // ffmpeg installed since (winget): found where the OS's PATH has it now, without a restart
      await findFfmpeg().catch(() => undefined);
      void startPicking(project, { fromPill });
    },
    'picker:permission': (permission) => openPermission(permission),
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

/** The cameras and mics this machine has (the settings' defaults), or why they could not be listed. */
export async function listCamerasAndMics(): Promise<{ cameras: string[]; mics: string[]; problem?: string }> {
  try {
    const devices = await withTimeout(recorderHost.devices(true), LISTING_TIMEOUT_MS, 'The device listing');
    return { cameras: devices.cameras, mics: devices.mics };
  } catch (error) {
    return { cameras: [], mics: [], problem: ffmpegMissing(error) ? 'Cuttle needs ffmpeg to list the cameras and mics.' : messageOf(error).split('\n')[0]! };
  }
}

/** The cameras and mics for every picker, once DirectShow has listed them. */
async function listMedia(): Promise<void> {
  const listed = pickers;
  let update: Pick<PickerSetup, 'cameras' | 'mics' | 'choices'>;
  let problem: string | undefined;
  let warning: string | undefined;
  try {
    const devices = await withTimeout(recorderHost.devices(true), LISTING_TIMEOUT_MS, 'The device listing');
    update = { cameras: devices.cameras, mics: devices.mics, choices: await choicesNow(devices) };
  } catch (error) {
    update = { cameras: [], mics: [], choices: await choicesNow({ cameras: [], mics: [] }) };
    // Without ffmpeg nothing records; a listing that fails otherwise leaves the screen to record alone.
    if (ffmpegMissing(error)) problem = listingProblem(error);
    else warning = `The cameras and mics could not be listed (${messageOf(error).split('\n')[0]}): the screen records without them.`;
  }
  if (pickers !== listed) return;
  for (const picker of pickers) {
    if (!picker.setup) continue;
    picker.setup = {
      ...picker.setup,
      ...update,
      listingDevices: false,
      ...(problem && { problem }),
      ...(warning && { warning: picker.setup.warning ? `${warning} ${picker.setup.warning}` : warning }),
    };
    send(picker.window.webContents, 'picker:devices', { cameras: update.cameras, mics: update.mics, choices: update.choices });
    if (problem || warning) send(picker.window.webContents, 'picker:open', picker.setup);
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
  if (shooting) void thawDisplays();
  endShooting();
  busy = false;
  if (pillHidden) void showPill('back');
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

/**
 * Removes a new project's folder that a cancelled or failed start left without a file (an empty
 * `takes/1` included); a folder with any file in it, or a link, stays. Returns whether it is gone.
 */
async function removeIfEmpty(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
  if (!entries) return false;
  let empty = true;
  for (const entry of entries) if (!entry.isDirectory() || !(await removeIfEmpty(join(dir, entry.name)))) empty = false;
  return (
    empty &&
    rmdir(dir).then(
      () => true,
      () => false,
    )
  );
}

/** A project's script as cuttle.json has it (none when it has no file yet, or one that does not parse). */
async function savedScript(dir: string): Promise<ScriptStep[]> {
  if (!projectExists(dir)) return [];
  const file = await readProjectFile(dir).catch(() => undefined);
  return file?.project.script.map(({ id, title, note }) => ({ id, title, ...(note !== undefined && { note }) })) ?? [];
}

/** The script a take recorded with goes into cuttle.json; without one, the project keeps none. */
function withScript(raw: Record<string, unknown>, script: readonly ScriptStep[]): void {
  if (script.length > 0) raw.script = script;
  else delete raw.script;
}

/** Writes the script a take recorded with into its project's cuttle.json. */
async function keepScript(dir: string, script: readonly ScriptStep[]): Promise<void> {
  const file = await readProjectFile(dir);
  withScript(file.raw, script);
  await writeProjectFile(file, 'record');
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
  quitting = true;
  if (!writing) return Promise.resolve();
  recorderHost.stop();
  return writing;
}

/** Whether a recording runs (or is being written): a quit waits for it. */
export const recordingRuns = () => writing !== undefined;
/** A picker, a screenshot or a take is under way (the drawer at the top stays shut). */
export const recordingBusy = () => busy;

async function beginRecording(target: PickedTarget, displays: PickerDisplay[]): Promise<void> {
  // One recording per pick: a second request (Enter held, or one sent as the picker closed) is late.
  if (writing || !pickers.some((picker) => picker.display === target.display)) return;
  const display = displays.find((candidate) => candidate.id === target.display);
  const picked = pickers.find((picker) => picker.display === target.display)?.setup;
  const choices = picked?.choices ?? { stop: 'none' as const };
  const steps = pickScript;
  const blocked = picked?.problem;
  let finished: () => void = () => {};
  writing = new Promise<void>((done) => (finished = done));
  let opened = false;
  try {
    // The picked window gets the focus back while a picker (Cuttle) still has it to hand on.
    if (target.kind === 'window' && !TEST_BACKEND) await focusWindow(target.window).catch(() => false);
    endPicking(false);
    if (!display || blocked) {
      if (blocked) say(blocked);
      return;
    }
    opened = await record(target, display, displays, picked, choices, steps);
  } catch (error) {
    say(`Cuttle cannot record: ${(error as Error).message}`);
  } finally {
    writing = undefined;
    finished();
    busy = false;
    // The pill "New recording" hid comes back when no editor opened (cancelled, failed).
    if (pillHidden && !opened && !quitting) void showPill('back');
    pillHidden = false;
  }
}

/** A screenshot from the pill, the tray or its hotkey: the pickers over the screen as it is now. */
export function startShooting(options: { fromPill?: boolean } = {}): Promise<void> {
  return startPicking(undefined, { ...options, shot: true });
}
// the screenshot editor's New: it steps aside until the pick is taken or cancelled
onNewShot(async () => {
  await startShooting();
  await shootingEnded();
});

/** Takes the screenshot of a pick, after its timer (the countdown over what it takes). */
async function beginShot(target: PickedTarget, delay: ShotDelay, displays: PickerDisplay[]): Promise<void> {
  if (writing || !shooting || !pickers.some((picker) => picker.display === target.display)) return;
  const display = displays.find((candidate) => candidate.id === target.display);
  const picked = pickers.find((picker) => picker.display === target.display)?.setup;
  let finished: () => void = () => {};
  writing = new Promise<void>((done) => (finished = done));
  /** What comes once the shot is in its folder: the next pick or take need not wait for it. */
  let then: (() => Promise<void>) | undefined;
  try {
    endPicking(false);
    if (!display || picked?.problem) {
      if (picked?.problem) say(picked.problem);
      return;
    }
    if (delay > 0) await countDown(inside(targetRect(target, display, picked), display.workArea), delay);
    then = await takePicked(target, display, delay);
  } catch (error) {
    say(`Cuttle cannot take the screenshot: ${(error as Error).message}`);
  } finally {
    await thawDisplays();
    writing = undefined;
    finished();
    busy = false;
    endShooting();
    if (pillHidden && !quitting) void showPill('back');
    pillHidden = false;
  }
  await then?.().catch((error: Error) => say(`Cuttle cannot show the screenshot: ${error.message}`));
}

/** The countdown over `area` for `seconds` (never in the shot: Cuttle's windows are left out). */
async function countDown(area: Rectangle, seconds: number): Promise<void> {
  const countdown = overlay(area, 'countdown.cjs', { focusable: false });
  countdown.setIgnoreMouseEvents(true);
  bindRequests(countdown.webContents, 'countdown', {});
  try {
    await countdown.loadURL(`${APP_ORIGIN}/countdown.html`).catch(() => {});
    if (!HIDDEN && !countdown.isDestroyed()) countdown.showInactive();
    for (let left = seconds; left > 0; left--) {
      if (!countdown.isDestroyed()) send(countdown.webContents, 'countdown:tick', { seconds: left });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    if (!countdown.isDestroyed()) countdown.destroy();
  }
  // the overlay is gone from the screen before the shot
  await new Promise((resolve) => setTimeout(resolve, 120));
}

/** Records a pick into its project, with the script typed for it; returns whether the editor opens on the take. */
async function record(target: PickedTarget, display: PickerDisplay, displays: PickerDisplay[], picked: PickerSetup | undefined, choices: RecordChoices, steps: ScriptStep[]): Promise<boolean> {
  const source = captureSourceFor(target, display);
  const created = !pickingFor;
  const draft = draftKey(pickingFor);
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
    const file = projectExists(projectDir) ? await readProjectFile(projectDir).catch(() => undefined) : undefined;
    const take = file && currentTake(file.raw);
    if (take && existsSync(join(projectDir, 'takes', take))) await copyFile(join(projectDir, PROJECT_FILE), join(projectDir, 'takes', take, PROJECT_FILE)).catch(() => {});
    // the steps with a title, each with an id no other item of the project has
    const script = scriptForTake(steps, usedIds({ ...file?.raw, script: [] }));

    const area = targetRect(target, display, picked);
    // what the mic hears, in the HUD while the take records
    const live = choices.mic ? await liveRequest().catch(() => undefined) : undefined;
    const hudSize = live ? HUD_CAPTIONED_SIZE : HUD_SIZE;
    /** Takes a restart put aside, newest last (folders relative to the project). */
    const discarded: string[] = [];
    for (;;) {
      let restarting = false;
      const countdown = overlay(inside(area, display.workArea), 'countdown.cjs', { focusable: false });
      countdown.setIgnoreMouseEvents(true);
      // Without a countdown (0 s) it closes before its page loaded, which rejects the load.
      void countdown.loadURL(`${APP_ORIGIN}/countdown.html`).then(
        () => !HIDDEN && !countdown.isDestroyed() && countdown.showInactive(),
        () => {},
      );
      // at the top edge (the settings say so): collapsed into an island at the top centre, open on the pointer
      const top = hudPlaceOf(await loadSettings()) === 'top' ? await hudTopPlace(display.id, hudSize) : undefined;
      let atTop: HudAtTop | undefined;
      const hud = overlay(top ? top.window : { ...hudPosition(displays, display.id, area, hudSize), ...hudSize }, 'hud.cjs', { focusable: false, movable: !top });
      const hudState: HudState = { phase: 'countdown', markers: 0, ...(choices.mic && { mic: true }), ...(live && { captions: {} }) };
      /** The script's step the take is at (from its `step` markers). */
      let stepIndex = 0;
      // a check of the drive or the window still under way may note something after the HUD closed
      const showHud = () => {
        takeChanged();
        if (!hud.isDestroyed()) send(hud.webContents, 'hud:state', { ...hudState });
      };
      /** The last warning: a pause shows its own note, the resume brings the warning back. */
      let warning: { message: string; detail: string } | undefined;
      const note = (message: string, detail: string, tone: HudState['tone']) => {
        if (tone === 'warn') warning = { message, detail };
        hudState.message = message;
        hudState.detail = detail;
        hudState.tone = tone;
        showHud();
      };
      // what the HUD's buttons do, and the take's menu in the menu bar (the tray on Windows)
      const actions: TakeActions = {
        stop: () => {
          if (hudState.phase === 'stopping') return;
          hudState.phase = 'stopping';
          note('Stopping…', 'Writing the take', 'info');
          recorderHost.stop();
        },
        pause: () => recorderHost.pause(),
        resume: () => recorderHost.resume(),
        retake: () => recorderHost.retake(),
        marker: () => recorderHost.marker(),
        shot: () => recorderHost.takeShot(),
        nextStep: () => recorderHost.nextStep(),
        previousStep: () => recorderHost.previousStep(),
      };
      const endTakeInTray = showTake(() => ({ phase: hudState.phase, seconds: takeSeconds(hudState, Date.now()), ...(script.length > 0 && { step: { index: stepIndex, count: script.length } }) }), actions);
      bindRequests(hud.webContents, 'hud', {
        'hud:stop': () => actions.stop(),
        'hud:marker': () => actions.marker(),
        'hud:retake': () => actions.retake(),
        'hud:shot': () => actions.shot(),
        'hud:pause': () => actions.pause(),
        'hud:resume': () => actions.resume(),
        'hud:restart': () => {
          if (hudState.phase === 'stopping' || hudState.phase === 'countdown') return;
          restarting = true;
          hudState.phase = 'stopping';
          note('Restarting…', 'This take is put aside: the editor can bring it back', 'info');
          recorderHost.stop();
        },
      });
      bindRequests(countdown.webContents, 'countdown', {});
      // The script's steps in the prompter by the HUD, from the countdown on (the first can be read before the take runs).
      let prompter: Prompter | undefined;
      // the HUD's and the prompter's areas (at the top edge: the island, or the open HUD)
      const deadZones = () => {
        const windows = [...(top ? [] : [hud]), ...(prompter?.shown ? [prompter.window] : [])].filter((window) => !window.isDestroyed()).map((window) => window.getBounds());
        return [...(top ? (atTop?.zones() ?? [islandRect(top.display)]) : []), ...windows].map((rect) => toDesktopPixels(rect));
      };
      if (script.length > 0) prompter = openPrompter(overlay, hud.getBounds(), display.workArea, script, () => recorderHost.setDeadZones(deadZones()), top !== undefined);
      hud.on('moved', () => recorderHost.setDeadZones(deadZones()));
      // Windows ends the session (sign out, shut down): the end waits while the take is stopped and written.
      hud.on('query-session-end', (event) => {
        event.preventDefault();
        recorderHost.stop();
      });
      hud.on('session-end', () => recorderHost.stop());
      void hud.loadURL(`${APP_ORIGIN}/hud.html`).then(
        () => {
          if (!top || hud.isDestroyed()) return;
          atTop = hudAtTop(hud, top, () => prompter?.window, (open) => {
            prompter?.setShown(open);
            recorderHost.setDeadZones(deadZones());
          });
        },
        () => {},
      );
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
        const origin = TEST_BACKEND ? pickedWindow.bounds : toDesktopPixels(roundRect(pickedWindow.bounds));
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

      const onLive = (news: LiveNews) => {
        if ('failed' in news) {
          hudState.captions = { failed: news.failed };
          showHud();
        } else if (!hud.isDestroyed()) send(hud.webContents, 'hud:caption', { words: news.words });
      };

      const onEvent = (event: RecorderEvent) => {
        switch (event.type) {
          case 'countdown':
            send(countdown.webContents, 'countdown:tick', { seconds: event.seconds, ...(discarded.length > 0 && { restart: true }) });
            return;
          case 'recording':
            closeOverlays();
            takeDir = event.dir;
            // the take goes into the project with its script: the draft is done
            scriptDrafts.delete(draft);
            hudState.phase = 'recording';
            hudState.startedAt = Date.now();
            hudState.recorded = 0;
            if (!HIDDEN) hud.showInactive();
            showHud();
            prompter?.setLive(true);
            watch = setInterval(() => void watchTake(), 2000);
            return;
          case 'paused':
            hudState.recorded = (hudState.recorded ?? 0) + (Date.now() - (hudState.startedAt ?? Date.now())) / 1000;
            delete hudState.startedAt;
            hudState.phase = 'paused';
            note('Paused', 'Nothing is recorded until you resume (Ctrl+Shift+Alt+P)', 'info');
            return;
          case 'resuming':
            hudState.phase = 'resuming';
            note('Resuming…', 'Starting the tracks again', 'info');
            return;
          case 'resumed':
            hudState.phase = 'recording';
            hudState.startedAt = Date.now();
            if (warning) {
              note(warning.message, warning.detail, 'warn');
              return;
            }
            delete hudState.message;
            delete hudState.detail;
            delete hudState.tone;
            showHud();
            return;
          case 'marker':
            // a step of the script moves the prompter; the mistake key's marker is a retake: neither is one of the person's markers
            if (event.marker.kind === 'step') {
              stepIndex = Math.max(0, script.findIndex((step) => step.id === event.marker.label));
              takeChanged();
              return prompter?.reached(event.marker.label ?? '');
            }
            if (event.marker.kind === 'retake') hudState.retakes = (hudState.retakes ?? 0) + 1;
            else if (event.marker.kind === 'shot') hudState.shots = (hudState.shots ?? 0) + 1;
            else hudState.markers++;
            showHud();
            return;
          case 'level':
            if (!hud.isDestroyed()) send(hud.webContents, 'hud:level', { rms: event.rms, peak: event.peak });
            return;
          case 'warning': {
            const warning = hudWarning(event.message);
            note(warning.text, warning.detail, 'warn');
            return;
          }
          case 'stopping':
            hudState.phase = 'stopping';
            prompter?.setLive(false);
            // a restart says so to the end ("Restarting…"), not "Stopping…"
            if (!restarting) note('Stopping…', 'Writing the take', 'info');
            return;
        }
      };

      // The picker's camera preview lets go of the camera a moment after the picker closed.
      const countdownFor = await countdownSeconds();
      if (choices.camera && countdownFor < 1) await new Promise((resolve) => setTimeout(resolve, 600));
      let take: Take;
      try {
        if (quitting) throw new RecordingError('cancelled', 'The app quits');
        await askForMedia(choices);
        take = await recorderHost.record(
          {
            projectDir,
            source,
            ...(choices.camera && { webcam: choices.camera }),
            ...(choices.mic && { mic: choices.mic }),
            ...(choices.systemAudio && { systemAudio: true }),
            stop: stopOptionsFor(choices),
            countdownSeconds: countdownFor,
            deadZones: deadZones(),
            ...(script.length > 0 && { steps: script.map((step) => step.id) }),
            // macOS: the app's own windows (the HUD above all) stay out of the take, as Windows keeps them out by content protection
            hideWindowsOf: [process.pid],
          },
          onEvent,
          live && { request: live, onLive },
        );
      } catch (error) {
        clearInterval(watch);
        closeOverlays();
        if (!hud.isDestroyed()) hud.destroy();
        endTakeInTray();
        atTop?.stop();
        prompter?.destroy();
        if (error instanceof RecordingError && error.code === 'cancelled') {
          // cancelled after a restart: the take put aside is the take after all
          const previous = discarded.pop();
          if (previous) {
            const back = await bringBack(projectDir, previous);
            if (back) {
              cutting = await recoverAndOpen(projectDir, back, '', showEditor, true, script);
              return cutting;
            }
          }
          await giveUp();
          return false;
        }
        // A take that had started is kept: repaired with recover, then opened like any other (and
        // the take a restart put aside is offered back there).
        if (takeDir) {
          const previous = discarded.at(-1);
          if (previous) restarted.set(keyOf(projectDir), previous);
          cutting = await recoverAndOpen(projectDir, takeDir, (error as Error).message, showEditor, false, script);
          if (!cutting) restarted.delete(keyOf(projectDir));
          return cutting;
        }
        // Nothing recorded after a restart: the take put aside is the take again.
        const previous = discarded.pop();
        const back = previous && (await bringBack(projectDir, previous).catch(() => undefined));
        if (back) {
          const failure = recordingFailure((error as Error).message);
          say(`The recording could not start again. ${failure.text} The take from before the restart is kept.`, failure.detail);
          cutting = await recoverAndOpen(projectDir, back, '', showEditor, true, script);
          return cutting;
        }
        await giveUp();
        const failure = recordingFailure((error as Error).message);
        say(`The recording could not start. ${failure.text}`, failure.detail);
        return false;
      }
      clearInterval(watch);
      closeOverlays();
      if (!hud.isDestroyed()) hud.destroy();
      endTakeInTray();
      atTop?.stop();
      prompter?.destroy();
      if (restarting && !quitting) {
        // put aside, not deleted ("Undo restart" in the editor), and counted down again
        const aside = await putAside(projectDir, take.dir).catch((error: Error) => {
          say(`The take could not be put aside for a new one (${error.message.split('\n')[0]}): it is kept as the take.`);
          return undefined;
        });
        if (aside) {
          discarded.push(aside);
          continue;
        }
      }
      // the editor that opens on this take offers to bring back the one a restart put aside
      const restartedFrom = discarded.at(-1);
      if (restartedFrom) restarted.set(keyOf(projectDir), restartedFrom);
      cutting = await finishTake(projectDir, take, showEditor, script);
      if (!cutting) restarted.delete(keyOf(projectDir));
      return cutting;
    }
  } finally {
    if (!cutting) finishing.delete(project);
  }
}

/** A folder rename that waits a moment for a file in it someone holds (a scanner on a take just written, OneDrive). */
async function renameWhenFree(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}

/** Moves a take into `takes/.discarded/` (a restart); returns its new folder relative to the project. */
async function putAside(projectDir: string, takeDir: string): Promise<string> {
  const aside = join(projectDir, 'takes', '.discarded');
  await mkdir(aside, { recursive: true });
  const taken = new Set(await readdir(aside));
  const name = basename(takeDir);
  let target = name;
  for (let n = 2; taken.has(target); n++) target = `${name}-${n}`;
  await renameWhenFree(join(projectDir, takeDir), join(aside, target));
  return ['takes', '.discarded', target].join('/');
}

/** Moves a take put aside back as the next take (`takes/<n>`); returns its folder, or undefined when it is not there. */
async function bringBack(projectDir: string, discarded: string): Promise<string | undefined> {
  const from = resolve(projectDir, discarded);
  const aside = resolve(projectDir, 'takes', '.discarded');
  const inside = relative(aside, from);
  if (inside === '' || inside.startsWith('..') || inside.includes(sep) || !existsSync(from)) return undefined;
  const names = await readdir(join(projectDir, 'takes')).catch(() => [] as string[]);
  const next = names.reduce((max, name) => (/^\d+$/.test(name) ? Math.max(max, Number(name)) : max), 0) + 1;
  await mkdir(dirname(join(projectDir, 'takes', String(next))), { recursive: true });
  await renameWhenFree(from, join(projectDir, 'takes', String(next)));
  return `takes/${next}`;
}

/**
 * "Undo restart" in the editor: the take put aside becomes the project's again (the restarted one
 * stays restorable, "Back to take n"), and is cut like a new one.
 */
export async function undoRestart(projectDir: string, discarded: string): Promise<void> {
  const dir = resolve(projectDir);
  const file = projectExists(dir) ? await readProjectFile(dir).catch(() => undefined) : undefined;
  const current = file && currentTake(file.raw);
  if (current && existsSync(join(dir, 'takes', current))) await copyFile(join(dir, PROJECT_FILE), join(dir, 'takes', current, PROJECT_FILE)).catch(() => {});
  try {
    const back = await bringBack(dir, discarded);
    if (!back) return say('The take put aside by the restart is not there any more.');
    notesAfterCut.set(keyOf(dir), `The take from before the restart is back (take ${back.split('/').at(-1)}). The other one is in Record again ▾.`);
    await recoverAndOpen(dir, back, '', async () => {}, true);
  } catch (error) {
    say(`The take from before the restart could not be brought back: ${(error as Error).message.split('\n')[0]}`);
  }
}

/**
 * A take that ended badly (the capture failed after it started): `recover` repairs it and points the
 * project at it, and it is cut like any other; `quiet`: a take brought back, nothing to say. The
 * `script` it recorded with goes into the project too (none given: the project's stays). Returns
 * whether the cut started.
 */
async function recoverAndOpen(projectDir: string, takeDir: string, why: string, showEditor: () => Promise<void>, quiet = false, script?: readonly ScriptStep[]): Promise<boolean> {
  const dir = resolve(projectDir);
  const failure = recordingFailure(why);
  try {
    const result = await recoverTake(dir, takeDir);
    // a file that cannot take the script keeps its own: the take is what matters here
    if (script) await keepScript(dir, script).catch(() => {});
    if (!quiet) say(`The recording stopped early. ${failure.text} Cuttle kept the ${Math.round(result.seconds)} s it had and opened it.`, [failure.detail, ...result.repaired].join('\n'));
  } catch (error) {
    await showEditor();
    say(`The recording stopped early. ${failure.text} Its take in ${takeDir} could not be recovered: ${(error as Error).message.split('\n')[0]}`, failure.detail);
    return false;
  }
  void cutAndShow(dir);
  return true;
}

/**
 * The take becomes the project's with the script it recorded with (its previous version kept as a
 * backup), the editor opens on it, and `suggest` cuts it; while the app quits, it is cut at the
 * project's next open instead. Returns whether the cut started.
 */
async function finishTake(projectDir: string, take: Take, showEditor: () => Promise<void>, script: readonly ScriptStep[]): Promise<boolean> {
  try {
    const file = projectExists(projectDir) ? await readProjectFile(projectDir) : newProjectFile(projectDir);
    const hadEdit = useTake(file, take);
    withScript(file.raw, script);
    await writeProjectFile(file, 'record', { backup: hadEdit });
  } catch (error) {
    await showEditor();
    say(`The take is saved in ${take.dir}, but cuttle.json could not be pointed at it: ${(error as Error).message.split('\n')[0]}. Run "cuttle recover ${take.dir}".`);
    return false;
  }
  if (quitting) {
    const key = keyOf(projectDir);
    await updateSettings((settings) => {
      settings.uncut = [...settings.uncut.filter((entry) => entry !== key), key];
    });
    return false;
  }
  void cutAndShow(resolve(projectDir));
  return true;
}

/** A take written while the app quit is cut when its project opens next (once its editor shows it). */
export async function cutIfPending(dir: string): Promise<void> {
  const key = keyOf(dir);
  if (!(await loadSettings()).uncut.includes(key)) return;
  await updateSettings((settings) => {
    settings.uncut = settings.uncut.filter((entry) => entry !== key);
  });
  await recut(dir);
}

/** Projects whose new take came after a restart: the take put aside, for the editor's "Undo restart". */
const restarted = new Map<string, string>();
/** What the editor of a project says once its take is cut (an undone restart). */
const notesAfterCut = new Map<string, string>();

/**
 * Opens the editor on the take at once while `suggest` cuts it in the background; the editor gets
 * the cut as a change of the file, one step to undo ("Cuttle's cut").
 */
async function cutAndShow(dir: string): Promise<void> {
  finishing.add(keyOf(dir));
  try {
    await reopenEditor(dir);
    const discarded = restarted.get(keyOf(dir));
    restarted.delete(keyOf(dir));
    const said = notesAfterCut.get(keyOf(dir));
    notesAfterCut.delete(keyOf(dir));
    await cut(dir);
    if (discarded) await sendToEditor(dir, 'project:restarted', { discarded });
    if (said) await sendToEditor(dir, 'project:note', { text: said });
  } finally {
    finishing.delete(keyOf(dir));
  }
}

/**
 * Cuts the project's take with `suggest`; the editor says so, gets the cut as a change of the file
 * (one step to undo, "Cuttle's cut"), and says when it could not (with Try again).
 */
async function cut(dir: string): Promise<void> {
  await setEditorStatus(dir, { text: 'Cutting the take…', state: 'working' });
  await expectSuggest(dir, true);
  try {
    await cutTake(dir);
  } catch (error) {
    await expectSuggest(dir, false);
    await setEditorStatus(dir, { text: `The take could not be cut: ${(error as Error).message.split('\n')[0]}`, state: 'failed' });
    return;
  }
  await setEditorStatus(dir, undefined);
  // then what was said: transcribed, its filler words and pauses cut (a step of its own); then what
  // the screen showed: its private things and the notifications masked (a step of its own, after it)
  await transcribeProject(dir);
  await maskPrivacy(dir);
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
/**
 * macOS: whether Cuttle may record the screen. When not, asking for the screen's sources puts Cuttle
 * on System Settings' list (macOS asks itself the first time), and the person is shown the way there.
 */
async function screenAllowed(): Promise<boolean> {
  // the checks list devices and record test patterns only: no screen to ask for
  if (process.platform !== 'darwin' || TEST_BACKEND || CHECK || systemPreferences.getMediaAccessStatus('screen') === 'granted') return true;
  await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => []);
  if (HIDDEN) {
    console.error('Cuttle may not record the screen (System Settings > Privacy & Security > Screen & System Audio Recording)');
    return false;
  }
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Cuttle',
    message: 'Allow Cuttle to record the screen',
    detail: 'Turn Cuttle on under System Settings > Privacy & Security > Screen & System Audio Recording, then quit and reopen Cuttle.',
    buttons: ['Open System Settings', 'Not now'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) openPermission('screen');
  return false;
}

/**
 * macOS: what a take misses without Input Monitoring, for the pickers; undefined when Cuttle has it.
 * The first look shows macOS's prompt, before the take rather than in it.
 */
async function inputNote(): Promise<PermissionNote | undefined> {
  if (process.platform !== 'darwin' || TEST_BACKEND || CHECK) return undefined;
  if (await inputAllowed().catch(() => true)) return undefined;
  return {
    permission: 'input',
    text: 'Cuttle does not see your clicks and keys: no zooms on clicks, no typing, no recording hotkeys. Turn Cuttle on under Input Monitoring, then quit and reopen Cuttle.',
  };
}

/** Whether macOS's prompt for the Accessibility permission was shown in this run (once is enough). */
let accessibilityAsked = false;

/**
 * macOS: without the Accessibility permission a take has no caret (zooms on typing follow what the
 * screen changes), no browser page to crop to, and notifications masked wide. The first time,
 * macOS's own prompt opens over the picker.
 */
function accessibilityNote(): PermissionNote | undefined {
  if (process.platform !== 'darwin' || TEST_BACKEND || CHECK) return undefined;
  if (systemPreferences.isTrustedAccessibilityClient(false)) return undefined;
  if (!accessibilityAsked) {
    accessibilityAsked = true;
    systemPreferences.isTrustedAccessibilityClient(true);
  }
  return { permission: 'accessibility', text: 'Cuttle does not see where you type: zooms on typing follow what the screen changes instead. Turn Cuttle on under Accessibility.' };
}

/** macOS: asks for the camera and the mic a take uses, the first time (the recorder's ffmpeg runs as Cuttle). */
async function askForMedia(choices: RecordChoices): Promise<void> {
  if (process.platform !== 'darwin' || TEST_BACKEND) return;
  for (const [kind, name] of [['camera', choices.camera], ['microphone', choices.mic]] as const) {
    if (name && systemPreferences.getMediaAccessStatus(kind) === 'not-determined') await systemPreferences.askForMediaAccess(kind);
  }
}

function say(message: string, detail?: string): void {
  if (HIDDEN) {
    console.error(detail ? `${message}\n${detail}` : message);
    return;
  }
  void dialog.showMessageBox({ type: 'warning', title: 'Cuttle', message, ...(detail && { detail }) });
}

// Recording from the app: the pickers (one per display), the countdown over the target, the HUD,
// the recorder host, and what happens after the stop: the take becomes the project's, the editor
// opens on it, and `suggest` cuts it in the background.
import { copyFile, mkdir, statfs } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BrowserWindow, dialog, globalShortcut, screen, session, type Rectangle } from 'electron';
import { PROJECT_FILE, newProjectFile, projectExists, readProjectFile, recoverTake, useTake, writeProjectFile } from '@cuttle/core';
import { focusWindow, recentClaudeFolders, type Devices, type RecorderEvent, type Take } from '@cuttle/recorder';
import type { HudState, PickedTarget, PickerSetup, RecordChoices } from '../shared/ipc';
import { captureSourceFor, hudPosition, stopOptionsFor, type PickerDisplay, type PickerWindow } from '../shared/recording';
import { COUNTDOWN, HIDDEN, TEST_BACKEND } from './check';
import { bindRequests, send } from './ipc';
import { cutTake } from './media-service';
import { APP_ORIGIN, serveApp, bundlePath } from './protocols';
import { recorderHost, RecordingError } from './recorder-host';
import { loadSettings, updateSettings } from './settings';
import { editorWindowOf, guard, reopenEditor, setEditorStatus, webPreferences } from './windows';

/** The window the recorder never sees and logs no input from. */
const HUD_SIZE = { width: 380, height: 64 };

interface Picker {
  window: BrowserWindow;
  display: number;
  setup?: PickerSetup;
}

let pickers: Picker[] = [];
let pickerSession: Electron.Session | undefined;
/** The project folder the next take goes into; undefined: a new project. */
let pickingFor: string | undefined;
let picking = false;

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

/** A frameless, transparent, content-protected window over everything. */
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
  guard(window.webContents);
  window.setContentProtection(true);
  window.setAlwaysOnTop(true, 'screen-saver');
  return window;
}

/** Electron's displays matched with the recorder's monitors (equal physical bounds; by order with the test backend). */
function pickerDisplays(devices: Devices): PickerDisplay[] {
  const displays = screen.getAllDisplays();
  return displays.map((display, order) => {
    const physical = screen.dipToScreenRect(null, display.bounds);
    const monitor = TEST_BACKEND
      ? devices.monitors[order]
      : devices.monitors.find(({ bounds }) => bounds.x === physical.x && bounds.y === physical.y && bounds.width === physical.width && bounds.height === physical.height);
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

async function choicesNow(devices: Devices): Promise<RecordChoices> {
  const saved = (await loadSettings()).record;
  const claudeFolder = saved.claudeFolder ?? (await recentClaudeFolders(1).catch(() => []))[0]?.cwd;
  return {
    stop: saved.stop,
    ...(saved.camera && devices.cameras.includes(saved.camera) && { camera: saved.camera }),
    ...(saved.mic && devices.mics.includes(saved.mic) && { mic: saved.mic }),
    ...(claudeFolder && { claudeFolder }),
  };
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

/**
 * Shows the pickers on every display: a new recording (`projectDir` undefined: a new project in the
 * projects folder) or the next take of an open project. Does nothing while one records or picks.
 */
export async function startPicking(projectDir?: string): Promise<void> {
  if (picking || recorderHost.recording) return;
  picking = true;
  pickingFor = projectDir;
  let devices: Devices;
  let problem: string | undefined;
  try {
    devices = await recorderHost.devices(true);
  } catch (error) {
    devices = { monitors: [], windows: [], cameras: [], mics: [] };
    problem = `Cuttle cannot record: ${(error as Error).message}`;
  }
  const displays = pickerDisplays(devices);
  const choices = await choicesNow(devices);
  const free = await freeBytes(projectDir ?? (await loadSettings()).projectsFolder);
  if (!problem && free !== undefined && free < tenMinutes(displays)) problem = `Only ${gigabytes(free)} free on this drive: a take longer than a few minutes may not fit.`;
  const countdown = await countdownSeconds();
  const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  for (const picker of pickers) if (!picker.window.isDestroyed()) picker.window.destroy();
  pickers = displays.map((display) => {
    const window = overlay(display.bounds, 'picker.cjs', { focusable: true });
    const picker: Picker = { window, display: display.id };
    picker.setup = {
      display,
      windows: windowsOn(display, devices),
      cameras: devices.cameras,
      mics: devices.mics,
      choices,
      active: display.id === cursor.id,
      countdown,
      ...((problem ?? (display.monitor === undefined ? 'The recorder does not know this display; pick another one.' : undefined)) && {
        problem: problem ?? 'The recorder does not know this display; pick another one.',
      }),
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
      'picker:cancel': () => endPicking(),
      'picker:claude-folder': async () => {
        const result = await dialog.showOpenDialog(window, { title: 'The folder Claude Code runs in', properties: ['openDirectory'] });
        return result.canceled ? undefined : result.filePaths[0];
      },
    });
    // A picker closed before its page loaded (Esc at once) rejects the load: nothing to show then.
    void window.loadURL(`${APP_ORIGIN}/picker.html`).then(
      () => {
        if (window.isDestroyed()) return;
        if (!HIDDEN) window.show();
        if (display.id === cursor.id) window.focus();
      },
      () => {},
    );
    return picker;
  });
}

function activate(display: number): void {
  for (const picker of pickers) {
    if (picker.setup) picker.setup.active = picker.display === display;
    send(picker.window.webContents, 'picker:active', { display });
    if (picker.display === display && !picker.window.isFocused()) picker.window.focus();
  }
}

function endPicking(): void {
  picking = false;
  for (const picker of pickers) if (!picker.window.isDestroyed()) picker.window.destroy();
  pickers = [];
}

/** The rectangle (DIP) a pick covers, for the countdown. */
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

/** A new project's folder in the projects folder: the date and time (no colons on Windows), "(2)" … when it is taken. */
async function newProjectDir(): Promise<string> {
  const { projectsFolder } = await loadSettings();
  await mkdir(projectsFolder, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replaceAll(':', '.');
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

/** The take folder number a project uses now (`takes/<n>/screen.mp4`), if any. */
function currentTake(raw: Record<string, unknown>): string | undefined {
  const screen = (raw.sources as { screen?: unknown } | undefined)?.screen;
  const match = typeof screen === 'string' ? /^takes\/(\d+)\//.exec(screen.replaceAll('\\', '/')) : null;
  return match?.[1];
}

async function beginRecording(target: PickedTarget, displays: PickerDisplay[]): Promise<void> {
  const display = displays.find((candidate) => candidate.id === target.display);
  const picked = pickers.find((picker) => picker.display === target.display)?.setup;
  const choices = picked?.choices ?? { stop: 'none' as const };
  endPicking();
  if (!display) return;
  let source;
  try {
    source = captureSourceFor(target, display);
  } catch (error) {
    return say(`Cuttle cannot record this: ${(error as Error).message}`);
  }
  const projectDir = pickingFor ?? (await newProjectDir());
  // The project's editor is not in its own take: hidden while it records again, shown after.
  const editor = pickingFor ? await editorWindowOf(pickingFor) : undefined;
  editor?.hide();
  const showEditor = () => editor && !editor.isDestroyed() && !HIDDEN && editor.show();
  // The edit of the take the project uses now stays restorable ("Back to take n").
  if (projectExists(projectDir)) {
    const file = await readProjectFile(projectDir).catch(() => undefined);
    const take = file && currentTake(file.raw);
    if (take && existsSync(join(projectDir, 'takes', take))) await copyFile(join(projectDir, PROJECT_FILE), join(projectDir, 'takes', take, PROJECT_FILE)).catch(() => {});
  }

  const countdown = overlay(targetRect(target, display, picked), 'countdown.cjs', { focusable: false });
  countdown.setIgnoreMouseEvents(true);
  // Without a countdown (0 s) it closes before its page loaded, which rejects the load.
  void countdown.loadURL(`${APP_ORIGIN}/countdown.html`).then(
    () => !HIDDEN && !countdown.isDestroyed() && countdown.showInactive(),
    () => {},
  );
  const position = hudPosition(display, HUD_SIZE);
  const hud = overlay({ ...position, ...HUD_SIZE }, 'hud.cjs', { focusable: false, movable: true });
  const hudState: HudState = { phase: 'countdown', markers: 0 };
  const showHud = () => send(hud.webContents, 'hud:state', { ...hudState });
  bindRequests(hud.webContents, 'hud', {
    'hud:stop': () => {
      hudState.phase = 'stopping';
      hudState.message = 'Stopping…';
      showHud();
      recorderHost.stop();
    },
    'hud:marker': () => recorderHost.marker(),
  });
  bindRequests(countdown.webContents, 'countdown', {});
  const deadZone = () => screen.dipToScreenRect(null, hud.getBounds());
  hud.on('moved', () => recorderHost.setDeadZones([deadZone()]));
  void hud.loadURL(`${APP_ORIGIN}/hud.html`).catch(() => {});
  const cancelKey = 'Escape';
  globalShortcut.register(cancelKey, () => recorderHost.stop());
  const closeOverlays = () => {
    if (globalShortcut.isRegistered(cancelKey)) globalShortcut.unregister(cancelKey);
    if (!countdown.isDestroyed()) countdown.destroy();
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
        // The picker had the focus: give it back to the window being recorded.
        if (target.kind === 'window' && !TEST_BACKEND) void focusWindow(target.window).catch(() => false);
        watch = setInterval(() => void watchTake(), 2000);
        return;
      case 'marker':
        hudState.markers++;
        showHud();
        return;
      case 'warning':
        hudState.message = event.message;
        showHud();
        return;
      case 'stopping':
        hudState.phase = 'stopping';
        hudState.message = 'Stopping…';
        showHud();
        return;
    }
  };

  // While it records: a warning when the drive fills up, or when a recorded window moves (its area
  // stays where it was picked).
  let takeDir: string | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;
  let lastSpaceCheck = 0;
  const pickedWindow = target.kind === 'window' ? picked?.windows.find((candidate) => candidate.id === target.window) : undefined;
  const watchTake = async () => {
    if (hudState.phase !== 'recording') return;
    if (Date.now() - lastSpaceCheck > 30_000) {
      lastSpaceCheck = Date.now();
      const left = await freeBytes(projectDir);
      if (left !== undefined && left < 2 * GB && hudState.message === undefined) {
        hudState.message = `Disk almost full: ${gigabytes(left)} left`;
        showHud();
      }
    }
    if (pickedWindow && hudState.message === undefined) {
      const now = (await recorderHost.devices(false).catch(() => undefined))?.windows.find((window) => window.id === pickedWindow.id);
      const before = pickedWindow.pixels;
      if (now && (now.bounds.width !== before.width || now.bounds.height !== before.height || moved(now.bounds))) {
        hudState.message = 'The window moved: its old area is recorded';
        showHud();
      }
    }
  };
  /** Whether a window's physical bounds left where it was picked (DIP bounds converted back). */
  const moved = (bounds: { x: number; y: number }) => {
    if (!pickedWindow) return false;
    const origin = TEST_BACKEND ? pickedWindow.bounds : screen.dipToScreenRect(null, roundRect(pickedWindow.bounds));
    return Math.abs(bounds.x - origin.x) > 2 || Math.abs(bounds.y - origin.y) > 2;
  };

  let take: Take;
  try {
    take = await recorderHost.record(
      {
        projectDir,
        source,
        ...(choices.camera && { webcam: choices.camera }),
        ...(choices.mic && { mic: choices.mic }),
        stop: stopOptionsFor(choices),
        countdownSeconds: await countdownSeconds(),
        deadZones: [deadZone()],
      },
      onEvent,
    );
  } catch (error) {
    clearInterval(watch);
    closeOverlays();
    if (!hud.isDestroyed()) hud.destroy();
    if (error instanceof RecordingError && error.code === 'cancelled') return void showEditor();
    // A take that had started is kept: repaired with recover, then opened like any other.
    if (takeDir) return recoverAndOpen(projectDir, takeDir, (error as Error).message);
    showEditor();
    return say(`The recording failed: ${(error as Error).message}`);
  }
  clearInterval(watch);
  closeOverlays();
  if (!hud.isDestroyed()) hud.destroy();
  await finishTake(projectDir, take);
}

/** A take that ended badly (the capture failed after it started): `recover` repairs it and points the project at it. */
async function recoverAndOpen(projectDir: string, takeDir: string, why: string): Promise<void> {
  const dir = resolve(projectDir);
  try {
    const result = await recoverTake(dir, takeDir);
    say(`The recording stopped early (${why}). Cuttle kept the ${Math.round(result.seconds)} s it had${result.repaired.length > 0 ? ` and repaired it: ${result.repaired.join('; ')}` : ''}.`);
  } catch (error) {
    return say(`The recording failed (${why}), and its take in ${takeDir} could not be recovered: ${(error as Error).message}`);
  }
  await cutAndShow(dir);
}

/** The take becomes the project's (its previous version kept as a backup), the editor opens on it, and `suggest` cuts it. */
async function finishTake(projectDir: string, take: Take): Promise<void> {
  try {
    const file = projectExists(projectDir) ? await readProjectFile(projectDir) : newProjectFile(projectDir);
    const hadEdit = useTake(file, take);
    await writeProjectFile(file, 'record', { backup: hadEdit });
  } catch (error) {
    return say(`The take is saved in ${take.dir}, but cuttle.json could not be pointed at it: ${(error as Error).message}. Run "cuttle recover ${take.dir}".`);
  }
  await cutAndShow(resolve(projectDir));
}

/** Opens the editor on the take at once, and reloads it once `suggest` has cut it in the background. */
async function cutAndShow(dir: string): Promise<void> {
  await reopenEditor(dir);
  await setEditorStatus(dir, 'Cutting the take…');
  try {
    await cutTake(dir);
  } catch (error) {
    await setEditorStatus(dir, `The take could not be cut: ${(error as Error).message}`);
    return;
  }
  await setEditorStatus(dir, undefined);
  await reopenEditor(dir, { reload: true });
}

function say(message: string): void {
  if (HIDDEN) {
    console.error(message);
    return;
  }
  void dialog.showMessageBox({ type: 'warning', title: 'Cuttle', message });
}

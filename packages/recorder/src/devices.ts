import { spawn } from 'node:child_process';
import { RecorderError } from './errors';
import { ffmpegMissing, ffmpegPath } from './ffmpeg';
import { TEST_DEVICES, pickCameraMode, platformFor, type CameraMode, type Platform } from './sources';
import type { Backend, Devices, WindowInfo } from './types';

/** Seconds the DirectShow or avfoundation listing may take before it counts as hung. */
const LISTING_TIMEOUT_SECONDS = 10;

/** Monitors, windows, cameras and microphones the recorder can capture. */
export function listDevices(options: { backend?: Backend; media?: boolean } = {}): Promise<Devices> {
  return devicesFor(platformFor(options.backend), options.media ?? true);
}

/**
 * The devices of a platform; cameras and mics only with `media` (the DirectShow or avfoundation
 * listing starts an ffmpeg, which a take without webcam and mic does not need).
 */
export async function devicesFor(platform: Platform, media: boolean): Promise<Devices> {
  if (platform === 'test') return structuredClone(TEST_DEVICES);
  if (platform === 'macos') {
    const { loadDarwin } = await import('./darwin');
    const mac = await loadDarwin();
    const { cameras, mics } = media ? parseAvfoundationDevices(await listing(['-f', 'avfoundation', '-list_devices', 'true', '-i', ''])) : { cameras: [], mics: [] };
    return { monitors: mac.monitors(), windows: mac.windows(), cameras, mics };
  }
  const { loadWin32 } = await import('./win32');
  const win = await loadWin32();
  const { cameras, mics } = media ? parseDshowDevices(await listing(['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'])) : { cameras: [], mics: [] };
  return { monitors: win.monitors(), windows: win.windows(), cameras, mics };
}

/**
 * Brings a window (`WindowInfo.id`) to the front, e.g. the one a picker took the focus from. Only
 * the process that has the focus may do so on Windows; macOS brings the window's app to the front.
 * False when it is gone or the OS refused, and always with the test backend.
 */
export async function focusWindow(id: number, options: { backend?: Backend } = {}): Promise<boolean> {
  const platform = platformFor(options.backend);
  if (platform === 'test') return false;
  if (platform === 'macos') {
    const { loadDarwin } = await import('./darwin');
    return (await loadDarwin()).focus(id);
  }
  const { loadWin32 } = await import('./win32');
  return (await loadWin32()).focus(id);
}

/**
 * Whether a take logs the clicks and the keys: macOS needs Input Monitoring for them (the first call
 * shows macOS's prompt), Windows and the test backend need nothing. Asked before a take, so the
 * prompt never opens in one.
 */
export async function inputAllowed(options: { backend?: Backend } = {}): Promise<boolean> {
  if (platformFor(options.backend) !== 'macos') return true;
  const { loadDarwin } = await import('./darwin');
  return (await loadDarwin()).keyboardAccess();
}

/**
 * What the app's drawer at the top centre asks of the system, many times a second: the displays'
 * notches (macOS; by display id, centred at the top) and whether a mouse button is held. Nothing
 * with the test backend.
 */
export async function topEdge(options: { backend?: Backend } = {}): Promise<{ notches(): { display: number; width: number; height: number }[]; mouseButtonDown(): boolean }> {
  const platform = platformFor(options.backend);
  if (platform === 'test') return { notches: () => [], mouseButtonDown: () => false };
  if (platform === 'macos') {
    const { loadDarwin } = await import('./darwin');
    const mac = await loadDarwin();
    return { notches: () => mac.notches(), mouseButtonDown: () => mac.mouseButtonDown() };
  }
  const { loadWin32 } = await import('./win32');
  const win = await loadWin32();
  return { notches: () => [], mouseButtonDown: () => win.mouseButtonDown() };
}

/** The windows now, for a window source that is resolved again when the countdown ends. */
export async function windowsFor(platform: Platform): Promise<WindowInfo[]> {
  if (platform === 'test') return structuredClone(TEST_DEVICES.windows);
  if (platform === 'macos') {
    const { loadDarwin } = await import('./darwin');
    return (await loadDarwin()).windows();
  }
  const { loadWin32 } = await import('./win32');
  return (await loadWin32()).windows();
}

/**
 * The mode to open a camera in (macOS only, where avfoundation otherwise takes the smallest): asking
 * for a size it does not have makes ffmpeg list the ones it has. Undefined elsewhere, or when the
 * listing finds none.
 */
export async function cameraModeFor(platform: Platform, name: string): Promise<CameraMode | undefined> {
  if (platform !== 'macos') return undefined;
  const log = await listing(['-f', 'avfoundation', '-framerate', '30', '-video_size', '1x1', '-i', `${name}:none`]).catch(() => '');
  return pickCameraMode(log);
}

/**
 * Device names from `ffmpeg -f avfoundation -list_devices true -i ""`, which logs a heading per kind
 * and a line per device: `[AVFoundation indev @ 0x…] [0] FaceTime HD Camera`. The screens
 * ("Capture screen 0") are monitors, not cameras.
 */
export function parseAvfoundationDevices(log: string): { cameras: string[]; mics: string[] } {
  const cameras: string[] = [];
  const mics: string[] = [];
  let list: string[] | undefined;
  for (const line of log.split(/\r?\n/)) {
    if (/AVFoundation video devices:/.test(line)) list = cameras;
    else if (/AVFoundation audio devices:/.test(line)) list = mics;
    else {
      const name = /\] \[\d+\] (.+)$/.exec(line)?.[1]?.trim();
      if (name && list && !(list === cameras && /^Capture screen \d+$/.test(name))) list.push(name);
    }
  }
  return { cameras, mics };
}

/**
 * Device names from `ffmpeg -list_devices true -f dshow -i dummy`, which logs lines like
 * `[in#0 @ 0000…] "Microphone Array (AMD Audio Device)" (audio)` (each followed by an
 * "Alternative name" line).
 */
export function parseDshowDevices(log: string): { cameras: string[]; mics: string[] } {
  const cameras: string[] = [];
  const mics: string[] = [];
  for (const match of log.matchAll(/"([^"]+)" \(([^)]*)\)/g)) {
    const [, name, kinds] = match as unknown as [string, string, string];
    if (kinds.includes('video')) cameras.push(name);
    if (kinds.includes('audio')) mics.push(name);
  }
  return { cameras, mics };
}

/** ffmpeg's log for `args`. A listing ends with "Error opening input …" and a non-zero exit: that is expected. */
function listing(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new RecorderError('capture', `listing the cameras and microphones took more than ${LISTING_TIMEOUT_SECONDS} s`));
    }, LISTING_TIMEOUT_SECONDS * 1000);
    let log = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (log += chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(error.code === 'ENOENT' ? ffmpegMissing(error) : new RecorderError('capture', `listing the cameras and microphones failed: ${error.message}`, { cause: error }));
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(log);
    });
  });
}

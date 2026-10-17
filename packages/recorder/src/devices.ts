import { spawn } from 'node:child_process';
import { RecorderError } from './errors';
import { ffmpegMissing, ffmpegPath } from './ffmpeg';
import { TEST_DEVICES, platformFor, type Platform } from './sources';
import type { Backend, Devices, WindowInfo } from './types';

/** Seconds the DirectShow listing may take before it counts as hung. */
const LISTING_TIMEOUT_SECONDS = 10;

/** Monitors, windows, cameras and microphones the recorder can capture. */
export function listDevices(options: { backend?: Backend } = {}): Promise<Devices> {
  return devicesFor(platformFor(options.backend), true);
}

/**
 * The devices of a platform; cameras and mics only with `media` (the DirectShow listing starts an
 * ffmpeg, which a take without webcam and mic does not need).
 */
export async function devicesFor(platform: Platform, media: boolean): Promise<Devices> {
  if (platform === 'test') return structuredClone(TEST_DEVICES);
  const { loadWin32 } = await import('./win32');
  const win = await loadWin32();
  const { cameras, mics } = media ? parseDshowDevices(await dshowListing()) : { cameras: [], mics: [] };
  return { monitors: win.monitors(), windows: win.windows(), cameras, mics };
}

/** The windows now, for a window source that is resolved again when the countdown ends. */
export async function windowsFor(platform: Platform): Promise<WindowInfo[]> {
  if (platform === 'test') return structuredClone(TEST_DEVICES.windows);
  const { loadWin32 } = await import('./win32');
  return (await loadWin32()).windows();
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

/** The listing ends with "Error opening input file dummy" and a non-zero exit: that is expected. */
function dshowListing(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
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

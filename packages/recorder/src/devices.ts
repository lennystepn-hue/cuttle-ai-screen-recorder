import { spawn } from 'node:child_process';
import { ffmpegMissing, ffmpegPath } from './ffmpeg';
import { TEST_DEVICES, platformFor } from './sources';
import type { Backend, Devices } from './types';

/** Monitors, windows, cameras and microphones the recorder can capture. */
export async function listDevices(options: { backend?: Backend } = {}): Promise<Devices> {
  if (platformFor(options.backend) === 'test') return structuredClone(TEST_DEVICES);
  const { loadWin32 } = await import('./win32');
  const win = await loadWin32();
  const monitors = win.monitors();
  const { cameras, mics } = parseDshowDevices(await dshowListing());
  return { monitors, windows: win.windows(), cameras, mics };
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
    let log = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (log += chunk));
    child.on('error', (error: NodeJS.ErrnoException) => reject(error.code === 'ENOENT' ? ffmpegMissing(error) : error));
    child.on('close', () => resolve(log));
  });
}

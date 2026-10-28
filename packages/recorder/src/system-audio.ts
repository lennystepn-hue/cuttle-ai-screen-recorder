// What the computer plays, as a track of its own beside the mic: macOS through the capture helper's
// `audio` (ScreenCaptureKit), Windows through cuttle-loopback (WASAPI's loopback of the default output
// device), the test backend from a tone. Both helpers write 48 kHz stereo 32-bit float samples on
// stdout, silence where nothing played (so the samples keep time), and the wall clock of their first
// sample on stderr (`start <Unix seconds>`).
import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Feeder } from './ffmpeg';
import { captureHelperFor } from './mac-capture';
import type { Platform, ScreenArea } from './sources';

/** The helpers' sample rate. */
export const SYSTEM_RATE = 48_000;

/**
 * Where Windows' loopback helper is looked for: CUTTLE_LOOPBACK_HELPER (`chosen`: a path), next to
 * this bundle (the CLI's, the app's), or in the source tree (native/build-windows.mjs builds it there).
 */
export function loopbackHelper(chosen = process.env.CUTTLE_LOOPBACK_HELPER): string | undefined {
  if (chosen) return existsSync(chosen) ? chosen : undefined;
  const here = dirname(fileURLToPath(import.meta.url));
  // a packaged app runs its bundle from app.asar; executables are unpacked beside it
  const unpacked = (path: string) => path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);
  return [join(here, 'cuttle-loopback.exe'), join(here, '..', 'native', 'windows', 'cuttle-loopback.exe')].map(unpacked).find((file) => existsSync(file));
}

/**
 * The helper that records what the computer plays, or undefined where there is none (the take then
 * records without it). macOS: the display's sound without the processes in `hide` (Cuttle's own), or
 * for a window take the sound of the window's app alone. Windows: everything the default output
 * device plays.
 */
export function systemFeeder(platform: Platform, area: ScreenArea, hide: readonly number[]): Feeder | undefined {
  if (platform === 'macos') {
    const helper = captureHelperFor('audio');
    if (!helper) return undefined;
    const which = area.window !== undefined ? ['--window', String(area.window)] : hide.flatMap((pid) => ['--exclude-pid', String(pid)]);
    return { command: helper, args: ['audio', '--display', String(area.monitor.displayId ?? 0), ...which], stream: true, stamps: true };
  }
  if (platform === 'windows') {
    const helper = loopbackHelper();
    return helper ? { command: helper, args: [], stream: true, stamps: true } : undefined;
  }
  return undefined;
}

/** Why a take records no system audio here: the helper is missing. */
export function systemAudioMissing(platform: Platform): string {
  return platform === 'macos'
    ? "the computer's sound is not recorded: the capture helper is missing (it is built by pnpm install with Xcode's command line tools)"
    : "the computer's sound is not recorded: the loopback helper is missing (pnpm install builds it with the C# compiler of .NET Framework, which Windows has)";
}

/** ffmpeg's input for the system audio: the helper's samples on stdin, or the test backend's tone. */
export function systemInput(platform: Platform): string[] {
  if (platform === 'test') return ['-f', 'lavfi', '-i', `sine=frequency=880:sample_rate=${SYSTEM_RATE},arealtime`];
  return ['-f', 'f32le', '-ar', String(SYSTEM_RATE), '-ac', '2', '-i', 'pipe:0'];
}

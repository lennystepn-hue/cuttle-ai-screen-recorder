// The mic cleaned up for the video: low rumble cut, steady noise taken down, the loudness evened out
// to −16 LUFS, kept in step with the screen. The preview and the export both play it (when
// `look.audio.cleanup` is on), so they sound the same.
import { spawn } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';
import { CoreError } from '../errors';
import { ffmpegPath } from '../ffmpeg';
import { streamSeconds } from '../suggest/media';

/** The cleaned-up mic, next to the mic in the take's folder. */
export const CLEAN_MIC_FILE = 'mic.clean.m4a';
const RATE = 48_000;
const DENOISE = 'afftdn=nr=12:nf=-50:tn=1';

/** Runs ffmpeg and returns its raw stdout. */
function ffmpeg(args: readonly string[], signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-2000)));
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(error.code === 'ENOENT' ? new CoreError('ffmpeg-missing', `ffmpeg was not found (looked for "${ffmpegPath()}")`) : error),
    );
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new CoreError('cancelled', 'cancelled'));
      if (code === 0) return resolve(Buffer.concat(out));
      reject(new CoreError('invalid-media', `ffmpeg failed (exit code ${code}):\n${stderr.trim()}`));
    });
  });
}

let latency: Promise<number> | undefined;

/**
 * How many samples (at 48 kHz) the noise filter holds back: a click sent through it shows where it
 * comes out (1200, 25 ms, with ffmpeg 9). Measured once per process: another ffmpeg may differ.
 */
export function denoiseLatency(): Promise<number> {
  latency ??= ffmpeg(['-f', 'lavfi', '-i', `aevalsrc='if(eq(n,${RATE}),0.9,0)':s=${RATE}:d=2`, '-af', DENOISE, '-ac', '1', '-f', 's16le', '-']).then(
    (data) => {
      let peak = 0;
      let at = RATE;
      for (let i = 0; i + 1 < data.length; i += 2) {
        const value = Math.abs(data.readInt16LE(i));
        if (value > peak) [peak, at] = [value, i / 2];
      }
      return Math.max(0, at - RATE);
    },
    (error: unknown) => {
      latency = undefined;
      throw error;
    },
  );
  return latency;
}

/** The filter that cleans up a mic: the noise filter's delay taken out again, the length kept. */
export function cleanupFilter(delay: number): string {
  return [
    `aresample=${RATE}`,
    'highpass=f=80',
    DENOISE,
    ...(delay > 0 ? [`atrim=start_sample=${delay}`, 'asetpts=PTS-STARTPTS', `apad=pad_len=${delay}`] : []),
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    `aresample=${RATE}`,
  ].join(',');
}

/** Writes the cleaned-up `mic` to `out` (AAC, 48 kHz, as long as the mic: the loudness filter adds a tail), through `<out>.part`. */
export async function cleanMic(mic: string, out: string, signal?: AbortSignal): Promise<void> {
  const [delay, seconds] = await Promise.all([denoiseLatency(), streamSeconds(mic, 'a')]);
  const filter = cleanupFilter(delay);
  const part = `${out}.${process.pid}.part`;
  try {
    await ffmpeg(['-y', '-i', mic, '-map', '0:a:0', '-af', filter, '-ac', '1', '-ar', String(RATE), '-c:a', 'aac', '-b:a', '160k', ...(seconds > 0 ? ['-t', seconds.toFixed(3)] : []), '-f', 'mp4', part], signal);
    await rename(part, out);
  } catch (error) {
    await rm(part, { force: true }).catch(() => {});
    throw error;
  }
}

// What suggest needs from the screen track, read with ffmpeg.
import { CliError } from '../errors';
import { runFfmpeg } from '../ffmpeg';
import type { Span } from './spans';

export interface ScreenAnalysis {
  /** Length of the screen track in seconds. */
  duration: number;
  width: number;
  height: number;
  /** Where the picture did not change for at least `STILL_SECONDS` (a blinking caret does not count). */
  still: Span[];
}

/** Shortest unchanged stretch that counts as still. */
export const STILL_SECONDS = 0.5;

/** One pass over the screen track: its size, length and the stretches where nothing changed. */
export async function analyseScreen(path: string): Promise<ScreenAnalysis> {
  const { stderr } = await runFfmpeg([
    '-i', path, '-map', '0:v:0',
    '-vf', `scale=320:-2,format=gray,freezedetect=n=-60dB:d=${STILL_SECONDS}`,
    '-f', 'null', '-',
  ]);
  return parseAnalysis(stderr);
}

/** Reads the log of `analyseScreen`'s ffmpeg run. */
export function parseAnalysis(log: string): ScreenAnalysis {
  const size = /Stream #0:0[^\n]*Video: [^\n]*?(\d{2,5})x(\d{2,5})/.exec(log);
  const times = [...log.matchAll(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)];
  const last = times.at(-1);
  const duration = last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : 0;
  const still: Span[] = [];
  let open: number | undefined;
  for (const match of log.matchAll(/lavfi\.freezedetect\.freeze_(start|end): (\d+(?:\.\d+)?)/g)) {
    const at = Number(match[2]);
    if (match[1] === 'start') open = at;
    else if (open !== undefined) {
      still.push({ from: open, to: at });
      open = undefined;
    }
  }
  if (open !== undefined) still.push({ from: open, to: duration });
  return { duration, width: Number(size?.[1] ?? 0), height: Number(size?.[2] ?? 0), still };
}

/** Size and length of the screen track from a pass that copies its packets (fast: nothing is decoded). */
export async function probeScreen(path: string): Promise<{ duration: number; width: number; height: number }> {
  const { stderr } = await runFfmpeg(['-i', path, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
  const { duration, width, height } = parseAnalysis(stderr);
  return { duration, width, height };
}

/**
 * Seconds of the first video (`v`) or audio (`a`) stream of a file, read by copying its packets
 * (fast: nothing is decoded); 0 when the file has no such stream or nothing readable. A missing
 * ffmpeg is an error, not an empty file.
 */
export async function streamSeconds(path: string, stream: 'v' | 'a'): Promise<number> {
  try {
    const { stderr } = await runFfmpeg(['-i', path, '-map', `0:${stream}:0`, '-c', 'copy', '-f', 'null', '-']);
    const last = [...stderr.matchAll(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)].at(-1);
    return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : 0;
  } catch (error) {
    if (error instanceof CliError && error.code === 'ffmpeg-missing') throw error;
    return 0;
  }
}

/** A grey picture of the screen track at `t`, `width` pixels wide (for comparing two moments). */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

export async function grabGray(path: string, t: number, width: number): Promise<Gray> {
  const { stdout } = await runFfmpeg(['-ss', t.toFixed(3), '-i', path, '-frames:v', '1', '-vf', `scale=${width}:-2,format=gray`, '-f', 'rawvideo', '-']);
  return { width, height: Math.floor(stdout.length / width), data: new Uint8Array(stdout) };
}

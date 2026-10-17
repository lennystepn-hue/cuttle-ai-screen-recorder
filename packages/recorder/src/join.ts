// Joining the segments of a paused take into its tracks. The screen's are copied end to end by the
// concat demuxer (lossless), or re-encoded when a segment's size changed (a display mode change).
// The mic's and the webcam's are lined up with their screen segment one by one: each starts as far
// after its screen segment as it did when recorded and lasts exactly as long, so the tracks stay
// in sync however many pauses there were (AAC joined as it is drifts ~23 ms per pause).
import { spawn } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Segment } from '@cuttle/project';
import { VIDEO_CODEC } from './args';
import { RecorderError } from './errors';
import { ffmpegMissing, ffmpegPath } from './ffmpeg';

/**
 * A rename that waits a moment when Windows holds the file (a virus scanner on a file just written,
 * a reader): tried again for about half a second, so a pause or a join does not fail on it.
 */
export function renameWhenFree(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      return renameSync(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * attempt);
    }
  }
}

const AUDIO_RATE = 48_000;
const FPS = 30;

/** The concat demuxer's list file: one line per file, single quotes escaped. */
export function concatList(files: readonly string[]): string {
  return files.map((file) => `file '${file.replaceAll('\\', '/').replaceAll("'", "'\\''")}'\n`).join('');
}

/** The screen's segments copied end to end into `out` (all the same size). */
export function screenCopyArgs(list: string, out: string): string[] {
  return ['-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0', '-c', 'copy', '-movflags', '+faststart', '-y', out];
}

/** The screen's segments re-encoded to the first one's size (a segment's size changed while paused). */
export function screenEncodeArgs(files: readonly string[], size: { width: number; height: number }, out: string): string[] {
  const { width, height } = size;
  const chains = files.map((_, k) => `[${k}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[v${k}]`);
  const graph = `${chains.join(';')};${files.map((_, k) => `[v${k}]`).join('')}concat=n=${files.length}:v=1:a=0[out]`;
  return [...files.flatMap((file) => ['-i', file]), '-filter_complex', graph, '-map', '[out]', ...VIDEO_CODEC, '-movflags', '+faststart', '-y', out];
}

const seconds = (value: number) => value.toFixed(6);

/**
 * A track's segments lined up with the screen's, by the stamps in segments.json (the time of each
 * first frame or sample). A segment where the track did not start is silent (black for video).
 */
export function alignedArgs(track: 'mic' | 'webcam', segments: readonly Segment[], dir: string, size: { width: number; height: number } | undefined, out: string): string[] {
  const inputs: string[] = [];
  const chains: string[] = [];
  segments.forEach((segment, k) => {
    const duration = segment.duration ?? 0;
    const entry = segment[track];
    if (!entry) {
      chains.push(
        track === 'mic'
          ? `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=duration=${seconds(duration)}[s${k}]`
          : `color=c=black:s=${size!.width}x${size!.height}:r=${FPS},trim=duration=${seconds(duration)},format=yuv420p[s${k}]`,
      );
      return;
    }
    const input = inputs.length / 2;
    inputs.push('-i', join(dir, entry.file));
    // how much later than its screen segment the track started (negative: earlier)
    const delay = entry.start - segment.screen.start;
    if (track === 'mic') {
      const head = delay < 0 ? `atrim=start=${seconds(-delay)},asetpts=PTS-STARTPTS` : `adelay=${Math.round(delay * AUDIO_RATE)}S:all=1`;
      chains.push(
        `[${input}:a]aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:sample_rates=${AUDIO_RATE}:channel_layouts=stereo,${head},apad,atrim=duration=${seconds(duration)},asetpts=PTS-STARTPTS[s${k}]`,
      );
    } else {
      const head = delay < 0 ? `trim=start=${seconds(-delay)},setpts=PTS-STARTPTS` : `tpad=start_duration=${seconds(delay)}:start_mode=clone`;
      chains.push(
        `[${input}:v]fps=${FPS},scale=${size!.width}:${size!.height},setsar=1,${head},tpad=stop=-1:stop_mode=clone,trim=duration=${seconds(duration)},setpts=PTS-STARTPTS,format=yuv420p[s${k}]`,
      );
    }
  });
  const kind = track === 'mic' ? 'v=0:a=1' : 'v=1:a=0';
  const graph = `${chains.join(';')};${segments.map((_, k) => `[s${k}]`).join('')}concat=n=${segments.length}:${kind}[out]`;
  const codec = track === 'mic' ? ['-c:a', 'aac', '-b:a', '160k'] : VIDEO_CODEC;
  return [...inputs, '-filter_complex', graph, '-map', '[out]', ...codec, '-movflags', '+faststart', '-y', out];
}

/** Output kept from ffmpeg (its size and stream lines come first, its progress last). */
const OUTPUT_LIMIT = 4 * 1024 * 1024;

/** Runs ffmpeg to the end and resolves with its output; rejects with the end of it. */
export function runFfmpeg(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < OUTPUT_LIMIT) stderr += chunk;
    });
    child.on('error', (error: NodeJS.ErrnoException) => reject(error.code === 'ENOENT' ? ffmpegMissing(error) : error));
    child.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new RecorderError('capture', `ffmpeg failed (exit code ${code}): ${stderr.trim().split('\n').slice(-6).join('\n')}`));
    });
  });
}

/** A video or audio file's length (to ffmpeg's 10 ms) and, for video, its size. */
export async function mediaInfo(file: string, stream: 'v' | 'a'): Promise<{ seconds: number; width?: number; height?: number }> {
  const stderr = await runFfmpeg(['-i', file, '-map', `0:${stream}:0`, '-c', 'copy', '-f', 'null', '-']);
  const time = [...stderr.matchAll(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)].at(-1);
  const size = stream === 'v' ? /Stream #0:\d+[^\n]*Video:[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(stderr) : null;
  return {
    seconds: time ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : 0,
    ...(size && { width: Number(size[1]), height: Number(size[2]) }),
  };
}

/**
 * Joins the segments of the take in `dir` into `files` (the take's track names), each through a
 * `.joining` file renamed into place when it is complete. Returns the tracks that were joined.
 */
export async function joinSegments(dir: string, segments: readonly Segment[], files: { screen: string; webcam: string; mic: string }): Promise<{ webcam: boolean; mic: boolean }> {
  const screens = segments.map((segment) => join(dir, segment.screen.file));
  const sizes = await Promise.all(screens.map((file) => mediaInfo(file, 'v')));
  const first = { width: sizes[0]?.width ?? 0, height: sizes[0]?.height ?? 0 };
  const temp = (file: string) => join(dir, `${file}.joining.${file.endsWith('.m4a') ? 'm4a' : 'mp4'}`);
  const same = sizes.every((size) => size.width === first.width && size.height === first.height);
  if (same) {
    const list = join(dir, 'segments.txt');
    writeFileSync(list, concatList(screens));
    await runFfmpeg(screenCopyArgs(list, temp(files.screen)));
  } else {
    await runFfmpeg(screenEncodeArgs(screens, first, temp(files.screen)));
  }
  renameWhenFree(temp(files.screen), join(dir, files.screen));
  const has = { webcam: segments.some((segment) => segment.webcam), mic: segments.some((segment) => segment.mic) };
  if (has.mic) {
    await runFfmpeg(alignedArgs('mic', segments, dir, undefined, temp(files.mic)));
    renameWhenFree(temp(files.mic), join(dir, files.mic));
  }
  if (has.webcam) {
    const firstCamera = segments.find((segment) => segment.webcam)!.webcam!;
    const camera = await mediaInfo(join(dir, firstCamera.file), 'v');
    await runFfmpeg(alignedArgs('webcam', segments, dir, { width: camera.width ?? 640, height: camera.height ?? 480 }, temp(files.webcam)));
    renameWhenFree(temp(files.webcam), join(dir, files.webcam));
  }
  return has;
}

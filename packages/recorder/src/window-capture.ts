// A window by itself on Windows: ffmpeg's gfxcapture (Windows.Graphics.Capture, in ffmpeg 8 and
// newer) takes the window wherever it is and whatever lies over it. It sends a frame only when the
// window changes, and an ffmpeg that waits for one does not stop on "q". So a second ffmpeg reads
// the window (the feeder), and the recorder writes its newest frame into the take's ffmpeg 30 times
// a second (`frameBytes` in ffmpeg.ts), as the macOS helper does. The test backend's windows go the
// same way, with a test pattern as the window.
import { spawn } from 'node:child_process';
import { FRAME_RATE } from './args';
import { ffmpegPath } from './ffmpeg';
import type { Feeder } from './ffmpeg';

const known = new Map<string, Promise<boolean>>();

/** Whether this ffmpeg has gfxcapture (asked once per ffmpeg; false when it cannot be asked). */
export function hasWindowCapture(ffmpeg = ffmpegPath()): Promise<boolean> {
  let answer = known.get(ffmpeg);
  if (!answer) {
    answer = new Promise<boolean>((resolve) => {
      const child = spawn(ffmpeg, ['-hide_banner', '-h', 'filter=gfxcapture'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      let help = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => (help += chunk));
      child.on('error', () => resolve(false));
      child.on('close', () => resolve(help.includes('gfxcapture AVOptions')));
    });
    known.set(ffmpeg, answer);
  }
  return answer;
}

/**
 * The feeder of a window take: the window `id` (an HWND) with its frame (`capture_border`, the
 * bounds the window list gives) at `size` (even: the right and bottom are cut), the pointer only
 * with `drawMouse`, without the yellow border Windows draws round a captured window where it can
 * leave it out (Windows 11). Raw BGRA frames on stdout, one each time the window changes.
 */
export function windowFeeder(id: number, size: { width: number; height: number }, drawMouse: boolean): Feeder {
  const source = `gfxcapture=hwnd=${id}:capture_cursor=${drawMouse ? 1 : 0}:capture_border=1:display_border=0:max_framerate=${FRAME_RATE}:width=${size.width}:height=${size.height}`;
  return { command: ffmpegPath(), args: feederArgs(`${source},hwdownload,format=bgra`), frameBytes: size.width * size.height * 4 };
}

/**
 * The test backend's window: a test pattern at 10 frames a second (a window changes now and then).
 * It closes after CUTTLE_TEST_WINDOW_CLOSES seconds when that is set.
 */
export function testWindowFeeder(size: { width: number; height: number }): Feeder {
  const closes = Number(process.env.CUTTLE_TEST_WINDOW_CLOSES);
  const end = closes > 0 ? `:d=${closes}` : '';
  return { command: ffmpegPath(), args: feederArgs(`testsrc2=s=${size.width}x${size.height}:r=10${end},realtime,format=bgra`), frameBytes: size.width * size.height * 4 };
}

/** Frames as they come (`passthrough`: never repeated or dropped to a rate), raw on stdout. */
const feederArgs = (graph: string) => ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', graph, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'];

/**
 * The take's ffmpeg input for the frames the recorder writes on its stdin. The time base is a
 * microsecond, as the wall clock stamps each frame when ffmpeg reads it.
 */
export function relayInput(size: { width: number; height: number }): string[] {
  return ['-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', `${size.width}x${size.height}`, '-framerate', '1000000', '-i', 'pipe:0'];
}

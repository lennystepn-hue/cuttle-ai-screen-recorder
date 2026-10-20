// A take whose page scrolls, for the tests of masks that follow it: a page taller than the screen,
// moved up by `scrolledAt(t)` under a header that stays, written as the recorder writes a take
// (30 fps, H.264 at its quality, a key frame every 2 s, BT.709).
import { spawn } from 'node:child_process';
import { ffmpegPath } from '../src/ffmpeg';

export const SCROLL_TAKE = { width: 1280, height: 720, header: 40, rate: 30, seconds: 6.5 };

const ease = (x: number) => 1 - (1 - x) ** 3;
const both = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
const part = (t: number, from: number, length: number) => Math.max(0, Math.min(1, (t - from) / length));

/**
 * How far the page is scrolled at `t` (px): six wheel notches down from 0.5 s (100 px each, eased
 * over 0.2 s, 0.25 s apart), still, down 250 px and back up 240 within half a second from 3.5 s,
 * still, a flick of 700 px from 5 s to 5.7 s, still. A line at 991 px on the page comes in at the
 * bottom with the third notch, goes up and back between two reads, and goes out under the header in
 * the flick, between two reads.
 */
export function scrolledAt(t: number): number {
  let y = 0;
  for (let k = 0; k < 6; k++) y += 100 * ease(part(t, 0.5 + 0.25 * k, 0.2));
  y += 250 * both(part(t, 3.5, 0.25)) - 240 * both(part(t, 3.75, 0.25));
  y += 700 * both(part(t, 5, 0.7));
  return Math.round(y);
}

/** Writes the take of `page` (grey, a byte a pixel, `SCROLL_TAKE.width` wide) to `file`. */
export async function writeScrollTake(file: string, page: { height: number; data: Uint8Array }): Promise<void> {
  const { width, height, header, rate, seconds } = SCROLL_TAKE;
  const ffmpeg = spawn(ffmpegPath(), ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${width}x${height}`, '-r', String(rate), '-i', '-', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-force_key_frames', 'expr:gte(t,n_forced*2)', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-y', file], { stdio: ['pipe', 'ignore', 'pipe'] });
  let errors = '';
  ffmpeg.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
  const done = new Promise<void>((resolve, reject) => ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${errors}`)))));
  for (let n = 0; n < seconds * rate; n++) {
    const top = scrolledAt(n / rate);
    const frame = Buffer.alloc(width * height, 0x33);
    for (let y = header; y < height && y + top < page.height; y++) frame.set(page.data.subarray((y + top) * width, (y + top + 1) * width), y * width);
    if (!ffmpeg.stdin.write(frame)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
  }
  ffmpeg.stdin.end();
  await done;
}

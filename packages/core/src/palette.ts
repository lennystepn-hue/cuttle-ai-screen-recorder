// The colours of a product, read off its screen recording or its logo: a few clear colours for a
// background (`cuttle background --from`, the Look tab's "From the take" and "From the logo").
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { CoreError } from './errors';
import { runFfmpeg } from './ffmpeg';
import { streamSeconds } from './suggest/media';

export const PALETTE_RULES = {
  /** Frames read from a take, spread over it, and the width each is read at. */
  frames: 8,
  width: 96,
  /** How far apart two chosen colours are at least (RGB distance, of 441). */
  apart: 70,
} as const;

type Rgb = [number, number, number];

const hex = (color: Rgb) => `#${color.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const luminance = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Up to `count` colours of RGBA pixels (alpha under 128 left out), dark to light: the clearest ones
 * the picture has much of (a colour weighs by how much of it there is and how strong it is, so the
 * accents of a grey interface win over its greys), each far enough from the others; at least two
 * (a picture of one colour gives it and a darker shade of it). Hex, upper case.
 */
export function paletteOf(rgba: Uint8Array, count = 4): string[] {
  // a histogram of 16 levels a channel, with each bin's mean colour
  const bins = new Map<number, { count: number; sum: Rgb }>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue;
    const [r, g, b] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { count: 0, sum: [0, 0, 0] };
    bin.count++;
    bin.sum[0] += r;
    bin.sum[1] += g;
    bin.sum[2] += b;
    bins.set(key, bin);
  }
  const colours = [...bins.values()].map((bin) => {
    const color: Rgb = [bin.sum[0] / bin.count, bin.sum[1] / bin.count, bin.sum[2] / bin.count];
    const chroma = (Math.max(...color) - Math.min(...color)) / 255;
    const light = (Math.max(...color) + Math.min(...color)) / 510;
    // near white or near black counts for less: a background wants colour
    const tone = light > 0.92 || light < 0.06 ? 0.25 : 1;
    return { color, count: bin.count, weight: bin.count * (0.08 + chroma) ** 2 * tone };
  });
  const chosen: Rgb[] = [];
  const take = (ordered: typeof colours, apart: number) => {
    for (const { color } of ordered) {
      if (chosen.length >= count) return;
      if (chosen.every((other) => distance(color, other) >= apart)) chosen.push(color);
    }
  };
  take([...colours].sort((a, b) => b.weight - a.weight), PALETTE_RULES.apart);
  // a picture of greys: its most common tones
  if (chosen.length < 2) take([...colours].sort((a, b) => b.count - a.count), 40);
  if (chosen.length === 0) throw new CoreError('invalid-media', 'the picture has no visible pixels to take colours from');
  if (chosen.length === 1) chosen.push(chosen[0]!.map((value) => value * 0.45) as Rgb);
  return chosen.sort((a, b) => luminance(a) - luminance(b)).map(hex);
}

/** The colours a take's screen shows, from frames spread over it. */
export async function takePalette(screen: string): Promise<string[]> {
  const seconds = await streamSeconds(screen, 'v');
  const { width, frames } = PALETTE_RULES;
  const sample = seconds > 0 ? ['-vf', `fps=${(frames / seconds).toFixed(6)},scale=${width}:-2`] : ['-frames:v', '1', '-vf', `scale=${width}:-2`];
  const { stdout } = await runFfmpeg(['-i', screen, ...sample, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-']);
  return paletteOf(new Uint8Array(stdout));
}

/** The colours of an image (a logo): its pixels, or, for an SVG, the colours it is written with. */
export async function imagePalette(path: string): Promise<string[]> {
  if (extname(path).toLowerCase() === '.svg') {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      throw new CoreError('missing-file', `cannot read ${path}: ${(error as Error).message}`, { cause: error });
    }
    // each colour it names, as a pixel (#rgb and #rrggbb)
    const pixels: number[] = [];
    for (const [, value] of text.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      const full = value!.length === 3 ? [...value!].map((digit) => digit + digit).join('') : value!;
      pixels.push(Number.parseInt(full.slice(0, 2), 16), Number.parseInt(full.slice(2, 4), 16), Number.parseInt(full.slice(4, 6), 16), 255);
    }
    if (pixels.length === 0) throw new CoreError('invalid-media', `${path} names no colours (#rrggbb) to take`);
    return paletteOf(new Uint8Array(pixels));
  }
  const { stdout } = await runFfmpeg(['-i', path, '-frames:v', '1', '-vf', `scale=${PALETTE_RULES.width}:-2`, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-']);
  return paletteOf(new Uint8Array(stdout));
}

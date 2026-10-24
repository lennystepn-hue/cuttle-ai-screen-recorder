import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { Rect, ScreenTextLine, ShotMask } from '@cuttle/project';
import { brandFields, brandsDir, findBrand } from './brands';
import { CoreError } from './errors';
import { keepInProject } from './keep-file';
import { MASK_RULES } from './privacy/masks';
import { ScreenReader } from './privacy/ocr';
import { SECRET_LABELS, lineSecrets } from './privacy/patterns';

/**
 * A new screenshot's folder in `parent`, named by the local time as a screenshot is
 * (`2026-10-24 19.42.10`), with a number after it when that one is taken.
 */
export function newShotFolder(parent: string, now = new Date()): string {
  const two = (value: number) => String(value).padStart(2, '0');
  const name = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}.${two(now.getMinutes())}.${two(now.getSeconds())}`;
  for (let n = 1; ; n++) {
    const folder = join(parent, n === 1 ? name : `${name} ${n}`);
    if (!existsSync(folder)) return folder;
  }
}

/**
 * A screenshot's pixels per point from its PNG's resolution (pHYs): a Mac writes 144 dpi from a Retina
 * display; 72 and 96 dpi are 1. Undefined for another image or one that says nothing.
 */
export function pngScale(bytes: Uint8Array): number | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || signature.some((value, i) => bytes[i] !== value)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'pHYs' && length >= 9 && at + 17 <= bytes.length) {
      // pixels per metre, the unit 1 (metres); 0: an aspect ratio only
      if (bytes[at + 16] !== 1) return undefined;
      const dpi = view.getUint32(at + 8) * 0.0254;
      return dpi > 100 ? Math.min(4, Math.max(1, Math.round((dpi / 72) * 4) / 4)) : 1;
    }
    if (type === 'IDAT' || type === 'IEND') return undefined;
    at += 12 + length;
  }
  return undefined;
}

/** A PNG's, JPEG's or WebP's width and height, read from its header; undefined for another file. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  if (bytes.length >= 24 && bytes[0] === 0x89 && text(1, 3) === 'PNG') return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const chunk = text(12, 4);
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const [b0, b1, b2, b3] = [bytes[21]!, bytes[22]!, bytes[23]!, bytes[24]!];
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
    if (chunk === 'VP8X') return { width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)), height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) };
    return undefined;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // the frame header (SOF0 to SOF15, not DHT, JPG or DAC) says the size
    for (let at = 2; at + 9 < bytes.length; ) {
      if (bytes[at] !== 0xff) return undefined;
      const marker = bytes[at + 1]!;
      const length = view.getUint16(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      at += 2 + length;
    }
  }
  return undefined;
}

/**
 * The private things a screenshot's text shows (email addresses, keys and tokens, IBANs, card and
 * phone numbers, random-looking strings, and `words`), as masks over them: filled, a little larger
 * than the words, inside the image.
 */
export function secretMasks(lines: readonly ScreenTextLine[], size: { width: number; height: number }, words: readonly string[] = []): ShotMask[] {
  const pad = MASK_RULES.pad;
  return lines.flatMap((line) =>
    lineSecrets(line, words).map((secret): ShotMask => {
      const [x, y, w, h] = secret.rect;
      const left = Math.max(0, Math.floor(x - pad));
      const top = Math.max(0, Math.floor(y - pad));
      const rect: Rect = [left, top, Math.min(size.width, Math.ceil(x + w + pad)) - left, Math.min(size.height, Math.ceil(y + h + pad)) - top];
      return { rect, style: 'fill', auto: 'privacy', label: SECRET_LABELS[secret.kind] };
    }),
  );
}

/** Reads a screenshot's text on this computer (Windows' OCR, macOS's Vision) and masks what is private in it (`secretMasks`). */
export async function redactShot(image: string, size: { width: number; height: number }, words: readonly string[] = []): Promise<ShotMask[]> {
  const reader = await ScreenReader.start();
  try {
    return secretMasks(await reader.read(image, size.width, size.height), size, words);
  } finally {
    reader.close();
  }
}

/** What a brand kit sets on a screenshot: its background, its frame's style, its heading font, and its logo (or its name) as the watermark, its files copied into the shot's folder. */
export async function shotBrand(name: string, folder: string, root = brandsDir()): Promise<{ background: Record<string, unknown>; frame: { style: string }; font: string; watermark?: Record<string, unknown> }> {
  const brand = await findBrand(name, root);
  const fields = await brandFields(brand, folder);
  const watermark = fields.theme.logo ? { image: fields.theme.logo } : fields.theme.name ? { text: fields.theme.name } : undefined;
  return { background: { ...fields.background }, frame: { ...fields.frame }, font: fields.theme.font, ...(watermark && { watermark }) };
}

/** What of a shot is its look (a style keeps it, the next shot takes it): not its image, its crop, its masks or its headline's words. */
const NOT_LOOK = new Set(['version', 'source', 'scale', 'crop', 'masks', 'headline']);

/** A shot's look: its fields that are not its own picture's. */
export function shotLook(raw: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !NOT_LOOK.has(key)));
}

/** The file of the screenshot styles: beside the brand kits' folder (`CUTTLE_SHOT_STYLES` when set). */
export function shotStylesFile(): string {
  return process.env.CUTTLE_SHOT_STYLES || join(dirname(brandsDir()), 'shot-styles.json');
}

/** The saved screenshot styles, by name. */
export async function listShotStyles(file = shotStylesFile()): Promise<Record<string, Record<string, unknown>>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as { styles?: Record<string, Record<string, unknown>> };
    return parsed.styles && typeof parsed.styles === 'object' ? parsed.styles : {};
  } catch (error) {
    throw new CoreError('invalid-project', `${file} is not JSON: ${(error as Error).message}`, { cause: error });
  }
}

/** A saved style's look, or a `missing-file` naming the styles there are. */
export async function findShotStyle(name: string, file = shotStylesFile()): Promise<Record<string, unknown>> {
  const styles = await listShotStyles(file);
  const style = styles[name];
  if (style) return style;
  const names = Object.keys(styles);
  throw new CoreError('missing-file', `no screenshot style "${name}"${names.length > 0 ? ` (${names.join(', ')})` : ': save one first'}`);
}

/** The images a look names (a background's, a watermark's), each through `change`. */
function withImages(look: Record<string, unknown>, change: (image: string) => string | undefined): Record<string, unknown> {
  const next = structuredClone(look);
  for (const key of ['background', 'watermark'] as const) {
    const part = next[key] as Record<string, unknown> | undefined;
    if (!part || typeof part.image !== 'string') continue;
    const image = change(part.image);
    if (image === undefined) delete part.image;
    else part.image = image;
  }
  return next;
}

/** A shot's look to keep apart from it (a style, the next shot's): the images it names as full paths (`folder`: the shot's, which relative ones are in). */
export function lookFrom(raw: Readonly<Record<string, unknown>>, folder?: string): Record<string, unknown> {
  return withImages(shotLook(raw), (image) => (isAbsolute(image) || !folder ? image : resolve(folder, image)));
}

/**
 * A kept look for a shot in `folder`: the images it names copied into the folder (`images/`), as
 * paths from there; one that is gone is left out (the background then is the default one, the
 * watermark its text, or none).
 */
export async function lookInto(look: Readonly<Record<string, unknown>>, folder: string): Promise<Record<string, unknown>> {
  const copies = new Map<string, string>();
  for (const key of ['background', 'watermark'] as const) {
    const image = (look[key] as Record<string, unknown> | undefined)?.image;
    if (typeof image !== 'string' || !isAbsolute(image) || !existsSync(image) || copies.has(image)) continue;
    copies.set(image, await keepInProject(folder, await readFile(image), 'images', basename(image, extname(image)).replace(/[^\w.-]+/g, '-') || 'image', extname(image).toLowerCase()));
  }
  const next = withImages(look, (image) => (isAbsolute(image) ? copies.get(image) : image));
  const background = next.background as Record<string, unknown> | undefined;
  if (background?.preset === 'image' && background.image === undefined) delete next.background;
  const watermark = next.watermark as Record<string, unknown> | undefined;
  if (watermark && watermark.image === undefined && watermark.text === undefined) delete next.watermark;
  return next;
}

/** Saves a shot's look as a style (one of that name is replaced), or removes it (`look` undefined), its images as `lookFrom` keeps them. */
export async function saveShotStyle(name: string, look: Record<string, unknown> | undefined, file = shotStylesFile(), folder?: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > 80) throw new CoreError('usage', 'a style needs a name of 1 to 80 characters');
  const styles = await listShotStyles(file);
  if (look) styles[trimmed] = lookFrom(look, folder);
  else if (!(trimmed in styles)) throw new CoreError('missing-file', `no screenshot style "${trimmed}"`);
  else delete styles[trimmed];
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ version: 1, styles }, null, 2)}\n`);
  await rename(temp, file);
}

/** A style's look for a shot in `folder`, as `lookInto` gives it. */
export async function shotStyleFor(name: string, folder: string, file = shotStylesFile()): Promise<Record<string, unknown>> {
  return lookInto(await findShotStyle(name, file), folder);
}

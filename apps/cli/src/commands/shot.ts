import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { imagePalette, keepInProject, newShotFolder, pngScale, wallpaperFile } from '@cuttle/core';
import { BACKGROUND_PRESETS, FRAME_STYLES, SHOT_FILE, SHOT_VERSION, isColouredBackground, parseShot, parseShotJson, shotRatio, switchBackground, type BackgroundPreset, type Shot } from '@cuttle/project';
import { listDevices, takeShot, type Backend } from '@cuttle/recorder';
import { runInElectron } from '../electron-runner';
import { CliError } from '../errors';
import type { Output } from '../output';
import { captureSource, type RecordArgs } from './record';

/** How soft a wallpaper is made when nothing says otherwise: it sits behind the shot. */
const WALLPAPER_BLUR = 0.6;
/** The images a shot is made from, and written as. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export interface ShotFrameArgs {
  background?: string;
  colors?: string;
  from?: string;
  angle?: number;
  radial?: boolean;
  linear?: boolean;
  color?: string;
  image?: string;
  wallpaper?: boolean;
  blur?: number;
  dim?: number;
  transparent?: boolean;
  frame?: string;
  title?: string;
  radius?: number;
  shadow?: boolean;
  padding?: number;
  size?: string;
  crop?: string;
  shotScale?: number;
  scale?: number;
  quality?: number;
  out?: string;
  save?: string;
}

export interface ShotFrameResult {
  /** The image written. */
  file: string;
  format: string;
  width: number;
  height: number;
  /** Output px per point it was drawn at. */
  scale: number;
  /** The shot's folder (shot.json, its image, shot.png), when it has one: to draw it again with other settings. */
  shot?: string;
}

const isFile = (path: string) => stat(path).then((info) => info.isFile(), () => false);
const isDirectory = (path: string) => stat(path).then((info) => info.isDirectory(), () => false);

/** `--size`: auto, a ratio (16:9) or pixels (1200x630). */
function sizeOf(size: string): Shot['size'] {
  if (size === 'auto' || shotRatio(size) !== undefined) return size;
  const pixels = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size);
  if (pixels) return { width: Number(pixels[1]), height: Number(pixels[2]) };
  throw new CliError('usage', `--size ${size}: auto, a ratio like 16:9, or pixels like 1200x630`);
}

/** `--crop x,y,w,h` in image pixels. */
function cropOf(crop: string): [number, number, number, number] {
  const values = crop.split(',').map((value) => Number(value.trim()));
  if (values.length !== 4 || !values.every((value) => Number.isFinite(value)) || values[2]! <= 0 || values[3]! <= 0) {
    throw new CliError('usage', `--crop ${crop}: x,y,w,h in the image's pixels, w and h more than 0`);
  }
  return values as [number, number, number, number];
}

/**
 * The desktop's wallpaper as a background image: kept in the shot's folder when it has one, else
 * used where it is.
 */
async function wallpaper(folder: string | undefined): Promise<string> {
  const file = await wallpaperFile();
  if (!file) throw new CliError('missing-file', 'no wallpaper was found on this computer: choose an image instead (--image)');
  const ext = extname(file).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(ext)) throw new CliError('invalid-media', `the wallpaper (${file}) is not a JPEG, PNG or WebP image: choose an image instead (--image)`);
  return folder ? keepInProject(folder, await readFile(file), 'images', 'wallpaper', ext) : file;
}

/** An image the shot refers to: kept in its folder (a path from there) when it has one, else where it is (absolute). */
async function imageFor(folder: string | undefined, given: string, stem: string): Promise<string> {
  const path = resolve(given);
  if (!(await isFile(path))) throw new CliError('missing-file', `no image at ${given}`);
  if (!folder) return path;
  return keepInProject(folder, await readFile(path), 'images', stem, extname(path).toLowerCase());
}

/** Where `cuttle shot take` keeps its shots: CUTTLE_SHOTS_DIR, else Cuttle in the pictures folder. */
export function shotsFolder(): string {
  return process.env.CUTTLE_SHOTS_DIR || join(homedir(), 'Pictures', 'Cuttle');
}

export interface ShotTakeArgs extends ShotFrameArgs, Pick<RecordArgs, 'monitor' | 'region' | 'window'> {
  /** Seconds to wait before the shot. */
  delay?: number;
  /** With the pointer. */
  cursor?: boolean;
  /** The picture alone, not framed. */
  raw?: boolean;
  backend?: Backend;
}

export interface ShotTakeResult extends ShotFrameResult {
  /** The picture as taken (`source.png` in the shot's folder). */
  source: string;
  /** A window's shot: its title. */
  window?: string;
  warnings?: string[];
}

/**
 * `cuttle shot take`: a screenshot of the primary monitor, another one (`--monitor`), a region of it
 * or a window, kept as a shot's folder (in Cuttle in the pictures folder, or `--save`) and framed
 * with the options `shot frame` takes (`--raw`: not framed).
 */
export async function shotTakeCommand(args: ShotTakeArgs, output: Output, signal: AbortSignal): Promise<ShotTakeResult> {
  const backend = args.backend ?? 'auto';
  const devices = await listDevices({ backend, media: false });
  const primary = devices.monitors.find((monitor) => monitor.primary)?.index ?? devices.monitors[0]?.index ?? 0;
  const source = captureSource(args, primary);
  const folder = args.save ? resolve(args.save) : newShotFolder(shotsFolder());
  if (existsSync(join(folder, SHOT_FILE))) throw new CliError('usage', `${folder} holds a shot already: name another folder`);
  if (args.delay) {
    output.info(`taking the shot in ${args.delay} s …`);
    await sleep(args.delay * 1000, undefined, { signal }).catch(() => {
      throw new CliError('cancelled', 'the shot was cancelled');
    });
  }
  await mkdir(folder, { recursive: true });
  const taken = await takeShot({ source, out: join(folder, 'source.png'), backend, devices, ...(args.cursor && { cursor: true }) });
  for (const warning of taken.warnings) output.warn(warning);
  const raw = { version: SHOT_VERSION, source: 'source.png', ...(taken.scale !== 1 && { scale: taken.scale }) };
  await writeFile(join(folder, SHOT_FILE), `${JSON.stringify(raw, null, 2)}\n`);
  const about = { source: taken.file, ...(taken.window !== undefined && { window: taken.window }), ...(taken.warnings.length > 0 && { warnings: taken.warnings }) };
  const result: ShotTakeResult = args.raw
    ? { file: taken.file, format: 'png', width: taken.width, height: taken.height, scale: taken.scale, shot: folder, ...about }
    : { ...(await frameShot(folder, { ...args, save: undefined }, output, signal)), ...about };
  output.result(result, () => [`${result.file}  ${result.width}×${result.height} px (${result.scale}× a point)${taken.window ? `: ${taken.window}` : ''}`, `shot  ${folder} (frame it again with "cuttle shot frame")`].join('\n'));
  return result;
}

/**
 * `cuttle shot frame <image | shot folder>`: a screenshot framed as the videos are, written as a
 * PNG, JPEG or WebP. From an image, its options make the shot (`--save` keeps it as a folder); from a
 * shot's folder (`shot.json`), they change it and it is drawn again into its `shot.png`. The image
 * keeps its pixels: the frame, the padding and the shadow are drawn at its own scale (from a PNG's
 * resolution, else 1, or `--shot-scale`).
 */
export async function shotFrameCommand(target: string, args: ShotFrameArgs, output: Output, signal: AbortSignal): Promise<ShotFrameResult> {
  const result = await frameShot(target, args, output, signal);
  output.result(result, () => [`${result.file}  ${result.width}×${result.height} px (${result.scale}× a point)`, ...(result.shot ? [`shot  ${result.shot} (frame it again with other options)`] : [])].join('\n'));
  return result;
}

/** Frames an image or a shot's folder (see `shotFrameCommand`); says nothing but its progress. */
async function frameShot(target: string, args: ShotFrameArgs, output: Output, signal: AbortSignal): Promise<ShotFrameResult> {
  if (args.background !== undefined && !(BACKGROUND_PRESETS as readonly string[]).includes(args.background)) {
    throw new CliError('usage', `no background "${args.background}" (${BACKGROUND_PRESETS.join(', ')})`);
  }
  if (args.frame !== undefined && !(FRAME_STYLES as readonly string[]).includes(args.frame)) throw new CliError('usage', `no frame "${args.frame}" (${FRAME_STYLES.join(', ')})`);
  if (args.radial && args.linear) throw new CliError('usage', '--radial and --linear together');
  if (args.image && args.wallpaper) throw new CliError('usage', '--image and --wallpaper together');
  if (args.colors && args.from) throw new CliError('usage', '--colors and --from together');
  const given = resolve(target);
  const fromFolder = await isDirectory(given);
  if (fromFolder && args.save) throw new CliError('usage', '--save makes a shot folder from an image; this is one already');
  let raw: Record<string, unknown>;
  /** The image (absolute), and the folder the shot keeps its files in, when it has one. */
  let source: string;
  let folder: string | undefined;
  if (fromFolder) {
    folder = given;
    const file = join(folder, SHOT_FILE);
    const text = await readFile(file, 'utf8').catch(() => {
      throw new CliError('missing-file', `${given} has no ${SHOT_FILE}: name an image, or a shot's folder`);
    });
    const parsed = parseShotJson(text);
    if (!parsed.ok) throw new CliError('invalid-project', `${file}: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    // changed as written, so what it leaves out stays left out
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>;
    source = isAbsolute(parsed.shot.source) ? parsed.shot.source : join(folder, parsed.shot.source);
  } else {
    if (!(await isFile(given))) throw new CliError('missing-file', `no image or shot folder at ${target}`);
    if (!IMAGE_EXTENSIONS.includes(extname(given).toLowerCase())) throw new CliError('usage', `${basename(given)} is not a PNG, JPEG or WebP image`);
    source = given;
    raw = { version: SHOT_VERSION, source: given };
    const scale = pngScale(await readFile(given));
    if (scale !== undefined && scale !== 1) raw.scale = scale;
    if (args.save) {
      // the folder holds its own copy of the image, and everything the shot refers to
      folder = resolve(args.save);
      if (await isFile(join(folder, SHOT_FILE))) throw new CliError('usage', `${folder} holds a shot already: frame that folder instead`);
      await mkdir(folder, { recursive: true });
      const name = `source${extname(given).toLowerCase()}`;
      await copyFile(given, join(folder, name));
      raw.source = name;
    }
  }

  // the background, as `cuttle background` changes a project's
  const current = (raw.background && typeof raw.background === 'object' ? raw.background : { preset: 'sunset-sky' }) as Record<string, unknown>;
  const preset = (args.background ??
    (args.image || args.wallpaper ? 'image' : args.color ? 'solid' : (args.colors || args.from) && !isColouredBackground(current.preset as BackgroundPreset) ? 'gradient' : current.preset)) as BackgroundPreset;
  const background = switchBackground(current, preset);
  if (args.color !== undefined) background.color = args.color;
  if (args.colors !== undefined) background.colors = args.colors.split(',').map((color) => color.trim());
  if (args.from !== undefined) {
    const from = args.from === 'shot' ? source : resolve(args.from);
    if (!(await isFile(from))) throw new CliError('missing-file', `--from ${args.from}: not "shot" or an image file`);
    background.colors = await imagePalette(from);
  }
  if (args.angle !== undefined) background.angle = args.angle;
  if (args.radial) background.kind = 'radial';
  if (args.linear) delete background.kind;
  if (args.image !== undefined) background.image = await imageFor(folder, args.image, basename(args.image, extname(args.image)).replace(/[^\w.-]+/g, '-') || 'background');
  if (args.wallpaper) {
    background.image = await wallpaper(folder);
    background.blur ??= WALLPAPER_BLUR;
  }
  if (args.blur !== undefined) background.blur = args.blur;
  if (args.dim !== undefined) background.dim = args.dim;
  raw.background = background;

  const frame = { ...(raw.frame && typeof raw.frame === 'object' ? (raw.frame as Record<string, unknown>) : {}) };
  if (args.frame !== undefined) frame.style = args.frame;
  if (args.title !== undefined) frame.title = args.title;
  if (args.radius !== undefined) frame.radius = args.radius;
  if (args.shadow !== undefined) frame.shadow = args.shadow;
  if (Object.keys(frame).length > 0) raw.frame = frame;
  if (args.transparent !== undefined) raw.transparent = args.transparent;
  if (args.padding !== undefined) raw.padding = args.padding;
  if (args.size !== undefined) raw.size = sizeOf(args.size);
  if (args.crop !== undefined) raw.crop = cropOf(args.crop);
  if (args.shotScale !== undefined) raw.scale = args.shotScale;
  const parsed = parseShot(raw);
  if (!parsed.ok) throw new CliError('usage', parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));

  const out = args.out ? resolve(args.out) : folder ? join(folder, 'shot.png') : join(dirname(given), `${basename(given, extname(given))}-framed.png`);
  if (resolve(out) === resolve(source)) throw new CliError('usage', `-o ${args.out}: that is the shot's own image`);
  const format = extname(out).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(format)) throw new CliError('usage', `-o ${args.out}: name the image .png, .jpg or .webp`);
  if (parsed.shot.transparent && (format === '.jpg' || format === '.jpeg')) throw new CliError('usage', 'a JPEG has no transparency: write the transparent shot as .png or .webp, or give --no-transparent');
  output.info(`framing ${basename(source)} …`);
  const drawn = await runInElectron<{ file: string; format: string; width: number; height: number; scale: number }>(
    { command: 'shot', shot: parsed.shot, dir: folder ?? dirname(source), out, quiet: true, ...(args.scale !== undefined && { scale: args.scale }), ...(args.quality !== undefined && { quality: args.quality }) },
    signal,
  );
  // the shot changes only once it is drawn
  if (folder) await writeFile(join(folder, SHOT_FILE), `${JSON.stringify(raw, null, 2)}\n`);
  return { file: drawn.file, format: drawn.format, width: drawn.width, height: drawn.height, scale: Math.round(drawn.scale * 1000) / 1000, ...(folder && { shot: folder }) };
}

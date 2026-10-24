import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { Shot } from '@cuttle/project';
import { app } from 'electron';
import { ExportError } from '../errors';
import { CHANNELS, type PageShotSuccess, type ShotFormat, type ShotJob } from '../job';
import { cancelledError, defaultPageDir, runPage, watchdog, whenCancelled } from './export';
import { FileHost } from './files';
import { renameWhenFree } from './stills';
import { openExportWindow, type ExportWindow } from './window';

export interface ShotOptions {
  shot: Shot;
  /** The shot's folder: its `source` and a background `image` given as relative paths are found there. */
  dir: string;
  /** The image to write; replaced when it exists, only once the shot is drawn. */
  out: string;
  /** Default: from `out`'s extension (.png, .jpg or .jpeg, .webp). */
  format?: ShotFormat;
  /** Output px per point; default the shot's own scale (the image pixel for pixel). */
  scale?: number;
  /** JPEG's and WebP's quality, 0 to 1 (default the browser's, 0.92 for a JPEG). */
  quality?: number;
  /** Folder of the export page bundle; defaults to `export-page` next to the bundle that contains this code. */
  pageDir?: string;
  /** Cancels: the window closes and `renderShot` rejects with `cancelled`. */
  signal?: AbortSignal;
}

export interface ShotResult {
  file: string;
  format: ShotFormat;
  width: number;
  height: number;
  /** Output px per point it was drawn at. */
  scale: number;
  stats: { gpu: string; totalMs: number };
}

/** The format an image's file name asks for, or undefined. */
export function shotFormatOf(path: string): ShotFormat | undefined {
  const extension = extname(path).toLowerCase();
  return extension === '.png' ? 'png' : extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : extension === '.webp' ? 'webp' : undefined;
}

/** An image the export page may send back no larger than this. */
const MAX_IMAGE_BYTES = 512 * 1024 * 1024;

/**
 * Draws a shot (`shot.json`) with the export's engine into a PNG, JPEG or WebP: its frame, its
 * background and its shadow as the videos have them, the image pixel for pixel at the shot's own
 * scale. Runs in Electron's main process, like `renderStills`.
 */
export async function renderShot(opts: ShotOptions): Promise<ShotResult> {
  const started = performance.now();
  const out = resolve(opts.out);
  const format = opts.format ?? shotFormatOf(out);
  if (!format) throw new ExportError('invalid-project', `cannot tell the image's format from ${basename(out)}: name it .png, .jpg or .webp`);
  if (format === 'jpeg' && opts.shot.transparent) throw new ExportError('invalid-project', 'a JPEG has no transparency: write the transparent shot as .png or .webp');
  if (opts.scale !== undefined && !(opts.scale > 0 && opts.scale <= 8)) throw new ExportError('invalid-project', 'the scale must be more than 0 and at most 8');
  if (opts.quality !== undefined && !(opts.quality >= 0 && opts.quality <= 1)) throw new ExportError('invalid-project', 'the quality must be 0 to 1');
  const inShot = (path: string) => (isAbsolute(path) ? path : join(resolve(opts.dir), path));
  const source = inShot(opts.shot.source);
  if (!existsSync(source)) throw new ExportError('missing-file', `the shot's image is missing: ${source}`);
  const background = opts.shot.background.preset === 'image' && opts.shot.background.image ? inShot(opts.shot.background.image) : undefined;
  if (background && !opts.shot.transparent && !existsSync(background)) throw new ExportError('missing-file', `the background image is missing: ${background}`);
  const watermark = opts.shot.watermark?.image ? inShot(opts.shot.watermark.image) : undefined;
  if (watermark && !existsSync(watermark)) throw new ExportError('missing-file', `the watermark's image is missing: ${watermark}`);
  await app.whenReady();
  if (opts.signal?.aborted) throw cancelledError();
  const job: ShotJob = {
    kind: 'shot',
    shot: opts.shot,
    source,
    ...(background && !opts.shot.transparent && { backgroundImage: background }),
    ...(watermark && { watermarkImage: watermark }),
    ...(opts.scale !== undefined && { scale: opts.scale }),
    format,
    ...(opts.quality !== undefined && { quality: opts.quality }),
  };
  // written beside the image and moved over it once whole, so a failed run leaves the old one
  const work = join(dirname(out), `.${basename(out)}.cuttle-${process.pid}.tmp`);
  const cancel = whenCancelled(opts.signal);
  const guard = watchdog();
  const host = new FileHost([], join(dirname(out), '.unused'), [source, ...[job.backgroundImage, job.watermarkImage].filter((path): path is string => path !== undefined)]);
  let window: ExportWindow | undefined;
  let written = false;
  try {
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    const ipc = window.win.webContents.ipc;
    ipc.handle(CHANNELS.job, () => job);
    ipc.handle(CHANNELS.size, (_event, path: string) => host.size(path));
    ipc.handle(CHANNELS.read, (_event, path: string, start: number, end: number) => host.read(path, start, end));
    ipc.handle(CHANNELS.readFile, (_event, path: string) => {
      guard.alive();
      return host.readFile(path);
    });
    ipc.handle(CHANNELS.write, () => {
      throw new Error('a shot job writes no video');
    });
    ipc.handle(CHANNELS.writeStill, async (_event, key: string, data: Uint8Array) => {
      if (key !== 'shot' || !(data instanceof Uint8Array) || data.byteLength > MAX_IMAGE_BYTES) throw new Error(`the export page sent an unexpected image "${key}"`);
      guard.alive();
      await writeFile(work, data);
      written = true;
    });
    const page = await runPage<PageShotSuccess>(window, guard.stalled, cancel.promise);
    if (opts.signal?.aborted) throw cancelledError();
    if (!written) throw new ExportError('render', 'the export page drew the shot but sent no image');
    await renameWhenFree(work, out);
    return { file: out, format, width: page.width, height: page.height, scale: page.scale, stats: { gpu: page.gpu, totalMs: Math.round(performance.now() - started) } };
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('render', error instanceof Error ? error.message : String(error), { cause: error });
  } finally {
    guard.stop();
    cancel.dispose();
    if (window && !window.win.isDestroyed()) window.win.destroy();
    await host.close();
    await rm(work, { force: true }).catch(() => {});
  }
}

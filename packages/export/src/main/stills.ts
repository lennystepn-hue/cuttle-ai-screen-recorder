import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CuttleProject } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import { app } from 'electron';
import { ExportError } from '../errors';
import { withFormat, type ExportFormat } from '../formats';
import { CHANNELS, type PageStillsSuccess, type StillsJob } from '../job';
import { cancelledError, defaultPageDir, runPage, watchdog, whenCancelled } from './export';
import { FileHost } from './files';
import { MotionHost, serveMotion, type MotionItemReport } from './motion-host';
import { placeNarration } from './narration';
import { loadSources, motionPages, motionTake } from './sources';
import { openExportWindow, type ExportWindow } from './window';

export interface StillsOptions {
  projectDir: string;
  /** Output preset; without one the project's `output` size is used. */
  format?: ExportFormat;
  /** Output seconds to render; a time past the end shows the last frame. */
  times: number[];
  /**
   * Folder for the PNGs (created when missing; files with the same names are replaced). They are
   * rendered into a work folder inside it and moved there only when every still is done, so a
   * cancelled or failed run adds nothing.
   */
  outDir: string;
  /** Also removes stills of earlier runs from `outDir` (`NN-<t>s.png` and `sheet.png`), for a folder that holds only stills. */
  clean?: boolean;
  /** Also writes `sheet.png`: every still, smaller, in a grid with its time (default 4 columns). */
  sheet?: { columns?: number };
  /** Called after each rendered frame. */
  onProgress?: (done: number, total: number) => void;
  /** Folder of the export page bundle; defaults to `export-page` next to the bundle that contains this code. */
  pageDir?: string;
  /** Cancels: the window closes and `renderStills` rejects with `cancelled`. */
  signal?: AbortSignal;
  /** Renders another version of the project (its folder's files): `cuttle motion check` shows one page as a scene. */
  project?: (project: CuttleProject) => CuttleProject;
}

export interface StillsResult {
  /**
   * One PNG per time, in the order of `times`, with the source second it shows (`source`: the frame's
   * most visible clip; absent on a still or card scene), for placing masks, zooms and texts.
   */
  stills: { t: number; file: string; source?: number }[];
  sheet?: string;
  /** The output size (each still's size). */
  width: number;
  height: number;
  /** What the motion items' pages said (errors and console), when the project has any. */
  motion?: MotionItemReport[];
  stats: { gpu: string; totalMs: number };
}

const DEFAULT_SHEET_COLUMNS = 4;
/** A PNG the page sends may not be larger than this. */
const MAX_PNG_BYTES = 256 * 1024 * 1024;

/** File name of the still for `times[n]`, e.g. `01-12.50s.png`. */
export function stillName(n: number, t: number): string {
  return `${String(n + 1).padStart(2, '0')}-${t.toFixed(2)}s.png`;
}

const SHEET_NAME = 'sheet.png';
/** Names `stillName` gives; `clean` removes only these and the sheet. */
const STILL_FILE = /^\d{2,}-\d+\.\d{2}s\.png$/;
/** A run's work folder inside `outDir`, named after its process. */
const WORK_FOLDER = /^\.cuttle-stills-(\d+)$/;

/**
 * Renders single output frames of a project to PNGs with the export's engine and decoders (for
 * checking a project without exporting it), optionally with a contact sheet. Runs in Electron's
 * main process, like `exportProject`.
 */
export async function renderStills(opts: StillsOptions): Promise<StillsResult> {
  const started = performance.now();
  if (opts.times.length === 0 || !opts.times.every((t) => Number.isFinite(t) && t >= 0)) {
    throw new ExportError('invalid-project', 'stills need at least one time, each 0 or more seconds');
  }
  await app.whenReady();
  const outDir = resolve(opts.outDir);
  const sources = await loadSources(resolve(opts.projectDir), { narration: 'spoken' });
  for (const warning of sources.warnings) console.warn(`warning: ${warning}`);
  if (opts.signal?.aborted) throw cancelledError();
  const project = withFormat(opts.project ? opts.project(sources.project) : sources.project, opts.format);
  const motionFiles = opts.project ? await motionPages(resolve(opts.projectDir), project) : sources.motion;
  const take = motionFiles ? (sources.motionTake ?? (await motionTake(resolve(opts.projectDir), project))) : undefined;
  const columns = opts.sheet ? Math.max(1, Math.round(opts.sheet.columns ?? DEFAULT_SHEET_COLUMNS)) : undefined;
  // the narration's words, for the captions the stills show
  const narration = sources.narration ? placeNarration(project, sceneSpans(project.scenes, project.cuts), sources.narration) : undefined;
  const job: StillsJob = {
    kind: 'stills',
    project,
    ...(sources.screen && { screen: sources.screen }),
    webcam: sources.webcam,
    events: sources.events,
    ...(sources.shortcuts && { shortcuts: sources.shortcuts }),
    ...(sources.transcript && { transcript: sources.transcript }),
    ...(narration && narration.words.length > 0 && { narration: narration.words }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    watermarkImage: sources.watermarkImage,
    ...(motionFiles && { motion: motionFiles }),
    times: opts.times,
    ...(columns !== undefined && { sheet: { columns } }),
  };
  // The page writes into a work folder; the PNGs move to outDir only when every one is done.
  const work = join(outDir, `.cuttle-stills-${process.pid}`);
  try {
    await mkdir(work, { recursive: true });
  } catch (error) {
    throw new ExportError('invalid-project', `cannot create the folder ${outDir}: ${(error as Error).message}`, { cause: error });
  }
  const names = new Map(opts.times.map((t, n) => [`still-${n}`, stillName(n, t)]));
  if (columns !== undefined) names.set('sheet', SHEET_NAME);

  const cancel = whenCancelled(opts.signal);
  const guard = watchdog();
  const images = [...Object.values(sources.stills), ...[sources.backgroundImage, sources.watermarkImage].filter((path): path is string => path !== undefined)];
  // Reads only: stills mode writes PNGs through writeStill, never into a video file.
  const host = new FileHost([...(sources.screen ? [sources.screen] : []), ...(sources.webcam ? [sources.webcam.path] : [])], join(outDir, '.unused'), images);
  let window: ExportWindow | undefined;
  const motion = motionFiles && take ? new MotionHost(project, motionFiles, take) : undefined;
  try {
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    const ipc = window.win.webContents.ipc;
    ipc.handle(CHANNELS.job, () => job);
    ipc.handle(CHANNELS.size, (_event, path: string) => host.size(path));
    ipc.handle(CHANNELS.read, (_event, path: string, start: number, end: number) => {
      guard.alive();
      return host.read(path, start, end);
    });
    ipc.handle(CHANNELS.readFile, (_event, path: string) => host.readFile(path));
    ipc.handle(CHANNELS.write, () => {
      throw new Error('a stills job writes no video');
    });
    ipc.handle(CHANNELS.writeStill, async (_event, key: string, data: Uint8Array) => {
      const name = names.get(key);
      if (name === undefined || !(data instanceof Uint8Array) || data.byteLength > MAX_PNG_BYTES) {
        throw new Error(`the export page sent an unexpected still "${key}"`);
      }
      guard.alive();
      await writeFile(join(work, name), data);
    });
    ipc.on(CHANNELS.progress, (_event, done: number, total: number) => {
      guard.progress(done);
      opts.onProgress?.(done, total);
    });
    serveMotion(ipc, motion, guard.alive);
    const page = await runPage<PageStillsSuccess>(window, guard.stalled, cancel.promise);
    if (opts.signal?.aborted) throw cancelledError();
    const said = await motion?.close();
    await publish(work, outDir, [...names.values()], opts.clean ?? false);
    return {
      stills: opts.times.map((t, n) => {
        const source = page.sources[n];
        return { t, file: join(outDir, names.get(`still-${n}`)!), ...(typeof source === 'number' && { source }) };
      }),
      ...(columns !== undefined && { sheet: join(outDir, SHEET_NAME) }),
      width: page.width,
      height: page.height,
      ...(said && { motion: said }),
      stats: { gpu: page.gpu, totalMs: Math.round(performance.now() - started) },
    };
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('render', error instanceof Error ? error.message : String(error), { cause: error });
  } finally {
    guard.stop();
    cancel.dispose();
    await motion?.close().catch(() => {});
    if (window && !window.win.isDestroyed()) window.win.destroy();
    await host.close();
    // A folder that cannot be removed now must not replace the result or the real error.
    await rm(work, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

/**
 * Moves the finished PNGs from the work folder into `outDir`. With `clean`, older stills there go
 * first, and so do work folders a killed run left behind (their process no longer exists).
 */
async function publish(work: string, outDir: string, names: string[], clean: boolean): Promise<void> {
  if (clean) {
    for (const name of await readdir(outDir)) {
      const stale = WORK_FOLDER.exec(name);
      if (STILL_FILE.test(name) || name === SHEET_NAME || (stale && !running(Number(stale[1])))) {
        await rm(join(outDir, name), { recursive: true, force: true, maxRetries: 3 });
      }
    }
  }
  for (const name of names) await renameWhenFree(join(work, name), join(outDir, name));
}

/** Whether a process with this id runs (signal 0 only checks). */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'; // it exists, but belongs to someone else
  }
}

/** A rename that waits a moment for a file another program holds (a virus scanner, a viewer). */
async function renameWhenFree(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      await new Promise((done) => setTimeout(done, 100 * attempt));
    }
  }
}

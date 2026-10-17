import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import { ExportError } from '../errors';
import { withFormat, type ExportFormat } from '../formats';
import { CHANNELS, type PageStillsSuccess, type StillsJob } from '../job';
import { cancelledError, defaultPageDir, runPage, watchdog, whenCancelled } from './export';
import { FileHost } from './files';
import { loadSources } from './sources';
import { openExportWindow, type ExportWindow } from './window';

export interface StillsOptions {
  projectDir: string;
  /** Output preset; without one the project's `output` size is used. */
  format?: ExportFormat;
  /** Output seconds to render; a time past the end shows the last frame. */
  times: number[];
  /** Folder for the PNGs (created when missing; files with the same names are replaced). */
  outDir: string;
  /** Also writes `sheet.png`: every still, smaller, in a grid with its time (default 4 columns). */
  sheet?: { columns?: number };
  /** Called after each rendered frame. */
  onProgress?: (done: number, total: number) => void;
  /** Folder of the export page bundle; defaults to `export-page` next to the bundle that contains this code. */
  pageDir?: string;
  /** Cancels: the window closes and `renderStills` rejects with `cancelled`. */
  signal?: AbortSignal;
}

export interface StillsResult {
  /** One PNG per time, in the order of `times`. */
  stills: { t: number; file: string }[];
  sheet?: string;
  /** The output size (each still's size). */
  width: number;
  height: number;
  stats: { gpu: string; totalMs: number };
}

const DEFAULT_SHEET_COLUMNS = 4;
/** A PNG the page sends may not be larger than this. */
const MAX_PNG_BYTES = 256 * 1024 * 1024;

/** File name of the still for `times[n]`, e.g. `01-12.50s.png`. */
export function stillName(n: number, t: number): string {
  return `${String(n + 1).padStart(2, '0')}-${t.toFixed(2)}s.png`;
}

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
  const sources = await loadSources(resolve(opts.projectDir));
  for (const warning of sources.warnings) console.warn(`warning: ${warning}`);
  if (opts.signal?.aborted) throw cancelledError();
  const project = withFormat(sources.project, opts.format);
  const columns = opts.sheet ? Math.max(1, Math.round(opts.sheet.columns ?? DEFAULT_SHEET_COLUMNS)) : undefined;
  const job: StillsJob = {
    kind: 'stills',
    project,
    screen: sources.screen,
    webcam: sources.webcam,
    events: sources.events,
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    times: opts.times,
    ...(columns !== undefined && { sheet: { columns } }),
  };
  try {
    await mkdir(outDir, { recursive: true });
  } catch (error) {
    throw new ExportError('invalid-project', `cannot create the folder ${outDir}: ${(error as Error).message}`, { cause: error });
  }
  const files = new Map(opts.times.map((t, n) => [`still-${n}`, join(outDir, stillName(n, t))]));
  if (columns !== undefined) files.set('sheet', join(outDir, 'sheet.png'));

  const cancel = whenCancelled(opts.signal);
  const guard = watchdog();
  const images = [...Object.values(sources.stills), ...(sources.backgroundImage ? [sources.backgroundImage] : [])];
  // Reads only: stills mode writes PNGs through writeStill, never into a video file.
  const host = new FileHost([sources.screen, ...(sources.webcam ? [sources.webcam.path] : [])], join(outDir, '.unused'), images);
  let window: ExportWindow | undefined;
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
    ipc.handle(CHANNELS.writeStill, async (_event, name: string, data: Uint8Array) => {
      const file = files.get(name);
      if (file === undefined || !(data instanceof Uint8Array) || data.byteLength > MAX_PNG_BYTES) {
        throw new Error(`the export page sent an unexpected still "${name}"`);
      }
      guard.alive();
      await writeFile(file, data);
    });
    ipc.on(CHANNELS.progress, (_event, done: number, total: number) => {
      guard.progress(done);
      opts.onProgress?.(done, total);
    });
    const page = await runPage<PageStillsSuccess>(window, guard.stalled, cancel.promise);
    return {
      stills: opts.times.map((t, n) => ({ t, file: files.get(`still-${n}`)! })),
      ...(columns !== undefined && { sheet: files.get('sheet')! }),
      width: page.width,
      height: page.height,
      stats: { gpu: page.gpu, totalMs: Math.round(performance.now() - started) },
    };
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('render', error instanceof Error ? error.message : String(error), { cause: error });
  } finally {
    guard.stop();
    cancel.dispose();
    if (window && !window.win.isDestroyed()) window.win.destroy();
    await host.close();
  }
}

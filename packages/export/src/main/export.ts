import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sceneSpans } from '@cuttle/timeline';
import { app } from 'electron';
import { INLINE_GRAPH_LIMIT, audioFilterGraph, muxArgs, planAudio } from '../audio';
import { ExportError } from '../errors';
import { withFormat, type ExportFormat } from '../formats';
import { CHANNELS, type EncoderPreference, type ExportJob, type PageResult, type PageSuccess } from '../job';
import { checkFfmpeg, runFfmpeg } from './ffmpeg';
import { FileHost } from './files';
import { loadSources, samePath } from './sources';
import { openExportWindow, type ExportWindow } from './window';

export interface ExportOptions {
  projectDir: string;
  /** Output preset; without one the project's `output` size is used (its default is 16:9 1920×1080). */
  format?: ExportFormat;
  /** Target file. Written only when the export succeeded (a temp file next to it is renamed). */
  out: string;
  /** Called after each rendered frame. */
  onProgress?: (done: number, total: number) => void;
  /** H.264 encoder: hardware when available (`auto`, the default), or one of them forced. */
  encoder?: EncoderPreference;
  /** Folder of the export page bundle; defaults to `export-page` next to the bundle that contains this code. */
  pageDir?: string;
  /** Cancels the export: the window closes, ffmpeg stops, nothing reaches `out`; rejects with `cancelled`. */
  signal?: AbortSignal;
}

export interface ExportStats {
  gpu: string;
  codec: string;
  hardwareAcceleration: PageSuccess['hardwareAcceleration'];
  bitrate: number;
  page: PageSuccess['timings'];
  audioMs: number;
  totalMs: number;
}

export interface ExportResult {
  out: string;
  frames: number;
  /** Length of the exported video in seconds (frames / fps). */
  seconds: number;
  stats: ExportStats;
}

/** Without a newly rendered frame for this long the export counts as stalled (a hung encoder or decoder). */
const STALL_SECONDS = 60;
/** Leftovers of exports that were killed before they could clean up are removed after this long. */
const STALE_HOURS = 24;
/** Prefix of an export's work folder in the system's temp folder. */
const WORK_PREFIX = 'cuttle-export-';

function defaultPageDir(): string {
  return fileURLToPath(new URL('./export-page/', import.meta.url));
}

const cancelledError = (): ExportError => new ExportError('cancelled', 'the export was cancelled');

/** A promise that rejects with `cancelled` when `signal` aborts; `dispose` removes the listener. */
function whenCancelled(signal: AbortSignal | undefined): { promise: Promise<never>; dispose(): void } {
  if (!signal) return { promise: new Promise<never>(() => {}), dispose() {} };
  let onAbort = (): void => {};
  const promise = new Promise<never>((_, reject) => {
    onAbort = () => reject(cancelledError());
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  promise.catch(() => {});
  return { promise, dispose: () => signal.removeEventListener('abort', onAbort) };
}

/**
 * Rejects when the page shows no sign of life for `STALL_SECONDS` (a hung encoder never reports an
 * error). Rendered frames and file reads and writes count: a long decode before a scene's first frame
 * keeps reading. A tick far later than its second means the computer slept, which is no stall.
 */
function watchdog(): { progress(done: number): void; alive(): void; stalled: Promise<never>; stop(): void } {
  let last = performance.now();
  let tick = last;
  let frame = 0;
  let fail = (_error: Error): void => {};
  const stalled = new Promise<never>((_, reject) => (fail = reject));
  stalled.catch(() => {});
  const timer = setInterval(() => {
    const now = performance.now();
    if (now - tick > 5000) last = now; // slept
    tick = now;
    if (now - last > STALL_SECONDS * 1000) {
      fail(new ExportError('render', `the export stalled: no progress for ${STALL_SECONDS} s (after frame ${frame})`));
    }
  }, 1000);
  return {
    progress(done) {
      last = performance.now();
      frame = done;
    },
    alive() {
      last = performance.now();
    },
    stalled,
    stop: () => clearInterval(timer),
  };
}

async function runPage(window: ExportWindow, ...failures: Promise<never>[]): Promise<PageSuccess> {
  let result: PageResult;
  try {
    result = await Promise.race([
      window.win.webContents.executeJavaScript('window.cuttleExport.run()') as Promise<PageResult>,
      window.gone,
      ...failures,
    ]);
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('render', error instanceof Error ? error.message : String(error), { cause: error });
  }
  if (!result.ok) throw new ExportError(result.code, result.message);
  return result;
}

/** Refuses an output path that is one of the files the export reads: the rename would replace it. */
async function checkOutput(out: string, inputs: readonly string[]): Promise<void> {
  const same = inputs.find((input) => samePath(input, out));
  if (same) throw new ExportError('invalid-project', `the output ${out} is one of the project's files; choose another output path`);
  const target = await stat(out, { bigint: true }).catch(() => undefined);
  if (!target) return;
  if (target.isDirectory()) throw new ExportError('invalid-project', `the output ${out} is a folder; name a file`);
  // Another name for an input (a hard link, a symlink, a short 8.3 name) is the same file on disk.
  for (const input of inputs) {
    const info = await stat(input, { bigint: true }).catch(() => undefined);
    if (info && info.dev === target.dev && info.ino === target.ino) {
      throw new ExportError('invalid-project', `the output ${out} is the same file as ${input}; choose another output path`);
    }
  }
}

/** A mic that ffmpeg cannot read fails here (exit 1), not after minutes of rendering. */
async function checkMic(path: string, signal: AbortSignal | undefined): Promise<void> {
  try {
    await runFfmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-i', path, '-map', '0:a:0', '-frames:a', '1', '-f', 'null', '-'], signal);
  } catch (error) {
    if (error instanceof ExportError && error.code !== 'render') throw error;
    throw new ExportError('invalid-media', `mic recording (sources.mic) has no readable audio: ${path}\n${(error as Error).message}`, {
      cause: error,
    });
  }
}

/** Removes work folders and partial outputs of exports that were killed before they could clean up. */
async function sweepStale(out: string): Promise<void> {
  const cutoff = Date.now() - STALE_HOURS * 3_600_000;
  const sweep = async (folder: string, matches: (name: string) => boolean): Promise<void> => {
    const names = await readdir(folder).catch(() => [] as string[]);
    await Promise.all(
      names.filter(matches).map(async (name) => {
        const path = join(folder, name);
        const info = await stat(path).catch(() => undefined);
        if (info && info.mtimeMs < cutoff) await rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
      }),
    );
  };
  await sweep(tmpdir(), (name) => name.startsWith(WORK_PREFIX));
  await sweep(dirname(out), (name) => name.startsWith(`.${basename(out)}.`) && name.endsWith('.partial'));
}

/**
 * Renders a project to an MP4 (H.264 High + AAC 48 kHz) in a hidden window: decode, render with the
 * engine, encode, mux; then ffmpeg cuts the mic to the scenes and adds it. Runs in Electron's main
 * process. Partial output never reaches `out`, and `out` may not be one of the project's files.
 */
export async function exportProject(opts: ExportOptions): Promise<ExportResult> {
  const started = performance.now();
  const { signal } = opts;
  const throwIfCancelled = (): void => {
    if (signal?.aborted) throw cancelledError();
  };
  await app.whenReady();
  const projectDir = resolve(opts.projectDir);
  const out = resolve(opts.out);
  const sources = await loadSources(projectDir);
  for (const warning of sources.warnings) console.warn(`warning: ${warning}`);
  await checkOutput(out, sources.inputs);
  await checkFfmpeg();
  if (sources.mic) await checkMic(sources.mic.path, signal);
  throwIfCancelled();
  await sweepStale(out);
  const project = withFormat(sources.project, opts.format);
  const job: ExportJob = {
    project,
    screen: sources.screen,
    webcam: sources.webcam,
    events: sources.events,
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    encoder: opts.encoder ?? 'auto',
  };
  try {
    await mkdir(dirname(out), { recursive: true });
  } catch (error) {
    throw new ExportError('invalid-project', `cannot create the output folder ${dirname(out)}: ${(error as Error).message}`, { cause: error });
  }

  const partial = join(dirname(out), `.${basename(out)}.${randomUUID().slice(0, 8)}.partial`);
  const cancel = whenCancelled(signal);
  const guard = watchdog();
  let work: string | undefined;
  let files: FileHost | undefined;
  let window: ExportWindow | undefined;
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const video = join(work, 'video.mp4');
    const images = [...Object.values(sources.stills), ...(sources.backgroundImage ? [sources.backgroundImage] : [])];
    const host = new FileHost([sources.screen, ...(sources.webcam ? [sources.webcam.path] : [])], video, images);
    files = host;
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    throwIfCancelled();
    const ipc = window.win.webContents.ipc;
    ipc.handle(CHANNELS.job, () => job);
    ipc.handle(CHANNELS.size, (_event, path: string) => host.size(path));
    ipc.handle(CHANNELS.read, (_event, path: string, start: number, end: number) => {
      guard.alive();
      return host.read(path, start, end);
    });
    ipc.handle(CHANNELS.readFile, (_event, path: string) => host.readFile(path));
    ipc.handle(CHANNELS.write, (_event, data: Uint8Array, position: number) => {
      guard.alive();
      return host.write(data, position);
    });
    ipc.on(CHANNELS.progress, (_event, done: number, total: number) => {
      guard.progress(done);
      opts.onProgress?.(done, total);
    });

    const page = await runPage(window, guard.stalled, cancel.promise);
    guard.stop();
    // The window stays open until the end: closing an app's last window quits it by default.
    await host.close(); // flushes the video-only MP4 before ffmpeg reads it

    const audioStarted = performance.now();
    const seconds = page.frames / project.output.fps;
    const segments = planAudio({ spans: sceneSpans(project.scenes), look: project.look, mic: sources.mic !== undefined, seconds });
    const usesMic = segments.some((segment) => segment.mic !== undefined);
    const graph = audioFilterGraph(segments, sources.mic?.offset ?? 0);
    const graphFile = graph.length > INLINE_GRAPH_LIMIT ? join(work, 'audio.graph') : undefined;
    if (graphFile) await writeFile(graphFile, graph);
    await runFfmpeg(muxArgs({ video, mic: usesMic ? sources.mic?.path : undefined, graph, graphFile, out: partial }), signal);
    throwIfCancelled();
    try {
      await rename(partial, out);
    } catch (error) {
      throw new ExportError('render', `could not replace ${out} (is it open in a player?): ${(error as Error).message}`, { cause: error });
    }
    return {
      out,
      frames: page.frames,
      seconds,
      stats: {
        gpu: page.gpu,
        codec: page.codec,
        hardwareAcceleration: page.hardwareAcceleration,
        bitrate: page.bitrate,
        page: page.timings,
        audioMs: Math.round(performance.now() - audioStarted),
        totalMs: Math.round(performance.now() - started),
      },
    };
  } catch (error) {
    await rm(partial, { force: true, maxRetries: 3 }).catch(() => {});
    if (error instanceof ExportError) throw error;
    throw new ExportError('render', error instanceof Error ? error.message : String(error), { cause: error });
  } finally {
    guard.stop();
    cancel.dispose();
    if (window && !window.win.isDestroyed()) window.win.destroy();
    await files?.close();
    if (work) {
      const folder = work;
      await rm(folder, { recursive: true, force: true, maxRetries: 3 }).catch((error: Error) =>
        console.error(`could not remove the export's work folder ${folder}: ${error.message}`),
      );
    }
  }
}

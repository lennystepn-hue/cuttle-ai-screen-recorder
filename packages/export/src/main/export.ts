import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sceneSpans } from '@cuttle/timeline';
import { app } from 'electron';
import { audioFilterGraph, muxArgs, planAudio } from '../audio';
import { ExportError } from '../errors';
import { withFormat, type ExportFormat } from '../formats';
import { CHANNELS, type EncoderPreference, type ExportJob, type PageResult, type PageSuccess } from '../job';
import { checkFfmpeg, runFfmpeg } from './ffmpeg';
import { FileHost } from './files';
import { loadSources } from './sources';
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

function defaultPageDir(): string {
  return fileURLToPath(new URL('./export-page/', import.meta.url));
}

async function runPage(window: ExportWindow): Promise<PageSuccess> {
  let result: PageResult;
  try {
    result = await Promise.race([window.win.webContents.executeJavaScript('window.cuttleExport.run()') as Promise<PageResult>, window.gone]);
  } catch (error) {
    throw new ExportError('render', error instanceof Error ? error.message : String(error), { cause: error });
  }
  if (!result.ok) throw new ExportError(result.code, result.message);
  return result;
}

/**
 * Renders a project to an MP4 (H.264 High + AAC 48 kHz) in a hidden window: decode, render with the
 * engine, encode, mux; then ffmpeg cuts the mic to the scenes and adds it. Runs in Electron's main
 * process. Partial output never reaches `out`.
 */
export async function exportProject(opts: ExportOptions): Promise<ExportResult> {
  const started = performance.now();
  await app.whenReady();
  const projectDir = resolve(opts.projectDir);
  const out = resolve(opts.out);
  const sources = await loadSources(projectDir);
  await checkFfmpeg();
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

  await mkdir(dirname(out), { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'cuttle-export-'));
  const video = join(work, 'video.mp4');
  const partial = join(dirname(out), `.${basename(out)}.${randomUUID().slice(0, 8)}.partial`);
  const readable = [sources.screen, ...(sources.webcam ? [sources.webcam.path] : []), ...Object.values(sources.stills)];
  if (sources.backgroundImage) readable.push(sources.backgroundImage);
  const files = new FileHost(readable, video);
  let window: ExportWindow | undefined;
  try {
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    const ipc = window.win.webContents.ipc;
    ipc.handle(CHANNELS.job, () => job);
    ipc.handle(CHANNELS.size, (_event, path: string) => files.size(path));
    ipc.handle(CHANNELS.read, (_event, path: string, start: number, end: number) => files.read(path, start, end));
    ipc.handle(CHANNELS.readFile, (_event, path: string) => files.readFile(path));
    ipc.handle(CHANNELS.write, (_event, data: Uint8Array, position: number) => files.write(data, position));
    ipc.on(CHANNELS.progress, (_event, done: number, total: number) => opts.onProgress?.(done, total));

    const page = await runPage(window);
    // The window stays open until the end: closing an app's last window quits it by default.
    await files.close(); // flushes the video-only MP4 before ffmpeg reads it

    const audioStarted = performance.now();
    const seconds = page.frames / project.output.fps;
    const segments = planAudio({ spans: sceneSpans(project.scenes), look: project.look, mic: sources.mic !== undefined, seconds });
    const usesMic = segments.some((segment) => segment.mic !== undefined);
    const graph = audioFilterGraph(segments, sources.mic?.offset ?? 0);
    await runFfmpeg(muxArgs({ video, mic: usesMic ? sources.mic?.path : undefined, graph, out: partial }));
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
    await rm(partial, { force: true });
    if (error instanceof ExportError) throw error;
    throw new ExportError('render', error instanceof Error ? error.message : String(error), { cause: error });
  } finally {
    window?.win.destroy();
    await files.close();
    await rm(work, { recursive: true, force: true });
  }
}

import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans, stepChapters, toSrt, toVtt, typingClicks, type Chapter } from '@cuttle/timeline';
import { app } from 'electron';
import { INLINE_GRAPH_LIMIT, audioFilterGraph, muxArgs, planAudio } from '../audio';
import { chapterMetadata } from '../chapters';
import { ExportError } from '../errors';
import { withFormat, type ExportFormat } from '../formats';
import { CHANNELS, type EncoderPreference, type ExportJob, type PageResult, type PageStillsSuccess, type PageSuccess } from '../job';
import { checkFfmpeg, runFfmpeg } from './ffmpeg';
import { FileHost } from './files';
import { MotionHost, motionWarnings, serveMotion, type MotionItemReport } from './motion-host';
import { motionSoundCues } from './motion-sounds';
import { loadSources, motionTake, samePath } from './sources';
import { planSoundtrack, renderSoundtrack, writeSoundTrack, type SoundtrackPlan } from './soundtrack';
import type { MusicStems } from './music';
import { writeTypingTrack } from './typing-track';
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
  /** Burn the captions into the video (default: the project's `captions.enabled`). */
  captions?: boolean;
  /** Subtitle files written next to `out` (`<name>.srt`, `<name>.vtt`); the project needs a transcript. */
  subtitles?: readonly SubtitleFormat[];
}

export const SUBTITLE_FORMATS = ['srt', 'vtt'] as const;
export type SubtitleFormat = (typeof SUBTITLE_FORMATS)[number];

/** The subtitle file of `out` in `format`: its name with the format's extension. */
export const subtitlePath = (out: string, format: SubtitleFormat) => join(dirname(out), `${basename(out).replace(/\.[^.]*$/, '')}.${format}`);

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
  /** The subtitle files written next to it. */
  subtitles?: string[];
  /** The chapters in the video file, from the script's steps (`stepChapters`), when it has any. */
  chapters?: Chapter[];
  /** What the motion items' pages said (errors and console), when the project has any. */
  motion?: MotionItemReport[];
  /** The music and sounds, when the project has any: what the page made and said, and sounds that could not play. */
  music?: SoundtrackReport;
  stats: ExportStats;
}

/** What rendering a project's music and sounds came to. */
export interface SoundtrackReport {
  /** The music page, relative to the project folder (none: the sounds alone). */
  src?: string;
  /** What the page told about its music (bpm, key, sections). */
  info: MusicStems['result']['info'];
  /** Each stem's highest sample before its level. */
  peaks: MusicStems['result']['peaks'];
  nodes: number;
  renderMs: number;
  /** Sounds that could not play. */
  skipped: string[];
  errors: string[];
  console: string[];
}

/** The report of a rendered soundtrack. */
export function soundtrackReport(projectDir: string, plan: SoundtrackPlan, stems: MusicStems): SoundtrackReport {
  const { result, report } = stems;
  return {
    ...(plan.page && { src: relativeSrc(projectDir, plan.page) }),
    info: result.info,
    peaks: result.peaks,
    nodes: result.nodes,
    renderMs: result.renderMs,
    skipped: result.skipped,
    errors: report.errors,
    console: report.console,
  };
}

const relativeSrc = (projectDir: string, page: string) => relative(resolve(projectDir), page).split(sep).join('/');

/** Without a newly rendered frame for this long the export counts as stalled (a hung encoder or decoder). */
const STALL_SECONDS = 60;
/** Leftovers of exports that were killed before they could clean up are removed after this long. */
const STALE_HOURS = 24;
/** Prefix of an export's work folder in the system's temp folder. */
const WORK_PREFIX = 'cuttle-export-';

export function defaultPageDir(): string {
  return fileURLToPath(new URL('./export-page/', import.meta.url));
}

export const cancelledError = (): ExportError => new ExportError('cancelled', 'the export was cancelled');

/** A promise that rejects with `cancelled` when `signal` aborts; `dispose` removes the listener. */
export function whenCancelled(signal: AbortSignal | undefined): { promise: Promise<never>; dispose(): void } {
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
export function watchdog(): { progress(done: number): void; alive(): void; stalled: Promise<never>; stop(): void } {
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

export async function runPage<T extends PageSuccess | PageStillsSuccess>(window: ExportWindow, ...failures: Promise<never>[]): Promise<T> {
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
  return result as T;
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
  const subtitles = [...new Set(opts.subtitles ?? [])];
  if (subtitles.length > 0 && !sources.transcript) {
    throw new ExportError('missing-file', 'subtitle files need the take\'s transcript (sources.transcript): run "cuttle transcribe" first');
  }
  for (const format of subtitles) await checkOutput(subtitlePath(out, format), sources.inputs);
  await checkFfmpeg();
  if (sources.mic) await checkMic(sources.mic.path, signal);
  throwIfCancelled();
  await sweepStale(out);
  const project = withFormat(sources.project, opts.format);
  const job: ExportJob = {
    kind: 'video',
    project,
    ...(sources.screen && { screen: sources.screen }),
    webcam: sources.webcam,
    events: sources.events,
    ...(sources.transcript && { transcript: sources.transcript }),
    ...(opts.captions !== undefined && { captions: opts.captions }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    watermarkImage: sources.watermarkImage,
    ...(sources.motion && { motion: sources.motion }),
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
  const motion = sources.motion && sources.motionTake ? new MotionHost(project, sources.motion, sources.motionTake) : undefined;
  // the music and sounds render beside the frames, in a page of their own; checked here, so a missing
  // music page fails before the frames, and planned again with the sounds the motion pages ask for
  const take = sources.motionTake ?? (await motionTake(projectDir, project));
  await planSoundtrack(projectDir, project, take);
  let soundtrack: Promise<{ plan: SoundtrackPlan; stems: MusicStems } | undefined> | undefined;
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const video = join(work, 'video.mp4');
    const images = [...Object.values(sources.stills), ...[sources.backgroundImage, sources.watermarkImage].filter((path): path is string => path !== undefined)];
    const host = new FileHost([...(sources.screen ? [sources.screen] : []), ...(sources.webcam ? [sources.webcam.path] : [])], video, images);
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
    serveMotion(ipc, motion, guard.alive);
    soundtrack = (async () => {
      const asked = await motionSoundCues(project, sources.motion, take);
      const plan = await planSoundtrack(projectDir, project, take, asked.cues);
      if (!plan) return void asked.errors.forEach((error) => console.warn(`warning: ${error}`));
      plan.skipped.push(...asked.errors);
      return { plan, stems: await renderSoundtrack(projectDir, plan) };
    })();
    soundtrack.catch(() => {});

    const page = await runPage<PageSuccess>(window, guard.stalled, cancel.promise);
    guard.stop();
    const said = await motion?.close();
    for (const warning of motionWarnings(said ?? [])) console.warn(`warning: ${warning}`);
    // The window stays open until the end: closing an app's last window quits it by default.
    await host.close(); // flushes the video-only MP4 before ffmpeg reads it

    const audioStarted = performance.now();
    const seconds = page.frames / project.output.fps;
    const spans = sceneSpans(project.scenes, project.cuts);
    const segments = planAudio({ spans, look: project.look, mic: sources.mic !== undefined, seconds });
    const usesMic = segments.some((segment) => segment.mic !== undefined);
    // the typing sounds: a track of their own on the video's timeline, mixed in after the mic
    const clicks = typingClicks(spans, sources.keys ?? [], project.look.audio);
    // with music or sounds, one stereo soundtrack holds them and the typing clicks; else the clicks alone
    const rendered = await soundtrack.catch((error: Error) => {
      throw new ExportError('render', `the music could not be rendered: ${error.message}`, { cause: error });
    });
    let musicReport: SoundtrackReport | undefined;
    let typing: string | undefined;
    let sound: string | undefined;
    if (rendered) {
      const { plan, stems } = rendered;
      musicReport = soundtrackReport(projectDir, plan, stems);
      for (const warning of [...musicReport.errors, ...musicReport.skipped]) console.warn(`warning: music${musicReport.src ? ` (${musicReport.src})` : ''}: ${warning}`);
      sound = join(work, 'sound.wav');
      await writeSoundTrack(sound, {
        seconds,
        stems,
        ...(project.music?.enabled && { music: { volume: project.music.volume, duck: project.music.duck } }),
        speech: plan.video.speech,
        effectsVolume: project.look.audio.effects ? project.look.audio.effectsVolume : 0,
        ...(clicks.length > 0 && { typing: { clicks, volume: project.look.audio.typingVolume } }),
      });
    } else if (clicks.length > 0) {
      typing = join(work, 'typing.wav');
      await writeTypingTrack(typing, clicks, project.look.audio.typingVolume, seconds);
    }
    const extra = usesMic ? 2 : 1;
    const graph = audioFilterGraph(segments, sources.mic?.offset ?? 0, 1, typing ? extra : undefined, sound ? extra : undefined);
    const graphFile = graph.length > INLINE_GRAPH_LIMIT ? join(work, 'audio.graph') : undefined;
    if (graphFile) await writeFile(graphFile, graph);
    // the script's steps as the video's chapters, where the take reached them
    const chapters = stepChapters(project.script, take.markers, spans);
    const chapterFile = chapters.length > 0 ? join(work, 'chapters.txt') : undefined;
    if (chapterFile) await writeFile(chapterFile, chapterMetadata(chapters));
    await runFfmpeg(muxArgs({ video, mic: usesMic ? sources.mic?.path : undefined, typing, sound, graph, graphFile, ...(chapterFile && { chapters: chapterFile }), out: partial }), signal);
    throwIfCancelled();
    try {
      await rename(partial, out);
    } catch (error) {
      throw new ExportError('render', `could not replace ${out} (is it open in a player?): ${(error as Error).message}`, { cause: error });
    }
    const written: string[] = [];
    if (subtitles.length > 0 && sources.transcript) {
      // as subtitles, whatever the burned-in style: two lines a cue, on the video's timeline
      const spans = sceneSpans(project.scenes, project.cuts);
      const cues = captionCues(captionWords(applyCaptionFixes(sources.transcript, project.captions.fixes), spans), 'subtitle');
      for (const format of subtitles) {
        const path = subtitlePath(out, format);
        await writeFile(path, format === 'srt' ? toSrt(cues) : toVtt(cues));
        written.push(path);
      }
    }
    return {
      out,
      frames: page.frames,
      seconds,
      ...(written.length > 0 && { subtitles: written }),
      ...(chapters.length > 0 && { chapters }),
      ...(said && { motion: said }),
      ...(musicReport && { music: musicReport }),
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
    await motion?.close().catch(() => {});
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

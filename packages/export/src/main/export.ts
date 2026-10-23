import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOUDNESS, type LoudnessTarget } from '@cuttle/project';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans, stepChapters, toSrt, toVtt, totalDuration, typingClicks, type Chapter } from '@cuttle/timeline';
import { app } from 'electron';
import { INLINE_GRAPH_LIMIT, alphaMuxArgs, audioFilterGraph, encodeArgs, masterFilter, meterArgs, mixArgs, muxArgs, parseMeter, planAudio, type AlphaContainer } from '../audio';
import { frameCount } from '../frame-plan';
import { chapterMetadata } from '../chapters';
import { duckExpression, speechSpans } from '../music/duck';
import { placeNarration, writeNarrationTrack } from './narration';
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
  /** The loudness the mix is brought to (default: the project's `look.audio.loudness`). */
  loudness?: LoudnessTarget;
  /**
   * Frames with transparency, no background, for another editor to lay over its own: `out` names a
   * `.webm` (VP9 with alpha, Opus sound) or a `.mov` (ProRes 4444, PCM sound).
   */
  transparent?: boolean;
}

/** What a batch of transparent videos is written as: all WebM or all MOV, by their names. */
function alphaContainer(outs: readonly string[]): AlphaContainer {
  const kinds = new Set(outs.map((out) => extname(out).toLowerCase()));
  if ([...kinds].some((kind) => kind !== '.webm' && kind !== '.mov')) throw new ExportError('invalid-project', 'a transparent video is a .webm (VP9 with alpha) or a .mov (ProRes 4444): name the file so');
  if (kinds.size > 1) throw new ExportError('invalid-project', 'transparent videos of one export are all .webm or all .mov');
  return kinds.has('.mov') ? 'mov' : 'webm';
}

/** The most a quiet mix is raised (dB): more would lift its noise into the video. */
export const MAX_LOUDNESS_GAIN = 24;
/** A mix quieter than this (LUFS) is silence: it gets no gain. */
const SILENT_LUFS = -70;

/** An EBU R128 measurement: integrated loudness (LUFS) and true peak (dBTP); null for silence. */
export interface Level {
  lufs: number | null;
  truePeak: number | null;
}

/** How the export brought its mix to a platform's loudness. */
export interface LoudnessReport {
  target: Exclude<LoudnessTarget, 'off'>;
  /** Where the platform plays: its loudness and the true peak ceiling. */
  expected: { lufs: number; truePeak: number };
  /** The mix as it was. */
  mix: Level;
  /** The gain on the whole mix (dB), before the limiter that keeps it under the ceiling. */
  gain: number;
  /** The written video's sound, measured. */
  video: Level;
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
  /** The loudness the mix was brought to, when one was asked for. */
  loudness?: LoudnessReport;
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
  /** The music's own stems (drums, bass, …): their levels are `music.stems`. */
  stems: string[];
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
    stems: result.stems,
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

/** A mic (or system audio, `what`) that ffmpeg cannot read fails here (exit 1), not after minutes of rendering. */
async function checkMic(path: string, signal: AbortSignal | undefined, what = 'mic recording (sources.mic)'): Promise<void> {
  try {
    await runFfmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-i', path, '-map', '0:a:0', '-frames:a', '1', '-f', 'null', '-'], signal);
  } catch (error) {
    if (error instanceof ExportError && error.code !== 'render') throw error;
    throw new ExportError('invalid-media', `${what} has no readable audio: ${path}\n${(error as Error).message}`, {
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
  const { format, out, ...rest } = opts;
  const [result] = await exportProjects({ ...rest, targets: [{ ...(format !== undefined && { format }), out }] });
  return result!;
}

/** One video of a batch: its format (none: the project's own size) and its file. */
export interface ExportTarget {
  format?: ExportFormat;
  out: string;
}

export interface BatchExportOptions extends Omit<ExportOptions, 'format' | 'out' | 'onProgress'> {
  targets: readonly ExportTarget[];
  /** Called after each rendered frame of any of them: the frames done and to do over all of them. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Renders a project in several formats in one go. Their frames render one format after another, each
 * in a window of its own (the next one opens while a page renders): the encoder takes most of the
 * time, and takes one video at a time, so pages side by side would only wait for each other. The
 * sound (the music page, the narration, the mix, its loudness, the AAC) is made once, while the
 * frames render, and each video gets it as it is. The results are in the order of `targets`; a
 * failure or a cancel leaves none of them.
 */
export async function exportProjects(opts: BatchExportOptions): Promise<ExportResult[]> {
  const started = performance.now();
  const { signal } = opts;
  const throwIfCancelled = (): void => {
    if (signal?.aborted) throw cancelledError();
  };
  if (opts.targets.length === 0) throw new ExportError('invalid-project', 'nothing to export: no format given');
  await app.whenReady();
  const projectDir = resolve(opts.projectDir);
  const outs = opts.targets.map((target) => resolve(target.out));
  // transparent: each a WebM (VP9 with alpha) or a MOV (ProRes 4444), by its name
  const alpha = opts.transparent ? alphaContainer(outs) : undefined;
  const twice = outs.find((out, i) => outs.findIndex((other) => samePath(other, out)) !== i);
  if (twice) throw new ExportError('invalid-project', `two formats would write ${twice}: give each its own file`);
  const sources = await loadSources(projectDir);
  for (const warning of sources.warnings) console.warn(`warning: ${warning}`);
  for (const out of outs) await checkOutput(out, sources.inputs);
  const subtitles = [...new Set(opts.subtitles ?? [])];
  const narrated = sources.narration !== undefined && sources.narration.length > 0 && sources.project.voiceover.captions;
  if (subtitles.length > 0 && !sources.transcript && !narrated) {
    throw new ExportError('missing-file', 'subtitle files need the take\'s transcript (sources.transcript): run "cuttle transcribe" first');
  }
  for (const out of outs) for (const format of subtitles) await checkOutput(subtitlePath(out, format), sources.inputs);
  await checkFfmpeg();
  if (sources.mic) await checkMic(sources.mic.path, signal);
  if (sources.system) await checkMic(sources.system.path, signal, "the computer's sound (sources.system)");
  throwIfCancelled();
  for (const out of outs) await sweepStale(out);
  // the formats differ in their size only: the scenes, the frames, the sound and the narration are the same
  const project = sources.project;
  const spans = sceneSpans(project.scenes, project.cuts);
  const frames = frameCount(totalDuration(spans), project.output.fps);
  const seconds = frames / project.output.fps;
  // the narration on the video: its lines, and their words for the captions, the mix and the duck
  const narration = sources.narration ? placeNarration(project, spans, sources.narration) : undefined;
  for (const index of narration?.left ?? []) {
    const line = project.voiceover.lines[index]!;
    console.warn(`warning: the narration's line ${line.id ?? `#${index + 1}`} plays nowhere: ${line.scene !== undefined ? 'it starts after its scene ends' : 'no clip shows its second'}`);
  }
  const jobOf = (format: ExportFormat | undefined): ExportJob => ({
    kind: 'video',
    project: withFormat(project, format),
    ...(sources.screen && { screen: sources.screen }),
    webcam: sources.webcam,
    events: sources.events,
    ...(sources.shortcuts && { shortcuts: sources.shortcuts }),
    ...(sources.transcript && { transcript: sources.transcript }),
    ...(narration && narration.words.length > 0 && { narration: narration.words }),
    ...(opts.captions !== undefined && { captions: opts.captions }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    watermarkImage: sources.watermarkImage,
    ...(sources.motion && { motion: sources.motion }),
    ...(alpha && { transparent: true }),
    encoder: opts.encoder ?? 'auto',
  });
  for (const out of outs) {
    try {
      await mkdir(dirname(out), { recursive: true });
    } catch (error) {
      throw new ExportError('invalid-project', `cannot create the output folder ${dirname(out)}: ${(error as Error).message}`, { cause: error });
    }
  }

  const partials = outs.map((out) => join(dirname(out), `.${basename(out)}.${randomUUID().slice(0, 8)}.partial`));
  const cancel = whenCancelled(signal);
  const guards: ReturnType<typeof watchdog>[] = [];
  const windows: ExportWindow[] = [];
  const hosts: FileHost[] = [];
  const motions: MotionHost[] = [];
  let work: string | undefined;
  // set once the batch is over: a window still opening then closes at once
  let over = false;
  const openWindow = async (): Promise<ExportWindow> => {
    const window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    if (over) window.win.destroy();
    else windows.push(window);
    return window;
  };
  // the music and sounds render beside the frames, in a page of their own; checked here, so a missing
  // music page fails before the frames, and planned again with the sounds the motion pages ask for
  // the take as the music sees it, with the narration's words (spoken where they play)
  const take = { ...(sources.motionTake ?? (await motionTake(projectDir, project))), ...(narration && { narration: narration.words }) };
  await planSoundtrack(projectDir, project, take);
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const folder = work;

    // the sound, once for every format, while the frames render
    const sound = (async () => {
      const soundtrack = (async () => {
        const asked = await motionSoundCues(project, sources.motion, take);
        const plan = await planSoundtrack(projectDir, project, take, asked.cues);
        if (!plan) return void asked.errors.forEach((error) => console.warn(`warning: ${error}`));
        plan.skipped.push(...asked.errors);
        return { plan, stems: await renderSoundtrack(projectDir, plan) };
      })();
      soundtrack.catch(() => {});
      const audioStarted = performance.now();
      const segments = planAudio({ spans, look: project.look, mic: sources.mic !== undefined, system: sources.system !== undefined, seconds });
      const audible = segments.some((segment) => segment.mic !== undefined);
      const usesMic = audible && sources.mic !== undefined;
      const usesSystem = audible && sources.system !== undefined;
      const narrationFile = narration && narration.placed.length > 0 && project.look.audio.enabled ? join(folder, 'narration.wav') : undefined;
      if (narrationFile) await writeNarrationTrack(narrationFile, narration!.placed, seconds);
      // the typing sounds: a track of their own on the video's timeline, mixed in after the mic
      const clicks = typingClicks(spans, sources.keys ?? [], project.look.audio);
      // with music or sounds, one stereo soundtrack holds them and the typing clicks; else the clicks alone
      const rendered = await soundtrack.catch((error: Error) => {
        throw new ExportError('render', `the music could not be rendered: ${error.message}`, { cause: error });
      });
      let music: SoundtrackReport | undefined;
      let typing: string | undefined;
      let soundFile: string | undefined;
      if (rendered) {
        const { plan, stems } = rendered;
        music = soundtrackReport(projectDir, plan, stems);
        for (const warning of [...music.errors, ...music.skipped]) console.warn(`warning: music${music.src ? ` (${music.src})` : ''}: ${warning}`);
        soundFile = join(folder, 'sound.wav');
        await writeSoundTrack(soundFile, {
          seconds,
          stems,
          ...(project.music?.enabled && { music: { volume: project.music.volume, duck: project.music.duck } }),
          speech: plan.video.speech,
          effectsVolume: project.look.audio.effects ? project.look.audio.effectsVolume : 0,
          ...(clicks.length > 0 && { typing: { clicks, volume: project.look.audio.typingVolume } }),
        });
      } else if (clicks.length > 0) {
        typing = join(folder, 'typing.wav');
        await writeTypingTrack(typing, clicks, project.look.audio.typingVolume, seconds);
      }
      // the inputs after the video: the mic, the computer's sound, then the typing or the soundtrack
      let input = 1;
      const micInput = usesMic ? input++ : undefined;
      const systemInput = usesSystem ? input++ : undefined;
      const narrationInput = narrationFile ? input++ : undefined;
      const speech = speechSpans(project, sources.transcript ?? [], spans, narration?.words ?? []);
      const graph = audioFilterGraph(segments, {
        ...(micInput !== undefined && sources.mic && { mic: { input: micInput, offset: sources.mic.offset } }),
        ...(systemInput !== undefined &&
          sources.system && {
            system: {
              input: systemInput,
              offset: sources.system.offset,
              volume: project.look.audio.systemVolume,
              // down under speech (the take's and the narration's), as the music
              duck: duckExpression(speech, project.look.audio.systemDuck),
            },
          }),
        ...(narrationInput !== undefined && { narration: narrationInput }),
        ...(typing && { typing: input }),
        ...(soundFile && { sound: input }),
      });
      const graphFile = graph.length > INLINE_GRAPH_LIMIT ? join(folder, 'audio.graph') : undefined;
      if (graphFile) await writeFile(graphFile, graph);
      const mix = join(folder, 'mix.wav');
      const inputs = { mic: usesMic ? sources.mic?.path : undefined, system: usesSystem ? sources.system?.path : undefined, narration: narrationFile, typing, sound: soundFile };
      await runFfmpeg(mixArgs({ ...inputs, graph, graphFile, out: mix }), signal);
      // a platform's loudness: the mix measured, then one gain and a limiter on the way to AAC
      const target = opts.loudness ?? project.look.audio.loudness;
      let loudness: LoudnessReport | undefined;
      let master: string | undefined;
      const audio = join(folder, 'sound.m4a');
      if (target !== 'off') {
        const measured = parseMeter(await runFfmpeg(meterArgs(mix), signal));
        const gain = measured.lufs === null || measured.lufs <= SILENT_LUFS ? 0 : Math.round(Math.min(MAX_LOUDNESS_GAIN, LOUDNESS[target].lufs - measured.lufs) * 100) / 100;
        master = masterFilter(gain, LOUDNESS[target].truePeak);
        loudness = { target, expected: LOUDNESS[target], mix: measured, gain, video: { lufs: null, truePeak: null } };
      }
      // an MP4's AAC once for all of them; a transparent video's sound is encoded as it is muxed
      if (!alpha) await runFfmpeg(encodeArgs({ mix, ...(master && { master }), out: audio }), signal);
      // what the platform will hear: the sound every video gets, measured (a transparent one's once muxed)
      if (loudness && !alpha) loudness.video = parseMeter(await runFfmpeg(meterArgs(audio), signal));
      return { audio: alpha ? mix : audio, master, music, loudness, audioMs: Math.round(performance.now() - audioStarted) };
    })();
    sound.catch(() => {});

    // each format's frames, one after another; the progress over all of them
    const done = opts.targets.map(() => 0);
    const report = () => opts.onProgress?.(done.reduce((sum, value) => sum + value, 0), frames * opts.targets.length);
    const pages: { page: PageSuccess; video: string; said: MotionItemReport[] | undefined }[] = [];
    let opening = openWindow();
    for (const [index, target] of opts.targets.entries()) {
      throwIfCancelled();
      const window = await opening;
      // the next format's window opens while this one renders
      if (index + 1 < opts.targets.length) {
        opening = openWindow();
        opening.catch(() => {});
      }
      const job = jobOf(target.format);
      const video = join(folder, `video-${index}.${alpha ? 'webm' : 'mp4'}`);
      const images = [...Object.values(sources.stills), ...[sources.backgroundImage, sources.watermarkImage].filter((path): path is string => path !== undefined)];
      const host = new FileHost([...(sources.screen ? [sources.screen] : []), ...(sources.webcam ? [sources.webcam.path] : [])], video, images);
      hosts.push(host);
      const guard = watchdog();
      guards.push(guard);
      const motion = sources.motion && sources.motionTake ? new MotionHost(job.project, sources.motion, sources.motionTake) : undefined;
      if (motion) motions.push(motion);
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
      ipc.on(CHANNELS.progress, (_event, made: number) => {
        guard.progress(made);
        done[index] = made;
        report();
      });
      serveMotion(ipc, motion, guard.alive);
      const page = await runPage<PageSuccess>(window, guard.stalled, cancel.promise);
      guard.stop();
      if (page.frames !== frames) throw new ExportError('render', `the ${target.format ?? 'project'} video has ${page.frames} frames where ${frames} were planned`);
      const said = await motion?.close();
      for (const warning of motionWarnings(said ?? [])) console.warn(`warning: ${warning}`);
      await host.close(); // flushes the video-only MP4 before ffmpeg reads it
      // done with it (the next one is open already: the app keeps a window, it does not quit)
      window.win.destroy();
      pages.push({ page, video, said });
    }
    const { audio, master, music, loudness, audioMs } = await sound;
    throwIfCancelled();

    // the script's steps as the video's chapters, where the take reached them
    const chapters = stepChapters(project.script, take.markers, spans);
    const chapterFile = chapters.length > 0 ? join(folder, 'chapters.txt') : undefined;
    if (chapterFile) await writeFile(chapterFile, chapterMetadata(chapters));
    // each video with the sound, then all of them in place
    for (const [index, partial] of partials.entries()) {
      const video = pages[index]!.video;
      const chaptersOf = chapterFile ? { chapters: chapterFile } : {};
      await runFfmpeg(alpha ? alphaMuxArgs({ video, audio, ...(master && { master }), ...chaptersOf, container: alpha, out: partial }) : muxArgs({ video, audio, ...chaptersOf, out: partial }), signal);
      throwIfCancelled();
    }
    if (loudness && alpha) loudness.video = parseMeter(await runFfmpeg(meterArgs(partials[0]!), signal));
    for (const [index, out] of outs.entries()) {
      try {
        await rename(partials[index]!, out);
      } catch (error) {
        throw new ExportError('render', `could not replace ${out} (is it open in a player?): ${(error as Error).message}`, { cause: error });
      }
    }
    // as subtitles, whatever the burned-in style: two lines a cue, on the video's timeline, the narration's words with the take's
    const cues = () => {
      const spoken = sources.transcript ? captionWords(applyCaptionFixes(sources.transcript, project.captions.fixes), spans) : [];
      return captionCues([...spoken, ...(narrated && narration ? narration.words : [])].sort((a, b) => a.t - b.t), 'subtitle');
    };
    const results: ExportResult[] = [];
    for (const [index, out] of outs.entries()) {
      const { page, said } = pages[index]!;
      const written: string[] = [];
      for (const format of subtitles) {
        const path = subtitlePath(out, format);
        await writeFile(path, format === 'srt' ? toSrt(cues()) : toVtt(cues()));
        written.push(path);
      }
      results.push({
        out,
        frames: page.frames,
        seconds,
        ...(written.length > 0 && { subtitles: written }),
        ...(chapters.length > 0 && { chapters }),
        ...(said && { motion: said }),
        ...(music && { music }),
        ...(loudness && { loudness }),
        stats: {
          gpu: page.gpu,
          codec: page.codec,
          hardwareAcceleration: page.hardwareAcceleration,
          bitrate: page.bitrate,
          page: page.timings,
          audioMs,
          totalMs: Math.round(performance.now() - started),
        },
      });
    }
    return results;
  } catch (error) {
    // none of them: a batch that failed leaves no half of itself
    await Promise.all(partials.map((partial) => rm(partial, { force: true, maxRetries: 3 }).catch(() => {})));
    if (error instanceof ExportError) throw error;
    throw new ExportError('render', error instanceof Error ? error.message : String(error), { cause: error });
  } finally {
    over = true;
    for (const guard of guards) guard.stop();
    cancel.dispose();
    await Promise.all(motions.map((motion) => motion.close().catch(() => {})));
    for (const window of windows) if (!window.win.isDestroyed()) window.win.destroy();
    await Promise.all(hosts.map((host) => host.close()));
    if (work) {
      const folder = work;
      await rm(folder, { recursive: true, force: true, maxRetries: 3 }).catch((error: Error) =>
        console.error(`could not remove the export's work folder ${folder}: ${error.message}`),
      );
    }
  }
}

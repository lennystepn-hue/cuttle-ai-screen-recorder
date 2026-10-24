import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { PROJECT_FILE, readProjectFile } from '@cuttle/core';
import { LOUDNESS_TARGETS, speaks } from '@cuttle/project';
import { CliError } from '../errors';
import { voiceRenderCommand } from './voice';

export interface RenderArgs {
  /** One format or several (`--format 16:9 --format 9:16`, or "16:9,9:16" as PowerShell passes it). */
  format?: string | string[];
  out?: string;
  encoder?: string;
  /** false: no captions burned in, whatever the project says (`--no-captions`). */
  captions?: boolean;
  srt?: boolean;
  vtt?: boolean;
  /** The loudness the mix is brought to, instead of the project's `look.audio.loudness`. */
  loudness?: string;
  /** With transparency, no background: VP9 with alpha in a .webm (the default name), or ProRes 4444 in a .mov (`-o`). */
  alpha?: boolean;
  /** `4k`: the short side 2160 (`hd`: the format's size). */
  size?: string;
  fps?: number;
  /** `hevc`: smaller files at 4K, with a hardware encoder (`h264`: everywhere). */
  codec?: string;
}

/** An EBU R128 measurement: LUFS and dBTP, null for silence. */
type Level = { lufs: number | null; truePeak: number | null };

/** What @cuttle/export's exportProject returns (the CLI does not import the Electron package). */
export interface RenderResult {
  out: string;
  frames: number;
  seconds: number;
  /** Subtitle files written next to it (`--srt`, `--vtt`). */
  subtitles?: string[];
  /** The chapters in the video file, from the script's steps (output seconds). */
  chapters?: { at: number; end: number; title: string; step: string }[];
  /** The loudness the mix was brought to (`--loudness`, `look.audio.loudness`), and the video's sound measured. */
  loudness?: { target: string; expected: { lufs: number; truePeak: number }; mix: Level; gain: number; video: Level };
  stats: { gpu: string; codec: string; hardwareAcceleration: string; bitrate: number; totalMs: number } & Record<string, unknown>;
}

/** `output` without a result of its own: a step of another command says only how it goes. */
const quietly = (output: Output): Output => ({ ...output, result: () => {} });

/** The formats asked for, split at the commas as PowerShell passes them; none: the project's own size. */
const formatsOf = (format: string | string[] | undefined): (string | undefined)[] => {
  const listed = [format ?? []].flat().flatMap((value) => value.split(',')).map((value) => value.trim()).filter((value) => value !== '');
  return listed.length > 0 ? [...new Set(listed)] : [undefined];
};

/** What a rendered video says to people. */
const said = (result: RenderResult): string[] => [
  `rendered ${result.out}: ${result.frames} frames, ${result.seconds.toFixed(2)} s, in ${(result.stats.totalMs / 1000).toFixed(1)} s`,
  ...(result.subtitles ?? []).map((path) => `subtitles: ${path}`),
  ...(result.chapters ? [`chapters: ${result.chapters.length} in the video (cuttle chapters lists them for a YouTube description)`] : []),
  ...(result.loudness
    ? [`loudness: ${result.loudness.video.lufs ?? '–'} LUFS, true peak ${result.loudness.video.truePeak ?? '–'} dBTP (${result.loudness.target}: ${result.loudness.expected.lufs} LUFS; the mix was ${result.loudness.mix.lufs ?? 'silent'}, raised ${result.loudness.gain} dB)`]
    : []),
];

/** Renders one project in each of `formats`: their frames side by side, the sound once. */
async function renderProject(projectDir: string, formats: (string | undefined)[], args: RenderArgs, output: Output, signal: AbortSignal): Promise<RenderResult[]> {
  const file = await readProjectFile(projectDir); // fails fast, before Electron starts, on a broken project
  // the narration's lines not spoken yet are spoken first (the export reads them from voiceover/)
  if (file.project.look.audio.enabled && file.project.voiceover.lines.some(speaks)) await voiceRenderCommand(file.dir, quietly(output), signal);
  const extension = args.alpha ? 'webm' : 'mp4';
  const targets = formats.map((format) => ({ ...(format !== undefined && { format }), out: args.out ? resolve(args.out) : join(file.dir, 'out', `${(format ?? 'export').replace(':', 'x')}.${extension}`) }));
  output.info(`rendering ${targets.map((target) => target.out).join(', ')} …`);
  return runInElectron<RenderResult[]>(
    {
      command: 'render',
      // its progress comes over the IPC channel (to stderr, and to `cuttle mcp`'s client)
      quiet: true,
      projectDir: file.dir,
      targets,
      ...(args.encoder !== undefined && { encoder: args.encoder }),
      ...(args.captions === false && { captions: false }),
      ...((args.srt || args.vtt) && { subtitles: [...(args.srt ? ['srt'] : []), ...(args.vtt ? ['vtt'] : [])] }),
      ...(args.loudness !== undefined && { loudness: args.loudness }),
      ...(args.alpha && { transparent: true }),
      ...(args.size !== undefined && { size: args.size }),
      ...(args.fps !== undefined && { fps: args.fps }),
      ...(args.codec !== undefined && { codec: args.codec }),
    },
    signal,
    (label, done, total) => output.info(`${label} ${done}/${total}`),
  );
}

function checkArgs(args: RenderArgs, formats: (string | undefined)[]): void {
  if (args.loudness !== undefined && !(LOUDNESS_TARGETS as readonly string[]).includes(args.loudness)) throw new CliError('usage', `"${args.loudness}" is no loudness: ${LOUDNESS_TARGETS.join(', ')}`);
  if (args.out !== undefined && formats.length > 1) throw new CliError('usage', '-o names one file: with several formats each goes to out/<format>.mp4');
  if (args.alpha && args.out !== undefined && !/\.(webm|mov)$/i.test(args.out)) throw new CliError('usage', '--alpha writes a .webm (VP9 with alpha) or a .mov (ProRes 4444): name the file so');
  if (args.size !== undefined && !['hd', '4k'].includes(args.size)) throw new CliError('usage', `--size ${args.size}: hd (the format's size) or 4k`);
  if (args.fps !== undefined && ![24, 25, 30, 50, 60].includes(args.fps)) throw new CliError('usage', `--fps ${args.fps}: 24, 25, 30, 50 or 60`);
  if (args.codec !== undefined && !['h264', 'hevc'].includes(args.codec)) throw new CliError('usage', `--codec ${args.codec}: h264 or hevc`);
  if (args.codec === 'hevc' && args.alpha) throw new CliError('usage', '--alpha writes VP9 or ProRes, not HEVC');
}

/**
 * `cuttle render`: the project as an MP4 (default out/<format>.mp4 in the project); with several
 * formats, all of them in one go (`{ videos }` in the JSON).
 */
export async function renderCommand(projectDir: string, args: RenderArgs, output: Output, signal: AbortSignal): Promise<RenderResult | { videos: RenderResult[] }> {
  const formats = formatsOf(args.format);
  checkArgs(args, formats);
  const videos = await renderProject(projectDir, formats, args, output, signal);
  const result = videos.length === 1 ? videos[0]! : { videos };
  output.result(result, () => videos.flatMap(said).join('\n'));
  return result;
}

/** A frame of the video as an image (`render --still`): where it went, its time and size, and the source second it shows. */
export interface StillResult {
  still: string;
  t: number;
  width: number;
  height: number;
  source?: number;
}

/**
 * `cuttle render --still <seconds>`: the video's frame at that output second as a PNG, as the export
 * draws it (default out/still-<t>s.png in the project), in a format and with transparency as asked.
 */
export async function renderStillCommand(projectDir: string, t: number, args: RenderArgs, output: Output, signal: AbortSignal): Promise<StillResult> {
  const formats = formatsOf(args.format);
  if (formats.length > 1) throw new CliError('usage', '--still renders one frame: give one --format');
  if (args.out !== undefined && extname(args.out).toLowerCase() !== '.png') throw new CliError('usage', `-o ${args.out}: a still is a .png`);
  if (args.size !== undefined || args.fps !== undefined || args.codec !== undefined || args.srt || args.vtt || args.loudness !== undefined) throw new CliError('usage', '--still draws one frame: --size, --fps, --codec, --srt, --vtt and --loudness are for a video');
  const file = await readProjectFile(projectDir);
  const out = args.out ? resolve(args.out) : join(file.dir, 'out', `still-${t.toFixed(2)}s.png`);
  const work = await mkdtemp(join(tmpdir(), 'cuttle-still-'));
  try {
    const format = formats[0];
    const drawn = await runInElectron<{ stills: { t: number; file: string; source?: number }[]; width: number; height: number }>(
      { command: 'preview', projectDir: file.dir, outDir: work, times: [t], quiet: true, ...(format !== undefined && { format }), ...(args.alpha && { transparent: true }) },
      signal,
    );
    const [still] = drawn.stills;
    if (!still) throw new CliError('render', 'the frame was not drawn');
    await mkdir(dirname(out), { recursive: true });
    await copyFile(still.file, out);
    const result: StillResult = { still: out, t, width: drawn.width, height: drawn.height, ...(still.source !== undefined && { source: still.source }) };
    output.result(result, () => `${out}  ${drawn.width}×${drawn.height} at ${t.toFixed(2)} s${still.source !== undefined ? ` (source ${still.source.toFixed(2)} s)` : ''}`);
    return result;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** A project rendered by `render --all`, or why it was not. */
export interface ProjectRender {
  project: string;
  videos: RenderResult[];
}

/**
 * `cuttle render --all <folder>`: every project in the folder (it and the folders in it with a
 * cuttle.json), one after another, each in every format asked for. One that fails does not stop the
 * others; the command fails at the end, naming each one that did.
 */
export async function renderAllCommand(folder: string, args: RenderArgs, output: Output, signal: AbortSignal): Promise<{ projects: ProjectRender[] }> {
  const formats = formatsOf(args.format);
  checkArgs(args, formats);
  if (args.out !== undefined) throw new CliError('usage', '-o names one file: --all writes out/<format>.mp4 in each project');
  const root = resolve(folder);
  const entries = await readdir(root, { withFileTypes: true }).catch((error: Error) => {
    throw new CliError('usage', `cannot read the folder ${root}: ${error.message}`);
  });
  const names = new Set(entries.map((entry) => entry.name));
  const inside = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(async (entry) => ((await readdir(join(root, entry.name)).catch(() => [] as string[])).includes(PROJECT_FILE) ? join(root, entry.name) : undefined)),
  );
  const projects = [...(names.has(PROJECT_FILE) ? [root] : []), ...inside.filter((dir): dir is string => dir !== undefined).sort()];
  if (projects.length === 0) throw new CliError('usage', `no project in ${root}: neither it nor a folder in it has a ${PROJECT_FILE}`);
  const rendered: ProjectRender[] = [];
  const failed: string[] = [];
  for (const [index, project] of projects.entries()) {
    if (signal.aborted) break;
    output.info(`project ${index + 1} of ${projects.length}: ${project}`);
    try {
      const videos = await renderProject(project, formats, args, output, signal);
      rendered.push({ project, videos });
      for (const line of videos.flatMap(said)) output.info(line);
    } catch (error) {
      // cancelled: no more projects
      if ((error as { code?: string }).code === 'cancelled' || signal.aborted) throw error;
      failed.push(`${project}: ${(error as Error).message}`);
      output.info(`failed: ${project}: ${(error as Error).message}`);
    }
  }
  if (failed.length > 0) {
    throw new CliError('render', `${failed.length} of ${projects.length} projects did not render:\n${failed.join('\n')}${rendered.length > 0 ? `\nrendered: ${rendered.map((one) => one.project).join(', ')}` : ''}`);
  }
  const result = { projects: rendered };
  output.result(result, () => rendered.map((one) => `${one.project}: ${one.videos.map((video) => video.out).join(', ')}`).join('\n'));
  return result;
}

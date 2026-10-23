import { join, resolve } from 'node:path';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '@cuttle/core';
import { LOUDNESS_TARGETS, speaks } from '@cuttle/project';
import { CliError } from '../errors';
import { voiceRenderCommand } from './voice';

export interface RenderArgs {
  format?: string;
  out?: string;
  encoder?: string;
  /** false: no captions burned in, whatever the project says (`--no-captions`). */
  captions?: boolean;
  srt?: boolean;
  vtt?: boolean;
  /** The loudness the mix is brought to, instead of the project's `look.audio.loudness`. */
  loudness?: string;
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

/** `cuttle render`: the project as an MP4 (default out/<format>.mp4 in the project). */
export async function renderCommand(projectDir: string, args: RenderArgs, output: Output, signal: AbortSignal): Promise<RenderResult> {
  if (args.loudness !== undefined && !(LOUDNESS_TARGETS as readonly string[]).includes(args.loudness)) throw new CliError('usage', `"${args.loudness}" is no loudness: ${LOUDNESS_TARGETS.join(', ')}`);
  const file = await readProjectFile(projectDir); // fails fast, before Electron starts, on a broken project
  // the narration's lines not spoken yet are spoken first (the export reads them from voiceover/)
  if (file.project.look.audio.enabled && file.project.voiceover.lines.some(speaks)) await voiceRenderCommand(file.dir, quietly(output), signal);
  const out = args.out ? resolve(args.out) : join(file.dir, 'out', `${(args.format ?? 'export').replace(':', 'x')}.mp4`);
  output.info(`rendering ${out} …`);
  const result = await runInElectron<RenderResult>(
    {
      command: 'render',
      // its progress comes over the IPC channel (to stderr, and to `cuttle mcp`'s client)
      quiet: true,
      projectDir: file.dir,
      out,
      ...(args.format !== undefined && { format: args.format }),
      ...(args.encoder !== undefined && { encoder: args.encoder }),
      ...(args.captions === false && { captions: false }),
      ...((args.srt || args.vtt) && { subtitles: [...(args.srt ? ['srt'] : []), ...(args.vtt ? ['vtt'] : [])] }),
      ...(args.loudness !== undefined && { loudness: args.loudness }),
    },
    signal,
    (label, done, total) => output.info(`${label} ${done}/${total}`),
  );
  output.result(result, () =>
    [
      `rendered ${result.out}: ${result.frames} frames, ${result.seconds.toFixed(2)} s, in ${(result.stats.totalMs / 1000).toFixed(1)} s`,
      ...(result.subtitles ?? []).map((path) => `subtitles: ${path}`),
      ...(result.chapters ? [`chapters: ${result.chapters.length} in the video (cuttle chapters lists them for a YouTube description)`] : []),
      ...(result.loudness
        ? [`loudness: ${result.loudness.video.lufs ?? '–'} LUFS, true peak ${result.loudness.video.truePeak ?? '–'} dBTP (${result.loudness.target}: ${result.loudness.expected.lufs} LUFS; the mix was ${result.loudness.mix.lufs ?? 'silent'}, raised ${result.loudness.gain} dB)`]
        : []),
    ].join('\n'),
  );
  return result;
}

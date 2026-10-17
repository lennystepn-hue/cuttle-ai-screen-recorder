import { join, resolve } from 'node:path';
import { sceneSpans, totalDuration } from '@cuttle/timeline';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '../project-file';

export interface PreviewArgs {
  /** Output seconds; without them, a sheet of `SHEET_STILLS` evenly spaced stills. */
  at?: number[];
  sheet?: boolean;
  format?: string;
  /** Folder for the PNGs (default preview/ in the project). */
  out?: string;
}

/** What @cuttle/export's renderStills returns. */
export interface PreviewResult {
  stills: { t: number; file: string }[];
  sheet?: string;
  width: number;
  height: number;
  stats: { gpu: string; totalMs: number };
}

/** Stills of a default contact sheet. */
export const SHEET_STILLS = 12;

/** `cuttle preview`: PNG stills of the output, and a contact sheet, for checking a project. */
export async function previewCommand(projectDir: string, args: PreviewArgs, output: Output, signal: AbortSignal): Promise<PreviewResult> {
  const file = await readProjectFile(projectDir);
  const duration = totalDuration(sceneSpans(file.project.scenes));
  if (duration <= 0) throw new CliError('invalid-project', `${file.path} has no scenes yet; run "cuttle suggest" or add scenes`);
  const times = args.at && args.at.length > 0 ? args.at : Array.from({ length: SHEET_STILLS }, (_, i) => Math.round(((i + 0.5) * duration * 1000) / SHEET_STILLS) / 1000);
  const bad = times.find((t) => !Number.isFinite(t) || t < 0);
  if (bad !== undefined) throw new CliError('usage', `--at takes output seconds of 0 or more (got ${bad})`);
  const sheet = args.sheet ?? !(args.at && args.at.length > 0);
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview');
  output.info(`rendering ${times.length} still(s) into ${outDir} …`);
  const result = await runInElectron<PreviewResult>(
    { command: 'preview', projectDir: file.dir, outDir, times, ...(args.format !== undefined && { format: args.format }), ...(sheet && { sheet: {} }) },
    signal,
  );
  output.result(result, () =>
    [...result.stills.map((still) => `${still.t.toFixed(2)} s  ${still.file}`), ...(result.sheet ? [`sheet  ${result.sheet}`] : [])].join('\n'),
  );
  return result;
}

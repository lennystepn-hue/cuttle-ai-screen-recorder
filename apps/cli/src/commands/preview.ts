import { join, resolve } from 'node:path';
import type { MotionItemReport } from '@cuttle/export';
import { maskEdges, sceneSpans, totalDuration, type MaskEdge } from '@cuttle/timeline';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '@cuttle/core';

export interface PreviewArgs {
  /** Output seconds; without them (and without `masks`), a sheet of `SHEET_STILLS` evenly spaced stills. */
  at?: number[];
  /** Stills at each mask's edges (`maskEdges`), and a sheet of them, a row per mask. */
  masks?: boolean;
  sheet?: boolean;
  format?: string;
  /** Folder for the PNGs (default preview/ in the project). */
  out?: string;
}

/** What @cuttle/export's renderStills returns. */
export interface PreviewResult {
  /**
   * `source`: the source second the still shows (the most visible clip of its frame; absent on a
   * still or card scene), for placing masks, zooms and texts.
   */
  stills: { t: number; file: string; source?: number }[];
  sheet?: string;
  width: number;
  height: number;
  /** What the motion items' pages said (errors and console), when the project has any. */
  motion?: MotionItemReport[];
  /** With `masks`: which still shows which mask's edge (`t` is the still's). */
  masks?: { mask: number; id?: string; label?: string; edge: MaskEdge; t: number; source: number }[];
  stats: { gpu: string; totalMs: number };
}

/** Stills of a default contact sheet. */
export const SHEET_STILLS = 12;

/** `cuttle preview`: PNG stills of the output, and a contact sheet, for checking a project. */
export async function previewCommand(projectDir: string, args: PreviewArgs, output: Output, signal: AbortSignal): Promise<PreviewResult> {
  const file = await readProjectFile(projectDir);
  const duration = totalDuration(sceneSpans(file.project.scenes, file.project.cuts));
  if (duration <= 0) throw new CliError('invalid-project', `${file.path} has no scenes yet; run "cuttle suggest" or add scenes`);
  const spans = sceneSpans(file.project.scenes, file.project.cuts);
  const edges = args.masks
    ? file.project.masks.flatMap((mask, index) =>
        mask.enabled === false ? [] : maskEdges(mask, spans).map((edge) => ({ mask: index, ...(mask.id !== undefined && { id: mask.id }), ...(mask.label !== undefined && { label: mask.label }), ...edge })),
      )
    : [];
  if (args.masks && edges.length === 0) throw new CliError('usage', `${file.path} has no mask that a clip shows: --masks has nothing to look at`);
  const at = args.at ?? [];
  const times = at.length > 0 || edges.length > 0 ? [...new Set([...at, ...edges.map((edge) => edge.t)])].sort((a, b) => a - b) : Array.from({ length: SHEET_STILLS }, (_, i) => Math.round(((i + 0.5) * duration * 1000) / SHEET_STILLS) / 1000);
  const bad = times.find((t) => !Number.isFinite(t) || t < 0);
  if (bad !== undefined) throw new CliError('usage', `--at takes output seconds of 0 or more (got ${bad})`);
  const sheet = args.sheet ?? at.length === 0;
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview');
  output.info(`rendering ${times.length} still(s) into ${outDir} …`);
  const result = await runInElectron<PreviewResult>(
    { command: 'preview', projectDir: file.dir, outDir, times, quiet: output.json, clean: args.out === undefined, ...(args.format !== undefined && { format: args.format }), ...(sheet && { sheet: edges.length > 0 && at.length === 0 ? { columns: 4 } : {} }) },
    signal,
  );
  if (edges.length > 0) result.masks = edges;
  const named = (edge: (typeof edges)[number]) => `${edge.label ?? 'mask'} ${edge.id ?? `#${edge.mask}`}`;
  output.result(result, () =>
    [
      ...result.stills.map((still) => `${still.t.toFixed(2)} s${still.source !== undefined ? ` (source ${still.source.toFixed(2)} s)` : ''}  ${still.file}`),
      ...(result.sheet ? [`sheet  ${result.sheet}`] : []),
      ...edges.map((edge) => `${edge.t.toFixed(2)} s  ${named(edge)}: ${edge.edge === 'before' ? 'before it starts' : edge.edge === 'after' ? 'after it ends' : `inside its ${edge.edge}`} (source ${edge.source.toFixed(2)} s)`),
      ...(result.motion ?? []).flatMap((report) => report.errors.map((error) => `error in ${report.item} (${report.src}): ${error}`)),
    ].join('\n'),
  );
  return result;
}

import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readProjectFile } from '@cuttle/core';
import type { MotionScene } from '@cuttle/project';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { MotionCheck } from '../electron/protocol';
import type { Output } from '../output';
import type { PreviewResult } from './preview';

export interface MotionCheckArgs {
  /** Seconds the item lasts (default: as in cuttle.json, else 3). */
  duration?: number;
  /** Seconds into the item (default: `CHECK_FRAMES` from its start to its end, with a sheet). */
  at?: number[];
  format?: string;
  /** Folder for the PNGs (default: preview/motion-<name>/ in the project). */
  out?: string;
}

export interface MotionCheckResult extends Omit<PreviewResult, 'motion'> {
  /** The page, relative to the project folder. */
  src: string;
  duration: number;
  /** The page's uncaught errors and rejections, and its console. */
  errors: string[];
  console: string[];
}

/** Frames of a default check. */
export const CHECK_FRAMES = 8;
const DEFAULT_SECONDS = 3;

const isInside = (dir: string, path: string): boolean => {
  const rel = relative(dir, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** The page as cuttle.json names it: `src` from the project folder, or from here when that is where it is. */
async function pageOf(dir: string, src: string): Promise<string> {
  const candidates = [resolve(dir, src), resolve(src)];
  for (const path of candidates) {
    if (!isInside(dir, path)) continue;
    if (await stat(path).then((info) => info.isFile(), () => false)) return relative(dir, path).split(sep).join('/');
  }
  if (!candidates.some((path) => isInside(dir, path))) throw new CliError('usage', `${src} is not in the project folder ${dir}: a page may only read the project's files`);
  throw new CliError('missing-file', `no page at ${src} in ${dir}`);
}

/**
 * `cuttle motion check <src>`: the page rendered as a scene of its own, frame by frame as the export
 * draws it, into PNGs and a contact sheet, with what it logged and threw. Its params and switches
 * come from the item in cuttle.json that shows it, when there is one.
 */
export async function motionCheckCommand(projectDir: string, src: string, args: MotionCheckArgs, output: Output, signal: AbortSignal): Promise<MotionCheckResult> {
  const file = await readProjectFile(projectDir);
  const page = await pageOf(file.dir, src);
  const { project } = file;
  const same = (candidate: string) => resolve(file.dir, candidate) === resolve(file.dir, page);
  const scene = project.scenes.find((candidate): candidate is MotionScene => candidate.type === 'motion' && same(candidate.src));
  const item = scene ?? project.overlays.find((overlay) => same(overlay.src));
  const duration = args.duration ?? item?.duration ?? DEFAULT_SECONDS;
  const last = Math.max(0, duration - 1 / project.output.fps);
  const times = args.at && args.at.length > 0 ? args.at : Array.from({ length: CHECK_FRAMES }, (_, i) => Math.round((i * last * 1000) / (CHECK_FRAMES - 1)) / 1000);
  const late = times.find((t) => t >= duration);
  if (late !== undefined) throw new CliError('usage', `--at ${late} is past the item's end (${duration} s)`);
  const name = page.replace(/\/index\.html?$/i, '').replace(/\.html?$/i, '').split('/').at(-1) || 'page';
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview', `motion-${name}`);
  const motion: MotionCheck = {
    src: page,
    duration,
    params: item?.params ?? {},
    network: item?.network ?? false,
  };
  output.info(`rendering ${times.length} frame(s) of ${page} into ${outDir} …`);
  const result = await runInElectron<PreviewResult>(
    {
      command: 'preview',
      projectDir: file.dir,
      outDir,
      times,
      quiet: output.json,
      clean: args.out === undefined,
      motion,
      ...(args.format !== undefined && { format: args.format }),
      sheet: {},
    },
    signal,
  );
  const said = result.motion?.[0];
  const { motion: _reports, ...rest } = result;
  const checked: MotionCheckResult = { ...rest, src: page, duration, errors: said?.errors ?? [], console: said?.console ?? [] };
  output.result(checked, () =>
    [
      `${page}: ${duration} s, ${checked.width}×${checked.height}`,
      ...checked.stills.map((still) => `${still.t.toFixed(2)} s  ${still.file}`),
      ...(checked.sheet ? [`sheet  ${checked.sheet}`] : []),
      checked.errors.length > 0 ? `errors:\n${checked.errors.map((line) => `  ${line}`).join('\n')}` : 'no errors',
      ...(checked.console.length > 0 ? [`console:\n${checked.console.map((line) => `  ${line}`).join('\n')}`] : []),
    ].join('\n'),
  );
  return checked;
}

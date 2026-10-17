import { cp, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { MOTION_TEMPLATES, type MotionTemplate } from '@cuttle/motion-kit';
import { templatesFolder } from '@cuttle/motion-kit/files';
import { newId, usedIds, type MotionScene } from '@cuttle/project';
import { occurrences, sceneSpans } from '@cuttle/timeline';
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
  /** A scene of its own, or an overlay over the video (checked where the video first shows it). */
  kind: 'scene' | 'overlay';
  /** Seconds it lasts; an overlay's stills are at output seconds of the video. */
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
 * `cuttle motion check <src>`: the page rendered frame by frame as the export draws it, into PNGs and
 * a contact sheet, with what it logged and threw. A page that `overlays` shows is checked over the
 * video, where the video first shows it, as the only overlay; any other page as a scene of its own,
 * with the params and switches of the scene that shows it, if one does.
 */
export async function motionCheckCommand(projectDir: string, src: string, args: MotionCheckArgs, output: Output, signal: AbortSignal): Promise<MotionCheckResult> {
  const file = await readProjectFile(projectDir);
  const page = await pageOf(file.dir, src);
  const { project } = file;
  const same = (candidate: string) => resolve(file.dir, candidate) === resolve(file.dir, page);
  const scene = project.scenes.find((candidate): candidate is MotionScene => candidate.type === 'motion' && same(candidate.src));
  const overlayIndex = scene ? -1 : project.overlays.findIndex((overlay) => same(overlay.src));
  const overlay = project.overlays[overlayIndex];
  const item = scene ?? overlay;
  // an overlay: the output seconds where the video first shows its stretch of the take
  let from = 0;
  let duration = args.duration ?? item?.duration ?? DEFAULT_SECONDS;
  if (overlay) {
    const shown = occurrences(sceneSpans(project.scenes, project.cuts), overlay.at, overlay.at + overlay.duration).find((occurrence) => occurrence !== undefined);
    if (!shown) throw new CliError('invalid-project', `the video does not show overlays[${overlayIndex}] (${page}): no clip covers source ${overlay.at}–${overlay.at + overlay.duration} s`);
    from = shown.start;
    duration = Math.round((shown.end - shown.start) * 1000) / 1000;
  }
  const last = Math.max(0, duration - 1 / project.output.fps);
  const offsets = args.at && args.at.length > 0 ? args.at : Array.from({ length: CHECK_FRAMES }, (_, i) => Math.round((i * last * 1000) / (CHECK_FRAMES - 1)) / 1000);
  const late = offsets.find((t) => t >= duration);
  if (late !== undefined) throw new CliError('usage', `--at ${late} is past the item's end (${duration} s)`);
  const times = offsets.map((t) => Math.round((from + t) * 1000) / 1000);
  const name = page.replace(/\/index\.html?$/i, '').replace(/\.html?$/i, '').split('/').at(-1) || 'page';
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview', `motion-${name}`);
  const motion: MotionCheck = {
    src: page,
    duration,
    params: item?.params ?? {},
    network: item?.network ?? false,
    ...(item?.motionBlur && { motionBlur: item.motionBlur }),
    ...(overlay && { overlay: overlayIndex }),
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
  const checked: MotionCheckResult = { ...rest, src: page, kind: overlay ? 'overlay' : 'scene', duration, errors: said?.errors ?? [], console: said?.console ?? [] };
  output.result(checked, () =>
    [
      `${page}: ${overlay ? `an overlay over the video, ${from.toFixed(2)}–${(from + duration).toFixed(2)} s` : `${duration} s`}, ${checked.width}×${checked.height}`,
      ...checked.stills.map((still) => `${still.t.toFixed(2)} s  ${still.file}`),
      ...(checked.sheet ? [`sheet  ${checked.sheet}`] : []),
      checked.errors.length > 0 ? `errors:\n${checked.errors.map((line) => `  ${line}`).join('\n')}` : 'no errors',
      ...(checked.console.length > 0 ? [`console:\n${checked.console.map((line) => `  ${line}`).join('\n')}`] : []),
    ].join('\n'),
  );
  return checked;
}

export interface MotionNewArgs {
  /** The folder's name in motion/ (default: the template's). */
  name?: string;
  /** An overlay's start (source seconds; default: the first clip's start). */
  at?: number;
  /** Seconds it lasts (a scene's output seconds, an overlay's source seconds; default: the template's, or the whole take). */
  duration?: number;
  /** A scene goes first, not last. */
  first?: boolean;
}

export interface MotionNewResult {
  template: string;
  kind: MotionTemplate['kind'];
  /** The page, from the project folder. */
  src: string;
  /** What was added to cuttle.json (`scenes` or `overlays`). */
  item: Record<string, unknown>;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** "end-card" as a label: "End card". */
const labelOf = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-/g, ' ')}`;

/** `cuttle motion templates`: the templates `motion new` copies. */
export async function motionTemplatesCommand(output: Output): Promise<{ templates: readonly MotionTemplate[] }> {
  const result = { templates: MOTION_TEMPLATES };
  output.result(result, () => MOTION_TEMPLATES.map((template) => `${template.name.padEnd(17)}${template.kind.padEnd(8)} ${template.description}`).join('\n'));
  return result;
}

/**
 * `cuttle motion new <template>`: copies a template into `motion/<name>/` and adds it to cuttle.json,
 * a scene at the end (`--first`: at the start) or an overlay over the clips (`--at`).
 */
export async function motionNewCommand(projectDir: string, template: string, args: MotionNewArgs, output: Output): Promise<MotionNewResult> {
  const info = MOTION_TEMPLATES.find((candidate) => candidate.name === template);
  if (!info) throw new CliError('usage', `no template "${template}" (${MOTION_TEMPLATES.map((candidate) => candidate.name).join(', ')})`);
  const name = args.name ?? template;
  if (!NAME.test(name)) throw new CliError('usage', `--name "${name}" must be lower-case letters, digits and dashes`);
  const file = await readProjectFile(projectDir);
  const clips = file.project.scenes.filter((scene) => scene.type === 'clip');
  if (info.kind === 'overlay' && clips.length === 0) throw new CliError('invalid-project', `${file.path} has no clips: an overlay goes over a clip`);
  // a folder of its own, beside any page there already
  let folder = name;
  for (let n = 2; await stat(join(file.dir, 'motion', folder)).then(() => true, () => false); n++) folder = `${name}-${n}`;
  const from = join(templatesFolder(import.meta.url), template);
  if (!(await stat(from).then((info) => info.isDirectory(), () => false))) throw new CliError('missing-file', `the template ${template} is missing from the motion kit (${from}): build the CLI again`);
  await cp(from, join(file.dir, 'motion', folder), { recursive: true });
  const src = `motion/${folder}/index.html`;
  const taken = usedIds(file.project);
  let item: Record<string, unknown>;
  if (info.kind === 'scene') {
    item = { type: 'motion', id: newId('scenes', taken), label: labelOf(folder), src, duration: args.duration ?? info.duration };
    const scenes = (file.raw.scenes as unknown[] | undefined) ?? [];
    file.raw.scenes = args.first ? [item, ...scenes] : [...scenes, item];
  } else {
    const start = Math.min(...clips.map((clip) => clip.from));
    const end = Math.max(...clips.map((clip) => clip.to));
    const at = args.at ?? start;
    const duration = args.duration ?? (info.whole ? Math.max(0.1, end - at) : info.duration);
    item = { id: newId('overlays', taken), label: labelOf(folder), src, at, duration: Math.round(duration * 1000) / 1000 };
    file.raw.overlays = [...((file.raw.overlays as unknown[] | undefined) ?? []), item];
  }
  await writeProjectFile(file, 'motion new');
  const result: MotionNewResult = { template, kind: info.kind, src, item };
  output.result(result, () =>
    info.kind === 'scene'
      ? `added ${src} as a ${String(item.duration)} s scene ${args.first ? 'at the start' : 'at the end'} (${String(item.id)})`
      : `added ${src} as an overlay over source ${String(item.at)} s for ${String(item.duration)} s (${String(item.id)})`,
  );
  return result;
}

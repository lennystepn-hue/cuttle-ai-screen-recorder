import { rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { MOTION_TEMPLATES, type MotionTemplate } from '@cuttle/motion-kit';
import { copyTemplate, MissingTemplateError } from '@cuttle/motion-kit/files';
import { newId, usedIds, type MotionScene } from '@cuttle/project';
import { crossfadeHalf, occurrences, sceneSpans } from '@cuttle/timeline';
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
  /** A scene of its own, an overlay over the video (checked where the video first shows it), or a transition (between its two scenes). */
  kind: 'scene' | 'overlay' | 'transition';
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
  const transitionIndex = scene || overlay ? -1 : project.scenes.findIndex((candidate) => candidate.transition?.enabled && same(candidate.transition.src));
  const transition = project.scenes[transitionIndex]?.transition;
  const item = scene ?? overlay ?? transition;
  // an overlay: the output seconds where the video first shows its stretch of the take
  let from = 0;
  let duration = args.duration ?? item?.duration ?? DEFAULT_SECONDS;
  if (overlay) {
    const shown = occurrences(sceneSpans(project.scenes, project.cuts), overlay.at, overlay.at + overlay.duration).find((occurrence) => occurrence !== undefined);
    if (!shown) throw new CliError('invalid-project', `the video does not show overlays[${overlayIndex}] (${page}): no clip covers source ${overlay.at}–${overlay.at + overlay.duration} s`);
    from = shown.start;
    duration = Math.round((shown.end - shown.start) * 1000) / 1000;
  }
  // a transition: the seconds around its cut, where it draws the video
  if (transition) {
    const spans = sceneSpans(project.scenes, project.cuts);
    const into = spans.find((span) => span.sceneIndex === transitionIndex);
    const before = into ? spans[into.index - 1] : undefined;
    const half = into && before ? crossfadeHalf(before, into, project.look.transition) : 0;
    if (!into || !before || half === 0) throw new CliError('invalid-project', `the video goes into scenes[${transitionIndex}] without its transition (${page}): it is the first scene, or right after a cut`);
    from = Math.round((into.start - half) * 1000) / 1000;
    duration = Math.round(2 * half * 1000) / 1000;
  }
  const last = Math.max(0, duration - 1 / project.output.fps);
  const offsets = args.at && args.at.length > 0 ? args.at : Array.from({ length: CHECK_FRAMES }, (_, i) => Math.round((i * last * 1000) / (CHECK_FRAMES - 1)) / 1000);
  const late = offsets.find((t) => t >= duration);
  if (late !== undefined) throw new CliError('usage', `--at ${late} is past the item's end (${duration} s)`);
  const times = offsets.map((t) => Math.round((from + t) * 1000) / 1000);
  const name = pageName(page);
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview', `motion-${name}`);
  const motion: MotionCheck = {
    src: page,
    duration,
    params: item?.params ?? {},
    network: item?.network ?? false,
    ...(item && 'motionBlur' in item && item.motionBlur && { motionBlur: item.motionBlur }),
    ...(overlay && { overlay: overlayIndex }),
    ...(transition && { transition: transitionIndex }),
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
  // what this page said (a transition is checked in the whole video, among the other pages)
  const said = result.motion?.find((report) => report.src === page) ?? (transition ? undefined : result.motion?.[0]);
  const { motion: _reports, ...rest } = result;
  const kind = overlay ? 'overlay' : transition ? 'transition' : 'scene';
  const checked: MotionCheckResult = { ...rest, src: page, kind, duration, errors: said?.errors ?? [], console: said?.console ?? [] };
  output.result(checked, () =>
    [
      `${page}: ${overlay ? `an overlay over the video, ${from.toFixed(2)}–${(from + duration).toFixed(2)} s` : transition ? `the transition into scenes[${transitionIndex}], ${from.toFixed(2)}–${(from + duration).toFixed(2)} s` : `${duration} s`}, ${checked.width}×${checked.height}`,
      ...checked.stills.map((still) => `${still.t.toFixed(2)} s  ${still.file}`),
      ...(checked.sheet ? [`sheet  ${checked.sheet}`] : []),
      checked.errors.length > 0 ? `errors:\n${checked.errors.map((line) => `  ${line}`).join('\n')}` : 'no errors',
      ...(checked.console.length > 0 ? [`console:\n${checked.console.map((line) => `  ${line}`).join('\n')}`] : []),
    ].join('\n'),
  );
  return checked;
}

/** Where an item goes in cuttle.json: options both `motion new` and `motion add` take. */
interface Placement {
  /** An overlay's start (source seconds; default: the first clip's start). */
  at?: number;
  /** Seconds it lasts (a scene's output seconds, an overlay's source seconds). */
  duration?: number;
  /** A scene goes first, not last. */
  first?: boolean;
  /** A scene goes right after this one, by id or place from 0. */
  after?: string;
  /** A transition: the scene it leads into, by id or place (from 0; default: the second scene). */
  into?: string;
}

export interface MotionNewArgs extends Placement {
  /** The folder's name in motion/ (default: the template's). */
  name?: string;
}

export interface MotionNewResult {
  template: string;
  kind: MotionTemplate['kind'];
  /** The page, from the project folder. */
  src: string;
  /** What was added to cuttle.json (a scene, an overlay, or a scene's `transition`). */
  item: Record<string, unknown>;
  /** A transition: the scene it leads into. */
  into?: number;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** "end-card" as a label: "End card" (and "device-3d": "Device 3D"). */
const labelOf = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-/g, ' ')}`.replace(/ 3d\b/, ' 3D');

/** A page's name for its label: its folder (motion/intro/index.html), else its file (motion/intro.html). */
const pageName = (src: string) => src.replace(/\/index\.html?$/i, '').replace(/\.html?$/i, '').split('/').at(-1) || 'page';

/** A scene by id or by place from 0; -1 when there is none. */
function sceneAt(scenes: readonly { id?: string }[], wanted: string): number {
  const byId = scenes.findIndex((candidate) => candidate.id === wanted);
  if (byId >= 0) return byId;
  return /^\d+$/.test(wanted) && Number(wanted) < scenes.length ? Number(wanted) : -1;
}

/**
 * Adds a page to cuttle.json as `kind`: a scene (at the end, `first`, or `after` a scene), an
 * overlay over the clips (from `at`, the first clip's start by default, for `duration`, else for
 * the rest of the clips when `whole`), or the transition `into` a scene. Durations default to
 * `duration` given by the caller's template.
 */
function place(
  file: Awaited<ReturnType<typeof readProjectFile>>,
  kind: MotionTemplate['kind'],
  src: string,
  label: string,
  args: Placement,
  defaults: { duration: number; whole?: boolean },
): { item: Record<string, unknown>; into?: number } {
  const scenes = file.project.scenes;
  const clips = scenes.filter((scene) => scene.type === 'clip');
  if (kind === 'overlay' && clips.length === 0) throw new CliError('invalid-project', `${file.path} has no clips: an overlay goes over a clip (a video without a recording is made of scenes)`);
  const taken = usedIds(file.project);
  if (kind === 'transition') {
    // a transition leads into a scene that has one before it
    const wanted = args.into ?? '1';
    const into = sceneAt(scenes, wanted);
    if (!(into >= 1)) throw new CliError('usage', `--into ${wanted}: a transition leads into a scene after the first (${scenes.length} scenes)`);
    const item = { src, duration: args.duration ?? defaults.duration };
    const raw = file.raw.scenes as Record<string, unknown>[];
    raw[into] = { ...raw[into], transition: item };
    return { item, into };
  }
  if (kind === 'scene') {
    if (args.first && args.after !== undefined) throw new CliError('usage', '--first or --after, not both');
    const item = { type: 'motion', id: newId('scenes', taken), label, src, duration: args.duration ?? defaults.duration };
    const raw = (file.raw.scenes as unknown[] | undefined) ?? [];
    let at = args.first ? 0 : raw.length;
    if (args.after !== undefined) {
      const after = sceneAt(scenes, args.after);
      if (after < 0) throw new CliError('usage', `--after ${args.after}: no scene with that id or place (${scenes.length} scenes)`);
      at = after + 1;
    }
    file.raw.scenes = [...raw.slice(0, at), item, ...raw.slice(at)];
    return { item };
  }
  const start = Math.min(...clips.map((clip) => clip.from));
  const end = Math.max(...clips.map((clip) => clip.to));
  const at = args.at ?? start;
  const duration = args.duration ?? (defaults.whole ? Math.max(0.1, end - at) : defaults.duration);
  const item = { id: newId('overlays', taken), label, src, at, duration: Math.round(duration * 1000) / 1000 };
  file.raw.overlays = [...((file.raw.overlays as unknown[] | undefined) ?? []), item];
  return { item };
}

/** What was added, for people. */
function saidAdded(kind: MotionTemplate['kind'], src: string, item: Record<string, unknown>, into: number | undefined, where: string): string {
  if (kind === 'transition') return `added ${src} as the ${String(item.duration)} s transition into scenes[${into}]`;
  if (kind === 'scene') return `added ${src} as a ${String(item.duration)} s scene ${where} (${String(item.id)})`;
  return `added ${src} as an overlay over source ${String(item.at)} s for ${String(item.duration)} s (${String(item.id)})`;
}

const whereOf = (args: Placement) => (args.first ? 'at the start' : args.after !== undefined ? `after scene ${args.after}` : 'at the end');

/** `cuttle motion templates`: the templates `motion new` copies, and the way to a page of your own. */
export async function motionTemplatesCommand(output: Output): Promise<{ templates: readonly MotionTemplate[]; ownPage: string }> {
  const ownPage = 'Templates are starting points, not the limit: write any page (motion/<name>/index.html: HTML, CSS, canvas, SVG, WebGL, Three.js) and add it with `cuttle motion add motion/<name>/index.html`.';
  const result = { templates: MOTION_TEMPLATES, ownPage };
  output.result(result, () => [...MOTION_TEMPLATES.map((template) => `${template.name.padEnd(17)}${template.kind.padEnd(8)} ${template.description}`), '', ownPage].join('\n'));
  return result;
}

/**
 * `cuttle motion new <template>`: copies a template into `motion/<name>/` and adds it to cuttle.json,
 * a scene at the end (`--first`: at the start; `--after`: after a scene) or an overlay over the clips
 * (`--at`), or the transition into a scene (`--into`). The copy is the project's to change.
 */
export async function motionNewCommand(projectDir: string, template: string, args: MotionNewArgs, output: Output): Promise<MotionNewResult> {
  const info = MOTION_TEMPLATES.find((candidate) => candidate.name === template);
  if (!info) throw new CliError('usage', `no template "${template}" (${MOTION_TEMPLATES.map((candidate) => candidate.name).join(', ')}); a page of your own goes in with \`motion add\``);
  const name = args.name ?? template;
  if (!NAME.test(name)) throw new CliError('usage', `--name "${name}" must be lower-case letters, digits and dashes`);
  const file = await readProjectFile(projectDir);
  // checked before anything is copied
  if (info.kind === 'overlay' && !file.project.scenes.some((scene) => scene.type === 'clip')) throw new CliError('invalid-project', `${file.path} has no clips: an overlay goes over a clip`);
  // a folder of its own, beside any page there already
  let src: string;
  try {
    src = await copyTemplate(file.dir, template, name, import.meta.url);
  } catch (error) {
    if (error instanceof MissingTemplateError) throw new CliError('missing-file', `${error.message}: build the CLI again`);
    throw error;
  }
  let placed: ReturnType<typeof place>;
  try {
    placed = place(file, info.kind, src, labelOf(src.split('/')[1]!), args, { duration: info.duration, ...(info.whole && { whole: true }) });
  } catch (error) {
    // nowhere to go: the copy goes again, so the next try gets the name
    await rm(join(file.dir, dirname(src)), { recursive: true, force: true });
    throw error;
  }
  const { item, into } = placed;
  await writeProjectFile(file, 'motion new');
  const result: MotionNewResult = { template, kind: info.kind, src, item, ...(into !== undefined && { into }) };
  output.result(result, () => saidAdded(info.kind, src, item, into, whereOf(args)));
  return result;
}

export interface MotionAddArgs extends Placement {
  /** What the page is in the video (default: a scene). */
  as?: string;
  /** Its name on the timeline (default: from its folder or file). */
  label?: string;
}

export interface MotionAddResult {
  kind: MotionTemplate['kind'];
  /** The page, from the project folder. */
  src: string;
  item: Record<string, unknown>;
  into?: number;
}

const KINDS = ['scene', 'overlay', 'transition'] as const;
/** A page of your own lasts this long unless told: a scene 3 s, a transition 0.8 s; an overlay the rest of the clips. */
const OWN_SECONDS = { scene: 3, overlay: 3, transition: 0.8 } as const;

/**
 * `cuttle motion add <page>`: a page you wrote (any page in the project) into the video: a scene
 * (at the end, `--first`, or `--after` a scene), an overlay over the clips (`--as overlay`, from
 * `--at`), or the transition into a scene (`--as transition --into`).
 */
export async function motionAddCommand(projectDir: string, page: string, args: MotionAddArgs, output: Output): Promise<MotionAddResult> {
  const kind = (args.as ?? 'scene') as MotionTemplate['kind'];
  if (!KINDS.includes(kind)) throw new CliError('usage', `--as ${args.as}: scene, overlay or transition`);
  const file = await readProjectFile(projectDir);
  const src = await pageOf(file.dir, page);
  if (!/\.html?$/i.test(src)) throw new CliError('usage', `${src} is not a page: a motion item is an .html file`);
  const label = args.label?.trim() || labelOf(pageName(src));
  const { item, into } = place(file, kind, src, label, args, { duration: OWN_SECONDS[kind], ...(kind === 'overlay' && args.duration === undefined && { whole: true }) });
  await writeProjectFile(file, 'motion add');
  const result: MotionAddResult = { kind, src, item, ...(into !== undefined && { into }) };
  output.result(result, () => `${saidAdded(kind, src, item, into, whereOf(args))}\ncheck it: cuttle motion check ${src}`);
  return result;
}

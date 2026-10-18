// The sounds motion pages ask for (`cuttle.sound`): a page that asks for any is opened once, as
// its item's first showing, and drawn once; what it asked for plays at every showing of the item,
// in output seconds, with the project's other sounds.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { KIT_FONTS } from '@cuttle/motion-kit';
import type { CuttleProject, MotionOverlay, MotionScene, SceneTransition } from '@cuttle/project';
import { crossfadeHalf, occurrences, pageTransition, sceneSpans } from '@cuttle/timeline';
import type { MotionPages } from '../job';
import { motionInit } from '../motion/init';
import { declaredParams, paramDefaults } from '../motion/params';
import type { PageSound } from '../motion/runtime';
import type { SoundCue } from '../music/runtime';
import { takeData, type TakeInputs } from '../motion/take';
import { MotionPage, type MotionPageOptions } from './motion';

/** One stretch of the video that shows a motion item: its output start and how long. */
export interface Showing {
  start: number;
  duration: number;
}

const milli = (value: number) => Math.round(value * 1000) / 1000;

/** A motion item: a scene, an overlay, or the transition into a scene (`index` is that scene's). */
export type ShownItem = { kind: 'scene'; index: number; item: MotionScene } | { kind: 'overlay'; index: number; item: MotionOverlay } | { kind: 'transition'; index: number; item: SceneTransition };

/**
 * Each showing of each motion item: a scene's one, an overlay's per stretch of clips that shows it, a
 * transition's around the cut into its scene.
 */
export function motionShowings(project: CuttleProject): (ShownItem & { showings: Showing[] })[] {
  const spans = sceneSpans(project.scenes, project.cuts);
  const out: ReturnType<typeof motionShowings> = [];
  project.scenes.forEach((scene, index) => {
    if (scene.type !== 'motion') return;
    const span = spans.find((candidate) => candidate.sceneIndex === index);
    if (span) out.push({ kind: 'scene', index, item: scene, showings: [{ start: span.start, duration: span.end - span.start }] });
  });
  project.scenes.forEach((scene, index) => {
    const into = scene.transition ? spans.find((candidate) => candidate.sceneIndex === index) : undefined;
    const before = into ? spans[into.index - 1] : undefined;
    if (!scene.transition || !into || !before || !pageTransition(before, into, project.look.transition)) return;
    const half = crossfadeHalf(before, into, project.look.transition);
    out.push({ kind: 'transition', index, item: scene.transition, showings: [{ start: into.start - half, duration: 2 * half }] });
  });
  project.overlays.forEach((overlay, index) => {
    if (!overlay.enabled) return;
    const shown = [...new Set(occurrences(spans, overlay.at, overlay.at + overlay.duration).filter((occurrence) => occurrence !== undefined))];
    if (shown.length > 0) out.push({ kind: 'overlay', index, item: overlay, showings: shown.map((occurrence) => ({ start: occurrence!.start, duration: occurrence!.end - occurrence!.start })) });
  });
  return out;
}

/**
 * Where a page's sounds play: one asked for `at` seconds into the item, at that point of every
 * showing it fits in; one asked for an output second, there when a showing covers it.
 */
export function soundsOfShowings(showings: readonly Showing[], sounds: readonly PageSound[]): SoundCue[] {
  const cues: SoundCue[] = [];
  for (const sound of sounds) {
    if (sound.video !== undefined) {
      const video = sound.video;
      if (showings.some((showing) => video >= showing.start - 1e-9 && video < showing.start + showing.duration)) cues.push({ at: milli(video), sound: sound.sound, volume: sound.volume });
      continue;
    }
    const at = sound.at ?? 0;
    for (const showing of showings) if (at >= 0 && at < showing.duration) cues.push({ at: milli(showing.start + at), sound: sound.sound, volume: sound.volume });
  }
  return cues.sort((a, b) => a.at - b.at);
}

/** Whether a page may ask for sounds: it, or a script beside it, calls `cuttle.sound`. */
async function asksForSounds(file: string): Promise<boolean> {
  const text = await readFile(file, 'utf8').catch(() => '');
  if (text.includes('cuttle.sound')) return true;
  const folder = dirname(file);
  const names = await readdir(folder).catch(() => [] as string[]);
  for (const name of names.filter((candidate) => /\.(m?js)$/i.test(candidate))) {
    if ((await readFile(join(folder, name), 'utf8').catch(() => '')).includes('cuttle.sound')) return true;
  }
  return false;
}

/** The sounds one motion item's page asked for, on the video: `name` is its label, else its id or `scenes[0]`. */
export interface ItemSounds {
  kind: ShownItem['kind'];
  index: number;
  name: string;
  cues: SoundCue[];
}

/** What a page asked for, by what it was asked with; kept across renders while nothing changes. */
export type PageSoundCache = Map<string, PageSound[]>;

/**
 * The sounds the project's motion pages ask for, in output seconds (none while the sound or the
 * effects are off). A page is opened only when it, or a script beside it, calls `cuttle.sound`; one
 * that fails says so in `errors`, and the rest play.
 * `changes` (a count of the pages' file changes) is part of what `cache` keeps a page's answer by.
 */
export async function motionSoundCues(
  project: CuttleProject,
  pages: MotionPages | undefined,
  take: TakeInputs,
  options: { cache?: PageSoundCache; changes?: number } & Pick<MotionPageOptions, 'kitDir' | 'loadTimeout' | 'frameTimeout'> = {},
): Promise<{ cues: SoundCue[]; errors: string[]; items: ItemSounds[] }> {
  const { audio } = project.look;
  if (!pages || !audio.enabled || !audio.effects) return { cues: [], errors: [], items: [] };
  const cues: SoundCue[] = [];
  const errors: string[] = [];
  const items: ItemSounds[] = [];
  for (const { kind, index, item, showings } of motionShowings(project)) {
    const file = (kind === 'scene' ? pages.scenes : kind === 'overlay' ? pages.overlays : pages.transitions)[index];
    if (file === undefined || !(await asksForSounds(file))) continue;
    const name = kind === 'transition' ? `scenes[${index}].transition` : `${kind === 'scene' ? 'scenes' : 'overlays'}[${index}]`;
    const first = showings[0]!;
    const key = JSON.stringify({ file, item, first, changes: options.changes ?? 0 });
    let sounds = options.cache?.get(key);
    if (!sounds) {
      let page: MotionPage | undefined;
      try {
        const declared = declaredParams(await readFile(file, 'utf8'));
        const window = kind === 'overlay' ? { from: item.at, to: item.at + item.duration } : null;
        const init = motionInit(project, item, name, first, {
          take: takeData(project, take, { width: project.output.width, height: project.output.height }, window),
          fonts: [...KIT_FONTS],
          defaults: paramDefaults(declared.params),
          transition: kind === 'transition',
        });
        const { kitDir, loadTimeout, frameTimeout } = options;
        page = await MotionPage.open({ file, root: pages.root, init, network: item.network, ...(kitDir && { kitDir }), ...(loadTimeout && { loadTimeout }), ...(frameTimeout && { frameTimeout }) });
        await page.frame(0);
        sounds = await page.sounds();
        options.cache?.set(key, sounds);
      } catch (error) {
        errors.push(`${name}: its sounds could not be read: ${(error as Error).message.split('\n')[0]}`);
        continue;
      } finally {
        page?.close();
      }
    }
    const played = soundsOfShowings(showings, sounds);
    const into = project.scenes[index];
    const label = kind === 'transition' ? `Transition into ${into?.label ?? into?.id ?? `scenes[${index}]`}` : (item.label ?? item.id ?? name);
    if (played.length > 0) items.push({ kind, index, name: label, cues: played });
    cues.push(...played);
  }
  return { cues: cues.sort((a, b) => a.at - b.at), errors, items };
}

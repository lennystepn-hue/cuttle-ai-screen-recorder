import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { brandsDir, readProjectFile } from '@cuttle/core';
import type { MotionItemReport, PageText } from '@cuttle/export';
import type { CuttleProject } from '@cuttle/project';
import { crossfadeHalf, occurrences, sceneSpans, totalDuration, type SceneSpan } from '@cuttle/timeline';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import type { PreviewResult } from './preview';

// `cuttle review`: what makes a video dull or hard to follow, measured on the frames the export
// draws (small ones, every quarter second or so) and on the text its motion pages show, so the notes
// are numbers rather than a feeling: an empty first frame, stretches where nothing changes, scenes
// that look alike or all come in the same way, lines too short to read or too small for a phone, no
// sound at all, and a look the last videos already had. A note is a question, not a rule.

/** What `review` measures; `--ignore` leaves kinds out. */
export const REVIEW_KINDS = ['first-frame', 'still', 'alike', 'entrances', 'unread', 'small-text', 'silent', 'same-as-before'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

/** P0 breaks the read (fix it first), P1 weakens the video, P2 is polish. */
export type ReviewWeight = 'P0' | 'P1' | 'P2';

export interface ReviewNote {
  weight: ReviewWeight;
  kind: ReviewKind;
  /** Output seconds where it is (its start). */
  t: number;
  /** The scene's id, or `scenes[<n>]`. */
  scene?: string;
  note: string;
}

/** A frame made small: RGB, row by row. */
export interface Thumb {
  width: number;
  height: number;
  rgb: Uint8Array;
}

/** The small frames' width. */
export const THUMB_WIDTH = 64;
/** Nothing changing for longer than this is a note; the last scene may hold a while longer (an end card). */
export const STILL_SECONDS = 3;
const LAST_SCENE_STILL_SECONDS = 4.5;
/** A line to read holds this long, and this much more a word. */
export const READ_SECONDS = 0.5;
export const READ_PER_WORD = 0.3;
/** Text smaller than this share of the short side is hard to read on a phone (28 px at 1080). */
export const SMALL_TEXT = 0.026;
/** A video longer than this without any sound is a note. */
const SILENT_SECONDS = 15;
/** How many reviewed videos are kept to compare with. */
const REMEMBERED = 50;

// ---- the frames ---------------------------------------------------------------------------------

export function thumbOf(width: number, height: number, base64: string): Thumb {
  return { width, height, rgb: new Uint8Array(Buffer.from(base64, 'base64')) };
}

function luma(thumb: Thumb): Float32Array {
  const out = new Float32Array(thumb.width * thumb.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * thumb.rgb[3 * i]! + 0.587 * thumb.rgb[3 * i + 1]! + 0.114 * thumb.rgb[3 * i + 2]!;
  return out;
}

/**
 * How much a frame holds: the spread of its brightness (0 for one flat colour) and its detail, the
 * mean brightness step between neighbours (a gradient has almost none, text and shapes have some),
 * counted only where `keep` says (a mask of its pixels; all of them without one), a step only
 * between two pixels it keeps.
 */
export function contentOf(thumb: Thumb, keep?: (x: number, y: number) => boolean): { spread: number; detail: number } {
  const y = luma(thumb);
  const { width, height } = thumb;
  let sum = 0;
  let squares = 0;
  let count = 0;
  let steps = 0;
  let stepCount = 0;
  for (let row = 0; row < height; row++) {
    for (let x = 0; x < width; x++) {
      if (keep && !keep(x, row)) continue;
      const value = y[row * width + x]!;
      sum += value;
      squares += value * value;
      count++;
      if (x + 1 < width && (!keep || keep(x + 1, row))) {
        steps += Math.abs(y[row * width + x + 1]! - value);
        stepCount++;
      }
      if (row + 1 < height && (!keep || keep(x, row + 1))) {
        steps += Math.abs(y[(row + 1) * width + x]! - value);
        stepCount++;
      }
    }
  }
  if (count === 0) return { spread: 0, detail: 0 };
  const mean = sum / count;
  return { spread: Math.sqrt(Math.max(0, squares / count - mean * mean)), detail: stepCount === 0 ? 0 : steps / stepCount };
}

/** The share of pixels whose brightness moved by more than a little from `a` to `b`. */
export function changeBetween(a: Thumb, b: Thumb): number {
  const [x, y] = [luma(a), luma(b)];
  let moved = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]! - y[i]!) > 6) moved++;
  return moved / x.length;
}

/** A frame's layout as 64 bits (a difference hash): where it is brighter left or right, on a 9×8 grid. */
export function layoutOf(thumb: Thumb): bigint {
  const y = luma(thumb);
  const { width, height } = thumb;
  const cell = (cx: number, cy: number) => {
    const [x0, x1] = [Math.floor((cx * width) / 9), Math.max(Math.floor((cx * width) / 9) + 1, Math.floor(((cx + 1) * width) / 9))];
    const [y0, y1] = [Math.floor((cy * height) / 8), Math.max(Math.floor((cy * height) / 8) + 1, Math.floor(((cy + 1) * height) / 8))];
    let sum = 0;
    for (let row = y0; row < y1; row++) for (let x = x0; x < x1; x++) sum += y[row * width + x]!;
    return sum / ((x1 - x0) * (y1 - y0));
  };
  let bits = 0n;
  for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) bits = (bits << 1n) | (cell(cx, cy) < cell(cx + 1, cy) ? 1n : 0n);
  return bits;
}

/** Bits that differ between two layouts (0 to 64). */
export function layoutDistance(a: bigint, b: bigint): number {
  let bits = a ^ b;
  let count = 0;
  for (; bits > 0n; bits >>= 1n) count += Number(bits & 1n);
  return count;
}

/** Its colours: a 4×4×4 histogram that sums to 1. */
export function paletteOf(...thumbs: Thumb[]): number[] {
  const bins = new Array<number>(64).fill(0);
  let count = 0;
  for (const thumb of thumbs) {
    for (let i = 0; i < thumb.rgb.length; i += 3) {
      bins[(thumb.rgb[i]! >> 6) * 16 + (thumb.rgb[i + 1]! >> 6) * 4 + (thumb.rgb[i + 2]! >> 6)]! += 1;
      count++;
    }
  }
  return bins.map((bin) => (count === 0 ? 0 : bin / count));
}

/** How far apart two palettes are, 0 (the same colours) to 1 (none in common). */
export function paletteDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - (b[i] ?? 0));
  return sum / 2;
}

/** Two frames that look alike: the same layout, near enough, in the same colours. */
const ALIKE = { layout: 8, palette: 0.25 };
/**
 * Below this detail a small frame shows only its ground: one colour or a gradient (about 0.5 for a
 * radial gradient over a 1080p frame, 2 and more with a title on it).
 */
const EMPTY_DETAIL = 0.8;

// ---- the review ---------------------------------------------------------------------------------

/** What the measures read: the video's scenes, its small frames in time order, and what its pages showed. */
export interface ReviewInput {
  project: CuttleProject;
  /** The output's size (CSS px of its pages). */
  size: { width: number; height: number };
  samples: { t: number; thumb: Thumb }[];
  /** Seconds between the evenly spaced samples. */
  step: number;
  /** The motion items' reports, their text included. */
  motion: readonly MotionItemReport[];
}

/** A scene as notes name it: its id, else its place. */
export const sceneName = (span: SceneSpan): string => span.scene.id ?? `scenes[${span.sceneIndex}]`;
/** In a note's sentence: its name, and its label in quotes. */
const called = (span: SceneSpan): string => `${sceneName(span)}${span.scene.label ? ` “${span.scene.label}”` : ''}`;
const seconds = (t: number) => `${(Math.round(t * 100) / 100).toFixed(2)} s`;
const quote = (text: string) => `“${text.length > 48 ? `${text.slice(0, 47)}…` : text}”`;
const words = (text: string) => text.split(/\s+/).filter((word) => /\w/u.test(word)).length;
/** How long a line of `count` words needs on screen. */
export const readingSeconds = (count: number) => READ_SECONDS + READ_PER_WORD * count;

/**
 * Where each scene shows: from after the way into it (half its crossfade or transition page) to its
 * end, its middle between; a scene of its own design (not a clip of the take) is `designed`.
 */
export function sceneMoments(project: CuttleProject): { span: SceneSpan; start: number; middle: number; end: number; designed: boolean }[] {
  const spans = sceneSpans(project.scenes, project.cuts);
  return spans.map((span, i) => {
    const half = i > 0 ? crossfadeHalf(spans[i - 1]!, span, project.look.transition) : 0;
    const start = Math.min(span.end, span.start + half + 0.04);
    return { span, start, middle: (start + span.end) / 2, end: span.end, designed: span.scene.type !== 'clip' };
  });
}

/** The sample nearest to `t`. */
function sampleAt(samples: ReviewInput['samples'], t: number): ReviewInput['samples'][number] {
  let best = samples[0]!;
  for (const sample of samples) if (Math.abs(sample.t - t) < Math.abs(best.t - t)) best = sample;
  return best;
}

/** Every note the measures make, P0 first, then by time. */
export function reviewNotes(input: ReviewInput, ignore: readonly ReviewKind[] = []): ReviewNote[] {
  const { project, samples } = input;
  if (samples.length === 0) return [];
  const scenes = sceneMoments(project);
  const duration = totalDuration(scenes.map((scene) => scene.span));
  const notes: ReviewNote[] = [];
  const add = (note: ReviewNote) => !ignore.includes(note.kind) && notes.push(note);
  const sceneAt = (t: number) => scenes.find((scene) => t >= scene.span.start && t < scene.span.end) ?? scenes.at(-1)!;
  const shortSide = Math.min(input.size.width, input.size.height);
  const texts = textBlocks(input.motion);

  // the first frame: the thumbnail a player shows before anyone presses play
  const first = scenes[0]!;
  const zero = sampleAt(samples, 0).thumb;
  const content = contentOf(zero);
  if (content.detail < EMPTY_DETAIL) {
    add({ weight: 'P0', kind: 'first-frame', t: 0, scene: sceneName(first.span), note: 'frame 0 is empty, only its ground (a colour or a gradient): it is the thumbnail a player shows. Open on something already there (the result, the product at work, the question with its input).' });
  } else if (first.span.scene.type === 'card') {
    add({ weight: 'P1', kind: 'first-frame', t: 0, scene: sceneName(first.span), note: `the video opens on a title card (${quote(first.span.scene.title)}): open on the thing itself, and let the name come later.` });
  } else {
    const shown = texts.filter((block) => block.times[0]! <= input.step / 2);
    if (shown.length > 0) {
      // the text's rects in the small frame, a pixel and a half around them for the smoothing
      const scale = zero.width / input.size.width;
      const inText = (x: number, y: number) => shown.some((block) => block.rects.some(([bx, by, bw, bh]) => x >= bx * scale - 1.5 && x <= (bx + bw) * scale + 1.5 && y >= by * scale - 1.5 && y <= (by + bh) * scale + 1.5));
      const rest = contentOf(zero, (x, y) => !inText(x, y));
      if (rest.detail < EMPTY_DETAIL) add({ weight: 'P1', kind: 'first-frame', t: 0, scene: sceneName(first.span), note: `frame 0 is text alone on a plain ground (${quote(shown[0]!.text)}): give the thumbnail a picture, the product or the result.` });
    }
  }

  // stretches where nothing changes
  let restFrom: number | undefined;
  const closeRest = (until: number) => {
    if (restFrom === undefined) return;
    const scene = sceneAt(restFrom);
    const allowed = scene === scenes.at(-1) ? LAST_SCENE_STILL_SECONDS : STILL_SECONDS;
    if (until - restFrom > allowed + 1e-6) {
      add({ weight: 'P1', kind: 'still', t: restFrom, scene: sceneName(scene.span), note: `nothing changes for ${(until - restFrom).toFixed(1)} s (${seconds(restFrom)} to ${seconds(until)}, in ${called(scene.span)}): something new every 2 to 4 s, or cut the stretch shorter.` });
    }
    restFrom = undefined;
  };
  for (let i = 1; i < samples.length; i++) {
    const still = changeBetween(samples[i - 1]!.thumb, samples[i]!.thumb) < 0.002;
    if (still) restFrom ??= samples[i - 1]!.t;
    else closeRest(samples[i - 1]!.t);
  }
  closeRest(samples.at(-1)!.t);

  // scenes of their own design that look alike, and that all come in the same way
  const designed = scenes.filter((scene) => scene.designed && scene.end - scene.start >= 1);
  const middles = designed.map((scene) => sampleAt(samples, scene.middle).thumb);
  const layouts = middles.map(layoutOf);
  const palettes = middles.map((thumb) => paletteOf(thumb));
  const group = designed.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i]!)));
  for (let i = 0; i < designed.length; i++) {
    for (let j = i + 1; j < designed.length; j++) {
      if (layoutDistance(layouts[i]!, layouts[j]!) <= ALIKE.layout && paletteDistance(palettes[i]!, palettes[j]!) <= ALIKE.palette) group[root(j)] = root(i);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < designed.length; i++) groups.set(root(i), [...(groups.get(root(i)) ?? []), i]);
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const named = members.map((i) => called(designed[i]!.span)).join(', ');
    const at = designed[members[0]!]!.middle;
    add(
      members.length >= 3
        ? { weight: 'P1', kind: 'alike', t: at, scene: sceneName(designed[members[0]!]!.span), note: `${members.length} scenes look alike, one layout in the same colours (${named}): give each its own idea and layout, or make them one scene that rebuilds.` }
        : { weight: 'P2', kind: 'alike', t: at, scene: sceneName(designed[members[0]!]!.span), note: `two scenes look alike (${named}): is the second a new step?` },
    );
  }
  const entrances = designed.filter((scene) => scene.end - scene.start >= 1.5).map((scene) => {
    const start = contentOf(sampleAt(samples, scene.start).thumb);
    const middle = contentOf(sampleAt(samples, scene.middle).thumb);
    return middle.detail > 0.5 && start.detail < middle.detail * 0.35;
  });
  if (entrances.length >= 3 && entrances.filter(Boolean).length >= Math.ceil(entrances.length * 0.75)) {
    const first = designed[entrances.indexOf(true)]!;
    add({ weight: 'P1', kind: 'entrances', t: first.start, scene: sceneName(first.span), note: `${entrances.filter(Boolean).length} of ${entrances.length} scenes start almost empty and build up: vary how scenes come in (cut in mid-move, enter through something on screen, start with it already there).` });
  }

  // text too short to read, and too small for a phone
  const end = duration - input.step;
  for (const block of texts) {
    const count = words(block.text);
    const from = block.times[0]!;
    const shown = block.times.at(-1)! - from + input.step;
    if (count >= 3 && block.times.at(-1)! < end && shown + input.step < readingSeconds(count)) {
      const scene = sceneAt(from);
      add({ weight: 'P1', kind: 'unread', t: from, scene: sceneName(scene.span), note: `${quote(block.text)} shows ${shown.toFixed(1)} s, ${count} words need ${readingSeconds(count).toFixed(1)} s (${block.src}): hold it longer or cut words.` });
    }
  }
  const spans = scenes.map((scene) => scene.span);
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'card') continue;
    const count = words(`${scene.title} ${scene.subtitle ?? ''}`);
    if (count >= 3 && span.end - span.start < readingSeconds(count)) {
      add({ weight: 'P1', kind: 'unread', t: span.start, scene: sceneName(span), note: `the card ${quote(scene.title)} shows ${(span.end - span.start).toFixed(1)} s, ${count} words need ${readingSeconds(count).toFixed(1)} s.` });
    }
  }
  for (const text of project.texts) {
    if (text.enabled === false) continue;
    const count = words(text.text);
    for (const [i, shown] of occurrences(spans, text.at, text.at + text.duration).entries()) {
      if (!shown || count < 3 || shown.end - shown.start >= readingSeconds(count)) continue;
      add({ weight: 'P1', kind: 'unread', t: shown.start, scene: sceneName(spans[i]!), note: `the text ${quote(text.text)} shows ${(shown.end - shown.start).toFixed(1)} s, ${count} words need ${readingSeconds(count).toFixed(1)} s.` });
    }
  }
  const smallest = SMALL_TEXT * shortSide;
  const small = new Map<string, TextBlock[]>();
  for (const block of texts) if (block.size < smallest && words(block.text) > 0) small.set(block.item, [...(small.get(block.item) ?? []), block]);
  for (const [item, blocks] of small) {
    const least = blocks.reduce((a, b) => (b.size < a.size ? b : a));
    const scene = sceneAt(least.times[0]!);
    add({
      weight: 'P1',
      kind: 'small-text',
      t: least.times[0]!,
      scene: sceneName(scene.span),
      note: `${blocks.length === 1 ? 'a text' : `${blocks.length} texts`} in ${item} (${least.src}) under ${Math.round(smallest)} px, the smallest ${Math.round(least.size)} px (${quote(least.text)}): too small on a phone; cut words rather than shrink type.`,
    });
  }

  // no sound at all
  if (duration > SILENT_SECONDS && !hasSound(project, input.motion)) {
    add({ weight: 'P1', kind: 'silent', t: 0, note: `the video is ${Math.round(duration)} s long and silent: no music, voice or sounds. Give it music written for it (music.md), or say why it stays quiet.` });
  }
  return notes.sort((a, b) => a.weight.localeCompare(b.weight) || a.t - b.t);
}

/** A block of a page's text over the frames that showed it. */
interface TextBlock {
  item: string;
  src: string;
  /** Its words as they stood last (a typed line, typed out). */
  text: string;
  /** Output seconds of the samples that showed it. */
  times: number[];
  /** Its largest size, in output px. */
  size: number;
  rects: PageText['rect'][];
}

function textBlocks(reports: readonly MotionItemReport[]): TextBlock[] {
  const blocks = new Map<string, TextBlock>();
  for (const report of reports) {
    for (const frame of report.text ?? []) {
      for (const block of frame.blocks) {
        const key = `${report.item}#${block.id}`;
        const known = blocks.get(key);
        if (!known) {
          blocks.set(key, { item: report.item, src: report.src, text: block.text, times: [frame.t], size: block.size, rects: [block.rect] });
          continue;
        }
        if (!known.times.includes(frame.t)) known.times.push(frame.t);
        if (block.text.length >= known.text.length) known.text = block.text;
        known.size = Math.max(known.size, block.size);
        known.rects.push(block.rect);
      }
    }
  }
  for (const block of blocks.values()) block.times.sort((a, b) => a - b);
  return [...blocks.values()];
}

/** Whether anything in the video makes a sound: music, a voice, sounds, a recording's, a page's. */
function hasSound(project: CuttleProject, reports: readonly MotionItemReport[]): boolean {
  if (project.music && project.music.enabled !== false) return true;
  if (project.voiceover.lines.some((line) => line.enabled !== false && (line.text.trim() !== '' || line.file !== undefined))) return true;
  if (project.sounds.some((sound) => sound.enabled !== false)) return true;
  if (project.scenes.some((scene) => scene.type === 'clip') && project.look.audio.enabled && (project.sources.mic !== undefined || project.sources.system !== undefined)) return true;
  return reports.some((report) => (report.sounds ?? 0) > 0);
}

// ---- videos reviewed before ---------------------------------------------------------------------

/** What `review` keeps of a video to tell the next one it looks the same: a few numbers, no pictures. */
export interface Fingerprint {
  dir: string;
  name: string;
  /** When it was reviewed (ISO). */
  at: string;
  palette: number[];
  /** The layouts of its scenes of their own design (hex). */
  layouts: string[];
}

/** Where the fingerprints are kept: CUTTLE_REVIEWS_FILE, else beside the brand kits (Cuttle's user data). */
export function reviewsFile(): string {
  return process.env.CUTTLE_REVIEWS_FILE || join(dirname(brandsDir()), 'reviews.json');
}

export function fingerprintOf(input: ReviewInput, dir: string, name: string, at = new Date()): Fingerprint {
  const scenes = sceneMoments(input.project).filter((scene) => scene.designed);
  return {
    dir,
    name,
    at: at.toISOString(),
    palette: paletteOf(...input.samples.map((sample) => sample.thumb)).map((share) => Math.round(share * 10000) / 10000),
    layouts: scenes.map((scene) => layoutOf(sampleAt(input.samples, scene.middle).thumb).toString(16)),
  };
}

/** The earlier video this one looks most like, when it does: its colours, and half its scenes' layouts or more. */
export function lookAlike(current: Fingerprint, others: readonly Fingerprint[]): Fingerprint | undefined {
  if (current.layouts.length === 0) return undefined;
  const layouts = current.layouts.map((hex) => BigInt(`0x${hex}`));
  let best: { other: Fingerprint; share: number } | undefined;
  for (const other of others) {
    if (other.dir === current.dir || paletteDistance(current.palette, other.palette) > ALIKE.palette) continue;
    const theirs = other.layouts.map((hex) => BigInt(`0x${hex}`));
    const share = layouts.filter((layout) => theirs.some((their) => layoutDistance(layout, their) <= ALIKE.layout)).length / layouts.length;
    if (share >= 0.5 && (!best || share > best.share)) best = { other, share };
  }
  return best?.other;
}

async function readFingerprints(file: string): Promise<Fingerprint[]> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { videos?: Fingerprint[] };
    return Array.isArray(parsed.videos) ? parsed.videos.filter((video) => typeof video?.dir === 'string' && Array.isArray(video.palette) && Array.isArray(video.layouts)) : [];
  } catch {
    return [];
  }
}

async function keepFingerprint(file: string, fingerprint: Fingerprint, others: readonly Fingerprint[]): Promise<void> {
  const videos = [fingerprint, ...others.filter((other) => other.dir !== fingerprint.dir)].slice(0, REMEMBERED);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ videos }, null, 2)}\n`);
  await rename(temporary, file);
}

// ---- the command --------------------------------------------------------------------------------

export interface ReviewArgs {
  format?: string;
  /** Folder for the stills (default: preview/review/ in the project). */
  out?: string;
  ignore?: string[];
  /** Keep no fingerprint of this video (and compare with none). */
  remember?: boolean;
}

export interface ReviewResult {
  notes: ReviewNote[];
  /** The stills to look at: each scene after it came in and at its middle, and across each cut. */
  stills: PreviewResult['stills'];
  sheet?: string;
  /** What was measured: the samples, their spacing, the seconds of the video. */
  measured: { samples: number; step: number; seconds: number };
  /** The earlier video it looks like (`same-as-before`). */
  like?: { name: string; dir: string; at: string };
  motion?: MotionItemReport[];
}

/** The video's moments that `review` renders: evenly spaced samples, and the ones to look at. */
export function reviewTimes(project: CuttleProject): { times: number[]; look: number[]; step: number } {
  const scenes = sceneMoments(project);
  const duration = totalDuration(scenes.map((scene) => scene.span));
  const step = Math.min(1, Math.max(0.25, Math.round((duration / 240) * 100) / 100));
  const last = Math.max(0, duration - 1 / project.output.fps);
  const round = (t: number) => Math.round(Math.min(last, Math.max(0, t)) * 1000) / 1000;
  const look = new Set<number>();
  for (const [i, scene] of scenes.entries()) {
    look.add(round(scene.start));
    look.add(round(scene.middle));
    if (i === 0) continue;
    // across the cut: 0.2 s before it, and after it (the scene's start, when it comes that soon)
    look.add(round(scene.span.start - 0.2));
    if (scene.start - scene.span.start > 0.3) look.add(round(scene.span.start + 0.2));
  }
  const times = new Set<number>(look);
  for (let t = 0; t <= last + 1e-9; t += step) times.add(round(t));
  return { times: [...times].sort((a, b) => a - b), look: [...look].sort((a, b) => a - b), step };
}

export async function reviewCommand(projectDir: string, args: ReviewArgs, output: Output, signal: AbortSignal): Promise<ReviewResult> {
  const unknown = (args.ignore ?? []).find((kind) => !(REVIEW_KINDS as readonly string[]).includes(kind));
  if (unknown !== undefined) throw new CliError('usage', `--ignore takes ${REVIEW_KINDS.join(', ')} (got "${unknown}")`);
  const file = await readProjectFile(projectDir);
  const { project } = file;
  const duration = totalDuration(sceneSpans(project.scenes, project.cuts));
  if (duration <= 0) throw new CliError('invalid-project', `${file.path} has no scenes yet; run "cuttle suggest" or add scenes`);
  const { times, look, step } = reviewTimes(project);
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview', 'review');
  output.info(`reviewing ${times.length} moments of ${duration.toFixed(1)} s, stills into ${outDir} …`);
  const rendered = await runInElectron<PreviewResult & { thumbs?: { width: number; height: number; frames: string[] } }>(
    {
      command: 'preview',
      projectDir: file.dir,
      outDir,
      times,
      quiet: true,
      clean: args.out === undefined,
      ...(args.format !== undefined && { format: args.format }),
      sheet: { columns: 4 },
      png: look.map((t) => times.indexOf(t)),
      thumbs: THUMB_WIDTH,
      text: true,
    },
    signal,
    (label, done, total) => output.info(`${label} ${done}/${total}`),
  );
  if (!rendered.thumbs) throw new CliError('render', 'the review got no frames back from the export');
  const { width, height, frames } = rendered.thumbs;
  const input: ReviewInput = {
    project,
    size: { width: rendered.width, height: rendered.height },
    samples: times.map((t, n) => ({ t, thumb: thumbOf(width, height, frames[n]!) })),
    step,
    motion: rendered.motion ?? [],
  };
  const ignore = (args.ignore ?? []) as ReviewKind[];
  const notes = reviewNotes(input, ignore);
  let like: Fingerprint | undefined;
  if (args.remember !== false) {
    const store = reviewsFile();
    const fingerprint = fingerprintOf(input, file.dir, file.dir.split(/[\\/]/).at(-1) ?? file.dir);
    const others = await readFingerprints(store);
    like = lookAlike(fingerprint, others);
    if (like && !ignore.includes('same-as-before')) {
      notes.push({ weight: 'P2', kind: 'same-as-before', t: 0, note: `it looks like ${like.name} (reviewed ${like.at.slice(0, 10)}): the same colours and layouts. Is that on purpose (a series), or take another look (story.md)?` });
    }
    await keepFingerprint(store, fingerprint, others).catch((error: Error) => output.warn(`the review's fingerprint was not kept: ${error.message}`));
  }
  const result: ReviewResult = {
    notes,
    stills: rendered.stills,
    ...(rendered.sheet && { sheet: rendered.sheet }),
    measured: { samples: times.length, step, seconds: Math.round(duration * 100) / 100 },
    ...(like && { like: { name: like.name, dir: like.dir, at: like.at } }),
    ...(rendered.motion && rendered.motion.length > 0 && { motion: rendered.motion.map(({ text: _text, ...report }) => report) }),
  };
  output.result(result, () =>
    [
      ...(notes.length === 0 ? ['no notes: nothing measured stands out (still look at the sheet)'] : notes.map((note) => `${note.weight}  ${seconds(note.t).padStart(8)}  ${(note.scene ?? '').padEnd(10)}  ${note.kind}: ${note.note}`)),
      ...(rendered.sheet ? [`sheet  ${rendered.sheet}`] : []),
      ...(rendered.motion ?? []).flatMap((report) => report.errors.map((error) => `error in ${report.item} (${report.src}): ${error}`)),
    ].join('\n'),
  );
  return result;
}

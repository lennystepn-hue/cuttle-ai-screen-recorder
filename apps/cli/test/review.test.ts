import { describe, expect, it } from 'vitest';
import type { MotionItemReport } from '@cuttle/export';
import { CURRENT_VERSION, parseProject, type CuttleProject } from '@cuttle/project';
import {
  changeBetween,
  contentOf,
  fingerprintOf,
  layoutDistance,
  layoutOf,
  lookAlike,
  paletteDistance,
  paletteOf,
  readingSeconds,
  reviewNotes,
  reviewTimes,
  type ReviewInput,
  type Thumb,
} from '../src/commands/review';

const W = 64;
const H = 36;

/** A small frame drawn by `paint(x, y)` → [r, g, b]. */
function thumb(paint: (x: number, y: number) => [number, number, number]): Thumb {
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgb.set(paint(x, y), 3 * (y * W + x));
  return { width: W, height: H, rgb };
}
const flat = (value = 20) => thumb(() => [value, value, value + 10]);
/** A layout: a light block at `x`..`x + w`, `y`..`y + h` on a dark ground. */
const block = (x0: number, y0: number, w: number, h: number, ground: [number, number, number] = [20, 20, 30]) =>
  thumb((x, y) => (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h ? [230, 230, 230] : ground));

function project(scenes: unknown[], extra: Record<string, unknown> = {}): CuttleProject {
  const parsed = parseProject({ version: CURRENT_VERSION, sources: { screen: 'takes/1/screen.mp4' }, scenes, ...extra });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}
const motion = (id: string, duration: number) => ({ type: 'motion', id, src: `motion/${id}/index.html`, duration });

/** Samples every quarter second, drawn by `frame(t)`. */
function samples(duration: number, frame: (t: number) => Thumb): ReviewInput['samples'] {
  const out: ReviewInput['samples'] = [];
  for (let t = 0; t < duration - 1e-9; t += 0.25) out.push({ t: Math.round(t * 1000) / 1000, thumb: frame(t) });
  return out;
}

/** A thumb that changes every sample (a moving block), so nothing is still. */
const moving = (t: number, x0 = 4, ground?: [number, number, number]) => block((x0 + Math.round(t * 8)) % 40, 10, 16, 12, ground);

const input = (p: CuttleProject, s: ReviewInput['samples'], motionReports: MotionItemReport[] = []): ReviewInput => ({
  project: p,
  size: { width: 1920, height: 1080 },
  samples: s,
  step: 0.25,
  motion: motionReports,
});
const kinds = (notes: { kind: string }[]) => notes.map((note) => note.kind);

describe('the measures', () => {
  it('tells a flat frame from one with something in it', () => {
    expect(contentOf(flat())).toEqual({ spread: 0, detail: 0 });
    const shapes = contentOf(block(10, 10, 20, 10));
    expect(shapes.spread).toBeGreaterThan(30);
    expect(shapes.detail).toBeGreaterThan(1);
    // only where `keep` says: the block left out, the frame is flat
    expect(contentOf(block(10, 10, 20, 10), (x, y) => !(x >= 8 && x < 32 && y >= 8 && y < 22)).detail).toBe(0);
  });

  it('measures change as the share of pixels that moved', () => {
    expect(changeBetween(flat(), flat())).toBe(0);
    expect(changeBetween(flat(20), flat(22))).toBe(0); // a flicker is no change
    expect(changeBetween(block(0, 0, 32, 36), block(32, 0, 32, 36))).toBe(1);
  });

  it('knows a layout and a palette again, and tells another apart', () => {
    expect(layoutDistance(layoutOf(block(10, 10, 20, 10)), layoutOf(block(10, 10, 20, 10)))).toBe(0);
    expect(layoutDistance(layoutOf(block(4, 4, 12, 8)), layoutOf(block(40, 20, 20, 14)))).toBeGreaterThan(8);
    expect(paletteDistance(paletteOf(flat()), paletteOf(flat()))).toBe(0);
    expect(paletteDistance(paletteOf(thumb(() => [250, 40, 40])), paletteOf(thumb(() => [40, 40, 250])))).toBe(1);
  });

  it('gives a line half a second and a third of one a word', () => {
    expect(readingSeconds(5)).toBeCloseTo(2);
  });
});

describe('reviewNotes', () => {
  it('says nothing about a video that moves, varies and sounds', () => {
    const p = project([motion('a', 3), motion('b', 3)], { music: { src: 'music/m/index.html' } });
    // a block moving on a dark ground, then on an orange one
    expect(reviewNotes(input(p, samples(6, (t) => (t < 3 ? moving(t) : moving(t, 30, [240, 140, 40])))))).toEqual([]);
  });

  it('finds an empty first frame (P0) and a title card first', () => {
    const empty = reviewNotes(input(project([motion('a', 3)]), samples(3, (t) => (t === 0 ? flat() : moving(t)))));
    expect(empty[0]).toMatchObject({ weight: 'P0', kind: 'first-frame', t: 0, scene: 'a' });
    // a gradient is no more than a colour
    const gradient = reviewNotes(input(project([motion('a', 3)]), samples(3, (t) => (t === 0 ? thumb((x, y) => [20 + x, 10 + y, 40 + x / 2]) : moving(t)))));
    expect(gradient[0]).toMatchObject({ weight: 'P0', kind: 'first-frame' });
    const card = reviewNotes(input(project([{ type: 'card', id: 'c', title: 'Cuttle', duration: 2 }, motion('a', 3)]), samples(5, moving)));
    expect(card.find((note) => note.kind === 'first-frame')).toMatchObject({ weight: 'P1', note: expect.stringContaining('title card') });
  });

  it('finds text alone on a plain ground in the first frame', () => {
    // a line of text in the middle (its rect in output px), nothing else
    const text: MotionItemReport = { item: 'scenes[0]', src: 'motion/a/index.html', errors: [], console: [], text: [{ t: 0, blocks: [{ id: 1, text: 'Ship it today', size: 120, rect: [600, 400, 720, 160] }] }] };
    const notes = reviewNotes(input(project([motion('a', 3)]), samples(3, (t) => (t === 0 ? block(20, 13, 24, 6) : moving(t))), [text]));
    expect(notes.find((note) => note.kind === 'first-frame')).toMatchObject({ weight: 'P1', note: expect.stringContaining('text alone') });
  });

  it('finds a stretch where nothing changes, and lets the last scene hold a while longer', () => {
    const p = project([motion('a', 6), motion('b', 6)]);
    const notes = reviewNotes(input(p, samples(12, (t) => (t >= 1 && t < 5 ? block(10, 10, 20, 10) : t >= 7 ? block(30, 5, 20, 10) : moving(t)))), ['silent']);
    const still = notes.filter((note) => note.kind === 'still');
    // 1 to 5 s in a: 4 s; 7 s to the end in b, the last scene: 4.75 s, past its 4.5 s
    expect(still.map((note) => [note.t, note.scene])).toEqual([[1, 'a'], [7, 'b']]);
  });

  it('finds scenes that look alike, and scenes that all start empty', () => {
    // four scenes: each starts dark and builds to the same block at its middle
    const p = project(['a', 'b', 'c', 'd'].map((id) => motion(id, 3)), { look: { transition: { enabled: false } } });
    const notes = reviewNotes(input(p, samples(12, (t) => (t % 3 < 0.3 ? flat() : t % 3 < 0.8 ? moving(t) : block(10 + Math.round(t % 3), 10, 20, 10)))), ['still', 'silent']);
    expect(notes.find((note) => note.kind === 'alike')).toMatchObject({ weight: 'P1', note: expect.stringMatching(/^4 scenes look alike/) });
    expect(notes.find((note) => note.kind === 'entrances')).toMatchObject({ weight: 'P1', note: expect.stringMatching(/^4 of 4 scenes start almost empty/) });
  });

  it('finds lines too short to read and text too small for a phone', () => {
    const report: MotionItemReport = {
      item: 'scenes[0]',
      src: 'motion/a/index.html',
      errors: [],
      console: [],
      text: [
        { t: 1, blocks: [{ id: 1, text: 'Six words is too many here', size: 80, rect: [100, 100, 900, 100] }, { id: 2, text: 'Q1 2026', size: 16, rect: [100, 900, 120, 20] }] },
        { t: 1.25, blocks: [{ id: 1, text: 'Six words is too many here', size: 80, rect: [100, 100, 900, 100] }] },
      ],
    };
    const notes = reviewNotes(input(project([motion('a', 4)]), samples(4, moving), [report]));
    expect(notes.find((note) => note.kind === 'unread')).toMatchObject({ t: 1, note: expect.stringContaining('6 words need 2.3 s') });
    expect(notes.find((note) => note.kind === 'small-text')).toMatchObject({ note: expect.stringContaining('the smallest 16 px') });
    // a card too short for its words, from the project itself
    const card = reviewNotes(input(project([motion('a', 2), { type: 'card', id: 'c', title: 'Every format in one go', duration: 1 }]), samples(3, moving)));
    expect(card.find((note) => note.kind === 'unread')).toMatchObject({ scene: 'c' });
  });

  it('finds a long video without any sound, and leaves out what it is told to', () => {
    const p = project([motion('a', 20)]);
    const notes = reviewNotes(input(p, samples(20, moving)));
    expect(kinds(notes)).toContain('silent');
    expect(kinds(reviewNotes(input(p, samples(20, moving)), ['silent']))).not.toContain('silent');
    const sounding: MotionItemReport = { item: 'scenes[0]', src: 'motion/a/index.html', errors: [], console: [], sounds: 2 };
    expect(kinds(reviewNotes(input(p, samples(20, moving), [sounding])))).not.toContain('silent');
  });
});

describe('reviewTimes', () => {
  it('samples the video evenly and adds each scene after it came in, its middle and its seams', () => {
    const p = project([motion('a', 3), motion('b', 3)], { look: { transition: { enabled: true, duration: 0.4 } } });
    const { times, look, step } = reviewTimes(p);
    expect(step).toBe(0.25);
    // a: from 0.04 s, its middle; 0.2 s before the seam at 3 s; b after half the crossfade (soon enough to show after the seam)
    expect(look).toEqual([0.04, 1.52, 2.8, 3.24, 4.62]);
    for (const t of look) expect(times).toContain(t);
    expect(times).toContain(5.75);
    expect(Math.max(...times)).toBeLessThan(6);
  });
});

describe('videos reviewed before', () => {
  it('knows a video that looks like an earlier one, never the same project', () => {
    const p = project(['a', 'b'].map((id) => motion(id, 3)));
    const frames = samples(6, (t) => block(t < 3 ? 4 : 30, 10, 20, 10));
    const now = fingerprintOf(input(p, frames), '/videos/new', 'new');
    const before = { ...fingerprintOf(input(p, frames), '/videos/old', 'old'), at: '2026-10-20T10:00:00.000Z' };
    const other = fingerprintOf(input(p, samples(6, () => thumb(() => [250, 120, 40]))), '/videos/orange', 'orange');
    expect(lookAlike(now, [other, before])?.name).toBe('old');
    expect(lookAlike(now, [{ ...before, dir: '/videos/new' }])).toBeUndefined();
    expect(lookAlike(now, [other])).toBeUndefined();
  });
});

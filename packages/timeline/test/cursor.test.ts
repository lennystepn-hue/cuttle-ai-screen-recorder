import { describe, expect, it } from 'vitest';
import type { InputEvent } from '@cuttle/project';
import { createCursorTrack, cursorAt } from '../src/cursor';

const events: InputEvent[] = [
  { t: 1, type: 'move', x: 100, y: 50 },
  { t: 0, type: 'move', x: 0, y: 0 },
  { t: 0.5, type: 'shape', shape: 'text' },
  { t: 2, type: 'click', x: 200, y: 100, button: 'left' },
  { t: 1.5, type: 'scroll', x: 100, y: 50, dx: 0, dy: -3 },
  { t: 3, type: 'keys', count: 4 },
];
const track = createCursorTrack(events);

describe('createCursorTrack', () => {
  it('sorts events and splits them into moves, clicks and shapes', () => {
    expect(track.moves.map((m) => m.t)).toEqual([0, 1, 2]);
    expect(track.clicks).toEqual([{ t: 2, x: 200, y: 100, button: 'left' }]);
    expect(track.shapes).toEqual([{ t: 0.5, shape: 'text' }]);
  });
});

describe('cursorAt', () => {
  it('interpolates the position and keeps the latest shape', () => {
    expect(cursorAt(track, 0.5, 1)).toEqual({ x: 50, y: 25, shape: 'text', clicks: [] });
    expect(cursorAt(track, 1.5, 1)).toMatchObject({ x: 150, y: 75 });
  });

  it('holds the first and last sample outside the logged range', () => {
    expect(cursorAt(track, -1, 1)).toEqual({ x: 0, y: 0, shape: 'arrow', clicks: [] });
    expect(cursorAt(track, 10, 1)).toMatchObject({ x: 200, y: 100, shape: 'text' });
  });

  it('runs a click effect for 0.4 output seconds', () => {
    const clicks = cursorAt(track, 2.2, 1)?.clicks;
    expect(clicks).toHaveLength(1);
    expect(clicks?.[0]).toMatchObject({ x: 200, y: 100 });
    expect(clicks?.[0]?.progress).toBeCloseTo(0.5, 6);
    expect(cursorAt(track, 2.5, 1)?.clicks).toEqual([]);
  });

  it('stretches the click effect with speed', () => {
    // speed 12 → 4.8 source seconds; 2.4 s after the click is the middle
    expect(cursorAt(track, 4.4, 12)?.clicks[0]?.progress).toBeCloseTo(0.5, 6);
  });

  it('returns undefined without any samples', () => {
    expect(cursorAt(createCursorTrack([]), 1, 1)).toBeUndefined();
  });
});

describe('the smoothed path', () => {
  /** A hand's move: 60 samples a second with jitter (deterministic), a click at 1 s, a rest, a jump. */
  const jittery: InputEvent[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    jittery.push({ t, type: 'move', x: 100 + 400 * t + (i % 2 ? 6 : -6), y: 300 + (i % 3) * 5 });
  }
  jittery.push({ t: 1, type: 'click', x: 500, y: 300, button: 'left' });
  for (let i = 1; i <= 30; i++) jittery.push({ t: 1 + i / 60, type: 'move', x: 500 + 10 * i + (i % 2 ? 4 : -4), y: 300 });
  // a rest of 2 s, then a jump to the other side of the screen
  jittery.push({ t: 3.5, type: 'move', x: 801, y: 301 });
  jittery.push({ t: 3.51, type: 'move', x: 1800, y: 900 });
  jittery.push({ t: 3.6, type: 'move', x: 1810, y: 905 });
  const hand = createCursorTrack(jittery);

  it('is the recorded path at smoothing 0', () => {
    expect(cursorAt(hand, 0.5, 1, 0)).toMatchObject(cursorAt(hand, 0.5, 1)!);
    expect(cursorAt(hand, 0.51, 1, 0)!.x).toBeCloseTo(100 + 400 * 0.51 + (Math.round(0.51 * 60) % 2 ? 6 : -6) - 0, -1);
  });

  it('is exactly at every click, at its time, whatever the smoothing', () => {
    for (const smoothing of [0.3, 0.5, 1]) expect(cursorAt(hand, 1, 1, smoothing)).toMatchObject({ x: 500, y: 300 });
  });

  it('takes the jitter out without lagging behind the hand', () => {
    const at = (t: number, smoothing: number) => cursorAt(hand, t, 1, smoothing)!;
    // the jitter (±6 px every sample) is gone: neighbouring frames differ by the move's own step
    const steps = (smoothing: number) => Array.from({ length: 40 }, (_, i) => Math.abs(at(0.2 + (i + 1) / 120, smoothing).x - at(0.2 + i / 120, smoothing).x));
    expect(Math.max(...steps(0.5))).toBeLessThan(5);
    expect(Math.max(...steps(0))).toBeGreaterThan(5);
    // zero-phase: in the middle of a steady move the smoothed cursor is where the hand is on average
    expect(at(0.5, 0.5).x).toBeCloseTo(100 + 400 * 0.5, -1);
  });

  it('holds still through a rest, and jumps where the pointer jumped', () => {
    const rested = cursorAt(hand, 1.5, 1, 0.5)!;
    expect(cursorAt(hand, 2.5, 1, 0.5)).toMatchObject({ x: rested.x, y: rested.y });
    expect(cursorAt(hand, 3.4, 1, 0.5)).toMatchObject({ x: rested.x, y: rested.y });
    expect(cursorAt(hand, 3.51, 1, 0.5)).toMatchObject({ x: 1800, y: 900 });
    expect(cursorAt(hand, 3.6, 1, 0.5)).toMatchObject({ x: 1810, y: 905 });
  });

  it('is made once per smoothing and track, and a few are kept', () => {
    cursorAt(hand, 0.3, 1, 0.8);
    const first = hand.smoothed!.get('0.8|');
    cursorAt(hand, 0.7, 1, 0.8);
    expect(hand.smoothed!.get('0.8|')).toBe(first);
    for (const smoothing of [0.1, 0.2, 0.3, 0.4, 0.6]) cursorAt(hand, 0.5, 1, smoothing);
    expect(hand.smoothed!.size).toBe(4);
  });

  it('keeps a fast flick a flick: it speeds up and slows down, with no jump and no slide', () => {
    // 60 samples a second; the hand speeds up to 449 px a sample and slows down again
    const steps = [43, 130, 260, 380, 449, 449, 380, 260, 130, 41];
    const flick: InputEvent[] = [{ t: 0, type: 'move', x: 0, y: 500 }];
    let x = 0;
    steps.forEach((dx, i) => flick.push({ t: (i + 1) / 60, type: 'move', x: (x += dx), y: 500 }));
    const track = createCursorTrack(flick);
    const xs = Array.from({ length: 12 }, (_, i) => cursorAt(track, i / 60, 1, 0.5)!.x);
    const moved = xs.slice(1).map((value, i) => value - xs[i]!);
    // no frame moves more than the hand's fastest step (no teleport), and it ends where the hand did
    expect(Math.max(...moved)).toBeLessThan(470);
    expect(xs.at(-1)).toBe(x);
    // the fastest frames are in the middle, as the hand's
    expect(moved.indexOf(Math.max(...moved))).toBeGreaterThanOrEqual(3);
    expect(moved.indexOf(Math.max(...moved))).toBeLessThanOrEqual(6);
  });

  it('jumps at a teleport out of a slow move, even a tenth of a second after it', () => {
    const teleport = createCursorTrack([
      ...Array.from({ length: 30 }, (_, i): InputEvent => ({ t: i / 60, type: 'move', x: 100 + i, y: 100 })),
      { t: 29 / 60 + 0.1, type: 'move', x: 1600, y: 900 },
      { t: 29 / 60 + 0.12, type: 'move', x: 1601, y: 900 },
    ]);
    // just before the teleport the cursor is still near where the hand was, not halfway across
    expect(cursorAt(teleport, 29 / 60 + 0.09, 1, 0.5)!.x).toBeLessThan(140);
    expect(cursorAt(teleport, 29 / 60 + 0.1, 1, 0.5)).toMatchObject({ x: 1600, y: 900 });
  });

  it('keeps the two sides of a cut apart: the frame before it is where the hand was then', () => {
    const steady = createCursorTrack(Array.from({ length: 121 }, (_, i): InputEvent => ({ t: i / 60, type: 'move', x: i * 10 + (i % 2 ? 4 : -4), y: 0 })));
    // a cut at 1 s: on its left, the cursor ends on the recorded path's place at 1 s
    expect(cursorAt(steady, 1, 1, 1, [1])!.x).toBeCloseTo(600 - 4, 0);
  });

  it('puts the cursor on a click made in the same millisecond as a move', () => {
    const same = createCursorTrack([
      { t: 0, type: 'move', x: 0, y: 0 },
      { t: 1, type: 'click', x: 500, y: 300, button: 'left' },
      { t: 1, type: 'move', x: 520, y: 310 },
      { t: 2, type: 'move', x: 600, y: 400 },
    ]);
    for (const smoothing of [0, 0.5]) expect(cursorAt(same, 1, 1, smoothing)).toMatchObject({ x: 500, y: 300 });
  });

  it('smooths a twenty-minute move without a rest, a click or a jump (one stretch)', () => {
    const long = createCursorTrack(Array.from({ length: 20 * 60 * 60 }, (_, i): InputEvent => ({ t: i / 60, type: 'move', x: 500 + 300 * Math.sin(i / 100), y: 300 + 200 * Math.cos(i / 130) })));
    expect(cursorAt(long, 600, 1, 0.5)).toBeDefined();
  });
});

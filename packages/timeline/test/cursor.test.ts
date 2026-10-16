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

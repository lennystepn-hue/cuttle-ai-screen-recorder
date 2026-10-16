import { describe, expect, it } from 'vitest';
import type { ClipScene, Scene } from '@cuttle/project';
import { sceneDuration, sceneSpans, sourceTimeAt, spanAt, totalDuration } from '../src/time';

const clip = (from: number, to: number, speed = 1): ClipScene => ({ type: 'clip', from, to, speed });
const scenes: Scene[] = [clip(10, 20), clip(20, 140, 12), { type: 'card', title: 'End', duration: 2 }];

describe('sceneDuration', () => {
  it('divides clip length by speed and uses duration for other scenes', () => {
    expect(sceneDuration(clip(10, 20))).toBe(10);
    expect(sceneDuration(clip(20, 140, 12))).toBe(10);
    expect(sceneDuration({ type: 'card', title: 'End', duration: 2 })).toBe(2);
  });
});

describe('sceneSpans and totalDuration', () => {
  it('lays scenes end to end', () => {
    const spans = sceneSpans(scenes);
    expect(spans.map((s) => [s.index, s.start, s.end])).toEqual([
      [0, 0, 10],
      [1, 10, 20],
      [2, 20, 22],
    ]);
    expect(totalDuration(spans)).toBe(22);
    expect(totalDuration([])).toBe(0);
  });

  it('snaps summed scene lengths so boundaries land exactly on frame times', () => {
    const spans = sceneSpans(Array.from({ length: 10 }, () => clip(0, 0.1)));
    expect(spanAt(spans, 0.3)?.index).toBe(3);
    expect(spanAt(spans, 9 / 30)?.index).toBe(3);
    expect(totalDuration(spans)).toBe(1);
  });
});

describe('spanAt', () => {
  const spans = sceneSpans(scenes);
  it('finds the span that contains t, with starts inclusive and ends exclusive', () => {
    expect(spanAt(spans, 0)?.index).toBe(0);
    expect(spanAt(spans, 9.99)?.index).toBe(0);
    expect(spanAt(spans, 10)?.index).toBe(1);
    expect(spanAt(spans, 21.9)?.index).toBe(2);
  });

  it('clamps to the first and last span', () => {
    expect(spanAt(spans, -1)?.index).toBe(0);
    expect(spanAt(spans, 22)?.index).toBe(2);
    expect(spanAt(spans, 100)?.index).toBe(2);
    expect(spanAt([], 1)).toBeUndefined();
  });
});

describe('sourceTimeAt', () => {
  it('maps local scene time to source time with speed and clamps to the clip', () => {
    expect(sourceTimeAt(clip(20, 140, 12), 5)).toBe(80);
    expect(sourceTimeAt(clip(20, 140, 12), -1)).toBe(20);
    expect(sourceTimeAt(clip(20, 140, 12), 50)).toBe(140);
  });

  it('never exceeds the clip end, even when rounding would push it past', () => {
    const c = clip(0.1, 0.7, 3);
    expect(sourceTimeAt(c, sceneDuration(c))).toBe(0.7);
    // 0 + (0.7 / 0.3) * 0.3 rounds up to 0.7000000000000001 without the clamp.
    const slow = clip(0, 0.7, 0.3);
    expect(sourceTimeAt(slow, sceneDuration(slow))).toBe(0.7);
  });
});

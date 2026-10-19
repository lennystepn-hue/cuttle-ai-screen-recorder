import { describe, expect, it } from 'vitest';
import type { ClipScene, Scene } from '@cuttle/project';
import { crossfadeHalf, isContinuousCut, maskEdges, outputTimesOf, pageTransition, sceneDuration, sceneSpans, sourceTimeAt, spanAt, totalDuration } from '../src/time';

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

describe('outputTimesOf and maskEdges', () => {
  // 10 s at normal speed, then 12 s at 12× (1 s of video), then a card
  const spans = sceneSpans([clip(0, 10), clip(10, 22, 12), { type: 'card', title: 'End', duration: 2 }]);

  it('finds where the clips show a source second, at their speed (none where no clip shows it)', () => {
    expect(outputTimesOf(spans, 5)).toEqual([5]);
    expect(outputTimesOf(spans, 16)).toEqual([10.5]);
    expect(outputTimesOf(spans, 25)).toEqual([]);
  });

  it("looks just before, inside and after a mask's start and end, in output seconds", () => {
    expect(maskEdges({ from: 3, to: 6 }, spans)).toEqual([
      { edge: 'before', t: 2.9, source: 2.9 },
      { edge: 'start', t: 3.1, source: 3.1 },
      { edge: 'end', t: 5.9, source: 5.9 },
      { edge: 'after', t: 6.1, source: 6.1 },
    ]);
    // its end in the sped-up clip: 5.9 s into it is 0.49 s of video
    expect(maskEdges({ from: 9, to: 16 }, spans).map(({ edge, t }) => [edge, t])).toEqual([
      ['before', 8.9],
      ['start', 9.1],
      ['end', 10.492],
      ['after', 10.508],
    ]);
  });

  it('looks at a short mask once inside, and leaves out moments no clip shows', () => {
    expect(maskEdges({ from: 4, to: 4.15 }, spans).map(({ edge, t }) => [edge, t])).toEqual([
      ['before', 3.9],
      ['start', 4.075],
      ['after', 4.25],
    ]);
    expect(maskEdges({ from: 0, to: 2 }, spans).map(({ edge }) => edge)).toEqual(['start', 'end', 'after']);
  });
});

describe('isContinuousCut', () => {
  it('is a cut between clips where the first ends where the second begins, within 1 ms', () => {
    expect(isContinuousCut(clip(10, 20), clip(20, 140, 12))).toBe(true);
    expect(isContinuousCut(clip(10, 20.0004), clip(20, 30))).toBe(true);
    expect(isContinuousCut(clip(10, 20), clip(20.002, 30))).toBe(false);
    expect(isContinuousCut(clip(10, 20), clip(0, 10))).toBe(false);
    expect(isContinuousCut(clip(10, 20), { type: 'card', title: 'End', duration: 2 })).toBe(false);
  });
});

describe('crossfadeHalf', () => {
  const spans = sceneSpans([clip(0, 10), clip(10, 12), clip(20, 21), { type: 'card', title: 'End', duration: 0.2 }]);
  const on = { enabled: true, duration: 0.4 };
  it('is half the transition, capped by half of either span, and none at a continuous cut or when off', () => {
    expect(crossfadeHalf(spans[0]!, spans[1]!, on)).toBe(0);
    expect(crossfadeHalf(spans[1]!, spans[2]!, on)).toBe(0.2);
    expect(crossfadeHalf(spans[2]!, spans[3]!, on)).toBeCloseTo(0.1, 9);
    expect(crossfadeHalf(spans[1]!, spans[2]!, { enabled: false, duration: 0.4 })).toBe(0);
  });

  it('is half of a scene\'s own transition into it, also with crossfades off, and never at a continuous cut', () => {
    const into = (duration: number, enabled = true) => ({ ...clip(20, 21), transition: { src: 'fold.html', params: {}, network: false, duration, enabled } });
    const off = { enabled: false, duration: 0.4 };
    const own = sceneSpans([clip(0, 10), clip(10, 12), into(0.8), { ...clip(21, 23), transition: { src: 'fold.html', params: {}, network: false, duration: 0.8, enabled: true } }]);
    expect(crossfadeHalf(own[1]!, own[2]!, off)).toBe(0.4);
    expect(pageTransition(own[1]!, own[2]!, off)).toBe(true);
    // capped by half the span into which it goes (1 s), and none where the footage runs on
    expect(crossfadeHalf(own[1]!, sceneSpans([clip(0, 10), clip(10, 12), into(3)])[2]!, off)).toBe(0.5);
    expect([crossfadeHalf(own[2]!, own[3]!, off), pageTransition(own[2]!, own[3]!, off)]).toEqual([0, false]);
    // switched off: the look's crossfade, or none
    const switched = sceneSpans([clip(0, 10), clip(10, 12), into(0.8, false)]);
    expect([crossfadeHalf(switched[1]!, switched[2]!, on), pageTransition(switched[1]!, switched[2]!, on)]).toEqual([0.2, false]);
    expect(crossfadeHalf(switched[1]!, switched[2]!, off)).toBe(0);
  });
});

describe('cuts', () => {
  const cut = (from: number, to: number, enabled = true) => ({ from, to, enabled });

  it('takes source ranges out of the clips that cover them: pieces with their scene, a jump between them', () => {
    const spans = sceneSpans([clip(0, 10), clip(10, 40, 2), { type: 'card', title: 'End', duration: 2 }], [cut(3, 4), cut(20, 30), cut(50, 60)]);
    expect(spans.map((s) => [s.index, s.sceneIndex, s.start, s.end, s.cutBefore ?? false])).toEqual([
      [0, 0, 0, 3, false],
      [1, 0, 3, 9, true],
      [2, 1, 9, 14, false],
      [3, 1, 14, 19, true],
      [4, 2, 19, 21, false],
    ]);
    expect(spans.map((s) => (s.scene.type === 'clip' ? [s.scene.from, s.scene.to] : s.scene.type))).toEqual([[0, 3], [4, 10], [10, 20], [30, 40], 'card']);
  });

  it('ignores cuts that are off, joins cuts that overlap, drops a piece shorter than 20 ms and a clip cut whole', () => {
    expect(sceneSpans([clip(0, 10)], [cut(2, 3, false)]).map((s) => s.end)).toEqual([10]);
    expect(sceneSpans([clip(0, 10)], [cut(2, 5), cut(4, 6)]).map((s) => s.scene.type === 'clip' && [s.scene.from, s.scene.to])).toEqual([[0, 2], [6, 10]]);
    expect(sceneSpans([clip(0, 10)], [cut(0.01, 9)]).map((s) => s.scene.type === 'clip' && s.scene.from)).toEqual([9]);
    expect(sceneSpans([clip(0, 10), clip(20, 30)], [cut(0, 10)]).map((s) => [s.sceneIndex, s.start])).toEqual([[1, 0]]);
  });

  it('has no crossfade at a cut', () => {
    const spans = sceneSpans([clip(0, 10)], [cut(4, 5)]);
    expect(crossfadeHalf(spans[0]!, spans[1]!, { enabled: true, duration: 0.3 })).toBe(0);
  });
});

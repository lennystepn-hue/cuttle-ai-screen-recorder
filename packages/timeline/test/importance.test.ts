import { describe, expect, it } from 'vitest';
import type { InputEvent, Scene } from '@cuttle/project';
import { HIGH, LENGTH_RULES, LOW, MIDDLE, fitLength, importance, type ImportanceInput } from '../src/importance';
import { sceneSpans } from '../src/time';

const clip = (from: number, to: number, speed = 1): Scene => ({ type: 'clip', from, to, speed });
const input = (scenes: Scene[], parts: Partial<ImportanceInput> = {}, cuts: { from: number; to: number }[] = []): ImportanceInput => ({
  spans: sceneSpans(scenes, cuts),
  speech: [],
  events: [],
  changes: [],
  ...parts,
});
/** The level of the slot at output second `t`. */
const at = (levels: readonly number[], t: number) => levels[Math.floor(t / LENGTH_RULES.slot)];

describe('importance', () => {
  it('is high for speech, a click, typing, what must stay and a scene’s first second; middle where the screen changes or the pointer moves; low at rest', () => {
    const events: InputEvent[] = [
      { t: 5, type: 'click', x: 1, y: 1, button: 'left' },
      { t: 7, type: 'keys', count: 3 },
      { t: 9.6, type: 'move', x: 1, y: 1 },
    ];
    const levels = importance(input([clip(0, 12)], { speech: [{ from: 2, to: 3 }], events, changes: [{ from: 8, to: 9 }], keep: [{ from: 11, to: 11.5 }] }));
    expect(levels).toHaveLength(48);
    expect(at(levels, 0.5)).toBe(HIGH); // the scene's first second
    expect(at(levels, 1.5)).toBe(LOW);
    expect(at(levels, 2.5)).toBe(HIGH); // speech
    expect(at(levels, 4.8)).toBe(HIGH); // 0.3 s around the click
    expect(at(levels, 6)).toBe(LOW);
    expect(at(levels, 7.3)).toBe(HIGH); // keys
    expect(at(levels, 8.5)).toBe(MIDDLE); // the screen changed
    expect(at(levels, 9.6)).toBe(MIDDLE); // the pointer moved
    expect(at(levels, 10.5)).toBe(LOW);
    expect(at(levels, 11.2)).toBe(HIGH); // the answer's zoom, a text
  });

  it('keeps stills and cards, and a cut’s piece is no new scene', () => {
    const levels = importance(input([clip(0, 4), { type: 'card', title: 'Hi', duration: 2 } as Scene, clip(10, 14)], {}, [{ from: 1.5, to: 2 }]));
    // the clip's pieces 0–1.5 and 2–4 (3.5 s), the card (2 s), then the second clip (4 s)
    expect(levels).toHaveLength(Math.ceil(9.5 / 0.25));
    expect(at(levels, 2)).toBe(LOW); // after the cut: the same scene goes on
    expect(at(levels, 4)).toBe(HIGH); // the card
    expect(at(levels, 5.6)).toBe(HIGH); // the second clip's first second
    expect(at(levels, 7)).toBe(LOW);
  });
});

describe('fitLength', () => {
  it('cuts the longest stretch at rest first, from its middle, as much as is needed', () => {
    // 20 s: speech from 2 to 5, rest to 12, the screen changes from 12 to 16, rest to the end
    const scenes = [clip(0, 20)];
    const parts = { speech: [{ from: 2, to: 5 }], changes: [{ from: 12, to: 16 }] };
    const fit = fitLength(input(scenes, parts), 14);
    expect(fit).toEqual({ cuts: [{ from: 5.5, to: 11.5 }], length: 14, reached: true });
    // the video is that long once the cuts are made
    expect(sceneSpans(scenes, fit.cuts).at(-1)!.end).toBeCloseTo(14, 6);
  });

  it('takes the rest’s runs in turn, then where the screen changes, never speech: as short as it can be', () => {
    const scenes = [clip(0, 20)];
    const parts = { speech: [{ from: 2, to: 5 }], changes: [{ from: 12, to: 16 }] };
    // without touching what changes: 1.1–1.9, 5.1–11.9 and 16.1–19.9 go (11.4 s)
    const rest = fitLength(input(scenes, parts), 8.6);
    expect(rest.cuts).toEqual([{ from: 1.1, to: 1.9 }, { from: 5.1, to: 11.9 }, { from: 16.1, to: 19.9 }]);
    expect(rest.reached).toBe(true);
    // shorter: the changing screen goes too; the first second and the speech stay
    const shortest = fitLength(input(scenes, parts), 2);
    expect(shortest.reached).toBe(false);
    for (const cut of shortest.cuts) expect(cut.to <= 2 || cut.from >= 5).toBe(true);
    expect(shortest.cuts.some((cut) => cut.from < 14 && 14 < cut.to)).toBe(true);
    expect(shortest.length).toBeGreaterThan(4);
    expect(shortest.length).toBeLessThan(6);
  });

  it('cuts nothing when the video already fits, or when only speech is left', () => {
    expect(fitLength(input([clip(0, 10)]), 12)).toEqual({ cuts: [], length: 10, reached: true });
    expect(fitLength(input([clip(0, 10)], { speech: [{ from: 0, to: 10 }] }), 5)).toEqual({ cuts: [], length: 10, reached: false });
  });

  it('leaves a run shorter than 0.6 s, and cuts a sped-up clip in its source seconds', () => {
    // rest from 1.2 to 1.6 only (speech around it): nothing to cut
    expect(fitLength(input([clip(0, 4)], { speech: [{ from: 1, to: 1.2 }, { from: 1.6, to: 4 }] }), 3).cuts).toEqual([]);
    // 40 s at 8× is 5 s of output: 2 s of it go, 16 source seconds
    const fit = fitLength(input([clip(0, 40, 8)]), 3);
    expect(fit.length).toBe(3);
    const [cut] = fit.cuts;
    expect(cut!.to - cut!.from).toBeCloseTo(16, 6);
  });
});

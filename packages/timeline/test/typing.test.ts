import { describe, expect, it } from 'vitest';
import type { InputEvent, Look, Scene } from '@cuttle/project';
import { sceneSpans } from '../src/time';
import { TYPING_RULES, clickSamples, keyPresses, mixTyping, typingClicks } from '../src/typing';

const keys = (t: number, count: number): InputEvent => ({ t, type: 'keys', count });
const clip = (from: number, to: number, speed = 1): Scene => ({ type: 'clip', from, to, speed });
const audio: Look['audio'] = { enabled: true, muteSpedUp: true, cleanup: true, typing: true, typingVolume: 0.5, effects: true, effectsVolume: 0.8, system: true, systemVolume: 0.8, systemDuck: 12 };
/** The largest absolute sample (a spread of a long track would overflow the stack). */
const peakOf = (samples: Float32Array) => samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
/** The share of a sound's energy below `cutoff` Hz (a one-pole low-pass). */
const lowShare = (samples: Float32Array, cutoff = 500) => {
  const a = Math.exp((-2 * Math.PI * cutoff) / 48_000);
  let y = 0;
  let low = 0;
  let all = 0;
  for (const x of samples) {
    y = (1 - a) * x + a * y;
    low += y * y;
    all += x * x;
  }
  return low / all;
};

describe('key presses', () => {
  it('spreads a half second’s count over it, each press a little early or late, the same every time', () => {
    const presses = keyPresses([keys(2, 4), keys(2.5, 1)]);
    expect(presses).toHaveLength(5);
    // four presses in [2, 2.5), one in each eighth of a second (± its jitter), and one in [2.5, 3)
    presses.slice(0, 4).forEach((press, k) => {
      expect(press.t).toBeGreaterThanOrEqual(2 + 0.125 * (k + 0.5 - TYPING_RULES.jitter) - 1e-9);
      expect(press.t).toBeLessThanOrEqual(2 + 0.125 * (k + 0.5 + TYPING_RULES.jitter) + 1e-9);
    });
    expect(presses[4]!.t).toBeGreaterThanOrEqual(2.5);
    expect(presses[4]!.t).toBeLessThan(3);
    expect(keyPresses([keys(2, 4), keys(2.5, 1)])).toEqual(presses);
    // other input is not typing
    expect(keyPresses([{ t: 1, type: 'click', x: 1, y: 1, button: 'left' }])).toEqual([]);
  });

  it('makes about one press in six a wide key', () => {
    const presses = keyPresses(Array.from({ length: 200 }, (_, k) => keys(k * 0.5, 6)));
    const wide = presses.filter((press) => press.wide).length / presses.length;
    expect(wide).toBeGreaterThan(0.12);
    expect(wide).toBeLessThan(0.22);
  });
});

describe('typing clicks', () => {
  it('clicks where the clip shows each press, and leaves out what a cut or another clip leaves out', () => {
    const events = [keys(1, 2), keys(5, 2), keys(9, 2)];
    // 0–4 s, then 8–12 s; a cut takes 9–9.5 out
    const spans = sceneSpans([clip(0, 4), clip(8, 12)], [{ from: 9, to: 9.5 }]);
    const clicks = typingClicks(spans, events, audio);
    const presses = keyPresses(events);
    // the presses at 1 s (output 1 s); at 5 s none (no clip shows it); at 9 s cut out
    expect(clicks.map((click) => click.at)).toEqual(presses.filter((press) => press.t < 4).map((press) => press.t));
    for (const click of clicks) {
      expect(click.variant).toBeGreaterThanOrEqual(0);
      expect(click.variant).toBeLessThan(TYPING_RULES.variants);
      expect(click.gain).toBeGreaterThan(0.7);
      expect(click.gain).toBeLessThan(1.3);
    }
  });

  it('clicks twice for a stretch the video shows twice, and after the cut where the clip goes on', () => {
    const events = [keys(1, 1), keys(10, 1)];
    const presses = keyPresses(events);
    const spans = sceneSpans([clip(0, 2), clip(0, 2), clip(9, 11)]);
    const at = typingClicks(spans, events, audio).map((click) => click.at);
    expect(at).toHaveLength(3);
    [presses[0]!.t, 2 + presses[0]!.t, 4 + presses[1]!.t - 9].forEach((expected, k) => expect(at[k]).toBeCloseTo(expected, 6));
  });

  it('is silent in a sped-up clip, unless sped-up clips are heard: then too close presses are left out', () => {
    const events = Array.from({ length: 8 }, (_, k) => keys(k * 0.5, 6));
    const spans = sceneSpans([clip(0, 4, 8)]);
    expect(typingClicks(spans, events, audio)).toEqual([]);
    const heard = typingClicks(spans, events, { ...audio, muteSpedUp: false });
    // 48 presses in 4 s become 0.5 s of video: at most one per 45 ms
    expect(heard.length).toBeGreaterThan(5);
    expect(heard.length).toBeLessThanOrEqual(Math.floor(0.5 / TYPING_RULES.minGap) + 1);
    heard.slice(1).forEach((click, k) => expect(click.at - heard[k]!.at).toBeGreaterThanOrEqual(TYPING_RULES.minGap - 1e-9));
  });

  it('is silent with the typing sounds off, the sound off, the volume at 0, and over stills and cards', () => {
    const events = [keys(1, 3)];
    const spans = sceneSpans([clip(0, 2)]);
    expect(typingClicks(spans, events, { ...audio, typing: false })).toEqual([]);
    expect(typingClicks(spans, events, { ...audio, enabled: false })).toEqual([]);
    expect(typingClicks(spans, events, { ...audio, typingVolume: 0 })).toEqual([]);
    expect(typingClicks(sceneSpans([{ type: 'card', title: 'Hi', duration: 2 } as Scene]), events, audio)).toEqual([]);
  });
});

describe('click sounds', () => {
  it('makes each click the same every time, its peak at 1, short, and the clicks unlike each other', () => {
    const a = clickSamples(3, false);
    expect(Array.from(clickSamples(3, false))).toEqual(Array.from(a));
    expect(peakOf(a)).toBeCloseTo(1, 6);
    expect(a.length).toBe(0.16 * 48_000);
    expect(clickSamples(3, true).length).toBe(0.2 * 48_000);
    const b = clickSamples(4, false);
    expect(Array.from(b)).not.toEqual(Array.from(a));
    // it dies away: the last 20 ms are near silence
    expect(peakOf(a.slice(-960))).toBeLessThan(0.01);
  });

  it('puts its energy where a keyboard’s is: mostly above the low thud, a wide key deeper', () => {
    for (const variant of [1, 5, 9, 20, 33]) {
      expect(lowShare(clickSamples(variant, false))).toBeLessThan(0.25);
      expect(lowShare(clickSamples(variant, true))).toBeGreaterThan(lowShare(clickSamples(variant, false)));
    }
  });

  it('mixes block by block exactly as all at once, at the volume asked for', () => {
    const clicks = typingClicks(sceneSpans([clip(0, 3)]), [keys(0.5, 4), keys(1, 3), keys(2.5, 2)], audio);
    const whole = new Float32Array(3 * 48_000);
    mixTyping(clicks, 0.5, whole, 0);
    const blocks = new Float32Array(whole.length);
    for (let start = 0; start < blocks.length; start += 10_000) {
      const block = new Float32Array(Math.min(10_000, blocks.length - start));
      mixTyping(clicks, 0.5, block, start);
      blocks.set(block, start);
    }
    expect(Array.from(blocks)).toEqual(Array.from(whole));
    const peak = peakOf(whole);
    expect(peak).toBeGreaterThan(0.15);
    expect(peak).toBeLessThan(0.5);
    // silence before the first press
    expect(peakOf(whole.slice(0, Math.round(clicks[0]!.at * 48_000)))).toBe(0);
  });
});

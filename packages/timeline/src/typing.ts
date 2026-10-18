// Typing sounds: a key click for each key typed. The take counts key presses per half second (`keys`
// events: neither which keys nor their exact times are kept); each count becomes that many presses
// spread over its half second, and each press a click on the output timeline wherever its clip is
// heard. The clicks are synthesized, not recorded: a short noise burst through a keyboard's
// resonances (the plate, the keycap), a darker thud from the case, and the key coming back up a
// little later; wide keys (space, enter) sound deeper. The same press always gets the same click,
// so the preview and the export sound alike. Pure.
import type { InputEvent, Look } from '@cuttle/project';
import type { SceneSpan } from './time';

export const TYPING_RULES = {
  /** The recorder counts key presses per this many seconds. */
  window: 0.5,
  /** A press lands this far (a share of its slot) before or after its even place. */
  jitter: 0.3,
  /** Presses closer than this on the output timeline (a sped-up clip that is heard) are left out. */
  minGap: 0.045,
  /** About one press in this many is a wide key: deeper and longer. */
  wideEvery: 6,
  /** How many different clicks there are; each press takes one. */
  variants: 48,
  /** Each click is up to this many dB louder or quieter. */
  spreadDb: 2,
  /** A click's peak at full volume. */
  level: 0.5,
};

/** A key press in source seconds. */
export interface KeyPress {
  t: number;
  /** Picks its click and its loudness. */
  seed: number;
  /** A wide key (space, enter). */
  wide: boolean;
}

/** A click on the output timeline. */
export interface TypingClick {
  /** Output seconds. */
  at: number;
  /** Which of the clicks (`clickSamples`). */
  variant: number;
  wide: boolean;
  /** Its own loudness (about 1). */
  gain: number;
}

/** mulberry32: a small seeded random generator, the same numbers on every machine. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (seconds: number) => Math.round(seconds * 1e6) / 1e6;

/**
 * The key presses of the take's `keys` counts, in order: each count's presses spread evenly over
 * its half second, each a little early or late, about one in six of them a wide key.
 */
export function keyPresses(events: readonly InputEvent[], rules = TYPING_RULES): KeyPress[] {
  const presses: KeyPress[] = [];
  for (const event of events) {
    if (event.type !== 'keys') continue;
    const slot = Math.round(event.t / rules.window);
    const next = random(Math.imul(slot, 7919) + 17);
    for (let k = 0; k < event.count; k++) {
      const place = k + 0.5 + (next() * 2 - 1) * rules.jitter;
      presses.push({ t: round(event.t + (rules.window * place) / event.count), seed: (Math.imul(slot, 31) + k) >>> 0, wide: next() < 1 / rules.wideEvery });
    }
  }
  return presses.sort((a, b) => a.t - b.t);
}

/**
 * The clicks on the output timeline: a press in a clip that is heard (`look.audio`: on, and a
 * sped-up clip only when `muteSpedUp` is off) clicks where the clip shows it, once for each time the
 * video shows it; presses that would come closer than `minGap` (typing in a sped-up clip) are left
 * out. None when the typing sounds are off.
 */
export function typingClicks(spans: readonly SceneSpan[], events: readonly InputEvent[], audio: Look['audio'], rules = TYPING_RULES): TypingClick[] {
  if (!audio.enabled || !audio.typing || !(audio.typingVolume > 0)) return [];
  const presses = keyPresses(events, rules);
  if (presses.length === 0) return [];
  const clicks: TypingClick[] = [];
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'clip' || (audio.muteSpedUp && scene.speed > 1)) continue;
    for (const press of presses) {
      if (press.t < scene.from || press.t >= scene.to) continue;
      const next = random(press.seed ^ 0x9e3779b9);
      const variant = Math.floor(next() * rules.variants);
      const gain = 10 ** (((next() * 2 - 1) * rules.spreadDb) / 20);
      clicks.push({ at: round(span.start + (press.t - scene.from) / scene.speed), variant, wide: press.wide, gain });
    }
  }
  clicks.sort((a, b) => a.at - b.at);
  const kept: TypingClick[] = [];
  for (const click of clicks) if (kept.length === 0 || click.at - kept.at(-1)!.at >= rules.minGap) kept.push(click);
  return kept;
}

/** A two-pole filter (RBJ's cookbook) run over `input`: a band-pass at `freq` or a high-pass from it. */
function biquad(input: Float32Array, kind: 'band' | 'high', freq: number, q: number, rate: number): Float32Array {
  const w = (2 * Math.PI * freq) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const [b0, b1, b2] = kind === 'band' ? [alpha, 0, -alpha] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/**
 * One key click, `variant` of `TYPING_RULES.variants`, at `rate` samples a second, its peak at 1:
 * a tiny contact tick; the bottom-out (a noise burst through the plate's and the keycap's
 * resonances, with a darker thud from the case); the key coming back up about 85 ms later (110 ms
 * for a wide key), quieter and a little higher; two early reflections of a small room.
 */
function synthesize(variant: number, wide: boolean, rate: number): Float32Array {
  const next = random(Math.imul(variant + 1, 977) + (wide ? 5 : 0));
  const vary = (amount: number) => 1 + (next() * 2 - 1) * amount;
  const noise = () => next() * 2 - 1;
  const length = Math.round((wide ? 0.2 : 0.16) * rate);
  const out = new Float32Array(length);
  const hit = (at: number, gain: number, pitch: number) => {
    const start = Math.round(at * rate);
    const n = Math.round(0.06 * rate);
    const clackDecay = 0.0035 * vary(0.25) * (wide ? 1.6 : 1);
    const thudDecay = (wide ? 0.016 : 0.009) * vary(0.2);
    const burst = new Float32Array(n);
    const low = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      burst[i] = noise() * Math.exp(-i / rate / clackDecay);
      low[i] = noise() * Math.exp(-i / rate / thudDecay);
    }
    const plate = biquad(burst, 'band', 3400 * pitch * vary(0.06), 5, rate);
    const cap = biquad(burst, 'band', (wide ? 1300 : 2100) * pitch * vary(0.08), 3, rate);
    const air = biquad(burst, 'high', 6000, 0.707, rate);
    const thud = biquad(low, 'band', (wide ? 180 : 320) * pitch * vary(0.1), 1.4, rate);
    for (let i = 0; i < n && start + i < length; i++) {
      out[start + i]! += gain * (1.6 * plate[i]! + 1.3 * cap[i]! + 0.25 * air[i]! + (wide ? 2.2 : 1.3) * thud[i]!);
    }
  };
  const tick = Math.round(0.0015 * rate);
  for (let i = 0; i < tick; i++) out[i]! += 0.25 * noise() * (1 - i / tick);
  hit(0.004 * vary(0.3), vary(0.12), 1);
  hit((wide ? 0.11 : 0.085) * vary(0.2), 0.32 * vary(0.25), 1.15);
  const first = Math.round(0.007 * rate);
  const second = Math.round(0.013 * rate);
  const room = new Float32Array(length);
  let peak = 0;
  for (let i = 0; i < length; i++) {
    room[i] = out[i]! + 0.1 * (out[i - first] ?? 0) + 0.07 * (out[i - second] ?? 0);
    peak = Math.max(peak, Math.abs(room[i]!));
  }
  for (let i = 0; i < length; i++) room[i]! /= peak || 1;
  return room;
}

const made = new Map<string, Float32Array>();

/** The samples of one click (made once, then kept); see `synthesize`. */
export function clickSamples(variant: number, wide: boolean, rate = 48_000): Float32Array {
  const key = `${rate}:${variant}:${wide ? 'w' : 'n'}`;
  let samples = made.get(key);
  if (!samples) {
    samples = synthesize(variant, wide, rate);
    made.set(key, samples);
  }
  return samples;
}

/**
 * Adds the clicks (sorted by `at`) to `out`, which holds the output's samples from sample `start`
 * on: the whole track or a block of it, block by block giving the same as all at once.
 */
export function mixTyping(clicks: readonly TypingClick[], volume: number, out: Float32Array, start: number, rate = 48_000, rules = TYPING_RULES): void {
  const end = start + out.length;
  for (const click of clicks) {
    const at = Math.round(click.at * rate);
    if (at >= end) break;
    const samples = clickSamples(click.variant, click.wide, rate);
    if (at + samples.length <= start) continue;
    const gain = rules.level * volume * click.gain;
    for (let i = Math.max(0, start - at); i < samples.length && at + i < end; i++) out[at + i - start]! += gain * samples[i]!;
  }
}

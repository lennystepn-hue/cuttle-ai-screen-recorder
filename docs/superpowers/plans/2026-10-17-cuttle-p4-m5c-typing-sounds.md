# Cuttle P4-M5c: Typing Sounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing on the keyboard makes a soft key click in the video, in the editor's preview and in the export alike, where the clip is heard; the Look tab switches it and sets its volume.

**Architecture:**
- **Format:** `look.audio.typing` (default on) and `look.audio.typingVolume` (0 to 1, default 0.5).
- **Timeline** (`typing.ts`, pure):
  - the take's `keys` counts as key presses, spread over each half second;
  - the presses as clicks on the output timeline, where a clip that is heard shows them;
  - the clicks synthesized (no sound files), the same in the preview and the export, and mixed block by block.
- **Export:** the clicks are written as a WAV in the export's work folder and mixed in after the mic (`amix`, levels kept).
- **Editor:** a `TypingSchedule` next to the mic's on the AudioContext (also without a mic); the Look tab's "Typing sounds" switch and volume.
- **Skill:** the switch, for a quiet video.

**Tech Stack:** TypeScript strict, zod 4, vitest 5, ffmpeg (`amix`), Web Audio, Electron 44.7.2, React 19.3.0, Playwright (`_electron`).

Asked for by the user on 2026-10-17 ("ein logischer Keyboard-Tippsound, wenn man auf dem Keyboard tippt"), between P4-M5 and P4-M6. Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p4-m5b-notifications-privacy-step.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p4-m5c`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 6.

## Decisions made while planning

A prototype of the milestone settled these points. The prototype passed `pnpm test` (702 tests, 56 skipped; the one recorder timing test that wobbles, noted below, passed alone), the typecheck, `app:check` (45 tests), `cli:check` (5) and `export:check`. Every screenshot was looked at.

- **When a key clicks.**
  - The recorder keeps only how many keys came in each half second (`keys` events), not which or exactly when. Each count becomes that many presses, spread evenly over its half second, each up to 30 % of its slot early or late (a seeded random generator: the same take always sounds the same).
  - A press clicks where a clip shows its source second, once for each time the video shows it; cuts, stills and cards are silent.
  - A clip is heard by the mic's rule (`look.audio.enabled`, and a sped-up clip only when `muteSpedUp` is off). In a sped-up clip that is heard, presses closer than 45 ms on the output timeline are left out: no machine gun.
  - On by default (the user asked for it), also over a mic: the take's own typing is masked by the clean voice or quiet, and the switch is one click away.
- **What a click sounds like** (`clickSamples`), synthesized so no sound file has to ship (none to license, none to unpack from the app's archive for ffmpeg):
  - a 1.5 ms contact tick;
  - the bottom-out: a noise burst (3.5 ms decay) through the plate's resonance (3.4 kHz) and the keycap's (2.1 kHz), a little air above 6 kHz, and a darker thud from the case (320 Hz, 9 ms);
  - the key coming back up 85 ms later, at a third of the level and 15 % higher;
  - two early reflections (7 and 13 ms) of a small room;
  - about one press in six is a wide key (space, enter): the keycap at 1.3 kHz, the thud at 180 Hz and longer, the release at 110 ms;
  - 48 variants (each its own resonances and decays), each press one of them, each up to 2 dB louder or quieter; peak at 0.5 at full volume.
  - The spectrum was checked: a normal key has 9 to 15 % of its energy below 500 Hz, a wide key 16 to 41 %. A first try with a pure 260 Hz tone for the thud sounded like a drum (the clack was 35 dB under it); the thud is filtered noise now.
- **The export:** the clicks are mixed into a 16-bit mono WAV in 10 s blocks (a long video needs no more memory than a block), as long as the video, then `amix=normalize=0` after the mic's concat: the mic keeps its level. Without a mic the track is mixed over the silence. The events are read for the sounds also with the cursor off; the page still gets them only for the cursor.
- **The preview:** `TypingSchedule` schedules each click a second ahead on the editor's AudioContext, through a gain per click and a master gain at the volume. A click whose time the clock already passed stays silent. It runs with every playback, mic or not.
- **The Look tab:** "Typing sounds" (a switch, "a click per key") under the mic's switch, and "Typing volume (%)" while it is on.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/schema.ts` | `look.audio.typing`, `typingVolume` |
| `packages/timeline/src/{typing,index}.ts` | presses, clicks, their sound, the mix |
| `packages/export/src/audio.ts`, `src/main/{sources,export,typing-track}.ts` | the WAV, the mix after the mic |
| `apps/desktop/src/renderer/editor/{typing-audio,player}.ts`, `Inspector.tsx` | the preview, the Look tab |
| `skill/cuttle/{SKILL,project}.md` | for Claude |

---

### Task 1: The format

**Files:**
- Modify: `packages/project/src/schema.ts`, `packages/project/test/schema.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p4-m5c`; work there:

```bash
git switch p4-m5c
```

- [ ] **Step 2: Write the failing test**

In `packages/project/test/schema.test.ts`, replace:

```ts
    expect(p.look.frame).toEqual({ enabled: true, style: 'mac-dark', title: '', radius: 14, shadow: true });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'system', size: 1, color: '#D97757', clickEffect: 'ripple', smoothing: 0.5 });
    expect(p.look.webcam).toEqual({ enabled: false, shape: 'circle', corner: 'bottom-left', size: 0.18 });
    expect(p.look.audio).toEqual({ enabled: true, muteSpedUp: true, cleanup: true });
    expect(p.look.transition).toEqual({ enabled: true, duration: 0.3 });
    expect(p.scenes).toEqual([]);
    expect(p.zooms).toEqual([]);
```

with:

```ts
    expect(p.look.frame).toEqual({ enabled: true, style: 'mac-dark', title: '', radius: 14, shadow: true });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'system', size: 1, color: '#D97757', clickEffect: 'ripple', smoothing: 0.5 });
    expect(p.look.webcam).toEqual({ enabled: false, shape: 'circle', corner: 'bottom-left', size: 0.18 });
    expect(p.look.audio).toEqual({ enabled: true, muteSpedUp: true, cleanup: true, typing: true, typingVolume: 0.5 });
    expect(p.look.transition).toEqual({ enabled: true, duration: 0.3 });
    expect(p.scenes).toEqual([]);
    expect(p.zooms).toEqual([]);
```

Run: `pnpm exec vitest run --project node packages/project/test/schema.test.ts`
Expected: FAIL: `look.audio` has no `typing`.

- [ ] **Step 3: The fields**

In `packages/project/src/schema.ts`, replace:

```ts
  muteSpedUp: z.boolean().default(true),
  /** Play the cleaned-up mic (`sources.cleanMic`: less noise, even loudness) where there is one. */
  cleanup: z.boolean().default(true),
});

const TransitionSchema = z.strictObject({
```

with:

```ts
  muteSpedUp: z.boolean().default(true),
  /** Play the cleaned-up mic (`sources.cleanMic`: less noise, even loudness) where there is one. */
  cleanup: z.boolean().default(true),
  /** A key click for each key typed (the take's `keys` counts), where its clip is heard. */
  typing: z.boolean().default(true),
  /** The clicks' volume, 0 to 1. */
  typingVolume: z.number().min(0).max(1).default(0.5),
});

const TransitionSchema = z.strictObject({
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run --project node packages/project`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project
git commit -m "project: look.audio.typing and typingVolume

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Presses, clicks and their sound

**Files:**
- Create: `packages/timeline/src/typing.ts`, `packages/timeline/test/typing.test.ts`
- Modify: `packages/timeline/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/timeline/test/typing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { InputEvent, Look, Scene } from '@cuttle/project';
import { sceneSpans } from '../src/time';
import { TYPING_RULES, clickSamples, keyPresses, mixTyping, typingClicks } from '../src/typing';

const keys = (t: number, count: number): InputEvent => ({ t, type: 'keys', count });
const clip = (from: number, to: number, speed = 1): Scene => ({ type: 'clip', from, to, speed });
const audio: Look['audio'] = { enabled: true, muteSpedUp: true, cleanup: true, typing: true, typingVolume: 0.5 };
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
```

Run: `pnpm exec vitest run --project node packages/timeline/test/typing.test.ts`
Expected: FAIL: `../src/typing` does not exist.

- [ ] **Step 2: The module**

`packages/timeline/src/typing.ts`:

```ts
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
```

In `packages/timeline/src/index.ts`, replace:

```ts
  type SpokenWord,
} from './captions';
export { clickZooms, shownClicks, zoomRectFor, type ClickZoom, type ClipSpan } from './click-zooms';
```

with:

```ts
  type SpokenWord,
} from './captions';
export { clickZooms, shownClicks, zoomRectFor, type ClickZoom, type ClipSpan } from './click-zooms';
export { TYPING_RULES, clickSamples, keyPresses, mixTyping, typingClicks, type KeyPress, type TypingClick } from './typing';
```

- [ ] **Step 3: Run the test**

Run: `pnpm exec vitest run --project node packages/timeline`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/timeline
git commit -m "timeline: typing clicks from the key counts, synthesized and mixed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The typing sounds in the export

**Files:**
- Create: `packages/export/src/main/typing-track.ts`, `packages/export/test/main/typing-track.test.ts`
- Modify: `packages/export/src/audio.ts`, `packages/export/src/main/{sources,export}.ts`, `packages/export/test/audio.test.ts`, `packages/export/test/main/{sources,audio-ffmpeg}.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/export/test/audio.test.ts`, replace:

```ts
    expect(audioFilterGraph(plan({ scenes }), -0.25)).toContain('channel_layouts=mono,atrim=start_sample=12000,asetpts=N/SR/TB,asplit=2');
  });

  it('needs no mic input when every segment is silent', () => {
    const graph = audioFilterGraph(plan({ scenes }, 6, false));
    expect(graph).not.toContain('[1:a]');
```

with:

```ts
    expect(audioFilterGraph(plan({ scenes }), -0.25)).toContain('channel_layouts=mono,atrim=start_sample=12000,asetpts=N/SR/TB,asplit=2');
  });

  it('mixes the typing sounds in as they are, as long as the video', () => {
    const parts = audioFilterGraph(plan({ scenes }), 0.5, 1, 2).split(';');
    expect(parts.slice(-3)).toEqual([
      '[s0][s1][s2][s3]concat=n=4:v=0:a=1[base]',
      '[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,apad,atrim=end_sample=288000,asetpts=N/SR/TB[keys]',
      '[base][keys]amix=inputs=2:duration=first:normalize=0,pan=stereo|c0=c0|c1=c0[aout]',
    ]);
  });

  it('needs no mic input when every segment is silent', () => {
    const graph = audioFilterGraph(plan({ scenes }, 6, false));
    expect(graph).not.toContain('[1:a]');
```

In the same file, replace:

```ts
      '-hide_banner -nostdin -loglevel error -y -i v.mp4 -i m.m4a -filter_complex G -map 0:v:0 -map [aout] -c:v copy -c:a aac -b:a 160k -ar 48000 -movflags +faststart -f mp4 o.mp4',
    );
    expect(muxArgs({ video: 'v.mp4', graph: 'G', out: 'o.mp4' })).not.toContain('m.m4a');
  });

  it('reads a long graph from a file (Windows limits a command line to 32 767 characters)', () => {
```

with:

```ts
      '-hide_banner -nostdin -loglevel error -y -i v.mp4 -i m.m4a -filter_complex G -map 0:v:0 -map [aout] -c:v copy -c:a aac -b:a 160k -ar 48000 -movflags +faststart -f mp4 o.mp4',
    );
    expect(muxArgs({ video: 'v.mp4', graph: 'G', out: 'o.mp4' })).not.toContain('m.m4a');
    // the typing sounds' track comes after the mic
    expect(muxArgs({ video: 'v.mp4', mic: 'm.m4a', typing: 't.wav', graph: 'G', out: 'o.mp4' }).join(' ')).toContain('-i v.mp4 -i m.m4a -i t.wav -filter_complex G');
  });

  it('reads a long graph from a file (Windows limits a command line to 32 767 characters)', () => {
```

In `packages/export/test/main/sources.test.ts`, replace:

```ts
    expect((await loadSources(gone)).warnings).toEqual(['take/transcript.json cannot be read: no captions']);
  });

  it('names a missing or empty media file, but accepts empty events', async () => {
    const noWebcam = Object.fromEntries(Object.entries(MEDIA).filter(([path]) => path !== 'take/webcam.mp4'));
    const missing = await projectDir({ sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES }, noWebcam);
```

with:

```ts
    expect((await loadSources(gone)).warnings).toEqual(['take/transcript.json cannot be read: no captions']);
  });

  it('reads the key counts for the typing sounds, also with the cursor off, and none with the sounds off', async () => {
    const typed = '{"t":0,"type":"move","x":1,"y":2}\n{"t":1,"type":"keys","count":3}\n';
    const dir = await projectDir({ sources: SOURCES, scenes: SCENES, look: { cursor: { enabled: false } } }, { ...MEDIA, 'take/events.jsonl': typed });
    const sources = await loadSources(dir);
    expect(sources.events).toBeUndefined();
    expect(sources.keys).toEqual([{ t: 1, type: 'keys', count: 3 }]);
    const off = await projectDir({ sources: SOURCES, scenes: SCENES, look: { cursor: { enabled: false }, audio: { typing: false } } }, { ...MEDIA, 'take/events.jsonl': typed });
    expect((await loadSources(off)).keys).toBeUndefined();
  });

  it('names a missing or empty media file, but accepts empty events', async () => {
    const noWebcam = Object.fromEntries(Object.entries(MEDIA).filter(([path]) => path !== 'take/webcam.mp4'));
    const missing = await projectDir({ sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES }, noWebcam);
```

`packages/export/test/main/typing-track.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import { mixTyping, sceneSpans, typingClicks } from '@cuttle/timeline';
import { writeTypingTrack } from '../../src/main/typing-track';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

describe('the typing track', () => {
  it('writes the clicks as a 16-bit mono WAV at 48 kHz, as long as the video, block by block as all at once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-typing-'));
    dirs.push(dir);
    const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, scenes: [{ type: 'clip', from: 0, to: 25 }] });
    if (!parsed.ok) throw new Error('invalid');
    // presses in the first and the third 10 s block, and across the first block's end
    const events = [{ t: 1, type: 'keys' as const, count: 3 }, { t: 9.5, type: 'keys' as const, count: 4 }, { t: 21, type: 'keys' as const, count: 2 }];
    const clicks = typingClicks(sceneSpans(parsed.project.scenes), events, parsed.project.look.audio);
    const path = join(dir, 'typing.wav');
    await writeTypingTrack(path, clicks, 0.5, 25);
    const bytes = readFileSync(path);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
    expect([bytes.readUInt16LE(22), bytes.readUInt32LE(24), bytes.readUInt16LE(34)]).toEqual([1, 48_000, 16]);
    expect(bytes.readUInt32LE(40)).toBe(25 * 48_000 * 2);
    expect(bytes.length).toBe(44 + 25 * 48_000 * 2);
    const whole = new Float32Array(25 * 48_000);
    mixTyping(clicks, 0.5, whole, 0);
    let worst = 0;
    for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(bytes.readInt16LE(44 + i * 2) / 32767 - whole[i]!));
    expect(worst).toBeLessThan(1e-4);
  });
});
```

In `packages/export/test/main/audio-ffmpeg.test.ts`, replace:

```ts
import { spawnSync } from 'node:child_process';
import { parseProject } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import { describe, expect, it } from 'vitest';
import { audioFilterGraph, planAudio } from '../../src/audio';
import { ffmpegPath } from '../../src/main/ffmpeg';

const hasFfmpeg = spawnSync(ffmpegPath(), ['-version'], { windowsHide: true }).status === 0;
```

with:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProject } from '@cuttle/project';
import { sceneSpans, typingClicks } from '@cuttle/timeline';
import { describe, expect, it } from 'vitest';
import { audioFilterGraph, planAudio } from '../../src/audio';
import { ffmpegPath } from '../../src/main/ffmpeg';
import { writeTypingTrack } from '../../src/main/typing-track';

const hasFfmpeg = spawnSync(ffmpegPath(), ['-version'], { windowsHide: true }).status === 0;
```

In the same file, replace:

```ts
      expect(worst, `speed ${speed}`).toBeLessThan(1e-4);
    }
  });
});
```

with:

```ts
      expect(worst, `speed ${speed}`).toBeLessThan(1e-4);
    }
  });

  it('mixes the typing sounds in where a key was typed: without a mic, and over one at its own level', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-typing-mix-'));
    try {
      const parsed = parseProject({ version: 1, sources: { screen: 's.mp4', mic: 'm.m4a' }, scenes: [{ type: 'clip', from: 0, to: 3 }], look: { transition: { enabled: false } } });
      if (!parsed.ok) throw new Error('invalid');
      const spans = sceneSpans(parsed.project.scenes);
      const clicks = typingClicks(spans, [{ t: 1, type: 'keys', count: 1 }], parsed.project.look.audio);
      const wav = join(dir, 'typing.wav');
      await writeTypingTrack(wav, clicks, 1, 3);
      const at = Math.round(clicks[0]!.at * 48_000);
      const mix = (inputs: string[], mic: boolean, typingInput: number) => {
        const segments = planAudio({ spans, look: parsed.project.look, mic, seconds: 3 });
        const result = spawnSync(ffmpegPath(), ['-v', 'error', ...inputs, '-filter_complex', audioFilterGraph(segments, 0, 0, typingInput), '-map', '[aout]', '-f', 'f32le', '-'], {
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
        });
        if (result.status !== 0) throw new Error(result.stderr.toString());
        const stereo = new Float32Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength / 4);
        return stereo.filter((_, i) => i % 2 === 0);
      };
      // no mic: silence, and the click where the key was typed
      const alone = mix(['-i', wav], false, 0);
      expect(alone.length).toBe(3 * 48_000);
      expect(peak(alone, 0, at - 10)).toBe(0);
      expect(peak(alone, at, at + 4800)).toBeGreaterThan(0.3);
      expect(peak(alone, at + 9600, alone.length)).toBe(0);
      // over the sine mic: the click on top, and the mic as loud as without it (amix does not halve it)
      const over = mix(['-f', 'lavfi', '-i', SINE, '-i', wav], true, 1);
      expect(peak(over, at, at + 4800)).toBeGreaterThan(peak(over, 48_000 * 2, 48_000 * 2.5) + 0.2);
      expect(peak(over, 48_000 * 2, 48_000 * 2.5)).toBeCloseTo(0.125, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

Run: `pnpm exec vitest run --project node packages/export`
Expected: FAIL: the graph has no typing input, `loadSources` gives no `keys`, and `typing-track` does not exist.

- [ ] **Step 2: The track and the mix**

`packages/export/src/main/typing-track.ts`:

```ts
// The typing sounds' track of an export: the clicks mixed block by block into a WAV in the export's
// work folder (16-bit mono at the export's rate), as long as the video, so a long video needs no
// more memory than a block.
import { open } from 'node:fs/promises';
import { mixTyping, type TypingClick } from '@cuttle/timeline';
import { AUDIO_SAMPLE_RATE } from '../audio';

/** Samples mixed at a time: 10 s. */
const BLOCK = AUDIO_SAMPLE_RATE * 10;

/** A WAV header for `samples` 16-bit mono samples at the export's rate. */
export function wavHeader(samples: number): Buffer {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + samples * 2, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  head.writeUInt32LE(AUDIO_SAMPLE_RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(samples * 2, 40);
  return head;
}

/** Writes the clicks (sorted, on the output timeline) at `volume` into a WAV `seconds` long at `path`. */
export async function writeTypingTrack(path: string, clicks: readonly TypingClick[], volume: number, seconds: number): Promise<void> {
  const total = Math.round(seconds * AUDIO_SAMPLE_RATE);
  const file = await open(path, 'w');
  try {
    await file.write(wavHeader(total));
    for (let start = 0; start < total; start += BLOCK) {
      const block = new Float32Array(Math.min(BLOCK, total - start));
      mixTyping(clicks, volume, block, start, AUDIO_SAMPLE_RATE);
      const bytes = Buffer.alloc(block.length * 2);
      for (let i = 0; i < block.length; i++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, block[i]!)) * 32767), i * 2);
      await file.write(bytes);
    }
  } finally {
    await file.close();
  }
}
```

In `packages/export/src/audio.ts`, replace:

```ts
 * labelled `[aout]`: 48 kHz stereo, exactly the sum of the segments' samples long. `micOffset` is
 * how many seconds after the screen track the mic started (negative: before); the mic is shifted
 * once so its time 0 is the screen track's time 0. Without mic segments the graph is silence only.
 */
export function audioFilterGraph(segments: readonly AudioSegment[], micOffset = 0, micInput = 1): string {
  const filters: string[] = [];
  const micSegments = segments.filter((segment) => segment.mic !== undefined).length;
  if (micSegments > 0) {
```

with:

```ts
 * labelled `[aout]`: 48 kHz stereo, exactly the sum of the segments' samples long. `micOffset` is
 * how many seconds after the screen track the mic started (negative: before); the mic is shifted
 * once so its time 0 is the screen track's time 0. Without mic segments the graph is silence only.
 * `typingInput`: the typing sounds' track (on the output timeline already), mixed in at its level.
 */
export function audioFilterGraph(segments: readonly AudioSegment[], micOffset = 0, micInput = 1, typingInput?: number): string {
  const filters: string[] = [];
  const micSegments = segments.filter((segment) => segment.mic !== undefined).length;
  if (micSegments > 0) {
```

In the same file, replace:

```ts
    filters.push(`${chain.join(',')}[s${i}]`);
  });
  const inputs = segments.map((_, i) => `[s${i}]`).join('');
  filters.push(`${inputs}concat=n=${segments.length}:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]`);
  return filters.join(';');
}
```

with:

```ts
    filters.push(`${chain.join(',')}[s${i}]`);
  });
  const inputs = segments.map((_, i) => `[s${i}]`).join('');
  if (typingInput === undefined) {
    filters.push(`${inputs}concat=n=${segments.length}:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]`);
    return filters.join(';');
  }
  const total = segments.reduce((sum, segment) => sum + segment.samples, 0);
  filters.push(
    `${inputs}concat=n=${segments.length}:v=0:a=1[base]`,
    [`[${typingInput}:a]aresample=${AUDIO_SAMPLE_RATE}`, 'aformat=sample_fmts=fltp:channel_layouts=mono', 'apad', `atrim=end_sample=${total}`, 'asetpts=N/SR/TB[keys]'].join(','),
    // added as they are: amix would otherwise halve both
    '[base][keys]amix=inputs=2:duration=first:normalize=0,pan=stereo|c0=c0|c1=c0[aout]',
  );
  return filters.join(';');
}
```

In the same file, replace:

```ts
  video: string;
  /** The mic file, when the graph uses it. */
  mic?: string;
  graph: string;
  /** A file holding `graph`, used instead of the inline graph when given. */
  graphFile?: string;
```

with:

```ts
  video: string;
  /** The mic file, when the graph uses it. */
  mic?: string;
  /** The typing sounds' track, when the graph mixes it in (the input after the mic). */
  typing?: string;
  graph: string;
  /** A file holding `graph`, used instead of the inline graph when given. */
  graphFile?: string;
```

In the same file, replace:

```ts
}

/** ffmpeg arguments that add the audio to the video without re-encoding it: AAC 48 kHz, moov at the front. */
export function muxArgs({ video, mic, graph, graphFile, out }: MuxArgsOptions): string[] {
  return [
    '-hide_banner',
    '-nostdin',
```

with:

```ts
}

/** ffmpeg arguments that add the audio to the video without re-encoding it: AAC 48 kHz, moov at the front. */
export function muxArgs({ video, mic, typing, graph, graphFile, out }: MuxArgsOptions): string[] {
  return [
    '-hide_banner',
    '-nostdin',
```

In the same file, replace:

```ts
    '-i',
    video,
    ...(mic ? ['-i', mic] : []),
    ...(graphFile ? ['-/filter_complex', graphFile] : ['-filter_complex', graph]),
    '-map',
    '0:v:0',
```

with:

```ts
    '-i',
    video,
    ...(mic ? ['-i', mic] : []),
    ...(typing ? ['-i', typing] : []),
    ...(graphFile ? ['-/filter_complex', graphFile] : ['-filter_complex', graph]),
    '-map',
    '0:v:0',
```

In `packages/export/src/main/sources.ts`, replace:

```ts
  webcam?: { path: string; offset: number };
  mic?: { path: string; offset: number };
  events?: InputEvent[];
  /** The take's transcript (source seconds), for captions and subtitle files. */
  transcript?: TranscriptWord[];
  stills: Record<number, string>;
```

with:

```ts
  webcam?: { path: string; offset: number };
  mic?: { path: string; offset: number };
  events?: InputEvent[];
  /** The take's key counts, for the typing sounds (loaded whether the cursor shows or not). */
  keys?: InputEvent[];
  /** The take's transcript (source seconds), for captions and subtitle files. */
  transcript?: TranscriptWord[];
  stills: Record<number, string>;
```

In the same file, replace:

```ts
    const clean = look.audio.cleanup && sources.cleanMic ? await existing(projectDir, sources.cleanMic, 'cleaned-up mic (sources.cleanMic)') : undefined;
    result.mic = { path: clean ?? path, offset: offsetFor(take, 'mic', path, screen) };
  }
  if (look.cursor.enabled && sources.events) {
    const path = await existing(projectDir, sources.events, 'input events (sources.events)', false);
    const events = parseEventsJsonl(await readFile(path, 'utf8'));
    if (events.issues.length > 0) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(events.issues)}`);
    result.events = events.events;
  }
  if (sources.transcript) {
    // without it the video has no captions: worth a warning, not a failed export
```

with:

```ts
    const clean = look.audio.cleanup && sources.cleanMic ? await existing(projectDir, sources.cleanMic, 'cleaned-up mic (sources.cleanMic)') : undefined;
    result.mic = { path: clean ?? path, offset: offsetFor(take, 'mic', path, screen) };
  }
  const typing = look.audio.enabled && look.audio.typing;
  if ((look.cursor.enabled || typing) && sources.events) {
    const path = await existing(projectDir, sources.events, 'input events (sources.events)', false);
    const events = parseEventsJsonl(await readFile(path, 'utf8'));
    if (events.issues.length > 0) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(events.issues)}`);
    // the page draws the cursor from them only while it shows
    if (look.cursor.enabled) result.events = events.events;
    if (typing) result.keys = events.events.filter((event) => event.type === 'keys');
  }
  if (sources.transcript) {
    // without it the video has no captions: worth a warning, not a failed export
```

In `packages/export/src/main/export.ts`, replace:

```ts
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans, toSrt, toVtt } from '@cuttle/timeline';
import { app } from 'electron';
import { INLINE_GRAPH_LIMIT, audioFilterGraph, muxArgs, planAudio } from '../audio';
import { ExportError } from '../errors';
```

with:

```ts
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans, toSrt, toVtt, typingClicks } from '@cuttle/timeline';
import { app } from 'electron';
import { INLINE_GRAPH_LIMIT, audioFilterGraph, muxArgs, planAudio } from '../audio';
import { ExportError } from '../errors';
```

In the same file, replace:

```ts
import { checkFfmpeg, runFfmpeg } from './ffmpeg';
import { FileHost } from './files';
import { loadSources, samePath } from './sources';
import { openExportWindow, type ExportWindow } from './window';

export interface ExportOptions {
```

with:

```ts
import { checkFfmpeg, runFfmpeg } from './ffmpeg';
import { FileHost } from './files';
import { loadSources, samePath } from './sources';
import { writeTypingTrack } from './typing-track';
import { openExportWindow, type ExportWindow } from './window';

export interface ExportOptions {
```

In the same file, replace:

```ts

    const audioStarted = performance.now();
    const seconds = page.frames / project.output.fps;
    const segments = planAudio({ spans: sceneSpans(project.scenes, project.cuts), look: project.look, mic: sources.mic !== undefined, seconds });
    const usesMic = segments.some((segment) => segment.mic !== undefined);
    const graph = audioFilterGraph(segments, sources.mic?.offset ?? 0);
    const graphFile = graph.length > INLINE_GRAPH_LIMIT ? join(work, 'audio.graph') : undefined;
    if (graphFile) await writeFile(graphFile, graph);
    await runFfmpeg(muxArgs({ video, mic: usesMic ? sources.mic?.path : undefined, graph, graphFile, out: partial }), signal);
    throwIfCancelled();
    try {
      await rename(partial, out);
```

with:

```ts

    const audioStarted = performance.now();
    const seconds = page.frames / project.output.fps;
    const spans = sceneSpans(project.scenes, project.cuts);
    const segments = planAudio({ spans, look: project.look, mic: sources.mic !== undefined, seconds });
    const usesMic = segments.some((segment) => segment.mic !== undefined);
    // the typing sounds: a track of their own on the video's timeline, mixed in after the mic
    const clicks = typingClicks(spans, sources.keys ?? [], project.look.audio);
    const typing = clicks.length > 0 ? join(work, 'typing.wav') : undefined;
    if (typing) await writeTypingTrack(typing, clicks, project.look.audio.typingVolume, seconds);
    const graph = audioFilterGraph(segments, sources.mic?.offset ?? 0, 1, typing ? (usesMic ? 2 : 1) : undefined);
    const graphFile = graph.length > INLINE_GRAPH_LIMIT ? join(work, 'audio.graph') : undefined;
    if (graphFile) await writeFile(graphFile, graph);
    await runFfmpeg(muxArgs({ video, mic: usesMic ? sources.mic?.path : undefined, typing, graph, graphFile, out: partial }), signal);
    throwIfCancelled();
    try {
      await rename(partial, out);
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/export`
Expected: PASS (the ffmpeg test mixes a click over silence and over a sine mic at its own level).

- [ ] **Step 4: Commit**

```bash
git add packages/export
git commit -m "export: the typing sounds as a track of their own, mixed in after the mic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: In the editor

**Files:**
- Create: `apps/desktop/src/renderer/editor/typing-audio.ts`
- Modify: `apps/desktop/src/renderer/editor/{player.ts,Inspector.tsx}`, `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The check**

The demo project's six keys at 2.4 s click while it plays; the spoken take's Look tab sets the volume and switches the sounds off.

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
interface Check {
  state(): CheckState;
  seek(t: number): Promise<void>;
  playback(): { drawn: number; restarts: number; clock: number };
  pixels(): string;
  useProxy(): Promise<boolean>;
  doc(): { hash: string; saving: boolean; problem?: string; issues?: string[]; toast?: { text: string; undo?: boolean }; draftNote?: string; undo?: string; redo?: string };
```

with:

```ts
interface Check {
  state(): CheckState;
  seek(t: number): Promise<void>;
  playback(): { drawn: number; restarts: number; clicks: number; clock: number };
  pixels(): string;
  useProxy(): Promise<boolean>;
  doc(): { hash: string; saving: boolean; problem?: string; issues?: string[]; toast?: { text: string; undo?: boolean }; draftNote?: string; undo?: string; redo?: string };
```

In the same file, replace:

```ts
    expect(stats.clock - playing.t).toBeLessThan(0.7);
    // and plays as a movie, not a slideshow: at least half the frame rate per second of the clock
    expect(stats.drawn / stats.clock).toBeGreaterThan(FIXTURE_OUTPUT.fps / 2);
    const paused = await state();
    expect(paused.playing).toBe(false);
    await editor.waitForTimeout(300);
```

with:

```ts
    expect(stats.clock - playing.t).toBeLessThan(0.7);
    // and plays as a movie, not a slideshow: at least half the frame rate per second of the clock
    expect(stats.drawn / stats.clock).toBeGreaterThan(FIXTURE_OUTPUT.fps / 2);
    // the six keys typed at 2.4 s click a second before the clock gets there
    expect(stats.clicks).toBeGreaterThanOrEqual(4);
    const paused = await state();
    expect(paused.playing).toBe(false);
    await editor.waitForTimeout(300);
```

In the same file, replace:

```ts
    const path = join(dir, 'cuttle.json');
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { sources: Record<string, string> };
    writeFileSync(path, JSON.stringify({ ...raw, sources: { ...raw.sources, transcript: 'takes/1/transcript.json', cleanMic: 'takes/1/mic.clean.m4a' } }, null, 2));
    type Saved = { cuts?: { label?: string }[]; captions?: { style?: string; fixes?: { at: number; end: number; text: string }[] }; look?: { audio?: { cleanup?: boolean } } };
    const saved = () => JSON.parse(readFileSync(path, 'utf8')) as Saved;
    const page = await openEditor(dir);
    const pageState = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state());
```

with:

```ts
    const path = join(dir, 'cuttle.json');
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { sources: Record<string, string> };
    writeFileSync(path, JSON.stringify({ ...raw, sources: { ...raw.sources, transcript: 'takes/1/transcript.json', cleanMic: 'takes/1/mic.clean.m4a' } }, null, 2));
    type Saved = { cuts?: { label?: string }[]; captions?: { style?: string; fixes?: { at: number; end: number; text: string }[] }; look?: { audio?: { cleanup?: boolean; typing?: boolean; typingVolume?: number } } };
    const saved = () => JSON.parse(readFileSync(path, 'utf8')) as Saved;
    const page = await openEditor(dir);
    const pageState = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state());
```

In the same file, replace:

```ts
    await expect.poll(() => saved().captions?.style).toBe('karaoke');
    await click(page, '[data-testid=audio-cleanup]');
    await expect.poll(() => saved().look?.audio?.cleanup).toBe(false);
    await page.evaluate((t) => (window as unknown as Hooked).__cuttleCheck.seek(t), words[index('zooms')]!.t + 0.1);
    await page.locator('[data-testid=captions-style]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('29-subtitles-karaoke', '/editor.html', 'subtitled · Cuttle');
```

with:

```ts
    await expect.poll(() => saved().captions?.style).toBe('karaoke');
    await click(page, '[data-testid=audio-cleanup]');
    await expect.poll(() => saved().look?.audio?.cleanup).toBe(false);
    // the typing sounds: their volume in per cent, and a switch
    await page.fill('[data-testid=audio-typing-volume]', '30');
    await page.press('[data-testid=audio-typing-volume]', 'Enter');
    await expect.poll(() => saved().look?.audio?.typingVolume).toBe(0.3);
    await page.locator('[data-testid=audio-typing]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('29b-typing-sounds', '/editor.html', 'subtitled · Cuttle');
    await click(page, '[data-testid=audio-typing]');
    await expect.poll(() => saved().look?.audio?.typing).toBe(false);
    await page.waitForSelector('[data-testid=audio-typing-volume]', { state: 'detached' });
    await page.evaluate((t) => (window as unknown as Hooked).__cuttleCheck.seek(t), words[index('zooms')]!.t + 0.1);
    await page.locator('[data-testid=captions-style]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('29-subtitles-karaoke', '/editor.html', 'subtitled · Cuttle');
```

- [ ] **Step 2: The preview and the Look tab**

`apps/desktop/src/renderer/editor/typing-audio.ts`:

```ts
// The typing sounds in the preview: the export's clicks (`typingClicks`, `clickSamples`), each
// scheduled on the AudioContext a moment before the clock reaches it.
import type { CuttleProject, InputEvent } from '@cuttle/project';
import { TYPING_RULES, clickSamples, typingClicks, type SceneSpan, type TypingClick } from '@cuttle/timeline';

/** Clicks are scheduled this far ahead of the clock. */
const AHEAD_SECONDS = 1;

/**
 * Plays the typing sounds from output time `from` on; `contextStart` is the AudioContext time at
 * which output time `from` plays. Without key counts, or with the sounds off, it plays nothing.
 */
export class TypingSchedule {
  private readonly nodes = new Set<AudioBufferSourceNode>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly master: GainNode;
  private stopped = false;
  /** Clicks scheduled so far (the check reads it). */
  scheduled = 0;

  constructor(
    private readonly context: AudioContext,
    project: CuttleProject,
    spans: readonly SceneSpan[],
    events: readonly InputEvent[],
    private readonly from: number,
    private readonly contextStart: number,
  ) {
    this.master = context.createGain();
    this.master.gain.value = TYPING_RULES.level * project.look.audio.typingVolume;
    this.master.connect(context.destination);
    void this.run(typingClicks(spans, events, project.look.audio).filter((click) => click.at >= from));
  }

  /** The AudioContext time at which output time `t` plays. */
  private when(t: number): number {
    return this.contextStart + (t - this.from);
  }

  /** A click's sound at the context's rate, made once per click. */
  private buffer(click: TypingClick): AudioBuffer {
    const key = `${click.variant}:${click.wide}`;
    let buffer = this.buffers.get(key);
    if (!buffer) {
      const samples = clickSamples(click.variant, click.wide, this.context.sampleRate);
      buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.buffers.set(key, buffer);
    }
    return buffer;
  }

  private async run(clicks: readonly TypingClick[]): Promise<void> {
    for (const click of clicks) {
      while (!this.stopped && this.when(click.at) - this.context.currentTime > AHEAD_SECONDS) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (this.stopped) return;
      const at = this.when(click.at);
      // one the clock already passed stays silent
      if (at < this.context.currentTime) continue;
      const gain = this.context.createGain();
      gain.gain.value = click.gain;
      gain.connect(this.master);
      const node = this.context.createBufferSource();
      node.buffer = this.buffer(click);
      node.connect(gain);
      node.start(at);
      this.scheduled++;
      this.nodes.add(node);
      node.onended = () => {
        this.nodes.delete(node);
        node.disconnect();
        gain.disconnect();
      };
    }
  }

  stop(): void {
    this.stopped = true;
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        // never started
      }
      node.disconnect();
    }
    this.nodes.clear();
    this.master.disconnect();
  }
}
```

In `apps/desktop/src/renderer/editor/player.ts`, replace:

```ts
import type { CuttleProject } from '@cuttle/project';
import { createTimeline, type RenderState, type Timeline } from '@cuttle/timeline';
import { AudioSchedule } from './audio';
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
import type { EditorMedia, VideoSource } from './media';
```

with:

```ts
import type { CuttleProject } from '@cuttle/project';
import { createTimeline, type RenderState, type Timeline } from '@cuttle/timeline';
import { AudioSchedule } from './audio';
import { TypingSchedule } from './typing-audio';
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
import type { EditorMedia, VideoSource } from './media';
```

In the same file, replace:

```ts
/** Playback this far behind the clock restarts its decoders at the clock (frames are dropped). */
const BEHIND_SECONDS = 0.5;

/** What playback did, for the check: frames drawn, decoder restarts at the clock (frames dropped), the clock. */
export interface PlaybackStats {
  drawn: number;
  restarts: number;
  /** The clock's output time (where the sound is), while playing. */
  clock: number;
}
```

with:

```ts
/** Playback this far behind the clock restarts its decoders at the clock (frames are dropped). */
const BEHIND_SECONDS = 0.5;

/** What playback did, for the check: frames drawn, decoder restarts at the clock (frames dropped), typing clicks scheduled, the clock. */
export interface PlaybackStats {
  drawn: number;
  restarts: number;
  clicks: number;
  /** The clock's output time (where the sound is), while playing. */
  clock: number;
}
```

In the same file, replace:

```ts
  private playToken = 0;
  private context: AudioContext | undefined;
  private audio: AudioSchedule | undefined;
  private disposed = false;
  private readonly playback: PlaybackStats = { drawn: 0, restarts: 0, clock: 0 };
  private clockNow: (() => number) | undefined;

  constructor(options: PlayerOptions) {
```

with:

```ts
  private playToken = 0;
  private context: AudioContext | undefined;
  private audio: AudioSchedule | undefined;
  /** The typing sounds while playing (also without a mic). */
  private typing: TypingSchedule | undefined;
  private disposed = false;
  private readonly playback: PlaybackStats = { drawn: 0, restarts: 0, clicks: 0, clock: 0 };
  private clockNow: (() => number) | undefined;

  constructor(options: PlayerOptions) {
```

In the same file, replace:

```ts

  /** Playback counters since the last play, and the clock's time while playing. */
  stats(): PlaybackStats {
    return { ...this.playback, clock: this.clockNow?.() ?? this.state.t };
  }

  private makeTimeline(): Timeline {
```

with:

```ts

  /** Playback counters since the last play, and the clock's time while playing. */
  stats(): PlaybackStats {
    return { ...this.playback, clicks: this.typing?.scheduled ?? this.playback.clicks, clock: this.clockNow?.() ?? this.state.t };
  }

  private makeTimeline(): Timeline {
```

In the same file, replace:

```ts
    this.playToken++;
    this.audio?.stop();
    this.audio = undefined;
    // A running context keeps the audio device busy (and the laptop awake) for nothing.
    void this.context?.suspend();
    this.set({ playing: false });
```

with:

```ts
    this.playToken++;
    this.audio?.stop();
    this.audio = undefined;
    this.typing?.stop();
    this.typing = undefined;
    // A running context keeps the audio device busy (and the laptop awake) for nothing.
    void this.context?.suspend();
    this.set({ playing: false });
```

In the same file, replace:

```ts
    let shown = startFrame - 1;
    try {
      if (this.media.mic) this.audio = new AudioSchedule(context, this.media.mic, this.project, this.timeline.spans, from, contextStart);
      frames = open(startFrame);
      while (token === this.playToken && !this.disposed) {
        const now = clock();
```

with:

```ts
    let shown = startFrame - 1;
    try {
      if (this.media.mic) this.audio = new AudioSchedule(context, this.media.mic, this.project, this.timeline.spans, from, contextStart);
      this.typing = new TypingSchedule(context, this.project, this.timeline.spans, this.media.events, from, contextStart);
      frames = open(startFrame);
      while (token === this.playToken && !this.disposed) {
        const now = clock();
```

In the same file, replace:

```ts
        this.clockNow = undefined;
        this.audio?.stop();
        this.audio = undefined;
        void context.suspend();
        this.set({ playing: false, t: Math.min(this.state.t, this.duration) });
      }
```

with:

```ts
        this.clockNow = undefined;
        this.audio?.stop();
        this.audio = undefined;
        this.typing?.stop();
        this.typing = undefined;
        void context.suspend();
        this.set({ playing: false, t: Math.min(this.state.t, this.duration) });
      }
```

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```
          <Toggle checked={current.audio.cleanup} label="Clean voice" onChange={(on) => look(['audio', 'cleanup'], on, on ? 'Clean voice on' : 'Clean voice off')} testId="audio-cleanup" />
        </Row>
      )}
      {current.audio.enabled && (
        <Row label="Sped-up clips" inline>
          <Toggle checked={current.audio.muteSpedUp} label="Silent when sped up" onChange={(on) => look(['audio', 'muteSpedUp'], on, on ? 'Sped-up clips silent' : 'Sped-up clips heard')} />
```

with:

```
          <Toggle checked={current.audio.cleanup} label="Clean voice" onChange={(on) => look(['audio', 'cleanup'], on, on ? 'Clean voice on' : 'Clean voice off')} testId="audio-cleanup" />
        </Row>
      )}
      {current.audio.enabled && (
        <Row label="Typing sounds" inline note="a click per key">
          <Toggle checked={current.audio.typing} label="Typing sounds" onChange={(on) => look(['audio', 'typing'], on, on ? 'Typing sounds on' : 'Typing sounds off')} testId="audio-typing" />
        </Row>
      )}
      {current.audio.enabled && current.audio.typing && (
        <Row label="Typing volume (%)">
          <NumberInput
            value={Math.round(current.audio.typingVolume * 100)}
            min={0}
            max={100}
            step={10}
            digits={0}
            onCommit={(percent) => look(['audio', 'typingVolume'], percent / 100, 'Typing volume')}
            testId="audio-typing-volume"
          />
        </Row>
      )}
      {current.audio.enabled && (
        <Row label="Sped-up clips" inline>
          <Toggle checked={current.audio.muteSpedUp} label="Silent when sped up" onChange={(on) => look(['audio', 'muteSpedUp'], on, on ? 'Sped-up clips silent' : 'Sped-up clips heard')} />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 4: Run the check, with screenshots, and look at them**

```bash
mkdir -p "$TEMP/cuttle-p4m5c-shots"
CUTTLE_HIDDEN=1 CUTTLE_RECORDER_BACKEND=test CUTTLE_CHECK_SHOTS="$TEMP/cuttle-p4m5c-shots" pnpm app:check
```

Expected: PASS, 45 tests. Look at `29b-typing-sounds`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "desktop: the typing sounds in the preview, and their switch and volume in the Look tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The skill

**Files:**
- Modify: `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`

- [ ] **Step 1: The fields and when to switch them off**

In `skill/cuttle/project.md`, replace:

```markdown
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

Two clips where the second starts where the first ends (within 1 ms), as `suggest`'s speed-ups and
```

with:

```markdown
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one), `typing` (`true`: a key click for each key typed, where the clip is heard), `typingVolume` (`0.5`, 0 to 1) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

Two clips where the second starts where the first ends (within 1 ms), as `suggest`'s speed-ups and
```

In `skill/cuttle/SKILL.md`, replace:

```markdown
  read off a `frame --grid`. Over a sped-up clip, durations are source seconds: 3 s at 12× is a
  quarter second on screen (see project.md).
- **Look.** Set `look.frame.title` (e.g. `claude · ~/demo`) and a background preset, and add a
  `texts` caption where a step is not obvious.
- **Pages.** `cuttle -C "<project>" --json capture-page <url or file> --scroll --add` appends a
  scrolling still of a web page (the result the agent built); add `--wait 2500` for slow maps or
  fonts. It goes after every scene, so capture pages before you add the end card (or move the
```

with:

```markdown
  read off a `frame --grid`. Over a sped-up clip, durations are source seconds: 3 s at 12× is a
  quarter second on screen (see project.md).
- **Look.** Set `look.frame.title` (e.g. `claude · ~/demo`) and a background preset, and add a
  `texts` caption where a step is not obvious. Typing clicks softly, a click per key where the clip
  is heard (`look.audio.typing`, `typingVolume`); switch it off when the user wants a quiet video.
- **Pages.** `cuttle -C "<project>" --json capture-page <url or file> --scroll --add` appends a
  scrolling still of a web page (the result the agent built); add `--wait 2500` for slow maps or
  fonts. It goes after every scene, so capture pages before you add the end card (or move the
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run --project node skill/test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add skill
git commit -m "skill: typing sounds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 703 passed and 56 skipped (on a machine without a speech model the real transcription is skipped too: 702 and 57; off Windows the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 5 tests.

Run: `CUTTLE_HIDDEN=1 pnpm export:check`
Expected: exits with code 0.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Record a take where you type in a terminal, open it, and play it: the keys click as you typed.
2. Export it and listen: the same clicks, under your voice if you spoke.
3. Look tab: set "Typing volume" lower or higher, or switch "Typing sounds" off.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran once, on the prototype, whose tree the replay matches byte for byte. The packaged build (`pnpm app:build`) ran on the replayed commits.
- A first WAV of the clicks went to the user to listen to; the sound can be tuned from what they say (`synthesize` in `typing.ts`).

**Found while checking, and already in the plan above**
- **The thud first sounded like a drum:** a pure 260 Hz tone 35 dB over the clack (seen in the spectrum). It is filtered noise now, and the test checks where the energy lies.
- **`Math.max(...samples)` over a 3 s track overflowed the stack** in the tests; they fold with `reduce`.
- **A recorder timing test wobbles** ("stops while paused": the take 0.6 s longer than up to the pause, 0.5 s allowed), also alone (1 of 3 runs). The recorder is untouched here; it is noted as a follow-up.

**After the plan: main brought in the new Look tab (#25)**
- The macOS branch's PR #25 (the Look tab as parts, the settings redone) was merged first, at the user's word. Main was merged into this branch:
  - The Look tab's rows (Task 4) moved into the new Sound part. "Typing volume" is a slider (`RangeInput`, as the camera's size) instead of a number field, and the part's summary says "key clicks".
  - The check sets the slider through the input's own value setter and opens the Sound part for these steps.
  - `schema.test.ts` and `project.md` keep #25's webcam lines and this branch's audio lines.
- #25 brought two golden scenarios (`webcam-squircle`, `webcam-square-moved`) with macOS images only. Their Windows images were made here, compared with the macOS ones side by side (the same), and added.
- On the merged tree: the typecheck, `pnpm test` (all goldens pass) and `app:check` (46 tests) pass.

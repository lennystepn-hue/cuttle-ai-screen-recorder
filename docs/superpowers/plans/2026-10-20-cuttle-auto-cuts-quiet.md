# Cuttle: Auto Cuts That Never Cut Into Speech Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The automatic speech cuts take out what should go (a sentence begun again, too) and never cut into a word that stays, and the captions match what the video says.

The user tested 0.1.1 and found the auto cuts cut into the sound, with the subtitles no longer matching, and sometimes the same thing said twice. Measured on a realistic take (Windows' voice over pink noise, with breaths, and a sentence broken off and begun again without a cue):
- The export is in sync: cuts, the mic's offset and the cleaned-up mic were measured exact to the frame.
- The sentence begun again stayed in: "… dann klickt ihr auf. Dann klickt ihr auf Exportieren …". Only the mistake key and a spoken "nochmal" counted as a retake.
- Cut edges come from whisper's word times, which are often a tenth of a second or more off, so an edge can fall into a word.
- The alignment put the broken "auf." into the "Dann" said again, so the captions read "Einstellungen. auf. Dann klickt …" over audio without that "auf".

**Architecture:**
- `restarts()` in `packages/core/src/speech/retakes.ts` finds a phrase begun again without a cue. `retakeCuts` cuts it like a spoken cue's slip: from the pause before it to just before the repeat.
- `packages/core/src/speech/guard.ts` reads where the mic is quiet (`quietStretches`). `guardCut` moves each cut edge that lies in sound to the nearest quiet within 0.4 s, never past a word that stays, and keeps 0.15 s of quiet next to the sound that stays. A cut with no quiet near enough is left out.
- `withSpeechCuts` (`packages/core/src/speech/apply.ts`) applies the guard to every retake, filler and pause cut. Both `suggest` and the app's step after transcribing (`applySpeechEdits`) pass the mic's quiet (`micQuiet`).
- `alignWords` (`packages/core/src/speech/align.ts`) puts a word before a full stop or a comma at the end of a speech stretch, where people pause: a cost for such a word inside a stretch's run.

**Tech Stack:** TypeScript, vitest, ffmpeg (the mic's levels), whisper (the heavy end-to-end test).

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `auto-cuts-quiet`, in Git Bash.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions made while planning

- **A restart needs a pause before the broken phrase, none before the repeat.** The broken phrase starts a phrase (a pause of `cuePause`, 0.3 s, before it, or the take's start), and the next phrase repeats its start word for word: all of it from 2 words (`restartWords`), or 3 words or more of it (`restartMatch`). Whisper often puts the broken phrase's last word right against the repeat, so no pause is asked for there. "Sehr, sehr gut" (one word), two sentences that only begin alike, and a repeat inside a sentence (no pause before the first) are not restarts.
- **The mic decides where the sound is, the words decide what is removed.** A word is removed when its middle lies in the cut. An edge moves at most `reach` (0.4 s), the start never before the end of the word that stays before the cut nor after the first removed word's start, the end likewise. Quiet is below the floor plus 30 % of the range from the floor (10th percentile) to the loud level (98th percentile): stricter than the speech stretches' 50 %, so a word's fading end counts as sound. A gap shorter than 0.06 s is a stop inside a word, not quiet. A mic with less than 12 dB of range tells nothing, and the cuts stay as made.
- **Better left out than chopped.** A cut whose edge finds no quiet in reach is left out, with a note. A filler's or a pause's cut that grew must still lie where the picture rests; a pause's cut must still remove `pauseCutMin`.
- **No transcript surgery.** The captions are fixed where the error comes from: the alignment. The weights (0.6 for a sentence end, 0.3 for a comma, colon or semicolon) were swept on the three fixtures: from 0.6 on, all placements are right and stay so up to 1.0, and the existing fixtures get better too (German median start error 41 → 29 ms, worst 1.09 → 0.23 s; English median 72 → 57 ms).
- **What is left as it is:** "die, äh, die Einstellungen" keeps its "die, die": no pause between "ihr" and the first "die" means no cut can take it without cutting into running speech. With the small model, English "Uh" (2.22 s) is not written by whisper and "It" is put in its place; this is so on main too (the end-to-end test runs with the base model first, where it passes).
- Checked on the prototype:
  - Each new test failed before its change, as each step's Expected says, and passed after it.
  - The realistic take through the built CLI (`transcribe`, `suggest`, `render`, then the render imported and transcribed again). Before, the video said "… dann klickt ihr auf. Dann klickt ihr auf Exportieren …". After, it says "… Zuerst öffnet ihr die Einstellungen, dann klickt ihr auf "Exportieren" und wählt das Format 16 zu 9. Fertig ist das Video!".
  - The restart's cut runs from 9.45 to 12.81 s. It ends 0.15 s before the "Dann" said again, which the mic hears at 12.96 s (whisper's own time: 13.23 s; the old cut end, 13.06 s, lay in it). It starts before the breath at 9.48 to 9.66 s, which goes with it.
  - Its captions after the cut: "… Einstellungen. Dann klickt ihr auf Exportieren …", with "Dann" at the moment the audio says it. Before the alignment change they read "Einstellungen. auf. Dann …".
  - The clean take ("die, äh, die Einstellungen", "Nochmal") still gets its pause, filler ("äh") and "Nochmal" retake cuts, and reads clean after the render.
  - The heavy end-to-end tests pass with the base model. The new one passes with the small model too.
  - `pnpm test` (1016 passed, 82 skipped) and `pnpm typecheck`.

---

### Task 1: The mic's quiet and a cut's edges in it

**Files:**
- Create: `packages/core/src/speech/guard.ts`, `packages/core/test/guard.test.ts`
- Modify: `packages/core/src/speech/levels.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `auto-cuts-quiet`; work there:

```bash
git switch auto-cuts-quiet
```

- [ ] **Step 2: Write the failing test**

`packages/core/test/guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TranscriptWord } from '@cuttle/project';
import { guardCut, quietStretches } from '../src/speech/guard';

const said = (...items: [number, number, string][]): TranscriptWord[] => items.map(([t, end, text]) => ({ t, end, text }));

/** Mic levels every 10 ms: `loud` stretches at -20 dB over a -60 dB floor, `seconds` long. */
function levels(seconds: number, loud: [number, number][]): Float32Array {
  const values = new Float32Array(Math.round(seconds * 100)).fill(-60);
  for (const [from, to] of loud) values.fill(-20, Math.round(from * 100), Math.round(to * 100));
  return values;
}

describe("the mic's quiet", () => {
  it('lies between the loud stretches, before the mic starts and after it ends, on the screen track’s time', () => {
    expect(quietStretches(levels(3, [[0.5, 1], [1.8, 2.4]]))).toEqual([
      { from: -Infinity, to: 0.5 },
      { from: 1, to: 1.8 },
      { from: 2.4, to: Infinity },
    ]);
    // the mic started 0.2 s after the screen, and began loud
    expect(quietStretches(levels(2, [[0, 0.5]]), 0.2)).toEqual([
      { from: -Infinity, to: 0.2 },
      { from: 0.7, to: Infinity },
    ]);
  });

  it('leaves out a gap shorter than a word’s stop, and says nothing when the mic hears no speech', () => {
    expect(quietStretches(levels(2, [[0.5, 0.8], [0.84, 1.2]]))).toEqual([
      { from: -Infinity, to: 0.5 },
      { from: 1.2, to: Infinity },
    ]);
    expect(quietStretches(new Float32Array(200).fill(-50))).toBeUndefined();
  });
});

describe('a speech cut in the quiet', () => {
  // "Erstens [quiet] äh [quiet] zweitens", the mic's truth; whisper's times are given per case
  const quiet = quietStretches(levels(6, [[1, 1.6], [2.4, 2.7], [3.6, 4.4]]))!;

  it('stays as it is where its edges are quiet', () => {
    const words = said([1, 1.6, 'Erstens'], [2.4, 2.7, 'äh'], [3.6, 4.4, 'zweitens']);
    expect(guardCut({ from: 2.3, to: 2.8 }, words, quiet)).toEqual({ from: 2.3, to: 2.8 });
  });

  it('moves an edge out of a word whisper placed wrong, to the nearest quiet, never past the words that stay', () => {
    // whisper heard "äh" later than it was said (2.5–2.8): the cut began in its sound
    const late = said([1, 1.6, 'Erstens'], [2.5, 2.8, 'äh'], [3.6, 4.4, 'zweitens']);
    expect(guardCut({ from: 2.45, to: 2.85 }, late, quiet)).toEqual({ from: 2.37, to: 2.85 });
    // a pause cut whose end reached into "zweitens", which whisper heard 0.2 s late: it ends 0.15 s before the word
    const early = said([1, 1.6, 'Erstens'], [3.8, 4.4, 'zweitens']);
    expect(guardCut({ from: 1.8, to: 3.65 }, early, quiet)).toEqual({ from: 1.8, to: 3.45 });
  });

  it('keeps a little quiet next to the sound that stays, as much as there is', () => {
    const words = said([1, 1.6, 'Erstens'], [3.6, 4.4, 'zweitens']);
    // the mic's quiet starts at 1.6: the cut keeps 0.15 s of it after "Erstens"
    expect(guardCut({ from: 1.65, to: 3.4 }, words, quiet)).toEqual({ from: 1.75, to: 3.4 });
    // a short quiet: its middle part, `margin` from both ends
    const short = quietStretches(levels(6, [[1, 1.6], [1.7, 2.7], [3.6, 4.4]]))!;
    expect(guardCut({ from: 1.65, to: 3.4 }, words, short)).toEqual({ from: 1.67, to: 3.4 });
  });

  it('is left out where no quiet lies near enough between the words around it', () => {
    // a filler glued to the word before it: no quiet in reach before its sound
    const glued = quietStretches(levels(6, [[1, 2.7], [3.6, 4.4]]))!;
    const words = said([1, 1.6, 'Erstens'], [2.4, 2.7, 'äh'], [3.6, 4.4, 'zweitens']);
    expect(guardCut({ from: 2.35, to: 2.8 }, words, glued)).toBeUndefined();
  });
});
```

Run: `pnpm exec vitest run --project node packages/core/test/guard.test.ts`
Expected: FAIL: `../src/speech/guard` does not exist.

- [ ] **Step 3: The guard**

`percentile` is shared with the speech stretches:

In `packages/core/src/speech/levels.ts`, replace:

```ts
  minRange: 12,
};

function percentile(sorted: Float32Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]!;
}
```

with:

```ts
  minRange: 12,
};

/** The value at share `p` of sorted levels. */
export function percentile(sorted: Float32Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]!;
}
```

`packages/core/src/speech/guard.ts`:

```ts
// Speech cuts in the quiet: whisper's word times are estimates, often a tenth of a second or more
// off, and a cut edge placed by them can fall in a word's sound, which then comes out chopped. The
// mic's loudness knows where the sound is: an edge in it moves to the nearest quiet, never past a
// word that stays, keeping a little quiet next to the sound that stays; a cut with no quiet near
// enough is left out. Pure: the inputs are the mic's levels and the words, in source seconds.
import type { TranscriptWord } from '@cuttle/project';
import { union, type Span } from '../suggest/spans';
import { LEVEL_SECONDS, percentile } from './levels';

export const GUARD_RULES = {
  /** Quiet lies below the floor plus this share of the way to the loud level, in dB (floor: the 10th percentile, loud: the 98th). */
  share: 0.3,
  /** Less than this between the floor and the loud level: the mic tells nothing (muted, steady noise), and the cuts stay as made. */
  minRange: 12,
  /** A quiet gap shorter than this is a stop inside a word ("t", "k"), not quiet. */
  minQuiet: 0.06,
  /** An edge moves at most this far. */
  reach: 0.4,
  /** An edge lies at least this far inside the quiet … */
  margin: 0.03,
  /** … and this far from the sound that stays, as far as the quiet reaches (the retakes keep as much). */
  keep: 0.15,
};

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * Where the mic is quiet, on the screen track's time (`offset`: where the mic starts on it): the
 * stretches below the quiet threshold, at least `minQuiet` long, and everything before the mic
 * starts and after it ends. Undefined when the mic hears no speech.
 */
export function quietStretches(levels: Float32Array, offset = 0, rules = GUARD_RULES): Span[] | undefined {
  if (levels.length === 0) return undefined;
  const sorted = Float32Array.from(levels).sort();
  const floor = percentile(sorted, 0.1);
  const loud = percentile(sorted, 0.98);
  if (loud - floor < rules.minRange) return undefined;
  const threshold = floor + rules.share * (loud - floor);
  const at = (i: number) => ms(offset + i * LEVEL_SECONDS);
  const runs: Span[] = [{ from: -Infinity, to: at(0) }];
  let start: number | undefined;
  for (let i = 0; i <= levels.length; i++) {
    const quiet = i < levels.length && levels[i]! < threshold;
    if (quiet && start === undefined) start = i;
    else if (!quiet && start !== undefined) {
      runs.push({ from: at(start), to: at(i) });
      start = undefined;
    }
  }
  runs.push({ from: at(levels.length), to: Infinity });
  return union(runs).filter((span) => span.to - span.from >= rules.minQuiet);
}

/**
 * The quiet stretch `at` lies in (`margin` inside it), else the quiet point in `[lo, hi]` nearest to
 * it, with its stretch; undefined when there is none.
 */
function settle(at: number, lo: number, hi: number, quiet: readonly Span[], margin: number): { at: number; span: Span } | undefined {
  let best: { at: number; span: Span } | undefined;
  for (const span of quiet) {
    const a = Math.max(span.from + margin, lo);
    const b = Math.min(span.to - margin, hi);
    if (span.from + margin <= at && at <= span.to - margin) return { at, span };
    if (a > b) continue;
    const point = Math.min(b, Math.max(a, at));
    if (best === undefined || Math.abs(point - at) < Math.abs(best.at - at)) best = { at: point, span };
  }
  return best;
}

/**
 * The cut with its edges in the mic's quiet (`quietStretches`), `margin` inside it. An edge in sound
 * moves to the nearest quiet within `reach`: the start never before the end of the word that stays
 * before the cut nor after the start of the first word it removes, the end never before the end of
 * the last word it removes nor after the start of the word that stays after it (a word is removed
 * when its middle lies in the cut). Then each edge keeps `keep` of its quiet next to the sound that
 * stays (before the start, after the end), as far as the quiet reaches. Undefined when an edge finds
 * no quiet.
 */
export function guardCut<T extends Span>(cut: T, words: readonly TranscriptWord[], quiet: readonly Span[], rules = GUARD_RULES): T | undefined {
  const middle = (word: TranscriptWord) => (word.t + word.end) / 2;
  const before = words.filter((word) => middle(word) < cut.from).at(-1);
  const removed = words.filter((word) => cut.from <= middle(word) && middle(word) < cut.to);
  const after = words.find((word) => middle(word) >= cut.to);
  const start = settle(cut.from, Math.max(before?.end ?? -Infinity, cut.from - rules.reach), Math.min(removed[0]?.t ?? Infinity, cut.from + rules.reach, cut.to), quiet, rules.margin);
  const end = settle(cut.to, Math.max(removed.at(-1)?.end ?? -Infinity, cut.to - rules.reach, cut.from), Math.min(after?.t ?? Infinity, cut.to + rules.reach), quiet, rules.margin);
  if (!start || !end) return undefined;
  const from = Math.max(start.at, Math.min(start.span.from + rules.keep, start.span.to - rules.margin));
  const to = Math.min(end.at, Math.max(end.span.to - rules.keep, end.span.from + rules.margin));
  if (!(to > from)) return undefined;
  return from === cut.from && to === cut.to ? cut : { ...cut, from: ms(from), to: ms(to) };
}
```

Run: `pnpm exec vitest run --project node packages/core/test/guard.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/speech/guard.ts packages/core/src/speech/levels.ts packages/core/test/guard.test.ts
git commit -m "speech cuts: the mic's quiet, and a cut's edges moved into it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Sentences begun again, and every speech cut in the quiet

**Files:**
- Modify: `packages/core/src/speech/retakes.ts`, `packages/core/src/speech/apply.ts`, `packages/core/src/suggest.ts`
- Test: `packages/core/test/retakes.test.ts`

- [ ] **Step 1: Write the failing tests**

The restarts on the noisy German fixture's words, and the speech edits with the mic's quiet:

In `packages/core/test/retakes.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { parseProject, type InputEvent, type Marker, type TranscriptWord } from '@cuttle/project';
import { withSpeechCuts, wordStretches } from '../src/speech/apply';
import { retakeCuts, spokenCues, type RetakeInput } from '../src/speech/retakes';

const key = (t: number): Marker => ({ t, kind: 'retake' });
const said = (...items: [number, number, string][]): TranscriptWord[] => items.map(([t, end, text]) => ({ t, end, text }));
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { parseProject, type InputEvent, type Marker, type TranscriptWord } from '@cuttle/project';
import { withSpeechCuts, wordStretches } from '../src/speech/apply';
import { restarts, retakeCuts, spokenCues, type RetakeInput } from '../src/speech/retakes';

const key = (t: number): Marker => ({ t, kind: 'retake' });
const said = (...items: [number, number, string][]): TranscriptWord[] => items.map(([t, end, text]) => ({ t, end, text }));
```

In the same file, replace:

```ts
  });
});

describe('retakes among the speech edits', () => {
  const project = (rest: Record<string, unknown> = {}) => {
    const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, scenes: [{ type: 'clip', from: 0, to: 30 }], ...rest });
```

with:

```ts
  });
});

describe('a sentence begun again', () => {
  // "… die Einstellungen. Dann klickt ihr auf … Dann klickt ihr auf Exportieren": the noisy fixture's
  // words as they were placed before the alignment knew full stops, the broken "auf" right against
  // the new start (whisper puts it there, and a transcript may still have it so)
  const words = said(
    [8.61, 9.36, 'Einstellungen.'],
    [11.17, 11.48, 'Dann'],
    [11.48, 11.9, 'klickt'],
    [11.9, 12.15, 'ihr'],
    [12.97, 13.21, 'auf.'],
    [13.21, 13.51, 'Dann'],
    [13.51, 13.94, 'klickt'],
    [13.94, 14.18, 'ihr'],
    [14.18, 14.42, 'auf'],
    [14.42, 15.15, 'Exportieren'],
  );

  it('is found without a cue: the next phrase repeats the broken one from its start', () => {
    expect(restarts(words)).toEqual([{ at: 13.21, slip: 11.17, text: 'Dann klickt ihr auf' }]);
    // and cut from the pause before it to just before the sentence begins again
    expect(retakeCuts(input({ words, speech: wordStretches({ version: 1, language: 'de', model: 'small', words, sounds: [] }) }))).toEqual([
      { from: 11.02, to: 13.06, auto: 'retake', label: 'Restart: “Dann klickt ihr auf”' },
    ]);
    // three words or more said again count too, though the rest differs ("Export" and then "Exportieren")
    const changed = said([1, 1.3, 'Dann'], [1.3, 1.6, 'klickt'], [1.6, 1.8, 'ihr'], [1.8, 2, 'auf'], [2, 2.4, 'Export.'], [3, 3.3, 'Dann'], [3.3, 3.6, 'klickt'], [3.6, 3.8, 'ihr'], [3.8, 4, 'auf'], [4, 4.6, 'Exportieren']);
    expect(restarts(changed)).toEqual([{ at: 3, slip: 1, text: 'Dann klickt ihr auf Export' }]);
    // begun again twice: both broken starts go
    const twice = said([1, 1.3, 'Wir'], [1.3, 1.6, 'öffnen'], [2.2, 2.5, 'Wir'], [2.5, 2.8, 'öffnen'], [3.4, 3.7, 'Wir'], [3.7, 4, 'öffnen'], [4, 4.3, 'die'], [4.3, 4.8, 'App']);
    expect(restarts(twice).map((restart) => [restart.slip, restart.at])).toEqual([[1, 2.2], [2.2, 3.4]]);
  });

  it('is not a sentence that only begins alike, a word said twice, or a phrase within a sentence', () => {
    // two sentences that begin with the same two words
    expect(restarts(said([1, 1.3, 'Klickt'], [1.3, 1.5, 'auf'], [1.5, 2, 'Datei.'], [2.6, 2.9, 'Klickt'], [2.9, 3.1, 'auf'], [3.1, 3.7, 'Speichern.']))).toEqual([]);
    // one word twice
    expect(restarts(said([1, 1.3, 'Sehr,'], [1.5, 1.8, 'sehr'], [1.8, 2.1, 'gut.']))).toEqual([]);
    // the repeat of words that did not start a phrase (no pause before them)
    expect(restarts(said([1, 1.3, 'Ich'], [1.3, 1.5, 'sage'], [1.5, 1.8, 'dann'], [1.8, 2, 'klickt'], [2, 2.3, 'dann'], [2.3, 2.6, 'klickt'], [2.6, 2.9, 'ihr']))).toEqual([]);
  });
});

describe('retakes among the speech edits', () => {
  const project = (rest: Record<string, unknown> = {}) => {
    const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, scenes: [{ type: 'clip', from: 0, to: 30 }], ...rest });
```

In the same file, replace:

```ts
    expect(keyOnly.cuts.map((cut) => cut.auto)).toEqual(['retake', 'filler']);
  });

  it('are not made while switched off', () => {
    const result = withSpeechCuts({}, project({ autoEdits: { retakes: false } }), base, new Set());
    expect(result.cuts).toEqual([]);
```

with:

```ts
    expect(keyOnly.cuts.map((cut) => cut.auto)).toEqual(['retake', 'filler']);
  });

  it('keep their edges in the mic’s quiet, and are left out where it has none near them', () => {
    // the mic heard "äh" at 2.3–2.6, earlier than whisper wrote it
    const quiet = [{ from: -Infinity, to: 1 }, { from: 1.5, to: 2.3 }, { from: 2.6, to: 3.5 }, { from: 4, to: 5.5 }, { from: 6, to: Infinity }];
    const result = withSpeechCuts({ cuts: [] }, project(), { ...base, transcript, quiet }, new Set());
    // the pause's cut ends 0.15 s before the "äh" the mic heard, the filler's starts before it
    expect(result.cuts.map((cut) => [cut.auto, cut.from, cut.to])).toEqual([
      ['pause', 1.7, 2.15],
      ['filler', 2.27, 2.85],
      ['retake', 3.35, 5.3],
    ]);
    expect(result.notes).toContain("moved 2 cut edges into the mic's quiet, clear of the speech");
    // "Erstens" and "äh" ran together: no quiet near the pause's cut, nor before the filler
    const glued = [{ from: -Infinity, to: 1 }, { from: 2.8, to: 3.5 }, { from: 4, to: 5.5 }, { from: 6, to: Infinity }];
    const left = withSpeechCuts({ cuts: [] }, project(), { ...base, transcript, quiet: glued }, new Set());
    expect(left.cuts.map((cut) => cut.auto)).toEqual(['retake']);
    expect(left.notes).toContain("left out 2 cuts with no quiet in the mic near their edges: the words there run together");
  });

  it('are not made while switched off', () => {
    const result = withSpeechCuts({}, project({ autoEdits: { retakes: false } }), base, new Set());
    expect(result.cuts).toEqual([]);
```

Run: `pnpm exec vitest run --project node packages/core/test/retakes.test.ts`
Expected: FAIL: `restarts` is not exported, and the cuts keep their edges in the sound.

- [ ] **Step 2: The restarts**

In `packages/core/src/speech/retakes.ts`, replace:

```ts
// Retakes: the person slipped, pressed the mistake key (a `retake` marker) or said "nochmal", and did
// the bit again. The slip is cut: from the last pause before it to just after the key or the cue.
// Pure: the inputs are the markers, the transcript (or the mic's speech stretches) and the input
// events, in source seconds.
import { fillerLexicon, normWord, type InputEvent, type Marker, type TranscriptWord } from '@cuttle/project';
```

with:

```ts
// Retakes: the person slipped, pressed the mistake key (a `retake` marker), said "nochmal" or just
// began the sentence again, and did the bit again. The slip is cut: from the last pause before it to
// just after the key or the cue, or to just before the sentence begun again.
// Pure: the inputs are the markers, the transcript (or the mic's speech stretches) and the input
// events, in source seconds.
import { fillerLexicon, normWord, type InputEvent, type Marker, type TranscriptWord } from '@cuttle/project';
```

In the same file, replace:

```ts
  repeatMatch: 2,
  /** … which began at most these many words before the cue. */
  repeatWords: 12,
};

/** The spoken cues for "once more", as normalised words in a row (the longest that fits wins). */
```

with:

```ts
  repeatMatch: 2,
  /** … which began at most these many words before the cue. */
  repeatWords: 12,
  /**
   * A phrase begun again without a cue: the next phrase repeats it word for word from its start,
   * all of it (at least this many words) …
   */
  restartWords: 2,
  /** … or this many words or more of it. */
  restartMatch: 3,
};

/** The spoken cues for "once more", as normalised words in a row (the longest that fits wins). */
```

In the same file, replace:

```ts
  return found;
}

/**
 * Where the slip before `back` began: the end of the last pause in the speech (a gap of `pause` or
 * more, with no click, key or scroll in its last `restingInput`), at most `lookBack` back; else
```

with:

```ts
  return found;
}

/** A phrase broken off and begun again without a cue. */
export interface Restart {
  /** Where it begins again: the first word said again. */
  at: number;
  /** Where the broken phrase began. */
  slip: number;
  /** The broken phrase's words. */
  text: string;
}

/**
 * The phrases begun again without a cue ("Dann klickt ihr auf … Dann klickt ihr auf Exportieren"): a
 * phrase starts after a pause of `cuePause` (or with the take, or where a phrase began again), and
 * the next one repeats it word for word from its start: all of it, `restartWords` words or more, or
 * `restartMatch` words or more of it. No pause is asked for between the two: whisper often puts the
 * broken phrase's last word right against the new start.
 */
export function restarts(words: readonly TranscriptWord[], rules = RETAKE_RULES): Restart[] {
  const normal = words.map((word) => normWord(word.text));
  const found: Restart[] = [];
  let again = -1;
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && i !== again && words[i]!.t - words[i - 1]!.end < rules.cuePause) continue;
    for (let j = i + 1; j < words.length && j - i <= rules.repeatWords; j++) {
      if (normal[j] !== normal[i]) continue;
      let length = 0;
      while (i + length < j && j + length < words.length && normal[i + length] === normal[j + length]) length++;
      if ((i + length === j && length >= rules.restartWords) || length >= rules.restartMatch) {
        const text = words
          .slice(i, j)
          .map((word) => word.text.replace(/[^\p{L}\p{N}]+$/u, ''))
          .join(' ');
        found.push({ at: words[j]!.t, slip: words[i]!.t, text });
        // the new start is a phrase's start: it may be broken off and begun again too
        again = j;
        i = j - 1;
        break;
      }
    }
  }
  return found;
}

/**
 * Where the slip before `back` began: the end of the last pause in the speech (a gap of `pause` or
 * more, with no click, key or scroll in its last `restingInput`), at most `lookBack` back; else
```

In the same file, replace:

```ts
}

/**
 * The retakes: one cut per mistake key (a `retake` marker) and per spoken cue that is followed by a
 * repeat, from the last pause before the slip to `after` past the key or the cue, inside the clip it
 * lies in. Cuts that overlap become one.
 */
export function retakeCuts(input: RetakeInput, rules = RETAKE_RULES): RetakeCut[] {
  // `back`: where to look back from for the pause before the slip (a cue's: the slip's first word)
  const slips: { at: number; back: number; end: number; label: string }[] = [
    ...input.markers.filter((marker) => marker.kind === 'retake').map((marker) => ({ at: marker.t, back: marker.t, end: marker.t, label: 'Retake' })),
    ...(input.words ? spokenCues(input.words, rules).map((cue) => ({ at: cue.at, back: cue.slip + 0.001, end: cue.end, label: `Retake: “${cue.text}”` })) : []),
  ];
  const cuts: RetakeCut[] = [];
  for (const slip of slips.sort((a, b) => a.at - b.at)) {
    const clip = input.clips.find((span) => span.from <= slip.at && slip.at < span.to);
    if (!clip) continue;
    const from = slipStart(slip.back, input, clip.from, rules);
    const to = Math.min(clip.to, slip.end + rules.after);
    if (!(to > from)) continue;
    const last = cuts.at(-1);
    if (last && from <= last.to) {
```

with:

```ts
}

/**
 * The retakes: one cut per mistake key (a `retake` marker), per spoken cue that is followed by a
 * repeat and per phrase begun again without a cue, from the last pause before the slip to `after`
 * past the key or the cue (to `keepBefore` before a phrase begun again), inside the clip it lies in.
 * Cuts that overlap become one.
 */
export function retakeCuts(input: RetakeInput, rules = RETAKE_RULES): RetakeCut[] {
  // `back`: where to look back from for the pause before the slip (a cue's: the slip's first word)
  const slips: { at: number; back: number; to: number; label: string }[] = [
    ...input.markers.filter((marker) => marker.kind === 'retake').map((marker) => ({ at: marker.t, back: marker.t, to: marker.t + rules.after, label: 'Retake' })),
    ...(input.words ? spokenCues(input.words, rules).map((cue) => ({ at: cue.at, back: cue.slip + 0.001, to: cue.end + rules.after, label: `Retake: “${cue.text}”` })) : []),
    ...(input.words ? restarts(input.words, rules).map((restart) => ({ at: restart.at, back: restart.slip + 0.001, to: restart.at - rules.keepBefore, label: `Restart: “${restart.text}”` })) : []),
  ];
  const cuts: RetakeCut[] = [];
  for (const slip of slips.sort((a, b) => a.at - b.at)) {
    const clip = input.clips.find((span) => span.from <= slip.at && slip.at < span.to);
    if (!clip) continue;
    const from = slipStart(slip.back, input, clip.from, rules);
    const to = Math.min(clip.to, slip.to);
    if (!(to > from)) continue;
    const last = cuts.at(-1);
    if (last && from <= last.to) {
```

- [ ] **Step 3: The guard in the speech edits, in suggest and after transcribing**

In `packages/core/src/speech/apply.ts`, replace:

```ts
// The speech edits applied to a project: retakes (the mistake key, a spoken "nochmal"), and filler
// and pause cuts from its transcript, merged with the cuts there by the tag rules. `suggest` does
// this as part of its run; the app does it again once the transcript arrives after the cut.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEventsJsonl, parseMarkersJson, usedIds, type CuttleProject, type InputEvent, type Marker, type TranscriptFile } from '@cuttle/project';
import { CoreError } from '../errors';
import { readProjectFile, writeProjectFile } from '../project-file';
import { analyseScreen } from '../suggest/media';
import { union, type Span } from '../suggest/spans';
import { mergeCuts, speechCuts, type RawCut } from './edits';
import { micLevels, speechStretches } from './levels';
import { retakeCuts, type RetakeCut } from './retakes';
import { micOffset, readTranscript, transcriptOfMic } from './transcribe';
```

with:

```ts
// The speech edits applied to a project: retakes (the mistake key, a spoken "nochmal", a sentence
// begun again), and filler and pause cuts from its transcript, with their edges in the mic's quiet,
// merged with the cuts there by the tag rules. `suggest` does this as part of its run; the app does
// it again once the transcript arrives after the cut.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEventsJsonl, parseMarkersJson, usedIds, type CuttleProject, type InputEvent, type Marker, type TranscriptFile, type TranscriptWord } from '@cuttle/project';
import { CoreError } from '../errors';
import { readProjectFile, writeProjectFile } from '../project-file';
import { analyseScreen } from '../suggest/media';
import { union, type Span } from '../suggest/spans';
import { inputSpans, mergeCuts, restingAt, SPEECH_EDIT_RULES, speechCuts, type RawCut, type SpeechCut } from './edits';
import { guardCut, quietStretches } from './guard';
import { micLevels, speechStretches } from './levels';
import { retakeCuts, type RetakeCut } from './retakes';
import { micOffset, readTranscript, transcriptOfMic } from './transcribe';
```

In the same file, replace:

```ts
  }
}

export interface SpeechCutsResult {
  cuts: RawCut[];
  fillers: number;
```

with:

```ts
  }
}

/**
 * Where the mic is quiet, in source seconds (`quietStretches`): where speech cuts may begin and end.
 * Undefined without a mic, when it hears no speech, or when it cannot be read.
 */
export async function micQuiet(dir: string, sources: CuttleProject['sources']): Promise<Span[] | undefined> {
  if (sources.mic === undefined) return undefined;
  const mic = resolve(dir, sources.mic);
  try {
    const [levels, offset] = await Promise.all([micLevels(mic), micOffset(resolve(dir, sources.screen), mic)]);
    return quietStretches(levels, offset);
  } catch (error) {
    if (error instanceof CoreError && error.code === 'ffmpeg-missing') throw error;
    return undefined;
  }
}

export interface SpeechCutsResult {
  cuts: RawCut[];
  fillers: number;
```

In the same file, replace:

```ts
  events: readonly InputEvent[];
  /** The clips' source stretches and speeds: fillers and pauses are cut in 1× clips only. */
  clips: readonly (Span & { speed: number })[];
}

/** Filler and pause cuts this close to a retake, in its clip, become part of it. */
```

with:

```ts
  events: readonly InputEvent[];
  /** The clips' source stretches and speeds: fillers and pauses are cut in 1× clips only. */
  clips: readonly (Span & { speed: number })[];
  /** Where the mic is quiet (`micQuiet`): the cuts' edges are moved there. Without it they stay as made. */
  quiet?: readonly Span[];
}

/** Filler and pause cuts this close to a retake, in its clip, become part of it. */
```

In the same file, replace:

```ts
  return true;
}

/**
 * The project's cuts with the speech edits: the retakes (the mistake key's markers, and with a
 * transcript the spoken cues), then the filler and pause cuts of the transcript (one that touches a
 * retake joins it). The tagged cuts of the kinds made are replaced; every other cut is kept.
 */
export function withSpeechCuts(raw: Record<string, unknown>, project: CuttleProject, input: SpeechCutsInput, taken = usedIds(raw)): SpeechCutsResult {
  const { transcript } = input;
```

with:

```ts
  return true;
}

/**
 * The cuts with their edges in the mic's quiet (`guardCut`), inside the clip each was made in. A
 * filler's or a pause's cut that grew must still lie where the picture rests, and a pause's cut
 * still remove `pauseCutMin`; the cuts that cannot are left out.
 */
function inTheQuiet<T extends RetakeCut | SpeechCut>(made: readonly T[], input: SpeechCutsInput, words: readonly TranscriptWord[], quiet: readonly Span[]): { cuts: T[]; moved: number; dropped: number } {
  const busy = inputSpans(input.events);
  const cuts: T[] = [];
  let moved = 0;
  let dropped = 0;
  for (const cut of made) {
    const clip = input.clips.find((span) => span.from <= cut.from && cut.to <= span.to);
    const guarded = guardCut(cut, words, quiet);
    const next = guarded && clip ? { ...guarded, from: Math.max(clip.from, guarded.from), to: Math.min(clip.to, guarded.to) } : guarded;
    const grew = next !== undefined && (next.from < cut.from || next.to > cut.to);
    const fits =
      next !== undefined &&
      next.to > next.from &&
      (cut.auto === 'retake' || !grew || restingAt(next, input, SPEECH_EDIT_RULES, busy)) &&
      (cut.auto !== 'pause' || next.to - next.from >= SPEECH_EDIT_RULES.pauseCutMin);
    if (!next || !fits) {
      dropped++;
      continue;
    }
    moved += Number(next.from !== cut.from) + Number(next.to !== cut.to);
    cuts.push(next);
  }
  return { cuts, moved, dropped };
}

/**
 * The project's cuts with the speech edits: the retakes (the mistake key's markers, and with a
 * transcript the spoken cues and the sentences begun again), then the filler and pause cuts of the
 * transcript (one that touches a retake joins it), with their edges in the mic's quiet when it is
 * known. The tagged cuts of the kinds made are replaced; every other cut is kept.
 */
export function withSpeechCuts(raw: Record<string, unknown>, project: CuttleProject, input: SpeechCutsInput, taken = usedIds(raw)): SpeechCutsResult {
  const { transcript } = input;
```

In the same file, replace:

```ts
    : [];
  // without a transcript the filler and pause cuts there stay as they are: nothing to make them again from
  const kinds = transcript ? ['retake', 'filler', 'pause'] : ['retake'];
  const made = [...retakes, ...speech].sort((a, b) => a.from - b.from);
  const { cuts, added, kept } = mergeCuts((raw.cuts as RawCut[] | undefined) ?? [], made, kinds, taken);
  const fillers = added.filter((cut) => cut.auto === 'filler').length;
  const pauses = added.filter((cut) => cut.auto === 'pause').length;
  const retaken = added.filter((cut) => cut.auto === 'retake').length;
  const off = added.filter((cut) => cut.enabled === false).length;
  const notes: string[] = [];
  if (retaken > 0) notes.push(`cut ${retaken} retake${retaken === 1 ? '' : 's'}: back to the pause before each slip (the mistake key, or a spoken "nochmal" that was then said again)`);
  if (!project.autoEdits.retakes) notes.push('retake cuts are switched off (autoEdits.retakes)');
  if (fillers + pauses > 0) {
    const removed = added.filter((cut) => cut.enabled !== false && cut.auto !== 'retake').reduce((sum, cut) => sum + cut.to - cut.from, 0);
```

with:

```ts
    : [];
  // without a transcript the filler and pause cuts there stay as they are: nothing to make them again from
  const kinds = transcript ? ['retake', 'filler', 'pause'] : ['retake'];
  const sorted = [...retakes, ...speech].sort((a, b) => a.from - b.from);
  const { cuts: made, moved, dropped } = input.quiet ? inTheQuiet(sorted, input, transcript?.words ?? [], input.quiet) : { cuts: sorted, moved: 0, dropped: 0 };
  const { cuts, added, kept } = mergeCuts((raw.cuts as RawCut[] | undefined) ?? [], made, kinds, taken);
  const fillers = added.filter((cut) => cut.auto === 'filler').length;
  const pauses = added.filter((cut) => cut.auto === 'pause').length;
  const retaken = added.filter((cut) => cut.auto === 'retake').length;
  const off = added.filter((cut) => cut.enabled === false).length;
  const notes: string[] = [];
  if (retaken > 0) notes.push(`cut ${retaken} retake${retaken === 1 ? '' : 's'}: back to the pause before each slip (the mistake key, a spoken "nochmal" that was then said again, or a sentence begun again)`);
  if (!project.autoEdits.retakes) notes.push('retake cuts are switched off (autoEdits.retakes)');
  if (fillers + pauses > 0) {
    const removed = added.filter((cut) => cut.enabled !== false && cut.auto !== 'retake').reduce((sum, cut) => sum + cut.to - cut.from, 0);
```

In the same file, replace:

```ts
  }
  if (transcript && !project.autoEdits.fillers) notes.push('filler cuts are switched off (autoEdits.fillers)');
  if (transcript && !project.autoEdits.pauses) notes.push('pause cuts are switched off (autoEdits.pauses)');
  if (kept > 0) notes.push(`kept ${kept} cut${kept === 1 ? '' : 's'} made by hand or by other steps`);
  return { cuts, fillers, pauses, retakes: retaken, off, notes };
}
```

with:

```ts
  }
  if (transcript && !project.autoEdits.fillers) notes.push('filler cuts are switched off (autoEdits.fillers)');
  if (transcript && !project.autoEdits.pauses) notes.push('pause cuts are switched off (autoEdits.pauses)');
  if (moved > 0) notes.push(`moved ${moved} cut edge${moved === 1 ? '' : 's'} into the mic's quiet, clear of the speech`);
  if (dropped > 0) notes.push(`left out ${dropped} cut${dropped === 1 ? '' : 's'} with no quiet in the mic near ${dropped === 1 ? 'its' : 'their'} edges: the words there run together`);
  if (kept > 0) notes.push(`kept ${kept} cut${kept === 1 ? '' : 's'} made by hand or by other steps`);
  return { cuts, fillers, pauses, retakes: retaken, off, notes };
}
```

In the same file, replace:

```ts
  }
  const markers = sources.markers ? await readMarkers(resolve(file.dir, sources.markers)) : [];
  const clips = file.project.scenes.flatMap((scene) => (scene.type === 'clip' ? [{ from: scene.from, to: scene.to, speed: scene.speed }] : []));
  const result = withSpeechCuts(file.raw, file.project, { transcript, markers, speech: wordStretches(transcript), still: screen.still, events, clips });
  const before = JSON.stringify(file.raw.cuts ?? []);
  const linking = (options.link !== undefined && options.link !== sources.transcript) || (options.cleanMic !== undefined && options.cleanMic !== sources.cleanMic);
  if (JSON.stringify(result.cuts) === before && !linking) return { ...result, project: file.path, written: false };
```

with:

```ts
  }
  const markers = sources.markers ? await readMarkers(resolve(file.dir, sources.markers)) : [];
  const clips = file.project.scenes.flatMap((scene) => (scene.type === 'clip' ? [{ from: scene.from, to: scene.to, speed: scene.speed }] : []));
  const quiet = await micQuiet(file.dir, sources);
  const result = withSpeechCuts(file.raw, file.project, { transcript, markers, speech: wordStretches(transcript), still: screen.still, events, clips, ...(quiet && { quiet }) });
  const before = JSON.stringify(file.raw.cuts ?? []);
  const linking = (options.link !== undefined && options.link !== sources.transcript) || (options.cleanMic !== undefined && options.cleanMic !== sources.cleanMic);
  if (JSON.stringify(result.cuts) === before && !linking) return { ...result, project: file.path, written: false };
```

In `packages/core/src/suggest.ts`, replace:

```ts
import { screenStretches, typingZooms, type ScreenChange } from './suggest/typing';
import { withStepTitles, type StepTitles } from './suggest/steps';
import { takeClock, transcriptMarkers } from './suggest/transcript';
import { readMarkers, speechActivity, withSpeechCuts, wordStretches } from './speech/apply';
import type { RawCut } from './speech/edits';
import { chooseModel } from './speech/models';
import { readTranscript, transcribeTake } from './speech/transcribe';
```

with:

```ts
import { screenStretches, typingZooms, type ScreenChange } from './suggest/typing';
import { withStepTitles, type StepTitles } from './suggest/steps';
import { takeClock, transcriptMarkers } from './suggest/transcript';
import { micQuiet, readMarkers, speechActivity, withSpeechCuts, wordStretches } from './speech/apply';
import type { RawCut } from './speech/edits';
import { chooseModel } from './speech/models';
import { readTranscript, transcribeTake } from './speech/transcribe';
```

In the same file, replace:

```ts
    // the pauses before a slip: between the words, or between the mic's loud stretches
    const pauses = transcript ? wordStretches(transcript) : speech.from === 'mic' ? speech.spans : [];
    const clips = suggestion.clips.map(({ from: start, to, speed }) => ({ from: start, to, speed }));
    const result = withSpeechCuts(file.raw, file.project, { ...(transcript && { transcript }), markers, speech: pauses, still: screenInfo.still, events, clips }, taken);
    notes.push(...result.notes);
    cuts = result.cuts;
    made = { fillers: result.fillers, pauses: result.pauses, retakes: result.retakes };
```

with:

```ts
    // the pauses before a slip: between the words, or between the mic's loud stretches
    const pauses = transcript ? wordStretches(transcript) : speech.from === 'mic' ? speech.spans : [];
    const clips = suggestion.clips.map(({ from: start, to, speed }) => ({ from: start, to, speed }));
    // the cuts' edges go where the mic is quiet: word times are estimates
    const quiet = args.speech !== false ? await micQuiet(file.dir, sources) : undefined;
    const result = withSpeechCuts(file.raw, file.project, { ...(transcript && { transcript }), markers, speech: pauses, still: screenInfo.still, events, clips, ...(quiet && { quiet }) }, taken);
    notes.push(...result.notes);
    cuts = result.cuts;
    made = { fillers: result.fillers, pauses: result.pauses, retakes: result.retakes };
```

Run: `pnpm exec vitest run --project node packages/core/test/retakes.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/speech/retakes.ts packages/core/src/speech/apply.ts packages/core/src/suggest.ts packages/core/test/retakes.test.ts
git commit -m "speech cuts: a sentence begun again is a retake; every speech cut begins and ends in the mic's quiet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A word before a full stop or a comma goes before the pause

**Files:**
- Create: `packages/core/test/fixtures/speech/de-restart.m4a`, `packages/core/test/fixtures/speech/de-restart.small.txt`
- Modify: `packages/core/src/speech/align.ts`
- Test: `packages/core/test/speech.test.ts`

- [ ] **Step 1: The fixture**

A realistic take: Windows' voice Hedda (`System.Speech`) says the text below, mixed with pink noise (amplitude 0.008) and three breaths (brown noise, 0.35 s, 300 to 2500 Hz, at 5.6, 9.4 and 21.8 s). The noise is random, so the mix is given as `MIC`, a 48 kHz mono WAV, and encoded here:

```text
[1 s] Heute zeige ich euch, wie man ein Video schneidet. [2 s] Zuerst öffnet ihr die Einstellungen.
[0.9 s] Dann klickt ihr auf [0.7 s] Dann klickt ihr auf Exportieren und wählt das Format sechzehn
zu neun. [1.5 s] Fertig ist das Video. [1 s]
```

```bash
MIC="${MIC:?the realistic take, a 48 kHz mono WAV}"
ffmpeg -hide_banner -loglevel error -y -i "$MIC" -ar 24000 -ac 1 -c:a aac -b:a 48k packages/core/test/fixtures/speech/de-restart.m4a
```

What the small model heard in it, in the filter's lines (quotation marks unescaped, as the filter writes them):

`packages/core/test/fixtures/speech/de-restart.small.txt`:

```
{"start":0,"end":550,"text":"Heute"}
{"start":550,"end":1150,"text":"zeige"}
{"start":1150,"end":1430,"text":"ich"}
{"start":1430,"end":2090,"text":"euch,"}
{"start":2090,"end":2410,"text":"wie"}
{"start":2410,"end":2870,"text":"man"}
{"start":2870,"end":3080,"text":"ein"}
{"start":3080,"end":3630,"text":"Video"}
{"start":3630,"end":5000,"text":"schneidet."}
{"start":6000,"end":6000,"text":"Zuerst"}
{"start":6000,"end":7150,"text":"öffnet"}
{"start":7150,"end":7400,"text":"ihr"}
{"start":7400,"end":7880,"text":"die"}
{"start":7880,"end":10000,"text":"Einstellungen."}
{"start":10000,"end":11110,"text":"Dann"}
{"start":11110,"end":11860,"text":"klickt"}
{"start":11860,"end":12870,"text":"ihr"}
{"start":12870,"end":13230,"text":"auf."}
{"start":13230,"end":13540,"text":"Dann"}
{"start":13540,"end":14000,"text":"klickt"}
{"start":14000,"end":14230,"text":"ihr"}
{"start":14230,"end":14460,"text":"auf"}
{"start":14460,"end":15390,"text":""Exportieren"}
{"start":15390,"end":15620,"text":"und"}
{"start":15620,"end":15990,"text":"wählt"}
{"start":15990,"end":16230,"text":"das"}
{"start":16230,"end":16690,"text":"Format"}
{"start":16690,"end":17170,"text":"16"}
{"start":17170,"end":17410,"text":"zu"}
{"start":17410,"end":18000,"text":"9"."}
{"start":18000,"end":19190,"text":"Fertig"}
{"start":19190,"end":19790,"text":"ist"}
{"start":19790,"end":20870,"text":"das"}
{"start":20870,"end":22000,"text":"Video!"}
```

- [ ] **Step 2: Write the failing tests**

The new case, and the existing ones at their better placements: "Um," and "M." (whisper's "Ähm") now land in their short stretches. The filler hint is shown with the stops and commas switched off:

In `packages/core/test/speech.test.ts`, replace:

```ts
import { runFfmpeg } from '../src/ffmpeg';
import { streamSeconds } from '../src/suggest/media';
import { suggestClips } from '../src/suggest/plan';
import { alignWords, guessLanguage } from '../src/speech/align';
import { cleanMic, cleanupFilter, denoiseLatency } from '../src/speech/cleanup';
import { likelyFiller, normWord } from '@cuttle/project';
import { fillerCuts, fillerWords, mergeCuts, pauseCuts, restingAt, speechCuts, type SpeechEditInput } from '../src/speech/edits';
```

with:

```ts
import { runFfmpeg } from '../src/ffmpeg';
import { streamSeconds } from '../src/suggest/media';
import { suggestClips } from '../src/suggest/plan';
import { ALIGN_RULES, alignWords, guessLanguage } from '../src/speech/align';
import { cleanMic, cleanupFilter, denoiseLatency } from '../src/speech/cleanup';
import { likelyFiller, normWord } from '@cuttle/project';
import { fillerCuts, fillerWords, mergeCuts, pauseCuts, restingAt, speechCuts, type SpeechEditInput } from '../src/speech/edits';
```

In the same file, replace:

```ts
    // the English fixture with the base model: "Um," heard at 7.0–7.54 s, spoken at 7.55–7.84 s
    const heard = parseWhisperLines(readFileSync(join(fixtures, 'en.base.txt'), 'utf8'));
    const stretches = [[0.11, 0.88], [2.02, 2.24], [2.62, 5.22], [7.55, 7.84], [8.22, 9.45], [10.29, 10.83], [11.65, 14], [15.65, 17.98]].map(([from, to]) => ({ from: from!, to: to! }));
    expect(alignWords(heard, stretches).words.find((w) => w.text === 'Um,')?.t).toBe(8.22);
    const result = alignWords(heard, stretches, { filler: (w) => w.text === 'Um,' });
    expect(result.words.find((w) => w.text === 'Um,')).toEqual({ text: 'Um,', t: 7.55, end: 7.84 });
    expect(result.sounds).toEqual([]);
  });

  it('leaves out words heard where the mic is quiet', () => {
```

with:

```ts
    // the English fixture with the base model: "Um," heard at 7.0–7.54 s, spoken at 7.55–7.84 s
    const heard = parseWhisperLines(readFileSync(join(fixtures, 'en.base.txt'), 'utf8'));
    const stretches = [[0.11, 0.88], [2.02, 2.24], [2.62, 5.22], [7.55, 7.84], [8.22, 9.45], [10.29, 10.83], [11.65, 14], [15.65, 17.98]].map(([from, to]) => ({ from: from!, to: to! }));
    const plain = { ...ALIGN_RULES, sentenceEnd: 0, clauseEnd: 0 };
    expect(alignWords(heard, stretches, { rules: plain }).words.find((w) => w.text === 'Um,')?.t).toBe(8.22);
    const result = alignWords(heard, stretches, { rules: plain, filler: (w) => w.text === 'Um,' });
    expect(result.words.find((w) => w.text === 'Um,')).toEqual({ text: 'Um,', t: 7.55, end: 7.84 });
    expect(result.sounds).toEqual([]);
    // the comma after it does it too: the word before a comma goes before the pause
    expect(alignWords(heard, stretches).words.find((w) => w.text === 'Um,')?.t).toBe(7.55);
  });

  it('leaves out words heard where the mic is quiet', () => {
```

In the same file, replace:

```ts
}

describe('the alignment on spoken fixtures', () => {
  for (const [language, filler] of [['de', 8.73], ['en', 7.555]] as const) {
    it(`lines up the small model's words in ${language} and finds the filler it left out`, async () => {
      const heard = parseWhisperLines(readFileSync(join(fixtures, `${language}.small.txt`), 'utf8'));
      const truth = JSON.parse(readFileSync(join(fixtures, `${language}.words.json`), 'utf8')) as { t: number; text: string }[];
      const result = alignWords(heard, speechStretches(await micLevels(join(fixtures, `${language}.m4a`))), { filler: (w) => likelyFiller(w.text, language) });
```

with:

```ts
}

describe('the alignment on spoken fixtures', () => {
  // the filler, spoken alone ("Ähm", which whisper wrote "M.", and "Um,"), and whisper's start for it
  for (const [language, filler, text, heardAt] of [['de', 8.73, 'M.', 7], ['en', 7.555, 'Um,', 7.5]] as const) {
    it(`lines up the small model's words in ${language}, the filler in its short stretch of its own`, async () => {
      const heard = parseWhisperLines(readFileSync(join(fixtures, `${language}.small.txt`), 'utf8'));
      const truth = JSON.parse(readFileSync(join(fixtures, `${language}.words.json`), 'utf8')) as { t: number; text: string }[];
      const result = alignWords(heard, speechStretches(await micLevels(join(fixtures, `${language}.m4a`))), { filler: (w) => likelyFiller(w.text, language) });
```

In the same file, replace:

```ts
      expect(median(before)).toBeGreaterThan(0.2);
      expect(median(after)).toBeLessThan(0.1);
      expect(after[Math.floor(after.length * 0.9)]).toBeLessThan(0.25);
      // the filler whisper did not write is a sound of its own
      expect(result.sounds.some((sound) => Math.abs(sound.from - filler) < 0.1 && sound.to - sound.from < 0.8)).toBe(true);
    });
  }
});

const tw = (t: number, end: number, text: string): TranscriptWord => ({ t, end, text });
```

with:

```ts
      expect(median(before)).toBeGreaterThan(0.2);
      expect(median(after)).toBeLessThan(0.1);
      expect(after[Math.floor(after.length * 0.9)]).toBeLessThan(0.25);
      expect(heard.find((w) => w.text === text)?.t).toBe(heardAt);
      expect(result.words.find((w) => w.text === text)?.t).toBeCloseTo(filler, 1);
    });
  }

  it('puts a word before a full stop or a comma before the pause, where whisper put it after', async () => {
    // "Heute zeige ich euch, [pause] wie man …" and "Dann klickt ihr auf. [0.7 s] Dann klickt ihr auf
    // Exportieren …" over pink noise and breaths: the small model heard "wie" before the first pause
    // and the broken "auf." in the "Dann" said again (spoken at 2.87 s and 12.96 s)
    const heard = parseWhisperLines(readFileSync(join(fixtures, 'de-restart.small.txt'), 'utf8'));
    const result = alignWords(heard, speechStretches(await micLevels(join(fixtures, 'de-restart.m4a'))), { filler: (w) => likelyFiller(w.text, 'de') });
    const said = (text: string, n = 0) => result.words.filter((w) => w.text === text)[n]!;
    expect(said('wie').t).toBeCloseTo(2.87, 1);
    expect(said('auf.').end).toBeLessThan(12.25);
    expect(said('Dann', 1).t).toBeCloseTo(12.96, 1);
  });
});

const tw = (t: number, end: number, text: string): TranscriptWord => ({ t, end, text });
```

Run: `pnpm exec vitest run --project node packages/core/test/speech.test.ts`
Expected: FAIL: "wie" at 2.13 instead of 2.87, "auf." in the stretch after the pause, the fillers a stretch away.

- [ ] **Step 3: The stops and commas in the alignment**

In `packages/core/src/speech/align.ts`, replace:

```ts
// Word times from one whisper run (good text, coarse times) refined by the audio: each speech
// stretch takes, in order, the run of words whose letters fit its length at the take's speaking rate,
// near where whisper put them; inside a stretch the words share its length by their letters. In the
// spike this cut the median start error from about 500 ms to 35 to 76 ms.
import { normWord } from '@cuttle/project';
import type { Span } from '../suggest/spans';
import type { HeardWord } from './whisper';
```

with:

```ts
// Word times from one whisper run (good text, coarse times) refined by the audio: each speech
// stretch takes, in order, the run of words whose letters fit its length at the take's speaking rate,
// near where whisper put them, a word before a full stop or a comma at a stretch's end (people pause
// there); inside a stretch the words share its length by their letters. In the spike this cut the
// median start error from about 500 ms to 35 to 76 ms (29 to 57 ms with the stops and commas).
import { normWord } from '@cuttle/project';
import type { Span } from '../suggest/spans';
import type { HeardWord } from './whisper';
```

In the same file, replace:

```ts
   * stretch of its own, and whisper often puts it a little early or late.
   */
  fillerShared: 0.3,
};

export interface Alignment {
```

with:

```ts
   * stretch of its own, and whisper often puts it a little early or late.
   */
  fillerShared: 0.3,
  /**
   * What a word ending a sentence (".", "?", "!") costs inside a stretch's run, not at its end, and
   * a word before a comma, colon or semicolon: people pause there, and whisper often puts the word
   * before the pause after it ("Dann klickt ihr | auf. Dann klickt ihr auf Exportieren").
   */
  sentenceEnd: 0.6,
  clauseEnd: 0.3,
};

export interface Alignment {
```

In the same file, replace:

```ts
): Alignment {
  const rules = options.rules ?? ALIGN_RULES;
  const filler = words.map((word) => options.filler?.(word) ?? false);
  const W = words.length;
  const S = stretches.length;
  const unchanged = (): Alignment => ({ words: words.map((word) => ({ ...word })), sounds: [], dropped: [], aligned: false });
```

with:

```ts
): Alignment {
  const rules = options.rules ?? ALIGN_RULES;
  const filler = words.map((word) => options.filler?.(word) ?? false);
  const mark = words.map((word) => (/[.?!…]["'’”)\]]*$/.test(word.text) ? rules.sentenceEnd : /[,;:]["'’”)\]]*$/.test(word.text) ? rules.clauseEnd : 0));
  const W = words.length;
  const S = stretches.length;
  const unchanged = (): Alignment => ({ words: words.map((word) => ({ ...word })), sounds: [], dropped: [], aligned: false });
```

In the same file, replace:

```ts
      let chars = 0;
      let far = 0;
      let fillers = 0;
      for (let j = i + 1; j <= W; j++) {
        const word = words[j - 1]!;
        const mid = middle(word);
```

with:

```ts
      let chars = 0;
      let far = 0;
      let fillers = 0;
      // the pause marks of the words before the run's last
      let marks = 0;
      for (let j = i + 1; j <= W; j++) {
        const word = words[j - 1]!;
        const mid = middle(word);
```

In the same file, replace:

```ts
        chars += letters(word);
        far += mid < a ? a - mid : mid > b ? mid - b : 0;
        if (filler[j - 1]) fillers++;
        relax(i, j, base + Math.abs(len - chars * rate) + far / (j - i) + (j - i > 1 ? fillers * rules.fillerShared : 0));
        // Far more letters than fit: longer runs only cost more.
        if (chars * rate > len * 3 + 2) break;
      }
```

with:

```ts
        chars += letters(word);
        far += mid < a ? a - mid : mid > b ? mid - b : 0;
        if (filler[j - 1]) fillers++;
        if (j - 1 > i) marks += mark[j - 2]!;
        relax(i, j, base + Math.abs(len - chars * rate) + far / (j - i) + (j - i > 1 ? fillers * rules.fillerShared : 0) + marks);
        // Far more letters than fit: longer runs only cost more.
        if (chars * rate > len * 3 + 2) break;
      }
```

Run: `pnpm exec vitest run --project node packages/core/test/speech.test.ts`
Expected: PASS, 27 tests.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/speech/align.ts packages/core/test/speech.test.ts packages/core/test/fixtures/speech/de-restart.m4a packages/core/test/fixtures/speech/de-restart.small.txt
git commit -m "alignment: a word before a full stop or a comma goes at the end of a speech stretch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The realistic take end to end, and the skill

**Files:**
- Modify: `packages/core/test/speech-take.test.ts`, `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`

- [ ] **Step 1: The end-to-end test**

It transcribes the realistic take, runs `suggest` and checks the cut against what was said (measured on the mic), and the captions. It runs where a speech model and ffmpeg's whisper filter are:

In `packages/core/test/speech-take.test.ts`, replace:

```ts
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseTranscriptJson } from '@cuttle/project';
import { ffmpegPath, runFfmpeg } from '../src/ffmpeg';
import { applySpeechEdits } from '../src/speech/apply';
import { transcribeTake } from '../src/speech/transcribe';
```

with:

```ts
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { normWord, parseProject, parseTranscriptJson } from '@cuttle/project';
import { captionWords, sceneSpans } from '@cuttle/timeline';
import { ffmpegPath, runFfmpeg } from '../src/ffmpeg';
import { applySpeechEdits } from '../src/speech/apply';
import { transcribeTake } from '../src/speech/transcribe';
```

In the same file, replace:

```ts
const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

/** A project whose take is a still screen and the English fixture as its mic, which started 0.2 s after the screen. */
async function spokenTake(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-spoken-'));
  dirs.push(dir);
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=640x360:r=30:d=19.5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(take, 'screen.mp4')]);
  copyFileSync(join(fixtures, 'en.m4a'), join(take, 'mic.m4a'));
  writeFileSync(join(take, 'events.jsonl'), '');
  writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 }, mic: { file: 'mic.m4a', start: 1000.2 } } }));
  writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a', events: 'takes/1/events.jsonl' } }));
```

with:

```ts
const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

/** A project whose take is a still screen and a fixture as its mic, which started 0.2 s after the screen. */
async function spokenTake(mic = 'en.m4a', seconds = 19.5): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-spoken-'));
  dirs.push(dir);
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
  await runFfmpeg(['-f', 'lavfi', '-i', `color=c=0x202020:s=640x360:r=30:d=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(take, 'screen.mp4')]);
  copyFileSync(join(fixtures, mic), join(take, 'mic.m4a'));
  writeFileSync(join(take, 'events.jsonl'), '');
  writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 }, mic: { file: 'mic.m4a', start: 1000.2 } } }));
  writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a', events: 'takes/1/events.jsonl' } }));
```

In the same file, replace:

```ts
    expect(again.written).toBe(false);
    expect(readFileSync(join(dir, 'cuttle.json'), 'utf8')).toBe(before);
  }, 120_000);
});
```

with:

```ts
    expect(again.written).toBe(false);
    expect(readFileSync(join(dir, 'cuttle.json'), 'utf8')).toBe(before);
  }, 120_000);

  it('cuts a sentence begun again without a cue, never into the speech, and the captions say what stays', async () => {
    process.env.CUTTLE_MODELS_DIR = modelsDir;
    // "… die Einstellungen. Dann klickt ihr auf [0.7 s] Dann klickt ihr auf Exportieren …" over pink
    // noise and breaths; what was said, measured on the mic, on the screen's time (+0.2 s)
    const said = [[1.12, 4.31], [7.4, 9.37], [11.16, 12.25], [12.96, 16.92], [19.35, 20.64]].map(([from, to]) => ({ from: from! + 0.2, to: to! + 0.2 }));
    const dir = await spokenTake('de-restart.m4a', 23);
    await transcribeTake(dir, { model, language: 'de' });
    const result = await suggestProject(dir);
    const cuts = result.cuts ?? [];
    // the broken "Dann klickt ihr auf" goes, up to just before it is said again
    const restart = cuts.find((cut) => cut.label?.startsWith('Restart: '));
    expect(restart, JSON.stringify(cuts)).toBeDefined();
    expect(restart!.from).toBeLessThanOrEqual(said[2]!.from);
    expect(restart!.to).toBeGreaterThanOrEqual(said[2]!.to);
    expect(restart!.to).toBeLessThanOrEqual(said[3]!.from - 0.1);
    // no cut begins or ends in what was said
    for (const cut of cuts) for (const edge of [cut.from, cut.to]) expect(said.some((span) => span.from < edge && edge < span.to), `${cut.label} at ${edge}`).toBe(false);
    // the captions: the sentence once, nothing of the broken one
    const project = parseProject(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')));
    if (!project.ok) throw new Error('invalid project');
    const transcript = parseTranscriptJson(readFileSync(join(dir, 'takes', '1', 'transcript.json'), 'utf8'));
    if (!transcript.ok) throw new Error('invalid transcript');
    const shown = captionWords(transcript.transcript.words, sceneSpans(project.project.scenes, project.project.cuts)).map((word) => normWord(word.text)).join(' ');
    expect(shown).toMatch(/einstellungen dann klickt ihr auf export/);
    expect(shown.match(/dann klickt ihr/g)).toHaveLength(1);
  }, 120_000);
});
```

Run: `pnpm exec vitest run --project node packages/core/test/speech-take.test.ts`
Expected: PASS, 2 tests (skipped without a model).

- [ ] **Step 2: The skill**

In `skill/cuttle/SKILL.md`, replace:

```markdown
  When the user will speak, Cuttle transcribes the mic on this computer and cuts filler words and
  pauses. That needs a speech model: `cuttle --json models` lists them. If none is downloaded, ask
  the user before `cuttle models download small` (488 MB, once). Tell them that a slip needs no
  new take: press Ctrl+Shift+Alt+X (or say "nochmal", "again") and do the bit again.
- Ask the user to make text large (terminal font 16 px or more, or zoom the browser), to close
  private windows, to switch on Do not disturb (Cuttle masks the notifications it sees, but none is
  better), and to use a clean folder or browser profile.
```

with:

```markdown
  When the user will speak, Cuttle transcribes the mic on this computer and cuts filler words and
  pauses. That needs a speech model: `cuttle --json models` lists them. If none is downloaded, ask
  the user before `cuttle models download small` (488 MB, once). Tell them that a slip needs no
  new take: press Ctrl+Shift+Alt+X (or say "nochmal", "again", or just pause and begin the
  sentence again) and do the bit again.
- Ask the user to make text large (terminal font 16 px or more, or zoom the browser), to close
  private windows, to switch on Do not disturb (Cuttle masks the notifications it sees, but none is
  better), and to use a clean folder or browser profile.
```

In the same file, replace:

```markdown

**Slips.** The mistake key (Ctrl+Shift+Alt+X, or the scissors in the recording bar) marks a slip
in `markers.json` (kind `retake`). A spoken cue counts too when the bit is then said again ("…die
Art. Nochmal. Die App erkennt die Art …"; also "noch mal", "again", "one more time"). `suggest`
cuts each slip from the pause before it to where the bit starts again (cuts tagged `retake`,
"Retake" or "Retake: “Nochmal”"); the key needs no speech model. Check each with `preview --at`
just before and after the cut; if it took too much or too little, move its `from` or `to` and
remove its `auto`.

**Subtitles.** A transcribed take gets subtitles in the video (`captions`, project.md): as
subtitles at the bottom, `karaoke` (the spoken word in colour) or `bold` (a few big words, for
```

with:

```markdown

**Slips.** The mistake key (Ctrl+Shift+Alt+X, or the scissors in the recording bar) marks a slip
in `markers.json` (kind `retake`). A spoken cue counts too when the bit is then said again ("…die
Art. Nochmal. Die App erkennt die Art …"; also "noch mal", "again", "one more time"), and so
does a sentence begun again after a pause ("Dann klickt ihr auf … Dann klickt ihr auf
Exportieren"). `suggest` cuts each slip from the pause before it to where the bit starts again
(cuts tagged `retake`, "Retake", "Retake: “Nochmal”" or "Restart: “Dann klickt ihr auf”"); the
key needs no speech model. Every speech cut begins and ends where the mic is quiet: its notes say
how many edges it moved there, and which cuts it left out because the words ran together. Check
each with `preview --at` just before and after the cut; if it took too much or too little, move
its `from` or `to` and remove its `auto`.

**Subtitles.** A transcribed take gets subtitles in the video (`captions`, project.md): as
subtitles at the bottom, `karaoke` (the spoken word in colour) or `bold` (a few big words, for
```

In `skill/cuttle/project.md`, replace:

```markdown
`cuts` take a stretch out of whatever clip covers it, without splitting the clip: `from` and `to`
(source seconds) and `enabled` (`true`). The video jumps there (no crossfade); zooms, masks and
texts run on across it. Use them for a slip, a filler or a pause inside a clip; `suggest` makes
them for slips ("Retake": the mistake key, or a spoken "nochmal" with the bit said again), filler
words ("Filler: äh") and pauses ("Pause: 2.4 s") from the transcript.

Every scene, zoom, mask, text, overlay and cut may have an `id` (1 to 64 letters, digits, `-` or `_`,
unique in the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest`
```

with:

```markdown
`cuts` take a stretch out of whatever clip covers it, without splitting the clip: `from` and `to`
(source seconds) and `enabled` (`true`). The video jumps there (no crossfade); zooms, masks and
texts run on across it. Use them for a slip, a filler or a pause inside a clip; `suggest` makes
them for slips ("Retake": the mistake key, or a spoken "nochmal" with the bit said again;
"Restart": a sentence begun again), filler words ("Filler: äh") and pauses ("Pause: 2.4 s") from
the transcript, each beginning and ending where the mic is quiet.

Every scene, zoom, mask, text, overlay and cut may have an `id` (1 to 64 letters, digits, `-` or `_`,
unique in the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest`
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/speech-take.test.ts skill/cuttle/SKILL.md skill/cuttle/project.md
git commit -m "speech cuts: the realistic take end to end; the skill names the restarts and the quiet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: All tests, the typecheck and the checks

- [ ] **Step 1: Run them**

Run: `pnpm test`
Expected: PASS, 1016 passed, 82 skipped.

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 17 tests.

Run: `pnpm app:check`
Expected: PASS, 58 tests.

## Changes during execution

- It was written from the finished prototype and replayed on a fresh clone for its commits; the tree came out byte-identical to the prototype.

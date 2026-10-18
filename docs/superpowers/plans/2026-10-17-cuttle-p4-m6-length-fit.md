# Cuttle P4-M6: Fitting the Video to a Length Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The video fits a length the person asks for: Cuttle cuts where it rests, never speech, clicks, typing, a zoom or a text, and says the shortest it can make when the length is out of reach. From the CLI (`suggest --length`, `fit`) and from the editor's timeline bar.

**Architecture:**
- **Timeline** (`importance.ts`, pure):
  - a level per quarter second of the output: high, middle or low;
  - the fit cuts the longest low runs first, then middle ones, never high ones.
- **Core:**
  - `cachedAnalysis` keeps the screen's analysis in the project (`.cuttle/analysis/`), so a fit after suggest does not decode the take again;
  - `withLengthFit` merges the fit's cuts (`auto: "length"`) by the tag rules;
  - `applyLengthFit` is the step the app and `cuttle fit` run;
  - `suggest --length` fits in the same run.
- **CLI:** `suggest --length <s>`, `fit <s>`, `fit --off`.
- **App:**
  - a `fit-length` media job whose answer is the fit's report (the worker protocol carries a job's result);
  - `main/length.ts` makes the fit one step to undo ("Cuttle's length fit");
  - the timeline bar's length is a menu: 15, 30, 45, 60, 90 s, another length typed in, or the full length.
- **Skill:** fit last, after the hand edits.

**Tech Stack:** TypeScript strict, zod 4, vitest 5, ffmpeg (`freezedetect`), Electron 44.7.2, React 19.3.0, Playwright (`_electron`).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase4-design.md` (Length). Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p4-m5c-typing-sounds.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p4-m6`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 6.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The prototype passed `pnpm test` (728 tests, 58 skipped), the typecheck, `app:check` (47 tests) and `cli:check` (5). Every screenshot was looked at.

- **The levels** (`LENGTH_RULES`, one per 0.25 s of output):
  - **High:**
    - speech (the transcript's words, else the mic's loud stretches);
    - a click with 0.3 s around it;
    - a key count's half second;
    - every zoom that is on (made by hand or by Cuttle: it shows what matters, Claude's answer among them);
    - every text on screen;
    - the first second of each scene;
    - stills and cards: only clips are cut.
  - **Middle:** where the screen changed (the gaps between `freezedetect`'s still stretches), and where the pointer moved or scrolled.
  - **Low:** the rest.
- **The fit** (`fitLength`):
  - Runs of slots at low, then at low or middle, inside one clip's piece, each kept 0.1 s from what stays, at least 0.6 s.
  - The longest go first, whole. The last run gives only what is still needed (at least 0.6 s), from its middle.
  - The video fits when it is at most 1/8 s over the target, so no 0.6 s cut is made for a few milliseconds. It lands up to 0.6 s under the target.
  - A sped-up clip is cut in output seconds: 2 s of an 8× clip are 16 source seconds.
  - When high slots are all that is left, it stops and says "shortest without cutting speech, clicks, typing, a zoom or a text: 42 s".
- **The tag rules:** the fit's cuts are `auto: "length"`, labelled "Fit to 30 s". A new fit replaces the last; the other cuts stay and count (the fit works on the video they leave). A fit cut that takes the place of one switched off stays off (`mergeCuts`). The Auto tab lists them under "Cut to fit the length" (P4-M1's group).
- **The screen's analysis is kept** in the project's `.cuttle/analysis/` (one file per screen track, with the track's size and time), beside the app's other caches: `suggest` writes it, the fit reads it. Never in a take's folder: a restart moves that folder and the take menu deletes it. Without the file, the fit decodes the take first (a few seconds for a long take); a changed take is read again.
- **`cuttle fit`** joins `suggest --length`: the skill has Claude edit after one `suggest` run, so the fit that keeps Claude's own zooms and texts comes last. `--off` takes it out; the same fit again writes nothing.
- **In the app:**
  - The bar shows the length ("0:44.2", "· fitted" after a fit) as a menu: 15, 30, 45, 60, 90 s ("fits" beside those it already fits), "Other length…" (a field: Enter fits), and "Full length" while a fit is there.
  - The fit runs in the media worker and arrives as one step to undo, "Cuttle's length fit". The toast says "Cuttle cut where the video rests to fit 30 s: 29.8 s now", or the shortest it could make. A fit that changes nothing says so ("The video is 10.1 s: it fits 15 s").
  - The worker's done answer carries a job's result (`JobResult`: the thumbnails' layout or a `LengthReport`), and `mediaWorker.run<T>` types it.
  - Before the fit's origin is set, the editor's watcher looks at once (`settle`, as for the privacy step in P4-M5b).

## File structure

| File | Responsibility |
|---|---|
| `packages/timeline/src/{importance,index}.ts` | levels and the fit |
| `packages/core/src/suggest/{length,media}.ts`, `src/{suggest,index}.ts` | the fit in a project, the kept analysis, `suggest --length` |
| `apps/cli/src/{main.ts,commands/fit.ts}` | `--length`, `cuttle fit` |
| `apps/desktop/src/shared/{media-jobs,ipc,channels}.ts`, `src/workers/media.ts`, `src/main/{media-service,length,windows}.ts` | the job, its report, the step |
| `apps/desktop/src/renderer/editor/{Timeline.tsx,doc.ts,editor.css}` | the Length menu, the toasts |
| `skill/cuttle/SKILL.md`, `skill/test/skill.test.ts` | fit last |

---

### Task 1: Levels and the fit

**Files:**
- Create: `packages/timeline/src/importance.ts`, `packages/timeline/test/importance.test.ts`
- Modify: `packages/timeline/src/index.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p4-m6`; work there:

```bash
git switch p4-m6
```

- [ ] **Step 2: Write the failing test**

`packages/timeline/test/importance.test.ts`:

```ts
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
```

Run: `pnpm exec vitest run --project node packages/timeline/test/importance.test.ts`
Expected: FAIL: `../src/importance` does not exist.

- [ ] **Step 3: The module**

`packages/timeline/src/importance.ts`:

```ts
// Fitting a video to a length: how much each moment matters, and which ones to cut. Each quarter
// second of the output gets a level: high where something happens that the video is for (speech, a
// click, typing, Claude's answer, a text on screen, the first second of a scene), middle where the
// screen changes or the pointer moves, low where it rests. The fit cuts the longest low runs first,
// then the middle ones, never a high one: never inside a word, never near a click. Pure.
import type { InputEvent } from '@cuttle/project';
import type { SceneSpan } from './time';

/** A stretch of source seconds. */
export interface SourceSpan {
  from: number;
  to: number;
}

export const LENGTH_RULES = {
  /** Output seconds per level. */
  slot: 0.25,
  /** The first this many output seconds of a scene stay. */
  sceneStart: 1,
  /** Source seconds kept around a click. */
  clickGuard: 0.3,
  /** A key count covers this many source seconds from its time (the recorder's window). */
  keyWindow: 0.5,
  /** The shortest cut (output seconds); a shorter run stays. */
  minCut: 0.6,
  /** Output seconds left at each end of a run that is cut, so a cut never meets what stays head on. */
  margin: 0.1,
  /** Within this many output seconds over the target the video fits: no cut for less. */
  close: 0.125,
};

export type Level = 0 | 1 | 2;
export const LOW: Level = 0;
export const MIDDLE: Level = 1;
export const HIGH: Level = 2;

export interface ImportanceInput {
  /** The output timeline (`sceneSpans` with the cuts that stay). */
  spans: readonly SceneSpan[];
  /** Where someone speaks (source seconds): the words, padded. */
  speech: readonly SourceSpan[];
  /** The take's input: clicks and keys are high, the pointer moving and scrolls middle. */
  events: readonly InputEvent[];
  /** Where the screen changed (source seconds). */
  changes: readonly SourceSpan[];
  /** Other stretches that must stay (source seconds): the answer's zoom, texts on screen. */
  keep?: readonly SourceSpan[];
}

const overlaps = (spans: readonly SourceSpan[], from: number, to: number) => spans.some((span) => span.from < to && from < span.to);

/**
 * The level of each `slot` of the output timeline, from 0: a still or a card is high (only clips
 * are cut), a clip's slot by what its source stretch holds.
 */
export function importance(input: ImportanceInput, rules = LENGTH_RULES): Level[] {
  const total = input.spans.at(-1)?.end ?? 0;
  const high: SourceSpan[] = [...input.speech, ...(input.keep ?? [])];
  const middle: SourceSpan[] = [...input.changes];
  for (const event of input.events) {
    if (event.type === 'click') high.push({ from: event.t - rules.clickGuard, to: event.t + rules.clickGuard });
    else if (event.type === 'keys') high.push({ from: event.t, to: event.t + rules.keyWindow });
    else if (event.type === 'move' || event.type === 'scroll') middle.push({ from: event.t - rules.slot / 2, to: event.t + rules.slot / 2 });
  }
  /** Where each scene starts on the output timeline (its first piece; a cut's piece is not a new scene). */
  const sceneStarts = input.spans.filter((span) => !span.cutBefore).map((span) => span.start);
  const levels: Level[] = [];
  for (let k = 0; k * rules.slot < total - 1e-9; k++) {
    const start = k * rules.slot;
    const end = Math.min(total, start + rules.slot);
    const span = input.spans.find((candidate) => candidate.start <= start + 1e-9 && start < candidate.end - 1e-9) ?? input.spans.at(-1)!;
    const scene = span.scene;
    if (scene.type !== 'clip' || sceneStarts.some((at) => start < at + rules.sceneStart - 1e-9 && at <= start + 1e-9)) {
      levels.push(HIGH);
      continue;
    }
    const from = scene.from + (start - span.start) * scene.speed;
    const to = scene.from + (Math.min(end, span.end) - span.start) * scene.speed;
    levels.push(overlaps(high, from, to) ? HIGH : overlaps(middle, from, to) ? MIDDLE : LOW);
  }
  return levels;
}

export interface LengthFit {
  /** The cuts to make, in source seconds, in order. */
  cuts: SourceSpan[];
  /** The video's length with them (output seconds). */
  length: number;
  /** Whether it reaches the target; when not, `length` is the shortest the fit could make. */
  reached: boolean;
}

/**
 * The cuts that bring the video to `target` output seconds: runs of slots at the lowest level
 * first (low, then low and middle), the longest first, each kept `margin` from what stays; the
 * last one only as much as is needed (at least `minCut`), from its middle: the video lands within
 * `close` over the target, or up to `minCut` under it. A run shorter than `minCut` stays. High
 * slots are never cut: when that is not enough, the fit makes the video as short as it can.
 */
export function fitLength(input: ImportanceInput, target: number, rules = LENGTH_RULES): LengthFit {
  const total = input.spans.at(-1)?.end ?? 0;
  const levels = importance(input, rules);
  const cut = new Array<boolean>(levels.length).fill(false);
  /** Output stretches cut, each inside one span. */
  const taken: { span: SceneSpan; from: number; to: number }[] = [];
  let need = total - target;
  for (const level of [LOW, MIDDLE] as const) {
    if (need <= rules.close) break;
    // runs of slots at this level or lower, not cut yet, each inside one span
    const runs: { span: SceneSpan; from: number; to: number }[] = [];
    for (const span of input.spans) {
      if (span.scene.type !== 'clip') continue;
      let open: number | undefined;
      const close = (k: number) => {
        if (open === undefined) return;
        const from = Math.max(span.start, open * rules.slot) + rules.margin;
        const to = Math.min(span.end, k * rules.slot) - rules.margin;
        if (to - from >= rules.minCut - 1e-9) runs.push({ span, from, to });
        open = undefined;
      };
      const first = Math.floor((span.start + 1e-9) / rules.slot);
      const last = Math.ceil((span.end - 1e-9) / rules.slot);
      for (let k = first; k < last; k++) {
        // a slot shared with the span before or after counts for this span only when it lies mostly in it
        const inside = Math.min(span.end, (k + 1) * rules.slot) - Math.max(span.start, k * rules.slot) >= rules.slot / 2 - 1e-9;
        if (inside && !cut[k] && levels[k]! <= level) open ??= k;
        else close(k);
      }
      close(last);
    }
    runs.sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from);
    for (const run of runs) {
      if (need <= rules.close) break;
      const length = run.to - run.from;
      // the whole run, or as much as is needed from its middle (never less than minCut)
      const take = Math.min(length, Math.max(need, rules.minCut));
      const middle = (run.from + run.to) / 2;
      const piece = take >= length - 1e-9 ? run : { span: run.span, from: middle - take / 2, to: middle + take / 2 };
      taken.push(piece);
      for (let k = Math.floor(piece.from / rules.slot); k < Math.ceil(piece.to / rules.slot); k++) cut[k] = true;
      need -= piece.to - piece.from;
    }
  }
  const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
  const cuts = taken
    .map(({ span, from, to }) => {
      const scene = span.scene as Extract<SceneSpan['scene'], { type: 'clip' }>;
      return { from: round(scene.from + (from - span.start) * scene.speed), to: round(scene.from + (to - span.start) * scene.speed) };
    })
    .sort((a, b) => a.from - b.from);
  const removed = taken.reduce((sum, piece) => sum + piece.to - piece.from, 0);
  return { cuts, length: round(total - removed), reached: total - removed <= target + rules.close + 1e-9 };
}
```

In `packages/timeline/src/index.ts`, replace:

```ts
} from './captions';
export { clickZooms, shownClicks, zoomRectFor, type ClickZoom, type ClipSpan } from './click-zooms';
export { TYPING_RULES, clickSamples, keyPresses, mixTyping, typingClicks, type KeyPress, type TypingClick } from './typing';
```

with:

```ts
} from './captions';
export { clickZooms, shownClicks, zoomRectFor, type ClickZoom, type ClipSpan } from './click-zooms';
export { TYPING_RULES, clickSamples, keyPresses, mixTyping, typingClicks, type KeyPress, type TypingClick } from './typing';
export { HIGH, LENGTH_RULES, LOW, MIDDLE, fitLength, importance, type ImportanceInput, type LengthFit, type Level, type SourceSpan } from './importance';
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run --project node packages/timeline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/timeline
git commit -m "timeline: what each moment of the video is worth, and the cuts that fit it to a length

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The fit in a project, and the kept analysis

**Files:**
- Create: `packages/core/src/suggest/length.ts`, `packages/core/test/length.test.ts`
- Modify: `packages/core/src/suggest/media.ts`, `packages/core/src/{suggest,index}.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/length.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseProject, type InputEvent } from '@cuttle/project';
import { runFfmpeg } from '../src/ffmpeg';
import { applyLengthFit, withLengthFit } from '../src/suggest/length';
import { ANALYSIS_DIR } from '../src/suggest/media';

const click = (t: number): InputEvent => ({ t, type: 'click', x: 10, y: 10, button: 'left' });

/** A parsed project and its raw form. */
function project(raw: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, ...raw });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return { raw: { version: 1, sources: { screen: 'takes/1/screen.mp4' }, ...raw }, project: parsed.project };
}

describe('withLengthFit', () => {
  // 20 s: speech from 2 to 5, a click at 15; the screen changes up to 5 and from 12 to 16
  const input = { speech: [{ from: 2, to: 5 }], events: [click(15)], still: [{ from: 5, to: 12 }, { from: 16, to: 20 }], duration: 20 };

  it('cuts where the video rests, tagged and labelled, and keeps the cuts made for something else', () => {
    const { raw, project: shaped } = project({
      scenes: [{ type: 'clip', id: 's1', from: 0, to: 20 }],
      cuts: [
        { id: 'c1', from: 0.4, to: 0.6, auto: 'filler', label: 'Filler: “uh”' },
        { id: 'c2', from: 17, to: 18, auto: 'length', label: 'Fit to 12 s' },
      ],
    });
    const fit = withLengthFit(raw, shaped, input, 14);
    // 19.8 s without the old fit; the run at rest from 5 to 12 gives 5.8 s from its middle
    expect(fit.before).toBeCloseTo(19.8, 6);
    expect(fit).toMatchObject({ target: 14, reached: true, made: 1 });
    expect(fit.length).toBeCloseTo(14, 1);
    expect(fit.cuts.map((cut) => [cut.auto, cut.label])).toEqual([
      ['filler', 'Filler: “uh”'],
      ['length', 'Fit to 14 s'],
    ]);
    const made = fit.cuts[1]!;
    expect(made.from).toBeGreaterThanOrEqual(5);
    expect(made.to).toBeLessThanOrEqual(12);
    expect(fit.notes).toEqual(['cut 5.8 s where the video rests (1 cut) to fit 14 s: 14 s now']);
  });

  it('keeps Claude’s answer and the texts on screen, and says how short it can get', () => {
    const { raw, project: shaped } = project({
      scenes: [{ type: 'clip', id: 's1', from: 0, to: 20 }],
      zooms: [{ id: 'z1', at: 6, duration: 5, rect: [0, 0, 800, 450], auto: 'answer' }],
      texts: [{ id: 't1', at: 17, duration: 2, text: 'Done' }],
    });
    const fit = withLengthFit(raw, shaped, input, 3);
    expect(fit.reached).toBe(false);
    for (const cut of fit.cuts) {
      expect(cut.to <= 6 || cut.from >= 11).toBe(true);
      expect(cut.to <= 17 || cut.from >= 19).toBe(true);
    }
    expect(fit.notes[0]).toMatch(/^shortest without cutting speech, clicks, typing, a zoom or a text: \d+(\.\d)? s \(3 s asked\)$/);
  });
});

describe('applyLengthFit', () => {
  const dirs: string[] = [];
  afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

  it('fits a take, keeps the screen’s analysis in the project, writes nothing when nothing changes, and takes the fit out again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-length-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'takes', '1'), { recursive: true });
    // 12 s of a still screen; clicks at 3 and 9
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=640x360:r=30:d=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(dir, 'takes', '1', 'screen.mp4')]);
    writeFileSync(join(dir, 'takes', '1', 'events.jsonl'), [click(3), click(9)].map((event) => `${JSON.stringify(event)}\n`).join(''));
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', events: 'takes/1/events.jsonl' }, scenes: [{ type: 'clip', id: 's1', from: 0, to: 12 }] }));
    const cuts = () => (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { cuts?: { from: number; to: number; auto?: string }[] }).cuts ?? [];
    const fit = await applyLengthFit(dir, 6);
    expect(fit).toMatchObject({ written: true, target: 6, before: 12, reached: true });
    expect(fit.length).toBeCloseTo(6, 0);
    expect(cuts().every((cut) => cut.auto === 'length')).toBe(true);
    // never near a click
    for (const cut of cuts()) for (const t of [3, 9]) expect(cut.to <= t - 0.3 || cut.from >= t + 0.3).toBe(true);
    // in the project's .cuttle folder, never in the take's (a restart moves it, the take menu deletes it)
    expect(existsSync(join(dir, ANALYSIS_DIR, 'takes_1_screen.mp4.json'))).toBe(true);
    expect(existsSync(join(dir, 'takes', '1', 'analysis.json'))).toBe(false);
    expect((await applyLengthFit(dir, 6)).written).toBe(false);
    // another length replaces it; none takes it out
    expect((await applyLengthFit(dir, 9)).written).toBe(true);
    expect(await applyLengthFit(dir)).toMatchObject({ written: true, length: 12, notes: ['the length fit is taken out'] });
    expect(cuts()).toEqual([]);
  });
});
```

Run: `pnpm exec vitest run --project node packages/core/test/length.test.ts`
Expected: FAIL: `../src/suggest/length` does not exist.

- [ ] **Step 2: The kept analysis, the fit, and `suggest`'s length**

In `packages/core/src/suggest/media.ts`, replace:

```ts
// What suggest needs from the screen track, read with ffmpeg.
import { CoreError } from '../errors';
import { runFfmpeg } from '../ffmpeg';
import type { ScreenBands } from './crop';
```

with:

```ts
// What suggest needs from the screen track, read with ffmpeg.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { CoreError } from '../errors';
import { runFfmpeg } from '../ffmpeg';
import type { ScreenBands } from './crop';
```

In the same file, replace:

```ts
  return parseAnalysis(stderr);
}

/** Reads the log of `analyseScreen`'s ffmpeg run. */
export function parseAnalysis(log: string): ScreenAnalysis {
  const size = /Stream #0:0[^\n]*Video: [^\n]*?(\d{2,5})x(\d{2,5})/.exec(log);
```

with:

```ts
  return parseAnalysis(stderr);
}

/**
 * Where `analyseScreen`'s results are kept, in the project (`.cuttle/analysis/`, beside the app's
 * other caches): never in a take's folder, which a restart moves and the take menu deletes.
 */
export const ANALYSIS_DIR = join('.cuttle', 'analysis');

/**
 * `analyseScreen` of the project's (`projectDir`) screen track `path`, kept in `ANALYSIS_DIR`: read
 * again only when the track changed (its size or its time), so a step after suggest (the length
 * fit) does not decode the take again.
 */
export async function cachedAnalysis(path: string, projectDir: string): Promise<ScreenAnalysis> {
  const name = relative(projectDir, path).split(sep).join('_').replace(/[^\w.-]/g, '_');
  const file = join(projectDir, ANALYSIS_DIR, `${name}.json`);
  const { size, mtimeMs } = await stat(path);
  const kept = JSON.parse(await readFile(file, 'utf8').catch(() => 'null')) as { version?: number; size?: number; mtimeMs?: number; analysis?: ScreenAnalysis } | null;
  if (kept?.version === 1 && kept.size === size && kept.mtimeMs === mtimeMs && Array.isArray(kept.analysis?.still)) return kept.analysis;
  const analysis = await analyseScreen(path);
  // a folder that cannot be written only means the next step reads the take again
  await mkdir(dirname(file), { recursive: true })
    .then(() => writeFile(file, `${JSON.stringify({ version: 1, size, mtimeMs, analysis })}\n`))
    .catch(() => {});
  return analysis;
}

/** Reads the log of `analyseScreen`'s ffmpeg run. */
export function parseAnalysis(log: string): ScreenAnalysis {
  const size = /Stream #0:0[^\n]*Video: [^\n]*?(\d{2,5})x(\d{2,5})/.exec(log);
```

`packages/core/src/suggest/length.ts`:

```ts
// The length fit in a project: the cuts that bring the video to a length (`fitLength` over what
// matters in the take), merged with the cuts there by the tag rules (`auto: "length"`). `suggest
// --length` makes it as part of its run; the app makes it again from its Length control.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEventsJsonl, usedIds, type CuttleProject, type InputEvent } from '@cuttle/project';
import { fitLength, sceneSpans } from '@cuttle/timeline';
import { readProjectFile, writeProjectFile } from '../project-file';
import { speechActivity } from '../speech/apply';
import { mergeCuts, type RawCut } from '../speech/edits';
import { readTranscript } from '../speech/transcribe';
import { cachedAnalysis } from './media';
import { gaps, type Span } from './spans';

/** What the take holds, in source seconds. */
export interface LengthInput {
  /** Where someone speaks. */
  speech: readonly Span[];
  events: readonly InputEvent[];
  /** Where the screen did not change, and the take's length. */
  still: readonly Span[];
  duration: number;
}

export interface LengthFitResult {
  /** Every cut afterwards. */
  cuts: RawCut[];
  /** The asked length, the length before and after (output seconds), and whether it fits. */
  target: number;
  before: number;
  length: number;
  reached: boolean;
  /** How many cuts the fit made. */
  made: number;
  notes: string[];
}

const ms = (seconds: number) => Math.round(seconds * 10) / 10;

/**
 * The project's cuts with a length fit to `target` output seconds: the fit's cuts from before
 * (`auto: "length"`) go, the others stay and are counted; what must stay besides speech, clicks and
 * typing is every zoom (made by hand or by Cuttle: it shows what matters, Claude's answer too) and
 * every text on screen.
 */
export function withLengthFit(raw: Record<string, unknown>, project: CuttleProject, input: LengthInput, target: number, taken = usedIds(raw)): LengthFitResult {
  const others = project.cuts.filter((cut) => cut.auto !== 'length');
  const spans = sceneSpans(project.scenes, others);
  const before = spans.at(-1)?.end ?? 0;
  const keep = [
    ...project.zooms.filter((zoom) => zoom.enabled).map((zoom) => ({ from: zoom.at, to: zoom.at + zoom.duration })),
    ...project.texts.filter((text) => text.enabled).map((text) => ({ from: text.at, to: text.at + text.duration })),
  ];
  const fit = fitLength({ spans, speech: input.speech, events: input.events, changes: gaps(input.still, 0, input.duration), keep }, target);
  const label = `Fit to ${ms(target)} s`;
  const merged = mergeCuts((raw.cuts as RawCut[] | undefined) ?? [], fit.cuts.map((cut) => ({ ...cut, auto: 'length', label })), ['length'], taken);
  const notes: string[] = [];
  if (fit.cuts.length === 0 && fit.reached) notes.push(`the video is ${ms(before)} s: it fits ${ms(target)} s, nothing cut to fit`);
  else if (fit.reached) notes.push(`cut ${ms(before - fit.length)} s where the video rests (${fit.cuts.length} cut${fit.cuts.length === 1 ? '' : 's'}) to fit ${ms(target)} s: ${ms(fit.length)} s now`);
  else notes.push(`shortest without cutting speech, clicks, typing, a zoom or a text: ${ms(fit.length)} s (${ms(target)} s asked)`);
  return { cuts: merged.cuts, target, before, length: fit.length, reached: fit.reached, made: fit.cuts.length, notes };
}

/** The project's cuts without the length fit's. */
export function withoutLengthFit(raw: Record<string, unknown>): RawCut[] {
  return mergeCuts((raw.cuts as RawCut[] | undefined) ?? [], [], ['length'], usedIds(raw)).cuts;
}

export interface LengthApplied extends Omit<LengthFitResult, 'cuts'> {
  /** Whether cuttle.json was written (nothing changed: not written). */
  written: boolean;
}

/**
 * Fits the project (`dir`: its folder) to `target` output seconds, or takes the fit out (no
 * target), and writes it when something changed. The screen's analysis is the one suggest kept
 * in the project (read again only when the take changed).
 */
export async function applyLengthFit(dir: string, target?: number): Promise<LengthApplied> {
  const file = await readProjectFile(dir);
  const { sources } = file.project;
  const old = JSON.stringify((file.raw.cuts as unknown[] | undefined) ?? []);
  let result: LengthFitResult;
  if (target === undefined) {
    const cuts = withoutLengthFit(file.raw);
    const length = sceneSpans(file.project.scenes, file.project.cuts.filter((cut) => cut.auto !== 'length')).at(-1)?.end ?? 0;
    result = { cuts, target: length, before: length, length, reached: true, made: 0, notes: ['the length fit is taken out'] };
  } else {
    const analysis = await cachedAnalysis(resolve(file.dir, sources.screen), file.dir);
    const { transcript } = await readTranscript(file.dir, sources.transcript);
    const speech = await speechActivity(file.dir, sources, transcript);
    const text = sources.events ? await readFile(resolve(file.dir, sources.events), 'utf8').catch(() => undefined) : undefined;
    const events = text === undefined ? [] : parseEventsJsonl(text).events;
    result = withLengthFit(file.raw, file.project, { speech: speech.spans, events, still: analysis.still, duration: analysis.duration }, target);
  }
  const { cuts, ...rest } = result;
  if (JSON.stringify(cuts) === old) return { ...rest, written: false };
  file.raw.cuts = cuts;
  await writeProjectFile(file, 'the length fit');
  return { ...rest, written: true };
}
```

In `packages/core/src/suggest.ts`, replace:

```ts
import { dialogZooms } from './suggest/dialogs';
import { readScreenText, withPrivacyMasks, type RawMask } from './privacy/apply';
import { SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
import { analyseScreen, grabGray, grayFrames, screenBands } from './suggest/media';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { union } from './suggest/spans';
```

with:

```ts
import { dialogZooms } from './suggest/dialogs';
import { readScreenText, withPrivacyMasks, type RawMask } from './privacy/apply';
import { SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
import { cachedAnalysis, grabGray, grayFrames, screenBands } from './suggest/media';
import { withLengthFit } from './suggest/length';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { union } from './suggest/spans';
```

In the same file, replace:

```ts
  speech?: boolean;
  /** Transcribe the mic first when it has no transcript and a speech model is downloaded (default true). */
  transcribe?: boolean;
  /** Status for people while it runs. */
  onStatus?: (text: string) => void;
  /** The transcription's progress, 0 to 1. */
```

with:

```ts
  speech?: boolean;
  /** Transcribe the mic first when it has no transcript and a speech model is downloaded (default true). */
  transcribe?: boolean;
  /** Fit the video to this many seconds: what rests is cut, never speech, clicks or typing. */
  length?: number;
  /** Status for people while it runs. */
  onStatus?: (text: string) => void;
  /** The transcription's progress, 0 to 1. */
```

In the same file, replace:

```ts
  speech: { from: 'transcript' | 'mic' | 'none'; fillers: number; pauses: number; retakes: number };
  /** Whether the screen's text was there to mask from, and how many privacy and notification masks were made. */
  privacy: { read: boolean; masks: number; notifications: number };
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
```

with:

```ts
  speech: { from: 'transcript' | 'mic' | 'none'; fillers: number; pauses: number; retakes: number };
  /** Whether the screen's text was there to mask from, and how many privacy and notification masks were made. */
  privacy: { read: boolean; masks: number; notifications: number };
  /** With `length`: the asked length, the video's length before and after the fit, and whether it fits. */
  length?: { target: number; before: number; length: number; reached: boolean };
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
```

In the same file, replace:

```ts
  const { sources } = file.project;
  const screen = resolve(file.dir, sources.screen);
  args.onStatus?.('reading the screen recording …');
  const screenInfo = await analyseScreen(screen);
  if (screenInfo.duration <= 0) throw new CoreError('invalid-media', `${screen} has no video frames`);
  let transcript: TranscriptFile | undefined;
  let speech: { spans: { from: number; to: number }[]; from: SuggestResult['speech']['from'] } = { spans: [], from: 'none' };
```

with:

```ts
  const { sources } = file.project;
  const screen = resolve(file.dir, sources.screen);
  args.onStatus?.('reading the screen recording …');
  // kept in the project, for the steps after suggest (the app's length fit)
  const screenInfo = await cachedAnalysis(screen, file.dir);
  if (screenInfo.duration <= 0) throw new CoreError('invalid-media', `${screen} has no video frames`);
  let transcript: TranscriptFile | undefined;
  let speech: { spans: { from: number; to: number }[]; from: SuggestResult['speech']['from'] } = { spans: [], from: 'none' };
```

In the same file, replace:

```ts
  }

  const allZooms = [...kept, ...zooms].sort((a, b) => a.at - b.at);
  let backup: string | undefined;
  if (!args.dryRun) {
    file.raw.scenes = scenes;
```

with:

```ts
  }

  const allZooms = [...kept, ...zooms].sort((a, b) => a.at - b.at);
  // The length fit, last: what rests goes until the video fits, around the cuts and zooms made above.
  let length: SuggestResult['length'];
  if (args.length !== undefined) {
    const shaped = parseProject({ ...file.raw, scenes, ...(cuts && { cuts }), zooms: allZooms });
    if (shaped.ok) {
      const fit = withLengthFit({ ...file.raw, ...(cuts && { cuts }) }, shaped.project, { speech: speech.spans, events, still: screenInfo.still, duration: screenInfo.duration }, args.length, taken);
      notes.push(...fit.notes);
      cuts = fit.cuts;
      length = { target: fit.target, before: fit.before, length: fit.length, reached: fit.reached };
    }
  }
  let backup: string | undefined;
  if (!args.dryRun) {
    file.raw.scenes = scenes;
```

In the same file, replace:

```ts
    ...(cuts && { cuts }),
    speech: { from: speech.from, ...made },
    privacy,
    notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
```

with:

```ts
    ...(cuts && { cuts }),
    speech: { from: speech.from, ...made },
    privacy,
    ...(length && { length }),
    notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
```

In `packages/core/src/index.ts`, replace:

```ts
export { suggestProject, type SuggestOptions, type SuggestResult } from './suggest';
export { recoverTake, type RecoverResult } from './recover';
export { GRID_STEP, grabFrame, gridFilter, type FrameOptions, type FrameResult } from './frame';
export { analyseScreen, grabGray, parseAnalysis, probeScreen, streamSeconds, type Gray, type ScreenAnalysis } from './suggest/media';
export { RULES, suggestClips, type SuggestInput, type SuggestedClip, type Suggestion } from './suggest/plan';
export { changedRegion, zoomRect } from './suggest/region';
export { gaps, length, union, type Span } from './suggest/spans';
```

with:

```ts
export { suggestProject, type SuggestOptions, type SuggestResult } from './suggest';
export { recoverTake, type RecoverResult } from './recover';
export { GRID_STEP, grabFrame, gridFilter, type FrameOptions, type FrameResult } from './frame';
export { ANALYSIS_DIR, analyseScreen, cachedAnalysis, grabGray, parseAnalysis, probeScreen, streamSeconds, type Gray, type ScreenAnalysis } from './suggest/media';
export { applyLengthFit, withLengthFit, withoutLengthFit, type LengthApplied, type LengthFitResult, type LengthInput } from './suggest/length';
export { RULES, suggestClips, type SuggestInput, type SuggestedClip, type Suggestion } from './suggest/plan';
export { changedRegion, zoomRect } from './suggest/region';
export { gaps, length, union, type Span } from './suggest/spans';
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/core`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core
git commit -m "core: the length fit in a project, suggest's length, and the screen's analysis kept in the project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The CLI

**Files:**
- Create: `apps/cli/src/commands/fit.ts`
- Modify: `apps/cli/src/main.ts`, `apps/cli/test/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/cli/test/cli.test.ts`, replace:

```ts
  }, 120_000);
});

describe('cuttle suggest masks notifications', () => {
  it('masks a notification while it was open, and a rerun leaves the mask as it is', async () => {
    const dir = temp();
```

with:

```ts
  }, 120_000);
});

describe('cuttle suggest --length', () => {
  it('cuts where the video rests to fit, keeps the answer, says how short it can get, and keeps the analysis for the app', async () => {
    const dir = temp();
    takeFixture(dir);
    const fit = (await cli('--json', '-C', dir, 'suggest', '--no-crop', '--no-privacy', '--length', '6')).json as { length: { target: number; before: number; length: number; reached: boolean }; notes: string[] };
    // about 10.4 s of video; the waiting (sped up 3×) changes on screen and goes first; the
    // typing, the answer and each scene's first second stay, so 6 s is out of reach
    expect(fit.length).toMatchObject({ target: 6, reached: false });
    expect(fit.length.length).toBeLessThan(fit.length.before - 1);
    expect(fit.notes.at(-1)).toMatch(/^shortest without cutting speech, clicks, typing, a zoom or a text: [\d.]+ s \(6 s asked\)$/);
    const file = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { cuts: { from: number; to: number; auto?: string; label?: string }[]; zooms: { at: number; duration: number; auto?: string }[] };
    const cuts = file.cuts.filter((cut) => cut.auto === 'length');
    expect(cuts.length).toBeGreaterThan(0);
    expect(cuts.every((cut) => cut.label === 'Fit to 6 s')).toBe(true);
    const answer = file.zooms.find((zoom) => zoom.auto === 'answer')!;
    for (const cut of cuts) expect(cut.to <= answer.at || cut.from >= answer.at + answer.duration).toBe(true);
    // the screen's analysis, kept in the project for the app's Length control
    expect(existsSync(join(dir, '.cuttle', 'analysis', 'takes_1_screen.mp4.json'))).toBe(true);
    expect((await cli('--json', '-C', dir, 'suggest', '--length', '0')).json).toMatchObject({ error: { code: 'usage' } });
  });

  it('fits after the edits with cuttle fit, takes the fit out with --off, and asks for a length', async () => {
    const dir = temp();
    takeFixture(dir);
    await cli('--json', '-C', dir, 'suggest', '--no-crop', '--no-privacy');
    type Fit = { written: boolean; target: number; before: number; length: number; reached: boolean; notes: string[] };
    const fit = (await cli('--json', '-C', dir, 'fit', '9')).json as Fit;
    expect(fit).toMatchObject({ written: true, target: 9, reached: true });
    expect(fit.length).toBeLessThanOrEqual(9.125);
    expect(fit.notes[0]).toMatch(/^cut [\d.]+ s where the video rests \(\d+ cuts?\) to fit 9 s: [\d.]+ s now$/);
    const lengthCuts = () => (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { cuts?: { auto?: string }[] }).cuts?.filter((cut) => cut.auto === 'length') ?? [];
    expect(lengthCuts().length).toBeGreaterThan(0);
    // the same again: nothing to write
    expect(((await cli('--json', '-C', dir, 'fit', '9')).json as Fit).written).toBe(false);
    const off = (await cli('--json', '-C', dir, 'fit', '--off')).json as Fit;
    expect(off).toMatchObject({ written: true, notes: ['the length fit is taken out'] });
    expect(off.length).toBeCloseTo(fit.before, 3);
    expect(lengthCuts()).toEqual([]);
    const none = await cli('--json', '-C', dir, 'fit');
    expect(none.code).toBe(1);
    expect(none.json).toMatchObject({ error: { code: 'usage' } });
  });
});

describe('cuttle suggest masks notifications', () => {
  it('masks a notification while it was open, and a rerun leaves the mask as it is', async () => {
    const dir = temp();
```

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts -t "length|fits after"`
Expected: FAIL: `suggest` has no `--length`, and there is no `fit` command.

- [ ] **Step 2: `--length` and `cuttle fit`**

`apps/cli/src/commands/fit.ts`:

```ts
import { applyLengthFit, CoreError, type LengthApplied } from '@cuttle/core';
import type { Output } from '../output';

/**
 * `cuttle fit <seconds>`: fits the video to a length where it rests, after the hand edits (see
 * @cuttle/core's applyLengthFit); `--off` takes the fit out.
 */
export async function fitCommand(projectDir: string, seconds: number | undefined, off: boolean, output: Output): Promise<LengthApplied> {
  if (seconds === undefined && !off) throw new CoreError('usage', 'give the length in seconds (cuttle fit 45), or --off to take the fit out');
  if (seconds !== undefined && off) throw new CoreError('usage', 'give a length or --off, not both');
  const result = await applyLengthFit(projectDir, off ? undefined : seconds);
  output.result(result, () =>
    [
      ...result.notes.map((note) => `- ${note}`),
      result.written ? `written: ${result.length.toFixed(1)} s of video` : 'cuttle.json unchanged',
      'next: cuttle preview',
    ].join('\n'),
  );
  return result;
}
```

In `apps/cli/src/main.ts`, replace:

```ts
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { capturePageCommand } from './commands/capture-page';
import { devices } from './commands/devices';
import { frameCommand } from './commands/frame';
import { init } from './commands/init';
import { previewCommand } from './commands/preview';
```

with:

```ts
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { capturePageCommand } from './commands/capture-page';
import { devices } from './commands/devices';
import { fitCommand } from './commands/fit';
import { frameCommand } from './commands/frame';
import { init } from './commands/init';
import { previewCommand } from './commands/preview';
```

In the same file, replace:

```ts
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-speech', 'leave the speech out: no filler, pause or spoken retake cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, { mask, ...options }: { claude?: string | true; zoom: boolean; crop: boolean; privacy: boolean; mask: string[]; dialogZooms: boolean; typingZooms: boolean; clickZooms: boolean; speech: boolean; transcribe: boolean; dryRun?: boolean }) =>
        suggestCommand(project, { ...options, ...(mask.length > 0 && { maskWords: mask }) }, output),
      ),
    );
```

with:

```ts
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-speech', 'leave the speech out: no filler, pause or spoken retake cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--length <seconds>', 'fit the video to this length: what rests is cut, never speech, clicks or typing', positive)
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, { mask, ...options }: { claude?: string | true; zoom: boolean; crop: boolean; privacy: boolean; mask: string[]; dialogZooms: boolean; typingZooms: boolean; clickZooms: boolean; speech: boolean; transcribe: boolean; length?: number; dryRun?: boolean }) =>
        suggestCommand(project, { ...options, ...(mask.length > 0 && { maskWords: mask }) }, output),
      ),
    );
```

In the same file, replace:

```ts
      ),
    );

  program
    .command('frame')
    .description('a frame of the screen track at full size (the pixels masks and zooms use), optionally with a numbered grid')
```

with:

```ts
      ),
    );

  program
    .command('fit')
    .description('fit the video to a length after your edits: cut where it rests, never speech, clicks, typing, a zoom or a text (cuts tagged "length"; a new fit replaces them)')
    .argument('[seconds]', 'the length in seconds', positive)
    .option('--off', 'take the fit out: the full length again')
    .action(action((output, project, length: number | undefined, options: { off?: boolean }) => fitCommand(project, length, options.off === true, output)));

  program
    .command('frame')
    .description('a frame of the screen track at full size (the pixels masks and zooms use), optionally with a numbered grid')
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cli
git commit -m "cli: suggest --length, and cuttle fit after the edits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Length menu in the app

**Files:**
- Create: `apps/desktop/src/main/length.ts`
- Modify: `apps/desktop/src/shared/{media-jobs,ipc,channels}.ts`, `apps/desktop/src/workers/media.ts`, `apps/desktop/src/main/{media-service,windows}.ts`, `apps/desktop/src/renderer/editor/{Timeline.tsx,doc.ts,editor.css}`, `apps/desktop/test/{app.check.test,fixture}.ts`

- [ ] **Step 1: The check**

The demo fits 15 s as it is (nothing changes, and the bar says so). A take that mostly rests (20 s, clicks at 3 and 15 s) is fitted to 5 s with the field: cuts away from the clicks, one step, the toast, the bar's "fitted", the Auto tab's rows; "Full length" takes it out.

In `apps/desktop/test/fixture.ts`, replace:

```ts
  writeFileSync(join(dir, 'cuttle.json'), `${JSON.stringify(project, null, 2)}\n`);
}

export function makeFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
```

with:

```ts
  writeFileSync(join(dir, 'cuttle.json'), `${JSON.stringify(project, null, 2)}\n`);
}

/**
 * A take that mostly rests: 20 s of a still screen, clicks at 3 and 15 s, no mic. One clip over
 * the whole take; the length fit has plenty to cut.
 */
export function makeRestingFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=1280x720:r=30:d=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(take, 'screen.mp4')]);
  const click = (t: number) => ({ t, type: 'click', x: 640, y: 360, button: 'left' });
  writeFileSync(join(take, 'events.jsonl'), [click(3), click(15)].map((event) => `${JSON.stringify(event)}\n`).join(''));
  writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 100 } } }));
  const project = { version: 1, output: FIXTURE_OUTPUT, sources: { screen: 'takes/1/screen.mp4', events: 'takes/1/events.jsonl' }, scenes: [{ type: 'clip', id: 's1', from: 0, to: 20 }] };
  writeFileSync(join(dir, 'cuttle.json'), `${JSON.stringify(project, null, 2)}\n`);
}

export function makeFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
```

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
import { whisperCliPath } from '@cuttle/core';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OUTPUT, makeFixture, makePrivateFixture, makeSpokenFixture } from './fixture';

/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
```

with:

```ts
import { whisperCliPath } from '@cuttle/core';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OUTPUT, makeFixture, makePrivateFixture, makeRestingFixture, makeSpokenFixture } from './fixture';

/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
```

In the same file, replace:

```ts
  }, 180_000);

  // the system's own OCR: Windows', macOS's Vision
  it.runIf(process.platform === 'win32' || process.platform === 'darwin')('reads the screen after a take when the settings say so, and from the Auto tab: what it shows that is private and the notifications masked as one step', async () => {
    // the settings: reading is off in this check; switched on, each new take is read after its cut
    await launchAgain(['--settings']);
```

with:

```ts
  }, 180_000);

  // the system's own OCR: Windows', macOS's Vision
  it('fits a video to a length from the timeline bar: cut where it rests, never near a click, one step, listed in the Auto tab, and back to the full length', async () => {
    // the demo (10.1 s) fits 15 s as it is: nothing changes, and the bar says so
    await chooseIn(editor, '[data-testid=length]', '15 s');
    // (the first fit reads the take's screen: its analysis is kept for the next)
    await expect.poll(async () => (await doc()).toast?.text, { timeout: 30_000 }).toBe('The video is 10.1 s: it fits 15 s.');
    expect(((JSON.parse(readFileSync(projectFile(), 'utf8')) as { cuts?: { auto?: string }[] }).cuts ?? []).some((cut) => cut.auto === 'length')).toBe(false);

    // a take that mostly rests: 20 s of a still screen, clicks at 3 and 15 s
    const dir = join(root, 'resting');
    makeRestingFixture(dir);
    const page = await openEditor(dir);
    const pageDoc = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.doc());
    const pageState = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state());
    const lengthCuts = () => ((JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { cuts?: { from: number; to: number; auto?: string; label?: string }[] }).cuts ?? []).filter((cut) => cut.auto === 'length');
    // an other length, typed
    await chooseIn(page, '[data-testid=length]', 'Other length…');
    await page.fill('[data-testid=length-input]', '5');
    await page.press('[data-testid=length-input]', 'Enter');
    await expect.poll(() => lengthCuts().length, { timeout: 30_000 }).toBeGreaterThan(0);
    for (const cut of lengthCuts()) {
      expect(cut.label).toBe('Fit to 5 s');
      for (const t of [3, 15]) expect(cut.to <= t - 0.3 || cut.from >= t + 0.3).toBe(true);
    }
    await expect.poll(async () => (await pageDoc()).undo).toBe("Cuttle's length fit");
    await expect.poll(async () => (await pageState()).duration).toBeLessThan(5.2);
    expect((await pageState()).duration).toBeGreaterThan(4.3);
    expect((await pageDoc()).toast?.text).toMatch(/^Cuttle cut where the video rests to fit 5 s: [\d.]+ s now\.$/);
    await page.waitForSelector('[data-testid=length] .length-fitted');
    // the Auto tab lists the fit's cuts
    await click(page, '#tab-auto');
    await page.waitForSelector('[data-testid=auto-group-length]');
    await click(page, '[data-testid=auto-group-length] .auto-toggle');
    await shotOf('36-length-fit', '/editor.html', 'resting · Cuttle');
    // the full length again, also one step
    await chooseIn(page, '[data-testid=length]', 'Full length');
    await expect.poll(() => lengthCuts().length, { timeout: 30_000 }).toBe(0);
    await expect.poll(async () => (await pageState()).duration).toBeCloseTo(20, 1);
    await expect.poll(async () => (await pageDoc()).toast?.text).toBe('Cuttle took the length fit out: the video is 20 s again.');
    await page.waitForSelector('[data-testid=length] .length-fitted', { state: 'detached' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'resting · Cuttle')?.close());
  }, 120_000);

  it.runIf(process.platform === 'win32' || process.platform === 'darwin')('reads the screen after a take when the settings say so, and from the Auto tab: what it shows that is private and the notifications masked as one step', async () => {
    // the settings: reading is off in this check; switched on, each new take is read after its cut
    await launchAgain(['--settings']);
```

- [ ] **Step 2: The job, its report and the step**

In `apps/desktop/src/shared/media-jobs.ts`, replace:

```ts
  words: string[];
}

export type MediaJob = ProxyJob | ThumbnailsJob | PeaksJob | SuggestJob | TranscribeJob | SpeechEditsJob | ReadScreenJob | PrivacyEditsJob;

export interface ThumbnailsMeta {
  interval: number;
```

with:

```ts
  words: string[];
}

/** Fits a project (`input`: its folder) to `seconds` of video where it rests, or takes the fit out (none). */
export interface FitLengthJob {
  job: 'fit-length';
  input: string;
  output: string;
  seconds?: number;
}

/** What a length fit did, in output seconds: the length asked for, the video's length before and after, whether it fits. */
export interface LengthReport {
  target: number;
  before: number;
  length: number;
  reached: boolean;
  /** Whether cuttle.json changed (it already fitted, or the fit was the same: not). */
  written: boolean;
}

export type MediaJob = ProxyJob | ThumbnailsJob | PeaksJob | SuggestJob | TranscribeJob | SpeechEditsJob | ReadScreenJob | PrivacyEditsJob | FitLengthJob;

/** What a job answers besides being done: the thumbnails' layout, or a length fit's report. */
export type JobResult = ThumbnailsMeta | LengthReport;

export interface ThumbnailsMeta {
  interval: number;
```

In the same file, replace:

```ts
export type WorkerCancel = { id: number; cancel: true };
export type WorkerReply =
  | { id: number; progress: number }
  | { id: number; done: true; meta?: ThumbnailsMeta }
  | { id: number; error: string; cancelled?: boolean; code?: string };

/** Height of the proxy (the screen track is scaled down to it, never up). */
```

with:

```ts
export type WorkerCancel = { id: number; cancel: true };
export type WorkerReply =
  | { id: number; progress: number }
  | { id: number; done: true; meta?: JobResult }
  | { id: number; error: string; cancelled?: boolean; code?: string };

/** Height of the proxy (the screen track is scaled down to it, never up). */
```

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
// what a window may send. The main process checks each request against it; the preloads expose only
// their window's channels.
import { z } from 'zod';
import type { PickedTarget, PickerDisplay, PickerWindow, RecordChoices } from './recording';

export type { PickedTarget, PickerDisplay, PickerWindow, Rect, RecordChoices } from './recording';
```

with:

```ts
// what a window may send. The main process checks each request against it; the preloads expose only
// their window's channels.
import { z } from 'zod';
import type { LengthReport } from './media-jobs';
import type { PickedTarget, PickerDisplay, PickerWindow, RecordChoices } from './recording';

export type { PickedTarget, PickerDisplay, PickerWindow, Rect, RecordChoices } from './recording';
```

In the same file, replace:

```ts
  'speech:remove': z.enum(SPEECH_MODEL_NAMES),
  /** Reads the screen's text of the project's take again and masks what it showed (the Auto tab, Try again). */
  'project:read-screen': z.undefined(),
} as const;

export type Request = keyof typeof REQUESTS;
```

with:

```ts
  'speech:remove': z.enum(SPEECH_MODEL_NAMES),
  /** Reads the screen's text of the project's take again and masks what it showed (the Auto tab, Try again). */
  'project:read-screen': z.undefined(),
  /** Fits the video to this many seconds where it rests, or takes the fit out (null). */
  'project:fit-length': z.strictObject({ seconds: z.number().positive().max(36_000).nullable() }),
} as const;

export type Request = keyof typeof REQUESTS;
```

In the same file, replace:

```ts
  'speech:remove': SpeechStatus;
  /** Started (the title bar shows it), or why not. */
  'project:read-screen': { started: true } | { problem: string };
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
```

with:

```ts
  'speech:remove': SpeechStatus;
  /** Started (the title bar shows it), or why not. */
  'project:read-screen': { started: true } | { problem: string };
  /** What the fit did, once it is done, or why it could not. */
  'project:fit-length': { report: LengthReport } | { problem: string };
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
```

In the same file, replace:

```ts
 */
export type ProjectFileEvent = (ProjectVersion & { origin: ChangeOrigin }) | { issues: string[] };

/** Who changed cuttle.json outside the editor: another program, or the app's own cut, speech edits or privacy masks. */
export type ChangeOrigin = 'outside' | 'suggest' | 'speech' | 'privacy';

/** Events (main → window). */
export interface Events {
```

with:

```ts
 */
export type ProjectFileEvent = (ProjectVersion & { origin: ChangeOrigin }) | { issues: string[] };

/** Who changed cuttle.json outside the editor: another program, or the app's own cut, speech edits, privacy masks or length fit. */
export type ChangeOrigin = 'outside' | 'suggest' | 'speech' | 'privacy' | 'length';

/** Events (main → window). */
export interface Events {
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
      'project:cut',
      'project:transcribe',
      'project:read-screen',
      'project:save',
      'project:import-image',
      'project:draft',
```

with:

```ts
      'project:cut',
      'project:transcribe',
      'project:read-screen',
      'project:fit-length',
      'project:save',
      'project:import-image',
      'project:draft',
```

In `apps/desktop/src/workers/media.ts`, replace:

```ts
// the main process queues them.
import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { applyPrivacy, applySpeechEdits, ffmpegPath, probeScreen, readScreenTake, streamSeconds, suggestProject, transcribeTake } from '@cuttle/core';
import {
  PEAKS_SAMPLE_RATE,
  PeakFolder,
```

with:

```ts
// the main process queues them.
import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { applyLengthFit, applyPrivacy, applySpeechEdits, ffmpegPath, probeScreen, readScreenTake, streamSeconds, suggestProject, transcribeTake } from '@cuttle/core';
import {
  PEAKS_SAMPLE_RATE,
  PeakFolder,
```

In the same file, replace:

```ts
  proxyArgs,
  thumbnailsArgs,
  thumbnailsMeta,
  type MediaJob,
  type ThumbnailsMeta,
  type WorkerCancel,
  type WorkerReply,
  type WorkerRequest,
```

with:

```ts
  proxyArgs,
  thumbnailsArgs,
  thumbnailsMeta,
  type JobResult,
  type MediaJob,
  type WorkerCancel,
  type WorkerReply,
  type WorkerRequest,
```

In the same file, replace:

```ts
  }
}

async function run(id: number, job: MediaJob): Promise<ThumbnailsMeta | undefined> {
  switch (job.job) {
    case 'proxy': {
      const { duration } = await probeScreen(job.input);
```

with:

```ts
  }
}

async function run(id: number, job: MediaJob): Promise<JobResult | undefined> {
  switch (job.job) {
    case 'proxy': {
      const { duration } = await probeScreen(job.input);
```

In the same file, replace:

```ts
      await applyPrivacy(job.input, { ...(job.link && { link: job.link }), words: job.words });
      return undefined;
    }
    case 'peaks': {
      const seconds = await streamSeconds(job.input, 'a');
      const folder = new PeakFolder();
```

with:

```ts
      await applyPrivacy(job.input, { ...(job.link && { link: job.link }), words: job.words });
      return undefined;
    }
    case 'fit-length': {
      const fit = await applyLengthFit(job.input, job.seconds);
      return { target: fit.target, before: fit.before, length: fit.length, reached: fit.reached, written: fit.written };
    }
    case 'peaks': {
      const seconds = await streamSeconds(job.input, 'a');
      const folder = new PeakFolder();
```

In `apps/desktop/src/main/media-service.ts`, replace:

```ts
import { utilityProcess, type UtilityProcess } from 'electron';
import type { CuttleProject } from '@cuttle/project';
import type { MediaState } from '../shared/ipc';
import type { MediaJob, ThumbnailsMeta, WorkerReply } from '../shared/media-jobs';
import { PEAKS_RATE } from '../shared/media-jobs';
import { CACHE_DIR } from './project';
import { bundlePath } from './protocols';
```

with:

```ts
import { utilityProcess, type UtilityProcess } from 'electron';
import type { CuttleProject } from '@cuttle/project';
import type { MediaState } from '../shared/ipc';
import type { JobResult, MediaJob, ThumbnailsMeta, WorkerReply } from '../shared/media-jobs';
import { PEAKS_RATE } from '../shared/media-jobs';
import { CACHE_DIR } from './project';
import { bundlePath } from './protocols';
```

In the same file, replace:

```ts
interface Job {
  job: MediaJob;
  onProgress: (progress: number) => void;
  resolve: (meta?: ThumbnailsMeta) => void;
  reject: (error: Error) => void;
}
```

with:

```ts
interface Job {
  job: MediaJob;
  onProgress: (progress: number) => void;
  resolve: (meta?: JobResult) => void;
  reject: (error: Error) => void;
}
```

In the same file, replace:

```ts
    this.start().postMessage({ id: next.id, ...next.job.job });
  }

  run(media: MediaJob, onProgress: (progress: number) => void): { promise: Promise<ThumbnailsMeta | undefined>; cancel(): void } {
    const id = this.next++;
    const promise = new Promise<ThumbnailsMeta | undefined>((resolve, reject) => {
      const job = { job: media, onProgress, resolve, reject };
      this.pending.set(id, job);
      this.queue.push({ id, job });
    });
```

with:

```ts
    this.start().postMessage({ id: next.id, ...next.job.job });
  }

  /** Queues a job; `T`: what it answers (the thumbnails' layout, a length fit's report). */
  run<T extends JobResult = ThumbnailsMeta>(media: MediaJob, onProgress: (progress: number) => void): { promise: Promise<T | undefined>; cancel(): void } {
    const id = this.next++;
    const promise = new Promise<T | undefined>((resolve, reject) => {
      const job = { job: media, onProgress, resolve: resolve as (meta?: JobResult) => void, reject };
      this.pending.set(id, job);
      this.queue.push({ id, job });
    });
```

`apps/desktop/src/main/length.ts`:

```ts
// The length fit in the app: the editor's Length control asks for a length, the media worker cuts
// where the video rests (or takes the fit out), and the change arrives as one step to undo
// ("Cuttle's length fit"). The control waits for the answer: it says whether the video fits.
import { readProjectFile } from '@cuttle/core';
import type { LengthReport } from '../shared/media-jobs';
import { mediaWorker } from './media-service';
import { expectLength, setEditorStatus } from './windows';

/** Projects being fitted now (their folders, as given). */
const fitting = new Set<string>();

/** The SHA-256 of cuttle.json as it is now (undefined: it cannot be read). */
const hashOf = async (dir: string) => (await readProjectFile(dir).catch(() => undefined))?.hash;

/** Fits the project to `seconds` of video, or takes the fit out (`null`); the report, or why it could not. */
export async function fitProjectLength(dir: string, seconds: number | null): Promise<{ report: LengthReport } | { problem: string }> {
  if (fitting.has(dir)) return { problem: 'The video is being fitted already.' };
  fitting.add(dir);
  try {
    await setEditorStatus(dir, { text: seconds === null ? 'Taking the fit out…' : `Fitting the video to ${seconds} s…`, state: 'working' });
    const before = await hashOf(dir);
    await expectLength(dir, true);
    let report: LengthReport | undefined;
    try {
      report = await mediaWorker.run<LengthReport>({ job: 'fit-length', input: dir, output: '', ...(seconds !== null && { seconds }) }, () => {}).promise;
    } finally {
      // nothing was written (it fitted already, or it failed): the next outside change is someone else's
      if ((await hashOf(dir)) === before) await expectLength(dir, false);
    }
    if (!report) throw new Error('the media worker gave no answer');
    return { report };
  } catch (error) {
    return { problem: `The video could not be fitted: ${(error as Error).message.split('\n')[0]}` };
  } finally {
    await setEditorStatus(dir, undefined);
    fitting.delete(dir);
  }
}
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
import { deletableTakes, sizeText, trashName } from '../shared/takes';
import { addRecent, loadSettings, motionSetting, updateSettings } from './settings';
import { openSettings } from './settings-window';
import { maskPrivacy } from './privacy';
import { transcribeProject } from './speech';
```

with:

```ts
import { deletableTakes, sizeText, trashName } from '../shared/takes';
import { addRecent, loadSettings, motionSetting, updateSettings } from './settings';
import { openSettings } from './settings-window';
import { fitProjectLength } from './length';
import { maskPrivacy } from './privacy';
import { transcribeProject } from './speech';
```

In the same file, replace:

```ts
    'project:cut': () => void recut(dir),
    'project:transcribe': () => transcribeProject(dir, true),
    'project:read-screen': () => maskPrivacy(dir, true),
    'project:undo-restart': (discarded) => void undoRestart(dir, discarded),
    'app:settings': (page) => void openSettings({ page }),
    'project:save': ({ raw, base }) => editor.watch.save(raw, base),
```

with:

```ts
    'project:cut': () => void recut(dir),
    'project:transcribe': () => transcribeProject(dir, true),
    'project:read-screen': () => maskPrivacy(dir, true),
    'project:fit-length': ({ seconds }) => fitProjectLength(dir, seconds),
    'project:undo-restart': (discarded) => void undoRestart(dir, discarded),
    'app:settings': (page) => void openSettings({ page }),
    'project:save': ({ raw, base }) => editor.watch.save(raw, base),
```

In the same file, replace:

```ts
  editor.watch.origin = expecting ? 'privacy' : 'outside';
}

/** The window of a project's open editor, if there is one. */
export async function editorWindowOf(dir: string): Promise<BrowserWindow | undefined> {
  const editor = await editorOf(dir);
```

with:

```ts
  editor.watch.origin = expecting ? 'privacy' : 'outside';
}

/** The next outside change of the project comes from the app's own length fit ("Cuttle's length fit"). */
export async function expectLength(dir: string, expecting: boolean): Promise<void> {
  const editor = await editorOf(dir);
  if (!editor) return;
  // a change still waiting for the watcher's look keeps its own origin
  if (expecting) await editor.watch.settle();
  editor.watch.origin = expecting ? 'length' : 'outside';
}

/** The window of a project's open editor, if there is one. */
export async function editorWindowOf(dir: string): Promise<BrowserWindow | undefined> {
  const editor = await editorOf(dir);
```

- [ ] **Step 3: The menu and the toasts**

In `apps/desktop/src/renderer/editor/doc.ts`, replace:

```ts
// undoable. A change from outside is always a step of its own in the history, so no undo ever
// removes it without saying so.
import { parseProject, type CuttleProject } from '@cuttle/project';
import { applyCommand, describeChange, DocumentError, ensureIds, firstChanged, pinIds, replayCommands, type Command, type EditLimits, type ListName, type Raw } from '../../shared/document';
import type { ChangeOrigin, ProjectFileEvent } from '../../shared/ipc';
import { takeKey } from '../../shared/take';
```

with:

```ts
// undoable. A change from outside is always a step of its own in the history, so no undo ever
// removes it without saying so.
import { parseProject, type CuttleProject } from '@cuttle/project';
import { LENGTH_RULES, sceneSpans, totalDuration } from '@cuttle/timeline';
import { applyCommand, describeChange, DocumentError, ensureIds, firstChanged, pinIds, replayCommands, type Command, type EditLimits, type ListName, type Raw } from '../../shared/document';
import type { ChangeOrigin, ProjectFileEvent } from '../../shared/ipc';
import { takeKey } from '../../shared/take';
```

In the same file, replace:

```ts
const sourcesOf = (raw: Raw) => takeKey(raw.sources);

/** The undo step of a change made outside the editor, by who made it. */
const ORIGIN_LABELS: Record<ChangeOrigin, string> = { outside: 'the outside change', suggest: "Cuttle's cut", speech: "Cuttle's speech edits", privacy: "Cuttle's privacy masks" };

/** What the app's speech edits did, said once they arrive. */
function speechToast(project: CuttleProject): string {
```

with:

```ts
const sourcesOf = (raw: Raw) => takeKey(raw.sources);

/** The undo step of a change made outside the editor, by who made it. */
const ORIGIN_LABELS: Record<ChangeOrigin, string> = { outside: 'the outside change', suggest: "Cuttle's cut", speech: "Cuttle's speech edits", privacy: "Cuttle's privacy masks", length: "Cuttle's length fit" };

/** What the app's speech edits did, said once they arrive. */
function speechToast(project: CuttleProject): string {
```

In the same file, replace:

```ts
  return `Cuttle cut ${slips ? `${slips}, and ` : ''}${parts.join(' and ')} where the picture rests.`;
}

/** What the app's privacy masks did, said once they arrive. */
function privacyToast(project: CuttleProject): string {
  const count = (kind: 'privacy' | 'notification') => project.masks.filter((mask) => mask.auto === kind && mask.enabled).length;
```

with:

```ts
  return `Cuttle cut ${slips ? `${slips}, and ` : ''}${parts.join(' and ')} where the picture rests.`;
}

/** The length the Length control asked for last (null: the fit taken out), for what the fit's change says. */
let lengthAsked: number | null = null;
/** Seconds as the title bar and the timeline show them: to the tenth below. */
const secondsText = (seconds: number) => `${Math.floor(seconds * 10 + 1e-6) / 10} s`;
const SHORTEST = 'Shortest without cutting speech, clicks, typing, a zoom or a text';

/** What the app's length fit did, said once it arrives. */
function lengthToast(project: CuttleProject): string {
  const length = totalDuration(sceneSpans(project.scenes, project.cuts));
  if (lengthAsked === null) return `Cuttle took the length fit out: the video is ${secondsText(length)} again.`;
  if (length <= lengthAsked + LENGTH_RULES.close + 1e-6) return `Cuttle cut where the video rests to fit ${secondsText(lengthAsked)}: ${secondsText(length)} now.`;
  return `${SHORTEST}: ${secondsText(length)} (${secondsText(lengthAsked)} asked).`;
}

/**
 * Fits the video to `seconds` where it rests (the Length control), or takes the fit out (`null`).
 * A fit that changes the video arrives as a change of its own, one step to undo, and says what it
 * did; one that changes nothing says so here.
 */
export async function fitLength(seconds: number | null): Promise<void> {
  lengthAsked = seconds;
  const answer = await bridge.invoke('project:fit-length', { seconds });
  if ('problem' in answer) return toast(answer.problem, { tone: 'warning' });
  const { report } = answer;
  if (report.written) return;
  if (seconds === null) return toast('There is no length fit to take out.');
  toast(report.reached ? `The video is ${secondsText(report.length)}: it fits ${secondsText(seconds)}.` : `${SHORTEST}: ${secondsText(report.length)} (${secondsText(seconds)} asked).`);
}

/** What the app's privacy masks did, said once they arrive. */
function privacyToast(project: CuttleProject): string {
  const count = (kind: 'privacy' | 'notification') => project.masks.filter((mask) => mask.auto === kind && mask.enabled).length;
```

In the same file, replace:

```ts
        ? speechToast(project)
        : event.origin === 'privacy'
          ? privacyToast(project)
          : `Changed outside the app: ${describeChange(before.project, project)}`;
  toast(said, { undo: true, ...(show && event.origin === 'outside' && { show }) });
}
```

with:

```ts
        ? speechToast(project)
        : event.origin === 'privacy'
          ? privacyToast(project)
          : event.origin === 'length'
            ? lengthToast(project)
            : `Changed outside the app: ${describeChange(before.project, project)}`;
  toast(said, { undo: true, ...(show && event.origin === 'outside' && { show }) });
}
```

In `apps/desktop/src/renderer/editor/Timeline.tsx`, replace:

```
import { Select } from '../Select';
import { addCard, addMask, addPage, addZoom, overlayBlocked, selectedOrCurrentClip, setSpeed, split, SPEEDS } from './actions';
import { audible } from './audio';
import { edit, preview } from './doc';
import { beginGesture } from './gesture';
import { mediaUrl } from './media';
import { currentPlayer, select, setTool, shownProject, store, type Selection } from './session';
```

with:

```
import { Select } from '../Select';
import { addCard, addMask, addPage, addZoom, overlayBlocked, selectedOrCurrentClip, setSpeed, split, SPEEDS } from './actions';
import { audible } from './audio';
import { edit, fitLength, preview } from './doc';
import { beginGesture } from './gesture';
import { mediaUrl } from './media';
import { currentPlayer, select, setTool, shownProject, store, type Selection } from './session';
```

In the same file, replace:

```

  return (
    <section className="timeline" aria-label="Timeline">
      <TimelineBar status={model ? `${model.scenes.length} scene${model.scenes.length === 1 ? '' : 's'} · ${formatTime(duration)}` : ''} fit={fit} zoomValue={zoomValue} onScale={(value) => {
        const element = scroller.current;
        if (!element || !(fitPps > 0)) return;
        const next = fitPps * Math.pow(MAX_PPS / fitPps, value);
```

with:

```

  return (
    <section className="timeline" aria-label="Timeline">
      <TimelineBar status={model ? `${model.scenes.length} scene${model.scenes.length === 1 ? '' : 's'}` : ''} duration={model ? duration : undefined} fit={fit} zoomValue={zoomValue} onScale={(value) => {
        const element = scroller.current;
        if (!element || !(fitPps > 0)) return;
        const next = fitPps * Math.pow(MAX_PPS / fitPps, value);
```

In the same file, replace:

```
const isSelected = (selection: Selection | undefined, kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id;

/** The timeline's bar: split, speed, new items, snapping, fit and scale. */
function TimelineBar({ status, fit, zoomValue, onScale }: { status: string; fit: () => void; zoomValue: number; onScale: (value: number) => void }) {
  useStore(store, (state) => state.doc?.project);
  useStore(store, (state) => state.selection);
  const t = useStore(store, (state) => Math.round(state.player.t * 10));
```

with:

```
const isSelected = (selection: Selection | undefined, kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id;

/** The timeline's bar: split, speed, new items, snapping, fit and scale. */
function TimelineBar({ status, duration, fit, zoomValue, onScale }: { status: string; duration?: number; fit: () => void; zoomValue: number; onScale: (value: number) => void }) {
  useStore(store, (state) => state.doc?.project);
  useStore(store, (state) => state.selection);
  const t = useStore(store, (state) => Math.round(state.player.t * 10));
```

In the same file, replace:

```
        + Page
      </button>
      <span className="tl-status">{status}</span>
      <div className="grow" />
      <button className="act" aria-pressed={snap} onClick={() => store.set({ snap: !snap })} title="Snap to the playhead, scene edges, markers and other overlays (Ctrl while dragging: frames only)">
        Snap
```

with:

```
        + Page
      </button>
      <span className="tl-status">{status}</span>
      {duration !== undefined && <LengthControl duration={duration} />}
      <div className="grow" />
      <button className="act" aria-pressed={snap} onClick={() => store.set({ snap: !snap })} title="Snap to the playhead, scene edges, markers and other overlays (Ctrl while dragging: frames only)">
        Snap
```

In the same file, replace:

```
  );
}

/** The overlays of a lane that no clip shows: a click selects one (the inspector can move or delete it). */
function CutOutList({ at, items, onPick, onClose }: { at: { left: number; top: number }; items: { id: string; title: string }[]; onPick: (id: string) => void; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
```

with:

```
  );
}

/** The lengths the Length menu offers (output seconds). */
const LENGTHS = [15, 30, 45, 60, 90];

/**
 * The video's length; its menu fits the video to another length (Cuttle cuts where it rests, never
 * speech, clicks or typing: the Auto tab lists the cuts), to one typed in, or takes the fit out.
 */
function LengthControl({ duration }: { duration: number }) {
  const fitted = useStore(store, (state) => state.doc?.project.cuts.some((cut) => cut.auto === 'length') ?? false);
  const busy = useStore(store, (state) => state.status?.state === 'working' || state.doc?.issues !== undefined);
  const [typing, setTyping] = useState(false);
  if (typing) {
    return (
      <input
        className="length-input"
        autoFocus
        inputMode="decimal"
        placeholder="seconds"
        aria-label="Fit the video to this many seconds"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            const seconds = Number(event.currentTarget.value.trim().replace(',', '.'));
            setTyping(false);
            if (seconds > 0) void fitLength(seconds);
          }
          if (event.key === 'Escape') setTyping(false);
        }}
        onBlur={() => setTyping(false)}
        data-testid="length-input"
      />
    );
  }
  return (
    <Select
      value={undefined}
      options={[
        ...LENGTHS.map((seconds) => ({ value: String(seconds), label: `${seconds} s`, ...(duration <= seconds + 0.05 && { note: 'fits' }) })),
        { value: 'other', label: 'Other length…' },
        ...(fitted ? [{ value: 'none', label: 'Full length', note: 'no fit' }] : []),
      ]}
      onChange={(choice) => {
        if (choice === 'other') setTyping(true);
        else void fitLength(choice === 'none' ? null : Number(choice));
      }}
      label="Fit the video to a length"
      variant="bare"
      disabled={busy}
      className="length-select"
      testId="length"
      title="The video's length: fit it to another, and Cuttle cuts where it rests (never speech, clicks or typing)"
    >
      {formatTime(duration)}
      {fitted && <span className="length-fitted"> · fitted</span>}
    </Select>
  );
}

/** The overlays of a lane that no clip shows: a click selects one (the inspector can move or delete it). */
function CutOutList({ at, items, onPick, onClose }: { at: { left: number; top: number }; items: { id: string; title: string }[]; onPick: (id: string) => void; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```
  overflow: hidden;
  text-overflow: ellipsis;
}
/* the lanes scroll up and down together with their names when they are taller than the panel */
.tl-body {
  flex: 1;
```

with:

```
  overflow: hidden;
  text-overflow: ellipsis;
}
/* the video's length and its fit (Timeline.tsx's LengthControl) */
.length-select {
  color: var(--muted);
}
.length-fitted {
  color: var(--accent);
}
.length-input {
  width: 72px;
  height: 22px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: var(--stage);
  box-shadow: inset 0 0 0 1px var(--accent);
  color: var(--text);
  font: inherit;
  user-select: text;
}
.length-input:focus-visible {
  outline: none;
}
/* the lanes scroll up and down together with their names when they are taller than the panel */
.tl-body {
  flex: 1;
```

- [ ] **Step 4: Typecheck, then the check with screenshots**

Run: `pnpm typecheck`
Expected: exits with code 0.

```bash
mkdir -p "$TEMP/cuttle-p4m6-shots"
CUTTLE_HIDDEN=1 CUTTLE_RECORDER_BACKEND=test CUTTLE_CHECK_SHOTS="$TEMP/cuttle-p4m6-shots" pnpm app:check
```

Expected: PASS, 47 tests. Look at `36-length-fit`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "desktop: the timeline bar's length fits the video, as one step to undo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The skill

**Files:**
- Modify: `skill/cuttle/SKILL.md`, `skill/test/skill.test.ts`

- [ ] **Step 1: Fit last**

In `skill/cuttle/SKILL.md`, replace:

```markdown
  - Masks apply to clips only: look at a captured page yourself before you add it.
- **Story.** Trim what does not help. Keep the prompt readable (1.5 s or more) and the answer on
  screen for 2–3 s. A speed-up shows a "12× speed" badge.
- **Focus.** Add or fix `zooms` on what matters: 2–4 s on the answer or a result, with the rect
  read off a `frame --grid`. Over a sped-up clip, durations are source seconds: 3 s at 12× is a
  quarter second on screen (see project.md).
```

with:

```markdown
  - Masks apply to clips only: look at a captured page yourself before you add it.
- **Story.** Trim what does not help. Keep the prompt readable (1.5 s or more) and the answer on
  screen for 2–3 s. A speed-up shows a "12× speed" badge.
- **Length.** For a length the user names (X: under 60 s), fit it last, after your zooms and
  texts: `cuttle -C "<project>" --json fit 45`. It cuts where the video rests (`auto: "length"`),
  never speech, clicks, typing, a zoom or a text, and says the shortest it can make when the
  length is out of reach. A new fit replaces the last; `fit --off` takes it out.
  (`suggest --length 45` fits in the same run, before any hand edits.)
- **Focus.** Add or fix `zooms` on what matters: 2–4 s on the answer or a result, with the rect
  read off a `frame --grid`. Over a sped-up clip, durations are source seconds: 3 s at 12× is a
  quarter second on screen (see project.md).
```

In `skill/test/skill.test.ts`, replace:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'frame', 'capture-page', 'render', 'recover'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
```

with:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'render', 'recover'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run --project node skill/test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add skill
git commit -m "skill: fit the length last, with cuttle fit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 728 passed and 58 skipped (on a machine without a speech model the real transcription is skipped too: 727 and 59; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 5 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Open a take of a minute or more, and pick 30 s in the timeline bar's length: the video gets shorter where it rests, and your speech, clicks and typing stay.
2. Ask for a length it cannot reach: the toast says the shortest it can make.
3. Pick "Full length": the video is whole again. Ctrl+Z undoes either.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran once, on the prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits.

**Found while checking, and already in the plan above**
- **The fit cut into the demo's zoom on Claude's answer:** that zoom was made by hand, and only Cuttle's own answer zoom was kept. Every zoom that is on is kept now: a zoom shows what matters.
- **The demo leaves almost nothing to cut** (its test picture changes all the time, and its zoom, its click and its typing cover the clips). The check fits a take that rests to 5 s, and the demo shows the case where the video already fits.
- **The first fit of a take decodes it** (no kept analysis yet): the check waits up to 30 s for its answer.
- **The analysis was first kept in the take's folder** (`takes/<n>/analysis.json`). CI's Windows app check then failed twice, each time in a different test that moves or deletes a take folder right after a cut (the restart, the take menu's delete, an export's cleanup), while main passed. The app's messages do not reach CI's log, so the cause is not proven: a file written into the folder just before it is moved or deleted (and scanned) is the likely one. The analysis now lives in `.cuttle/analysis/` with the app's other caches, which is where a cache belongs anyway.
- **The toast rounded up** ("8.5 s") where the bar and the title bar show 8.4 s; it floors to the tenth as they do.
- **`suggest --length` alone would not keep the hand edits:** the skill runs `suggest` once, before them. `cuttle fit` fits afterwards.

**Spec points that move**
- **The spec's "Shortest without cutting speech: 42 s"** names more: "speech, clicks, typing, a zoom or a text", since all of those stay.
- **"Custom"** is "Other length…", a field in the bar; the menu adds 45 and 90 s to 15, 30 and 60 s, and "Full length" takes the fit out.
- **The importance curve lives in `packages/timeline`** as the spec says; the fit beside it is pure too, so the core only gathers the take's inputs.

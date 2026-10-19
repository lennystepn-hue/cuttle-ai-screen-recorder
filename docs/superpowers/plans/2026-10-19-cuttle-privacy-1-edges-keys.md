# Cuttle Privacy 1: Mask Edges, More Keys, the Folder Kept Out of Git Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three gaps that questions under the launch post found, closed:
- **Mask edges:** `cuttle preview --masks` shows each mask's edges: just before it starts, inside its start and its end, and just after it ends, a row of the sheet per mask. Until now the default sheet's twelve evenly spaced stills ignored the masks, so a secret that showed a moment before its mask started was easy to miss.
- **More keys:** keys of more services are found by their prefix: Stripe, Hugging Face, xAI, Groq, Replicate, npm, PyPI, AWS's temporary keys, Google OAuth, Shopify, DigitalOcean, Linear, SendGrid.
- **The folder kept out of git:**
  - A new project's folder gets a `.gitignore` for `takes/` and `.cuttle/`, which show the screen unmasked.
  - The README and the skill say to share the rendered video, never the folder.

**Architecture:**
- **`@cuttle/timeline`:**
  - `outputTimesOf` moves here from the editor's model.
  - `maskEdges` gives a mask's four moments in output seconds, wherever a clip shows them.
- **The CLI:** `preview --masks` renders those stills, says which still shows which edge (`masks` in its JSON), and lays the sheet out four a row.
- **`@cuttle/core`:**
  - The key prefixes become rules, each with how long a key goes on after it. Some take letters and digits only.
  - `writeProjectFile` writes the `.gitignore` when it creates a project.

**Tech Stack:** TypeScript strict, Electron 44.7.2 (the stills), ffmpeg.

Reported on 2026-10-19 from the questions under the launch post: a secret can flash between two stills of the sheet; keys without a known prefix; the project folder holds the takes unmasked. Two more PRs follow: the screen's text read where it only flashes, and random-looking strings with the screen's text kept redacted. Previous plan: `docs/superpowers/plans/2026-10-19-cuttle-fix-claude-background.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `privacy-edges-keys`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The full `pnpm test` and the typecheck run in Task 4.

## Decisions made while planning

The gaps were checked in the code first; each was as reported. The finished prototype passed `pnpm test` (967 tests, 80 skipped, in two full runs), the typecheck, `app:check` (58 tests) and `cli:check` (16). Every screenshot was looked at.

- **Four moments a mask, 0.1 s from each end** (`MASK_EDGE_SECONDS`, source seconds):
  - Before it starts and after it ends, what it hides must not show yet (or no more).
  - Inside its start and its end, it must be covered.
  - A mask shorter than 0.2 s is looked at once, in its middle.
  - Each moment is a still wherever a clip shows it (none where no clip does); in a sped-up clip 0.1 s of source is a moment of video.
- **`--masks` is asked for, not the default:** the default sheet stays a quick look at the whole video.
  - The skill has Claude run `preview --masks` after it masked, in place of three `--at` stills for each mask it worked out itself.
  - The sheet is four stills a row, so each row is one mask, and the output lists which still shows which edge.
  - Without a mask that a clip shows, it says so (`usage`) instead of rendering nothing.
- **A warning for sped-up stretches without a still was left out:** at 12× no sheet is dense enough. What catches a secret that only flashes is reading the screen's text where it flashes (the next PR).
- **Key prefixes are rules:**
  - `rest`: how many key characters must follow (Stripe's 16; Hugging Face's, xAI's, npm's 30; DigitalOcean's 40; SendGrid's 50).
  - `plain`: those characters are letters and digits only, so `npm_config_cache`, `hf_hub_download` or `r8_model` are no keys.
  - One wrong letter is still allowed in prefixes of 4 letters or more.
  - `sk_live_` was missed until now: the prefix `sk-` is too short for a slip, and `_` is not `-`.
- **The tests put their keys together at run time** (a prefix and a repeated pattern), so no key-like text stands in the source: GitHub's push protection blocks some, fake or not.
- **The `.gitignore`:**
  - Written when `writeProjectFile` creates a project. Every new project goes through it: `cuttle init`, `cuttle record`, the app, `recover`.
  - It leaves out `takes/` (the recording, its input log, transcript and screen text) and `.cuttle/` (the editor's 720p copy, thumbnails, waveform).
  - The rendered `out/` and `preview/` are masked and stay in.
  - A `.gitignore` that is already there stays as it is. An existing project gets none: its owner may have removed it.
- **The README** also says that the input log counts key presses but never stores them, and that on Linux the screen's text is not read.
- **The tests that transcribe with a real speech model run last, one file at a time** (a `heavy` project with `sequence.groupOrder: 1`):
  - Since P5-M4b's live captions they keep the GPU and the processor busy for half a minute.
  - Beside them the recorder's takes in real time came out short: three full runs in a row each failed 3 or 4 such tests.
  - With them last, the next two runs passed whole.

## File structure

| File | Responsibility |
|---|---|
| `packages/timeline/src/{time,index}.ts`, `apps/desktop/src/shared/timeline-model.ts` | `outputTimesOf` and `maskEdges` |
| `apps/cli/src/commands/preview.ts`, `apps/cli/src/main.ts` | `preview --masks` |
| `packages/core/src/privacy/patterns.ts` | the key prefixes |
| `packages/core/src/{project-file,index}.ts` | the new project's `.gitignore` |
| `vitest.config.ts` | the real transcriptions after every other test |
| `README.md`, `skill/cuttle/SKILL.md` | the guides |

---

### Task 1: A mask's edges, and `preview --masks`

**Files:**
- Modify: `packages/timeline/src/time.ts`, `packages/timeline/src/index.ts`, `packages/timeline/test/time.test.ts`, `apps/desktop/src/shared/timeline-model.ts`, `apps/cli/src/commands/preview.ts`, `apps/cli/src/main.ts`, `apps/cli/test/electron.check.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `privacy-edges-keys`; work there:

```bash
git switch privacy-edges-keys
```

- [ ] **Step 2: Write the failing tests**

In `packages/timeline/test/time.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import type { ClipScene, Scene } from '@cuttle/project';
import { crossfadeHalf, isContinuousCut, pageTransition, sceneDuration, sceneSpans, sourceTimeAt, spanAt, totalDuration } from '../src/time';

const clip = (from: number, to: number, speed = 1): ClipScene => ({ type: 'clip', from, to, speed });
const scenes: Scene[] = [clip(10, 20), clip(20, 140, 12), { type: 'card', title: 'End', duration: 2 }];
```

with:

```ts
import { describe, expect, it } from 'vitest';
import type { ClipScene, Scene } from '@cuttle/project';
import { crossfadeHalf, isContinuousCut, maskEdges, outputTimesOf, pageTransition, sceneDuration, sceneSpans, sourceTimeAt, spanAt, totalDuration } from '../src/time';

const clip = (from: number, to: number, speed = 1): ClipScene => ({ type: 'clip', from, to, speed });
const scenes: Scene[] = [clip(10, 20), clip(20, 140, 12), { type: 'card', title: 'End', duration: 2 }];
```

In the same file, replace:

```ts
  });
});

describe('isContinuousCut', () => {
  it('is a cut between clips where the first ends where the second begins, within 1 ms', () => {
    expect(isContinuousCut(clip(10, 20), clip(20, 140, 12))).toBe(true);
```

with:

```ts
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
```

In `apps/cli/test/electron.check.test.ts`, replace:

```ts
    expect(pngSize(sheet.json.sheet as string)[0]).toBeGreaterThan(1000);
  }, 120_000);

  it('captures a whole page and appends it as a scrolling still scene', () => {
    const page = join(project, 'page.html');
    // A landing page: smooth scrolling, a fixed header (black, 60 px), a full-height hero (100vh,
```

with:

```ts
    expect(pngSize(sheet.json.sheet as string)[0]).toBeGreaterThan(1000);
  }, 120_000);

  it("renders stills at each mask's edges, a row of the sheet per mask, and says which is which", () => {
    const file = join(project, 'cuttle.json');
    const before = readFileSync(file, 'utf8');
    const raw = JSON.parse(before) as Record<string, unknown>;
    try {
      writeFileSync(file, JSON.stringify({ ...raw, masks: [{ id: 'mask1', label: 'Key', from: 1, to: 2, rect: [0, 0, 200, 40] }, { from: 2.4, to: 2.6, rect: [0, 0, 50, 50], enabled: false }] }));
      const { code, json } = cuttle('-C', project, 'preview', '--masks');
      expect(code).toBe(0);
      // one clip over the whole take: output and source seconds are the same
      expect(json.masks).toEqual([
        { mask: 0, id: 'mask1', label: 'Key', edge: 'before', t: 0.9, source: 0.9 },
        { mask: 0, id: 'mask1', label: 'Key', edge: 'start', t: 1.1, source: 1.1 },
        { mask: 0, id: 'mask1', label: 'Key', edge: 'end', t: 1.9, source: 1.9 },
        { mask: 0, id: 'mask1', label: 'Key', edge: 'after', t: 2.1, source: 2.1 },
      ]);
      expect((json.stills as { t: number }[]).map((still) => still.t)).toEqual([0.9, 1.1, 1.9, 2.1]);
      // four stills a row: one row
      const [width, height] = pngSize(json.sheet as string);
      expect(width / height).toBeGreaterThan(3);
      // without a mask to look at, it says so
      writeFileSync(file, JSON.stringify({ ...raw, masks: [{ from: 2.4, to: 2.6, rect: [0, 0, 50, 50], enabled: false }] }));
      const none = cuttle('-C', project, 'preview', '--masks');
      expect(none.code).toBe(1);
      expect(none.json).toMatchObject({ error: { code: 'usage' } });
    } finally {
      writeFileSync(file, before);
    }
  }, 120_000);

  it('captures a whole page and appends it as a scrolling still scene', () => {
    const page = join(project, 'page.html');
    // A landing page: smooth scrolling, a fixed header (black, 60 px), a full-height hero (100vh,
```

Run: `pnpm exec vitest run --project node packages/timeline/test/time.test.ts`
Expected: FAIL: there is no `maskEdges` or `outputTimesOf` in `../src/time`.

- [ ] **Step 3: The edges, and the preview**

In `packages/timeline/src/time.ts`, replace:

```ts
  return clamp(scene.from + local * scene.speed, scene.from, scene.to);
}

/** Two clips closer than this (source seconds) at a boundary count as one continuous piece of footage. */
export const CONTINUOUS_CUT_SECONDS = 1e-3;
```

with:

```ts
  return clamp(scene.from + local * scene.speed, scene.from, scene.to);
}

/** The output seconds at which the clips show source second `t` (none when it is cut out). */
export function outputTimesOf(spans: readonly SceneSpan[], t: number): number[] {
  const times: number[] = [];
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'clip' || t < scene.from || t >= scene.to) continue;
    times.push(span.start + (t - scene.from) / scene.speed);
  }
  return times;
}

/** How far before and after a mask's start and end its edges are looked at (source seconds). */
export const MASK_EDGE_SECONDS = 0.1;

/** Where a mask is looked at: just before it starts, inside its start, inside its end, just after it ends. */
export type MaskEdge = 'before' | 'start' | 'end' | 'after';

/**
 * The moments that show whether a mask covers what it hides: `MASK_EDGE_SECONDS` before its start
 * and after its end (what it hides must not show yet, or no more) and as far inside each end (it
 * must be covered), in output seconds wherever a clip shows that moment, in order. A mask shorter
 * than twice that is looked at in its middle once.
 */
export function maskEdges(mask: { from: number; to: number }, spans: readonly SceneSpan[]): { edge: MaskEdge; t: number; source: number }[] {
  const inside = mask.to - mask.from > 2 * MASK_EDGE_SECONDS;
  const middle = (mask.from + mask.to) / 2;
  const moments: [MaskEdge, number][] = [
    ['before', mask.from - MASK_EDGE_SECONDS],
    ['start', inside ? mask.from + MASK_EDGE_SECONDS : middle],
    ...(inside ? [['end', mask.to - MASK_EDGE_SECONDS] as [MaskEdge, number]] : []),
    ['after', mask.to + MASK_EDGE_SECONDS],
  ];
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return moments
    .flatMap(([edge, source]) => outputTimesOf(spans, source).map((t) => ({ edge, t: round(t), source: round(source) })))
    .sort((a, b) => a.t - b.t);
}

/** Two clips closer than this (source seconds) at a boundary count as one continuous piece of footage. */
export const CONTINUOUS_CUT_SECONDS = 1e-3;
```

In `packages/timeline/src/index.ts`, replace:

```ts
export { clamp, clamp01, ease, easeInOutCubic, lerp, lerpRect, type EaseKind } from './easing';
export {
  CONTINUOUS_CUT_SECONDS,
  MIN_PIECE_SECONDS,
  clipPieces,
  crossfadeHalf,
  pageTransition,
  isContinuousCut,
  sceneDuration,
```

with:

```ts
export { clamp, clamp01, ease, easeInOutCubic, lerp, lerpRect, type EaseKind } from './easing';
export {
  CONTINUOUS_CUT_SECONDS,
  MASK_EDGE_SECONDS,
  MIN_PIECE_SECONDS,
  clipPieces,
  crossfadeHalf,
  maskEdges,
  outputTimesOf,
  pageTransition,
  isContinuousCut,
  sceneDuration,
```

In the same file, replace:

```ts
  spanAt,
  totalDuration,
  type CutRange,
  type SceneSpan,
} from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
```

with:

```ts
  spanAt,
  totalDuration,
  type CutRange,
  type MaskEdge,
  type SceneSpan,
} from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
```

In `apps/desktop/src/shared/timeline-model.ts`, replace:

```ts
// What the editor's timeline draws, in output seconds: pure, so it is tested without a window.
import { isFact, type AutoKind, type CuttleProject, type InputEvent, type Marker, type MarkerKind } from '@cuttle/project';
import { occurrences, type SceneSpan } from '@cuttle/timeline';
import { formatDuration } from './format';

export type OverlayKind = 'zoom' | 'mask' | 'caption' | 'motion' | 'sound';
```

with:

```ts
// What the editor's timeline draws, in output seconds: pure, so it is tested without a window.
import { isFact, type AutoKind, type CuttleProject, type InputEvent, type Marker, type MarkerKind } from '@cuttle/project';
import { occurrences, outputTimesOf, type SceneSpan } from '@cuttle/timeline';
import { formatDuration } from './format';

export type OverlayKind = 'zoom' | 'mask' | 'caption' | 'motion' | 'sound';
```

In the same file, replace:

```ts
  return notches.sort((a, b) => a.t - b.t);
}

/** The output seconds at which the clips show source second `t` (none when it is cut out). */
export function outputTimesOf(spans: readonly SceneSpan[], t: number): number[] {
  const times: number[] = [];
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'clip' || t < scene.from || t >= scene.to) continue;
    times.push(span.start + (t - scene.from) / scene.speed);
  }
  return times;
}

export function timelineModel(project: CuttleProject, spans: readonly SceneSpan[], markers: readonly Marker[] = []): TimelineModel {
  // a clip with cuts in it is several spans in a row with one sceneIndex: one block
```

with:

```ts
  return notches.sort((a, b) => a.t - b.t);
}

// @cuttle/timeline's; the editor imports it from here
export { outputTimesOf };

export function timelineModel(project: CuttleProject, spans: readonly SceneSpan[], markers: readonly Marker[] = []): TimelineModel {
  // a clip with cuts in it is several spans in a row with one sceneIndex: one block
```

In `apps/cli/src/commands/preview.ts`, replace:

```ts
import { join, resolve } from 'node:path';
import type { MotionItemReport } from '@cuttle/export';
import { sceneSpans, totalDuration } from '@cuttle/timeline';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '@cuttle/core';

export interface PreviewArgs {
  /** Output seconds; without them, a sheet of `SHEET_STILLS` evenly spaced stills. */
  at?: number[];
  sheet?: boolean;
  format?: string;
  /** Folder for the PNGs (default preview/ in the project). */
```

with:

```ts
import { join, resolve } from 'node:path';
import type { MotionItemReport } from '@cuttle/export';
import { maskEdges, sceneSpans, totalDuration, type MaskEdge } from '@cuttle/timeline';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '@cuttle/core';

export interface PreviewArgs {
  /** Output seconds; without them (and without `masks`), a sheet of `SHEET_STILLS` evenly spaced stills. */
  at?: number[];
  /** Stills at each mask's edges (`maskEdges`), and a sheet of them, a row per mask. */
  masks?: boolean;
  sheet?: boolean;
  format?: string;
  /** Folder for the PNGs (default preview/ in the project). */
```

In the same file, replace:

```ts
  height: number;
  /** What the motion items' pages said (errors and console), when the project has any. */
  motion?: MotionItemReport[];
  stats: { gpu: string; totalMs: number };
}
```

with:

```ts
  height: number;
  /** What the motion items' pages said (errors and console), when the project has any. */
  motion?: MotionItemReport[];
  /** With `masks`: which still shows which mask's edge (`t` is the still's). */
  masks?: { mask: number; id?: string; label?: string; edge: MaskEdge; t: number; source: number }[];
  stats: { gpu: string; totalMs: number };
}
```

In the same file, replace:

```ts
  const file = await readProjectFile(projectDir);
  const duration = totalDuration(sceneSpans(file.project.scenes, file.project.cuts));
  if (duration <= 0) throw new CliError('invalid-project', `${file.path} has no scenes yet; run "cuttle suggest" or add scenes`);
  const times = args.at && args.at.length > 0 ? args.at : Array.from({ length: SHEET_STILLS }, (_, i) => Math.round(((i + 0.5) * duration * 1000) / SHEET_STILLS) / 1000);
  const bad = times.find((t) => !Number.isFinite(t) || t < 0);
  if (bad !== undefined) throw new CliError('usage', `--at takes output seconds of 0 or more (got ${bad})`);
  const sheet = args.sheet ?? !(args.at && args.at.length > 0);
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview');
  output.info(`rendering ${times.length} still(s) into ${outDir} …`);
  const result = await runInElectron<PreviewResult>(
    { command: 'preview', projectDir: file.dir, outDir, times, quiet: output.json, clean: args.out === undefined, ...(args.format !== undefined && { format: args.format }), ...(sheet && { sheet: {} }) },
    signal,
  );
  output.result(result, () =>
    [
      ...result.stills.map((still) => `${still.t.toFixed(2)} s${still.source !== undefined ? ` (source ${still.source.toFixed(2)} s)` : ''}  ${still.file}`),
      ...(result.sheet ? [`sheet  ${result.sheet}`] : []),
      ...(result.motion ?? []).flatMap((report) => report.errors.map((error) => `error in ${report.item} (${report.src}): ${error}`)),
    ].join('\n'),
  );
```

with:

```ts
  const file = await readProjectFile(projectDir);
  const duration = totalDuration(sceneSpans(file.project.scenes, file.project.cuts));
  if (duration <= 0) throw new CliError('invalid-project', `${file.path} has no scenes yet; run "cuttle suggest" or add scenes`);
  const spans = sceneSpans(file.project.scenes, file.project.cuts);
  const edges = args.masks
    ? file.project.masks.flatMap((mask, index) =>
        mask.enabled === false ? [] : maskEdges(mask, spans).map((edge) => ({ mask: index, ...(mask.id !== undefined && { id: mask.id }), ...(mask.label !== undefined && { label: mask.label }), ...edge })),
      )
    : [];
  if (args.masks && edges.length === 0) throw new CliError('usage', `${file.path} has no mask that a clip shows: --masks has nothing to look at`);
  const at = args.at ?? [];
  const times = at.length > 0 || edges.length > 0 ? [...new Set([...at, ...edges.map((edge) => edge.t)])].sort((a, b) => a - b) : Array.from({ length: SHEET_STILLS }, (_, i) => Math.round(((i + 0.5) * duration * 1000) / SHEET_STILLS) / 1000);
  const bad = times.find((t) => !Number.isFinite(t) || t < 0);
  if (bad !== undefined) throw new CliError('usage', `--at takes output seconds of 0 or more (got ${bad})`);
  const sheet = args.sheet ?? at.length === 0;
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview');
  output.info(`rendering ${times.length} still(s) into ${outDir} …`);
  const result = await runInElectron<PreviewResult>(
    { command: 'preview', projectDir: file.dir, outDir, times, quiet: output.json, clean: args.out === undefined, ...(args.format !== undefined && { format: args.format }), ...(sheet && { sheet: edges.length > 0 && at.length === 0 ? { columns: 4 } : {} }) },
    signal,
  );
  if (edges.length > 0) result.masks = edges;
  const named = (edge: (typeof edges)[number]) => `${edge.label ?? 'mask'} ${edge.id ?? `#${edge.mask}`}`;
  output.result(result, () =>
    [
      ...result.stills.map((still) => `${still.t.toFixed(2)} s${still.source !== undefined ? ` (source ${still.source.toFixed(2)} s)` : ''}  ${still.file}`),
      ...(result.sheet ? [`sheet  ${result.sheet}`] : []),
      ...edges.map((edge) => `${edge.t.toFixed(2)} s  ${named(edge)}: ${edge.edge === 'before' ? 'before it starts' : edge.edge === 'after' ? 'after it ends' : `inside its ${edge.edge}`} (source ${edge.source.toFixed(2)} s)`),
      ...(result.motion ?? []).flatMap((report) => report.errors.map((error) => `error in ${report.item} (${report.src}): ${error}`)),
    ].join('\n'),
  );
```

In `apps/cli/src/main.ts`, replace:

```ts
    .command('preview')
    .description('PNG stills of the output, and a contact sheet')
    .option('--at <seconds...>', 'output times (default: 12 evenly spaced, with a sheet)', collect)
    .option('--sheet', 'also a contact sheet of the stills')
    .option('--format <format>', '16:9, 1:1 or 9:16 (default: the project output)')
    .option('-o, --out <dir>', 'folder for the PNGs (default: preview/ in the project)')
    .action(
      action((output, project, options: { at?: number[]; sheet?: boolean; format?: string; out?: string }) =>
        withSignal(output, (signal) => previewCommand(project, options, output, signal)),
      ),
    );
```

with:

```ts
    .command('preview')
    .description('PNG stills of the output, and a contact sheet')
    .option('--at <seconds...>', 'output times (default: 12 evenly spaced, with a sheet)', collect)
    .option('--masks', "stills just before, inside and after each mask's start and end, with a sheet (a row per mask)")
    .option('--sheet', 'also a contact sheet of the stills')
    .option('--format <format>', '16:9, 1:1 or 9:16 (default: the project output)')
    .option('-o, --out <dir>', 'folder for the PNGs (default: preview/ in the project)')
    .action(
      action((output, project, options: { at?: number[]; masks?: boolean; sheet?: boolean; format?: string; out?: string }) =>
        withSignal(output, (signal) => previewCommand(project, options, output, signal)),
      ),
    );
```

Run: `pnpm exec vitest run --project node packages/timeline/test/time.test.ts`, then `pnpm cli:check`
Expected: PASS (the check renders the four stills of a mask, one row of the sheet, and refuses a project whose only mask is off).

- [ ] **Step 4: Commit**

```bash
git add packages/timeline apps/desktop/src/shared/timeline-model.ts apps/cli
git commit -m "preview --masks: stills just before, inside and after each mask's start and end

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: More keys by their prefix

**Files:**
- Modify: `packages/core/src/privacy/patterns.ts`, `packages/core/test/patterns.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/core/test/patterns.test.ts`, replace:

```ts
    expect(found('-----BEGIN OPENSSH PRIVATE KEY-----')).toEqual([['key', '-----BEGIN OPENSSH PRIVATE KEY-----']]);
  });

  it('finds tokens in links, and the value of a private name', () => {
    expect(found('$ curl "https://api.examp1e.com/v1/items?access_token=abc123def456ghi789"')).toContainEqual(['token', 'abc123def456ghi789']);
    expect(found('Password: hunter2 (do not share)')).toEqual([['value', 'hunter2 (do not share)']]);
```

with:

```ts
    expect(found('-----BEGIN OPENSSH PRIVATE KEY-----')).toEqual([['key', '-----BEGIN OPENSSH PRIVATE KEY-----']]);
  });

  it("finds more services' keys by their prefix, and not names that only start the same", () => {
    // put together here, so no key-like text stands in the source
    const key = (prefix: string, length: number) => prefix + 'Ab1Cd2Ef3Gh4Jk5Lm6Np7Qr8St9Uv0Wx1Yz2'.repeat(3).slice(0, length);
    for (const [prefix, length] of [
      ['sk_' + 'live_', 24],
      ['sk_' + 'test_', 24],
      ['rk_' + 'live_', 24],
      ['whsec_', 32],
      ['hf_', 34],
      ['xai-', 40],
      ['gsk_', 52],
      ['r8_', 37],
      ['npm_', 36],
      ['pypi-', 60],
      ['ASIA', 16],
      ['ya29.', 40],
      ['shpat_', 32],
      ['dop_v1_', 64],
      ['lin_api_', 40],
    ] as const) {
      const token = key(prefix, length);
      expect(found(`export TOKEN_VALUE ${token}`), prefix).toContainEqual(['key', token]);
    }
    const sendgrid = `SG.${key('', 22)}.${key('', 43)}`;
    expect(found(sendgrid)).toEqual([['key', sendgrid]]);
    for (const clean of ['npm_config_cache C:\\npm-cache', 'TZ Asia/Tokyo', 'vite sg.config.ts', 'hf_hub_download(repo_id)', 'r8_model ready', 'see ya29.example']) expect(found(clean), clean).toEqual([]);
  });

  it('finds tokens in links, and the value of a private name', () => {
    expect(found('$ curl "https://api.examp1e.com/v1/items?access_token=abc123def456ghi789"')).toContainEqual(['token', 'abc123def456ghi789']);
    expect(found('Password: hunter2 (do not share)')).toEqual([['value', 'hunter2 (do not share)']]);
```

Run: `pnpm exec vitest run --project node packages/core/test/patterns.test.ts`
Expected: FAIL: `sk_live_…` and the other new keys are not found.

- [ ] **Step 2: The prefixes as rules**

In `packages/core/src/privacy/patterns.ts`, replace:

```ts
  key: string;
}

/** Key prefixes; one wrong letter is allowed in those of 4 letters or more. */
const KEY_PREFIXES = ['sk-ant-', 'sk-proj-', 'sk-', 'ghp_', 'gho_', 'ghs_', 'ghu_', 'github_pat_', 'glpat-', 'xoxb-', 'xoxa-', 'xoxp-', 'xoxs-', 'akia', 'aiza', 'eyj'];
/** After a prefix, a key goes on with at least this many key characters. */
const KEY_REST = 10;
/** Names whose value is private, in a `NAME=value` or `name: value` line. */
const SECRET_NAMES = /(api[_ -]?key|_key|key\b|token|secret|passw(or)?d|\bpwd\b|session|authorization|\bauth\b|credential|cookie)/i;
```

with:

```ts
  key: string;
}

/** After a prefix, a key goes on with at least this many key characters (`rest` says otherwise). */
const KEY_REST = 10;
/**
 * Key prefixes (lower case); one wrong letter is allowed in those of 4 letters or more. `rest`: the
 * key characters that must follow; `plain`: they are letters and digits only (an environment name
 * such as npm_config_cache is not an npm token).
 */
const KEY_PREFIXES: readonly { prefix: string; rest?: number; plain?: true }[] = [
  { prefix: 'sk-ant-' },
  { prefix: 'sk-proj-' },
  { prefix: 'sk-' },
  // Stripe
  { prefix: 'sk_live_', rest: 16 },
  { prefix: 'sk_test_', rest: 16 },
  { prefix: 'rk_live_', rest: 16 },
  { prefix: 'rk_test_', rest: 16 },
  { prefix: 'whsec_', rest: 24 },
  // GitHub, GitLab, Slack
  { prefix: 'ghp_' },
  { prefix: 'gho_' },
  { prefix: 'ghs_' },
  { prefix: 'ghu_' },
  { prefix: 'github_pat_' },
  { prefix: 'glpat-' },
  { prefix: 'xoxb-' },
  { prefix: 'xoxa-' },
  { prefix: 'xoxp-' },
  { prefix: 'xoxs-' },
  // AWS (access keys and temporary ones), Google
  { prefix: 'akia', rest: 16 },
  { prefix: 'asia', rest: 16 },
  { prefix: 'aiza' },
  { prefix: 'ya29.', rest: 30 },
  // Hugging Face, xAI, Groq, Replicate, npm, PyPI
  { prefix: 'hf_', rest: 30, plain: true },
  { prefix: 'xai-', rest: 30, plain: true },
  { prefix: 'gsk_', rest: 30, plain: true },
  { prefix: 'r8_', rest: 30, plain: true },
  { prefix: 'npm_', rest: 30, plain: true },
  { prefix: 'pypi-', rest: 30 },
  // Shopify, DigitalOcean, Linear, SendGrid (SG.<22>.<43>)
  { prefix: 'shpat_', rest: 24, plain: true },
  { prefix: 'shpss_', rest: 24, plain: true },
  { prefix: 'dop_v1_', rest: 40, plain: true },
  { prefix: 'lin_api_', rest: 30, plain: true },
  { prefix: 'sg.', rest: 50 },
  // a JWT
  { prefix: 'eyj' },
];
/** Names whose value is private, in a `NAME=value` or `name: value` line. */
const SECRET_NAMES = /(api[_ -]?key|_key|key\b|token|secret|passw(or)?d|\bpwd\b|session|authorization|\bauth\b|credential|cookie)/i;
```

In the same file, replace:

```ts
  // keys by their prefix: the key and what follows on the line
  for (const match of text.matchAll(/[^\s=:"'`(/@]+/g)) {
    const token = match[0];
    const prefix = KEY_PREFIXES.find((candidate) => startsLike(token, candidate));
    if (!prefix) continue;
    // a JWT the OCR split with spaces goes on to the line's end: parts with dots between
    const rest = (prefix === 'eyj' ? text.slice(match.index + prefix.length).replace(/\s+/g, '') : token.slice(prefix.length)).replace(/[^A-Za-z0-9_\-.øØ]/g, '');
    if (prefix === 'eyj' && !(rest.length >= 20 && rest.includes('.'))) continue;
    if (rest.length < (prefix === 'akia' ? 16 : KEY_REST)) continue;
    add('key', match.index, text.length);
  }
  // a private key's header line
```

with:

```ts
  // keys by their prefix: the key and what follows on the line
  for (const match of text.matchAll(/[^\s=:"'`(/@]+/g)) {
    const token = match[0];
    const rule = KEY_PREFIXES.find((candidate) => startsLike(token, candidate.prefix));
    if (!rule) continue;
    const { prefix } = rule;
    // a JWT the OCR split with spaces goes on to the line's end: parts with dots between
    const after = prefix === 'eyj' ? text.slice(match.index + prefix.length).replace(/\s+/g, '') : token.slice(prefix.length);
    const rest = rule.plain ? (/^[A-Za-z0-9øØ]*/.exec(after)?.[0] ?? '') : after.replace(/[^A-Za-z0-9_\-.øØ]/g, '');
    if (prefix === 'eyj' && !(rest.length >= 20 && rest.includes('.'))) continue;
    if (rest.length < (rule.rest ?? KEY_REST)) continue;
    add('key', match.index, text.length);
  }
  // a private key's header line
```

Run: `pnpm exec vitest run --project node packages/core/test/patterns.test.ts packages/core/test/privacy-masks.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/privacy/patterns.ts packages/core/test/patterns.test.ts
git commit -m "privacy: keys of more services by their prefix (Stripe, Hugging Face, xAI, npm, PyPI and others)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A new project's `.gitignore`

**Files:**
- Modify: `packages/core/src/project-file.ts`, `packages/core/src/index.ts`, `packages/core/test/project-file.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/core/test/project-file.test.ts`, replace:

```ts
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CoreError } from '../src/errors';
import { newProjectFile, projectHash, readProjectFile, writeProjectFile } from '../src/project-file';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
```

with:

```ts
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CoreError } from '../src/errors';
import { PROJECT_GITIGNORE, newProjectFile, projectHash, readProjectFile, writeProjectFile } from '../src/project-file';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
```

In the same file, replace:

```ts
    expect(read.raw).toEqual(second.raw);
  });

  it('refuses to overwrite what another program saved since the file was read', async () => {
    const dir = temp();
    await writeProjectFile(newProjectFile(dir), 'init');
```

with:

```ts
    expect(read.raw).toEqual(second.raw);
  });

  it("gives a new project a .gitignore for its takes and the editor's copies, and leaves one that is there", async () => {
    const dir = temp();
    await writeProjectFile(newProjectFile(dir), 'init');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe(PROJECT_GITIGNORE);
    expect(PROJECT_GITIGNORE.split('\n').filter((line) => line && !line.startsWith('#'))).toEqual(['takes/', '.cuttle/']);
    // the person's own
    const own = temp();
    writeFileSync(join(own, '.gitignore'), 'node_modules/\n');
    await writeProjectFile(newProjectFile(own), 'init');
    expect(readFileSync(join(own, '.gitignore'), 'utf8')).toBe('node_modules/\n');
    // an existing project gets none (the person may have removed it)
    rmSync(join(dir, '.gitignore'));
    await writeProjectFile(await readProjectFile(dir), 'edit');
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  });

  it('refuses to overwrite what another program saved since the file was read', async () => {
    const dir = temp();
    await writeProjectFile(newProjectFile(dir), 'init');
```

In the same file, replace:

```ts
    expect(error).toBeInstanceOf(CoreError);
    expect(error).toMatchObject({ code: 'conflict', path: file.path, message: `${file.path} changed while suggest ran, so it was left as it is; run suggest again` });
    expect(readFileSync(file.path, 'utf8')).toBe(theirs);
    // the check comes first: no backup was made and nothing else was left behind
    expect(readdirSync(dir)).toEqual(['cuttle.json']);
  });

  it('refuses a new project when the file appeared meanwhile, and a file that was deleted', async () => {
```

with:

```ts
    expect(error).toBeInstanceOf(CoreError);
    expect(error).toMatchObject({ code: 'conflict', path: file.path, message: `${file.path} changed while suggest ran, so it was left as it is; run suggest again` });
    expect(readFileSync(file.path, 'utf8')).toBe(theirs);
    // the check comes first: no backup was made and nothing else was left behind (the .gitignore came with the project)
    expect(readdirSync(dir)).toEqual(['.gitignore', 'cuttle.json']);
  });

  it('refuses a new project when the file appeared meanwhile, and a file that was deleted', async () => {
```

In the same file, replace:

```ts
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
      expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict' });
      expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')).texts[0].text).toBe('a');
      expect(readdirSync(dir)).toEqual(['cuttle.json']);
    }
  });
});
```

with:

```ts
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
      expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict' });
      expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')).texts[0].text).toBe('a');
      expect(readdirSync(dir)).toEqual(['.gitignore', 'cuttle.json']);
    }
  });
});
```

Run: `pnpm exec vitest run --project node packages/core/test/project-file.test.ts`
Expected: FAIL: there is no `PROJECT_GITIGNORE`, and no `.gitignore` is written.

- [ ] **Step 2: Written with the project**

In `packages/core/src/project-file.ts`, replace:

```ts
  return { dir, path: join(dir, PROJECT_FILE), raw, project: parse(raw) };
}

export function projectExists(projectDir: string): boolean {
  return existsSync(join(resolve(projectDir), PROJECT_FILE));
}
```

with:

```ts
  return { dir, path: join(dir, PROJECT_FILE), raw, project: parse(raw) };
}

/**
 * What a new project's folder keeps out of git: the takes and the editor's copies of them show the
 * screen as it was recorded. The masks are drawn only into what is rendered (the export, previews).
 */
export const PROJECT_GITIGNORE = [
  '# Cuttle: the takes and the editor\'s copies of them show the screen as it was recorded, unmasked',
  '# (keys, email addresses, notifications). Share the exported video, not these folders.',
  'takes/',
  '.cuttle/',
  '',
].join('\n');

export function projectExists(projectDir: string): boolean {
  return existsSync(join(resolve(projectDir), PROJECT_FILE));
}
```

In the same file, replace:

```ts
      }
    };
    await unchanged();
    const backup = options.backup && existsSync(file.path) ? await backupFile(file.path) : undefined;
    const temp = `${file.path}.${process.pid}-${++temps}.tmp`;
    await writeFile(temp, text);
```

with:

```ts
      }
    };
    await unchanged();
    // a new project: its folder keeps the raw takes out of git (a .gitignore already there stays)
    if (file.hash === undefined) await writeFile(join(file.dir, '.gitignore'), PROJECT_GITIGNORE, { flag: 'wx' }).catch(() => {});
    const backup = options.backup && existsSync(file.path) ? await backupFile(file.path) : undefined;
    const temp = `${file.path}.${process.pid}-${++temps}.tmp`;
    await writeFile(temp, text);
```

In `packages/core/src/index.ts`, replace:

```ts
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
export { BACKUPS, PROJECT_FILE, backupFile, newProjectFile, projectExists, projectHash, readProjectFile, writeProjectFile, type ProjectFile, type WriteOptions, type WriteResult } from './project-file';
export { samePath, useTake, type TakeFiles } from './use-take';
export { suggestProject, type SuggestOptions, type SuggestResult } from './suggest';
export { recoverTake, type RecoverResult } from './recover';
```

with:

```ts
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
export { BACKUPS, PROJECT_FILE, PROJECT_GITIGNORE, backupFile, newProjectFile, projectExists, projectHash, readProjectFile, writeProjectFile, type ProjectFile, type WriteOptions, type WriteResult } from './project-file';
export { samePath, useTake, type TakeFiles } from './use-take';
export { suggestProject, type SuggestOptions, type SuggestResult } from './suggest';
export { recoverTake, type RecoverResult } from './recover';
```

Run: `pnpm exec vitest run --project node packages/core/test/project-file.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core
git commit -m "core: a new project's folder keeps its takes and the editor's copies out of git

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The real transcriptions after every other test

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: A project of their own, run last**

In `vitest.config.ts`, replace:

```ts
import { defineConfig } from 'vitest/config';
import { matchGolden } from './tools/vitest/golden-command.ts';

export default defineConfig({
  test: {
    passWithNoTests: true,
```

with:

```ts
import { defineConfig } from 'vitest/config';
import { matchGolden } from './tools/vitest/golden-command.ts';

/**
 * Tests that transcribe with a real speech model (where one is downloaded): they keep the GPU and
 * the processor busy for many seconds, and beside them the recorder's takes in real time come out
 * short. They run after every other test, one file at a time.
 */
const HEAVY = ['packages/core/test/live.test.ts', 'packages/core/test/speech-take.test.ts'];
// No speech model unless a test asks for one: a take with a mic is never transcribed by chance; and
// no OCR, which reads the screen of every take (a test that reads asks for it).
const NODE_ENV = { CUTTLE_MODELS_DIR: join(tmpdir(), 'cuttle-test-no-models'), CUTTLE_OCR: 'off' };

export default defineConfig({
  test: {
    passWithNoTests: true,
```

In the same file, replace:

```ts
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'skill/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.browser.test.ts'],
          // No speech model unless a test asks for one: a take with a mic is never transcribed by
          // chance; and no OCR, which reads the screen of every take (a test that reads asks for it).
          env: { CUTTLE_MODELS_DIR: join(tmpdir(), 'cuttle-test-no-models'), CUTTLE_OCR: 'off' },
        },
      },
      {
```

with:

```ts
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'skill/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.browser.test.ts', ...HEAVY],
          env: NODE_ENV,
        },
      },
      {
        test: {
          name: 'heavy',
          environment: 'node',
          include: HEAVY,
          env: NODE_ENV,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
      {
```

Run: `pnpm exec vitest run --project heavy`
Expected: PASS where a speech model and ffmpeg's whisper filter are there, else skipped.

- [ ] **Step 2: Commit**

```bash
git add vitest.config.ts
git commit -m "tests: the real transcriptions run after every other test, one file at a time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The guides, and final verification

**Files:**
- Modify: `README.md`, `skill/cuttle/SKILL.md`

- [ ] **Step 1: The README and the skill**

In `README.md`, replace:

```markdown
Cuttle works on your computer. Recording, cutting, the screen's text (Windows' own OCR or macOS's
Vision), transcription (Whisper models, downloaded once) and the export all run locally; nothing is
uploaded. Masks over private things are suggestions to check, not a guarantee: look at the stills
before you share a video.

## The desktop app
```

with:

```markdown
Cuttle works on your computer. Recording, cutting, the screen's text (Windows' own OCR or macOS's
Vision), transcription (Whisper models, downloaded once) and the export all run locally; nothing is
uploaded. Masks over private things are suggestions to check, not a guarantee: look at the stills
before you share a video (`cuttle preview --masks` shows each mask's edges).

The masks are drawn only into what Cuttle renders (the export, previews). The project folder keeps
the take as it was recorded (`takes/`, with the text the screen showed) and the editor's copies of it
(`.cuttle/`): share the exported video, never the folder. New projects get a `.gitignore` that
keeps both out of git. The input log counts key presses; it never stores what was typed.

Reading the screen's text needs Windows' OCR or macOS's Vision: on other systems (Linux) `suggest`
masks no text.

## The desktop app
```

In `skill/cuttle/SKILL.md`, replace:

```markdown
  - Find when it appears and when it goes: run `frame` at earlier and later source seconds
    (halving the step), then pad 0.5 s on each side for the mask's `from` and `to`. Text that
    scrolls moves: give each position its own mask, or cut the stretch out.
  - Use `fill` for secrets. Check every mask with `preview --at` 0.1 s inside each end and in the
    middle (output second = scene start + (source second − `from`) ÷ `speed`); each still's
    `source` must lie inside the mask's `[from, to)`, since a still shows the whole frame its time
    falls in.
  - Masks apply to clips only: look at a captured page yourself before you add it.
- **Story.** Trim what does not help. Keep the prompt readable (1.5 s or more) and the answer on
  screen for 2–3 s. A speed-up shows a "12× speed" badge.
- **Length.** For a length the user names (X: under 60 s), fit it last, after your zooms and
```

with:

```markdown
  - Find when it appears and when it goes: run `frame` at earlier and later source seconds
    (halving the step), then pad 0.5 s on each side for the mask's `from` and `to`. Text that
    scrolls moves: give each position its own mask, or cut the stretch out.
  - Use `fill` for secrets. Check every mask with
    `cuttle -C "<project>" --json preview --masks`: stills 0.1 s before each mask starts, inside its
    start and its end, and 0.1 s after it ends, a row of `preview/sheet.png` per mask (`masks` in
    the JSON says which still shows which mask's edge). Inside, what it hides must be covered;
    before and after, it must not show yet (or no more). Where it does, move the mask's `from` or
    `to` out by 0.5 s and check again. For a mask's middle, use `preview --at` (output second =
    scene start + (source second − `from`) ÷ `speed`).
  - Masks apply to clips only: look at a captured page yourself before you add it.
  - Only rendered videos and stills are masked. The project folder keeps the take as recorded
    (`takes/`, `.cuttle/`): never upload, attach or commit the folder, only the rendered video.
- **Story.** Trim what does not help. Keep the prompt readable (1.5 s or more) and the answer on
  screen for 2–3 s. A speed-up shows a "12× speed" badge.
- **Length.** For a length the user names (X: under 60 s), fit it last, after your zooms and
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

```bash
git add README.md skill
git commit -m "docs: preview --masks, and share the video, never the project folder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 967 passed and 80 skipped (here, with a speech model and ffmpeg's whisper filter; without them the real transcriptions are skipped too, and off Windows and macOS the OCR tests).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 16 tests.

Run: `pnpm app:check`
Expected: PASS, 58 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 3: By hand (the user)**

1. In a project with masks, `cuttle preview --masks`: a row of four stills per mask in `preview/sheet.png`, and the list of which still shows which edge.
2. A new recording's folder has a `.gitignore` with `takes/` and `.cuttle/`.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at, and the sheet of `preview --masks` for a test take with one mask.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **Two tests of `writeProjectFile` listed the project folder** as `cuttle.json` alone: the `.gitignore` is in it now.
- **The full test runs were red on main as well:**
  - Three in a row failed 3 or 4 tests each that record in real time or have a 5 s limit (the recorder's "records a 3 s take with every track" and "stops when asked …", the editor's random edit sequences, an export audio test), and once P5-M4b's live captions test itself.
  - The real transcriptions ran beside them. They run last now (Task 4), and the next two full runs passed whole.

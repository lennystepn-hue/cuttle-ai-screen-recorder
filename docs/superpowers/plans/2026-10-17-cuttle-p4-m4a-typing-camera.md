# Cuttle P4-M4a: The Camera That Follows Typing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Where someone types, the video zooms in on the text and the camera moves along with it, as a camera operator would: it starts with room for what comes next, and moves on smoothly whenever the text leaves the middle of the view.

**Architecture:**
- **Format** (`@cuttle/project`):
  - a zoom's `moves`: `[{ at, rect }]`, the places it goes to in turn;
  - an input event `caret`: where text is typed, logged by the recorder.
- **Timeline:** `zoomTargetAt` eases a zoom from one rect of its path to the next over 0.6 output seconds centred on each move. The engine draws what the timeline says, as before.
- **Recorder** (Windows): the system caret through `GetGUIThreadInfo`, read 5 times a second while keys are typed, logged when it moves.
- **Core** (`suggest/typing.ts`):
  - key bursts;
  - where the text goes: the caret, else what the screen changes (frames read twice a second);
  - the camera's path: a view 45 % of the screen wide that moves when the text leaves its middle.
  - `suggest` makes these zooms (`auto: "typing"`) after the answer zoom and before the click zooms.
- **CLI:** `suggest --no-typing-zooms`.
- **Editor:**
  - the moves as diamonds on the zoom's block;
  - the path in the source view, dashed;
  - a drag at the playhead takes the whole path along, and "Hold still" ends it;
  - a zoom's moves keep with its time through every edit.
- **Skill:** the typing zooms and `moves`.

**Tech Stack:** TypeScript strict, zod 4, vitest 5, koffi (user32), ffmpeg, Electron 44.7.2, React 19.3.0, Playwright (`_electron`).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase4-design.md`. Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p4-m3-retakes.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p4-m4a`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 9.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The prototype passed `pnpm test` (620 tests, 52 skipped), the typecheck, `app:check` (42 tests) and `cli:check` (5). Every screenshot was looked at.

- **The split.** The spec's P4-M4 has the live facts (`area`, `caret`, `window` events), the crop, the typing zooms and the dialog zooms. The user asked for the camera that follows typing first, so M4a has the caret and the typing zooms; M4b brings the content area and the crop, the windows and the dialog zooms.
- **A zoom that follows** (`moves`):
  - Each move is `{ at, rect }`: `at` in source seconds, after the zoom's start and the move before it, before the zoom's end. `moves` is optional, so a parsed zoom without it keeps its shape.
  - The zoom aims at `rect`, then at each move's rect in turn, eased (smooth) over 0.6 output seconds centred on the move: 0.6 × the clip's speed in source seconds. Moves closer than that blend into one another without a jump. The ramps in and out are as before.
  - The engine needs nothing new: the timeline gives each frame its rect.
- **The caret** (Windows):
  - `GetGUIThreadInfo` of the foreground thread gives the caret's rect in its window's client pixels; `ClientToScreen` makes them desktop pixels. Width and height are at least 1. Apps that draw their own caret have none.
  - The input's 30-a-second shape poll reads it every 6th time (5 a second) while a key came in the last second, and passes it on when it moved (`caretWatch`). It is written as `{ t, type: "caret", rect }` in screen-track pixels.
  - A caret is a fact about the screen, not input: activity (`suggest`'s plan, the speech edits' rest, the timeline's input lane) leaves it out.
  - macOS logs none; there the typing zooms follow the screen.
- **Typing zooms** (`TYPING_RULES`):
  - **Bursts:** `keys` counts (half seconds) that start at most 2 s apart (a pause under 1.5 s), at least 1.5 output seconds long, in clips at most 2× fast. Bursts 3 output seconds apart or less in one clip make one zoom.
  - **Where the text goes:**
    - The caret's middle, where the burst (±0.5 s) has a caret on the screen.
    - Else what the screen changes between frames read twice a second, 640 px wide. A change counts from 8 pixels: typed letters are a few pixels at that size. The 320 px of the answer zoom missed them.
    - A change wider or taller than 90 % of the view is a scroll or a new page, and is left out. Of a wide change, the point is 10 % of the view in from its right end: a shell draws the whole line anew as one types.
  - **The camera:**
    - The view is 45 % of the screen's width (about 2.2×), in the screen's shape.
    - It starts with the first second's text 35 % into the view from the left, centred from the top: room for what comes next.
    - When the text leaves the view's middle 60 %, the view moves so the text is 35 % in again: a new line goes back left and down. At most one move in 0.8 output seconds, and none shorter than 5 % of the view (against the screen's edge it cannot follow further).
  - **Timing**, as for click zooms:
    - The zoom eases in 0.7 s before the first key and lasts until 1.2 s after the last one, at least 1.8 s (output seconds).
    - No zoom starts or ends within 1 s of its clip's edge, and none overlaps another zoom (it ends where the next one starts).
    - At most one zoom starts in any 5 output seconds.
  - **Priority:** answer, typing, click. Click zooms keep clear of typing zooms; a click while typing is in the typing zoom.
  - **In `suggest`:**
    - `autoEdits.typingZooms` and `--no-typing-zooms` (also `--no-zoom`) leave them out.
    - A rerun replaces them by the tag rules: one switched off stays off.
    - The note says how many, how many moves, and what they follow ("1 zoom while typing, 3 moves following the text (the caret)").
- **The editor:**
  - **The timeline:** a zoom's block shows a diamond where it moves on.
  - **The source view:**
    - It shows a zoom where it is at the playhead.
    - A selected zoom that follows shows its path: the rects dashed, the line through their middles.
    - A drag or a resize there moves and scales the whole path the same way (`movePath`), and the chip says so.
  - **The inspector:** "Follows: N moves" with "Hold still", which ends the following (one step, "Hold the zoom still"). The area fields are the start's ("Start, in source pixels").
  - **Time edits keep the moves with the zoom:**
    - Moved as a whole (a drag, the inspector's start, a shift, a copy), they go with it.
    - At a new speed of its clip, they stretch with it from its start.
    - With an edge moved, they stay where they are in the take; those outside go, and a later start starts where the path was then.
    - Their rects stay on the screen. Any of these edits makes the zoom the person's (its tag goes).

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/{schema,index}.ts` | `moves`, the `caret` event |
| `packages/timeline/src/{zoom,frame,index}.ts` | the path in time |
| `packages/recorder/src/{types,events,win32,input}.ts` | the caret, read while typing |
| `packages/core/src/suggest/typing.ts` (new), `region.ts`, `media.ts`, `suggest.ts`, `suggest/plan.ts`, `speech/edits.ts`, `index.ts` | the typing zooms |
| `apps/cli/src/main.ts` | `--no-typing-zooms` |
| `apps/desktop/src/shared/{document,edit,timeline-model}.ts`, `src/renderer/editor/{Timeline,SourceView,Inspector}.tsx`, `editor.css` | the path in the editor |
| `skill/cuttle/{SKILL,project}.md` | typing zooms and `moves` for Claude |

---

### Task 1: The format

**Files:**
- Modify: `packages/project/src/{schema,index}.ts`, `packages/project/test/{schema,events}.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p4-m4a`; work there:

```bash
git switch p4-m4a
```

- [ ] **Step 2: Write the failing tests**

In `packages/project/test/schema.test.ts`, replace:

```ts

  it('rejects zero-sized rects and a speed of zero', () => {
    expect(pathsOf({ ...minimal, zooms: [{ at: 0, duration: 1, rect: [0, 0, 0, 10] }] })).toContain('zooms.0.rect.2');
    expect(pathsOf({ ...minimal, scenes: [{ type: 'clip', from: 0, to: 1, speed: 0 }] })).toContain('scenes.0.speed');
  });
```

with:

```ts

  it('rejects zero-sized rects and a speed of zero', () => {
    expect(pathsOf({ ...minimal, zooms: [{ at: 0, duration: 1, rect: [0, 0, 0, 10] }] })).toContain('zooms.0.rect.2');
  });

  it('takes a zoom that follows: its moves come in time order, inside the zoom', () => {
    const zoom = { at: 2, duration: 4, rect: [0, 0, 800, 450] };
    const moves = [{ at: 3, rect: [100, 0, 800, 450] }, { at: 4.5, rect: [100, 200, 800, 450] }];
    expect(ProjectSchema.parse({ ...minimal, zooms: [{ ...zoom, moves }] }).zooms[0]!.moves).toEqual(moves);
    expect(pathsOf({ ...minimal, zooms: [{ ...zoom, moves: [{ at: 2, rect: [0, 0, 8, 4] }] }] })).toEqual(['zooms.0.moves.0.at']);
    expect(pathsOf({ ...minimal, zooms: [{ ...zoom, moves: [moves[1], moves[0]] }] })).toEqual(['zooms.0.moves.1.at']);
    expect(pathsOf({ ...minimal, zooms: [{ ...zoom, moves: [{ at: 6, rect: [0, 0, 8, 4] }] }] })).toEqual(['zooms.0.moves.0.at']);
    expect(pathsOf({ ...minimal, zooms: [{ ...zoom, moves: [{ at: 3, rect: [0, 0, 0, 4] }] }] })).toEqual(['zooms.0.moves.0.rect.2']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'clip', from: 0, to: 1, speed: 0 }] })).toContain('scenes.0.speed');
  });
```

In `packages/project/test/events.test.ts`, replace:

```ts
    expect(result.issues.map((issue) => issue.path)).toEqual(['line 2', 'line 3.t']);
  });

  it('accepts Windows line endings and a last line without a newline', () => {
    const text = '{"t":0,"type":"keys","count":1}\r\n{"t":1,"type":"shape","shape":"text"}';
    expect(parseEventsJsonl(text).events).toEqual([
```

with:

```ts
    expect(result.issues.map((issue) => issue.path)).toEqual(['line 2', 'line 3.t']);
  });

  it('reads where text is typed: the caret', () => {
    expect(parseEventsJsonl('{"t":1.5,"type":"caret","rect":[812,440,2,19]}\n').events).toEqual([{ t: 1.5, type: 'caret', rect: [812, 440, 2, 19] }]);
    expect(parseEventsJsonl('{"t":1.5,"type":"caret","x":812,"y":440}\n').issues.map((issue) => issue.path)).toEqual(['line 1.rect', 'line 1']);
  });

  it('accepts Windows line endings and a last line without a newline', () => {
    const text = '{"t":0,"type":"keys","count":1}\r\n{"t":1,"type":"shape","shape":"text"}';
    expect(parseEventsJsonl(text).events).toEqual([
```

Run: `pnpm exec vitest run --project node packages/project/test/schema.test.ts packages/project/test/events.test.ts`
Expected: FAIL: `moves` is an unknown field, and `caret` an unknown event.

- [ ] **Step 3: `moves` and `caret`**

In `packages/project/src/schema.ts`, replace:

```ts

const SceneSchema = z.discriminatedUnion('type', [ClipSceneSchema, StillSceneSchema, CardSceneSchema]);

const ZoomSchema = z.strictObject({
  ...named,
  at: seconds,
  duration: positiveSeconds,
  rect: RectSchema,
  ease: z.enum(EASES).default('smooth'),
  enabled: z.boolean().default(true),
  auto: autoKind,
});

const MaskSchema = z
  .strictObject({
```

with:

```ts

const SceneSchema = z.discriminatedUnion('type', [ClipSceneSchema, StillSceneSchema, CardSceneSchema]);

/** A point on a zoom's path: from `at` (source seconds) the zoom shows `rect`. */
const ZoomMoveSchema = z.strictObject({ at: seconds, rect: RectSchema });

const ZoomSchema = z
  .strictObject({
    ...named,
    at: seconds,
    duration: positiveSeconds,
    rect: RectSchema,
    /** A zoom that follows (typing): from `rect` it moves to each move's rect in turn. */
    moves: z.array(ZoomMoveSchema).optional(),
    ease: z.enum(EASES).default('smooth'),
    enabled: z.boolean().default(true),
    auto: autoKind,
  })
  .superRefine((zoom, ctx) => {
    let previous = zoom.at;
    (zoom.moves ?? []).forEach((move, index) => {
      if (!(move.at > previous)) ctx.addIssue({ code: 'custom', message: index === 0 ? 'a move must come after the zoom starts ("at")' : 'moves must be in time order', path: ['moves', index, 'at'] });
      else if (!(move.at < zoom.at + zoom.duration)) ctx.addIssue({ code: 'custom', message: 'a move must come before the zoom ends ("at" + "duration")', path: ['moves', index, 'at'] });
      previous = move.at;
    });
  });

const MaskSchema = z
  .strictObject({
```

In the same file, replace:

```ts
  z.strictObject({ type: z.literal('scroll'), ...point, dx: z.number(), dy: z.number() }),
  z.strictObject({ type: z.literal('shape'), t: seconds, shape: z.enum(CURSOR_SHAPES) }),
  z.strictObject({ type: z.literal('keys'), t: seconds, count: z.number().int().positive() }),
]);

export type InputEvent = z.output<typeof InputEventSchema>;
```

with:

```ts
  z.strictObject({ type: z.literal('scroll'), ...point, dx: z.number(), dy: z.number() }),
  z.strictObject({ type: z.literal('shape'), t: seconds, shape: z.enum(CURSOR_SHAPES) }),
  z.strictObject({ type: z.literal('keys'), t: seconds, count: z.number().int().positive() }),
  // where text is typed: the system caret, where the app keeps one (a fact, not input)
  z.strictObject({ type: z.literal('caret'), t: seconds, rect: RectSchema }),
]);

export type InputEvent = z.output<typeof InputEventSchema>;
```

In the same file, replace:

```ts
export type StillScene = Extract<Scene, { type: 'still' }>;
export type CardScene = Extract<Scene, { type: 'card' }>;
export type Zoom = CuttleProject['zooms'][number];
export type Mask = CuttleProject['masks'][number];
export type TextOverlay = CuttleProject['texts'][number];
export type Cut = CuttleProject['cuts'][number];
```

with:

```ts
export type StillScene = Extract<Scene, { type: 'still' }>;
export type CardScene = Extract<Scene, { type: 'card' }>;
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type Mask = CuttleProject['masks'][number];
export type TextOverlay = CuttleProject['texts'][number];
export type Cut = CuttleProject['cuts'][number];
```

In `packages/project/src/index.ts`, replace:

```ts
  type TextPosition,
  type TextStyle,
  type Zoom,
} from './schema';
export { formatPath, parseProject, parseProjectJson, type ParseResult, type ProjectIssue } from './parse';
export { defaultProject } from './defaults';
```

with:

```ts
  type TextPosition,
  type TextStyle,
  type Zoom,
  type ZoomMove,
} from './schema';
export { formatPath, parseProject, parseProjectJson, type ParseResult, type ProjectIssue } from './parse';
export { defaultProject } from './defaults';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/project`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project
git commit -m "project: a zoom's moves (a zoom that follows), and the caret event

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The path in time

**Files:**
- Modify: `packages/timeline/src/{zoom,frame,index}.ts`, `packages/timeline/test/{zoom,frame}.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/timeline/test/zoom.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import type { Rect, Zoom } from '@cuttle/project';
import { fitZoomRect, zoomRectAt } from '../src/zoom';

const full: Rect = [0, 0, 2560, 1440];
const zoom = (at: number, duration: number, rect: Rect, extra: Partial<Zoom> = {}): Zoom => ({
  at, duration, rect, ease: 'smooth', enabled: true, ...extra,
});
const half: Rect = [0, 0, 1280, 720];
/** Every zoom fully in (between its ramps). */
const full1 = (): number => 1;
```

with:

```ts
import { describe, expect, it } from 'vitest';
import type { Rect, Zoom } from '@cuttle/project';
import { fitZoomRect, zoomRectAt, zoomTargetAt } from '../src/zoom';

const full: Rect = [0, 0, 2560, 1440];
const zoom = (at: number, duration: number, rect: Rect, extra: Partial<Zoom> = {}): Zoom => ({
  at, duration, rect, ease: 'smooth', enabled: true, ...extra,
});
const half: Rect = [0, 0, 1280, 720];
/** A rect to 6 decimals (halfway along a move is not exact). */
const near = (rect: Rect) => rect.map((value) => expect.closeTo(value, 6));
/** Every zoom fully in (between its ramps). */
const full1 = (): number => 1;
```

In the same file, replace:

```ts
    const result = zoomRectAt([zoom(12, 4, tall)], 14, full1, full);
    expect(result[2] / result[3]).toBeCloseTo(16 / 9, 6);
  });
});

describe('fitZoomRect', () => {
```

with:

```ts
    const result = zoomRectAt([zoom(12, 4, tall)], 14, full1, full);
    expect(result[2] / result[3]).toBeCloseTo(16 / 9, 6);
  });

  it('follows a zoom along its moves', () => {
    const right: Rect = [1280, 0, 1280, 720];
    const following = zoom(12, 6, half, { moves: [{ at: 14, rect: right }] });
    expect(zoomRectAt([following], 13, full1, full)).toEqual(half);
    expect(zoomRectAt([following], 14, full1, full)).toEqual(near([640, 0, 1280, 720]));
    expect(zoomRectAt([following], 15, full1, full)).toEqual(right);
    // at 8× the move takes 8 times as many source seconds (4.8): halfway at the move, not there a second later
    expect(zoomRectAt([following], 14, full1, full, 8)).toEqual(near([640, 0, 1280, 720]));
    expect(zoomRectAt([following], 15, full1, full, 8)[0]).toBeCloseTo(1152.96, 1);
  });
});

describe('zoomTargetAt', () => {
  const a: Rect = [0, 0, 800, 450];
  const b: Rect = [400, 0, 800, 450];
  const c: Rect = [400, 300, 800, 450];

  it('eases from one rect to the next over 0.6 s centred on each move', () => {
    const path = { rect: a, moves: [{ at: 2, rect: b }, { at: 4, rect: c }] };
    expect(zoomTargetAt(path, 1.7)).toEqual(a);
    // a quarter of the time in, the smooth curve is 1/16 of the way: 25 of 400 px
    expect(zoomTargetAt(path, 1.85)[0]).toBeCloseTo(25, 6);
    expect(zoomTargetAt(path, 2)).toEqual(near([200, 0, 800, 450]));
    expect(zoomTargetAt(path, 2.3)).toEqual(b);
    expect(zoomTargetAt(path, 3.7)).toEqual(b);
    expect(zoomTargetAt(path, 4.3)).toEqual(c);
    expect(zoomTargetAt({ rect: a }, 3)).toBe(a);
  });

  it('blends moves closer than 0.6 s without a jump', () => {
    const path = { rect: a, moves: [{ at: 2, rect: b }, { at: 2.2, rect: c }] };
    let previous = zoomTargetAt(path, 1.6);
    for (let t = 1.6; t <= 2.6; t += 0.01) {
      const now = zoomTargetAt(path, t);
      expect(Math.abs(now[0] - previous[0]) + Math.abs(now[1] - previous[1])).toBeLessThan(25);
      previous = now;
    }
    expect(previous).toEqual(c);
  });
});

describe('fitZoomRect', () => {
```

In `packages/timeline/test/frame.test.ts`, replace:

```ts
    }
  });

  it('lands fully zoomed where a cut jumps into the middle of a zoom', () => {
    // the zoom is source 10–16; the second clip starts at 12, inside it
    const timeline = createTimeline(
```

with:

```ts
    }
  });

  it('moves a zoom that follows in output time, at the clip\'s speed', () => {
    const scenes = [{ type: 'clip', from: 0, to: 20 }];
    const zooms = [{ at: 2, duration: 8, rect: zoomRect, moves: [{ at: 6, rect: [1280, 720, 1280, 720] }] }];
    const timeline = createTimeline(project(look, { scenes, zooms, masks: [], texts: [] }), { screenSize });
    expect(timeline.frameAt(5.5).layers[0]?.zoom).toEqual(zoomRect);
    expect(timeline.frameAt(6).layers[0]?.zoom?.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([640, 360, 1280, 720]);
    expect(timeline.frameAt(6.5).layers[0]?.zoom).toEqual([1280, 720, 1280, 720]);
  });

  it('lands fully zoomed where a cut jumps into the middle of a zoom', () => {
    // the zoom is source 10–16; the second clip starts at 12, inside it
    const timeline = createTimeline(
```

Run: `pnpm exec vitest run --project node packages/timeline/test/zoom.test.ts packages/timeline/test/frame.test.ts`
Expected: FAIL: `zoomTargetAt` does not exist, and the zoom holds its rect.

- [ ] **Step 2: `zoomTargetAt`**

In `packages/timeline/src/zoom.ts`, replace:

```ts
import type { Rect, Zoom } from '@cuttle/project';
import { clamp, lerpRect } from './easing';

/** Length of a zoom's ramps in output seconds (see `rampAmount`). */
export const ZOOM_RAMP_SECONDS = 0.6;

/** Grows `rect` around its centre to the aspect ratio of `full`, shrinks it to fit inside `full`, then shifts it inside `full`. Source pixels. */
export function fitZoomRect(rect: Rect, full: Rect): Rect {
```

with:

```ts
import type { Rect, Zoom } from '@cuttle/project';
import { clamp, ease, lerpRect } from './easing';

/** Length of a zoom's ramps in output seconds (see `rampAmount`). */
export const ZOOM_RAMP_SECONDS = 0.6;
/** How long a zoom that follows takes from one rect of its path to the next: output seconds, centred on the move. */
export const ZOOM_MOVE_SECONDS = 0.6;

/** Grows `rect` around its centre to the aspect ratio of `full`, shrinks it to fit inside `full`, then shifts it inside `full`. Source pixels. */
export function fitZoomRect(rect: Rect, full: Rect): Rect {
```

In the same file, replace:

```ts
  return [x, y, w, h];
}

/**
 * Crop rect at `sourceTime` (source seconds): the enabled zooms whose range contains it fold in
 * `at` order, each `amountOf(zoom)` (0 to 1, its ramp) of the way from the rect before it to its
 * own. `full` is the screen rect in source pixels; the result is a new array.
 */
export function zoomRectAt(zooms: readonly Zoom[], sourceTime: number, amountOf: (zoom: Zoom) => number, full: Rect): Rect {
  const active = zooms
    .filter((zoom) => zoom.enabled && sourceTime >= zoom.at && sourceTime < zoom.at + zoom.duration)
    .sort((a, b) => a.at - b.at);

  let rect: Rect = [...full];
  for (const zoom of active) rect = lerpRect(rect, fitZoomRect(zoom.rect, full), amountOf(zoom));
  return rect;
}
```

with:

```ts
  return [x, y, w, h];
}

/**
 * Where a zoom aims at `sourceTime` (source seconds): its `rect`, then each move's rect in turn,
 * eased over `ZOOM_MOVE_SECONDS` output seconds centred on the move (`speed`: the clip's, which
 * turns them into source seconds). Moves closer than that blend into one another without a jump.
 */
export function zoomTargetAt(zoom: Pick<Zoom, 'rect' | 'moves'>, sourceTime: number, speed = 1): Rect {
  const half = (ZOOM_MOVE_SECONDS / 2) * speed;
  let rect = zoom.rect;
  for (const move of zoom.moves ?? []) {
    if (sourceTime <= move.at - half) break;
    rect = lerpRect(rect, move.rect, ease('smooth', (sourceTime - (move.at - half)) / (2 * half)));
  }
  return rect;
}

/**
 * Crop rect at `sourceTime` (source seconds): the enabled zooms whose range contains it fold in
 * `at` order, each `amountOf(zoom)` (0 to 1, its ramp) of the way from the rect before it to where
 * it aims then. `full` is the screen rect in source pixels, `speed` the clip's; the result is a
 * new array.
 */
export function zoomRectAt(zooms: readonly Zoom[], sourceTime: number, amountOf: (zoom: Zoom) => number, full: Rect, speed = 1): Rect {
  const active = zooms
    .filter((zoom) => zoom.enabled && sourceTime >= zoom.at && sourceTime < zoom.at + zoom.duration)
    .sort((a, b) => a.at - b.at);

  let rect: Rect = [...full];
  for (const zoom of active) rect = lerpRect(rect, fitZoomRect(zoomTargetAt(zoom, sourceTime, speed), full), amountOf(zoom));
  return rect;
}
```

In `packages/timeline/src/frame.ts`, replace:

```ts
      ...base,
      kind: 'clip',
      sourceTime,
      zoom: zoomRectAt(project.zooms, sourceTime, (zoom) => amount(zoomShown.get(zoom), ZOOM_RAMP_SECONDS, zoom.ease), screen),
      aspect: screen[2] / screen[3],
      masks: activeMasks(project.masks, sourceTime),
      texts: activeTexts(project.texts, sourceTime, (text) => amount(textShown.get(text), TEXT_FADE_SECONDS, 'linear')),
```

with:

```ts
      ...base,
      kind: 'clip',
      sourceTime,
      zoom: zoomRectAt(project.zooms, sourceTime, (zoom) => amount(zoomShown.get(zoom), ZOOM_RAMP_SECONDS, zoom.ease), screen, scene.speed),
      aspect: screen[2] / screen[3],
      masks: activeMasks(project.masks, sourceTime),
      texts: activeTexts(project.texts, sourceTime, (text) => amount(textShown.get(text), TEXT_FADE_SECONDS, 'linear')),
```

In `packages/timeline/src/index.ts`, replace:

```ts
  type SceneSpan,
} from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
```

with:

```ts
  type SceneSpan,
} from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { ZOOM_MOVE_SECONDS, ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt, zoomTargetAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/timeline`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/timeline
git commit -m "timeline: a zoom eases along its moves, 0.6 output seconds each

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The caret

**Files:**
- Modify: `packages/recorder/src/{types,events,win32,input}.ts`, `packages/recorder/test/{events,win32,input}.test.ts`

- [ ] **Step 1: Write the failing tests**

The Win32 check makes a caret of its own thread in a window that is never shown:

In `packages/recorder/test/win32.test.ts`, replace:

```ts
import { CURSOR_SHAPES } from '@cuttle/project';
import { SHELL_CLASSES, loadWin32 } from '../src/win32';

describe.runIf(process.platform === 'win32')('win32', () => {
  it('loads once per module and reads the pointer', async () => {
    const win = await loadWin32();
```

with:

```ts
import { CURSOR_SHAPES } from '@cuttle/project';
import { SHELL_CLASSES, loadWin32 } from '../src/win32';

/**
 * A caret of this thread in a window that is never shown (`WS_POPUP` without `WS_VISIBLE`): where
 * `GetGUIThreadInfo` finds it. Calls `check` with the thread's id, then cleans up.
 */
async function withCaret(window: { x: number; y: number }, caret: { x: number; y: number; width: number; height: number }, check: (thread: number) => void): Promise<void> {
  const { default: koffi } = await import('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const CreateWindowExW = user32.func('__stdcall', 'CreateWindowExW', 'void *', ['uint32', 'str16', 'str16', 'uint32', 'int', 'int', 'int', 'int', 'void *', 'void *', 'void *', 'void *']);
  const DestroyWindow = user32.func('__stdcall', 'DestroyWindow', 'int', ['void *']);
  const CreateCaret = user32.func('__stdcall', 'CreateCaret', 'int', ['void *', 'void *', 'int', 'int']);
  const SetCaretPos = user32.func('__stdcall', 'SetCaretPos', 'int', ['int', 'int']);
  const DestroyCaret = user32.func('__stdcall', 'DestroyCaret', 'int', []);
  const GetCurrentThreadId = kernel32.func('__stdcall', 'GetCurrentThreadId', 'uint32', []);
  const WS_POPUP = 0x80000000;
  const hwnd = CreateWindowExW(0, 'STATIC', 'cuttle caret check', WS_POPUP, window.x, window.y, 400, 200, null, null, null, null);
  expect(hwnd).not.toBeNull();
  try {
    expect(CreateCaret(hwnd, null, caret.width, caret.height)).not.toBe(0);
    SetCaretPos(caret.x, caret.y);
    check(GetCurrentThreadId());
  } finally {
    DestroyCaret();
    DestroyWindow(hwnd);
  }
}

describe.runIf(process.platform === 'win32')('win32', () => {
  it('loads once per module and reads the pointer', async () => {
    const win = await loadWin32();
```

In the same file, replace:

```ts
    expect(inside.length).toBe(1);
  });

  it('lists windows with a title and a size on a listed monitor', async () => {
    const win = await loadWin32();
    const monitors = win.monitors();
```

with:

```ts
    expect(inside.length).toBe(1);
  });

  it('reads a thread\'s caret in desktop pixels, and none where there is none', async () => {
    const win = await loadWin32();
    await withCaret({ x: 120, y: 80 }, { x: 30, y: 44, width: 2, height: 18 }, (thread) => {
      expect(win.caret(thread)).toEqual({ x: 150, y: 124, width: 2, height: 18 });
    });
    // this thread has no caret any more
    const { default: koffi } = await import('koffi');
    const thread = koffi.load('kernel32.dll').func('__stdcall', 'GetCurrentThreadId', 'uint32', [])() as number;
    expect(win.caret(thread)).toBeUndefined();
  });

  it('lists windows with a title and a size on a listed monitor', async () => {
    const win = await loadWin32();
    const monitors = win.monitors();
```

In `packages/recorder/test/events.test.ts`, replace:

```ts
    ]);
  });

  it('ignores input after close (the hook can deliver one more event)', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
```

with:

```ts
    ]);
  });

  it('writes the caret as a rect in the screen track', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
    events.push({ type: 'caret', time: 1001.5, x: 900, y: 450, width: 2, height: 19 });
    expect(read()).toEqual([{ t: 1.5, type: 'caret', rect: [800, 400, 2, 19] }]);
  });

  it('ignores input after close (the hook can deliver one more event)', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
```

In `packages/recorder/test/input.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { keyHandler, wheelInput } from '../src/input';
import type { HotkeyAction, RawInput } from '../src/types';

// Key codes as uiohook reports them: Ctrl 29, Shift 42, Alt 56, S 31, M 50, A 30.
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { caretWatch, keyHandler, wheelInput } from '../src/input';
import type { HotkeyAction, RawInput } from '../src/types';

// Key codes as uiohook reports them: Ctrl 29, Shift 42, Alt 56, S 31, M 50, A 30.
```

In the same file, replace:

```ts
  });
});

describe('wheelInput', () => {
  const VERTICAL = 3;
  const HORIZONTAL = 4;
```

with:

```ts
  });
});

describe('caretWatch', () => {
  it('reads the caret 5 times a second while keys come, and passes it on when it moved', () => {
    const seen: RawInput[] = [];
    let at = { x: 10, y: 20, width: 2, height: 18 };
    let reads = 0;
    const tick = caretWatch(() => (reads++, at), (input) => seen.push(input));
    // 30 reads a second: every 6th looks at the caret, while the last key is under a second old
    for (let i = 1; i <= 12; i++) tick(100 + i / 30, 100);
    expect(reads).toBe(2);
    expect(seen).toEqual([{ type: 'caret', time: 100 + 6 / 30, x: 10, y: 20, width: 2, height: 18 }]);
    at = { ...at, x: 30 };
    for (let i = 13; i <= 18; i++) tick(100 + i / 30, 100);
    expect(seen.at(-1)).toMatchObject({ x: 30 });
    // no key for over a second: no reads
    for (let i = 19; i <= 60; i++) tick(101.5 + i / 30, 100);
    expect(reads).toBe(3);
  });

  it('passes nothing where the app keeps no caret', () => {
    const seen: RawInput[] = [];
    const tick = caretWatch(() => undefined, (input) => seen.push(input));
    for (let i = 1; i <= 30; i++) tick(100 + i / 30, 100);
    expect(seen).toEqual([]);
  });
});

describe('wheelInput', () => {
  const VERTICAL = 3;
  const HORIZONTAL = 4;
```

Run: `pnpm exec vitest run --project node packages/recorder/test/win32.test.ts packages/recorder/test/events.test.ts packages/recorder/test/input.test.ts`
Expected: FAIL: `win.caret` and `caretWatch` do not exist, and the caret is not written.

- [ ] **Step 2: Read it, while typing**

In `packages/recorder/src/types.ts`, replace:

```ts
  | { type: 'click'; time: number; x: number; y: number; button: 'left' | 'right' | 'middle' }
  | { type: 'scroll'; time: number; x: number; y: number; dx: number; dy: number }
  | { type: 'shape'; time: number; shape: CursorShape }
  | { type: 'key'; time: number };

export type HotkeyAction = 'stop' | 'marker' | 'pause' | 'retake';
```

with:

```ts
  | { type: 'click'; time: number; x: number; y: number; button: 'left' | 'right' | 'middle' }
  | { type: 'scroll'; time: number; x: number; y: number; dx: number; dy: number }
  | { type: 'shape'; time: number; shape: CursorShape }
  | { type: 'key'; time: number }
  /** The system caret (where text is typed), where the app keeps one. */
  | { type: 'caret'; time: number; x: number; y: number; width: number; height: number };

export type HotkeyAction = 'stop' | 'marker' | 'pause' | 'retake';
```

In `packages/recorder/src/events.ts`, replace:

```ts
      case 'shape':
        this.flushMove();
        return this.emit({ t: at, type: 'shape', shape: input.shape });
      case 'key': {
        const window = Math.floor(t / KEY_WINDOW);
        if (this.keys?.window === window) {
```

with:

```ts
      case 'shape':
        this.flushMove();
        return this.emit({ t: at, type: 'shape', shape: input.shape });
      case 'caret':
        this.flushMove();
        return this.emit({ t: at, type: 'caret', rect: [x, y, input.width, input.height] });
      case 'key': {
        const window = Math.floor(t / KEY_WINDOW);
        if (this.keys?.window === window) {
```

In `packages/recorder/src/win32.ts`, replace:

```ts
// Windows APIs through koffi: monitors in ddagrab order, windows, pointer position and shape.
import type { CursorShape } from '@cuttle/project';
import type { Monitor, WindowInfo } from './types';
```

with:

```ts
// Windows APIs through koffi: monitors in ddagrab order, windows, pointer position and shape, the caret.
import type { CursorShape } from '@cuttle/project';
import type { Monitor, WindowInfo } from './types';
```

In the same file, replace:

```ts
  /** Brings a window (`WindowInfo.id`) to the front; false when it is gone or Windows refused. */
  focus(id: number): boolean;
  cursorShape(): CursorShape;
}

let loaded: Promise<Win32> | undefined;
```

with:

```ts
  /** Brings a window (`WindowInfo.id`) to the front; false when it is gone or Windows refused. */
  focus(id: number): boolean;
  cursorShape(): CursorShape;
  /**
   * The system caret of a thread (the foreground's when 0) in physical desktop pixels, at least 1 px
   * each way; undefined where the app keeps none (many draw their own).
   */
  caret(thread?: number): { x: number; y: number; width: number; height: number } | undefined;
}

let loaded: Promise<Win32> | undefined;
```

In the same file, replace:

```ts
  const RECT = koffi.struct(typeName('RECT'), { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  const POINT = koffi.struct(typeName('POINT'), { x: 'int32', y: 'int32' });
  const CURSORINFO = koffi.struct(typeName('CURSORINFO'), { cbSize: 'uint32', flags: 'uint32', hCursor: 'void *', ptScreenPos: POINT });
  const DXGI_OUTPUT_DESC = koffi.struct(typeName('DXGI_OUTPUT_DESC'), {
    DeviceName: koffi.array('uint16', 32),
    DesktopCoordinates: RECT,
```

with:

```ts
  const RECT = koffi.struct(typeName('RECT'), { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  const POINT = koffi.struct(typeName('POINT'), { x: 'int32', y: 'int32' });
  const CURSORINFO = koffi.struct(typeName('CURSORINFO'), { cbSize: 'uint32', flags: 'uint32', hCursor: 'void *', ptScreenPos: POINT });
  const GUITHREADINFO = koffi.struct(typeName('GUITHREADINFO'), {
    cbSize: 'uint32',
    flags: 'uint32',
    hwndActive: 'void *',
    hwndFocus: 'void *',
    hwndCapture: 'void *',
    hwndMenuOwner: 'void *',
    hwndMoveSize: 'void *',
    hwndCaret: 'void *',
    rcCaret: RECT,
  });
  const DXGI_OUTPUT_DESC = koffi.struct(typeName('DXGI_OUTPUT_DESC'), {
    DeviceName: koffi.array('uint16', 32),
    DesktopCoordinates: RECT,
```

In the same file, replace:

```ts
  // that was already made system-aware).
  const GetPhysicalCursorPos = user32.func('__stdcall', 'GetPhysicalCursorPos', 'int', [koffi.out(koffi.pointer(POINT))]);
  const GetCursorInfo = user32.func('__stdcall', 'GetCursorInfo', 'int', [koffi.inout(koffi.pointer(CURSORINFO))]);
  const LoadCursorW = user32.func('__stdcall', 'LoadCursorW', 'void *', ['void *', 'uintptr_t']);
  const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'int', [koffi.pointer(WNDENUMPROC), 'intptr_t']);
  const IsWindowVisible = user32.func('__stdcall', 'IsWindowVisible', 'int', ['void *']);
```

with:

```ts
  // that was already made system-aware).
  const GetPhysicalCursorPos = user32.func('__stdcall', 'GetPhysicalCursorPos', 'int', [koffi.out(koffi.pointer(POINT))]);
  const GetCursorInfo = user32.func('__stdcall', 'GetCursorInfo', 'int', [koffi.inout(koffi.pointer(CURSORINFO))]);
  const GetGUIThreadInfo = user32.func('__stdcall', 'GetGUIThreadInfo', 'int', ['uint32', koffi.inout(koffi.pointer(GUITHREADINFO))]);
  const ClientToScreen = user32.func('__stdcall', 'ClientToScreen', 'int', ['void *', koffi.inout(koffi.pointer(POINT))]);
  const LoadCursorW = user32.func('__stdcall', 'LoadCursorW', 'void *', ['void *', 'uintptr_t']);
  const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'int', [koffi.pointer(WNDENUMPROC), 'intptr_t']);
  const IsWindowVisible = user32.func('__stdcall', 'IsWindowVisible', 'int', ['void *']);
```

In the same file, replace:

```ts

  const point = { x: 0, y: 0 };
  const info = { cbSize: koffi.sizeof(CURSORINFO), flags: 0, hCursor: null as unknown, ptScreenPos: { x: 0, y: 0 } };
  return {
    monitors: () => outputs().map(({ monitor }) => monitor),
    windows,
```

with:

```ts

  const point = { x: 0, y: 0 };
  const info = { cbSize: koffi.sizeof(CURSORINFO), flags: 0, hCursor: null as unknown, ptScreenPos: { x: 0, y: 0 } };
  const rect = () => ({ left: 0, top: 0, right: 0, bottom: 0 });
  return {
    monitors: () => outputs().map(({ monitor }) => monitor),
    windows,
```

In the same file, replace:

```ts
      if (!GetCursorInfo(info) || info.hCursor === null) return 'arrow';
      return cursorShapes.get(koffi.address(info.hCursor)) ?? 'arrow';
    },
  };
}
```

with:

```ts
      if (!GetCursorInfo(info) || info.hCursor === null) return 'arrow';
      return cursorShapes.get(koffi.address(info.hCursor)) ?? 'arrow';
    },
    caret(thread = 0) {
      const gui = { cbSize: koffi.sizeof(GUITHREADINFO), flags: 0, hwndActive: null, hwndFocus: null, hwndCapture: null, hwndMenuOwner: null, hwndMoveSize: null, hwndCaret: null as unknown, rcCaret: rect() };
      if (!GetGUIThreadInfo(thread, gui) || !gui.hwndCaret) return undefined;
      // the caret's rect is in its window's client pixels
      const corner = { x: gui.rcCaret.left, y: gui.rcCaret.top };
      if (!ClientToScreen(gui.hwndCaret, corner)) return undefined;
      return { x: corner.x, y: corner.y, width: Math.max(1, gui.rcCaret.right - gui.rcCaret.left), height: Math.max(1, gui.rcCaret.bottom - gui.rcCaret.top) };
    },
  };
}
```

In `packages/recorder/src/input.ts`, replace:

```ts

/** How often the pointer shape is read (Windows has no event for it). */
const SHAPE_POLL_MS = 1000 / 30;
/** uiohook is one hook per process: it runs while at least one input source uses it. */
let hookUsers = 0;
```

with:

```ts

/** How often the pointer shape is read (Windows has no event for it). */
const SHAPE_POLL_MS = 1000 / 30;
/** The caret is read every this many shape reads (5 a second)… */
const CARET_EVERY = 6;
/** …while keys were typed in the last this many seconds. */
const CARET_AFTER_KEYS = 1;

type Caret = { x: number; y: number; width: number; height: number };

/**
 * Where text is typed, while it is: called on every shape read, it reads the caret every
 * `CARET_EVERY`th time while a key came in the last `CARET_AFTER_KEYS` seconds, and passes it on
 * when it moved.
 */
export function caretWatch(read: () => Caret | undefined, onInput: InputSink): (time: number, typedAt: number) => void {
  let reads = 0;
  let last = '';
  return (time, typedAt) => {
    if (++reads % CARET_EVERY !== 0 || time - typedAt > CARET_AFTER_KEYS) return;
    const caret = read();
    const key = caret ? `${caret.x},${caret.y},${caret.width},${caret.height}` : '';
    if (!caret || key === last) return;
    last = key;
    onInput({ type: 'caret', time, ...caret });
  };
}
/** uiohook is one hook per process: it runs while at least one input source uses it. */
let hookUsers = 0;
```

In the same file, replace:

```ts
    const scroll = wheelInput(event, WheelDirection.VERTICAL, now());
    if (scroll) onInput(scroll);
  };
  const onKeyDown = (event: KeyEvent) => keys.down(event);
  const onKeyUp = (event: KeyEvent) => keys.up(event);
  const detach = () => {
    uIOhook.off('mousemove', onMove);
```

with:

```ts
    const scroll = wheelInput(event, WheelDirection.VERTICAL, now());
    if (scroll) onInput(scroll);
  };
  let typedAt = -Infinity;
  const onKeyDown = (event: KeyEvent) => {
    typedAt = now();
    keys.down(event);
  };
  const onKeyUp = (event: KeyEvent) => keys.up(event);
  const detach = () => {
    uIOhook.off('mousemove', onMove);
```

In the same file, replace:

```ts
  hookUsers++;

  let stopped = false;
  const poll = setInterval(() => {
    const current = win.cursorShape();
    if (current === shape) return;
    shape = current;
    onInput({ type: 'shape', time: now(), shape });
  }, SHAPE_POLL_MS);

  return {
```

with:

```ts
  hookUsers++;

  let stopped = false;
  const caret = caretWatch(() => win.caret(), onInput);
  const poll = setInterval(() => {
    const current = win.cursorShape();
    if (current !== shape) {
      shape = current;
      onInput({ type: 'shape', time: now(), shape });
    }
    caret(now(), typedAt);
  }, SHAPE_POLL_MS);

  return {
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/recorder/test/win32.test.ts packages/recorder/test/events.test.ts packages/recorder/test/input.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/recorder
git commit -m "recorder: the caret (where text is typed), read 5 times a second while keys come

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Typing zooms

**Files:**
- Create: `packages/core/src/suggest/typing.ts`, `packages/core/test/typing.test.ts`
- Modify: `packages/core/src/suggest/{region,media,plan}.ts`, `packages/core/src/{suggest,index}.ts`, `packages/core/src/speech/edits.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/typing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { InputEvent } from '@cuttle/project';
import type { ClipSpan } from '@cuttle/timeline';
import { keyBursts, screenStretches, typingZooms, type ScreenChange, type TypingInput } from '../src/suggest/typing';

const keys = (from: number, to: number, step = 0.5): InputEvent[] => {
  const events: InputEvent[] = [];
  for (let t = from; t < to - 1e-9; t += step) events.push({ t: Math.round(t * 1000) / 1000, type: 'keys', count: 2 });
  return events;
};
/** The caret moving right along a line, 50 px every half second from `x` at `from`. */
const typedLine = (from: number, count: number, x: number, y: number): InputEvent[] =>
  Array.from({ length: count }, (_, k) => ({ t: Math.round((from + 0.5 * k) * 1000) / 1000, type: 'caret', rect: [x + 50 * k, y, 2, 20] }));
const clip = (from: number, to: number, speed = 1, start = from): ClipSpan => ({ from, to, speed, start });
// a 1000×500 screen: the view is 450×225, the middle 60 % of it 270×135
const screen = { width: 1000, height: 500 };
const input = (over: Partial<TypingInput>): TypingInput => ({ events: [], clips: [clip(0, 30)], screen, avoid: [], changes: [], ...over });

describe('keyBursts', () => {
  it('makes one burst of keys with pauses under 1.5 s, joins bursts 3 s apart, and drops short ones', () => {
    const clips = [clip(0, 60)];
    expect(keyBursts([...keys(2, 5), ...keys(6.5, 8)], clips)).toEqual([{ clip: 0, from: 2, to: 8 }]);
    // 5 s apart: two bursts; 1 s of typing: none
    expect(keyBursts([...keys(2, 5), ...keys(10, 12), ...keys(20, 21)], clips)).toEqual([
      { clip: 0, from: 2, to: 5 },
      { clip: 0, from: 10, to: 12 },
    ]);
  });

  it('keeps bursts inside their clip, and leaves out sped-up waiting', () => {
    expect(keyBursts(keys(2, 8), [clip(0, 4), clip(4, 20)])).toEqual([
      { clip: 0, from: 2, to: 4 },
      { clip: 1, from: 4, to: 8 },
    ]);
    expect(keyBursts(keys(2, 8), [clip(0, 20, 4)])).toEqual([]);
  });
});

describe('typingZooms', () => {
  it('follows the caret: lead room to the right, and a move once the text leaves the middle', () => {
    // typing from 10 to 15 s; the caret's middle goes from x 101 to 551 on the line at y 250
    const events = [...keys(10, 15), ...typedLine(10.2, 10, 100, 240)];
    // the first second (x 101 to 201, middle 151) sits 35 % into the view: x 151 − 157.5 → 0 (the screen's edge)
    // at 13.2 s the caret (401) has left the middle (225 ± 135): the view moves so it is 35 % in again
    expect(typingZooms(input({ events }))).toEqual([
      { at: 9.3, duration: 6.9, rect: [0, 138, 450, 225], moves: [{ at: 13.2, rect: [244, 138, 450, 225] }], follows: 'caret' },
    ]);
  });

  it('goes back left and down for the next line, at most one move in 0.8 s', () => {
    const events = [...keys(10, 17), ...typedLine(10.2, 10, 100, 240), { t: 15.1, type: 'caret', rect: [100, 290, 2, 20] }, { t: 15.4, type: 'caret', rect: [150, 290, 2, 20] }] as InputEvent[];
    const [zoom] = typingZooms(input({ events }));
    expect(zoom?.moves).toEqual([
      { at: 13.2, rect: [244, 138, 450, 225] },
      // x 101 is left of the middle: the view goes back to the screen's edge, and centres on y 300
      { at: 15.1, rect: [0, 188, 450, 225] },
    ]);
  });

  it('follows what the screen changes where there is no caret, and leaves out a scroll', () => {
    const changes: ScreenChange[] = [
      ...Array.from({ length: 10 }, (_, k) => ({ t: 10.5 + 0.5 * k, box: { x: 80 + 50 * k, y: 240, width: 40, height: 20 } })),
      { t: 12.5, box: { x: 0, y: 0, width: 1000, height: 500 } },
    ];
    const [zoom] = typingZooms(input({ events: keys(10, 15), changes }));
    expect(zoom).toMatchObject({ at: 9.3, follows: 'screen', rect: [0, 138, 450, 225] });
    // the change's middle (x 100 + 50 k) leaves the middle at 13.5 s (x 400)
    expect(zoom?.moves).toEqual([{ at: 13.5, rect: [243, 138, 450, 225] }]);
  });

  it('makes none without anything to follow, over another zoom, near another zoom start, or in sped-up waiting', () => {
    expect(typingZooms(input({ events: keys(10, 15) }))).toEqual([]);
    const events = [...keys(10, 15), ...typedLine(10.2, 10, 100, 240)];
    expect(typingZooms(input({ events, avoid: [{ at: 8, duration: 4 }] }))).toEqual([]);
    expect(typingZooms(input({ events, avoid: [{ at: 5, duration: 1 }] }))).toEqual([]);
    expect(typingZooms(input({ events, clips: [clip(0, 30, 4)] }))).toEqual([]);
    // a zoom after it: the typing zoom ends where it starts
    expect(typingZooms(input({ events, avoid: [{ at: 15.5, duration: 3 }] }))[0]).toMatchObject({ at: 9.3, duration: 6.2 });
  });

  it('reads the screen only around bursts without a caret on it', () => {
    const offScreen: InputEvent = { t: 21, type: 'caret', rect: [-400, 240, 2, 20] };
    const events = [...keys(10, 15), ...typedLine(10.2, 10, 100, 240), ...keys(20, 23), offScreen];
    expect(screenStretches(events, [clip(0, 30)], screen)).toEqual([{ from: 19.5, to: 23.5 }]);
  });
});
```

Run: `pnpm exec vitest run --project node packages/core/test/typing.test.ts`
Expected: FAIL: `../src/suggest/typing` does not exist.

- [ ] **Step 2: The planner**

`packages/core/src/suggest/typing.ts`:

```ts
// Zooms while typing: a burst of keys gets a zoom on where the text goes, and the zoom follows the
// text (`moves`) once it leaves the middle of the view, as a camera operator would. Where the app
// keeps a system caret (`caret` events), the zoom follows the caret; elsewhere it follows what the
// screen changes during the burst. Times are as people see them: output seconds, turned into source
// seconds at the clip's speed. Pure: `suggest` reads the screen's changes for it.
import type { InputEvent, Rect, ZoomMove } from '@cuttle/project';
import type { ClipSpan } from '@cuttle/timeline';

export const TYPING_RULES = {
  /** Key counts (half seconds) that start at most this far apart are one burst: a pause under 1.5 s (output s)… */
  burstGap: 2,
  /** …which lasts at least this long (output s). */
  minBurst: 1.5,
  /** Bursts this close in one clip make one zoom (output s). */
  joinGap: 3,
  /** The view shows this share of the screen's width (about 2.2×). */
  width: 0.45,
  /** The camera moves once what is typed leaves the middle this share of the view… */
  middle: 0.6,
  /** …so that it sits this far into the view from the left, with room for what comes next. */
  lead: 0.35,
  /** No move shorter than this share of the view… */
  minMove: 0.05,
  /** …and at most one in this many output seconds. */
  moveGap: 0.8,
  /** A change bigger than this share of the view either way is no typing (a scroll, a new page). */
  maxChange: 0.9,
  /** The zoom eases in this long before the first key… */
  before: 0.7,
  /** …and lasts until this long after the last one, at least `min` (output s). */
  after: 1.2,
  min: 1.8,
  /** Typing in clips faster than this is not zoomed (waiting sped up). */
  maxSpeed: 2,
  /** No zoom starts or ends this close to its clip's edge (output s). */
  edge: 1,
  /** At most one zoom starts in any this many output seconds (the zooms there count). */
  gap: 5,
};

/** A `keys` event counts the presses of half a second. */
const KEY_SLOT = 0.5;

/** What changed on the screen between two frames (screen pixels), at the later frame's time (source s). */
export interface ScreenChange {
  t: number;
  box: { x: number; y: number; width: number; height: number };
}

/** Where typing went on, inside one clip (source seconds). */
export interface Burst {
  clip: number;
  from: number;
  to: number;
}

export interface TypingZoom {
  at: number;
  duration: number;
  rect: Rect;
  /** Where the view goes as the text moves on (none while it stays in view). */
  moves: ZoomMove[];
  /** What it follows: the caret, or what the screen changed. */
  follows: 'caret' | 'screen';
}

export interface TypingInput {
  events: readonly InputEvent[];
  clips: readonly ClipSpan[];
  screen: { width: number; height: number };
  /** The zooms already there (the answer zoom, zooms made by hand): none of these overlaps one. */
  avoid: readonly { at: number; duration: number }[];
  /** What the screen changed during the bursts without a caret (`screenChanges`). */
  changes: readonly ScreenChange[];
}

/** The bursts of typing in `clips` at most `maxSpeed` fast, close ones joined; source seconds. */
export function keyBursts(events: readonly InputEvent[], clips: readonly ClipSpan[], rules = TYPING_RULES): Burst[] {
  const clipOf = (t: number) => clips.findIndex((clip) => t >= clip.from && t < clip.to);
  const keys = events
    .filter((event) => event.type === 'keys')
    .map((event) => ({ t: event.t, clip: clipOf(event.t) }))
    .filter((key) => key.clip >= 0 && clips[key.clip]!.speed <= rules.maxSpeed)
    .sort((a, b) => a.t - b.t);
  const bursts: Burst[] = [];
  for (const key of keys) {
    const clip = clips[key.clip]!;
    const end = Math.min(key.t + KEY_SLOT, clip.to);
    const last = bursts.at(-1);
    if (last && last.clip === key.clip && (key.t - (last.to - KEY_SLOT)) / clip.speed <= rules.burstGap) last.to = Math.max(last.to, end);
    else bursts.push({ clip: key.clip, from: key.t, to: end });
  }
  const joined: Burst[] = [];
  for (const burst of bursts.filter((one) => (one.to - one.from) / clips[one.clip]!.speed >= rules.minBurst)) {
    const last = joined.at(-1);
    if (last && last.clip === burst.clip && (burst.from - last.to) / clips[burst.clip]!.speed <= rules.joinGap) last.to = burst.to;
    else joined.push({ ...burst });
  }
  return joined;
}

interface Focus {
  t: number;
  x: number;
  y: number;
}

/** The view's size: `width` of the screen, in its shape. */
const viewOf = (screen: { width: number; height: number }, rules: typeof TYPING_RULES) => ({ width: rules.width * screen.width, height: rules.width * screen.height });

/** The stretch around a burst where the caret and the screen's changes count for it. */
const aroundOf = (burst: Burst) => ({ from: burst.from - KEY_SLOT, to: burst.to + KEY_SLOT });

/** The caret's middle during a burst, where it is on the screen. */
function caretsOf(burst: Burst, events: readonly InputEvent[], screen: { width: number; height: number }): Focus[] {
  const around = aroundOf(burst);
  return events
    .flatMap((event) => {
      if (event.type !== 'caret' || event.t <= around.from || event.t > around.to) return [];
      const [x, y, width, height] = event.rect;
      const point = { t: event.t, x: x + width / 2, y: y + height / 2 };
      return point.x >= 0 && point.y >= 0 && point.x < screen.width && point.y < screen.height ? [point] : [];
    })
    .sort((a, b) => a.t - b.t);
}

/** The stretches (source seconds) whose screen changes `typingZooms` needs: around the bursts without a caret on the screen. */
export function screenStretches(events: readonly InputEvent[], clips: readonly ClipSpan[], screen: { width: number; height: number }, rules = TYPING_RULES): { from: number; to: number }[] {
  return keyBursts(events, clips, rules)
    .filter((burst) => caretsOf(burst, events, screen).length === 0)
    .map(aroundOf);
}

/**
 * Where the text goes during a burst: the caret's middle where the app keeps one on the screen, else
 * what the screen changed (the newest end of a wide change: a shell draws the whole line anew).
 */
function focusOf(burst: Burst, input: TypingInput, rules: typeof TYPING_RULES): { points: Focus[]; follows: TypingZoom['follows'] } {
  const { screen } = input;
  const view = viewOf(screen, rules);
  const carets = caretsOf(burst, input.events, screen);
  if (carets.length > 0) return { points: carets, follows: 'caret' };
  const around = aroundOf(burst);
  const during = (t: number) => t > around.from && t <= around.to;
  const points = input.changes
    .filter((change) => during(change.t) && change.box.width <= rules.maxChange * view.width && change.box.height <= rules.maxChange * view.height)
    .map(({ t, box }) => ({ t, x: Math.max(box.x + box.width / 2, box.x + box.width - 0.1 * view.width), y: box.y + box.height / 2 }))
    .sort((a, b) => a.t - b.t);
  return { points, follows: 'screen' };
}

/**
 * The camera's path over the focus points: it starts with the first second's points `lead` into the
 * view, and moves (so the point is `lead` in again) whenever a point leaves the view's middle.
 */
function pathOf(points: readonly Focus[], speed: number, screen: { width: number; height: number }, rules: typeof TYPING_RULES): { rect: Rect; moves: ZoomMove[] } {
  const view = viewOf(screen, rules);
  const place = (x: number, y: number): Rect => [
    Math.round(Math.min(Math.max(x - rules.lead * view.width, 0), screen.width - view.width)),
    Math.round(Math.min(Math.max(y - view.height / 2, 0), screen.height - view.height)),
    Math.round(view.width),
    Math.round(view.height),
  ];
  const opening = points.filter((point) => point.t <= points[0]!.t + speed);
  const middleOf = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;
  const first = place(middleOf(opening.map((point) => point.x)), middleOf(opening.map((point) => point.y)));
  let rect = first;
  const moves: ZoomMove[] = [];
  let movedAt = -Infinity;
  for (const point of points) {
    const outside = Math.abs(point.x - (rect[0] + view.width / 2)) > (rules.middle / 2) * view.width || Math.abs(point.y - (rect[1] + view.height / 2)) > (rules.middle / 2) * view.height;
    if (!outside || (point.t - movedAt) / speed < rules.moveGap) continue;
    const next = place(point.x, point.y);
    // against the screen's edge the view cannot follow further
    if (Math.abs(next[0] - rect[0]) < rules.minMove * view.width && Math.abs(next[1] - rect[1]) < rules.minMove * view.height) continue;
    moves.push({ at: round(point.t), rect: next });
    rect = next;
    movedAt = point.t;
  }
  return { rect: first, moves };
}

/**
 * The zooms for the typing in `clips`, in source seconds and pixels: one per burst (close bursts
 * joined) that has somewhere to look, following the text. None overlaps a zoom of `avoid`, and they
 * count for the 5 output seconds between zoom starts.
 */
export function typingZooms(input: TypingInput, rules = TYPING_RULES): TypingZoom[] {
  const { clips, avoid } = input;
  const outputAt = (t: number, index: number) => clips[index]!.start + (t - clips[index]!.from) / clips[index]!.speed;
  const starts = avoid.flatMap((other) => {
    const index = clips.findIndex((clip) => other.at >= clip.from && other.at < clip.to);
    return index < 0 ? [] : [outputAt(other.at, index)];
  });
  const result: TypingZoom[] = [];
  let lastEnd = -Infinity;
  const bursts = keyBursts(input.events, clips, rules).sort((a, b) => outputAt(a.from, a.clip) - outputAt(b.from, b.clip));
  for (const burst of bursts) {
    const clip = clips[burst.clip]!;
    const s = clip.speed;
    const at = Math.max(burst.from - rules.before * s, clip.from + rules.edge * s);
    const next = Math.min(...avoid.filter((other) => other.at > burst.from).map((other) => other.at));
    const end = Math.min(Math.max(burst.to + rules.after * s, at + rules.min * s), clip.to - rules.edge * s, next);
    if ((end - at) / s < rules.min - 1e-9) continue;
    if (avoid.some((other) => at < other.at + other.duration && other.at < end)) continue;
    const start = outputAt(at, burst.clip);
    if (start < lastEnd || starts.some((other) => Math.abs(start - other) < rules.gap)) continue;
    const { points, follows } = focusOf(burst, input, rules);
    if (points.length === 0) continue;
    const { rect, moves } = pathOf(points, s, input.screen, rules);
    result.push({ at: round(at), duration: round(end - at), rect, moves: moves.filter((move) => move.at > at && move.at < end), follows });
    starts.push(start);
    lastEnd = outputAt(end, burst.clip);
  }
  return result;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
```

- [ ] **Step 3: The screen's changes, and the zooms in `suggest`**

In `packages/core/src/suggest/region.ts`, replace:

```ts
/** The box spans the changed pixels from this quantile to its complement, so stray pixels do not stretch it. */
const QUANTILE = 0.02;

/** The box (in the grey pictures' pixels) around what changed between `before` and `after`. */
export function changedRegion(before: Gray, after: Gray): { x: number; y: number; width: number; height: number } | undefined {
  if (before.width !== after.width || before.height !== after.height) return undefined;
  const xs: number[] = [];
  const ys: number[] = [];
```

with:

```ts
/** The box spans the changed pixels from this quantile to its complement, so stray pixels do not stretch it. */
const QUANTILE = 0.02;

/**
 * The box (in the grey pictures' pixels) around what changed between `before` and `after`; none
 * when fewer than `minPixels` changed (by default a share of the picture: a caret, a clock).
 */
export function changedRegion(before: Gray, after: Gray, minPixels = MIN_SHARE * before.width * before.height): { x: number; y: number; width: number; height: number } | undefined {
  if (before.width !== after.width || before.height !== after.height) return undefined;
  const xs: number[] = [];
  const ys: number[] = [];
```

In the same file, replace:

```ts
      }
    }
  }
  if (xs.length < MIN_SHARE * before.width * before.height) return undefined;
  const bounds = (values: number[]) => {
    values.sort((a, b) => a - b);
    const low = values[Math.floor(QUANTILE * (values.length - 1))]!;
```

with:

```ts
      }
    }
  }
  if (xs.length === 0 || xs.length < minPixels) return undefined;
  const bounds = (values: number[]) => {
    values.sort((a, b) => a - b);
    const low = values[Math.floor(QUANTILE * (values.length - 1))]!;
```

In `packages/core/src/suggest/media.ts`, replace:

```ts
  data: Uint8Array;
}

export async function grabGray(path: string, t: number, width: number): Promise<Gray> {
  const { stdout } = await runFfmpeg(['-ss', t.toFixed(3), '-i', path, '-frames:v', '1', '-vf', `scale=${width}:-2,format=gray`, '-f', 'rawvideo', '-']);
  return { width, height: Math.floor(stdout.length / width), data: new Uint8Array(stdout) };
```

with:

```ts
  data: Uint8Array;
}

/**
 * Grey pictures of the screen track from `from` to `to` (source seconds), `rate` a second, each
 * `width` × `height`, with its time.
 */
export async function grayFrames(path: string, from: number, to: number, rate: number, width: number, height: number): Promise<(Gray & { t: number })[]> {
  const { stdout } = await runFfmpeg(['-ss', from.toFixed(3), '-t', (to - from).toFixed(3), '-i', path, '-vf', `fps=${rate},scale=${width}:${height},format=gray`, '-f', 'rawvideo', '-']);
  const size = width * height;
  const frames: (Gray & { t: number })[] = [];
  for (let k = 0; (k + 1) * size <= stdout.length; k++) frames.push({ t: from + k / rate, width, height, data: new Uint8Array(stdout.buffer, stdout.byteOffset + k * size, size) });
  return frames;
}

export async function grabGray(path: string, t: number, width: number): Promise<Gray> {
  const { stdout } = await runFfmpeg(['-ss', t.toFixed(3), '-i', path, '-frames:v', '1', '-vf', `scale=${width}:-2,format=gray`, '-f', 'rawvideo', '-']);
  return { width, height: Math.floor(stdout.length / width), data: new Uint8Array(stdout) };
```

In `packages/core/src/suggest.ts`, replace:

```ts
import { clickZooms, sceneSpans, shownClicks } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
import { analyseScreen, grabGray } from './suggest/media';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { takeClock, transcriptMarkers } from './suggest/transcript';
import { readMarkers, speechActivity, withSpeechCuts, wordStretches } from './speech/apply';
import type { RawCut } from './speech/edits';
```

with:

```ts
import { clickZooms, sceneSpans, shownClicks } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
import { analyseScreen, grabGray, grayFrames } from './suggest/media';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { screenStretches, typingZooms, type ScreenChange } from './suggest/typing';
import { takeClock, transcriptMarkers } from './suggest/transcript';
import { readMarkers, speechActivity, withSpeechCuts, wordStretches } from './speech/apply';
import type { RawCut } from './speech/edits';
```

In the same file, replace:

```ts
  zoom?: boolean;
  /** Zooms that follow the clicks (default true; `zoom: false` turns them off too). */
  clickZooms?: boolean;
  /**
   * The mic's speech (default true): it is kept and never sped up, and the transcript's filler words
   * and pauses are cut where the picture rests.
```

with:

```ts
  zoom?: boolean;
  /** Zooms that follow the clicks (default true; `zoom: false` turns them off too). */
  clickZooms?: boolean;
  /** Zooms that follow typing (default true; `zoom: false` turns them off too). */
  typingZooms?: boolean;
  /**
   * The mic's speech (default true): it is kept and never sped up, and the transcript's filler words
   * and pauses are cut where the picture rests.
```

In the same file, replace:

```ts
/** The answer is compared with the screen this long before it. */
const ANSWER_LOOKBACK = 6;
const ZOOM_SECONDS = 4;

/**
 * Suggests scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
```

with:

```ts
/** The answer is compared with the screen this long before it. */
const ANSWER_LOOKBACK = 6;
const ZOOM_SECONDS = 4;
/** Typing is read at this rate and width: typed letters are a few pixels at this size. */
const TYPING_RATE = 2;
const TYPING_WIDTH = 640;
/** A change of fewer pixels is noise. */
const TYPING_MIN_PIXELS = 8;

/**
 * Suggests scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
```

In the same file, replace:

```ts
  }
  // The zooms suggest made before are replaced; the others stay, and the new ones avoid them.
  const rawZooms = (file.raw.zooms as SuggestedZoom[] | undefined) ?? [];
  const isOurs = (zoom: { auto?: string }) => zoom.auto === 'answer' || zoom.auto === 'click';
  const kept = rawZooms.filter((zoom) => !isOurs(zoom));
  const switchedOff = file.project.zooms.filter((zoom) => isOurs(zoom) && !zoom.enabled);
  if (kept.length > 0) notes.push(`kept ${kept.length} zoom${kept.length === 1 ? '' : 's'} made or changed by hand`);
  const zooms: SuggestedZoom[] = [];
  const add = (zoom: SuggestedZoom & { auto: 'answer' | 'click' }) => zooms.push(staysOff(zoom, switchedOff) ? { ...zoom, enabled: false } : zoom);
  const first = suggestion.clips[0];
  const last = suggestion.clips.at(-1);
  const keptOverlaps = (at: number, end: number) => kept.some((zoom) => at < zoom.at + zoom.duration && zoom.at < end);
```

with:

```ts
  }
  // The zooms suggest made before are replaced; the others stay, and the new ones avoid them.
  const rawZooms = (file.raw.zooms as SuggestedZoom[] | undefined) ?? [];
  const isOurs = (zoom: { auto?: string }) => zoom.auto === 'answer' || zoom.auto === 'typing' || zoom.auto === 'click';
  const kept = rawZooms.filter((zoom) => !isOurs(zoom));
  const switchedOff = file.project.zooms.filter((zoom) => isOurs(zoom) && !zoom.enabled);
  if (kept.length > 0) notes.push(`kept ${kept.length} zoom${kept.length === 1 ? '' : 's'} made or changed by hand`);
  const zooms: SuggestedZoom[] = [];
  const add = (zoom: SuggestedZoom & { auto: 'answer' | 'typing' | 'click' }) => zooms.push(staysOff(zoom, switchedOff) ? { ...zoom, enabled: false } : zoom);
  const first = suggestion.clips[0];
  const last = suggestion.clips.at(-1);
  const keptOverlaps = (at: number, end: number) => kept.some((zoom) => at < zoom.at + zoom.duration && zoom.at < end);
```

In the same file, replace:

```ts
      notes.push(region ? 'no zoom: most of the screen changed with the answer (add one by hand)' : 'no zoom: nothing changed around the answer');
    }
  }
  if (args.zoom !== false && args.clickZooms !== false && file.project.autoEdits.clickZooms && events.length > 0) {
    // where each clip piece starts in the output, with the cards and pages around the clips and the cuts counted
    const parsed = parseProject({ ...file.raw, scenes, ...(cuts && { cuts }), zooms: [] });
    const spans = parsed.ok ? sceneSpans(parsed.project.scenes, parsed.project.cuts) : [];
    const shown = spans.flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
    const there = [...kept, ...zooms];
    const followed = clickZooms(events, shown, screenInfo, there);
    // the clicks the zooms there do not show, less those the click zooms follow
```

with:

```ts
      notes.push(region ? 'no zoom: most of the screen changed with the answer (add one by hand)' : 'no zoom: nothing changed around the answer');
    }
  }
  // where each clip piece starts in the output, with the cards and pages around the clips and the cuts counted
  const parsed = parseProject({ ...file.raw, scenes, ...(cuts && { cuts }), zooms: [] });
  const spans = parsed.ok ? sceneSpans(parsed.project.scenes, parsed.project.cuts) : [];
  const shown = spans.flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
  if (args.zoom !== false && args.typingZooms !== false && file.project.autoEdits.typingZooms && events.some((event) => event.type === 'keys')) {
    // where the text goes: the caret, else what the screen changes while keys are typed
    const changes = await typingChanges(screen, screenStretches(events, shown, screenInfo), screenInfo);
    const typed = typingZooms({ events, clips: shown, screen: screenInfo, avoid: [...kept, ...zooms], changes });
    for (const zoom of typed) {
      add({ id: newId('zooms', taken), label: 'Typing', at: zoom.at, duration: zoom.duration, rect: zoom.rect, ...(zoom.moves.length > 0 && { moves: zoom.moves }), auto: 'typing' });
    }
    if (typed.length > 0) {
      const moves = typed.reduce((sum, zoom) => sum + zoom.moves.length, 0);
      const caret = typed.filter((zoom) => zoom.follows === 'caret').length;
      notes.push(
        `${typed.length} zoom${typed.length === 1 ? '' : 's'} while typing, ${moves} move${moves === 1 ? '' : 's'} following the text (${caret === typed.length ? 'the caret' : caret === 0 ? 'what the screen changed' : `the caret in ${caret}, the screen in the others`})`,
      );
    }
  }
  if (args.zoom !== false && args.clickZooms !== false && file.project.autoEdits.clickZooms && events.length > 0) {
    const there = [...kept, ...zooms];
    const followed = clickZooms(events, shown, screenInfo, there);
    // the clicks the zooms there do not show, less those the click zooms follow
```

In the same file, replace:

```ts
  });
}

/** A marker Claude Code's session made (not the person's own, nor the mistake key's). */
const fromClaude = (marker: Marker) => marker.kind === 'prompt' || marker.kind === 'tool' || marker.kind === 'answer';
```

with:

```ts
  });
}

/** What the screen changed in each stretch, frame by frame (`TYPING_RATE` a second), in screen pixels. */
async function typingChanges(screen: string, stretches: readonly { from: number; to: number }[], size: { width: number; height: number; duration: number }): Promise<ScreenChange[]> {
  const height = 2 * Math.round((TYPING_WIDTH * size.height) / size.width / 2);
  const scale = size.width / TYPING_WIDTH;
  const changes: ScreenChange[] = [];
  for (const stretch of stretches) {
    const from = Math.max(0, stretch.from);
    const to = Math.min(size.duration, stretch.to);
    if (!(to > from)) continue;
    const frames = await grayFrames(screen, from, to, TYPING_RATE, TYPING_WIDTH, height);
    for (let k = 1; k < frames.length; k++) {
      const box = changedRegion(frames[k - 1]!, frames[k]!, TYPING_MIN_PIXELS);
      if (box) changes.push({ t: frames[k]!.t, box: { x: box.x * scale, y: box.y * scale, width: box.width * scale, height: box.height * scale } });
    }
  }
  return changes;
}

/** A marker Claude Code's session made (not the person's own, nor the mistake key's). */
const fromClaude = (marker: Marker) => marker.kind === 'prompt' || marker.kind === 'tool' || marker.kind === 'answer';
```

In `packages/core/src/index.ts`, replace:

```ts
export { TRANSCRIPT_FILE, micOffset, readTranscript, transcribeTake, transcriptOfMic, type TranscribeOptions, type TranscribeResult } from './speech/transcribe';
export { applySpeechEdits, speechActivity, withSpeechCuts, wordStretches, type SpeechCutsInput, type SpeechCutsResult, type SpeechEditsResult } from './speech/apply';
export { RETAKE_RULES, retakeCuts, spokenCues, type RetakeCut, type RetakeInput, type SpokenCue } from './speech/retakes';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
```

with:

```ts
export { TRANSCRIPT_FILE, micOffset, readTranscript, transcribeTake, transcriptOfMic, type TranscribeOptions, type TranscribeResult } from './speech/transcribe';
export { applySpeechEdits, speechActivity, withSpeechCuts, wordStretches, type SpeechCutsInput, type SpeechCutsResult, type SpeechEditsResult } from './speech/apply';
export { RETAKE_RULES, retakeCuts, spokenCues, type RetakeCut, type RetakeInput, type SpokenCue } from './speech/retakes';
export { TYPING_RULES, keyBursts, screenStretches, typingZooms, type Burst, type ScreenChange, type TypingInput, type TypingZoom } from './suggest/typing';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
```

- [ ] **Step 4: The caret is no activity**

In `packages/core/src/suggest/plan.ts`, replace:

```ts
  const prompt = input.markers.find((marker) => marker.kind === 'prompt')?.t;
  const inputSpans = union(
    input.events
      .filter((event) => event.type !== 'shape')
      .map((event) => ({ from: Math.max(0, event.t - RULES.inputPad), to: Math.min(duration, event.t + RULES.inputPad) })),
  );
  // Claude's turn, from its first prompt or tool call to the answer, is never cut: it only waits on a
```

with:

```ts
  const prompt = input.markers.find((marker) => marker.kind === 'prompt')?.t;
  const inputSpans = union(
    input.events
      .filter((event) => event.type !== 'shape' && event.type !== 'caret')
      .map((event) => ({ from: Math.max(0, event.t - RULES.inputPad), to: Math.min(duration, event.t + RULES.inputPad) })),
  );
  // Claude's turn, from its first prompt or tool call to the answer, is never cut: it only waits on a
```

In `packages/core/src/speech/edits.ts`, replace:

```ts
  const spans: Span[] = [];
  let anchor: { x: number; y: number } | undefined;
  for (const event of events) {
    if (event.type === 'shape') continue;
    if (event.type === 'move') {
      if (anchor && Math.hypot(event.x - anchor.x, event.y - anchor.y) <= rules.pointerSlack) continue;
      const first = anchor === undefined;
```

with:

```ts
  const spans: Span[] = [];
  let anchor: { x: number; y: number } | undefined;
  for (const event of events) {
    // the pointer's shape and the caret are facts about the screen, not input
    if (event.type === 'shape' || event.type === 'caret') continue;
    if (event.type === 'move') {
      if (anchor && Math.hypot(event.x - anchor.x, event.y - anchor.y) <= rules.pointerSlack) continue;
      const first = anchor === undefined;
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node packages/core`
Expected: PASS.

Run: `pnpm exec tsc -p packages/core/tsconfig.json`
Expected: exits with code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "core: zooms while typing that follow the text (the caret, else what the screen changes)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The CLI

**Files:**
- Modify: `apps/cli/src/main.ts`, `apps/cli/test/cli.test.ts`

- [ ] **Step 1: The tests**

A new test types 50 letters on a line of a generated screen and follows them, from the screen and from the caret. The click zoom tests type through their clicks: the typing comes first now, and they say so or leave it out.

In `apps/cli/test/cli.test.ts`, replace:

```ts
      { t: 6.6, type: 'click', x: 430, y: 320, button: 'left' },
    ].sort((a, b) => a.t - b.t);
    writeFileSync(join(dir, 'takes/1/events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    const { code, json } = await cli('--json', '-C', dir, 'suggest', '--dry-run');
    expect(code).toBe(0);
    const zooms = (json as { zooms: { label: string; at: number; duration: number; rect: number[] }[] }).zooms;
    expect(zooms.find((zoom) => zoom.label === 'Clicks')).toMatchObject({ at: 5.3, duration: 2.5, rect: [127, 148, 576, 324] });
    expect((json as { notes: string[] }).notes).toContain('1 zoom on clicks');
    const without = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-click-zooms');
    expect((without.json as { zooms: { label: string }[] }).zooms.map((zoom) => zoom.label)).not.toContain('Clicks');
  }, 30_000);

  it('replaces only the zooms it made: hand-made ones stay, one switched off stays off, a kind switched off is not made', async () => {
```

with:

```ts
      { t: 6.6, type: 'click', x: 430, y: 320, button: 'left' },
    ].sort((a, b) => a.t - b.t);
    writeFileSync(join(dir, 'takes/1/events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    type Zooms = { zooms: { label: string; at: number; duration: number; rect: number[] }[]; notes: string[] };
    // the typing comes first: its zoom follows what the screen changes, over the clicks
    const typed = (await cli('--json', '-C', dir, 'suggest', '--dry-run')).json as Zooms;
    expect(typed.zooms.map((zoom) => zoom.label)).toEqual(['Typing', 'Answer']);
    const { code, json } = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-typing-zooms');
    expect(code).toBe(0);
    const zooms = (json as Zooms).zooms;
    expect(zooms.find((zoom) => zoom.label === 'Clicks')).toMatchObject({ at: 5.3, duration: 2.5, rect: [127, 148, 576, 324] });
    expect((json as Zooms).notes).toContain('1 zoom on clicks');
    const without = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-typing-zooms', '--no-click-zooms');
    expect((without.json as Zooms).zooms.map((zoom) => zoom.label)).not.toContain('Clicks');
  }, 30_000);

  it('replaces only the zooms it made: hand-made ones stay, one switched off stays off, a kind switched off is not made', async () => {
```

In the same file, replace:

```ts
      { t: 6.6, type: 'click', x: 430, y: 320, button: 'left' },
    ].sort((a, b) => a.t - b.t);
    writeFileSync(join(dir, 'takes/1/events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    const first = await cli('--json', '-C', dir, 'suggest');
    expect(first.code).toBe(0);
    type Zoom = { id: string; label?: string; at: number; duration: number; rect: number[]; auto?: string; enabled?: boolean };
    const made = (first.json as { zooms: Zoom[] }).zooms;
```

with:

```ts
      { t: 6.6, type: 'click', x: 430, y: 320, button: 'left' },
    ].sort((a, b) => a.t - b.t);
    writeFileSync(join(dir, 'takes/1/events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    // the click zooms' rules here: the typing over the clicks gets no zoom
    const first = await cli('--json', '-C', dir, 'suggest', '--no-typing-zooms');
    expect(first.code).toBe(0);
    type Zoom = { id: string; label?: string; at: number; duration: number; rect: number[]; auto?: string; enabled?: boolean };
    const made = (first.json as { zooms: Zoom[] }).zooms;
```

In the same file, replace:

```ts
      { id: 'z9', label: 'Mine', at: answer!.at, duration: 2, rect: [0, 0, 800, 450] },
    ];
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify(file, null, 2));
    const again = (await cli('--json', '-C', dir, 'suggest')).json as { zooms: Zoom[]; notes: string[] };
    expect(again.zooms.find((zoom) => zoom.id === 'z9')).toMatchObject({ label: 'Mine', at: answer!.at });
    expect(again.zooms.find((zoom) => zoom.auto === 'click')).toMatchObject({ enabled: false });
    expect(again.notes).toContain('kept 1 zoom made or changed by hand');
```

with:

```ts
      { id: 'z9', label: 'Mine', at: answer!.at, duration: 2, rect: [0, 0, 800, 450] },
    ];
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify(file, null, 2));
    const again = (await cli('--json', '-C', dir, 'suggest', '--no-typing-zooms')).json as { zooms: Zoom[]; notes: string[] };
    expect(again.zooms.find((zoom) => zoom.id === 'z9')).toMatchObject({ label: 'Mine', at: answer!.at });
    expect(again.zooms.find((zoom) => zoom.auto === 'click')).toMatchObject({ enabled: false });
    expect(again.notes).toContain('kept 1 zoom made or changed by hand');
```

In the same file, replace:

```ts
    // click zooms switched off as a kind: none made
    const off = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ ...off, autoEdits: { clickZooms: false } }, null, 2));
    const none = (await cli('--json', '-C', dir, 'suggest', '--dry-run')).json as { zooms: Zoom[] };
    expect(none.zooms.map((zoom) => zoom.auto)).not.toContain('click');
  }, 60_000);

  it('leaves cuttle.json alone with --dry-run', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
```

with:

```ts
    // click zooms switched off as a kind: none made
    const off = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ ...off, autoEdits: { clickZooms: false } }, null, 2));
    const none = (await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-typing-zooms')).json as { zooms: Zoom[] };
    expect(none.zooms.map((zoom) => zoom.auto)).not.toContain('click');
  }, 60_000);

  it('zooms on typing and follows the text along the line, from the screen alone or from the caret', async () => {
    const dir = temp();
    mkdirSync(join(dir, 'takes', '1'), { recursive: true });
    // a 1280×720 screen where 50 letters are typed on a line at y 400, from x 80 to 1062, between 2 and 9.35 s
    const letters = Array.from({ length: 50 }, (_, k) => `drawbox=x=${80 + 20 * k}:y=400:w=14:h=22:color=white:t=fill:enable='gte(t,${(2 + 0.15 * k).toFixed(2)})'`);
    const made = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x202020:s=1280x720:r=30:d=14,${letters.join(',')}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(dir, 'takes', '1', 'screen.mp4')]);
    expect(made.status, String(made.stderr)).toBe(0);
    const keys = Array.from({ length: 15 }, (_, k) => ({ t: 2 + 0.5 * k, type: 'keys', count: 3 }));
    const write = (events: unknown[]) => writeFileSync(join(dir, 'takes', '1', 'events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    write(keys);
    writeFileSync(join(dir, 'takes', '1', 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 } } }));
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', events: 'takes/1/events.jsonl' } }));
    type Rect = [number, number, number, number];
    type Result = { zooms: { label: string; at: number; duration: number; rect: Rect; moves?: { at: number; rect: Rect }[]; auto: string }[]; notes: string[] };
    const fromScreen = (await cli('--json', '-C', dir, 'suggest', '--dry-run')).json as Result;
    const typing = fromScreen.zooms.find((zoom) => zoom.auto === 'typing')!;
    // the quiet start is trimmed (the clip starts at 1.2 s), and no zoom starts within 1 s of a clip's edge
    expect(typing).toMatchObject({ label: 'Typing', at: 2.2 });
    // the view (576 px wide) starts on the first letters and moves right along the line, with the letters in it
    const [x, y, width, height] = typing.rect;
    expect(x).toBeLessThanOrEqual(80);
    expect(y < 400 && y + height > 422 && width === 576).toBe(true);
    const moves = typing.moves ?? [];
    expect(moves.length).toBeGreaterThanOrEqual(2);
    for (const [i, move] of moves.entries()) {
      expect(move.rect[0]).toBeGreaterThan(i === 0 ? x : moves[i - 1]!.rect[0]);
      // the letter typed then lies in the view
      const letter = 80 + 20 * Math.floor((move.at - 2) / 0.15);
      expect(letter >= move.rect[0] && letter < move.rect[0] + width).toBe(true);
    }
    expect(fromScreen.notes.some((note) => /^1 zoom while typing, \d+ moves following the text \(what the screen changed\)$/.test(note))).toBe(true);
    // with the caret the zoom follows it instead (here it says the letters are 100 px lower)
    write([...keys, ...Array.from({ length: 25 }, (_, k) => ({ t: 2.1 + 0.3 * k, type: 'caret', rect: [80 + 40 * k, 500, 2, 22] }))].sort((a, b) => a.t - b.t));
    const fromCaret = (await cli('--json', '-C', dir, 'suggest', '--dry-run')).json as Result;
    const following = fromCaret.zooms.find((zoom) => zoom.auto === 'typing')!;
    expect(following.rect[1] + following.rect[3] / 2).toBeCloseTo(511, 0);
    expect(fromCaret.notes.some((note) => note.endsWith('following the text (the caret)'))).toBe(true);
    const none = (await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-typing-zooms')).json as Result;
    expect(none.zooms.filter((zoom) => zoom.auto === 'typing')).toEqual([]);
  }, 60_000);

  it('leaves cuttle.json alone with --dry-run', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
```

- [ ] **Step 2: `--no-typing-zooms`**

In `apps/cli/src/main.ts`, replace:

```ts

  program
    .command('suggest')
    .description('propose scenes (quiet start and end trimmed, idle cut, waiting sped up), a zoom on the answer and zooms on clicks')
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer nor on clicks)')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-speech', 'leave the speech out: no filler, pause or spoken retake cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, options: { claude?: string | true; zoom: boolean; clickZooms: boolean; speech: boolean; transcribe: boolean; dryRun?: boolean }) =>
        suggestCommand(project, options, output),
      ),
    );
```

with:

```ts

  program
    .command('suggest')
    .description('propose scenes (quiet start and end trimmed, idle cut, waiting sped up), a zoom on the answer, zooms that follow typing and zooms on clicks')
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer, nor on typing, nor on clicks)')
    .option('--no-typing-zooms', 'no zooms that follow typing')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-speech', 'leave the speech out: no filler, pause or spoken retake cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, options: { claude?: string | true; zoom: boolean; typingZooms: boolean; clickZooms: boolean; speech: boolean; transcribe: boolean; dryRun?: boolean }) =>
        suggestCommand(project, options, output),
      ),
    );
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cli
git commit -m "cli: suggest zooms on typing (--no-typing-zooms leaves them out)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The path in the editor

**Files:**
- Modify: `apps/desktop/src/shared/{document,edit,timeline-model}.ts`
- Modify: `apps/desktop/src/renderer/editor/{Timeline,SourceView,Inspector}.tsx`, `apps/desktop/src/renderer/editor/editor.css`
- Test: `apps/desktop/test/{document,timeline-model}.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/test/document.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import { applyCommand, clampRect, describeChange, DocumentError, ensureIds, firstChanged, pinIds, replayCommands, type Command, type Raw } from '../src/shared/document';
import { adjustRect, dragRange, drawnRect, fitInside, overlayRange, rangeFields, snapTime, toSource, toStage } from '../src/shared/edit';

const base: Raw = {
  version: 1,
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import { applyCommand, clampRect, describeChange, DocumentError, ensureIds, firstChanged, pinIds, replayCommands, type Command, type Raw } from '../src/shared/document';
import { adjustRect, dragRange, drawnRect, fitInside, movePath, overlayRange, rangeFields, snapTime, toSource, toStage } from '../src/shared/edit';

const base: Raw = {
  version: 1,
```

In the same file, replace:

```ts
  });
});

describe('captions in the document', () => {
  it('sets their fields, and fixes words: a fix takes the place of those it overlaps, and none leaves no list', () => {
    const styled = applyCommand(base, { type: 'captions', field: 'style', value: 'karaoke' }, limits);
```

with:

```ts
  });
});

describe('a zoom that follows, in the document', () => {
  // the typing zoom 4–8 s in the 4× clip (3–8 s): from the left, to the middle at 5 s, to the right at 7 s
  const following: Raw = {
    ...base,
    scenes: [{ type: 'clip', id: 's1', from: 0, to: 12 }],
    zooms: [{ id: 'z1', at: 4, duration: 4, rect: [0, 200, 640, 400], moves: [{ at: 5, rect: [300, 200, 640, 400] }, { at: 7, rect: [600, 200, 640, 400] }], auto: 'typing' }],
  };
  const zoom = (raw: Raw) => (raw.zooms as Raw[])[0]!;

  it('takes its path along when it moves as a whole, by a drag, the inspector, a shift or a copy', () => {
    const dragged = applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { at: 5, duration: 4 } }, limits);
    expect(zoom(dragged)).toMatchObject({ at: 5, rect: [0, 200, 640, 400], moves: [{ at: 6 }, { at: 8 }] });
    expect(zoom(dragged).auto).toBeUndefined();
    expect(zoom(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { at: 3.5 } }, limits)).moves).toMatchObject([{ at: 4.5 }, { at: 6.5 }]);
    expect(zoom(applyCommand(following, { type: 'shift', list: 'zooms', id: 'z1', by: -0.25 }, limits)).moves).toMatchObject([{ at: 4.75 }, { at: 6.75 }]);
    const copied = applyCommand(following, { type: 'duplicate', list: 'zooms', id: 'z1', shift: 4 }, limits);
    expect((copied.zooms as Raw[])[1]).toMatchObject({ at: 8, moves: [{ at: 9 }, { at: 11 }] });
  });

  it('keeps its path in the take when an edge moves: what falls outside goes, a later start starts where the path was', () => {
    const later = zoom(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { at: 5.5, duration: 2.5 } }, limits));
    expect(later).toMatchObject({ at: 5.5, rect: [300, 200, 640, 400], moves: [{ at: 7, rect: [600, 200, 640, 400] }] });
    const shorter = zoom(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { duration: 2.5 } }, limits));
    expect(shorter.moves).toEqual([{ at: 5, rect: [300, 200, 640, 400] }]);
    const none = zoom(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { duration: 0.5 } }, limits));
    expect(none).not.toHaveProperty('moves');
  });

  it('stretches its path with its clip\'s speed, holds still on request, and keeps its moves on the screen', () => {
    const sped = applyCommand({ ...following, scenes: [{ type: 'clip', id: 's1', from: 0, to: 20 }] }, { type: 'speed', id: 's1', speed: 2 }, limits);
    expect(zoom(sped)).toMatchObject({ at: 4, duration: 8, moves: [{ at: 6 }, { at: 10 }] });
    const still = zoom(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { moves: undefined } }, limits));
    expect(still).not.toHaveProperty('moves');
    expect(still.auto).toBeUndefined();
    const off = zoom(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { moves: [{ at: 5, rect: [1000, 700, 640, 400] }] } }, limits));
    expect(off.moves).toEqual([{ at: 5, rect: [1000, 700, 280, 100] }]);
    expect(project(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { at: 0.5 } }, limits)).zooms[0]!.moves).toHaveLength(2);
  });

  it('moves and scales the whole path the way the box at the playhead was dragged', () => {
    const path = { rect: [0, 200, 640, 400] as [number, number, number, number], moves: [{ at: 5, rect: [300, 200, 640, 400] as [number, number, number, number] }] };
    // the box at the playhead (on the move) went 100 px right and 50 px down
    expect(movePath(path, [300, 200, 640, 400], [400, 250, 640, 400])).toEqual({ rect: [100, 250, 640, 400], moves: [{ at: 5, rect: [400, 250, 640, 400] }] });
    // and half as big from its corner
    expect(movePath(path, [300, 200, 640, 400], [300, 200, 320, 200])).toEqual({ rect: [150, 200, 320, 200], moves: [{ at: 5, rect: [300, 200, 320, 200] }] });
  });
});

describe('captions in the document', () => {
  it('sets their fields, and fixes words: a fix takes the place of those it overlaps, and none leaves no list', () => {
    const styled = applyCommand(base, { type: 'captions', field: 'style', value: 'karaoke' }, limits);
```

In `apps/desktop/test/timeline-model.test.ts`, replace:

```ts
    expect(model.lanes.caption.blocks.map((block) => block.title)).toEqual(['One prompt']);
  });

  it('lists what is worth a second look before an export', () => {
    expect(exportChecks(demo, spans)).toEqual(['1 mask is off: what it covers shows in the video.', '1 mask is cut out: no clip shows it.']);
    const quick = project({
```

with:

```ts
    expect(model.lanes.caption.blocks.map((block) => block.title)).toEqual(['One prompt']);
  });

  it('marks where a zoom that follows moves on, in output seconds', () => {
    const typed = project({ scenes: [{ type: 'clip', from: 0, to: 4 }, { type: 'clip', from: 4, to: 12, speed: 2 }], zooms: [{ at: 1, duration: 9, rect: [0, 0, 100, 100], moves: [{ at: 3, rect: [50, 0, 100, 100] }, { at: 8, rect: [90, 0, 100, 100] }] }] });
    const [block] = timelineModel(typed, sceneSpans(typed.scenes), []).lanes.zoom.blocks;
    expect(block?.marks).toEqual([3, 6]);
  });

  it('lists what is worth a second look before an export', () => {
    expect(exportChecks(demo, spans)).toEqual(['1 mask is off: what it covers shows in the video.', '1 mask is cut out: no clip shows it.']);
    const quick = project({
```

Run: `pnpm exec vitest run --project node apps/desktop/test/document.test.ts apps/desktop/test/timeline-model.test.ts`
Expected: FAIL: `movePath` does not exist, the moves stay where they were, and the block has no marks.

- [ ] **Step 2: The moves keep with the zoom's time; the path moves as one**

In `apps/desktop/src/shared/document.ts`, replace:

```ts
  return [round(x), round(y), round(w), round(h)];
}

/** Clamps the item's times and area after an edit. */
function clampItem(list: ListName, item: Item, limits: EditLimits): void {
  const frame = 1 / (limits.fps ?? 30);
```

with:

```ts
  return [round(x), round(y), round(w), round(h)];
}

type Move = { at: number; rect: number[] };

/**
 * Keeps a zoom's moves with its time. Moved as a whole, they go with it (`by`); at a new speed of
 * its clip, they stretch with it from its start (`scale`); with an edge moved, they stay where they
 * are in the take. Moves no longer inside the zoom go, and when its start passed some, it starts
 * where the last of them went.
 */
function keepPath(item: Item, change: { by?: number; scale?: number } = {}): void {
  if (!Array.isArray(item.moves)) return;
  const at = Number(item.at);
  let moves = item.moves as Move[];
  if (change.by) moves = moves.map((move) => ({ ...move, at: move.at + change.by! }));
  if (change.scale) moves = moves.map((move) => ({ ...move, at: at + (move.at - at) * change.scale! }));
  const passed = moves.filter((move) => move.at <= at);
  if (passed.length > 0) item.rect = passed.at(-1)!.rect;
  const kept: Move[] = [];
  for (const move of moves) {
    const time = round(move.at);
    if (time > (kept.at(-1)?.at ?? at) && time < at + Number(item.duration)) kept.push({ ...move, at: time });
  }
  if (kept.length > 0) item.moves = kept;
  else delete item.moves;
}

/** Clamps the item's times and area after an edit. */
function clampItem(list: ListName, item: Item, limits: EditLimits): void {
  const frame = 1 / (limits.fps ?? 30);
```

In the same file, replace:

```ts
    item.duration = round(Math.max(frame, Number(item.duration)));
  }
  if (Array.isArray(item.rect)) item.rect = clampRect(item.rect as number[], limits.screen);
}

/** Applies one command to `raw` (left as it was) and returns the new version, checked. */
```

with:

```ts
    item.duration = round(Math.max(frame, Number(item.duration)));
  }
  if (Array.isArray(item.rect)) item.rect = clampRect(item.rect as number[], limits.screen);
  if (list === 'zooms' && Array.isArray(item.moves)) {
    item.moves = (item.moves as Move[]).map((move) => ({ at: Number(move.at), rect: clampRect(move.rect, limits.screen) }));
    keepPath(item);
  }
}

/** Applies one command to `raw` (left as it was) and returns the new version, checked. */
```

In the same file, replace:

```ts
          const duration = Number(overlay.duration);
          if (at < from || at + duration > to) continue;
          overlay.duration = round(Math.min((duration / before) * speed, to - at));
          touched.push([name, overlay]);
        }
      }
```

with:

```ts
          const duration = Number(overlay.duration);
          if (at < from || at + duration > to) continue;
          overlay.duration = round(Math.min((duration / before) * speed, to - at));
          if (name === 'zooms') keepPath(overlay, { scale: Number(overlay.duration) / duration });
          touched.push([name, overlay]);
        }
      }
```

In the same file, replace:

```ts
        const by = Math.max(command.by, -Number(item.from));
        item.from = Number(item.from) + by;
        item.to = Number(item.to) + by;
      } else item.at = Math.max(0, Number(item.at) + command.by);
      claim(item);
      touched.push([command.list, item]);
      break;
    }
    case 'set': {
      const { item } = find(next, command.list, command.id);
      claim(item, command.fields);
      setFields(item, command.fields);
      touched.push([command.list, item]);
      break;
    }
```

with:

```ts
        const by = Math.max(command.by, -Number(item.from));
        item.from = Number(item.from) + by;
        item.to = Number(item.to) + by;
      } else {
        const at = Number(item.at);
        item.at = Math.max(0, at + command.by);
        if (command.list === 'zooms') keepPath(item, { by: Number(item.at) - at });
      }
      claim(item);
      touched.push([command.list, item]);
      break;
    }
    case 'set': {
      const { item } = find(next, command.list, command.id);
      const before = { at: Number(item.at), duration: Number(item.duration) };
      claim(item, command.fields);
      setFields(item, command.fields);
      // a zoom's path goes with it when it moves as a whole, and stays in the take when an edge moves
      if (command.list === 'zooms' && !('moves' in command.fields)) keepPath(item, Number(item.duration) === before.duration ? { by: Number(item.at) - before.at } : {});
      touched.push([command.list, item]);
      break;
    }
```

In the same file, replace:

```ts
        if (command.list === 'masks') {
          copy.from = Number(copy.from) + command.shift;
          copy.to = Number(copy.to) + command.shift;
        } else if (command.list !== 'scenes') copy.at = Number(copy.at) + command.shift;
      }
      list(command.list).splice(index + 1, 0, copy);
      touched.push([command.list, copy]);
```

with:

```ts
        if (command.list === 'masks') {
          copy.from = Number(copy.from) + command.shift;
          copy.to = Number(copy.to) + command.shift;
        } else if (command.list !== 'scenes') {
          copy.at = Number(copy.at) + command.shift;
          if (command.list === 'zooms') keepPath(copy, { by: command.shift });
        }
      }
      list(command.list).splice(index + 1, 0, copy);
      touched.push([command.list, copy]);
```

In `apps/desktop/src/shared/edit.ts`, replace:

```ts
  return [from, to];
}

/** Where a picture of `source` size sits inside `area` (contained, centred): its offset and scale. */
export interface Fit {
  x: number;
```

with:

```ts
  return [from, to];
}

/**
 * A zoom's path (its rect and its moves' rects) moved and scaled the way the rect shown at the
 * playhead went from `from` to `to`: what the person drags is where the zoom is then, and the rest of
 * the path follows.
 */
export function movePath(path: { rect: Rect; moves?: readonly { at: number; rect: Rect }[] }, from: Rect, to: Rect): { rect: Rect; moves?: { at: number; rect: Rect }[] } {
  const scale = to[2] / from[2];
  const map = (rect: Rect): Rect => [Math.round(to[0] + (rect[0] - from[0]) * scale), Math.round(to[1] + (rect[1] - from[1]) * scale), Math.round(rect[2] * scale), Math.round(rect[3] * scale)];
  return { rect: map(path.rect), ...(path.moves && { moves: path.moves.map((move) => ({ at: move.at, rect: map(move.rect) })) }) };
}

/** Where a picture of `source` size sits inside `area` (contained, centred): its offset and scale. */
export interface Fit {
  x: number;
```

In `apps/desktop/src/shared/timeline-model.ts`, replace:

```ts
  title: string;
  /** The row inside its lane: blocks that overlap in time go to separate rows. */
  row: number;
}

/** Rows a lane grows to; blocks beyond overlap in the last one. */
```

with:

```ts
  title: string;
  /** The row inside its lane: blocks that overlap in time go to separate rows. */
  row: number;
  /** Where a zoom that follows moves on, in output seconds. */
  marks?: number[];
}

/** Rows a lane grows to; blocks beyond overlap in the last one. */
```

In the same file, replace:

```ts
  spans: readonly SceneSpan[],
  range: (item: T) => [number, number],
  title: (item: T) => string,
): OverlayLane {
  const blocks: OverlayBlock[] = [];
  const cutOutItems: OverlayLane['cutOutItems'] = [];
```

with:

```ts
  spans: readonly SceneSpan[],
  range: (item: T) => [number, number],
  title: (item: T) => string,
  marks?: (item: T) => number[],
): OverlayLane {
  const blocks: OverlayBlock[] = [];
  const cutOutItems: OverlayLane['cutOutItems'] = [];
```

In the same file, replace:

```ts
        enabled: item.enabled,
        title: item.label ?? title(item),
        row: 0,
      });
    }
  });
```

with:

```ts
        enabled: item.enabled,
        title: item.label ?? title(item),
        row: 0,
        ...(marks && { marks: marks(item).flatMap((t) => outputTimesOf(spans, t)).filter((t) => t >= occurrence.start && t < occurrence.end) }),
      });
    }
  });
```

In the same file, replace:

```ts
    scenes: groups.map((group) => sceneBlock(group, project)),
    cuts: cutNotches(project, spans),
    lanes: {
      zoom: lane('zoom', project.zooms, spans, (zoom) => [zoom.at, zoom.at + zoom.duration], () => 'Zoom'),
      mask: lane('mask', project.masks, spans, (mask) => [mask.from, mask.to], () => 'Mask'),
      caption: lane('caption', project.texts, spans, (text) => [text.at, text.at + text.duration], (text) => text.text),
    },
```

with:

```ts
    scenes: groups.map((group) => sceneBlock(group, project)),
    cuts: cutNotches(project, spans),
    lanes: {
      zoom: lane('zoom', project.zooms, spans, (zoom) => [zoom.at, zoom.at + zoom.duration], () => 'Zoom', (zoom) => (zoom.moves ?? []).map((move) => move.at)),
      mask: lane('mask', project.masks, spans, (mask) => [mask.from, mask.to], () => 'Mask'),
      caption: lane('caption', project.texts, spans, (text) => [text.at, text.at + text.duration], (text) => text.text),
    },
```

In the same file, replace:

```ts
  const width = (to - from) / columns;
  if (!(width > 0)) return counts;
  for (const event of events) {
    if (event.type === 'shape') continue;
    const weight = event.type === 'move' ? 0.25 : event.type === 'keys' ? event.count : 1;
    for (const t of outputTimesOf(spans, event.t)) {
      const column = Math.floor((t - from) / width);
```

with:

```ts
  const width = (to - from) / columns;
  if (!(width > 0)) return counts;
  for (const event of events) {
    if (event.type === 'shape' || event.type === 'caret') continue;
    const weight = event.type === 'move' ? 0.25 : event.type === 'keys' ? event.count : 1;
    for (const t of outputTimesOf(spans, event.t)) {
      const column = Math.floor((t - from) / width);
```

- [ ] **Step 3: The marks, the path and Hold still**

In `apps/desktop/src/renderer/editor/Timeline.tsx`, replace:

```
                        >
                          {blockWidth >= 14 && <i className="edge start" data-edge="start" />}
                          {blockWidth >= LABEL_MIN_PX && <span style={{ marginLeft: inset }}>{block.title}</span>}
                          {blockWidth >= 14 && <i className="edge end" data-edge="end" />}
                        </button>
                      );
```

with:

```
                        >
                          {blockWidth >= 14 && <i className="edge start" data-edge="start" />}
                          {blockWidth >= LABEL_MIN_PX && <span style={{ marginLeft: inset }}>{block.title}</span>}
                          {/* a zoom that follows: where it moves on */}
                          {block.marks?.map((mark) => <i key={mark} className="move-mark" style={{ left: (mark - block.start) * pps }} />)}
                          {blockWidth >= 14 && <i className="edge end" data-edge="end" />}
                        </button>
                      );
```

In `apps/desktop/src/renderer/editor/SourceView.tsx`, replace:

```
import type { Rect } from '@cuttle/project';
import type { Command } from '../../shared/document';
import { formatSource } from '../../shared/format';
import { adjustRect, drawnRect, fitInside, toSource, toStage, type Fit, type Handle } from '../../shared/edit';
import { addMask, addZoom, cropClip, overlayBlocked, playheadPlace } from './actions';
import { edit, preview } from './doc';
import { beginGesture, cancelGesture } from './gesture';
```

with:

```
import type { Rect } from '@cuttle/project';
import type { Command } from '../../shared/document';
import { formatSource } from '../../shared/format';
import { zoomTargetAt } from '@cuttle/timeline';
import { adjustRect, drawnRect, fitInside, movePath, toSource, toStage, type Fit, type Handle } from '../../shared/edit';
import { addMask, addZoom, cropClip, overlayBlocked, playheadPlace } from './actions';
import { edit, preview } from './doc';
import { beginGesture, cancelGesture } from './gesture';
```

In the same file, replace:

```
  }, [active, frameAt, size.width, size.height, screen.width, screen.height]);

  if (!active || !project) return null;
  const boxes: Box[] = [
    ...project.zooms.map((zoom) => ({ kind: 'zoom' as const, id: zoom.id!, rect: zoom.rect, here: frameAt !== undefined && frameAt >= zoom.at && frameAt < zoom.at + zoom.duration })),
    ...project.masks.map((mask) => ({ kind: 'mask' as const, id: mask.id!, rect: mask.rect, here: frameAt !== undefined && frameAt >= mask.from && frameAt < mask.to })),
  ].filter((box) => box.here || (selection?.kind === box.kind && selection.id === box.id));
  // that clip's crop, while cropping or selected
```

with:

```
  }, [active, frameAt, size.width, size.height, screen.width, screen.height]);

  if (!active || !project) return null;
  // a zoom that follows shows where it is at that second
  const speed = place?.span.scene.type === 'clip' ? place.span.scene.speed : 1;
  const zoomAt = (zoom: (typeof project.zooms)[number]): Rect => (frameAt === undefined ? zoom.rect : (zoomTargetAt(zoom, frameAt, speed).map((value) => Math.round(value)) as Rect));
  const boxes: Box[] = [
    ...project.zooms.map((zoom) => ({ kind: 'zoom' as const, id: zoom.id!, rect: zoomAt(zoom), here: frameAt !== undefined && frameAt >= zoom.at && frameAt < zoom.at + zoom.duration })),
    ...project.masks.map((mask) => ({ kind: 'mask' as const, id: mask.id!, rect: mask.rect, here: frameAt !== undefined && frameAt >= mask.from && frameAt < mask.to })),
  ].filter((box) => box.here || (selection?.kind === box.kind && selection.id === box.id));
  // that clip's crop, while cropping or selected
```

In the same file, replace:

```
    select({ kind: box.kind, id: box.id });
    const list = box.kind === 'zoom' ? 'zooms' : box.kind === 'mask' ? 'masks' : 'scenes';
    const clip = box.kind === 'crop' ? project.scenes.find((scene) => scene.id === box.id) : undefined;
    let commands: Command[] | undefined;
    follow(
      event,
      (dx, dy) => {
        const rect = adjustRect(box.rect, handle, dx, dy, screen, box.kind === 'zoom' ? aspect : undefined).map((value) => Math.round(value));
        // a crop moved by hand is the person's: a new crop object, without the automatic tag
        const fields = box.kind === 'crop' && clip?.type === 'clip' ? { crop: { rect, ...(clip.crop?.enabled === false && { enabled: false }) } } : { rect };
        commands = [{ type: 'set', list, id: box.id, fields }];
        preview(commands);
      },
```

with:

```
    select({ kind: box.kind, id: box.id });
    const list = box.kind === 'zoom' ? 'zooms' : box.kind === 'mask' ? 'masks' : 'scenes';
    const clip = box.kind === 'crop' ? project.scenes.find((scene) => scene.id === box.id) : undefined;
    const path = box.kind === 'zoom' ? project.zooms.find((zoom) => zoom.id === box.id) : undefined;
    let commands: Command[] | undefined;
    follow(
      event,
      (dx, dy) => {
        const rect = adjustRect(box.rect, handle, dx, dy, screen, box.kind === 'zoom' ? aspect : undefined).map((value) => Math.round(value));
        // a crop moved by hand is the person's: a new crop object, without the automatic tag; a zoom
        // that follows takes its whole path along
        const fields =
          box.kind === 'crop' && clip?.type === 'clip'
            ? { crop: { rect, ...(clip.crop?.enabled === false && { enabled: false }) } }
            : path?.moves?.length
              ? movePath(path, box.rect, rect as Rect)
              : { rect };
        commands = [{ type: 'set', list, id: box.id, fields }];
        preview(commands);
      },
```

In the same file, replace:

```
    <div className="source-view" ref={area} onPointerDown={pressFrame} data-testid="source-view">
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      {(selected?.kind === 'zoom' || selected?.kind === 'crop') && <ZoomDim fit={fit} rect={selected.rect} size={size} />}
      {!selected && tool === 'crop' && boxes.some((box) => box.kind === 'crop') && <ZoomDim fit={fit} rect={boxes.find((box) => box.kind === 'crop')!.rect} size={size} />}
      {boxes.map((box) => {
        const at = toStage(box.rect, fit);
```

with:

```
    <div className="source-view" ref={area} onPointerDown={pressFrame} data-testid="source-view">
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      {(selected?.kind === 'zoom' || selected?.kind === 'crop') && <ZoomDim fit={fit} rect={selected.rect} size={size} />}
      {selected?.kind === 'zoom' && <ZoomPath fit={fit} zoom={project.zooms.find((zoom) => zoom.id === selected.id)} />}
      {!selected && tool === 'crop' && boxes.some((box) => box.kind === 'crop') && <ZoomDim fit={fit} rect={boxes.find((box) => box.kind === 'crop')!.rect} size={size} />}
      {boxes.map((box) => {
        const at = toStage(box.rect, fit);
```

In the same file, replace:

```
                  : selected
                    ? ` · drag the box to place it, elsewhere for a new ${tool}`
                    : ` · drag to draw a ${tool}`
                : ' · drag the box to move it, its handles to resize it'}
        <span className="sep" />
        <kbd>Esc</kbd> for the video
      </div>
```

with:

```
                  : selected
                    ? ` · drag the box to place it, elsewhere for a new ${tool}`
                    : ` · drag to draw a ${tool}`
                : selected?.kind === 'zoom' && project.zooms.find((zoom) => zoom.id === selected.id)?.moves?.length
                  ? ' · it follows the dashed path: drag the box to move all of it, its handles to resize it'
                  : ' · drag the box to move it, its handles to resize it'}
        <span className="sep" />
        <kbd>Esc</kbd> for the video
      </div>
```

In the same file, replace:

```
  );
}

/** Outside a selected zoom's area is dimmed: what stays bright is what the zoom shows. */
function ZoomDim({ fit, rect, size }: { fit: Fit; rect: Rect; size: { width: number; height: number } }) {
  const at = toStage(rect, fit);
```

with:

```
  );
}

/** A selected zoom that follows: the rects it moves through, dashed, and the way from one to the next. */
function ZoomPath({ fit, zoom }: { fit: Fit; zoom?: { rect: Rect; moves?: { rect: Rect }[] } }) {
  if (!zoom?.moves?.length) return null;
  const rects = [zoom.rect, ...zoom.moves.map((move) => move.rect)].map((rect) => toStage(rect, fit));
  const middles = rects.map((rect) => `${rect.x + rect.width / 2},${rect.y + rect.height / 2}`);
  return (
    <svg className="zoom-path" data-testid="zoom-path">
      {rects.map((rect, i) => (
        <rect key={i} x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
      ))}
      <polyline points={middles.join(' ')} />
      {rects.map((rect, i) => (
        <circle key={i} cx={rect.x + rect.width / 2} cy={rect.y + rect.height / 2} r={3} />
      ))}
    </svg>
  );
}

/** Outside a selected zoom's area is dimmed: what stays bright is what the zoom shows. */
function ZoomDim({ fit, rect, size }: { fit: Fit; rect: Rect; size: { width: number; height: number } }) {
  const at = toStage(rect, fit);
```

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```
    );
  };

  const area = (list: 'zooms' | 'masks', rect: Rect, label: string) => (
    <div className="field">
      <span className="field-label">
        Area, in source pixels
        <button type="button" className="link" onClick={() => setTool(list === 'zooms' ? 'zoom' : 'mask')}>
          Draw on the video
        </button>
```

with:

```
    );
  };

  const area = (list: 'zooms' | 'masks', rect: Rect, label: string, title = 'Area, in source pixels') => (
    <div className="field">
      <span className="field-label">
        {title}
        <button type="button" className="link" onClick={() => setTool(list === 'zooms' ? 'zoom' : 'mask')}>
          Draw on the video
        </button>
```

In the same file, replace:

```
          <TextInput value={zoom.label ?? ''} placeholder="Zoom" onCommit={(value) => set('zooms', id, { label: value.trim() || undefined }, 'Rename zoom')} />
        </Row>
        {timing('zooms', zoom.at, zoom.at + zoom.duration)}
        {area('zooms', zoom.rect, 'zoom')}
        <Row label="Easing">
          <Select value={zoom.ease} options={EASES} names={EASE_NAMES} onChange={(ease) => set('zooms', id, { ease }, 'Change easing')} />
        </Row>
```

with:

```
          <TextInput value={zoom.label ?? ''} placeholder="Zoom" onCommit={(value) => set('zooms', id, { label: value.trim() || undefined }, 'Rename zoom')} />
        </Row>
        {timing('zooms', zoom.at, zoom.at + zoom.duration)}
        {area('zooms', zoom.rect, 'zoom', zoom.moves?.length ? 'Start, in source pixels' : undefined)}
        {zoom.moves && zoom.moves.length > 0 && (
          <Row label="Follows" note={`${zoom.moves.length} move${zoom.moves.length === 1 ? '' : 's'}`} plain>
            <button type="button" className="ghost small" onClick={() => set('zooms', id, { moves: undefined }, 'Hold the zoom still')} data-testid="zoom-hold">
              Hold still
            </button>
          </Row>
        )}
        <Row label="Easing">
          <Select value={zoom.ease} options={EASES} names={EASE_NAMES} onChange={(ease) => set('zooms', id, { ease }, 'Change easing')} />
        </Row>
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```
  background-image: repeating-linear-gradient(135deg, transparent 0 5px, rgba(255, 255, 255, 0.05) 5px 10px);
  opacity: 0.6;
}
.tl-canvas {
  position: absolute;
  left: 0;
```

with:

```
  background-image: repeating-linear-gradient(135deg, transparent 0 5px, rgba(255, 255, 255, 0.05) 5px 10px);
  opacity: 0.6;
}
/* a zoom that follows: a diamond where it moves on */
.item .move-mark {
  position: absolute;
  top: 50%;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  transform: rotate(45deg);
  background: var(--zoom);
  pointer-events: none;
}
.tl-canvas {
  position: absolute;
  left: 0;
```

In the same file, replace:

```
.source-box.elsewhere {
  opacity: 0.55;
}
.source-box.drawing {
  pointer-events: none;
}
```

with:

```
.source-box.elsewhere {
  opacity: 0.55;
}
/* a selected zoom that follows: where it goes, faint */
.zoom-path {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.zoom-path rect {
  fill: none;
  stroke: var(--zoom);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  opacity: 0.5;
}
.zoom-path polyline {
  fill: none;
  stroke: var(--zoom);
  stroke-width: 1.5;
  opacity: 0.8;
}
.zoom-path circle {
  fill: var(--zoom);
}
.source-box.drawing {
  pointer-events: none;
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm exec vitest run --project node apps/desktop/test/document.test.ts apps/desktop/test/timeline-model.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src apps/desktop/test/document.test.ts apps/desktop/test/timeline-model.test.ts
git commit -m "desktop: a zoom that follows: its moves on the timeline, its path in the source view, Hold still

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The skill

**Files:**
- Modify: `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`

- [ ] **Step 1: Typing zooms and `moves`**

In `skill/cuttle/SKILL.md`, replace:

````markdown
```

`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work),
zooms on Claude's answer, and zooms where clicks happen at normal speed ("Click", "Clicks";
`--no-click-zooms` leaves those out, `--no-zoom` every zoom). Its `notes` say what it did, in
source seconds. It replaces every clip and the zooms it made before (tagged `auto`; masks, texts,
cuts, stills, cards and zooms made by hand stay), so run it once, before your hand edits. Its clips and zooms have ids, and labels where Claude's markers say
what they show ("Claude at work", "Answer"): keep them when you edit, and give items you add an
````

with:

````markdown
```

`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work),
zooms on Claude's answer, zooms in where someone types and follows the text along ("Typing": the
camera moves on as the text leaves the middle of the view; `--no-typing-zooms` leaves those out),
and zooms where clicks happen at normal speed ("Click", "Clicks"; `--no-click-zooms` leaves those
out, `--no-zoom` every zoom). Its `notes` say what it did, in
source seconds. It replaces every clip and the zooms it made before (tagged `auto`; masks, texts,
cuts, stills, cards and zooms made by hand stay), so run it once, before your hand edits. Its clips and zooms have ids, and labels where Claude's markers say
what they show ("Claude at work", "Answer"): keep them when you edit, and give items you add an
````

In `skill/cuttle/project.md`, replace:

```markdown
(`true`). The rect is widened to the screen's aspect and kept inside the screen. The zoom eases in
and out over 0.6 output seconds each where it starts and ends on screen (a cut into its middle
lands zoomed), so give it 2 output seconds or more (`2 × speed` source seconds over a sped-up
clip).

`masks` hide private things: `from` and `to` (source seconds), `rect`, `style` (`fill`: the colour
around it, safest for tokens and keys; `blur`) and `enabled` (`true`). Make the rect generous: a
```

with:

```markdown
(`true`). The rect is widened to the screen's aspect and kept inside the screen. The zoom eases in
and out over 0.6 output seconds each where it starts and ends on screen (a cut into its middle
lands zoomed), so give it 2 output seconds or more (`2 × speed` source seconds over a sped-up
clip). A zoom that follows (a typing zoom from `suggest`) has `moves`: `[{ "at", "rect" }]`, each
`at` (source seconds) after the one before and inside the zoom. It starts on `rect` and goes to each
move's rect in turn, eased over 0.6 output seconds centred on the move's `at`. To move the whole
path, change every rect by the same amount; without `moves` it holds still.

`masks` hide private things: `from` and `to` (source seconds), `rect`, `style` (`fill`: the colour
around it, safest for tokens and keys; `blur`) and `enabled` (`true`). Make the rect generous: a
```

In the same file, replace:

```markdown
  the grid; `frames/<t>s-grid.png` is the default file.
- `takes/<n>/markers.json` lists the prompt, each tool call and Claude's answer in source seconds,
  and each press of the mistake key (kind `retake`).
- `cuttle --json suggest` prints notes with source seconds (`sped up 112.9 s without input 12×
  (7.5–120.4 s)`).
- To get from output to source seconds by hand, walk the scenes. A clip lasts
```

with:

```markdown
  the grid; `frames/<t>s-grid.png` is the default file.
- `takes/<n>/markers.json` lists the prompt, each tool call and Claude's answer in source seconds,
  and each press of the mistake key (kind `retake`).
- `takes/<n>/events.jsonl` has the input: `move`, `click` and `scroll` with `x` and `y`, `keys`
  (presses per half second, never which keys) and the pointer's `shape`; on Windows also `caret`
  with a `rect` (where text is typed, while it is, where the app keeps a system caret).
- `cuttle --json suggest` prints notes with source seconds (`sped up 112.9 s without input 12×
  (7.5–120.4 s)`).
- To get from output to source seconds by hand, walk the scenes. A clip lasts
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run --project node skill/test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add skill
git commit -m "skill: zooms that follow typing, and a zoom's moves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The end-to-end check

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The check**

A typing zoom with two moves comes into the demo project from outside. The check finds its marks on the timeline, its path in the source view (the box moves on between the playhead at its start and at 1.6 s), drags the box (the whole path goes along), and holds it still.

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    await editor.waitForFunction(() => document.querySelectorAll('[data-testid=cut-notch]').length === 0);
  }, 45_000);

  it('crops a clip in the source view: the window takes the crop’s shape; the crop is switched off in the inspector', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await press('.scene[data-id=s1]');
```

with:

```ts
    await editor.waitForFunction(() => document.querySelectorAll('[data-testid=cut-notch]').length === 0);
  }, 45_000);

  it('shows a zoom that follows typing: its moves on the timeline, its path in the source view; a drag takes the path along, Hold still ends it', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    type Following = { id: string; rect: number[]; moves?: { at: number; rect: number[] }[]; auto?: string };
    const following = (file: Written) => file.zooms.find((zoom) => zoom.id === 'z8') as unknown as Following;
    // suggest's typing zoom in the first clip: from the left, to the middle at 1.2 s, down to the right at 2 s
    const outside = onDisk() as unknown as { zooms: unknown[] };
    outside.zooms.push({ id: 'z8', label: 'Typing', at: 0.3, duration: 2.5, rect: [100, 100, 576, 360], moves: [{ at: 1.2, rect: [400, 100, 576, 360] }, { at: 2, rect: [600, 300, 576, 360] }], auto: 'typing' });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.waitForSelector('.item.zoom[data-id=z8] .move-mark');
    expect(await editor.locator('.item.zoom[data-id=z8] .move-mark').count()).toBe(2);
    // selected (from the Auto tab, which goes to its start), the source view shows its path, and it
    // where it is at the playhead
    await click(editor, '#tab-auto');
    await click(editor, '[data-testid=auto-group-typing] .auto-toggle');
    await click(editor, '[data-testid=auto-group-typing] .auto-item');
    await editor.waitForSelector('[data-testid=zoom-path]');
    expect(await editor.locator('[data-testid=zoom-path] rect').count()).toBe(3);
    const left = async () => {
      const [box, view] = await Promise.all([editor.locator('.source-box.zoom.selected').boundingBox(), editor.locator('[data-testid=source-view]').boundingBox()]);
      return (box!.x - view!.x) / view!.width;
    };
    const start = await left();
    // at 1.6 s it has moved on from x 100 to x 400 (of 1280)
    await seek(1.6);
    await expect.poll(left).toBeGreaterThan(start + 0.1);
    await click(editor, '#tab-selection');
    await editor.waitForSelector('[data-testid=zoom-hold]');
    await shot('32-typing-zoom');
    // a drag at the playhead takes the whole path along: the person's zoom now
    await drag('.source-box.selected', [40, 0]);
    await savedWhen((file) => following(file).rect[0]! > 100);
    const dragged = following(onDisk());
    const by = dragged.rect[0]! - 100;
    expect(dragged.moves!.map((move) => move.rect[0]! - by)).toEqual([400, 600]);
    expect(dragged.auto).toBeUndefined();
    await click(editor, '[data-testid=zoom-hold]');
    await savedWhen((file) => following(file).moves === undefined);
    await editor.waitForSelector('[data-testid=zoom-path]', { state: 'detached' });
    expect((await doc()).undo).toBe('Hold the zoom still');
    await editor.keyboard.press('Escape');
    await undoAll();
    // back to the file as it was (Claude reverting)
    writeFileSync(projectFile(), original);
    await editor.waitForFunction(() => document.querySelectorAll('.item.zoom[data-id=z8]').length === 0);
  }, 45_000);

  it('crops a clip in the source view: the window takes the crop’s shape; the crop is switched off in the inspector', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await press('.scene[data-id=s1]');
```

- [ ] **Step 2: Run it, with screenshots, and look at them**

```bash
mkdir -p "$TEMP/cuttle-p4m4a-shots"
CUTTLE_HIDDEN=1 CUTTLE_RECORDER_BACKEND=test CUTTLE_CHECK_SHOTS="$TEMP/cuttle-p4m4a-shots" pnpm app:check
```

Expected: PASS, 42 tests. Look at `32-typing-zoom`: the box on the second place of the path, the other two dashed, the diamonds on the zoom's block.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/app.check.test.ts
git commit -m "desktop: app:check shows a zoom that follows typing, drags its path and holds it still

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Final verification

- [ ] **Step 1: All tests, the typecheck, the CLI and the packaged build**

Run: `pnpm test`
Expected: PASS, 620 passed and 52 skipped (on a machine without a speech model the real transcription is skipped too: 619 and 53).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 5 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Record a take: type a long line in a terminal, press Enter, type another. Once it is cut, play it: the video zooms in on the line and moves along with it, and back left for the next line.
2. The same in Notepad and in a browser's address bar. Where `events.jsonl` gets `caret` lines, the app keeps a system caret and the zoom follows it.
3. In the editor, select the typing zoom: its path shows in the source view. Drag it, play it; then Hold still.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran once, on the prototype, whose tree the replay matches byte for byte: the task steps' tests, `pnpm test`, the typecheck, `app:check` and `cli:check`, with every screenshot looked at. The packaged build (`pnpm app:build`) ran on the replayed commits.
- The camera was looked at, not only measured: preview stills of the CLI test's typed line (rendered hidden) show the zoom on the first letters and one smooth move right as the line grows.

**Found while checking, and already in the plan above**
- **Letters typed were too small to see at 320 px.** The answer zoom's comparison counts a change from 0.2 % of the picture; typed letters are a few pixels at that size. Typing reads 640 px wide, from 8 changed pixels.
- **The click zoom tests type through their clicks**, so the typing zoom took their place. They now say so (`Typing`, `Answer`), and check the click zooms with `--no-typing-zooms`.
- **The new check raced** the Auto tab, which goes to the item's start when it is picked; the check seeks after it.
- **The path's overlay had no size** of its own (an SVG is 300 × 150 by default) and drew only because overflow showed. It covers the view now.
- **"Where it starts, in source pixels" wrapped** beside "Draw on the video"; "Start, in source pixels" keeps the old length.
- **`moves` is optional**, not a default empty list: a parsed zoom without it keeps its shape everywhere else (the export job, the tests' expectations).
- **The new CLI test did not typecheck** (a rect as `number[]` gives possibly undefined parts); it types rects as tuples.
- **The recorder's countdown test wobbled again** in one full run under load (the stop at 500 ms came after the second tick). It passed three times alone, and a clean full run passed.

**Spec points that move**
- **M4 is split** (above): M4a the caret and the typing zooms, M4b the content area, the crop, the windows and the dialog zooms.
- **The zoom on typing** follows the text with room ahead (35 % in from the left), not centred on it, and reads the screen twice a second rather than once.

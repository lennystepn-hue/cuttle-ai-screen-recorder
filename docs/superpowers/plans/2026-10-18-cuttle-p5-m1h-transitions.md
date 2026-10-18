# Cuttle P5-M1h: Transition Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scene may be gone into with a page instead of the crossfade:
- `scenes[i].transition: { src, duration, params }` plays around the cut into scene `i`, half before and half after, also with the look's crossfades off;
- the page gets the outgoing and the incoming frame as the video draws them (`cuttle.from`, `cuttle.to`, `ImageBitmap`s) and how far it is (`cuttle.progress`), and draws the frame between them;
- the `fold` template turns the outgoing frame over its middle like a page, onto the incoming one, with a whoosh;
- the export, `cuttle preview` and `motion check` draw it; `motion new fold --into <scene>` adds one; the editor shows it in the scene's panel (length, on and off, remove) and a crossfade in its place for now.

**Architecture:**
- **The timeline:** `crossfadeHalf` takes a scene's own transition (its duration, also with crossfades off; never at a continuous cut or a cut); a frame inside it has the two layers as before and `transition` (the scene it goes into, the page's clock).
- **The engine:** `layerPixels` draws each of the two layers whole into the offscreen target and reads it back (top row first); `render` draws a transition's frame from `FrameSources.transitions` in place of the crossfade, the caption over it, and crossfades without one.
- **The export page:** after a frame's sources, a transition frame reads the layers from the renderer and asks the main process for the page's frame with them (`kind: 'transition'`, `between`); the page closes once the transition is past.
- **The main process:** `MotionHost` opens the transition's page (`scenes[i].transition`) like a scene's; `MotionPage.frame` hands the two frames to the page at `cuttle-motion://frames/<page>/from` and `/to` (raw RGBA at the page's size), and `__cuttleDraw` fetches them into `cuttle.from` and `cuttle.to` before it draws.
- **Sounds:** a transition page's `cuttle.sound` plays in its window, like a scene's.

**Tech Stack:** TypeScript strict, zod 4, vitest 5 (node and browser), WebGL2, Electron 44.7.2 (offscreen windows, custom protocol), Three.js 0.186.1.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase5-motion-design.md` ("Three places for motion": transitions; "The page contract": `cuttle.from`, `cuttle.to`, `cuttle.progress`; "Templates": `fold`). Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m1d-take-frames.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m1h`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` and the typecheck run in Task 9.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The finished prototype passed `pnpm test` (851 tests, 70 skipped, in two full runs), the typecheck, `app:check` (50 tests) and `cli:check` (14). Every screenshot was looked at.

- **On the scene it leads into.** The spec's place, `scenes[i].transition`: a scene says how it is gone into. Its fields are a page's (`src`, `params`, `network`) with `duration` (0.8 s, at most 4) and `enabled`. The first scene's, or one right after a cut or at a continuous cut, has nothing to go between and is not played.
- **It replaces the crossfade, not the cut.** The window is the crossfade's: half the duration before the cut and half after, capped by half of either scene. The two layers are the crossfade's (the outgoing scene holds its last frame, the incoming one its first, as now), so the picture and the sound (the audio crossfades over the same window) stay in step.
- **The engine draws both layers whole and reads them back,** at the output's size, opaque, premultiplied, top row first: what the page is given. Reading leaves the canvas as it was. A frame of the page takes the place of the crossfade (over the background, should it leave gaps), and the caption still goes over it.
- **The frames reach the page through its own session:** `cuttle-motion://frames/<page id>/from` and `/to` serve the frame the main process holds for it (raw RGBA at the page's size). The page's `__cuttleDraw` fetches both, turns them into `ImageBitmap`s (`cuttle.from`, `cuttle.to`, the old ones closed), then draws; a frame that cannot be read fails the draw. `cuttle.progress` is the page's time over its duration.
- **One page per transition, its frames in order:** the export asks for them as it renders (they cannot be asked ahead: they need the layers), and the page closes on the first frame past the transition. `cuttle preview` (stills in any order) reopens it for a frame before one it drew, as for scenes.
- **`motion check` checks a transition in the video:** the window around its cut, the whole project rendered, so the page goes between the real scenes; its report is the page's own among the others.
- **`motion new <transition template> --into <scene>`** sets the scene's transition (by id, or by place from 0; default the second scene); a first scene is refused.
- **The fold template:** Three.js; the half of the outgoing frame on the side it turns from lifts and turns over the middle, its back the incoming frame's other half; beneath, the incoming frame's half it uncovers; the page darkens as it stands on edge and lifts a little, a shadow runs ahead of it and one behind. Params: `direction` (left, right), `depth` (how strong the perspective is, 0.5), `sounds` (a whoosh at its middle). Its turn eases in and out (cubic): an exponential ease left the first 40% almost still, and a near camera made the page a wall at 90°.
- **The editor, for now:** the scene's panel shows its transition (the page, its length, on and off, remove) and says that the export draws it and the editor shows a crossfade there. Playing the page in the editor (the layers read back and sent to the main process for each frame, ahead of the player) is **P5-M1i**. The editor sends the project to its soundtrack when a scene has a transition, so the page's whoosh plays there already.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/{schema,index}.ts` | `scenes[i].transition` |
| `packages/timeline/src/{time,frame,index}.ts` | the window, the frame's `transition` |
| `packages/engine/src/renderer.ts` | `layerPixels`, a transition's frame in place of the crossfade |
| `packages/export/src/{job,motion/runtime,motion/init,motion/requests}.ts`, `packages/export/src/main/{motion,motion-host,sources}.ts` | the page between two frames |
| `packages/export/src/page/{scene-sources,run}.ts` | the export page asks for a transition's frames |
| `packages/motion-kit/templates/fold/index.html`, `packages/motion-kit/src/index.ts`, `packages/export/src/main/motion-sounds.ts` | the fold, its sound |
| `apps/cli/src/{main.ts,commands/motion.ts,electron/main.ts,electron/protocol.ts}` | `motion new --into`, `motion check` of a transition |
| `apps/desktop/src/renderer/editor/{Inspector.tsx,editor.css,session.ts}` | the scene's panel |
| `apps/cli/test/electron.check.test.ts`, `apps/desktop/test/app.check.test.ts`, `skill/cuttle/*.md` | the checks, the guides |

---

### Task 1: A scene's transition, and its window on the timeline

**Files:**
- Modify: `packages/project/src/schema.ts`, `packages/project/src/index.ts`, `packages/project/test/schema.test.ts`, `packages/timeline/src/time.ts`, `packages/timeline/src/frame.ts`, `packages/timeline/src/index.ts`, `packages/timeline/test/time.test.ts`, `packages/timeline/test/frame.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m1h`; work there:

```bash
git switch p5-m1h
```

- [ ] **Step 2: Write the failing tests**

In `packages/project/test/schema.test.ts`, replace:

```ts
    expect(p.overlays[0]).toEqual({ id: 'o1', src: 'motion/callouts/index.html', at: 4.2, duration: 6, params: {}, network: false, enabled: true });
  });

  it('reads motion blur with its defaults, and refuses too few samples and a shutter of zero', () => {
    const p = ProjectSchema.parse({
      ...minimal,
```

with:

```ts
    expect(p.overlays[0]).toEqual({ id: 'o1', src: 'motion/callouts/index.html', at: 4.2, duration: 6, params: {}, network: false, enabled: true });
  });

  it('reads the transition page into any scene, with its defaults, and refuses one too long or without a page', () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [
        { type: 'card', title: 'A', duration: 2 },
        { type: 'clip', from: 0, to: 4, transition: { src: 'motion/fold/index.html' } },
        { type: 'card', title: 'B', duration: 2, transition: { src: 'motion/fold/index.html', duration: 1.5, params: { direction: 'right' }, enabled: false } },
      ],
    });
    expect(p.scenes[1]!.transition).toEqual({ src: 'motion/fold/index.html', params: {}, network: false, duration: 0.8, enabled: true });
    expect(p.scenes[2]!.transition).toEqual({ src: 'motion/fold/index.html', params: { direction: 'right' }, network: false, duration: 1.5, enabled: false });
    expect(p.scenes[0]!.transition).toBeUndefined();
    expect(pathsOf({ ...minimal, scenes: [{ type: 'card', title: 'A', duration: 2, transition: { src: 'a.html', duration: 5 } }] })).toEqual(['scenes.0.transition.duration']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'card', title: 'A', duration: 2, transition: { duration: 1 } }] })).toEqual(['scenes.0.transition.src']);
  });

  it('reads motion blur with its defaults, and refuses too few samples and a shutter of zero', () => {
    const p = ProjectSchema.parse({
      ...minimal,
```

In `packages/timeline/test/time.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import type { ClipScene, Scene } from '@cuttle/project';
import { crossfadeHalf, isContinuousCut, sceneDuration, sceneSpans, sourceTimeAt, spanAt, totalDuration } from '../src/time';

const clip = (from: number, to: number, speed = 1): ClipScene => ({ type: 'clip', from, to, speed });
const scenes: Scene[] = [clip(10, 20), clip(20, 140, 12), { type: 'card', title: 'End', duration: 2 }];
```

with:

```ts
import { describe, expect, it } from 'vitest';
import type { ClipScene, Scene } from '@cuttle/project';
import { crossfadeHalf, isContinuousCut, pageTransition, sceneDuration, sceneSpans, sourceTimeAt, spanAt, totalDuration } from '../src/time';

const clip = (from: number, to: number, speed = 1): ClipScene => ({ type: 'clip', from, to, speed });
const scenes: Scene[] = [clip(10, 20), clip(20, 140, 12), { type: 'card', title: 'End', duration: 2 }];
```

In the same file, replace:

```ts
    expect(crossfadeHalf(spans[2]!, spans[3]!, on)).toBeCloseTo(0.1, 9);
    expect(crossfadeHalf(spans[1]!, spans[2]!, { enabled: false, duration: 0.4 })).toBe(0);
  });
});

describe('cuts', () => {
```

with:

```ts
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
```

In `packages/timeline/test/frame.test.ts`, replace:

```ts
    expect(timeline.frameAt(5).layers).toHaveLength(1);
  });

  it('blends the outgoing and incoming scenes around a boundary', () => {
    const before = timeline.frameAt(9.9).layers;
    expect(before.map((l) => l.index)).toEqual([0, 1]);
```

with:

```ts
    expect(timeline.frameAt(5).layers).toHaveLength(1);
  });

  it('hands a scene\'s transition page the two layers around its cut, with its own clock', () => {
    const scenes = [JUMP[0], { ...JUMP[1], transition: { src: 'motion/fold/index.html', duration: 0.8 } }, JUMP[2]];
    const paged = createTimeline(project({ transition: { enabled: false } }, { scenes }), { screenSize });
    expect(paged.frameAt(9.5).transition).toBeUndefined();
    const into = paged.frameAt(9.7);
    expect(into.layers.map((layer) => [layer.index, layer.sourceTime])).toEqual([
      [0, 19.7],
      [1, 21],
    ]);
    expect(into.transition).toEqual({ sceneIndex: 1, key: 'transition:1', start: 9.6, local: 0.1, duration: 0.8 });
    expect(paged.frameAt(10.3).transition?.local).toBeCloseTo(0.7, 6);
    // the next boundary has no page: a cut, as the look says
    expect(paged.frameAt(19.95).layers).toHaveLength(1);
    // the look's crossfade elsewhere carries no page
    expect(timeline.frameAt(9.9).transition).toBeUndefined();
  });

  it('blends the outgoing and incoming scenes around a boundary', () => {
    const before = timeline.frameAt(9.9).layers;
    expect(before.map((l) => l.index)).toEqual([0, 1]);
```

Run: `pnpm exec vitest run --project node packages/project/test/schema.test.ts packages/timeline`
Expected: FAIL: a scene has no `transition`, and there is no `pageTransition`.

- [ ] **Step 3: The field**

In `packages/project/src/schema.ts`, replace:

```ts

const autoKind = z.enum(AUTO_KINDS).optional();

const ClipSceneSchema = z
  .strictObject({
    type: z.literal('clip'),
    ...named,
    from: seconds,
    to: seconds,
    speed: z.number().positive().max(64).default(1),
```

with:

```ts

const autoKind = z.enum(AUTO_KINDS).optional();

/** A page (HTML, in the project) as a value its params may hold: text, a number, a switch, a colour, a path. */
const ParamValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * A page that takes the place of the crossfade into its scene (a fold, a wipe, a zoom through): it is
 * given the outgoing and the incoming frame for each of its frames and draws the frame between them.
 * It lasts `duration` seconds around the cut, half before and half after, also with crossfades off.
 */
const SceneTransitionSchema = z.strictObject({
  /** The page: an HTML file in the project (`motion/fold/index.html`). */
  src: z.string().min(1),
  /** The values of the params the page declares. */
  params: z.record(z.string(), ParamValue).default({}),
  /** Let the page reach https: (off: only the project's files). */
  network: z.boolean().default(false),
  duration: z.number().positive().max(4).default(0.8),
  enabled: z.boolean().default(true),
});

/** What every scene may have: an id, a label, and a page for the way into it. */
const sceneFields = { ...named, transition: SceneTransitionSchema.optional() };

const ClipSceneSchema = z
  .strictObject({
    type: z.literal('clip'),
    ...sceneFields,
    from: seconds,
    to: seconds,
    speed: z.number().positive().max(64).default(1),
```

In the same file, replace:

```ts

const StillSceneSchema = z.strictObject({
  type: z.literal('still'),
  ...named,
  image: z.string().min(1),
  duration: positiveSeconds,
  motion: z.enum(STILL_MOTIONS).default('none'),
```

with:

```ts

const StillSceneSchema = z.strictObject({
  type: z.literal('still'),
  ...sceneFields,
  image: z.string().min(1),
  duration: positiveSeconds,
  motion: z.enum(STILL_MOTIONS).default('none'),
```

In the same file, replace:

```ts

const CardSceneSchema = z.strictObject({
  type: z.literal('card'),
  ...named,
  title: z.string().min(1),
  subtitle: z.string().optional(),
  duration: positiveSeconds,
});

/** A page (HTML, in the project) as a value its params may hold: text, a number, a switch, a colour, a path. */
const ParamValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** What a motion page gets: the page (a path in the project), its params, and whether it may reach the network. */
const motionPage = {
  /** The page: an HTML file in the project (`motion/intro/index.html`). */
```

with:

```ts

const CardSceneSchema = z.strictObject({
  type: z.literal('card'),
  ...sceneFields,
  title: z.string().min(1),
  subtitle: z.string().optional(),
  duration: positiveSeconds,
});

/** What a motion page gets: the page (a path in the project), its params, and whether it may reach the network. */
const motionPage = {
  /** The page: an HTML file in the project (`motion/intro/index.html`). */
```

In the same file, replace:

```ts
/** A page Claude or the person wrote, rendered frame by frame as a scene (an intro, an end card, a 3D shot). */
const MotionSceneSchema = z.strictObject({
  type: z.literal('motion'),
  ...named,
  ...motionPage,
  duration: positiveSeconds,
});
```

with:

```ts
/** A page Claude or the person wrote, rendered frame by frame as a scene (an intro, an end card, a 3D shot). */
const MotionSceneSchema = z.strictObject({
  type: z.literal('motion'),
  ...sceneFields,
  ...motionPage,
  duration: positiveSeconds,
});
```

In the same file, replace:

```ts
export type CardScene = Extract<Scene, { type: 'card' }>;
export type MotionScene = Extract<Scene, { type: 'motion' }>;
export type MotionOverlay = CuttleProject['overlays'][number];
export type Music = NonNullable<CuttleProject['music']>;
export type Sound = CuttleProject['sounds'][number];
export type Zoom = CuttleProject['zooms'][number];
```

with:

```ts
export type CardScene = Extract<Scene, { type: 'card' }>;
export type MotionScene = Extract<Scene, { type: 'motion' }>;
export type MotionOverlay = CuttleProject['overlays'][number];
export type SceneTransition = NonNullable<Scene['transition']>;
export type Music = NonNullable<CuttleProject['music']>;
export type Sound = CuttleProject['sounds'][number];
export type Zoom = CuttleProject['zooms'][number];
```

In `packages/project/src/index.ts`, replace:

```ts
  type Music,
  type Sound,
  type MotionScene,
  type ClipScene,
  type CursorShape,
  type CursorStyle,
```

with:

```ts
  type Music,
  type Sound,
  type MotionScene,
  type SceneTransition,
  type ClipScene,
  type CursorShape,
  type CursorStyle,
```

- [ ] **Step 4: The window and the frame's transition**

In `packages/timeline/src/time.ts`, replace:

```ts
/**
 * Half the crossfade between neighbouring spans `a` and `b`, in output seconds: half the look's
 * transition, but at most half of either span; none at a continuous cut, at a cut (`cuts`), or
 * with transitions off.
 * The picture and the export's sound share it.
 */
export function crossfadeHalf(a: SceneSpan, b: SceneSpan, transition: { enabled: boolean; duration: number }): number {
  if (!transition.enabled || b.cutBefore || isContinuousCut(a.scene, b.scene)) return 0;
  return Math.min(transition.duration / 2, (a.end - a.start) / 2, (b.end - b.start) / 2);
}

/**
```

with:

```ts
/**
 * Half the crossfade between neighbouring spans `a` and `b`, in output seconds: half the look's
 * transition, but at most half of either span; none at a continuous cut, at a cut (`cuts`), or
 * with transitions off. A scene with a transition page of its own (`b.scene.transition`) is gone
 * into with that page, as long as it says, also with the look's crossfades off.
 * The picture and the export's sound share it.
 */
export function crossfadeHalf(a: SceneSpan, b: SceneSpan, transition: { enabled: boolean; duration: number }): number {
  if (b.cutBefore || isContinuousCut(a.scene, b.scene)) return 0;
  const own = b.scene.transition?.enabled ? b.scene.transition : undefined;
  if (!own && !transition.enabled) return 0;
  return Math.min((own ?? transition).duration / 2, (a.end - a.start) / 2, (b.end - b.start) / 2);
}

/** Whether the way from span `a` into span `b` is the page of `b`'s transition (not a crossfade). */
export function pageTransition(a: SceneSpan, b: SceneSpan, transition: { enabled: boolean; duration: number }): boolean {
  return b.scene.transition?.enabled === true && crossfadeHalf(a, b, transition) > 0;
}

/**
```

In `packages/timeline/src/frame.ts`, replace:

```ts
import { clamp } from './easing';
import { occurrences, rampAmount, type Occurrence } from './occurrences';
import { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
import { crossfadeHalf, isContinuousCut, sceneSpans, sourceTimeAt, spanAt, totalDuration, type SceneSpan } from './time';
import { ZOOM_RAMP_SECONDS, zoomRectAt } from './zoom';

/** A motion overlay on a clip's frame: which one, and where its own clock is. */
```

with:

```ts
import { clamp } from './easing';
import { occurrences, rampAmount, type Occurrence } from './occurrences';
import { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
import { crossfadeHalf, isContinuousCut, pageTransition, sceneSpans, sourceTimeAt, spanAt, totalDuration, type SceneSpan } from './time';
import { ZOOM_RAMP_SECONDS, zoomRectAt } from './zoom';

/** A motion overlay on a clip's frame: which one, and where its own clock is. */
```

In the same file, replace:

```ts
  cursor?: CursorFrame;
}

export interface RenderState {
  t: number;
  layers: SceneFrame[];
  /** The caption shown over the frame, when captions are on and someone speaks. */
  caption?: ActiveCaption;
}
```

with:

```ts
  cursor?: CursorFrame;
}

/** A scene's transition page while it plays: the scene it goes into, and where its clock is. */
export interface ActiveTransition {
  /** The scene it goes into, its place in the project's `scenes`. */
  sceneIndex: number;
  /** `transition:<sceneIndex>`: a scene is gone into once. */
  key: string;
  /** Where it starts (output seconds), how far into it the frame is, and how long it lasts. */
  start: number;
  local: number;
  duration: number;
}

export interface RenderState {
  t: number;
  /** One layer, or two during a crossfade or a transition (the outgoing one first). */
  layers: SceneFrame[];
  /** The transition page that draws this frame from the two layers, instead of their crossfade. */
  transition?: ActiveTransition;
  /** The caption shown over the frame, when captions are on and someone speaks. */
  caption?: ActiveCaption;
}
```

In the same file, replace:

```ts
      span = following;
    }

    const next = spans[span.index + 1];
    if (next) {
      const half = halfBetween(span, next);
      if (half > 0 && time > span.end - half) {
        const mix = (time - (span.end - half)) / (2 * half);
        return { t: time, layers: [sceneFrame(span, time, 1 - mix), sceneFrame(next, time, mix)] };
      }
    }

    const prev = spans[span.index - 1];
    if (prev) {
      const half = halfBetween(prev, span);
      if (half > 0 && time < span.start + half) {
        const mix = (time - (span.start - half)) / (2 * half);
        return { t: time, layers: [sceneFrame(prev, time, 1 - mix), sceneFrame(span, time, mix)] };
      }
    }

    return { t: time, layers: [sceneFrame(span, time, 1)] };
```

with:

```ts
      span = following;
    }

    /** The two layers between `a` and `b`, and the transition page that draws them when `b` has one. */
    const between = (a: SceneSpan, b: SceneSpan, half: number): RenderState => {
      const start = round(a.end - half);
      const mix = (time - (a.end - half)) / (2 * half);
      const state: RenderState = { t: time, layers: [sceneFrame(a, time, 1 - mix), sceneFrame(b, time, mix)] };
      if (pageTransition(a, b, project.look.transition)) {
        state.transition = { sceneIndex: b.sceneIndex, key: `transition:${b.sceneIndex}`, start, local: round(time - start), duration: round(2 * half) };
      }
      return state;
    };

    const next = spans[span.index + 1];
    if (next) {
      const half = halfBetween(span, next);
      if (half > 0 && time > span.end - half) return between(span, next, half);
    }

    const prev = spans[span.index - 1];
    if (prev) {
      const half = halfBetween(prev, span);
      if (half > 0 && time < span.start + half) return between(prev, span, half);
    }

    return { t: time, layers: [sceneFrame(span, time, 1)] };
```

In `packages/timeline/src/index.ts`, replace:

```ts
  MIN_PIECE_SECONDS,
  clipPieces,
  crossfadeHalf,
  isContinuousCut,
  sceneDuration,
  sceneSpans,
```

with:

```ts
  MIN_PIECE_SECONDS,
  clipPieces,
  crossfadeHalf,
  pageTransition,
  isContinuousCut,
  sceneDuration,
  sceneSpans,
```

In the same file, replace:

```ts
export { ZOOM_MOVE_SECONDS, ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt, zoomTargetAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, maskRectAt, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type ActiveOverlay, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
export {
  CAPTION_RULES,
  applyCaptionFixes,
```

with:

```ts
export { ZOOM_MOVE_SECONDS, ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt, zoomTargetAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, maskRectAt, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type ActiveOverlay, type ActiveTransition, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
export {
  CAPTION_RULES,
  applyCaptionFixes,
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node packages/project/test/schema.test.ts packages/timeline`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/project packages/timeline
git commit -m "project, timeline: a scene's transition page, played around the cut into it in place of the crossfade

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The engine reads the layers and draws a transition's frame

**Files:**
- Modify: `packages/engine/src/renderer.ts`, `packages/engine/test/renderer.browser.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/engine/test/renderer.browser.test.ts`, replace:

```ts
    expect(pixelAt(shown, 1, 30)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(shown, 32, 5)).toEqual(pixelAt(plain, 32, 5));
  });
});
```

with:

```ts
    expect(pixelAt(shown, 1, 30)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(shown, 32, 5)).toEqual(pixelAt(plain, 32, 5));
  });

  it('gives a transition page the two layers whole, top row first, and draws its frame in place of their crossfade', () => {
    // two motion scenes: the first red over blue, the second green; the transition page's frame white over black
    const scenes = parse({ look: solid, scenes: [{ type: 'motion', src: 'a.html', duration: 1 }, { type: 'motion', src: 'b.html', duration: 1, transition: { src: 't.html' } }] });
    const sources = { ...NO_SOURCES, motion: new Map([[0, motionFrame([255, 0, 0, 255], [0, 0, 255, 255])], [1, motionFrame([0, 255, 0, 255], [0, 255, 0, 255])]]) };
    const state: RenderState = {
      t: 1,
      layers: [layer(0, 0.5, 'motion'), layer(1, 0.5, 'motion')],
      transition: { sceneIndex: 1, key: 'transition:1', start: 0.6, local: 0.4, duration: 0.8 },
    };
    const canvas = new OffscreenCanvas(1, 1);
    const renderer = createRenderer(canvas, scenes, { assets, screenSize: SCREEN });
    const gl = canvas.getContext('webgl2')!;
    renderer.render(state, sources);
    const crossfade = readPixels(gl);
    const [from, to] = renderer.layerPixels(state, sources);
    const at = (pixels: MotionPixels, x: number, y: number) => [...pixels.data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
    expect([from.width, from.height, at(from, 5, 5), at(from, 5, 30)]).toEqual([64, 36, [255, 0, 0, 255], [0, 0, 255, 255]]);
    expect([at(to, 5, 5), at(to, 5, 30)]).toEqual([
      [0, 255, 0, 255],
      [0, 255, 0, 255],
    ]);
    // reading the layers leaves the canvas as it was
    expect(readPixels(gl).data).toEqual(crossfade.data);
    // without the page's frame the layers crossfade; with it, its frame is the picture
    near(pixelAt(crossfade, 5, 5), [128, 128, 0, 255]);
    renderer.render(state, { ...sources, transitions: new Map([['transition:1', motionFrame([255, 255, 255, 255], [0, 0, 0, 255])]]) });
    const paged = readPixels(gl);
    expect([pixelAt(paged, 5, 5), pixelAt(paged, 5, 30)]).toEqual([
      [255, 255, 255, 255],
      [0, 0, 0, 255],
    ]);
    expect(() => renderer.layerPixels({ t: 0, layers: [layer(0, 1, 'motion')] }, sources)).toThrow('layerPixels: the frame shows one scene, not two');
    renderer.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  });
});
```

Run: `pnpm exec vitest run --project browser packages/engine/test/renderer.browser.test.ts`
Expected: FAIL: `layerPixels` is not a function.

- [ ] **Step 2: The renderer**

In `packages/engine/src/renderer.ts`, replace:

```ts
  motion: Map<number, MotionPixels>;
  /** `ActiveOverlay.key` → the frame of a motion overlay; one without a frame is left out. */
  overlays: Map<string, MotionPixels>;
}

export interface Renderer {
```

with:

```ts
  motion: Map<number, MotionPixels>;
  /** `ActiveOverlay.key` → the frame of a motion overlay; one without a frame is left out. */
  overlays: Map<string, MotionPixels>;
  /**
   * `ActiveTransition.key` → the frame a transition page drew from the two layers (`layerPixels`); it
   * takes the place of their crossfade. Without one, the layers crossfade (its page is not drawn yet).
   */
  transitions?: Map<string, MotionPixels>;
}

export interface Renderer {
```

In the same file, replace:

```ts
   * when the WebGL context was lost (create a new renderer after `webglcontextrestored`).
   */
  render(state: RenderState, sources: FrameSources): void;
  /** The text overlays the last `render` drew, where they are in the output (for picking one with the pointer). */
  drawnTexts(): readonly DrawnText[];
  /**
```

with:

```ts
   * when the WebGL context was lost (create a new renderer after `webglcontextrestored`).
   */
  render(state: RenderState, sources: FrameSources): void;
  /**
   * The two layers of a frame between two scenes, each drawn whole: what a transition page is given
   * (premultiplied RGBA at the output's size, top row first, opaque). Throws like `render`, and when
   * the frame has one layer. Leaves the canvas as it was.
   */
  layerPixels(state: RenderState, sources: FrameSources): [MotionPixels, MotionPixels];
  /** The text overlays the last `render` drew, where they are in the output (for picking one with the pointer). */
  drawnTexts(): readonly DrawnText[];
  /**
```

In the same file, replace:

```ts
    }
  }

  return {
    render(state, sources) {
      if (disposed) throw new Error('render: the renderer was disposed');
      // A lost context draws nothing and reports no error: fail loudly instead of exporting black frames.
      if (gl.isContextLost()) throw new Error('render: the WebGL context was lost');
      drawn = [];
      gl.bindVertexArray(vao);
      gl.viewport(0, 0, output.width, output.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const [first, ...rest] = state.layers;
      if (first) drawLayer(first, sources, state.t);
      for (const layer of rest) {
```

with:

```ts
    }
  }

  function begin(what: string): void {
    if (disposed) throw new Error(`${what}: the renderer was disposed`);
    // A lost context draws nothing and reports no error: fail loudly instead of exporting black frames.
    if (gl.isContextLost()) throw new Error(`${what}: the WebGL context was lost`);
    drawn = [];
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, output.width, output.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);
  }

  /** One layer drawn whole into the offscreen target and read back, top row first. */
  function readLayer(layer: SceneFrame, sources: FrameSources, t: number): MotionPixels {
    layerTarget ??= createRenderTarget(gl, output);
    gl.bindFramebuffer(gl.FRAMEBUFFER, layerTarget.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawLayer(layer, sources, t);
    const { width, height } = output;
    const bottomUp = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const data = new Uint8Array(bottomUp.length);
    const row = width * 4;
    for (let y = 0; y < height; y++) data.set(bottomUp.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return { width, height, data };
  }

  return {
    render(state, sources) {
      begin('render');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // a transition page's frame takes the place of the two layers' crossfade
      const between = state.transition ? sources.transitions?.get(state.transition.key) : undefined;
      if (between) {
        background.draw(state.t);
        drawMotion(between, `transition into scene ${state.transition!.sceneIndex}`);
        if (state.caption) drawCaptionOver(state.caption);
        sprites.endFrame();
        return;
      }
      const [first, ...rest] = state.layers;
      if (first) drawLayer(first, sources, state.t);
      for (const layer of rest) {
```

In the same file, replace:

```ts
      if (state.caption) drawCaptionOver(state.caption);
      sprites.endFrame();
    },
    drawnTexts: () => drawn,
    setScenes(next) {
      scenes = next;
```

with:

```ts
      if (state.caption) drawCaptionOver(state.caption);
      sprites.endFrame();
    },
    layerPixels(state, sources) {
      begin('layerPixels');
      const [outgoing, incoming] = state.layers;
      if (!outgoing || !incoming) throw new Error('layerPixels: the frame shows one scene, not two');
      const pixels: [MotionPixels, MotionPixels] = [readLayer(outgoing, sources, state.t), readLayer(incoming, sources, state.t)];
      sprites.endFrame();
      return pixels;
    },
    drawnTexts: () => drawn,
    setScenes(next) {
      scenes = next;
```

- [ ] **Step 3: Run the test**

Run: `pnpm exec vitest run --project browser packages/engine/test/renderer.browser.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/engine
git commit -m "engine: the two layers of a transition read whole, and the page's frame drawn in place of their crossfade

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A page between two frames

**Files:**
- Modify: `packages/export/src/job.ts`, `packages/export/src/motion/runtime.ts`, `packages/export/src/motion/init.ts`, `packages/export/src/motion/requests.ts`, `packages/export/src/main/motion.ts`, `packages/export/src/main/motion-host.ts`, `packages/export/src/main/sources.ts`, `packages/export/test/motion-runtime.browser.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/export/test/motion-runtime.browser.test.ts`, replace:

```ts
type Page = Window &
  typeof globalThis & {
    cuttle: CuttleApi;
    __cuttleDraw(ms: number, view?: import('../src/motion/runtime').MotionView): Promise<number>;
    __cuttleReady(): Promise<void>;
    __cuttleErrors: string[];
    __cuttleSounds: import('../src/motion/runtime').PageSound[];
```

with:

```ts
type Page = Window &
  typeof globalThis & {
    cuttle: CuttleApi;
    __cuttleDraw(ms: number, view?: import('../src/motion/runtime').MotionView | null, between?: { from: string; to: string }): Promise<number>;
    __cuttleReady(): Promise<void>;
    __cuttleErrors: string[];
    __cuttleSounds: import('../src/motion/runtime').PageSound[];
```

In the same file, replace:

```ts
    await expect(page('', '').cuttle.take.frame(1)).rejects.toThrow('no screen recording');
  });

  it('seeds Math.random: the same seed gives the same numbers', () => {
    const numbers = (seed: number) => page('', 'seen.push(Math.random(), Math.random(), Math.random())', { ...INIT, seed }).seen;
    const first = numbers(7);
```

with:

```ts
    await expect(page('', '').cuttle.take.frame(1)).rejects.toThrow('no screen recording');
  });

  it('gives a transition page the frames it goes between before it draws, and how far it is', async () => {
    // two raw frames at the page's size: red and blue
    const raw = (rgb: number[]) => {
      const data = new Uint8Array(INIT.width * INIT.height * 4);
      for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
      return URL.createObjectURL(new Blob([data]));
    };
    const win = page(
      '',
      `cuttle.onFrame((t) => {
         const g = new OffscreenCanvas(1, 1).getContext('2d');
         const colour = (bitmap) => (g.drawImage(bitmap, 0, 0), [...g.getImageData(0, 0, 1, 1).data].slice(0, 3));
         seen.push({ t, progress: cuttle.progress, from: cuttle.from && [cuttle.from.width, cuttle.from.height, ...colour(cuttle.from)], to: cuttle.to && colour(cuttle.to) });
       });`,
      { ...INIT, transition: true },
    );
    expect([win.cuttle.from, win.cuttle.to, win.cuttle.progress]).toEqual([null, null, 0]);
    await win.__cuttleDraw(500, null, { from: raw([255, 0, 0]), to: raw([0, 0, 255]) });
    await win.__cuttleDraw(1500, null, { from: raw([0, 255, 0]), to: raw([0, 0, 255]) });
    expect(win.seen).toEqual([
      { t: 0.5, progress: 0.25, from: [320, 180, 255, 0, 0], to: [0, 0, 255] },
      { t: 1.5, progress: 0.75, from: [320, 180, 0, 255, 0], to: [0, 0, 255] },
    ]);
    // a frame that cannot be read fails the draw
    await expect(win.__cuttleDraw(1600, null, { from: 'blob:nothing', to: raw([0, 0, 0]) })).rejects.toThrow();
  });

  it('seeds Math.random: the same seed gives the same numbers', () => {
    const numbers = (seed: number) => page('', 'seen.push(Math.random(), Math.random(), Math.random())', { ...INIT, seed }).seen;
    const first = numbers(7);
```

Run: `pnpm exec vitest run --project browser packages/export/test/motion-runtime.browser.test.ts`
Expected: FAIL: `cuttle.from` is undefined.

- [ ] **Step 2: The page's side**

In `packages/export/src/motion/runtime.ts`, replace:

```ts
  take: TakeData | null;
  /** The script that reads the take's frames (`TAKE_WORKER`; a test gives its own). */
  takeWorker?: string;
}

/** A point of the screen recording in the frame: output px, and whether the frame shows it. */
```

with:

```ts
  take: TakeData | null;
  /** The script that reads the take's frames (`TAKE_WORKER`; a test gives its own). */
  takeWorker?: string;
  /** A transition page: each frame comes with the outgoing and the incoming frame (`cuttle.from`, `cuttle.to`). */
  transition?: boolean;
}

/** A point of the screen recording in the frame: output px, and whether the frame shows it. */
```

In the same file, replace:

```ts
  ready(promise: Promise<unknown>): void;
  /** The take (empty lists when the item has no take). */
  readonly take: CuttleTake;
  /**
   * Asks for a sound (a built-in, as `cuttle sound list` names them, or a file of the project) at `at`
   * seconds into this item, or at `videoTime` (an output second); without either, now. Ask when the
```

with:

```ts
  ready(promise: Promise<unknown>): void;
  /** The take (empty lists when the item has no take). */
  readonly take: CuttleTake;
  /**
   * A transition page's outgoing and incoming frame for the frame being drawn (the output's size,
   * opaque; null in other pages and before the first frame), and how far it is from one to the other
   * (0 to 1, as `time / duration`). Do not close them: they are replaced each frame.
   */
  readonly from: ImageBitmap | null;
  readonly to: ImageBitmap | null;
  readonly progress: number;
  /**
   * Asks for a sound (a built-in, as `cuttle sound list` names them, or a file of the project) at `at`
   * seconds into this item, or at `videoTime` (an output second); without either, now. Ask when the
```

In the same file, replace:

```ts
  const sounds: PageSound[] = [];
  page.__cuttleSounds = sounds;

  const api: CuttleApi = {
    get time() {
      return now / 1000;
    },
```

with:

```ts
  const sounds: PageSound[] = [];
  page.__cuttleSounds = sounds;

  // a transition's two frames: raw RGBA at the page's size, fetched before each frame is drawn
  let from: ImageBitmap | null = null;
  let to: ImageBitmap | null = null;
  const bitmapOf = async (url: string): Promise<ImageBitmap> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`a transition's frame could not be read (${response.status})`);
    return createImageBitmap(new ImageData(new Uint8ClampedArray(await response.arrayBuffer()), init.width, init.height));
  };

  const api: CuttleApi = {
    get from() {
      return from;
    },
    get to() {
      return to;
    },
    get progress() {
      return init.duration > 0 ? Math.min(1, Math.max(0, now / 1000 / init.duration)) : 1;
    },
    get time() {
      return now / 1000;
    },
```

In the same file, replace:

```ts
  /**
   * Moves the clock to `ms` (never back) and draws: due timers in order, one animation frame (and
   * the draws it returns promises for), every animation to its time. `next` is the frame's view of
   * the take (an overlay's). Answers with the draw's number, which the marker shows.
   */
  page.__cuttleDraw = (ms: number, next?: MotionView): Promise<number> => {
    if (next) view = next;
    sight();
    const target = Math.max(now, ms);
```

with:

```ts
  /**
   * Moves the clock to `ms` (never back) and draws: due timers in order, one animation frame (and
   * the draws it returns promises for), every animation to its time. `next` is the frame's view of
   * the take (an overlay's); `between`, a transition's two frames (their URLs), which become
   * `cuttle.from` and `cuttle.to` first. Answers with the draw's number, which the marker shows.
   */
  page.__cuttleDraw = (ms: number, next?: MotionView | null, between?: { from: string; to: string }): Promise<number> => {
    if (!between) return draw(ms, next);
    return Promise.all([bitmapOf(between.from), bitmapOf(between.to)]).then(([outgoing, incoming]) => {
      from?.close();
      to?.close();
      from = outgoing;
      to = incoming;
      return draw(ms, next);
    });
  };

  const draw = (ms: number, next?: MotionView | null): Promise<number> => {
    if (next) view = next;
    sight();
    const target = Math.max(now, ms);
```

In `packages/export/src/motion/init.ts`, replace:

```ts
import type { BackgroundPreset, CuttleProject, MotionOverlay, MotionScene } from '@cuttle/project';
import { TAKE_WORKER, type MotionInit } from './runtime';

/** A dark tone of each background preset, for pages that draw their own background. */
```

with:

```ts
import type { BackgroundPreset, CuttleProject, MotionOverlay, MotionScene, SceneTransition } from '@cuttle/project';
import { TAKE_WORKER, type MotionInit } from './runtime';

/** A dark tone of each background preset, for pages that draw their own background. */
```

In the same file, replace:

```ts
  take: MotionInit['take'];
  fonts: MotionInit['fonts'];
  defaults: Record<string, unknown>;
}

/**
```

with:

```ts
  take: MotionInit['take'];
  fonts: MotionInit['fonts'];
  defaults: Record<string, unknown>;
  /** A transition page (it is given the frames it goes between). */
  transition?: boolean;
}

/**
```

In the same file, replace:

```ts
 */
export function motionInit(
  project: CuttleProject,
  item: MotionScene | MotionOverlay,
  name: string,
  showing: { start: number; duration: number },
  context: MotionContext,
```

with:

```ts
 */
export function motionInit(
  project: CuttleProject,
  item: MotionScene | MotionOverlay | SceneTransition,
  name: string,
  showing: { start: number; duration: number },
  context: MotionContext,
```

In the same file, replace:

```ts
    format: formatName(project.output),
    params: { ...context.defaults, ...item.params },
    theme: motionTheme(project),
    seed: motionSeed(item.id ?? name),
    fonts: context.fonts,
    take: context.take,
    takeWorker: TAKE_WORKER,
  };
}
```

with:

```ts
    format: formatName(project.output),
    params: { ...context.defaults, ...item.params },
    theme: motionTheme(project),
    seed: motionSeed(('id' in item ? item.id : undefined) ?? name),
    fonts: context.fonts,
    take: context.take,
    takeWorker: TAKE_WORKER,
    ...(context.transition && { transition: true }),
  };
}
```

- [ ] **Step 3: The request, and the pages of the transitions**

In `packages/export/src/job.ts`, replace:

```ts
  scenes: Record<number, string>;
  /** Overlay index → its page. */
  overlays: Record<number, string>;
}

/** A motion page's frame: premultiplied RGBA, top row first (what the engine draws as `MotionPixels`). */
```

with:

```ts
  scenes: Record<number, string>;
  /** Overlay index → its page. */
  overlays: Record<number, string>;
  /** Scene index → the page of the transition into it. */
  transitions: Record<number, string>;
}

/** A motion page's frame: premultiplied RGBA, top row first (what the engine draws as `MotionPixels`). */
```

In the same file, replace:

```ts

/** A frame of one showing of a motion item, which the page asks the main process for. */
export interface MotionFrameRequest {
  /** The showing: `scene:<index>`, or `overlay:` and the overlay's `ActiveOverlay.key`. */
  key: string;
  kind: 'scene' | 'overlay';
  /** Its place in the project's `scenes` or `overlays`. */
  index: number;
  /** Frame n is n / fps seconds into the showing. */
  frame: number;
```

with:

```ts

/** A frame of one showing of a motion item, which the page asks the main process for. */
export interface MotionFrameRequest {
  /** The showing: `scene:<index>`, `overlay:` and the overlay's `ActiveOverlay.key`, or a transition's `ActiveTransition.key`. */
  key: string;
  kind: 'scene' | 'overlay' | 'transition';
  /** Its place in the project's `scenes` or `overlays` (a transition's: the scene it goes into). */
  index: number;
  /** Frame n is n / fps seconds into the showing. */
  frame: number;
```

In the same file, replace:

```ts
  screen: { width: number; height: number };
  /** An overlay's frame: where the clip under it shows the take. */
  view?: MotionView;
}

/** Everything the page needs for one export. Paths are absolute; the page may read only these files. */
```

with:

```ts
  screen: { width: number; height: number };
  /** An overlay's frame: where the clip under it shows the take. */
  view?: MotionView;
  /** A transition's frame: the outgoing and the incoming frame it draws from (the output's size, opaque). */
  between?: { from: MotionPixels; to: MotionPixels };
}

/** Everything the page needs for one export. Paths are absolute; the page may read only these files. */
```

In `packages/export/src/motion/requests.ts`, replace:

```ts
export interface MotionNeed {
  /** A scene's frame goes to `FrameSources.motion` by its layer, an overlay's to `overlays` by its showing. */
  target: { kind: 'scene'; layer: number } | { kind: 'overlay'; key: string };
  request: MotionFrameRequest;
}

/** Where a clip layer shows the take, for the overlays over it. `screen` is the screen recording's size. */
```

with:

```ts
export interface MotionNeed {
  /** A scene's frame goes to `FrameSources.motion` by its layer, an overlay's to `overlays` by its showing. */
  target: { kind: 'scene'; layer: number } | { kind: 'overlay'; key: string };
  /** A scene's or an overlay's frame (a transition's is asked for with the frames it goes between). */
  request: Omit<MotionFrameRequest, 'kind' | 'between'> & { kind: 'scene' | 'overlay' };
}

/** Where a clip layer shows the take, for the overlays over it. `screen` is the screen recording's size. */
```

In `packages/export/src/main/sources.ts`, replace:

```ts
 */
export async function motionPages(projectDir: string, project: CuttleProject): Promise<MotionPages | undefined> {
  const root = resolve(projectDir);
  const pages: MotionPages = { root, scenes: {}, overlays: {} };
  const page = async (src: string, name: string): Promise<string> => {
    const rel = relative(root, resolve(root, src));
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
```

with:

```ts
 */
export async function motionPages(projectDir: string, project: CuttleProject): Promise<MotionPages | undefined> {
  const root = resolve(projectDir);
  const pages: MotionPages = { root, scenes: {}, overlays: {}, transitions: {} };
  const page = async (src: string, name: string): Promise<string> => {
    const rel = relative(root, resolve(root, src));
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
```

In the same file, replace:

```ts
  };
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type === 'motion') pages.scenes[index] = await page(scene.src, `scenes[${index}]`);
  }
  for (const [index, overlay] of project.overlays.entries()) pages.overlays[index] = await page(overlay.src, `overlays[${index}]`);
  return Object.keys(pages.scenes).length + Object.keys(pages.overlays).length > 0 ? pages : undefined;
}

/**
```

with:

```ts
  };
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type === 'motion') pages.scenes[index] = await page(scene.src, `scenes[${index}]`);
    if (scene.transition?.enabled) pages.transitions[index] = await page(scene.transition.src, `scenes[${index}].transition`);
  }
  for (const [index, overlay] of project.overlays.entries()) pages.overlays[index] = await page(overlay.src, `overlays[${index}]`);
  const count = Object.keys(pages.scenes).length + Object.keys(pages.overlays).length + Object.keys(pages.transitions).length;
  return count > 0 ? pages : undefined;
}

/**
```

- [ ] **Step 4: The main process hands the frames over**

In `packages/export/src/main/motion.ts`, replace:

```ts
// page's transparency kept, the same on every render. The motion kit (Three.js, lottie-web, fonts,
// Cuttle's helpers) is served at cuttle-motion://kit/, and every page of the project gets an
// import map for its bare names (`three`, `cuttle`).
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
```

with:

```ts
// page's transparency kept, the same on every render. The motion kit (Three.js, lottie-web, fonts,
// Cuttle's helpers) is served at cuttle-motion://kit/, and every page of the project gets an
// import map for its bare names (`three`, `cuttle`).
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
```

In the same file, replace:

```ts
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

let sessions = 0;
/**
 * Sessions no page uses, by project folder, network switch and kit. Electron keeps every session for the
```

with:

```ts
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** The frames a transition page is drawing from, by `<page id>/from` and `/to`: served at cuttle-motion://frames/. */
const handed = new Map<string, MotionFrame>();

let sessions = 0;
/**
 * Sessions no page uses, by project folder, network switch and kit. Electron keeps every session for the
```

In the same file, replace:

```ts
  const policy = contentPolicy(network);
  ses.protocol.handle(MOTION_SCHEME, async (request) => {
    const url = new URL(request.url);
    const base = bases[url.host];
    const path = base === undefined ? undefined : resolve(base, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (base === undefined || path === undefined || !inside(base, path)) return new Response('not found', { status: 404 });
```

with:

```ts
  const policy = contentPolicy(network);
  ses.protocol.handle(MOTION_SCHEME, async (request) => {
    const url = new URL(request.url);
    // a transition's two frames, as raw RGBA at the page's size
    if (url.host === 'frames') {
      const frame = handed.get(decodeURIComponent(url.pathname).replace(/^\/+/, ''));
      if (!frame) return new Response('not found', { status: 404 });
      return new Response(frame.data as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Security-Policy': policy, 'Cache-Control': 'no-store' } });
    }
    const base = bases[url.host];
    const path = base === undefined ? undefined : resolve(base, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (base === undefined || path === undefined || !inside(base, path)) return new Response('not found', { status: 404 });
```

In the same file, replace:

```ts
  private latest: NativeImage | undefined;
  private waiting: (() => void) | undefined;
  private readonly logs: string[] = [];
  /** Paints so far, and how many of them were empty (to say why a frame never showed). */
  private paints = 0;
  private emptyPaints = 0;
```

with:

```ts
  private latest: NativeImage | undefined;
  private waiting: (() => void) | undefined;
  private readonly logs: string[] = [];
  /** Names this page's handed frames. */
  private readonly id = randomUUID();
  /** Paints so far, and how many of them were empty (to say why a frame never showed). */
  private paints = 0;
  private emptyPaints = 0;
```

In the same file, replace:

```ts
   * and the paint that shows it comes back; with motion blur, the average of the paints while the
   * shutter is open around it.
   */
  async frame(n: number, view?: MotionView): Promise<MotionFrame> {
    if (!Number.isInteger(n) || n < 0) throw new Error(`a motion frame is a whole number from 0, not ${n}`);
    if (n < this.drawn) throw new Error(`the motion page is past frame ${n} (it drew ${this.drawn}); open it again to go back`);
    if (n === this.drawn && this.last) return this.last;
    if (this.failure) throw new Error(this.failure);
    const { fps } = this.options.init;
    const blur = this.options.motionBlur;
    let frame: MotionFrame;
    if (!blur) frame = await this.paint((n * 1000) / fps, view, n);
    else {
      // the moments centred on the frame (never before 0): a frame's last comes before the next frame's first
      const moments = Array.from({ length: blur.samples }, (_, k) => Math.max(0, ((n + ((k + 0.5) / blur.samples - 0.5) * blur.shutter) * 1000) / fps));
```

with:

```ts
   * and the paint that shows it comes back; with motion blur, the average of the paints while the
   * shutter is open around it.
   */
  async frame(n: number, view?: MotionView, between?: { from: MotionFrame; to: MotionFrame }): Promise<MotionFrame> {
    if (!Number.isInteger(n) || n < 0) throw new Error(`a motion frame is a whole number from 0, not ${n}`);
    if (n < this.drawn) throw new Error(`the motion page is past frame ${n} (it drew ${this.drawn}); open it again to go back`);
    if (n === this.drawn && this.last) return this.last;
    if (this.failure) throw new Error(this.failure);
    const { fps } = this.options.init;
    const blur = this.options.motionBlur;
    // a transition's two frames: the page fetches them before it draws
    if (between) {
      handed.set(`${this.id}/from`, between.from);
      handed.set(`${this.id}/to`, between.to);
    }
    let frame: MotionFrame;
    if (!blur) frame = await this.paint((n * 1000) / fps, view, n, between !== undefined);
    else {
      // the moments centred on the frame (never before 0): a frame's last comes before the next frame's first
      const moments = Array.from({ length: blur.samples }, (_, k) => Math.max(0, ((n + ((k + 0.5) / blur.samples - 0.5) * blur.shutter) * 1000) / fps));
```

In the same file, replace:

```ts
  }

  /** The page drawn at `ms` on its clock, from the paint whose marker shows that draw. */
  private async paint(at: number, view: MotionView | undefined, n: number): Promise<MotionFrame> {
    const { init } = this.options;
    const ms = this.options.frameTimeout ?? FRAME_TIMEOUT_MS;
    const script = `window.__cuttleDraw(${at}${view ? `, ${JSON.stringify(view)}` : ''})`;
    const drawn = () => this.timed(this.win.webContents.executeJavaScript(script) as Promise<number>, ms, `to draw frame ${n}`);
    let draw = await drawn();
    const deadline = Date.now() + ms;
```

with:

```ts
  }

  /** The page drawn at `ms` on its clock, from the paint whose marker shows that draw. */
  private async paint(at: number, view: MotionView | undefined, n: number, between = false): Promise<MotionFrame> {
    const { init } = this.options;
    const ms = this.options.frameTimeout ?? FRAME_TIMEOUT_MS;
    const frames = between ? { from: `${MOTION_SCHEME}://frames/${this.id}/from`, to: `${MOTION_SCHEME}://frames/${this.id}/to` } : undefined;
    const script = `window.__cuttleDraw(${at}${view || frames ? `, ${JSON.stringify(view ?? null)}` : ''}${frames ? `, ${JSON.stringify(frames)}` : ''})`;
    const drawn = () => this.timed(this.win.webContents.executeJavaScript(script) as Promise<number>, ms, `to draw frame ${n}`);
    let draw = await drawn();
    const deadline = Date.now() + ms;
```

In the same file, replace:

```ts
  }

  close(): void {
    if (this.win.isDestroyed()) return;
    this.win.destroy();
    giveBack(this.ses, this.options.root, this.options.network === true, MotionPage.kitOf(this.options));
```

with:

```ts
  }

  close(): void {
    handed.delete(`${this.id}/from`);
    handed.delete(`${this.id}/to`);
    if (this.win.isDestroyed()) return;
    this.win.destroy();
    giveBack(this.ses, this.options.root, this.options.network === true, MotionPage.kitOf(this.options));
```

In `packages/export/src/main/motion-host.ts`, replace:

```ts
import { readFile } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { KIT_FONTS } from '@cuttle/motion-kit';
import type { CuttleProject, MotionOverlay, MotionScene } from '@cuttle/project';
import { CHANNELS, type MotionFrameRequest, type MotionPages } from '../job';
import { motionInit } from '../motion/init';
import { declaredParams, paramDefaults } from '../motion/params';
```

with:

```ts
import { readFile } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { KIT_FONTS } from '@cuttle/motion-kit';
import type { CuttleProject, MotionOverlay, MotionScene, SceneTransition } from '@cuttle/project';
import { CHANNELS, type MotionFrameRequest, type MotionPages } from '../job';
import { motionInit } from '../motion/init';
import { declaredParams, paramDefaults } from '../motion/params';
```

In the same file, replace:

```ts

/** What one motion item's page said while it rendered: its errors and its console, every showing together. */
export interface MotionItemReport {
  /** `scenes[2]` or `overlays[0]`. */
  item: string;
  /** The page, relative to the project folder (`/` between folders). */
  src: string;
```

with:

```ts

/** What one motion item's page said while it rendered: its errors and its console, every showing together. */
export interface MotionItemReport {
  /** `scenes[2]`, `overlays[0]` or `scenes[3].transition`. */
  item: string;
  /** The page, relative to the project folder (`/` between folders). */
  src: string;
```

In the same file, replace:

```ts
    private readonly options: Pick<MotionPageOptions, 'frameTimeout' | 'loadTimeout' | 'kitDir'> = {},
  ) {}

  private item(request: MotionFrameRequest): { item: MotionScene | MotionOverlay; name: string; file: string } {
    const name = `${request.kind === 'scene' ? 'scenes' : 'overlays'}[${request.index}]`;
    const item = request.kind === 'scene' ? this.project.scenes[request.index] : this.project.overlays[request.index];
    const file = (request.kind === 'scene' ? this.pages.scenes : this.pages.overlays)[request.index];
```

with:

```ts
    private readonly options: Pick<MotionPageOptions, 'frameTimeout' | 'loadTimeout' | 'kitDir'> = {},
  ) {}

  private item(request: MotionFrameRequest): { item: MotionScene | MotionOverlay | SceneTransition; name: string; file: string } {
    if (request.kind === 'transition') {
      const name = `scenes[${request.index}].transition`;
      const item = this.project.scenes[request.index]?.transition;
      const file = this.pages.transitions[request.index];
      if (!item || file === undefined) throw new Error(`${name} is not a transition page`);
      return { item, name, file };
    }
    const name = `${request.kind === 'scene' ? 'scenes' : 'overlays'}[${request.index}]`;
    const item = request.kind === 'scene' ? this.project.scenes[request.index] : this.project.overlays[request.index];
    const file = (request.kind === 'scene' ? this.pages.scenes : this.pages.overlays)[request.index];
```

In the same file, replace:

```ts
    return { item: item as MotionScene | MotionOverlay, name, file };
  }

  private async openPage(request: MotionFrameRequest, item: MotionScene | MotionOverlay, name: string, file: string, report: MotionItemReport): Promise<MotionPage> {
    // the params the page declares: their defaults, under the item's own values
    const declared = declaredParams(await readFile(file, 'utf8'));
    for (const issue of declared.issues) if (!report.errors.includes(issue)) report.errors.push(issue);
    const window = 'type' in item ? null : { from: item.at, to: item.at + item.duration };
    const init = motionInit(this.project, item, name, { start: request.start, duration: request.duration }, {
      take: takeData(this.project, this.take, request.screen, window),
      fonts: [...KIT_FONTS],
      defaults: paramDefaults(declared.params),
    });
    return MotionPage.open({ file, root: this.pages.root, init, network: item.network, ...(item.motionBlur && { motionBlur: item.motionBlur }), ...this.options });
  }

  private open(request: MotionFrameRequest): Showing {
```

with:

```ts
    return { item: item as MotionScene | MotionOverlay, name, file };
  }

  private async openPage(request: MotionFrameRequest, item: MotionScene | MotionOverlay | SceneTransition, name: string, file: string, report: MotionItemReport): Promise<MotionPage> {
    // the params the page declares: their defaults, under the item's own values
    const declared = declaredParams(await readFile(file, 'utf8'));
    for (const issue of declared.issues) if (!report.errors.includes(issue)) report.errors.push(issue);
    const window = request.kind === 'overlay' && 'at' in item ? { from: item.at, to: item.at + item.duration } : null;
    const init = motionInit(this.project, item, name, { start: request.start, duration: request.duration }, {
      take: takeData(this.project, this.take, request.screen, window),
      fonts: [...KIT_FONTS],
      defaults: paramDefaults(declared.params),
      transition: request.kind === 'transition',
    });
    const blur = 'motionBlur' in item ? item.motionBlur : undefined;
    return MotionPage.open({ file, root: this.pages.root, init, network: item.network, ...(blur && { motionBlur: blur }), ...this.options });
  }

  private open(request: MotionFrameRequest): Showing {
```

In the same file, replace:

```ts
    showing ??= this.open(request);
    showing.asked = Math.max(showing.asked, request.frame);
    try {
      const frame = await this.run(showing, (page) => page.frame(request.frame, request.view));
      showing.last = { frame: request.frame, data: frame };
      return frame;
    } catch (error) {
```

with:

```ts
    showing ??= this.open(request);
    showing.asked = Math.max(showing.asked, request.frame);
    try {
      const frame = await this.run(showing, (page) => page.frame(request.frame, request.view, request.between));
      showing.last = { frame: request.frame, data: frame };
      return frame;
    } catch (error) {
```

- [ ] **Step 5: Run the test**

Run: `pnpm exec vitest run --project browser packages/export/test/motion-runtime.browser.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/export/src packages/export/test/motion-runtime.browser.test.ts
git commit -m "export: a transition page gets the outgoing and the incoming frame (cuttle.from, cuttle.to, cuttle.progress)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The export page asks for a transition's frames

**Files:**
- Modify: `packages/export/src/page/scene-sources.ts`, `packages/export/src/page/run.ts`

- [ ] **Step 1: The sources**

In `packages/export/src/page/scene-sources.ts`, replace:

```ts
  private readonly pendingOverlays: OverlayPlan[];
  /** The last frame of the video (or of the stills). */
  private readonly lastFrame: number;
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };

  constructor(
    plan: FramePlan,
```

with:

```ts
  private readonly pendingOverlays: OverlayPlan[];
  /** The last frame of the video (or of the stills). */
  private readonly lastFrame: number;
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map(), transitions: new Map() };
  /** The transition pages' showings now open, by `ActiveTransition.key`. */
  private readonly transitions = new Set<string>();

  constructor(
    plan: FramePlan,
```

In the same file, replace:

```ts
    }
    // a motion item's page opens and draws its first frame while the frames before it are made
    for (const first of opened) if (first > frame) this.askAhead(first);
    const { screens, webcams, stills, motion, overlays } = this.sources;
    screens.clear();
    webcams.clear();
    stills.clear();
    motion.clear();
    overlays.clear();
    for (const layer of state.layers) {
      // decoders are opened per scene (`plan.index`), frames are handed over per layer
      const scene = this.open.get(layer.sceneIndex);
```

with:

```ts
    }
    // a motion item's page opens and draws its first frame while the frames before it are made
    for (const first of opened) if (first > frame) this.askAhead(first);
    const { screens, webcams, stills, motion, overlays, transitions } = this.sources;
    screens.clear();
    webcams.clear();
    stills.clear();
    motion.clear();
    overlays.clear();
    transitions!.clear();
    for (const layer of state.layers) {
      // decoders are opened per scene (`plan.index`), frames are handed over per layer
      const scene = this.open.get(layer.sceneIndex);
```

In the same file, replace:

```ts
    return this.sources;
  }

  /** Closes the scenes whose last frame was `frame`. */
  async release(frame: number): Promise<void> {
    for (const [index, scene] of this.open) {
```

with:

```ts
    return this.sources;
  }

  /**
   * The frame of the transition page that draws `state` (none without one), drawn in the main
   * process from the two layers, which `layers` reads from the renderer; a transition page that no
   * longer shows closes.
   */
  async transition(state: RenderState, layers: () => [MotionPixels, MotionPixels]): Promise<void> {
    const active = state.transition;
    for (const key of this.transitions) {
      if (key === active?.key) continue;
      this.transitions.delete(key);
      host().motionDone(key);
    }
    if (!active) return;
    const [from, to] = layers();
    this.transitions.add(active.key);
    const request: MotionFrameRequest = {
      key: active.key,
      kind: 'transition',
      index: active.sceneIndex,
      frame: Math.round(active.local * this.motion.project.output.fps),
      start: active.start,
      duration: active.duration,
      screen: this.screenSize,
      between: { from, to },
    };
    const pixels = await host()
      .motionFrame(request)
      .catch((error: unknown) => {
        throw new PageError('render', remoteMessage(error));
      });
    this.sources.transitions!.set(active.key, pixels);
  }

  /** Closes the scenes whose last frame was `frame`. */
  async release(frame: number): Promise<void> {
    for (const [index, scene] of this.open) {
```

In the same file, replace:

```ts
    this.open.clear();
    for (const overlay of this.overlays.values()) overlay.source.done();
    this.overlays.clear();
    await Promise.allSettled(scenes.map(closeScene));
  }
}
```

with:

```ts
    this.open.clear();
    for (const overlay of this.overlays.values()) overlay.source.done();
    this.overlays.clear();
    for (const key of this.transitions) host().motionDone(key);
    this.transitions.clear();
    await Promise.allSettled(scenes.map(closeScene));
  }
}
```

- [ ] **Step 2: The video's frames and the stills**

In `packages/export/src/page/run.ts`, replace:

```ts
        const t0 = performance.now();
        const state = timeline.frameAt(frame / fps);
        const frameSources = await sources.sourcesFor(frame, state);
        const t1 = performance.now();
        renderer.render(state, frameSources);
        // render() throws on a lost context too; this catches a loss between render and capture.
```

with:

```ts
        const t0 = performance.now();
        const state = timeline.frameAt(frame / fps);
        const frameSources = await sources.sourcesFor(frame, state);
        await sources.transition(state, () => renderer.layerPixels(state, frameSources));
        const t1 = performance.now();
        renderer.render(state, frameSources);
        // render() throws on a lost context too; this catches a loss between render and capture.
```

In the same file, replace:

```ts
      const unique = [...new Set(byTime)].sort((a, b) => a - b);
      for (const [done, frame] of unique.entries()) {
        const state = timeline.frameAt(frame / fps);
        renderer.render(state, await sources.sourcesFor(frame, state));
        if (gl.isContextLost()) throw new Error('the WebGL context was lost while rendering stills');
        const image = await png(canvas);
        for (const [n, frameOfTime] of byTime.entries()) {
```

with:

```ts
      const unique = [...new Set(byTime)].sort((a, b) => a - b);
      for (const [done, frame] of unique.entries()) {
        const state = timeline.frameAt(frame / fps);
        const frameSources = await sources.sourcesFor(frame, state);
        await sources.transition(state, () => renderer.layerPixels(state, frameSources));
        renderer.render(state, frameSources);
        if (gl.isContextLost()) throw new Error('the WebGL context was lost while rendering stills');
        const image = await png(canvas);
        for (const [n, frameOfTime] of byTime.entries()) {
```

- [ ] **Step 3: The typecheck of the export**

Run: `pnpm exec tsc -p packages/export/tsconfig.json`
Expected: exits with code 0.

- [ ] **Step 4: Commit**

```bash
git add packages/export/src/page
git commit -m "export: a transition's frames drawn from the layers by its page, in the video and the stills

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The fold, and a transition's sounds

**Files:**
- Create: `packages/motion-kit/templates/fold/index.html`
- Modify: `packages/motion-kit/src/index.ts`, `packages/motion-kit/test/kit.test.ts`, `packages/export/src/main/motion-sounds.ts`, `packages/export/test/main/motion-sounds.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/motion-kit/test/kit.test.ts`, replace:

```ts
    expect(withImportMap('<h1>Hi</h1>')).toBe(`${map}<h1>Hi</h1>`);
  });

  it('has a page for every template, and each says when it is one (a scene or an overlay)', () => {
    expect(MOTION_TEMPLATES.map((template) => template.name)).toEqual(['title', 'end-card', 'code-typing', 'device-3d', 'lower-third', 'click-callouts', 'kinetic-captions']);
    for (const template of MOTION_TEMPLATES) {
      const file = `${TEMPLATES}${template.name}/index.html`;
      expect(existsSync(file), template.name).toBe(true);
```

with:

```ts
    expect(withImportMap('<h1>Hi</h1>')).toBe(`${map}<h1>Hi</h1>`);
  });

  it('has a page for every template, and each says when it is one (a scene, an overlay or a transition)', () => {
    expect(MOTION_TEMPLATES.map((template) => template.name)).toEqual(['title', 'end-card', 'code-typing', 'device-3d', 'fold', 'lower-third', 'click-callouts', 'kinetic-captions']);
    expect(MOTION_TEMPLATES.find((template) => template.name === 'fold')?.kind).toBe('transition');
    for (const template of MOTION_TEMPLATES) {
      const file = `${TEMPLATES}${template.name}/index.html`;
      expect(existsSync(file), template.name).toBe(true);
```

In the same file, replace:

```ts
      expect(html, template.name).toContain('params.sounds !== false');
      for (const name of asked) expect(names.has(name), `${template.name}: ${name}`).toBe(true);
    }
    expect(making).toEqual(['title', 'end-card', 'code-typing', 'device-3d', 'lower-third', 'click-callouts']);
  });

  it('has a page for every music template that composes with cuttle.music and declares its params', () => {
```

with:

```ts
      expect(html, template.name).toContain('params.sounds !== false');
      for (const name of asked) expect(names.has(name), `${template.name}: ${name}`).toBe(true);
    }
    expect(making).toEqual(['title', 'end-card', 'code-typing', 'device-3d', 'fold', 'lower-third', 'click-callouts']);
  });

  it('has a page for every music template that composes with cuttle.music and declares its params', () => {
```

In `packages/export/test/main/motion-sounds.test.ts`, replace:

```ts
      { kind: 'overlay', index: 0, showings: [{ start: 8, duration: 2 }, { start: 13, duration: 2 }] },
    ]);
  });
});

describe('the sounds a page asked for, on the video', () => {
```

with:

```ts
      { kind: 'overlay', index: 0, showings: [{ start: 8, duration: 2 }, { start: 13, duration: 2 }] },
    ]);
  });

  it('gives a transition the seconds around the cut into its scene, and none where there is no cut to go through', () => {
    const fold = { src: 'motion/fold/index.html', duration: 1 };
    const folded = project({
      scenes: [
        { type: 'motion', id: 's1', src: 'motion/intro/index.html', duration: 2 },
        { type: 'clip', id: 's2', from: 10, to: 20, transition: fold },
        { type: 'clip', id: 's3', from: 15, to: 25, transition: fold },
        { type: 'card', id: 's4', title: 'Cuttle', duration: 3, transition: fold },
      ],
    });
    // into s2 at 2 s, into s3 at 12 s (source 20 to 15: a jump, not a continuous cut) and into the card at 22 s
    const showings = motionShowings(folded).filter((shown) => shown.kind === 'transition');
    expect(showings.map(({ index, showings }) => ({ index, showings }))).toEqual([
      { index: 1, showings: [{ start: 1.5, duration: 1 }] },
      { index: 2, showings: [{ start: 11.5, duration: 1 }] },
      { index: 3, showings: [{ start: 21.5, duration: 1 }] },
    ]);
  });
});

describe('the sounds a page asked for, on the video', () => {
```

In the same file, replace:

```ts
  });

  it('asks no page while the sound or the effects are off, or without pages', async () => {
    const pages = { root: '.', scenes: { 0: 'motion/intro/index.html' }, overlays: {} };
    const take = { events: [], words: [], markers: [] };
    expect(await motionSoundCues(video, undefined, take)).toEqual({ cues: [], errors: [], items: [] });
    const off = { ...video, look: { ...video.look, audio: { ...video.look.audio, effects: false } } };
```

with:

```ts
  });

  it('asks no page while the sound or the effects are off, or without pages', async () => {
    const pages = { root: '.', scenes: { 0: 'motion/intro/index.html' }, overlays: {}, transitions: {} };
    const take = { events: [], words: [], markers: [] };
    expect(await motionSoundCues(video, undefined, take)).toEqual({ cues: [], errors: [], items: [] });
    const off = { ...video, look: { ...video.look, audio: { ...video.look.audio, effects: false } } };
```

Run: `pnpm exec vitest run --project node packages/motion-kit/test/kit.test.ts packages/export/test/main/motion-sounds.test.ts`
Expected: FAIL: there is no fold template, and transitions have no showings.

- [ ] **Step 2: The page**

`packages/motion-kit/templates/fold/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Fold</title>
    <!-- A transition: the outgoing frame is turned over its middle like a page. One half lifts and
         folds over onto the other, in 3D, showing the incoming frame beneath it; its back is the
         rest of the incoming frame, so when it lands the new scene is whole. A shadow runs ahead of
         the fold, and a whoosh goes with it (the "sounds" param). -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "direction", "label": "Turns towards", "type": "select", "default": "left", "options": ["left", "right"] },
        { "name": "depth", "label": "Depth of the turn", "type": "number", "default": 0.5, "min": 0.2, "max": 1.5 },
        { "name": "sounds", "label": "Sounds", "type": "bool", "default": true }
      ]
    </script>
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: #000;
      }
      canvas {
        display: block;
      }
    </style>
  </head>
  <body>
    <script type="module">
      import * as THREE from 'three';
      import { ease } from 'cuttle';

      const { params, size, duration } = cuttle;
      const w = size.width;
      const h = size.height;
      // turning left: the right half turns over the middle onto the left one; right: the other way
      const toLeft = params.direction !== 'right';
      const depth = Math.min(1.5, Math.max(0.2, Number(params.depth) || 0.5));

      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(w, h);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      document.body.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      // a camera that shows the plane z = 0 pixel for pixel, with perspective for what leaves it
      const fov = 30;
      const camera = new THREE.PerspectiveCamera(fov, w / h, 1, 20 * w);
      camera.position.set(0, 0, h / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2)) / depth);
      camera.lookAt(0, 0, 0);
      camera.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(h / 2 / camera.position.z));
      camera.updateProjectionMatrix();

      const texture = () => {
        const map = new THREE.Texture();
        map.colorSpace = THREE.SRGBColorSpace;
        map.flipY = false;
        map.generateMipmaps = false;
        map.minFilter = THREE.LinearFilter;
        return map;
      };
      const fromMap = texture();
      const toMap = texture();

      /** A plane `width` px wide showing the part `u0`–`u1` of a frame (top row at v = 0), its left edge at x = 0. */
      function half(map, u0, u1) {
        const geometry = new THREE.PlaneGeometry(w / 2, h);
        geometry.translate(w / 4, 0, 0);
        const uv = geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), 1 - uv.getY(i));
        return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map, toneMapped: false }));
      }

      // what stays: the half the page lands on (the outgoing frame) and the half it uncovers (the incoming one)
      const stays = half(fromMap, toLeft ? 0 : 0.5, toLeft ? 0.5 : 1);
      stays.position.x = toLeft ? -w / 2 : 0;
      const uncovered = half(toMap, toLeft ? 0.5 : 0, toLeft ? 1 : 0.5);
      uncovered.position.x = toLeft ? 0 : -w / 2;
      // the page: the outgoing half on its front, the incoming frame's other half on its back, turning about the middle
      const page = new THREE.Group();
      const front = half(fromMap, toLeft ? 0.5 : 0, toLeft ? 1 : 0.5);
      const back = half(toMap, toLeft ? 0 : 0.5, toLeft ? 0.5 : 1);
      // the back lies where the front does, facing the other way
      back.rotation.y = Math.PI;
      if (toLeft) back.position.x = w / 2;
      else front.position.x = -w / 2;
      page.add(front, back);
      page.position.z = 0.5;

      // a shadow on what the page is about to cover, and one it casts on what it leaves
      const shade = (stops) => {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 2;
        const g = canvas.getContext('2d');
        const gradient = g.createLinearGradient(0, 0, 256, 0);
        for (const [at, alpha] of stops) gradient.addColorStop(at, `rgba(0,0,0,${alpha})`);
        g.fillStyle = gradient;
        g.fillRect(0, 0, 256, 2);
        const map = new THREE.CanvasTexture(canvas);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w / 2, h), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }));
        mesh.position.z = 0.25;
        return mesh;
      };
      // darkest at the fold, fading away from it
      const ahead = shade(toLeft ? [[0, 0], [1, 0.75]] : [[0, 0.75], [1, 0]]);
      ahead.position.x = toLeft ? -w / 4 : w / 4;
      const behind = shade(toLeft ? [[0, 0.6], [1, 0]] : [[0, 0], [1, 0.6]]);
      behind.position.x = toLeft ? w / 4 : -w / 4;
      scene.add(stays, uncovered, ahead, behind, page);

      if (params.sounds !== false) cuttle.sound('whoosh', { at: duration * 0.5, volume: 0.6 });

      const shown = { from: null, to: null };
      cuttle.onFrame(() => {
        const { from, to } = cuttle;
        // checked alone (no frames to go between), the page draws nothing
        if (!from || !to) return renderer.clear();
        if (shown.from !== from) {
          fromMap.image = from;
          fromMap.needsUpdate = true;
          shown.from = from;
        }
        if (shown.to !== to) {
          toMap.image = to;
          toMap.needsUpdate = true;
          shown.to = to;
        }
        const p = ease.inOut(cuttle.progress);
        const angle = p * Math.PI;
        page.rotation.y = toLeft ? -angle : angle;
        // the page darkens as it stands on edge, and lifts a little off the table
        const edge = Math.sin(angle);
        front.material.color.setScalar(1 - 0.45 * edge * (toLeft ? 1 : 0.8));
        back.material.color.setScalar(1 - 0.45 * edge);
        page.position.z = 0.5 + edge * 40 * depth;
        // the shadows: strongest while the page stands, gone when it lies flat
        ahead.material.opacity = edge * (p < 0.5 ? 1 : 1 - (p - 0.5) * 1.6);
        behind.material.opacity = edge * (p < 0.5 ? 1 - p : 0.5);
        renderer.render(scene, camera);
      });
    </script>
  </body>
</html>
```

- [ ] **Step 3: In the list**

In `packages/motion-kit/src/index.ts`, replace:

```ts
/** A template `cuttle motion new` copies: a scene of its own, or an overlay over the clips. */
export interface MotionTemplate {
  name: string;
  kind: 'scene' | 'overlay';
  /** Seconds it lasts when added: a scene's output seconds, an overlay's source seconds. */
  duration: number;
  /** An overlay that belongs over the whole take (it follows the take itself). */
  whole?: boolean;
```

with:

```ts
/** A template `cuttle motion new` copies: a scene of its own, or an overlay over the clips. */
export interface MotionTemplate {
  name: string;
  kind: 'scene' | 'overlay' | 'transition';
  /** Seconds it lasts when added: a scene's or a transition's output seconds, an overlay's source seconds. */
  duration: number;
  /** An overlay that belongs over the whole take (it follows the take itself). */
  whole?: boolean;
```

In the same file, replace:

```ts
  { name: 'end-card', kind: 'scene', duration: 4, description: 'the end card: a logo or monogram that lands with a hit, a line, the URL in a pill that types itself (keys, a ding), a call to action' },
  { name: 'code-typing', kind: 'scene', duration: 6, description: 'a code editor that types a file with syntax colours, line by line, keys clattering' },
  { name: 'device-3d', kind: 'scene', duration: 5, description: 'a laptop or tablet in 3D whose screen plays the take: it turns in as the lid opens, then flies into the screen' },
  { name: 'lower-third', kind: 'overlay', duration: 4, description: 'a name and a role in a bar that wipes in (a swoosh) and out' },
  { name: 'click-callouts', kind: 'overlay', duration: 0, whole: true, description: 'a ring, a number and a pop at every click the video shows, on the click' },
  { name: 'kinetic-captions', kind: 'overlay', duration: 0, whole: true, description: 'the spoken words, word by word, the current one in the accent colour' },
```

with:

```ts
  { name: 'end-card', kind: 'scene', duration: 4, description: 'the end card: a logo or monogram that lands with a hit, a line, the URL in a pill that types itself (keys, a ding), a call to action' },
  { name: 'code-typing', kind: 'scene', duration: 6, description: 'a code editor that types a file with syntax colours, line by line, keys clattering' },
  { name: 'device-3d', kind: 'scene', duration: 5, description: 'a laptop or tablet in 3D whose screen plays the take: it turns in as the lid opens, then flies into the screen' },
  { name: 'fold', kind: 'transition', duration: 0.9, description: 'the way into a scene: the outgoing frame turns over its middle like a page, onto the incoming one' },
  { name: 'lower-third', kind: 'overlay', duration: 4, description: 'a name and a role in a bar that wipes in (a swoosh) and out' },
  { name: 'click-callouts', kind: 'overlay', duration: 0, whole: true, description: 'a ring, a number and a pop at every click the video shows, on the click' },
  { name: 'kinetic-captions', kind: 'overlay', duration: 0, whole: true, description: 'the spoken words, word by word, the current one in the accent colour' },
```

- [ ] **Step 4: Its sounds in its window**

In `packages/export/src/main/motion-sounds.ts`, replace:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { KIT_FONTS } from '@cuttle/motion-kit';
import type { CuttleProject, MotionOverlay, MotionScene } from '@cuttle/project';
import { occurrences, sceneSpans } from '@cuttle/timeline';
import type { MotionPages } from '../job';
import { motionInit } from '../motion/init';
import { declaredParams, paramDefaults } from '../motion/params';
```

with:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { KIT_FONTS } from '@cuttle/motion-kit';
import type { CuttleProject, MotionOverlay, MotionScene, SceneTransition } from '@cuttle/project';
import { crossfadeHalf, occurrences, pageTransition, sceneSpans } from '@cuttle/timeline';
import type { MotionPages } from '../job';
import { motionInit } from '../motion/init';
import { declaredParams, paramDefaults } from '../motion/params';
```

In the same file, replace:

```ts

const milli = (value: number) => Math.round(value * 1000) / 1000;

/** Each showing of each motion item: a scene's one, an overlay's per stretch of clips that shows it. */
export function motionShowings(project: CuttleProject): { kind: 'scene' | 'overlay'; index: number; item: MotionScene | MotionOverlay; showings: Showing[] }[] {
  const spans = sceneSpans(project.scenes, project.cuts);
  const out: ReturnType<typeof motionShowings> = [];
  project.scenes.forEach((scene, index) => {
```

with:

```ts

const milli = (value: number) => Math.round(value * 1000) / 1000;

/** A motion item: a scene, an overlay, or the transition into a scene (`index` is that scene's). */
export type ShownItem = { kind: 'scene'; index: number; item: MotionScene } | { kind: 'overlay'; index: number; item: MotionOverlay } | { kind: 'transition'; index: number; item: SceneTransition };

/**
 * Each showing of each motion item: a scene's one, an overlay's per stretch of clips that shows it, a
 * transition's around the cut into its scene.
 */
export function motionShowings(project: CuttleProject): (ShownItem & { showings: Showing[] })[] {
  const spans = sceneSpans(project.scenes, project.cuts);
  const out: ReturnType<typeof motionShowings> = [];
  project.scenes.forEach((scene, index) => {
```

In the same file, replace:

```ts
    const span = spans.find((candidate) => candidate.sceneIndex === index);
    if (span) out.push({ kind: 'scene', index, item: scene, showings: [{ start: span.start, duration: span.end - span.start }] });
  });
  project.overlays.forEach((overlay, index) => {
    if (!overlay.enabled) return;
    const shown = [...new Set(occurrences(spans, overlay.at, overlay.at + overlay.duration).filter((occurrence) => occurrence !== undefined))];
```

with:

```ts
    const span = spans.find((candidate) => candidate.sceneIndex === index);
    if (span) out.push({ kind: 'scene', index, item: scene, showings: [{ start: span.start, duration: span.end - span.start }] });
  });
  project.scenes.forEach((scene, index) => {
    const into = scene.transition ? spans.find((candidate) => candidate.sceneIndex === index) : undefined;
    const before = into ? spans[into.index - 1] : undefined;
    if (!scene.transition || !into || !before || !pageTransition(before, into, project.look.transition)) return;
    const half = crossfadeHalf(before, into, project.look.transition);
    out.push({ kind: 'transition', index, item: scene.transition, showings: [{ start: into.start - half, duration: 2 * half }] });
  });
  project.overlays.forEach((overlay, index) => {
    if (!overlay.enabled) return;
    const shown = [...new Set(occurrences(spans, overlay.at, overlay.at + overlay.duration).filter((occurrence) => occurrence !== undefined))];
```

In the same file, replace:

```ts

/** The sounds one motion item's page asked for, on the video: `name` is its label, else its id or `scenes[0]`. */
export interface ItemSounds {
  kind: 'scene' | 'overlay';
  index: number;
  name: string;
  cues: SoundCue[];
```

with:

```ts

/** The sounds one motion item's page asked for, on the video: `name` is its label, else its id or `scenes[0]`. */
export interface ItemSounds {
  kind: ShownItem['kind'];
  index: number;
  name: string;
  cues: SoundCue[];
```

In the same file, replace:

```ts
  const errors: string[] = [];
  const items: ItemSounds[] = [];
  for (const { kind, index, item, showings } of motionShowings(project)) {
    const file = (kind === 'scene' ? pages.scenes : pages.overlays)[index];
    if (file === undefined || !(await asksForSounds(file))) continue;
    const name = `${kind === 'scene' ? 'scenes' : 'overlays'}[${index}]`;
    const first = showings[0]!;
    const key = JSON.stringify({ file, item, first, changes: options.changes ?? 0 });
    let sounds = options.cache?.get(key);
```

with:

```ts
  const errors: string[] = [];
  const items: ItemSounds[] = [];
  for (const { kind, index, item, showings } of motionShowings(project)) {
    const file = (kind === 'scene' ? pages.scenes : kind === 'overlay' ? pages.overlays : pages.transitions)[index];
    if (file === undefined || !(await asksForSounds(file))) continue;
    const name = kind === 'transition' ? `scenes[${index}].transition` : `${kind === 'scene' ? 'scenes' : 'overlays'}[${index}]`;
    const first = showings[0]!;
    const key = JSON.stringify({ file, item, first, changes: options.changes ?? 0 });
    let sounds = options.cache?.get(key);
```

In the same file, replace:

```ts
      let page: MotionPage | undefined;
      try {
        const declared = declaredParams(await readFile(file, 'utf8'));
        const window = 'type' in item ? null : { from: item.at, to: item.at + item.duration };
        const init = motionInit(project, item, name, first, {
          take: takeData(project, take, { width: project.output.width, height: project.output.height }, window),
          fonts: [...KIT_FONTS],
          defaults: paramDefaults(declared.params),
        });
        const { kitDir, loadTimeout, frameTimeout } = options;
        page = await MotionPage.open({ file, root: pages.root, init, network: item.network, ...(kitDir && { kitDir }), ...(loadTimeout && { loadTimeout }), ...(frameTimeout && { frameTimeout }) });
```

with:

```ts
      let page: MotionPage | undefined;
      try {
        const declared = declaredParams(await readFile(file, 'utf8'));
        const window = kind === 'overlay' ? { from: item.at, to: item.at + item.duration } : null;
        const init = motionInit(project, item, name, first, {
          take: takeData(project, take, { width: project.output.width, height: project.output.height }, window),
          fonts: [...KIT_FONTS],
          defaults: paramDefaults(declared.params),
          transition: kind === 'transition',
        });
        const { kitDir, loadTimeout, frameTimeout } = options;
        page = await MotionPage.open({ file, root: pages.root, init, network: item.network, ...(kitDir && { kitDir }), ...(loadTimeout && { loadTimeout }), ...(frameTimeout && { frameTimeout }) });
```

In the same file, replace:

```ts
      }
    }
    const played = soundsOfShowings(showings, sounds);
    if (played.length > 0) items.push({ kind, index, name: item.label ?? item.id ?? name, cues: played });
    cues.push(...played);
  }
  return { cues: cues.sort((a, b) => a.at - b.at), errors, items };
```

with:

```ts
      }
    }
    const played = soundsOfShowings(showings, sounds);
    const into = project.scenes[index];
    const label = kind === 'transition' ? `Transition into ${into?.label ?? into?.id ?? `scenes[${index}]`}` : (item.label ?? item.id ?? name);
    if (played.length > 0) items.push({ kind, index, name: label, cues: played });
    cues.push(...played);
  }
  return { cues: cues.sort((a, b) => a.at - b.at), errors, items };
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node packages/motion-kit/test/kit.test.ts packages/export/test/main/motion-sounds.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/motion-kit packages/export/src/main/motion-sounds.ts packages/export/test/main/motion-sounds.test.ts
git commit -m "kit: the fold transition turns the outgoing frame over like a page; a transition page's sounds play in its window

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `motion new --into` and `motion check` of a transition

**Files:**
- Modify: `apps/cli/src/main.ts`, `apps/cli/src/commands/motion.ts`, `apps/cli/src/electron/main.ts`, `apps/cli/src/electron/protocol.ts`, `apps/cli/test/electron.check.test.ts`

- [ ] **Step 1: Write the failing check**

A card and a clip, `motion new fold --into s2`: checked as a transition in the video, rendered, and at the cut the picture is the page's, not a crossfade:

In `apps/cli/test/electron.check.test.ts`, replace:

```ts
    }
  }, 180_000);

  it('blurs fast motion: the moments while the shutter is open, averaged', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-blur-')), 'blur');
    try {
```

with:

```ts
    }
  }, 180_000);

  it('goes into a scene through its transition page: the fold turns the card over onto the clip', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-fold-')), 'fold');
    cpSync(project, dir, { recursive: true });
    try {
      const file = join(dir, 'cuttle.json');
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      writeFileSync(file, JSON.stringify({ ...raw, scenes: [{ type: 'card', id: 's1', title: 'Before', duration: 2 }, { type: 'clip', id: 's2', from: 0, to: 2.5 }], overlays: [] }));
      expect(cuttle('-C', dir, 'motion', 'new', 'fold', '--into', 's1').code).toBe(1);
      const added = cuttle('-C', dir, 'motion', 'new', 'fold', '--into', 's2');
      expect(added.json).toMatchObject({ kind: 'transition', into: 1, item: { src: 'motion/fold/index.html', duration: 0.9 } });
      // checked in the video, between the card and the clip: 1.55 to 2.45 s
      const checked = cuttle('-C', dir, 'motion', 'check', 'motion/fold/index.html');
      expect(checked.json).toMatchObject({ kind: 'transition', duration: 0.9, errors: [] });
      const { json } = cuttle('-C', dir, 'render');
      expect(json.motion).toEqual([{ item: 'scenes[1].transition', src: 'motion/fold/index.html', errors: [], console: [] }]);
      // in the middle of the turn the picture is the page's, not a crossfade of the two scenes
      const still = (name: string) => PNG.sync.read(readFileSync((cuttle('-C', dir, 'preview', '--at', '1.98', '-o', join(dir, name)).json.stills as { file: string }[])[0]!.file));
      const folded = still('folded');
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), look: { transition: { enabled: true, duration: 0.9 } }, scenes: [{ type: 'card', id: 's1', title: 'Before', duration: 2 }, { type: 'clip', id: 's2', from: 0, to: 2.5 }] }));
      const faded = still('faded');
      let differ = 0;
      for (let i = 0; i < folded.data.length; i += 4 * 97) if (Math.abs(folded.data[i]! - faded.data[i]!) + Math.abs(folded.data[i + 1]! - faded.data[i + 1]!) > 60) differ++;
      expect(differ / (folded.data.length / (4 * 97))).toBeGreaterThan(0.2);
    } finally {
      rmSync(dirname(dir), { recursive: true, force: true });
    }
  }, 180_000);

  it('blurs fast motion: the moments while the shutter is open, averaged', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-blur-')), 'blur');
    try {
```

- [ ] **Step 2: The commands**

In `apps/cli/src/main.ts`, replace:

```ts
  const motion = program.command('motion').description('motion pages: scenes and overlays drawn by code (HTML, CSS, canvas, WebGL)');
  motion
    .command('new <template>')
    .description('copy a template into motion/<name>/ and add it: a scene at the end, or an overlay over the clips (motion templates lists them)')
    .option('--name <name>', 'the folder in motion/ (default: the template\'s name)')
    .option('--at <seconds>', 'an overlay\'s start, in source seconds (default: the first clip\'s start)', seconds)
    .option('--duration <seconds>', 'how long it lasts (default: the template\'s; a callout or caption overlay: the whole take)', positive)
    .option('--first', 'a scene goes first instead of last (an intro)')
    .action(action((output, project, template: string, options: { name?: string; at?: number; duration?: number; first?: boolean }) => motionNewCommand(project, template, options, output)));
  motion
    .command('templates')
    .description('the templates motion new copies: their kind and what they show')
```

with:

```ts
  const motion = program.command('motion').description('motion pages: scenes and overlays drawn by code (HTML, CSS, canvas, WebGL)');
  motion
    .command('new <template>')
    .description('copy a template into motion/<name>/ and add it: a scene at the end, an overlay over the clips, or the transition into a scene (motion templates lists them)')
    .option('--name <name>', 'the folder in motion/ (default: the template\'s name)')
    .option('--at <seconds>', 'an overlay\'s start, in source seconds (default: the first clip\'s start)', seconds)
    .option('--duration <seconds>', 'how long it lasts (default: the template\'s; a callout or caption overlay: the whole take)', positive)
    .option('--first', 'a scene goes first instead of last (an intro)')
    .option('--into <scene>', 'a transition: the scene it leads into, by id or place from 0 (default: the second scene)')
    .action(action((output, project, template: string, options: { name?: string; at?: number; duration?: number; first?: boolean; into?: string }) => motionNewCommand(project, template, options, output)));
  motion
    .command('templates')
    .description('the templates motion new copies: their kind and what they show')
```

In `apps/cli/src/commands/motion.ts`, replace:

```ts
import { MOTION_TEMPLATES, type MotionTemplate } from '@cuttle/motion-kit';
import { copyTemplate, MissingTemplateError } from '@cuttle/motion-kit/files';
import { newId, usedIds, type MotionScene } from '@cuttle/project';
import { occurrences, sceneSpans } from '@cuttle/timeline';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { MotionCheck } from '../electron/protocol';
```

with:

```ts
import { MOTION_TEMPLATES, type MotionTemplate } from '@cuttle/motion-kit';
import { copyTemplate, MissingTemplateError } from '@cuttle/motion-kit/files';
import { newId, usedIds, type MotionScene } from '@cuttle/project';
import { crossfadeHalf, occurrences, sceneSpans } from '@cuttle/timeline';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { MotionCheck } from '../electron/protocol';
```

In the same file, replace:

```ts
export interface MotionCheckResult extends Omit<PreviewResult, 'motion'> {
  /** The page, relative to the project folder. */
  src: string;
  /** A scene of its own, or an overlay over the video (checked where the video first shows it). */
  kind: 'scene' | 'overlay';
  /** Seconds it lasts; an overlay's stills are at output seconds of the video. */
  duration: number;
  /** The page's uncaught errors and rejections, and its console. */
```

with:

```ts
export interface MotionCheckResult extends Omit<PreviewResult, 'motion'> {
  /** The page, relative to the project folder. */
  src: string;
  /** A scene of its own, an overlay over the video (checked where the video first shows it), or a transition (between its two scenes). */
  kind: 'scene' | 'overlay' | 'transition';
  /** Seconds it lasts; an overlay's stills are at output seconds of the video. */
  duration: number;
  /** The page's uncaught errors and rejections, and its console. */
```

In the same file, replace:

```ts
  const scene = project.scenes.find((candidate): candidate is MotionScene => candidate.type === 'motion' && same(candidate.src));
  const overlayIndex = scene ? -1 : project.overlays.findIndex((overlay) => same(overlay.src));
  const overlay = project.overlays[overlayIndex];
  const item = scene ?? overlay;
  // an overlay: the output seconds where the video first shows its stretch of the take
  let from = 0;
  let duration = args.duration ?? item?.duration ?? DEFAULT_SECONDS;
```

with:

```ts
  const scene = project.scenes.find((candidate): candidate is MotionScene => candidate.type === 'motion' && same(candidate.src));
  const overlayIndex = scene ? -1 : project.overlays.findIndex((overlay) => same(overlay.src));
  const overlay = project.overlays[overlayIndex];
  const transitionIndex = scene || overlay ? -1 : project.scenes.findIndex((candidate) => candidate.transition?.enabled && same(candidate.transition.src));
  const transition = project.scenes[transitionIndex]?.transition;
  const item = scene ?? overlay ?? transition;
  // an overlay: the output seconds where the video first shows its stretch of the take
  let from = 0;
  let duration = args.duration ?? item?.duration ?? DEFAULT_SECONDS;
```

In the same file, replace:

```ts
    from = shown.start;
    duration = Math.round((shown.end - shown.start) * 1000) / 1000;
  }
  const last = Math.max(0, duration - 1 / project.output.fps);
  const offsets = args.at && args.at.length > 0 ? args.at : Array.from({ length: CHECK_FRAMES }, (_, i) => Math.round((i * last * 1000) / (CHECK_FRAMES - 1)) / 1000);
  const late = offsets.find((t) => t >= duration);
```

with:

```ts
    from = shown.start;
    duration = Math.round((shown.end - shown.start) * 1000) / 1000;
  }
  // a transition: the seconds around its cut, where it draws the video
  if (transition) {
    const spans = sceneSpans(project.scenes, project.cuts);
    const into = spans.find((span) => span.sceneIndex === transitionIndex);
    const before = into ? spans[into.index - 1] : undefined;
    const half = into && before ? crossfadeHalf(before, into, project.look.transition) : 0;
    if (!into || !before || half === 0) throw new CliError('invalid-project', `the video goes into scenes[${transitionIndex}] without its transition (${page}): it is the first scene, or right after a cut`);
    from = Math.round((into.start - half) * 1000) / 1000;
    duration = Math.round(2 * half * 1000) / 1000;
  }
  const last = Math.max(0, duration - 1 / project.output.fps);
  const offsets = args.at && args.at.length > 0 ? args.at : Array.from({ length: CHECK_FRAMES }, (_, i) => Math.round((i * last * 1000) / (CHECK_FRAMES - 1)) / 1000);
  const late = offsets.find((t) => t >= duration);
```

In the same file, replace:

```ts
    duration,
    params: item?.params ?? {},
    network: item?.network ?? false,
    ...(item?.motionBlur && { motionBlur: item.motionBlur }),
    ...(overlay && { overlay: overlayIndex }),
  };
  output.info(`rendering ${times.length} frame(s) of ${page} into ${outDir} …`);
  const result = await runInElectron<PreviewResult>(
```

with:

```ts
    duration,
    params: item?.params ?? {},
    network: item?.network ?? false,
    ...(item && 'motionBlur' in item && item.motionBlur && { motionBlur: item.motionBlur }),
    ...(overlay && { overlay: overlayIndex }),
    ...(transition && { transition: transitionIndex }),
  };
  output.info(`rendering ${times.length} frame(s) of ${page} into ${outDir} …`);
  const result = await runInElectron<PreviewResult>(
```

In the same file, replace:

```ts
    },
    signal,
  );
  const said = result.motion?.[0];
  const { motion: _reports, ...rest } = result;
  const checked: MotionCheckResult = { ...rest, src: page, kind: overlay ? 'overlay' : 'scene', duration, errors: said?.errors ?? [], console: said?.console ?? [] };
  output.result(checked, () =>
    [
      `${page}: ${overlay ? `an overlay over the video, ${from.toFixed(2)}–${(from + duration).toFixed(2)} s` : `${duration} s`}, ${checked.width}×${checked.height}`,
      ...checked.stills.map((still) => `${still.t.toFixed(2)} s  ${still.file}`),
      ...(checked.sheet ? [`sheet  ${checked.sheet}`] : []),
      checked.errors.length > 0 ? `errors:\n${checked.errors.map((line) => `  ${line}`).join('\n')}` : 'no errors',
```

with:

```ts
    },
    signal,
  );
  // what this page said (a transition is checked in the whole video, among the other pages)
  const said = result.motion?.find((report) => report.src === page) ?? (transition ? undefined : result.motion?.[0]);
  const { motion: _reports, ...rest } = result;
  const kind = overlay ? 'overlay' : transition ? 'transition' : 'scene';
  const checked: MotionCheckResult = { ...rest, src: page, kind, duration, errors: said?.errors ?? [], console: said?.console ?? [] };
  output.result(checked, () =>
    [
      `${page}: ${overlay ? `an overlay over the video, ${from.toFixed(2)}–${(from + duration).toFixed(2)} s` : transition ? `the transition into scenes[${transitionIndex}], ${from.toFixed(2)}–${(from + duration).toFixed(2)} s` : `${duration} s`}, ${checked.width}×${checked.height}`,
      ...checked.stills.map((still) => `${still.t.toFixed(2)} s  ${still.file}`),
      ...(checked.sheet ? [`sheet  ${checked.sheet}`] : []),
      checked.errors.length > 0 ? `errors:\n${checked.errors.map((line) => `  ${line}`).join('\n')}` : 'no errors',
```

In the same file, replace:

```ts
  duration?: number;
  /** A scene goes first, not last. */
  first?: boolean;
}

export interface MotionNewResult {
```

with:

```ts
  duration?: number;
  /** A scene goes first, not last. */
  first?: boolean;
  /** A transition: the scene it leads into, by id or place (from 0; default: the second scene). */
  into?: string;
}

export interface MotionNewResult {
```

In the same file, replace:

```ts
  kind: MotionTemplate['kind'];
  /** The page, from the project folder. */
  src: string;
  /** What was added to cuttle.json (`scenes` or `overlays`). */
  item: Record<string, unknown>;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
```

with:

```ts
  kind: MotionTemplate['kind'];
  /** The page, from the project folder. */
  src: string;
  /** What was added to cuttle.json (a scene, an overlay, or a scene's `transition`). */
  item: Record<string, unknown>;
  /** A transition: the scene it leads into. */
  into?: number;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
```

In the same file, replace:

```ts
  const file = await readProjectFile(projectDir);
  const clips = file.project.scenes.filter((scene) => scene.type === 'clip');
  if (info.kind === 'overlay' && clips.length === 0) throw new CliError('invalid-project', `${file.path} has no clips: an overlay goes over a clip`);
  // a folder of its own, beside any page there already
  let src: string;
  try {
```

with:

```ts
  const file = await readProjectFile(projectDir);
  const clips = file.project.scenes.filter((scene) => scene.type === 'clip');
  if (info.kind === 'overlay' && clips.length === 0) throw new CliError('invalid-project', `${file.path} has no clips: an overlay goes over a clip`);
  // a transition leads into a scene that has one before it
  let into = -1;
  if (info.kind === 'transition') {
    const scenes = file.project.scenes;
    const wanted = args.into ?? '1';
    into = scenes.findIndex((candidate) => candidate.id === wanted);
    if (into < 0 && /^\d+$/.test(wanted)) into = Number(wanted);
    if (!(into >= 1 && into < scenes.length)) throw new CliError('usage', `--into ${wanted}: a transition leads into a scene after the first (${scenes.length} scenes)`);
  }
  // a folder of its own, beside any page there already
  let src: string;
  try {
```

In the same file, replace:

```ts
  const folder = src.split('/')[1]!;
  const taken = usedIds(file.project);
  let item: Record<string, unknown>;
  if (info.kind === 'scene') {
    item = { type: 'motion', id: newId('scenes', taken), label: labelOf(folder), src, duration: args.duration ?? info.duration };
    const scenes = (file.raw.scenes as unknown[] | undefined) ?? [];
    file.raw.scenes = args.first ? [item, ...scenes] : [...scenes, item];
```

with:

```ts
  const folder = src.split('/')[1]!;
  const taken = usedIds(file.project);
  let item: Record<string, unknown>;
  if (info.kind === 'transition') {
    item = { src, duration: args.duration ?? info.duration };
    const scenes = file.raw.scenes as Record<string, unknown>[];
    scenes[into] = { ...scenes[into], transition: item };
  } else if (info.kind === 'scene') {
    item = { type: 'motion', id: newId('scenes', taken), label: labelOf(folder), src, duration: args.duration ?? info.duration };
    const scenes = (file.raw.scenes as unknown[] | undefined) ?? [];
    file.raw.scenes = args.first ? [item, ...scenes] : [...scenes, item];
```

In the same file, replace:

```ts
    file.raw.overlays = [...((file.raw.overlays as unknown[] | undefined) ?? []), item];
  }
  await writeProjectFile(file, 'motion new');
  const result: MotionNewResult = { template, kind: info.kind, src, item };
  output.result(result, () =>
    info.kind === 'scene'
      ? `added ${src} as a ${String(item.duration)} s scene ${args.first ? 'at the start' : 'at the end'} (${String(item.id)})`
      : `added ${src} as an overlay over source ${String(item.at)} s for ${String(item.duration)} s (${String(item.id)})`,
  );
  return result;
}
```

with:

```ts
    file.raw.overlays = [...((file.raw.overlays as unknown[] | undefined) ?? []), item];
  }
  await writeProjectFile(file, 'motion new');
  const result: MotionNewResult = { template, kind: info.kind, src, item, ...(into >= 0 && { into }) };
  output.result(result, () =>
    info.kind === 'transition'
      ? `added ${src} as the ${String(item.duration)} s transition into scenes[${into}]`
      : info.kind === 'scene'
        ? `added ${src} as a ${String(item.duration)} s scene ${args.first ? 'at the start' : 'at the end'} (${String(item.id)})`
        : `added ${src} as an overlay over source ${String(item.at)} s for ${String(item.duration)} s (${String(item.id)})`,
  );
  return result;
}
```

In `apps/cli/src/electron/protocol.ts`, replace:

```ts
  network: boolean;
  motionBlur?: { samples: number; shutter: number };
  overlay?: number;
}

export type ElectronRequest = (
```

with:

```ts
  network: boolean;
  motionBlur?: { samples: number; shutter: number };
  overlay?: number;
  /** The scene whose transition page it is: checked in the video, between its two scenes. */
  transition?: number;
}

export type ElectronRequest = (
```

In `apps/cli/src/electron/main.ts`, replace:

```ts
  return formats as SubtitleFormat[];
}

/** The project with the checked page as its only scene, or the checked overlay as its only one (its look and output stay). */
function motionCheckProject(project: CuttleProject, check: MotionCheck): CuttleProject {
  if (check.overlay !== undefined) {
    const overlay = project.overlays[check.overlay];
    return { ...project, overlays: overlay ? [overlay] : [] };
  }
  const { overlay: _overlay, ...page } = check;
  return { ...project, scenes: [{ type: 'motion', label: 'check', ...page }], overlays: [], cuts: [] };
}
```

with:

```ts
  return formats as SubtitleFormat[];
}

/**
 * The project with the checked page as its only scene, or the checked overlay as its only one (its look
 * and output stay); a transition page in the project as it is, between the two scenes it joins.
 */
function motionCheckProject(project: CuttleProject, check: MotionCheck): CuttleProject {
  if (check.transition !== undefined) return project;
  if (check.overlay !== undefined) {
    const overlay = project.overlays[check.overlay];
    return { ...project, overlays: overlay ? [overlay] : [] };
  }
  const { overlay: _overlay, transition: _transition, ...page } = check;
  return { ...project, scenes: [{ type: 'motion', label: 'check', ...page }], overlays: [], cuts: [] };
}
```

- [ ] **Step 3: Run the check**

Run: `pnpm cli:check`
Expected: PASS, 14 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/cli
git commit -m "cli: motion new <transition> --into <scene>, and motion check of a transition between its two scenes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The editor shows a scene's transition

**Files:**
- Modify: `apps/desktop/src/renderer/editor/Inspector.tsx`, `apps/desktop/src/renderer/editor/editor.css`, `apps/desktop/src/renderer/editor/session.ts`, `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The scene's panel**

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```tsx
}

/** A clip's crop: the part of the screen it shows, in source pixels, on or off. */
function CropDetails({ project, id }: { project: CuttleProject; id: string }) {
  const clip = project.scenes.find((scene) => scene.id === id);
  if (clip?.type !== 'clip' || !clip.crop) return <p className="hint">This clip has no crop any more.</p>;
```

with:

```tsx
}

/** A clip's crop: the part of the screen it shows, in source pixels, on or off. */
/** The transition page a scene is gone into with (Claude adds one with `motion new fold`): its length, on and off, out. */
function TransitionInto({ project, index }: { project: CuttleProject; index: number }) {
  const scene = project.scenes[index];
  const transition = scene?.transition;
  if (!scene?.id || !transition || index === 0) return null;
  const id = scene.id;
  const change = (fields: Partial<typeof transition>, label: string) => set('scenes', id, { transition: { ...transition, ...fields } }, label);
  return (
    <div className="transition-in" data-testid="transition-in">
      <Row label="Into this scene">{motionName(transition.src)}</Row>
      <p className="hint">The export draws its page between the two scenes; the editor shows a crossfade there for now.</p>
      <div className="grid2">
        <Row label="Length (s)">
          <NumberInput value={transition.duration} min={0.1} max={4} step={0.1} onCommit={(duration) => change({ duration }, 'Transition length')} testId="transition-duration" />
        </Row>
        <Row label="Transition" inline>
          <Toggle checked={transition.enabled} label="The transition into this scene" onChange={(on) => change({ enabled: on }, on ? 'Transition on' : 'Transition off')} testId="transition-on" />
        </Row>
      </div>
      <button type="button" className="ghost small" onClick={() => set('scenes', id, { transition: undefined }, 'Remove transition')} data-testid="transition-remove">
        Remove the transition
      </button>
    </div>
  );
}

function CropDetails({ project, id }: { project: CuttleProject; id: string }) {
  const clip = project.scenes.find((scene) => scene.id === id);
  if (clip?.type !== 'clip' || !clip.crop) return <p className="hint">This clip has no crop any more.</p>;
```

In the same file, replace:

```tsx
    const sceneIndex = project.scenes.findIndex((item) => item.id === id);
    const scene = project.scenes[sceneIndex]!;
    const stretch = sceneStretch(sceneSpans(project.scenes, project.cuts), sceneIndex);
    const inVideo = stretch && <Row label="In the video">{span(stretch.start, stretch.end)}</Row>;
    if (scene.type === 'clip') {
      const name = [scene.speed !== 1 ? formatSpeed(scene.speed) : '', scene.label ?? (scene.speed === 1 ? 'Clip' : '')].filter(Boolean).join(' ');
      return (
```

with:

```tsx
    const sceneIndex = project.scenes.findIndex((item) => item.id === id);
    const scene = project.scenes[sceneIndex]!;
    const stretch = sceneStretch(sceneSpans(project.scenes, project.cuts), sceneIndex);
    const inVideo = (
      <>
        {stretch && <Row label="In the video">{span(stretch.start, stretch.end)}</Row>}
        <TransitionInto project={project} index={sceneIndex} />
      </>
    );
    if (scene.type === 'clip') {
      const name = [scene.speed !== 1 ? formatSpeed(scene.speed) : '', scene.label ?? (scene.speed === 1 ? 'Clip' : '')].filter(Boolean).join(' ');
      return (
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```css
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}
.hint {
  color: var(--muted);
  font-size: var(--size-s);
```

with:

```css
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}
/* the transition a scene is gone into with: a part of its panel */
.transition-in {
  display: grid;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  justify-items: start;
}
.transition-in > * {
  justify-self: stretch;
}
.transition-in > button {
  justify-self: start;
}
.hint {
  color: var(--muted);
  font-size: var(--size-s);
```

- [ ] **Step 2: Its sound in the editor**

In `apps/desktop/src/renderer/editor/session.ts`, replace:

```ts
 * own, or ones its motion pages ask for.
 */
const hasSound = (project: CuttleProject) =>
  project.music !== undefined || project.sounds.length > 0 || project.overlays.length > 0 || project.scenes.some((scene) => scene.type === 'motion');

/** The document's project goes to the main process at each edit: it renders its music and sounds a moment later. */
function followSound(): void {
```

with:

```ts
 * own, or ones its motion pages ask for.
 */
const hasSound = (project: CuttleProject) =>
  project.music !== undefined ||
  project.sounds.length > 0 ||
  project.overlays.length > 0 ||
  project.scenes.some((scene) => scene.type === 'motion' || scene.transition !== undefined);

/** The document's project goes to the main process at each edit: it renders its music and sounds a moment later. */
function followSound(): void {
```

- [ ] **Step 3: The check**

Claude adds a fold into the clip: the clip's panel shows it, its length is set there, the frame at the cut draws (a crossfade), and it is removed again:

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    expect(shown.mean, 'the device: mean difference').toBeLessThan(1.5);
    expect((await now()).motion.status.find((status) => status.src === 'motion/device-3d/index.html')?.errors).toEqual([]);
    await shotOf('39b-device-3d', '/editor.html', 'motion-editor · Cuttle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion-editor · Cuttle')?.close());
  }, 240_000);
```

with:

```ts
    expect(shown.mean, 'the device: mean difference').toBeLessThan(1.5);
    expect((await now()).motion.status.find((status) => status.src === 'motion/device-3d/index.html')?.errors).toEqual([]);
    await shotOf('39b-device-3d', '/editor.html', 'motion-editor · Cuttle');

    // Claude adds a fold into the clip: the clip's panel shows it, its length is set there, and it goes again
    const folded = spawnSync('node', [CLI, '--json', '-C', dir, 'motion', 'new', 'fold', '--into', 's2'], { encoding: 'utf8', timeout: 60_000 });
    expect(folded.status, folded.stderr).toBe(0);
    type Transitioned = { scenes: { id?: string; transition?: { src: string; duration: number } }[] };
    const clipOf = () => (saved() as unknown as Transitioned).scenes.find((scene) => scene.id === 's2');
    await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.select({ kind: 'scene', id: 's2' }));
    await page.waitForSelector('[data-testid=transition-in]', { timeout: 20_000 });
    await page.fill('[data-testid=transition-duration]', '0.6');
    await page.press('[data-testid=transition-duration]', 'Enter');
    await expect.poll(() => clipOf()?.transition?.duration).toBe(0.6);
    // the editor shows a crossfade where the export draws the page: the frame draws, nothing fails
    await seekTo(4.5);
    expect((await now()).error).toBeUndefined();
    await shotOf('39c-transition', '/editor.html', 'motion-editor · Cuttle');
    await click(page, '[data-testid=transition-remove]');
    await expect.poll(() => clipOf()?.transition).toBeUndefined();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion-editor · Cuttle')?.close());
  }, 240_000);
```

Run: `pnpm app:check`
Expected: PASS, 50 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop
git commit -m "app: a scene's transition in its panel (length, on and off, remove), a crossfade in its place for now

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The guides

**Files:**
- Modify: `skill/cuttle/motion.md`, `skill/cuttle/project.md`, `skill/cuttle/SKILL.md`

- [ ] **Step 1: Transitions**

In `skill/cuttle/motion.md`, replace:

```markdown

## Two kinds of video

- **Over a recording:** motion scenes between the clips (an intro, a chapter card, an end card) and
  overlays over them (a lower third, callouts on the clicks, captions on the words).
- **Without a recording:** a promo, a showreel, an explainer made only of motion scenes. Run
  `cuttle init "<folder>"`, write the pages, add them as `motion` scenes, render. A project without
  clips needs no take.
```

with:

```markdown

## Two kinds of video

- **Over a recording:** motion scenes between the clips (an intro, a chapter card, an end card),
  overlays over them (a lower third, callouts on the clicks, captions on the words), and
  transitions between scenes (a fold, a wipe, a zoom through) in place of the crossfade.
- **Without a recording:** a promo, a showreel, an explainer made only of motion scenes. Run
  `cuttle init "<folder>"`, write the pages, add them as `motion` scenes, render. A project without
  clips needs no take.
```

In the same file, replace:

```markdown
1. Write the page in the project: `motion/<name>/index.html`, with its scripts, images and data next
   to it (or shared, `motion/shared.js`, imported as `../shared.js`). Or start from a template:
   `cuttle -C "<project>" --json motion new <template>` (title, end-card, code-typing, device-3d,
   lower-third, click-callouts, kinetic-captions; `cuttle --json motion templates` says what each
   shows); it
   copies the page and adds it to cuttle.json. Then change the copy as much as you like. Most
   templates make their sounds (a whoosh with the title, a pop on each callout, keys while code
   types); their `sounds` param switches them off.
```

with:

```markdown
1. Write the page in the project: `motion/<name>/index.html`, with its scripts, images and data next
   to it (or shared, `motion/shared.js`, imported as `../shared.js`). Or start from a template:
   `cuttle -C "<project>" --json motion new <template>` (title, end-card, code-typing, device-3d,
   fold, lower-third, click-callouts, kinetic-captions; `cuttle --json motion templates` says what
   each shows; a transition takes `--into <scene id>`); it
   copies the page and adds it to cuttle.json. Then change the copy as much as you like. Most
   templates make their sounds (a whoosh with the title, a pop on each callout, keys while code
   types); their `sounds` param switches them off.
```

In the same file, replace:

```markdown
- **Sound by asking:** a page plays nothing itself (no `<audio>`, no WebAudio); it asks Cuttle for
  sounds, which play with the project's (see below).

## Sounds from the page

A page asks for its sounds where its motion happens, so they stay on it however the video is cut:
```

with:

```markdown
- **Sound by asking:** a page plays nothing itself (no `<audio>`, no WebAudio); it asks Cuttle for
  sounds, which play with the project's (see below).

## Transitions between scenes

A transition is a page on the scene it leads into, `"transition": { "src": "motion/fold/index.html",
"duration": 0.9 }`. It plays around the cut, half before and half after, in place of the crossfade
(also with crossfades off). Each frame it is given the two scenes as the video draws them, the
look, the window and the cursor in:

- `cuttle.from` and `cuttle.to`: the outgoing and the incoming frame, `ImageBitmap`s at the output's
  size (a Three.js texture: `flipY = false`); new ones every frame, so do not close them;
- `cuttle.progress`: 0 to 1 through the transition.

Draw the whole frame from them: at 0 it should look like `from`, at 1 like `to`, so the cut is
seamless. `fold` turns the outgoing frame over its middle like a page. `motion check` shows a
transition in the video, between its two scenes. A first scene, or one right after a cut, has
nothing to go between. The editor shows a crossfade where a transition is, for now; the export
and `cuttle preview` draw the page.

## Sounds from the page

A page asks for its sounds where its motion happens, so they stay on it however the video is cut:
```

In the same file, replace:

```markdown
## Motion that feels designed

- Hard cuts between full scenes are strong (set `look.transition.enabled: false` for a reel);
  crossfades suit calmer videos.
- Give fast motion **motion blur**: `"motionBlur": { "samples": 8, "shutter": 0.5 }` on the item
  renders 8 moments per frame while the shutter is open (8× the time) and averages them.
- Ease everything (`ease.outExpo` in, `ease.in` out), stagger groups, let shapes overshoot
```

with:

```markdown
## Motion that feels designed

- Hard cuts between full scenes are strong (set `look.transition.enabled: false` for a reel);
  crossfades suit calmer videos; a transition page marks a real change (into the result, into
  the end card). One or two a video, not at every cut.
- Give fast motion **motion blur**: `"motionBlur": { "samples": 8, "shutter": 0.5 }` on the item
  renders 8 moments per frame while the shutter is open (8× the time) and averages them.
- Ease everything (`ease.outExpo` in, `ease.in` out), stagger groups, let shapes overshoot
```

In `skill/cuttle/project.md`, replace:

```markdown
them when you edit an item; give a new item an id no other item uses (`s7`, `m2`, `c3`) and a
short label.

**Automatic items.** Cuttle tags what it makes on its own with `auto` (on a zoom, mask, cut or a
clip's `crop`): `answer` and `click` zooms from `suggest`, and later `crop`, `privacy`,
`notification`, `retake`, `filler`, `pause`, `length`, `typing` and `dialog`. A rerun replaces
```

with:

```markdown
them when you edit an item; give a new item an id no other item uses (`s7`, `m2`, `c3`) and a
short label.

Every scene may also have a `transition`: the page it is gone into with, in place of the crossfade,
`{ "src": "motion/fold/index.html", "duration": 0.9 }` with `params`, `network` (`false`) and
`enabled` (`true`); `duration` (`0.8`, up to 4 s) is around the cut, half before and half after,
also with the look's crossfades off. [motion.md](motion.md) has how such a page is written.

**Automatic items.** Cuttle tags what it makes on its own with `auto` (on a zoom, mask, cut or a
clip's `crop`): `answer` and `click` zooms from `suggest`, and later `crop`, `privacy`,
`notification`, `retake`, `filler`, `pause`, `length`, `typing` and `dialog`. A rerun replaces
```

In the same file, replace:

```markdown

## Motion pages

A motion scene or overlay is a web page in the project folder, usually `motion/<name>/index.html`
with its own CSS, scripts, images and fonts next to it. Anything a browser draws works: HTML and
CSS, SVG, a canvas, WebGL, Three.js and Lottie from the kit. Cuttle renders it frame by frame, the
same in every render. [motion.md](motion.md) is the guide: the kit, the take as a page sees it
```

with:

```markdown

## Motion pages

A motion scene, overlay or transition is a web page in the project folder, usually `motion/<name>/index.html`
with its own CSS, scripts, images and fonts next to it. Anything a browser draws works: HTML and
CSS, SVG, a canvas, WebGL, Three.js and Lottie from the kit. Cuttle renders it frame by frame, the
same in every render. [motion.md](motion.md) is the guide: the kit, the take as a page sees it
```

In `skill/cuttle/SKILL.md`, replace:

```markdown
- **Sounds.** A sound at a moment, without the music: `cuttle -C "<project>" --json sound add whoosh --at 12.4`
  (source seconds) or `--scene s5 --at 0.2`; `sound list` has the built-in sounds. A motion page
  asks for its own with `cuttle.sound(…)` (motion.md); the templates come with theirs.
- **End card.** A `card` scene at the end with the product name and URL, or a `motion` scene.

## 4. Render
```

with:

```markdown
- **Sounds.** A sound at a moment, without the music: `cuttle -C "<project>" --json sound add whoosh --at 12.4`
  (source seconds) or `--scene s5 --at 0.2`; `sound list` has the built-in sounds. A motion page
  asks for its own with `cuttle.sound(…)` (motion.md); the templates come with theirs.
- **Transitions.** A page in place of the crossfade into a scene: `cuttle -C "<project>" --json motion new fold --into <scene id>`
  (motion.md). One or two a video, where something changes.
- **End card.** A `card` scene at the end with the product name and URL, or a `motion` scene.

## 4. Render
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 2: Commit**

```bash
git add skill/cuttle
git commit -m "skill: transition pages: where they go, what they are given, the fold

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 851 passed and 70 skipped (where a speech model is found, its real transcription runs too: 852 and 69; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 14 tests.

Run: `pnpm app:check`
Expected: PASS, 50 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Ask Claude for a fold into the clip after the intro (`motion new fold --into …`), export: the intro turns over like a page onto the recording.
2. In the editor, select that clip: its panel shows the fold; set its length, export again.
3. Switch it off in the panel: the export crossfades (or cuts) there again.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **The fold's back landed on the wrong half:** turned about the middle, a back mirrored in place ends up where the front started; it lies where the front does now, facing the other way.
- **The turn stood still, then flew:** an exponential ease left the first 40% of the window almost still; an even (cubic) ease turns it throughout.
- **The page became a wall at 90°:** with the camera close, the standing page reached halfway to it and filled the frame; the default depth is 0.5 (a camera twice as far, the plane still filling the frame).
- **The editor's motion requests** stay a scene's or an overlay's: a transition's needs the frames it goes between, which the editor does not send yet (P5-M1i).
- **The panel's note was cut off** in the narrow row; it is a line of its own.

**Flaky, and not this milestone's**
- **Recordings that did not start in time** (seen on `main` too, see P5-M1g and P5-M1d): the first `app:check` lost the test that reads the screen after a take; the second passed all 50. Every run that lost a recording test today started right after a fresh build (`pnpm app:check` builds first); every run started without one passed: a lead for finding the cause. Nothing here touches the recorder or the HUD.

**Spec points that move**
- **The editor plays transition pages** (the layers read back and sent ahead of the player), and adding one there: **P5-M1i**.

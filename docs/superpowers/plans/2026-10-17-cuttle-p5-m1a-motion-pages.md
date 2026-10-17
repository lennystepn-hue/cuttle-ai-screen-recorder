# Cuttle P5-M1a: Motion Pages in the Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Code becomes part of the video. A web page in the project (HTML, CSS, canvas, WebGL) is a scene of its own or an overlay over the clips, rendered frame by frame on the video's clock, with its transparency, the same in every render. `cuttle preview` and `cuttle render` draw it, the app exports it, and `cuttle motion check` shows Claude what a page draws and what it threw.

**Architecture:**
- **Format** (`packages/project`): a `motion` scene (`src`, `duration`, `params`, `network`) and `overlays` (a page over the clips, timed in source seconds like texts).
- **Timeline:** a motion scene is a layer of its own; a clip layer lists the overlays it shows, each with its own clock in output seconds.
- **The page's runtime** (`packages/export/src/motion/runtime.ts`), injected before the page's scripts:
  - a virtual clock: `performance.now`, `Date`, timers, `requestAnimationFrame`, CSS and Web Animations;
  - a seeded `Math.random`;
  - `window.cuttle` (time, size, format, params, theme, `onFrame`, `ready`);
  - a marker pixel below the page that names each drawn frame.
- **The main process** (`MotionPage`, `MotionHost`):
  - each showing of an item is a hidden, sandboxed offscreen window that reaches only the project's files;
  - frames come from its `paint` event, and the marker proves which frame a paint shows;
  - the next frame is drawn while the export works on the current one.
- **The export page** asks for the frames over IPC. The engine draws them as textures: a scene over the background, an overlay over the clip and under the captions.
- **CLI:** `cuttle motion check <src>`; `preview` and `render` draw motion like any scene.
- **App:**
  - motion scenes are blocks on the timeline with a small inspector;
  - the app's export draws motion;
  - the editor's own preview of motion is P5-M1c.

**Tech Stack:** TypeScript strict, zod 4, vitest 5 (node and browser projects), Electron 44.7.2 (offscreen rendering, CDP, custom protocols), WebGL2, React 19.3.0, Playwright (`_electron`).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase5-motion-design.md`. Spike: `docs/superpowers/spikes/2026-10-17-p5-virtual-clock.md`. Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p4-m6-length-fit.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m1a`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine: motion pages render in offscreen windows that are never shown.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 9.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The prototype passed `pnpm test` (750 tests, 62 skipped), the typecheck, `app:check` (48 tests) and `cli:check` (8). Every screenshot was looked at.

- **The format:**
  - A `motion` scene: `src`, `duration` (output seconds), `params` (text, numbers, switches or `null`), `network` (`false`).
  - `overlays`: `src`, `at` and `duration` (source seconds, as a text's), `params`, `network`, `enabled`, with ids (`o1`).
  - A new take drops the overlays with the previous take's other edits: they are timed on its source seconds.
- **The clock of an overlay** runs in output seconds from where the video first shows its stretch. It runs on across continuous cuts, cuts and speed-ups (the occurrences texts and zooms use). A clip shown twice shows it twice, each showing with its own clock (`ActiveOverlay.key`).
- **The runtime** is one self-contained function, injected as source text with CDP's `Page.addScriptToEvaluateOnNewDocument` after `about:blank` (the spike's finding):
  - `__cuttleDraw(ms)` moves the clock to a frame's time, never back. It runs the due timers in order, the `onFrame` drawers, one animation frame, and sets every animation (paused) to the time since it was first seen.
  - A timer waits at least 1 ms, so a timeout that sets itself again cannot stall a frame; after 100,000 timers in one frame the page gets an error.
  - It answers after two real browser frames.
  - The page needs no script tag of Cuttle's.
- **The renderer** (`MotionPage`):
  - The page is the output's size, one CSS pixel per pixel (CDP's device metrics override, whatever the display's scale).
  - The window is 4 rows taller for the marker. A paint counts only when its marker shows the draw's number; empty paints are skipped.
  - BGRA becomes RGBA, still premultiplied.
  - The page's errors and console are kept (Electron's own security advice to unpackaged apps is left out).
  - A frame may take 5 s, loading 30 s.
- **The page's sandbox:**
  - its own session, which serves `cuttle-motion://project/…` from the project folder only (a path that leaves it is a 404);
  - a Content Security Policy for its own files, data and blob URLs, and inline code;
  - every other request is cancelled; `https:` only with `"network": true`;
  - no permissions, no downloads, no new windows, no navigation, no WebRTC without a proxy.
- **The host** (`MotionHost`): one page per showing. It draws the next frame ahead while the export works on the current one, opens the page again for a frame before one it drew, and closes it when the export page says the showing is over. The export page asks for an item's first frame a second before it shows (the scenes' look-ahead).
- **The engine:** `FrameSources.motion` (scene index → frame) and `overlays` (showing → frame), uploaded as premultiplied bytes. A motion scene without a frame shows the background alone (the editor before P5-M1c).
- **The theme** as CSS variables: `--cuttle-accent` (the cursor colour), `--cuttle-bg` (the solid colour, else a dark tone of the preset), `--cuttle-fg`, `--cuttle-font`, `--cuttle-mono`. The seed comes from the item's id, else its place.
- **`cuttle motion check <src>`:**
  - It renders the page as the project's only scene: eight frames from its start to its end, a contact sheet, its errors and its console.
  - It takes its params from the item that shows it, and its length from there, else 3 s.
  - `preview` and `render` report what the pages said (`motion`), and the export prints their errors as warnings.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/{schema,ids,index}.ts`, `packages/core/src/use-take.ts` | the format |
| `packages/timeline/src/{frame,index}.ts` | motion layers, overlays and their clocks |
| `packages/export/src/motion/{runtime,init}.ts` | the page's runtime; what a page is told |
| `packages/engine/src/{renderer,index}.ts`, `src/gl/texture.ts` | drawing the frames |
| `packages/export/src/{frame-plan,job,index}.ts`, `src/main/{motion,motion-host,sources,export,stills}.ts`, `src/page/{scene-sources,run}.ts`, `electron/export-page/preload.cjs`, `electron/check.ts` | rendering pages and serving their frames to the export |
| `apps/cli/src/{main.ts,commands/motion.ts,commands/preview.ts,electron/main.ts,electron/protocol.ts}` | `cuttle motion check`, the scheme |
| `apps/desktop/src/{main/protocols.ts,shared/*,renderer/editor/*,renderer/tokens.css}` | the scheme, the motion block and its inspector |
| `skill/cuttle/{SKILL,project}.md`, `skill/test/skill.test.ts` | the format and the page contract for Claude |

---

### Task 1: The format

**Files:**
- Modify: `packages/project/src/{schema,ids,index}.ts`, `packages/project/test/schema.test.ts`, `packages/core/src/use-take.ts`, `packages/core/test/use-take.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m1a`; work there:

```bash
git switch p5-m1a
```

- [ ] **Step 2: Write the failing tests**

In `packages/project/test/schema.test.ts`, replace:

```ts
    expect(p.zooms).toEqual([]);
    expect(p.masks).toEqual([]);
    expect(p.texts).toEqual([]);
  });

  it('parses the spec example and applies item defaults', () => {
```

with:

```ts
    expect(p.zooms).toEqual([]);
    expect(p.masks).toEqual([]);
    expect(p.texts).toEqual([]);
    expect(p.overlays).toEqual([]);
  });

  it('parses the spec example and applies item defaults', () => {
```

In the same file, replace:

```ts
    expect(pathsOf({ ...minimal, captions: { fixes: [{ at: 2, end: 1, text: 'x' }] } })).toEqual(['captions.fixes.0.end']);
  });
});
```

with:

```ts
    expect(pathsOf({ ...minimal, captions: { fixes: [{ at: 2, end: 1, text: 'x' }] } })).toEqual(['captions.fixes.0.end']);
  });
});

describe('motion', () => {
  it('reads a motion scene and a motion overlay, with their defaults', () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [{ type: 'motion', id: 's1', label: 'Intro', src: 'motion/intro/index.html', duration: 3, params: { title: 'Cuttle', size: 2, dark: true, logo: null } }],
      overlays: [{ id: 'o1', src: 'motion/callouts/index.html', at: 4.2, duration: 6 }],
    });
    expect(p.scenes[0]).toEqual({
      type: 'motion',
      id: 's1',
      label: 'Intro',
      src: 'motion/intro/index.html',
      duration: 3,
      params: { title: 'Cuttle', size: 2, dark: true, logo: null },
      network: false,
    });
    expect(p.overlays[0]).toEqual({ id: 'o1', src: 'motion/callouts/index.html', at: 4.2, duration: 6, params: {}, network: false, enabled: true });
  });

  it('refuses a page without a path, a length of zero, a param that is a list and an id used elsewhere', () => {
    expect(pathsOf({ ...minimal, scenes: [{ type: 'motion', src: '', duration: 2 }] })).toEqual(['scenes.0.src']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'motion', src: 'a.html', duration: 0 }] })).toEqual(['scenes.0.duration']);
    expect(pathsOf({ ...minimal, overlays: [{ src: 'a.html', at: 1, duration: 2, params: { list: [1, 2] } }] })).toEqual(['overlays.0.params.list']);
    expect(pathsOf({ ...minimal, texts: [{ id: 'o1', at: 1, duration: 2, text: 'Hi' }], overlays: [{ id: 'o1', src: 'a.html', at: 1, duration: 2 }] })).toEqual(['overlays.0.id']);
  });
});
```

In `packages/core/test/use-take.test.ts`, replace:

```ts
    expect(file.raw.cuts).toEqual(first.cuts);
    expect((file.raw.sources as { transcript?: string }).transcript).toBe('takes/1/transcript.json');
  });
});
```

with:

```ts
    expect(file.raw.cuts).toEqual(first.cuts);
    expect((file.raw.sources as { transcript?: string }).transcript).toBe('takes/1/transcript.json');
  });

  it('drops the motion overlays, which are timed on the previous take, and counts them as an edit', () => {
    const raw = { version: 1, sources: first.sources, overlays: [{ id: 'o1', src: 'motion/callouts/index.html', at: 2, duration: 3 }] };
    const file = fileWith(raw);
    expect(useTake(file, { screen: 'takes/2/screen.mp4', seconds: 8 })).toBe(true);
    expect(file.raw.overlays).toBeUndefined();
  });
});
```

Run: `pnpm exec vitest run --project node packages/project/test/schema.test.ts packages/core/test/use-take.test.ts`
Expected: FAIL: `overlays` and the `motion` scene type are unknown.

- [ ] **Step 3: Motion scenes and overlays**

In `packages/project/src/schema.ts`, replace:

```ts
  duration: positiveSeconds,
});

const SceneSchema = z.discriminatedUnion('type', [ClipSceneSchema, StillSceneSchema, CardSceneSchema]);

/** A point on a zoom's path: from `at` (source seconds) the zoom shows `rect`. */
const ZoomMoveSchema = z.strictObject({ at: seconds, rect: RectSchema });
```

with:

```ts
  duration: positiveSeconds,
});

/** A page (HTML, in the project) as a value its params may hold: text, a number, a switch, a colour, a path. */
const ParamValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** What a motion page gets: the page (a path in the project), its params, and whether it may reach the network. */
const motionPage = {
  /** The page: an HTML file in the project (`motion/intro/index.html`). */
  src: z.string().min(1),
  /** The values of the params the page declares. */
  params: z.record(z.string(), ParamValue).default({}),
  /** Let the page reach https: (off: only the project's files). */
  network: z.boolean().default(false),
};

/** A page Claude or the person wrote, rendered frame by frame as a scene (an intro, an end card, a 3D shot). */
const MotionSceneSchema = z.strictObject({
  type: z.literal('motion'),
  ...named,
  ...motionPage,
  duration: positiveSeconds,
});

const SceneSchema = z.discriminatedUnion('type', [ClipSceneSchema, StillSceneSchema, CardSceneSchema, MotionSceneSchema]);

/** A point on a zoom's path: from `at` (source seconds) the zoom shows `rect`. */
const ZoomMoveSchema = z.strictObject({ at: seconds, rect: RectSchema });
```

In the same file, replace:

```ts
  enabled: z.boolean().default(true),
});

export const ProjectSchema = z
  .strictObject({
    version: z.literal(CURRENT_VERSION),
```

with:

```ts
  enabled: z.boolean().default(true),
});

/**
 * A page drawn over the video where its clips show source seconds `at` to `at + duration`, with
 * its transparency (a lower third, callouts, a logo); its own clock runs in output seconds.
 */
const MotionOverlaySchema = z.strictObject({
  ...named,
  ...motionPage,
  at: seconds,
  duration: positiveSeconds,
  enabled: z.boolean().default(true),
});

export const ProjectSchema = z
  .strictObject({
    version: z.literal(CURRENT_VERSION),
```

In the same file, replace:

```ts
    zooms: z.array(ZoomSchema).default([]),
    masks: z.array(MaskSchema).default([]),
    texts: z.array(TextSchema).default([]),
    cuts: z.array(CutSchema).default([]),
    autoEdits: AutoEditsSchema.prefault({}),
    captions: CaptionsSchema.prefault({}),
```

with:

```ts
    zooms: z.array(ZoomSchema).default([]),
    masks: z.array(MaskSchema).default([]),
    texts: z.array(TextSchema).default([]),
    overlays: z.array(MotionOverlaySchema).default([]),
    cuts: z.array(CutSchema).default([]),
    autoEdits: AutoEditsSchema.prefault({}),
    captions: CaptionsSchema.prefault({}),
```

In the same file, replace:

```ts
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
    const seen = new Map<string, string>();
    for (const list of ['scenes', 'zooms', 'masks', 'texts', 'cuts'] as const) {
      project[list].forEach((item: { id?: string }, index) => {
        if (item.id === undefined) return;
        const first = seen.get(item.id);
```

with:

```ts
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
    const seen = new Map<string, string>();
    for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts'] as const) {
      project[list].forEach((item: { id?: string }, index) => {
        if (item.id === undefined) return;
        const first = seen.get(item.id);
```

In the same file, replace:

```ts
export type ClipScene = Extract<Scene, { type: 'clip' }>;
export type StillScene = Extract<Scene, { type: 'still' }>;
export type CardScene = Extract<Scene, { type: 'card' }>;
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
```

with:

```ts
export type ClipScene = Extract<Scene, { type: 'clip' }>;
export type StillScene = Extract<Scene, { type: 'still' }>;
export type CardScene = Extract<Scene, { type: 'card' }>;
export type MotionScene = Extract<Scene, { type: 'motion' }>;
export type MotionOverlay = CuttleProject['overlays'][number];
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
```

In `packages/project/src/ids.ts`, replace:

```ts
/** The lists whose items carry ids, and the prefix of the ids Cuttle gives their new items. */
export const ID_PREFIXES = { scenes: 's', zooms: 'z', masks: 'm', texts: 't', cuts: 'c' } as const;

export type IdList = keyof typeof ID_PREFIXES;
```

with:

```ts
/** The lists whose items carry ids, and the prefix of the ids Cuttle gives their new items. */
export const ID_PREFIXES = { scenes: 's', zooms: 'z', masks: 'm', texts: 't', overlays: 'o', cuts: 'c' } as const;

export type IdList = keyof typeof ID_PREFIXES;
```

In `packages/project/src/index.ts`, replace:

```ts
  type Captions,
  type CaptionStyle,
  type CardScene,
  type ClipScene,
  type CursorShape,
  type CursorStyle,
```

with:

```ts
  type Captions,
  type CaptionStyle,
  type CardScene,
  type MotionOverlay,
  type MotionScene,
  type ClipScene,
  type CursorShape,
  type CursorStyle,
```

In `packages/core/src/use-take.ts`, replace:

```ts

/**
 * Points the project at a take: `sources` names its files. A project is one take: by default the
 * take becomes one clip scene, and the scenes, zooms, masks, texts and cuts of the previous take
 * (which refer to its source times) are dropped. With `keepEdit` (recovering the take the project already
 * uses) they stay, and a clip over the whole take is added only when there are no scenes. Returns
 * whether the project had scenes or overlays, so the caller keeps the previous cuttle.json as a
 * backup when it writes (`writeProjectFile`'s `backup`).
 */
export function useTake(file: ProjectFile, take: TakeFiles, keepEdit = false): boolean {
  const { scenes, zooms, masks, texts, cuts } = file.project;
  const hadEdit = scenes.length + zooms.length + masks.length + texts.length + cuts.length > 0;
  file.raw.sources = {
    screen: take.screen,
    ...(take.webcam && { webcam: take.webcam }),
```

with:

```ts

/**
 * Points the project at a take: `sources` names its files. A project is one take: by default the
 * take becomes one clip scene, and the scenes, zooms, masks, texts, motion overlays and cuts of the previous take
 * (which refer to its source times) are dropped. With `keepEdit` (recovering the take the project already
 * uses) they stay, and a clip over the whole take is added only when there are no scenes. Returns
 * whether the project had scenes or overlays, so the caller keeps the previous cuttle.json as a
 * backup when it writes (`writeProjectFile`'s `backup`).
 */
export function useTake(file: ProjectFile, take: TakeFiles, keepEdit = false): boolean {
  const { scenes, zooms, masks, texts, overlays, cuts } = file.project;
  const hadEdit = scenes.length + zooms.length + masks.length + texts.length + overlays.length + cuts.length > 0;
  file.raw.sources = {
    screen: take.screen,
    ...(take.webcam && { webcam: take.webcam }),
```

In the same file, replace:

```ts
  delete file.raw.zooms;
  delete file.raw.masks;
  delete file.raw.texts;
  delete file.raw.cuts;
  return hadEdit;
}
```

with:

```ts
  delete file.raw.zooms;
  delete file.raw.masks;
  delete file.raw.texts;
  delete file.raw.overlays;
  delete file.raw.cuts;
  return hadEdit;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/project packages/core/test/use-take.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project packages/core
git commit -m "project: motion scenes and motion overlays, pages in the project drawn into the video

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Motion in the timeline

**Files:**
- Modify: `packages/timeline/src/{frame,index}.ts`, `packages/timeline/test/frame.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/timeline/test/frame.test.ts`, replace:

```ts
    expect(y).toBeGreaterThanOrEqual(141);
  });
});
```

with:

```ts
    expect(y).toBeGreaterThanOrEqual(141);
  });
});

describe('motion', () => {
  const motion = (overrides: Record<string, unknown>) =>
    createTimeline(
      project(
        { transition: { enabled: false } },
        {
          scenes: [
            { type: 'motion', src: 'motion/intro/index.html', duration: 1 },
            { type: 'clip', from: 10, to: 20 },
            { type: 'clip', from: 20, to: 40, speed: 4 },
          ],
          zooms: [],
          masks: [],
          texts: [],
          ...overrides,
        },
      ),
      { screenSize },
    );

  it('shows a motion scene as a layer of its own, with its time and no overlays', () => {
    const [layer] = motion({}).frameAt(0.5).layers;
    expect(layer).toMatchObject({ index: 0, sceneIndex: 0, kind: 'motion', local: 0.5, progress: 0.5, overlays: [] });
    expect(layer!.sourceTime).toBeUndefined();
  });

  it('gives an overlay a clock in output seconds that runs on across a continuous cut and a speed change', () => {
    // source 18 to 24: 18–20 at 1× (output 9–11), then 20–24 at 4× (output 11–12)
    const timeline = motion({ overlays: [{ src: 'motion/callouts/index.html', at: 18, duration: 6 }] });
    expect(timeline.frameAt(8.5).layers[0]!.overlays).toEqual([]);
    expect(timeline.frameAt(10).layers[0]!.overlays).toEqual([{ index: 0, key: '0@9', local: 1, duration: 3 }]);
    expect(timeline.frameAt(11.5).layers[0]).toMatchObject({ sceneIndex: 2, overlays: [{ index: 0, key: '0@9', local: 2.5, duration: 3 }] });
    expect(timeline.frameAt(12.25).layers[0]!.overlays).toEqual([]);
  });

  it('shows an overlay as often as its clips show its stretch, each showing with its own clock, and none when it is off', () => {
    const twice = motion({
      scenes: [
        { type: 'clip', from: 10, to: 20 },
        { type: 'clip', from: 15, to: 20 },
      ],
      overlays: [{ src: 'a.html', at: 16, duration: 2 }],
    });
    expect(twice.frameAt(7).layers[0]!.overlays).toEqual([{ index: 0, key: '0@6', local: 1, duration: 2 }]);
    expect(twice.frameAt(12).layers[0]!.overlays).toEqual([{ index: 0, key: '0@11', local: 1, duration: 2 }]);
    const off = motion({ overlays: [{ src: 'a.html', at: 12, duration: 2, enabled: false }] });
    expect(off.frameAt(3).layers[0]!.overlays).toEqual([]);
  });
});
```

Run: `pnpm exec vitest run --project node packages/timeline/test/frame.test.ts`
Expected: FAIL: the layers have no `overlays`.

- [ ] **Step 2: Motion layers and the overlays' clocks**

In `packages/timeline/src/frame.ts`, replace:

```ts
import { crossfadeHalf, isContinuousCut, sceneSpans, sourceTimeAt, spanAt, totalDuration, type SceneSpan } from './time';
import { ZOOM_RAMP_SECONDS, zoomRectAt } from './zoom';

export interface SceneFrame {
  /** The span it comes from (`Timeline.spans`); a clip with cuts in it has several. */
  index: number;
  /** The scene it shows, in the project's `scenes`. */
  sceneIndex: number;
  kind: 'clip' | 'still' | 'card';
  local: number;
  progress: number;
  opacity: number;
```

with:

```ts
import { crossfadeHalf, isContinuousCut, sceneSpans, sourceTimeAt, spanAt, totalDuration, type SceneSpan } from './time';
import { ZOOM_RAMP_SECONDS, zoomRectAt } from './zoom';

/** A motion overlay on a clip's frame: which one, and where its own clock is. */
export interface ActiveOverlay {
  /** Its place in the project's `overlays`. */
  index: number;
  /** One showing of it (a clip shown twice shows it twice): the overlay and where its stretch starts. */
  key: string;
  /** Output seconds into this showing, and how long it lasts (its source stretch on the output timeline). */
  local: number;
  duration: number;
}

export interface SceneFrame {
  /** The span it comes from (`Timeline.spans`); a clip with cuts in it has several. */
  index: number;
  /** The scene it shows, in the project's `scenes`. */
  sceneIndex: number;
  kind: 'clip' | 'still' | 'card' | 'motion';
  local: number;
  progress: number;
  opacity: number;
```

In the same file, replace:

```ts
  aspect?: number;
  masks: Mask[];
  texts: ActiveText[];
  badge?: string;
  cursor?: CursorFrame;
}
```

with:

```ts
  aspect?: number;
  masks: Mask[];
  texts: ActiveText[];
  /** Clip scenes: the motion overlays it shows, in the project's order (drawn over the whole frame). */
  overlays: ActiveOverlay[];
  badge?: string;
  cursor?: CursorFrame;
}
```

In the same file, replace:

```ts
  // Where each zoom and text shows in output time, per span: their ramps run in output seconds.
  const zoomShown = new Map(project.zooms.map((zoom) => [zoom, occurrences(spans, zoom.at, zoom.at + zoom.duration)]));
  const textShown = new Map(project.texts.map((text) => [text, occurrences(spans, text.at, text.at + text.duration)]));

  const halfBetween = (a: SceneSpan, b: SceneSpan): number => crossfadeHalf(a, b, project.look.transition);
```

with:

```ts
  // Where each zoom and text shows in output time, per span: their ramps run in output seconds.
  const zoomShown = new Map(project.zooms.map((zoom) => [zoom, occurrences(spans, zoom.at, zoom.at + zoom.duration)]));
  const textShown = new Map(project.texts.map((text) => [text, occurrences(spans, text.at, text.at + text.duration)]));
  const overlayShown = project.overlays.map((overlay) => occurrences(spans, overlay.at, overlay.at + overlay.duration));
  const round = (seconds: number) => Math.round(seconds * 1e6) / 1e6;

  const halfBetween = (a: SceneSpan, b: SceneSpan): number => crossfadeHalf(a, b, project.look.transition);
```

In the same file, replace:

```ts
    const local = clamp(t - span.start, 0, length);
    const base = { index: span.index, sceneIndex: span.sceneIndex, local, progress: length === 0 ? 1 : local / length, opacity };
    const scene = span.scene;
    if (scene.type !== 'clip') return { ...base, kind: scene.type, masks: [], texts: [] };
    // Past the end (or on a frame whose source time would be `to`), hold the last frame shown:
    // its source time lies inside [from, to), so masks that end with the clip stay on, and a
    // clip's source time never goes back during a crossfade.
```

with:

```ts
    const local = clamp(t - span.start, 0, length);
    const base = { index: span.index, sceneIndex: span.sceneIndex, local, progress: length === 0 ? 1 : local / length, opacity };
    const scene = span.scene;
    if (scene.type !== 'clip') return { ...base, kind: scene.type, masks: [], texts: [], overlays: [] };
    // Past the end (or on a frame whose source time would be `to`), hold the last frame shown:
    // its source time lies inside [from, to), so masks that end with the clip stay on, and a
    // clip's source time never goes back during a crossfade.
```

In the same file, replace:

```ts
      aspect: screen[2] / screen[3],
      masks: activeMasks(project.masks, sourceTime),
      texts: activeTexts(project.texts, sourceTime, (text) => amount(textShown.get(text), TEXT_FADE_SECONDS, 'linear')),
      badge: badgeFor(scene),
      cursor,
    };
```

with:

```ts
      aspect: screen[2] / screen[3],
      masks: activeMasks(project.masks, sourceTime),
      texts: activeTexts(project.texts, sourceTime, (text) => amount(textShown.get(text), TEXT_FADE_SECONDS, 'linear')),
      // a motion overlay's clock runs in output seconds from where its stretch starts showing
      overlays: project.overlays.flatMap((overlay, index) => {
        const occurrence = overlay.enabled ? overlayShown[index]?.[span.index] : undefined;
        if (!occurrence || shownAt < occurrence.start - 1e-9 || shownAt >= occurrence.end - 1e-9) return [];
        return [{ index, key: `${index}@${round(occurrence.start)}`, local: round(shownAt - occurrence.start), duration: round(occurrence.end - occurrence.start) }];
      }),
      badge: badgeFor(scene),
      cursor,
    };
```

In `packages/timeline/src/index.ts`, replace:

```ts
export { ZOOM_MOVE_SECONDS, ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt, zoomTargetAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, maskRectAt, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
export {
  CAPTION_RULES,
  applyCaptionFixes,
```

with:

```ts
export { ZOOM_MOVE_SECONDS, ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt, zoomTargetAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, maskRectAt, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type ActiveOverlay, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
export {
  CAPTION_RULES,
  applyCaptionFixes,
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/timeline`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/timeline
git commit -m "timeline: motion scenes as layers, and the overlays a clip shows with their own clocks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The page's runtime

**Files:**
- Create: `packages/export/src/motion/runtime.ts`, `packages/export/src/motion/init.ts`, `packages/export/test/motion-runtime.browser.test.ts`, `packages/export/test/motion-init.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/export/test/motion-runtime.browser.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { motionRuntime, type CuttleApi, type MotionInit } from '../src/motion/runtime';

const INIT: MotionInit = {
  duration: 2,
  fps: 30,
  width: 320,
  height: 180,
  format: '16:9',
  params: { title: 'Hi' },
  theme: { '--cuttle-accent': '#d97757' },
  seed: 7,
};

type Page = Window &
  typeof globalThis & {
    cuttle: CuttleApi;
    __cuttleDraw(ms: number): Promise<number>;
    __cuttleReady(): Promise<void>;
    __cuttleErrors: string[];
    seen: unknown[];
  };

const frames: HTMLIFrameElement[] = [];
afterEach(() => frames.splice(0).forEach((frame) => frame.remove()));

/**
 * A page in an iframe, as the renderer makes one: the runtime from its source text first (so it
 * must not need anything from outside itself), then the page's markup and script.
 */
function page(markup: string, script: string, init = INIT): Page {
  const frame = document.createElement('iframe');
  frame.style.cssText = `width:${init.width}px;height:${init.height + 4}px;border:0`;
  document.body.append(frame);
  frames.push(frame);
  const win = frame.contentWindow as Page;
  win.eval(`(${motionRuntime.toString()})(${JSON.stringify(init)});`);
  win.seen = [];
  win.document.body.innerHTML = markup;
  win.eval(script);
  return win;
}

describe('the motion runtime', () => {
  it('runs the page on its own clock: time, timers and animation frames move only when a frame is drawn', async () => {
    const win = page(
      '',
      `setTimeout(() => seen.push(['timeout', performance.now()]), 100);
       setInterval(() => seen.push(['interval', performance.now()]), 200);
       requestAnimationFrame((t) => seen.push(['frame', t, Date.now() - Date.UTC(2026, 0, 1)]));`,
    );
    expect(win.performance.now()).toBe(0);
    expect(win.Date.now()).toBe(Date.UTC(2026, 0, 1));
    expect(new win.Date().getTime()).toBe(Date.UTC(2026, 0, 1));
    await new Promise((done) => setTimeout(done, 150));
    expect(win.seen).toEqual([]);
    expect(await win.__cuttleDraw(500)).toBe(1);
    expect(win.seen).toEqual([
      ['timeout', 100],
      ['interval', 200],
      ['interval', 400],
      ['frame', 500, 500],
    ]);
    expect(win.cuttle.time).toBe(0.5);
    // never back: an earlier time leaves the clock where it is
    await win.__cuttleDraw(200);
    expect(win.performance.now()).toBe(500);
  });

  it('sets every CSS animation and Web Animation to the time since it first showed, paused', async () => {
    const win = page(
      `<style>@keyframes slide { to { transform: translateX(100px) } } #css { animation: slide 1s linear forwards }</style>
       <div id="css"></div><div id="waapi"></div>`,
      `document.getElementById('waapi').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, fill: 'forwards' });`,
    );
    await win.__cuttleDraw(0);
    await win.__cuttleDraw(250);
    const animation = (id: string) => win.document.getElementById(id)!.getAnimations()[0]!;
    const css = animation('css');
    const waapi = animation('waapi');
    expect(css.currentTime).toBe(250);
    expect(waapi.currentTime).toBe(250);
    expect(css.playState).toBe('paused');
    expect(win.getComputedStyle(win.document.getElementById('waapi')!).opacity).toBe('0.25');
    expect(win.getComputedStyle(win.document.getElementById('css')!).transform).toBe('matrix(1, 0, 0, 1, 25, 0)');
  });

  it('gives the page window.cuttle: its time, size, params and theme, and a draw call for every frame', async () => {
    const win = page('<div id="accent" style="color: var(--cuttle-accent)"></div>', `cuttle.onFrame((t) => seen.push(t));`);
    expect(win.cuttle).toMatchObject({ duration: 2, fps: 30, size: { width: 320, height: 180 }, format: '16:9', params: { title: 'Hi' } });
    expect(win.getComputedStyle(win.document.getElementById('accent')!).color).toBe('rgb(217, 119, 87)');
    await win.__cuttleDraw(0);
    await win.__cuttleDraw(1000 / 30);
    expect(win.seen).toEqual([0, 1 / 30]);
  });

  it('seeds Math.random: the same seed gives the same numbers', () => {
    const numbers = (seed: number) => page('', 'seen.push(Math.random(), Math.random(), Math.random())', { ...INIT, seed }).seen;
    const first = numbers(7);
    expect(numbers(7)).toEqual(first);
    expect(numbers(8)).not.toEqual(first);
    expect(first.every((n) => typeof n === 'number' && n >= 0 && n < 1)).toBe(true);
  });

  it('marks each drawn frame below the page with its number', async () => {
    const win = page('', '');
    await win.__cuttleDraw(0);
    expect(await win.__cuttleDraw(0)).toBe(2);
    const marker = [...win.document.documentElement.children].find((element) => (element as HTMLElement).style.top === '180px') as HTMLElement;
    expect(marker.style.background).toBe('rgb(2, 0, 200)');
  });

  it('notes what the page throws and goes on; a timeout that sets itself again cannot stall a frame', async () => {
    const win = page('', `cuttle.onFrame(() => { throw new TypeError('no title'); }); const again = () => setTimeout(again, 0); again(); Promise.reject(new Error('lost'));`);
    expect(await win.__cuttleDraw(100)).toBe(1);
    await new Promise((done) => setTimeout(done, 0));
    expect(win.__cuttleErrors).toEqual(expect.arrayContaining(['TypeError: no title', 'Error: lost']));
  });

  it('waits for what the page asks to wait for before its first frame', async () => {
    const win = page('', `let release; cuttle.ready(new Promise((done) => (release = done))); window.release = () => release();`);
    let ready = false;
    void win.__cuttleReady().then(() => (ready = true));
    await new Promise((done) => setTimeout(done, 50));
    expect(ready).toBe(false);
    (win as unknown as { release(): void }).release();
    await new Promise((done) => setTimeout(done, 0));
    expect(ready).toBe(true);
  });
});
```

`packages/export/test/motion-init.test.ts`:

```ts
import { parseProject } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { formatName, motionInit, motionSeed, motionTheme } from '../src/motion/init';

function project(input: Record<string, unknown> = {}) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

describe('motion pages are told', () => {
  it('the look as CSS variables: the accent, a tone of the background, the fonts', () => {
    expect(motionTheme(project())).toEqual({
      '--cuttle-accent': '#D97757',
      '--cuttle-bg': '#1b1c4a',
      '--cuttle-fg': '#ffffff',
      '--cuttle-font': '"Inter", "Segoe UI", system-ui, sans-serif',
      '--cuttle-mono': '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    });
    const solid = motionTheme(project({ look: { background: { preset: 'solid', color: '#102030' }, cursor: { color: '#00ff88' } } }));
    expect(solid).toMatchObject({ '--cuttle-accent': '#00ff88', '--cuttle-bg': '#102030' });
  });

  it('the format by its shape, or its size', () => {
    expect(formatName({ width: 1920, height: 1080 })).toBe('16:9');
    expect(formatName({ width: 1080, height: 1920 })).toBe('9:16');
    expect(formatName({ width: 1080, height: 1080 })).toBe('1:1');
    expect(formatName({ width: 1440, height: 900 })).toBe('1440x900');
  });

  it('a seed of their own: the same for an item every time, another for another item', () => {
    expect(motionSeed('s1')).toBe(motionSeed('s1'));
    expect(motionSeed('s1')).not.toBe(motionSeed('s2'));
    expect(Number.isInteger(motionSeed('o1')) && motionSeed('o1') >= 0 && motionSeed('o1') < 2 ** 32).toBe(true);
  });

  it('their length, the output, their params, and a seed from their id (else their place)', () => {
    const p = project({ output: { width: 1080, height: 1920, fps: 60 }, scenes: [{ type: 'motion', src: 'a.html', duration: 2, params: { title: 'Hi' } }] });
    const scene = p.scenes[0]!;
    if (scene.type !== 'motion') throw new Error('not a motion scene');
    expect(motionInit(p, scene, 'scenes[0]', 2)).toEqual({
      duration: 2,
      fps: 60,
      width: 1080,
      height: 1920,
      format: '9:16',
      params: { title: 'Hi' },
      theme: motionTheme(p),
      seed: motionSeed('scenes[0]'),
    });
    expect(motionInit(p, { ...scene, id: 's7' }, 'scenes[0]', 2).seed).toBe(motionSeed('s7'));
  });
});
```

Run: `pnpm exec vitest run --project node packages/export/test/motion-init.test.ts`
Expected: FAIL: `../src/motion/init` does not exist.

- [ ] **Step 2: The runtime and what a page is told**

`packages/export/src/motion/runtime.ts`:

```ts
/// <reference lib="dom" />
// The page side of a motion item: run in the page before its own scripts (the renderer injects
// this function's source with its argument), so it must not use anything from outside itself.
//
// It gives the page a virtual clock: performance.now, Date, timers, requestAnimationFrame and every
// CSS animation, transition and Web Animation follow the frame being drawn, never the wall clock.
// `__cuttleDraw` moves it to a frame's time and answers once the browser has drawn the page as it
// is then; a marker pixel below the page names the frame, so the renderer knows which paint shows
// it. And it gives the page `window.cuttle`: its time, size, params, theme and a seeded random.

/** What the renderer tells the page. */
export interface MotionInit {
  /** Seconds the item lasts. */
  duration: number;
  fps: number;
  width: number;
  height: number;
  /** `16:9`, `9:16`, `1:1` or the output's own size. */
  format: string;
  params: Record<string, unknown>;
  /** CSS variables set on the page's root (`--cuttle-accent`…). */
  theme: Record<string, string>;
  /** Seeds `Math.random`, so the item looks the same in every render. */
  seed: number;
}

/** The page's `window.cuttle`. */
export interface CuttleApi {
  /** Seconds into this item. */
  readonly time: number;
  readonly duration: number;
  readonly fps: number;
  readonly size: { width: number; height: number };
  readonly format: string;
  readonly params: Record<string, unknown>;
  readonly theme: Record<string, string>;
  /** Calls `draw(seconds)` for every frame, before it is drawn (also after a seek): the surest way to animate. */
  onFrame(draw: (seconds: number) => void): void;
  /** Holds the first frame until `promise` settles (fonts, images, models). */
  ready(promise: Promise<unknown>): void;
}

export function motionRuntime(init: MotionInit): void {
  type Timer = { at: number; fn: unknown; args: unknown[]; every?: number };
  const page = window as unknown as Record<string, unknown>;
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, Timer>();
  const frames = new Map<number, FrameRequestCallback>();
  const drawers: ((seconds: number) => void)[] = [];
  const holds: Promise<unknown>[] = [];
  const errors: string[] = [];
  page.__cuttleErrors = errors;
  const note = (error: unknown) => errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  window.addEventListener('error', (event) => note(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => note(event.reason));

  // the browser's own frames: an advance answers once one has drawn the change
  const realFrame = window.requestAnimationFrame.bind(window);

  // a seeded random (mulberry32)
  let seed = init.seed >>> 0;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // time
  const RealDate = Date;
  const base = RealDate.UTC(2026, 0, 1);
  performance.now = () => now;
  class VirtualDate extends RealDate {
    constructor(...args: [] | ConstructorParameters<DateConstructor>) {
      if (args.length === 0) super(base + now);
      else super(...(args as [number]));
    }
    static override now(): number {
      return base + now;
    }
  }
  page.Date = VirtualDate;
  page.setTimeout = (fn: unknown, ms = 0, ...args: unknown[]) => {
    const id = nextId++;
    // at least 1 ms, as browsers clamp: a timeout that sets itself again cannot stall a frame
    timers.set(id, { at: now + Math.max(1, Number(ms) || 0), fn, args });
    return id;
  };
  page.setInterval = (fn: unknown, ms = 0, ...args: unknown[]) => {
    const id = nextId++;
    const every = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: now + every, fn, args, every });
    return id;
  };
  page.clearTimeout = page.clearInterval = (id: number) => timers.delete(id);
  page.requestAnimationFrame = (fn: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, fn);
    return id;
  };
  page.cancelAnimationFrame = (id: number) => frames.delete(id);

  /** Each animation's start on the clock: when it was first seen (CSS starts them as styles apply). */
  const started = new WeakMap<Animation, number>();
  const sight = () => {
    for (const animation of document.getAnimations()) if (!started.has(animation)) started.set(animation, now);
  };
  const call = (fn: unknown, args: unknown[]) => {
    try {
      if (typeof fn === 'function') fn(...args);
    } catch (error) {
      note(error);
    }
    sight();
  };

  // the theme, as CSS variables on the root (a constructed sheet works before the page is parsed)
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`:root { ${Object.entries(init.theme).map(([name, value]) => `${name}: ${value};`).join(' ')} }`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  const api: CuttleApi = {
    get time() {
      return now / 1000;
    },
    duration: init.duration,
    fps: init.fps,
    size: { width: init.width, height: init.height },
    format: init.format,
    params: init.params,
    theme: init.theme,
    onFrame: (draw) => void drawers.push(draw),
    ready: (promise) => void holds.push(Promise.resolve(promise).catch(note)),
  };
  page.cuttle = api;

  /** The frame marker: a 2×2 px element just below the page; its colour is the frame's number. */
  let marker: HTMLElement | undefined;
  const mark = (frame: number) => {
    if (!marker) {
      marker = document.createElement('div');
      marker.style.cssText = `position:fixed;left:0;top:${init.height}px;width:2px;height:2px;margin:0;padding:0;border:0;z-index:2147483647;pointer-events:none;background:#000`;
      document.documentElement.appendChild(marker);
    }
    marker.style.background = `rgb(${frame & 255}, ${(frame >> 8) & 255}, 200)`;
  };

  /** Once the page has loaded: its fonts, its images and what it asked to wait for. */
  page.__cuttleReady = async () => {
    await document.fonts.ready;
    const images = Array.from(document.images).filter((image) => !image.complete);
    await Promise.all(
      images.map(
        (image) =>
          new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          }),
      ),
    );
    await Promise.all(holds);
  };

  let frame = 0;
  /**
   * Moves the clock to `ms` (never back) and draws: due timers in order, one animation frame, every
   * animation to its time. Answers with the draw's number, which the marker shows.
   */
  page.__cuttleDraw = (ms: number): Promise<number> => {
    mark(++frame);
    sight();
    const target = Math.max(now, ms);
    for (let fired = 0; ; fired++) {
      if (fired === 100_000) {
        note(new Error('the page set more than 100000 timers in one frame'));
        break;
      }
      let due: [number, Timer] | undefined;
      for (const entry of timers) if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry;
      if (!due) break;
      const [id, timer] = due;
      now = timer.at;
      if (timer.every) timer.at += timer.every;
      else timers.delete(id);
      call(timer.fn, timer.args);
    }
    now = target;
    for (const draw of drawers) call(draw, [now / 1000]);
    const callbacks = [...frames.values()];
    frames.clear();
    for (const fn of callbacks) call(fn, [now]);
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = (now - (started.get(animation) ?? now)) * (animation.playbackRate || 1);
    }
    return new Promise((resolve) => realFrame(() => realFrame(() => resolve(frame))));
  };
}
```

`packages/export/src/motion/init.ts`:

```ts
import type { BackgroundPreset, CuttleProject, MotionOverlay, MotionScene } from '@cuttle/project';
import type { MotionInit } from './runtime';

/** A dark tone of each background preset, for pages that draw their own background. */
const BACKGROUND_TONES: Record<BackgroundPreset, string> = {
  'sunset-sky': '#1b1c4a',
  aurora: '#050816',
  mesh: '#2a2140',
  solid: '#16161a',
  image: '#16161a',
};

/** The project's look as CSS variables for its pages. */
export function motionTheme(project: CuttleProject): Record<string, string> {
  const { background, cursor } = project.look;
  return {
    '--cuttle-accent': cursor.color,
    '--cuttle-bg': background.preset === 'solid' && background.color ? background.color : BACKGROUND_TONES[background.preset],
    '--cuttle-fg': '#ffffff',
    '--cuttle-font': '"Inter", "Segoe UI", system-ui, sans-serif',
    '--cuttle-mono': '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
  };
}

/** `16:9`, `9:16` or `1:1` for those shapes, else the size (`1440x900`). */
export function formatName(size: { width: number; height: number }): string {
  const ratio = size.width / size.height;
  if (Math.abs(ratio - 16 / 9) < 0.01) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.01) return '9:16';
  if (Math.abs(ratio - 1) < 0.01) return '1:1';
  return `${size.width}x${size.height}`;
}

/** A seed from a name (FNV-1a): an item looks the same in every render, and two items differ. */
export function motionSeed(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
}

/** What a motion item's page is told: `duration` is how long this showing of it lasts (output seconds). */
export function motionInit(project: CuttleProject, item: MotionScene | MotionOverlay, name: string, duration: number): MotionInit {
  const { width, height, fps } = project.output;
  return {
    duration,
    fps,
    width,
    height,
    format: formatName(project.output),
    params: { ...item.params },
    theme: motionTheme(project),
    seed: motionSeed(item.id ?? name),
  };
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/export/test/motion-init.test.ts`
Expected: PASS.

Run: `pnpm exec vitest run --project browser packages/export/test/motion-runtime.browser.test.ts`
Expected: PASS, 7 tests (headless Chromium).

- [ ] **Step 4: Commit**

```bash
git add packages/export/src/motion packages/export/test
git commit -m "export: the motion page's runtime (a virtual clock, window.cuttle, the frame marker) and its theme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The engine draws motion

**Files:**
- Modify: `packages/engine/src/{renderer,index}.ts`, `packages/engine/src/gl/texture.ts`, `packages/engine/test/{renderer.browser.test,run-scenario}.ts`, `apps/desktop/src/renderer/editor/{frames,player,swatches}.ts`

- [ ] **Step 1: Write the failing test**

In `packages/engine/test/renderer.browser.test.ts`, replace:

```ts
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { maskRectToOutput, windowLayout } from '../src/layout';
import { FRAME_CHROME } from '../src/presets/frames';
import { createRenderer, type FrameSources } from '../src/renderer';
import { SCREEN, fakeScreen, fixtures } from './fixtures';
import { pixelAt, readPixels, type Pixels } from './gl-util';
```

with:

```ts
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { maskRectToOutput, windowLayout } from '../src/layout';
import { FRAME_CHROME } from '../src/presets/frames';
import { createRenderer, type FrameSources, type MotionPixels } from '../src/renderer';
import { SCREEN, fakeScreen, fixtures } from './fixtures';
import { pixelAt, readPixels, type Pixels } from './gl-util';
```

In the same file, replace:

```ts
  ],
});

const NO_SOURCES: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };

function layer(index: number, opacity: number, kind: SceneFrame['kind'] = 'card'): SceneFrame {
  return { index, sceneIndex: index, kind, local: 0, progress: 0, opacity, masks: [], texts: [] };
}

function render(project: CuttleProject, state: RenderState, sources = NO_SOURCES) {
```

with:

```ts
  ],
});

const NO_SOURCES: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };

function layer(index: number, opacity: number, kind: SceneFrame['kind'] = 'card'): SceneFrame {
  return { index, sceneIndex: index, kind, local: 0, progress: 0, opacity, masks: [], texts: [], overlays: [] };
}

function render(project: CuttleProject, state: RenderState, sources = NO_SOURCES) {
```

In the same file, replace:

```ts
      screens: new Map([[0, screen]]),
      webcams: new Map(webcam ? [[0, webcam]] : []),
      stills: new Map(),
    });
    const state: RenderState = { t: 0, layers: [layer(0, 1, 'clip')] };
    expect(() => render(project, state, frame(closed))).toThrow('render: the screen frame of scene 0 is empty (not decoded yet, or closed)');
```

with:

```ts
      screens: new Map([[0, screen]]),
      webcams: new Map(webcam ? [[0, webcam]] : []),
      stills: new Map(),
      motion: new Map(),
      overlays: new Map(),
    });
    const state: RenderState = { t: 0, layers: [layer(0, 1, 'clip')] };
    expect(() => render(project, state, frame(closed))).toThrow('render: the screen frame of scene 0 is empty (not decoded yet, or closed)');
```

In the same file, replace:

```ts
      const data = new ImageData(16, 10);
      for (let i = 0; i < data.data.length; i += 4) data.data.set(rgba, i);
      const image = await createImageBitmap(data, { premultiplyAlpha: 'premultiply' });
      const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map([[0, image]]) };
      return pixelAt(render(project, { t: 0, layers: [layer(0, 1, 'still')] }, sources).pixels, 32, 18);
    };
    expect(await still([0, 0, 0, 0])).toEqual([255, 255, 255, 255]);
```

with:

```ts
      const data = new ImageData(16, 10);
      for (let i = 0; i < data.data.length; i += 4) data.data.set(rgba, i);
      const image = await createImageBitmap(data, { premultiplyAlpha: 'premultiply' });
      const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map([[0, image]]), motion: new Map(), overlays: new Map() };
      return pixelAt(render(project, { t: 0, layers: [layer(0, 1, 'still')] }, sources).pixels, 32, 18);
    };
    expect(await still([0, 0, 0, 0])).toEqual([255, 255, 255, 255]);
```

In the same file, replace:

```ts
    const probe = new OffscreenCanvas(1, 1).getContext('webgl2')!;
    const max = probe.getParameter(probe.MAX_TEXTURE_SIZE) as number;
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    const still = (image: ImageBitmap): FrameSources => ({ screens: new Map(), webcams: new Map(), stills: new Map([[0, image]]) });
    const tall = await createImageBitmap(new ImageData(1, max + 1));
    expect(() => render(project, { t: 0, layers: [layer(0, 1, 'still')] }, still(tall))).toThrow(
      `render: the image of still scene 0 is 1×${max + 1} px, more than this GPU's limit of ${max} px`,
```

with:

```ts
    const probe = new OffscreenCanvas(1, 1).getContext('webgl2')!;
    const max = probe.getParameter(probe.MAX_TEXTURE_SIZE) as number;
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    const still = (image: ImageBitmap): FrameSources => ({ screens: new Map(), webcams: new Map(), stills: new Map([[0, image]]), motion: new Map(), overlays: new Map() });
    const tall = await createImageBitmap(new ImageData(1, max + 1));
    expect(() => render(project, { t: 0, layers: [layer(0, 1, 'still')] }, still(tall))).toThrow(
      `render: the image of still scene 0 is 1×${max + 1} px, more than this GPU's limit of ${max} px`,
```

In the same file, replace:

```ts
  function renderMask(style: MaskStyle, mask: Rect, source: OffscreenCanvas, zoom?: Rect) {
    const project = parse({ output: OUTPUT, scenes: [{ type: 'clip', from: 0, to: 1 }], masks: [{ from: 0, to: 1, rect: mask, style }] });
    const frame: SceneFrame = { ...layer(0, 1, 'clip'), zoom, masks: project.masks };
    const pixels = render(project, { t: 0, layers: [frame] }, { screens: new Map([[0, source]]), webcams: new Map(), stills: new Map() }).pixels;
    const { content } = windowLayout(OUTPUT, SCREEN.width / SCREEN.height, { titleBar: FRAME_CHROME['mac-dark'].titleBar, radius: 14 });
    return { pixels, rect: maskRectToOutput(mask, zoom ?? [0, 0, SCREEN.width, SCREEN.height], content) };
  }
```

with:

```ts
  function renderMask(style: MaskStyle, mask: Rect, source: OffscreenCanvas, zoom?: Rect) {
    const project = parse({ output: OUTPUT, scenes: [{ type: 'clip', from: 0, to: 1 }], masks: [{ from: 0, to: 1, rect: mask, style }] });
    const frame: SceneFrame = { ...layer(0, 1, 'clip'), zoom, masks: project.masks };
    const pixels = render(project, { t: 0, layers: [frame] }, { screens: new Map([[0, source]]), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() }).pixels;
    const { content } = windowLayout(OUTPUT, SCREEN.width / SCREEN.height, { titleBar: FRAME_CHROME['mac-dark'].titleBar, radius: 14 });
    return { pixels, rect: maskRectToOutput(mask, zoom ?? [0, 0, SCREEN.width, SCREEN.height], content) };
  }
```

In the same file, replace:

```ts
  function renderCursor(style: CursorStyle, cursor?: CursorFrame): Pixels {
    const project = parse({ output: OUTPUT, look: { frame: { radius: RADIUS }, cursor: { style, size: 2 } }, scenes: [{ type: 'clip', from: 0, to: 1 }] });
    const frame: SceneFrame = { ...layer(0, 1, 'clip'), cursor };
    return render(project, { t: 0, layers: [frame] }, { screens: new Map([[0, fakeScreen()]]), webcams: new Map(), stills: new Map() }).pixels;
  }

  /** Pixels that differ between `a` and `b`; with `outsideWindow`, only those the window's rounded rect leaves out. */
```

with:

```ts
  function renderCursor(style: CursorStyle, cursor?: CursorFrame): Pixels {
    const project = parse({ output: OUTPUT, look: { frame: { radius: RADIUS }, cursor: { style, size: 2 } }, scenes: [{ type: 'clip', from: 0, to: 1 }] });
    const frame: SceneFrame = { ...layer(0, 1, 'clip'), cursor };
    return render(project, { t: 0, layers: [frame] }, { screens: new Map([[0, fakeScreen()]]), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() }).pixels;
  }

  /** Pixels that differ between `a` and `b`; with `outsideWindow`, only those the window's rounded rect leaves out. */
```

In the same file, replace:

```ts
    }
  });
});
```

with:

```ts
    }
  });
});

describe('motion', () => {
  /** A 64×36 motion frame (premultiplied RGBA): the top half `top`, the bottom half `bottom`. */
  function motionFrame(top: number[], bottom: number[]): MotionPixels {
    const data = new Uint8Array(64 * 36 * 4);
    for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) data.set(y < 18 ? top : bottom, (y * 64 + x) * 4);
    return { width: 64, height: 36, data };
  }
  const near = (pixel: number[], expected: number[]) => pixel.forEach((value, i) => expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(1));
  const solid = { background: { preset: 'solid', color: '#204060' } } as const;
  const MOTION = parse({ look: solid, scenes: [{ type: 'motion', src: 'a.html', duration: 1 }] });

  it('draws a motion scene over the background, its top row first, with its transparency', () => {
    // the top opaque red, the bottom white at half opacity (premultiplied: 128 in every channel)
    const sources = { ...NO_SOURCES, motion: new Map([[0, motionFrame([255, 0, 0, 255], [128, 128, 128, 128])]]) };
    const { pixels } = render(MOTION, { t: 0, layers: [layer(0, 1, 'motion')] }, sources);
    expect(pixelAt(pixels, 5, 5)).toEqual([255, 0, 0, 255]);
    // 128 + (1 − 128/255) × the background (32, 64, 96)
    near(pixelAt(pixels, 5, 30), [144, 160, 176, 255]);
  });

  it('shows the background alone while a motion scene has no frame yet', () => {
    expect(pixelAt(render(MOTION, { t: 0, layers: [layer(0, 1, 'motion')] }).pixels, 5, 5)).toEqual([32, 64, 96, 255]);
  });

  it('refuses a frame whose bytes do not fit its size', () => {
    const broken = { ...NO_SOURCES, motion: new Map([[0, { width: 64, height: 36, data: new Uint8Array(100) }]]) };
    expect(() => render(MOTION, { t: 0, layers: [layer(0, 1, 'motion')] }, broken)).toThrow('render: the frame of motion scene 0 is 64×36 px with 100 bytes');
  });

  it('draws an overlay over the whole frame of a clip, where it is not clear', () => {
    const project = parse({ look: { ...solid, frame: { enabled: false } }, scenes: [{ type: 'clip', from: 0, to: 1 }], overlays: [{ src: 'o.html', at: 0, duration: 1 }] });
    const sources = { ...NO_SOURCES, screens: new Map([[0, fakeScreen()]]), overlays: new Map([['0@0', motionFrame([0, 0, 0, 0], [0, 255, 0, 255])]]) };
    const plain = render(project, { t: 0, layers: [layer(0, 1, 'clip')] }, sources).pixels;
    const shown = render(project, { t: 0, layers: [{ ...layer(0, 1, 'clip'), overlays: [{ index: 0, key: '0@0', local: 0, duration: 1 }] }] }, sources).pixels;
    expect(pixelAt(shown, 32, 30)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(shown, 1, 30)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(shown, 32, 5)).toEqual(pixelAt(plain, 32, 5));
  });
});
```

In `packages/engine/test/run-scenario.ts`, replace:

```ts
  const state = createTimeline(project, { screenSize: SCREEN, cursor, ...(scenario.transcript && { transcript: scenario.transcript }) }).frameAt(scenario.t);

  const fake = await fixtures();
  const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };
  for (const layer of state.layers) {
    if (layer.kind === 'clip') {
      sources.screens.set(layer.index, fake.screen);
```

with:

```ts
  const state = createTimeline(project, { screenSize: SCREEN, cursor, ...(scenario.transcript && { transcript: scenario.transcript }) }).frameAt(scenario.t);

  const fake = await fixtures();
  const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };
  for (const layer of state.layers) {
    if (layer.kind === 'clip') {
      sources.screens.set(layer.index, fake.screen);
```

Run: `pnpm exec vitest run --project browser packages/engine/test/renderer.browser.test.ts`
Expected: FAIL: the motion frames are not drawn.

- [ ] **Step 2: Motion frames as textures**

In `packages/engine/src/gl/texture.ts`, replace:

```ts
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
}

/** Pixel size of anything `texImage2D` accepts. */
export function sourceSize(source: TexImageSource): Size {
  if ('displayWidth' in source) return { width: source.displayWidth, height: source.displayHeight }; // VideoFrame
```

with:

```ts
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
}

/** Uploads RGBA bytes that are premultiplied already, top row first, as they are. */
export function uploadPixels(gl: WebGL2RenderingContext, texture: WebGLTexture, pixels: { width: number; height: number; data: Uint8Array }): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pixels.width, pixels.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels.data);
}

/** Pixel size of anything `texImage2D` accepts. */
export function sourceSize(source: TexImageSource): Size {
  if ('displayWidth' in source) return { width: source.displayWidth, height: source.displayHeight }; // VideoFrame
```

In `packages/engine/src/renderer.ts`, replace:

```ts
import type { EngineAssets } from './assets';
import { CAPTION_LOOKS, drawCaption } from './captions';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, sourceSize, uploadTexture } from './gl/texture';
import { placeBadge, placeOverlay, stillCrop, unitFor, uvRect, webcamRect, windowLayout, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
```

with:

```ts
import type { EngineAssets } from './assets';
import { CAPTION_LOOKS, drawCaption } from './captions';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, sourceSize, uploadPixels, uploadTexture } from './gl/texture';
import { placeBadge, placeOverlay, stillCrop, unitFor, uvRect, webcamRect, windowLayout, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
```

In the same file, replace:

```ts
import { BADGE_STYLE, CARD_SUBTITLE_STYLE, CARD_TITLE_STYLE, TEXT_LABELS } from './presets/labels';
import { SpriteCache } from './sprites';

/**
 * Per-frame images, keyed by `SceneFrame.index`: during a crossfade two clip layers with
 * unrelated source times are visible at once.
```

with:

```ts
import { BADGE_STYLE, CARD_SUBTITLE_STYLE, CARD_TITLE_STYLE, TEXT_LABELS } from './presets/labels';
import { SpriteCache } from './sprites';

/** A motion page's frame: premultiplied RGBA, top row first (drawn over the whole output). */
export interface MotionPixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Per-frame images, keyed by `SceneFrame.index`: during a crossfade two clip layers with
 * unrelated source times are visible at once.
```

In the same file, replace:

```ts
   * and no larger than `MAX_TEXTURE_SIZE` on either side (render throws otherwise).
   */
  stills: Map<number, ImageBitmap>;
}

export interface Renderer {
```

with:

```ts
   * and no larger than `MAX_TEXTURE_SIZE` on either side (render throws otherwise).
   */
  stills: Map<number, ImageBitmap>;
  /** Scene index → the frame of a motion scene; a scene without one shows the background alone (its page is not drawn yet). */
  motion: Map<number, MotionPixels>;
  /** `ActiveOverlay.key` → the frame of a motion overlay; one without a frame is left out. */
  overlays: Map<string, MotionPixels>;
}

export interface Renderer {
```

In the same file, replace:

```ts
  const webcam = own(new WebcamPass(gl, output));
  const webcamTexture = texture(true);
  const stillTexture = texture(true);
  let uploadedStill: ImageBitmap | undefined;
  let layerTarget: RenderTarget | undefined;
  let disposed = false;
```

with:

```ts
  const webcam = own(new WebcamPass(gl, output));
  const webcamTexture = texture(true);
  const stillTexture = texture(true);
  const motionTexture = texture(false);
  const fullFrame: Rect = [0, 0, output.width, output.height];
  let uploadedStill: ImageBitmap | undefined;
  let layerTarget: RenderTarget | undefined;
  let disposed = false;
```

In the same file, replace:

```ts
    const badgeRect = badge ? placeBadge(layout.content, badge.box, unit, webcamArea) : undefined;
    drawTexts(layer.texts, [webcamArea, badgeRect].filter((rect): rect is Rect => rect !== undefined));
    if (badge && badgeRect) spritePass.drawSprite(badge, badgeRect[0], badgeRect[1], 1);
  }

  function drawStill(layer: SceneFrame, scene: StillScene, sources: FrameSources): void {
```

with:

```ts
    const badgeRect = badge ? placeBadge(layout.content, badge.box, unit, webcamArea) : undefined;
    drawTexts(layer.texts, [webcamArea, badgeRect].filter((rect): rect is Rect => rect !== undefined));
    if (badge && badgeRect) spritePass.drawSprite(badge, badgeRect[0], badgeRect[1], 1);
    // motion overlays: over the finished clip, zooms, masks and the cursor (captions come last)
    for (const overlay of layer.overlays) {
      const pixels = sources.overlays.get(overlay.key);
      if (pixels) drawMotion(pixels, `overlay ${overlay.index}`);
    }
  }

  /** A motion page's frame over the whole output, with its transparency. */
  function drawMotion(pixels: MotionPixels, what: string): void {
    if (!(pixels.width > 0 && pixels.height > 0) || pixels.data.byteLength !== pixels.width * pixels.height * 4) {
      throw new Error(`render: the frame of motion ${what} is ${pixels.width}×${pixels.height} px with ${pixels.data.byteLength} bytes`);
    }
    if (Math.max(pixels.width, pixels.height) > maxTextureSize) {
      throw new Error(`render: the frame of motion ${what} is ${pixels.width}×${pixels.height} px, more than this GPU's limit of ${maxTextureSize} px`);
    }
    uploadPixels(gl, motionTexture, pixels);
    spritePass.draw(motionTexture, fullFrame, 1);
  }

  function drawStill(layer: SceneFrame, scene: StillScene, sources: FrameSources): void {
```

In the same file, replace:

```ts
    background.draw(t);
    if (scene.type === 'card') drawCard(scene);
    else if (scene.type === 'clip') drawClip(layer, sources);
    else drawStill(layer, scene, sources);
  }

  return {
```

with:

```ts
    background.draw(t);
    if (scene.type === 'card') drawCard(scene);
    else if (scene.type === 'clip') drawClip(layer, sources);
    else if (scene.type === 'still') drawStill(layer, scene, sources);
    else {
      const pixels = sources.motion.get(layer.index);
      if (pixels) drawMotion(pixels, `scene ${layer.sceneIndex}`);
    }
  }

  return {
```

In `packages/engine/src/index.ts`, replace:

```ts
export { FONT_FAMILY, loadEngineAssets, type EngineAssets } from './assets';
export { createRenderer, type DrawnText, type FrameSources, type Renderer, type RendererOptions } from './renderer';
export { webcamRect, type Size } from './layout';
export type { CursorImage } from './presets/cursors';
```

with:

```ts
export { FONT_FAMILY, loadEngineAssets, type EngineAssets } from './assets';
export { createRenderer, type DrawnText, type FrameSources, type MotionPixels, type Renderer, type RendererOptions } from './renderer';
export { webcamRect, type Size } from './layout';
export type { CursorImage } from './presets/cursors';
```

Every `FrameSources` the app makes gets the two new maps:

In `apps/desktop/src/renderer/editor/frames.ts`, replace:

```ts
export class PlaybackFrames {
  private readonly open = new Map<number, OpenScene>();
  private readonly pending: ScenePlan[];
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };

  constructor(
    plan: FramePlan,
```

with:

```ts
export class PlaybackFrames {
  private readonly open = new Map<number, OpenScene>();
  private readonly pending: ScenePlan[];
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };

  constructor(
    plan: FramePlan,
```

In `apps/desktop/src/renderer/editor/player.ts`, replace:

```ts
    const frame = this.frameOf(time);
    const state = this.timeline.frameAt(frame / this.fps);
    const held: HeldFrame[] = [];
    const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };
    const stills = this.stillsByIndex();
    try {
      for (const layer of state.layers) {
```

with:

```ts
    const frame = this.frameOf(time);
    const state = this.timeline.frameAt(frame / this.fps);
    const held: HeldFrame[] = [];
    const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };
    const stills = this.stillsByIndex();
    try {
      for (const layer of state.layers) {
```

In `apps/desktop/src/renderer/editor/swatches.ts`, replace:

```ts
  const events: InputEvent[] = [{ t: 0, type: 'move', ...shot.at }];
  if (shot.shape) events.push({ t: 0, type: 'shape', shape: shot.shape });
  const state = createTimeline(parsed.project, { screenSize, cursor: createCursorTrack(events) }).frameAt(1);
  const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };
  for (const layer of state.layers) if (layer.kind === 'clip') sources.screens.set(layer.index, shot.screen);
  const renderer = createRenderer(gl, parsed.project, { assets, screenSize });
  try {
```

with:

```ts
  const events: InputEvent[] = [{ t: 0, type: 'move', ...shot.at }];
  if (shot.shape) events.push({ t: 0, type: 'shape', shape: shot.shape });
  const state = createTimeline(parsed.project, { screenSize, cursor: createCursorTrack(events) }).frameAt(1);
  const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };
  for (const layer of state.layers) if (layer.kind === 'clip') sources.screens.set(layer.index, shot.screen);
  const renderer = createRenderer(gl, parsed.project, { assets, screenSize });
  try {
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project browser packages/engine`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/engine apps/desktop/src/renderer/editor
git commit -m "engine: motion frames, a scene over the background and an overlay over the clip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Pages rendered for the export

**Files:**
- Create: `packages/export/src/main/motion.ts`, `packages/export/src/main/motion-host.ts`
- Modify: `packages/export/src/{frame-plan,job,index}.ts`, `packages/export/src/main/{sources,export,stills}.ts`, `packages/export/src/page/{scene-sources,run}.ts`, `packages/export/electron/export-page/preload.cjs`, `packages/export/electron/check.ts`, `packages/export/test/frame-plan.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/export/test/frame-plan.test.ts`, replace:

```ts
  });
});

describe('planFrames over cuts', () => {
  it('reads the pieces of a cut clip with one decoder: one plan, its source times jumping forward', () => {
    const result = plan({ scenes: [{ type: 'clip', from: 0, to: 2 }], cuts: [{ from: 0.5, to: 1.5 }] }, 10);
```

with:

```ts
  });
});

describe('planFrames with motion', () => {
  it('plans a motion scene like a card, and each showing of an overlay with its frames and length', () => {
    const result = plan(
      {
        look: { transition: { enabled: false } },
        scenes: [
          { type: 'motion', src: 'intro.html', duration: 1 },
          { type: 'clip', from: 0, to: 4 },
        ],
        overlays: [
          { src: 'callout.html', at: 1, duration: 2 },
          { src: 'off.html', at: 0, duration: 4, enabled: false },
        ],
      },
      10,
    );
    expect(result.scenes.map(({ index, kind, firstFrame, lastFrame, sourceTimes }) => ({ index, kind, firstFrame, lastFrame, times: sourceTimes.length }))).toEqual([
      { index: 0, kind: 'motion', firstFrame: 0, lastFrame: 9, times: 0 },
      { index: 1, kind: 'clip', firstFrame: 10, lastFrame: 49, times: 40 },
    ]);
    // source 1–3 shows at output 2–4: frames 20 to 39
    expect(result.overlays).toEqual([{ key: '0@2', index: 0, duration: 2, firstFrame: 20, lastFrame: 39 }]);
  });
});

describe('planFrames over cuts', () => {
  it('reads the pieces of a cut clip with one decoder: one plan, its source times jumping forward', () => {
    const result = plan({ scenes: [{ type: 'clip', from: 0, to: 2 }], cuts: [{ from: 0.5, to: 1.5 }] }, 10);
```

Run: `pnpm exec vitest run --project node packages/export/test/frame-plan.test.ts`
Expected: FAIL: the plan has no `overlays`.

- [ ] **Step 2: The plan and the job**

In `packages/export/src/frame-plan.ts`, replace:

```ts
/** Where one scene is visible in the export and which source times its clip frames come from. */
export interface ScenePlan {
  index: number;
  kind: 'clip' | 'still' | 'card';
  /** First and last output frame (inclusive) on which the scene is drawn, crossfades included. */
  firstFrame: number;
  lastFrame: number;
  /**
   * Clip scenes: every source time the frames ask for, in frame order, without repeats (seconds
   * of the screen track). Ascending: the timeline never goes back within a clip. Empty for still
   * and card scenes.
   */
  sourceTimes: number[];
}

export interface FramePlan {
  fps: number;
  /** Output frames; frame i shows output time i / fps. */
  frames: number;
  /** Scenes in the order they first appear. */
  scenes: ScenePlan[];
}

/** Frames for `duration` output seconds: every started frame counts, so the video never ends early. */
```

with:

```ts
/** Where one scene is visible in the export and which source times its clip frames come from. */
export interface ScenePlan {
  index: number;
  kind: 'clip' | 'still' | 'card' | 'motion';
  /** First and last output frame (inclusive) on which the scene is drawn, crossfades included. */
  firstFrame: number;
  lastFrame: number;
  /**
   * Clip scenes: every source time the frames ask for, in frame order, without repeats (seconds
   * of the screen track). Ascending: the timeline never goes back within a clip. Empty for still,
   * card and motion scenes.
   */
  sourceTimes: number[];
}

/** Where one showing of a motion overlay (`ActiveOverlay.key`) is visible in the export. */
export interface OverlayPlan {
  key: string;
  /** Its place in the project's `overlays`. */
  index: number;
  /** How long the showing lasts, in output seconds. */
  duration: number;
  firstFrame: number;
  lastFrame: number;
}

export interface FramePlan {
  fps: number;
  /** Output frames; frame i shows output time i / fps. */
  frames: number;
  /** Scenes in the order they first appear. */
  scenes: ScenePlan[];
  /** Motion overlays' showings, in the order they first appear. */
  overlays: OverlayPlan[];
}

/** Frames for `duration` output seconds: every started frame counts, so the video never ends early. */
```

In the same file, replace:

```ts
export function planFrames(timeline: Timeline, fps: number): FramePlan {
  if (timeline.spans.length === 0) throw new Error('planFrames: the project has no scenes');
  const frames = frameCount(timeline.duration, fps);
  return { fps, frames, scenes: planScenes(timeline, fps, Array.from({ length: frames }, (_, frame) => frame)) };
}

/**
```

with:

```ts
export function planFrames(timeline: Timeline, fps: number): FramePlan {
  if (timeline.spans.length === 0) throw new Error('planFrames: the project has no scenes');
  const frames = frameCount(timeline.duration, fps);
  return { fps, frames, ...planScenes(timeline, fps, Array.from({ length: frames }, (_, frame) => frame)) };
}

/**
```

In the same file, replace:

```ts
export function planStills(timeline: Timeline, fps: number, frames: readonly number[]): FramePlan {
  if (timeline.spans.length === 0) throw new Error('planStills: the project has no scenes');
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  return { fps, frames: sorted.length, scenes: planScenes(timeline, fps, sorted) };
}

/**
```

with:

```ts
export function planStills(timeline: Timeline, fps: number, frames: readonly number[]): FramePlan {
  if (timeline.spans.length === 0) throw new Error('planStills: the project has no scenes');
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  return { fps, frames: sorted.length, ...planScenes(timeline, fps, sorted) };
}

/**
```

In the same file, replace:

```ts
 * in it is one plan: its pieces follow each other and only jump forward in source time, so one
 * decoder reads them all.
 */
function planScenes(timeline: Timeline, fps: number, frames: readonly number[]): ScenePlan[] {
  const byIndex = new Map<number, ScenePlan>();
  for (const frame of frames) {
    for (const layer of timeline.frameAt(frame / fps).layers) {
      let plan = byIndex.get(layer.sceneIndex);
      if (!plan) {
        plan = { index: layer.sceneIndex, kind: layer.kind, firstFrame: frame, lastFrame: frame, sourceTimes: [] };
```

with:

```ts
 * in it is one plan: its pieces follow each other and only jump forward in source time, so one
 * decoder reads them all.
 */
function planScenes(timeline: Timeline, fps: number, frames: readonly number[]): Pick<FramePlan, 'scenes' | 'overlays'> {
  const byIndex = new Map<number, ScenePlan>();
  const byKey = new Map<string, OverlayPlan>();
  for (const frame of frames) {
    for (const layer of timeline.frameAt(frame / fps).layers) {
      for (const overlay of layer.overlays) {
        const seen = byKey.get(overlay.key);
        if (seen) seen.lastFrame = frame;
        else byKey.set(overlay.key, { key: overlay.key, index: overlay.index, duration: overlay.duration, firstFrame: frame, lastFrame: frame });
      }
      let plan = byIndex.get(layer.sceneIndex);
      if (!plan) {
        plan = { index: layer.sceneIndex, kind: layer.kind, firstFrame: frame, lastFrame: frame, sourceTimes: [] };
```

In the same file, replace:

```ts
    }
  }
  // Map order is first appearance: frame order, and within a frame the layers back to front.
  return [...byIndex.values()];
}
```

with:

```ts
    }
  }
  // Map order is first appearance: frame order, and within a frame the layers back to front.
  return { scenes: [...byIndex.values()], overlays: [...byKey.values()] };
}
```

In `packages/export/src/job.ts`, replace:

```ts
/** Why an export failed; the CLI maps these to exit codes (see `ExportError`). */
export type ExportErrorCode = 'invalid-project' | 'missing-file' | 'invalid-media' | 'ffmpeg-missing' | 'render' | 'cancelled';

/** Everything the page needs for one export. Paths are absolute; the page may read only these files. */
export interface ExportJob {
  kind: 'video';
```

with:

```ts
/** Why an export failed; the CLI maps these to exit codes (see `ExportError`). */
export type ExportErrorCode = 'invalid-project' | 'missing-file' | 'invalid-media' | 'ffmpeg-missing' | 'render' | 'cancelled';

/** The job's motion pages (absolute paths), which the main process renders: the folder they may read, and each item's page. */
export interface MotionPages {
  root: string;
  /** Scene index → its page. */
  scenes: Record<number, string>;
  /** Overlay index → its page. */
  overlays: Record<number, string>;
}

/** A motion page's frame: premultiplied RGBA, top row first (what the engine draws as `MotionPixels`). */
export interface MotionPixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A frame of one showing of a motion item, which the page asks the main process for. */
export interface MotionFrameRequest {
  /** The showing: `scene:<index>`, or `overlay:` and the overlay's `ActiveOverlay.key`. */
  key: string;
  kind: 'scene' | 'overlay';
  /** Its place in the project's `scenes` or `overlays`. */
  index: number;
  /** Frame n is n / fps seconds into the showing. */
  frame: number;
  /** How long the showing lasts, in output seconds. */
  duration: number;
}

/** Everything the page needs for one export. Paths are absolute; the page may read only these files. */
export interface ExportJob {
  kind: 'video';
```

In the same file, replace:

```ts
  stills: Record<number, string>;
  /** Image for `look.background.preset: 'image'`. */
  backgroundImage?: string;
  encoder: EncoderPreference;
}
```

with:

```ts
  stills: Record<number, string>;
  /** Image for `look.background.preset: 'image'`. */
  backgroundImage?: string;
  /** Present when the project has motion scenes or overlays. */
  motion?: MotionPages;
  encoder: EncoderPreference;
}
```

In the same file, replace:

```ts
  progress(done: number, total: number): void;
  /** Writes a PNG of a stills job: `still-<n>` (0-based, in the order of `times`) or `sheet`. */
  writeStill(name: string, data: Uint8Array): Promise<void>;
}

/** IPC channel names; keep electron/export-page/preload.cjs in sync. */
```

with:

```ts
  progress(done: number, total: number): void;
  /** Writes a PNG of a stills job: `still-<n>` (0-based, in the order of `times`) or `sheet`. */
  writeStill(name: string, data: Uint8Array): Promise<void>;
  /** A motion item's frame (frames of one showing only go forward; an earlier one starts it again). */
  motionFrame(request: MotionFrameRequest): Promise<MotionPixels>;
  /** A showing is over: its page closes. */
  motionDone(key: string): void;
}

/** IPC channel names; keep electron/export-page/preload.cjs in sync. */
```

In the same file, replace:

```ts
  write: 'cuttle-export:write',
  progress: 'cuttle-export:progress',
  writeStill: 'cuttle-export:write-still',
} as const;
```

with:

```ts
  write: 'cuttle-export:write',
  progress: 'cuttle-export:progress',
  writeStill: 'cuttle-export:write-still',
  motionFrame: 'cuttle-export:motion-frame',
  motionDone: 'cuttle-export:motion-done',
} as const;
```

In `packages/export/electron/export-page/preload.cjs`, replace:

```js
  write: (data, position) => ipcRenderer.invoke('cuttle-export:write', data, position),
  progress: (done, total) => ipcRenderer.send('cuttle-export:progress', done, total),
  writeStill: (name, data) => ipcRenderer.invoke('cuttle-export:write-still', name, data),
});
```

with:

```js
  write: (data, position) => ipcRenderer.invoke('cuttle-export:write', data, position),
  progress: (done, total) => ipcRenderer.send('cuttle-export:progress', done, total),
  writeStill: (name, data) => ipcRenderer.invoke('cuttle-export:write-still', name, data),
  motionFrame: (request) => ipcRenderer.invoke('cuttle-export:motion-frame', request),
  motionDone: (key) => ipcRenderer.send('cuttle-export:motion-done', key),
});
```

- [ ] **Step 3: The page renderer and the host**

`packages/export/src/main/motion.ts`:

```ts
// A motion item's page, rendered frame by frame (see docs/superpowers/spikes/2026-10-17-p5-virtual-clock.md):
// a hidden offscreen window, sandboxed, that reaches only the project's files (`cuttle-motion:`)
// and no network; the page's clock is virtual (`motionRuntime`, injected before its scripts), and
// each frame is the paint whose marker pixel names it. Frames come out as premultiplied RGBA, the
// page's transparency kept, the same on every render.
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { BrowserWindow, session, type NativeImage, type Session } from 'electron';
import { motionRuntime, type MotionInit } from '../motion/runtime';

export const MOTION_SCHEME = 'cuttle-motion';

/** The scheme's privileges, for the one `protocol.registerSchemesAsPrivileged` call each app makes before it is ready. */
export const MOTION_SCHEME_PRIVILEGES: Electron.CustomScheme = {
  scheme: MOTION_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
};

/** Longest wait for one frame, and for the page to load (its fonts, images and `cuttle.ready`), in ms. */
export const FRAME_TIMEOUT_MS = 5_000;
export const LOAD_TIMEOUT_MS = 30_000;
/** At most this many console lines are kept per page. */
const MAX_LOG_LINES = 200;

/** A page's frame: premultiplied RGBA, top row first. */
export interface MotionFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

/** What went wrong in a page, and what it logged. */
export interface MotionReport {
  errors: string[];
  console: string[];
}

export interface MotionPageOptions {
  /** The page (an HTML file inside `root`). */
  file: string;
  /** The project's folder: the only files the page reaches. */
  root: string;
  init: MotionInit;
  /** Let the page reach https: (off unless the item allows it). */
  network?: boolean;
  frameTimeout?: number;
  loadTimeout?: number;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain',
};

/** The page's rules: its own files, data and blob URLs, inline code; https only when the item allows it. */
function contentPolicy(network: boolean): string {
  const own = `${MOTION_SCHEME}: data: blob:${network ? ' https:' : ''}`;
  return [
    `default-src ${own} 'unsafe-inline' 'unsafe-eval'`,
    `connect-src ${own}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** Whether `path` lies inside `base` (both absolute). */
function inside(base: string, path: string): boolean {
  const rel = relative(base, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

let sessions = 0;
/**
 * Sessions no page uses, by project folder and network switch. Electron keeps every session for the
 * app's life, so the app's many exports take them from here, emptied, instead of making new ones.
 */
const idle = new Map<string, Session[]>();
const poolKey = (root: string, network: boolean) => `${resolve(root)}|${network}`;

/** A session of its own for one page: its files from `root`, no permissions, no network unless asked. */
function takeSession(root: string, network: boolean): Session {
  return idle.get(poolKey(root, network))?.pop() ?? pageSession(root, network);
}

/** A page is done with `ses`: what the page stored is wiped, and the next page may take it. */
function giveBack(ses: Session, root: string, network: boolean): void {
  void ses
    .clearStorageData()
    .catch(() => {})
    .then(() => {
      const key = poolKey(root, network);
      idle.set(key, [...(idle.get(key) ?? []), ses]);
    });
}

function pageSession(root: string, network: boolean): Session {
  const ses = session.fromPartition(`cuttle-motion-${process.pid}-${++sessions}`, { cache: false });
  const base = resolve(root);
  const policy = contentPolicy(network);
  ses.protocol.handle(MOTION_SCHEME, async (request) => {
    const url = new URL(request.url);
    const path = resolve(base, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (url.host !== 'project' || !inside(base, path)) return new Response('not found', { status: 404 });
    try {
      const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
      return new Response(await readFile(path), { headers: { 'Content-Type': type, 'Content-Security-Policy': policy, 'Cache-Control': 'no-store' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
  // the page's own files, data and blob URLs; the network only when the item allows it
  ses.webRequest.onBeforeRequest((details, callback) => {
    const scheme = details.url.slice(0, details.url.indexOf(':'));
    const allowed = scheme === MOTION_SCHEME || scheme === 'data' || scheme === 'blob' || scheme === 'devtools' || (network && scheme === 'https');
    callback({ cancel: !allowed });
  });
  return ses;
}

/** The page's URL in its session. */
export const pageUrl = (root: string, file: string): string =>
  `${MOTION_SCHEME}://project/${relative(resolve(root), resolve(file)).split(sep).map(encodeURIComponent).join('/')}`;

/** BGRA (Chromium's bitmap) to RGBA in place (`data` owns its buffer); both premultiplied. */
function toRgba(data: Uint8Array): Uint8Array {
  const pixels = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i]!;
    pixels[i] = (p & 0xff00ff00) | ((p & 0xff) << 16) | ((p >>> 16) & 0xff);
  }
  return data;
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** One motion item's page, open. `frame(n)` draws its frame `n` (n / fps seconds into it); frames only go forward. */
export class MotionPage {
  /** The frame drawn last; -1 before the first. */
  private drawn = -1;
  private last: MotionFrame | undefined;
  private latest: NativeImage | undefined;
  private waiting: (() => void) | undefined;
  private readonly logs: string[] = [];
  private failure: string | undefined;

  private constructor(
    private readonly win: BrowserWindow,
    private readonly options: MotionPageOptions,
    private readonly ses: Session,
  ) {
    const contents = win.webContents;
    contents.on('paint', (_event, _dirty, image) => {
      // an invalidate answers at once with an empty paint; the frame comes after it
      if (image.isEmpty()) return;
      this.latest = image;
      this.waiting?.();
    });
    contents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
      // Electron's own advice to apps that are not packaged yet, not the page's
      if (this.logs.length >= MAX_LOG_LINES || message.startsWith('%cElectron Security Warning')) return;
      const where = sourceId ? ` (${sourceId.replace(/^.*\//, '')}:${lineNumber})` : '';
      this.logs.push(`${level}: ${message}${where}`);
    });
    contents.on('render-process-gone', (_event, details) => {
      this.failure = `the motion page's renderer stopped (${details.reason})`;
      this.waiting?.();
    });
  }

  static async open(options: MotionPageOptions): Promise<MotionPage> {
    const { width, height } = options.init;
    const ses = takeSession(options.root, options.network === true);
    const win = new BrowserWindow({
      show: false,
      // a few rows more than the page: the frame marker sits below it (Electron rounds small heights up)
      width,
      height: height + 4,
      transparent: true,
      frame: false,
      backgroundColor: '#00000000',
      useContentSize: true,
      enableLargerThanScreen: true,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
        session: ses,
      },
    });
    // A new window is kept inside the screen's work area (a 9:16 page is taller than most screens);
    // a resize afterwards is not, and the paint follows the window.
    win.setContentSize(width, height + 4);
    const contents = win.webContents;
    contents.setFrameRate(240);
    contents.setAudioMuted(true);
    // WebRTC could reach out without a request the session sees
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    const page = new MotionPage(win, options, ses);
    const loadTimeout = options.loadTimeout ?? LOAD_TIMEOUT_MS;
    try {
      // CDP answers only once the window has loaded something
      await win.loadURL('about:blank');
      const cdp = contents.debugger;
      cdp.attach('1.3');
      await cdp.sendCommand('Page.enable');
      // one CSS pixel is one pixel of the frame, whatever the display's scale
      await cdp.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: height + 4, deviceScaleFactor: 1, mobile: false });
      await cdp.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(${motionRuntime.toString()})(${JSON.stringify(options.init)});` });
      await page.timed(win.loadURL(pageUrl(options.root, options.file)), loadTimeout, 'to load');
      await page.timed(contents.executeJavaScript('window.__cuttleReady()'), loadTimeout, 'to get ready');
    } catch (error) {
      const report = await page.report().catch(() => undefined);
      page.close();
      const errors = report?.errors.length ? `\n${report.errors.join('\n')}` : '';
      throw new Error(`${(error as Error).message}${errors}`, { cause: error });
    }
    return page;
  }

  private timed<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`the motion page took more than ${ms / 1000} s ${what}`)), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  /** The frame drawn last (-1 before the first). */
  get position(): number {
    return this.drawn;
  }

  /** Whether the latest paint shows draw `draw`: its marker pixel (BGRA), `scale` image pixels a CSS pixel. */
  private shows(draw: number): boolean {
    const image = this.latest;
    if (!image) return false;
    const { width, height } = image.getSize();
    const scale = width / this.options.init.width;
    const row = Math.floor((this.options.init.height + 1) * scale);
    if (row >= height || width < 2) return false;
    const bitmap = image.toBitmap();
    const at = (row * width + Math.floor(scale)) * 4;
    return bitmap[at + 2] === (draw & 255) && bitmap[at + 1] === ((draw >> 8) & 255) && bitmap[at] === 200;
  }

  /** Frame `n` of the page: its clock moves to n / fps seconds, and the paint that shows it comes back. */
  async frame(n: number): Promise<MotionFrame> {
    if (!Number.isInteger(n) || n < 0) throw new Error(`a motion frame is a whole number from 0, not ${n}`);
    if (n < this.drawn) throw new Error(`the motion page is past frame ${n} (it drew ${this.drawn}); open it again to go back`);
    if (n === this.drawn && this.last) return this.last;
    if (this.failure) throw new Error(this.failure);
    const { init } = this.options;
    const ms = this.options.frameTimeout ?? FRAME_TIMEOUT_MS;
    const script = `window.__cuttleDraw(${(n * 1000) / init.fps})`;
    const draw = await this.timed(this.win.webContents.executeJavaScript(script) as Promise<number>, ms, `to draw frame ${n}`);
    const deadline = Date.now() + ms;
    let asked = false;
    while (!this.shows(draw)) {
      if (this.failure) throw new Error(this.failure);
      if (Date.now() > deadline) throw new Error(`the motion page's frame ${n} was never painted`);
      const painted = new Promise<void>((done) => (this.waiting = done));
      if (!asked) this.win.webContents.invalidate();
      asked = true;
      await Promise.race([painted, pause(50)]);
      this.waiting = undefined;
    }
    let image = this.latest!;
    const { width } = image.getSize();
    if (width === init.width) image = image.crop({ x: 0, y: 0, width: init.width, height: init.height });
    else {
      // a display scale the override did not reach: the page drawn larger, brought back to its size
      const scale = width / init.width;
      image = image.crop({ x: 0, y: 0, width, height: Math.round(init.height * scale) }).resize({ width: init.width, height: init.height, quality: 'best' });
    }
    const frame = { width: init.width, height: init.height, data: toRgba(new Uint8Array(image.toBitmap())) };
    this.drawn = n;
    this.last = frame;
    return frame;
  }

  /** What went wrong in the page so far (uncaught errors and rejections), and its console. */
  async report(): Promise<MotionReport> {
    const errors = this.win.isDestroyed() ? [] : ((await this.win.webContents.executeJavaScript('window.__cuttleErrors ?? []').catch(() => [])) as string[]);
    return { errors: [...(this.failure ? [this.failure] : []), ...errors], console: [...this.logs] };
  }

  close(): void {
    if (this.win.isDestroyed()) return;
    this.win.destroy();
    giveBack(this.ses, this.options.root, this.options.network === true);
  }
}
```

`packages/export/src/main/motion-host.ts`:

```ts
import { relative, sep } from 'node:path';
import type { CuttleProject, MotionOverlay, MotionScene } from '@cuttle/project';
import { CHANNELS, type MotionFrameRequest, type MotionPages } from '../job';
import { motionInit } from '../motion/init';
import { MotionPage, type MotionFrame, type MotionPageOptions } from './motion';

/** What one motion item's page said while it rendered: its errors and its console, every showing together. */
export interface MotionItemReport {
  /** `scenes[2]` or `overlays[0]`. */
  item: string;
  /** The page, relative to the project folder (`/` between folders). */
  src: string;
  errors: string[];
  console: string[];
}

interface Showing {
  page: Promise<MotionPage>;
  /** The page's work, one call at a time. */
  queue: Promise<unknown>;
  /** The frame asked for last, and the next one drawn ahead of time. */
  asked: number;
  ahead?: { frame: number; promise: Promise<MotionFrame> };
  /** The frame handed out last (the same frame again needs no drawing). */
  last?: { frame: number; data: MotionFrame };
  name: string;
  duration: number;
}

/**
 * The main process's side of a job's motion: opens a page for each showing of an item the export
 * page asks for, draws its frames in order (drawing the next one ahead while the export works on
 * the current one), opens it again for a frame before one it drew, and closes it when the showing
 * is over. Collects what the pages said.
 */
export class MotionHost {
  private readonly showings = new Map<string, Showing>();
  private readonly reports = new Map<string, MotionItemReport>();

  constructor(
    private readonly project: CuttleProject,
    private readonly pages: MotionPages,
    private readonly options: Pick<MotionPageOptions, 'frameTimeout' | 'loadTimeout'> = {},
  ) {}

  private item(request: MotionFrameRequest): { item: MotionScene | MotionOverlay; name: string; file: string } {
    const name = `${request.kind === 'scene' ? 'scenes' : 'overlays'}[${request.index}]`;
    const item = request.kind === 'scene' ? this.project.scenes[request.index] : this.project.overlays[request.index];
    const file = (request.kind === 'scene' ? this.pages.scenes : this.pages.overlays)[request.index];
    if (!item || ('type' in item && item.type !== 'motion') || file === undefined) throw new Error(`${name} is not a motion item`);
    return { item: item as MotionScene | MotionOverlay, name, file };
  }

  private open(request: MotionFrameRequest): Showing {
    const { item, name, file } = this.item(request);
    const report = this.reports.get(name) ?? { item: name, src: relative(this.pages.root, file).split(sep).join('/'), errors: [], console: [] };
    this.reports.set(name, report);
    const page = MotionPage.open({
      file,
      root: this.pages.root,
      init: motionInit(this.project, item, name, request.duration),
      network: item.network,
      ...this.options,
    });
    page.catch(() => {}); // awaited by the frame that asked for it
    const showing: Showing = { page, queue: page, asked: -1, name, duration: request.duration };
    this.showings.set(request.key, showing);
    return showing;
  }

  /** `job` on the showing's page, after the work it already has. */
  private run<T>(showing: Showing, job: (page: MotionPage) => Promise<T>): Promise<T> {
    const result = showing.queue.catch(() => {}).then(() => showing.page).then(job);
    showing.queue = result.catch(() => {});
    return result;
  }

  /** The frame the request asks for, drawn by its showing's page. */
  async frame(request: MotionFrameRequest): Promise<MotionFrame> {
    let showing = this.showings.get(request.key);
    if (showing?.last?.frame === request.frame) return showing.last.data;
    if (showing && request.frame < Math.max(showing.asked, showing.ahead?.frame ?? -1)) {
      // an earlier frame than the page drew: it starts again
      await this.done(request.key);
      showing = undefined;
    }
    showing ??= this.open(request);
    try {
      const ahead = showing.ahead?.frame === request.frame ? showing.ahead.promise : undefined;
      showing.ahead = undefined;
      const sequential = request.frame === showing.asked + 1;
      showing.asked = request.frame;
      const frame = await (ahead ?? this.run(showing, (page) => page.frame(request.frame)));
      showing.last = { frame: request.frame, data: frame };
      // playing on: the next frame is drawn while the export uses this one
      const next = request.frame + 1;
      if (sequential && next / this.project.output.fps < showing.duration) {
        const promise = this.run(showing, (page) => page.frame(next));
        promise.catch(() => {}); // a failure shows when that frame is asked for
        showing.ahead = { frame: next, promise };
      }
      return frame;
    } catch (error) {
      throw new Error(`${showing.name} (${this.reports.get(showing.name)?.src}): ${(error as Error).message}`, { cause: error });
    }
  }

  /** The showing is over: its page closes, and what it said is kept. */
  async done(key: string): Promise<void> {
    const showing = this.showings.get(key);
    if (!showing) return;
    this.showings.delete(key);
    const page = await showing.queue.then(() => showing.page).catch(() => undefined);
    if (!page) return;
    const said = await page.report().catch(() => undefined);
    page.close();
    const report = this.reports.get(showing.name);
    if (!said || !report) return;
    for (const error of said.errors) if (!report.errors.includes(error)) report.errors.push(error);
    for (const line of said.console) if (!report.console.includes(line)) report.console.push(line);
  }

  /** Closes every page; what each item's page said, in the order they first showed. */
  async close(): Promise<MotionItemReport[]> {
    await Promise.all([...this.showings.keys()].map((key) => this.done(key)));
    return [...this.reports.values()];
  }
}

/** Answers the export page's motion requests (on its window's `ipc`) with `host`; `alive` keeps the watchdog quiet while pages work. */
export function serveMotion(ipc: Electron.IpcMain, host: MotionHost | undefined, alive: () => void): void {
  ipc.handle(CHANNELS.motionFrame, async (_event, request: MotionFrameRequest) => {
    if (!host) throw new Error('the job has no motion items');
    alive();
    const frame = await host.frame(request);
    alive();
    return frame;
  });
  ipc.on(CHANNELS.motionDone, (_event, key: string) => void host?.done(key));
}

/** One line for each error a page reported (`scenes[2] (motion/intro/index.html): TypeError: …`). */
export function motionWarnings(reports: readonly MotionItemReport[]): string[] {
  return reports.flatMap((report) => report.errors.map((error) => `${report.item} (${report.src}): ${error}`));
}
```

In `packages/export/src/main/sources.ts`, replace:

```ts
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseEventsJsonl, parseProjectJson, parseTakeJson, parseTranscriptJson, trackOffset, type CuttleProject, type InputEvent, type TakeFile, type TranscriptWord } from '@cuttle/project';
import { ExportError } from '../errors';

/** cuttle.json inside the project folder. */
export const PROJECT_FILE = 'cuttle.json';
```

with:

```ts
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseEventsJsonl, parseProjectJson, parseTakeJson, parseTranscriptJson, trackOffset, type CuttleProject, type InputEvent, type TakeFile, type TranscriptWord } from '@cuttle/project';
import { ExportError } from '../errors';
import type { MotionPages } from '../job';

/** cuttle.json inside the project folder. */
export const PROJECT_FILE = 'cuttle.json';
```

In the same file, replace:

```ts
  transcript?: TranscriptWord[];
  stills: Record<number, string>;
  backgroundImage?: string;
  /** Every file the project names (cuttle.json and take.json included): the output must not replace one. */
  inputs: string[];
  /** Things the export goes on without, but the user should know (e.g. a take.json that does not apply). */
```

with:

```ts
  transcript?: TranscriptWord[];
  stills: Record<number, string>;
  backgroundImage?: string;
  /** The motion items' pages, when the project has any. */
  motion?: MotionPages;
  /** Every file the project names (cuttle.json and take.json included): the output must not replace one. */
  inputs: string[];
  /** Things the export goes on without, but the user should know (e.g. a take.json that does not apply). */
```

In the same file, replace:

```ts
  return path;
}

async function readTake(screen: string): Promise<{ path: string; take?: TakeFile; warning?: string } | undefined> {
  const path = join(dirname(screen), TAKE_FILE);
  let text: string;
```

with:

```ts
  return path;
}

/**
 * The pages of the project's motion scenes and overlays, checked: each a file inside the project
 * folder (the only files a page may read). Undefined when the project has none.
 */
export async function motionPages(projectDir: string, project: CuttleProject): Promise<MotionPages | undefined> {
  const root = resolve(projectDir);
  const pages: MotionPages = { root, scenes: {}, overlays: {} };
  const page = async (src: string, name: string): Promise<string> => {
    const rel = relative(root, resolve(root, src));
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new ExportError('invalid-project', `${name}.src must be a file in the project folder, not ${src}`);
    }
    return existing(root, src, `page of ${name}`);
  };
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type === 'motion') pages.scenes[index] = await page(scene.src, `scenes[${index}]`);
  }
  for (const [index, overlay] of project.overlays.entries()) pages.overlays[index] = await page(overlay.src, `overlays[${index}]`);
  return Object.keys(pages.scenes).length + Object.keys(pages.overlays).length > 0 ? pages : undefined;
}

async function readTake(screen: string): Promise<{ path: string; take?: TakeFile; warning?: string } | undefined> {
  const path = join(dirname(screen), TAKE_FILE);
  let text: string;
```

In the same file, replace:

```ts
  if (look.background.preset === 'image' && look.background.image) {
    result.backgroundImage = await existing(projectDir, look.background.image, 'background image (look.background.image)');
  }
  return result;
}
```

with:

```ts
  if (look.background.preset === 'image' && look.background.image) {
    result.backgroundImage = await existing(projectDir, look.background.image, 'background image (look.background.image)');
  }
  const motion = await motionPages(projectDir, project);
  if (motion) {
    result.motion = motion;
    result.inputs.push(...Object.values(motion.scenes), ...Object.values(motion.overlays));
  }
  return result;
}
```

In `packages/export/src/main/export.ts`, replace:

```ts
import { CHANNELS, type EncoderPreference, type ExportJob, type PageResult, type PageStillsSuccess, type PageSuccess } from '../job';
import { checkFfmpeg, runFfmpeg } from './ffmpeg';
import { FileHost } from './files';
import { loadSources, samePath } from './sources';
import { writeTypingTrack } from './typing-track';
import { openExportWindow, type ExportWindow } from './window';
```

with:

```ts
import { CHANNELS, type EncoderPreference, type ExportJob, type PageResult, type PageStillsSuccess, type PageSuccess } from '../job';
import { checkFfmpeg, runFfmpeg } from './ffmpeg';
import { FileHost } from './files';
import { MotionHost, motionWarnings, serveMotion, type MotionItemReport } from './motion-host';
import { loadSources, samePath } from './sources';
import { writeTypingTrack } from './typing-track';
import { openExportWindow, type ExportWindow } from './window';
```

In the same file, replace:

```ts
  seconds: number;
  /** The subtitle files written next to it. */
  subtitles?: string[];
  stats: ExportStats;
}
```

with:

```ts
  seconds: number;
  /** The subtitle files written next to it. */
  subtitles?: string[];
  /** What the motion items' pages said (errors and console), when the project has any. */
  motion?: MotionItemReport[];
  stats: ExportStats;
}
```

In the same file, replace:

```ts
    ...(opts.captions !== undefined && { captions: opts.captions }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    encoder: opts.encoder ?? 'auto',
  };
  try {
```

with:

```ts
    ...(opts.captions !== undefined && { captions: opts.captions }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    ...(sources.motion && { motion: sources.motion }),
    encoder: opts.encoder ?? 'auto',
  };
  try {
```

In the same file, replace:

```ts
  let work: string | undefined;
  let files: FileHost | undefined;
  let window: ExportWindow | undefined;
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const video = join(work, 'video.mp4');
```

with:

```ts
  let work: string | undefined;
  let files: FileHost | undefined;
  let window: ExportWindow | undefined;
  const motion = sources.motion ? new MotionHost(project, sources.motion) : undefined;
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const video = join(work, 'video.mp4');
```

In the same file, replace:

```ts
      guard.progress(done);
      opts.onProgress?.(done, total);
    });

    const page = await runPage<PageSuccess>(window, guard.stalled, cancel.promise);
    guard.stop();
    // The window stays open until the end: closing an app's last window quits it by default.
    await host.close(); // flushes the video-only MP4 before ffmpeg reads it
```

with:

```ts
      guard.progress(done);
      opts.onProgress?.(done, total);
    });
    serveMotion(ipc, motion, guard.alive);

    const page = await runPage<PageSuccess>(window, guard.stalled, cancel.promise);
    guard.stop();
    const said = await motion?.close();
    for (const warning of motionWarnings(said ?? [])) console.warn(`warning: ${warning}`);
    // The window stays open until the end: closing an app's last window quits it by default.
    await host.close(); // flushes the video-only MP4 before ffmpeg reads it
```

In the same file, replace:

```ts
      frames: page.frames,
      seconds,
      ...(written.length > 0 && { subtitles: written }),
      stats: {
        gpu: page.gpu,
        codec: page.codec,
```

with:

```ts
      frames: page.frames,
      seconds,
      ...(written.length > 0 && { subtitles: written }),
      ...(said && { motion: said }),
      stats: {
        gpu: page.gpu,
        codec: page.codec,
```

In the same file, replace:

```ts
  } finally {
    guard.stop();
    cancel.dispose();
    if (window && !window.win.isDestroyed()) window.win.destroy();
    await files?.close();
    if (work) {
```

with:

```ts
  } finally {
    guard.stop();
    cancel.dispose();
    await motion?.close().catch(() => {});
    if (window && !window.win.isDestroyed()) window.win.destroy();
    await files?.close();
    if (work) {
```

In `packages/export/src/main/stills.ts`, replace:

```ts
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import { ExportError } from '../errors';
import { withFormat, type ExportFormat } from '../formats';
import { CHANNELS, type PageStillsSuccess, type StillsJob } from '../job';
import { cancelledError, defaultPageDir, runPage, watchdog, whenCancelled } from './export';
import { FileHost } from './files';
import { loadSources } from './sources';
import { openExportWindow, type ExportWindow } from './window';

export interface StillsOptions {
```

with:

```ts
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CuttleProject } from '@cuttle/project';
import { app } from 'electron';
import { ExportError } from '../errors';
import { withFormat, type ExportFormat } from '../formats';
import { CHANNELS, type PageStillsSuccess, type StillsJob } from '../job';
import { cancelledError, defaultPageDir, runPage, watchdog, whenCancelled } from './export';
import { FileHost } from './files';
import { MotionHost, serveMotion, type MotionItemReport } from './motion-host';
import { loadSources, motionPages } from './sources';
import { openExportWindow, type ExportWindow } from './window';

export interface StillsOptions {
```

In the same file, replace:

```ts
  pageDir?: string;
  /** Cancels: the window closes and `renderStills` rejects with `cancelled`. */
  signal?: AbortSignal;
}

export interface StillsResult {
```

with:

```ts
  pageDir?: string;
  /** Cancels: the window closes and `renderStills` rejects with `cancelled`. */
  signal?: AbortSignal;
  /** Renders another version of the project (its folder's files): `cuttle motion check` shows one page as a scene. */
  project?: (project: CuttleProject) => CuttleProject;
}

export interface StillsResult {
```

In the same file, replace:

```ts
  /** The output size (each still's size). */
  width: number;
  height: number;
  stats: { gpu: string; totalMs: number };
}
```

with:

```ts
  /** The output size (each still's size). */
  width: number;
  height: number;
  /** What the motion items' pages said (errors and console), when the project has any. */
  motion?: MotionItemReport[];
  stats: { gpu: string; totalMs: number };
}
```

In the same file, replace:

```ts
  const sources = await loadSources(resolve(opts.projectDir));
  for (const warning of sources.warnings) console.warn(`warning: ${warning}`);
  if (opts.signal?.aborted) throw cancelledError();
  const project = withFormat(sources.project, opts.format);
  const columns = opts.sheet ? Math.max(1, Math.round(opts.sheet.columns ?? DEFAULT_SHEET_COLUMNS)) : undefined;
  const job: StillsJob = {
    kind: 'stills',
```

with:

```ts
  const sources = await loadSources(resolve(opts.projectDir));
  for (const warning of sources.warnings) console.warn(`warning: ${warning}`);
  if (opts.signal?.aborted) throw cancelledError();
  const project = withFormat(opts.project ? opts.project(sources.project) : sources.project, opts.format);
  const motionFiles = opts.project ? await motionPages(resolve(opts.projectDir), project) : sources.motion;
  const columns = opts.sheet ? Math.max(1, Math.round(opts.sheet.columns ?? DEFAULT_SHEET_COLUMNS)) : undefined;
  const job: StillsJob = {
    kind: 'stills',
```

In the same file, replace:

```ts
    ...(sources.transcript && { transcript: sources.transcript }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    times: opts.times,
    ...(columns !== undefined && { sheet: { columns } }),
  };
```

with:

```ts
    ...(sources.transcript && { transcript: sources.transcript }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    ...(motionFiles && { motion: motionFiles }),
    times: opts.times,
    ...(columns !== undefined && { sheet: { columns } }),
  };
```

In the same file, replace:

```ts
  // Reads only: stills mode writes PNGs through writeStill, never into a video file.
  const host = new FileHost([sources.screen, ...(sources.webcam ? [sources.webcam.path] : [])], join(outDir, '.unused'), images);
  let window: ExportWindow | undefined;
  try {
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    const ipc = window.win.webContents.ipc;
```

with:

```ts
  // Reads only: stills mode writes PNGs through writeStill, never into a video file.
  const host = new FileHost([sources.screen, ...(sources.webcam ? [sources.webcam.path] : [])], join(outDir, '.unused'), images);
  let window: ExportWindow | undefined;
  const motion = motionFiles ? new MotionHost(project, motionFiles) : undefined;
  try {
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    const ipc = window.win.webContents.ipc;
```

In the same file, replace:

```ts
      guard.progress(done);
      opts.onProgress?.(done, total);
    });
    const page = await runPage<PageStillsSuccess>(window, guard.stalled, cancel.promise);
    if (opts.signal?.aborted) throw cancelledError();
    await publish(work, outDir, [...names.values()], opts.clean ?? false);
    return {
      stills: opts.times.map((t, n) => {
```

with:

```ts
      guard.progress(done);
      opts.onProgress?.(done, total);
    });
    serveMotion(ipc, motion, guard.alive);
    const page = await runPage<PageStillsSuccess>(window, guard.stalled, cancel.promise);
    if (opts.signal?.aborted) throw cancelledError();
    const said = await motion?.close();
    await publish(work, outDir, [...names.values()], opts.clean ?? false);
    return {
      stills: opts.times.map((t, n) => {
```

In the same file, replace:

```ts
      ...(columns !== undefined && { sheet: join(outDir, SHEET_NAME) }),
      width: page.width,
      height: page.height,
      stats: { gpu: page.gpu, totalMs: Math.round(performance.now() - started) },
    };
  } catch (error) {
```

with:

```ts
      ...(columns !== undefined && { sheet: join(outDir, SHEET_NAME) }),
      width: page.width,
      height: page.height,
      ...(said && { motion: said }),
      stats: { gpu: page.gpu, totalMs: Math.round(performance.now() - started) },
    };
  } catch (error) {
```

In the same file, replace:

```ts
  } finally {
    guard.stop();
    cancel.dispose();
    if (window && !window.win.isDestroyed()) window.win.destroy();
    await host.close();
    // A folder that cannot be removed now must not replace the result or the real error.
```

with:

```ts
  } finally {
    guard.stop();
    cancel.dispose();
    await motion?.close().catch(() => {});
    if (window && !window.win.isDestroyed()) window.win.destroy();
    await host.close();
    // A folder that cannot be removed now must not replace the result or the real error.
```

In `packages/export/src/index.ts`, replace:

```ts
export { EXPORT_FORMATS, isExportFormat, type ExportFormat } from './formats';
export type { EncoderPreference, ExportErrorCode } from './job';
export { renderStills, stillName, type StillsOptions, type StillsResult } from './main/stills';
```

with:

```ts
export { EXPORT_FORMATS, isExportFormat, type ExportFormat } from './formats';
export type { EncoderPreference, ExportErrorCode } from './job';
export { renderStills, stillName, type StillsOptions, type StillsResult } from './main/stills';
export { MOTION_SCHEME_PRIVILEGES } from './main/motion';
export type { MotionItemReport } from './main/motion-host';
```

The export check registers the scheme before the app is ready:

In `packages/export/electron/check.ts`, replace:

```ts
import { promisify } from 'node:util';
import { parseProjectJson } from '@cuttle/project';
import { sceneSpans, totalDuration } from '@cuttle/timeline';
import { BrowserWindow, app } from 'electron';
import { frameCount } from '../src/frame-plan';
import { EXPORT_FORMATS, exportProject, isExportFormat, type EncoderPreference, type ExportError, type ExportErrorCode, type ExportFormat } from '../src/index';
import { createFixtureProject, type FixtureLayout } from '../test/fixture';

const run = promisify(execFile);
```

with:

```ts
import { promisify } from 'node:util';
import { parseProjectJson } from '@cuttle/project';
import { sceneSpans, totalDuration } from '@cuttle/timeline';
import { BrowserWindow, app, protocol } from 'electron';
import { frameCount } from '../src/frame-plan';
import { EXPORT_FORMATS, MOTION_SCHEME_PRIVILEGES, exportProject, isExportFormat, type EncoderPreference, type ExportError, type ExportErrorCode, type ExportFormat } from '../src/index';
import { createFixtureProject, type FixtureLayout } from '../test/fixture';

const run = promisify(execFile);
```

In the same file, replace:

```ts
  app.exit(1);
});
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let ok = false;
  try {
```

with:

```ts
  app.exit(1);
});
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([MOTION_SCHEME_PRIVILEGES]);
app.whenReady().then(async () => {
  let ok = false;
  try {
```

- [ ] **Step 4: The export page asks for the frames**

In `packages/export/src/page/scene-sources.ts`, replace:

```ts
import type { FrameSources } from '@cuttle/engine';
import type { RenderState } from '@cuttle/timeline';
import type { FramePlan, ScenePlan } from '../frame-plan';
import { PageError } from './host';
import { loadImage } from './images';
import type { VideoFile } from './media';
import { TrackReader } from './track-reader';
```

with:

```ts
import type { FrameSources } from '@cuttle/engine';
import type { Scene } from '@cuttle/project';
import type { RenderState } from '@cuttle/timeline';
import type { FramePlan, OverlayPlan, ScenePlan } from '../frame-plan';
import type { MotionFrameRequest, MotionPixels } from '../job';
import { host, PageError } from './host';
import { loadImage } from './images';
import type { VideoFile } from './media';
import { TrackReader } from './track-reader';
```

In the same file, replace:

```ts
  webcam?: VideoFile & { offset: number };
  /** Scene index → image path of a still scene. */
  stills: Readonly<Record<number, string>>;
  maxTextureSize: number;
}
```

with:

```ts
  webcam?: VideoFile & { offset: number };
  /** Scene index → image path of a still scene. */
  stills: Readonly<Record<number, string>>;
  /** The project's scenes (a motion scene's duration). */
  scenes: readonly Scene[];
  maxTextureSize: number;
}
```

In the same file, replace:

```ts
  screen?: TrackReader;
  webcam?: TrackReader;
  still?: Promise<ImageBitmap>;
}

/**
```

with:

```ts
  screen?: TrackReader;
  webcam?: TrackReader;
  still?: Promise<ImageBitmap>;
  motion?: MotionSource;
}

/** The message of an error the main process threw, without Electron's "Error invoking remote method …" in front. */
const remoteMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');

/** One showing of a motion item: its frames, drawn by the main process; the first one is asked for as it opens. */
class MotionSource {
  private first: Promise<MotionPixels> | undefined;

  constructor(private readonly request: Omit<MotionFrameRequest, 'frame'>) {
    this.first = this.ask(0);
    this.first.catch(() => {}); // awaited when the item shows
  }

  private ask(frame: number): Promise<MotionPixels> {
    return host()
      .motionFrame({ ...this.request, frame })
      .catch((error: unknown) => {
        throw new PageError('render', remoteMessage(error));
      });
  }

  /** Frame `n` of the showing (n / fps seconds into it). */
  frame(n: number): Promise<MotionPixels> {
    const first = n === 0 ? this.first : undefined;
    this.first = undefined;
    return first ?? this.ask(n);
  }

  done(): void {
    host().motionDone(this.request.key);
  }
}

/**
```

In the same file, replace:

```ts
export class SceneSources {
  private readonly open = new Map<number, OpenScene>();
  private readonly pending: ScenePlan[];
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };

  constructor(
    plan: FramePlan,
```

with:

```ts
export class SceneSources {
  private readonly open = new Map<number, OpenScene>();
  private readonly pending: ScenePlan[];
  /** Motion overlays' showings, by `ActiveOverlay.key`. */
  private readonly overlays = new Map<string, { plan: OverlayPlan; source: MotionSource }>();
  private readonly pendingOverlays: OverlayPlan[];
  private readonly fps: number;
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };

  constructor(
    plan: FramePlan,
```

In the same file, replace:

```ts
    private readonly lookahead: number,
  ) {
    this.pending = [...plan.scenes];
  }

  private screenTime(sourceTime: number): number {
```

with:

```ts
    private readonly lookahead: number,
  ) {
    this.pending = [...plan.scenes];
    this.pendingOverlays = [...plan.overlays].sort((a, b) => a.firstFrame - b.firstFrame);
    this.fps = plan.fps;
  }

  private screenTime(sourceTime: number): number {
```

In the same file, replace:

```ts
      still.catch(() => {}); // awaited when the scene shows; avoid an unhandled rejection before that
      return { plan, still };
    }
    return { plan };
  }
```

with:

```ts
      still.catch(() => {}); // awaited when the scene shows; avoid an unhandled rejection before that
      return { plan, still };
    }
    if (plan.kind === 'motion') {
      const scene = this.media.scenes[plan.index];
      const duration = scene?.type === 'motion' ? scene.duration : 0;
      return { plan, motion: new MotionSource({ key: `scene:${plan.index}`, kind: 'scene', index: plan.index, duration }) };
    }
    return { plan };
  }
```

In the same file, replace:

```ts
      const plan = this.pending.shift()!;
      this.open.set(plan.index, this.openScene(plan));
    }
    const { screens, webcams, stills } = this.sources;
    screens.clear();
    webcams.clear();
    stills.clear();
    for (const layer of state.layers) {
      // decoders are opened per scene (`plan.index`), frames are handed over per layer
      const scene = this.open.get(layer.sceneIndex);
```

with:

```ts
      const plan = this.pending.shift()!;
      this.open.set(plan.index, this.openScene(plan));
    }
    while (this.pendingOverlays.length > 0 && this.pendingOverlays[0]!.firstFrame <= frame + this.lookahead) {
      const plan = this.pendingOverlays.shift()!;
      const source = new MotionSource({ key: `overlay:${plan.key}`, kind: 'overlay', index: plan.index, duration: plan.duration });
      this.overlays.set(plan.key, { plan, source });
    }
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

In the same file, replace:

```ts
        if (webcamFrame) webcams.set(layer.index, webcamFrame);
      } else if (scene.still) {
        stills.set(layer.index, await scene.still);
      }
    }
    return this.sources;
```

with:

```ts
        if (webcamFrame) webcams.set(layer.index, webcamFrame);
      } else if (scene.still) {
        stills.set(layer.index, await scene.still);
      } else if (scene.motion) {
        motion.set(layer.index, await scene.motion.frame(Math.round(layer.local * this.fps)));
      }
      for (const overlay of layer.overlays) {
        const open = this.overlays.get(overlay.key);
        if (!open) throw new Error(`overlays[${overlay.index}] shows on frame ${frame}, outside its planned frames`);
        overlays.set(overlay.key, await open.source.frame(Math.round(overlay.local * this.fps)));
      }
    }
    return this.sources;
```

In the same file, replace:

```ts
      this.open.delete(index);
      await closeScene(scene);
    }
  }

  async close(): Promise<void> {
    const scenes = [...this.open.values()];
    this.open.clear();
    await Promise.allSettled(scenes.map(closeScene));
  }
}
```

with:

```ts
      this.open.delete(index);
      await closeScene(scene);
    }
    for (const [key, overlay] of this.overlays) {
      if (overlay.plan.lastFrame > frame) continue;
      this.overlays.delete(key);
      overlay.source.done();
    }
  }

  async close(): Promise<void> {
    const scenes = [...this.open.values()];
    this.open.clear();
    for (const overlay of this.overlays.values()) overlay.source.done();
    this.overlays.clear();
    await Promise.allSettled(scenes.map(closeScene));
  }
}
```

In the same file, replace:

```ts
  await scene.screen?.close();
  await scene.webcam?.close();
  if (scene.still) (await scene.still.catch(() => undefined))?.close();
}
```

with:

```ts
  await scene.screen?.close();
  await scene.webcam?.close();
  if (scene.still) (await scene.still.catch(() => undefined))?.close();
  scene.motion?.done();
}
```

In `packages/export/src/page/run.ts`, replace:

```ts
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    sources = new SceneSources(
      plan,
      { screen, webcam: webcam && job.webcam ? { ...webcam, offset: job.webcam.offset } : undefined, stills: job.stills, maxTextureSize },
      lookahead,
    );
    return await body({ timeline, plan, renderer, canvas, gl, sources });
```

with:

```ts
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    sources = new SceneSources(
      plan,
      { screen, webcam: webcam && job.webcam ? { ...webcam, offset: job.webcam.offset } : undefined, stills: job.stills, scenes: project.scenes, maxTextureSize },
      lookahead,
    );
    return await body({ timeline, plan, renderer, canvas, gl, sources });
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node packages/export`
Expected: PASS.

The pages render in Electron only: Task 6's check renders them through the CLI.

- [ ] **Step 6: Commit**

```bash
git add packages/export
git commit -m "export: motion pages rendered frame by frame in sandboxed offscreen windows, their frames served to the export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `cuttle motion check`

**Files:**
- Create: `apps/cli/src/commands/motion.ts`, `apps/cli/test/motion-page.html`
- Modify: `apps/cli/src/main.ts`, `apps/cli/src/commands/preview.ts`, `apps/cli/src/electron/{main,protocol}.ts`, `apps/cli/test/electron.check.test.ts`

- [ ] **Step 1: The check's page, and the checks**

`apps/cli/test/motion-page.html`:

```html
<!doctype html>
<!--
  The motion check's page: every way a page moves, each at a place the check can predict.
  - CSS: a 100 px square slides 400 px right over 2 s (accent colour, from the theme).
  - Web Animations: a 100 px square slides 400 px right over 2 s.
  - requestAnimationFrame: a 100 px square on a canvas moves 200 px a second.
  - Timers: a bar grows 40 px every 250 ms.
  - Transparency: a white panel at half opacity; the rest of the page is clear.
  - Math.random (seeded): a row of dots; the same in every render.
-->
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        background: transparent;
        overflow: hidden;
      }
      .box {
        position: absolute;
        width: 100px;
        height: 100px;
      }
      #css {
        left: 40px;
        top: 40px;
        background: var(--cuttle-accent);
        animation: slide 2s linear forwards;
      }
      @keyframes slide {
        from {
          transform: translateX(0);
        }
        to {
          transform: translateX(400px);
        }
      }
      #waapi {
        left: 40px;
        top: 180px;
        background: #3cc6c9;
      }
      #bar {
        position: absolute;
        left: 40px;
        top: 460px;
        height: 40px;
        width: 0;
        background: #ffffff;
      }
      #panel {
        position: absolute;
        right: 40px;
        bottom: 40px;
        width: 300px;
        height: 200px;
        background: rgba(255, 255, 255, 0.5);
      }
      canvas {
        position: absolute;
        left: 0;
        top: 0;
      }
    </style>
  </head>
  <body>
    <div id="css" class="box"></div>
    <div id="waapi" class="box"></div>
    <div id="bar"></div>
    <div id="panel"></div>
    <canvas id="canvas"></canvas>
    <script>
      const { width, height } = cuttle.size;
      document.getElementById('waapi').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(400px)' }], { duration: 2000, fill: 'forwards' });
      let grown = 0;
      setInterval(() => (document.getElementById('bar').style.width = `${(grown += 40)}px`), 250);
      const canvas = document.getElementById('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      const dots = Array.from({ length: 12 }, () => Math.random());
      function draw(now) {
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#f2b34a';
        context.fillRect(40 + (now / 1000) * 200, 320, 100, 100);
        context.fillStyle = '#a78bfa';
        dots.forEach((dot, i) => context.fillRect(600 + i * 30, 40 + dot * 200, 20, 20));
        requestAnimationFrame(draw);
      }
      requestAnimationFrame(draw);
      cuttle.onFrame((t) => (document.body.dataset.t = t.toFixed(3)));
    </script>
  </body>
</html>
```

In `apps/cli/test/electron.check.test.ts`, replace:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
```

with:

```ts
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
```

In the same file, replace:

```ts
 * CLI. Runs only with `pnpm cli:check` (vitest --mode cli, after cli:build).
 */
const CLI = fileURLToPath(new URL('../dist/cuttle.mjs', import.meta.url));
const enabled = process.env.MODE === 'cli';

function cuttle(...argv: string[]): { code: number; json: Record<string, unknown> } {
```

with:

```ts
 * CLI. Runs only with `pnpm cli:check` (vitest --mode cli, after cli:build).
 */
const CLI = fileURLToPath(new URL('../dist/cuttle.mjs', import.meta.url));
/** The motion check's page: CSS, Web Animations, requestAnimationFrame, timers, transparency and a seeded random. */
const MOTION_PAGE = fileURLToPath(new URL('./motion-page.html', import.meta.url));
const enabled = process.env.MODE === 'cli';

function cuttle(...argv: string[]): { code: number; json: Record<string, unknown> } {
```

In the same file, replace:

```ts
    }
  }, 240_000);

  it('fails on an unknown format before rendering, and on a page that does not exist', () => {
    expect(cuttle('-C', project, 'render', '--format', '4:3').code).toBe(1);
    expect(cuttle('-C', project, 'capture-page', join(project, 'missing.html')).code).toBe(1);
```

with:

```ts
    }
  }, 240_000);

  it('checks a motion page: each way it moves lands on the frame, the same on every run, and it says nothing', () => {
    mkdirSync(join(project, 'motion', 'check'), { recursive: true });
    copyFileSync(MOTION_PAGE, join(project, 'motion', 'check', 'index.html'));
    const first = cuttle('-C', project, 'motion', 'check', 'motion/check/index.html');
    expect(first.code).toBe(0);
    expect(first.json).toMatchObject({ src: 'motion/check/index.html', duration: 3, width: 1920, height: 1080, errors: [], console: [] });
    const stills = first.json.stills as { t: number; file: string }[];
    expect(stills.map((still) => still.t)).toEqual([0, 0.424, 0.848, 1.271, 1.695, 2.119, 2.543, 2.967]);
    for (const still of stills) {
      const png = PNG.sync.read(readFileSync(still.file));
      // the first pixel of a row in a colour, and how many follow it
      const run = (y: number, rgb: number[]): [number, number] => {
        let start = -1;
        let length = 0;
        for (let x = 0; x < 1200; x++) {
          const i = (y * png.width + x) * 4;
          if (rgb.every((value, c) => Math.abs(png.data[i + c]! - value) <= 2)) {
            if (start < 0) start = x;
            length++;
          }
        }
        return [start, length];
      };
      const t = Math.floor(still.t * 30 + 1e-6) / 30; // the frame the still shows
      const slid = 40 + Math.min(t / 2, 1) * 400;
      expect(Math.abs(run(90, [0xd9, 0x77, 0x57])[0] - slid), `CSS at ${t}`).toBeLessThanOrEqual(1);
      expect(Math.abs(run(230, [0x3c, 0xc6, 0xc9])[0] - slid), `Web Animation at ${t}`).toBeLessThanOrEqual(1);
      expect(Math.abs(run(370, [0xf2, 0xb3, 0x4a])[0] - (40 + t * 200)), `animation frame at ${t}`).toBeLessThanOrEqual(1);
      expect(run(480, [255, 255, 255])[1], `timer at ${t}`).toBe(Math.floor(t / 0.25 + 1e-9) * 40);
    }
    const again = cuttle('-C', project, 'motion', 'check', 'motion/check/index.html', '-o', join(project, 'again'));
    expect(again.code).toBe(0);
    for (const still of stills) expect(readFileSync(join(project, 'again', basename(still.file))).equals(readFileSync(still.file))).toBe(true);
    // 9:16 is taller than the screen: the page is the whole 1080×1920 still
    const tall = cuttle('-C', project, 'motion', 'check', 'motion/check/index.html', '--format', '9:16', '--at', '2.5', '-o', join(project, 'tall'));
    expect(tall.code).toBe(0);
    expect(tall.json).toMatchObject({ width: 1080, height: 1920, errors: [] });
    const portrait = PNG.sync.read(readFileSync((tall.json.stills as { file: string }[])[0]!.file));
    const at = (x: number, y: number) => [...portrait.data.subarray((y * 1080 + x) * 4, (y * 1080 + x) * 4 + 3)];
    // near the bottom right corner the panel is white at half opacity over the background beside it
    const beside = at(1060, 1860);
    at(1000, 1860).forEach((value, i) => expect(Math.abs(value - (255 + beside[i]!) / 2)).toBeLessThanOrEqual(6));
    expect(at(490, 90)).toEqual([0xd9, 0x77, 0x57]);
  }, 120_000);

  it('tells what a motion page threw, and keeps it off the network and inside the project', () => {
    mkdirSync(join(project, 'motion', 'bad'), { recursive: true });
    const secret = join(dirname(project), `${basename(project)}-secret.txt`);
    writeFileSync(secret, 'outside the project');
    writeFileSync(
      join(project, 'motion', 'bad', 'index.html'),
      `<!doctype html><script>
      document.addEventListener('securitypolicyviolation', (event) => console.log('refused ' + event.blockedURI));
      cuttle.ready(Promise.allSettled([
        fetch('https://127.0.0.1:9/').then(() => console.log('reached the network'), () => console.log('no network')),
        fetch('../../cuttle.json').then((response) => console.log('own file ' + response.status)),
        fetch('cuttle-motion://project/..%2F${basename(project)}-secret.txt').then((response) => console.log('outside ' + response.status)),
      ]));
      cuttle.onFrame((t) => { if (t > 0.5) throw new TypeError('late'); });
      throw new Error('boom');
      </script>`,
    );
    try {
      const { code, json } = cuttle('-C', project, 'motion', 'check', 'motion/bad/index.html', '--duration', '1');
      expect(code).toBe(0);
      expect(json.errors).toEqual(['Error: boom', 'TypeError: late']);
      const said = (json.console as string[]).join('\n');
      for (const line of ['refused https://127.0.0.1:9/', 'no network', 'own file 200', 'outside 404']) expect(said).toContain(`info: ${line}`);
      expect(said).not.toContain('reached the network');
      expect(said).not.toContain('Electron Security Warning');
      // a page outside the project is refused before anything renders
      expect(cuttle('-C', project, 'motion', 'check', secret).code).toBe(1);
    } finally {
      rmSync(secret, { force: true });
    }
  }, 120_000);

  it('renders a motion scene and a motion overlay into the video, as the preview shows them', () => {
    const file = join(project, 'cuttle.json');
    const before = readFileSync(file, 'utf8');
    const raw = JSON.parse(before) as { scenes: unknown[] };
    mkdirSync(join(project, 'motion', 'bar'), { recursive: true });
    // a green bar across the bottom fifth, fading in over the overlay's first second
    writeFileSync(
      join(project, 'motion', 'bar', 'index.html'),
      '<!doctype html><body style="margin:0"><div id="bar" style="position:absolute;left:0;right:0;bottom:0;height:20%;background:#00ff00"></div><script>cuttle.onFrame((t) => (bar.style.opacity = String(Math.min(1, t))))</script></body>',
    );
    writeFileSync(
      file,
      JSON.stringify({
        ...raw,
        scenes: [{ id: 's90', type: 'motion', src: 'motion/check/index.html', duration: 1.5 }, ...raw.scenes],
        overlays: [{ id: 'o1', src: 'motion/bar/index.html', at: 0.5, duration: 2 }],
      }),
    );
    try {
      const out = join(project, 'out', 'motion.mp4');
      const { code, json } = cuttle('-C', project, 'render', '-o', out);
      expect(code).toBe(0);
      expect(json.motion).toEqual([
        { item: 'scenes[0]', src: 'motion/check/index.html', errors: [], console: [] },
        { item: 'overlays[0]', src: 'motion/bar/index.html', errors: [], console: [] },
      ]);
      // the video's frames: 0.5 s into the motion scene (its CSS square at x 140), and the clip 1.5 s
      // into the overlay (output 1.5 + 2 = 3.5 s), where its bar is fully in
      const frame = (seconds: number) => {
        const png = join(project, 'out', `frame-${seconds}.png`);
        spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(seconds), '-i', out, '-frames:v', '1', png]);
        return PNG.sync.read(readFileSync(png));
      };
      const rgb = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
      const close = (actual: number[], expected: number[]) => actual.every((value, i) => Math.abs(value - expected[i]!) <= 24);
      expect(close(rgb(frame(0.5), 190, 90), [0xd9, 0x77, 0x57])).toBe(true);
      const late = frame(3.5);
      expect(close(rgb(late, 960, 1040), [0, 255, 0])).toBe(true);
      expect(close(rgb(late, 960, 700), [0, 255, 0])).toBe(false);
      // the preview shows the same
      const still = cuttle('-C', project, 'preview', '--at', '3.5', '-o', join(project, 'motion-still'));
      const shown = PNG.sync.read(readFileSync((still.json.stills as { file: string }[])[0]!.file));
      expect(rgb(shown, 960, 1040)).toEqual([0, 255, 0]);
    } finally {
      writeFileSync(file, before);
    }
  }, 180_000);

  it('fails on an unknown format before rendering, and on a page that does not exist', () => {
    expect(cuttle('-C', project, 'render', '--format', '4:3').code).toBe(1);
    expect(cuttle('-C', project, 'capture-page', join(project, 'missing.html')).code).toBe(1);
```

- [ ] **Step 2: The command**

`apps/cli/src/commands/motion.ts`:

```ts
import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readProjectFile } from '@cuttle/core';
import type { MotionScene } from '@cuttle/project';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { MotionCheck } from '../electron/protocol';
import type { Output } from '../output';
import type { PreviewResult } from './preview';

export interface MotionCheckArgs {
  /** Seconds the item lasts (default: as in cuttle.json, else 3). */
  duration?: number;
  /** Seconds into the item (default: `CHECK_FRAMES` from its start to its end, with a sheet). */
  at?: number[];
  format?: string;
  /** Folder for the PNGs (default: preview/motion-<name>/ in the project). */
  out?: string;
}

export interface MotionCheckResult extends Omit<PreviewResult, 'motion'> {
  /** The page, relative to the project folder. */
  src: string;
  duration: number;
  /** The page's uncaught errors and rejections, and its console. */
  errors: string[];
  console: string[];
}

/** Frames of a default check. */
export const CHECK_FRAMES = 8;
const DEFAULT_SECONDS = 3;

const isInside = (dir: string, path: string): boolean => {
  const rel = relative(dir, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** The page as cuttle.json names it: `src` from the project folder, or from here when that is where it is. */
async function pageOf(dir: string, src: string): Promise<string> {
  const candidates = [resolve(dir, src), resolve(src)];
  for (const path of candidates) {
    if (!isInside(dir, path)) continue;
    if (await stat(path).then((info) => info.isFile(), () => false)) return relative(dir, path).split(sep).join('/');
  }
  if (!candidates.some((path) => isInside(dir, path))) throw new CliError('usage', `${src} is not in the project folder ${dir}: a page may only read the project's files`);
  throw new CliError('missing-file', `no page at ${src} in ${dir}`);
}

/**
 * `cuttle motion check <src>`: the page rendered as a scene of its own, frame by frame as the export
 * draws it, into PNGs and a contact sheet, with what it logged and threw. Its params and switches
 * come from the item in cuttle.json that shows it, when there is one.
 */
export async function motionCheckCommand(projectDir: string, src: string, args: MotionCheckArgs, output: Output, signal: AbortSignal): Promise<MotionCheckResult> {
  const file = await readProjectFile(projectDir);
  const page = await pageOf(file.dir, src);
  const { project } = file;
  const same = (candidate: string) => resolve(file.dir, candidate) === resolve(file.dir, page);
  const scene = project.scenes.find((candidate): candidate is MotionScene => candidate.type === 'motion' && same(candidate.src));
  const item = scene ?? project.overlays.find((overlay) => same(overlay.src));
  const duration = args.duration ?? item?.duration ?? DEFAULT_SECONDS;
  const last = Math.max(0, duration - 1 / project.output.fps);
  const times = args.at && args.at.length > 0 ? args.at : Array.from({ length: CHECK_FRAMES }, (_, i) => Math.round((i * last * 1000) / (CHECK_FRAMES - 1)) / 1000);
  const late = times.find((t) => t >= duration);
  if (late !== undefined) throw new CliError('usage', `--at ${late} is past the item's end (${duration} s)`);
  const name = page.replace(/\/index\.html?$/i, '').replace(/\.html?$/i, '').split('/').at(-1) || 'page';
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview', `motion-${name}`);
  const motion: MotionCheck = {
    src: page,
    duration,
    params: item?.params ?? {},
    network: item?.network ?? false,
  };
  output.info(`rendering ${times.length} frame(s) of ${page} into ${outDir} …`);
  const result = await runInElectron<PreviewResult>(
    {
      command: 'preview',
      projectDir: file.dir,
      outDir,
      times,
      quiet: output.json,
      clean: args.out === undefined,
      motion,
      ...(args.format !== undefined && { format: args.format }),
      sheet: {},
    },
    signal,
  );
  const said = result.motion?.[0];
  const { motion: _reports, ...rest } = result;
  const checked: MotionCheckResult = { ...rest, src: page, duration, errors: said?.errors ?? [], console: said?.console ?? [] };
  output.result(checked, () =>
    [
      `${page}: ${duration} s, ${checked.width}×${checked.height}`,
      ...checked.stills.map((still) => `${still.t.toFixed(2)} s  ${still.file}`),
      ...(checked.sheet ? [`sheet  ${checked.sheet}`] : []),
      checked.errors.length > 0 ? `errors:\n${checked.errors.map((line) => `  ${line}`).join('\n')}` : 'no errors',
      ...(checked.console.length > 0 ? [`console:\n${checked.console.map((line) => `  ${line}`).join('\n')}`] : []),
    ].join('\n'),
  );
  return checked;
}
```

In `apps/cli/src/commands/preview.ts`, replace:

```ts
import { join, resolve } from 'node:path';
import { sceneSpans, totalDuration } from '@cuttle/timeline';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
```

with:

```ts
import { join, resolve } from 'node:path';
import type { MotionItemReport } from '@cuttle/export';
import { sceneSpans, totalDuration } from '@cuttle/timeline';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
```

In the same file, replace:

```ts
  sheet?: string;
  width: number;
  height: number;
  stats: { gpu: string; totalMs: number };
}
```

with:

```ts
  sheet?: string;
  width: number;
  height: number;
  /** What the motion items' pages said (errors and console), when the project has any. */
  motion?: MotionItemReport[];
  stats: { gpu: string; totalMs: number };
}
```

In the same file, replace:

```ts
    [
      ...result.stills.map((still) => `${still.t.toFixed(2)} s${still.source !== undefined ? ` (source ${still.source.toFixed(2)} s)` : ''}  ${still.file}`),
      ...(result.sheet ? [`sheet  ${result.sheet}`] : []),
    ].join('\n'),
  );
  return result;
```

with:

```ts
    [
      ...result.stills.map((still) => `${still.t.toFixed(2)} s${still.source !== undefined ? ` (source ${still.source.toFixed(2)} s)` : ''}  ${still.file}`),
      ...(result.sheet ? [`sheet  ${result.sheet}`] : []),
      ...(result.motion ?? []).flatMap((report) => report.errors.map((error) => `error in ${report.item} (${report.src}): ${error}`)),
    ].join('\n'),
  );
  return result;
```

In `apps/cli/src/electron/protocol.ts`, replace:

```ts
// answer and a cancel go over Node's IPC channel (Electron's main process reads no stdin on
// Windows, and the console's Ctrl+C does not reach it). Pure: both sides import it.

export type ElectronRequest = (
  | { command: 'render'; projectDir: string; out: string; format?: string; encoder?: string; captions?: boolean; subtitles?: string[] }
  | { command: 'preview'; projectDir: string; outDir: string; times: number[]; format?: string; sheet?: { columns?: number }; clean?: boolean }
  | { command: 'capture-page'; target: string; out: string; width: number; height: number; fullPage: boolean; waitMs: number }
) & {
  /** No progress lines on stderr (--json). */
```

with:

```ts
// answer and a cancel go over Node's IPC channel (Electron's main process reads no stdin on
// Windows, and the console's Ctrl+C does not reach it). Pure: both sides import it.

/** A motion page to check: rendered as the only scene of the project (`cuttle motion check`). */
export interface MotionCheck {
  /** The page, from the project folder. */
  src: string;
  duration: number;
  params: Record<string, string | number | boolean | null>;
  network: boolean;
}

export type ElectronRequest = (
  | { command: 'render'; projectDir: string; out: string; format?: string; encoder?: string; captions?: boolean; subtitles?: string[] }
  | { command: 'preview'; projectDir: string; outDir: string; times: number[]; format?: string; sheet?: { columns?: number }; clean?: boolean; motion?: MotionCheck }
  | { command: 'capture-page'; target: string; out: string; width: number; height: number; fullPage: boolean; waitMs: number }
) & {
  /** No progress lines on stderr (--json). */
```

In `apps/cli/src/electron/main.ts`, replace:

```ts
// WebCodecs). Started by the Node CLI (electron-runner.ts) with one base64 JSON request and an IPC
// channel, which carries the answer back and a cancel in; progress and warnings go to stderr.
// Loaded by bootstrap.ts, which handles uncaught exceptions.
import { app } from 'electron';
import { SUBTITLE_FORMATS, exportProject, isExportFormat, renderStills, type EncoderPreference, type ExportFormat, type SubtitleFormat } from '@cuttle/export';
import { capturePage } from './capture-page';
import { failure, finish } from './finish';
import { decodeRequest, type CancelMessage, type ElectronRequest, type ElectronResponse } from './protocol';

// The export window is the app's only window; closing it must not quit before the job is done.
app.on('window-all-closed', () => {});
// The CLI cancels over IPC (Ctrl+C in its console never reaches this process on Windows); a signal
```

with:

```ts
// WebCodecs). Started by the Node CLI (electron-runner.ts) with one base64 JSON request and an IPC
// channel, which carries the answer back and a cancel in; progress and warnings go to stderr.
// Loaded by bootstrap.ts, which handles uncaught exceptions.
import { app, protocol } from 'electron';
import { MOTION_SCHEME_PRIVILEGES, SUBTITLE_FORMATS, exportProject, isExportFormat, renderStills, type EncoderPreference, type ExportFormat, type SubtitleFormat } from '@cuttle/export';
import { capturePage } from './capture-page';
import { failure, finish } from './finish';
import { decodeRequest, type CancelMessage, type ElectronRequest, type ElectronResponse, type MotionCheck } from './protocol';
import type { CuttleProject } from '@cuttle/project';

// Motion pages are served from a scheme of their own, which must be known before the app is ready.
protocol.registerSchemesAsPrivileged([MOTION_SCHEME_PRIVILEGES]);
// The export window is the app's only window; closing it must not quit before the job is done.
app.on('window-all-closed', () => {});
// The CLI cancels over IPC (Ctrl+C in its console never reaches this process on Windows); a signal
```

In the same file, replace:

```ts
  return formats as SubtitleFormat[];
}

async function handle(request: ElectronRequest): Promise<unknown> {
  switch (request.command) {
    case 'render':
```

with:

```ts
  return formats as SubtitleFormat[];
}

/** The project with the checked page as its only scene (its look and output stay). */
function motionCheckProject(project: CuttleProject, check: MotionCheck): CuttleProject {
  return { ...project, scenes: [{ type: 'motion', label: 'check', ...check }], overlays: [], cuts: [] };
}

async function handle(request: ElectronRequest): Promise<unknown> {
  switch (request.command) {
    case 'render':
```

In the same file, replace:

```ts
        times: request.times,
        ...exportFormat(request.format),
        ...(request.sheet && { sheet: request.sheet }),
        signal: cancel.signal,
        onProgress: progress('stills', request.quiet),
      });
```

with:

```ts
        times: request.times,
        ...exportFormat(request.format),
        ...(request.sheet && { sheet: request.sheet }),
        ...(request.motion && { project: (project: CuttleProject) => motionCheckProject(project, request.motion!) }),
        signal: cancel.signal,
        onProgress: progress('stills', request.quiet),
      });
```

In `apps/cli/src/main.ts`, replace:

```ts
import { fitCommand } from './commands/fit';
import { frameCommand } from './commands/frame';
import { init } from './commands/init';
import { previewCommand } from './commands/preview';
import { recordCommand } from './commands/record';
import { recoverCommand } from './commands/recover';
```

with:

```ts
import { fitCommand } from './commands/fit';
import { frameCommand } from './commands/frame';
import { init } from './commands/init';
import { motionCheckCommand } from './commands/motion';
import { previewCommand } from './commands/preview';
import { recordCommand } from './commands/record';
import { recoverCommand } from './commands/recover';
```

In the same file, replace:

```ts
      ),
    );

  program
    .command('capture-page <target>')
    .description('a web page (URL or file) as a PNG in stills/, optionally as a still scene')
```

with:

```ts
      ),
    );

  const motion = program.command('motion').description('motion pages: scenes and overlays drawn by code (HTML, CSS, canvas, WebGL)');
  motion
    .command('check <src>')
    .description('render a motion page frame by frame as the export draws it: PNGs, a contact sheet, its errors and console')
    .option('--duration <seconds>', 'how long it lasts (default: as in cuttle.json, else 3)', positive)
    .option('--at <seconds...>', 'seconds into it (default: 8 from its start to its end)', collect)
    .option('--format <format>', '16:9, 1:1 or 9:16 (default: the project output)')
    .option('-o, --out <dir>', 'folder for the PNGs (default: preview/motion-<name>/ in the project)')
    .action(
      action((output, project, src: string, options: { duration?: number; at?: number[]; format?: string; out?: string }) =>
        withSignal(output, (signal) => motionCheckCommand(project, src, options, output, signal)),
      ),
    );

  program
    .command('capture-page <target>')
    .description('a web page (URL or file) as a PNG in stills/, optionally as a still scene')
```

- [ ] **Step 3: Run the check**

Run: `pnpm cli:check`
Expected: PASS, 8 tests. Among them:
- the check page's shapes (CSS, Web Animations, an animation frame, a timer) are where their time puts them on every frame, and a second run gives the same bytes;
- a page that throws is reported, and it reaches neither the network nor a file outside the project;
- a motion scene and an overlay are in the rendered video, as the preview shows them.

- [ ] **Step 4: Commit**

```bash
git add apps/cli
git commit -m "cli: cuttle motion check, and preview and render that draw motion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Motion in the app

**Files:**
- Modify: `apps/desktop/src/main/protocols.ts`, `apps/desktop/src/shared/{timeline-model,document}.ts`, `apps/desktop/src/renderer/editor/{Timeline.tsx,Inspector.tsx,actions.ts,editor.css}`, `apps/desktop/src/renderer/tokens.css`, `apps/desktop/test/{fixture,app.check.test}.ts`

- [ ] **Step 1: The check**

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
 * A take with motion: a still screen (dark grey) for 5 s, a 1 s motion scene before it (a page that
 * fills the frame with magenta) and a motion overlay over source 1 to 4 s (a green bar across the
 * bottom fifth, clear above it).
 */
export function makeMotionFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=1280x720:r=30:d=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(take, 'screen.mp4')]);
  for (const [name, body] of [
    ['intro', '<body style="margin:0;background:#ff00ff"></body>'],
    ['bar', '<body style="margin:0"><div style="position:absolute;left:0;right:0;bottom:0;height:20%;background:#00ff00"></div></body>'],
  ] as const) {
    mkdirSync(join(dir, 'motion', name), { recursive: true });
    writeFileSync(join(dir, 'motion', name, 'index.html'), `<!doctype html>${body}`);
  }
  const project = {
    version: 1,
    output: FIXTURE_OUTPUT,
    sources: { screen: 'takes/1/screen.mp4' },
    look: { transition: { enabled: false } },
    scenes: [
      { type: 'motion', id: 's1', src: 'motion/intro/index.html', duration: 1 },
      { type: 'clip', id: 's2', from: 0, to: 5 },
    ],
    overlays: [{ id: 'o1', src: 'motion/bar/index.html', at: 1, duration: 3 }],
  };
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
import { FIXTURE_OUTPUT, makeFixture, makePrivateFixture, makeRestingFixture, makeSpokenFixture } from './fixture';

/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
```

with:

```ts
import { whisperCliPath } from '@cuttle/core';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OUTPUT, makeFixture, makeMotionFixture, makePrivateFixture, makeRestingFixture, makeSpokenFixture } from './fixture';

/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
```

In the same file, replace:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'private · Cuttle')?.close());
  }, 180_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

with:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'private · Cuttle')?.close());
  }, 180_000);

  it('opens a project with motion: its scene on the timeline, and the export draws the scene and the overlay', async () => {
    const dir = join(root, 'motion');
    makeMotionFixture(dir);
    const page = await openEditor(dir);
    await page.waitForSelector('.scene.motion');
    expect(await page.locator('.scene.motion').first().textContent()).toContain('intro');
    await shotOf('37-motion', '/editor.html', 'motion · Cuttle');
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-sheet]');
    await page.click('[data-testid=export-start]');
    await page.waitForSelector('[data-testid=export-file]', { timeout: 120_000 });
    // a pixel of the video (rgb24 from ffmpeg; a crop of 2×2, since 4:2:0 video crops in pairs)
    const pixel = (seconds: number, x: number, y: number) => [
      ...spawnSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', join(dir, 'out', 'export.mp4'), '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { windowsHide: true }).stdout.subarray(0, 3),
    ];
    // saturated colours move a little between the video's colour matrix and ffmpeg's
    const near = (actual: number[], expected: number[]) => actual.length === 3 && actual.every((value, i) => Math.abs(value - expected[i]!) <= 40);
    // the scene fills the frame; over the clip (output 2.5 s is source 1.5 s) the overlay's bar shows at the bottom only
    expect(near(pixel(0.5, 320, 180), [255, 0, 255])).toBe(true);
    expect(near(pixel(2.5, 320, 350), [0, 255, 0])).toBe(true);
    expect(near(pixel(2.5, 320, 100), [0, 255, 0])).toBe(false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion · Cuttle')?.close());
  }, 180_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

- [ ] **Step 2: The scheme, the block and its inspector**

In `apps/desktop/src/main/protocols.ts`, replace:

```ts
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { net, protocol, type Session } from 'electron';
import { isInside, mediaCandidate, mediaFile, mediaType } from '../shared/media-path';
import { parseRange } from '../shared/range';
```

with:

```ts
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MOTION_SCHEME_PRIVILEGES } from '@cuttle/export';
import { net, protocol, type Session } from 'electron';
import { isInside, mediaCandidate, mediaFile, mediaType } from '../shared/media-path';
import { parseRange } from '../shared/range';
```

In the same file, replace:

```ts
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'cuttle-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}
```

with:

```ts
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'cuttle-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
    // the export's motion pages (their own sessions serve it)
    MOTION_SCHEME_PRIVILEGES,
  ]);
}
```

In `apps/desktop/src/shared/timeline-model.ts`, replace:

```ts
  index: number;
  /** The scene's id (`#<index>` for one without). */
  id: string;
  kind: 'clip' | 'still' | 'card';
  /** Output seconds. */
  start: number;
  end: number;
```

with:

```ts
  index: number;
  /** The scene's id (`#<index>` for one without). */
  id: string;
  kind: 'clip' | 'still' | 'card' | 'motion';
  /** Output seconds. */
  start: number;
  end: number;
```

In the same file, replace:

```ts
    const motion = scene.motion === 'none' ? '' : ` · ${scene.motion === 'kenburns' ? 'Ken Burns' : 'scroll'}`;
    return { index, id, kind: 'still', start, end, title: scene.label ?? baseName(scene.image), detail: `${formatDuration(scene.duration)}${motion}` };
  }
  return { index, id, kind: 'card', start, end, title: scene.label ?? scene.title, detail: formatDuration(scene.duration) };
}

function lane<T extends { enabled: boolean; label?: string; id?: string }>(
  kind: OverlayKind,
  items: readonly T[],
```

with:

```ts
    const motion = scene.motion === 'none' ? '' : ` · ${scene.motion === 'kenburns' ? 'Ken Burns' : 'scroll'}`;
    return { index, id, kind: 'still', start, end, title: scene.label ?? baseName(scene.image), detail: `${formatDuration(scene.duration)}${motion}` };
  }
  if (scene.type === 'motion') return { index, id, kind: 'motion', start, end, title: scene.label ?? motionName(scene.src), detail: `Motion · ${formatDuration(scene.duration)}` };
  return { index, id, kind: 'card', start, end, title: scene.label ?? scene.title, detail: formatDuration(scene.duration) };
}

/** A motion page's name: its folder (`motion/intro/index.html` is "intro"), or the file without its extension. */
export function motionName(src: string): string {
  const parts = src.split(/[\\/]/).filter(Boolean);
  const file = parts.at(-1) ?? src;
  return /^index\.html?$/i.test(file) && parts.length > 1 ? parts.at(-2)! : file.replace(/\.html?$/i, '');
}

function lane<T extends { enabled: boolean; label?: string; id?: string }>(
  kind: OverlayKind,
  items: readonly T[],
```

In `apps/desktop/src/shared/document.ts`, replace:

```ts
  return { raw: current, dropped };
}

const NOUNS: Record<ListName, [string, string]> = { scenes: ['scene', 'scenes'], zooms: ['zoom', 'zooms'], masks: ['mask', 'masks'], texts: ['caption', 'captions'], cuts: ['cut', 'cuts'] };
const noun = (list: ListName, count: number) => `${count} ${NOUNS[list][count === 1 ? 0 : 1]}`;

/**
```

with:

```ts
  return { raw: current, dropped };
}

const NOUNS: Record<ListName, [string, string]> = {
  scenes: ['scene', 'scenes'],
  zooms: ['zoom', 'zooms'],
  masks: ['mask', 'masks'],
  texts: ['caption', 'captions'],
  overlays: ['motion overlay', 'motion overlays'],
  cuts: ['cut', 'cuts'],
};
const noun = (list: ListName, count: number) => `${count} ${NOUNS[list][count === 1 ? 0 : 1]}`;

/**
```

In `apps/desktop/src/renderer/editor/actions.ts`, replace:

```ts
export const SPEEDS = [1, 2, 4, 8, 12, 20] as const;

export const LIST_OF: Record<Selection['kind'], ListName> = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', cut: 'cuts', crop: 'scenes' };
const NAMES: Record<ListName, string> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', cuts: 'cut' };

/** Where the playhead is: its scene and, in a clip, the source second it shows. */
export interface PlayheadPlace {
```

with:

```ts
export const SPEEDS = [1, 2, 4, 8, 12, 20] as const;

export const LIST_OF: Record<Selection['kind'], ListName> = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', cut: 'cuts', crop: 'scenes' };
/** What people call a scene of each type. */
const SCENE_NOUNS: Record<Scene['type'], string> = { clip: 'clip', still: 'page', card: 'card', motion: 'motion scene' };
const NAMES: Record<ListName, string> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', overlays: 'motion overlay', cuts: 'cut' };

/** Where the playhead is: its scene and, in a clip, the source second it shows. */
export interface PlayheadPlace {
```

In the same file, replace:

```ts
export function overlayBlocked(t = currentPlayer()?.current().t ?? 0): string | undefined {
  const place = playheadPlace(t);
  if (!place) return 'There is nothing in the video yet';
  if (!place.clip) return `Zooms, masks and captions go on clips, not on a ${place.span.scene.type === 'still' ? 'page' : 'card'}: move the playhead onto a clip`;
  if ((currentPlayer()?.clipsAt(t) ?? 1) > 1) return 'Zooms, masks and captions do not go inside a crossfade: move the playhead a little';
  return undefined;
}
```

with:

```ts
export function overlayBlocked(t = currentPlayer()?.current().t ?? 0): string | undefined {
  const place = playheadPlace(t);
  if (!place) return 'There is nothing in the video yet';
  if (!place.clip) return `Zooms, masks and captions go on clips, not on a ${SCENE_NOUNS[place.span.scene.type]}: move the playhead onto a clip`;
  if ((currentPlayer()?.clipsAt(t) ?? 1) > 1) return 'Zooms, masks and captions do not go inside a crossfade: move the playhead a little';
  return undefined;
}
```

In the same file, replace:

```ts
  else edit([{ type: 'look', path: ['background'], value: { preset: 'image', image: chosen.path } }], 'Background image');
}

const KIND_OF: Record<ListName, Selection['kind']> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', cuts: 'cut' };

/** Selects an item and moves the playhead to where the video first shows it (the toast's "Show"). */
export function reveal(list: ListName, id: string): void {
  const project = documentProject();
  const item = project?.[list].find((candidate) => candidate.id === id);
  if (!project || !item) return;
  select({ kind: KIND_OF[list], id });
  const spans = sceneSpans(project.scenes, project.cuts);
  const sceneIndex = list === 'scenes' ? project.scenes.indexOf(item as Scene) : -1;
  const at =
```

with:

```ts
  else edit([{ type: 'look', path: ['background'], value: { preset: 'image', image: chosen.path } }], 'Background image');
}

/** What selecting an item of each list selects (motion overlays get a lane in P5-M1c). */
const KIND_OF: Record<ListName, Selection['kind'] | undefined> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', overlays: undefined, cuts: 'cut' };

/** Selects an item and moves the playhead to where the video first shows it (the toast's "Show"). */
export function reveal(list: ListName, id: string): void {
  const project = documentProject();
  const item = project?.[list].find((candidate) => candidate.id === id);
  if (!project || !item) return;
  const kind = KIND_OF[list];
  if (kind) select({ kind, id });
  const spans = sceneSpans(project.scenes, project.cuts);
  const sceneIndex = list === 'scenes' ? project.scenes.indexOf(item as Scene) : -1;
  const at =
```

In `apps/desktop/src/renderer/editor/Timeline.tsx`, replace:

```tsx
        setDrag({});
        if (!moved) return;
        if (edge) {
          if (commands) edit(commands, scene.type === 'clip' ? 'Trim clip' : `Change the length of the ${scene.type === 'still' ? 'page' : 'card'}`);
          else preview(undefined);
          return;
        }
```

with:

```tsx
        setDrag({});
        if (!moved) return;
        if (edge) {
          if (commands) edit(commands, scene.type === 'clip' ? 'Trim clip' : `Change the length of the ${scene.type === 'still' ? 'page' : scene.type === 'motion' ? 'motion scene' : 'card'}`);
          else preview(undefined);
          return;
        }
```

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```tsx
  TEXT_STYLE_NAMES,
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { outputTimesOf } from '../../shared/timeline-model';
import { BackgroundIcon, CameraIcon, CardIcon, CheckIcon, ChevronIcon, CopyIcon, CropIcon, FilmIcon, MaskIcon, PageIcon, SelectIcon, SoundIcon, SplitIcon, SubtitlesIcon, TextIcon, TrashIcon, WindowIcon, ZoomIcon } from '../icons';
import { Select as StyledSelect } from '../Select';
import { chooseImage, cutShownAt, deleteSelection, duplicateSelection, LIST_OF, playheadPlace, reveal, SPEEDS } from './actions';
```

with:

```tsx
  TEXT_STYLE_NAMES,
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { motionName, outputTimesOf } from '../../shared/timeline-model';
import { BackgroundIcon, CameraIcon, CardIcon, CheckIcon, ChevronIcon, CopyIcon, CropIcon, FilmIcon, MaskIcon, PageIcon, SelectIcon, SoundIcon, SplitIcon, SubtitlesIcon, TextIcon, TrashIcon, WindowIcon, ZoomIcon } from '../icons';
import { Select as StyledSelect } from '../Select';
import { chooseImage, cutShownAt, deleteSelection, duplicateSelection, LIST_OF, playheadPlace, reveal, SPEEDS } from './actions';
```

In the same file, replace:

```tsx
        </>
      );
    }
    return (
      <>
        <Head icon={<CardIcon />} color="var(--card)" name={scene.label ?? 'Card'} />
```

with:

```tsx
        </>
      );
    }
    if (scene.type === 'motion') {
      return (
        <>
          <Head icon={<CardIcon />} color="var(--motion)" name={scene.label ?? motionName(scene.src)} />
          <Row label="Label">
            <TextInput value={scene.label ?? ''} placeholder={motionName(scene.src)} onCommit={(value) => set('scenes', id, { label: value.trim() || undefined }, 'Rename motion scene')} />
          </Row>
          <Row label="Page" plain>
            <span className="path" title={scene.src}>
              {scene.src}
            </span>
          </Row>
          {inVideo}
          <Row label="Length (s)">
            <NumberInput value={scene.duration} min={0.1} onCommit={(duration) => edit([{ type: 'trim', id, duration }], 'Change the length of the motion scene')} />
          </Row>
        </>
      );
    }
    return (
      <>
        <Head icon={<CardIcon />} color="var(--card)" name={scene.label ?? 'Card'} />
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```css
  background: linear-gradient(180deg, rgba(242, 179, 74, 0.26), rgba(242, 179, 74, 0.1));
  box-shadow: inset 0 0 0 1px rgba(242, 179, 74, 0.45);
}
.item {
  position: absolute;
  height: 18px;
```

with:

```css
  background: linear-gradient(180deg, rgba(242, 179, 74, 0.26), rgba(242, 179, 74, 0.1));
  box-shadow: inset 0 0 0 1px rgba(242, 179, 74, 0.45);
}
.scene.motion {
  background: linear-gradient(180deg, rgba(167, 139, 250, 0.28), rgba(167, 139, 250, 0.1));
  box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.5);
}
.item {
  position: absolute;
  height: 18px;
```

In `apps/desktop/src/renderer/tokens.css`, replace:

```css
  --caption: #4fd1a1;
  --still: #3cc6c9;
  --card: #f2b34a;

  /* states */
  --recording: #ff4d4f;
```

with:

```css
  --caption: #4fd1a1;
  --still: #3cc6c9;
  --card: #f2b34a;
  --motion: #a78bfa;

  /* states */
  --recording: #ff4d4f;
```

- [ ] **Step 3: Run the check**

Run: `pnpm app:check`
Expected: PASS, 48 tests, among them "opens a project with motion: its scene on the timeline, and the export draws the scene and the overlay".

- [ ] **Step 4: Commit**

```bash
git add apps/desktop
git commit -m "desktop: motion scenes on the timeline, and the app's export draws motion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The skill

**Files:**
- Modify: `skill/cuttle/{SKILL,project}.md`, `skill/test/skill.test.ts`

- [ ] **Step 1: The format and the page contract**

In `skill/cuttle/project.md`, replace:

```markdown
## Times and pixels

- **Source seconds** are seconds of the take's screen track (`takes/<n>/screen.mp4`). Scenes cut
  and speed them up. `zooms`, `masks` and `texts` use source seconds too, so they stay on their
  content; they show only while a clip scene covers that source time. In a clip at speed `s`, `d`
  source seconds last `d / s` output seconds: a 3 s caption over a 12× clip is on screen for a
  quarter second, so give it `"duration": 36` there.
- **Output seconds** are seconds of the rendered video. `cuttle preview --at` and the times on the
```

with:

```markdown
## Times and pixels

- **Source seconds** are seconds of the take's screen track (`takes/<n>/screen.mp4`). Scenes cut
  and speed them up. `zooms`, `masks`, `texts` and motion `overlays` use source seconds too, so
  they stay on their content; they show only while a clip scene covers that source time. In a clip at speed `s`, `d`
  source seconds last `d / s` output seconds: a 3 s caption over a 12× clip is on screen for a
  quarter second, so give it `"duration": 36` there.
- **Output seconds** are seconds of the rendered video. `cuttle preview --at` and the times on the
```

In the same file, replace:

```markdown
    "cursor": { "style": "system" }
  },
  "scenes": [
    { "type": "clip", "id": "s1", "label": "Prompt", "from": 1.2, "to": 7.5 },
    { "type": "clip", "id": "s2", "label": "Claude at work", "from": 7.5, "to": 120.4, "speed": 12 },
    { "type": "clip", "id": "s3", "label": "Answer", "from": 120.4, "to": 128 },
```

with:

```markdown
    "cursor": { "style": "system" }
  },
  "scenes": [
    { "type": "motion", "id": "s0", "label": "Intro", "src": "motion/intro/index.html", "duration": 2.5, "params": { "title": "One prompt" } },
    { "type": "clip", "id": "s1", "label": "Prompt", "from": 1.2, "to": 7.5 },
    { "type": "clip", "id": "s2", "label": "Claude at work", "from": 7.5, "to": 120.4, "speed": 12 },
    { "type": "clip", "id": "s3", "label": "Answer", "from": 120.4, "to": 128 },
```

In the same file, replace:

````markdown
  ],
  "zooms": [{ "id": "z1", "label": "Answer", "at": 121, "duration": 4, "rect": [0, 600, 1400, 788] }],
  "masks": [{ "from": 0, "to": 128, "rect": [2200, 0, 360, 40], "style": "fill" }],
  "texts": [{ "at": 2, "duration": 3, "text": "One prompt", "style": "pill", "position": "bottom" }]
}
```
````

with:

````markdown
  ],
  "zooms": [{ "id": "z1", "label": "Answer", "at": 121, "duration": 4, "rect": [0, 600, 1400, 788] }],
  "masks": [{ "from": 0, "to": 128, "rect": [2200, 0, 360, 40], "style": "fill" }],
  "texts": [{ "at": 2, "duration": 3, "text": "One prompt", "style": "pill", "position": "bottom" }],
  "overlays": [{ "id": "o1", "label": "Callout", "src": "motion/callout/index.html", "at": 121, "duration": 4 }]
}
```
````

In the same file, replace:

```markdown
| `clip` | `from`, `to` (source seconds, `to` > `from`), `speed` (`1`, up to 64; above 1 a badge like "12× speed" shows), `badge` (custom badge text, `""` for none), `crop` (`{ "rect": [x, y, w, h], "enabled": true }`: the part of the screen the clip shows, e.g. a browser's page without its tabs; the window takes its shape and zooms stay inside it; `suggest` makes it, tagged `auto: "crop"`, and cuts a clip where the content area changes for good) |
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |

`zooms`: `at` and `duration` (source seconds), `rect`, `ease` (`smooth`, `linear`) and `enabled`
(`true`). The rect is widened to the screen's aspect and kept inside the screen. The zoom eases in
```

with:

```markdown
| `clip` | `from`, `to` (source seconds, `to` > `from`), `speed` (`1`, up to 64; above 1 a badge like "12× speed" shows), `badge` (custom badge text, `""` for none), `crop` (`{ "rect": [x, y, w, h], "enabled": true }`: the part of the screen the clip shows, e.g. a browser's page without its tabs; the window takes its shape and zooms stay inside it; `suggest` makes it, tagged `auto: "crop"`, and cuts a clip where the content area changes for good) |
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |
| `motion` | `src` (an HTML page in the project, e.g. `motion/intro/index.html`), `duration` (output seconds), `params` (`{ "name": value }`: text, numbers, `true`/`false` or `null`, for the page), `network` (`false`; `true` lets the page load from https): a page drawn frame by frame over the whole output, over the background where it is clear (see "Motion pages") |

`zooms`: `at` and `duration` (source seconds), `rect`, `ease` (`smooth`, `linear`) and `enabled`
(`true`). The rect is widened to the screen's aspect and kept inside the screen. The zoom eases in
```

In the same file, replace:

```markdown
`position` (`top`, `center`, `bottom`) and `enabled` (`true`). A `top` text sits over the window's
title bar; `bottom` keeps the title visible. Texts fade in and out over 0.25 output seconds.

`captions`: the subtitles from the transcript (none without one). `enabled` (`true`), `style`
(`subtitle`: two lines on a dark box; `karaoke`: the spoken word in `color`; `bold`: a few big words),
`position` (`bottom`, `top`, `center`), `size` (`1`, 0.5 to 2), `color` (`#D97757`), and `fixes`:
```

with:

```markdown
`position` (`top`, `center`, `bottom`) and `enabled` (`true`). A `top` text sits over the window's
title bar; `bottom` keeps the title visible. Texts fade in and out over 0.25 output seconds.

`overlays` are motion pages over the video: `src`, `at` and `duration` (source seconds, as a
text's), `params`, `network` and `enabled` (`true`). A page covers the whole output with its
transparency (a lower third, a callout, a logo), over the clip, its zooms, masks, cursor and texts,
and under the captions. Its clock runs in output seconds from where the video first shows its
stretch, across cuts and speed-ups; a clip shown twice shows it twice.

`captions`: the subtitles from the transcript (none without one). `enabled` (`true`), `style`
(`subtitle`: two lines on a dark box; `karaoke`: the spoken word in `color`; `bold`: a few big words),
`position` (`bottom`, `top`, `center`), `size` (`1`, 0.5 to 2), `color` (`#D97757`), and `fixes`:
```

In the same file, replace:

```markdown
them for slips ("Retake": the mistake key, or a spoken "nochmal" with the bit said again), filler
words ("Filler: äh") and pauses ("Pause: 2.4 s") from the transcript.

Every scene, zoom, mask, text and cut may have an `id` (1 to 64 letters, digits, `-` or `_`,
unique in the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest`
sets both on what it makes (`s1`, `z1`; "Prompt", "Claude at work", "Waiting", "Answer"). Keep
them when you edit an item; give a new item an id no other item uses (`s7`, `m2`, `c3`) and a
```

with:

```markdown
them for slips ("Retake": the mistake key, or a spoken "nochmal" with the bit said again), filler
words ("Filler: äh") and pauses ("Pause: 2.4 s") from the transcript.

Every scene, zoom, mask, text, overlay and cut may have an `id` (1 to 64 letters, digits, `-` or `_`,
unique in the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest`
sets both on what it makes (`s1`, `z1`; "Prompt", "Claude at work", "Waiting", "Answer"). Keep
them when you edit an item; give a new item an id no other item uses (`s7`, `m2`, `c3`) and a
```

In the same file, replace:

```markdown
(`clickZooms`, `answerZoom`, `crop`, `privacy`, `retakes`, `fillers`, `pauses`, `typingZooms`,
`dialogZooms`: all `true`) holds which kinds are made at all; one set to `false` is not made again.

## Finding source seconds and rects

- `cuttle --json preview` lists each still's `source` second next to its output second `t`.
```

with:

````markdown
(`clickZooms`, `answerZoom`, `crop`, `privacy`, `retakes`, `fillers`, `pauses`, `typingZooms`,
`dialogZooms`: all `true`) holds which kinds are made at all; one set to `false` is not made again.

## Motion pages

A motion scene or overlay is a web page in the project folder, usually `motion/<name>/index.html`
with its own CSS, scripts, images and fonts next to it. Anything a browser draws works: HTML and
CSS, SVG, a canvas, WebGL. Cuttle renders it frame by frame, the same in every render.

- **Its clock is the video's.** `performance.now`, `Date`, `setTimeout`, `setInterval`,
  `requestAnimationFrame`, CSS animations and transitions and Web Animations all follow the frame
  being drawn, from 0 at the item's start. `Math.random` is seeded per item. Ordinary animation
  code works as it is.
- **`window.cuttle`** (there before the page's scripts run): `time` (seconds into the item),
  `duration`, `fps`, `size` (`{ width, height }`: the output), `format` (`16:9`, `9:16`, `1:1`),
  `params` (the item's), `theme`, `onFrame((t) => …)` (called before each frame is drawn, also
  after a jump: draw everything from `t` there and the frame is always right), and
  `ready(promise)` (the first frame waits for it: data, a model, images it loads late; fonts and
  `<img>`s are waited for anyway).
- **The look** as CSS variables: `--cuttle-accent` (the cursor colour), `--cuttle-bg`,
  `--cuttle-fg`, `--cuttle-font`, `--cuttle-mono`.
- **Transparent by default.** Where the page draws nothing, a scene shows the look's background and
  an overlay the video. A scene that wants its own background sets one on `body`.
- **The size is the output's**: 1920×1080 for 16:9, 1080×1920 for 9:16. Lay out in `%`, `vw` and
  `vh`, or from `cuttle.size`, so one page works in every format.
- **Only the project's files.** Load them by relative paths. Nothing else is reachable (no
  network, no other files) unless the item has `"network": true`.

```html
<!doctype html>
<style>
  body { margin: 0; display: grid; place-items: center; height: 100vh; font: 700 8vh var(--cuttle-font); color: var(--cuttle-fg); }
  h1 { animation: rise 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(6vh); } }
</style>
<h1 id="title"></h1>
<script>
  title.textContent = cuttle.params.title ?? 'Hello';
  cuttle.onFrame((t) => (title.style.opacity = String(Math.min(1, (cuttle.duration - t) / 0.4))));
</script>
```

## Finding source seconds and rects

- `cuttle --json preview` lists each still's `source` second next to its output second `t`.
````

In `skill/cuttle/SKILL.md`, replace:

```markdown
  scrolling still of a web page (the result the agent built); add `--wait 2500` for slow maps or
  fonts. It goes after every scene, so capture pages before you add the end card (or move the
  still in `scenes`).
- **End card.** A `card` scene at the end with the product name and URL.

## 4. Render
```

with:

```markdown
  scrolling still of a web page (the result the agent built); add `--wait 2500` for slow maps or
  fonts. It goes after every scene, so capture pages before you add the end card (or move the
  still in `scenes`).
- **Motion.** Anything a browser draws can be in the video: a kinetic intro, an end card with the
  product's look, a chart that builds, a callout or a lower third over the clip. Write a page into
  `motion/<name>/index.html` (project.md, "Motion pages"), add it as a `motion` scene or to
  `overlays`, and check it before you preview the video:
  `cuttle -C "<project>" --json motion check motion/<name>/index.html` renders it frame by frame
  into `preview/motion-<name>/` (`--duration`, `--at`) and lists its `errors` and `console`.
  Read the sheet, fix every error, then look at it in the video with `preview --at`.
- **End card.** A `card` scene at the end with the product name and URL, or a `motion` scene.

## 4. Render
```

In `skill/test/skill.test.ts`, replace:

```ts
/** The help text of a command, from the CLI itself. */
async function help(command: string): Promise<string> {
  let out = '';
  await runCli([command, '--help'], { stdout: (text) => void (out += text), stderr: () => {} });
  return out;
}

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'render', 'recover'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
```

with:

```ts
/** The help text of a command, from the CLI itself. */
async function help(command: string): Promise<string> {
  let out = '';
  await runCli([...command.split(' '), '--help'], { stdout: (text) => void (out += text), stderr: () => {} });
  return out;
}

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'render', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
```

In the same file, replace:

```ts
  // `cuttle [-C dir] [--json] <command> … --flags`, up to the end of the line, a `&&`, `;`, `|` or the next cuttle.
  const uses = code.flatMap((snippet) =>
    [...snippet.matchAll(/(?:^|\s)cuttle((?: (?:-C "[^"]*"|-C \S+|--json))*) ([a-z][a-z-]*)((?:(?!&&|;|\||\bcuttle )[^\n])*)/g)].map(
      ([, , command, rest]) => ({
        command: command!,
        flags: [...rest!.matchAll(/(?:^|\s)(--[a-z-]+)/g)].map((flag) => flag[1]!).filter((flag) => !GLOBAL.includes(flag)),
      }),
    ),
  );
  // An option on its own (`--until-file "<project>/stop"`): it must belong to some command.
  const loose = code.flatMap((snippet) => (/^--[a-z-]+/.exec(snippet)?.[0] ?? []) as string[]);

  it('covers the workflow', () => {
    expect(new Set(uses.map((use) => use.command))).toEqual(new Set(COMMANDS));
```

with:

```ts
  // `cuttle [-C dir] [--json] <command> … --flags`, up to the end of the line, a `&&`, `;`, `|` or the next cuttle.
  const uses = code.flatMap((snippet) =>
    [...snippet.matchAll(/(?:^|\s)cuttle((?: (?:-C "[^"]*"|-C \S+|--json))*) ([a-z][a-z-]*)((?:(?!&&|;|\||\bcuttle )[^\n])*)/g)].map(
      ([, , group, rest]) => {
        const sub = GROUPS.includes(group!) ? / ([a-z][a-z-]*)/.exec(rest!)?.[1] : undefined;
        return {
          command: sub ? `${group} ${sub}` : group!,
          flags: [...rest!.matchAll(/(?:^|\s)(--[a-z-]+)/g)].map((flag) => flag[1]!).filter((flag) => !GLOBAL.includes(flag)),
        };
      },
    ),
  );
  // An option on its own (`--until-file "<project>/stop"`): it must belong to some command. The
  // motion pages' CSS variables (`--cuttle-accent`) are not options.
  const loose = code.flatMap((snippet) => (/^--(?!cuttle-)[a-z-]+/.exec(snippet)?.[0] ?? []) as string[]);

  it('covers the workflow', () => {
    expect(new Set(uses.map((use) => use.command))).toEqual(new Set(COMMANDS));
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run --project node skill/test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add skill
git commit -m "skill: motion pages, their contract, and motion check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 750 passed and 62 skipped (on a machine without a speech model the real transcription is skipped too: 749 and 63; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 8 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. In a project, write `motion/hello/index.html` with a heading that slides in (CSS) and run `cuttle -C "<project>" motion check motion/hello/index.html`: the sheet shows it sliding in, and "no errors".
2. Add it as the first scene (`{ "type": "motion", "src": "motion/hello/index.html", "duration": 2 }`) and export from the app: the video opens with it, over the background.
3. Add it to `overlays` at a source second of the clip: it shows over the video there.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran once, on the prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits.

**Found while checking, and already in the plan above**
- **A 9:16 page never painted its first frame.** Windows keeps a new window inside the screen's work area, offscreen or not, and the page's paint follows the window: 1080×1924 became 1080×1104, so the frame marker below the page was never in a paint. A resize after the window exists is not limited (4K works too). The CLI check renders the check page in 9:16.
- **Electron's security advice** to unpackaged apps ("Insecure Content-Security-Policy", for a page that allows `unsafe-eval`) filled every page's console. It is left out.
- **Every page made a new session**, and Electron keeps a session for the app's life: the app would have gathered one per item and export. A page now takes an emptied session of the same project from a pool.
- **The app check's pixel helper cropped 1×1** from a 4:2:0 video, which ffmpeg refuses (the crop rounds to 0). It crops 2×2. Saturated colours move up to about 20 levels between the video's colour matrix and ffmpeg's conversion, so the check allows 40.
- **A new take kept the motion overlays** of the old one, though they are timed on its source seconds. It drops them with the zooms and texts.
- **The tooltip for a zoom placed off a clip** called a motion scene a card. It names it now.
- **The skill test** took the docs' CSS variables (`--cuttle-accent`) for CLI options, and did not know a command with subcommands (`motion check`).
- **WebGL2** draws in the pages, with transparency (checked by hand with a turning triangle). Three.js comes with the kit in P5-M1b.

**Spec points that move**
- **Transitions move to P5-M1b.** A transition page needs the outgoing and the incoming frame (`cuttle.from`, `cuttle.to`). P5-M1b is where pages first get frames of the take (`cuttle.take.frame`), and both share that pipe.
- **No `<script src="cuttle:motion.js">`:** the runtime is injected before the page's own scripts (the spike's way), so a page needs nothing of Cuttle's.
- **The spike's `__cuttleAdvance(step)`** is `__cuttleDraw(ms)`, the frame's time on the page's clock: a jump forward (a still, a seek) is one draw, and the clock never goes back.
- **The theme:**
  - `cuttle.theme.logo` waits for the brand kit (P5-M2): the project has no logo yet.
  - The theme adds `--cuttle-fg` and `--cuttle-mono`.
  - The fonts the variables name come with the kit in P5-M1b; until then a page gets the system's.
- **A frame may take 5 s** (the spec said 2 s), and loading 30 s: CI machines draw WebGL without a GPU.
- **Golden frames become measured checks.** The check page's shapes are where their time puts them on every frame, to a pixel, and a second run gives the same bytes. The engine's pixel tests check the compositing. Goldens of pages Chromium draws would differ per platform.
- **Rendering ahead:**
  - each showing has its own window, as many at once as show at once (not "two at a time");
  - it draws the next frame while the export uses the current one;
  - its first frame is asked for a second before it shows.
- **In the editor**, a motion scene is a block with its label, page and length, and the player shows the background there. The preview, thumbnails and the Motion lane are P5-M1c, as planned.

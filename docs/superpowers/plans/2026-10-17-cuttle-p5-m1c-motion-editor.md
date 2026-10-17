# Cuttle P5-M1c: Motion in the Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor shows motion as the export draws it, and the person and Claude edit it together:
- the player draws motion scenes and overlays while it scrubs and plays, pixel for pixel as the export;
- a page Claude saves shows at once (live reload);
- overlays get a Motion lane, motion scenes show frames of their page on their blocks;
- the inspector has the params form, the internet switch, motion blur, and what the page threw;
- "+ Motion" adds a template.

**Architecture:**
- **The requests:** which motion frames an output frame needs, and how to ask for each (`motionNeeds`), is one pure function that the export page and the editor's player share.
- **The preview** (`MotionPreview`, in `@cuttle/export`): the main process draws the editor's frames with the export's own pages (`MotionPage`), scaled to the player's size.
  - A page stays open while its item shows; the item being scrubbed gets a spare page loaded beside it, for going back.
  - Frames are kept (a byte budget); a frame the editor already has is not sent again.
  - An item that is being edited (a drag, typing) opens its page once the edits rest.
  - A strip of small frames for each scene's block is drawn by a page of its own.
- **The app's main process** (`EditorMotion`): one preview per editor, started with the first motion frame asked for, and a watch on the project's folder that reloads the pages when a page's files change.
- **The player** draws at once with the nearest frame it has, and again once the exact ones came; while playing it asks ahead by as long as a frame takes.
- **The editor:**
  - a Motion lane, with drag and trim as for captions;
  - frames on the motion scenes' blocks, a red edge on an item whose page cannot draw;
  - the inspector's motion panel;
  - "+ Motion" in the timeline's bar and the command menu.
- **The guide** tells Claude that the person watches its pages in the editor.

**Tech Stack:** TypeScript strict, zod 4, vitest 5, Electron 44.7.2 (offscreen rendering, IPC), React 19, WebGL2.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase5-motion-design.md`. Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p5-m1b-motion-kit.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m1c`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 8.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The finished prototype passed `pnpm test` (787 tests, 66 skipped, in two of four full runs; the others lost the recorder's flaky pause test, as main does now and then), the typecheck, `app:check` (49 tests) and `cli:check` (11). Every screenshot was looked at.

- **One way to ask for motion frames.** `motionNeeds(project, spans, state, screen)` lists the motion frames a frame of the video shows: a scene's by its layer, an overlay's by its showing with the frame's view of the take. The export page and the editor ask with it, so they draw the same. The editor's frames match `cuttle preview`'s pixel for pixel.
- **The editor's frames come from the export's pages,** in the main process, not from an iframe: the clock, the take, the fonts, the sandbox and the compositing are the export's.
  - A page draws at the output's size and its frames are scaled to the player's: the smallest of 1/4, 1/3, 3/8, 1/2, 2/3, 3/4 or all of the output that fills the player on screen. The check draws them at full size.
  - A showing's page stays open; at most three showings, a showing unused for a minute closes.
  - A page only goes forward. The item being scrubbed gets a spare page, loaded while the person looks, so a frame before the page's needs no load.
  - A request still waiting when a newer one comes for the same showing is dropped: scrubbing draws the newest frame.
  - Frames are kept (192 MB), by what draws them: the page, the files' state, the take, the item's init, its view and the size. An edit elsewhere keeps them. The editor says which frame it has (its number); when that is still right, nothing is sent.
  - An item edited again within 150 ms opens no page for the edit before (a trim drag, a param typed).
- **Live reload.** The main process watches the project's folder. A change to a file a page can read (anything but `out/`, `preview/`, `.cuttle/`, `cuttle.json` and its backups, and the take's recordings; the take's events, words and markers count) reloads the pages, drops the frames, and tells the editor, which draws the frame again.
- **The player:**
  - **Seeking** draws at once with the nearest frame it has of each item (the last version's, a neighbouring frame), then again with the exact ones; the video frames of that seek are kept meanwhile.
  - **Playing** shows the newest frame up to the clock for each item and asks for the next ones: two at a time per showing, ahead by as long as a frame of that item takes. A showing that starts within 1.5 s gets its first frame asked for, so its page is open when it shows. A page slower than the clock skips frames, the video does not wait.
  - A pending seek's time survives a new version of the project (an item added, then the playhead moved to it).
- **The timeline:**
  - Overlays get a lane, "Motion", with drag, trim, Alt to copy and the cut-out list, as captions.
  - A motion scene's block shows frames of its page: two a second, 2 to 12, drawn small by a page of their own and kept by the editor.
  - An item whose page cannot draw gets a red edge.
  - Motion has its own colour now (magenta): the violet was the masks'.
- **The inspector's motion panel:**
  - what the page is doing (loading, ready, ready with errors, failed);
  - its label;
  - its page, with Show file and Reload;
  - its place (a scene's length; an overlay's start, length and switch);
  - the params the page declares, each in a field of its kind (text, number with a slider when it has a range, colour, switch, choice, image), Reset back to the page's default, and params the page does not declare as text;
  - the internet switch, motion blur (samples, shutter);
  - the page's errors and console.
- **"+ Motion"** (the timeline's bar, the command menu) copies a template into `motion/<name>/` (`-2` and so on beside a folder of that name) and adds it after the scene under the playhead, or as an overlay on the clip there (over all the clips for one that follows the take). The playhead moves to it. `cuttle motion new` copies with the same code.
- **The IPC:** `motion:project` (the project as shown, numbered), `motion:frame`, `motion:strip`, `motion:params`, `motion:statuses`, `motion:reload`, `motion:add-template`; the events `motion:status` and `motion:changed`. Every request is checked against its schema.
- **Edits:** motion overlays get ids, shift and keep their output length when their clip's speed changes, as zooms and captions do; "what changed" names them.

## File structure

| File | Responsibility |
|---|---|
| `packages/export/src/motion/requests.ts`, `packages/export/src/page/scene-sources.ts` | the motion frames a frame needs, for the export page and the editor |
| `packages/export/src/main/{motion,motion-preview}.ts`, `packages/export/src/index.ts`, `packages/export/package.json` | frames at a size, the editor's preview |
| `packages/motion-kit/src/files.ts`, `apps/cli/src/commands/motion.ts` | copying a template |
| `apps/desktop/src/main/{motion-inputs,motion-service,windows}.ts`, `apps/desktop/src/shared/{ipc,channels}.ts`, `apps/desktop/package.json` | the preview per editor, the watch, the IPC |
| `apps/desktop/src/renderer/editor/{motion,player,session}.ts` | the player's motion frames |
| `apps/desktop/src/shared/{timeline-model,document,edit}.ts`, `apps/desktop/src/renderer/editor/{Timeline,Inspector,actions,commands}.tsx?`, `apps/desktop/src/renderer/{icons.tsx,tokens.css,editor/editor.css}` | the lane, the strips, the panel, "+ Motion" |
| `apps/desktop/test/app.check.test.ts`, `skill/cuttle/motion.md` | the check, the guide |

---

### Task 1: The motion frames a frame needs

**Files:**
- Create: `packages/export/src/motion/requests.ts`, `packages/export/test/motion-requests.test.ts`
- Modify: `packages/export/src/page/scene-sources.ts`, `packages/export/package.json`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m1c`; work there:

```bash
git switch p5-m1c
```

- [ ] **Step 2: Write the failing test**

`packages/export/test/motion-requests.test.ts`:

```ts
import { parseProject } from '@cuttle/project';
import { createTimeline } from '@cuttle/timeline';
import { describe, expect, it } from 'vitest';
import { motionNeeds } from '../src/motion/requests';

const SCREEN = { width: 1280, height: 720 };

function project(input: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

describe('the motion frames a frame of the video needs', () => {
  // a 1 s motion scene, then the take's 0–4 s; the overlay over source 1–3 s is output 2–4 s
  const p = project({
    output: { width: 1920, height: 1080, fps: 30 },
    look: { transition: { enabled: false }, frame: { enabled: false } },
    scenes: [
      { type: 'motion', src: 'motion/intro/index.html', duration: 1 },
      { type: 'clip', from: 0, to: 4 },
    ],
    overlays: [{ src: 'motion/bar/index.html', at: 1, duration: 2 }],
  });
  const timeline = createTimeline(p, { screenSize: SCREEN });
  const needsAt = (t: number) => motionNeeds(p, timeline.spans, timeline.frameAt(t), SCREEN);

  it("asks for a scene's frame by its layer, n / fps seconds into the scene", () => {
    expect(needsAt(0.5)).toEqual([
      { target: { kind: 'scene', layer: 0 }, request: { key: 'scene:0', kind: 'scene', index: 0, frame: 15, start: 0, duration: 1, screen: SCREEN } },
    ]);
  });

  it("asks for an overlay's frame by its showing, with where the take is in the frame", () => {
    const [need, ...rest] = needsAt(2.5);
    expect(rest).toEqual([]);
    expect(need).toMatchObject({ target: { kind: 'overlay', key: '0@2' }, request: { key: 'overlay:0@2', kind: 'overlay', index: 0, frame: 15, start: 2, duration: 2, screen: SCREEN } });
    // without a window frame the take fills the output: the whole screen recording in view
    expect(need!.request.view).toEqual({ source: 1.5, zoom: [0, 0, 1280, 720], content: [0, 0, 1920, 1080], cursor: null });
  });

  it('needs nothing where no motion shows', () => {
    expect(needsAt(1.5)).toEqual([]);
    expect(needsAt(4.5)).toEqual([]);
  });
});
```

Run: `pnpm exec vitest run --project node packages/export/test/motion-requests.test.ts`
Expected: FAIL: `../src/motion/requests` does not exist.

- [ ] **Step 3: The needs, and the export page on them**

`packages/export/src/motion/requests.ts`:

```ts
// Which motion frames an output frame shows, and how to ask for each: the export page and the
// editor's player ask the same way, so they draw the same.
import { clipView } from '@cuttle/engine';
import type { CuttleProject } from '@cuttle/project';
import type { RenderState, SceneFrame, SceneSpan } from '@cuttle/timeline';
import type { MotionFrameRequest } from '../job';
import type { MotionView } from './runtime';

/** A motion frame a render needs: where it goes in the engine's sources, and the request for it. */
export interface MotionNeed {
  /** A scene's frame goes to `FrameSources.motion` by its layer, an overlay's to `overlays` by its showing. */
  target: { kind: 'scene'; layer: number } | { kind: 'overlay'; key: string };
  request: MotionFrameRequest;
}

/** Where a clip layer shows the take, for the overlays over it. `screen` is the screen recording's size. */
export function overlayView(project: Pick<CuttleProject, 'output' | 'look'>, layer: SceneFrame, screen: { width: number; height: number }): MotionView {
  const { zoom, content } = clipView(project.output, project.look, layer, screen);
  return { source: layer.sourceTime ?? null, zoom, content, cursor: layer.cursor ? { x: layer.cursor.x, y: layer.cursor.y } : null };
}

/** Every motion frame `state` shows: its scenes' and its overlays', in the order they are drawn. */
export function motionNeeds(project: CuttleProject, spans: readonly SceneSpan[], state: RenderState, screen: { width: number; height: number }): MotionNeed[] {
  const fps = project.output.fps;
  const needs: MotionNeed[] = [];
  for (const layer of state.layers) {
    const scene = project.scenes[layer.sceneIndex];
    if (scene?.type === 'motion') {
      needs.push({
        target: { kind: 'scene', layer: layer.index },
        request: {
          key: `scene:${layer.sceneIndex}`,
          kind: 'scene',
          index: layer.sceneIndex,
          frame: Math.round(layer.local * fps),
          start: spans[layer.index]?.start ?? 0,
          duration: scene.duration,
          screen,
        },
      });
    }
    if (layer.overlays.length === 0) continue;
    const view = overlayView(project, layer, screen);
    for (const overlay of layer.overlays) {
      needs.push({
        target: { kind: 'overlay', key: overlay.key },
        request: { key: `overlay:${overlay.key}`, kind: 'overlay', index: overlay.index, frame: Math.round(overlay.local * fps), start: overlay.start, duration: overlay.duration, screen, view },
      });
    }
  }
  return needs;
}
```

In `packages/export/src/page/scene-sources.ts`, replace:

```ts
import { clipView, type FrameSources } from '@cuttle/engine';
import type { CuttleProject } from '@cuttle/project';
import type { RenderState, SceneFrame, SceneSpan } from '@cuttle/timeline';
import type { FramePlan, OverlayPlan, ScenePlan } from '../frame-plan';
import type { MotionFrameRequest, MotionPixels } from '../job';
import type { MotionView } from '../motion/runtime';
import { host, PageError } from './host';
import { loadImage } from './images';
```

with:

```ts
import type { FrameSources } from '@cuttle/engine';
import type { CuttleProject } from '@cuttle/project';
import type { RenderState, SceneSpan } from '@cuttle/timeline';
import type { FramePlan, OverlayPlan, ScenePlan } from '../frame-plan';
import type { MotionFrameRequest, MotionPixels } from '../job';
import { motionNeeds, type MotionNeed } from '../motion/requests';
import type { MotionView } from '../motion/runtime';
import { host, PageError } from './host';
import { loadImage } from './images';
```

In the same file, replace:

```ts
  /** Motion overlays' showings, by `ActiveOverlay.key`. */
  private readonly overlays = new Map<string, { plan: OverlayPlan; source: MotionSource }>();
  private readonly pendingOverlays: OverlayPlan[];
  private readonly fps: number;
  /** The last frame of the video (or of the stills). */
  private readonly lastFrame: number;
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };
```

with:

```ts
  /** Motion overlays' showings, by `ActiveOverlay.key`. */
  private readonly overlays = new Map<string, { plan: OverlayPlan; source: MotionSource }>();
  private readonly pendingOverlays: OverlayPlan[];
  /** The last frame of the video (or of the stills). */
  private readonly lastFrame: number;
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };
```

In the same file, replace:

```ts
  ) {
    this.pending = [...plan.scenes];
    this.pendingOverlays = [...plan.overlays].sort((a, b) => a.firstFrame - b.firstFrame);
    this.fps = plan.fps;
    this.lastFrame = Math.max(0, ...plan.scenes.map((scene) => scene.lastFrame));
  }

  /** A clip layer's view of the take, for its overlays: where the take is in the frame. */
  private viewOf(layer: SceneFrame): MotionView {
    const { project } = this.motion;
    const { zoom, content } = clipView(project.output, project.look, layer, this.screenSize);
    return { source: layer.sourceTime ?? null, zoom, content, cursor: layer.cursor ? { x: layer.cursor.x, y: layer.cursor.y } : null };
  }

  /** Each motion item's frame on output frame `frame`, with its view: `each(source, n, view)`. */
  private eachMotion(frame: number, each: (source: MotionSource, n: number, view: MotionView | undefined) => void): void {
    for (const layer of this.motion.stateAt(frame).layers) {
      const scene = this.open.get(layer.sceneIndex)?.motion;
      if (scene) each(scene, Math.round(layer.local * this.fps), undefined);
      for (const overlay of layer.overlays) {
        const open = this.overlays.get(overlay.key);
        if (open) each(open.source, Math.round(overlay.local * this.fps), this.viewOf(layer));
      }
    }
  }
```

with:

```ts
  ) {
    this.pending = [...plan.scenes];
    this.pendingOverlays = [...plan.overlays].sort((a, b) => a.firstFrame - b.firstFrame);
    this.lastFrame = Math.max(0, ...plan.scenes.map((scene) => scene.lastFrame));
  }

  /** The open showing a motion frame comes from. */
  private sourceOf(need: MotionNeed): MotionSource | undefined {
    return need.request.kind === 'scene' ? this.open.get(need.request.index)?.motion : this.overlays.get(need.request.key.slice('overlay:'.length))?.source;
  }

  /** Asks each motion item on output frame `frame` for that frame, ahead of time. */
  private askAhead(frame: number): void {
    for (const need of motionNeeds(this.motion.project, this.motion.spans, this.motion.stateAt(frame), this.screenSize)) {
      this.sourceOf(need)?.ahead(need.request.frame, need.request.view);
    }
  }
```

In the same file, replace:

```ts
      opened.add(plan.firstFrame);
    }
    // a motion item's page opens and draws its first frame while the frames before it are made
    for (const first of opened) if (first > frame) this.eachMotion(first, (source, n, view) => source.ahead(n, view));
    const { screens, webcams, stills, motion, overlays } = this.sources;
    screens.clear();
    webcams.clear();
```

with:

```ts
      opened.add(plan.firstFrame);
    }
    // a motion item's page opens and draws its first frame while the frames before it are made
    for (const first of opened) if (first > frame) this.askAhead(first);
    const { screens, webcams, stills, motion, overlays } = this.sources;
    screens.clear();
    webcams.clear();
```

In the same file, replace:

```ts
        if (webcamFrame) webcams.set(layer.index, webcamFrame);
      } else if (scene.still) {
        stills.set(layer.index, await scene.still);
      } else if (scene.motion) {
        motion.set(layer.index, await scene.motion.frame(Math.round(layer.local * this.fps), undefined));
      }
      for (const overlay of layer.overlays) {
        const open = this.overlays.get(overlay.key);
        if (!open) throw new Error(`overlays[${overlay.index}] shows on frame ${frame}, outside its planned frames`);
        overlays.set(overlay.key, await open.source.frame(Math.round(overlay.local * this.fps), this.viewOf(layer)));
      }
    }
    // the pages draw the next frame while this one is drawn and encoded
    if (this.motion.ahead && frame < this.lastFrame) this.eachMotion(frame + 1, (source, n, view) => source.ahead(n, view));
    return this.sources;
  }
```

with:

```ts
        if (webcamFrame) webcams.set(layer.index, webcamFrame);
      } else if (scene.still) {
        stills.set(layer.index, await scene.still);
      }
    }
    for (const need of motionNeeds(this.motion.project, this.motion.spans, state, this.screenSize)) {
      const source = this.sourceOf(need);
      if (!source) throw new Error(`${need.request.kind === 'scene' ? 'scenes' : 'overlays'}[${need.request.index}] shows on frame ${frame}, outside its planned frames`);
      const pixels = await source.frame(need.request.frame, need.request.view);
      if (need.target.kind === 'scene') motion.set(need.target.layer, pixels);
      else overlays.set(need.target.key, pixels);
    }
    // the pages draw the next frame while this one is drawn and encoded
    if (this.motion.ahead && frame < this.lastFrame) this.askAhead(frame + 1);
    return this.sources;
  }
```

The editor imports it (and the params' types) without the main process's code:

In `packages/export/package.json`, replace:

```json
    ".": "./src/index.ts",
    "./frame-plan": "./src/frame-plan.ts",
    "./track-reader": "./src/page/track-reader.ts",
    "./formats": "./src/formats.ts"
  },
  "dependencies": {
    "@cuttle/engine": "workspace:*",
```

with:

```json
    ".": "./src/index.ts",
    "./frame-plan": "./src/frame-plan.ts",
    "./track-reader": "./src/page/track-reader.ts",
    "./formats": "./src/formats.ts",
    "./motion-requests": "./src/motion/requests.ts",
    "./motion-params": "./src/motion/params.ts"
  },
  "dependencies": {
    "@cuttle/engine": "workspace:*",
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/export`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/export
git commit -m "export: the motion frames a frame needs, one function for the export page and the editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The editor's preview

**Files:**
- Create: `packages/export/src/main/motion-preview.ts`
- Modify: `packages/export/src/main/motion.ts`, `packages/export/src/index.ts`

The preview runs only in Electron: the app check (Task 7) drives it end to end.

- [ ] **Step 1: Frames at a size**

In `packages/export/src/main/motion.ts`, replace:

```ts
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER, withImportMap } from '@cuttle/motion-kit';
import { BrowserWindow, session, type NativeImage, type Session } from 'electron';
import { motionRuntime, type MotionInit, type MotionView } from '../motion/runtime';

export const MOTION_SCHEME = 'cuttle-motion';
```

with:

```ts
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER, withImportMap } from '@cuttle/motion-kit';
import { BrowserWindow, screen, session, type NativeImage, type Session } from 'electron';
import { motionRuntime, type MotionInit, type MotionView } from '../motion/runtime';

export const MOTION_SCHEME = 'cuttle-motion';
```

In the same file, replace:

```ts
/** Longest wait for one frame, and for the page to load (its fonts, images and `cuttle.ready`), in ms. */
export const FRAME_TIMEOUT_MS = 5_000;
export const LOAD_TIMEOUT_MS = 30_000;
/** At most this many console lines are kept per page. */
const MAX_LOG_LINES = 200;
```

with:

```ts
/** Longest wait for one frame, and for the page to load (its fonts, images and `cuttle.ready`), in ms. */
export const FRAME_TIMEOUT_MS = 5_000;
export const LOAD_TIMEOUT_MS = 30_000;
/** A frame whose paint has not come in this long is drawn again (ms). */
const REDRAW_MS = 400;
/** At most this many console lines are kept per page. */
const MAX_LOG_LINES = 200;
```

In the same file, replace:

```ts
  kitDir?: string;
  /** Motion blur: each frame the average of `samples` moments over `shutter` of a frame, centred on it. */
  motionBlur?: { samples: number; shutter: number };
}

/** The motion kit next to the bundle that contains this code (each build copies it there). */
```

with:

```ts
  kitDir?: string;
  /** Motion blur: each frame the average of `samples` moments over `shutter` of a frame, centred on it. */
  motionBlur?: { samples: number; shutter: number };
  /** The size frames come out at (the editor's preview): the page is laid out and drawn at its own size, then scaled. */
  frameSize?: { width: number; height: number };
}

/** The motion kit next to the bundle that contains this code (each build copies it there). */
```

In the same file, replace:

```ts
  private latest: NativeImage | undefined;
  private waiting: (() => void) | undefined;
  private readonly logs: string[] = [];
  private failure: string | undefined;

  private constructor(
```

with:

```ts
  private latest: NativeImage | undefined;
  private waiting: (() => void) | undefined;
  private readonly logs: string[] = [];
  /** Paints so far, and how many of them were empty (to say why a frame never showed). */
  private paints = 0;
  private emptyPaints = 0;
  private failure: string | undefined;

  private constructor(
```

In the same file, replace:

```ts
  ) {
    const contents = win.webContents;
    contents.on('paint', (_event, _dirty, image) => {
      // an invalidate answers at once with an empty paint; the frame comes after it
      if (image.isEmpty()) return;
      this.latest = image;
      this.waiting?.();
    });
```

with:

```ts
  ) {
    const contents = win.webContents;
    contents.on('paint', (_event, _dirty, image) => {
      this.paints++;
      // an invalidate answers at once with an empty paint; the frame comes after it
      if (image.isEmpty()) {
        this.emptyPaints++;
        return;
      }
      this.latest = image;
      this.waiting?.();
    });
```

In the same file, replace:

```ts
  static async open(options: MotionPageOptions): Promise<MotionPage> {
    const { width, height } = options.init;
    const ses = takeSession(options.root, options.network === true, MotionPage.kitOf(options));
    const win = new BrowserWindow({
      show: false,
      // a few rows more than the page: the frame marker sits below it (Electron rounds small heights up)
      width,
      height: height + 4,
```

with:

```ts
  static async open(options: MotionPageOptions): Promise<MotionPage> {
    const { width, height } = options.init;
    const ses = takeSession(options.root, options.network === true, MotionPage.kitOf(options));
    // On the primary display: Windows puts a new window on the display of the window in front, and a
    // display of another scale sizes it a pixel or two off (seen with three displays of three scales).
    const origin = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      show: false,
      x: origin.x,
      y: origin.y,
      // a few rows more than the page: the frame marker sits below it (Electron rounds small heights up)
      width,
      height: height + 4,
```

In the same file, replace:

```ts
    // A new window is kept inside the screen's work area (a 9:16 page is taller than most screens);
    // a resize afterwards is not, and the paint follows the window.
    win.setContentSize(width, height + 4);
    const contents = win.webContents;
    contents.setFrameRate(240);
    contents.setAudioMuted(true);
```

with:

```ts
    // A new window is kept inside the screen's work area (a 9:16 page is taller than most screens);
    // a resize afterwards is not, and the paint follows the window.
    win.setContentSize(width, height + 4);
    // and kept at that size should anything resize it
    let corrections = 0;
    win.on('resize', () => {
      const [w, h] = win.getContentSize();
      if ((w !== width || h !== height + 4) && corrections++ < 3) win.setContentSize(width, height + 4);
    });
    const contents = win.webContents;
    contents.setFrameRate(240);
    contents.setAudioMuted(true);
```

In the same file, replace:

```ts

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

  /**
```

with:

```ts

  /** Whether the latest paint shows draw `draw`: its marker pixel (BGRA), `scale` image pixels a CSS pixel. */
  private shows(draw: number): boolean {
    const marker = this.marker();
    return marker !== undefined && marker[2] === (draw & 255) && marker[1] === ((draw >> 8) & 255) && marker[0] === 200;
  }

  /** The latest paint's marker pixel (BGRA), or undefined when it has none where the marker goes. */
  private marker(): Uint8Array | undefined {
    const image = this.latest;
    if (!image) return undefined;
    const { width, height } = image.getSize();
    const scale = width / this.options.init.width;
    const row = Math.floor((this.options.init.height + 1) * scale);
    if (row >= height || width < 2) return undefined;
    const at = (row * width + Math.floor(scale)) * 4;
    return image.toBitmap().subarray(at, at + 4);
  }

  /** What the page painted, for an error: how often since `since`, and what its last paint shows. */
  private paintReport(since: { paints: number; empty: number }): string {
    const paints = this.paints - since.paints;
    const empty = this.emptyPaints - since.empty;
    const image = this.latest;
    const last = image ? `the last ${image.getSize().width}×${image.getSize().height}` : 'none before';
    const marker = this.marker();
    const shows = marker ? `, its marker ${marker[2]! + 256 * marker[1]!} (blue ${marker[0]})` : image ? ', without the marker' : '';
    const [cw, ch] = this.win.getContentSize();
    return `${paints} paint${paints === 1 ? '' : 's'} since the draw, ${empty} empty; ${last}${shows}; the window ${cw}×${ch}`;
  }

  /**
```

In the same file, replace:

```ts
    else {
      // the moments centred on the frame (never before 0): a frame's last comes before the next frame's first
      const moments = Array.from({ length: blur.samples }, (_, k) => Math.max(0, ((n + ((k + 0.5) / blur.samples - 0.5) * blur.shutter) * 1000) / fps));
      const sum = new Uint32Array(this.options.init.width * this.options.init.height * 4);
      for (const ms of moments) {
        const { data } = await this.paint(ms, view, n);
        for (let i = 0; i < data.length; i++) sum[i] = sum[i]! + data[i]!;
      }
      const data = new Uint8Array(sum.length);
      for (let i = 0; i < sum.length; i++) data[i] = Math.round(sum[i]! / moments.length);
      frame = { width: this.options.init.width, height: this.options.init.height, data };
    }
    this.drawn = n;
    this.last = frame;
```

with:

```ts
    else {
      // the moments centred on the frame (never before 0): a frame's last comes before the next frame's first
      const moments = Array.from({ length: blur.samples }, (_, k) => Math.max(0, ((n + ((k + 0.5) / blur.samples - 0.5) * blur.shutter) * 1000) / fps));
      const { width, height } = this.size;
      const sum = new Uint32Array(width * height * 4);
      for (const ms of moments) {
        const { data } = await this.paint(ms, view, n);
        for (let i = 0; i < data.length; i++) sum[i] = sum[i]! + data[i]!;
      }
      const data = new Uint8Array(sum.length);
      for (let i = 0; i < sum.length; i++) data[i] = Math.round(sum[i]! / moments.length);
      frame = { width, height, data };
    }
    this.drawn = n;
    this.last = frame;
```

In the same file, replace:

```ts
    const { init } = this.options;
    const ms = this.options.frameTimeout ?? FRAME_TIMEOUT_MS;
    const script = `window.__cuttleDraw(${at}${view ? `, ${JSON.stringify(view)}` : ''})`;
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
    return { width: init.width, height: init.height, data: toRgba(new Uint8Array(image.toBitmap())) };
  }

  /** What went wrong in the page so far (uncaught errors and rejections), and its console. */
```

with:

```ts
    const { init } = this.options;
    const ms = this.options.frameTimeout ?? FRAME_TIMEOUT_MS;
    const script = `window.__cuttleDraw(${at}${view ? `, ${JSON.stringify(view)}` : ''})`;
    const drawn = () => this.timed(this.win.webContents.executeJavaScript(script) as Promise<number>, ms, `to draw frame ${n}`);
    let draw = await drawn();
    const deadline = Date.now() + ms;
    const since = { paints: this.paints, empty: this.emptyPaints };
    let asked = false;
    let redrawAt = Date.now() + REDRAW_MS;
    while (!this.shows(draw)) {
      if (this.failure) throw new Error(this.failure);
      if (Date.now() > deadline) throw new Error(`the motion page's frame ${n} was never painted (draw ${draw}: ${this.paintReport(since)})`);
      // Now and then a draw never reaches the paints: they go on showing the page as it was, and
      // asking for a paint repaints that. The same moment drawn again (a new marker) gets through.
      // A page drawn from its time looks the same; one counting its frames sees one more.
      if (Date.now() > redrawAt) {
        draw = await drawn();
        redrawAt = Date.now() + REDRAW_MS;
        asked = false;
        continue;
      }
      const painted = new Promise<void>((done) => (this.waiting = done));
      if (!asked) this.win.webContents.invalidate();
      asked = true;
      await Promise.race([painted, pause(50)]);
      this.waiting = undefined;
    }
    const { width } = this.latest!.getSize();
    const size = this.size;
    // the page without the marker rows below it, at a display scale the override did not reach too
    let image = this.latest!.crop({ x: 0, y: 0, width, height: Math.round((init.height * width) / init.width) });
    // brought to its size (drawn larger), or to a preview's
    if (width !== size.width) image = image.resize({ width: size.width, height: size.height, quality: this.options.frameSize ? 'good' : 'best' });
    return { width: size.width, height: size.height, data: toRgba(new Uint8Array(image.toBitmap())) };
  }

  /** The size frames come out at. */
  private get size(): { width: number; height: number } {
    return this.options.frameSize ?? { width: this.options.init.width, height: this.options.init.height };
  }

  /** What went wrong in the page so far (uncaught errors and rejections), and its console. */
```

- [ ] **Step 2: The preview**

`packages/export/src/main/motion-preview.ts`:

```ts
// The editor's motion: frames of the motion scenes and overlays of the project as the editor shows
// it, drawn by the same pages as the export (`MotionPage`, the same init and the same view of the
// take), scaled to the preview's size. A page stays open while the editor shows its item, and the
// item being scrubbed gets a spare page loaded beside it, so going back (a page only goes forward)
// does not wait for a load. Frames are kept, the least recently used dropped first. A change to the
// project's files reloads the pages: Claude edits a page, the editor shows it.
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { KIT_FONTS } from '@cuttle/motion-kit';
import { parseProject, type CuttleProject, type MotionOverlay, type MotionScene } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import type { MotionFrameRequest, MotionPixels } from '../job';
import { motionInit } from '../motion/init';
import { declaredParams, paramDefaults, type ParamDeclaration } from '../motion/params';
import type { TakeData } from '../motion/runtime';
import { takeData, type TakeInputs } from '../motion/take';
import { MotionPage, type MotionPageOptions } from './motion';
import { motionTake } from './sources';

/** What an item's page is doing in the preview, and what it said. */
export interface MotionStatus {
  /** `scenes[2]` or `overlays[0]`. */
  item: string;
  /** The page, as the item names it. */
  src: string;
  /** `loading` while its page opens, `ready` once it drew, `failed` when it could not load or draw. */
  state: 'loading' | 'ready' | 'failed';
  /** Why it failed, said for people. */
  failure?: string;
  /** What the page threw, and its console (the newest page's). */
  errors: string[];
  console: string[];
}

export interface MotionPreviewOptions extends Pick<MotionPageOptions, 'kitDir' | 'frameTimeout' | 'loadTimeout'> {
  /** Items shown at once whose pages stay open (the least recently shown closes first). */
  maxShowings?: number;
  /** Bytes of frames kept. */
  cacheBytes?: number;
  /** A showing nobody asked for in this long closes (ms). */
  idleMs?: number;
  /** The statuses changed. */
  onStatus?: (statuses: MotionStatus[]) => void;
}

/** How a frame is asked for: `seek` while paused (the item gets a spare page for going back), `play` while playing. */
export type PreviewMode = 'seek' | 'play';

const DEFAULT_MAX_SHOWINGS = 3;
const DEFAULT_CACHE_BYTES = 192 * 1024 * 1024;
const DEFAULT_IDLE_MS = 60_000;
/** A spare page not needed for this long closes: scrubbing is over (ms). */
const SPARE_IDLE_MS = 15_000;
/** The preview waits less for a page than the export: a page that hangs shows as failed sooner. */
const PREVIEW_LOAD_TIMEOUT_MS = 15_000;
/** An item edited again within this long opens no page for the edit before (ms). */
const SETTLE_MS = 150;

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface Waiting {
  request: MotionFrameRequest;
  mode: PreviewMode;
  cacheKey: string;
  resolve: (frame: MotionPixels | null) => void;
  reject: (error: Error) => void;
}

interface Showing {
  key: string;
  identity: string;
  item: string;
  file: string;
  options: MotionPageOptions;
  page?: Promise<MotionPage>;
  /** A second page loaded beside it, for a frame before the page's. */
  spare?: Promise<MotionPage>;
  busy: boolean;
  /** The frame being drawn: the pages close after it. */
  drawing?: Promise<unknown>;
  waiting?: Waiting;
  used: number;
  /** Why its page could not load or draw: asked again, it fails the same until the files change. */
  failure?: string;
  /** A report is due (after a frame). */
  reportTimer?: ReturnType<typeof setTimeout>;
}

/** A version of the project, read once a frame of it is asked for. */
interface Version {
  number: number;
  raw: Record<string, unknown>;
  project?: CuttleProject;
}

/** Frames by key, the least recently used dropped once they pass a size. */
class FrameCache {
  private readonly frames = new Map<string, MotionPixels>();
  private bytes = 0;

  constructor(private readonly limit: number) {}

  get(key: string): MotionPixels | undefined {
    const frame = this.frames.get(key);
    if (!frame) return undefined;
    this.frames.delete(key);
    this.frames.set(key, frame);
    return frame;
  }

  set(key: string, frame: MotionPixels): void {
    if (frame.data.byteLength > this.limit) return;
    const old = this.frames.get(key);
    if (old) this.bytes -= old.data.byteLength;
    this.frames.delete(key);
    this.frames.set(key, frame);
    this.bytes += frame.data.byteLength;
    for (const [oldest, dropped] of this.frames) {
      if (this.bytes <= this.limit) break;
      this.frames.delete(oldest);
      this.bytes -= dropped.data.byteLength;
    }
  }

  clear(): void {
    this.frames.clear();
    this.bytes = 0;
  }
}

/** Whether `path` lies inside `base` (both absolute). */
function inside(base: string, path: string): boolean {
  const rel = relative(base, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class MotionPreview {
  private version: Version | undefined;
  /** Counts the changes to the project's files: a page of an older count is reloaded. */
  private files = 0;
  private takeInputs: { key: string; inputs: Promise<TakeInputs> } | undefined;
  /**
   * The take as pages see it, for the parts of the project it is made from (`key`), numbered: a take
   * that comes out the same keeps its number, and the pages keep theirs.
   */
  private takeSeen: { key: string; text: string; data: TakeData | null; id: number } | undefined;
  private readonly declared = new Map<string, Promise<{ params: ParamDeclaration[]; issues: string[] }>>();
  private readonly showings = new Map<string, Showing>();
  private readonly cache: FrameCache;
  private readonly identities = new Map<string, number>();
  private lastIdentity = 0;
  /** A showing whose item was just edited opens its page from then on (ms since the epoch). */
  private readonly settleUntil = new Map<string, number>();
  /** The timeline's strips, drawn one after the other; the newest asked for each item. */
  private strips: Promise<unknown> = Promise.resolve();
  private readonly stripTokens = new Map<string, number>();
  private readonly statuses = new Map<string, MotionStatus>();
  private readonly idle: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    private readonly projectDir: string,
    private readonly options: MotionPreviewOptions = {},
  ) {
    this.cache = new FrameCache(options.cacheBytes ?? DEFAULT_CACHE_BYTES);
    const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.idle = setInterval(() => {
      const now = Date.now();
      for (const showing of this.showings.values()) {
        if (showing.busy) continue;
        if (now - showing.used > idleMs) this.retire(showing);
        else if (showing.spare && now - showing.used > Math.min(SPARE_IDLE_MS, idleMs)) {
          const spare = showing.spare;
          showing.spare = undefined;
          void spare.then(
            (page) => page.close(),
            () => {},
          );
        }
      }
    }, Math.min(5_000, idleMs));
    this.idle.unref?.();
  }

  /** The project as the editor shows it now (`raw`: a project as `parseProject` reads it); frames are asked for by its number. */
  setProject(number: number, raw: Record<string, unknown>): void {
    this.version = { number, raw };
  }

  /** The version `number`, read (once), or undefined when it is not the newest or does not read. */
  private current(number: number): Version | undefined {
    const version = this.version;
    if (!version || version.number !== number) return undefined;
    if (!version.project) {
      const parsed = parseProject(version.raw);
      if (!parsed.ok) throw new Error(`the project does not read: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
      version.project = parsed.project;
    }
    return version;
  }

  /** The project's files changed: every page loads again (with the page's new params), and the frames drawn before are dropped. */
  filesChanged(): void {
    this.files++;
    this.declared.clear();
    this.takeInputs = undefined;
    this.cache.clear();
    for (const showing of this.showings.values()) showing.failure = undefined;
  }

  /** Loads the pages of one item again (its spare too), as after a change to its files. */
  reload(item: string): void {
    for (const showing of this.showings.values()) if (showing.item === item) this.retire(showing);
    this.files++;
    this.cache.clear();
  }

  /** The params a page declares (read again after its files change), and what is wrong with the declaration. */
  params(src: string): Promise<{ params: ParamDeclaration[]; issues: string[] }> {
    return this.declaration(this.pageFile(src, 'the page'));
  }

  private declaration(file: string): Promise<{ params: ParamDeclaration[]; issues: string[] }> {
    let declared = this.declared.get(file);
    if (!declared) {
      declared = readFile(file, 'utf8').then(
        (html) => declaredParams(html),
        (error: NodeJS.ErrnoException) => ({ params: [], issues: [error.code === 'ENOENT' ? 'the page is missing' : describe(error)] }),
      );
      this.declared.set(file, declared);
    }
    return declared;
  }

  /** A page's path, checked: a file inside the project folder (the only files a page reaches). */
  private pageFile(src: string, name: string): string {
    const root = resolve(this.projectDir);
    const file = resolve(root, src);
    if (!inside(root, file)) throw new Error(`${name} must be a file in the project folder, not ${src}`);
    return file;
  }

  /**
   * The take as the pages see it (its files are read once until they change). It is made again only
   * when what it is made from changed: an edit elsewhere (a caption dragged) costs nothing.
   */
  private async take(project: CuttleProject, screen: { width: number; height: number }): Promise<{ data: TakeData | null; id: number }> {
    const files = JSON.stringify([project.sources.events, project.sources.transcript, project.sources.markers]);
    if (this.takeInputs?.key !== files) this.takeInputs = { key: files, inputs: motionTake(this.projectDir, project) };
    const inputs = this.takeInputs.inputs;
    const clips = sceneSpans(project.scenes, project.cuts).flatMap((span) => (span.scene.type === 'clip' ? [[span.start, span.end, span.scene.from, span.scene.to, span.scene.speed]] : []));
    const { zooms, masks, captions, look } = project;
    const key = JSON.stringify([files, this.files, screen, clips, zooms, masks, captions.fixes, look.cursor.smoothing]);
    const seen = this.takeSeen;
    if (seen?.key === key) return seen;
    // a video without clips shows nothing of a take
    const data = clips.length > 0 ? takeData(project, await inputs, screen, null) : null;
    // another request made it meanwhile
    if (this.takeSeen !== seen) return this.take(project, screen);
    const text = JSON.stringify(data);
    this.takeSeen = { key, text, data, id: seen && seen.text === text ? seen.id : (seen?.id ?? 0) + 1 };
    return this.takeSeen;
  }

  /** The page options of a request's showing, and its identity: the same identity draws the same frames. */
  private async describeShowing(version: Version, request: MotionFrameRequest, size: { width: number; height: number }) {
    const project = version.project!;
    const name = `${request.kind === 'scene' ? 'scenes' : 'overlays'}[${request.index}]`;
    const item = request.kind === 'scene' ? project.scenes[request.index] : project.overlays[request.index];
    if (!item || ('type' in item && item.type !== 'motion')) throw new Error(`${name} is not a motion item`);
    const motion = item as MotionScene | MotionOverlay;
    const file = this.pageFile(motion.src, `${name}.src`);
    const [declared, take] = await Promise.all([this.declaration(file), this.take(project, request.screen)]);
    const window = 'type' in motion ? null : { from: motion.at, to: motion.at + motion.duration };
    const init = motionInit(project, motion, name, { start: request.start, duration: request.duration }, {
      take: take.data && { ...take.data, window },
      fonts: [...KIT_FONTS],
      defaults: paramDefaults(declared.params),
    });
    const { take: _take, ...rest } = init;
    const identity = JSON.stringify([file, this.files, take.id, window, motion.network, motion.motionBlur ?? null, size, rest]);
    const options: MotionPageOptions = {
      file,
      root: resolve(this.projectDir),
      init,
      network: motion.network,
      ...(motion.motionBlur && { motionBlur: motion.motionBlur }),
      ...((size.width !== init.width || size.height !== init.height) && { frameSize: size }),
      ...(this.options.kitDir && { kitDir: this.options.kitDir }),
      ...(this.options.frameTimeout && { frameTimeout: this.options.frameTimeout }),
      loadTimeout: this.options.loadTimeout ?? PREVIEW_LOAD_TIMEOUT_MS,
    };
    return { name, src: motion.src, file, identity, options, issues: declared.issues };
  }

  /** A number for each identity, never used twice (a caller keeps it to ask whether its frame is still right). */
  private identityId(identity: string): number {
    let id = this.identities.get(identity);
    if (id === undefined) {
      // a long session makes many: the old ones are forgotten, with their frames
      if (this.identities.size >= 2000) {
        this.identities.clear();
        this.cache.clear();
      }
      id = ++this.lastIdentity;
      this.identities.set(identity, id);
    }
    return id;
  }

  /**
   * The frame a request of version `number` asks for, at `size` (at most the output's), and the number
   * of what draws it: frames of one number are the same. `have`: the number of the caller's own copy of
   * this frame (and view); when it is still right the answer has no pixels. Null when the request is no
   * longer wanted: an older version, or a newer request for the same showing came first.
   */
  async frame(
    number: number,
    request: MotionFrameRequest,
    size: { width: number; height: number },
    options: { mode?: PreviewMode; have?: number } = {},
  ): Promise<{ id: number; pixels?: MotionPixels } | null> {
    if (this.closed) return null;
    const version = this.current(number);
    if (!version) return null;
    const shown = await this.describeShowing(version, request, size);
    if (this.version !== version || this.closed) return null;
    const id = this.identityId(shown.identity);
    let showing = this.showings.get(request.key);
    if (showing && showing.identity !== shown.identity) {
      this.retire(showing);
      showing = undefined;
      // an edit in progress (a drag, typing) makes a new page each time: it opens once the edits rest
      this.settleUntil.set(request.key, Date.now() + SETTLE_MS);
    }
    if (options.have === id) {
      if (showing) showing.used = Date.now();
      return { id };
    }
    const cacheKey = `${id}|${request.frame}|${request.view ? JSON.stringify(request.view) : ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (showing) showing.used = Date.now();
      return { id, pixels: cached };
    }
    if (!showing) {
      this.makeRoom();
      showing = { key: request.key, identity: shown.identity, item: shown.name, file: shown.file, options: shown.options, busy: false, used: Date.now() };
      this.showings.set(request.key, showing);
      this.setStatus(shown.name, { item: shown.name, src: shown.src, state: 'loading', errors: [...shown.issues], console: [] });
    }
    showing.used = Date.now();
    if (showing.failure) throw new Error(showing.failure);
    const target = showing;
    const pixels = await new Promise<MotionPixels | null>((resolve, reject) => {
      // a request still waiting is no longer wanted: the newest one is drawn next
      target.waiting?.resolve(null);
      target.waiting = { request, mode: options.mode ?? 'seek', cacheKey, resolve, reject };
      if (!target.busy) void this.pump(target);
    });
    return pixels && { id, pixels };
  }

  /**
   * Frames across an item for its block on the timeline (`frames`, ascending), at `size`: drawn by a
   * page of their own, one strip after the other, and kept with the other frames. `have`: the number
   * of the caller's strip; when it is still right the answer has no pixels. Null when it is no longer
   * wanted (an older version, a newer strip for the same item).
   */
  async strip(
    number: number,
    request: MotionFrameRequest,
    frames: readonly number[],
    size: { width: number; height: number },
    have?: number,
  ): Promise<{ id: number; frames?: MotionPixels[] } | null> {
    if (this.closed) return null;
    const version = this.current(number);
    if (!version) return null;
    const shown = await this.describeShowing(version, request, size);
    if (this.version !== version || this.closed) return null;
    const id = this.identityId(shown.identity);
    if (have === id) return { id };
    const cacheKey = (frame: number) => `${id}|${frame}|`;
    const cached = frames.map((frame) => this.cache.get(cacheKey(frame)));
    if (cached.every((frame) => frame !== undefined)) return { id, frames: cached as MotionPixels[] };
    const token = (this.stripTokens.get(request.key) ?? 0) + 1;
    this.stripTokens.set(request.key, token);
    const wanted = () => this.stripTokens.get(request.key) === token && !this.closed;
    const job = this.strips.then(async (): Promise<{ id: number; frames?: MotionPixels[] } | null> => {
      if (!wanted()) return null;
      const page = await MotionPage.open(shown.options);
      try {
        const drawn = new Map<number, MotionPixels>();
        for (const frame of [...frames].sort((a, b) => a - b)) {
          if (!wanted()) return null;
          const pixels = await page.frame(frame);
          this.cache.set(cacheKey(frame), pixels);
          drawn.set(frame, pixels);
        }
        return { id, frames: frames.map((frame) => drawn.get(frame)!) };
      } finally {
        page.close();
      }
    });
    this.strips = job.catch(() => null);
    return job;
  }

  /** Draws the showing's waiting requests, one at a time. */
  private async pump(showing: Showing): Promise<void> {
    showing.busy = true;
    const live = () => this.showings.get(showing.key) === showing;
    try {
      while (showing.waiting) {
        const { request, mode, cacheKey, resolve, reject } = showing.waiting;
        showing.waiting = undefined;
        const settle = (this.settleUntil.get(showing.key) ?? 0) - Date.now();
        if (settle > 0 && !showing.page) {
          await pause(settle);
          // edited again meanwhile, or asked for another frame: that one is drawn
          if (!live() || showing.waiting) {
            resolve(null);
            continue;
          }
        }
        if (!live()) {
          resolve(null);
          continue;
        }
        const drawing = (async () => {
          const page = await this.pageFor(showing, request.frame);
          return page.frame(request.frame, request.view);
        })();
        showing.drawing = drawing.catch(() => {});
        try {
          const frame = await drawing;
          this.cache.set(cacheKey, frame);
          if (!live()) {
            resolve(frame);
            continue;
          }
          this.ready(showing);
          resolve(frame);
          // the item being scrubbed gets a spare page for going back
          if (mode === 'seek' && !showing.spare) showing.spare = this.openPage(showing);
        } catch (error) {
          // a showing put away meanwhile (its pages closed under it) is no failure of the page
          if (!live()) {
            resolve(null);
            continue;
          }
          const message = describe(error);
          showing.failure = message;
          this.fail(showing, message);
          reject(new Error(`${showing.item} (${relative(this.projectDir, showing.file).split(sep).join('/')}): ${message}`));
        }
      }
    } finally {
      showing.busy = false;
      showing.drawing = undefined;
    }
  }

  /** The page that draws frame `frame` next: the open one, else its spare (going back), else a new one. */
  private async pageFor(showing: Showing, frame: number): Promise<MotionPage> {
    const open = showing.page ? await showing.page.catch(() => undefined) : undefined;
    if (open && frame >= open.position) return open;
    if (open) {
      void this.collect(showing, open).then(() => open.close());
      showing.page = undefined;
    }
    if (showing.spare) {
      showing.page = showing.spare;
      showing.spare = undefined;
    } else showing.page = this.openPage(showing);
    return showing.page;
  }

  private openPage(showing: Showing): Promise<MotionPage> {
    const page = MotionPage.open(showing.options);
    page.catch(() => {}); // awaited where it is used
    return page;
  }

  /** Room for one more showing: the least recently shown one closes. */
  private makeRoom(): void {
    const max = this.options.maxShowings ?? DEFAULT_MAX_SHOWINGS;
    const open = [...this.showings.values()].sort((a, b) => a.used - b.used);
    while (open.length >= max) {
      const oldest = open.find((showing) => !showing.busy) ?? open[0]!;
      open.splice(open.indexOf(oldest), 1);
      this.retire(oldest);
    }
  }

  /** The showing is over: its pages close (what the open one said is kept), a request waiting gets null. */
  private retire(showing: Showing): void {
    if (this.showings.get(showing.key) === showing) this.showings.delete(showing.key);
    showing.waiting?.resolve(null);
    showing.waiting = undefined;
    clearTimeout(showing.reportTimer);
    const page = showing.page;
    const spare = showing.spare;
    showing.page = showing.spare = undefined;
    // after the frame being drawn
    const after = showing.drawing ?? Promise.resolve();
    void after.then(() =>
      page?.then(
        async (open) => {
          await this.collect(showing, open);
          open.close();
        },
        () => {},
      ),
    );
    void spare?.then(
      (open) => open.close(),
      () => {},
    );
  }

  private ready(showing: Showing): void {
    const status = this.statuses.get(showing.item);
    if (status && status.state !== 'ready') this.setStatus(showing.item, { ...status, state: 'ready', failure: undefined });
    // what the page said, a moment after it drew (not after every frame)
    if (!showing.reportTimer) {
      showing.reportTimer = setTimeout(() => {
        showing.reportTimer = undefined;
        void showing.page?.then((page) => this.collect(showing, page)).catch(() => {});
      }, 400);
    }
  }

  private fail(showing: Showing, message: string): void {
    const status = this.statuses.get(showing.item);
    if (status) this.setStatus(showing.item, { ...status, state: 'failed', failure: message });
  }

  /** What a page said so far, into its item's status. */
  private async collect(showing: Showing, page: MotionPage): Promise<void> {
    const said = await page.report().catch(() => undefined);
    const status = this.statuses.get(showing.item);
    if (!said || !status || this.closed) return;
    const errors = [...new Set([...status.errors, ...said.errors])];
    const lines = said.console;
    if (errors.length === status.errors.length && lines.length === status.console.length && lines.every((line, i) => line === status.console[i])) return;
    this.setStatus(showing.item, { ...status, errors, console: lines });
  }

  private setStatus(item: string, status: MotionStatus): void {
    this.statuses.set(item, status);
    this.options.onStatus?.(this.currentStatuses());
  }

  /** What each item's page is doing and said, in the order they first showed. */
  currentStatuses(): MotionStatus[] {
    return [...this.statuses.values()];
  }

  /** Closes every page. */
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.idle);
    const showings = [...this.showings.values()];
    for (const showing of showings) this.retire(showing);
    this.cache.clear();
  }
}
```

In `packages/export/src/index.ts`, replace:

```ts
export { renderStills, stillName, type StillsOptions, type StillsResult } from './main/stills';
export { MOTION_SCHEME_PRIVILEGES } from './main/motion';
export type { MotionItemReport } from './main/motion-host';
```

with:

```ts
export { renderStills, stillName, type StillsOptions, type StillsResult } from './main/stills';
export { MOTION_SCHEME_PRIVILEGES } from './main/motion';
export type { MotionItemReport } from './main/motion-host';
export { MotionPreview, type MotionPreviewOptions, type MotionStatus, type PreviewMode } from './main/motion-preview';
export type { MotionFrameRequest, MotionPixels } from './job';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc -p packages/export/tsconfig.node.json`
Expected: exits with code 0.

- [ ] **Step 4: Commit**

```bash
git add packages/export
git commit -m "export: the editor's motion preview: the export's pages at the player's size, a spare page for going back, kept frames, strips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Copying a template

**Files:**
- Modify: `packages/motion-kit/src/files.ts`, `packages/motion-kit/test/kit.test.ts`, `apps/cli/src/commands/motion.ts`

- [ ] **Step 1: Write the failing test**

In `packages/motion-kit/test/kit.test.ts`, replace:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KIT_FONTS, KIT_IMPORTS, KIT_ORIGIN, MOTION_TEMPLATES, importMapTag, withImportMap } from '../src/index';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
```

with:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copyTemplate, MissingTemplateError } from '../src/files';
import { KIT_FONTS, KIT_IMPORTS, KIT_ORIGIN, MOTION_TEMPLATES, importMapTag, withImportMap } from '../src/index';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
```

In the same file, replace:

```ts
      expect(template.whole === true || template.duration > 0, template.name).toBe(true);
    }
  });
});
```

with:

```ts
      expect(template.whole === true || template.duration > 0, template.name).toBe(true);
    }
  });

  it('copies a template into the project, beside a folder of its name already there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-kit-'));
    try {
      // no kit next to this file: the package's own templates
      expect(await copyTemplate(dir, 'title', 'title', import.meta.url)).toBe('motion/title/index.html');
      expect(await copyTemplate(dir, 'title', 'title', import.meta.url)).toBe('motion/title-2/index.html');
      expect(readFileSync(join(dir, 'motion', 'title-2', 'index.html'), 'utf8')).toBe(readFileSync(`${TEMPLATES}title/index.html`, 'utf8'));
      await expect(copyTemplate(dir, 'nope', 'nope', import.meta.url)).rejects.toThrow(MissingTemplateError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

Run: `pnpm exec vitest run --project node packages/motion-kit`
Expected: FAIL: `copyTemplate` is not exported.

- [ ] **Step 2: The copy, and `motion new` on it**

In `packages/motion-kit/src/files.ts`, replace:

```ts
// Where the kit's files are on disk (Node only).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER } from './index';
```

with:

```ts
// Where the kit's files are on disk (Node only).
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER } from './index';
```

In the same file, replace:

```ts
  const built = fileURLToPath(new URL(`./${KIT_FOLDER}/templates/`, bundleUrl));
  return existsSync(built) ? built : SOURCE_TEMPLATES;
}
```

with:

```ts
  const built = fileURLToPath(new URL(`./${KIT_FOLDER}/templates/`, bundleUrl));
  return existsSync(built) ? built : SOURCE_TEMPLATES;
}

/** The template's folder is not in the kit (a build without it). */
export class MissingTemplateError extends Error {}

const isFolder = (path: string) => stat(path).then((info) => info.isDirectory(), () => false);

/** A folder's files into another, folder by folder (reads and writes only: the kit may sit in the app's archive). */
async function copyFolder(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory()) await copyFolder(join(from, entry.name), join(to, entry.name));
    else if (entry.isFile()) await writeFile(join(to, entry.name), await readFile(join(from, entry.name)));
  }
}

/**
 * Copies a template of the kit next to a bundle (`bundleUrl`) into the project's `motion/<name>/`,
 * or `motion/<name>-2/` and so on when that folder is taken. Answers the page's path in the project
 * (`motion/<folder>/index.html`).
 */
export async function copyTemplate(projectDir: string, template: string, name: string, bundleUrl: string): Promise<string> {
  const from = join(templatesFolder(bundleUrl), template);
  if (!(await isFolder(from))) throw new MissingTemplateError(`the template ${template} is missing from the motion kit (${from})`);
  let folder = name;
  for (let n = 2; await stat(join(projectDir, 'motion', folder)).then(() => true, () => false); n++) folder = `${name}-${n}`;
  await copyFolder(from, join(projectDir, 'motion', folder));
  return `motion/${folder}/index.html`;
}
```

In `apps/cli/src/commands/motion.ts`, replace:

```ts
import { cp, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { MOTION_TEMPLATES, type MotionTemplate } from '@cuttle/motion-kit';
import { templatesFolder } from '@cuttle/motion-kit/files';
import { newId, usedIds, type MotionScene } from '@cuttle/project';
import { occurrences, sceneSpans } from '@cuttle/timeline';
import { CliError } from '../errors';
```

with:

```ts
import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { MOTION_TEMPLATES, type MotionTemplate } from '@cuttle/motion-kit';
import { copyTemplate, MissingTemplateError } from '@cuttle/motion-kit/files';
import { newId, usedIds, type MotionScene } from '@cuttle/project';
import { occurrences, sceneSpans } from '@cuttle/timeline';
import { CliError } from '../errors';
```

In the same file, replace:

```ts
  const clips = file.project.scenes.filter((scene) => scene.type === 'clip');
  if (info.kind === 'overlay' && clips.length === 0) throw new CliError('invalid-project', `${file.path} has no clips: an overlay goes over a clip`);
  // a folder of its own, beside any page there already
  let folder = name;
  for (let n = 2; await stat(join(file.dir, 'motion', folder)).then(() => true, () => false); n++) folder = `${name}-${n}`;
  const from = join(templatesFolder(import.meta.url), template);
  if (!(await stat(from).then((info) => info.isDirectory(), () => false))) throw new CliError('missing-file', `the template ${template} is missing from the motion kit (${from}): build the CLI again`);
  await cp(from, join(file.dir, 'motion', folder), { recursive: true });
  const src = `motion/${folder}/index.html`;
  const taken = usedIds(file.project);
  let item: Record<string, unknown>;
  if (info.kind === 'scene') {
```

with:

```ts
  const clips = file.project.scenes.filter((scene) => scene.type === 'clip');
  if (info.kind === 'overlay' && clips.length === 0) throw new CliError('invalid-project', `${file.path} has no clips: an overlay goes over a clip`);
  // a folder of its own, beside any page there already
  let src: string;
  try {
    src = await copyTemplate(file.dir, template, name, import.meta.url);
  } catch (error) {
    if (error instanceof MissingTemplateError) throw new CliError('missing-file', `${error.message}: build the CLI again`);
    throw error;
  }
  const folder = src.split('/')[1]!;
  const taken = usedIds(file.project);
  let item: Record<string, unknown>;
  if (info.kind === 'scene') {
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/motion-kit apps/cli/test/motion.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/motion-kit apps/cli/src/commands/motion.ts
git commit -m "motion-kit: copy a template into a project (reads and writes only: the app's kit sits in its archive)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The preview in the app's main process

**Files:**
- Create: `apps/desktop/src/main/motion-inputs.ts`, `apps/desktop/src/main/motion-service.ts`, `apps/desktop/test/motion-inputs.test.ts`
- Modify: `apps/desktop/src/shared/{ipc,channels}.ts`, `apps/desktop/src/main/windows.ts`, `apps/desktop/test/contract.test.ts`, `apps/desktop/package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: The kit for the app**

In `apps/desktop/package.json`, replace:

```json
    "@cuttle/core": "workspace:*",
    "@cuttle/engine": "workspace:*",
    "@cuttle/export": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/recorder": "workspace:*",
    "@cuttle/timeline": "workspace:*",
```

with:

```json
    "@cuttle/core": "workspace:*",
    "@cuttle/engine": "workspace:*",
    "@cuttle/export": "workspace:*",
    "@cuttle/motion-kit": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/recorder": "workspace:*",
    "@cuttle/timeline": "workspace:*",
```

```bash
pnpm install
```

- [ ] **Step 2: Write the failing tests**

`apps/desktop/test/motion-inputs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pageInput } from '../src/main/motion-inputs';

describe('the changes a motion page can see', () => {
  it('counts its files and assets anywhere in the project, and the take\'s events, words and markers', () => {
    expect(pageInput('motion/title/index.html')).toBe(true);
    expect(pageInput('motion\\title\\index.html')).toBe(true);
    expect(pageInput('assets/logo.png')).toBe(true);
    expect(pageInput('takes/1/events.jsonl')).toBe(true);
    expect(pageInput('takes/1/transcript.json')).toBe(true);
  });

  it('leaves out the recordings, cuttle.json and what the app and the CLI write', () => {
    expect(pageInput('takes/1/screen.mp4')).toBe(false);
    expect(pageInput('cuttle.json')).toBe(false);
    expect(pageInput('cuttle.json.bak.2')).toBe(false);
    expect(pageInput('out/16x9.mp4')).toBe(false);
    expect(pageInput('preview/motion-title/sheet.png')).toBe(false);
    expect(pageInput('.cuttle/proxy.mp4')).toBe(false);
    expect(pageInput('')).toBe(false);
  });
});
```

In `apps/desktop/test/contract.test.ts`, replace:

```ts
    expect(REQUESTS['settings:set'].safeParse({ privacyWords: Array.from({ length: 51 }, (_, k) => `w${k}`) }).success).toBe(false);
  });

  it('names the speech models as @cuttle/core does (the windows cannot import it)', () => {
    expect(SPEECH_MODEL_NAMES).toEqual(MODEL_NAMES);
  });
```

with:

```ts
    expect(REQUESTS['settings:set'].safeParse({ privacyWords: Array.from({ length: 51 }, (_, k) => `w${k}`) }).success).toBe(false);
  });

  it('checks what the editor asks of its motion preview', () => {
    const request = { key: 'overlay:0@2', kind: 'overlay', index: 0, frame: 15, start: 2, duration: 2, screen: { width: 1280, height: 720 } };
    const view = { source: 1.5, zoom: [0, 0, 1280, 720], content: [0, 0, 1920, 1080], cursor: null };
    expect(REQUESTS['motion:frame'].safeParse({ version: 3, request: { ...request, view }, width: 960, height: 540, mode: 'seek', have: 7 }).success).toBe(true);
    expect(REQUESTS['motion:frame'].safeParse({ version: 3, request, width: 99_999, height: 540, mode: 'seek' }).success).toBe(false);
    expect(REQUESTS['motion:frame'].safeParse({ version: 3, request: { ...request, frame: -1 }, width: 960, height: 540, mode: 'play' }).success).toBe(false);
    expect(REQUESTS['motion:frame'].safeParse({ version: 3, request: { ...request, view: { ...view, zoom: [0, 0] } }, width: 960, height: 540, mode: 'seek' }).success).toBe(false);
    expect(REQUESTS['motion:add-template'].safeParse('lower-third').success).toBe(true);
    expect(REQUESTS['motion:add-template'].safeParse('../../evil').success).toBe(false);
    expect(REQUESTS['motion:reload'].safeParse('scenes[2]').success).toBe(true);
    expect(REQUESTS['motion:reload'].safeParse('zooms[0]').success).toBe(false);
  });

  it('names the speech models as @cuttle/core does (the windows cannot import it)', () => {
    expect(SPEECH_MODEL_NAMES).toEqual(MODEL_NAMES);
  });
```

Run: `pnpm exec vitest run --project node apps/desktop/test/motion-inputs.test.ts apps/desktop/test/contract.test.ts`
Expected: FAIL: `../src/main/motion-inputs` does not exist, and the motion requests are not in the contract.

- [ ] **Step 3: The contract**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
// what a window may send. The main process checks each request against it; the preloads expose only
// their window's channels.
import { z } from 'zod';
import type { LengthReport } from './media-jobs';
import type { PickedTarget, PickerDisplay, PickerWindow, RecordChoices } from './recording';
```

with:

```ts
// what a window may send. The main process checks each request against it; the preloads expose only
// their window's channels.
import { z } from 'zod';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { MOTION_TEMPLATES } from '@cuttle/motion-kit';
import type { LengthReport } from './media-jobs';
import type { PickedTarget, PickerDisplay, PickerWindow, RecordChoices } from './recording';
```

In the same file, replace:

```ts
  version: string;
}

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const deviceName = z.string().min(1).max(512);

/** Requests (window → main), each with the schema of its argument. */
```

with:

```ts
  version: string;
}

/** The params a motion page declares (its `cuttle-params`), and what is wrong with the declaration. */
export interface MotionParams {
  params: ParamDeclaration[];
  issues: string[];
}

/** What a motion item's page is doing in the editor's preview, and what it said (as @cuttle/export's MotionStatus). */
export interface MotionStatusView {
  /** `scenes[2]` or `overlays[0]`. */
  item: string;
  src: string;
  state: 'loading' | 'ready' | 'failed';
  failure?: string;
  errors: string[];
  console: string[];
}

/** A motion frame for the player: the number of what drew it, and its pixels (none when the player's own copy is still right). */
export type MotionFrameAnswer = { id: number; pixels?: { width: number; height: number; data: Uint8Array } } | null;

/** Frames across a motion scene for its block on the timeline (none when the editor's strip is still right). */
export type MotionStripAnswer = { id: number; frames?: { width: number; height: number; data: Uint8Array }[] } | null;

/** The motion templates the editor offers (as @cuttle/motion-kit has them). */
export const MOTION_TEMPLATE_NAMES = MOTION_TEMPLATES.map((template) => template.name) as [string, ...string[]];

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const box = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
/** A motion frame the player asks for (as @cuttle/export's MotionFrameRequest). */
const motionRequest = z.strictObject({
  key: z.string().min(1).max(200),
  kind: z.enum(['scene', 'overlay']),
  index: z.number().int().nonnegative().max(100_000),
  frame: z.number().int().nonnegative().max(100_000_000),
  start: z.number().finite().nonnegative(),
  duration: z.number().finite().positive(),
  screen: z.strictObject({ width: z.number().int().positive().max(32_768), height: z.number().int().positive().max(32_768) }),
  view: z
    .strictObject({
      source: z.number().finite().nullable(),
      zoom: box.nullable(),
      content: box.nullable(),
      cursor: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).nullable(),
    })
    .optional(),
});
const deviceName = z.string().min(1).max(512);

/** Requests (window → main), each with the schema of its argument. */
```

In the same file, replace:

```ts
  'project:read-screen': z.undefined(),
  /** Fits the video to this many seconds where it rests, or takes the fit out (null). */
  'project:fit-length': z.strictObject({ seconds: z.number().positive().max(36_000).nullable() }),
} as const;

export type Request = keyof typeof REQUESTS;
```

with:

```ts
  'project:read-screen': z.undefined(),
  /** Fits the video to this many seconds where it rests, or takes the fit out (null). */
  'project:fit-length': z.strictObject({ seconds: z.number().positive().max(36_000).nullable() }),
  /** The project as the editor shows it now, numbered: motion frames are asked for by that number. */
  'motion:project': z
    .strictObject({ version: z.number().int().nonnegative(), raw: z.record(z.string(), z.unknown()) })
    .refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'the project is too large'),
  /**
   * A frame of a motion item at the player's size: `mode` `seek` while paused, `play` while playing;
   * `have`: the number of the player's own copy of that frame.
   */
  'motion:frame': z.strictObject({
    version: z.number().int().nonnegative(),
    request: motionRequest,
    width: z.number().int().min(8).max(8192),
    height: z.number().int().min(8).max(8192),
    mode: z.enum(['seek', 'play']),
    have: z.number().int().positive().optional(),
  }),
  /** Frames across a motion scene for its block on the timeline, small. */
  'motion:strip': z.strictObject({
    version: z.number().int().nonnegative(),
    request: motionRequest,
    frames: z.array(z.number().int().nonnegative().max(100_000_000)).min(1).max(16),
    width: z.number().int().min(8).max(512),
    height: z.number().int().min(8).max(512),
    have: z.number().int().positive().optional(),
  }),
  /** The params a page declares (a page in the project, as an item's `src`). */
  'motion:params': z.string().min(1).max(4096),
  'motion:statuses': z.undefined(),
  /** Loads an item's page again (`scenes[2]`, `overlays[0]`). */
  'motion:reload': z.string().regex(/^(scenes|overlays)\[\d{1,6}\]$/),
  /** Copies a template of the motion kit into the project's `motion/` folder. */
  'motion:add-template': z.enum(MOTION_TEMPLATE_NAMES),
} as const;

export type Request = keyof typeof REQUESTS;
```

In the same file, replace:

```ts
  'project:read-screen': { started: true } | { problem: string };
  /** What the fit did, once it is done, or why it could not. */
  'project:fit-length': { report: LengthReport } | { problem: string };
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
```

with:

```ts
  'project:read-screen': { started: true } | { problem: string };
  /** What the fit did, once it is done, or why it could not. */
  'project:fit-length': { report: LengthReport } | { problem: string };
  'motion:project': void;
  'motion:frame': MotionFrameAnswer;
  'motion:strip': MotionStripAnswer;
  'motion:params': MotionParams;
  'motion:statuses': MotionStatusView[];
  'motion:reload': void;
  /** The page's path in the project (`motion/title/index.html`). */
  'motion:add-template': { src: string };
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
```

In the same file, replace:

```ts
  'speech:status': SpeechStatus;
  /** Every window: how motion is set now (`data-motion` on the page's root). */
  'app:motion': Motion;
}

export type Event = keyof Events;
```

with:

```ts
  'speech:status': SpeechStatus;
  /** Every window: how motion is set now (`data-motion` on the page's root). */
  'app:motion': Motion;
  /** The motion items' pages in the editor's preview: loading, ready or failed, and what they said. */
  'motion:status': MotionStatusView[];
  /** The project's files changed (a page edited): motion frames are drawn anew. Counts the changes. */
  'motion:changed': { files: number };
}

export type Event = keyof Events;
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
      'project:closed',
      'project:undo-restart',
      'app:settings',
    ],
    events: ['media:state', 'export:progress', 'export:end', 'project:status', 'project:file', 'project:closing', 'project:restarted', 'project:note', 'app:motion'],
  },
  pill: {
    requests: ['pill:recent', 'pill:open', 'pill:hide', 'pill:menu', 'pill:record'],
```

with:

```ts
      'project:closed',
      'project:undo-restart',
      'app:settings',
      'motion:project',
      'motion:frame',
      'motion:strip',
      'motion:params',
      'motion:statuses',
      'motion:reload',
      'motion:add-template',
    ],
    events: [
      'media:state',
      'export:progress',
      'export:end',
      'project:status',
      'project:file',
      'project:closing',
      'project:restarted',
      'project:note',
      'app:motion',
      'motion:status',
      'motion:changed',
    ],
  },
  pill: {
    requests: ['pill:recent', 'pill:open', 'pill:hide', 'pill:menu', 'pill:record'],
```

In the same file, replace:

```ts
export type WindowKind = keyof typeof WINDOW_CHANNELS;

/** Events that are news, not a state: the preload does not replay them to a listener that comes late. */
export const STREAM_EVENTS: ReadonlySet<string> = new Set<Event>(['export:progress', 'export:end', 'project:closing']);
```

with:

```ts
export type WindowKind = keyof typeof WINDOW_CHANNELS;

/** Events that are news, not a state: the preload does not replay them to a listener that comes late. */
export const STREAM_EVENTS: ReadonlySet<string> = new Set<Event>(['export:progress', 'export:end', 'project:closing', 'motion:changed']);
```

- [ ] **Step 4: The watch and the preview per editor**

`apps/desktop/src/main/motion-inputs.ts`:

```ts
// Which changes in a project's folder a motion page can see.

/** Folders of a project whose files no page reads: the exports, the previews, the editor's cache. */
const UNWATCHED = new Set(['out', 'preview', '.cuttle', '.git', 'node_modules']);

/** Whether a change to `name` (relative to the project folder) can change what a page draws. */
export function pageInput(name: string): boolean {
  const parts = name.split(/[\\/]/).filter(Boolean);
  const top = parts[0]?.toLowerCase();
  if (!top || UNWATCHED.has(top)) return false;
  // cuttle.json, its backups and its lock: the editor sends its project itself
  if (parts.length === 1 && /^cuttle\.json/i.test(top)) return false;
  // a take: its recordings are no page's, its events, words and markers are (cuttle.take)
  if (top === 'takes') return /\.(json|jsonl)$/i.test(parts.at(-1) ?? '');
  return true;
}
```

`apps/desktop/src/main/motion-service.ts`:

```ts
// An editor's motion: the preview of its motion scenes and overlays (the export's pages, at the
// player's size), started once the editor shows one. It watches the project's folder: a page Claude
// (or anyone) edits loads again, and the editor draws it anew.
import { watch, type FSWatcher } from 'node:fs';
import { sep } from 'node:path';
import { MotionPreview, type MotionFrameRequest, type MotionStatus, type PreviewMode } from '@cuttle/export';
import { MOTION_TEMPLATES } from '@cuttle/motion-kit';
import { copyTemplate } from '@cuttle/motion-kit/files';
import type { MotionParams } from '../shared/ipc';
import { pageInput } from './motion-inputs';

/** Changes closer together than this are one (a save is a write and a rename). */
const SETTLE_MS = 120;

export class EditorMotion {
  private preview: MotionPreview | undefined;
  private watcher: FSWatcher | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private changes = 0;

  constructor(
    private readonly dir: string,
    private readonly events: { status: (statuses: MotionStatus[]) => void; changed: (files: number) => void },
  ) {}

  /** The preview, made on first use (with the project the editor sent before), and the watch with it. */
  private get running(): MotionPreview {
    if (!this.preview) {
      this.preview = new MotionPreview(this.dir, { onStatus: (statuses) => this.events.status(statuses) });
      if (this.pending) this.preview.setProject(this.pending.version, this.pending.raw);
      this.pending = undefined;
      this.startWatching();
    }
    return this.preview;
  }

  private startWatching(): void {
    try {
      this.watcher = watch(this.dir, { recursive: true }, (_event, name) => {
        if (name && !pageInput(name.split('/').join(sep))) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.preview?.filesChanged();
          this.events.changed(++this.changes);
        }, SETTLE_MS);
      });
      this.watcher.on('error', () => this.stopWatching());
    } catch {
      // a folder that cannot be watched: an edited page shows after Reload
    }
  }

  private stopWatching(): void {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
  }

  project(version: number, raw: Record<string, unknown>): void {
    // nothing to do for a project the editor shows without motion: the preview starts with the first frame asked for
    if (this.preview) this.preview.setProject(version, raw);
    else this.pending = { version, raw };
  }

  /** The project sent before the preview started. */
  private pending: { version: number; raw: Record<string, unknown> } | undefined;

  frame(version: number, request: MotionFrameRequest, size: { width: number; height: number }, mode: PreviewMode, have?: number) {
    return this.running.frame(version, request, size, { mode, ...(have !== undefined && { have }) });
  }

  /** Frames across a motion scene for its block on the timeline. */
  strip(version: number, request: MotionFrameRequest, frames: readonly number[], size: { width: number; height: number }, have?: number) {
    return this.running.strip(version, request, frames, size, have);
  }

  params(src: string): Promise<MotionParams> {
    return this.running.params(src);
  }

  statuses(): MotionStatus[] {
    return this.preview?.currentStatuses() ?? [];
  }

  /** Loads an item's page again (Reload in the inspector), and the editor draws it anew. */
  reload(item: string): void {
    this.preview?.reload(item);
    this.events.changed(++this.changes);
  }

  /** Copies a template of the kit into `motion/<name>/`: the page's path in the project. */
  async addTemplate(template: string): Promise<string> {
    if (!MOTION_TEMPLATES.some((candidate) => candidate.name === template)) throw new Error(`no template "${template}"`);
    return copyTemplate(this.dir, template, template, import.meta.url);
  }

  dispose(): void {
    this.stopWatching();
    void this.preview?.close();
    this.preview = undefined;
  }
}
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
import { LockedError, lockProject, openProjectFile, projectInfo } from './project';
import { importImage, ProjectFileWatch } from './project-watch';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
```

with:

```ts
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
import { EditorMotion } from './motion-service';
import { LockedError, lockProject, openProjectFile, projectInfo } from './project';
import { importImage, ProjectFileWatch } from './project-watch';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
```

In the same file, replace:

```ts
  /** Its webContents, kept: a closed window's `webContents` getter throws. */
  contents: WebContents;
  media: ProjectMedia;
  /** cuttle.json on disk: the editor's saves and the changes others make. */
  watch: ProjectFileWatch;
  release: () => Promise<void>;
```

with:

```ts
  /** Its webContents, kept: a closed window's `webContents` getter throws. */
  contents: WebContents;
  media: ProjectMedia;
  /** The preview of its motion scenes and overlays. */
  motion: EditorMotion;
  /** cuttle.json on disk: the editor's saves and the changes others make. */
  watch: ProjectFileWatch;
  release: () => Promise<void>;
```

In the same file, replace:

```ts
    if (editor) {
      editors.delete(key);
      editor.media.dispose();
      if (!editor.window.isDestroyed()) editor.window.destroy();
    }
    await release();
```

with:

```ts
    if (editor) {
      editors.delete(key);
      editor.media.dispose();
      editor.motion.dispose();
      if (!editor.window.isDestroyed()) editor.window.destroy();
    }
    await release();
```

In the same file, replace:

```ts
  });
  const contents = window.webContents;
  guard(contents);
  const editor: Editor = { window, contents, media: newMedia(file.project), release, watch: new ProjectFileWatch(dir, (event) => onFileChange(event)) };
  editors.set(key, editor);
  function newMedia(project: ProjectFile['project']): ProjectMedia {
    return new ProjectMedia(dir, project, (state) => send(contents, 'media:state', state));
```

with:

```ts
  });
  const contents = window.webContents;
  guard(contents);
  const motion = new EditorMotion(dir, {
    status: (statuses) => send(contents, 'motion:status', statuses),
    changed: (files) => send(contents, 'motion:changed', { files }),
  });
  const editor: Editor = { window, contents, media: newMedia(file.project), motion, release, watch: new ProjectFileWatch(dir, (event) => onFileChange(event)) };
  editors.set(key, editor);
  function newMedia(project: ProjectFile['project']): ProjectMedia {
    return new ProjectMedia(dir, project, (state) => send(contents, 'media:state', state));
```

In the same file, replace:

```ts
    // contents.reload() from here is not a navigation the page started (guard() refuses those)
    'project:reload': () => contents.reload(),
    'project:closed': () => closeNow(),
    'project:import-image': async ({ purpose }) => {
      const chosen =
        CHECK_IMAGE ??
```

with:

```ts
    // contents.reload() from here is not a navigation the page started (guard() refuses those)
    'project:reload': () => contents.reload(),
    'project:closed': () => closeNow(),
    'motion:project': ({ version, raw }) => motion.project(version, raw),
    'motion:frame': ({ version, request, width, height, mode, have }) => motion.frame(version, request, { width, height }, mode, have),
    'motion:strip': ({ version, request, frames, width, height, have }) => motion.strip(version, request, frames, { width, height }, have),
    'motion:params': (src) => motion.params(src),
    'motion:statuses': () => motion.statuses(),
    'motion:reload': (item) => motion.reload(item),
    'motion:add-template': async (template) => ({ src: await motion.addTemplate(template) }),
    'project:import-image': async ({ purpose }) => {
      const chosen =
        CHECK_IMAGE ??
```

In the same file, replace:

```ts
    if (editors.get(key) === editor) editors.delete(key);
    editor.watch.close();
    editor.media.dispose();
    editor.run?.cancel();
    void release();
    // Closing the last editor returns to the pill (not while an editor is reopened on a new take).
```

with:

```ts
    if (editors.get(key) === editor) editors.delete(key);
    editor.watch.close();
    editor.media.dispose();
    editor.motion.dispose();
    editor.run?.cancel();
    void release();
    // Closing the last editor returns to the pill (not while an editor is reopened on a new take).
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node apps/desktop/test/motion-inputs.test.ts apps/desktop/test/contract.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/channels.ts apps/desktop/src/main apps/desktop/test/motion-inputs.test.ts apps/desktop/test/contract.test.ts
git commit -m "app: a motion preview per editor, the watch that reloads its pages, and its IPC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Motion in the player

**Files:**
- Create: `apps/desktop/src/renderer/editor/motion.ts`
- Modify: `apps/desktop/src/renderer/editor/{player,session}.ts`

- [ ] **Step 1: The player's motion frames**

`apps/desktop/src/renderer/editor/motion.ts`:

```ts
// The player's motion frames: the main process draws them with the export's pages, at the size the
// player shows. A few are kept per item, so a frame shows at once with the nearest kept one while
// the exact one comes (scrubbing, an edit), and playback asks ahead by as long as a frame takes.
import type { FrameSources, MotionPixels } from '@cuttle/engine';
import { motionNeeds, type MotionNeed } from '@cuttle/export/motion-requests';
import type { CuttleProject } from '@cuttle/project';
import type { RenderState, SceneSpan } from '@cuttle/timeline';
import { bridge } from '../bridge';

/** A frame kept: what drew it (`id`, the main process's number), which frame and view, and the version it was right for. */
interface Kept {
  version: number;
  id: number;
  frame: number;
  view: string;
  pixels: MotionPixels;
}

/** Frames kept per item. */
const KEEP = 8;
/** Requests on their way per showing while playing: one is drawn while the other travels. */
const IN_FLIGHT = 2;
/** Playback asks for a showing's first frame this long before it shows (s): its page opens in time. */
const WARM_SECONDS = 1.5;
/** At most this many frames ahead. */
const MAX_LEAD = 12;

const viewKey = (need: MotionNeed) => (need.request.view ? JSON.stringify(need.request.view) : '');

/** Frames across a motion scene for its block on the timeline: their frame numbers, and each as an image URL. */
export interface MotionStrip {
  frames: number[];
  urls: string[];
}

/** Frames a strip has: two a second, from 2 to 12. */
const stripCount = (seconds: number) => Math.min(12, Math.max(2, Math.round(seconds * 2)));

/** A frame (premultiplied RGBA) as an image URL. */
async function imageUrl(pixels: MotionPixels): Promise<string> {
  const data = new Uint8ClampedArray(pixels.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = pixels.data[i + 3]!;
    const scale = alpha === 0 ? 0 : 255 / alpha;
    data[i] = pixels.data[i]! * scale;
    data[i + 1] = pixels.data[i + 1]! * scale;
    data[i + 2] = pixels.data[i + 2]! * scale;
    data[i + 3] = alpha;
  }
  const canvas = new OffscreenCanvas(pixels.width, pixels.height);
  canvas.getContext('2d')!.putImageData(new ImageData(data, pixels.width, pixels.height), 0, 0);
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}

/** Whether the project has motion scenes or overlays (without, nothing is asked of the main process). */
export const hasMotion = (project: CuttleProject) => project.overlays.length > 0 || project.scenes.some((scene) => scene.type === 'motion');

export class MotionFrames {
  private version = 0;
  private project: CuttleProject;
  private active: boolean;
  private readonly kept = new Map<string, Kept[]>();
  /** While playing: requests on their way and the last frame asked for, per showing; how long frames take (ms), per item. */
  private readonly flying = new Map<string, number>();
  private readonly asked = new Map<string, number>();
  private readonly took = new Map<string, number>();
  /** Showings that failed while playing: not asked again until the next play. */
  private readonly failed = new Set<string>();

  constructor(
    project: CuttleProject,
    private readonly screen: { width: number; height: number },
    /** The size frames are drawn at (the player's on screen, at most the output's). */
    private readonly size: () => { width: number; height: number },
    /** A frame could not be drawn (the item's status says why). */
    private readonly onError: (message: string) => void = () => {},
  ) {
    this.project = project;
    this.active = hasMotion(project);
    this.send();
  }

  /** Another version of the project: frames are asked for by its number. */
  setProject(project: CuttleProject): void {
    if (project === this.project) return;
    this.project = project;
    this.version++;
    this.active = hasMotion(project);
    this.send();
  }

  /** The project's files changed: the frames kept are not right any more (they still show until the new ones come). */
  filesChanged(): void {
    this.version++;
    this.send();
  }

  private send(): void {
    if (this.active) void bridge.invoke('motion:project', { version: this.version, raw: this.project as unknown as Record<string, unknown> }).catch(() => {});
  }

  /** The motion frames `state` shows. */
  needs(spans: readonly SceneSpan[], state: RenderState): MotionNeed[] {
    return this.active ? motionNeeds(this.project, spans, state, this.screen) : [];
  }

  /** The item a need draws: its frames are kept together (by id, else by page), across edits and its showings. */
  private itemKey(need: MotionNeed): string {
    const { kind, index } = need.request;
    const item = kind === 'scene' ? this.project.scenes[index] : this.project.overlays[index];
    const name = item && 'src' in item ? (item.id ?? item.src) : `#${index}`;
    return `${kind}:${name}`;
  }

  private keep(need: MotionNeed, kept: Kept, wanted?: number): void {
    const key = this.itemKey(need);
    let list = (this.kept.get(key) ?? []).filter((other) => !(other.frame === kept.frame && other.view === kept.view));
    list.push(kept);
    // while playing, frames behind the playhead go first (the newest of them still shows)
    if (wanted !== undefined) {
      const behind = list.filter((other) => other.frame < wanted).sort((a, b) => b.frame - a.frame);
      list = list.filter((other) => other.frame >= wanted || other === behind[0]);
    }
    while (list.length > KEEP) list.shift();
    this.kept.set(key, list);
  }

  /** The kept frame nearest to a need, and whether it is the exact one. */
  private nearest(need: MotionNeed): { kept: Kept; exact: boolean } | undefined {
    const list = this.kept.get(this.itemKey(need));
    if (!list?.length) return undefined;
    const view = viewKey(need);
    const { frame } = need.request;
    const exact = list.find((kept) => kept.version === this.version && kept.frame === frame && kept.view === view);
    if (exact) return { kept: exact, exact: true };
    // the closest frame, one before the wanted rather than after it
    let best = list[0]!;
    const distance = (kept: Kept) => Math.abs(kept.frame - frame) + (kept.frame > frame ? 0.5 : 0) + (kept.version === this.version ? 0 : 0.25);
    for (const kept of list) if (distance(kept) < distance(best)) best = kept;
    return { kept: best, exact: false };
  }

  /** Puts the nearest kept frame of each need into `sources`; true when each was the exact frame. */
  fill(needs: readonly MotionNeed[], sources: FrameSources): boolean {
    let exact = true;
    for (const need of needs) {
      const found = this.nearest(need);
      if (!found?.exact) exact = false;
      if (found) this.place(need, found.kept.pixels, sources);
    }
    return exact;
  }

  private place(need: MotionNeed, pixels: MotionPixels, sources: FrameSources): void {
    if (need.target.kind === 'scene') sources.motion.set(need.target.layer, pixels);
    else sources.overlays.set(need.target.key, pixels);
  }

  private ask(need: MotionNeed, mode: 'seek' | 'play', have?: number) {
    const { width, height } = this.size();
    return bridge.invoke('motion:frame', { version: this.version, request: need.request, width, height, mode, ...(have !== undefined && { have }) });
  }

  /**
   * The exact frames of `needs` (paused): asked for, kept and put into `sources`. True when one of
   * them differs from what `fill` put there; undefined when they are no longer wanted.
   */
  async exact(needs: readonly MotionNeed[], sources: FrameSources): Promise<boolean | undefined> {
    const version = this.version;
    const answers = await Promise.allSettled(
      needs.map(async (need) => {
        const before = this.nearest(need);
        // the copy of this very frame kept from an earlier version may still be right
        const same = before && before.kept.frame === need.request.frame && before.kept.view === viewKey(need) ? before.kept : undefined;
        const answer = await this.ask(need, 'seek', same?.id);
        if (!answer || version !== this.version) return undefined;
        const pixels = answer.pixels ?? (same && answer.id === same.id ? same.pixels : undefined);
        if (!pixels) return undefined;
        this.keep(need, { version, id: answer.id, frame: need.request.frame, view: viewKey(need), pixels });
        this.place(need, pixels, sources);
        return pixels !== before?.kept.pixels;
      }),
    );
    if (version !== this.version) return undefined;
    let changed = false;
    for (const answer of answers) {
      if (answer.status === 'rejected') this.onError((answer.reason as Error).message);
      else if (answer.value === undefined) {
        // superseded by a newer request: that one draws
        if (answers.every((other) => other.status === 'fulfilled' && other.value === undefined)) return undefined;
      } else if (answer.value) changed = true;
    }
    return changed;
  }

  /** Frames that came while playing (since it started), and how long one took (ms, a running mean of every item). */
  private received = 0;

  stats(): { frames: number; took: number } {
    const times = [...this.took.values()];
    return { frames: this.received, took: times.length > 0 ? Math.round(times.reduce((sum, time) => sum + time, 0) / times.length) : 0 };
  }

  /** The strips of the scenes' blocks, by item, with the number of what drew them. */
  private readonly strips = new Map<string, { id: number; strip: MotionStrip }>();

  /**
   * Frames across motion scene `sceneIndex` for its block on the timeline, `height` px high: the strip
   * the editor has when it is still right, undefined when it cannot be drawn now.
   */
  async strip(spans: readonly SceneSpan[], sceneIndex: number, height: number): Promise<MotionStrip | undefined> {
    const scene = this.project.scenes[sceneIndex];
    const span = spans.find((candidate) => candidate.sceneIndex === sceneIndex);
    if (scene?.type !== 'motion' || !span) return undefined;
    const { fps, width: outWidth, height: outHeight } = this.project.output;
    const last = Math.max(0, Math.round(scene.duration * fps) - 1);
    const count = stripCount(scene.duration);
    const frames = [...new Set(Array.from({ length: count }, (_, k) => Math.min(last, Math.round(((k + 0.5) / count) * scene.duration * fps))))];
    const key = `scene:${scene.id ?? scene.src}`;
    const kept = this.strips.get(key);
    const same = kept && kept.strip.frames.join() === frames.join();
    const answer = await bridge.invoke('motion:strip', {
      version: this.version,
      request: { key: `strip:${key}`, kind: 'scene', index: sceneIndex, frame: 0, start: span.start, duration: scene.duration, screen: this.screen },
      frames,
      width: Math.max(8, Math.min(512, Math.round((height * outWidth) / outHeight))),
      height,
      ...(same && { have: kept.id }),
    });
    if (!answer) return undefined;
    if (!answer.frames) return kept?.strip;
    const strip = { frames, urls: await Promise.all(answer.frames.map(imageUrl)) };
    for (const url of kept?.strip.urls ?? []) URL.revokeObjectURL(url);
    this.strips.set(key, { id: answer.id, strip });
    return strip;
  }

  /** Playback starts: what failed before is asked again. */
  startPlaying(): void {
    this.received = 0;
    this.flying.clear();
    this.asked.clear();
    this.failed.clear();
    this.playhead.clear();
  }

  /**
   * While playing, output frame `frame`: puts the best kept frame of each need into `sources` and
   * asks for frames ahead (by as long as one takes), and for the first frames of showings coming up.
   * `needsAt(n)` gives the needs of output frame n.
   */
  stream(needs: readonly MotionNeed[], frame: number, fps: number, last: number, sources: FrameSources, needsAt: (frame: number) => MotionNeed[]): void {
    if (!this.active) return;
    for (const need of needs) {
      const item = this.itemKey(need);
      const wanted = need.request.frame;
      this.playhead.set(item, wanted);
      // the newest frame of this version up to the wanted one, else the nearest
      let best: Kept | undefined;
      for (const kept of this.kept.get(item) ?? []) if (kept.version === this.version && kept.frame <= wanted && (!best || kept.frame > best.frame)) best = kept;
      const pixels = best?.pixels ?? this.nearest(need)?.kept.pixels;
      if (pixels) this.place(need, pixels, sources);
      // ahead by as long as a frame of this item takes to come
      const lead = Math.min(MAX_LEAD, Math.max(1, Math.ceil(((this.took.get(item) ?? 60) / 1000) * fps) + 1));
      this.askAhead(need.request.key, Math.min(last, frame + lead), needsAt);
    }
    // showings that start soon: the frame they start with, so their page is open when they show
    const soon = Math.min(last, frame + Math.round(WARM_SECONDS * fps));
    if (soon <= frame) return;
    for (const need of needsAt(soon)) {
      if (this.asked.has(need.request.key)) continue;
      const starts = Math.round(need.request.start * fps);
      this.askAhead(need.request.key, Math.max(frame + 1, Math.min(starts, soon)), needsAt);
    }
  }

  /** The local frame each item shows while playing (frames before it are dropped as new ones come). */
  private readonly playhead = new Map<string, number>();

  /** Asks for showing `key`'s frame on output frame `at`, unless it asked for that one (or a later one) already or has no room. */
  private askAhead(key: string, at: number, needsAt: (frame: number) => MotionNeed[]): void {
    if (this.failed.has(key) || (this.flying.get(key) ?? 0) >= IN_FLIGHT) return;
    const need = needsAt(at).find((candidate) => candidate.request.key === key);
    if (!need || need.request.frame <= (this.asked.get(key) ?? -1)) return;
    this.asked.set(key, need.request.frame);
    this.flying.set(key, (this.flying.get(key) ?? 0) + 1);
    const version = this.version;
    const item = this.itemKey(need);
    const started = performance.now();
    const landed = () => this.flying.set(key, Math.max(0, (this.flying.get(key) ?? 1) - 1));
    this.ask(need, 'play').then(
      (answer) => {
        landed();
        if (!answer?.pixels || version !== this.version) return;
        const took = performance.now() - started;
        this.took.set(item, 0.7 * (this.took.get(item) ?? took) + 0.3 * took);
        this.received++;
        this.keep(need, { version, id: answer.id, frame: need.request.frame, view: viewKey(need), pixels: answer.pixels }, this.playhead.get(item));
      },
      (error: Error) => {
        landed();
        this.failed.add(key);
        this.onError(error.message);
      },
    );
  }
}
```

- [ ] **Step 2: Seeking and playing with them**

In `apps/desktop/src/renderer/editor/player.ts`, replace:

```ts
import { TypingSchedule } from './typing-audio';
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
import type { EditorMedia, VideoSource } from './media';

export interface PlayerState {
  /** Output seconds of the frame on screen. */
```

with:

```ts
import { TypingSchedule } from './typing-audio';
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
import type { EditorMedia, VideoSource } from './media';
import { MotionFrames } from './motion';

export interface PlayerState {
  /** Output seconds of the frame on screen. */
```

In the same file, replace:

```ts
const LOOKAHEAD_FRAMES = 20;
/** Playback this far behind the clock restarts its decoders at the clock (frames are dropped). */
const BEHIND_SECONDS = 0.5;

/** What playback did, for the check: frames drawn, decoder restarts at the clock (frames dropped), typing clicks scheduled, the clock. */
export interface PlaybackStats {
```

with:

```ts
const LOOKAHEAD_FRAMES = 20;
/** Playback this far behind the clock restarts its decoders at the clock (frames are dropped). */
const BEHIND_SECONDS = 0.5;
/** The sizes motion frames are drawn at, as parts of the output: the smallest that fills the player on screen. */
const MOTION_SCALES = [1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1];

/** What playback did, for the check: frames drawn, decoder restarts at the clock (frames dropped), typing clicks scheduled, the clock. */
export interface PlaybackStats {
```

In the same file, replace:

```ts
  clicks: number;
  /** The clock's output time (where the sound is), while playing. */
  clock: number;
}

export interface PlayerOptions {
```

with:

```ts
  clicks: number;
  /** The clock's output time (where the sound is), while playing. */
  clock: number;
  /** Motion frames that came while playing, and how long one took (ms, a running mean). */
  motion?: { frames: number; took: number };
}

export interface PlayerOptions {
```

In the same file, replace:

```ts
  /** The project as shown (the editor may preview another output format than the file's). */
  project: CuttleProject;
  onChange: (state: PlayerState) => void;
}

export class Player {
```

with:

```ts
  /** The project as shown (the editor may preview another output format than the file's). */
  project: CuttleProject;
  onChange: (state: PlayerState) => void;
  /** Motion frames at the output's size, whatever the player's on screen (the check compares them with the export's). */
  fullSizeMotion?: boolean;
}

export class Player {
```

In the same file, replace:

```ts
  private screenGrabber: FrameGrabber;
  private webcamGrabber: FrameGrabber | undefined;
  private seekToken = 0;
  private playToken = 0;
  private context: AudioContext | undefined;
  private audio: AudioSchedule | undefined;
```

with:

```ts
  private screenGrabber: FrameGrabber;
  private webcamGrabber: FrameGrabber | undefined;
  private seekToken = 0;
  /**
   * Where the seek under way goes (output seconds, as asked): a new version of the project that comes
   * meanwhile shows that time, not the one still on screen (an item added, then the playhead moved to it).
   */
  private seeking: number | undefined;
  private playToken = 0;
  private context: AudioContext | undefined;
  private audio: AudioSchedule | undefined;
```

In the same file, replace:

```ts
  private disposed = false;
  private readonly playback: PlaybackStats = { drawn: 0, restarts: 0, clicks: 0, clock: 0 };
  private clockNow: (() => number) | undefined;

  constructor(options: PlayerOptions) {
    this.media = options.media;
```

with:

```ts
  private disposed = false;
  private readonly playback: PlaybackStats = { drawn: 0, restarts: 0, clicks: 0, clock: 0 };
  private clockNow: (() => number) | undefined;
  private readonly motion: MotionFrames;
  private readonly fullSizeMotion: boolean;
  /** The frames of the seek on screen, kept while its motion frames come (it is drawn again with them). */
  private parked: HeldFrame[] = [];

  constructor(options: PlayerOptions) {
    this.media = options.media;
```

In the same file, replace:

```ts
    this.webcamGrabber = this.media.webcam ? new FrameGrabber(this.media.webcam) : undefined;
    this.timeline = this.makeTimeline();
    this.renderer = this.makeRenderer();
  }

  get duration(): number {
```

with:

```ts
    this.webcamGrabber = this.media.webcam ? new FrameGrabber(this.media.webcam) : undefined;
    this.timeline = this.makeTimeline();
    this.renderer = this.makeRenderer();
    this.fullSizeMotion = options.fullSizeMotion ?? false;
    this.motion = new MotionFrames(this.project, this.media.screen.size, () => this.motionSize());
  }

  /** The size motion frames are drawn at: the output's part that fills the player on screen. */
  private motionSize(): { width: number; height: number } {
    const { width, height } = this.project.output;
    const shown = this.canvas.clientWidth * (window.devicePixelRatio || 1);
    const scale = this.fullSizeMotion ? 1 : (MOTION_SCALES.find((part) => width * part >= shown * 0.95) ?? 1);
    return { width: Math.max(8, Math.round(width * scale)), height: Math.max(8, Math.round(height * scale)) };
  }

  /** Frames across motion scene `sceneIndex` for its block on the timeline, `height` px high (undefined: not now). */
  motionStrip(sceneIndex: number, height: number) {
    return this.motion.strip(this.timeline.spans, sceneIndex, height);
  }

  /** The project's files changed (a motion page edited): its frames are drawn anew. */
  motionFilesChanged(): void {
    this.motion.filesChanged();
    if (!this.state.playing) void this.seek(this.seeking ?? this.state.t);
  }

  get duration(): number {
```

In the same file, replace:

```ts

  /** Playback counters since the last play, and the clock's time while playing. */
  stats(): PlaybackStats {
    return { ...this.playback, clicks: this.typing?.scheduled ?? this.playback.clicks, clock: this.clockNow?.() ?? this.state.t };
  }

  private makeTimeline(): Timeline {
```

with:

```ts

  /** Playback counters since the last play, and the clock's time while playing. */
  stats(): PlaybackStats {
    return { ...this.playback, clicks: this.typing?.scheduled ?? this.playback.clicks, clock: this.clockNow?.() ?? this.state.t, motion: this.motion.stats() };
  }

  private makeTimeline(): Timeline {
```

In the same file, replace:

```ts
    const background = this.media.backgroundImage;
    const renew = look(project) !== look(this.project) || background !== this.drawnBackground;
    this.project = project;
    this.timeline = this.makeTimeline();
    // the title bar and the transport show the length: they learn it changed with the state
    this.set({ duration: this.timeline.duration });
```

with:

```ts
    const background = this.media.backgroundImage;
    const renew = look(project) !== look(this.project) || background !== this.drawnBackground;
    this.project = project;
    this.motion.setProject(project);
    this.timeline = this.makeTimeline();
    // the title bar and the transport show the length: they learn it changed with the state
    this.set({ duration: this.timeline.duration });
```

In the same file, replace:

```ts
      this.renderer = this.makeRenderer();
    } else this.renderer.setScenes(project.scenes);
    if (this.media.webcam && !this.webcamGrabber) this.webcamGrabber = new FrameGrabber(this.media.webcam);
    void this.seek(Math.min(this.state.t, this.timeline.duration));
    if (playing) this.play();
  }
```

with:

```ts
      this.renderer = this.makeRenderer();
    } else this.renderer.setScenes(project.scenes);
    if (this.media.webcam && !this.webcamGrabber) this.webcamGrabber = new FrameGrabber(this.media.webcam);
    void this.seek(Math.min(this.seeking ?? this.state.t, this.timeline.duration));
    if (playing) this.play();
  }
```

In the same file, replace:

```ts
    this.keyFrames = new KeyFrames(proxy);
    this.screenGrabber = new FrameGrabber(proxy);
    if (playing) this.play();
    else void this.seek(this.state.t);
  }

  /** The output frame number of a time. */
```

with:

```ts
    this.keyFrames = new KeyFrames(proxy);
    this.screenGrabber = new FrameGrabber(proxy);
    if (playing) this.play();
    else void this.seek(this.seeking ?? this.state.t);
  }

  /** The output frame number of a time. */
```

In the same file, replace:

```ts
    }
  }

  /** Shows the frame at output time `t` (paused); a newer seek wins over one still decoding. */
  async seek(t: number): Promise<void> {
    if (this.disposed) return;
    if (this.state.playing) this.pause();
    const token = ++this.seekToken;
    const time = Math.max(0, Math.min(t, this.duration));
    const frame = this.frameOf(time);
    const state = this.timeline.frameAt(frame / this.fps);
    const held: HeldFrame[] = [];
    const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };
    const stills = this.stillsByIndex();
    try {
```

with:

```ts
    }
  }

  /** Closes the frames a seek kept for drawing again. */
  private unpark(): void {
    for (const frame of this.parked) frame.close();
    this.parked = [];
  }

  /**
   * Shows the frame at output time `t` (paused); a newer seek wins over one still decoding. Motion
   * shows at once with the nearest frame the player has, and the frame is drawn again once the exact
   * ones came.
   */
  async seek(t: number): Promise<void> {
    if (this.disposed) return;
    if (this.state.playing) this.pause();
    const token = ++this.seekToken;
    this.unpark();
    this.seeking = t;
    const time = Math.max(0, Math.min(t, this.duration));
    const frame = this.frameOf(time);
    const state = this.timeline.frameAt(frame / this.fps);
    let held: HeldFrame[] = [];
    const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };
    const stills = this.stillsByIndex();
    try {
```

In the same file, replace:

```ts
        }
      }
      if (token !== this.seekToken || this.disposed) return;
      if (this.draw(state, sources)) this.set({ t: time, source: this.sourceOf(state), error: undefined });
    } catch (error) {
      if (token === this.seekToken && !this.disposed) this.set({ t: time, error: frameError(error) });
    } finally {
      for (const frame of held) frame.close();
    }
```

with:

```ts
        }
      }
      if (token !== this.seekToken || this.disposed) return;
      const needs = this.motion.needs(this.timeline.spans, state);
      const exact = this.motion.fill(needs, sources);
      this.seeking = undefined;
      if (this.draw(state, sources)) this.set({ t: time, source: this.sourceOf(state), error: undefined });
      if (exact) return;
      // the exact motion frames, then this frame again with them (its video frames are kept until then)
      this.parked = held;
      held = [];
      const changed = await this.motion.exact(needs, sources);
      if (token !== this.seekToken || this.disposed || this.state.playing) return;
      if (changed) this.draw(state, sources);
      this.unpark();
    } catch (error) {
      if (token === this.seekToken && !this.disposed) {
        this.seeking = undefined;
        this.set({ t: time, error: frameError(error) });
      }
    } finally {
      for (const frame of held) frame.close();
    }
```

In the same file, replace:

```ts
    if (this.disposed || this.state.playing || !(this.duration > 0)) return;
    const from = this.state.t >= this.duration - 1 / this.fps ? 0 : this.state.t;
    this.seekToken++;
    const token = ++this.playToken;
    this.context ??= new AudioContext({ latencyHint: 'playback' });
    void this.context.resume();
```

with:

```ts
    if (this.disposed || this.state.playing || !(this.duration > 0)) return;
    const from = this.state.t >= this.duration - 1 / this.fps ? 0 : this.state.t;
    this.seekToken++;
    this.seeking = undefined;
    this.unpark();
    const token = ++this.playToken;
    this.context ??= new AudioContext({ latencyHint: 'playback' });
    void this.context.resume();
```

In the same file, replace:

```ts
    };
    let frames: PlaybackFrames | undefined;
    let shown = startFrame - 1;
    try {
      if (this.media.mic) this.audio = new AudioSchedule(context, this.media.mic, this.project, this.timeline.spans, from, contextStart);
      this.typing = new TypingSchedule(context, this.project, this.timeline.spans, this.media.events, from, contextStart);
```

with:

```ts
    };
    let frames: PlaybackFrames | undefined;
    let shown = startFrame - 1;
    const needsAt = (frame: number) => this.motion.needs(this.timeline.spans, this.timeline.frameAt(frame / fps));
    this.motion.startPlaying();
    try {
      if (this.media.mic) this.audio = new AudioSchedule(context, this.media.mic, this.project, this.timeline.spans, from, contextStart);
      this.typing = new TypingSchedule(context, this.project, this.timeline.spans, this.media.events, from, contextStart);
```

In the same file, replace:

```ts
          const state = this.timeline.frameAt(frame / fps);
          const sources = await frames.sourcesFor(frame, state, speedOf);
          if (token !== this.playToken || this.disposed) break;
          if (sources && this.draw(state, sources)) {
            this.playback.drawn++;
            this.set({ t: frame / fps, source: this.sourceOf(state) });
```

with:

```ts
          const state = this.timeline.frameAt(frame / fps);
          const sources = await frames.sourcesFor(frame, state, speedOf);
          if (token !== this.playToken || this.disposed) break;
          if (sources) {
            // the motion frames that have come, and the next ones asked for
            sources.motion.clear();
            sources.overlays.clear();
            this.motion.stream(this.motion.needs(this.timeline.spans, state), frame, fps, last, sources, needsAt);
          }
          if (sources && this.draw(state, sources)) {
            this.playback.drawn++;
            this.set({ t: frame / fps, source: this.sourceOf(state) });
```

In the same file, replace:

```ts
  dispose(): void {
    this.disposed = true;
    this.pause();
    this.renderer.dispose();
    void this.context?.close();
  }
```

with:

```ts
  dispose(): void {
    this.disposed = true;
    this.pause();
    this.unpark();
    this.renderer.dispose();
    void this.context?.close();
  }
```

- [ ] **Step 3: The statuses, a page changed, and the check's hook**

In `apps/desktop/src/renderer/editor/session.ts`, replace:

```ts
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject } from '@cuttle/project';
import type { Command, EditLimits } from '../../shared/document';
import type { ExportEnd, ExportProgress, ExportTarget, MediaState, ProjectInfo, ProjectStatus } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { beforeClose, dismissToast, edit, flush, offerUndoRestart, openDocument, outsideChange, redo, toast, undo, type DocState } from './doc';
```

with:

```ts
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject } from '@cuttle/project';
import type { Command, EditLimits } from '../../shared/document';
import type { ExportEnd, ExportProgress, ExportTarget, MediaState, MotionStatusView, ProjectInfo, ProjectStatus } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { beforeClose, dismissToast, edit, flush, offerUndoRestart, openDocument, outsideChange, redo, toast, undo, type DocState } from './doc';
```

In the same file, replace:

```ts
  status?: ProjectStatus;
  /** The command menu (Ctrl+K) is open. */
  menuOpen: boolean;
}

export const store = createStore<EditorState>({
```

with:

```ts
  status?: ProjectStatus;
  /** The command menu (Ctrl+K) is open. */
  menuOpen: boolean;
  /** The motion items' pages in the preview: loading, ready or failed, and what they said. */
  motionStatus: MotionStatusView[];
  /** Counts the changes to the project's files (a motion page edited): what was read from them is read again. */
  motionFiles: number;
}

export const store = createStore<EditorState>({
```

In the same file, replace:

```ts
  exportUnseen: false,
  pxPerSecond: 0,
  menuOpen: false,
});

let player: Player | undefined;
```

with:

```ts
  exportUnseen: false,
  pxPerSecond: 0,
  menuOpen: false,
  motionStatus: [],
  motionFiles: 0,
});

let player: Player | undefined;
```

In the same file, replace:

```ts
      assets,
      project: shownProject()!,
      onChange: (state) => store.set({ player: state }),
    });
    store.set({ phase: 'ready', media });
    await player.seek(0);
```

with:

```ts
      assets,
      project: shownProject()!,
      onChange: (state) => store.set({ player: state }),
      // the check compares the editor's motion frames with the export's
      fullSizeMotion: query.get('check') === '1',
    });
    store.set({ phase: 'ready', media });
    await player.seek(0);
```

In the same file, replace:

```ts
    bridge.on('project:file', (event) => void outsideChange(event));
    // A restarted take: the one before it is kept aside, and can be the take again.
    bridge.on('project:restarted', ({ discarded }) => offerUndoRestart(discarded));
    // what happened to the take (an undone restart), once it is in
    bridge.on('project:note', ({ text }) => toast(text));
  } catch (error) {
```

with:

```ts
    bridge.on('project:file', (event) => void outsideChange(event));
    // A restarted take: the one before it is kept aside, and can be the take again.
    bridge.on('project:restarted', ({ discarded }) => offerUndoRestart(discarded));
    // a motion page changed (Claude edited it): its frames, params and errors anew
    bridge.on('motion:status', (statuses) => store.set({ motionStatus: statuses }));
    bridge.on('motion:changed', ({ files }) => {
      store.set({ motionFiles: files });
      player?.motionFilesChanged();
    });
    // what happened to the take (an undone restart), once it is in
    bridge.on('project:note', ({ text }) => toast(text));
  } catch (error) {
```

In the same file, replace:

```ts
  }
}

const LISTS = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', cut: 'cuts', crop: 'scenes' } as const;

/** The player follows the document (edits, previews, outside changes) and the previewed format. */
function followDocument(): void {
```

with:

```ts
  }
}

const LISTS = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', motion: 'overlays', cut: 'cuts', crop: 'scenes' } as const;

/** The player follows the document (edits, previews, outside changes) and the previewed format. */
function followDocument(): void {
```

In the same file, replace:

```ts
    __cuttleCheck: {
      seek: (t: number) => player?.seek(t),
      playback: () => player?.stats(),
      state: () => ({ ...store.get().player, duration: player?.duration ?? 0, mediaState: store.get().mediaState, proxyInUse, selection: store.get().selection, tool: store.get().tool }),
      pixels: () => canvas.toDataURL('image/png'),
      /** Switches to the proxy (the check runs with `?proxy=off` to compare frames of the take first). */
      useProxy: async () => {
```

with:

```ts
    __cuttleCheck: {
      seek: (t: number) => player?.seek(t),
      playback: () => player?.stats(),
      state: () => ({
        ...store.get().player,
        duration: player?.duration ?? 0,
        mediaState: store.get().mediaState,
        proxyInUse,
        selection: store.get().selection,
        tool: store.get().tool,
        motion: { status: store.get().motionStatus, files: store.get().motionFiles },
      }),
      pixels: () => canvas.toDataURL('image/png'),
      /** Switches to the proxy (the check runs with `?proxy=off` to compare frames of the take first). */
      useProxy: async () => {
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/editor/motion.ts apps/desktop/src/renderer/editor/player.ts apps/desktop/src/renderer/editor/session.ts
git commit -m "app: the player draws motion while it scrubs and plays: the nearest frame at once, the exact one after, ahead while playing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Motion lane, the strips, the panel and "+ Motion"

**Files:**
- Modify: `apps/desktop/src/shared/{timeline-model,document,edit}.ts`, `apps/desktop/src/renderer/editor/{Timeline,Inspector}.tsx`, `apps/desktop/src/renderer/editor/{actions,commands}.ts`, `apps/desktop/src/renderer/icons.tsx`, `apps/desktop/src/renderer/tokens.css`, `apps/desktop/src/renderer/editor/editor.css`, `apps/desktop/test/{timeline-model,document}.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/test/timeline-model.test.ts`, replace:

```ts
    ]);
  });

  it('pins markers where a clip shows them; a cut-out marker has no pin', () => {
    expect(model.markers.map((pin) => [pin.t, pin.kind])).toEqual([
      [2.5, 'prompt'],
```

with:

```ts
    ]);
  });

  it('draws motion overlays on a lane of their own, named by their page, and counts those no clip shows', () => {
    const motion = project({
      scenes: [
        { type: 'clip', from: 0, to: 4 },
        { type: 'motion', src: 'motion/title/index.html', duration: 2 },
      ],
      overlays: [
        { src: 'motion/lower-third/index.html', at: 1, duration: 2, label: 'Name' },
        { src: 'motion/click-callouts/index.html', at: 0, duration: 4 },
        { src: 'motion/late.html', at: 9, duration: 1 },
      ],
    });
    const motionSpans = sceneSpans(motion.scenes);
    const lanes = timelineModel(motion, motionSpans, []);
    expect(lanes.scenes.map((scene) => [scene.kind, scene.title])).toEqual([
      ['clip', 'Clip'],
      ['motion', 'title'],
    ]);
    // overlapping ones on rows of their own
    expect(lanes.lanes.motion.blocks.map((block) => [block.title, block.start, block.end, block.row])).toEqual([
      ['click-callouts', 0, 4, 0],
      ['Name', 1, 3, 1],
    ]);
    expect(lanes.lanes.motion.cutOutItems.map((item) => item.title)).toEqual(['late']);
    expect(exportChecks(motion, motionSpans)).toEqual(['1 motion overlay is cut out: no clip shows it.']);
  });

  it('pins markers where a clip shows them; a cut-out marker has no pin', () => {
    expect(model.markers.map((pin) => [pin.t, pin.kind])).toEqual([
      [2.5, 'prompt'],
```

In `apps/desktop/test/document.test.ts`, replace:

```ts
    expect(() => applyCommand(raw, { type: 'delete', list: 'zooms', id: 'z1' }, limits)).toThrow(DocumentError);
  });

  it('shifts overlays in source seconds, never before 0', () => {
    const next = applyCommand(base, { type: 'shift', list: 'zooms', id: 'z1', by: -10 }, limits);
    expect((next.zooms as { at: number }[])[0]!.at).toBe(0);
```

with:

```ts
    expect(() => applyCommand(raw, { type: 'delete', list: 'zooms', id: 'z1' }, limits)).toThrow(DocumentError);
  });

  it('edits motion overlays as the other overlays: ids, a shift, a drag, their params, and the speed of their clip', () => {
    const raw = ensureIds({ ...base, overlays: [{ src: 'motion/bar/index.html', at: 4, duration: 2 }] });
    expect((raw.overlays as { id: string }[])[0]!.id).toBe('o1');
    let next = applyCommand(raw, { type: 'shift', list: 'overlays', id: 'o1', by: 1 }, limits);
    expect((next.overlays as { at: number }[])[0]!.at).toBe(5);
    next = applyCommand(next, { type: 'set', list: 'overlays', id: 'o1', fields: { ...rangeFields('overlays', 4, 5), params: { name: 'Lena' } } }, limits);
    expect(next.overlays).toEqual([{ src: 'motion/bar/index.html', at: 4, duration: 1, id: 'o1', params: { name: 'Lena' } }]);
    expect(describeChange(project(raw), project(next))).toBe('1 motion overlay changed');
    expect(firstChanged(project(raw), project(next))).toEqual({ list: 'overlays', id: 'o1' });
    // inside the 4× clip (3–8 s): 2 source s are 0.5 s of video, and stay so at 8×
    const faster = applyCommand(raw, { type: 'speed', id: 's2', speed: 8 }, limits);
    expect((faster.overlays as { duration: number }[])[0]!.duration).toBe(4);
  });

  it('shifts overlays in source seconds, never before 0', () => {
    const next = applyCommand(base, { type: 'shift', list: 'zooms', id: 'z1', by: -10 }, limits);
    expect((next.zooms as { at: number }[])[0]!.at).toBe(0);
```

Run: `pnpm exec vitest run --project node apps/desktop/test/timeline-model.test.ts apps/desktop/test/document.test.ts`
Expected: FAIL: there is no motion lane, and overlays get no ids.

- [ ] **Step 2: The model and the edits**

In `apps/desktop/src/shared/timeline-model.ts`, replace:

```ts
import { occurrences, type SceneSpan } from '@cuttle/timeline';
import { formatDuration } from './format';

export type OverlayKind = 'zoom' | 'mask' | 'caption';

export interface SceneBlock {
  /** The scene's index in the project's `scenes`. */
```

with:

```ts
import { occurrences, type SceneSpan } from '@cuttle/timeline';
import { formatDuration } from './format';

export type OverlayKind = 'zoom' | 'mask' | 'caption' | 'motion';

export interface SceneBlock {
  /** The scene's index in the project's `scenes`. */
```

In the same file, replace:

```ts

export interface OverlayBlock {
  kind: OverlayKind;
  /** Index in the project's `zooms`, `masks` or `texts`. */
  item: number;
  /** The item's id (`#<index>` for one without). */
  id: string;
```

with:

```ts

export interface OverlayBlock {
  kind: OverlayKind;
  /** Index in the project's `zooms`, `masks`, `texts` or `overlays`. */
  item: number;
  /** The item's id (`#<index>` for one without). */
  id: string;
```

In the same file, replace:

```ts
      zoom: lane('zoom', project.zooms, spans, (zoom) => [zoom.at, zoom.at + zoom.duration], () => 'Zoom', (zoom) => (zoom.moves ?? []).map((move) => move.at)),
      mask: lane('mask', project.masks, spans, (mask) => [mask.from, mask.to], () => 'Mask', (mask) => (mask.moves ?? []).map((move) => move.at)),
      caption: lane('caption', project.texts, spans, (text) => [text.at, text.at + text.duration], (text) => text.text),
    },
    markers: markers
      .flatMap((marker) => outputTimesOf(spans, marker.t).map((t) => ({ t, source: marker.t, kind: marker.kind, ...(marker.label !== undefined && { label: marker.label }) })))
```

with:

```ts
      zoom: lane('zoom', project.zooms, spans, (zoom) => [zoom.at, zoom.at + zoom.duration], () => 'Zoom', (zoom) => (zoom.moves ?? []).map((move) => move.at)),
      mask: lane('mask', project.masks, spans, (mask) => [mask.from, mask.to], () => 'Mask', (mask) => (mask.moves ?? []).map((move) => move.at)),
      caption: lane('caption', project.texts, spans, (text) => [text.at, text.at + text.duration], (text) => text.text),
      motion: lane('motion', project.overlays, spans, (overlay) => [overlay.at, overlay.at + overlay.duration], (overlay) => motionName(overlay.src)),
    },
    markers: markers
      .flatMap((marker) => outputTimesOf(spans, marker.t).map((t) => ({ t, source: marker.t, kind: marker.kind, ...(marker.label !== undefined && { label: marker.label }) })))
```

In the same file, replace:

```ts
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const list = (items: readonly string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
```

with:

```ts
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
/** What people call an overlay of each lane. */
const OVERLAY_NOUNS: Record<OverlayKind, string> = { zoom: 'zoom', mask: 'mask', caption: 'caption', motion: 'motion overlay' };
const list = (items: readonly string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
```

In the same file, replace:

```ts
  const checks: string[] = [];
  const off = project.masks.filter((mask) => !mask.enabled).length;
  if (off > 0) checks.push(`${count(off, 'mask')} ${off === 1 ? 'is off: what it covers shows' : 'are off: what they cover shows'} in the video.`);
  const cut = (['zoom', 'mask', 'caption'] as const).filter((kind) => model.lanes[kind].cutOut > 0);
  const cutTotal = cut.reduce((sum, kind) => sum + model.lanes[kind].cutOut, 0);
  if (cutTotal > 0) {
    checks.push(`${list(cut.map((kind) => count(model.lanes[kind].cutOut, kind)))} ${cutTotal === 1 ? 'is cut out: no clip shows it' : 'are cut out: no clip shows them'}.`);
  }
  const shortest = new Map<number, number>();
  for (const block of model.lanes.caption.blocks) shortest.set(block.item, Math.min(shortest.get(block.item) ?? Infinity, block.end - block.start));
```

with:

```ts
  const checks: string[] = [];
  const off = project.masks.filter((mask) => !mask.enabled).length;
  if (off > 0) checks.push(`${count(off, 'mask')} ${off === 1 ? 'is off: what it covers shows' : 'are off: what they cover shows'} in the video.`);
  const cut = (['zoom', 'mask', 'caption', 'motion'] as const).filter((kind) => model.lanes[kind].cutOut > 0);
  const cutTotal = cut.reduce((sum, kind) => sum + model.lanes[kind].cutOut, 0);
  if (cutTotal > 0) {
    checks.push(`${list(cut.map((kind) => count(model.lanes[kind].cutOut, OVERLAY_NOUNS[kind])))} ${cutTotal === 1 ? 'is cut out: no clip shows it' : 'are cut out: no clip shows them'}.`);
  }
  const shortest = new Map<number, number>();
  for (const block of model.lanes.caption.blocks) shortest.set(block.item, Math.min(shortest.get(block.item) ?? Infinity, block.end - block.start));
```

In `apps/desktop/src/shared/document.ts`, replace:

```ts

export type Raw = Record<string, unknown>;
export type ListName = IdList;
export type OverlayList = 'zooms' | 'masks' | 'texts';
type Item = Record<string, unknown>;

/** What a command may need to clamp to: the take's length and the screen's size. */
```

with:

```ts

export type Raw = Record<string, unknown>;
export type ListName = IdList;
export type OverlayList = 'zooms' | 'masks' | 'texts' | 'overlays';
type Item = Record<string, unknown>;

/** What a command may need to clamp to: the take's length and the screen's size. */
```

In the same file, replace:

```ts

/** Gives every scene, overlay and cut without an id one (`s3`, `z1` …); returns the same object when all have one. */
export function ensureIds(raw: Raw): Raw {
  const lists = (['scenes', 'zooms', 'masks', 'texts', 'cuts'] as const).filter((list) => items(raw, list).some((item) => typeof item.id !== 'string'));
  if (lists.length === 0) return raw;
  const next = structuredClone(raw);
  const taken = usedIds(next);
```

with:

```ts

/** Gives every scene, overlay and cut without an id one (`s3`, `z1` …); returns the same object when all have one. */
export function ensureIds(raw: Raw): Raw {
  const lists = (['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts'] as const).filter((list) => items(raw, list).some((item) => typeof item.id !== 'string'));
  if (lists.length === 0) return raw;
  const next = structuredClone(raw);
  const taken = usedIds(next);
```

In the same file, replace:

```ts
      if ((to - from) / speed < 1 / (limits.fps ?? 30) - 1e-9) throw new DocumentError('invalid', `the clip is too short for ${round(speed)}×`);
      item.speed = round(speed);
      touched.push(['scenes', item]);
      // Zooms and captions inside the clip keep their output length: a 3 s caption stays 3 s at 12×.
      for (const name of ['zooms', 'texts'] as const) {
        for (const overlay of items(next, name)) {
          const at = Number(overlay.at);
          const duration = Number(overlay.duration);
```

with:

```ts
      if ((to - from) / speed < 1 / (limits.fps ?? 30) - 1e-9) throw new DocumentError('invalid', `the clip is too short for ${round(speed)}×`);
      item.speed = round(speed);
      touched.push(['scenes', item]);
      // Zooms, captions and motion overlays inside the clip keep their output length: a 3 s caption stays 3 s at 12×.
      for (const name of ['zooms', 'texts', 'overlays'] as const) {
        for (const overlay of items(next, name)) {
          const at = Number(overlay.at);
          const duration = Number(overlay.duration);
```

In the same file, replace:

```ts
  return changeParts(before, after).join(' · ') || 'no visible change';
}

/** The first item added or changed between two versions (scenes, then zooms, masks, captions, cuts), to show it. */
export function firstChanged(before: CuttleProject, after: CuttleProject): { list: ListName; id: string } | undefined {
  for (const list of ['scenes', 'zooms', 'masks', 'texts', 'cuts'] as const) {
    const old = new Map(before[list].map((item) => [item.id, JSON.stringify(item)]));
    const found = after[list].find((item) => item.id !== undefined && old.get(item.id) !== JSON.stringify(item));
    if (found?.id) return { list, id: found.id };
```

with:

```ts
  return changeParts(before, after).join(' · ') || 'no visible change';
}

/** The first item added or changed between two versions (scenes, then zooms, masks, captions, motion overlays, cuts), to show it. */
export function firstChanged(before: CuttleProject, after: CuttleProject): { list: ListName; id: string } | undefined {
  for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts'] as const) {
    const old = new Map(before[list].map((item) => [item.id, JSON.stringify(item)]));
    const found = after[list].find((item) => item.id !== undefined && old.get(item.id) !== JSON.stringify(item));
    if (found?.id) return { list, id: found.id };
```

In the same file, replace:

```ts

function changeParts(before: CuttleProject, after: CuttleProject): string[] {
  const parts: string[] = [];
  for (const list of ['scenes', 'zooms', 'masks', 'texts', 'cuts'] as const) {
    const key = (item: { id?: string }, index: number) => item.id ?? `#${index}`;
    const old = new Map(before[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
    const now = new Map(after[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
```

with:

```ts

function changeParts(before: CuttleProject, after: CuttleProject): string[] {
  const parts: string[] = [];
  for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts'] as const) {
    const key = (item: { id?: string }, index: number) => item.id ?? `#${index}`;
    const old = new Map(before[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
    const now = new Map(after[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
```

In `apps/desktop/src/shared/edit.ts`, replace:

```ts
}

/** The fields that give an overlay of `list` the source range [from, to). */
export function rangeFields(list: 'zooms' | 'masks' | 'texts', from: number, to: number): Record<string, number> {
  return list === 'masks' ? { from, to } : { at: from, duration: to - from };
}
```

with:

```ts
}

/** The fields that give an overlay of `list` the source range [from, to). */
export function rangeFields(list: 'zooms' | 'masks' | 'texts' | 'overlays', from: number, to: number): Record<string, number> {
  return list === 'masks' ? { from, to } : { at: from, duration: to - from };
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node apps/desktop/test/timeline-model.test.ts apps/desktop/test/document.test.ts`
Expected: PASS.

- [ ] **Step 4: "+ Motion"**

In `apps/desktop/src/renderer/editor/actions.ts`, replace:

```ts
// The editor's actions on the document (the timeline bar, the keys, the command menu and the tools
// call these): each is one step to undo. Where the playhead stands decides where things go.
import type { ClipScene, CuttleProject, Scene } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks, TEXT_FADE_SECONDS, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
```

with:

```ts
// The editor's actions on the document (the timeline bar, the keys, the command menu and the tools
// call these): each is one step to undo. Where the playhead stands decides where things go.
import { MOTION_TEMPLATES } from '@cuttle/motion-kit';
import type { ClipScene, CuttleProject, Scene } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks, TEXT_FADE_SECONDS, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
```

In the same file, replace:

```ts
export const NEW_OVERLAY_SECONDS = 3;
export const SPEEDS = [1, 2, 4, 8, 12, 20] as const;

export const LIST_OF: Record<Selection['kind'], ListName> = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', cut: 'cuts', crop: 'scenes' };
/** What people call a scene of each type. */
const SCENE_NOUNS: Record<Scene['type'], string> = { clip: 'clip', still: 'page', card: 'card', motion: 'motion scene' };
const NAMES: Record<ListName, string> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', overlays: 'motion overlay', cuts: 'cut' };
```

with:

```ts
export const NEW_OVERLAY_SECONDS = 3;
export const SPEEDS = [1, 2, 4, 8, 12, 20] as const;

export const LIST_OF: Record<Selection['kind'], ListName> = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', motion: 'overlays', cut: 'cuts', crop: 'scenes' };
/** What people call a scene of each type. */
const SCENE_NOUNS: Record<Scene['type'], string> = { clip: 'clip', still: 'page', card: 'card', motion: 'motion scene' };
const NAMES: Record<ListName, string> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', overlays: 'motion overlay', cuts: 'cut' };
```

In the same file, replace:

```ts
  if (added) select({ kind, id: added });
}

const itemIds = (project: CuttleProject | undefined) => (project ? [...project.scenes, ...project.zooms, ...project.masks, ...project.texts].map((item) => item.id!).filter(Boolean) : []);

/** A zoom at the playhead: 3 output seconds (so it rests at full zoom for a while), on the middle half of the screen; then the source view to place it. */
export function addZoom(rect?: number[]): void {
```

with:

```ts
  if (added) select({ kind, id: added });
}

const itemIds = (project: CuttleProject | undefined) =>
  project ? [...project.scenes, ...project.zooms, ...project.masks, ...project.texts, ...project.overlays].map((item) => item.id!).filter(Boolean) : [];

/** A zoom at the playhead: 3 output seconds (so it rests at full zoom for a while), on the middle half of the screen; then the source view to place it. */
export function addZoom(rect?: number[]): void {
```

In the same file, replace:

```ts
  addAndSelect({ type: 'add', list: 'scenes', index: insertIndex(), item: { type: 'still', image: chosen.path, duration: 4, motion: 'scroll', frame: 'browser-light' } }, 'scene', 'Add page');
}

/** Replaces a still's image or the background's with one the person picks. */
export async function chooseImage(purpose: 'still' | 'background', id?: string): Promise<void> {
  const chosen = await bridge.invoke('project:import-image', { purpose });
```

with:

```ts
  addAndSelect({ type: 'add', list: 'scenes', index: insertIndex(), item: { type: 'still', image: chosen.path, duration: 4, motion: 'scroll', frame: 'browser-light' } }, 'scene', 'Add page');
}

/** "lower-third" (or "lower-third-2", a second copy) as a label: "Lower third". */
export const templateLabel = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-\d+$/, '').replace(/-/g, ' ')}`;

/**
 * A motion template of the kit: its page is copied into the project's `motion/` folder, and it goes
 * in as a scene after the scene under the playhead, or as an overlay on the clip there (one that
 * follows the take, over all the clips). The playhead moves to it.
 */
export async function addMotion(name: string): Promise<void> {
  const template = MOTION_TEMPLATES.find((candidate) => candidate.name === name);
  const project = documentProject();
  if (!template || !project) return;
  if (store.get().doc?.issues) return toast('cuttle.json has a mistake; fix it first (Claude or a text editor), then edit here again.', { tone: 'warning' });
  const clips = project.scenes.filter((scene): scene is ClipScene => scene.type === 'clip');
  const place = playheadPlace();
  if (template.kind === 'overlay' && clips.length === 0) return toast('A motion overlay goes over a clip, and this video has none: add a motion scene instead.', { tone: 'warning' });
  if (template.kind === 'overlay' && !template.whole && !place?.clip) return toast('A motion overlay goes on a clip: move the playhead onto one.', { tone: 'warning' });
  let src: string;
  try {
    ({ src } = await bridge.invoke('motion:add-template', name));
  } catch (error) {
    return toast(`The template could not be copied: ${error instanceof Error ? error.message : String(error)}`, { tone: 'warning' });
  }
  const label = templateLabel(src.split('/')[1] ?? name);
  let command: Extract<Command, { type: 'add' }>;
  if (template.kind === 'scene') command = { type: 'add', list: 'scenes', index: insertIndex(), item: { type: 'motion', label, src, duration: template.duration } };
  else if (template.whole) {
    const at = Math.min(...clips.map((clip) => clip.from));
    command = { type: 'add', list: 'overlays', item: { label, src, at, duration: Math.max(...clips.map((clip) => clip.to)) - at } };
  } else {
    const clip = place!.clip!;
    const at = place!.source!;
    command = { type: 'add', list: 'overlays', item: { label, src, at, duration: Math.max(0.1, Math.min(template.duration * clip.speed, clip.to - at)) } };
  }
  const before = new Set(itemIds(documentProject()));
  if (!edit([command], `Add ${label}`)) return;
  const added = itemIds(documentProject()).find((id) => !before.has(id));
  if (added) reveal(command.list, added);
}

/** Replaces a still's image or the background's with one the person picks. */
export async function chooseImage(purpose: 'still' | 'background', id?: string): Promise<void> {
  const chosen = await bridge.invoke('project:import-image', { purpose });
```

In the same file, replace:

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

with:

```ts
  else edit([{ type: 'look', path: ['background'], value: { preset: 'image', image: chosen.path } }], 'Background image');
}

/** What selecting an item of each list selects. */
const KIND_OF: Record<ListName, Selection['kind']> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', overlays: 'motion', cuts: 'cut' };

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

In `apps/desktop/src/renderer/editor/commands.ts`, replace:

```ts
// Everything the editor can do by name, with its keys: the command menu (Ctrl+K) lists these, and
// the keyboard runs them. Keys are written as the menu shows them.
import { bridge } from '../bridge';
import { addCard, addMask, addPage, addZoom, autoZoomClicks, cycleSpeed, deleteSelection, duplicateSelection, overlayBlocked, selectedOrCurrentClip, setSpeed, showRawTake, split } from './actions';
import { redo, undo } from './doc';
import { currentPlayer, openExport, select, setTool, store } from './session';
```

with:

```ts
// Everything the editor can do by name, with its keys: the command menu (Ctrl+K) lists these, and
// the keyboard runs them. Keys are written as the menu shows them.
import { MOTION_TEMPLATES } from '@cuttle/motion-kit';
import { bridge } from '../bridge';
import {
  addCard,
  addMask,
  addMotion,
  addPage,
  addZoom,
  autoZoomClicks,
  cycleSpeed,
  deleteSelection,
  duplicateSelection,
  overlayBlocked,
  selectedOrCurrentClip,
  setSpeed,
  showRawTake,
  split,
  templateLabel,
} from './actions';
import { redo, undo } from './doc';
import { currentPlayer, openExport, select, setTool, store } from './session';
```

In the same file, replace:

```ts
    { id: 'add-caption', name: 'Add a caption at the playhead (type it on the video)', group: 'Add', run: () => setTool('caption'), blocked: () => overlayBlocked() },
    { id: 'add-card', name: 'Add a title card', group: 'Add', run: addCard },
    { id: 'add-page', name: 'Add a page (an image)…', group: 'Add', run: () => void addPage() },
    { id: 'tool-select', name: 'Select tool', keys: 'V', group: 'Tools', run: () => setTool('select') },
    { id: 'tool-zoom', name: 'Zoom tool: draw a zoom on the video', keys: 'Z', group: 'Tools', run: () => setTool('zoom'), blocked: () => overlayBlocked() },
    { id: 'tool-mask', name: 'Mask tool: draw a mask on the video', keys: 'M', group: 'Tools', run: () => setTool('mask'), blocked: () => overlayBlocked() },
```

with:

```ts
    { id: 'add-caption', name: 'Add a caption at the playhead (type it on the video)', group: 'Add', run: () => setTool('caption'), blocked: () => overlayBlocked() },
    { id: 'add-card', name: 'Add a title card', group: 'Add', run: addCard },
    { id: 'add-page', name: 'Add a page (an image)…', group: 'Add', run: () => void addPage() },
    ...MOTION_TEMPLATES.map(
      (template): EditorCommand => ({
        id: `add-motion-${template.name}`,
        name: `Add motion: ${templateLabel(template.name)}${template.kind === 'scene' ? '' : ' (over the video)'}`,
        keywords: `motion template animation ${template.kind} ${template.description}`,
        group: 'Add',
        run: () => void addMotion(template.name),
      }),
    ),
    { id: 'tool-select', name: 'Select tool', keys: 'V', group: 'Tools', run: () => setTool('select') },
    { id: 'tool-zoom', name: 'Zoom tool: draw a zoom on the video', keys: 'Z', group: 'Tools', run: () => setTool('zoom'), blocked: () => overlayBlocked() },
    { id: 'tool-mask', name: 'Mask tool: draw a mask on the video', keys: 'M', group: 'Tools', run: () => setTool('mask'), blocked: () => overlayBlocked() },
```

- [ ] **Step 5: The lane and the strips**

In `apps/desktop/src/renderer/editor/Timeline.tsx`, replace:

```tsx
// scenes after move. The wheel scrolls along, Shift+wheel up and down, Ctrl+wheel zooms.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { CuttleProject, MarkerKind } from '@cuttle/project';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans } from '@cuttle/timeline';
import type { Command, OverlayList } from '../../shared/document';
```

with:

```tsx
// scenes after move. The wheel scrolls along, Shift+wheel up and down, Ctrl+wheel zooms.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { MOTION_TEMPLATES } from '@cuttle/motion-kit';
import type { CuttleProject, MarkerKind } from '@cuttle/project';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans } from '@cuttle/timeline';
import type { Command, OverlayList } from '../../shared/document';
```

In the same file, replace:

```tsx
} from '../../shared/timeline-model';
import { FitIcon } from '../icons';
import { Select } from '../Select';
import { addCard, addMask, addPage, addZoom, overlayBlocked, selectedOrCurrentClip, setSpeed, split, SPEEDS } from './actions';
import { audible } from './audio';
import { edit, fitLength, preview } from './doc';
import { beginGesture } from './gesture';
import { mediaUrl } from './media';
import { currentPlayer, select, setTool, shownProject, store, type Selection } from './session';
import { useStore } from './store';
```

with:

```tsx
} from '../../shared/timeline-model';
import { FitIcon } from '../icons';
import { Select } from '../Select';
import { addCard, addMask, addMotion, addPage, addZoom, overlayBlocked, selectedOrCurrentClip, setSpeed, split, SPEEDS, templateLabel } from './actions';
import { audible } from './audio';
import { edit, fitLength, preview } from './doc';
import { beginGesture } from './gesture';
import { mediaUrl } from './media';
import type { MotionStrip } from './motion';
import { currentPlayer, select, setTool, shownProject, store, type Selection } from './session';
import { useStore } from './store';
```

In the same file, replace:

```tsx
  { kind: 'zoom', name: 'Zoom', list: 'zooms' },
  { kind: 'mask', name: 'Mask', list: 'masks' },
  { kind: 'caption', name: 'Caption', list: 'texts' },
];
const NOUN: Record<OverlayKind, string> = { zoom: 'zoom', mask: 'mask', caption: 'caption' };
/** What an empty lane says: its key, and how to fill it. */
const LANE_HINTS: Record<OverlayKind, [string, string]> = {
  zoom: ['Z', 'and draw on the video: the part to zoom in on'],
  mask: ['M', 'and draw over what no one should see (a token, an address)'],
  caption: ['T', 'and type on the video'],
};
const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MAX_PPS = 400;
```

with:

```tsx
  { kind: 'zoom', name: 'Zoom', list: 'zooms' },
  { kind: 'mask', name: 'Mask', list: 'masks' },
  { kind: 'caption', name: 'Caption', list: 'texts' },
  { kind: 'motion', name: 'Motion', list: 'overlays' },
];
const NOUN: Record<OverlayKind, string> = { zoom: 'zoom', mask: 'mask', caption: 'caption', motion: 'motion overlay' };
/** What an empty lane says: its key, and how to fill it. */
const LANE_HINTS: Record<OverlayKind, [string, string]> = {
  zoom: ['Z', 'and draw on the video: the part to zoom in on'],
  mask: ['M', 'and draw over what no one should see (a token, an address)'],
  caption: ['T', 'and type on the video'],
  motion: ['+ Motion', 'a lower third, rings on the clicks, word-by-word captions, or a page Claude writes'],
};
const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MAX_PPS = 400;
```

In the same file, replace:

```tsx
    zoom: 8 + ROW * (model?.lanes.zoom.rows ?? 1),
    mask: 8 + ROW * (model?.lanes.mask.rows ?? 1),
    caption: 8 + ROW * (model?.lanes.caption.rows ?? 1),
  };
  const order = ['markers', 'ruler', 'video', 'zoom', 'mask', 'caption', 'mic', 'input'] as const;
  const tops = {} as Layout['tops'];
  let y = 0;
  for (const row of order) {
```

with:

```tsx
    zoom: 8 + ROW * (model?.lanes.zoom.rows ?? 1),
    mask: 8 + ROW * (model?.lanes.mask.rows ?? 1),
    caption: 8 + ROW * (model?.lanes.caption.rows ?? 1),
    motion: 8 + ROW * (model?.lanes.motion.rows ?? 1),
  };
  const order = ['markers', 'ruler', 'video', 'zoom', 'mask', 'caption', 'motion', 'mic', 'input'] as const;
  const tops = {} as Layout['tops'];
  let y = 0;
  for (const row of order) {
```

In the same file, replace:

```tsx
  useStore(store, (state) => state.format);
  const pps = useStore(store, (state) => state.pxPerSecond);
  const selection = useStore(store, (state) => state.selection);
  const snapOn = useStore(store, (state) => state.snap);
  const peaksState = useStore(store, (state) => state.mediaState.peaks.state);
  const peaksPath = useStore(store, (state) => state.mediaState.peaks.path);
```

with:

```tsx
  useStore(store, (state) => state.format);
  const pps = useStore(store, (state) => state.pxPerSecond);
  const selection = useStore(store, (state) => state.selection);
  const motionStatus = useStore(store, (state) => state.motionStatus);
  const snapOn = useStore(store, (state) => state.snap);
  const peaksState = useStore(store, (state) => state.mediaState.peaks.state);
  const peaksPath = useStore(store, (state) => state.mediaState.peaks.path);
```

In the same file, replace:

```tsx
                      </span>
                    )}
                    {model.lanes[lane.kind].blocks.map((block, index, blocks) => {
                      const blockLeft = block.start * pps;
                      const blockWidth = Math.max(6, (block.end - block.start) * pps);
                      const inset = Math.max(0, Math.min(view.left - blockLeft, blockWidth - LABEL_MIN_PX));
```

with:

```tsx
                      </span>
                    )}
                    {model.lanes[lane.kind].blocks.map((block, index, blocks) => {
                      const failed = lane.kind === 'motion' && motionStatus.some((entry) => entry.item === `overlays[${block.item}]` && entry.state === 'failed');
                      const blockLeft = block.start * pps;
                      const blockWidth = Math.max(6, (block.end - block.start) * pps);
                      const inset = Math.max(0, Math.min(view.left - blockLeft, blockWidth - LABEL_MIN_PX));
```

In the same file, replace:

```tsx
                        <button
                          // by the overlay and which of its blocks: a block keeps its element while it is dragged
                          key={`${block.id}#${blocks.slice(0, index).filter((other) => other.id === block.id).length}`}
                          className={`item ${lane.kind}${block.enabled ? '' : ' off'}${isSelected(selection, lane.kind, block.id) ? ' selected' : ''}${hovered === block.id ? ' linked' : ''}`}
                          onPointerEnter={() => setHovered(block.id)}
                          onPointerLeave={() => setHovered((id) => (id === block.id ? undefined : id))}
                          style={{ left: blockLeft, width: blockWidth, top: 4 + block.row * ROW }}
```

with:

```tsx
                        <button
                          // by the overlay and which of its blocks: a block keeps its element while it is dragged
                          key={`${block.id}#${blocks.slice(0, index).filter((other) => other.id === block.id).length}`}
                          className={`item ${lane.kind}${block.enabled ? '' : ' off'}${isSelected(selection, lane.kind, block.id) ? ' selected' : ''}${hovered === block.id ? ' linked' : ''}${failed ? ' failed' : ''}`}
                          onPointerEnter={() => setHovered(block.id)}
                          onPointerLeave={() => setHovered((id) => (id === block.id ? undefined : id))}
                          style={{ left: blockLeft, width: blockWidth, top: 4 + block.row * ROW }}
```

In the same file, replace:

```tsx
      <button className="act" onClick={() => void addPage()} disabled={broken} title="A page (an image, scrolled through) after the scene under the playhead">
        + Page
      </button>
      <span className="tl-status">{status}</span>
      {duration !== undefined && <LengthControl duration={duration} />}
      <div className="grow" />
```

with:

```tsx
      <button className="act" onClick={() => void addPage()} disabled={broken} title="A page (an image, scrolled through) after the scene under the playhead">
        + Page
      </button>
      <Select
        value={undefined}
        options={MOTION_TEMPLATES.map((template) => ({ value: template.name, label: templateLabel(template.name), note: template.kind === 'scene' ? 'scene' : template.whole ? 'over the take' : 'overlay' }))}
        onChange={(name) => void addMotion(name)}
        label="Add a motion template"
        variant="bare"
        disabled={broken}
        className="act motion-add"
        testId="add-motion"
        title="Motion from the kit's templates: a scene after the scene under the playhead, or an overlay on the video. Claude can change its page, or write one of its own."
      >
        + Motion
      </Select>
      <span className="tl-status">{status}</span>
      {duration !== undefined && <LengthControl duration={duration} />}
      <div className="grow" />
```

In the same file, replace:

```tsx
  );
});

function Scene(props: { scene: SceneBlock; project: CuttleProject; pps: number; view: { left: number; width: number }; selected: boolean; moving: boolean; onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void }) {
  const { scene, project, pps, view, selected, onPointerDown } = props;
  const thumbState = useStore(store, (state) => state.mediaState.thumbnails.state);
  const thumbPath = useStore(store, (state) => state.mediaState.thumbnails.path);
  const interval = useStore(store, (state) => state.mediaState.thumbnails.interval);
```

with:

```tsx
  );
});

/**
 * Frames across a motion scene for its block, drawn by its page: asked for again a moment after the
 * project or its files change (an unchanged scene answers at once, with nothing to draw).
 */
function useMotionStrip(scene: SceneBlock, project: CuttleProject, height: number): MotionStrip | undefined {
  const files = useStore(store, (state) => state.motionFiles);
  const [strip, setStrip] = useState<{ id: string; strip: MotionStrip }>();
  const motion = scene.kind === 'motion';
  useEffect(() => {
    if (!motion) return;
    let live = true;
    const timer = setTimeout(() => {
      void currentPlayer()
        ?.motionStrip(scene.index, height)
        .then((next) => live && next && setStrip({ id: scene.id, strip: next }), () => {});
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [motion, scene.index, scene.id, project, files, height]);
  return strip?.id === scene.id ? strip.strip : undefined;
}

function Scene(props: { scene: SceneBlock; project: CuttleProject; pps: number; view: { left: number; width: number }; selected: boolean; moving: boolean; onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void }) {
  const { scene, project, pps, view, selected, onPointerDown } = props;
  const failed = useStore(store, (state) => (scene.kind === 'motion' ? state.motionStatus.find((entry) => entry.item === `scenes[${scene.index}]` && entry.state === 'failed') : undefined));
  const thumbState = useStore(store, (state) => state.mediaState.thumbnails.state);
  const thumbPath = useStore(store, (state) => state.mediaState.thumbnails.path);
  const interval = useStore(store, (state) => state.mediaState.thumbnails.interval);
```

In the same file, replace:

```tsx
      tiles.push({ x: i * tileWidth, index: Math.min(count - 1, Math.max(0, Math.floor(source / interval!))) });
    }
  }
  const kindClass = scene.kind === 'clip' ? '' : ` ${scene.kind}`;
  const speed = scene.speed !== undefined && scene.speed !== 1 ? `${Math.round(scene.speed * 10) / 10}×` : '';
  const name = [speed, scene.title].filter(Boolean).join(' ');
```

with:

```tsx
      tiles.push({ x: i * tileWidth, index: Math.min(count - 1, Math.max(0, Math.floor(source / interval!))) });
    }
  }
  // a motion scene: its page's frames, each tile the frame nearest its time
  const strip = useMotionStrip(scene, project, tileHeight * 2);
  const motionTiles: { x: number; width: number; url: string }[] = [];
  if (strip && width > 0) {
    const tile = Math.max(8, Math.round((tileHeight * project.output.width) / project.output.height));
    const from = Math.max(0, Math.floor((view.left - left) / tile));
    const to = Math.min(Math.ceil(width / tile), Math.ceil((view.left + view.width - left) / tile) + 1);
    for (let i = from; i < to; i++) {
      const frame = (((i + 0.5) * tile) / pps) * project.output.fps;
      let nearest = 0;
      strip.frames.forEach((candidate, k) => {
        if (Math.abs(candidate - frame) < Math.abs(strip.frames[nearest]! - frame)) nearest = k;
      });
      motionTiles.push({ x: i * tile, width: tile, url: strip.urls[nearest]! });
    }
  }
  const kindClass = scene.kind === 'clip' ? '' : ` ${scene.kind}`;
  const speed = scene.speed !== undefined && scene.speed !== 1 ? `${Math.round(scene.speed * 10) / 10}×` : '';
  const name = [speed, scene.title].filter(Boolean).join(' ');
```

In the same file, replace:

```tsx
  const scale = tileHeight / thumbHeight;
  return (
    <button
      className={`scene${kindClass}${selected ? ' selected' : ''}${props.moving ? ' moving' : ''}`}
      style={{ left, width: Math.max(4, width - 2) }}
      title={`${name} · ${scene.detail} · drag to move, edges to trim`}
      data-id={scene.id}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => event.key === 'Enter' && select({ kind: 'scene', id: scene.id })}
    >
      {ready && tiles.length > 0 && (
        <span className="thumbs">
          {tiles.map((tile) => (
```

with:

```tsx
  const scale = tileHeight / thumbHeight;
  return (
    <button
      className={`scene${kindClass}${selected ? ' selected' : ''}${props.moving ? ' moving' : ''}${failed ? ' failed' : ''}`}
      style={{ left, width: Math.max(4, width - 2) }}
      title={failed ? `${name} · its page cannot draw: ${failed.failure ?? 'it failed'}` : `${name} · ${scene.detail} · drag to move, edges to trim`}
      data-id={scene.id}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => event.key === 'Enter' && select({ kind: 'scene', id: scene.id })}
    >
      {motionTiles.length > 0 && (
        <span className="thumbs">
          {motionTiles.map((tile) => (
            <i key={tile.x} style={{ left: tile.x, width: tile.width, backgroundImage: `url("${tile.url}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
          ))}
        </span>
      )}
      {ready && tiles.length > 0 && (
        <span className="thumbs">
          {tiles.map((tile) => (
```

- [ ] **Step 6: The motion panel**

In `apps/desktop/src/renderer/icons.tsx`, replace:

```tsx
    <path d="M5 7h6M6 9.5h4" />
  </>,
);
export const PageIcon = icon(<path d="M4 2h5.5L12 4.5V14H4zM9.5 2v2.5H12M6 7.5h4M6 10h4" />);
export const MicIcon = icon(
  <>
```

with:

```tsx
    <path d="M5 7h6M6 9.5h4" />
  </>,
);
/** Motion: a spark, and a small one. */
export const MotionIcon = icon(
  <>
    <path d="M6.5 2.2 7.8 5.7l3.5 1.3-3.5 1.3-1.3 3.5-1.3-3.5L1.7 7l3.5-1.3z" />
    <path d="m12.2 10.2.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" />
  </>,
);
export const PageIcon = icon(<path d="M4 2h5.5L12 4.5V14H4zM9.5 2v2.5H12M6 7.5h4M6 10h4" />);
export const MicIcon = icon(
  <>
```

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```tsx
  type AutoEdits,
  type AutoKind,
  type CuttleProject,
  type Rect,
} from '@cuttle/project';
import { sceneSpans, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import { formatDuration, formatSource, formatSpeed, formatTime } from '../../shared/format';
import {
  BACKGROUND_NAMES,
```

with:

```tsx
  type AutoEdits,
  type AutoKind,
  type CuttleProject,
  type MotionOverlay,
  type MotionScene,
  type Rect,
} from '@cuttle/project';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { sceneSpans, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import type { MotionParams, MotionStatusView } from '../../shared/ipc';
import { formatDuration, formatSource, formatSpeed, formatTime } from '../../shared/format';
import {
  BACKGROUND_NAMES,
```

In the same file, replace:

```tsx
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { motionName, outputTimesOf } from '../../shared/timeline-model';
import { BackgroundIcon, CameraIcon, CardIcon, CheckIcon, ChevronIcon, CopyIcon, CropIcon, FilmIcon, MaskIcon, PageIcon, SelectIcon, SoundIcon, SplitIcon, SubtitlesIcon, TextIcon, TrashIcon, WindowIcon, ZoomIcon } from '../icons';
import { Select as StyledSelect } from '../Select';
import { chooseImage, cutShownAt, deleteSelection, duplicateSelection, LIST_OF, playheadPlace, reveal, SPEEDS } from './actions';
import { edit, preview } from './doc';
```

with:

```tsx
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { motionName, outputTimesOf } from '../../shared/timeline-model';
import {
  BackgroundIcon,
  CameraIcon,
  CardIcon,
  CheckIcon,
  ChevronIcon,
  CopyIcon,
  CropIcon,
  FilmIcon,
  MaskIcon,
  MotionIcon,
  PageIcon,
  SelectIcon,
  SoundIcon,
  SplitIcon,
  SubtitlesIcon,
  TextIcon,
  TrashIcon,
  WindowIcon,
  ZoomIcon,
} from '../icons';
import { bridge } from '../bridge';
import { Select as StyledSelect } from '../Select';
import { chooseImage, cutShownAt, deleteSelection, duplicateSelection, LIST_OF, playheadPlace, reveal, SPEEDS } from './actions';
import { edit, preview } from './doc';
```

In the same file, replace:

```tsx
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
```

with:

```tsx
    }
    if (scene.type === 'motion') {
      return (
        <MotionDetails
          list="scenes"
          index={sceneIndex}
          item={scene}
          placement={
            <>
              {inVideo}
              <Row label="Length (s)">
                <NumberInput value={scene.duration} min={0.1} onCommit={(duration) => edit([{ type: 'trim', id, duration }], 'Change the length of the motion scene')} testId="motion-length" />
              </Row>
            </>
          }
        />
      );
    }
    return (
```

In the same file, replace:

```tsx
  }

  /** An overlay's place: in the video (read), its start in source seconds, its length in the video. */
  const timing = (list: 'zooms' | 'texts' | 'masks', from: number, to: number) => {
    const stretch = stretchOf(project, selection, from, to);
    const label = list === 'masks' ? 'mask' : list === 'zooms' ? 'zoom' : 'caption';
    return (
      <>
        <Row label="Shows at" note={formatSource(from)}>
```

with:

```tsx
  }

  /** An overlay's place: in the video (read), its start in source seconds, its length in the video. */
  const timing = (list: 'zooms' | 'texts' | 'masks' | 'overlays', from: number, to: number) => {
    const stretch = stretchOf(project, selection, from, to);
    const label = list === 'masks' ? 'mask' : list === 'zooms' ? 'zoom' : list === 'overlays' ? 'motion overlay' : 'caption';
    const testId = list === 'overlays' ? 'motion' : label;
    return (
      <>
        <Row label="Shows at" note={formatSource(from)}>
```

In the same file, replace:

```tsx
        ) : (
          <div className="grid2">
            <Row label="Start (take s)">
              <NumberInput value={from} min={0} onCommit={(at) => set(list, id, { at }, `Move ${label}`)} testId={`${label}-at`} />
            </Row>
            <Row label="Length (s)" note={stretch && stretch.speed !== 1 ? `${formatDuration(to - from)} src` : undefined}>
              <NumberInput
                value={stretch ? (to - from) / stretch.speed : to - from}
                min={0.05}
                onCommit={(length) => set(list, id, { duration: length * (stretch?.speed ?? 1) }, `Change the length of the ${label}`)}
                testId={`${label}-length`}
              />
            </Row>
          </div>
```

with:

```tsx
        ) : (
          <div className="grid2">
            <Row label="Start (take s)">
              <NumberInput value={from} min={0} onCommit={(at) => set(list, id, { at }, `Move ${label}`)} testId={`${testId}-at`} />
            </Row>
            <Row label="Length (s)" note={stretch && stretch.speed !== 1 ? `${formatDuration(to - from)} src` : undefined}>
              <NumberInput
                value={stretch ? (to - from) / stretch.speed : to - from}
                min={0.05}
                onCommit={(length) => set(list, id, { duration: length * (stretch?.speed ?? 1) }, `Change the length of the ${label}`)}
                testId={`${testId}-length`}
              />
            </Row>
          </div>
```

In the same file, replace:

```tsx
    </div>
  );

  const enabled = (list: 'zooms' | 'masks' | 'texts', on: boolean, label: string) => (
    <Row label="Show" inline>
      <em>{on ? 'On' : 'Off: kept, not in the video'}</em>
      <Toggle checked={on} label={`Show the ${label}`} onChange={(value) => set(list, id, { enabled: value ? undefined : false }, value ? `Turn ${label} on` : `Turn ${label} off`)} />
```

with:

```tsx
    </div>
  );

  const enabled = (list: 'zooms' | 'masks' | 'texts' | 'overlays', on: boolean, label: string) => (
    <Row label="Show" inline>
      <em>{on ? 'On' : 'Off: kept, not in the video'}</em>
      <Toggle checked={on} label={`Show the ${label}`} onChange={(value) => set(list, id, { enabled: value ? undefined : false }, value ? `Turn ${label} on` : `Turn ${label} off`)} />
```

In the same file, replace:

```tsx
      </>
    );
  }
  const text = project.texts.find((item) => item.id === id)!;
  return (
    <>
```

with:

```tsx
      </>
    );
  }
  if (selection.kind === 'motion') {
    const index = project.overlays.findIndex((item) => item.id === id);
    const overlay = project.overlays[index]!;
    return (
      <MotionDetails
        list="overlays"
        index={index}
        item={overlay}
        placement={
          <>
            {timing('overlays', overlay.at, overlay.at + overlay.duration)}
            {enabled('overlays', overlay.enabled, 'motion overlay')}
          </>
        }
      />
    );
  }
  const text = project.texts.find((item) => item.id === id)!;
  return (
    <>
```

In the same file, replace:

```tsx
  );
}

// ---- the look ------------------------------------------------------------------------------------

const look = (path: string[], value: unknown, label: string) => edit([{ type: 'look', path, value } as Command], label);
```

with:

```tsx
  );
}

// ---- motion --------------------------------------------------------------------------------------

/** The params a page declares, read again when the project's files change (Claude edited the page). */
function useMotionParams(src: string): MotionParams | undefined {
  const files = useStore(store, (state) => state.motionFiles);
  const [read, setRead] = useState<{ src: string; params: MotionParams }>();
  useEffect(() => {
    let live = true;
    bridge.invoke('motion:params', src).then(
      (params) => live && setRead({ src, params }),
      (error: Error) => live && setRead({ src, params: { params: [], issues: [error.message] } }),
    );
    return () => {
      live = false;
    };
  }, [src, files]);
  return read?.src === src ? read.params : undefined;
}

const BLUR_SAMPLES = ['4', '8', '16', '32'] as const;

/**
 * A motion scene or overlay: its page and how it is doing in the preview (what it threw, its
 * console), its place (`placement`), the params its page declares, the internet and motion blur.
 */
function MotionDetails({ list, index, item, placement }: { list: 'scenes' | 'overlays'; index: number; item: MotionScene | MotionOverlay; placement: ReactNode }) {
  const id = item.id!;
  const name = `${list}[${index}]`;
  const status = useStore(store, (state) => state.motionStatus.find((entry) => entry.item === name && entry.src === item.src));
  const declared = useMotionParams(item.src);
  const noun = list === 'scenes' ? 'motion scene' : 'motion overlay';
  const blur = item.motionBlur;
  return (
    <>
      <Head icon={<MotionIcon />} color="var(--motion)" name={item.label ?? motionName(item.src)} />
      <MotionState status={status} />
      <Row label="Label">
        <TextInput value={item.label ?? ''} placeholder={motionName(item.src)} onCommit={(value) => set(list, id, { label: value.trim() || undefined }, `Rename ${noun}`)} testId="motion-label" />
      </Row>
      <div className="field">
        <span className="field-label">
          Page
          <span className="links">
            <button type="button" className="link" onClick={() => void bridge.invoke('project:reveal', item.src)} title="Show the page's file in its folder">
              Show file
            </button>
            <button type="button" className="link" onClick={() => void bridge.invoke('motion:reload', name)} title="Load the page again" data-testid="motion-reload">
              Reload
            </button>
          </span>
        </span>
        <span className="field-input">
          <span className="path" title={item.src}>
            {item.src}
          </span>
        </span>
      </div>
      {placement}
      {declared && <MotionParamFields list={list} id={id} item={item} declared={declared} />}
      <Row label="Internet" inline>
        <em title={item.network ? 'The page may load fonts, images and data from https: addresses' : 'The page reaches only the project folder and the motion kit'}>{item.network ? 'On' : 'Off'}</em>
        <Toggle checked={item.network} label="Let the page load from the internet" onChange={(on) => set(list, id, { network: on || undefined }, on ? 'Let the page load from the internet' : 'Keep the page offline')} testId="motion-network" />
      </Row>
      <Row label="Motion blur" inline>
        <em title="Each frame is the average of moments while a shutter would be open: smooth fast motion, drawn that many times (slower)">{blur ? 'On' : 'Off'}</em>
        <Toggle checked={!!blur} label="Motion blur" onChange={(on) => set(list, id, { motionBlur: on ? { samples: 8, shutter: 0.5 } : undefined }, on ? 'Motion blur on' : 'Motion blur off')} testId="motion-blur" />
      </Row>
      {blur && (
        <div className="grid2">
          <Row label="Samples">
            <StyledSelect
              value={String(blur.samples)}
              options={[...new Set([...BLUR_SAMPLES, String(blur.samples)])].map((samples) => ({ value: samples, label: samples }))}
              onChange={(samples) => set(list, id, { motionBlur: { ...blur, samples: Number(samples) } }, 'Change motion blur')}
              label="Samples"
            />
          </Row>
          <Row label="Shutter" note="of a frame">
            <NumberInput value={blur.shutter} min={0.05} max={1} step={0.05} onCommit={(shutter) => set(list, id, { motionBlur: { ...blur, shutter } }, 'Change motion blur')} />
          </Row>
        </div>
      )}
      <MotionLog status={status} />
      <p className="hint motion-hint">Claude can change this page or write a new one: ask it in Claude Code. Each saved change shows here at once.</p>
    </>
  );
}

/** How the page is doing in the preview. */
function MotionState({ status }: { status: MotionStatusView | undefined }) {
  if (!status) return null;
  const errors = status.errors.length;
  const text =
    status.state === 'failed'
      ? `The page cannot draw: ${status.failure ?? 'it failed'}`
      : status.state === 'loading'
        ? 'Loading the page…'
        : errors > 0
          ? `Draws, but threw ${errors === 1 ? 'an error' : `${errors} errors`}`
          : 'Ready';
  return (
    <p className={`motion-state ${status.state === 'ready' && errors > 0 ? 'warn' : status.state}`} data-testid="motion-state" title={text}>
      <i />
      {text}
    </p>
  );
}

/** What the page threw, and its console. */
function MotionLog({ status }: { status: MotionStatusView | undefined }) {
  if (!status || (status.errors.length === 0 && status.console.length === 0)) return null;
  return (
    <div className="motion-log">
      {status.errors.length > 0 && (
        <details open>
          <summary>Errors ({status.errors.length})</summary>
          <pre data-testid="motion-errors">{status.errors.join('\n')}</pre>
        </details>
      )}
      {status.console.length > 0 && (
        <details>
          <summary>Console ({status.console.length})</summary>
          <pre>{status.console.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}

/** The params the page declares, each in a field of its kind; ones the item has that the page does not declare, as text. */
function MotionParamFields({ list, id, item, declared }: { list: 'scenes' | 'overlays'; id: string; item: MotionScene | MotionOverlay; declared: MotionParams }) {
  const values = item.params;
  const command = (name: string, value: unknown): Command => {
    const next: Record<string, unknown> = { ...values };
    if (value === undefined) delete next[name];
    else next[name] = value;
    return { type: 'set', list, id, fields: { params: Object.keys(next).length > 0 ? next : undefined } };
  };
  const others = Object.keys(values).filter((name) => !declared.params.some((param) => param.name === name));
  if (declared.params.length === 0 && others.length === 0 && declared.issues.length === 0) return null;
  return (
    <div className="motion-params" data-testid="motion-params">
      <span className="section-title">Params</span>
      {declared.issues.map((issue) => (
        <p key={issue} className="note warning">
          {issue}
        </p>
      ))}
      {declared.params.map((param) => (
        <ParamField key={param.name} param={param} value={param.name in values ? values[param.name] : param.default} set={param.name in values} toCommand={(value) => command(param.name, value)} />
      ))}
      {others.map((name) => (
        <Row key={name} label={name} note="not declared by the page">
          <TextInput
            value={typeof values[name] === 'string' ? (values[name] as string) : JSON.stringify(values[name])}
            onCommit={(text) => {
              let value: unknown = text;
              try {
                value = JSON.parse(text);
              } catch {
                // plain text
              }
              edit([command(name, value)], `Change ${name}`);
            }}
          />
        </Row>
      ))}
    </div>
  );
}

/** One param: a field of its kind, live on the video while a slider or a colour moves; Reset back to the page's default. */
function ParamField({ param, value, set: isSet, toCommand }: { param: ParamDeclaration; value: unknown; set: boolean; toCommand: (value: unknown) => Command }) {
  const label = `Change ${param.label}`;
  const commit = (next: unknown) => edit([toCommand(next)], label);
  let input: ReactNode;
  switch (param.type) {
    case 'bool':
      input = <Toggle checked={value === true} label={param.label} onChange={(on) => commit(on)} testId={`param-${param.name}`} />;
      break;
    case 'select':
      input = (
        <StyledSelect
          value={String(value ?? '')}
          options={(param.options ?? []).map((option) => ({ value: option, label: option }))}
          onChange={(option) => commit(option)}
          label={param.label}
          testId={`param-${param.name}`}
        />
      );
      break;
    case 'number': {
      const number = typeof value === 'number' ? value : 0;
      const { min, max } = param;
      input = (
        <>
          {min !== undefined && max !== undefined && max > min && (
            <input
              key={number}
              type="range"
              className="range"
              min={min}
              max={max}
              step={(max - min) / 200}
              defaultValue={number}
              aria-label={param.label}
              onInput={(event) => preview([toCommand(Number((event.target as HTMLInputElement).value))])}
              onChange={(event) => {
                preview(undefined);
                commit(Number(event.target.value));
              }}
            />
          )}
          <span className="narrow">
            <NumberInput value={number} min={min} max={max} step={min !== undefined && max !== undefined ? (max - min) / 20 : 1} onCommit={commit} testId={`param-${param.name}`} />
          </span>
        </>
      );
      break;
    }
    case 'color':
      input = (
        <>
          <ColorInput value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#ffffff'} label={label} toCommand={(colour) => toCommand(colour)} />
          <TextInput value={String(value ?? '')} placeholder="#ffffff" onCommit={(text) => commit(text.trim() || undefined)} testId={`param-${param.name}`} />
        </>
      );
      break;
    case 'image':
      input = (
        <>
          <span className="path" title={String(value ?? '')}>
            {value ? String(value) : 'none'}
          </span>
          <button
            type="button"
            className="ghost small"
            onClick={() =>
              void bridge.invoke('project:import-image', { purpose: 'still' }).then((chosen) => {
                if (chosen) commit(chosen.path);
              })
            }
          >
            Choose…
          </button>
          {value ? (
            <button type="button" className="ghost small" onClick={() => commit(null)}>
              None
            </button>
          ) : null}
        </>
      );
      break;
    default: {
      const text = String(value ?? '');
      input = <TextInput value={text} multiline={text.includes('\n') || String(param.default ?? '').includes('\n')} onCommit={(next) => commit(next)} testId={`param-${param.name}`} />;
    }
  }
  return (
    <div className={`field${param.type === 'bool' ? ' inline' : ''}`}>
      <span className="field-label">
        {param.label}
        {isSet && (
          <button type="button" className="link" onClick={() => edit([toCommand(undefined)], `Reset ${param.label}`)} title={`Back to the page's default (${JSON.stringify(param.default)})`}>
            Reset
          </button>
        )}
      </span>
      <span className="field-input">{input}</span>
    </div>
  );
}

// ---- the look ------------------------------------------------------------------------------------

const look = (path: string[], value: unknown, label: string) => edit([{ type: 'look', path, value } as Command], label);
```

In `apps/desktop/src/renderer/tokens.css`, replace:

```css
  --caption: #4fd1a1;
  --still: #3cc6c9;
  --card: #f2b34a;
  --motion: #a78bfa;

  /* states */
  --recording: #ff4d4f;
```

with:

```css
  --caption: #4fd1a1;
  --still: #3cc6c9;
  --card: #f2b34a;
  --motion: #ec6fcf;

  /* states */
  --recording: #ff4d4f;
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```css
.app {
  display: grid;
  /* the video stays the largest part: the timeline takes a third of a small window */
  grid-template-rows: 44px minmax(0, 1fr) var(--timeline-height, clamp(220px, 34vh, 320px));
  /* the tools beside the video, the inspector on the right */
  grid-template-columns: 48px minmax(0, 1fr) 300px;
  height: 100%;
}
```

with:

```css
.app {
  display: grid;
  /* the video stays the largest part: the timeline takes about a third of a small window, its lanes all shown at 900 px */
  grid-template-rows: 44px minmax(0, 1fr) var(--timeline-height, clamp(220px, 36vh, 340px));
  /* the tools beside the video, the inspector on the right */
  grid-template-columns: 48px minmax(0, 1fr) 300px;
  height: 100%;
}
```

In the same file, replace:

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

with:

```css
  background: linear-gradient(180deg, rgba(242, 179, 74, 0.26), rgba(242, 179, 74, 0.1));
  box-shadow: inset 0 0 0 1px rgba(242, 179, 74, 0.45);
}
.scene.motion {
  background: linear-gradient(180deg, rgba(236, 111, 207, 0.26), rgba(236, 111, 207, 0.1));
  box-shadow: inset 0 0 0 1px rgba(236, 111, 207, 0.5);
}
.item {
  position: absolute;
  height: 18px;
```

In the same file, replace:

```css
  background: rgba(79, 209, 161, 0.13);
  box-shadow: inset 0 0 0 1px rgba(79, 209, 161, 0.5);
  color: var(--caption);
}
.item.off {
  background-image: repeating-linear-gradient(135deg, transparent 0 5px, rgba(255, 255, 255, 0.05) 5px 10px);
  opacity: 0.6;
}
```

with:

```css
  background: rgba(79, 209, 161, 0.13);
  box-shadow: inset 0 0 0 1px rgba(79, 209, 161, 0.5);
  color: var(--caption);
}
.item.motion {
  background: rgba(236, 111, 207, 0.14);
  box-shadow: inset 0 0 0 1px rgba(236, 111, 207, 0.5);
  color: var(--motion);
}
/* a motion item whose page cannot draw */
.scene.failed,
.item.failed {
  box-shadow: inset 0 0 0 1.5px var(--danger);
}
.item.failed {
  color: var(--danger);
}
.item.off {
  background-image: repeating-linear-gradient(135deg, transparent 0 5px, rgba(255, 255, 255, 0.05) 5px 10px);
  opacity: 0.6;
}
```

In the same file, replace:

```css
}
.tl-bar .act.speed .select-trigger {
  min-width: 52px;
}
/* what can be dragged says so */
.scene,
.item {
  cursor: grab;
```

with:

```css
}
.tl-bar .act.speed .select-trigger {
  min-width: 52px;
}
.tl-bar .select-trigger.motion-add {
  height: 26px;
  padding: 0 6px 0 8px;
  border-radius: 7px;
  gap: 4px;
}
.tl-bar .select-trigger.motion-add:hover:not(:disabled),
.tl-bar .select-trigger.motion-add[aria-expanded='true'] {
  background: var(--raised);
  color: var(--text);
}
/* what can be dragged says so */
.scene,
.item {
  cursor: grab;
```

In the same file, replace:

```css
.auto-note b {
  color: var(--text);
  font-weight: 600;
}
```

with:

```css
.auto-note b {
  color: var(--text);
  font-weight: 600;
}

/* a motion item in the inspector: how its page is doing in the preview, its params, what it said */
.motion-state {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -4px 0 0;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--raised);
  color: var(--muted);
  font-size: var(--size-s);
  line-height: 1.4;
}
.motion-state i {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--faint);
}
.motion-state.ready i {
  background: var(--ok);
}
.motion-state.warn i {
  background: var(--card);
}
.motion-state.loading i {
  background: var(--motion);
  animation: fade 0.8s ease-in-out infinite alternate;
}
.motion-state.failed {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}
.motion-state.failed i {
  background: var(--danger);
}
@media (prefers-reduced-motion: reduce) {
  :root:not([data-motion='full']) .motion-state.loading i {
    animation: none;
  }
}
:root[data-motion='reduce'] .motion-state.loading i {
  animation: none;
}
.field-label .links {
  display: flex;
  gap: 10px;
}
.motion-params {
  display: grid;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.motion-params .note.warning {
  margin: 0;
  color: var(--card);
  font-size: var(--size-s);
  line-height: 1.4;
}
.field-input > .narrow {
  flex: 0 0 76px;
  display: flex;
}
.motion-log {
  display: grid;
  gap: 6px;
}
.motion-log summary {
  cursor: pointer;
  color: var(--muted);
  font-size: var(--size-s);
}
.motion-log pre {
  margin: 6px 0 0;
  max-height: 180px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--raised);
  color: var(--muted);
  font: var(--size-xs) / 1.5 var(--mono);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
.motion-log details:first-child pre[data-testid='motion-errors'] {
  color: var(--danger);
}
.motion-hint {
  margin: 0;
  font-size: var(--size-xs);
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src apps/desktop/test/timeline-model.test.ts apps/desktop/test/document.test.ts
git commit -m "app: the Motion lane, frames on motion scenes, the motion panel (params, internet, motion blur, errors) and + Motion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The check and the guide

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`, `skill/cuttle/motion.md`

- [ ] **Step 1: The check**

It adds a template with "+ Motion", compares the editor's frames with `cuttle preview`'s, sets a param, edits the page as Claude would, plays, exports, and adds a page that throws:

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
  return { mean: sum / ((a.data.length / 4) * 3), max };
}

describe.runIf(enabled)('the Cuttle app', () => {
  let root: string;
  let project: string;
```

with:

```ts
  return { mean: sum / ((a.data.length / 4) * 3), max };
}

/** Waits for an export to be written; when it is not, the error says what the export sheet shows. */
async function exported(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid=export-file]', { timeout: 120_000 }).catch(async (error: Error) => {
    const sheet = await page.locator('[data-testid=export-sheet]').innerText().catch(() => '(no export sheet)');
    throw new Error(`${error.message}\nThe export sheet says: ${sheet}`);
  });
}

describe.runIf(enabled)('the Cuttle app', () => {
  let root: string;
  let project: string;
```

In the same file, replace:

```ts
    expect(await editor.locator('.format').first().textContent()).toContain('640×360');
    await shot('05-export-sheet');
    await editor.click('[data-testid=export-start]');
    await editor.waitForSelector('[data-testid=export-file]', { timeout: 120_000 });
    await shot('06-exported');
    const out = join(project, 'out', 'export.mp4');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/);
```

with:

```ts
    expect(await editor.locator('.format').first().textContent()).toContain('640×360');
    await shot('05-export-sheet');
    await editor.click('[data-testid=export-start]');
    await exported(editor);
    await shot('06-exported');
    const out = join(project, 'out', 'export.mp4');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/);
```

In the same file, replace:

```ts
    await page.waitForSelector('[data-testid=export-srt][aria-pressed=true]');
    await shotOf('30-export-subtitles', '/editor.html', 'subtitled · Cuttle');
    await click(page, '[data-testid=export-start]');
    await page.waitForSelector('[data-testid=export-file]', { timeout: 120_000 });
    expect(await page.locator('[data-testid=export-file] small').textContent()).toContain('with .srt');
    const srt = readFileSync(join(dir, 'out', 'export.srt'), 'utf8');
    expect(srt.startsWith('1\n00:00:00,100 --> ')).toBe(true);
```

with:

```ts
    await page.waitForSelector('[data-testid=export-srt][aria-pressed=true]');
    await shotOf('30-export-subtitles', '/editor.html', 'subtitled · Cuttle');
    await click(page, '[data-testid=export-start]');
    await exported(page);
    expect(await page.locator('[data-testid=export-file] small').textContent()).toContain('with .srt');
    const srt = readFileSync(join(dir, 'out', 'export.srt'), 'utf8');
    expect(srt.startsWith('1\n00:00:00,100 --> ')).toBe(true);
```

In the same file, replace:

```ts
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-sheet]');
    await page.click('[data-testid=export-start]');
    await page.waitForSelector('[data-testid=export-file]', { timeout: 120_000 });
    // a pixel of the video (rgb24 from ffmpeg; a crop of 2×2, since 4:2:0 video crops in pairs)
    const pixel = (seconds: number, x: number, y: number) => [
      ...spawnSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', join(dir, 'out', 'export.mp4'), '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { windowsHide: true }).stdout.subarray(0, 3),
```

with:

```ts
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-sheet]');
    await page.click('[data-testid=export-start]');
    await exported(page);
    // a pixel of the video (rgb24 from ffmpeg; a crop of 2×2, since 4:2:0 video crops in pairs)
    const pixel = (seconds: number, x: number, y: number) => [
      ...spawnSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', join(dir, 'out', 'export.mp4'), '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { windowsHide: true }).stdout.subarray(0, 3),
```

In the same file, replace:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion · Cuttle')?.close());
  }, 180_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

with:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion · Cuttle')?.close());
  }, 180_000);

  it('edits motion in the editor: + Motion adds a template drawn as the export draws it, a param and an edited page show at once, a page that throws says so', async () => {
    const dir = join(root, 'motion-editor');
    makeMotionFixture(dir);
    const page = await openEditor(dir);
    // the hook comes once the first frame is drawn
    await page.waitForFunction(() => '__cuttleCheck' in window);
    type Motion = { status: { item: string; src: string; state: string; errors: string[] }[]; files: number };
    const seekTo = (t: number) => page.evaluate((time) => (window as unknown as Hooked).__cuttleCheck.seek(time), t);
    const view = async () => decode(await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.pixels()));
    const now = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state() as CheckState & { motion: Motion });
    const flushPage = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
    const saved = () => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { scenes: { type: string; src?: string; params?: Record<string, unknown> }[]; overlays: { id: string }[] };
    const titleAt = 2.2;

    // + Motion: the title after the scene under the playhead, its page copied into motion/, the playhead on it
    await seekTo(0.5);
    await chooseIn(page, '[data-testid=add-motion]', 'Title');
    await expect.poll(() => saved().scenes.map((scene) => scene.src ?? scene.type)).toEqual(['motion/intro/index.html', 'motion/title/index.html', 'clip']);
    expect(existsSync(join(dir, 'motion', 'title', 'index.html'))).toBe(true);
    await expect.poll(async () => (await now()).t).toBe(1);
    // its block on the timeline shows frames of its page
    await page.waitForSelector('.scene.motion .thumbs i', { timeout: 30_000 });

    // the editor draws the scenes and the overlay as the export does (`cuttle preview`), pixel for pixel
    await flushPage();
    const times = [0.5, titleAt, 6];
    const stills = join(root, 'motion-stills');
    const result = spawnSync('node', [CLI, '--json', '-C', dir, 'preview', ...times.flatMap((t) => ['--at', String(t)]), '-o', stills], { encoding: 'utf8', timeout: 120_000 });
    expect(result.status, result.stderr).toBe(0);
    const files = (JSON.parse(result.stdout) as { stills: { file: string }[] }).stills.map((still) => still.file);
    for (const [i, t] of times.entries()) {
      await seekTo(t);
      const { mean, max } = difference(await view(), PNG.sync.read(readFileSync(files[i]!)));
      expect(mean, `t = ${t}: mean difference`).toBeLessThan(0.5);
      expect(max, `t = ${t}: largest difference`).toBeLessThanOrEqual(24);
    }
    expect((await now()).motion.status.map((status) => [status.src, status.state])).toEqual(
      expect.arrayContaining([
        ['motion/title/index.html', 'ready'],
        ['motion/bar/index.html', 'ready'],
      ]),
    );

    // a param, set in the inspector, on the video at once
    await seekTo(titleAt);
    const before = await view();
    await page.fill('[data-testid=param-title]', 'Edited in Cuttle');
    await page.press('[data-testid=param-title]', 'Enter');
    await expect.poll(() => saved().scenes[1]!.params).toEqual({ title: 'Edited in Cuttle' });
    await expect.poll(async () => (await seekTo(titleAt), difference(await view(), before).mean), { timeout: 20_000 }).toBeGreaterThan(1);
    await shotOf('38-motion-editor', '/editor.html', 'motion-editor · Cuttle');

    // Claude edits the page: the editor draws it again
    const changes = (await now()).motion.files;
    const html = join(dir, 'motion', 'title', 'index.html');
    writeFileSync(html, readFileSync(html, 'utf8').replace('</head>', '<style>* { color: #00ff00 !important; }</style></head>'));
    await expect.poll(async () => (await now()).motion.files, { timeout: 10_000 }).toBeGreaterThan(changes);
    const green = (png: PNG) => {
      let count = 0;
      for (let i = 0; i < png.data.length; i += 4) if (png.data[i + 1]! > 200 && png.data[i]! < 90 && png.data[i + 2]! < 90) count++;
      return count;
    };
    await expect.poll(async () => (await seekTo(titleAt), green(await view())), { timeout: 20_000 }).toBeGreaterThan(500);

    // the export has the edited param and the edited page (the param's field gives the keys back first)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-sheet]');
    await page.click('[data-testid=export-start]');
    await exported(page);
    const exportedFrame = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(titleAt), '-i', join(dir, 'out', 'export.mp4'), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { windowsHide: true }).stdout;
    expect(green(PNG.sync.read(exportedFrame))).toBeGreaterThan(500);
    await page.keyboard.press('Escape');

    // playing draws the motion frames as they come (the param's field has the keys: the button plays)
    await seekTo(1);
    await click(page, 'button.play');
    await page.waitForTimeout(1500);
    const stats = await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.playback() as { motion?: { frames: number } });
    expect((await now()).playing).toBe(true);
    await click(page, 'button.play');
    expect(stats.motion?.frames).toBeGreaterThan(5);

    // a page that throws, added from outside: its error in the inspector
    mkdirSync(join(dir, 'motion', 'oops'), { recursive: true });
    writeFileSync(join(dir, 'motion', 'oops', 'index.html'), '<!doctype html><body><script>cuttle.onFrame((t) => { if (t > 0.2) undefinedThing.go(); });</script></body>');
    await flushPage();
    const raw = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    writeFileSync(join(dir, 'cuttle.json'), `${JSON.stringify({ ...raw, overlays: [...raw.overlays, { id: 'o9', src: 'motion/oops/index.html', at: 1, duration: 2 }] }, null, 2)}\n`);
    await page.waitForSelector('.item.motion[data-id=o9]', { timeout: 20_000 });
    await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.select({ kind: 'motion', id: 'o9' }));
    await seekTo(6);
    await expect.poll(async () => (await page.locator('[data-testid=motion-errors]').textContent().catch(() => '')) ?? '', { timeout: 20_000 }).toContain('ReferenceError');
    expect(await page.locator('[data-testid=motion-state]').textContent()).toContain('threw an error');
    await shotOf('39-motion-errors', '/editor.html', 'motion-editor · Cuttle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion-editor · Cuttle')?.close());
  }, 240_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

Run: `pnpm app:check`
Expected: PASS, 49 tests.

- [ ] **Step 2: The guide**

In `skill/cuttle/motion.md`, replace:

```markdown
   Read the sheet; fix every error; check single moments with `--at 0.4 --at 1.2` (seconds into it).
4. Look at it in the video with `cuttle preview --at …`, and render.

## The page's world

- **The clock is the video's.** `performance.now`, `Date`, `setTimeout`, `setInterval`,
```

with:

```markdown
   Read the sheet; fix every error; check single moments with `--at 0.4 --at 1.2` (seconds into it).
4. Look at it in the video with `cuttle preview --at …`, and render.

**With the project open in the Cuttle app,** the user watches you work: every page you save shows
in its editor at once (it plays and scrubs them as the export draws them), with what a page threw
and logged in its inspector, and they can change the params you declared there. So declare a param
for what they may want to set themselves (a text, a colour, a side), with a clear `label`; and say
which page you changed, so they can look. The app adds templates too (+ Motion): you may find a
page in `motion/` you did not write.

## The page's world

- **The clock is the video's.** `performance.now`, `Date`, `setTimeout`, `setInterval`,
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/app.check.test.ts skill/cuttle/motion.md
git commit -m "app: check motion in the editor end to end; the guide says the person watches Claude's pages there

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 787 passed and 66 skipped (where a speech model is found, its real transcription runs too: 788 and 65; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 11 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Open a project with a take in Cuttle, put the playhead on a clip, and pick "+ Motion" → Lower third: it shows over the video, its params in the inspector. Change the name: the video shows it.
2. Ask Claude to change the lower third's page (a colour, a font): the editor shows each saved change at once.
3. Play across a motion scene: it moves with the video.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype (after the last fix), whose tree the replay matches byte for byte. The packaged build ran on the replayed commits.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **A new scene's playhead went back.** "+ Motion" moves the playhead to the new scene, but the player still had the project before the edit: its seek was overtaken by the redraw for the new version, which went back to the time on screen. The player now keeps a pending seek's time for the new version.
- **Space in a field.** The check started playback with Space while the param's field had the keys (Space went into the title); it presses the play button.
- **The internet and motion blur rows** said too much for the inspector's width (the switch was cut off): they say On or Off, the rest is in the tooltip.
- **Motion and masks shared a violet.** Motion is magenta now.
- **The Input lane fell below the timeline** at 900 px once the Motion lane came: the timeline takes 36% of the window's height now (at most 340 px), and every lane shows.
- **Copying from the app's archive.** The app's kit sits in its asar archive, where `fs.cp` is not safe: a template is copied with reads and writes.
- **A motion page's frame was never painted, now and then** (the app check's motion export failed at frame 0 in three of its long runs; a stress test of one app opening and exporting motion projects lost about one export in eight). The page had drawn (its marker was in the page), but its paints went on showing it as it was before, and asking for a paint repainted that. The same moment drawn again gets through: a frame whose paint has not come in 0.4 s is drawn again. Then 24 exports in a row passed, none slower. The page's error now says what its paints showed (how many, their size, their marker), and an export check that times out says what the export sheet shows: that is how this was found.
- **Displays of other scales:** with three displays of three scales, a new motion page could open on a display of another scale and come out a pixel or two taller. Pages open on the primary display now, and keep their size.
- **The recorder's "stops while paused" test is flaky** (a pause takes effect half a second late under load). It failed in two of four full runs of the prototype and in one of three full runs of main; the branch does not touch the recorder. Two full runs of the prototype passed all 787, and the test passes alone. In the first run, right after a long render, a random-edit test (0.8 s alone) also ran out of its 5 s. Listed as a follow-up.

**Spec points that move**
- **"Open the page"** is Show file (the page in its folder): a page opened as it is would run in a browser, outside Cuttle's clock.
- **Kept frames** are kept up to 192 MB, by what draws them, not per item: playing again is free while they fit.
- **A frame's limit** stays the export's 5 s (the spec said 2 s), so the preview and the export fail the same pages.
- **Transitions on the cut** come with the transitions (P5-M1d); **sounds on the mic lane** with sound (P5-M1e).

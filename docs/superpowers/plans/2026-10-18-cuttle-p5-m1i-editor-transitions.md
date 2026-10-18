# Cuttle P5-M1i: Transition Pages in the Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor draws a scene's transition page as the export draws it:
- stopped inside a transition, the player shows the page's frame (a crossfade for the moment it takes to come);
- a moment after it stops, it makes the frames of every transition for playing; played through a cut, the transition shows as its page drew it;
- the scene's panel shows the page's state (loading, ready, its errors) and says when the player shows it.

**Architecture:**
- **The main process:** `MotionPreview` takes a transition's request like a scene's (its page, `transition` in its init) and draws its frame from the two it is given; they are part of what the frame is (a SHA-1 of both in the cache key).
- **The IPC:** a motion request may be a transition's, with the two frames (`between`, premultiplied RGBA whose bytes fit their size).
- **The player:** `seek` gathers a frame's video frames (`gather`, now shared), draws it, and when it shows a transition reads the two layers from the renderer (`layerPixels`) and asks for the page's frame, then draws again. `warm` (400 ms after a seek, while paused) goes through every frame of the timeline's transitions that is not made yet, gathers its sources and asks for it; a seek, a play or an edit stops it. Playing puts a made frame into the sources (`fillTransition`) and crossfades without one.
- **`MotionFrames`** keeps the transitions' frames of the version they were made for (72 at most), by `key@frame`.

**Tech Stack:** TypeScript strict, zod 4, React 19, WebGL2, Electron 44.7.2 (IPC, offscreen windows).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase5-motion-design.md` ("In the editor", "Preview"). Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m1h-transitions.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m1i`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The full `pnpm test` and the typecheck run in Task 4.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The finished prototype passed `pnpm test` (851 tests, 70 skipped, in two full runs), the typecheck, `app:check` (50 tests) and `cli:check` (14). Every screenshot was looked at.

- **Made ahead while paused, not while playing.** A transition frame needs the two layers drawn (decoded video, motion frames) and a round trip through the main process (16 MB at 1080p each way to the page): too much for the player's clock. While playing, the player shows the frames it has and crossfades the rest; while paused it makes them, a moment after the last seek, so a play after an edit and a short stop shows the page.
- **By version.** The frames are kept for the version of the project they were made for; any edit makes them again (an edit next to a transition changes what it goes between). 72 frames are kept, about two transitions of a second at 30 fps.
- **The seek's own frame first.** Stopped inside a transition, its frame is asked for at once (`seek`), before the others (`warm`), and the frame is drawn again with it; the crossfade shows meanwhile.
- **Warming yields.** It waits 400 ms after a seek, checks the seek's token between every step and stops at a play, so scrubbing and playing never wait for it.
- **The main process's cache** keys a transition's frame by the page, the frame and a SHA-1 of the two frames it was given: the same version drawn twice (a seek back) costs nothing, a changed neighbour draws again.
- **The panel** shows the page's state (as a motion item's: loading, ready, could not draw, its errors) and says that the player shows the page's frames once they are made, a moment after it stops.

## File structure

| File | Responsibility |
|---|---|
| `packages/export/src/main/motion-preview.ts` | the main process draws a transition's frame for the editor |
| `apps/desktop/src/shared/ipc.ts` | the request with its two frames |
| `apps/desktop/src/renderer/editor/{motion,player}.ts` | asking, keeping, warming, playing |
| `apps/desktop/src/renderer/editor/Inspector.tsx` | the panel |
| `apps/desktop/test/app.check.test.ts`, `skill/cuttle/motion.md` | the check, the guide |

---

### Task 1: The main process draws a transition for the editor

**Files:**
- Modify: `packages/export/src/main/motion-preview.ts`, `apps/desktop/src/shared/ipc.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m1i`; work there:

```bash
git switch p5-m1i
```

- [ ] **Step 2: The preview**

In `packages/export/src/main/motion-preview.ts`, replace:

```ts
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
```

with:

```ts
// item being scrubbed gets a spare page loaded beside it, so going back (a page only goes forward)
// does not wait for a load. Frames are kept, the least recently used dropped first. A change to the
// project's files reloads the pages: Claude edits a page, the editor shows it.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { KIT_FONTS } from '@cuttle/motion-kit';
import { parseProject, type CuttleProject, type MotionOverlay, type MotionScene, type SceneTransition } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import type { MotionFrameRequest, MotionPixels } from '../job';
import { motionInit } from '../motion/init';
```

In the same file, replace:

```ts
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
```

with:

```ts
  /** The page options of a request's showing, and its identity: the same identity draws the same frames. */
  private async describeShowing(version: Version, request: MotionFrameRequest, size: { width: number; height: number }) {
    const project = version.project!;
    const transition = request.kind === 'transition';
    const name = transition ? `scenes[${request.index}].transition` : `${request.kind === 'scene' ? 'scenes' : 'overlays'}[${request.index}]`;
    const item = transition ? project.scenes[request.index]?.transition : request.kind === 'scene' ? project.scenes[request.index] : project.overlays[request.index];
    if (!item || ('type' in item && item.type !== 'motion')) throw new Error(`${name} is not a motion item`);
    const motion = item as MotionScene | MotionOverlay | SceneTransition;
    const blur = 'motionBlur' in motion ? motion.motionBlur : undefined;
    const file = this.pageFile(motion.src, `${name}.src`);
    const [declared, take] = await Promise.all([this.declaration(file), this.take(project, request.screen)]);
    const window = request.kind === 'overlay' && 'at' in motion ? { from: motion.at, to: motion.at + motion.duration } : null;
    const init = motionInit(project, motion, name, { start: request.start, duration: request.duration }, {
      take: take.data && { ...take.data, window },
      fonts: [...KIT_FONTS],
      defaults: paramDefaults(declared.params),
      transition,
    });
    const { take: _take, ...rest } = init;
    const identity = JSON.stringify([file, this.files, take.id, window, motion.network, blur ?? null, size, rest]);
    const options: MotionPageOptions = {
      file,
      root: resolve(this.projectDir),
      init,
      network: motion.network,
      ...(blur && { motionBlur: blur }),
      ...((size.width !== init.width || size.height !== init.height) && { frameSize: size }),
      ...(this.options.kitDir && { kitDir: this.options.kitDir }),
      ...(this.options.frameTimeout && { frameTimeout: this.options.frameTimeout }),
```

In the same file, replace:

```ts
      if (showing) showing.used = Date.now();
      return { id };
    }
    const cacheKey = `${id}|${request.frame}|${request.view ? JSON.stringify(request.view) : ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (showing) showing.used = Date.now();
```

with:

```ts
      if (showing) showing.used = Date.now();
      return { id };
    }
    // a transition's frame is drawn from the two it is given: they are part of what it is
    const between = request.between ? createHash('sha1').update(request.between.from.data).update(request.between.to.data).digest('hex') : '';
    const cacheKey = `${id}|${request.frame}|${request.view ? JSON.stringify(request.view) : ''}|${between}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (showing) showing.used = Date.now();
```

In the same file, replace:

```ts
        }
        const drawing = (async () => {
          const page = await this.pageFor(showing, request.frame);
          return page.frame(request.frame, request.view);
        })();
        showing.drawing = drawing.catch(() => {});
        try {
```

with:

```ts
        }
        const drawing = (async () => {
          const page = await this.pageFor(showing, request.frame);
          return page.frame(request.frame, request.view, request.between);
        })();
        showing.drawing = drawing.catch(() => {});
        try {
```

- [ ] **Step 3: The request**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const box = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
/** A motion frame the player asks for (as @cuttle/export's MotionFrameRequest). */
const motionRequest = z.strictObject({
  key: z.string().min(1).max(200),
  kind: z.enum(['scene', 'overlay']),
  index: z.number().int().nonnegative().max(100_000),
  frame: z.number().int().nonnegative().max(100_000_000),
  start: z.number().finite().nonnegative(),
```

with:

```ts

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const box = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
/** A frame (premultiplied RGBA, top row first) whose bytes fit its size. */
const pixels = z
  .strictObject({ width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192), data: z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'bytes') })
  .refine((frame) => frame.data.byteLength === frame.width * frame.height * 4, { message: 'the bytes do not fit the size' });
/** A motion frame the player asks for (as @cuttle/export's MotionFrameRequest); a transition's comes with the two frames it goes between. */
const motionRequest = z.strictObject({
  key: z.string().min(1).max(200),
  kind: z.enum(['scene', 'overlay', 'transition']),
  index: z.number().int().nonnegative().max(100_000),
  frame: z.number().int().nonnegative().max(100_000_000),
  start: z.number().finite().nonnegative(),
```

In the same file, replace:

```ts
      cursor: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).nullable(),
    })
    .optional(),
});
const deviceName = z.string().min(1).max(512);
```

with:

```ts
      cursor: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).nullable(),
    })
    .optional(),
  between: z.strictObject({ from: pixels, to: pixels }).optional(),
});
const deviceName = z.string().min(1).max(512);
```

Run: `pnpm exec vitest run --project node apps/desktop/test/contract.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/export/src/main/motion-preview.ts apps/desktop/src/shared/ipc.ts
git commit -m "export, app: the editor's motion preview draws a transition's frame from the two it is given

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The player shows transitions

**Files:**
- Modify: `apps/desktop/src/renderer/editor/motion.ts`, `apps/desktop/src/renderer/editor/player.ts`, `apps/desktop/src/renderer/editor/Inspector.tsx`

- [ ] **Step 1: Asking for a transition's frame, and keeping it**

In `apps/desktop/src/renderer/editor/motion.ts`, replace:

```ts
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}

/** Whether the project has motion scenes or overlays (without, nothing is asked of the main process). */
export const hasMotion = (project: CuttleProject) => project.overlays.length > 0 || project.scenes.some((scene) => scene.type === 'motion');

export class MotionFrames {
  private version = 0;
```

with:

```ts
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}

/** Whether the project has motion scenes, overlays or transitions (without, nothing is asked of the main process). */
export const hasMotion = (project: CuttleProject) =>
  project.overlays.length > 0 || project.scenes.some((scene) => scene.type === 'motion' || scene.transition?.enabled === true);

/** Transition frames kept (this version's, at the player's size): about two transitions of a second at 30 fps. */
const KEEP_BETWEEN = 72;

export class MotionFrames {
  private version = 0;
```

In the same file, replace:

```ts
    return changed;
  }

  /** Frames that came while playing (since it started), and how long one took (ms, a running mean of every item). */
  private received = 0;

  stats(): { frames: number; took: number } {
    const times = [...this.took.values()];
    return { frames: this.received, took: times.length > 0 ? Math.round(times.reduce((sum, time) => sum + time, 0) / times.length) : 0 };
  }

  /** The strips of the scenes' blocks, by item, with the number of what drew them. */
```

with:

```ts
    return changed;
  }

  /** The transitions' frames made for this version (`key@frame`), oldest first, and the version they are of. */
  private readonly between = new Map<string, MotionPixels>();
  private betweenVersion = -1;

  /** Where `state`'s transition frame is kept, or undefined without one. */
  private betweenKey(state: RenderState): string | undefined {
    const active = state.transition;
    if (!active) return undefined;
    if (this.betweenVersion !== this.version) {
      this.between.clear();
      this.betweenVersion = this.version;
    }
    return `${active.key}@${Math.round(active.local * this.project.output.fps)}`;
  }

  /** Whether `state`'s transition frame is made (true without a transition). */
  hasTransition(state: RenderState): boolean {
    const key = this.betweenKey(state);
    return key === undefined || this.between.has(key);
  }

  /**
   * Puts `state`'s transition frame into `sources` when it is made (the engine crossfades without);
   * true when it was there or the frame has no transition.
   */
  fillTransition(state: RenderState, sources: FrameSources): boolean {
    const key = this.betweenKey(state);
    sources.transitions?.clear();
    if (key === undefined) return true;
    const pixels = this.between.get(key);
    if (!pixels) return false;
    (sources.transitions ??= new Map()).set(state.transition!.key, pixels);
    return true;
  }

  /**
   * Makes `state`'s transition frame: the main process draws its page from the two layers (`layers`
   * reads them from the renderer). Kept for playing; undefined when it is no longer wanted.
   */
  async transition(state: RenderState, layers: () => [MotionPixels, MotionPixels], mode: 'seek' | 'play'): Promise<MotionPixels | undefined> {
    const key = this.betweenKey(state);
    const active = state.transition;
    if (key === undefined || !active || !this.active) return undefined;
    const kept = this.between.get(key);
    if (kept) return kept;
    const version = this.version;
    const [from, to] = layers();
    const { width, height } = this.size();
    const request = {
      key: active.key,
      kind: 'transition' as const,
      index: active.sceneIndex,
      frame: Math.round(active.local * this.project.output.fps),
      start: active.start,
      duration: active.duration,
      screen: this.screen,
      between: { from, to },
    };
    const answer = await bridge.invoke('motion:frame', { version, request, width, height, mode });
    if (!answer?.pixels || version !== this.version) return undefined;
    this.between.set(key, answer.pixels);
    while (this.between.size > KEEP_BETWEEN) this.between.delete(this.between.keys().next().value!);
    return answer.pixels;
  }

  /** Frames that came while playing (since it started), and how long one took (ms, a running mean of every item). */
  private received = 0;

  /** The motion frames that came while playing and how long one took, and the transition frames made for this version. */
  stats(): { frames: number; took: number; made: number } {
    const times = [...this.took.values()];
    const made = this.betweenVersion === this.version ? this.between.size : 0;
    return { frames: this.received, took: times.length > 0 ? Math.round(times.reduce((sum, time) => sum + time, 0) / times.length) : 0, made };
  }

  /** The strips of the scenes' blocks, by item, with the number of what drew them. */
```

- [ ] **Step 2: Stopped, warming, playing**

In `apps/desktop/src/renderer/editor/player.ts`, replace:

```ts
import { createRenderer, type DrawnText, type EngineAssets, type FrameSources, type Renderer } from '@cuttle/engine';
import { planStills } from '@cuttle/export/frame-plan';
import type { CuttleProject } from '@cuttle/project';
import { createTimeline, type RenderState, type Timeline } from '@cuttle/timeline';
import { AudioSchedule } from './audio';
import { TypingSchedule } from './typing-audio';
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
```

with:

```ts
import { createRenderer, type DrawnText, type EngineAssets, type FrameSources, type Renderer } from '@cuttle/engine';
import { planStills } from '@cuttle/export/frame-plan';
import type { CuttleProject } from '@cuttle/project';
import { createTimeline, crossfadeHalf, pageTransition, type RenderState, type Timeline } from '@cuttle/timeline';
import { AudioSchedule } from './audio';
import { TypingSchedule } from './typing-audio';
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
```

In the same file, replace:

```ts
const LOOKAHEAD_FRAMES = 20;
/** Playback this far behind the clock restarts its decoders at the clock (frames are dropped). */
const BEHIND_SECONDS = 0.5;
/** The sizes motion frames are drawn at, as parts of the output: the smallest that fills the player on screen. */
const MOTION_SCALES = [1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1];

/** What playback did, for the check: frames drawn, decoder restarts at the clock (frames dropped), typing clicks scheduled, the clock. */
export interface PlaybackStats {
  drawn: number;
  restarts: number;
  clicks: number;
  /** The clock's output time (where the sound is), while playing. */
  clock: number;
  /** Motion frames that came while playing, and how long one took (ms, a running mean). */
  motion?: { frames: number; took: number };
  /** The soundtrack's buffers started in this run (music and effects; again after a new render came). */
  soundtrack?: number;
}
```

with:

```ts
const LOOKAHEAD_FRAMES = 20;
/** Playback this far behind the clock restarts its decoders at the clock (frames are dropped). */
const BEHIND_SECONDS = 0.5;
/** A pause this long after a seek before the transitions' frames are made for playing (ms): scrubbing goes first. */
const WARM_DELAY_MS = 400;
/** The sizes motion frames are drawn at, as parts of the output: the smallest that fills the player on screen. */
const MOTION_SCALES = [1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1];

/** What playback did, for the check: frames drawn, decoder restarts at the clock (frames dropped), typing clicks scheduled, the clock. */
export interface PlaybackStats {
  drawn: number;
  /** Frames drawn by a transition's page (made while paused), not crossfaded. */
  transitions: number;
  restarts: number;
  clicks: number;
  /** The clock's output time (where the sound is), while playing. */
  clock: number;
  /** Motion frames that came while playing, how long one took (ms, a running mean), and the transition frames made. */
  motion?: { frames: number; took: number; made: number };
  /** The soundtrack's buffers started in this run (music and effects; again after a new render came). */
  soundtrack?: number;
}
```

In the same file, replace:

```ts
  /** The run under way: output time `from` plays at context time `contextStart`. */
  private runMap: { from: number; contextStart: number } | undefined;
  private disposed = false;
  private readonly playback: PlaybackStats = { drawn: 0, restarts: 0, clicks: 0, clock: 0 };
  private clockNow: (() => number) | undefined;
  private readonly motion: MotionFrames;
  private readonly fullSizeMotion: boolean;
```

with:

```ts
  /** The run under way: output time `from` plays at context time `contextStart`. */
  private runMap: { from: number; contextStart: number } | undefined;
  private disposed = false;
  private readonly playback: PlaybackStats = { drawn: 0, transitions: 0, restarts: 0, clicks: 0, clock: 0 };
  private clockNow: (() => number) | undefined;
  private readonly motion: MotionFrames;
  private readonly fullSizeMotion: boolean;
```

In the same file, replace:

```ts
    const frame = this.frameOf(time);
    const state = this.timeline.frameAt(frame / this.fps);
    let held: HeldFrame[] = [];
    const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };
    const stills = this.stillsByIndex();
    try {
      for (const layer of state.layers) {
        if (layer.kind === 'still') {
          const image = stills.get(layer.index);
          if (image) sources.stills.set(layer.index, image);
          continue;
        }
        if (layer.kind !== 'clip' || layer.sourceTime === undefined) continue;
        const screen = await this.screenGrabber.grab(layer.sourceTime);
        if (!screen || token !== this.seekToken) {
          screen?.close();
          return;
        }
        held.push(screen);
        sources.screens.set(layer.index, screen.frame);
        const webcam = this.media.webcam;
        if (webcam && this.webcamGrabber) {
          const webcamTime = layer.sourceTime - webcam.offset;
          if (webcamTime >= webcam.start && webcamTime < webcam.end) {
            const frameOfWebcam = await this.webcamGrabber.grab(webcamTime);
            if (token !== this.seekToken) {
              frameOfWebcam?.close();
              return;
            }
            if (frameOfWebcam) {
              held.push(frameOfWebcam);
              sources.webcams.set(layer.index, frameOfWebcam.frame);
            }
          }
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
```

with:

```ts
    const frame = this.frameOf(time);
    const state = this.timeline.frameAt(frame / this.fps);
    let held: HeldFrame[] = [];
    try {
      const gathered = await this.gather(state, token, held);
      if (!gathered || token !== this.seekToken || this.disposed) return;
      const sources = gathered;
      const needs = this.motion.needs(this.timeline.spans, state);
      const exact = this.motion.fill(needs, sources);
      const between = this.motion.fillTransition(state, sources);
      this.seeking = undefined;
      if (this.draw(state, sources)) this.set({ t: time, source: this.sourceOf(state), error: undefined });
      if (exact && between) return void this.warm(token);
      // the exact motion frames and the transition's, then this frame again with them (its video frames are kept until then)
      this.parked = held;
      held = [];
      if (!exact) {
        const changed = await this.motion.exact(needs, sources);
        if (token !== this.seekToken || this.disposed || this.state.playing) return;
        if (changed) this.draw(state, sources);
      }
      if (!between) {
        // its page draws from the two layers as they are now (the motion frames in them exact)
        const made = await this.motion.transition(state, () => this.renderer.layerPixels(state, sources), 'seek').catch(() => undefined);
        if (token !== this.seekToken || this.disposed || this.state.playing) return;
        if (made && this.motion.fillTransition(state, sources)) this.draw(state, sources);
      }
      this.unpark();
      void this.warm(token);
    } catch (error) {
      if (token === this.seekToken && !this.disposed) {
        this.seeking = undefined;
```

In the same file, replace:

```ts
    }
  }

  /** Plays from the playhead (from the start when it is at the end). */
  play(): void {
    if (this.disposed || this.state.playing || !(this.duration > 0)) return;
```

with:

```ts
    }
  }

  /**
   * The video and still frames of a paused frame's layers; the video frames go into `held` (the caller
   * closes them). Undefined when a newer seek came meanwhile.
   */
  private async gather(state: RenderState, token: number, held: HeldFrame[]): Promise<FrameSources | undefined> {
    const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map(), transitions: new Map() };
    const stills = this.stillsByIndex();
    for (const layer of state.layers) {
      if (layer.kind === 'still') {
        const image = stills.get(layer.index);
        if (image) sources.stills.set(layer.index, image);
        continue;
      }
      if (layer.kind !== 'clip' || layer.sourceTime === undefined) continue;
      const screen = await this.screenGrabber.grab(layer.sourceTime);
      if (!screen || token !== this.seekToken) {
        screen?.close();
        return undefined;
      }
      held.push(screen);
      sources.screens.set(layer.index, screen.frame);
      const webcam = this.media.webcam;
      if (webcam && this.webcamGrabber) {
        const webcamTime = layer.sourceTime - webcam.offset;
        if (webcamTime >= webcam.start && webcamTime < webcam.end) {
          const frameOfWebcam = await this.webcamGrabber.grab(webcamTime);
          if (token !== this.seekToken) {
            frameOfWebcam?.close();
            return undefined;
          }
          if (frameOfWebcam) {
            held.push(frameOfWebcam);
            sources.webcams.set(layer.index, frameOfWebcam.frame);
          }
        }
      }
    }
    return sources;
  }

  /** The output frames that show a transition page. */
  private transitionFrames(): number[] {
    const frames: number[] = [];
    const spans = this.timeline.spans;
    const look = this.project.look.transition;
    for (let i = 1; i < spans.length; i++) {
      const [before, into] = [spans[i - 1]!, spans[i]!];
      if (!pageTransition(before, into, look)) continue;
      const half = crossfadeHalf(before, into, look);
      for (let frame = Math.ceil((into.start - half) * this.fps - 1e-6); frame / this.fps < into.start + half - 1e-9; frame++) frames.push(frame);
    }
    return frames;
  }

  /**
   * While paused, a moment after a seek: makes the frames of the transitions for playing, one after
   * the other (a seek, a play or an edit stops it; the next seek starts it again where it is needed).
   */
  private async warm(token: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, WARM_DELAY_MS));
    for (const at of this.transitionFrames()) {
      if (token !== this.seekToken || this.state.playing || this.disposed) return;
      const state = this.timeline.frameAt(at / this.fps);
      if (this.motion.hasTransition(state)) continue;
      const held: HeldFrame[] = [];
      try {
        const sources = await this.gather(state, token, held);
        if (!sources || token !== this.seekToken || this.state.playing) return;
        const needs = this.motion.needs(this.timeline.spans, state);
        if (!this.motion.fill(needs, sources)) await this.motion.exact(needs, sources);
        if (token !== this.seekToken || this.state.playing || this.disposed) return;
        await this.motion.transition(state, () => this.renderer.layerPixels(state, sources), 'play');
      } catch {
        return; // the item's status says what went wrong
      } finally {
        for (const frame of held) frame.close();
      }
    }
  }

  /** Plays from the playhead (from the start when it is at the end). */
  play(): void {
    if (this.disposed || this.state.playing || !(this.duration > 0)) return;
```

In the same file, replace:

```ts
    const clock = () => from + Math.max(0, heardTime(context) - contextStart);
    this.clockNow = clock;
    this.playback.drawn = 0;
    this.playback.restarts = 0;

    const video: PlaybackVideo = {
```

with:

```ts
    const clock = () => from + Math.max(0, heardTime(context) - contextStart);
    this.clockNow = clock;
    this.playback.drawn = 0;
    this.playback.transitions = 0;
    this.playback.restarts = 0;

    const video: PlaybackVideo = {
```

In the same file, replace:

```ts
            sources.overlays.clear();
            this.motion.stream(this.motion.needs(this.timeline.spans, state), frame, fps, last, sources, needsAt);
          }
          if (sources && this.draw(state, sources)) {
            this.playback.drawn++;
            this.set({ t: frame / fps, source: this.sourceOf(state) });
          }
          shown = frame;
```

with:

```ts
            sources.overlays.clear();
            this.motion.stream(this.motion.needs(this.timeline.spans, state), frame, fps, last, sources, needsAt);
          }
          // a transition plays as its page drew it while paused, else as a crossfade
          const paged = sources !== undefined && state.transition !== undefined && this.motion.fillTransition(state, sources);
          if (sources && this.draw(state, sources)) {
            this.playback.drawn++;
            if (paged) this.playback.transitions++;
            this.set({ t: frame / fps, source: this.sourceOf(state) });
          }
          shown = frame;
```

- [ ] **Step 3: The panel**

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```tsx
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
```

with:

```tsx
function TransitionInto({ project, index }: { project: CuttleProject; index: number }) {
  const scene = project.scenes[index];
  const transition = scene?.transition;
  const name = `scenes[${index}].transition`;
  const status = useStore(store, (state) => state.motionStatus.find((entry) => entry.item === name && entry.src === transition?.src));
  if (!scene?.id || !transition || index === 0) return null;
  const id = scene.id;
  const change = (fields: Partial<typeof transition>, label: string) => set('scenes', id, { transition: { ...transition, ...fields } }, label);
  return (
    <div className="transition-in" data-testid="transition-in">
      <Row label="Into this scene">{motionName(transition.src)}</Row>
      {status && <MotionState status={status} />}
      <p className="hint">Its page draws the frames between the two scenes from them. The player shows them once they are made, a moment after you stop on the timeline; until then, a crossfade.</p>
      <div className="grid2">
        <Row label="Length (s)">
          <NumberInput value={transition.duration} min={0.1} max={4} step={0.1} onCommit={(duration) => change({ duration }, 'Transition length')} testId="transition-duration" />
```

- [ ] **Step 4: The typecheck**

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "app: the player draws transition pages: at once when stopped in one, made ahead for playing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The check and the guide

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`, `skill/cuttle/motion.md`

- [ ] **Step 1: The check**

Stopped at the fold's cut, the editor shows what `cuttle preview` draws there; a moment later its 17 frames are made, and playing through the cut draws them:

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
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
```

with:

```ts
    await page.fill('[data-testid=transition-duration]', '0.6');
    await page.press('[data-testid=transition-duration]', 'Enter');
    await expect.poll(() => clipOf()?.transition?.duration).toBe(0.6);
    // stopped at the cut: the page's frame, as the export draws it
    const cut = 4.5;
    await flushPage();
    const foldStill = spawnSync('node', [CLI, '--json', '-C', dir, 'preview', '--at', String(cut), '-o', join(root, 'fold-stills')], { encoding: 'utf8', timeout: 120_000 });
    expect(foldStill.status, foldStill.stderr).toBe(0);
    const foldFrame = PNG.sync.read(readFileSync((JSON.parse(foldStill.stdout) as { stills: { file: string }[] }).stills[0]!.file));
    await seekTo(cut);
    await expect.poll(async () => difference(await view(), foldFrame).mean, { timeout: 30_000 }).toBeLessThan(1.5);
    expect((await now()).error).toBeUndefined();
    await shotOf('39c-transition', '/editor.html', 'motion-editor · Cuttle');
    // a moment later its frames are made for playing: playing through the cut shows them
    type Made = { motion?: { made: number }; transitions: number };
    const playback = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.playback() as unknown as Made);
    // 0.6 s at 30 fps, the frame on its very start a crossfade's
    await expect.poll(async () => (await playback()).motion?.made, { timeout: 60_000 }).toBeGreaterThanOrEqual(17);
    await seekTo(4);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await click(page, 'button.play');
    await page.waitForTimeout(1300);
    const played = await playback();
    await click(page, 'button.play');
    expect(played.transitions).toBeGreaterThan(8);
    await click(page, '[data-testid=transition-remove]');
    await expect.poll(() => clipOf()?.transition).toBeUndefined();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion-editor · Cuttle')?.close());
```

Run: `pnpm app:check`
Expected: PASS, 50 tests.

- [ ] **Step 2: The guide**

In `skill/cuttle/motion.md`, replace:

```markdown
Draw the whole frame from them: at 0 it should look like `from`, at 1 like `to`, so the cut is
seamless. `fold` turns the outgoing frame over its middle like a page. `motion check` shows a
transition in the video, between its two scenes. A first scene, or one right after a cut, has
nothing to go between. The editor shows a crossfade where a transition is, for now; the export
and `cuttle preview` draw the page.

## Sounds from the page
```

with:

```markdown
Draw the whole frame from them: at 0 it should look like `from`, at 1 like `to`, so the cut is
seamless. `fold` turns the outgoing frame over its middle like a page. `motion check` shows a
transition in the video, between its two scenes. A first scene, or one right after a cut, has
nothing to go between. The export, `cuttle preview` and the Cuttle app draw the page (the app
makes its frames a moment after an edit, and crossfades until then).

## Sounds from the page
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/app.check.test.ts skill/cuttle/motion.md
git commit -m "check the fold in the editor, stopped and played; the guide says the app draws transition pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Final verification

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

1. In a project with a fold into a clip, stop on the cut: the page turns over there (after a crossfade for a moment).
2. Wait a moment, then play through the cut: it turns over as it plays.
3. Change the fold's length in the clip's panel, stop a moment, play again: the new length plays.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **A transition of 0.6 s has 17 frames, not 18:** the frame on its very start is still a crossfade's (the window starts after it); the check waits for 17.
- **`z.instanceof(Uint8Array)`** types the bytes as `Uint8Array<ArrayBuffer>`, which the renderer's frames are not; the schema checks them with `z.custom`.

**Flaky, and not this milestone's**
- **The recorder's timing under load** (seen on `main` too): two of four full `pnpm test` runs had the pause test's take 5.53 and 5.56 s long (it allows 5.5); alone it passes on `main` and here, and the other two runs passed. The first `app:check`, right after a fresh build, lost the test that reads the screen after a take; the second passed all 50. Nothing here touches the recorder.

**Spec points that move**
- None. Next: **P5-M2**.

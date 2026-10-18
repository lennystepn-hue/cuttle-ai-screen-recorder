# Cuttle P5-M1d: Frames of the Take in Motion Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Motion pages draw the screen recording itself, and a template shows it off:
- `await cuttle.take.frame(source, { width })` gives a page the recording's frame at a source second as an `ImageBitmap`, the project's privacy masks painted over it, for a screen in 3D, a freeze, a lens;
- a draw in `cuttle.onFrame` may be `async`: the frame waits for it;
- the `device-3d` template: a laptop (or a tablet) in Three.js whose screen plays the take; the camera turns in as the lid opens and the screen comes on, drifts, and at the end flies into the screen until the recording fills the frame.

**Architecture:**
- **The page's side** (the motion runtime): `take.frame` asks a worker for each frame and resolves with its bitmap; `__cuttleDraw` waits for the promises its draws return, and only then moves the frame marker, so no paint before shows the new number with the old picture.
- **The worker** (`kit/take-worker.js`, started from a blob of the page's origin that imports the kit's file): mediabunny reads the recording over the project's URL in ranges, WebCodecs decodes it, forward from the frame asked last where it can (a jump back or more than 3 s ahead starts at the key frame before), and the masks are painted with the helpers of `kit/take.js`: `fill` with the mean colour around the mask, `blur` down to a few pixels and up again, softened. The worker keeps its own clock: the page's virtual one would hold it up.
- **Serving:** the pages' session answers byte ranges (`Range: bytes=a-b` or `a-`), streamed from the file; mediabunny and a page's own `<video>` read that way.
- **The take data** gives each page the recording's URL (`cuttle-motion://project/…`, null outside the project) and the masks with their style and moves.
- **The kit** bundles mediabunny's ES module (MPL 2.0, unchanged, with its licence).

**Tech Stack:** TypeScript strict, vitest 5 (node and browser), Electron 44.7.2 (offscreen windows, custom protocol), WebCodecs, mediabunny 1.61.0, Three.js 0.186.1.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase5-motion-design.md` ("The page contract": `frame(t, { width })`; "Templates": `device-3d`). Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m1g-page-sounds.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m1d`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` and the typecheck run in Task 6.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The finished prototype passed `pnpm test` (845 tests, 69 skipped, in two full runs), the typecheck, `app:check` (50 tests) and `cli:check` (13). Every screenshot was looked at.

- **The frames come from the page's own decoder, not from the export's.** The export page decodes the clips with its own readers and has no way to hand pixels to a motion page's window; a worker in that window reads the file itself. The same code serves the export, `cuttle preview`, `motion check` and the editor's preview.
- **A worker, of the page's origin.** In the page itself the decoder would run on the page's virtual clock (mediabunny keeps time with `performance.now`); a worker has its own. Workers must come from the page's origin (`cuttle-motion://project`), so a blob of that origin imports the kit's script.
- **Forward first.** The recorder puts a key frame every 2 s. A frame at or after the last one asked (up to 3 s ahead) reads on from where decoding is; a jump back or far ahead starts at the key frame before it. The source second maps to the file as the export maps it (never before the file's first frame).
- **The masks go on every frame a page gets,** as the video masks the clips: a page cannot show what the project hides. They are in the frame's pixels (scaled from source px, grown to whole pixels); a mask that follows text covers both of its places between two moves, as in the video.
- **An async draw holds the frame.** `__cuttleDraw` collects the promises its `onFrame` draws and animation frames return, waits for them (their errors are noted, the frame goes on), sets the animations and the marker after them, and answers after two browser frames as before. A page without async draws is drawn as before: its marker changes in the same task as its drawing.
- **Errors:** a page without a recording, or whose recording cannot be read, gets a rejected promise with the reason; once the worker fails, every later frame is refused at once (no wait for the frame timeout). The device template shows a stand-in screen then and says why in its console.
- **The device-3d template:**
  - a laptop in aluminium with a keyboard, a trackpad, a black bezel and a glint over the glass (or a tablet held sideways, the take's shape), on a soft shadow, lit by a room environment;
  - the lid opens and the screen comes on in the first 1.3 s while the camera turns in; then the camera drifts round to the front; with `push` (on) it flies into the screen in the last second, until the recording fills the frame;
  - it plays the take from the first clip's start (or `from`), at `speed`, with frames as wide as the output at most;
  - a whoosh as it turns in, and one into the screen (`sounds`).
- **Labels:** templates with "3d" in their name are named "3D" in the editor and by `motion new` ("Device 3D").
- **Transitions move to P5-M1h.** A transition page needs the outgoing and the incoming frame as the engine draws them (the look, the window, the cursor) for every frame of the transition: a round trip from the export page through the main process to the page and back, and the same in the editor's player. That is a milestone of its own, with the fold template and transitions on the timeline.

## File structure

| File | Responsibility |
|---|---|
| `packages/export/src/motion/{runtime,take,init}.ts` | `take.frame`, async draws, the recording's URL and the masks for pages |
| `packages/export/src/main/motion.ts` | byte ranges for the pages' session |
| `packages/motion-kit/kit/{take.js,take.d.ts,take-worker.js}`, `packages/motion-kit/{package.json,scripts/copy.mjs}` | reading the frames, painting the masks, mediabunny in the kit |
| `packages/motion-kit/templates/device-3d/index.html`, `packages/motion-kit/src/index.ts`, `apps/cli/src/commands/motion.ts`, `apps/desktop/src/renderer/editor/actions.ts` | the template, its name |
| `apps/cli/test/electron.check.test.ts`, `apps/desktop/test/app.check.test.ts`, `skill/cuttle/motion.md` | the checks, the guide |

---

### Task 1: Pages ask for frames, and wait for them

**Files:**
- Modify: `packages/export/src/motion/runtime.ts`, `packages/export/src/motion/take.ts`, `packages/export/src/motion/init.ts`, `packages/export/test/motion-runtime.browser.test.ts`, `packages/export/test/motion-take.test.ts`, `packages/export/test/motion-init.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m1d`; work there:

```bash
git switch p5-m1d
```

- [ ] **Step 2: Write the failing tests**

In `packages/export/test/motion-runtime.browser.test.ts`, replace:

```ts
      ],
      cursor: { fps: 10, start: 10, points: [0, 0, 10, 20, 20, 40] },
      window: { from: 11, to: 16 },
    };
    const win = page('', '', { ...INIT, start: 3, take });
    const { take: api } = win.cuttle;
```

with:

```ts
      ],
      cursor: { fps: 10, start: 10, points: [0, 0, 10, 20, 20, 40] },
      window: { from: 11, to: 16 },
      recording: null,
    };
    const win = page('', '', { ...INIT, start: 3, take });
    const { take: api } = win.cuttle;
```

In the same file, replace:

```ts
    expect(api.cursor).toEqual({ x: 500, y: 250, inside: true });
  });

  it('seeds Math.random: the same seed gives the same numbers', () => {
    const numbers = (seed: number) => page('', 'seen.push(Math.random(), Math.random(), Math.random())', { ...INIT, seed }).seen;
    const first = numbers(7);
```

with:

```ts
    expect(api.cursor).toEqual({ x: 500, y: 250, inside: true });
  });

  it('hands the page frames of the recording from the take worker, and waits for a draw that awaits one', async () => {
    // a stand-in for the kit's worker: a frame `width` px wide whose red is a tenth of the second asked
    const worker = URL.createObjectURL(
      new Blob(
        [
          `let opened;
          self.onmessage = (event) => {
            const message = event.data;
            if (message.type === 'open') return void (opened = message);
            if (message.source < 0) return self.postMessage({ id: message.id, error: 'no frame at ' + message.source });
            const canvas = new OffscreenCanvas(message.width ?? opened.screen.width, 4);
            const g = canvas.getContext('2d');
            g.fillStyle = 'rgb(' + Math.round(message.source * 10) + ', 0, ' + opened.masks.length + ')';
            g.fillRect(0, 0, canvas.width, 4);
            const bitmap = canvas.transferToImageBitmap();
            self.postMessage({ id: message.id, bitmap }, [bitmap]);
          };`,
        ],
        { type: 'text/javascript' },
      ),
    );
    const take: TakeData = {
      screen: { width: 32, height: 18 },
      events: [],
      words: [],
      markers: [],
      zooms: [],
      masks: [{ from: 0, to: 9, rect: [0, 0, 4, 4], style: 'fill' }],
      clips: [],
      cursor: null,
      window: null,
      recording: 'cuttle-motion://project/takes/1/screen.mp4',
    };
    const win = page(
      '',
      `const marker = () => [...document.documentElement.children].find((element) => element.style.top === '180px')?.style.background ?? 'none';
       cuttle.onFrame(async (t) => {
         const bitmap = await cuttle.take.frame(10 + t, t > 1 ? { width: 8 } : undefined);
         const g = new OffscreenCanvas(1, 1).getContext('2d');
         g.drawImage(bitmap, 0, 0);
         seen.push({ t, width: bitmap.width, red: g.getImageData(0, 0, 1, 1).data[0], masks: g.getImageData(0, 0, 1, 1).data[2], marker: marker() });
       });`,
      { ...INIT, take, takeWorker: worker },
    );
    expect(await win.__cuttleDraw(500)).toBe(1);
    expect(await win.__cuttleDraw(1500)).toBe(2);
    // each draw answered once the frame was drawn, and the marker moved on only then
    expect(win.seen).toEqual([
      { t: 0.5, width: 32, red: 105, masks: 1, marker: 'none' },
      { t: 1.5, width: 8, red: 115, masks: 1, marker: 'rgb(1, 0, 200)' },
    ]);
    const marker = [...win.document.documentElement.children].find((element) => (element as HTMLElement).style.top === '180px') as HTMLElement;
    expect(marker.style.background).toBe('rgb(2, 0, 200)');
    // what the worker could not do, the page is told
    await expect(win.cuttle.take.frame(-1)).rejects.toThrow('no frame at -1');
    // without a recording there is nothing to read
    await expect(page('', '').cuttle.take.frame(1)).rejects.toThrow('no screen recording');
  });

  it('seeds Math.random: the same seed gives the same numbers', () => {
    const numbers = (seed: number) => page('', 'seen.push(Math.random(), Math.random(), Math.random())', { ...INIT, seed }).seen;
    const first = numbers(7);
```

In `packages/export/test/motion-take.test.ts`, replace:

```ts
import { parseProject, type InputEvent } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { CURSOR_PATH_FPS, takeData } from '../src/motion/take';

function project(input: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
```

with:

```ts
import { parseProject, type InputEvent } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { CURSOR_PATH_FPS, projectFileUrl, takeData } from '../src/motion/take';

function project(input: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
```

In the same file, replace:

```ts
      { at: 12, duration: 3, rect: [0, 0, 1280, 720], label: 'Answer' },
      { at: 30, duration: 3, rect: [0, 0, 1280, 720], enabled: false },
    ],
    masks: [{ from: 11, to: 13, rect: [10, 10, 100, 20] }],
    captions: { fixes: [{ at: 12, end: 12.5, text: 'Cuttle' }] },
  });
  const events: InputEvent[] = [
```

with:

```ts
      { at: 12, duration: 3, rect: [0, 0, 1280, 720], label: 'Answer' },
      { at: 30, duration: 3, rect: [0, 0, 1280, 720], enabled: false },
    ],
    masks: [
      { from: 11, to: 13, rect: [10, 10, 100, 20] },
      { from: 12, to: 16, rect: [0, 400, 300, 30], style: 'blur', moves: [{ at: 14, rect: [0, 300, 300, 30] }] },
      { from: 20, to: 21, rect: [0, 0, 10, 10], enabled: false },
    ],
    captions: { fixes: [{ at: 12, end: 12.5, text: 'Cuttle' }] },
  });
  const events: InputEvent[] = [
```

In the same file, replace:

```ts
    ]);
  });

  it('has the words with the project\'s fixes, the markers, the zooms that are on and the masks', () => {
    expect(take.words).toEqual([
      { t: 12, end: 12.5, text: 'Cuttle' },
      { t: 13, end: 13.3, text: 'records' },
    ]);
    expect(take.markers).toEqual([{ t: 11.5, kind: 'prompt' }]);
    expect(take.zooms).toEqual([{ at: 12, duration: 3, rect: [0, 0, 1280, 720], label: 'Answer' }]);
    expect(take.masks).toEqual([{ from: 11, to: 13, rect: [10, 10, 100, 20] }]);
    expect(take.screen).toEqual(SCREEN);
    expect(take.window).toEqual({ from: 11, to: 16 });
  });
```

with:

```ts
    ]);
  });

  it('has the words with the project\'s fixes, the markers, the zooms and masks that are on, and the recording', () => {
    expect(take.words).toEqual([
      { t: 12, end: 12.5, text: 'Cuttle' },
      { t: 13, end: 13.3, text: 'records' },
    ]);
    expect(take.markers).toEqual([{ t: 11.5, kind: 'prompt' }]);
    expect(take.zooms).toEqual([{ at: 12, duration: 3, rect: [0, 0, 1280, 720], label: 'Answer' }]);
    expect(take.masks).toEqual([
      { from: 11, to: 13, rect: [10, 10, 100, 20], style: 'fill' },
      { from: 12, to: 16, rect: [0, 400, 300, 30], style: 'blur', moves: [{ at: 14, rect: [0, 300, 300, 30] }] },
    ]);
    expect(take.recording).toBe('cuttle-motion://project/s.mp4');
    expect(take.screen).toEqual(SCREEN);
    expect(take.window).toEqual({ from: 11, to: 16 });
  });
```

In the same file, replace:

```ts
    expect(points.slice(-2)).toEqual([640, 360]);
  });

  it('has no pointer path without moves', () => {
    expect(takeData(p, { events: [], words: [], markers: [] }, SCREEN, null).cursor).toBeNull();
  });
```

with:

```ts
    expect(points.slice(-2)).toEqual([640, 360]);
  });

  it('reaches the recording at its URL in the page, only inside the project', () => {
    expect(projectFileUrl('takes/1/screen.mp4')).toBe('cuttle-motion://project/takes/1/screen.mp4');
    expect(projectFileUrl('takes\\2\\my screen#1.mp4')).toBe('cuttle-motion://project/takes/2/my%20screen%231.mp4');
    expect(projectFileUrl('./takes//1/screen.mp4')).toBe('cuttle-motion://project/takes/1/screen.mp4');
    for (const outside of ['../other/screen.mp4', '/home/me/screen.mp4', 'C:\\take\\screen.mp4', 'takes/../../screen.mp4', '']) expect(projectFileUrl(outside), outside).toBeNull();
  });

  it('has no pointer path without moves', () => {
    expect(takeData(p, { events: [], words: [], markers: [] }, SCREEN, null).cursor).toBeNull();
  });
```

In `packages/export/test/motion-init.test.ts`, replace:

```ts
      seed: motionSeed('scenes[0]'),
      fonts,
      take: null,
    });
    expect(motionInit(p, { ...scene, id: 's7' }, 'scenes[0]', { start: 0, duration: 2 }, context).seed).toBe(motionSeed('s7'));
  });
```

with:

```ts
      seed: motionSeed('scenes[0]'),
      fonts,
      take: null,
      // the take's frames are read by the kit's worker
      takeWorker: 'cuttle-motion://kit/take-worker.js',
    });
    expect(motionInit(p, { ...scene, id: 's7' }, 'scenes[0]', { start: 0, duration: 2 }, context).seed).toBe(motionSeed('s7'));
  });
```

Run: `pnpm exec vitest run --project node packages/export/test/motion-take.test.ts packages/export/test/motion-init.test.ts`
Expected: FAIL: there is no `projectFileUrl`, and the masks have no style.

- [ ] **Step 3: The take data**

In `packages/export/src/motion/take.ts`, replace:

```ts
  markers: readonly Marker[];
}

const tenth = (value: number) => Math.round(value * 10) / 10;
const milli = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The take as a motion page sees it (`cuttle.take`): its input, words and markers, the project's
 * zooms and masks, where its clips are in the video, and the pointer's path as the video draws it.
 * `window` is an overlay's stretch of the take (source seconds).
 */
export function takeData(project: CuttleProject, inputs: TakeInputs, screen: { width: number; height: number }, window: { from: number; to: number } | null): TakeData {
  const events: TakeData['events'] = [];
```

with:

```ts
  markers: readonly Marker[];
}

/**
 * A file of the project as a motion page reaches it (its session serves the project at
 * `cuttle-motion://project/`), or null for one outside the project.
 */
export function projectFileUrl(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.');
  if (/^([a-z]:|[\\/])/i.test(path) || parts.length === 0 || parts.includes('..')) return null;
  return `cuttle-motion://project/${parts.map(encodeURIComponent).join('/')}`;
}

const tenth = (value: number) => Math.round(value * 10) / 10;
const milli = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The take as a motion page sees it (`cuttle.take`): its input, words and markers, the project's
 * zooms and masks, where its clips are in the video, the pointer's path as the video draws it, and
 * the screen recording's URL for its frames. `window` is an overlay's stretch of the take (source seconds).
 */
export function takeData(project: CuttleProject, inputs: TakeInputs, screen: { width: number; height: number }, window: { from: number; to: number } | null): TakeData {
  const events: TakeData['events'] = [];
```

In the same file, replace:

```ts
    words: applyCaptionFixes(inputs.words, project.captions.fixes).map(({ t, end, text }) => ({ t, end, text })),
    markers: inputs.markers.map(({ t, kind, label }) => ({ t, kind, ...(label !== undefined && { label }) })),
    zooms: project.zooms.filter((zoom) => zoom.enabled).map(({ at, duration, rect, label }) => ({ at, duration, rect, ...(label !== undefined && { label }) })),
    masks: project.masks.filter((mask) => mask.enabled).map(({ from, to, rect }) => ({ from, to, rect })),
    clips,
    cursor: cursorPath(inputs.events, project.look.cursor.smoothing),
    window,
  };
}
```

with:

```ts
    words: applyCaptionFixes(inputs.words, project.captions.fixes).map(({ t, end, text }) => ({ t, end, text })),
    markers: inputs.markers.map(({ t, kind, label }) => ({ t, kind, ...(label !== undefined && { label }) })),
    zooms: project.zooms.filter((zoom) => zoom.enabled).map(({ at, duration, rect, label }) => ({ at, duration, rect, ...(label !== undefined && { label }) })),
    masks: project.masks.filter((mask) => mask.enabled).map(({ from, to, rect, style, moves }) => ({ from, to, rect, style, ...(moves?.length && { moves: moves.map(({ at, rect }) => ({ at, rect })) }) })),
    clips,
    cursor: cursorPath(inputs.events, project.look.cursor.smoothing),
    window,
    recording: project.sources.screen === undefined ? null : projectFileUrl(project.sources.screen),
  };
}
```

- [ ] **Step 4: The runtime**

In `packages/export/src/motion/runtime.ts`, replace:

```ts
  /** Claude's prompt, tools and answer, the marker key, slips. */
  markers: { t: number; kind: string; label?: string }[];
  zooms: { at: number; duration: number; rect: Rect; label?: string }[];
  masks: { from: number; to: number; rect: Rect }[];
  /** The clips as the video plays them: output seconds `start`–`end` show source `from`–`to` at `speed`. */
  clips: { start: number; end: number; from: number; to: number; speed: number }[];
  /** The pointer as the video draws it (smoothed), every 1/fps source second from `start`: x, y, x, y, … */
  cursor: { fps: number; start: number; points: number[] } | null;
  /** An overlay's stretch of the take (source seconds); null for a scene. */
  window: { from: number; to: number } | null;
}

/** Where the frame being drawn shows the take: set before each frame of an overlay, empty for a scene. */
export interface MotionView {
  /** The source second the clip under it shows. */
```

with:

```ts
  /** Claude's prompt, tools and answer, the marker key, slips. */
  markers: { t: number; kind: string; label?: string }[];
  zooms: { at: number; duration: number; rect: Rect; label?: string }[];
  /** The privacy masks: `fill` or `blur`; one that follows text moves to each move's rect in turn. */
  masks: { from: number; to: number; rect: Rect; style: string; moves?: { at: number; rect: Rect }[] }[];
  /** The clips as the video plays them: output seconds `start`–`end` show source `from`–`to` at `speed`. */
  clips: { start: number; end: number; from: number; to: number; speed: number }[];
  /** The pointer as the video draws it (smoothed), every 1/fps source second from `start`: x, y, x, y, … */
  cursor: { fps: number; start: number; points: number[] } | null;
  /** An overlay's stretch of the take (source seconds); null for a scene. */
  window: { from: number; to: number } | null;
  /** The screen recording's URL in the page (for `frame`), or null without one. */
  recording: string | null;
}

/** Where the take's frames are read: the kit's worker. */
export const TAKE_WORKER = 'cuttle-motion://kit/take-worker.js';

/** Where the frame being drawn shows the take: set before each frame of an overlay, empty for a scene. */
export interface MotionView {
  /** The source second the clip under it shows. */
```

In the same file, replace:

```ts
  /** Fonts every page has (the kit's): family, weight (a range for a variable font), style, width range and URL. */
  fonts: { family: string; weight: string; style: string; stretch?: string; src: string }[];
  take: TakeData | null;
}

/** A point of the screen recording in the frame: output px, and whether the frame shows it. */
```

with:

```ts
  /** Fonts every page has (the kit's): family, weight (a range for a variable font), style, width range and URL. */
  fonts: { family: string; weight: string; style: string; stretch?: string; src: string }[];
  take: TakeData | null;
  /** The script that reads the take's frames (`TAKE_WORKER`; a test gives its own). */
  takeWorker?: string;
}

/** A point of the screen recording in the frame: output px, and whether the frame shows it. */
```

In the same file, replace:

```ts
  toSource(output: number): number | null;
  /** The pointer at source second `source` (source px), as the video draws it, or null. */
  cursorAt(source: number): { x: number; y: number } | null;
  /** A point of the screen recording (source px) in this frame (output px), with the window, crop and zoom; null in a scene. */
  toScreen(x: number, y: number): ScreenPoint | null;
  /** The source second shown under the overlay now; null in a scene. */
```

with:

```ts
  toSource(output: number): number | null;
  /** The pointer at source second `source` (source px), as the video draws it, or null. */
  cursorAt(source: number): { x: number; y: number } | null;
  /**
   * The screen recording's frame at source second `source`, with the project's privacy masks drawn
   * over it, `width` px wide (the recording's own size without): for a screen in 3D, a freeze, a lens.
   * Await it in `onFrame` (the frame waits for an async draw); close a bitmap once it is drawn.
   * Frames read forward fastest.
   */
  frame(source: number, options?: { width?: number }): Promise<ImageBitmap>;
  /** A point of the screen recording (source px) in this frame (output px), with the window, crop and zoom; null in a scene. */
  toScreen(x: number, y: number): ScreenPoint | null;
  /** The source second shown under the overlay now; null in a scene. */
```

In the same file, replace:

```ts
  readonly format: string;
  readonly params: Record<string, unknown>;
  readonly theme: Record<string, string>;
  /** Calls `draw(seconds)` for every frame, before it is drawn (also after a seek): the surest way to animate. */
  onFrame(draw: (seconds: number) => void): void;
  /** Holds the first frame until `promise` settles (fonts, images, models). */
  ready(promise: Promise<unknown>): void;
  /** The take (empty lists when the item has no take). */
```

with:

```ts
  readonly format: string;
  readonly params: Record<string, unknown>;
  readonly theme: Record<string, string>;
  /**
   * Calls `draw(seconds)` for every frame, before it is drawn (also after a seek): the surest way to
   * animate. A draw that returns a promise (it awaits a frame of the take) is waited for.
   */
  onFrame(draw: (seconds: number) => void | Promise<unknown>): void;
  /** Holds the first frame until `promise` settles (fonts, images, models). */
  ready(promise: Promise<unknown>): void;
  /** The take (empty lists when the item has no take). */
```

In the same file, replace:

```ts
  let nextId = 1;
  const timers = new Map<number, Timer>();
  const frames = new Map<number, FrameRequestCallback>();
  const drawers: ((seconds: number) => void)[] = [];
  const holds: Promise<unknown>[] = [];
  const errors: string[] = [];
  page.__cuttleErrors = errors;
```

with:

```ts
  let nextId = 1;
  const timers = new Map<number, Timer>();
  const frames = new Map<number, FrameRequestCallback>();
  const drawers: ((seconds: number) => void | Promise<unknown>)[] = [];
  const holds: Promise<unknown>[] = [];
  const errors: string[] = [];
  page.__cuttleErrors = errors;
```

In the same file, replace:

```ts
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

  // the theme, as CSS variables on the root, and the kit's fonts (a constructed sheet works before the page is parsed)
```

with:

```ts
  const sight = () => {
    for (const animation of document.getAnimations()) if (!started.has(animation)) started.set(animation, now);
  };
  /** Calls `fn`, noting what it throws; what it returns (a draw's promise). */
  const call = (fn: unknown, args: unknown[]): unknown => {
    let result: unknown;
    try {
      if (typeof fn === 'function') result = fn(...args);
    } catch (error) {
      note(error);
    }
    sight();
    return result;
  };

  // the theme, as CSS variables on the root, and the kit's fonts (a constructed sheet works before the page is parsed)
```

In the same file, replace:

```ts
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  // the take
  const data: TakeData = init.take ?? { screen: { width: init.width, height: init.height }, events: [], words: [], markers: [], zooms: [], masks: [], clips: [], cursor: null, window: null };
  let view: MotionView = { source: null, zoom: null, content: null, cursor: null };
  const toScreen = (x: number, y: number): ScreenPoint | null => {
    const { zoom, content } = view;
```

with:

```ts
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  // the take
  const data: TakeData = init.take ?? { screen: { width: init.width, height: init.height }, events: [], words: [], markers: [], zooms: [], masks: [], clips: [], cursor: null, window: null, recording: null };
  let view: MotionView = { source: null, zoom: null, content: null, cursor: null };
  const toScreen = (x: number, y: number): ScreenPoint | null => {
    const { zoom, content } = view;
```

In the same file, replace:

```ts
    const sy = content[1] + ((y - zoom[1]) * content[3]) / zoom[3];
    return { x: sx, y: sy, inside: sx >= content[0] && sx <= content[0] + content[2] && sy >= content[1] && sy <= content[1] + content[3] };
  };
  const { cursor: path, ...takeFields } = data;
  const take: CuttleTake = {
    ...takeFields,
```

with:

```ts
    const sy = content[1] + ((y - zoom[1]) * content[3]) / zoom[3];
    return { x: sx, y: sy, inside: sx >= content[0] && sx <= content[0] + content[2] && sy >= content[1] && sy <= content[1] + content[3] };
  };
  // the recording's frames: read in the kit's worker (off the page's clock), one request at a time
  let reader: Worker | undefined;
  let readerFailure: string | undefined;
  let asked = 0;
  const replies = new Map<number, { resolve: (bitmap: ImageBitmap) => void; reject: (error: Error) => void }>();
  const failAll = (message: string) => {
    readerFailure = message;
    for (const reply of replies.values()) reply.reject(new Error(message));
    replies.clear();
  };
  const frameOf = (source: number, options: { width?: number } = {}): Promise<ImageBitmap> => {
    if (!data.recording || !init.takeWorker) return Promise.reject(new Error('this item has no screen recording to take frames from'));
    if (readerFailure) return Promise.reject(new Error(readerFailure));
    if (!reader) {
      // a worker must come from the page's own origin: a module of the page's that imports the kit's
      const boot = URL.createObjectURL(new Blob([`import ${JSON.stringify(init.takeWorker)};`], { type: 'text/javascript' }));
      reader = new Worker(boot, { type: 'module' });
      reader.onmessage = (event: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>) => {
        const { id, bitmap, error } = event.data;
        const reply = replies.get(id);
        replies.delete(id);
        if (bitmap) reply?.resolve(bitmap);
        else reply?.reject(new Error(error ?? 'no frame'));
      };
      reader.onerror = (event) => failAll(`the take's frames could not be read: ${event.message || 'the reader failed'}`);
      reader.postMessage({ type: 'open', url: data.recording, masks: data.masks, screen: data.screen });
    }
    const id = ++asked;
    const width = options.width === undefined ? undefined : Math.max(1, Math.round(Number(options.width)));
    return new Promise((resolve, reject) => {
      replies.set(id, { resolve, reject });
      reader!.postMessage({ type: 'frame', id, source: Number(source), width });
    });
  };

  const { cursor: path, ...takeFields } = data;
  const take: CuttleTake = {
    ...takeFields,
```

In the same file, replace:

```ts
      const p = path.points;
      return { x: p[2 * i]! + (p[2 * j]! - p[2 * i]!) * f, y: p[2 * i + 1]! + (p[2 * j + 1]! - p[2 * i + 1]!) * f };
    },
    toScreen,
    get source() {
      return view.source;
```

with:

```ts
      const p = path.points;
      return { x: p[2 * i]! + (p[2 * j]! - p[2 * i]!) * f, y: p[2 * i + 1]! + (p[2 * j + 1]! - p[2 * i + 1]!) * f };
    },
    frame: frameOf,
    toScreen,
    get source() {
      return view.source;
```

In the same file, replace:

```ts

  let frame = 0;
  /**
   * Moves the clock to `ms` (never back) and draws: due timers in order, one animation frame, every
   * animation to its time. `next` is the frame's view of the take (an overlay's). Answers with the
   * draw's number, which the marker shows.
   */
  page.__cuttleDraw = (ms: number, next?: MotionView): Promise<number> => {
    if (next) view = next;
    mark(++frame);
    sight();
    const target = Math.max(now, ms);
    for (let fired = 0; ; fired++) {
```

with:

```ts

  let frame = 0;
  /**
   * Moves the clock to `ms` (never back) and draws: due timers in order, one animation frame (and
   * the draws it returns promises for), every animation to its time. `next` is the frame's view of
   * the take (an overlay's). Answers with the draw's number, which the marker shows.
   */
  page.__cuttleDraw = (ms: number, next?: MotionView): Promise<number> => {
    if (next) view = next;
    sight();
    const target = Math.max(now, ms);
    for (let fired = 0; ; fired++) {
```

In the same file, replace:

```ts
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

with:

```ts
      call(timer.fn, timer.args);
    }
    now = target;
    // a draw that returns a promise (it awaits a frame of the take) is waited for, the clock held
    const waits: Promise<unknown>[] = [];
    const awaited = (result: unknown) => {
      if (result && typeof (result as Promise<unknown>).then === 'function') waits.push(Promise.resolve(result).catch(note));
    };
    for (const draw of drawers) awaited(call(draw, [now / 1000]));
    const callbacks = [...frames.values()];
    frames.clear();
    for (const fn of callbacks) awaited(call(fn, [now]));
    // the marker changes with the drawing, once it is all drawn: no paint before shows the new number
    const settle = () => {
      mark(++frame);
      sight();
      for (const animation of document.getAnimations()) {
        animation.pause();
        animation.currentTime = (now - (started.get(animation) ?? now)) * (animation.playbackRate || 1);
      }
      return new Promise<number>((resolve) => realFrame(() => realFrame(() => resolve(frame))));
    };
    return waits.length === 0 ? settle() : Promise.all(waits).then(settle);
  };
}
```

In `packages/export/src/motion/init.ts`, replace:

```ts
import type { BackgroundPreset, CuttleProject, MotionOverlay, MotionScene } from '@cuttle/project';
import type { MotionInit } from './runtime';

/** A dark tone of each background preset, for pages that draw their own background. */
const BACKGROUND_TONES: Record<BackgroundPreset, string> = {
```

with:

```ts
import type { BackgroundPreset, CuttleProject, MotionOverlay, MotionScene } from '@cuttle/project';
import { TAKE_WORKER, type MotionInit } from './runtime';

/** A dark tone of each background preset, for pages that draw their own background. */
const BACKGROUND_TONES: Record<BackgroundPreset, string> = {
```

In the same file, replace:

```ts
    seed: motionSeed(item.id ?? name),
    fonts: context.fonts,
    take: context.take,
  };
}
```

with:

```ts
    seed: motionSeed(item.id ?? name),
    fonts: context.fonts,
    take: context.take,
    takeWorker: TAKE_WORKER,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node packages/export/test/motion-take.test.ts packages/export/test/motion-init.test.ts`
Expected: PASS.

Run: `pnpm exec vitest run --project browser packages/export/test/motion-runtime.browser.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/export/src/motion packages/export/test/motion-runtime.browser.test.ts packages/export/test/motion-take.test.ts packages/export/test/motion-init.test.ts
git commit -m "export: cuttle.take.frame in motion pages, and a draw that awaits one holds its frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The kit reads the frames

**Files:**
- Create: `packages/motion-kit/kit/take.js`, `packages/motion-kit/kit/take.d.ts`, `packages/motion-kit/kit/take-worker.js`, `packages/motion-kit/test/take.test.ts`
- Modify: `packages/motion-kit/package.json`, `pnpm-lock.yaml`, `packages/motion-kit/scripts/copy.mjs`, `packages/export/src/main/motion.ts`

- [ ] **Step 1: Write the failing test**

`packages/motion-kit/test/take.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { maskRectAt, masksAt, ringColor, type Rect } from '../kit/take.js';

describe('the masks over a frame of the take', () => {
  const still = { from: 1, to: 3, rect: [100, 50, 200, 40] as Rect, style: 'fill' };
  const follows = { from: 0, to: 4, rect: [0, 400, 100, 20] as Rect, style: 'blur', moves: [{ at: 2, rect: [0, 300, 100, 20] as Rect }] };

  it('is on from its start until its end, where it is then', () => {
    expect(maskRectAt(still, 0.99)).toBeNull();
    expect(maskRectAt(still, 1)).toEqual([100, 50, 200, 40]);
    expect(maskRectAt(still, 3)).toBeNull();
  });

  it('covers both places of a mask that follows, until its move, then the new place', () => {
    expect(maskRectAt(follows, 1)).toEqual([0, 300, 100, 120]);
    expect(maskRectAt(follows, 2.5)).toEqual([0, 300, 100, 20]);
  });

  it('scales to the frame, grows to whole pixels and stays inside it', () => {
    expect(masksAt([still, follows], 1.5, 0.5, 640, 180)).toEqual([
      { style: 'fill', rect: [50, 25, 100, 20] },
      { style: 'blur', rect: [0, 150, 50, 30] },
    ]);
    expect(masksAt([{ ...still, rect: [-10.4, 1.2, 50, 5] as Rect }], 2, 1, 30, 4)).toEqual([{ style: 'fill', rect: [0, 1, 30, 3] }]);
    expect(masksAt([{ ...still, rect: [700, 0, 50, 5] as Rect }], 2, 1, 640, 360)).toEqual([]);
    // an unknown style is filled: hidden either way
    expect(masksAt([{ ...still, style: 'pixelate' }], 2, 1, 640, 360)[0]!.style).toBe('fill');
  });

  it('fills with the mean colour around it, or its own without room around it', () => {
    // a 4×3 region: the mask is the middle 2×1, the ring around it red and blue
    const data = new Uint8ClampedArray(4 * 3 * 4);
    for (let i = 0; i < 12; i++) data.set(i % 2 ? [0, 0, 255, 255] : [255, 0, 0, 255], i * 4);
    data.set([0, 255, 0, 255], (1 * 4 + 1) * 4);
    data.set([0, 255, 0, 255], (1 * 4 + 2) * 4);
    expect(ringColor(data, 4, [1, 1, 2, 1])).toEqual([128, 0, 128]);
    expect(ringColor(data, 4, [0, 0, 4, 3])).toEqual([106, 43, 106]);
  });
});
```

Run: `pnpm exec vitest run --project node packages/motion-kit/test/take.test.ts`
Expected: FAIL: there is no `kit/take.js`.

- [ ] **Step 2: The masks on a frame**

`packages/motion-kit/kit/take.js`:

```
// The take's frames for motion pages (`cuttle.take.frame`): where the project's privacy masks are at
// a moment, in a frame's pixels, and the colour that fills one. The kit's worker (take-worker.js)
// reads the frames and paints the masks with these, as the video masks the clips.

/**
 * Where a mask is at source second `t`, in source px, or null while it is off. One that follows text
 * covers, between two of its places, both of them (as the video masks it).
 */
export function maskRectAt(mask, t) {
  if (!(t >= mask.from && t < mask.to)) return null;
  const places = [{ at: mask.from, rect: mask.rect }, ...(mask.moves ?? [])];
  let i = 0;
  while (i + 1 < places.length && places[i + 1].at <= t) i++;
  const here = places[i].rect;
  const next = places[i + 1]?.rect;
  if (!next) return here;
  const left = Math.min(here[0], next[0]);
  const top = Math.min(here[1], next[1]);
  return [left, top, Math.max(here[0] + here[2], next[0] + next[2]) - left, Math.max(here[1] + here[3], next[1] + next[3]) - top];
}

/**
 * The masks on at `t` in a frame `width`×`height` px that shows the recording at `scale` (frame px a
 * source px): whole pixels, grown outward to cover every partly masked one, kept inside the frame.
 */
export function masksAt(masks, t, scale, width, height) {
  const shown = [];
  for (const mask of masks) {
    const rect = maskRectAt(mask, t);
    if (!rect) continue;
    const x = Math.max(0, Math.floor(rect[0] * scale));
    const y = Math.max(0, Math.floor(rect[1] * scale));
    const right = Math.min(width, Math.ceil((rect[0] + rect[2]) * scale));
    const bottom = Math.min(height, Math.ceil((rect[1] + rect[3]) * scale));
    if (right > x && bottom > y) shown.push({ style: mask.style === 'blur' ? 'blur' : 'fill', rect: [x, y, right - x, bottom - y] });
  }
  return shown;
}

/**
 * The mean colour of the pixels around a mask: RGBA `data` of a region `width` px wide holds the mask
 * at `inner` ([x, y, w, h] in the region) and a ring around it; the ring's pixels are averaged.
 * Without a ring (a mask over the whole frame), the mean of the mask itself.
 */
export function ringColor(data, width, inner) {
  const height = data.length / 4 / width;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const [ix, iy, iw, ih] = inner;
  for (const ring of [true, false]) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inside = x >= ix && x < ix + iw && y >= iy && y < iy + ih;
        if (ring === inside) continue;
        const i = (y * width + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
    }
    if (count > 0) break;
  }
  return count === 0 ? [0, 0, 0] : [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}
```

`packages/motion-kit/kit/take.d.ts`:

```ts
// Types of the take's mask helpers (take.js), which the kit's worker uses for `cuttle.take.frame`.

export type Rect = [x: number, y: number, width: number, height: number];
export interface TakeMask {
  from: number;
  to: number;
  rect: Rect;
  style: string;
  moves?: { at: number; rect: Rect }[];
}

export function maskRectAt(mask: TakeMask, t: number): Rect | null;
export function masksAt(masks: readonly TakeMask[], t: number, scale: number, width: number, height: number): { style: 'fill' | 'blur'; rect: Rect }[];
export function ringColor(data: ArrayLike<number>, width: number, inner: Rect): [number, number, number];
```

Run: `pnpm exec vitest run --project node packages/motion-kit/test/take.test.ts`
Expected: PASS.

- [ ] **Step 3: mediabunny in the kit**

In `packages/motion-kit/package.json`, replace:

```json
    "@fontsource/inter": "^5.3.0",
    "@fontsource/jetbrains-mono": "5.3.0",
    "lottie-web": "5.13.0",
    "three": "0.186.1"
  }
}
```

with:

```json
    "@fontsource/inter": "^5.3.0",
    "@fontsource/jetbrains-mono": "5.3.0",
    "lottie-web": "5.13.0",
    "mediabunny": "1.61.0",
    "three": "0.186.1"
  }
}
```

In `pnpm-lock.yaml`, replace:

```yaml
      lottie-web:
        specifier: 5.13.0
        version: 5.13.0
      three:
        specifier: 0.186.1
        version: 0.186.1
```

with:

```yaml
      lottie-web:
        specifier: 5.13.0
        version: 5.13.0
      mediabunny:
        specifier: 1.61.0
        version: 1.61.0
      three:
        specifier: 0.186.1
        version: 0.186.1
```

```bash
pnpm install
```

In `packages/motion-kit/scripts/copy.mjs`, replace:

```js
// Builds the motion kit's folder for a bundle (see src/index.ts for what is where):
//   node packages/motion-kit/scripts/copy.mjs <folder>
// The folder is replaced. Everything comes from this package: its own kit/ and templates/, and the
// files of its dependencies (Three.js, lottie-web, the fonts) with their licenses.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
```

with:

```js
// Builds the motion kit's folder for a bundle (see src/index.ts for what is where):
//   node packages/motion-kit/scripts/copy.mjs <folder>
// The folder is replaced. Everything comes from this package: its own kit/ and templates/, and the
// files of its dependencies (Three.js, lottie-web, mediabunny, the fonts) with their licenses.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
```

In the same file, replace:

```js
copy(join(modules, 'lottie-web', 'build', 'player', 'esm', 'lottie.min.js'), 'lottie/lottie.mjs');
copy(join(modules, 'lottie-web', 'build', 'player', 'lottie.min.js'), 'lottie/lottie.min.js');
copy(join(modules, 'lottie-web', 'LICENSE.md'), 'licenses/lottie-web.txt');

// the Latin faces KIT_FONTS (src/index.ts) names, each family with its licence
const FONTS = [
```

with:

```js
copy(join(modules, 'lottie-web', 'build', 'player', 'esm', 'lottie.min.js'), 'lottie/lottie.mjs');
copy(join(modules, 'lottie-web', 'build', 'player', 'lottie.min.js'), 'lottie/lottie.min.js');
copy(join(modules, 'lottie-web', 'LICENSE.md'), 'licenses/lottie-web.txt');
// the take's frames are read with it (take-worker.js), unchanged: its licence is the MPL 2.0
copy(join(modules, 'mediabunny', 'dist', 'bundles', 'mediabunny.min.mjs'), 'mediabunny/mediabunny.min.mjs');
copy(join(modules, 'mediabunny', 'LICENSE'), 'licenses/mediabunny.txt');

// the Latin faces KIT_FONTS (src/index.ts) names, each family with its licence
const FONTS = [
```

- [ ] **Step 4: The worker**

`packages/motion-kit/kit/take-worker.js`:

```
// Reads the screen recording's frames for a motion page (`cuttle.take.frame`), in a worker of its own,
// so the page's virtual clock does not hold it up. mediabunny reads the file over the project's URL
// (in ranges) and WebCodecs decodes it, on forward from the frame asked last where it can. Each frame
// goes back to the page as an ImageBitmap, the project's privacy masks painted over it as the video
// paints them: `fill` with the colour around it, `blur` beyond reading.
//
// Messages: { type: 'open', url, masks } once, then { type: 'frame', id, source, width? }; each frame
// is answered with { id, bitmap } or { id, error }, in the order asked.
import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from './mediabunny/mediabunny.min.mjs';
import { masksAt, ringColor } from './take.js';

/** Further ahead than this (seconds), decoding starts again at the key frame before the time asked. */
const JUMP = 3;
/** The widest frame a page gets (px). */
const MAX_WIDTH = 4096;
/** Pixels around a fill mask whose colour fills it. */
const RING = 3;

let take;
let failure;
let iterator;
let current;
let upcoming;
let ended = false;
let startedAt = -Infinity;
let last = -Infinity;

async function open({ url, masks }) {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('the screen recording has no video track');
  if (!(await track.canDecode())) throw new Error('the screen recording cannot be decoded here');
  take = { sink: new VideoSampleSink(track), first: await track.getFirstTimestamp(), width: track.displayWidth, height: track.displayHeight, masks: masks ?? [] };
}

function restart(t) {
  void iterator?.return();
  current?.close();
  upcoming?.close();
  current = upcoming = undefined;
  ended = false;
  startedAt = t;
  iterator = take.sink.samples(t);
}

/** The frame shown at `t`: the last one starting by then (the first, before it). */
async function sampleAt(t) {
  const reached = current?.timestamp ?? startedAt;
  if (!iterator || t < last - 1e-6 || t > reached + JUMP) restart(t);
  last = t;
  for (;;) {
    if (!upcoming && !ended) {
      const step = await iterator.next();
      if (step.done) ended = true;
      else upcoming = step.value;
    }
    if (!upcoming || upcoming.timestamp > t + 1e-6) break;
    current?.close();
    current = upcoming;
    upcoming = undefined;
  }
  return current ?? upcoming;
}

/** Fills a mask with the colour just around it. */
function fill(ctx, [x, y, w, h], width, height) {
  const left = Math.max(0, x - RING);
  const top = Math.max(0, y - RING);
  const right = Math.min(width, x + w + RING);
  const bottom = Math.min(height, y + h + RING);
  const region = ctx.getImageData(left, top, right - left, bottom - top);
  const [r, g, b] = ringColor(region.data, region.width, [x - left, y - top, w, h]);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(x, y, w, h);
}

/** Blurs a mask beyond reading: down to a few pixels on its short side, then up again, softened. */
function blur(canvas, ctx, [x, y, w, h]) {
  const factor = Math.max(10, Math.min(w, h) / 6);
  const small = new OffscreenCanvas(Math.max(1, Math.round(w / factor)), Math.max(1, Math.round(h / factor)));
  const s = small.getContext('2d');
  s.imageSmoothingQuality = 'high';
  s.drawImage(canvas, x, y, w, h, 0, 0, small.width, small.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const pad = Math.ceil(factor);
  ctx.filter = `blur(${Math.max(2, Math.round(factor / 2))}px)`;
  ctx.drawImage(small, x - pad, y - pad, w + 2 * pad, h + 2 * pad);
  ctx.restore();
}

async function frame({ id, source, width }) {
  if (!take) throw failure ?? new Error('the screen recording is not open');
  const t = Math.max(Number.isFinite(source) ? source : 0, take.first);
  const sample = await sampleAt(t);
  if (!sample) throw new Error(`the screen recording has no frame at ${t.toFixed(3)} s`);
  const w = Math.min(MAX_WIDTH, Math.max(1, Math.round(width ?? take.width)));
  const h = Math.max(1, Math.round((take.height * w) / take.width));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  sample.draw(ctx, 0, 0, w, h);
  for (const mask of masksAt(take.masks, t, w / take.width, w, h)) {
    if (mask.style === 'blur') blur(canvas, ctx, mask.rect);
    else fill(ctx, mask.rect, w, h);
  }
  const bitmap = canvas.transferToImageBitmap();
  self.postMessage({ id, bitmap }, [bitmap]);
}

// one message at a time, in order: the frames go forward through the file
let queue = Promise.resolve();
self.onmessage = (event) => {
  const message = event.data;
  queue = queue.then(async () => {
    try {
      if (message.type === 'open') await open(message);
      else if (message.type === 'frame') await frame(message);
    } catch (error) {
      if (message.type === 'open') failure = error instanceof Error ? error : new Error(String(error));
      else self.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
```

- [ ] **Step 5: Byte ranges for the pages**

In `packages/export/src/main/motion.ts`, replace:

```ts
// page's transparency kept, the same on every render. The motion kit (Three.js, lottie-web, fonts,
// Cuttle's helpers) is served at cuttle-motion://kit/, and every page of the project gets an
// import map for its bare names (`three`, `cuttle`).
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER, withImportMap } from '@cuttle/motion-kit';
import { BrowserWindow, screen, session, type NativeImage, type Session } from 'electron';
```

with:

```ts
// page's transparency kept, the same on every render. The motion kit (Three.js, lottie-web, fonts,
// Cuttle's helpers) is served at cuttle-motion://kit/, and every page of the project gets an
// import map for its bare names (`three`, `cuttle`).
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER, withImportMap } from '@cuttle/motion-kit';
import { BrowserWindow, screen, session, type NativeImage, type Session } from 'electron';
```

In the same file, replace:

```ts
    if (base === undefined || path === undefined || !inside(base, path)) return new Response('not found', { status: 404 });
    try {
      const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
      const bytes = await readFile(path);
      // the project's pages get the kit's import map; the kit's files are served as they are
      const body = url.host === 'project' && type === 'text/html' ? withImportMap(bytes.toString('utf8')) : bytes;
      return new Response(body, { headers: { 'Content-Type': type, 'Content-Security-Policy': policy, 'Cache-Control': 'no-store' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
```

with:

```ts
    if (base === undefined || path === undefined || !inside(base, path)) return new Response('not found', { status: 404 });
    try {
      const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Content-Security-Policy': policy, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
      // a part of a file (the take's frames, a video the page plays): streamed from where it is asked
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
      if (range) {
        const size = (await stat(path)).size;
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
        if (start > end) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
        const part = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
        return new Response(part, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
      }
      const bytes = await readFile(path);
      // the project's pages get the kit's import map; the kit's files are served as they are
      const body = url.host === 'project' && type === 'text/html' ? withImportMap(bytes.toString('utf8')) : bytes;
      return new Response(body, { headers });
    } catch {
      return new Response('not found', { status: 404 });
    }
```

- [ ] **Step 6: Commit**

```bash
git add packages/motion-kit/kit packages/motion-kit/test/take.test.ts packages/motion-kit/package.json pnpm-lock.yaml packages/motion-kit/scripts/copy.mjs packages/export/src/main/motion.ts
git commit -m "kit: the take worker reads the recording's frames with mediabunny and paints the masks; pages are served byte ranges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The device-3d template

**Files:**
- Create: `packages/motion-kit/templates/device-3d/index.html`
- Modify: `packages/motion-kit/src/index.ts`, `packages/motion-kit/test/kit.test.ts`, `apps/cli/src/commands/motion.ts`, `apps/desktop/src/renderer/editor/actions.ts`

- [ ] **Step 1: Write the failing test**

In `packages/motion-kit/test/kit.test.ts`, replace:

```ts
  });

  it('has a page for every template, and each says when it is one (a scene or an overlay)', () => {
    expect(MOTION_TEMPLATES.map((template) => template.name)).toEqual(['title', 'end-card', 'code-typing', 'lower-third', 'click-callouts', 'kinetic-captions']);
    for (const template of MOTION_TEMPLATES) {
      const file = `${TEMPLATES}${template.name}/index.html`;
      expect(existsSync(file), template.name).toBe(true);
```

with:

```ts
  });

  it('has a page for every template, and each says when it is one (a scene or an overlay)', () => {
    expect(MOTION_TEMPLATES.map((template) => template.name)).toEqual(['title', 'end-card', 'code-typing', 'device-3d', 'lower-third', 'click-callouts', 'kinetic-captions']);
    for (const template of MOTION_TEMPLATES) {
      const file = `${TEMPLATES}${template.name}/index.html`;
      expect(existsSync(file), template.name).toBe(true);
```

In the same file, replace:

```ts
      expect(html, template.name).toContain('params.sounds !== false');
      for (const name of asked) expect(names.has(name), `${template.name}: ${name}`).toBe(true);
    }
    expect(making).toEqual(['title', 'end-card', 'code-typing', 'lower-third', 'click-callouts']);
  });

  it('has a page for every music template that composes with cuttle.music and declares its params', () => {
```

with:

```ts
      expect(html, template.name).toContain('params.sounds !== false');
      for (const name of asked) expect(names.has(name), `${template.name}: ${name}`).toBe(true);
    }
    expect(making).toEqual(['title', 'end-card', 'code-typing', 'device-3d', 'lower-third', 'click-callouts']);
  });

  it('has a page for every music template that composes with cuttle.music and declares its params', () => {
```

Run: `pnpm exec vitest run --project node packages/motion-kit/test/kit.test.ts`
Expected: FAIL: there is no device-3d template.

- [ ] **Step 2: The page**

`packages/motion-kit/templates/device-3d/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Device 3D</title>
    <!-- A laptop (or a tablet) in 3D whose screen plays the take: the camera turns in as the lid opens
         and the screen comes on, drifts while the take plays, and at the end flies into the screen
         until the recording fills the frame (the clip after it takes over). Whooshes on the way in
         and into the screen (the "sounds" param). -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "device", "label": "Device", "type": "select", "default": "laptop", "options": ["laptop", "tablet"] },
        { "name": "from", "label": "Plays from (take s, empty: the first clip's start)", "type": "number", "default": null, "min": 0 },
        { "name": "speed", "label": "Speed of the take", "type": "number", "default": 1, "min": 0.25, "max": 20 },
        { "name": "push", "label": "Into the screen at the end", "type": "bool", "default": true },
        { "name": "background", "label": "Own background", "type": "bool", "default": true },
        { "name": "sounds", "label": "Sounds", "type": "bool", "default": true }
      ]
    </script>
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
      }
      body.own {
        background:
          radial-gradient(ellipse 60% 55% at 28% 22%, color-mix(in srgb, var(--cuttle-accent) 38%, transparent), transparent 70%),
          radial-gradient(ellipse 55% 50% at 78% 82%, #6b7cff40, transparent 70%),
          var(--cuttle-bg);
      }
      canvas {
        display: block;
      }
    </style>
  </head>
  <body>
    <script type="module">
      import * as THREE from 'three';
      import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
      import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
      import { at, clamp, ease, lerp } from 'cuttle';

      const { params, size, duration, take } = cuttle;
      if (params.background) document.body.classList.add('own');
      const tablet = params.device === 'tablet';

      // what the screen plays: the take from where its first clip starts (or `from`), at `speed`
      const first = take.clips[0]?.from ?? 0;
      const from = typeof params.from === 'number' ? params.from : first;
      const speed = Number(params.speed) || 1;
      const last = take.clips.length ? Math.max(...take.clips.map((clip) => clip.to)) : from + duration * speed;
      const sourceAt = (t) => clamp(from + t * speed, 0, Math.max(0, last - 0.02));
      const aspect = take.screen.width / take.screen.height || 16 / 10;
      // the frames as wide as the output shows them at most (the screen fills it at the end)
      const frameWidth = Math.round(Math.min(take.screen.width || size.width, size.width));

      // the renderer
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(size.width, size.height);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.92;
      document.body.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      const key = new THREE.DirectionalLight(0xffffff, 1.1);
      key.position.set(-3, 6, 5);
      const rim = new THREE.DirectionalLight(0x9fb4ff, 0.9);
      rim.position.set(4, 2, -5);
      scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.12));
      const camera = new THREE.PerspectiveCamera(30, size.width / size.height, 0.01, 100);

      const aluminium = new THREE.MeshStandardMaterial({ color: 0x9da3ac, metalness: 0.92, roughness: 0.36, envMapIntensity: 0.75 });
      const dark = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 0.75, envMapIntensity: 0.25 });
      const glass = new THREE.MeshStandardMaterial({ color: 0x020203, metalness: 0, roughness: 0.22, envMapIntensity: 0.12 });

      // the keyboard: rows of dark keys on the deck
      const keysCanvas = document.createElement('canvas');
      keysCanvas.width = 1024;
      keysCanvas.height = 400;
      const kg = keysCanvas.getContext('2d');
      kg.fillStyle = '#08090c';
      kg.fillRect(0, 0, 1024, 400);
      const rows = [14, 14, 13, 12, 11];
      rows.forEach((count, row) => {
        const gap = 8;
        const keyW = (1024 - 40 - gap * (count - 1)) / count;
        for (let i = 0; i < count; i++) {
          const x = 20 + i * (keyW + gap);
          const y = 18 + row * 64;
          kg.fillStyle = '#17191f';
          kg.beginPath();
          kg.roundRect(x, y, keyW, 54, 7);
          kg.fill();
          kg.fillStyle = 'rgba(255,255,255,0.05)';
          kg.fillRect(x + 3, y + 2, keyW - 6, 2);
        }
      });
      kg.fillStyle = '#17191f';
      kg.beginPath();
      kg.roundRect(300, 338, 424, 50, 7);
      kg.fill();
      const keys = new THREE.CanvasTexture(keysCanvas);
      keys.colorSpace = THREE.SRGBColorSpace;
      keys.anisotropy = renderer.capabilities.getMaxAnisotropy();

      /** A rounded rectangle in the XY plane, `w`×`h`, with UVs for a frame whose top row is v = 0 (an ImageBitmap). */
      function screenGeometry(w, h, r) {
        const shape = new THREE.Shape();
        const x = -w / 2;
        const y = -h / 2;
        shape.moveTo(x + r, y);
        shape.lineTo(x + w - r, y);
        shape.quadraticCurveTo(x + w, y, x + w, y + r);
        shape.lineTo(x + w, y + h - r);
        shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        shape.lineTo(x + r, y + h);
        shape.quadraticCurveTo(x, y + h, x, y + h - r);
        shape.lineTo(x, y + r);
        shape.quadraticCurveTo(x, y, x + r, y);
        const geometry = new THREE.ShapeGeometry(shape, 12);
        const position = geometry.attributes.position;
        const uv = geometry.attributes.uv;
        for (let i = 0; i < position.count; i++) uv.setXY(i, (position.getX(i) + w / 2) / w, (h / 2 - position.getY(i)) / h);
        return geometry;
      }

      // the screen's picture: the take's frames (or, without a recording, a calm stand-in)
      const picture = new THREE.Texture();
      picture.colorSpace = THREE.SRGBColorSpace;
      picture.flipY = false;
      picture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const screenMaterial = new THREE.MeshBasicMaterial({ map: picture, color: 0x000000, toneMapped: false });

      // the device: a model whose screen faces +z
      const device = new THREE.Group();
      scene.add(device);
      let lid;
      let screenW;
      let screenH;
      if (!tablet) {
        screenW = 2.8;
        screenH = screenW / aspect;
        const lidW = screenW + 0.2;
        const lidH = screenH + 0.24;
        const depth = 2.05;
        const base = new THREE.Mesh(new RoundedBoxGeometry(lidW, 0.09, depth, 4, 0.035), aluminium);
        base.position.y = 0.045;
        dark.map = keys;
        const deck = new THREE.Mesh(new THREE.PlaneGeometry(lidW - 0.36, depth * 0.42), dark);
        deck.rotation.x = -Math.PI / 2;
        deck.position.set(0, 0.0905, -depth * 0.12);
        const pad = new THREE.Mesh(new RoundedBoxGeometry(lidW * 0.36, 0.004, depth * 0.27, 2, 0.002), new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.6, roughness: 0.55, envMapIntensity: 0.6 }));
        pad.position.set(0, 0.091, depth * 0.27);
        device.add(base, deck, pad);
        // the lid turns about the hinge at the base's back edge
        lid = new THREE.Group();
        lid.position.set(0, 0.09, -depth / 2 + 0.03);
        const shell = new THREE.Mesh(new RoundedBoxGeometry(lidW, lidH, 0.032, 4, 0.014), aluminium);
        shell.position.set(0, lidH / 2, 0);
        const bezel = new THREE.Mesh(new RoundedBoxGeometry(lidW - 0.02, lidH - 0.02, 0.006, 2, 0.003), glass);
        bezel.position.set(0, lidH / 2, 0.0175);
        const screen = new THREE.Mesh(screenGeometry(screenW, screenH, 0.02), screenMaterial);
        screen.position.set(0, 0.13 + screenH / 2, 0.021);
        lid.add(shell, bezel, screen);
        lid.userData.screen = screen;
        device.add(lid);
        device.position.y = -0.55;
      } else {
        // a tablet held sideways, the take's shape
        screenW = 2.9;
        screenH = screenW / aspect;
        const body = new THREE.Mesh(new RoundedBoxGeometry(screenW + 0.26, screenH + 0.26, 0.11, 8, 0.12), aluminium);
        const front = new THREE.Mesh(new RoundedBoxGeometry(screenW + 0.2, screenH + 0.2, 0.004, 4, 0.1), glass);
        front.position.z = 0.056;
        const screen = new THREE.Mesh(screenGeometry(screenW, screenH, 0.08), screenMaterial);
        screen.position.z = 0.059;
        lid = new THREE.Group();
        lid.add(body, front, screen);
        lid.userData.screen = screen;
        device.add(lid);
      }
      const screenMesh = lid.userData.screen;

      // a soft shadow under it
      const shadowCanvas = document.createElement('canvas');
      shadowCanvas.width = shadowCanvas.height = 256;
      const sg = shadowCanvas.getContext('2d');
      const blot = sg.createRadialGradient(128, 128, 0, 128, 128, 128);
      blot.addColorStop(0, 'rgba(0,0,0,0.7)');
      blot.addColorStop(1, 'rgba(0,0,0,0)');
      sg.fillStyle = blot;
      sg.fillRect(0, 0, 256, 256);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.scale.set(tablet ? 4.2 : 4.6, tablet ? 1.6 : 3.2, 1);
      shadow.position.y = tablet ? -1.35 : -0.56;
      scene.add(shadow);

      // a glint that slides over the glass
      const glintCanvas = document.createElement('canvas');
      glintCanvas.width = 512;
      glintCanvas.height = 8;
      const gg = glintCanvas.getContext('2d');
      const band = gg.createLinearGradient(0, 0, 512, 0);
      band.addColorStop(0, 'rgba(255,255,255,0)');
      band.addColorStop(0.5, 'rgba(255,255,255,0.22)');
      band.addColorStop(1, 'rgba(255,255,255,0)');
      gg.fillStyle = band;
      gg.fillRect(0, 0, 512, 8);
      const glint = new THREE.Mesh(screenGeometry(screenW, screenH, 0.02), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(glintCanvas), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      glint.position.copy(screenMesh.position);
      glint.position.z += 0.001;
      glint.material.map.wrapS = THREE.ClampToEdgeWrapping;
      screenMesh.parent.add(glint);

      // without a recording: a dark editor with a few lines, in the theme's accent
      const standIn = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = Math.round(1280 / aspect);
        const g = canvas.getContext('2d');
        g.fillStyle = '#0e1016';
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.fillStyle = '#1a1d26';
        g.fillRect(0, 0, canvas.width, 40);
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--cuttle-accent').trim() || '#d97757';
        const colors = [accent, '#7ec8e3', '#c9c9d6', '#7ee0a5', '#c9c9d6'];
        for (let i = 0; i < 14; i++) {
          g.fillStyle = colors[i % colors.length];
          g.globalAlpha = 0.85;
          g.fillRect(80 + (i % 3) * 40, 90 + i * 46, 220 + ((i * 97) % 520), 16);
        }
        return createImageBitmap(canvas);
      };
      // the take's frames, or the stand-in where there is no recording to read
      let still = take.recording ? undefined : standIn();
      cuttle.ready(Promise.resolve(still));
      const pictureAt = async (t) => {
        if (still) return still;
        try {
          return await take.frame(sourceAt(t), { width: frameWidth });
        } catch (error) {
          console.warn(`the screen shows a stand-in: ${error.message}`);
          still = standIn();
          return still;
        }
      };

      // its sounds: a whoosh as it turns in, and one into the screen
      const pushFrom = Math.max(duration * 0.55, duration - 1.1);
      if (params.sounds !== false) {
        cuttle.sound('whoosh', { at: 0.45, volume: 0.6 });
        if (params.push) cuttle.sound('whoosh', { at: Math.min(duration - 0.05, pushFrom + 0.6), volume: 0.75 });
      }

      const target = new THREE.Vector3();
      const orbit = new THREE.Vector3();
      const center = new THREE.Vector3();
      const normal = new THREE.Vector3();
      const fill = new THREE.Vector3();
      const fov = THREE.MathUtils.degToRad(camera.fov);
      let shown;

      cuttle.onFrame(async (t) => {
        // the picture first: the frame waits for it
        const bitmap = await pictureAt(t);
        if (bitmap !== shown) {
          if (shown && shown !== (await still)) shown.close();
          shown = bitmap;
          picture.image = bitmap;
          picture.needsUpdate = true;
        }

        // the lid opens and the screen comes on; a tablet turns up from flat
        if (!tablet) lid.rotation.x = lerp(1.48, -0.24, at(t, 0.05, 1.3, ease.inOutExpo));
        else lid.rotation.x = lerp(-1.1, 0, at(t, 0, 1.2, ease.outExpo));
        screenMaterial.color.setScalar(at(t, 0.55, 0.6, ease.out));
        glint.material.map.offset.x = lerp(0.9, -0.9, at(t, 0.9, 1.8, ease.inOut));

        // the camera: turns in around the device, drifts, then flies into the screen
        const turn = at(t, 0, 1.6, ease.outExpo);
        // after the turn it keeps moving: round towards the front and a little closer
        const drift = at(t, 1.2, Math.max(0.1, duration - 1.2), ease.inOut);
        const yaw = lerp(-0.85, -0.32, turn) + 0.26 * drift;
        const pitch = lerp(0.55, tablet ? 0.1 : 0.24, turn) - 0.06 * drift;
        const distance = lerp(11.5, tablet ? 6.6 : 7.4, turn) - 0.7 * drift;
        device.updateMatrixWorld(true);
        screenMesh.getWorldPosition(center);
        target.set(0, tablet ? 0 : 0.25, 0).lerp(center, 0.6);
        orbit.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(distance).add(target);
        const p = params.push ? at(t, pushFrom, duration - pushFrom - 1 / cuttle.fps, ease.inOutExpo) : 0;
        if (p > 0) {
          // the screen fills the frame: straight on, as far off as covers the output
          normal.set(0, 0, 1).transformDirection(screenMesh.matrixWorld);
          const visible = Math.min(screenH, screenW / camera.aspect) * 0.995;
          fill.copy(center).addScaledVector(normal, visible / 2 / Math.tan(fov / 2));
          camera.position.copy(orbit).lerp(fill, p);
          camera.up.set(0, 1, 0).lerp(new THREE.Vector3(0, 1, 0).transformDirection(screenMesh.matrixWorld), p);
          camera.lookAt(target.lerp(center, p));
        } else {
          camera.position.copy(orbit);
          camera.up.set(0, 1, 0);
          camera.lookAt(target);
        }
        shadow.material.opacity = 1 - p;
        renderer.render(scene, camera);
      });
    </script>
  </body>
</html>
```

- [ ] **Step 3: In the list, and the kit's layout**

In `packages/motion-kit/src/index.ts`, replace:

```ts
//   motion.js            Cuttle's helpers (easing, tweens, text, code)
//   sound.js             Cuttle's sound kit for music pages (instruments, effects, harmony, the video's parts)
//   blank.html           the page a video's sounds render in when it has no music page
//   three/               Three.js (three.module.js, three.core.js) and its addons (three/addons/)
//   lottie/              lottie-web: lottie.mjs (a module) and lottie.min.js (a script)
//   fonts/               Inter, JetBrains Mono and display faces (woff2, Latin; see KIT_FONTS)
//   templates/<name>/    the pages `cuttle motion new` copies into a project
//   licenses/            the licenses of what it bundles
```

with:

```ts
//   motion.js            Cuttle's helpers (easing, tweens, text, code)
//   sound.js             Cuttle's sound kit for music pages (instruments, effects, harmony, the video's parts)
//   blank.html           the page a video's sounds render in when it has no music page
//   take-worker.js       reads the screen recording's frames for `cuttle.take.frame`, its masks painted (take.js)
//   three/               Three.js (three.module.js, three.core.js) and its addons (three/addons/)
//   lottie/              lottie-web: lottie.mjs (a module) and lottie.min.js (a script)
//   mediabunny/          mediabunny.min.mjs: reads video files for the take's frames
//   fonts/               Inter, JetBrains Mono and display faces (woff2, Latin; see KIT_FONTS)
//   templates/<name>/    the pages `cuttle motion new` copies into a project
//   licenses/            the licenses of what it bundles
```

In the same file, replace:

```ts
  { name: 'title', kind: 'scene', duration: 3.5, description: 'a kinetic title: the words rise out of a blur with a whoosh, an accent line draws under them' },
  { name: 'end-card', kind: 'scene', duration: 4, description: 'the end card: a logo or monogram that lands with a hit, a line, the URL in a pill that types itself (keys, a ding), a call to action' },
  { name: 'code-typing', kind: 'scene', duration: 6, description: 'a code editor that types a file with syntax colours, line by line, keys clattering' },
  { name: 'lower-third', kind: 'overlay', duration: 4, description: 'a name and a role in a bar that wipes in (a swoosh) and out' },
  { name: 'click-callouts', kind: 'overlay', duration: 0, whole: true, description: 'a ring, a number and a pop at every click the video shows, on the click' },
  { name: 'kinetic-captions', kind: 'overlay', duration: 0, whole: true, description: 'the spoken words, word by word, the current one in the accent colour' },
```

with:

```ts
  { name: 'title', kind: 'scene', duration: 3.5, description: 'a kinetic title: the words rise out of a blur with a whoosh, an accent line draws under them' },
  { name: 'end-card', kind: 'scene', duration: 4, description: 'the end card: a logo or monogram that lands with a hit, a line, the URL in a pill that types itself (keys, a ding), a call to action' },
  { name: 'code-typing', kind: 'scene', duration: 6, description: 'a code editor that types a file with syntax colours, line by line, keys clattering' },
  { name: 'device-3d', kind: 'scene', duration: 5, description: 'a laptop or tablet in 3D whose screen plays the take: it turns in as the lid opens, then flies into the screen' },
  { name: 'lower-third', kind: 'overlay', duration: 4, description: 'a name and a role in a bar that wipes in (a swoosh) and out' },
  { name: 'click-callouts', kind: 'overlay', duration: 0, whole: true, description: 'a ring, a number and a pop at every click the video shows, on the click' },
  { name: 'kinetic-captions', kind: 'overlay', duration: 0, whole: true, description: 'the spoken words, word by word, the current one in the accent colour' },
```

- [ ] **Step 4: "Device 3D"**

In `apps/cli/src/commands/motion.ts`, replace:

```ts

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** "end-card" as a label: "End card". */
const labelOf = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-/g, ' ')}`;

/** `cuttle motion templates`: the templates `motion new` copies. */
export async function motionTemplatesCommand(output: Output): Promise<{ templates: readonly MotionTemplate[] }> {
```

with:

```ts

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** "end-card" as a label: "End card" (and "device-3d": "Device 3D"). */
const labelOf = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-/g, ' ')}`.replace(/ 3d\b/, ' 3D');

/** `cuttle motion templates`: the templates `motion new` copies. */
export async function motionTemplatesCommand(output: Output): Promise<{ templates: readonly MotionTemplate[] }> {
```

In `apps/desktop/src/renderer/editor/actions.ts`, replace:

```ts
}

/** "lower-third" (or "lower-third-2", a second copy) as a label: "Lower third". */
export const templateLabel = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-\d+$/, '').replace(/-/g, ' ')}`;

/**
 * A motion template of the kit: its page is copied into the project's `motion/` folder, and it goes
```

with:

```ts
}

/** "lower-third" (or "lower-third-2", a second copy) as a label: "Lower third". */
export const templateLabel = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-\d+$/, '').replace(/-/g, ' ')}`.replace(/ 3d\b/, ' 3D');

/**
 * A motion template of the kit: its page is copied into the project's `motion/` folder, and it goes
```

- [ ] **Step 5: Run the test**

Run: `pnpm exec vitest run --project node packages/motion-kit/test/kit.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/motion-kit/templates/device-3d packages/motion-kit/src/index.ts packages/motion-kit/test/kit.test.ts apps/cli/src/commands/motion.ts apps/desktop/src/renderer/editor/actions.ts
git commit -m "kit: the device-3d template: a laptop whose screen plays the take, turning in, then flying into the screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The checks

**Files:**
- Modify: `apps/cli/test/electron.check.test.ts`, `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The CLI's check**

A page draws the take's frame at 1.5 s: it is that frame (closer to `cuttle frame 1.5` than to the next one); with a fill and a blur mask, the fill is one colour and the blur has no edges left; the device template checks without errors and ends on the take:

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

  it('hands pages frames of the take, its masks painted over them, and shows the take on a device in 3D', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-frames-')), 'frames');
    cpSync(project, dir, { recursive: true });
    try {
      // a page that draws the take's frame at 1.5 s, at its own size, in the corner
      mkdirSync(join(dir, 'motion', 'exact'), { recursive: true });
      writeFileSync(
        join(dir, 'motion', 'exact', 'index.html'),
        `<!doctype html><body style="margin:0"><canvas id="c" width="1280" height="720"></canvas><script>
        const g = document.getElementById('c').getContext('2d');
        cuttle.onFrame(async () => { const frame = await cuttle.take.frame(1.5); g.drawImage(frame, 0, 0); frame.close(); });
        </script></body>`,
      );
      const read = (file: string) => PNG.sync.read(readFileSync(file));
      const drawn = () => {
        const checked = cuttle('-C', dir, 'motion', 'check', 'motion/exact/index.html', '--at', '0.1', '-o', join(dir, 'drawn'));
        expect(checked.json.errors).toEqual([]);
        return read((checked.json.stills as { file: string }[])[0]!.file);
      };
      const raw = read(cuttle('-C', dir, 'frame', '1.5', '-o', join(dir, 'raw.png')).json.file as string);
      const next = read(cuttle('-C', dir, 'frame', '1.55', '-o', join(dir, 'next.png')).json.file as string);
      const meanDifference = (a: PNG, b: PNG) => {
        let sum = 0;
        for (let y = 0; y < 720; y++) for (let x = 0; x < 1280; x++) for (let c = 0; c < 3; c++) sum += Math.abs(a.data[(y * a.width + x) * 4 + c]! - b.data[(y * b.width + x) * 4 + c]!);
        return sum / (1280 * 720 * 3);
      };
      // the frame asked for, not its neighbour (WebCodecs and ffmpeg turn YUV into RGB a little differently)
      const page = drawn();
      expect(meanDifference(page, raw)).toBeLessThan(3);
      expect(meanDifference(page, next)).toBeGreaterThan(meanDifference(page, raw));

      // the project's masks are on the frames: a fill is one colour, a blur has no edges left
      const file = join(dir, 'cuttle.json');
      const raw0 = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      writeFileSync(file, JSON.stringify({ ...raw0, masks: [{ from: 1, to: 2, rect: [100, 100, 300, 200] }, { from: 1, to: 2, rect: [600, 300, 400, 250], style: 'blur' }] }));
      const masked = drawn();
      const at = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
      const fill = at(masked, 100, 100);
      for (let y = 100; y < 300; y += 7) for (let x = 100; x < 400; x += 7) expect(at(masked, x, y)).toEqual(fill);
      const steepest = (png: PNG) => {
        let most = 0;
        for (let y = 305; y < 545; y += 5) for (let x = 605; x < 995; x++) most = Math.max(most, ...[0, 1, 2].map((c) => Math.abs(png.data[(y * png.width + x) * 4 + c]! - png.data[(y * png.width + x + 1) * 4 + c]!)));
        return most;
      };
      expect(steepest(raw)).toBeGreaterThan(150);
      expect(steepest(masked)).toBeLessThan(40);

      // the device template plays the take on its screen and flies into it: no errors, and it moves
      expect(cuttle('-C', dir, 'motion', 'new', 'device-3d', '--first').code).toBe(0);
      const device = cuttle('-C', dir, 'motion', 'check', 'motion/device-3d/index.html', '-o', join(dir, 'device'));
      expect(device.json.errors).toEqual([]);
      const stills = (device.json.stills as { file: string }[]).map((still) => read(still.file));
      const meanOf = (png: PNG) => png.data.reduce((sum, value, i) => (i % 4 === 3 ? sum : sum + value), 0) / (png.width * png.height * 3);
      // the take fills the last frame: far brighter than the dark scene the device turns in on
      expect(meanOf(stills.at(-1)!)).toBeGreaterThan(meanOf(stills[0]!) + 40);
    } finally {
      rmSync(dirname(dir), { recursive: true, force: true });
    }
  }, 180_000);

  it('blurs fast motion: the moments while the shutter is open, averaged', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-blur-')), 'blur');
    try {
```

Run: `pnpm cli:check`
Expected: PASS, 13 tests.

- [ ] **Step 2: The editor's check**

"+ Motion" → Device 3D after the clip: ready, without errors, and the editor draws it as `cuttle preview` does:

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    await expect.poll(async () => (await page.locator('[data-testid=motion-errors]').textContent().catch(() => '')) ?? '', { timeout: 20_000 }).toContain('ReferenceError');
    expect(await page.locator('[data-testid=motion-state]').textContent()).toContain('threw an error');
    await shotOf('39-motion-errors', '/editor.html', 'motion-editor · Cuttle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion-editor · Cuttle')?.close());
  }, 240_000);
```

with:

```ts
    await expect.poll(async () => (await page.locator('[data-testid=motion-errors]').textContent().catch(() => '')) ?? '', { timeout: 20_000 }).toContain('ReferenceError');
    expect(await page.locator('[data-testid=motion-state]').textContent()).toContain('threw an error');
    await shotOf('39-motion-errors', '/editor.html', 'motion-editor · Cuttle');

    // + Motion → Device 3D after the clip: the take plays on its screen, drawn as the export draws it
    await chooseIn(page, '[data-testid=add-motion]', 'Device 3D');
    await expect.poll(() => saved().scenes.map((scene) => scene.src ?? scene.type)).toEqual(['motion/intro/index.html', 'motion/title/index.html', 'clip', 'motion/device-3d/index.html']);
    await expect.poll(async () => (await now()).motion.status.find((status) => status.src === 'motion/device-3d/index.html')?.state, { timeout: 60_000 }).toBe('ready');
    const deviceAt = 12;
    await flushPage();
    const deviceStill = spawnSync('node', [CLI, '--json', '-C', dir, 'preview', '--at', String(deviceAt), '-o', join(root, 'device-stills')], { encoding: 'utf8', timeout: 120_000 });
    expect(deviceStill.status, deviceStill.stderr).toBe(0);
    await seekTo(deviceAt);
    const shown = difference(await view(), PNG.sync.read(readFileSync((JSON.parse(deviceStill.stdout) as { stills: { file: string }[] }).stills[0]!.file)));
    expect(shown.mean, 'the device: mean difference').toBeLessThan(1.5);
    expect((await now()).motion.status.find((status) => status.src === 'motion/device-3d/index.html')?.errors).toEqual([]);
    await shotOf('39b-device-3d', '/editor.html', 'motion-editor · Cuttle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion-editor · Cuttle')?.close());
  }, 240_000);
```

Run: `pnpm app:check`
Expected: PASS, 50 tests.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/test/electron.check.test.ts apps/desktop/test/app.check.test.ts
git commit -m "check frames of the take in a page (the frame asked for, its masks) and the device template, in the CLI and the editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The guide

**Files:**
- Modify: `skill/cuttle/motion.md`

- [ ] **Step 1: `take.frame`, async draws, the template**

In `skill/cuttle/motion.md`, replace:

```markdown

1. Write the page in the project: `motion/<name>/index.html`, with its scripts, images and data next
   to it (or shared, `motion/shared.js`, imported as `../shared.js`). Or start from a template:
   `cuttle -C "<project>" --json motion new <template>` (title, end-card, code-typing, lower-third,
   click-callouts, kinetic-captions; `cuttle --json motion templates` says what each shows); it
   copies the page and adds it to cuttle.json. Then change the copy as much as you like. Most
   templates make their sounds (a whoosh with the title, a pop on each callout, keys while code
   types); their `sounds` param switches them off.
```

with:

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

In the same file, replace:

```markdown
  drawn, from 0 at the item's start. `Math.random` is seeded per item: every render is the same.
- **Draw from time.** `cuttle.onFrame((t) => …)` runs before each frame (also after a jump). A page
  that sets everything from `t` there is right on every frame; free-running CSS animations work too,
  but keyframes you compute are easier to time. `import { at, ease, keys, stagger, split, typed,
  highlight, spring, random } from 'cuttle'` gives you easing, keyframes, staggering, text splitting,
  typing with a rhythm, syntax colours and springs, all as functions of time.
- **`window.cuttle`:** `time` and `duration` (the item's seconds), `videoTime` (the video's),
```

with:

```markdown
  drawn, from 0 at the item's start. `Math.random` is seeded per item: every render is the same.
- **Draw from time.** `cuttle.onFrame((t) => …)` runs before each frame (also after a jump). A page
  that sets everything from `t` there is right on every frame; free-running CSS animations work too,
  but keyframes you compute are easier to time. A draw may be `async` (it awaits a frame of the take):
  the frame waits for it. `import { at, ease, keys, stagger, split, typed,
  highlight, spring, random } from 'cuttle'` gives you easing, keyframes, staggering, text splitting,
  typing with a rhythm, syntax colours and springs, all as functions of time.
- **`window.cuttle`:** `time` and `duration` (the item's seconds), `videoTime` (the video's),
```

In the same file, replace:

```markdown
- The theme as CSS variables: `--cuttle-accent`, `--cuttle-bg`, `--cuttle-fg`, `--cuttle-font`,
  `--cuttle-mono`. Use them to match the project's look, or set your own palette.

## The take (overlays over a recording)

`cuttle.take` holds the recording in source seconds and source pixels: `events` (`click` with `x`,
`y`, `button`; `keys` counts; `scroll`; `move`), `clicks`, `words` (the transcript), `markers`
```

with:

```markdown
- The theme as CSS variables: `--cuttle-accent`, `--cuttle-bg`, `--cuttle-fg`, `--cuttle-font`,
  `--cuttle-mono`. Use them to match the project's look, or set your own palette.

## The take (what was recorded)

`cuttle.take` holds the recording in source seconds and source pixels: `events` (`click` with `x`,
`y`, `button`; `keys` counts; `scroll`; `move`), `clicks`, `words` (the transcript), `markers`
```

In the same file, replace:

````markdown
- `take.toScreen(x, y)` is where a point of the recording is in this frame, with the window frame,
  the crop and the zoom (`{ x, y, inside }`, null in a scene); `take.cursor` is the pointer there.
- `take.cursorAt(source)` is the pointer's path at any moment.

```js
// a ring at each click, on the click, as the video plays it
````

with:

````markdown
- `take.toScreen(x, y)` is where a point of the recording is in this frame, with the window frame,
  the crop and the zoom (`{ x, y, inside }`, null in a scene); `take.cursor` is the pointer there.
- `take.cursorAt(source)` is the pointer's path at any moment.
- `await take.frame(source, { width })` is the screen recording's frame at a source second, as an
  `ImageBitmap`, with the project's privacy masks painted over it: for a screen in 3D, a freeze, a
  lens, a wall of moments. Make the draw `async` and await it in `onFrame` (the frame waits for it);
  draw it (`drawImage`, a Three.js texture with `flipY = false`), then `close()` it. Frames read
  forward fastest; `width` (at most the recording's) keeps them light. The device-3d template plays
  the take on a laptop's screen this way, then flies into it.

```js
// a moment of the take, frozen and tilted in a scene of its own
cuttle.onFrame(async (t) => {
  const frame = await cuttle.take.frame(cuttle.take.clips[0].from + 2, { width: 1280 });
  g.clearRect(0, 0, w, h);
  g.setTransform(0.6, -0.08, 0.08, 0.6, w * 0.2, h * 0.25);
  g.drawImage(frame, 0, 0);
  frame.close();
});
```

```js
// a ring at each click, on the click, as the video plays it
````

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 2: Commit**

```bash
git add skill/cuttle/motion.md
git commit -m "skill: frames of the take in motion pages, async draws, the device-3d template

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 845 passed and 69 skipped (where a speech model is found, its real transcription runs too: 846 and 68; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 13 tests.

Run: `pnpm app:check`
Expected: PASS, 50 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. In a project with a recording, "+ Motion" → Device 3D: the laptop opens, its screen plays the take, and the camera flies into it at the end.
2. Draw a privacy mask over something on the screen: the device's screen hides it too.
3. Ask Claude for a page that freezes a moment of the take and tilts it in.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **A worker of the kit's origin was refused:** a page (`cuttle-motion://project`) may start only workers of its own origin; a blob of the page's origin imports the kit's script.
- **The marker could run ahead of the picture:** it was set before the draws; with a draw that awaits a frame, a paint in between would have shown the new number with the old picture. It is set once everything is drawn.
- **The first device looked plastic:** white, overexposed aluminium, a grey deck, a silver bezel and a camera that stood still. Darker metal, less exposure and a rim light, a keyboard, a black bezel, a thinner lid and a drift round to the front.
- **A video without a recording:** `cuttle init` names a screen file that is not there; the device shows its stand-in screen and says why in its console.
- **"phone" became "tablet":** a phone held sideways with a 16:9 recording looks like a tablet; the option says what it shows.

**Flaky, and not this milestone's**
- **Recordings that did not start in time** (seen on `main` too, see P5-M1g): two runs of `app:check` lost the test that reads the screen after a take (the HUD showed no running take within 30 s); the third passed all 50. One run of `pnpm test` had the recorder's test take short; the next two passed. Nothing here touches the recorder or the HUD.

**Spec points that move**
- **Transitions** (`cuttle.from`, `cuttle.to`, `cuttle.progress`), the **fold** template and transitions on the timeline: **P5-M1h**.

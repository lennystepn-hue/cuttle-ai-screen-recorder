# Cuttle P5-M1b: The Take in Pages, the Motion Kit, and Videos Without a Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude makes motion like a motion designer, free in what it makes:
- motion pages know the take (clicks, words, markers, zooms) and where a point of the recording is in each frame;
- they have a kit offline (Three.js, lottie-web, display fonts, Cuttle's helpers);
- fast motion gets motion blur;
- a video can be made of motion scenes alone, without a recording;
- `cuttle motion new` starts from six templates, and a guide shows Claude how.

**Architecture:**
- **Engine:** `clipView` is the view the renderer draws a clip with (window, crop, zoom), as a pure function.
- **Timeline and plan:** each showing of an overlay knows where it starts.
- **Kit** (`packages/motion-kit`):
  - Cuttle's helpers (`kit/motion.js`), the six templates, and their manifest;
  - a build step that copies the kit with Three.js, lottie-web and the fonts next to each bundle;
  - an import map that the motion protocol puts first in each page of the project.
- **The page** gets:
  - `cuttle.take`, built in the main process from the take's files (`takeData`);
  - before each frame of an overlay, the frame's view (`__cuttleDraw(ms, view)`);
  - the kit's fonts as `@font-face`;
  - the defaults of the params it declares.
- **The export page** asks for each frame with its view, and for the next frame while one is drawn. A project without clips needs no screen recording.
- **The main process** averages the moments of a frame for motion blur.
- **CLI:**
  - `motion new` and `motion templates`;
  - `motion check` of an overlay renders it over the video.
- **App:** its build copies the kit.

**Tech Stack:** TypeScript strict, zod 4, vitest 5, Electron 44.7.2 (offscreen rendering, custom protocols), WebGL2, Three.js 0.186.1, lottie-web 5.13.0, Fontsource (Inter, JetBrains Mono, Archivo, Space Grotesk, Bebas Neue, Fraunces, Instrument Serif; OFL).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase5-motion-design.md`. Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p5-m1a-motion-pages.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m1b`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 9.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The prototype passed `pnpm test` (778 tests, 65 skipped), the typecheck, `app:check` (48 tests) and `cli:check` (11). Every screenshot was looked at.

- **The take in a page** (`cuttle.take`):
  - `events`: clicks, key counts, scrolls, and moves at most 30 a second.
  - `clicks`, `words` (with the project's caption fixes), `markers`, the zooms that are on, `masks`, `screen`, and an overlay's `window`.
  - `toOutput(source)`, `toSource(output)`.
  - `cursorAt(source)`: the pointer as the video draws it, sampled 30 times a second.
  - With the frame's view (an overlay's): `toScreen(x, y)` gives a point of the recording in output pixels, with the window frame, the crop and the zoom (`{ x, y, inside }`). `source` and `cursor` are there too.
  - `cuttle.videoTime` is the video's second; a showing knows its `start`.
- **The view comes from the export page**, which knows the layer it draws: `clipView` (the renderer's own layout) and the layer's zoom and cursor.
  - So the export page now asks for the next frame of each item (with its view) while one is drawn; the main process no longer draws ahead on its own.
  - A video asks ahead; stills, whose frames jump, do not.
- **The kit:**
  - served at `cuttle-motion://kit/`;
  - an import map for `three`, `three/addons/`, `cuttle` and `lottie-web`, put first in every HTML page the protocol serves from the project;
  - copied by each build (`scripts/copy.mjs`) next to the bundle (`apps/cli/dist/motion-kit`, `apps/desktop/dist/main/motion-kit`, `packages/export/dist/motion-kit`);
  - 14 MB, with every licence.
- **Fonts:** Inter and JetBrains Mono, plus display faces:
  - Archivo (variable: weight, and width from 62% to 125%, animatable with `font-stretch`);
  - Space Grotesk;
  - Bebas Neue;
  - Fraunces;
  - Instrument Serif (upright and italic).
  The runtime declares them before the page is parsed.
- **Cuttle's helpers** (`import … from 'cuttle'`), all pure functions of time:
  - easing (CSS curves, expo, back, elastic), `spring`, `at`, `inOut`, `keys` (numbers, lists, colours), `stagger`;
  - `random` (seeded), `split` (words or characters);
  - `typed` and `typedUntil` (a person's rhythm), `highlight` (ten languages), `mix`, `alpha`, `fit`.
- **Params a page declares** (`<script type="application/json" id="cuttle-params">`): their defaults go under the item's own values. A declaration that is wrong is reported as the page's error.
- **Motion blur** (`motionBlur: { samples: 2–32 (8), shutter: 0–1 (0.5) }` on a scene or overlay):
  - each frame is the average of the page drawn at `samples` moments, centred on the frame, never before 0;
  - one frame's last moment comes before the next frame's first, so the clock only goes forward;
  - it costs `samples` paints a frame.
- **A video without a recording:** a project without clips opens no screen recording (the output's size stands in for the screen's), no webcam, mic or events. `cuttle init` and motion scenes are a whole video.
- **The templates**, each driven from `cuttle.onFrame`, sized from the short side so every format works, with declared params:
  - title, end-card, code-typing (scenes);
  - lower-third, click-callouts, kinetic-captions (overlays; the last two over the whole take).
- **`cuttle motion new <template>`:**
  - copies a template into `motion/<name>/` (a free name: `title-2`) and adds it: a scene at the end (`--first`: at the start);
  - or an overlay at the first clip's start, or over the whole take for those that follow it, or at `--at`;
  - `motion templates` lists them.
- **`motion check` of an overlay** renders the project's video with that overlay alone, over the stretch where the video first shows it.
- **The guide** (`skill/cuttle/motion.md`) says Claude is free in what it makes, and how to make it look designed.

## File structure

| File | Responsibility |
|---|---|
| `packages/engine/src/{view,renderer,index}.ts` | the clip's view, shared with the renderer |
| `packages/timeline/src/frame.ts`, `packages/export/src/frame-plan.ts` | a showing's start |
| `packages/motion-kit/**`, `package.json`, `tsconfig.node.json` | the kit, the templates, the kit's build |
| `packages/export/src/motion/{runtime,take,params,init}.ts` | the page's take, view, fonts and params |
| `packages/project/src/schema.ts`, `packages/export/src/{job.ts,main/*,page/*}`, `packages/export/package.json` | motion blur, the view in the requests, videos without a recording |
| `apps/cli/**` | `motion new`, `motion templates`, the overlay check |
| `apps/desktop/scripts/build.mjs`, `apps/desktop/test/fixture.ts` | the app's kit |
| `skill/**` | the guide |

---

### Task 1: The clip's view

**Files:**
- Create: `packages/engine/src/view.ts`
- Modify: `packages/engine/src/{renderer,index}.ts`, `packages/engine/test/layout.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m1b`; work there:

```bash
git switch p5-m1b
```

- [ ] **Step 2: Write the failing test**

In `packages/engine/test/layout.test.ts`, replace:

```ts
  webcamRect,
  windowLayout,
} from '../src/layout';

const HD = { width: 1920, height: 1080 };
```

with:

```ts
  webcamRect,
  windowLayout,
} from '../src/layout';
import { clipView } from '../src/view';

const HD = { width: 1920, height: 1080 };
```

In the same file, replace:

```ts
    expect(y + h / 2).toBeCloseTo(400);
  });
});
```

with:

```ts
    expect(y + h / 2).toBeCloseTo(400);
  });
});

describe('clipView', () => {
  const output = { width: 1920, height: 1080 };
  const screen = { width: 2560, height: 1440 };
  const look = (enabled: boolean) => ({ frame: { enabled, style: 'mac-dark' as const, title: '', radius: 14, shadow: true } });

  it('is the whole screen over the whole output without a frame, and the window content with one', () => {
    expect(clipView(output, look(false), {}, screen)).toEqual({ zoom: [0, 0, 2560, 1440], content: [0, 0, 1920, 1080] });
    const framed = clipView(output, look(true), {}, screen);
    expect(framed.content).toEqual(windowLayout(output, 2560 / 1440, { titleBar: 36, radius: 14 }).content);
  });

  it('takes the layer’s zoom and a crop’s shape', () => {
    const view = clipView(output, look(false), { zoom: [100, 100, 1280, 720], aspect: 4 / 3 }, screen);
    expect(view.zoom).toEqual([100, 100, 1280, 720]);
    expect(view.content).toEqual([240, 0, 1440, 1080]);
  });
});
```

Run: `pnpm exec vitest run --project node packages/engine/test/layout.test.ts`
Expected: FAIL: `../src/view` does not exist.

- [ ] **Step 3: The view, and the renderer on it**

`packages/engine/src/view.ts`:

```ts
import type { FrameStyle, Look, Rect } from '@cuttle/project';
import { windowLayout, type Size, type WindowLayout } from './layout';
import { FRAME_CHROME, type FrameChrome } from './presets/frames';

/** The window for a frame style (none: the content fills the output); `aspect` is the content's. */
export function frameLayout(output: Size, look: Pick<Look, 'frame'>, style: FrameStyle | null, aspect: number): { chrome: FrameChrome | null; layout: WindowLayout } {
  const chrome = style ? FRAME_CHROME[style] : null;
  return { chrome, layout: windowLayout(output, aspect, chrome ? { titleBar: chrome.titleBar, radius: look.frame.radius } : null) };
}

/** Where a clip shows the screen in a frame: the part of the screen recording and the rect of the output it fills. */
export interface ClipView {
  /** The part of the screen recording shown, in source px (the zoom, else the crop, else all of it). */
  zoom: Rect;
  /** Where it is drawn, in output px (inside the window frame). */
  content: Rect;
}

/** A clip layer's view, as the renderer draws it. `layer` is the timeline's `SceneFrame`. */
export function clipView(output: Size, look: Pick<Look, 'frame'>, layer: { zoom?: Rect; aspect?: number }, screen: Size): ClipView {
  const aspect = layer.aspect ?? screen.width / screen.height;
  const { layout } = frameLayout(output, look, look.frame.enabled ? look.frame.style : null, aspect);
  return { zoom: layer.zoom ?? [0, 0, screen.width, screen.height], content: layout.content };
}
```

In `packages/engine/src/renderer.ts`, replace:

```ts
import { CAPTION_LOOKS, drawCaption } from './captions';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, sourceSize, uploadPixels, uploadTexture } from './gl/texture';
import { placeBadge, placeOverlay, stillCrop, unitFor, uvRect, webcamRect, windowLayout, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
import { CursorPass } from './passes/cursor';
```

with:

```ts
import { CAPTION_LOOKS, drawCaption } from './captions';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, sourceSize, uploadPixels, uploadTexture } from './gl/texture';
import { placeBadge, placeOverlay, stillCrop, unitFor, uvRect, webcamRect, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
import { CursorPass } from './passes/cursor';
```

In the same file, replace:

```ts
import { SpritePass } from './passes/sprite';
import { WebcamPass } from './passes/webcam';
import { WindowPass } from './passes/window';
import { FRAME_CHROME, type FrameChrome } from './presets/frames';
import { BADGE_STYLE, CARD_SUBTITLE_STYLE, CARD_TITLE_STYLE, TEXT_LABELS } from './presets/labels';
import { SpriteCache } from './sprites';

/** A motion page's frame: premultiplied RGBA, top row first (drawn over the whole output). */
export interface MotionPixels {
```

with:

```ts
import { SpritePass } from './passes/sprite';
import { WebcamPass } from './passes/webcam';
import { WindowPass } from './passes/window';
import type { FrameChrome } from './presets/frames';
import { BADGE_STYLE, CARD_SUBTITLE_STYLE, CARD_TITLE_STYLE, TEXT_LABELS } from './presets/labels';
import { SpriteCache } from './sprites';
import { frameLayout } from './view';

/** A motion page's frame: premultiplied RGBA, top row first (drawn over the whole output). */
export interface MotionPixels {
```

In the same file, replace:

```ts

  /** The window for a frame style; `aspect` is the content's (a clip's crop, else the screen's). */
  function frame(style: FrameStyle | null, aspect = screenAspect): { chrome: FrameChrome | null; layout: WindowLayout } {
    const chrome = style ? FRAME_CHROME[style] : null;
    return { chrome, layout: windowLayout(output, aspect, chrome ? { titleBar: chrome.titleBar, radius: look.frame.radius } : null) };
  }

  /** `avoid`: rects the texts move clear of (the webcam bubble, the badge). */
```

with:

```ts

  /** The window for a frame style; `aspect` is the content's (a clip's crop, else the screen's). */
  function frame(style: FrameStyle | null, aspect = screenAspect): { chrome: FrameChrome | null; layout: WindowLayout } {
    return frameLayout(output, look, style, aspect);
  }

  /** `avoid`: rects the texts move clear of (the webcam bubble, the badge). */
```

In `packages/engine/src/index.ts`, replace:

```ts
export { FONT_FAMILY, loadEngineAssets, type EngineAssets } from './assets';
export { createRenderer, type DrawnText, type FrameSources, type MotionPixels, type Renderer, type RendererOptions } from './renderer';
export { webcamRect, type Size } from './layout';
export type { CursorImage } from './presets/cursors';
```

with:

```ts
export { FONT_FAMILY, loadEngineAssets, type EngineAssets } from './assets';
export { createRenderer, type DrawnText, type FrameSources, type MotionPixels, type Renderer, type RendererOptions } from './renderer';
export { webcamRect, type Size } from './layout';
export { clipView, type ClipView } from './view';
export type { CursorImage } from './presets/cursors';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/engine` and `pnpm exec vitest run --project browser packages/engine/test/renderer.browser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "engine: the view a clip is drawn with, as a pure function the renderer shares

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A showing's start

**Files:**
- Modify: `packages/timeline/src/frame.ts`, `packages/timeline/test/frame.test.ts`, `packages/export/src/frame-plan.ts`, `packages/export/test/frame-plan.test.ts`, `packages/engine/test/renderer.browser.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/timeline/test/frame.test.ts`, replace:

```ts
    // source 18 to 24: 18–20 at 1× (output 9–11), then 20–24 at 4× (output 11–12)
    const timeline = motion({ overlays: [{ src: 'motion/callouts/index.html', at: 18, duration: 6 }] });
    expect(timeline.frameAt(8.5).layers[0]!.overlays).toEqual([]);
    expect(timeline.frameAt(10).layers[0]!.overlays).toEqual([{ index: 0, key: '0@9', local: 1, duration: 3 }]);
    expect(timeline.frameAt(11.5).layers[0]).toMatchObject({ sceneIndex: 2, overlays: [{ index: 0, key: '0@9', local: 2.5, duration: 3 }] });
    expect(timeline.frameAt(12.25).layers[0]!.overlays).toEqual([]);
  });
```

with:

```ts
    // source 18 to 24: 18–20 at 1× (output 9–11), then 20–24 at 4× (output 11–12)
    const timeline = motion({ overlays: [{ src: 'motion/callouts/index.html', at: 18, duration: 6 }] });
    expect(timeline.frameAt(8.5).layers[0]!.overlays).toEqual([]);
    expect(timeline.frameAt(10).layers[0]!.overlays).toEqual([{ index: 0, key: '0@9', start: 9, local: 1, duration: 3 }]);
    expect(timeline.frameAt(11.5).layers[0]).toMatchObject({ sceneIndex: 2, overlays: [{ index: 0, key: '0@9', start: 9, local: 2.5, duration: 3 }] });
    expect(timeline.frameAt(12.25).layers[0]!.overlays).toEqual([]);
  });
```

In the same file, replace:

```ts
      ],
      overlays: [{ src: 'a.html', at: 16, duration: 2 }],
    });
    expect(twice.frameAt(7).layers[0]!.overlays).toEqual([{ index: 0, key: '0@6', local: 1, duration: 2 }]);
    expect(twice.frameAt(12).layers[0]!.overlays).toEqual([{ index: 0, key: '0@11', local: 1, duration: 2 }]);
    const off = motion({ overlays: [{ src: 'a.html', at: 12, duration: 2, enabled: false }] });
    expect(off.frameAt(3).layers[0]!.overlays).toEqual([]);
  });
```

with:

```ts
      ],
      overlays: [{ src: 'a.html', at: 16, duration: 2 }],
    });
    expect(twice.frameAt(7).layers[0]!.overlays).toEqual([{ index: 0, key: '0@6', start: 6, local: 1, duration: 2 }]);
    expect(twice.frameAt(12).layers[0]!.overlays).toEqual([{ index: 0, key: '0@11', start: 11, local: 1, duration: 2 }]);
    const off = motion({ overlays: [{ src: 'a.html', at: 12, duration: 2, enabled: false }] });
    expect(off.frameAt(3).layers[0]!.overlays).toEqual([]);
  });
```

In `packages/export/test/frame-plan.test.ts`, replace:

```ts
      { index: 1, kind: 'clip', firstFrame: 10, lastFrame: 49, times: 40 },
    ]);
    // source 1–3 shows at output 2–4: frames 20 to 39
    expect(result.overlays).toEqual([{ key: '0@2', index: 0, duration: 2, firstFrame: 20, lastFrame: 39 }]);
  });
});
```

with:

```ts
      { index: 1, kind: 'clip', firstFrame: 10, lastFrame: 49, times: 40 },
    ]);
    // source 1–3 shows at output 2–4: frames 20 to 39
    expect(result.overlays).toEqual([{ key: '0@2', index: 0, start: 2, duration: 2, firstFrame: 20, lastFrame: 39 }]);
  });
});
```

In `packages/engine/test/renderer.browser.test.ts`, replace:

```ts
    const project = parse({ look: { ...solid, frame: { enabled: false } }, scenes: [{ type: 'clip', from: 0, to: 1 }], overlays: [{ src: 'o.html', at: 0, duration: 1 }] });
    const sources = { ...NO_SOURCES, screens: new Map([[0, fakeScreen()]]), overlays: new Map([['0@0', motionFrame([0, 0, 0, 0], [0, 255, 0, 255])]]) };
    const plain = render(project, { t: 0, layers: [layer(0, 1, 'clip')] }, sources).pixels;
    const shown = render(project, { t: 0, layers: [{ ...layer(0, 1, 'clip'), overlays: [{ index: 0, key: '0@0', local: 0, duration: 1 }] }] }, sources).pixels;
    expect(pixelAt(shown, 32, 30)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(shown, 1, 30)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(shown, 32, 5)).toEqual(pixelAt(plain, 32, 5));
```

with:

```ts
    const project = parse({ look: { ...solid, frame: { enabled: false } }, scenes: [{ type: 'clip', from: 0, to: 1 }], overlays: [{ src: 'o.html', at: 0, duration: 1 }] });
    const sources = { ...NO_SOURCES, screens: new Map([[0, fakeScreen()]]), overlays: new Map([['0@0', motionFrame([0, 0, 0, 0], [0, 255, 0, 255])]]) };
    const plain = render(project, { t: 0, layers: [layer(0, 1, 'clip')] }, sources).pixels;
    const shown = render(project, { t: 0, layers: [{ ...layer(0, 1, 'clip'), overlays: [{ index: 0, key: '0@0', start: 0, local: 0, duration: 1 }] }] }, sources).pixels;
    expect(pixelAt(shown, 32, 30)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(shown, 1, 30)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(shown, 32, 5)).toEqual(pixelAt(plain, 32, 5));
```

Run: `pnpm exec vitest run --project node packages/timeline/test/frame.test.ts packages/export/test/frame-plan.test.ts`
Expected: FAIL: the overlays have no `start`.

- [ ] **Step 2: The start**

In `packages/timeline/src/frame.ts`, replace:

```ts
  index: number;
  /** One showing of it (a clip shown twice shows it twice): the overlay and where its stretch starts. */
  key: string;
  /** Output seconds into this showing, and how long it lasts (its source stretch on the output timeline). */
  local: number;
  duration: number;
}
```

with:

```ts
  index: number;
  /** One showing of it (a clip shown twice shows it twice): the overlay and where its stretch starts. */
  key: string;
  /** Where this showing starts (output seconds), how far into it the frame is, and how long it lasts. */
  start: number;
  local: number;
  duration: number;
}
```

In the same file, replace:

```ts
      overlays: project.overlays.flatMap((overlay, index) => {
        const occurrence = overlay.enabled ? overlayShown[index]?.[span.index] : undefined;
        if (!occurrence || shownAt < occurrence.start - 1e-9 || shownAt >= occurrence.end - 1e-9) return [];
        return [{ index, key: `${index}@${round(occurrence.start)}`, local: round(shownAt - occurrence.start), duration: round(occurrence.end - occurrence.start) }];
      }),
      badge: badgeFor(scene),
      cursor,
```

with:

```ts
      overlays: project.overlays.flatMap((overlay, index) => {
        const occurrence = overlay.enabled ? overlayShown[index]?.[span.index] : undefined;
        if (!occurrence || shownAt < occurrence.start - 1e-9 || shownAt >= occurrence.end - 1e-9) return [];
        const start = round(occurrence.start);
        return [{ index, key: `${index}@${start}`, start, local: round(shownAt - occurrence.start), duration: round(occurrence.end - occurrence.start) }];
      }),
      badge: badgeFor(scene),
      cursor,
```

In `packages/export/src/frame-plan.ts`, replace:

```ts
  key: string;
  /** Its place in the project's `overlays`. */
  index: number;
  /** How long the showing lasts, in output seconds. */
  duration: number;
  firstFrame: number;
  lastFrame: number;
```

with:

```ts
  key: string;
  /** Its place in the project's `overlays`. */
  index: number;
  /** Where the showing starts and how long it lasts, in output seconds. */
  start: number;
  duration: number;
  firstFrame: number;
  lastFrame: number;
```

In the same file, replace:

```ts
      for (const overlay of layer.overlays) {
        const seen = byKey.get(overlay.key);
        if (seen) seen.lastFrame = frame;
        else byKey.set(overlay.key, { key: overlay.key, index: overlay.index, duration: overlay.duration, firstFrame: frame, lastFrame: frame });
      }
      let plan = byIndex.get(layer.sceneIndex);
      if (!plan) {
```

with:

```ts
      for (const overlay of layer.overlays) {
        const seen = byKey.get(overlay.key);
        if (seen) seen.lastFrame = frame;
        else byKey.set(overlay.key, { key: overlay.key, index: overlay.index, start: overlay.start, duration: overlay.duration, firstFrame: frame, lastFrame: frame });
      }
      let plan = byIndex.get(layer.sceneIndex);
      if (!plan) {
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/timeline packages/export/test/frame-plan.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/timeline packages/export/src/frame-plan.ts packages/export/test/frame-plan.test.ts packages/engine/test/renderer.browser.test.ts
git commit -m "timeline: each showing of an overlay knows where it starts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The motion kit

**Files:**
- Create: `packages/motion-kit/` (package, helpers, templates, build script, tests)
- Modify: `package.json`, `tsconfig.node.json`, `pnpm-lock.yaml`

- [ ] **Step 1: The package and its dependencies**

`packages/motion-kit/package.json`:

```json
{
  "name": "@cuttle/motion-kit",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./files": "./src/files.ts"
  },
  "dependencies": {
    "@fontsource-variable/archivo": "5.3.0",
    "@fontsource-variable/fraunces": "5.3.0",
    "@fontsource-variable/space-grotesk": "5.3.0",
    "@fontsource/bebas-neue": "5.3.0",
    "@fontsource/instrument-serif": "5.3.0",
    "@fontsource/inter": "^5.3.0",
    "@fontsource/jetbrains-mono": "5.3.0",
    "lottie-web": "5.13.0",
    "three": "0.186.1"
  }
}
```

```bash
pnpm install
```

- [ ] **Step 2: Write the failing tests**

`packages/motion-kit/test/kit.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KIT_FONTS, KIT_IMPORTS, KIT_ORIGIN, MOTION_TEMPLATES, importMapTag, withImportMap } from '../src/index';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));

describe('the motion kit', () => {
  it('maps the bare names a page imports to the kit', () => {
    expect(KIT_IMPORTS).toEqual({
      three: 'cuttle-motion://kit/three/three.module.js',
      'three/addons/': 'cuttle-motion://kit/three/addons/',
      cuttle: 'cuttle-motion://kit/motion.js',
      'lottie-web': 'cuttle-motion://kit/lottie/lottie.mjs',
    });
    expect(KIT_FONTS.every((font) => font.src.startsWith(`${KIT_ORIGIN}/fonts/`))).toBe(true);
    expect([...new Set(KIT_FONTS.map((font) => font.family))]).toEqual(['Inter', 'JetBrains Mono', 'Archivo', 'Space Grotesk', 'Bebas Neue', 'Fraunces', 'Instrument Serif']);
  });

  it('puts the import map first in a page, after its doctype', () => {
    const map = importMapTag();
    expect(map).toBe(`<script type="importmap">${JSON.stringify({ imports: KIT_IMPORTS })}</script>`);
    expect(withImportMap('<!doctype html>\n<h1>Hi</h1>')).toBe(`<!doctype html>${map}\n<h1>Hi</h1>`);
    expect(withImportMap('\uFEFF<!DOCTYPE html><p>')).toBe(`\uFEFF<!DOCTYPE html>${map}<p>`);
    expect(withImportMap('<h1>Hi</h1>')).toBe(`${map}<h1>Hi</h1>`);
  });

  it('has a page for every template, and each says when it is one (a scene or an overlay)', () => {
    expect(MOTION_TEMPLATES.map((template) => template.name)).toEqual(['title', 'end-card', 'code-typing', 'lower-third', 'click-callouts', 'kinetic-captions']);
    for (const template of MOTION_TEMPLATES) {
      const file = `${TEMPLATES}${template.name}/index.html`;
      expect(existsSync(file), template.name).toBe(true);
      expect(readFileSync(file, 'utf8'), template.name).toMatch(/^<!doctype html>/);
      expect(template.whole === true || template.duration > 0, template.name).toBe(true);
    }
  });
});
```

`packages/motion-kit/test/motion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { alpha, at, bezier, ease, highlight, inOut, keys, mix, random, spring, stagger, typed, typedUntil } from '../kit/motion.js';

describe("Cuttle's motion helpers", () => {
  it('ease from 0 to 1, as CSS does', () => {
    for (const curve of Object.values(ease)) {
      expect(curve(0)).toBeCloseTo(0, 6);
      expect(curve(1)).toBeCloseTo(1, 6);
    }
    // cubic-bezier(0.25, 0.1, 0.25, 1) at x = 0.5 (the browser's own value)
    expect(ease.css(0.5)).toBeCloseTo(0.8024, 3);
    expect(bezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 5);
    expect(ease.outBack(0.6)).toBeGreaterThan(1);
  });

  it('spring to 1 and settle there', () => {
    expect(spring(0)).toBe(0);
    expect(Math.max(...[0.1, 0.2, 0.3, 0.4].map((s) => spring(s)))).toBeGreaterThan(1);
    expect(spring(2)).toBeCloseTo(1, 3);
    expect(spring(2, { damping: 40 })).toBeCloseTo(1, 3);
  });

  it('say how far an animation is, and ramp in and out', () => {
    expect([at(0.5, 1, 1), at(1.5, 1, 1, ease.linear), at(3, 1, 1)]).toEqual([0, 0.5, 1]);
    expect(at(1, 1, 0)).toBe(1);
    expect([inOut(0, 1, 3, 0.5), inOut(2, 1, 3, 0.5), inOut(3, 1, 3, 0.5)]).toEqual([0, 1, 0]);
    expect(inOut(2.75, 1, 3, 0.5, 0.5, ease.linear)).toBeCloseTo(0.5, 6);
  });

  it('go through keyframes of numbers, lists and colours', () => {
    const frames: [number, number, ((t: number) => number)?][] = [[0, 0], [1, 10, ease.linear], [2, 0, ease.linear]];
    expect([keys(-1, frames), keys(0.5, frames), keys(1.5, frames), keys(5, frames)]).toEqual([0, 5, 5, 0]);
    expect(keys(0.5, [[0, [0, 100]], [1, [10, 0], ease.linear]])).toEqual([5, 50]);
    expect(keys(0.5, [[0, '#000000'], [1, '#ffffff', ease.linear]])).toBe('#808080');
    expect(mix('#d97757', '#ffffff', 0)).toBe('#d97757');
    expect(alpha('#d97757', 0.5)).toBe('rgba(217, 119, 87, 0.5)');
  });

  it('stagger from the start, the end, the middle or an index', () => {
    expect([0, 1, 2, 3, 4].map((i) => stagger(i, 5, 0.1))).toEqual([0, 0.1, 0.2, 0.30000000000000004, 0.4]);
    expect([0, 1, 2, 3, 4].map((i) => stagger(i, 5, 1, 'center'))).toEqual([2, 1, 0, 1, 2]);
    expect(stagger(0, 5, 1, 'end')).toBe(4);
  });

  it('give the same random numbers for the same seed', () => {
    const a = random(7);
    const b = random(7);
    const numbers = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(numbers);
    expect(random(8)()).not.toBe(numbers[0]);
  });

  it('type text with a rhythm, and know when it is done', () => {
    const text = 'Hi, you.\nOk';
    expect(typed(text, 0)).toBe('');
    expect(typed(text, 0.03, { cps: 40 })).toBe('H');
    expect(typed(text, 100)).toBe(text);
    const done = typedUntil(text, { start: 1, cps: 20 });
    expect(typed(text, done - 0.001, { start: 1, cps: 20 })).toBe(text.slice(0, -1));
    expect(typed(text, done, { start: 1, cps: 20 })).toBe(text);
  });

  it('colour code by its tokens', () => {
    expect(highlight('const x = await load("a"); // done', 'ts')).toBe(
      '<span class="tok-keyword">const</span> x <span class="tok-punct">=</span> <span class="tok-keyword">await</span> <span class="tok-function">load</span><span class="tok-punct">(</span><span class="tok-string">"a"</span><span class="tok-punct">);</span> <span class="tok-comment">// done</span>',
    );
    expect(highlight('{ "name": "Cuttle", "fast": true }', 'json')).toBe(
      '<span class="tok-punct">{</span> <span class="tok-attr">"name"</span><span class="tok-punct">:</span> <span class="tok-string">"Cuttle"</span><span class="tok-punct">,</span> <span class="tok-attr">"fast"</span><span class="tok-punct">:</span> <span class="tok-keyword">true</span> <span class="tok-punct">}</span>',
    );
    expect(highlight('def run(n): # go', 'python')).toBe('<span class="tok-keyword">def</span> <span class="tok-function">run</span><span class="tok-punct">(</span>n<span class="tok-punct">):</span> <span class="tok-comment"># go</span>');
    expect(highlight('<a href="/x">Hi & bye</a>', 'html')).toBe(
      '<span class="tok-punct">&lt;</span><span class="tok-tag">a</span> <span class="tok-attr">href</span><span class="tok-punct">=</span><span class="tok-string">"/x"</span><span class="tok-punct">&gt;</span>Hi &amp; bye<span class="tok-punct">&lt;/</span><span class="tok-tag">a</span><span class="tok-punct">&gt;</span>',
    );
  });
});
```

In `tsconfig.node.json`, replace:

```json
    "types": ["node"],
    "allowImportingTsExtensions": true
  },
  "include": ["vitest.config.ts", "tools", "packages/engine/electron/vite.config.ts"]
}
```

with:

```json
    "types": ["node"],
    "allowImportingTsExtensions": true
  },
  "include": ["vitest.config.ts", "tools", "packages/engine/electron/vite.config.ts", "packages/motion-kit/src", "packages/motion-kit/test"]
}
```

Run: `pnpm exec vitest run --project node packages/motion-kit`
Expected: FAIL: `../src/index` and `../kit/motion.js` do not exist.

- [ ] **Step 3: The kit's manifest, its files and Cuttle's helpers**

`packages/motion-kit/src/index.ts`:

```ts
// The motion kit: what every motion page can use without the network. It is served at
// cuttle-motion://kit/ from a folder that scripts/copy.mjs builds next to each bundle (the CLI's,
// the app's, the export check's):
//   motion.js            Cuttle's helpers (easing, tweens, text, code)
//   three/               Three.js (three.module.js, three.core.js) and its addons (three/addons/)
//   lottie/              lottie-web: lottie.mjs (a module) and lottie.min.js (a script)
//   fonts/               Inter, JetBrains Mono and display faces (woff2, Latin; see KIT_FONTS)
//   templates/<name>/    the pages `cuttle motion new` copies into a project
//   licenses/            the licenses of what it bundles

/** The kit's origin in a motion page. */
export const KIT_ORIGIN = 'cuttle-motion://kit';

/** The folder of the kit next to a bundle. */
export const KIT_FOLDER = 'motion-kit';

/** Bare names a page may import (its import map): Three.js and its addons, Cuttle's helpers, lottie-web. */
export const KIT_IMPORTS: Readonly<Record<string, string>> = {
  three: `${KIT_ORIGIN}/three/three.module.js`,
  'three/addons/': `${KIT_ORIGIN}/three/addons/`,
  cuttle: `${KIT_ORIGIN}/motion.js`,
  'lottie-web': `${KIT_ORIGIN}/lottie/lottie.mjs`,
};

/** A font face of the kit: `weight` and `stretch` are ranges for a variable font ("100 900", "62% 125%"). */
export interface KitFont {
  family: string;
  weight: string;
  style: 'normal' | 'italic';
  stretch?: string;
  src: string;
}

const face = (family: string, file: string, weight: string, style: KitFont['style'] = 'normal', stretch?: string): KitFont => ({
  family,
  weight,
  style,
  ...(stretch && { stretch }),
  src: `${KIT_ORIGIN}/fonts/${file}`,
});

/**
 * The fonts every page has, without loading them itself:
 * - Inter (the theme's `--cuttle-font`) and JetBrains Mono (`--cuttle-mono`);
 * - for display type: Archivo (variable weight and width, from condensed 62% to expanded 125%),
 *   Space Grotesk, Bebas Neue (condensed capitals), Fraunces (a variable display serif) and
 *   Instrument Serif (an editorial serif, upright and italic).
 */
export const KIT_FONTS: readonly KitFont[] = [
  ...[300, 400, 500, 600, 700, 800, 900].map((weight) => face('Inter', `inter-latin-${weight}-normal.woff2`, String(weight))),
  ...[400, 500, 700].map((weight) => face('JetBrains Mono', `jetbrains-mono-latin-${weight}-normal.woff2`, String(weight))),
  face('Archivo', 'archivo-latin-wdth-normal.woff2', '100 900', 'normal', '62% 125%'),
  face('Archivo', 'archivo-latin-wdth-italic.woff2', '100 900', 'italic', '62% 125%'),
  face('Space Grotesk', 'space-grotesk-latin-wght-normal.woff2', '300 700'),
  face('Bebas Neue', 'bebas-neue-latin-400-normal.woff2', '400'),
  face('Fraunces', 'fraunces-latin-full-normal.woff2', '100 900'),
  face('Fraunces', 'fraunces-latin-full-italic.woff2', '100 900', 'italic'),
  face('Instrument Serif', 'instrument-serif-latin-400-normal.woff2', '400'),
  face('Instrument Serif', 'instrument-serif-latin-400-italic.woff2', '400', 'italic'),
];

/** A template `cuttle motion new` copies: a scene of its own, or an overlay over the clips. */
export interface MotionTemplate {
  name: string;
  kind: 'scene' | 'overlay';
  /** Seconds it lasts when added: a scene's output seconds, an overlay's source seconds. */
  duration: number;
  /** An overlay that belongs over the whole take (it follows the take itself). */
  whole?: boolean;
  description: string;
}

export const MOTION_TEMPLATES: readonly MotionTemplate[] = [
  { name: 'title', kind: 'scene', duration: 3.5, description: 'a kinetic title: the words rise out of a blur, an accent line draws under them' },
  { name: 'end-card', kind: 'scene', duration: 4, description: 'the end card: a logo or monogram, a line, the URL in a pill that types itself, a call to action' },
  { name: 'code-typing', kind: 'scene', duration: 6, description: 'a code editor that types a file with syntax colours, line by line' },
  { name: 'lower-third', kind: 'overlay', duration: 4, description: 'a name and a role in a bar that wipes in and out' },
  { name: 'click-callouts', kind: 'overlay', duration: 0, whole: true, description: 'a ring and a number at every click the video shows, on the click' },
  { name: 'kinetic-captions', kind: 'overlay', duration: 0, whole: true, description: 'the spoken words, word by word, the current one in the accent colour' },
];

/** An import map for the kit's bare names, as the first element of a page (before any module). */
export function importMapTag(): string {
  return `<script type="importmap">${JSON.stringify({ imports: KIT_IMPORTS })}</script>`;
}

/** A page with the kit's import map first (after its doctype), before anything that could load a module. */
export function withImportMap(html: string): string {
  const doctype = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? '';
  return `${doctype}${importMapTag()}${html.slice(doctype.length)}`;
}
```

`packages/motion-kit/src/files.ts`:

```ts
// Where the kit's files are on disk (Node only).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER } from './index';

/** The templates in this package (a checkout of the repository). */
export const SOURCE_TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));

/** The templates of the kit next to a bundle (`bundleUrl`: its `import.meta.url`), else this package's own. */
export function templatesFolder(bundleUrl: string): string {
  const built = fileURLToPath(new URL(`./${KIT_FOLDER}/templates/`, bundleUrl));
  return existsSync(built) ? built : SOURCE_TEMPLATES;
}
```

`packages/motion-kit/kit/motion.js`:

```
// Cuttle's helpers for motion pages: import { at, ease, keys, stagger, split, typed, highlight } from 'cuttle';
//
// Everything here is a pure function of time. A page that draws from `cuttle.onFrame((t) => …)` with
// them shows the right picture on every frame, also after a jump, in every render.

/** `value` kept between `min` and `max`. */
export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** From `a` to `b` by `t` (0 to 1). */
export const lerp = (a, b, t) => a + (b - a) * t;

/** A CSS-style cubic Bézier easing (`cubic-bezier(x1, y1, x2, y2)`), solved for x. */
export function bezier(x1, y1, x2, y2) {
  const coordinate = (t, a, b) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  const slope = (t, a, b) => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = coordinate(t, x1, x2) - x;
      if (Math.abs(error) < 1e-6) return coordinate(t, y1, y2);
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30 && Math.abs(coordinate(t, x1, x2) - x) > 1e-6; i++) {
      if (coordinate(t, x1, x2) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return coordinate(t, y1, y2);
  };
}

/**
 * A spring from 0 to 1, `seconds` after it starts (it may overshoot): `stiffness`, `damping` and
 * `mass` as in physics (the defaults settle in about 0.6 s with a small overshoot).
 */
export function spring(seconds, { stiffness = 170, damping = 20, mass = 1 } = {}) {
  if (seconds <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * seconds) * (Math.cos(wd * seconds) + ((zeta * w0) / wd) * Math.sin(wd * seconds));
  }
  return 1 - Math.exp(-w0 * seconds) * (1 + w0 * seconds);
}

/** Easing curves: each maps 0..1 to 0..1 (`outBack` and `outElastic` overshoot). */
export const ease = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuart: (t) => 1 - (1 - t) ** 4,
  outQuint: (t) => 1 - (1 - t) ** 5,
  inExpo: (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  outBack: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  inBack: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
  outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  /** The web's `ease`, `ease-out`, and the smooth curve of most product animation. */
  css: bezier(0.25, 0.1, 0.25, 1),
  cssOut: bezier(0, 0, 0.58, 1),
  smooth: bezier(0.2, 0.8, 0.2, 1),
};

/**
 * How far an animation that starts at `start` and lasts `duration` seconds is at time `t`, eased:
 * 0 before it, 1 after it.
 */
export function at(t, start, duration, curve = ease.out) {
  if (!(duration > 0)) return t >= start ? 1 : 0;
  return curve(clamp((t - start) / duration));
}

/** In and out: 0 before `start`, rising over `inFor` seconds, 1, falling over `outFor` to 0 at `end`. */
export function inOut(t, start, end, inFor = 0.4, outFor = inFor, curve = ease.out) {
  return Math.min(at(t, start, inFor, curve), 1 - at(t, end - outFor, outFor, (x) => 1 - curve(1 - x)));
}

const HEX = /^#([0-9a-f]{6})$/i;
const toRgb = (hex) => {
  const match = HEX.exec(hex);
  if (!match) throw new Error(`not a colour like #d97757: ${hex}`);
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const toHex = (rgb) => `#${rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

/** Colour `a` mixed with `b` by `t` (both `#rrggbb`). */
export const mix = (a, b, t) => {
  const to = toRgb(b);
  return toHex(toRgb(a).map((c, i) => lerp(c, to[i], t)));
};

/** A colour (`#rrggbb`) at an opacity, for CSS and the canvas: `rgba(r, g, b, a)`. */
export const alpha = (color, a) => `rgba(${toRgb(color).join(', ')}, ${a})`;

/**
 * A value through keyframes at time `t`: `[[time, value, curve?], …]` in time order; a keyframe's
 * curve leads into it (default `ease.inOut`). Values are numbers, lists of numbers or colours.
 */
export function keys(t, frames) {
  if (frames.length === 0) throw new Error('keys: no keyframes');
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [time, value, curve = ease.inOut] = frames[i];
    if (t >= time) continue;
    const [before, from] = frames[i - 1];
    const f = curve(clamp((t - before) / (time - before)));
    if (typeof from === 'number') return lerp(from, value, f);
    if (typeof from === 'string') return mix(from, value, f);
    return from.map((v, j) => lerp(v, value[j], f));
  }
  return frames[frames.length - 1][1];
}

/**
 * When item `index` of `count` starts, `each` seconds after its neighbour: counted from the first
 * (`'start'`), the last (`'end'`), the middle (`'center'`), or an index outward.
 */
export function stagger(index, count, each, from = 'start') {
  const origin = from === 'start' ? 0 : from === 'end' ? count - 1 : from === 'center' ? (count - 1) / 2 : from;
  return Math.abs(index - origin) * each;
}

/** A seeded random number generator (mulberry32): `random(7)` gives the same numbers every time. */
export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Splits an element's text into spans to animate, one per word or per character (`by`), each word
 * kept whole so lines still break between words. The spans are `display: inline-block`.
 */
export function split(element, by = 'word') {
  const text = element.textContent ?? '';
  element.textContent = '';
  const parts = [];
  for (const chunk of text.split(/(\s+)/)) {
    if (chunk === '') continue;
    if (/^\s+$/.test(chunk)) {
      element.append(document.createTextNode(chunk));
      continue;
    }
    const word = document.createElement('span');
    word.style.display = 'inline-block';
    word.style.whiteSpace = 'nowrap';
    if (by === 'word') {
      word.textContent = chunk;
      parts.push(word);
    } else {
      for (const char of chunk) {
        const span = document.createElement('span');
        span.style.display = 'inline-block';
        span.textContent = char;
        word.append(span);
        parts.push(span);
      }
    }
    element.append(word);
  }
  return parts;
}

const pauseAfter = (char, pause) => (char === '\n' ? pause * 1.5 : /[.,;:!?)}\]]/.test(char) ? pause * 0.5 : 0);

/**
 * How much of `text` is typed at time `t`, typing from `start` at `cps` characters a second with a
 * person's rhythm: a pause after punctuation and at each line's end.
 */
export function typed(text, t, { start = 0, cps = 30, pause = 0.12 } = {}) {
  let clock = start;
  for (let i = 0; i < text.length; i++) {
    clock += 1 / cps;
    if (clock > t) return text.slice(0, i);
    clock += pauseAfter(text[i], pause);
  }
  return text;
}

/** When `typed` has typed all of `text` (the same rhythm). */
export function typedUntil(text, { start = 0, cps = 30, pause = 0.12 } = {}) {
  let clock = start;
  for (const char of text) clock += 1 / cps + pauseAfter(char, pause);
  return clock;
}

const KEYWORDS = {
  js: 'await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield async',
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self',
  bash: 'if then else elif fi for in do done while case esac function return export local echo cd exit set unset source npm pnpm npx git',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
  rust: 'as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  sql: 'select from where and or not insert into values update set delete create table index join left right inner outer on group by order having limit as null is in distinct count primary key SELECT FROM WHERE AND OR NOT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE JOIN ON GROUP BY ORDER LIMIT AS',
  css: 'important',
  json: 'true false null',
};
KEYWORDS.ts = `${KEYWORDS.js} interface type enum implements private public protected readonly declare namespace abstract as keyof satisfies`;

const ALIASES = { javascript: 'js', jsx: 'js', mjs: 'js', typescript: 'ts', tsx: 'ts', sh: 'bash', shell: 'bash', zsh: 'bash', py: 'python', rs: 'rust' };

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * `code` as HTML with its tokens in spans (`tok-keyword`, `tok-string`, `tok-number`, `tok-comment`,
 * `tok-function`, `tok-type`, `tok-tag`, `tok-attr`, `tok-punct`) for `language`: js, ts, json,
 * python, bash, go, rust, sql, css or html. `HIGHLIGHT_CSS` colours them.
 */
export function highlight(code, language = 'ts') {
  const lang = ALIASES[language] ?? language;
  if (lang === 'html') return highlightHtml(code);
  const words = new Set((KEYWORDS[lang] ?? KEYWORDS.ts).split(' ').filter(Boolean));
  const comment = lang === 'python' || lang === 'bash' ? /#[^\n]*/y : lang === 'sql' ? /--[^\n]*/y : lang === 'json' ? null : /\/\/[^\n]*|\/\*[\s\S]*?\*\//y;
  const patterns = [
    ['comment', comment],
    ['string', /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/y],
    ['number', /\b(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b/iy],
    ['attr', lang === 'css' ? /[a-z-]+(?=\s*:)/y : null],
    ['word', /[A-Za-z_$][\w$-]*/y],
    ['punct', /[{}()[\];,.:<>=+\-*/%!&|^~?@#]+/y],
    ['space', /\s+/y],
  ].filter(([, pattern]) => pattern !== null);
  let html = '';
  let i = 0;
  while (i < code.length) {
    let matched = false;
    for (const [kind, pattern] of patterns) {
      pattern.lastIndex = i;
      const match = pattern.exec(code);
      if (!match || match[0] === '') continue;
      let text = match[0];
      let cls = kind;
      if (kind === 'word') {
        // a dash belongs to a word in css and bash flags only
        if (lang !== 'css' && lang !== 'bash') text = /^[A-Za-z_$][\w$]*/.exec(text)[0];
        const after = code.slice(i + text.length);
        cls = words.has(text) ? 'keyword' : /^\s*\(/.test(after) ? 'function' : /^[A-Z]/.test(text) ? 'type' : '';
      } else if (kind === 'string' && lang === 'json' && /^\s*:/.test(code.slice(i + text.length))) {
        cls = 'attr';
      } else if (kind === 'space') {
        cls = '';
      }
      html += cls ? `<span class="tok-${cls}">${escape(text)}</span>` : escape(text);
      i += text.length;
      matched = true;
      break;
    }
    if (!matched) {
      html += escape(code[i]);
      i++;
    }
  }
  return html;
}

function highlightHtml(code) {
  return escape(code).replace(/(&lt;\/?)([a-zA-Z][\w-]*)([\s\S]*?)(\/?&gt;)/g, (_, open, tag, attrs, close) => {
    const coloured = attrs.replace(/([\w-]+)(=)("[^"]*"|'[^']*')/g, '<span class="tok-attr">$1</span><span class="tok-punct">$2</span><span class="tok-string">$3</span>');
    return `<span class="tok-punct">${open}</span><span class="tok-tag">${tag}</span>${coloured}<span class="tok-punct">${close}</span>`;
  });
}

/** Colours for `highlight`'s spans: a dark editor theme. */
export const HIGHLIGHT_CSS = `
.tok-keyword { color: #ff7ab2; }
.tok-string { color: #ffb86b; }
.tok-number { color: #d9c97c; }
.tok-comment { color: #7f8c98; font-style: italic; }
.tok-function { color: #67b7f7; }
.tok-type { color: #5dd8ff; }
.tok-tag { color: #ff7ab2; }
.tok-attr { color: #b281eb; }
.tok-punct { color: #a9b1bd; }
`;

/** Shrinks `element`'s font from `max` down to `min` px until its text fits `width` px on one line. */
export function fit(element, { width, max, min = 8 }) {
  let size = max;
  element.style.fontSize = `${size}px`;
  while (size > min && element.scrollWidth > width) {
    size -= 1;
    element.style.fontSize = `${size}px`;
  }
  return size;
}
```

`packages/motion-kit/kit/motion.d.ts`:

```ts
// Types of Cuttle's motion helpers (motion.js), served with them at cuttle-motion://kit/motion.d.ts.

export type Curve = (t: number) => number;
export type KeyValue = number | string | number[];

export function clamp(value: number, min?: number, max?: number): number;
export function lerp(a: number, b: number, t: number): number;
export function bezier(x1: number, y1: number, x2: number, y2: number): Curve;
export function spring(seconds: number, options?: { stiffness?: number; damping?: number; mass?: number }): number;
export const ease: {
  linear: Curve;
  in: Curve;
  out: Curve;
  inOut: Curve;
  outQuart: Curve;
  outQuint: Curve;
  inExpo: Curve;
  outExpo: Curve;
  inOutExpo: Curve;
  outBack: Curve;
  inBack: Curve;
  outElastic: Curve;
  css: Curve;
  cssOut: Curve;
  smooth: Curve;
};
export function at(t: number, start: number, duration: number, curve?: Curve): number;
export function inOut(t: number, start: number, end: number, inFor?: number, outFor?: number, curve?: Curve): number;
export function mix(a: string, b: string, t: number): string;
export function alpha(color: string, a: number): string;
export function keys<T extends KeyValue>(t: number, frames: [time: number, value: T, curve?: Curve][]): T;
export function stagger(index: number, count: number, each: number, from?: 'start' | 'end' | 'center' | number): number;
export function random(seed: number): () => number;
export function split(element: Element, by?: 'word' | 'char'): HTMLSpanElement[];
export function typed(text: string, t: number, options?: { start?: number; cps?: number; pause?: number }): string;
export function typedUntil(text: string, options?: { start?: number; cps?: number; pause?: number }): number;
export function highlight(code: string, language?: string): string;
export const HIGHLIGHT_CSS: string;
export function fit(element: HTMLElement, options: { width: number; max: number; min?: number }): number;
```

- [ ] **Step 4: The templates**

`packages/motion-kit/templates/title/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Title</title>
    <!-- A kinetic title: an eyebrow line, the title's words rising out of a blur, an accent line
         that draws under them, a subtitle; everything leaves upward at the end. -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "title", "label": "Title", "type": "text", "default": "Built with Claude Code" },
        { "name": "subtitle", "label": "Subtitle", "type": "text", "default": "" },
        { "name": "eyebrow", "label": "Small line above", "type": "text", "default": "" },
        { "name": "align", "label": "Align", "type": "select", "default": "center", "options": ["center", "left"] },
        { "name": "background", "label": "Own background", "type": "bool", "default": true }
      ]
    </script>
    <style>
      :root {
        --u: calc(100vmin / 1080);
      }
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
      }
      body {
        font-family: 'Archivo', var(--cuttle-font);
        color: var(--cuttle-fg);
        display: grid;
        place-items: center;
      }
      canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }
      .block {
        position: relative;
        width: 84vw;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      .left .block {
        align-items: flex-start;
        text-align: left;
      }
      .eyebrow {
        display: flex;
        align-items: center;
        gap: calc(16 * var(--u));
        font: 600 calc(26 * var(--u)) / 1 var(--cuttle-mono);
        letter-spacing: 0.28em;
        text-transform: uppercase;
        color: var(--cuttle-accent);
        margin-bottom: calc(34 * var(--u));
      }
      .eyebrow i {
        display: block;
        width: calc(56 * var(--u));
        height: calc(2 * var(--u));
        background: var(--cuttle-accent);
        transform-origin: left;
      }
      h1 {
        margin: 0;
        font-weight: 800;
        font-stretch: 112%;
        font-size: calc(132 * var(--u));
        line-height: 0.98;
        letter-spacing: -0.035em;
        perspective: calc(900 * var(--u));
      }
      h1 span {
        will-change: transform, filter, opacity;
      }
      .line {
        height: calc(8 * var(--u));
        width: 38%;
        margin-top: calc(34 * var(--u));
        border-radius: calc(4 * var(--u));
        background: linear-gradient(90deg, var(--cuttle-accent), color-mix(in srgb, var(--cuttle-accent) 40%, white) 70%, transparent);
        box-shadow: 0 0 calc(40 * var(--u)) color-mix(in srgb, var(--cuttle-accent) 60%, transparent);
        transform-origin: left;
      }
      .center .line {
        transform-origin: center;
      }
      .subtitle {
        margin-top: calc(30 * var(--u));
        font: 400 italic calc(58 * var(--u)) / 1.2 "Instrument Serif", serif;
        color: color-mix(in srgb, var(--cuttle-fg) 78%, transparent);
      }
    </style>
  </head>
  <body>
    <canvas id="bg"></canvas>
    <div class="block">
      <div class="eyebrow" id="eyebrow"><i></i><span id="eyebrow-text"></span></div>
      <h1 id="title"></h1>
      <div class="line" id="line"></div>
      <div class="subtitle" id="subtitle"></div>
    </div>
    <script type="module">
      import { at, ease, fit, random, stagger, split } from 'cuttle';

      const { params, duration, size } = cuttle;
      document.body.classList.add(params.align === 'left' ? 'left' : 'center');
      const title = document.getElementById('title');
      title.textContent = params.title || 'Title';
      const subtitle = document.getElementById('subtitle');
      subtitle.textContent = params.subtitle || '';
      const eyebrow = document.getElementById('eyebrow');
      document.getElementById('eyebrow-text').textContent = params.eyebrow || '';
      if (!params.eyebrow) eyebrow.remove();
      if (!params.subtitle) subtitle.remove();

      // the title fits the width (once its font is in), then its words are split for their entrance
      let words = [];
      cuttle.ready(
        document.fonts.load('800 100px Archivo').then(() => {
          fit(title, { width: size.width * 0.84, max: parseFloat(getComputedStyle(title).fontSize), min: 24 });
          words = split(title, 'word');
        }),
      );

      // the background: the theme's tone, two soft lights drifting, film grain
      const canvas = document.getElementById('bg');
      const g = canvas.getContext('2d');
      canvas.width = size.width;
      canvas.height = size.height;
      const css = getComputedStyle(document.documentElement);
      const tone = css.getPropertyValue('--cuttle-bg').trim() || '#16161a';
      const accent = css.getPropertyValue('--cuttle-accent').trim() || '#d97757';
      const grain = document.createElement('canvas');
      grain.width = grain.height = 256;
      const noise = grain.getContext('2d').createImageData(256, 256);
      const rand = random(11);
      for (let i = 0; i < noise.data.length; i += 4) {
        const v = 128 + (rand() - 0.5) * 70;
        noise.data.set([v, v, v, 14], i);
      }
      grain.getContext('2d').putImageData(noise, 0, 0);
      const pattern = g.createPattern(grain, 'repeat');

      function background(t) {
        if (!params.background) return g.clearRect(0, 0, size.width, size.height);
        const { width: w, height: h } = size;
        g.fillStyle = tone;
        g.fillRect(0, 0, w, h);
        const glow = (x, y, r, color, a) => {
          const grad = g.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, color + Math.round(a * 255).toString(16).padStart(2, '0'));
          grad.addColorStop(1, color + '00');
          g.fillStyle = grad;
          g.fillRect(0, 0, w, h);
        };
        const m = Math.max(w, h);
        glow(w * (0.28 + 0.05 * Math.sin(t * 0.6)), h * (0.32 + 0.04 * Math.cos(t * 0.5)), m * 0.55, accent, 0.42);
        glow(w * (0.76 - 0.04 * Math.sin(t * 0.4)), h * (0.72 + 0.05 * Math.sin(t * 0.7)), m * 0.5, '#6b7cff', 0.3);
        const vignette = g.createRadialGradient(w / 2, h / 2, m * 0.25, w / 2, h / 2, m * 0.75);
        vignette.addColorStop(0, 'rgba(0,0,0,0)');
        vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
        g.fillStyle = vignette;
        g.fillRect(0, 0, w, h);
        g.fillStyle = pattern;
        g.fillRect(0, 0, w, h);
      }

      const line = document.getElementById('line');
      const bar = eyebrow.isConnected ? eyebrow.querySelector('i') : null;
      const leave = Math.max(1.6, duration - 0.65);
      cuttle.onFrame((t) => {
        background(t);
        // in: the eyebrow, then the words one after another, the line, the subtitle
        if (bar) {
          bar.style.transform = `scaleX(${at(t, 0.05, 0.6, ease.outExpo)})`;
          eyebrow.style.opacity = at(t, 0.05, 0.4) * (1 - at(t, leave, 0.45, ease.in));
        }
        words.forEach((word, i) => {
          const p = at(t, 0.15 + stagger(i, words.length, 0.09), 0.85, ease.outExpo);
          const out = at(t, leave + stagger(i, words.length, 0.04), 0.5, ease.in);
          const y = (1 - p) * 0.55 - out * 0.35;
          word.style.transform = `translateY(${y}em) rotateX(${(1 - p) * -55}deg)`;
          word.style.filter = `blur(${(1 - p) * 14 + out * 10}px)`;
          word.style.opacity = Math.min(p * 1.4, 1) * (1 - out);
        });
        line.style.transform = `scaleX(${at(t, 0.55, 0.9, ease.smooth) * (1 - at(t, leave, 0.45, ease.in))})`;
        if (subtitle.isConnected) {
          const p = at(t, 0.8, 0.8, ease.outExpo);
          subtitle.style.transform = `translateY(${(1 - p) * 30}px)`;
          subtitle.style.opacity = p * (1 - at(t, leave + 0.1, 0.4, ease.in));
        }
      });
    </script>
  </body>
</html>
```

`packages/motion-kit/templates/end-card/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>End card</title>
    <!-- The end card: a logo (or a monogram tile) springs in with a ring, the headline rises letter by
         letter, the URL types itself into a glass pill that a light sweeps across, a call to action
         settles under it; particles drift up behind. -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "headline", "label": "Headline", "type": "text", "default": "Try it yourself" },
        { "name": "url", "label": "URL", "type": "text", "default": "example.com" },
        { "name": "cta", "label": "Call to action", "type": "text", "default": "Link in the description" },
        { "name": "logo", "label": "Logo (an image in the project)", "type": "image", "default": null },
        { "name": "monogram", "label": "Monogram without a logo", "type": "text", "default": "C" }
      ]
    </script>
    <style>
      :root {
        --u: calc(100vmin / 1080);
      }
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: var(--cuttle-bg);
      }
      body {
        font-family: 'Archivo', var(--cuttle-font);
        color: var(--cuttle-fg);
        display: grid;
        place-items: center;
      }
      canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }
      .card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        width: 88vw;
      }
      .mark {
        position: relative;
        width: calc(150 * var(--u));
        height: calc(150 * var(--u));
        margin-bottom: calc(48 * var(--u));
      }
      .tile {
        position: absolute;
        inset: 0;
        border-radius: 26%;
        display: grid;
        place-items: center;
        background: linear-gradient(145deg, color-mix(in srgb, var(--cuttle-accent) 70%, white), var(--cuttle-accent) 55%, color-mix(in srgb, var(--cuttle-accent) 70%, black));
        box-shadow: 0 calc(24 * var(--u)) calc(70 * var(--u)) color-mix(in srgb, var(--cuttle-accent) 45%, transparent), inset 0 calc(2 * var(--u)) 0 rgba(255, 255, 255, 0.35);
        font: 800 calc(84 * var(--u)) / 1 'Archivo', sans-serif;
        color: white;
      }
      .tile img {
        width: 72%;
        height: 72%;
        object-fit: contain;
      }
      .logo-only {
        background: none;
        box-shadow: none;
      }
      .ring {
        position: absolute;
        inset: 0;
        border-radius: 26%;
        border: calc(3 * var(--u)) solid var(--cuttle-accent);
      }
      h1 {
        margin: 0;
        font-weight: 800;
        font-stretch: 108%;
        font-size: calc(104 * var(--u));
        letter-spacing: -0.03em;
        line-height: 1;
      }
      h1 span span {
        will-change: transform, opacity, filter;
      }
      .pill {
        position: relative;
        overflow: hidden;
        margin-top: calc(44 * var(--u));
        padding: calc(18 * var(--u)) calc(38 * var(--u));
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.07);
        border: calc(1.5 * var(--u)) solid rgba(255, 255, 255, 0.16);
        font: 500 calc(44 * var(--u)) / 1.2 var(--cuttle-mono);
        letter-spacing: -0.01em;
        min-height: 1.2em;
      }
      .caret {
        display: inline-block;
        width: 0.08em;
        height: 1em;
        margin-left: 0.06em;
        vertical-align: -0.12em;
        background: var(--cuttle-accent);
      }
      .sweep {
        position: absolute;
        inset: 0;
        background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.35) 50%, transparent 70%);
      }
      .cta {
        margin-top: calc(30 * var(--u));
        font: 500 calc(34 * var(--u)) / 1.3 var(--cuttle-font);
        color: color-mix(in srgb, var(--cuttle-fg) 70%, transparent);
      }
    </style>
  </head>
  <body>
    <canvas id="particles"></canvas>
    <div class="card">
      <div class="mark"><div class="ring" id="ring"></div><div class="tile" id="tile"></div></div>
      <h1 id="headline"></h1>
      <div class="pill" id="pill"><span id="url"></span><span class="caret" id="caret"></span><div class="sweep" id="sweep"></div></div>
      <div class="cta" id="cta"></div>
    </div>
    <script type="module">
      import { at, ease, fit, random, spring, split, stagger, typed, typedUntil } from 'cuttle';

      const { params, size, duration } = cuttle;
      const tile = document.getElementById('tile');
      if (params.logo) {
        const image = new Image();
        // an image param is a path in the project folder (the page itself is in motion/<name>/)
        image.src = /^([a-z]+:|\/)/i.test(params.logo) ? params.logo : `/${params.logo}`;
        tile.append(image);
        tile.classList.add('logo-only');
        cuttle.ready(image.decode().catch(() => {}));
      } else {
        tile.textContent = (params.monogram || 'C').slice(0, 2);
      }
      const headline = document.getElementById('headline');
      headline.textContent = params.headline || '';
      document.getElementById('cta').textContent = params.cta || '';
      let letters = [];
      cuttle.ready(
        document.fonts.load('800 100px Archivo').then(() => {
          fit(headline, { width: size.width * 0.86, max: parseFloat(getComputedStyle(headline).fontSize), min: 24 });
          letters = split(headline, 'char');
        }),
      );

      // particles: seeded, drifting up, a few brighter ones in the accent colour
      const canvas = document.getElementById('particles');
      canvas.width = size.width;
      canvas.height = size.height;
      const g = canvas.getContext('2d');
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--cuttle-accent').trim() || '#d97757';
      const rand = random(5);
      const dots = Array.from({ length: 90 }, () => ({ x: rand(), y: rand(), r: 0.6 + rand() * 2.2, speed: 0.015 + rand() * 0.05, phase: rand() * 6.28, warm: rand() < 0.25 }));
      function particles(t) {
        const { width: w, height: h } = size;
        g.clearRect(0, 0, w, h);
        const glow = g.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.5);
        glow.addColorStop(0, accent + '40');
        glow.addColorStop(1, accent + '00');
        g.fillStyle = glow;
        g.fillRect(0, 0, w, h);
        const unit = Math.min(w, h) / 1080;
        for (const dot of dots) {
          const y = (((dot.y - dot.speed * t) % 1) + 1) % 1;
          const twinkle = 0.45 + 0.55 * Math.sin(dot.phase + t * 2.2) ** 2;
          g.globalAlpha = twinkle * at(t, 0, 0.8);
          g.fillStyle = dot.warm ? accent : '#ffffff';
          g.beginPath();
          g.arc(dot.x * w, y * h, dot.r * unit * 1.6, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }

      const ring = document.getElementById('ring');
      const url = document.getElementById('url');
      const caret = document.getElementById('caret');
      const sweep = document.getElementById('sweep');
      const pill = document.getElementById('pill');
      const cta = document.getElementById('cta');
      const typeFrom = 1.05;
      const typedAt = typedUntil(params.url || '', { start: typeFrom, cps: 22 });
      cuttle.onFrame((t) => {
        particles(t);
        // the mark springs in, a ring leaves it
        const s = spring(t - 0.05, { stiffness: 180, damping: 14 });
        tile.style.transform = `scale(${0.4 + 0.6 * s}) rotate(${(1 - s) * -14}deg)`;
        tile.style.opacity = at(t, 0.05, 0.25);
        const ringP = at(t, 0.35, 1.1, ease.out);
        ring.style.transform = `scale(${1 + ringP * 0.9})`;
        ring.style.opacity = t < 0.35 ? 0 : 0.9 * (1 - ringP);
        // the headline, letter by letter
        letters.forEach((letter, i) => {
          const p = at(t, 0.4 + stagger(i, letters.length, 0.025), 0.7, ease.outExpo);
          letter.style.transform = `translateY(${(1 - p) * 0.5}em)`;
          letter.style.filter = `blur(${(1 - p) * 10}px)`;
          letter.style.opacity = Math.min(1, p * 1.5);
        });
        // the pill opens, the URL types itself, a light sweeps across once it is there
        const open = at(t, 0.8, 0.5, ease.outExpo);
        pill.style.opacity = open;
        pill.style.transform = `translateY(${(1 - open) * 20}px) scale(${0.94 + 0.06 * open})`;
        url.textContent = typed(params.url || '', t, { start: typeFrom, cps: 22 });
        const blinking = t > typedAt + 0.2;
        caret.style.opacity = !blinking || Math.floor((t - typedAt) * 2) % 2 === 0 ? 1 : 0;
        const across = at(t, typedAt + 0.15, 0.9, ease.inOut);
        sweep.style.transform = `translateX(${-110 + across * 220}%)`;
        // the call to action
        const c = at(t, typedAt + 0.3, 0.7, ease.outExpo);
        cta.style.opacity = c;
        cta.style.transform = `translateY(${(1 - c) * 16}px)`;
        // a slow push in, for life
        document.querySelector('.card').style.transform = `scale(${1 + 0.03 * (t / duration)})`;
      });
    </script>
  </body>
</html>
```

`packages/motion-kit/templates/code-typing/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Code typing</title>
    <!-- A code editor that types a file: syntax colours, line numbers, the current line lit, a caret
         that blinks once it is done, and the view scrolling along with the caret. -->
    <script type="application/json" id="cuttle-params">
      [
        {
          "name": "code",
          "label": "Code",
          "type": "text",
          "default": "import { record } from 'cuttle';\n\n// one take, edited by itself\nconst take = await record({ until: 'claude' });\nawait take.suggest({ length: 45 });\nawait take.render('16:9');\n"
        },
        { "name": "language", "label": "Language", "type": "select", "default": "ts", "options": ["ts", "js", "python", "bash", "json", "html", "css", "go", "rust", "sql"] },
        { "name": "file", "label": "File name", "type": "text", "default": "demo.ts" },
        { "name": "cps", "label": "Characters a second", "type": "number", "default": 34, "min": 5, "max": 200 },
        { "name": "background", "label": "Own background", "type": "bool", "default": true }
      ]
    </script>
    <style>
      :root {
        --u: calc(100vmin / 1080);
      }
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
      }
      body {
        display: grid;
        place-items: center;
        font-family: var(--cuttle-font);
        color: #e6e6eb;
      }
      body.own {
        background: radial-gradient(120% 90% at 20% 0%, color-mix(in srgb, var(--cuttle-accent) 28%, var(--cuttle-bg)) 0%, var(--cuttle-bg) 55%, color-mix(in srgb, var(--cuttle-bg) 70%, black) 100%);
      }
      .window {
        width: min(88vw, calc(1500 * var(--u)));
        height: min(78vh, calc(860 * var(--u)));
        border-radius: calc(18 * var(--u));
        background: #17171c;
        box-shadow: 0 calc(40 * var(--u)) calc(120 * var(--u)) rgba(0, 0, 0, 0.55), 0 0 0 calc(1 * var(--u)) rgba(255, 255, 255, 0.08);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .bar {
        height: calc(56 * var(--u));
        flex: none;
        display: flex;
        align-items: center;
        gap: calc(10 * var(--u));
        padding: 0 calc(22 * var(--u));
        background: #1f1f25;
        border-bottom: calc(1 * var(--u)) solid rgba(255, 255, 255, 0.06);
      }
      .bar i {
        width: calc(14 * var(--u));
        height: calc(14 * var(--u));
        border-radius: 50%;
      }
      .tab {
        margin-left: calc(26 * var(--u));
        display: flex;
        align-items: center;
        gap: calc(10 * var(--u));
        padding: calc(8 * var(--u)) calc(16 * var(--u));
        border-radius: calc(8 * var(--u));
        background: #17171c;
        font: 500 calc(22 * var(--u)) / 1 var(--cuttle-font);
        color: #c9c9d1;
      }
      .tab b {
        width: calc(9 * var(--u));
        height: calc(9 * var(--u));
        border-radius: 50%;
        background: var(--cuttle-accent);
      }
      .view {
        position: relative;
        flex: 1;
        overflow: hidden;
      }
      .scroll {
        position: absolute;
        left: 0;
        right: 0;
        top: calc(28 * var(--u));
      }
      .row {
        display: flex;
        height: calc(46 * var(--u));
        align-items: center;
        font: 400 calc(29 * var(--u)) / 1 var(--cuttle-mono);
        white-space: pre;
      }
      .row.current {
        background: rgba(255, 255, 255, 0.045);
      }
      .row .n {
        width: calc(84 * var(--u));
        flex: none;
        text-align: right;
        padding-right: calc(30 * var(--u));
        color: #5c5c68;
      }
      .row.current .n {
        color: #b9b9c4;
      }
      .caret {
        display: inline-block;
        width: calc(3 * var(--u));
        height: 1.15em;
        margin-left: calc(1 * var(--u));
        vertical-align: -0.2em;
        background: var(--cuttle-accent);
        box-shadow: 0 0 calc(12 * var(--u)) var(--cuttle-accent);
      }
    </style>
    <style id="tokens"></style>
  </head>
  <body>
    <div class="window" id="window">
      <div class="bar">
        <i style="background: #ff5f57"></i><i style="background: #febc2e"></i><i style="background: #28c840"></i>
        <div class="tab"><b></b><span id="file"></span></div>
      </div>
      <div class="view" id="view"><div class="scroll" id="scroll"></div></div>
    </div>
    <script type="module">
      import { HIGHLIGHT_CSS, at, ease, highlight, typed, typedUntil } from 'cuttle';

      const { params, duration } = cuttle;
      if (params.background) document.body.classList.add('own');
      document.getElementById('tokens').textContent = HIGHLIGHT_CSS;
      document.getElementById('file').textContent = params.file || 'file';
      const code = String(params.code ?? '').replace(/\r\n/g, '\n');
      const cps = Number(params.cps) || 34;
      const start = 0.55;
      const done = typedUntil(code, { start, cps });
      const scroll = document.getElementById('scroll');
      const view = document.getElementById('view');
      const win = document.getElementById('window');
      const rowHeight = () => scroll.firstElementChild?.getBoundingClientRect().height || 46;

      // when the caret reaches each line: the view scrolls as it goes past the last row that fits
      const lineStarts = [0];
      for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1);
      const reached = lineStarts.map((index) => typedUntil(code.slice(0, index), { start, cps }));

      cuttle.onFrame((t) => {
        // the window comes in and leaves at the end
        const enter = at(t, 0, 0.6, ease.outExpo);
        const leave = at(t, duration - 0.45, 0.45, ease.in);
        win.style.opacity = enter * (1 - leave);
        win.style.transform = `translateY(${(1 - enter) * 30 - leave * 20}px) scale(${0.965 + 0.035 * enter})`;
        // the typed part, coloured, one row per line, the caret at its end
        const text = typed(code, t, { start, cps });
        const lines = highlight(text, params.language || 'ts').split('\n');
        const caretOn = t < done + 0.1 || Math.floor((t - done) * 1.8) % 2 === 0;
        scroll.innerHTML = lines
          .map((html, i) => `<div class="row${i === lines.length - 1 ? ' current' : ''}"><span class="n">${i + 1}</span><span>${html}${i === lines.length - 1 && caretOn ? '<span class="caret"></span>' : ''}</span></div>`)
          .join('');
        const rows = Math.max(1, Math.floor((view.clientHeight - 56) / rowHeight()));
        let shift = 0;
        reached.forEach((when, line) => {
          if (line >= rows) shift += at(t, when, 0.28, ease.out);
        });
        scroll.style.transform = `translateY(${-shift * rowHeight()}px)`;
      });
    </script>
  </body>
</html>
```

`packages/motion-kit/templates/lower-third/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Lower third</title>
    <!-- A name and a role over the video: an accent bar grows, a glass card wipes open from it, the
         name and the role rise out of their masks; at the end it all folds back. -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "name", "label": "Name", "type": "text", "default": "Lena Müller" },
        { "name": "role", "label": "Role", "type": "text", "default": "Founder · Cuttle" },
        { "name": "side", "label": "Side", "type": "select", "default": "left", "options": ["left", "right"] },
        { "name": "place", "label": "Place", "type": "select", "default": "bottom", "options": ["bottom", "top"] }
      ]
    </script>
    <style>
      :root {
        --u: calc(100vmin / 1080);
      }
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
      .third {
        position: absolute;
        display: flex;
        align-items: stretch;
        gap: calc(14 * var(--u));
        left: calc(90 * var(--u));
        bottom: calc(150 * var(--u));
      }
      .right .third {
        left: auto;
        right: calc(90 * var(--u));
        flex-direction: row-reverse;
      }
      .top .third {
        bottom: auto;
        top: calc(110 * var(--u));
      }
      .bar {
        width: calc(8 * var(--u));
        border-radius: calc(4 * var(--u));
        background: var(--cuttle-accent);
        box-shadow: 0 0 calc(30 * var(--u)) color-mix(in srgb, var(--cuttle-accent) 70%, transparent);
        transform-origin: bottom;
      }
      .card {
        padding: calc(24 * var(--u)) calc(38 * var(--u)) calc(26 * var(--u));
        border-radius: calc(16 * var(--u));
        background: rgba(14, 14, 20, 0.8);
        border: calc(1 * var(--u)) solid rgba(255, 255, 255, 0.09);
        box-shadow: 0 calc(24 * var(--u)) calc(60 * var(--u)) rgba(0, 0, 0, 0.35);
      }
      .mask {
        overflow: hidden;
      }
      .name {
        font: 700 calc(50 * var(--u)) / 1.15 'Archivo', var(--cuttle-font);
        font-stretch: 105%;
        letter-spacing: -0.015em;
        color: #fff;
      }
      .role {
        margin-top: calc(6 * var(--u));
        display: flex;
        align-items: center;
        gap: calc(12 * var(--u));
        font: 500 calc(30 * var(--u)) / 1.3 var(--cuttle-font);
        color: rgba(255, 255, 255, 0.72);
      }
      .role i {
        width: calc(9 * var(--u));
        height: calc(9 * var(--u));
        border-radius: 50%;
        background: var(--cuttle-accent);
      }
    </style>
  </head>
  <body>
    <div class="third">
      <div class="bar" id="bar"></div>
      <div class="card" id="card">
        <div class="mask"><div class="name" id="name"></div></div>
        <div class="mask"><div class="role" id="role-line"><i></i><span id="role"></span></div></div>
      </div>
    </div>
    <script type="module">
      import { at, ease } from 'cuttle';

      const { params, duration } = cuttle;
      document.body.classList.add(params.side === 'right' ? 'right' : 'left', params.place === 'top' ? 'top' : 'bottom');
      document.getElementById('name').textContent = params.name || '';
      document.getElementById('role').textContent = params.role || '';
      const bar = document.getElementById('bar');
      const card = document.getElementById('card');
      const name = document.getElementById('name');
      const role = document.getElementById('role-line');
      const right = params.side === 'right';

      cuttle.onFrame((t) => {
        // out: the last 0.7 s, in the reverse order
        const out = duration - 0.7;
        const grow = at(t, 0, 0.4, ease.outExpo) * (1 - at(t, out + 0.45, 0.25, ease.in));
        bar.style.transform = `scaleY(${grow})`;
        const open = at(t, 0.12, 0.65, ease.smooth) * (1 - at(t, out + 0.15, 0.4, ease.inOut));
        card.style.clipPath = right ? `inset(0 0 0 ${(1 - open) * 100}%)` : `inset(0 ${(1 - open) * 100}% 0 0)`;
        const n = at(t, 0.35, 0.6, ease.outExpo) * (1 - at(t, out, 0.3, ease.in));
        name.style.transform = `translateY(${(1 - n) * 110}%)`;
        const r = at(t, 0.5, 0.6, ease.outExpo) * (1 - at(t, out, 0.25, ease.in));
        role.style.transform = `translateY(${(1 - r) * 110}%)`;
      });
    </script>
  </body>
</html>
```

`packages/motion-kit/templates/click-callouts/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Click callouts</title>
    <!-- At every click the video shows: a dot that pops, two rings that leave it, and a numbered
         badge on a short stem; on the click itself, wherever the window, crop and zoom put it. -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "numbered", "label": "Numbers", "type": "bool", "default": true },
        { "name": "label", "label": "Word after the number", "type": "text", "default": "" },
        { "name": "color", "label": "Colour (empty: the accent)", "type": "color", "default": null },
        { "name": "size", "label": "Size", "type": "number", "default": 1, "min": 0.5, "max": 2 }
      ]
    </script>
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
      canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    <script type="module">
      import { alpha, at, ease } from 'cuttle';

      const { params, size, take } = cuttle;
      const canvas = document.getElementById('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const g = canvas.getContext('2d');
      const color = params.color || getComputedStyle(document.documentElement).getPropertyValue('--cuttle-accent').trim() || '#d97757';
      const unit = (Math.min(size.width, size.height) / 1080) * (Number(params.size) || 1);
      cuttle.ready(document.fonts.load(`800 ${Math.round(26 * unit)}px Inter`));

      // the clicks the video shows, in its order, with where they play
      const clicks = take.clicks
        .map((click) => ({ ...click, at: take.toOutput(click.t) }))
        .filter((click) => click.at !== null)
        .sort((a, b) => a.at - b.at)
        .map((click, i) => ({ ...click, number: i + 1 }));

      function callout(click, age) {
        const point = take.toScreen(click.x, click.y);
        if (!point || !point.inside) return;
        const { x, y } = point;
        g.save();
        g.shadowColor = alpha(color, 0.6);
        g.shadowBlur = 24 * unit;
        // the rings
        for (const [delay, width] of [[0, 4], [0.14, 2.5]]) {
          const p = at(age, delay, 0.75, ease.outExpo);
          if (age < delay || p >= 1) continue;
          g.strokeStyle = alpha(color, (1 - p) * 0.95);
          g.lineWidth = width * unit;
          g.beginPath();
          g.arc(x, y, (14 + 70 * p) * unit, 0, Math.PI * 2);
          g.stroke();
        }
        // the dot
        const pop = at(age, -0.1, 0.35, ease.outBack) * (1 - at(age, 0.9, 0.35, ease.in));
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, y, 9 * unit * pop, 0, Math.PI * 2);
        g.fill();
        g.restore();
        // the badge on its stem
        if (!params.numbered && !params.label) return;
        const show = at(age, 0.05, 0.35, ease.outBack) * (1 - at(age, 1.05, 0.3, ease.in));
        if (show <= 0) return;
        const text = [params.numbered ? String(click.number) : '', params.label || ''].filter(Boolean).join(' ');
        g.font = `800 ${26 * unit}px Inter`;
        const w = g.measureText(text).width + 28 * unit;
        const h = 40 * unit;
        const bx = x + 34 * unit;
        const by = y - 58 * unit;
        g.globalAlpha = Math.min(1, show);
        g.strokeStyle = color;
        g.lineWidth = 2.5 * unit;
        g.beginPath();
        g.moveTo(x + 8 * unit, y - 8 * unit);
        g.lineTo(bx + 4 * unit, by + h - 4 * unit);
        g.stroke();
        g.translate(bx, by + h / 2);
        g.scale(show, show);
        g.fillStyle = color;
        g.beginPath();
        g.roundRect(0, -h / 2, w, h, h / 2);
        g.fill();
        g.fillStyle = '#ffffff';
        g.textBaseline = 'middle';
        g.fillText(text, 14 * unit, 1 * unit);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
      }

      cuttle.onFrame(() => {
        g.clearRect(0, 0, size.width, size.height);
        const now = cuttle.videoTime;
        for (const click of clicks) {
          const age = now - click.at;
          if (age >= -0.1 && age <= 1.4) callout(click, age);
        }
      });
    </script>
  </body>
</html>
```

`packages/motion-kit/templates/kinetic-captions/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Kinetic captions</title>
    <!-- The spoken words as the video plays them, a short phrase at a time: each word pops in as it
         is said, the one being said in the accent colour, the phrase lifts away when it is over. -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "style", "label": "Style", "type": "select", "default": "pop", "options": ["pop", "bold"] },
        { "name": "place", "label": "Place", "type": "select", "default": "bottom", "options": ["bottom", "center", "top"] },
        { "name": "size", "label": "Size", "type": "number", "default": 1, "min": 0.5, "max": 2 },
        { "name": "words", "label": "Words at a time", "type": "number", "default": 4, "min": 1, "max": 8 }
      ]
    </script>
    <style>
      :root {
        --u: calc(100vmin / 1080);
      }
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
      .line {
        position: absolute;
        left: 6vw;
        right: 6vw;
        bottom: 13vh;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0 0.28em;
        font: 800 calc(var(--size) * 70 * var(--u)) / 1.12 'Archivo', var(--cuttle-font);
        font-stretch: 104%;
        letter-spacing: -0.01em;
        color: #fff;
        text-align: center;
        paint-order: stroke fill;
        -webkit-text-stroke: calc(var(--size) * 10 * var(--u)) rgba(10, 10, 14, 0.82);
        stroke-linejoin: round;
      }
      .center .line {
        bottom: auto;
        top: 50%;
        translate: 0 -50%;
      }
      .top .line {
        bottom: auto;
        top: 11vh;
      }
      .bold .line {
        text-transform: uppercase;
        font-weight: 900;
        font-stretch: 116%;
        font-size: calc(var(--size) * 96 * var(--u));
      }
      .line span {
        display: inline-block;
        transform-origin: 50% 80%;
      }
    </style>
  </head>
  <body>
    <div class="line" id="line"></div>
    <script type="module">
      import { at, ease } from 'cuttle';

      const { params, take } = cuttle;
      document.body.classList.add(params.style === 'bold' ? 'bold' : 'pop', params.place === 'top' ? 'top' : params.place === 'center' ? 'center' : 'bottom');
      document.documentElement.style.setProperty('--size', String(Number(params.size) || 1));
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--cuttle-accent').trim() || '#d97757';
      cuttle.ready(document.fonts.load('800 70px Archivo'));

      // the words where the video plays them (output seconds), in phrases: a few words, broken at
      // pauses and at the end of a sentence
      const words = take.words
        .map((word) => ({ text: word.text, start: take.toOutput(word.t), end: take.toOutput(Math.max(word.t, word.end - 0.001)) }))
        .filter((word) => word.start !== null && word.end !== null);
      const most = Math.max(1, Math.round(Number(params.words) || 4));
      const phrases = [];
      for (const word of words) {
        const phrase = phrases.at(-1);
        const last = phrase?.words.at(-1);
        if (!phrase || phrase.words.length >= most || word.start - last.end > 0.6 || /[.!?…]$/.test(last.text)) phrases.push({ words: [word] });
        else phrase.words.push(word);
      }
      for (const phrase of phrases) phrase.start = phrase.words[0].start - 0.08;
      phrases.forEach((phrase, i) => (phrase.end = Math.min(phrase.words.at(-1).end + 0.45, phrases[i + 1]?.start ?? Infinity)));

      const line = document.getElementById('line');
      let shown;
      cuttle.onFrame(() => {
        const now = cuttle.videoTime;
        const phrase = phrases.find((candidate) => now >= candidate.start && now < candidate.end);
        if (phrase !== shown) {
          shown = phrase;
          line.innerHTML = '';
          for (const word of phrase?.words ?? []) {
            const span = document.createElement('span');
            span.textContent = word.text;
            line.append(span);
          }
        }
        if (!phrase) return;
        const leave = at(now, phrase.end - 0.18, 0.18, ease.in);
        [...line.children].forEach((span, i) => {
          const word = phrase.words[i];
          const p = at(now, word.start - 0.06, 0.22, ease.outBack);
          const speaking = now >= word.start && now < word.end + 0.08;
          span.style.opacity = String(Math.min(1, p * 1.6) * (1 - leave));
          span.style.transform = `translateY(${(1 - p) * 0.35 - leave * 0.25}em) scale(${(0.7 + 0.3 * p) * (speaking ? 1.06 : 1)})`;
          span.style.color = speaking ? accent : '#ffffff';
        });
      });
    </script>
  </body>
</html>
```

- [ ] **Step 5: The kit's build, next to each bundle**

`packages/motion-kit/scripts/copy.mjs`:

```js
// Builds the motion kit's folder for a bundle (see src/index.ts for what is where):
//   node packages/motion-kit/scripts/copy.mjs <folder>
// The folder is replaced. Everything comes from this package: its own kit/ and templates/, and the
// files of its dependencies (Three.js, lottie-web, the fonts) with their licenses.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2];
if (!out) throw new Error('usage: copy.mjs <folder>');
const target = resolve(out);
const root = fileURLToPath(new URL('..', import.meta.url));
const modules = join(root, 'node_modules');
const copy = (from, to) => cpSync(from, join(target, to), { recursive: true, dereference: true });

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
copy(join(root, 'kit'), '.');
copy(join(root, 'templates'), 'templates');
copy(join(modules, 'three', 'build', 'three.module.js'), 'three/three.module.js');
copy(join(modules, 'three', 'build', 'three.core.js'), 'three/three.core.js');
copy(join(modules, 'three', 'examples', 'jsm'), 'three/addons');
copy(join(modules, 'three', 'LICENSE'), 'licenses/three.js.txt');
copy(join(modules, 'lottie-web', 'build', 'player', 'esm', 'lottie.min.js'), 'lottie/lottie.mjs');
copy(join(modules, 'lottie-web', 'build', 'player', 'lottie.min.js'), 'lottie/lottie.min.js');
copy(join(modules, 'lottie-web', 'LICENSE.md'), 'licenses/lottie-web.txt');

// the Latin faces KIT_FONTS (src/index.ts) names, each family with its licence
const FONTS = [
  ['@fontsource/inter', /^inter-latin-\d+-normal\.woff2$/],
  ['@fontsource/jetbrains-mono', /^jetbrains-mono-latin-\d+-normal\.woff2$/],
  ['@fontsource-variable/archivo', /^archivo-latin-wdth-(normal|italic)\.woff2$/],
  ['@fontsource-variable/space-grotesk', /^space-grotesk-latin-wght-normal\.woff2$/],
  ['@fontsource/bebas-neue', /^bebas-neue-latin-400-normal\.woff2$/],
  ['@fontsource-variable/fraunces', /^fraunces-latin-full-(normal|italic)\.woff2$/],
  ['@fontsource/instrument-serif', /^instrument-serif-latin-400-(normal|italic)\.woff2$/],
];
for (const [pkg, pattern] of FONTS) {
  const files = join(modules, pkg, 'files');
  for (const name of readdirSync(files)) if (pattern.test(name)) copy(join(files, name), `fonts/${name}`);
  copy(join(modules, pkg, 'LICENSE'), `licenses/${pkg.split('/')[1]}.txt`);
}
console.log(`motion kit in ${target}`);
```

In `package.json`, replace:

```json
    "test:watch": "vitest",
    "engine:electron": "vite build --config packages/engine/electron/vite.config.ts && electron packages/engine/electron/main.mjs",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json && tsc -p packages/recorder/tsconfig.json && tsc -p packages/core/tsconfig.json && tsc -p apps/cli/tsconfig.json && tsc -p apps/desktop/tsconfig.json && tsc -p skill/tsconfig.json",
    "export:build": "vite build --config packages/export/electron/vite.main.config.ts && vite build --config packages/export/electron/vite.page.config.ts",
    "export:check": "pnpm export:build && electron packages/export/dist/check.mjs",
    "recorder:real": "vitest run --mode real --silent=false packages/recorder/test/real.test.ts",
    "cli:build": "vite build --config apps/cli/vite.config.ts && vite build --config packages/export/electron/vite.page.config.ts --outDir ../../../apps/cli/dist/export-page && node packages/recorder/native/build-macos.mjs apps/cli/dist",
    "cli:install": "pnpm cli:build && node apps/cli/scripts/install.mjs",
    "cli:uninstall": "node apps/cli/scripts/install.mjs --uninstall",
    "cli:check": "pnpm cli:build && vitest run --mode cli apps/cli/test/electron.check.test.ts",
```

with:

```json
    "test:watch": "vitest",
    "engine:electron": "vite build --config packages/engine/electron/vite.config.ts && electron packages/engine/electron/main.mjs",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json && tsc -p packages/recorder/tsconfig.json && tsc -p packages/core/tsconfig.json && tsc -p apps/cli/tsconfig.json && tsc -p apps/desktop/tsconfig.json && tsc -p skill/tsconfig.json",
    "export:build": "vite build --config packages/export/electron/vite.main.config.ts && vite build --config packages/export/electron/vite.page.config.ts && node packages/motion-kit/scripts/copy.mjs packages/export/dist/motion-kit",
    "export:check": "pnpm export:build && electron packages/export/dist/check.mjs",
    "recorder:real": "vitest run --mode real --silent=false packages/recorder/test/real.test.ts",
    "cli:build": "vite build --config apps/cli/vite.config.ts && vite build --config packages/export/electron/vite.page.config.ts --outDir ../../../apps/cli/dist/export-page && node packages/recorder/native/build-macos.mjs apps/cli/dist && node packages/motion-kit/scripts/copy.mjs apps/cli/dist/motion-kit",
    "cli:install": "pnpm cli:build && node apps/cli/scripts/install.mjs",
    "cli:uninstall": "node apps/cli/scripts/install.mjs --uninstall",
    "cli:check": "pnpm cli:build && vitest run --mode cli apps/cli/test/electron.check.test.ts",
```

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run --project node packages/motion-kit`
Expected: PASS.

Run: `node packages/motion-kit/scripts/copy.mjs "$TEMP/motion-kit-try"`
Expected: `motion kit in …`, a folder of about 14 MB with `three/`, `lottie/`, `fonts/`, `templates/`, `licenses/`, `motion.js`.

- [ ] **Step 7: Commit**

```bash
git add packages/motion-kit package.json tsconfig.node.json pnpm-lock.yaml
git commit -m "motion-kit: Three.js, lottie-web, display fonts, Cuttle's helpers and six templates, copied next to each bundle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: What a page knows

**Files:**
- Create: `packages/export/src/motion/{take,params}.ts`, `packages/export/test/{motion-take,motion-params}.test.ts`
- Modify: `packages/export/src/motion/{runtime,init}.ts`, `packages/export/test/{motion-init.test,motion-runtime.browser.test}.ts`

- [ ] **Step 1: Write the failing tests**

`packages/export/test/motion-take.test.ts`:

```ts
import { parseProject, type InputEvent } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { CURSOR_PATH_FPS, takeData } from '../src/motion/take';

function project(input: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

const SCREEN = { width: 2560, height: 1440 };

describe('the take as a motion page sees it', () => {
  const p = project({
    look: { cursor: { smoothing: 0 } },
    scenes: [
      { type: 'motion', src: 'intro.html', duration: 2 },
      { type: 'clip', from: 10, to: 20 },
      { type: 'clip', from: 20, to: 60, speed: 4 },
    ],
    cuts: [{ from: 14, to: 15 }],
    zooms: [
      { at: 12, duration: 3, rect: [0, 0, 1280, 720], label: 'Answer' },
      { at: 30, duration: 3, rect: [0, 0, 1280, 720], enabled: false },
    ],
    masks: [{ from: 11, to: 13, rect: [10, 10, 100, 20] }],
    captions: { fixes: [{ at: 12, end: 12.5, text: 'Cuttle' }] },
  });
  const events: InputEvent[] = [
    { t: 11, type: 'move', x: 100, y: 100 },
    { t: 11.01, type: 'move', x: 101, y: 100 },
    { t: 11.05, type: 'move', x: 110, y: 100 },
    { t: 12, type: 'click', x: 640, y: 360, button: 'left' },
    { t: 12.5, type: 'keys', count: 4 },
    { t: 13, type: 'scroll', x: 640, y: 360, dx: 0, dy: -120 },
    { t: 13.2, type: 'shape', shape: 'text' },
  ];
  const take = takeData(p, { events, words: [{ t: 12.1, end: 12.4, text: 'Kattel' }, { t: 13, end: 13.3, text: 'records' }], markers: [{ t: 11.5, kind: 'prompt' }] }, SCREEN, { from: 11, to: 16 });

  it('keeps the input a page acts on: clicks, key counts, scrolls, and moves at most 30 a second', () => {
    expect(take.events).toEqual([
      { t: 11, type: 'move', x: 100, y: 100 },
      { t: 11.05, type: 'move', x: 110, y: 100 },
      { t: 12, type: 'click', x: 640, y: 360, button: 'left' },
      { t: 12.5, type: 'keys', count: 4 },
      { t: 13, type: 'scroll', x: 640, y: 360, dx: 0, dy: -120 },
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

  it('knows where each piece of a clip plays in the video, after the motion scene and around the cut', () => {
    expect(take.clips).toEqual([
      { start: 2, end: 6, from: 10, to: 14, speed: 1 },
      { start: 6, end: 11, from: 15, to: 20, speed: 1 },
      { start: 11, end: 21, from: 20, to: 60, speed: 4 },
    ]);
  });

  it('samples the pointer as the video draws it, from its first move to its last', () => {
    expect(take.cursor).toMatchObject({ fps: CURSOR_PATH_FPS, start: 11 });
    const points = take.cursor!.points;
    // 11 s to 12 s (the click is the last place) at 30 a second, x and y each
    expect(points.length).toBe(2 * 31);
    expect(points.slice(0, 2)).toEqual([100, 100]);
    expect(points.slice(-2)).toEqual([640, 360]);
  });

  it('has no pointer path without moves', () => {
    expect(takeData(p, { events: [], words: [], markers: [] }, SCREEN, null).cursor).toBeNull();
  });
});
```

`packages/export/test/motion-params.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { declaredParams, paramDefaults } from '../src/motion/params';

const page = (json: string) => `<!doctype html><title>x</title><script type="application/json" id="cuttle-params">${json}</script><h1>x</h1>`;

describe('the params a page declares', () => {
  it("reads each kind with its default, a select's choices and a number's range", () => {
    const { params, issues } = declaredParams(
      page(`[
        { "name": "title", "label": "Title", "type": "text", "default": "Hello" },
        { "name": "accent", "type": "color", "default": "#d97757" },
        { "name": "size", "label": "Size", "type": "number", "default": 1, "min": 0.5, "max": 2 },
        { "name": "logo", "label": "Logo", "type": "image", "default": null },
        { "name": "dark", "label": "Dark", "type": "bool", "default": true },
        { "name": "side", "label": "Side", "type": "select", "default": "left", "options": ["left", "right"] }
      ]`),
    );
    expect(issues).toEqual([]);
    expect(params).toEqual([
      { name: 'title', label: 'Title', type: 'text', default: 'Hello' },
      { name: 'accent', label: 'accent', type: 'color', default: '#d97757' },
      { name: 'size', label: 'Size', type: 'number', default: 1, min: 0.5, max: 2 },
      { name: 'logo', label: 'Logo', type: 'image', default: null },
      { name: 'dark', label: 'Dark', type: 'bool', default: true },
      { name: 'side', label: 'Side', type: 'select', default: 'left', options: ['left', 'right'] },
    ]);
    expect(paramDefaults(params)).toEqual({ title: 'Hello', accent: '#d97757', size: 1, logo: null, dark: true, side: 'left' });
  });

  it('finds none in a page without a declaration', () => {
    expect(declaredParams('<!doctype html><h1>Hi</h1>')).toEqual({ params: [], issues: [] });
  });

  it('names what is wrong and keeps the params that are right', () => {
    const { params, issues } = declaredParams(
      page(`[
        { "name": "ok", "type": "text", "default": "x" },
        { "name": "bad name", "type": "text" },
        { "name": "n", "type": "number", "default": "1" },
        { "name": "s", "type": "select", "default": "a" },
        { "name": "ok", "type": "bool", "default": false },
        { "name": "w", "type": "weird" }
      ]`),
    );
    expect(params.map((param) => param.name)).toEqual(['ok']);
    expect(issues).toEqual([
      'cuttle-params[1].name must be a name of letters, digits, - or _',
      'cuttle-params[2].default does not fit its type number',
      'cuttle-params[3].options must list the choices of a select',
      'cuttle-params[4].name "ok" is declared twice',
      'cuttle-params[5].type must be one of text, color, number, image, bool, select',
    ]);
    expect(declaredParams(page('{ "name": "x" }')).issues).toEqual(['cuttle-params must be a list of params']);
    expect(declaredParams(page('[oops')).issues[0]).toMatch(/^cuttle-params is not JSON/);
  });
});
```

In `packages/export/test/motion-init.test.ts`, replace:

```ts
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

with:

```ts
    expect(Number.isInteger(motionSeed('o1')) && motionSeed('o1') >= 0 && motionSeed('o1') < 2 ** 32).toBe(true);
  });

  it('where the showing starts and how long it lasts, the output, their params over the page\'s defaults, the kit\'s fonts, the take, and a seed from their id (else their place)', () => {
    const p = project({ output: { width: 1080, height: 1920, fps: 60 }, scenes: [{ type: 'motion', src: 'a.html', duration: 2, params: { title: 'Hi' } }] });
    const scene = p.scenes[0]!;
    if (scene.type !== 'motion') throw new Error('not a motion scene');
    const fonts = [{ family: 'Inter', weight: '400', style: 'normal', src: 'cuttle-motion://kit/fonts/inter-latin-400-normal.woff2' }];
    const context = { take: null, fonts, defaults: { title: 'Hello', color: '#ffffff' } };
    expect(motionInit(p, scene, 'scenes[0]', { start: 1.5, duration: 2 }, context)).toEqual({
      duration: 2,
      start: 1.5,
      fps: 60,
      width: 1080,
      height: 1920,
      format: '9:16',
      params: { title: 'Hi', color: '#ffffff' },
      theme: motionTheme(p),
      seed: motionSeed('scenes[0]'),
      fonts,
      take: null,
    });
    expect(motionInit(p, { ...scene, id: 's7' }, 'scenes[0]', { start: 0, duration: 2 }, context).seed).toBe(motionSeed('s7'));
  });
});
```

In `packages/export/test/motion-runtime.browser.test.ts`, replace:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { motionRuntime, type CuttleApi, type MotionInit } from '../src/motion/runtime';

const INIT: MotionInit = {
  duration: 2,
  fps: 30,
  width: 320,
  height: 180,
```

with:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { motionRuntime, type CuttleApi, type MotionInit, type TakeData } from '../src/motion/runtime';

const INIT: MotionInit = {
  duration: 2,
  start: 0,
  fps: 30,
  width: 320,
  height: 180,
```

In the same file, replace:

```ts
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
```

with:

```ts
  params: { title: 'Hi' },
  theme: { '--cuttle-accent': '#d97757' },
  seed: 7,
  fonts: [{ family: 'Inter', weight: '700', style: 'normal', src: 'cuttle-motion://kit/fonts/inter-latin-700-normal.woff2' }],
  take: null,
};

type Page = Window &
  typeof globalThis & {
    cuttle: CuttleApi;
    __cuttleDraw(ms: number, view?: import('../src/motion/runtime').MotionView): Promise<number>;
    __cuttleReady(): Promise<void>;
    __cuttleErrors: string[];
    seen: unknown[];
```

In the same file, replace:

```ts
    expect(win.seen).toEqual([0, 1 / 30]);
  });

  it('seeds Math.random: the same seed gives the same numbers', () => {
    const numbers = (seed: number) => page('', 'seen.push(Math.random(), Math.random(), Math.random())', { ...INIT, seed }).seen;
    const first = numbers(7);
```

with:

```ts
    expect(win.seen).toEqual([0, 1 / 30]);
  });

  it('declares the kit\'s fonts before the page is parsed', () => {
    const win = page('', '');
    const faces = win.document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules]).filter((rule) => rule.constructor.name === 'CSSFontFaceRule');
    expect(faces.map((rule) => rule.cssText)).toEqual([expect.stringMatching(/font-family: Inter; font-weight: 700;.*inter-latin-700-normal\.woff2/)]);
  });

  it('gives the page the take: where a moment plays in the video, the pointer, and where a point of the screen is in this frame', async () => {
    const take: TakeData = {
      screen: { width: 2000, height: 1000 },
      events: [
        { t: 12, type: 'click', x: 500, y: 250, button: 'left' },
        { t: 12.5, type: 'keys', count: 3 },
      ],
      words: [{ t: 12.2, end: 12.6, text: 'Hello' }],
      markers: [{ t: 11, kind: 'prompt' }],
      zooms: [],
      masks: [],
      clips: [
        { start: 2, end: 6, from: 10, to: 14, speed: 1 },
        { start: 6, end: 11, from: 20, to: 40, speed: 4 },
      ],
      cursor: { fps: 10, start: 10, points: [0, 0, 10, 20, 20, 40] },
      window: { from: 11, to: 16 },
    };
    const win = page('', '', { ...INIT, start: 3, take });
    const { take: api } = win.cuttle;
    expect(api.clicks).toEqual([take.events[0]]);
    expect([api.words, api.markers, api.window]).toEqual([take.words, take.markers, take.window]);
    expect([api.toOutput(12), api.toOutput(24), api.toOutput(15)]).toEqual([4, 7, null]);
    expect([api.toSource(5), api.toSource(8), api.toSource(1)]).toEqual([13, 28, null]);
    const between = api.cursorAt(10.05)!;
    expect([between.x, between.y].map((value) => Math.round(value * 1e6) / 1e6)).toEqual([5, 10]);
    expect([api.cursorAt(9), api.cursorAt(99)]).toEqual([{ x: 0, y: 0 }, { x: 20, y: 40 }]);
    // before a frame with a view (and in a scene) nothing of the screen is in the frame
    expect([api.toScreen(500, 250), api.cursor, api.source]).toEqual([null, null, null]);
    await win.__cuttleDraw(500, { source: 12.5, zoom: [0, 0, 1000, 500], content: [100, 50, 800, 400], cursor: { x: 500, y: 250 } });
    expect(win.cuttle.videoTime).toBe(3.5);
    expect(api.source).toBe(12.5);
    expect(api.toScreen(500, 250)).toEqual({ x: 500, y: 250, inside: true });
    expect(api.toScreen(1500, 250)).toEqual({ x: 1300, y: 250, inside: false });
    expect(api.cursor).toEqual({ x: 500, y: 250, inside: true });
  });

  it('seeds Math.random: the same seed gives the same numbers', () => {
    const numbers = (seed: number) => page('', 'seen.push(Math.random(), Math.random(), Math.random())', { ...INIT, seed }).seen;
    const first = numbers(7);
```

Run: `pnpm exec vitest run --project node packages/export/test/motion-take.test.ts packages/export/test/motion-params.test.ts`
Expected: FAIL: `../src/motion/take` and `../src/motion/params` do not exist.

- [ ] **Step 2: The take, the params, the view and the fonts**

`packages/export/src/motion/take.ts`:

```ts
import type { CuttleProject, InputEvent, Marker, TranscriptWord } from '@cuttle/project';
import { applyCaptionFixes, createCursorTrack, cursorAt, sceneSpans } from '@cuttle/timeline';
import type { TakeData } from './runtime';

/** The pointer's path is sampled this often (source seconds); the page interpolates between. */
export const CURSOR_PATH_FPS = 30;
/** Moves closer together than this are left out of the page's events. */
const MOVE_GAP = 1 / 30;

/** What the take holds, as read from its files. */
export interface TakeInputs {
  events: readonly InputEvent[];
  words: readonly TranscriptWord[];
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
  let lastMove = -Infinity;
  for (const event of [...inputs.events].sort((a, b) => a.t - b.t)) {
    if (event.type === 'click') events.push({ t: event.t, type: 'click', x: event.x, y: event.y, button: event.button });
    else if (event.type === 'keys') events.push({ t: event.t, type: 'keys', count: event.count });
    else if (event.type === 'scroll') events.push({ t: event.t, type: 'scroll', x: event.x, y: event.y, dx: event.dx, dy: event.dy });
    else if (event.type === 'move' && event.t - lastMove >= MOVE_GAP - 1e-9) {
      events.push({ t: event.t, type: 'move', x: event.x, y: event.y });
      lastMove = event.t;
    }
  }
  const clips = sceneSpans(project.scenes, project.cuts).flatMap((span) =>
    span.scene.type === 'clip' ? [{ start: milli(span.start), end: milli(span.end), from: span.scene.from, to: span.scene.to, speed: span.scene.speed }] : [],
  );
  return {
    screen: { width: screen.width, height: screen.height },
    events,
    words: applyCaptionFixes(inputs.words, project.captions.fixes).map(({ t, end, text }) => ({ t, end, text })),
    markers: inputs.markers.map(({ t, kind, label }) => ({ t, kind, ...(label !== undefined && { label }) })),
    zooms: project.zooms.filter((zoom) => zoom.enabled).map(({ at, duration, rect, label }) => ({ at, duration, rect, ...(label !== undefined && { label }) })),
    masks: project.masks.filter((mask) => mask.enabled).map(({ from, to, rect }) => ({ from, to, rect })),
    clips,
    cursor: cursorPath(inputs.events, project.look.cursor.smoothing),
    window,
  };
}

/** The pointer every 1/`CURSOR_PATH_FPS` s from its first move to its last, smoothed as the video draws it. */
function cursorPath(events: readonly InputEvent[], smoothing: number): TakeData['cursor'] {
  const track = createCursorTrack(events);
  if (track.moves.length === 0) return null;
  const start = track.moves[0]!.t;
  const end = track.moves.at(-1)!.t;
  const points: number[] = [];
  for (let i = 0; start + i / CURSOR_PATH_FPS <= end + 1e-9; i++) {
    const at = cursorAt(track, start + i / CURSOR_PATH_FPS, 1, smoothing);
    points.push(tenth(at!.x), tenth(at!.y));
  }
  if (points.length === 2) points.push(points[0]!, points[1]!);
  return { fps: CURSOR_PATH_FPS, start, points };
}
```

`packages/export/src/motion/params.ts`:

```ts
/** The kinds of value a page's param takes (the editor shows a field of that kind). */
export const PARAM_TYPES = ['text', 'color', 'number', 'image', 'bool', 'select'] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

/** A param a page declares, with its default. */
export interface ParamDeclaration {
  name: string;
  label: string;
  type: ParamType;
  default: string | number | boolean | null;
  /** A `select`'s choices. */
  options?: string[];
  /** A `number`'s range. */
  min?: number;
  max?: number;
}

const DECLARATION = /<script\b[^>]*\bid\s*=\s*["']cuttle-params["'][^>]*>([\s\S]*?)<\/script>/i;
const NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

/**
 * The params a page declares in `<script type="application/json" id="cuttle-params">[…]</script>`:
 * `[{ "name", "label", "type", "default", "options", "min", "max" }]`. A page without one declares
 * none. Each problem is named; the params that are right are kept.
 */
export function declaredParams(html: string): { params: ParamDeclaration[]; issues: string[] } {
  const block = DECLARATION.exec(html)?.[1];
  if (block === undefined) return { params: [], issues: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch (error) {
    return { params: [], issues: [`cuttle-params is not JSON: ${(error as Error).message}`] };
  }
  if (!Array.isArray(raw)) return { params: [], issues: ['cuttle-params must be a list of params'] };
  const params: ParamDeclaration[] = [];
  const issues: string[] = [];
  raw.forEach((entry: unknown, index) => {
    const where = `cuttle-params[${index}]`;
    if (typeof entry !== 'object' || entry === null) return void issues.push(`${where} is not an object`);
    const { name, label, type, options, min, max } = entry as Record<string, unknown>;
    const value = (entry as Record<string, unknown>).default;
    if (typeof name !== 'string' || !NAME.test(name)) return void issues.push(`${where}.name must be a name of letters, digits, - or _`);
    if (params.some((param) => param.name === name)) return void issues.push(`${where}.name "${name}" is declared twice`);
    if (!(PARAM_TYPES as readonly unknown[]).includes(type)) return void issues.push(`${where}.type must be one of ${PARAM_TYPES.join(', ')}`);
    const kind = type as ParamType;
    const fits =
      value === null ||
      (kind === 'number' ? typeof value === 'number' && Number.isFinite(value) : kind === 'bool' ? typeof value === 'boolean' : typeof value === 'string');
    if (value !== undefined && !fits) return void issues.push(`${where}.default does not fit its type ${kind}`);
    if (kind === 'select' && !(Array.isArray(options) && options.length > 0 && options.every((option) => typeof option === 'string'))) {
      return void issues.push(`${where}.options must list the choices of a select`);
    }
    params.push({
      name,
      label: typeof label === 'string' && label.trim() ? label : name,
      type: kind,
      default: (value as ParamDeclaration['default'] | undefined) ?? null,
      ...(kind === 'select' && { options: options as string[] }),
      ...(typeof min === 'number' && { min }),
      ...(typeof max === 'number' && { max }),
    });
  });
  return { params, issues };
}

/** The defaults of declared params, by name. */
export function paramDefaults(params: readonly ParamDeclaration[]): Record<string, ParamDeclaration['default']> {
  return Object.fromEntries(params.map((param) => [param.name, param.default]));
}
```

In `packages/export/src/motion/runtime.ts`, replace:

```ts
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
```

with:

```ts
// CSS animation, transition and Web Animation follow the frame being drawn, never the wall clock.
// `__cuttleDraw` moves it to a frame's time and answers once the browser has drawn the page as it
// is then; a marker pixel below the page names the frame, so the renderer knows which paint shows
// it. And it gives the page `window.cuttle`: its time, size, params, theme, a seeded random, and
// the take: what happened in the recording and when, and where its pixels are in this frame.

type Rect = [x: number, y: number, width: number, height: number];

/** What the take holds, in source seconds and source px (`cuttle.take`). */
export interface TakeData {
  /** The screen recording's size. */
  screen: { width: number; height: number };
  /** Clicks (`x`, `y`, `button`), key counts (`count` per half second), scrolls and the pointer's moves (at most 30 a second). */
  events: (
    | { t: number; type: 'click'; x: number; y: number; button: string }
    | { t: number; type: 'keys'; count: number }
    | { t: number; type: 'scroll'; x: number; y: number; dx: number; dy: number }
    | { t: number; type: 'move'; x: number; y: number }
  )[];
  /** The spoken words (the transcript, with the project's fixes). */
  words: { t: number; end: number; text: string }[];
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
  source: number | null;
  /** The part of the screen recording in view (source px), and the rect of the output it fills. */
  zoom: Rect | null;
  content: Rect | null;
  /** The pointer where the video draws it (source px), or null. */
  cursor: { x: number; y: number } | null;
}

/** What the renderer tells the page. */
export interface MotionInit {
  /** Seconds the item lasts. */
  duration: number;
  /** The output second where this showing of it starts. */
  start: number;
  fps: number;
  width: number;
  height: number;
```

In the same file, replace:

```ts
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
```

with:

```ts
  theme: Record<string, string>;
  /** Seeds `Math.random`, so the item looks the same in every render. */
  seed: number;
  /** Fonts every page has (the kit's): family, weight (a range for a variable font), style, width range and URL. */
  fonts: { family: string; weight: string; style: string; stretch?: string; src: string }[];
  take: TakeData | null;
}

/** A point of the screen recording in the frame: output px, and whether the frame shows it. */
export interface ScreenPoint {
  x: number;
  y: number;
  inside: boolean;
}

/** `cuttle.take`: the take's data, and where things are in the video and in this frame. */
export interface CuttleTake extends Omit<TakeData, 'cursor'> {
  /** Just the clicks of `events`. */
  readonly clicks: Extract<TakeData['events'][number], { type: 'click' }>[];
  /** The output second where the video first shows source second `source`, or null. */
  toOutput(source: number): number | null;
  /** The source second the video shows at output second `output`, or null (not on a clip). */
  toSource(output: number): number | null;
  /** The pointer at source second `source` (source px), as the video draws it, or null. */
  cursorAt(source: number): { x: number; y: number } | null;
  /** A point of the screen recording (source px) in this frame (output px), with the window, crop and zoom; null in a scene. */
  toScreen(x: number, y: number): ScreenPoint | null;
  /** The source second shown under the overlay now; null in a scene. */
  readonly source: number | null;
  /** The pointer in this frame (output px), or null. */
  readonly cursor: ScreenPoint | null;
  /** This frame's view of the take. */
  readonly view: MotionView;
}

/** The page's `window.cuttle`. */
export interface CuttleApi {
  /** Seconds into this item. */
  readonly time: number;
  /** Seconds into the whole video. */
  readonly videoTime: number;
  readonly duration: number;
  readonly fps: number;
  readonly size: { width: number; height: number };
```

In the same file, replace:

```ts
  onFrame(draw: (seconds: number) => void): void;
  /** Holds the first frame until `promise` settles (fonts, images, models). */
  ready(promise: Promise<unknown>): void;
}

export function motionRuntime(init: MotionInit): void {
```

with:

```ts
  onFrame(draw: (seconds: number) => void): void;
  /** Holds the first frame until `promise` settles (fonts, images, models). */
  ready(promise: Promise<unknown>): void;
  /** The take (empty lists when the item has no take). */
  readonly take: CuttleTake;
}

export function motionRuntime(init: MotionInit): void {
```

In the same file, replace:

```ts
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
```

with:

```ts
    sight();
  };

  // the theme, as CSS variables on the root, and the kit's fonts (a constructed sheet works before the page is parsed)
  const sheet = new CSSStyleSheet();
  const faces = init.fonts.map(
    (font) =>
      `@font-face { font-family: "${font.family}"; font-weight: ${font.weight}; font-style: ${font.style};${font.stretch ? ` font-stretch: ${font.stretch};` : ''} font-display: block; src: url("${font.src}") format("woff2"); }`,
  );
  sheet.replaceSync([...faces, `:root { ${Object.entries(init.theme).map(([name, value]) => `${name}: ${value};`).join(' ')} }`].join('\n'));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  // the take
  const data: TakeData = init.take ?? { screen: { width: init.width, height: init.height }, events: [], words: [], markers: [], zooms: [], masks: [], clips: [], cursor: null, window: null };
  let view: MotionView = { source: null, zoom: null, content: null, cursor: null };
  const toScreen = (x: number, y: number): ScreenPoint | null => {
    const { zoom, content } = view;
    if (!zoom || !content) return null;
    const sx = content[0] + ((x - zoom[0]) * content[2]) / zoom[2];
    const sy = content[1] + ((y - zoom[1]) * content[3]) / zoom[3];
    return { x: sx, y: sy, inside: sx >= content[0] && sx <= content[0] + content[2] && sy >= content[1] && sy <= content[1] + content[3] };
  };
  const { cursor: path, ...takeFields } = data;
  const take: CuttleTake = {
    ...takeFields,
    clicks: data.events.filter((event): event is Extract<TakeData['events'][number], { type: 'click' }> => event.type === 'click'),
    toOutput(source) {
      for (const clip of data.clips) if (source >= clip.from - 1e-9 && source < clip.to) return clip.start + (source - clip.from) / clip.speed;
      return null;
    },
    toSource(output) {
      for (const clip of data.clips) if (output >= clip.start - 1e-9 && output < clip.end) return clip.from + (output - clip.start) * clip.speed;
      return null;
    },
    cursorAt(source) {
      if (!path || path.points.length < 2) return null;
      const last = path.points.length / 2 - 1;
      const at = Math.min(Math.max((source - path.start) * path.fps, 0), last);
      const i = Math.floor(at);
      const j = Math.min(i + 1, last);
      const f = at - i;
      const p = path.points;
      return { x: p[2 * i]! + (p[2 * j]! - p[2 * i]!) * f, y: p[2 * i + 1]! + (p[2 * j + 1]! - p[2 * i + 1]!) * f };
    },
    toScreen,
    get source() {
      return view.source;
    },
    get cursor() {
      return view.cursor ? toScreen(view.cursor.x, view.cursor.y) : null;
    },
    get view() {
      return view;
    },
  };

  const api: CuttleApi = {
    get time() {
      return now / 1000;
    },
    get videoTime() {
      return init.start + now / 1000;
    },
    duration: init.duration,
    fps: init.fps,
    size: { width: init.width, height: init.height },
```

In the same file, replace:

```ts
    theme: init.theme,
    onFrame: (draw) => void drawers.push(draw),
    ready: (promise) => void holds.push(Promise.resolve(promise).catch(note)),
  };
  page.cuttle = api;
```

with:

```ts
    theme: init.theme,
    onFrame: (draw) => void drawers.push(draw),
    ready: (promise) => void holds.push(Promise.resolve(promise).catch(note)),
    take,
  };
  page.cuttle = api;
```

In the same file, replace:

```ts
  let frame = 0;
  /**
   * Moves the clock to `ms` (never back) and draws: due timers in order, one animation frame, every
   * animation to its time. Answers with the draw's number, which the marker shows.
   */
  page.__cuttleDraw = (ms: number): Promise<number> => {
    mark(++frame);
    sight();
    const target = Math.max(now, ms);
```

with:

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
```

In `packages/export/src/motion/init.ts`, replace:

```ts
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

with:

```ts
  return hash;
}

/** What a page has besides its item: the take, the kit's fonts, and the params its page declares with their defaults. */
export interface MotionContext {
  take: MotionInit['take'];
  fonts: MotionInit['fonts'];
  defaults: Record<string, unknown>;
}

/**
 * What a motion item's page is told for one showing of it: `start` is the output second where it starts
 * and `duration` how long it lasts. The item's params win over the page's defaults.
 */
export function motionInit(
  project: CuttleProject,
  item: MotionScene | MotionOverlay,
  name: string,
  showing: { start: number; duration: number },
  context: MotionContext,
): MotionInit {
  const { width, height, fps } = project.output;
  return {
    duration: showing.duration,
    start: showing.start,
    fps,
    width,
    height,
    format: formatName(project.output),
    params: { ...context.defaults, ...item.params },
    theme: motionTheme(project),
    seed: motionSeed(item.id ?? name),
    fonts: context.fonts,
    take: context.take,
  };
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/export/test/motion-take.test.ts packages/export/test/motion-params.test.ts packages/export/test/motion-init.test.ts`
Expected: PASS.

Run: `pnpm exec vitest run --project browser packages/export/test/motion-runtime.browser.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 4: Commit**

```bash
git add packages/export/src/motion packages/export/test
git commit -m "export: the take as a page sees it, where it is in each frame, the kit's fonts and the page's params

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rendering with the take, motion blur, and videos without a recording

**Files:**
- Modify: `packages/project/src/schema.ts`, `packages/project/test/schema.test.ts`, `packages/export/test/main/audio-ffmpeg.test.ts`, `packages/export/package.json`, `packages/export/src/job.ts`, `packages/export/src/main/{motion,motion-host,sources,export,stills}.ts`, `packages/export/src/page/{scene-sources,run}.ts`

- [ ] **Step 1: Write the failing test**

In `packages/project/test/schema.test.ts`, replace:

```ts
    expect(p.overlays[0]).toEqual({ id: 'o1', src: 'motion/callouts/index.html', at: 4.2, duration: 6, params: {}, network: false, enabled: true });
  });

  it('refuses a page without a path, a length of zero, a param that is a list and an id used elsewhere', () => {
    expect(pathsOf({ ...minimal, scenes: [{ type: 'motion', src: '', duration: 2 }] })).toEqual(['scenes.0.src']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'motion', src: 'a.html', duration: 0 }] })).toEqual(['scenes.0.duration']);
```

with:

```ts
    expect(p.overlays[0]).toEqual({ id: 'o1', src: 'motion/callouts/index.html', at: 4.2, duration: 6, params: {}, network: false, enabled: true });
  });

  it('reads motion blur with its defaults, and refuses too few samples and a shutter of zero', () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [
        { type: 'motion', src: 'a.html', duration: 1, motionBlur: {} },
        { type: 'motion', src: 'b.html', duration: 1, motionBlur: { samples: 16, shutter: 1 } },
      ],
      overlays: [{ src: 'c.html', at: 0, duration: 1, motionBlur: { samples: 4 } }],
    });
    expect(p.scenes.map((scene) => (scene.type === 'motion' ? scene.motionBlur : undefined))).toEqual([
      { samples: 8, shutter: 0.5 },
      { samples: 16, shutter: 1 },
    ]);
    expect(p.overlays[0]!.motionBlur).toEqual({ samples: 4, shutter: 0.5 });
    expect(pathsOf({ ...minimal, scenes: [{ type: 'motion', src: 'a.html', duration: 1, motionBlur: { samples: 1 } }] })).toEqual(['scenes.0.motionBlur.samples']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'motion', src: 'a.html', duration: 1, motionBlur: { shutter: 0 } }] })).toEqual(['scenes.0.motionBlur.shutter']);
  });

  it('refuses a page without a path, a length of zero, a param that is a list and an id used elsewhere', () => {
    expect(pathsOf({ ...minimal, scenes: [{ type: 'motion', src: '', duration: 2 }] })).toEqual(['scenes.0.src']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'motion', src: 'a.html', duration: 0 }] })).toEqual(['scenes.0.duration']);
```

Run: `pnpm exec vitest run --project node packages/project/test/schema.test.ts`
Expected: FAIL: `motionBlur` is an unknown key.

The audio test that runs ffmpeg eight times gets time for a loaded machine:

In `packages/export/test/main/audio-ffmpeg.test.ts`, replace:

```ts
      for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(cut[i]! - whole[i]!));
      expect(worst, `speed ${speed}`).toBeLessThan(1e-4);
    }
  });

  it('mixes the typing sounds in where a key was typed: without a mic, and over one at its own level', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-typing-mix-'));
```

with:

```ts
      for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(cut[i]! - whole[i]!));
      expect(worst, `speed ${speed}`).toBeLessThan(1e-4);
    }
    // eight ffmpeg runs one after another: under a full parallel test run they take several seconds
  }, 30_000);

  it('mixes the typing sounds in where a key was typed: without a mic, and over one at its own level', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-typing-mix-'));
```

- [ ] **Step 2: Motion blur in the format**

In `packages/project/src/schema.ts`, replace:

```ts
  params: z.record(z.string(), ParamValue).default({}),
  /** Let the page reach https: (off: only the project's files). */
  network: z.boolean().default(false),
};

/** A page Claude or the person wrote, rendered frame by frame as a scene (an intro, an end card, a 3D shot). */
```

with:

```ts
  params: z.record(z.string(), ParamValue).default({}),
  /** Let the page reach https: (off: only the project's files). */
  network: z.boolean().default(false),
  /**
   * Motion blur, as a camera's: each frame is the average of `samples` moments while the shutter is
   * open, `shutter` a share of the frame (0.5 is film's 180°). Off without it.
   */
  motionBlur: z
    .strictObject({
      samples: z.number().int().min(2).max(32).default(8),
      shutter: z.number().positive().max(1).default(0.5),
    })
    .optional(),
};

/** A page Claude or the person wrote, rendered frame by frame as a scene (an intro, an end card, a 3D shot). */
```

- [ ] **Step 3: The main process: the kit, the take, motion blur, no recording needed**

In `packages/export/package.json`, replace:

```json
  },
  "dependencies": {
    "@cuttle/engine": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/timeline": "workspace:*",
    "mediabunny": "1.61.0"
```

with:

```json
  },
  "dependencies": {
    "@cuttle/engine": "workspace:*",
    "@cuttle/motion-kit": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/timeline": "workspace:*",
    "mediabunny": "1.61.0"
```

```bash
pnpm install
```

In `packages/export/src/job.ts`, replace:

```ts
import type { CuttleProject, InputEvent, TranscriptWord } from '@cuttle/project';

/**
 * Contract between the main process and the export page. Pure types and constants: both sides
```

with:

```ts
import type { CuttleProject, InputEvent, TranscriptWord } from '@cuttle/project';
import type { MotionView } from './motion/runtime';

/**
 * Contract between the main process and the export page. Pure types and constants: both sides
```

In the same file, replace:

```ts
  index: number;
  /** Frame n is n / fps seconds into the showing. */
  frame: number;
  /** How long the showing lasts, in output seconds. */
  duration: number;
}

/** Everything the page needs for one export. Paths are absolute; the page may read only these files. */
```

with:

```ts
  index: number;
  /** Frame n is n / fps seconds into the showing. */
  frame: number;
  /** Where the showing starts in the video, and how long it lasts (output seconds). */
  start: number;
  duration: number;
  /** The screen recording's size (source px). */
  screen: { width: number; height: number };
  /** An overlay's frame: where the clip under it shows the take. */
  view?: MotionView;
}

/** Everything the page needs for one export. Paths are absolute; the page may read only these files. */
```

In the same file, replace:

```ts
  kind: 'video';
  /** Output size already set to the export format. */
  project: CuttleProject;
  screen: string;
  /** Present when the webcam bubble is on. `offset`: seconds the webcam started after the screen. */
  webcam?: { path: string; offset: number };
  /** Present when the cursor is on and the project has events. */
```

with:

```ts
  kind: 'video';
  /** Output size already set to the export format. */
  project: CuttleProject;
  /** The screen recording; absent in a project without clips. */
  screen?: string;
  /** Present when the webcam bubble is on. `offset`: seconds the webcam started after the screen. */
  webcam?: { path: string; offset: number };
  /** Present when the cursor is on and the project has events. */
```

In `packages/export/src/main/motion.ts`, replace:

```ts
// a hidden offscreen window, sandboxed, that reaches only the project's files (`cuttle-motion:`)
// and no network; the page's clock is virtual (`motionRuntime`, injected before its scripts), and
// each frame is the paint whose marker pixel names it. Frames come out as premultiplied RGBA, the
// page's transparency kept, the same on every render.
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { BrowserWindow, session, type NativeImage, type Session } from 'electron';
import { motionRuntime, type MotionInit } from '../motion/runtime';

export const MOTION_SCHEME = 'cuttle-motion';
```

with:

```ts
// a hidden offscreen window, sandboxed, that reaches only the project's files (`cuttle-motion:`)
// and no network; the page's clock is virtual (`motionRuntime`, injected before its scripts), and
// each frame is the paint whose marker pixel names it. Frames come out as premultiplied RGBA, the
// page's transparency kept, the same on every render. The motion kit (Three.js, lottie-web, fonts,
// Cuttle's helpers) is served at cuttle-motion://kit/, and every page of the project gets an
// import map for its bare names (`three`, `cuttle`).
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER, withImportMap } from '@cuttle/motion-kit';
import { BrowserWindow, session, type NativeImage, type Session } from 'electron';
import { motionRuntime, type MotionInit, type MotionView } from '../motion/runtime';

export const MOTION_SCHEME = 'cuttle-motion';
```

In the same file, replace:

```ts
  network?: boolean;
  frameTimeout?: number;
  loadTimeout?: number;
}

const TYPES: Record<string, string> = {
```

with:

```ts
  network?: boolean;
  frameTimeout?: number;
  loadTimeout?: number;
  /** The motion kit's folder (default: next to this bundle). */
  kitDir?: string;
  /** Motion blur: each frame the average of `samples` moments over `shutter` of a frame, centred on it. */
  motionBlur?: { samples: number; shutter: number };
}

/** The motion kit next to the bundle that contains this code (each build copies it there). */
export function defaultKitDir(): string {
  return fileURLToPath(new URL(`./${KIT_FOLDER}/`, import.meta.url));
}

const TYPES: Record<string, string> = {
```

In the same file, replace:

```ts

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
```

with:

```ts

let sessions = 0;
/**
 * Sessions no page uses, by project folder, network switch and kit. Electron keeps every session for the
 * app's life, so the app's many exports take them from here, emptied, instead of making new ones.
 */
const idle = new Map<string, Session[]>();
const poolKey = (root: string, network: boolean, kitDir: string) => `${resolve(root)}|${network}|${resolve(kitDir)}`;

/** A session of its own for one page: its files from `root` and the kit's, no permissions, no network unless asked. */
function takeSession(root: string, network: boolean, kitDir: string): Session {
  return idle.get(poolKey(root, network, kitDir))?.pop() ?? pageSession(root, network, kitDir);
}

/** A page is done with `ses`: what the page stored is wiped, and the next page may take it. */
function giveBack(ses: Session, root: string, network: boolean, kitDir: string): void {
  void ses
    .clearStorageData()
    .catch(() => {})
    .then(() => {
      const key = poolKey(root, network, kitDir);
      idle.set(key, [...(idle.get(key) ?? []), ses]);
    });
}

function pageSession(root: string, network: boolean, kitDir: string): Session {
  const ses = session.fromPartition(`cuttle-motion-${process.pid}-${++sessions}`, { cache: false });
  const bases: Record<string, string> = { project: resolve(root), kit: resolve(kitDir) };
  const policy = contentPolicy(network);
  ses.protocol.handle(MOTION_SCHEME, async (request) => {
    const url = new URL(request.url);
    const base = bases[url.host];
    const path = base === undefined ? undefined : resolve(base, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
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

In the same file, replace:

```ts
    });
  }

  static async open(options: MotionPageOptions): Promise<MotionPage> {
    const { width, height } = options.init;
    const ses = takeSession(options.root, options.network === true);
    const win = new BrowserWindow({
      show: false,
      // a few rows more than the page: the frame marker sits below it (Electron rounds small heights up)
```

with:

```ts
    });
  }

  private static kitOf(options: MotionPageOptions): string {
    return options.kitDir ?? defaultKitDir();
  }

  static async open(options: MotionPageOptions): Promise<MotionPage> {
    const { width, height } = options.init;
    const ses = takeSession(options.root, options.network === true, MotionPage.kitOf(options));
    const win = new BrowserWindow({
      show: false,
      // a few rows more than the page: the frame marker sits below it (Electron rounds small heights up)
```

In the same file, replace:

```ts
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
```

with:

```ts
    return bitmap[at + 2] === (draw & 255) && bitmap[at + 1] === ((draw >> 8) & 255) && bitmap[at] === 200;
  }

  /**
   * Frame `n` of the page: its clock moves to n / fps seconds (`view`: an overlay's view of the take),
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
    return frame;
  }

  /** The page drawn at `ms` on its clock, from the paint whose marker shows that draw. */
  private async paint(at: number, view: MotionView | undefined, n: number): Promise<MotionFrame> {
    const { init } = this.options;
    const ms = this.options.frameTimeout ?? FRAME_TIMEOUT_MS;
    const script = `window.__cuttleDraw(${at}${view ? `, ${JSON.stringify(view)}` : ''})`;
    const draw = await this.timed(this.win.webContents.executeJavaScript(script) as Promise<number>, ms, `to draw frame ${n}`);
    const deadline = Date.now() + ms;
    let asked = false;
```

In the same file, replace:

```ts
      const scale = width / init.width;
      image = image.crop({ x: 0, y: 0, width, height: Math.round(init.height * scale) }).resize({ width: init.width, height: init.height, quality: 'best' });
    }
    const frame = { width: init.width, height: init.height, data: toRgba(new Uint8Array(image.toBitmap())) };
    this.drawn = n;
    this.last = frame;
    return frame;
  }

  /** What went wrong in the page so far (uncaught errors and rejections), and its console. */
```

with:

```ts
      const scale = width / init.width;
      image = image.crop({ x: 0, y: 0, width, height: Math.round(init.height * scale) }).resize({ width: init.width, height: init.height, quality: 'best' });
    }
    return { width: init.width, height: init.height, data: toRgba(new Uint8Array(image.toBitmap())) };
  }

  /** What went wrong in the page so far (uncaught errors and rejections), and its console. */
```

In the same file, replace:

```ts
  close(): void {
    if (this.win.isDestroyed()) return;
    this.win.destroy();
    giveBack(this.ses, this.options.root, this.options.network === true);
  }
}
```

with:

```ts
  close(): void {
    if (this.win.isDestroyed()) return;
    this.win.destroy();
    giveBack(this.ses, this.options.root, this.options.network === true, MotionPage.kitOf(this.options));
  }
}
```

In `packages/export/src/main/motion-host.ts`, replace:

```ts
import { relative, sep } from 'node:path';
import type { CuttleProject, MotionOverlay, MotionScene } from '@cuttle/project';
import { CHANNELS, type MotionFrameRequest, type MotionPages } from '../job';
import { motionInit } from '../motion/init';
import { MotionPage, type MotionFrame, type MotionPageOptions } from './motion';

/** What one motion item's page said while it rendered: its errors and its console, every showing together. */
```

with:

```ts
import { readFile } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { KIT_FONTS } from '@cuttle/motion-kit';
import type { CuttleProject, MotionOverlay, MotionScene } from '@cuttle/project';
import { CHANNELS, type MotionFrameRequest, type MotionPages } from '../job';
import { motionInit } from '../motion/init';
import { declaredParams, paramDefaults } from '../motion/params';
import { takeData, type TakeInputs } from '../motion/take';
import { MotionPage, type MotionFrame, type MotionPageOptions } from './motion';

/** What one motion item's page said while it rendered: its errors and its console, every showing together. */
```

In the same file, replace:

```ts
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
```

with:

```ts
  page: Promise<MotionPage>;
  /** The page's work, one call at a time. */
  queue: Promise<unknown>;
  /** The latest frame asked for (the page draws them in that order). */
  asked: number;
  /** The frame handed out last (the same frame again needs no drawing). */
  last?: { frame: number; data: MotionFrame };
  name: string;
}

/**
 * The main process's side of a job's motion: opens a page for each showing of an item the export
 * page asks for, with the take as the page sees it, draws its frames in the order they are asked
 * for (the export page asks for the next one while it works on the current one), opens it again
 * for a frame before one it drew, and closes it when the showing is over. Collects what the pages
 * said.
 */
export class MotionHost {
  private readonly showings = new Map<string, Showing>();
```

In the same file, replace:

```ts
  constructor(
    private readonly project: CuttleProject,
    private readonly pages: MotionPages,
    private readonly options: Pick<MotionPageOptions, 'frameTimeout' | 'loadTimeout'> = {},
  ) {}

  private item(request: MotionFrameRequest): { item: MotionScene | MotionOverlay; name: string; file: string } {
```

with:

```ts
  constructor(
    private readonly project: CuttleProject,
    private readonly pages: MotionPages,
    private readonly take: TakeInputs,
    private readonly options: Pick<MotionPageOptions, 'frameTimeout' | 'loadTimeout' | 'kitDir'> = {},
  ) {}

  private item(request: MotionFrameRequest): { item: MotionScene | MotionOverlay; name: string; file: string } {
```

In the same file, replace:

```ts
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
```

with:

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
    const { item, name, file } = this.item(request);
    const report = this.reports.get(name) ?? { item: name, src: relative(this.pages.root, file).split(sep).join('/'), errors: [], console: [] };
    this.reports.set(name, report);
    const page = this.openPage(request, item, name, file, report);
    page.catch(() => {}); // awaited by the frame that asked for it
    const showing: Showing = { page, queue: page, asked: -1, name };
    this.showings.set(request.key, showing);
    return showing;
  }
```

In the same file, replace:

```ts
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
```

with:

```ts
  async frame(request: MotionFrameRequest): Promise<MotionFrame> {
    let showing = this.showings.get(request.key);
    if (showing?.last?.frame === request.frame) return showing.last.data;
    if (showing && request.frame < showing.asked) {
      // an earlier frame than the page drew: it starts again
      await this.done(request.key);
      showing = undefined;
    }
    showing ??= this.open(request);
    showing.asked = Math.max(showing.asked, request.frame);
    try {
      const frame = await this.run(showing, (page) => page.frame(request.frame, request.view));
      showing.last = { frame: request.frame, data: frame };
      return frame;
    } catch (error) {
      throw new Error(`${showing.name} (${this.reports.get(showing.name)?.src}): ${(error as Error).message}`, { cause: error });
```

In `packages/export/src/main/sources.ts`, replace:

```ts
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseEventsJsonl, parseProjectJson, parseTakeJson, parseTranscriptJson, trackOffset, type CuttleProject, type InputEvent, type TakeFile, type TranscriptWord } from '@cuttle/project';
import { ExportError } from '../errors';
import type { MotionPages } from '../job';

/** cuttle.json inside the project folder. */
export const PROJECT_FILE = 'cuttle.json';
```

with:

```ts
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  parseEventsJsonl,
  parseMarkersJson,
  parseProjectJson,
  parseTakeJson,
  parseTranscriptJson,
  trackOffset,
  type CuttleProject,
  type InputEvent,
  type TakeFile,
  type TranscriptWord,
} from '@cuttle/project';
import { ExportError } from '../errors';
import type { MotionPages } from '../job';
import type { TakeInputs } from '../motion/take';

/** cuttle.json inside the project folder. */
export const PROJECT_FILE = 'cuttle.json';
```

In the same file, replace:

```ts
/** The project's files resolved and checked, ready for an export. */
export interface ProjectSources {
  project: CuttleProject;
  screen: string;
  webcam?: { path: string; offset: number };
  mic?: { path: string; offset: number };
  events?: InputEvent[];
```

with:

```ts
/** The project's files resolved and checked, ready for an export. */
export interface ProjectSources {
  project: CuttleProject;
  /** The screen recording; absent in a project without clips (motion, stills and cards only), which needs no take. */
  screen?: string;
  webcam?: { path: string; offset: number };
  mic?: { path: string; offset: number };
  events?: InputEvent[];
```

In the same file, replace:

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

with:

```ts
  transcript?: TranscriptWord[];
  stills: Record<number, string>;
  backgroundImage?: string;
  /** The motion items' pages, when the project has any, and the take as they see it. */
  motion?: MotionPages;
  motionTake?: TakeInputs;
  /** Every file the project names (cuttle.json and take.json included): the output must not replace one. */
  inputs: string[];
  /** Things the export goes on without, but the user should know (e.g. a take.json that does not apply). */
```

In the same file, replace:

```ts
  return Object.keys(pages.scenes).length + Object.keys(pages.overlays).length > 0 ? pages : undefined;
}

async function readTake(screen: string): Promise<{ path: string; take?: TakeFile; warning?: string } | undefined> {
  const path = join(dirname(screen), TAKE_FILE);
  let text: string;
```

with:

```ts
  return Object.keys(pages.scenes).length + Object.keys(pages.overlays).length > 0 ? pages : undefined;
}

/**
 * The take as motion pages see it: all its input events (whether the cursor shows or not), its words
 * and Claude's markers. A file that is missing or does not read leaves its list empty: a page that
 * follows the take shows nothing there, the video still renders.
 */
export async function motionTake(projectDir: string, project: CuttleProject): Promise<TakeInputs> {
  const read = async (path: string | undefined) => (path === undefined ? undefined : readFile(resolve(projectDir, path), 'utf8').catch(() => undefined));
  const [events, transcript, markers] = await Promise.all([read(project.sources.events), read(project.sources.transcript), read(project.sources.markers)]);
  const words = transcript === undefined ? undefined : parseTranscriptJson(transcript);
  const marks = markers === undefined ? undefined : parseMarkersJson(markers);
  return {
    events: events === undefined ? [] : parseEventsJsonl(events).events,
    words: words?.ok ? words.transcript.words : [],
    markers: marks?.ok ? marks.markers : [],
  };
}

async function readTake(screen: string): Promise<{ path: string; take?: TakeFile; warning?: string } | undefined> {
  const path = join(dirname(screen), TAKE_FILE);
  let text: string;
```

In the same file, replace:

```ts
  if (project.scenes.length === 0) throw new ExportError('invalid-project', `${projectPath} has no scenes`);
  const { look, sources } = project;

  const screen = await existing(projectDir, sources.screen, 'screen recording (sources.screen)');
  const takeFile = await readTake(screen);
  const take = takeFile?.take;
  // Every file the project names, including sources the look switches off: the output must not
  // replace a recording just because this export does not read it.
  const named = [sources.webcam, sources.mic, sources.cleanMic, sources.events, sources.markers, sources.transcript, look.background.image].filter((path) => path !== undefined);
  const inputs = [resolve(projectPath), screen, join(dirname(screen), TAKE_FILE), ...named.map((path) => resolve(projectDir, path))];
  const result: ProjectSources = { project, screen, stills: {}, inputs, warnings: takeFile?.warning ? [takeFile.warning] : [] };

  if (look.webcam.enabled && sources.webcam) {
    const path = await existing(projectDir, sources.webcam, 'webcam recording (sources.webcam)');
    result.webcam = { path, offset: offsetFor(take, 'webcam', path, screen) };
  }
  if (look.audio.enabled && sources.mic) {
    const path = await existing(projectDir, sources.mic, 'mic recording (sources.mic)');
    // the cleaned-up mic plays in its place, in step with it (take.json describes the mic itself)
    const clean = look.audio.cleanup && sources.cleanMic ? await existing(projectDir, sources.cleanMic, 'cleaned-up mic (sources.cleanMic)') : undefined;
    result.mic = { path: clean ?? path, offset: offsetFor(take, 'mic', path, screen) };
  }
  const typing = look.audio.enabled && look.audio.typing;
  if ((look.cursor.enabled || typing) && sources.events) {
    const path = await existing(projectDir, sources.events, 'input events (sources.events)', false);
    const events = parseEventsJsonl(await readFile(path, 'utf8'));
    if (events.issues.length > 0) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(events.issues)}`);
```

with:

```ts
  if (project.scenes.length === 0) throw new ExportError('invalid-project', `${projectPath} has no scenes`);
  const { look, sources } = project;

  // A video of motion scenes, stills and cards shows nothing of a take: it needs no recording.
  const clips = project.scenes.some((scene) => scene.type === 'clip');
  const screen = clips ? await existing(projectDir, sources.screen, 'screen recording (sources.screen)') : undefined;
  const takeFile = screen ? await readTake(screen) : undefined;
  const take = takeFile?.take;
  // Every file the project names, including sources the look switches off: the output must not
  // replace a recording just because this export does not read it.
  const named = [sources.screen, sources.webcam, sources.mic, sources.cleanMic, sources.events, sources.markers, sources.transcript, look.background.image].filter((path) => path !== undefined);
  const inputs = [resolve(projectPath), ...(screen ? [join(dirname(screen), TAKE_FILE)] : []), ...named.map((path) => resolve(projectDir, path))];
  const result: ProjectSources = { project, ...(screen && { screen }), stills: {}, inputs, warnings: takeFile?.warning ? [takeFile.warning] : [] };

  if (screen && look.webcam.enabled && sources.webcam) {
    const path = await existing(projectDir, sources.webcam, 'webcam recording (sources.webcam)');
    result.webcam = { path, offset: offsetFor(take, 'webcam', path, screen) };
  }
  if (screen && look.audio.enabled && sources.mic) {
    const path = await existing(projectDir, sources.mic, 'mic recording (sources.mic)');
    // the cleaned-up mic plays in its place, in step with it (take.json describes the mic itself)
    const clean = look.audio.cleanup && sources.cleanMic ? await existing(projectDir, sources.cleanMic, 'cleaned-up mic (sources.cleanMic)') : undefined;
    result.mic = { path: clean ?? path, offset: offsetFor(take, 'mic', path, screen) };
  }
  const typing = look.audio.enabled && look.audio.typing;
  if (screen && (look.cursor.enabled || typing) && sources.events) {
    const path = await existing(projectDir, sources.events, 'input events (sources.events)', false);
    const events = parseEventsJsonl(await readFile(path, 'utf8'));
    if (events.issues.length > 0) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(events.issues)}`);
```

In the same file, replace:

```ts
  const motion = await motionPages(projectDir, project);
  if (motion) {
    result.motion = motion;
    result.inputs.push(...Object.values(motion.scenes), ...Object.values(motion.overlays));
  }
  return result;
```

with:

```ts
  const motion = await motionPages(projectDir, project);
  if (motion) {
    result.motion = motion;
    result.motionTake = await motionTake(projectDir, project);
    result.inputs.push(...Object.values(motion.scenes), ...Object.values(motion.overlays));
  }
  return result;
```

In `packages/export/src/main/export.ts`, replace:

```ts
  const job: ExportJob = {
    kind: 'video',
    project,
    screen: sources.screen,
    webcam: sources.webcam,
    events: sources.events,
    ...(sources.transcript && { transcript: sources.transcript }),
```

with:

```ts
  const job: ExportJob = {
    kind: 'video',
    project,
    ...(sources.screen && { screen: sources.screen }),
    webcam: sources.webcam,
    events: sources.events,
    ...(sources.transcript && { transcript: sources.transcript }),
```

In the same file, replace:

```ts
  let work: string | undefined;
  let files: FileHost | undefined;
  let window: ExportWindow | undefined;
  const motion = sources.motion ? new MotionHost(project, sources.motion) : undefined;
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const video = join(work, 'video.mp4');
    const images = [...Object.values(sources.stills), ...(sources.backgroundImage ? [sources.backgroundImage] : [])];
    const host = new FileHost([sources.screen, ...(sources.webcam ? [sources.webcam.path] : [])], video, images);
    files = host;
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    throwIfCancelled();
```

with:

```ts
  let work: string | undefined;
  let files: FileHost | undefined;
  let window: ExportWindow | undefined;
  const motion = sources.motion && sources.motionTake ? new MotionHost(project, sources.motion, sources.motionTake) : undefined;
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const video = join(work, 'video.mp4');
    const images = [...Object.values(sources.stills), ...(sources.backgroundImage ? [sources.backgroundImage] : [])];
    const host = new FileHost([...(sources.screen ? [sources.screen] : []), ...(sources.webcam ? [sources.webcam.path] : [])], video, images);
    files = host;
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    throwIfCancelled();
```

In `packages/export/src/main/stills.ts`, replace:

```ts
import { cancelledError, defaultPageDir, runPage, watchdog, whenCancelled } from './export';
import { FileHost } from './files';
import { MotionHost, serveMotion, type MotionItemReport } from './motion-host';
import { loadSources, motionPages } from './sources';
import { openExportWindow, type ExportWindow } from './window';

export interface StillsOptions {
```

with:

```ts
import { cancelledError, defaultPageDir, runPage, watchdog, whenCancelled } from './export';
import { FileHost } from './files';
import { MotionHost, serveMotion, type MotionItemReport } from './motion-host';
import { loadSources, motionPages, motionTake } from './sources';
import { openExportWindow, type ExportWindow } from './window';

export interface StillsOptions {
```

In the same file, replace:

```ts
  if (opts.signal?.aborted) throw cancelledError();
  const project = withFormat(opts.project ? opts.project(sources.project) : sources.project, opts.format);
  const motionFiles = opts.project ? await motionPages(resolve(opts.projectDir), project) : sources.motion;
  const columns = opts.sheet ? Math.max(1, Math.round(opts.sheet.columns ?? DEFAULT_SHEET_COLUMNS)) : undefined;
  const job: StillsJob = {
    kind: 'stills',
    project,
    screen: sources.screen,
    webcam: sources.webcam,
    events: sources.events,
    ...(sources.transcript && { transcript: sources.transcript }),
```

with:

```ts
  if (opts.signal?.aborted) throw cancelledError();
  const project = withFormat(opts.project ? opts.project(sources.project) : sources.project, opts.format);
  const motionFiles = opts.project ? await motionPages(resolve(opts.projectDir), project) : sources.motion;
  const take = motionFiles ? (sources.motionTake ?? (await motionTake(resolve(opts.projectDir), project))) : undefined;
  const columns = opts.sheet ? Math.max(1, Math.round(opts.sheet.columns ?? DEFAULT_SHEET_COLUMNS)) : undefined;
  const job: StillsJob = {
    kind: 'stills',
    project,
    ...(sources.screen && { screen: sources.screen }),
    webcam: sources.webcam,
    events: sources.events,
    ...(sources.transcript && { transcript: sources.transcript }),
```

In the same file, replace:

```ts
  const guard = watchdog();
  const images = [...Object.values(sources.stills), ...(sources.backgroundImage ? [sources.backgroundImage] : [])];
  // Reads only: stills mode writes PNGs through writeStill, never into a video file.
  const host = new FileHost([sources.screen, ...(sources.webcam ? [sources.webcam.path] : [])], join(outDir, '.unused'), images);
  let window: ExportWindow | undefined;
  const motion = motionFiles ? new MotionHost(project, motionFiles) : undefined;
  try {
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    const ipc = window.win.webContents.ipc;
```

with:

```ts
  const guard = watchdog();
  const images = [...Object.values(sources.stills), ...(sources.backgroundImage ? [sources.backgroundImage] : [])];
  // Reads only: stills mode writes PNGs through writeStill, never into a video file.
  const host = new FileHost([...(sources.screen ? [sources.screen] : []), ...(sources.webcam ? [sources.webcam.path] : [])], join(outDir, '.unused'), images);
  let window: ExportWindow | undefined;
  const motion = motionFiles && take ? new MotionHost(project, motionFiles, take) : undefined;
  try {
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    const ipc = window.win.webContents.ipc;
```

- [ ] **Step 4: The export page: each frame with its view, the next one asked for ahead**

In `packages/export/src/page/scene-sources.ts`, replace:

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

export interface SceneMedia {
  screen: VideoFile;
  /** `offset`: seconds the webcam started after the screen; webcam time = source time − offset. */
  webcam?: VideoFile & { offset: number };
  /** Scene index → image path of a still scene. */
  stills: Readonly<Record<number, string>>;
  /** The project's scenes (a motion scene's duration). */
  scenes: readonly Scene[];
  maxTextureSize: number;
}

interface OpenScene {
  plan: ScenePlan;
  screen?: TrackReader;
```

with:

```ts
import { clipView, type FrameSources } from '@cuttle/engine';
import type { CuttleProject } from '@cuttle/project';
import type { RenderState, SceneFrame, SceneSpan } from '@cuttle/timeline';
import type { FramePlan, OverlayPlan, ScenePlan } from '../frame-plan';
import type { MotionFrameRequest, MotionPixels } from '../job';
import type { MotionView } from '../motion/runtime';
import { host, PageError } from './host';
import { loadImage } from './images';
import type { VideoFile } from './media';
import { TrackReader } from './track-reader';

export interface SceneMedia {
  /** The screen recording; absent in a project without clips. */
  screen?: VideoFile;
  /** `offset`: seconds the webcam started after the screen; webcam time = source time − offset. */
  webcam?: VideoFile & { offset: number };
  /** Scene index → image path of a still scene. */
  stills: Readonly<Record<number, string>>;
  maxTextureSize: number;
}

/** What motion items need besides the media: the project and its spans, and the timeline's frames. */
export interface MotionContext {
  project: CuttleProject;
  spans: readonly SceneSpan[];
  /** The timeline's state on output frame `frame`. */
  stateAt(frame: number): RenderState;
  /** Ask for each item's next frame while the current one is drawn and encoded (a video; not stills, whose frames jump). */
  ahead: boolean;
}

interface OpenScene {
  plan: ScenePlan;
  screen?: TrackReader;
```

In the same file, replace:

```ts
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
```

with:

```ts
const remoteMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');

/**
 * One showing of a motion item: its frames, drawn by the main process in the order they are asked
 * for. A frame may be asked for ahead of time (its first as it opens, the next while one is drawn).
 */
class MotionSource {
  private readonly asked = new Map<number, Promise<MotionPixels>>();

  constructor(private readonly request: Omit<MotionFrameRequest, 'frame' | 'view'>) {}

  private ask(frame: number, view: MotionView | undefined): Promise<MotionPixels> {
    return host()
      .motionFrame({ ...this.request, frame, ...(view && { view }) })
      .catch((error: unknown) => {
        throw new PageError('render', remoteMessage(error));
      });
  }

  /** Asks for frame `n` now, for later (once). */
  ahead(n: number, view: MotionView | undefined): void {
    if (this.asked.has(n)) return;
    const frame = this.ask(n, view);
    frame.catch(() => {}); // awaited when it shows
    this.asked.set(n, frame);
  }

  /** Frame `n` of the showing (n / fps seconds into it), with this frame's view of the take. */
  frame(n: number, view: MotionView | undefined): Promise<MotionPixels> {
    const frame = this.asked.get(n) ?? this.ask(n, view);
    for (const key of this.asked.keys()) if (key <= n) this.asked.delete(key);
    return frame;
  }

  done(): void {
```

In the same file, replace:

```ts
  private readonly overlays = new Map<string, { plan: OverlayPlan; source: MotionSource }>();
  private readonly pendingOverlays: OverlayPlan[];
  private readonly fps: number;
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };

  constructor(
    plan: FramePlan,
    private readonly media: SceneMedia,
    private readonly lookahead: number,
  ) {
    this.pending = [...plan.scenes];
    this.pendingOverlays = [...plan.overlays].sort((a, b) => a.firstFrame - b.firstFrame);
    this.fps = plan.fps;
  }

  private screenTime(sourceTime: number): number {
    return Math.max(sourceTime, this.media.screen.start);
  }

  /** Webcam time for a source time, or undefined where the webcam track has no frame. */
```

with:

```ts
  private readonly overlays = new Map<string, { plan: OverlayPlan; source: MotionSource }>();
  private readonly pendingOverlays: OverlayPlan[];
  private readonly fps: number;
  /** The last frame of the video (or of the stills). */
  private readonly lastFrame: number;
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };

  constructor(
    plan: FramePlan,
    private readonly media: SceneMedia,
    private readonly lookahead: number,
    private readonly motion: MotionContext,
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

  private screenTime(sourceTime: number): number {
    return Math.max(sourceTime, this.media.screen?.start ?? 0);
  }

  /** The screen recording's size; the output's in a project without one. */
  private get screenSize(): { width: number; height: number } {
    return this.media.screen?.size ?? { width: this.motion.project.output.width, height: this.motion.project.output.height };
  }

  /** Webcam time for a source time, or undefined where the webcam track has no frame. */
```

In the same file, replace:

```ts
  private openScene(plan: ScenePlan): OpenScene {
    const { screen, webcam } = this.media;
    if (plan.kind === 'clip') {
      const screenTimes = [...new Set(plan.sourceTimes.map((t) => this.screenTime(t)))];
      const webcamTimes = plan.sourceTimes.map((t) => this.webcamTime(t)).filter((t): t is number => t !== undefined);
      return {
```

with:

```ts
  private openScene(plan: ScenePlan): OpenScene {
    const { screen, webcam } = this.media;
    if (plan.kind === 'clip') {
      if (!screen) throw new Error(`scene ${plan.index} is a clip, but there is no screen recording`);
      const screenTimes = [...new Set(plan.sourceTimes.map((t) => this.screenTime(t)))];
      const webcamTimes = plan.sourceTimes.map((t) => this.webcamTime(t)).filter((t): t is number => t !== undefined);
      return {
```

In the same file, replace:

```ts
      return { plan, still };
    }
    if (plan.kind === 'motion') {
      const scene = this.media.scenes[plan.index];
      const duration = scene?.type === 'motion' ? scene.duration : 0;
      return { plan, motion: new MotionSource({ key: `scene:${plan.index}`, kind: 'scene', index: plan.index, duration }) };
    }
    return { plan };
  }

  /** Frames for every layer of `state`, which is output frame `frame`. */
  async sourcesFor(frame: number, state: RenderState): Promise<FrameSources> {
    while (this.pending.length > 0 && this.pending[0]!.firstFrame <= frame + this.lookahead) {
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
```

with:

```ts
      return { plan, still };
    }
    if (plan.kind === 'motion') {
      const scene = this.motion.project.scenes[plan.index];
      const span = this.motion.spans.find((candidate) => candidate.sceneIndex === plan.index);
      const duration = scene?.type === 'motion' ? scene.duration : 0;
      const request = { key: `scene:${plan.index}`, kind: 'scene' as const, index: plan.index, start: span?.start ?? 0, duration, screen: this.screenSize };
      return { plan, motion: new MotionSource(request) };
    }
    return { plan };
  }

  /** Frames for every layer of `state`, which is output frame `frame`. */
  async sourcesFor(frame: number, state: RenderState): Promise<FrameSources> {
    const opened = new Set<number>();
    while (this.pending.length > 0 && this.pending[0]!.firstFrame <= frame + this.lookahead) {
      const plan = this.pending.shift()!;
      this.open.set(plan.index, this.openScene(plan));
      if (plan.kind === 'motion') opened.add(plan.firstFrame);
    }
    while (this.pendingOverlays.length > 0 && this.pendingOverlays[0]!.firstFrame <= frame + this.lookahead) {
      const plan = this.pendingOverlays.shift()!;
      const request = { key: `overlay:${plan.key}`, kind: 'overlay' as const, index: plan.index, start: plan.start, duration: plan.duration, screen: this.screenSize };
      this.overlays.set(plan.key, { plan, source: new MotionSource(request) });
      opened.add(plan.firstFrame);
    }
    // a motion item's page opens and draws its first frame while the frames before it are made
    for (const first of opened) if (first > frame) this.eachMotion(first, (source, n, view) => source.ahead(n, view));
    const { screens, webcams, stills, motion, overlays } = this.sources;
    screens.clear();
    webcams.clear();
```

In the same file, replace:

```ts
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
  }
```

with:

```ts
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

In `packages/export/src/page/run.ts`, replace:

```ts
  return size;
}

function checkClipRanges(job: PageJob, screen: VideoFile): void {
  job.project.scenes.forEach((scene, index) => {
    if (scene.type === 'clip' && scene.to > screen.end + END_TOLERANCE_SECONDS) {
      throw new PageError(
        'invalid-project',
        `scenes[${index}] ends at ${scene.to} s, but the screen recording ends at ${screen.end.toFixed(3)} s`,
```

with:

```ts
  return size;
}

function checkClipRanges(job: PageJob, screen: VideoFile | undefined): void {
  job.project.scenes.forEach((scene, index) => {
    if (scene.type === 'clip' && !screen) throw new PageError('invalid-project', `scenes[${index}] is a clip, but the project has no screen recording`);
    if (scene.type === 'clip' && screen && scene.to > screen.end + END_TOLERANCE_SECONDS) {
      throw new PageError(
        'invalid-project',
        `scenes[${index}] ends at ${scene.to} s, but the screen recording ends at ${screen.end.toFixed(3)} s`,
```

In the same file, replace:

```ts
  const { project } = job;
  const [assets, screen, webcam] = await Promise.all([
    loadEngineAssets(),
    openVideo(job.screen, 'the screen recording'),
    job.webcam ? openVideo(job.webcam.path, 'the webcam recording') : undefined,
  ]);
  const canvas = new OffscreenCanvas(1, 1);
```

with:

```ts
  const { project } = job;
  const [assets, screen, webcam] = await Promise.all([
    loadEngineAssets(),
    job.screen ? openVideo(job.screen, 'the screen recording') : undefined,
    job.webcam ? openVideo(job.webcam.path, 'the webcam recording') : undefined,
  ]);
  const canvas = new OffscreenCanvas(1, 1);
```

In the same file, replace:

```ts
  let renderer: Renderer | undefined;
  try {
    checkClipRanges(job, screen);
    const timeline = createTimeline(project, {
      screenSize: screen.size,
      cursor: job.events ? createCursorTrack(job.events) : undefined,
      ...(job.transcript && { transcript: job.transcript }),
      ...(job.captions !== undefined && { captions: job.captions }),
    });
    const plan = makePlan(timeline);
    if (job.backgroundImage) background = await loadImage(job.backgroundImage, probeMaxTextureSize(), 'the background image');
    renderer = createRenderer(canvas, project, { assets, screenSize: screen.size, backgroundImage: background });
    const gl = canvas.getContext('webgl2')!;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    sources = new SceneSources(
      plan,
      { screen, webcam: webcam && job.webcam ? { ...webcam, offset: job.webcam.offset } : undefined, stills: job.stills, scenes: project.scenes, maxTextureSize },
      lookahead,
    );
    return await body({ timeline, plan, renderer, canvas, gl, sources });
  } finally {
```

with:

```ts
  let renderer: Renderer | undefined;
  try {
    checkClipRanges(job, screen);
    // without a take, the output's size stands in for the screen's (no clip shows it)
    const screenSize = screen?.size ?? { width: project.output.width, height: project.output.height };
    const timeline = createTimeline(project, {
      screenSize,
      cursor: job.events ? createCursorTrack(job.events) : undefined,
      ...(job.transcript && { transcript: job.transcript }),
      ...(job.captions !== undefined && { captions: job.captions }),
    });
    const plan = makePlan(timeline);
    if (job.backgroundImage) background = await loadImage(job.backgroundImage, probeMaxTextureSize(), 'the background image');
    renderer = createRenderer(canvas, project, { assets, screenSize, backgroundImage: background });
    const gl = canvas.getContext('webgl2')!;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    sources = new SceneSources(
      plan,
      { screen, webcam: webcam && job.webcam ? { ...webcam, offset: job.webcam.offset } : undefined, stills: job.stills, maxTextureSize },
      lookahead,
      { project, spans: timeline.spans, stateAt: (frame) => timeline.frameAt(frame / plan.fps), ahead: job.kind === 'video' },
    );
    return await body({ timeline, plan, renderer, canvas, gl, sources });
  } finally {
```

In the same file, replace:

```ts
    // Free the context now instead of waiting for GC (browsers keep only ~16 live WebGL contexts).
    (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    background?.close();
    screen.input.dispose();
    webcam?.input.dispose();
  }
}
```

with:

```ts
    // Free the context now instead of waiting for GC (browsers keep only ~16 live WebGL contexts).
    (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    background?.close();
    screen?.input.dispose();
    webcam?.input.dispose();
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node packages/project packages/export`
Expected: PASS. The pages render in Electron only: Task 6's check renders them through the CLI.

- [ ] **Step 6: Commit**

```bash
git add packages/project packages/export pnpm-lock.yaml
git commit -m "export: pages get the take and the frame's view, motion blur, and a video of motion scenes needs no recording

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `motion new`, `motion templates`, and the overlay check

**Files:**
- Create: `apps/cli/test/motion.test.ts`
- Modify: `apps/cli/package.json`, `apps/cli/src/{main.ts,commands/motion.ts,commands/init.ts,electron/main.ts,electron/protocol.ts}`, `apps/cli/test/electron.check.test.ts`, `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing tests**

In `apps/cli/package.json`, replace:

```json
  "dependencies": {
    "@cuttle/core": "workspace:*",
    "@cuttle/export": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/recorder": "workspace:*",
    "@cuttle/timeline": "workspace:*",
```

with:

```json
  "dependencies": {
    "@cuttle/core": "workspace:*",
    "@cuttle/export": "workspace:*",
    "@cuttle/motion-kit": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/recorder": "workspace:*",
    "@cuttle/timeline": "workspace:*",
```

```bash
pnpm install
```

`apps/cli/test/motion.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MOTION_TEMPLATES } from '@cuttle/motion-kit';
import { runCli } from '../src/main';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-motion-'));
  dirs.push(dir);
  return dir;
};

async function cli(...argv: string[]) {
  let stdout = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: () => {} });
  return { code, json: JSON.parse(stdout) as Record<string, unknown> };
}

const project = (dir: string) => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { scenes?: Record<string, unknown>[]; overlays?: Record<string, unknown>[] };

describe('cuttle motion new and templates', () => {
  it('lists the templates', async () => {
    const { code, json } = await cli('--json', 'motion', 'templates');
    expect(code).toBe(0);
    expect(json.templates).toEqual(MOTION_TEMPLATES);
  });

  it('copies a scene template into motion/, as the first or the last scene, beside a copy already there', async () => {
    const dir = join(temp(), 'reel');
    expect((await cli('--json', 'init', dir)).code).toBe(0);
    const title = await cli('--json', '-C', dir, 'motion', 'new', 'title', '--first');
    expect(title.code).toBe(0);
    expect(title.json).toEqual({
      template: 'title',
      kind: 'scene',
      src: 'motion/title/index.html',
      item: { type: 'motion', id: 's1', label: 'Title', src: 'motion/title/index.html', duration: 3.5 },
    });
    expect(readFileSync(join(dir, 'motion', 'title', 'index.html'), 'utf8')).toMatch(/^<!doctype html>/);
    await cli('--json', '-C', dir, 'motion', 'new', 'end-card', '--duration', '5');
    const again = await cli('--json', '-C', dir, 'motion', 'new', 'title', '--first');
    expect(again.json.src).toBe('motion/title-2/index.html');
    expect(project(dir).scenes!.map((scene) => [scene.id, scene.src, scene.duration])).toEqual([
      ['s3', 'motion/title-2/index.html', 3.5],
      ['s1', 'motion/title/index.html', 3.5],
      ['s2', 'motion/end-card/index.html', 5],
    ]);
  });

  it('puts an overlay over the clips: from the first clip, or over the whole take, or at --at', async () => {
    const dir = temp();
    writeFileSync(
      join(dir, 'cuttle.json'),
      JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, scenes: [{ type: 'clip', from: 2, to: 10 }, { type: 'clip', from: 12, to: 30, speed: 4 }] }),
    );
    expect((await cli('--json', '-C', dir, 'motion', 'new', 'click-callouts')).json.item).toEqual({ id: 'o1', label: 'Click callouts', src: 'motion/click-callouts/index.html', at: 2, duration: 28 });
    expect((await cli('--json', '-C', dir, 'motion', 'new', 'lower-third', '--at', '3.5', '--name', 'guest')).json.item).toEqual({
      id: 'o2',
      label: 'Guest',
      src: 'motion/guest/index.html',
      at: 3.5,
      duration: 4,
    });
    expect(project(dir).overlays).toHaveLength(2);
    expect(existsSync(join(dir, 'motion', 'guest', 'index.html'))).toBe(true);
  });

  it('refuses an unknown template, a bad name, and an overlay in a video without clips', async () => {
    const dir = join(temp(), 'empty');
    await cli('--json', 'init', dir);
    expect((await cli('--json', '-C', dir, 'motion', 'new', 'sparkles')).json).toMatchObject({ error: { code: 'usage', message: expect.stringContaining('no template "sparkles"') } });
    expect((await cli('--json', '-C', dir, 'motion', 'new', 'title', '--name', 'My Intro')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'motion', 'new', 'lower-third')).json).toMatchObject({ error: { code: 'invalid-project', message: expect.stringContaining('has no clips') } });
  });
});
```

In `apps/cli/test/electron.check.test.ts`, replace:

```ts
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
```

with:

```ts
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
```

In the same file, replace:

```ts
    }
  }, 120_000);

  it('renders a motion scene and a motion overlay into the video, as the preview shows them', () => {
    const file = join(project, 'cuttle.json');
    const before = readFileSync(file, 'utf8');
```

with:

```ts
    }
  }, 120_000);

  it('makes a video without a recording: a project of motion scenes from the kit\'s templates', () => {
    const reel = join(mkdtempSync(join(tmpdir(), 'cuttle-reel-')), 'reel');
    try {
      expect(cuttle('init', reel).code).toBe(0);
      expect(cuttle('-C', reel, 'motion', 'new', 'title', '--first').code).toBe(0);
      expect(cuttle('-C', reel, 'motion', 'new', 'end-card').code).toBe(0);
      const { code, json } = cuttle('-C', reel, 'render');
      expect(code).toBe(0);
      expect(json).toMatchObject({ frames: 225, seconds: 7.5 });
      expect((json.motion as { errors: string[] }[]).flatMap((report) => report.errors)).toEqual([]);
      expect(probe(json.out as string).split(/\r?\n/)[0]).toBe('h264,1920,1080');
      // the title is on screen at 1.5 s: its light letters over its dark background, in the middle
      const still = cuttle('-C', reel, 'preview', '--at', '1.5', '-o', join(reel, 'still'));
      const png = PNG.sync.read(readFileSync((still.json.stills as { file: string }[])[0]!.file));
      let light = 0;
      for (let x = 300; x < 1620; x += 2) light += png.data[(540 * png.width + x) * 4]! > 200 ? 1 : 0;
      expect(light).toBeGreaterThan(40);
    } finally {
      rmSync(dirname(reel), { recursive: true, force: true });
    }
  }, 180_000);

  it('lands callouts on the take\'s clicks and kinetic captions on its words, over the video', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-take-')), 'take');
    cpSync(project, dir, { recursive: true });
    try {
      const file = join(dir, 'cuttle.json');
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> & { sources: Record<string, string> };
      writeFileSync(join(dir, 'takes', '1', 'events.jsonl'), '{"t":0.95,"type":"move","x":640,"y":360}\n{"t":1,"type":"click","x":640,"y":360,"button":"left"}\n');
      writeFileSync(join(dir, 'takes', '1', 'transcript.json'), JSON.stringify({ version: 1, language: 'en', model: 'small', words: [{ t: 1, end: 1.4, text: 'Look' }, { t: 1.4, end: 1.9, text: 'here' }] }));
      writeFileSync(file, JSON.stringify({ ...raw, scenes: [{ type: 'clip', from: 0, to: 3 }], overlays: [], captions: { enabled: false }, sources: { ...raw.sources, events: 'takes/1/events.jsonl', transcript: 'takes/1/transcript.json' } }));
      expect(cuttle('-C', dir, 'motion', 'new', 'click-callouts').code).toBe(0);
      expect(cuttle('-C', dir, 'motion', 'new', 'kinetic-captions').code).toBe(0);
      const still = (name: string) => PNG.sync.read(readFileSync((cuttle('-C', dir, 'preview', '--at', '1.3', '-o', join(dir, name)).json.stills as { file: string }[])[0]!.file));
      const shown = still('with');
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), overlays: [] }));
      const plain = still('without');
      const rgb = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
      // the click at (640, 360) of the 1280×720 screen is at (960, 558) of the 16:9 video, in the
      // mac-dark window (content 146, 100, 1628×916): the callout's dot is there, in the accent colour
      expect(rgb(shown, 960, 558).every((value, i) => Math.abs(value - [0xd9, 0x77, 0x57][i]!) <= 24)).toBe(true);
      // the captions: the bottom of the video changes, its top does not
      const differs = (top: number, bottom: number) => {
        for (let y = top; y < bottom; y += 2) for (let x = 0; x < 1920; x += 4) if (shown.data[(y * 1920 + x) * 4] !== plain.data[(y * 1920 + x) * 4]) return true;
        return false;
      };
      expect(differs(880, 1000)).toBe(true);
      expect(differs(0, 400)).toBe(false);
    } finally {
      rmSync(dirname(dir), { recursive: true, force: true });
    }
  }, 180_000);

  it('blurs fast motion: the moments while the shutter is open, averaged', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-blur-')), 'blur');
    try {
      expect(cuttle('init', dir).code).toBe(0);
      mkdirSync(join(dir, 'motion', 'fast'), { recursive: true });
      // a white square that crosses the frame at 3000 px a second
      writeFileSync(
        join(dir, 'motion', 'fast', 'index.html'),
        '<!doctype html><body style="margin:0;background:#000"><div id="box" style="position:absolute;top:440px;width:200px;height:200px;background:#fff"></div><script>cuttle.onFrame((t) => (box.style.left = (t * 3000 - 200) + "px"))</script></body>',
      );
      const page = { type: 'motion', src: 'motion/fast/index.html', duration: 1 };
      const raw = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
      writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ ...raw, look: { transition: { enabled: false } }, scenes: [page, { ...page, motionBlur: { samples: 8, shutter: 0.5 } }] }));
      const stills = cuttle('-C', dir, 'preview', '--at', '0.5', '--at', '1.5', '-o', join(dir, 'stills')).json.stills as { file: string }[];
      // grey pixels along the square's middle row: a hard edge has none, a blurred one a band of them
      const greys = (file: string) => {
        const png = PNG.sync.read(readFileSync(file));
        let count = 0;
        for (let x = 0; x < png.width; x++) {
          const value = png.data[(540 * png.width + x) * 4]!;
          if (value > 20 && value < 235) count++;
        }
        return count;
      };
      expect(greys(stills[0]!.file)).toBeLessThan(4);
      expect(greys(stills[1]!.file)).toBeGreaterThan(30);
    } finally {
      rmSync(dirname(dir), { recursive: true, force: true });
    }
  }, 180_000);

  it('renders a motion scene and a motion overlay into the video, as the preview shows them', () => {
    const file = join(project, 'cuttle.json');
    const before = readFileSync(file, 'utf8');
```

Run: `pnpm exec vitest run --project node apps/cli/test/motion.test.ts`
Expected: FAIL: `motion new` is an unknown command.

- [ ] **Step 2: The commands**

In `apps/cli/src/commands/motion.ts`, replace:

```ts
import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readProjectFile } from '@cuttle/core';
import type { MotionScene } from '@cuttle/project';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { MotionCheck } from '../electron/protocol';
```

with:

```ts
import { cp, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { MOTION_TEMPLATES, type MotionTemplate } from '@cuttle/motion-kit';
import { templatesFolder } from '@cuttle/motion-kit/files';
import { newId, usedIds, type MotionScene } from '@cuttle/project';
import { occurrences, sceneSpans } from '@cuttle/timeline';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { MotionCheck } from '../electron/protocol';
```

In the same file, replace:

```ts
export interface MotionCheckResult extends Omit<PreviewResult, 'motion'> {
  /** The page, relative to the project folder. */
  src: string;
  duration: number;
  /** The page's uncaught errors and rejections, and its console. */
  errors: string[];
```

with:

```ts
export interface MotionCheckResult extends Omit<PreviewResult, 'motion'> {
  /** The page, relative to the project folder. */
  src: string;
  /** A scene of its own, or an overlay over the video (checked where the video first shows it). */
  kind: 'scene' | 'overlay';
  /** Seconds it lasts; an overlay's stills are at output seconds of the video. */
  duration: number;
  /** The page's uncaught errors and rejections, and its console. */
  errors: string[];
```

In the same file, replace:

```ts
}

/**
 * `cuttle motion check <src>`: the page rendered as a scene of its own, frame by frame as the export
 * draws it, into PNGs and a contact sheet, with what it logged and threw. Its params and switches
 * come from the item in cuttle.json that shows it, when there is one.
 */
export async function motionCheckCommand(projectDir: string, src: string, args: MotionCheckArgs, output: Output, signal: AbortSignal): Promise<MotionCheckResult> {
  const file = await readProjectFile(projectDir);
```

with:

```ts
}

/**
 * `cuttle motion check <src>`: the page rendered frame by frame as the export draws it, into PNGs and
 * a contact sheet, with what it logged and threw. A page that `overlays` shows is checked over the
 * video, where the video first shows it, as the only overlay; any other page as a scene of its own,
 * with the params and switches of the scene that shows it, if one does.
 */
export async function motionCheckCommand(projectDir: string, src: string, args: MotionCheckArgs, output: Output, signal: AbortSignal): Promise<MotionCheckResult> {
  const file = await readProjectFile(projectDir);
```

In the same file, replace:

```ts
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
```

with:

```ts
  const { project } = file;
  const same = (candidate: string) => resolve(file.dir, candidate) === resolve(file.dir, page);
  const scene = project.scenes.find((candidate): candidate is MotionScene => candidate.type === 'motion' && same(candidate.src));
  const overlayIndex = scene ? -1 : project.overlays.findIndex((overlay) => same(overlay.src));
  const overlay = project.overlays[overlayIndex];
  const item = scene ?? overlay;
  // an overlay: the output seconds where the video first shows its stretch of the take
  let from = 0;
  let duration = args.duration ?? item?.duration ?? DEFAULT_SECONDS;
  if (overlay) {
    const shown = occurrences(sceneSpans(project.scenes, project.cuts), overlay.at, overlay.at + overlay.duration).find((occurrence) => occurrence !== undefined);
    if (!shown) throw new CliError('invalid-project', `the video does not show overlays[${overlayIndex}] (${page}): no clip covers source ${overlay.at}–${overlay.at + overlay.duration} s`);
    from = shown.start;
    duration = Math.round((shown.end - shown.start) * 1000) / 1000;
  }
  const last = Math.max(0, duration - 1 / project.output.fps);
  const offsets = args.at && args.at.length > 0 ? args.at : Array.from({ length: CHECK_FRAMES }, (_, i) => Math.round((i * last * 1000) / (CHECK_FRAMES - 1)) / 1000);
  const late = offsets.find((t) => t >= duration);
  if (late !== undefined) throw new CliError('usage', `--at ${late} is past the item's end (${duration} s)`);
  const times = offsets.map((t) => Math.round((from + t) * 1000) / 1000);
  const name = page.replace(/\/index\.html?$/i, '').replace(/\.html?$/i, '').split('/').at(-1) || 'page';
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview', `motion-${name}`);
  const motion: MotionCheck = {
```

In the same file, replace:

```ts
    duration,
    params: item?.params ?? {},
    network: item?.network ?? false,
  };
  output.info(`rendering ${times.length} frame(s) of ${page} into ${outDir} …`);
  const result = await runInElectron<PreviewResult>(
```

with:

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

In the same file, replace:

```ts
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
```

with:

```ts
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

In the same file, replace:

```ts
  );
  return checked;
}
```

with:

```ts
  );
  return checked;
}

export interface MotionNewArgs {
  /** The folder's name in motion/ (default: the template's). */
  name?: string;
  /** An overlay's start (source seconds; default: the first clip's start). */
  at?: number;
  /** Seconds it lasts (a scene's output seconds, an overlay's source seconds; default: the template's, or the whole take). */
  duration?: number;
  /** A scene goes first, not last. */
  first?: boolean;
}

export interface MotionNewResult {
  template: string;
  kind: MotionTemplate['kind'];
  /** The page, from the project folder. */
  src: string;
  /** What was added to cuttle.json (`scenes` or `overlays`). */
  item: Record<string, unknown>;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** "end-card" as a label: "End card". */
const labelOf = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-/g, ' ')}`;

/** `cuttle motion templates`: the templates `motion new` copies. */
export async function motionTemplatesCommand(output: Output): Promise<{ templates: readonly MotionTemplate[] }> {
  const result = { templates: MOTION_TEMPLATES };
  output.result(result, () => MOTION_TEMPLATES.map((template) => `${template.name.padEnd(17)}${template.kind.padEnd(8)} ${template.description}`).join('\n'));
  return result;
}

/**
 * `cuttle motion new <template>`: copies a template into `motion/<name>/` and adds it to cuttle.json,
 * a scene at the end (`--first`: at the start) or an overlay over the clips (`--at`).
 */
export async function motionNewCommand(projectDir: string, template: string, args: MotionNewArgs, output: Output): Promise<MotionNewResult> {
  const info = MOTION_TEMPLATES.find((candidate) => candidate.name === template);
  if (!info) throw new CliError('usage', `no template "${template}" (${MOTION_TEMPLATES.map((candidate) => candidate.name).join(', ')})`);
  const name = args.name ?? template;
  if (!NAME.test(name)) throw new CliError('usage', `--name "${name}" must be lower-case letters, digits and dashes`);
  const file = await readProjectFile(projectDir);
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
    item = { type: 'motion', id: newId('scenes', taken), label: labelOf(folder), src, duration: args.duration ?? info.duration };
    const scenes = (file.raw.scenes as unknown[] | undefined) ?? [];
    file.raw.scenes = args.first ? [item, ...scenes] : [...scenes, item];
  } else {
    const start = Math.min(...clips.map((clip) => clip.from));
    const end = Math.max(...clips.map((clip) => clip.to));
    const at = args.at ?? start;
    const duration = args.duration ?? (info.whole ? Math.max(0.1, end - at) : info.duration);
    item = { id: newId('overlays', taken), label: labelOf(folder), src, at, duration: Math.round(duration * 1000) / 1000 };
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

In `apps/cli/src/commands/init.ts`, replace:

```ts
  await mkdir(target, { recursive: true });
  const { file } = await writeProjectFile(newProjectFile(target), 'init');
  const result = { project: file.path };
  output.result(result, () => `created ${file.path}\nnext: cuttle record (in that folder)`);
  return result;
}
```

with:

```ts
  await mkdir(target, { recursive: true });
  const { file } = await writeProjectFile(newProjectFile(target), 'init');
  const result = { project: file.path };
  output.result(result, () => `created ${file.path}\nnext: cuttle record (in that folder), or motion scenes for a video without a recording (cuttle motion new title)`);
  return result;
}
```

In `apps/cli/src/electron/protocol.ts`, replace:

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
```

with:

```ts
// answer and a cancel go over Node's IPC channel (Electron's main process reads no stdin on
// Windows, and the console's Ctrl+C does not reach it). Pure: both sides import it.

/**
 * A motion page to check (`cuttle motion check`): a scene is rendered as the project's only scene;
 * an overlay (`overlay`: its place in `overlays`) over the project's video, the only overlay.
 */
export interface MotionCheck {
  /** The page, from the project folder. */
  src: string;
  duration: number;
  params: Record<string, string | number | boolean | null>;
  network: boolean;
  motionBlur?: { samples: number; shutter: number };
  overlay?: number;
}

export type ElectronRequest = (
```

In `apps/cli/src/electron/main.ts`, replace:

```ts
  return formats as SubtitleFormat[];
}

/** The project with the checked page as its only scene (its look and output stay). */
function motionCheckProject(project: CuttleProject, check: MotionCheck): CuttleProject {
  return { ...project, scenes: [{ type: 'motion', label: 'check', ...check }], overlays: [], cuts: [] };
}

async function handle(request: ElectronRequest): Promise<unknown> {
```

with:

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

async function handle(request: ElectronRequest): Promise<unknown> {
```

In `apps/cli/src/main.ts`, replace:

```ts
import { fitCommand } from './commands/fit';
import { frameCommand } from './commands/frame';
import { init } from './commands/init';
import { motionCheckCommand } from './commands/motion';
import { previewCommand } from './commands/preview';
import { recordCommand } from './commands/record';
import { recoverCommand } from './commands/recover';
```

with:

```ts
import { fitCommand } from './commands/fit';
import { frameCommand } from './commands/frame';
import { init } from './commands/init';
import { motionCheckCommand, motionNewCommand, motionTemplatesCommand } from './commands/motion';
import { previewCommand } from './commands/preview';
import { recordCommand } from './commands/record';
import { recoverCommand } from './commands/recover';
```

In the same file, replace:

```ts
    );

  const motion = program.command('motion').description('motion pages: scenes and overlays drawn by code (HTML, CSS, canvas, WebGL)');
  motion
    .command('check <src>')
    .description('render a motion page frame by frame as the export draws it: PNGs, a contact sheet, its errors and console')
```

with:

```ts
    );

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
    .action(action((output) => motionTemplatesCommand(output)));
  motion
    .command('check <src>')
    .description('render a motion page frame by frame as the export draws it: PNGs, a contact sheet, its errors and console')
```

- [ ] **Step 3: Run the tests and the check**

Run: `pnpm exec vitest run --project node apps/cli/test/motion.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm cli:check`
Expected: PASS, 11 tests. Among them:
- a video without a recording, made of two templates, renders, and shows its title;
- the callout's dot is on the take's click, through the window frame, and the captions show the words at the bottom only;
- a fast square has a hard edge without motion blur and a band of greys with it.

- [ ] **Step 4: Commit**

```bash
git add apps/cli pnpm-lock.yaml
git commit -m "cli: motion new and motion templates, an overlay's check over the video, and init for a video without a recording

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The app's kit

**Files:**
- Modify: `apps/desktop/scripts/build.mjs`, `apps/desktop/test/fixture.ts`

- [ ] **Step 1: The check's overlay needs the kit**

In `apps/desktop/test/fixture.ts`, replace:

```ts
/**
 * A take with motion: a still screen (dark grey) for 5 s, a 1 s motion scene before it (a page that
 * fills the frame with magenta) and a motion overlay over source 1 to 4 s (a green bar across the
 * bottom fifth, clear above it).
 */
export function makeMotionFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
```

with:

```ts
/**
 * A take with motion: a still screen (dark grey) for 5 s, a 1 s motion scene before it (a page that
 * fills the frame with magenta) and a motion overlay over source 1 to 4 s (a green bar across the
 * bottom fifth, clear above it, shown by the motion kit's helper).
 */
export function makeMotionFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
```

In the same file, replace:

```ts
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=1280x720:r=30:d=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(take, 'screen.mp4')]);
  for (const [name, body] of [
    ['intro', '<body style="margin:0;background:#ff00ff"></body>'],
    ['bar', '<body style="margin:0"><div style="position:absolute;left:0;right:0;bottom:0;height:20%;background:#00ff00"></div></body>'],
  ] as const) {
    mkdirSync(join(dir, 'motion', name), { recursive: true });
    writeFileSync(join(dir, 'motion', name, 'index.html'), `<!doctype html>${body}`);
```

with:

```ts
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=1280x720:r=30:d=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(take, 'screen.mp4')]);
  for (const [name, body] of [
    ['intro', '<body style="margin:0;background:#ff00ff"></body>'],
    // the bar shows only through the kit's helper: the app serves the motion kit
    ['bar', '<body style="margin:0"><div id="bar" style="position:absolute;left:0;right:0;bottom:0;height:20%;background:#00ff00;opacity:0"></div><script type="module">import { at } from "cuttle"; cuttle.onFrame((t) => (bar.style.opacity = String(at(t, 0, 0.001))));</script></body>'],
  ] as const) {
    mkdirSync(join(dir, 'motion', name), { recursive: true });
    writeFileSync(join(dir, 'motion', name, 'index.html'), `<!doctype html>${body}`);
```

- [ ] **Step 2: The build copies the kit**

In `apps/desktop/scripts/build.mjs`, replace:

```js
// Builds the app into apps/desktop/dist: the main process and media worker (dist/main), one
// self-contained CommonJS preload per window kind (dist/preload: a sandboxed preload can require
// only electron), the pages (dist/renderer) and the export page (dist/main/export-page).
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
```

with:

```js
// Builds the app into apps/desktop/dist: the main process and media worker (dist/main), one
// self-contained CommonJS preload per window kind (dist/preload: a sandboxed preload can require
// only electron), the pages (dist/renderer), the export page (dist/main/export-page) and the motion
// kit the export serves to motion pages (dist/main/motion-kit).
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
```

In the same file, replace:

```js
await build({ configFile: at('../../packages/export/electron/vite.page.config.ts'), build: { outDir: at('dist/main/export-page') } });
// macOS: the screen capture helper next to the recorder's bundle (nothing elsewhere)
execFileSync(process.execPath, [at('../../packages/recorder/native/build-macos.mjs'), at('dist/main')], { stdio: 'inherit' });
console.log('built apps/desktop/dist');
```

with:

```js
await build({ configFile: at('../../packages/export/electron/vite.page.config.ts'), build: { outDir: at('dist/main/export-page') } });
// macOS: the screen capture helper next to the recorder's bundle (nothing elsewhere)
execFileSync(process.execPath, [at('../../packages/recorder/native/build-macos.mjs'), at('dist/main')], { stdio: 'inherit' });
execFileSync(process.execPath, [at('../../packages/motion-kit/scripts/copy.mjs'), at('dist/main/motion-kit')], { stdio: 'inherit' });
console.log('built apps/desktop/dist');
```

- [ ] **Step 3: Run the check**

Run: `pnpm app:check`
Expected: PASS, 48 tests; "opens a project with motion" sees the overlay's bar, which shows only through the kit's helper.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop
git commit -m "desktop: the app's build carries the motion kit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The guide

**Files:**
- Create: `skill/cuttle/motion.md`
- Modify: `skill/cuttle/{SKILL,project}.md`, `skill/test/skill.test.ts`

- [ ] **Step 1: Free, and how to make it look designed**

`skill/cuttle/motion.md`:

````markdown
# Motion: videos written in code

A motion item is a web page that Cuttle renders frame by frame into the video. Anything a browser
draws can be in it: kinetic type, shapes and patterns, a chart that builds, particles, a 3D scene,
an After Effects animation (Lottie), a code editor that types itself. You are free in what you make
and how: the templates are only starting points, and a page can be plain HTML and CSS, a canvas,
SVG, WebGL, Three.js or all of them at once. Make it look like the work of a great motion designer.

## Two kinds of video

- **Over a recording:** motion scenes between the clips (an intro, a chapter card, an end card) and
  overlays over them (a lower third, callouts on the clicks, captions on the words).
- **Without a recording:** a promo, a showreel, an explainer made only of motion scenes. Run
  `cuttle init "<folder>"`, write the pages, add them as `motion` scenes, render. A project without
  clips needs no take.

## Make one

1. Write the page in the project: `motion/<name>/index.html`, with its scripts, images and data next
   to it (or shared, `motion/shared.js`, imported as `../shared.js`). Or start from a template:
   `cuttle -C "<project>" --json motion new <template>` (title, end-card, code-typing, lower-third,
   click-callouts, kinetic-captions; `cuttle --json motion templates` says what each shows); it
   copies the page and adds it to cuttle.json. Then change the copy as much as you like.
2. Add it (project.md has the fields): a scene,
   `{ "type": "motion", "id": "s9", "label": "Intro", "src": "motion/intro/index.html", "duration": 3 }`,
   or an overlay over the clips, `{ "id": "o1", "src": "motion/callouts/index.html", "at": 4, "duration": 20 }`.
3. Check it: `cuttle -C "<project>" --json motion check motion/<name>/index.html`. It renders eight
   frames into `preview/motion-<name>/` with a contact sheet, and lists the page's `errors` and
   `console`. A scene is checked on its own; an overlay over the video, where the video shows it.
   Read the sheet; fix every error; check single moments with `--at 0.4 --at 1.2` (seconds into it).
4. Look at it in the video with `cuttle preview --at …`, and render.

## The page's world

- **The clock is the video's.** `performance.now`, `Date`, `setTimeout`, `setInterval`,
  `requestAnimationFrame`, CSS animations and transitions and Web Animations follow the frame being
  drawn, from 0 at the item's start. `Math.random` is seeded per item: every render is the same.
- **Draw from time.** `cuttle.onFrame((t) => …)` runs before each frame (also after a jump). A page
  that sets everything from `t` there is right on every frame; free-running CSS animations work too,
  but keyframes you compute are easier to time. `import { at, ease, keys, stagger, split, typed,
  highlight, spring, random } from 'cuttle'` gives you easing, keyframes, staggering, text splitting,
  typing with a rhythm, syntax colours and springs, all as functions of time.
- **`window.cuttle`:** `time` and `duration` (the item's seconds), `videoTime` (the video's),
  `fps`, `size` (the output's pixels), `format` (`16:9`, `9:16`, `1:1`), `params`, `theme`,
  `ready(promise)` (the first frame waits for it: fonts, data, a model), and `take` (below).
- **Size:** the page is the output, one CSS pixel per pixel (1920×1080 for 16:9, 1080×1920 for
  9:16). Size things from the short side so one page works in every format:
  `--u: calc(100vmin / 1080)` and `font-size: calc(120 * var(--u))`. Canvases: `cuttle.size`.
- **Transparent by default.** Where a scene draws nothing, the look's background shows; an overlay
  shows the video there. A page cannot see the video behind it (no `backdrop-filter` on it).
- **Only the project's files**, by relative paths, and the kit; no network unless the item has
  `"network": true`. Image params are paths in the project folder: use them as `/<path>`.
- **Silent:** pages make no sound (sounds come with Cuttle's sound items).

## The kit (no network needed)

- `import * as THREE from 'three'` and its addons, `import { RoundedBoxGeometry } from
  'three/addons/geometries/RoundedBoxGeometry.js'`; create the renderer with
  `preserveDrawingBuffer: true` and `setPixelRatio(1)`, and render in `onFrame`.
- `import lottie from 'lottie-web'`: load with `autoplay: false`, then `goToAndStop(t * 1000)` in
  `onFrame`.
- Fonts, ready in every page: `Inter` (the theme's `--cuttle-font`), `JetBrains Mono`
  (`--cuttle-mono`), `Archivo` (variable weight 100–900 and width: `font-stretch` 62% condensed to
  125% expanded, animatable), `Space Grotesk`, `Bebas Neue`, `Fraunces` (a variable display serif)
  and `Instrument Serif` (upright and italic). Call `cuttle.ready(document.fonts.load('900 200px
  Archivo'))` before you measure text.
- The theme as CSS variables: `--cuttle-accent`, `--cuttle-bg`, `--cuttle-fg`, `--cuttle-font`,
  `--cuttle-mono`. Use them to match the project's look, or set your own palette.

## The take (overlays over a recording)

`cuttle.take` holds the recording in source seconds and source pixels: `events` (`click` with `x`,
`y`, `button`; `keys` counts; `scroll`; `move`), `clicks`, `words` (the transcript), `markers`
(Claude's prompt, tools, answer), `zooms`, `masks`, `screen` (its size) and `window` (the overlay's
stretch). To place things on the video:
- `take.toOutput(source)` is where a moment plays in the video (compare with `cuttle.videoTime`);
  `take.toSource(output)` the other way.
- `take.toScreen(x, y)` is where a point of the recording is in this frame, with the window frame,
  the crop and the zoom (`{ x, y, inside }`, null in a scene); `take.cursor` is the pointer there.
- `take.cursorAt(source)` is the pointer's path at any moment.

```js
// a ring at each click, on the click, as the video plays it
cuttle.onFrame(() => {
  for (const click of cuttle.take.clicks) {
    const shown = cuttle.take.toOutput(click.t);
    const age = shown === null ? -1 : cuttle.videoTime - shown;
    const point = cuttle.take.toScreen(click.x, click.y);
    if (age >= 0 && age < 1 && point?.inside) drawRing(point.x, point.y, age);
  }
});
```

## Motion that feels designed

- Hard cuts between full scenes are strong (set `look.transition.enabled: false` for a reel);
  crossfades suit calmer videos.
- Give fast motion **motion blur**: `"motionBlur": { "samples": 8, "shutter": 0.5 }` on the item
  renders 8 moments per frame while the shutter is open (8× the time) and averages them.
- Ease everything (`ease.outExpo` in, `ease.in` out), stagger groups, let shapes overshoot
  (`spring`, `ease.outBack`), animate type on the width and weight axes, and match exits to the
  next scene's entrance (a shape that grows to fill the frame in the next scene's colour).
- `output.fps` may be 60 for very smooth motion (twice the frames to render).
- Keep the DOM light per frame; draw particles and patterns on a canvas; reuse geometry in Three.js.
````

In `skill/cuttle/SKILL.md`, replace:

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

with:

```markdown
  scrolling still of a web page (the result the agent built); add `--wait 2500` for slow maps or
  fonts. It goes after every scene, so capture pages before you add the end card (or move the
  still in `scenes`).
- **Motion.** Anything a browser draws can be in the video, and you are free in what you make: a
  kinetic intro, an end card with the product's look, a chart that builds, a 3D shot, a callout on
  every click or a lower third over the clip. Read [motion.md](motion.md) first. Write a page into
  `motion/<name>/index.html`, or start from a template
  (`cuttle -C "<project>" --json motion new title --first`; `motion templates` lists them), add
  it as a `motion` scene or to `overlays`, and check it before you preview the video:
  `cuttle -C "<project>" --json motion check motion/<name>/index.html` renders it frame by frame
  into `preview/motion-<name>/` (`--duration`, `--at`) and lists its `errors` and `console`.
  Read the sheet, fix every error, then look at it in the video with `preview --at`. A video made
  only of motion scenes (a promo, a reel) needs no recording: `cuttle init "<folder>"`, then the
  pages.
- **End card.** A `card` scene at the end with the product name and URL, or a `motion` scene.

## 4. Render
```

In `skill/cuttle/project.md`, replace:

```markdown
| `clip` | `from`, `to` (source seconds, `to` > `from`), `speed` (`1`, up to 64; above 1 a badge like "12× speed" shows), `badge` (custom badge text, `""` for none), `crop` (`{ "rect": [x, y, w, h], "enabled": true }`: the part of the screen the clip shows, e.g. a browser's page without its tabs; the window takes its shape and zooms stay inside it; `suggest` makes it, tagged `auto: "crop"`, and cuts a clip where the content area changes for good) |
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |
| `motion` | `src` (an HTML page in the project, e.g. `motion/intro/index.html`), `duration` (output seconds), `params` (`{ "name": value }`: text, numbers, `true`/`false` or `null`, for the page), `network` (`false`; `true` lets the page load from https): a page drawn frame by frame over the whole output, over the background where it is clear (see "Motion pages") |

`zooms`: `at` and `duration` (source seconds), `rect`, `ease` (`smooth`, `linear`) and `enabled`
(`true`). The rect is widened to the screen's aspect and kept inside the screen. The zoom eases in
```

with:

```markdown
| `clip` | `from`, `to` (source seconds, `to` > `from`), `speed` (`1`, up to 64; above 1 a badge like "12× speed" shows), `badge` (custom badge text, `""` for none), `crop` (`{ "rect": [x, y, w, h], "enabled": true }`: the part of the screen the clip shows, e.g. a browser's page without its tabs; the window takes its shape and zooms stay inside it; `suggest` makes it, tagged `auto: "crop"`, and cuts a clip where the content area changes for good) |
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |
| `motion` | `src` (an HTML page in the project, e.g. `motion/intro/index.html`), `duration` (output seconds), `params` (`{ "name": value }`: text, numbers, `true`/`false` or `null`, for the page), `network` (`false`; `true` lets the page load from https), `motionBlur` (`{ "samples": 8, "shutter": 0.5 }`: each frame the average of that many moments while a camera's shutter would be open, half a frame here; off without it): a page drawn frame by frame over the whole output, over the background where it is clear (see "Motion pages" and [motion.md](motion.md)) |

`zooms`: `at` and `duration` (source seconds), `rect`, `ease` (`smooth`, `linear`) and `enabled`
(`true`). The rect is widened to the screen's aspect and kept inside the screen. The zoom eases in
```

In the same file, replace:

```markdown
title bar; `bottom` keeps the title visible. Texts fade in and out over 0.25 output seconds.

`overlays` are motion pages over the video: `src`, `at` and `duration` (source seconds, as a
text's), `params`, `network` and `enabled` (`true`). A page covers the whole output with its
transparency (a lower third, a callout, a logo), over the clip, its zooms, masks, cursor and texts,
and under the captions. Its clock runs in output seconds from where the video first shows its
stretch, across cuts and speed-ups; a clip shown twice shows it twice.
```

with:

```markdown
title bar; `bottom` keeps the title visible. Texts fade in and out over 0.25 output seconds.

`overlays` are motion pages over the video: `src`, `at` and `duration` (source seconds, as a
text's), `params`, `network`, `motionBlur` and `enabled` (`true`). A page covers the whole output with its
transparency (a lower third, a callout, a logo), over the clip, its zooms, masks, cursor and texts,
and under the captions. Its clock runs in output seconds from where the video first shows its
stretch, across cuts and speed-ups; a clip shown twice shows it twice.
```

In the same file, replace:

```markdown

A motion scene or overlay is a web page in the project folder, usually `motion/<name>/index.html`
with its own CSS, scripts, images and fonts next to it. Anything a browser draws works: HTML and
CSS, SVG, a canvas, WebGL. Cuttle renders it frame by frame, the same in every render.

- **Its clock is the video's.** `performance.now`, `Date`, `setTimeout`, `setInterval`,
  `requestAnimationFrame`, CSS animations and transitions and Web Animations all follow the frame
```

with:

```markdown

A motion scene or overlay is a web page in the project folder, usually `motion/<name>/index.html`
with its own CSS, scripts, images and fonts next to it. Anything a browser draws works: HTML and
CSS, SVG, a canvas, WebGL, Three.js and Lottie from the kit. Cuttle renders it frame by frame, the
same in every render. [motion.md](motion.md) is the guide: the kit, the take as a page sees it
(`cuttle.take`), and how to make it look designed. A project of motion scenes only needs no
recording.

- **Its clock is the video's.** `performance.now`, `Date`, `setTimeout`, `setInterval`,
  `requestAnimationFrame`, CSS animations and transitions and Web Animations all follow the frame
```

In `skill/test/skill.test.ts`, replace:

```ts
const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const reference = readFileSync(join(SKILL_DIR, 'project.md'), 'utf8');
const docs = [skill, reference];

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
```

with:

```ts
const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const reference = readFileSync(join(SKILL_DIR, 'project.md'), 'utf8');
const motion = readFileSync(join(SKILL_DIR, 'motion.md'), 'utf8');
const docs = [skill, reference, motion];

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
```

In the same file, replace:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'render', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion'];
```

with:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'motion new', 'motion templates', 'init', 'render', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion'];
```

In the same file, replace:

```ts
    ),
  );
  // An option on its own (`--until-file "<project>/stop"`): it must belong to some command. The
  // motion pages' CSS variables (`--cuttle-accent`) are not options.
  const loose = code.flatMap((snippet) => (/^--(?!cuttle-)[a-z-]+/.exec(snippet)?.[0] ?? []) as string[]);

  it('covers the workflow', () => {
    expect(new Set(uses.map((use) => use.command))).toEqual(new Set(COMMANDS));
```

with:

```ts
    ),
  );
  // An option on its own (`--until-file "<project>/stop"`): it must belong to some command. The
  // motion pages' CSS variables (`--cuttle-accent`, `--u: …`) are not options.
  const loose = code.flatMap((snippet) => (/^--(?!cuttle-)[a-z-]+(?![a-z-]|\s*:)/.exec(snippet)?.[0] ?? []) as string[]);

  it('covers the workflow', () => {
    expect(new Set(uses.map((use) => use.command))).toEqual(new Set(COMMANDS));
```

In the same file, replace:

```ts
    const config = temp();
    expect(install(config).status).toBe(0);
    const target = join(config, 'skills', 'cuttle');
    expect(readdirSync(target).sort()).toEqual(['.cuttle-skill.json', 'SKILL.md', 'project.md']);
    const installed = readFileSync(join(target, 'SKILL.md'), 'utf8');
    expect(installed).not.toContain('{{REPO}}');
    expect(installed).toContain(`(\`${REPO}\`)`);
```

with:

```ts
    const config = temp();
    expect(install(config).status).toBe(0);
    const target = join(config, 'skills', 'cuttle');
    expect(readdirSync(target).sort()).toEqual(['.cuttle-skill.json', 'SKILL.md', 'motion.md', 'project.md']);
    const installed = readFileSync(join(target, 'SKILL.md'), 'utf8');
    expect(installed).not.toContain('{{REPO}}');
    expect(installed).toContain(`(\`${REPO}\`)`);
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run --project node skill/test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add skill
git commit -m "skill: the motion guide: free in what to make, the kit, the take, motion that feels designed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 778 passed and 65 skipped (on a machine without a speech model the real transcription is skipped too: 777 and 66; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 11 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. `cuttle init reel`, then `cuttle -C reel motion new title --first` and `cuttle -C reel motion new end-card`, then `cuttle -C reel render`: a 7.5 s video without a recording.
2. In a project with a take, `cuttle -C <project> motion new click-callouts` and `motion check motion/click-callouts/index.html`: a ring and a number on each click.
3. Ask Claude for a 15 s motion reel: it writes the pages, checks them and renders.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran once, on the prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **The kinetic captions showed only a video's last phrase.** A phrase's end was taken from the next phrase's start before that start was set (NaN), so no other phrase was ever on. All the starts come first now. Found by checking the overlays by hand against a test take with clicks, words and a zoom.
- **`motion new` crashed with a stack trace** when the kit next to the bundle lacked a template (a build older than the templates). It now says the template is missing and to build again.
- **The title measured its words before its font was in.** The fit and the split wait in `cuttle.ready` now.
- **A logo param is a path in the project,** but the end card's page sits in `motion/<name>/`. The template resolves it from the project's root, and the guide says so for every image param.
- **The kit's package uses Node** (`src/files.ts`, its tests), so it is typechecked with the Node projects (`tsconfig.node.json`), not with the pure packages.
- **The skill test** took the guide's CSS variable `--u: …` for a CLI option, and now knows `init`, `motion new` and `motion templates`.
- **An audio test ran into vitest's 5 s** (5.06 s) in the full run, which this milestone made larger: it runs ffmpeg eight times one after another, 0.8 s alone. It gets 30 s.
- **The app check's overlay** shows only through the kit's helper, so the check proves that the app's build carries the kit.
- **A showreel as the acceptance test.** Eight motion scenes, 15 s, written and rendered with Cuttle in 91 s, were sent to the user: a burst, a wordmark, a bouncing dot, a star, a Truchet pattern, a Three.js wave, kinetic type with motion blur, and an end card. They share a HUD module in the project.
  - It showed that a page without the `--u` unit made the shared HUD collapse; the reel's HUD now sets the unit itself.
  - The guide tells pages to define the unit.

**Spec points that move**
- **The milestones.** The user asked for videos like an Opus showreel on X, made by Claude, and said that Claude must be free in what it makes. So P5-M1b adds:
  - videos without a recording;
  - motion blur;
  - display fonts.
  What it leaves moves on:
  - `cuttle.take.frame(t)`, transitions (`cuttle.from` and `cuttle.to`), and the device-3d and fold templates go to **P5-M1d**: pages that get frames;
  - sound (`sounds`, `cuttle sound`, `cuttle.sound`, the built-in sounds, the mix) goes to **P5-M1e**;
  - the editor stays **P5-M1c**.
- **The kit is at `cuttle-motion://kit/`** (the spec said `cuttle:kit/…`), and an import map lets pages write `import * as THREE from 'three'`.
- **Fonts:** the spec named Inter and a monospace font. The kit adds five display faces (OFL): Archivo, Space Grotesk, Bebas Neue, Fraunces and Instrument Serif. Editorial motion needs wide, condensed and serif type.
- **Six templates of the spec's eight**: device-3d and fold need frames of the take (P5-M1d).
- **`motion check` of an overlay** renders it over the video, where the video shows it. A scene is still checked on its own.
- **The acceptance** ("each template renders against the demo take; the callouts land on the take's clicks") has two parts:
  - the CLI check: the callout's dot on the click through the window frame, the captions on the words, a video of two templates without a recording;
  - a check of all six by hand against a test take with clicks, words and a zoom, where the callout in the zoom sits on its click.

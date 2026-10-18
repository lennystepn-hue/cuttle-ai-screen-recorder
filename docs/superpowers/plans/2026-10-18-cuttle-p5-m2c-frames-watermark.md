# Cuttle P5-M2c: Device Frames and the Watermark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Frames for what was recorded, and a mark in a corner of the video, each the same in the editor and the export:
- **six frames more:**
  - a dark browser;
  - Windows 11, light and dark (the title on the left, its caption buttons on the right);
  - a terminal (its title in a tab with a prompt);
  - an iPhone and an Android phone around the screen: a bezel, a metal band with side buttons, the Dynamic Island or a punch-hole camera, held upright or across as the recording is.
- **a watermark:** an image (its own, else the brand's logo, SVG too) or a text (else the brand's name), in a corner, at a size and an opacity, over everything and clear of the webcam bubble.

**Architecture:**
- **`@cuttle/project`:** the frame styles `browser-dark`, `windows-light`, `windows-dark`, `terminal`, `iphone` and `android` (`DEVICE_FRAMES`); `look.watermark` (off by default).
- **`@cuttle/engine`:**
  - The frames' chrome: caption buttons, a tab, or a device with its bezel, band and camera.
  - The window layout has a `clip`: what the content, the masks and the cursor are clipped to. For a window that is the window, as before; for a phone, its screen inside the bezel.
  - The window pass draws a device's body under the screen and its camera over it.
  - The renderer draws the watermark last (`watermarkRect`, `watermarkStyle`) from a `watermarkImage` it is given, else its text.
- **`@cuttle/export`:**
  - The sources find the watermark's image.
  - The job carries it, and the page loads it.
  - `svg.ts` draws an SVG into a bitmap for the page and the editor.
- **The app:**
  - The editor loads the watermark's image and makes its renderer anew when it or the brand changes.
  - The Look tab's Window part shows the new frames (the engine's own pictures).
  - A new part, Watermark: on, image or text, corner, size, opacity.

**Tech Stack:** TypeScript strict, zod 4, WebGL2 (GLSL ES 3.00), React 19, Electron 44.7.2.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-roadmap-p4-p6.md` (P5-M2: "device frames (iPhone, Android, Windows 11, terminal, dark browser) and a watermark"). Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m2b-backgrounds.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m2c`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The full `pnpm test` and the typecheck run in Task 5.

## Decisions made while planning

A prototype of the milestone, checked against the roadmap, settled these points. The finished prototype passed `pnpm test` (910 tests, 73 skipped, in two full runs), the typecheck, `app:check` (53 tests) and `cli:check` (14). Every screenshot was looked at.

- **Phones are frames, not windows:**
  - They have no title bar; a bezel goes all round the screen instead.
  - The bezel and the corners are shares of the screen's short side, so a phone looks the same at any size and held either way.
  - Held across (a recording wider than high), the phone is turned a quarter to the left: its camera is on the left and its buttons are at the top and the bottom.
- **The content is clipped to a `clip`:**
  - For a window it is the window, as before, so every golden image passes unchanged.
  - For a phone it is the screen, whose corners are the body's corners less the bezel (they share their centre).
  - The camera is drawn over the screen and its cursor; the webcam bubble, texts and captions come over it.
- **Windows' frames** draw their title on the left and the three caption buttons on the right, as glyphs in the title's colour. The terminal's title sits in a tab of the terminal's black, after a prompt (`›_`), with the caption buttons too.
- **The watermark is off until switched on.**
  - Its image is its own, else the brand's logo; without one it shows its text, else the brand's name. Nothing to show draws nothing.
  - It is drawn last, over captions and motion. In the webcam bubble's corner it moves past the bubble.
  - Its size is its height as a share of the short side (2 to 30 %), its opacity 10 to 100 %.
- **SVG logos are drawn through a canvas:** a bitmap made straight from an SVG image without a size of its own comes out empty. So the export page and the editor both draw the image onto a canvas of 512 px on its longer side first (`svg.ts`).
- **The files a watermark reads are the project's:** the watermark's image and the brand's logo join the files the output must never replace.
- **No new golden images** (they are kept per platform, and macOS cannot make its own from here). A browser test draws each new frame and the watermark and checks their pixels: the bars, the glyphs, the tab, the bezel, the rounded screen, the camera, the watermark's place, opacity and text.
- **The editor's renderer is made anew when the brand changes too:** a text watermark shows the brand's name, an image one its logo.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/schema.ts` | the frames, the watermark |
| `packages/engine/src/presets/{frames,labels}.ts`, `packages/engine/src/{layout,view,renderer}.ts`, `packages/engine/src/passes/{window,content,cursor,masks}.ts` | the chrome and the devices, the clip, the watermark |
| `packages/export/src/{svg,job}.ts`, `packages/export/src/main/{sources,export,stills}.ts`, `packages/export/src/page/{images,run}.ts` | the watermark's image in the export |
| `apps/desktop/src/shared/{ipc,names}.ts`, `apps/desktop/src/main/windows.ts`, `apps/desktop/src/renderer/editor/{media,player,actions,session}.ts`, `apps/desktop/src/renderer/editor/Inspector.tsx`, `apps/desktop/src/renderer/icons.tsx` | the editor |
| `apps/desktop/test/app.check.test.ts`, `skill/cuttle/*.md`, `skill/test/skill.test.ts` | the check, the guides |

---

### Task 1: The frames and the watermark in the project

**Files:**
- Modify: `packages/project/src/schema.ts`, `packages/project/src/index.ts`, `packages/project/test/schema.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m2c`; work there:

```bash
git switch p5-m2c
```

- [ ] **Step 2: Write the failing tests**

In `packages/project/test/schema.test.ts`, replace:

```ts
  });
});

describe('backgrounds', () => {
  it('read a gradient, the quiet ones in colours of their own, and a softened, darker image', () => {
    const gradient = { preset: 'gradient', colors: ['#0B132B', '#3A506B', '#5BC0BE'], angle: 90, kind: 'radial' };
```

with:

```ts
  });
});

describe('the watermark and the device frames', () => {
  it('has the watermark off by default, in the bottom right corner', () => {
    expect(ProjectSchema.parse(minimal).look.watermark).toEqual({ enabled: false, corner: 'bottom-right', size: 0.06, opacity: 0.7 });
  });

  it('reads an image or a text, a corner, a size and an opacity, and refuses them out of range', () => {
    const watermark = { enabled: true, image: 'images/mark.png', text: 'acme.dev', corner: 'top-left', size: 0.1, opacity: 0.5 };
    expect(ProjectSchema.parse({ ...minimal, look: { watermark } }).look.watermark).toEqual(watermark);
    expect(pathsOf({ ...minimal, look: { watermark: { size: 0.5 } } })).toEqual(['look.watermark.size']);
    expect(pathsOf({ ...minimal, look: { watermark: { opacity: 0 } } })).toEqual(['look.watermark.opacity']);
    expect(pathsOf({ ...minimal, look: { watermark: { corner: 'middle' } } })).toEqual(['look.watermark.corner']);
  });

  it('reads the new frames, for the window and for a still', () => {
    for (const style of ['browser-dark', 'windows-light', 'windows-dark', 'terminal', 'iphone', 'android']) {
      expect(pathsOf({ ...minimal, look: { frame: { style } }, scenes: [{ type: 'still', image: 'a.png', duration: 1, frame: style }] })).toEqual([]);
    }
  });
});

describe('backgrounds', () => {
  it('read a gradient, the quiet ones in colours of their own, and a softened, darker image', () => {
    const gradient = { preset: 'gradient', colors: ['#0B132B', '#3A506B', '#5BC0BE'], angle: 90, kind: 'radial' };
```

Run: `pnpm exec vitest run --project node packages/project`
Expected: FAIL: there are no such frames and no watermark.

- [ ] **Step 3: The schema**

In `packages/project/src/schema.ts`, replace:

```ts
/** The backgrounds drawn in colours of their own (`background.colors`): a gradient's, and the tints of the others. */
export const COLOURED_BACKGROUNDS = ['gradient', 'mesh', 'flow', 'bokeh', 'dots'] as const;
export const GRADIENT_KINDS = ['linear', 'radial'] as const;
export const FRAME_STYLES = ['mac-dark', 'mac-light', 'browser-light', 'none'] as const;
export const TEXT_STYLES = ['pill', 'lower-third', 'caption'] as const;
export const CURSOR_STYLES = ['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const;
export const CURSOR_SHAPES = ['arrow', 'text', 'pointer', 'wait', 'crosshair', 'move', 'not-allowed'] as const;
```

with:

```ts
/** The backgrounds drawn in colours of their own (`background.colors`): a gradient's, and the tints of the others. */
export const COLOURED_BACKGROUNDS = ['gradient', 'mesh', 'flow', 'bokeh', 'dots'] as const;
export const GRADIENT_KINDS = ['linear', 'radial'] as const;
export const FRAME_STYLES = ['mac-dark', 'mac-light', 'browser-light', 'browser-dark', 'windows-light', 'windows-dark', 'terminal', 'iphone', 'android', 'none'] as const;
/** The frames that are a device around the screen (a bezel, a camera), not a window with a title bar. */
export const DEVICE_FRAMES = ['iphone', 'android'] as const;
export const TEXT_STYLES = ['pill', 'lower-third', 'caption'] as const;
export const CURSOR_STYLES = ['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const;
export const CURSOR_SHAPES = ['arrow', 'text', 'pointer', 'wait', 'crosshair', 'move', 'not-allowed'] as const;
```

In the same file, replace:

```ts

// zod 4: .default() returns its value without parsing it; .prefault() parses it, so inner
// defaults apply when a whole block is missing.
const LookSchema = z.strictObject({
  background: BackgroundSchema.default({ preset: 'sunset-sky' }),
  frame: FrameSchema.prefault({}),
```

with:

```ts

// zod 4: .default() returns its value without parsing it; .prefault() parses it, so inner
// defaults apply when a whole block is missing.
/**
 * A mark in a corner of the whole video: an image of the project (else the brand's logo), or a text
 * (else the brand's name); off by default.
 */
const WatermarkSchema = z.strictObject({
  enabled: z.boolean().default(false),
  image: z.string().min(1).optional(),
  text: z.string().max(80).optional(),
  corner: z.enum(WEBCAM_CORNERS).default('bottom-right'),
  /** Its height as a share of the output's short side. */
  size: z.number().min(0.02).max(0.3).default(0.06),
  opacity: z.number().min(0.1).max(1).default(0.7),
});

const LookSchema = z.strictObject({
  background: BackgroundSchema.default({ preset: 'sunset-sky' }),
  frame: FrameSchema.prefault({}),
```

In the same file, replace:

```ts
  webcam: WebcamSchema.prefault({}),
  audio: AudioSchema.prefault({}),
  transition: TransitionSchema.prefault({}),
});

// Scenes and overlays may carry an id (for editors: selection, undo; unique in the project) and a
```

with:

```ts
  webcam: WebcamSchema.prefault({}),
  audio: AudioSchema.prefault({}),
  transition: TransitionSchema.prefault({}),
  watermark: WatermarkSchema.prefault({}),
});

// Scenes and overlays may carry an id (for editors: selection, undo; unique in the project) and a
```

In the same file, replace:

```ts
export type TextPosition = (typeof TEXT_POSITIONS)[number];
export type StillMotion = (typeof STILL_MOTIONS)[number];
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];
export type ColouredBackground = (typeof COLOURED_BACKGROUNDS)[number];
export type GradientKind = (typeof GRADIENT_KINDS)[number];
export type FrameStyle = (typeof FRAME_STYLES)[number];
```

with:

```ts
export type TextPosition = (typeof TEXT_POSITIONS)[number];
export type StillMotion = (typeof STILL_MOTIONS)[number];
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];
export type DeviceFrame = (typeof DEVICE_FRAMES)[number];
export type ColouredBackground = (typeof COLOURED_BACKGROUNDS)[number];
export type GradientKind = (typeof GRADIENT_KINDS)[number];
export type FrameStyle = (typeof FRAME_STYLES)[number];
```

In `packages/project/src/index.ts`, replace:

```ts
  CURRENT_VERSION,
  CURSOR_SHAPES,
  CURSOR_STYLES,
  EASES,
  FRAME_STYLES,
  ID_PATTERN,
```

with:

```ts
  CURRENT_VERSION,
  CURSOR_SHAPES,
  CURSOR_STYLES,
  DEVICE_FRAMES,
  EASES,
  FRAME_STYLES,
  ID_PATTERN,
```

In the same file, replace:

```ts
  type ClipScene,
  type CursorShape,
  type CursorStyle,
  type Cut,
  type CuttleProject,
  type CuttleProjectInput,
```

with:

```ts
  type ClipScene,
  type CursorShape,
  type CursorStyle,
  type DeviceFrame,
  type Cut,
  type CuttleProject,
  type CuttleProjectInput,
```

Run: `pnpm exec vitest run --project node packages/project`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/project
git commit -m "project: dark browser, Windows, terminal and phone frames; the watermark

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The engine draws them

**Files:**
- Create: `packages/engine/test/frames.browser.test.ts`
- Modify: `packages/engine/src/presets/frames.ts`, `packages/engine/src/presets/labels.ts`, `packages/engine/src/layout.ts`, `packages/engine/src/view.ts`, `packages/engine/src/renderer.ts`, `packages/engine/src/passes/window.ts`, `packages/engine/src/passes/content.ts`, `packages/engine/src/passes/cursor.ts`, `packages/engine/src/passes/masks.ts`, `packages/engine/test/layout.test.ts`, `packages/engine/test/presets.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/engine/test/presets.test.ts`, replace:

```ts
import { BACKGROUND_PRESETS, CURSOR_SHAPES, CURSOR_STYLES, FRAME_STYLES, TEXT_STYLES } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { BACKGROUNDS } from '../src/presets/backgrounds';
import { CURSOR_ART, CURSOR_GRID, cursorImageFor } from '../src/presets/cursors';
```

with:

```ts
import { BACKGROUND_PRESETS, CURSOR_SHAPES, CURSOR_STYLES, DEVICE_FRAMES, FRAME_STYLES, TEXT_STYLES } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { BACKGROUNDS } from '../src/presets/backgrounds';
import { CURSOR_ART, CURSOR_GRID, cursorImageFor } from '../src/presets/cursors';
```

In the same file, replace:

```ts
    for (const preset of BACKGROUND_PRESETS) expect(BACKGROUNDS[preset]).toContain('void main()');
  });

  it('have chrome for every frame style; only "none" has no title bar', () => {
    for (const style of FRAME_STYLES) expect(FRAME_CHROME[style].titleBar > 0).toBe(style !== 'none');
  });

  it('have a label style for every text style', () => {
```

with:

```ts
    for (const preset of BACKGROUND_PRESETS) expect(BACKGROUNDS[preset]).toContain('void main()');
  });

  it('have chrome for every frame style; only "none" and the devices have no title bar, and only the devices a bezel and a camera', () => {
    for (const style of FRAME_STYLES) {
      const device = (DEVICE_FRAMES as readonly string[]).includes(style);
      expect(FRAME_CHROME[style].titleBar > 0, style).toBe(style !== 'none' && !device);
      expect(FRAME_CHROME[style].device !== undefined, style).toBe(device);
    }
  });

  it('have a label style for every text style', () => {
```

In `packages/engine/test/layout.test.ts`, replace:

```ts
  stillCrop,
  unitFor,
  uvRect,
  webcamRect,
  windowLayout,
} from '../src/layout';
```

with:

```ts
  stillCrop,
  unitFor,
  uvRect,
  watermarkRect,
  webcamRect,
  windowLayout,
} from '../src/layout';
```

In the same file, replace:

```ts
  });
});

describe('source to output mapping', () => {
  const content: [number, number, number, number] = [100, 50, 800, 500];
```

with:

```ts
  });
});

describe('windowLayout for a device', () => {
  const phone = { titleBar: 0, radius: 14, device: { bezel: 0.045, radius: 0.155 } };

  it('fits a phone screen and its bezel, a share of its width, into the padded output', () => {
    const layout = windowLayout(HD, 9 / 19.5, phone);
    const [x, y, w, h] = layout.content;
    // height-limited: 1080 - 2*64 = 952 rows for the screen and two bezels of 4.5 % of its width
    expect(h + 2 * Math.round(0.045 * w)).toBeLessThanOrEqual(952);
    expect(h).toBeGreaterThan(900);
    expect(w / h).toBeCloseTo(9 / 19.5, 2);
    const band = Math.round(0.045 * w);
    expect(layout.window).toEqual([x - band, y - band, w + 2 * band, h + 2 * band]);
    expect(layout.titleBar).toBe(0);
    expect(layout.radius).toBeCloseTo(0.155 * layout.window[2], 6);
    // the screen is clipped inside the bezel, its corners the body's less the bezel
    expect(layout.clip).toEqual(layout.content);
    expect(layout.clipRadius).toBeCloseTo(layout.radius - band, 6);
    // centred
    expect(Math.abs(x + w / 2 - HD.width / 2)).toBeLessThanOrEqual(1);
  });

  it('clips a window to the window, title bar and all, as before', () => {
    const layout = windowLayout(HD, 16 / 9, { titleBar: 36, radius: 14 });
    expect(layout.clip).toEqual(layout.window);
    expect(layout.clipRadius).toBe(layout.radius);
  });
});

describe('watermarkRect', () => {
  it('sits in its corner, a margin from the edges, as high as its share of the short side', () => {
    expect(watermarkRect(HD, { corner: 'bottom-right', size: 0.1 }, 2)).toEqual([1920 - 40 - 216, 1080 - 40 - 108, 216, 108]);
    expect(watermarkRect(HD, { corner: 'top-left', size: 0.05 }, 1)).toEqual([40, 40, 54, 54]);
  });

  it('moves past the webcam bubble in the same corner: above it at the bottom, below it at the top', () => {
    const bubble = webcamRect(HD, { corner: 'bottom-right', size: 0.18 });
    const [, y, , h] = watermarkRect(HD, { corner: 'bottom-right', size: 0.06 }, 3, bubble);
    expect(y + h).toBeLessThanOrEqual(bubble[1]);
    const top = webcamRect(HD, { corner: 'top-left', size: 0.18 });
    expect(watermarkRect(HD, { corner: 'top-left', size: 0.06 }, 3, top)[1]).toBeGreaterThanOrEqual(top[1] + top[3]);
    // in another corner it stays
    expect(watermarkRect(HD, { corner: 'top-right', size: 0.06 }, 3, bubble)[1]).toBe(40);
  });
});

describe('source to output mapping', () => {
  const content: [number, number, number, number] = [100, 50, 800, 500];
```

`packages/engine/test/frames.browser.test.ts`:

```ts
import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import { createTimeline } from '@cuttle/timeline';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { createRenderer, type FrameSources } from '../src/renderer';
import { frameLayout } from '../src/view';
import { SCREEN, fixtures } from './fixtures';
import { pixelAt, readPixels, type Pixels } from './gl-util';

let assets: EngineAssets;
let screen: OffscreenCanvas;

beforeAll(async () => {
  assets = await loadEngineAssets();
  screen = (await fixtures()).screen;
});

const OUTPUT = { width: 640, height: 360 };
const SLATE = { preset: 'solid', color: '#3B4252' } as const;

function project(look: NonNullable<CuttleProjectInput['look']>, rest: Partial<CuttleProjectInput> = {}) {
  const parsed = parseProject({ version: 1, output: { ...OUTPUT, fps: 30 }, sources: { screen: 's.mp4' }, look: { background: SLATE, ...look }, scenes: [{ type: 'clip', from: 0, to: 10 }], ...rest });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

/** One frame of a clip of the fake screen, at 1 s. */
function render(look: NonNullable<CuttleProjectInput['look']>, options: { screenSize?: { width: number; height: number }; watermark?: ImageBitmap; rest?: Partial<CuttleProjectInput> } = {}): Pixels {
  const screenSize = options.screenSize ?? SCREEN;
  const p = project(look, options.rest);
  const state = createTimeline(p, { screenSize }).frameAt(1);
  const sources: FrameSources = { screens: new Map([[0, screen]]), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };
  const canvas = new OffscreenCanvas(1, 1);
  const renderer = createRenderer(canvas, p, { assets, screenSize, ...(options.watermark && { watermarkImage: options.watermark }) });
  const gl = canvas.getContext('webgl2')!;
  renderer.render(state, sources);
  const pixels = readPixels(gl);
  renderer.dispose();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return pixels;
}

const rgb = (pixels: Pixels, x: number, y: number) => pixelAt(pixels, Math.round(x), Math.round(y)).slice(0, 3);
const near = (actual: number[], hex: string, within = 6) => {
  const expected = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return actual.every((value, i) => Math.abs(value - expected[i]!) <= within);
};
/** The brightest channel in a rect of the picture. */
function brightest(pixels: Pixels, [x, y, w, h]: number[]): number {
  let most = 0;
  for (let row = Math.round(y!); row < y! + h!; row++) for (let column = Math.round(x!); column < x! + w!; column++) most = Math.max(most, ...rgb(pixels, column, row));
  return most;
}

describe('the window frames', () => {
  it('draw a dark browser: its bar and its dark address field', () => {
    const pixels = render({ frame: { style: 'browser-dark', title: '' } });
    const { layout } = frameLayout(OUTPUT, project({}).look, 'browser-dark', SCREEN.width / SCREEN.height);
    const [x, y, w] = layout.window;
    expect(near(rgb(pixels, x + w / 2, y + layout.titleBar / 2), '#1C1C20')).toBe(true);
    expect(near(rgb(pixels, x + w * 0.8, y + layout.titleBar / 2), '#2B2B30')).toBe(true);
  });

  it('draw Windows: its bar, its title on the left and the caption buttons on the right', () => {
    for (const [style, bar, glyph] of [['windows-dark', '#202020', true], ['windows-light', '#F3F3F3', false]] as const) {
      const pixels = render({ frame: { style, title: 'Notes' } });
      const { layout } = frameLayout(OUTPUT, project({}).look, style, SCREEN.width / SCREEN.height);
      const [x, y, w] = layout.window;
      const unit = OUTPUT.height / 1080;
      expect(near(rgb(pixels, x + w * 0.5, y + layout.titleBar / 2), bar), style).toBe(true);
      // the close glyph in the last 46 units, the title's ink in the first part
      const close: number[] = [x + w - 46 * unit, y, 46 * unit, layout.titleBar];
      const title: number[] = [x + 10 * unit, y, 80 * unit, layout.titleBar];
      if (glyph) {
        expect(brightest(pixels, close), style).toBeGreaterThan(120);
        expect(brightest(pixels, title), style).toBeGreaterThan(120);
      } else {
        const darkest = (rect: number[]) => 255 - brightest({ ...pixels, data: pixels.data.map((value, i) => (i % 4 === 3 ? value : 255 - value)) }, rect);
        expect(darkest(close), style).toBeLessThan(140);
        expect(darkest(title), style).toBeLessThan(140);
      }
    }
  });

  it('draw a terminal: a dark tab on the left of its bar, the prompt and the title in it', () => {
    const pixels = render({ frame: { style: 'terminal', title: 'zsh' } });
    const { layout } = frameLayout(OUTPUT, project({}).look, 'terminal', SCREEN.width / SCREEN.height);
    const [x, y, w] = layout.window;
    const unit = OUTPUT.height / 1080;
    expect(near(rgb(pixels, x + w * 0.6, y + layout.titleBar / 2), '#2B2B2B')).toBe(true);
    // the tab's corner: dark, under the bar's colour
    expect(near(rgb(pixels, x + 10 * unit, y + layout.titleBar - 2), '#0C0C0C', 10)).toBe(true);
    expect(brightest(pixels, [x + 14 * unit, y + 8 * unit, 60 * unit, layout.titleBar - 8 * unit])).toBeGreaterThan(150);
  });
});

describe('the devices', () => {
  const portrait = { width: 720, height: 1560 };

  for (const style of ['iphone', 'android'] as const) {
    it(`draw ${style === 'iphone' ? 'an iPhone' : 'an Android phone'} around the screen: the bezel, the screen inside it, the camera on its top`, () => {
      const pixels = render({ frame: { style } }, { screenSize: portrait });
      const { layout } = frameLayout(OUTPUT, project({}).look, style, portrait.width / portrait.height);
      const [cx, cy, cw, ch] = layout.content;
      const band = cx - layout.window[0];
      expect(band).toBeGreaterThanOrEqual(2);
      // the bezel, black, just left of the screen at its middle (inside the metal band)
      expect(brightest(pixels, [cx - Math.max(1, Math.round(band * 0.3)), cy + ch / 2, 1, 1]), 'bezel').toBeLessThan(40);
      // the camera: dark at the screen's top centre (a lens's glint in it), where the fake screen is not
      const camera = style === 'iphone' ? [cx + cw * 0.45, cy + cw * 0.06] : [cx + cw * 0.5, cy + cw * 0.044];
      expect(brightest(pixels, [camera[0]!, camera[1]!, 1, 1]), 'camera').toBeLessThan(70);
      // the screen's corners are round: a little way into the content's corner, the black bezel shows
      // (its very corner is the metal band's: the body's curve and the screen's share their centre)
      const into = layout.clipRadius * 0.2;
      expect(brightest(pixels, [cx + into, cy + into, 1, 1]), 'corner').toBeLessThan(40);
      // the content's middle is the screen's
      expect(brightest(pixels, [cx + cw / 2 - 2, cy + ch / 2 - 2, 4, 4]), 'screen').toBeGreaterThan(40);
    });
  }
});

describe('the watermark', () => {
  async function red(width: number, height: number): Promise<ImageBitmap> {
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#FF0000';
    g.fillRect(0, 0, width, height);
    return createImageBitmap(canvas, { premultiplyAlpha: 'premultiply' });
  }

  it('draws its image in its corner at its opacity, over everything', async () => {
    const image = await red(200, 100);
    const pixels = render({ frame: { enabled: false }, watermark: { enabled: true, corner: 'bottom-right', size: 0.2, opacity: 0.5 } }, { watermark: image });
    // 72 px high, 144 wide, 40 units (13 px) from the edges
    const [r, g, b] = rgb(pixels, 640 - 13 - 72, 360 - 13 - 36);
    expect(r).toBeGreaterThan(g! + 60);
    expect(r).toBeGreaterThan(b! + 60);
    expect(r).toBeLessThan(250);
    // nothing in the other corners
    const top = rgb(pixels, 20, 20);
    expect(top[0]! - top[1]!).toBeLessThan(40);
  });

  it('draws its text, else the brand\'s name, when it has no image; nothing when it is off', () => {
    const corner = [640 - 13 - 120, 360 - 13 - 22, 120, 22];
    const look = { background: { preset: 'solid', color: '#000000' }, frame: { enabled: false } } as const;
    const fill = (pixels: Pixels) => {
      let lit = 0;
      for (let y = corner[1]!; y < corner[1]! + corner[3]!; y++) for (let x = corner[0]!; x < corner[0]! + corner[2]!; x++) if (rgb(pixels, x, y)[0]! > 120) lit++;
      return lit;
    };
    const text = render({ ...look, watermark: { enabled: true, text: 'cuttle.dev', size: 0.06 } }, { rest: { scenes: [{ type: 'card', title: ' ', duration: 5 }] } });
    expect(fill(text)).toBeGreaterThan(30);
    const named = render({ ...look, watermark: { enabled: true, size: 0.06 } }, { rest: { scenes: [{ type: 'card', title: ' ', duration: 5 }], theme: { name: 'Nimbus' } } });
    expect(fill(named)).toBeGreaterThan(20);
    const off = render({ ...look, watermark: { enabled: false, text: 'cuttle.dev' } }, { rest: { scenes: [{ type: 'card', title: ' ', duration: 5 }] } });
    expect(fill(off)).toBe(0);
  });
});
```

Run: `pnpm exec vitest run --project node packages/engine`
Expected: FAIL: the new frames have no chrome, and there is no clip and no `watermarkRect`.

- [ ] **Step 2: The chrome**

In `packages/engine/src/presets/frames.ts`, replace:

```ts
import type { FrameStyle } from '@cuttle/project';

/** Window chrome per frame style. Sizes are in units (1 px at 1080p), colours are `#RRGGBB`. */
export interface FrameChrome {
  /** Title bar height; 0 means no title bar (the `none` style keeps radius and shadow). */
```

with:

```ts
import type { FrameStyle } from '@cuttle/project';

/**
 * A device around the screen instead of a window: no title bar, a bezel all round and a camera over
 * the screen. Its sizes are shares of the screen's width (a phone's bezel and corners grow with it).
 */
export interface DeviceChrome {
  /** The bezel on every side. */
  bezel: number;
  /** The body's outer corner radius (the screen's is the body's less the bezel). */
  radius: number;
  /** The body, and the metal band around it with the side buttons. */
  body: string;
  edge: string;
  /** The Dynamic Island (a pill) or a punch-hole camera (a dot), at the screen's top centre. */
  camera: 'island' | 'punch';
}

/** Window chrome per frame style. Sizes are in units (1 px at 1080p), colours are `#RRGGBB`. */
export interface FrameChrome {
  /** Title bar height; 0 means no title bar (the `none` style keeps radius and shadow). */
```

In the same file, replace:

```ts
  trafficLights: boolean;
  /** Browser styles draw the title inside an address field. */
  address?: { fill: string };
}

export const FRAME_CHROME: Record<FrameStyle, FrameChrome> = {
```

with:

```ts
  trafficLights: boolean;
  /** Browser styles draw the title inside an address field. */
  address?: { fill: string };
  /** Windows' caption buttons on the right (minimise, maximise, close), in the title's colour; the title then sits on the left. */
  captionButtons?: boolean;
  /** A tab on the left that the title sits in (a terminal's), in this fill, with a prompt before the title. */
  tab?: { fill: string };
  /** A phone around the screen (`titleBar` is 0). */
  device?: DeviceChrome;
}

export const FRAME_CHROME: Record<FrameStyle, FrameChrome> = {
```

In the same file, replace:

```ts
    trafficLights: true,
    address: { fill: '#FFFFFF' },
  },
  none: { titleBar: 0, bar: '#000000', line: '#000000', title: '#000000', trafficLights: false },
};
```

with:

```ts
    trafficLights: true,
    address: { fill: '#FFFFFF' },
  },
  'browser-dark': {
    titleBar: 44,
    bar: '#2B2B30',
    line: '#1C1C20',
    title: '#C8C8D0',
    trafficLights: true,
    address: { fill: '#1C1C20' },
  },
  'windows-light': { titleBar: 32, bar: '#F3F3F3', line: '#E5E5E5', title: '#1B1B1B', trafficLights: false, captionButtons: true },
  'windows-dark': { titleBar: 32, bar: '#202020', line: '#2B2B2B', title: '#F3F3F3', trafficLights: false, captionButtons: true },
  terminal: { titleBar: 38, bar: '#2B2B2B', line: '#0C0C0C', title: '#E6E6E6', trafficLights: false, captionButtons: true, tab: { fill: '#0C0C0C' } },
  iphone: {
    titleBar: 0,
    bar: '#000000',
    line: '#000000',
    title: '#000000',
    trafficLights: false,
    device: { bezel: 0.045, radius: 0.155, body: '#050506', edge: '#4A4A4F', camera: 'island' },
  },
  android: {
    titleBar: 0,
    bar: '#000000',
    line: '#000000',
    title: '#000000',
    trafficLights: false,
    device: { bezel: 0.035, radius: 0.12, body: '#08080A', edge: '#2E2F33', camera: 'punch' },
  },
  none: { titleBar: 0, bar: '#000000', line: '#000000', title: '#000000', trafficLights: false },
};
```

In the same file, replace:

```ts
/** Address field size in units; its width is capped at half the window. */
export const ADDRESS_FIELD = { width: 560, height: 26, radius: 8 } as const;

/** Window shadow in units, and its opacity. */
export const WINDOW_SHADOW = { blur: 48, offset: 18, opacity: 0.5 } as const;
```

with:

```ts
/** Address field size in units; its width is capped at half the window. */
export const ADDRESS_FIELD = { width: 560, height: 26, radius: 8 } as const;

/** Windows' caption buttons in units: each this wide, their glyphs this large; the title starts this far in. */
export const CAPTION_BUTTONS = { width: 46, glyph: 10, titleInset: 14 } as const;

/** A terminal's tab in units: its inset from the window's top left, its corner radius and padding. */
export const TAB = { inset: 8, radius: 8, pad: 14 } as const;

/** Window shadow in units, and its opacity. */
export const WINDOW_SHADOW = { blur: 48, offset: 18, opacity: 0.5 } as const;
```

In `packages/engine/src/presets/labels.ts`, replace:

```ts
};

/** Window title; its colour comes from the frame style. */
export function windowTitleStyle(color: string): LabelStyle {
  return { size: 14, weight: 400, color, padX: 0, padY: 0, radius: 0, align: 'center' };
}
```

with:

```ts
};

/** Window title; its colour comes from the frame style. */
/** A text watermark `height` px high (white, a soft shadow so it reads on any picture), at `unit`. */
export function watermarkStyle(height: number, unit: number): LabelStyle {
  return { size: Math.max(6, (height / unit) * 0.72), weight: 600, color: '#FFFFFF', padX: 0, padY: 0, radius: 0, shadow: { blur: 6, y: 1, color: 'rgba(0, 0, 0, 0.45)' }, align: 'left' };
}

export function windowTitleStyle(color: string): LabelStyle {
  return { size: 14, weight: 400, color, padX: 0, padY: 0, radius: 0, align: 'center' };
}
```

- [ ] **Step 3: The layout's clip, a phone's bezel, the watermark's place**

In `packages/engine/src/layout.ts`, replace:

```ts
  radius: number;
  /** Title bar height in output px; 0 without one. */
  titleBar: number;
}

/**
 * Centres a window whose content has the aspect ratio `contentAspect` (width / height) in the
 * output, `WINDOW_PADDING` units from the edges. `chrome` sizes are in units. Without chrome the
 * content fills the output (letterboxed) with square corners. Results are whole pixels.
 */
export function windowLayout(
  output: Size,
  contentAspect: number,
  chrome: { titleBar: number; radius: number } | null,
): WindowLayout {
  const unit = unitFor(output);
  const padding = chrome ? WINDOW_PADDING * unit : 0;
  const titleBar = chrome ? Math.round(chrome.titleBar * unit) : 0;
  const availableWidth = output.width - 2 * padding;
  const availableHeight = output.height - 2 * padding - titleBar;
```

with:

```ts
  radius: number;
  /** Title bar height in output px; 0 without one. */
  titleBar: number;
  /**
   * What the content, the masks and the cursor are clipped to, in output px, with its corner radius:
   * the window (its rounded corners), or a device's screen inside its bezel.
   */
  clip: Rect;
  clipRadius: number;
}

/**
 * Centres a window whose content has the aspect ratio `contentAspect` (width / height) in the
 * output, `WINDOW_PADDING` units from the edges. `chrome` sizes are in units. Without chrome the
 * content fills the output (letterboxed) with square corners. A `device` has no title bar but a
 * bezel all round, its bezel and corner radius shares of the screen's short side (a phone held
 * either way). Results are whole pixels.
 */
export function windowLayout(
  output: Size,
  contentAspect: number,
  chrome: { titleBar: number; radius: number; device?: { bezel: number; radius: number } } | null,
): WindowLayout {
  const unit = unitFor(output);
  const padding = chrome ? WINDOW_PADDING * unit : 0;
  if (chrome?.device) {
    const { bezel, radius } = chrome.device;
    // the screen as large as the output allows with the bezel (a share of its short side) around it
    const short = Math.min(contentAspect, 1);
    const exact = Math.min((output.width - 2 * padding) / (contentAspect + 2 * bezel * short), (output.height - 2 * padding) / (1 + 2 * bezel * short));
    const height = Math.round(exact);
    const width = Math.round(exact * contentAspect);
    const band = Math.round(bezel * Math.min(width, height));
    const x = Math.round((output.width - width) / 2);
    const y = Math.round((output.height - height) / 2);
    const window: Rect = [x - band, y - band, width + 2 * band, height + 2 * band];
    const outer = Math.min(radius * Math.min(window[2], window[3]), window[2] / 2, window[3] / 2);
    return { window, content: [x, y, width, height], radius: outer, titleBar: 0, clip: [x, y, width, height], clipRadius: Math.max(0, outer - band) };
  }
  const titleBar = chrome ? Math.round(chrome.titleBar * unit) : 0;
  const availableWidth = output.width - 2 * padding;
  const availableHeight = output.height - 2 * padding - titleBar;
```

In the same file, replace:

```ts
  const x = Math.round((output.width - width) / 2);
  const y = Math.round((output.height - height - titleBar) / 2);
  const radius = chrome ? Math.min(chrome.radius * unit, width / 2, (height + titleBar) / 2) : 0;
  return { window: [x, y, width, height + titleBar], content: [x, y + titleBar, width, height], radius, titleBar };
}

/** Maps a point in source px to output px, for a screen cropped to `zoom` and shown in `content`. */
```

with:

```ts
  const x = Math.round((output.width - width) / 2);
  const y = Math.round((output.height - height - titleBar) / 2);
  const radius = chrome ? Math.min(chrome.radius * unit, width / 2, (height + titleBar) / 2) : 0;
  const window: Rect = [x, y, width, height + titleBar];
  return { window, content: [x, y + titleBar, width, height], radius, titleBar, clip: window, clipRadius: radius };
}

/** Maps a point in source px to output px, for a screen cropped to `zoom` and shown in `content`. */
```

In the same file, replace:

```ts
  return [x, y, diameter, diameter];
}

/** Space between a text overlay and the output edge, in units. */
export const OVERLAY_MARGIN = 56;
```

with:

```ts
  return [x, y, diameter, diameter];
}

/** Space between the watermark and the output's edges, in units. */
export const WATERMARK_MARGIN = 40;

/**
 * The watermark's rect in output px: `size` is its height as a share of the output's short side,
 * `aspect` its own (width / height); in its `corner`, a margin from the edges, and past the
 * webcam bubble (`avoid`) when they share a corner (above it at the bottom, below it at the top).
 */
export function watermarkRect(output: Size, watermark: Pick<Look['watermark'], 'corner' | 'size'>, aspect: number, avoid?: Rect): Rect {
  const unit = unitFor(output);
  const margin = Math.round(WATERMARK_MARGIN * unit);
  const height = Math.round(watermark.size * Math.min(output.width, output.height));
  const width = Math.min(Math.round(height * aspect), output.width - 2 * margin);
  const x = watermark.corner.endsWith('left') ? margin : output.width - margin - width;
  let y = watermark.corner.startsWith('top') ? margin : output.height - margin - height;
  const rect: Rect = [x, y, width, height];
  if (avoid && overlaps(rect, avoid)) y = watermark.corner.startsWith('top') ? avoid[1] + avoid[3] + Math.round(margin / 2) : avoid[1] - height - Math.round(margin / 2);
  return [x, y, width, height];
}

/** Space between a text overlay and the output edge, in units. */
export const OVERLAY_MARGIN = 56;
```

In `packages/engine/src/view.ts`, replace:

```ts
/** The window for a frame style (none: the content fills the output); `aspect` is the content's. */
export function frameLayout(output: Size, look: Pick<Look, 'frame'>, style: FrameStyle | null, aspect: number): { chrome: FrameChrome | null; layout: WindowLayout } {
  const chrome = style ? FRAME_CHROME[style] : null;
  return { chrome, layout: windowLayout(output, aspect, chrome ? { titleBar: chrome.titleBar, radius: look.frame.radius } : null) };
}

/** Where a clip shows the screen in a frame: the part of the screen recording and the rect of the output it fills. */
```

with:

```ts
/** The window for a frame style (none: the content fills the output); `aspect` is the content's. */
export function frameLayout(output: Size, look: Pick<Look, 'frame'>, style: FrameStyle | null, aspect: number): { chrome: FrameChrome | null; layout: WindowLayout } {
  const chrome = style ? FRAME_CHROME[style] : null;
  return { chrome, layout: windowLayout(output, aspect, chrome ? { titleBar: chrome.titleBar, radius: look.frame.radius, ...(chrome.device && { device: chrome.device }) } : null) };
}

/** Where a clip shows the screen in a frame: the part of the screen recording and the rect of the output it fills. */
```

- [ ] **Step 4: The passes clip to it; the window pass draws the chrome, the phones and their cameras**

In `packages/engine/src/passes/content.ts`, replace:

```ts
  o_color = vec4(color * a, a);
}`;

/** The screen (cropped to the zoom) or a still image, drawn into the content rect and clipped to the window's rounded corners. */
export class ContentPass {
  private readonly shader: Shader;
```

with:

```ts
  o_color = vec4(color * a, a);
}`;

/** The screen (cropped to the zoom) or a still image, drawn into the content rect and clipped to the window's rounded corners (a device's screen). */
export class ContentPass {
  private readonly shader: Shader;
```

In the same file, replace:

```ts
      .use()
      .texture('u_tex', 0, texture)
      .vec4('u_crop', crop)
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius)
      .vec3('u_matte', matte);
    drawRect(this.gl, this.shader, layout.content, this.output);
  }
```

with:

```ts
      .use()
      .texture('u_tex', 0, texture)
      .vec4('u_crop', crop)
      .vec4('u_window', layout.clip)
      .float('u_radius', layout.clipRadius)
      .vec3('u_matte', matte);
    drawRect(this.gl, this.shader, layout.content, this.output);
  }
```

In `packages/engine/src/passes/cursor.ts`, replace:

```ts
      .float('u_lightRadius', 3.2 * size)
      .float('u_soft', size)
      .vec3('u_color', color)
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius);
    drawRect(this.gl, this.spotlight, layout.content, this.output);
  }
```

with:

```ts
      .float('u_lightRadius', 3.2 * size)
      .float('u_soft', size)
      .vec3('u_color', color)
      .vec4('u_window', layout.clip)
      .float('u_radius', layout.clipRadius);
    drawRect(this.gl, this.spotlight, layout.content, this.output);
  }
```

In the same file, replace:

```ts
      .float('u_width', width)
      .vec3('u_color', color)
      .float('u_alpha', alpha)
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius);
    drawRect(this.gl, this.ripple, [x - extent, y - extent, 2 * extent, 2 * extent], this.output);
  }
```

with:

```ts
      .float('u_width', width)
      .vec3('u_color', color)
      .float('u_alpha', alpha)
      .vec4('u_window', layout.clip)
      .float('u_radius', layout.clipRadius);
    drawRect(this.gl, this.ripple, [x - extent, y - extent, 2 * extent, 2 * extent], this.output);
  }
```

In the same file, replace:

```ts
      const [hx, hy] = CURSOR_ART[image].hotspot;
      const texture = this.images.get(image);
      if (!texture) throw new Error(`cursor image ${image} was not loaded`);
      this.image.use().texture('u_tex', 0, texture).vec4('u_window', layout.window).float('u_radius', layout.radius);
      drawRect(this.gl, this.image, [x - (hx / CURSOR_GRID) * size, y - (hy / CURSOR_GRID) * size, size, size], this.output);
      return;
    }
```

with:

```ts
      const [hx, hy] = CURSOR_ART[image].hotspot;
      const texture = this.images.get(image);
      if (!texture) throw new Error(`cursor image ${image} was not loaded`);
      this.image.use().texture('u_tex', 0, texture).vec4('u_window', layout.clip).float('u_radius', layout.clipRadius);
      drawRect(this.gl, this.image, [x - (hx / CURSOR_GRID) * size, y - (hy / CURSOR_GRID) * size, size, size], this.output);
      return;
    }
```

In the same file, replace:

```ts
      .float('u_shapeRadius', radius)
      .vec3('u_color', color)
      .int('u_kind', kind)
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius);
    drawRect(this.gl, this.shape, [x - extent, y - extent, 2 * extent, 2 * extent], this.output);
  }
```

with:

```ts
      .float('u_shapeRadius', radius)
      .vec3('u_color', color)
      .int('u_kind', kind)
      .vec4('u_window', layout.clip)
      .float('u_radius', layout.clipRadius);
    drawRect(this.gl, this.shape, [x - extent, y - extent, 2 * extent, 2 * extent], this.output);
  }
```

In `packages/engine/src/passes/masks.ts`, replace:

```ts
          .use()
          .texture('u_tex', 0, screen)
          .vec2('u_texel', texel[0], texel[1])
          .vec4('u_window', layout.window)
          .float('u_radius', layout.radius);
        if (mask.style === 'fill') {
          shader.vec4('u_mask', uvRect(mask.rect, screenSize));
        } else {
```

with:

```ts
          .use()
          .texture('u_tex', 0, screen)
          .vec2('u_texel', texel[0], texel[1])
          .vec4('u_window', layout.clip)
          .float('u_radius', layout.clipRadius);
        if (mask.style === 'fill') {
          shader.vec4('u_mask', uvRect(mask.rect, screenSize));
        } else {
```

In `packages/engine/src/passes/window.ts`, replace:

```ts
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { unitFor, type Size, type WindowLayout } from '../layout';
import { ADDRESS_FIELD, TRAFFIC_LIGHT, TRAFFIC_LIGHTS, WINDOW_SHADOW, type FrameChrome } from '../presets/frames';
import { windowTitleStyle } from '../presets/labels';
import type { SpriteCache } from '../sprites';
import type { SpritePass } from './sprite';
```

with:

```ts
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { unitFor, type Size, type WindowLayout } from '../layout';
import { ADDRESS_FIELD, CAPTION_BUTTONS, TAB, TRAFFIC_LIGHT, TRAFFIC_LIGHTS, WINDOW_SHADOW, type DeviceChrome, type FrameChrome } from '../presets/frames';
import { windowTitleStyle } from '../presets/labels';
import type { SpriteCache } from '../sprites';
import type { SpritePass } from './sprite';
```

In the same file, replace:

```ts
uniform vec4 u_address;     // address field rect; width 0 draws none
uniform float u_addressRadius;
uniform vec3 u_addressColor;
void main() {
  float inside = coverage(sdRoundRect(v_px, u_window, u_radius));
  vec3 color = mix(u_barColor, u_lineColor, step(u_window.y + u_titleBar - u_line, v_px.y));
  if (u_address.z > 0.0) color = mix(color, u_addressColor, coverage(sdRoundRect(v_px, u_address, u_addressRadius)));
  if (u_lights.z > 0.0) {
    vec2 first = vec2(u_window.x + u_lights.x, u_window.y + u_titleBar * 0.5);
    color = mix(color, u_light0, coverage(length(v_px - first) - u_lights.z));
    color = mix(color, u_light1, coverage(length(v_px - first - vec2(u_lights.y, 0.0)) - u_lights.z));
    color = mix(color, u_light2, coverage(length(v_px - first - vec2(2.0 * u_lights.y, 0.0)) - u_lights.z));
  }
  o_color = vec4(color * inside, inside);
}`;

/** The window's soft shadow, title bar, traffic lights, address field and title. */
export class WindowPass {
  private readonly shadow: Shader;
  private readonly chrome: Shader;
  private readonly unit: number;

  constructor(
```

with:

```ts
uniform vec4 u_address;     // address field rect; width 0 draws none
uniform float u_addressRadius;
uniform vec3 u_addressColor;
uniform vec3 u_caption;     // button width, glyph size, stroke in px; width 0 draws none
uniform vec3 u_glyphColor;
uniform vec4 u_tab;         // a tab's rect (its bottom runs into the content); width 0 draws none
uniform float u_tabRadius;
uniform vec3 u_tabColor;

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

void main() {
  float inside = coverage(sdRoundRect(v_px, u_window, u_radius));
  vec3 color = mix(u_barColor, u_lineColor, step(u_window.y + u_titleBar - u_line, v_px.y));
  if (u_address.z > 0.0) color = mix(color, u_addressColor, coverage(sdRoundRect(v_px, u_address, u_addressRadius)));
  if (u_tab.z > 0.0) {
    // rounded at the top only: the rect runs a radius below the bar, clipped at the bar's foot
    vec4 tab = vec4(u_tab.xy, u_tab.z, u_tab.w + u_tabRadius);
    float under = step(v_px.y, u_window.y + u_titleBar);
    color = mix(color, u_tabColor, coverage(sdRoundRect(v_px, tab, u_tabRadius)) * under);
  }
  if (u_lights.z > 0.0) {
    vec2 first = vec2(u_window.x + u_lights.x, u_window.y + u_titleBar * 0.5);
    color = mix(color, u_light0, coverage(length(v_px - first) - u_lights.z));
    color = mix(color, u_light1, coverage(length(v_px - first - vec2(u_lights.y, 0.0)) - u_lights.z));
    color = mix(color, u_light2, coverage(length(v_px - first - vec2(2.0 * u_lights.y, 0.0)) - u_lights.z));
  }
  if (u_caption.x > 0.0) {
    // Windows' minimise, maximise and close, right to left from the window's right edge
    float cy = u_window.y + u_titleBar * 0.5;
    float right = u_window.x + u_window.z;
    float g = u_caption.y * 0.5;
    float stroke = u_caption.z * 0.5;
    vec2 close = vec2(right - u_caption.x * 0.5, cy);
    vec2 maximise = close - vec2(u_caption.x, 0.0);
    vec2 minimise = maximise - vec2(u_caption.x, 0.0);
    float d = segment(v_px, minimise - vec2(g, 0.0), minimise + vec2(g, 0.0)) - stroke;
    d = min(d, abs(sdRoundRect(v_px, vec4(maximise - vec2(g), vec2(2.0 * g)), 0.0)) - stroke);
    d = min(d, segment(v_px, close - vec2(g), close + vec2(g)) - stroke);
    d = min(d, segment(v_px, close + vec2(-g, g), close + vec2(g, -g)) - stroke);
    color = mix(color, u_glyphColor, coverage(d));
  }
  o_color = vec4(color * inside, inside);
}`;

const DEVICE = `${FRAGMENT_PRELUDE}
uniform vec4 u_window;
uniform float u_radius;
uniform float u_edge;       // the metal band's width in px
uniform vec3 u_body;
uniform vec3 u_metal;
uniform vec4 u_buttons[4];  // side buttons: x, y (top), width, height; width 0 draws none
void main() {
  float body = sdRoundRect(v_px, u_window, u_radius);
  // the side buttons, behind the band: metal, a little lighter at their edge
  float buttons = 1e5;
  for (int i = 0; i < 4; i++) {
    if (u_buttons[i].z > 0.0) buttons = min(buttons, sdRoundRect(v_px, u_buttons[i], min(u_buttons[i].z, u_buttons[i].w) * 0.5));
  }
  // the band: metal catching the light from the top left, the body black inside it
  vec2 uv = (v_px - u_window.xy) / u_window.zw;
  vec3 metal = u_metal * (0.82 + 0.36 * (1.0 - (uv.x + uv.y) * 0.5));
  vec3 color = mix(u_body, metal, 1.0 - smoothstep(u_edge - 1.0, u_edge, -body));
  float a = max(coverage(body), coverage(buttons));
  color = mix(metal * 0.9, color, coverage(body));
  o_color = vec4(color * a, a);
}`;

const CAMERA = `${FRAGMENT_PRELUDE}
uniform vec4 u_shape;       // the island's or the dot's rect
void main() {
  float d = sdRoundRect(v_px, u_shape, min(u_shape.z, u_shape.w) * 0.5);
  float a = coverage(d);
  // a lens glint in the dot, or in the island's end towards the phone's right (its top, held across)
  float thin = min(u_shape.z, u_shape.w);
  vec2 lens = u_shape.z >= u_shape.w ? vec2(u_shape.x + u_shape.z - thin * 0.5, u_shape.y + thin * 0.5) : vec2(u_shape.x + thin * 0.5, u_shape.y + thin * 0.5);
  float glint = coverage(length(v_px - lens) - thin * 0.22) * 0.18;
  o_color = vec4(vec3(0.02 + glint) * a, a);
}`;

/**
 * A rect given as the phone is held upright (`short` wide, `long` high, from its top left), in a
 * window held either way: across, the phone is turned a quarter to the left (its top on the left).
 */
function held(window: Rect, [px, py, pw, ph]: Rect): Rect {
  const [x, y, w, h] = window;
  return w <= h ? [x + px, y + py, pw, ph] : [x + py, y + h - px - pw, ph, pw];
}

/** The side buttons of a device, as rects outside its body (upright: action and volume on the left, power on the right). */
function sideButtons(window: Rect, device: DeviceChrome): Rect[] {
  const short = Math.min(window[2], window[3]);
  const long = Math.max(window[2], window[3]);
  const depth = Math.max(2, Math.round(short * 0.012));
  const left = -depth + 1;
  const right = short - 1;
  const at = (top: number, length: number, side: number): Rect => held(window, [side, Math.round(long * top), depth, Math.round(long * length)]);
  return device.camera === 'island'
    ? [at(0.17, 0.045, left), at(0.25, 0.085, left), at(0.355, 0.085, left), at(0.28, 0.12, right)]
    : [at(0.2, 0.07, right), at(0.32, 0.15, right)];
}

/** The window's soft shadow, title bar (traffic lights, address field, caption buttons, a tab) and title; or a device's body, and its camera. */
export class WindowPass {
  private readonly shadow: Shader;
  private readonly chrome: Shader;
  private readonly device: Shader;
  private readonly camera: Shader;
  private readonly unit: number;

  constructor(
```

In the same file, replace:

```ts
  ) {
    this.shadow = new Shader(gl, 'window shadow', RECT_VERTEX, SHADOW);
    this.chrome = new Shader(gl, 'window chrome', RECT_VERTEX, CHROME);
    this.unit = unitFor(output);
  }

  draw(layout: WindowLayout, chrome: FrameChrome, shadow: boolean, title: string): void {
    const u = this.unit;
    const [x, y, w, h] = layout.window;
```

with:

```ts
  ) {
    this.shadow = new Shader(gl, 'window shadow', RECT_VERTEX, SHADOW);
    this.chrome = new Shader(gl, 'window chrome', RECT_VERTEX, CHROME);
    this.device = new Shader(gl, 'device', RECT_VERTEX, DEVICE);
    this.camera = new Shader(gl, 'device camera', RECT_VERTEX, CAMERA);
    this.unit = unitFor(output);
  }

  /** Everything under the content: the shadow, then the title bar or the device's body. */
  draw(layout: WindowLayout, chrome: FrameChrome, shadow: boolean, title: string): void {
    const u = this.unit;
    const [x, y, w, h] = layout.window;
```

In the same file, replace:

```ts
        .float('u_opacity', WINDOW_SHADOW.opacity);
      drawRect(this.gl, this.shadow, [x - blur, y - blur + offset, w + 2 * blur, h + 2 * blur], this.output);
    }
    if (layout.titleBar === 0) return;

    const address: Rect = chrome.address
```

with:

```ts
        .float('u_opacity', WINDOW_SHADOW.opacity);
      drawRect(this.gl, this.shadow, [x - blur, y - blur + offset, w + 2 * blur, h + 2 * blur], this.output);
    }
    if (chrome.device) return this.drawDevice(layout, chrome.device);
    if (layout.titleBar === 0) return;

    const address: Rect = chrome.address
```

In the same file, replace:

```ts
          return [x + Math.round((w - width) / 2), y + Math.round((layout.titleBar - height) / 2), width, height];
        })()
      : [0, 0, 0, 0];
    this.chrome
      .use()
      .vec4('u_window', layout.window)
```

with:

```ts
          return [x + Math.round((w - width) / 2), y + Math.round((layout.titleBar - height) / 2), width, height];
        })()
      : [0, 0, 0, 0];
    // the caption buttons take the right; a title or a tab on the left stays clear of them
    const buttons = chrome.captionButtons ? CAPTION_BUTTONS.width * 3 * u : 0;
    const text = chrome.tab ? `›_   ${title}`.trimEnd() : title;
    const maxWidth = chrome.address ? address[2] - 24 * u : chrome.captionButtons ? w - buttons - 2 * CAPTION_BUTTONS.titleInset * u - (chrome.tab ? 2 * TAB.pad * u : 0) : w * 0.6;
    const sprite = text === '' ? undefined : this.sprites.label(text, windowTitleStyle(chrome.title), u, Math.max(1, maxWidth));
    const tab: Rect = chrome.tab
      ? [x + Math.round(TAB.inset * u), y + Math.round(TAB.inset * u), Math.round((sprite?.box.width ?? 0) + 2 * TAB.pad * u), layout.titleBar - Math.round(TAB.inset * u)]
      : [0, 0, 0, 0];
    this.chrome
      .use()
      .vec4('u_window', layout.window)
```

In the same file, replace:

```ts
      .vec3('u_light2', hexToRgb(TRAFFIC_LIGHTS[2]))
      .vec4('u_address', address)
      .float('u_addressRadius', ADDRESS_FIELD.radius * u)
      .vec3('u_addressColor', hexToRgb(chrome.address?.fill ?? '#FFFFFF'));
    drawRect(this.gl, this.chrome, [x, y, w, layout.titleBar], this.output);

    if (title === '') return;
    const area: Rect = chrome.address ? address : [x, y, w, layout.titleBar];
    const maxWidth = chrome.address ? area[2] - 24 * u : w * 0.6;
    const sprite = this.sprites.label(title, windowTitleStyle(chrome.title), u, maxWidth);
    this.spritePass.drawSprite(
      sprite,
      Math.round(area[0] + (area[2] - sprite.box.width) / 2),
      Math.round(area[1] + (area[3] - sprite.box.height) / 2),
      1,
    );
  }

  dispose(): void {
    this.shadow.dispose();
    this.chrome.dispose();
  }
}
```

with:

```ts
      .vec3('u_light2', hexToRgb(TRAFFIC_LIGHTS[2]))
      .vec4('u_address', address)
      .float('u_addressRadius', ADDRESS_FIELD.radius * u)
      .vec3('u_addressColor', hexToRgb(chrome.address?.fill ?? '#FFFFFF'))
      .vec3('u_caption', chrome.captionButtons ? [CAPTION_BUTTONS.width * u, CAPTION_BUTTONS.glyph * u, Math.max(1, u)] : [0, 0, 0])
      .vec3('u_glyphColor', hexToRgb(chrome.title))
      .vec4('u_tab', tab)
      .float('u_tabRadius', TAB.radius * u)
      .vec3('u_tabColor', hexToRgb(chrome.tab?.fill ?? chrome.bar));
    drawRect(this.gl, this.chrome, [x, y, w, layout.titleBar], this.output);

    if (!sprite) return;
    const top = (area: Rect) => Math.round(area[1] + (area[3] - sprite.box.height) / 2);
    if (chrome.tab) return this.spritePass.drawSprite(sprite, Math.round(tab[0] + TAB.pad * u), top(tab), 1);
    if (chrome.captionButtons) return this.spritePass.drawSprite(sprite, Math.round(x + CAPTION_BUTTONS.titleInset * u), top([x, y, w, layout.titleBar]), 1);
    const area: Rect = chrome.address ? address : [x, y, w, layout.titleBar];
    this.spritePass.drawSprite(sprite, Math.round(area[0] + (area[2] - sprite.box.width) / 2), top(area), 1);
  }

  /** A device's body: its side buttons, its metal band and its black bezel (the screen comes on top). */
  private drawDevice(layout: WindowLayout, device: DeviceChrome): void {
    const [x, y, w, h] = layout.window;
    const buttons = sideButtons(layout.window, device);
    const shader = this.device
      .use()
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius)
      .float('u_edge', Math.max(1.5, Math.min(w, h) * 0.012))
      .vec3('u_body', hexToRgb(device.body))
      .vec3('u_metal', hexToRgb(device.edge));
    for (let i = 0; i < 4; i++) shader.vec4(`u_buttons[${i}]`, buttons[i] ?? [0, 0, 0, 0]);
    const reach = Math.max(2, Math.round(Math.min(w, h) * 0.012));
    drawRect(this.gl, shader, [x - reach, y - reach, w + 2 * reach, h + 2 * reach], this.output);
  }

  /** What sits over a device's screen: the Dynamic Island or the punch-hole camera, at its top centre (held across: its left). */
  drawOver(layout: WindowLayout, chrome: FrameChrome): void {
    const device = chrome.device;
    if (!device) return;
    const s = Math.min(layout.clip[2], layout.clip[3]);
    const upright: Rect = device.camera === 'island' ? [s * 0.35, s * 0.03, s * 0.3, s * 0.088] : [s * 0.484, s * 0.028, s * 0.032, s * 0.032];
    const shape = held(layout.clip, upright).map(Math.round) as Rect;
    this.camera.use().vec4('u_shape', shape);
    drawRect(this.gl, this.camera, shape, this.output);
  }

  dispose(): void {
    this.shadow.dispose();
    this.chrome.dispose();
    this.device.dispose();
    this.camera.dispose();
  }
}
```

- [ ] **Step 5: The renderer: the camera over the screen, the watermark last**

In `packages/engine/src/renderer.ts`, replace:

```ts
import { CAPTION_LOOKS, drawCaption } from './captions';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, sourceSize, uploadPixels, uploadTexture } from './gl/texture';
import { placeBadge, placeOverlay, stillCrop, unitFor, uvRect, webcamRect, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
import { CursorPass } from './passes/cursor';
```

with:

```ts
import { CAPTION_LOOKS, drawCaption } from './captions';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, sourceSize, uploadPixels, uploadTexture } from './gl/texture';
import { placeBadge, placeOverlay, stillCrop, unitFor, uvRect, watermarkRect, webcamRect, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
import { CursorPass } from './passes/cursor';
```

In the same file, replace:

```ts
import { WebcamPass } from './passes/webcam';
import { WindowPass } from './passes/window';
import type { FrameChrome } from './presets/frames';
import { BADGE_STYLE, CARD_SUBTITLE_STYLE, CARD_TITLE_STYLE, TEXT_LABELS } from './presets/labels';
import { SpriteCache } from './sprites';
import { frameLayout } from './view';
```

with:

```ts
import { WebcamPass } from './passes/webcam';
import { WindowPass } from './passes/window';
import type { FrameChrome } from './presets/frames';
import { BADGE_STYLE, CARD_SUBTITLE_STYLE, CARD_TITLE_STYLE, TEXT_LABELS, watermarkStyle } from './presets/labels';
import { SpriteCache } from './sprites';
import { frameLayout } from './view';
```

In the same file, replace:

```ts
  screenSize: Size;
  /** Required when `look.background.preset` is `image`. */
  backgroundImage?: ImageBitmap;
}

function hasPixels(source: TexImageSource): boolean {
```

with:

```ts
  screenSize: Size;
  /** Required when `look.background.preset` is `image`. */
  backgroundImage?: ImageBitmap;
  /** The watermark's image (its own, else the brand's logo); without it a watermark shows its text. */
  watermarkImage?: ImageBitmap;
}

function hasPixels(source: TexImageSource): boolean {
```

In the same file, replace:

```ts
  const motionTexture = texture(false);
  const fullFrame: Rect = [0, 0, output.width, output.height];
  let uploadedStill: ImageBitmap | undefined;
  let layerTarget: RenderTarget | undefined;
  let disposed = false;
  let drawn: DrawnText[] = [];
```

with:

```ts
  const motionTexture = texture(false);
  const fullFrame: Rect = [0, 0, output.width, output.height];
  let uploadedStill: ImageBitmap | undefined;
  // the watermark: an image uploaded once, else its text (its own, else the brand's name)
  const watermark = look.watermark.enabled ? look.watermark : undefined;
  const watermarkText = watermark && !options.watermarkImage ? (watermark.text ?? project.theme.name ?? '').trim() : '';
  let watermarkTexture: WebGLTexture | undefined;
  if (watermark && options.watermarkImage && options.watermarkImage.width > 0) {
    watermarkTexture = texture(true);
    uploadTexture(gl, watermarkTexture, options.watermarkImage, true);
  }
  let layerTarget: RenderTarget | undefined;
  let disposed = false;
  let drawn: DrawnText[] = [];
```

In the same file, replace:

```ts
    content.draw(screenTexture, uvRect(zoom, screenSize), layout);
    masks.draw(layer.masks, screenTexture, screenSize, zoom, layout);
    if (layer.cursor) cursor.draw(layer.cursor, look.cursor, screenSize, zoom, layout);
    // An empty webcam frame counts as missing: no bubble, as when the webcam track is shorter.
    const camera = look.webcam.enabled ? sources.webcams.get(layer.index) : undefined;
    if (camera && hasPixels(camera)) {
```

with:

```ts
    content.draw(screenTexture, uvRect(zoom, screenSize), layout);
    masks.draw(layer.masks, screenTexture, screenSize, zoom, layout);
    if (layer.cursor) cursor.draw(layer.cursor, look.cursor, screenSize, zoom, layout);
    // a device's camera over its screen
    if (chrome) windowPass.drawOver(layout, chrome);
    // An empty webcam frame counts as missing: no bubble, as when the webcam track is shorter.
    const camera = look.webcam.enabled ? sources.webcams.get(layer.index) : undefined;
    if (camera && hasPixels(camera)) {
```

In the same file, replace:

```ts
    const size = { width: image.width, height: image.height };
    const crop = stillCrop(size, { width: layout.content[2], height: layout.content[3] }, scene.motion, layer.progress);
    content.draw(stillTexture, uvRect(crop, size), layout, STILL_MATTE);
  }

  function drawCard(scene: CardScene): void {
```

with:

```ts
    const size = { width: image.width, height: image.height };
    const crop = stillCrop(size, { width: layout.content[2], height: layout.content[3] }, scene.motion, layer.progress);
    content.draw(stillTexture, uvRect(crop, size), layout, STILL_MATTE);
    if (chrome) windowPass.drawOver(layout, chrome);
  }

  function drawCard(scene: CardScene): void {
```

In the same file, replace:

```ts
    gl.clearColor(0, 0, 0, 1);
  }

  /** One layer drawn whole into the offscreen target and read back, top row first. */
  function readLayer(layer: SceneFrame, sources: FrameSources, t: number): MotionPixels {
    layerTarget ??= createRenderTarget(gl, output);
```

with:

```ts
    gl.clearColor(0, 0, 0, 1);
  }

/** The watermark over everything, last, in its corner. */
  function drawWatermark(): void {
    if (!watermark) return;
    const image = options.watermarkImage;
    if (watermarkTexture && image) {
      spritePass.draw(watermarkTexture, watermarkRect(output, watermark, image.width / image.height, webcamArea), watermark.opacity);
      return;
    }
    if (watermarkText === '') return;
    const height = Math.round(watermark.size * Math.min(output.width, output.height));
    const sprite = sprites.label(watermarkText, watermarkStyle(height, unit), unit, output.width * 0.5);
    const [x, y] = watermarkRect(output, watermark, sprite.box.width / sprite.box.height, webcamArea);
    spritePass.drawSprite(sprite, x, y, watermark.opacity);
  }

  /** One layer drawn whole into the offscreen target and read back, top row first. */
  function readLayer(layer: SceneFrame, sources: FrameSources, t: number): MotionPixels {
    layerTarget ??= createRenderTarget(gl, output);
```

In the same file, replace:

```ts
        background.draw(state.t);
        drawMotion(between, `transition into scene ${state.transition!.sceneIndex}`);
        if (state.caption) drawCaptionOver(state.caption);
        sprites.endFrame();
        return;
      }
```

with:

```ts
        background.draw(state.t);
        drawMotion(between, `transition into scene ${state.transition!.sceneIndex}`);
        if (state.caption) drawCaptionOver(state.caption);
        drawWatermark();
        sprites.endFrame();
        return;
      }
```

In the same file, replace:

```ts
        spritePass.draw(layerTarget.texture, [0, 0, output.width, output.height], layer.opacity, true);
      }
      if (state.caption) drawCaptionOver(state.caption);
      sprites.endFrame();
    },
    layerPixels(state, sources) {
```

with:

```ts
        spritePass.draw(layerTarget.texture, [0, 0, output.width, output.height], layer.opacity, true);
      }
      if (state.caption) drawCaptionOver(state.caption);
      drawWatermark();
      sprites.endFrame();
    },
    layerPixels(state, sources) {
```

Run: `pnpm exec vitest run --project node packages/engine && pnpm exec vitest run --project browser packages/engine`
Expected: PASS, the golden images unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/engine
git commit -m "engine: Windows, terminal, dark browser and phone frames (a clip for the screen); the watermark, last

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The watermark's image in the export

**Files:**
- Create: `packages/export/src/svg.ts`
- Modify: `packages/export/package.json`, `packages/export/src/job.ts`, `packages/export/src/main/sources.ts`, `packages/export/src/main/export.ts`, `packages/export/src/main/stills.ts`, `packages/export/src/page/images.ts`, `packages/export/src/page/run.ts`, `packages/export/test/main/sources.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/export/test/main/sources.test.ts`, replace:

```ts
    }
  });

  it('refuses a folder without cuttle.json and a project without scenes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cuttle-sources-'));
    dirs.push(dir);
```

with:

```ts
    }
  });

  it('finds the watermark image when it is on: its own, else the brand logo; none when it is off', async () => {
    const files = { ...MEDIA, 'brand/logo.svg': '<svg/>', 'images/mark.png': 'm' };
    const ownDir = await projectDir({ sources: SOURCES, theme: { logo: 'brand/logo.svg' }, look: { watermark: { enabled: true, image: 'images/mark.png' } }, scenes: SCENES }, files);
    expect((await loadSources(ownDir)).watermarkImage).toBe(join(ownDir, 'images', 'mark.png'));
    const logoDir = await projectDir({ sources: SOURCES, theme: { logo: 'brand/logo.svg' }, look: { watermark: { enabled: true } }, scenes: SCENES }, files);
    const logo = await loadSources(logoDir);
    expect(logo.watermarkImage).toBe(join(logoDir, 'brand', 'logo.svg'));
    expect(logo.inputs).toEqual(expect.arrayContaining([logo.watermarkImage]));
    const off = await loadSources(await projectDir({ sources: SOURCES, theme: { logo: 'brand/logo.svg' }, scenes: SCENES }, files));
    expect(off.watermarkImage).toBeUndefined();
    // a watermark with no image and no logo shows its text: nothing to read
    const text = await loadSources(await projectDir({ sources: SOURCES, look: { watermark: { enabled: true, text: 'acme.dev' } }, scenes: SCENES }, files));
    expect(text.watermarkImage).toBeUndefined();
  });

  it('refuses a folder without cuttle.json and a project without scenes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cuttle-sources-'));
    dirs.push(dir);
```

Run: `pnpm exec vitest run --project node packages/export/test/main/sources.test.ts`
Expected: FAIL: the sources have no `watermarkImage`.

- [ ] **Step 2: SVG for the page and the editor**

`packages/export/src/svg.ts`:

```ts
// An SVG as a bitmap for the engine (createImageBitmap reads no SVG from bytes): decoded by an
// image, drawn this many pixels on its longer side. Browser code: the export page and the editor.

/** How large an SVG without a size of its own (a logo's viewBox only) is drawn on its longer side. */
export const SVG_SIZE = 512;

/** Whether a path names an SVG. */
export const isSvg = (path: string): boolean => /\.svg$/i.test(path);

/** The SVG's bytes as a premultiplied bitmap, `SVG_SIZE` px on its longer side. */
export async function svgBitmap(bytes: Uint8Array<ArrayBuffer>): Promise<ImageBitmap> {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth || SVG_SIZE;
    const height = image.naturalHeight || SVG_SIZE;
    const scale = SVG_SIZE / Math.max(width, height);
    // drawn onto a canvas of that size first: a bitmap made from an SVG image of no size of its own comes out empty
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await createImageBitmap(canvas, { premultiplyAlpha: 'premultiply' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

In `packages/export/package.json`, replace:

```json
    "./formats": "./src/formats.ts",
    "./motion-requests": "./src/motion/requests.ts",
    "./motion-params": "./src/motion/params.ts",
    "./music-duck": "./src/music/duck.ts"
  },
  "dependencies": {
    "@cuttle/engine": "workspace:*",
```

with:

```json
    "./formats": "./src/formats.ts",
    "./motion-requests": "./src/motion/requests.ts",
    "./motion-params": "./src/motion/params.ts",
    "./music-duck": "./src/music/duck.ts",
    "./svg": "./src/svg.ts"
  },
  "dependencies": {
    "@cuttle/engine": "workspace:*",
```

In `packages/export/src/page/images.ts`, replace:

```ts
import { host, PageError } from './host';

/**
```

with:

```ts
import { isSvg, svgBitmap } from '../svg';
import { host, PageError } from './host';

/**
```

In the same file, replace:

```ts
 * `maxSize` on its longer side (the GPU's MAX_TEXTURE_SIZE) when it is larger.
 */
export async function loadImage(path: string, maxSize: number, what: string): Promise<ImageBitmap> {
  const blob = new Blob([(await host().readFile(path)) as Uint8Array<ArrayBuffer>]);
  const options: ImageBitmapOptions = { premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' };
  let bitmap: ImageBitmap;
  try {
```

with:

```ts
 * `maxSize` on its longer side (the GPU's MAX_TEXTURE_SIZE) when it is larger.
 */
export async function loadImage(path: string, maxSize: number, what: string): Promise<ImageBitmap> {
  const bytes = (await host().readFile(path)) as Uint8Array<ArrayBuffer>;
  // an SVG (a logo): drawn by an image, at a size of its own
  if (isSvg(path)) return svgBitmap(bytes).catch((error: Error) => Promise.reject(new PageError('invalid-media', `${what} is not an SVG this build can draw (${error.message}): ${path}`)));
  const blob = new Blob([bytes]);
  const options: ImageBitmapOptions = { premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' };
  let bitmap: ImageBitmap;
  try {
```

- [ ] **Step 3: Found, carried, loaded**

In `packages/export/src/main/sources.ts`, replace:

```ts
  transcript?: TranscriptWord[];
  stills: Record<number, string>;
  backgroundImage?: string;
  /** The motion items' pages, when the project has any, and the take as they see it. */
  motion?: MotionPages;
  motionTake?: TakeInputs;
```

with:

```ts
  transcript?: TranscriptWord[];
  stills: Record<number, string>;
  backgroundImage?: string;
  /** The watermark's image, when it is on: its own, else the brand's logo. */
  watermarkImage?: string;
  /** The motion items' pages, when the project has any, and the take as they see it. */
  motion?: MotionPages;
  motionTake?: TakeInputs;
```

In the same file, replace:

```ts
  const take = takeFile?.take;
  // Every file the project names, including sources the look switches off: the output must not
  // replace a recording just because this export does not read it.
  const named = [sources.screen, sources.webcam, sources.mic, sources.cleanMic, sources.events, sources.markers, sources.transcript, look.background.image].filter((path) => path !== undefined);
  const inputs = [resolve(projectPath), ...(screen ? [join(dirname(screen), TAKE_FILE)] : []), ...named.map((path) => resolve(projectDir, path))];
  const result: ProjectSources = { project, ...(screen && { screen }), stills: {}, inputs, warnings: takeFile?.warning ? [takeFile.warning] : [] };
```

with:

```ts
  const take = takeFile?.take;
  // Every file the project names, including sources the look switches off: the output must not
  // replace a recording just because this export does not read it.
  const named = [sources.screen, sources.webcam, sources.mic, sources.cleanMic, sources.events, sources.markers, sources.transcript, look.background.image, look.watermark.image, project.theme.logo].filter((path) => path !== undefined);
  const inputs = [resolve(projectPath), ...(screen ? [join(dirname(screen), TAKE_FILE)] : []), ...named.map((path) => resolve(projectDir, path))];
  const result: ProjectSources = { project, ...(screen && { screen }), stills: {}, inputs, warnings: takeFile?.warning ? [takeFile.warning] : [] };
```

In the same file, replace:

```ts
  if (look.background.preset === 'image' && look.background.image) {
    result.backgroundImage = await existing(projectDir, look.background.image, 'background image (look.background.image)');
  }
  const motion = await motionPages(projectDir, project);
  if (motion) {
    result.motion = motion;
```

with:

```ts
  if (look.background.preset === 'image' && look.background.image) {
    result.backgroundImage = await existing(projectDir, look.background.image, 'background image (look.background.image)');
  }
  const mark = look.watermark.enabled ? (look.watermark.image ?? project.theme.logo) : undefined;
  if (mark) result.watermarkImage = await existing(projectDir, mark, look.watermark.image ? 'watermark image (look.watermark.image)' : 'the brand logo (theme.logo), shown as the watermark');
  const motion = await motionPages(projectDir, project);
  if (motion) {
    result.motion = motion;
```

In `packages/export/src/job.ts`, replace:

```ts
  stills: Record<number, string>;
  /** Image for `look.background.preset: 'image'`. */
  backgroundImage?: string;
  /** Present when the project has motion scenes or overlays. */
  motion?: MotionPages;
  encoder: EncoderPreference;
```

with:

```ts
  stills: Record<number, string>;
  /** Image for `look.background.preset: 'image'`. */
  backgroundImage?: string;
  /** The watermark's image (`look.watermark.image`, else the brand's logo), when it is on. */
  watermarkImage?: string;
  /** Present when the project has motion scenes or overlays. */
  motion?: MotionPages;
  encoder: EncoderPreference;
```

In `packages/export/src/main/export.ts`, replace:

```ts
    ...(opts.captions !== undefined && { captions: opts.captions }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    ...(sources.motion && { motion: sources.motion }),
    encoder: opts.encoder ?? 'auto',
  };
```

with:

```ts
    ...(opts.captions !== undefined && { captions: opts.captions }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    watermarkImage: sources.watermarkImage,
    ...(sources.motion && { motion: sources.motion }),
    encoder: opts.encoder ?? 'auto',
  };
```

In the same file, replace:

```ts
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const video = join(work, 'video.mp4');
    const images = [...Object.values(sources.stills), ...(sources.backgroundImage ? [sources.backgroundImage] : [])];
    const host = new FileHost([...(sources.screen ? [sources.screen] : []), ...(sources.webcam ? [sources.webcam.path] : [])], video, images);
    files = host;
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
```

with:

```ts
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const video = join(work, 'video.mp4');
    const images = [...Object.values(sources.stills), ...[sources.backgroundImage, sources.watermarkImage].filter((path): path is string => path !== undefined)];
    const host = new FileHost([...(sources.screen ? [sources.screen] : []), ...(sources.webcam ? [sources.webcam.path] : [])], video, images);
    files = host;
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
```

In `packages/export/src/main/stills.ts`, replace:

```ts
    ...(sources.transcript && { transcript: sources.transcript }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    ...(motionFiles && { motion: motionFiles }),
    times: opts.times,
    ...(columns !== undefined && { sheet: { columns } }),
```

with:

```ts
    ...(sources.transcript && { transcript: sources.transcript }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    watermarkImage: sources.watermarkImage,
    ...(motionFiles && { motion: motionFiles }),
    times: opts.times,
    ...(columns !== undefined && { sheet: { columns } }),
```

In the same file, replace:

```ts

  const cancel = whenCancelled(opts.signal);
  const guard = watchdog();
  const images = [...Object.values(sources.stills), ...(sources.backgroundImage ? [sources.backgroundImage] : [])];
  // Reads only: stills mode writes PNGs through writeStill, never into a video file.
  const host = new FileHost([...(sources.screen ? [sources.screen] : []), ...(sources.webcam ? [sources.webcam.path] : [])], join(outDir, '.unused'), images);
  let window: ExportWindow | undefined;
```

with:

```ts

  const cancel = whenCancelled(opts.signal);
  const guard = watchdog();
  const images = [...Object.values(sources.stills), ...[sources.backgroundImage, sources.watermarkImage].filter((path): path is string => path !== undefined)];
  // Reads only: stills mode writes PNGs through writeStill, never into a video file.
  const host = new FileHost([...(sources.screen ? [sources.screen] : []), ...(sources.webcam ? [sources.webcam.path] : [])], join(outDir, '.unused'), images);
  let window: ExportWindow | undefined;
```

In `packages/export/src/page/run.ts`, replace:

```ts
  ]);
  const canvas = new OffscreenCanvas(1, 1);
  let background: ImageBitmap | undefined;
  let sources: SceneSources | undefined;
  let renderer: Renderer | undefined;
  try {
```

with:

```ts
  ]);
  const canvas = new OffscreenCanvas(1, 1);
  let background: ImageBitmap | undefined;
  let watermark: ImageBitmap | undefined;
  let sources: SceneSources | undefined;
  let renderer: Renderer | undefined;
  try {
```

In the same file, replace:

```ts
    });
    const plan = makePlan(timeline);
    if (job.backgroundImage) background = await loadImage(job.backgroundImage, probeMaxTextureSize(), 'the background image');
    renderer = createRenderer(canvas, project, { assets, screenSize, backgroundImage: background });
    const gl = canvas.getContext('webgl2')!;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    sources = new SceneSources(
```

with:

```ts
    });
    const plan = makePlan(timeline);
    if (job.backgroundImage) background = await loadImage(job.backgroundImage, probeMaxTextureSize(), 'the background image');
    if (job.watermarkImage) watermark = await loadImage(job.watermarkImage, probeMaxTextureSize(), 'the watermark image');
    renderer = createRenderer(canvas, project, { assets, screenSize, backgroundImage: background, ...(watermark && { watermarkImage: watermark }) });
    const gl = canvas.getContext('webgl2')!;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    sources = new SceneSources(
```

In the same file, replace:

```ts
    // Free the context now instead of waiting for GC (browsers keep only ~16 live WebGL contexts).
    (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    background?.close();
    screen?.input.dispose();
    webcam?.input.dispose();
  }
```

with:

```ts
    // Free the context now instead of waiting for GC (browsers keep only ~16 live WebGL contexts).
    (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    background?.close();
    watermark?.close();
    screen?.input.dispose();
    webcam?.input.dispose();
  }
```

Run: `pnpm exec vitest run --project node packages/export`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/export
git commit -m "export: the watermark's image (its own, else the brand's logo), SVG drawn through a canvas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The editor, the check and the guides

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/shared/names.ts`, `apps/desktop/src/main/windows.ts`, `apps/desktop/src/renderer/editor/media.ts`, `apps/desktop/src/renderer/editor/player.ts`, `apps/desktop/src/renderer/editor/actions.ts`, `apps/desktop/src/renderer/editor/session.ts`, `apps/desktop/src/renderer/editor/Inspector.tsx`, `apps/desktop/src/renderer/icons.tsx`, `apps/desktop/test/app.check.test.ts`, `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`, `skill/test/skill.test.ts`

- [ ] **Step 1: The names and the image chooser**

In `apps/desktop/src/shared/names.ts`, replace:

```ts
  bokeh: 'Bokeh',
  dots: 'Dots',
};
export const FRAME_NAMES: Names<typeof FRAME_STYLES> = { 'mac-dark': 'Mac, dark', 'mac-light': 'Mac, light', 'browser-light': 'Browser, light', none: 'No title bar' };
export const CURSOR_NAMES: Names<typeof CURSOR_STYLES> = {
  system: 'System',
  'arrow-white': 'White arrow',
```

with:

```ts
  bokeh: 'Bokeh',
  dots: 'Dots',
};
export const FRAME_NAMES: Names<typeof FRAME_STYLES> = {
  'mac-dark': 'Mac, dark',
  'mac-light': 'Mac, light',
  'browser-light': 'Browser, light',
  'browser-dark': 'Browser, dark',
  'windows-light': 'Windows, light',
  'windows-dark': 'Windows, dark',
  terminal: 'Terminal',
  iphone: 'iPhone',
  android: 'Android',
  none: 'No title bar',
};
export const CURSOR_NAMES: Names<typeof CURSOR_STYLES> = {
  system: 'System',
  'arrow-white': 'White arrow',
```

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
      base: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  'project:import-image': z.strictObject({ purpose: z.enum(['still', 'background', 'logo']) }),
  /** The brand kits saved on this computer. */
  'brand:list': z.undefined(),
  /** Saves the project's brand, as this version of it has it, as a kit (a kit of that name is replaced). */
```

with:

```ts
      base: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  'project:import-image': z.strictObject({ purpose: z.enum(['still', 'background', 'logo', 'watermark']) }),
  /** The brand kits saved on this computer. */
  'brand:list': z.undefined(),
  /** Saves the project's brand, as this version of it has it, as a kit (a kit of that name is replaced). */
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
        CHECK_IMAGE ??
        (
          await dialog.showOpenDialog(window, {
            title: purpose === 'still' ? 'An image for the page' : purpose === 'logo' ? 'The brand\'s logo' : 'A background image',
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: purpose === 'logo' ? ['png', 'svg', 'webp', 'jpg', 'jpeg'] : ['png', 'jpg', 'jpeg', 'webp'] }],
          })
        ).filePaths[0];
      // a logo goes into brand/, beside the files brand kits bring
```

with:

```ts
        CHECK_IMAGE ??
        (
          await dialog.showOpenDialog(window, {
            title: purpose === 'still' ? 'An image for the page' : purpose === 'logo' ? 'The brand\'s logo' : purpose === 'watermark' ? 'The watermark\'s image' : 'A background image',
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: purpose === 'logo' || purpose === 'watermark' ? ['png', 'svg', 'webp', 'jpg', 'jpeg'] : ['png', 'jpg', 'jpeg', 'webp'] }],
          })
        ).filePaths[0];
      // a logo goes into brand/, beside the files brand kits bring
```

In `apps/desktop/src/renderer/editor/actions.ts`, replace:

```ts
  if (added?.id) select({ kind: 'sound', id: added.id });
}

/** Replaces a still's image, the background's or the brand's logo with one the person picks. */
export async function chooseImage(purpose: 'still' | 'background' | 'logo', id?: string): Promise<void> {
  const chosen = await bridge.invoke('project:import-image', { purpose });
  if (!chosen) return;
  if (purpose === 'still' && id) edit([{ type: 'set', list: 'scenes', id, fields: { image: chosen.path } }], 'Replace image');
  else if (purpose === 'logo') edit([{ type: 'theme', fields: { logo: chosen.path } }], 'Logo');
  else edit([{ type: 'look', path: ['background'], value: { preset: 'image', image: chosen.path } }], 'Background image');
}
```

with:

```ts
  if (added?.id) select({ kind: 'sound', id: added.id });
}

/** Replaces a still's image, the background's, the brand's logo or the watermark's with one the person picks. */
export async function chooseImage(purpose: 'still' | 'background' | 'logo' | 'watermark', id?: string): Promise<void> {
  const chosen = await bridge.invoke('project:import-image', { purpose });
  if (!chosen) return;
  if (purpose === 'still' && id) edit([{ type: 'set', list: 'scenes', id, fields: { image: chosen.path } }], 'Replace image');
  else if (purpose === 'logo') edit([{ type: 'theme', fields: { logo: chosen.path } }], 'Logo');
  else if (purpose === 'watermark') edit([{ type: 'look', path: ['watermark', 'image'], value: chosen.path }], 'Watermark image');
  else edit([{ type: 'look', path: ['background'], value: { preset: 'image', image: chosen.path } }], 'Background image');
}
```

- [ ] **Step 2: The watermark's image in the editor**

In `apps/desktop/src/renderer/editor/media.ts`, replace:

```ts
import { ALL_FORMATS, Input, UrlSource, type InputAudioTrack, type InputVideoTrack, type VideoSinkDecoderOptions } from 'mediabunny';
import { createCursorTrack, type CursorTrack } from '@cuttle/timeline';
import { parseEventsJsonl, parseMarkersJson, parseProject, parseTranscriptJson, type CuttleProject, type InputEvent, type Marker, type TranscriptFile } from '@cuttle/project';
import { plainIssue } from '../../shared/format';
import { MEDIA_ORIGIN, type ProjectInfo } from '../../shared/ipc';
```

with:

```ts
import { ALL_FORMATS, Input, UrlSource, type InputAudioTrack, type InputVideoTrack, type VideoSinkDecoderOptions } from 'mediabunny';
import { createCursorTrack, type CursorTrack } from '@cuttle/timeline';
import { parseEventsJsonl, parseMarkersJson, parseProject, parseTranscriptJson, type CuttleProject, type InputEvent, type Marker, type TranscriptFile } from '@cuttle/project';
import { isSvg, svgBitmap } from '@cuttle/export/svg';
import { plainIssue } from '../../shared/format';
import { MEDIA_ORIGIN, type ProjectInfo } from '../../shared/ipc';
```

In the same file, replace:

```ts
export async function loadImage(path: string, maxSize: number, what: string): Promise<ImageBitmap> {
  const response = await fetch(mediaUrl(path)).catch(() => undefined);
  if (!response?.ok) throw missing(path);
  const blob = await response.blob();
  const options: ImageBitmapOptions = { premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' };
  let bitmap: ImageBitmap;
```

with:

```ts
export async function loadImage(path: string, maxSize: number, what: string): Promise<ImageBitmap> {
  const response = await fetch(mediaUrl(path)).catch(() => undefined);
  if (!response?.ok) throw missing(path);
  // an SVG (a logo): drawn by an image, at a size of its own
  if (isSvg(path)) return svgBitmap(new Uint8Array(await response.arrayBuffer())).catch(() => Promise.reject(new MediaError(`${what} (${path}) is not an SVG Cuttle can draw.`)));
  const blob = await response.blob();
  const options: ImageBitmapOptions = { premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' };
  let bitmap: ImageBitmap;
```

In the same file, replace:

```ts
  backgroundImage?: ImageBitmap;
  /** The path `backgroundImage` was read from. */
  backgroundPath?: string;
  /** Seconds after the screen track that the webcam and the mic started. */
  offsets: ProjectInfo['offsets'];
  /** Sources tried and failed (not tried again), and warnings for people (a missing webcam file …). */
```

with:

```ts
  backgroundImage?: ImageBitmap;
  /** The path `backgroundImage` was read from. */
  backgroundPath?: string;
  /** The watermark's image (its own, else the brand's logo), and the path it was read from. */
  watermarkImage?: ImageBitmap;
  watermarkPath?: string;
  /** Seconds after the screen track that the webcam and the mic started. */
  offsets: ProjectInfo['offsets'];
  /** Sources tried and failed (not tried again), and warnings for people (a missing webcam file …). */
```

In the same file, replace:

```ts
  warnings: string[];
}

/** Larger images are scaled down: textures of 8192 px work on every GPU Cuttle runs on. */
const MAX_IMAGE = 8192;
```

with:

```ts
  warnings: string[];
}

/** The watermark's image file, when it is on: its own, else the brand's logo. */
export function watermarkFile(project: CuttleProject): string | undefined {
  return project.look.watermark.enabled ? (project.look.watermark.image ?? project.theme.logo) : undefined;
}

/** Larger images are scaled down: textures of 8192 px work on every GPU Cuttle runs on. */
const MAX_IMAGE = 8192;
```

In the same file, replace:

```ts
    media.backgroundPath = background;
    added = true;
  }
  if (sources.webcam && look.webcam.enabled && !media.webcam) {
    const video = await optional(media, sources.webcam, () => openVideo(sources.webcam!, 'The webcam recording'));
    if (video) {
```

with:

```ts
    media.backgroundPath = background;
    added = true;
  }
  const mark = watermarkFile(project);
  if (mark && media.watermarkPath !== mark) {
    // without it the watermark shows its text
    media.watermarkImage = await optional(media, mark, () => loadImage(mark, MAX_IMAGE, 'The watermark image'));
    media.watermarkPath = mark;
    added = true;
  }
  if (sources.webcam && look.webcam.enabled && !media.webcam) {
    const video = await optional(media, sources.webcam, () => openVideo(sources.webcam!, 'The webcam recording'));
    if (video) {
```

In `apps/desktop/src/renderer/editor/player.ts`, replace:

```ts
import { AudioSchedule } from './audio';
import { TypingSchedule } from './typing-audio';
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
import type { EditorMedia, VideoSource } from './media';
import { MotionFrames } from './motion';
import { SoundtrackSchedule, type Soundtrack } from './soundtrack';
```

with:

```ts
import { AudioSchedule } from './audio';
import { TypingSchedule } from './typing-audio';
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
import { watermarkFile, type EditorMedia, type VideoSource } from './media';
import { MotionFrames } from './motion';
import { SoundtrackSchedule, type Soundtrack } from './soundtrack';
```

In the same file, replace:

```ts

  private makeRenderer(): Renderer {
    this.drawnBackground = this.media.backgroundImage;
    return createRenderer(this.canvas, this.project, {
      assets: this.assets,
      screenSize: this.media.screen.size,
      ...(this.media.backgroundImage && { backgroundImage: this.media.backgroundImage }),
    });
  }

  private set(change: Partial<PlayerState>): void {
    this.state = { ...this.state, ...change };
    this.onChange(this.state);
```

with:

```ts

  private makeRenderer(): Renderer {
    this.drawnBackground = this.media.backgroundImage;
    this.drawnWatermark = this.watermark();
    return createRenderer(this.canvas, this.project, {
      assets: this.assets,
      screenSize: this.media.screen.size,
      ...(this.media.backgroundImage && { backgroundImage: this.media.backgroundImage }),
      ...(this.drawnWatermark && { watermarkImage: this.drawnWatermark }),
    });
  }

  /** The watermark's image for this version of the project: none when it is off or shows another file. */
  private watermark(): ImageBitmap | undefined {
    const mark = watermarkFile(this.project);
    return mark && this.media.watermarkPath === mark ? this.media.watermarkImage : undefined;
  }

  private set(change: Partial<PlayerState>): void {
    this.state = { ...this.state, ...change };
    this.onChange(this.state);
```

In the same file, replace:

```ts
    if (project === this.project && !options.redrawOnly) return;
    const playing = this.state.playing;
    this.pause();
    const look = (value: CuttleProject) => JSON.stringify([value.look, value.output]);
    const background = this.media.backgroundImage;
    const renew = look(project) !== look(this.project) || background !== this.drawnBackground;
    this.project = project;
    this.motion.setProject(project);
    this.timeline = this.makeTimeline();
    // the title bar and the transport show the length: they learn it changed with the state
```

with:

```ts
    if (project === this.project && !options.redrawOnly) return;
    const playing = this.state.playing;
    this.pause();
    // the brand too: a watermark shows its logo or its name
    const look = (value: CuttleProject) => JSON.stringify([value.look, value.output, value.theme]);
    const background = this.media.backgroundImage;
    const previous = this.project;
    this.project = project;
    const renew = look(project) !== look(previous) || background !== this.drawnBackground || this.watermark() !== this.drawnWatermark;
    this.motion.setProject(project);
    this.timeline = this.makeTimeline();
    // the title bar and the transport show the length: they learn it changed with the state
```

In the same file, replace:

```ts

  /** The background image the renderer was made with. */
  private drawnBackground: ImageBitmap | undefined;

  /** The still images of the timeline's scenes, by scene index (`media` keeps them by path). */
  private stillsByIndex(): Map<number, ImageBitmap> {
```

with:

```ts

  /** The background image the renderer was made with. */
  private drawnBackground: ImageBitmap | undefined;
  /** The watermark's image the renderer was made with. */
  private drawnWatermark: ImageBitmap | undefined;

  /** The still images of the timeline's scenes, by scene index (`media` keeps them by path). */
  private stillsByIndex(): Map<number, ImageBitmap> {
```

- [ ] **Step 3: The Look tab's Watermark part**

In `apps/desktop/src/renderer/editor/session.ts`, replace:

```ts
export type Tool = 'select' | 'zoom' | 'mask' | 'caption' | 'crop';

/** The look's parts, as the Look tab lists them. */
export type LookSection = 'brand' | 'background' | 'window' | 'cursor' | 'camera' | 'subtitles' | 'sound' | 'video';

export interface EditorState {
  phase: 'loading' | 'ready' | 'failed';
```

with:

```ts
export type Tool = 'select' | 'zoom' | 'mask' | 'caption' | 'crop';

/** The look's parts, as the Look tab lists them. */
export type LookSection = 'brand' | 'watermark' | 'background' | 'window' | 'cursor' | 'camera' | 'subtitles' | 'sound' | 'video';

export interface EditorState {
  phase: 'loading' | 'ready' | 'failed';
```

In `apps/desktop/src/renderer/icons.tsx`, replace:

```tsx
export const RecordIcon = icon(<circle cx="8" cy="8" r="5" />, true);
export const ChevronIcon = icon(<path d="m4.5 6 3.5 3.5L11.5 6" />);
// the look's parts
export const BrandIcon = icon(<path d="M2.5 2.5h5.2l5.8 5.8-5.2 5.2-5.8-5.8zM5.4 5.4h.1" />);
export const BackgroundIcon = icon(<path d="M2.5 3.5h11v9h-11zM2.5 10l3.2-3 2.6 2.4L10.5 7.5l3 2.8" />);
export const WindowIcon = icon(<path d="M2 3.5h12v9H2zM2 6h12M3.8 4.8h.1M5.3 4.8h.1" />);
```

with:

```tsx
export const RecordIcon = icon(<circle cx="8" cy="8" r="5" />, true);
export const ChevronIcon = icon(<path d="m4.5 6 3.5 3.5L11.5 6" />);
// the look's parts
export const WatermarkIcon = icon(<path d="M2.5 2.5h11v11h-11zM8.5 10.5h3v1.5h-3z" />);
export const BrandIcon = icon(<path d="M2.5 2.5h5.2l5.8 5.8-5.2 5.2-5.8-5.8zM5.4 5.4h.1" />);
export const BackgroundIcon = icon(<path d="M2.5 3.5h11v9h-11zM2.5 10l3.2-3 2.6 2.4L10.5 7.5l3 2.8" />);
export const WindowIcon = icon(<path d="M2 3.5h12v9H2zM2 6h12M3.8 4.8h.1M5.3 4.8h.1" />);
```

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```tsx
  SubtitlesIcon,
  TextIcon,
  TrashIcon,
  WindowIcon,
  ZoomIcon,
} from '../icons';
```

with:

```tsx
  SubtitlesIcon,
  TextIcon,
  TrashIcon,
  WatermarkIcon,
  WindowIcon,
  ZoomIcon,
} from '../icons';
```

In the same file, replace:

```tsx
/** The look's parts, in the order the tab lists them. */
const LOOK_PARTS: { id: LookSection; title: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'brand', title: 'Brand', icon: BrandIcon },
  { id: 'background', title: 'Background', icon: BackgroundIcon },
  { id: 'window', title: 'Window', icon: WindowIcon },
  { id: 'cursor', title: 'Cursor', icon: SelectIcon },
```

with:

```tsx
/** The look's parts, in the order the tab lists them. */
const LOOK_PARTS: { id: LookSection; title: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'brand', title: 'Brand', icon: BrandIcon },
  { id: 'watermark', title: 'Watermark', icon: WatermarkIcon },
  { id: 'background', title: 'Background', icon: BackgroundIcon },
  { id: 'window', title: 'Window', icon: WindowIcon },
  { id: 'cursor', title: 'Cursor', icon: SelectIcon },
```

In the same file, replace:

```tsx
  );
}

/** What each heading font is like, in the font list. */
const FONT_NOTES: Record<ThemeFont, string> = {
  Archivo: 'wide, bold',
```

with:

```tsx
  );
}

/**
 * The watermark: a mark in a corner of the whole video. Its image (else the brand's logo) or, without
 * one, its text (else the brand's name); its corner, height and opacity.
 */
function WatermarkFields({ project }: { project: CuttleProject }) {
  const { watermark } = project.look;
  const { theme } = project;
  const image = watermark.image ?? theme.logo;
  return (
    <>
      <Row label="Watermark" inline note="over the whole video">
        <Toggle checked={watermark.enabled} label="Watermark" onChange={(on) => look(['watermark', 'enabled'], on, on ? 'Watermark on' : 'Watermark off')} testId="watermark-enabled" />
      </Row>
      {watermark.enabled && (
        <>
          <Row label="Image" plain>
            {image ? (
              <>
                <img className="logo-thumb" src={`${MEDIA_ORIGIN}/${image.split('/').map(encodeURIComponent).join('/')}`} alt="" />
                <span className="path" title={image}>
                  {watermark.image ? image.split('/').pop() : 'the brand’s logo'}
                </span>
              </>
            ) : (
              <span className="path">none: the text shows</span>
            )}
            {watermark.image && (
              <button type="button" className="ghost small" onClick={() => look(['watermark', 'image'], undefined, 'Watermark: no image of its own')}>
                Remove
              </button>
            )}
            <button type="button" className="ghost small" onClick={() => void chooseImage('watermark')} data-testid="watermark-image">
              {watermark.image ? 'Replace…' : 'Choose…'}
            </button>
          </Row>
          {!image && (
            <Row label="Text">
              <TextInput value={watermark.text ?? ''} placeholder={theme.name || 'the brand’s name'} onCommit={(text) => look(['watermark', 'text'], text.trim() || undefined, 'Watermark text')} testId="watermark-text" />
            </Row>
          )}
          <div className="chips" role="group" aria-label="Watermark corner">
            {WEBCAM_CORNERS.map((corner) => (
              <button key={corner} type="button" className="chip" aria-pressed={watermark.corner === corner} onClick={() => look(['watermark', 'corner'], corner, `Watermark: ${CORNER_NAMES[corner].toLowerCase()}`)} data-testid={`watermark-${corner}`}>
                {CORNER_NAMES[corner]}
              </button>
            ))}
          </div>
          <div className="grid2">
            <Row label={`Size · ${Math.round(watermark.size * 100)} %`}>
              <RangeInput value={Math.round(watermark.size * 100)} min={2} max={30} label="Watermark size" toCommand={(value) => ({ type: 'look', path: ['watermark', 'size'], value: value / 100 }) as Command} commitLabel="Watermark size" testId="watermark-size" />
            </Row>
            <Row label={`Opacity · ${Math.round(watermark.opacity * 100)} %`}>
              <RangeInput value={Math.round(watermark.opacity * 100)} min={10} max={100} label="Watermark opacity" toCommand={(value) => ({ type: 'look', path: ['watermark', 'opacity'], value: value / 100 }) as Command} commitLabel="Watermark opacity" testId="watermark-opacity" />
            </Row>
          </div>
        </>
      )}
    </>
  );
}

/** What each heading font is like, in the font list. */
const FONT_NOTES: Record<ThemeFont, string> = {
  Archivo: 'wide, bold',
```

In the same file, replace:

```tsx
  const webcam = current.webcam;
  const theme = project.theme;
  const summaries: Record<LookSection, string> = {
    brand: theme.kit ? `Kit · ${theme.kit}` : [theme.name, theme.font !== 'Archivo' && theme.font].filter(Boolean).join(' · ') || 'None set',
    background:
      current.background.preset === 'solid'
```

with:

```tsx
  const webcam = current.webcam;
  const theme = project.theme;
  const summaries: Record<LookSection, string> = {
    watermark: current.watermark.enabled
      ? [current.watermark.image ? 'Image' : theme.logo ? 'Logo' : current.watermark.text || theme.name ? 'Text' : 'Nothing to show', CORNER_NAMES[current.watermark.corner].toLowerCase()].join(' · ')
      : 'Off',
    brand: theme.kit ? `Kit · ${theme.kit}` : [theme.name, theme.font !== 'Archivo' && theme.font].filter(Boolean).join(' · ') || 'None set',
    background:
      current.background.preset === 'solid'
```

In the same file, replace:

```tsx
        <BrandFields project={project} />
      </LookPart>

      <LookPart id="background" summary={summaries.background}>
        <div className="swatches" role="group" aria-label="Background">
          {BACKGROUND_PRESETS.map((preset) => (
```

with:

```tsx
        <BrandFields project={project} />
      </LookPart>

      <LookPart id="watermark" summary={summaries.watermark}>
        <WatermarkFields project={project} />
      </LookPart>

      <LookPart id="background" summary={summaries.background}>
        <div className="swatches" role="group" aria-label="Background">
          {BACKGROUND_PRESETS.map((preset) => (
```

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 4: The check**

The frames' pictures in the Look tab; Windows, the terminal and the iPhone on the take; the watermark's text, then an image, top left and larger: each drawn in the editor as `cuttle preview` draws it:

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'backgrounds · Cuttle')?.close());
  }, 240_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

with:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'backgrounds · Cuttle')?.close());
  }, 240_000);

  it('frames the take as Windows, a terminal or a phone and puts a watermark in a corner (its text, then an image), each as the export draws it', async () => {
    const dir = join(root, 'frames');
    makeFixture(dir);
    const page = await openEditor(dir);
    await page.waitForFunction(() => '__cuttleCheck' in window);
    const seekTo = (t: number) => page.evaluate((time) => (window as unknown as Hooked).__cuttleCheck.seek(time), t);
    const view = async () => decode(await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.pixels()));
    type Look = { frame?: { style?: string }; watermark?: { enabled?: boolean; text?: string; image?: string; corner?: string; size?: number } };
    const saved = () => (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { look: Look }).look;
    const asExported = async (t: number, name: string) => {
      await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
      const still = spawnSync('node', [CLI, '--json', '-C', dir, 'preview', '--at', String(t), '-o', join(root, `frame-${name}`)], { encoding: 'utf8', timeout: 120_000 });
      expect(still.status, still.stderr).toBe(0);
      const exported = PNG.sync.read(readFileSync((JSON.parse(still.stdout) as { stills: { file: string }[] }).stills[0]!.file));
      await expect.poll(async () => (await seekTo(t), difference(await view(), exported).mean), { timeout: 20_000, message: `${name}: the editor against the export` }).toBeLessThan(0.6);
    };
    await click(page, '#tab-look');

    // the frames: the engine's own pictures of each, then three of them on the take
    await click(page, '[data-testid=look-open-window]');
    await page.waitForSelector('[data-testid=frame-iphone] img', { timeout: 20_000 });
    await page.locator('[data-testid=frame-iphone]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('44-frames', '/editor.html', 'frames · Cuttle');
    for (const style of ['windows-dark', 'terminal', 'iphone']) {
      await click(page, `[data-testid=frame-${style}]`);
      await expect.poll(() => saved().frame?.style).toBe(style);
      await asExported(1, style);
    }

    // the watermark: on, its text (the project has no logo and no name), then an image, top left and larger
    await click(page, '[data-testid=look-open-watermark]');
    await click(page, '[data-testid=watermark-enabled]');
    await expect.poll(() => saved().watermark?.enabled).toBe(true);
    await page.fill('[data-testid=watermark-text]', 'nimbus.app');
    await page.press('[data-testid=watermark-text]', 'Enter');
    await expect.poll(() => saved().watermark?.text).toBe('nimbus.app');
    await asExported(1, 'watermark-text');
    await click(page, '[data-testid=watermark-image]');
    await expect.poll(() => saved().watermark?.image).toBe('images/nimbus.svg');
    await click(page, '[data-testid=watermark-top-left]');
    await page.locator('[data-testid=watermark-size]').evaluate((element) => {
      const input = element as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '12');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => saved().watermark).toMatchObject({ corner: 'top-left', size: 0.12 });
    await asExported(1, 'watermark-image');
    await shotOf('44b-watermark', '/editor.html', 'frames · Cuttle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'frames · Cuttle')?.close());
  }, 240_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

Run: `pnpm app:check`
Expected: PASS, 53 tests.

- [ ] **Step 5: The guides**

In `skill/cuttle/SKILL.md`, replace:

```markdown
  and offer to keep it with `brand save`. Set `look.frame.title` (e.g. `claude · ~/demo`) and a
  background: `cuttle -C "<project>" --json background gradient --from take` takes the product's own
  colours, `background --wallpaper` puts the desktop's wallpaper behind the window, softened;
  `flow`, `bokeh` and `dots` move quietly. Add a `texts` caption where a step is not obvious. Typing clicks softly, a click per key where the clip
  is heard (`look.audio.typing`, `typingVolume`); switch it off when the user wants a quiet video.
- **Pages.** `cuttle -C "<project>" --json capture-page <url or file> --scroll --add` appends a
  scrolling still of a web page (the result the agent built); add `--wait 2500` for slow maps or
```

with:

```markdown
  and offer to keep it with `brand save`. Set `look.frame.title` (e.g. `claude · ~/demo`) and a
  background: `cuttle -C "<project>" --json background gradient --from take` takes the product's own
  colours, `background --wallpaper` puts the desktop's wallpaper behind the window, softened;
  `flow`, `bokeh` and `dots` move quietly. The frame fits what was recorded: `windows-dark`, `terminal`,
  `browser-dark`, or `iphone` and `android` around a phone-shaped take or page; `look.watermark` puts the
  brand's logo in a corner. Add a `texts` caption where a step is not obvious. Typing clicks softly, a click per key where the clip
  is heard (`look.audio.typing`, `typingVolume`); switch it off when the user wants a quiet video.
- **Pages.** `cuttle -C "<project>" --json capture-page <url or file> --scroll --add` appends a
  scrolling still of a web page (the result the agent built); add `--wait 2500` for slow maps or
```

In `skill/cuttle/project.md`, replace:

```markdown
| Field | Values (default first) |
|---|---|
| `background.preset` | `sunset-sky`, `aurora`, `mesh`, `solid` (needs `color`, e.g. `"#0c0c0c"`), `image` (needs `image`: a path; `blur` 0–1 softens it, `dim` 0–0.8 darkens it), `gradient` (needs `colors`: 2 to 4, first to last; `angle` as in CSS, `135` by default; `kind` `linear` or `radial`), and the quiet animated `flow`, `bokeh` and `dots`; `mesh`, `flow`, `bokeh` and `dots` take `colors` too (else their own) |
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`, `squircle`, `square`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5), `position` (`{ x, y }`: the bubble's centre as a share of the video, 0–1; it replaces `corner`), `border` (`true`: a white ring), `shadow` (`true`), `mirror` (`false`: flipped left to right) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one), `typing` (`true`: a key click for each key typed, where the clip is heard), `typingVolume` (`0.5`, 0 to 1), `effects` (`true`: the `sounds` and the music page's effects), `effectsVolume` (`0.8`, 0 to 1) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

`theme` is the project's brand, which its motion pages read (every field is optional): `name` and
`url` (the product's, for titles and end cards), `logo` (an image in the project, e.g.
```

with:

```markdown
| Field | Values (default first) |
|---|---|
| `background.preset` | `sunset-sky`, `aurora`, `mesh`, `solid` (needs `color`, e.g. `"#0c0c0c"`), `image` (needs `image`: a path; `blur` 0–1 softens it, `dim` 0–0.8 darkens it), `gradient` (needs `colors`: 2 to 4, first to last; `angle` as in CSS, `135` by default; `kind` `linear` or `radial`), and the quiet animated `flow`, `bokeh` and `dots`; `mesh`, `flow`, `bokeh` and `dots` take `colors` too (else their own) |
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `browser-dark`, `windows-light`, `windows-dark`, `terminal`, `none`; and the phones `iphone` and `android`, a bezel and a camera around the screen, for a tall recording of a phone or a narrow window), `title` (`""`), `radius` (`14`; not for the phones), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`, `squircle`, `square`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5), `position` (`{ x, y }`: the bubble's centre as a share of the video, 0–1; it replaces `corner`), `border` (`true`: a white ring), `shadow` (`true`), `mirror` (`false`: flipped left to right) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one), `typing` (`true`: a key click for each key typed, where the clip is heard), `typingVolume` (`0.5`, 0 to 1), `effects` (`true`: the `sounds` and the music page's effects), `effectsVolume` (`0.8`, 0 to 1) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |
| `watermark` | `enabled` (`false`), `image` (a path; without it the brand's logo, `theme.logo`), `text` (shown without an image; without it the brand's name), `corner` (`bottom-right`, `bottom-left`, `top-left`, `top-right`), `size` (`0.06`: its height as a share of the short side, 0.02 to 0.3), `opacity` (`0.7`, 0.1 to 1): a mark over the whole video, clear of the webcam bubble |

`theme` is the project's brand, which its motion pages read (every field is optional): `name` and
`url` (the product's, for titles and end cards), `logo` (an image in the project, e.g.
```

In the same file, replace:

```markdown
| Type | Fields |
|---|---|
| `clip` | `from`, `to` (source seconds, `to` > `from`), `speed` (`1`, up to 64; above 1 a badge like "12× speed" shows), `badge` (custom badge text, `""` for none), `crop` (`{ "rect": [x, y, w, h], "enabled": true }`: the part of the screen the clip shows, e.g. a browser's page without its tabs; the window takes its shape and zooms stay inside it; `suggest` makes it, tagged `auto: "crop"`, and cuts a clip where the content area changes for good) |
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |
| `motion` | `src` (an HTML page in the project, e.g. `motion/intro/index.html`), `duration` (output seconds), `params` (`{ "name": value }`: text, numbers, `true`/`false` or `null`, for the page), `network` (`false`; `true` lets the page load from https), `motionBlur` (`{ "samples": 8, "shutter": 0.5 }`: each frame the average of that many moments while a camera's shutter would be open, half a frame here; off without it): a page drawn frame by frame over the whole output, over the background where it is clear (see "Motion pages" and [motion.md](motion.md)) |
```

with:

```markdown
| Type | Fields |
|---|---|
| `clip` | `from`, `to` (source seconds, `to` > `from`), `speed` (`1`, up to 64; above 1 a badge like "12× speed" shows), `badge` (custom badge text, `""` for none), `crop` (`{ "rect": [x, y, w, h], "enabled": true }`: the part of the screen the clip shows, e.g. a browser's page without its tabs; the window takes its shape and zooms stay inside it; `suggest` makes it, tagged `auto: "crop"`, and cuts a clip where the content area changes for good) |
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`, `browser-dark`, `windows-light`, `windows-dark`, `terminal`, `iphone`, `android`: a phone frame suits a page captured at a phone's width) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |
| `motion` | `src` (an HTML page in the project, e.g. `motion/intro/index.html`), `duration` (output seconds), `params` (`{ "name": value }`: text, numbers, `true`/`false` or `null`, for the page), `network` (`false`; `true` lets the page load from https), `motionBlur` (`{ "samples": 8, "shutter": 0.5 }`: each frame the average of that many moments while a camera's shutter would be open, half a frame here; off without it): a page drawn frame by frame over the whole output, over the background where it is clear (see "Motion pages" and [motion.md](motion.md)) |
```

In `skill/test/skill.test.ts`, replace:

```ts
      ['| `frame` |', FRAME_STYLES],
      ['| `cursor` |', [...CURSOR_STYLES, ...CLICK_EFFECTS]],
      ['| `webcam` |', [...WEBCAM_SHAPES, ...WEBCAM_CORNERS]],
      ['| `still` |', [...STILL_MOTIONS, ...FRAME_STYLES]],
      ['`zooms`:', EASES],
      ['`masks` hide', MASK_STYLES],
```

with:

```ts
      ['| `frame` |', FRAME_STYLES],
      ['| `cursor` |', [...CURSOR_STYLES, ...CLICK_EFFECTS]],
      ['| `webcam` |', [...WEBCAM_SHAPES, ...WEBCAM_CORNERS]],
      ['| `watermark` |', WEBCAM_CORNERS],
      ['| `still` |', [...STILL_MOTIONS, ...FRAME_STYLES]],
      ['`zooms`:', EASES],
      ['`masks` hide', MASK_STYLES],
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop skill
git commit -m "app: the new frames in the Look tab, and its Watermark part; check them as the export draws them; the guides

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 910 passed and 73 skipped (where a speech model is found, its real transcription runs too: 911 and 72; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 14 tests.

Run: `pnpm app:check`
Expected: PASS, 53 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. In the Look tab's Window part, pick Windows, dark: the title on the left, the caption buttons on the right. Pick Terminal: the title in a tab.
2. Record a narrow window (or capture a page at a phone's width) and pick iPhone: the phone around it; with a wide take it lies across.
3. Open Watermark and switch it on: the brand's logo shows bottom right (or its name, or your text); move it to another corner and make it larger.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **An SVG logo watermark drew nothing.** `createImageBitmap` made a bitmap of an SVG image without a size of its own that was empty, with no error. `cuttle preview` showed it: no mark in the corner. The SVG is now drawn onto a canvas first.
- **An iPhone around a wide recording** had a Dynamic Island a third of the width long across its top. A phone's sizes come from the screen's short side now, and held across the phone is turned: its camera on the left, its buttons at the top and the bottom.
- **The test's corner** of a phone's screen sat on the metal band (the body's curve and the screen's share their centre), and its camera's middle on the lens's glint. The test looks a little way into the corner and allows the glint.

**Flaky, and not this milestone's**
- **The app check's test that reads the screen after a take** lost its editor window in two of three full runs (one right after a fresh build), as in the milestones before; the third run passed all 53. Nothing here touches the recording or the screen reading.

**Spec points that move**
- None: P5-M2 is complete (M2a, M2b, M2c). Next: **P5-M3**.

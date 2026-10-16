# Cuttle M2: Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@cuttle/engine`, the WebGL2 compositor that draws a `RenderState` from `@cuttle/timeline` into a canvas: background presets, window frames, the screen with zoom and masks, six cursor styles with click ripples, the webcam bubble, text overlays, the speed badge, still and card scenes and crossfades. Every look is locked by a golden image, and the same images come out of a hidden Electron window.

**Architecture:** One rect-drawing vertex shader and a set of small passes (background, window, content, masks, cursor, webcam, sprite), each owning its fragment shader. Text is drawn with Canvas2D into cached sprite textures; cursor art is SVG rasterized once by `loadEngineAssets()`. `createRenderer` draws the first layer straight to the canvas and every later layer through one offscreen target blended with its opacity, which turns the timeline's crossfade pair into A·(1−m) + B·m. Golden images run in vitest browser mode (Playwright Chromium, SwiftShader); a separate script renders the same scenarios in Electron and compares them with the same PNGs.

**Tech Stack:** TypeScript 5, WebGL2 (GLSL ES 3.00), Canvas2D/OffscreenCanvas, vitest 5 browser mode with `@vitest/browser-playwright` 5.0.5 and Playwright Chromium, pixelmatch 8 + pngjs 7, `@fontsource/inter` 5, vite 8 (bundle for Electron), Electron 44.

Spec: `docs/superpowers/specs/2026-10-16-cuttle-design.md`. Roadmap and shared interfaces: `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`. M1 (done): `docs/superpowers/plans/2026-10-16-cuttle-m1-foundation.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle` (PowerShell or Git Bash), on the branch `m2-engine`.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` or `pnpm add` fails with EPERM on Windows, run it again.
- `*.browser.test.ts` files run in headless Chromium (the `browser` vitest project); all other `*.test.ts` files run in Node (the `node` project). `pnpm test` runs both.
- **Golden images.** A golden test renders a scenario and compares it with `packages/engine/test/__golden__/<test file>/<name>.<platform>.png`. The first run of a new scenario writes the PNG and fails on purpose with `golden created, look at it and run the tests again: <path>`. Open every new PNG (the Read tool shows images), check it against the description in the step, and only then run the tests again. If a PNG is wrong, fix the code, delete the PNG and repeat. `pnpm exec vitest run -u` rewrites goldens that no longer match; use it only when a change of look is intended, and look at every rewritten PNG. With `CI=true` no golden is ever written. Commit the PNGs.
- A golden scenario is added after the code it shows, never before: a golden written by unfinished code locks in the wrong picture.

## Decisions made while planning

A spike (vitest 5.0.5, Playwright 1.64.1 with Chromium 156, Electron 44.7.2, Windows 11) and a full prototype of this plan settled these points. Every code block below ran: 174 tests pass twice in a row, `pnpm typecheck` is clean, and the Electron check matched all 38 goldens with 0 differing pixels.

- **Where the goldens run.** vitest browser mode with Playwright's headless Chromium. Its WebGL runs on SwiftShader, which is deterministic (same bytes across runs and processes). Electron with `app.disableHardwareAcceleration()` and `--enable-unsafe-swiftshader` produces the same bytes, text included, so Task 14 checks the roadmap's "pass in headless Electron" against the very same PNGs. On a real GPU Electron differs in anti-aliased edges (745 of 65 536 bytes on a test triangle), so exports may differ from goldens by a hair; that is fine.
- **Golden comparison** happens in Node through a custom vitest browser command (`matchGolden`): the browser sends raw top-down RGBA from `readPixels`, Node compares with pixelmatch (threshold 0.05, no mismatched pixels allowed) and writes `actual`/`diff` PNGs to `.vitest/golden-diff/` on failure. This tests the framebuffer that M3 will encode, independent of DOM layout and device pixel ratio.
- **Goldens are per platform** (`<name>.win32.png`): text rasterizes differently per OS. M2 commits the Windows goldens. macOS goldens are created on a Mac with one `pnpm test` run (see "Open points").
- **TypeScript configs per package.** `tsconfig.base.json` holds the shared options; the root `tsconfig.json` keeps the pure packages free of DOM types; `packages/engine/tsconfig.json` adds the DOM lib; `tsconfig.node.json` covers the Node-side tooling (`vitest.config.ts`, `tools/`, the Electron bundle config).
- **Texture orientation and alpha.** Every texture is uploaded without a flip, so v = 0 is the top row for every source type. WebGL ignores `UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL` for an `ImageBitmap`, so bitmaps are created unflipped with `premultiplyAlpha: 'premultiply'`. Blending is premultiplied (`ONE, ONE_MINUS_SRC_ALPHA`).
- **Fonts.** Inter 400 and 600 from `@fontsource/inter`, imported with Vite's `?url` and registered with `FontFace` as `Cuttle Inter`. Text is drawn with Canvas2D (OffscreenCanvas) into sprite textures.
- **SVG.** `createImageBitmap(svgBlob)` fails in Chromium ("The source image could not be decoded"), so cursor SVGs go through an `<img>` first. `loadEngineAssets()` therefore needs a window, not a worker.
- **Interface change against the roadmap** (Task 15 updates the roadmap): the renderer needs fonts and cursor bitmaps, which load asynchronously, and the screen size to map source pixels. So `createRenderer(canvas, project, options)` takes `options: { assets, screenSize, backgroundImage? }`, and `loadEngineAssets(): Promise<EngineAssets>` is new. `FrameSources` and `Renderer` keep their names and fields.
- **Look rules the spec leaves open** (Task 15 writes them into the spec):
  - Chrome sizes are in *units*: 1 unit is 1 px when the output's short side is 1080 px, so 1:1 and 9:16 exports scale the same way.
  - `look.frame.enabled: false` means no window at all: the screen fills the output (letterboxed), square corners, no shadow. `style: 'none'` keeps the padding, the rounded corners and the shadow, without a title bar.
  - Still scenes use their own `frame` style with `look.frame.radius` and `look.frame.shadow`, and no title.
  - Only `system` follows the pointer shape. Its art is Cuttle's own Windows-like lookalikes; macOS lookalikes are phase 3. The designed arrows always show an arrow.
  - The cursor is 32 source px tall on a 1080-row screen (proportionally bigger on taller screens), times `look.cursor.size`, scaled with the zoom like the screen, and hidden while off the captured area.
  - `fill` masks take the per-channel median of eight samples 3 px outside the mask; `blur` masks blur heavily from the screen's mip chain. Both grow to whole pixels plus one, so no hairline of the hidden content shows.
  - Texts: `position` picks top, centre or bottom of the output; `lower-third` is left-aligned, the other styles centred. The badge sits in the content's top-right corner.
  - The webcam bubble is not mirrored.
  - The procedural backgrounds always drift slowly with output time; the schema has no switch for it.

## File structure

```
cuttle/
├── package.json                 scripts: test, typecheck, engine:electron
├── tsconfig.base.json           shared compiler options (new)
├── tsconfig.json                pure packages only (project, timeline)
├── tsconfig.node.json           vitest config, tools/, Electron bundle config (new)
├── vitest.config.ts             two projects: node and browser (Playwright Chromium)
├── tools/vitest/
│   ├── golden-types.ts          GoldenOptions, GoldenResult (shared with the browser typings)
│   └── golden-command.ts        matchGolden: the Node side of golden comparison
└── packages/engine/
    ├── package.json             @cuttle/engine
    ├── tsconfig.json            adds the DOM lib
    ├── src/
    │   ├── index.ts             public exports
    │   ├── color.ts             hexToRgb
    │   ├── layout.ts            pure geometry: units, window layout, source→output mapping,
    │   │                        cursor size, webcam rect, overlay/badge placement, still crop
    │   ├── env.d.ts             `*?url` module type
    │   ├── assets.ts            loadEngineAssets: fonts, cursor bitmaps; FONT_FAMILY
    │   ├── sprites.ts           drawLabel (Canvas2D), SpriteCache (text → texture)
    │   ├── renderer.ts          createRenderer, FrameSources, Renderer, RendererOptions
    │   ├── gl/
    │   │   ├── shader.ts        Shader: compile, link, chainable uniform setters
    │   │   ├── rect.ts          RECT_VERTEX, FRAGMENT_PRELUDE (SDF, coverage, dither), drawRect, withScissor
    │   │   ├── texture.ts       createTexture, uploadTexture, sourceSize
    │   │   └── target.ts        offscreen render target
    │   ├── presets/
    │   │   ├── backgrounds.ts   fragment shaders per background preset
    │   │   ├── frames.ts        window chrome per frame style
    │   │   ├── labels.ts        text, badge, card and window-title styles
    │   │   └── cursors.ts       cursor SVG art, hotspots, cursorImageFor
    │   └── passes/
    │       ├── sprite.ts        textured rect with opacity (labels, cursor images, layers)
    │       ├── background.ts    background preset over the whole output
    │       ├── window.ts        shadow, title bar, traffic lights, address field, title
    │       ├── content.ts       screen or still image in the content rect, rounded clip
    │       ├── masks.ts         fill and blur masks
    │       ├── cursor.ts        pointer, click ripples, spotlight
    │       └── webcam.ts        webcam bubble
    ├── test/
    │   ├── color.test.ts, layout.test.ts, presets.test.ts                      (Node)
    │   ├── smoke.browser.test.ts, gl.browser.test.ts, assets.browser.test.ts,
    │   │   sprites.browser.test.ts, renderer.browser.test.ts, golden.browser.test.ts (Chromium)
    │   ├── gl-util.ts           readPixels (top-down), pixelAt, toBase64
    │   ├── commands.d.ts        types for the matchGolden browser command
    │   ├── fixtures.ts          fake screen, webcam, page and background image
    │   ├── scenarios.ts         the golden scenarios
    │   ├── run-scenario.ts      project → timeline → renderer → pixels
    │   └── __golden__/          committed PNGs
    └── electron/
        ├── page.ts              renders scenarios on request (bundled by vite)
        ├── index.html
        ├── vite.config.ts       one IIFE bundle, fonts inlined
        └── main.mjs             hidden window, SwiftShader, compares with the goldens
```

---

### Task 1: Browser test harness and golden comparison

**Files:**
- Create: `tsconfig.base.json`, `tsconfig.node.json`, `tools/vitest/golden-types.ts`, `tools/vitest/golden-command.ts`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/test/commands.d.ts`, `packages/engine/test/gl-util.ts`
- Modify: `tsconfig.json`, `vitest.config.ts`, `package.json`, `.gitignore`
- Test: `packages/engine/test/smoke.browser.test.ts`

- [ ] **Step 1: Create the branch and install the test tools**

```bash
git switch -c m2-engine
pnpm add -D -w @vitest/browser-playwright@5.0.5 playwright pixelmatch pngjs @types/pngjs "@types/node@^22"
pnpm exec playwright install chromium
```

Expected: `package.json` gains the six dev dependencies; `@vitest/browser-playwright` must be exactly the installed vitest version (5.0.5; check with `pnpm why vitest` if pnpm picked another). Playwright downloads Chromium and its headless shell (about 700 MB the first time, cached per user).

- [ ] **Step 2: Split the TypeScript config**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  }
}
```

`tsconfig.json` (replace the whole file):

```json
{
  "extends": "./tsconfig.base.json",
  "include": ["packages/project/src", "packages/project/test", "packages/timeline/src", "packages/timeline/test"]
}
```

`tsconfig.node.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"],
    "allowImportingTsExtensions": true
  },
  "include": ["vitest.config.ts", "tools"]
}
```

`allowImportingTsExtensions` lets `vitest.config.ts` import `./tools/vitest/golden-command.ts` with its extension; without it Vite 8 warns about its config loader.

In `package.json`, replace the `typecheck` script:

```json
"typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json"
```

Append one line to `.gitignore`:

```
.vitest/
```

- [ ] **Step 3: Create the engine package**

`packages/engine/package.json`:

```json
{
  "name": "@cuttle/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cuttle/project": "workspace:*",
    "@cuttle/timeline": "workspace:*"
  }
}
```

`packages/engine/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src", "test"]
}
```

Run: `pnpm install`
Expected: the workspace links `@cuttle/engine`; no errors.

- [ ] **Step 4: Write the golden command**

`tools/vitest/golden-types.ts`:

```ts
export interface GoldenOptions {
  /** pixelmatch per-pixel colour threshold, 0..1 (default 0.05). */
  threshold?: number;
  /** How many pixels may differ before the test fails (default 0). */
  allowedMismatchedPixels?: number;
}

export interface GoldenResult {
  status: 'created' | 'updated' | 'match';
  mismatched: number;
}
```

`tools/vitest/golden-command.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { BrowserCommand } from 'vitest/node';
import type { GoldenOptions, GoldenResult } from './golden-types.ts';

/** Where the golden for `name` lives: next to the test file, one PNG per platform (text rasterizes differently per OS). */
export function goldenPath(testPath: string, name: string): string {
  return resolve(dirname(testPath), '__golden__', basename(testPath), `${name}.${process.platform}.png`);
}

function writePng(path: string, width: number, height: number, rgba: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  writeFileSync(path, PNG.sync.write(png));
}

/**
 * Compares top-down RGBA pixels from the browser with the golden PNG. Same rules as snapshots:
 * a missing golden is written and the test fails once ("review it"), `vitest -u` overwrites
 * mismatching goldens, and CI (`CI=true`) never writes one.
 */
export const matchGolden: BrowserCommand<
  [name: string, rgbaBase64: string, width: number, height: number, opts?: GoldenOptions],
  Promise<GoldenResult>
> = async (ctx, name, rgbaBase64, width, height, opts = {}) => {
  if (!ctx.testPath) throw new Error('matchGolden: no test path');
  const refPath = goldenPath(ctx.testPath, name);
  const actual = Buffer.from(rgbaBase64, 'base64');
  if (actual.length !== width * height * 4) {
    throw new Error(`matchGolden: expected ${width * height * 4} bytes, got ${actual.length}`);
  }
  // 'all' with -u, 'new' by default, 'none' on CI
  const mode = ctx.project.vitest.config.snapshotOptions.updateSnapshot;
  if (!existsSync(refPath)) {
    if (mode === 'none') throw new Error(`no golden at ${refPath} (CI does not create goldens)`);
    writePng(refPath, width, height, actual);
    throw new Error(`golden created, look at it and run the tests again: ${refPath}`);
  }
  const ref = PNG.sync.read(readFileSync(refPath));
  if (ref.width !== width || ref.height !== height) {
    if (mode === 'all') {
      writePng(refPath, width, height, actual);
      return { status: 'updated', mismatched: width * height };
    }
    throw new Error(`golden is ${ref.width}x${ref.height}, render is ${width}x${height}: ${refPath}`);
  }
  const diff = new Uint8Array(width * height * 4);
  const mismatched = pixelmatch(ref.data, actual, diff, width, height, { threshold: opts.threshold ?? 0.05 });
  if (mismatched <= (opts.allowedMismatchedPixels ?? 0)) return { status: 'match', mismatched };
  if (mode === 'all') {
    writePng(refPath, width, height, actual);
    return { status: 'updated', mismatched };
  }
  const outDir = resolve(ctx.project.config.root, '.vitest', 'golden-diff', basename(ctx.testPath));
  writePng(resolve(outDir, `${name}.actual.png`), width, height, actual);
  writePng(resolve(outDir, `${name}.diff.png`), width, height, diff);
  throw new Error(`${mismatched} pixels differ from ${refPath}\n  actual and diff images: ${outDir}`);
};
```

`packages/engine/test/commands.d.ts`:

```ts
import type { GoldenOptions, GoldenResult } from '../../../tools/vitest/golden-types';

declare module 'vitest/browser' {
  interface BrowserCommands {
    matchGolden: (name: string, rgbaBase64: string, width: number, height: number, opts?: GoldenOptions) => Promise<GoldenResult>;
  }
}
```

- [ ] **Step 5: Configure the two vitest projects**

`vitest.config.ts` (replace the whole file):

```ts
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { matchGolden } from './tools/vitest/golden-command.ts';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.browser.test.ts'],
        },
      },
      {
        // Pre-bundle dependencies the browser tests import; otherwise Vite optimizes them
        // mid-run and reloads the page ("Vite unexpectedly reloaded a test").
        optimizeDeps: { include: ['zod'] },
        test: {
          name: 'browser',
          include: ['packages/*/test/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            viewport: { width: 1280, height: 720 },
            commands: { matchGolden },
          },
        },
      },
    ],
  },
});
```

`passWithNoTests` must stay at the root: inside a project's `test` block it is a type error and ignored.

- [ ] **Step 6: Write the smoke test**

`packages/engine/test/gl-util.ts`:

```ts
export interface Pixels {
  width: number;
  height: number;
  /** RGBA8, rows top to bottom. */
  data: Uint8Array;
}

/** Reads the drawing buffer of `gl` and flips it so row 0 is the top of the image. */
export function readPixels(gl: WebGL2RenderingContext): Pixels {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const raw = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  const data = new Uint8Array(width * height * 4);
  const row = width * 4;
  for (let y = 0; y < height; y++) data.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return { width, height, data };
}

export function pixelAt(pixels: Pixels, x: number, y: number): number[] {
  const i = (y * pixels.width + x) * 4;
  return [...pixels.data.subarray(i, i + 4)];
}

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
```

`packages/engine/test/smoke.browser.test.ts`:

```ts
import { commands } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { pixelAt, readPixels, toBase64 } from './gl-util';

describe('browser test harness', () => {
  it('has WebGL2 and reads back exact pixels', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    expect(gl).not.toBeNull();
    gl!.clearColor(0.2, 0.4, 0.6, 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    expect(pixelAt(readPixels(gl!), 3, 3)).toEqual([51, 102, 153, 255]);
  });

  it('compares a render with its golden', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false })!;
    gl.clearColor(0.2, 0.4, 0.6, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const pixels = readPixels(gl);
    const result = await commands.matchGolden('smoke-clear', toBase64(pixels.data), pixels.width, pixels.height);
    expect(result.status).toBe('match');
  });
});
```

- [ ] **Step 7: Run the tests; the first run creates the golden**

Run: `pnpm test`
Expected: the M1 tests pass in the `|node|` project; `smoke.browser.test.ts` runs in `|browser (chromium)|`; `compares a render with its golden` FAILS with `golden created, look at it and run the tests again: …\packages\engine\test\__golden__\smoke.browser.test.ts\smoke-clear.win32.png`.

Open the PNG: a flat 16×16 square of rgb(51, 102, 153).

Run: `pnpm test`
Expected: PASS, 87 tests in 9 files.

Run: `pnpm typecheck`
Expected: exits with code 0 and prints only the three `tsc` commands.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json tsconfig.base.json tsconfig.node.json vitest.config.ts .gitignore tools packages/engine
git commit -m "Engine test harness: browser vitest project, golden images, per-package tsconfigs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Colours and layout geometry

All placement math is pure and tested in Node. Sizes are in units (1 px at 1080p on the short side), results in output pixels.

**Files:**
- Create: `packages/engine/src/color.ts`, `packages/engine/src/layout.ts`
- Test: `packages/engine/test/color.test.ts`, `packages/engine/test/layout.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/color.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hexToRgb } from '../src/color';

describe('hexToRgb', () => {
  it('converts #RRGGBB to 0..1 components', () => {
    expect(hexToRgb('#FF8000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb('#d97757')).toEqual([217 / 255, 119 / 255, 87 / 255]);
  });

  it('rejects anything else', () => {
    expect(() => hexToRgb('red')).toThrow('not a hex color: red');
    expect(() => hexToRgb('#FFF')).toThrow();
  });
});
```

`packages/engine/test/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  cursorSizePx,
  maskRectToOutput,
  placeBadge,
  placeOverlay,
  sourceRectToOutput,
  sourceToOutput,
  stillCrop,
  unitFor,
  uvRect,
  webcamRect,
  windowLayout,
} from '../src/layout';

const HD = { width: 1920, height: 1080 };

describe('unitFor', () => {
  it('is 1 at 1080 px on the short side', () => {
    expect(unitFor(HD)).toBe(1);
    expect(unitFor({ width: 1080, height: 1920 })).toBe(1);
    expect(unitFor({ width: 640, height: 360 })).toBeCloseTo(1 / 3);
  });
});

describe('windowLayout', () => {
  it('fits a 16:9 screen with a 36-unit title bar into 1080p, padded and centred', () => {
    const layout = windowLayout(HD, 16 / 9, { titleBar: 36, radius: 14 });
    // height-limited: 1080 - 2*64 - 36 = 916 rows of content, 916 * 16/9 = 1628.4 columns
    expect(layout.content).toEqual([146, 100, 1628, 916]);
    expect(layout.window).toEqual([146, 64, 1628, 952]);
    expect(layout.titleBar).toBe(36);
    expect(layout.radius).toBe(14);
  });

  it('is width-limited for a tall output', () => {
    const layout = windowLayout({ width: 1080, height: 1920 }, 16 / 10, { titleBar: 36, radius: 14 });
    expect(layout.content[2]).toBe(952); // 1080 - 2*64
    expect(layout.content[3]).toBe(595); // 952 / 1.6
    expect(layout.window[1]).toBe(Math.round((1920 - 595 - 36) / 2));
  });

  it('scales padding, title bar and radius with the output size', () => {
    const layout = windowLayout({ width: 640, height: 360 }, 16 / 10, { titleBar: 36, radius: 15 });
    expect(layout.titleBar).toBe(12);
    expect(layout.radius).toBeCloseTo(5);
    expect(layout.content[3]).toBe(Math.round(360 - (2 * 64) / 3 - 12));
  });

  it('fills the output without chrome', () => {
    const layout = windowLayout(HD, 16 / 10, null);
    expect(layout.content).toEqual([96, 0, 1728, 1080]);
    expect(layout.window).toEqual(layout.content);
    expect(layout.radius).toBe(0);
    expect(layout.titleBar).toBe(0);
  });

  it('caps the radius at half the window size', () => {
    expect(windowLayout({ width: 200, height: 200 }, 1, { titleBar: 0, radius: 900 }).radius).toBeLessThanOrEqual(100);
  });
});

describe('source to output mapping', () => {
  const content: [number, number, number, number] = [100, 50, 800, 500];

  it('maps the full screen onto the content rect', () => {
    const full: [number, number, number, number] = [0, 0, 1600, 1000];
    expect(sourceToOutput(0, 0, full, content)).toEqual([100, 50]);
    expect(sourceToOutput(1600, 1000, full, content)).toEqual([900, 550]);
    expect(sourceRectToOutput([400, 250, 800, 500], full, content)).toEqual([300, 175, 400, 250]);
  });

  it('follows the zoom crop', () => {
    const zoom: [number, number, number, number] = [800, 500, 800, 500]; // bottom-right quarter, 2x
    expect(sourceToOutput(800, 500, zoom, content)).toEqual([100, 50]);
    expect(sourceToOutput(1200, 750, zoom, content)).toEqual([500, 300]);
    expect(sourceRectToOutput([800, 500, 100, 50], zoom, content)).toEqual([100, 50, 100, 50]);
  });

  it('grows mask rects to whole pixels plus one', () => {
    const full: [number, number, number, number] = [0, 0, 1600, 1000];
    expect(maskRectToOutput([400, 250, 800, 500], full, content)).toEqual([299, 174, 402, 252]);
    expect(maskRectToOutput([401, 251, 3, 3], full, content)).toEqual([299, 174, 4, 4]); // 300.5..302 → 299..303
  });

  it('turns image px into texture coordinates', () => {
    expect(uvRect([0, 0, 1600, 1000], { width: 1600, height: 1000 })).toEqual([0, 0, 1, 1]);
    expect(uvRect([400, 250, 800, 500], { width: 1600, height: 1000 })).toEqual([0.25, 0.25, 0.5, 0.5]);
  });
});

describe('cursorSizePx', () => {
  it('is 32 source px on a 1080-row screen, scaled like the content', () => {
    expect(cursorSizePx({ width: 1920, height: 1080 }, 1, [0, 0, 1920, 1080], [0, 0, 1920, 1080])).toBe(32);
    expect(cursorSizePx({ width: 1920, height: 1080 }, 1, [0, 0, 1920, 1080], [0, 0, 960, 540])).toBe(16);
  });

  it('grows with the zoom, the size setting and the screen height', () => {
    expect(cursorSizePx({ width: 1920, height: 1080 }, 1, [0, 0, 960, 540], [0, 0, 1920, 1080])).toBe(64);
    expect(cursorSizePx({ width: 1920, height: 1080 }, 1.5, [0, 0, 1920, 1080], [0, 0, 1920, 1080])).toBe(48);
    expect(cursorSizePx({ width: 2560, height: 1440 }, 1, [0, 0, 2560, 1440], [0, 0, 2560, 1440])).toBeCloseTo(42.67, 2);
  });
});

describe('webcamRect', () => {
  it('puts a square of size * short side into the chosen corner, 40 units from the edges', () => {
    expect(webcamRect(HD, 'bottom-left', 0.2)).toEqual([40, 1080 - 40 - 216, 216, 216]);
    expect(webcamRect(HD, 'top-right', 0.2)).toEqual([1920 - 40 - 216, 40, 216, 216]);
    expect(webcamRect(HD, 'top-left', 0.2)).toEqual([40, 40, 216, 216]);
    expect(webcamRect(HD, 'bottom-right', 0.2)).toEqual([1920 - 40 - 216, 1080 - 40 - 216, 216, 216]);
  });
});

describe('placeOverlay and placeBadge', () => {
  const sprite = { width: 300, height: 60 };

  it('centres a text horizontally at the top, centre or bottom, 56 units from the edge', () => {
    expect(placeOverlay(HD, sprite, 'top', 'center')).toEqual([810, 56, 300, 60]);
    expect(placeOverlay(HD, sprite, 'center', 'center')).toEqual([810, 510, 300, 60]);
    expect(placeOverlay(HD, sprite, 'bottom', 'center')).toEqual([810, 1080 - 56 - 60, 300, 60]);
  });

  it('left-aligns when asked', () => {
    expect(placeOverlay(HD, sprite, 'bottom', 'left')).toEqual([56, 964, 300, 60]);
  });

  it('puts the badge into the content top-right corner', () => {
    expect(placeBadge([100, 50, 800, 500], { width: 120, height: 40 }, 1)).toEqual([100 + 800 - 16 - 120, 66, 120, 40]);
  });
});

describe('stillCrop', () => {
  const view = { width: 1600, height: 1000 };
  const page = { width: 1280, height: 2400 };

  it('shows the top of a tall image at the view width', () => {
    expect(stillCrop(page, view, 'none', 0.5)).toEqual([0, 0, 1280, 800]);
  });

  it('scrolls a tall image from top to bottom, eased', () => {
    expect(stillCrop(page, view, 'scroll', 0)).toEqual([0, 0, 1280, 800]);
    expect(stillCrop(page, view, 'scroll', 0.5)).toEqual([0, 800, 1280, 800]);
    expect(stillCrop(page, view, 'scroll', 1)).toEqual([0, 1600, 1280, 800]);
  });

  it('covers the view with a wide image, centred', () => {
    expect(stillCrop({ width: 2000, height: 500 }, view, 'none', 0)).toEqual([600, 0, 800, 500]);
    expect(stillCrop({ width: 2000, height: 500 }, view, 'scroll', 1)).toEqual([600, 0, 800, 500]);
  });

  it('zooms into the centre for kenburns', () => {
    expect(stillCrop(page, view, 'kenburns', 0)).toEqual([0, 0, 1280, 800]);
    const [x, y, w, h] = stillCrop(page, view, 'kenburns', 1);
    expect(w).toBeCloseTo(1280 / 1.08);
    expect(h).toBeCloseTo(800 / 1.08);
    expect(x + w / 2).toBeCloseTo(640);
    expect(y + h / 2).toBeCloseTo(400);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm exec vitest run packages/engine/test/color.test.ts packages/engine/test/layout.test.ts`
Expected: FAIL, both files report that `../src/color` and `../src/layout` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/engine/src/color.ts`:

```ts
export type Rgb = [r: number, g: number, b: number];

/** `#RRGGBB` to sRGB components in 0..1. */
export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) throw new Error(`not a hex color: ${hex}`);
  const n = Number.parseInt(match[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
```

`packages/engine/src/layout.ts`:

```ts
import type { Look, Rect, StillMotion, TextPosition } from '@cuttle/project';
import { easeInOutCubic } from '@cuttle/timeline';

export interface Size {
  width: number;
  height: number;
}

/** Chrome sizes are given in units: one unit is 1 px when the output's short side is 1080 px. */
export function unitFor(output: Size): number {
  return Math.min(output.width, output.height) / 1080;
}

/** Space between the window and the output edge, in units. */
export const WINDOW_PADDING = 64;

export interface WindowLayout {
  /** The whole window in output px, title bar included. */
  window: Rect;
  /** Where the screen or still image is drawn, in output px. */
  content: Rect;
  /** Corner radius of the window in output px. */
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
  let width = availableWidth;
  let height = width / contentAspect;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * contentAspect;
  }
  width = Math.round(width);
  height = Math.round(height);
  const x = Math.round((output.width - width) / 2);
  const y = Math.round((output.height - height - titleBar) / 2);
  const radius = chrome ? Math.min(chrome.radius * unit, width / 2, (height + titleBar) / 2) : 0;
  return { window: [x, y, width, height + titleBar], content: [x, y + titleBar, width, height], radius, titleBar };
}

/** Maps a point in source px to output px, for a screen cropped to `zoom` and shown in `content`. */
export function sourceToOutput(x: number, y: number, zoom: Rect, content: Rect): [x: number, y: number] {
  return [content[0] + ((x - zoom[0]) / zoom[2]) * content[2], content[1] + ((y - zoom[1]) / zoom[3]) * content[3]];
}

/** Maps a rect in source px to output px, like `sourceToOutput`. */
export function sourceRectToOutput(rect: Rect, zoom: Rect, content: Rect): Rect {
  const [x, y] = sourceToOutput(rect[0], rect[1], zoom, content);
  return [x, y, (rect[2] / zoom[2]) * content[2], (rect[3] / zoom[3]) * content[3]];
}

/**
 * Where a mask goes in output px: its mapped rect grown to whole pixels plus one on every side,
 * so the filtered edge of what it hides cannot peek out as a hairline.
 */
export function maskRectToOutput(rect: Rect, zoom: Rect, content: Rect): Rect {
  const [x, y, w, h] = sourceRectToOutput(rect, zoom, content);
  const left = Math.floor(x) - 1;
  const top = Math.floor(y) - 1;
  return [left, top, Math.ceil(x + w) + 1 - left, Math.ceil(y + h) + 1 - top];
}

/** A rect in image px as texture coordinates `[u, v, w, h]`, with v = 0 at the image's top row. */
export function uvRect(rect: Rect, image: Size): Rect {
  return [rect[0] / image.width, rect[1] / image.height, rect[2] / image.width, rect[3] / image.height];
}

/** Cursor height in source px on a screen 1080 px tall; taller screens get a proportionally bigger cursor. */
export const CURSOR_SOURCE_PX = 32;

/** Cursor height in output px: `look.cursor.size` times the base size, scaled with the zoom like the screen. */
export function cursorSizePx(screen: Size, size: number, zoom: Rect, content: Rect): number {
  return CURSOR_SOURCE_PX * size * (screen.height / 1080) * (content[2] / zoom[2]);
}

/** Space between the webcam bubble and the output edge, in units. */
export const WEBCAM_MARGIN = 40;

/** The webcam bubble's square in output px; `size` is its diameter as a share of the output's short side. */
export function webcamRect(output: Size, corner: Look['webcam']['corner'], size: number): Rect {
  const unit = unitFor(output);
  const diameter = Math.round(size * Math.min(output.width, output.height));
  const margin = Math.round(WEBCAM_MARGIN * unit);
  const x = corner.endsWith('left') ? margin : output.width - margin - diameter;
  const y = corner.startsWith('top') ? margin : output.height - margin - diameter;
  return [x, y, diameter, diameter];
}

/** Space between a text overlay and the output edge, in units. */
export const OVERLAY_MARGIN = 56;

/** Where a text overlay sprite goes in the output: `position` picks the row, `align` the column. */
export function placeOverlay(output: Size, sprite: Size, position: TextPosition, align: 'center' | 'left'): Rect {
  const margin = Math.round(OVERLAY_MARGIN * unitFor(output));
  const x = align === 'left' ? margin : Math.round((output.width - sprite.width) / 2);
  const y =
    position === 'top'
      ? margin
      : position === 'bottom'
        ? output.height - margin - sprite.height
        : Math.round((output.height - sprite.height) / 2);
  return [x, y, sprite.width, sprite.height];
}

/** Space between the speed badge and the content's top-right corner, in units. */
export const BADGE_MARGIN = 16;

/** The speed badge sits in the top-right corner of the content. */
export function placeBadge(content: Rect, sprite: Size, unit: number): Rect {
  const margin = Math.round(BADGE_MARGIN * unit);
  return [
    Math.round(content[0] + content[2] - margin - sprite.width),
    Math.round(content[1] + margin),
    sprite.width,
    sprite.height,
  ];
}

/** How far a `kenburns` still zooms in by the end of its scene. */
export const KENBURNS_ZOOM = 1.08;

/**
 * The part of a still image (image px) shown in a view of size `view` at `progress` (0..1).
 * The image fills the view's width from its top; an image too short for that covers the view,
 * centred. `scroll` pans to the bottom, `kenburns` zooms into the centre, both eased.
 */
export function stillCrop(image: Size, view: Size, motion: StillMotion, progress: number): Rect {
  const viewAspect = view.width / view.height;
  let width = image.width;
  let height = width / viewAspect;
  if (height > image.height) {
    height = image.height;
    width = height * viewAspect;
  }
  const x = (image.width - width) / 2;
  const eased = easeInOutCubic(progress);
  if (motion === 'scroll') return [x, eased * (image.height - height), width, height];
  if (motion === 'kenburns') {
    const zoom = 1 + (KENBURNS_ZOOM - 1) * eased;
    return [x + (width - width / zoom) / 2, (height - height / zoom) / 2, width / zoom, height / zoom];
  }
  return [x, 0, width, height];
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run packages/engine/test/color.test.ts packages/engine/test/layout.test.ts`
Expected: PASS, 22 tests in 2 files.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/color.ts packages/engine/src/layout.ts packages/engine/test/color.test.ts packages/engine/test/layout.test.ts
git commit -m "engine: colours and layout geometry (units, window, zoom mapping, cursor, webcam, overlays, stills)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: WebGL helpers

Every pass draws one rect in output pixels (origin top-left, y down). The shared fragment prelude gives each shader the output pixel `v_px`, the rect coordinate `v_uv`, a rounded-rect SDF, one-pixel coverage and a deterministic dither.

**Files:**
- Create: `packages/engine/src/gl/shader.ts`, `packages/engine/src/gl/rect.ts`, `packages/engine/src/gl/texture.ts`, `packages/engine/src/gl/target.ts`
- Test: `packages/engine/test/gl.browser.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/gl.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect, withScissor } from '../src/gl/rect';
import { Shader } from '../src/gl/shader';
import { createTexture, sourceSize, uploadTexture } from '../src/gl/texture';
import { pixelAt, readPixels } from './gl-util';

function context(width: number, height: number): WebGL2RenderingContext {
  const canvas = new OffscreenCanvas(width, height);
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false });
  if (!gl) throw new Error('no WebGL2');
  gl.bindVertexArray(gl.createVertexArray());
  return gl;
}

const TEXTURED = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
void main() { o_color = texture(u_tex, v_uv); }`;

const SOLID = `${FRAGMENT_PRELUDE}
uniform vec3 u_color;
void main() { o_color = vec4(u_color, 1.0); }`;

describe('Shader', () => {
  it('names the shader and quotes the compiler log when compiling fails', () => {
    const gl = context(4, 4);
    expect(() => new Shader(gl, 'broken', RECT_VERTEX, `${FRAGMENT_PRELUDE}\nvoid main() { o_color = nope; }`)).toThrow(
      /shader broken \(fragment\) failed to compile: .*nope/s,
    );
  });
});

describe('drawRect', () => {
  it('draws a rect given in output px with the origin at the top-left', () => {
    const gl = context(8, 8);
    const shader = new Shader(gl, 'solid', RECT_VERTEX, SOLID).use();
    shader.vec3('u_color', [1, 0, 0]);
    drawRect(gl, shader, [0, 0, 4, 2], { width: 8, height: 8 });
    const pixels = readPixels(gl);
    expect(pixelAt(pixels, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(pixels, 3, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(pixels, 4, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(pixels, 0, 2)).toEqual([0, 0, 0, 255]);
  });

  it('keeps drawing inside the scissor rect', () => {
    const gl = context(8, 8);
    const shader = new Shader(gl, 'solid', RECT_VERTEX, SOLID).use();
    shader.vec3('u_color', [0, 1, 0]);
    withScissor(gl, { width: 8, height: 8 }, [2, 2, 2, 2], () => drawRect(gl, shader, [0, 0, 8, 8], { width: 8, height: 8 }));
    const pixels = readPixels(gl);
    expect(pixelAt(pixels, 2, 2)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(pixels, 1, 2)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(pixels, 4, 4)).toEqual([0, 0, 0, 255]);
  });
});

describe('uploadTexture', () => {
  async function sources(): Promise<TexImageSource[]> {
    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 1, 1); // top-left texel red
    return [canvas, await createImageBitmap(canvas, { premultiplyAlpha: 'premultiply' })];
  }

  it('lands every source type with its top row at the top', async () => {
    for (const source of await sources()) {
      const gl = context(2, 2);
      const texture = createTexture(gl, false);
      uploadTexture(gl, texture, source, false);
      const shader = new Shader(gl, 'textured', RECT_VERTEX, TEXTURED).use().texture('u_tex', 0, texture);
      drawRect(gl, shader, [0, 0, 2, 2], { width: 2, height: 2 });
      const pixels = readPixels(gl);
      expect(pixelAt(pixels, 0, 0)).toEqual([255, 0, 0, 255]);
      expect(pixelAt(pixels, 1, 1)).toEqual([0, 0, 255, 255]);
    }
  });

  it('reads the size of canvases and bitmaps', async () => {
    for (const source of await sources()) expect(sourceSize(source)).toEqual({ width: 2, height: 2 });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm exec vitest run packages/engine/test/gl.browser.test.ts`
Expected: FAIL, the imports from `../src/gl/…` cannot be resolved.

- [ ] **Step 3: Implement the helpers**

`packages/engine/src/gl/shader.ts`:

```ts
/** A linked WebGL2 program with chainable uniform setters. Unknown uniforms are ignored, like WebGL does. */
export class Shader {
  readonly program: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly label: string,
    vertex: string,
    fragment: string,
  ) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertex, `${label} (vertex)`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment, `${label} (fragment)`);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`shader "${label}" failed to link: ${log}`);
    }
    this.program = program;
  }

  use(): this {
    this.gl.useProgram(this.program);
    return this;
  }

  float(name: string, value: number): this {
    this.gl.uniform1f(this.location(name), value);
    return this;
  }

  int(name: string, value: number): this {
    this.gl.uniform1i(this.location(name), value);
    return this;
  }

  vec2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.location(name), x, y);
    return this;
  }

  vec3(name: string, value: readonly [number, number, number]): this {
    this.gl.uniform3f(this.location(name), value[0], value[1], value[2]);
    return this;
  }

  vec4(name: string, value: readonly [number, number, number, number]): this {
    this.gl.uniform4f(this.location(name), value[0], value[1], value[2], value[3]);
    return this;
  }

  /** Binds `texture` to texture unit `unit` and points the sampler `name` at it. */
  texture(name: string, unit: number, texture: WebGLTexture): this {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(this.location(name), unit);
    return this;
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }

  private location(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    return this.locations.get(name)!;
  }
}

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`could not create shader ${label}`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader ${label} failed to compile: ${log}`);
  }
  return shader;
}
```

`packages/engine/src/gl/rect.ts`:

```ts
import type { Rect } from '@cuttle/project';
import type { Size } from '../layout';
import type { Shader } from './shader';

/**
 * Every pass draws one rect given in output px (origin top-left, y down). The fragment shader
 * gets `v_px`, the output pixel centre, and `v_uv`, 0..1 across the rect from its top-left corner.
 */
export const RECT_VERTEX = `#version 300 es
uniform vec2 u_resolution;
uniform vec4 u_rect;
out vec2 v_px;
out vec2 v_uv;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  v_uv = corner;
  v_px = u_rect.xy + corner * u_rect.zw;
  vec2 clip = v_px / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

/** Shared start of every fragment shader: inputs, a rounded-rect SDF, antialiased coverage and dithering. */
export const FRAGMENT_PRELUDE = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
in vec2 v_px;
in vec2 v_uv;
out vec4 o_color;

// Signed distance in px from p to a rounded rect (x, y, w, h); negative inside.
float sdRoundRect(vec2 p, vec4 rect, float radius) {
  vec2 halfSize = rect.zw * 0.5;
  vec2 q = abs(p - rect.xy - halfSize) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

// 1 inside, 0 outside, a one-pixel ramp across the edge.
float coverage(float d) {
  return clamp(0.5 - d, 0.0, 1.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Breaks up 8-bit banding in gradients; deterministic per pixel.
vec3 dither(vec3 color) {
  return color + (hash12(floor(v_px)) - 0.5) / 255.0;
}
`;

/** Draws `rect` (output px) with `shader`, which must already be in use with its other uniforms set. */
export function drawRect(gl: WebGL2RenderingContext, shader: Shader, rect: Rect, output: Size): void {
  shader.vec2('u_resolution', output.width, output.height).vec4('u_rect', rect);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/** Runs `draw` with drawing limited to `rect` (output px). */
export function withScissor(gl: WebGL2RenderingContext, output: Size, rect: Rect, draw: () => void): void {
  const x = Math.floor(rect[0]);
  const y = Math.floor(rect[1]);
  const right = Math.ceil(rect[0] + rect[2]);
  const bottom = Math.ceil(rect[1] + rect[3]);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x, output.height - bottom, right - x, bottom - y);
  try {
    draw();
  } finally {
    gl.disable(gl.SCISSOR_TEST);
  }
}
```

`packages/engine/src/gl/texture.ts`:

```ts
import type { Size } from '../layout';

/** A 2D texture with linear filtering and clamped edges; with `mipmaps`, minification is trilinear. */
export function createTexture(gl: WebGL2RenderingContext, mipmaps: boolean): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/**
 * Uploads `source` with its top row at v = 0 (no flip) and premultiplied alpha. WebGL ignores
 * both pixel-store flags for an ImageBitmap, so bitmaps must be created unflipped and with
 * `premultiplyAlpha: 'premultiply'`; that way every source type lands the same way.
 */
export function uploadTexture(gl: WebGL2RenderingContext, texture: WebGLTexture, source: TexImageSource, mipmaps: boolean): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
}

/** Pixel size of anything `texImage2D` accepts. */
export function sourceSize(source: TexImageSource): Size {
  if ('displayWidth' in source) return { width: source.displayWidth, height: source.displayHeight }; // VideoFrame
  if ('videoWidth' in source) return { width: source.videoWidth, height: source.videoHeight };
  if ('naturalWidth' in source) return { width: source.naturalWidth, height: source.naturalHeight };
  return { width: source.width, height: source.height };
}
```

`packages/engine/src/gl/target.ts`:

```ts
import type { Size } from '../layout';
import { createTexture } from './texture';

/** An offscreen RGBA8 framebuffer the size of the output. Its row 0 is the bottom of the image, like the canvas. */
export interface RenderTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

export function createRenderTarget(gl: WebGL2RenderingContext, size: Size): RenderTarget {
  const texture = createTexture(gl, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`render target incomplete: 0x${status.toString(16)}`);
  return { framebuffer, texture };
}

export function deleteRenderTarget(gl: WebGL2RenderingContext, target: RenderTarget): void {
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run packages/engine/test/gl.browser.test.ts`
Expected: PASS, 5 tests. The upload test proves that a canvas and an ImageBitmap both land with their top row at the top.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/gl packages/engine/test/gl.browser.test.ts
git commit -m "engine: WebGL helpers (shader, rect pass, textures, render target)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Presets

Presets are data plus shader code, so new looks are added without touching the passes.

**Files:**
- Create: `packages/engine/src/presets/backgrounds.ts`, `packages/engine/src/presets/frames.ts`, `packages/engine/src/presets/labels.ts`, `packages/engine/src/presets/cursors.ts`
- Test: `packages/engine/test/presets.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/presets.test.ts`:

```ts
import { BACKGROUND_PRESETS, CURSOR_SHAPES, CURSOR_STYLES, FRAME_STYLES, TEXT_STYLES } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { BACKGROUNDS } from '../src/presets/backgrounds';
import { CURSOR_ART, CURSOR_GRID, cursorImageFor } from '../src/presets/cursors';
import { FRAME_CHROME } from '../src/presets/frames';
import { TEXT_LABELS } from '../src/presets/labels';

describe('preset registries', () => {
  it('have a shader for every background preset', () => {
    for (const preset of BACKGROUND_PRESETS) expect(BACKGROUNDS[preset]).toContain('void main()');
  });

  it('have chrome for every frame style; only "none" has no title bar', () => {
    for (const style of FRAME_STYLES) expect(FRAME_CHROME[style].titleBar > 0).toBe(style !== 'none');
  });

  it('have a label style for every text style', () => {
    for (const style of TEXT_STYLES) expect(TEXT_LABELS[style].size).toBeGreaterThan(0);
  });
});

describe('cursor art', () => {
  it('gives system cursors one image per shape and the designed arrows a fixed image', () => {
    for (const shape of CURSOR_SHAPES) {
      expect(cursorImageFor('system', shape)).toBe(`system:${shape}`);
      expect(cursorImageFor('arrow-white', shape)).toBe('arrow-white');
      expect(cursorImageFor('arrow-black', shape)).toBe('arrow-black');
      expect(cursorImageFor('dot', shape)).toBeUndefined();
    }
  });

  it('has art with an in-grid hotspot for every image a style can ask for', () => {
    for (const style of CURSOR_STYLES) {
      for (const shape of CURSOR_SHAPES) {
        const image = cursorImageFor(style, shape);
        if (!image) continue;
        const art = CURSOR_ART[image];
        expect(art.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">')).toBe(true);
        for (const coordinate of art.hotspot) {
          expect(coordinate).toBeGreaterThanOrEqual(0);
          expect(coordinate).toBeLessThanOrEqual(CURSOR_GRID);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm exec vitest run packages/engine/test/presets.test.ts`
Expected: FAIL, the imports from `../src/presets/…` cannot be resolved.

- [ ] **Step 3: Write the background shaders**

Each entry is the body of a fragment shader that follows `FRAGMENT_PRELUDE` (Task 3). `u_time` is the output time in seconds; the drift is slow enough that a 60 s demo shows a gentle movement.

`packages/engine/src/presets/backgrounds.ts`:

```ts
import type { BackgroundPreset } from '@cuttle/project';

/**
 * Background presets: the body of a fragment shader that follows `FRAGMENT_PRELUDE` and fills the
 * whole output. Uniforms: `u_time` (output seconds, for a slow drift), `u_color` (solid) and
 * `u_image` / `u_imageSize` (image, covered and centred).
 */
export const BACKGROUNDS: Record<BackgroundPreset, string> = {
  'sunset-sky': `
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  float y = v_uv.y;
  vec3 top = vec3(0.106, 0.110, 0.290);
  vec3 middle = vec3(0.722, 0.337, 0.475);
  vec3 low = vec3(0.976, 0.659, 0.400);
  vec3 color = mix(top, middle, smoothstep(0.0, 0.65, y));
  color = mix(color, low, smoothstep(0.55, 1.0, y));
  vec2 sun = vec2(0.5 + 0.08 * sin(u_time * 0.05), 1.05);
  vec2 d = (v_uv - sun) * vec2(aspect, 1.0);
  color += vec3(1.0, 0.80, 0.58) * exp(-dot(d, d) * 5.0) * 0.5;
  float clouds = sin(y * 10.0 + sin(v_uv.x * aspect * 2.2 + u_time * 0.03) * 0.9);
  color += vec3(0.045, 0.020, 0.030) * clouds * smoothstep(0.25, 0.85, y);
  o_color = vec4(dither(clamp(color, 0.0, 1.0)), 1.0);
}`,
  aurora: `
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  float x = v_uv.x * aspect;
  float y = v_uv.y;
  vec3 color = mix(vec3(0.020, 0.031, 0.086), vec3(0.039, 0.067, 0.149), y);
  float t = u_time * 0.04;
  vec3 tints[3] = vec3[3](vec3(0.20, 0.95, 0.65), vec3(0.25, 0.60, 1.00), vec3(0.72, 0.36, 0.95));
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float center = 0.32 + 0.13 * fi + 0.07 * sin(x * (1.3 + 0.45 * fi) + t * (1.0 + fi) + fi * 2.1);
    float k = (y - center) / (0.06 + 0.03 * fi);
    color += tints[i] * exp(-k * k) * 0.42;
  }
  o_color = vec4(dither(clamp(color, 0.0, 1.0)), 1.0);
}`,
  mesh: `
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);
  float t = u_time * 0.05;
  vec2 points[4] = vec2[4](
    vec2(0.18 * aspect + 0.04 * sin(t), 0.22),
    vec2(0.82 * aspect, 0.18 + 0.05 * cos(t * 1.3)),
    vec2(0.25 * aspect, 0.85 + 0.04 * cos(t * 0.7)),
    vec2(0.78 * aspect + 0.05 * cos(t * 0.9), 0.80));
  vec3 colors[4] = vec3[4](
    vec3(0.486, 0.361, 1.000),
    vec3(1.000, 0.478, 0.714),
    vec3(0.298, 0.788, 0.941),
    vec3(1.000, 0.722, 0.420));
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 d = p - points[i];
    float w = 1.0 / (0.02 + pow(dot(d, d), 1.5));
    sum += colors[i] * w;
    total += w;
  }
  o_color = vec4(dither(sum / total), 1.0);
}`,
  solid: `
uniform vec3 u_color;
void main() {
  o_color = vec4(u_color, 1.0);
}`,
  image: `
uniform sampler2D u_image;
uniform vec2 u_imageSize;
void main() {
  float scale = max(u_resolution.x / u_imageSize.x, u_resolution.y / u_imageSize.y);
  vec2 shown = u_resolution / scale;
  vec2 origin = (u_imageSize - shown) * 0.5;
  o_color = vec4(texture(u_image, (origin + v_uv * shown) / u_imageSize).rgb, 1.0);
}`,
};
```

- [ ] **Step 4: Write the frame, label and cursor presets**

`packages/engine/src/presets/frames.ts`:

```ts
import type { FrameStyle } from '@cuttle/project';

/** Window chrome per frame style. Sizes are in units (1 px at 1080p), colours are `#RRGGBB`. */
export interface FrameChrome {
  /** Title bar height; 0 means no title bar (the `none` style keeps radius and shadow). */
  titleBar: number;
  bar: string;
  /** Hairline between the title bar and the content. */
  line: string;
  title: string;
  trafficLights: boolean;
  /** Browser styles draw the title inside an address field. */
  address?: { fill: string };
}

export const FRAME_CHROME: Record<FrameStyle, FrameChrome> = {
  'mac-dark': { titleBar: 36, bar: '#2A2A2E', line: '#1A1A1D', title: '#D4D4D8', trafficLights: true },
  'mac-light': { titleBar: 36, bar: '#ECECEE', line: '#D4D4D8', title: '#3F3F46', trafficLights: true },
  'browser-light': {
    titleBar: 44,
    bar: '#F1F1F4',
    line: '#DCDCE0',
    title: '#52525B',
    trafficLights: true,
    address: { fill: '#FFFFFF' },
  },
  none: { titleBar: 0, bar: '#000000', line: '#000000', title: '#000000', trafficLights: false },
};

/** Close, minimise, zoom. */
export const TRAFFIC_LIGHTS = ['#FF5F57', '#FEBC2E', '#28C840'] as const;

/** Traffic light radius, spacing and inset from the window's left edge, in units. */
export const TRAFFIC_LIGHT = { radius: 6, spacing: 20, inset: 20 } as const;

/** Address field size in units; its width is capped at half the window. */
export const ADDRESS_FIELD = { width: 560, height: 26, radius: 8 } as const;

/** Window shadow in units, and its opacity. */
export const WINDOW_SHADOW = { blur: 48, offset: 18, opacity: 0.5 } as const;
```

`packages/engine/src/presets/labels.ts` (the record is `TEXT_LABELS`, because `@cuttle/project` already exports the list `TEXT_STYLES`):

```ts
import type { TextStyle } from '@cuttle/project';

/** How a piece of text is drawn into a sprite. Sizes are in units (1 px at 1080p); colours are CSS colours. */
export interface LabelStyle {
  size: number;
  weight: 400 | 600;
  color: string;
  /** Box behind the text; without it only the text is drawn. */
  fill?: string;
  padX: number;
  padY: number;
  radius: number | 'pill';
  /** A bar along the box's left edge. */
  accent?: string;
  /** Shadow of the box, or of the text when there is no box. */
  shadow?: { blur: number; y: number; color: string };
  align: 'center' | 'left';
}

/** The three `texts[].style` presets. */
export const TEXT_LABELS: Record<TextStyle, LabelStyle> = {
  pill: {
    size: 28,
    weight: 600,
    color: '#18181B',
    fill: 'rgba(255, 255, 255, 0.94)',
    padX: 26,
    padY: 12,
    radius: 'pill',
    shadow: { blur: 18, y: 4, color: 'rgba(0, 0, 0, 0.28)' },
    align: 'center',
  },
  'lower-third': {
    size: 30,
    weight: 600,
    color: '#FFFFFF',
    fill: 'rgba(17, 17, 20, 0.88)',
    padX: 22,
    padY: 14,
    radius: 10,
    accent: '#D97757',
    shadow: { blur: 18, y: 4, color: 'rgba(0, 0, 0, 0.3)' },
    align: 'left',
  },
  caption: {
    size: 26,
    weight: 400,
    color: '#FFFFFF',
    fill: 'rgba(0, 0, 0, 0.72)',
    padX: 16,
    padY: 8,
    radius: 8,
    align: 'center',
  },
};

/** The speed badge ("12× speed"). */
export const BADGE_STYLE: LabelStyle = {
  size: 18,
  weight: 600,
  color: '#FFFFFF',
  fill: 'rgba(17, 17, 20, 0.78)',
  padX: 14,
  padY: 7,
  radius: 'pill',
  align: 'center',
};

/** Card scene title and subtitle. */
export const CARD_TITLE_STYLE: LabelStyle = {
  size: 72,
  weight: 600,
  color: '#FFFFFF',
  padX: 0,
  padY: 0,
  radius: 0,
  shadow: { blur: 24, y: 4, color: 'rgba(0, 0, 0, 0.35)' },
  align: 'center',
};

export const CARD_SUBTITLE_STYLE: LabelStyle = {
  size: 34,
  weight: 400,
  color: 'rgba(255, 255, 255, 0.8)',
  padX: 0,
  padY: 0,
  radius: 0,
  shadow: { blur: 16, y: 2, color: 'rgba(0, 0, 0, 0.3)' },
  align: 'center',
};

/** Window title; its colour comes from the frame style. */
export function windowTitleStyle(color: string): LabelStyle {
  return { size: 14, weight: 400, color, padX: 0, padY: 0, radius: 0, align: 'center' };
}
```

`packages/engine/src/presets/cursors.ts`. The art is drawn for Cuttle (lookalikes, not copies of OS cursor files). The hand is a union of rounded rects: the black group is stroked 2.8 wide, then the white group is filled on top, which leaves a 1.4-unit outline around the whole shape and no lines inside it.

```ts
import type { CursorShape, CursorStyle } from '@cuttle/project';

/** Cursor art is drawn on a 32×32 grid. */
export const CURSOR_GRID = 32;
/** Cursor images are rasterized at this size and mipmapped. */
export const CURSOR_TEXTURE_PX = 128;

export interface CursorArt {
  svg: string;
  /** The grid point that sits on the pointer position. */
  hotspot: [x: number, y: number];
}

/** `system:<shape>` images are Cuttle's own lookalikes of the standard pointers, not copies of OS files. */
export type CursorImage = `system:${CursorShape}` | 'arrow-white' | 'arrow-black';

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`;

const HAND =
  '<rect x="10" y="3" width="4" height="16" rx="2"/>' +
  '<rect x="14" y="10" width="3.6" height="10" rx="1.8"/>' +
  '<rect x="17.6" y="11" width="3.6" height="10" rx="1.8"/>' +
  '<rect x="21.2" y="12.5" width="3.4" height="9" rx="1.7"/>' +
  '<rect x="10" y="15" width="14.6" height="12.5" rx="4"/>' +
  '<rect x="5.6" y="14.6" width="4" height="9" rx="2" transform="rotate(-35 7.6 19.1)"/>';

const DESIGNED_ARROW = 'M6 3.5 L6 25 L11.3 20.2 L14.8 28 L18.6 26.4 L15.2 18.8 L22.6 18.8 Z';
const SOFT_SHADOW =
  '<defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%">' +
  '<feDropShadow dx="0" dy="1.2" stdDeviation="1.1" flood-color="#000000" flood-opacity="0.35"/></filter></defs>';

export const CURSOR_ART: Record<CursorImage, CursorArt> = {
  'system:arrow': {
    svg: svg(
      '<path d="M4 2 L4 24.5 L9.6 19.2 L13.3 27.6 L16.9 26 L13.2 17.8 L20.8 17.8 Z" fill="#FFFFFF" stroke="#000000" stroke-width="1.4" stroke-linejoin="round"/>',
    ),
    hotspot: [4, 2],
  },
  'system:text': {
    svg: svg(
      '<g fill="none" stroke-linecap="round">' +
        '<path d="M12.5 6 H19.5 M16 6 V26 M12.5 26 H19.5" stroke="#FFFFFF" stroke-width="4"/>' +
        '<path d="M12.5 6 H19.5 M16 6 V26 M12.5 26 H19.5" stroke="#000000" stroke-width="1.6"/></g>',
    ),
    hotspot: [16, 16],
  },
  'system:pointer': {
    svg: svg(
      `<g fill="#000000" stroke="#000000" stroke-width="2.8" stroke-linejoin="round">${HAND}</g><g fill="#FFFFFF">${HAND}</g>`,
    ),
    hotspot: [12, 3],
  },
  'system:wait': {
    svg: svg(
      '<circle cx="16" cy="16" r="9" fill="none" stroke="#000000" stroke-width="5.6"/>' +
        '<circle cx="16" cy="16" r="9" fill="none" stroke="#FFFFFF" stroke-width="3"/>' +
        '<path d="M16 7 A9 9 0 0 1 25 16" fill="none" stroke="#2B7DE9" stroke-width="3" stroke-linecap="round"/>',
    ),
    hotspot: [16, 16],
  },
  'system:crosshair': {
    svg: svg(
      '<path d="M16 4 V28 M4 16 H28" stroke="#FFFFFF" stroke-width="3.6"/>' +
        '<path d="M16 4.8 V27.2 M4.8 16 H27.2" stroke="#000000" stroke-width="1.4"/>',
    ),
    hotspot: [16, 16],
  },
  'system:move': {
    svg: svg(
      '<path d="M16 3 L20.5 8 H17.5 V14.5 H24 V11.5 L29 16 L24 20.5 V17.5 H17.5 V24 H20.5 L16 29 L11.5 24 H14.5 V17.5 H8 V20.5 L3 16 L8 11.5 V14.5 H14.5 V8 H11.5 Z" fill="#FFFFFF" stroke="#000000" stroke-width="1.4" stroke-linejoin="round"/>',
    ),
    hotspot: [16, 16],
  },
  'system:not-allowed': {
    svg: svg(
      '<circle cx="16" cy="16" r="9.5" fill="none" stroke="#FFFFFF" stroke-width="5.6"/>' +
        '<path d="M9.3 9.3 L22.7 22.7" stroke="#FFFFFF" stroke-width="5.6" stroke-linecap="round"/>' +
        '<circle cx="16" cy="16" r="9.5" fill="none" stroke="#D93025" stroke-width="3"/>' +
        '<path d="M9.3 9.3 L22.7 22.7" stroke="#D93025" stroke-width="3"/>',
    ),
    hotspot: [16, 16],
  },
  'arrow-white': {
    svg: svg(
      `${SOFT_SHADOW}<path d="${DESIGNED_ARROW}" fill="#FFFFFF" stroke="#18181B" stroke-width="1.6" stroke-linejoin="round" filter="url(#s)"/>`,
    ),
    hotspot: [6, 3.5],
  },
  'arrow-black': {
    svg: svg(
      `${SOFT_SHADOW}<path d="${DESIGNED_ARROW}" fill="#111113" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round" filter="url(#s)"/>`,
    ),
    hotspot: [6, 3.5],
  },
};

/**
 * The image a cursor style shows for a pointer shape. Only `system` follows the shape; the designed
 * arrows always show an arrow; `dot`, `ring` and `spotlight` are drawn by a shader (undefined here).
 */
export function cursorImageFor(style: CursorStyle, shape: CursorShape): CursorImage | undefined {
  if (style === 'system') return `system:${shape}`;
  if (style === 'arrow-white' || style === 'arrow-black') return style;
  return undefined;
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm exec vitest run packages/engine/test/presets.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/presets packages/engine/test/presets.test.ts
git commit -m "engine: presets for backgrounds, window frames, labels and cursors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Assets and text sprites

**Files:**
- Create: `packages/engine/src/env.d.ts`, `packages/engine/src/assets.ts`, `packages/engine/src/sprites.ts`
- Modify: `packages/engine/package.json` (dependency)
- Test: `packages/engine/test/assets.browser.test.ts`, `packages/engine/test/sprites.browser.test.ts`

- [ ] **Step 1: Add the font package**

Run: `pnpm --filter @cuttle/engine add @fontsource/inter@^5.3.0`
Expected: `packages/engine/package.json` lists `"@fontsource/inter": "^5.3.0"` under `dependencies`.

`@fontsource/inter` exports `./files/*`, so `@fontsource/inter/files/inter-latin-600-normal.woff2?url` resolves in Vite. The latin subset covers `×`, `·`, `…` and the German umlauts.

`packages/engine/src/env.d.ts`:

```ts
// Vite asset URL imports (the fonts). Vite resolves them in tests and bundles.
declare module '*?url' {
  const url: string;
  export default url;
}
```

- [ ] **Step 2: Write the failing tests**

`packages/engine/test/assets.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FONT_FAMILY, loadEngineAssets } from '../src/assets';
import { CURSOR_ART, CURSOR_TEXTURE_PX } from '../src/presets/cursors';

describe('loadEngineAssets', () => {
  it('loads Inter 400 and 600 into the document', async () => {
    await loadEngineAssets();
    expect(document.fonts.check(`400 20px "${FONT_FAMILY}"`)).toBe(true);
    expect(document.fonts.check(`600 20px "${FONT_FAMILY}"`)).toBe(true);
    const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
    ctx.font = `600 40px "${FONT_FAMILY}"`;
    const inter = ctx.measureText('Cuttle 0123').width;
    ctx.font = '600 40px serif';
    expect(inter).not.toBe(ctx.measureText('Cuttle 0123').width);
  });

  it('rasterizes every cursor image with visible pixels', async () => {
    const { cursors } = await loadEngineAssets();
    expect([...cursors.keys()].sort()).toEqual(Object.keys(CURSOR_ART).sort());
    for (const [image, bitmap] of cursors) {
      expect(bitmap.width, image).toBe(CURSOR_TEXTURE_PX);
      expect(bitmap.height, image).toBe(CURSOR_TEXTURE_PX);
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const alpha = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data.filter((_, i) => i % 4 === 3);
      expect(alpha.filter((a) => a > 200).length, image).toBeGreaterThan(200);
    }
  });
});
```

`packages/engine/test/sprites.browser.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets } from '../src/assets';
import { BADGE_STYLE, TEXT_LABELS } from '../src/presets/labels';
import { SpriteCache, cssFont, drawLabel, fitText } from '../src/sprites';

beforeAll(async () => {
  await loadEngineAssets();
});

describe('fitText', () => {
  it('keeps text that fits and shortens the rest with an ellipsis', () => {
    const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
    ctx.font = cssFont(400, 20);
    expect(fitText(ctx, 'short', 500)).toBe('short');
    const cut = fitText(ctx, 'a rather long window title that will not fit', 120);
    expect(cut.endsWith('…')).toBe(true);
    expect(ctx.measureText(cut).width).toBeLessThanOrEqual(120);
  });
});

describe('drawLabel', () => {
  it('sizes the box from the font and padding, plus a margin for the shadow', () => {
    const { canvas, margin } = drawLabel('One prompt', TEXT_LABELS.pill, 1, 1000);
    expect(margin).toBe(22); // blur 18 + offset 4
    expect(canvas.height - 2 * margin).toBe(Math.round(28 * 1.3) + 2 * 12);
    expect(canvas.width - 2 * margin).toBeGreaterThan(2 * 26);
  });

  it('never gets wider than maxWidth', () => {
    const { canvas, margin } = drawLabel('x'.repeat(200), BADGE_STYLE, 1, 300);
    expect(canvas.width - 2 * margin).toBeLessThanOrEqual(300);
  });
});

describe('SpriteCache', () => {
  function cache(maxIdleFrames: number) {
    const gl = new OffscreenCanvas(4, 4).getContext('webgl2')!;
    return new SpriteCache(gl, maxIdleFrames);
  }

  it('reuses the sprite for the same text and style', () => {
    const sprites = cache(10);
    const a = sprites.label('12× speed', BADGE_STYLE, 1, 400);
    expect(sprites.label('12× speed', BADGE_STYLE, 1, 400)).toBe(a);
    expect(sprites.label('8× speed', BADGE_STYLE, 1, 400)).not.toBe(a);
    expect(sprites.size).toBe(2);
  });

  it('drops sprites that were not used for maxIdleFrames frames', () => {
    const sprites = cache(1);
    sprites.label('old', BADGE_STYLE, 1, 400);
    sprites.endFrame();
    sprites.label('new', BADGE_STYLE, 1, 400);
    sprites.endFrame();
    expect(sprites.size).toBe(1);
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm exec vitest run packages/engine/test/assets.browser.test.ts packages/engine/test/sprites.browser.test.ts`
Expected: FAIL, `../src/assets` and `../src/sprites` cannot be resolved.

- [ ] **Step 4: Implement the asset loader**

`packages/engine/src/assets.ts`:

```ts
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import { CURSOR_ART, CURSOR_TEXTURE_PX, type CursorImage } from './presets/cursors';

/** The family every engine text is drawn with (Inter 400 and 600, bundled). */
export const FONT_FAMILY = 'Cuttle Inter';

/** Everything the renderer needs that has to load asynchronously. Load once, share between renderers. */
export interface EngineAssets {
  cursors: ReadonlyMap<CursorImage, ImageBitmap>;
}

let fonts: Promise<void> | undefined;

function loadFonts(): Promise<void> {
  fonts ??= (async () => {
    for (const [weight, url] of [
      ['400', inter400],
      ['600', inter600],
    ] as const) {
      const face = new FontFace(FONT_FAMILY, `url(${url})`, { weight });
      await face.load();
      document.fonts.add(face);
    }
  })().catch((error: unknown) => {
    fonts = undefined;
    throw error;
  });
  return fonts;
}

/**
 * Rasterizes an SVG at `px` × `px`, premultiplied and not flipped (see `uploadTexture`).
 * Goes through an <img>: Chromium cannot decode SVG blobs with createImageBitmap directly.
 */
async function rasterizeSvg(svg: string, px: number): Promise<ImageBitmap> {
  const sized = svg.replace('<svg ', `<svg width="${px}" height="${px}" `);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return await createImageBitmap(image, { premultiplyAlpha: 'premultiply' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Loads the fonts into the document and rasterizes the cursor art. Needs a window (not a worker). */
export async function loadEngineAssets(): Promise<EngineAssets> {
  await loadFonts();
  const images = Object.keys(CURSOR_ART) as CursorImage[];
  const bitmaps = await Promise.all(images.map((image) => rasterizeSvg(CURSOR_ART[image].svg, CURSOR_TEXTURE_PX)));
  return { cursors: new Map(images.map((image, i) => [image, bitmaps[i]!])) };
}
```

- [ ] **Step 5: Implement the sprites**

A sprite's canvas is the label's box plus a transparent margin for its shadow; `box` is what layout code positions, `SpritePass.drawSprite` (Task 6) adds the margin back.

`packages/engine/src/sprites.ts`:

```ts
import { FONT_FAMILY } from './assets';
import { createTexture, uploadTexture } from './gl/texture';
import type { Size } from './layout';
import type { LabelStyle } from './presets/labels';

/** A label drawn into a texture. `width`/`height` cover the whole canvas, shadow `margin` included; `box` is the visible box. */
export interface Sprite {
  texture: WebGLTexture;
  width: number;
  height: number;
  margin: number;
  box: Size;
}

export function cssFont(weight: 400 | 600, px: number): string {
  return `${weight} ${px}px "${FONT_FAMILY}"`;
}

/** Shortens `text` with "…" until it is at most `maxWidth` px wide in the context's current font. */
export function fitText(ctx: OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}

/** Draws one line of text in `style` at `unit` scale, at most `maxWidth` px wide (box included). */
export function drawLabel(text: string, style: LabelStyle, unit: number, maxWidth: number): { canvas: OffscreenCanvas; margin: number } {
  const fontPx = Math.max(1, Math.round(style.size * unit));
  const padX = Math.round(style.padX * unit);
  const padY = Math.round(style.padY * unit);
  const accent = style.accent ? Math.max(2, Math.round(6 * unit)) : 0;
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!;
  measure.font = cssFont(style.weight, fontPx);
  const shown = fitText(measure, text, Math.max(0, maxWidth - 2 * padX - accent));
  const boxWidth = Math.max(1, Math.ceil(measure.measureText(shown).width) + 2 * padX + accent);
  const boxHeight = Math.round(fontPx * 1.3) + 2 * padY;
  const margin = style.shadow ? Math.ceil((style.shadow.blur + Math.abs(style.shadow.y)) * unit) : 0;

  const canvas = new OffscreenCanvas(boxWidth + 2 * margin, boxHeight + 2 * margin);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(margin, margin);
  const shadowOn = () => {
    if (!style.shadow) return;
    ctx.shadowColor = style.shadow.color;
    ctx.shadowBlur = style.shadow.blur * unit;
    ctx.shadowOffsetY = style.shadow.y * unit;
  };
  if (style.fill) {
    const radius = style.radius === 'pill' ? boxHeight / 2 : style.radius * unit;
    shadowOn();
    ctx.fillStyle = style.fill;
    ctx.beginPath();
    ctx.roundRect(0, 0, boxWidth, boxHeight, radius);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (style.accent) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = style.accent;
      ctx.fillRect(0, 0, accent, boxHeight);
      ctx.restore();
    }
  } else {
    shadowOn();
  }
  ctx.font = cssFont(style.weight, fontPx);
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'middle';
  ctx.fillText(shown, accent + padX, boxHeight / 2);
  return { canvas, margin };
}

/** Label sprites by content; a sprite unused for `maxIdleFrames` rendered frames is deleted. */
export class SpriteCache {
  private readonly sprites = new Map<string, Sprite & { lastUsed: number }>();
  private frame = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly maxIdleFrames = 120,
  ) {}

  label(text: string, style: LabelStyle, unit: number, maxWidth: number): Sprite {
    const key = JSON.stringify([text, style, unit, maxWidth]);
    let sprite = this.sprites.get(key);
    if (!sprite) {
      const { canvas, margin } = drawLabel(text, style, unit, maxWidth);
      const texture = createTexture(this.gl, false);
      uploadTexture(this.gl, texture, canvas, false);
      sprite = {
        texture,
        width: canvas.width,
        height: canvas.height,
        margin,
        box: { width: canvas.width - 2 * margin, height: canvas.height - 2 * margin },
        lastUsed: this.frame,
      };
      this.sprites.set(key, sprite);
    }
    sprite.lastUsed = this.frame;
    return sprite;
  }

  /** Call once after each rendered frame. */
  endFrame(): void {
    for (const [key, sprite] of this.sprites) {
      if (this.frame - sprite.lastUsed >= this.maxIdleFrames) {
        this.gl.deleteTexture(sprite.texture);
        this.sprites.delete(key);
      }
    }
    this.frame++;
  }

  get size(): number {
    return this.sprites.size;
  }

  dispose(): void {
    for (const sprite of this.sprites.values()) this.gl.deleteTexture(sprite.texture);
    this.sprites.clear();
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run packages/engine/test/assets.browser.test.ts packages/engine/test/sprites.browser.test.ts`
Expected: PASS, 7 tests in 2 files.

- [ ] **Step 7: Commit**

```bash
git add pnpm-lock.yaml packages/engine/package.json packages/engine/src/env.d.ts packages/engine/src/assets.ts packages/engine/src/sprites.ts packages/engine/test/assets.browser.test.ts packages/engine/test/sprites.browser.test.ts
git commit -m "engine: Inter fonts, cursor bitmaps and cached text sprites

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Renderer core, backgrounds, cards and the golden suite

This task builds `createRenderer` with card scenes only (clip and still scenes follow in Tasks 7 and 12), the layer compositing for crossfades, and the golden scenario runner that every later task extends.

**Files:**
- Create: `packages/engine/src/passes/sprite.ts`, `packages/engine/src/passes/background.ts`, `packages/engine/src/renderer.ts`, `packages/engine/src/index.ts`
- Create: `packages/engine/test/fixtures.ts`, `packages/engine/test/scenarios.ts`, `packages/engine/test/run-scenario.ts`
- Test: `packages/engine/test/renderer.browser.test.ts`, `packages/engine/test/golden.browser.test.ts`

- [ ] **Step 1: Write the fake sources**

Everything is axis-aligned rectangles (and two arcs in the webcam), so it rasterizes the same in every Chromium. The screen is 1280×800 (16:10) on purpose: its aspect differs from the 16:9 output.

`packages/engine/test/fixtures.ts`:

```ts
import type { Size } from '../src/layout';

/** Size of the fake screen recording every scenario uses (16:10, like a laptop). */
export const SCREEN: Size = { width: 1280, height: 800 };

function canvas2d(width: number, height: number): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const canvas = new OffscreenCanvas(width, height);
  return [canvas, canvas.getContext('2d')!];
}

/** An editor-like screen made of axis-aligned rects only, so it rasterizes the same everywhere. */
export function fakeScreen(): OffscreenCanvas {
  const [canvas, g] = canvas2d(SCREEN.width, SCREEN.height);
  g.fillStyle = '#1E1E1E';
  g.fillRect(0, 0, 1280, 800);
  g.fillStyle = '#252526';
  g.fillRect(0, 0, 240, 800);
  g.fillStyle = '#333333';
  g.fillRect(0, 0, 1280, 36);
  g.fillStyle = '#007ACC';
  g.fillRect(0, 776, 1280, 24);
  const colors = ['#569CD6', '#CE9178', '#6A9955', '#DCDCAA', '#C586C0', '#9CDCFE'];
  for (let line = 0; line < 30; line++) {
    let x = 280 + (line % 4) * 32;
    for (let word = 0; word < 4; word++) {
      const width = 30 + ((line * 7 + word * 13) % 9) * 18;
      g.fillStyle = colors[(line + word) % colors.length]!;
      g.fillRect(x, 60 + line * 23, width, 12);
      x += width + 12;
    }
  }
  g.fillStyle = '#C5C5C5';
  for (let item = 0; item < 14; item++) g.fillRect(24, 60 + item * 26, 90 + ((item * 37) % 100), 10);
  g.fillStyle = '#F2F2F2';
  g.fillRect(900, 520, 340, 200);
  g.fillStyle = '#D97757';
  g.fillRect(930, 560, 120, 36);
  g.fillStyle = '#3F3F46';
  for (let row = 0; row < 4; row++) g.fillRect(930, 620 + row * 22, 260 - row * 40, 10);
  return canvas;
}

/** A 4:3 camera frame: backdrop, a head and shoulders, a marker in the top-left corner. */
export function fakeWebcam(): OffscreenCanvas {
  const [canvas, g] = canvas2d(640, 480);
  g.fillStyle = '#3B4A5A';
  g.fillRect(0, 0, 640, 480);
  g.fillStyle = '#FF3366';
  g.fillRect(0, 0, 160, 40);
  g.fillStyle = '#2F6F8F';
  g.beginPath();
  g.ellipse(320, 470, 190, 120, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#E0B48C';
  g.beginPath();
  g.arc(320, 230, 105, 0, Math.PI * 2);
  g.fill();
  return canvas;
}

/** A tall web page for still scenes: dark header, coloured hero, rows of cards, dark footer. */
export function fakePage(): OffscreenCanvas {
  const [canvas, g] = canvas2d(1280, 2400);
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, 1280, 2400);
  g.fillStyle = '#111827';
  g.fillRect(0, 0, 1280, 72);
  g.fillStyle = '#6366F1';
  g.fillRect(80, 120, 1120, 400);
  g.fillStyle = '#FFFFFF';
  g.fillRect(140, 240, 600, 48);
  g.fillRect(140, 310, 420, 24);
  const cards = ['#F3F4F6', '#E0E7FF', '#FCE7F3', '#DCFCE7'];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      g.fillStyle = cards[(row + col) % cards.length]!;
      g.fillRect(80 + col * 380, 600 + row * 420, 340, 360);
    }
  }
  g.fillStyle = '#111827';
  g.fillRect(0, 2280, 1280, 120);
  return canvas;
}

/** A 16:9 image for the `image` background preset. */
export function fakeBackground(): OffscreenCanvas {
  const [canvas, g] = canvas2d(960, 540);
  const quadrants = ['#264653', '#2A9D8F', '#E9C46A', '#E76F51'];
  quadrants.forEach((color, i) => {
    g.fillStyle = color;
    g.fillRect((i % 2) * 480, Math.floor(i / 2) * 270, 480, 270);
  });
  g.fillStyle = '#FFFFFF';
  for (let i = 0; i < 8; i++) g.fillRect(60 + i * 110, 60 + i * 52, 60, 30);
  return canvas;
}

export interface Fixtures {
  screen: OffscreenCanvas;
  webcam: OffscreenCanvas;
  page: ImageBitmap;
  background: ImageBitmap;
}

let cached: Promise<Fixtures> | undefined;

/** The fake sources, created once per page. */
export function fixtures(): Promise<Fixtures> {
  cached ??= (async () => ({
    screen: fakeScreen(),
    webcam: fakeWebcam(),
    page: await createImageBitmap(fakePage(), { premultiplyAlpha: 'premultiply' }),
    background: await createImageBitmap(fakeBackground(), { premultiplyAlpha: 'premultiply' }),
  }))();
  return cached;
}
```

- [ ] **Step 2: Write the failing renderer tests**

`packages/engine/test/renderer.browser.test.ts`:

```ts
import { BACKGROUND_PRESETS, parseProject, type CuttleProject, type CuttleProjectInput } from '@cuttle/project';
import type { RenderState, SceneFrame } from '@cuttle/timeline';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { createRenderer, type FrameSources } from '../src/renderer';
import { SCREEN, fixtures } from './fixtures';
import { pixelAt, readPixels } from './gl-util';

let assets: EngineAssets;

beforeAll(async () => {
  assets = await loadEngineAssets();
});

function parse(input: Partial<CuttleProjectInput>): CuttleProject {
  const result = parseProject({ version: 1, output: { width: 64, height: 36 }, sources: { screen: 's.mp4' }, ...input });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

const CARDS = parse({
  look: { background: { preset: 'solid', color: '#204060' } },
  scenes: [
    { type: 'card', title: 'A', duration: 1 },
    { type: 'card', title: 'B', duration: 1 },
  ],
});

const NO_SOURCES: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };

function layer(index: number, opacity: number, kind: SceneFrame['kind'] = 'card'): SceneFrame {
  return { index, kind, local: 0, progress: 0, opacity, masks: [], texts: [] };
}

function render(project: CuttleProject, state: RenderState, sources = NO_SOURCES) {
  const canvas = new OffscreenCanvas(1, 1);
  const renderer = createRenderer(canvas, project, { assets, screenSize: SCREEN });
  renderer.render(state, sources);
  const gl = canvas.getContext('webgl2')!;
  const pixels = readPixels(gl);
  renderer.dispose();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { canvas, pixels };
}

describe('createRenderer', () => {
  it('sizes the canvas to the project output', () => {
    const { canvas } = render(CARDS, { t: 0, layers: [] });
    expect([canvas.width, canvas.height]).toEqual([64, 36]);
  });

  it('draws black without layers', () => {
    expect(pixelAt(render(CARDS, { t: 0, layers: [] }).pixels, 5, 5)).toEqual([0, 0, 0, 255]);
  });

  it('draws the solid background colour exactly', () => {
    expect(pixelAt(render(CARDS, { t: 0, layers: [layer(0, 1)] }).pixels, 1, 1)).toEqual([32, 64, 96, 255]);
  });

  it('compiles every background preset', async () => {
    const { background } = await fixtures();
    for (const preset of BACKGROUND_PRESETS) {
      const project = parse({ look: { background: { preset, color: '#000000', image: 'bg.png' } } });
      createRenderer(new OffscreenCanvas(1, 1), project, { assets, screenSize: SCREEN, backgroundImage: background }).dispose();
    }
  });

  it('needs the background image for the image preset', () => {
    const project = parse({ look: { background: { preset: 'image', image: 'bg.png' } } });
    expect(() => createRenderer(new OffscreenCanvas(1, 1), project, { assets, screenSize: SCREEN })).toThrow(
      'createRenderer: look.background.preset is "image" but no backgroundImage was given',
    );
  });

  it('rejects an empty screen size', () => {
    expect(() => createRenderer(new OffscreenCanvas(1, 1), CARDS, { assets, screenSize: { width: 0, height: 10 } })).toThrow(
      'createRenderer: screenSize must have a positive, finite width and height',
    );
  });
});

describe('render', () => {
  it('crossfades: a top layer at opacity 0 changes nothing, at 1 it replaces the bottom one', () => {
    const a = render(CARDS, { t: 0, layers: [layer(0, 1)] }).pixels.data;
    const b = render(CARDS, { t: 0, layers: [layer(1, 1)] }).pixels.data;
    expect(a).not.toEqual(b);
    expect(render(CARDS, { t: 0, layers: [layer(0, 1), layer(1, 0)] }).pixels.data).toEqual(a);
    expect(render(CARDS, { t: 0, layers: [layer(0, 0), layer(1, 1)] }).pixels.data).toEqual(b);
  });

  it('throws after dispose', () => {
    const renderer = createRenderer(new OffscreenCanvas(1, 1), CARDS, { assets, screenSize: SCREEN });
    renderer.dispose();
    expect(() => renderer.render({ t: 0, layers: [] }, NO_SOURCES)).toThrow('render: the renderer was disposed');
  });
});
```

Run: `pnpm exec vitest run packages/engine/test/renderer.browser.test.ts`
Expected: FAIL, `../src/renderer` cannot be resolved.

- [ ] **Step 3: Write the sprite and background passes**

`packages/engine/src/passes/sprite.ts`:

```ts
import type { Rect } from '@cuttle/project';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import type { Size } from '../layout';
import type { Sprite } from '../sprites';

const FRAGMENT = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
uniform float u_opacity;
uniform float u_flipY;
void main() {
  vec2 uv = vec2(v_uv.x, mix(v_uv.y, 1.0 - v_uv.y, u_flipY));
  o_color = texture(u_tex, uv) * u_opacity;
}`;

/** Draws a premultiplied texture into a rect: sprites, cursor images and offscreen layers. */
export class SpritePass {
  private readonly shader: Shader;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
  ) {
    this.shader = new Shader(gl, 'sprite', RECT_VERTEX, FRAGMENT);
  }

  /** `flipY` for render-target textures, whose row 0 is the bottom of the image. */
  draw(texture: WebGLTexture, rect: Rect, opacity: number, flipY = false): void {
    this.shader.use().texture('u_tex', 0, texture).float('u_opacity', opacity).float('u_flipY', flipY ? 1 : 0);
    drawRect(this.gl, this.shader, rect, this.output);
  }

  /** Draws a label sprite with its box's top-left corner at (`x`, `y`). */
  drawSprite(sprite: Sprite, x: number, y: number, opacity: number): void {
    this.draw(sprite.texture, [x - sprite.margin, y - sprite.margin, sprite.width, sprite.height], opacity);
  }

  dispose(): void {
    this.shader.dispose();
  }
}
```

`packages/engine/src/passes/background.ts`:

```ts
import type { Look } from '@cuttle/project';
import { hexToRgb } from '../color';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { createTexture, uploadTexture } from '../gl/texture';
import type { Size } from '../layout';
import { BACKGROUNDS } from '../presets/backgrounds';

/** Fills the whole output with the background preset. */
export class BackgroundPass {
  private readonly shader: Shader;
  private readonly image?: { texture: WebGLTexture; size: Size };

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
    private readonly background: Look['background'],
    image: ImageBitmap | undefined,
  ) {
    this.shader = new Shader(gl, `background ${background.preset}`, RECT_VERTEX, FRAGMENT_PRELUDE + BACKGROUNDS[background.preset]);
    if (background.preset === 'image') {
      if (!image) throw new Error('createRenderer: look.background.preset is "image" but no backgroundImage was given');
      const texture = createTexture(gl, true);
      uploadTexture(gl, texture, image, true);
      this.image = { texture, size: { width: image.width, height: image.height } };
    }
  }

  draw(t: number): void {
    const shader = this.shader.use().float('u_time', t);
    if (this.background.color) shader.vec3('u_color', hexToRgb(this.background.color));
    if (this.image) shader.texture('u_image', 0, this.image.texture).vec2('u_imageSize', this.image.size.width, this.image.size.height);
    drawRect(this.gl, shader, [0, 0, this.output.width, this.output.height], this.output);
  }

  dispose(): void {
    this.shader.dispose();
    if (this.image) this.gl.deleteTexture(this.image.texture);
  }
}
```

- [ ] **Step 4: Write the renderer**

GL objects are created through `own()` (passes, the sprite cache) and `texture()`, so `dispose()` never needs editing when later tasks add passes. Clip and still layers throw until Tasks 7 and 12 add them.

`packages/engine/src/renderer.ts`:

```ts
import type { CardScene, CuttleProject } from '@cuttle/project';
import type { RenderState, SceneFrame } from '@cuttle/timeline';
import type { EngineAssets } from './assets';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture } from './gl/texture';
import { unitFor, type Size } from './layout';
import { BackgroundPass } from './passes/background';
import { SpritePass } from './passes/sprite';
import { CARD_SUBTITLE_STYLE, CARD_TITLE_STYLE } from './presets/labels';
import { SpriteCache } from './sprites';

/**
 * Per-frame images, keyed by `SceneFrame.index`: during a crossfade two clip layers with
 * unrelated source times are visible at once.
 */
export interface FrameSources {
  /** Scene index → decoded screen frame at that layer's `sourceTime`. */
  screens: Map<number, TexImageSource>;
  /** Scene index → webcam frame at that layer's `sourceTime`. */
  webcams: Map<number, TexImageSource>;
  /** Scene index → image of a still scene; created with `premultiplyAlpha: 'premultiply'`, not flipped. */
  stills: Map<number, ImageBitmap>;
}

export interface Renderer {
  /** Draws `state` into the canvas. Throws when a visible clip or still has no image in `sources`. */
  render(state: RenderState, sources: FrameSources): void;
  /** Frees every GL object; `render` throws afterwards. Leaves the canvas and its context alone. */
  dispose(): void;
}

export interface RendererOptions {
  /** From `loadEngineAssets()`. */
  assets: EngineAssets;
  /** Size of the screen track in source px, the same as for `createTimeline`. */
  screenSize: Size;
  /** Required when `look.background.preset` is `image`. */
  backgroundImage?: ImageBitmap;
}

/** Share of the output width that card titles may use. */
const CARD_MAX_WIDTH = 0.84;
/** Gap between a card's title and subtitle boxes, in units. */
const CARD_GAP = 12;

/**
 * A WebGL2 compositor for `cuttle.json` frames. Sizes the canvas to `project.output`. Layers are
 * drawn back to front: the first one opaque, each later one through an offscreen target blended
 * with its opacity, which turns the timeline's crossfade pair into A·(1−m) + B·m.
 */
export function createRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, project: CuttleProject, options: RendererOptions): Renderer {
  const output: Size = { width: project.output.width, height: project.output.height };
  const { screenSize } = options;
  if (!(Number.isFinite(screenSize.width) && screenSize.width > 0 && Number.isFinite(screenSize.height) && screenSize.height > 0)) {
    throw new Error('createRenderer: screenSize must have a positive, finite width and height');
  }
  canvas.width = output.width;
  canvas.height = output.height;
  // HTMLCanvasElement.getContext has the same signature for 'webgl2'.
  const context = (canvas as OffscreenCanvas).getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!context) throw new Error('createRenderer: WebGL2 is not available');
  const gl: WebGL2RenderingContext = context;
  const look = project.look;
  const unit = unitFor(output);

  // GL resources: everything created through own() and texture() is freed by dispose().
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(resource: T): T => {
    owned.push(resource);
    return resource;
  };
  const textures: WebGLTexture[] = [];
  const texture = (mipmaps: boolean): WebGLTexture => {
    const created = createTexture(gl, mipmaps);
    textures.push(created);
    return created;
  };
  const vao = gl.createVertexArray();
  const sprites = own(new SpriteCache(gl));
  const spritePass = own(new SpritePass(gl, output));
  const background = own(new BackgroundPass(gl, output, look.background, options.backgroundImage));
  let layerTarget: RenderTarget | undefined;
  let disposed = false;

  function drawCard(scene: CardScene): void {
    const maxWidth = output.width * CARD_MAX_WIDTH;
    const title = sprites.label(scene.title, CARD_TITLE_STYLE, unit, maxWidth);
    const subtitle = scene.subtitle ? sprites.label(scene.subtitle, CARD_SUBTITLE_STYLE, unit, maxWidth) : undefined;
    const gap = Math.round(CARD_GAP * unit);
    let y = Math.round((output.height - title.box.height - (subtitle ? gap + subtitle.box.height : 0)) / 2);
    spritePass.drawSprite(title, Math.round((output.width - title.box.width) / 2), y, 1);
    if (subtitle) {
      y += title.box.height + gap;
      spritePass.drawSprite(subtitle, Math.round((output.width - subtitle.box.width) / 2), y, 1);
    }
  }

  function drawLayer(layer: SceneFrame, sources: FrameSources, t: number): void {
    const scene = project.scenes[layer.index];
    if (!scene) throw new Error(`render: the project has no scene ${layer.index}`);
    background.draw(t);
    if (scene.type === 'card') drawCard(scene);
    else throw new Error(`render: ${scene.type} scenes are not supported yet`);
  }

  return {
    render(state, sources) {
      if (disposed) throw new Error('render: the renderer was disposed');
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
        if (layer.opacity <= 0) continue;
        layerTarget ??= createRenderTarget(gl, output);
        gl.bindFramebuffer(gl.FRAMEBUFFER, layerTarget.framebuffer);
        gl.clear(gl.COLOR_BUFFER_BIT);
        drawLayer(layer, sources, state.t);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        spritePass.draw(layerTarget.texture, [0, 0, output.width, output.height], layer.opacity, true);
      }
      sprites.endFrame();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const resource of owned) resource.dispose();
      for (const created of textures) gl.deleteTexture(created);
      if (layerTarget) deleteRenderTarget(gl, layerTarget);
      gl.deleteVertexArray(vao);
    },
  };
}
```

`packages/engine/src/index.ts`:

```ts
export { FONT_FAMILY, loadEngineAssets, type EngineAssets } from './assets';
export { createRenderer, type FrameSources, type Renderer, type RendererOptions } from './renderer';
export type { Size } from './layout';
```

- [ ] **Step 5: Run the renderer tests**

Run: `pnpm exec vitest run packages/engine/test/renderer.browser.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Write the scenario runner and the first scenarios**

`packages/engine/test/run-scenario.ts`:

```ts
import { parseProject } from '@cuttle/project';
import { createCursorTrack, createTimeline } from '@cuttle/timeline';
import type { EngineAssets } from '../src/assets';
import { createRenderer, type FrameSources } from '../src/renderer';
import { SCREEN, fixtures } from './fixtures';
import { readPixels, type Pixels } from './gl-util';
import type { Scenario } from './scenarios';

/** Renders one scenario through the real timeline and returns its pixels, top row first. */
export async function renderScenario(scenario: Scenario, assets: EngineAssets): Promise<Pixels> {
  const parsed = parseProject(scenario.project);
  if (!parsed.ok) throw new Error(`scenario ${scenario.name}: ${JSON.stringify(parsed.issues)}`);
  const project = parsed.project;
  const cursor = scenario.events ? createCursorTrack(scenario.events) : undefined;
  const state = createTimeline(project, { screenSize: SCREEN, cursor }).frameAt(scenario.t);

  const fake = await fixtures();
  const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };
  for (const layer of state.layers) {
    if (layer.kind === 'clip') {
      sources.screens.set(layer.index, fake.screen);
      if (scenario.webcam) sources.webcams.set(layer.index, fake.webcam);
    } else if (layer.kind === 'still') {
      sources.stills.set(layer.index, fake.page);
    }
  }

  const canvas = new OffscreenCanvas(1, 1);
  const renderer = createRenderer(canvas, project, {
    assets,
    screenSize: SCREEN,
    backgroundImage: project.look.background.preset === 'image' ? fake.background : undefined,
  });
  const gl = canvas.getContext('webgl2')!;
  try {
    renderer.render(state, sources);
    return readPixels(gl);
  } finally {
    renderer.dispose();
    // Browsers keep only ~16 live WebGL contexts; free this one now instead of waiting for GC.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
```

`packages/engine/test/scenarios.ts`:

```ts
import type { CuttleProjectInput, InputEvent } from '@cuttle/project';

/** One golden image: a project, the output time to render and the fake inputs to feed it. */
export interface Scenario {
  name: string;
  project: CuttleProjectInput;
  /** Output seconds. */
  t: number;
  /** Cursor track for the timeline. */
  events?: InputEvent[];
  /** Feed the fake webcam frame to clip layers (the project must enable `look.webcam`). */
  webcam?: boolean;
}

type Look = NonNullable<CuttleProjectInput['look']>;

/** 640×360 output, one 10 s clip of the fake screen; `look` and `rest` replace the defaults. */
function project(look: Look = {}, rest: Partial<CuttleProjectInput> = {}): CuttleProjectInput {
  return {
    version: 1,
    output: { width: 640, height: 360, fps: 30 },
    sources: { screen: 'screen.mp4' },
    look,
    scenes: [{ type: 'clip', from: 0, to: 10 }],
    ...rest,
  };
}

export const SCENARIOS: Scenario[] = [
  // Backgrounds, behind an end card
  ...(['sunset-sky', 'aurora', 'mesh'] as const).map((preset) => ({
    name: `background-${preset}`,
    project: project({ background: { preset } }, { scenes: [{ type: 'card', title: preset, duration: 3 }] }),
    t: 1,
  })),
  {
    name: 'background-solid',
    project: project({ background: { preset: 'solid', color: '#1E1E2E' } }, { scenes: [{ type: 'card', title: 'solid', duration: 3 }] }),
    t: 1,
  },
  {
    name: 'background-image',
    project: project({ background: { preset: 'image', image: 'bg.png' } }, { scenes: [{ type: 'card', title: 'image', duration: 3 }] }),
    t: 1,
  },
  {
    name: 'card',
    project: project({}, { scenes: [{ type: 'card', title: 'Claude Code + treg', subtitle: 'treg.to', duration: 3 }] }),
    t: 1,
  },

];
```

`packages/engine/test/golden.browser.test.ts`:

```ts
import { commands } from 'vitest/browser';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { toBase64 } from './gl-util';
import { renderScenario } from './run-scenario';
import { SCENARIOS } from './scenarios';

let assets: EngineAssets;

beforeAll(async () => {
  assets = await loadEngineAssets();
});

describe('golden images', () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const pixels = await renderScenario(scenario, assets);
      const result = await commands.matchGolden(scenario.name, toBase64(pixels.data), pixels.width, pixels.height);
      expect(result.status).toBe('match');
    });
  }
});
```

- [ ] **Step 7: Create the goldens and look at them**

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: 6 tests FAIL with `golden created, look at it and run the tests again`, and six PNGs (640×360) appear in `packages/engine/test/__golden__/golden.browser.test.ts/`.

Open each one and check:

- `background-sunset-sky.win32.png`: deep indigo at the top, fading through pink to warm orange at the bottom, a soft yellow glow at the bottom centre; "sunset-sky" in white, bold, centred, with a soft shadow.
- `background-aurora.win32.png`: near-black navy with three soft, gently waving horizontal bands (green, blue, violet) in the upper half; "aurora" centred.
- `background-mesh.win32.png`: a smooth blend of four regions: violet top-left, pink top-right, cyan bottom-left, peach bottom-right; no hard edges.
- `background-solid.win32.png`: flat rgb(30, 30, 46) everywhere except the title.
- `background-image.win32.png`: the fake image covering the frame: four quadrants (dark teal, teal, yellow, orange) with white bars on a diagonal; "image" centred.
- `card.win32.png`: the sunset sky with "Claude Code + treg" large and "treg.to" smaller just below, both centred.

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 8: Run everything**

Run: `pnpm test`
Expected: PASS, 140 tests in 17 files.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 9: Commit**

```bash
git add packages/engine
git commit -m "engine: renderer core with backgrounds, cards, crossfade compositing and golden scenarios

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Window frames and the screen

Clip scenes now draw: the window (shadow, title bar, traffic lights, address field, title) and the screen texture in the content rect, clipped to the window's rounded corners.

**Files:**
- Create: `packages/engine/src/passes/window.ts`, `packages/engine/src/passes/content.ts`
- Modify: `packages/engine/src/renderer.ts`, `packages/engine/test/renderer.browser.test.ts`, `packages/engine/test/scenarios.ts`

- [ ] **Step 1: Write the failing test**

In `packages/engine/test/renderer.browser.test.ts`, add this test as the first one inside `describe('render', …)`:

```ts
  it('names the scene whose screen frame is missing', () => {
    const project = parse({ scenes: [{ type: 'clip', from: 0, to: 1 }] });
    expect(() => render(project, { t: 0, layers: [layer(0, 1, 'clip')] })).toThrow('render: no screen frame for scene 0');
  });
```

Run: `pnpm exec vitest run packages/engine/test/renderer.browser.test.ts`
Expected: FAIL, the error is `render: clip scenes are not supported yet`.

- [ ] **Step 2: Write the window and content passes**

`packages/engine/src/passes/window.ts`:

```ts
import type { Rect } from '@cuttle/project';
import { hexToRgb } from '../color';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { unitFor, type Size, type WindowLayout } from '../layout';
import { ADDRESS_FIELD, TRAFFIC_LIGHT, TRAFFIC_LIGHTS, WINDOW_SHADOW, type FrameChrome } from '../presets/frames';
import { windowTitleStyle } from '../presets/labels';
import type { SpriteCache } from '../sprites';
import type { SpritePass } from './sprite';

const SHADOW = `${FRAGMENT_PRELUDE}
uniform vec4 u_window;
uniform float u_radius;
uniform float u_blur;
uniform float u_offset;
uniform float u_opacity;
void main() {
  float d = sdRoundRect(v_px - vec2(0.0, u_offset), u_window, u_radius);
  o_color = vec4(0.0, 0.0, 0.0, u_opacity * (1.0 - smoothstep(-u_blur * 0.5, u_blur, d)));
}`;

const CHROME = `${FRAGMENT_PRELUDE}
uniform vec4 u_window;
uniform float u_radius;
uniform float u_titleBar;
uniform float u_line;
uniform vec3 u_barColor;
uniform vec3 u_lineColor;
uniform vec3 u_lights;      // inset, spacing, radius in px; radius 0 draws none
uniform vec3 u_light0;
uniform vec3 u_light1;
uniform vec3 u_light2;
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
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
    private readonly sprites: SpriteCache,
    private readonly spritePass: SpritePass,
  ) {
    this.shadow = new Shader(gl, 'window shadow', RECT_VERTEX, SHADOW);
    this.chrome = new Shader(gl, 'window chrome', RECT_VERTEX, CHROME);
    this.unit = unitFor(output);
  }

  draw(layout: WindowLayout, chrome: FrameChrome, shadow: boolean, title: string): void {
    const u = this.unit;
    const [x, y, w, h] = layout.window;
    if (shadow) {
      const blur = WINDOW_SHADOW.blur * u;
      const offset = WINDOW_SHADOW.offset * u;
      this.shadow
        .use()
        .vec4('u_window', layout.window)
        .float('u_radius', layout.radius)
        .float('u_blur', blur)
        .float('u_offset', offset)
        .float('u_opacity', WINDOW_SHADOW.opacity);
      drawRect(this.gl, this.shadow, [x - blur, y - blur + offset, w + 2 * blur, h + 2 * blur], this.output);
    }
    if (layout.titleBar === 0) return;

    const address: Rect = chrome.address
      ? (() => {
          const width = Math.round(Math.min(ADDRESS_FIELD.width * u, w * 0.5));
          const height = Math.round(ADDRESS_FIELD.height * u);
          return [x + Math.round((w - width) / 2), y + Math.round((layout.titleBar - height) / 2), width, height];
        })()
      : [0, 0, 0, 0];
    this.chrome
      .use()
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius)
      .float('u_titleBar', layout.titleBar)
      .float('u_line', Math.max(1, Math.round(u)))
      .vec3('u_barColor', hexToRgb(chrome.bar))
      .vec3('u_lineColor', hexToRgb(chrome.line))
      .vec3('u_lights', chrome.trafficLights ? [TRAFFIC_LIGHT.inset * u, TRAFFIC_LIGHT.spacing * u, TRAFFIC_LIGHT.radius * u] : [0, 0, 0])
      .vec3('u_light0', hexToRgb(TRAFFIC_LIGHTS[0]))
      .vec3('u_light1', hexToRgb(TRAFFIC_LIGHTS[1]))
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

`packages/engine/src/passes/content.ts`:

```ts
import type { Rect } from '@cuttle/project';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import type { Size, WindowLayout } from '../layout';

const FRAGMENT = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
uniform vec4 u_crop;
uniform vec4 u_window;
uniform float u_radius;
void main() {
  // A small negative LOD bias keeps downscaled UI text crisp while trilinear filtering stops shimmer.
  vec3 color = texture(u_tex, u_crop.xy + v_uv * u_crop.zw, -0.5).rgb;
  float a = coverage(sdRoundRect(v_px, u_window, u_radius));
  o_color = vec4(color * a, a);
}`;

/** The screen (cropped to the zoom) or a still image, drawn into the content rect and clipped to the window's rounded corners. */
export class ContentPass {
  private readonly shader: Shader;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
  ) {
    this.shader = new Shader(gl, 'content', RECT_VERTEX, FRAGMENT);
  }

  /** `crop` is in texture coordinates (see `uvRect`); the texture needs mipmaps. */
  draw(texture: WebGLTexture, crop: Rect, layout: WindowLayout): void {
    this.shader
      .use()
      .texture('u_tex', 0, texture)
      .vec4('u_crop', crop)
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius);
    drawRect(this.gl, this.shader, layout.content, this.output);
  }

  dispose(): void {
    this.shader.dispose();
  }
}
```

- [ ] **Step 3: Draw clip scenes in the renderer**

In `packages/engine/src/renderer.ts`, replace the import block (everything above the `FrameSources` comment) with:

```ts
import type { CardScene, CuttleProject, FrameStyle, Rect } from '@cuttle/project';
import type { RenderState, SceneFrame } from '@cuttle/timeline';
import type { EngineAssets } from './assets';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, uploadTexture } from './gl/texture';
import { unitFor, uvRect, windowLayout, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
import { SpritePass } from './passes/sprite';
import { WindowPass } from './passes/window';
import { FRAME_CHROME, type FrameChrome } from './presets/frames';
import { CARD_SUBTITLE_STYLE, CARD_TITLE_STYLE } from './presets/labels';
import { SpriteCache } from './sprites';
```

Below `const unit = unitFor(output);` add:

```ts
  const full: Rect = [0, 0, screenSize.width, screenSize.height];
  const screenAspect = screenSize.width / screenSize.height;
```

Below the `const background = own(…)` line add:

```ts
  const windowPass = own(new WindowPass(gl, output, sprites, spritePass));
  const content = own(new ContentPass(gl, output));
  const screenTexture = texture(true);
```

Above `function drawCard` add:

```ts
  function frame(style: FrameStyle | null): { chrome: FrameChrome | null; layout: WindowLayout } {
    const chrome = style ? FRAME_CHROME[style] : null;
    return { chrome, layout: windowLayout(output, screenAspect, chrome ? { titleBar: chrome.titleBar, radius: look.frame.radius } : null) };
  }

  function drawClip(layer: SceneFrame, sources: FrameSources): void {
    const { chrome, layout } = frame(look.frame.enabled ? look.frame.style : null);
    if (chrome) windowPass.draw(layout, chrome, look.frame.shadow, look.frame.title);
    const screen = sources.screens.get(layer.index);
    if (!screen) throw new Error(`render: no screen frame for scene ${layer.index}`);
    uploadTexture(gl, screenTexture, screen, true);
    const zoom = layer.zoom ?? full;
    content.draw(screenTexture, uvRect(zoom, screenSize), layout);
  }
```

In `drawLayer`, add the clip branch, so its end reads:

```ts
    if (scene.type === 'card') drawCard(scene);
    else if (scene.type === 'clip') drawClip(layer, sources);
    else throw new Error(`render: ${scene.type} scenes are not supported yet`);
```

- [ ] **Step 4: Run the renderer tests**

Run: `pnpm exec vitest run packages/engine/test/renderer.browser.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the frame scenarios**

In `packages/engine/test/scenarios.ts`, add above `export const SCENARIOS`:

```ts
const SLATE = { preset: 'solid', color: '#3B4252' } as const;
const TITLE = 'claude · ~/treg-demo';
```

and at the end of the `SCENARIOS` array:

```ts
  // Window frames
  { name: 'frame-mac-dark', project: project({ background: SLATE, frame: { style: 'mac-dark', title: TITLE } }), t: 1 },
  { name: 'frame-mac-light', project: project({ background: SLATE, frame: { style: 'mac-light', title: TITLE } }), t: 1 },
  { name: 'frame-browser-light', project: project({ background: SLATE, frame: { style: 'browser-light', title: 'treg.to' } }), t: 1 },
  { name: 'frame-none', project: project({ background: SLATE, frame: { style: 'none' } }), t: 1 },
  { name: 'frame-disabled', project: project({ background: SLATE, frame: { enabled: false } }), t: 1 },
```

- [ ] **Step 6: Create the goldens and look at them**

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: the 5 new scenarios FAIL with `golden created`; the 6 older ones pass.

Check the new PNGs:

- `frame-mac-dark`: slate background (rgb 59, 66, 82); a centred window with rounded corners and a soft shadow below it; a dark grey title bar with red, yellow and green dots at the left and a tiny light title in the middle; below it the fake editor: dark area, sidebar with grey bars on the left, rows of coloured code bars, a light panel with an orange button at the bottom right, a blue status bar along the bottom.
- `frame-mac-light`: the same window with a light grey title bar and dark title text.
- `frame-browser-light`: a slightly taller light title bar with the three dots and a white rounded address field in the middle holding "treg.to".
- `frame-none`: no title bar: the screen alone, rounded corners, shadow.
- `frame-disabled`: no window, no shadow, square corners: the screen fills the full 360 px height, 576 px wide and centred, the slate background only in the two 32 px bars at the sides.

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/engine
git commit -m "engine: window frames and the screen in clip scenes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Masks and zoom

The zoom is already in `SceneFrame.zoom` (the timeline eases it); the content pass crops to it since Task 7. This task adds the masks, which follow the zoom.

**Files:**
- Create: `packages/engine/src/passes/masks.ts`
- Modify: `packages/engine/src/renderer.ts`, `packages/engine/test/scenarios.ts`

- [ ] **Step 1: Write the mask pass**

`fill` takes the per-channel median of eight samples 3 source px outside the mask, so a few pixels of text touching the edge do not tint it. `blur` samples the screen's mip chain (`generateMipmap` runs on every screen upload) at about 1/90 of the screen height per tap with a 5×5 Gaussian, which leaves no readable text. Both use `maskRectToOutput` from Task 2: without the extra pixel, trilinear filtering lets a hairline of a hidden text row show at the mask's edge.

`packages/engine/src/passes/masks.ts`:

```ts
import type { Mask, Rect } from '@cuttle/project';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect, withScissor } from '../gl/rect';
import { Shader } from '../gl/shader';
import { maskRectToOutput, uvRect, type Size, type WindowLayout } from '../layout';

const FILL = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
uniform vec4 u_mask;    // the mask rect in texture coordinates
uniform vec2 u_texel;   // one source pixel in texture coordinates
uniform vec4 u_window;
uniform float u_radius;

float median8(float v[8]) {
  for (int i = 0; i < 7; i++) {
    for (int j = 0; j < 7 - i; j++) {
      if (v[j] > v[j + 1]) {
        float t = v[j];
        v[j] = v[j + 1];
        v[j + 1] = t;
      }
    }
  }
  return 0.5 * (v[3] + v[4]);
}

void main() {
  // The colour around the mask: eight points 3 px outside its edges, median per channel,
  // so a few pixels of text touching the edge do not tint the fill.
  vec2 lo = u_mask.xy - 3.0 * u_texel;
  vec2 hi = u_mask.xy + u_mask.zw + 3.0 * u_texel;
  vec2 mid = 0.5 * (lo + hi);
  vec2 points[8] = vec2[8](lo, vec2(mid.x, lo.y), vec2(hi.x, lo.y), vec2(lo.x, mid.y),
                           vec2(hi.x, mid.y), vec2(lo.x, hi.y), vec2(mid.x, hi.y), hi);
  float r[8];
  float g[8];
  float b[8];
  for (int i = 0; i < 8; i++) {
    vec3 c = textureLod(u_tex, clamp(points[i], 0.5 * u_texel, 1.0 - 0.5 * u_texel), 0.0).rgb;
    r[i] = c.r;
    g[i] = c.g;
    b[i] = c.b;
  }
  float a = coverage(sdRoundRect(v_px, u_window, u_radius));
  o_color = vec4(vec3(median8(r), median8(g), median8(b)) * a, a);
}`;

const BLUR = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
uniform vec4 u_crop;     // the zoom crop in texture coordinates
uniform vec4 u_content;  // the content rect in output px
uniform vec2 u_texel;
uniform float u_lod;
uniform vec4 u_window;
uniform float u_radius;
void main() {
  vec2 uv = u_crop.xy + (v_px - u_content.xy) / u_content.zw * u_crop.zw;
  vec2 stride = u_texel * exp2(u_lod);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      float w = exp(-float(i * i + j * j) / 4.0);
      sum += textureLod(u_tex, uv + vec2(float(i), float(j)) * stride, u_lod).rgb * w;
      total += w;
    }
  }
  float a = coverage(sdRoundRect(v_px, u_window, u_radius));
  o_color = vec4(sum / total * a, a);
}`;

/** Blur strength: one mip level per doubling; a tap is about 1/90 of the screen height, at least 4 px. */
export function blurLod(screen: Size): number {
  return Math.max(2, Math.log2(screen.height / 90));
}

/** Masks over the screen: `fill` with the surrounding colour, `blur` with a heavy blur. Clipped to the content. */
export class MaskPass {
  private readonly fill: Shader;
  private readonly blur: Shader;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
  ) {
    this.fill = new Shader(gl, 'mask fill', RECT_VERTEX, FILL);
    this.blur = new Shader(gl, 'mask blur', RECT_VERTEX, BLUR);
  }

  /** `screen` must be the uploaded screen texture, with mipmaps. */
  draw(masks: readonly Mask[], screen: WebGLTexture, screenSize: Size, zoom: Rect, layout: WindowLayout): void {
    if (masks.length === 0) return;
    const texel: [number, number] = [1 / screenSize.width, 1 / screenSize.height];
    withScissor(this.gl, this.output, layout.content, () => {
      for (const mask of masks) {
        const rect = maskRectToOutput(mask.rect, zoom, layout.content);
        const shader = mask.style === 'fill' ? this.fill : this.blur;
        shader
          .use()
          .texture('u_tex', 0, screen)
          .vec2('u_texel', texel[0], texel[1])
          .vec4('u_window', layout.window)
          .float('u_radius', layout.radius);
        if (mask.style === 'fill') {
          shader.vec4('u_mask', uvRect(mask.rect, screenSize));
        } else {
          shader.vec4('u_crop', uvRect(zoom, screenSize)).vec4('u_content', layout.content).float('u_lod', blurLod(screenSize));
        }
        drawRect(this.gl, shader, rect, this.output);
      }
    });
  }

  dispose(): void {
    this.fill.dispose();
    this.blur.dispose();
  }
}
```

- [ ] **Step 2: Draw the masks**

In `packages/engine/src/renderer.ts`:

- add the import `import { MaskPass } from './passes/masks';` (after the `ContentPass` import);
- below `const screenTexture = texture(true);` add `const masks = own(new MaskPass(gl, output));`;
- replace `drawClip` with:

```ts
  function drawClip(layer: SceneFrame, sources: FrameSources): void {
    const { chrome, layout } = frame(look.frame.enabled ? look.frame.style : null);
    if (chrome) windowPass.draw(layout, chrome, look.frame.shadow, look.frame.title);
    const screen = sources.screens.get(layer.index);
    if (!screen) throw new Error(`render: no screen frame for scene ${layer.index}`);
    uploadTexture(gl, screenTexture, screen, true);
    const zoom = layer.zoom ?? full;
    content.draw(screenTexture, uvRect(zoom, screenSize), layout);
    masks.draw(layer.masks, screenTexture, screenSize, zoom, layout);
  }
```

- [ ] **Step 3: Add the scenarios**

At the end of the `SCENARIOS` array in `packages/engine/test/scenarios.ts`:

```ts
  // Masks and zoom
  {
    name: 'mask-fill',
    project: project({ frame: { title: TITLE } }, { masks: [{ from: 0, to: 10, rect: [270, 170, 700, 22], style: 'fill' }] }),
    t: 1,
  },
  {
    name: 'mask-blur',
    project: project({ frame: { title: TITLE } }, { masks: [{ from: 0, to: 10, rect: [900, 520, 340, 200], style: 'blur' }] }),
    t: 1,
  },
  {
    name: 'zoom',
    project: project(
      { frame: { title: TITLE } },
      {
        zooms: [{ at: 0, duration: 10, rect: [800, 450, 480, 300] }],
        masks: [{ from: 0, to: 10, rect: [930, 620, 260, 54], style: 'fill' }],
      },
    ),
    t: 5,
  },
```

- [ ] **Step 4: Create the goldens and look at them**

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: 3 new goldens created.

- `mask-fill`: the default sunset-sky look with the mac-dark window; the sixth row of code bars is gone, filled with the editor's background colour, so it reads as an empty line.
- `mask-blur`: the light panel with the orange button (bottom right of the screen) is a soft smudge; its bars cannot be told apart.
- `zoom`: zoomed about 2.7× onto the light panel: the orange button large near the top left of the content, the panel's first three grey text rows covered with the panel colour, the fourth row visible. Open the PNG enlarged (crop it or zoom in): there must be no thin grey line along the mask's top or right edge.

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "engine: fill and blur masks that follow the zoom

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Cursor, click ripple and spotlight

**Files:**
- Create: `packages/engine/src/passes/cursor.ts`
- Modify: `packages/engine/src/renderer.ts`, `packages/engine/test/scenarios.ts`

- [ ] **Step 1: Write the cursor pass**

Drawing order inside the content (scissored to it): the spotlight's dimming, the ripples, the pointer. Images (system shapes, the two designed arrows) are drawn as sprites with their hotspot on the pointer; `dot`, `ring` and the spotlight's centre dot come from a shape shader tinted with `look.cursor.color`. A pointer or click outside the captured area (outside `[0, width) × [0, height)` in source px) is not drawn.

`packages/engine/src/passes/cursor.ts`:

```ts
import type { Look, Rect } from '@cuttle/project';
import type { CursorFrame } from '@cuttle/timeline';
import { hexToRgb, type Rgb } from '../color';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect, withScissor } from '../gl/rect';
import { Shader } from '../gl/shader';
import { createTexture, uploadTexture } from '../gl/texture';
import { cursorSizePx, sourceToOutput, type Size, type WindowLayout } from '../layout';
import type { EngineAssets } from '../assets';
import { CURSOR_ART, CURSOR_GRID, cursorImageFor, type CursorImage } from '../presets/cursors';
import type { SpritePass } from './sprite';

const SPOTLIGHT = `${FRAGMENT_PRELUDE}
uniform vec2 u_center;
uniform float u_lightRadius;
uniform float u_soft;
uniform vec3 u_color;
uniform vec4 u_window;
uniform float u_radius;
void main() {
  float light = 1.0 - smoothstep(u_lightRadius - u_soft, u_lightRadius + u_soft, length(v_px - u_center));
  float clip = coverage(sdRoundRect(v_px, u_window, u_radius));
  // Premultiplied: darkens outside the light, adds a faint tint inside it.
  o_color = vec4(u_color * 0.12 * light, 0.45 * (1.0 - light)) * clip;
}`;

const RIPPLE = `${FRAGMENT_PRELUDE}
uniform vec2 u_center;
uniform float u_ringRadius;
uniform float u_width;
uniform vec3 u_color;
uniform float u_alpha;
void main() {
  float a = coverage(abs(length(v_px - u_center) - u_ringRadius) - u_width * 0.5) * u_alpha;
  o_color = vec4(u_color * a, a);
}`;

const SHAPE = `${FRAGMENT_PRELUDE}
uniform vec2 u_center;
uniform float u_shapeRadius;
uniform vec3 u_color;
uniform int u_kind;   // 0 dot, 1 ring
void main() {
  float d = length(v_px - u_center);
  float r = u_shapeRadius;
  if (u_kind == 0) {
    float shadow = 0.35 * (1.0 - smoothstep(r * 0.6, r * 1.6, length(v_px - u_center - vec2(0.0, r * 0.2))));
    float outer = coverage(d - r);
    vec3 color = mix(vec3(1.0), u_color, coverage(d - r * 0.75));
    vec4 body = vec4(color * outer, outer);
    o_color = body + vec4(0.0, 0.0, 0.0, shadow) * (1.0 - body.a);
  } else {
    float ring = coverage(abs(d - r) - r * 0.11);
    float fill = coverage(d - r) * 0.18;
    vec4 stroke = vec4(u_color * ring, ring);
    o_color = stroke + vec4(u_color * fill, fill) * (1.0 - stroke.a);
  }
}`;

/** Ripple growth and fade over its 0..1 progress, in cursor heights. */
export function rippleAt(progress: number): { radius: number; alpha: number } {
  const p = Math.min(1, Math.max(0, progress));
  return { radius: 0.25 + 0.85 * (1 - (1 - p) ** 3), alpha: 0.9 * (1 - p) ** 2 };
}

/** The pointer, its click ripples and the spotlight, clipped to the content. Hidden while off the captured area. */
export class CursorPass {
  private readonly spotlight: Shader;
  private readonly ripple: Shader;
  private readonly shape: Shader;
  private readonly images = new Map<CursorImage, WebGLTexture>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
    assets: EngineAssets,
    private readonly sprites: SpritePass,
  ) {
    this.spotlight = new Shader(gl, 'cursor spotlight', RECT_VERTEX, SPOTLIGHT);
    this.ripple = new Shader(gl, 'cursor ripple', RECT_VERTEX, RIPPLE);
    this.shape = new Shader(gl, 'cursor shape', RECT_VERTEX, SHAPE);
    for (const [image, bitmap] of assets.cursors) {
      const texture = createTexture(gl, true);
      uploadTexture(gl, texture, bitmap, true);
      this.images.set(image, texture);
    }
  }

  draw(cursor: CursorFrame, look: Look['cursor'], screen: Size, zoom: Rect, layout: WindowLayout): void {
    const onScreen = (x: number, y: number) => x >= 0 && y >= 0 && x < screen.width && y < screen.height;
    const size = cursorSizePx(screen, look.size, zoom, layout.content);
    const color = hexToRgb(look.color);
    const [x, y] = sourceToOutput(cursor.x, cursor.y, zoom, layout.content);
    withScissor(this.gl, this.output, layout.content, () => {
      if (look.style === 'spotlight' && onScreen(cursor.x, cursor.y)) this.drawSpotlight(x, y, size, color, layout);
      for (const click of cursor.clicks) {
        if (!onScreen(click.x, click.y)) continue;
        const [cx, cy] = sourceToOutput(click.x, click.y, zoom, layout.content);
        this.drawRipple(cx, cy, size, click.progress, color);
      }
      if (onScreen(cursor.x, cursor.y)) this.drawPointer(x, y, size, look.style, cursor, color);
    });
  }

  private drawSpotlight(x: number, y: number, size: number, color: Rgb, layout: WindowLayout): void {
    this.spotlight
      .use()
      .vec2('u_center', x, y)
      .float('u_lightRadius', 3.2 * size)
      .float('u_soft', size)
      .vec3('u_color', color)
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius);
    drawRect(this.gl, this.spotlight, layout.content, this.output);
  }

  private drawRipple(x: number, y: number, size: number, progress: number, color: Rgb): void {
    const { radius, alpha } = rippleAt(progress);
    const ringRadius = radius * size;
    const width = Math.max(1.5, 0.1 * size);
    const extent = ringRadius + width + 1;
    this.ripple
      .use()
      .vec2('u_center', x, y)
      .float('u_ringRadius', ringRadius)
      .float('u_width', width)
      .vec3('u_color', color)
      .float('u_alpha', alpha);
    drawRect(this.gl, this.ripple, [x - extent, y - extent, 2 * extent, 2 * extent], this.output);
  }

  private drawPointer(x: number, y: number, size: number, style: Look['cursor']['style'], cursor: CursorFrame, color: Rgb): void {
    const image = cursorImageFor(style, cursor.shape);
    if (image) {
      const [hx, hy] = CURSOR_ART[image].hotspot;
      const texture = this.images.get(image);
      if (!texture) throw new Error(`cursor image ${image} was not loaded`);
      this.sprites.draw(texture, [x - (hx / CURSOR_GRID) * size, y - (hy / CURSOR_GRID) * size, size, size], 1);
      return;
    }
    const kind = style === 'ring' ? 1 : 0;
    const radius = (style === 'ring' ? 0.45 : style === 'dot' ? 0.28 : 0.14) * size;
    const extent = radius * 1.8 + 1;
    this.shape.use().vec2('u_center', x, y).float('u_shapeRadius', radius).vec3('u_color', color).int('u_kind', kind);
    drawRect(this.gl, this.shape, [x - extent, y - extent, 2 * extent, 2 * extent], this.output);
  }

  dispose(): void {
    this.spotlight.dispose();
    this.ripple.dispose();
    this.shape.dispose();
    for (const texture of this.images.values()) this.gl.deleteTexture(texture);
  }
}
```

- [ ] **Step 2: Draw the cursor**

In `packages/engine/src/renderer.ts`:

- add the import `import { CursorPass } from './passes/cursor';` (after the `ContentPass` import);
- below `const masks = own(new MaskPass(gl, output));` add `const cursor = own(new CursorPass(gl, output, options.assets, spritePass));`;
- replace `drawClip` with:

```ts
  function drawClip(layer: SceneFrame, sources: FrameSources): void {
    const { chrome, layout } = frame(look.frame.enabled ? look.frame.style : null);
    if (chrome) windowPass.draw(layout, chrome, look.frame.shadow, look.frame.title);
    const screen = sources.screens.get(layer.index);
    if (!screen) throw new Error(`render: no screen frame for scene ${layer.index}`);
    uploadTexture(gl, screenTexture, screen, true);
    const zoom = layer.zoom ?? full;
    content.draw(screenTexture, uvRect(zoom, screenSize), layout);
    masks.draw(layer.masks, screenTexture, screenSize, zoom, layout);
    if (layer.cursor) cursor.draw(layer.cursor, look.cursor, screenSize, zoom, layout);
  }
```

- [ ] **Step 3: Add the scenarios**

In `packages/engine/test/scenarios.ts`, add below the `TITLE` constant:

```ts
/** Cursor resting at the screen centre, clicked 0.1 s before t = 5 (ripple at 25 %). */
const CLICK: InputEvent[] = [
  { t: 0, type: 'move', x: 640, y: 400 },
  { t: 4.9, type: 'click', x: 640, y: 400, button: 'left' },
];
/** Zoom on the cursor so its art is big enough to judge. */
const CURSOR_ZOOM = [{ at: 0, duration: 10, rect: [520, 325, 240, 150] as [number, number, number, number] }];

function cursorScenario(style: 'system' | 'arrow-white' | 'arrow-black' | 'dot' | 'ring' | 'spotlight'): Scenario {
  return {
    name: `cursor-${style}`,
    project: project({ background: SLATE, frame: { title: TITLE }, cursor: { style } }, { zooms: CURSOR_ZOOM }),
    t: 5,
    events: CLICK,
  };
}

function shapeScenario(shape: 'text' | 'pointer' | 'wait' | 'crosshair' | 'move' | 'not-allowed'): Scenario {
  return {
    name: `cursor-system-${shape}`,
    project: project({ background: SLATE, frame: { title: TITLE } }, { zooms: CURSOR_ZOOM }),
    t: 5,
    events: [
      { t: 0, type: 'move', x: 640, y: 400 },
      { t: 0, type: 'shape', shape },
    ],
  };
}
```

and at the end of the `SCENARIOS` array:

```ts
  // Cursors: six styles with a click ripple, then the system shapes
  ...(['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const).map(cursorScenario),
  ...(['text', 'pointer', 'wait', 'crosshair', 'move', 'not-allowed'] as const).map(shapeScenario),
```

- [ ] **Step 4: Create the goldens and look at them**

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: 12 new goldens created. All of them show the mac-dark window on slate, zoomed about 5.3× on the screen centre (large coloured code bars), with the pointer exactly in the middle of the content.

- `cursor-system`: a white arrow with a black outline, its tip in the middle, and a thin orange ring around the tip (a quarter grown, fairly transparent).
- `cursor-arrow-white`: a rounder white arrow with a dark outline and a soft drop shadow, plus the ring.
- `cursor-arrow-black`: the same arrow in black with a white outline, plus the ring.
- `cursor-dot`: an orange dot with a white rim and a soft shadow, plus the ring.
- `cursor-ring`: an orange circle outline with a faint orange fill, plus the ring.
- `cursor-spotlight`: the whole screen darker except a soft bright circle around the middle; a small orange dot and the ring at its centre.
- `cursor-system-text`: an I-beam. `cursor-system-pointer`: a white hand with the index finger up, the fingertip in the middle. `cursor-system-wait`: a white ring with a blue quarter arc. `cursor-system-crosshair`: a thin black cross with a white outline. `cursor-system-move`: a white four-way arrow. `cursor-system-not-allowed`: a red circle with a slash. No ripple in these six.

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: PASS, 26 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "engine: six cursor styles, system pointer shapes, click ripple and spotlight

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Webcam bubble

**Files:**
- Create: `packages/engine/src/passes/webcam.ts`
- Modify: `packages/engine/src/renderer.ts`, `packages/engine/test/scenarios.ts`

- [ ] **Step 1: Write the webcam pass**

`packages/engine/src/passes/webcam.ts`:

```ts
import type { Look, Rect } from '@cuttle/project';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { unitFor, webcamRect, type Size } from '../layout';

const FRAGMENT = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
uniform vec4 u_box;
uniform float u_radius;
uniform vec4 u_crop;
uniform float u_border;
uniform float u_shadow;
void main() {
  float d = sdRoundRect(v_px, u_box, u_radius);
  vec3 camera = texture(u_tex, u_crop.xy + (v_px - u_box.xy) / u_box.zw * u_crop.zw).rgb;
  float outer = coverage(d);
  vec3 color = mix(vec3(1.0), camera, coverage(d + u_border));
  vec4 body = vec4(color * outer, outer);
  float shadow = 0.4 * (1.0 - smoothstep(-u_shadow * 0.5, u_shadow, sdRoundRect(v_px - vec2(0.0, u_shadow * 0.35), u_box, u_radius)));
  o_color = body + vec4(0.0, 0.0, 0.0, shadow) * (1.0 - body.a);
}`;

/** Border width and shadow size of the bubble, in units; corner radius of the `rounded` shape as a share of its size. */
export const WEBCAM_BUBBLE = { border: 4, shadow: 24, roundedRadius: 0.22 } as const;

/** The centred square of a camera frame, in texture coordinates. */
export function webcamCrop(camera: Size): Rect {
  if (camera.width >= camera.height) {
    const w = camera.height / camera.width;
    return [(1 - w) / 2, 0, w, 1];
  }
  const h = camera.width / camera.height;
  return [0, (1 - h) / 2, 1, h];
}

/** The webcam bubble in an output corner: centre-cropped, white border, soft shadow. Not affected by zoom. */
export class WebcamPass {
  private readonly shader: Shader;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
  ) {
    this.shader = new Shader(gl, 'webcam', RECT_VERTEX, FRAGMENT);
  }

  draw(texture: WebGLTexture, camera: Size, look: Look['webcam']): void {
    const u = unitFor(this.output);
    const box = webcamRect(this.output, look.corner, look.size);
    const radius = look.shape === 'circle' ? box[2] / 2 : box[2] * WEBCAM_BUBBLE.roundedRadius;
    const shadow = WEBCAM_BUBBLE.shadow * u;
    this.shader
      .use()
      .texture('u_tex', 0, texture)
      .vec4('u_box', box)
      .float('u_radius', radius)
      .vec4('u_crop', webcamCrop(camera))
      .float('u_border', WEBCAM_BUBBLE.border * u)
      .float('u_shadow', shadow);
    const pad = shadow * 1.5;
    drawRect(this.gl, this.shader, [box[0] - pad, box[1] - pad, box[2] + 2 * pad, box[3] + 2 * pad], this.output);
  }

  dispose(): void {
    this.shader.dispose();
  }
}
```

- [ ] **Step 2: Draw the bubble**

In `packages/engine/src/renderer.ts`:

- change the texture import to `import { createTexture, sourceSize, uploadTexture } from './gl/texture';`;
- add the import `import { WebcamPass } from './passes/webcam';` (after the `SpritePass` import);
- below the `const cursor = own(…)` line add:

```ts
  const webcam = own(new WebcamPass(gl, output));
  const webcamTexture = texture(true);
```

- replace `drawClip` with:

```ts
  function drawClip(layer: SceneFrame, sources: FrameSources): void {
    const { chrome, layout } = frame(look.frame.enabled ? look.frame.style : null);
    if (chrome) windowPass.draw(layout, chrome, look.frame.shadow, look.frame.title);
    const screen = sources.screens.get(layer.index);
    if (!screen) throw new Error(`render: no screen frame for scene ${layer.index}`);
    uploadTexture(gl, screenTexture, screen, true);
    const zoom = layer.zoom ?? full;
    content.draw(screenTexture, uvRect(zoom, screenSize), layout);
    masks.draw(layer.masks, screenTexture, screenSize, zoom, layout);
    if (layer.cursor) cursor.draw(layer.cursor, look.cursor, screenSize, zoom, layout);
    const camera = look.webcam.enabled ? sources.webcams.get(layer.index) : undefined;
    if (camera) {
      uploadTexture(gl, webcamTexture, camera, true);
      webcam.draw(webcamTexture, sourceSize(camera), look.webcam);
    }
  }
```

- [ ] **Step 3: Add the scenarios**

At the end of the `SCENARIOS` array:

```ts
  // Webcam bubble
  {
    name: 'webcam-circle',
    project: project({ frame: { title: TITLE }, webcam: { enabled: true, shape: 'circle', corner: 'bottom-left', size: 0.25 } }),
    t: 1,
    webcam: true,
  },
  {
    name: 'webcam-rounded',
    project: project({ frame: { title: TITLE }, webcam: { enabled: true, shape: 'rounded', corner: 'top-right', size: 0.25 } }),
    t: 1,
    webcam: true,
  },
```

- [ ] **Step 4: Create the goldens and look at them**

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: 2 new goldens created.

- `webcam-circle`: a round bubble, 90 px across, in the bottom-left corner of the output (13 px from the edges), over the window; white rim, soft shadow; inside it a skin-coloured head and blue shoulders on a blue-grey backdrop.
- `webcam-rounded`: the same camera in a rounded square in the top-right corner; the pink marker shows in the bubble's top-left corner, which proves the image is neither mirrored nor upside down.

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: PASS, 28 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "engine: webcam bubble (circle or rounded, any corner)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Text overlays and the speed badge

**Files:**
- Modify: `packages/engine/src/renderer.ts`, `packages/engine/test/scenarios.ts`

- [ ] **Step 1: Draw texts and the badge**

In `packages/engine/src/renderer.ts`, replace the import block with:

```ts
import type { CardScene, CuttleProject, FrameStyle, Rect } from '@cuttle/project';
import type { ActiveText, RenderState, SceneFrame } from '@cuttle/timeline';
import type { EngineAssets } from './assets';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, sourceSize, uploadTexture } from './gl/texture';
import { placeBadge, placeOverlay, unitFor, uvRect, windowLayout, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
import { CursorPass } from './passes/cursor';
import { MaskPass } from './passes/masks';
import { SpritePass } from './passes/sprite';
import { WebcamPass } from './passes/webcam';
import { WindowPass } from './passes/window';
import { FRAME_CHROME, type FrameChrome } from './presets/frames';
import { BADGE_STYLE, CARD_SUBTITLE_STYLE, CARD_TITLE_STYLE, TEXT_LABELS } from './presets/labels';
import { SpriteCache } from './sprites';
```

Below `const CARD_GAP = 12;` add:

```ts
/** Share of the output width that text overlays may use. */
const TEXT_MAX_WIDTH = 0.8;
/** Share of the content width that the speed badge may use. */
const BADGE_MAX_WIDTH = 0.5;
```

Above `function drawClip` add:

```ts
  function drawTexts(texts: readonly ActiveText[]): void {
    for (const { overlay, opacity } of texts) {
      if (opacity <= 0) continue;
      const style = TEXT_LABELS[overlay.style];
      const sprite = sprites.label(overlay.text, style, unit, output.width * TEXT_MAX_WIDTH);
      const [x, y] = placeOverlay(output, sprite.box, overlay.position, style.align);
      spritePass.drawSprite(sprite, x, y, opacity);
    }
  }
```

and replace `drawClip` with:

```ts
  function drawClip(layer: SceneFrame, sources: FrameSources): void {
    const { chrome, layout } = frame(look.frame.enabled ? look.frame.style : null);
    if (chrome) windowPass.draw(layout, chrome, look.frame.shadow, look.frame.title);
    const screen = sources.screens.get(layer.index);
    if (!screen) throw new Error(`render: no screen frame for scene ${layer.index}`);
    uploadTexture(gl, screenTexture, screen, true);
    const zoom = layer.zoom ?? full;
    content.draw(screenTexture, uvRect(zoom, screenSize), layout);
    masks.draw(layer.masks, screenTexture, screenSize, zoom, layout);
    if (layer.cursor) cursor.draw(layer.cursor, look.cursor, screenSize, zoom, layout);
    const camera = look.webcam.enabled ? sources.webcams.get(layer.index) : undefined;
    if (camera) {
      uploadTexture(gl, webcamTexture, camera, true);
      webcam.draw(webcamTexture, sourceSize(camera), look.webcam);
    }
    drawTexts(layer.texts);
    if (layer.badge) {
      const sprite = sprites.label(layer.badge, BADGE_STYLE, unit, layout.content[2] * BADGE_MAX_WIDTH);
      const [x, y] = placeBadge(layout.content, sprite.box, unit);
      spritePass.drawSprite(sprite, x, y, 1);
    }
  }
```

- [ ] **Step 2: Add the scenarios**

Below `shapeScenario` in `packages/engine/test/scenarios.ts` add:

```ts
function textScenario(style: 'pill' | 'lower-third' | 'caption', position: 'top' | 'bottom'): Scenario {
  return {
    name: `text-${style}`,
    project: project({ frame: { title: TITLE } }, { texts: [{ at: 0, duration: 10, text: 'One prompt, one call', style, position }] }),
    t: 5,
  };
}
```

and at the end of the `SCENARIOS` array:

```ts
  // Texts and the speed badge
  textScenario('pill', 'top'),
  textScenario('lower-third', 'bottom'),
  textScenario('caption', 'bottom'),
  { name: 'badge', project: project({ frame: { title: TITLE } }, { scenes: [{ type: 'clip', from: 0, to: 120, speed: 12 }] }), t: 5 },
```

- [ ] **Step 3: Create the goldens and look at them**

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: 4 new goldens created, all on the sunset sky with the mac-dark window.

- `text-pill`: a white pill with dark bold "One prompt, one call", centred near the top, over the window's top edge, with a soft shadow.
- `text-lower-third`: a dark rounded panel with an orange bar along its left edge and white bold text, at the bottom left.
- `text-caption`: a translucent black box with white regular text, centred at the bottom.
- `badge`: a small dark pill "12× speed" inside the top-right corner of the screen area, just below the title bar.

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: PASS, 32 tests.

- [ ] **Step 4: Commit**

```bash
git add packages/engine
git commit -m "engine: text overlays (pill, lower third, caption) and the speed badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Still scenes

**Files:**
- Modify: `packages/engine/src/renderer.ts`, `packages/engine/test/renderer.browser.test.ts`, `packages/engine/test/scenarios.ts`

- [ ] **Step 1: Write the failing test**

In `packages/engine/test/renderer.browser.test.ts`, add below the `names the scene whose screen frame is missing` test:

```ts
  it('names the still scene whose image is missing', () => {
    const project = parse({ scenes: [{ type: 'still', image: 'p.png', duration: 1 }] });
    expect(() => render(project, { t: 0, layers: [layer(0, 1, 'still')] })).toThrow('render: no image for still scene 0');
  });
```

Run: `pnpm exec vitest run packages/engine/test/renderer.browser.test.ts`
Expected: FAIL, the error is `render: still scenes are not supported yet`.

- [ ] **Step 2: Draw still scenes**

In `packages/engine/src/renderer.ts`:

- change the first import to `import type { CardScene, CuttleProject, FrameStyle, Rect, StillScene } from '@cuttle/project';`;
- add `stillCrop` to the `./layout` import: `import { placeBadge, placeOverlay, stillCrop, unitFor, uvRect, windowLayout, type Size, type WindowLayout } from './layout';`;
- below `const webcamTexture = texture(true);` add:

```ts
  const stillTexture = texture(true);
  let uploadedStill: ImageBitmap | undefined;
```

- above `function drawCard` add:

```ts
  function drawStill(layer: SceneFrame, scene: StillScene, sources: FrameSources): void {
    const { chrome, layout } = frame(scene.frame);
    if (chrome) windowPass.draw(layout, chrome, look.frame.shadow, '');
    const image = sources.stills.get(layer.index);
    if (!image) throw new Error(`render: no image for still scene ${layer.index}`);
    if (image !== uploadedStill) {
      uploadTexture(gl, stillTexture, image, true);
      uploadedStill = image;
    }
    const size = { width: image.width, height: image.height };
    const crop = stillCrop(size, { width: layout.content[2], height: layout.content[3] }, scene.motion, layer.progress);
    content.draw(stillTexture, uvRect(crop, size), layout);
  }
```

- in `drawLayer`, replace the `else throw …` line with `else drawStill(layer, scene, sources);`, so the end of `drawLayer` reads:

```ts
    if (scene.type === 'card') drawCard(scene);
    else if (scene.type === 'clip') drawClip(layer, sources);
    else drawStill(layer, scene, sources);
```

The still texture is only uploaded when the bitmap changes; ImageBitmaps are immutable, so identity is enough.

Run: `pnpm exec vitest run packages/engine/test/renderer.browser.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 3: Add the scenarios**

At the end of the `SCENARIOS` array:

```ts
  // Still scenes
  {
    name: 'still-browser',
    project: project({}, { scenes: [{ type: 'still', image: 'page.png', duration: 4, frame: 'browser-light' }] }),
    t: 1,
  },
  {
    name: 'still-scroll',
    project: project({}, { scenes: [{ type: 'still', image: 'page.png', duration: 4, motion: 'scroll', frame: 'mac-light' }] }),
    t: 2,
  },
  {
    name: 'still-kenburns',
    project: project({}, { scenes: [{ type: 'still', image: 'page.png', duration: 4, motion: 'kenburns' }] }),
    t: 3,
  },
```

- [ ] **Step 4: Create the goldens and look at them**

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: 3 new goldens created.

- `still-browser`: a browser window (light title bar, empty white address field) showing the top of the fake page: dark header strip, the big indigo hero with two white bars, the first row of pastel cards cut off at the bottom.
- `still-scroll`: a mac-light window halfway down the page: rows of pastel cards (grey, lavender, pink, mint), no header or hero.
- `still-kenburns`: no title bar, rounded corners and shadow; the top of the page slightly zoomed in (the hero is a little larger than in `still-browser`).

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: PASS, 35 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "engine: still scenes with browser and window frames, scroll and Ken Burns motion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Crossfade and output formats

No new code: these goldens lock the crossfade compositing from Task 6 with real layers and the unit scaling for 1:1 and 9:16.

**Files:**
- Modify: `packages/engine/test/scenarios.ts`

- [ ] **Step 1: Add the scenarios**

At the end of the `SCENARIOS` array:

```ts
  // Crossfade from a clip to a card, halfway
  {
    name: 'crossfade',
    project: project(
      { frame: { title: TITLE } },
      { scenes: [{ type: 'clip', from: 0, to: 2 }, { type: 'card', title: 'The end', duration: 2 }] },
    ),
    t: 2,
  },

  // Other output formats: everything scales with the short side
  ...(
    [
      ['format-square', 360, 360],
      ['format-vertical', 360, 640],
    ] as const
  ).map(([name, width, height]) => ({
    name,
    project: project(
      { frame: { title: TITLE }, webcam: { enabled: true } },
      { output: { width, height, fps: 30 }, texts: [{ at: 0, duration: 10, text: 'One prompt, one call' }] },
    ),
    t: 5,
    webcam: true,
  })),
```

At t = 2 the default 0.3 s transition is exactly halfway (`mix` 0.5).

- [ ] **Step 2: Create the goldens and look at them**

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: 3 new goldens created.

- `crossfade`: the framed editor at half strength mixed with the end card: "The end" readable through the window, the sky the same in both layers.
- `format-square` (360×360): the window fills the width minus the padding, centred; the pill text at the top; the webcam bubble (circle, bottom left, 65 px) over the window's corner.
- `format-vertical` (360×640): a small window in the middle of a tall sunset; the pill at the top, the bubble at the bottom left; the title bar, padding, pill and bubble have the same pixel sizes as in `format-square` (both have a 360 px short side).

Run: `pnpm exec vitest run packages/engine/test/golden.browser.test.ts`
Expected: PASS, 38 tests.

- [ ] **Step 3: Run everything twice**

Run: `pnpm test`, then `pnpm test` again
Expected: PASS both times, 174 tests in 17 files. The second run proves the renders are deterministic.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 4: Commit**

```bash
git add packages/engine
git commit -m "engine: goldens for the crossfade and the 1:1 and 9:16 formats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The same goldens in a hidden Electron window

The roadmap's done criterion is "goldens pass in headless Electron". vite bundles the scenario runner into one classic script (library mode inlines the fonts as `data:` URLs, so nothing is fetched from `file://`); Electron loads it in a hidden window with SwiftShader and compares every scenario with the committed PNGs. M3 will reuse this setup for the export window.

**Files:**
- Create: `packages/engine/electron/page.ts`, `packages/engine/electron/index.html`, `packages/engine/electron/vite.config.ts`, `packages/engine/electron/main.mjs`
- Modify: `package.json`, `tsconfig.node.json`, `packages/engine/tsconfig.json`

- [ ] **Step 1: Install vite and Electron**

Run: `pnpm why vite`
Expected: vitest's vite is 8.3.4. Use exactly that version, so the workspace has one vite:

```bash
pnpm add -D -w vite@8.3.4 "electron@^44.7.2"
```

Electron 44 has no install script; its binary (about 370 MB) downloads on the first `electron` run. pnpm needs no build approval for it.

- [ ] **Step 2: Write the page and the bundle config**

`packages/engine/electron/page.ts`:

```ts
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { toBase64 } from '../test/gl-util';
import { renderScenario } from '../test/run-scenario';
import { SCENARIOS } from '../test/scenarios';

export interface CheckResult {
  name: string;
  width: number;
  height: number;
  /** RGBA8, top row first, base64. */
  rgba: string;
}

declare global {
  interface Window {
    cuttleCheck: { names: string[]; render(index: number): Promise<CheckResult> };
  }
}

let assets: Promise<EngineAssets> | undefined;

window.cuttleCheck = {
  names: SCENARIOS.map((scenario) => scenario.name),
  async render(index) {
    assets ??= loadEngineAssets();
    const scenario = SCENARIOS[index];
    if (!scenario) throw new Error(`no scenario ${index}`);
    const pixels = await renderScenario(scenario, await assets);
    return { name: scenario.name, width: pixels.width, height: pixels.height, rgba: toBase64(pixels.data) };
  },
};
```

`packages/engine/electron/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Cuttle engine check</title>
  </head>
  <body>
    <script src="./dist/page.js"></script>
  </body>
</html>
```

`packages/engine/electron/vite.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Bundles page.ts into one classic script. Library mode inlines the fonts as data: URLs,
// so the page works from file:// without fetching anything.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('./page.ts', import.meta.url)),
      formats: ['iife'],
      name: 'CuttleEngineCheck',
      fileName: () => 'page.js',
    },
  },
});
```

The bundle goes to `packages/engine/electron/dist/`, which the existing `dist/` line in `.gitignore` already ignores.

- [ ] **Step 3: Write the Electron main script**

WebCodecs (needed in M3) requires a secure context, which `loadFile` gives and a `data:` URL does not. Electron 35 and later pass one event object to `console-message`.

`packages/engine/electron/main.mjs`:

```js
// Renders every golden scenario in a hidden Electron window and compares it with the committed
// goldens. SwiftShader makes Electron rasterize like headless Chromium in the vitest browser tests.
// Run from the repo root: pnpm engine:electron
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app } from 'electron';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const here = dirname(fileURLToPath(import.meta.url));
const goldens = join(here, '..', 'test', '__golden__', 'golden.browser.test.ts');
const diffs = join(here, '..', '..', '..', '.vitest', 'electron-diff');
// Electron ships an older Chromium than Playwright: allow tiny text rasterization differences.
const THRESHOLD = 0.1;
const ALLOWED_RATIO = 0.002;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

function writePng(path, width, height, data) {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width, height });
  png.data = Buffer.from(data);
  writeFileSync(path, PNG.sync.write(png));
}

async function check() {
  const win = new BrowserWindow({ show: false, width: 800, height: 600 });
  win.webContents.on('console-message', (event) => console.log(`[page] ${event.message}`));
  await win.loadFile(join(here, 'index.html'));
  const names = await win.webContents.executeJavaScript('window.cuttleCheck.names');
  let failed = 0;
  for (let i = 0; i < names.length; i++) {
    const result = await win.webContents.executeJavaScript(`window.cuttleCheck.render(${i})`);
    const file = join(goldens, `${result.name}.${process.platform}.png`);
    if (!existsSync(file)) {
      console.log(`FAIL ${result.name}: no golden at ${file}`);
      failed++;
      continue;
    }
    const golden = PNG.sync.read(readFileSync(file));
    if (golden.width !== result.width || golden.height !== result.height) {
      console.log(`FAIL ${result.name}: golden is ${golden.width}x${golden.height}, render is ${result.width}x${result.height}`);
      failed++;
      continue;
    }
    const actual = Buffer.from(result.rgba, 'base64');
    const diff = new Uint8Array(actual.length);
    const mismatched = pixelmatch(golden.data, actual, diff, result.width, result.height, { threshold: THRESHOLD });
    const ok = mismatched <= ALLOWED_RATIO * result.width * result.height;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${result.name} (${mismatched} px differ)`);
    if (!ok) {
      failed++;
      writePng(join(diffs, `${result.name}.actual.png`), result.width, result.height, actual);
      writePng(join(diffs, `${result.name}.diff.png`), result.width, result.height, diff);
    }
  }
  console.log(failed === 0 ? `all ${names.length} scenarios match the goldens` : `${failed} of ${names.length} scenarios differ, see ${diffs}`);
  return failed === 0;
}

app.whenReady().then(async () => {
  let ok = false;
  try {
    ok = await check();
  } catch (error) {
    console.error(error);
  }
  app.exit(ok ? 0 : 1);
});
```

- [ ] **Step 4: Wire the script and the typecheck**

In `package.json`, add the script:

```json
"engine:electron": "vite build --config packages/engine/electron/vite.config.ts && electron packages/engine/electron/main.mjs"
```

In `tsconfig.node.json`, set `"include": ["vitest.config.ts", "tools", "packages/engine/electron/vite.config.ts"]`.

In `packages/engine/tsconfig.json`, set `"include": ["src", "test", "electron/page.ts"]`.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 5: Run the check**

Run: `pnpm engine:electron`
Expected: on the first run `Downloading Electron binary...`; then Electron's "Insecure Content-Security-Policy" warning from the page (harmless: the page loads nothing from outside); then one `ok   <name> (0 px differ)` line per scenario and finally `all 38 scenarios match the goldens`; exit code 0. Electron must not show a window.

Run: `grep -c "data:font/woff2;base64" packages/engine/electron/dist/page.js`
Expected: `2` (both Inter weights are inlined).

If a scenario differs, the actual and diff images are in `.vitest/electron-diff/`. A difference only in text edges means Electron's Chromium rasterizes text differently from Playwright's; anything else is a bug.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.node.json packages/engine/tsconfig.json packages/engine/electron
git commit -m "engine: render the golden scenarios in a hidden Electron window and compare them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Documentation

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`, `docs/superpowers/specs/2026-10-16-cuttle-design.md`

- [ ] **Step 1: README**

In `README.md`, add a row to the packages table:

```markdown
| `@cuttle/engine` | WebGL2 compositor: backgrounds, window frames, zoom, masks, cursors, webcam, texts, stills, cards, crossfades |
```

and replace the `## Development` section with:

````markdown
## Development

```bash
pnpm install
pnpm exec playwright install chromium   # once: headless Chromium for the engine tests
pnpm test                                # unit tests (Node) and engine golden images (Chromium)
pnpm typecheck
pnpm engine:electron                     # the engine goldens in a hidden Electron window
```

Engine golden images live in `packages/engine/test/__golden__/`, one PNG per platform. A new
scenario writes its PNG on the first run and fails once so you can look at it.
`pnpm exec vitest run -u` rewrites goldens after an intended change of look.
````

- [ ] **Step 2: Roadmap**

In `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`:

In the milestone table, replace `write before starting` in the M2 row with `` `2026-10-16-cuttle-m2-engine.md` ``.

Replace the `// @cuttle/engine (M2)` block in "Interfaces the later milestones introduce" with:

```ts
// @cuttle/engine (M2)
// Keyed by SceneFrame.index: during a crossfade two clip layers with unrelated source times are
// visible at once, so every per-layer image is looked up by scene index.
export interface FrameSources {
  screens: Map<number, TexImageSource>;    // scene index → decoded frame at that layer's sourceTime
  webcams: Map<number, TexImageSource>;    // scene index → webcam frame at that layer's sourceTime
  stills: Map<number, ImageBitmap>;        // scene index → image for still scenes (premultiplied, not flipped)
}
export interface Renderer { render(state: RenderState, sources: FrameSources): void; dispose(): void }
export interface EngineAssets { cursors: ReadonlyMap<CursorImage, ImageBitmap> }
export function loadEngineAssets(): Promise<EngineAssets>;  // Inter fonts + cursor art; needs a window, load once
export interface RendererOptions {
  assets: EngineAssets;
  screenSize: { width: number; height: number };            // same as for createTimeline
  backgroundImage?: ImageBitmap;                            // required for look.background.preset 'image'
}
export function createRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, project: CuttleProject, options: RendererOptions): Renderer;
```

In "Things each later plan must verify first", replace the `**M2:**` bullet with:

```markdown
- **M2:** done; see "Decisions made while planning" in `2026-10-16-cuttle-m2-engine.md`.
```

and add to the end of the `**M3:**` bullet:

```markdown
  Already verified in the M2 spike (Electron 44.7.2, Chromium 152, Windows): `VideoEncoder` reports
  `avc1.640028` 1080p30 as supported (hardware and software); a 30-frame H.264 encode and decode of
  a WebGL canvas through `new VideoFrame(canvas)` works at 640×360 and 1920×1080, under SwiftShader
  too. WebCodecs needs a secure context: load the export page with `loadFile` (as
  `packages/engine/electron/main.mjs` does), never a `data:` URL, where `VideoEncoder` is undefined.
  A hidden window (`show: false`) keeps rendering at full rate; `offscreen: true` and
  `backgroundThrottling: false` changed nothing.
```

- [ ] **Step 3: Spec**

In `docs/superpowers/specs/2026-10-16-cuttle-design.md`, below the paragraph that ends "Presets are data plus a shader, so new ones are added without touching the engine core.", add:

```markdown
Look rules (fixed in M2):

- Chrome sizes are in units: 1 unit is 1 px when the output's short side is 1080 px, so every
  format scales the same way.
- `look.frame.enabled: false` shows the screen alone, filling the output (letterboxed) with square
  corners and no shadow. `style: "none"` keeps the padding, the rounded corners and the shadow,
  without a title bar. Still scenes use their own `frame` style with `look.frame.radius` and
  `shadow`, and no title.
- Only `system` follows the pointer shape; the designed cursors keep their look. The cursor is
  32 source px tall on a 1080-row screen (proportionally bigger on taller screens), times
  `size`, scaled with the zoom like the screen, and hidden while off the captured area.
- `fill` masks use the median colour around the mask; `blur` masks blur so strongly that text
  cannot be read. Both cover one extra output pixel on every side.
- Texts: `position` picks top, centre or bottom of the output; `lower-third` is left-aligned, the
  other styles centred. The speed badge sits in the screen's top-right corner. The webcam
  bubble is not mirrored.
- Procedural backgrounds drift slowly with output time.
```

and in "Testing", replace the `engine` bullet with:

```markdown
- `engine`: golden-image tests: known states rendered in headless Chromium (vitest browser mode,
  SwiftShader) and compared with committed PNGs, one set per platform; `pnpm engine:electron`
  renders the same states in a hidden Electron window and compares them with the same PNGs.
```

- [ ] **Step 4: Run everything**

Run: `pnpm test`
Expected: PASS, 174 tests in 17 files.

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm engine:electron`
Expected: `all 38 scenarios match the goldens`.

- [ ] **Step 5: Commit**

```bash
git add README.md docs
git commit -m "docs: engine in the README, M2 interfaces and spike results in the roadmap, look rules in the spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (M2 scope)

| Spec or roadmap item | Task |
|---|---|
| Background presets `sunset-sky`, `aurora`, `mesh`, `solid`, `image`, slow drift | 4, 6 |
| Window frame: title bar, title, traffic lights, rounded corners, soft shadow (SDF); styles `mac-dark`, `mac-light`, `browser-light`, `none`; `enabled: false` | 4, 7 |
| Screen video cropped by the zoom rect | 7, 8 |
| Masks `fill` (sampled background colour) and `blur`, following the zoom | 8 |
| Cursor in six styles, `system` with seven shapes, scaled with the zoom, click ripple, `color`, `size` | 4, 9 |
| Webcam bubble: circle or rounded, four corners, border, shadow | 10 |
| Text styles `pill`, `lower-third`, `caption`; the speed badge | 4, 11 |
| Still scenes with `frame`, `motion` `none`, `scroll`, `kenburns` | 12 |
| Card scenes | 6 |
| Crossfade between scenes | 6, 13 |
| Output formats 16:9, 1:1, 9:16 (frame and content scale to fit) | 2, 13 |
| Presets are data plus a shader, added without touching the engine core | 4 |
| Golden-image test for each preset, frame, mask and text style, the badge and all six cursor styles with ripple | 6–13 |
| Goldens pass in headless Electron | 14 |
| Redistributable cursor art (own SVG lookalikes, not OS files) | 4 |
| Per-package tsconfigs instead of DOM in the root config | 1 |

## Open points for later milestones

- **macOS goldens.** Run `pnpm test` once on a Mac: it writes `*.darwin.png`, which need the same
  review, then commit them. The spec's GitHub Actions CI is not part of M2; a Linux runner would
  need its own `*.linux.png` set.
- **macOS cursor lookalikes** for `system` are phase 3; until then a macOS take shows the
  Windows-like art.
- **Still scenes have no title**, so a `browser-light` still shows an empty address field. Showing
  the page URL needs a `title` field on still scenes (schema change, M5 at the earliest).
- **Upload cost.** Every frame re-uploads the screen with `texImage2D` and rebuilds its mip chain.
  M3 measures this against the "1080p30 export in at most 2× the duration" target; `texSubImage2D`
  into a fixed-size texture is the first optimization if needed.
- **Fonts.** Inter's latin subset is bundled; other scripts and emoji fall back to system fonts,
  which may differ between machines.

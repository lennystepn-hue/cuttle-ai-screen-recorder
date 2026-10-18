# Cuttle P5-M2b: Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** More backgrounds behind the window, each the same in the editor and the export:
- a gradient builder: 2 to 4 colours, mixed in Oklab, an angle as in CSS, linear or radial;
- quiet animated ones: `flow` (soft folds of colour drifting past), `bokeh` (out-of-focus lights rising slowly) and `dots` (a fine grid of dots under two slow glows); `mesh` takes colours too;
- colours taken from the product: the clearest colours of the take's screen, of the brand's logo or of an image;
- the desktop's wallpaper behind the window, softened and darkened (any image can be).

**Architecture:**
- **`@cuttle/project`:** the presets `gradient`, `flow`, `bokeh` and `dots`; the background's `colors`, `angle`, `kind`, `blur` and `dim`; `backgrounds.ts` with each preset's own palette, the fields each reads and `switchBackground` (another preset, keeping what it reads); the pages' tone of a background's colours.
- **`@cuttle/engine`:** a shader per new preset, a shared palette (Oklab mixing), the image's blur (a disc of taps on mipmap levels) and dim; `BackgroundPass` sets the palette's uniforms.
- **`@cuttle/core`:** `palette.ts` (the clearest colours of pixels, a take, an image or an SVG), `wallpaper.ts` with a module per platform (where Windows and macOS keep the wallpaper; `CUTTLE_WALLPAPER` names one), `keepInProject` (a file put into the project, never over another; brand kits use it too).
- **The CLI:** `cuttle background [preset]` with `--colors`, `--from take|logo|<image>`, `--angle`, `--radial`/`--linear`, `--color`, `--image`, `--wallpaper`, `--blur` and `--dim`.
- **The app:** the requests `background:palette` and `background:wallpaper`; the Look tab's Background part with the nine swatches, the colours as wells (+ and ×), Take colours from the take or the logo, the angle and shape, Soft and Darker for an image, and Use its wallpaper.

**Tech Stack:** TypeScript strict, zod 4, WebGL2 (GLSL ES 3.00), React 19, Electron 44.7.2, ffmpeg, commander.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-roadmap-p4-p6.md` (P5-M2: "more backgrounds (a gradient builder, a blurred wallpaper, quiet animated ones, colours taken from the product)"). Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m2a-theme-brand-kits.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m2b`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window, never capture this machine and never read its wallpaper (`CUTTLE_WALLPAPER` names the check's own).
- The full `pnpm test` and the typecheck run in Task 6.

## Decisions made while planning

A prototype of the milestone, checked against the roadmap, settled these points. The finished prototype passed `pnpm test` (895 tests, 72 skipped, in two full runs), the typecheck, `app:check` (52 tests) and `cli:check` (14). Every screenshot was looked at.

- **Four presets more, fields on the background.** `gradient` needs its `colors` (2 to 4); `mesh`, `flow`, `bokeh` and `dots` take `colors` too, else their own. All new fields are optional, so a project made before draws as it did: mesh's own colours are its old ones (its golden image passes unchanged).
- **Mixed in Oklab.** A gradient's middle stays as light as its ends (red to blue passes a clear violet, not the dark purple of sRGB), as CSS's `in oklab`; the swatch uses the same. The angle is CSS's: 0 to the top, 90 to the right, 135 by default, the corners on the first and last colour.
- **Quiet means:** the animated ones move slowly (half a second changes the picture by less than 4 levels on average), stay dark enough for a window on them (a mean under 110), and draw from the time alone, the same in every render. Flow's noise turns each octave against the last, so no grid shows through.
- **An image softened and darkened:** `blur` 0 to 1 (up to 16 % of the output's short side, a disc of taps on the mipmap's levels, so the editor and the export draw it alike) and `dim` 0 to 0.8. A sharp image draws as it did, without dither.
- **Colours of the product** are the clearest colours of the picture (each weighs by how much of it there is and how strong it is, so a grey interface's accents win), far apart, dark to light; read off eight frames spread over the take, a logo's pixels, or the colours an SVG names. Only when asked (a click, `--from`), never on their own.
- **The wallpaper** is found where each system keeps it, in a module each: Windows' registry (read only), else the copy Windows keeps; macOS's desktop picture through AppleScript. It is copied into `images/` (never over another file) and softened by 0.6 unless the image was softened already. The checks name their own (`CUTTLE_WALLPAPER`); the app refuses to read the computer's in a check.
- **No new golden images.** Goldens are kept per platform, and macOS cannot make its own from here; a browser test checks what each background must do instead (the gradient's ends and middle, every stop, radial, the palettes, quiet and the same every time, the blur's edges, the dim).
- **One switch for the CLI and the app:** `switchBackground` keeps what the new preset reads (a gradient's colours become the flow's); a new gradient starts with its preset's colours, a solid one dark grey.
- **Brand kits** keep the background as a whole, its colours and softness with it, as before.
- **The editor's actions are a module of their own** (`background.ts`), as the brand kits' are: the Inspector's import line of the actions is one the open `zoom-fixes` branch changes too.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/{schema,backgrounds,theme}.ts` | the presets and fields, the palettes and the switch, the pages' tone |
| `packages/engine/src/presets/backgrounds.ts`, `packages/engine/src/passes/background.ts` | the shaders, the uniforms |
| `packages/core/src/{palette,wallpaper,wallpaper-win32,wallpaper-darwin,keep-file}.ts` | the product's colours, the wallpaper, a file put into the project |
| `apps/cli/src/commands/background.ts`, `apps/cli/src/main.ts` | `cuttle background` |
| `apps/desktop/src/shared/{ipc,channels,names}.ts`, `apps/desktop/src/main/{background,brands,windows}.ts` | the requests, the names |
| `apps/desktop/src/renderer/editor/{background.ts,Inspector.tsx,editor.css}` | the Look tab's Background part |
| `apps/desktop/test/app.check.test.ts`, `skill/cuttle/*.md`, `skill/test/skill.test.ts` | the check, the guides |

---

### Task 1: The backgrounds in the project

**Files:**
- Create: `packages/project/src/backgrounds.ts`, `packages/project/test/backgrounds.test.ts`
- Modify: `packages/project/src/schema.ts`, `packages/project/src/theme.ts`, `packages/project/src/index.ts`, `packages/project/test/schema.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m2b`; work there:

```bash
git switch p5-m2b
```

- [ ] **Step 2: Write the failing tests**

In `packages/project/test/schema.test.ts`, replace:

```ts
    expect(pathsOf({ ...minimal, theme: { colour: '#000000' } })).toEqual(['theme']);
  });
});
```

with:

```ts
    expect(pathsOf({ ...minimal, theme: { colour: '#000000' } })).toEqual(['theme']);
  });
});

describe('backgrounds', () => {
  it('read a gradient, the quiet ones in colours of their own, and a softened, darker image', () => {
    const gradient = { preset: 'gradient', colors: ['#0B132B', '#3A506B', '#5BC0BE'], angle: 90, kind: 'radial' };
    expect(ProjectSchema.parse({ ...minimal, look: { background: gradient } }).look.background).toEqual(gradient);
    for (const preset of ['flow', 'bokeh', 'dots', 'mesh']) expect(pathsOf({ ...minimal, look: { background: { preset, colors: ['#000000', '#FFFFFF'] } } })).toEqual([]);
    expect(pathsOf({ ...minimal, look: { background: { preset: 'flow' } } })).toEqual([]);
    expect(pathsOf({ ...minimal, look: { background: { preset: 'image', image: 'images/wallpaper.jpg', blur: 0.6, dim: 0.3 } } })).toEqual([]);
  });

  it('refuse a gradient without colours, too few or too many, an angle past 360, an unknown shape, and too much blur or dark', () => {
    const issues = (background: Record<string, unknown>) => pathsOf({ ...minimal, look: { background } });
    expect(issues({ preset: 'gradient' })).toEqual(['look.background.colors']);
    expect(issues({ preset: 'gradient', colors: ['#000000'] })).toEqual(['look.background.colors']);
    expect(issues({ preset: 'flow', colors: ['#000000', '#111111', '#222222', '#333333', '#444444'] })).toEqual(['look.background.colors']);
    expect(issues({ preset: 'gradient', colors: ['#000000', 'red'] })).toEqual(['look.background.colors.1']);
    expect(issues({ preset: 'gradient', colors: ['#000000', '#FFFFFF'], angle: 400 })).toEqual(['look.background.angle']);
    expect(issues({ preset: 'gradient', colors: ['#000000', '#FFFFFF'], kind: 'conic' })).toEqual(['look.background.kind']);
    expect(issues({ preset: 'image', image: 'a.png', blur: 1.5 })).toEqual(['look.background.blur']);
    expect(issues({ preset: 'image', image: 'a.png', dim: 0.9 })).toEqual(['look.background.dim']);
  });
});
```

`packages/project/test/backgrounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BACKGROUND_PALETTES, backgroundColors, backgroundTone, darkTone, isColouredBackground, switchBackground } from '../src/index';

describe('background colours', () => {
  it('are a background\'s own, else its preset\'s, and none for the others', () => {
    expect(backgroundColors({ preset: 'flow', colors: ['#000000', '#FFFFFF'] })).toEqual(['#000000', '#FFFFFF']);
    expect(backgroundColors({ preset: 'bokeh' })).toEqual(BACKGROUND_PALETTES.bokeh);
    expect(backgroundColors({ preset: 'aurora' })).toEqual([]);
    expect(['gradient', 'mesh', 'flow', 'bokeh', 'dots'].every((preset) => isColouredBackground(preset as never))).toBe(true);
    expect(isColouredBackground('image')).toBe(false);
  });

  it('give pages a dark tone of them', () => {
    expect(darkTone(['#FF8080', '#204060'], 0.5)).toBe('#102030');
    expect(backgroundTone({ preset: 'gradient', colors: ['#FFFFFF', '#406080'] })).toBe('#1d2b3a');
    // the presets' own tones stay as they were
    expect(backgroundTone({ preset: 'mesh' })).toBe('#2a2140');
    expect(backgroundTone({ preset: 'flow' })).toBe('#0d0a24');
  });
});

describe('switchBackground', () => {
  it('keeps what the new preset reads: colours from one coloured background to the next', () => {
    expect(switchBackground({ preset: 'gradient', colors: ['#000000', '#FFFFFF'], angle: 90 }, 'flow')).toEqual({ preset: 'flow', colors: ['#000000', '#FFFFFF'] });
    expect(switchBackground({ preset: 'flow', colors: ['#000000', '#FFFFFF'] }, 'gradient')).toEqual({ preset: 'gradient', colors: ['#000000', '#FFFFFF'] });
    expect(switchBackground({ preset: 'image', image: 'a.png', blur: 0.5 }, 'aurora')).toEqual({ preset: 'aurora' });
  });

  it('gives a new gradient its preset\'s colours and a solid one a dark grey', () => {
    expect(switchBackground({ preset: 'aurora' }, 'gradient')).toEqual({ preset: 'gradient', colors: ['#7C5CFF', '#FF7AB6'] });
    expect(switchBackground({ preset: 'aurora' }, 'solid')).toEqual({ preset: 'solid', color: '#1C1C22' });
    expect(switchBackground({ preset: 'solid', color: '#102030' }, 'solid')).toEqual({ preset: 'solid', color: '#102030' });
  });
});
```

Run: `pnpm exec vitest run --project node packages/project`
Expected: FAIL: there are no such presets and fields, and no `backgrounds.ts`.

- [ ] **Step 3: The presets and fields**

In `packages/project/src/schema.ts`, replace:

```ts
// The cuttle.json format version this build reads and writes.
export const CURRENT_VERSION = 1;

export const BACKGROUND_PRESETS = ['sunset-sky', 'aurora', 'mesh', 'solid', 'image'] as const;
export const FRAME_STYLES = ['mac-dark', 'mac-light', 'browser-light', 'none'] as const;
export const TEXT_STYLES = ['pill', 'lower-third', 'caption'] as const;
export const CURSOR_STYLES = ['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const;
```

with:

```ts
// The cuttle.json format version this build reads and writes.
export const CURRENT_VERSION = 1;

export const BACKGROUND_PRESETS = ['sunset-sky', 'aurora', 'mesh', 'solid', 'image', 'gradient', 'flow', 'bokeh', 'dots'] as const;
/** The backgrounds drawn in colours of their own (`background.colors`): a gradient's, and the tints of the others. */
export const COLOURED_BACKGROUNDS = ['gradient', 'mesh', 'flow', 'bokeh', 'dots'] as const;
export const GRADIENT_KINDS = ['linear', 'radial'] as const;
export const FRAME_STYLES = ['mac-dark', 'mac-light', 'browser-light', 'none'] as const;
export const TEXT_STYLES = ['pill', 'lower-third', 'caption'] as const;
export const CURSOR_STYLES = ['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const;
```

In the same file, replace:

```ts
    preset: z.enum(BACKGROUND_PRESETS),
    color: hexColor.optional(),
    image: z.string().min(1).optional(),
  })
  .superRefine((background, ctx) => {
    if (background.preset === 'solid' && background.color === undefined) {
```

with:

```ts
    preset: z.enum(BACKGROUND_PRESETS),
    color: hexColor.optional(),
    image: z.string().min(1).optional(),
    /** The colours of a gradient (its stops, first to last) and the tints of mesh, flow, bokeh and dots; without them, their own. */
    colors: z.array(hexColor).min(2).max(4).optional(),
    /** A gradient's direction, as in CSS: 0 to the top, 90 to the right (default 135); and `radial`, from the centre out. */
    angle: z.number().min(0).max(360).optional(),
    kind: z.enum(GRADIENT_KINDS).optional(),
    /** An image softened (0 sharp, 1 a wash of its colours: a wallpaper behind the window) and darkened (0 to 0.8). */
    blur: z.number().min(0).max(1).optional(),
    dim: z.number().min(0).max(0.8).optional(),
  })
  .superRefine((background, ctx) => {
    if (background.preset === 'solid' && background.color === undefined) {
```

In the same file, replace:

```ts
    if (background.preset === 'image' && background.image === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the "image" background needs an "image" path', path: ['image'] });
    }
  });

const FrameSchema = z.strictObject({
```

with:

```ts
    if (background.preset === 'image' && background.image === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the "image" background needs an "image" path', path: ['image'] });
    }
    if (background.preset === 'gradient' && background.colors === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the "gradient" background needs its "colors" (2 to 4)', path: ['colors'] });
    }
  });

const FrameSchema = z.strictObject({
```

In the same file, replace:

```ts
export type TextPosition = (typeof TEXT_POSITIONS)[number];
export type StillMotion = (typeof STILL_MOTIONS)[number];
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];
export type FrameStyle = (typeof FRAME_STYLES)[number];
export type TextStyle = (typeof TEXT_STYLES)[number];
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
```

with:

```ts
export type TextPosition = (typeof TEXT_POSITIONS)[number];
export type StillMotion = (typeof STILL_MOTIONS)[number];
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];
export type ColouredBackground = (typeof COLOURED_BACKGROUNDS)[number];
export type GradientKind = (typeof GRADIENT_KINDS)[number];
export type FrameStyle = (typeof FRAME_STYLES)[number];
export type TextStyle = (typeof TEXT_STYLES)[number];
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
```

- [ ] **Step 4: Their colours, the switch, the pages' tone**

`packages/project/src/backgrounds.ts`:

```ts
import type { BackgroundPreset, ColouredBackground, Look } from './schema';

/**
 * The colours a coloured background draws in without its own `colors`: mesh's four points, the
 * flow's, the bokeh's lights and the dots' glow (a new gradient starts with these).
 */
export const BACKGROUND_PALETTES: Record<ColouredBackground, readonly string[]> = {
  gradient: ['#7C5CFF', '#FF7AB6'],
  mesh: ['#7C5CFF', '#FF7AB6', '#4CC9F0', '#FFB86B'],
  flow: ['#1A1446', '#5B3FC0', '#D6457F', '#F3A55B'],
  bokeh: ['#3A6DF0', '#A45CF0', '#F56B9B', '#F5B26B'],
  dots: ['#7C5CFF', '#4CC9F0'],
};

/** The fields each background reads (beside `preset`). */
export const BACKGROUND_FIELDS: Record<BackgroundPreset, readonly string[]> = {
  'sunset-sky': [],
  aurora: [],
  mesh: ['colors'],
  solid: ['color'],
  image: ['image', 'blur', 'dim'],
  gradient: ['colors', 'angle', 'kind'],
  flow: ['colors'],
  bokeh: ['colors'],
  dots: ['colors'],
};

/** A solid background's colour when it has none yet. */
export const SOLID_DEFAULT = '#1C1C22';

export const isColouredBackground = (preset: BackgroundPreset): preset is ColouredBackground => preset in BACKGROUND_PALETTES;

/** The colours a background draws in: its own, else its preset's (none for the others). */
export function backgroundColors(background: Look['background']): readonly string[] {
  if (!isColouredBackground(background.preset)) return [];
  return background.colors ?? BACKGROUND_PALETTES[background.preset];
}

/**
 * Another preset for a background, keeping what the new one reads (a gradient's colours stay the
 * flow's): a gradient without colours gets its preset's, a solid one a dark grey. An image needs its
 * `image` still.
 */
export function switchBackground(background: Readonly<Record<string, unknown>>, preset: BackgroundPreset): Record<string, unknown> {
  const next: Record<string, unknown> = { preset };
  for (const field of BACKGROUND_FIELDS[preset]) if (background[field] !== undefined) next[field] = background[field];
  if (preset === 'gradient' && next.colors === undefined) next.colors = [...BACKGROUND_PALETTES.gradient];
  if (preset === 'solid' && next.color === undefined) next.color = SOLID_DEFAULT;
  return next;
}
```

In `packages/project/src/theme.ts`, replace:

```ts
import type { BackgroundPreset, Look } from './schema';

/** A dark tone of each background preset, for pages that draw their own background. */
```

with:

```ts
import { isColouredBackground } from './backgrounds';
import type { BackgroundPreset, Look } from './schema';

/** A dark tone of each background preset, for pages that draw their own background. */
```

In the same file, replace:

```ts
  mesh: '#2a2140',
  solid: '#16161a',
  image: '#16161a',
};

/**
 * The tone motion pages draw their own background in when the theme names none: a solid
 * background's colour, else a dark tone of the preset.
 */
export function backgroundTone(background: Look['background']): string {
  return background.preset === 'solid' && background.color ? background.color : BACKGROUND_TONES[background.preset];
}
```

with:

```ts
  mesh: '#2a2140',
  solid: '#16161a',
  image: '#16161a',
  gradient: '#16161a',
  flow: '#0d0a24',
  bokeh: '#070b1a',
  dots: '#0b0d12',
};

const channels = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/** The darkest of `colors`, mixed `towardBlack` of the way to black, as `#rrggbb`. */
export function darkTone(colors: readonly string[], towardBlack: number): string {
  const darkest = [...colors].sort((a, b) => luminance(a) - luminance(b))[0]!;
  return `#${channels(darkest)
    .map((value) => Math.round(value * (1 - towardBlack)).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The tone motion pages draw their own background in when the theme names none: a solid
 * background's colour, a dark tone of a background's own colours, else a dark tone of the preset.
 */
export function backgroundTone(background: Look['background']): string {
  if (background.preset === 'solid' && background.color) return background.color;
  if (background.colors && isColouredBackground(background.preset)) return darkTone(background.colors, 0.55);
  return BACKGROUND_TONES[background.preset];
}
```

In `packages/project/src/index.ts`, replace:

```ts
  AUTO_KINDS,
  BACKGROUND_PRESETS,
  CAPTION_STYLES,
  THEME_FONTS,
  CLICK_EFFECTS,
  CURRENT_VERSION,
```

with:

```ts
  AUTO_KINDS,
  BACKGROUND_PRESETS,
  CAPTION_STYLES,
  COLOURED_BACKGROUNDS,
  GRADIENT_KINDS,
  THEME_FONTS,
  CLICK_EFFECTS,
  CURRENT_VERSION,
```

In the same file, replace:

```ts
  type AutoEdits,
  type AutoKind,
  type BackgroundPreset,
  type CaptionFix,
  type Captions,
  type Theme,
```

with:

```ts
  type AutoEdits,
  type AutoKind,
  type BackgroundPreset,
  type ColouredBackground,
  type GradientKind,
  type CaptionFix,
  type Captions,
  type Theme,
```

In the same file, replace:

```ts
  type MarkersParseResult,
} from './markers';
export { BRAND_VERSION, BrandKitSchema, parseBrandKitJson, type BrandKit, type BrandKitParseResult } from './brand';
export { backgroundTone } from './theme';
```

with:

```ts
  type MarkersParseResult,
} from './markers';
export { BRAND_VERSION, BrandKitSchema, parseBrandKitJson, type BrandKit, type BrandKitParseResult } from './brand';
export { BACKGROUND_FIELDS, BACKGROUND_PALETTES, SOLID_DEFAULT, backgroundColors, isColouredBackground, switchBackground } from './backgrounds';
export { backgroundTone, darkTone } from './theme';
```

Run: `pnpm exec vitest run --project node packages/project`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project
git commit -m "project: the gradient, flow, bokeh and dots backgrounds, colours of their own, a softened and darker image

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The engine draws them

**Files:**
- Create: `packages/engine/test/backgrounds.browser.test.ts`
- Modify: `packages/engine/src/presets/backgrounds.ts`, `packages/engine/src/passes/background.ts`, `packages/engine/test/renderer.browser.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/backgrounds.browser.test.ts`:

```ts
import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import type { RenderState } from '@cuttle/timeline';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { createRenderer, type FrameSources } from '../src/renderer';
import { SCREEN, fixtures } from './fixtures';
import { pixelAt, readPixels, type Pixels } from './gl-util';

let assets: EngineAssets;
let wallpaper: ImageBitmap;

beforeAll(async () => {
  assets = await loadEngineAssets();
  wallpaper = (await fixtures()).background;
});

const NO_SOURCES: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };

/** The background alone at `t`: a motion scene whose page has no frame yet shows nothing else. */
function background(look: NonNullable<CuttleProjectInput['look']>['background'], t = 1, size = { width: 160, height: 90 }): Pixels {
  const parsed = parseProject({ version: 1, output: size, sources: { screen: 's.mp4' }, look: { background: look }, scenes: [{ type: 'motion', src: 'a.html', duration: 10 }] });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const canvas = new OffscreenCanvas(1, 1);
  const renderer = createRenderer(canvas, parsed.project, { assets, screenSize: SCREEN, backgroundImage: wallpaper });
  const state: RenderState = { t, layers: [{ index: 0, sceneIndex: 0, kind: 'motion', local: t, progress: t / 10, opacity: 1, masks: [], texts: [], overlays: [] }] };
  renderer.render(state, NO_SOURCES);
  const gl = canvas.getContext('webgl2')!;
  const pixels = readPixels(gl);
  renderer.dispose();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return pixels;
}

const rgb = (pixels: Pixels, x: number, y: number) => pixelAt(pixels, x, y).slice(0, 3);
const near = (actual: number[], expected: number[], within = 3) => actual.every((value, i) => Math.abs(value - expected[i]!) <= within);
/** The mean of each channel. */
function mean(pixels: Pixels): number[] {
  const sum = [0, 0, 0];
  for (let i = 0; i < pixels.data.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += pixels.data[i + c]!;
  return sum.map((value) => value / (pixels.width * pixels.height));
}
/** The hard edges of a picture: neighbouring pixels (side by side) that differ by more than 30 in a channel. */
function edges(pixels: Pixels): number {
  let count = 0;
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 1; x < pixels.width; x++) {
      const i = (y * pixels.width + x) * 4;
      if ([0, 1, 2].some((c) => Math.abs(pixels.data[i + c]! - pixels.data[i - 4 + c]!) > 30)) count++;
    }
  }
  return count;
}
const meanDifference = (a: Pixels, b: Pixels) => a.data.reduce((sum, value, i) => (i % 4 === 3 ? sum : sum + Math.abs(value - b.data[i]!)), 0) / (a.width * a.height * 3);

describe('the gradient', () => {
  it('runs from its first colour to its last in the direction CSS gives the angle', () => {
    const across = background({ preset: 'gradient', colors: ['#FF0000', '#0000FF'], angle: 90 });
    // (a pixel's centre is half a pixel into the gradient)
    expect(near(rgb(across, 0, 45), [255, 0, 0], 8)).toBe(true);
    expect(near(rgb(across, 159, 45), [0, 0, 255], 8)).toBe(true);
    const up = background({ preset: 'gradient', colors: ['#FF0000', '#0000FF'], angle: 0 });
    expect(near(rgb(up, 80, 89), [255, 0, 0], 12)).toBe(true);
    expect(near(rgb(up, 80, 0), [0, 0, 255], 12)).toBe(true);
    // the default, 135 degrees: from the top left corner to the bottom right one
    const corner = background({ preset: 'gradient', colors: ['#000000', '#FFFFFF'] });
    expect(near(rgb(corner, 0, 0), [0, 0, 0], 8)).toBe(true);
    expect(near(rgb(corner, 159, 89), [255, 255, 255], 8)).toBe(true);
  });

  it('mixes in Oklab: the middle of red and blue is a violet as light as its ends, not the dark purple of a mix in sRGB (128, 0, 128)', () => {
    const [r, g, b] = rgb(background({ preset: 'gradient', colors: ['#FF0000', '#0000FF'], angle: 90 }), 80, 45);
    expect(r! + g! + b!).toBeGreaterThan(330);
    expect(b).toBeGreaterThan(r!);
    expect(r).toBeGreaterThan(g!);
  });

  it('goes through every stop, and radial from the centre out', () => {
    const stops = background({ preset: 'gradient', colors: ['#FF0000', '#00FF00', '#0000FF'], angle: 90 });
    expect(near(rgb(stops, 80, 45), [0, 255, 0], 24)).toBe(true);
    const radial = background({ preset: 'gradient', colors: ['#FFFFFF', '#000000'], kind: 'radial' });
    expect(rgb(radial, 80, 45).every((value) => value > 245)).toBe(true);
    expect(near(rgb(radial, 0, 0), [0, 0, 0], 4)).toBe(true);
  });
});

describe('the coloured backgrounds', () => {
  it('draw mesh in colours of their own', () => {
    // the first point sits at the top left: red there
    const [r, g, b] = rgb(background({ preset: 'mesh', colors: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'] }), 25, 18);
    expect(r).toBeGreaterThan(200);
    expect(Math.max(g!, b!)).toBeLessThan(110);
  });

  for (const preset of ['flow', 'bokeh', 'dots'] as const) {
    it(`draws ${preset} the same every time, quiet, dark enough for a window, in its palette`, () => {
      const look = { preset, colors: ['#401010', '#FF3030'] };
      const first = background(look, 4);
      expect(meanDifference(first, background(look, 4))).toBe(0);
      // it moves, slowly: half a second later only a little has changed
      const later = meanDifference(first, background(look, 4.5));
      expect(later).toBeGreaterThan(0);
      expect(later).toBeLessThan(4);
      const [r, g, b] = mean(first);
      expect(r).toBeGreaterThan(g! + 4);
      expect(r).toBeGreaterThan(b! + 4);
      expect((r! + g! + b!) / 3).toBeLessThan(110);
      // without colours of its own, its preset's
      expect(meanDifference(background({ preset }, 4), first)).toBeGreaterThan(2);
    });
  }
});

describe('the image', () => {
  it('softens and darkens the image as asked', () => {
    const sharp = background({ preset: 'image', image: 'bg.png' }, 1, { width: 320, height: 180 });
    const soft = background({ preset: 'image', image: 'bg.png', blur: 1 }, 1, { width: 320, height: 180 });
    expect(edges(sharp)).toBeGreaterThan(100);
    expect(edges(soft)).toBeLessThan(edges(sharp) * 0.1);
    // its colours stay: the mean of the picture barely moves
    expect(mean(soft).every((value, c) => Math.abs(value - mean(sharp)[c]!) < 12)).toBe(true);
    const dim = background({ preset: 'image', image: 'bg.png', dim: 0.5 }, 1, { width: 320, height: 180 });
    expect(mean(dim).every((value, c) => Math.abs(value - mean(sharp)[c]! * 0.5) < 2)).toBe(true);
  });
});
```

In `packages/engine/test/renderer.browser.test.ts`, replace:

```ts
  it('compiles every background preset', async () => {
    const { background } = await fixtures();
    for (const preset of BACKGROUND_PRESETS) {
      const project = parse({ look: { background: { preset, color: '#000000', image: 'bg.png' } } });
      createRenderer(new OffscreenCanvas(1, 1), project, { assets, screenSize: SCREEN, backgroundImage: background }).dispose();
    }
  });
```

with:

```ts
  it('compiles every background preset', async () => {
    const { background } = await fixtures();
    for (const preset of BACKGROUND_PRESETS) {
      const project = parse({ look: { background: { preset, color: '#000000', image: 'bg.png', colors: ['#000000', '#FFFFFF'] } } });
      createRenderer(new OffscreenCanvas(1, 1), project, { assets, screenSize: SCREEN, backgroundImage: background }).dispose();
    }
  });
```

Run: `pnpm exec vitest run --project browser packages/engine/test/backgrounds.browser.test.ts`
Expected: FAIL: there are no shaders for the new presets.

- [ ] **Step 2: The shaders**

In `packages/engine/src/presets/backgrounds.ts`, replace:

```ts
import type { BackgroundPreset } from '@cuttle/project';

/**
 * Background presets: the body of a fragment shader that follows `FRAGMENT_PRELUDE` and fills the
 * whole output. Uniforms: `u_time` (output seconds, for a slow drift), `u_color` (solid) and
 * `u_image` / `u_imageSize` (image, covered and centred).
 */
export const BACKGROUNDS: Record<BackgroundPreset, string> = {
  'sunset-sky': `
```

with:

```ts
import type { BackgroundPreset } from '@cuttle/project';

/**
 * The palette of a coloured background: `u_colors` (`u_count` of them, 2 to 4, sRGB) and `u_base`
 * (a dark tone of them). `paletteColor(i)` is the i-th, wrapping around; `palette(t)` runs through
 * them from 0 to 1, mixed in Oklab (no muddy middle between two hues, as CSS's `in oklab`).
 */
const PALETTE = `
uniform vec3 u_colors[4];
uniform int u_count;
uniform vec3 u_base;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 toOklab(vec3 c) {
  c = srgbToLinear(c);
  vec3 lms = vec3(
    0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  lms = pow(lms, vec3(1.0 / 3.0));
  return vec3(
    0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
    0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
}
vec3 fromOklab(vec3 c) {
  vec3 lms = vec3(
    c.x + 0.3963377774 * c.y + 0.2158037573 * c.z,
    c.x - 0.1055613458 * c.y - 0.0638541728 * c.z,
    c.x - 0.0894841775 * c.y - 1.2914855480 * c.z);
  lms = lms * lms * lms;
  vec3 rgb = vec3(
    4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
    -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
    -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z);
  return linearToSrgb(clamp(rgb, 0.0, 1.0));
}
vec3 paletteColor(int i) {
  return u_colors[i % u_count];
}
vec3 palette(float t) {
  float at = clamp(t, 0.0, 1.0) * float(u_count - 1);
  int i = min(int(floor(at)), u_count - 2);
  return fromOklab(mix(toOklab(u_colors[i]), toOklab(u_colors[i + 1]), at - float(i)));
}
`;

/** Smooth value noise and three octaves of it, for the flow: large, soft shapes. */
const NOISE = `
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 3; i++) {
    value += amplitude * noise(p);
    // each octave turned against the last: no grid shows through
    p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + vec2(17.1, 3.7);
    amplitude *= 0.5;
  }
  return value;
}
`;

/** Darker towards the corners, a little: the eye stays on the window. */
const VIGNETTE = `
vec3 vignette(vec3 color, float amount) {
  vec2 d = v_uv - 0.5;
  return color * (1.0 - amount * dot(d, d) * 2.0);
}
`;

/**
 * Background presets: the body of a fragment shader that follows `FRAGMENT_PRELUDE` and fills the
 * whole output. Uniforms: `u_time` (output seconds, for a slow drift), `u_color` (solid),
 * `u_image` / `u_imageSize` / `u_blur` / `u_dim` (image, covered and centred), the palette
 * (`PALETTE`: gradient, mesh, flow, bokeh, dots) and `u_angle` / `u_radial` (gradient).
 */
export const BACKGROUNDS: Record<BackgroundPreset, string> = {
  'sunset-sky': `
```

In the same file, replace:

```ts
  }
  o_color = vec4(dither(clamp(color, 0.0, 1.0)), 1.0);
}`,
  mesh: `
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
```

with:

```ts
  }
  o_color = vec4(dither(clamp(color, 0.0, 1.0)), 1.0);
}`,
  mesh: `${PALETTE}
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
```

In the same file, replace:

```ts
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
```

with:

```ts
    vec2(0.82 * aspect, 0.18 + 0.05 * cos(t * 1.3)),
    vec2(0.25 * aspect, 0.85 + 0.04 * cos(t * 0.7)),
    vec2(0.78 * aspect + 0.05 * cos(t * 0.9), 0.80));
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 d = p - points[i];
    float w = 1.0 / (0.02 + pow(dot(d, d), 1.5));
    sum += paletteColor(i) * w;
    total += w;
  }
  o_color = vec4(dither(sum / total), 1.0);
```

In the same file, replace:

```ts
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

with:

```ts
  image: `
uniform sampler2D u_image;
uniform vec2 u_imageSize;
uniform float u_blur;
uniform float u_dim;
void main() {
  float scale = max(u_resolution.x / u_imageSize.x, u_resolution.y / u_imageSize.y);
  vec2 shown = u_resolution / scale;
  vec2 origin = (u_imageSize - shown) * 0.5;
  vec2 uv = (origin + v_uv * shown) / u_imageSize;
  vec3 color;
  if (u_blur <= 0.0) {
    color = texture(u_image, uv).rgb;
  } else {
    // a disc of taps, on a level of the mipmap as coarse as the disc is wide: up to 16 % of the
    // output's short side at 1, in the image's own pixels
    float radius = u_blur * 0.16 * min(u_resolution.x, u_resolution.y) / scale;
    float lod = log2(max(radius / 4.0, 1.0));
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 24; i++) {
      float fi = float(i);
      float r = radius * sqrt((fi + 0.5) / 24.0);
      float a = fi * 2.39996323;
      sum += textureLod(u_image, uv + vec2(cos(a), sin(a)) * r / u_imageSize, lod).rgb;
    }
    color = sum / 24.0;
  }
  // a sharp image as it is; a softened or darkened one dithered against banding
  o_color = vec4(u_blur > 0.0 || u_dim > 0.0 ? dither(color * (1.0 - u_dim)) : color, 1.0);
}`,
  gradient: `${PALETTE}
uniform float u_angle;
uniform float u_radial;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t;
  if (u_radial > 0.5) {
    // from the centre to the farthest corner
    t = length(p) / (0.5 * length(vec2(aspect, 1.0)));
  } else {
    // as CSS lays it out: 0 degrees to the top, 90 to the right, the corners on 0 and 1
    float a = radians(u_angle);
    vec2 direction = vec2(sin(a), -cos(a));
    float extent = 0.5 * (abs(aspect * direction.x) + abs(direction.y));
    t = dot(p, direction) / (2.0 * extent) + 0.5;
  }
  o_color = vec4(dither(palette(t)), 1.0);
}`,
  flow: `${PALETTE}${NOISE}${VIGNETTE}
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = mat2(0.8, -0.6, 0.6, 0.8) * vec2(v_uv.x * aspect, v_uv.y) * 1.1;
  float t = u_time * 0.05;
  // noise warped by noise, large and slow: soft folds of the palette drifting past
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.8, 0.0)));
  float f = fbm(p + 1.6 * q + vec2(t * 0.3, -t * 0.2));
  vec3 color = palette(smoothstep(0.16, 0.84, f));
  color = mix(u_base, color, 0.9);
  o_color = vec4(dither(clamp(vignette(color, 0.6), 0.0, 1.0)), 1.0);
}`,
  bokeh: `${PALETTE}${VIGNETTE}
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);
  vec3 color = mix(u_base * 1.6, u_base * 0.7, v_uv.y);
  // soft out-of-focus lights in the palette's colours, drifting up and sideways, slowly
  for (int i = 0; i < 18; i++) {
    float fi = float(i);
    float x = hash12(vec2(fi, 1.7));
    float y = hash12(vec2(fi, 9.1));
    float size = 0.05 + 0.12 * hash12(vec2(fi, 4.3));
    float speed = 0.006 + 0.01 * hash12(vec2(fi, 7.7));
    vec2 center = vec2(
      (x + 0.04 * sin(u_time * 0.07 + fi * 1.3)) * aspect,
      fract(y - u_time * speed) * 1.4 - 0.2);
    float d = length(p - center);
    float disc = smoothstep(size, size * 0.86, d);
    float rim = smoothstep(size * 0.7, size * 0.95, d) * disc;
    vec3 tint = paletteColor(i);
    color += tint * (disc * (0.07 + 0.08 * hash12(vec2(fi, 2.9))) + rim * 0.05);
  }
  o_color = vec4(dither(clamp(vignette(color, 0.5), 0.0, 1.0)), 1.0);
}`,
  dots: `${PALETTE}${VIGNETTE}
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);
  float unit = u_resolution.y / 1080.0;
  // two slow glows in the palette's colours
  vec2 a = vec2(aspect * (0.5 + 0.32 * sin(u_time * 0.06)), 0.42 + 0.22 * cos(u_time * 0.045));
  vec2 b = vec2(aspect * (0.5 + 0.36 * cos(u_time * 0.05 + 2.0)), 0.6 + 0.2 * sin(u_time * 0.038 + 1.0));
  vec3 glow = paletteColor(0) * exp(-dot(p - a, p - a) * 4.0) + paletteColor(1) * exp(-dot(p - b, p - b) * 5.0);
  vec3 color = u_base + glow * 0.32;
  // a fine grid of dots, brighter in the glow
  float spacing = 36.0 * unit;
  vec2 cell = (fract(v_px / spacing) - 0.5) * spacing;
  float spot = 1.0 - smoothstep(1.2 * unit, 2.4 * unit, length(cell));
  color += spot * (vec3(0.06) + glow * 0.55);
  o_color = vec4(dither(clamp(vignette(color, 0.7), 0.0, 1.0)), 1.0);
}`,
};
```

- [ ] **Step 3: Their uniforms**

In `packages/engine/src/passes/background.ts`, replace:

```ts
import type { Look } from '@cuttle/project';
import { hexToRgb } from '../color';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { createTexture, uploadTexture } from '../gl/texture';
```

with:

```ts
import { backgroundColors, darkTone, type Look } from '@cuttle/project';
import { hexToRgb, type Rgb } from '../color';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { createTexture, uploadTexture } from '../gl/texture';
```

In the same file, replace:

```ts
export class BackgroundPass {
  private readonly shader: Shader;
  private readonly image?: { texture: WebGLTexture; size: Size };

  constructor(
    private readonly gl: WebGL2RenderingContext,
```

with:

```ts
export class BackgroundPass {
  private readonly shader: Shader;
  private readonly image?: { texture: WebGLTexture; size: Size };
  /** The palette of a coloured background, and a dark tone of it. */
  private readonly colors: Rgb[];
  private readonly base?: Rgb;

  constructor(
    private readonly gl: WebGL2RenderingContext,
```

In the same file, replace:

```ts
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
```

with:

```ts
    this.shader = new Shader(gl, `background ${background.preset}`, RECT_VERTEX, FRAGMENT_PRELUDE + BACKGROUNDS[background.preset]);
    if (background.preset === 'image') {
      if (!image) throw new Error('createRenderer: look.background.preset is "image" but no backgroundImage was given');
      // mipmapped: a blurred image reads coarser levels
      const texture = createTexture(gl, true);
      uploadTexture(gl, texture, image, true);
      this.image = { texture, size: { width: image.width, height: image.height } };
    }
    const colors = backgroundColors(background);
    this.colors = colors.map(hexToRgb);
    if (colors.length > 0) this.base = hexToRgb(darkTone(colors, 0.8));
  }

  draw(t: number): void {
    const { background } = this;
    const shader = this.shader.use().float('u_time', t);
    if (background.color) shader.vec3('u_color', hexToRgb(background.color));
    if (this.image) {
      shader
        .texture('u_image', 0, this.image.texture)
        .vec2('u_imageSize', this.image.size.width, this.image.size.height)
        .float('u_blur', background.blur ?? 0)
        .float('u_dim', background.dim ?? 0);
    }
    if (this.colors.length > 0) {
      this.colors.forEach((color, i) => shader.vec3(`u_colors[${i}]`, color));
      shader.int('u_count', this.colors.length).vec3('u_base', this.base!);
      shader.float('u_angle', background.angle ?? 135).float('u_radial', background.kind === 'radial' ? 1 : 0);
    }
    drawRect(this.gl, shader, [0, 0, this.output.width, this.output.height], this.output);
  }
```

Run: `pnpm exec vitest run --project browser packages/engine`
Expected: PASS, the golden images unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/engine
git commit -m "engine: gradients mixed in Oklab, flow, bokeh and dots, mesh in any colours, an image softened and darkened

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The product's colours, the wallpaper, and `cuttle background`

**Files:**
- Create: `packages/core/src/keep-file.ts`, `packages/core/src/palette.ts`, `packages/core/src/wallpaper.ts`, `packages/core/src/wallpaper-win32.ts`, `packages/core/src/wallpaper-darwin.ts`, `packages/core/test/palette.test.ts`, `apps/cli/src/commands/background.ts`, `apps/cli/test/background.test.ts`
- Modify: `packages/core/src/brands.ts`, `packages/core/src/index.ts`, `apps/cli/src/main.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/palette.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { CoreError } from '../src/errors';
import { imagePalette, paletteOf, takePalette } from '../src/palette';
import { importWallpaper } from '../src/wallpaper';
import { parseRegWallpaper } from '../src/wallpaper-win32';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-palette-'));
  dirs.push(dir);
  return dir;
};
const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);
const ffmpeg = (args: string[]) => expect(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { windowsHide: true }).status).toBe(0);

/** RGBA pixels: `count` of each colour. */
function pixels(...parts: [rgba: [number, number, number, number], count: number][]): Uint8Array {
  return new Uint8Array(parts.flatMap(([rgba, count]) => Array.from({ length: count }, () => rgba).flat()));
}
const channels = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

describe('paletteOf', () => {
  it('takes the clear colours of a grey interface, dark to light, each far from the others', () => {
    const ui = pixels(
      [[245, 245, 245, 255], 5000],
      [[30, 30, 34, 255], 3000],
      [[128, 128, 128, 255], 800],
      [[217, 119, 87, 255], 300], // an orange button
      [[60, 110, 230, 255], 150], // a blue link
      [[219, 121, 89, 255], 50], // nearly the button's orange
    );
    const palette = paletteOf(ui);
    expect(palette.length).toBeGreaterThanOrEqual(2);
    expect(palette.length).toBeLessThanOrEqual(4);
    expect(palette).toContain('#D97757');
    expect(palette.some((color) => channels(color)[2]! > 200 && channels(color)[0]! < 90)).toBe(true);
    // no two alike, and dark to light
    const lum = palette.map((color) => {
      const [r, g, b] = channels(color);
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    });
    expect([...lum].sort((a, b) => a - b)).toEqual(lum);
    expect(palette.filter((color) => channels(color)[0]! > 200 && channels(color)[1]! < 140)).toHaveLength(1);
  });

  it('gives two colours of a picture of one, and leaves transparent pixels out', () => {
    expect(paletteOf(pixels([[200, 40, 40, 255], 100], [[0, 255, 0, 0], 900]))).toEqual(['#5A1212', '#C82828']);
    expect(() => paletteOf(pixels([[0, 0, 0, 0], 10]))).toThrow(CoreError);
  });

  it('takes the tones of a picture of greys', () => {
    expect(paletteOf(pixels([[20, 20, 20, 255], 500], [[200, 200, 200, 255], 300]))).toEqual(['#141414', '#C8C8C8']);
  });
});

describe('the colours of a logo and of a take', () => {
  it('reads an SVG\'s colours, and an image\'s pixels', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#7C5CFF"/><path fill="#fff"/><circle stroke="#ff7ab6"/></svg>');
    expect(await imagePalette(join(dir, 'logo.svg'))).toEqual(['#7C5CFF', '#FF7AB6', '#FFFFFF']);
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x2A9D8F:s=64x32,drawbox=x=0:y=0:w=20:h=32:color=0xE76F51:t=fill', '-frames:v', '1', join(dir, 'logo.png')]);
    const image = await imagePalette(join(dir, 'logo.png'));
    expect(image).toHaveLength(2);
    expect(channels(image[0]!)[1]).toBeGreaterThan(130); // the teal (darker)
    expect(channels(image[1]!)[0]).toBeGreaterThan(200); // the coral
    expect(await failure(imagePalette(join(dir, 'none.svg')))).toMatchObject({ code: 'missing-file' });
  });

  it('reads the colours a take shows, over its whole length', async () => {
    const dir = temp();
    // a grey screen, blue for its first half and orange for its second
    ffmpeg(['-f', 'lavfi', '-i', "color=c=0x202020:s=320x180:d=4,drawbox=x=0:y=0:w=80:h=180:color=0x3C6EE6@1:t=fill:enable='lt(t,2)',drawbox=x=0:y=0:w=80:h=180:color=0xD97757@1:t=fill:enable='gte(t,2)'", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(dir, 'screen.mp4')]);
    const palette = await takePalette(join(dir, 'screen.mp4'));
    const blueish = palette.some((color) => channels(color)[2]! > 180 && channels(color)[0]! < 110);
    const orangeish = palette.some((color) => channels(color)[0]! > 180 && channels(color)[2]! < 130);
    expect([blueish, orangeish]).toEqual([true, true]);
  });
});

describe('the wallpaper', () => {
  const before = process.env.CUTTLE_WALLPAPER;
  afterEach(() => {
    if (before === undefined) delete process.env.CUTTLE_WALLPAPER;
    else process.env.CUTTLE_WALLPAPER = before;
  });

  it('reads the path out of the registry\'s answer', () => {
    const answer = '\r\nHKEY_CURRENT_USER\\Control Panel\\Desktop\r\n    WallPaper    REG_SZ    C:\\Users\\me\\Pictures\\Lake Tahoe.jpg\r\n\r\n';
    expect(parseRegWallpaper(answer)).toBe('C:\\Users\\me\\Pictures\\Lake Tahoe.jpg');
    expect(parseRegWallpaper('    WallPaper    REG_SZ    \r\n')).toBeUndefined();
    expect(parseRegWallpaper('ERROR: The system was unable to find the specified registry key or value.')).toBeUndefined();
  });

  it('copies it into images/, a file without an extension by its bytes; again the same copy, another a new one', async () => {
    const dir = temp();
    const source = join(temp(), 'TranscodedWallpaper');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x264653:s=64x36', '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', source]);
    process.env.CUTTLE_WALLPAPER = source;
    expect(await importWallpaper(dir)).toBe('images/wallpaper.jpg');
    expect(await importWallpaper(dir)).toBe('images/wallpaper.jpg');
    expect(readFileSync(join(dir, 'images', 'wallpaper.jpg')).equals(readFileSync(source))).toBe(true);
    const other = join(temp(), 'other.png');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0xE9C46A:s=64x36', '-frames:v', '1', other]);
    process.env.CUTTLE_WALLPAPER = other;
    expect(await importWallpaper(dir)).toBe('images/wallpaper.png');
    process.env.CUTTLE_WALLPAPER = source;
    writeFileSync(source, Buffer.concat([readFileSync(source), Buffer.from('changed')]));
    expect(await importWallpaper(dir)).toBe('images/wallpaper-2.jpg');
    expect(readdirSync(join(dir, 'images')).sort()).toEqual(['wallpaper-2.jpg', 'wallpaper.jpg', 'wallpaper.png']);
  });

  it('says when there is none, or it is no image Cuttle reads', async () => {
    const dir = temp();
    process.env.CUTTLE_WALLPAPER = join(dir, 'gone.jpg');
    expect(await failure(importWallpaper(dir))).toMatchObject({ code: 'missing-file' });
    writeFileSync(join(dir, 'photo.heic'), 'not a jpeg');
    process.env.CUTTLE_WALLPAPER = join(dir, 'photo.heic');
    expect(await failure(importWallpaper(dir))).toMatchObject({ code: 'invalid-media' });
  });
});
```

`apps/cli/test/background.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/main';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-background-'));
  dirs.push(dir);
  return dir;
};
const ffmpeg = (args: string[]) => expect(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { windowsHide: true }).status).toBe(0);
const projectWith = (fields: Record<string, unknown> = {}) => {
  const dir = temp();
  writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, ...fields }));
  return dir;
};
const background = (dir: string) => (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { look: { background: Record<string, unknown> } }).look.background;

async function cli(...argv: string[]) {
  let stdout = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: () => {} });
  return { code, json: JSON.parse(stdout) as Record<string, unknown> };
}

describe('cuttle background', () => {
  const before = process.env.CUTTLE_WALLPAPER;
  afterEach(() => {
    if (before === undefined) delete process.env.CUTTLE_WALLPAPER;
    else process.env.CUTTLE_WALLPAPER = before;
  });

  it('sets a preset, keeping only the fields it reads', async () => {
    const dir = projectWith({ look: { background: { preset: 'solid', color: '#102030' }, frame: { title: 'mine' } } });
    expect((await cli('--json', '-C', dir, 'background', 'flow')).json).toEqual({ background: { preset: 'flow' } });
    expect(background(dir)).toEqual({ preset: 'flow' });
    expect((JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { look: { frame: unknown } }).look.frame).toEqual({ title: 'mine' });
    // colours given to a background that takes colours keep it; a solid one by its colour
    await cli('--json', '-C', dir, 'background', '--colors', '#401010,#FF3030');
    expect(background(dir)).toEqual({ preset: 'flow', colors: ['#401010', '#FF3030'] });
    await cli('--json', '-C', dir, 'background', '--color', '#0C0C0C');
    expect(background(dir)).toEqual({ preset: 'solid', color: '#0C0C0C' });
  });

  it('makes a gradient: its colours, its angle, radial and back', async () => {
    const dir = projectWith();
    await cli('--json', '-C', dir, 'background', 'gradient');
    expect(background(dir)).toEqual({ preset: 'gradient', colors: ['#7C5CFF', '#FF7AB6'] });
    await cli('--json', '-C', dir, 'background', '--colors', '#0B132B, #3A506B,#5BC0BE', '--angle', '90', '--radial');
    expect(background(dir)).toEqual({ preset: 'gradient', colors: ['#0B132B', '#3A506B', '#5BC0BE'], angle: 90, kind: 'radial' });
    await cli('--json', '-C', dir, 'background', '--linear');
    expect(background(dir)).toEqual({ preset: 'gradient', colors: ['#0B132B', '#3A506B', '#5BC0BE'], angle: 90 });
  });

  it('takes the colours of the take, of the logo and of an image', async () => {
    const dir = projectWith({ theme: { logo: 'brand/logo.svg' } });
    mkdirSync(join(dir, 'takes', '1'), { recursive: true });
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=320x180:d=2,drawbox=x=0:y=0:w=120:h=180:color=0x3C6EE6@1:t=fill', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(dir, 'takes', '1', 'screen.mp4')]);
    const take = await cli('--json', '-C', dir, 'background', '--from', 'take');
    expect(take.code).toBe(0);
    expect(background(dir).preset).toBe('gradient');
    expect((background(dir).colors as string[]).length).toBeGreaterThanOrEqual(2);
    mkdirSync(join(dir, 'brand'));
    writeFileSync(join(dir, 'brand', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#7C5CFF"/><path fill="#FF7AB6"/></svg>');
    await cli('--json', '-C', dir, 'background', 'bokeh', '--from', 'logo');
    expect(background(dir)).toEqual({ preset: 'bokeh', colors: ['#7C5CFF', '#FF7AB6'] });
    const image = join(temp(), 'swatch.png');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0xE76F51:s=32x32', '-frames:v', '1', image]);
    await cli('--json', '-C', dir, 'background', '--from', image);
    // the coral (ffmpeg's colour source rounds it a little), and a darker shade of it
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt((background(dir).colors as string[])[1]!.slice(at, at + 2), 16));
    expect([r, g, b].every((value, i) => Math.abs(value! - [0xe7, 0x6f, 0x51][i]!) <= 3)).toBe(true);
  });

  it('puts an image or the wallpaper behind the window, softened and darkened', async () => {
    const dir = projectWith();
    const outside = join(temp(), 'Desk Photo.png');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x2A9D8F:s=64x36', '-frames:v', '1', outside]);
    await cli('--json', '-C', dir, 'background', '--image', outside, '--blur', '0.3', '--dim', '0.2');
    expect(background(dir)).toEqual({ preset: 'image', image: 'images/Desk-Photo.png', blur: 0.3, dim: 0.2 });
    expect(existsSync(join(dir, 'images', 'Desk-Photo.png'))).toBe(true);
    process.env.CUTTLE_WALLPAPER = outside;
    await cli('--json', '-C', dir, 'background', 'image', '--wallpaper');
    expect(background(dir)).toEqual({ preset: 'image', image: 'images/wallpaper.png', blur: 0.3, dim: 0.2 });
    await cli('--json', '-C', dir, 'background', 'aurora');
    await cli('--json', '-C', dir, 'background', '--wallpaper');
    expect(background(dir)).toEqual({ preset: 'image', image: 'images/wallpaper.png', blur: 0.6 });
  });

  it('refuses what it cannot do', async () => {
    const dir = projectWith();
    expect((await cli('--json', '-C', dir, 'background', 'plaid')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'background', '--radial', '--linear')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'background', '--colors', 'red,blue')).json).toMatchObject({ error: { code: 'invalid-project' } });
    expect((await cli('--json', '-C', dir, 'background', '--from', 'logo')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'background', '--from', 'take')).json).toMatchObject({ error: { code: 'missing-file' } });
    expect((await cli('--json', '-C', dir, 'background', '--angle', '400')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'background', '--image', join(dir, 'none.png'))).json).toMatchObject({ error: { code: 'missing-file' } });
  });
});
```

Run: `pnpm exec vitest run --project node packages/core/test/palette.test.ts apps/cli/test/background.test.ts`
Expected: FAIL: there is no `palette.ts`, no `wallpaper.ts`, and no `background` command.

- [ ] **Step 2: A file put into the project, never over another (the brand kits' too)**

`packages/core/src/keep-file.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Puts `bytes` into the project's `folder` as `<stem><ext>`: the file there already when it has the
 * same bytes, else the next free `<stem>-2<ext>`… A file there is never overwritten, so an edit
 * undone in the editor still finds the file it had. Returns its project path (`folder/name`).
 */
export async function keepInProject(projectDir: string, bytes: Buffer, folder: string, stem: string, ext: string): Promise<string> {
  const dir = join(projectDir, folder);
  await mkdir(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const name = `${stem}${n === 1 ? '' : `-${n}`}${ext}`;
    const target = join(dir, name);
    const existing = await readFile(target).catch(() => undefined);
    if (existing?.equals(bytes)) return `${folder}/${name}`;
    if (existing) continue;
    await writeFile(target, bytes, { flag: 'wx' });
    return `${folder}/${name}`;
  }
}
```

In `packages/core/src/brands.ts`, replace:

```ts
import { extname, join, resolve } from 'node:path';
import { BRAND_VERSION, parseBrandKitJson, type BrandKit, type CuttleProject } from '@cuttle/project';
import { CoreError } from './errors';
import type { ProjectFile } from './project-file';

/** A kit's file in its folder. */
```

with:

```ts
import { extname, join, resolve } from 'node:path';
import { BRAND_VERSION, parseBrandKitJson, type BrandKit, type CuttleProject } from '@cuttle/project';
import { CoreError } from './errors';
import { keepInProject } from './keep-file';
import type { ProjectFile } from './project-file';

/** A kit's file in its folder. */
```

In the same file, replace:

```ts
  } catch (error) {
    throw new CoreError('missing-file', `cannot read the brand kit's ${source}: ${(error as Error).message}`, { cause: error });
  }
  const folder = join(projectDir, PROJECT_BRAND_DIR);
  await mkdir(folder, { recursive: true });
  const ext = extname(source).toLowerCase();
  for (let n = 1; ; n++) {
    const name = `${stem}${n === 1 ? '' : `-${n}`}${ext}`;
    const target = join(folder, name);
    const existing = await readFile(target).catch(() => undefined);
    if (existing?.equals(bytes)) return `${PROJECT_BRAND_DIR}/${name}`;
    if (existing) continue;
    await writeFile(target, bytes, { flag: 'wx' });
    return `${PROJECT_BRAND_DIR}/${name}`;
  }
}

/** What applying a kit sets in a project, its files copied into the project first. */
```

with:

```ts
  } catch (error) {
    throw new CoreError('missing-file', `cannot read the brand kit's ${source}: ${(error as Error).message}`, { cause: error });
  }
  return keepInProject(projectDir, bytes, PROJECT_BRAND_DIR, stem, extname(source).toLowerCase());
}

/** What applying a kit sets in a project, its files copied into the project first. */
```

- [ ] **Step 3: The product's colours**

`packages/core/src/palette.ts`:

```ts
// The colours of a product, read off its screen recording or its logo: a few clear colours for a
// background (`cuttle background --from`, the Look tab's "From the take" and "From the logo").
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { CoreError } from './errors';
import { runFfmpeg } from './ffmpeg';
import { streamSeconds } from './suggest/media';

export const PALETTE_RULES = {
  /** Frames read from a take, spread over it, and the width each is read at. */
  frames: 8,
  width: 96,
  /** How far apart two chosen colours are at least (RGB distance, of 441). */
  apart: 70,
} as const;

type Rgb = [number, number, number];

const hex = (color: Rgb) => `#${color.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const luminance = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Up to `count` colours of RGBA pixels (alpha under 128 left out), dark to light: the clearest ones
 * the picture has much of (a colour weighs by how much of it there is and how strong it is, so the
 * accents of a grey interface win over its greys), each far enough from the others; at least two
 * (a picture of one colour gives it and a darker shade of it). Hex, upper case.
 */
export function paletteOf(rgba: Uint8Array, count = 4): string[] {
  // a histogram of 16 levels a channel, with each bin's mean colour
  const bins = new Map<number, { count: number; sum: Rgb }>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue;
    const [r, g, b] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { count: 0, sum: [0, 0, 0] };
    bin.count++;
    bin.sum[0] += r;
    bin.sum[1] += g;
    bin.sum[2] += b;
    bins.set(key, bin);
  }
  const colours = [...bins.values()].map((bin) => {
    const color: Rgb = [bin.sum[0] / bin.count, bin.sum[1] / bin.count, bin.sum[2] / bin.count];
    const chroma = (Math.max(...color) - Math.min(...color)) / 255;
    const light = (Math.max(...color) + Math.min(...color)) / 510;
    // near white or near black counts for less: a background wants colour
    const tone = light > 0.92 || light < 0.06 ? 0.25 : 1;
    return { color, count: bin.count, weight: bin.count * (0.08 + chroma) ** 2 * tone };
  });
  const chosen: Rgb[] = [];
  const take = (ordered: typeof colours, apart: number) => {
    for (const { color } of ordered) {
      if (chosen.length >= count) return;
      if (chosen.every((other) => distance(color, other) >= apart)) chosen.push(color);
    }
  };
  take([...colours].sort((a, b) => b.weight - a.weight), PALETTE_RULES.apart);
  // a picture of greys: its most common tones
  if (chosen.length < 2) take([...colours].sort((a, b) => b.count - a.count), 40);
  if (chosen.length === 0) throw new CoreError('invalid-media', 'the picture has no visible pixels to take colours from');
  if (chosen.length === 1) chosen.push(chosen[0]!.map((value) => value * 0.45) as Rgb);
  return chosen.sort((a, b) => luminance(a) - luminance(b)).map(hex);
}

/** The colours a take's screen shows, from frames spread over it. */
export async function takePalette(screen: string): Promise<string[]> {
  const seconds = await streamSeconds(screen, 'v');
  const { width, frames } = PALETTE_RULES;
  const sample = seconds > 0 ? ['-vf', `fps=${(frames / seconds).toFixed(6)},scale=${width}:-2`] : ['-frames:v', '1', '-vf', `scale=${width}:-2`];
  const { stdout } = await runFfmpeg(['-i', screen, ...sample, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-']);
  return paletteOf(new Uint8Array(stdout));
}

/** The colours of an image (a logo): its pixels, or, for an SVG, the colours it is written with. */
export async function imagePalette(path: string): Promise<string[]> {
  if (extname(path).toLowerCase() === '.svg') {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      throw new CoreError('missing-file', `cannot read ${path}: ${(error as Error).message}`, { cause: error });
    }
    // each colour it names, as a pixel (#rgb and #rrggbb)
    const pixels: number[] = [];
    for (const [, value] of text.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      const full = value!.length === 3 ? [...value!].map((digit) => digit + digit).join('') : value!;
      pixels.push(Number.parseInt(full.slice(0, 2), 16), Number.parseInt(full.slice(2, 4), 16), Number.parseInt(full.slice(4, 6), 16), 255);
    }
    if (pixels.length === 0) throw new CoreError('invalid-media', `${path} names no colours (#rrggbb) to take`);
    return paletteOf(new Uint8Array(pixels));
  }
  const { stdout } = await runFfmpeg(['-i', path, '-frames:v', '1', '-vf', `scale=${PALETTE_RULES.width}:-2`, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-']);
  return paletteOf(new Uint8Array(stdout));
}
```

- [ ] **Step 4: The wallpaper, a module per platform**

`packages/core/src/wallpaper-win32.ts`:

```ts
// Windows' wallpaper (see wallpaper.ts): the registry's (read only), else the copy Windows keeps.
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const isFile = (path: string) => stat(path).then((info) => info.isFile(), () => false);

/** The wallpaper's path in the output of `reg query "HKCU\Control Panel\Desktop" /v WallPaper`. */
export function parseRegWallpaper(stdout: string): string | undefined {
  const match = /^\s*WallPaper\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/im.exec(stdout);
  return match?.[1]?.trim() || undefined;
}

/** Windows: the registry's wallpaper, else the copy Windows keeps of it (a slideshow's, or one set from a photo). */
export async function windowsWallpaper(): Promise<string | undefined> {
  const named = await run('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], { windowsHide: true }).then(
    ({ stdout }) => parseRegWallpaper(stdout),
    () => undefined,
  );
  if (named && (await isFile(named))) return named;
  const copy = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
  return process.env.APPDATA && (await isFile(copy)) ? copy : undefined;
}
```

`packages/core/src/wallpaper-darwin.ts`:

```ts
// macOS's wallpaper (see wallpaper.ts): the main display's desktop picture, by AppleScript.
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const isFile = (path: string) => stat(path).then((info) => info.isFile(), () => false);

/** macOS: the main display's desktop picture. */
export async function macWallpaper(): Promise<string | undefined> {
  const path = await run('osascript', ['-e', 'tell application "System Events" to get picture of current desktop']).then(
    ({ stdout }) => stdout.trim(),
    () => '',
  );
  return path && (await isFile(path)) ? path : undefined;
}
```

`packages/core/src/wallpaper.ts`:

```ts
// The desktop's wallpaper as a background (`cuttle background --wallpaper`, the Look tab's "Your
// wallpaper"): where each system keeps it. `CUTTLE_WALLPAPER` names a file instead (the checks
// never read the computer's own).
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { CoreError } from './errors';
import { keepInProject } from './keep-file';
import { macWallpaper } from './wallpaper-darwin';
import { windowsWallpaper } from './wallpaper-win32';

/** The wallpaper's file: `CUTTLE_WALLPAPER`, else the system's; none where it cannot be found. */
export async function wallpaperFile(): Promise<string | undefined> {
  if (process.env.CUTTLE_WALLPAPER) return process.env.CUTTLE_WALLPAPER;
  if (process.platform === 'win32') return windowsWallpaper();
  if (process.platform === 'darwin') return macWallpaper();
  return undefined;
}

/** An image's extension by its first bytes (Windows' copy of the wallpaper has none). */
function imageExtension(bytes: Buffer, path: string): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return '.png';
  if (bytes.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return extname(path).toLowerCase();
}

/** Copies the wallpaper into the project's `images/` as `wallpaper.<ext>`; returns its project path. */
export async function importWallpaper(projectDir: string): Promise<string> {
  const file = await wallpaperFile();
  if (!file) throw new CoreError('missing-file', 'no wallpaper was found on this computer: choose an image instead');
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    throw new CoreError('missing-file', `cannot read the wallpaper ${file}: ${(error as Error).message}`, { cause: error });
  }
  const ext = imageExtension(bytes, file);
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) throw new CoreError('invalid-media', `the wallpaper (${file}) is not a JPEG, PNG or WebP image: choose an image instead`);
  return keepInProject(projectDir, bytes, 'images', 'wallpaper', ext);
}
```

In `packages/core/src/index.ts`, replace:

```ts
// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, run ffmpeg, transcribe the mic (the speech models, whisper, the speech edits), and keep brand kits.
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
```

with:

```ts
// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, run ffmpeg, transcribe the mic (the speech models, whisper, the speech edits), keep brand kits,
// and read a product's colours and the desktop's wallpaper for a background.
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
```

In the same file, replace:

```ts
export { NOTIFICATION_RULES, notificationMasks, type NotificationMask } from './privacy/notifications';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
export { BRAND_FILE, PROJECT_BRAND_DIR, applyBrand, brandFields, brandSlug, brandsDir, findBrand, listBrands, removeBrand, saveBrand, type Brand, type BrandFields } from './brands';
```

with:

```ts
export { NOTIFICATION_RULES, notificationMasks, type NotificationMask } from './privacy/notifications';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
export { BRAND_FILE, PROJECT_BRAND_DIR, applyBrand, brandFields, brandSlug, brandsDir, findBrand, listBrands, removeBrand, saveBrand, type Brand, type BrandFields } from './brands';
export { keepInProject } from './keep-file';
export { PALETTE_RULES, imagePalette, paletteOf, takePalette } from './palette';
export { importWallpaper, wallpaperFile } from './wallpaper';
export { parseRegWallpaper } from './wallpaper-win32';
```

- [ ] **Step 5: The command**

`apps/cli/src/commands/background.ts`:

```ts
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { imagePalette, importWallpaper, keepInProject, readProjectFile, takePalette, writeProjectFile, type ProjectFile } from '@cuttle/core';
import { BACKGROUND_PRESETS, isColouredBackground, switchBackground, type BackgroundPreset } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';

/** How soft a wallpaper is made when nothing says otherwise: it sits behind the window. */
const WALLPAPER_BLUR = 0.6;

export interface BackgroundArgs {
  colors?: string;
  from?: string;
  angle?: number;
  radial?: boolean;
  linear?: boolean;
  color?: string;
  image?: string;
  wallpaper?: boolean;
  blur?: number;
  dim?: number;
}

const isFile = (path: string) => stat(path).then((info) => info.isFile(), () => false);

/** An image as a project path: one inside the project as it is, one outside copied into images/. */
async function projectImage(file: ProjectFile, given: string): Promise<string> {
  const path = resolve(given);
  if (!(await isFile(path))) throw new CliError('missing-file', `no image at ${given}`);
  const rel = relative(file.dir, path);
  if (rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)) return rel.split(sep).join('/');
  const stem = basename(path, extname(path)).replace(/[^\w.-]+/g, '-') || 'image';
  return keepInProject(file.dir, await readFile(path), 'images', stem, extname(path).toLowerCase());
}

/** The colours of the take, the brand's logo, or an image file. */
async function paletteFrom(file: ProjectFile, from: string): Promise<string[]> {
  if (from === 'take') {
    const screen = resolve(file.dir, file.project.sources.screen);
    if (!(await isFile(screen))) throw new CliError('missing-file', `the take's screen recording is not there (${file.project.sources.screen}): record a take, or name an image`);
    return takePalette(screen);
  }
  if (from === 'logo') {
    if (!file.project.theme.logo) throw new CliError('usage', 'the project has no logo (theme.logo): set one, or name an image');
    return imagePalette(resolve(file.dir, file.project.theme.logo));
  }
  if (!(await isFile(resolve(from)))) throw new CliError('missing-file', `--from ${from}: not "take", "logo" or an image file`);
  return imagePalette(resolve(from));
}

/**
 * `cuttle background [preset]`: the background behind the window. A preset by name, a gradient of
 * colours given or read off the product (`--from take|logo|<image>`), an image or the desktop's
 * wallpaper, softened (`--blur`) and darkened (`--dim`). Options without a preset choose one: colours
 * a gradient (unless the background takes colours already), an image or the wallpaper the image.
 */
export async function backgroundCommand(projectDir: string, preset: string | undefined, args: BackgroundArgs, output: Output): Promise<{ background: Record<string, unknown> }> {
  if (preset !== undefined && !(BACKGROUND_PRESETS as readonly string[]).includes(preset)) {
    throw new CliError('usage', `no background "${preset}" (${BACKGROUND_PRESETS.join(', ')})`);
  }
  if (args.radial && args.linear) throw new CliError('usage', '--radial and --linear together');
  if (args.image && args.wallpaper) throw new CliError('usage', '--image and --wallpaper together');
  if (args.colors && args.from) throw new CliError('usage', '--colors and --from together');
  const file = await readProjectFile(projectDir);
  const current = file.project.look.background;
  const target = (preset ??
    (args.image || args.wallpaper ? 'image' : args.color ? 'solid' : (args.colors || args.from) && !isColouredBackground(current.preset) ? 'gradient' : current.preset)) as BackgroundPreset;
  // the fields the new preset reads stay (a gradient's colours become the flow's)
  const background = switchBackground(current, target);
  if (args.color !== undefined) background.color = args.color;
  if (args.colors !== undefined) background.colors = args.colors.split(',').map((color) => color.trim());
  if (args.from !== undefined) background.colors = await paletteFrom(file, args.from);
  if (args.angle !== undefined) background.angle = args.angle;
  if (args.radial) background.kind = 'radial';
  if (args.linear) delete background.kind;
  if (args.image !== undefined) background.image = await projectImage(file, args.image);
  if (args.wallpaper) {
    background.image = await importWallpaper(file.dir);
    background.blur ??= WALLPAPER_BLUR;
  }
  if (args.blur !== undefined) background.blur = args.blur;
  if (args.dim !== undefined) background.dim = args.dim;
  const look = file.raw.look && typeof file.raw.look === 'object' ? (file.raw.look as Record<string, unknown>) : {};
  file.raw.look = { ...look, background };
  await writeProjectFile(file, 'background');
  output.result({ background }, () => `the background: ${JSON.stringify(background)}`);
  return { background };
}
```

In `apps/cli/src/main.ts`, replace:

```ts
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { brandApplyCommand, brandListCommand, brandRemoveCommand, brandSaveCommand } from './commands/brand';
import { capturePageCommand } from './commands/capture-page';
import { devices } from './commands/devices';
```

with:

```ts
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { backgroundCommand, type BackgroundArgs } from './commands/background';
import { brandApplyCommand, brandListCommand, brandRemoveCommand, brandSaveCommand } from './commands/brand';
import { capturePageCommand } from './commands/capture-page';
import { devices } from './commands/devices';
```

In the same file, replace:

```ts
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new InvalidArgumentError('expected a number from 0 to 1');
  return parsed;
};
const decibels = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 40) throw new InvalidArgumentError('expected decibels from 0 to 40');
```

with:

```ts
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new InvalidArgumentError('expected a number from 0 to 1');
  return parsed;
};
const degrees = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 360) throw new InvalidArgumentError('expected degrees from 0 to 360');
  return parsed;
};
const decibels = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 40) throw new InvalidArgumentError('expected decibels from 0 to 40');
```

In the same file, replace:

```ts
    .option('-o, --out <dir>', 'folder for music.wav and music.png (default: preview/ in the project)')
    .action(action((output, project, options: { src?: string; out?: string }) => withSignal(output, (signal) => musicCheckCommand(project, options, output, signal))));

  const brand = program.command('brand').description('brand kits: a project\'s theme (name, URL, logo, colours, heading font), background, frame and cursor, saved once and applied with one command');
  brand
    .command('list', { isDefault: true })
```

with:

```ts
    .option('-o, --out <dir>', 'folder for music.wav and music.png (default: preview/ in the project)')
    .action(action((output, project, options: { src?: string; out?: string }) => withSignal(output, (signal) => musicCheckCommand(project, options, output, signal))));

  program
    .command('background')
    .argument('[preset]', 'sunset-sky, aurora, mesh, solid, image, gradient, flow, bokeh or dots (default: the one it has, or what the options ask for)')
    .description('the background behind the window: a preset, a gradient of your colours or the product\'s, an image or the desktop\'s wallpaper, softened and darkened')
    .option('--colors <list>', 'colours, comma-separated: a gradient\'s stops (2 to 4), or the tints of mesh, flow, bokeh and dots')
    .option('--from <source>', 'the colours read off "take" (the screen recording), "logo" (the brand\'s) or an image file')
    .option('--angle <degrees>', 'a gradient\'s direction: 0 to the top, 90 to the right (default 135)', degrees)
    .option('--radial', 'a gradient from the centre out')
    .option('--linear', 'a gradient along its angle (the default)')
    .option('--color <hex>', 'the solid background\'s colour')
    .option('--image <file>', 'an image (copied into images/ when it is outside the project)')
    .option('--wallpaper', 'the desktop\'s wallpaper as the image, softened (copied into images/)')
    .option('--blur <0-1>', 'how soft the image is: 0 sharp, 1 a wash of its colours', fraction)
    .option('--dim <0-0.8>', 'how much darker the image is', fraction)
    .action(action((output, project, preset: string | undefined, options: BackgroundArgs) => backgroundCommand(project, preset, options, output)));

  const brand = program.command('brand').description('brand kits: a project\'s theme (name, URL, logo, colours, heading font), background, frame and cursor, saved once and applied with one command');
  brand
    .command('list', { isDefault: true })
```

Run: `pnpm exec vitest run --project node packages/core apps/cli/test/background.test.ts apps/cli/test/brand.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core apps/cli
git commit -m "core, cli: the clearest colours of a take, a logo or an image; the desktop's wallpaper; cuttle background

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Look tab's Background part

**Files:**
- Create: `apps/desktop/src/main/background.ts`, `apps/desktop/src/renderer/editor/background.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/shared/names.ts`, `apps/desktop/src/main/brands.ts`, `apps/desktop/src/main/windows.ts`, `apps/desktop/src/renderer/editor/Inspector.tsx`, `apps/desktop/src/renderer/editor/editor.css`

- [ ] **Step 1: The requests and the names**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
export interface BrandView {
  name: string;
  accent: string;
  background: { preset: string; color?: string };
  font: string;
}
```

with:

```ts
export interface BrandView {
  name: string;
  accent: string;
  background: { preset: string; color?: string; colors?: string[] };
  font: string;
}
```

In the same file, replace:

```ts
  /** Copies a kit's files into the project and answers what applying it sets (the page makes it one edit). */
  'brand:apply': z.string().trim().min(1).max(80),
  'brand:remove': z.string().trim().min(1).max(80),
  'project:draft': z.strictObject({ raw: z.record(z.string(), z.unknown()) }).refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  /** The page asks to be loaded anew (another take): a page cannot reload itself (navigation is refused). */
  'project:reload': z.undefined(),
```

with:

```ts
  /** Copies a kit's files into the project and answers what applying it sets (the page makes it one edit). */
  'brand:apply': z.string().trim().min(1).max(80),
  'brand:remove': z.string().trim().min(1).max(80),
  /** The colours of the take's screen or of the brand's logo, for the background. */
  'background:palette': z.strictObject({ from: z.enum(['take', 'logo']), logo: z.string().min(1).max(4096).optional() }),
  /** The desktop's wallpaper, copied into the project's images/ for the background. */
  'background:wallpaper': z.undefined(),
  'project:draft': z.strictObject({ raw: z.record(z.string(), z.unknown()) }).refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  /** The page asks to be loaded anew (another take): a page cannot reload itself (navigation is refused). */
  'project:reload': z.undefined(),
```

In the same file, replace:

```ts
  'brand:save': { brands: BrandView[] } | { problem: string };
  'brand:apply': BrandApplied | { problem: string };
  'brand:remove': { brands: BrandView[] } | { problem: string };
  /** The person's version a save conflict could not carry over, written to cuttle.json.draft. */
  'project:draft': void;
  'project:reload': void;
```

with:

```ts
  'brand:save': { brands: BrandView[] } | { problem: string };
  'brand:apply': BrandApplied | { problem: string };
  'brand:remove': { brands: BrandView[] } | { problem: string };
  'background:palette': { colors: string[] } | { problem: string };
  /** The wallpaper's path in the project, or why there is none. */
  'background:wallpaper': { path: string } | { problem: string };
  /** The person's version a save conflict could not carry over, written to cuttle.json.draft. */
  'project:draft': void;
  'project:reload': void;
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
      'brand:save',
      'brand:apply',
      'brand:remove',
      'project:draft',
      'project:reload',
      'project:closed',
```

with:

```ts
      'brand:save',
      'brand:apply',
      'brand:remove',
      'background:palette',
      'background:wallpaper',
      'project:draft',
      'project:reload',
      'project:closed',
```

In `apps/desktop/src/shared/names.ts`, replace:

```ts

type Names<T extends readonly string[]> = Record<T[number], string>;

export const BACKGROUND_NAMES: Names<typeof BACKGROUND_PRESETS> = { 'sunset-sky': 'Sunset sky', aurora: 'Aurora', mesh: 'Mesh', solid: 'Solid colour', image: 'Image' };
export const FRAME_NAMES: Names<typeof FRAME_STYLES> = { 'mac-dark': 'Mac, dark', 'mac-light': 'Mac, light', 'browser-light': 'Browser, light', none: 'No title bar' };
export const CURSOR_NAMES: Names<typeof CURSOR_STYLES> = {
  system: 'System',
```

with:

```ts

type Names<T extends readonly string[]> = Record<T[number], string>;

export const BACKGROUND_NAMES: Names<typeof BACKGROUND_PRESETS> = {
  'sunset-sky': 'Sunset sky',
  aurora: 'Aurora',
  mesh: 'Mesh',
  solid: 'Solid colour',
  image: 'Image',
  gradient: 'Gradient',
  flow: 'Flow',
  bokeh: 'Bokeh',
  dots: 'Dots',
};
export const FRAME_NAMES: Names<typeof FRAME_STYLES> = { 'mac-dark': 'Mac, dark', 'mac-light': 'Mac, light', 'browser-light': 'Browser, light', none: 'No title bar' };
export const CURSOR_NAMES: Names<typeof CURSOR_STYLES> = {
  system: 'System',
```

- [ ] **Step 2: The main process**

`apps/desktop/src/main/background.ts`:

```ts
// The background's helpers for the editor: the colours of the take's screen or of the brand's
// logo, and the desktop's wallpaper copied into the project.
import { resolve } from 'node:path';
import { CoreError, imagePalette, importWallpaper, readProjectFile, takePalette } from '@cuttle/core';
import { isInside } from '../shared/media-path';
import { CHECK } from './check';

/** A failure the person can act on, as the page shows it. */
const problem = (error: unknown): { problem: string } => {
  if (error instanceof CoreError) return { problem: error.message };
  throw error;
};

/** The colours of the take's screen, or of the logo (the page's path to it, in the project). */
export async function backgroundPalette(dir: string, from: 'take' | 'logo', logo?: string): Promise<{ colors: string[] } | { problem: string }> {
  try {
    if (from === 'logo') {
      const path = logo === undefined ? undefined : resolve(dir, logo);
      if (!path || !isInside(path, dir, process.platform)) return { problem: 'The brand has no logo in the project: choose one under Brand first.' };
      return { colors: await imagePalette(path) };
    }
    const { project } = await readProjectFile(dir);
    return { colors: await takePalette(resolve(dir, project.sources.screen)) };
  } catch (error) {
    return problem(error);
  }
}

/** The desktop's wallpaper, copied into the project; the check gives one of its own (never this computer's). */
export async function projectWallpaper(dir: string): Promise<{ path: string } | { problem: string }> {
  if (CHECK && !process.env.CUTTLE_WALLPAPER) throw new Error('the check sets no CUTTLE_WALLPAPER');
  try {
    return { path: await importWallpaper(dir) };
  } catch (error) {
    return problem(error);
  }
}
```

In `apps/desktop/src/main/brands.ts`, replace:

```ts
const view = ({ kit }: Brand): BrandView => ({
  name: kit.name,
  accent: kit.theme.accent ?? kit.look.cursor.color,
  background: { preset: kit.look.background.preset, ...(kit.look.background.color && { color: kit.look.background.color }) },
  font: kit.theme.font,
});
```

with:

```ts
const view = ({ kit }: Brand): BrandView => ({
  name: kit.name,
  accent: kit.theme.accent ?? kit.look.cursor.color,
  background: { preset: kit.look.background.preset, ...(kit.look.background.color && { color: kit.look.background.color }), ...(kit.look.background.colors && { colors: kit.look.background.colors }) },
  font: kit.theme.font,
});
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
import { isInside } from '../shared/media-path';
import { takeKey } from '../shared/take';
import { CHECK, CHECK_IMAGE, HIDDEN } from './check';
import { applyProjectBrand, brandViews, removeProjectBrand, saveProjectBrand } from './brands';
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
```

with:

```ts
import { isInside } from '../shared/media-path';
import { takeKey } from '../shared/take';
import { CHECK, CHECK_IMAGE, HIDDEN } from './check';
import { backgroundPalette, projectWallpaper } from './background';
import { applyProjectBrand, brandViews, removeProjectBrand, saveProjectBrand } from './brands';
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
```

In the same file, replace:

```ts
    'brand:save': ({ name, raw }) => saveProjectBrand(dir, name, raw),
    'brand:apply': (name) => applyProjectBrand(dir, name),
    'brand:remove': (name) => removeProjectBrand(name),
  });
  editor.watch.start(file.hash);
  contents.on('did-finish-load', () => send(contents, 'project:status', editor.status ?? {}));
```

with:

```ts
    'brand:save': ({ name, raw }) => saveProjectBrand(dir, name, raw),
    'brand:apply': (name) => applyProjectBrand(dir, name),
    'brand:remove': (name) => removeProjectBrand(name),
    'background:palette': ({ from, logo }) => backgroundPalette(dir, from, logo),
    'background:wallpaper': () => projectWallpaper(dir),
  });
  editor.watch.start(file.hash);
  contents.on('did-finish-load', () => send(contents, 'project:status', editor.status ?? {}));
```

- [ ] **Step 3: The actions and the panel**

`apps/desktop/src/renderer/editor/background.ts`:

```ts
// The background's actions in the editor: another preset (what it reads kept), colours read off the
// take or the brand's logo, the desktop's wallpaper; each one step to undo.
import { isColouredBackground, switchBackground, type BackgroundPreset } from '@cuttle/project';
import { BACKGROUND_NAMES } from '../../shared/names';
import { bridge } from '../bridge';
import { edit, toast } from './doc';
import { documentProject } from './session';

/** How soft the wallpaper is made when the image has no softness yet: it sits behind the window. */
export const WALLPAPER_BLUR = 0.6;

const setBackground = (value: Record<string, unknown>, label: string) => edit([{ type: 'look', path: ['background'], value }], label);

/** Another preset (an image is chosen with `chooseImage`), keeping what it reads. */
export function switchTo(preset: Exclude<BackgroundPreset, 'image'>): void {
  const current = documentProject()?.look.background;
  if (current) setBackground(switchBackground(current, preset), `Background: ${BACKGROUND_NAMES[preset]}`);
}

/** The colours of the take's screen or of the brand's logo: a gradient, unless the background takes colours already. */
export async function colorsFrom(from: 'take' | 'logo'): Promise<void> {
  const project = documentProject();
  if (!project) return;
  const result = await bridge.invoke('background:palette', { from, ...(from === 'logo' && project.theme.logo && { logo: project.theme.logo }) });
  if ('problem' in result) return toast(result.problem, { tone: 'warning' });
  const current = documentProject()?.look.background ?? project.look.background;
  const preset = isColouredBackground(current.preset) ? current.preset : 'gradient';
  setBackground({ ...switchBackground(current, preset), colors: result.colors }, from === 'take' ? 'Background: colours of the take' : 'Background: colours of the logo');
}

/** The desktop's wallpaper behind the window, softened (as soft as the image was, if it was). */
export async function wallpaperBehind(): Promise<void> {
  const result = await bridge.invoke('background:wallpaper');
  if ('problem' in result) return toast(result.problem, { tone: 'warning' });
  const current = documentProject()?.look.background;
  const image = current?.preset === 'image' ? current : undefined;
  setBackground({ preset: 'image', image: result.path, blur: image?.blur ?? WALLPAPER_BLUR, ...(image?.dim !== undefined && { dim: image.dim }) }, 'Background: your wallpaper');
}
```

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```tsx
// left or Enter is pressed (text also every 2 s while typing); each save is one step to undo.
// Output times read m:ss.t, take seconds "54.4 s into the take", lengths "2.5 s". While cuttle.json
// does not parse, every field is off (editing waits).
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import {
  BACKGROUND_PRESETS,
```

with:

```tsx
// left or Enter is pressed (text also every 2 s while typing); each save is one step to undo.
// Output times read m:ss.t, take seconds "54.4 s into the take", lengths "2.5 s". While cuttle.json
// does not parse, every field is off (editing waits).
import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import {
  BACKGROUND_PRESETS,
```

In the same file, replace:

```tsx
  type Music,
  type Rect,
  type ThemeFont,
  backgroundTone,
} from '@cuttle/project';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { sceneSpans, type SceneSpan } from '@cuttle/timeline';
```

with:

```tsx
  type Music,
  type Rect,
  type ThemeFont,
  backgroundColors,
  backgroundTone,
  isColouredBackground,
  SOLID_DEFAULT,
} from '@cuttle/project';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { sceneSpans, type SceneSpan } from '@cuttle/timeline';
```

In the same file, replace:

```tsx
import { PrivacyNote } from './PrivacyNote';
import { SpeechNote, TranscriptPanel } from './Transcript';
import { applyBrandKit, removeBrandKit, saveBrandKit } from './brand';

const TABS = [
  { id: 'selection', name: 'Selection' },
```

with:

```tsx
import { PrivacyNote } from './PrivacyNote';
import { SpeechNote, TranscriptPanel } from './Transcript';
import { applyBrandKit, removeBrandKit, saveBrandKit } from './brand';
import { colorsFrom, switchTo, wallpaperBehind } from './background';

const TABS = [
  { id: 'selection', name: 'Selection' },
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
 * The swatch of the current gradient or mesh in its own colours (a gradient as laid out); the
 * others keep their picture.
 */
function swatchStyle(background: CuttleProject['look']['background'], preset: (typeof BACKGROUND_PRESETS)[number]): CSSProperties | undefined {
  if ((preset !== 'gradient' && preset !== 'mesh') || !background.colors || background.preset !== preset) return undefined;
  const stops = background.colors.join(', ');
  if (preset === 'mesh') return { backgroundImage: `linear-gradient(135deg in oklab, ${stops})` };
  return { backgroundImage: background.kind === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${background.angle ?? 135}deg in oklab, ${stops})` };
}

/**
 * The colours of a gradient (its stops, first to last) or the tints of mesh, flow, bokeh and dots:
 * a well each (2 to 4, one more with +, one fewer with its ×), and the colours of the take's screen
 * or of the brand's logo with a click.
 */
function BackgroundColors({ background, logo }: { background: CuttleProject['look']['background']; logo: boolean }) {
  const colors = [...backgroundColors(background)];
  const setColors = (next: string[], label: string) => look(['background', 'colors'], next, label);
  return (
    <>
      <Row label={background.preset === 'gradient' ? 'Colours, first to last' : 'Colours'} plain note={background.colors ? undefined : 'its own'}>
        <span className="color-stops" data-testid="bg-colors">
          {colors.map((color, i) => (
            <span key={i} className="color-stop">
              <ColorInput value={color} label={`Colour ${i + 1}`} upper toCommand={(value) => ({ type: 'look', path: ['background', 'colors'], value: colors.map((other, j) => (j === i ? value : other)) }) as Command} />
              {colors.length > 2 && (
                <button type="button" className="stop-remove" aria-label={`Remove colour ${i + 1}`} title="Remove this colour" onClick={() => setColors(colors.filter((_, j) => j !== i), 'Background: a colour fewer')}>
                  <CloseIcon size={9} />
                </button>
              )}
            </span>
          ))}
          {colors.length < 4 && (
            <button type="button" className="ghost small stop-add" aria-label="Add a colour" title="Add a colour" onClick={() => setColors([...colors, colors.at(-1)!], 'Background: a colour more')} data-testid="bg-color-add">
              +
            </button>
          )}
        </span>
      </Row>
      <Row label="Take colours from" plain>
        <button type="button" className="ghost small" title="The clearest colours the take shows" onClick={() => void colorsFrom('take')} data-testid="bg-from-take">
          The take
        </button>
        <button type="button" className="ghost small" disabled={!logo} title={logo ? undefined : 'Choose a logo under Brand first'} onClick={() => void colorsFrom('logo')} data-testid="bg-from-logo">
          The logo
        </button>
      </Row>
    </>
  );
}

/** What each heading font is like, in the font list. */
const FONT_NOTES: Record<ThemeFont, string> = {
  Archivo: 'wide, bold',
```

In the same file, replace:

```tsx
  const theme = project.theme;
  const summaries: Record<LookSection, string> = {
    brand: theme.kit ? `Kit · ${theme.kit}` : [theme.name, theme.font !== 'Archivo' && theme.font].filter(Boolean).join(' · ') || 'None set',
    background: current.background.preset === 'solid' ? `Solid · ${(current.background.color ?? '#1c1c22').toUpperCase()}` : BACKGROUND_NAMES[current.background.preset],
    window: current.frame.enabled ? [FRAME_NAMES[current.frame.style], current.frame.title].filter(Boolean).join(' · ') : 'No frame',
    cursor: current.cursor.enabled ? `${CURSOR_NAMES[current.cursor.style]} · ${current.cursor.size}×` : 'Hidden',
    camera: !sources.webcam
```

with:

```tsx
  const theme = project.theme;
  const summaries: Record<LookSection, string> = {
    brand: theme.kit ? `Kit · ${theme.kit}` : [theme.name, theme.font !== 'Archivo' && theme.font].filter(Boolean).join(' · ') || 'None set',
    background:
      current.background.preset === 'solid'
        ? `Solid · ${(current.background.color ?? SOLID_DEFAULT).toUpperCase()}`
        : current.background.preset === 'image'
          ? ['Image', current.background.blur && 'soft', current.background.dim && 'darker'].filter(Boolean).join(' · ')
          : current.background.preset === 'gradient'
            ? `Gradient · ${current.background.colors?.length ?? 2} colours${current.background.kind === 'radial' ? ' · radial' : ''}`
            : `${BACKGROUND_NAMES[current.background.preset]}${current.background.colors ? ' · your colours' : ''}`,
    window: current.frame.enabled ? [FRAME_NAMES[current.frame.style], current.frame.title].filter(Boolean).join(' · ') : 'No frame',
    cursor: current.cursor.enabled ? `${CURSOR_NAMES[current.cursor.style]} · ${current.cursor.size}×` : 'Hidden',
    camera: !sources.webcam
```

In the same file, replace:

```tsx
              className={`swatch-button bg-${preset}`}
              aria-pressed={current.background.preset === preset}
              title={BACKGROUND_NAMES[preset]}
              onClick={() => {
                if (preset === 'image') return void chooseImage('background');
                look(['background'], preset === 'solid' ? { preset, color: current.background.color ?? '#1c1c22' } : { preset }, `Background: ${BACKGROUND_NAMES[preset]}`);
              }}
            >
              <span>{BACKGROUND_NAMES[preset]}</span>
            </button>
```

with:

```tsx
              className={`swatch-button bg-${preset}`}
              aria-pressed={current.background.preset === preset}
              title={BACKGROUND_NAMES[preset]}
              style={swatchStyle(current.background, preset)}
              onClick={() => (preset === 'image' ? void chooseImage('background') : switchTo(preset))}
              data-testid={`bg-${preset}`}
            >
              <span>{BACKGROUND_NAMES[preset]}</span>
            </button>
```

In the same file, replace:

```tsx
        </div>
        {current.background.preset === 'solid' && (
          <Row label="Colour">
            <ColorInput value={current.background.color ?? '#1c1c22'} path={['background', 'color']} label="Background colour" />
          </Row>
        )}
        {current.background.preset === 'image' && current.background.image && (
          <Row label="Image" plain>
            <span className="path" title={current.background.image}>
              {current.background.image}
            </span>
            <button type="button" className="ghost small" onClick={() => void chooseImage('background')}>
              Replace…
            </button>
          </Row>
        )}
      </LookPart>

      <LookPart id="window" summary={summaries.window}>
```

with:

```tsx
        </div>
        {current.background.preset === 'solid' && (
          <Row label="Colour">
            <ColorInput value={current.background.color ?? SOLID_DEFAULT} path={['background', 'color']} label="Background colour" />
          </Row>
        )}
        {current.background.preset === 'image' && current.background.image && (
          <>
            <Row label="Image" plain>
              <span className="path" title={current.background.image}>
                {current.background.image}
              </span>
              <button type="button" className="ghost small" onClick={() => void chooseImage('background')}>
                Replace…
              </button>
            </Row>
            <div className="grid2">
              <Row label={`Soft · ${Math.round((current.background.blur ?? 0) * 100)} %`}>
                <RangeInput
                  value={Math.round((current.background.blur ?? 0) * 100)}
                  min={0}
                  max={100}
                  label="How soft the image is"
                  toCommand={(value) => ({ type: 'look', path: ['background', 'blur'], value: value > 0 ? value / 100 : undefined }) as Command}
                  commitLabel="Background softness"
                  testId="bg-blur"
                />
              </Row>
              <Row label={`Darker · ${Math.round((current.background.dim ?? 0) * 100)} %`}>
                <RangeInput
                  value={Math.round((current.background.dim ?? 0) * 100)}
                  min={0}
                  max={80}
                  label="How much darker the image is"
                  toCommand={(value) => ({ type: 'look', path: ['background', 'dim'], value: value > 0 ? value / 100 : undefined }) as Command}
                  commitLabel="Background darker"
                  testId="bg-dim"
                />
              </Row>
            </div>
          </>
        )}
        {isColouredBackground(current.background.preset) && <BackgroundColors background={current.background} logo={Boolean(project.theme.logo)} />}
        {current.background.preset === 'gradient' && (
          <div className="grid2">
            <Row label="Angle (°)" note={current.background.kind === 'radial' ? 'radial: none' : undefined}>
              <NumberInput value={current.background.angle ?? 135} min={0} max={360} step={15} digits={0} onCommit={(angle) => look(['background', 'angle'], angle, 'Gradient angle')} testId="bg-angle" />
            </Row>
            <Row label="Shape" plain>
              <div className="seg" role="group" aria-label="Gradient shape">
                <button type="button" aria-pressed={current.background.kind !== 'radial'} onClick={() => look(['background', 'kind'], undefined, 'Gradient: linear')}>
                  Linear
                </button>
                <button type="button" aria-pressed={current.background.kind === 'radial'} onClick={() => look(['background', 'kind'], 'radial', 'Gradient: radial')} data-testid="bg-radial">
                  Radial
                </button>
              </div>
            </Row>
          </div>
        )}
        <Row label="Your desktop" plain>
          <button type="button" className="ghost small" title="The desktop's wallpaper behind the window, softened" onClick={() => void wallpaperBehind()} data-testid="bg-wallpaper">
            Use its wallpaper
          </button>
        </Row>
      </LookPart>

      <LookPart id="window" summary={summaries.window}>
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```css
.bg-image {
  background: repeating-linear-gradient(45deg, var(--raised) 0 6px, var(--raised-hover) 6px 12px);
}
.path {
  flex: 1;
  min-width: 0;
```

with:

```css
.bg-image {
  background: repeating-linear-gradient(45deg, var(--raised) 0 6px, var(--raised-hover) 6px 12px);
}
.bg-gradient {
  background: linear-gradient(135deg in oklab, #7c5cff, #ff7ab6);
}
.bg-flow {
  background:
    radial-gradient(ellipse at 30% 40%, #d6457f 0, transparent 55%),
    radial-gradient(ellipse at 78% 72%, #f3a55b 0, transparent 50%),
    radial-gradient(ellipse at 72% 18%, #5b3fc0 0, transparent 60%),
    #1a1446;
}
.bg-bokeh {
  background:
    radial-gradient(circle at 24% 30%, rgba(58, 109, 240, 0.6) 0 9%, transparent 10%),
    radial-gradient(circle at 68% 58%, rgba(164, 92, 240, 0.5) 0 13%, transparent 14%),
    radial-gradient(circle at 42% 82%, rgba(245, 107, 155, 0.45) 0 8%, transparent 9%),
    radial-gradient(circle at 86% 24%, rgba(245, 178, 107, 0.45) 0 6%, transparent 7%),
    linear-gradient(180deg, #111830, #070b1a);
}
.bg-dots {
  background:
    radial-gradient(circle at 40% 45%, rgba(124, 92, 255, 0.45), transparent 60%),
    radial-gradient(circle, rgba(255, 255, 255, 0.4) 0 0.8px, transparent 1.3px) 0 0 / 6px 6px,
    #0b0d12;
}
/* a coloured background's colours: a well each, a remove button on hover, + for one more */
.color-stops {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.color-stop {
  position: relative;
  display: inline-flex;
}
.stop-remove {
  position: absolute;
  top: -6px;
  right: -7px;
  width: 16px;
  height: 16px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--raised-hover);
  color: var(--muted);
  box-shadow: 0 0 0 1px var(--line-strong);
  opacity: 0;
  transition: opacity var(--fast);
}
.color-stop:hover .stop-remove,
.stop-remove:focus-visible {
  opacity: 1;
}
.stop-add {
  width: 28px;
  padding: 0;
  justify-content: center;
}
.path {
  flex: 1;
  min-width: 0;
```

- [ ] **Step 4: The typecheck and the contract**

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm exec vitest run --project node apps/desktop/test/contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "app: the Look tab's backgrounds: nine swatches, a gradient's colours, angle and shape, colours of the take or the logo, an image softened and darker, the desktop's wallpaper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The check and the guides

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`, `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`, `skill/test/skill.test.ts`

- [ ] **Step 1: The check**

A gradient picked in the Look tab, then in the take's colours, a stop more, an angle and radial; the check's wallpaper behind the window, softened and darker; flow, bokeh and dots: each drawn in the editor as `cuttle preview` draws it:

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    mkdirSync(join(root, 'user-data'));
    // The screen is read after a take's cut only where the check asks for it (it says so in the settings).
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects'), privacy: { read: false } }));
    // the logo the brand's file dialog picks
    writeFileSync(join(root, 'nimbus.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="28" fill="#7C5CFF"/><path d="M34 86V34h12l28 34V34h12v52H74L46 52v34z" fill="#fff"/></svg>');
    models = createServer((request, response) => {
```

with:

```ts
    mkdirSync(join(root, 'user-data'));
    // The screen is read after a take's cut only where the check asks for it (it says so in the settings).
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects'), privacy: { read: false } }));
    // the desktop's wallpaper the check gives the app
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720', '-frames:v', '1', join(root, 'wallpaper.png')], { windowsHide: true });
    // the logo the brand's file dialog picks
    writeFileSync(join(root, 'nimbus.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="28" fill="#7C5CFF"/><path d="M34 86V34h12l28 34V34h12v52H74L46 52v34z" fill="#fff"/></svg>');
    models = createServer((request, response) => {
```

In the same file, replace:

```ts
        // the brand kits in a folder of the check's own, and the image a file dialog picks
        CUTTLE_BRANDS_DIR: join(root, 'brands'),
        CUTTLE_CHECK_IMAGE: join(root, 'nimbus.svg'),
      },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
```

with:

```ts
        // the brand kits in a folder of the check's own, and the image a file dialog picks
        CUTTLE_BRANDS_DIR: join(root, 'brands'),
        CUTTLE_CHECK_IMAGE: join(root, 'nimbus.svg'),
        // the desktop's wallpaper, the check's own (never this computer's)
        CUTTLE_WALLPAPER: join(root, 'wallpaper.png'),
      },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
```

In the same file, replace:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'brand-second · Cuttle')?.close());
  }, 240_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

with:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'brand-second · Cuttle')?.close());
  }, 240_000);

  it('builds a gradient in the Look tab from the take’s colours, puts the desktop’s wallpaper behind the window, softened and darker, and draws the quiet ones as the export does', async () => {
    const dir = join(root, 'backgrounds');
    makeFixture(dir);
    const page = await openEditor(dir);
    await page.waitForFunction(() => '__cuttleCheck' in window);
    const seekTo = (t: number) => page.evaluate((time) => (window as unknown as Hooked).__cuttleCheck.seek(time), t);
    const view = async () => decode(await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.pixels()));
    type Background = { preset: string; colors?: string[]; angle?: number; kind?: string; image?: string; blur?: number; dim?: number };
    const saved = () => (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { look: { background: Background } }).look.background;
    /** The editor's frame at `t` against `cuttle preview`'s (the window over the background, in the first clip). */
    const asExported = async (t: number, name: string) => {
      await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
      const still = spawnSync('node', [CLI, '--json', '-C', dir, 'preview', '--at', String(t), '-o', join(root, `bg-${name}`)], { encoding: 'utf8', timeout: 120_000 });
      expect(still.status, still.stderr).toBe(0);
      const exported = PNG.sync.read(readFileSync((JSON.parse(still.stdout) as { stills: { file: string }[] }).stills[0]!.file));
      await expect.poll(async () => (await seekTo(t), difference(await view(), exported).mean), { timeout: 20_000, message: `${name}: the editor against the export` }).toBeLessThan(0.6);
    };
    const setRange = (testId: string, value: number) =>
      page.locator(`[data-testid=${testId}]`).evaluate((element, to) => {
        const input = element as HTMLInputElement;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(to));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    await click(page, '#tab-look');
    await click(page, '[data-testid=look-open-background]');

    // a gradient: its own colours first, then the take's, a third stop, an angle, then radial
    await click(page, '[data-testid=bg-gradient]');
    await expect.poll(saved).toEqual({ preset: 'gradient', colors: ['#7C5CFF', '#FF7AB6'] });
    await click(page, '[data-testid=bg-from-take]');
    await expect.poll(() => saved().colors, { timeout: 30_000 }).not.toEqual(['#7C5CFF', '#FF7AB6']);
    const taken = saved().colors!;
    expect(taken.length).toBeGreaterThanOrEqual(2);
    if (taken.length < 4) {
      await click(page, '[data-testid=bg-color-add]');
      await expect.poll(() => saved().colors?.length).toBe(taken.length + 1);
    }
    await page.fill('[data-testid=bg-angle]', '90');
    await page.press('[data-testid=bg-angle]', 'Enter');
    await expect.poll(() => saved().angle).toBe(90);
    await asExported(1, 'gradient');
    await shotOf('43-background-gradient', '/editor.html', 'backgrounds · Cuttle');
    await click(page, '[data-testid=bg-radial]');
    await expect.poll(() => saved().kind).toBe('radial');
    await asExported(1, 'radial');

    // the desktop's wallpaper (the check's own), softened; then darker
    await click(page, '[data-testid=bg-wallpaper]');
    await expect.poll(saved).toEqual({ preset: 'image', image: 'images/wallpaper.png', blur: 0.6 });
    expect(existsSync(join(dir, 'images', 'wallpaper.png'))).toBe(true);
    await page.waitForSelector('[data-testid=bg-dim]');
    await setRange('bg-dim', 30);
    await expect.poll(() => saved().dim).toBe(0.3);
    await asExported(1, 'wallpaper');
    await shotOf('43b-background-wallpaper', '/editor.html', 'backgrounds · Cuttle');

    // the quiet ones, each as the export draws it; flow in the gradient's colours (they stay)
    await click(page, '[data-testid=bg-flow]');
    await expect.poll(saved).toEqual({ preset: 'flow' });
    for (const preset of ['flow', 'bokeh', 'dots']) {
      await click(page, `[data-testid=bg-${preset}]`);
      await expect.poll(() => saved().preset).toBe(preset);
      await asExported(1, preset);
      if (preset === 'dots') await shotOf('43c-background-dots', '/editor.html', 'backgrounds · Cuttle');
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'backgrounds · Cuttle')?.close());
  }, 240_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

Run: `pnpm app:check`
Expected: PASS, 52 tests.

- [ ] **Step 2: The guides**

In `skill/cuttle/SKILL.md`, replace:

```markdown
  `cuttle -C "<project>" --json brand apply "<name>"`: the brand (name, URL, logo, colours, heading
  font) for the motion pages, the background, frame and cursor. Without one, set `theme` (project.md)
  and offer to keep it with `brand save`. Set `look.frame.title` (e.g. `claude · ~/demo`) and a
  background preset, and add a `texts` caption where a step is not obvious. Typing clicks softly, a click per key where the clip
  is heard (`look.audio.typing`, `typingVolume`); switch it off when the user wants a quiet video.
- **Pages.** `cuttle -C "<project>" --json capture-page <url or file> --scroll --add` appends a
  scrolling still of a web page (the result the agent built); add `--wait 2500` for slow maps or
```

with:

```markdown
  `cuttle -C "<project>" --json brand apply "<name>"`: the brand (name, URL, logo, colours, heading
  font) for the motion pages, the background, frame and cursor. Without one, set `theme` (project.md)
  and offer to keep it with `brand save`. Set `look.frame.title` (e.g. `claude · ~/demo`) and a
  background: `cuttle -C "<project>" --json background gradient --from take` takes the product's own
  colours, `background --wallpaper` puts the desktop's wallpaper behind the window, softened;
  `flow`, `bokeh` and `dots` move quietly. Add a `texts` caption where a step is not obvious. Typing clicks softly, a click per key where the clip
  is heard (`look.audio.typing`, `typingVolume`); switch it off when the user wants a quiet video.
- **Pages.** `cuttle -C "<project>" --json capture-page <url or file> --scroll --add` appends a
  scrolling still of a web page (the result the agent built); add `--wait 2500` for slow maps or
```

In `skill/cuttle/project.md`, replace:

```markdown

| Field | Values (default first) |
|---|---|
| `background.preset` | `sunset-sky`, `aurora`, `mesh`, `solid` (needs `color`, e.g. `"#0c0c0c"`), `image` (needs `image`: a path) |
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`, `squircle`, `square`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5), `position` (`{ x, y }`: the bubble's centre as a share of the video, 0–1; it replaces `corner`), `border` (`true`: a white ring), `shadow` (`true`), `mirror` (`false`: flipped left to right) |
```

with:

```markdown

| Field | Values (default first) |
|---|---|
| `background.preset` | `sunset-sky`, `aurora`, `mesh`, `solid` (needs `color`, e.g. `"#0c0c0c"`), `image` (needs `image`: a path; `blur` 0–1 softens it, `dim` 0–0.8 darkens it), `gradient` (needs `colors`: 2 to 4, first to last; `angle` as in CSS, `135` by default; `kind` `linear` or `radial`), and the quiet animated `flow`, `bokeh` and `dots`; `mesh`, `flow`, `bokeh` and `dots` take `colors` too (else their own) |
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`, `squircle`, `square`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5), `position` (`{ x, y }`: the bubble's centre as a share of the video, 0–1; it replaces `corner`), `border` (`true`: a white ring), `shadow` (`true`), `mirror` (`false`: flipped left to right) |
```

In `skill/test/skill.test.ts`, replace:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'motion new', 'motion templates', 'music new', 'music templates', 'music set', 'music check', 'sound add', 'sound list', 'brand list', 'brand save', 'brand apply', 'brand remove', 'init', 'render', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion', 'music', 'sound', 'brand'];
```

with:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'motion new', 'motion templates', 'music new', 'music templates', 'music set', 'music check', 'sound add', 'sound list', 'brand list', 'brand save', 'brand apply', 'brand remove', 'background', 'init', 'render', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion', 'music', 'sound', 'brand'];
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/app.check.test.ts skill
git commit -m "check the backgrounds in the app as the export draws them; the guides name them and cuttle background

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 895 passed and 72 skipped (where a speech model is found, its real transcription runs too: 896 and 71; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 14 tests.

Run: `pnpm app:check`
Expected: PASS, 52 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. In the Look tab, open Background and pick Gradient; click "The take" under "Take colours from": the gradient takes the take's colours. Add a colour, turn the angle, try Radial.
2. Click "Use its wallpaper": your desktop's wallpaper goes behind the window, softened; move Soft and Darker.
3. Pick Flow, Bokeh and Dots, and play: they move, quietly.
4. On a Mac: "Use its wallpaper" reads the desktop picture through AppleScript (not run from here).

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run (the macOS wallpaper module included).

**Found while checking, and already in the plan above**
- **Flow was too busy at first:** five octaves of noise, warped hard, looked like marble; three octaves, larger and slower, each turned against the last, are the soft folds it is now.
- **The image's blur** reached 8 % of the short side at first, too little for a wallpaper's wash; it reaches 16 % now.
- **A measure of detail** counted the dither's noise; the blur's test counts hard edges instead, and a sharp image is not dithered at all (as before).
- **The Oklab middle of red and blue** is (140, 83, 163): the test asks for its lightness and hue, not for little green.
- **Two notes in the panel were cut off**; the rows say it in their labels and tooltips now.

**Flaky, and not this milestone's** (nothing here touches the recorder)
- **The recorder's pause test** took 5.56 s (it allows 5.5) in one of the two full `pnpm test` runs, under load, as seen on `main` before; the other run passed it.

**Spec points that move**
- None. Next: **P5-M2c** (device frames and the watermark).

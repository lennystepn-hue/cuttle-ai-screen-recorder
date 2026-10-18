# Cuttle P5-M2a: Theme and Brand Kits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One brand, set once, reaches every motion page, and is kept for the next video:
- a project has a `theme`: the product's name, URL and logo, an accent, the text's colour, the tone pages draw their own background in, and a heading font;
- motion pages read it (`cuttle.theme`, `--cuttle-display`), and the title, end card, lower third and captions templates wear it where their params are empty;
- a brand kit keeps the theme with the look's brand parts (background, frame style, cursor style and colour) and applies them with one click in the Look tab, or with `cuttle brand apply`.

**Architecture:**
- **`@cuttle/project`:** `ThemeSchema` (`theme` in the project), the kit's format `BrandKitSchema` (`brand.json`), and `backgroundTone` (the tone pages draw on).
- **`@cuttle/export`:** `motionTheme` gives pages the theme as CSS variables (the keys starting with `--`) and `name`, `url`, `logo` (its URL in the page) and `font`; the runtime sets only the variables on `:root`.
- **`@cuttle/core`:** `brands.ts` keeps kits in a folder of their own (`brandsDir`, `CUTTLE_BRANDS_DIR`), saves one from a project with copies of its files, lists, finds and removes them, and applies one: its files copied into the project's `brand/`, then the fields set (`brandFields`, `applyBrand`).
- **The CLI:** `cuttle brand list|save|apply|remove`.
- **The app:** a `theme` document command; the requests `brand:list|save|apply|remove` and a logo for `project:import-image`; the Look tab's first part, Brand: the kits as chips, the theme's fields, Save as a kit.

**Tech Stack:** TypeScript strict, zod 4, React 19, Electron 44.7.2, commander.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase5-motion-design.md`; roadmap `docs/superpowers/specs/2026-10-17-cuttle-roadmap-p4-p6.md` (P5-M2: "Templates and the brand kit"). Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m1i-editor-transitions.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m2a`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine, and they keep brand kits in a folder of their own (`CUTTLE_BRANDS_DIR`), never the user's.
- The full `pnpm test` and the typecheck run in Task 6.

## Decisions made while planning

A prototype of the milestone, checked against the spec and the roadmap, settled these points. The finished prototype passed `pnpm test` (868 tests, 71 skipped, in two full runs), the typecheck, `app:check` (51 tests) and `cli:check` (14). Every screenshot was looked at.

- **The theme is the project's, beside the look.** It holds what pages read (name, URL, logo, accent, text, pages' background, heading font). Its defaults change nothing in a video made before: the accent falls back to the cursor's colour, the pages' background to the dark tone of the look's background, the text is white and the headings Archivo, as the templates had them.
- **Six heading fonts, the kit's own.** Pages render without a network, and the kit carries Archivo, Inter, Space Grotesk, Fraunces, Instrument Serif and Bebas Neue: the theme picks among them (the schema refuses others). The two faces with one weight (Bebas Neue, Instrument Serif) are drawn as they are: the templates set `font-synthesis: none`, so they are never made bold by the browser.
- **The templates take the brand where a param is empty.** The title's default text is empty now: it shows the brand's name (without one, "Built with Claude Code" as before). The end card's URL and logo are empty by default and take the brand's; its monogram is the name's first letter. The lower third's name and the captions are in the brand's heading font.
- **A kit is a folder:** `brand.json` with its logo and background image beside it, named by its name's slug, in the user's app data (`%APPDATA%\Cuttle\brands` on Windows, `~/Library/Application Support/Cuttle/brands` on macOS, `$XDG_CONFIG_HOME/cuttle/brands` elsewhere; `CUTTLE_BRANDS_DIR` overrides). Not in the projects folder, where it would read as a project. Saving a name again replaces the kit; a kit is written beside its folder and then moved into place, never half written.
- **A kit holds the brand's parts of the look:** the background (its image too), the frame's style, the cursor's style and colour. Not the frame's title, the cursor's size, the webcam or the sound: those belong to a video.
- **Applying copies the kit's files into the project's `brand/`** as `<slug>-logo.<ext>`, and never over a file with other bytes (the next free name instead). So undoing an apply in the editor finds the logo it had before.
- **In the app an apply is one edit.** The main process copies the files and answers what the kit sets; the page applies the theme (the new `theme` command, as a whole) and the look's parts as one step to undo. Saving a kit takes the page's version of the project, which may be ahead of the file.
- **Removing a kit asks first,** in the panel (no system dialog); projects keep what it set.
- **The CLI's apply keeps a backup** (cuttle.json.bak), as `suggest` does: it replaces the theme and parts of the look.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/{schema,brand,theme}.ts` | the theme, the kit's format, the pages' background tone |
| `packages/export/src/motion/{init,runtime}.ts` | the theme in every page |
| `packages/motion-kit/templates/{title,end-card,lower-third,kinetic-captions}/index.html` | the templates wear the brand |
| `packages/core/src/brands.ts` | the kits: kept, listed, saved, applied, removed |
| `apps/cli/src/commands/brand.ts`, `apps/cli/src/main.ts` | `cuttle brand` |
| `apps/desktop/src/shared/{document,ipc,channels,media-path}.ts` | the `theme` command, the requests, SVG for the editor |
| `apps/desktop/src/main/{brands,windows,project-watch}.ts` | the requests in the main process, the logo's import |
| `apps/desktop/src/renderer/editor/{Inspector.tsx,brand.ts,actions.ts,session.ts,editor.css}`, `apps/desktop/src/renderer/icons.tsx` | the Look tab's Brand part, the kits' actions |
| `apps/desktop/test/app.check.test.ts`, `skill/cuttle/*.md`, `skill/test/skill.test.ts` | the check, the guides |

---

### Task 1: The theme in the project and in every page

**Files:**
- Create: `packages/project/src/brand.ts`, `packages/project/src/theme.ts`, `packages/project/test/brand.test.ts`
- Modify: `packages/project/src/schema.ts`, `packages/project/src/index.ts`, `packages/project/test/schema.test.ts`, `packages/export/src/motion/init.ts`, `packages/export/src/motion/runtime.ts`, `packages/export/test/motion-init.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m2a`; work there:

```bash
git switch p5-m2a
```

- [ ] **Step 2: Write the failing tests**

In `packages/project/test/schema.test.ts`, replace:

```ts
    expect(pathsOf({ ...minimal, texts: [{ id: 'o1', at: 1, duration: 2, text: 'Hi' }], overlays: [{ id: 'o1', src: 'a.html', at: 1, duration: 2 }] })).toEqual(['overlays.0.id']);
  });
});
```

with:

```ts
    expect(pathsOf({ ...minimal, texts: [{ id: 'o1', at: 1, duration: 2, text: 'Hi' }], overlays: [{ id: 'o1', src: 'a.html', at: 1, duration: 2 }] })).toEqual(['overlays.0.id']);
  });
});

describe('the theme (the brand)', () => {
  it('has white text and the Archivo headings by default, and nothing else', () => {
    expect(ProjectSchema.parse(minimal).theme).toEqual({ foreground: '#FFFFFF', font: 'Archivo' });
  });

  it('reads a name, URL, logo, colours, a heading font and its kit', () => {
    const theme = { name: 'Acme', url: 'acme.dev', logo: 'brand/acme.svg', accent: '#3366FF', foreground: '#F0F0F0', background: '#0A0A14', font: 'Instrument Serif', kit: 'Acme' };
    expect(ProjectSchema.parse({ ...minimal, theme }).theme).toEqual(theme);
  });

  it('refuses a colour that is no hex colour, a font of none of the kit\'s faces and an unknown key', () => {
    expect(pathsOf({ ...minimal, theme: { accent: 'blue' } })).toEqual(['theme.accent']);
    expect(pathsOf({ ...minimal, theme: { font: 'Comic Sans' } })).toEqual(['theme.font']);
    expect(pathsOf({ ...minimal, theme: { colour: '#000000' } })).toEqual(['theme']);
  });
});
```

`packages/project/test/brand.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { backgroundTone, parseBrandKitJson } from '../src/index';

const kit = {
  version: 1,
  name: 'Acme',
  theme: { name: 'Acme', logo: 'logo.png', accent: '#3366FF', font: 'Fraunces' },
  look: { background: { preset: 'solid', color: '#0A0A14' }, frame: { style: 'mac-light' }, cursor: { style: 'ring', color: '#3366FF' } },
};

describe('brand kits', () => {
  it('read a kit, its theme with the defaults filled in', () => {
    const parsed = parseBrandKitJson(`\uFEFF${JSON.stringify(kit)}`);
    expect(parsed).toEqual({ ok: true, kit: { ...kit, theme: { ...kit.theme, foreground: '#FFFFFF' } } });
  });

  it('refuse a kit without a name, with a kit of its own, or with a solid background without its colour', () => {
    const issues = (value: unknown) => {
      const parsed = parseBrandKitJson(JSON.stringify(value));
      return parsed.ok ? [] : parsed.issues.map((issue) => issue.path);
    };
    expect(issues({ ...kit, name: ' ' })).toEqual(['name']);
    expect(issues({ ...kit, theme: { ...kit.theme, kit: 'Acme' } })).toEqual(['theme']);
    expect(issues({ ...kit, look: { ...kit.look, background: { preset: 'solid' } } })).toEqual(['look.background.color']);
    expect(parseBrandKitJson('{')).toMatchObject({ ok: false, issues: [{ path: '(root)' }] });
  });

  it('give pages a tone of the background to draw on', () => {
    expect(backgroundTone({ preset: 'solid', color: '#102030' })).toBe('#102030');
    expect(backgroundTone({ preset: 'aurora' })).toBe('#050816');
  });
});
```

In `packages/export/test/motion-init.test.ts`, replace:

```ts
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
```

with:

```ts
    expect(motionTheme(project())).toEqual({
      '--cuttle-accent': '#D97757',
      '--cuttle-bg': '#1b1c4a',
      '--cuttle-fg': '#FFFFFF',
      '--cuttle-font': '"Inter", "Segoe UI", system-ui, sans-serif',
      '--cuttle-display': '"Archivo", "Archivo", "Inter", system-ui, sans-serif',
      '--cuttle-mono': '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      font: 'Archivo',
      name: '',
      url: '',
      logo: '',
    });
    const solid = motionTheme(project({ look: { background: { preset: 'solid', color: '#102030' }, cursor: { color: '#00ff88' } } }));
    expect(solid).toMatchObject({ '--cuttle-accent': '#00ff88', '--cuttle-bg': '#102030' });
  });

  it('the brand over the look: its colours, its heading font, its name, URL and logo (a URL in the page)', () => {
    const theme = motionTheme(
      project({
        look: { cursor: { color: '#00ff88' } },
        theme: { name: 'Acme', url: 'acme.dev', logo: 'brand/acme logo.png', accent: '#3366FF', foreground: '#F0F0F0', background: '#0A0A14', font: 'Bebas Neue' },
      }),
    );
    expect(theme).toMatchObject({
      '--cuttle-accent': '#3366FF',
      '--cuttle-bg': '#0A0A14',
      '--cuttle-fg': '#F0F0F0',
      '--cuttle-display': '"Bebas Neue", "Archivo", "Inter", system-ui, sans-serif',
      font: 'Bebas Neue',
      name: 'Acme',
      url: 'acme.dev',
      logo: 'cuttle-motion://project/brand/acme%20logo.png',
    });
    // a logo outside the project is not given to pages
    expect(motionTheme(project({ theme: { logo: '../elsewhere.png' } })).logo).toBe('');
  });

  it('the format by its shape, or its size', () => {
    expect(formatName({ width: 1920, height: 1080 })).toBe('16:9');
    expect(formatName({ width: 1080, height: 1920 })).toBe('9:16');
```

Run: `pnpm exec vitest run --project node packages/project packages/export/test/motion-init.test.ts`
Expected: FAIL: the project has no `theme`, there is no `brand.ts`, and pages get no brand.

- [ ] **Step 3: The theme and the kit's format**

In `packages/project/src/schema.ts`, replace:

```ts
export const TEXT_POSITIONS = ['top', 'center', 'bottom'] as const;
/** How captions look: classic subtitles on a dark box, the spoken word in colour, or a few big words at a time. */
export const CAPTION_STYLES = ['subtitle', 'karaoke', 'bold'] as const;
export const STILL_MOTIONS = ['none', 'kenburns', 'scroll'] as const;
export const WEBCAM_SHAPES = ['circle', 'rounded', 'squircle', 'square'] as const;
export const WEBCAM_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
```

with:

```ts
export const TEXT_POSITIONS = ['top', 'center', 'bottom'] as const;
/** How captions look: classic subtitles on a dark box, the spoken word in colour, or a few big words at a time. */
export const CAPTION_STYLES = ['subtitle', 'karaoke', 'bold'] as const;
/** The fonts a theme's headings may be in: the motion kit's display faces, and its text face. */
export const THEME_FONTS = ['Archivo', 'Inter', 'Space Grotesk', 'Fraunces', 'Instrument Serif', 'Bebas Neue'] as const;
export const STILL_MOTIONS = ['none', 'kenburns', 'scroll'] as const;
export const WEBCAM_SHAPES = ['circle', 'rounded', 'squircle', 'square'] as const;
export const WEBCAM_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
```

In the same file, replace:

```ts
// z.number() already rejects Infinity and NaN in zod 4.
const seconds = z.number().nonnegative();
const positiveSeconds = z.number().positive();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a hex color like #0c0c0c');

export const RectSchema = z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]);
```

with:

```ts
// z.number() already rejects Infinity and NaN in zod 4.
const seconds = z.number().nonnegative();
const positiveSeconds = z.number().positive();
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a hex color like #0c0c0c');

export const RectSchema = z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]);
```

In the same file, replace:

```ts

// Cross-field checks live on the object they belong to, so zod reports them in the same pass
// as every other issue (a root superRefine is skipped when any other issue exists).
const BackgroundSchema = z
  .strictObject({
    preset: z.enum(BACKGROUND_PRESETS),
    color: hexColor.optional(),
```

with:

```ts

// Cross-field checks live on the object they belong to, so zod reports them in the same pass
// as every other issue (a root superRefine is skipped when any other issue exists).
export const BackgroundSchema = z
  .strictObject({
    preset: z.enum(BACKGROUND_PRESETS),
    color: hexColor.optional(),
```

In the same file, replace:

```ts
  });

/** The privacy guard's words: masked wherever the screen shows them (a name, an address). */
const PrivacySchema = z.strictObject({
  words: z.array(z.string().trim().min(1).max(100)).default([]),
});
```

with:

```ts
  });

/** The privacy guard's words: masked wherever the screen shows them (a name, an address). */
/**
 * The project's brand: what its motion pages read for titles, end cards, lower thirds and every
 * colour (`--cuttle-accent`, `--cuttle-display`, `cuttle.theme.logo`). A brand kit sets it with a click.
 */
export const ThemeSchema = z.strictObject({
  /** The product's name and address, for titles and end cards. */
  name: z.string().max(80).optional(),
  url: z.string().max(200).optional(),
  /** The logo: an image in the project (`brand/logo.png`). */
  logo: z.string().min(1).optional(),
  /** The brand's colour (without one, the cursor's), the text's, and the tone pages draw their own background in (without one, the background's). */
  accent: hexColor.optional(),
  foreground: hexColor.default('#FFFFFF'),
  background: hexColor.optional(),
  /** The headings' font. */
  font: z.enum(THEME_FONTS).default('Archivo'),
  /** The brand kit it was set from, by name. */
  kit: z.string().max(80).optional(),
});

const PrivacySchema = z.strictObject({
  words: z.array(z.string().trim().min(1).max(100)).default([]),
});
```

In the same file, replace:

```ts
    autoEdits: AutoEditsSchema.prefault({}),
    captions: CaptionsSchema.prefault({}),
    privacy: PrivacySchema.prefault({}),
  })
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
```

with:

```ts
    autoEdits: AutoEditsSchema.prefault({}),
    captions: CaptionsSchema.prefault({}),
    privacy: PrivacySchema.prefault({}),
    theme: ThemeSchema.prefault({}),
  })
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
```

In the same file, replace:

```ts
export type AutoKind = (typeof AUTO_KINDS)[number];
export type AutoEdits = CuttleProject['autoEdits'];
export type Captions = CuttleProject['captions'];
export type CaptionFix = Captions['fixes'][number];
```

with:

```ts
export type AutoKind = (typeof AUTO_KINDS)[number];
export type AutoEdits = CuttleProject['autoEdits'];
export type Captions = CuttleProject['captions'];
export type Theme = CuttleProject['theme'];
export type ThemeFont = (typeof THEME_FONTS)[number];
export type CaptionFix = Captions['fixes'][number];
```

`packages/project/src/brand.ts`:

```ts
import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';
import { BackgroundSchema, CURSOR_STYLES, FRAME_STYLES, ThemeSchema, hexColor } from './schema';

/** The brand.json format version this build reads and writes. */
export const BRAND_VERSION = 1;

/**
 * A brand kit: `brand.json` in a folder of its own, with its files next to it (the logo, a
 * background image). It holds a project's theme and the parts of its look that are the brand's
 * (the background, the frame's style, the cursor's style and colour); applying it sets them in a
 * project with one click. Its files are named by the file name alone (`logo.png`).
 */
export const BrandKitSchema = z.strictObject({
  version: z.literal(BRAND_VERSION),
  name: z.string().trim().min(1).max(80),
  theme: ThemeSchema.omit({ kit: true }),
  look: z.strictObject({
    background: BackgroundSchema,
    frame: z.strictObject({ style: z.enum(FRAME_STYLES) }),
    cursor: z.strictObject({ style: z.enum(CURSOR_STYLES), color: hexColor }),
  }),
});

export type BrandKit = z.output<typeof BrandKitSchema>;

export type BrandKitParseResult = { ok: true; kit: BrandKit } | { ok: false; issues: ProjectIssue[] };

export function parseBrandKitJson(text: string): BrandKitParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  const result = BrandKitSchema.safeParse(raw);
  if (result.success) return { ok: true, kit: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}
```

`packages/project/src/theme.ts`:

```ts
import type { BackgroundPreset, Look } from './schema';

/** A dark tone of each background preset, for pages that draw their own background. */
const BACKGROUND_TONES: Record<BackgroundPreset, string> = {
  'sunset-sky': '#1b1c4a',
  aurora: '#050816',
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

In `packages/project/src/index.ts`, replace:

```ts
  AUTO_KINDS,
  BACKGROUND_PRESETS,
  CAPTION_STYLES,
  CLICK_EFFECTS,
  CURRENT_VERSION,
  CURSOR_SHAPES,
```

with:

```ts
  AUTO_KINDS,
  BACKGROUND_PRESETS,
  CAPTION_STYLES,
  THEME_FONTS,
  CLICK_EFFECTS,
  CURRENT_VERSION,
  CURSOR_SHAPES,
```

In the same file, replace:

```ts
  type BackgroundPreset,
  type CaptionFix,
  type Captions,
  type CaptionStyle,
  type CardScene,
  type MotionOverlay,
```

with:

```ts
  type BackgroundPreset,
  type CaptionFix,
  type Captions,
  type Theme,
  type ThemeFont,
  type CaptionStyle,
  type CardScene,
  type MotionOverlay,
```

In the same file, replace:

```ts
  type MarkersFile,
  type MarkersParseResult,
} from './markers';
```

with:

```ts
  type MarkersFile,
  type MarkersParseResult,
} from './markers';
export { BRAND_VERSION, BrandKitSchema, parseBrandKitJson, type BrandKit, type BrandKitParseResult } from './brand';
export { backgroundTone } from './theme';
```

- [ ] **Step 4: The theme in every page**

In `packages/export/src/motion/init.ts`, replace:

```ts
import type { BackgroundPreset, CuttleProject, MotionOverlay, MotionScene, SceneTransition } from '@cuttle/project';
import { TAKE_WORKER, type MotionInit } from './runtime';

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
```

with:

```ts
import { backgroundTone, type CuttleProject, type MotionOverlay, type MotionScene, type SceneTransition } from '@cuttle/project';
import { TAKE_WORKER, type MotionInit } from './runtime';
import { projectFileUrl } from './take';

/**
 * The project's theme for its pages (`cuttle.theme`): its look and brand as CSS variables (the keys
 * that start with `--`), and the brand's `name`, `url`, `logo` (its URL in the page, or "") and
 * headings' `font`.
 */
export function motionTheme(project: CuttleProject): Record<string, string> {
  const { background, cursor } = project.look;
  const { theme } = project;
  return {
    '--cuttle-accent': theme.accent ?? cursor.color,
    '--cuttle-bg': theme.background ?? backgroundTone(background),
    '--cuttle-fg': theme.foreground,
    '--cuttle-font': '"Inter", "Segoe UI", system-ui, sans-serif',
    '--cuttle-display': `"${theme.font}", "Archivo", "Inter", system-ui, sans-serif`,
    '--cuttle-mono': '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    font: theme.font,
    name: theme.name ?? '',
    url: theme.url ?? '',
    logo: theme.logo ? (projectFileUrl(theme.logo) ?? '') : '',
  };
}
```

In `packages/export/src/motion/runtime.ts`, replace:

```ts
  /** `16:9`, `9:16`, `1:1` or the output's own size. */
  format: string;
  params: Record<string, unknown>;
  /** CSS variables set on the page's root (`--cuttle-accent`…). */
  theme: Record<string, string>;
  /** Seeds `Math.random`, so the item looks the same in every render. */
  seed: number;
```

with:

```ts
  /** `16:9`, `9:16`, `1:1` or the output's own size. */
  format: string;
  params: Record<string, unknown>;
  /** The theme: CSS variables set on the page's root (`--cuttle-accent`…), and the brand's `name`, `url`, `logo` and `font`. */
  theme: Record<string, string>;
  /** Seeds `Math.random`, so the item looks the same in every render. */
  seed: number;
```

In the same file, replace:

```ts
  readonly size: { width: number; height: number };
  readonly format: string;
  readonly params: Record<string, unknown>;
  readonly theme: Record<string, string>;
  /**
   * Calls `draw(seconds)` for every frame, before it is drawn (also after a seek): the surest way to
```

with:

```ts
  readonly size: { width: number; height: number };
  readonly format: string;
  readonly params: Record<string, unknown>;
  /**
   * The project's theme: its CSS variables (`--cuttle-accent`, `--cuttle-display`…, also set on the
   * page's root) and the brand's `name`, `url`, `font` (the headings') and `logo` (its URL, or "").
   */
  readonly theme: Record<string, string>;
  /**
   * Calls `draw(seconds)` for every frame, before it is drawn (also after a seek): the surest way to
```

In the same file, replace:

```ts
    (font) =>
      `@font-face { font-family: "${font.family}"; font-weight: ${font.weight}; font-style: ${font.style};${font.stretch ? ` font-stretch: ${font.stretch};` : ''} font-display: block; src: url("${font.src}") format("woff2"); }`,
  );
  sheet.replaceSync([...faces, `:root { ${Object.entries(init.theme).map(([name, value]) => `${name}: ${value};`).join(' ')} }`].join('\n'));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  // the take
```

with:

```ts
    (font) =>
      `@font-face { font-family: "${font.family}"; font-weight: ${font.weight}; font-style: ${font.style};${font.stretch ? ` font-stretch: ${font.stretch};` : ''} font-display: block; src: url("${font.src}") format("woff2"); }`,
  );
  const variables = Object.entries(init.theme).filter(([name]) => name.startsWith('--'));
  sheet.replaceSync([...faces, `:root { ${variables.map(([name, value]) => `${name}: ${value};`).join(' ')} }`].join('\n'));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  // the take
```

Run: `pnpm exec vitest run --project node packages/project packages/export/test/motion-init.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project packages/export/src/motion/init.ts packages/export/src/motion/runtime.ts packages/export/test/motion-init.test.ts
git commit -m "project, export: the project's theme (its brand) and the brand kit's format; pages read the theme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The templates wear the brand

**Files:**
- Modify: `packages/motion-kit/templates/title/index.html`, `packages/motion-kit/templates/end-card/index.html`, `packages/motion-kit/templates/lower-third/index.html`, `packages/motion-kit/templates/kinetic-captions/index.html`

- [ ] **Step 1: The title: the brand's name, in its font**

In `packages/motion-kit/templates/title/index.html`, replace:

```html
         words come in (the "sounds" param). -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "title", "label": "Title", "type": "text", "default": "Built with Claude Code" },
        { "name": "subtitle", "label": "Subtitle", "type": "text", "default": "" },
        { "name": "eyebrow", "label": "Small line above", "type": "text", "default": "" },
        { "name": "align", "label": "Align", "type": "select", "default": "center", "options": ["center", "left"] },
```

with:

```html
         words come in (the "sounds" param). -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "title", "label": "Title (empty: the brand's name)", "type": "text", "default": "" },
        { "name": "subtitle", "label": "Subtitle", "type": "text", "default": "" },
        { "name": "eyebrow", "label": "Small line above", "type": "text", "default": "" },
        { "name": "align", "label": "Align", "type": "select", "default": "center", "options": ["center", "left"] },
```

In the same file, replace:

```html
        overflow: hidden;
      }
      body {
        font-family: 'Archivo', var(--cuttle-font);
        color: var(--cuttle-fg);
        display: grid;
        place-items: center;
```

with:

```html
        overflow: hidden;
      }
      body {
        font-family: var(--cuttle-display);
        /* the brand's heading font as it is: a face with one weight (Bebas Neue, Instrument Serif) is not made bold */
        font-synthesis: none;
        color: var(--cuttle-fg);
        display: grid;
        place-items: center;
```

In the same file, replace:

```html
      const { params, duration, size } = cuttle;
      document.body.classList.add(params.align === 'left' ? 'left' : 'center');
      const title = document.getElementById('title');
      title.textContent = params.title || 'Title';
      const subtitle = document.getElementById('subtitle');
      subtitle.textContent = params.subtitle || '';
      const eyebrow = document.getElementById('eyebrow');
```

with:

```html
      const { params, duration, size } = cuttle;
      document.body.classList.add(params.align === 'left' ? 'left' : 'center');
      const title = document.getElementById('title');
      title.textContent = params.title || cuttle.theme.name || 'Built with Claude Code';
      const subtitle = document.getElementById('subtitle');
      subtitle.textContent = params.subtitle || '';
      const eyebrow = document.getElementById('eyebrow');
```

In the same file, replace:

```html
      // the title fits the width (once its font is in), then its words are split for their entrance
      let words = [];
      cuttle.ready(
        document.fonts.load('800 100px Archivo').then(() => {
          fit(title, { width: size.width * 0.84, max: parseFloat(getComputedStyle(title).fontSize), min: 24 });
          words = split(title, 'word');
        }),
```

with:

```html
      // the title fits the width (once its font is in), then its words are split for their entrance
      let words = [];
      cuttle.ready(
        document.fonts.load(`800 100px "${cuttle.theme.font || 'Archivo'}"`).then(() => {
          fit(title, { width: size.width * 0.84, max: parseFloat(getComputedStyle(title).fontSize), min: 24 });
          words = split(title, 'word');
        }),
```

- [ ] **Step 2: The end card: the brand's logo, URL and name**

In `packages/motion-kit/templates/end-card/index.html`, replace:

```html
    <script type="application/json" id="cuttle-params">
      [
        { "name": "headline", "label": "Headline", "type": "text", "default": "Try it yourself" },
        { "name": "url", "label": "URL", "type": "text", "default": "example.com" },
        { "name": "cta", "label": "Call to action", "type": "text", "default": "Link in the description" },
        { "name": "logo", "label": "Logo (an image in the project)", "type": "image", "default": null },
        { "name": "monogram", "label": "Monogram without a logo", "type": "text", "default": "C" },
        { "name": "sounds", "label": "Sounds", "type": "bool", "default": true }
      ]
    </script>
```

with:

```html
    <script type="application/json" id="cuttle-params">
      [
        { "name": "headline", "label": "Headline", "type": "text", "default": "Try it yourself" },
        { "name": "url", "label": "URL (empty: the brand's)", "type": "text", "default": "" },
        { "name": "cta", "label": "Call to action", "type": "text", "default": "Link in the description" },
        { "name": "logo", "label": "Logo (empty: the brand's)", "type": "image", "default": null },
        { "name": "monogram", "label": "Monogram without a logo (empty: the name's first letter)", "type": "text", "default": "" },
        { "name": "sounds", "label": "Sounds", "type": "bool", "default": true }
      ]
    </script>
```

In the same file, replace:

```html
        background: var(--cuttle-bg);
      }
      body {
        font-family: 'Archivo', var(--cuttle-font);
        color: var(--cuttle-fg);
        display: grid;
        place-items: center;
```

with:

```html
        background: var(--cuttle-bg);
      }
      body {
        font-family: var(--cuttle-display);
        /* the brand's heading font as it is: a face with one weight (Bebas Neue, Instrument Serif) is not made bold */
        font-synthesis: none;
        color: var(--cuttle-fg);
        display: grid;
        place-items: center;
```

In the same file, replace:

```html
        place-items: center;
        background: linear-gradient(145deg, color-mix(in srgb, var(--cuttle-accent) 70%, white), var(--cuttle-accent) 55%, color-mix(in srgb, var(--cuttle-accent) 70%, black));
        box-shadow: 0 calc(24 * var(--u)) calc(70 * var(--u)) color-mix(in srgb, var(--cuttle-accent) 45%, transparent), inset 0 calc(2 * var(--u)) 0 rgba(255, 255, 255, 0.35);
        font: 800 calc(84 * var(--u)) / 1 'Archivo', sans-serif;
        color: white;
      }
      .tile img {
```

with:

```html
        place-items: center;
        background: linear-gradient(145deg, color-mix(in srgb, var(--cuttle-accent) 70%, white), var(--cuttle-accent) 55%, color-mix(in srgb, var(--cuttle-accent) 70%, black));
        box-shadow: 0 calc(24 * var(--u)) calc(70 * var(--u)) color-mix(in srgb, var(--cuttle-accent) 45%, transparent), inset 0 calc(2 * var(--u)) 0 rgba(255, 255, 255, 0.35);
        font: 800 calc(84 * var(--u)) / 1 var(--cuttle-display);
        color: white;
      }
      .tile img {
```

In the same file, replace:

```html
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
```

with:

```html
    <script type="module">
      import { at, ease, fit, random, spring, split, stagger, typed, typedUntil } from 'cuttle';

      const { params, size, duration, theme } = cuttle;
      // empty params take the brand's (the project's theme): its logo, URL and name
      const logo = params.logo || theme.logo;
      const link = params.url || theme.url || '';
      const tile = document.getElementById('tile');
      if (logo) {
        const image = new Image();
        // an image param is a path in the project folder (the page itself is in motion/<name>/); the theme's logo is a URL
        image.src = /^([a-z][a-z0-9+.-]*:|\/)/i.test(logo) ? logo : `/${logo}`;
        tile.append(image);
        tile.classList.add('logo-only');
        cuttle.ready(image.decode().catch(() => {}));
      } else {
        tile.textContent = (params.monogram || (theme.name || 'C').charAt(0).toUpperCase()).slice(0, 2);
      }
      const headline = document.getElementById('headline');
      headline.textContent = params.headline || '';
      document.getElementById('cta').textContent = params.cta || '';
      let letters = [];
      cuttle.ready(
        document.fonts.load(`800 100px "${theme.font || 'Archivo'}"`).then(() => {
          fit(headline, { width: size.width * 0.86, max: parseFloat(getComputedStyle(headline).fontSize), min: 24 });
          letters = split(headline, 'char');
        }),
```

In the same file, replace:

```html
      const pill = document.getElementById('pill');
      const cta = document.getElementById('cta');
      const typeFrom = 1.05;
      const typedAt = typedUntil(params.url || '', { start: typeFrom, cps: 22 });
      if (params.sounds !== false) {
        cuttle.sound('impact', { at: 0.05, volume: 0.6 });
        for (let key = typeFrom; key < typedAt - 0.1; key += 0.6) cuttle.sound('type-burst', { at: key, volume: 0.7 });
        if (params.url) cuttle.sound('ding', { at: typedAt + 0.15, volume: 0.45 });
      }
      cuttle.onFrame((t) => {
        particles(t);
```

with:

```html
      const pill = document.getElementById('pill');
      const cta = document.getElementById('cta');
      const typeFrom = 1.05;
      const typedAt = typedUntil(link, { start: typeFrom, cps: 22 });
      if (params.sounds !== false) {
        cuttle.sound('impact', { at: 0.05, volume: 0.6 });
        for (let key = typeFrom; key < typedAt - 0.1; key += 0.6) cuttle.sound('type-burst', { at: key, volume: 0.7 });
        if (link) cuttle.sound('ding', { at: typedAt + 0.15, volume: 0.45 });
      }
      cuttle.onFrame((t) => {
        particles(t);
```

In the same file, replace:

```html
        const open = at(t, 0.8, 0.5, ease.outExpo);
        pill.style.opacity = open;
        pill.style.transform = `translateY(${(1 - open) * 20}px) scale(${0.94 + 0.06 * open})`;
        url.textContent = typed(params.url || '', t, { start: typeFrom, cps: 22 });
        const blinking = t > typedAt + 0.2;
        caret.style.opacity = !blinking || Math.floor((t - typedAt) * 2) % 2 === 0 ? 1 : 0;
        const across = at(t, typedAt + 0.15, 0.9, ease.inOut);
```

with:

```html
        const open = at(t, 0.8, 0.5, ease.outExpo);
        pill.style.opacity = open;
        pill.style.transform = `translateY(${(1 - open) * 20}px) scale(${0.94 + 0.06 * open})`;
        url.textContent = typed(link, t, { start: typeFrom, cps: 22 });
        const blinking = t > typedAt + 0.2;
        caret.style.opacity = !blinking || Math.floor((t - typedAt) * 2) % 2 === 0 ? 1 : 0;
        const across = at(t, typedAt + 0.15, 0.9, ease.inOut);
```

- [ ] **Step 3: The lower third and the captions, in the brand's font**

In `packages/motion-kit/templates/lower-third/index.html`, replace:

```html
        overflow: hidden;
      }
      .name {
        font: 700 calc(50 * var(--u)) / 1.15 'Archivo', var(--cuttle-font);
        font-stretch: 105%;
        letter-spacing: -0.015em;
        color: #fff;
```

with:

```html
        overflow: hidden;
      }
      .name {
        font: 700 calc(50 * var(--u)) / 1.15 var(--cuttle-display);
        /* the brand's heading font as it is: a face with one weight (Bebas Neue, Instrument Serif) is not made bold */
        font-synthesis: none;
        font-stretch: 105%;
        letter-spacing: -0.015em;
        color: #fff;
```

In `packages/motion-kit/templates/kinetic-captions/index.html`, replace:

```html
        flex-wrap: wrap;
        justify-content: center;
        gap: 0 0.28em;
        font: 800 calc(var(--size) * 70 * var(--u)) / 1.12 'Archivo', var(--cuttle-font);
        font-stretch: 104%;
        letter-spacing: -0.01em;
        color: #fff;
```

with:

```html
        flex-wrap: wrap;
        justify-content: center;
        gap: 0 0.28em;
        font: 800 calc(var(--size) * 70 * var(--u)) / 1.12 var(--cuttle-display);
        /* the brand's heading font as it is: a face with one weight (Bebas Neue, Instrument Serif) is not made bold */
        font-synthesis: none;
        font-stretch: 104%;
        letter-spacing: -0.01em;
        color: #fff;
```

In the same file, replace:

```html
      document.body.classList.add(params.style === 'bold' ? 'bold' : 'pop', params.place === 'top' ? 'top' : params.place === 'center' ? 'center' : 'bottom');
      document.documentElement.style.setProperty('--size', String(Number(params.size) || 1));
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--cuttle-accent').trim() || '#d97757';
      cuttle.ready(document.fonts.load('800 70px Archivo'));

      // the words where the video plays them (output seconds), in phrases: a few words, broken at
      // pauses and at the end of a sentence
```

with:

```html
      document.body.classList.add(params.style === 'bold' ? 'bold' : 'pop', params.place === 'top' ? 'top' : params.place === 'center' ? 'center' : 'bottom');
      document.documentElement.style.setProperty('--size', String(Number(params.size) || 1));
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--cuttle-accent').trim() || '#d97757';
      cuttle.ready(document.fonts.load(`800 70px "${cuttle.theme.font || 'Archivo'}"`));

      // the words where the video plays them (output seconds), in phrases: a few words, broken at
      // pauses and at the end of a sentence
```

Run: `pnpm exec vitest run --project node packages/motion-kit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/motion-kit/templates
git commit -m "kit: the title, end card, lower third and captions wear the brand where their params are empty

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Brand kits, and `cuttle brand`

**Files:**
- Create: `packages/core/src/brands.ts`, `packages/core/test/brands.test.ts`, `apps/cli/src/commands/brand.ts`, `apps/cli/test/brand.test.ts`
- Modify: `packages/core/src/index.ts`, `apps/cli/src/main.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/brands.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyBrand, brandSlug, brandsDir, findBrand, listBrands, removeBrand, saveBrand } from '../src/brands';
import { CoreError } from '../src/errors';
import { newProjectFile, readProjectFile, writeProjectFile } from '../src/project-file';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-brands-'));
  dirs.push(dir);
  return dir;
};
const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

/** A project with a branded theme, a logo and an image background. */
async function brandedProject() {
  const dir = temp();
  const file = newProjectFile(dir);
  mkdirSync(join(dir, 'brand'));
  writeFileSync(join(dir, 'brand', 'mark.PNG'), 'logo bytes');
  mkdirSync(join(dir, 'images'));
  writeFileSync(join(dir, 'images', 'wall.jpg'), 'wallpaper bytes');
  file.raw.theme = { name: 'Acme', url: 'acme.dev', logo: 'brand/mark.PNG', accent: '#3366FF', font: 'Space Grotesk', kit: 'Old' };
  file.raw.look = { background: { preset: 'image', image: 'images/wall.jpg' }, frame: { style: 'mac-light', title: 'acme · ~/demo' }, cursor: { style: 'ring', color: '#3366FF', size: 1.5 } };
  return (await writeProjectFile(file, 'init')).file;
}

describe('brand kits', () => {
  it('names a kit\'s folder by its name', () => {
    expect(brandSlug('Acme Café')).toBe('acme-cafe');
    expect(brandSlug('  ~~ ')).toBe('brand');
    expect(brandSlug('x'.repeat(60)).length).toBe(48);
  });

  it('keeps kits in CUTTLE_BRANDS_DIR when it is set', () => {
    const before = process.env.CUTTLE_BRANDS_DIR;
    process.env.CUTTLE_BRANDS_DIR = join(tmpdir(), 'somewhere');
    try {
      expect(brandsDir()).toBe(join(tmpdir(), 'somewhere'));
    } finally {
      if (before === undefined) delete process.env.CUTTLE_BRANDS_DIR;
      else process.env.CUTTLE_BRANDS_DIR = before;
    }
  });

  it('saves a project\'s brand with copies of its files, and lists it', async () => {
    const root = temp();
    const project = await brandedProject();
    const brand = await saveBrand(project.dir, project.project, ' Acme ', root);
    expect(brand.slug).toBe('acme');
    expect(readdirSync(brand.dir).sort()).toEqual(['background.jpg', 'brand.json', 'logo.png']);
    expect(JSON.parse(readFileSync(join(brand.dir, 'brand.json'), 'utf8'))).toEqual({
      version: 1,
      name: 'Acme',
      theme: { name: 'Acme', url: 'acme.dev', logo: 'logo.png', accent: '#3366FF', foreground: '#FFFFFF', font: 'Space Grotesk' },
      look: { background: { preset: 'image', image: 'background.jpg' }, frame: { style: 'mac-light' }, cursor: { style: 'ring', color: '#3366FF' } },
    });
    expect(readFileSync(brand.logo!, 'utf8')).toBe('logo bytes');
    // a folder without a valid brand.json, and a half-written one, are not kits
    mkdirSync(join(root, 'broken'));
    writeFileSync(join(root, 'broken', 'brand.json'), '{ "version": 1 }');
    mkdirSync(join(root, '.acme-1234'));
    expect((await listBrands(root)).map((entry) => entry.kit.name)).toEqual(['Acme']);
    expect(await listBrands(join(root, 'none'))).toEqual([]);
  });

  it('replaces a kit of the same name', async () => {
    const root = temp();
    const project = await brandedProject();
    await saveBrand(project.dir, project.project, 'Acme', root);
    const plain = { ...project.project, theme: { ...project.project.theme, logo: undefined }, look: { ...project.project.look, background: { preset: 'aurora' as const } } };
    const brand = await saveBrand(project.dir, plain, 'ACME', root);
    expect(readdirSync(brand.dir)).toEqual(['brand.json']);
    expect(brand.kit.name).toBe('ACME');
    expect(readdirSync(root)).toEqual(['acme']);
  });

  it('refuses a kit without a name or whose logo is missing', async () => {
    const root = temp();
    const project = await brandedProject();
    expect(await failure(saveBrand(project.dir, project.project, '  ', root))).toMatchObject({ code: 'usage' });
    rmSync(join(project.dir, 'brand', 'mark.PNG'));
    const error = await failure(saveBrand(project.dir, project.project, 'Acme', root));
    expect(error).toBeInstanceOf(CoreError);
    expect(error).toMatchObject({ code: 'missing-file' });
    expect(readdirSync(root)).toEqual([]);
  });

  it('applies a kit: the theme, the background, the frame\'s and cursor\'s styles, its files copied in', async () => {
    const root = temp();
    const source = await brandedProject();
    await saveBrand(source.dir, source.project, 'Acme', root);
    const dir = temp();
    const fresh = (await writeProjectFile(newProjectFile(dir), 'init')).file;
    fresh.raw.look = { frame: { title: 'mine', radius: 4 }, cursor: { size: 2 } };
    const { fields } = await applyBrand(fresh, 'acme', root);
    expect(fields.theme).toEqual({ name: 'Acme', url: 'acme.dev', accent: '#3366FF', foreground: '#FFFFFF', font: 'Space Grotesk', logo: 'brand/acme-logo.png', kit: 'Acme' });
    expect(fresh.raw.look).toEqual({
      background: { preset: 'image', image: 'brand/acme-background.jpg' },
      frame: { title: 'mine', radius: 4, style: 'mac-light' },
      cursor: { size: 2, style: 'ring', color: '#3366FF' },
    });
    await writeProjectFile(fresh, 'brand apply');
    const read = await readProjectFile(dir);
    expect(read.project.theme.kit).toBe('Acme');
    expect(readFileSync(join(dir, 'brand', 'acme-logo.png'), 'utf8')).toBe('logo bytes');
    // applied again: the same files; after the kit's logo changed: a new file, the old one kept
    await applyBrand(read, 'Acme', root);
    expect(readdirSync(join(dir, 'brand')).sort()).toEqual(['acme-background.jpg', 'acme-logo.png']);
    writeFileSync(join(root, 'acme', 'logo.png'), 'new logo');
    const again = await applyBrand(read, 'Acme', root);
    expect(again.fields.theme.logo).toBe('brand/acme-logo-2.png');
    expect(readFileSync(join(dir, 'brand', 'acme-logo.png'), 'utf8')).toBe('logo bytes');
  });

  it('says which kit is missing, and removes one', async () => {
    const root = temp();
    expect(await failure(findBrand('Nope', root))).toMatchObject({ code: 'missing-file', message: expect.stringContaining('no brand kit "Nope"') });
    const project = await brandedProject();
    await saveBrand(project.dir, project.project, 'Acme', root);
    await removeBrand('Acme', root);
    expect(readdirSync(root)).toEqual([]);
  });
});
```

`apps/cli/test/brand.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../src/main';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-brand-'));
  dirs.push(dir);
  return dir;
};
// the kits go into a folder of the test's own, never the user's app data
const before = process.env.CUTTLE_BRANDS_DIR;
let brands = '';
beforeAll(() => {
  brands = temp();
  process.env.CUTTLE_BRANDS_DIR = brands;
});
afterAll(async () => {
  if (before === undefined) delete process.env.CUTTLE_BRANDS_DIR;
  else process.env.CUTTLE_BRANDS_DIR = before;
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const projectWith = (fields: Record<string, unknown>) => {
  const dir = temp();
  writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, ...fields }));
  return dir;
};
const project = (dir: string) => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { theme?: Record<string, unknown>; look?: Record<string, unknown> };

async function cli(...argv: string[]) {
  let stdout = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: () => {} });
  return { code, json: JSON.parse(stdout) as Record<string, unknown> };
}

describe('cuttle brand', () => {
  it('saves a project\'s brand, lists it, applies it to another project and removes it', async () => {
    expect((await cli('--json', 'brand', 'list')).json).toEqual({ dir: brands, brands: [] });
    const source = projectWith({
      theme: { name: 'Nimbus', url: 'nimbus.app', logo: 'brand/nimbus.svg', accent: '#7C5CFF', font: 'Fraunces' },
      look: { background: { preset: 'solid', color: '#0E0B1F' }, frame: { style: 'none' }, cursor: { style: 'dot', color: '#7C5CFF' } },
    });
    mkdirSync(join(source, 'brand'));
    writeFileSync(join(source, 'brand', 'nimbus.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const saved = await cli('--json', '-C', source, 'brand', 'save', 'Nimbus');
    expect(saved.code).toBe(0);
    expect(saved.json.brand).toMatchObject({ name: 'Nimbus', dir: join(brands, 'nimbus'), logo: join(brands, 'nimbus', 'logo.svg') });
    const listed = await cli('--json', 'brand');
    expect(listed.json.brands).toEqual([saved.json.brand]);

    const target = projectWith({ look: { frame: { title: 'nimbus · ~/demo' } } });
    const applied = await cli('--json', '-C', target, 'brand', 'apply', 'nimbus');
    expect(applied.code).toBe(0);
    expect(applied.json).toMatchObject({ brand: 'Nimbus', backup: expect.stringContaining('cuttle.json.bak') });
    expect(project(target).theme).toEqual({ name: 'Nimbus', url: 'nimbus.app', logo: 'brand/nimbus-logo.svg', accent: '#7C5CFF', foreground: '#FFFFFF', font: 'Fraunces', kit: 'Nimbus' });
    expect(project(target).look).toEqual({ frame: { title: 'nimbus · ~/demo', style: 'none' }, background: { preset: 'solid', color: '#0E0B1F' }, cursor: { style: 'dot', color: '#7C5CFF' } });
    expect(existsSync(join(target, 'brand', 'nimbus-logo.svg'))).toBe(true);

    expect((await cli('--json', 'brand', 'remove', 'Nimbus')).json).toEqual({ removed: 'Nimbus', dir: join(brands, 'nimbus') });
    expect((await cli('--json', 'brand', 'list')).json.brands).toEqual([]);
  });

  it('refuses what it cannot do', async () => {
    const dir = projectWith({ theme: { logo: 'brand/gone.png' } });
    expect((await cli('--json', '-C', dir, 'brand', 'apply', 'Nope')).json).toMatchObject({ error: { code: 'missing-file' } });
    expect((await cli('--json', '-C', dir, 'brand', 'save', 'Gone')).json).toMatchObject({ error: { code: 'missing-file' } });
    expect((await cli('--json', '-C', dir, 'brand', 'save', ' ')).json).toMatchObject({ error: { code: 'usage' } });
  });
});
```

Run: `pnpm exec vitest run --project node packages/core/test/brands.test.ts apps/cli/test/brand.test.ts`
Expected: FAIL: there is no `brands.ts`, and no `brand` command.

- [ ] **Step 2: The kits**

`packages/core/src/brands.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { BRAND_VERSION, parseBrandKitJson, type BrandKit, type CuttleProject } from '@cuttle/project';
import { CoreError } from './errors';
import type { ProjectFile } from './project-file';

/** A kit's file in its folder. */
export const BRAND_FILE = 'brand.json';
/** The folder in a project that a kit's files are copied into (and a logo the person picks). */
export const PROJECT_BRAND_DIR = 'brand';

/**
 * The folder the brand kits are kept in, one folder each: `CUTTLE_BRANDS_DIR` when set, else the
 * user's app data (`%APPDATA%\Cuttle\brands` on Windows, `~/Library/Application Support/Cuttle/brands`
 * on macOS, `$XDG_CONFIG_HOME/cuttle/brands` elsewhere).
 */
export function brandsDir(): string {
  if (process.env.CUTTLE_BRANDS_DIR) return process.env.CUTTLE_BRANDS_DIR;
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Cuttle', 'brands');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Cuttle', 'brands');
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'cuttle', 'brands');
}

/** A kit's folder name: its name in lower-case letters, digits and dashes ("Acme Café" is `acme-cafe`). */
export function brandSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug || 'brand';
}

/** A saved kit: what it holds, and where. */
export interface Brand {
  kit: BrandKit;
  /** Its folder name (`brandSlug` of its name). */
  slug: string;
  dir: string;
  /** Its logo and background image as files on disk. */
  logo?: string;
  image?: string;
}

const toBrand = (kit: BrandKit, dir: string, slug: string): Brand => ({
  kit,
  slug,
  dir,
  ...(kit.theme.logo && { logo: join(dir, kit.theme.logo) }),
  ...(kit.look.background.image && { image: join(dir, kit.look.background.image) }),
});

const issuesText = (issues: readonly { path: string; message: string }[]) => issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');

/** Every kit in the folder, by name; folders without a readable, valid `brand.json` are left out. */
export async function listBrands(root = brandsDir()): Promise<Brand[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const brands: Brand[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = join(root, entry.name);
    const text = await readFile(join(dir, BRAND_FILE), 'utf8').catch(() => undefined);
    const parsed = text === undefined ? undefined : parseBrandKitJson(text);
    if (parsed?.ok) brands.push(toBrand(parsed.kit, dir, entry.name));
  }
  return brands.sort((a, b) => a.kit.name.localeCompare(b.kit.name));
}

/** The kit of a name (its slug's folder). */
export async function findBrand(name: string, root = brandsDir()): Promise<Brand> {
  const slug = brandSlug(name);
  const dir = join(root, slug);
  const path = join(dir, BRAND_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CoreError('missing-file', `no brand kit "${name}" in ${root} ("cuttle brand list" lists them)`);
    throw new CoreError('missing-file', `cannot read ${path}: ${(error as Error).message}`, { cause: error });
  }
  const parsed = parseBrandKitJson(text);
  if (!parsed.ok) throw new CoreError('invalid-project', `${path} is not a valid brand kit:\n${issuesText(parsed.issues)}`);
  return toBrand(parsed.kit, dir, slug);
}

const isFile = (path: string) => stat(path).then((info) => info.isFile(), () => false);

/**
 * Saves a project's brand as a kit, replacing a kit of the same name: its theme, its background,
 * its frame's style and its cursor's style and colour, with copies of its logo and background image.
 */
export async function saveBrand(projectDir: string, project: CuttleProject, name: string, root = brandsDir()): Promise<Brand> {
  const trimmed = name.trim();
  if (!trimmed) throw new CoreError('usage', 'a brand kit needs a name');
  if (trimmed.length > 80) throw new CoreError('usage', 'a brand kit\'s name is 80 characters at most');
  const slug = brandSlug(trimmed);
  const files: { source: string; name: string }[] = [];
  const keep = (path: string, stem: string): string => {
    const file = `${stem}${extname(path).toLowerCase()}`;
    files.push({ source: resolve(projectDir, path), name: file });
    return file;
  };
  const { kit: _kit, logo, ...theme } = project.theme;
  const { image, ...background } = project.look.background;
  const kit: BrandKit = {
    version: BRAND_VERSION,
    name: trimmed,
    theme: { ...theme, ...(logo && { logo: keep(logo, 'logo') }) },
    look: {
      background: background.preset === 'image' && image ? { ...background, image: keep(image, 'background') } : background,
      frame: { style: project.look.frame.style },
      cursor: { style: project.look.cursor.style, color: project.look.cursor.color },
    },
  };
  for (const file of files) {
    if (!(await isFile(file.source))) throw new CoreError('missing-file', `${file.source} is not there: the brand's ${file.name.startsWith('logo') ? 'logo' : 'background image'} must be a file in the project`);
  }
  await mkdir(root, { recursive: true });
  // the kit is written beside its folder, then put in its place (a kit is never half written)
  const temp = join(root, `.${slug}-${randomUUID()}`);
  await mkdir(temp);
  try {
    for (const file of files) await copyFile(file.source, join(temp, file.name));
    await writeFile(join(temp, BRAND_FILE), `${JSON.stringify(kit, null, 2)}\n`);
    const dir = join(root, slug);
    await rm(dir, { recursive: true, force: true });
    await rename(temp, dir);
    return toBrand(kit, dir, slug);
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

/** Removes a kit. */
export async function removeBrand(name: string, root = brandsDir()): Promise<Brand> {
  const brand = await findBrand(name, root);
  await rm(brand.dir, { recursive: true, force: true });
  return brand;
}

/**
 * Copies a kit's file into the project's `brand/` folder as `<stem><ext>`: the file there already
 * when it has the same bytes, else the next free `<stem>-2<ext>`… (a file applied before is never
 * overwritten, so undoing an apply in the editor finds its own logo). Returns its project path.
 */
async function copyIntoProject(projectDir: string, source: string, stem: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(source);
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
export interface BrandFields {
  /** The whole theme, with the kit's name (`kit`). */
  theme: CuttleProject['theme'];
  /** `look.background` as a whole. */
  background: CuttleProject['look']['background'];
  frame: { style: CuttleProject['look']['frame']['style'] };
  cursor: { style: CuttleProject['look']['cursor']['style']; color: string };
}

/** Copies a kit's logo and background image into the project and returns what applying it sets. */
export async function brandFields(brand: Brand, projectDir: string): Promise<BrandFields> {
  const { logo: _logo, ...theme } = brand.kit.theme;
  const { image: _image, ...background } = brand.kit.look.background;
  return {
    theme: { ...theme, ...(brand.logo && { logo: await copyIntoProject(projectDir, brand.logo, `${brand.slug}-logo`) }), kit: brand.kit.name },
    background: { ...background, ...(brand.image && { image: await copyIntoProject(projectDir, brand.image, `${brand.slug}-background`) }) },
    frame: { ...brand.kit.look.frame },
    cursor: { ...brand.kit.look.cursor },
  };
}

/**
 * Applies a kit to a project file (`file.raw`, for the caller to write): the theme is replaced, the
 * look's background is set, and its frame's style and cursor's style and colour; the rest stays.
 */
export async function applyBrand(file: ProjectFile, name: string, root = brandsDir()): Promise<{ brand: Brand; fields: BrandFields }> {
  const brand = await findBrand(name, root);
  const fields = await brandFields(brand, file.dir);
  const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
  const look = object(file.raw.look);
  file.raw.theme = fields.theme;
  file.raw.look = { ...look, background: fields.background, frame: { ...object(look.frame), ...fields.frame }, cursor: { ...object(look.cursor), ...fields.cursor } };
  return { brand, fields };
}
```

In `packages/core/src/index.ts`, replace:

```ts
// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, run ffmpeg, and transcribe the mic (the speech models, whisper, the speech edits).
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
```

with:

```ts
// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, run ffmpeg, transcribe the mic (the speech models, whisper, the speech edits), and keep brand kits.
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
```

In the same file, replace:

```ts
export { applyPrivacy, readScreenTake, readScreenText, withPrivacyMasks, type PrivacyInput, type PrivacyMasksResult, type PrivacyResult, type RawMask } from './privacy/apply';
export { NOTIFICATION_RULES, notificationMasks, type NotificationMask } from './privacy/notifications';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
```

with:

```ts
export { applyPrivacy, readScreenTake, readScreenText, withPrivacyMasks, type PrivacyInput, type PrivacyMasksResult, type PrivacyResult, type RawMask } from './privacy/apply';
export { NOTIFICATION_RULES, notificationMasks, type NotificationMask } from './privacy/notifications';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
export { BRAND_FILE, PROJECT_BRAND_DIR, applyBrand, brandFields, brandSlug, brandsDir, findBrand, listBrands, removeBrand, saveBrand, type Brand, type BrandFields } from './brands';
```

- [ ] **Step 3: The commands**

`apps/cli/src/commands/brand.ts`:

```ts
import { applyBrand, brandsDir, listBrands, readProjectFile, removeBrand, saveBrand, writeProjectFile, type Brand, type BrandFields } from '@cuttle/core';
import type { BrandKit } from '@cuttle/project';
import type { Output } from '../output';

/** A kit as the commands report it: what it holds, its folder and its files. */
export interface BrandEntry extends BrandKit {
  dir: string;
  logo?: string;
  image?: string;
}

const entry = (brand: Brand): BrandEntry => ({ ...brand.kit, dir: brand.dir, ...(brand.logo && { logo: brand.logo }), ...(brand.image && { image: brand.image }) });

/** One line for people: the name, the colours and the font. */
const line = (kit: BrandKit) => `${kit.name.padEnd(20)} ${kit.theme.accent ?? kit.look.cursor.color} ${kit.theme.font}${kit.theme.url ? `  ${kit.theme.url}` : ''}${kit.theme.logo ? '  (logo)' : ''}`;

/** `cuttle brand list`: the saved brand kits, and where they are kept. */
export async function brandListCommand(output: Output): Promise<{ dir: string; brands: BrandEntry[] }> {
  const result = { dir: brandsDir(), brands: (await listBrands()).map(entry) };
  output.result(result, () => [...result.brands.map(line), result.brands.length ? `kept in ${result.dir}` : `no brand kits yet (save one: cuttle brand save <name>)`].join('\n'));
  return result;
}

/** `cuttle brand save <name>`: the project's brand as a kit (replacing a kit of that name). */
export async function brandSaveCommand(projectDir: string, name: string, output: Output): Promise<{ brand: BrandEntry }> {
  const file = await readProjectFile(projectDir);
  const result = { brand: entry(await saveBrand(file.dir, file.project, name)) };
  output.result(result, () => `saved the brand kit "${result.brand.name}" (${result.brand.dir})`);
  return result;
}

/** `cuttle brand apply <name>`: a kit's theme, background, frame style and cursor in the project, its files copied into brand/. */
export async function brandApplyCommand(projectDir: string, name: string, output: Output): Promise<{ brand: string; backup?: string } & BrandFields> {
  const file = await readProjectFile(projectDir);
  const { brand, fields } = await applyBrand(file, name);
  // it replaces the theme and the look's brand parts: the project as it was stays as cuttle.json.bak
  const { backup } = await writeProjectFile(file, 'brand apply', { backup: true });
  const result = { brand: brand.kit.name, ...fields, ...(backup && { backup }) };
  output.result(result, () => `the project wears "${brand.kit.name}" now: its theme, background (${fields.background.preset}), frame (${fields.frame.style}) and cursor (${fields.cursor.style}, ${fields.cursor.color})`);
  return result;
}

/** `cuttle brand remove <name>`: removes a saved kit (projects keep what it set). */
export async function brandRemoveCommand(name: string, output: Output): Promise<{ removed: string; dir: string }> {
  const brand = await removeBrand(name);
  const result = { removed: brand.kit.name, dir: brand.dir };
  output.result(result, () => `removed the brand kit "${result.removed}" (projects keep what it set)`);
  return result;
}
```

In `apps/cli/src/main.ts`, replace:

```ts
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { capturePageCommand } from './commands/capture-page';
import { devices } from './commands/devices';
import { fitCommand } from './commands/fit';
```

with:

```ts
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { brandApplyCommand, brandListCommand, brandRemoveCommand, brandSaveCommand } from './commands/brand';
import { capturePageCommand } from './commands/capture-page';
import { devices } from './commands/devices';
import { fitCommand } from './commands/fit';
```

In the same file, replace:

```ts
    .option('-o, --out <dir>', 'folder for music.wav and music.png (default: preview/ in the project)')
    .action(action((output, project, options: { src?: string; out?: string }) => withSignal(output, (signal) => musicCheckCommand(project, options, output, signal))));

  const sound = program.command('sound').description('sounds at moments of the video: built-in effects or files of the project');
  sound
    .command('list')
```

with:

```ts
    .option('-o, --out <dir>', 'folder for music.wav and music.png (default: preview/ in the project)')
    .action(action((output, project, options: { src?: string; out?: string }) => withSignal(output, (signal) => musicCheckCommand(project, options, output, signal))));

  const brand = program.command('brand').description('brand kits: a project\'s theme (name, URL, logo, colours, heading font), background, frame and cursor, saved once and applied with one command');
  brand
    .command('list', { isDefault: true })
    .description('the saved brand kits, and where they are kept')
    .action(action((output) => brandListCommand(output)));
  brand
    .command('save <name>')
    .description('save the project\'s brand as a kit (replaces a kit of that name), with copies of its logo and background image')
    .action(action((output, project, name: string) => brandSaveCommand(project, name, output)));
  brand
    .command('apply <name>')
    .description('set a kit\'s theme, background, frame style and cursor in the project (its files are copied into brand/)')
    .action(action((output, project, name: string) => brandApplyCommand(project, name, output)));
  brand
    .command('remove <name>')
    .description('remove a saved kit (projects keep what it set)')
    .action(action((output, _project, name: string) => brandRemoveCommand(name, output)));

  const sound = program.command('sound').description('sounds at moments of the video: built-in effects or files of the project');
  sound
    .command('list')
```

Run: `pnpm exec vitest run --project node packages/core/test/brands.test.ts apps/cli/test/brand.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core apps/cli
git commit -m "core, cli: brand kits, saved from a project with its files and applied to another; cuttle brand list, save, apply, remove

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Look tab's Brand part

**Files:**
- Create: `apps/desktop/src/main/brands.ts`, `apps/desktop/src/renderer/editor/brand.ts`
- Modify: `apps/desktop/src/shared/document.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/shared/media-path.ts`, `apps/desktop/src/main/windows.ts`, `apps/desktop/src/main/project-watch.ts`, `apps/desktop/src/renderer/editor/Inspector.tsx`, `apps/desktop/src/renderer/editor/actions.ts`, `apps/desktop/src/renderer/editor/session.ts`, `apps/desktop/src/renderer/editor/editor.css`, `apps/desktop/src/renderer/icons.tsx`, `apps/desktop/test/document.test.ts`, `apps/desktop/test/protocol.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/test/document.test.ts`, replace:

```ts
    expect(() => applyCommand(base, { type: 'music', fields: { volume: 0.5 } }, limits)).toThrow(DocumentError);
  });

  it('shifts overlays in source seconds, never before 0', () => {
    const next = applyCommand(base, { type: 'shift', list: 'zooms', id: 'z1', by: -10 }, limits);
    expect((next.zooms as { at: number }[])[0]!.at).toBe(0);
```

with:

```ts
    expect(() => applyCommand(base, { type: 'music', fields: { volume: 0.5 } }, limits)).toThrow(DocumentError);
  });

  it('sets the theme: fields merged and removed, or replaced as a whole (a brand kit)', () => {
    let next = applyCommand(base, { type: 'theme', fields: { name: 'Acme', accent: '#3366FF' } }, limits);
    expect(next.theme).toEqual({ name: 'Acme', accent: '#3366FF' });
    expect(describeChange(project(base), project(next))).toBe('the brand changed');
    next = applyCommand(next, { type: 'theme', fields: { accent: undefined, font: 'Bebas Neue' } }, limits);
    expect(next.theme).toEqual({ name: 'Acme', font: 'Bebas Neue' });
    const kit = applyCommand(next, { type: 'theme', fields: { url: 'acme.dev', kit: 'Acme', logo: undefined }, replace: true }, limits);
    expect(kit.theme).toEqual({ url: 'acme.dev', kit: 'Acme' });
    expect(() => applyCommand(base, { type: 'theme', fields: { font: 'Comic Sans' } }, limits)).toThrow(DocumentError);
  });

  it('shifts overlays in source seconds, never before 0', () => {
    const next = applyCommand(base, { type: 'shift', list: 'zooms', id: 'z1', by: -10 }, limits);
    expect((next.zooms as { at: number }[])[0]!.at).toBe(0);
```

In `apps/desktop/test/protocol.test.ts`, replace:

```ts
  });

  it('serves the media types the editor reads', () => {
    expect(['a.mp4', 'b.M4A', 'c.png', 'd.jsonl', 'e.bin', 'f.exe'].map(mediaType)).toEqual([
      'video/mp4',
      'audio/mp4',
      'image/png',
      'application/x-ndjson',
      'application/octet-stream',
      'application/octet-stream',
```

with:

```ts
  });

  it('serves the media types the editor reads', () => {
    expect(['a.mp4', 'b.M4A', 'c.png', 'logo.svg', 'd.jsonl', 'e.bin', 'f.exe'].map(mediaType)).toEqual([
      'video/mp4',
      'audio/mp4',
      'image/png',
      'image/svg+xml',
      'application/x-ndjson',
      'application/octet-stream',
      'application/octet-stream',
```

Run: `pnpm exec vitest run --project node apps/desktop/test/document.test.ts apps/desktop/test/protocol.test.ts`
Expected: FAIL: there is no `theme` command, and an SVG is served as bytes.

- [ ] **Step 2: The `theme` command, the requests, SVG**

In `apps/desktop/src/shared/document.ts`, replace:

```ts
  /** Replaces every scene (Show raw take). */
  | { type: 'scenes'; scenes: Item[] }
  /** Sets fields of the music (`undefined` removes a field); `null` removes the music. */
  | { type: 'music'; fields: Item | null };

/** A command that cannot run: its item is gone (`gone`) or the result is not a valid project (`invalid`). */
export class DocumentError extends Error {
```

with:

```ts
  /** Replaces every scene (Show raw take). */
  | { type: 'scenes'; scenes: Item[] }
  /** Sets fields of the music (`undefined` removes a field); `null` removes the music. */
  | { type: 'music'; fields: Item | null }
  /** Sets fields of the theme, the project's brand (`undefined` removes a field); `replace`: `fields` are the whole theme (a brand kit applied). */
  | { type: 'theme'; fields: Item; replace?: boolean };

/** A command that cannot run: its item is gone (`gone`) or the result is not a valid project (`invalid`). */
export class DocumentError extends Error {
```

In the same file, replace:

```ts
      }
      break;
    }
    case 'output': {
      const output = (next.output && typeof next.output === 'object' ? next.output : (next.output = {})) as Item;
      output.width = command.width;
```

with:

```ts
      }
      break;
    }
    case 'theme': {
      const theme = (!command.replace && next.theme && typeof next.theme === 'object' ? next.theme : (next.theme = {})) as Item;
      setFields(theme, structuredClone(command.fields));
      break;
    }
    case 'output': {
      const output = (next.output && typeof next.output === 'object' ? next.output : (next.output = {})) as Item;
      output.width = command.width;
```

In the same file, replace:

```ts
  }
  if (JSON.stringify(before.music) !== JSON.stringify(after.music)) parts.push(!before.music ? 'music added' : !after.music ? 'the music removed' : 'the music changed');
  if (JSON.stringify(before.look) !== JSON.stringify(after.look)) parts.push('the look changed');
  if (JSON.stringify(before.autoEdits) !== JSON.stringify(after.autoEdits)) parts.push('the automatic edits changed');
  if (JSON.stringify(before.output) !== JSON.stringify(after.output)) parts.push('the output size changed');
  if (JSON.stringify(before.captions) !== JSON.stringify(after.captions)) parts.push('the subtitles changed');
```

with:

```ts
  }
  if (JSON.stringify(before.music) !== JSON.stringify(after.music)) parts.push(!before.music ? 'music added' : !after.music ? 'the music removed' : 'the music changed');
  if (JSON.stringify(before.look) !== JSON.stringify(after.look)) parts.push('the look changed');
  if (JSON.stringify(before.theme) !== JSON.stringify(after.theme)) parts.push('the brand changed');
  if (JSON.stringify(before.autoEdits) !== JSON.stringify(after.autoEdits)) parts.push('the automatic edits changed');
  if (JSON.stringify(before.output) !== JSON.stringify(after.output)) parts.push('the output size changed');
  if (JSON.stringify(before.captions) !== JSON.stringify(after.captions)) parts.push('the subtitles changed');
```

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
  speech: { start: number; end: number }[];
} | null;

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const box = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
/** A frame (premultiplied RGBA, top row first) whose bytes fit its size. */
```

with:

```ts
  speech: { start: number; end: number }[];
} | null;

/** A saved brand kit, as the Look tab lists it: its name, and its accent, background and heading font for its chip. */
export interface BrandView {
  name: string;
  accent: string;
  background: { preset: string; color?: string };
  font: string;
}

/** What applying a kit sets, its files already copied into the project: the whole theme, and the look's brand parts. */
export interface BrandApplied {
  theme: Record<string, unknown>;
  background: Record<string, unknown>;
  frame: { style: string };
  cursor: { style: string; color: string };
}

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const box = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
/** A frame (premultiplied RGBA, top row first) whose bytes fit its size. */
```

In the same file, replace:

```ts
      base: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  'project:import-image': z.strictObject({ purpose: z.enum(['still', 'background']) }),
  'project:draft': z.strictObject({ raw: z.record(z.string(), z.unknown()) }).refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  /** The page asks to be loaded anew (another take): a page cannot reload itself (navigation is refused). */
  'project:reload': z.undefined(),
```

with:

```ts
      base: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  'project:import-image': z.strictObject({ purpose: z.enum(['still', 'background', 'logo']) }),
  /** The brand kits saved on this computer. */
  'brand:list': z.undefined(),
  /** Saves the project's brand, as this version of it has it, as a kit (a kit of that name is replaced). */
  'brand:save': z
    .strictObject({ name: z.string().trim().min(1).max(80), raw: z.record(z.string(), z.unknown()) })
    .refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  /** Copies a kit's files into the project and answers what applying it sets (the page makes it one edit). */
  'brand:apply': z.string().trim().min(1).max(80),
  'brand:remove': z.string().trim().min(1).max(80),
  'project:draft': z.strictObject({ raw: z.record(z.string(), z.unknown()) }).refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  /** The page asks to be loaded anew (another take): a page cannot reload itself (navigation is refused). */
  'project:reload': z.undefined(),
```

In the same file, replace:

```ts
  'project:save': { hash: string } | { conflict: ProjectVersion & { origin: ChangeOrigin } } | { problem: string };
  /** An image chosen by the person, copied into the project when it lay outside (a path inside the project). */
  'project:import-image': { path: string } | undefined;
  /** The person's version a save conflict could not carry over, written to cuttle.json.draft. */
  'project:draft': void;
  'project:reload': void;
```

with:

```ts
  'project:save': { hash: string } | { conflict: ProjectVersion & { origin: ChangeOrigin } } | { problem: string };
  /** An image chosen by the person, copied into the project when it lay outside (a path inside the project). */
  'project:import-image': { path: string } | undefined;
  'brand:list': BrandView[];
  /** The kits after the change, or why it could not be made. */
  'brand:save': { brands: BrandView[] } | { problem: string };
  'brand:apply': BrandApplied | { problem: string };
  'brand:remove': { brands: BrandView[] } | { problem: string };
  /** The person's version a save conflict could not carry over, written to cuttle.json.draft. */
  'project:draft': void;
  'project:reload': void;
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
      'project:fit-length',
      'project:save',
      'project:import-image',
      'project:draft',
      'project:reload',
      'project:closed',
```

with:

```ts
      'project:fit-length',
      'project:save',
      'project:import-image',
      'brand:list',
      'brand:save',
      'brand:apply',
      'brand:remove',
      'project:draft',
      'project:reload',
      'project:closed',
```

In `apps/desktop/src/shared/media-path.ts`, replace:

```ts
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.bin': 'application/octet-stream',
```

with:

```ts
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  // a brand's logo (shown in an <img>, where an SVG runs no script)
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.bin': 'application/octet-stream',
```

Run: `pnpm exec vitest run --project node apps/desktop/test/document.test.ts apps/desktop/test/protocol.test.ts apps/desktop/test/contract.test.ts`
Expected: PASS.

- [ ] **Step 3: The main process**

`apps/desktop/src/main/brands.ts`:

```ts
// The brand kits for the editor's Look tab: listed, saved from the project as the page has it,
// applied (their files copied into the project; the page makes the edit) and removed.
import { brandFields, brandsDir, CoreError, findBrand, listBrands, removeBrand, saveBrand, type Brand } from '@cuttle/core';
import { parseProject } from '@cuttle/project';
import type { BrandApplied, BrandView } from '../shared/ipc';
import { CHECK } from './check';

/** The kits' folder; the check keeps them in a folder of its own, never the user's. */
function root(): string {
  if (CHECK && !process.env.CUTTLE_BRANDS_DIR) throw new Error('the check sets no CUTTLE_BRANDS_DIR');
  return brandsDir();
}

const view = ({ kit }: Brand): BrandView => ({
  name: kit.name,
  accent: kit.theme.accent ?? kit.look.cursor.color,
  background: { preset: kit.look.background.preset, ...(kit.look.background.color && { color: kit.look.background.color }) },
  font: kit.theme.font,
});

/** A failure the person can act on, as the page shows it. */
const problem = (error: unknown): { problem: string } => {
  if (error instanceof CoreError) return { problem: error.message };
  throw error;
};

export const brandViews = async (): Promise<BrandView[]> => (await listBrands(root())).map(view);

export async function saveProjectBrand(dir: string, name: string, raw: Record<string, unknown>): Promise<{ brands: BrandView[] } | { problem: string }> {
  const parsed = parseProject(raw);
  if (!parsed.ok) return { problem: 'the project is not valid right now' };
  try {
    await saveBrand(dir, parsed.project, name, root());
    return { brands: await brandViews() };
  } catch (error) {
    return problem(error);
  }
}

export async function applyProjectBrand(dir: string, name: string): Promise<BrandApplied | { problem: string }> {
  try {
    return await brandFields(await findBrand(name, root()), dir);
  } catch (error) {
    return problem(error);
  }
}

export async function removeProjectBrand(name: string): Promise<{ brands: BrandView[] } | { problem: string }> {
  try {
    await removeBrand(name, root());
    return { brands: await brandViews() };
  } catch (error) {
    return problem(error);
  }
}
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
import { isInside } from '../shared/media-path';
import { takeKey } from '../shared/take';
import { CHECK, CHECK_IMAGE, HIDDEN } from './check';
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
```

with:

```ts
import { isInside } from '../shared/media-path';
import { takeKey } from '../shared/take';
import { CHECK, CHECK_IMAGE, HIDDEN } from './check';
import { applyProjectBrand, brandViews, removeProjectBrand, saveProjectBrand } from './brands';
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
```

In the same file, replace:

```ts
        CHECK_IMAGE ??
        (
          await dialog.showOpenDialog(window, {
            title: purpose === 'still' ? 'An image for the page' : 'A background image',
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
          })
        ).filePaths[0];
      return chosen ? { path: await importImage(dir, chosen) } : undefined;
    },
  });
  editor.watch.start(file.hash);
  contents.on('did-finish-load', () => send(contents, 'project:status', editor.status ?? {}));
```

with:

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
      return chosen ? { path: await importImage(dir, chosen, purpose === 'logo' ? 'brand' : 'images') } : undefined;
    },
    'brand:list': () => brandViews(),
    'brand:save': ({ name, raw }) => saveProjectBrand(dir, name, raw),
    'brand:apply': (name) => applyProjectBrand(dir, name),
    'brand:remove': (name) => removeProjectBrand(name),
  });
  editor.watch.start(file.hash);
  contents.on('did-finish-load', () => send(contents, 'project:status', editor.status ?? {}));
```

In `apps/desktop/src/main/project-watch.ts`, replace:

```ts
}

/**
 * An image for a still or the background, as a project path: one inside the project as it is, one
 * outside copied into `images/` (a file of the same name and the same bytes there is that copy).
 */
const sameBytes = async (a: string, b: string) => (await readFile(a)).equals(await readFile(b));

export async function importImage(dir: string, file: string): Promise<string> {
  const root = await realpath(dir);
  const real = await realpath(file);
  const relativePath = (path: string) => relative(root, path).split(sep).join('/');
  if (isInside(real, root, process.platform)) return relativePath(real);
  const folder = join(root, 'images');
  await mkdir(folder, { recursive: true });
  const size = (await stat(real)).size;
  const stem = basename(real, extname(real)).replace(/[^\w.-]+/g, '-') || 'image';
```

with:

```ts
}

/**
 * An image for a still, the background or the logo, as a project path: one inside the project as it
 * is, one outside copied into `images/` (a logo into `brand/`; a file of the same name and the same
 * bytes there is that copy).
 */
const sameBytes = async (a: string, b: string) => (await readFile(a)).equals(await readFile(b));

export async function importImage(dir: string, file: string, into = 'images'): Promise<string> {
  const root = await realpath(dir);
  const real = await realpath(file);
  const relativePath = (path: string) => relative(root, path).split(sep).join('/');
  if (isInside(real, root, process.platform)) return relativePath(real);
  const folder = join(root, into);
  await mkdir(folder, { recursive: true });
  const size = (await stat(real)).size;
  const stem = basename(real, extname(real)).replace(/[^\w.-]+/g, '-') || 'image';
```

- [ ] **Step 4: The panel**

The kits' actions (apply as one edit, save, remove):

`apps/desktop/src/renderer/editor/brand.ts`:

```ts
// The brand kits in the editor: applied as one step to undo (the main process copies their files
// into the project first), saved from the page's version of the project, and removed.
import type { BrandView } from '../../shared/ipc';
import { bridge } from '../bridge';
import { edit, toast } from './doc';
import { documentProject, store } from './session';

/** Applies a saved kit: its theme, background, frame style and cursor, one step to undo. */
export async function applyBrandKit(name: string): Promise<void> {
  const applied = await bridge.invoke('brand:apply', name);
  if ('problem' in applied) return toast(applied.problem, { tone: 'warning' });
  edit(
    [
      { type: 'theme', fields: applied.theme, replace: true },
      { type: 'look', path: ['background'], value: applied.background },
      { type: 'look', path: ['frame', 'style'], value: applied.frame.style },
      { type: 'look', path: ['cursor', 'style'], value: applied.cursor.style },
      { type: 'look', path: ['cursor', 'color'], value: applied.cursor.color },
    ],
    `Brand: ${name}`,
  );
}

/** The kits after a change, or undefined when it could not be made (a toast says why). */
function kitsAfter(result: { brands: BrandView[] } | { problem: string }): BrandView[] | undefined {
  if (!('problem' in result)) return result.brands;
  toast(result.problem, { tone: 'warning' });
  return undefined;
}

/** Saves the project's brand as a kit (a kit of that name is replaced); the project then wears it. */
export async function saveBrandKit(name: string): Promise<BrandView[] | undefined> {
  const raw = store.get().doc?.raw;
  if (!raw) return undefined;
  const brands = kitsAfter(await bridge.invoke('brand:save', { name, raw }));
  if (!brands) return undefined;
  if (documentProject()?.theme.kit !== name) edit([{ type: 'theme', fields: { kit: name } }], `Saved as kit: ${name}`);
  toast(`Saved the brand kit “${name}”: apply it to any project from here.`);
  return brands;
}

/** Removes a kit; projects keep what it set. */
export async function removeBrandKit(name: string): Promise<BrandView[] | undefined> {
  const brands = kitsAfter(await bridge.invoke('brand:remove', name));
  if (brands) toast(`Removed the brand kit “${name}”. Projects keep what it set.`);
  return brands;
}
```

A logo chosen from a file, the Look tab's new part, the panel:

In `apps/desktop/src/renderer/editor/actions.ts`, replace:

```ts
  if (added?.id) select({ kind: 'sound', id: added.id });
}

/** Replaces a still's image or the background's with one the person picks. */
export async function chooseImage(purpose: 'still' | 'background', id?: string): Promise<void> {
  const chosen = await bridge.invoke('project:import-image', { purpose });
  if (!chosen) return;
  if (purpose === 'still' && id) edit([{ type: 'set', list: 'scenes', id, fields: { image: chosen.path } }], 'Replace image');
  else edit([{ type: 'look', path: ['background'], value: { preset: 'image', image: chosen.path } }], 'Background image');
}
```

with:

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

In `apps/desktop/src/renderer/editor/session.ts`, replace:

```ts
export type Tool = 'select' | 'zoom' | 'mask' | 'caption' | 'crop';

/** The look's parts, as the Look tab lists them. */
export type LookSection = 'background' | 'window' | 'cursor' | 'camera' | 'subtitles' | 'sound' | 'video';

export interface EditorState {
  phase: 'loading' | 'ready' | 'failed';
```

with:

```ts
export type Tool = 'select' | 'zoom' | 'mask' | 'caption' | 'crop';

/** The look's parts, as the Look tab lists them. */
export type LookSection = 'brand' | 'background' | 'window' | 'cursor' | 'camera' | 'subtitles' | 'sound' | 'video';

export interface EditorState {
  phase: 'loading' | 'ready' | 'failed';
```

In `apps/desktop/src/renderer/icons.tsx`, replace:

```tsx
export const RecordIcon = icon(<circle cx="8" cy="8" r="5" />, true);
export const ChevronIcon = icon(<path d="m4.5 6 3.5 3.5L11.5 6" />);
// the look's parts
export const BackgroundIcon = icon(<path d="M2.5 3.5h11v9h-11zM2.5 10l3.2-3 2.6 2.4L10.5 7.5l3 2.8" />);
export const WindowIcon = icon(<path d="M2 3.5h12v9H2zM2 6h12M3.8 4.8h.1M5.3 4.8h.1" />);
export const CameraIcon = icon(<path d="M8 8.2a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6zM3.6 13.5c.6-2.3 2.3-3.5 4.4-3.5s3.8 1.2 4.4 3.5" />);
```

with:

```tsx
export const RecordIcon = icon(<circle cx="8" cy="8" r="5" />, true);
export const ChevronIcon = icon(<path d="m4.5 6 3.5 3.5L11.5 6" />);
// the look's parts
export const BrandIcon = icon(<path d="M2.5 2.5h5.2l5.8 5.8-5.2 5.2-5.8-5.8zM5.4 5.4h.1" />);
export const BackgroundIcon = icon(<path d="M2.5 3.5h11v9h-11zM2.5 10l3.2-3 2.6 2.4L10.5 7.5l3 2.8" />);
export const WindowIcon = icon(<path d="M2 3.5h12v9H2zM2 6h12M3.8 4.8h.1M5.3 4.8h.1" />);
export const CameraIcon = icon(<path d="M8 8.2a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6zM3.6 13.5c.6-2.3 2.3-3.5 4.4-3.5s3.8 1.2 4.4 3.5" />);
```

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```tsx
  STILL_MOTIONS,
  TEXT_POSITIONS,
  TEXT_STYLES,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
  type AutoEdits,
```

with:

```tsx
  STILL_MOTIONS,
  TEXT_POSITIONS,
  TEXT_STYLES,
  THEME_FONTS,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
  type AutoEdits,
```

In the same file, replace:

```tsx
  type MotionScene,
  type Music,
  type Rect,
} from '@cuttle/project';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { sceneSpans, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import type { MotionParams, MotionStatusView, SoundStatusView } from '../../shared/ipc';
import { formatDuration, formatSource, formatSpeed, formatTime } from '../../shared/format';
import {
  BACKGROUND_NAMES,
```

with:

```tsx
  type MotionScene,
  type Music,
  type Rect,
  type ThemeFont,
  backgroundTone,
} from '@cuttle/project';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { sceneSpans, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import { MEDIA_ORIGIN, type BrandView, type MotionParams, type MotionStatusView, type SoundStatusView } from '../../shared/ipc';
import { formatDuration, formatSource, formatSpeed, formatTime } from '../../shared/format';
import {
  BACKGROUND_NAMES,
```

In the same file, replace:

```tsx
import { BUILT_IN_SOUNDS } from '@cuttle/motion-kit';
import {
  BackgroundIcon,
  CameraIcon,
  CardIcon,
  CheckIcon,
  ChevronIcon,
  CopyIcon,
  CropIcon,
  FilmIcon,
```

with:

```tsx
import { BUILT_IN_SOUNDS } from '@cuttle/motion-kit';
import {
  BackgroundIcon,
  BrandIcon,
  CameraIcon,
  CardIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  CopyIcon,
  CropIcon,
  FilmIcon,
```

In the same file, replace:

```tsx
import { useStore } from './store';
import { PrivacyNote } from './PrivacyNote';
import { SpeechNote, TranscriptPanel } from './Transcript';

const TABS = [
  { id: 'selection', name: 'Selection' },
```

with:

```tsx
import { useStore } from './store';
import { PrivacyNote } from './PrivacyNote';
import { SpeechNote, TranscriptPanel } from './Transcript';
import { applyBrandKit, removeBrandKit, saveBrandKit } from './brand';

const TABS = [
  { id: 'selection', name: 'Selection' },
```

In the same file, replace:

```tsx

/** The look's parts, in the order the tab lists them. */
const LOOK_PARTS: { id: LookSection; title: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'background', title: 'Background', icon: BackgroundIcon },
  { id: 'window', title: 'Window', icon: WindowIcon },
  { id: 'cursor', title: 'Cursor', icon: SelectIcon },
```

with:

```tsx

/** The look's parts, in the order the tab lists them. */
const LOOK_PARTS: { id: LookSection; title: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'brand', title: 'Brand', icon: BrandIcon },
  { id: 'background', title: 'Background', icon: BackgroundIcon },
  { id: 'window', title: 'Window', icon: WindowIcon },
  { id: 'cursor', title: 'Cursor', icon: SelectIcon },
```

In the same file, replace:

```tsx
  );
}

function LookPanel() {
  const project = useStore(store, (state) => state.doc?.project);
  const raw = useStore(store, (state) => state.doc?.raw);
```

with:

```tsx
  );
}

/** The theme's fields as one step to undo (`undefined` removes one). */
const setTheme = (fields: Record<string, unknown>, label: string) => edit([{ type: 'theme', fields }], label);

/** A kit's chip: its background as a tile with its accent on it, and its name. */
function KitTone({ kit }: { kit: BrandView }) {
  return (
    <i className={`kit-tone bg-${kit.background.preset}`} style={kit.background.preset === 'solid' && kit.background.color ? { background: kit.background.color } : undefined}>
      <b style={{ background: kit.accent }} />
    </i>
  );
}

/**
 * The project's brand, which its motion pages read (titles, end cards, lower thirds, every colour):
 * the saved kits as chips that apply with one click, then the name, URL, logo, colours and heading
 * font, and saving it all as a kit for the next video.
 */
function BrandFields({ project }: { project: CuttleProject }) {
  const { theme, look: current } = project;
  const [kits, setKits] = useState<BrandView[]>();
  const [removing, setRemoving] = useState<string>();
  const [kitName, setKitName] = useState('');
  useEffect(() => {
    let live = true;
    void bridge.invoke('brand:list').then((list) => live && setKits(list));
    return () => {
      live = false;
    };
  }, []);
  const save = async () => {
    const name = (kitName || theme.name || '').trim();
    if (!name) return;
    const brands = await saveBrandKit(name);
    if (!brands) return;
    setKits(brands);
    setKitName('');
  };
  const remove = async (name: string) => {
    setRemoving(undefined);
    const brands = await removeBrandKit(name);
    if (brands) setKits(brands);
  };
  return (
    <>
      {kits && kits.length > 0 && (
        <div className="kits" role="group" aria-label="Brand kits">
          {kits.map((kit) => (
            <span key={kit.name} className="kit">
              <button type="button" className="chip" aria-pressed={theme.kit === kit.name} title={`Apply ${kit.name}: its brand, background, frame and cursor`} onClick={() => void applyBrandKit(kit.name)} data-testid="brand-kit">
                <KitTone kit={kit} />
                {kit.name}
              </button>
              <button type="button" className="kit-remove" aria-label={`Remove the kit ${kit.name}`} title="Remove this kit" onClick={() => setRemoving(kit.name)}>
                <CloseIcon size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {removing && (
        <div className="kit-confirm" role="alert">
          <span>
            Remove the kit “{removing}”? Projects keep what it set.
          </span>
          <button type="button" className="ghost small" onClick={() => setRemoving(undefined)}>
            Keep
          </button>
          <button type="button" className="primary small danger" onClick={() => void remove(removing)}>
            Remove
          </button>
        </div>
      )}
      {kits && kits.length === 0 && <p className="hint">No brand kits yet: set the brand below, then save it as a kit to use it in the next video with one click.</p>}
      <div className="grid2">
        <Row label="Name">
          <TextInput value={theme.name ?? ''} placeholder="the product" onCommit={(name) => setTheme({ name: name.trim() || undefined }, 'Brand name')} testId="brand-name" />
        </Row>
        <Row label="URL">
          <TextInput value={theme.url ?? ''} placeholder="example.com" onCommit={(url) => setTheme({ url: url.trim() || undefined }, 'Brand URL')} testId="brand-url" />
        </Row>
      </div>
      <Row label="Logo" plain>
        {theme.logo ? (
          <>
            <img className="logo-thumb" src={`${MEDIA_ORIGIN}/${theme.logo.split('/').map(encodeURIComponent).join('/')}`} alt="" />
            <span className="path" title={theme.logo}>
              {theme.logo.split('/').pop()}
            </span>
            <button type="button" className="ghost small" onClick={() => setTheme({ logo: undefined }, 'No logo')}>
              Remove
            </button>
          </>
        ) : (
          <span className="path">none: end cards show the name’s first letter</span>
        )}
        <button type="button" className="ghost small" onClick={() => void chooseImage('logo')} data-testid="brand-logo">
          {theme.logo ? 'Replace…' : 'Choose…'}
        </button>
      </Row>
      <div className="grid2">
        <Row label="Accent" note={theme.accent ? undefined : 'the cursor’s colour'}>
          <ColorInput value={theme.accent ?? current.cursor.color} label="Accent colour" upper toCommand={(accent) => ({ type: 'theme', fields: { accent } })} />
        </Row>
        <Row label="Text">
          <ColorInput value={theme.foreground} label="Text colour" upper toCommand={(foreground) => ({ type: 'theme', fields: { foreground } })} />
        </Row>
      </div>
      <Row label="Headings">
        <StyledSelect value={theme.font} options={THEME_FONTS.map((font) => ({ value: font, label: font, note: FONT_NOTES[font] }))} onChange={(font) => setTheme({ font }, `Headings: ${font}`)} label="Heading font" testId="brand-font" />
      </Row>
      <Row label="Pages’ background" note={theme.background ? undefined : 'a dark tone of the background'}>
        <ColorInput value={theme.background ?? backgroundTone(current.background)} label="Pages’ background" upper toCommand={(background) => ({ type: 'theme', fields: { background } })} />
        {theme.background && (
          <button type="button" className="ghost small" onClick={() => setTheme({ background: undefined }, 'Pages’ background from the background')}>
            Reset
          </button>
        )}
      </Row>
      <Row label="Save as a kit" plain>
        <span className="kit-save" title="The brand, the background, the frame and the cursor, for the next video; a kit of the same name is replaced">
          <input type="text" value={kitName} placeholder={theme.name || 'a name'} onChange={(event) => setKitName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void save()} aria-label="The kit's name" data-testid="brand-kit-name" />
          <button type="button" className="ghost small" disabled={!(kitName || theme.name || '').trim()} onClick={() => void save()} data-testid="brand-save">
            Save
          </button>
        </span>
      </Row>
    </>
  );
}

/** What each heading font is like, in the font list. */
const FONT_NOTES: Record<ThemeFont, string> = {
  Archivo: 'wide, bold',
  Inter: 'plain',
  'Space Grotesk': 'technical',
  Fraunces: 'warm serif',
  'Instrument Serif': 'editorial serif',
  'Bebas Neue': 'tall capitals',
};

function LookPanel() {
  const project = useStore(store, (state) => state.doc?.project);
  const raw = useStore(store, (state) => state.doc?.raw);
```

In the same file, replace:

```tsx
  const { look: current, output, sources, captions } = project;
  const size = SIZES.find((item) => item.width === output.width && item.height === output.height);
  const webcam = current.webcam;
  const summaries: Record<LookSection, string> = {
    background: current.background.preset === 'solid' ? `Solid · ${(current.background.color ?? '#1c1c22').toUpperCase()}` : BACKGROUND_NAMES[current.background.preset],
    window: current.frame.enabled ? [FRAME_NAMES[current.frame.style], current.frame.title].filter(Boolean).join(' · ') : 'No frame',
    cursor: current.cursor.enabled ? `${CURSOR_NAMES[current.cursor.style]} · ${current.cursor.size}×` : 'Hidden',
```

with:

```tsx
  const { look: current, output, sources, captions } = project;
  const size = SIZES.find((item) => item.width === output.width && item.height === output.height);
  const webcam = current.webcam;
  const theme = project.theme;
  const summaries: Record<LookSection, string> = {
    brand: theme.kit ? `Kit · ${theme.kit}` : [theme.name, theme.font !== 'Archivo' && theme.font].filter(Boolean).join(' · ') || 'None set',
    background: current.background.preset === 'solid' ? `Solid · ${(current.background.color ?? '#1c1c22').toUpperCase()}` : BACKGROUND_NAMES[current.background.preset],
    window: current.frame.enabled ? [FRAME_NAMES[current.frame.style], current.frame.title].filter(Boolean).join(' · ') : 'No frame',
    cursor: current.cursor.enabled ? `${CURSOR_NAMES[current.cursor.style]} · ${current.cursor.size}×` : 'Hidden',
```

In the same file, replace:

```tsx
  };
  return (
    <div className="look-parts">
      <LookPart id="background" summary={summaries.background}>
        <div className="swatches" role="group" aria-label="Background">
          {BACKGROUND_PRESETS.map((preset) => (
```

with:

```tsx
  };
  return (
    <div className="look-parts">
      <LookPart id="brand" summary={summaries.brand}>
        <BrandFields project={project} />
      </LookPart>

      <LookPart id="background" summary={summaries.background}>
        <div className="swatches" role="group" aria-label="Background">
          {BACKGROUND_PRESETS.map((preset) => (
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```css
  gap: 10px;
  padding: 2px 12px 12px;
}
/* switches that read as words: on is filled, with a tick */
.chips {
  display: flex;
```

with:

```css
  gap: 10px;
  padding: 2px 12px 12px;
}
/* the Brand part: saved kits as chips (a tile of the kit's background with its accent on it), each
   with a quiet remove button that asks first */
.kits {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.kit {
  display: inline-flex;
  align-items: center;
  position: relative;
}
.kit .chip {
  padding: 0 24px 0 5px;
  gap: 7px;
}
.kit-tone {
  position: relative;
  width: 18px;
  height: 18px;
  border-radius: 9px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
  overflow: hidden;
}
.kit-tone b {
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
}
.kit-remove {
  position: absolute;
  right: 5px;
  width: 16px;
  height: 16px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: var(--faint);
}
.kit-remove:hover {
  color: var(--text);
  background: var(--raised-hover);
}
.kit-confirm {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 8px 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  font-size: var(--size-s);
}
.kit-confirm span {
  flex: 1;
}
.primary.danger {
  background: var(--danger);
  color: #1a0b0b;
}
.primary.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 85%, white);
}
.logo-thumb {
  width: 28px;
  height: 28px;
  flex: none;
  object-fit: contain;
  border-radius: 6px;
  background: repeating-conic-gradient(var(--raised-hover) 0 25%, var(--raised) 0 50%) 0 0 / 8px 8px;
}
.kit-save {
  display: flex;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
/* switches that read as words: on is filled, with a tick */
.chips {
  display: flex;
```

- [ ] **Step 5: The typecheck**

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src apps/desktop/test/document.test.ts apps/desktop/test/protocol.test.ts
git commit -m "app: the Look tab's Brand part: the kits as chips applied in one step, the theme's fields, Save as a kit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The check and the guides

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`, `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`, `skill/cuttle/motion.md`, `skill/test/skill.test.ts`

- [ ] **Step 1: The check**

The brand set in the Look tab of one project (a logo from a file, a font, an accent) shows on its end card as `cuttle preview` draws it; saved as a kit, it is one click in another project, whose end card is then the first one's; undo takes it back as one step; removing the kit asks first:

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    mkdirSync(join(root, 'user-data'));
    // The screen is read after a take's cut only where the check asks for it (it says so in the settings).
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects'), privacy: { read: false } }));
    models = createServer((request, response) => {
      if (request.url === '/ggml-base.bin' && BASE_MODEL) return void response.end(readFileSync(BASE_MODEL));
      if (request.url === '/ggml-small.bin') return void response.end('not a model');
```

with:

```ts
    mkdirSync(join(root, 'user-data'));
    // The screen is read after a take's cut only where the check asks for it (it says so in the settings).
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects'), privacy: { read: false } }));
    // the logo the brand's file dialog picks
    writeFileSync(join(root, 'nimbus.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="28" fill="#7C5CFF"/><path d="M34 86V34h12l28 34V34h12v52H74L46 52v34z" fill="#fff"/></svg>');
    models = createServer((request, response) => {
      if (request.url === '/ggml-base.bin' && BASE_MODEL) return void response.end(readFileSync(BASE_MODEL));
      if (request.url === '/ggml-small.bin') return void response.end('not a model');
```

In the same file, replace:

```ts
        // the check's own models folder (empty at first), and the models from the check's server
        CUTTLE_MODELS_DIR: join(root, 'models'),
        CUTTLE_MODELS_URL: `http://127.0.0.1:${(models.address() as { port: number }).port}/`,
      },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
```

with:

```ts
        // the check's own models folder (empty at first), and the models from the check's server
        CUTTLE_MODELS_DIR: join(root, 'models'),
        CUTTLE_MODELS_URL: `http://127.0.0.1:${(models.address() as { port: number }).port}/`,
        // the brand kits in a folder of the check's own, and the image a file dialog picks
        CUTTLE_BRANDS_DIR: join(root, 'brands'),
        CUTTLE_CHECK_IMAGE: join(root, 'nimbus.svg'),
      },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
```

In the same file, replace:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'music-editor · Cuttle')?.close());
  }, 300_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

with:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'music-editor · Cuttle')?.close());
  }, 300_000);

  it('sets the brand in the Look tab and saves it as a kit; another project wears the kit with one click, its end card as the first one’s, as the export draws it', async () => {
    const brands = join(root, 'brands');
    type Branded = { theme?: Record<string, unknown>; look: { background?: { preset: string }; frame?: { style?: string }; cursor?: { style?: string; color?: string } }; scenes: { type: string; src?: string }[] };
    const saved = (dir: string) => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as Branded;
    const hooks = (page: Page) => ({
      seek: (t: number) => page.evaluate((time) => (window as unknown as Hooked).__cuttleCheck.seek(time), t),
      view: async () => decode(await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.pixels())),
      state: () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state() as CheckState & { motion: { status: { src: string; state: string; errors: string[] }[] } }),
    });
    /** A project with an end card after its clip, open, its brand part open in the Look tab. */
    const endCard = async (name: string) => {
      const dir = join(root, name);
      makeMotionFixture(dir);
      const page = await openEditor(dir);
      await page.waitForFunction(() => '__cuttleCheck' in window);
      await hooks(page).seek(5.5);
      await chooseIn(page, '[data-testid=add-motion]', 'End card');
      await expect.poll(() => saved(dir).scenes.map((scene) => scene.src ?? scene.type)).toEqual(['motion/intro/index.html', 'clip', 'motion/end-card/index.html']);
      await click(page, '#tab-look');
      await click(page, '[data-testid=look-open-brand]');
      await page.waitForSelector('[data-testid=brand-name]');
      return { dir, page, ...hooks(page) };
    };
    // the end card settled: the mark landed, the URL typed, the call to action in
    const cardAt = 9.4;
    const settled = async (one: Awaited<ReturnType<typeof endCard>>) => {
      await expect.poll(async () => (await one.state()).motion.status.find((status) => status.src === 'motion/end-card/index.html')?.state, { timeout: 60_000 }).toBe('ready');
      await one.seek(cardAt);
      return one.view();
    };

    // the first project: the brand set in the Look tab (a logo from a file, a font, an accent), the background its own
    const first = await endCard('brand-first');
    await first.page.fill('[data-testid=brand-name]', 'Nimbus');
    await first.page.press('[data-testid=brand-name]', 'Enter');
    await first.page.fill('[data-testid=brand-url]', 'nimbus.app');
    await first.page.press('[data-testid=brand-url]', 'Enter');
    await click(first.page, '[data-testid=brand-logo]');
    await chooseIn(first.page, '[data-testid=brand-font]', 'Bebas Neue');
    await first.page.evaluate(() => {
      const input = document.querySelector('input[aria-label="Accent colour"]') as HTMLInputElement;
      input.value = '#7c5cff';
      input.dispatchEvent(new Event('change'));
    });
    await click(first.page, '[data-testid=look-open-background]');
    await click(first.page, '.swatch-button.bg-mesh');
    await expect.poll(() => saved(first.dir).theme).toEqual({ name: 'Nimbus', url: 'nimbus.app', logo: 'brand/nimbus.svg', font: 'Bebas Neue', accent: '#7C5CFF' });
    expect(readFileSync(join(first.dir, 'brand', 'nimbus.svg'), 'utf8')).toContain('<svg');
    // the end card wears it: the logo, the name's font, the URL, the accent; the editor draws it as `cuttle preview` does
    const firstCard = await settled(first);
    // the logo is there (the brand's accent fills it; a logo that did not load leaves its place empty)
    const accentPixels = (png: PNG) => {
      let count = 0;
      for (let i = 0; i < png.data.length; i += 4) if (Math.abs(png.data[i]! - 0x7c) + Math.abs(png.data[i + 1]! - 0x5c) + Math.abs(png.data[i + 2]! - 0xff) < 40) count++;
      return count;
    };
    expect(accentPixels(firstCard), 'the logo').toBeGreaterThan(400);
    await first.page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
    const still = spawnSync('node', [CLI, '--json', '-C', first.dir, 'preview', '--at', String(cardAt), '-o', join(root, 'brand-stills')], { encoding: 'utf8', timeout: 120_000 });
    expect(still.status, still.stderr).toBe(0);
    const exportCard = PNG.sync.read(readFileSync((JSON.parse(still.stdout) as { stills: { file: string }[] }).stills[0]!.file));
    const drawn = difference(firstCard, exportCard);
    expect(drawn.mean, 'the end card: mean difference').toBeLessThan(0.5);
    expect((await first.state()).motion.status.find((status) => status.src === 'motion/end-card/index.html')?.errors).toEqual([]);
    // saved as a kit, under the brand's name: its files beside it, and the project wears it
    await click(first.page, '[data-testid=look-open-brand]');
    await first.page.waitForSelector('[data-testid=brand-save]:not([disabled])');
    await click(first.page, '[data-testid=brand-save]');
    await expect.poll(() => existsSync(join(brands, 'nimbus', 'brand.json'))).toBe(true);
    expect(readdirSync(join(brands, 'nimbus')).sort()).toEqual(['brand.json', 'logo.svg']);
    await expect.poll(() => saved(first.dir).theme?.kit).toBe('Nimbus');
    await first.page.waitForSelector('[data-testid=brand-kit][aria-pressed=true]');
    await shotOf('42-brand', '/editor.html', 'brand-first · Cuttle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'brand-first · Cuttle')?.close());

    // another project: the kit is one click; its end card is the first one's; undo takes it all back as one step
    const second = await endCard('brand-second');
    await second.page.waitForSelector('[data-testid=brand-kit]');
    await click(second.page, '[data-testid=brand-kit]');
    await expect.poll(() => saved(second.dir).theme).toEqual({ name: 'Nimbus', url: 'nimbus.app', logo: 'brand/nimbus-logo.svg', foreground: '#FFFFFF', font: 'Bebas Neue', accent: '#7C5CFF', kit: 'Nimbus' });
    expect(saved(second.dir).look).toMatchObject({ background: { preset: 'mesh' }, frame: { style: 'mac-dark' }, cursor: { style: 'system', color: '#D97757' } });
    expect(existsSync(join(second.dir, 'brand', 'nimbus-logo.svg'))).toBe(true);
    const secondCard = await settled(second);
    expect(difference(secondCard, firstCard).mean, 'the second end card against the first').toBeLessThan(0.5);
    await shotOf('42b-brand-applied', '/editor.html', 'brand-second · Cuttle');
    await second.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await second.page.keyboard.press('Control+Z');
    await expect.poll(() => saved(second.dir).theme).toBeUndefined();
    expect(saved(second.dir).look.background).toBeUndefined();
    await second.page.keyboard.press('Control+Shift+Z');
    await expect.poll(() => saved(second.dir).theme?.kit).toBe('Nimbus');
    // a kit is removed after a question; the project keeps what it set
    await click(second.page, '.kit-remove');
    await second.page.waitForSelector('.kit-confirm');
    await click(second.page, '.kit-confirm .primary');
    await expect.poll(() => existsSync(join(brands, 'nimbus'))).toBe(false);
    await second.page.waitForSelector('[data-testid=brand-kit]', { state: 'detached' });
    expect(saved(second.dir).theme?.kit).toBe('Nimbus');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'brand-second · Cuttle')?.close());
  }, 240_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

Run: `pnpm app:check`
Expected: PASS, 51 tests.

- [ ] **Step 2: The guides**

In `skill/cuttle/SKILL.md`, replace:

```markdown
- **Focus.** Add or fix `zooms` on what matters: 2–4 s on the answer or a result, with the rect
  read off a `frame --grid`. Over a sped-up clip, durations are source seconds: 3 s at 12× is a
  quarter second on screen (see project.md).
- **Look.** Set `look.frame.title` (e.g. `claude · ~/demo`) and a background preset, and add a
  `texts` caption where a step is not obvious. Typing clicks softly, a click per key where the clip
  is heard (`look.audio.typing`, `typingVolume`); switch it off when the user wants a quiet video.
- **Pages.** `cuttle -C "<project>" --json capture-page <url or file> --scroll --add` appends a
  scrolling still of a web page (the result the agent built); add `--wait 2500` for slow maps or
```

with:

```markdown
- **Focus.** Add or fix `zooms` on what matters: 2–4 s on the answer or a result, with the rect
  read off a `frame --grid`. Over a sped-up clip, durations are source seconds: 3 s at 12× is a
  quarter second on screen (see project.md).
- **Look.** When `cuttle --json brand list` shows brand kits, ask which one the video wears and run
  `cuttle -C "<project>" --json brand apply "<name>"`: the brand (name, URL, logo, colours, heading
  font) for the motion pages, the background, frame and cursor. Without one, set `theme` (project.md)
  and offer to keep it with `brand save`. Set `look.frame.title` (e.g. `claude · ~/demo`) and a
  background preset, and add a `texts` caption where a step is not obvious. Typing clicks softly, a click per key where the clip
  is heard (`look.audio.typing`, `typingVolume`); switch it off when the user wants a quiet video.
- **Pages.** `cuttle -C "<project>" --json capture-page <url or file> --scroll --add` appends a
  scrolling still of a web page (the result the agent built); add `--wait 2500` for slow maps or
```

In `skill/cuttle/project.md`, replace:

```markdown
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one), `typing` (`true`: a key click for each key typed, where the clip is heard), `typingVolume` (`0.5`, 0 to 1), `effects` (`true`: the `sounds` and the music page's effects), `effectsVolume` (`0.8`, 0 to 1) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

Two clips where the second starts where the first ends (within 1 ms), as `suggest`'s speed-ups and
any split make, are one continuous piece: no crossfade, zooms and texts run on across the cut, and
the sound runs on where the speed stays the same (a speed change gets a 10 ms fade against clicks).
```

with:

```markdown
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one), `typing` (`true`: a key click for each key typed, where the clip is heard), `typingVolume` (`0.5`, 0 to 1), `effects` (`true`: the `sounds` and the music page's effects), `effectsVolume` (`0.8`, 0 to 1) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

`theme` is the project's brand, which its motion pages read (every field is optional): `name` and
`url` (the product's, for titles and end cards), `logo` (an image in the project, e.g.
`brand/logo.svg`: copy a file the user gives you into `brand/` first), `accent` (the brand's
colour; without it the cursor's), `foreground` (`#FFFFFF`: the text's), `background` (the tone pages
draw their own background in; without it a dark tone of the look's background), `font` (the
headings': `Archivo`, `Inter`, `Space Grotesk`, `Fraunces`, `Instrument Serif`, `Bebas Neue`) and
`kit` (the brand kit it came from). The title, end card, lower third and captions templates use it:
an empty title shows the name, and an end card without its own URL or logo shows the brand's.

**Brand kits** keep a brand for the next video:
- `cuttle --json brand list` lists them.
- `cuttle -C "<project>" --json brand save "<name>"` keeps the project's theme, background, frame
  style and cursor style and colour, with copies of the logo and background image.
- `cuttle -C "<project>" --json brand apply "<name>"` sets them and copies the files into `brand/`
  (cuttle.json.bak keeps the version before).
- `cuttle --json brand remove "<name>"` removes one.

When the user has kits, ask which one the video wears before you set the look by hand; the app's
Look tab applies them too.

Two clips where the second starts where the first ends (within 1 ms), as `suggest`'s speed-ups and
any split make, are one continuous piece: no crossfade, zooms and texts run on across the cut, and
the sound runs on where the speed stays the same (a speed change gets a 10 ms fade against clicks).
```

In the same file, replace:

```markdown
  after a jump: draw everything from `t` there and the frame is always right), and
  `ready(promise)` (the first frame waits for it: data, a model, images it loads late; fonts and
  `<img>`s are waited for anyway).
- **The look** as CSS variables: `--cuttle-accent` (the cursor colour), `--cuttle-bg`,
  `--cuttle-fg`, `--cuttle-font`, `--cuttle-mono`.
- **Transparent by default.** Where the page draws nothing, a scene shows the look's background and
  an overlay the video. A scene that wants its own background sets one on `body`.
- **The size is the output's**: 1920×1080 for 16:9, 1080×1920 for 9:16. Lay out in `%`, `vw` and
```

with:

```markdown
  after a jump: draw everything from `t` there and the frame is always right), and
  `ready(promise)` (the first frame waits for it: data, a model, images it loads late; fonts and
  `<img>`s are waited for anyway).
- **The brand and the look** as CSS variables: `--cuttle-accent` (the brand's colour, else the
  cursor's), `--cuttle-bg`, `--cuttle-fg`, `--cuttle-font`, `--cuttle-display` (the brand's heading
  font), `--cuttle-mono`; and in `cuttle.theme`: `name`, `url`, `logo` (its URL in the page, or `""`)
  and `font`.
- **Transparent by default.** Where the page draws nothing, a scene shows the look's background and
  an overlay the video. A scene that wants its own background sets one on `body`.
- **The size is the output's**: 1920×1080 for 16:9, 1080×1920 for 9:16. Lay out in `%`, `vw` and
```

In `skill/cuttle/motion.md`, replace:

```markdown
  125% expanded, animatable), `Space Grotesk`, `Bebas Neue`, `Fraunces` (a variable display serif)
  and `Instrument Serif` (upright and italic). Call `cuttle.ready(document.fonts.load('900 200px
  Archivo'))` before you measure text.
- The theme as CSS variables: `--cuttle-accent`, `--cuttle-bg`, `--cuttle-fg`, `--cuttle-font`,
  `--cuttle-mono`. Use them to match the project's look, or set your own palette.

## The take (what was recorded)
```

with:

```markdown
  125% expanded, animatable), `Space Grotesk`, `Bebas Neue`, `Fraunces` (a variable display serif)
  and `Instrument Serif` (upright and italic). Call `cuttle.ready(document.fonts.load('900 200px
  Archivo'))` before you measure text.
- The theme, the project's brand (project.md, `theme`), as CSS variables: `--cuttle-accent`,
  `--cuttle-bg`, `--cuttle-fg`, `--cuttle-font`, `--cuttle-display` (the brand's heading font),
  `--cuttle-mono`; and `cuttle.theme.name`, `url`, `logo` (a URL, or `""`) and `font`. Use them so
  one brand set once reaches every page: headings in `var(--cuttle-display)`, loaded with
  ``document.fonts.load(`800 100px "${cuttle.theme.font}"`)``, with `font-synthesis: none` (Bebas Neue
  and Instrument Serif have one weight: they are not made bold); the name, URL and logo where a param
  is left empty, as the templates do. Or set your own palette where the page asks for one.

## The take (what was recorded)
```

In `skill/test/skill.test.ts`, replace:

```ts
  STILL_MOTIONS,
  TEXT_POSITIONS,
  TEXT_STYLES,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
  parseProject,
```

with:

```ts
  STILL_MOTIONS,
  TEXT_POSITIONS,
  TEXT_STYLES,
  THEME_FONTS,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
  parseProject,
```

In the same file, replace:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'motion new', 'motion templates', 'music new', 'music templates', 'music set', 'music check', 'sound add', 'sound list', 'init', 'render', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion', 'music', 'sound'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
```

with:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'motion new', 'motion templates', 'music new', 'music templates', 'music set', 'music check', 'sound add', 'sound list', 'brand list', 'brand save', 'brand apply', 'brand remove', 'init', 'render', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion', 'music', 'sound', 'brand'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
```

In the same file, replace:

```ts
      ['`zooms`:', EASES],
      ['`masks` hide', MASK_STYLES],
      ['`texts`:', [...TEXT_STYLES, ...TEXT_POSITIONS]],
    ];
    for (const [start, values] of fields) {
      const text = where(start);
```

with:

```ts
      ['`zooms`:', EASES],
      ['`masks` hide', MASK_STYLES],
      ['`texts`:', [...TEXT_STYLES, ...TEXT_POSITIONS]],
      ['`theme` is', THEME_FONTS],
    ];
    for (const [start, values] of fields) {
      const text = where(start);
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/app.check.test.ts skill
git commit -m "check the brand in the app, saved as a kit and worn by another project; the guides say how a video wears a brand

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 868 passed and 71 skipped (where a speech model is found, its real transcription runs too: 869 and 70; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 14 tests.

Run: `pnpm app:check`
Expected: PASS, 51 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. In the Look tab, open Brand: set the name, the URL, a logo (an SVG or a PNG), the accent and a heading font. Add an end card (+ Motion → End card): it shows them.
2. Save it as a kit. Open another project and click the kit's chip: the brand, the background, the frame and the cursor change; Ctrl+Z takes it all back in one step.
3. In a terminal: `cuttle --json brand list` lists the kit; `cuttle -C "<project>" --json brand apply "<name>"` sets it from the command line.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **The end card's logo did not load:** it told a URL from a project path by `^[a-z]+:`, and `cuttle-motion:` has a dash. The screenshot showed a broken image (and `cuttle preview` drew the same); the check now also counts the logo's pixels.
- **"Save as a kit" squeezed its name field to nothing** beside its note: the note is the row's tooltip now.
- **An SVG logo showed in the pages but not in the panel:** the editor's media protocol served it as bytes; it has its type now.
- **The pages' text colour** is `#FFFFFF` (the theme's default, upper case like every colour the app writes) where it was `#ffffff`.

**Found while merging**
- **The open `zoom-fixes` branch changes the Inspector's import line of the actions:** the kits' actions are a module of their own (`brand.ts`), so this branch leaves that line and the next as they were and adds nothing to the conflicts `zoom-fixes` has with `main`.

**Flaky, and not this milestone's** (nothing here touches the recorder, the take's frames or the screen reading)
- **The app check's test that reads the screen after a take** lost its editor window in three of four full runs (one right after a fresh build, as seen on `main` before); it passed twice alone and in a full run that passed all 51. `main`'s own app check, run twice for comparison, lost a recording test too (the pause from the HUD) in one of them: the recording tests flake under the load of a full run there as well.
- **The CLI check's take frame** differed by 5.4 from ffmpeg's (it allows 3) once, in the run right after a build; it passed three times alone and in the next full run.
- **The recorder's 3 s take with every track** missed its clicks in two of eight full `pnpm test` runs, under load; the other six passed it.

**Spec points that move**
- The engine's own `card` scenes keep their look; the brand reaches the motion pages, and the end card template is the branded end card.
- Next: **P5-M2b** (backgrounds), then **P5-M2c** (device frames and the watermark).

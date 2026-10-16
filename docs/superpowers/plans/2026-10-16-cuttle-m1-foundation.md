# Cuttle M1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the Cuttle monorepo and build the two pure packages every other part depends on: `@cuttle/project` (the `cuttle.json` format) and `@cuttle/timeline` (what is on screen at any output time).

**Architecture:** pnpm workspace with TypeScript sources consumed directly (package `exports` point at `src/index.ts`), one root vitest config and one root `tsc --noEmit` typecheck. `@cuttle/project` validates with zod 4 and returns readable issues with JSON paths. `@cuttle/timeline` is a set of small pure modules (easing, scene time mapping, zoom, overlays) composed by `createTimeline`.

**Tech Stack:** Node 22, pnpm (workspace), TypeScript 5, vitest, zod 4.

Spec: `docs/superpowers/specs/2026-10-16-cuttle-design.md`. Roadmap and shared interfaces: `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle` (in PowerShell or Git Bash).
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.

## File structure

```
cuttle/
├── package.json                 root scripts: test, typecheck
├── pnpm-workspace.yaml          packages/*, apps/*
├── tsconfig.json                one strict config for all packages
├── vitest.config.ts             runs packages/*/test/**/*.test.ts
├── .gitignore, .gitattributes, README.md
└── packages/
    ├── project/
    │   ├── package.json         @cuttle/project, depends on zod
    │   ├── src/schema.ts        zod schemas, preset lists, exported types
    │   ├── src/parse.ts         parseProject, parseProjectJson, formatPath, CURRENT_VERSION
    │   ├── src/defaults.ts      defaultProject
    │   ├── src/index.ts         public exports
    │   └── test/schema.test.ts, test/parse.test.ts
    └── timeline/
        ├── package.json         @cuttle/timeline, depends on @cuttle/project
        ├── src/easing.ts        clamp, easeInOutCubic, ease, lerp, lerpRect
        ├── src/time.ts          sceneDuration, sceneSpans, totalDuration, spanAt, sourceTimeAt
        ├── src/zoom.ts          zoomRectAt
        ├── src/overlays.ts      activeMasks, activeTexts, badgeFor
        ├── src/cursor.ts        createCursorTrack, cursorAt (position, shape, click effects)
        ├── src/frame.ts         createTimeline, SceneFrame, RenderState, Timeline
        ├── src/index.ts         public exports
        └── test/easing.test.ts, time.test.ts, zoom.test.ts, overlays.test.ts, cursor.test.ts, frame.test.ts
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.gitattributes`

- [ ] **Step 1: Create the root files**

`package.json`:

```json
{
  "name": "cuttle",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
  - apps/*
```

`tsconfig.json`:

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
  },
  "include": ["packages/*/src", "packages/*/test", "vitest.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

`.gitignore`:

```
node_modules/
dist/
out/
*.log
.DS_Store
```

`.gitattributes`:

```
* text=auto eol=lf
*.png binary
*.mp4 binary
```

- [ ] **Step 2: Install the dev tools**

Run: `pnpm add -D -w typescript vitest`
Expected: `node_modules/` and `pnpm-lock.yaml` are created; `package.json` gains `devDependencies` for `typescript` and `vitest`.

- [ ] **Step 3: Check that the test runner starts**

Run: `pnpm test`
Expected: vitest prints `No test files found` and exits with code 0 (because of `passWithNoTests`).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.json vitest.config.ts .gitignore .gitattributes pnpm-lock.yaml
git commit -m "Monorepo scaffold: pnpm workspace, TypeScript, vitest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `@cuttle/project` schema

**Files:**
- Create: `packages/project/package.json`
- Create: `packages/project/src/schema.ts`
- Test: `packages/project/test/schema.test.ts`

- [ ] **Step 1: Create the package and add zod**

`packages/project/package.json`:

```json
{
  "name": "@cuttle/project",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

Run: `pnpm install`, then `pnpm --filter @cuttle/project add zod@^4`
Expected: `packages/project/package.json` gains `"dependencies": { "zod": "^4.x.x" }`.

- [ ] **Step 2: Write the failing tests**

`packages/project/test/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InputEventSchema, ProjectSchema } from '../src/schema';

const minimal = { version: 1, sources: { screen: 'takes/1/screen.mp4' } };

function pathsOf(input: unknown): string[] {
  const r = ProjectSchema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => i.path.map(String).join('.'));
}

describe('ProjectSchema', () => {
  it('fills defaults for a minimal project', () => {
    const p = ProjectSchema.parse(minimal);
    expect(p.output).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(p.look.background).toEqual({ preset: 'sunset-sky' });
    expect(p.look.frame).toEqual({ enabled: true, style: 'mac-dark', title: '', radius: 14, shadow: true });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'system', size: 1, color: '#D97757', clickEffect: 'ripple' });
    expect(p.look.webcam).toEqual({ enabled: false, shape: 'circle', corner: 'bottom-left', size: 0.18 });
    expect(p.look.audio).toEqual({ enabled: true, muteSpedUp: true });
    expect(p.look.transition).toEqual({ enabled: true, duration: 0.3 });
    expect(p.scenes).toEqual([]);
    expect(p.zooms).toEqual([]);
    expect(p.masks).toEqual([]);
    expect(p.texts).toEqual([]);
  });

  it('parses the spec example and applies item defaults', () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [
        { type: 'clip', from: 63.5, to: 70.5 },
        { type: 'clip', from: 5.3, to: 152.5, speed: 12, badge: '12× speed' },
        { type: 'still', image: 'page.png', duration: 4, motion: 'scroll', frame: 'browser-light' },
        { type: 'card', title: 'Claude Code + treg', subtitle: 'treg.to', duration: 2.5 },
      ],
      zooms: [{ at: 150, duration: 4, rect: [0, 170, 1600, 900] }],
      masks: [{ from: 0, to: 70, rect: [30, 774, 780, 84] }],
      texts: [{ at: 2, duration: 3, text: 'One prompt, one call' }],
    });
    expect(p.scenes[0]).toEqual({ type: 'clip', from: 63.5, to: 70.5, speed: 1 });
    expect(p.scenes[2]).toEqual({ type: 'still', image: 'page.png', duration: 4, motion: 'scroll', frame: 'browser-light' });
    expect(p.zooms[0]).toEqual({ at: 150, duration: 4, rect: [0, 170, 1600, 900], ease: 'smooth', enabled: true });
    expect(p.masks[0]).toEqual({ from: 0, to: 70, rect: [30, 774, 780, 84], style: 'fill', enabled: true });
    expect(p.texts[0]).toEqual({
      at: 2, duration: 3, text: 'One prompt, one call', style: 'pill', position: 'top', enabled: true,
    });
  });

  it('rejects unknown keys and names them', () => {
    const r = ProjectSchema.safeParse({ ...minimal, look: { frame: { foo: 1 } } });
    expect(r.success).toBe(false);
    const issue = r.error?.issues.find((i) => i.path.join('.') === 'look.frame');
    expect(issue?.message).toContain('foo');
  });

  it('rejects a clip whose end is not after its start', () => {
    expect(pathsOf({ ...minimal, scenes: [{ type: 'clip', from: 5, to: 5 }] })).toContain('scenes.0.to');
  });

  it('rejects a mask whose end is not after its start', () => {
    expect(pathsOf({ ...minimal, masks: [{ from: 3, to: 1, rect: [0, 0, 1, 1] }] })).toContain('masks.0.to');
  });

  it('needs a color for the solid background and an image for the image background', () => {
    expect(pathsOf({ ...minimal, look: { background: { preset: 'solid' } } })).toContain('look.background.color');
    expect(pathsOf({ ...minimal, look: { background: { preset: 'image' } } })).toContain('look.background.image');
  });

  it('rejects zero-sized rects and a speed of zero', () => {
    expect(pathsOf({ ...minimal, zooms: [{ at: 0, duration: 1, rect: [0, 0, 0, 10] }] })).toContain('zooms.0.rect.2');
    expect(pathsOf({ ...minimal, scenes: [{ type: 'clip', from: 0, to: 1, speed: 0 }] })).toContain('scenes.0.speed');
  });

  it('accepts the six cursor styles and rejects others', () => {
    expect(ProjectSchema.parse({ ...minimal, look: { cursor: { style: 'spotlight' } } }).look.cursor.style).toBe('spotlight');
    expect(pathsOf({ ...minimal, look: { cursor: { style: 'laser' } } })).toContain('look.cursor.style');
  });
});

describe('InputEventSchema', () => {
  it('parses each event type of events.jsonl and rejects unknown cursor shapes', () => {
    expect(InputEventSchema.parse({ t: 1.5, type: 'click', x: 10, y: 20, button: 'left' })).toEqual({
      t: 1.5, type: 'click', x: 10, y: 20, button: 'left',
    });
    expect(InputEventSchema.parse({ t: 2, type: 'shape', shape: 'text' }).type).toBe('shape');
    expect(InputEventSchema.parse({ t: 3, type: 'keys', count: 4 }).type).toBe('keys');
    expect(InputEventSchema.parse({ t: 4, type: 'scroll', x: 0, y: 0, dx: 0, dy: -3 }).type).toBe('scroll');
    expect(InputEventSchema.safeParse({ t: 2, type: 'shape', shape: 'banana' }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test packages/project/test/schema.test.ts`
Expected: FAIL, `Failed to resolve import "../src/schema"`.

- [ ] **Step 4: Implement the schema**

`packages/project/src/schema.ts`:

```ts
import { z } from 'zod';

export const BACKGROUND_PRESETS = ['sunset-sky', 'aurora', 'mesh', 'solid', 'image'] as const;
export const FRAME_STYLES = ['mac-dark', 'mac-light', 'browser-light', 'none'] as const;
export const TEXT_STYLES = ['pill', 'lower-third', 'caption'] as const;
export const CURSOR_STYLES = ['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const;
export const CURSOR_SHAPES = ['arrow', 'text', 'pointer', 'wait', 'crosshair', 'move', 'not-allowed'] as const;

const seconds = z.number().finite().nonnegative();
const positiveSeconds = z.number().finite().positive();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a hex color like #0c0c0c');

export const RectSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite().positive(),
  z.number().finite().positive(),
]);

const OutputSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive().max(120),
});

const SourcesSchema = z.strictObject({
  screen: z.string().min(1),
  webcam: z.string().min(1).optional(),
  mic: z.string().min(1).optional(),
  events: z.string().min(1).optional(),
  markers: z.string().min(1).optional(),
});

const BackgroundSchema = z.strictObject({
  preset: z.enum(BACKGROUND_PRESETS),
  color: hexColor.optional(),
  image: z.string().min(1).optional(),
});

const FrameSchema = z.strictObject({
  enabled: z.boolean().default(true),
  style: z.enum(FRAME_STYLES).default('mac-dark'),
  title: z.string().default(''),
  radius: z.number().finite().nonnegative().default(14),
  shadow: z.boolean().default(true),
});

const CursorSchema = z.strictObject({
  enabled: z.boolean().default(true),
  style: z.enum(CURSOR_STYLES).default('system'),
  size: z.number().positive().max(4).default(1),
  color: hexColor.default('#D97757'),
  clickEffect: z.enum(['ripple', 'none']).default('ripple'),
});

const WebcamSchema = z.strictObject({
  enabled: z.boolean().default(false),
  shape: z.enum(['circle', 'rounded']).default('circle'),
  corner: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).default('bottom-left'),
  size: z.number().gt(0).max(0.5).default(0.18),
});

const AudioSchema = z.strictObject({
  enabled: z.boolean().default(true),
  muteSpedUp: z.boolean().default(true),
});

const TransitionSchema = z.strictObject({
  enabled: z.boolean().default(true),
  duration: z.number().finite().nonnegative().max(2).default(0.3),
});

// zod 4: .default() returns its value without parsing it; .prefault() parses it, so inner
// defaults apply when a whole block is missing.
const LookSchema = z.strictObject({
  background: BackgroundSchema.default({ preset: 'sunset-sky' }),
  frame: FrameSchema.prefault({}),
  cursor: CursorSchema.prefault({}),
  webcam: WebcamSchema.prefault({}),
  audio: AudioSchema.prefault({}),
  transition: TransitionSchema.prefault({}),
});

const ClipSceneSchema = z.strictObject({
  type: z.literal('clip'),
  from: seconds,
  to: seconds,
  speed: z.number().finite().positive().max(64).default(1),
  badge: z.string().optional(),
});

const StillSceneSchema = z.strictObject({
  type: z.literal('still'),
  image: z.string().min(1),
  duration: positiveSeconds,
  motion: z.enum(['none', 'kenburns', 'scroll']).default('none'),
  frame: z.enum(FRAME_STYLES).default('none'),
});

const CardSceneSchema = z.strictObject({
  type: z.literal('card'),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  duration: positiveSeconds,
});

const SceneSchema = z.discriminatedUnion('type', [ClipSceneSchema, StillSceneSchema, CardSceneSchema]);

const ZoomSchema = z.strictObject({
  at: seconds,
  duration: positiveSeconds,
  rect: RectSchema,
  ease: z.enum(['smooth', 'linear']).default('smooth'),
  enabled: z.boolean().default(true),
});

const MaskSchema = z.strictObject({
  from: seconds,
  to: seconds,
  rect: RectSchema,
  style: z.enum(['fill', 'blur']).default('fill'),
  enabled: z.boolean().default(true),
});

const TextSchema = z.strictObject({
  at: seconds,
  duration: positiveSeconds,
  text: z.string().min(1),
  style: z.enum(TEXT_STYLES).default('pill'),
  position: z.enum(['top', 'center', 'bottom']).default('top'),
  enabled: z.boolean().default(true),
});

export const ProjectSchema = z
  .strictObject({
    version: z.literal(1),
    output: OutputSchema.default({ width: 1920, height: 1080, fps: 30 }),
    sources: SourcesSchema,
    look: LookSchema.prefault({}),
    scenes: z.array(SceneSchema).default([]),
    zooms: z.array(ZoomSchema).default([]),
    masks: z.array(MaskSchema).default([]),
    texts: z.array(TextSchema).default([]),
  })
  .superRefine((p, ctx) => {
    p.scenes.forEach((scene, i) => {
      if (scene.type === 'clip' && scene.to <= scene.from) {
        ctx.addIssue({ code: 'custom', message: '"to" must be greater than "from"', path: ['scenes', i, 'to'] });
      }
    });
    p.masks.forEach((mask, i) => {
      if (mask.to <= mask.from) {
        ctx.addIssue({ code: 'custom', message: '"to" must be greater than "from"', path: ['masks', i, 'to'] });
      }
    });
    const background = p.look.background;
    if (background.preset === 'solid' && background.color === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the "solid" background needs a "color"', path: ['look', 'background', 'color'] });
    }
    if (background.preset === 'image' && background.image === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the "image" background needs an "image" path', path: ['look', 'background', 'image'] });
    }
  });

// One line of events.jsonl. Times are source seconds (seconds since the screen track started).
const point = { t: seconds, x: z.number().finite(), y: z.number().finite() };
export const InputEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), ...point }),
  z.strictObject({ type: z.literal('click'), ...point, button: z.enum(['left', 'right', 'middle']) }),
  z.strictObject({ type: z.literal('scroll'), ...point, dx: z.number().finite(), dy: z.number().finite() }),
  z.strictObject({ type: z.literal('shape'), t: seconds, shape: z.enum(CURSOR_SHAPES) }),
  z.strictObject({ type: z.literal('keys'), t: seconds, count: z.number().int().positive() }),
]);

export type InputEvent = z.output<typeof InputEventSchema>;
export type CursorShape = (typeof CURSOR_SHAPES)[number];
export type CursorStyle = (typeof CURSOR_STYLES)[number];
export type CuttleProject = z.output<typeof ProjectSchema>;
export type CuttleProjectInput = z.input<typeof ProjectSchema>;
export type Rect = z.output<typeof RectSchema>;
export type Scene = CuttleProject['scenes'][number];
export type ClipScene = Extract<Scene, { type: 'clip' }>;
export type StillScene = Extract<Scene, { type: 'still' }>;
export type CardScene = Extract<Scene, { type: 'card' }>;
export type Zoom = CuttleProject['zooms'][number];
export type Mask = CuttleProject['masks'][number];
export type TextOverlay = CuttleProject['texts'][number];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test packages/project/test/schema.test.ts`
Expected: PASS, 9 tests.

If "rejects unknown keys" fails because the message does not contain `foo`, print `r.error.issues` and adjust only the assertion to the zod 4 message for code `unrecognized_keys` (the key name must still appear in it).

- [ ] **Step 6: Commit**

```bash
git add packages/project pnpm-lock.yaml
git commit -m "project: zod schema for cuttle.json and events.jsonl with defaults and cross-field checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `@cuttle/project` parsing and defaults

**Files:**
- Create: `packages/project/src/parse.ts`
- Create: `packages/project/src/defaults.ts`
- Create: `packages/project/src/index.ts`
- Test: `packages/project/test/parse.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/project/test/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, defaultProject, formatPath, parseProject, parseProjectJson } from '../src/index';

describe('formatPath', () => {
  it('formats paths like JavaScript property access', () => {
    expect(formatPath(['scenes', 1, 'to'])).toBe('scenes[1].to');
    expect(formatPath(['look', 'frame'])).toBe('look.frame');
    expect(formatPath([])).toBe('(root)');
  });
});

describe('parseProject', () => {
  it('returns the project when it is valid', () => {
    const r = parseProject({ version: 1, sources: { screen: 's.mp4' } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.sources.screen).toBe('s.mp4');
  });

  it('returns readable issues when it is invalid', () => {
    const r = parseProject({ version: 1, sources: { screen: 's.mp4' }, scenes: [{ type: 'clip', from: 5, to: 2 }] });
    expect(r).toEqual({ ok: false, issues: [{ path: 'scenes[0].to', message: '"to" must be greater than "from"' }] });
  });

  it('refuses files written by a newer Cuttle', () => {
    const r = parseProject({ version: CURRENT_VERSION + 1, sources: { screen: 's.mp4' } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.path).toBe('version');
      expect(r.issues[0]?.message).toContain(`version ${CURRENT_VERSION + 1}`);
    }
  });

  it('reports a missing version', () => {
    const r = parseProject({ sources: { screen: 's.mp4' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toContain('version');
  });
});

describe('parseProjectJson', () => {
  it('reports invalid JSON', () => {
    const r = parseProjectJson('{ nope');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.path).toBe('(root)');
      expect(r.issues[0]?.message).toMatch(/^Invalid JSON/);
    }
  });

  it('parses valid JSON', () => {
    const r = parseProjectJson('{"version":1,"sources":{"screen":"s.mp4"}}');
    expect(r.ok).toBe(true);
  });
});

describe('defaultProject', () => {
  it('is valid, empty and uses the default screen path', () => {
    const p = defaultProject();
    expect(p.sources.screen).toBe('takes/1/screen.mp4');
    expect(p.scenes).toEqual([]);
    expect(p.look.background.preset).toBe('sunset-sky');
    expect(parseProject(p).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/project/test/parse.test.ts`
Expected: FAIL, `Failed to resolve import "../src/index"`.

- [ ] **Step 3: Implement parsing, defaults and the public index**

`packages/project/src/parse.ts`:

```ts
import { ProjectSchema, type CuttleProject } from './schema';

export const CURRENT_VERSION = 1;

export interface ProjectIssue {
  path: string;
  message: string;
}

export type ParseResult = { ok: true; project: CuttleProject } | { ok: false; issues: ProjectIssue[] };

export function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '(root)';
  return path.reduce<string>((out, key) => {
    if (typeof key === 'number') return `${out}[${key}]`;
    return out === '' ? String(key) : `${out}.${String(key)}`;
  }, '');
}

function versionOf(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !('version' in raw)) return undefined;
  return (raw as { version: unknown }).version;
}

// Version 1 is the only format so far. When version 2 exists, upgrade older input here
// before validating, and never write the upgraded file back without the user asking.
export function parseProject(raw: unknown): ParseResult {
  const version = versionOf(raw);
  if (typeof version === 'number' && version > CURRENT_VERSION) {
    return {
      ok: false,
      issues: [
        {
          path: 'version',
          message: `cuttle.json is version ${version}, this Cuttle reads up to version ${CURRENT_VERSION}. Update Cuttle.`,
        },
      ],
    };
  }
  const result = ProjectSchema.safeParse(raw);
  if (result.success) return { ok: true, project: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })),
  };
}

export function parseProjectJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  return parseProject(raw);
}
```

`packages/project/src/defaults.ts`:

```ts
import { parseProject } from './parse';
import type { CuttleProject } from './schema';

export function defaultProject(screen = 'takes/1/screen.mp4'): CuttleProject {
  const result = parseProject({ version: 1, sources: { screen } });
  if (!result.ok) throw new Error(`default project is invalid: ${JSON.stringify(result.issues)}`);
  return result.project;
}
```

`packages/project/src/index.ts`:

```ts
export {
  BACKGROUND_PRESETS,
  CURSOR_SHAPES,
  CURSOR_STYLES,
  FRAME_STYLES,
  TEXT_STYLES,
  InputEventSchema,
  ProjectSchema,
  RectSchema,
  type CardScene,
  type ClipScene,
  type CursorShape,
  type CursorStyle,
  type CuttleProject,
  type CuttleProjectInput,
  type InputEvent,
  type Mask,
  type Rect,
  type Scene,
  type StillScene,
  type TextOverlay,
  type Zoom,
} from './schema';
export { CURRENT_VERSION, formatPath, parseProject, parseProjectJson, type ParseResult, type ProjectIssue } from './parse';
export { defaultProject } from './defaults';
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test packages/project`
Expected: PASS, 17 tests (9 schema + 8 parse).

Run: `pnpm typecheck`
Expected: exits with code 0 and prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/project
git commit -m "project: parseProject with readable issues, version guard, defaultProject

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `@cuttle/timeline` package and easing

**Files:**
- Create: `packages/timeline/package.json`
- Create: `packages/timeline/src/easing.ts`
- Test: `packages/timeline/test/easing.test.ts`

- [ ] **Step 1: Create the package**

`packages/timeline/package.json`:

```json
{
  "name": "@cuttle/timeline",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cuttle/project": "workspace:*"
  }
}
```

Run: `pnpm install`
Expected: `node_modules/@cuttle/project` is linked inside `packages/timeline`.

- [ ] **Step 2: Write the failing tests**

`packages/timeline/test/easing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clamp, ease, easeInOutCubic, lerp, lerpRect } from '../src/easing';

describe('easeInOutCubic', () => {
  it('starts at 0, ends at 1 and is symmetric around the middle', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(0.25)).toBe(0.0625);
    expect(easeInOutCubic(0.75)).toBe(0.9375);
  });

  it('clamps input outside 0..1', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe('ease', () => {
  it('uses the cubic curve for smooth and a clamped line for linear', () => {
    expect(ease('smooth', 0.25)).toBe(0.0625);
    expect(ease('linear', 0.3)).toBe(0.3);
    expect(ease('linear', 1.5)).toBe(1);
  });
});

describe('clamp, lerp, lerpRect', () => {
  it('clamps, interpolates numbers and rects', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerpRect([0, 0, 100, 100], [50, 50, 10, 10], 0.5)).toEqual([25, 25, 55, 55]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test packages/timeline/test/easing.test.ts`
Expected: FAIL, `Failed to resolve import "../src/easing"`.

- [ ] **Step 4: Implement easing**

`packages/timeline/src/easing.ts`:

```ts
import type { Rect } from '@cuttle/project';

export type EaseKind = 'smooth' | 'linear';

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

export function easeInOutCubic(x: number): number {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function ease(kind: EaseKind, x: number): number {
  return kind === 'linear' ? clamp01(x) : easeInOutCubic(x);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test packages/timeline/test/easing.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/timeline pnpm-lock.yaml
git commit -m "timeline: package scaffold and easing helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Scene time mapping

**Files:**
- Create: `packages/timeline/src/time.ts`
- Test: `packages/timeline/test/time.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/timeline/test/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ClipScene, Scene } from '@cuttle/project';
import { sceneDuration, sceneSpans, sourceTimeAt, spanAt, totalDuration } from '../src/time';

const clip = (from: number, to: number, speed = 1): ClipScene => ({ type: 'clip', from, to, speed });
const scenes: Scene[] = [clip(10, 20), clip(20, 140, 12), { type: 'card', title: 'End', duration: 2 }];

describe('sceneDuration', () => {
  it('divides clip length by speed and uses duration for other scenes', () => {
    expect(sceneDuration(clip(10, 20))).toBe(10);
    expect(sceneDuration(clip(20, 140, 12))).toBe(10);
    expect(sceneDuration({ type: 'card', title: 'End', duration: 2 })).toBe(2);
  });
});

describe('sceneSpans and totalDuration', () => {
  it('lays scenes end to end', () => {
    const spans = sceneSpans(scenes);
    expect(spans.map((s) => [s.index, s.start, s.end])).toEqual([
      [0, 0, 10],
      [1, 10, 20],
      [2, 20, 22],
    ]);
    expect(totalDuration(spans)).toBe(22);
    expect(totalDuration([])).toBe(0);
  });
});

describe('spanAt', () => {
  const spans = sceneSpans(scenes);
  it('finds the span that contains t, with starts inclusive and ends exclusive', () => {
    expect(spanAt(spans, 0)?.index).toBe(0);
    expect(spanAt(spans, 9.99)?.index).toBe(0);
    expect(spanAt(spans, 10)?.index).toBe(1);
    expect(spanAt(spans, 21.9)?.index).toBe(2);
  });

  it('clamps to the first and last span', () => {
    expect(spanAt(spans, -1)?.index).toBe(0);
    expect(spanAt(spans, 22)?.index).toBe(2);
    expect(spanAt(spans, 100)?.index).toBe(2);
    expect(spanAt([], 1)).toBeUndefined();
  });
});

describe('sourceTimeAt', () => {
  it('maps local scene time to source time with speed and clamps to the clip', () => {
    expect(sourceTimeAt(clip(20, 140, 12), 5)).toBe(80);
    expect(sourceTimeAt(clip(20, 140, 12), -1)).toBe(20);
    expect(sourceTimeAt(clip(20, 140, 12), 50)).toBe(140);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/timeline/test/time.test.ts`
Expected: FAIL, `Failed to resolve import "../src/time"`.

- [ ] **Step 3: Implement the time mapping**

`packages/timeline/src/time.ts`:

```ts
import type { ClipScene, Scene } from '@cuttle/project';
import { clamp } from './easing';

export interface SceneSpan {
  index: number;
  start: number;
  end: number;
  scene: Scene;
}

export function sceneDuration(scene: Scene): number {
  return scene.type === 'clip' ? (scene.to - scene.from) / scene.speed : scene.duration;
}

export function sceneSpans(scenes: readonly Scene[]): SceneSpan[] {
  let start = 0;
  return scenes.map((scene, index) => {
    const end = start + sceneDuration(scene);
    const span = { index, start, end, scene };
    start = end;
    return span;
  });
}

export function totalDuration(spans: readonly SceneSpan[]): number {
  return spans.at(-1)?.end ?? 0;
}

export function spanAt(spans: readonly SceneSpan[], t: number): SceneSpan | undefined {
  for (const span of spans) {
    if (t < span.end) return span;
  }
  return spans.at(-1);
}

export function sourceTimeAt(scene: ClipScene, local: number): number {
  return scene.from + clamp(local, 0, sceneDuration(scene)) * scene.speed;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test packages/timeline/test/time.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/timeline
git commit -m "timeline: scene spans and output-to-source time mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Zoom

**Files:**
- Create: `packages/timeline/src/zoom.ts`
- Test: `packages/timeline/test/zoom.test.ts`

Rules from the spec: a zoom eases from the full frame to its rect and back; the ramp is 0.6 s of
**output** time (so it is `0.6 × speed` source seconds, capped at half the zoom's duration); when
zooms overlap, the one with the later `at` wins.

- [ ] **Step 1: Write the failing tests**

`packages/timeline/test/zoom.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Rect, Zoom } from '@cuttle/project';
import { zoomRectAt } from '../src/zoom';

const full: Rect = [0, 0, 2560, 1440];
const zoom = (at: number, duration: number, rect: Rect, extra: Partial<Zoom> = {}): Zoom => ({
  at, duration, rect, ease: 'smooth', enabled: true, ...extra,
});
const half: Rect = [0, 0, 1280, 720];

describe('zoomRectAt', () => {
  it('returns the full frame outside every zoom', () => {
    expect(zoomRectAt([zoom(12, 4, half)], 11, 1, full)).toEqual(full);
    expect(zoomRectAt([zoom(12, 4, half)], 16.5, 1, full)).toEqual(full);
  });

  it('holds the target rect between the ramps', () => {
    expect(zoomRectAt([zoom(12, 4, half)], 14, 1, full)).toEqual(half);
  });

  it('eases in and out over 0.6 output seconds', () => {
    // 12.3 - 12 is not exact in floating point, so compare with a tolerance
    const easingIn = zoomRectAt([zoom(12, 4, half)], 12.3, 1, full);
    expect(easingIn[2]).toBeCloseTo(1920, 6);
    expect(easingIn[3]).toBeCloseTo(1080, 6);
    expect(zoomRectAt([zoom(12, 4, half)], 15.7, 1, full)[2]).toBeCloseTo(1920, 6);
  });

  it('stretches the ramp with speed but never beyond half the zoom', () => {
    // speed 12 → ramp min(7.2, 2) = 2 source seconds; 1 s in is the middle of the ramp
    expect(zoomRectAt([zoom(12, 4, half)], 13, 12, full)).toEqual([0, 0, 1920, 1080]);
  });

  it('supports a linear ease', () => {
    expect(zoomRectAt([zoom(12, 4, half, { ease: 'linear' })], 12.15, 1, full)[2]).toBeCloseTo(2240, 6);
  });

  it('ignores disabled zooms', () => {
    expect(zoomRectAt([zoom(12, 4, half, { enabled: false })], 14, 1, full)).toEqual(full);
  });

  it('lets the zoom with the later start win when zooms overlap', () => {
    const later: Rect = [100, 100, 640, 360];
    expect(zoomRectAt([zoom(12, 4, half), zoom(13, 2, later)], 14, 1, full)).toEqual(later);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/timeline/test/zoom.test.ts`
Expected: FAIL, `Failed to resolve import "../src/zoom"`.

- [ ] **Step 3: Implement the zoom**

`packages/timeline/src/zoom.ts`:

```ts
import type { Rect, Zoom } from '@cuttle/project';
import { ease, lerpRect } from './easing';

/** Ramp length in output seconds; converted to source seconds with the scene speed. */
export const ZOOM_RAMP_SECONDS = 0.6;

export function zoomRectAt(zooms: readonly Zoom[], sourceTime: number, speed: number, full: Rect): Rect {
  let active: Zoom | undefined;
  for (const zoom of zooms) {
    if (!zoom.enabled) continue;
    if (sourceTime < zoom.at || sourceTime > zoom.at + zoom.duration) continue;
    if (!active || zoom.at >= active.at) active = zoom;
  }
  if (!active) return full;

  const ramp = Math.min(ZOOM_RAMP_SECONDS * speed, active.duration / 2);
  const sinceStart = sourceTime - active.at;
  const untilEnd = active.at + active.duration - sourceTime;
  const amount = Math.min(ease(active.ease, sinceStart / ramp), ease(active.ease, untilEnd / ramp));
  return lerpRect(full, active.rect, amount);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test packages/timeline/test/zoom.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/timeline
git commit -m "timeline: eased zooms in source time with speed-aware ramps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Masks, texts and the speed badge

**Files:**
- Create: `packages/timeline/src/overlays.ts`
- Test: `packages/timeline/test/overlays.test.ts`

Rules: masks are active for `from <= t < to`; texts are visible for `at <= t < at + duration` and
fade in and out over 0.25 output seconds (`0.25 × speed` source seconds, capped at half the text's
duration); a clip's badge is its `badge` field, an empty `badge` hides it, and without a `badge`
field clips with `speed > 1` show `"<speed>× speed"`.

- [ ] **Step 1: Write the failing tests**

`packages/timeline/test/overlays.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ClipScene, Mask, TextOverlay } from '@cuttle/project';
import { activeMasks, activeTexts, badgeFor } from '../src/overlays';

const mask = (from: number, to: number, enabled = true): Mask => ({
  from, to, rect: [0, 0, 50, 50], style: 'fill', enabled,
});
const text: TextOverlay = { at: 11, duration: 2, text: 'Hi', style: 'pill', position: 'top', enabled: true };
const clip = (speed: number, badge?: string): ClipScene =>
  badge === undefined ? { type: 'clip', from: 0, to: 10, speed } : { type: 'clip', from: 0, to: 10, speed, badge };

describe('activeMasks', () => {
  const masks = [mask(0, 15), mask(5, 6, false)];
  it('returns enabled masks whose range contains t, end exclusive', () => {
    expect(activeMasks(masks, 0)).toEqual([masks[0]]);
    expect(activeMasks(masks, 5.5)).toEqual([masks[0]]);
    expect(activeMasks(masks, 15)).toEqual([]);
  });
});

describe('activeTexts', () => {
  it('fades in and out over 0.25 output seconds', () => {
    expect(activeTexts([text], 11.125, 1)).toEqual([{ overlay: text, opacity: 0.5 }]);
    expect(activeTexts([text], 12, 1)).toEqual([{ overlay: text, opacity: 1 }]);
    expect(activeTexts([text], 12.9, 1)[0]?.opacity).toBeCloseTo(0.4, 6);
  });

  it('hides texts outside their range and disabled texts', () => {
    expect(activeTexts([text], 10.9, 1)).toEqual([]);
    expect(activeTexts([text], 13, 1)).toEqual([]);
    expect(activeTexts([{ ...text, enabled: false }], 12, 1)).toEqual([]);
  });

  it('stretches the fade with speed, capped at half the duration', () => {
    // speed 12 → fade min(3, 1) = 1 source second
    expect(activeTexts([text], 11.5, 12)).toEqual([{ overlay: text, opacity: 0.5 }]);
  });
});

describe('badgeFor', () => {
  it('shows an automatic badge only for sped-up clips', () => {
    expect(badgeFor(clip(1))).toBeUndefined();
    expect(badgeFor(clip(12))).toBe('12× speed');
    expect(badgeFor(clip(1.5))).toBe('1.5× speed');
  });

  it('uses an explicit badge and hides it when empty', () => {
    expect(badgeFor(clip(12, 'fast-forward'))).toBe('fast-forward');
    expect(badgeFor(clip(12, ''))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/timeline/test/overlays.test.ts`
Expected: FAIL, `Failed to resolve import "../src/overlays"`.

- [ ] **Step 3: Implement the overlays**

`packages/timeline/src/overlays.ts`:

```ts
import type { ClipScene, Mask, TextOverlay } from '@cuttle/project';
import { clamp01 } from './easing';

/** Text fade length in output seconds; converted to source seconds with the scene speed. */
export const TEXT_FADE_SECONDS = 0.25;

export interface ActiveText {
  overlay: TextOverlay;
  opacity: number;
}

export function activeMasks(masks: readonly Mask[], sourceTime: number): Mask[] {
  return masks.filter((mask) => mask.enabled && sourceTime >= mask.from && sourceTime < mask.to);
}

export function activeTexts(texts: readonly TextOverlay[], sourceTime: number, speed: number): ActiveText[] {
  const active: ActiveText[] = [];
  for (const overlay of texts) {
    const end = overlay.at + overlay.duration;
    if (!overlay.enabled || sourceTime < overlay.at || sourceTime >= end) continue;
    const fade = Math.min(TEXT_FADE_SECONDS * speed, overlay.duration / 2);
    const opacity = Math.min(clamp01((sourceTime - overlay.at) / fade), clamp01((end - sourceTime) / fade));
    active.push({ overlay, opacity });
  }
  return active;
}

function formatSpeed(speed: number): string {
  return Number.isInteger(speed) ? String(speed) : String(Math.round(speed * 10) / 10);
}

export function badgeFor(scene: ClipScene): string | undefined {
  if (scene.badge !== undefined) return scene.badge === '' ? undefined : scene.badge;
  return scene.speed > 1 ? `${formatSpeed(scene.speed)}× speed` : undefined;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test packages/timeline/test/overlays.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/timeline
git commit -m "timeline: active masks, fading texts and the speed badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Cursor track

**Files:**
- Create: `packages/timeline/src/cursor.ts`
- Test: `packages/timeline/test/cursor.test.ts`

Rules: the cursor position is linearly interpolated between logged `move` samples (a `click` also
counts as a sample) and held before the first and after the last sample; the shape is the latest
`shape` event at or before the time (default `arrow`); each click shows an effect for 0.4 output
seconds (`0.4 × speed` source seconds) with `progress` from 0 to 1. `scroll` and `keys` events are
ignored here. Smoothing comes in phase 3.

- [ ] **Step 1: Write the failing tests**

`packages/timeline/test/cursor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { InputEvent } from '@cuttle/project';
import { createCursorTrack, cursorAt } from '../src/cursor';

const events: InputEvent[] = [
  { t: 1, type: 'move', x: 100, y: 50 },
  { t: 0, type: 'move', x: 0, y: 0 },
  { t: 0.5, type: 'shape', shape: 'text' },
  { t: 2, type: 'click', x: 200, y: 100, button: 'left' },
  { t: 1.5, type: 'scroll', x: 100, y: 50, dx: 0, dy: -3 },
  { t: 3, type: 'keys', count: 4 },
];
const track = createCursorTrack(events);

describe('createCursorTrack', () => {
  it('sorts events and splits them into moves, clicks and shapes', () => {
    expect(track.moves.map((m) => m.t)).toEqual([0, 1, 2]);
    expect(track.clicks).toEqual([{ t: 2, x: 200, y: 100, button: 'left' }]);
    expect(track.shapes).toEqual([{ t: 0.5, shape: 'text' }]);
  });
});

describe('cursorAt', () => {
  it('interpolates the position and keeps the latest shape', () => {
    expect(cursorAt(track, 0.5, 1)).toEqual({ x: 50, y: 25, shape: 'text', clicks: [] });
    expect(cursorAt(track, 1.5, 1)).toMatchObject({ x: 150, y: 75 });
  });

  it('holds the first and last sample outside the logged range', () => {
    expect(cursorAt(track, -1, 1)).toEqual({ x: 0, y: 0, shape: 'arrow', clicks: [] });
    expect(cursorAt(track, 10, 1)).toMatchObject({ x: 200, y: 100, shape: 'text' });
  });

  it('runs a click effect for 0.4 output seconds', () => {
    const clicks = cursorAt(track, 2.2, 1)?.clicks;
    expect(clicks).toHaveLength(1);
    expect(clicks?.[0]).toMatchObject({ x: 200, y: 100 });
    expect(clicks?.[0]?.progress).toBeCloseTo(0.5, 6);
    expect(cursorAt(track, 2.5, 1)?.clicks).toEqual([]);
  });

  it('stretches the click effect with speed', () => {
    // speed 12 → 4.8 source seconds; 2.4 s after the click is the middle
    expect(cursorAt(track, 4.4, 12)?.clicks[0]?.progress).toBeCloseTo(0.5, 6);
  });

  it('returns undefined without any samples', () => {
    expect(cursorAt(createCursorTrack([]), 1, 1)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/timeline/test/cursor.test.ts`
Expected: FAIL, `Failed to resolve import "../src/cursor"`.

- [ ] **Step 3: Implement the cursor track**

`packages/timeline/src/cursor.ts`:

```ts
import type { CursorShape, InputEvent } from '@cuttle/project';
import { clamp01, lerp } from './easing';

/** Click effect length in output seconds; converted to source seconds with the scene speed. */
export const CLICK_EFFECT_SECONDS = 0.4;

export interface CursorTrack {
  moves: { t: number; x: number; y: number }[];
  clicks: { t: number; x: number; y: number; button: 'left' | 'right' | 'middle' }[];
  shapes: { t: number; shape: CursorShape }[];
}

export interface CursorFrame {
  x: number;
  y: number;
  shape: CursorShape;
  clicks: { x: number; y: number; progress: number }[];
}

export function createCursorTrack(events: readonly InputEvent[]): CursorTrack {
  const track: CursorTrack = { moves: [], clicks: [], shapes: [] };
  for (const event of [...events].sort((a, b) => a.t - b.t)) {
    if (event.type === 'move') {
      track.moves.push({ t: event.t, x: event.x, y: event.y });
    } else if (event.type === 'click') {
      track.moves.push({ t: event.t, x: event.x, y: event.y });
      track.clicks.push({ t: event.t, x: event.x, y: event.y, button: event.button });
    } else if (event.type === 'shape') {
      track.shapes.push({ t: event.t, shape: event.shape });
    }
  }
  return track;
}

function positionAt(moves: CursorTrack['moves'], t: number): { x: number; y: number } {
  const first = moves[0]!;
  const last = moves[moves.length - 1]!;
  if (t <= first.t) return { x: first.x, y: first.y };
  if (t >= last.t) return { x: last.x, y: last.y };
  // Invariant: moves[lo].t <= t < moves[hi].t
  let lo = 0;
  let hi = moves.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (moves[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = moves[lo]!;
  const b = moves[hi]!;
  const f = (t - a.t) / (b.t - a.t);
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
}

export function cursorAt(track: CursorTrack, sourceTime: number, speed: number): CursorFrame | undefined {
  if (track.moves.length === 0) return undefined;
  const { x, y } = positionAt(track.moves, sourceTime);

  let shape: CursorShape = 'arrow';
  for (const change of track.shapes) {
    if (change.t > sourceTime) break;
    shape = change.shape;
  }

  const window = CLICK_EFFECT_SECONDS * speed;
  const clicks = track.clicks
    .filter((click) => sourceTime >= click.t && sourceTime < click.t + window)
    .map((click) => ({ x: click.x, y: click.y, progress: clamp01((sourceTime - click.t) / window) }));

  return { x, y, shape, clicks };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test packages/timeline/test/cursor.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/timeline
git commit -m "timeline: cursor track with interpolated position, shape and click effects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `createTimeline` with crossfades

**Files:**
- Create: `packages/timeline/src/frame.ts`
- Create: `packages/timeline/src/index.ts`
- Test: `packages/timeline/test/frame.test.ts`

Rules: `frameAt(t)` clamps `t` to `[0, duration]`. Around each scene boundary there is a crossfade
of `look.transition.duration` (half before, half after the boundary, each half capped at half of
the shorter neighbouring scene). During a crossfade the outgoing scene is frozen at its last frame
and the incoming one at its first frame; the result has two layers, back to front. Clip layers get
a `cursor` when `look.cursor.enabled` is true and a cursor track was passed in the options.

- [ ] **Step 1: Write the failing tests**

`packages/timeline/test/frame.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProject } from '@cuttle/project';
import { createCursorTrack, createTimeline } from '../src/index';

const screenSize = { width: 2560, height: 1440 };

function project(look: Record<string, unknown> = { transition: { enabled: false } }): CuttleProject {
  const result = parseProject({
    version: 1,
    sources: { screen: 's.mp4' },
    look,
    scenes: [
      { type: 'clip', from: 10, to: 20 },
      { type: 'clip', from: 20, to: 140, speed: 12 },
      { type: 'card', title: 'End', duration: 2 },
    ],
    zooms: [{ at: 12, duration: 4, rect: [0, 0, 1280, 720] }],
    masks: [{ from: 0, to: 15, rect: [0, 0, 50, 50] }],
    texts: [{ at: 11, duration: 2, text: 'Hi' }],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

describe('createTimeline', () => {
  const timeline = createTimeline(project(), { screenSize });

  it('knows the total duration and the spans', () => {
    expect(timeline.duration).toBe(22);
    expect(timeline.spans).toHaveLength(3);
  });

  it('maps output time into the first clip with masks and no badge', () => {
    const [layer] = timeline.frameAt(4).layers;
    expect(layer).toMatchObject({ index: 0, kind: 'clip', sourceTime: 14, opacity: 1, badge: undefined });
    expect(layer?.masks).toHaveLength(1);
    expect(layer?.zoom).toEqual([0, 0, 1280, 720]);
  });

  it('eases the zoom and fades the text in source time', () => {
    const zoom = timeline.frameAt(2.3).layers[0]?.zoom;
    expect(zoom?.[2]).toBeCloseTo(1920, 6);
    expect(zoom?.[3]).toBeCloseTo(1080, 6);
    expect(timeline.frameAt(1.125).layers[0]?.texts[0]?.opacity).toBe(0.5);
    expect(timeline.frameAt(6).layers[0]?.masks).toEqual([]);
  });

  it('maps the sped-up clip with its badge and a full-frame zoom', () => {
    const [layer] = timeline.frameAt(15).layers;
    expect(layer).toMatchObject({ index: 1, kind: 'clip', sourceTime: 80, badge: '12× speed' });
    expect(layer?.zoom).toEqual([0, 0, 2560, 1440]);
  });

  it('reports card scenes with progress and no clip fields', () => {
    const [layer] = timeline.frameAt(21).layers;
    expect(layer).toMatchObject({ index: 2, kind: 'card', progress: 0.5, masks: [], texts: [] });
    expect(layer?.sourceTime).toBeUndefined();
    expect(layer?.zoom).toBeUndefined();
  });

  it('clamps time to the timeline', () => {
    expect(timeline.frameAt(-5).t).toBe(0);
    const end = timeline.frameAt(100);
    expect(end.t).toBe(22);
    expect(end.layers[0]).toMatchObject({ index: 2, progress: 1 });
  });

  it('returns no layers for a project without scenes', () => {
    const empty = parseProject({ version: 1, sources: { screen: 's.mp4' } });
    if (!empty.ok) throw new Error('fixture');
    const t = createTimeline(empty.project, { screenSize });
    expect(t.duration).toBe(0);
    expect(t.frameAt(1)).toEqual({ t: 0, layers: [] });
  });

  it('adds the cursor to clip layers when enabled and a track is given', () => {
    const cursor = createCursorTrack([
      { t: 13, type: 'move', x: 0, y: 0 },
      { t: 15, type: 'move', x: 200, y: 100 },
    ]);
    const withCursor = createTimeline(project(), { screenSize, cursor });
    expect(withCursor.frameAt(4).layers[0]?.cursor).toEqual({ x: 100, y: 50, shape: 'arrow', clicks: [] });
    expect(withCursor.frameAt(21).layers[0]?.cursor).toBeUndefined();
    expect(timeline.frameAt(4).layers[0]?.cursor).toBeUndefined();

    const hidden = createTimeline(project({ transition: { enabled: false }, cursor: { enabled: false } }), {
      screenSize,
      cursor,
    });
    expect(hidden.frameAt(4).layers[0]?.cursor).toBeUndefined();
  });
});

describe('crossfades', () => {
  const timeline = createTimeline(project({ transition: { enabled: true, duration: 0.4 } }), { screenSize });

  it('shows one layer away from boundaries', () => {
    expect(timeline.frameAt(5).layers).toHaveLength(1);
  });

  it('blends the outgoing and incoming scenes around a boundary', () => {
    const before = timeline.frameAt(9.9).layers;
    expect(before.map((l) => l.index)).toEqual([0, 1]);
    expect(before[0]?.opacity).toBeCloseTo(0.75, 6);
    expect(before[1]?.opacity).toBeCloseTo(0.25, 6);
    expect(before[1]?.sourceTime).toBe(20);

    const after = timeline.frameAt(10.1).layers;
    expect(after.map((l) => l.index)).toEqual([0, 1]);
    expect(after[0]?.opacity).toBeCloseTo(0.25, 6);
    expect(after[0]?.sourceTime).toBe(20);
    expect(after[1]?.opacity).toBeCloseTo(0.75, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/timeline/test/frame.test.ts`
Expected: FAIL, `Failed to resolve import "../src/index"`.

- [ ] **Step 3: Implement `createTimeline` and the public index**

`packages/timeline/src/frame.ts`:

```ts
import type { CuttleProject, Mask, Rect } from '@cuttle/project';
import { cursorAt, type CursorFrame, type CursorTrack } from './cursor';
import { clamp } from './easing';
import { activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
import { sceneSpans, sourceTimeAt, spanAt, totalDuration, type SceneSpan } from './time';
import { zoomRectAt } from './zoom';

export interface SceneFrame {
  index: number;
  kind: 'clip' | 'still' | 'card';
  local: number;
  progress: number;
  opacity: number;
  sourceTime?: number;
  zoom?: Rect;
  masks: Mask[];
  texts: ActiveText[];
  badge?: string;
  cursor?: CursorFrame;
}

export interface RenderState {
  t: number;
  layers: SceneFrame[];
}

export interface Timeline {
  duration: number;
  spans: SceneSpan[];
  frameAt(t: number): RenderState;
}

export interface TimelineOptions {
  screenSize: { width: number; height: number };
  cursor?: CursorTrack;
}

export function createTimeline(project: CuttleProject, opts: TimelineOptions): Timeline {
  const spans = sceneSpans(project.scenes);
  const duration = totalDuration(spans);
  const full: Rect = [0, 0, opts.screenSize.width, opts.screenSize.height];
  const transition = project.look.transition;
  const maxHalf = transition.enabled ? transition.duration / 2 : 0;

  function halfBetween(a: SceneSpan, b: SceneSpan): number {
    return Math.min(maxHalf, (a.end - a.start) / 2, (b.end - b.start) / 2);
  }

  function sceneFrame(span: SceneSpan, t: number, opacity: number): SceneFrame {
    const length = span.end - span.start;
    const local = clamp(t - span.start, 0, length);
    const base = { index: span.index, local, progress: length === 0 ? 1 : local / length, opacity };
    const scene = span.scene;
    if (scene.type !== 'clip') return { ...base, kind: scene.type, masks: [], texts: [] };
    const sourceTime = sourceTimeAt(scene, local);
    return {
      ...base,
      kind: 'clip',
      sourceTime,
      zoom: zoomRectAt(project.zooms, sourceTime, scene.speed, full),
      masks: activeMasks(project.masks, sourceTime),
      texts: activeTexts(project.texts, sourceTime, scene.speed),
      badge: badgeFor(scene),
      cursor: project.look.cursor.enabled && opts.cursor ? cursorAt(opts.cursor, sourceTime, scene.speed) : undefined,
    };
  }

  function frameAt(t: number): RenderState {
    const time = clamp(t, 0, duration);
    const span = spanAt(spans, time);
    if (!span) return { t: time, layers: [] };

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
  }

  return { duration, spans, frameAt };
}
```

`packages/timeline/src/index.ts`:

```ts
export { clamp, clamp01, ease, easeInOutCubic, lerp, lerpRect, type EaseKind } from './easing';
export { sceneDuration, sceneSpans, sourceTimeAt, spanAt, totalDuration, type SceneSpan } from './time';
export { ZOOM_RAMP_SECONDS, zoomRectAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test packages/timeline`
Expected: PASS, 38 tests (4 easing + 5 time + 7 zoom + 6 overlays + 6 cursor + 10 frame).

- [ ] **Step 5: Commit**

```bash
git add packages/timeline
git commit -m "timeline: createTimeline with layered crossfades between scenes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Full check and README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

`README.md`:

````markdown
# Cuttle

Screen recordings that edit themselves: record a monitor, region or window with webcam and mic,
then turn the take into a polished demo with cuts, speed-ups, smooth zooms, masks, a framed window
on a designed background, text overlays and an end card. A desktop app for people, a CLI and a
skill for Claude, one project file (`cuttle.json`) and one render engine for both.

Status: phase 1 in progress. Spec: `docs/superpowers/specs/2026-10-16-cuttle-design.md`.

## Packages

| Package | What it does |
|---|---|
| `@cuttle/project` | `cuttle.json` schema, defaults and readable validation errors |
| `@cuttle/timeline` | What is on screen at any output time: scenes, speed, zooms, masks, texts, cursor, crossfades |

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
```
````

- [ ] **Step 2: Run everything**

Run: `pnpm test`
Expected: PASS, 55 tests in 8 files.

Run: `pnpm typecheck`
Expected: exits with code 0 and prints nothing.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README for the foundation milestone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (M1 scope)

| Spec rule | Task |
|---|---|
| Project format fields, presets, defaults, `enabled` flags | 2 |
| Unknown fields rejected with the JSON path | 2, 3 |
| `version` guard, readable issues for Claude | 3 |
| Source-time zooms, masks and texts that only show inside clip scenes | 6, 7, 8 |
| Zoom ease in/out, later `at` wins on overlap | 6 |
| Badge for scenes with `speed > 1` | 7 |
| Scenes in array order with a default 0.3 s crossfade | 5, 9 |
| `still` and `card` scenes use their own duration | 5, 9 |
| Six cursor styles, `events.jsonl` format | 2 |
| Cursor position, shape and click effects at the source time | 8, 9 |

Engine, export, recorder, CLI and skill are milestones M2 to M6 in the roadmap.

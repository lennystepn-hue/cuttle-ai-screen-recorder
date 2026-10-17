# Cuttle P4-M1: Cuts, Automatic Items, Crops and Cuttle's Own Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation every later automatic edit of phase 4 stands on:
- cuts that take a stretch out of a clip without splitting it;
- a tag on every automatic item, so a rerun replaces only what Cuttle made and hand edits win;
- the person's switches per kind;
- a clip's crop to the content of the window;
- the editor's Auto tab, which says what Cuttle did and switches it off kind by kind or item by item;
- Cuttle's own select in place of every system menu.

**Architecture:**
- **Format** (`@cuttle/project`):
  - `cuts` (source ranges);
  - `auto` (the kind) on cuts, zooms, masks and a clip's `crop`;
  - `autoEdits` (a switch per kind);
  - `crop` on a clip (`rect`, `enabled`, `auto`).
- **Timeline** (`@cuttle/timeline`):
  - `sceneSpans(scenes, cuts)` splits a clip into pieces around its enabled cuts. Each piece is a span with the scene's `sceneIndex` and `cutBefore`.
  - A cut has no crossfade. Overlays run on across it.
  - The crop is the clip's screen: zooms fit inside it, and the frame says its aspect.
- **Engine and export:**
  - The window takes the crop's aspect.
  - Decoders are planned per scene, so one reader walks a clip's pieces; frames are still handed over per span.
  - The audio fades 10 ms at a cut.
- **`suggest`** replaces only the zooms it tagged, keeps clear of the others, keeps a switched-off one off, and makes no kind the person switched off.
- **Editor:**
  - **Document:** a hand edit drops an item's tag (switching it on or off keeps it).
  - **Timeline:** one block per scene, made of its pieces, with notches for cuts.
  - **Inspector:** the Auto tab, and the cut and crop panels.
  - **Source view:** the Crop tool (C) draws and adjusts a clip's crop.
  - **Menus:** `Select.tsx` replaces all 8 native `<select>` elements in the editor, the picker and the settings.

**Tech Stack:** TypeScript strict, zod 4, vitest 5 (node and browser), Electron 44.7.2, React 19.3.0, Playwright (`_electron`).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase4-design.md`. Spike: `docs/superpowers/spikes/2026-10-17-p4-spike.md`. Roadmap: `docs/superpowers/specs/2026-10-17-cuttle-roadmap-p4-p6.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p4-m1`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg and ffprobe must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 8.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. On the prototype and on the replayed commits, `pnpm test` passes 533 tests (47 skipped), `pnpm typecheck` exits with 0, `pnpm app:check` passes its 38 tests, and `pnpm app:build` packages the app and passes its 4.

- **Cuts.** A cut removes `[from, to)` from every clip covering it.
  - Cuts that overlap join; a cut that is off (`enabled: false`) is ignored.
  - A piece shorter than 20 ms of output is dropped; a clip cut whole disappears.
  - The spans of one clip's pieces share its `sceneIndex`. Every piece after the first has `cutBefore`, which means:
    - no crossfade;
    - the audio fades 10 ms on each side;
    - an overlay running across the cut keeps one occurrence (it does not ramp out and in);
    - an overlay ending inside the cut ramps out before it, and one starting inside it ramps in after it.
  - `SceneSpan.index` stays the position in the list of spans, `SceneFrame` gains `sceneIndex`:
    - the engine and the frame sources key frames by span (`index`);
    - decoders are opened per scene (`sceneIndex`), since a clip's pieces only jump forward in source time;
    - the renderer's scene lookup uses `sceneIndex`.
- **Crops.** `crop: { rect, enabled, auto? }` on a clip.
  - While on, it is the clip's screen: `zoomRectAt` fits zooms inside it, and the frame's `aspect` is its width over height, so the window takes its shape.
  - Masks and the cursor stay in source pixels.
  - The crop's own `auto` can only be `crop`.
- **Tags.** `auto` is one of `crop`, `privacy`, `notification`, `retake`, `filler`, `pause`, `length`, `typing`, `dialog`, `click` or `answer`.
  - The document drops the tag on any hand edit of an item: moving, resizing, retiming, relabelling. Duplicating does too, since a copy is the person's.
  - Switching an item on or off keeps the tag.
  - `autoEdits` has `crop`, `privacy`, `retakes`, `fillers`, `pauses`, `typingZooms`, `dialogZooms`, `clickZooms` and `answerZoom`, all on by default. The command `auto-edits` sets one.
- **`suggest` and zooms.**
  - It replaces only zooms tagged `answer` or `click`, which it now tags as it makes them.
  - Untagged zooms stay. That includes phase 3's suggested zooms, whose tags were never written: keeping them is the safe reading. New zooms keep clear of them, and there is no answer zoom where one made by hand is.
  - A new zoom where a switched-off one of its kind was (≥ 50 % overlap in time, rects ≥ 50 % alike) stays off.
  - A kind switched off in `autoEdits` is not made.
  - The editor's "Zoom on clicks" tags its zooms `click`.
- **The editor.**
  - The timeline groups a clip's pieces into one block (`pieces`, `blockSourceAt`). Thumbnails and the end-edge trim go through the pieces.
  - Cuts show as notches over the video lane: white and on, or faint and dashed where an off cut would cut. A notch selects its cut.
  - The inspector's new **Auto** tab has a row per kind with a count and a switch (the switch writes `autoEdits` and the items, as one step), and the items below with their time, a switch, and Show.
  - Every automatic item's panel says "Made by Cuttle for …". The cut panel has its range, its place in the video and its switch. The crop panel has its area, its switch and "Draw on the video".
  - The **Crop** tool (C) draws a free-shaped crop in the source view, which dims what lies outside.
- **Cuttle's select** (`apps/desktop/src/renderer/Select.tsx`).
  - It is a button and a list drawn into the page's body: below the button, or above it when there is no room.
  - Keys:
    - Enter, Space and the arrows open it;
    - in the list, the arrows, Home and End move, and letters jump;
    - Enter or Space picks;
    - Esc closes it and keeps the focus on it (and never reaches the editor's "back out");
    - Tab closes it.
  - A pick with the mouse lets go of the focus, so Space plays again.
  - Variants: `field`, `compact`, `bare` (the picker's "Stop on"), `icon` (the picker's device chevron).
- **Not in this milestone:**
  - The `Menu` component the spec pairs with `Select`; it comes with the first menu that needs it (P4-M6's length control).
  - Transcript and speech (M2), the mistake key (M3), live facts and the automatic crop (M4), privacy masks (M5), length (M6).

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/schema.ts`, `ids.ts`, `index.ts` | `cuts`, `auto`, `autoEdits`, `crop`; `c` ids |
| `packages/timeline/src/time.ts` | `clipPieces`, `sceneSpans(scenes, cuts)`, no crossfade at a cut |
| `packages/timeline/src/occurrences.ts` | overlays run on across a cut |
| `packages/timeline/src/frame.ts` | cuts in the timeline, the crop as the clip's screen, `sceneIndex` and `aspect` on frames |
| `packages/engine/src/renderer.ts` | the window in the crop's aspect; scenes by `sceneIndex` |
| `packages/export/src/frame-plan.ts`, `src/page/scene-sources.ts`, `src/main/export.ts`, `electron/check.ts` | one decoder per scene; audio and frame counts with cuts |
| `packages/core/src/suggest.ts` | zooms tagged, replaced by tag, switched-off kinds and items respected |
| `apps/desktop/src/shared/document.ts` | the `cuts` list, a hand edit drops the tag, `auto-edits` |
| `apps/desktop/src/shared/timeline-model.ts` | blocks made of pieces, cut notches, `blockSourceAt` |
| `apps/desktop/src/renderer/Select.tsx` (new) | Cuttle's select |
| `apps/desktop/src/renderer/editor/*` | Auto tab, cut and crop panels, notches, the Crop tool, selects |
| `apps/desktop/src/renderer/picker/Picker.tsx`, `settings/Settings.tsx` and their CSS | their selects |

---

### Task 1: The format

**Files:**
- Modify: `packages/project/src/{schema,ids,index}.ts`, `packages/project/test/schema.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p4-m1`; work there:

```bash
git switch p4-m1
```

- [ ] **Step 2: Write the failing test**

In `packages/project/test/schema.test.ts`, replace:

```ts
    expect(InputEventSchema.safeParse({ t: -0.1, type: 'move', x: 0, y: 0 }).success).toBe(false);
  });
});
```

with:

```ts
    expect(InputEventSchema.safeParse({ t: -0.1, type: 'move', x: 0, y: 0 }).success).toBe(false);
  });
});

describe('automatic edits in the project', () => {
  it('has no cuts and every kind of automatic edit on by default', () => {
    const p = ProjectSchema.parse(minimal);
    expect(p.cuts).toEqual([]);
    expect(p.autoEdits).toEqual({
      crop: true, privacy: true, retakes: true, fillers: true, pauses: true, typingZooms: true, dialogZooms: true, clickZooms: true, answerZoom: true,
    });
  });

  it('reads cuts, crops and the tags of automatic items', () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [{ type: 'clip', id: 's1', from: 0, to: 40, crop: { rect: [62, 141, 2478, 1237], auto: 'crop' } }],
      cuts: [{ id: 'c1', label: 'Filler: ähm', from: 12.4, to: 12.8, auto: 'filler' }],
      zooms: [{ id: 'z1', at: 30, duration: 3, rect: [0, 0, 960, 540], auto: 'click' }],
      masks: [{ id: 'm1', from: 1, to: 2, rect: [0, 0, 10, 10], auto: 'privacy' }],
      autoEdits: { fillers: false },
    });
    expect(p.scenes[0]).toMatchObject({ crop: { rect: [62, 141, 2478, 1237], enabled: true, auto: 'crop' } });
    expect(p.cuts[0]).toEqual({ id: 'c1', label: 'Filler: ähm', from: 12.4, to: 12.8, enabled: true, auto: 'filler' });
    expect(p.zooms[0]!.auto).toBe('click');
    expect(p.autoEdits).toMatchObject({ fillers: false, pauses: true });
  });

  it('refuses a cut that ends before it starts, an unknown kind, a crop tagged otherwise and an id used twice', () => {
    expect(pathsOf({ ...minimal, cuts: [{ from: 3, to: 2 }] })).toEqual(['cuts.0.to']);
    expect(pathsOf({ ...minimal, zooms: [{ at: 1, duration: 2, rect: [0, 0, 10, 10], auto: 'magic' }] })).toEqual(['zooms.0.auto']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'clip', from: 0, to: 2, crop: { rect: [0, 0, 10, 10], auto: 'click' } }] })).toEqual(['scenes.0.crop.auto']);
    expect(pathsOf({ ...minimal, zooms: [{ id: 'c1', at: 1, duration: 2, rect: [0, 0, 10, 10] }], cuts: [{ id: 'c1', from: 1, to: 2 }] })).toEqual(['cuts.0.id']);
  });
});
```

Run: `pnpm exec vitest run --project node packages/project/test/schema.test.ts`
Expected: FAIL: `cuts` and `autoEdits` are unknown fields.

- [ ] **Step 3: The schema**

In `packages/project/src/schema.ts`, replace:

```ts
export const WEBCAM_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export const CLICK_EFFECTS = ['ripple', 'none'] as const;
export const MOUSE_BUTTONS = ['left', 'right', 'middle'] as const;

// z.number() already rejects Infinity and NaN in zod 4.
const seconds = z.number().nonnegative();
```

with:

```ts
export const WEBCAM_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export const CLICK_EFFECTS = ['ripple', 'none'] as const;
export const MOUSE_BUTTONS = ['left', 'right', 'middle'] as const;
/**
 * What made an automatic item (`auto` on cuts, zooms, masks and a clip's crop). Editing an item by
 * hand drops its tag; a rerun replaces only tagged items of the kinds it makes.
 */
export const AUTO_KINDS = ['crop', 'privacy', 'notification', 'retake', 'filler', 'pause', 'length', 'typing', 'dialog', 'click', 'answer'] as const;

// z.number() already rejects Infinity and NaN in zod 4.
const seconds = z.number().nonnegative();
```

In the same file, replace:

```ts
  label: z.string().max(200).optional(),
};

const ClipSceneSchema = z
  .strictObject({
    type: z.literal('clip'),
```

with:

```ts
  label: z.string().max(200).optional(),
};

const autoKind = z.enum(AUTO_KINDS).optional();

const ClipSceneSchema = z
  .strictObject({
    type: z.literal('clip'),
```

In the same file, replace:

```ts
    to: seconds,
    speed: z.number().positive().max(64).default(1),
    badge: z.string().optional(),
  })
  .refine((clip) => clip.to > clip.from, { message: '"to" must be greater than "from"', path: ['to'] });
```

with:

```ts
    to: seconds,
    speed: z.number().positive().max(64).default(1),
    badge: z.string().optional(),
    /** The part of the screen the clip shows (source px); zooms fit inside it, the window takes its shape. */
    crop: z.strictObject({ rect: RectSchema, enabled: z.boolean().default(true), auto: z.literal('crop').optional() }).optional(),
  })
  .refine((clip) => clip.to > clip.from, { message: '"to" must be greater than "from"', path: ['to'] });
```

In the same file, replace:

```ts
  rect: RectSchema,
  ease: z.enum(EASES).default('smooth'),
  enabled: z.boolean().default(true),
});

const MaskSchema = z
```

with:

```ts
  rect: RectSchema,
  ease: z.enum(EASES).default('smooth'),
  enabled: z.boolean().default(true),
  auto: autoKind,
});

const MaskSchema = z
```

In the same file, replace:

```ts
    rect: RectSchema,
    style: z.enum(MASK_STYLES).default('fill'),
    enabled: z.boolean().default(true),
  })
  .refine((mask) => mask.to > mask.from, { message: '"to" must be greater than "from"', path: ['to'] });

const TextSchema = z.strictObject({
  ...named,
  at: seconds,
```

with:

```ts
    rect: RectSchema,
    style: z.enum(MASK_STYLES).default('fill'),
    enabled: z.boolean().default(true),
    auto: autoKind,
  })
  .refine((mask) => mask.to > mask.from, { message: '"to" must be greater than "from"', path: ['to'] });

/** A source range taken out of every clip that covers it: a jump cut, no crossfade. */
const CutSchema = z
  .strictObject({
    ...named,
    from: seconds,
    to: seconds,
    enabled: z.boolean().default(true),
    auto: autoKind,
  })
  .refine((cut) => cut.to > cut.from, { message: '"to" must be greater than "from"', path: ['to'] });

/** The kinds of automatic edits the person keeps; one switched off is not made again on a rerun. */
const AutoEditsSchema = z.strictObject({
  crop: z.boolean().default(true),
  privacy: z.boolean().default(true),
  retakes: z.boolean().default(true),
  fillers: z.boolean().default(true),
  pauses: z.boolean().default(true),
  typingZooms: z.boolean().default(true),
  dialogZooms: z.boolean().default(true),
  clickZooms: z.boolean().default(true),
  answerZoom: z.boolean().default(true),
});

const TextSchema = z.strictObject({
  ...named,
  at: seconds,
```

In the same file, replace:

```ts
    zooms: z.array(ZoomSchema).default([]),
    masks: z.array(MaskSchema).default([]),
    texts: z.array(TextSchema).default([]),
  })
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
    const seen = new Map<string, string>();
    for (const list of ['scenes', 'zooms', 'masks', 'texts'] as const) {
      project[list].forEach((item: { id?: string }, index) => {
        if (item.id === undefined) return;
        const first = seen.get(item.id);
```

with:

```ts
    zooms: z.array(ZoomSchema).default([]),
    masks: z.array(MaskSchema).default([]),
    texts: z.array(TextSchema).default([]),
    cuts: z.array(CutSchema).default([]),
    autoEdits: AutoEditsSchema.prefault({}),
  })
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
    const seen = new Map<string, string>();
    for (const list of ['scenes', 'zooms', 'masks', 'texts', 'cuts'] as const) {
      project[list].forEach((item: { id?: string }, index) => {
        if (item.id === undefined) return;
        const first = seen.get(item.id);
```

In the same file, replace:

```ts
export type Zoom = CuttleProject['zooms'][number];
export type Mask = CuttleProject['masks'][number];
export type TextOverlay = CuttleProject['texts'][number];
```

with:

```ts
export type Zoom = CuttleProject['zooms'][number];
export type Mask = CuttleProject['masks'][number];
export type TextOverlay = CuttleProject['texts'][number];
export type Cut = CuttleProject['cuts'][number];
export type AutoKind = (typeof AUTO_KINDS)[number];
export type AutoEdits = CuttleProject['autoEdits'];
```

In `packages/project/src/ids.ts`, replace:

```ts
/** The lists whose items carry ids, and the prefix of the ids Cuttle gives their new items. */
export const ID_PREFIXES = { scenes: 's', zooms: 'z', masks: 'm', texts: 't' } as const;

export type IdList = keyof typeof ID_PREFIXES;
```

with:

```ts
/** The lists whose items carry ids, and the prefix of the ids Cuttle gives their new items. */
export const ID_PREFIXES = { scenes: 's', zooms: 'z', masks: 'm', texts: 't', cuts: 'c' } as const;

export type IdList = keyof typeof ID_PREFIXES;
```

In `packages/project/src/index.ts`, replace:

```ts
export {
  BACKGROUND_PRESETS,
  CLICK_EFFECTS,
  CURRENT_VERSION,
```

with:

```ts
export {
  AUTO_KINDS,
  BACKGROUND_PRESETS,
  CLICK_EFFECTS,
  CURRENT_VERSION,
```

In the same file, replace:

```ts
  InputEventSchema,
  ProjectSchema,
  RectSchema,
  type BackgroundPreset,
  type CardScene,
  type ClipScene,
  type CursorShape,
  type CursorStyle,
  type CuttleProject,
  type CuttleProjectInput,
  type Ease,
```

with:

```ts
  InputEventSchema,
  ProjectSchema,
  RectSchema,
  type AutoEdits,
  type AutoKind,
  type BackgroundPreset,
  type CardScene,
  type ClipScene,
  type CursorShape,
  type CursorStyle,
  type Cut,
  type CuttleProject,
  type CuttleProjectInput,
  type Ease,
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/project`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project
git commit -m "project: cuts, the auto tag on automatic items, autoEdits, and a clip's crop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cuts and crops in the timeline, the engine and the export

**Files:**
- Modify: `packages/timeline/src/{time,occurrences,frame,index}.ts`, `packages/timeline/test/{time,occurrences,frame}.test.ts`, `packages/engine/src/renderer.ts`, `packages/engine/test/{renderer.browser.test,scenarios}.ts`, `packages/export/src/{frame-plan,page/scene-sources,main/export}.ts`, `packages/export/electron/check.ts`, `packages/export/test/{audio,frame-plan}.test.ts`, `apps/cli/src/commands/preview.ts`, `apps/desktop/src/renderer/editor/{frames,player}.ts`
- Create: `packages/engine/test/__golden__/golden.browser.test.ts/crop.win32.png` (written by the first run)

- [ ] **Step 1: Write the failing tests**

In `packages/timeline/test/time.test.ts`, replace:

```ts
    expect(crossfadeHalf(spans[1]!, spans[2]!, { enabled: false, duration: 0.4 })).toBe(0);
  });
});
```

with:

```ts
    expect(crossfadeHalf(spans[1]!, spans[2]!, { enabled: false, duration: 0.4 })).toBe(0);
  });
});

describe('cuts', () => {
  const cut = (from: number, to: number, enabled = true) => ({ from, to, enabled });

  it('takes source ranges out of the clips that cover them: pieces with their scene, a jump between them', () => {
    const spans = sceneSpans([clip(0, 10), clip(10, 40, 2), { type: 'card', title: 'End', duration: 2 }], [cut(3, 4), cut(20, 30), cut(50, 60)]);
    expect(spans.map((s) => [s.index, s.sceneIndex, s.start, s.end, s.cutBefore ?? false])).toEqual([
      [0, 0, 0, 3, false],
      [1, 0, 3, 9, true],
      [2, 1, 9, 14, false],
      [3, 1, 14, 19, true],
      [4, 2, 19, 21, false],
    ]);
    expect(spans.map((s) => (s.scene.type === 'clip' ? [s.scene.from, s.scene.to] : s.scene.type))).toEqual([[0, 3], [4, 10], [10, 20], [30, 40], 'card']);
  });

  it('ignores cuts that are off, joins cuts that overlap, drops a piece shorter than 20 ms and a clip cut whole', () => {
    expect(sceneSpans([clip(0, 10)], [cut(2, 3, false)]).map((s) => s.end)).toEqual([10]);
    expect(sceneSpans([clip(0, 10)], [cut(2, 5), cut(4, 6)]).map((s) => s.scene.type === 'clip' && [s.scene.from, s.scene.to])).toEqual([[0, 2], [6, 10]]);
    expect(sceneSpans([clip(0, 10)], [cut(0.01, 9)]).map((s) => s.scene.type === 'clip' && s.scene.from)).toEqual([9]);
    expect(sceneSpans([clip(0, 10), clip(20, 30)], [cut(0, 10)]).map((s) => [s.sceneIndex, s.start])).toEqual([[1, 0]]);
  });

  it('has no crossfade at a cut', () => {
    const spans = sceneSpans([clip(0, 10)], [cut(4, 5)]);
    expect(crossfadeHalf(spans[0]!, spans[1]!, { enabled: true, duration: 0.3 })).toBe(0);
  });
});
```

In `packages/timeline/test/occurrences.test.ts`, replace:

```ts
    expect(rampAmount({ start: 5, end: 5, rampIn: true, rampOut: true }, 5, 0.6, 'smooth')).toBe(0);
  });
});
```

with:

```ts
    expect(rampAmount({ start: 5, end: 5, rampIn: true, rampOut: true }, 5, 0.6, 'smooth')).toBe(0);
  });
});

describe('occurrences over cuts', () => {
  it('runs on across a cut: one occurrence, ramps only at its ends; one that ends in a cut ramps out before it', () => {
    const spans = sceneSpans([{ type: 'clip', from: 0, to: 20, speed: 1 }], [{ from: 8, to: 9 }]);
    const across = occurrences(spans, 5, 12);
    expect(across[0]).toBe(across[1]);
    expect(across[0]).toEqual({ start: 5, end: 11, rampIn: true, rampOut: true });
    expect(occurrences(spans, 5, 8.5)[0]).toMatchObject({ end: 8, rampOut: true });
    expect(occurrences(spans, 8.5, 12)[1]).toMatchObject({ start: 8, rampIn: true });
  });
});
```

In `packages/timeline/test/frame.test.ts`, replace:

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

describe('cuts and crops in the timeline', () => {
  it('jumps over a cut without a crossfade, and a zoom across it stays in', () => {
    const timeline = createTimeline(
      project({}, { scenes: [{ type: 'clip', from: 10, to: 30 }], cuts: [{ from: 15, to: 18 }], zooms: [{ at: 12, duration: 10, rect: [0, 0, 1280, 720] }], masks: [], texts: [] }),
      { screenSize },
    );
    expect(timeline.duration).toBe(17);
    // just before and after the cut: one layer each, the source jumps from 15 to 18
    const before = timeline.frameAt(4.99).layers;
    const after = timeline.frameAt(5).layers;
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(before[0]).toMatchObject({ index: 0, sceneIndex: 0 });
    expect(before[0]!.sourceTime).toBeCloseTo(14.99, 6);
    expect(after[0]).toMatchObject({ index: 1, sceneIndex: 0, sourceTime: 18 });
    // fully zoomed on both sides of the cut (no ramp out and in again)
    expect(before[0]!.zoom).toEqual([0, 0, 1280, 720]);
    expect(after[0]!.zoom).toEqual([0, 0, 1280, 720]);
  });

  it('shows a clip’s crop as its screen: the window takes its shape, a zoom fits inside it', () => {
    const crop = [62, 141, 2478, 1237];
    const timeline = createTimeline(
      project({}, { scenes: [{ type: 'clip', from: 0, to: 10, crop: { rect: crop } }], zooms: [{ at: 5, duration: 4, rect: [0, 0, 400, 400] }], masks: [], texts: [] }),
      { screenSize },
    );
    const [plain] = timeline.frameAt(1).layers;
    expect(plain!.zoom).toEqual(crop);
    expect(plain!.aspect).toBeCloseTo(2478 / 1237, 9);
    const [zoomed] = timeline.frameAt(7).layers;
    const [x, y, w, h] = zoomed!.zoom!;
    expect(w / h).toBeCloseTo(2478 / 1237, 6);
    expect(x).toBeGreaterThanOrEqual(62);
    expect(y).toBeGreaterThanOrEqual(141);
  });
});
```

In `packages/export/test/audio.test.ts`, replace:

```ts
    expect(args).not.toContain('G');
  });
});
```

with:

```ts
    expect(args).not.toContain('G');
  });
});

describe('planAudio over cuts', () => {
  it('plays the pieces of a cut clip one after the other, each faded 10 ms at the cut, with no crossfade dip', () => {
    const p = project({ scenes: [{ type: 'clip', from: 0, to: 6 }], cuts: [{ from: 2, to: 3 }] });
    const segments = planAudio({ spans: sceneSpans(p.scenes, p.cuts), look: p.look, mic: true, seconds: 5 });
    expect(segments.map((s) => [s.samples, s.mic?.from, s.mic?.to])).toEqual([
      [96_000, 0, 96_000],
      [144_000, 144_000, 288_000],
    ]);
    expect(segments[0]!.fadeOut).toBe(480);
    expect(segments[1]!.fadeIn).toBe(480);
  });
});
```

In `packages/export/test/frame-plan.test.ts`, replace:

```ts
    expect(shown(7)).toEqual([210, undefined]);
  });
});
```

with:

```ts
    expect(shown(7)).toEqual([210, undefined]);
  });
});

describe('planFrames over cuts', () => {
  it('reads the pieces of a cut clip with one decoder: one plan, its source times jumping forward', () => {
    const result = plan({ scenes: [{ type: 'clip', from: 0, to: 2 }], cuts: [{ from: 0.5, to: 1.5 }] }, 10);
    expect(result.frames).toBe(10);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]).toMatchObject({ index: 0, firstFrame: 0, lastFrame: 9 });
    expect(result.scenes[0]!.sourceTimes).toEqual([0, 0.1, 0.2, 0.3, 0.4, 1.5, 1.6, 1.7, 1.8, 1.9]);
  });
});
```

Run: `pnpm exec vitest run --project node packages/timeline packages/export/test/audio.test.ts packages/export/test/frame-plan.test.ts`
Expected: FAIL: `sceneSpans` ignores the cuts; frames have no `sceneIndex` or `aspect`.

- [ ] **Step 2: Pieces, the crop, and the overlays across a cut**

In `packages/timeline/src/time.ts`, replace:

```ts
import type { ClipScene, Scene } from '@cuttle/project';
import { clamp } from './easing';

/** A scene's slot on the output timeline: `start` and `end` in output seconds, `start` inclusive, `end` exclusive. */
export interface SceneSpan {
  index: number;
  start: number;
  end: number;
  scene: Scene;
}

/** Rounds to whole microseconds so summed scene lengths land exactly on frame times. */
function snap(seconds: number): number {
  return Math.round(seconds * 1e6) / 1e6;
```

with:

```ts
import type { ClipScene, Scene } from '@cuttle/project';
import { clamp } from './easing';

/**
 * A slot on the output timeline: `start` and `end` in output seconds, `start` inclusive, `end`
 * exclusive. A clip with cuts in it has one span per piece the cuts leave.
 */
export interface SceneSpan {
  /** Where the span is in the list of spans. */
  index: number;
  /** The scene it shows, in the project's `scenes`. */
  sceneIndex: number;
  start: number;
  end: number;
  /** The scene; for a clip with cuts, the piece of it (a copy with its own `from` and `to`). */
  scene: Scene;
  /** A cut lies right before this piece of a clip: a jump with no crossfade, overlays run on across it. */
  cutBefore?: boolean;
}

/** A source range taken out of the clips that cover it (`cuts` in the project). */
export interface CutRange {
  from: number;
  to: number;
  enabled?: boolean;
}

/** A piece shorter than this (output seconds, under a frame at 50 fps) is dropped. */
export const MIN_PIECE_SECONDS = 0.02;

/** Rounds to whole microseconds so summed scene lengths land exactly on frame times. */
function snap(seconds: number): number {
  return Math.round(seconds * 1e6) / 1e6;
```

In the same file, replace:

```ts
  return scene.type === 'clip' ? (scene.to - scene.from) / scene.speed : scene.duration;
}

/** Lays scenes end to end on the output timeline, in output seconds. */
export function sceneSpans(scenes: readonly Scene[]): SceneSpan[] {
  let start = 0;
  return scenes.map((scene, index) => {
    const end = snap(start + sceneDuration(scene));
    const span = { index, start, end, scene };
    start = end;
    return span;
  });
}

/** Total length of the output timeline in output seconds; 0 without scenes. */
```

with:

```ts
  return scene.type === 'clip' ? (scene.to - scene.from) / scene.speed : scene.duration;
}

/** The pieces of a clip its enabled cuts leave, in order; the clip itself when no cut touches it. */
export function clipPieces(clip: ClipScene, cuts: readonly CutRange[]): ClipScene[] {
  const ranges = cuts
    .filter((cut) => cut.enabled !== false && cut.to > clip.from && cut.from < clip.to)
    .map((cut) => [Math.max(cut.from, clip.from), Math.min(cut.to, clip.to)] as const)
    .sort((a, b) => a[0] - b[0]);
  if (ranges.length === 0) return [clip];
  const pieces: ClipScene[] = [];
  let at = clip.from;
  for (const [from, to] of ranges) {
    if (from > at) pieces.push({ ...clip, from: at, to: from });
    at = Math.max(at, to);
  }
  if (clip.to > at) pieces.push({ ...clip, from: at, to: clip.to });
  return pieces.filter((piece) => (piece.to - piece.from) / piece.speed >= MIN_PIECE_SECONDS);
}

/** Lays scenes end to end on the output timeline, in output seconds; clips lose what `cuts` take out. */
export function sceneSpans(scenes: readonly Scene[], cuts: readonly CutRange[] = []): SceneSpan[] {
  let start = 0;
  const spans: SceneSpan[] = [];
  scenes.forEach((scene, sceneIndex) => {
    const pieces = scene.type === 'clip' ? clipPieces(scene, cuts) : [scene];
    pieces.forEach((piece, n) => {
      const end = snap(start + sceneDuration(piece));
      spans.push({ index: spans.length, sceneIndex, start, end, scene: piece, ...(n > 0 && { cutBefore: true }) });
      start = end;
    });
  });
  return spans;
}

/** Total length of the output timeline in output seconds; 0 without scenes. */
```

In the same file, replace:

```ts

/**
 * Half the crossfade between neighbouring spans `a` and `b`, in output seconds: half the look's
 * transition, but at most half of either span; none at a continuous cut or with transitions off.
 * The picture and the export's sound share it.
 */
export function crossfadeHalf(a: SceneSpan, b: SceneSpan, transition: { enabled: boolean; duration: number }): number {
  if (!transition.enabled || isContinuousCut(a.scene, b.scene)) return 0;
  return Math.min(transition.duration / 2, (a.end - a.start) / 2, (b.end - b.start) / 2);
}
```

with:

```ts

/**
 * Half the crossfade between neighbouring spans `a` and `b`, in output seconds: half the look's
 * transition, but at most half of either span; none at a continuous cut, at a cut (`cuts`), or
 * with transitions off.
 * The picture and the export's sound share it.
 */
export function crossfadeHalf(a: SceneSpan, b: SceneSpan, transition: { enabled: boolean; duration: number }): number {
  if (!transition.enabled || b.cutBefore || isContinuousCut(a.scene, b.scene)) return 0;
  return Math.min(transition.duration / 2, (a.end - a.start) / 2, (b.end - b.start) / 2);
}
```

In `packages/timeline/src/occurrences.ts`, replace:

```ts

/**
 * The occurrence of the overlay with source range `[start, end)` in each span: `undefined` where
 * the span does not show it; spans joined by a continuous cut share one object. An overlay end that
 * lies within a continuous cut's tolerance of a clip's end counts as shown there (it ramps).
 */
export function occurrences(spans: readonly SceneSpan[], start: number, end: number): (Occurrence | undefined)[] {
  const result: (Occurrence | undefined)[] = [];
```

with:

```ts

/**
 * The occurrence of the overlay with source range `[start, end)` in each span: `undefined` where
 * the span does not show it; spans joined by a continuous cut or by a cut (`cuts`) share one
 * object, so the overlay runs on. An overlay end that lies within a continuous cut's tolerance of a
 * clip's end, or inside the cut after a piece, counts as shown there (it ramps); so does a start
 * inside the cut before a piece.
 */
export function occurrences(spans: readonly SceneSpan[], start: number, end: number): (Occurrence | undefined)[] {
  const result: (Occurrence | undefined)[] = [];
```

In the same file, replace:

```ts
    }
    const outEnd = Math.min(span.end, span.start + (to - scene.from) / scene.speed);
    const previous = result[i - 1];
    const rampOut = end <= scene.to + CONTINUOUS_CUT_SECONDS;
    if (previous && isContinuousCut(spans[i - 1]!.scene, scene)) {
      previous.end = outEnd;
      previous.rampOut = rampOut;
      result.push(previous);
      return;
    }
    result.push({ start: span.start + (from - scene.from) / scene.speed, end: outEnd, rampIn: start >= scene.from - CONTINUOUS_CUT_SECONDS, rampOut });
  });
  return result;
}
```

with:

```ts
    }
    const outEnd = Math.min(span.end, span.start + (to - scene.from) / scene.speed);
    const previous = result[i - 1];
    const next = spans[i + 1];
    const rampOut = end <= scene.to + CONTINUOUS_CUT_SECONDS || (next?.cutBefore === true && next.scene.type === 'clip' && end <= next.scene.from);
    if (previous && (span.cutBefore || isContinuousCut(spans[i - 1]!.scene, scene))) {
      previous.end = outEnd;
      previous.rampOut = rampOut;
      result.push(previous);
      return;
    }
    const prior = spans[i - 1]?.scene;
    const rampIn = start >= scene.from - CONTINUOUS_CUT_SECONDS || (span.cutBefore === true && prior?.type === 'clip' && start >= prior.to);
    result.push({ start: span.start + (from - scene.from) / scene.speed, end: outEnd, rampIn, rampOut });
  });
  return result;
}
```

In `packages/timeline/src/frame.ts`, replace:

```ts
import { ZOOM_RAMP_SECONDS, zoomRectAt } from './zoom';

export interface SceneFrame {
  index: number;
  kind: 'clip' | 'still' | 'card';
  local: number;
  progress: number;
  opacity: number;
  /** Clip scenes: source seconds, always inside the clip's [from, to). */
  sourceTime?: number;
  zoom?: Rect;
  masks: Mask[];
  texts: ActiveText[];
  badge?: string;
```

with:

```ts
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
  /** Clip scenes: source seconds, always inside the clip's [from, to). */
  sourceTime?: number;
  /** Clip scenes: the part of the screen shown (source px), the crop or the zoom inside it. */
  zoom?: Rect;
  /** Clip scenes: the width / height the window shows, the crop's or else the screen's. */
  aspect?: number;
  masks: Mask[];
  texts: ActiveText[];
  badge?: string;
```

In the same file, replace:

```ts
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    throw new Error('createTimeline: screenSize must have a positive, finite width and height');
  }
  const spans = sceneSpans(project.scenes);
  const duration = totalDuration(spans);
  // Source seconds where the video jumps (a clip's edge that is not a continuous cut): the smoothed
  // cursor keeps the two sides apart.
```

with:

```ts
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    throw new Error('createTimeline: screenSize must have a positive, finite width and height');
  }
  const spans = sceneSpans(project.scenes, project.cuts);
  const duration = totalDuration(spans);
  // Source seconds where the video jumps (a clip's edge that is not a continuous cut): the smoothed
  // cursor keeps the two sides apart.
```

In the same file, replace:

```ts
  function sceneFrame(span: SceneSpan, t: number, opacity: number): SceneFrame {
    const length = span.end - span.start;
    const local = clamp(t - span.start, 0, length);
    const base = { index: span.index, local, progress: length === 0 ? 1 : local / length, opacity };
    const scene = span.scene;
    if (scene.type !== 'clip') return { ...base, kind: scene.type, masks: [], texts: [] };
    // Past the end (or on a frame whose source time would be `to`), hold the last frame shown:
```

with:

```ts
  function sceneFrame(span: SceneSpan, t: number, opacity: number): SceneFrame {
    const length = span.end - span.start;
    const local = clamp(t - span.start, 0, length);
    const base = { index: span.index, sceneIndex: span.sceneIndex, local, progress: length === 0 ? 1 : local / length, opacity };
    const scene = span.scene;
    if (scene.type !== 'clip') return { ...base, kind: scene.type, masks: [], texts: [] };
    // Past the end (or on a frame whose source time would be `to`), hold the last frame shown:
```

In the same file, replace:

```ts
      const occurrence = shown?.[span.index];
      return occurrence ? rampAmount(occurrence, shownAt, ramp, curve) : 1;
    };
    return {
      ...base,
      kind: 'clip',
      sourceTime,
      zoom: zoomRectAt(project.zooms, sourceTime, (zoom) => amount(zoomShown.get(zoom), ZOOM_RAMP_SECONDS, zoom.ease), full),
      masks: activeMasks(project.masks, sourceTime),
      texts: activeTexts(project.texts, sourceTime, (text) => amount(textShown.get(text), TEXT_FADE_SECONDS, 'linear')),
      badge: badgeFor(scene),
```

with:

```ts
      const occurrence = shown?.[span.index];
      return occurrence ? rampAmount(occurrence, shownAt, ramp, curve) : 1;
    };
    // the crop is the screen for this clip: zooms fit inside it, the window takes its shape
    const screen = scene.crop?.enabled ? scene.crop.rect : full;
    return {
      ...base,
      kind: 'clip',
      sourceTime,
      zoom: zoomRectAt(project.zooms, sourceTime, (zoom) => amount(zoomShown.get(zoom), ZOOM_RAMP_SECONDS, zoom.ease), screen),
      aspect: screen[2] / screen[3],
      masks: activeMasks(project.masks, sourceTime),
      texts: activeTexts(project.texts, sourceTime, (text) => amount(textShown.get(text), TEXT_FADE_SECONDS, 'linear')),
      badge: badgeFor(scene),
```

In the same file, replace:

```ts
    // held one.
    const following = spans[span.index + 1];
    const scene = span.scene;
    if (following && isContinuousCut(scene, following.scene) && scene.type === 'clip' && !(scene.from + (time - span.start) * scene.speed < scene.to)) {
      span = following;
    }
```

with:

```ts
    // held one.
    const following = spans[span.index + 1];
    const scene = span.scene;
    if (following && (following.cutBefore || isContinuousCut(scene, following.scene)) && scene.type === 'clip' && !(scene.from + (time - span.start) * scene.speed < scene.to)) {
      span = following;
    }
```

In `packages/timeline/src/index.ts`, replace:

```ts
export { clamp, clamp01, ease, easeInOutCubic, lerp, lerpRect, type EaseKind } from './easing';
export { CONTINUOUS_CUT_SECONDS, crossfadeHalf, isContinuousCut, sceneDuration, sceneSpans, sourceTimeAt, spanAt, totalDuration, type SceneSpan } from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
```

with:

```ts
export { clamp, clamp01, ease, easeInOutCubic, lerp, lerpRect, type EaseKind } from './easing';
export {
  CONTINUOUS_CUT_SECONDS,
  MIN_PIECE_SECONDS,
  clipPieces,
  crossfadeHalf,
  isContinuousCut,
  sceneDuration,
  sceneSpans,
  sourceTimeAt,
  spanAt,
  totalDuration,
  type CutRange,
  type SceneSpan,
} from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
```

- [ ] **Step 3: The engine, the export and the frame sources by scene**

In `packages/engine/src/renderer.ts`, replace:

```ts
  let drawn: DrawnText[] = [];
  let scenes: readonly Scene[] = project.scenes;

  function frame(style: FrameStyle | null): { chrome: FrameChrome | null; layout: WindowLayout } {
    const chrome = style ? FRAME_CHROME[style] : null;
    return { chrome, layout: windowLayout(output, screenAspect, chrome ? { titleBar: chrome.titleBar, radius: look.frame.radius } : null) };
  }

  /** `avoid`: rects the texts move clear of (the webcam bubble, the badge). */
```

with:

```ts
  let drawn: DrawnText[] = [];
  let scenes: readonly Scene[] = project.scenes;

  /** The window for a frame style; `aspect` is the content's (a clip's crop, else the screen's). */
  function frame(style: FrameStyle | null, aspect = screenAspect): { chrome: FrameChrome | null; layout: WindowLayout } {
    const chrome = style ? FRAME_CHROME[style] : null;
    return { chrome, layout: windowLayout(output, aspect, chrome ? { titleBar: chrome.titleBar, radius: look.frame.radius } : null) };
  }

  /** `avoid`: rects the texts move clear of (the webcam bubble, the badge). */
```

In the same file, replace:

```ts
  }

  function drawClip(layer: SceneFrame, sources: FrameSources): void {
    const { chrome, layout } = frame(look.frame.enabled ? look.frame.style : null);
    if (chrome) windowPass.draw(layout, chrome, look.frame.shadow, look.frame.title);
    const screen = sources.screens.get(layer.index);
    if (!screen) throw new Error(`render: no screen frame for scene ${layer.index}`);
```

with:

```ts
  }

  function drawClip(layer: SceneFrame, sources: FrameSources): void {
    const { chrome, layout } = frame(look.frame.enabled ? look.frame.style : null, layer.aspect);
    if (chrome) windowPass.draw(layout, chrome, look.frame.shadow, look.frame.title);
    const screen = sources.screens.get(layer.index);
    if (!screen) throw new Error(`render: no screen frame for scene ${layer.index}`);
```

In the same file, replace:

```ts
  }

  function drawLayer(layer: SceneFrame, sources: FrameSources, t: number): void {
    const scene = scenes[layer.index];
    if (!scene) throw new Error(`render: the project has no scene ${layer.index}`);
    background.draw(t);
    if (scene.type === 'card') drawCard(scene);
    else if (scene.type === 'clip') drawClip(layer, sources);
```

with:

```ts
  }

  function drawLayer(layer: SceneFrame, sources: FrameSources, t: number): void {
    const scene = scenes[layer.sceneIndex];
    if (!scene) throw new Error(`render: the project has no scene ${layer.sceneIndex}`);
    background.draw(t);
    if (scene.type === 'card') drawCard(scene);
    else if (scene.type === 'clip') drawClip(layer, sources);
```

In `packages/engine/test/renderer.browser.test.ts`, replace:

```ts
const NO_SOURCES: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };

function layer(index: number, opacity: number, kind: SceneFrame['kind'] = 'card'): SceneFrame {
  return { index, kind, local: 0, progress: 0, opacity, masks: [], texts: [] };
}

function render(project: CuttleProject, state: RenderState, sources = NO_SOURCES) {
```

with:

```ts
const NO_SOURCES: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };

function layer(index: number, opacity: number, kind: SceneFrame['kind'] = 'card'): SceneFrame {
  return { index, sceneIndex: index, kind, local: 0, progress: 0, opacity, masks: [], texts: [] };
}

function render(project: CuttleProject, state: RenderState, sources = NO_SOURCES) {
```

In `packages/engine/test/scenarios.ts`, replace:

```ts
    t: 5,
  },

  // Cursors: six styles with a click ripple, then the system shapes
  ...(['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const).map(cursorScenario),
  ...(['text', 'pointer', 'wait', 'crosshair', 'move', 'not-allowed'] as const).map(shapeScenario),
```

with:

```ts
    t: 5,
  },

  // A clip cropped to a wide band of the screen: the window takes its shape, the mask stays on its text
  {
    name: 'crop',
    project: project(
      { frame: { title: TITLE } },
      { scenes: [{ type: 'clip', from: 0, to: 10, crop: { rect: [240, 40, 1000, 420] } }], masks: [{ from: 0, to: 10, rect: [270, 170, 700, 22], style: 'fill' }] },
    ),
    t: 1,
  },

  // Cursors: six styles with a click ripple, then the system shapes
  ...(['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const).map(cursorScenario),
  ...(['text', 'pointer', 'wait', 'crosshair', 'move', 'not-allowed'] as const).map(shapeScenario),
```

In `packages/export/src/frame-plan.ts`, replace:

```ts
  return { fps, frames: sorted.length, scenes: planScenes(timeline, fps, sorted) };
}

/** The scenes visible on `frames` (ascending), with the source times they need. */
function planScenes(timeline: Timeline, fps: number, frames: readonly number[]): ScenePlan[] {
  const byIndex = new Map<number, ScenePlan>();
  for (const frame of frames) {
    for (const layer of timeline.frameAt(frame / fps).layers) {
      let plan = byIndex.get(layer.index);
      if (!plan) {
        plan = { index: layer.index, kind: layer.kind, firstFrame: frame, lastFrame: frame, sourceTimes: [] };
        byIndex.set(layer.index, plan);
      }
      plan.lastFrame = frame;
      if (layer.sourceTime === undefined) continue;
      const last = plan.sourceTimes.at(-1);
      if (last !== undefined && layer.sourceTime < last) {
        throw new Error(`planFrames: scene ${layer.index} goes back in source time on frame ${frame}`);
      }
      if (layer.sourceTime !== last) plan.sourceTimes.push(layer.sourceTime);
    }
```

with:

```ts
  return { fps, frames: sorted.length, scenes: planScenes(timeline, fps, sorted) };
}

/**
 * The scenes visible on `frames` (ascending), with the source times they need. A clip with cuts
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
        byIndex.set(layer.sceneIndex, plan);
      }
      plan.lastFrame = frame;
      if (layer.sourceTime === undefined) continue;
      const last = plan.sourceTimes.at(-1);
      if (last !== undefined && layer.sourceTime < last) {
        throw new Error(`planFrames: scene ${layer.sceneIndex} goes back in source time on frame ${frame}`);
      }
      if (layer.sourceTime !== last) plan.sourceTimes.push(layer.sourceTime);
    }
```

In `packages/export/src/page/scene-sources.ts`, replace:

```ts
    webcams.clear();
    stills.clear();
    for (const layer of state.layers) {
      const scene = this.open.get(layer.index);
      if (!scene) throw new Error(`scene ${layer.index} shows on frame ${frame}, outside its planned frames`);
      if (layer.sourceTime !== undefined && scene.screen) {
        const screenFrame = await scene.screen.frameAt(this.screenTime(layer.sourceTime));
        if (!screenFrame) {
          throw new PageError(
            'invalid-media',
            `the screen recording has no frame at ${layer.sourceTime.toFixed(3)} s (scenes[${layer.index}]); the file may be cut off, end the scene earlier`,
          );
        }
        screens.set(layer.index, screenFrame);
```

with:

```ts
    webcams.clear();
    stills.clear();
    for (const layer of state.layers) {
      // decoders are opened per scene (`plan.index`), frames are handed over per layer
      const scene = this.open.get(layer.sceneIndex);
      if (!scene) throw new Error(`scene ${layer.sceneIndex} shows on frame ${frame}, outside its planned frames`);
      if (layer.sourceTime !== undefined && scene.screen) {
        const screenFrame = await scene.screen.frameAt(this.screenTime(layer.sourceTime));
        if (!screenFrame) {
          throw new PageError(
            'invalid-media',
            `the screen recording has no frame at ${layer.sourceTime.toFixed(3)} s (scenes[${layer.sceneIndex}]); the file may be cut off, end the scene earlier`,
          );
        }
        screens.set(layer.index, screenFrame);
```

In `packages/export/src/main/export.ts`, replace:

```ts

    const audioStarted = performance.now();
    const seconds = page.frames / project.output.fps;
    const segments = planAudio({ spans: sceneSpans(project.scenes), look: project.look, mic: sources.mic !== undefined, seconds });
    const usesMic = segments.some((segment) => segment.mic !== undefined);
    const graph = audioFilterGraph(segments, sources.mic?.offset ?? 0);
    const graphFile = graph.length > INLINE_GRAPH_LIMIT ? join(work, 'audio.graph') : undefined;
```

with:

```ts

    const audioStarted = performance.now();
    const seconds = page.frames / project.output.fps;
    const segments = planAudio({ spans: sceneSpans(project.scenes, project.cuts), look: project.look, mic: sources.mic !== undefined, seconds });
    const usesMic = segments.some((segment) => segment.mic !== undefined);
    const graph = audioFilterGraph(segments, sources.mic?.offset ?? 0);
    const graphFile = graph.length > INLINE_GRAPH_LIMIT ? join(work, 'audio.graph') : undefined;
```

In `packages/export/electron/check.ts`, replace:

```ts
  const parsed = parseProjectJson(await readFile(join(projectDir, 'cuttle.json'), 'utf8'));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const fps = parsed.project.output.fps;
  const expectedFrames = frameCount(totalDuration(sceneSpans(parsed.project.scenes)), fps);
  const expectedSeconds = expectedFrames / fps;

  let failures = 0;
```

with:

```ts
  const parsed = parseProjectJson(await readFile(join(projectDir, 'cuttle.json'), 'utf8'));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const fps = parsed.project.output.fps;
  const expectedFrames = frameCount(totalDuration(sceneSpans(parsed.project.scenes, parsed.project.cuts)), fps);
  const expectedSeconds = expectedFrames / fps;

  let failures = 0;
```

In `apps/cli/src/commands/preview.ts`, replace:

```ts
/** `cuttle preview`: PNG stills of the output, and a contact sheet, for checking a project. */
export async function previewCommand(projectDir: string, args: PreviewArgs, output: Output, signal: AbortSignal): Promise<PreviewResult> {
  const file = await readProjectFile(projectDir);
  const duration = totalDuration(sceneSpans(file.project.scenes));
  if (duration <= 0) throw new CliError('invalid-project', `${file.path} has no scenes yet; run "cuttle suggest" or add scenes`);
  const times = args.at && args.at.length > 0 ? args.at : Array.from({ length: SHEET_STILLS }, (_, i) => Math.round(((i + 0.5) * duration * 1000) / SHEET_STILLS) / 1000);
  const bad = times.find((t) => !Number.isFinite(t) || t < 0);
```

with:

```ts
/** `cuttle preview`: PNG stills of the output, and a contact sheet, for checking a project. */
export async function previewCommand(projectDir: string, args: PreviewArgs, output: Output, signal: AbortSignal): Promise<PreviewResult> {
  const file = await readProjectFile(projectDir);
  const duration = totalDuration(sceneSpans(file.project.scenes, file.project.cuts));
  if (duration <= 0) throw new CliError('invalid-project', `${file.path} has no scenes yet; run "cuttle suggest" or add scenes`);
  const times = args.at && args.at.length > 0 ? args.at : Array.from({ length: SHEET_STILLS }, (_, i) => Math.round(((i + 0.5) * duration * 1000) / SHEET_STILLS) / 1000);
  const bad = times.find((t) => !Number.isFinite(t) || t < 0);
```

In `apps/desktop/src/renderer/editor/frames.ts`, replace:

```ts
        continue;
      }
      if (layer.kind !== 'clip' || layer.sourceTime === undefined) continue;
      const scene = this.open.get(layer.index);
      const time = scene?.screenTimes?.get(layer.sourceTime);
      if (!scene?.screen || time === undefined) return undefined;
      const screenFrame = await scene.screen.frameAt(time);
```

with:

```ts
        continue;
      }
      if (layer.kind !== 'clip' || layer.sourceTime === undefined) continue;
      // decoders are opened per scene (`plan.index`), frames are handed over per layer
      const scene = this.open.get(layer.sceneIndex);
      const time = scene?.screenTimes?.get(layer.sourceTime);
      if (!scene?.screen || time === undefined) return undefined;
      const screenFrame = await scene.screen.frameAt(time);
```

In `apps/desktop/src/renderer/editor/player.ts`, replace:

```ts
      ...(this.keyFrames && { keyFrames: this.keyFrames }),
      ...(this.media.webcam && { webcam: this.media.webcam }),
    };
    const speedOf = (index: number) => {
      const scene = this.timeline.spans[index]?.scene;
      return scene?.type === 'clip' ? scene.speed : 1;
    };
    const open = (frame: number) => {
```

with:

```ts
      ...(this.keyFrames && { keyFrames: this.keyFrames }),
      ...(this.media.webcam && { webcam: this.media.webcam }),
    };
    const speedOf = (sceneIndex: number) => {
      const scene = this.timeline.spans.find((span) => span.sceneIndex === sceneIndex)?.scene;
      return scene?.type === 'clip' ? scene.speed : 1;
    };
    const open = (frame: number) => {
```

- [ ] **Step 4: Run the tests and the goldens; look at the new golden**

Run: `pnpm exec vitest run --project node packages/timeline packages/export`
Expected: PASS.

Run: `pnpm exec vitest run --project browser packages/engine`
Expected: FAIL once with "golden created, look at it and run the tests again: …/crop.win32.png". Open the PNG. It should show a wide, low window with the title bar: only the code of the fake editor, no side bar, no dialog box, no status bar, and an empty line where the mask is. Run the command again.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/timeline packages/engine packages/export apps/cli/src/commands/preview.ts apps/desktop/src/renderer/editor/frames.ts apps/desktop/src/renderer/editor/player.ts
git commit -m "timeline: cuts split a clip into pieces (a jump, no crossfade; overlays run on); a clip's crop is its screen; engine and export follow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: suggest tags its zooms and replaces only those

**Files:**
- Modify: `packages/core/src/suggest.ts`, `apps/cli/test/cli.test.ts`, `skill/cuttle/{SKILL,project}.md`

- [ ] **Step 1: Write the failing test**

In `apps/cli/test/cli.test.ts`, replace:

```ts
        "zooms": [
          {
            "at": 15.5,
            "duration": 3,
            "id": "z1",
            "label": "Answer",
```

with:

```ts
        "zooms": [
          {
            "at": 15.5,
            "auto": "answer",
            "duration": 3,
            "id": "z1",
            "label": "Answer",
```

In the same file, replace:

```ts
    expect((without.json as { zooms: { label: string }[] }).zooms.map((zoom) => zoom.label)).not.toContain('Clicks');
  }, 30_000);

  it('leaves cuttle.json alone with --dry-run', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
```

with:

```ts
    expect((without.json as { zooms: { label: string }[] }).zooms.map((zoom) => zoom.label)).not.toContain('Clicks');
  }, 30_000);

  it('replaces only the zooms it made: hand-made ones stay, one switched off stays off, a kind switched off is not made', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const events = [
      ...Array.from({ length: 31 }, (_, i) => ({ t: 3 + i * 0.3, type: 'keys', count: 1 })),
      { t: 6, type: 'click', x: 400, y: 300, button: 'left' },
      { t: 6.6, type: 'click', x: 430, y: 320, button: 'left' },
    ].sort((a, b) => a.t - b.t);
    writeFileSync(join(dir, 'takes/1/events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    const first = await cli('--json', '-C', dir, 'suggest');
    expect(first.code).toBe(0);
    type Zoom = { id: string; label?: string; at: number; duration: number; rect: number[]; auto?: string; enabled?: boolean };
    const made = (first.json as { zooms: Zoom[] }).zooms;
    expect(made.map((zoom) => zoom.auto)).toContain('click');
    const answer = made.find((zoom) => zoom.auto === 'answer');
    expect(answer).toBeDefined();
    // the person switches the click zoom off and puts a zoom of their own where the answer is
    const file = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    file.zooms = [
      ...file.zooms.filter((zoom: Zoom) => zoom.auto !== 'answer').map((zoom: Zoom) => (zoom.auto === 'click' ? { ...zoom, enabled: false } : zoom)),
      { id: 'z9', label: 'Mine', at: answer!.at, duration: 2, rect: [0, 0, 800, 450] },
    ];
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify(file, null, 2));
    const again = (await cli('--json', '-C', dir, 'suggest')).json as { zooms: Zoom[]; notes: string[] };
    expect(again.zooms.find((zoom) => zoom.id === 'z9')).toMatchObject({ label: 'Mine', at: answer!.at });
    expect(again.zooms.find((zoom) => zoom.auto === 'click')).toMatchObject({ enabled: false });
    expect(again.notes).toContain('kept 1 zoom made or changed by hand');
    // the answer zoom keeps clear of the zoom made by hand there
    expect(again.zooms.filter((zoom) => zoom.auto === 'answer')).toEqual([]);
    expect(again.notes).toContain('no zoom on the answer: a zoom made by hand is there');
    // click zooms switched off as a kind: none made
    const off = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ ...off, autoEdits: { clickZooms: false } }, null, 2));
    const none = (await cli('--json', '-C', dir, 'suggest', '--dry-run')).json as { zooms: Zoom[] };
    expect(none.zooms.map((zoom) => zoom.auto)).not.toContain('click');
  }, 60_000);

  it('leaves cuttle.json alone with --dry-run', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
```

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts -t "suggest"`
Expected: FAIL: the answer zoom has no `auto`, and a rerun drops the zoom made by hand.

- [ ] **Step 2: The tag rules**

In `packages/core/src/suggest.ts`, replace:

```ts
  project: string;
  /** The suggested clips, with the project's still and card scenes before (those that were before the first clip) and after them. */
  scenes: (ClipScene | Record<string, unknown>)[];
  zooms: { id: string; label: string; at: number; duration: number; rect: Rect }[];
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
```

with:

```ts
  project: string;
  /** The suggested clips, with the project's still and card scenes before (those that were before the first clip) and after them. */
  scenes: (ClipScene | Record<string, unknown>)[];
  /** Every zoom of the file afterwards: those kept (made by hand) and the new automatic ones, by start. */
  zooms: SuggestedZoom[];
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
```

In the same file, replace:

```ts

/**
 * Suggests scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
 * sped up) and a zoom on Claude's answer, written to cuttle.json. The clip scenes and the zooms are
 * replaced; still and card scenes keep their place before or after the clips, masks and texts stay;
 * the previous file is kept as cuttle.json.bak. The new clips and zoom get ids no kept item uses and
 * labels from Claude's markers.
 */
export async function suggestProject(projectDir: string, args: SuggestOptions = {}): Promise<SuggestResult> {
  const file = await readProjectFile(projectDir);
```

with:

```ts

/**
 * Suggests scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
 * sped up), a zoom on Claude's answer and zooms on clicks, written to cuttle.json. The clip scenes
 * are replaced; still and card scenes keep their place before or after the clips; masks, texts and
 * cuts stay. Of the zooms, only those suggest made before (tagged `auto`: "answer" or "click")
 * are replaced: zooms without a tag (made or changed by hand) stay, and the new ones keep clear of
 * them. A kind switched off in `autoEdits` is not made; a new zoom where one of its kind was
 * switched off stays off. The previous file is kept as cuttle.json.bak. The new clips and zooms get
 * ids no kept item uses and labels from Claude's markers.
 */
export async function suggestProject(projectDir: string, args: SuggestOptions = {}): Promise<SuggestResult> {
  const file = await readProjectFile(projectDir);
```

In the same file, replace:

```ts
    notes.push(`kept ${before.length + after.length} still or card scene(s)${before.length > 0 ? `, ${before.length} before the clips` : ''}`);
  }
  const scenes = [...before, ...clips, ...after];
  const zooms: SuggestResult['zooms'] = [];
  const first = suggestion.clips[0];
  const last = suggestion.clips.at(-1);
  if (args.zoom !== false && suggestion.answer !== undefined && first && last) {
    const [before, after] = await Promise.all([
      grabGray(screen, Math.max(first.from, suggestion.answer - ANSWER_LOOKBACK), COMPARE_WIDTH),
      grabGray(screen, Math.min(screenInfo.duration - 0.05, suggestion.answer + 0.3), COMPARE_WIDTH),
```

with:

```ts
    notes.push(`kept ${before.length + after.length} still or card scene(s)${before.length > 0 ? `, ${before.length} before the clips` : ''}`);
  }
  const scenes = [...before, ...clips, ...after];
  // The zooms suggest made before are replaced; the others stay, and the new ones avoid them.
  const rawZooms = (file.raw.zooms as SuggestedZoom[] | undefined) ?? [];
  const isOurs = (zoom: { auto?: string }) => zoom.auto === 'answer' || zoom.auto === 'click';
  const kept = rawZooms.filter((zoom) => !isOurs(zoom));
  const switchedOff = file.project.zooms.filter((zoom) => isOurs(zoom) && !zoom.enabled);
  if (kept.length > 0) notes.push(`kept ${kept.length} zoom${kept.length === 1 ? '' : 's'} made or changed by hand`);
  const zooms: SuggestedZoom[] = [];
  const add = (zoom: SuggestedZoom & { auto: 'answer' | 'click' }) => zooms.push(staysOff(zoom, switchedOff) ? { ...zoom, enabled: false } : zoom);
  const first = suggestion.clips[0];
  const last = suggestion.clips.at(-1);
  const keptOverlaps = (at: number, end: number) => kept.some((zoom) => at < zoom.at + zoom.duration && zoom.at < end);
  if (args.zoom !== false && file.project.autoEdits.answerZoom && suggestion.answer !== undefined && first && last) {
    const [before, after] = await Promise.all([
      grabGray(screen, Math.max(first.from, suggestion.answer - ANSWER_LOOKBACK), COMPARE_WIDTH),
      grabGray(screen, Math.min(screenInfo.duration - 0.05, suggestion.answer + 0.3), COMPARE_WIDTH),
```

In the same file, replace:

```ts
    const rect = region && zoomRect(region, COMPARE_WIDTH, screenInfo);
    const at = Math.max(first.from, suggestion.answer - 0.5);
    const duration = Math.min(ZOOM_SECONDS, last.to - at);
    if (rect && duration > 0.5) {
      zooms.push({ id: newId('zooms', taken), label: 'Answer', at: Math.round(at * 1000) / 1000, duration: Math.round(duration * 1000) / 1000, rect });
      notes.push(`zoom on Claude's answer at ${at.toFixed(1)} s (${rect.join(', ')})`);
    } else {
      notes.push(region ? 'no zoom: most of the screen changed with the answer (add one by hand)' : 'no zoom: nothing changed around the answer');
    }
  }
  if (args.zoom !== false && args.clickZooms !== false && events.length > 0) {
    // where each clip starts in the output, with the cards and pages around the clips counted
    const parsed = parseProject({ ...file.raw, scenes, zooms: [] });
    const spans = parsed.ok ? sceneSpans(parsed.project.scenes) : [];
    const shown = spans.flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
    const followed = clickZooms(events, shown, screenInfo, zooms);
    // the clicks the answer zoom does not show, less those the click zooms follow
    const left = shownClicks(events, shown, zooms) - followed.reduce((sum, zoom) => sum + zoom.clicks, 0);
    for (const zoom of followed) {
      zooms.push({ id: newId('zooms', taken), label: zoom.clicks === 1 ? 'Click' : 'Clicks', at: zoom.at, duration: zoom.duration, rect: zoom.rect });
    }
    zooms.sort((a, b) => a.at - b.at);
    if (followed.length > 0) notes.push(`${followed.length} zoom${followed.length === 1 ? '' : 's'} on clicks`);
    if (left > 0) notes.push(`${left} click${left === 1 ? '' : 's'} got no zoom: sped up, or near a cut or another zoom`);
  }

  let backup: string | undefined;
  if (!args.dryRun) {
    file.raw.scenes = scenes;
    file.raw.zooms = zooms;
    ({ backup } = await writeProjectFile(file, 'suggest', { backup: true }));
  }
  const result: SuggestResult = {
    project: file.path,
    scenes,
    zooms,
    notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
```

with:

```ts
    const rect = region && zoomRect(region, COMPARE_WIDTH, screenInfo);
    const at = Math.max(first.from, suggestion.answer - 0.5);
    const duration = Math.min(ZOOM_SECONDS, last.to - at);
    if (rect && duration > 0.5 && keptOverlaps(at, at + duration)) {
      notes.push('no zoom on the answer: a zoom made by hand is there');
    } else if (rect && duration > 0.5) {
      add({ id: newId('zooms', taken), label: 'Answer', at: Math.round(at * 1000) / 1000, duration: Math.round(duration * 1000) / 1000, rect, auto: 'answer' });
      notes.push(`zoom on Claude's answer at ${at.toFixed(1)} s (${rect.join(', ')})`);
    } else {
      notes.push(region ? 'no zoom: most of the screen changed with the answer (add one by hand)' : 'no zoom: nothing changed around the answer');
    }
  }
  if (args.zoom !== false && args.clickZooms !== false && file.project.autoEdits.clickZooms && events.length > 0) {
    // where each clip piece starts in the output, with the cards and pages around the clips and the cuts counted
    const parsed = parseProject({ ...file.raw, scenes, zooms: [] });
    const spans = parsed.ok ? sceneSpans(parsed.project.scenes, parsed.project.cuts) : [];
    const shown = spans.flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
    const there = [...kept, ...zooms];
    const followed = clickZooms(events, shown, screenInfo, there);
    // the clicks the zooms there do not show, less those the click zooms follow
    const left = shownClicks(events, shown, there) - followed.reduce((sum, zoom) => sum + zoom.clicks, 0);
    for (const zoom of followed) {
      add({ id: newId('zooms', taken), label: zoom.clicks === 1 ? 'Click' : 'Clicks', at: zoom.at, duration: zoom.duration, rect: zoom.rect, auto: 'click' });
    }
    if (followed.length > 0) notes.push(`${followed.length} zoom${followed.length === 1 ? '' : 's'} on clicks`);
    if (left > 0) notes.push(`${left} click${left === 1 ? '' : 's'} got no zoom: sped up, or near a cut or another zoom`);
  }

  const allZooms = [...kept, ...zooms].sort((a, b) => a.at - b.at);
  let backup: string | undefined;
  if (!args.dryRun) {
    file.raw.scenes = scenes;
    file.raw.zooms = allZooms;
    ({ backup } = await writeProjectFile(file, 'suggest', { backup: true }));
  }
  const result: SuggestResult = {
    project: file.path,
    scenes,
    zooms: allZooms,
    notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
```

In the same file, replace:

```ts
  return result;
}

/** The events of events.jsonl; undefined when the file cannot be read. */
async function readEvents(path: string): Promise<InputEvent[] | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
```

with:

```ts
  return result;
}

/** A zoom as written to cuttle.json (kept ones as they were, with whatever fields they had). */
export interface SuggestedZoom {
  id?: string;
  label?: string;
  at: number;
  duration: number;
  rect: Rect;
  auto?: string;
  enabled?: boolean;
  [field: string]: unknown;
}

/**
 * Whether a new automatic zoom takes the place of one of its kind the person switched off: the
 * same kind, overlapping at least half of the shorter in time, and their rects at least half alike
 * (intersection over union).
 */
function staysOff(zoom: SuggestedZoom, off: readonly { at: number; duration: number; rect: Rect; auto?: string }[]): boolean {
  return off.some((other) => {
    if (other.auto !== zoom.auto) return false;
    const overlap = Math.min(zoom.at + zoom.duration, other.at + other.duration) - Math.max(zoom.at, other.at);
    if (overlap < 0.5 * Math.min(zoom.duration, other.duration)) return false;
    const [ax, ay, aw, ah] = zoom.rect;
    const [bx, by, bw, bh] = other.rect;
    const w = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
    const h = Math.min(ay + ah, by + bh) - Math.max(ay, by);
    const inter = w > 0 && h > 0 ? w * h : 0;
    return inter / (aw * ah + bw * bh - inter) >= 0.5;
  });
}

/** The events of events.jsonl; undefined when the file cannot be read. */
async function readEvents(path: string): Promise<InputEvent[] | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
```

In `skill/cuttle/SKILL.md`, replace:

```markdown
`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work),
zooms on Claude's answer, and zooms where clicks happen at normal speed ("Click", "Clicks";
`--no-click-zooms` leaves those out, `--no-zoom` every zoom). Its `notes` say what it did, in
source seconds. It replaces every clip and zoom (masks, texts, stills and cards stay), so run it
once, before your hand edits. Its clips and zooms have ids, and labels where Claude's markers say
what they show ("Claude at work", "Answer"): keep them when you edit, and give items you add an
unused id and a label (project.md).
For a take recorded without `--until-claude`, add `--claude "<demo folder>"` to read the markers
```

with:

```markdown
`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work),
zooms on Claude's answer, and zooms where clicks happen at normal speed ("Click", "Clicks";
`--no-click-zooms` leaves those out, `--no-zoom` every zoom). Its `notes` say what it did, in
source seconds. It replaces every clip and the zooms it made before (tagged `auto`; masks, texts,
cuts, stills, cards and zooms made by hand stay), so run it once, before your hand edits. Its clips and zooms have ids, and labels where Claude's markers say
what they show ("Claude at work", "Answer"): keep them when you edit, and give items you add an
unused id and a label (project.md).
For a take recorded without `--until-claude`, add `--claude "<demo folder>"` to read the markers
```

In `skill/cuttle/project.md`, replace:

```markdown

| Type | Fields |
|---|---|
| `clip` | `from`, `to` (source seconds, `to` > `from`), `speed` (`1`, up to 64; above 1 a badge like "12× speed" shows), `badge` (custom badge text, `""` for none) |
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |
```

with:

```markdown

| Type | Fields |
|---|---|
| `clip` | `from`, `to` (source seconds, `to` > `from`), `speed` (`1`, up to 64; above 1 a badge like "12× speed" shows), `badge` (custom badge text, `""` for none), `crop` (`{ "rect": [x, y, w, h], "enabled": true }`: the part of the screen the clip shows, e.g. a browser's page without its tabs; the window takes its shape and zooms stay inside it) |
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |
```

In the same file, replace:

```markdown
`position` (`top`, `center`, `bottom`) and `enabled` (`true`). A `top` text sits over the window's
title bar; `bottom` keeps the title visible. Texts fade in and out over 0.25 output seconds.

Every scene, zoom, mask and text may have an `id` (1 to 64 letters, digits, `-` or `_`, unique in
the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest` sets both
on what it makes (`s1`, `z1`; "Prompt", "Claude at work", "Waiting", "Answer"). Keep them when
you edit an item; give a new item an id no other item uses (`s7`, `m2`) and a short label.

## Finding source seconds and rects
```

with:

```markdown
`position` (`top`, `center`, `bottom`) and `enabled` (`true`). A `top` text sits over the window's
title bar; `bottom` keeps the title visible. Texts fade in and out over 0.25 output seconds.

`cuts` take a stretch out of whatever clip covers it, without splitting the clip: `from` and `to`
(source seconds) and `enabled` (`true`). The video jumps there (no crossfade); zooms, masks and
texts run on across it. Use them for a slip, a filler or a pause inside a clip.

Every scene, zoom, mask, text and cut may have an `id` (1 to 64 letters, digits, `-` or `_`,
unique in the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest`
sets both on what it makes (`s1`, `z1`; "Prompt", "Claude at work", "Waiting", "Answer"). Keep
them when you edit an item; give a new item an id no other item uses (`s7`, `m2`, `c3`) and a
short label.

**Automatic items.** Cuttle tags what it makes on its own with `auto` (on a zoom, mask, cut or a
clip's `crop`): `answer` and `click` zooms from `suggest`, and later `crop`, `privacy`,
`notification`, `retake`, `filler`, `pause`, `length`, `typing` and `dialog`. A rerun replaces
only tagged items. **When you change a tagged item's time, place or size, remove its `auto`**: then
it is yours and the next `suggest` keeps it (switching it on or off keeps the tag). `autoEdits`
(`clickZooms`, `answerZoom`, `crop`, `privacy`, `retakes`, `fillers`, `pauses`, `typingZooms`,
`dialogZooms`: all `true`) holds which kinds are made at all; one set to `false` is not made again.

## Finding source seconds and rects
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node apps/cli packages/core skill`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/suggest.ts apps/cli/test/cli.test.ts skill/cuttle
git commit -m "suggest: tags its zooms and replaces only those; hand-made zooms stay, switched-off ones stay off, autoEdits respected

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The editor's model: cuts in the document and on the timeline

**Files:**
- Modify: `apps/desktop/src/shared/{document,timeline-model}.ts`, `apps/desktop/test/{document,timeline-model}.test.ts`, `apps/desktop/src/renderer/editor/{session,actions}.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/test/document.test.ts`, replace:

```ts
    expect(applied).toBeGreaterThan(1500);
  });
});
```

with:

```ts
    expect(applied).toBeGreaterThan(1500);
  });
});

describe('automatic items in the document', () => {
  const tagged: Raw = {
    ...base,
    zooms: [{ id: 'z1', at: 4, duration: 2, rect: [0, 0, 640, 360], auto: 'click' }],
    cuts: [{ id: 'c1', label: 'Filler: ähm', from: 1, to: 1.4, auto: 'filler' }],
  };

  it('keeps the tag when an item is only switched off or on, and drops it on any other hand edit', () => {
    const off = applyCommand(tagged, { type: 'set', list: 'zooms', id: 'z1', fields: { enabled: false } }, limits);
    expect((off.zooms as Raw[])[0]).toMatchObject({ enabled: false, auto: 'click' });
    const moved = applyCommand(tagged, { type: 'shift', list: 'zooms', id: 'z1', by: 0.5 }, limits);
    expect((moved.zooms as Raw[])[0]!.auto).toBeUndefined();
    const resized = applyCommand(tagged, { type: 'set', list: 'zooms', id: 'z1', fields: { rect: [0, 0, 320, 180] } }, limits);
    expect((resized.zooms as Raw[])[0]!.auto).toBeUndefined();
    const longer = applyCommand(tagged, { type: 'set', list: 'cuts', id: 'c1', fields: { to: 1.6 } }, limits);
    expect((longer.cuts as Raw[])[0]).toMatchObject({ to: 1.6 });
    expect((longer.cuts as Raw[])[0]!.auto).toBeUndefined();
    const copy = applyCommand(tagged, { type: 'duplicate', list: 'zooms', id: 'z1', shift: 1 }, limits);
    expect((copy.zooms as Raw[]).map((zoom) => zoom.auto)).toEqual(['click', undefined]);
  });

  it('gives cuts ids, switches kinds of automatic edits, and says what changed', () => {
    const named = ensureIds({ ...base, cuts: [{ from: 1, to: 2 }] });
    expect((named.cuts as { id: string }[])[0]!.id).toBe('c1');
    const switched = applyCommand(tagged, { type: 'auto-edits', kind: 'fillers', value: false }, limits);
    expect(switched.autoEdits).toEqual({ fillers: false });
    expect(describeChange(project(tagged), project(switched))).toBe('the automatic edits changed');
    const cut = applyCommand(tagged, { type: 'add', list: 'cuts', item: { from: 5, to: 6 } }, limits);
    expect(describeChange(project(tagged), project(cut))).toBe('1 cut added');
  });
});
```

In `apps/desktop/test/timeline-model.test.ts`, replace:

```ts
    expect(plainIssue('scenes.2.to: Too small')).toBe('scenes.2.to: Too small');
  });
});
```

with:

```ts
    expect(plainIssue('scenes.2.to: Too small')).toBe('scenes.2.to: Too small');
  });
});

describe('cuts on the timeline', () => {
  const cutProject = project({
    scenes: [{ type: 'clip', id: 's1', label: 'Demo', from: 0, to: 10 }, { type: 'card', id: 's2', title: 'End', duration: 1 }],
    cuts: [
      { id: 'c1', label: 'Filler: ähm', from: 2, to: 2.5, auto: 'filler' },
      { id: 'c2', label: 'Retake', from: 6, to: 8, auto: 'retake' },
      { id: 'c3', from: 9, to: 9.5, enabled: false },
    ],
  });
  const cutSpans = sceneSpans(cutProject.scenes, cutProject.cuts);
  const model = timelineModel(cutProject, cutSpans);

  it('shows a cut clip as one block, its pieces inside, and what the cuts took', () => {
    expect(model.scenes.map((block) => [block.index, block.start, block.end])).toEqual([
      [0, 0, 7.5],
      [1, 7.5, 8.5],
    ]);
    expect(model.scenes[0]!.pieces).toEqual([
      { start: 0, end: 2, from: 0 },
      { start: 2, end: 5.5, from: 2.5 },
      { start: 5.5, end: 7.5, from: 8 },
    ]);
    expect(model.scenes[0]!.detail).toBe('10 s → 7.5 s');
  });

  it('puts a notch where each cut is, and one for a cut that is off where it would be', () => {
    expect(model.cuts).toEqual([
      { t: 2, ids: ['c1'], enabled: true, auto: 'filler', title: 'Filler: ähm' },
      { t: 5.5, ids: ['c2'], enabled: true, auto: 'retake', title: 'Retake' },
      { t: 6.5, ids: ['c3'], enabled: false, title: 'Cut' },
    ]);
  });

  it('finds the source second a cut block shows', async () => {
    const { blockSourceAt } = await import('../src/shared/timeline-model');
    expect(blockSourceAt(model.scenes[0]!, 1)).toBe(1);
    expect(blockSourceAt(model.scenes[0]!, 3)).toBe(3.5);
    expect(blockSourceAt(model.scenes[0]!, 6)).toBe(8.5);
  });
});
```

Run: `pnpm exec vitest run --project node apps/desktop/test/document.test.ts apps/desktop/test/timeline-model.test.ts`
Expected: FAIL: a hand edit keeps the tag, and the model has no cuts.

- [ ] **Step 2: The document and the timeline model**

In `apps/desktop/src/shared/document.ts`, replace:

```ts
// the edits on it as commands on items by id, applied by pure functions. A result is clamped to
// valid values and checked with `parseProject`; a command whose item is gone throws, so a replay
// on a newer version of the file can drop it with a note.
import { newId, parseProject, usedIds, type CuttleProject, type IdList } from '@cuttle/project';

export type Raw = Record<string, unknown>;
export type ListName = IdList;
```

with:

```ts
// the edits on it as commands on items by id, applied by pure functions. A result is clamped to
// valid values and checked with `parseProject`; a command whose item is gone throws, so a replay
// on a newer version of the file can drop it with a note.
import { newId, parseProject, usedIds, type AutoEdits, type CuttleProject, type IdList } from '@cuttle/project';

export type Raw = Record<string, unknown>;
export type ListName = IdList;
```

In the same file, replace:

```ts
  /** Sets `look.<path…>` (`undefined` removes it). */
  | { type: 'look'; path: string[]; value: unknown }
  | { type: 'output'; width: number; height: number }
  /** Replaces every scene (Show raw take). */
  | { type: 'scenes'; scenes: Item[] };
```

with:

```ts
  /** Sets `look.<path…>` (`undefined` removes it). */
  | { type: 'look'; path: string[]; value: unknown }
  | { type: 'output'; width: number; height: number }
  /** Switches a kind of automatic edit on or off (`autoEdits`). */
  | { type: 'auto-edits'; kind: keyof AutoEdits; value: boolean }
  /** Replaces every scene (Show raw take). */
  | { type: 'scenes'; scenes: Item[] };
```

In the same file, replace:

```ts
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Gives every scene and overlay without an id one (`s3`, `z1` …); returns the same object when all have one. */
export function ensureIds(raw: Raw): Raw {
  const lists = (['scenes', 'zooms', 'masks', 'texts'] as const).filter((list) => items(raw, list).some((item) => typeof item.id !== 'string'));
  if (lists.length === 0) return raw;
  const next = structuredClone(raw);
  const taken = usedIds(next);
```

with:

```ts
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Gives every scene, overlay and cut without an id one (`s3`, `z1` …); returns the same object when all have one. */
export function ensureIds(raw: Raw): Raw {
  const lists = (['scenes', 'zooms', 'masks', 'texts', 'cuts'] as const).filter((list) => items(raw, list).some((item) => typeof item.id !== 'string'));
  if (lists.length === 0) return raw;
  const next = structuredClone(raw);
  const taken = usedIds(next);
```

In the same file, replace:

```ts
  }
}

/** Keeps a rectangle `[x, y, w, h]` inside the screen (its corner moved in, its size cut), at least 8 px each way. */
export function clampRect(rect: readonly number[], screen: { width: number; height: number } | undefined): number[] {
  let [x = 0, y = 0, w = MIN_RECT, h = MIN_RECT] = rect;
```

with:

```ts
  }
}

/**
 * Hand edits win: an automatic item (`auto`) changed by hand in anything but being on or off is
 * the person's now, and a rerun of the automatic edits leaves it alone.
 */
function claim(item: Item, fields?: Item): void {
  if (fields && (Object.keys(fields).every((key) => key === 'enabled' || key === 'auto' || key === 'id') || 'auto' in fields)) return;
  delete item.auto;
}

/** Keeps a rectangle `[x, y, w, h]` inside the screen (its corner moved in, its size cut), at least 8 px each way. */
export function clampRect(rect: readonly number[], screen: { width: number; height: number } | undefined): number[] {
  let [x = 0, y = 0, w = MIN_RECT, h = MIN_RECT] = rect;
```

In the same file, replace:

```ts
      const to = clampNumber(Number(item.to), from + frame * speed, end);
      item.from = round(from);
      item.to = round(to);
    } else item.duration = round(Math.max(frame, Number(item.duration)));
    return;
  }
  if (list === 'masks') {
    item.from = round(Math.max(0, Number(item.from)));
    item.to = round(Math.max(Number(item.from) + frame, Number(item.to)));
  } else {
```

with:

```ts
      const to = clampNumber(Number(item.to), from + frame * speed, end);
      item.from = round(from);
      item.to = round(to);
      // a crop stays inside the screen, at least 8 px each way
      const crop = item.crop as { rect?: number[] } | undefined;
      if (crop && Array.isArray(crop.rect)) crop.rect = clampRect(crop.rect, limits.screen);
    } else item.duration = round(Math.max(frame, Number(item.duration)));
    return;
  }
  if (list === 'masks' || list === 'cuts') {
    item.from = round(Math.max(0, Number(item.from)));
    item.to = round(Math.max(Number(item.from) + frame, Number(item.to)));
  } else {
```

In the same file, replace:

```ts
        item.from = Number(item.from) + by;
        item.to = Number(item.to) + by;
      } else item.at = Math.max(0, Number(item.at) + command.by);
      touched.push([command.list, item]);
      break;
    }
    case 'set': {
      const { item } = find(next, command.list, command.id);
      setFields(item, command.fields);
      touched.push([command.list, item]);
      break;
```

with:

```ts
        item.from = Number(item.from) + by;
        item.to = Number(item.to) + by;
      } else item.at = Math.max(0, Number(item.at) + command.by);
      claim(item);
      touched.push([command.list, item]);
      break;
    }
    case 'set': {
      const { item } = find(next, command.list, command.id);
      claim(item, command.fields);
      setFields(item, command.fields);
      touched.push([command.list, item]);
      break;
```

In the same file, replace:

```ts
      const { item, index } = find(next, command.list, command.id);
      const taken = usedIds(next);
      const copy: Item = { ...structuredClone(item), id: command.newId && !taken.has(command.newId) ? command.newId : newId(command.list, taken) };
      if (command.shift) {
        if (command.list === 'masks') {
          copy.from = Number(copy.from) + command.shift;
```

with:

```ts
      const { item, index } = find(next, command.list, command.id);
      const taken = usedIds(next);
      const copy: Item = { ...structuredClone(item), id: command.newId && !taken.has(command.newId) ? command.newId : newId(command.list, taken) };
      // a copy is the person's, never one the automatic edits may replace
      claim(copy);
      if (command.shift) {
        if (command.list === 'masks') {
          copy.from = Number(copy.from) + command.shift;
```

In the same file, replace:

```ts
      output.height = command.height;
      break;
    }
    case 'scenes': {
      next.scenes = structuredClone(command.scenes);
      const ids = ensureIds(next);
```

with:

```ts
      output.height = command.height;
      break;
    }
    case 'auto-edits': {
      const autoEdits = (next.autoEdits && typeof next.autoEdits === 'object' ? next.autoEdits : (next.autoEdits = {})) as Item;
      autoEdits[command.kind] = command.value;
      break;
    }
    case 'scenes': {
      next.scenes = structuredClone(command.scenes);
      const ids = ensureIds(next);
```

In the same file, replace:

```ts
  return { raw: current, dropped };
}

const NOUNS: Record<ListName, [string, string]> = { scenes: ['scene', 'scenes'], zooms: ['zoom', 'zooms'], masks: ['mask', 'masks'], texts: ['caption', 'captions'] };
const noun = (list: ListName, count: number) => `${count} ${NOUNS[list][count === 1 ? 0 : 1]}`;

/**
```

with:

```ts
  return { raw: current, dropped };
}

const NOUNS: Record<ListName, [string, string]> = { scenes: ['scene', 'scenes'], zooms: ['zoom', 'zooms'], masks: ['mask', 'masks'], texts: ['caption', 'captions'], cuts: ['cut', 'cuts'] };
const noun = (list: ListName, count: number) => `${count} ${NOUNS[list][count === 1 ? 0 : 1]}`;

/**
```

In the same file, replace:

```ts
  return changeParts(before, after).join(' · ') || 'no visible change';
}

/** The first item added or changed between two versions (scenes, then zooms, masks, captions), to show it. */
export function firstChanged(before: CuttleProject, after: CuttleProject): { list: ListName; id: string } | undefined {
  for (const list of ['scenes', 'zooms', 'masks', 'texts'] as const) {
    const old = new Map(before[list].map((item) => [item.id, JSON.stringify(item)]));
    const found = after[list].find((item) => item.id !== undefined && old.get(item.id) !== JSON.stringify(item));
    if (found?.id) return { list, id: found.id };
```

with:

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

In the same file, replace:

```ts

function changeParts(before: CuttleProject, after: CuttleProject): string[] {
  const parts: string[] = [];
  for (const list of ['scenes', 'zooms', 'masks', 'texts'] as const) {
    const key = (item: { id?: string }, index: number) => item.id ?? `#${index}`;
    const old = new Map(before[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
    const now = new Map(after[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
```

with:

```ts

function changeParts(before: CuttleProject, after: CuttleProject): string[] {
  const parts: string[] = [];
  for (const list of ['scenes', 'zooms', 'masks', 'texts', 'cuts'] as const) {
    const key = (item: { id?: string }, index: number) => item.id ?? `#${index}`;
    const old = new Map(before[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
    const now = new Map(after[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
```

In the same file, replace:

```ts
    if (changed) parts.push(`${noun(list, changed)} changed`);
  }
  if (JSON.stringify(before.look) !== JSON.stringify(after.look)) parts.push('the look changed');
  if (JSON.stringify(before.output) !== JSON.stringify(after.output)) parts.push('the output size changed');
  if (JSON.stringify(before.sources) !== JSON.stringify(after.sources)) parts.push('another take');
  return parts;
```

with:

```ts
    if (changed) parts.push(`${noun(list, changed)} changed`);
  }
  if (JSON.stringify(before.look) !== JSON.stringify(after.look)) parts.push('the look changed');
  if (JSON.stringify(before.autoEdits) !== JSON.stringify(after.autoEdits)) parts.push('the automatic edits changed');
  if (JSON.stringify(before.output) !== JSON.stringify(after.output)) parts.push('the output size changed');
  if (JSON.stringify(before.sources) !== JSON.stringify(after.sources)) parts.push('another take');
  return parts;
```

In `apps/desktop/src/shared/timeline-model.ts`, replace:

```ts
// What the editor's timeline draws, in output seconds: pure, so it is tested without a window.
import type { CuttleProject, InputEvent, Marker, MarkerKind } from '@cuttle/project';
import { occurrences, type SceneSpan } from '@cuttle/timeline';
import { formatDuration } from './format';

export type OverlayKind = 'zoom' | 'mask' | 'caption';

export interface SceneBlock {
  index: number;
  /** The scene's id (`#<index>` for one without). */
  id: string;
```

with:

```ts
// What the editor's timeline draws, in output seconds: pure, so it is tested without a window.
import type { AutoKind, CuttleProject, InputEvent, Marker, MarkerKind } from '@cuttle/project';
import { occurrences, type SceneSpan } from '@cuttle/timeline';
import { formatDuration } from './format';

export type OverlayKind = 'zoom' | 'mask' | 'caption';

export interface SceneBlock {
  /** The scene's index in the project's `scenes`. */
  index: number;
  /** The scene's id (`#<index>` for one without). */
  id: string;
```

In the same file, replace:

```ts
  /** Speed and lengths of a clip (`12× · 145 s → 12 s`), the motion of a still. */
  detail: string;
  speed?: number;
}

export interface OverlayBlock {
```

with:

```ts
  /** Speed and lengths of a clip (`12× · 145 s → 12 s`), the motion of a still. */
  detail: string;
  speed?: number;
  /**
   * A clip's pieces, where cuts take parts out: each one's output start and end and the source
   * second it starts at. One piece without cuts.
   */
  pieces?: ClipPiece[];
}

export interface ClipPiece {
  start: number;
  end: number;
  from: number;
}

/** Where cuts show on the video lane: a notch at the output second a clip jumps (or would, for cuts that are off). */
export interface CutNotch {
  t: number;
  /** The cuts there, by id. */
  ids: string[];
  /** Whether they take the stretch out (off: the video plays it). */
  enabled: boolean;
  /** Their kind, when they are automatic and share one. */
  auto?: AutoKind;
  /** The first one's label, or what it is. */
  title: string;
}

export interface OverlayBlock {
```

In the same file, replace:

```ts
export interface TimelineModel {
  duration: number;
  scenes: SceneBlock[];
  lanes: Record<OverlayKind, OverlayLane>;
  markers: MarkerPin[];
}

const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

function sceneBlock(span: SceneSpan): SceneBlock {
  const { scene, index, start, end } = span;
  const id = scene.id ?? `#${index}`;
  if (scene.type === 'clip') {
    const source = scene.to - scene.from;
    const detail = scene.speed === 1 ? formatDuration(source) : `${formatDuration(source)} → ${formatDuration(end - start)}`;
    // The speed shows once, in front of the title (`12× Claude at work`): an unlabelled sped-up clip has no title.
    return { index, id, kind: 'clip', start, end, title: scene.label ?? (scene.speed === 1 ? 'Clip' : ''), detail, speed: scene.speed };
  }
  if (scene.type === 'still') {
    const motion = scene.motion === 'none' ? '' : ` · ${scene.motion === 'kenburns' ? 'Ken Burns' : 'scroll'}`;
```

with:

```ts
export interface TimelineModel {
  duration: number;
  scenes: SceneBlock[];
  cuts: CutNotch[];
  lanes: Record<OverlayKind, OverlayLane>;
  markers: MarkerPin[];
}

const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/** One block per scene: a clip's pieces (the spans with its `sceneIndex`) make one block. */
function sceneBlock(pieces: readonly SceneSpan[], project: CuttleProject): SceneBlock {
  const first = pieces[0]!;
  const index = first.sceneIndex;
  const start = first.start;
  const end = pieces.at(-1)!.end;
  const scene = project.scenes[index] ?? first.scene;
  const id = scene.id ?? `#${index}`;
  if (scene.type === 'clip') {
    const source = scene.to - scene.from;
    const shown = end - start;
    // the source it plays, and how long the video shows it when sped up or cut
    const detail = Math.abs(shown - source) < 1e-6 ? formatDuration(source) : `${formatDuration(source)} → ${formatDuration(shown)}`;
    const own = pieces.map((piece) => ({ start: piece.start, end: piece.end, from: piece.scene.type === 'clip' ? piece.scene.from : scene.from }));
    // The speed shows once, in front of the title (`12× Claude at work`): an unlabelled sped-up clip has no title.
    return { index, id, kind: 'clip', start, end, title: scene.label ?? (scene.speed === 1 ? 'Clip' : ''), detail, speed: scene.speed, pieces: own };
  }
  if (scene.type === 'still') {
    const motion = scene.motion === 'none' ? '' : ` · ${scene.motion === 'kenburns' ? 'Ken Burns' : 'scroll'}`;
```

In the same file, replace:

```ts
  return { blocks, cutOut: cutOutItems.length, cutOutItems, rows: Math.max(1, ends.length) };
}

/** The output seconds at which the clips show source second `t` (none when it is cut out). */
export function outputTimesOf(spans: readonly SceneSpan[], t: number): number[] {
  const times: number[] = [];
```

with:

```ts
  return { blocks, cutOut: cutOutItems.length, cutOutItems, rows: Math.max(1, ends.length) };
}

/** The source second a clip block shows at output second `t` (past its last piece: on at its speed). */
export function blockSourceAt(block: SceneBlock, t: number): number {
  const pieces = block.pieces ?? [];
  const speed = block.speed ?? 1;
  const piece = pieces.find((candidate) => t < candidate.end) ?? pieces.at(-1);
  return piece ? piece.from + (t - piece.start) * speed : 0;
}

/** The notches of the cuts: on, where a clip's piece starts after them or a clip lost its start or end; off, where they would cut. */
function cutNotches(project: CuttleProject, spans: readonly SceneSpan[]): CutNotch[] {
  const notches: CutNotch[] = [];
  const add = (t: number, cuts: CuttleProject['cuts']) => {
    if (cuts.length === 0) return;
    const there = notches.find((notch) => Math.abs(notch.t - t) < 1e-6 && notch.enabled === cuts[0]!.enabled);
    const ids = cuts.map((cut) => cut.id ?? `#${project.cuts.indexOf(cut)}`);
    if (there) {
      there.ids.push(...ids.filter((id) => !there.ids.includes(id)));
      return;
    }
    const kinds = new Set(cuts.map((cut) => cut.auto));
    const auto = kinds.size === 1 ? cuts[0]!.auto : undefined;
    notches.push({ t, ids, enabled: cuts[0]!.enabled, ...(auto !== undefined && { auto }), title: cuts[0]!.label ?? 'Cut' });
  };
  const on = project.cuts.filter((cut) => cut.enabled);
  const touching = (from: number, to: number) => on.filter((cut) => cut.from < to + 1e-6 && cut.to > from - 1e-6);
  spans.forEach((span, i) => {
    const scene = span.scene;
    if (scene.type !== 'clip') return;
    const original = project.scenes[span.sceneIndex];
    const previous = spans[i - 1];
    if (span.cutBefore && previous?.scene.type === 'clip') add(span.start, touching(previous.scene.to, scene.from));
    // the clip's own start or end taken out
    if (!span.cutBefore && original?.type === 'clip' && scene.from > original.from + 1e-6) add(span.start, touching(original.from, scene.from));
    const next = spans[i + 1];
    const lastPiece = !(next?.cutBefore && next.sceneIndex === span.sceneIndex);
    if (lastPiece && original?.type === 'clip' && scene.to < original.to - 1e-6) add(span.end, touching(scene.to, original.to));
  });
  for (const cut of project.cuts) {
    if (cut.enabled) continue;
    const t = outputTimesOf(spans, cut.from)[0];
    if (t !== undefined) add(t, [cut]);
  }
  return notches.sort((a, b) => a.t - b.t);
}

/** The output seconds at which the clips show source second `t` (none when it is cut out). */
export function outputTimesOf(spans: readonly SceneSpan[], t: number): number[] {
  const times: number[] = [];
```

In the same file, replace:

```ts
}

export function timelineModel(project: CuttleProject, spans: readonly SceneSpan[], markers: readonly Marker[] = []): TimelineModel {
  return {
    duration: spans.at(-1)?.end ?? 0,
    scenes: spans.map(sceneBlock),
    lanes: {
      zoom: lane('zoom', project.zooms, spans, (zoom) => [zoom.at, zoom.at + zoom.duration], () => 'Zoom'),
      mask: lane('mask', project.masks, spans, (mask) => [mask.from, mask.to], () => 'Mask'),
```

with:

```ts
}

export function timelineModel(project: CuttleProject, spans: readonly SceneSpan[], markers: readonly Marker[] = []): TimelineModel {
  // a clip with cuts in it is several spans in a row with one sceneIndex: one block
  const groups: SceneSpan[][] = [];
  for (const span of spans) {
    const last = groups.at(-1);
    if (last && last[0]!.sceneIndex === span.sceneIndex) last.push(span);
    else groups.push([span]);
  }
  return {
    duration: spans.at(-1)?.end ?? 0,
    scenes: groups.map((group) => sceneBlock(group, project)),
    cuts: cutNotches(project, spans),
    lanes: {
      zoom: lane('zoom', project.zooms, spans, (zoom) => [zoom.at, zoom.at + zoom.duration], () => 'Zoom'),
      mask: lane('mask', project.masks, spans, (mask) => [mask.from, mask.to], () => 'Mask'),
```

In `apps/desktop/src/renderer/editor/session.ts`, replace:

```ts
import { createStore } from './store';

/** What is selected: a scene or an overlay by id, an overlay with the stretch of the video where it was clicked. */
export type Selection = { kind: 'scene' | OverlayKind; id: string; start?: number; end?: number };

/** The tools: V selects; Z and M draw zooms and masks in the source view; T adds a caption. */
export type Tool = 'select' | 'zoom' | 'mask' | 'caption';

export interface EditorState {
  phase: 'loading' | 'ready' | 'failed';
```

with:

```ts
import { createStore } from './store';

/** What is selected: a scene or an overlay by id, an overlay with the stretch of the video where it was clicked. */
/** What is selected; a `crop` is a clip's (its id is the clip's). */
export type Selection = { kind: 'scene' | OverlayKind | 'cut' | 'crop'; id: string; start?: number; end?: number };

/** The tools: V selects; Z and M draw zooms and masks in the source view; T adds a caption. */
export type Tool = 'select' | 'zoom' | 'mask' | 'caption' | 'crop';

export interface EditorState {
  phase: 'loading' | 'ready' | 'failed';
```

In the same file, replace:

```ts
  player: PlayerState;
  selection?: Selection;
  tool: Tool;
  tab: 'selection' | 'look';
  /** Snapping on the timeline (Ctrl while dragging turns it off for that drag). */
  snap: boolean;
  mediaState: MediaState;
```

with:

```ts
  player: PlayerState;
  selection?: Selection;
  tool: Tool;
  tab: 'selection' | 'auto' | 'look';
  /** Snapping on the timeline (Ctrl while dragging turns it off for that drag). */
  snap: boolean;
  mediaState: MediaState;
```

In the same file, replace:

```ts
  }
}

const LISTS = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts' } as const;

/** The player follows the document (edits, previews, outside changes) and the previewed format. */
function followDocument(): void {
```

with:

```ts
  }
}

const LISTS = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', cut: 'cuts', crop: 'scenes' } as const;

/** The player follows the document (edits, previews, outside changes) and the previewed format. */
function followDocument(): void {
```

In the same file, replace:

```ts
  store.subscribe(() => {
    // a selection whose item an undo or an outside change removed is cleared
    const { selection, doc } = store.get();
    if (selection && doc && !doc.project[LISTS[selection.kind]].some((item) => item.id === selection.id)) select(undefined);
    const next = shownProject();
    if (next === last || !next) return;
    last = next;
```

with:

```ts
  store.subscribe(() => {
    // a selection whose item an undo or an outside change removed is cleared
    const { selection, doc } = store.get();
    if (selection && doc && !(doc.project[LISTS[selection.kind]] as { id?: string }[]).some((item) => item.id === selection.id)) select(undefined);
    const next = shownProject();
    if (next === last || !next) return;
    last = next;
```

In the same file, replace:

```ts

/** The stage shows the source view: paused, with the Zoom or Mask tool on or a zoom or mask selected (playing shows the video). */
export const sourceViewShown = (state: EditorState): boolean =>
  !state.player.playing && (state.tool === 'zoom' || state.tool === 'mask' || state.selection?.kind === 'zoom' || state.selection?.kind === 'mask');

/** Picks a tool; Esc goes back to Select. Zoom and Mask show the source view. */
export function setTool(tool: Tool): void {
  dismissWarning();
  store.set({ tool });
```

with:

```ts

/** The stage shows the source view: paused, with the Zoom or Mask tool on or a zoom or mask selected (playing shows the video). */
export const sourceViewShown = (state: EditorState): boolean =>
  !state.player.playing &&
  (state.tool === 'zoom' || state.tool === 'mask' || state.tool === 'crop' || state.selection?.kind === 'zoom' || state.selection?.kind === 'mask' || state.selection?.kind === 'crop');

/** Picks a tool; Esc goes back to Select. Zoom, Mask and Crop show the source view. */
export function setTool(tool: Tool): void {
  dismissWarning();
  store.set({ tool });
```

In `apps/desktop/src/renderer/editor/actions.ts`, replace:

```ts
export const NEW_OVERLAY_SECONDS = 3;
export const SPEEDS = [1, 2, 4, 8, 12, 20] as const;

export const LIST_OF: Record<Selection['kind'], ListName> = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts' };
const NAMES: Record<ListName, string> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption' };

/** Where the playhead is: its scene and, in a clip, the source second it shows. */
export interface PlayheadPlace {
  t: number;
  span: SceneSpan;
  index: number;
  clip?: ClipScene;
  source?: number;
```

with:

```ts
export const NEW_OVERLAY_SECONDS = 3;
export const SPEEDS = [1, 2, 4, 8, 12, 20] as const;

export const LIST_OF: Record<Selection['kind'], ListName> = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', cut: 'cuts', crop: 'scenes' };
const NAMES: Record<ListName, string> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', cuts: 'cut' };

/** Where the playhead is: its scene and, in a clip, the source second it shows. */
export interface PlayheadPlace {
  t: number;
  /** The span (a piece of a clip with cuts in it). */
  span: SceneSpan;
  /** The scene's index in the project's `scenes`. */
  index: number;
  clip?: ClipScene;
  source?: number;
```

In the same file, replace:

```ts
export function playheadPlace(t = currentPlayer()?.current().t ?? 0): PlayheadPlace | undefined {
  // the document's scenes, not the player's (it follows an edit a moment later)
  const project = documentProject();
  const spans = project ? sceneSpans(project.scenes) : [];
  const index = spans.findIndex((span) => t >= span.start && t < span.end);
  const at = index >= 0 ? index : spans.length - 1;
  const span = spans[at];
  if (!span) return undefined;
  if (span.scene.type !== 'clip') return { t, span, index: at };
  const clip = span.scene;
  return { t, span, index: at, clip, source: Math.min(clip.to, clip.from + (Math.min(t, span.end) - span.start) * clip.speed) };
}

/**
```

with:

```ts
export function playheadPlace(t = currentPlayer()?.current().t ?? 0): PlayheadPlace | undefined {
  // the document's scenes, not the player's (it follows an edit a moment later)
  const project = documentProject();
  const spans = project ? sceneSpans(project.scenes, project.cuts) : [];
  const found = spans.findIndex((span) => t >= span.start && t < span.end);
  const span = spans[found >= 0 ? found : spans.length - 1];
  if (!span) return undefined;
  const index = span.sceneIndex;
  const scene = project!.scenes[index]!;
  if (scene.type !== 'clip' || span.scene.type !== 'clip') return { t, span, index };
  // the clip as the project has it (for its id and edits), the source second from the piece shown
  const piece = span.scene;
  return { t, span, index, clip: scene, source: Math.min(piece.to, piece.from + (Math.min(t, span.end) - span.start) * piece.speed) };
}

/**
```

In the same file, replace:

```ts
export function deleteSelection(): void {
  const selection = store.get().selection;
  if (!selection) return;
  const list = LIST_OF[selection.kind];
  if (edit([{ type: 'delete', list, id: selection.id }], `Delete ${NAMES[list]}`)) select(undefined);
}
```

with:

```ts
export function deleteSelection(): void {
  const selection = store.get().selection;
  if (!selection) return;
  // a crop belongs to its clip: deleting it shows the whole screen again
  if (selection.kind === 'crop') {
    if (edit([{ type: 'set', list: 'scenes', id: selection.id, fields: { crop: undefined } }], 'Remove crop')) select({ kind: 'scene', id: selection.id });
    return;
  }
  const list = LIST_OF[selection.kind];
  if (edit([{ type: 'delete', list, id: selection.id }], `Delete ${NAMES[list]}`)) select(undefined);
}
```

In the same file, replace:

```ts
export function duplicateSelection(): void {
  const selection = store.get().selection;
  if (!selection) return;
  const list = LIST_OF[selection.kind];
  edit([{ type: 'duplicate', list, id: selection.id, ...(list !== 'scenes' && { shift: 1 }) }], `Duplicate ${NAMES[list]}`);
}
```

with:

```ts
export function duplicateSelection(): void {
  const selection = store.get().selection;
  if (!selection) return;
  if (selection.kind === 'cut') return toast('A cut cannot be copied: the same stretch is cut once.', { tone: 'warning' });
  if (selection.kind === 'crop') return toast('A crop belongs to its clip: duplicate the clip instead.', { tone: 'warning' });
  const list = LIST_OF[selection.kind];
  edit([{ type: 'duplicate', list, id: selection.id, ...(list !== 'scenes' && { shift: 1 }) }], `Duplicate ${NAMES[list]}`);
}
```

In the same file, replace:

```ts
  if (!doc || !media || !project) return;
  if (doc.issues) return toast('cuttle.json has a mistake; fix it first (Claude or a text editor), then edit here again.', { tone: 'warning' });
  if (media.events.length === 0) return toast('This take has no clicks or keys recorded: there are no clicks to zoom on.', { tone: 'warning' });
  const clips = sceneSpans(project.scenes).flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
  const zooms = clickZooms(media.events, clips, screenSize(), project.zooms);
  if (zooms.length === 0) {
    // why, in one line (it stays on one line at the narrowest window)
```

with:

```ts
  if (!doc || !media || !project) return;
  if (doc.issues) return toast('cuttle.json has a mistake; fix it first (Claude or a text editor), then edit here again.', { tone: 'warning' });
  if (media.events.length === 0) return toast('This take has no clicks or keys recorded: there are no clicks to zoom on.', { tone: 'warning' });
  const clips = sceneSpans(project.scenes, project.cuts).flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
  const zooms = clickZooms(media.events, clips, screenSize(), project.zooms);
  if (zooms.length === 0) {
    // why, in one line (it stays on one line at the narrowest window)
```

In the same file, replace:

```ts
    if (free === 0) return toast('Every click is under a zoom already.');
    return toast(`No zoom fits ${free === 1 ? 'the click' : `the ${free} clicks`} left: sped up, or near a cut or a zoom.`);
  }
  const commands = zooms.map((zoom) => ({ type: 'add', list: 'zooms', item: { label: zoom.clicks === 1 ? 'Click' : 'Clicks', at: zoom.at, duration: zoom.duration, rect: zoom.rect } }) as Command);
  if (edit(commands, 'Zoom on clicks')) toast(`Added ${zooms.length} zoom${zooms.length === 1 ? '' : 's'} on clicks.`, { undo: true });
}

/** A mask from the playhead to the clip's end; then the source view to place it. */
export function addMask(rect?: number[]): void {
  const blocked = overlayBlocked();
```

with:

```ts
    if (free === 0) return toast('Every click is under a zoom already.');
    return toast(`No zoom fits ${free === 1 ? 'the click' : `the ${free} clicks`} left: sped up, or near a cut or a zoom.`);
  }
  const commands = zooms.map((zoom) => ({ type: 'add', list: 'zooms', item: { label: zoom.clicks === 1 ? 'Click' : 'Clicks', at: zoom.at, duration: zoom.duration, rect: zoom.rect, auto: 'click' } }) as Command);
  if (edit(commands, 'Zoom on clicks')) toast(`Added ${zooms.length} zoom${zooms.length === 1 ? '' : 's'} on clicks.`, { undo: true });
}

/**
 * Crops a clip to `rect` (source px): the window shows that part of the screen. The clip is `id`,
 * else the selected one, else the one at the playhead.
 */
export function cropClip(rect: number[], id = selectedOrCurrentClip()?.id): void {
  if (!id) return toast('Select a clip, or move the playhead onto one, to crop it.', { tone: 'warning' });
  if (edit([{ type: 'set', list: 'scenes', id, fields: { crop: { rect } } }], 'Crop clip')) select({ kind: 'crop', id });
}

/** A mask from the playhead to the clip's end; then the source view to place it. */
export function addMask(rect?: number[]): void {
  const blocked = overlayBlocked();
```

In the same file, replace:

```ts
  else edit([{ type: 'look', path: ['background'], value: { preset: 'image', image: chosen.path } }], 'Background image');
}

const KIND_OF: Record<ListName, Selection['kind']> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption' };

/** Selects an item and moves the playhead to where the video first shows it (the toast's "Show"). */
export function reveal(list: ListName, id: string): void {
```

with:

```ts
  else edit([{ type: 'look', path: ['background'], value: { preset: 'image', image: chosen.path } }], 'Background image');
}

const KIND_OF: Record<ListName, Selection['kind']> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', cuts: 'cut' };

/** Selects an item and moves the playhead to where the video first shows it (the toast's "Show"). */
export function reveal(list: ListName, id: string): void {
```

In the same file, replace:

```ts
  const item = project?.[list].find((candidate) => candidate.id === id);
  if (!project || !item) return;
  select({ kind: KIND_OF[list], id });
  const spans = sceneSpans(project.scenes);
  const at = list === 'scenes' ? spans.find((span) => span.scene === item)?.start : outputTimesOf(spans, 'at' in item ? item.at : 'from' in item ? item.from : 0)[0];
  if (at !== undefined) void currentPlayer()?.seek(at);
}

/** One clip over the whole take, instead of the cut (undo brings the cut back). */
export function showRawTake(): void {
  const media = store.get().media;
```

with:

```ts
  const item = project?.[list].find((candidate) => candidate.id === id);
  if (!project || !item) return;
  select({ kind: KIND_OF[list], id });
  const spans = sceneSpans(project.scenes, project.cuts);
  const sceneIndex = list === 'scenes' ? project.scenes.indexOf(item as Scene) : -1;
  const at =
    list === 'scenes'
      ? spans.find((span) => span.sceneIndex === sceneIndex)?.start
      : list === 'cuts'
        ? cutShownAt(spans, item as { from: number; to: number; enabled: boolean })
        : outputTimesOf(spans, 'at' in item ? item.at : 'from' in item ? item.from : 0)[0];
  if (at !== undefined) void currentPlayer()?.seek(at);
}

/** Where the video shows a cut: the frame right after it (off: where it would start); undefined when no clip covers it. */
export function cutShownAt(spans: readonly SceneSpan[], cut: { from: number; to: number; enabled: boolean }): number | undefined {
  if (!cut.enabled) return outputTimesOf(spans, cut.from)[0];
  const after = spans.find((span) => span.scene.type === 'clip' && span.scene.from >= cut.to - 1e-6 && span.scene.from <= cut.to + 1e-6);
  return after?.start ?? outputTimesOf(spans, cut.to)[0] ?? outputTimesOf(spans, Math.max(0, cut.from - 1e-3))[0];
}

/** One clip over the whole take, instead of the cut (undo brings the cut back). */
export function showRawTake(): void {
  const media = store.get().media;
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node apps/desktop`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/shared apps/desktop/test/document.test.ts apps/desktop/test/timeline-model.test.ts apps/desktop/src/renderer/editor/session.ts apps/desktop/src/renderer/editor/actions.ts
git commit -m "desktop: cuts in the document and the timeline model; a hand edit makes an automatic item the person's

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cuttle's select

**Files:**
- Create: `apps/desktop/src/renderer/Select.tsx`
- Modify: `apps/desktop/src/renderer/base.css`, `apps/desktop/src/renderer/picker/{Picker.tsx,picker.css}`, `apps/desktop/src/renderer/settings/{Settings.tsx,settings.css}`, `apps/desktop/src/renderer/editor/{ExportSheet.tsx,App.tsx}`

- [ ] **Step 1: The component and its styles**

`apps/desktop/src/renderer/Select.tsx`:

```
// Cuttle's own select: a button that opens a styled list in place of the system's (whose list is
// drawn by Windows, white and in its own font). The list opens below the button, or above it when
// there is no room; it is drawn into the page's body, so no panel clips it.
//
// Keys, as in a system select: Enter, Space or the arrows open it; in the list the arrows, Home and
// End move, letters jump to an option, Enter or Space picks, Esc and Tab close it (Esc also never
// reaches the window: the editor would read it as "back out").
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronIcon } from './icons';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Quiet text at the end of the row (a size, "not connected"). */
  note?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T | undefined;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Its name for screen readers (the visible label is beside it). */
  label: string;
  /** Shown when the value is none of the options. */
  placeholder?: string;
  disabled?: boolean;
  /** \`field\`: as wide as its field; \`compact\`: the timeline bar's height; \`bare\`: text with a chevron; \`icon\`: the chevron only. */
  variant?: 'field' | 'compact' | 'bare' | 'icon';
  className?: string;
  testId?: string;
  title?: string;
  /** What the button shows instead of the chosen option's label. */
  children?: ReactNode;
}

const GAP = 4;
const MAX_HEIGHT = 320;

export function Select<T extends string>({ value, options, onChange, label, placeholder = '–', disabled, variant = 'field', className, testId, title, children }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number; minWidth: number; maxHeight: number }>();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();
  const chosen = options.find((option) => option.value === value);

  const enabledFrom = (start: number, step: 1 | -1) => {
    for (let i = start; i >= 0 && i < options.length; i += step) if (!options[i]!.disabled) return i;
    return -1;
  };

  const show = () => {
    if (disabled || options.length === 0) return;
    const at = options.findIndex((option) => option.value === value);
    setActive(at >= 0 && !options[at]!.disabled ? at : enabledFrom(0, 1));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    // placed anew on the next open, before the list is drawn
    setPlace(undefined);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  /** Picks an option; with the mouse the focus is let go (the keys go back to the page, as after a click on a button). */
  const pick = (index: number, byMouse = false) => {
    const option = options[index];
    if (!option || option.disabled) return;
    close(!byMouse);
    if (byMouse) button.current?.blur();
    if (option.value !== value) onChange(option.value);
  };

  // below the button, or above it when the window has no room for the list below
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const box = button.current.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - GAP - 8;
    const above = box.top - GAP - 8;
    const wanted = Math.min(MAX_HEIGHT, options.length * 30 + 8);
    const up = below < wanted && above > below;
    setPlace({
      left: Math.max(8, Math.min(box.left, window.innerWidth - Math.max(box.width, 160) - 8)),
      minWidth: box.width,
      maxHeight: Math.max(120, Math.min(MAX_HEIGHT, up ? above : below)),
      ...(up ? { bottom: window.innerHeight - box.top + GAP } : { top: box.bottom + GAP }),
    });
  }, [open, options.length]);

  // the keys go to the list while it is open (it is drawn once placed); a press elsewhere, a scroll or a resize closes it
  const placed = place !== undefined;
  useEffect(() => {
    if (!open || !placed) return;
    list.current?.focus({ preventScroll: true });
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    const shut = (event: Event) => {
      if (event.type === 'scroll' && list.current?.contains(event.target as Node)) return;
      close(false);
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('scroll', shut, true);
    window.addEventListener('resize', shut);
    window.addEventListener('blur', shut);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('scroll', shut, true);
      window.removeEventListener('resize', shut);
      window.removeEventListener('blur', shut);
    };
  }, [open, placed]);

  // the active option stays in view
  useEffect(() => {
    if (open && active >= 0) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  /** Letters typed within half a second find the first option that starts with them. */
  const typeAhead = (key: string): boolean => {
    if (key.length !== 1 || key === ' ') return false;
    const now = performance.now();
    typed.current = { text: now - typed.current.at < 500 ? typed.current.text + key.toLowerCase() : key.toLowerCase(), at: now };
    const found = options.findIndex((option) => !option.disabled && option.label.toLowerCase().startsWith(typed.current.text));
    if (found >= 0) setActive(found);
    return true;
  };

  const onButtonKey = (event: KeyboardEvent) => {
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      show();
    }
  };

  const onListKey = (event: KeyboardEvent) => {
    // nothing pressed in the list reaches the window (the editor's keys)
    event.stopPropagation();
    const step = (from: number, by: 1 | -1) => {
      const next = enabledFrom(from + by, by);
      return next >= 0 ? next : from;
    };
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((at) => step(at, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((at) => step(at, -1));
        return;
      case 'Home':
        event.preventDefault();
        setActive(enabledFrom(0, 1));
        return;
      case 'End':
        event.preventDefault();
        setActive(enabledFrom(options.length - 1, -1));
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        pick(active);
        return;
      case 'Escape':
        event.preventDefault();
        close();
        return;
      case 'Tab':
        close(false);
        return;
      default:
        if (typeAhead(event.key)) event.preventDefault();
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`select-trigger select-${variant}${className ? ` ${className}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={label}
        title={title}
        disabled={disabled}
        data-testid={testId}
        data-value={value}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
      >
        {variant !== 'icon' && <span className="select-value">{children ?? chosen?.label ?? placeholder}</span>}
        <ChevronIcon size={variant === 'compact' || variant === 'bare' ? 12 : 14} />
      </button>
      {open &&
        place &&
        createPortal(
          <ul
            ref={list}
            id={`${id}-list`}
            className="select-list"
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
            style={place}
            onKeyDown={onListKey}
            data-testid={testId ? `${testId}-list` : undefined}
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={index === active ? 'active' : undefined}
                onPointerEnter={() => !option.disabled && setActive(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => pick(index, true)}
              >
                <CheckIcon className="check" size={14} />
                <span className="option-label">{option.label}</span>
                {option.note && <span className="option-note">{option.note}</span>}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
```

In `apps/desktop/src/renderer/base.css`, replace:

```
::-webkit-scrollbar-track {
  background: transparent;
}
```

with:

```
::-webkit-scrollbar-track {
  background: transparent;
}

/* Cuttle's select (Select.tsx): a button and a list drawn by the page, not the system's */
.select-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  height: 28px;
  padding: 0 8px 0 10px;
  border-radius: 7px;
  background: var(--raised);
  box-shadow: inset 0 0 0 1px var(--line);
  color: var(--text);
  text-align: left;
  transition: background var(--fast), box-shadow var(--fast);
}
.select-trigger:hover:not(:disabled) {
  background: var(--raised-hover);
  box-shadow: inset 0 0 0 1px var(--line-strong);
}
.select-trigger[aria-expanded='true'] {
  box-shadow: inset 0 0 0 1px var(--line-strong);
}
.select-trigger:focus-visible {
  box-shadow: var(--focus);
}
.select-trigger .select-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.select-trigger svg {
  flex: none;
  color: var(--faint);
  transition: transform var(--fast);
}
.select-trigger[aria-expanded='true'] svg {
  transform: rotate(180deg);
}
.select-trigger.select-field {
  flex: 1;
  min-width: 0;
  width: 100%;
}
.select-trigger.select-compact {
  height: 22px;
  padding: 0 4px 0 7px;
  border-radius: 6px;
  gap: 3px;
}
.select-trigger.select-bare,
.select-trigger.select-icon {
  height: auto;
  padding: 0;
  background: none;
  box-shadow: none;
  color: var(--muted);
}
.select-trigger.select-bare:hover:not(:disabled),
.select-trigger.select-icon:hover:not(:disabled) {
  background: none;
  box-shadow: none;
  color: var(--text);
}
.select-trigger.select-icon {
  justify-content: center;
  width: 20px;
  height: 26px;
  border-radius: 6px;
}
.select-trigger.select-bare:focus-visible,
.select-trigger.select-icon:focus-visible {
  box-shadow: var(--focus);
  border-radius: 4px;
}
.select-list {
  position: fixed;
  z-index: 1000;
  margin: 0;
  padding: 4px;
  list-style: none;
  overflow-y: auto;
  border-radius: 10px;
  background: var(--panel);
  box-shadow: var(--shadow-float);
  color: var(--text);
  font-size: var(--size-m);
  outline: none;
  animation: select-in var(--fast) var(--ease-out);
}
.select-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 4px 12px 4px 8px;
  border-radius: 7px;
  white-space: nowrap;
}
.select-list li.active {
  background: var(--raised-active);
}
.select-list li .check {
  flex: none;
  color: var(--accent);
  visibility: hidden;
}
.select-list li[aria-selected='true'] .check {
  visibility: visible;
}
.select-list li[aria-disabled='true'] {
  color: var(--faint);
}
.select-list .option-label {
  flex: 1;
}
.select-list .option-note {
  padding-left: 16px;
  color: var(--muted);
  font-size: var(--size-s);
}
@keyframes select-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
}
```

- [ ] **Step 2: The picker, the settings and the export sheet use it**

In `apps/desktop/src/renderer/picker/Picker.tsx`, replace:

```
import { barPlacement, bubblePlacement, bubbleSize, dragRect, labelPlacement, matchMediaDevice, windowsAt } from '../../shared/recording';
import { bridge } from '../bridge';
import { FolderIcon, MicIcon, WarningIcon } from '../icons';

type Mode = 'auto' | 'screen' | 'window' | 'region';
type Shown = { kind: 'screen' | 'window' | 'region'; rect: Rect; title: string; pixels: { width: number; height: number }; window?: number; of?: [number, number] };
```

with:

```
import { barPlacement, bubblePlacement, bubbleSize, dragRect, labelPlacement, matchMediaDevice, windowsAt } from '../../shared/recording';
import { bridge } from '../bridge';
import { FolderIcon, MicIcon, WarningIcon } from '../icons';
import { Select } from '../Select';

type Mode = 'auto' | 'screen' | 'window' | 'region';
type Shown = { kind: 'screen' | 'window' | 'region'; rect: Rect; title: string; pixels: { width: number; height: number }; window?: number; of?: [number, number] };
```

In the same file, replace:

```
              </svg>
              <div className="name">
                Stop on
                <select
                  className="stop"
                  value={choices.stop}
                  onChange={(event) => {
                    updateChoices({ stop: event.target.value as RecordChoices['stop'] });
                    event.target.blur();
                  }}
                  aria-label="Stop on"
                >
                  {STOPS.map((stop) => (
                    <option key={stop} value={stop}>
                      {STOP_NAMES[stop]}
                    </option>
                  ))}
                </select>
              </div>
              {choices.stop === 'claude' &&
                (choices.claudeFolder ? (
```

with:

```
              </svg>
              <div className="name">
                Stop on
                <Select
                  value={choices.stop}
                  options={STOPS.map((stop) => ({ value: stop, label: STOP_NAMES[stop] }))}
                  onChange={(stop) => updateChoices({ stop })}
                  label="Stop on"
                  variant="bare"
                  className="stop"
                  testId="stop-on"
                />
              </div>
              {choices.stop === 'claude' &&
                (choices.claudeFolder ? (
```

In the same file, replace:

```
        </span>
      </button>
      {names.length > 1 && (
        <select
          className="more"
          value={chosen ?? ''}
          onChange={(event) => {
            onChange(event.target.value || undefined);
            event.target.blur();
          }}
          aria-label={`${label} device`}
          style={{ width: 20 }}
        >
          <option value="">Off</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
      {meter}
    </div>
```

with:

```
        </span>
      </button>
      {names.length > 1 && (
        <Select
          value={chosen ?? ''}
          options={[{ value: '', label: 'Off' }, ...names.map((name) => ({ value: name, label: name }))]}
          onChange={(name) => onChange(name || undefined)}
          label={`${label} device`}
          variant="icon"
          className="more"
          title={`Choose the ${label.toLowerCase()}`}
        />
      )}
      {meter}
    </div>
```

In `apps/desktop/src/renderer/picker/picker.css`, replace:

```
  overflow: hidden;
  text-overflow: ellipsis;
}
.opt select {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--muted);
  font-size: 10.5px;
  max-width: 150px;
  padding: 0;
  text-overflow: ellipsis;
}
/* "Stop on" says it is a menu */
.opt select.stop {
  padding-right: 14px;
  background: transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 16 16' fill='none' stroke='%239a9aa5' stroke-width='2'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E") right center / 10px no-repeat;
}
.opt .folder {
  display: flex;
```

with:

```
  overflow: hidden;
  text-overflow: ellipsis;
}
/* "Stop on": the choice in small text with a chevron (Select.tsx, `bare`) */
.opt .select-trigger.stop {
  font-size: 10.5px;
  max-width: 150px;
  gap: 3px;
}
.opt .folder {
  display: flex;
```

In the same file, replace:

```
  color: var(--text);
  background: var(--raised-hover);
}
/* the device menu is only its chevron: the chosen name shows beside the toggle */
.opt select.more {
  appearance: none;
  border: 0;
  padding: 0;
  font-size: 0;
  background: transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='%239a9aa5' stroke-width='1.8'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E") center / 12px no-repeat;
}
.opt select.more:hover {
  background-color: var(--raised-hover);
}
.opt select.more option {
  font-size: var(--size-m);
  color: var(--text);
  background: var(--panel);
}
.meter {
  width: 34px;
```

with:

```
  color: var(--text);
  background: var(--raised-hover);
}
/* the device menu is only its chevron (Select.tsx, `icon`): the chosen name shows beside the toggle */
.opt .select-trigger.more {
  height: 24px;
  color: var(--faint);
}
.opt .select-trigger.more:hover:not(:disabled) {
  background: var(--raised-hover);
}
.meter {
  width: 34px;
```

In `apps/desktop/src/renderer/settings/Settings.tsx`, replace:

```
import type { Motion, RequestArgument, SettingsView, ToolsStatus } from '../../shared/ipc';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, CopyIcon, FolderIcon, Mark, WarningIcon } from '../icons';

const WINGET = 'winget install Gyan.FFmpeg';
```

with:

```
import type { Motion, RequestArgument, SettingsView, ToolsStatus } from '../../shared/ipc';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, CopyIcon, FolderIcon, Mark, WarningIcon } from '../icons';
import { Select } from '../Select';

const WINGET = 'winget install Gyan.FFmpeg';
```

In the same file, replace:

```
function DeviceSelect({ kind, value, devices, onChange }: { kind: 'camera' | 'mic'; value: string | undefined; devices: string[] | undefined; onChange: (device: string | null) => void }) {
  const missing = value !== undefined && devices !== undefined && !devices.includes(value);
  return (
    <select
      value={value ?? ''}
      onChange={(event) => {
        onChange(event.target.value === '' ? null : event.target.value);
        event.target.blur();
      }}
      disabled={devices === undefined}
      aria-label={kind === 'camera' ? 'Camera' : 'Microphone'}
      data-testid={`${kind}-select`}
    >
      <option value="">{devices === undefined ? 'Listing…' : 'None'}</option>
      {missing && <option value={value}>{value} (not connected)</option>}
      {(devices ?? []).map((device) => (
        <option key={device} value={device}>
          {device}
        </option>
      ))}
    </select>
  );
}
```

with:

```
function DeviceSelect({ kind, value, devices, onChange }: { kind: 'camera' | 'mic'; value: string | undefined; devices: string[] | undefined; onChange: (device: string | null) => void }) {
  const missing = value !== undefined && devices !== undefined && !devices.includes(value);
  return (
    <Select
      value={value ?? ''}
      options={[
        { value: '', label: devices === undefined ? 'Listing…' : 'None' },
        ...(missing ? [{ value: value!, label: value!, note: 'not connected' }] : []),
        ...(devices ?? []).map((device) => ({ value: device, label: device })),
      ]}
      onChange={(device) => onChange(device === '' ? null : device)}
      disabled={devices === undefined}
      label={kind === 'camera' ? 'Camera' : 'Microphone'}
      className="device"
      testId={`${kind}-select`}
    />
  );
}
```

In `apps/desktop/src/renderer/settings/settings.css`, replace:

```
  transform: translateX(14px);
  background: var(--panel);
}
.settings select {
  width: 230px;
  height: 30px;
  padding: 0 8px;
  font-size: var(--size-s);
  border: 0;
  border-radius: 8px;
  background: var(--raised);
  box-shadow: inset 0 0 0 1px var(--line);
}
.settings select:hover:not(:disabled) {
  box-shadow: inset 0 0 0 1px var(--line-strong);
}
.settings select:focus-visible {
  box-shadow: var(--focus);
}

/* the tools: a mark, what it is, where it is */
```

with:

```
  transform: translateX(14px);
  background: var(--panel);
}
/* the camera and mic (Select.tsx) */
.settings .select-trigger.device {
  width: 230px;
  height: 30px;
  border-radius: 8px;
  font-size: var(--size-s);
}

/* the tools: a mark, what it is, where it is */
```

In `apps/desktop/src/renderer/editor/ExportSheet.tsx`, replace:

```
import { exportChecks } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, FolderIcon } from '../icons';
import { cancelExport, closeExport, startExport, store } from './session';
import { useStore } from './store';
import { FORMATS, ownFormat, targetName } from './targets';
```

with:

```
import { exportChecks } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, FolderIcon } from '../icons';
import { Select } from '../Select';
import { cancelExport, closeExport, startExport, store } from './session';
import { useStore } from './store';
import { FORMATS, ownFormat, targetName } from './targets';
```

In the same file, replace:

```
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const checks = useMemo(() => (project ? exportChecks(project, sceneSpans(project.scenes)) : []), [project]);

  if (!open) return null;
```

with:

```
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const checks = useMemo(() => (project ? exportChecks(project, sceneSpans(project.scenes, project.cuts)) : []), [project]);

  if (!open) return null;
```

In the same file, replace:

```
            </div>
            <div className="row">
              Encoder
              <select value={encoder} onChange={(event) => setEncoder(event.target.value as keyof typeof ENCODERS)}>
                {Object.entries(ENCODERS).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            {files.length > 0 && (
              <div className="note" data-testid="export-note">
```

with:

```
            </div>
            <div className="row">
              Encoder
              <Select
                value={encoder}
                options={(Object.entries(ENCODERS) as [keyof typeof ENCODERS, string][]).map(([value, name]) => ({ value, label: name }))}
                onChange={setEncoder}
                label="Encoder"
                variant="compact"
                testId="encoder"
              />
            </div>
            {files.length > 0 && (
              <div className="note" data-testid="export-note">
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/Select.tsx apps/desktop/src/renderer/base.css apps/desktop/src/renderer/picker apps/desktop/src/renderer/settings apps/desktop/src/renderer/editor/ExportSheet.tsx
git commit -m "desktop: Cuttle's own select (a list drawn by the page, keys as in a system menu); the picker, the settings and the export sheet use it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The editor: the Auto tab, cuts, crops, and its selects

**Files:**
- Modify: `apps/desktop/src/renderer/icons.tsx`, `apps/desktop/src/renderer/editor/{Inspector.tsx,Timeline.tsx,SourceView.tsx,App.tsx,editor.css}`

- [ ] **Step 1: The icons, the tools and the source view**

In `apps/desktop/src/renderer/icons.tsx`, replace:

```
    <path d="M6.2 5.6 13.5 12M6.2 10.4 13.5 4" />
  </>,
);
export const FitIcon = icon(<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />);
export const FolderIcon = icon(<path d="M2 4.5h4l1.5 1.5H14v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />);
export const TrashIcon = icon(<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9M6.7 7v4.5M9.3 7v4.5" />);
```

with:

```
    <path d="M6.2 5.6 13.5 12M6.2 10.4 13.5 4" />
  </>,
);
/** A crop: two corner brackets crossing. */
export const CropIcon = icon(<path d="M4.5 1.5v10h10M1.5 4.5h10v10" />);
export const FitIcon = icon(<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />);
export const FolderIcon = icon(<path d="M2 4.5h4l1.5 1.5H14v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />);
export const TrashIcon = icon(<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9M6.7 7v4.5M9.3 7v4.5" />);
```

In `apps/desktop/src/renderer/editor/App.tsx`, replace:

```
  UndoIcon,
  WarningIcon,
  ZoomIcon,
} from '../icons';
import { captionCommand, captionPositionsAt, chooseTool, cycleSpeed, freeCaptionPosition, deleteSelection, duplicateSelection, overlayBlocked, reveal, showRawTake, split, type CaptionPosition } from './actions';
import { CommandMenu, closeMenu, openMenu } from './CommandMenu';
```

with:

```
  UndoIcon,
  WarningIcon,
  ZoomIcon,
  CropIcon,
} from '../icons';
import { captionCommand, captionPositionsAt, chooseTool, cycleSpeed, freeCaptionPosition, deleteSelection, duplicateSelection, overlayBlocked, reveal, showRawTake, split, type CaptionPosition } from './actions';
import { CommandMenu, closeMenu, openMenu } from './CommandMenu';
```

In the same file, replace:

```
  { tool: 'zoom', Icon: ZoomIcon, name: 'Zoom', keys: 'Z', hint: 'drag over what the video should show close up' },
  { tool: 'mask', Icon: MaskIcon, name: 'Mask', keys: 'M', hint: 'drag over what the video should hide (a password, an address…)' },
  { tool: 'caption', Icon: TextIcon, name: 'Caption', keys: 'T', hint: 'type a caption on the video at the playhead' },
];

/** The tools, beside the video: they decide what a drag or click on the video does. */
```

with:

```
  { tool: 'zoom', Icon: ZoomIcon, name: 'Zoom', keys: 'Z', hint: 'drag over what the video should show close up' },
  { tool: 'mask', Icon: MaskIcon, name: 'Mask', keys: 'M', hint: 'drag over what the video should hide (a password, an address…)' },
  { tool: 'caption', Icon: TextIcon, name: 'Caption', keys: 'T', hint: 'type a caption on the video at the playhead' },
  { tool: 'crop', Icon: CropIcon, name: 'Crop', keys: 'C', hint: 'drag over the part of the screen the clip shows (tabs, a taskbar left out)' },
];

/** The tools, beside the video: they decide what a drag or click on the video does. */
```

In the same file, replace:

```
        z: () => (event.shiftKey ? store.set({ pxPerSecond: 0 }) : chooseTool('zoom')),
        m: () => chooseTool('mask'),
        t: () => chooseTool('caption'),
        '?': openMenu,
      };
      const action = keys[key];
```

with:

```
        z: () => (event.shiftKey ? store.set({ pxPerSecond: 0 }) : chooseTool('zoom')),
        m: () => chooseTool('mask'),
        t: () => chooseTool('caption'),
        c: () => chooseTool('crop'),
        '?': openMenu,
      };
      const action = keys[key];
```

In the same file, replace:

```

/**
 * A click leaves the keys to the editor: a button pressed with the mouse takes no focus (Space and
 * the arrows go on playing and stepping; a field the person typed in is left, which saves it), and a
 * menu chosen with the mouse lets go of the focus once chosen (its arrows would change it). Keyboard
 * focus (Tab) is kept as it is.
 */
function useMouseFocus(): void {
  useEffect(() => {
    let menuByMouse = false;
    const down = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      menuByMouse = Boolean(target?.closest('select'));
      if (event.button !== 0 || !target?.closest('button')) return;
      event.preventDefault();
      // the caption bar and the menu keep their field's focus
```

with:

```

/**
 * A click leaves the keys to the editor: a button pressed with the mouse takes no focus (Space and
 * the arrows go on playing and stepping; a field the person typed in is left, which saves it). A
 * select (Select.tsx) lets go of the focus itself once chosen with the mouse. Keyboard focus (Tab)
 * is kept as it is.
 */
function useMouseFocus(): void {
  useEffect(() => {
    const down = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      if (event.button !== 0 || !target?.closest('button')) return;
      event.preventDefault();
      // the caption bar and the menu keep their field's focus
```

In the same file, replace:

```
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) active.blur();
    };
    const change = (event: Event) => {
      if (menuByMouse && event.target instanceof HTMLSelectElement) event.target.blur();
      menuByMouse = false;
    };
    const key = () => (menuByMouse = false);
    window.addEventListener('mousedown', down, true);
    window.addEventListener('change', change, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('change', change, true);
      window.removeEventListener('keydown', key, true);
    };
  }, []);
}
```

with:

```
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) active.blur();
    };
    window.addEventListener('mousedown', down, true);
    return () => window.removeEventListener('mousedown', down, true);
  }, []);
}
```

In the same file, replace:

```
  if (cancelGesture()) return;
  const { tool, selection } = store.get();
  closeMenu();
  const inSource = tool === 'zoom' || tool === 'mask' || selection?.kind === 'zoom' || selection?.kind === 'mask';
  if (tool !== 'select') setTool('select');
  if (inSource || tool === 'select') select(undefined);
}
```

with:

```
  if (cancelGesture()) return;
  const { tool, selection } = store.get();
  closeMenu();
  const inSource = tool === 'zoom' || tool === 'mask' || tool === 'crop' || selection?.kind === 'zoom' || selection?.kind === 'mask' || selection?.kind === 'crop';
  if (tool !== 'select') setTool('select');
  if (inSource || tool === 'select') select(undefined);
}
```

In `apps/desktop/src/renderer/editor/SourceView.tsx`, replace:

```
import type { Command } from '../../shared/document';
import { formatSource } from '../../shared/format';
import { adjustRect, drawnRect, fitInside, toSource, toStage, type Fit, type Handle } from '../../shared/edit';
import { addMask, addZoom, overlayBlocked, playheadPlace } from './actions';
import { edit, preview } from './doc';
import { beginGesture, cancelGesture } from './gesture';
import { FrameGrabber } from './frames';
```

with:

```
import type { Command } from '../../shared/document';
import { formatSource } from '../../shared/format';
import { adjustRect, drawnRect, fitInside, toSource, toStage, type Fit, type Handle } from '../../shared/edit';
import { addMask, addZoom, cropClip, overlayBlocked, playheadPlace } from './actions';
import { edit, preview } from './doc';
import { beginGesture, cancelGesture } from './gesture';
import { FrameGrabber } from './frames';
```

In the same file, replace:

```
const MIN_DRAW = 12;

interface Box {
  kind: 'zoom' | 'mask';
  id: string;
  rect: Rect;
  /** It shows at the playhead's source second (others are drawn faint). */
```

with:

```
const MIN_DRAW = 12;

interface Box {
  kind: 'zoom' | 'mask' | 'crop';
  id: string;
  rect: Rect;
  /** It shows at the playhead's source second (others are drawn faint). */
```

In the same file, replace:

```
  }, [active]);

  const project = active ? shownProject() : undefined;
  const source = active ? playheadPlace(t)?.source : undefined;
  const screen = media?.screen.size ?? { width: 1920, height: 1080 };
  const inner = fitInside({ width: Math.max(1, size.width - 2 * MARGIN), height: Math.max(1, size.height - BAND - MARGIN) }, screen);
  const fit: Fit = { x: inner.x + MARGIN, y: inner.y + BAND, scale: inner.scale };
  // A selected zoom or mask the playhead is not on shows on the frame where it starts.
  const item = selection?.kind === 'zoom' ? project?.zooms.find((zoom) => zoom.id === selection.id) : selection?.kind === 'mask' ? project?.masks.find((mask) => mask.id === selection.id) : undefined;
  const range = item && ('at' in item ? [item.at, item.at + item.duration] : [item.from, item.to]);
  const frameAt = range && (source === undefined || source < range[0]! || source >= range[1]!) ? range[0] : source;

  // The screen frame at that source second, decoded on its own (the player's frames are the video's).
```

with:

```
  }, [active]);

  const project = active ? shownProject() : undefined;
  const place = active ? playheadPlace(t) : undefined;
  const source = place?.source;
  const screen = media?.screen.size ?? { width: 1920, height: 1080 };
  const inner = fitInside({ width: Math.max(1, size.width - 2 * MARGIN), height: Math.max(1, size.height - BAND - MARGIN) }, screen);
  const fit: Fit = { x: inner.x + MARGIN, y: inner.y + BAND, scale: inner.scale };
  // A selected zoom or mask the playhead is not on shows on the frame where it starts.
  const item = selection?.kind === 'zoom' ? project?.zooms.find((zoom) => zoom.id === selection.id) : selection?.kind === 'mask' ? project?.masks.find((mask) => mask.id === selection.id) : undefined;
  // The clip the crop is about: a selected crop's, with the Crop tool the selected clip, else the one
  // at the playhead. Its frames show: the playhead's when it is on the clip, else the clip's first.
  const cropSelected = selection?.kind === 'crop' || (tool === 'crop' && selection?.kind === 'scene');
  const cropTarget = cropSelected ? project?.scenes.find((scene) => scene.id === selection!.id) : tool === 'crop' ? place?.clip : undefined;
  const croppedClip = cropTarget?.type === 'clip' ? cropTarget : undefined;
  const cropRange = croppedClip ? [croppedClip.from, croppedClip.to] : undefined;
  const range = item ? ('at' in item ? [item.at, item.at + item.duration] : [item.from, item.to]) : cropRange;
  const frameAt = range && (source === undefined || source < range[0]! || source >= range[1]!) ? range[0] : source;

  // The screen frame at that source second, decoded on its own (the player's frames are the video's).
```

In the same file, replace:

```
    ...project.zooms.map((zoom) => ({ kind: 'zoom' as const, id: zoom.id!, rect: zoom.rect, here: frameAt !== undefined && frameAt >= zoom.at && frameAt < zoom.at + zoom.duration })),
    ...project.masks.map((mask) => ({ kind: 'mask' as const, id: mask.id!, rect: mask.rect, here: frameAt !== undefined && frameAt >= mask.from && frameAt < mask.to })),
  ].filter((box) => box.here || (selection?.kind === box.kind && selection.id === box.id));
  const selected = boxes.find((box) => selection?.kind === box.kind && selection.id === box.id);
  const aspect = screen.width / screen.height;
  /**
```

with:

```
    ...project.zooms.map((zoom) => ({ kind: 'zoom' as const, id: zoom.id!, rect: zoom.rect, here: frameAt !== undefined && frameAt >= zoom.at && frameAt < zoom.at + zoom.duration })),
    ...project.masks.map((mask) => ({ kind: 'mask' as const, id: mask.id!, rect: mask.rect, here: frameAt !== undefined && frameAt >= mask.from && frameAt < mask.to })),
  ].filter((box) => box.here || (selection?.kind === box.kind && selection.id === box.id));
  // that clip's crop, while cropping or selected
  if (croppedClip?.crop && croppedClip.id) boxes.push({ kind: 'crop', id: croppedClip.id, rect: croppedClip.crop.rect, here: true });
  const selected = boxes.find((box) => selection?.kind === box.kind && selection.id === box.id);
  const aspect = screen.width / screen.height;
  /**
```

In the same file, replace:

```
    if (event.button !== 0) return;
    const handle = ((event.target as HTMLElement).dataset.handle as Handle | undefined) ?? 'move';
    select({ kind: box.kind, id: box.id });
    const list = box.kind === 'zoom' ? 'zooms' : 'masks';
    let commands: Command[] | undefined;
    follow(
      event,
      (dx, dy) => {
        const rect = adjustRect(box.rect, handle, dx, dy, screen, box.kind === 'zoom' ? aspect : undefined);
        commands = [{ type: 'set', list, id: box.id, fields: { rect: rect.map((value) => Math.round(value)) } }];
        preview(commands);
      },
      (moved) => {
```

with:

```
    if (event.button !== 0) return;
    const handle = ((event.target as HTMLElement).dataset.handle as Handle | undefined) ?? 'move';
    select({ kind: box.kind, id: box.id });
    const list = box.kind === 'zoom' ? 'zooms' : box.kind === 'mask' ? 'masks' : 'scenes';
    const clip = box.kind === 'crop' ? project.scenes.find((scene) => scene.id === box.id) : undefined;
    let commands: Command[] | undefined;
    follow(
      event,
      (dx, dy) => {
        const rect = adjustRect(box.rect, handle, dx, dy, screen, box.kind === 'zoom' ? aspect : undefined).map((value) => Math.round(value));
        // a crop moved by hand is the person's: a new crop object, without the automatic tag
        const fields = box.kind === 'crop' && clip?.type === 'clip' ? { crop: { rect, ...(clip.crop?.enabled === false && { enabled: false }) } } : { rect };
        commands = [{ type: 'set', list, id: box.id, fields }];
        preview(commands);
      },
      (moved) => {
```

In the same file, replace:

```
    );
  };

  /** A press on the frame: with the Zoom or Mask tool, draw a new one there. */
  const pressFrame = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const kind = tool === 'zoom' || tool === 'mask' ? tool : undefined;
    if (!kind) {
      select(undefined);
      return;
```

with:

```
    );
  };

  /** A press on the frame: with the Zoom, Mask or Crop tool, draw a new one there. */
  const pressFrame = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const kind = tool === 'zoom' || tool === 'mask' || tool === 'crop' ? tool : undefined;
    if (!kind) {
      select(undefined);
      return;
```

In the same file, replace:

```
        if (!moved || !rect || rect[2] * fit.scale < MIN_DRAW || rect[3] * fit.scale < MIN_DRAW) return;
        const whole = rect.map((value) => Math.round(value));
        if (kind === 'zoom') addZoom(whole);
        else addMask(whole);
      },
    );
```

with:

```
        if (!moved || !rect || rect[2] * fit.scale < MIN_DRAW || rect[3] * fit.scale < MIN_DRAW) return;
        const whole = rect.map((value) => Math.round(value));
        if (kind === 'zoom') addZoom(whole);
        else if (kind === 'crop') cropClip(whole, croppedClip?.id);
        else addMask(whole);
      },
    );
```

In the same file, replace:

```
  return (
    <div className="source-view" ref={area} onPointerDown={pressFrame} data-testid="source-view">
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      {selected?.kind === 'zoom' && <ZoomDim fit={fit} rect={selected.rect} size={size} />}
      {boxes.map((box) => {
        const at = toStage(box.rect, fit);
        const isSelected = box === selected;
```

with:

```
  return (
    <div className="source-view" ref={area} onPointerDown={pressFrame} data-testid="source-view">
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      {(selected?.kind === 'zoom' || selected?.kind === 'crop') && <ZoomDim fit={fit} rect={selected.rect} size={size} />}
      {!selected && tool === 'crop' && boxes.some((box) => box.kind === 'crop') && <ZoomDim fit={fit} rect={boxes.find((box) => box.kind === 'crop')!.rect} size={size} />}
      {boxes.map((box) => {
        const at = toStage(box.rect, fit);
        const isSelected = box === selected;
```

In the same file, replace:

```
            style={{ left: at.x, top: at.y, width: at.width, height: at.height }}
            onPointerDown={(event) => pressBox(event, box)}
            data-id={box.id}
            title={box.here ? `${box.kind === 'zoom' ? 'Zoom' : 'Mask'}: drag to move, handles to resize` : `This ${box.kind} is not shown at the playhead`}
          >
            {isSelected && HANDLES.map((handle) => <i key={handle} className={`box-handle ${handle}`} data-handle={handle} />)}
          </div>
        );
      })}
      {drawing && tool === 'zoom' && <ZoomDim fit={fit} rect={drawing} size={size} />}
      {drawing && (
        <div
          className={`source-box ${tool} drawing`}
```

with:

```
            style={{ left: at.x, top: at.y, width: at.width, height: at.height }}
            onPointerDown={(event) => pressBox(event, box)}
            data-id={box.id}
            title={box.here ? `${box.kind === 'zoom' ? 'Zoom' : box.kind === 'mask' ? 'Mask' : 'Crop: what the clip shows'}: drag to move, handles to resize` : `This ${box.kind} is not shown at the playhead`}
          >
            {isSelected && HANDLES.map((handle) => <i key={handle} className={`box-handle ${handle}`} data-handle={handle} />)}
          </div>
        );
      })}
      {drawing && (tool === 'zoom' || tool === 'crop') && <ZoomDim fit={fit} rect={drawing} size={size} />}
      {drawing && (
        <div
          className={`source-box ${tool} drawing`}
```

In the same file, replace:

```
          ? ' · move the playhead onto a clip to see the screen'
          : frameAt !== source
            ? ` · the frame at ${formatSource(frameAt)}, where this ${selection?.kind} starts`
            : tool === 'zoom' || tool === 'mask'
              ? blocked
                ? ` · ${blocked}`
                : selected
                  ? ` · drag the box to place it, elsewhere for a new ${tool}`
                  : ` · drag to draw a ${tool}`
              : ' · drag the box to move it, its handles to resize it'}
        <span className="sep" />
        <kbd>Esc</kbd> for the video
      </div>
```

with:

```
          ? ' · move the playhead onto a clip to see the screen'
          : frameAt !== source
            ? ` · the frame at ${formatSource(frameAt)}, where this ${selection?.kind} starts`
            : tool === 'crop'
              ? !croppedClip
                ? ' · select a clip, or move the playhead onto one, to crop it'
                : boxes.some((box) => box.kind === 'crop')
                  ? ' · drag the crop to move it, its handles to resize it, elsewhere for a new one'
                  : ' · drag over the part of the screen this clip shows'
              : tool === 'zoom' || tool === 'mask'
                ? blocked
                  ? ` · ${blocked}`
                  : selected
                    ? ` · drag the box to place it, elsewhere for a new ${tool}`
                    : ` · drag to draw a ${tool}`
                : ' · drag the box to move it, its handles to resize it'}
        <span className="sep" />
        <kbd>Esc</kbd> for the video
      </div>
```

In the same file, replace:

```
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          setTool('select');
          if (selection?.kind === 'zoom' || selection?.kind === 'mask') select(undefined);
        }}
      >
        Back to the video
```

with:

```
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          setTool('select');
          if (selection?.kind === 'zoom' || selection?.kind === 'mask' || selection?.kind === 'crop') select(undefined);
        }}
      >
        Back to the video
```

- [ ] **Step 2: The timeline: cut notches, pieces, the speed select**

In `apps/desktop/src/renderer/editor/Timeline.tsx`, replace:

```
import { formatTime } from '../../shared/format';
import {
  activityColumns,
  groupPins,
  pinGroupDetail,
  pinGroupName,
```

with:

```
import { formatTime } from '../../shared/format';
import {
  activityColumns,
  blockSourceAt,
  groupPins,
  pinGroupDetail,
  pinGroupName,
```

In the same file, replace:

```
  type TimelineModel,
} from '../../shared/timeline-model';
import { FitIcon } from '../icons';
import { addCard, addMask, addPage, addZoom, overlayBlocked, selectedOrCurrentClip, setSpeed, split, SPEEDS } from './actions';
import { audible } from './audio';
import { edit, preview } from './doc';
```

with:

```
  type TimelineModel,
} from '../../shared/timeline-model';
import { FitIcon } from '../icons';
import { Select } from '../Select';
import { addCard, addMask, addPage, addZoom, overlayBlocked, selectedOrCurrentClip, setSpeed, split, SPEEDS } from './actions';
import { audible } from './audio';
import { edit, preview } from './doc';
```

In the same file, replace:

```
  const [cutOutList, setCutOutList] = useState<{ kind: OverlayKind; left: number; top: number }>();

  const project = shownProject();
  const spans = useMemo(() => (project ? sceneSpans(project.scenes) : []), [project]);
  const duration = spans.at(-1)?.end ?? 0;
  const model = useMemo(() => (project ? timelineModel(project, spans, media?.markers) : undefined), [project, spans, media]);
  const layout = useMemo(() => layoutOf(model), [model]);
```

with:

```
  const [cutOutList, setCutOutList] = useState<{ kind: OverlayKind; left: number; top: number }>();

  const project = shownProject();
  const spans = useMemo(() => (project ? sceneSpans(project.scenes, project.cuts) : []), [project]);
  const duration = spans.at(-1)?.end ?? 0;
  const model = useMemo(() => (project ? timelineModel(project, spans, media?.markers) : undefined), [project, spans, media]);
  const layout = useMemo(() => layoutOf(model), [model]);
```

In the same file, replace:

```
      if (event.ctrlKey || event.altKey) {
        event.preventDefault();
        const project = shownProject();
        const length = project ? (sceneSpans(project.scenes).at(-1)?.end ?? 0) : 0;
        const fitPps = length > 0 ? (element.clientWidth - END_SPACE - 8) / length : current;
        const box = element.getBoundingClientRect();
        const anchorX = event.clientX - box.left;
```

with:

```
      if (event.ctrlKey || event.altKey) {
        event.preventDefault();
        const project = shownProject();
        const length = project ? (sceneSpans(project.scenes, project.cuts).at(-1)?.end ?? 0) : 0;
        const fitPps = length > 0 ? (element.clientWidth - END_SPACE - 8) / length : current;
        const box = element.getBoundingClientRect();
        const anchorX = event.clientX - box.left;
```

In the same file, replace:

```
            if (edge === 'end') {
              const end = snapped(block.end + deltaOut, others, moved);
              setDrag({ guide: end.target });
              commands = [{ type: 'trim', id: block.id, to: scene.from + (end.t - block.start) * scene.speed }];
            } else commands = [{ type: 'trim', id: block.id, from: scene.from + deltaOut * scene.speed }];
          } else {
            const end = edge === 'end' ? snapped(block.end + deltaOut, others, moved) : { t: block.end - deltaOut, target: undefined };
```

with:

```
            if (edge === 'end') {
              const end = snapped(block.end + deltaOut, others, moved);
              setDrag({ guide: end.target });
              // through the clip's pieces: cuts inside it take no output time
              commands = [{ type: 'trim', id: block.id, to: blockSourceAt(block, end.t) }];
            } else commands = [{ type: 'trim', id: block.id, from: scene.from + deltaOut * scene.speed }];
          } else {
            const end = edge === 'end' ? snapped(block.end + deltaOut, others, moved) : { t: block.end - deltaOut, target: undefined };
```

In the same file, replace:

```
                  {model.scenes.map((scene) => (
                    <Scene key={scene.id} scene={scene} project={project} pps={pps} view={view} selected={isSelected(selection, 'scene', scene.id)} moving={drag.ghost?.id === scene.id} onPointerDown={(event) => pressScene(event, scene)} />
                  ))}
                </div>
                {!project.sources.mic && (
                  <span className="lane-hint" style={{ top: tops.mic + heights.mic / 2, left: view.left + 10 }}>
```

with:

```
                  {model.scenes.map((scene) => (
                    <Scene key={scene.id} scene={scene} project={project} pps={pps} view={view} selected={isSelected(selection, 'scene', scene.id)} moving={drag.ghost?.id === scene.id} onPointerDown={(event) => pressScene(event, scene)} />
                  ))}
                  {/* where cuts take a stretch out: a notch; an off cut, faint, where it would cut */}
                  {model.cuts.map((notch) => (
                    <button
                      key={`${notch.ids.join('+')}@${notch.t}`}
                      type="button"
                      className={`cut-notch${notch.enabled ? '' : ' off'}${notch.ids.some((id) => isSelected(selection, 'cut', id)) ? ' selected' : ''}`}
                      style={{ left: notch.t * pps }}
                      title={`${notch.title}${notch.ids.length > 1 ? ` and ${notch.ids.length - 1} more` : ''}${notch.enabled ? '' : ' (off: the video plays it)'} · click to select`}
                      aria-label={`${notch.enabled ? 'Cut' : 'Cut, off'}: ${notch.title}`}
                      data-testid="cut-notch"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        select({ kind: 'cut', id: notch.ids[0]! });
                      }}
                      // Enter or Space when it has the keyboard's focus
                      onClick={() => select({ kind: 'cut', id: notch.ids[0]! })}
                    />
                  ))}
                </div>
                {!project.sources.mic && (
                  <span className="lane-hint" style={{ top: tops.mic + heights.mic / 2, left: view.left + 10 }}>
```

In the same file, replace:

```
      </button>
      <label className="act speed" title="The clip's speed (R faster, Shift+R slower)">
        <span>Speed</span>
        <select
          value={clip ? String(clip.speed) : ''}
          disabled={!clip || broken}
          onChange={(event) => setSpeed(Number(event.target.value), clip?.id)}
          aria-label="Speed"
          data-testid="speed"
          id="speed-select"
        >
          {!clip && <option value="">–</option>}
          {clip && !SPEEDS.includes(clip.speed as (typeof SPEEDS)[number]) && <option value={String(clip.speed)}>{clip.speed}×</option>}
          {SPEEDS.map((speed) => (
            <option key={speed} value={String(speed)}>
              {speed}×
            </option>
          ))}
        </select>
      </label>
      <span className="tl-sep" />
      <button className="act" onClick={() => addZoom()} disabled={!!blocked} title={blocked ?? 'A zoom at the playhead (Z draws one)'}>
```

with:

```
      </button>
      <label className="act speed" title="The clip's speed (R faster, Shift+R slower)">
        <span>Speed</span>
        <Select
          value={clip ? String(clip.speed) : undefined}
          options={[
            ...(clip && !SPEEDS.includes(clip.speed as (typeof SPEEDS)[number]) ? [{ value: String(clip.speed), label: `${clip.speed}×` }] : []),
            ...SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}×` })),
          ]}
          disabled={!clip || broken}
          onChange={(speed) => setSpeed(Number(speed), clip?.id)}
          label="Speed"
          variant="compact"
          testId="speed"
        />
      </label>
      <span className="tl-sep" />
      <button className="act" onClick={() => addZoom()} disabled={!!blocked} title={blocked ?? 'A zoom at the playhead (Z draws one)'}>
```

In the same file, replace:

```
    for (let i = from; i < to; i++) {
      const outT = scene.start + ((i + 0.5) * tileWidth) / pps;
      // The thumbnails count from the take's first frame.
      const source = clip.from + (outT - scene.start) * clip.speed - screenStart;
      tiles.push({ x: i * tileWidth, index: Math.min(count - 1, Math.max(0, Math.floor(source / interval!))) });
    }
  }
```

with:

```
    for (let i = from; i < to; i++) {
      const outT = scene.start + ((i + 0.5) * tileWidth) / pps;
      // The thumbnails count from the take's first frame.
      // the source second shown there, through the clip's pieces (cuts take no output time)
      const source = blockSourceAt(scene, outT) - screenStart;
      tiles.push({ x: i * tileWidth, index: Math.min(count - 1, Math.max(0, Math.floor(source / interval!))) });
    }
  }
```

- [ ] **Step 3: The inspector: the Auto tab, the cut and crop panels, its selects**

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```
// does not parse, every field is off (editing waits).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import { BACKGROUND_PRESETS, CLICK_EFFECTS, CURSOR_STYLES, EASES, FRAME_STYLES, MASK_STYLES, STILL_MOTIONS, TEXT_POSITIONS, TEXT_STYLES, WEBCAM_CORNERS, WEBCAM_SHAPES, type CuttleProject, type Rect } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import { formatDuration, formatSource, formatSpeed, formatTime } from '../../shared/format';
import {
```

with:

```
// does not parse, every field is off (editing waits).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import {
  BACKGROUND_PRESETS,
  CLICK_EFFECTS,
  CURSOR_STYLES,
  EASES,
  FRAME_STYLES,
  MASK_STYLES,
  STILL_MOTIONS,
  TEXT_POSITIONS,
  TEXT_STYLES,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
  type AutoEdits,
  type AutoKind,
  type CuttleProject,
  type Rect,
} from '@cuttle/project';
import { sceneSpans, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import { formatDuration, formatSource, formatSpeed, formatTime } from '../../shared/format';
import {
```

In the same file, replace:

```
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { outputTimesOf } from '../../shared/timeline-model';
import { CardIcon, CopyIcon, FilmIcon, MaskIcon, PageIcon, TextIcon, TrashIcon, ZoomIcon } from '../icons';
import { chooseImage, deleteSelection, duplicateSelection, LIST_OF, SPEEDS } from './actions';
import { edit, preview } from './doc';
import { engineAssets, setTool, store, type Selection, type Tool } from './session';
import { isColoured, swatch, type SwatchKey } from './swatches';
import { useStore } from './store';

const TABS = [
  { id: 'selection', name: 'Selection' },
  { id: 'look', name: 'Look' },
] as const;
```

with:

```
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { outputTimesOf } from '../../shared/timeline-model';
import { CardIcon, ChevronIcon, CopyIcon, CropIcon, FilmIcon, MaskIcon, PageIcon, SplitIcon, TextIcon, TrashIcon, ZoomIcon } from '../icons';
import { Select as StyledSelect } from '../Select';
import { chooseImage, cutShownAt, deleteSelection, duplicateSelection, LIST_OF, playheadPlace, reveal, SPEEDS } from './actions';
import { edit, preview } from './doc';
import { currentPlayer, engineAssets, select, setTool, store, type Selection, type Tool } from './session';
import { isColoured, swatch, type SwatchKey } from './swatches';
import { useStore } from './store';

const TABS = [
  { id: 'selection', name: 'Selection' },
  { id: 'auto', name: 'Auto' },
  { id: 'look', name: 'Look' },
] as const;
```

In the same file, replace:

```
      </div>
      <div className="panel-body" id="inspector-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <fieldset className="panel-fields" disabled={broken}>
          {tab === 'selection' ? <SelectionPanel /> : <LookPanel />}
        </fieldset>
      </div>
    </aside>
```

with:

```
      </div>
      <div className="panel-body" id="inspector-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <fieldset className="panel-fields" disabled={broken}>
          {tab === 'selection' ? <SelectionPanel /> : tab === 'auto' ? <AutoPanel /> : <LookPanel />}
        </fieldset>
      </div>
    </aside>
```

In the same file, replace:

```

function Select<T extends string>({ value, options, names, onChange, testId }: { value: T; options: readonly T[]; names: Record<T, string>; onChange: (value: T) => void; testId?: string }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as T)} data-testid={testId} onKeyDown={(event) => event.stopPropagation()}>
      {options.map((option) => (
        <option key={option} value={option}>
          {names[option]}
        </option>
      ))}
    </select>
  );
}
```

with:

```

function Select<T extends string>({ value, options, names, onChange, testId }: { value: T; options: readonly T[]; names: Record<T, string>; onChange: (value: T) => void; testId?: string }) {
  return (
    <StyledSelect value={value} options={options.map((option) => ({ value: option, label: names[option] }))} onChange={onChange} label={names[value] ?? value} testId={testId} />
  );
}
```

In the same file, replace:

```
function SmoothingSelect({ value }: { value: number }) {
  const known = SMOOTHING.some((step) => step.value === value);
  return (
    <select
      value={String(value)}
      onChange={(event) => look(['cursor', 'smoothing'], Number(event.target.value), 'Cursor movement')}
      onKeyDown={(event) => event.stopPropagation()}
      data-testid="cursor-smoothing"
    >
      {!known && <option value={String(value)}>{value} (from cuttle.json)</option>}
      {SMOOTHING.map((step) => (
        <option key={step.value} value={String(step.value)}>
          {step.name}
        </option>
      ))}
    </select>
  );
}
```

with:

```
function SmoothingSelect({ value }: { value: number }) {
  const known = SMOOTHING.some((step) => step.value === value);
  return (
    <StyledSelect
      value={String(value)}
      options={[...(known ? [] : [{ value: String(value), label: `${value} (from cuttle.json)` }]), ...SMOOTHING.map((step) => ({ value: String(step.value), label: step.name }))]}
      onChange={(chosen) => look(['cursor', 'smoothing'], Number(chosen), 'Cursor movement')}
      label="Cursor movement"
      testId="cursor-smoothing"
    />
  );
}
```

In the same file, replace:

```
  spotlight: 'Spotlight: a light around the pointer, the rest of the screen dimmed',
};

function Toggle({ checked, onChange, label, testId, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)} aria-label={label} data-testid={testId} disabled={disabled}>
```

with:

```
  spotlight: 'Spotlight: a light around the pointer, the rest of the screen dimmed',
};

/** A cut: a stretch of the take the video jumps over, its place, its range, on or off. */
function CutDetails({ project, id }: { project: CuttleProject; id: string }) {
  const cut = project.cuts.find((item) => item.id === id)!;
  const at = cutShownAt(sceneSpans(project.scenes, project.cuts), cut);
  return (
    <>
      <Head icon={<SplitIcon />} color="var(--text)" name={cut.label ?? 'Cut'} copies={false} />
      <AutoNote kind={cut.auto} />
      <Row label="Label">
        <TextInput value={cut.label ?? ''} placeholder="Cut" onCommit={(value) => set('cuts', id, { label: value.trim() || undefined }, 'Rename cut')} />
      </Row>
      <Row label="In the video">{at === undefined ? 'Nowhere: no clip plays this stretch' : `${cut.enabled ? 'jumps at' : 'would jump at'} ${formatTime(at)}`}</Row>
      <div className="grid2">
        <Row label="From (take s)">
          <NumberInput value={cut.from} min={0} onCommit={(from) => set('cuts', id, { from, to: Math.max(cut.to, from + 0.05) }, 'Change cut')} testId="cut-from" />
        </Row>
        <Row label="To (take s)">
          <NumberInput value={cut.to} min={0} onCommit={(to) => set('cuts', id, { to }, 'Change cut')} testId="cut-to" />
        </Row>
      </div>
      <Row label="Takes out">{formatDuration(cut.to - cut.from)} of the take</Row>
      <Row label="Cut" inline>
        <em>{cut.enabled ? 'On: the video jumps over it' : 'Off: the video plays it'}</em>
        <Toggle checked={cut.enabled} label="Cut this stretch" onChange={(on) => set('cuts', id, { enabled: on ? undefined : false }, on ? 'Cut on' : 'Cut off')} testId="cut-enabled" />
      </Row>
    </>
  );
}

/** A clip's crop: the part of the screen it shows, in source pixels, on or off. */
function CropDetails({ project, id }: { project: CuttleProject; id: string }) {
  const clip = project.scenes.find((scene) => scene.id === id);
  if (clip?.type !== 'clip' || !clip.crop) return <p className="hint">This clip has no crop any more.</p>;
  const crop = clip.crop;
  const setCrop = (fields: { rect?: Rect; enabled?: boolean }, label: string) => {
    const rect = fields.rect ?? crop.rect;
    const enabled = fields.enabled ?? crop.enabled;
    // switching keeps it Cuttle's; a new area makes it the person's
    const auto = fields.rect === undefined ? crop.auto : undefined;
    set('scenes', id, { crop: { rect, ...(!enabled && { enabled: false }), ...(auto && { auto }) } }, label);
  };
  return (
    <>
      <Head icon={<CropIcon />} color="var(--text)" name={`Crop of ${clip.label ?? 'the clip'}`} copies={false} />
      <AutoNote kind={crop.auto} />
      <div className="field">
        <span className="field-label">
          Area, in source pixels
          <button type="button" className="link" onClick={() => setTool('crop')}>
            Draw on the video
          </button>
        </span>
        <div className="grid4">
          {(['x', 'y', 'w', 'h'] as const).map((name, i) => (
            <label key={name} className="field-input">
              <em>{name}</em>
              <NumberInput value={crop.rect[i]!} digits={0} step={1} min={i < 2 ? 0 : 8} onCommit={(value) => setCrop({ rect: crop.rect.map((old, j) => (j === i ? value : old)) as Rect }, 'Change the crop')} />
            </label>
          ))}
        </div>
      </div>
      <Row label="Crop" inline>
        <em>{crop.enabled ? 'On: the clip shows this part' : 'Off: the whole screen shows'}</em>
        <Toggle checked={crop.enabled} label="Crop the clip" onChange={(on) => setCrop({ enabled: on }, on ? 'Crop on' : 'Crop off')} testId="crop-enabled" />
      </Row>
    </>
  );
}

// ---- what Cuttle did on its own ------------------------------------------------------------------

interface AutoItem {
  kind: Selection['kind'];
  id: string;
  label: string;
  enabled: boolean;
  /** Output seconds where the video shows it. */
  at?: number;
}

interface AutoGroup {
  id: string;
  title: string;
  icon: ReactNode;
  kinds: AutoKind[];
  /** The switch in `autoEdits`; none for one-off edits (the length fit). */
  key?: keyof AutoEdits;
}

const AUTO_GROUPS: AutoGroup[] = [
  { id: 'crop', title: 'Cropped to the content', icon: <CropIcon />, kinds: ['crop'], key: 'crop' },
  { id: 'privacy', title: 'Private things masked', icon: <MaskIcon />, kinds: ['privacy', 'notification'], key: 'privacy' },
  { id: 'retakes', title: 'Retakes cut', icon: <SplitIcon />, kinds: ['retake'], key: 'retakes' },
  { id: 'fillers', title: 'Filler words cut', icon: <SplitIcon />, kinds: ['filler'], key: 'fillers' },
  { id: 'pauses', title: 'Pauses shortened', icon: <SplitIcon />, kinds: ['pause'], key: 'pauses' },
  { id: 'length', title: 'Cut to fit the length', icon: <SplitIcon />, kinds: ['length'] },
  { id: 'typing', title: 'Zooms while typing', icon: <ZoomIcon />, kinds: ['typing'], key: 'typingZooms' },
  { id: 'dialog', title: 'Zooms on dialogs', icon: <ZoomIcon />, kinds: ['dialog'], key: 'dialogZooms' },
  { id: 'click', title: 'Zooms on clicks', icon: <ZoomIcon />, kinds: ['click'], key: 'clickZooms' },
  { id: 'answer', title: 'Zoom on Claude’s answer', icon: <ZoomIcon />, kinds: ['answer'], key: 'answerZoom' },
];

/** The automatic items of a group, in the order the video shows them. */
function autoItems(project: CuttleProject, spans: readonly SceneSpan[], group: AutoGroup): AutoItem[] {
  const items: AutoItem[] = [];
  const of = (kind?: AutoKind) => kind !== undefined && group.kinds.includes(kind);
  for (const zoom of project.zooms) if (of(zoom.auto) && zoom.id) items.push({ kind: 'zoom', id: zoom.id, label: zoom.label ?? 'Zoom', enabled: zoom.enabled, at: outputTimesOf(spans, zoom.at)[0] });
  for (const mask of project.masks) if (of(mask.auto) && mask.id) items.push({ kind: 'mask', id: mask.id, label: mask.label ?? 'Mask', enabled: mask.enabled, at: outputTimesOf(spans, mask.from)[0] });
  for (const cut of project.cuts) if (of(cut.auto) && cut.id) items.push({ kind: 'cut', id: cut.id, label: cut.label ?? 'Cut', enabled: cut.enabled, at: cutShownAt(spans, cut) });
  project.scenes.forEach((scene, index) => {
    if (scene.type === 'clip' && scene.id && of(scene.crop?.auto)) {
      items.push({ kind: 'crop', id: scene.id, label: `${scene.label ?? 'Clip'}: ${Math.round(scene.crop!.rect[2])} × ${Math.round(scene.crop!.rect[3])}`, enabled: scene.crop!.enabled, at: sceneStretch(spans, index)?.start });
    }
  });
  return items.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
}

/** The command that switches an automatic item on or off. */
function switchItem(project: CuttleProject, item: AutoItem, on: boolean): Command {
  if (item.kind === 'crop') {
    const clip = project.scenes.find((scene) => scene.id === item.id);
    const crop = clip?.type === 'clip' ? clip.crop! : { rect: [0, 0, 8, 8] as Rect, enabled: true };
    return { type: 'set', list: 'scenes', id: item.id, fields: { crop: { rect: crop.rect, ...(!on && { enabled: false }), auto: 'crop' } } };
  }
  return { type: 'set', list: LIST_OF[item.kind], id: item.id, fields: { enabled: on ? undefined : false } };
}

/** What Cuttle did on its own, kind by kind: a switch per kind and per item, and where each shows. */
function AutoPanel() {
  const project = useStore(store, (state) => state.doc?.project);
  const [open, setOpen] = useState<string>();
  if (!project) return null;
  const spans = sceneSpans(project.scenes, project.cuts);
  const groups = AUTO_GROUPS.map((group) => ({ group, items: autoItems(project, spans, group) })).filter(
    ({ group, items }) => items.length > 0 || (group.key !== undefined && !project.autoEdits[group.key]),
  );
  if (groups.length === 0) {
    return (
      <div className="auto-empty" data-testid="auto-empty">
        <p>
          <b>Nothing automatic yet.</b>
        </p>
        <p className="hint">Cuttle’s cut of a take adds its zooms here. Each automatic edit shows here with its reason: switch any off, or a whole kind.</p>
      </div>
    );
  }
  const switchKind = (group: AutoGroup, items: AutoItem[], on: boolean) => {
    const commands: Command[] = [
      ...(group.key ? [{ type: 'auto-edits', kind: group.key, value: on } as Command] : []),
      ...items.filter((item) => item.enabled !== on).map((item) => switchItem(project, item, on)),
    ];
    edit(commands, `${group.title}: ${on ? 'on' : 'off'}`);
  };
  return (
    <div className="auto-panel" data-testid="auto-panel">
      <p className="hint auto-intro">What Cuttle did on its own. Switch a kind off and it leaves the video and is not made again; change an item and it is yours.</p>
      {groups.map(({ group, items }) => {
        const on = items.filter((item) => item.enabled).length;
        const kindOn = group.key ? project.autoEdits[group.key] : on > 0;
        const expanded = open === group.id;
        return (
          <section key={group.id} className={`auto-group${kindOn ? '' : ' off'}`} data-testid={`auto-group-${group.id}`}>
            <div className="auto-head">
              <button type="button" className="auto-toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? undefined : group.id)}>
                <span className="kind-icon">{group.icon}</span>
                <span className="auto-text">
                  <span className="auto-title">{group.title}</span>
                  <span className="auto-count">{items.length === 0 ? 'Off: not made again' : on === items.length ? `${on} on` : on === 0 ? `${items.length} off` : `${on} of ${items.length} on`}</span>
                </span>
                <ChevronIcon className="auto-chevron" />
              </button>
              <Toggle checked={kindOn} label={`${group.title}: ${kindOn ? 'on' : 'off'}`} onChange={(value) => switchKind(group, items, value)} testId={`auto-switch-${group.id}`} />
            </div>
            {expanded && (
              <ul className="auto-items">
                {items.length === 0 && <li className="hint">Off: Cuttle does not make these when it edits again.</li>}
                {items.map((item) => (
                  <li key={`${item.kind}-${item.id}`} className={item.enabled ? '' : 'off'}>
                    <button
                      type="button"
                      className="auto-item"
                      onClick={() => {
                        if (item.kind === 'crop') {
                          select({ kind: 'crop', id: item.id });
                          if (item.at !== undefined) void currentPlayer()?.seek(item.at);
                        } else reveal(LIST_OF[item.kind], item.id);
                      }}
                      title="Show it in the video and select it"
                    >
                      <span className="auto-time">{item.at === undefined ? '–' : formatTime(item.at)}</span>
                      <span className="auto-label">{item.label}</span>
                    </button>
                    <Toggle checked={item.enabled} label={`${item.label}: ${item.enabled ? 'on' : 'off'}`} onChange={(value) => edit([switchItem(project, item, value)], `${item.label}: ${value ? 'on' : 'off'}`)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange, label, testId, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)} aria-label={label} data-testid={testId} disabled={disabled}>
```

In the same file, replace:

```
  );
}

function Head({ icon, color, name }: { icon: ReactNode; color: string; name: string }) {
  return (
    <div className="kind-head">
      <span className="kind-icon" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
```

with:

```
  );
}

/** The selection's kind, name, and its Duplicate (unless it cannot be copied) and Delete. */
function Head({ icon, color, name, copies = true }: { icon: ReactNode; color: string; name: string; copies?: boolean }) {
  return (
    <div className="kind-head">
      <span className="kind-icon" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
```

In the same file, replace:

```
      <span className="name" title={name}>
        {name}
      </span>
      <button type="button" className="head-action" onClick={duplicateSelection} title="Duplicate (Ctrl+D)" aria-label="Duplicate" data-testid="duplicate">
        <CopyIcon size={15} />
      </button>
      <button type="button" className="head-action" onClick={deleteSelection} title="Delete (Del)" aria-label="Delete" data-testid="delete">
        <TrashIcon size={15} />
      </button>
```

with:

```
      <span className="name" title={name}>
        {name}
      </span>
      {copies && (
        <button type="button" className="head-action" onClick={duplicateSelection} title="Duplicate (Ctrl+D)" aria-label="Duplicate" data-testid="duplicate">
          <CopyIcon size={15} />
        </button>
      )}
      <button type="button" className="head-action" onClick={deleteSelection} title="Delete (Del)" aria-label="Delete" data-testid="delete">
        <TrashIcon size={15} />
      </button>
```

In the same file, replace:

```

/** Where an overlay shows in the video (the clicked stretch, else its first) and the speed there. */
function stretchOf(project: CuttleProject, selection: Selection, from: number, to: number): { start: number; end: number; speed: number } | undefined {
  const spans = sceneSpans(project.scenes);
  const speedAt = (t: number) => {
    const scene = spans.find((item) => t >= item.start - 1e-9 && t < item.end)?.scene;
    return scene?.type === 'clip' ? scene.speed : 1;
```

with:

```

/** Where an overlay shows in the video (the clicked stretch, else its first) and the speed there. */
function stretchOf(project: CuttleProject, selection: Selection, from: number, to: number): { start: number; end: number; speed: number } | undefined {
  const spans = sceneSpans(project.scenes, project.cuts);
  const speedAt = (t: number) => {
    const scene = spans.find((item) => t >= item.start - 1e-9 && t < item.end)?.scene;
    return scene?.type === 'clip' ? scene.speed : 1;
```

In the same file, replace:

```
  zoom: <p className="hint">Zoom tool: drag on the screen over what the video should show close up. It starts at the playhead and lasts 3 s. Esc goes back.</p>,
  mask: <p className="hint">Mask tool: drag on the screen over what the video must not show (a password, an address). It lasts from the playhead to the end of the clip. Esc goes back.</p>,
  caption: <p className="hint">Caption tool: type the caption in the bar and press Enter; it shows at the playhead for 3 s. Esc goes back.</p>,
};

function SelectionPanel() {
  const selection = useStore(store, (state) => state.selection);
  const tool = useStore(store, (state) => state.tool);
```

with:

```
  zoom: <p className="hint">Zoom tool: drag on the screen over what the video should show close up. It starts at the playhead and lasts 3 s. Esc goes back.</p>,
  mask: <p className="hint">Mask tool: drag on the screen over what the video must not show (a password, an address). It lasts from the playhead to the end of the clip. Esc goes back.</p>,
  caption: <p className="hint">Caption tool: type the caption in the bar and press Enter; it shows at the playhead for 3 s. Esc goes back.</p>,
  crop: <p className="hint">Crop tool: drag on the screen over the part the clip should show, leaving out tabs, bars or a taskbar. The window takes its shape. Esc goes back.</p>,
};

/** Why Cuttle made an automatic item, in a few words. */
const AUTO_REASONS: Record<AutoKind, string> = {
  crop: 'the content of the window',
  privacy: 'private text on screen',
  notification: 'a notification over the take',
  retake: 'a retake',
  filler: 'a filler word',
  pause: 'a pause',
  length: 'the length the video should have',
  typing: 'typing',
  dialog: 'a dialog',
  click: 'clicks',
  answer: "Claude's answer",
};

/** Says that Cuttle made the item, for what, and that a change makes it the person's. */
function AutoNote({ kind }: { kind?: AutoKind }) {
  if (!kind) return null;
  return (
    <p className="auto-note" data-testid="auto-note">
      <b>Made by Cuttle</b> for {AUTO_REASONS[kind]}. Change it and it is yours: Cuttle leaves it alone when it edits again.
    </p>
  );
}

/** Where a scene shows in the video: from its first piece's start to its last piece's end. */
function sceneStretch(spans: readonly SceneSpan[], index: number): { start: number; end: number } | undefined {
  const pieces = spans.filter((span) => span.sceneIndex === index);
  return pieces.length === 0 ? undefined : { start: pieces[0]!.start, end: pieces.at(-1)!.end };
}

function SelectionPanel() {
  const selection = useStore(store, (state) => state.selection);
  const tool = useStore(store, (state) => state.tool);
```

In the same file, replace:

```

function Details({ project, selection }: { project: CuttleProject; selection: Selection }) {
  const id = selection.id;
  if (selection.kind === 'scene') {
    const scene = project.scenes.find((item) => item.id === id)!;
    const stretch = sceneSpans(project.scenes).find((item) => item.scene === scene);
    const inVideo = stretch && <Row label="In the video">{span(stretch.start, stretch.end)}</Row>;
    if (scene.type === 'clip') {
      const name = [scene.speed !== 1 ? formatSpeed(scene.speed) : '', scene.label ?? (scene.speed === 1 ? 'Clip' : '')].filter(Boolean).join(' ');
```

with:

```

function Details({ project, selection }: { project: CuttleProject; selection: Selection }) {
  const id = selection.id;
  if (selection.kind === 'cut') return <CutDetails project={project} id={id} />;
  if (selection.kind === 'crop') return <CropDetails project={project} id={id} />;
  if (selection.kind === 'scene') {
    const sceneIndex = project.scenes.findIndex((item) => item.id === id);
    const scene = project.scenes[sceneIndex]!;
    const stretch = sceneStretch(sceneSpans(project.scenes, project.cuts), sceneIndex);
    const inVideo = stretch && <Row label="In the video">{span(stretch.start, stretch.end)}</Row>;
    if (scene.type === 'clip') {
      const name = [scene.speed !== 1 ? formatSpeed(scene.speed) : '', scene.label ?? (scene.speed === 1 ? 'Clip' : '')].filter(Boolean).join(' ');
```

In the same file, replace:

```
          <Row label="Badge" note={scene.badge === undefined ? 'shows the speed when sped up' : undefined}>
            <TextInput value={scene.badge ?? ''} placeholder={scene.speed > 1 ? `${formatSpeed(scene.speed)} speed` : 'none'} onCommit={(value) => set('scenes', id, { badge: value === '' ? undefined : value }, 'Change badge')} />
          </Row>
        </>
      );
    }
```

with:

```
          <Row label="Badge" note={scene.badge === undefined ? 'shows the speed when sped up' : undefined}>
            <TextInput value={scene.badge ?? ''} placeholder={scene.speed > 1 ? `${formatSpeed(scene.speed)} speed` : 'none'} onCommit={(value) => set('scenes', id, { badge: value === '' ? undefined : value }, 'Change badge')} />
          </Row>
          <Row label="Crop" plain note={scene.crop ? (scene.crop.auto ? 'Cuttle’s: the content of the window' : undefined) : 'the whole screen shows'}>
            {scene.crop ? (
              <button type="button" className="ghost small" onClick={() => select({ kind: 'crop', id })} data-testid="clip-crop">
                {`${Math.round(scene.crop.rect[2])} × ${Math.round(scene.crop.rect[3])}${scene.crop.enabled ? '' : ' · off'}`}
              </button>
            ) : (
              <button
                type="button"
                className="ghost small"
                onClick={() => {
                  // the crop tool works on the clip at the playhead: bring the playhead onto this one
                  if (playheadPlace()?.index !== sceneIndex && stretch) void currentPlayer()?.seek(stretch.start);
                  setTool('crop');
                }}
                data-testid="clip-crop"
              >
                Crop…
              </button>
            )}
          </Row>
        </>
      );
    }
```

In the same file, replace:

```
    return (
      <>
        <Head icon={<ZoomIcon />} color="var(--zoom)" name={zoom.label ?? 'Zoom'} />
        <Row label="Label">
          <TextInput value={zoom.label ?? ''} placeholder="Zoom" onCommit={(value) => set('zooms', id, { label: value.trim() || undefined }, 'Rename zoom')} />
        </Row>
```

with:

```
    return (
      <>
        <Head icon={<ZoomIcon />} color="var(--zoom)" name={zoom.label ?? 'Zoom'} />
        <AutoNote kind={zoom.auto} />
        <Row label="Label">
          <TextInput value={zoom.label ?? ''} placeholder="Zoom" onCommit={(value) => set('zooms', id, { label: value.trim() || undefined }, 'Rename zoom')} />
        </Row>
```

In the same file, replace:

```
    return (
      <>
        <Head icon={<MaskIcon />} color="var(--mask)" name={mask.label ?? 'Mask'} />
        <Row label="Label">
          <TextInput value={mask.label ?? ''} placeholder="Mask" onCommit={(value) => set('masks', id, { label: value.trim() || undefined }, 'Rename mask')} />
        </Row>
```

with:

```
    return (
      <>
        <Head icon={<MaskIcon />} color="var(--mask)" name={mask.label ?? 'Mask'} />
        <AutoNote kind={mask.auto} />
        <Row label="Label">
          <TextInput value={mask.label ?? ''} placeholder="Mask" onCommit={(value) => set('masks', id, { label: value.trim() || undefined }, 'Rename mask')} />
        </Row>
```

In the same file, replace:

```
    <>
      <div className="section-title">Output</div>
      <Row label="Size" note={`${output.fps} fps`}>
        <select
          value={size?.name ?? 'custom'}
          data-testid="output-size"
          onChange={(event) => {
            const chosen = SIZES.find((item) => item.name === event.target.value);
            if (chosen) edit([{ type: 'output', width: chosen.width, height: chosen.height }], `Output ${chosen.name}`);
          }}
        >
          {!size && <option value="custom">{`${output.width} × ${output.height}`}</option>}
          {SIZES.map((item) => (
            <option key={item.name} value={item.name}>
              {`${item.name} · ${item.width} × ${item.height}`}
            </option>
          ))}
        </select>
      </Row>

      <div className="section-title">Background</div>
```

with:

```
    <>
      <div className="section-title">Output</div>
      <Row label="Size" note={`${output.fps} fps`}>
        <StyledSelect
          value={size?.name ?? 'custom'}
          options={[
            ...(size ? [] : [{ value: 'custom', label: `${output.width} × ${output.height}` }]),
            ...SIZES.map((item) => ({ value: item.name, label: item.name, note: `${item.width} × ${item.height}` })),
          ]}
          onChange={(name) => {
            const chosen = SIZES.find((item) => item.name === name);
            if (chosen) edit([{ type: 'output', width: chosen.width, height: chosen.height }], `Output ${chosen.name}`);
          }}
          label="Output size"
          testId="output-size"
        >
          {size ? `${size.name} · ${size.width} × ${size.height}` : `${output.width} × ${output.height}`}
        </StyledSelect>
      </Row>

      <div className="section-title">Background</div>
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```
  color: var(--muted);
  font-size: var(--size-s);
}
.sheet select {
  background: var(--raised);
  border: 0;
  border-radius: 8px;
  height: 28px;
  padding: 0 8px;
  box-shadow: inset 0 0 0 1px var(--line);
}
.progress {
  display: flex;
```

with:

```
  color: var(--muted);
  font-size: var(--size-s);
}
.sheet .select-trigger {
  height: 28px;
  border-radius: 8px;
}
.progress {
  display: flex;
```

In the same file, replace:

```
  text-overflow: ellipsis;
}
.field input[type='text'],
.field textarea,
.field select {
  flex: 1;
  min-width: 0;
  width: 100%;
```

with:

```
  text-overflow: ellipsis;
}
.field input[type='text'],
.field textarea {
  flex: 1;
  min-width: 0;
  width: 100%;
```

In the same file, replace:

```
  line-height: 1.4;
}
.field input:hover,
.field textarea:hover,
.field select:hover {
  box-shadow: inset 0 0 0 1px var(--line-strong);
}
.field input:focus,
.field textarea:focus,
.field select:focus {
  box-shadow: inset 0 0 0 1px var(--accent);
}
.field-input.narrow input {
```

with:

```
  line-height: 1.4;
}
.field input:hover,
.field textarea:hover {
  box-shadow: inset 0 0 0 1px var(--line-strong);
}
.field input:focus,
.field textarea:focus {
  box-shadow: inset 0 0 0 1px var(--accent);
}
.field-input.narrow input {
```

In the same file, replace:

```
  background: var(--raised-active);
  color: var(--text);
}
.tl-bar .act.speed select {
  height: 22px;
  padding: 0 4px;
  border: 0;
  border-radius: 6px;
  background: var(--raised);
  box-shadow: inset 0 0 0 1px var(--line);
}
.tl-bar .act.speed select:focus-visible {
  box-shadow: var(--focus);
}
/* what can be dragged says so */
.scene,
```

with:

```
  background: var(--raised-active);
  color: var(--text);
}
.tl-bar .act.speed .select-trigger {
  min-width: 52px;
}
/* what can be dragged says so */
.scene,
```

In the same file, replace:

```
.cut-out-list button:focus-visible {
  background: var(--raised-active);
}
```

with:

```
.cut-out-list button:focus-visible {
  background: var(--raised-active);
}

/* a cut: a notch over the video lane where the clip jumps; an off cut faint and dashed where it would cut */
.cut-notch {
  position: absolute;
  top: 1px;
  bottom: 1px;
  width: 11px;
  margin-left: -5.5px;
  padding: 0;
  background: none;
  z-index: 3;
}
.cut-notch::before {
  content: '';
  position: absolute;
  left: 4.5px;
  top: 5px;
  bottom: 4px;
  width: 2px;
  border-radius: 1px;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(8, 8, 10, 0.75);
  transition: background var(--fast);
}
.cut-notch::after {
  content: '';
  position: absolute;
  left: 1.5px;
  top: 0;
  border: 4px solid transparent;
  border-top: 6px solid #fff;
  filter: drop-shadow(0 0 1px rgba(8, 8, 10, 0.9));
  transition: border-color var(--fast);
}
.cut-notch:focus-visible {
  box-shadow: none;
}
.cut-notch:hover::before,
.cut-notch:focus-visible::before,
.cut-notch.selected::before {
  background: var(--accent);
}
.cut-notch:hover::after,
.cut-notch:focus-visible::after,
.cut-notch.selected::after {
  border-top-color: var(--accent);
}
.cut-notch.selected::before {
  left: 4px;
  width: 3px;
}
.cut-notch.off::before {
  background: repeating-linear-gradient(to bottom, rgba(255, 255, 255, 0.6) 0 4px, transparent 4px 7px);
  box-shadow: none;
}
.cut-notch.off::after {
  border-top-color: rgba(255, 255, 255, 0.6);
}

/* a clip's crop in the source view: white, what lies outside dimmed */
.source-box.crop {
  box-shadow:
    0 0 0 1.5px #fff,
    0 0 0 4px rgba(255, 255, 255, 0.14);
}
.source-box.selected.crop {
  box-shadow:
    0 0 0 2px #fff,
    0 0 0 5px rgba(255, 255, 255, 0.18);
}

/* the Auto tab: what Cuttle did on its own, a row per kind with its switch, its items below */
.auto-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.auto-intro {
  margin: 0 0 4px;
}
.auto-group {
  border-radius: 10px;
  background: var(--raised);
}
.auto-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px 5px 5px;
}
.auto-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px;
  border-radius: 8px;
  text-align: left;
  background: none;
}
.auto-group .kind-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--raised-active);
  color: var(--text);
}
.auto-group.off .kind-icon,
.auto-group.off .auto-title {
  opacity: 0.55;
}
.auto-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.auto-title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.auto-count {
  color: var(--muted);
  font-size: var(--size-s);
  font-variant-numeric: tabular-nums;
}
.auto-chevron {
  color: var(--faint);
  flex: none;
  transition: transform var(--fast);
}
.auto-toggle[aria-expanded='true'] .auto-chevron {
  transform: rotate(180deg);
}
.auto-items {
  list-style: none;
  margin: 0;
  padding: 0 10px 8px 43px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.auto-items li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.auto-items li.off .auto-label,
.auto-items li.off .auto-time {
  color: var(--faint);
  text-decoration: line-through;
}
.auto-item {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 4px 6px;
  border-radius: 6px;
  background: none;
  text-align: left;
}
.auto-item:hover {
  background: var(--raised-hover);
}
.auto-time {
  flex: none;
  width: 44px;
  color: var(--muted);
  font-size: var(--size-s);
  font-variant-numeric: tabular-nums;
}
.auto-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.auto-empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.auto-empty p {
  margin: 0;
}
/* "Made by Cuttle for …" under an automatic item's name */
.auto-note {
  margin: -4px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--raised);
  color: var(--muted);
  font-size: var(--size-s);
  line-height: 1.5;
}
.auto-note b {
  color: var(--text);
  font-weight: 600;
}
```

- [ ] **Step 4: Typecheck, and no system select is left**

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `grep -rn "<select" apps/desktop/src/renderer --include=*.tsx`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "desktop: the Auto tab (a switch per kind and per item), cut notches and the cut panel, the Crop tool, and Cuttle's selects in the editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The end-to-end check

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The checks**

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
      },
      { selector, by, from: options.from ?? [0.5, 0.5], hold: options.hold ?? false },
    );
  const release = (by: [number, number]) =>
    editor.evaluate((by) => {
      const at = (window as unknown as { __held: { x: number; y: number } }).__held;
```

with:

```ts
      },
      { selector, by, from: options.from ?? [0.5, 0.5], hold: options.hold ?? false },
    );
  /** Picks the option labelled `label` from a select (Select.tsx): a click opens it, a click on the option picks it. */
  const choose = async (trigger: string, label: string) => {
    // a Playwright selector (it may use :has-text): the element's own click, as in a window never shown
    await editor.locator(trigger).evaluate((element) => (element as HTMLElement).click());
    await editor.waitForSelector('.select-list [role=option]');
    await editor.evaluate((label) => {
      const option = [...document.querySelectorAll('.select-list [role=option]')].find((item) => item.querySelector('.option-label')?.textContent === label);
      if (!option) throw new Error(`no option "${label}"`);
      (option as HTMLElement).click();
    }, label);
  };
  const release = (by: [number, number]) =>
    editor.evaluate((by) => {
      const at = (window as unknown as { __held: { x: number; y: number } }).__held;
```

In the same file, replace:

```ts

    // the 8× clip at 2×, from the timeline bar
    await press('.scene[data-id=s2]');
    await editor.selectOption('#speed-select', '2');
    await savedWhen((file) => file.scenes.find((scene) => scene.id === 's2')!.speed === 2);

    await undoAll();
```

with:

```ts

    // the 8× clip at 2×, from the timeline bar
    await press('.scene[data-id=s2]');
    await choose('[data-testid=speed]', '2×');
    await savedWhen((file) => file.scenes.find((scene) => scene.id === 's2')!.speed === 2);

    await undoAll();
```

In the same file, replace:

```ts
    await savedWhen((file) => file.masks.length === 2);
    const mask = onDisk().masks.find((item) => item.id !== 'm1')!;
    expect(mask.rect[2]! / mask.rect[3]!).toBeGreaterThan(3);
    await editor.selectOption('.inspector label.field:has-text("Style") select', 'blur');
    await savedWhen((file) => file.masks.find((item) => item.id === mask.id)!.style === 'blur');
    await shot('08-mask');
    // the look: a background swatch
```

with:

```ts
    await savedWhen((file) => file.masks.length === 2);
    const mask = onDisk().masks.find((item) => item.id !== 'm1')!;
    expect(mask.rect[2]! / mask.rect[3]!).toBeGreaterThan(3);
    await choose('.inspector label.field:has-text("Style") .select-trigger', 'Blur');
    await savedWhen((file) => file.masks.find((item) => item.id === mask.id)!.style === 'blur');
    await shot('08-mask');
    // the look: a background swatch
```

In the same file, replace:

```ts
    await shot('14b-look-cursors');
    await click(editor, '[data-testid=frame-mac-light]');
    await savedWhen((file) => (file as unknown as { look: { frame: { style?: string } } }).look.frame.style === 'mac-light');
    await editor.selectOption('[data-testid=cursor-smoothing]', '1');
    await savedWhen((file) => (file as unknown as { look: { cursor?: { smoothing?: number } } }).look.cursor?.smoothing === 1);
    await click(editor, '#tab-selection');
    await undoAll();
```

with:

```ts
    await shot('14b-look-cursors');
    await click(editor, '[data-testid=frame-mac-light]');
    await savedWhen((file) => (file as unknown as { look: { frame: { style?: string } } }).look.frame.style === 'mac-light');
    await choose('[data-testid=cursor-smoothing]', 'Very smooth');
    await savedWhen((file) => (file as unknown as { look: { cursor?: { smoothing?: number } } }).look.cursor?.smoothing === 1);
    await click(editor, '#tab-selection');
    await undoAll();
```

In the same file, replace:

```ts
    expect((await editor.evaluate(() => document.querySelector('.app')?.getAttribute('data-tool'))) ?? 'select').toBe('select');
  }, 30_000);

  it('keeps a drag going over a version written outside the app meanwhile: both are in the file, each undone on its own', async () => {
    await press('.item.zoom');
    await drag('.item.zoom', [40, 0], { hold: true });
```

with:

```ts
    expect((await editor.evaluate(() => document.querySelector('.app')?.getAttribute('data-tool'))) ?? 'select').toBe('select');
  }, 30_000);

  it("uses Cuttle's own menus, none of the system's: the keys open, move, pick and close them", async () => {
    expect(await editor.evaluate(() => document.querySelectorAll('select').length)).toBe(0);
    await click(editor, '#tab-look');
    await editor.focus('[data-testid=output-size]');
    await editor.keyboard.press('ArrowDown');
    await editor.waitForSelector('[data-testid=output-size-list]');
    await shot('16-select-open');
    // Esc closes it and keeps the focus on it (the editor does not back out of anything)
    await editor.keyboard.press('Escape');
    expect(await editor.locator('.select-list').count()).toBe(0);
    expect(await editor.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('output-size');
    // Enter opens it, End goes to the last size (9:16), Enter picks it
    await editor.keyboard.press('Enter');
    await editor.keyboard.press('End');
    await editor.keyboard.press('Enter');
    await savedWhen((file) => (file as unknown as { output: { width: number; height: number } }).output.height === 1920);
    await undoAll();
    await click(editor, '#tab-selection');
  }, 30_000);

  it('shows a cut as a notch the video jumps over, and what Cuttle did on its own in the Auto tab: a switch per kind and per item', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    const before = (await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state())).duration as number;
    // Claude (or Cuttle's cut) writes an automatic cut and an automatic click zoom
    const outside = onDisk() as unknown as Written & { cuts: unknown[] };
    outside.cuts = [{ id: 'c1', label: 'Filler: ähm', from: 1.2, to: 1.7, auto: 'filler' }];
    outside.zooms.push({ id: 'z7', label: 'Clicks', at: 9.4, duration: 1.8, rect: [100, 100, 640, 400], auto: 'click' } as Written['zooms'][number]);
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.waitForSelector('[data-testid=cut-notch]');
    await expect.poll(async () => (await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state())).duration as number).toBeCloseTo(before - 0.5, 3);
    // the notch selects the cut; the inspector says Cuttle made it and why
    await click(editor, '[data-testid=cut-notch]');
    await editor.waitForSelector('[data-testid=auto-note]');
    expect(await editor.locator('.inspector .kind-head .name').textContent()).toBe('Filler: ähm');
    await shot('17-cut');
    await click(editor, '[data-testid=cut-enabled]');
    await savedWhen((file) => (file as unknown as { cuts: { enabled?: boolean }[] }).cuts[0]!.enabled === false);
    await editor.waitForSelector('[data-testid=cut-notch].off');
    // the Auto tab: a row per kind; the click zooms switched off as a kind, then one back on
    await click(editor, '#tab-auto');
    await editor.waitForSelector('[data-testid=auto-group-click]');
    expect(await editor.locator('[data-testid=auto-group-fillers] .auto-count').textContent()).toBe('1 off');
    await click(editor, '[data-testid=auto-switch-click]');
    await savedWhen((file) => {
      const written = file as unknown as { autoEdits?: { clickZooms?: boolean }; zooms: { id: string; enabled?: boolean }[] };
      return written.autoEdits?.clickZooms === false && written.zooms.find((zoom) => zoom.id === 'z7')!.enabled === false;
    });
    expect((await doc()).undo).toBe('Zooms on clicks: off');
    await click(editor, '[data-testid=auto-group-click] .auto-toggle');
    await editor.waitForSelector('[data-testid=auto-group-click] .auto-items li.off');
    await shot('18-auto-tab');
    await click(editor, '[data-testid=auto-group-click] .auto-items li .toggle');
    await savedWhen((file) => (file as unknown as { zooms: { id: string; enabled?: boolean }[] }).zooms.find((zoom) => zoom.id === 'z7')!.enabled !== false);
    // a hand edit makes the zoom the person's: its tag goes
    await click(editor, '[data-testid=auto-group-click] .auto-item');
    await editor.waitForSelector('[data-testid=auto-note]');
    await drag('.item.zoom[data-id=z7]', [30, 0]);
    await savedWhen((file) => (file as unknown as { zooms: { id: string; auto?: string }[] }).zooms.find((zoom) => zoom.id === 'z7')!.auto === undefined);
    await click(editor, '#tab-selection');
    await editor.keyboard.press('Escape');
    await undoAll();
    // back to the file as it was (Claude reverting)
    writeFileSync(projectFile(), original);
    await editor.waitForFunction(() => document.querySelectorAll('[data-testid=cut-notch]').length === 0);
  }, 45_000);

  it('crops a clip in the source view: the window takes the crop’s shape; the crop is switched off in the inspector', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await press('.scene[data-id=s1]');
    await click(editor, '[data-testid=clip-crop]');
    await editor.waitForSelector('[data-testid=source-view]');
    expect(await editor.evaluate(() => document.querySelector('.app')?.getAttribute('data-tool'))).toBe('crop');
    await drag('[data-testid=source-view]', [300, 120], { from: [0.25, 0.25] });
    await savedWhen((file) => Boolean((file.scenes[0] as { crop?: { rect: number[] } }).crop));
    const crop = (onDisk().scenes[0] as unknown as { crop: { rect: number[] } }).crop.rect;
    // free in its shape (a crop is not held to the screen's)
    expect(crop[2]! / crop[3]!).toBeGreaterThan(2);
    await editor.waitForSelector('.source-box.crop.selected');
    await shot('19-crop-source');
    await editor.keyboard.press('Escape');
    await seek(1);
    await shot('19-crop-video');
    await press('.scene[data-id=s1]');
    await click(editor, '[data-testid=clip-crop]');
    await editor.waitForSelector('[data-testid=crop-enabled]');
    await click(editor, '[data-testid=crop-enabled]');
    await savedWhen((file) => (file.scenes[0] as { crop?: { enabled?: boolean } }).crop?.enabled === false);
    await editor.keyboard.press('Escape');
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('keeps a drag going over a version written outside the app meanwhile: both are in the file, each undone on its own', async () => {
    await press('.item.zoom');
    await drag('.item.zoom', [40, 0], { hold: true });
```

In the same file, replace:

```ts
      await bridge.invoke('picker:hover');
    }, choices);
    await page.waitForSelector('[data-testid=picker-record]:not([disabled])', { state: 'attached' });
    // the pickers close as the recording begins
    await click(page, '[data-testid=picker-record]').catch(() => {});
    if (!stop) return;
```

with:

```ts
      await bridge.invoke('picker:hover');
    }, choices);
    await page.waitForSelector('[data-testid=picker-record]:not([disabled])', { state: 'attached' });
    // Cuttle's own menus here too (Stop on, the devices): none of the system's
    expect(await page.evaluate(() => document.querySelectorAll('select').length)).toBe(0);
    // the pickers close as the recording begins
    await click(page, '[data-testid=picker-record]').catch(() => {});
    if (!stop) return;
```

In the same file, replace:

```ts
    await launchAgain(['--settings']);
    // shown with the settings read (a click before would change nothing)
    const settings = await waitForPage(app, async (page) => page.url().includes('/settings.html') && (await page.locator('[data-testid=countdown] [aria-checked=true]').count()) === 1);
    const saved = () => JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { countdown: number; motion: string; launchAtLogin: boolean };
    await click(settings, '[data-testid=countdown] button:nth-child(3)');
    await expect.poll(() => saved().countdown).toBe(5);
```

with:

```ts
    await launchAgain(['--settings']);
    // shown with the settings read (a click before would change nothing)
    const settings = await waitForPage(app, async (page) => page.url().includes('/settings.html') && (await page.locator('[data-testid=countdown] [aria-checked=true]').count()) === 1);
    expect(await settings.evaluate(() => document.querySelectorAll('select').length)).toBe(0);
    const saved = () => JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { countdown: number; motion: string; launchAtLogin: boolean };
    await click(settings, '[data-testid=countdown] button:nth-child(3)');
    await expect.poll(() => saved().countdown).toBe(5);
```

- [ ] **Step 2: Run it, with screenshots, and look at them**

```bash
mkdir -p "$TEMP/cuttle-p4m1-shots"
CUTTLE_HIDDEN=1 CUTTLE_RECORDER_BACKEND=test CUTTLE_CHECK_SHOTS="$TEMP/cuttle-p4m1-shots" pnpm app:check
```

Expected: PASS, 38 tests. Look at `16-select-open`, `17-cut`, `18-auto-tab`, `19-crop-source` and `19-crop-video`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/app.check.test.ts
git commit -m "desktop: app:check covers Cuttle's menus, cuts, the Auto tab and the Crop tool

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Final verification

- [ ] **Step 1: All tests, the typecheck and the packaged build**

Run: `pnpm test`
Expected: PASS, 533 tests in 62 files, 47 skipped (the real-capture test and the Electron checks: cli, app, build).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Open a project and write a cut into `cuttle.json` (or let Claude): the timeline shows a notch, and the video jumps there with no fade. In the Auto tab, switch the kind off and on.
2. Select a clip, then Crop… and drag over a browser's page: the window takes its shape, and a zoom stays inside it.
3. Open every menu (the picker's "Stop on", the devices, the speed, the output size, the export's encoder, the settings' camera and mic): each is Cuttle's list, not Windows', and works with the keys.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The task steps' test commands were not run a second time on the replay; the user asked for no double testing. The final verification ran on the replayed commits.
- There were no review subagents in this phase, at the user's request. The checks ran in the session, with every screenshot looked at.

**Found while checking, and already in the plan above**
- **The select's list did not take the keyboard.** The list is drawn only once it is placed, so the focus effect ran before the list existed: the arrows went to the editor. The effect now waits until the list is placed, and closing forgets the place.
- **A variant class collided with the editor.** The `field` variant gave the button the class `field`, which the editor styles as a column, so the text and chevron stacked. Variants are now `select-<variant>`.
- **The Crop tool missed its clip.** "Crop…" sought the clip's start without waiting, then cropped "the clip at the playhead", which could still be a page. The tool now crops the selected clip (else the one at the playhead), and the source view shows that clip's frame.
- **The Auto tab cut its titles short.** Each row now has its title above and the count below ("1 on", "1 off", "1 of 3 on", "Off: not made again").
- **Copying a cut or a crop** only explained why it cannot be done; their panels have no Duplicate any more.

**Tests that wobble under load** (not changed by this milestone)
- The recorder's "stops while paused: the take ends where it paused" failed once in a full `pnpm test` and passes alone.
- The app check's "keeps a take whose capture broke off" once never saw the failing test camera end, which left the app recording, so the next six checks found no picker. It passed alone and in the two full runs after.
- Both are for a later milestone that hardens the recorder's tests.

**Spec points that move**
- The `Menu` component comes with its first user (P4-M6). `Select` covers every menu today.
- **P4-M2 is split into two milestones**, so each one can be reviewed:
  - **M2a:** models, transcription, `transcript.json`, filler and pause cuts, the CLI;
  - **M2b:** captions in the engine and the export, the Transcript tab, the Look tab, SRT and VTT.
- **Audio cleanup uses `afftdn` (built in), not `arnndn`.** `arnndn` needs a model file that ffmpeg does not ship.

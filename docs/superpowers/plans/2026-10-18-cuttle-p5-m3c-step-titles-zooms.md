# Cuttle P5-M3c: Step Titles and Step Zooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `suggest` turns each step of the script the take reached into a title and a zoom point:
- **The title** shows where the video shows the step. It is a text in the lower-third style, or the kit's lower third or kinetic title when the step names one (`script[].motion`).
- **The zoom** goes to where the step happens: its clicks and where it types.
- Both are automatic items: the Auto tab lists them, a kind or an item can be switched off, and a rerun replaces only what it made.

**Architecture:**
- **`@cuttle/project`:**
  - New auto kinds `title` (a step's title) and `step` (a zoom on a step).
  - The `auto` tag on texts and overlays.
  - `autoEdits.stepTitles` and `stepZooms`.
  - `script[].motion` (`lower-third` or `title`).
- **`@cuttle/timeline`:**
  - `stepMoves`: the take's moves through the script, slips left out. The chapters (P5-M3b) now use it.
  - `shownFrom`: where the video shows a moment.
  - `stepZooms`: one zoom per step around its actions.
- **`@cuttle/core`:**
  - `withStepTitles` makes the titles.
  - `suggestProject` makes the step zooms before the clicks' zooms, and the titles after the masks.
  - A step's motion template comes through `motionPage`, given by the CLI and the app.
- **`@cuttle/motion-kit`:** `templatePage` is the project's page of a template, which all its step titles share: the one there, else a copy.
- **The CLI and the app:**
  - `cuttle suggest --no-step-titles --no-step-zooms`.
  - The app's cut passes the kit's pages.
  - The Auto tab gets "Step titles" and "Zooms on steps", and a text or overlay Cuttle made says so.

**Tech Stack:** TypeScript strict, zod 4, React 19, Electron 44.7.2.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-roadmap-p4-p6.md` (P5-M3: "Each step becomes a chapter, a caption and a zoom point; a step may name a motion template for its title"). P5-M3b made the chapters; this milestone completes P5-M3. Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m3b-chapters.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m3c`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The full `pnpm test` and the typecheck run in Task 6.

## Decisions made while planning

A prototype of the milestone, checked against the roadmap, settled these points. The finished prototype passed `pnpm test` (933 tests, 77 skipped, in a full run; two more runs under load had timing failures in untouched code, see below), the typecheck, `app:check` (56 tests) and `cli:check` (15). Every screenshot was looked at.

- **Titles and zooms are automatic items, made by `suggest`**, as the other automatic edits are (the app runs it after every take):
  - They are tagged `auto: "title"` (a text or an overlay) and `auto: "step"` (a zoom).
  - A rerun replaces only those. A title the person switched off stays off (matched by what it says), and a zoom as the other zooms do. One changed by hand is theirs.
  - A kind switched off (`autoEdits.stepTitles`, `stepZooms`, or `--no-step-titles`, `--no-step-zooms`) takes those made before away and makes none. `--no-zoom` leaves out the step zooms too.
- **Where a step is, as M3b's chapters have it:**
  - `stepMoves` is the take's way through the script: a move undone within 2 s is none, and a step reached again later is a move again.
  - The chapters now use it too: one rule for both.
  - A title starts at the moment the take reached its step, or where the video goes on when that moment is cut.
- **A title shows 3 s of the video** (a motion template its own 4 or 3.5 s). Over a sped-up clip that is more of the take.
  - It ends before the next step and at the take's last shown second.
  - None is made for a step the video shows shorter than 0.8 s.
- **A text title** is in the lower-third style (a dark box with the accent bar). It sits at the bottom, or at the top when the subtitles take the bottom.
- **A step's motion template** is an overlay of the kit's page:
  - `lower-third` shows the title and "Step 2 of 3".
  - `title` shows the kinetic title with "Step 2" above it and its own background off, so it lies over the clip.
  - All titles of a template share one page: the project's `motion/<template>/index.html` when it has one (as the person may have changed it), else a copy of the kit's.
  - Without the kit (a `suggest` given no `motionPage`), they are texts, and a note says so.
- **A step's zoom** goes to where the step happens:
  - It is the box around its clicks and the caret's places in its first 8 s, until the next step.
  - It runs from 0.6 s before the first to 1.5 s after the last, 1.5 to 6 s long, and ends at the next step. Its rect is a click zoom's.
  - None is made for a step without clicks or typing, one sped up more than 2×, or where another zoom is.
  - It comes after the answer, dialog and typing zooms and before the clicks' zooms, which keep clear of it: a step with a few clicks gets one calm zoom.
- **The Auto tab** lists "Step titles" (texts and overlays) and "Zooms on steps", each with its switch.
  - A text or overlay Cuttle made says "Made by Cuttle for a step of the script", as zooms and masks do.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/{schema,index}.ts` | the kinds, the tags, the switches, a step's motion |
| `packages/timeline/src/{steps,chapters,index}.ts` | the moves, where the video shows them, the step zooms |
| `packages/motion-kit/src/files.ts` | a template's page shared by the titles |
| `packages/core/src/suggest/steps.ts`, `packages/core/src/suggest.ts` | the titles, the zooms in `suggest` |
| `apps/cli/src/{main,commands/suggest}.ts`, `apps/desktop/src/workers/media.ts` | the switches, the kit's pages |
| `apps/desktop/src/renderer/editor/Inspector.tsx` | the Auto tab |
| `README.md`, `skill/cuttle/{SKILL,project}.md` | the guides |

---

### Task 1: The kinds, tags and switches in the project

**Files:**
- Modify: `packages/project/src/schema.ts`, `packages/project/src/index.ts`, `packages/project/test/schema.test.ts`, `apps/desktop/src/renderer/editor/Inspector.tsx`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m3c`; work there:

```bash
git switch p5-m3c
```

- [ ] **Step 2: Write the failing tests**

In `packages/project/test/schema.test.ts`, replace:

```ts
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: '   ' }] })).toEqual(['script.0.title']);
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: 'x'.repeat(81) }] })).toEqual(['script.0.title']);
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: 'Go', note: 'x'.repeat(1001) }] })).toEqual(['script.0.note']);
    expect(pathsOf({ ...minimal, script: Array.from({ length: 51 }, (_, i) => ({ id: `step${i + 1}`, title: 'Go' })) })).toEqual(['script']);
    const twice = ProjectSchema.safeParse({ ...minimal, scenes: [{ type: 'clip', id: 'step1', from: 0, to: 1 }], script: [{ id: 'step1', title: 'Go' }] });
    expect(twice.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([['script.0.id', 'the id "step1" is already used by scenes[0]']]);
```

with:

```ts
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: '   ' }] })).toEqual(['script.0.title']);
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: 'x'.repeat(81) }] })).toEqual(['script.0.title']);
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: 'Go', note: 'x'.repeat(1001) }] })).toEqual(['script.0.note']);
    // a step's title may be a motion template's, the kit's lower third or title
    expect(ProjectSchema.parse({ ...minimal, script: [{ id: 'step1', title: 'Go', motion: 'lower-third' }] }).script[0]!.motion).toBe('lower-third');
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: 'Go', motion: 'end-card' }] })).toEqual(['script.0.motion']);
    expect(pathsOf({ ...minimal, script: Array.from({ length: 51 }, (_, i) => ({ id: `step${i + 1}`, title: 'Go' })) })).toEqual(['script']);
    const twice = ProjectSchema.safeParse({ ...minimal, scenes: [{ type: 'clip', id: 'step1', from: 0, to: 1 }], script: [{ id: 'step1', title: 'Go' }] });
    expect(twice.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([['script.0.id', 'the id "step1" is already used by scenes[0]']]);
```

In the same file, replace:

```ts
    const p = ProjectSchema.parse(minimal);
    expect(p.cuts).toEqual([]);
    expect(p.autoEdits).toEqual({
      crop: true, privacy: true, retakes: true, fillers: true, pauses: true, typingZooms: true, dialogZooms: true, clickZooms: true, answerZoom: true,
    });
  });
```

with:

```ts
    const p = ProjectSchema.parse(minimal);
    expect(p.cuts).toEqual([]);
    expect(p.autoEdits).toEqual({
      crop: true, privacy: true, retakes: true, fillers: true, pauses: true, typingZooms: true, dialogZooms: true, clickZooms: true, answerZoom: true, stepTitles: true, stepZooms: true,
    });
  });
```

In the same file, replace:

```ts
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
```

with:

```ts
      cuts: [{ id: 'c1', label: 'Filler: ähm', from: 12.4, to: 12.8, auto: 'filler' }],
      zooms: [{ id: 'z1', at: 30, duration: 3, rect: [0, 0, 960, 540], auto: 'click' }],
      masks: [{ id: 'm1', from: 1, to: 2, rect: [0, 0, 10, 10], auto: 'privacy' }],
      texts: [{ id: 't1', at: 1, duration: 3, text: 'Open the settings', auto: 'title' }],
      overlays: [{ id: 'o1', src: 'motion/lower-third/index.html', at: 8, duration: 4, auto: 'title' }],
      autoEdits: { fillers: false },
    });
    expect(p.scenes[0]).toMatchObject({ crop: { rect: [62, 141, 2478, 1237], enabled: true, auto: 'crop' } });
    expect(p.cuts[0]).toEqual({ id: 'c1', label: 'Filler: ähm', from: 12.4, to: 12.8, enabled: true, auto: 'filler' });
    expect(p.zooms[0]!.auto).toBe('click');
    expect([p.texts[0]!.auto, p.overlays[0]!.auto]).toEqual(['title', 'title']);
    expect(p.autoEdits).toMatchObject({ fillers: false, pauses: true });
  });
```

Run: `pnpm exec vitest run --project node packages/project`
Expected: FAIL: there are no step switches, texts and overlays take no `auto`, and a step has no `motion`.

- [ ] **Step 3: The schema**

In `packages/project/src/schema.ts`, replace:

```ts
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

with:

```ts
export const CLICK_EFFECTS = ['ripple', 'none'] as const;
export const MOUSE_BUTTONS = ['left', 'right', 'middle'] as const;
/**
 * What made an automatic item (`auto` on cuts, zooms, masks, texts, overlays and a clip's crop).
 * Editing an item by hand drops its tag; a rerun replaces only tagged items of the kinds it makes.
 * `title`: a step's title from the script (a text, or an overlay of the step's motion template);
 * `step`: a zoom on where a step of the script happens.
 */
export const AUTO_KINDS = ['crop', 'privacy', 'notification', 'retake', 'filler', 'pause', 'length', 'typing', 'dialog', 'click', 'answer', 'title', 'step'] as const;
/** The motion templates a step's title may be drawn with, as an overlay over the step's start. */
export const STEP_MOTIONS = ['lower-third', 'title'] as const;

// z.number() already rejects Infinity and NaN in zod 4.
const seconds = z.number().nonnegative();
```

In the same file, replace:

```ts
  dialogZooms: z.boolean().default(true),
  clickZooms: z.boolean().default(true),
  answerZoom: z.boolean().default(true),
});

const TextSchema = z.strictObject({
```

with:

```ts
  dialogZooms: z.boolean().default(true),
  clickZooms: z.boolean().default(true),
  answerZoom: z.boolean().default(true),
  stepTitles: z.boolean().default(true),
  stepZooms: z.boolean().default(true),
});

const TextSchema = z.strictObject({
```

In the same file, replace:

```ts
  style: z.enum(TEXT_STYLES).default('pill'),
  position: z.enum(TEXT_POSITIONS).default('top'),
  enabled: z.boolean().default(true),
});

/**
```

with:

```ts
  style: z.enum(TEXT_STYLES).default('pill'),
  position: z.enum(TEXT_POSITIONS).default('top'),
  enabled: z.boolean().default(true),
  auto: autoKind,
});

/**
```

In the same file, replace:

```ts
  at: seconds,
  duration: positiveSeconds,
  enabled: z.boolean().default(true),
});

/**
```

with:

```ts
  at: seconds,
  duration: positiveSeconds,
  enabled: z.boolean().default(true),
  auto: autoKind,
});

/**
```

In the same file, replace:

```ts
  title: z.string().max(STEP_TITLE_MAX).regex(/\S/, 'a step needs a title'),
  /** What to say or do: for the prompter only, never in the video. */
  note: z.string().max(STEP_NOTE_MAX).optional(),
});

export const ProjectSchema = z
```

with:

```ts
  title: z.string().max(STEP_TITLE_MAX).regex(/\S/, 'a step needs a title'),
  /** What to say or do: for the prompter only, never in the video. */
  note: z.string().max(STEP_NOTE_MAX).optional(),
  /** Its title as this motion template (an overlay), instead of a text. */
  motion: z.enum(STEP_MOTIONS).optional(),
});

export const ProjectSchema = z
```

In the same file, replace:

```ts
export type Music = NonNullable<CuttleProject['music']>;
export type Sound = CuttleProject['sounds'][number];
export type ScriptStep = CuttleProject['script'][number];
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
```

with:

```ts
export type Music = NonNullable<CuttleProject['music']>;
export type Sound = CuttleProject['sounds'][number];
export type ScriptStep = CuttleProject['script'][number];
export type StepMotion = (typeof STEP_MOTIONS)[number];
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
```

In `packages/project/src/index.ts`, replace:

```ts
  FRAME_STYLES,
  ID_PATTERN,
  SCRIPT_MAX_STEPS,
  STEP_NOTE_MAX,
  STEP_TITLE_MAX,
  MASK_STYLES,
```

with:

```ts
  FRAME_STYLES,
  ID_PATTERN,
  SCRIPT_MAX_STEPS,
  STEP_MOTIONS,
  STEP_NOTE_MAX,
  STEP_TITLE_MAX,
  MASK_STYLES,
```

In the same file, replace:

```ts
  type Music,
  type Sound,
  type ScriptStep,
  type MotionScene,
  type SceneTransition,
  type ClipScene,
```

with:

```ts
  type Music,
  type Sound,
  type ScriptStep,
  type StepMotion,
  type MotionScene,
  type SceneTransition,
  type ClipScene,
```

The Auto tab names every kind: the two new ones, their groups, and the note on a text or an overlay Cuttle made.

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```tsx
  { id: 'dialog', title: 'Zooms on dialogs', icon: <ZoomIcon />, kinds: ['dialog'], key: 'dialogZooms' },
  { id: 'click', title: 'Zooms on clicks', icon: <ZoomIcon />, kinds: ['click'], key: 'clickZooms' },
  { id: 'answer', title: 'Zoom on Claude’s answer', icon: <ZoomIcon />, kinds: ['answer'], key: 'answerZoom' },
];

/** The automatic items of a group, in the order the video shows them. */
```

with:

```tsx
  { id: 'dialog', title: 'Zooms on dialogs', icon: <ZoomIcon />, kinds: ['dialog'], key: 'dialogZooms' },
  { id: 'click', title: 'Zooms on clicks', icon: <ZoomIcon />, kinds: ['click'], key: 'clickZooms' },
  { id: 'answer', title: 'Zoom on Claude’s answer', icon: <ZoomIcon />, kinds: ['answer'], key: 'answerZoom' },
  { id: 'titles', title: 'Step titles', icon: <TextIcon />, kinds: ['title'], key: 'stepTitles' },
  { id: 'steps', title: 'Zooms on steps', icon: <ZoomIcon />, kinds: ['step'], key: 'stepZooms' },
];

/** The automatic items of a group, in the order the video shows them. */
```

In the same file, replace:

```tsx
  for (const zoom of project.zooms) if (of(zoom.auto) && zoom.id) items.push({ kind: 'zoom', id: zoom.id, label: zoom.label ?? 'Zoom', enabled: zoom.enabled, at: outputTimesOf(spans, zoom.at)[0] });
  for (const mask of project.masks) if (of(mask.auto) && mask.id) items.push({ kind: 'mask', id: mask.id, label: mask.label ?? 'Mask', enabled: mask.enabled, at: outputTimesOf(spans, mask.from)[0] });
  for (const cut of project.cuts) if (of(cut.auto) && cut.id) items.push({ kind: 'cut', id: cut.id, label: cut.label ?? 'Cut', enabled: cut.enabled, at: cutShownAt(spans, cut) });
  project.scenes.forEach((scene, index) => {
    if (scene.type === 'clip' && scene.id && of(scene.crop?.auto)) {
      items.push({ kind: 'crop', id: scene.id, label: `${scene.label ?? 'Clip'}: ${Math.round(scene.crop!.rect[2])} × ${Math.round(scene.crop!.rect[3])}`, enabled: scene.crop!.enabled, at: sceneStretch(spans, index)?.start });
```

with:

```tsx
  for (const zoom of project.zooms) if (of(zoom.auto) && zoom.id) items.push({ kind: 'zoom', id: zoom.id, label: zoom.label ?? 'Zoom', enabled: zoom.enabled, at: outputTimesOf(spans, zoom.at)[0] });
  for (const mask of project.masks) if (of(mask.auto) && mask.id) items.push({ kind: 'mask', id: mask.id, label: mask.label ?? 'Mask', enabled: mask.enabled, at: outputTimesOf(spans, mask.from)[0] });
  for (const cut of project.cuts) if (of(cut.auto) && cut.id) items.push({ kind: 'cut', id: cut.id, label: cut.label ?? 'Cut', enabled: cut.enabled, at: cutShownAt(spans, cut) });
  for (const text of project.texts) if (of(text.auto) && text.id) items.push({ kind: 'caption', id: text.id, label: text.text, enabled: text.enabled, at: outputTimesOf(spans, text.at)[0] });
  for (const overlay of project.overlays) {
    if (of(overlay.auto) && overlay.id) items.push({ kind: 'motion', id: overlay.id, label: overlay.label ?? motionName(overlay.src), enabled: overlay.enabled, at: outputTimesOf(spans, overlay.at)[0] });
  }
  project.scenes.forEach((scene, index) => {
    if (scene.type === 'clip' && scene.id && of(scene.crop?.auto)) {
      items.push({ kind: 'crop', id: scene.id, label: `${scene.label ?? 'Clip'}: ${Math.round(scene.crop!.rect[2])} × ${Math.round(scene.crop!.rect[3])}`, enabled: scene.crop!.enabled, at: sceneStretch(spans, index)?.start });
```

In the same file, replace:

```tsx
  dialog: 'a dialog',
  click: 'clicks',
  answer: "Claude's answer",
};

/** Says that Cuttle made the item, for what, and that a change makes it the person's. */
```

with:

```tsx
  dialog: 'a dialog',
  click: 'clicks',
  answer: "Claude's answer",
  title: 'a step of the script',
  step: 'a step of the script',
};

/** Says that Cuttle made the item, for what, and that a change makes it the person's. */
```

In the same file, replace:

```tsx
  return (
    <>
      <Head icon={<TextIcon />} color="var(--caption)" name={text.label ?? 'Caption'} />
      <Row label="Text" wide>
        <TextInput value={text.text} multiline onCommit={(value) => value.trim() && set('texts', id, { text: value }, 'Edit caption')} testId="caption-text" />
      </Row>
```

with:

```tsx
  return (
    <>
      <Head icon={<TextIcon />} color="var(--caption)" name={text.label ?? 'Caption'} />
      <AutoNote kind={text.auto} />
      <Row label="Text" wide>
        <TextInput value={text.text} multiline onCommit={(value) => value.trim() && set('texts', id, { text: value }, 'Edit caption')} testId="caption-text" />
      </Row>
```

In the same file, replace:

```tsx
  return (
    <>
      <Head icon={<MotionIcon />} color="var(--motion)" name={item.label ?? motionName(item.src)} />
      <MotionState status={status} />
      <Row label="Label">
        <TextInput value={item.label ?? ''} placeholder={motionName(item.src)} onCommit={(value) => set(list, id, { label: value.trim() || undefined }, `Rename ${noun}`)} testId="motion-label" />
```

with:

```tsx
  return (
    <>
      <Head icon={<MotionIcon />} color="var(--motion)" name={item.label ?? motionName(item.src)} />
      {'auto' in item && <AutoNote kind={item.auto} />}
      <MotionState status={status} />
      <Row label="Label">
        <TextInput value={item.label ?? ''} placeholder={motionName(item.src)} onCommit={(value) => set(list, id, { label: value.trim() || undefined }, `Rename ${noun}`)} testId="motion-label" />
```

Run: `pnpm exec vitest run --project node packages/project`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/project apps/desktop/src/renderer/editor/Inspector.tsx
git commit -m "project: step titles and step zooms as automatic items, a step's motion template; the Auto tab lists them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The moves through the script, and the step zooms

**Files:**
- Create: `packages/timeline/src/steps.ts`, `packages/timeline/test/steps.test.ts`
- Modify: `packages/timeline/src/chapters.ts`, `packages/timeline/src/index.ts`

- [ ] **Step 1: Write the failing tests**

`packages/timeline/test/steps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { InputEvent, Marker } from '@cuttle/project';
import { zoomRectFor } from '../src/click-zooms';
import { shownFrom, stepMoves, stepZooms } from '../src/steps';

const script = [
  { id: 'step1', title: 'Open the settings' },
  { id: 'step2', title: 'Turn on dark mode' },
  { id: 'step3', title: 'Export the video' },
];
const at = (...moves: [number, string][]): Marker[] => moves.map(([t, label]) => ({ t, kind: 'step', label }));
const screen = { width: 1920, height: 1080 };
const click = (t: number, x: number, y: number): InputEvent => ({ t, type: 'click', x, y, button: 'left' });
const caret = (t: number, x: number, y: number): InputEvent => ({ t, type: 'caret', rect: [x, y, 2, 20] });
const whole = [{ from: 0, to: 60, speed: 1, start: 0 }];

describe('stepMoves', () => {
  it('lists where the take reached each step, with its number; a slip, a step the script lost and a move to the step it is at are none', () => {
    const markers = at([0, 'step1'], [10, 'step2'], [20, 'step3'], [21, 'step2'], [22, 'step3'], [30, 'step9'], [31, 'step3'], [40, 'step2']);
    expect(stepMoves(script, markers).map((move) => [move.t, move.number, move.step.title])).toEqual([
      [0, 1, 'Open the settings'],
      [10, 2, 'Turn on dark mode'],
      [22, 3, 'Export the video'],
      [40, 2, 'Turn on dark mode'],
    ]);
    expect(stepMoves([], markers)).toEqual([]);
  });
});

describe('shownFrom', () => {
  it('is the second itself where a clip shows it, else where the clip after it begins', () => {
    const clips = [
      { from: 2, to: 10 },
      { from: 20, to: 30 },
    ];
    expect([shownFrom(clips, 5), shownFrom(clips, 0), shownFrom(clips, 12), shownFrom(clips, 31)]).toEqual([5, 2, 20, undefined]);
  });
});

describe('stepZooms', () => {
  it('zooms on where each step happens: its clicks and typing, from just before the first to after the last, before the next step', () => {
    const moves = stepMoves(script, at([0, 'step1'], [10, 'step2'], [20, 'step3']));
    const events = [click(2, 400, 300), click(3, 520, 360), caret(12, 1500, 800), caret(13, 1560, 800), click(30, 900, 500)];
    const zooms = stepZooms(moves, events, whole, screen);
    expect(zooms.map((zoom) => [zoom.at, zoom.duration, zoom.move.number])).toEqual([
      [1.4, 3.1, 1],
      [11.4, 3.1, 2],
    ]);
    expect(zooms[0]!.rect).toEqual(zoomRectFor({ left: 400, top: 300, right: 520, bottom: 360 }, screen));
    expect(zooms[1]!.rect).toEqual(zoomRectFor({ left: 1500, top: 800, right: 1562, bottom: 820 }, screen));
  });

  it('ends at the next step, waits for a step the video trims, and makes none without actions, sped up, or where another zoom is', () => {
    const moves = stepMoves(script, at([0, 'step1'], [5, 'step2'], [20, 'step3']));
    // step 1's click at 4.5 s: its zoom ends at step 2 (5 s), however short the tail
    expect(stepZooms(moves.slice(0, 2), [click(4.5, 900, 500)], whole, screen).map((zoom) => [zoom.at, zoom.duration])).toEqual([[3.9, 1.1]]);
    // the video starts at 2 s: step 1 is looked for from there
    expect(stepZooms(moves.slice(0, 1), [click(1, 900, 500), click(3, 900, 500)], [{ from: 2, to: 60, speed: 1, start: 0 }], screen).map((zoom) => zoom.at)).toEqual([2.4]);
    // sped up 8×: none; a zoom there already: none
    expect(stepZooms(moves.slice(0, 1), [click(2, 900, 500)], [{ from: 0, to: 60, speed: 8, start: 0 }], screen)).toEqual([]);
    expect(stepZooms(moves.slice(0, 1), [click(2, 900, 500)], whole, screen, [{ at: 1, duration: 2 }])).toEqual([]);
    expect(stepZooms(moves, [], whole, screen)).toEqual([]);
  });
});
```

Run: `pnpm exec vitest run --project node packages/timeline/test/steps.test.ts`
Expected: FAIL: there is no `../src/steps`.

- [ ] **Step 2: The moves, where the video shows them, the zooms; the chapters on the moves**

`packages/timeline/src/steps.ts`:

```ts
// The take's way through the script: where it reached each step (its `step` markers, a slip of the
// step key left out), and a zoom on where each step happens. Pure: the chapters, and `suggest`'s
// step titles and step zooms, are made from these.
import type { InputEvent, Marker, Rect, ScriptStep } from '@cuttle/project';
import { zoomRectFor, type ClipSpan } from './click-zooms';

/** A move to a step undone within this many seconds (the step key pressed by mistake, then back) is none. */
export const STEP_SLIP_SECONDS = 2;

/** A step's place in the take: the step, its number in the script (from 1), and the source second the take reached it. */
export interface StepMove {
  step: ScriptStep;
  number: number;
  t: number;
}

/**
 * Where the take reached each step, in source seconds: a move that the next one undoes within the
 * slip time (back to the step before it) is left out with its undoing; a step reached again later
 * (after another) is a move again; a move to the step it is at already, or to a step the script no
 * longer has, is none.
 */
export function stepMoves(script: readonly ScriptStep[], markers: readonly Marker[]): StepMove[] {
  const moves = markers.filter((marker) => marker.kind === 'step' && marker.label !== undefined).sort((a, b) => a.t - b.t);
  for (let i = 1; i + 1 < moves.length; ) {
    if (moves[i + 1]!.label === moves[i - 1]!.label && moves[i + 1]!.t - moves[i]!.t < STEP_SLIP_SECONDS) moves.splice(i, 2);
    else i++;
  }
  const result: StepMove[] = [];
  for (const move of moves) {
    const number = script.findIndex((step) => step.id === move.label) + 1;
    if (number === 0 || result.at(-1)?.step.id === move.label) continue;
    result.push({ step: script[number - 1]!, number, t: move.t });
  }
  return result;
}

/** The source second where the video shows source second `t`: `t` when a clip shows it, else where the clip that shows the take's next moment begins. */
export function shownFrom(clips: readonly Pick<ClipSpan, 'from' | 'to'>[], t: number): number | undefined {
  let next: number | undefined;
  for (const clip of clips) {
    if (t >= clip.from && t < clip.to) return t;
    if (clip.from > t && (next === undefined || clip.from < next)) next = clip.from;
  }
  return next;
}

/** How a step's zoom is found: its actions in this many seconds after the step begins, the zoom a little before the first and after the last. */
export const STEP_ZOOM = { look: 8, lead: 0.6, tail: 1.5, least: 1.5, most: 6, maxSpeed: 2 } as const;

export interface StepZoom {
  at: number;
  duration: number;
  rect: Rect;
  move: StepMove;
}

/**
 * A zoom on where each step happens: around its clicks and where it types (the caret) in its first
 * seconds, from a little before the first to a little after the last, ending before the next step.
 * None for a step without them, one the video speeds up (more than 2×), or where another zoom is.
 */
export function stepZooms(moves: readonly StepMove[], events: readonly InputEvent[], clips: readonly ClipSpan[], screen: { width: number; height: number }, avoid: readonly { at: number; duration: number }[] = []): StepZoom[] {
  const zooms: StepZoom[] = [];
  const shownSlowly = (t: number) => clips.some((clip) => t >= clip.from && t < clip.to && clip.speed <= STEP_ZOOM.maxSpeed);
  moves.forEach((move, i) => {
    const start = shownFrom(clips, move.t);
    if (start === undefined) return;
    const next = moves[i + 1]?.t ?? Infinity;
    const until = Math.min(next, start + STEP_ZOOM.look);
    const acts = events.filter((event): event is Extract<InputEvent, { type: 'click' | 'caret' }> => (event.type === 'click' || event.type === 'caret') && event.t >= start && event.t < until && shownSlowly(event.t));
    if (acts.length === 0) return;
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const act of acts) {
      const [x, y, w, h] = act.type === 'caret' ? act.rect : [act.x, act.y, 0, 0];
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x + w);
      box.bottom = Math.max(box.bottom, y + h);
    }
    const at = Math.max(start, acts[0]!.t - STEP_ZOOM.lead);
    const end = Math.min(next, Math.max(at + STEP_ZOOM.least, acts.at(-1)!.t + STEP_ZOOM.tail), at + STEP_ZOOM.most);
    if (end - at < 0.5 || [...avoid, ...zooms].some((other) => at < other.at + other.duration && other.at < end)) return;
    zooms.push({ at: Math.round(at * 1000) / 1000, duration: Math.round((end - at) * 1000) / 1000, rect: zoomRectFor(box, screen), move });
  });
  return zooms;
}
```

In `packages/timeline/src/chapters.ts`, replace:

```ts
// output seconds, named by the step's title. Pure: the export writes them into the video file, the
// CLI and the editor list them as YouTube reads them in a description.
import type { Marker, ScriptStep } from '@cuttle/project';
import { totalDuration, type SceneSpan } from './time';

/** A chapter: from `at` to `end` (output seconds), named after a step of the script (`step`, its id). */
```

with:

```ts
// output seconds, named by the step's title. Pure: the export writes them into the video file, the
// CLI and the editor list them as YouTube reads them in a description.
import type { Marker, ScriptStep } from '@cuttle/project';
import { stepMoves } from './steps';
import { totalDuration, type SceneSpan } from './time';

/** A chapter: from `at` to `end` (output seconds), named after a step of the script (`step`, its id). */
```

In the same file, replace:

```ts
  step: string;
}

/** A move to a step undone within this many seconds (the step key pressed by mistake, then back) is no chapter. */
export const CHAPTER_SLIP_SECONDS = 2;

/**
 * What YouTube asks of a description's chapters: the first at 0:00 (the chapters here always start
 * there), at least three, each this long or longer.
```

with:

```ts
  step: string;
}

/**
 * What YouTube asks of a description's chapters: the first at 0:00 (the chapters here always start
 * there), at least three, each this long or longer.
```

In the same file, replace:

```ts
}

/**
 * The chapters of a video from the take's `step` markers: one where the take reached each step,
 * named by the step's title. A move undone right away is left out; a step reached again later (after
 * another) starts a chapter again. The first chapter starts at 0, with what comes before the first
 * clip; each ends where the next begins, the last at the video's end. A step no longer in the
 * script makes none, nor does one shown no earlier than the chapter before it.
 */
export function stepChapters(script: readonly ScriptStep[], markers: readonly Marker[], spans: readonly SceneSpan[]): Chapter[] {
  const moves = markers.filter((marker) => marker.kind === 'step' && marker.label !== undefined).sort((a, b) => a.t - b.t);
  // a slip: a move that the next one undoes (back to the step before it) within the slip time
  for (let i = 1; i + 1 < moves.length; ) {
    if (moves[i + 1]!.label === moves[i - 1]!.label && moves[i + 1]!.t - moves[i]!.t < CHAPTER_SLIP_SECONDS) moves.splice(i, 2);
    else i++;
  }
  const starts: Omit<Chapter, 'end'>[] = [];
  for (const move of moves) {
    const step = script.find((item) => item.id === move.label);
    const at = step && shownAt(spans, move.t);
    if (!step || at === undefined) continue;
    const last = starts.at(-1);
    if (last?.step === step.id) continue;
    // steps reached in a stretch the video leaves out start where it goes on: the last of them is what it shows
```

with:

```ts
}

/**
 * The chapters of a video from the take's `step` markers: one where the take reached each step
 * (`stepMoves`: a move undone right away is none; a step reached again later starts a chapter
 * again), named by the step's title. The first chapter starts at 0, with what comes before the first
 * clip; each ends where the next begins, the last at the video's end. A step no longer in the
 * script makes none, nor does one shown no earlier than the chapter before it.
 */
export function stepChapters(script: readonly ScriptStep[], markers: readonly Marker[], spans: readonly SceneSpan[]): Chapter[] {
  const starts: Omit<Chapter, 'end'>[] = [];
  for (const { step, t } of stepMoves(script, markers)) {
    const at = shownAt(spans, t);
    if (at === undefined) continue;
    const last = starts.at(-1);
    if (last?.step === step.id) continue;
    // steps reached in a stretch the video leaves out start where it goes on: the last of them is what it shows
```

In `packages/timeline/src/index.ts`, replace:

```ts
  type SceneSpan,
} from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { CHAPTER_SLIP_SECONDS, YOUTUBE_CHAPTERS, chapterTime, stepChapters, youtubeChapters, type Chapter } from './chapters';
export { ZOOM_MOVE_SECONDS, ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt, zoomTargetAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, maskRectAt, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
```

with:

```ts
  type SceneSpan,
} from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { YOUTUBE_CHAPTERS, chapterTime, stepChapters, youtubeChapters, type Chapter } from './chapters';
export { STEP_SLIP_SECONDS, STEP_ZOOM, shownFrom, stepMoves, stepZooms, type StepMove, type StepZoom } from './steps';
export { ZOOM_MOVE_SECONDS, ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt, zoomTargetAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, maskRectAt, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
```

Run: `pnpm exec vitest run --project node packages/timeline`
Expected: PASS (the chapters' tests unchanged).

- [ ] **Step 3: Commit**

```bash
git add packages/timeline
git commit -m "timeline: the take's moves through the script, and a zoom on where each step happens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A template's page shared by the titles

**Files:**
- Modify: `packages/motion-kit/src/files.ts`, `packages/motion-kit/test/kit.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/motion-kit/test/kit.test.ts`, replace:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copyTemplate, MissingTemplateError } from '../src/files';
import { BUILT_IN_SOUNDS, KIT_FONTS, KIT_IMPORTS, KIT_ORIGIN, MOTION_TEMPLATES, MUSIC_TEMPLATES, importMapTag, withImportMap } from '../src/index';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
```

with:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copyTemplate, MissingTemplateError, templatePage } from '../src/files';
import { BUILT_IN_SOUNDS, KIT_FONTS, KIT_IMPORTS, KIT_ORIGIN, MOTION_TEMPLATES, MUSIC_TEMPLATES, importMapTag, withImportMap } from '../src/index';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
```

In the same file, replace:

```ts
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

with:

```ts
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gives the project's page of a template for items that share one: the one there, else a copy", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-kit-'));
    try {
      expect(await templatePage(dir, 'lower-third', import.meta.url)).toBe('motion/lower-third/index.html');
      writeFileSync(join(dir, 'motion', 'lower-third', 'index.html'), 'changed by the person');
      expect(await templatePage(dir, 'lower-third', import.meta.url)).toBe('motion/lower-third/index.html');
      expect(readFileSync(join(dir, 'motion', 'lower-third', 'index.html'), 'utf8')).toBe('changed by the person');
      expect(existsSync(join(dir, 'motion', 'lower-third-2'))).toBe(false);
      expect(await templatePage(dir, 'nope', import.meta.url)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

Run: `pnpm exec vitest run --project node packages/motion-kit/test/kit.test.ts`
Expected: FAIL: there is no `templatePage`.

- [ ] **Step 2: The page there, else a copy**

In `packages/motion-kit/src/files.ts`, replace:

```ts
  await copyFolder(from, join(projectDir, into, folder));
  return `${into}/${folder}/index.html`;
}
```

with:

```ts
  await copyFolder(from, join(projectDir, into, folder));
  return `${into}/${folder}/index.html`;
}

/**
 * The project's page of a template, for items that share one (the script's step titles): its
 * `motion/<template>/index.html` when the project has it already (as the person may have changed
 * it), else a copy of the kit's (`copyTemplate`). Undefined when the kit does not have it.
 */
export async function templatePage(projectDir: string, template: string, bundleUrl: string): Promise<string | undefined> {
  const page = `motion/${template}/index.html`;
  if (await stat(join(projectDir, page)).then((info) => info.isFile(), () => false)) return page;
  return copyTemplate(projectDir, template, template, bundleUrl).catch((error: unknown) => {
    if (error instanceof MissingTemplateError) return undefined;
    throw error;
  });
}
```

Run: `pnpm exec vitest run --project node packages/motion-kit/test/kit.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/motion-kit
git commit -m "motion kit: a template's page in the project, shared by the items that use it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The titles and zooms in `suggest`, the CLI and the app's cut

**Files:**
- Create: `packages/core/src/suggest/steps.ts`, `packages/core/test/steps.test.ts`
- Modify: `packages/core/src/suggest.ts`, `apps/cli/src/commands/suggest.ts`, `apps/cli/src/main.ts`, `apps/cli/test/cli.test.ts`, `apps/desktop/src/workers/media.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/steps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseProject, type Marker } from '@cuttle/project';
import { stepMoves } from '@cuttle/timeline';
import { withStepTitles } from '../src/suggest/steps';

const script = [
  { id: 'step1', title: 'Open the settings' },
  { id: 'step2', title: 'Turn on dark mode', motion: 'lower-third' as const },
  { id: 'step3', title: 'Export the video' },
];
const markers: Marker[] = [
  { t: 0, kind: 'step', label: 'step1' },
  { t: 10, kind: 'step', label: 'step2' },
  { t: 20, kind: 'step', label: 'step3' },
];
// the take from 1 s on; 15 to 30 s sped up 4×
const clips = [
  { from: 1, to: 15, speed: 1, start: 0 },
  { from: 15, to: 30, speed: 4, start: 14 },
];
const project = (raw: Record<string, unknown>) => {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, script, ...raw });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
};
const input = { moves: stepMoves(script, markers), clips, position: 'bottom' as const, make: true };

describe('withStepTitles', () => {
  it('puts a title where the video shows each step reached: a text, or an overlay of its motion template; 3 s of the video each', async () => {
    const raw = { texts: [{ id: 't1', at: 2, duration: 1, text: 'Mine' }] };
    const pages: string[] = [];
    const page = async (template: string) => (pages.push(template), `motion/${template}/index.html`);
    const titles = await withStepTitles(raw, project(raw), { ...input, page }, new Set(['t1']));
    expect(titles.texts).toEqual([
      { id: 't1', at: 2, duration: 1, text: 'Mine' },
      // the take was trimmed to 1 s: the first step's title starts there
      { id: 't2', label: 'Step 1', at: 1, duration: 3, auto: 'title', text: 'Open the settings', style: 'lower-third', position: 'bottom' },
      // sped up 4×: 3 s of the video are 12 s of the take
      { id: 't3', label: 'Step 3', at: 20, duration: 10, auto: 'title', text: 'Export the video', style: 'lower-third', position: 'bottom' },
    ]);
    expect(titles.overlays).toEqual([
      { id: 'o1', label: 'Step 2', at: 10, duration: 4, auto: 'title', src: 'motion/lower-third/index.html', params: { name: 'Turn on dark mode', role: 'Step 2 of 3' } },
    ]);
    expect(pages).toEqual(['lower-third']);
    expect(titles.made).toBe(3);
  });

  it('replaces the titles it made before, keeps one the person switched off off, and makes only texts without the kit', async () => {
    const raw = {
      texts: [
        { id: 't1', at: 1, duration: 3, text: 'Open the settings', auto: 'title', enabled: false },
        { id: 't2', at: 20, duration: 10, text: 'Export the video', auto: 'title' },
      ],
    };
    const titles = await withStepTitles(raw, project(raw), { ...input, page: async () => undefined }, new Set(['t1', 't2']));
    expect(titles.texts!.map((text) => [text.id, text.text, text.enabled])).toEqual([
      ['t3', 'Open the settings', false],
      ['t4', 'Turn on dark mode', undefined],
      ['t5', 'Export the video', undefined],
    ]);
    expect(titles.overlays).toBeUndefined();
    expect(titles.notes[0]).toBe('the motion template lower-third could not be added: those step titles are texts');
    // the kind switched off: the titles made before go, and none is made
    const off = await withStepTitles(raw, project(raw), { ...input, make: false }, new Set());
    expect([off.texts, off.made]).toEqual([[], 0]);
  });
});
```

In `apps/cli/test/cli.test.ts`, replace:

```ts
          "pauses": 0,
          "retakes": 0,
        },
        "written": true,
        "zooms": [
          {
```

with:

```ts
          "pauses": 0,
          "retakes": 0,
        },
        "steps": {
          "reached": 0,
          "titles": 0,
          "zooms": 0,
        },
        "written": true,
        "zooms": [
          {
```

In the same file, replace:

```ts
    expect((without.json as Zooms).zooms.map((zoom) => zoom.label)).not.toContain('Clicks');
  }, 30_000);

  it('replaces only the zooms it made: hand-made ones stay, one switched off stays off, a kind switched off is not made', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
```

with:

```ts
    expect((without.json as Zooms).zooms.map((zoom) => zoom.label)).not.toContain('Clicks');
  }, 30_000);

  it("titles the script's steps and zooms on where they happen; a step's motion template is the kit's page; again, a title switched off stays off", async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    // three steps: clicks in the second, typed in the third (whose title is a lower third)
    writeFileSync(join(dir, 'takes/1/markers.json'), JSON.stringify({ version: 1, markers: [{ t: 3, kind: 'step', label: 'step1' }, { t: 8, kind: 'step', label: 'step2' }, { t: 15, kind: 'step', label: 'step3' }] }));
    const events = [
      ...Array.from({ length: 11 }, (_, i) => ({ t: 3 + i * 0.4, type: 'keys', count: 1 })),
      { t: 8.6, type: 'click', x: 400, y: 300, button: 'left' },
      { t: 9.4, type: 'click', x: 480, y: 340, button: 'left' },
      { t: 15.5, type: 'caret', rect: [900, 600, 2, 20] },
      { t: 16.2, type: 'caret', rect: [960, 600, 2, 20] },
    ].sort((a, b) => a.t - b.t);
    writeFileSync(join(dir, 'takes/1/events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    const path = join(dir, 'cuttle.json');
    const script = [{ id: 'step1', title: 'Open the settings' }, { id: 'step2', title: 'Turn on dark mode' }, { id: 'step3', title: 'Export the video', motion: 'lower-third' }];
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), script }));
    type Result = { steps: { reached: number; titles: number; zooms: number }; zooms: { label?: string; auto?: string; at: number }[]; notes: string[] };
    // the typing's zoom (3 to 8.7 s) would cover step 2's start: a step's zoom keeps clear of another
    const first = await cli('--json', '-C', dir, 'suggest', '--no-click-zooms', '--no-typing-zooms');
    expect(first.code, first.stdout).toBe(0);
    const result = first.json as Result;
    expect(result.steps).toEqual({ reached: 3, titles: 3, zooms: 2 });
    expect(result.zooms.filter((zoom) => zoom.auto === 'step').map((zoom) => [zoom.label, zoom.at])).toEqual([
      ['Step 2', 8],
      ['Step 3', 15],
    ]);
    expect(result.notes).toContain("2 zooms on where the script's steps happen");
    type Saved = { texts: { id: string; text: string; auto?: string; enabled?: boolean }[]; overlays: { src: string; params: Record<string, unknown>; auto?: string }[] };
    const saved = () => JSON.parse(readFileSync(path, 'utf8')) as Saved;
    expect(saved().texts.map((text) => [text.text, text.auto])).toEqual([
      ['Open the settings', 'title'],
      ['Turn on dark mode', 'title'],
    ]);
    expect(saved().overlays).toEqual([expect.objectContaining({ src: 'motion/lower-third/index.html', params: { name: 'Export the video', role: 'Step 3 of 3' }, auto: 'title' })]);
    expect(existsSync(join(dir, 'motion', 'lower-third', 'index.html'))).toBe(true);
    // the second step's title switched off by the person: a new run keeps it off, and the page it had
    const switched = saved();
    switched.texts[1]!.enabled = false;
    writeFileSync(path, JSON.stringify(switched));
    expect((await cli('--json', '-C', dir, 'suggest', '--no-click-zooms', '--no-typing-zooms')).code).toBe(0);
    expect(saved().texts.map((text) => [text.text, text.enabled])).toEqual([
      ['Open the settings', undefined],
      ['Turn on dark mode', false],
    ]);
    expect(existsSync(join(dir, 'motion', 'lower-third-2'))).toBe(false);
    // without titles and step zooms: those made before go
    const none = await cli('--json', '-C', dir, 'suggest', '--no-step-titles', '--no-step-zooms');
    expect((none.json as Result).steps).toEqual({ reached: 3, titles: 0, zooms: 0 });
    expect([saved().texts, saved().overlays]).toEqual([[], []]);
  }, 60_000);

  it('replaces only the zooms it made: hand-made ones stay, one switched off stays off, a kind switched off is not made', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
```

Run: `pnpm exec vitest run --project node packages/core/test/steps.test.ts`
Expected: FAIL: there is no `../src/suggest/steps`.

- [ ] **Step 2: The titles**

`packages/core/src/suggest/steps.ts`:

```ts
// The script's steps as titles: where the video shows each step reached, its title as a text in the
// lower-third style, or as an overlay of the step's motion template. The titles suggest made before
// are replaced; one the person switched off stays off; texts and overlays of their own stay.
import { newId, type CuttleProject, type StepMotion } from '@cuttle/project';
import { shownFrom, type ClipSpan, type StepMove } from '@cuttle/timeline';

/** A step's title shows this many seconds of the video, less when the next step comes sooner. */
export const STEP_TITLE_SECONDS = 3;
/** The motion templates' own lengths (seconds of the video), as the kit adds them. */
export const STEP_MOTION_SECONDS: Record<StepMotion, number> = { 'lower-third': 4, title: 3.5 };
/** A title is not made for a step shown shorter than this (output seconds). */
const MIN_TITLE_SECONDS = 0.8;

type RawItem = Record<string, unknown>;

export interface StepTitlesInput {
  moves: readonly StepMove[];
  /** The new clips, with where each starts in the video. */
  clips: readonly ClipSpan[];
  /** Where the texts go: the top when subtitles take the bottom. */
  position: 'top' | 'bottom';
  /** Make them (the kind is on); off: only the titles made before go. */
  make: boolean;
  /** Copies a motion template into the project for the steps that name one, and gives its page; none: titles as texts. */
  page?: (template: StepMotion) => Promise<string | undefined>;
}

export interface StepTitles {
  /** The file's texts and overlays afterwards; none when nothing changed in them. */
  texts?: RawItem[];
  overlays?: RawItem[];
  made: number;
  notes: string[];
}

/** What a title says, as its item has it: a text's words, an overlay's title param (or the lower third's name). */
const sayOf = (item: { text?: unknown; params?: unknown }) => {
  const params = (item.params ?? {}) as Record<string, unknown>;
  return String(item.text ?? params.title ?? params.name ?? '');
};

/** The steps' titles, in place of those suggest made before (tagged `auto: "title"`). */
export async function withStepTitles(raw: RawItem, project: CuttleProject, input: StepTitlesInput, taken: Set<string>): Promise<StepTitles> {
  const notes: string[] = [];
  const rawTexts = (raw.texts as RawItem[] | undefined) ?? [];
  const rawOverlays = (raw.overlays as RawItem[] | undefined) ?? [];
  const ours = (item: RawItem) => item.auto === 'title';
  // a title switched off by the person: the new one for the same words stays off
  const off = new Set([...project.texts, ...project.overlays].filter((item) => item.auto === 'title' && !item.enabled).map(sayOf));
  const texts: RawItem[] = [];
  const overlays: RawItem[] = [];
  const pages = new Map<StepMotion, string | undefined>();
  const speedAt = (t: number) => input.clips.find((clip) => t >= clip.from && t < clip.to)?.speed ?? 1;
  // no title goes on past the take's last shown second
  const last = Math.max(...input.clips.map((clip) => clip.to));
  const total = project.script.length;
  if (input.make) {
    for (const [i, move] of input.moves.entries()) {
      const at = shownFrom(input.clips, move.t);
      if (at === undefined) continue;
      const next = input.moves.slice(i + 1).map((later) => shownFrom(input.clips, later.t)).find((t): t is number => t !== undefined && t > at) ?? Infinity;
      const motion = move.step.motion;
      if (motion && input.page && !pages.has(motion)) pages.set(motion, await input.page(motion));
      const src = motion ? pages.get(motion) : undefined;
      // seconds of the video, as source seconds where it shows them (a sped-up clip shows more of them)
      const shown = src && motion ? STEP_MOTION_SECONDS[motion] : STEP_TITLE_SECONDS;
      const duration = Math.round(Math.min(shown * speedAt(at), next - at, last - at) * 1000) / 1000;
      if (duration / speedAt(at) < MIN_TITLE_SECONDS) continue;
      const title = move.step.title;
      const common = { label: `Step ${move.number}`, at: Math.round(at * 1000) / 1000, duration, ...(off.has(title) && { enabled: false }), auto: 'title' };
      if (src && motion) {
        const params = motion === 'lower-third' ? { name: title, role: `Step ${move.number} of ${total}` } : { title, eyebrow: `Step ${move.number}`, background: false };
        overlays.push({ id: newId('overlays', taken), ...common, src, params });
      } else {
        texts.push({ id: newId('texts', taken), ...common, text: title, style: 'lower-third', position: input.position });
      }
    }
    const missing = [...pages].filter(([, page]) => page === undefined).map(([motion]) => motion);
    if (missing.length > 0) notes.push(`the motion template${missing.length === 1 ? '' : 's'} ${missing.join(', ')} could not be added: those step titles are texts`);
    if (texts.length + overlays.length > 0) notes.push(`${texts.length + overlays.length} step title${texts.length + overlays.length === 1 ? '' : 's'} from the script`);
  }
  const before = { texts: rawTexts.filter(ours).length, overlays: rawOverlays.filter(ours).length };
  return {
    ...((before.texts > 0 || texts.length > 0) && { texts: [...rawTexts.filter((item) => !ours(item)), ...texts] }),
    ...((before.overlays > 0 || overlays.length > 0) && { overlays: [...rawOverlays.filter((item) => !ours(item)), ...overlays] }),
    made: texts.length + overlays.length,
    notes,
  };
}
```

- [ ] **Step 3: In `suggest`, and its callers**

In `packages/core/src/suggest.ts`, replace:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { newId, parseEventsJsonl, parseProject, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect, type ScreenTextFrame, type TranscriptFile } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
import { areaStretches, bandCrop, cropPieces, type CropStretch } from './suggest/crop';
```

with:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { newId, parseEventsJsonl, parseProject, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect, type ScreenTextFrame, type StepMotion, type TranscriptFile } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks, stepMoves, stepZooms } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
import { areaStretches, bandCrop, cropPieces, type CropStretch } from './suggest/crop';
```

In the same file, replace:

```ts
import { changedRegion, zoomRect } from './suggest/region';
import { union } from './suggest/spans';
import { screenStretches, typingZooms, type ScreenChange } from './suggest/typing';
import { takeClock, transcriptMarkers } from './suggest/transcript';
import { readMarkers, speechActivity, withSpeechCuts, wordStretches } from './speech/apply';
import type { RawCut } from './speech/edits';
```

with:

```ts
import { changedRegion, zoomRect } from './suggest/region';
import { union } from './suggest/spans';
import { screenStretches, typingZooms, type ScreenChange } from './suggest/typing';
import { withStepTitles, type StepTitles } from './suggest/steps';
import { takeClock, transcriptMarkers } from './suggest/transcript';
import { readMarkers, speechActivity, withSpeechCuts, wordStretches } from './speech/apply';
import type { RawCut } from './speech/edits';
```

In the same file, replace:

```ts
  typingZooms?: boolean;
  /** Zooms on dialogs (default true; `zoom: false` turns them off too). */
  dialogZooms?: boolean;
  /** Crops each clip to the content (default true): the window's content area, else the picture's still edges. */
  crop?: boolean;
  /** Masks what the screen showed that is private (default true): its text is read first where it was not yet. */
```

with:

```ts
  typingZooms?: boolean;
  /** Zooms on dialogs (default true; `zoom: false` turns them off too). */
  dialogZooms?: boolean;
  /** A zoom on where each step of the script happens (default true; `zoom: false` turns them off too). */
  stepZooms?: boolean;
  /** A title where the video shows each step of the script reached (default true). */
  stepTitles?: boolean;
  /**
   * Copies a motion template into the project for the step titles that name one (`script[].motion`)
   * and gives its page (`motion/<name>/index.html`); without it, those titles are texts too.
   */
  motionPage?: (template: StepMotion) => Promise<string | undefined>;
  /** Crops each clip to the content (default true): the window's content area, else the picture's still edges. */
  crop?: boolean;
  /** Masks what the screen showed that is private (default true): its text is read first where it was not yet. */
```

In the same file, replace:

```ts
  speech: { from: 'transcript' | 'mic' | 'none'; fillers: number; pauses: number; retakes: number };
  /** Whether the screen's text was there to mask from, and how many privacy and notification masks were made. */
  privacy: { read: boolean; masks: number; notifications: number };
  /** With `length`: the asked length, the video's length before and after the fit, and whether it fits. */
  length?: { target: number; before: number; length: number; reached: boolean };
  notes: string[];
```

with:

```ts
  speech: { from: 'transcript' | 'mic' | 'none'; fillers: number; pauses: number; retakes: number };
  /** Whether the screen's text was there to mask from, and how many privacy and notification masks were made. */
  privacy: { read: boolean; masks: number; notifications: number };
  /** The script's steps the take reached, and the titles and zooms made for them. */
  steps: { reached: number; titles: number; zooms: number };
  /** With `length`: the asked length, the video's length before and after the fit, and whether it fits. */
  length?: { target: number; before: number; length: number; reached: boolean };
  notes: string[];
```

In the same file, replace:

```ts
  }
  // The zooms suggest made before are replaced; the others stay, and the new ones avoid them.
  const rawZooms = (file.raw.zooms as SuggestedZoom[] | undefined) ?? [];
  const isOurs = (zoom: { auto?: string }) => zoom.auto === 'answer' || zoom.auto === 'dialog' || zoom.auto === 'typing' || zoom.auto === 'click';
  const kept = rawZooms.filter((zoom) => !isOurs(zoom));
  const switchedOff = file.project.zooms.filter((zoom) => isOurs(zoom) && !zoom.enabled);
  if (kept.length > 0) notes.push(`kept ${kept.length} zoom${kept.length === 1 ? '' : 's'} made or changed by hand`);
  const zooms: SuggestedZoom[] = [];
  const add = (zoom: SuggestedZoom & { auto: 'answer' | 'dialog' | 'typing' | 'click' }) => zooms.push(staysOff(zoom, switchedOff) ? { ...zoom, enabled: false } : zoom);
  const first = suggestion.clips[0];
  const last = suggestion.clips.at(-1);
  const keptOverlaps = (at: number, end: number) => kept.some((zoom) => at < zoom.at + zoom.duration && zoom.at < end);
```

with:

```ts
  }
  // The zooms suggest made before are replaced; the others stay, and the new ones avoid them.
  const rawZooms = (file.raw.zooms as SuggestedZoom[] | undefined) ?? [];
  const isOurs = (zoom: { auto?: string }) => zoom.auto === 'answer' || zoom.auto === 'dialog' || zoom.auto === 'typing' || zoom.auto === 'click' || zoom.auto === 'step';
  const kept = rawZooms.filter((zoom) => !isOurs(zoom));
  const switchedOff = file.project.zooms.filter((zoom) => isOurs(zoom) && !zoom.enabled);
  if (kept.length > 0) notes.push(`kept ${kept.length} zoom${kept.length === 1 ? '' : 's'} made or changed by hand`);
  const zooms: SuggestedZoom[] = [];
  const add = (zoom: SuggestedZoom & { auto: 'answer' | 'dialog' | 'typing' | 'click' | 'step' }) => zooms.push(staysOff(zoom, switchedOff) ? { ...zoom, enabled: false } : zoom);
  const first = suggestion.clips[0];
  const last = suggestion.clips.at(-1);
  const keptOverlaps = (at: number, end: number) => kept.some((zoom) => at < zoom.at + zoom.duration && zoom.at < end);
```

In the same file, replace:

```ts
      );
    }
  }
  if (args.zoom !== false && args.clickZooms !== false && file.project.autoEdits.clickZooms && events.length > 0) {
    const there = [...kept, ...zooms];
    const followed = clickZooms(events, shown, screenInfo, there);
```

with:

```ts
      );
    }
  }
  // The script's steps: one zoom each on where it happens, before the clicks' zooms, which keep clear of them
  const moves = stepMoves(file.project.script, markers);
  let stepped = 0;
  if (args.zoom !== false && args.stepZooms !== false && file.project.autoEdits.stepZooms && moves.length > 0) {
    for (const zoom of stepZooms(moves, events, shown, screenInfo, [...kept, ...zooms])) {
      add({ id: newId('zooms', taken), label: `Step ${zoom.move.number}`, at: zoom.at, duration: zoom.duration, rect: zoom.rect, auto: 'step' });
      stepped++;
    }
    if (stepped > 0) notes.push(`${stepped} zoom${stepped === 1 ? '' : 's'} on where the script's steps happen`);
  }
  if (args.zoom !== false && args.clickZooms !== false && file.project.autoEdits.clickZooms && events.length > 0) {
    const there = [...kept, ...zooms];
    const followed = clickZooms(events, shown, screenInfo, there);
```

In the same file, replace:

```ts
    if (text?.made) file.raw.sources = { ...(file.raw.sources as object), screenText: text.made };
  }

  const allZooms = [...kept, ...zooms].sort((a, b) => a.at - b.at);
  // The length fit, last: what rests goes until the video fits, around the cuts and zooms made above.
  let length: SuggestResult['length'];
```

with:

```ts
    if (text?.made) file.raw.sources = { ...(file.raw.sources as object), screenText: text.made };
  }

  // The steps' titles, where the video shows each step reached (at the top when subtitles take the bottom)
  let titles: StepTitles | undefined;
  if (moves.length > 0 || [...file.project.texts, ...file.project.overlays].some((item) => item.auto === 'title')) {
    const position = sources.transcript !== undefined && file.project.captions.enabled ? 'top' : 'bottom';
    const make = args.stepTitles !== false && file.project.autoEdits.stepTitles;
    titles = await withStepTitles(file.raw, file.project, { moves, clips: shown, position, make, ...(args.motionPage && !args.dryRun && { page: args.motionPage }) }, taken);
    notes.push(...titles.notes);
  }

  const allZooms = [...kept, ...zooms].sort((a, b) => a.at - b.at);
  // The length fit, last: what rests goes until the video fits, around the cuts and zooms made above.
  let length: SuggestResult['length'];
```

In the same file, replace:

```ts
    file.raw.zooms = allZooms;
    if (cuts && (cuts.length > 0 || file.raw.cuts !== undefined)) file.raw.cuts = cuts;
    if (masks) file.raw.masks = masks;
    if (words.length > file.project.privacy.words.length) file.raw.privacy = { ...(file.raw.privacy as object), words };
    ({ backup } = await writeProjectFile(file, 'suggest', { backup: true }));
  }
```

with:

```ts
    file.raw.zooms = allZooms;
    if (cuts && (cuts.length > 0 || file.raw.cuts !== undefined)) file.raw.cuts = cuts;
    if (masks) file.raw.masks = masks;
    if (titles?.texts) file.raw.texts = titles.texts;
    if (titles?.overlays) file.raw.overlays = titles.overlays;
    if (words.length > file.project.privacy.words.length) file.raw.privacy = { ...(file.raw.privacy as object), words };
    ({ backup } = await writeProjectFile(file, 'suggest', { backup: true }));
  }
```

In the same file, replace:

```ts
    ...(cuts && { cuts }),
    speech: { from: speech.from, ...made },
    privacy,
    ...(length && { length }),
    notes,
    markers: { from, count: markers.length },
```

with:

```ts
    ...(cuts && { cuts }),
    speech: { from: speech.from, ...made },
    privacy,
    steps: { reached: moves.length, titles: titles?.made ?? 0, zooms: stepped },
    ...(length && { length }),
    notes,
    markers: { from, count: markers.length },
```

In `apps/cli/src/commands/suggest.ts`, replace:

```ts
import { suggestProject, type SuggestOptions, type SuggestResult } from '@cuttle/core';
import type { Output } from '../output';
import { percentSteps } from './transcribe';
```

with:

```ts
import { suggestProject, type SuggestOptions, type SuggestResult } from '@cuttle/core';
import { templatePage } from '@cuttle/motion-kit/files';
import type { Output } from '../output';
import { percentSteps } from './transcribe';
```

In the same file, replace:

```ts
 * sped up, speech kept), zooms on Claude's answer and the clicks, and cuts for filler words and
 * pauses, written to cuttle.json (see @cuttle/core's suggestProject).
 */
export async function suggestCommand(projectDir: string, args: Omit<SuggestOptions, 'onStatus' | 'onProgress'>, output: Output): Promise<SuggestResult> {
  const result = await suggestProject(projectDir, {
    ...args,
    onStatus: (text) => output.info(text),
    onProgress: percentSteps((percent) => output.info(`transcribing … ${percent} %`)),
  });
```

with:

```ts
 * sped up, speech kept), zooms on Claude's answer and the clicks, and cuts for filler words and
 * pauses, written to cuttle.json (see @cuttle/core's suggestProject).
 */
export async function suggestCommand(projectDir: string, args: Omit<SuggestOptions, 'onStatus' | 'onProgress' | 'motionPage'>, output: Output): Promise<SuggestResult> {
  const result = await suggestProject(projectDir, {
    ...args,
    // a step title in a motion template (the script's `motion`): the kit's page next to the CLI
    motionPage: (template) => templatePage(projectDir, template, import.meta.url),
    onStatus: (text) => output.info(text),
    onProgress: percentSteps((percent) => output.info(`transcribing … ${percent} %`)),
  });
```

In `apps/cli/src/main.ts`, replace:

```ts

  program
    .command('suggest')
    .description('propose scenes (quiet start and end trimmed, idle cut, waiting sped up, cropped to the content), a zoom on the answer, zooms on dialogs, zooms that follow typing and zooms on clicks')
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer, nor on dialogs, nor on typing, nor on clicks)')
    .option('--no-crop', 'no crop to the content (a browser\'s page without its tabs and bars)')
```

with:

```ts

  program
    .command('suggest')
    .description("propose scenes (quiet start and end trimmed, idle cut, waiting sped up, cropped to the content), a zoom on the answer, zooms on dialogs, zooms that follow typing and zooms on clicks, and the script's steps' titles and zooms")
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer, nor on dialogs, nor on typing, nor on clicks)')
    .option('--no-crop', 'no crop to the content (a browser\'s page without its tabs and bars)')
```

In the same file, replace:

```ts
    .option('--no-dialog-zooms', 'no zooms on dialogs')
    .option('--no-typing-zooms', 'no zooms that follow typing')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-speech', 'leave the speech out: no filler, pause or spoken retake cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--length <seconds>', 'fit the video to this length: what rests is cut, never speech, clicks or typing', positive)
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, { mask, ...options }: { claude?: string | true; zoom: boolean; crop: boolean; privacy: boolean; mask: string[]; dialogZooms: boolean; typingZooms: boolean; clickZooms: boolean; speech: boolean; transcribe: boolean; length?: number; dryRun?: boolean }) =>
        suggestCommand(project, { ...options, ...(mask.length > 0 && { maskWords: mask }) }, output),
      ),
    );
```

with:

```ts
    .option('--no-dialog-zooms', 'no zooms on dialogs')
    .option('--no-typing-zooms', 'no zooms that follow typing')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-step-zooms', "no zooms on where the script's steps happen")
    .option('--no-step-titles', "no titles for the script's steps")
    .option('--no-speech', 'leave the speech out: no filler, pause or spoken retake cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--length <seconds>', 'fit the video to this length: what rests is cut, never speech, clicks or typing', positive)
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, { mask, ...options }: { claude?: string | true; zoom: boolean; crop: boolean; privacy: boolean; mask: string[]; dialogZooms: boolean; typingZooms: boolean; clickZooms: boolean; stepZooms: boolean; stepTitles: boolean; speech: boolean; transcribe: boolean; length?: number; dryRun?: boolean }) =>
        suggestCommand(project, { ...options, ...(mask.length > 0 && { maskWords: mask }) }, output),
      ),
    );
```

In `apps/desktop/src/workers/media.ts`, replace:

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { applyLengthFit, applyPrivacy, applySpeechEdits, ffmpegPath, probeScreen, readScreenTake, streamSeconds, suggestProject, transcribeTake } from '@cuttle/core';
import {
  PEAKS_SAMPLE_RATE,
  PeakFolder,
```

with:

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { applyLengthFit, applyPrivacy, applySpeechEdits, ffmpegPath, probeScreen, readScreenTake, streamSeconds, suggestProject, transcribeTake } from '@cuttle/core';
import { templatePage } from '@cuttle/motion-kit/files';
import {
  PEAKS_SAMPLE_RATE,
  PeakFolder,
```

In the same file, replace:

```ts
    case 'suggest': {
      // the app transcribes after the cut, as a step of its own (`transcribe`, `speech-edits`); the
      // screen's text is read in a step of its own too (P4-M5b): the cut leaves the privacy masks be
      await suggestProject(job.input, { transcribe: false, privacy: false, onStatus: () => reply({ id, progress: 0 }) });
      return undefined;
    }
    case 'transcribe': {
```

with:

```ts
    case 'suggest': {
      // the app transcribes after the cut, as a step of its own (`transcribe`, `speech-edits`); the
      // screen's text is read in a step of its own too (P4-M5b): the cut leaves the privacy masks be
      // a step title in a motion template (the script's `motion`) takes the kit's page next to this bundle
      const motionPage = (template: string) => templatePage(job.input, template, import.meta.url);
      await suggestProject(job.input, { transcribe: false, privacy: false, motionPage, onStatus: () => reply({ id, progress: 0 }) });
      return undefined;
    }
    case 'transcribe': {
```

Run: `pnpm exec vitest run --project node packages/core apps/cli/test/cli.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core apps/cli apps/desktop/src/workers/media.ts
git commit -m "suggest: a title and a zoom for each step of the script the take reached; cuttle suggest --no-step-titles --no-step-zooms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The check and the guides

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`, `README.md`, `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`

- [ ] **Step 1: The check**

After the take recorded with a script, the cut has titled step 2, and the Auto tab lists "Step titles":

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    await expect.poll(() => opened.evaluate(() => (window as unknown as { __cuttleCheck: Check }).__cuttleCheck.doc().undo), { timeout: 15_000 }).toBe("Cuttle's cut");
    await expect.poll(() => opened.locator('.flag span').allTextContents(), { timeout: 15_000 }).toContain('2 · Turn on dark mode');
    await shotOf('47b-step-pins', '/editor.html', `${basename(dir)} · Cuttle`);
    // Record again, once the take is in: the picker opens with the project's script
    await expect.poll(() => opened.locator('[data-testid=project-status]').count(), { timeout: 30_000 }).toBe(0);
    await click(opened, '[data-testid=record-again]');
```

with:

```ts
    await expect.poll(() => opened.evaluate(() => (window as unknown as { __cuttleCheck: Check }).__cuttleCheck.doc().undo), { timeout: 15_000 }).toBe("Cuttle's cut");
    await expect.poll(() => opened.locator('.flag span').allTextContents(), { timeout: 15_000 }).toContain('2 · Turn on dark mode');
    await shotOf('47b-step-pins', '/editor.html', `${basename(dir)} · Cuttle`);
    // the cut titled the steps the video shows: a title over step 2, listed in the Auto tab
    const titled = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { texts?: { text: string; auto?: string }[] };
    expect(titled.texts?.filter((text) => text.auto === 'title').map((text) => text.text)).toContain('Turn on dark mode');
    await click(opened, '#tab-auto');
    await opened.waitForSelector('[data-testid=auto-group-titles]');
    await click(opened, '[data-testid=auto-group-titles] .auto-toggle');
    await shotOf('47c-step-titles', '/editor.html', `${basename(dir)} · Cuttle`);
    await click(opened, '#tab-selection');
    // Record again, once the take is in: the picker opens with the project's script
    await expect.poll(() => opened.locator('[data-testid=project-status]').count(), { timeout: 30_000 }).toBe(0);
    await click(opened, '[data-testid=record-again]');
```

Run: `pnpm app:check`
Expected: PASS, 56 tests.

- [ ] **Step 2: The guides**

In `README.md`, replace:

```markdown
the demo (a title each, and what to say; a pasted list becomes steps). While recording, a prompter
by the HUD shows the step now, its note and the step after it, never in the video:
Ctrl+Shift+Alt+N (or Next) goes on, Ctrl+Shift+Alt+B back, each step is a marker of the take, and
the script is kept in the project for the next take. The export puts the steps into the video as
its chapters (players list them), and its sheet lists them to copy into a YouTube description.
Pause (the HUD, or Ctrl+Shift+Alt+P)
records nothing until you resume; the pieces are joined at the stop. Restart is a held press: the
take is put aside, the countdown starts again, and the editor offers "Undo restart". The editor
```

with:

```markdown
the demo (a title each, and what to say; a pasted list becomes steps). While recording, a prompter
by the HUD shows the step now, its note and the step after it, never in the video:
Ctrl+Shift+Alt+N (or Next) goes on, Ctrl+Shift+Alt+B back, each step is a marker of the take, and
the script is kept in the project for the next take. Cuttle's cut titles each step (a caption, or
a lower third or title from the motion kit) and zooms on where it happens, listed in the Auto tab.
The export puts the steps into the video as its chapters (players list them), and its sheet lists
them to copy into a YouTube description.
Pause (the HUD, or Ctrl+Shift+Alt+P)
records nothing until you resume; the pieces are joined at the stop. Restart is a held press: the
take is put aside, the countdown starts again, and the editor offers "Undo restart". The editor
```

In `skill/cuttle/SKILL.md`, replace:

```markdown
`--no-crop` leaves it out). It zooms on Claude's answer, on a dialog while it is open ("Dialog";
`--no-dialog-zooms`), in where someone types, following the text along ("Typing": the camera
moves on as the text leaves the middle of the view; `--no-typing-zooms`), and where clicks
happen at normal speed ("Click", "Clicks"; `--no-click-zooms`; `--no-zoom` leaves out every zoom). Its `notes` say what it did, in
source seconds. It replaces every clip and the zooms it made before (tagged `auto`; masks, texts,
cuts, stills, cards and zooms made by hand stay), so run it once, before your hand edits. Its clips and zooms have ids, and labels where Claude's markers say
what they show ("Claude at work", "Answer"): keep them when you edit, and give items you add an
```

with:

```markdown
`--no-crop` leaves it out). It zooms on Claude's answer, on a dialog while it is open ("Dialog";
`--no-dialog-zooms`), in where someone types, following the text along ("Typing": the camera
moves on as the text leaves the middle of the view; `--no-typing-zooms`), and where clicks
happen at normal speed ("Click", "Clicks"; `--no-click-zooms`; `--no-zoom` leaves out every zoom).
With a script, it titles each step where the video shows it (a text, or the step's `motion`
template; `--no-step-titles`) and zooms on where each step happens ("Step 2"; `--no-step-zooms`),
before the clicks' zooms. Its `notes` say what it did, in
source seconds. It replaces every clip and the zooms it made before (tagged `auto`; masks, texts,
cuts, stills, cards and zooms made by hand stay), so run it once, before your hand edits. Its clips and zooms have ids, and labels where Claude's markers say
what they show ("Claude at work", "Answer"): keep them when you edit, and give items you add an
```

In `skill/cuttle/project.md`, replace:

```markdown
Ctrl+Shift+Alt+B) or the prompter's buttons move on, and each move is a `step` marker. The video's
chapters come from these markers: one where the video shows each step reached (a move undone
within 2 s is none; a step in a stretch that is cut starts where the video goes on), the first at
0, each named by its step's title. Fixing a title in `script` renames its chapter.

`look` (every field is optional):
```

with:

```markdown
Ctrl+Shift+Alt+B) or the prompter's buttons move on, and each move is a `step` marker. The video's
chapters come from these markers: one where the video shows each step reached (a move undone
within 2 s is none; a step in a stretch that is cut starts where the video goes on), the first at
0, each named by its step's title. Fixing a title in `script` renames its chapter. `motion`
(optional: `lower-third` or `title`) draws the step's title with that template of the kit, as an
overlay; without it the title is a text. `suggest` makes the titles and a zoom on where each step
happens (below).

`look` (every field is optional):
```

In the same file, replace:

```markdown
`enabled` (`true`); `duration` (`0.8`, up to 4 s) is around the cut, half before and half after,
also with the look's crossfades off. [motion.md](motion.md) has how such a page is written.

**Automatic items.** Cuttle tags what it makes on its own with `auto` (on a zoom, mask, cut or a
clip's `crop`): `answer` and `click` zooms from `suggest`, and later `crop`, `privacy`,
`notification`, `retake`, `filler`, `pause`, `length`, `typing` and `dialog`. A rerun replaces
only tagged items. **When you change a tagged item's time, place or size, remove its `auto`**: then
it is yours and the next `suggest` keeps it (switching it on or off keeps the tag). `autoEdits`
(`clickZooms`, `answerZoom`, `crop`, `privacy`, `retakes`, `fillers`, `pauses`, `typingZooms`,
`dialogZooms`: all `true`) holds which kinds are made at all; one set to `false` is not made again.

## Music and sounds
```

with:

```markdown
`enabled` (`true`); `duration` (`0.8`, up to 4 s) is around the cut, half before and half after,
also with the look's crossfades off. [motion.md](motion.md) has how such a page is written.

**Automatic items.** Cuttle tags what it makes on its own with `auto` (on a zoom, mask, cut, text,
overlay or a clip's `crop`): `answer` and `click` zooms from `suggest`, and later `crop`, `privacy`,
`notification`, `retake`, `filler`, `pause`, `length`, `typing` and `dialog`; `title` (a
step's title: a text, or an overlay of its `motion` template) and `step` (a zoom on where a step
happens) from the script. A rerun replaces
only tagged items. **When you change a tagged item's time, place or size, remove its `auto`**: then
it is yours and the next `suggest` keeps it (switching it on or off keeps the tag). `autoEdits`
(`clickZooms`, `answerZoom`, `crop`, `privacy`, `retakes`, `fillers`, `pauses`, `typingZooms`,
`dialogZooms`, `stepTitles`, `stepZooms`: all `true`) holds which kinds are made at all; one set
to `false` is not made again.

## Music and sounds
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/app.check.test.ts README.md skill
git commit -m "check and docs: the steps' titles and zooms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 933 passed and 77 skipped (where a speech model is found, its real transcription runs too: 934 and 76; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 15 tests.

Run: `pnpm app:check`
Expected: PASS, 56 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Record a take with a script of three steps, with a click or some typing in each. In the editor, each step has a title over its start (Caption lane, "Step 1" …) and a zoom where it happens, listed in the Auto tab as "Step titles" and "Zooms on steps".
2. Give a step `"motion": "lower-third"` in `cuttle.json` and run Cuttle's cut again (Auto tab, or `cuttle suggest`): its title is the kit's lower third with "Step 2 of 3"; `"title"` makes it the big kinetic title.
3. Switch one title off in the Auto tab and cut again: it stays off.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- The three kinds of title were also rendered once with `cuttle preview` on a project of three steps (a text, the lower third, the kinetic title over the clip) and looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **The last step's title ran past the take's end** (3 s of a 4× clip are 12 s of the take, where 10 were left). It ends at the last shown second now.
- **A step's zoom kept clear of the typing's zoom over its start**, as it should. The suggest check switches the typing zooms off to see the step zooms alone.
- **The first `suggest` check's snapshot** gained the result's new `steps`.

**Flaky, and not this milestone's**
- **Two more `pnpm test` runs** on a busy machine had timing failures in code this milestone does not touch. In one, four tests ran past their 5 s limit: the document's random edits, the palette, the audio plan and a recorder stop. In the other, the recorder's pause test ran 5.56 s (it allows 5.5), and a recorder stop came before its screen track had started.
- The recorder's tests passed again on their own (18 of 18). The document test takes as long as on `main` (886 against 903 ms).

**Spec points that move**
- None: P5-M3 is complete (M3a, M3b, M3c). Next on the roadmap: **P5-M4** (live captions in the HUD, with a mic level).

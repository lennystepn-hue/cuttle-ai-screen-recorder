# Cuttle P5-M3a: the Script and the Prompter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A demo's steps, written before the take, guide the person through it:
- **The script** is part of the project: a title for each step (what it shows), and what to say. It is typed in the recording picker (a pasted list becomes steps), or written by Claude into `cuttle.json`.
- **While recording, a prompter** by the HUD shows the step now, its note and the step after it. It is never in the video.
- **Ctrl+Shift+Alt+N** (or the prompter's Next) moves to the next step, Ctrl+Shift+Alt+B back. Each move is a `step` marker of the take, which M3b turns into chapters, captions and zoom points.

**Architecture:**
- **`@cuttle/project`:** `script: [{ id, title, note? }]` in `cuttle.json`; the marker kind `step`, labelled with the step's id; `usedIds` counts the steps' ids.
- **`@cuttle/recorder`:** `RecordOptions.steps` (the step ids in order). The take starts at the first; `Recording.next()` and `previous()` and the step keys (`HotkeyAction` `next` and `previous`) move through them.
- **The CLI:** `cuttle record` records with the project's script and prints each step as the take reaches it.
- **The app:**
  - The recorder host passes a step request on.
  - The prompter is an overlay window of its own (`prompter.html`, `main/prompter.ts`), opened with the HUD, which follows the take's `step` markers.
  - The picker's bar gets a Script item with a panel (`Script.tsx`). Every display's picker edits the one script the main process keeps for the pick.
  - The take writes the script it recorded with into `cuttle.json`.
  - The timeline names a step's marker by the step.

**Tech Stack:** TypeScript strict, zod 4, React 19, Electron 44.7.2, uiohook-napi.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-roadmap-p4-p6.md` (P5-M3: "steps written before the take (or by Claude from the project). During the take they show in a window that is never recorded, and a hotkey moves to the next step"). M3b makes the steps chapters, captions and zoom points. Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m2c-frames-watermark.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m3a`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The full `pnpm test` and the typecheck run in Task 6.

## Decisions made while planning

A prototype of the milestone, checked against the roadmap, settled these points. The finished prototype passed `pnpm test` (917 tests, 75 skipped, in two full runs), the typecheck, `app:check` (55 tests) and `cli:check` (14). Every screenshot was looked at.

- **The script lives in the project:**
  - It is `cuttle.json`'s `script`, so Claude can write it and "Record again" records with it again.
  - A step is an `id`, a `title` (up to 80 characters) and an optional `note` (up to 1000); a script has at most 50 steps.
  - A step's id is unique in the project, as an item's is. The `step` markers name the step by its id, so a title fixed after the take still belongs to its marker.
  - The steps are not one of the editor's item lists (`IdList`), but `usedIds` counts their ids, so no new item takes one.
- **The step keys:**
  - Ctrl+Shift+Alt+N goes to the next step, Ctrl+Shift+Alt+B back, in both input hooks (uiohook on Windows, the event tap on macOS).
  - The take starts at the first step: its marker is at 0. At either end a key does nothing; before the screen track runs, and without a script, too.
  - While paused, a move is marked where the take paused, as a manual marker is.
- **The prompter is a window of its own,** by the HUD:
  - It is as wide as the HUD and sits right under it, or right over it when the HUD sits in the lower half of its display.
  - It is never in the video (content protection), never takes the focus, and can be moved; its area joins the HUD's as a dead zone for the input log.
  - It shows from the countdown on, so the first step can be read before the take runs; its buttons work once it does.
  - Its height follows its content (between 96 and 480 DIP). It sets its content bounds, since at 125 % a frameless window's outer bounds are a pixel more than its content.
  - Its moves are not the person's markers: the HUD counts neither them nor the slips.
- **The picker's Script:**
  - An item in the bar ("3 steps", or "none"; the key P) opens a panel by the bar: under it, or over it in the lower half of the display.
  - A row per step: the title, and under it what to say. Enter in a title goes on to the next step (a new one at the end); Backspace in an empty one removes it; a pasted list becomes steps (a list's numbers and bullets dropped, an indented line the note of the step above it).
  - Esc closes the panel, not the pick, and the picker's keys stay out of the panel's fields.
  - Every display's picker edits the one script the main process keeps for the pick.
- **Which script a pick starts from:**
  - "Record again" starts from the project's script; a new recording from an empty one.
  - A script typed for a pick that was cancelled comes back at the next pick of that project, unless the project's script changed meanwhile (Claude wrote one): then the project's wins.
  - Once a take runs with it, it is the project's. Steps without a title are left out, and an id another item has gets the next free `step<n>`. It is written into `cuttle.json` with the take, also for a take that had to be recovered.
- **`cuttle record` records with the project's script** and prints `step 2/5: <title>` as the take reaches each step. It opens no prompter: the skill tells Claude to list the steps for the user before the take, and that the app's "Record again" shows them in the prompter.
- **The timeline** pins a step's marker in Cuttle's accent, named by its number and title in the script ("2 · Open the settings"), or by its id when the script lost it.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/{schema,markers,ids,index}.ts` | the script, the `step` marker, its ids |
| `packages/recorder/src/{types,input,record}.ts` | the step keys and the step markers |
| `apps/cli/src/commands/record.ts` | `cuttle record` with the project's script |
| `apps/desktop/src/shared/{recording,ipc,channels,timeline-model}.ts` | the script's types, the prompter's place, a pasted list, the take's ids; the channels; the step pins |
| `apps/desktop/src/main/{prompter,recording,recorder-host}.ts`, `apps/desktop/src/workers/recorder.ts` | the prompter window, the pick's script, the step request |
| `apps/desktop/src/preload/prompter.ts`, `apps/desktop/src/renderer/prompter.html`, `apps/desktop/src/renderer/picker/{Prompter,prompter-main,Script,Picker}.tsx`, `apps/desktop/src/renderer/picker/picker.css`, `apps/desktop/scripts/build.mjs`, `apps/desktop/vite.renderer.config.ts` | the prompter's page, the picker's Script |
| `apps/desktop/src/renderer/editor/Timeline.tsx` | the step pin's colour |
| `README.md`, `skill/cuttle/{SKILL,project}.md` | the guides |

---

### Task 1: The script and the step marker in the project

**Files:**
- Modify: `packages/project/src/schema.ts`, `packages/project/src/markers.ts`, `packages/project/src/ids.ts`, `packages/project/src/index.ts`, `packages/project/test/schema.test.ts`, `packages/project/test/ids.test.ts`, `apps/desktop/src/renderer/editor/Timeline.tsx`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m3a`; work there:

```bash
git switch p5-m3a
```

- [ ] **Step 2: Write the failing tests**

In `packages/project/test/schema.test.ts`, replace:

```ts
    ]);
  });

  it('rejects unknown keys and names them', () => {
    const r = ProjectSchema.safeParse({ ...minimal, look: { frame: { foo: 1 } } });
    expect(r.success).toBe(false);
```

with:

```ts
    ]);
  });

  it('reads a script: steps with an id, a title and a note, each id unique in the project', () => {
    expect(ProjectSchema.parse(minimal).script).toEqual([]);
    const steps = [{ id: 'step1', title: 'Open the settings', note: 'The gear, top right.' }, { id: 'step2', title: 'Turn on dark mode' }];
    expect(ProjectSchema.parse({ ...minimal, script: steps }).script).toEqual(steps);
    expect(pathsOf({ ...minimal, script: [{ title: 'No id' }] })).toEqual(['script.0.id']);
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: '   ' }] })).toEqual(['script.0.title']);
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: 'x'.repeat(81) }] })).toEqual(['script.0.title']);
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: 'Go', note: 'x'.repeat(1001) }] })).toEqual(['script.0.note']);
    expect(pathsOf({ ...minimal, script: Array.from({ length: 51 }, (_, i) => ({ id: `step${i + 1}`, title: 'Go' })) })).toEqual(['script']);
    const twice = ProjectSchema.safeParse({ ...minimal, scenes: [{ type: 'clip', id: 'step1', from: 0, to: 1 }], script: [{ id: 'step1', title: 'Go' }] });
    expect(twice.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([['script.0.id', 'the id "step1" is already used by scenes[0]']]);
  });

  it('rejects unknown keys and names them', () => {
    const r = ProjectSchema.safeParse({ ...minimal, look: { frame: { foo: 1 } } });
    expect(r.success).toBe(false);
```

In `packages/project/test/ids.test.ts`, replace:

```ts
    };
    expect([...usedIds(raw)]).toEqual(['s1', 'answer']);
    expect([...usedIds({ ...raw, sounds: [{ id: 'a1' }, { sound: 'pop' }] })]).toEqual(['s1', 'answer', 'a1']);
    expect(usedIds({})).toEqual(new Set());
  });
});
```

with:

```ts
    };
    expect([...usedIds(raw)]).toEqual(['s1', 'answer']);
    expect([...usedIds({ ...raw, sounds: [{ id: 'a1' }, { sound: 'pop' }] })]).toEqual(['s1', 'answer', 'a1']);
    // the script's steps (their ids are given when a take records with them)
    expect([...usedIds({ ...raw, script: [{ id: 'step1', title: 'Go' }] })]).toEqual(['s1', 'answer', 'step1']);
    expect(usedIds({})).toEqual(new Set());
  });
});
```

Run: `pnpm exec vitest run --project node packages/project`
Expected: FAIL: the project has no `script`, and `usedIds` skips it.

- [ ] **Step 3: The script, the `step` marker, its ids**

In `packages/project/src/schema.ts`, replace:

```ts
  enabled: z.boolean().default(true),
});

export const ProjectSchema = z
  .strictObject({
    version: z.literal(CURRENT_VERSION),
    output: OutputSchema.prefault({}),
    sources: SourcesSchema,
    look: LookSchema.prefault({}),
    scenes: z.array(SceneSchema).default([]),
    zooms: z.array(ZoomSchema).default([]),
```

with:

```ts
  enabled: z.boolean().default(true),
});

/** A step's title is a few words (the prompter's heading); its note a few sentences; a script holds this many steps. */
export const STEP_TITLE_MAX = 80;
export const STEP_NOTE_MAX = 1000;
export const SCRIPT_MAX_STEPS = 50;

/**
 * A step of the script: what the person shows next, written before the take. While recording, the
 * prompter (a window that is never in the video) shows it, and the step key marks where it starts
 * (a `step` marker labelled with its id).
 */
const StepSchema = z.strictObject({
  /** The `step` markers name it; unique in the project. */
  id: z.string().regex(ID_PATTERN, 'an id is 1 to 64 letters, digits, "-" or "_"'),
  /** What it shows, in a few words. */
  title: z.string().max(STEP_TITLE_MAX).regex(/\S/, 'a step needs a title'),
  /** What to say or do: for the prompter only, never in the video. */
  note: z.string().max(STEP_NOTE_MAX).optional(),
});

export const ProjectSchema = z
  .strictObject({
    version: z.literal(CURRENT_VERSION),
    output: OutputSchema.prefault({}),
    sources: SourcesSchema,
    script: z.array(StepSchema).max(SCRIPT_MAX_STEPS).default([]),
    look: LookSchema.prefault({}),
    scenes: z.array(SceneSchema).default([]),
    zooms: z.array(ZoomSchema).default([]),
```

In the same file, replace:

```ts
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
    const seen = new Map<string, string>();
    for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts', 'sounds'] as const) {
      project[list].forEach((item: { id?: string }, index) => {
        if (item.id === undefined) return;
        const first = seen.get(item.id);
```

with:

```ts
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
    const seen = new Map<string, string>();
    for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts', 'sounds', 'script'] as const) {
      project[list].forEach((item: { id?: string }, index) => {
        if (item.id === undefined) return;
        const first = seen.get(item.id);
```

In the same file, replace:

```ts
export type SceneTransition = NonNullable<Scene['transition']>;
export type Music = NonNullable<CuttleProject['music']>;
export type Sound = CuttleProject['sounds'][number];
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
```

with:

```ts
export type SceneTransition = NonNullable<Scene['transition']>;
export type Music = NonNullable<CuttleProject['music']>;
export type Sound = CuttleProject['sounds'][number];
export type ScriptStep = CuttleProject['script'][number];
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
```

In `packages/project/src/markers.ts`, replace:

```ts
 * was submitted), `tool` (a tool call, labelled with the tool's name) and `answer` (the final answer).
 */
/** `retake`: the person pressed the mistake key (a slip: Cuttle cuts back to the pause before it). */
export const MARKER_KINDS = ['manual', 'prompt', 'tool', 'answer', 'retake'] as const;

/** One marker; `t` is in source seconds of the screen track, like events.jsonl. */
export const MarkerSchema = z.strictObject({
```

with:

```ts
 * was submitted), `tool` (a tool call, labelled with the tool's name) and `answer` (the final answer).
 */
/** `retake`: the person pressed the mistake key (a slip: Cuttle cuts back to the pause before it). */
/**
 * `step`: the script moved to a step, labelled with the step's id: the first step at the take's
 * first frame, then each press of the step key (or the prompter's buttons), forward or back.
 */
export const MARKER_KINDS = ['manual', 'prompt', 'tool', 'answer', 'retake', 'step'] as const;

/** One marker; `t` is in source seconds of the screen track, like events.jsonl. */
export const MarkerSchema = z.strictObject({
```

In `packages/project/src/ids.ts`, replace:

```ts

export type IdList = keyof typeof ID_PREFIXES;

/** The ids a project's items use; the project may be parsed or as written (unchecked). */
export function usedIds(project: Partial<Record<IdList, unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const list of Object.keys(ID_PREFIXES) as IdList[]) {
    const items = project[list];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
```

with:

```ts

export type IdList = keyof typeof ID_PREFIXES;

/** The ids a project's items use, its script's steps' too; the project may be parsed or as written (unchecked). */
export function usedIds(project: Partial<Record<IdList | 'script', unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const list of [...(Object.keys(ID_PREFIXES) as IdList[]), 'script' as const]) {
    const items = project[list];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
```

In `packages/project/src/index.ts`, replace:

```ts
  EASES,
  FRAME_STYLES,
  ID_PATTERN,
  MASK_STYLES,
  MOUSE_BUTTONS,
  STILL_MOTIONS,
```

with:

```ts
  EASES,
  FRAME_STYLES,
  ID_PATTERN,
  SCRIPT_MAX_STEPS,
  STEP_NOTE_MAX,
  STEP_TITLE_MAX,
  MASK_STYLES,
  MOUSE_BUTTONS,
  STILL_MOTIONS,
```

In the same file, replace:

```ts
  type MotionOverlay,
  type Music,
  type Sound,
  type MotionScene,
  type SceneTransition,
  type ClipScene,
```

with:

```ts
  type MotionOverlay,
  type Music,
  type Sound,
  type ScriptStep,
  type MotionScene,
  type SceneTransition,
  type ClipScene,
```

The timeline gives each marker kind a colour; a step's is Cuttle's accent:

In `apps/desktop/src/renderer/editor/Timeline.tsx`, replace:

```tsx
 */
let pointerSeekUntil = 0;

const MARKER_DOT: Record<MarkerKind, string> = { prompt: '#ececf1', tool: '#7a7a85', answer: '#4fd1a1', manual: '#9a9aa5', retake: '#f2b34a' };

interface Layout {
  heights: Record<'markers' | 'ruler' | 'video' | OverlayKind | 'music' | 'mic' | 'input', number>;
```

with:

```tsx
 */
let pointerSeekUntil = 0;

const MARKER_DOT: Record<MarkerKind, string> = { prompt: '#ececf1', tool: '#7a7a85', answer: '#4fd1a1', manual: '#9a9aa5', retake: '#f2b34a', step: '#d97757' };

interface Layout {
  heights: Record<'markers' | 'ruler' | 'video' | OverlayKind | 'music' | 'mic' | 'input', number>;
```

Run: `pnpm exec vitest run --project node packages/project`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/project apps/desktop/src/renderer/editor/Timeline.tsx
git commit -m "project: the script (steps with a title and a note) and the step marker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The step keys in the recorder

**Files:**
- Modify: `packages/recorder/src/types.ts`, `packages/recorder/src/input.ts`, `packages/recorder/src/record.ts`, `packages/recorder/test/record.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/recorder/test/record.test.ts`, replace:

```ts
    expect(processes.type === 'processes' && processes.pids.length === 3 && processes.pids.every(Number.isInteger)).toBe(true);
  }, SLOW);

  it('stops once untilFile exists', async () => {
    const projectDir = project();
    const flag = join(projectDir, 'done.flag');
```

with:

```ts
    expect(processes.type === 'processes' && processes.pids.length === 3 && processes.pids.every(Number.isInteger)).toBe(true);
  }, SLOW);

  it("moves through the script's steps: the first at the first frame, then a marker for each move, none past either end", async () => {
    const projectDir = project();
    const events: RecorderEvent[] = [];
    const moves: number[] = [];
    const recording = record({
      ...test,
      projectDir,
      steps: ['step1', 'step2', 'step3'],
      stop: { maxSeconds: 2.5 },
      onEvent: (event) => {
        events.push(event);
        if (event.type !== 'recording') return;
        setTimeout(() => {
          recording.previous(); // at the first step: nothing
          moves.push(Date.now() / 1000);
          recording.next();
        }, 700);
        setTimeout(() => {
          moves.push(Date.now() / 1000);
          recording.next();
          recording.next(); // past the last: nothing
          recording.previous();
        }, 1400);
      },
    });
    const take = await recording.done;
    const takeFile = parseTakeJson(read(projectDir, 'takes/1/take.json'));
    if (!takeFile.ok) throw new Error(JSON.stringify(takeFile.issues));
    const [second, third] = moves.map((at) => at - takeFile.take.tracks.screen.start);
    expect(markersOf(projectDir, take.markers)).toEqual([
      { t: 0, kind: 'step', label: 'step1' },
      { t: expect.closeTo(second!, 1), kind: 'step', label: 'step2' },
      { t: expect.closeTo(third!, 1), kind: 'step', label: 'step3' },
      { t: expect.closeTo(third!, 1), kind: 'step', label: 'step2' },
    ]);
    // each step reaches the host as a marker event, the first right after the recording one
    expect(events.filter((event) => event.type === 'recording' || event.type === 'marker').map((event) => (event.type === 'marker' ? event.marker.label : event.type))).toEqual(['recording', 'step1', 'step2', 'step3', 'step2']);
  }, SLOW);

  it('stops once untilFile exists', async () => {
    const projectDir = project();
    const flag = join(projectDir, 'done.flag');
```

In the same file, replace:

```ts
      [{ stop: { maxSeconds: 0 } }, 'invalid-options'],
      [{ stop: { untilFile: flag } }, 'invalid-options'],
      [{ countdownSeconds: -1 }, 'invalid-options'],
      [{ mic: 'No Such Microphone' }, 'device-not-found'],
      [{ source: { kind: 'monitor', index: 7 } }, 'device-not-found'],
    ];
```

with:

```ts
      [{ stop: { maxSeconds: 0 } }, 'invalid-options'],
      [{ stop: { untilFile: flag } }, 'invalid-options'],
      [{ countdownSeconds: -1 }, 'invalid-options'],
      [{ steps: ['step1', 'step1'] }, 'invalid-options'],
      [{ steps: [''] }, 'invalid-options'],
      [{ mic: 'No Such Microphone' }, 'device-not-found'],
      [{ source: { kind: 'monitor', index: 7 } }, 'device-not-found'],
    ];
```

Run: `pnpm exec vitest run --project node packages/recorder/test/record.test.ts`
Expected: FAIL: `record` takes no steps and has no `next()`.

- [ ] **Step 2: The steps, the keys, the markers**

In `packages/recorder/src/types.ts`, replace:

```ts
   * as a recording HUD, so no take shows the pointer going to them or a click on Stop.
   */
  deadZones?: Bounds[];
  onEvent?: (event: RecorderEvent) => void;
}
```

with:

```ts
   * as a recording HUD, so no take shows the pointer going to them or a click on Stop.
   */
  deadZones?: Bounds[];
  /**
   * The script's step ids, in order (`script` in cuttle.json): the take starts at the first, and
   * `next()`, `previous()` and the step keys move through them, each move a `step` marker.
   */
  steps?: string[];
  onEvent?: (event: RecorderEvent) => void;
}
```

In the same file, replace:

```ts
  marker(label?: string): void;
  /** Marks a slip (the mistake key): Cuttle cuts back to the pause before it. */
  retake(): void;
  /**
   * Pauses the take: every track stops (each file is complete) and nothing is captured or logged
   * until `resume()`. The take's time stands still meanwhile; the stop joins the pieces. Events:
```

with:

```ts
  marker(label?: string): void;
  /** Marks a slip (the mistake key): Cuttle cuts back to the pause before it. */
  retake(): void;
  /**
   * Moves to the script's next step (the step key), or back to the one before: a `step` marker.
   * Nothing at either end, without a script, or before the screen track started.
   */
  next(): void;
  previous(): void;
  /**
   * Pauses the take: every track stops (each file is complete) and nothing is captured or logged
   * until `resume()`. The take's time stands still meanwhile; the stop joins the pieces. Events:
```

In the same file, replace:

```ts
  /** A dialog or menu opened or closed. */
  | { type: 'window'; time: number; id: number; kind: WindowKind; rect: Bounds; open: boolean };

export type HotkeyAction = 'stop' | 'marker' | 'pause' | 'retake';
```

with:

```ts
  /** A dialog or menu opened or closed. */
  | { type: 'window'; time: number; id: number; kind: WindowKind; rect: Bounds; open: boolean };

export type HotkeyAction = 'stop' | 'marker' | 'pause' | 'retake' | 'next' | 'previous';
```

In `packages/recorder/src/input.ts`, replace:

```ts
const now = () => Date.now() / 1000;

/** Ctrl+Shift+Alt+<key>: no app binds these, and AltGr+Shift+letter types nothing on common layouts. */
export const HOTKEYS: Record<HotkeyAction, string> = { stop: 'Ctrl+Shift+Alt+S', marker: 'Ctrl+Shift+Alt+M', pause: 'Ctrl+Shift+Alt+P', retake: 'Ctrl+Shift+Alt+X' };

export interface KeyEvent {
  keycode: number;
```

with:

```ts
const now = () => Date.now() / 1000;

/** Ctrl+Shift+Alt+<key>: no app binds these, and AltGr+Shift+letter types nothing on common layouts. */
export const HOTKEYS: Record<HotkeyAction, string> = {
  stop: 'Ctrl+Shift+Alt+S',
  marker: 'Ctrl+Shift+Alt+M',
  pause: 'Ctrl+Shift+Alt+P',
  retake: 'Ctrl+Shift+Alt+X',
  next: 'Ctrl+Shift+Alt+N',
  previous: 'Ctrl+Shift+Alt+B',
};

export interface KeyEvent {
  keycode: number;
```

In the same file, replace:

```ts
    UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Shift, UiohookKey.ShiftRight,
    UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Meta, UiohookKey.MetaRight,
  ]);
  const keys = keyHandler(modifiers, new Map<number, HotkeyAction>([[UiohookKey.S, 'stop'], [UiohookKey.M, 'marker'], [UiohookKey.P, 'pause'], [UiohookKey.X, 'retake']]), onInput, onHotkey);
  const buttons = new Map<unknown, 'left' | 'right' | 'middle'>([[1, 'left'], [2, 'right'], [3, 'middle']]);
  let shape = win.cursorShape(); // before the hook starts: nothing to undo if it throws
```

with:

```ts
    UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Shift, UiohookKey.ShiftRight,
    UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Meta, UiohookKey.MetaRight,
  ]);
  const keys = keyHandler(modifiers, new Map<number, HotkeyAction>([[UiohookKey.S, 'stop'], [UiohookKey.M, 'marker'], [UiohookKey.P, 'pause'], [UiohookKey.X, 'retake'], [UiohookKey.N, 'next'], [UiohookKey.B, 'previous']]), onInput, onHotkey);
  const buttons = new Map<unknown, 'left' | 'right' | 'middle'>([[1, 'left'], [2, 'right'], [3, 'middle']]);
  let shape = win.cursorShape(); // before the hook starts: nothing to undo if it throws
```

In the same file, replace:

```ts
  };
}

/** macOS virtual key codes of the hotkeys' letters (kVK_ANSI_S, _M, _P, _X). */
const MAC_HOTKEYS = new Map<number, HotkeyAction>([[0x01, 'stop'], [0x2e, 'marker'], [0x23, 'pause'], [0x07, 'retake']]);
const WHERE_INPUT_MONITORING = 'allow the app that runs Cuttle (your terminal, or Cuttle) under System Settings > Privacy & Security > Input Monitoring';

/**
```

with:

```ts
  };
}

/** macOS virtual key codes of the hotkeys' letters (kVK_ANSI_S, _M, _P, _X, _N, _B). */
const MAC_HOTKEYS = new Map<number, HotkeyAction>([[0x01, 'stop'], [0x2e, 'marker'], [0x23, 'pause'], [0x07, 'retake'], [0x2d, 'next'], [0x0b, 'previous']]);
const WHERE_INPUT_MONITORING = 'allow the app that runs Cuttle (your terminal, or Cuttle) under System Settings > Privacy & Security > Input Monitoring';

/**
```

In `packages/recorder/src/record.ts`, replace:

```ts
    },
    marker: (label) => control.marker(label),
    retake: () => control.retake(),
    pause: () => control.setPaused(true),
    resume: () => control.setPaused(false),
    setDeadZones: (zones) => (control.deadZones = [...zones]),
```

with:

```ts
    },
    marker: (label) => control.marker(label),
    retake: () => control.retake(),
    next: () => control.step(1),
    previous: () => control.step(-1),
    pause: () => control.setPaused(true),
    resume: () => control.setPaused(false),
    setDeadZones: (zones) => (control.deadZones = [...zones]),
```

In the same file, replace:

```ts
  };
}

/** Stop requests, pauses and manual markers from the caller, the hotkeys and the triggers. */
class Control {
  reason: StopReason | undefined;
  onMarker: ((label?: string, kind?: 'manual' | 'retake') => void) | undefined;
  /** Pointer input inside these is not logged. */
  deadZones: Bounds[] = [];
  private waiters: ((reason: StopReason) => void)[] = [];
```

with:

```ts
  };
}

/** Stop requests, pauses, manual markers and the script's steps from the caller, the hotkeys and the triggers. */
class Control {
  reason: StopReason | undefined;
  onMarker: ((label?: string, kind?: 'manual' | 'retake') => void) | undefined;
  /** Moves through the script's steps once the take runs. */
  onStep: ((delta: 1 | -1) => void) | undefined;
  /** Pointer input inside these is not logged. */
  deadZones: Bounds[] = [];
  private waiters: ((reason: StopReason) => void)[] = [];
```

In the same file, replace:

```ts
  retake(): void {
    this.onMarker?.(undefined, 'retake');
  }
}

/** Events for the caller and the take's warnings. A throwing `onEvent` becomes a warning, never a failed take. */
```

with:

```ts
  retake(): void {
    this.onMarker?.(undefined, 'retake');
  }

  step(delta: 1 | -1): void {
    this.onStep?.(delta);
  }
}

/** Events for the caller and the take's warnings. A throwing `onEvent` becomes a warning, never a failed take. */
```

In the same file, replace:

```ts
        if (raw.type !== 'area' && raw.type !== 'window') lastInput = raw.time;
        writer.push(raw);
      },
      (action) => (action === 'stop' ? control.request('hotkey') : action === 'pause' ? control.toggle() : action === 'retake' ? control.retake() : control.marker()),
    );
    if (input.warning) reporter.warn(input.warning);
```

with:

```ts
        if (raw.type !== 'area' && raw.type !== 'window') lastInput = raw.time;
        writer.push(raw);
      },
      (action) => {
        if (action === 'stop') control.request('hotkey');
        else if (action === 'pause') control.toggle();
        else if (action === 'retake') control.retake();
        else if (action === 'next') control.step(1);
        else if (action === 'previous') control.step(-1);
        else control.marker();
      },
    );
    if (input.warning) reporter.warn(input.warning);
```

In the same file, replace:

```ts
    } satisfies TakeFile);
    capturing = true;
    reporter.emit({ type: 'recording', dir: rel(dir) });
    // Claude's answer stops the take a little after it; while paused, a little after the resume.
    let claudeStop = false;
    // one timer at a time; a pause clears it (the tail is recorded time), the resume starts it again
```

with:

```ts
    } satisfies TakeFile);
    capturing = true;
    reporter.emit({ type: 'recording', dir: rel(dir) });
    // The script: its first step from the take's first frame, then a marker for each move.
    const steps = options.steps ?? [];
    if (steps.length > 0) {
      let step = 0;
      addMarker({ kind: 'step', label: steps[0]! }, screenAt);
      control.onStep = (delta) => {
        const to = step + delta;
        if (to < 0 || to >= steps.length) return;
        step = to;
        addMarker({ kind: 'step', label: steps[to]! }, now());
      };
    }
    // Claude's answer stops the take a little after it; while paused, a little after the resume.
    let claudeStop = false;
    // one timer at a time; a pause clears it (the tail is recorded time), the resume starts it again
```

In the same file, replace:

```ts
    throw new RecorderError(code, `${message(error)}\n(what was recorded is in ${rel(dir)})`, { cause: error });
  } finally {
    control.onMarker = undefined;
    closeEvents();
  }
```

with:

```ts
    throw new RecorderError(code, `${message(error)}\n(what was recorded is in ${rel(dir)})`, { cause: error });
  } finally {
    control.onMarker = undefined;
    control.onStep = undefined;
    closeEvents();
  }
```

In the same file, replace:

```ts
  if (countdown !== undefined && !(Number.isFinite(countdown) && countdown >= 0)) throw invalid('countdownSeconds must be 0 or more');
  const flag = options.stop.untilFile === undefined ? undefined : resolve(options.stop.untilFile);
  if (flag !== undefined && existsSync(flag)) throw invalid(`untilFile ${flag} already exists; delete it first, or the recording would stop at once`);
}

/** Creates the next free `takes/<n>` folder; `mkdir` fails on an existing one, so two recorders never share one. */
```

with:

```ts
  if (countdown !== undefined && !(Number.isFinite(countdown) && countdown >= 0)) throw invalid('countdownSeconds must be 0 or more');
  const flag = options.stop.untilFile === undefined ? undefined : resolve(options.stop.untilFile);
  if (flag !== undefined && existsSync(flag)) throw invalid(`untilFile ${flag} already exists; delete it first, or the recording would stop at once`);
  const steps = options.steps ?? [];
  if (steps.some((id) => typeof id !== 'string' || id === '') || new Set(steps).size !== steps.length) throw invalid('steps must be different, non-empty step ids');
}

/** Creates the next free `takes/<n>` folder; `mkdir` fails on an existing one, so two recorders never share one. */
```

Run: `pnpm exec vitest run --project node packages/recorder/test/record.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/recorder
git commit -m "recorder: the script's steps, Ctrl+Shift+Alt+N and B, a step marker for each move

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `cuttle record` with the project's script

**Files:**
- Modify: `apps/cli/src/commands/record.ts`, `apps/cli/test/cli.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/cli/test/cli.test.ts`, replace:

```ts
    expect(project.scenes).toEqual([{ type: 'clip', from: 0, to: Math.floor(result.take.seconds * 1000) / 1000 }]);
  }, 20_000);

  it('refuses a project open in the Cuttle app, unless forced or its app is gone', async () => {
    const dir = join(temp(), 'demo');
    mkdirSync(join(dir, '.cuttle'), { recursive: true });
```

with:

```ts
    expect(project.scenes).toEqual([{ type: 'clip', from: 0, to: Math.floor(result.take.seconds * 1000) / 1000 }]);
  }, 20_000);

  it("records with the project's script: the take starts at its first step, and the status lines name the steps", async () => {
    const dir = join(temp(), 'demo');
    expect((await cli('--json', 'init', dir)).code).toBe(0);
    const path = join(dir, 'cuttle.json');
    const script = [{ id: 'step1', title: 'Open the settings', note: 'The gear, top right.' }, { id: 'step2', title: 'Turn on dark mode' }];
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), script }));
    let stderr = '';
    const code = await runCli(['-C', dir, 'record', '--backend', 'test', '--max', '1', '--countdown', '0'], { stdout: () => {}, stderr: (chunk) => void (stderr += chunk) });
    expect(code, stderr).toBe(0);
    expect(stderr).toContain('script: 2 steps; next step: Ctrl+Shift+Alt+N, back: Ctrl+Shift+Alt+B');
    expect(stderr).toContain('step 1/2: Open the settings at 0.00 s');
    expect(JSON.parse(readFileSync(join(dir, 'takes/1/markers.json'), 'utf8')).markers).toEqual([{ t: 0, kind: 'step', label: 'step1' }]);
    // the script stays the project's
    expect(JSON.parse(readFileSync(path, 'utf8')).script).toEqual(script);
  }, 20_000);

  it('refuses a project open in the Cuttle app, unless forced or its app is gone', async () => {
    const dir = join(temp(), 'demo');
    mkdirSync(join(dir, '.cuttle'), { recursive: true });
```

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts -t "script"`
Expected: FAIL: the output names no step, and the take has no step marker.

- [ ] **Step 2: The steps passed on and printed**

In `apps/cli/src/commands/record.ts`, replace:

```ts

/**
 * `cuttle record`: records a take into the project (created when missing) and points the project at
 * it. Ctrl+C (`signal`) stops the recording like the stop hotkey; the take is kept.
 */
export async function recordCommand(projectDir: string, args: RecordArgs, output: Output, signal: AbortSignal): Promise<RecordResult> {
  // The app records an open project itself (its editor hidden, so it is not in the take).
```

with:

```ts

/**
 * `cuttle record`: records a take into the project (created when missing) and points the project at
 * it. Ctrl+C (`signal`) stops the recording like the stop hotkey; the take is kept. With a script in
 * the project, the take starts at its first step and the step keys move through them (each a
 * `step` marker); each step is printed as the take reaches it.
 */
export async function recordCommand(projectDir: string, args: RecordArgs, output: Output, signal: AbortSignal): Promise<RecordResult> {
  // The app records an open project itself (its editor hidden, so it is not in the take).
```

In the same file, replace:

```ts
  // Read (or created) now, so a broken project stops the command before anything is recorded.
  const before = projectExists(projectDir) ? await readProjectFile(projectDir) : (await writeProjectFile(newProjectFile(projectDir), 'record')).file;
  if (signal.aborted) throw new CliError('cancelled', 'stopped before the recording started');

  const recording = record({
    projectDir: before.dir,
```

with:

```ts
  // Read (or created) now, so a broken project stops the command before anything is recorded.
  const before = projectExists(projectDir) ? await readProjectFile(projectDir) : (await writeProjectFile(newProjectFile(projectDir), 'record')).file;
  if (signal.aborted) throw new CliError('cancelled', 'stopped before the recording started');
  const script = before.project.script;
  const stepLine = (id: string | undefined) => {
    const index = script.findIndex((step) => step.id === id);
    return index < 0 ? undefined : `step ${index + 1}/${script.length}: ${script[index]!.title}`;
  };

  const recording = record({
    projectDir: before.dir,
```

In the same file, replace:

```ts
    ...(args.countdown !== undefined && { countdownSeconds: args.countdown }),
    drawMouse: args.drawMouse ?? false,
    backend: args.backend,
    onEvent(event) {
      if (event.type === 'countdown') output.info(`recording in ${event.seconds} …`);
      if (event.type === 'recording') output.info(`recording ${event.dir}; stop: Ctrl+C or ${HOTKEYS.stop}, marker: ${HOTKEYS.marker}, pause: ${HOTKEYS.pause}, a slip: ${HOTKEYS.retake}`);
      if (event.type === 'paused') output.info(`paused: nothing is recorded until ${HOTKEYS.pause} again`);
      if (event.type === 'resuming') output.info('resuming …');
      if (event.type === 'resumed') output.info('recording again');
      if (event.type === 'marker') output.info(`marker ${event.marker.kind}${event.marker.label ? ` ${event.marker.label}` : ''} at ${event.marker.t.toFixed(2)} s`);
      if (event.type === 'warning') output.warn(event.message);
      if (event.type === 'stopping') output.info(`stopping (${event.reason}) …`);
    },
```

with:

```ts
    ...(args.countdown !== undefined && { countdownSeconds: args.countdown }),
    drawMouse: args.drawMouse ?? false,
    backend: args.backend,
    ...(script.length > 0 && { steps: script.map((step) => step.id) }),
    onEvent(event) {
      if (event.type === 'countdown') output.info(`recording in ${event.seconds} …`);
      if (event.type === 'recording') output.info(`recording ${event.dir}; stop: Ctrl+C or ${HOTKEYS.stop}, marker: ${HOTKEYS.marker}, pause: ${HOTKEYS.pause}, a slip: ${HOTKEYS.retake}`);
      if (event.type === 'recording' && script.length > 0) output.info(`script: ${script.length} steps; next step: ${HOTKEYS.next}, back: ${HOTKEYS.previous}`);
      if (event.type === 'paused') output.info(`paused: nothing is recorded until ${HOTKEYS.pause} again`);
      if (event.type === 'resuming') output.info('resuming …');
      if (event.type === 'resumed') output.info('recording again');
      if (event.type === 'marker' && event.marker.kind === 'step') output.info(`${stepLine(event.marker.label) ?? `step ${event.marker.label}`} at ${event.marker.t.toFixed(2)} s`);
      else if (event.type === 'marker') output.info(`marker ${event.marker.kind}${event.marker.label ? ` ${event.marker.label}` : ''} at ${event.marker.t.toFixed(2)} s`);
      if (event.type === 'warning') output.warn(event.message);
      if (event.type === 'stopping') output.info(`stopping (${event.reason}) …`);
    },
```

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/cli
git commit -m "cli: record with the project's script, each step printed as the take reaches it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The prompter and the picker's Script in the app

**Files:**
- Create: `apps/desktop/src/main/prompter.ts`, `apps/desktop/src/preload/prompter.ts`, `apps/desktop/src/renderer/prompter.html`, `apps/desktop/src/renderer/picker/prompter-main.tsx`, `apps/desktop/src/renderer/picker/Prompter.tsx`, `apps/desktop/src/renderer/picker/Script.tsx`
- Modify: `apps/desktop/src/shared/recording.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/shared/timeline-model.ts`, `apps/desktop/src/main/recorder-host.ts`, `apps/desktop/src/main/recording.ts`, `apps/desktop/src/workers/recorder.ts`, `apps/desktop/src/renderer/picker/Picker.tsx`, `apps/desktop/src/renderer/picker/picker.css`, `apps/desktop/scripts/build.mjs`, `apps/desktop/vite.renderer.config.ts`, `apps/desktop/test/recording.test.ts`, `apps/desktop/test/timeline-model.test.ts`, `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/test/recording.test.ts`, replace:

```ts
  labelPlacement,
  matchMediaDevice,
  monitorAt,
  recordingFailure,
  stopOptionsFor,
  toDisplayPixels,
  windowAt,
```

with:

```ts
  labelPlacement,
  matchMediaDevice,
  monitorAt,
  prompterPosition,
  recordingFailure,
  scriptForTake,
  stepsFromText,
  stopOptionsFor,
  toDisplayPixels,
  windowAt,
```

In the same file, replace:

```ts
    expect(bubblePlacement({ x: 0, y: 0, width: 300, height: 90 }, 48, { y: 106, where: 'below' }, 44)).toEqual({ left: 16, top: 44 });
  });
});
```

with:

```ts
    expect(bubblePlacement({ x: 0, y: 0, width: 300, height: 90 }, 48, { y: 106, where: 'below' }, 44)).toEqual({ left: 16, top: 44 });
  });
});

describe('the script', () => {
  const area = { x: 0, y: 0, width: 2048, height: 1104 };
  const size = { width: 512, height: 180 };

  it('puts the prompter right under the HUD at the top, right over it at the bottom, inside the work area', () => {
    expect(prompterPosition({ x: 768, y: 12, width: 512, height: 64 }, area, size)).toEqual({ x: 768, y: 66, below: true });
    expect(prompterPosition({ x: 768, y: 1028, width: 512, height: 64 }, area, size)).toEqual({ x: 768, y: 858, below: false });
    // a HUD dragged to the edge: the prompter stays on the display
    expect(prompterPosition({ x: 1700, y: 12, width: 512, height: 64 }, area, size).x).toBe(2048 - 512);
  });

  it('makes steps of a pasted list: one per line, numbers and bullets dropped, indented lines as the note', () => {
    const text = '1. Open the settings\r\n   The gear, top right.\r\n   Say it is one click.\n\n- Turn on dark mode\n* Export the video\n• ' + 'x'.repeat(90);
    expect(stepsFromText(text, 80)).toEqual([
      { title: 'Open the settings', note: 'The gear, top right.\nSay it is one click.' },
      { title: 'Turn on dark mode' },
      { title: 'Export the video' },
      { title: 'x'.repeat(80) },
    ]);
    // an indented first line has no step to belong to: it is a step
    expect(stepsFromText('  Just this', 80)).toEqual([{ title: 'Just this' }]);
  });

  it('records with the steps that have a title, each with an id no other item of the project has', () => {
    const typed = [
      { id: 'step1', title: ' Open the settings ', note: '  ' },
      { id: 'step2', title: '' },
      { id: 'z1', title: 'Turn on dark mode', note: ' The switch. ' },
      { id: 'step1', title: 'Export' },
    ];
    expect(scriptForTake(typed, new Set(['z1', 's1']))).toEqual([
      { id: 'step1', title: 'Open the settings' },
      { id: 'step2', title: 'Turn on dark mode', note: 'The switch.' },
      { id: 'step3', title: 'Export' },
    ]);
  });
});
```

In `apps/desktop/test/timeline-model.test.ts`, replace:

```ts
      [4.75, 'answer'],
    ]);
  });
});

describe('outputTimesOf and groupPins', () => {
```

with:

```ts
      [4.75, 'answer'],
    ]);
  });

  it("names a step's pin by its number and title in the script, and by its id when the script lost it", () => {
    const scripted = project({ ...demo, script: [{ id: 'step1', title: 'Open the settings' }, { id: 'step2', title: 'Turn on dark mode' }] });
    const steps = timelineModel(scripted, spans, [
      { t: 0, kind: 'step', label: 'step1' },
      { t: 2, kind: 'step', label: 'step2' },
      { t: 9, kind: 'step', label: 'step9' },
    ]).markers;
    expect(steps.map((pin) => [pin.t, pin.label])).toEqual([
      [0, '1 · Open the settings'],
      [2, '2 · Turn on dark mode'],
      [4.75, 'step9'],
    ]);
    expect(groupPins(steps, 1).map(pinGroupName)).toEqual(['1 · Open the settings', '2 · Turn on dark mode', 'step9']);
  });
});

describe('outputTimesOf and groupPins', () => {
```

Run: `pnpm exec vitest run --project node apps/desktop/test/recording.test.ts apps/desktop/test/timeline-model.test.ts`
Expected: FAIL: there is no `prompterPosition`, `stepsFromText` or `scriptForTake`, and a step's pin has no name.

- [ ] **Step 2: The script's types, the prompter's place, a pasted list, the take's ids; the step pins**

In `apps/desktop/src/shared/recording.ts`, replace:

```ts
  | { type: 'stop' }
  | { type: 'marker'; label?: string }
  | { type: 'retake' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'dead-zones'; zones: Bounds[] };
```

with:

```ts
  | { type: 'stop' }
  | { type: 'marker'; label?: string }
  | { type: 'retake' }
  /** The script's next step (1) or the one before (-1). */
  | { type: 'step'; delta: 1 | -1 }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'dead-zones'; zones: Bounds[] };
```

In the same file, replace:

```ts
  claudeFolder?: string;
}

/** The first window whose bounds contain the point (front to back), or undefined: the display. */
export function windowAt(windows: readonly PickerWindow[], x: number, y: number): PickerWindow | undefined {
  return windows.find(({ bounds }) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height);
```

with:

```ts
  claudeFolder?: string;
}

/** A step of the script as the picker edits it and the prompter shows it (`script` in cuttle.json). */
export interface ScriptStep {
  id: string;
  title: string;
  note?: string;
}

/** What the prompter shows: the script, the step the take is at, and whether its buttons work yet (not during the countdown). */
export interface PrompterState {
  steps: Omit<ScriptStep, 'id'>[];
  index: number;
  live: boolean;
}

/** The first window whose bounds contain the point (front to back), or undefined: the display. */
export function windowAt(windows: readonly PickerWindow[], x: number, y: number): PickerWindow | undefined {
  return windows.find(({ bounds }) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height);
```

In the same file, replace:

```ts
  return { x: free.x, y: free.y };
}

/** A recorder warning for the HUD: a few words, and the whole message for its tooltip. */
export function hudWarning(message: string): { text: string; detail: string } {
  const rules: [RegExp, (match: RegExpExecArray) => string][] = [
```

with:

```ts
  return { x: free.x, y: free.y };
}

/**
 * Where the prompter goes: right under the HUD, or right over it when the HUD sits in the lower half
 * of its display's work area (the windows' shadow margins overlap, so their cards are 8 DIP apart);
 * centred on the HUD, inside the work area. `below` says which edge a new height keeps. DIP.
 */
export function prompterPosition(hud: Rect, area: Rect, size: { width: number; height: number }): { x: number; y: number; below: boolean } {
  const below = hud.y + hud.height / 2 < area.y + area.height / 2;
  const x = Math.round(Math.min(Math.max(hud.x + (hud.width - size.width) / 2, area.x), area.x + area.width - size.width));
  return { x, y: below ? hud.y + hud.height - 10 : hud.y - size.height + 10, below };
}

/**
 * The steps a pasted text makes: one per line, a list's number or bullet dropped ("1. ", "- "); a
 * line indented under a step is that step's note. Titles longer than a step's are cut there.
 */
export function stepsFromText(text: string, titleMax: number): Omit<ScriptStep, 'id'>[] {
  const steps: Omit<ScriptStep, 'id'>[] = [];
  for (const line of text.split(/\r?\n|\r/)) {
    if (line.trim() === '') continue;
    const last = steps.at(-1);
    if (/^\s/.test(line) && last) {
      last.note = last.note ? `${last.note}\n${line.trim()}` : line.trim();
      continue;
    }
    const title = line.trim().replace(/^(?:\d+[.)]|[-*•])\s+/, '').trim();
    if (title !== '') steps.push({ title: title.slice(0, titleMax) });
  }
  return steps;
}

/**
 * The script a take records with: steps without a title left out, titles trimmed, each id kept when
 * it is free in the project (`taken`: its other items' ids), else the next free `step<n>`.
 */
export function scriptForTake(steps: readonly ScriptStep[], taken: ReadonlySet<string>): ScriptStep[] {
  const used = new Set(taken);
  const kept: ScriptStep[] = [];
  for (const step of steps) {
    const title = step.title.trim();
    if (title === '') continue;
    let id = step.id;
    if (id === '' || used.has(id)) for (let n = 1; used.has((id = `step${n}`)); n++);
    used.add(id);
    const note = step.note?.trim();
    kept.push({ id, title, ...(note && { note }) });
  }
  return kept;
}

/** A recorder warning for the HUD: a few words, and the whole message for its tooltip. */
export function hudWarning(message: string): { text: string; detail: string } {
  const rules: [RegExp, (match: RegExpExecArray) => string][] = [
```

In `apps/desktop/src/shared/timeline-model.ts`, replace:

```ts
    },
    ...(project.music && { music: { title: motionName(project.music.src), src: project.music.src, enabled: project.music.enabled } }),
    markers: markers
      .flatMap((marker) => outputTimesOf(spans, marker.t).map((t) => ({ t, source: marker.t, kind: marker.kind, ...(marker.label !== undefined && { label: marker.label }) })))
      .sort((a, b) => a.t - b.t),
  };
}

/** Pins closer than `minGap` output seconds that are tool calls merge into one pin with a count. */
export interface PinGroup {
  t: number;
```

with:

```ts
    },
    ...(project.music && { music: { title: motionName(project.music.src), src: project.music.src, enabled: project.music.enabled } }),
    markers: markers
      .flatMap((marker) => {
        const label = marker.kind === 'step' ? stepName(project, marker.label) : marker.label;
        return outputTimesOf(spans, marker.t).map((t) => ({ t, source: marker.t, kind: marker.kind, ...(label !== undefined && { label }) }));
      })
      .sort((a, b) => a.t - b.t),
  };
}

/** A step marker's name: the step's number and title in the script ("2 · Open the settings"), else its id. */
function stepName(project: CuttleProject, id: string | undefined): string | undefined {
  const index = project.script.findIndex((step) => step.id === id);
  return index < 0 ? id : `${index + 1} · ${project.script[index]!.title}`;
}

/** Pins closer than `minGap` output seconds that are tool calls merge into one pin with a count. */
export interface PinGroup {
  t: number;
```

In the same file, replace:

```ts
  if (group.kind === 'answer') return 'Answer';
  if (group.kind === 'manual') return first.label ?? 'Marker';
  if (group.kind === 'retake') return 'Retake';
  if (group.pins.length === 1) return first.label ?? 'Tool';
  const tools = new Set(group.pins.map((pin) => pin.label ?? 'Tool'));
  return tools.size === 1 ? `${first.label ?? 'Tool'} ×${group.pins.length}` : `${group.pins.length} tool calls`;
```

with:

```ts
  if (group.kind === 'answer') return 'Answer';
  if (group.kind === 'manual') return first.label ?? 'Marker';
  if (group.kind === 'retake') return 'Retake';
  if (group.kind === 'step') return first.label ?? 'Step';
  if (group.pins.length === 1) return first.label ?? 'Tool';
  const tools = new Set(group.pins.map((pin) => pin.label ?? 'Tool'));
  return tools.size === 1 ? `${first.label ?? 'Tool'} ×${group.pins.length}` : `${group.pins.length} tool calls`;
```

Run: `pnpm exec vitest run --project node apps/desktop/test/recording.test.ts apps/desktop/test/timeline-model.test.ts`
Expected: PASS.

- [ ] **Step 3: The channels, and the step request through the recorder host**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
import { z } from 'zod';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { MOTION_TEMPLATES, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import type { LengthReport } from './media-jobs';
import type { PickedTarget, PickerDisplay, PickerWindow, RecordChoices } from './recording';

export type { PickedTarget, PickerDisplay, PickerWindow, Rect, RecordChoices } from './recording';

export const EXPORT_FORMATS = ['16:9', '1:1', '9:16'] as const;
/** What an export makes: the project's own output size, or a preset. */
```

with:

```ts
import { z } from 'zod';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { MOTION_TEMPLATES, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import { ID_PATTERN, SCRIPT_MAX_STEPS, STEP_NOTE_MAX, STEP_TITLE_MAX } from '@cuttle/project';
import type { LengthReport } from './media-jobs';
import type { PickedTarget, PickerDisplay, PickerWindow, PrompterState, RecordChoices, ScriptStep } from './recording';

export type { PickedTarget, PickerDisplay, PickerWindow, PrompterState, Rect, RecordChoices, ScriptStep } from './recording';

export const EXPORT_FORMATS = ['16:9', '1:1', '9:16'] as const;
/** What an export makes: the project's own output size, or a preset. */
```

In the same file, replace:

```ts
  warning?: string;
  /** Cameras and mics are still being listed (DirectShow takes a moment): the bar says so. */
  listingDevices?: boolean;
}

/** What the HUD shows. */
```

with:

```ts
  warning?: string;
  /** Cameras and mics are still being listed (DirectShow takes a moment): the bar says so. */
  listingDevices?: boolean;
  /** The script the take records with: the project's (`script` in cuttle.json), or what was typed for it since. */
  script: ScriptStep[];
}

/** What the HUD shows. */
```

In the same file, replace:

```ts
  'picker:cancel': z.undefined(),
  'picker:claude-folder': z.undefined(),
  'picker:retry': z.undefined(),
  // HUD
  'hud:stop': z.undefined(),
  'hud:marker': z.undefined(),
```

with:

```ts
  'picker:cancel': z.undefined(),
  'picker:claude-folder': z.undefined(),
  'picker:retry': z.undefined(),
  /** The script as typed so far (a step being written may have no title yet). */
  'picker:script': z
    .array(
      z.strictObject({
        id: z.string().regex(ID_PATTERN),
        title: z.string().max(STEP_TITLE_MAX),
        note: z.string().max(STEP_NOTE_MAX).optional(),
      }),
    )
    .max(SCRIPT_MAX_STEPS),
  // prompter
  'prompter:next': z.undefined(),
  'prompter:previous': z.undefined(),
  /** The height its content needs (DIP, its margins included): the window takes it. */
  'prompter:size': z.strictObject({ height: z.number().finite().positive().max(4000) }),
  // HUD
  'hud:stop': z.undefined(),
  'hud:marker': z.undefined(),
```

In the same file, replace:

```ts
  'picker:cancel': void;
  'picker:claude-folder': string | undefined;
  'picker:retry': void;
  'hud:stop': void;
  'hud:marker': void;
  'hud:retake': void;
```

with:

```ts
  'picker:cancel': void;
  'picker:claude-folder': string | undefined;
  'picker:retry': void;
  'picker:script': void;
  'prompter:next': void;
  'prompter:previous': void;
  'prompter:size': void;
  'hud:stop': void;
  'hud:marker': void;
  'hud:retake': void;
```

In the same file, replace:

```ts
  'picker:devices': Pick<PickerSetup, 'cameras' | 'mics' | 'choices'>;
  'picker:active': { display: number };
  'picker:choices': RecordChoices;
  /** `restart`: counting down again after a restart (the take before is kept). */
  'countdown:tick': { seconds: number; restart?: boolean };
  'hud:state': HudState;
```

with:

```ts
  'picker:devices': Pick<PickerSetup, 'cameras' | 'mics' | 'choices'>;
  'picker:active': { display: number };
  'picker:choices': RecordChoices;
  /** The script, changed in another display's picker. */
  'picker:script': ScriptStep[];
  'prompter:state': PrompterState;
  /** `restart`: counting down again after a restart (the take before is kept). */
  'countdown:tick': { seconds: number; restart?: boolean };
  'hud:state': HudState;
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
    events: ['pill:recent', 'app:motion'],
  },
  picker: {
    requests: ['picker:setup', 'picker:hover', 'picker:choices', 'picker:record', 'picker:cancel', 'picker:claude-folder', 'picker:retry'],
    events: ['picker:open', 'picker:active', 'picker:choices', 'picker:devices', 'app:motion'],
  },
  hud: {
    requests: ['hud:stop', 'hud:marker', 'hud:retake', 'hud:pause', 'hud:resume', 'hud:restart'],
    events: ['hud:state', 'app:motion'],
  },
  countdown: {
    requests: [],
    events: ['countdown:tick', 'app:motion'],
```

with:

```ts
    events: ['pill:recent', 'app:motion'],
  },
  picker: {
    requests: ['picker:setup', 'picker:hover', 'picker:choices', 'picker:record', 'picker:cancel', 'picker:claude-folder', 'picker:retry', 'picker:script'],
    events: ['picker:open', 'picker:active', 'picker:choices', 'picker:devices', 'picker:script', 'app:motion'],
  },
  hud: {
    requests: ['hud:stop', 'hud:marker', 'hud:retake', 'hud:pause', 'hud:resume', 'hud:restart'],
    events: ['hud:state', 'app:motion'],
  },
  prompter: {
    requests: ['prompter:next', 'prompter:previous', 'prompter:size'],
    events: ['prompter:state', 'app:motion'],
  },
  countdown: {
    requests: [],
    events: ['countdown:tick', 'app:motion'],
```

In `apps/desktop/src/main/recorder-host.ts`, replace:

```ts
    if (this.running) this.send({ type: 'retake' });
  }

  /** Pauses the take: every track stops until `resume()` (events `paused`, `resuming`, `resumed`). */
  pause(): void {
    if (this.running) this.send({ type: 'pause' });
```

with:

```ts
    if (this.running) this.send({ type: 'retake' });
  }

  /** The script's next step, or the one before: a `step` marker (nothing at either end). */
  nextStep(): void {
    if (this.running) this.send({ type: 'step', delta: 1 });
  }

  previousStep(): void {
    if (this.running) this.send({ type: 'step', delta: -1 });
  }

  /** Pauses the take: every track stops until `resume()` (events `paused`, `resuming`, `resumed`). */
  pause(): void {
    if (this.running) this.send({ type: 'pause' });
```

In `apps/desktop/src/workers/recorder.ts`, replace:

```ts
    case 'retake':
      recording?.retake();
      return;
    case 'pause':
      recording?.pause();
      return;
```

with:

```ts
    case 'retake':
      recording?.retake();
      return;
    case 'step':
      if (data.delta === 1) recording?.next();
      else recording?.previous();
      return;
    case 'pause':
      recording?.pause();
      return;
```

- [ ] **Step 4: The prompter's page**

`apps/desktop/src/preload/prompter.ts`:

```ts
import { exposeBridge } from './bridge';

exposeBridge('prompter');
```

`apps/desktop/src/renderer/prompter.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cuttle</title>
  </head>
  <body class="transparent">
    <div id="root"></div>
    <script type="module" src="./picker/prompter-main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/renderer/picker/prompter-main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../base.css';
import './picker.css';
import { Prompter } from './Prompter';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Prompter />
  </StrictMode>,
);
```

`apps/desktop/src/renderer/picker/Prompter.tsx`:

```tsx
// The prompter: the script's step now, its note and the step after it, in a window by the HUD. It is
// never in the video (content protection), never takes the focus (the recorded window keeps it), and
// its area is a dead zone for the input log. Back and Next, or Ctrl+Shift+Alt+B and N, move through
// the steps once the take runs; each move is a `step` marker. The window takes its content's height.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PrompterState } from '../../shared/ipc';
import { bridge } from '../bridge';

/** The window's margin around the card (its shadow), as the main process places it. */
const MARGIN = 10;

export function Prompter() {
  const [state, setState] = useState<PrompterState>({ steps: [], index: 0, live: false });
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => bridge.on('prompter:state', setState), []);
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    let last = 0;
    const report = () => {
      const height = Math.ceil(element.getBoundingClientRect().height) + 2 * MARGIN;
      if (height === last) return;
      last = height;
      void bridge.invoke('prompter:size', { height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const step = state.steps[state.index];
  const next = state.steps[state.index + 1];
  return (
    <div className="prompter-wrap">
      <div className={`prompter${state.live ? '' : ' waiting'}`} ref={card} role="region" aria-label="Script" data-testid="prompter">
        <div className="prompter-progress" aria-hidden="true">
          {state.steps.map((_, i) => (
            <i key={i} className={i < state.index ? 'done' : i === state.index ? 'now' : undefined} />
          ))}
        </div>
        <div className="prompter-head">
          <span className="prompter-count" data-testid="prompter-count">
            Step {state.index + 1} of {state.steps.length}
            {!state.live && <small> · starts with the recording</small>}
          </span>
          <button
            className="back"
            onClick={() => void bridge.invoke('prompter:previous')}
            disabled={!state.live || state.index === 0}
            title="The step before (Ctrl+Shift+Alt+B)"
            aria-label="The step before"
            data-testid="prompter-back"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
          </button>
          <button
            className="next"
            onClick={() => void bridge.invoke('prompter:next')}
            disabled={!state.live || !next}
            title="The next step (Ctrl+Shift+Alt+N)"
            data-testid="prompter-next"
          >
            Next
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          </button>
        </div>
        <h1 className="prompter-title" data-testid="prompter-title">
          {step?.title}
        </h1>
        {step?.note && <p className="prompter-note">{step.note}</p>}
        <div className="prompter-then">
          {next ? (
            <>
              Then <b>{next.title}</b>
            </>
          ) : (
            'The last step'
          )}
        </div>
      </div>
    </div>
  );
}
```

In `apps/desktop/scripts/build.mjs`, replace:

```js

rmSync(at('dist'), { recursive: true, force: true });
await build({ configFile: at('vite.main.config.ts') });
for (const kind of ['editor', 'pill', 'picker', 'hud', 'countdown', 'settings']) {
  await build({
    configFile: false,
    root: desktop,
```

with:

```js

rmSync(at('dist'), { recursive: true, force: true });
await build({ configFile: at('vite.main.config.ts') });
for (const kind of ['editor', 'pill', 'picker', 'hud', 'prompter', 'countdown', 'settings']) {
  await build({
    configFile: false,
    root: desktop,
```

In `apps/desktop/vite.renderer.config.ts`, replace:

```ts
        pill: fileURLToPath(new URL('./src/renderer/pill.html', import.meta.url)),
        picker: fileURLToPath(new URL('./src/renderer/picker.html', import.meta.url)),
        hud: fileURLToPath(new URL('./src/renderer/hud.html', import.meta.url)),
        countdown: fileURLToPath(new URL('./src/renderer/countdown.html', import.meta.url)),
        settings: fileURLToPath(new URL('./src/renderer/settings.html', import.meta.url)),
      },
```

with:

```ts
        pill: fileURLToPath(new URL('./src/renderer/pill.html', import.meta.url)),
        picker: fileURLToPath(new URL('./src/renderer/picker.html', import.meta.url)),
        hud: fileURLToPath(new URL('./src/renderer/hud.html', import.meta.url)),
        prompter: fileURLToPath(new URL('./src/renderer/prompter.html', import.meta.url)),
        countdown: fileURLToPath(new URL('./src/renderer/countdown.html', import.meta.url)),
        settings: fileURLToPath(new URL('./src/renderer/settings.html', import.meta.url)),
      },
```

- [ ] **Step 5: The prompter's window, and the pick's script into the take and the project**

`apps/desktop/src/main/prompter.ts`:

```ts
// The prompter's window during a take (Prompter.tsx): by the HUD, never in the video, never focused.
// It follows the take's `step` markers; its buttons ask the recorder for the next step or the one
// before, as the step keys do.
import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from 'electron';
import { prompterPosition, type PrompterState, type ScriptStep } from '../shared/recording';
import { HIDDEN } from './check';
import { bindRequests, send } from './ipc';
import { APP_ORIGIN } from './protocols';
import { recorderHost } from './recorder-host';

/** As wide as the HUD's window (its card and a margin for the shadow); as high as its content, within these. */
export const PROMPTER_WIDTH = 512;
const MIN_HEIGHT = 96;
const MAX_HEIGHT = 480;

export interface Prompter {
  readonly window: BrowserWindow;
  /** The take is at this step now (a `step` marker's label: the step's id). */
  reached(id: string): void;
  /** The take runs (the buttons work), or it stops. */
  setLive(live: boolean): void;
  destroy(): void;
}

/**
 * Opens the prompter by the HUD (`hud`, DIP) on the work area of its display; `onBounds` hears
 * every move and new height (its area is a dead zone). `open` makes the overlay window.
 */
export function openPrompter(
  open: (bounds: Rectangle, preload: string, options: BrowserWindowConstructorOptions) => BrowserWindow,
  hud: Rectangle,
  workArea: Rectangle,
  steps: readonly ScriptStep[],
  onBounds: () => void,
): Prompter {
  const size = { width: PROMPTER_WIDTH, height: 160 };
  const place = prompterPosition(hud, workArea, size);
  const window = open({ x: place.x, y: place.y, ...size }, 'prompter.cjs', { focusable: false, movable: true });
  const state: PrompterState = { steps: steps.map(({ title, note }) => ({ title, ...(note && { note }) })), index: 0, live: false };
  const show = () => send(window.webContents, 'prompter:state', { ...state });
  bindRequests(window.webContents, 'prompter', {
    'prompter:next': () => recorderHost.nextStep(),
    'prompter:previous': () => recorderHost.previousStep(),
    'prompter:size': ({ height }) => {
      if (window.isDestroyed()) return;
      const bounds = window.getContentBounds();
      const fitted = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)));
      if (fitted === bounds.height) return;
      // under the HUD it grows down; over it, up
      window.setContentBounds({ ...bounds, y: place.below ? bounds.y : bounds.y + bounds.height - fitted, height: fitted });
      onBounds();
    },
  });
  window.on('moved', onBounds);
  void window.loadURL(`${APP_ORIGIN}/prompter.html`).then(
    () => {
      if (window.isDestroyed()) return;
      show();
      if (!HIDDEN) window.showInactive();
    },
    () => {},
  );
  return {
    window,
    reached(id) {
      const index = steps.findIndex((step) => step.id === id);
      if (index < 0 || index === state.index) return;
      state.index = index;
      show();
    },
    setLive(live) {
      if (live === state.live) return;
      state.live = live;
      show();
    },
    destroy() {
      if (!window.isDestroyed()) window.destroy();
    },
  };
}
```

In `apps/desktop/src/main/recording.ts`, replace:

```ts
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { BrowserWindow, desktopCapturer, dialog, globalShortcut, screen, session, shell, systemPreferences, type Rectangle } from 'electron';
import { PROJECT_FILE, newProjectFile, projectExists, readProjectFile, recoverTake, useTake, writeProjectFile } from '@cuttle/core';
import { focusWindow, recentClaudeFolders, type Devices, type RecorderEvent, type Take } from '@cuttle/recorder';
import type { HudState, PickedTarget, PickerSetup, RecordChoices } from '../shared/ipc';
import { captureSourceFor, hudPosition, hudWarning, recordingFailure, stopOptionsFor, type PickerDisplay, type PickerWindow } from '../shared/recording';
import { displayPixels, monitorOf, setMonitors, toDesktopPixels, toDip } from './desktop-pixels';
import { CHECK, COUNTDOWN, HIDDEN, TEST_BACKEND } from './check';
import { bindRequests, send } from './ipc';
```

with:

```ts
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { BrowserWindow, desktopCapturer, dialog, globalShortcut, screen, session, shell, systemPreferences, type Rectangle } from 'electron';
import { PROJECT_FILE, newProjectFile, projectExists, readProjectFile, recoverTake, useTake, writeProjectFile } from '@cuttle/core';
import { usedIds } from '@cuttle/project';
import { focusWindow, recentClaudeFolders, type Devices, type RecorderEvent, type Take } from '@cuttle/recorder';
import type { HudState, PickedTarget, PickerSetup, RecordChoices } from '../shared/ipc';
import { captureSourceFor, hudPosition, hudWarning, recordingFailure, scriptForTake, stopOptionsFor, type PickerDisplay, type PickerWindow, type ScriptStep } from '../shared/recording';
import { displayPixels, monitorOf, setMonitors, toDesktopPixels, toDip } from './desktop-pixels';
import { CHECK, COUNTDOWN, HIDDEN, TEST_BACKEND } from './check';
import { bindRequests, send } from './ipc';
```

In the same file, replace:

```ts
import { findFfmpeg } from './tools';
import { loadSettings, updateSettings } from './settings';
import { maskPrivacy } from './privacy';
import { transcribeProject } from './speech';
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, sendToEditor, setEditorStatus, showPill, webPreferences } from './windows';
```

with:

```ts
import { findFfmpeg } from './tools';
import { loadSettings, updateSettings } from './settings';
import { maskPrivacy } from './privacy';
import { openPrompter, type Prompter } from './prompter';
import { transcribeProject } from './speech';
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, sendToEditor, setEditorStatus, showPill, webPreferences } from './windows';
```

In the same file, replace:

```ts
let writing: Promise<void> | undefined;
/** The app quits: no recording starts any more, and a take written now is cut at its next open. */
let quitting = false;

/** Whether a take is being recorded into this project, or finished or cut for it: its takes stay as they are meanwhile. */
export function takesBusy(dir: string): boolean {
```

with:

```ts
let writing: Promise<void> | undefined;
/** The app quits: no recording starts any more, and a take written now is cut at its next open. */
let quitting = false;
/** The script the open pick records with: every display's picker edits this one. */
let pickScript: ScriptStep[] = [];
/** The project's script when the pick opened (JSON), what `pickScript` started from. */
let pickBase = '[]';
/**
 * Scripts typed in a picker and not recorded with yet (the pick was cancelled), per project key
 * ('' for a new project), with the project's script they started from: they come back in the next
 * pick unless the project's script changed meanwhile (Claude wrote one).
 */
const scriptDrafts = new Map<string, { base: string; steps: ScriptStep[] }>();
const draftKey = (dir: string | undefined) => (dir === undefined ? '' : keyOf(dir));

/** Whether a take is being recorded into this project, or finished or cut for it: its takes stay as they are meanwhile. */
export function takesBusy(dir: string): boolean {
```

In the same file, replace:

```ts
    }
    const displays = pickerDisplays(devices);
    const choices = await choicesNow();
    const free = await freeBytes(projectDir ?? (await loadSettings()).projectsFolder);
    const warning = free !== undefined && free < tenMinutes(displays) ? `Only ${gigabytes(free)} free on this drive: a take longer than a few minutes may not fit.` : undefined;
    const countdown = await countdownSeconds();
```

with:

```ts
    }
    const displays = pickerDisplays(devices);
    const choices = await choicesNow();
    const saved = JSON.stringify(projectDir ? await savedScript(projectDir) : []);
    const draft = scriptDrafts.get(draftKey(projectDir));
    pickBase = saved;
    pickScript = draft && draft.base === saved ? draft.steps : (JSON.parse(saved) as ScriptStep[]);
    const free = await freeBytes(projectDir ?? (await loadSettings()).projectsFolder);
    const warning = free !== undefined && free < tenMinutes(displays) ? `Only ${gigabytes(free)} free on this drive: a take longer than a few minutes may not fit.` : undefined;
    const countdown = await countdownSeconds();
```

In the same file, replace:

```ts
    listingDevices: !problem,
    ...((problem ?? unknown) && { problem: problem ?? unknown }),
    ...(warning && { warning }),
  };
  bindRequests(window.webContents, 'picker', {
    'picker:setup': () => picker.setup,
```

with:

```ts
    listingDevices: !problem,
    ...((problem ?? unknown) && { problem: problem ?? unknown }),
    ...(warning && { warning }),
    script: pickScript,
  };
  bindRequests(window.webContents, 'picker', {
    'picker:setup': () => picker.setup,
```

In the same file, replace:

```ts
        if (other !== picker) send(other.window.webContents, 'picker:choices', next);
      }
    },
    'picker:record': (target) => void beginRecording(target, displays),
    'picker:cancel': () => endPicking(true),
    'picker:retry': async () => {
```

with:

```ts
        if (other !== picker) send(other.window.webContents, 'picker:choices', next);
      }
    },
    'picker:script': (steps) => {
      pickScript = steps;
      scriptDrafts.set(draftKey(pickingFor), { base: pickBase, steps });
      for (const other of pickers) {
        if (other.setup) other.setup.script = steps;
        if (other !== picker) send(other.window.webContents, 'picker:script', steps);
      }
    },
    'picker:record': (target) => void beginRecording(target, displays),
    'picker:cancel': () => endPicking(true),
    'picker:retry': async () => {
```

In the same file, replace:

```ts
  );
}

/** The take folder number a project uses now (`takes/<n>/screen.mp4`), if any. */
function currentTake(raw: Record<string, unknown>): string | undefined {
  const screen = (raw.sources as { screen?: unknown } | undefined)?.screen;
```

with:

```ts
  );
}

/** A project's script as cuttle.json has it (none when it has no file yet, or one that does not parse). */
async function savedScript(dir: string): Promise<ScriptStep[]> {
  if (!projectExists(dir)) return [];
  const file = await readProjectFile(dir).catch(() => undefined);
  return file?.project.script.map(({ id, title, note }) => ({ id, title, ...(note !== undefined && { note }) })) ?? [];
}

/** The script a take recorded with goes into cuttle.json; without one, the project keeps none. */
function withScript(raw: Record<string, unknown>, script: readonly ScriptStep[]): void {
  if (script.length > 0) raw.script = script;
  else delete raw.script;
}

/** Writes the script a take recorded with into its project's cuttle.json. */
async function keepScript(dir: string, script: readonly ScriptStep[]): Promise<void> {
  const file = await readProjectFile(dir);
  withScript(file.raw, script);
  await writeProjectFile(file, 'record');
}

/** The take folder number a project uses now (`takes/<n>/screen.mp4`), if any. */
function currentTake(raw: Record<string, unknown>): string | undefined {
  const screen = (raw.sources as { screen?: unknown } | undefined)?.screen;
```

In the same file, replace:

```ts
  const display = displays.find((candidate) => candidate.id === target.display);
  const picked = pickers.find((picker) => picker.display === target.display)?.setup;
  const choices = picked?.choices ?? { stop: 'none' as const };
  const blocked = picked?.problem;
  let finished: () => void = () => {};
  writing = new Promise<void>((done) => (finished = done));
```

with:

```ts
  const display = displays.find((candidate) => candidate.id === target.display);
  const picked = pickers.find((picker) => picker.display === target.display)?.setup;
  const choices = picked?.choices ?? { stop: 'none' as const };
  const steps = pickScript;
  const blocked = picked?.problem;
  let finished: () => void = () => {};
  writing = new Promise<void>((done) => (finished = done));
```

In the same file, replace:

```ts
      if (blocked) say(blocked);
      return;
    }
    opened = await record(target, display, displays, picked, choices);
  } catch (error) {
    say(`Cuttle cannot record: ${(error as Error).message}`);
  } finally {
```

with:

```ts
      if (blocked) say(blocked);
      return;
    }
    opened = await record(target, display, displays, picked, choices, steps);
  } catch (error) {
    say(`Cuttle cannot record: ${(error as Error).message}`);
  } finally {
```

In the same file, replace:

```ts
  }
}

/** Records a pick into its project; returns whether the editor opens on the take. */
async function record(target: PickedTarget, display: PickerDisplay, displays: PickerDisplay[], picked: PickerSetup | undefined, choices: RecordChoices): Promise<boolean> {
  const source = captureSourceFor(target, display);
  const created = !pickingFor;
  const projectDir = pickingFor ?? (await newProjectDir());
  const project = keyOf(projectDir);
  // The project's editor is not in its own take: hidden (its player paused) while it records again, shown after.
```

with:

```ts
  }
}

/** Records a pick into its project, with the script typed for it; returns whether the editor opens on the take. */
async function record(target: PickedTarget, display: PickerDisplay, displays: PickerDisplay[], picked: PickerSetup | undefined, choices: RecordChoices, steps: ScriptStep[]): Promise<boolean> {
  const source = captureSourceFor(target, display);
  const created = !pickingFor;
  const draft = draftKey(pickingFor);
  const projectDir = pickingFor ?? (await newProjectDir());
  const project = keyOf(projectDir);
  // The project's editor is not in its own take: hidden (its player paused) while it records again, shown after.
```

In the same file, replace:

```ts
  let cutting = false;
  try {
    // The edit of the take the project uses now stays restorable ("Back to take n").
    if (projectExists(projectDir)) {
      const file = await readProjectFile(projectDir).catch(() => undefined);
      const take = file && currentTake(file.raw);
      if (take && existsSync(join(projectDir, 'takes', take))) await copyFile(join(projectDir, PROJECT_FILE), join(projectDir, 'takes', take, PROJECT_FILE)).catch(() => {});
    }

    const area = targetRect(target, display, picked);
    /** Takes a restart put aside, newest last (folders relative to the project). */
```

with:

```ts
  let cutting = false;
  try {
    // The edit of the take the project uses now stays restorable ("Back to take n").
    const file = projectExists(projectDir) ? await readProjectFile(projectDir).catch(() => undefined) : undefined;
    const take = file && currentTake(file.raw);
    if (take && existsSync(join(projectDir, 'takes', take))) await copyFile(join(projectDir, PROJECT_FILE), join(projectDir, 'takes', take, PROJECT_FILE)).catch(() => {});
    // the steps with a title, each with an id no other item of the project has
    const script = scriptForTake(steps, usedIds({ ...file?.raw, script: [] }));

    const area = targetRect(target, display, picked);
    /** Takes a restart put aside, newest last (folders relative to the project). */
```

In the same file, replace:

```ts
        },
      });
      bindRequests(countdown.webContents, 'countdown', {});
      const deadZone = () => toDesktopPixels(hud.getBounds());
      hud.on('moved', () => recorderHost.setDeadZones([deadZone()]));
      // Windows ends the session (sign out, shut down): the end waits while the take is stopped and written.
      hud.on('query-session-end', (event) => {
        event.preventDefault();
```

with:

```ts
        },
      });
      bindRequests(countdown.webContents, 'countdown', {});
      // The script's steps in the prompter by the HUD, from the countdown on (the first can be read before the take runs).
      let prompter: Prompter | undefined;
      const deadZones = () => [hud, ...(prompter ? [prompter.window] : [])].filter((window) => !window.isDestroyed()).map((window) => toDesktopPixels(window.getBounds()));
      if (script.length > 0) prompter = openPrompter(overlay, hud.getBounds(), display.workArea, script, () => recorderHost.setDeadZones(deadZones()));
      hud.on('moved', () => recorderHost.setDeadZones(deadZones()));
      // Windows ends the session (sign out, shut down): the end waits while the take is stopped and written.
      hud.on('query-session-end', (event) => {
        event.preventDefault();
```

In the same file, replace:

```ts
          case 'recording':
            closeOverlays();
            takeDir = event.dir;
            hudState.phase = 'recording';
            hudState.startedAt = Date.now();
            hudState.recorded = 0;
            if (!HIDDEN) hud.showInactive();
            showHud();
            watch = setInterval(() => void watchTake(), 2000);
            return;
          case 'paused':
```

with:

```ts
          case 'recording':
            closeOverlays();
            takeDir = event.dir;
            // the take goes into the project with its script: the draft is done
            scriptDrafts.delete(draft);
            hudState.phase = 'recording';
            hudState.startedAt = Date.now();
            hudState.recorded = 0;
            if (!HIDDEN) hud.showInactive();
            showHud();
            prompter?.setLive(true);
            watch = setInterval(() => void watchTake(), 2000);
            return;
          case 'paused':
```

In the same file, replace:

```ts
            showHud();
            return;
          case 'marker':
            // the mistake key's marker is a retake, not one of the person's markers
            if (event.marker.kind === 'retake') hudState.retakes = (hudState.retakes ?? 0) + 1;
            else hudState.markers++;
            showHud();
```

with:

```ts
            showHud();
            return;
          case 'marker':
            // a step of the script moves the prompter; the mistake key's marker is a retake: neither is one of the person's markers
            if (event.marker.kind === 'step') return prompter?.reached(event.marker.label ?? '');
            if (event.marker.kind === 'retake') hudState.retakes = (hudState.retakes ?? 0) + 1;
            else hudState.markers++;
            showHud();
```

In the same file, replace:

```ts
          }
          case 'stopping':
            hudState.phase = 'stopping';
            // a restart says so to the end ("Restarting…"), not "Stopping…"
            if (!restarting) note('Stopping…', 'Writing the take', 'info');
            return;
```

with:

```ts
          }
          case 'stopping':
            hudState.phase = 'stopping';
            prompter?.setLive(false);
            // a restart says so to the end ("Restarting…"), not "Stopping…"
            if (!restarting) note('Stopping…', 'Writing the take', 'info');
            return;
```

In the same file, replace:

```ts
            ...(choices.mic && { mic: choices.mic }),
            stop: stopOptionsFor(choices),
            countdownSeconds: countdownFor,
            deadZones: [deadZone()],
            // macOS: the app's own windows (the HUD above all) stay out of the take, as Windows keeps them out by content protection
            hideWindowsOf: [process.pid],
          },
```

with:

```ts
            ...(choices.mic && { mic: choices.mic }),
            stop: stopOptionsFor(choices),
            countdownSeconds: countdownFor,
            deadZones: deadZones(),
            ...(script.length > 0 && { steps: script.map((step) => step.id) }),
            // macOS: the app's own windows (the HUD above all) stay out of the take, as Windows keeps them out by content protection
            hideWindowsOf: [process.pid],
          },
```

In the same file, replace:

```ts
        clearInterval(watch);
        closeOverlays();
        if (!hud.isDestroyed()) hud.destroy();
        if (error instanceof RecordingError && error.code === 'cancelled') {
          // cancelled after a restart: the take put aside is the take after all
          const previous = discarded.pop();
          if (previous) {
            const back = await bringBack(projectDir, previous);
            if (back) {
              cutting = await recoverAndOpen(projectDir, back, '', showEditor, true);
              return cutting;
            }
          }
```

with:

```ts
        clearInterval(watch);
        closeOverlays();
        if (!hud.isDestroyed()) hud.destroy();
        prompter?.destroy();
        if (error instanceof RecordingError && error.code === 'cancelled') {
          // cancelled after a restart: the take put aside is the take after all
          const previous = discarded.pop();
          if (previous) {
            const back = await bringBack(projectDir, previous);
            if (back) {
              cutting = await recoverAndOpen(projectDir, back, '', showEditor, true, script);
              return cutting;
            }
          }
```

In the same file, replace:

```ts
        if (takeDir) {
          const previous = discarded.at(-1);
          if (previous) restarted.set(keyOf(projectDir), previous);
          cutting = await recoverAndOpen(projectDir, takeDir, (error as Error).message, showEditor);
          if (!cutting) restarted.delete(keyOf(projectDir));
          return cutting;
        }
```

with:

```ts
        if (takeDir) {
          const previous = discarded.at(-1);
          if (previous) restarted.set(keyOf(projectDir), previous);
          cutting = await recoverAndOpen(projectDir, takeDir, (error as Error).message, showEditor, false, script);
          if (!cutting) restarted.delete(keyOf(projectDir));
          return cutting;
        }
```

In the same file, replace:

```ts
        if (back) {
          const failure = recordingFailure((error as Error).message);
          say(`The recording could not start again. ${failure.text} The take from before the restart is kept.`, failure.detail);
          cutting = await recoverAndOpen(projectDir, back, '', showEditor, true);
          return cutting;
        }
        await giveUp();
```

with:

```ts
        if (back) {
          const failure = recordingFailure((error as Error).message);
          say(`The recording could not start again. ${failure.text} The take from before the restart is kept.`, failure.detail);
          cutting = await recoverAndOpen(projectDir, back, '', showEditor, true, script);
          return cutting;
        }
        await giveUp();
```

In the same file, replace:

```ts
      clearInterval(watch);
      closeOverlays();
      if (!hud.isDestroyed()) hud.destroy();
      if (restarting && !quitting) {
        // put aside, not deleted ("Undo restart" in the editor), and counted down again
        const aside = await putAside(projectDir, take.dir).catch((error: Error) => {
```

with:

```ts
      clearInterval(watch);
      closeOverlays();
      if (!hud.isDestroyed()) hud.destroy();
      prompter?.destroy();
      if (restarting && !quitting) {
        // put aside, not deleted ("Undo restart" in the editor), and counted down again
        const aside = await putAside(projectDir, take.dir).catch((error: Error) => {
```

In the same file, replace:

```ts
      // the editor that opens on this take offers to bring back the one a restart put aside
      const restartedFrom = discarded.at(-1);
      if (restartedFrom) restarted.set(keyOf(projectDir), restartedFrom);
      cutting = await finishTake(projectDir, take, showEditor);
      if (!cutting) restarted.delete(keyOf(projectDir));
      return cutting;
    }
```

with:

```ts
      // the editor that opens on this take offers to bring back the one a restart put aside
      const restartedFrom = discarded.at(-1);
      if (restartedFrom) restarted.set(keyOf(projectDir), restartedFrom);
      cutting = await finishTake(projectDir, take, showEditor, script);
      if (!cutting) restarted.delete(keyOf(projectDir));
      return cutting;
    }
```

In the same file, replace:

```ts

/**
 * A take that ended badly (the capture failed after it started): `recover` repairs it and points the
 * project at it, and it is cut like any other; `quiet`: a take brought back, nothing to say.
 * Returns whether the cut started.
 */
async function recoverAndOpen(projectDir: string, takeDir: string, why: string, showEditor: () => Promise<void>, quiet = false): Promise<boolean> {
  const dir = resolve(projectDir);
  const failure = recordingFailure(why);
  try {
    const result = await recoverTake(dir, takeDir);
    if (!quiet) say(`The recording stopped early. ${failure.text} Cuttle kept the ${Math.round(result.seconds)} s it had and opened it.`, [failure.detail, ...result.repaired].join('\n'));
  } catch (error) {
    await showEditor();
```

with:

```ts

/**
 * A take that ended badly (the capture failed after it started): `recover` repairs it and points the
 * project at it, and it is cut like any other; `quiet`: a take brought back, nothing to say. The
 * `script` it recorded with goes into the project too (none given: the project's stays). Returns
 * whether the cut started.
 */
async function recoverAndOpen(projectDir: string, takeDir: string, why: string, showEditor: () => Promise<void>, quiet = false, script?: readonly ScriptStep[]): Promise<boolean> {
  const dir = resolve(projectDir);
  const failure = recordingFailure(why);
  try {
    const result = await recoverTake(dir, takeDir);
    // a file that cannot take the script keeps its own: the take is what matters here
    if (script) await keepScript(dir, script).catch(() => {});
    if (!quiet) say(`The recording stopped early. ${failure.text} Cuttle kept the ${Math.round(result.seconds)} s it had and opened it.`, [failure.detail, ...result.repaired].join('\n'));
  } catch (error) {
    await showEditor();
```

In the same file, replace:

```ts
}

/**
 * The take becomes the project's (its previous version kept as a backup), the editor opens on it, and
 * `suggest` cuts it; while the app quits, it is cut at the project's next open instead. Returns
 * whether the cut started.
 */
async function finishTake(projectDir: string, take: Take, showEditor: () => Promise<void>): Promise<boolean> {
  try {
    const file = projectExists(projectDir) ? await readProjectFile(projectDir) : newProjectFile(projectDir);
    const hadEdit = useTake(file, take);
    await writeProjectFile(file, 'record', { backup: hadEdit });
  } catch (error) {
    await showEditor();
```

with:

```ts
}

/**
 * The take becomes the project's with the script it recorded with (its previous version kept as a
 * backup), the editor opens on it, and `suggest` cuts it; while the app quits, it is cut at the
 * project's next open instead. Returns whether the cut started.
 */
async function finishTake(projectDir: string, take: Take, showEditor: () => Promise<void>, script: readonly ScriptStep[]): Promise<boolean> {
  try {
    const file = projectExists(projectDir) ? await readProjectFile(projectDir) : newProjectFile(projectDir);
    const hadEdit = useTake(file, take);
    withScript(file.raw, script);
    await writeProjectFile(file, 'record', { backup: hadEdit });
  } catch (error) {
    await showEditor();
```

- [ ] **Step 6: The picker's Script**

`apps/desktop/src/renderer/picker/Script.tsx`:

```tsx
// The picker's script: the steps of the demo, which the prompter shows while recording (never in the
// video). A row per step: what it shows, and under it what to say. Enter in a title goes on to the
// next step (a new one at the end), Backspace in an empty one removes it, a pasted list becomes
// steps, and Esc closes the panel.
import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { SCRIPT_MAX_STEPS, STEP_NOTE_MAX, STEP_TITLE_MAX } from '@cuttle/project';
import { stepsFromText, type ScriptStep } from '../../shared/recording';

/** An id no step of `steps` has: the next `step<n>` (the recording makes it unique in the project). */
function freeId(steps: readonly ScriptStep[]): string {
  const taken = new Set(steps.map((step) => step.id));
  let n = 1;
  while (taken.has(`step${n}`)) n++;
  return `step${n}`;
}

/** Steps with a title, as the bar counts them. */
export const writtenSteps = (steps: readonly ScriptStep[]) => steps.filter((step) => step.title.trim() !== '').length;

export function ScriptIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M6.5 4h7M6.5 8h7M6.5 12h4.5" />
      <path d="M2.5 3.2 3.4 2.6v2.8M2.4 7.4c.3-.5 1.6-.6 1.6.3 0 .7-1.6 1.2-1.6 2h1.7" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

export function ScriptPanel({ steps, onChange, onClose, place }: { steps: ScriptStep[]; onChange: (steps: ScriptStep[]) => void; onClose: () => void; place: 'above' | 'below' }) {
  const titles = useRef(new Map<string, HTMLInputElement>());
  /** The step whose title gets the focus once it is drawn (a new one, or the one before a removed one). */
  const focusNext = useRef<string>(undefined);
  // the panel opens on the first empty title (a new script: its first step)
  useEffect(() => {
    if (steps.length === 0) {
      const id = freeId(steps);
      focusNext.current = id;
      onChange([{ id, title: '' }]);
      return;
    }
    titles.current.get((steps.find((step) => step.title.trim() === '') ?? steps.at(-1)!).id)?.focus();
  }, []); // only when the panel opens
  useEffect(() => {
    // once that step is drawn (the change comes back from the picker a render later)
    const element = focusNext.current === undefined ? undefined : titles.current.get(focusNext.current);
    if (!element) return;
    focusNext.current = undefined;
    element.focus();
  });

  const change = (id: string, fields: Partial<ScriptStep>) => onChange(steps.map((step) => (step.id === id ? { ...step, ...fields } : step)));
  const insertAfter = (index: number, added: Omit<ScriptStep, 'id'>[]) => {
    const next = [...steps];
    const made: ScriptStep[] = [];
    for (const step of added.slice(0, SCRIPT_MAX_STEPS - steps.length)) made.push({ id: freeId([...next, ...made]), ...step });
    next.splice(index + 1, 0, ...made);
    if (made.length > 0) focusNext.current = made.at(-1)!.id;
    onChange(next);
  };
  const remove = (index: number) => {
    const next = steps.filter((_, i) => i !== index);
    focusNext.current = (next[index - 1] ?? next[0])?.id;
    onChange(next);
  };

  const onTitleKey = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    const step = steps[index]!;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const following = steps[index + 1];
      if (following) titles.current.get(following.id)?.focus();
      else if (step.title.trim() !== '') insertAfter(index, [{ title: '' }]);
      return;
    }
    if (event.key === 'Backspace' && step.title === '' && !step.note && steps.length > 1) {
      event.preventDefault();
      remove(index);
    }
  };
  const onTitlePaste = (event: ClipboardEvent<HTMLInputElement>, index: number) => {
    const text = event.clipboardData.getData('text/plain');
    if (!/[\r\n]/.test(text.trim())) return;
    event.preventDefault();
    const pasted = stepsFromText(text, STEP_TITLE_MAX);
    if (pasted.length === 0) return;
    const step = steps[index]!;
    if (step.title.trim() !== '' || step.note) return insertAfter(index, pasted);
    // into an empty step: it takes the first, the rest follow it
    const [first, ...rest] = pasted;
    const next = steps.map((item, i) => (i === index ? { id: item.id, ...first! } : item));
    const made: ScriptStep[] = [];
    for (const added of rest.slice(0, SCRIPT_MAX_STEPS - steps.length)) made.push({ id: freeId([...next, ...made]), ...added });
    next.splice(index + 1, 0, ...made);
    focusNext.current = (made.at(-1) ?? next[index]!).id;
    onChange(next);
  };

  return (
    <div
      className={`script-panel ${place}`}
      id="script-panel"
      role="dialog"
      aria-label="Script"
      data-testid="script-panel"
      onKeyDown={(event) => {
        // Esc closes the panel, not the pick; the picker's keys (C, M, O, Enter) are for the bar
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="script-head">
        <b>Script</b>
        <span>The prompter shows it while you record, never in the video. Ctrl+Shift+Alt+N goes to the next step.</span>
        <button type="button" className="script-close" onClick={onClose} aria-label="Close the script" title="Close (Esc)">
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      </div>
      <ol className="script-steps">
        {steps.map((step, index) => (
          <li key={step.id} className="script-step">
            <span className="script-number" aria-hidden="true">
              {index + 1}
            </span>
            <div className="script-fields">
              <input
                ref={(element) => {
                  if (element) titles.current.set(step.id, element);
                  else titles.current.delete(step.id);
                }}
                value={step.title}
                maxLength={STEP_TITLE_MAX}
                placeholder={index === 0 ? 'What the first step shows' : 'What this step shows'}
                aria-label={`Step ${index + 1}`}
                onChange={(event) => change(step.id, { title: event.target.value })}
                onKeyDown={(event) => onTitleKey(event, index)}
                onPaste={(event) => onTitlePaste(event, index)}
                data-testid="script-title"
              />
              <textarea
                value={step.note ?? ''}
                maxLength={STEP_NOTE_MAX}
                rows={1}
                placeholder="What to say (optional)"
                aria-label={`Step ${index + 1}: what to say`}
                onChange={(event) => change(step.id, { note: event.target.value || undefined })}
                onInput={(event) => fit(event.currentTarget)}
                ref={(element) => {
                  if (element) fit(element);
                }}
                data-testid="script-note"
              />
            </div>
            <button type="button" className="script-remove" onClick={() => remove(index)} aria-label={`Remove step ${index + 1}`} title="Remove this step">
              <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
              </svg>
            </button>
          </li>
        ))}
      </ol>
      <div className="script-foot">
        <button type="button" className="script-add" onClick={() => insertAfter(steps.length - 1, [{ title: '' }])} disabled={steps.length >= SCRIPT_MAX_STEPS} data-testid="script-add">
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 2v8M2 6h8" />
          </svg>
          Add a step
        </button>
        <span>A pasted list becomes steps.</span>
      </div>
    </div>
  );
}

/** A note's box grows with its lines (up to its CSS max-height). */
function fit(area: HTMLTextAreaElement): void {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight}px`;
}
```

In `apps/desktop/src/renderer/picker/Picker.tsx`, replace:

```tsx
// The picker: one transparent window per display, over everything. Hovering lights the window under
// the pointer (the display where there is none), dragging draws a region; the bar sets the camera,
// the mic and when to stop, and Enter records. Never in a recording (content protection). The bar,
// the label and the camera bubble keep clear of what is about to be recorded where there is room.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PickedTarget, PickerSetup, Rect, RecordChoices } from '../../shared/ipc';
import { barPlacement, bubblePlacement, bubbleSize, dragRect, labelPlacement, matchMediaDevice, windowsAt } from '../../shared/recording';
import { bridge } from '../bridge';
import { FolderIcon, MicIcon, WarningIcon } from '../icons';
import { Select } from '../Select';

type Mode = 'auto' | 'screen' | 'window' | 'region';
type Shown = { kind: 'screen' | 'window' | 'region'; rect: Rect; title: string; pixels: { width: number; height: number }; window?: number; of?: [number, number] };
```

with:

```tsx
// The picker: one transparent window per display, over everything. Hovering lights the window under
// the pointer (the display where there is none), dragging draws a region; the bar sets the camera,
// the mic, when to stop and the script, and Enter records. Never in a recording (content protection).
// The bar, the label and the camera bubble keep clear of what is about to be recorded where there is room.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PickedTarget, PickerSetup, Rect, RecordChoices, ScriptStep } from '../../shared/ipc';
import { barPlacement, bubblePlacement, bubbleSize, dragRect, labelPlacement, matchMediaDevice, windowsAt } from '../../shared/recording';
import { bridge } from '../bridge';
import { FolderIcon, MicIcon, WarningIcon } from '../icons';
import { Select } from '../Select';
import { ScriptIcon, ScriptPanel, writtenSteps } from './Script';

type Mode = 'auto' | 'screen' | 'window' | 'region';
type Shown = { kind: 'screen' | 'window' | 'region'; rect: Rect; title: string; pixels: { width: number; height: number }; window?: number; of?: [number, number] };
```

In the same file, replace:

```tsx
  const [setup, setSetup] = useState<PickerSetup>();
  const [active, setActive] = useState(false);
  const [choices, setChoices] = useState<RecordChoices>({ stop: 'none' });
  const [mode, setMode] = useState<Mode>('auto');
  const [pointer, setPointer] = useState<{ x: number; y: number }>();
  const [cycle, setCycle] = useState(0);
```

with:

```tsx
  const [setup, setSetup] = useState<PickerSetup>();
  const [active, setActive] = useState(false);
  const [choices, setChoices] = useState<RecordChoices>({ stop: 'none' });
  const [script, setScript] = useState<ScriptStep[]>([]);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('auto');
  const [pointer, setPointer] = useState<{ x: number; y: number }>();
  const [cycle, setCycle] = useState(0);
```

In the same file, replace:

```tsx
      setSetup(next);
      setActive(next.active);
      setChoices(next.choices);
    });
    const offActive = bridge.on('picker:active', ({ display }) => setActive((current) => (setup ? display === setup.display.id : current)));
    const offChoices = bridge.on('picker:choices', (next) => setChoices(next));
    const offDevices = bridge.on('picker:devices', ({ cameras, mics, choices: listed }) => {
      setSetup((current) => (current ? { ...current, cameras, mics, listingDevices: false } : current));
      setChoices(listed);
```

with:

```tsx
      setSetup(next);
      setActive(next.active);
      setChoices(next.choices);
      setScript(next.script);
    });
    const offActive = bridge.on('picker:active', ({ display }) => setActive((current) => (setup ? display === setup.display.id : current)));
    const offChoices = bridge.on('picker:choices', (next) => setChoices(next));
    const offScript = bridge.on('picker:script', (next) => setScript(next));
    const offDevices = bridge.on('picker:devices', ({ cameras, mics, choices: listed }) => {
      setSetup((current) => (current ? { ...current, cameras, mics, listingDevices: false } : current));
      setChoices(listed);
```

In the same file, replace:

```tsx
      setSetup(initial);
      setActive(initial.active);
      setChoices(initial.choices);
    });
    return () => {
      offOpen();
      offActive();
      offChoices();
      offDevices();
    };
  }, [setup?.display.id]);
```

with:

```tsx
      setSetup(initial);
      setActive(initial.active);
      setChoices(initial.choices);
      setScript(initial.script);
    });
    return () => {
      offOpen();
      offActive();
      offChoices();
      offScript();
      offDevices();
    };
  }, [setup?.display.id]);
```

In the same file, replace:

```tsx
    void bridge.invoke('picker:record', target);
  }, [display, shown, recordReason]);

  const updateChoices = (change: Partial<RecordChoices>) => {
    const next = { ...choices, ...change };
    setChoices(next);
```

with:

```tsx
    void bridge.invoke('picker:record', target);
  }, [display, shown, recordReason]);

  const updateScript = (steps: ScriptStep[]) => {
    setScript(steps);
    void bridge.invoke('picker:script', steps);
  };
  const updateChoices = (change: Partial<RecordChoices>) => {
    const next = { ...choices, ...change };
    setChoices(next);
```

In the same file, replace:

```tsx
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key;
      const inField = event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement;
      if (key === 'Escape') return void bridge.invoke('picker:cancel');
      if (key === 'Enter') {
        if (inField) return;
```

with:

```tsx
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key;
      const inField = event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (key === 'Escape') return void bridge.invoke('picker:cancel');
      if (key === 'Enter') {
        if (inField) return;
```

In the same file, replace:

```tsx
      if (lower === 'c' && setup && setup.cameras.length > 0) return updateChoices({ camera: choices.camera ? undefined : firstCamera(setup.cameras) });
      if (lower === 'm' && setup && setup.mics.length > 0) return updateChoices({ mic: choices.mic ? undefined : setup.mics[0] });
      if (lower === 'o') return updateChoices({ stop: STOPS[(STOPS.indexOf(choices.stop) + 1) % STOPS.length]! });
      if (region && key.startsWith('Arrow')) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1 / (display?.scaleFactor ?? 1);
```

with:

```tsx
      if (lower === 'c' && setup && setup.cameras.length > 0) return updateChoices({ camera: choices.camera ? undefined : firstCamera(setup.cameras) });
      if (lower === 'm' && setup && setup.mics.length > 0) return updateChoices({ mic: choices.mic ? undefined : setup.mics[0] });
      if (lower === 'o') return updateChoices({ stop: STOPS[(STOPS.indexOf(choices.stop) + 1) % STOPS.length]! });
      if (lower === 'p') return setScriptOpen((open) => !open);
      if (region && key.startsWith('Arrow')) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1 / (display?.scaleFactor ?? 1);
```

In the same file, replace:

```tsx
  const kindName = shown?.kind === 'screen' ? 'Screen' : shown?.kind === 'window' ? 'Window' : 'Region';
  const effective = shown?.kind ?? (mode === 'auto' ? 'screen' : mode);
  const notice = blocked ?? setup.warning;

  return (
    <div className={`picker${active ? '' : ' inactive'}`} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} data-testid="picker">
```

with:

```tsx
  const kindName = shown?.kind === 'screen' ? 'Screen' : shown?.kind === 'window' ? 'Window' : 'Region';
  const effective = shown?.kind ?? (mode === 'auto' ? 'screen' : mode);
  const notice = blocked ?? setup.warning;
  const steps = writtenSteps(script);

  return (
    <div className={`picker${active ? '' : ' inactive'}`} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} data-testid="picker">
```

In the same file, replace:

```tsx
                  </button>
                ))}
            </div>
            <div className="divider" />
            <span title={recordReason ?? 'Record (Enter)'}>
              <button className="rec" onClick={record} disabled={!!recordReason} data-testid="picker-record">
```

with:

```tsx
                  </button>
                ))}
            </div>
            <div className={`opt${steps > 0 ? ' on' : ''}`}>
              <button
                className="toggle"
                onClick={() => setScriptOpen((open) => !open)}
                aria-expanded={scriptOpen}
                aria-controls="script-panel"
                title="The script: steps the prompter shows while you record, never in the video (P)"
                data-testid="picker-script"
              >
                <ScriptIcon />
                <span className="name">
                  Script
                  <small>{steps === 0 ? 'none' : `${steps} step${steps === 1 ? '' : 's'}`}</small>
                </span>
              </button>
            </div>
            {scriptOpen && <ScriptPanel steps={script} onChange={updateScript} onClose={() => setScriptOpen(false)} place={barAt.y > work.y + work.height / 2 ? 'above' : 'below'} />}
            <div className="divider" />
            <span title={recordReason ?? 'Record (Enter)'}>
              <button className="rec" onClick={record} disabled={!!recordReason} data-testid="picker-record">
```

In `apps/desktop/src/renderer/picker/picker.css`, replace:

```css
:root[data-motion='reduce'] .hud .dot {
  animation: none;
}
```

with:

```css
:root[data-motion='reduce'] .hud .dot {
  animation: none;
}

/* the prompter: the step now in large type, its note, and the step after it; as wide as the HUD */
.prompter-wrap {
  padding: 10px;
}
.prompter {
  width: 492px;
  padding: 12px 14px 12px 16px;
  border-radius: 16px;
  background: var(--overlay);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.07);
  -webkit-app-region: drag;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.prompter-progress {
  display: flex;
  gap: 3px;
  margin: 0 2px 2px 0;
}
.prompter-progress i {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: var(--raised-active);
  transition: background var(--normal);
}
.prompter-progress i.done {
  background: rgba(217, 119, 87, 0.45);
}
.prompter-progress i.now {
  background: var(--accent);
}
.prompter-head {
  display: flex;
  align-items: center;
  gap: 4px;
}
.prompter-count {
  flex: 1;
  min-width: 0;
  color: var(--muted);
  font-size: var(--size-s);
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.prompter-count small {
  font-size: inherit;
  font-weight: 400;
  color: var(--faint);
}
.prompter-head button {
  -webkit-app-region: no-drag;
  height: 30px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
}
.prompter-head button.back {
  width: 30px;
  justify-content: center;
}
.prompter-head button.next {
  padding: 0 8px 0 12px;
  background: var(--raised);
  color: var(--text);
  font-weight: 600;
}
.prompter-head button:hover:not(:disabled) {
  background: var(--raised-hover);
  color: var(--text);
}
.prompter-head button:disabled {
  opacity: 0.4;
}
.prompter-title {
  margin: 0;
  font-size: var(--size-xl);
  font-weight: 600;
  line-height: 1.25;
  color: var(--text);
  overflow-wrap: anywhere;
}
.prompter-note {
  margin: 0;
  font-size: var(--size-l);
  line-height: 1.45;
  color: #c9c9d1;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 290px;
  overflow-y: auto;
  -webkit-app-region: no-drag;
}
.prompter-then {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
  color: var(--faint);
  font-size: var(--size-s);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.prompter-then b {
  color: var(--muted);
  font-weight: 500;
  margin-left: 4px;
}

/* the script: a panel by the bar (over it in the lower half of the display), a row per step */
.script-panel {
  position: absolute;
  right: 0;
  width: 440px;
  max-width: calc(100vw - 32px);
  max-height: min(62vh, 560px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 10px 10px 14px;
  border-radius: 16px;
  background: var(--overlay);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(20px);
  white-space: normal;
  cursor: default;
}
.script-panel.above {
  bottom: calc(100% + 10px);
}
.script-panel.below {
  top: calc(100% + 10px);
}
.script-head {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
  padding-right: 4px;
}
.script-head b {
  font-size: var(--size-l);
  color: var(--text);
}
.script-head span {
  grid-column: 1;
  color: var(--muted);
  font-size: var(--size-s);
  line-height: 1.4;
}
.script-close {
  grid-column: 2;
  grid-row: 1 / 3;
  align-self: start;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: var(--muted);
}
.script-close:hover {
  background: var(--raised-hover);
  color: var(--text);
}
.script-steps {
  list-style: none;
  margin: 0;
  padding: 0 4px 0 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.script-step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px;
  border-radius: 11px;
  background: var(--raised);
}
.script-step:focus-within {
  box-shadow: inset 0 0 0 1px var(--line-strong);
}
.script-number {
  flex: none;
  width: 22px;
  height: 22px;
  margin-top: 4px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  background: var(--raised-active);
}
.script-fields {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.script-fields input,
.script-fields textarea {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  padding: 4px 6px;
  border-radius: 6px;
  resize: none;
  user-select: text;
}
.script-fields input {
  font-weight: 600;
}
.script-fields textarea {
  font-size: var(--size-s);
  color: #c9c9d1;
  line-height: 1.4;
  max-height: 120px;
  overflow-y: auto;
}
.script-fields input::placeholder,
.script-fields textarea::placeholder {
  color: var(--faint);
  font-weight: 400;
}
.script-fields input:focus,
.script-fields textarea:focus {
  background: rgba(255, 255, 255, 0.04);
}
.script-remove {
  flex: none;
  width: 24px;
  height: 24px;
  margin-top: 3px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: var(--faint);
  opacity: 0;
}
.script-step:hover .script-remove,
.script-step:focus-within .script-remove {
  opacity: 1;
}
.script-remove:hover {
  background: var(--raised-hover);
  color: var(--text);
}
.script-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-right: 4px;
}
.script-add {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 9px;
  background: var(--raised);
  color: var(--text);
  font-weight: 500;
}
.script-add:hover:not(:disabled) {
  background: var(--raised-hover);
}
.script-add:disabled {
  opacity: 0.4;
}
.script-foot span {
  color: var(--faint);
  font-size: var(--size-s);
}
```

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 7: The check**

A recording from the pill with a script typed in the picker:
- the first step typed, Enter, a list pasted;
- the prompter by the HUD, content-protected and never focused, as high as its card;
- Next, and the step markers;
- the project's script, the timeline's pins;
- "Record again" starts from the project's script.

A screenshot helper finds the picker of a given display.

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    );
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  };
  /** Opens a project folder as a second launch would, and finds its editor (others may be open: the takes recorded before). */
  const openEditor = async (dir: string): Promise<Page> => {
    const name = basename(dir);
```

with:

```ts
    );
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  };
  /** A screenshot of a picker: the window over its display (each display has its own). */
  const shotOfPicker = async (name: string, page: Page) => {
    if (!SHOTS) return;
    const setup = await page.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<{ display: { bounds: { x: number; y: number; width: number; height: number } } }> } }).cuttle.invoke('picker:setup'));
    const { x, y, width, height } = setup.display.bounds;
    const png = await app.evaluate(
      async ({ BrowserWindow }, centre) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => {
          const bounds = candidate.getBounds();
          return candidate.webContents.getURL().includes('/picker.html') && centre.x >= bounds.x && centre.x < bounds.x + bounds.width && centre.y >= bounds.y && centre.y < bounds.y + bounds.height;
        })!;
        window.webContents.invalidate();
        await new Promise((resolve) => setTimeout(resolve, 1600));
        return (await window.webContents.capturePage()).toPNG().toString('base64');
      },
      { x: x + width / 2, y: y + height / 2 },
    );
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  };
  /** Opens a project folder as a second launch would, and finds its editor (others may be open: the takes recorded before). */
  const openEditor = async (dir: string): Promise<Page> => {
    const name = basename(dir);
```

In the same file, replace:

```ts
    expect(await opened.locator('[data-testid=auto-group-retakes] .auto-count').textContent()).toBe('1 on');
  }, 120_000);

  it('restarts from the HUD on a held press only: the take is put aside, and Undo restart brings it back', async () => {
    const before = new Set(readdirSync(join(root, 'projects')));
    await recordThroughPicker(pillRecord, { stop: 'none' }, false);
```

with:

```ts
    expect(await opened.locator('[data-testid=auto-group-retakes] .auto-count').textContent()).toBe('1 on');
  }, 120_000);

  it("records with a script: typed in the picker (a pasted list becomes steps), the prompter by the HUD moves on with Next, and the steps become markers and the project's script", async () => {
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    await pillRecord();
    const { page } = await firstMonitorPicker();
    await page.evaluate(async () => {
      const bridge = (window as unknown as { cuttle: { invoke(channel: string, argument?: unknown): Promise<unknown> } }).cuttle;
      await bridge.invoke('picker:choices', { stop: 'none' });
      await bridge.invoke('picker:hover');
    });
    await page.waitForSelector('[data-testid=picker-script]');
    expect(await page.locator('[data-testid=picker-script] small').textContent()).toBe('none');
    await click(page, '[data-testid=picker-script]');
    await page.waitForSelector('[data-testid=script-panel]');
    // the first step's title has the focus: typed, and Enter goes on to a new step
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid)).toBe('script-title');
    await page.keyboard.type('Open the settings');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.locator('[data-testid=script-title]').count()).toBe(2);
    // a pasted list becomes steps, an indented line the note of the step above it
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', '2. Turn on dark mode\n   Say that it follows the system.\n3. Export the video');
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    const titles = () => page.locator('[data-testid=script-title]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    await expect.poll(titles).toEqual(['Open the settings', 'Turn on dark mode', 'Export the video']);
    expect(await page.locator('[data-testid=script-note]').nth(1).inputValue()).toBe('Say that it follows the system.');
    expect(await page.locator('[data-testid=picker-script] small').textContent()).toBe('3 steps');
    await shotOfPicker('46-script', page);
    // Esc closes the panel, not the pick
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=script-panel]', { state: 'detached' });
    await click(page, '[data-testid=picker-record]').catch(() => {});

    // the prompter: the first step from the countdown on, by the HUD, never in the video, never focused
    const prompter = await waitForPage(app, async (candidate) => candidate.url().includes('/prompter.html') && (await candidate.locator('[data-testid=prompter-title]').textContent()) === 'Open the settings');
    const hud = await runningHud();
    const windows = await app.evaluate(({ BrowserWindow }) => {
      const of = (part: string) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes(part))!;
      const [hud, prompter] = [of('/hud.html'), of('/prompter.html')];
      return { hud: hud.getBounds(), prompter: prompter.getBounds(), isProtected: prompter.isContentProtected(), focusable: prompter.isFocusable() };
    });
    expect(windows).toMatchObject({ isProtected: true, focusable: false, prompter: { x: windows.hud.x, width: windows.hud.width } });
    // right under the HUD, or right over it
    expect([windows.hud.y + windows.hud.height - 10, windows.hud.y - windows.prompter.height + 10]).toContain(windows.prompter.y);
    await prompter.waitForSelector('[data-testid=prompter-next]:not([disabled])');
    expect(await prompter.locator('[data-testid=prompter-count]').textContent()).toBe('Step 1 of 3');
    await wait(800);
    await click(prompter, '[data-testid=prompter-next]');
    await expect.poll(() => prompter.locator('[data-testid=prompter-title]').textContent()).toBe('Turn on dark mode');
    expect(await prompter.locator('[data-testid=prompter-count]').textContent()).toBe('Step 2 of 3');
    expect(await prompter.locator('.prompter-note').textContent()).toBe('Say that it follows the system.');
    expect(await prompter.locator('.prompter-then').textContent()).toBe('Then Export the video');
    // the window took its card's height and its margins
    const card = await prompter.locator('[data-testid=prompter]').evaluate((element) => element.getBoundingClientRect().height);
    const prompterHeight = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/prompter.html'))!.getContentBounds().height);
    await expect.poll(prompterHeight).toBe(Math.ceil(card) + 20);
    // the steps are not the person's markers: the HUD counts none
    expect(await hud.locator('.marker small').count()).toBe(0);
    await shotOf('47-prompter', '/prompter.html');
    await wait(600);
    await click(hud, '[data-testid=hud-stop]');

    const dir = await newProject(before);
    const written = (await projectWhen(dir, (file) => file.scenes[0]?.id !== undefined)) as unknown as { script?: unknown };
    expect(written.script).toEqual([
      { id: 'step1', title: 'Open the settings' },
      { id: 'step2', title: 'Turn on dark mode', note: 'Say that it follows the system.' },
      { id: 'step3', title: 'Export the video' },
    ]);
    const { markers } = JSON.parse(readFileSync(join(dir, 'takes', '1', 'markers.json'), 'utf8')) as { markers: { t: number; kind: string; label?: string }[] };
    expect(markers.filter((marker) => marker.kind === 'step').map((marker) => [marker.label, marker.t > 0])).toEqual([
      ['step1', false],
      ['step2', true],
    ]);
    // the editor pins the steps on its timeline by their names
    const opened = await waitForPage(app, async (candidate) => candidate.url().includes('/editor.html') && (await candidate.title()) === `${basename(dir)} · Cuttle`);
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    await expect.poll(() => opened.evaluate(() => (window as unknown as { __cuttleCheck: Check }).__cuttleCheck.doc().undo), { timeout: 15_000 }).toBe("Cuttle's cut");
    await expect.poll(() => opened.locator('.flag span').allTextContents(), { timeout: 15_000 }).toContain('2 · Turn on dark mode');
    await shotOf('47b-step-pins', '/editor.html', `${basename(dir)} · Cuttle`);
    // Record again, once the take is in: the picker opens with the project's script
    await expect.poll(() => opened.locator('[data-testid=project-status]').count(), { timeout: 30_000 }).toBe(0);
    await click(opened, '[data-testid=record-again]');
    const again = await firstMonitorPicker();
    const bridge = (page: Page) => page.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<{ script: { title: string }[] }> } }).cuttle.invoke('picker:setup'));
    expect((await bridge(again.page)).script.map((step) => step.title)).toEqual(['Open the settings', 'Turn on dark mode', 'Export the video']);
    // the pickers close as the pick is cancelled
    await again.page.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('picker:cancel')).catch(() => {});
  }, 120_000);

  it('restarts from the HUD on a held press only: the take is put aside, and Undo restart brings it back', async () => {
    const before = new Set(readdirSync(join(root, 'projects')));
    await recordThroughPicker(pillRecord, { stop: 'none' }, false);
```

Run: `pnpm app:check`
Expected: PASS, 55 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop
git commit -m "app: the prompter by the HUD, the picker's Script, the script kept in the project, steps on the timeline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The guides

**Files:**
- Modify: `README.md`, `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`

- [ ] **Step 1: The README, the skill and its project guide**

In `README.md`, replace:

```markdown
(Ctrl+Shift+Option+R on a Mac) shows a picker over every display: the window under the pointer lights up (the display where there is none), a drag draws a
region, and the bar sets the camera, the mic and when to stop (your stop, Claude's answer, an idle
screen). After the countdown only a small HUD remains, which never appears in the video;
Ctrl+Shift+Alt+S stops and Ctrl+Shift+Alt+M sets a marker. Pause (the HUD, or Ctrl+Shift+Alt+P)
records nothing until you resume; the pieces are joined at the stop. Restart is a held press: the
take is put aside, the countdown starts again, and the editor offers "Undo restart". The editor
opens on the take at once while `suggest` cuts it in the background. "Record again" adds a take to
```

with:

```markdown
(Ctrl+Shift+Option+R on a Mac) shows a picker over every display: the window under the pointer lights up (the display where there is none), a drag draws a
region, and the bar sets the camera, the mic and when to stop (your stop, Claude's answer, an idle
screen). After the countdown only a small HUD remains, which never appears in the video;
Ctrl+Shift+Alt+S stops and Ctrl+Shift+Alt+M sets a marker. The bar's Script holds the steps of
the demo (a title each, and what to say; a pasted list becomes steps). While recording, a prompter
by the HUD shows the step now, its note and the step after it, never in the video:
Ctrl+Shift+Alt+N (or Next) goes on, Ctrl+Shift+Alt+B back, each step is a marker of the take, and
the script is kept in the project for the next take. Pause (the HUD, or Ctrl+Shift+Alt+P)
records nothing until you resume; the pieces are joined at the stop. Restart is a held press: the
take is put aside, the countdown starts again, and the editor offers "Undo restart". The editor
opens on the take at once while `suggest` cuts it in the background. "Record again" adds a take to
```

In `skill/cuttle/SKILL.md`, replace:

```markdown
  private windows, to switch on Do not disturb (Cuttle masks the notifications it sees, but none is
  better), and to use a clean folder or browser profile.
- The project folder: a new one per demo (`record` creates it).

## 2. Record
```

with:

```markdown
  private windows, to switch on Do not disturb (Cuttle masks the notifications it sees, but none is
  better), and to use a clean folder or browser profile.
- The project folder: a new one per demo (`record` creates it).
- A demo with steps (open this, then that) gets a script: write the steps into `cuttle.json`
  before the take (`script`, see [project.md](project.md); `cuttle init "<project>"` makes the
  folder first). The take starts at the first step, Ctrl+Shift+Alt+N moves to the next one
  (Ctrl+Shift+Alt+B back), and each step becomes a `step` marker. The prompter that shows the
  steps during the take is the app's: when the user records from the app ("Record again"), it
  sits by the recording bar. For `cuttle record`, list the steps for the user before the take.

## 2. Record
```

In the same file, replace:

```markdown
- `--max <seconds>` is the safety net (it counts recorded time, not pauses). The user can also stop
  with Ctrl+Shift+Alt+S, add a marker with Ctrl+Shift+Alt+M and pause or resume with
  Ctrl+Shift+Alt+P (Alt is Option on a Mac; nothing is recorded while paused; the pieces are
  joined at the stop). Other
  sources: `--window "<part of the title>"`, `--region x,y,w,h` (pixels of `--monitor`).
  `--countdown 3` is the default.
- A project open in the Cuttle app is refused (`project-open`): the app records it itself
```

with:

```markdown
- `--max <seconds>` is the safety net (it counts recorded time, not pauses). The user can also stop
  with Ctrl+Shift+Alt+S, add a marker with Ctrl+Shift+Alt+M and pause or resume with
  Ctrl+Shift+Alt+P (Alt is Option on a Mac; nothing is recorded while paused; the pieces are
  joined at the stop). With a script, Ctrl+Shift+Alt+N goes to the next step and
  Ctrl+Shift+Alt+B back, and the output shows each step (`step 2/5: Open the settings`). Other
  sources: `--window "<part of the title>"`, `--region x,y,w,h` (pixels of `--monitor`).
  `--countdown 3` is the default.
- A project open in the Cuttle app is refused (`project-open`): the app records it itself
```

In `skill/cuttle/project.md`, replace:

```markdown
`{ "t", "lines": [{ "text", "rect", "words": [{ "text", "rect" }] }] }`. Read it to find what the
screen showed where; never edit it.

`look` (every field is optional):

| Field | Values (default first) |
```

with:

```markdown
`{ "t", "lines": [{ "text", "rect", "words": [{ "text", "rect" }] }] }`. Read it to find what the
screen showed where; never edit it.

`script`: the demo's steps, written before the take, at most 50:
`[{ "id": "step1", "title": "Open the settings", "note": "The gear, top right." }]`. `id` is
unique in the project (the app gives `step1`, `step2` …); `title` says in up to 80 characters what
the step shows; `note` (optional, up to 1000) is what to say, shown only in the app's prompter and
never in the video. A take starts at the first step; the step key (Ctrl+Shift+Alt+N, back
Ctrl+Shift+Alt+B) or the prompter's buttons move on, and each move is a `step` marker.

`look` (every field is optional):

| Field | Values (default first) |
```

In the same file, replace:

```markdown
  with a numbered grid every 100 pixels (stronger lines every 500). Read the PNG and take rects off
  the grid; `frames/<t>s-grid.png` is the default file.
- `takes/<n>/markers.json` lists the prompt, each tool call and Claude's answer in source seconds,
  and each press of the mistake key (kind `retake`).
- `takes/<n>/events.jsonl` has the input: `move`, `click` and `scroll` with `x` and `y`, `keys`
  (presses per half second, never which keys) and the pointer's `shape`. On Windows it also has
  facts about the screen: `caret` with a `rect` (where text is typed, while it is, where the app
```

with:

```markdown
  with a numbered grid every 100 pixels (stronger lines every 500). Read the PNG and take rects off
  the grid; `frames/<t>s-grid.png` is the default file.
- `takes/<n>/markers.json` lists the prompt, each tool call and Claude's answer in source seconds,
  each press of the mistake key (kind `retake`), and where the take reached each step of the
  script (kind `step`, labelled with the step's id; the first at 0).
- `takes/<n>/events.jsonl` has the input: `move`, `click` and `scroll` with `x` and `y`, `keys`
  (presses per half second, never which keys) and the pointer's `shape`. On Windows it also has
  facts about the screen: `caret` with a `rect` (where text is typed, while it is, where the app
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 2: Commit**

```bash
git add README.md skill
git commit -m "docs: the script, the step keys and the prompter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 917 passed and 75 skipped (where a speech model is found, its real transcription runs too: 918 and 74; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 14 tests.

Run: `pnpm app:check`
Expected: PASS, 55 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. New recording: open Script in the bar, type three steps (Enter after each) with a note under one. Record: the prompter under the recording bar shows the first step while the countdown runs. Press Ctrl+Shift+Alt+N: the second step and its note show; Ctrl+Shift+Alt+B goes back. The video shows neither the bar nor the prompter.
2. Paste a numbered list into a step's title: each line becomes a step.
3. After the take, the timeline has a pin for each step ("2 · …"), and "Record again" opens with the same script.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **The first step's title did not get the focus** when the panel opened on an empty script: the panel asked for the focus before the step it had just made was drawn. It now waits until the step is there.
- **The prompter's window was a pixel higher than asked** at 125 %: a frameless window's outer bounds round up. It sets and reads its content bounds.
- **The script's ids were first one of the editor's item lists**, which every list of the editor would have had to name. They are counted by `usedIds` instead.

**Spec points that move**
- To **P5-M3b**: each step as a chapter (in the video's file and as a list for YouTube), a caption and a zoom point, and a motion template for a step's title.
- **A prompter for `cuttle record`** (it records without the app) is not built: the skill has Claude list the steps for the user. It could come with a later milestone if the user wants it.

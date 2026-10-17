# Cuttle P2-M0: Shared Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix, in the shared packages, what every editor would hit, before the desktop app is built: a split or a speed change in one piece of footage plays on without a crossfade, a held frame or a dip in the sound; zoom ramps and text fades run in output seconds across speed changes; scenes and overlays carry optional ids and labels; the CLI's project operations move into `@cuttle/core`; and a write of `cuttle.json` never overwrites what another program saved meanwhile.

**Architecture:** `@cuttle/timeline` learns continuous cuts (two clips where the first ends where the second begins) and computes, per zoom and text, its occurrences in output time; ramps run inside an occurrence. `@cuttle/export` drops the audio fade at such cuts. `@cuttle/project` gains `id` and `label` on scenes, zooms, masks and texts, a unique-id check and an id helper. The new `@cuttle/core` holds what the CLI did with a project (the file as written, takes, suggest, recover, frame, ffmpeg); the CLI's commands become thin wrappers that print. Reading `cuttle.json` records its SHA-256; writing refuses with `CoreError('conflict')` when the file on disk changed.

**Tech Stack:** TypeScript 5, Node 22, zod 4, vitest 5 (Node and browser projects), Electron 44, ffmpeg 9.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-desktop-design.md` (sections "Changes to the shared packages" and "Testing"; milestone P2-M0). Phase 1: `docs/superpowers/specs/2026-10-16-cuttle-design.md` and the plans of M1–M6.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p2-m0`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- The export, CLI and engine checks need ffmpeg and ffprobe on PATH. The task steps run only the tests they touch; the full `pnpm test` runs in Task 8.
- Golden images: a new scenario writes its PNG and fails once. Look at every new PNG before running the tests again; never rewrite goldens with `-u` without looking.

## Decisions made while planning

A prototype of the whole milestone (a clone of `main`) settled these points. On the prototype, `pnpm test` passes 398 tests (5 skipped), `pnpm typecheck` exits with 0, and `pnpm engine:electron`, `pnpm export:check` and `pnpm cli:check` pass.

- **A continuous cut** is a boundary between two clip scenes where the first's `to` is within 1 ms of the second's `from` (`isContinuousCut`, `CONTINUOUS_CUT_SECONDS = 1e-3` in `@cuttle/timeline`). It is what `suggest`'s speed-ups and every split make. There the timeline has no crossfade (`halfBetween` is 0), so no frame is held or frozen; other boundaries keep the crossfade.
- **Overlay ramps in output time.** Before, a zoom's 0.6 s ramps and a text's 0.25 s fades were converted to source seconds with the speed of the clip on screen: a zoom across a 1× | 4× boundary jumped and even went backwards (2111 → 2543 px wide in one frame in the test). Now:
  - `occurrences(spans, start, end)` gives, per span, the stretch of output time that shows the overlay's source range `[start, end)`: a run of clips joined over continuous cuts (`{ start, end, rampIn, rampOut }` in output seconds). Spans joined by a continuous cut share one object.
  - `rampIn` is set where the occurrence shows the overlay's start, `rampOut` where it shows its end. A cut into the middle of a zoom lands fully zoomed; a cut out of it leaves it without ramping out.
  - `rampAmount(occurrence, t, ramp, ease)` ramps over `ramp` output seconds (0.6 for zooms with their ease, 0.25 linear for texts), shrunk to fit a short occurrence (its length divided by the number of ramps it has).
  - The time `t` is the output time of the source frame a layer shows (`span.start + (sourceTime − from) / speed`), so a held or frozen frame in a crossfade keeps its own ramp state.
  - `zoomRectAt(zooms, sourceTime, amountOf, full)` and `activeTexts(texts, sourceTime, opacityOf)` take the per-item amount instead of a speed. For an overlay inside one clip, the result equals the old one (every existing golden image still matches).
- **The goldens show it.** Two new scenarios at the 1× | 4× boundary (`speed-change-zoom`: halfway into the zoom, one layer, no ghost; `speed-change-caption`: 40 % into the fade-out). A split cannot be seen in one still of a static screen, so a pixel-equality check renders the clip whole and split at 5 s, with a zoom ramping across the split, at 4.9, 5 and 5.1 s.
- **Audio.** `planAudio` has no fade at a continuous cut where the sound runs on at the same speed (both clips audible, equal speeds): the exported audio of a split clip equals the whole clip's (checked through ffmpeg, under 1e-4). Where the sound changes speed or stops at a continuous cut (1× into a muted or sped-up clip), it keeps the 10 ms fade that keeps a cut from clicking; the spec said "no audio fade", and 10 ms is no audible dip.
- **Ids and labels.** Every scene, zoom, mask and text may carry `id` (`^[A-Za-z0-9_-]{1,64}$`) and `label` (up to 200 characters). Ids are unique across the whole project; the check is a root `superRefine` and reports the path and the first user (`texts[0].id: the id "a" is already used by scenes[0]`), after every other problem is fixed (zod skips a root refinement while other issues exist). `@cuttle/project` exports `ID_PATTERN`, `ID_PREFIXES` (`s`, `z`, `m`, `t`), `usedIds(project)` (parsed or as written) and `newId(list, taken)` (the smallest free number).
- **`suggest` names what it makes.** Its clips get ids no kept item uses and labels from Claude's markers: a speed-up during Claude's turn is "Claude at work", another speed-up "Waiting", the 1× clip with the answer "Answer", the one with the prompt "Prompt". The answer's zoom is labelled "Answer". Keys are written in the order `type, id, label, from, to, speed`.
- **`@cuttle/core`** (no build step, like the other packages: `exports` points at `src/index.ts`). It holds `project-file.ts`, `use-take.ts`, `ffmpeg.ts`, `suggest/*` (moved from the CLI with `git mv`), and the operations `suggestProject`, `recoverTake` and `grabFrame`, which were the bodies of the CLI's commands. Their errors are `CoreError` with the codes `usage`, `invalid-project`, `missing-file`, `invalid-media`, `ffmpeg-missing` and `conflict`; the CLI maps them to exit codes by code, as before. The commands `suggest`, `recover` and `frame` call core and print; `init`, `record`, `preview`, `capture-page` and `render` import from core.
- **Writes that see each other.**
  - `readProjectFile` records the SHA-256 of the bytes it read (`ProjectFile.hash`).
  - `writeProjectFile(file, operation)` reads the file on disk again first and refuses with `CoreError('conflict')` when its hash differs, when it was deleted, or (for a new project) when it appeared: `<path> changed while <operation> ran; nothing was written, run it again`. The CLI exits with 1, like any invalid input.
  - It updates the `ProjectFile` it was given (project and hash), so a second write of the same file is no conflict. The check and the rename leave a window of a few milliseconds; the app and the CLI save rarely enough.
  - `suggest` and `recover` read once and write once, so a save during their run is refused. `record` and `capture-page --add` change nothing that depends on the earlier read: they read the file again right before they write, so an edit made during a take or a capture is kept (in the backup, and in `look`).
- **The skill** keeps ids and labels (`project.md` documents them and continuous cuts) and knows the `conflict` error: read the file again and rerun.
- **A flaky recorder test.** Under the full suite's load, phase 1's `records a 3 s take with every track` failed twice in six runs: its marker, set 1 s after `record()` by a timer, landed at 0.498 s, because the screen's first frame (where marker times count from) came half a second late. It now expects the marker at the wall-clock time it was set minus the screen's start from take.json (within 0.05 s).

## File structure

```
cuttle/
├── package.json                    typecheck covers packages/core
├── README.md                       @cuttle/core; the timeline's continuous cuts
├── packages/recorder/test/record.test.ts   the marker test counts from the screen's start
├── packages/project/
│   ├── src/schema.ts               id and label; the unique-id check
│   ├── src/ids.ts                  ID_PREFIXES, usedIds, newId (new)
│   └── test/schema.test.ts, test/ids.test.ts
├── packages/timeline/
│   ├── src/time.ts                 isContinuousCut
│   ├── src/occurrences.ts          occurrences, rampAmount (new)
│   ├── src/zoom.ts, src/overlays.ts   amounts instead of a speed
│   ├── src/frame.ts                no crossfade at continuous cuts; ramps per occurrence
│   └── test/…                      time, occurrences, zoom, overlays, frame
├── packages/engine/test/           two speed-change goldens; split equality checks
├── packages/export/src/audio.ts    no fade at continuous cuts
├── packages/core/                  @cuttle/core (new; files moved from apps/cli)
│   ├── src/project-file.ts         hash-checked writes
│   ├── src/suggest.ts, src/recover.ts, src/frame.ts   the operations
│   ├── src/suggest/plan.ts         clip labels
│   └── test/project-file.test.ts, test/suggest.test.ts, test/transcript.test.ts
├── apps/cli/                       commands call @cuttle/core; the conflict exit code
└── skill/cuttle/SKILL.md, project.md
```

---

### Task 1: The marker test on a loaded machine

**Files:**
- Modify: `packages/recorder/test/record.test.ts`

- [ ] **Step 1: Time the marker from the screen's start**

The plan was committed on the branch `p2-m0`; work there:

```bash
git switch p2-m0
```

In `packages/recorder/test/record.test.ts`, replace:

```ts
    const projectDir = project();
    const events: RecorderEvent[] = [];
    const recording = record({ ...test, projectDir, webcam: 'Test Camera', mic: 'Test Microphone', stop: { maxSeconds: 3 }, onEvent: (event) => events.push(event) });
    setTimeout(() => recording.marker('one second'), 1000);
    const take = await recording.done;

    expect(take).toEqual({
```

with:

```ts
    const projectDir = project();
    const events: RecorderEvent[] = [];
    const recording = record({ ...test, projectDir, webcam: 'Test Camera', mic: 'Test Microphone', stop: { maxSeconds: 3 }, onEvent: (event) => events.push(event) });
    let markedAt = 0;
    setTimeout(() => {
      markedAt = Date.now() / 1000;
      recording.marker('one second');
    }, 1000);
    const take = await recording.done;

    expect(take).toEqual({
```

In the same file, replace:

```ts
    expect(input.slice(0, 2)).toEqual([expect.objectContaining({ t: 0, type: 'move' }), { t: 0, type: 'shape', shape: 'arrow' }]);
    expect(new Set(input.map((event) => event.type))).toEqual(new Set(['move', 'shape', 'click', 'scroll', 'keys']));

    expect(markersOf(projectDir, take.markers)).toEqual([{ t: expect.closeTo(1, 0), kind: 'manual', label: 'one second' }]);
    expect(events.map((event) => event.type)).toEqual(['recording', 'marker', 'stopping']);
  }, SLOW);
```

with:

```ts
    expect(input.slice(0, 2)).toEqual([expect.objectContaining({ t: 0, type: 'move' }), { t: 0, type: 'shape', shape: 'arrow' }]);
    expect(new Set(input.map((event) => event.type))).toEqual(new Set(['move', 'shape', 'click', 'scroll', 'keys']));

    // Marker times count from the screen's first frame, which starts late on a loaded machine.
    const markedSecond = markedAt - takeFile.take.tracks.screen.start;
    expect(markersOf(projectDir, take.markers)).toEqual([{ t: expect.closeTo(markedSecond, 1), kind: 'manual', label: 'one second' }]);
    expect(events.map((event) => event.type)).toEqual(['recording', 'marker', 'stopping']);
  }, SLOW);
```

- [ ] **Step 2: Run the recorder's record tests**

Run: `pnpm exec vitest run packages/recorder/test/record.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 3: Commit**

```bash
git add packages/recorder/test/record.test.ts
git commit -m "recorder: the marker test counts from the screen's real start, which is late on a loaded machine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Ids and labels in the project format

**Files:**
- Create: `packages/project/src/ids.ts`, `packages/project/test/ids.test.ts`
- Modify: `packages/project/src/schema.ts`, `packages/project/src/index.ts`, `packages/project/test/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/project/test/ids.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { newId, usedIds } from '../src/ids';

describe('usedIds', () => {
  it('collects the ids of scenes and overlays, written or parsed, and skips the rest', () => {
    const raw = {
      scenes: [{ type: 'clip', id: 's1' }, { type: 'card' }, null, 'junk'],
      zooms: [{ id: 'answer' }],
      masks: 'not a list',
      texts: [{ id: 7 }],
    };
    expect([...usedIds(raw)]).toEqual(['s1', 'answer']);
    expect(usedIds({})).toEqual(new Set());
  });
});

describe('newId', () => {
  it('takes the smallest free number after the list prefix and marks it taken', () => {
    const taken = new Set(['s1', 's3', 'z1']);
    expect(newId('scenes', taken)).toBe('s2');
    expect(newId('scenes', taken)).toBe('s4');
    expect(newId('zooms', taken)).toBe('z2');
    expect(newId('masks', taken)).toBe('m1');
    expect(newId('texts', taken)).toBe('t1');
    expect(taken).toEqual(new Set(['s1', 's2', 's3', 's4', 'z1', 'z2', 'm1', 't1']));
  });
});
```

In `packages/project/test/schema.test.ts`, replace:

```ts
    });
  });

  it('rejects unknown keys and names them', () => {
    const r = ProjectSchema.safeParse({ ...minimal, look: { frame: { foo: 1 } } });
    expect(r.success).toBe(false);
```

with:

```ts
    });
  });

  it('keeps the optional id and label of scenes and overlays', () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [
        { type: 'clip', id: 's1', label: 'Claude at work', from: 0, to: 9, speed: 12 },
        { type: 'card', id: 'end-card', label: 'End', title: 'Done', duration: 2 },
      ],
      zooms: [{ id: 'z1', label: 'Answer', at: 1, duration: 2, rect: [0, 0, 10, 10] }],
      masks: [{ id: 'm_1', from: 0, to: 1, rect: [0, 0, 1, 1] }],
      texts: [{ label: '', at: 0, duration: 1, text: 'Hi' }],
    });
    expect(p.scenes.map((scene) => [scene.id, scene.label])).toEqual([['s1', 'Claude at work'], ['end-card', 'End']]);
    expect(p.zooms[0]).toMatchObject({ id: 'z1', label: 'Answer' });
    expect(p.masks[0]?.id).toBe('m_1');
    expect(p.texts[0]).toMatchObject({ label: '' });
    expect(ProjectSchema.parse({ ...minimal, zooms: [{ at: 1, duration: 2, rect: [0, 0, 10, 10] }] }).zooms[0]).not.toHaveProperty('id');
  });

  it('rejects an id with other characters, and one used twice anywhere in the project', () => {
    expect(pathsOf({ ...minimal, zooms: [{ id: 'zoom 1', at: 1, duration: 2, rect: [0, 0, 10, 10] }] })).toEqual(['zooms.0.id']);
    expect(pathsOf({ ...minimal, zooms: [{ id: '', at: 1, duration: 2, rect: [0, 0, 10, 10] }] })).toEqual(['zooms.0.id']);
    const twice = ProjectSchema.safeParse({
      ...minimal,
      scenes: [{ type: 'clip', id: 'a', from: 0, to: 1 }],
      masks: [{ id: 'b', from: 0, to: 1, rect: [0, 0, 1, 1] }],
      texts: [{ id: 'a', at: 0, duration: 1, text: 'Hi' }, { id: 'b', at: 0, duration: 1, text: 'Ho' }],
    });
    expect(twice.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['texts.0.id', 'the id "a" is already used by scenes[0]'],
      ['texts.1.id', 'the id "b" is already used by masks[0]'],
    ]);
  });

  it('rejects unknown keys and names them', () => {
    const r = ProjectSchema.safeParse({ ...minimal, look: { frame: { foo: 1 } } });
    expect(r.success).toBe(false);
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm exec vitest run packages/project`
Expected: FAIL: `test/ids.test.ts` cannot load (`Cannot find module '../src/ids'`); 2 tests fail and 43 pass: the two new schema tests (`id` is an unknown key: `expected [ 'zooms.0' ] to deeply equal [ 'zooms.0.id' ]`, and a ZodError).

- [ ] **Step 3: The ids and the schema**

`packages/project/src/ids.ts`:

```ts
/** The lists whose items carry ids, and the prefix of the ids Cuttle gives their new items. */
export const ID_PREFIXES = { scenes: 's', zooms: 'z', masks: 'm', texts: 't' } as const;

export type IdList = keyof typeof ID_PREFIXES;

/** The ids a project's items use; the project may be parsed or as written (unchecked). */
export function usedIds(project: Partial<Record<IdList, unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const list of Object.keys(ID_PREFIXES) as IdList[]) {
    const items = project[list];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const id = (item as { id?: unknown } | null)?.id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

/** A new id for an item of `list`: its prefix and the smallest number not in `taken`, which it is added to. */
export function newId(list: IdList, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `${ID_PREFIXES[list]}${n}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}
```

In `packages/project/src/schema.ts`, replace:

```ts
  transition: TransitionSchema.prefault({}),
});

const ClipSceneSchema = z
  .strictObject({
    type: z.literal('clip'),
    from: seconds,
    to: seconds,
    speed: z.number().positive().max(64).default(1),
```

with:

```ts
  transition: TransitionSchema.prefault({}),
});

// Scenes and overlays may carry an id (for editors: selection, undo; unique in the project) and a
// label (a name for people, e.g. "Answer").
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const named = {
  id: z.string().regex(ID_PATTERN, 'an id is 1 to 64 letters, digits, "-" or "_"').optional(),
  label: z.string().max(200).optional(),
};

const ClipSceneSchema = z
  .strictObject({
    type: z.literal('clip'),
    ...named,
    from: seconds,
    to: seconds,
    speed: z.number().positive().max(64).default(1),
```

In the same file, replace:

```ts

const StillSceneSchema = z.strictObject({
  type: z.literal('still'),
  image: z.string().min(1),
  duration: positiveSeconds,
  motion: z.enum(STILL_MOTIONS).default('none'),
```

with:

```ts

const StillSceneSchema = z.strictObject({
  type: z.literal('still'),
  ...named,
  image: z.string().min(1),
  duration: positiveSeconds,
  motion: z.enum(STILL_MOTIONS).default('none'),
```

In the same file, replace:

```ts

const CardSceneSchema = z.strictObject({
  type: z.literal('card'),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  duration: positiveSeconds,
```

with:

```ts

const CardSceneSchema = z.strictObject({
  type: z.literal('card'),
  ...named,
  title: z.string().min(1),
  subtitle: z.string().optional(),
  duration: positiveSeconds,
```

In the same file, replace:

```ts
const SceneSchema = z.discriminatedUnion('type', [ClipSceneSchema, StillSceneSchema, CardSceneSchema]);

const ZoomSchema = z.strictObject({
  at: seconds,
  duration: positiveSeconds,
  rect: RectSchema,
```

with:

```ts
const SceneSchema = z.discriminatedUnion('type', [ClipSceneSchema, StillSceneSchema, CardSceneSchema]);

const ZoomSchema = z.strictObject({
  ...named,
  at: seconds,
  duration: positiveSeconds,
  rect: RectSchema,
```

In the same file, replace:

```ts

const MaskSchema = z
  .strictObject({
    from: seconds,
    to: seconds,
    rect: RectSchema,
```

with:

```ts

const MaskSchema = z
  .strictObject({
    ...named,
    from: seconds,
    to: seconds,
    rect: RectSchema,
```

In the same file, replace:

```ts
  .refine((mask) => mask.to > mask.from, { message: '"to" must be greater than "from"', path: ['to'] });

const TextSchema = z.strictObject({
  at: seconds,
  duration: positiveSeconds,
  text: z.string().min(1),
```

with:

```ts
  .refine((mask) => mask.to > mask.from, { message: '"to" must be greater than "from"', path: ['to'] });

const TextSchema = z.strictObject({
  ...named,
  at: seconds,
  duration: positiveSeconds,
  text: z.string().min(1),
```

In the same file, replace:

```ts
  enabled: z.boolean().default(true),
});

export const ProjectSchema = z.strictObject({
  version: z.literal(CURRENT_VERSION),
  output: OutputSchema.prefault({}),
  sources: SourcesSchema,
  look: LookSchema.prefault({}),
  scenes: z.array(SceneSchema).default([]),
  zooms: z.array(ZoomSchema).default([]),
  masks: z.array(MaskSchema).default([]),
  texts: z.array(TextSchema).default([]),
});

// One line of events.jsonl. Times are source seconds (seconds since the screen track started).
// x and y are source pixels of the screen track (the recorder subtracts the capture origin and,
```

with:

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
        if (first === undefined) seen.set(item.id, `${list}[${index}]`);
        else ctx.addIssue({ code: 'custom', message: `the id "${item.id}" is already used by ${first}`, path: [list, index, 'id'] });
      });
    }
  });

// One line of events.jsonl. Times are source seconds (seconds since the screen track started).
// x and y are source pixels of the screen track (the recorder subtracts the capture origin and,
```

In `packages/project/src/index.ts`, replace:

```ts
  CURSOR_STYLES,
  EASES,
  FRAME_STYLES,
  MASK_STYLES,
  MOUSE_BUTTONS,
  STILL_MOTIONS,
```

with:

```ts
  CURSOR_STYLES,
  EASES,
  FRAME_STYLES,
  ID_PATTERN,
  MASK_STYLES,
  MOUSE_BUTTONS,
  STILL_MOTIONS,
```

In the same file, replace:

```ts
} from './schema';
export { formatPath, parseProject, parseProjectJson, type ParseResult, type ProjectIssue } from './parse';
export { defaultProject } from './defaults';
export { parseEventsJsonl } from './events';
export { TAKE_VERSION, TakeFileSchema, parseTakeJson, trackOffset, type TakeFile, type TakeFileParseResult, type TakeFileTrack } from './take';
export {
```

with:

```ts
} from './schema';
export { formatPath, parseProject, parseProjectJson, type ParseResult, type ProjectIssue } from './parse';
export { defaultProject } from './defaults';
export { ID_PREFIXES, newId, usedIds, type IdList } from './ids';
export { parseEventsJsonl } from './events';
export { TAKE_VERSION, TakeFileSchema, parseTakeJson, trackOffset, type TakeFile, type TakeFileParseResult, type TakeFileTrack } from './take';
export {
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run packages/project`
Expected: PASS, 47 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/project
git commit -m "project: optional id and label on scenes and overlays, ids unique in the project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Continuous cuts and overlay ramps in output time

**Files:**
- Create: `packages/timeline/src/occurrences.ts`, `packages/timeline/test/occurrences.test.ts`
- Modify: `packages/timeline/src/time.ts`, `packages/timeline/src/zoom.ts`, `packages/timeline/src/overlays.ts`, `packages/timeline/src/frame.ts`, `packages/timeline/src/index.ts`, and the tests of time, zoom, overlays and frame

- [ ] **Step 1: Write the failing tests**

The crossfade tests move to a second clip that starts a second after the first ends: their old fixture (clips 10–20 and 20–140) is now a continuous cut.

`packages/timeline/test/occurrences.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Scene } from '@cuttle/project';
import { occurrences, rampAmount, type Occurrence } from '../src/occurrences';
import { sceneSpans } from '../src/time';

const clip = (from: number, to: number, speed = 1): Scene => ({ type: 'clip', from, to, speed });
const card: Scene = { type: 'card', title: 'End', duration: 2 };

describe('occurrences', () => {
  it('maps an overlay inside one clip to output seconds', () => {
    // clip 10–20 at 2× is output 0–5; the overlay 12–16 shows at output 1–3
    expect(occurrences(sceneSpans([clip(10, 20, 2)]), 12, 16)).toEqual([{ start: 1, end: 3, rampIn: true, rampOut: true }]);
  });

  it('joins clips over continuous cuts into one occurrence', () => {
    // 0–5 at 1× (output 0–5), 5–25 at 4× (output 5–10): the overlay 4–9 shows at output 4–6
    const shown = occurrences(sceneSpans([clip(0, 5), clip(5, 25, 4), card]), 4, 9);
    expect(shown[0]).toEqual({ start: 4, end: 6, rampIn: true, rampOut: true });
    expect(shown[1]).toBe(shown[0]);
    expect(shown[2]).toBeUndefined();
  });

  it('keeps clips apart where the source jumps, without the ramp the cut hides', () => {
    // 0–5 then 7–10: the overlay 4–9 is cut in two; neither part shows both of its ends
    const shown = occurrences(sceneSpans([clip(0, 5), clip(7, 10)]), 4, 9);
    expect(shown).toEqual([
      { start: 4, end: 5, rampIn: true, rampOut: false },
      { start: 5, end: 7, rampIn: false, rampOut: true },
    ]);
  });

  it('leaves out spans that do not show the overlay', () => {
    expect(occurrences(sceneSpans([card, clip(0, 5), clip(20, 30)]), 6, 8)).toEqual([undefined, undefined, undefined]);
  });

  it('shows a repeated stretch once per repeat', () => {
    const shown = occurrences(sceneSpans([clip(0, 5), clip(0, 5)]), 1, 2);
    expect(shown).toEqual([
      { start: 1, end: 2, rampIn: true, rampOut: true },
      { start: 6, end: 7, rampIn: true, rampOut: true },
    ]);
  });
});

describe('rampAmount', () => {
  const both: Occurrence = { start: 10, end: 14, rampIn: true, rampOut: true };

  it('ramps in and out over the ramp length', () => {
    expect(rampAmount(both, 10, 0.6, 'linear')).toBe(0);
    expect(rampAmount(both, 10.3, 0.6, 'smooth')).toBeCloseTo(0.5, 9);
    expect(rampAmount(both, 12, 0.6, 'smooth')).toBe(1);
    expect(rampAmount(both, 13.85, 0.6, 'linear')).toBeCloseTo(0.25, 9);
  });

  it('shrinks the ramps to fit a short occurrence', () => {
    // 0.4 s with both ramps: 0.2 s each
    expect(rampAmount({ start: 0, end: 0.4, rampIn: true, rampOut: true }, 0.1, 0.6, 'linear')).toBeCloseTo(0.5, 9);
    // 0.4 s with only a ramp in: all of it
    expect(rampAmount({ start: 0, end: 0.4, rampIn: true, rampOut: false }, 0.2, 0.6, 'linear')).toBeCloseTo(0.5, 9);
  });

  it('is fully in where the occurrence has no ramp', () => {
    expect(rampAmount({ start: 5, end: 7, rampIn: false, rampOut: true }, 5, 0.6, 'smooth')).toBe(1);
    expect(rampAmount({ start: 5, end: 7, rampIn: false, rampOut: false }, 7, 0.6, 'smooth')).toBe(1);
  });
});
```

In `packages/timeline/test/time.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import type { ClipScene, Scene } from '@cuttle/project';
import { sceneDuration, sceneSpans, sourceTimeAt, spanAt, totalDuration } from '../src/time';

const clip = (from: number, to: number, speed = 1): ClipScene => ({ type: 'clip', from, to, speed });
const scenes: Scene[] = [clip(10, 20), clip(20, 140, 12), { type: 'card', title: 'End', duration: 2 }];
```

with:

```ts
import { describe, expect, it } from 'vitest';
import type { ClipScene, Scene } from '@cuttle/project';
import { isContinuousCut, sceneDuration, sceneSpans, sourceTimeAt, spanAt, totalDuration } from '../src/time';

const clip = (from: number, to: number, speed = 1): ClipScene => ({ type: 'clip', from, to, speed });
const scenes: Scene[] = [clip(10, 20), clip(20, 140, 12), { type: 'card', title: 'End', duration: 2 }];
```

In the same file, replace:

```ts
    expect(sourceTimeAt(slow, sceneDuration(slow))).toBe(0.7);
  });
});
```

with:

```ts
    expect(sourceTimeAt(slow, sceneDuration(slow))).toBe(0.7);
  });
});

describe('isContinuousCut', () => {
  it('is a cut between clips where the first ends where the second begins, within 1 ms', () => {
    expect(isContinuousCut(clip(10, 20), clip(20, 140, 12))).toBe(true);
    expect(isContinuousCut(clip(10, 20.0004), clip(20, 30))).toBe(true);
    expect(isContinuousCut(clip(10, 20), clip(20.002, 30))).toBe(false);
    expect(isContinuousCut(clip(10, 20), clip(0, 10))).toBe(false);
    expect(isContinuousCut(clip(10, 20), { type: 'card', title: 'End', duration: 2 })).toBe(false);
  });
});
```

`packages/timeline/test/zoom.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Rect, Zoom } from '@cuttle/project';
import { fitZoomRect, zoomRectAt } from '../src/zoom';

const full: Rect = [0, 0, 2560, 1440];
const zoom = (at: number, duration: number, rect: Rect, extra: Partial<Zoom> = {}): Zoom => ({
  at, duration, rect, ease: 'smooth', enabled: true, ...extra,
});
const half: Rect = [0, 0, 1280, 720];
/** Every zoom fully in (between its ramps). */
const full1 = (): number => 1;

describe('zoomRectAt', () => {
  it('returns the full frame outside every zoom', () => {
    expect(zoomRectAt([zoom(12, 4, half)], 11, full1, full)).toEqual(full);
    expect(zoomRectAt([zoom(12, 4, half)], 16.5, full1, full)).toEqual(full);
  });

  it('holds the target rect between the ramps', () => {
    expect(zoomRectAt([zoom(12, 4, half)], 14, full1, full)).toEqual(half);
  });

  it('moves each zoom its amount of the way to its rect', () => {
    expect(zoomRectAt([zoom(12, 4, half)], 12.3, () => 0.5, full)).toEqual([0, 0, 1920, 1080]);
    expect(zoomRectAt([zoom(12, 4, half)], 12.3, () => 0, full)).toEqual(full);
  });

  it('ignores disabled zooms', () => {
    expect(zoomRectAt([zoom(12, 4, half, { enabled: false })], 14, full1, full)).toEqual(full);
  });

  it('lets the zoom with the later start win when zooms overlap', () => {
    const later: Rect = [100, 100, 640, 360];
    expect(zoomRectAt([zoom(12, 4, half), zoom(13, 2, later)], 14, full1, full)).toEqual(later);
  });

  it('is active for at <= t < at + duration (half-open end)', () => {
    const z = [zoom(12, 4, half)];
    expect(zoomRectAt(z, 11.999, full1, full)).toEqual(full);
    expect(zoomRectAt(z, 12, full1, full)).toEqual(half);
    expect(zoomRectAt(z, 16, full1, full)).toEqual(full);
  });

  it('eases a later zoom from the rect produced so far instead of from the full frame', () => {
    const inner: Rect = [0, 0, 640, 360];
    const zooms = [zoom(12, 4, half), zoom(13, 2, inner)];
    const amounts = new Map([[zooms[0]!, 1], [zooms[1]!, 0.5]]);
    expect(zoomRectAt(zooms, 14, (z) => amounts.get(z)!, full)).toEqual([0, 0, 960, 540]);
  });

  it('never returns the caller\'s full array', () => {
    const result = zoomRectAt([], 1, full1, full);
    expect(result).toEqual(full);
    expect(result).not.toBe(full);
  });

  it('aspect-fits the target rect of each zoom', () => {
    const tall: Rect = [1000, 500, 200, 400];
    const result = zoomRectAt([zoom(12, 4, tall)], 14, full1, full);
    expect(result[2] / result[3]).toBeCloseTo(16 / 9, 6);
  });
});

describe('fitZoomRect', () => {
  const expectRect = (actual: Rect, expected: Rect): void => {
    expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 6));
  };

  it('keeps a rect that already has the aspect of the frame', () => {
    expect(fitZoomRect(half, full)).toEqual(half);
  });

  it('grows a tall rect around its centre to the frame aspect', () => {
    expectRect(fitZoomRect([1000, 500, 200, 400], full), [744.4444444, 500, 711.1111111, 400]);
  });

  it('shifts a rect hanging off the frame edge back inside', () => {
    expectRect(fitZoomRect([2400, 100, 640, 360], full), [1920, 100, 640, 360]);
  });

  it('turns an oversized rect into the full frame', () => {
    expectRect(fitZoomRect([-100, -100, 4000, 1000], full), full);
  });
});
```

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
  it('gives each active text its opacity', () => {
    expect(activeTexts([text], 12, () => 0.4)).toEqual([{ overlay: text, opacity: 0.4 }]);
  });

  it('hides texts outside their range and disabled texts', () => {
    expect(activeTexts([text], 10.9, () => 1)).toEqual([]);
    expect(activeTexts([text], 13, () => 1)).toEqual([]);
    expect(activeTexts([{ ...text, enabled: false }], 12, () => 1)).toEqual([]);
  });
});

describe('badgeFor', () => {
  it('shows an automatic badge only for sped-up clips', () => {
    expect(badgeFor(clip(1))).toBeUndefined();
    expect(badgeFor(clip(12))).toBe('12× speed');
    expect(badgeFor(clip(1.5))).toBe('1.5× speed');
  });

  it('rounds the speed once and hides the badge when it rounds to 1', () => {
    expect(badgeFor(clip(1.04))).toBeUndefined();
    expect(badgeFor(clip(1.25))).toBe('1.3× speed');
  });

  it('uses an explicit badge and hides it when empty', () => {
    expect(badgeFor(clip(12, 'fast-forward'))).toBe('fast-forward');
    expect(badgeFor(clip(12, ''))).toBeUndefined();
  });
});
```

In `packages/timeline/test/frame.test.ts`, replace:

```ts
    expect(layer?.zoom).toEqual([0, 0, 1280, 720]);
  });

  it('eases the zoom and fades the text in source time', () => {
    const zoom = timeline.frameAt(2.3).layers[0]?.zoom;
    expect(zoom?.[2]).toBeCloseTo(1920, 6);
    expect(zoom?.[3]).toBeCloseTo(1080, 6);
```

with:

```ts
    expect(layer?.zoom).toEqual([0, 0, 1280, 720]);
  });

  it('eases the zoom and fades the text in output time', () => {
    const zoom = timeline.frameAt(2.3).layers[0]?.zoom;
    expect(zoom?.[2]).toBeCloseTo(1920, 6);
    expect(zoom?.[3]).toBeCloseTo(1080, 6);
```

In the same file, replace:

```ts
});

describe('crossfades', () => {
  const timeline = createTimeline(project({ transition: { enabled: true, duration: 0.4 } }), { screenSize });

  it('shows one layer away from boundaries', () => {
    expect(timeline.frameAt(5).layers).toHaveLength(1);
```

with:

```ts
});

describe('crossfades', () => {
  // The second clip starts a second after the first ends: a cut, not a continuous one.
  const JUMP = [
    { type: 'clip', from: 10, to: 20 },
    { type: 'clip', from: 21, to: 141, speed: 12 },
    { type: 'card', title: 'End', duration: 2 },
  ];
  const timeline = createTimeline(project({ transition: { enabled: true, duration: 0.4 } }, { scenes: JUMP }), { screenSize });

  it('shows one layer away from boundaries', () => {
    expect(timeline.frameAt(5).layers).toHaveLength(1);
```

In the same file, replace:

```ts
    expect(before.map((l) => l.index)).toEqual([0, 1]);
    expect(before[0]?.opacity).toBeCloseTo(0.75, 6);
    expect(before[1]?.opacity).toBeCloseTo(0.25, 6);
    expect(before[1]?.sourceTime).toBe(20);

    const after = timeline.frameAt(10.1).layers;
    expect(after.map((l) => l.index)).toEqual([0, 1]);
```

with:

```ts
    expect(before.map((l) => l.index)).toEqual([0, 1]);
    expect(before[0]?.opacity).toBeCloseTo(0.75, 6);
    expect(before[1]?.opacity).toBeCloseTo(0.25, 6);
    expect(before[1]?.sourceTime).toBe(21);

    const after = timeline.frameAt(10.1).layers;
    expect(after.map((l) => l.index)).toEqual([0, 1]);
```

In the same file, replace:

```ts
      project(
        { transition: { enabled: true, duration: 0.4 } },
        {
          masks: [
            { from: 0, to: 15, rect: [0, 0, 50, 50] },
            { from: 10, to: 20, rect: [0, 0, 50, 50] },
```

with:

```ts
      project(
        { transition: { enabled: true, duration: 0.4 } },
        {
          scenes: JUMP,
          masks: [
            { from: 0, to: 15, rect: [0, 0, 50, 50] },
            { from: 10, to: 20, rect: [0, 0, 50, 50] },
```

In the same file, replace:

```ts
    expect((outgoing?.opacity ?? 0) + (incoming?.opacity ?? 0)).toBeCloseTo(1, 9);
  });
});
```

with:

```ts
    expect((outgoing?.opacity ?? 0) + (incoming?.opacity ?? 0)).toBeCloseTo(1, 9);
  });
});

describe('continuous cuts', () => {
  const look = { transition: { enabled: true, duration: 0.4 } };
  // One piece of footage: 0–5 at 1×, 5–25 at 4× (output 5–10), 25–30 at 1× (output 10–15).
  const scenes = [
    { type: 'clip', from: 0, to: 5 },
    { type: 'clip', from: 5, to: 25, speed: 4 },
    { type: 'clip', from: 25, to: 30 },
  ];
  const timeline = createTimeline(project(look, { scenes, zooms: [], masks: [], texts: [] }), { screenSize });

  it('shows one layer at a continuous cut, without a crossfade', () => {
    for (const t of [4.9, 5, 5.1, 9.9, 10, 10.1]) expect(timeline.frameAt(t).layers, `t ${t}`).toHaveLength(1);
  });

  it('moves on in source time on every frame across the cuts: nothing held or frozen', () => {
    const times = Array.from({ length: 330 }, (_, i) => timeline.frameAt(4 + i / 30).layers[0]?.sourceTime ?? NaN);
    for (let i = 1; i < times.length; i++) expect(times[i], `frame ${i}`).toBeGreaterThan(times[i - 1]!);
  });

  it('still crossfades where the source jumps', () => {
    const jump = createTimeline(project(look, { scenes: [{ type: 'clip', from: 0, to: 5 }, { type: 'clip', from: 5.5, to: 10 }] }), { screenSize });
    expect(jump.frameAt(5).layers).toHaveLength(2);
  });
});

describe('overlay ramps in output time', () => {
  const look = { transition: { enabled: true, duration: 0.4 } };
  // 0–5 at 1×, then the same footage on at 4× (output 5–10).
  const scenes = [
    { type: 'clip', from: 0, to: 5 },
    { type: 'clip', from: 5, to: 25, speed: 4 },
  ];
  const zoomRect = [0, 0, 1280, 720];
  const width = (timeline: ReturnType<typeof createTimeline>, t: number): number => timeline.frameAt(t).layers[0]?.zoom?.[2] ?? NaN;

  it('runs a zoom across a speed change without a jump', () => {
    // source 4.7–8.7 shows at output 4.7–5.925: one occurrence, ramps of 0.6 output seconds
    const timeline = createTimeline(project(look, { scenes, zooms: [{ at: 4.7, duration: 4, rect: zoomRect }], masks: [], texts: [] }), { screenSize });
    expect(width(timeline, 5)).toBeCloseTo(1920, 6);
    const widths = Array.from({ length: 19 }, (_, i) => width(timeline, 4.7 + i / 30));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i], `frame ${i}`).toBeLessThanOrEqual(widths[i - 1]!);
      // no step is bigger than the ease's steepest (slope 3, halfway) over one frame of the 0.6 s ramp
      expect(widths[i - 1]! - widths[i]!, `frame ${i}`).toBeLessThanOrEqual((1280 * 3) / (30 * 0.6) + 1e-6);
    }
  });

  it('lands fully zoomed where a cut jumps into the middle of a zoom', () => {
    // the zoom is source 10–16; the second clip starts at 12, inside it
    const timeline = createTimeline(
      project(look, { scenes: [{ type: 'clip', from: 0, to: 5 }, { type: 'clip', from: 12, to: 20 }], zooms: [{ at: 10, duration: 6, rect: zoomRect }], masks: [], texts: [] }),
      { screenSize },
    );
    expect(timeline.frameAt(5).layers[1]?.zoom).toEqual(zoomRect);
    expect(width(timeline, 5.3)).toBe(1280);
    // and ramps out where its end shows: output 9, 0.3 s before it halfway
    expect(width(timeline, 8.7)).toBeCloseTo(1920, 6);
  });

  it('fades a text in output seconds across a speed change', () => {
    // source 4–5.4 shows at output 4–5.1: the fade-out starts at 4.85, on the 1× side
    const timeline = createTimeline(project(look, { scenes, zooms: [], masks: [], texts: [{ at: 4, duration: 1.4, text: 'Hi' }] }), { screenSize });
    const opacity = (t: number): number => timeline.frameAt(t).layers[0]?.texts[0]?.opacity ?? NaN;
    expect(opacity(4.8)).toBe(1);
    expect(opacity(4.95)).toBeCloseTo(0.6, 9);
    expect(opacity(5)).toBeCloseTo(0.4, 9);
    expect(opacity(5.05)).toBeCloseTo(0.2, 9);
  });

  it('ramps a zoom over a split exactly as over the unsplit clip', () => {
    const zooms = [{ at: 4.5, duration: 1, rect: zoomRect }];
    const whole = createTimeline(project(look, { scenes: [{ type: 'clip', from: 0, to: 10 }], zooms, masks: [], texts: [] }), { screenSize });
    const split = createTimeline(
      project(look, { scenes: [{ type: 'clip', from: 0, to: 5 }, { type: 'clip', from: 5, to: 10 }], zooms, masks: [], texts: [] }),
      { screenSize },
    );
    for (let frame = 120; frame < 180; frame++) {
      expect(split.frameAt(frame / 30).layers).toHaveLength(1);
      expect(width(split, frame / 30), `frame ${frame}`).toBeCloseTo(width(whole, frame / 30), 6);
    }
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm exec vitest run packages/timeline`
Expected: FAIL: `occurrences.test.ts` cannot load (`Cannot find module '../src/occurrences'`); 13 tests fail and 51 pass. The five new frame tests fail: two layers at a continuous cut, the frozen frame (`frame 30: expected 4.966… to be greater than 4.966…`), the zoom's jump (`expected 2110.5… to be close to 1920`), the text's fade (`expected 1 to be close to 0.6`) and the split. So do `isContinuousCut is not a function` and the zoom and overlay tests on the new signatures (rects of NaN). The crossfade tests pass.

- [ ] **Step 3: The occurrences and the timeline**

`packages/timeline/src/time.ts`:

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
}

/** Length of a scene on the output timeline, in output seconds. */
export function sceneDuration(scene: Scene): number {
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
export function totalDuration(spans: readonly SceneSpan[]): number {
  return spans.at(-1)?.end ?? 0;
}

/** The span containing output time `t` (output seconds); clamps to the first/last span, `undefined` without spans. */
export function spanAt(spans: readonly SceneSpan[], t: number): SceneSpan | undefined {
  for (const span of spans) {
    if (t < span.end) return span;
  }
  return spans.at(-1);
}

/** Maps scene-local output seconds to source seconds, clamped to the clip's `[from, to]`. */
export function sourceTimeAt(scene: ClipScene, local: number): number {
  return clamp(scene.from + local * scene.speed, scene.from, scene.to);
}

/** Two clips closer than this (source seconds) at a boundary count as one continuous piece of footage. */
export const CONTINUOUS_CUT_SECONDS = 1e-3;

/**
 * Whether the boundary from scene `a` to scene `b` is a continuous cut: two clips where the first
 * ends where the second begins (within 1 ms), as a split or a speed change makes. It has no
 * crossfade, no held frame and no audio fade; overlays run across it.
 */
export function isContinuousCut(a: Scene, b: Scene): boolean {
  return a.type === 'clip' && b.type === 'clip' && Math.abs(a.to - b.from) < CONTINUOUS_CUT_SECONDS;
}
```

`packages/timeline/src/occurrences.ts`:

```ts
import type { Ease } from '@cuttle/project';
import { ease } from './easing';
import { isContinuousCut, type SceneSpan } from './time';

/**
 * One stretch of output time that shows an overlay (a zoom or a text, whose range is in source
 * seconds): a run of clips that show part of its range, joined over continuous cuts. `start` and
 * `end` are output seconds.
 */
export interface Occurrence {
  start: number;
  end: number;
  /** It shows the overlay's start, so the overlay ramps in; a cut into the middle lands on it fully. */
  rampIn: boolean;
  /** It shows the overlay's end, so the overlay ramps out. */
  rampOut: boolean;
}

/**
 * The occurrence of the overlay with source range `[start, end)` in each span: `undefined` where
 * the span does not show it; spans joined by a continuous cut share one object.
 */
export function occurrences(spans: readonly SceneSpan[], start: number, end: number): (Occurrence | undefined)[] {
  const result: (Occurrence | undefined)[] = [];
  spans.forEach((span, i) => {
    const scene = span.scene;
    const from = scene.type === 'clip' ? Math.max(start, scene.from) : 0;
    const to = scene.type === 'clip' ? Math.min(end, scene.to) : 0;
    if (scene.type !== 'clip' || to <= from) {
      result.push(undefined);
      return;
    }
    const outEnd = Math.min(span.end, span.start + (to - scene.from) / scene.speed);
    const previous = result[i - 1];
    if (previous && isContinuousCut(spans[i - 1]!.scene, scene)) {
      previous.end = outEnd;
      previous.rampOut = end <= scene.to;
      result.push(previous);
      return;
    }
    result.push({ start: span.start + (from - scene.from) / scene.speed, end: outEnd, rampIn: start >= scene.from, rampOut: end <= scene.to });
  });
  return result;
}

/**
 * How far an overlay is in (0 to 1) at output time `t` of its occurrence: it ramps in over `ramp`
 * output seconds from the occurrence's start and out over `ramp` before its end, where it has those
 * ends; the ramps shrink to fit a short occurrence.
 */
export function rampAmount(occurrence: Occurrence, t: number, ramp: number, curve: Ease): number {
  const ramps = Number(occurrence.rampIn) + Number(occurrence.rampOut);
  if (ramps === 0) return 1;
  const length = Math.min(ramp, (occurrence.end - occurrence.start) / ramps);
  const rampIn = occurrence.rampIn ? ease(curve, (t - occurrence.start) / length) : 1;
  const rampOut = occurrence.rampOut ? ease(curve, (occurrence.end - t) / length) : 1;
  return Math.min(rampIn, rampOut);
}
```

`packages/timeline/src/zoom.ts`:

```ts
import type { Rect, Zoom } from '@cuttle/project';
import { clamp, lerpRect } from './easing';

/** Length of a zoom's ramps in output seconds (see `rampAmount`). */
export const ZOOM_RAMP_SECONDS = 0.6;

/** Grows `rect` around its centre to the aspect ratio of `full`, shrinks it to fit inside `full`, then shifts it inside `full`. Source pixels. */
export function fitZoomRect(rect: Rect, full: Rect): Rect {
  const aspect = full[2] / full[3];
  let w = rect[2];
  let h = rect[3];
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  if (w > full[2]) {
    w = full[2];
    h = full[3];
  }
  const cx = rect[0] + rect[2] / 2;
  const cy = rect[1] + rect[3] / 2;
  const x = clamp(cx - w / 2, full[0], full[0] + full[2] - w);
  const y = clamp(cy - h / 2, full[1], full[1] + full[3] - h);
  return [x, y, w, h];
}

/**
 * Crop rect at `sourceTime` (source seconds): the enabled zooms whose range contains it fold in
 * `at` order, each `amountOf(zoom)` (0 to 1, its ramp) of the way from the rect before it to its
 * own. `full` is the screen rect in source pixels; the result is a new array.
 */
export function zoomRectAt(zooms: readonly Zoom[], sourceTime: number, amountOf: (zoom: Zoom) => number, full: Rect): Rect {
  const active = zooms
    .filter((zoom) => zoom.enabled && sourceTime >= zoom.at && sourceTime < zoom.at + zoom.duration)
    .sort((a, b) => a.at - b.at);

  let rect: Rect = [...full];
  for (const zoom of active) rect = lerpRect(rect, fitZoomRect(zoom.rect, full), amountOf(zoom));
  return rect;
}
```

`packages/timeline/src/overlays.ts`:

```ts
import type { ClipScene, Mask, TextOverlay } from '@cuttle/project';

/** Length of a text's fades in output seconds (see `rampAmount`). */
export const TEXT_FADE_SECONDS = 0.25;

export interface ActiveText {
  overlay: TextOverlay;
  opacity: number;
}

/** Enabled masks whose `[from, to)` range, in source seconds, contains `sourceTime`. */
export function activeMasks(masks: readonly Mask[], sourceTime: number): Mask[] {
  return masks.filter((mask) => mask.enabled && sourceTime >= mask.from && sourceTime < mask.to);
}

/** Enabled texts whose `[at, at+duration)` range, in source seconds, contains `sourceTime`, with their opacity from `opacityOf` (their fades; 0 on a fade's first frame). */
export function activeTexts(texts: readonly TextOverlay[], sourceTime: number, opacityOf: (text: TextOverlay) => number): ActiveText[] {
  const active: ActiveText[] = [];
  for (const overlay of texts) {
    if (!overlay.enabled || sourceTime < overlay.at || sourceTime >= overlay.at + overlay.duration) continue;
    active.push({ overlay, opacity: opacityOf(overlay) });
  }
  return active;
}

/** Badge text for a clip scene: an explicit badge wins, `''` hides it, otherwise "<speed>× speed" when the rounded speed is above 1. */
export function badgeFor(scene: ClipScene): string | undefined {
  if (scene.badge !== undefined) return scene.badge === '' ? undefined : scene.badge;
  const shown = Math.round(scene.speed * 10) / 10;
  return shown > 1 ? `${shown}× speed` : undefined;
}
```

`packages/timeline/src/frame.ts`:

```ts
import type { CuttleProject, Ease, Mask, Rect } from '@cuttle/project';
import { cursorAt, type CursorFrame, type CursorTrack } from './cursor';
import { clamp } from './easing';
import { occurrences, rampAmount, type Occurrence } from './occurrences';
import { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
import { isContinuousCut, sceneSpans, sourceTimeAt, spanAt, totalDuration, type SceneSpan } from './time';
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
  const { width, height } = opts.screenSize;
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    throw new Error('createTimeline: screenSize must have a positive, finite width and height');
  }
  const spans = sceneSpans(project.scenes);
  const duration = totalDuration(spans);
  const full: Rect = [0, 0, opts.screenSize.width, opts.screenSize.height];
  const transition = project.look.transition;
  const maxHalf = transition.enabled ? transition.duration / 2 : 0;

  // Where each zoom and text shows in output time, per span: their ramps run in output seconds.
  const zoomShown = new Map(project.zooms.map((zoom) => [zoom, occurrences(spans, zoom.at, zoom.at + zoom.duration)]));
  const textShown = new Map(project.texts.map((text) => [text, occurrences(spans, text.at, text.at + text.duration)]));

  /** Half the crossfade between two spans; a continuous cut has none. */
  function halfBetween(a: SceneSpan, b: SceneSpan): number {
    if (isContinuousCut(a.scene, b.scene)) return 0;
    return Math.min(maxHalf, (a.end - a.start) / 2, (b.end - b.start) / 2);
  }

  /**
   * The last output frame (frame i at i / fps) that shows the clip inside its source range
   * [from, to). Uses the same strict comparisons as `spanAt`: span ends are rounded to the
   * microsecond, so a frame can fall inside the span while its source time is exactly `to`.
   */
  function lastFrameShown(span: SceneSpan, inside: (local: number) => boolean): number {
    const fps = project.output.fps;
    let frame = Math.ceil(span.end * fps);
    while (frame > 0 && frame / fps >= span.end) frame--;
    while (frame / fps > span.start && !inside(frame / fps - span.start)) frame--;
    return frame / fps;
  }

  function sceneFrame(span: SceneSpan, t: number, opacity: number): SceneFrame {
    const length = span.end - span.start;
    const local = clamp(t - span.start, 0, length);
    const base = { index: span.index, local, progress: length === 0 ? 1 : local / length, opacity };
    const scene = span.scene;
    if (scene.type !== 'clip') return { ...base, kind: scene.type, masks: [], texts: [] };
    // Past the end (or on a frame whose source time would be `to`), hold the last frame shown:
    // its source time lies inside [from, to), so masks that end with the clip stay on, and a
    // clip's source time never goes back during a crossfade.
    const inside = (l: number) => scene.from + l * scene.speed < scene.to;
    const pastEnd = t >= span.end || !inside(local);
    const sourceLocal = pastEnd ? clamp(lastFrameShown(span, inside) - span.start, 0, length) : local;
    const sourceTime = sourceTimeAt(scene, sourceLocal);
    let cursor = project.look.cursor.enabled && opts.cursor ? cursorAt(opts.cursor, sourceTime, scene.speed) : undefined;
    if (cursor && project.look.cursor.clickEffect === 'none') cursor = { ...cursor, clicks: [] };
    // The output time this source frame belongs to (a held or frozen frame's, during a crossfade).
    const shownAt = span.start + (sourceTime - scene.from) / scene.speed;
    const amount = (shown: (Occurrence | undefined)[] | undefined, ramp: number, curve: Ease): number => {
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
      cursor,
    };
  }

  function frameAt(t: number): RenderState {
    const time = Number.isNaN(t) ? 0 : clamp(t, 0, duration);
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
export { CONTINUOUS_CUT_SECONDS, isContinuousCut, sceneDuration, sceneSpans, sourceTimeAt, spanAt, totalDuration, type SceneSpan } from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run packages/timeline`
Expected: PASS, 72 tests.

Run: `pnpm exec tsc -p tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 5: Commit**

```bash
git add packages/timeline
git commit -m "timeline: no crossfade at continuous cuts; zoom and text ramps in output time per occurrence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Goldens for a speed change and a split

**Files:**
- Modify: `packages/engine/test/scenarios.ts`, `packages/engine/test/golden.browser.test.ts`
- Create: `packages/engine/test/__golden__/golden.browser.test.ts/speed-change-zoom.win32.png`, `…/speed-change-caption.win32.png` (written by the first run)

- [ ] **Step 1: The scenarios and the split check**

In `packages/engine/test/scenarios.ts`, replace:

```ts
}

const SLATE = { preset: 'solid', color: '#3B4252' } as const;
const TITLE = 'claude · ~/treg-demo';

/** Cursor resting at the screen centre, clicked 0.1 s before t = 5 (ripple at 25 %). */
```

with:

```ts
}

const SLATE = { preset: 'solid', color: '#3B4252' } as const;
/** One piece of footage: 0–5 s at 1×, then 5–25 s at 4× (output 5–10 s). */
const SPEED_CHANGE: CuttleProjectInput['scenes'] = [
  { type: 'clip', from: 0, to: 5 },
  { type: 'clip', from: 5, to: 25, speed: 4 },
];
const TITLE = 'claude · ~/treg-demo';

/** Cursor resting at the screen centre, clicked 0.1 s before t = 5 (ripple at 25 %). */
```

In the same file, replace:

```ts
    ],
  },

  // Other output formats: everything scales with the short side
  ...(
    [
```

with:

```ts
    ],
  },

  // A speed change inside one piece of footage (1× up to 5 s, then 4×) is a continuous cut: one
  // layer, no crossfade. The zoom (source 4.7–8.7) and the caption (4–5.4) ramp in output seconds
  // across it: the zoom is halfway in at the cut, the caption 40 % into its fade-out.
  {
    name: 'speed-change-zoom',
    project: project({ frame: { title: TITLE } }, { scenes: SPEED_CHANGE, zooms: [{ at: 4.7, duration: 4, rect: [800, 450, 480, 300] }] }),
    t: 5,
  },
  {
    name: 'speed-change-caption',
    project: project(
      { frame: { title: TITLE } },
      { scenes: SPEED_CHANGE, texts: [{ at: 4, duration: 1.4, text: 'Claude at work', style: 'caption', position: 'bottom' }] },
    ),
    t: 5,
  },

  // Other output formats: everything scales with the short side
  ...(
    [
```

In the same file, replace:

```ts
    webcam: true,
  })),
];
```

with:

```ts
    webcam: true,
  })),
];

/**
 * The same clip whole and split at 5 s, with a zoom ramping across the split, rendered at output
 * times around the split: a continuous cut must look exactly like no cut.
 */
export const SPLIT_CHECKS: { whole: Scenario; split: Scenario }[] = [4.9, 5, 5.1].map((t) => {
  const zooms = [{ at: 4.5, duration: 1, rect: [800, 450, 480, 300] as [number, number, number, number] }];
  return {
    whole: { name: `whole-${t}`, project: project({ frame: { title: TITLE } }, { zooms }), t },
    split: {
      name: `split-${t}`,
      project: project({ frame: { title: TITLE } }, { scenes: [{ type: 'clip', from: 0, to: 5 }, { type: 'clip', from: 5, to: 10 }], zooms }),
      t,
    },
  };
});
```

In `packages/engine/test/golden.browser.test.ts`, replace:

```ts
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { toBase64 } from './gl-util';
import { renderScenario } from './run-scenario';
import { SCENARIOS } from './scenarios';

let assets: EngineAssets;
```

with:

```ts
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { toBase64 } from './gl-util';
import { renderScenario } from './run-scenario';
import { SCENARIOS, SPLIT_CHECKS } from './scenarios';

let assets: EngineAssets;
```

In the same file, replace:

```ts
    });
  }
});
```

with:

```ts
    });
  }
});

describe('continuous cuts', () => {
  for (const { whole, split } of SPLIT_CHECKS) {
    it(`renders a split clip exactly like the whole clip at ${whole.t} s`, async () => {
      const [a, b] = [await renderScenario(whole, assets), await renderScenario(split, assets)];
      expect([b.width, b.height]).toEqual([a.width, a.height]);
      expect(b.data.findIndex((value, i) => value !== a.data[i])).toBe(-1);
    });
  }
});
```

- [ ] **Step 2: Write the two new goldens**

Run: `pnpm exec vitest run --project browser packages/engine/test/golden.browser.test.ts`
Expected: FAIL, 2 tests (`speed-change-zoom`, `speed-change-caption`: "golden created, look at it and run the tests again"); the other 40 goldens match and the 3 split checks pass.

- [ ] **Step 3: Look at both PNGs**

Read `packages/engine/test/__golden__/golden.browser.test.ts/speed-change-zoom.win32.png`: the mac-dark window, zoomed halfway towards the white card at the bottom right (the visible screen starts left of the code lines), a "4× speed" badge at the top right, one sharp layer with no ghost of a second zoom. Read `speed-change-caption.win32.png`: the whole screen unzoomed, the badge, and the caption "Claude at work" at the bottom, faint (40 % opacity) over the blue status bar.

- [ ] **Step 4: Run the goldens again, and in Electron**

Run: `pnpm exec vitest run --project browser packages/engine/test/golden.browser.test.ts`
Expected: PASS, 45 tests.

Run: `pnpm engine:electron`
Expected: exits with code 0 (every golden, the new ones too, matches in Electron's Chromium).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/test
git commit -m "engine: goldens of a zoom and a caption across a speed change; a split renders like no cut

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: No audio fade at continuous cuts

**Files:**
- Modify: `packages/export/src/audio.ts`, `packages/export/test/audio.test.ts`, `packages/export/test/main/audio-ffmpeg.test.ts`

- [ ] **Step 1: Write the failing tests**

The planner's fixture moves its sped-up clip to source 4–12, so its first boundary stays a cut with a crossfade.

In `packages/export/test/audio.test.ts`, replace:

```ts

const scenes: CuttleProjectInput['scenes'] = [
  { type: 'clip', from: 1, to: 3 },
  { type: 'clip', from: 3, to: 11, speed: 4 },
  { type: 'still', image: 'p.png', duration: 1 },
  { type: 'clip', from: 0.5, to: 1.5 },
];
```

with:

```ts

const scenes: CuttleProjectInput['scenes'] = [
  { type: 'clip', from: 1, to: 3 },
  { type: 'clip', from: 4, to: 12, speed: 4 },
  { type: 'still', image: 'p.png', duration: 1 },
  { type: 'clip', from: 0.5, to: 1.5 },
];
```

In the same file, replace:

```ts
      { from: 24_000, to: 72_000, speed: 1, content: 48_000 },
    ]);
    const loud = plan({ scenes, look: { audio: { muteSpedUp: false } } });
    expect(loud[1]!.mic).toEqual({ from: 144_000, to: 528_000, speed: 4, content: 96_000 });
  });

  it('is silent without a mic or with audio switched off', () => {
```

with:

```ts
      { from: 24_000, to: 72_000, speed: 1, content: 48_000 },
    ]);
    const loud = plan({ scenes, look: { audio: { muteSpedUp: false } } });
    expect(loud[1]!.mic).toEqual({ from: 192_000, to: 576_000, speed: 4, content: 96_000 });
  });

  it('is silent without a mic or with audio switched off', () => {
```

In the same file, replace:

```ts
    const hard = plan({ scenes, look: { transition: { enabled: false } } });
    expect(hard.every((s) => s.fadeIn === 480 && s.fadeOut === 480)).toBe(true);
  });
});

describe('atempoChain', () => {
```

with:

```ts
    const hard = plan({ scenes, look: { transition: { enabled: false } } });
    expect(hard.every((s) => s.fadeIn === 480 && s.fadeOut === 480)).toBe(true);
  });

  it('does not fade at a continuous cut where the sound runs on at the same speed', () => {
    // one piece of footage: 1–3, 3–5, then 5–13 at 4×
    const continuous = [
      { type: 'clip', from: 1, to: 3 },
      { type: 'clip', from: 3, to: 5 },
      { type: 'clip', from: 5, to: 13, speed: 4 },
    ] as const;
    const segments = plan({ scenes: [...continuous] });
    expect(segments.map((s) => [s.fadeIn, s.fadeOut])).toEqual([[480, 0], [0, 480], [480, 480]]);
    // where the sped-up clip is heard too, its speed changes there: 10 ms against a click
    const loud = plan({ scenes: [...continuous], look: { audio: { muteSpedUp: false } } });
    expect(loud.map((s) => [s.fadeIn, s.fadeOut])).toEqual([[480, 0], [0, 480], [480, 480]]);
  });
});

describe('atempoChain', () => {
```

In the same file, replace:

```ts
  it('feeds atempo silence past a sped-up clip, because it returns fewer samples, then cuts to the clip', () => {
    const graph = audioFilterGraph(plan({ scenes, look: { audio: { muteSpedUp: false } } }));
    expect(graph).toContain(
      '[m1]atrim=start_sample=144000:end_sample=528000,asetpts=N/SR/TB,apad=pad_len=200000,atempo=4,atrim=end_sample=96000,asetpts=N/SR/TB,apad,',
    );
  });
```

with:

```ts
  it('feeds atempo silence past a sped-up clip, because it returns fewer samples, then cuts to the clip', () => {
    const graph = audioFilterGraph(plan({ scenes, look: { audio: { muteSpedUp: false } } }));
    expect(graph).toContain(
      '[m1]atrim=start_sample=192000:end_sample=576000,asetpts=N/SR/TB,apad=pad_len=200000,atempo=4,atrim=end_sample=96000,asetpts=N/SR/TB,apad,',
    );
  });
```

In `packages/export/test/main/audio-ffmpeg.test.ts`, replace:

```ts
        { audio: { muteSpedUp: false }, transition: { enabled: false } },
        loudAfterCut,
      );
      expect(peak(audio, 0, audio.length), `speed ${speed}`).toBeLessThan(0.01);
    }
  });
});
```

with:

```ts
        { audio: { muteSpedUp: false }, transition: { enabled: false } },
        loudAfterCut,
      );

      expect(peak(audio, 0, audio.length), `speed ${speed}`).toBeLessThan(0.01);
    }
  });

  it('plays a split clip exactly like the whole clip: no dip at a continuous cut', () => {
    const whole = render([{ type: 'clip', from: 1, to: 5 }], 4);
    const split = render([{ type: 'clip', from: 1, to: 2.5 }, { type: 'clip', from: 2.5, to: 5 }], 4);
    expect(split.length).toBe(whole.length);
    let worst = 0;
    for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(split[i]! - whole[i]!));
    expect(worst).toBeLessThan(1e-4);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm exec vitest run packages/export/test/audio.test.ts packages/export/test/main/audio-ffmpeg.test.ts`
Expected: FAIL, 2 tests: `does not fade at a continuous cut …` (`[ [ 480, 7200 ], [ 7200, 7200 ], … ]` instead of `[ [ 480, 0 ], [ 0, 480 ], … ]`) and `plays a split clip exactly like the whole clip …` (`expected 0.1245… to be less than 0.0001`: the sine's full height, at the split); 16 pass.

- [ ] **Step 3: The planner**

In `packages/export/src/audio.ts`, replace:

```ts
import type { Look } from '@cuttle/project';
import type { SceneSpan } from '@cuttle/timeline';

/** Sample rate of the exported audio (AAC). */
export const AUDIO_SAMPLE_RATE = 48_000;
```

with:

```ts
import type { Look } from '@cuttle/project';
import { isContinuousCut, type SceneSpan } from '@cuttle/timeline';

/** Sample rate of the exported audio (AAC). */
export const AUDIO_SAMPLE_RATE = 48_000;
```

In the same file, replace:

```ts
 * their stretch of the mic (sped up with the clip), unless the clip is sped up and
 * `look.audio.muteSpedUp` is set; still and card scenes are silent. The last segment runs to
 * `seconds`, which can be up to one frame past the timeline. Cuts fade out and in over half the
 * crossfade on each side (at least 10 ms), so the sound dips where the picture crossfades.
 */
export function planAudio({ spans, look, mic, seconds }: AudioPlanOptions): AudioSegment[] {
  const half = (a: SceneSpan, b: SceneSpan): number =>
    look.transition.enabled ? Math.min(look.transition.duration / 2, (a.end - a.start) / 2, (b.end - b.start) / 2) : 0;
  const total = toSamples(seconds);
  return spans.map((span, i) => {
    const start = i === 0 ? 0 : toSamples(span.start);
    const end = i === spans.length - 1 ? total : toSamples(span.end);
    const samples = Math.max(0, end - start);
    /** Fade at the cut between `a` and `b`; at the start and end of the video only the minimum. */
    const fadeAt = (a: SceneSpan | undefined, b: SceneSpan | undefined): number =>
      Math.min(Math.floor(samples / 2), toSamples(Math.max(MIN_FADE_SECONDS, a && b ? half(a, b) : 0)));
    const segment: AudioSegment = {
      samples,
      fadeIn: fadeAt(spans[i - 1], span),
      fadeOut: fadeAt(span, spans[i + 1]),
    };
    const scene = span.scene;
    const audible = mic && look.audio.enabled && scene.type === 'clip' && !(look.audio.muteSpedUp && scene.speed > 1);
    if (audible) {
      const from = toSamples(scene.from);
      const to = toSamples(scene.to);
      segment.mic = { from, to, speed: scene.speed, content: Math.min(samples, Math.round((to - from) / scene.speed)) };
```

with:

```ts
 * their stretch of the mic (sped up with the clip), unless the clip is sped up and
 * `look.audio.muteSpedUp` is set; still and card scenes are silent. The last segment runs to
 * `seconds`, which can be up to one frame past the timeline. Cuts fade out and in over half the
 * crossfade on each side (at least 10 ms), so the sound dips where the picture crossfades. A
 * continuous cut has no crossfade: where the sound runs on at the same speed it has no fade at all,
 * where it changes speed or stops only the 10 ms that keep it from clicking.
 */
export function planAudio({ spans, look, mic, seconds }: AudioPlanOptions): AudioSegment[] {
  /** The speed a span plays the mic at; undefined when it is silent. */
  const soundOf = (span: SceneSpan): number | undefined => {
    const scene = span.scene;
    const audible = mic && look.audio.enabled && scene.type === 'clip' && !(look.audio.muteSpedUp && scene.speed > 1);
    return audible && scene.type === 'clip' ? scene.speed : undefined;
  };
  const half = (a: SceneSpan, b: SceneSpan): number => {
    if (isContinuousCut(a.scene, b.scene)) return 0;
    return look.transition.enabled ? Math.min(look.transition.duration / 2, (a.end - a.start) / 2, (b.end - b.start) / 2) : 0;
  };
  const total = toSamples(seconds);
  return spans.map((span, i) => {
    const start = i === 0 ? 0 : toSamples(span.start);
    const end = i === spans.length - 1 ? total : toSamples(span.end);
    const samples = Math.max(0, end - start);
    /** Fade at the cut between `a` and `b`; at the start and end of the video only the minimum. */
    const fadeAt = (a: SceneSpan | undefined, b: SceneSpan | undefined): number => {
      if (a && b && isContinuousCut(a.scene, b.scene) && soundOf(a) !== undefined && soundOf(a) === soundOf(b)) return 0;
      return Math.min(Math.floor(samples / 2), toSamples(Math.max(MIN_FADE_SECONDS, a && b ? half(a, b) : 0)));
    };
    const segment: AudioSegment = {
      samples,
      fadeIn: fadeAt(spans[i - 1], span),
      fadeOut: fadeAt(span, spans[i + 1]),
    };
    const scene = span.scene;
    if (soundOf(span) !== undefined && scene.type === 'clip') {
      const from = toSamples(scene.from);
      const to = toSamples(scene.to);
      segment.mic = { from, to, speed: scene.speed, content: Math.min(samples, Math.round((to - from) / scene.speed)) };
```

- [ ] **Step 4: Run the tests and the export check**

Run: `pnpm exec vitest run packages/export/test/audio.test.ts packages/export/test/main/audio-ffmpeg.test.ts`
Expected: PASS, 18 tests.

Run: `pnpm export:check`
Expected: exits with code 0; three exports (16:9, 1:1, 9:16) checked with ffprobe.

- [ ] **Step 5: Commit**

```bash
git add packages/export
git commit -m "export: no audio fade at a continuous cut where the sound runs on at the same speed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `@cuttle/core`, named suggestions and writes that see each other

**Files:**
- Move (`git mv`) from `apps/cli` to `packages/core`: `src/ffmpeg.ts`, `src/project-file.ts`, `src/use-take.ts`, `src/suggest/{media,plan,region,spans,transcript}.ts`, `test/suggest.test.ts`, `test/transcript.test.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/{errors,index,suggest,recover,frame}.ts`, `packages/core/test/project-file.test.ts`
- Modify: the moved `ffmpeg.ts`, `project-file.ts`, `suggest/media.ts`, `suggest/plan.ts`, `test/suggest.test.ts`; `package.json`, `apps/cli/package.json`, `apps/cli/src/errors.ts`, `apps/cli/src/commands/{capture-page,frame,init,preview,record,recover,render,suggest}.ts`, `apps/cli/test/cli.test.ts`

- [ ] **Step 1: Move the CLI's project modules**

```bash
mkdir -p packages/core/src/suggest packages/core/test
git mv apps/cli/src/ffmpeg.ts apps/cli/src/project-file.ts apps/cli/src/use-take.ts packages/core/src/
git mv apps/cli/src/suggest/media.ts apps/cli/src/suggest/plan.ts apps/cli/src/suggest/region.ts apps/cli/src/suggest/spans.ts apps/cli/src/suggest/transcript.ts packages/core/src/suggest/
git mv apps/cli/test/suggest.test.ts apps/cli/test/transcript.test.ts packages/core/test/
```

- [ ] **Step 2: The package**

`packages/core/package.json`:

```json
{
  "name": "@cuttle/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@cuttle/project": "workspace:*",
    "@cuttle/recorder": "workspace:*",
    "@cuttle/timeline": "workspace:*"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

In `package.json`, replace:

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "engine:electron": "vite build --config packages/engine/electron/vite.config.ts && electron packages/engine/electron/main.mjs",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json && tsc -p packages/recorder/tsconfig.json && tsc -p apps/cli/tsconfig.json && tsc -p skill/tsconfig.json",
    "export:build": "vite build --config packages/export/electron/vite.main.config.ts && vite build --config packages/export/electron/vite.page.config.ts",
    "export:check": "pnpm export:build && electron packages/export/dist/check.mjs",
    "recorder:real": "vitest run --mode real --silent=false packages/recorder/test/real.test.ts",
```

with:

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "engine:electron": "vite build --config packages/engine/electron/vite.config.ts && electron packages/engine/electron/main.mjs",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json && tsc -p packages/recorder/tsconfig.json && tsc -p packages/core/tsconfig.json && tsc -p apps/cli/tsconfig.json && tsc -p skill/tsconfig.json",
    "export:build": "vite build --config packages/export/electron/vite.main.config.ts && vite build --config packages/export/electron/vite.page.config.ts",
    "export:check": "pnpm export:build && electron packages/export/dist/check.mjs",
    "recorder:real": "vitest run --mode real --silent=false packages/recorder/test/real.test.ts",
```

In `apps/cli/package.json`, replace:

```json
    ".": "./src/main.ts"
  },
  "dependencies": {
    "@cuttle/export": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/recorder": "workspace:*",
```

with:

```json
    ".": "./src/main.ts"
  },
  "dependencies": {
    "@cuttle/core": "workspace:*",
    "@cuttle/export": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/recorder": "workspace:*",
```

Run: `pnpm install`
Expected: exits with code 0; `pnpm-lock.yaml` gains the importer `packages/core` and `@cuttle/core` under `apps/cli`.

- [ ] **Step 3: Write the tests**

`project-file.test.ts` is new; the suggest tests expect the clip labels; the CLI's suggest snapshot has ids and labels, and two tests are new: ids and labels kept and given, and a save during `suggest` refused with exit code 1.

`packages/core/test/project-file.test.ts`:

```ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CoreError } from '../src/errors';
import { newProjectFile, readProjectFile, writeProjectFile } from '../src/project-file';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-core-'));
  dirs.push(dir);
  return dir;
};

/** The error `promise` rejects with. */
const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

describe('writeProjectFile', () => {
  it('writes 2-space JSON and keeps working on the file it wrote', async () => {
    const dir = temp();
    const file = await writeProjectFile(newProjectFile(dir), 'init');
    expect(readFileSync(file.path, 'utf8')).toBe('{\n  "version": 1,\n  "sources": {\n    "screen": "takes/1/screen.mp4"\n  }\n}\n');
    file.raw.texts = [{ id: 't1', label: 'Hook', at: 1, duration: 2, text: 'Hi' }];
    await writeProjectFile(file, 'edit');
    expect(file.project.texts[0]).toMatchObject({ id: 't1', label: 'Hook' });
    const read = await readProjectFile(dir);
    expect(read.hash).toBe(file.hash);
    expect(read.raw).toEqual(file.raw);
  });

  it('refuses to overwrite what another program saved since the file was read', async () => {
    const dir = temp();
    await writeProjectFile(newProjectFile(dir), 'init');
    const file = await readProjectFile(dir);
    const theirs = '{ "version": 1, "sources": { "screen": "takes/2/screen.mp4" } }\n';
    writeFileSync(file.path, theirs);
    file.raw.zooms = [];
    const error = await failure(writeProjectFile(file, 'suggest'));
    expect(error).toBeInstanceOf(CoreError);
    expect(error).toMatchObject({ code: 'conflict', message: `${file.path} changed while suggest ran; nothing was written, run it again` });
    expect(readFileSync(file.path, 'utf8')).toBe(theirs);
    expect(readdirSync(dir)).toEqual(['cuttle.json']);
  });

  it('refuses a new project when the file appeared meanwhile, and a file that was deleted', async () => {
    const dir = temp();
    const fresh = newProjectFile(dir);
    writeFileSync(fresh.path, '{}');
    expect(await failure(writeProjectFile(fresh, 'init'))).toMatchObject({ code: 'conflict' });

    const other = temp();
    await writeProjectFile(newProjectFile(other), 'init');
    const file = await readProjectFile(other);
    rmSync(file.path);
    expect(await failure(writeProjectFile(file, 'recover'))).toMatchObject({ code: 'conflict' });
    expect(existsSync(file.path)).toBe(false);
  });
});
```

`packages/core/test/suggest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { InputEvent, Marker } from '@cuttle/project';
import { parseAnalysis } from '../src/suggest/media';
import { suggestClips } from '../src/suggest/plan';
import { changedRegion, zoomRect } from '../src/suggest/region';
import { gaps, union } from '../src/suggest/spans';

describe('spans', () => {
  it('merges overlapping and touching spans', () => {
    expect(union([{ from: 5, to: 6 }, { from: 1, to: 3 }, { from: 2, to: 4 }, { from: 4, to: 4.5 }])).toEqual([
      { from: 1, to: 4.5 },
      { from: 5, to: 6 },
    ]);
  });

  it('finds the gaps inside a range', () => {
    expect(gaps([{ from: 2, to: 3 }, { from: 5, to: 12 }], 0, 10)).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 },
    ]);
    expect(gaps([], 1, 2)).toEqual([{ from: 1, to: 2 }]);
  });
});

const keys = (...times: number[]): InputEvent[] => times.map((t) => ({ t, type: 'keys', count: 1 }));

describe('suggestClips', () => {
  it('trims the quiet start and end', () => {
    // Typing from 4 to 6 s; the screen changes only while typing.
    const result = suggestClips({ duration: 20, events: keys(4, 5, 6), markers: [], still: [{ from: 0, to: 3.8 }, { from: 6.5, to: 20 }] });
    expect(result.clips).toEqual([{ from: 3.2, to: 7.5, speed: 1 }]);
    expect(result.notes).toEqual(['trimmed the quiet start (0.0–3.2 s)', 'trimmed the quiet end (7.5–20.0 s)']);
  });

  it('cuts an idle stretch, keeping half a second on both sides', () => {
    const result = suggestClips({ duration: 14, events: keys(1, 2, 10, 11), markers: [], still: [{ from: 0, to: 14 }] });
    // Active 0.7–2.3 and 9.7–11.3; the idle 2.3–9.7 is cut to 2.8–9.2.
    expect(result.clips).toEqual([
      { from: 0.2, to: 2.8, speed: 1 },
      { from: 9.2, to: 12.3, speed: 1 },
    ]);
    expect(result.notes).toContain('cut 6.4 s of idle screen (2.8–9.2 s)');
  });

  it("speeds up waiting without input and keeps Claude's answer at 1×", () => {
    // A prompt at 3 s, Claude works (the screen changes) until the answer at 40 s.
    const markers: Marker[] = [
      { t: 3, kind: 'prompt' },
      { t: 40, kind: 'answer' },
    ];
    const result = suggestClips({ duration: 50, events: keys(2, 2.5, 3), markers, still: [{ from: 0, to: 1.5 }, { from: 41, to: 50 }] });
    // Start: 2 s before the prompt. Waiting: no input from 3.3 s; the speed-up ends 1.5 s before the answer.
    expect(result.clips).toEqual([
      { from: 1, to: 4.3, speed: 1, label: 'Prompt' },
      { from: 4.3, to: 38.5, speed: 8, label: 'Claude at work' },
      { from: 38.5, to: 42.5, speed: 1, label: 'Answer' },
    ]);
    expect(result.answer).toBe(40);
    expect(result.notes).toContain('sped up 34.2 s without input 8× (4.3–38.5 s)');
  });

  it("speeds up Claude's whole turn instead of cutting its quiet stretches", () => {
    // The treg take: no input, tool calls now and then, the spinner too small to count as a change.
    const markers: Marker[] = [
      { t: 5.6, kind: 'tool', label: 'Bash' },
      { t: 64.7, kind: 'tool', label: 'Bash' },
      { t: 137.4, kind: 'tool', label: 'Write' },
      { t: 152.6, kind: 'answer' },
    ];
    const still = [{ from: 0, to: 5 }, { from: 6.1, to: 64 }, { from: 65.2, to: 137 }, { from: 138.1, to: 152 }];
    const result = suggestClips({ duration: 153.3, events: [], markers, still });
    // 145.6 s without input from 5.5 to 151.1 s: about a twelfth of it, so 12×.
    expect(result.clips).toStrictEqual([
      { from: 4.5, to: 5.5, speed: 1 },
      { from: 5.5, to: 151.1, speed: 12, label: 'Claude at work' },
      { from: 151.1, to: 153.3, speed: 1, label: 'Answer' },
    ]);
    expect(result.notes.some((note) => note.startsWith('cut'))).toBe(false);
  });

  it('also speeds up waiting after the answer, which stays at 1×', () => {
    // A prompt at 3 s, the answer at 20 s, and the screen keeps changing until 60 s without input.
    const markers: Marker[] = [
      { t: 3, kind: 'prompt' },
      { t: 20, kind: 'answer' },
    ];
    const result = suggestClips({ duration: 62, events: keys(2, 2.5, 3), markers, still: [{ from: 0, to: 1.5 }, { from: 60, to: 62 }] });
    // Waiting 3.3–61 s without input: sped up before the answer (to 18.5 s) and after it (from 22.5 s).
    // The speed-up after the answer is no longer Claude's turn: "Waiting".
    expect(result.clips).toStrictEqual([
      { from: 1, to: 4.3, speed: 1, label: 'Prompt' },
      { from: 4.3, to: 18.5, speed: 4, label: 'Claude at work' },
      { from: 18.5, to: 22.5, speed: 1, label: 'Answer' },
      { from: 22.5, to: 60, speed: 12, label: 'Waiting' },
      { from: 60, to: 61, speed: 1 },
    ]);
  });

  it('keeps the whole take when nothing happened', () => {
    expect(suggestClips({ duration: 5, events: [], markers: [], still: [{ from: 0, to: 5 }] }).clips).toEqual([{ from: 0, to: 5, speed: 1 }]);
  });
});

describe('parseAnalysis', () => {
  it("reads the size, the length and the still stretches from ffmpeg's log", () => {
    const log = [
      '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 2560x1440, 30 fps',
      '[Parsed_freezedetect_2 @ 0000] lavfi.freezedetect.freeze_start: 0',
      '[Parsed_freezedetect_2 @ 0000] lavfi.freezedetect.freeze_duration: 3',
      '[Parsed_freezedetect_2 @ 0000] lavfi.freezedetect.freeze_end: 3',
      '[Parsed_freezedetect_2 @ 0000] lavfi.freezedetect.freeze_start: 9.5',
      'frame=  360 fps=0.0 q=-0.0 Lsize=N/A time=00:00:12.00 bitrate=N/A speed=40x',
    ].join('\n');
    expect(parseAnalysis(log)).toEqual({ duration: 12, width: 2560, height: 1440, still: [{ from: 0, to: 3 }, { from: 9.5, to: 12 }] });
  });
});

describe('changedRegion and zoomRect', () => {
  const gray = (width: number, height: number, box?: { x: number; y: number; w: number; h: number }) => {
    const data = new Uint8Array(width * height).fill(40);
    if (box) for (let y = box.y; y < box.y + box.h; y++) data.fill(220, y * width + box.x, y * width + box.x + box.w);
    return { width, height, data };
  };

  it('boxes what changed and ignores a few stray pixels', () => {
    const before = gray(480, 270);
    const after = gray(480, 270, { x: 100, y: 150, w: 120, h: 60 });
    after.data[5] = 255; // a caret
    // 2 % of the changed pixels are trimmed on each side, so stray ones cannot stretch the box.
    expect(changedRegion(before, after)).toEqual({ x: 102, y: 151, width: 116, height: 58 });
    expect(changedRegion(before, gray(480, 270))).toBeUndefined();
  });

  it('pads the box, keeps a minimum width and refuses a box that covers most of the screen', () => {
    const screen = { width: 1920, height: 1080 };
    // 4× scale: the box is 400..880 × 600..840 on the screen, padded by 115.2 px (already wider than 672 px).
    expect(zoomRect({ x: 100, y: 150, width: 120, height: 60 }, 480, screen)).toEqual([285, 485, 710, 470]);
    // A narrow box grows to 35 % of the screen's width around its centre.
    expect(zoomRect({ x: 200, y: 100, width: 10, height: 10 }, 480, screen)).toEqual([484, 285, 672, 270]);
    expect(zoomRect({ x: 0, y: 0, width: 470, height: 260 }, 480, screen)).toBeUndefined();
    // Tall and narrow: 830×1080 is 43 % of the screen, but the timeline widens it to 16:9, the whole screen.
    expect(zoomRect({ x: 200, y: 0, width: 150, height: 270 }, 480, screen)).toBeUndefined();
  });
});
```

In `apps/cli/test/cli.test.ts`, replace:

```ts
        "scenes": [
          {
            "from": 1.8,
            "to": 5.1,
            "type": "clip",
          },
          {
            "from": 5.1,
            "speed": 3,
            "to": 14.5,
            "type": "clip",
          },
          {
            "from": 14.5,
            "to": 18.5,
            "type": "clip",
          },
```

with:

```ts
        "scenes": [
          {
            "from": 1.8,
            "id": "s1",
            "label": "Prompt",
            "to": 5.1,
            "type": "clip",
          },
          {
            "from": 5.1,
            "id": "s2",
            "label": "Claude at work",
            "speed": 3,
            "to": 14.5,
            "type": "clip",
          },
          {
            "from": 14.5,
            "id": "s3",
            "label": "Answer",
            "to": 18.5,
            "type": "clip",
          },
```

In the same file, replace:

```ts
          {
            "at": 15.5,
            "duration": 3,
            "rect": [
              145,
              422,
```

with:

```ts
          {
            "at": 15.5,
            "duration": 3,
            "id": "z1",
            "label": "Answer",
            "rect": [
              145,
              422,
```

In the same file, replace:

```ts
    expect(existsSync(`${path}.bak.2`)).toBe(false);
  }, 30_000);

  it('repairs a crashed take and uses it', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
```

with:

```ts
    expect(existsSync(`${path}.bak.2`)).toBe(false);
  }, 30_000);

  it('keeps the ids and labels of what it keeps, and gives its clips and zoom new ones', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const path = join(dir, 'cuttle.json');
    const card = { type: 'card', id: 's1', label: 'End', title: 'The end', duration: 2 };
    const mask = { id: 'm1', label: 'Token', from: 0, to: 20, rect: [0, 0, 100, 40] };
    const text = { id: 'z1', label: 'Hook', at: 4, duration: 2, text: 'One prompt' };
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), scenes: [{ type: 'clip', id: 's9', from: 0, to: 5 }, card], masks: [mask], texts: [text] }));
    const { code } = await cli('--json', '-C', dir, 'suggest');
    expect(code).toBe(0);
    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.scenes.map((scene: { id: string; label?: string }) => [scene.id, scene.label])).toEqual([
      ['s2', 'Prompt'],
      ['s3', 'Claude at work'],
      ['s4', 'Answer'],
      ['s1', 'End'],
    ]);
    expect(written.zooms.map((zoom: { id: string; label: string }) => [zoom.id, zoom.label])).toEqual([['z2', 'Answer']]);
    expect([written.masks, written.texts]).toEqual([[mask], [text]]);
  }, 30_000);

  it('refuses to overwrite cuttle.json saved by someone else while it ran', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const path = join(dir, 'cuttle.json');
    const theirs = JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), texts: [{ at: 1, duration: 2, text: 'saved meanwhile' }] });
    let stderr = '';
    const code = await runCli(['-C', dir, 'suggest'], {
      stdout: () => {},
      stderr: (chunk) => {
        // the first status line comes after suggest read cuttle.json: save it now, as the app would
        if (stderr === '') writeFileSync(path, theirs);
        stderr += chunk;
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain(`error: ${path} changed while suggest ran; nothing was written, run it again`);
    expect(readFileSync(path, 'utf8')).toBe(theirs);
  }, 30_000);

  it('repairs a crashed take and uses it', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
```

- [ ] **Step 4: The core package**

`packages/core/src/errors.ts`:

```ts
/** Why a project operation failed; the CLI maps the code to its exit code, the app shows the message. */
export type CoreErrorCode = 'usage' | 'invalid-project' | 'missing-file' | 'invalid-media' | 'ffmpeg-missing' | 'conflict';

/** A failure of a project operation (reading a project, running ffmpeg, a take that cannot be used). */
export class CoreError extends Error {
  readonly code: CoreErrorCode;

  constructor(code: CoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CoreError';
    this.code = code;
  }
}
```

`packages/core/src/ffmpeg.ts`:

```ts
import { spawn } from 'node:child_process';
import { CoreError } from './errors';

/** The ffmpeg executable: `CUTTLE_FFMPEG` when set, otherwise `ffmpeg` from PATH. */
export function ffmpegPath(): string {
  return process.env.CUTTLE_FFMPEG || 'ffmpeg';
}

/** Runs ffmpeg and returns stdout (bytes) and stderr (text); a non-zero exit is a CoreError with the end of the log. */
export function runFfmpeg(args: readonly string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'ENOENT'
          ? new CoreError('ffmpeg-missing', `ffmpeg was not found (looked for "${ffmpegPath()}"). Install it (Windows: winget install Gyan.FFmpeg) or set CUTTLE_FFMPEG.`)
          : error,
      ),
    );
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout: Buffer.concat(out), stderr });
      const tail = stderr.trim().split(/\r?\n/).slice(-8).join('\n');
      reject(new CoreError('invalid-media', `ffmpeg failed (exit code ${code}):\n${tail}`));
    });
  });
}
```

`packages/core/src/project-file.ts`:

```ts
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CURRENT_VERSION, parseProject, parseProjectJson, type CuttleProject } from '@cuttle/project';
import { CoreError } from './errors';

export const PROJECT_FILE = 'cuttle.json';

/**
 * cuttle.json as the user wrote it (`raw`: defaults not filled in, unknown order kept) and parsed
 * (`project`). Commands edit `raw` and write it back, so the file stays as short as it was.
 */
export interface ProjectFile {
  dir: string;
  path: string;
  raw: Record<string, unknown>;
  project: CuttleProject;
  /**
   * SHA-256 of the file's bytes as last read or written; none for a project not on disk yet.
   * Writing refuses when the file on disk no longer has it.
   */
  hash?: string;
}

const hashOf = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const issuesText = (issues: readonly { path: string; message: string }[]) => issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');

export async function readProjectFile(projectDir: string): Promise<ProjectFile> {
  const dir = resolve(projectDir);
  const path = join(dir, PROJECT_FILE);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CoreError('invalid-project', `${path} does not exist; run "cuttle init" or "cuttle record" in the project folder (or pass -C <dir>)`);
    }
    throw new CoreError('invalid-project', `cannot read ${path}: ${(error as Error).message}`, { cause: error });
  }
  const text = bytes.toString('utf8');
  const parsed = parseProjectJson(text);
  if (!parsed.ok) throw new CoreError('invalid-project', `${path} is not a valid project:\n${issuesText(parsed.issues)}`);
  const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>;
  return { dir, path, raw, project: parsed.project, hash: hashOf(bytes) };
}

/** A new project that records into takes/1. */
export function newProjectFile(projectDir: string): ProjectFile {
  const dir = resolve(projectDir);
  const raw = { version: CURRENT_VERSION, sources: { screen: 'takes/1/screen.mp4' } };
  return { dir, path: join(dir, PROJECT_FILE), raw, project: parse(raw) };
}

export function projectExists(projectDir: string): boolean {
  return existsSync(join(resolve(projectDir), PROJECT_FILE));
}

/**
 * Checks `file.raw` again and writes it as 2-space JSON (temp file and rename, so a crash never
 * leaves half a file), creating the project folder when it is new. Refuses with `conflict` when the
 * file on disk is no longer the one `file` was read from or last written as (or appeared, for a new
 * project), so it never overwrites what another program saved meanwhile; `operation` names what
 * ran, for the message. Updates `file`'s project and hash and returns it.
 */
export async function writeProjectFile(file: ProjectFile, operation: string): Promise<ProjectFile> {
  const project = parse(file.raw);
  const text = `${JSON.stringify(file.raw, null, 2)}\n`;
  await mkdir(file.dir, { recursive: true });
  const onDisk = await readFile(file.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw new CoreError('invalid-project', `cannot read ${file.path}: ${error.message}`, { cause: error });
  });
  if ((onDisk && hashOf(onDisk)) !== file.hash) {
    throw new CoreError('conflict', `${file.path} changed while ${operation} ran; nothing was written, run it again`);
  }
  const temp = `${file.path}.${process.pid}.tmp`;
  await writeFile(temp, text);
  try {
    await renameWhenFree(temp, file.path);
  } catch (error) {
    await rm(temp, { force: true });
    throw new CoreError('invalid-project', `cannot write ${file.path}: ${(error as Error).message}`, { cause: error });
  }
  file.project = project;
  file.hash = hashOf(text);
  return file;
}

/** Backups kept per file: `<file>.bak` is the newest, then `<file>.bak.1` … `<file>.bak.4`. */
export const BACKUPS = 5;

/**
 * Copies `path` to `<path>.bak` before a command changes it, moving older backups one step down
 * (`.bak` → `.bak.1` …, the oldest is dropped). A backup with the same bytes is not repeated, so
 * running a command twice keeps the older versions. Returns the backup's path.
 */
export async function backupFile(path: string): Promise<string> {
  const bak = `${path}.bak`;
  const current = await readFile(path);
  if (existsSync(bak)) {
    if ((await readFile(bak)).equals(current)) return bak;
    for (let n = BACKUPS - 1; n >= 1; n--) {
      const from = n === 1 ? bak : `${bak}.${n - 1}`;
      if (existsSync(from)) await renameWhenFree(from, `${bak}.${n}`);
    }
  }
  await writeFile(bak, current);
  return bak;
}

/** A rename that waits a moment for a file another program holds (OneDrive, a virus scanner, an editor). */
async function renameWhenFree(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      await new Promise((done) => setTimeout(done, 100 * attempt));
    }
  }
}

function parse(raw: unknown): CuttleProject {
  const parsed = parseProject(raw);
  if (!parsed.ok) throw new CoreError('invalid-project', `the edited project is not valid:\n${issuesText(parsed.issues)}`);
  return parsed.project;
}
```

`packages/core/src/suggest/media.ts`:

```ts
// What suggest needs from the screen track, read with ffmpeg.
import { CoreError } from '../errors';
import { runFfmpeg } from '../ffmpeg';
import type { Span } from './spans';

export interface ScreenAnalysis {
  /** Length of the screen track in seconds. */
  duration: number;
  width: number;
  height: number;
  /** Where the picture did not change for at least `STILL_SECONDS` (a blinking caret does not count). */
  still: Span[];
}

/** Shortest unchanged stretch that counts as still. */
export const STILL_SECONDS = 0.5;

/** One pass over the screen track: its size, length and the stretches where nothing changed. */
export async function analyseScreen(path: string): Promise<ScreenAnalysis> {
  const { stderr } = await runFfmpeg([
    '-i', path, '-map', '0:v:0',
    '-vf', `scale=320:-2,format=gray,freezedetect=n=-60dB:d=${STILL_SECONDS}`,
    '-f', 'null', '-',
  ]);
  return parseAnalysis(stderr);
}

/** Reads the log of `analyseScreen`'s ffmpeg run. */
export function parseAnalysis(log: string): ScreenAnalysis {
  const size = /Stream #0:0[^\n]*Video: [^\n]*?(\d{2,5})x(\d{2,5})/.exec(log);
  const times = [...log.matchAll(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)];
  const last = times.at(-1);
  const duration = last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : 0;
  const still: Span[] = [];
  let open: number | undefined;
  for (const match of log.matchAll(/lavfi\.freezedetect\.freeze_(start|end): (\d+(?:\.\d+)?)/g)) {
    const at = Number(match[2]);
    if (match[1] === 'start') open = at;
    else if (open !== undefined) {
      still.push({ from: open, to: at });
      open = undefined;
    }
  }
  if (open !== undefined) still.push({ from: open, to: duration });
  return { duration, width: Number(size?.[1] ?? 0), height: Number(size?.[2] ?? 0), still };
}

/** Size and length of the screen track from a pass that copies its packets (fast: nothing is decoded). */
export async function probeScreen(path: string): Promise<{ duration: number; width: number; height: number }> {
  const { stderr } = await runFfmpeg(['-i', path, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
  const { duration, width, height } = parseAnalysis(stderr);
  return { duration, width, height };
}

/**
 * Seconds of the first video (`v`) or audio (`a`) stream of a file, read by copying its packets
 * (fast: nothing is decoded); 0 when the file has no such stream or nothing readable. A missing
 * ffmpeg is an error, not an empty file.
 */
export async function streamSeconds(path: string, stream: 'v' | 'a'): Promise<number> {
  try {
    const { stderr } = await runFfmpeg(['-i', path, '-map', `0:${stream}:0`, '-c', 'copy', '-f', 'null', '-']);
    const last = [...stderr.matchAll(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)].at(-1);
    return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : 0;
  } catch (error) {
    if (error instanceof CoreError && error.code === 'ffmpeg-missing') throw error;
    return 0;
  }
}

/** A grey picture of the screen track at `t`, `width` pixels wide (for comparing two moments). */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

export async function grabGray(path: string, t: number, width: number): Promise<Gray> {
  const { stdout } = await runFfmpeg(['-ss', t.toFixed(3), '-i', path, '-frames:v', '1', '-vf', `scale=${width}:-2,format=gray`, '-f', 'rawvideo', '-']);
  return { width, height: Math.floor(stdout.length / width), data: new Uint8Array(stdout) };
}
```

`packages/core/src/suggest/plan.ts`:

```ts
// Scenes from what happened in a take: trim the quiet start and end, cut idle stretches, speed up
// waiting. Pure: the inputs come from events.jsonl, markers.json and an ffmpeg pass over the screen.
import type { InputEvent, Marker } from '@cuttle/project';
import { gaps, length, union, type Span } from './spans';

/** The rules, in seconds of the take. */
export const RULES = {
  /** Kept before the first activity and after the last. */
  lead: 0.5,
  tail: 1,
  /** Kept after Claude's final answer, so it can be read. */
  answerTail: 2.5,
  /** Before a prompt marker: the prompt being sent is on screen. */
  promptLead: 2,
  /** An input event counts as activity this long before and after it. */
  inputPad: 0.3,
  /** No input and a still screen for this long is cut out, keeping `idleKeep` on both sides. */
  idleCut: 3,
  idleKeep: 0.5,
  /** No input for this long (the screen may change: Claude at work) is sped up, keeping `waitKeep` at 1× on both sides. */
  waitMin: 8,
  waitKeep: 1,
  /** A speed-up shows about this share of its stretch, but at least `waitShortest` and at most `waitLongest` seconds of video. */
  waitShare: 1 / 12,
  waitShortest: 3,
  waitLongest: 10,
  /** The final answer appears at 1× from this long before its marker. */
  answerLead: 1.5,
  /** Shorter 1× pieces next to a speed-up join it. */
  minClip: 0.6,
};

/** Speeds a speed-up may get (the badge shows them). */
const SPEEDS = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

export interface SuggestInput {
  /** Length of the screen track. */
  duration: number;
  events: readonly InputEvent[];
  markers: readonly Marker[];
  /** Where the screen did not change. */
  still: readonly Span[];
}

export interface SuggestedClip {
  from: number;
  to: number;
  speed: number;
  /** What the clip shows, for people: "Prompt", "Claude at work", "Waiting", "Answer". */
  label?: string;
}

export interface Suggestion {
  clips: SuggestedClip[];
  /** What was trimmed, cut and sped up, for people. */
  notes: string[];
  /** Source time of Claude's final answer, when the markers have one. */
  answer?: number;
}

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;
const range = (span: Span) => `${span.from.toFixed(1)}–${span.to.toFixed(1)} s`;

export function suggestClips(input: SuggestInput): Suggestion {
  const { duration } = input;
  const notes: string[] = [];
  const answer = input.markers.filter((marker) => marker.kind === 'answer').at(-1)?.t;
  const prompt = input.markers.find((marker) => marker.kind === 'prompt')?.t;
  const inputSpans = union(
    input.events
      .filter((event) => event.type !== 'shape')
      .map((event) => ({ from: Math.max(0, event.t - RULES.inputPad), to: Math.min(duration, event.t + RULES.inputPad) })),
  );
  // Claude's turn, from its first prompt or tool call to the answer, is never cut: it only waits on a
  // spinner now and then (a still screen), and the speed-up shows it working.
  const turnStart = answer === undefined ? undefined : input.markers.filter((marker) => marker.kind !== 'manual' && marker.t <= answer).at(0)?.t;
  const turn = turnStart !== undefined && answer !== undefined && answer > turnStart ? [{ from: turnStart, to: answer }] : [];
  const active = union([...inputSpans, ...gaps(input.still, 0, duration), ...turn]);
  if (active.length === 0 || duration <= 0) {
    return { clips: duration > 0 ? [{ from: 0, to: ms(duration), speed: 1 }] : [], notes: ['nothing happened on screen or at the keyboard: the whole take, unchanged'] };
  }

  let start = Math.max(0, active[0]!.from - RULES.lead);
  if (prompt !== undefined) start = Math.min(start, Math.max(0, prompt - RULES.promptLead));
  let end = Math.min(duration, active.at(-1)!.to + RULES.tail);
  if (answer !== undefined) end = Math.min(duration, Math.max(end, answer + RULES.answerTail));
  if (start > 0.05) notes.push(`trimmed the quiet start (${range({ from: 0, to: start })})`);
  if (end < duration - 0.05) notes.push(`trimmed the quiet end (${range({ from: end, to: duration })})`);

  const cuts = gaps(active, start, end)
    .filter((gap) => length(gap) >= RULES.idleCut)
    .map((gap) => ({ from: gap.from + RULES.idleKeep, to: gap.to - RULES.idleKeep }));
  for (const cut of cuts) notes.push(`cut ${length(cut).toFixed(1)} s of idle screen (${range(cut)})`);

  const clips: SuggestedClip[] = [];
  for (const kept of gaps(cuts, start, end)) clips.push(...withSpeedUps(kept, inputSpans, answer, notes));
  return {
    clips: clips.map((clip) => {
      const label = labelOf(clip, prompt, answer, turn);
      return { from: ms(clip.from), to: ms(clip.to), speed: clip.speed, ...(label !== undefined && { label }) };
    }),
    notes,
    ...(answer !== undefined && { answer }),
  };
}

/** A name for a clip from Claude's markers: a speed-up during Claude's turn, other waiting, the clip with the answer or the prompt. */
function labelOf(clip: SuggestedClip, prompt: number | undefined, answer: number | undefined, turn: readonly Span[]): string | undefined {
  const holds = (t: number | undefined) => t !== undefined && clip.from <= t && t < clip.to;
  if (clip.speed > 1) return turn.some((span) => span.from < clip.to && clip.from < span.to) ? 'Claude at work' : 'Waiting';
  if (holds(answer)) return 'Answer';
  if (holds(prompt)) return 'Prompt';
  return undefined;
}

/** `kept` as 1× clips, with every long stretch without input sped up. */
function withSpeedUps(kept: Span, inputSpans: readonly Span[], answer: number | undefined, notes: string[]): SuggestedClip[] {
  const fast: SuggestedClip[] = [];
  for (const wait of gaps(inputSpans, kept.from, kept.to)) {
    if (length(wait) < RULES.waitMin) continue;
    const inner = { from: wait.from + RULES.waitKeep, to: wait.to - RULES.waitKeep };
    // Claude's answer stays at 1×: a wait around it is sped up before and after it.
    const pieces =
      answer !== undefined && answer >= wait.from && answer < wait.to
        ? [
            { from: inner.from, to: Math.min(inner.to, answer - RULES.answerLead) },
            { from: answer + RULES.answerTail, to: inner.to },
          ]
        : [inner];
    for (const piece of pieces) {
      if (length(piece) <= 0) continue;
      const target = Math.min(RULES.waitLongest, Math.max(RULES.waitShortest, length(piece) * RULES.waitShare));
      const speed = SPEEDS.filter((candidate) => candidate <= length(piece) / target).at(-1);
      if (speed === undefined) continue;
      fast.push({ ...piece, speed });
      notes.push(`sped up ${length(piece).toFixed(1)} s without input ${speed}× (${range(piece)})`);
    }
  }
  const clips: SuggestedClip[] = [];
  let at = kept.from;
  for (const piece of fast) {
    if (piece.from - at >= RULES.minClip) clips.push({ from: at, to: piece.from, speed: 1 });
    else piece.from = at; // a short 1× piece joins the speed-up
    clips.push(piece);
    at = piece.to;
  }
  if (kept.to - at >= RULES.minClip || clips.length === 0) clips.push({ from: at, to: kept.to, speed: 1 });
  else clips.at(-1)!.to = kept.to;
  return clips;
}
```

`packages/core/src/suggest.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { newId, parseEventsJsonl, parseMarkersJson, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect } from '@cuttle/project';
import { CoreError } from './errors';
import { backupFile, readProjectFile, writeProjectFile } from './project-file';
import { analyseScreen, grabGray } from './suggest/media';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { transcriptMarkers } from './suggest/transcript';

export interface SuggestOptions {
  /** The folder Claude Code ran in (true: the current folder), for a take without Claude markers. */
  claude?: string | true;
  /** Print the suggestion without writing cuttle.json. */
  dryRun?: boolean;
  /** Zoom on Claude's final answer (default true). */
  zoom?: boolean;
  /** Status for people while it runs. */
  onStatus?: (text: string) => void;
}

type ClipScene = { type: 'clip'; id: string; label?: string; from: number; to: number; speed?: number };

export interface SuggestResult {
  project: string;
  /** The suggested clips, with the project's still and card scenes before (those that were before the first clip) and after them. */
  scenes: (ClipScene | Record<string, unknown>)[];
  zooms: { id: string; label: string; at: number; duration: number; rect: Rect }[];
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
  written: boolean;
  /** The previous cuttle.json. */
  backup?: string;
}

/** Grey pictures this wide are compared to find where Claude's answer appeared. */
const COMPARE_WIDTH = 480;
/** The answer is compared with the screen this long before it. */
const ANSWER_LOOKBACK = 6;
const ZOOM_SECONDS = 4;

/**
 * Suggests scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
 * sped up) and a zoom on Claude's answer, written to cuttle.json. The clip scenes and the zooms are
 * replaced; still and card scenes keep their place before or after the clips, masks and texts stay;
 * the previous file is kept as cuttle.json.bak. The new clips and zoom get ids no kept item uses and
 * labels from Claude's markers.
 */
export async function suggestProject(projectDir: string, args: SuggestOptions = {}): Promise<SuggestResult> {
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  const screen = resolve(file.dir, sources.screen);
  args.onStatus?.('reading the screen recording …');
  const screenInfo = await analyseScreen(screen);
  if (screenInfo.duration <= 0) throw new CoreError('invalid-media', `${screen} has no video frames`);
  const notes: string[] = [];
  let events: InputEvent[] = [];
  if (sources.events) {
    const read = await readEvents(resolve(file.dir, sources.events));
    if (read === undefined) notes.push(`${sources.events} cannot be read: only screen changes and markers count as activity`);
    else events = read;
  }
  let markers = sources.markers ? await readMarkers(resolve(file.dir, sources.markers)) : [];
  let from: SuggestResult['markers']['from'] = markers.length > 0 ? 'take' : 'none';
  if (args.claude !== undefined && !markers.some((marker) => marker.kind !== 'manual')) {
    const cwd = args.claude === true ? process.cwd() : resolve(args.claude);
    const start = await screenStart(dirname(screen));
    const found = await transcriptMarkers(cwd, start, screenInfo.duration);
    if (found.length > 0) {
      markers = [...markers, ...found].sort((a, b) => a.t - b.t);
      from = 'transcript';
    } else {
      notes.push(
        start === 0
          ? "no Claude markers: take.json has no start time (it was rebuilt by recover), so the transcript cannot be matched"
          : `no Claude markers: no Claude Code session in ${cwd} prompted, called a tool or answered during the take`,
      );
    }
  }

  const suggestion = suggestClips({ duration: screenInfo.duration, events, markers, still: screenInfo.still });
  notes.push(...suggestion.notes);
  // Page captures and cards stay where they were: before the first clip (a title card) or after it.
  const previous = (file.raw.scenes as Record<string, unknown>[] | undefined) ?? [];
  const firstClip = previous.findIndex((scene) => scene.type === 'clip');
  const before = firstClip < 0 ? [] : previous.slice(0, firstClip).filter((scene) => scene.type !== 'clip');
  const after = previous.slice(Math.max(0, firstClip)).filter((scene) => scene.type !== 'clip');
  const taken = usedIds({ scenes: [...before, ...after], masks: file.raw.masks, texts: file.raw.texts });
  const clips: ClipScene[] = suggestion.clips.map(({ from: start, to, speed, label }) => ({
    type: 'clip',
    id: newId('scenes', taken),
    ...(label !== undefined && { label }),
    from: start,
    to,
    ...(speed !== 1 && { speed }),
  }));
  if (before.length + after.length > 0) {
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
    ]);
    const region = changedRegion(before, after);
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

  let backup: string | undefined;
  if (!args.dryRun) {
    backup = await backupFile(file.path);
    file.raw.scenes = scenes;
    file.raw.zooms = zooms;
    await writeProjectFile(file, 'suggest');
  }
  const result: SuggestResult = {
    project: file.path,
    scenes,
    zooms,
    notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
    ...(backup && { backup }),
  };
  return result;
}

/** The events of events.jsonl; undefined when the file cannot be read. */
async function readEvents(path: string): Promise<InputEvent[] | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  return text === undefined ? undefined : parseEventsJsonl(text).events;
}

async function readMarkers(path: string): Promise<Marker[]> {
  const parsed = parseMarkersJson(await readFile(path, 'utf8').catch(() => ''));
  return parsed.ok ? parsed.markers : [];
}

/** The screen track's start (wall-clock seconds) from the take.json next to it. */
async function screenStart(takeDir: string): Promise<number> {
  const path = join(takeDir, 'take.json');
  const parsed = parseTakeJson(await readFile(path, 'utf8').catch(() => ''));
  if (!parsed.ok) throw new CoreError('usage', `Claude's markers from the transcript need the take's start time from ${path}, which is missing or invalid`);
  return parsed.take.tracks.screen.start;
}
```

`packages/core/src/recover.ts`:

```ts
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, parseEventsJsonl, parseMarkersJson, parseTakeJson, type TakeFile } from '@cuttle/project';
import { CoreError } from './errors';
import { backupFile, newProjectFile, projectExists, readProjectFile, writeProjectFile } from './project-file';
import { streamSeconds } from './suggest/media';
import { samePath, useTake } from './use-take';

export interface RecoverResult {
  project: string;
  /** The take folder, relative to the project. */
  take: string;
  seconds: number;
  tracks: string[];
  /** What was repaired, for people; empty when the take was fine. */
  repaired: string[];
  /** Whether the project's scenes and overlays were kept (the take was already the project's). */
  keptEdit: boolean;
  backup?: string;
}

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json' };

/**
 * Recovers a take (a folder relative to the project, e.g. takes/3): makes it usable after
 * a crash (the recorder's fragmented MP4s stay readable up to their last fragment): checks every
 * track, drops a cut-off events.jsonl line, rewrites markers.json and take.json when they are missing
 * or broken (every changed file is backed up first), and points the project at the take. When the
 * project already uses that take, its scenes and overlays stay.
 */
export async function recoverTake(projectDir: string, takeDir: string): Promise<RecoverResult> {
  const project = resolve(projectDir);
  const dir = resolve(project, takeDir);
  const rel = relative(project, dir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new CoreError('usage', `the take ${dir} must be a folder inside the project ${project}`);
  // A broken cuttle.json stops the command before anything in the take changes.
  const file = projectExists(project) ? await readProjectFile(project) : newProjectFile(project);
  const path = (name: string) => join(dir, name);
  const source = (name: string) => `${rel.split(sep).join('/')}/${name}`;
  const repaired: string[] = [];

  const seconds = await streamSeconds(path(FILES.screen), 'v');
  if (seconds <= 0) throw new CoreError('invalid-media', `${path(FILES.screen)} is missing or has no readable video; nothing to recover`);
  const webcam = existsSync(path(FILES.webcam)) && (await streamSeconds(path(FILES.webcam), 'v')) > 0;
  const mic = existsSync(path(FILES.mic)) && (await streamSeconds(path(FILES.mic), 'a')) > 0;
  for (const [ok, name] of [[webcam, FILES.webcam], [mic, FILES.mic]] as const) {
    if (!ok && existsSync(path(name))) repaired.push(`left out ${name}: it has nothing readable`);
  }

  // events.jsonl: keep the valid lines as they are (a crash cuts off the last one).
  if (existsSync(path(FILES.events))) {
    const text = await readFile(path(FILES.events), 'utf8');
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    const kept = lines.filter((line) => {
      const { events, issues } = parseEventsJsonl(`${line}\n`);
      return events.length === 1 && issues.length === 0;
    });
    if (kept.length < lines.length || (text !== '' && !text.endsWith('\n'))) {
      const backup = await backupFile(path(FILES.events));
      await writeFile(path(FILES.events), kept.map((line) => `${line}\n`).join(''));
      repaired.push(`events.jsonl: kept ${kept.length} events, dropped ${lines.length - kept.length} broken or cut-off line(s) (old file: ${relative(dir, backup)})`);
    }
  } else {
    await writeFile(path(FILES.events), '');
    repaired.push('events.jsonl was missing: written empty (no cursor, clicks or keys)');
  }

  const markersText = existsSync(path(FILES.markers)) ? await readFile(path(FILES.markers), 'utf8') : undefined;
  if (markersText === undefined || !parseMarkersJson(markersText).ok) {
    const backup = markersText === undefined ? undefined : await backupFile(path(FILES.markers));
    await writeFile(path(FILES.markers), `${JSON.stringify({ version: MARKERS_VERSION, markers: [] }, null, 2)}\n`);
    repaired.push(backup === undefined ? 'markers.json was missing: written empty' : `markers.json was broken: written empty (old file: ${relative(dir, backup)})`);
  }

  const takeText = existsSync(path(FILES.take)) ? await readFile(path(FILES.take), 'utf8') : undefined;
  const parsed = takeText === undefined ? undefined : parseTakeJson(takeText);
  if (!parsed?.ok) {
    const backup = takeText === undefined ? undefined : await backupFile(path(FILES.take));
    // Start times that can still be read are kept: they sync webcam and mic and place Claude's
    // markers. Without the screen's, the others mean nothing (they are relative to it): all start at 0.
    const readable = readableStarts(takeText);
    const starts: typeof readable = readable.screen === undefined ? {} : readable;
    const screenStart = starts.screen ?? 0;
    const take: TakeFile = {
      version: TAKE_VERSION,
      tracks: {
        screen: { file: FILES.screen, start: screenStart },
        ...(webcam && { webcam: { file: FILES.webcam, start: starts.webcam ?? screenStart } }),
        ...(mic && { mic: { file: FILES.mic, start: starts.mic ?? screenStart } }),
      },
    };
    await writeFile(path(FILES.take), `${JSON.stringify(take, null, 2)}\n`);
    const what = backup === undefined ? 'take.json was missing' : `take.json was broken (old file: ${relative(dir, backup)})`;
    const guessed = (webcam && starts.webcam === undefined) || (mic && starts.mic === undefined);
    repaired.push(
      starts.screen === undefined
        ? `${what}: written with the tracks starting together at an unknown time${webcam || mic ? ' (webcam and mic may be off by up to a second)' : ''}`
        : `${what}: rewritten with the screen's start time${guessed ? '; webcam and mic start with it (may be off by up to a second)' : ''}`,
    );
  }

  const { scenes, zooms, masks, texts } = file.project;
  const sameTake = samePath(resolve(file.dir, file.project.sources.screen), path(FILES.screen));
  const keepEdit = sameTake && scenes.length + zooms.length + masks.length + texts.length > 0;
  const backup = await useTake(
    file,
    {
      screen: source(FILES.screen),
      ...(webcam && { webcam: source(FILES.webcam) }),
      ...(mic && { mic: source(FILES.mic) }),
      events: source(FILES.events),
      markers: source(FILES.markers),
      seconds,
    },
    sameTake,
  );
  await writeProjectFile(file, 'recover');
  const result: RecoverResult = {
    project: file.path,
    take: rel.split(sep).join('/'),
    seconds,
    tracks: ['screen', ...(webcam ? ['webcam'] : []), ...(mic ? ['mic'] : [])],
    repaired,
    keptEdit: keepEdit,
    ...(backup && { backup }),
  };
  return result;
}

/** The track start times in a take.json that fails the schema but is still JSON. */
function readableStarts(text: string | undefined): Partial<Record<'screen' | 'webcam' | 'mic', number>> {
  try {
    const tracks = (JSON.parse(text ?? '') as { tracks?: Record<string, { start?: unknown } | undefined> }).tracks ?? {};
    const starts: Partial<Record<'screen' | 'webcam' | 'mic', number>> = {};
    for (const track of ['screen', 'webcam', 'mic'] as const) {
      const start = tracks[track]?.start;
      if (typeof start === 'number' && Number.isFinite(start) && start >= 0) starts[track] = start;
    }
    return starts;
  } catch {
    return {};
  }
}
```

`packages/core/src/frame.ts`:

```ts
import { existsSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CoreError } from './errors';
import { runFfmpeg } from './ffmpeg';
import { readProjectFile } from './project-file';
import { probeScreen } from './suggest/media';

export interface FrameOptions {
  /** A pixel grid with numbers over the frame, for reading the rects of masks and zooms. */
  grid?: boolean;
  /** PNG to write (default frames/<t>s.png, or frames/<t>s-grid.png, in the project). */
  out?: string;
  /** A warning for people (the grid without numbers). */
  onWarning?: (text: string) => void;
}

export interface FrameResult {
  /** Source seconds of the frame. */
  t: number;
  file: string;
  /** The screen track's size: the PNG's size, and the pixels rects are given in. */
  width: number;
  height: number;
  grid: boolean;
  /** Whether the grid lines carry their pixel numbers (they need a system font). */
  labels: boolean;
}

/** Grid lines every this many source pixels, stronger every `GRID_MAJOR`. */
export const GRID_STEP = 100;
const GRID_MAJOR = 500;

/** Fonts ffmpeg's drawtext can use for the grid numbers, by platform (drawtext needs a font file). */
function fonts(): string[] {
  const windows = (process.env.WINDIR ?? 'C:/Windows').replace(/\\/g, '/');
  if (process.platform === 'win32') return [`${windows}/Fonts/arial.ttf`, `${windows}/Fonts/segoeui.ttf`];
  if (process.platform === 'darwin') return ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf'];
  return ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf'];
}

function labelFont(): string | undefined {
  return fonts().find((font) => existsSync(font));
}

/** The grid as an ffmpeg filter chain: lines every GRID_STEP px (stronger every GRID_MAJOR), numbered when there is a font. */
export function gridFilter(width: number, height: number, font: string | undefined): string {
  const lines = [`drawgrid=w=${GRID_STEP}:h=${GRID_STEP}:t=1:c=0xFF00FF@0.35`, `drawgrid=w=${GRID_MAJOR}:h=${GRID_MAJOR}:t=3:c=0xFF00FF@0.7`];
  if (font === undefined) return lines.join(',');
  // drawtext's options are `:`-separated: escape the drive letter's colon.
  const fontfile = font.replace(/\\/g, '/').replace(/:/g, '\\:');
  const size = Math.max(12, Math.round(height / 80));
  const label = (value: number, x: number, y: number) =>
    `drawtext=fontfile='${fontfile}':text=${value}:x=${x}:y=${y}:fontsize=${size}:fontcolor=white:box=1:boxcolor=0xFF00FF@0.7:boxborderw=2`;
  const labels: string[] = [];
  for (let x = 0; x < width; x += GRID_STEP) labels.push(label(x, x + 3, 3));
  for (let y = GRID_STEP; y < height; y += GRID_STEP) labels.push(label(y, 3, y + 3));
  return [...lines, ...labels].join(',');
}

/**
 * The screen track's frame at a source second as a PNG at full size, in
 * the pixels masks and zooms use; with `grid` a numbered pixel grid to read rects from.
 */
export async function grabFrame(projectDir: string, at: number, args: FrameOptions = {}): Promise<FrameResult> {
  const file = await readProjectFile(projectDir);
  const screen = resolve(file.dir, file.project.sources.screen);
  if (!existsSync(screen)) throw new CoreError('missing-file', `the screen track ${screen} does not exist`);
  const { width, height, duration } = await probeScreen(screen);
  if (at >= duration) throw new CoreError('usage', `the screen track is ${duration.toFixed(2)} s long; ${at} s is past its end`);
  const out = args.out ? resolve(args.out) : join(file.dir, 'frames', `${at.toFixed(2)}s${args.grid ? '-grid' : ''}.png`);
  await mkdir(dirname(out), { recursive: true });
  if (existsSync(out) && statSync(out).isDirectory()) throw new CoreError('usage', `the frame needs a file name, not the folder ${out}`);
  // An older file there must not pass for the new frame when ffmpeg writes none.
  await rm(out, { force: true });
  // -update 1: one picture, so a `%d` in the path is not read as a frame-number pattern.
  const grab = (filter: string[]) => runFfmpeg(['-ss', at.toFixed(3), '-i', screen, '-frames:v', '1', ...filter, '-update', '1', '-y', out]);
  let font = args.grid ? labelFont() : undefined;
  if (args.grid && font === undefined) args.onWarning?.('no font for the grid numbers was found: the grid has lines only (every 100 px, stronger every 500 px)');
  try {
    await grab(args.grid ? ['-vf', gridFilter(width, height, font)] : []);
  } catch (error) {
    // An ffmpeg built without drawtext (no FreeType) can still draw the lines.
    if (font === undefined || !String((error as Error).message).includes('drawtext')) throw error;
    args.onWarning?.('this ffmpeg cannot draw text: the grid has lines only (every 100 px, stronger every 500 px)');
    font = undefined;
    await grab(['-vf', gridFilter(width, height, undefined)]);
  }
  if (!existsSync(out)) {
    throw new CoreError('usage', `no frame starts at or after ${at} s (the screen track ends at ${duration.toFixed(2)} s); take an earlier time`);
  }
  const result: FrameResult = { t: at, file: out, width, height, grid: args.grid ?? false, labels: font !== undefined };
  return result;
}
```

`packages/core/src/index.ts`:

```ts
// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, and run ffmpeg.
export { CoreError, type CoreErrorCode } from './errors';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
export { BACKUPS, PROJECT_FILE, backupFile, newProjectFile, projectExists, readProjectFile, writeProjectFile, type ProjectFile } from './project-file';
export { samePath, useTake, type TakeFiles } from './use-take';
export { suggestProject, type SuggestOptions, type SuggestResult } from './suggest';
export { recoverTake, type RecoverResult } from './recover';
export { GRID_STEP, grabFrame, gridFilter, type FrameOptions, type FrameResult } from './frame';
export { analyseScreen, grabGray, parseAnalysis, probeScreen, streamSeconds, type Gray, type ScreenAnalysis } from './suggest/media';
export { RULES, suggestClips, type SuggestInput, type SuggestedClip, type Suggestion } from './suggest/plan';
export { changedRegion, zoomRect } from './suggest/region';
export { gaps, length, union, type Span } from './suggest/spans';
export { transcriptMarkers } from './suggest/transcript';
```

- [ ] **Step 5: The CLI on top of core**

In `apps/cli/src/errors.ts`, replace:

```ts
  'missing-file': EXIT.usage,
  'invalid-media': EXIT.usage,
  render: EXIT.render,
};

/** A failure the CLI reports with a code and an exit code. */
```

with:

```ts
  'missing-file': EXIT.usage,
  'invalid-media': EXIT.usage,
  render: EXIT.render,
  // @cuttle/core
  conflict: EXIT.usage,
};

/** A failure the CLI reports with a code and an exit code. */
```

`apps/cli/src/commands/suggest.ts`:

```ts
import { suggestProject, type SuggestOptions, type SuggestResult } from '@cuttle/core';
import type { Output } from '../output';

/**
 * `cuttle suggest`: scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
 * sped up) and a zoom on Claude's answer, written to cuttle.json (see @cuttle/core's suggestProject).
 */
export async function suggestCommand(projectDir: string, args: Omit<SuggestOptions, 'onStatus'>, output: Output): Promise<SuggestResult> {
  const result = await suggestProject(projectDir, { ...args, onStatus: (text) => output.info(text) });
  output.result(result, () => {
    const clips = result.scenes.filter((scene): scene is { type: 'clip'; from: number; to: number; speed?: number } => scene.type === 'clip');
    const seconds = clips.reduce((sum, scene) => sum + (scene.to - scene.from) / (scene.speed ?? 1), 0);
    return [
      ...result.notes.map((note) => `- ${note}`),
      `${clips.length} clip(s), about ${seconds.toFixed(1)} s${result.zooms.length > 0 ? `, ${result.zooms.length} zoom` : ''}`,
      result.written ? `written to ${result.project} (previous version: ${result.backup})` : '(dry run: cuttle.json unchanged)',
      'next: cuttle preview',
    ].join('\n');
  });
  return result;
}
```

`apps/cli/src/commands/recover.ts`:

```ts
import { recoverTake, type RecoverResult } from '@cuttle/core';
import type { Output } from '../output';

/** `cuttle recover <take>`: makes a take usable after a crash and uses it (see @cuttle/core's recoverTake). */
export async function recoverCommand(projectDir: string, takeDir: string, output: Output): Promise<RecoverResult> {
  const result = await recoverTake(projectDir, takeDir);
  output.result(result, () =>
    [
      `${result.take}: ${result.seconds.toFixed(1)} s, tracks: ${result.tracks.join(', ')}`,
      ...(result.repaired.length > 0 ? result.repaired.map((note) => `- ${note}`) : ['nothing needed repair']),
      result.keptEdit
        ? `${result.project} already used this take: scenes and overlays kept`
        : `${result.project} now uses this take${result.backup ? ` (previous version: ${result.backup})` : ''}`,
    ].join('\n'),
  );
  return result;
}
```

`apps/cli/src/commands/frame.ts`:

```ts
import { GRID_STEP, grabFrame, type FrameResult } from '@cuttle/core';
import type { Output } from '../output';

/** `cuttle frame <source-seconds>`: a frame of the screen track at full size (see @cuttle/core's grabFrame). */
export async function frameCommand(projectDir: string, at: number, args: { grid?: boolean; out?: string }, output: Output): Promise<FrameResult> {
  const result = await grabFrame(projectDir, at, { ...args, onWarning: (text) => output.warn(text) });
  output.result(result, () => `${result.file} (${result.width}×${result.height} source pixels${result.grid ? `, a grid every ${GRID_STEP} px` : ''})`);
  return result;
}
```

`apps/cli/src/commands/init.ts`:

```ts
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CliError } from '../errors';
import type { Output } from '../output';
import { newProjectFile, projectExists, PROJECT_FILE, writeProjectFile } from '@cuttle/core';

export interface InitResult {
  project: string;
}

/** `cuttle init [dir]`: a project folder with a default cuttle.json that records into takes/1. */
export async function init(dir: string, output: Output): Promise<InitResult> {
  const target = resolve(dir);
  if (projectExists(target)) throw new CliError('usage', `${target} already has a ${PROJECT_FILE}`);
  await mkdir(target, { recursive: true });
  const file = await writeProjectFile(newProjectFile(target), 'init');
  const result = { project: file.path };
  output.result(result, () => `created ${file.path}\nnext: cuttle record (in that folder)`);
  return result;
}
```

`apps/cli/src/commands/record.ts`:

```ts
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HOTKEYS, listDevices, record, type Backend, type CaptureSource, type Take } from '@cuttle/recorder';
import type { Rect } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';
import { newProjectFile, projectExists, readProjectFile, useTake, writeProjectFile } from '@cuttle/core';

export interface RecordArgs {
  monitor?: number;
  /** "x,y,w,h" in pixels of `monitor` (default: the primary monitor); PowerShell passes it split at the commas. */
  region?: string | string[];
  window?: string;
  /** A camera name, or true for the first camera. */
  webcam?: string | true;
  mic?: string | true;
  /** The folder Claude Code runs in, or true for the current folder. */
  untilClaude?: string | true;
  untilFile?: string;
  untilIdle?: number;
  max?: number;
  countdown?: number;
  drawMouse?: boolean;
  backend: Backend;
}

export interface RecordResult {
  project: string;
  take: Take;
  /** The previous cuttle.json, when the take replaced scenes or overlays. */
  backup?: string;
}

/**
 * `cuttle record`: records a take into the project (created when missing) and points the project at
 * it. Ctrl+C (`signal`) stops the recording like the stop hotkey; the take is kept.
 */
export async function recordCommand(projectDir: string, args: RecordArgs, output: Output, signal: AbortSignal): Promise<RecordResult> {
  const devices = await listDevices({ backend: args.backend });
  const source = captureSource(args, devices.monitors.find((monitor) => monitor.primary)?.index ?? devices.monitors[0]?.index ?? 0);
  const webcam = deviceName('camera', args.webcam, devices.cameras);
  const mic = deviceName('microphone', args.mic, devices.mics);
  // Read (or created) now, so a broken project stops the command before anything is recorded.
  const before = projectExists(projectDir) ? await readProjectFile(projectDir) : await writeProjectFile(newProjectFile(projectDir), 'record');
  if (signal.aborted) throw new CliError('cancelled', 'stopped before the recording started');

  const recording = record({
    projectDir: before.dir,
    source,
    ...(webcam !== undefined && { webcam }),
    ...(mic !== undefined && { mic }),
    stop: {
      ...(args.max !== undefined && { maxSeconds: args.max }),
      ...(args.untilFile !== undefined && { untilFile: args.untilFile }),
      ...(args.untilIdle !== undefined && { untilIdleSeconds: args.untilIdle }),
      ...(args.untilClaude !== undefined && { untilClaude: args.untilClaude === true ? process.cwd() : resolve(args.untilClaude) }),
    },
    ...(args.countdown !== undefined && { countdownSeconds: args.countdown }),
    drawMouse: args.drawMouse ?? false,
    backend: args.backend,
    onEvent(event) {
      if (event.type === 'countdown') output.info(`recording in ${event.seconds} …`);
      if (event.type === 'recording') output.info(`recording ${event.dir}; stop: Ctrl+C or ${HOTKEYS.stop}, marker: ${HOTKEYS.marker}`);
      if (event.type === 'marker') output.info(`marker ${event.marker.kind}${event.marker.label ? ` ${event.marker.label}` : ''} at ${event.marker.t.toFixed(2)} s`);
      if (event.type === 'warning') output.warn(event.message);
      if (event.type === 'stopping') output.info(`stopping (${event.reason}) …`);
    },
  });
  const stop = () => void recording.stop().catch(() => {});
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop(); // Ctrl+C while the recorder was being set up
  let take: Take;
  try {
    take = await recording.done;
  } finally {
    signal.removeEventListener('abort', stop);
  }
  // The stop file did its job; left there it would refuse the next take (it must not exist at the start).
  if (take.stopReason === 'file' && args.untilFile !== undefined) await rm(resolve(args.untilFile), { force: true }).catch(() => {});

  // Read again: the project may have been edited during the take; that version switches to the take.
  const file = await readProjectFile(projectDir);
  const backup = await useTake(file, take);
  if (args.drawMouse) {
    // The real pointer is in the video: the engine's cursor would be a second one.
    const look = (file.raw.look ?? {}) as Record<string, unknown>;
    file.raw.look = { ...look, cursor: { ...((look.cursor as Record<string, unknown> | undefined) ?? {}), enabled: false } };
  } else if (!file.project.look.cursor.enabled) {
    // Left from an earlier --draw-mouse take, this take would show no pointer at all.
    output.warn('look.cursor.enabled is false (from an earlier --draw-mouse take?): this take has no pointer in the video, so set it to true to show one');
  }
  await writeProjectFile(file, 'record');
  const result: RecordResult = { project: file.path, take, ...(backup && { backup }) };
  output.result(result, () =>
    [
      `recorded ${take.dir}: ${take.seconds.toFixed(1)} s, ${take.screenSize.width}×${take.screenSize.height} (${take.stopReason})`,
      ...take.warnings.map((warning) => `warning: ${warning}`),
      `${file.path} now uses this take${backup ? ` (previous version: ${backup})` : ''}`,
      ...(args.drawMouse ? ['look.cursor.enabled is now false: the pointer is in the video'] : []),
      'next: cuttle suggest, then cuttle preview',
    ].join('\n'),
  );
  return result;
}

function captureSource(args: RecordArgs, primary: number): CaptureSource {
  if (args.window !== undefined) {
    if (args.region !== undefined || args.monitor !== undefined) throw new CliError('usage', '--window cannot be combined with --monitor or --region');
    return { kind: 'window', title: args.window };
  }
  const monitor = args.monitor ?? primary;
  if (args.region === undefined) return { kind: 'monitor', index: monitor };
  const region = [args.region].flat().join(',');
  const parts = region.split(/[\s,]+/).filter((part) => part !== '').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    throw new CliError('usage', `--region needs x,y,w,h in pixels of the monitor, e.g. 0,0,1920,1080 (got "${region}")`);
  }
  return { kind: 'region', rect: parts as Rect, monitor };
}

function deviceName(kind: 'camera' | 'microphone', wanted: string | true | undefined, available: string[]): string | undefined {
  if (wanted === undefined || wanted !== true) return wanted;
  const first = available[0];
  if (first === undefined) throw new CliError('device-not-found', `no ${kind} found; "cuttle devices" lists them`);
  return first;
}
```

`apps/cli/src/commands/capture-page.ts`:

```ts
import { basename, extname, join, relative, sep } from 'node:path';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile, writeProjectFile } from '@cuttle/core';

export interface CaptureArgs {
  /** The whole page, for a scrolling still scene. */
  scroll?: boolean;
  width?: number;
  height?: number;
  /** File name in stills/ (without .png); default from the URL or file. */
  name?: string;
  /** Append a still scene that shows the capture. */
  add?: boolean;
  /** Seconds of that scene (default 4). */
  duration?: number;
  /** Milliseconds to wait after loading (fonts, maps, animations; default 1000). */
  wait?: number;
}

export interface CaptureResult {
  project: string;
  file: string;
  width: number;
  height: number;
  /** The scene that was appended, with `add`. */
  scene?: { type: 'still'; image: string; duration: number; motion: 'scroll' | 'none'; frame: 'browser-light' };
}

const DEFAULT_SCENE_SECONDS = 4;

/** `cuttle capture-page <url|file>`: a page as a PNG in stills/, optionally as a still scene. */
export async function capturePageCommand(projectDir: string, target: string, args: CaptureArgs, output: Output, signal: AbortSignal): Promise<CaptureResult> {
  const file = await readProjectFile(projectDir);
  const width = args.width ?? file.project.output.width;
  const height = args.height ?? file.project.output.height;
  for (const [name, value] of [['--width', width], ['--height', height], ['--duration', args.duration ?? 1], ['--wait', args.wait ?? 0]] as const) {
    if (!Number.isFinite(value) || value < 0) throw new CliError('usage', `${name} must be a number of 0 or more`);
  }
  const name = slug(args.name ?? nameOf(target));
  const out = join(file.dir, 'stills', `${name}.png`);
  output.info(`capturing ${target} …`);
  const shot = await runInElectron<{ file: string; width: number; height: number }>(
    { command: 'capture-page', target, out, width: Math.round(width), height: Math.round(height), fullPage: args.scroll ?? false, waitMs: Math.round(args.wait ?? 1000), quiet: output.json },
    signal,
  );
  let scene: CaptureResult['scene'];
  if (args.add) {
    if (signal.aborted) throw new CliError('cancelled', 'cancelled: the page was captured, but no scene was added');
    // Read again: the capture took a while, and the project may have been saved meanwhile.
    const latest = await readProjectFile(projectDir);
    scene = {
      type: 'still',
      image: relative(file.dir, out).split(sep).join('/'),
      duration: args.duration ?? DEFAULT_SCENE_SECONDS,
      motion: args.scroll ? 'scroll' : 'none',
      frame: 'browser-light',
    };
    latest.raw.scenes = [...((latest.raw.scenes as unknown[] | undefined) ?? []), scene];
    await writeProjectFile(latest, 'capture-page');
  }
  const result: CaptureResult = { project: file.path, ...shot, ...(scene && { scene }) };
  output.result(result, () => `captured ${shot.file} (${shot.width}×${shot.height})${scene ? `; appended a ${scene.duration} s still scene` : ''}`);
  return result;
}

/** A file name from a URL's host and path or a file's name. */
function nameOf(target: string): string {
  if (/^https?:\/\//i.test(target)) {
    const url = new URL(target);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  }
  return basename(target, extname(target));
}

function slug(text: string): string {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 60) || 'page';
}
```

In `apps/cli/src/commands/preview.ts`, replace:

```ts
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '../project-file';

export interface PreviewArgs {
  /** Output seconds; without them, a sheet of `SHEET_STILLS` evenly spaced stills. */
```

with:

```ts
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '@cuttle/core';

export interface PreviewArgs {
  /** Output seconds; without them, a sheet of `SHEET_STILLS` evenly spaced stills. */
```

In `apps/cli/src/commands/render.ts`, replace:

```ts
import { join, resolve } from 'node:path';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '../project-file';

export interface RenderArgs {
  format?: string;
```

with:

```ts
import { join, resolve } from 'node:path';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '@cuttle/core';

export interface RenderArgs {
  format?: string;
```

- [ ] **Step 6: Run the tests and the checks**

Run: `pnpm exec vitest run packages/core apps/cli/test/cli.test.ts`
Expected: PASS, 33 tests.

Run: `pnpm exec tsc -p packages/core/tsconfig.json && pnpm exec tsc -p apps/cli/tsconfig.json`
Expected: exits with code 0, no output.

Run: `pnpm cli:check`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add -A packages/core apps/cli package.json pnpm-lock.yaml
git commit -m "core: the CLI's project operations as @cuttle/core; suggest names its clips; hash-checked writes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs and the skill

**Files:**
- Modify: `skill/cuttle/project.md`, `skill/cuttle/SKILL.md`, `README.md`

- [ ] **Step 1: The reference, the skill and the README**

In `skill/cuttle/project.md`, replace:

```markdown
    "cursor": { "style": "system" }
  },
  "scenes": [
    { "type": "clip", "from": 1.2, "to": 7.5 },
    { "type": "clip", "from": 7.5, "to": 120.4, "speed": 12 },
    { "type": "clip", "from": 120.4, "to": 128 },
    { "type": "still", "image": "stills/example-com.png", "duration": 5, "motion": "scroll", "frame": "browser-light" },
    { "type": "card", "title": "Built with Claude Code", "subtitle": "example.com", "duration": 2.5 }
  ],
  "zooms": [{ "at": 121, "duration": 4, "rect": [0, 600, 1400, 788] }],
  "masks": [{ "from": 0, "to": 128, "rect": [2200, 0, 360, 40], "style": "fill" }],
  "texts": [{ "at": 2, "duration": 3, "text": "One prompt", "style": "pill", "position": "bottom" }]
}
```

with:

```markdown
    "cursor": { "style": "system" }
  },
  "scenes": [
    { "type": "clip", "id": "s1", "label": "Prompt", "from": 1.2, "to": 7.5 },
    { "type": "clip", "id": "s2", "label": "Claude at work", "from": 7.5, "to": 120.4, "speed": 12 },
    { "type": "clip", "id": "s3", "label": "Answer", "from": 120.4, "to": 128 },
    { "type": "still", "image": "stills/example-com.png", "duration": 5, "motion": "scroll", "frame": "browser-light" },
    { "type": "card", "title": "Built with Claude Code", "subtitle": "example.com", "duration": 2.5 }
  ],
  "zooms": [{ "id": "z1", "label": "Answer", "at": 121, "duration": 4, "rect": [0, 600, 1400, 788] }],
  "masks": [{ "from": 0, "to": 128, "rect": [2200, 0, 360, 40], "style": "fill" }],
  "texts": [{ "at": 2, "duration": 3, "text": "One prompt", "style": "pill", "position": "bottom" }]
}
```

In the same file, replace:

```markdown
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

`frame.enabled: false` shows the screen alone, filling the output. A take recorded with
`--draw-mouse` has the real pointer in the video; `record` then sets `cursor.enabled` to `false`, so
there are not two cursors.
```

with:

```markdown
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

Two clips where the second starts where the first ends (within 1 ms), as `suggest`'s speed-ups and
any split make, are one continuous piece: no crossfade and no dip in the sound between them, and
zooms and texts run on across the cut.

`frame.enabled: false` shows the screen alone, filling the output. A take recorded with
`--draw-mouse` has the real pointer in the video; `record` then sets `cursor.enabled` to `false`, so
there are not two cursors.
```

In the same file, replace:

```markdown

`zooms`: `at` and `duration` (source seconds), `rect`, `ease` (`smooth`, `linear`) and `enabled`
(`true`). The rect is widened to the screen's aspect and kept inside the screen. The zoom eases in
and out over 0.6 output seconds each, so give it 2 output seconds or more (`2 × speed` source
seconds over a sped-up clip).

`masks` hide private things: `from` and `to` (source seconds), `rect`, `style` (`fill`: the colour
around it, safest for tokens and keys; `blur`) and `enabled` (`true`). Make the rect generous: a
```

with:

```markdown

`zooms`: `at` and `duration` (source seconds), `rect`, `ease` (`smooth`, `linear`) and `enabled`
(`true`). The rect is widened to the screen's aspect and kept inside the screen. The zoom eases in
and out over 0.6 output seconds each where it starts and ends on screen (a cut into its middle
lands zoomed), so give it 2 output seconds or more (`2 × speed` source seconds over a sped-up
clip).

`masks` hide private things: `from` and `to` (source seconds), `rect`, `style` (`fill`: the colour
around it, safest for tokens and keys; `blur`) and `enabled` (`true`). Make the rect generous: a
```

In the same file, replace:

```markdown

`texts`: `at` and `duration` (source seconds), `text`, `style` (`pill`, `lower-third`, `caption`),
`position` (`top`, `center`, `bottom`) and `enabled` (`true`). A `top` text sits over the window's
title bar; `bottom` keeps the title visible.

## Finding source seconds and rects
```

with:

```markdown

`texts`: `at` and `duration` (source seconds), `text`, `style` (`pill`, `lower-third`, `caption`),
`position` (`top`, `center`, `bottom`) and `enabled` (`true`). A `top` text sits over the window's
title bar; `bottom` keeps the title visible. Texts fade in and out over 0.25 output seconds.

Every scene, zoom, mask and text may have an `id` (1 to 64 letters, digits, `-` or `_`, unique in
the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest` sets both
on what it makes (`s1`, `z1`; "Prompt", "Claude at work", "Waiting", "Answer"). Keep them when
you edit an item; give a new item an id no other item uses (`s7`, `m2`) and a short label.

## Finding source seconds and rects
```

In `skill/cuttle/SKILL.md`, replace:

```markdown

`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work)
and zooms on Claude's answer. Its `notes` say what it did, in source seconds. It replaces every clip
and zoom (masks, texts, stills and cards stay), so run it once, before your hand edits. For a take
recorded without `--until-claude`, add `--claude "<demo folder>"` to read the markers from Claude
Code's transcript.
```

with:

```markdown

`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work)
and zooms on Claude's answer. Its `notes` say what it did, in source seconds. It replaces every clip
and zoom (masks, texts, stills and cards stay), so run it once, before your hand edits. Its clips
and zoom have ids and labels ("Claude at work", "Answer"): keep them when you edit, and give
items you add an unused id and a label (project.md). For a take
recorded without `--until-claude`, add `--claude "<demo folder>"` to read the markers from Claude
Code's transcript.
```

In the same file, replace:

```markdown
- `suggest` found no Claude markers: pass `--claude "<demo folder>"`.
- `frame` says no frame starts at that second: the take ends there; take an earlier second.
- A render fails with `render`: try `--encoder software`.
```

with:

```markdown
- `suggest` found no Claude markers: pass `--claude "<demo folder>"`.
- `frame` says no frame starts at that second: the take ends there; take an earlier second.
- A render fails with `render`: try `--encoder software`.
- `conflict`: `cuttle.json` was saved by someone else (the user, or the Cuttle app) while the
  command ran, and nothing was written. Read the file again, then run the command again.
```

In `README.md`, replace:

```markdown
| Package | What it does |
|---|---|
| `@cuttle/project` | `cuttle.json` schema, defaults and readable validation errors |
| `@cuttle/timeline` | What is on screen at any output time: scenes, speed, zooms, masks, texts, cursor, crossfades |
| `@cuttle/engine` | WebGL2 compositor: backgrounds, window frames, zoom, masks, cursors, webcam, texts, stills, cards, crossfades |
| `@cuttle/export` | MP4 export in a hidden Electron window: decode, render, encode H.264, mux; mic cut to the scenes with ffmpeg (AAC) |
| `@cuttle/recorder` | Records a take on Windows: a monitor, region or window (ddagrab), webcam and mic (DirectShow), input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |
| `apps/cli` | The `cuttle` command: init, devices, record, suggest, preview, frame, capture-page, render, recover; `--json` for Claude |
| `skill/` | The Claude skill: `SKILL.md` (the workflow) and `project.md` (the `cuttle.json` reference), installed by `pnpm skill:install` |
```

with:

```markdown
| Package | What it does |
|---|---|
| `@cuttle/project` | `cuttle.json` schema, defaults and readable validation errors |
| `@cuttle/timeline` | What is on screen at any output time: scenes, speed, zooms, masks, texts, cursor, crossfades (none at a continuous cut), overlay ramps in output time |
| `@cuttle/engine` | WebGL2 compositor: backgrounds, window frames, zoom, masks, cursors, webcam, texts, stills, cards, crossfades |
| `@cuttle/export` | MP4 export in a hidden Electron window: decode, render, encode H.264, mux; mic cut to the scenes with ffmpeg (AAC) |
| `@cuttle/recorder` | Records a take on Windows: a monitor, region or window (ddagrab), webcam and mic (DirectShow), input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |
| `@cuttle/core` | Project operations for the CLI and the app: `cuttle.json` as written (hash-checked writes, backups), takes, suggest, recover, frame, ffmpeg |
| `apps/cli` | The `cuttle` command: init, devices, record, suggest, preview, frame, capture-page, render, recover; `--json` for Claude |
| `skill/` | The Claude skill: `SKILL.md` (the workflow) and `project.md` (the `cuttle.json` reference), installed by `pnpm skill:install` |
```

- [ ] **Step 2: Run the skill's tests**

Run: `pnpm exec vitest run skill`
Expected: PASS, 10 tests (the example, with ids and labels, is a valid project).

- [ ] **Step 3: Commit**

```bash
git add skill README.md
git commit -m "docs: ids and labels, continuous cuts and the conflict error in the skill; @cuttle/core in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Final verification

- [ ] **Step 1: All tests**

Run: `pnpm test`
Expected: PASS, 398 tests in 46 files, 5 skipped (the real-capture test and the Electron checks).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 3: Nothing left behind**

Run: `git status --short`
Expected: no output.

## Changes during execution

The code blocks above are the original plan. Its tasks were replayed mechanically on two fresh clones
(the second byte-identical to the prototype) and those commits were pushed. Two reviews followed: one
of the code, and one that tried to break the cuts, ramps and sound with probes (random splits at
24–60 fps, speeds 0.25–64, chains of continuous cuts, real ffmpeg). They found the problems below;
all are fixed in the commits after the plan's. The repo is the source of truth.

- **A held frame at splits (timeline).** `sceneSpans` rounds span ends to the microsecond. When an end
  rounded up past a frame time, that frame still fell inside the first clip with its source time at
  the clip's end, and `sceneFrame` held the frame before it: about a third of the splits made at a
  frame time (24, 30, 60 fps) showed one frozen frame. `frameAt` now hands such a frame to the next
  clip at a continuous cut. A test splits a clip at every frame of its first 3 s at 24, 25, 29, 30
  and 60 fps and compares the frames around each split with the whole clip.
- **Gaps and clicks in the sound at continuous cuts (export).** Each segment had its own trim and
  `atempo`, so a split at a speed other than 1× left up to 19 ms of silence or a phase jump at the
  cut, and splits within the 1 ms tolerance, or at times finer than a sample, skipped or doubled
  samples; all without a fade. `planAudio` now makes one segment of each run of clips joined by
  continuous cuts and heard at one speed: one trim, one `atempo`, fades only at the run's ends (the
  planned "no fade where the speed stays" falls out of it). The ffmpeg check compares a split clip
  with the whole clip at 1×, 0.5×, 2× and 3×.
- **Overlay ends inside a sub-millisecond gap (timeline).** A zoom or text whose start or end lay
  between `a.to` and `b.from` of a continuous cut popped in or out. `rampIn` and `rampOut` now allow
  the cut's 1 ms tolerance. `rampAmount` returns 0 for an occurrence without length (it was NaN).
- **Two writes from one process (core).** Writes shared one temp name (`<file>.<pid>.tmp`) and nothing
  ordered them: two saves of one read could both pass the check, and one save's temp file could be
  renamed with the other's bytes. `writeProjectFile` now:
  - runs one write at a time per file within a process, with a unique temp name;
  - checks the hash again before each retry of the rename (a held file can take a second);
  - makes the backup after the check (`{ backup: true }`), so `suggest` and `recover` no longer
    rotate the backups for a write that is then refused;
  - returns a new `ProjectFile` (`{ file, backup }`) instead of changing its argument.

  `useTake` writes no backup any more; it says whether the project had an edit worth keeping.
  `CoreError` carries the `path` of a conflict, and `projectHash` is exported for the app's watcher.
- **Ids of replaced items (core).** `suggest` took the smallest free numbers, so the ids of the clips
  and zoom it replaced went to new items, and an undo step or a replay that holds `z1` would hit
  the new zoom. `suggest` now counts every id of the file it read as taken; a second run gives
  `s4`… and `z2`.
- **`record` after a take (CLI).** When `cuttle.json` was invalid, deleted or saved at the moment of
  the write, the take was recorded but not linked, and the message said to run the whole command
  again. It now says where the take is and to run `cuttle recover takes/<n>`. A test edits the
  project during a take and checks that the edit is kept.
- **Messages and docs.** Two messages had lost their option names (`-o` for `frame`, `--claude` for
  `suggest`). `project.md` promised no dip in the sound at every continuous cut; a speed change keeps
  a 10 ms fade. SKILL.md said every clip of `suggest` has a label; only those Claude's markers
  explain do.
- **The marker tests.** The two recorder tests that set a marker by a timer now set it from the
  `recording` event (after the screen started): a late screen start dropped or shifted their marker.
- **One crossfade rule.** The timeline and the export's sound each computed the half crossfade;
  `crossfadeHalf` in `@cuttle/timeline` is now the one rule.

After the fixes: `pnpm test` 406 passed (5 skipped), `pnpm typecheck`, `pnpm export:check` and
`pnpm cli:check` pass.

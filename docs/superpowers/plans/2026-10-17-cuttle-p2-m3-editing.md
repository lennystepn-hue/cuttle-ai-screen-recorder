# Cuttle P2-M3: Editing in the App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit in the editor: split, trim, move and speed up scenes, place zooms and masks on the screen itself, type captions on the video, change every field of the selection and the look; each gesture one step to undo, written to `cuttle.json` as it ends, so Claude and the CLI see it at once and their changes show here.

**Architecture:** The open project is a document: cuttle.json's JSON as written and its parsed form. Edits are commands on items by id, applied by pure functions that clamp and then validate with `parseProject`; undo and redo keep whole versions. A gesture shows as a preview while it runs and is saved when it ends through a hash-checked write in the main process, which also watches the file: a version this window did not write replaces the document as a step to undo, a running gesture goes on top of it, and what a newer version cannot take is kept in `cuttle.json.draft`. The stage shows the source frame while a zoom or mask is drawn or selected; the engine reports where it drew each caption so a click can pick one.

**Tech Stack:** Electron 44.7.2, React 19.3.0, Mediabunny 1.61, Playwright 1.64.1 (`_electron`), vitest 5.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-desktop-design.md` (milestone P2-M3; sections "The editor in detail" and "The document, saving and Claude"). P2-M2 (done): `docs/superpowers/plans/2026-10-17-cuttle-p2-m2-recording.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p2-m3`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg and ffprobe must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 6.

## Decisions made while planning

A prototype of the whole milestone, reviewed against the spec, settled these points. On the prototype, `pnpm test` passes 473 tests (30 skipped), `pnpm typecheck` exits with 0, `pnpm app:check` passes its 22 tests, and `pnpm app:build` packages the app and passes its 3.

- **The document** (`apps/desktop/src/shared/document.ts`, pure).
  - Commands on items by id: `split` (a continuous cut at a source second), `trim`, `move-scene`, `speed` (zooms and captions entirely inside the clip keep their output length), `shift`, `set`, `add`, `delete`, `duplicate`, `look`, `output`, `scenes` (Show raw take).
  - `applyCommand` clamps (a clip inside the take and at least a frame long; areas inside the screen, keeping their corner; overlays never before 0), then validates with `parseProject`. A command whose item is gone, or whose result does not parse, throws `DocumentError` and leaves the document as it was.
  - Items without an id get one on open (`ensureIds`), written with the first save.
  - `replayCommands` applies a gesture's commands to a newer version and reports those whose item is gone. `describeChange` says what a version changed ("1 scene changed · 2 masks added"); `firstChanged` names the first item it added or changed, for "Show".
- **Gestures** (`apps/desktop/src/shared/edit.ts`, pure): snapping to the playhead, scene edges, markers and other overlays' edges (frames otherwise; Ctrl skips it); a drag in output seconds becomes source seconds at the clip's speed; the stage↔source pixel mapping; a drawn or adjusted area stays on the screen, and a zoom keeps the screen's shape (what is drawn is what it shows).
- **History and saving** (`renderer/editor/doc.ts`).
  - One gesture is one step to undo; undo and redo keep whole versions.
  - A gesture shows as a preview while it runs (not saved, not in the history) and is saved when it ends; a text field saves when left, on Enter, and every 2 s while typing.
  - Saving is `project:save`: the main process writes only if the file is still the version the edit was made from. Otherwise it answers with the version there now, and the gesture's commands are replayed on it.
  - What a newer version cannot take (an undo, or commands whose item it deleted) is not dropped silently. The person's version is written to `cuttle.json.draft`, and a note offers "Use mine", which puts it back as a new step.
  - The title bar says "Saved", "Saving…" (after 400 ms), or "Not saved · Try again".
- **Outside changes** (`main/project-watch.ts`).
  - The main process watches cuttle.json; versions this window wrote are known by their hash and ignored.
  - Another version replaces the document at once, as a step to undo, with a note: "Changed outside the app: 1 mask added · Show · Undo". During a gesture, the gesture goes on top of it.
  - The cut `suggest` makes after a take arrives the same way ("Cut by suggest"), so the editor no longer reloads for it; a new take (other sources) reloads it.
  - A file that does not parse keeps the last good document: a banner lists the issues and editing waits. The fix is taken even when it is a version this window wrote before.
  - Opening a project backs its file up once.
- **The timeline.**
  - Scenes trim by their edges, move by their body (an insert mark shows where), split with S.
  - Overlays move and stretch at their clip's speed; Alt copies, a guide shows where they snap.
  - The blocks of one overlay (one per clip that shows it) light up together; "n cut out" in a lane's name lists the overlays no clip shows.
  - Gestures follow the pointer on the window, and an overlay block keeps its element while it is dragged, so a block drawn anew mid-drag does not end the drag.
  - "+ Caption" types the caption on the video (the T tool).
- **The stage and the tools** (beside the video).
  - V selects: a click on a caption picks it, a double click edits its text. The engine reports where it drew each text (`Renderer.drawnTexts`).
  - Z and M show the source view: the screen frame at the playhead, decoded on its own; for a selected item the playhead is not on, the frame where it starts. Drag to draw, drag the box to move, the handles to resize; the area outside a selected zoom is dimmed. Playing shows the video again.
  - T types a caption on the video at the playhead, shown as it will look while it is typed; Enter adds it and selects it.
  - Z, M and T are off on pages, cards and inside crossfades, and say why.
- **The inspector** edits every field of the selection and the Look tab: the output size, background swatches with a colour or an image (copied into the project's `images/`), the frame, the cursor, the webcam, sound and crossfade. A row whose button is not its field (Replace…) is not a `<label>`.
- **The command menu** (Ctrl+K or ?) lists every command with its keys, says why one cannot run, and runs one by name.
- **Keys:** S, Delete/Backspace, Ctrl+D, R, V/Z/M/T, Shift+Z, Ctrl+Z, Ctrl+Shift+Z/Ctrl+Y, Ctrl+K, ?, Esc (out of the source view, then a tool, then the selection).
- **The editor lock and the CLI.** `@cuttle/core`'s `editorLockOf` reads the app's `.cuttle/editor.lock`; a lock an app on this computer left when it ended does not count. `cuttle record` refuses an open project with `project-open`, unless `--force`; the skill says so.
- **Kept as it was:** the title bar's 16:9 / 1:1 / 9:16 stays a preview, so a look at another format changes nothing; the output size is set in the Look tab. The spec also has these buttons set the output.
- **Left for P2-M4 (polish):** the Look tab's cursor and frame styles as swatches drawn by the engine (menus for now); a minimap for long takes.

## File structure

```
cuttle/
├── README.md                              editing in the app
├── skill/cuttle/SKILL.md                  record refuses a project open in the app
├── packages/core/src/                     editor-lock (new); index
├── packages/engine/src/                   renderer (drawnTexts); index
├── apps/cli/                              record (project-open, --force); errors; main; test
└── apps/desktop/
    ├── src/shared/                        document, edit (new); timeline-model (cut-out items); ipc, channels
    ├── src/main/                          project-watch (new); windows, recording, project, check, media-service
    ├── src/renderer/                      icons; editor: doc, actions, commands, SourceView, CommandMenu (new);
    │                                      App, Timeline, Inspector, ExportSheet, session, media, player, editor.css
    └── test/                              document (new); timeline-model; app.check (editing)
```

---

### Task 1: The document and the gestures

**Files:**
- Create: `apps/desktop/src/shared/document.ts`, `apps/desktop/src/shared/edit.ts`, `apps/desktop/test/document.test.ts`
- Modify: `apps/desktop/src/shared/timeline-model.ts`, `apps/desktop/test/timeline-model.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p2-m3`; work there:

```bash
git switch p2-m3
```

- [ ] **Step 2: Write the failing tests**

`apps/desktop/test/document.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import { applyCommand, clampRect, describeChange, DocumentError, ensureIds, firstChanged, replayCommands, type Command, type Raw } from '../src/shared/document';
import { adjustRect, dragRange, drawnRect, fitInside, overlayRange, rangeFields, snapTime, toSource, toStage } from '../src/shared/edit';

const base: Raw = {
  version: 1,
  sources: { screen: 'takes/1/screen.mp4' },
  scenes: [
    { type: 'clip', id: 's1', label: 'Prompt', from: 0, to: 3 },
    { type: 'clip', id: 's2', from: 3, to: 8, speed: 4 },
    { type: 'card', id: 's3', title: 'The end', duration: 1.5 },
  ],
  zooms: [{ id: 'z1', at: 4, duration: 2, rect: [0, 0, 640, 360] }],
  texts: [{ id: 't1', at: 1, duration: 1, text: 'Hi' }],
};
const limits = { sourceEnd: 12, screen: { width: 1280, height: 800 }, fps: 30 };
const project = (raw: Raw) => {
  const parsed = parseProject(raw);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
};

describe('the document', () => {
  it('gives items without an id one, and leaves a file whose items have ids as it is', () => {
    expect(ensureIds(base)).toBe(base);
    const named = ensureIds({ ...base, masks: [{ from: 0, to: 1, rect: [0, 0, 10, 10] }], zooms: [{ at: 0, duration: 1, rect: [0, 0, 10, 10] }] });
    expect([(named.masks as { id: string }[])[0]!.id, (named.zooms as { id: string }[])[0]!.id]).toEqual(['m1', 'z1']);
  });

  it('splits a clip into a continuous cut and leaves the input as it was', () => {
    const next = applyCommand(base, { type: 'split', id: 's2', at: 5 }, limits);
    expect((next.scenes as unknown[]).slice(1, 3)).toEqual([
      { type: 'clip', id: 's2', from: 3, to: 5, speed: 4 },
      { type: 'clip', id: 's4', from: 5, to: 8, speed: 4 },
    ]);
    expect((base.scenes as unknown[]).length).toBe(3);
    expect(() => applyCommand(base, { type: 'split', id: 's2', at: 9 }, limits)).toThrow(/outside the clip/);
  });

  it('trims a clip inside the take and at least a frame long; a card by its duration', () => {
    const trimmed = applyCommand(base, { type: 'trim', id: 's1', from: -2, to: 30 }, limits);
    expect((trimmed.scenes as { from?: number; to?: number }[])[0]).toMatchObject({ from: 0, to: 12 });
    const thin = applyCommand(base, { type: 'trim', id: 's1', from: 2.99, to: 2.99 }, limits);
    expect((thin.scenes as { from: number; to: number }[])[0]!.to - (thin.scenes as { from: number }[])[0]!.from).toBeCloseTo(1 / 30, 5);
    const card = applyCommand(base, { type: 'trim', id: 's3', duration: 2.5 }, limits);
    expect((card.scenes as { duration?: number }[])[2]!.duration).toBe(2.5);
  });

  it('keeps the output length of zooms and captions inside a clip whose speed changes', () => {
    const next = applyCommand(base, { type: 'speed', id: 's2', speed: 8 }, limits);
    expect((next.scenes as { speed?: number }[])[1]!.speed).toBe(8);
    // the zoom lies inside 3–8 s: 2 source s at 4× is 0.5 s; at 8× it takes 4 source s for 0.5 s (clamped to the clip's end)
    expect((next.zooms as { duration: number }[])[0]!.duration).toBe(4);
    // the caption is in the first clip: untouched
    expect((next.texts as { duration: number }[])[0]!.duration).toBe(1);
  });

  it('moves, adds, duplicates, sets and deletes items by id', () => {
    let raw = applyCommand(base, { type: 'move-scene', id: 's3', index: 0 }, limits);
    expect((raw.scenes as { id: string }[]).map((scene) => scene.id)).toEqual(['s3', 's1', 's2']);
    raw = applyCommand(raw, { type: 'add', list: 'masks', item: { from: 1, to: 2, rect: [10, 10, 5000, 50] } }, limits);
    expect((raw.masks as unknown[])[0]).toEqual({ from: 1, to: 2, rect: [10, 10, 1270, 50], id: 'm1' });
    raw = applyCommand(raw, { type: 'duplicate', list: 'texts', id: 't1', shift: 2 }, limits);
    expect((raw.texts as { id: string; at: number }[]).map((text) => [text.id, text.at])).toEqual([
      ['t1', 1],
      ['t2', 3],
    ]);
    raw = applyCommand(raw, { type: 'set', list: 'texts', id: 't2', fields: { text: 'Bye', style: 'caption' } }, limits);
    expect((raw.texts as { text: string }[])[1]).toMatchObject({ text: 'Bye', style: 'caption' });
    raw = applyCommand(raw, { type: 'delete', list: 'zooms', id: 'z1' }, limits);
    expect(raw.zooms).toEqual([]);
    expect(() => applyCommand(raw, { type: 'delete', list: 'zooms', id: 'z1' }, limits)).toThrow(DocumentError);
  });

  it('shifts overlays in source seconds, never before 0', () => {
    const next = applyCommand(base, { type: 'shift', list: 'zooms', id: 'z1', by: -10 }, limits);
    expect((next.zooms as { at: number }[])[0]!.at).toBe(0);
  });

  it('sets the look and the output, and refuses what parseProject refuses', () => {
    const next = applyCommand(base, { type: 'look', path: ['background', 'preset'], value: 'aurora' }, limits);
    expect(next.look).toEqual({ background: { preset: 'aurora' } });
    expect(applyCommand(base, { type: 'output', width: 1080, height: 1920 }, limits).output).toEqual({ width: 1080, height: 1920 });
    expect(() => applyCommand(base, { type: 'look', path: ['background', 'preset'], value: 'solid' }, limits)).toThrow(/color/);
  });

  it('replays commands on a newer version and drops the ones whose item is gone', () => {
    const newer = applyCommand(base, { type: 'delete', list: 'texts', id: 't1' }, limits);
    const { raw, dropped } = replayCommands(newer, [
      { type: 'set', list: 'texts', id: 't1', fields: { text: 'Lost' } },
      { type: 'set', list: 'scenes', id: 's1', fields: { label: 'Kept' } },
    ], limits);
    expect(dropped).toEqual(['text t1 is not in the project any more']);
    expect((raw.scenes as { label?: string }[])[0]!.label).toBe('Kept');
  });

  it('says what changed between two versions', () => {
    const after = applyCommand(applyCommand(base, { type: 'add', list: 'masks', item: { from: 0, to: 1, rect: [0, 0, 10, 10] } }), { type: 'add', list: 'masks', item: { from: 1, to: 2, rect: [0, 0, 10, 10] } });
    const changed = applyCommand(after, { type: 'set', list: 'scenes', id: 's1', fields: { label: 'Ask' } });
    expect(describeChange(project(base), project(changed))).toBe('1 scene changed · 2 masks added');
    expect(describeChange(project(base), project(base))).toBe('no visible change');
    // the first change to show: the scene comes before the masks
    expect(firstChanged(project(base), project(changed))).toEqual({ list: 'scenes', id: 's1' });
    expect(firstChanged(project(base), project(after))).toEqual({ list: 'masks', id: project(after).masks[0]!.id });
    expect(firstChanged(project(base), project(base))).toBeUndefined();
  });

  it('keeps a rectangle inside the screen', () => {
    expect(clampRect([-10, 790, 4, 50], { width: 1280, height: 800 })).toEqual([0, 790, 8, 10]);
  });
});

describe('the gestures', () => {
  it('snaps to the nearest target in reach, else to frames', () => {
    expect(snapTime(4.03, [4, 4.1], 0.05, 30)).toEqual({ t: 4, target: 4 });
    expect(snapTime(4.02, [5], 0.05, 30).t).toBeCloseTo(121 / 30, 9);
  });

  it("turns a drag in output seconds into source seconds at the clip's speed", () => {
    expect(dragRange([4, 6], 'move', 0.5, 4, 0.1)).toEqual([6, 8]);
    expect(dragRange([4, 6], 'move', -3, 4, 0.1)).toEqual([0, 2]);
    expect(dragRange([4, 6], 'start', 1, 4, 0.1)).toEqual([5.9, 6]);
    expect(dragRange([4, 6], 'end', -0.25, 2, 0.1)).toEqual([4, 5.5]);
    expect(overlayRange({ at: 2, duration: 3 })).toEqual([2, 5]);
    expect(overlayRange({ from: 1, to: 4 })).toEqual([1, 4]);
    expect(rangeFields('masks', 1, 2)).toEqual({ from: 1, to: 2 });
    expect(rangeFields('zooms', 1, 3)).toEqual({ at: 1, duration: 2 });
  });

  it('maps the stage to source pixels and back', () => {
    const fit = fitInside({ width: 1000, height: 500 }, { width: 1280, height: 800 });
    expect(fit.scale).toBeCloseTo(500 / 800, 9);
    expect(toSource({ x: fit.x, y: 0 }, fit)).toEqual({ x: 0, y: 0 });
    const box = toStage([640, 400, 320, 200], fit);
    expect(box.width).toBeCloseTo(200, 9);
    expect(toSource({ x: box.x, y: box.y }, fit).x).toBeCloseTo(640, 9);
  });

  it("draws a rectangle inside the screen, a zoom's with the screen's shape", () => {
    const screen = { width: 1280, height: 800 };
    expect(drawnRect({ x: 100, y: 100 }, { x: 50, y: 900 }, screen)).toEqual([50, 100, 50, 700]);
    const zoom = drawnRect({ x: 1000, y: 100 }, { x: 1600, y: 200 }, screen, 1.6);
    expect(zoom[2] / zoom[3]).toBeCloseTo(1.6, 9);
    expect(zoom[0] + zoom[2]).toBeLessThanOrEqual(1280);
  });

  it("moves and resizes a rectangle by a handle, inside the screen, keeping a zoom's shape", () => {
    const screen = { width: 1280, height: 800 };
    expect(adjustRect([100, 100, 200, 100], 'move', 2000, -50, screen)).toEqual([1080, 50, 200, 100]);
    expect(adjustRect([100, 100, 200, 100], 'se', 100, 0, screen)).toEqual([100, 100, 300, 100]);
    expect(adjustRect([100, 100, 200, 100], 'w', 500, 0, screen)).toEqual([292, 100, 8, 100]);
    const zoom = adjustRect([100, 100, 320, 200], 'se', 160, 0, screen, 1.6);
    expect(zoom).toEqual([100, 100, 480, 300]);
    const big = adjustRect([800, 400, 320, 200], 'se', 2000, 0, screen, 1.6);
    expect(big[0] + big[2]).toBeLessThanOrEqual(1280 + 1e-9);
    expect(big[2] / big[3]).toBeCloseTo(1.6, 9);
  });
});

describe('random edit sequences', () => {
  /** A small seeded generator: the same sequences on every run. */
  const random = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };

  /** A command on the document as it is: mostly on items it has, some on ones it lacks, some out of range. */
  function command(raw: Raw, next: () => number): Command {
    const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
    const number = (low: number, high: number) => low + next() * (high - low);
    const lists = ['scenes', 'zooms', 'masks', 'texts'] as const;
    const list = pick(lists);
    const items = (raw[list] as { id: string; type?: string }[] | undefined) ?? [];
    const id = items.length > 0 && next() > 0.1 ? pick(items).id : 'gone';
    const clip = (raw.scenes as { id: string; type: string }[]).find((scene) => scene.type === 'clip' && next() > 0.3)?.id ?? 'gone';
    const overlay = list === 'scenes' ? pick(['zooms', 'masks', 'texts'] as const) : list;
    const overlayId = ((raw[overlay] as { id: string }[] | undefined) ?? [])[0]?.id ?? 'gone';
    const rect = [number(-200, 1400), number(-200, 900), number(-50, 1500), number(-50, 900)];
    switch (Math.floor(next() * 11)) {
      case 0:
        return { type: 'split', id: clip, at: number(-1, 14) };
      case 1:
        return { type: 'trim', id: clip, ...(next() > 0.5 ? { from: number(-2, 14) } : { to: number(-2, 14) }) };
      case 2:
        return { type: 'move-scene', id: pick(raw.scenes as { id: string }[]).id, index: Math.floor(number(-1, 6)) };
      case 3:
        return { type: 'speed', id: clip, speed: pick([0, 0.25, 1, 2, 12, 64, 100]) };
      case 4:
        return { type: 'shift', list: overlay, id: overlayId, by: number(-20, 20) };
      case 5:
        return list === 'scenes'
          ? { type: 'set', list, id, fields: { label: next() > 0.5 ? 'Renamed' : undefined } }
          : { type: 'set', list, id, fields: next() > 0.5 ? { rect } : { enabled: next() > 0.5 } };
      case 6:
        return overlay === 'zooms'
          ? { type: 'add', list: 'zooms', item: { at: number(-1, 13), duration: number(-1, 6), rect } }
          : overlay === 'masks'
            ? { type: 'add', list: 'masks', item: { from: number(-1, 13), to: number(-1, 14), rect } }
            : { type: 'add', list: 'texts', item: { at: number(-1, 13), duration: number(0, 4), text: 'Added' } };
      case 7:
        return { type: 'delete', list, id };
      case 8:
        return { type: 'duplicate', list, id, shift: number(-3, 3) };
      case 9:
        return pick<Command>([
          { type: 'look', path: ['frame', 'radius'], value: Math.floor(number(-10, 60)) },
          { type: 'look', path: ['background'], value: { preset: 'solid', color: '#123456' } },
          { type: 'look', path: ['transition', 'enabled'], value: next() > 0.5 },
        ]);
      default:
        return pick<Command>([
          { type: 'output', width: 1080, height: 1920 },
          { type: 'output', width: 1920, height: 1080 },
          { type: 'add', list: 'scenes', index: Math.floor(number(0, 4)), item: { type: 'card', title: 'Card', duration: number(-1, 5) } },
        ]);
    }
  }

  it('always leave a project that parses, refuse with a DocumentError, and never change the version they start from', () => {
    let applied = 0;
    for (let run = 1; run <= 150; run++) {
      const next = random(run);
      let raw = ensureIds(base);
      const versions: string[] = [JSON.stringify(raw)];
      for (let step = 0; step < 30; step++) {
        const edit = command(raw, next);
        const before = JSON.stringify(raw);
        let after: Raw;
        try {
          after = applyCommand(raw, edit, limits);
        } catch (error) {
          expect(error, JSON.stringify(edit)).toBeInstanceOf(DocumentError);
          expect(JSON.stringify(raw)).toBe(before);
          continue;
        }
        expect(JSON.stringify(raw), JSON.stringify(edit)).toBe(before);
        const parsed = parseProject(after);
        expect(parsed.ok, `${JSON.stringify(edit)}\n${JSON.stringify(parsed.ok ? '' : parsed.issues)}`).toBe(true);
        raw = after;
        versions.push(JSON.stringify(raw));
        applied++;
      }
      // Undo keeps whole versions: going back through them gives each one byte for byte, and each parses.
      for (const version of versions.reverse()) expect(parseProject(JSON.parse(version)).ok).toBe(true);
    }
    // the sequences do edit (not only refusals)
    expect(applied).toBeGreaterThan(1500);
  });
});
```

In `apps/desktop/test/timeline-model.test.ts`, replace:

```ts
      [4.25, 4.75, true],
    ]);
    expect(model.lanes.mask.cutOut).toBe(1);
    const [zoom] = model.lanes.zoom.blocks;
    expect([zoom?.start, zoom?.end, zoom?.title]).toEqual([expect.closeTo(4.55, 9), expect.closeTo(7.05, 9), 'Answer']);
    expect(model.lanes.caption.blocks.map((block) => block.title)).toEqual(['One prompt']);
```

with:

```ts
      [4.25, 4.75, true],
    ]);
    expect(model.lanes.mask.cutOut).toBe(1);
    expect(model.lanes.mask.cutOutItems).toHaveLength(1);
    const [zoom] = model.lanes.zoom.blocks;
    expect([zoom?.start, zoom?.end, zoom?.title]).toEqual([expect.closeTo(4.55, 9), expect.closeTo(7.05, 9), 'Answer']);
    expect(model.lanes.caption.blocks.map((block) => block.title)).toEqual(['One prompt']);
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm exec vitest run --project node apps/desktop/test/document.test.ts apps/desktop/test/timeline-model.test.ts`
Expected: FAIL: `document.test.ts` cannot load `../src/shared/document` (the file does not exist yet), and the timeline model has no `cutOutItems`.

- [ ] **Step 4: The document, the gestures, the cut-out items**

`apps/desktop/src/shared/document.ts`:

```ts
// The editor's document: cuttle.json as written (`raw`, so the file stays as short as it was) and
// the edits on it as commands on items by id, applied by pure functions. A result is clamped to
// valid values and checked with `parseProject`; a command whose item is gone throws, so a replay
// on a newer version of the file can drop it with a note.
import { newId, parseProject, usedIds, type CuttleProject, type IdList } from '@cuttle/project';

export type Raw = Record<string, unknown>;
export type ListName = IdList;
export type OverlayList = 'zooms' | 'masks' | 'texts';
type Item = Record<string, unknown>;

/** What a command may need to clamp to: the take's length and the screen's size. */
export interface EditLimits {
  /** Source seconds the screen track lasts (a clip ends there at the latest). */
  sourceEnd?: number;
  /** The screen track's size in pixels (zoom and mask areas stay inside it). */
  screen?: { width: number; height: number };
  /** The output's frame rate: no clip, still or overlay is shorter than a frame. */
  fps?: number;
}

export type Command =
  /** Splits a clip at a source second inside it: a continuous cut. */
  | { type: 'split'; id: string; at: number; newId?: string }
  /** A clip's source range, or a still's or card's length. */
  | { type: 'trim'; id: string; from?: number; to?: number; duration?: number }
  | { type: 'move-scene'; id: string; index: number }
  /** A clip's speed; zooms and captions entirely inside it keep their output length. */
  | { type: 'speed'; id: string; speed: number }
  /** Moves an overlay by source seconds. */
  | { type: 'shift'; list: OverlayList; id: string; by: number }
  /** Sets fields of an item (`undefined` removes a field). */
  | { type: 'set'; list: ListName; id: string; fields: Item }
  | { type: 'add'; list: ListName; item: Item; index?: number }
  | { type: 'delete'; list: ListName; id: string }
  | { type: 'duplicate'; list: ListName; id: string; newId?: string; shift?: number }
  /** Sets `look.<path…>` (`undefined` removes it). */
  | { type: 'look'; path: string[]; value: unknown }
  | { type: 'output'; width: number; height: number }
  /** Replaces every scene (Show raw take). */
  | { type: 'scenes'; scenes: Item[] };

/** A command that cannot run: its item is gone (`gone`) or the result is not a valid project (`invalid`). */
export class DocumentError extends Error {
  constructor(
    readonly code: 'gone' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'DocumentError';
  }
}

const MIN_RECT = 8;

const items = (raw: Raw, list: ListName): Item[] => (Array.isArray(raw[list]) ? (raw[list] as Item[]) : []);

function find(raw: Raw, list: ListName, id: string): { item: Item; index: number } {
  const index = items(raw, list).findIndex((item) => item.id === id);
  if (index < 0) throw new DocumentError('gone', `${list.slice(0, -1)} ${id} is not in the project any more`);
  return { item: items(raw, list)[index]!, index };
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;
const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Gives every scene and overlay without an id one (`s3`, `z1` …); returns the same object when all have one. */
export function ensureIds(raw: Raw): Raw {
  const lists = (['scenes', 'zooms', 'masks', 'texts'] as const).filter((list) => items(raw, list).some((item) => typeof item.id !== 'string'));
  if (lists.length === 0) return raw;
  const next = structuredClone(raw);
  const taken = usedIds(next);
  for (const list of lists) for (const item of items(next, list)) if (typeof item.id !== 'string') item.id = newId(list, taken);
  return next;
}

function setFields(item: Item, fields: Item): void {
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'id') continue;
    if (value === undefined) delete item[key];
    else item[key] = value;
  }
}

/** Keeps a rectangle `[x, y, w, h]` inside the screen (its corner moved in, its size cut), at least 8 px each way. */
export function clampRect(rect: readonly number[], screen: { width: number; height: number } | undefined): number[] {
  let [x = 0, y = 0, w = MIN_RECT, h = MIN_RECT] = rect;
  w = Math.max(MIN_RECT, w);
  h = Math.max(MIN_RECT, h);
  if (screen) {
    // the corner stays where it was put (inside), the size gives way
    x = clampNumber(x, 0, screen.width - MIN_RECT);
    y = clampNumber(y, 0, screen.height - MIN_RECT);
    w = Math.min(w, screen.width - x);
    h = Math.min(h, screen.height - y);
  }
  return [round(x), round(y), round(w), round(h)];
}

/** Clamps the item's times and area after an edit. */
function clampItem(list: ListName, item: Item, limits: EditLimits): void {
  const frame = 1 / (limits.fps ?? 30);
  const end = limits.sourceEnd ?? Infinity;
  if (list === 'scenes') {
    if (item.type === 'clip') {
      const speed = clampNumber(Number(item.speed ?? 1), 1 / 64, 64);
      if (item.speed !== undefined) item.speed = round(speed);
      const from = clampNumber(Number(item.from), 0, Math.max(0, end - frame * speed));
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
    item.at = round(Math.max(0, Number(item.at)));
    item.duration = round(Math.max(frame, Number(item.duration)));
  }
  if (Array.isArray(item.rect)) item.rect = clampRect(item.rect as number[], limits.screen);
}

/** Applies one command to `raw` (left as it was) and returns the new version, checked. */
export function applyCommand(raw: Raw, command: Command, limits: EditLimits = {}): Raw {
  const next = structuredClone(raw);
  const list = (name: ListName): Item[] => {
    if (!Array.isArray(next[name])) next[name] = [];
    return next[name] as Item[];
  };
  const touched: [ListName, Item][] = [];
  switch (command.type) {
    case 'split': {
      const { item, index } = find(next, 'scenes', command.id);
      if (item.type !== 'clip') throw new DocumentError('invalid', 'only a clip can be split');
      const from = Number(item.from);
      const to = Number(item.to);
      const at = round(command.at);
      if (!(at > from && at < to)) throw new DocumentError('invalid', 'the split point lies outside the clip');
      const second: Item = { ...structuredClone(item), id: command.newId && !usedIds(next).has(command.newId) ? command.newId : newId('scenes', usedIds(next)), from: at };
      item.to = at;
      list('scenes').splice(index + 1, 0, second);
      touched.push(['scenes', item], ['scenes', second]);
      break;
    }
    case 'trim': {
      const { item } = find(next, 'scenes', command.id);
      if (item.type === 'clip') {
        if (command.from !== undefined) item.from = command.from;
        if (command.to !== undefined) item.to = command.to;
      } else if (command.duration !== undefined) item.duration = command.duration;
      touched.push(['scenes', item]);
      break;
    }
    case 'move-scene': {
      const { item, index } = find(next, 'scenes', command.id);
      const scenes = list('scenes');
      scenes.splice(index, 1);
      scenes.splice(clampNumber(Math.round(command.index), 0, scenes.length), 0, item);
      break;
    }
    case 'speed': {
      const { item } = find(next, 'scenes', command.id);
      if (item.type !== 'clip') throw new DocumentError('invalid', 'only a clip has a speed');
      const before = Number(item.speed ?? 1);
      const speed = clampNumber(command.speed, 1 / 64, 64);
      const from = Number(item.from);
      const to = Number(item.to);
      if (speed === 1 && item.speed === undefined) break;
      item.speed = round(speed);
      touched.push(['scenes', item]);
      // Zooms and captions inside the clip keep their output length: a 3 s caption stays 3 s at 12×.
      for (const name of ['zooms', 'texts'] as const) {
        for (const overlay of items(next, name)) {
          const at = Number(overlay.at);
          const duration = Number(overlay.duration);
          if (at < from || at + duration > to) continue;
          overlay.duration = round(Math.min((duration / before) * speed, to - at));
          touched.push([name, overlay]);
        }
      }
      break;
    }
    case 'shift': {
      const { item } = find(next, command.list, command.id);
      if (command.list === 'masks') {
        const by = Math.max(command.by, -Number(item.from));
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
    }
    case 'add': {
      const taken = usedIds(next);
      const wanted = typeof command.item.id === 'string' && !taken.has(command.item.id) ? command.item.id : newId(command.list, taken);
      const item = { ...structuredClone(command.item), id: wanted };
      const target = list(command.list);
      target.splice(command.index === undefined ? target.length : clampNumber(command.index, 0, target.length), 0, item);
      touched.push([command.list, item]);
      break;
    }
    case 'delete': {
      const { index } = find(next, command.list, command.id);
      list(command.list).splice(index, 1);
      break;
    }
    case 'duplicate': {
      const { item, index } = find(next, command.list, command.id);
      const taken = usedIds(next);
      const copy: Item = { ...structuredClone(item), id: command.newId && !taken.has(command.newId) ? command.newId : newId(command.list, taken) };
      if (command.shift) {
        if (command.list === 'masks') {
          copy.from = Number(copy.from) + command.shift;
          copy.to = Number(copy.to) + command.shift;
        } else if (command.list !== 'scenes') copy.at = Number(copy.at) + command.shift;
      }
      list(command.list).splice(index + 1, 0, copy);
      touched.push([command.list, copy]);
      break;
    }
    case 'look': {
      if (command.path.length === 0) throw new DocumentError('invalid', 'a look path is empty');
      const look = (next.look && typeof next.look === 'object' ? next.look : (next.look = {})) as Item;
      let parent = look;
      for (const key of command.path.slice(0, -1)) {
        if (!parent[key] || typeof parent[key] !== 'object') parent[key] = {};
        parent = parent[key] as Item;
      }
      const last = command.path.at(-1)!;
      if (command.value === undefined) delete parent[last];
      else parent[last] = structuredClone(command.value);
      break;
    }
    case 'output': {
      const output = (next.output && typeof next.output === 'object' ? next.output : (next.output = {})) as Item;
      output.width = command.width;
      output.height = command.height;
      break;
    }
    case 'scenes': {
      next.scenes = structuredClone(command.scenes);
      const ids = ensureIds(next);
      next.scenes = ids.scenes;
      break;
    }
  }
  for (const [name, item] of touched) clampItem(name, item, limits);
  const parsed = parseProject(next);
  if (!parsed.ok) throw new DocumentError('invalid', parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  return next;
}

/** Applies commands in order; the ones whose item is gone are left out and named. */
export function replayCommands(raw: Raw, commands: readonly Command[], limits: EditLimits = {}): { raw: Raw; dropped: string[] } {
  let current = raw;
  const dropped: string[] = [];
  for (const command of commands) {
    try {
      current = applyCommand(current, command, limits);
    } catch (error) {
      if (!(error instanceof DocumentError)) throw error;
      dropped.push(error.message);
    }
  }
  return { raw: current, dropped };
}

const NOUNS: Record<ListName, [string, string]> = { scenes: ['scene', 'scenes'], zooms: ['zoom', 'zooms'], masks: ['mask', 'masks'], texts: ['caption', 'captions'] };
const noun = (list: ListName, count: number) => `${count} ${NOUNS[list][count === 1 ? 0 : 1]}`;

/**
 * What changed between two versions of a project, for people: "2 masks added · 1 scene changed",
 * "the look changed". Items are matched by id (by position when they have none).
 */
export function describeChange(before: CuttleProject, after: CuttleProject): string {
  return changeParts(before, after).join(' · ') || 'no visible change';
}

/** The first item added or changed between two versions (scenes, then zooms, masks, captions), to show it. */
export function firstChanged(before: CuttleProject, after: CuttleProject): { list: ListName; id: string } | undefined {
  for (const list of ['scenes', 'zooms', 'masks', 'texts'] as const) {
    const old = new Map(before[list].map((item) => [item.id, JSON.stringify(item)]));
    const found = after[list].find((item) => item.id !== undefined && old.get(item.id) !== JSON.stringify(item));
    if (found?.id) return { list, id: found.id };
  }
  return undefined;
}

function changeParts(before: CuttleProject, after: CuttleProject): string[] {
  const parts: string[] = [];
  for (const list of ['scenes', 'zooms', 'masks', 'texts'] as const) {
    const key = (item: { id?: string }, index: number) => item.id ?? `#${index}`;
    const old = new Map(before[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
    const now = new Map(after[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
    const added = [...now.keys()].filter((id) => !old.has(id)).length;
    const removed = [...old.keys()].filter((id) => !now.has(id)).length;
    const changed = [...now].filter(([id, text]) => old.has(id) && old.get(id) !== text).length;
    if (added) parts.push(`${noun(list, added)} added`);
    if (removed) parts.push(`${noun(list, removed)} removed`);
    if (changed) parts.push(`${noun(list, changed)} changed`);
  }
  if (JSON.stringify(before.look) !== JSON.stringify(after.look)) parts.push('the look changed');
  if (JSON.stringify(before.output) !== JSON.stringify(after.output)) parts.push('the output size changed');
  if (JSON.stringify(before.sources) !== JSON.stringify(after.sources)) parts.push('another take');
  return parts;
}
```

`apps/desktop/src/shared/edit.ts`:

```ts
// The editor's gestures as pure functions: snapping in output time, what a drag on the timeline
// does to an item's source times, and the mapping between the stage and the screen's pixels in the
// source view. Pure, so they are tested without a window.
import type { Rect } from '@cuttle/project';

/** A time snapped to the nearest target within `tolerance` (output seconds), else to the frame grid. */
export function snapTime(t: number, targets: readonly number[], tolerance: number, fps: number): { t: number; target?: number } {
  let best: number | undefined;
  for (const target of targets) if (Math.abs(target - t) <= tolerance && (best === undefined || Math.abs(target - t) < Math.abs(best - t))) best = target;
  if (best !== undefined) return { t: best, target: best };
  return { t: Math.round(t * fps) / fps };
}

/** An overlay's source range: a mask's from and to, a zoom's or caption's at and at + duration. */
export function overlayRange(item: { from?: number; to?: number; at?: number; duration?: number }): [number, number] {
  return item.from !== undefined && item.to !== undefined ? [item.from, item.to] : [item.at ?? 0, (item.at ?? 0) + (item.duration ?? 0)];
}

/** The fields that give an overlay of `list` the source range [from, to). */
export function rangeFields(list: 'zooms' | 'masks' | 'texts', from: number, to: number): Record<string, number> {
  return list === 'masks' ? { from, to } : { at: from, duration: to - from };
}

/**
 * The source range after dragging an overlay's `edge` (or the whole block, `move`) by `deltaOut`
 * output seconds inside a clip played at `speed`; at least `minimum` source seconds long, never
 * before 0.
 */
export function dragRange(range: readonly [number, number], edge: 'start' | 'end' | 'move', deltaOut: number, speed: number, minimum: number): [number, number] {
  const delta = deltaOut * speed;
  let [from, to] = range;
  if (edge === 'move') {
    const by = Math.max(delta, -from);
    return [from + by, to + by];
  }
  if (edge === 'start') from = Math.min(Math.max(0, from + delta), to - minimum);
  else to = Math.max(to + delta, from + minimum);
  return [from, to];
}

/** Where a picture of `source` size sits inside `area` (contained, centred): its offset and scale. */
export interface Fit {
  x: number;
  y: number;
  scale: number;
}

export function fitInside(area: { width: number; height: number }, source: { width: number; height: number }): Fit {
  const scale = Math.min(area.width / source.width, area.height / source.height);
  return { x: (area.width - source.width * scale) / 2, y: (area.height - source.height * scale) / 2, scale };
}

/** A point on the stage in source pixels (not clamped). */
export const toSource = (point: { x: number; y: number }, fit: Fit) => ({ x: (point.x - fit.x) / fit.scale, y: (point.y - fit.y) / fit.scale });

/** A source rectangle `[x, y, w, h]` on the stage. */
export const toStage = (rect: Rect | readonly number[], fit: Fit) => ({ x: fit.x + rect[0]! * fit.scale, y: fit.y + rect[1]! * fit.scale, width: rect[2]! * fit.scale, height: rect[3]! * fit.scale });

/**
 * The rectangle a drag from `a` to `b` (source pixels) draws, inside the screen. With `aspect`
 * (width / height) it keeps that shape, as a zoom does (what is drawn is what the zoom shows).
 */
export function drawnRect(a: { x: number; y: number }, b: { x: number; y: number }, screen: { width: number; height: number }, aspect?: number): Rect {
  const clampX = (x: number) => Math.min(Math.max(x, 0), screen.width);
  const clampY = (y: number) => Math.min(Math.max(y, 0), screen.height);
  const x0 = clampX(a.x);
  const y0 = clampY(a.y);
  let w = clampX(b.x) - x0;
  let h = clampY(b.y) - y0;
  if (aspect) {
    // the larger side leads; the other follows, and both shrink to stay inside
    if (Math.abs(w) / aspect > Math.abs(h)) h = Math.sign(h || 1) * (Math.abs(w) / aspect);
    else w = Math.sign(w || 1) * Math.abs(h) * aspect;
    const roomX = w < 0 ? x0 : screen.width - x0;
    const roomY = h < 0 ? y0 : screen.height - y0;
    const shrink = Math.min(1, roomX / Math.max(1e-9, Math.abs(w)), roomY / Math.max(1e-9, Math.abs(h)));
    w *= shrink;
    h *= shrink;
  }
  return [Math.min(x0, x0 + w), Math.min(y0, y0 + h), Math.abs(w), Math.abs(h)];
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

/**
 * A rectangle moved (`move`) or resized by one of its handles by (dx, dy) source pixels, inside the
 * screen and at least `minimum` pixels each way; with `aspect` a resize keeps the shape (the
 * opposite corner or edge stays where it is).
 */
export function adjustRect(rect: Rect | readonly number[], handle: Handle, dx: number, dy: number, screen: { width: number; height: number }, aspect?: number, minimum = 8): Rect {
  const [x, y, w, h] = rect as [number, number, number, number];
  if (handle === 'move') {
    return [Math.min(Math.max(x + dx, 0), screen.width - w), Math.min(Math.max(y + dy, 0), screen.height - h), w, h];
  }
  if (aspect) {
    // The side or corner opposite the handle stays; the size follows the axis that moved more.
    const sx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
    const sy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
    let width = w + sx * dx;
    let height = h + sy * dy;
    if (sx !== 0 && (sy === 0 || Math.abs(dx) >= Math.abs(dy) * aspect)) height = width / aspect;
    else width = height * aspect;
    if (width < minimum || height < minimum) {
      width = Math.max(minimum, minimum * aspect);
      height = width / aspect;
    }
    const ax = sx < 0 ? x + w : sx > 0 ? x : x + w / 2;
    const ay = sy < 0 ? y + h : sy > 0 ? y : y + h / 2;
    // the largest size that fits on the screen from the fixed point
    const roomW = sx < 0 ? ax : sx > 0 ? screen.width - ax : 2 * Math.min(ax, screen.width - ax);
    const roomH = sy < 0 ? ay : sy > 0 ? screen.height - ay : 2 * Math.min(ay, screen.height - ay);
    const scale = Math.min(1, roomW / width, roomH / height);
    width *= scale;
    height *= scale;
    return [sx < 0 ? ax - width : sx > 0 ? ax : ax - width / 2, sy < 0 ? ay - height : sy > 0 ? ay : ay - height / 2, width, height];
  }
  let left = x;
  let top = y;
  let right = x + w;
  let bottom = y + h;
  if (handle.includes('w')) left = Math.min(Math.max(0, x + dx), right - minimum);
  if (handle.includes('e')) right = Math.max(Math.min(screen.width, right + dx), left + minimum);
  if (handle.includes('n')) top = Math.min(Math.max(0, y + dy), bottom - minimum);
  if (handle.includes('s')) bottom = Math.max(Math.min(screen.height, bottom + dy), top + minimum);
  return [left, top, right - left, bottom - top];
}
```

In `apps/desktop/src/shared/timeline-model.ts`, replace:

```ts

export interface SceneBlock {
  index: number;
  kind: 'clip' | 'still' | 'card';
  /** Output seconds. */
  start: number;
```

with:

```ts

export interface SceneBlock {
  index: number;
  /** The scene's id (`#<index>` for one without). */
  id: string;
  kind: 'clip' | 'still' | 'card';
  /** Output seconds. */
  start: number;
```

In the same file, replace:

```ts
  kind: OverlayKind;
  /** Index in the project's `zooms`, `masks` or `texts`. */
  item: number;
  /** One occurrence, in output seconds. */
  start: number;
  end: number;
  enabled: boolean;
  title: string;
  /** The row inside its lane: blocks that overlap in time go to separate rows. */
```

with:

```ts
  kind: OverlayKind;
  /** Index in the project's `zooms`, `masks` or `texts`. */
  item: number;
  /** The item's id (`#<index>` for one without). */
  id: string;
  /** One occurrence, in output seconds. */
  start: number;
  end: number;
  /** The scene (index) where the occurrence starts: its speed turns a drag into source seconds. */
  span: number;
  enabled: boolean;
  title: string;
  /** The row inside its lane: blocks that overlap in time go to separate rows. */
```

In the same file, replace:

```ts
  rows: number;
  /** Items no clip shows. */
  cutOut: number;
}

export interface MarkerPin {
```

with:

```ts
  rows: number;
  /** Items no clip shows. */
  cutOut: number;
  /** Those items, to list them (their id, and their name as the lane shows it). */
  cutOutItems: { id: string; title: string }[];
}

export interface MarkerPin {
```

In the same file, replace:

```ts

function sceneBlock(span: SceneSpan): SceneBlock {
  const { scene, index, start, end } = span;
  if (scene.type === 'clip') {
    const source = scene.to - scene.from;
    const detail = scene.speed === 1 ? formatDuration(source) : `${formatDuration(source)} → ${formatDuration(end - start)}`;
    // The speed shows once, in front of the title (`12× Claude at work`): an unlabelled sped-up clip has no title.
    return { index, kind: 'clip', start, end, title: scene.label ?? (scene.speed === 1 ? 'Clip' : ''), detail, speed: scene.speed };
  }
  if (scene.type === 'still') {
    const motion = scene.motion === 'none' ? '' : ` · ${scene.motion === 'kenburns' ? 'Ken Burns' : 'scroll'}`;
    return { index, kind: 'still', start, end, title: scene.label ?? baseName(scene.image), detail: `${formatDuration(scene.duration)}${motion}` };
  }
  return { index, kind: 'card', start, end, title: scene.label ?? scene.title, detail: formatDuration(scene.duration) };
}

function lane<T extends { enabled: boolean; label?: string }>(
  kind: OverlayKind,
  items: readonly T[],
  spans: readonly SceneSpan[],
```

with:

```ts

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
    return { index, id, kind: 'still', start, end, title: scene.label ?? baseName(scene.image), detail: `${formatDuration(scene.duration)}${motion}` };
  }
  return { index, id, kind: 'card', start, end, title: scene.label ?? scene.title, detail: formatDuration(scene.duration) };
}

function lane<T extends { enabled: boolean; label?: string; id?: string }>(
  kind: OverlayKind,
  items: readonly T[],
  spans: readonly SceneSpan[],
```

In the same file, replace:

```ts
  title: (item: T) => string,
): OverlayLane {
  const blocks: OverlayBlock[] = [];
  let cutOut = 0;
  items.forEach((item, index) => {
    const [from, to] = range(item);
    const shown = [...new Set(occurrences(spans, from, to).filter((occurrence) => occurrence !== undefined))];
    if (shown.length === 0) cutOut++;
    for (const occurrence of shown) {
      blocks.push({ kind, item: index, start: occurrence.start, end: occurrence.end, enabled: item.enabled, title: item.label ?? title(item), row: 0 });
    }
  });
  // Greedy interval packing: each block goes to the first row that is free at its start.
```

with:

```ts
  title: (item: T) => string,
): OverlayLane {
  const blocks: OverlayBlock[] = [];
  const cutOutItems: OverlayLane['cutOutItems'] = [];
  items.forEach((item, index) => {
    const [from, to] = range(item);
    const each = occurrences(spans, from, to);
    const shown = [...new Set(each.filter((occurrence) => occurrence !== undefined))];
    if (shown.length === 0) cutOutItems.push({ id: item.id ?? `#${index}`, title: item.label ?? title(item) });
    for (const occurrence of shown) {
      blocks.push({
        kind,
        item: index,
        id: item.id ?? `#${index}`,
        start: occurrence.start,
        end: occurrence.end,
        span: each.indexOf(occurrence),
        enabled: item.enabled,
        title: item.label ?? title(item),
        row: 0,
      });
    }
  });
  // Greedy interval packing: each block goes to the first row that is free at its start.
```

In the same file, replace:

```ts
    ends[row] = Math.max(ends[row] ?? 0, block.end);
    block.row = row;
  }
  return { blocks, cutOut, rows: Math.max(1, ends.length) };
}

/** The output seconds at which the clips show source second `t` (none when it is cut out). */
```

with:

```ts
    ends[row] = Math.max(ends[row] ?? 0, block.end);
    block.row = row;
  }
  return { blocks, cutOut: cutOutItems.length, cutOutItems, rows: Math.max(1, ends.length) };
}

/** The output seconds at which the clips show source second `t` (none when it is cut out). */
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node apps/desktop/test/document.test.ts apps/desktop/test/timeline-model.test.ts`
Expected: PASS, 28 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared apps/desktop/test
git commit -m "desktop: the document's commands (clamped, validated, replayed by id) and the gestures' maths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The editor lock in core, and `cuttle record` refuses an open project

**Files:**
- Create: `packages/core/src/editor-lock.ts`
- Modify: `packages/core/src/index.ts`, `apps/desktop/src/main/project.ts`, `apps/cli/src/{commands/record,errors,main}.ts`, `apps/cli/test/cli.test.ts`, `skill/cuttle/SKILL.md`

- [ ] **Step 1: Write the failing test**

In `apps/cli/test/cli.test.ts`, replace:

```ts
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION, runCli } from '../src/main';
```

with:

```ts
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION, runCli } from '../src/main';
```

In the same file, replace:

```ts
    expect(project.scenes).toEqual([{ type: 'clip', from: 0, to: Math.floor(result.take.seconds * 1000) / 1000 }]);
  }, 20_000);

  it('takes a region split at its commas (as PowerShell passes it) and hides the drawn cursor with --draw-mouse', async () => {
    const dir = join(temp(), 'demo');
    const { code, json } = await cli('--json', '-C', dir, 'record', '--backend', 'test', '--region', '0', '0', '640', '360', '--draw-mouse', '--max', '1', '--countdown', '0');
```

with:

```ts
    expect(project.scenes).toEqual([{ type: 'clip', from: 0, to: Math.floor(result.take.seconds * 1000) / 1000 }]);
  }, 20_000);

  it('refuses a project open in the Cuttle app, unless forced or its app is gone', async () => {
    const dir = join(temp(), 'demo');
    mkdirSync(join(dir, '.cuttle'), { recursive: true });
    // this process stands in for the app on this computer
    writeFileSync(join(dir, '.cuttle', 'editor.lock'), JSON.stringify({ host: hostname(), pid: process.pid }));
    const refused = await cli('--json', '-C', dir, 'record', '--backend', 'test', '--max', '1', '--countdown', '0');
    expect(refused.code).toBe(1);
    expect(refused.json).toMatchObject({ error: { code: 'project-open' } });
    expect(existsSync(join(dir, 'takes'))).toBe(false);
    const forced = await cli('--json', '-C', dir, 'record', '--backend', 'test', '--max', '1', '--countdown', '0', '--force');
    expect(forced.code).toBe(0);
    // an app that crashed left its lock: no process has its id any more
    const gone = spawnSync(process.execPath, ['-e', '']).pid!;
    writeFileSync(join(dir, '.cuttle', 'editor.lock'), JSON.stringify({ host: hostname(), pid: gone }));
    expect((await cli('--json', '-C', dir, 'record', '--backend', 'test', '--max', '1', '--countdown', '0')).code).toBe(0);
  }, 30_000);

  it('takes a region split at its commas (as PowerShell passes it) and hides the drawn cursor with --draw-mouse', async () => {
    const dir = join(temp(), 'demo');
    const { code, json } = await cli('--json', '-C', dir, 'record', '--backend', 'test', '--region', '0', '0', '640', '360', '--draw-mouse', '--max', '1', '--countdown', '0');
```

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts -t "refuses a project open"`
Expected: FAIL: the record is not refused (exit code 0 instead of 1).

- [ ] **Step 2: The lock in core, the app's lock path from it, the refusal**

`packages/core/src/editor-lock.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

/** The Cuttle app's mark that a project is open in its editor, inside the project (written by the app). */
export const EDITOR_LOCK = join('.cuttle', 'editor.lock');

/** What the lock says: the computer, and the app's process there. */
export interface EditorLock {
  host: string;
  pid?: number;
}

/** Whether a process runs on this computer (one that exists but is not ours to signal counts). */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Who has the project open in the Cuttle app, by its lock: undefined when nobody has (no lock, one
 * that does not parse, or one an app on this computer left when it ended).
 */
export async function editorLockOf(dir: string): Promise<EditorLock | undefined> {
  const text = await readFile(join(dir, EDITOR_LOCK), 'utf8').catch(() => undefined);
  let held: unknown;
  try {
    held = text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof held !== 'object' || held === null) return undefined;
  const { host, pid } = held as { host?: unknown; pid?: unknown };
  if (typeof host !== 'string') return undefined;
  if (host === hostname() && typeof pid === 'number' && !running(pid)) return undefined;
  return { host, ...(typeof pid === 'number' && { pid }) };
}
```

In `packages/core/src/index.ts`, replace:

```ts
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, and run ffmpeg.
export { CoreError, type CoreErrorCode } from './errors';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
export { BACKUPS, PROJECT_FILE, backupFile, newProjectFile, projectExists, projectHash, readProjectFile, writeProjectFile, type ProjectFile, type WriteOptions, type WriteResult } from './project-file';
export { samePath, useTake, type TakeFiles } from './use-take';
```

with:

```ts
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, and run ffmpeg.
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
export { BACKUPS, PROJECT_FILE, backupFile, newProjectFile, projectExists, projectHash, readProjectFile, writeProjectFile, type ProjectFile, type WriteOptions, type WriteResult } from './project-file';
export { samePath, useTake, type TakeFiles } from './use-take';
```

In `apps/desktop/src/main/project.ts`, replace:

```ts
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { readProjectFile, samePath, type ProjectFile } from '@cuttle/core';
import { parseTakeJson, trackOffset, type CuttleProject } from '@cuttle/project';
import type { ProjectInfo } from '../shared/ipc';
```

with:

```ts
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { EDITOR_LOCK, readProjectFile, samePath, type ProjectFile } from '@cuttle/core';
import { parseTakeJson, trackOffset, type CuttleProject } from '@cuttle/project';
import type { ProjectInfo } from '../shared/ipc';
```

In the same file, replace:

```ts
  return readProjectFile(dir);
}

const LOCK = 'editor.lock';

/** The project is open in Cuttle on another computer (a synced or shared folder). */
export class LockedError extends Error {
  constructor(readonly host: string) {
```

with:

```ts
  return readProjectFile(dir);
}

/** The project is open in Cuttle on another computer (a synced or shared folder). */
export class LockedError extends Error {
  constructor(readonly host: string) {
```

In the same file, replace:

```ts
 * Returns the release.
 */
export async function lockProject(dir: string, options: { force?: boolean } = {}): Promise<() => Promise<void>> {
  const path = join(dir, CACHE_DIR, LOCK);
  // A lock that does not parse (a power cut during its write leaves it empty) is stale too.
  const held = await readFile(path, 'utf8').then(
    (text) => {
```

with:

```ts
 * Returns the release.
 */
export async function lockProject(dir: string, options: { force?: boolean } = {}): Promise<() => Promise<void>> {
  const path = join(dir, EDITOR_LOCK);
  // A lock that does not parse (a power cut during its write leaves it empty) is stale too.
  const held = await readFile(path, 'utf8').then(
    (text) => {
```

In `apps/cli/src/errors.ts`, replace:

```ts
  // CLI
  usage: EXIT.usage,
  'invalid-project': EXIT.usage,
  // @cuttle/recorder
  'invalid-options': EXIT.usage,
  'device-not-found': EXIT.device,
```

with:

```ts
  // CLI
  usage: EXIT.usage,
  'invalid-project': EXIT.usage,
  'project-open': EXIT.usage,
  // @cuttle/recorder
  'invalid-options': EXIT.usage,
  'device-not-found': EXIT.device,
```

In `apps/cli/src/commands/record.ts`, replace:

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
```

with:

```ts
import { rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { HOTKEYS, listDevices, record, type Backend, type CaptureSource, type Take } from '@cuttle/recorder';
import type { Rect } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';
import { editorLockOf, newProjectFile, projectExists, readProjectFile, useTake, writeProjectFile } from '@cuttle/core';

export interface RecordArgs {
  monitor?: number;
```

In the same file, replace:

```ts
  max?: number;
  countdown?: number;
  drawMouse?: boolean;
  backend: Backend;
}
```

with:

```ts
  max?: number;
  countdown?: number;
  drawMouse?: boolean;
  /** Record even when the project is open in the Cuttle app. */
  force?: boolean;
  backend: Backend;
}
```

In the same file, replace:

```ts
 * it. Ctrl+C (`signal`) stops the recording like the stop hotkey; the take is kept.
 */
export async function recordCommand(projectDir: string, args: RecordArgs, output: Output, signal: AbortSignal): Promise<RecordResult> {
  const devices = await listDevices({ backend: args.backend });
  const source = captureSource(args, devices.monitors.find((monitor) => monitor.primary)?.index ?? devices.monitors[0]?.index ?? 0);
  const webcam = deviceName('camera', args.webcam, devices.cameras);
```

with:

```ts
 * it. Ctrl+C (`signal`) stops the recording like the stop hotkey; the take is kept.
 */
export async function recordCommand(projectDir: string, args: RecordArgs, output: Output, signal: AbortSignal): Promise<RecordResult> {
  // The app records an open project itself (its editor hidden, so it is not in the take).
  const open = args.force ? undefined : await editorLockOf(projectDir);
  if (open) {
    const where = open.host === hostname() ? '' : ` on ${open.host}`;
    throw new CliError('project-open', `the project is open in the Cuttle app${where}: record there with "Record again", or close it first (--force records anyway)`);
  }
  const devices = await listDevices({ backend: args.backend });
  const source = captureSource(args, devices.monitors.find((monitor) => monitor.primary)?.index ?? devices.monitors[0]?.index ?? 0);
  const webcam = deviceName('camera', args.webcam, devices.cameras);
```

In `apps/cli/src/main.ts`, replace:

```ts
    .option('--max <seconds>', 'stop after this long', positive)
    .option('--countdown <seconds>', 'seconds before the recording starts (default 3)', seconds)
    .option('--draw-mouse', 'bake the real pointer into the video')
    .addOption(new Option('--backend <name>', 'capture backend').choices(['auto', 'test']).default('auto').hideHelp())
    .action(
      action((output, project, options: Parameters<typeof recordCommand>[1]) =>
```

with:

```ts
    .option('--max <seconds>', 'stop after this long', positive)
    .option('--countdown <seconds>', 'seconds before the recording starts (default 3)', seconds)
    .option('--draw-mouse', 'bake the real pointer into the video')
    .option('--force', 'record even when the project is open in the Cuttle app')
    .addOption(new Option('--backend <name>', 'capture backend').choices(['auto', 'test']).default('auto').hideHelp())
    .action(
      action((output, project, options: Parameters<typeof recordCommand>[1]) =>
```

In `skill/cuttle/SKILL.md`, replace:

```markdown
- `--max <seconds>` is the safety net. The user can also stop with Ctrl+Shift+Alt+S and add a
  marker with Ctrl+Shift+Alt+M. Other sources: `--window "<part of the title>"`,
  `--region x,y,w,h` (pixels of `--monitor`). `--countdown 3` is the default.

The Bash tool's result names the background task's output file. Wait until the recording runs
(at most 40 s: the countdown plus up to 20 s for the tracks to start):
```

with:

```markdown
- `--max <seconds>` is the safety net. The user can also stop with Ctrl+Shift+Alt+S and add a
  marker with Ctrl+Shift+Alt+M. Other sources: `--window "<part of the title>"`,
  `--region x,y,w,h` (pixels of `--monitor`). `--countdown 3` is the default.
- A project open in the Cuttle app is refused (`project-open`): the app records it itself
  ("Record again"). Ask the user to record there or to close it; `--force` only if they say so.

The Bash tool's result names the background task's output file. Wait until the recording runs
(at most 40 s: the countdown plus up to 20 s for the tracks to start):
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts apps/desktop/test/project-lock.test.ts skill/test/skill.test.ts`
Expected: PASS, 33 tests.

- [ ] **Step 4: Commit**

```bash
git add packages/core apps/cli apps/desktop/src/main/project.ts skill
git commit -m "core: the editor lock; cuttle record refuses a project open in the app (--force records anyway)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The main process: saving, watching, drafts, images

**Files:**
- Create: `apps/desktop/src/main/project-watch.ts`
- Modify: `apps/desktop/src/shared/{ipc,channels}.ts`, `apps/desktop/src/main/{windows,recording,check,media-service}.ts`

- [ ] **Step 1: The contract**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
  // HUD
  'hud:stop': z.undefined(),
  'hud:marker': z.undefined(),
} as const;

export type Request = keyof typeof REQUESTS;
```

with:

```ts
  // HUD
  'hud:stop': z.undefined(),
  'hud:marker': z.undefined(),
  // editor (editing)
  'project:save': z.strictObject({
    raw: z.record(z.string(), z.unknown()),
    /** The hash of the version this one was made from: the write is refused when the file changed since. */
    base: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  'project:import-image': z.strictObject({ purpose: z.enum(['still', 'background']) }),
  'project:draft': z.strictObject({ raw: z.record(z.string(), z.unknown()) }),
} as const;

export type Request = keyof typeof REQUESTS;
```

In the same file, replace:

```ts
  'picker:retry': void;
  'hud:stop': void;
  'hud:marker': void;
}

/** Events (main → window). */
export interface Events {
  'media:state': MediaState;
```

with:

```ts
  'picker:retry': void;
  'hud:stop': void;
  'hud:marker': void;
  /** Written (its new hash); or the file changed meanwhile (the version on disk now); or it could not be written. */
  'project:save': { hash: string } | { conflict: ProjectVersion } | { problem: string };
  /** An image chosen by the person, copied into the project when it lay outside (a path inside the project). */
  'project:import-image': { path: string } | undefined;
  /** The person's version a save conflict could not carry over, written to cuttle.json.draft. */
  'project:draft': void;
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
export interface ProjectVersion {
  raw: Record<string, unknown>;
  hash: string;
}

/**
 * cuttle.json changed on disk, not by this window: a new version (`origin`: `suggest` when the app's
 * own suggest cut the take, else another program, Claude or the CLI), or one that does not parse.
 */
export type ProjectFileEvent = (ProjectVersion & { origin: 'outside' | 'suggest' }) | { issues: string[] };

/** Events (main → window). */
export interface Events {
  'media:state': MediaState;
```

In the same file, replace:

```ts
  'hud:state': HudState;
  /** What the main process is doing to the project (cutting the take), or nothing. */
  'project:status': ProjectStatus;
}

export type Event = keyof Events;
```

with:

```ts
  'hud:state': HudState;
  /** What the main process is doing to the project (cutting the take), or nothing. */
  'project:status': ProjectStatus;
  'project:file': ProjectFileEvent;
}

export type Event = keyof Events;
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts

export const WINDOW_CHANNELS = {
  editor: {
    requests: ['project:info', 'project:reveal', 'media:state', 'media:retry', 'export:targets', 'export:start', 'export:cancel', 'project:record', 'project:takes', 'project:cut'],
    events: ['media:state', 'export:progress', 'export:end', 'project:status'],
  },
  pill: {
    requests: ['pill:recent', 'pill:open', 'pill:hide', 'pill:menu', 'pill:record'],
```

with:

```ts

export const WINDOW_CHANNELS = {
  editor: {
    requests: [
      'project:info',
      'project:reveal',
      'media:state',
      'media:retry',
      'export:targets',
      'export:start',
      'export:cancel',
      'project:record',
      'project:takes',
      'project:cut',
      'project:save',
      'project:import-image',
      'project:draft',
    ],
    events: ['media:state', 'export:progress', 'export:end', 'project:status', 'project:file'],
  },
  pill: {
    requests: ['pill:recent', 'pill:open', 'pill:hide', 'pill:menu', 'pill:record'],
```

- [ ] **Step 2: The file's watcher and its hash-checked save**

`apps/desktop/src/main/project-watch.ts`:

```ts
// The open project's cuttle.json on disk: the editor's saves (hash-checked, so they never overwrite
// another program's) and a watcher that reports the versions this window did not write: Claude's,
// the CLI's, a text editor's, or the app's own suggest after a take.
import { watch, type FSWatcher } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import { CoreError, PROJECT_FILE, projectHash, readProjectFile, writeProjectFile } from '@cuttle/core';
import { parseProject, parseProjectJson } from '@cuttle/project';
import { plainIssue } from '../shared/format';
import type { ProjectFileEvent, Responses } from '../shared/ipc';
import { isInside } from '../shared/media-path';

const firstLine = (message: string) => message.split('\n')[0]!;
const issueLines = (issues: readonly { path: string; message: string }[]) => issues.map((issue) => plainIssue(`${issue.path}: ${issue.message}`));

export class ProjectFileWatch {
  /** Versions this window has: read, written or already reported. */
  private readonly known = new Set<string>();
  private watcher: FSWatcher | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The last version reported did not parse: the next that does is reported even when known (a fix back to it). */
  private broken = false;
  /** Who the next outside change comes from: the app's own suggest, while it cuts a take. */
  origin: 'outside' | 'suggest' = 'outside';

  constructor(
    private readonly dir: string,
    private readonly onChange: (event: ProjectFileEvent) => void,
  ) {}

  start(hash: string | undefined): void {
    if (hash) this.known.add(hash);
    try {
      this.watcher = watch(this.dir, (_event, name) => {
        if (name && name.toLowerCase() === PROJECT_FILE) this.schedule();
      });
      this.watcher.on('error', () => this.close());
    } catch {
      // a folder that cannot be watched: outside changes show on the next open
    }
  }

  /** A save is a write followed by a rename: look once things have settled. */
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), 150);
  }

  private async check(): Promise<void> {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(this.dir, PROJECT_FILE));
    } catch {
      return;
    }
    const hash = projectHash(bytes);
    if (this.known.has(hash) && !this.broken) return;
    this.known.add(hash);
    const text = bytes.toString('utf8');
    const parsed = parseProjectJson(text);
    this.broken = !parsed.ok;
    if (!parsed.ok) return this.onChange({ issues: issueLines(parsed.issues) });
    const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>;
    const origin = this.origin;
    this.origin = 'outside';
    this.onChange({ raw, hash, origin });
  }

  /**
   * Writes `raw` if the file on disk is still the version `base` names; otherwise answers with the
   * version there now, for the editor to replay its gesture on.
   */
  async save(raw: Record<string, unknown>, base: string): Promise<Responses['project:save']> {
    const parsed = parseProject(raw);
    if (!parsed.ok) return { problem: `the edit would make cuttle.json invalid: ${issueLines(parsed.issues).join('; ')}` };
    // Known before the rename, so the watcher's event for this write is never taken for someone else's.
    this.known.add(projectHash(`${JSON.stringify(raw, null, 2)}\n`));
    try {
      const { file } = await writeProjectFile({ dir: this.dir, path: join(this.dir, PROJECT_FILE), raw, project: parsed.project, hash: base }, 'the edit');
      return { hash: file.hash! };
    } catch (error) {
      if (!(error instanceof CoreError) || error.code !== 'conflict') return { problem: firstLine((error as Error).message) };
      try {
        const latest = await readProjectFile(this.dir);
        this.known.add(latest.hash!);
        return { conflict: { raw: latest.raw, hash: latest.hash! } };
      } catch (latestError) {
        return { problem: firstLine((latestError as Error).message) };
      }
    }
  }

  close(): void {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
  }
}

/**
 * An image for a still or the background, as a project path: one inside the project as it is, one
 * outside copied into `images/` (a file of the same name and size there is taken to be the same).
 */
export async function importImage(dir: string, file: string): Promise<string> {
  const root = await realpath(dir);
  const real = await realpath(file);
  const relativePath = (path: string) => relative(root, path).split(sep).join('/');
  if (isInside(real, root, process.platform)) return relativePath(real);
  const folder = join(root, 'images');
  await mkdir(folder, { recursive: true });
  const size = (await stat(real)).size;
  const stem = basename(real, extname(real)).replace(/[^\w.-]+/g, '-') || 'image';
  for (let n = 1; ; n++) {
    const target = join(folder, `${stem}${n === 1 ? '' : `-${n}`}${extname(real).toLowerCase()}`);
    const existing = await stat(target).catch(() => undefined);
    if (existing && existing.size === size) return relativePath(target);
    if (existing) continue;
    await copyFile(real, target);
    return relativePath(target);
  }
}
```

- [ ] **Step 3: The editor's handlers; suggest's cut as an outside change**

In `apps/desktop/src/main/check.ts`, replace:

```ts

/** The countdown's seconds instead of the setting's (CUTTLE_COUNTDOWN=0 skips it). */
export const COUNTDOWN = CHECK && process.env.CUTTLE_COUNTDOWN !== undefined ? Number(process.env.CUTTLE_COUNTDOWN) : undefined;
```

with:

```ts

/** The countdown's seconds instead of the setting's (CUTTLE_COUNTDOWN=0 skips it). */
export const COUNTDOWN = CHECK && process.env.CUTTLE_COUNTDOWN !== undefined ? Number(process.env.CUTTLE_COUNTDOWN) : undefined;

/** The image the editor's image chooser picks without showing a dialog (CUTTLE_CHECK_IMAGE=<file>). */
export const CHECK_IMAGE = CHECK ? process.env.CUTTLE_CHECK_IMAGE || undefined : undefined;
```

In `apps/desktop/src/main/media-service.ts`, replace:

```ts
    private readonly onChange: (state: MediaState) => void,
  ) {}

  current(): MediaState {
    return structuredClone(this.state);
  }
```

with:

```ts
    private readonly onChange: (state: MediaState) => void,
  ) {}

  /** The sources the media are made from. */
  get sources(): CuttleProject['sources'] {
    return this.project.sources;
  }

  current(): MediaState {
    return structuredClone(this.state);
  }
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, Menu, screen, session, shell, type Session, type WebContents } from 'electron';
import { PROJECT_FILE, writeProjectFile, type ProjectFile } from '@cuttle/core';
import { plainIssue } from '../shared/format';
import type { ExportEnd, ProjectStatus } from '../shared/ipc';
import { isInside } from '../shared/media-path';
import { CHECK, HIDDEN } from './check';
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
import { LockedError, lockProject, openProjectFile, projectInfo } from './project';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
import { cutIfPending, recut, startPicking } from './recording';
import { addRecent, loadSettings, updateSettings } from './settings';


const BACKGROUND = '#0c0c0f';
const TITLE_BAR_HEIGHT = 44;

/** No permissions (camera, mic, notifications …), no downloads. */
export function lockDown(ses: Session): void {
```

with:

```ts
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, Menu, screen, session, shell, type Session, type WebContents } from 'electron';
import { PROJECT_FILE, backupFile, writeProjectFile, type ProjectFile } from '@cuttle/core';
import { parseProject } from '@cuttle/project';
import { plainIssue } from '../shared/format';
import type { ExportEnd, ProjectFileEvent, ProjectStatus } from '../shared/ipc';
import { isInside } from '../shared/media-path';
import { CHECK, CHECK_IMAGE, HIDDEN } from './check';
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
import { LockedError, lockProject, openProjectFile, projectInfo } from './project';
import { importImage, ProjectFileWatch } from './project-watch';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
import { cutIfPending, recut, startPicking } from './recording';
import { addRecent, loadSettings, updateSettings } from './settings';

const BACKGROUND = '#0c0c0f';
const TITLE_BAR_HEIGHT = 44;
/** The person's version that a save conflict could not carry over (the editor offers it back). */
const DRAFT_FILE = 'cuttle.json.draft';

/** No permissions (camera, mic, notifications …), no downloads. */
export function lockDown(ses: Session): void {
```

In the same file, replace:

```ts
  /** Its webContents, kept: a closed window's `webContents` getter throws. */
  contents: WebContents;
  media: ProjectMedia;
  release: () => Promise<void>;
  run?: ExportRun;
  /** What the main process is doing to the project, shown in the title bar. */
```

with:

```ts
  /** Its webContents, kept: a closed window's `webContents` getter throws. */
  contents: WebContents;
  media: ProjectMedia;
  /** cuttle.json on disk: the editor's saves and the changes others make. */
  watch: ProjectFileWatch;
  release: () => Promise<void>;
  run?: ExportRun;
  /** What the main process is doing to the project, shown in the title bar. */
```

In the same file, replace:

```ts
async function createEditor(dir: string, key: string, force: boolean): Promise<BrowserWindow> {
  const file = await openProjectFile(dir);
  const release = await lockProject(dir, { force });
  try {
    const window = await editorWindow(dir, key, file, release);
    void cutIfPending(dir);
```

with:

```ts
async function createEditor(dir: string, key: string, force: boolean): Promise<BrowserWindow> {
  const file = await openProjectFile(dir);
  const release = await lockProject(dir, { force });
  // The file as found is kept once, before the editor changes anything (`.bak`, rotated as the CLI does).
  await backupFile(join(dir, PROJECT_FILE)).catch(() => undefined);
  try {
    const window = await editorWindow(dir, key, file, release);
    void cutIfPending(dir);
```

In the same file, replace:

```ts
  });
  const contents = window.webContents;
  guard(contents);
  const media = new ProjectMedia(dir, file.project, (state) => send(contents, 'media:state', state));
  const editor: Editor = { window, contents, media, release };
  editors.set(key, editor);

  bindRequests(contents, 'editor', {
    // Read again on every request: the file may have changed since the window opened.
```

with:

```ts
  });
  const contents = window.webContents;
  guard(contents);
  const editor: Editor = { window, contents, media: newMedia(file.project), release, watch: new ProjectFileWatch(dir, (event) => onFileChange(event)) };
  editors.set(key, editor);
  function newMedia(project: ProjectFile['project']): ProjectMedia {
    return new ProjectMedia(dir, project, (state) => send(contents, 'media:state', state));
  }
  // Another take (Back to take, a recording from the CLI): the proxy, thumbnails and peaks are made for it.
  function onFileChange(event: ProjectFileEvent): void {
    if ('raw' in event) {
      const parsed = parseProject(event.raw);
      if (parsed.ok && JSON.stringify(parsed.project.sources) !== JSON.stringify(editor.media.sources)) {
        editor.media.dispose();
        editor.media = newMedia(parsed.project);
        void editor.media.start();
      }
    }
    send(contents, 'project:file', event);
  }
  const media = { current: () => editor.media.current(), start: () => editor.media.start() };

  bindRequests(contents, 'editor', {
    // Read again on every request: the file may have changed since the window opened.
```

In the same file, replace:

```ts
    'project:record': () => void startPicking(dir),
    'project:takes': () => takesMenu(dir, window),
    'project:cut': () => void recut(dir),
  });
  contents.on('did-finish-load', () => send(contents, 'project:status', editor.status ?? {}));

  window.on('closed', () => {
    if (editors.get(key) === editor) editors.delete(key);
    media.dispose();
    editor.run?.cancel();
    void release();
    // Closing the last editor returns to the pill (not while an editor is reopened on a new take).
```

with:

```ts
    'project:record': () => void startPicking(dir),
    'project:takes': () => takesMenu(dir, window),
    'project:cut': () => void recut(dir),
    'project:save': ({ raw, base }) => editor.watch.save(raw, base),
    'project:draft': ({ raw }) => writeFile(join(dir, DRAFT_FILE), `${JSON.stringify(raw, null, 2)}\n`),
    'project:import-image': async ({ purpose }) => {
      const chosen =
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

  window.on('closed', () => {
    if (editors.get(key) === editor) editors.delete(key);
    editor.watch.close();
    editor.media.dispose();
    editor.run?.cancel();
    void release();
    // Closing the last editor returns to the pill (not while an editor is reopened on a new take).
```

In the same file, replace:

```ts
  return editors.get(keyOf(real));
}

/** The window of a project's open editor, if there is one. */
export async function editorWindowOf(dir: string): Promise<BrowserWindow | undefined> {
  const editor = await editorOf(dir);
```

with:

```ts
  return editors.get(keyOf(real));
}

/** The next outside change of the project comes from the app's own suggest ("Cut by suggest"). */
export async function expectSuggest(dir: string, expecting: boolean): Promise<void> {
  const editor = await editorOf(dir);
  if (editor) editor.watch.origin = expecting ? 'suggest' : 'outside';
}

/** The window of a project's open editor, if there is one. */
export async function editorWindowOf(dir: string): Promise<BrowserWindow | undefined> {
  const editor = await editorOf(dir);
```

In `apps/desktop/src/main/recording.ts`, replace:

```ts
import { APP_ORIGIN, serveApp, bundlePath } from './protocols';
import { recorderHost, RecordingError } from './recorder-host';
import { loadSettings, updateSettings } from './settings';
import { editorWindowOf, guard, hidePill, reopenEditor, setEditorStatus, showPill, webPreferences } from './windows';

/** The HUD's window (the HUD and a margin for its shadow): never in the video, and a dead zone for the input log. */
const HUD_SIZE = { width: 380, height: 64 };
```

with:

```ts
import { APP_ORIGIN, serveApp, bundlePath } from './protocols';
import { recorderHost, RecordingError } from './recorder-host';
import { loadSettings, updateSettings } from './settings';
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, setEditorStatus, showPill, webPreferences } from './windows';

/** The HUD's window (the HUD and a margin for its shadow): never in the video, and a dead zone for the input log. */
const HUD_SIZE = { width: 380, height: 64 };
```

In the same file, replace:

```ts
  await recut(dir);
}

/** Opens the editor on the take at once, and reloads it once `suggest` has cut it in the background. */
async function cutAndShow(dir: string): Promise<void> {
  finishing.add(keyOf(dir));
  try {
```

with:

```ts
  await recut(dir);
}

/**
 * Opens the editor on the take at once while `suggest` cuts it in the background; the editor gets
 * the cut as a change of the file, one step to undo ("Cut by suggest").
 */
async function cutAndShow(dir: string): Promise<void> {
  finishing.add(keyOf(dir));
  try {
```

In the same file, replace:

```ts
  }
}

/** Cuts the project's take with `suggest`; the editor says so, and says when it could not (with Try again). */
async function cut(dir: string): Promise<void> {
  await setEditorStatus(dir, { text: 'Cutting the take…', state: 'working' });
  try {
    await cutTake(dir);
  } catch (error) {
    await setEditorStatus(dir, { text: `The take could not be cut: ${(error as Error).message.split('\n')[0]}`, state: 'failed' });
    return;
  }
  await setEditorStatus(dir, undefined);
  // Only an editor still open takes the cut: one closed meanwhile is not opened again.
  if (await editorWindowOf(dir)) await reopenEditor(dir, { reload: true });
}

/** "Try again" in the editor after a failed cut. */
```

with:

```ts
  }
}

/**
 * Cuts the project's take with `suggest`; the editor says so, gets the cut as a change of the file
 * (one step to undo, "Cut by suggest"), and says when it could not (with Try again).
 */
async function cut(dir: string): Promise<void> {
  await setEditorStatus(dir, { text: 'Cutting the take…', state: 'working' });
  await expectSuggest(dir, true);
  try {
    await cutTake(dir);
  } catch (error) {
    await expectSuggest(dir, false);
    await setEditorStatus(dir, { text: `The take could not be cut: ${(error as Error).message.split('\n')[0]}`, state: 'failed' });
    return;
  }
  await setEditorStatus(dir, undefined);
}

/** "Try again" in the editor after a failed cut. */
```

- [ ] **Step 4: Typecheck and the contract test**

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0, no output.

Run: `pnpm exec vitest run --project node apps/desktop/test/contract.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared apps/desktop/src/main
git commit -m "desktop: hash-checked saves, the file's watcher (outside changes, suggest's cut), drafts and imported images

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The editor: history, tools, source view, timeline edits, inspector, command menu

**Files:**
- Create: `apps/desktop/src/renderer/editor/{doc,actions,commands}.ts`, `apps/desktop/src/renderer/editor/{SourceView,CommandMenu}.tsx`
- Modify: `packages/engine/src/{renderer,index}.ts`, `packages/engine/test/renderer.browser.test.ts`, `apps/desktop/src/renderer/icons.tsx`, `apps/desktop/src/renderer/editor/{App,Timeline,Inspector,ExportSheet}.tsx`, `apps/desktop/src/renderer/editor/{session,media,player}.ts`, `apps/desktop/src/renderer/editor/editor.css`

- [ ] **Step 1: The engine's failing tests**

The renderer has to take the scenes of each edited version (it looked its scenes up in the project it was made with, so after a split or a move it drew a card where a clip was), and it has to say where it drew each text.

In `packages/engine/test/renderer.browser.test.ts`, replace:

```ts
    expect(render(CARDS, { t: 0, layers: [layer(0, 0), layer(1, 1)] }).pixels.data).toEqual(b);
  });

  it('throws after dispose', () => {
    const renderer = createRenderer(new OffscreenCanvas(1, 1), CARDS, { assets, screenSize: SCREEN });
    renderer.dispose();
```

with:

```ts
    expect(render(CARDS, { t: 0, layers: [layer(0, 0), layer(1, 1)] }).pixels.data).toEqual(b);
  });

  it('draws the scenes it was given last: a card where the project it was made with had a clip', () => {
    const clipFirst = parse({ look: { background: { preset: 'solid', color: '#204060' } }, scenes: [{ type: 'clip', from: 0, to: 1 }, ...CARDS.scenes] });
    const renderer = createRenderer(new OffscreenCanvas(1, 1), clipFirst, { assets, screenSize: SCREEN });
    const state: RenderState = { t: 0, layers: [layer(0, 1)] };
    expect(() => renderer.render(state, NO_SOURCES)).toThrow('render: no screen frame for scene 0');
    renderer.setScenes(CARDS.scenes);
    expect(() => renderer.render(state, NO_SOURCES)).not.toThrow();
    renderer.dispose();
  });

  it('reports where it drew each text, for picking one with the pointer', () => {
    const project = parse({ scenes: [{ type: 'clip', from: 0, to: 1 }], texts: [{ id: 't1', at: 0, duration: 1, text: 'Hello', position: 'bottom' }] });
    const renderer = createRenderer(new OffscreenCanvas(1, 1), project, { assets, screenSize: SCREEN });
    renderer.render({ t: 0, layers: [{ ...layer(0, 1, 'clip'), texts: [{ overlay: project.texts[0]!, opacity: 1 }] }] }, { ...NO_SOURCES, screens: new Map([[0, fakeScreen()]]) });
    const [drawn] = renderer.drawnTexts();
    expect(drawn?.overlay.id).toBe('t1');
    // inside the output, in its lower half (a bottom caption)
    const [x, y, width, height] = drawn!.rect;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(64);
    expect(y).toBeGreaterThan(18);
    expect(y + height).toBeLessThanOrEqual(36);
    // a frame without texts reports none
    renderer.render({ t: 0, layers: [layer(0, 1, 'clip')] }, { ...NO_SOURCES, screens: new Map([[0, fakeScreen()]]) });
    expect(renderer.drawnTexts()).toEqual([]);
    renderer.dispose();
  });

  it('throws after dispose', () => {
    const renderer = createRenderer(new OffscreenCanvas(1, 1), CARDS, { assets, screenSize: SCREEN });
    renderer.dispose();
```

Run: `pnpm exec vitest run --project browser packages/engine/test/renderer.browser.test.ts`
Expected: FAIL, 2 tests: `renderer.setScenes is not a function`, `renderer.drawnTexts is not a function`.

- [ ] **Step 2: The engine takes new scenes and says where it drew each text**

In `packages/engine/src/renderer.ts`, replace:

```ts
import type { CardScene, CuttleProject, FrameStyle, Rect, StillScene } from '@cuttle/project';
import type { ActiveText, RenderState, SceneFrame } from '@cuttle/timeline';
import type { EngineAssets } from './assets';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
```

with:

```ts
import type { CardScene, CuttleProject, FrameStyle, Rect, Scene, StillScene, TextOverlay } from '@cuttle/project';
import type { ActiveText, RenderState, SceneFrame } from '@cuttle/timeline';
import type { EngineAssets } from './assets';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
```

In the same file, replace:

```ts
   * when the WebGL context was lost (create a new renderer after `webglcontextrestored`).
   */
  render(state: RenderState, sources: FrameSources): void;
  /** Frees every GL object; `render` throws afterwards. Leaves the canvas and its context alone. */
  dispose(): void;
}

export interface RendererOptions {
  /** From `loadEngineAssets()`. */
  assets: EngineAssets;
```

with:

```ts
   * when the WebGL context was lost (create a new renderer after `webglcontextrestored`).
   */
  render(state: RenderState, sources: FrameSources): void;
  /** The text overlays the last `render` drew, where they are in the output (for picking one with the pointer). */
  drawnTexts(): readonly DrawnText[];
  /**
   * The scenes of a newer version of the project whose look and output are the same (an edit): the
   * layers' indices point into these from now on. Another look or output needs a new renderer.
   */
  setScenes(scenes: readonly Scene[]): void;
  /** Frees every GL object; `render` throws afterwards. Leaves the canvas and its context alone. */
  dispose(): void;
}

/** A text overlay as drawn: the overlay, and its box in output pixels. */
export interface DrawnText {
  overlay: TextOverlay;
  rect: Rect;
}

export interface RendererOptions {
  /** From `loadEngineAssets()`. */
  assets: EngineAssets;
```

In the same file, replace:

```ts
  let uploadedStill: ImageBitmap | undefined;
  let layerTarget: RenderTarget | undefined;
  let disposed = false;

  function frame(style: FrameStyle | null): { chrome: FrameChrome | null; layout: WindowLayout } {
    const chrome = style ? FRAME_CHROME[style] : null;
```

with:

```ts
  let uploadedStill: ImageBitmap | undefined;
  let layerTarget: RenderTarget | undefined;
  let disposed = false;
  let drawn: DrawnText[] = [];
  let scenes: readonly Scene[] = project.scenes;

  function frame(style: FrameStyle | null): { chrome: FrameChrome | null; layout: WindowLayout } {
    const chrome = style ? FRAME_CHROME[style] : null;
```

In the same file, replace:

```ts
      const sprite = sprites.label(overlay.text, style, unit, output.width * TEXT_MAX_WIDTH);
      const [x, y] = placeOverlay(output, sprite.box, overlay.position, style.align, avoid);
      spritePass.drawSprite(sprite, x, y, opacity);
    }
  }
```

with:

```ts
      const sprite = sprites.label(overlay.text, style, unit, output.width * TEXT_MAX_WIDTH);
      const [x, y] = placeOverlay(output, sprite.box, overlay.position, style.align, avoid);
      spritePass.drawSprite(sprite, x, y, opacity);
      drawn.push({ overlay, rect: [x, y, sprite.box.width, sprite.box.height] });
    }
  }
```

In the same file, replace:

```ts
  }

  function drawLayer(layer: SceneFrame, sources: FrameSources, t: number): void {
    const scene = project.scenes[layer.index];
    if (!scene) throw new Error(`render: the project has no scene ${layer.index}`);
    background.draw(t);
    if (scene.type === 'card') drawCard(scene);
```

with:

```ts
  }

  function drawLayer(layer: SceneFrame, sources: FrameSources, t: number): void {
    const scene = scenes[layer.index];
    if (!scene) throw new Error(`render: the project has no scene ${layer.index}`);
    background.draw(t);
    if (scene.type === 'card') drawCard(scene);
```

In the same file, replace:

```ts
      if (disposed) throw new Error('render: the renderer was disposed');
      // A lost context draws nothing and reports no error: fail loudly instead of exporting black frames.
      if (gl.isContextLost()) throw new Error('render: the WebGL context was lost');
      gl.bindVertexArray(vao);
      gl.viewport(0, 0, output.width, output.height);
      gl.enable(gl.BLEND);
```

with:

```ts
      if (disposed) throw new Error('render: the renderer was disposed');
      // A lost context draws nothing and reports no error: fail loudly instead of exporting black frames.
      if (gl.isContextLost()) throw new Error('render: the WebGL context was lost');
      drawn = [];
      gl.bindVertexArray(vao);
      gl.viewport(0, 0, output.width, output.height);
      gl.enable(gl.BLEND);
```

In the same file, replace:

```ts
      }
      sprites.endFrame();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
```

with:

```ts
      }
      sprites.endFrame();
    },
    drawnTexts: () => drawn,
    setScenes(next) {
      scenes = next;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
```

In `packages/engine/src/index.ts`, replace:

```ts
export { FONT_FAMILY, loadEngineAssets, type EngineAssets } from './assets';
export { createRenderer, type FrameSources, type Renderer, type RendererOptions } from './renderer';
export type { Size } from './layout';
export type { CursorImage } from './presets/cursors';
```

with:

```ts
export { FONT_FAMILY, loadEngineAssets, type EngineAssets } from './assets';
export { createRenderer, type DrawnText, type FrameSources, type Renderer, type RendererOptions } from './renderer';
export type { Size } from './layout';
export type { CursorImage } from './presets/cursors';
```

Run: `pnpm exec vitest run --project browser packages/engine/test/renderer.browser.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 3: The document in the window: history, saving, outside changes**

`apps/desktop/src/renderer/editor/doc.ts`:

```ts
// The open document in the editor: edits as commands (one gesture is one step to undo), saving when
// a gesture ends with the hash-checked write, the gesture replayed on a newer version when the
// file changed meanwhile, and changes made outside the app (Claude, the CLI, suggest) shown and
// undoable.
import { parseProject, type CuttleProject } from '@cuttle/project';
import { applyCommand, describeChange, DocumentError, ensureIds, firstChanged, replayCommands, type Command, type EditLimits, type ListName, type Raw } from '../../shared/document';
import type { ProjectFileEvent } from '../../shared/ipc';
import { bridge } from '../bridge';
import { store } from './session';

/** A version to go back to, and what going back undoes. */
interface Step {
  raw: Raw;
  label: string;
}

export interface Toast {
  id: number;
  text: string;
  /** "Undo" for a change, when it is still the newest. */
  undo?: boolean;
  /** "Show" for an outside change: the first item it added or changed. */
  show?: { list: ListName; id: string };
  /** "Use mine" for the version a conflict set aside (cuttle.json.draft); it stays until answered. */
  draft?: boolean;
  tone?: 'note' | 'warning';
}

export interface DocState {
  raw: Raw;
  project: CuttleProject;
  /** The file's hash on disk for the version saved last (or read). */
  hash: string;
  /** A drag's result before the gesture ends: shown, not saved, not in the history. */
  preview?: CuttleProject;
  saving: boolean;
  /** Why the last save failed, said for people. */
  problem?: string;
  /** cuttle.json on disk does not parse: its issues; editing waits until it is fixed. */
  issues?: string[];
  undoLabel?: string;
  redoLabel?: string;
  toast?: Toast;
}

const undoStack: Step[] = [];
const redoStack: Step[] = [];
/** Commands applied since the version on disk (`hash`): replayed when the file changed meanwhile. */
let unsaved: Command[] = [];
/** A whole version to write (undo, redo, an outside change undone), instead of replaying commands. */
let unsavedRestore = false;
let saving: Promise<void> | undefined;
/** The person's version a save conflict could not carry over (also in cuttle.json.draft). */
let draft: Raw | undefined;
/** The newest edit not on disk yet, to name it when a newer version cannot take it. */
let unsavedLabel = '';
let toastIds = 0;
let limits: () => EditLimits = () => ({});

const parse = (raw: Raw): CuttleProject => {
  const parsed = parseProject(raw);
  if (!parsed.ok) throw new DocumentError('invalid', parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  return parsed.project;
};

const doc = (): DocState => store.get().doc!;

function setDoc(change: Partial<DocState>): void {
  store.set((state) => ({ doc: { ...state.doc!, ...change, undoLabel: undoStack.at(-1)?.label, redoLabel: redoStack.at(-1)?.label } }));
}

export function toast(text: string, options: Omit<Toast, 'id' | 'text'> = {}): void {
  setDoc({ toast: { id: ++toastIds, text, ...options } });
}

export function dismissToast(): void {
  setDoc({ toast: undefined });
}

/** Opens the document from cuttle.json as read; items without an id get one (written with the first save). */
export function openDocument(raw: Raw, hash: string, editLimits: () => EditLimits): DocState {
  limits = editLimits;
  const withIds = ensureIds(raw);
  return { raw: withIds, project: parse(withIds), hash, saving: false };
}

/** Applies a gesture's commands as one step (`label` names it for Undo) and saves. Returns false when nothing could change. */
const BROKEN = 'cuttle.json has a mistake; fix it first (Claude or a text editor), then edit here again.';

export function edit(commands: Command[], label: string): boolean {
  const current = doc();
  if (current.issues) {
    toast(BROKEN, { tone: 'warning' });
    return false;
  }
  let raw = current.raw;
  try {
    for (const command of commands) raw = applyCommand(raw, command, limits());
  } catch (error) {
    setDoc({ preview: undefined });
    if (error instanceof DocumentError) toast(`${label} is not possible: ${error.message.split('\n')[0]}`, { tone: 'warning' });
    else throw error;
    return false;
  }
  if (JSON.stringify(raw) === JSON.stringify(current.raw)) {
    setDoc({ preview: undefined });
    return false;
  }
  undoStack.push({ raw: current.raw, label });
  redoStack.length = 0;
  unsaved.push(...commands);
  unsavedLabel = label;
  setDoc({ raw, project: parse(raw), preview: undefined, toast: undefined });
  void save();
  return true;
}

/** Shows what a gesture would do while it runs (a drag); `edit` ends it. Undefined commands end it without a change. */
export function preview(commands: Command[] | undefined): void {
  if (!commands) return setDoc({ preview: undefined });
  try {
    let raw = doc().raw;
    for (const command of commands) raw = applyCommand(raw, command, limits());
    setDoc({ preview: parse(raw) });
  } catch {
    // a step of the drag that is not possible: keep showing the last one that was
  }
}

export function undo(): void {
  if (doc().issues) return toast(BROKEN, { tone: 'warning' });
  const step = undoStack.pop();
  if (!step) return;
  redoStack.push({ raw: doc().raw, label: step.label });
  restore(step.raw);
}

export function redo(): void {
  if (doc().issues) return toast(BROKEN, { tone: 'warning' });
  const step = redoStack.pop();
  if (!step) return;
  undoStack.push({ raw: doc().raw, label: step.label });
  restore(step.raw);
}

function restore(raw: Raw): void {
  unsavedRestore = true;
  unsaved = [];
  setDoc({ raw, project: parse(raw), preview: undefined, toast: undefined });
  void save();
}

/** Writes the document; a newer version on disk gets the unsaved commands replayed on it. One write at a time. */
function save(): Promise<void> {
  if (saving) return saving.then(() => (unsaved.length > 0 || unsavedRestore ? save() : undefined));
  saving = (async () => {
    setDoc({ saving: true });
    for (let attempt = 0; attempt < 5; attempt++) {
      const { raw, hash } = doc();
      const writing = unsaved.length;
      const restoring = unsavedRestore;
      const answer = await bridge.invoke('project:save', { raw, base: hash }).catch((error: Error) => ({ problem: error.message }));
      if ('hash' in answer) {
        unsaved = unsaved.slice(writing);
        if (restoring) unsavedRestore = false;
        setDoc({ hash: answer.hash, problem: undefined });
        if (unsaved.length === 0 && !unsavedRestore) break;
        continue;
      }
      if ('problem' in answer) {
        setDoc({ problem: answer.problem });
        break;
      }
      // The file changed meanwhile (Claude, the CLI): this gesture's commands go on top of that version.
      const latest = ensureIds(answer.conflict.raw);
      const mine = doc().raw;
      let newer: CuttleProject;
      try {
        newer = parse(latest);
      } catch {
        // the outside version has a mistake (the banner shows it): the edit is saved once it is fixed
        setDoc({ problem: 'cuttle.json changed outside the app and has a mistake: your edit is saved once it is fixed' });
        break;
      }
      if (restoring) {
        // an undo or redo cannot be replayed: the newer version shows, and the person's is kept to choose
        unsavedRestore = false;
        unsaved = [];
        const before = doc().project;
        setDoc({ raw: latest, project: newer, hash: answer.conflict.hash });
        void keepDraft(mine, `cuttle.json changed outside the app (${describeChange(before, newer)}), so your undo was not saved.`);
        break;
      }
      const { raw: merged, dropped } = replayCommands(latest, unsaved, limits());
      setDoc({ raw: merged, project: parse(merged), hash: answer.conflict.hash });
      // (`dropped` names items by id: the note names the edit instead)
      if (dropped.length > 0) void keepDraft(mine, `cuttle.json changed outside the app, and “${unsavedLabel}” no longer fits it.`);
    }
    setDoc({ saving: false });
  })();
  return saving.finally(() => (saving = undefined));
}

/** Keeps the person's version that a conflict could not carry over, in cuttle.json.draft, and offers it back. */
async function keepDraft(mine: Raw, why: string): Promise<void> {
  draft = mine;
  const kept = await bridge.invoke('project:draft', { raw: mine }).then(
    () => true,
    () => false,
  );
  toast(`${why} ${kept ? 'Your version is kept in cuttle.json.draft.' : 'Your version can still be used.'}`, { tone: 'warning', draft: true });
}

/** "Use mine": the version a conflict set aside replaces the file's, as a new step to undo. */
export function useDraft(): void {
  if (!draft || doc().issues) return;
  const mine = draft;
  draft = undefined;
  undoStack.push({ raw: doc().raw, label: 'Use your version' });
  redoStack.length = 0;
  restore(mine);
}

/** Writes again what a failed save left unsaved (the title bar's "Not saved · Try again"). */
export function retrySave(): void {
  if (unsaved.length > 0 || unsavedRestore) void save();
  else setDoc({ problem: undefined });
}

/**
 * Waits until every edit is on disk (before an export, which reads the file): the save under way,
 * then the ones queued behind it. A save that failed, or a file that does not parse, ends the wait.
 */
export async function flush(): Promise<void> {
  for (;;) {
    if (saving) await saving;
    else if ((unsaved.length > 0 || unsavedRestore) && !doc().problem && !doc().issues) await save();
    else return;
  }
}

/**
 * A version of cuttle.json this window did not write. With nothing unsaved it replaces the document
 * at once, as one step to undo; while a gesture or a save is under way, the save replays the
 * gesture on it. A file that does not parse keeps the last good document.
 */
export async function outsideChange(event: ProjectFileEvent): Promise<void> {
  if ('issues' in event) return setDoc({ issues: event.issues });
  if (doc().issues) setDoc({ issues: undefined });
  if (event.hash === doc().hash) return;
  if (saving) await saving;
  // our save conflicted on this version and replayed onto it: nothing more to take
  if (event.hash === doc().hash) return;
  // an edit still waits (its save failed, or met a version with a mistake): it goes on top of this one
  if (unsaved.length > 0 || unsavedRestore) return void save();
  const before = doc();
  const raw = ensureIds(event.raw);
  let project: CuttleProject;
  try {
    project = parse(raw);
  } catch {
    return;
  }
  undoStack.push({ raw: before.raw, label: event.origin === 'suggest' ? 'Cut by suggest' : 'the outside change' });
  redoStack.length = 0;
  setDoc({ raw, project, hash: event.hash, preview: undefined });
  const show = firstChanged(before.project, project);
  toast(event.origin === 'suggest' ? 'Cut by suggest' : `Changed outside the app: ${describeChange(before.project, project)}`, { undo: true, ...(show && event.origin !== 'suggest' && { show }) });
}
```

In `apps/desktop/src/renderer/editor/session.ts`, replace:

```ts
// The open project in an editor window: its media, the player, what is selected and the export.
import { loadEngineAssets } from '@cuttle/engine';
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject } from '@cuttle/project';
import type { ExportEnd, ExportProgress, ExportTarget, MediaState, ProjectInfo, ProjectStatus } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { openProjectMedia, openVideo, type EditorMedia } from './media';
import { Player, type PlayerState } from './player';
import { createStore } from './store';

/** What is selected: a scene, or an overlay with the stretch of the video where it was clicked (an overlay can show more than once). */
export type Selection = { kind: 'scene' | OverlayKind; index: number; start?: number; end?: number };

export interface EditorState {
  phase: 'loading' | 'ready' | 'failed';
  error?: string;
  info?: ProjectInfo;
  media?: EditorMedia;
  /** The output format the preview shows; undefined: the project's own output. */
  format?: ExportFormat;
  player: PlayerState;
  selection?: Selection;
  tab: 'selection' | 'look';
  mediaState: MediaState;
  exportOpen: boolean;
  exportProgress?: ExportProgress;
```

with:

```ts
// The open project in an editor window: the document, its media, the player, the tool and the
// selection, and the export.
import { loadEngineAssets } from '@cuttle/engine';
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject } from '@cuttle/project';
import type { Command, EditLimits } from '../../shared/document';
import type { ExportEnd, ExportProgress, ExportTarget, MediaState, ProjectInfo, ProjectStatus } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { edit, flush, openDocument, outsideChange, redo, undo, type DocState } from './doc';
import { ensureMedia, openProjectMedia, openVideo, type EditorMedia } from './media';
import { Player, type PlayerState } from './player';
import { createStore } from './store';

/** What is selected: a scene or an overlay by id, an overlay with the stretch of the video where it was clicked. */
export type Selection = { kind: 'scene' | OverlayKind; id: string; start?: number; end?: number };

/** The tools: V selects; Z and M draw zooms and masks in the source view; T adds a caption. */
export type Tool = 'select' | 'zoom' | 'mask' | 'caption';

export interface EditorState {
  phase: 'loading' | 'ready' | 'failed';
  error?: string;
  info?: ProjectInfo;
  media?: EditorMedia;
  /** The document: cuttle.json as edited here. */
  doc?: DocState;
  /** The output format the preview shows; undefined: the project's own output. */
  format?: ExportFormat;
  player: PlayerState;
  selection?: Selection;
  tool: Tool;
  tab: 'selection' | 'look';
  /** Snapping on the timeline (Ctrl while dragging turns it off for that drag). */
  snap: boolean;
  mediaState: MediaState;
  exportOpen: boolean;
  exportProgress?: ExportProgress;
```

In the same file, replace:

```ts
  pxPerSecond: number;
  /** What the main process is doing to the project ("Cutting the take…", or that it could not). */
  status?: ProjectStatus;
}

export const store = createStore<EditorState>({
  phase: 'loading',
  player: { t: 0, playing: false },
  tab: 'selection',
  mediaState: { seq: -1, proxy: { state: 'none' }, thumbnails: { state: 'none' }, peaks: { state: 'none' } },
  exportOpen: false,
  exporting: false,
  exportUnseen: false,
  pxPerSecond: 0,
});

let player: Player | undefined;
```

with:

```ts
  pxPerSecond: number;
  /** What the main process is doing to the project ("Cutting the take…", or that it could not). */
  status?: ProjectStatus;
  /** The command menu (Ctrl+K) is open. */
  menuOpen: boolean;
}

export const store = createStore<EditorState>({
  phase: 'loading',
  player: { t: 0, playing: false },
  tool: 'select',
  tab: 'selection',
  snap: true,
  mediaState: { seq: -1, proxy: { state: 'none' }, thumbnails: { state: 'none' }, peaks: { state: 'none' } },
  exportOpen: false,
  exporting: false,
  exportUnseen: false,
  pxPerSecond: 0,
  menuOpen: false,
});

let player: Player | undefined;
```

In the same file, replace:

```ts
  return player;
}

let shown: { media: EditorMedia; format: ExportFormat | undefined; project: CuttleProject } | undefined;

/** The project as the preview shows it: the file's, or with the previewed output format (the same object until either changes). */
export function shownProject(state: EditorState = store.get()): CuttleProject | undefined {
  if (!state.media) return undefined;
  if (shown?.media !== state.media || shown.format !== state.format) shown = { media: state.media, format: state.format, project: withFormat(state.media.project, state.format) };
  return shown.project;
}

const query = new URLSearchParams(location.search);

/** Opens the window's project: its media through the protocol, the engine's assets, the player. */
export async function openSession(canvas: HTMLCanvasElement): Promise<void> {
  // The status comes before the project is open (the window opens while the take is cut).
  bridge.on('project:status', (status) => {
```

with:

```ts
  return player;
}

let shown: { project: CuttleProject; format: ExportFormat | undefined; result: CuttleProject } | undefined;

/** The project as the editor shows it: the document (or a drag's preview of it), in the previewed output format. */
export function shownProject(state: EditorState = store.get()): CuttleProject | undefined {
  const project = state.doc?.preview ?? state.doc?.project;
  if (!project) return undefined;
  if (shown?.project !== project || shown.format !== state.format) shown = { project, format: state.format, result: withFormat(project, state.format) };
  return shown.result;
}

/** The document's project as saved (no preview), in its own format. */
export const documentProject = (): CuttleProject | undefined => store.get().doc?.project;

/** What edits clamp to: the take's length, the screen's size, the output's frame rate. */
export function editLimits(): EditLimits {
  const { media, doc } = store.get();
  return {
    ...(media && { sourceEnd: media.screen.end, screen: media.screen.size }),
    ...(doc && { fps: doc.project.output.fps }),
  };
}

const query = new URLSearchParams(location.search);

/** Opens the window's project: the document, its media through the protocol, the engine's assets, the player. */
export async function openSession(canvas: HTMLCanvasElement): Promise<void> {
  // The status comes before the project is open (the window opens while the take is cut).
  bridge.on('project:status', (status) => {
```

In the same file, replace:

```ts
  try {
    const info = await bridge.invoke('project:info');
    document.title = `${info.name} · Cuttle`;
    store.set({ info });
    const [media, assets] = await Promise.all([openProjectMedia(info), loadEngineAssets()]);
    player = new Player({
      canvas,
      media,
      assets,
      project: media.project,
      onChange: (state) => store.set({ player: state }),
    });
    store.set({ phase: 'ready', media });
    await player.seek(0);
    if (query.get('check') === '1') exposeCheckHook(canvas);
    bridge.on('media:state', (state) => void applyMediaState(state));
    void applyMediaState(await bridge.invoke('media:state'));
    bridge.on('export:progress', (progress) => store.set({ exportProgress: progress }));
    bridge.on('export:end', (end) => store.set((state) => ({ exportEnd: end, exporting: false, exportUnseen: !state.exportOpen })));
  } catch (error) {
    store.set({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}

/** What the end-to-end check drives and reads (only with `?check=1`). */
function exposeCheckHook(canvas: HTMLCanvasElement): void {
  Object.assign(window, {
    __cuttleCheck: {
      seek: (t: number) => player?.seek(t),
      playback: () => player?.stats(),
      state: () => ({ ...store.get().player, duration: player?.duration ?? 0, mediaState: store.get().mediaState, proxyInUse }),
      pixels: () => canvas.toDataURL('image/png'),
      /** Switches to the proxy (the check runs with `?proxy=off` to compare frames of the take first). */
      useProxy: async () => {
```

with:

```ts
  try {
    const info = await bridge.invoke('project:info');
    document.title = `${info.name} · Cuttle`;
    const doc = openDocument(info.raw, info.hash, editLimits);
    store.set({ info, doc });
    const [media, assets] = await Promise.all([openProjectMedia(info, doc.project), loadEngineAssets()]);
    player = new Player({
      canvas,
      media,
      assets,
      project: shownProject()!,
      onChange: (state) => store.set({ player: state }),
    });
    store.set({ phase: 'ready', media });
    await player.seek(0);
    followDocument();
    if (query.get('check') === '1') exposeCheckHook(canvas);
    bridge.on('media:state', (state) => void applyMediaState(state));
    void applyMediaState(await bridge.invoke('media:state'));
    bridge.on('export:progress', (progress) => store.set({ exportProgress: progress }));
    bridge.on('export:end', (end) => store.set((state) => ({ exportEnd: end, exporting: false, exportUnseen: !state.exportOpen })));
    bridge.on('project:file', (event) => {
      // Another take: its media are opened anew.
      if ('raw' in event && JSON.stringify((event.raw as { sources?: unknown }).sources) !== JSON.stringify(store.get().info?.raw.sources)) {
        location.reload();
        return;
      }
      void outsideChange(event);
    });
  } catch (error) {
    store.set({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}

const LISTS = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts' } as const;

/** The player follows the document (edits, previews, outside changes) and the previewed format. */
function followDocument(): void {
  let last = shownProject();
  let running = Promise.resolve();
  store.subscribe(() => {
    // a selection whose item an undo or an outside change removed is cleared
    const { selection, doc } = store.get();
    if (selection && doc && !doc.project[LISTS[selection.kind]].some((item) => item.id === selection.id)) select(undefined);
    const next = shownProject();
    if (next === last || !next) return;
    last = next;
    running = running.then(async () => {
      const media = store.get().media;
      if (!media || !player) return;
      // An edit that needs a new image, the webcam or the mic shows once they are open.
      const added = await ensureMedia(media, next);
      if (last !== next) return;
      player.update(next, { redrawOnly: added });
      if (added) store.set({ media: { ...media } });
    });
  });
}

/** What the end-to-end check drives and reads (only with `?check=1`). */
function exposeCheckHook(canvas: HTMLCanvasElement): void {
  Object.assign(window, {
    __cuttleCheck: {
      seek: (t: number) => player?.seek(t),
      playback: () => player?.stats(),
      state: () => ({ ...store.get().player, duration: player?.duration ?? 0, mediaState: store.get().mediaState, proxyInUse, selection: store.get().selection, tool: store.get().tool }),
      pixels: () => canvas.toDataURL('image/png'),
      /** Switches to the proxy (the check runs with `?proxy=off` to compare frames of the take first). */
      useProxy: async () => {
```

In the same file, replace:

```ts
        if (proxy.state === 'ready' && proxy.path) await switchToProxy(proxy.path);
        return proxyInUse;
      },
    },
  });
}
```

with:

```ts
        if (proxy.state === 'ready' && proxy.path) await switchToProxy(proxy.path);
        return proxyInUse;
      },
      /** The document as edited, and whether it is saved. */
      doc: () => {
        const doc = store.get().doc!;
        return { raw: doc.raw, hash: doc.hash, saving: doc.saving, problem: doc.problem, issues: doc.issues, toast: doc.toast, undo: doc.undoLabel, redo: doc.redoLabel };
      },
      edit: (commands: Command[], label: string) => edit(commands, label),
      undo,
      redo,
      flush,
      select: (selection: Selection | undefined) => select(selection),
      tool: (tool: Tool) => setTool(tool),
    },
  });
}
```

In the same file, replace:

```ts

export function setFormat(format: ExportFormat | undefined): void {
  store.set({ format });
  const project = shownProject();
  if (project) player?.setProject(project);
}

export function select(selection: Selection | undefined): void {
  store.set({ selection, ...(selection && { tab: 'selection' as const }) });
}

/** Opens the export sheet: on the running export or one that ended unseen, else on a new one. */
export function openExport(): void {
  const { phase, exporting, exportUnseen } = store.get();
```

with:

```ts

export function setFormat(format: ExportFormat | undefined): void {
  store.set({ format });
}

export function select(selection: Selection | undefined): void {
  store.set({ selection, ...(selection && { tab: 'selection' as const }) });
}

/** The stage shows the source view: paused, with the Zoom or Mask tool on or a zoom or mask selected (playing shows the video). */
export const sourceViewShown = (state: EditorState): boolean =>
  !state.player.playing && (state.tool === 'zoom' || state.tool === 'mask' || state.selection?.kind === 'zoom' || state.selection?.kind === 'mask');

/** Picks a tool; Esc goes back to Select. Zoom and Mask show the source view. */
export function setTool(tool: Tool): void {
  store.set({ tool });
}

/** Opens the export sheet: on the running export or one that ended unseen, else on a new one. */
export function openExport(): void {
  const { phase, exporting, exportUnseen } = store.get();
```

In the same file, replace:

```ts
  store.set({ exportOpen: false });
}

export async function startExport(formats: ExportTarget[], encoder: 'auto' | 'hardware' | 'software'): Promise<void> {
  store.set({ exporting: true, exportEnd: undefined, exportProgress: undefined, exportStarted: Date.now() });
  try {
    await bridge.invoke('export:start', { formats, encoder });
  } catch (error) {
    store.set({ exporting: false, exportEnd: { state: 'failed', files: [], format: formats[0]!, code: 'internal', message: (error as Error).message } });
```

with:

```ts
  store.set({ exportOpen: false });
}

/** Exports what is saved: every edit is written first (the export reads the file). */
export async function startExport(formats: ExportTarget[], encoder: 'auto' | 'hardware' | 'software'): Promise<void> {
  store.set({ exporting: true, exportEnd: undefined, exportProgress: undefined, exportStarted: Date.now() });
  try {
    await flush();
    await bridge.invoke('export:start', { formats, encoder });
  } catch (error) {
    store.set({ exporting: false, exportEnd: { state: 'failed', files: [], format: formats[0]!, code: 'internal', message: (error as Error).message } });
```

In `apps/desktop/src/renderer/editor/media.ts`, replace:

```ts
  return createImageBitmap(blob, { ...options, resizeWidth, resizeHeight, resizeQuality: 'high' });
}

/** Everything the editor shows of a project, opened once. */
export interface EditorMedia {
  project: CuttleProject;
  screen: VideoSource;
  webcam?: VideoSource & { offset: number };
  mic?: AudioSource;
  events: InputEvent[];
  cursor?: CursorTrack;
  markers: Marker[];
  stills: Map<number, ImageBitmap>;
  backgroundImage?: ImageBitmap;
  /** Things that work without, said for people (a missing webcam file, unreadable events). */
  warnings: string[];
}

/** Larger images are scaled down: textures of 8192 px work on every GPU Cuttle runs on. */
const MAX_IMAGE = 8192;

/** The issues of a cuttle.json that does not parse, one plain line each. */
export function projectIssues(issues: readonly { path: string; message: string }[]): string {
  return issues.map((issue) => plainIssue(`${issue.path}: ${issue.message}`)).join('\n');
```

with:

```ts
  return createImageBitmap(blob, { ...options, resizeWidth, resizeHeight, resizeQuality: 'high' });
}

/** The issues of a cuttle.json that does not parse, one plain line each. */
export function projectIssues(issues: readonly { path: string; message: string }[]): string {
  return issues.map((issue) => plainIssue(`${issue.path}: ${issue.message}`)).join('\n');
```

In the same file, replace:

```ts
  return createImageBitmap(canvas, { premultiplyAlpha: 'premultiply' });
}

export async function openProjectMedia(info: ProjectInfo): Promise<EditorMedia> {
  const parsed = parseProject(info.raw);
  if (!parsed.ok) throw new MediaError(`cuttle.json has a mistake:\n${projectIssues(parsed.issues)}`);
  const project = parsed.project;
  const { sources, look } = project;
  const warnings: string[] = [];
  /** An optional file's problem is a warning: the editor works without it. */
  const optional = async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  };
  const screen = await openVideo(sources.screen, 'The screen recording');

  let webcam: EditorMedia['webcam'];
  if (sources.webcam && look.webcam.enabled) {
    const video = await optional(() => openVideo(sources.webcam!, 'The webcam recording'));
    if (video) webcam = { ...video, offset: info.offsets.webcam };
  }
  let mic: AudioSource | undefined;
  if (sources.mic && look.audio.enabled) {
    mic = await optional(async () => {
      const audio = await openAudio(sources.mic!, info.offsets.mic);
      if (audio) return audio;
      throw (await present(sources.mic!)) ? new MediaError(`The mic recording (${sources.mic}) cannot be played.`) : missing(sources.mic!);
    });
  }

  let events: InputEvent[] = [];
  if (sources.events) {
    const text = await optional(async () => {
      const found = await fetchText(sources.events!);
      if (found === undefined) throw new MediaError(`${sources.events} cannot be read: no cursor or input activity.`);
      return found;
    });
    if (text !== undefined) events = parseEventsJsonl(text).events;
  }
  const cursor = look.cursor.enabled && events.length > 0 ? createCursorTrack(events) : undefined;
  let markers: Marker[] = [];
  if (sources.markers) {
    const text = await optional(async () => (await fetchText(sources.markers!)) ?? '');
    const parsedMarkers = parseMarkersJson(text ?? '');
    if (parsedMarkers.ok) markers = parsedMarkers.markers;
  }

  const stills = new Map<number, ImageBitmap>();
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type !== 'still') continue;
    stills.set(index, (await optional(() => loadImage(scene.image, MAX_IMAGE, `The image of scene ${index + 1}`))) ?? (await placeholder(scene.image)));
  }
  const backgroundImage =
    look.background.preset === 'image' && look.background.image
      ? ((await optional(() => loadImage(look.background.image!, MAX_IMAGE, 'The background image'))) ?? (await placeholder()))
      : undefined;
  return { project, screen, ...(webcam && { webcam }), ...(mic && { mic }), events, ...(cursor && { cursor }), markers, stills, ...(backgroundImage && { backgroundImage }), warnings };
}
```

with:

```ts
  return createImageBitmap(canvas, { premultiplyAlpha: 'premultiply' });
}

/**
 * Everything the editor shows of a project. The take's tracks are opened once; images, the webcam
 * and the mic are opened when the project first needs them (an edit can add a page or turn the
 * webcam on), see `ensureMedia`.
 */
export interface EditorMedia {
  screen: VideoSource;
  webcam?: VideoSource & { offset: number };
  mic?: AudioSource;
  events: InputEvent[];
  /** The pointer's track from the input events (drawn when the look's cursor is on). */
  cursor?: CursorTrack;
  markers: Marker[];
  /** Still images by their project path. */
  stills: Map<string, ImageBitmap>;
  backgroundImage?: ImageBitmap;
  /** The path `backgroundImage` was read from. */
  backgroundPath?: string;
  /** Seconds after the screen track that the webcam and the mic started. */
  offsets: ProjectInfo['offsets'];
  /** Sources tried and failed (not tried again), and warnings for people (a missing webcam file …). */
  failed: Set<string>;
  warnings: string[];
}

/** Larger images are scaled down: textures of 8192 px work on every GPU Cuttle runs on. */
const MAX_IMAGE = 8192;

/** A file the editor works without: its problem becomes a warning (once). */
async function optional<T>(media: Pick<EditorMedia, 'warnings' | 'failed'>, key: string, work: () => Promise<T>): Promise<T | undefined> {
  if (media.failed.has(key)) return undefined;
  try {
    return await work();
  } catch (error) {
    media.failed.add(key);
    media.warnings.push(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export async function openProjectMedia(info: ProjectInfo, project: CuttleProject): Promise<EditorMedia> {
  const { sources } = project;
  const screen = await openVideo(sources.screen, 'The screen recording');
  const media: EditorMedia = { screen, events: [], markers: [], stills: new Map(), offsets: info.offsets, failed: new Set(), warnings: [] };
  if (sources.events) {
    const text = await optional(media, sources.events, async () => {
      const found = await fetchText(sources.events!);
      if (found === undefined) throw new MediaError(`${sources.events} cannot be read: no cursor or input activity.`);
      return found;
    });
    if (text !== undefined) media.events = parseEventsJsonl(text).events;
  }
  if (media.events.length > 0) media.cursor = createCursorTrack(media.events);
  if (sources.markers) {
    const text = await optional(media, sources.markers, async () => (await fetchText(sources.markers!)) ?? '');
    const parsedMarkers = parseMarkersJson(text ?? '');
    if (parsedMarkers.ok) media.markers = parsedMarkers.markers;
  }
  await ensureMedia(media, project);
  return media;
}

/**
 * Opens what `project` needs and `media` lacks: the images of its stills (a placeholder for one
 * that cannot be read), the background image, the webcam when the look shows it, the mic when the
 * look plays it. Returns whether anything was added.
 */
export async function ensureMedia(media: EditorMedia, project: CuttleProject): Promise<boolean> {
  const { sources, look } = project;
  let added = false;
  for (const scene of project.scenes) {
    if (scene.type !== 'still' || media.stills.has(scene.image)) continue;
    media.stills.set(scene.image, (await optional(media, scene.image, () => loadImage(scene.image, MAX_IMAGE, 'The image of a page'))) ?? (await placeholder(scene.image)));
    added = true;
  }
  const background = look.background.preset === 'image' ? look.background.image : undefined;
  if (background && media.backgroundPath !== background) {
    media.backgroundImage = (await optional(media, background, () => loadImage(background, MAX_IMAGE, 'The background image'))) ?? (await placeholder());
    media.backgroundPath = background;
    added = true;
  }
  if (sources.webcam && look.webcam.enabled && !media.webcam) {
    const video = await optional(media, sources.webcam, () => openVideo(sources.webcam!, 'The webcam recording'));
    if (video) {
      media.webcam = { ...video, offset: media.offsets.webcam };
      added = true;
    }
  }
  if (sources.mic && look.audio.enabled && !media.mic) {
    const mic = await optional(media, sources.mic, async () => {
      const audio = await openAudio(sources.mic!, media.offsets.mic);
      if (audio) return audio;
      throw (await present(sources.mic!)) ? new MediaError(`The mic recording (${sources.mic}) cannot be played.`) : missing(sources.mic!);
    });
    if (mic) {
      media.mic = mic;
      added = true;
    }
  }
  return added;
}
```

In `apps/desktop/src/renderer/editor/player.ts`, replace:

```ts
// The editor's output view: the export's engine drawing the export's timeline into a canvas, played
// with the mic as the clock (video follows the audio and drops frames rather than drifting) and
// scrubbed one frame at a time.
import { createRenderer, type EngineAssets, type FrameSources, type Renderer } from '@cuttle/engine';
import { planStills } from '@cuttle/export/frame-plan';
import type { CuttleProject } from '@cuttle/project';
import { createTimeline, type RenderState, type Timeline } from '@cuttle/timeline';
```

with:

```ts
// The editor's output view: the export's engine drawing the export's timeline into a canvas, played
// with the mic as the clock (video follows the audio and drops frames rather than drifting) and
// scrubbed one frame at a time.
import { createRenderer, type DrawnText, type EngineAssets, type FrameSources, type Renderer } from '@cuttle/engine';
import { planStills } from '@cuttle/export/frame-plan';
import type { CuttleProject } from '@cuttle/project';
import { createTimeline, type RenderState, type Timeline } from '@cuttle/timeline';
```

In the same file, replace:

```ts
  private screen: VideoSource;
  private keyFrames: KeyFrames | undefined;
  private screenGrabber: FrameGrabber;
  private readonly webcamGrabber: FrameGrabber | undefined;
  private seekToken = 0;
  private playToken = 0;
  private context: AudioContext | undefined;
```

with:

```ts
  private screen: VideoSource;
  private keyFrames: KeyFrames | undefined;
  private screenGrabber: FrameGrabber;
  private webcamGrabber: FrameGrabber | undefined;
  private seekToken = 0;
  private playToken = 0;
  private context: AudioContext | undefined;
```

In the same file, replace:

```ts
    return this.timeline.spans;
  }

  current(): PlayerState {
    return this.state;
  }
```

with:

```ts
    return this.timeline.spans;
  }

  /** How many clips show at output time `t` (more than one inside a crossfade). */
  clipsAt(t: number): number {
    return this.timeline.frameAt(Math.max(0, Math.min(t, this.duration - 1e-6))).layers.filter((layer) => layer.kind === 'clip').length;
  }

  /** The video track playback and scrubbing read now (the proxy once it is made), for the source view. */
  get screenSource(): VideoSource {
    return this.screen;
  }

  /** The captions the frame on the canvas shows, with their boxes in output pixels (to click one on the video). */
  drawnTexts(): readonly DrawnText[] {
    return this.renderer.drawnTexts();
  }

  current(): PlayerState {
    return this.state;
  }
```

In the same file, replace:

```ts
  }

  private makeRenderer(): Renderer {
    return createRenderer(this.canvas, this.project, {
      assets: this.assets,
      screenSize: this.media.screen.size,
```

with:

```ts
  }

  private makeRenderer(): Renderer {
    this.drawnBackground = this.media.backgroundImage;
    return createRenderer(this.canvas, this.project, {
      assets: this.assets,
      screenSize: this.media.screen.size,
```

In the same file, replace:

```ts
    this.onChange(this.state);
  }

  /** Shows another version of the project (another output format); keeps the playhead. */
  setProject(project: CuttleProject): void {
    const playing = this.state.playing;
    this.pause();
    this.renderer.dispose();
    this.project = project;
    this.timeline = this.makeTimeline();
    this.renderer = this.makeRenderer();
    void this.seek(Math.min(this.state.t, this.timeline.duration));
    if (playing) this.play();
  }

  /**
   * Plays and scrubs the proxy (720p, a key frame every 0.5 s) instead of the take. The engine
   * places the frame by the take's size, so a smaller frame shows the same picture.
```

with:

```ts
    this.onChange(this.state);
  }

  /**
   * Shows another version of the project (an edit, another output format) and keeps the playhead:
   * the timeline anew, the renderer only when the look, the output or an image it draws changed.
   * `media` may have gained images, the webcam or the mic for it (`ensureMedia`).
   */
  update(project: CuttleProject, options: { redrawOnly?: boolean } = {}): void {
    if (project === this.project && !options.redrawOnly) return;
    const playing = this.state.playing;
    this.pause();
    const look = (value: CuttleProject) => JSON.stringify([value.look, value.output]);
    const background = this.media.backgroundImage;
    const renew = look(project) !== look(this.project) || background !== this.drawnBackground;
    this.project = project;
    this.timeline = this.makeTimeline();
    if (renew) {
      this.renderer.dispose();
      this.renderer = this.makeRenderer();
    } else this.renderer.setScenes(project.scenes);
    if (this.media.webcam && !this.webcamGrabber) this.webcamGrabber = new FrameGrabber(this.media.webcam);
    void this.seek(Math.min(this.state.t, this.timeline.duration));
    if (playing) this.play();
  }

  /** The background image the renderer was made with. */
  private drawnBackground: ImageBitmap | undefined;

  /** The still images of the timeline's scenes, by scene index (`media` keeps them by path). */
  private stillsByIndex(): Map<number, ImageBitmap> {
    const stills = new Map<number, ImageBitmap>();
    this.timeline.spans.forEach((span, index) => {
      if (span.scene.type !== 'still') return;
      const image = this.media.stills.get(span.scene.image);
      if (image) stills.set(index, image);
    });
    return stills;
  }

  /**
   * Plays and scrubs the proxy (720p, a key frame every 0.5 s) instead of the take. The engine
   * places the frame by the take's size, so a smaller frame shows the same picture.
```

In the same file, replace:

```ts
    const state = this.timeline.frameAt(frame / this.fps);
    const held: HeldFrame[] = [];
    const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };
    try {
      for (const layer of state.layers) {
        if (layer.kind === 'still') {
          const image = this.media.stills.get(layer.index);
          if (image) sources.stills.set(layer.index, image);
          continue;
        }
```

with:

```ts
    const state = this.timeline.frameAt(frame / this.fps);
    const held: HeldFrame[] = [];
    const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };
    const stills = this.stillsByIndex();
    try {
      for (const layer of state.layers) {
        if (layer.kind === 'still') {
          const image = stills.get(layer.index);
          if (image) sources.stills.set(layer.index, image);
          continue;
        }
```

In the same file, replace:

```ts
    };
    const open = (frame: number) => {
      const frames = Array.from({ length: last - frame + 1 }, (_, i) => frame + i);
      return new PlaybackFrames(planStills(this.timeline, fps, frames), video, this.media.stills, LOOKAHEAD_FRAMES);
    };
    let frames: PlaybackFrames | undefined;
    let shown = startFrame - 1;
```

with:

```ts
    };
    const open = (frame: number) => {
      const frames = Array.from({ length: last - frame + 1 }, (_, i) => frame + i);
      return new PlaybackFrames(planStills(this.timeline, fps, frames), video, this.stillsByIndex(), LOOKAHEAD_FRAMES);
    };
    let frames: PlaybackFrames | undefined;
    let shown = startFrame - 1;
```

- [ ] **Step 4: The actions and the commands**

`apps/desktop/src/renderer/editor/actions.ts`:

```ts
// The editor's actions on the document (the timeline bar, the keys, the command menu and the tools
// call these): each is one step to undo. Where the playhead stands decides where things go.
import type { ClipScene, CuttleProject, Scene } from '@cuttle/project';
import { sceneSpans, TEXT_FADE_SECONDS, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import { outputTimesOf } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { edit, toast } from './doc';
import { currentPlayer, documentProject, select, setTool, store, type Selection, type Tool } from './session';

/** Output seconds a new zoom or caption lasts. */
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
}

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
 * Why a zoom, mask or caption cannot be placed at the playhead (on a still, a card, inside a
 * crossfade), said for the tooltip; undefined where it can.
 */
export function overlayBlocked(t = currentPlayer()?.current().t ?? 0): string | undefined {
  const place = playheadPlace(t);
  if (!place) return 'There is nothing in the video yet';
  if (!place.clip) return place.span.scene.type === 'still' ? 'Not on a page: move the playhead onto a clip' : 'Not on a card: move the playhead onto a clip';
  if ((currentPlayer()?.clipsAt(t) ?? 1) > 1) return 'Not inside a crossfade: move the playhead a little';
  return undefined;
}

/** A tool by its key or the menu: Zoom, Mask and Caption say why when nothing can go at the playhead. */
export function chooseTool(tool: Tool): void {
  const blocked = tool === 'select' || store.get().tool === tool ? undefined : overlayBlocked();
  if (blocked) return toast(blocked, { tone: 'warning' });
  setTool(tool);
}

const screenSize = () => store.get().media?.screen.size ?? { width: 1920, height: 1080 };

/** Splits the clip under the playhead there (a continuous cut). */
export function split(): void {
  const place = playheadPlace();
  if (!place?.clip || place.source === undefined) return toast('Move the playhead onto a clip to split it.', { tone: 'warning' });
  const frame = place.clip.speed / (documentProject()?.output.fps ?? 30);
  if (place.source - place.clip.from < frame || place.clip.to - place.source < frame) return toast('The playhead is at the clip’s edge: nothing to split.', { tone: 'warning' });
  edit([{ type: 'split', id: place.clip.id!, at: place.source }], 'Split clip');
}

export function deleteSelection(): void {
  const selection = store.get().selection;
  if (!selection) return;
  const list = LIST_OF[selection.kind];
  if (edit([{ type: 'delete', list, id: selection.id }], `Delete ${NAMES[list]}`)) select(undefined);
}

/** A copy of the selection right after it (an overlay a second later in its source). */
export function duplicateSelection(): void {
  const selection = store.get().selection;
  if (!selection) return;
  const list = LIST_OF[selection.kind];
  edit([{ type: 'duplicate', list, id: selection.id, ...(list !== 'scenes' && { shift: 1 }) }], `Duplicate ${NAMES[list]}`);
}

/** Sets a clip's speed (the selected clip, else the one under the playhead). */
export function setSpeed(speed: number, id = selectedOrCurrentClip()?.id): void {
  if (!id) return toast('Select a clip to change its speed.', { tone: 'warning' });
  edit([{ type: 'speed', id, speed }], `Speed ${speed}×`);
}

export function selectedOrCurrentClip(): ClipScene | undefined {
  const project = documentProject();
  const selection = store.get().selection;
  if (selection?.kind === 'scene') {
    const scene = project?.scenes.find((item) => item.id === selection.id);
    if (scene?.type === 'clip') return scene;
  }
  return playheadPlace()?.clip;
}

/** The new item's id is known before the edit: the selection moves to it. */
function addAndSelect(command: Extract<Command, { type: 'add' }>, kind: Selection['kind'], label: string): void {
  const before = new Set(itemIds(documentProject()));
  if (!edit([command], label)) return;
  const added = itemIds(documentProject()).find((id) => !before.has(id));
  if (added) select({ kind, id: added });
}

const itemIds = (project: CuttleProject | undefined) => (project ? [...project.scenes, ...project.zooms, ...project.masks, ...project.texts].map((item) => item.id!).filter(Boolean) : []);

/** A zoom at the playhead: 3 output seconds (so it rests at full zoom for a while), on the middle half of the screen; then the source view to place it. */
export function addZoom(rect?: number[]): void {
  const blocked = overlayBlocked();
  if (blocked) return toast(blocked, { tone: 'warning' });
  const place = playheadPlace()!;
  const clip = place.clip!;
  const screen = screenSize();
  const duration = Math.min(NEW_OVERLAY_SECONDS * clip.speed, clip.to - place.source!);
  addAndSelect({ type: 'add', list: 'zooms', item: { at: place.source!, duration, rect: rect ?? [screen.width / 4, screen.height / 4, screen.width / 2, screen.height / 2] } }, 'zoom', 'Add zoom');
  setTool('zoom');
}

/** A mask from the playhead to the clip's end; then the source view to place it. */
export function addMask(rect?: number[]): void {
  const blocked = overlayBlocked();
  if (blocked) return toast(blocked, { tone: 'warning' });
  const place = playheadPlace()!;
  const clip = place.clip!;
  const screen = screenSize();
  addAndSelect({ type: 'add', list: 'masks', item: { from: place.source!, to: clip.to, rect: rect ?? [screen.width * 0.35, screen.height * 0.45, screen.width * 0.3, screen.height * 0.1] } }, 'mask', 'Add mask');
  setTool('mask');
}

export type CaptionPosition = 'top' | 'center' | 'bottom';

/**
 * The command that adds a caption at the playhead (the caption tool previews it while typing);
 * undefined where none can go. It starts a fade earlier, so it is fully shown at the playhead, and
 * stays 3 output seconds after it.
 */
export function captionCommand(text: string, position: CaptionPosition): Extract<Command, { type: 'add' }> | undefined {
  if (overlayBlocked()) return undefined;
  const place = playheadPlace()!;
  const clip = place.clip!;
  const source = place.source!;
  const fps = documentProject()?.output.fps ?? 30;
  const at = Math.max(clip.from, source - (TEXT_FADE_SECONDS + 1 / fps) * clip.speed);
  const duration = Math.min(source - at + NEW_OVERLAY_SECONDS * clip.speed, clip.to - at);
  return { type: 'add', list: 'texts', item: { at, duration, text, position } };
}

/** Where a new caption goes: the first of bottom, top and middle that no caption shown at the playhead uses. */
export function freeCaptionPosition(): CaptionPosition {
  const source = playheadPlace()?.source;
  const used = new Set((documentProject()?.texts ?? []).filter((text) => text.enabled && source !== undefined && source >= text.at && source < text.at + text.duration).map((text) => text.position));
  return (['bottom', 'top', 'center'] as const).find((position) => !used.has(position)) ?? 'bottom';
}

export function addCaption(text: string, position: CaptionPosition = 'bottom'): void {
  const command = captionCommand(text, position);
  if (!command) return toast(overlayBlocked() ?? 'A caption cannot go here.', { tone: 'warning' });
  addAndSelect(command, 'caption', 'Add caption');
}

/** Where a new scene goes: after the scene under the playhead. */
const insertIndex = () => (playheadPlace()?.index ?? -1) + 1;

export function addCard(): void {
  addAndSelect({ type: 'add', list: 'scenes', index: insertIndex(), item: { type: 'card', title: 'Title', duration: 3 } }, 'scene', 'Add card');
}

/** A page: an image chosen by the person (copied into the project), scrolled through in a browser frame. */
export async function addPage(): Promise<void> {
  const chosen = await bridge.invoke('project:import-image', { purpose: 'still' });
  if (!chosen) return;
  addAndSelect({ type: 'add', list: 'scenes', index: insertIndex(), item: { type: 'still', image: chosen.path, duration: 4, motion: 'scroll', frame: 'browser-light' } }, 'scene', 'Add page');
}

/** Replaces a still's image or the background's with one the person picks. */
export async function chooseImage(purpose: 'still' | 'background', id?: string): Promise<void> {
  const chosen = await bridge.invoke('project:import-image', { purpose });
  if (!chosen) return;
  if (purpose === 'still' && id) edit([{ type: 'set', list: 'scenes', id, fields: { image: chosen.path } }], 'Replace image');
  else edit([{ type: 'look', path: ['background'], value: { preset: 'image', image: chosen.path } }], 'Background image');
}

const KIND_OF: Record<ListName, Selection['kind']> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption' };

/** Selects an item and moves the playhead to where the video first shows it (the toast's "Show"). */
export function reveal(list: ListName, id: string): void {
  const project = documentProject();
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
  if (!media) return;
  const scenes: Scene[] = [{ type: 'clip', from: Math.max(0, media.screen.start), to: media.screen.end, speed: 1 }];
  if (edit([{ type: 'scenes', scenes: scenes as unknown as Record<string, unknown>[] }], 'Show raw take')) select(undefined);
}
```

`apps/desktop/src/renderer/editor/commands.ts`:

```ts
// Everything the editor can do by name, with its keys: the command menu (Ctrl+K) lists these, and
// the keyboard runs them. Keys are written as the menu shows them.
import { addCard, addMask, addPage, addZoom, deleteSelection, duplicateSelection, overlayBlocked, selectedOrCurrentClip, setSpeed, showRawTake, split, SPEEDS } from './actions';
import { redo, undo } from './doc';
import { currentPlayer, openExport, select, setTool, store } from './session';

export interface EditorCommand {
  id: string;
  name: string;
  /** The keys, as people read them ("Ctrl+Z"). */
  keys?: string;
  group: 'Edit' | 'Add' | 'Play' | 'View' | 'Tools' | 'Project';
  run: () => void;
  /** Why it cannot run now, for the menu; undefined when it can. */
  blocked?: () => string | undefined;
}

const needsSelection = () => (store.get().selection ? undefined : 'Select something first');
const needsClip = () => (selectedOrCurrentClip() ? undefined : 'Select a clip, or move the playhead onto one');

export function editorCommands(): EditorCommand[] {
  const player = currentPlayer();
  return [
    { id: 'undo', name: `Undo${store.get().doc?.undoLabel ? ` ${store.get().doc!.undoLabel}` : ''}`, keys: 'Ctrl+Z', group: 'Edit', run: undo, blocked: () => (store.get().doc?.undoLabel ? undefined : 'Nothing to undo') },
    { id: 'redo', name: `Redo${store.get().doc?.redoLabel ? ` ${store.get().doc!.redoLabel}` : ''}`, keys: 'Ctrl+Shift+Z', group: 'Edit', run: redo, blocked: () => (store.get().doc?.redoLabel ? undefined : 'Nothing to redo') },
    { id: 'split', name: 'Split the clip at the playhead', keys: 'S', group: 'Edit', run: split, blocked: () => (selectedOrCurrentClip() ? undefined : 'Move the playhead onto a clip') },
    { id: 'delete', name: 'Delete the selection', keys: 'Delete', group: 'Edit', run: deleteSelection, blocked: needsSelection },
    { id: 'duplicate', name: 'Duplicate the selection', keys: 'Ctrl+D', group: 'Edit', run: duplicateSelection, blocked: needsSelection },
    ...SPEEDS.map((speed) => ({ id: `speed-${speed}`, name: `Speed ${speed}×`, group: 'Edit' as const, run: () => setSpeed(speed), blocked: needsClip })),
    { id: 'speed', name: 'Set the speed…', keys: 'R', group: 'Edit', run: () => document.querySelector<HTMLSelectElement>('#speed-select')?.focus(), blocked: needsClip },
    { id: 'raw', name: 'Show the raw take (one clip over all of it)', group: 'Edit', run: showRawTake },
    { id: 'add-zoom', name: 'Add a zoom at the playhead', group: 'Add', run: () => addZoom(), blocked: () => overlayBlocked() },
    { id: 'add-mask', name: 'Add a mask at the playhead', group: 'Add', run: () => addMask(), blocked: () => overlayBlocked() },
    { id: 'add-caption', name: 'Add a caption at the playhead (type it on the video)', group: 'Add', run: () => setTool('caption'), blocked: () => overlayBlocked() },
    { id: 'add-card', name: 'Add a title card', group: 'Add', run: addCard },
    { id: 'add-page', name: 'Add a page (an image)…', group: 'Add', run: () => void addPage() },
    { id: 'tool-select', name: 'Select tool', keys: 'V', group: 'Tools', run: () => setTool('select') },
    { id: 'tool-zoom', name: 'Zoom tool: draw a zoom on the video', keys: 'Z', group: 'Tools', run: () => setTool('zoom'), blocked: () => overlayBlocked() },
    { id: 'tool-mask', name: 'Mask tool: draw a mask on the video', keys: 'M', group: 'Tools', run: () => setTool('mask'), blocked: () => overlayBlocked() },
    { id: 'tool-caption', name: 'Caption tool: type a caption on the video', keys: 'T', group: 'Tools', run: () => setTool('caption'), blocked: () => overlayBlocked() },
    { id: 'play', name: 'Play or pause', keys: 'Space', group: 'Play', run: () => player?.toggle() },
    { id: 'back', name: 'A second back', keys: 'J', group: 'Play', run: () => void player?.seek(player.current().t - 1) },
    { id: 'frame-back', name: 'A frame back (Shift: a second)', keys: '←', group: 'Play', run: () => void player?.seek(player.current().t - 1 / player.fps) },
    { id: 'frame-on', name: 'A frame on (Shift: a second)', keys: '→', group: 'Play', run: () => void player?.seek(player.current().t + 1 / player.fps) },
    { id: 'start', name: 'Go to the start', keys: 'Home', group: 'Play', run: () => void player?.seek(0) },
    { id: 'end', name: 'Go to the end', keys: 'End', group: 'Play', run: () => void player?.seek(player.duration) },
    { id: 'fit', name: 'Fit the whole video in the timeline', keys: 'Shift+Z', group: 'View', run: () => store.set({ pxPerSecond: 0 }) },
    { id: 'snap', name: store.get().snap ? 'Turn snapping off' : 'Turn snapping on', group: 'View', run: () => store.set({ snap: !store.get().snap }) },
    { id: 'deselect', name: 'Clear the selection', keys: 'Esc', group: 'View', run: () => select(undefined) },
    { id: 'look', name: 'Show the look (background, frame, cursor…)', group: 'View', run: () => store.set({ tab: 'look' }) },
    { id: 'export', name: 'Export…', keys: 'Ctrl+E', group: 'Project', run: openExport },
  ];
}
```

- [ ] **Step 5: The editor's parts**

In `apps/desktop/src/renderer/icons.tsx`, replace:

```
);
export const FitIcon = icon(<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />);
export const FolderIcon = icon(<path d="M2 4.5h4l1.5 1.5H14v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />);
export const CloseIcon = icon(<path d="m4 4 8 8M12 4l-8 8" />);
export const CheckIcon = icon(<path d="m3 8.5 3 3 7-7" />);
export const FilmIcon = icon(
```

with:

```
);
export const FitIcon = icon(<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />);
export const FolderIcon = icon(<path d="M2 4.5h4l1.5 1.5H14v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />);
/** The command menu: a keyboard. */
export const KeysIcon = icon(<path d="M2 4.5h12v7H2zM4.5 7h.1M7 7h.1M9.5 7h.1M12 7h.1M5 9.5h6" />);
export const CloseIcon = icon(<path d="m4 4 8 8M12 4l-8 8" />);
export const CheckIcon = icon(<path d="m3 8.5 3 3 7-7" />);
export const FilmIcon = icon(
```

`apps/desktop/src/renderer/editor/SourceView.tsx`:

```
// The source view: while the Zoom or Mask tool is on, or a zoom or mask is selected, the stage shows
// the screen frame at the playhead itself (not the composed video), with every zoom and mask there
// outlined and the selected one with handles. Drag on the frame to draw a new one, drag a box to move
// it, its handles to resize it (a zoom keeps the screen's shape: what is drawn is what it shows).
// Esc goes back to the video.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Rect } from '@cuttle/project';
import type { Command } from '../../shared/document';
import { formatSource } from '../../shared/format';
import { adjustRect, drawnRect, fitInside, toSource, toStage, type Fit, type Handle } from '../../shared/edit';
import { addMask, addZoom, overlayBlocked, playheadPlace } from './actions';
import { edit, preview } from './doc';
import { FrameGrabber } from './frames';
import { currentPlayer, select, setTool, shownProject, sourceViewShown, store } from './session';
import { useStore } from './store';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Smaller drags are clicks, not new boxes. */
const MIN_DRAW = 12;

interface Box {
  kind: 'zoom' | 'mask';
  id: string;
  rect: Rect;
  /** It shows at the playhead's source second (others are drawn faint). */
  here: boolean;
}

export function SourceView() {
  const tool = useStore(store, (state) => state.tool);
  const selection = useStore(store, (state) => state.selection);
  const t = useStore(store, (state) => state.player.t);
  useStore(store, (state) => state.doc?.preview ?? state.doc?.project);
  const media = useStore(store, (state) => state.media);
  // While playing, the video shows (the zooms and masks at work); paused, the source view again.
  const active = useStore(store, sourceViewShown);
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drawing, setDrawing] = useState<Rect>();
  const grabber = useRef<{ grabber: FrameGrabber; source: unknown }>(undefined);

  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);

  const project = active ? shownProject() : undefined;
  const source = active ? playheadPlace(t)?.source : undefined;
  const screen = media?.screen.size ?? { width: 1920, height: 1080 };
  const fit: Fit = fitInside(size.width > 0 ? size : { width: 1, height: 1 }, screen);
  // A selected zoom or mask the playhead is not on shows on the frame where it starts.
  const item = selection?.kind === 'zoom' ? project?.zooms.find((zoom) => zoom.id === selection.id) : selection?.kind === 'mask' ? project?.masks.find((mask) => mask.id === selection.id) : undefined;
  const range = item && ('at' in item ? [item.at, item.at + item.duration] : [item.from, item.to]);
  const frameAt = range && (source === undefined || source < range[0]! || source >= range[1]!) ? range[0] : source;

  // The screen frame at that source second, decoded on its own (the player's frames are the video's).
  useEffect(() => {
    if (!active || frameAt === undefined || size.width === 0) return;
    const player = currentPlayer();
    if (!player) return;
    const video = player.screenSource;
    if (grabber.current?.source !== video) grabber.current = { grabber: new FrameGrabber(video), source: video };
    let cancelled = false;
    void grabber.current.grabber.grab(frameAt).then(
      (held) => {
        if (!held) return;
        try {
          const element = canvas.current;
          if (cancelled || !element) return;
          const ratio = window.devicePixelRatio || 1;
          element.width = Math.round(size.width * ratio);
          element.height = Math.round(size.height * ratio);
          const context = element.getContext('2d')!;
          context.fillStyle = '#08080a';
          context.fillRect(0, 0, element.width, element.height);
          context.drawImage(held.frame, fit.x * ratio, fit.y * ratio, screen.width * fit.scale * ratio, screen.height * fit.scale * ratio);
        } finally {
          held.close();
        }
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [active, frameAt, size.width, size.height, screen.width, screen.height]);

  if (!active || !project) return null;
  const boxes: Box[] = [
    ...project.zooms.map((zoom) => ({ kind: 'zoom' as const, id: zoom.id!, rect: zoom.rect, here: frameAt !== undefined && frameAt >= zoom.at && frameAt < zoom.at + zoom.duration })),
    ...project.masks.map((mask) => ({ kind: 'mask' as const, id: mask.id!, rect: mask.rect, here: frameAt !== undefined && frameAt >= mask.from && frameAt < mask.to })),
  ].filter((box) => box.here || (selection?.kind === box.kind && selection.id === box.id));
  const selected = boxes.find((box) => selection?.kind === box.kind && selection.id === box.id);
  const aspect = screen.width / screen.height;
  const local = (event: { clientX: number; clientY: number }) => {
    const bounds = area.current!.getBoundingClientRect();
    return toSource({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, fit);
  };

  /** Follows a drag from a press: `onMove` with the source-pixel offset, `onEnd` when released (on the window: the box is drawn anew as it moves). */
  const follow = (event: ReactPointerEvent<HTMLElement>, onMove: (dx: number, dy: number, at: { x: number; y: number }) => void, onEnd: (moved: boolean) => void) => {
    event.stopPropagation();
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // a synthetic pointer (the check) has nothing to capture
    }
    const start = local(event);
    let moved = false;
    const move = (next: PointerEvent) => {
      const at = local(next);
      if (!moved && Math.hypot(at.x - start.x, at.y - start.y) * fit.scale < 3) return;
      moved = true;
      onMove(at.x - start.x, at.y - start.y, at);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onEnd(moved);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return start;
  };

  /** A press on a box or one of its handles: select it; drag to move or resize. */
  const pressBox = (event: ReactPointerEvent<HTMLElement>, box: Box) => {
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
        if (!moved || !commands) return preview(undefined);
        edit(commands, handle === 'move' ? `Move the ${box.kind} area` : `Resize the ${box.kind} area`);
      },
    );
  };

  /** A press on the frame: with the Zoom or Mask tool, draw a new one there. */
  const pressFrame = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const kind = tool === 'zoom' || tool === 'mask' ? tool : undefined;
    if (!kind) {
      select(undefined);
      return;
    }
    let rect: Rect | undefined;
    const start = follow(
      event,
      (_dx, _dy, at) => {
        rect = drawnRect(start, at, screen, kind === 'zoom' ? aspect : undefined);
        setDrawing(rect);
      },
      (moved) => {
        setDrawing(undefined);
        if (!moved || !rect || rect[2] * fit.scale < MIN_DRAW || rect[3] * fit.scale < MIN_DRAW) return;
        const whole = rect.map((value) => Math.round(value));
        if (kind === 'zoom') addZoom(whole);
        else addMask(whole);
      },
    );
  };

  const blocked = overlayBlocked(t);
  return (
    <div className="source-view" ref={area} onPointerDown={pressFrame} data-testid="source-view">
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      {selected?.kind === 'zoom' && <ZoomDim fit={fit} rect={selected.rect} size={size} />}
      {boxes.map((box) => {
        const at = toStage(box.rect, fit);
        const isSelected = box === selected;
        return (
          <div
            key={`${box.kind}-${box.id}`}
            className={`source-box ${box.kind}${isSelected ? ' selected' : ''}${box.here ? '' : ' elsewhere'}`}
            style={{ left: at.x, top: at.y, width: at.width, height: at.height }}
            onPointerDown={(event) => pressBox(event, box)}
            data-id={box.id}
            title={box.here ? `${box.kind === 'zoom' ? 'Zoom' : 'Mask'}: drag to move, handles to resize` : `This ${box.kind} is not shown at the playhead`}
          >
            {isSelected && HANDLES.map((handle) => <i key={handle} className={`box-handle ${handle}`} data-handle={handle} />)}
          </div>
        );
      })}
      {drawing && (
        <div className={`source-box ${tool} drawing`} style={(() => {
          const at = toStage(drawing, fit);
          return { left: at.x, top: at.y, width: at.width, height: at.height };
        })()} />
      )}
      <div className="source-chip" role="status" data-testid="source-chip">
        <b>Source view</b>
        {frameAt === undefined
          ? ' · move the playhead onto a clip to see the screen'
          : frameAt !== source
            ? ` · the frame at ${formatSource(frameAt)}, where this ${selection?.kind} starts`
            : tool === 'zoom' || tool === 'mask'
              ? blocked
                ? ` · ${blocked}`
                : ` · drag to draw a ${tool}`
              : ' · drag the box to move it, its handles to resize it'}
        <span className="sep" />
        <kbd>Esc</kbd> for the video
      </div>
      <button
        type="button"
        className="source-close"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          setTool('select');
          if (selection?.kind === 'zoom' || selection?.kind === 'mask') select(undefined);
        }}
      >
        Back to the video
      </button>
    </div>
  );
}

/** Outside a selected zoom's area is dimmed: what stays bright is what the zoom shows. */
function ZoomDim({ fit, rect, size }: { fit: Fit; rect: Rect; size: { width: number; height: number } }) {
  const at = toStage(rect, fit);
  const hole = `polygon(evenodd, 0 0, ${size.width}px 0, ${size.width}px ${size.height}px, 0 ${size.height}px, 0 0, ${at.x}px ${at.y}px, ${at.x + at.width}px ${at.y}px, ${at.x + at.width}px ${at.y + at.height}px, ${at.x}px ${at.y + at.height}px, ${at.x}px ${at.y}px)`;
  return <div className="zoom-dim" style={{ clipPath: hole }} />;
}
```

`apps/desktop/src/renderer/editor/CommandMenu.tsx`:

```
// The command menu (Ctrl+K, or ?): everything the editor can do, by name, with its keys. Type to
// filter, arrows to choose, Enter to run; what cannot run now says why.
import { useEffect, useMemo, useRef, useState } from 'react';
import { editorCommands, type EditorCommand } from './commands';
import { store } from './session';
import { useStore } from './store';

export function openMenu(): void {
  if (store.get().phase === 'ready' && !store.get().exportOpen) store.set({ menuOpen: true });
}

export function closeMenu(): void {
  store.set({ menuOpen: false });
}

/** Every word typed is somewhere in the command's name, group or keys. */
function matches(command: EditorCommand, query: string): boolean {
  const haystack = `${command.name} ${command.group} ${command.keys ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function CommandMenu() {
  const open = useStore(store, (state) => state.menuOpen);
  if (!open) return null;
  return <Menu />;
}

function Menu() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // The commands as they are when the menu opens (their names say what Undo would undo).
  const commands = useMemo(() => editorCommands().map((command) => ({ command, blocked: command.blocked?.() })), []);
  const shown = commands.filter(({ command }) => matches(command, query));
  const runnable = shown.filter((item) => !item.blocked);
  const current = runnable[Math.min(active, runnable.length - 1)];

  // The focus goes back where it was when the menu closes.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    return () => before?.focus();
  }, []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current?.command.id]);

  const run = (command: EditorCommand) => {
    closeMenu();
    // after the menu is gone, so a command that moves the focus (Speed…) keeps it
    requestAnimationFrame(() => command.run());
  };

  const onKey = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (runnable.length === 0) return;
      const at = Math.min(active, runnable.length - 1);
      setActive((at + (event.key === 'ArrowDown' ? 1 : runnable.length - 1)) % runnable.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (current) run(current.command);
    }
  };

  let group = '';
  return (
    <div className="menu-scrim" onPointerDown={closeMenu}>
      <div className="command-menu" role="dialog" aria-label="Commands" onPointerDown={(event) => event.stopPropagation()} onKeyDown={onKey}>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a command (split, zoom, undo…)"
          aria-label="Command"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          aria-activedescendant={current ? `command-${current.command.id}` : undefined}
          data-testid="command-input"
        />
        <div className="command-list" id="command-list" role="listbox" ref={list}>
          {shown.length === 0 && <p className="hint">No command has “{query}” in it.</p>}
          {shown.map(({ command, blocked }) => {
            const heading = command.group !== group ? (group = command.group) : undefined;
            const isActive = command.id === current?.command.id;
            return (
              <div key={command.id}>
                {heading && <div className="command-group">{heading}</div>}
                <div
                  id={`command-${command.id}`}
                  className="command"
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={!!blocked}
                  data-active={isActive}
                  onPointerMove={() => {
                    const index = runnable.findIndex((item) => item.command.id === command.id);
                    if (index >= 0 && index !== active) setActive(index);
                  }}
                  onClick={() => !blocked && run(command)}
                >
                  <span className="command-name">{command.name}</span>
                  {blocked ? <em>{blocked}</em> : command.keys && <kbd>{command.keys}</kbd>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="command-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> choose
          </span>
          <span>
            <kbd>Enter</kbd> run
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
```

`apps/desktop/src/renderer/editor/App.tsx`:

```
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from 'react';
import type { Rect } from '@cuttle/project';
import { formatDuration, formatSource, formatTime, plainIssue } from '../../shared/format';
import type { MediaState } from '../../shared/ipc';
import { bridge } from '../bridge';
import {
  ChevronIcon,
  CloseIcon,
  ExportIcon,
  FolderIcon,
  KeysIcon,
  Mark,
  MaskIcon,
  PauseIcon,
  PlayIcon,
  RecordIcon,
  RedoIcon,
  SelectIcon,
  TextIcon,
  UndoIcon,
  WarningIcon,
  ZoomIcon,
} from '../icons';
import { captionCommand, chooseTool, freeCaptionPosition, deleteSelection, duplicateSelection, overlayBlocked, reveal, split, type CaptionPosition } from './actions';
import { CommandMenu, closeMenu, openMenu } from './CommandMenu';
import { dismissToast, edit, preview, redo, retrySave, undo, useDraft } from './doc';
import { ExportSheet } from './ExportSheet';
import { Inspector } from './Inspector';
import { SourceView } from './SourceView';
import { currentPlayer, documentProject, openExport, openSession, retryMedia, select, setFormat, setTool, shownProject, sourceViewShown, store, type Tool } from './session';
import { useStore } from './store';
import { FORMATS, ownFormat, targetName } from './targets';
import { Timeline } from './Timeline';

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = useStore(store, (state) => state.phase);
  const tool = useStore(store, (state) => state.tool);

  useEffect(() => {
    if (canvas.current) void openSession(canvas.current);
  }, []);
  useShortcuts();

  if (phase === 'failed') return <Failed />;
  return (
    <div className="app" data-phase={phase} data-tool={tool}>
      <TitleBar />
      <Tools />
      <Stage canvas={canvas} />
      <Timeline />
      <Inspector />
      <ExportSheet />
      <CommandMenu />
      {phase === 'loading' && (
        <div className="loading">
          <div className="spinner" role="status" aria-label="Opening the project" />
        </div>
      )}
    </div>
  );
}

/** A project that cannot be opened: what is wrong in plain lines, with the title bar (the window can still be moved) and a way on. */
function Failed() {
  const error = useStore(store, (state) => state.error) ?? '';
  return (
    <div className="app failed" data-phase="failed">
      <TitleBar />
      <main className="failed-view">
        <div role="alert">
          <WarningIcon size={28} style={{ color: 'var(--card)' }} />
          <h1>This project can't be opened</h1>
          <p>{error.split('\n').map(plainIssue).join('\n')}</p>
          <div className="actions">
            <button className="ghost" onClick={() => void bridge.invoke('project:reveal')}>
              <FolderIcon size={14} />
              Show the folder
            </button>
            <button className="primary" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function TitleBar() {
  const phase = useStore(store, (state) => state.phase);
  const info = useStore(store, (state) => state.info);
  const media = useStore(store, (state) => state.media);
  const status = useStore(store, (state) => state.status);
  useStore(store, (state) => state.doc?.project);
  const duration = currentPlayer()?.duration ?? 0;
  const recorded = media ? media.screen.end - media.screen.start : 0;
  return (
    <header className="titlebar">
      <Mark />
      <div className="project-name">
        <b>{info?.name ?? 'Cuttle'}</b>
        {media && (
          <span>
            {formatDuration(recorded)} recorded · {formatDuration(duration)} video
          </span>
        )}
      </div>
      {phase === 'ready' && <SaveState />}
      <div className="grow" />
      {status?.state === 'failed' ? (
        <button className="chip-status warn" onClick={() => void bridge.invoke('project:cut')} title={`${status.text}. Click to try again.`} data-testid="project-status">
          <WarningIcon size={14} />
          <span className="chip-text">The take could not be cut</span> · Try again
        </button>
      ) : (
        status && (
          <div className="chip-status" role="status" data-testid="project-status" title={status.text}>
            <span className="spinner small" aria-hidden="true" />
            <span className="chip-text">{status.text}</span>
          </div>
        )
      )}
      {phase === 'ready' && (
        <>
          <MediaChip />
          <ExportChip />
          <FormatSwitch />
          <History />
          <div className="seg" role="group" aria-label="Takes">
            <button onClick={() => void bridge.invoke('project:record')} title="Record a new take for this project; this one stays restorable" data-testid="record-again">
              <RecordIcon size={10} style={{ color: 'var(--recording)', display: 'inline-block', marginRight: 6, verticalAlign: -1 }} />
              Record again
            </button>
            <button onClick={() => void bridge.invoke('project:takes')} title="Earlier takes of this project" aria-label="Takes">
              <ChevronIcon size={13} />
            </button>
          </div>
          <button className="primary" onClick={openExport} title="Export (Ctrl+E)">
            <ExportIcon size={14} />
            Export
          </button>
        </>
      )}
    </header>
  );
}

/** Undo and Redo: their tooltips say what they undo and redo (off while cuttle.json has a mistake). */
function History() {
  const undoLabel = useStore(store, (state) => (state.doc?.issues ? undefined : state.doc?.undoLabel));
  const redoLabel = useStore(store, (state) => (state.doc?.issues ? undefined : state.doc?.redoLabel));
  return (
    <div className="seg icons" role="group" aria-label="History">
      <button onClick={undo} disabled={!undoLabel} title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'} aria-label={undoLabel ? `Undo ${undoLabel}` : 'Undo'} data-testid="undo">
        <UndoIcon size={14} />
      </button>
      <button onClick={redo} disabled={!redoLabel} title={redoLabel ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'} aria-label={redoLabel ? `Redo ${redoLabel}` : 'Redo'} data-testid="redo">
        <RedoIcon size={14} />
      </button>
    </div>
  );
}

/** "Saved", "Saving…" (only when it takes a moment), or why it is not, with a retry. */
function SaveState() {
  const saving = useStore(store, (state) => state.doc?.saving ?? false);
  const problem = useStore(store, (state) => state.doc?.problem);
  const issues = useStore(store, (state) => state.doc?.issues);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!saving) return setSlow(false);
    const timer = setTimeout(() => setSlow(true), 400);
    return () => clearTimeout(timer);
  }, [saving]);
  if (problem)
    return (
      <button className="chip-status warn" onClick={retrySave} title={`${problem}\nClick to try again.`} data-testid="save-state">
        <WarningIcon size={14} />
        Not saved · Try again
      </button>
    );
  if (issues)
    return (
      <span className="save-state warn" title="cuttle.json has a mistake; see the note over the video" data-testid="save-state">
        Editing waits
      </span>
    );
  return (
    <span className="save-state" title="Every edit is written to cuttle.json at once; Claude and the CLI see it too" data-testid="save-state">
      {slow ? 'Saving…' : 'Saved'}
    </span>
  );
}

const MEDIA_NAMES: Record<Exclude<keyof MediaState, 'seq'>, string> = { proxy: 'smooth-playback copy', thumbnails: 'thumbnails', peaks: 'waveform' };

/** The background media: progress of the proxy, or what failed with a retry. */
function MediaChip() {
  const mediaState = useStore(store, (state) => state.mediaState);
  const failed = (Object.keys(MEDIA_NAMES) as (keyof typeof MEDIA_NAMES)[]).filter((kind) => mediaState[kind].state === 'failed');
  if (failed.length > 0) {
    const messages = failed.map((kind) => mediaState[kind].message ?? '');
    const noFfmpeg = messages.some((message) => /ffmpeg/i.test(message) && /ENOENT|not found/i.test(message));
    const names = failed.map((kind) => MEDIA_NAMES[kind]);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
    return (
      <button
        className="chip-status warn"
        onClick={retryMedia}
        title={
          noFfmpeg
            ? 'Cuttle makes these with ffmpeg, and ffmpeg was not found. Install it (winget install Gyan.FFmpeg), then click to try again. Playback and export work without them.'
            : `${messages.filter(Boolean).join('\n')}\nPlayback and export work without them. Click to try again.`
        }
      >
        <WarningIcon size={14} />
        {noFfmpeg ? 'ffmpeg not found' : `No ${list}`} · Try again
      </button>
    );
  }
  const proxy = mediaState.proxy;
  if (proxy.state !== 'working') return null;
  const percent = Math.round((proxy.progress ?? 0) * 100);
  return (
    <div className="chip-status" title="A smaller copy of the take, so playback stays smooth in long takes. Playback already works; the export always uses the take.">
      Making a smooth-playback copy · {percent}%
      <span className="bar">
        <i style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

/** A running export, or one that ended while the sheet was closed: reopens the sheet. */
function ExportChip() {
  const open = useStore(store, (state) => state.exportOpen);
  const exporting = useStore(store, (state) => state.exporting);
  const unseen = useStore(store, (state) => state.exportUnseen);
  const progress = useStore(store, (state) => state.exportProgress);
  const end = useStore(store, (state) => state.exportEnd);
  const output = useStore(store, (state) => state.doc?.project.output);
  if (open) return null;
  if (exporting) {
    const percent = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
    return (
      <button className="chip-status" onClick={openExport} title="Show the export (Ctrl+E)">
        Exporting {progress ? targetName(progress.format, output) : ''} · {percent}%
        <span className="bar">
          <i style={{ width: `${percent}%` }} />
        </span>
      </button>
    );
  }
  if (!unseen || !end) return null;
  if (end.state === 'done')
    return (
      <button className="chip-status done" onClick={openExport} title="Show the exported files">
        Exported · Show
      </button>
    );
  if (end.state === 'failed')
    return (
      <button className="chip-status warn" onClick={openExport} title="Show what went wrong">
        <WarningIcon size={14} />
        Export failed · Details
      </button>
    );
  return null;
}

/** The preview's output format: the project's own size first (marked inside its preset when it is one), then the presets. */
function FormatSwitch() {
  const format = useStore(store, (state) => state.format);
  const output = useStore(store, (state) => state.doc?.project.output);
  const own = ownFormat(output);
  return (
    <div className="seg" role="group" aria-label="Preview format">
      {!own && output && (
        <button aria-pressed={format === undefined} onClick={() => setFormat(undefined)} title={`The project's own size, ${output.width}×${output.height}`}>
          Project
        </button>
      )}
      {FORMATS.map((name) => (
        <button
          key={name}
          aria-pressed={format === name || (format === undefined && own === name)}
          onClick={() => setFormat(name === own ? undefined : name)}
          title={name === own ? `${name}, the project's own size` : `Preview as ${name}`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

const TOOLS: { tool: Tool; Icon: ComponentType<{ size?: number }>; name: string; keys: string; hint: string }[] = [
  { tool: 'select', Icon: SelectIcon, name: 'Select', keys: 'V', hint: 'click a caption on the video, or anything on the timeline' },
  { tool: 'zoom', Icon: ZoomIcon, name: 'Zoom', keys: 'Z', hint: 'drag over what the video should show close up' },
  { tool: 'mask', Icon: MaskIcon, name: 'Mask', keys: 'M', hint: 'drag over what the video should hide (a password, an address…)' },
  { tool: 'caption', Icon: TextIcon, name: 'Caption', keys: 'T', hint: 'type a caption on the video at the playhead' },
];

/** The tools, beside the video: they decide what a drag or click on the video does. */
function Tools() {
  const tool = useStore(store, (state) => state.tool);
  const ready = useStore(store, (state) => state.phase === 'ready' && !state.doc?.issues);
  // where the playhead is decides whether a zoom, mask or caption can go there
  useStore(store, (state) => Math.round(state.player.t * 30));
  useStore(store, (state) => state.doc?.project);
  const blocked = ready ? overlayBlocked() : undefined;
  return (
    <nav className="tools" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {TOOLS.map(({ tool: name, Icon, name: label, keys, hint }) => {
        // the tool in use stays pressable, to turn it off
        const off = !ready || (name !== 'select' && blocked !== undefined && tool !== name);
        return (
          <button
            key={name}
            aria-pressed={tool === name}
            disabled={off}
            onClick={() => setTool(tool === name && name !== 'select' ? 'select' : name)}
            title={`${label} (${keys}): ${off && blocked ? blocked : hint}`}
            aria-label={label}
            data-testid={`tool-${name}`}
          >
            <Icon size={17} />
            <kbd>{keys}</kbd>
          </button>
        );
      })}
      <div className="grow" />
      <button onClick={openMenu} disabled={!ready} title="Every command and its keys (Ctrl+K)" aria-label="Commands" data-testid="open-menu">
        <KeysIcon size={17} />
      </button>
    </nav>
  );
}

function Stage({ canvas }: { canvas: React.RefObject<HTMLCanvasElement | null> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const error = useStore(store, (state) => state.player.error);
  const media = useStore(store, (state) => state.media);
  const format = useStore(store, (state) => state.format);
  const issues = useStore(store, (state) => state.doc?.issues);
  const sourceView = useStore(store, sourceViewShown);
  useStore(store, (state) => state.doc?.preview ?? state.doc?.project);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dismissed, setDismissed] = useState<string>();
  const project = shownProject();
  const output = project?.output ?? { width: 1920, height: 1080 };

  // The canvas keeps the output's size (the engine draws at it); CSS fits it into the viewport.
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const fit = () => {
      const box = element.getBoundingClientRect();
      const scale = Math.min(box.width / output.width, box.height / output.height);
      setSize({ width: Math.floor(output.width * scale), height: Math.floor(output.height * scale) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [output.width, output.height, format]);

  const warning = error ?? media?.warnings[0];
  const more = error ? 0 : Math.max(0, (media?.warnings.length ?? 0) - 1);
  return (
    <main className="stage">
      {issues ? (
        <IssuesBanner issues={issues} />
      ) : (
        warning &&
        warning !== dismissed &&
        // the source view says what it shows in the same place
        !sourceView && (
          <div className={`stage-note${error ? ' warn' : ''}`} title={error ? warning : media?.warnings.join('\n')} role="status">
            <WarningIcon size={14} />
            <span>
              {warning}
              {more > 0 && ` (and ${more} more)`}
            </span>
            <button onClick={() => setDismissed(warning)} aria-label="Dismiss" title="Dismiss">
              <CloseIcon size={11} />
            </button>
          </div>
        )
      )}
      <div className="viewport" ref={viewport}>
        <VideoFrame canvas={canvas} size={size} output={output} />
        <SourceView />
      </div>
      <ToastNote />
      <Transport />
    </main>
  );
}

const bandOf = (y: number): CaptionPosition => (y < 1 / 3 ? 'top' : y > 2 / 3 ? 'bottom' : 'center');

/**
 * The video, with what the tools do on it: Select picks a caption by clicking it (a double click
 * edits its text), Caption types a new one where it is clicked.
 */
function VideoFrame({ canvas, size, output }: { canvas: React.RefObject<HTMLCanvasElement | null>; size: { width: number; height: number }; output: { width: number; height: number } }) {
  const tool = useStore(store, (state) => state.tool);
  const selection = useStore(store, (state) => state.selection);
  // every frame the player draws (a seek to the same second after an edit too): the captions' boxes are its
  const drawnFrame = useStore(store, (state) => state.player);
  const [hover, setHover] = useState<string>();
  const [position, setPosition] = useState<CaptionPosition>('bottom');
  const scale = size.width > 0 ? size.width / output.width : 0;
  // a new caption goes where none is shown at the playhead (they would cover each other)
  useEffect(() => {
    if (tool === 'caption') setPosition(freeCaptionPosition());
  }, [tool]);

  /** The caption drawn under the pointer, by the boxes the last frame drew them in. */
  const captionAt = (event: { clientX: number; clientY: number }) => {
    const bounds = canvas.current?.getBoundingClientRect();
    if (!bounds || scale === 0) return undefined;
    const x = (event.clientX - bounds.left) / scale;
    const y = (event.clientY - bounds.top) / scale;
    const drawn = currentPlayer()?.drawnTexts() ?? [];
    return drawn.findLast(({ rect }) => x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3]);
  };

  const press = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    if (tool === 'caption') {
      const bounds = event.currentTarget.getBoundingClientRect();
      setPosition(bandOf((event.clientY - bounds.top) / bounds.height));
      return;
    }
    const hit = captionAt(event);
    if (hit?.overlay.id) select({ kind: 'caption', id: hit.overlay.id });
    else if (selection?.kind === 'caption') select(undefined);
  };

  // The boxes of the captions on the frame now: the selected one outlined, the one under the pointer too.
  void drawnFrame;
  const drawn = scale > 0 && tool === 'select' ? (currentPlayer()?.drawnTexts() ?? []) : [];
  const outlined = drawn.filter(({ overlay }) => overlay.id && (overlay.id === hover || (selection?.kind === 'caption' && selection.id === overlay.id)));
  const toStage = (rect: Rect) => ({ left: rect[0] * scale - 3, top: rect[1] * scale - 3, width: rect[2] * scale + 6, height: rect[3] * scale + 6 });

  return (
    <div className="frame" style={{ width: size.width || undefined, height: size.height || undefined }}>
      <canvas
        ref={canvas}
        data-testid="output"
        className={hover && tool === 'select' ? 'over-caption' : undefined}
        style={{ width: size.width || undefined, height: size.height || undefined }}
        onPointerDown={press}
        onPointerMove={(event) => tool === 'select' && setHover(captionAt(event)?.overlay.id)}
        onPointerLeave={() => setHover(undefined)}
        onDoubleClick={(event) => {
          if (tool !== 'select' || !captionAt(event)) return;
          requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="caption-text"]')?.focus());
        }}
      />
      {outlined.map(({ overlay, rect }) => (
        <div key={overlay.id} className={`caption-box${selection?.id === overlay.id ? ' selected' : ''}`} style={toStage(rect)} />
      ))}
      {tool === 'caption' && <CaptionBar position={position} onPosition={setPosition} />}
    </div>
  );
}

const POSITIONS: { position: CaptionPosition; name: string }[] = [
  { position: 'top', name: 'Top' },
  { position: 'center', name: 'Middle' },
  { position: 'bottom', name: 'Bottom' },
];

/**
 * The caption tool: type the caption on the video; the video shows it as it will be while typing.
 * Enter adds it at the playhead (and selects it), Esc goes back without one.
 */
function CaptionBar({ position, onPosition }: { position: CaptionPosition; onPosition: (position: CaptionPosition) => void }) {
  const t = useStore(store, (state) => Math.round(state.player.t * 30));
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  void t;
  const blocked = overlayBlocked();

  useEffect(() => {
    if (!blocked) input.current?.focus();
  }, [blocked]);
  // While typing, the video shows the caption (not saved, not in the history).
  useEffect(() => {
    const command = text.trim() ? captionCommand(text, position) : undefined;
    preview(command && [command]);
  }, [text, position, blocked]);
  useEffect(() => () => preview(undefined), []);

  const add = () => {
    const command = captionCommand(text.trim(), position);
    if (!text.trim() || !command) return;
    // the document as saved: the preview while typing has the new caption (with the id it gets) already
    const before = new Set(documentProject()?.texts.map((item) => item.id));
    if (!edit([command], 'Add caption')) return;
    const added = store.get().doc?.project.texts.find((item) => !before.has(item.id));
    setText('');
    setTool('select');
    if (added?.id) select({ kind: 'caption', id: added.id });
  };

  return (
    // away from where the caption goes, so the caption shows while it is typed
    <div className={`caption-bar ${position === 'top' ? 'near-bottom' : 'near-top'}`} onPointerDown={(event) => event.stopPropagation()}>
      <input
        ref={input}
        value={text}
        disabled={!!blocked}
        placeholder={blocked ?? 'Type the caption; Enter adds it at the playhead'}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            add();
          }
          if (event.key === 'Escape') setTool('select');
        }}
        aria-label="Caption"
        data-testid="caption-input"
      />
      <div className="seg" role="group" aria-label="Where the caption goes">
        {POSITIONS.map((item) => (
          <button key={item.position} type="button" aria-pressed={position === item.position} onClick={() => onPosition(item.position)}>
            {item.name}
          </button>
        ))}
      </div>
      <button type="button" className="primary small" onClick={add} disabled={!text.trim() || !!blocked}>
        Add
      </button>
    </div>
  );
}

/** cuttle.json on disk does not parse: editing waits, and says what to fix. */
function IssuesBanner({ issues }: { issues: string[] }) {
  return (
    <div className="banner" role="alert" data-testid="issues">
      <WarningIcon size={16} />
      <div>
        <b>cuttle.json has a mistake, so editing here waits.</b>
        <p>Fix it in a text editor or ask Claude: the editor takes the fixed file by itself. The video shows the last version that worked.</p>
        <ul>
          {issues.slice(0, 3).map((issue) => (
            <li key={issue}>{plainIssue(issue)}</li>
          ))}
          {issues.length > 3 && <li>and {issues.length - 3} more</li>}
        </ul>
      </div>
      <button className="ghost small" onClick={() => void bridge.invoke('project:reveal')}>
        <FolderIcon size={13} />
        Show the folder
      </button>
    </div>
  );
}

/** What just happened (an outside change, a cut by suggest, an edit that was not possible), with Undo where it applies. */
function ToastNote() {
  const toast = useStore(store, (state) => state.doc?.toast);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    // a choice to make (a draft) stays until it is made or dismissed
    if (!toast || held || toast.draft) return;
    const timer = setTimeout(dismissToast, toast.tone === 'warning' ? 9000 : 6000);
    return () => clearTimeout(timer);
  }, [toast?.id, held]);
  if (!toast) return null;
  return (
    <div className={`toast${toast.tone === 'warning' ? ' warn' : ''}`} role="status" aria-live="polite" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)} data-testid="toast" key={toast.id}>
      {toast.tone === 'warning' && <WarningIcon size={14} />}
      <span title={toast.text}>{toast.text}</span>
      {toast.draft && (
        <button className="toast-undo" onClick={useDraft} title="Put your version back (one step to undo)" data-testid="toast-use-draft">
          Use mine
        </button>
      )}
      {toast.show && (
        <button className="toast-undo" onClick={() => reveal(toast.show!.list, toast.show!.id)} data-testid="toast-show">
          Show
        </button>
      )}
      {toast.undo && (
        <button className="toast-undo" onClick={undo} data-testid="toast-undo">
          Undo
        </button>
      )}
      <button className="toast-close" onClick={dismissToast} aria-label="Dismiss" title="Dismiss">
        <CloseIcon size={11} />
      </button>
    </div>
  );
}

function Transport() {
  const playing = useStore(store, (state) => state.player.playing);
  const t = useStore(store, (state) => state.player.t);
  const source = useStore(store, (state) => state.player.source);
  const duration = currentPlayer()?.duration ?? 0;
  return (
    <div className="transport">
      <button className="play" onClick={() => currentPlayer()?.toggle()} aria-label={playing ? 'Pause (Space)' : 'Play (Space)'} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
      </button>
      <span className="time tabular" data-testid="time">
        <b>{formatTime(t)}</b> / {formatTime(duration)}
        {source !== undefined && <em>{formatSource(source)}</em>}
      </span>
    </div>
  );
}

/** Keys that repeat while held (a frame or a second at a time); the others act once per press. */
const REPEATING = new Set(['ArrowLeft', 'ArrowRight']);

/**
 * The editor's keys (the command menu lists them): Space (K pauses, L plays, J a second back),
 * arrows (Shift: a second), Home/End, S split, Delete, Ctrl+D, R speed, V/Z/M/T tools, Shift+Z
 * fit, Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y, Ctrl+K or ? the menu, Ctrl+E export, Esc back out. Typing in a
 * field, and Space or Enter on a focused button outside the timeline, keep their own meaning.
 */
function useShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const command = (event.ctrlKey || event.metaKey) && !event.altKey;
      const { phase, exportOpen, menuOpen } = store.get();
      if (phase !== 'ready') return;
      // Ctrl+K opens the menu from anywhere, a field too (the menu closes itself on it)
      if (command && key === 'k' && !menuOpen) {
        event.preventDefault();
        if (!event.repeat) openMenu();
        return;
      }
      if (menuOpen || target?.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      if (command && key === 'e') {
        event.preventDefault();
        if (!event.repeat) openExport();
        return;
      }
      if (exportOpen) return;
      if (command) {
        const edits: Record<string, () => void> = {
          z: () => (event.shiftKey ? redo() : undo()),
          y: redo,
          d: duplicateSelection,
        };
        const action = edits[key];
        if (!action) return;
        event.preventDefault();
        action();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.key === ' ' || event.key === 'Enter') && target?.closest('button, [role="tab"]') && !target.closest('.timeline')) return;
      const player = currentPlayer();
      if (!player) return;
      const { t } = player.current();
      const frame = 1 / player.fps;
      const keys: Record<string, () => void> = {
        ' ': () => player.toggle(),
        k: () => player.pause(),
        l: () => player.play(),
        j: () => void player.seek(t - 1),
        ArrowLeft: () => void player.seek(t - (event.shiftKey ? 1 : frame)),
        ArrowRight: () => void player.seek(t + (event.shiftKey ? 1 : frame)),
        Home: () => void player.seek(0),
        End: () => void player.seek(player.duration),
        Escape: backOut,
        s: split,
        Delete: deleteSelection,
        Backspace: deleteSelection,
        r: () => document.querySelector<HTMLSelectElement>('#speed-select')?.focus(),
        v: () => setTool('select'),
        // Shift+Z: the whole video in the timeline
        z: () => (event.shiftKey ? store.set({ pxPerSecond: 0 }) : chooseTool('zoom')),
        m: () => chooseTool('mask'),
        t: () => chooseTool('caption'),
        '?': openMenu,
      };
      const action = keys[key];
      if (!action) return;
      event.preventDefault();
      if (event.repeat && !REPEATING.has(key)) return;
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Esc: out of the source view (the tool and a zoom or mask selected), else out of a tool, else the selection. */
function backOut(): void {
  const { tool, selection } = store.get();
  closeMenu();
  const inSource = tool === 'zoom' || tool === 'mask' || selection?.kind === 'zoom' || selection?.kind === 'mask';
  if (tool !== 'select') setTool('select');
  if (inSource || tool === 'select') select(undefined);
}
```

`apps/desktop/src/renderer/editor/Timeline.tsx`:

```
// The timeline: markers, ruler, scenes with thumbnails, the overlay lanes (one block per stretch of
// output that shows an overlay, overlapping ones on separate rows), the mic's waveform and input
// activity. The ruler, the markers and empty lanes scrub; a click on a block selects it (and moves
// the playhead there); a drag edits: a scene's edges trim it and its body moves it among the
// scenes; an overlay's body moves it and its edges change its length (Alt: a copy). Drags snap to
// the playhead, scene edges, markers and other overlays (Ctrl: only to frames). Edits ripple: the
// scenes after move. The wheel scrolls along, Shift+wheel up and down, Ctrl+wheel zooms.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { CuttleProject, MarkerKind } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import type { Command, OverlayList } from '../../shared/document';
import { dragRange, overlayRange, rangeFields, snapTime } from '../../shared/edit';
import { formatTime } from '../../shared/format';
import {
  activityColumns,
  groupPins,
  pinGroupDetail,
  pinGroupName,
  timelineModel,
  waveformColumns,
  type OverlayBlock,
  type OverlayKind,
  type Peaks,
  type SceneBlock,
  type TimelineModel,
} from '../../shared/timeline-model';
import { FitIcon } from '../icons';
import { addCard, addMask, addPage, addZoom, overlayBlocked, selectedOrCurrentClip, setSpeed, split, SPEEDS } from './actions';
import { audible } from './audio';
import { edit, preview } from './doc';
import { mediaUrl } from './media';
import { currentPlayer, select, setTool, shownProject, store, type Selection } from './session';
import { useStore } from './store';

const END_SPACE = 40;
/** A row of an overlay lane (lanes grow a row for overlays that overlap in time). */
const ROW = 22;
const BASE_ROWS = { markers: 26, ruler: 20, video: 52, mic: 30, input: 26 } as const;
const LANES: { kind: OverlayKind; name: string; list: OverlayList }[] = [
  { kind: 'zoom', name: 'Zoom', list: 'zooms' },
  { kind: 'mask', name: 'Mask', list: 'masks' },
  { kind: 'caption', name: 'Caption', list: 'texts' },
];
const NOUN: Record<OverlayKind, string> = { zoom: 'zoom', mask: 'mask', caption: 'caption' };
const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MAX_PPS = 400;
/** A pointer that moves less than this between down and up clicked (selects); more drags. */
const DRAG_PX = 3;
/** Labels hide on blocks narrower than this. */
const LABEL_MIN_PX = 48;
/** How near (px) a dragged edge comes to a target before it snaps. */
const SNAP_PX = 6;

/**
 * Until when the playhead was last moved with the pointer (performance.now()): the view does not
 * follow those seeks, or a drag near an edge would scroll the content under the pointer and run away.
 */
let pointerSeekUntil = 0;

const MARKER_DOT: Record<MarkerKind, string> = { prompt: '#ececf1', tool: '#7a7a85', answer: '#4fd1a1', manual: '#9a9aa5' };

interface Layout {
  heights: Record<'markers' | 'ruler' | 'video' | OverlayKind | 'mic' | 'input', number>;
  tops: Record<'markers' | 'ruler' | 'video' | OverlayKind | 'mic' | 'input', number>;
  total: number;
}

function layoutOf(model: TimelineModel | undefined): Layout {
  const heights = {
    ...BASE_ROWS,
    zoom: 8 + ROW * (model?.lanes.zoom.rows ?? 1),
    mask: 8 + ROW * (model?.lanes.mask.rows ?? 1),
    caption: 8 + ROW * (model?.lanes.caption.rows ?? 1),
  };
  const order = ['markers', 'ruler', 'video', 'zoom', 'mask', 'caption', 'mic', 'input'] as const;
  const tops = {} as Layout['tops'];
  let y = 0;
  for (const row of order) {
    tops[row] = y;
    y += heights[row];
  }
  return { heights, tops, total: y };
}

/** The colour of the waveform and activity bars (the `--bars` token). */
const BARS = '#5c5c68';

/** A drag under way: where a snapped edge lines up (a guide), where a moved scene would go. */
interface DragView {
  guide?: number;
  insertAt?: number;
}

export function Timeline() {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const media = useStore(store, (state) => state.media);
  useStore(store, (state) => state.doc?.preview ?? state.doc?.project);
  useStore(store, (state) => state.format);
  const pps = useStore(store, (state) => state.pxPerSecond);
  const selection = useStore(store, (state) => state.selection);
  const snapOn = useStore(store, (state) => state.snap);
  const peaksState = useStore(store, (state) => state.mediaState.peaks.state);
  const peaksPath = useStore(store, (state) => state.mediaState.peaks.path);
  const peaksRate = useStore(store, (state) => state.mediaState.peaks.rate);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [peaks, setPeaks] = useState<Peaks>();
  const [drag, setDrag] = useState<DragView>({});
  // The overlay under the pointer: its other blocks (other clips that show it) light up with it.
  const [hovered, setHovered] = useState<string>();
  // The lane whose cut-out overlays are listed, and where its label is on screen.
  const [cutOutList, setCutOutList] = useState<{ kind: OverlayKind; left: number; top: number }>();

  const project = shownProject();
  const spans = useMemo(() => (project ? sceneSpans(project.scenes) : []), [project]);
  const duration = spans.at(-1)?.end ?? 0;
  const model = useMemo(() => (project ? timelineModel(project, spans, media?.markers) : undefined), [project, spans, media]);
  const layout = useMemo(() => layoutOf(model), [model]);

  const fit = useCallback(() => {
    const element = scroller.current;
    if (!element || !(duration > 0)) return;
    store.set({ pxPerSecond: Math.max(0.01, (element.clientWidth - END_SPACE - 8) / duration) });
    element.scrollLeft = 0;
  }, [duration]);

  useLayoutEffect(() => {
    if (pps === 0 && duration > 0) fit();
  }, [pps, duration, fit]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => setView({ left: element.scrollLeft, width: element.clientWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    const onWheel = (event: WheelEvent) => {
      if (event.shiftKey) {
        event.preventDefault();
        if (body.current) body.current.scrollTop += event.deltaY || event.deltaX;
        return;
      }
      const current = store.get().pxPerSecond;
      if (event.ctrlKey || event.altKey) {
        event.preventDefault();
        const project = shownProject();
        const length = project ? (sceneSpans(project.scenes).at(-1)?.end ?? 0) : 0;
        const fitPps = length > 0 ? (element.clientWidth - END_SPACE - 8) / length : current;
        const box = element.getBoundingClientRect();
        const anchorX = event.clientX - box.left;
        const anchorT = (element.scrollLeft + anchorX) / current;
        const next = Math.min(MAX_PPS, Math.max(fitPps, current * Math.exp(-event.deltaY * 0.002)));
        store.set({ pxPerSecond: next });
        requestAnimationFrame(() => (element.scrollLeft = Math.max(0, anchorT * next - anchorX)));
        return;
      }
      if (event.deltaX === 0 && event.deltaY !== 0) {
        event.preventDefault();
        element.scrollLeft += event.deltaY;
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
      element.removeEventListener('wheel', onWheel);
    };
  }, []);

  // The mic's peaks, once the worker has made them.
  useEffect(() => {
    if (peaksState !== 'ready' || !peaksPath || !peaksRate || !media?.mic) return;
    let cancelled = false;
    void fetch(mediaUrl(peaksPath))
      .then((response) => (response.ok ? response.arrayBuffer() : undefined))
      .then((buffer) => {
        if (!cancelled && buffer) setPeaks({ rate: peaksRate, offset: media.mic!.offset, data: new Uint8Array(buffer) });
      });
    return () => {
      cancelled = true;
    };
  }, [peaksState, peaksPath, peaksRate, media]);

  const timeAt = (clientX: number) => {
    const element = scroller.current!;
    const box = element.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (clientX - box.left + element.scrollLeft) / pps));
  };

  const seekTo = (t: number) => {
    pointerSeekUntil = performance.now() + 1000;
    void currentPlayer()?.seek(t);
  };

  /**
   * Follows a pointer from a press on `event`'s element: `onMove` with the horizontal distance
   * (px) once it moved more than a click would, `onEnd` with whether it moved. It listens on the
   * window: the pressed element may be drawn anew while it is dragged.
   */
  const follow = (event: ReactPointerEvent<HTMLElement>, onMove: (dx: number, moved: PointerEvent) => void, onEnd: (moved: boolean, last: PointerEvent | undefined) => void) => {
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // a synthetic pointer (the check) has nothing to capture
    }
    const startX = event.clientX;
    let dragging = false;
    let last: PointerEvent | undefined;
    const move = (moved: PointerEvent) => {
      if (!dragging && Math.abs(moved.clientX - startX) < DRAG_PX) return;
      dragging = true;
      last = moved;
      onMove(moved.clientX - startX, moved);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onEnd(dragging, last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** Scrubs from a press on the ruler, the markers or an empty lane (a click on an empty lane clears the selection). */
  const scrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const onLane = !(event.target as HTMLElement).closest('.ruler, .markers');
    seekTo(timeAt(event.clientX));
    follow(
      event,
      (_dx, moved) => seekTo(timeAt(moved.clientX)),
      (moved) => !moved && onLane && select(undefined),
    );
  };

  /** Output times a dragged edge snaps to, without those of the item being dragged. */
  const targets = (except: { scene?: string; overlay?: string }): number[] => {
    if (!model) return [];
    const list = [currentPlayer()?.current().t ?? 0, ...model.markers.map((pin) => pin.t)];
    for (const scene of model.scenes) if (scene.id !== except.scene) list.push(scene.start, scene.end);
    for (const lane of LANES) for (const block of model.lanes[lane.kind].blocks) if (block.id !== except.overlay) list.push(block.start, block.end);
    return list;
  };
  const fps = project?.output.fps ?? 30;
  const snapped = (t: number, list: number[], event: { ctrlKey: boolean }) => (snapOn && !event.ctrlKey ? snapTime(t, list, SNAP_PX / pps, fps) : { t: Math.round(t * fps) / fps });

  /** A press on a scene: select it (the playhead goes there); its edges trim, its body moves it. */
  const pressScene = (event: ReactPointerEvent<HTMLElement>, block: SceneBlock) => {
    if (event.button !== 0 || !model || !project) return;
    event.stopPropagation();
    const edge = (event.target as HTMLElement).dataset.edge as 'start' | 'end' | undefined;
    select({ kind: 'scene', id: block.id });
    if (!edge) seekTo(timeAt(event.clientX));
    const scene = project.scenes[block.index]!;
    const others = targets({ scene: block.id });
    let commands: Command[] | undefined;
    let insertAt: number | undefined;
    follow(
      event,
      (dx, moved) => {
        const deltaOut = dx / pps;
        if (edge) {
          // The end edge snaps; the start edge of a clip moves its source start (where it starts in
          // the video stays, and it gets shorter or longer at its end, as every edit ripples).
          if (scene.type === 'clip') {
            if (edge === 'end') {
              const end = snapped(block.end + deltaOut, others, moved);
              setDrag({ guide: end.target });
              commands = [{ type: 'trim', id: block.id, to: scene.from + (end.t - block.start) * scene.speed }];
            } else commands = [{ type: 'trim', id: block.id, from: scene.from + deltaOut * scene.speed }];
          } else {
            const end = edge === 'end' ? snapped(block.end + deltaOut, others, moved) : { t: block.end - deltaOut, target: undefined };
            setDrag({ guide: end.target });
            commands = [{ type: 'trim', id: block.id, duration: Math.max(1 / fps, end.t - block.start) }];
          }
          preview(commands);
          return;
        }
        // moving: the scene goes where the pointer is among the others' middles
        const t = timeAt(moved.clientX);
        const rest = model.scenes.filter((other) => other.id !== block.id);
        insertAt = rest.filter((other) => (other.start + other.end) / 2 < t).length;
        setDrag({ insertAt: insertAt === 0 ? (rest[0]?.start ?? 0) : rest[insertAt - 1]!.end });
      },
      (moved) => {
        setDrag({});
        if (!moved) return;
        if (edge) {
          if (commands) edit(commands, scene.type === 'clip' ? 'Trim clip' : `Change the length of the ${scene.type === 'still' ? 'page' : 'card'}`);
          else preview(undefined);
          return;
        }
        if (insertAt !== undefined && insertAt !== block.index) edit([{ type: 'move-scene', id: block.id, index: insertAt }], 'Move scene');
      },
    );
  };

  /** A press on an overlay block: select it; its edges change its length, its body moves it (Alt: a copy). */
  const pressOverlay = (event: ReactPointerEvent<HTMLElement>, block: OverlayBlock, list: OverlayList) => {
    if (event.button !== 0 || !project) return;
    event.stopPropagation();
    const edge = ((event.target as HTMLElement).dataset.edge as 'start' | 'end' | undefined) ?? 'move';
    const copy = event.altKey && edge === 'move';
    select({ kind: block.kind, id: block.id, start: block.start, end: block.end });
    if (edge === 'move') seekTo(timeAt(event.clientX));
    const item = project[list].find((candidate) => candidate.id === block.id);
    const scene = spans[block.span]?.scene;
    if (!item || scene?.type !== 'clip') return;
    const range = overlayRange(item as { from?: number; to?: number; at?: number; duration?: number });
    const others = targets({ overlay: block.id });
    let commands: Command[] | undefined;
    follow(
      event,
      (dx, moved) => {
        let deltaOut = dx / pps;
        // the edge that leads snaps (both ends of a moved block: the nearer target wins)
        const candidates = edge === 'move' ? [block.start, block.end] : [edge === 'start' ? block.start : block.end];
        let best: { delta: number; target: number } | undefined;
        for (const at of candidates) {
          const hit = snapped(at + deltaOut, others, moved);
          if (hit.target !== undefined && (!best || Math.abs(hit.t - at - deltaOut) < Math.abs(best.delta - deltaOut))) best = { delta: hit.t - at, target: hit.target };
        }
        if (best) deltaOut = best.delta;
        setDrag({ guide: best?.target });
        const [from, to] = dragRange(range, edge, deltaOut, scene.speed, scene.speed / fps);
        commands = copy
          ? [{ type: 'duplicate', list, id: block.id, shift: from - range[0] }]
          : [{ type: 'set', list, id: block.id, fields: rangeFields(list, from, to) }];
        preview(commands);
      },
      (moved) => {
        setDrag({});
        if (!moved || !commands) return preview(undefined);
        const noun = NOUN[block.kind];
        edit(commands, copy ? `Duplicate ${noun}` : edge === 'move' ? `Move ${noun}` : `Change the length of the ${noun}`);
      },
    );
  };

  const width = duration * pps;
  const fitPps = scroller.current && duration > 0 ? (scroller.current.clientWidth - END_SPACE - 8) / duration : pps;
  const zoomValue = pps > 0 && fitPps > 0 ? Math.log(pps / fitPps) / Math.log(Math.max(1.0001, MAX_PPS / fitPps)) : 0;
  const { heights, tops } = layout;

  return (
    <section className="timeline" aria-label="Timeline">
      <TimelineBar status={model ? `${model.scenes.length} scene${model.scenes.length === 1 ? '' : 's'} · ${formatTime(duration)}` : ''} fit={fit} zoomValue={zoomValue} onScale={(value) => {
        const element = scroller.current;
        if (!element || !(fitPps > 0)) return;
        const next = fitPps * Math.pow(MAX_PPS / fitPps, value);
        const anchor = currentPlayer()?.current().t ?? 0;
        store.set({ pxPerSecond: next });
        requestAnimationFrame(() => (element.scrollLeft = Math.max(0, anchor * next - element.clientWidth / 2)));
      }} />
      <div className="tl-body" ref={body}>
        <div className="tl-names" style={{ height: layout.total }}>
          <div style={{ height: heights.markers }} />
          <div style={{ height: heights.ruler }} />
          <div style={{ height: heights.video }}>Video</div>
          {LANES.map((lane) => (
            <div key={lane.kind} style={{ height: heights[lane.kind] }} className="lane-name">
              {lane.name}
              {(model?.lanes[lane.kind].cutOut ?? 0) > 0 && (
                <button
                  type="button"
                  className="cut-out"
                  title="No clip shows these; they are not in the video. Click to list them."
                  aria-expanded={cutOutList?.kind === lane.kind}
                  onClick={(event) => {
                    const at = event.currentTarget.getBoundingClientRect();
                    setCutOutList(cutOutList?.kind === lane.kind ? undefined : { kind: lane.kind, left: at.right + 6, top: at.top });
                  }}
                  data-testid={`cut-out-${lane.kind}`}
                >
                  {model!.lanes[lane.kind].cutOut} cut out
                </button>
              )}
              {cutOutList?.kind === lane.kind && model && (
                <CutOutList
                  at={cutOutList}
                  items={model.lanes[lane.kind].cutOutItems}
                  onPick={(id) => {
                    setCutOutList(undefined);
                    select({ kind: lane.kind, id });
                  }}
                  onClose={() => setCutOutList(undefined)}
                />
              )}
            </div>
          ))}
          <div style={{ height: heights.mic }}>Mic</div>
          <div style={{ height: heights.input }}>Input</div>
        </div>
        <div className="tl-scroll" ref={scroller} data-testid="timeline">
          <div className="tl-content" style={{ width: width + END_SPACE, height: layout.total }} onPointerDown={scrub}>
            {model && project && pps > 0 && (
              <>
                <Markers model={model} pps={pps} />
                <Ruler duration={duration} pps={pps} view={view} top={tops.ruler} />
                <div className="tl-row" style={{ position: 'absolute', top: tops.video, height: heights.video, left: 0, right: 0 }}>
                  {model.scenes.map((scene) => (
                    <Scene key={scene.id} scene={scene} project={project} pps={pps} view={view} selected={isSelected(selection, 'scene', scene.id)} onPointerDown={(event) => pressScene(event, scene)} />
                  ))}
                </div>
                {LANES.map((lane) => (
                  <div key={lane.kind} className="tl-row" style={{ position: 'absolute', top: tops[lane.kind], height: heights[lane.kind], left: 0, right: 0 }}>
                    {model.lanes[lane.kind].blocks.map((block, index, blocks) => {
                      const blockLeft = block.start * pps;
                      const blockWidth = Math.max(6, (block.end - block.start) * pps);
                      const inset = Math.max(0, Math.min(view.left - blockLeft, blockWidth - LABEL_MIN_PX));
                      return (
                        <button
                          // by the overlay and which of its blocks: a block keeps its element while it is dragged
                          key={`${block.id}#${blocks.slice(0, index).filter((other) => other.id === block.id).length}`}
                          className={`item ${lane.kind}${block.enabled ? '' : ' off'}${isSelected(selection, lane.kind, block.id) ? ' selected' : ''}${hovered === block.id ? ' linked' : ''}`}
                          onPointerEnter={() => setHovered(block.id)}
                          onPointerLeave={() => setHovered((id) => (id === block.id ? undefined : id))}
                          style={{ left: blockLeft, width: blockWidth, top: 4 + block.row * ROW }}
                          title={`${block.title}${block.enabled ? '' : ' (off: not in the video)'} · drag to move, edges to change the length, Alt to copy`}
                          data-id={block.id}
                          onPointerDown={(event) => pressOverlay(event, block, lane.list)}
                          onKeyDown={(event) => event.key === 'Enter' && select({ kind: lane.kind, id: block.id, start: block.start, end: block.end })}
                        >
                          {blockWidth >= 14 && <i className="edge start" data-edge="start" />}
                          {blockWidth >= LABEL_MIN_PX && <span style={{ marginLeft: inset }}>{block.title}</span>}
                          {blockWidth >= 14 && <i className="edge end" data-edge="end" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
                <ColumnsCanvas
                  top={tops.mic}
                  height={heights.mic}
                  view={view}
                  color={BARS}
                  columns={(from, to, count) => (peaks ? waveformColumns(peaks, spans, from, to, count, (speed) => !audible(project, speed)) : new Array<number>(count).fill(0))}
                  pps={pps}
                  mirrored
                  deps={[peaks, spans, project]}
                />
                <ColumnsCanvas
                  top={tops.input}
                  height={heights.input}
                  view={view}
                  color={BARS}
                  columns={(from, to, count) => activityColumns(media?.events ?? [], spans, from, to, count)}
                  pps={pps}
                  deps={[media, spans]}
                />
                {drag.guide !== undefined && <div className="snap-guide" style={{ left: drag.guide * pps }} />}
                {drag.insertAt !== undefined && <div className="insert-mark" style={{ left: drag.insertAt * pps, top: tops.video, height: heights.video }} />}
                <Playhead pps={pps} top={heights.markers - 8} scroller={scroller} />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const isSelected = (selection: Selection | undefined, kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id;

/** The timeline's bar: split, speed, new items, snapping, fit and scale. */
function TimelineBar({ status, fit, zoomValue, onScale }: { status: string; fit: () => void; zoomValue: number; onScale: (value: number) => void }) {
  useStore(store, (state) => state.doc?.project);
  useStore(store, (state) => state.selection);
  const t = useStore(store, (state) => Math.round(state.player.t * 10));
  const snap = useStore(store, (state) => state.snap);
  const clip = selectedOrCurrentClip();
  const blocked = overlayBlocked();
  void t;
  return (
    <div className="tl-bar" role="toolbar" aria-label="Edit">
      <button className="act" onClick={split} disabled={!clip} title="Split the clip at the playhead (S)" data-testid="split">
        <SplitGlyph />
        Split
      </button>
      <label className="act speed" title="The clip's speed (R)">
        <span>Speed</span>
        <select
          value={clip ? String(clip.speed) : ''}
          disabled={!clip}
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
        + Zoom
      </button>
      <button className="act" onClick={() => addMask()} disabled={!!blocked} title={blocked ?? 'A mask at the playhead (M draws one)'}>
        + Mask
      </button>
      <button className="act" onClick={() => setTool('caption')} disabled={!!blocked} title={blocked ?? 'A caption at the playhead: type it on the video (T)'}>
        + Caption
      </button>
      <button className="act" onClick={addCard} title="A title card after the scene under the playhead">
        + Card
      </button>
      <button className="act" onClick={() => void addPage()} title="A page (an image, scrolled through) after the scene under the playhead">
        + Page
      </button>
      <span className="tl-status">{status}</span>
      <div className="grow" />
      <button className="act" aria-pressed={snap} onClick={() => store.set({ snap: !snap })} title="Snap to the playhead, scene edges, markers and other overlays (Ctrl while dragging: frames only)">
        Snap
      </button>
      <button className="act" onClick={fit} title="Fit the whole video (Shift+Z)">
        <FitIcon size={14} />
        Fit
      </button>
      <input type="range" min={0} max={1} step={0.001} value={Math.max(0, Math.min(1, zoomValue))} aria-label="Timeline scale" title="Timeline scale (Ctrl + wheel)" onChange={(event) => onScale(Number(event.target.value))} />
    </div>
  );
}

/** The overlays of a lane that no clip shows: a click selects one (the inspector can move or delete it). */
function CutOutList({ at, items, onPick, onClose }: { at: { left: number; top: number }; items: { id: string; title: string }[]; onPick: (id: string) => void; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('button')?.focus();
    const away = (event: PointerEvent) => !list.current?.contains(event.target as Node) && onClose();
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  // on the body: the lane names clip what overflows them
  return createPortal(
    <div
      className="cut-out-list"
      ref={list}
      role="menu"
      style={{ left: at.left, top: Math.min(at.top, window.innerHeight - 40 - items.length * 30) }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="cut-out-head">Not in the video: no clip shows these</div>
      {items.map((item) => (
        <button key={item.id} type="button" role="menuitem" onClick={() => onPick(item.id)}>
          {item.title}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function SplitGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M8 1.5v13M3 5l-1.5 3L3 11M13 5l1.5 3L13 11" />
    </svg>
  );
}

/** The playhead: the only part that changes on every frame. Keeps itself in view while playing and after a seek by key. */
function Playhead({ pps, top, scroller }: { pps: number; top: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const t = useStore(store, (state) => state.player.t);
  const playing = useStore(store, (state) => state.player.playing);
  useEffect(() => {
    const element = scroller.current;
    if (!element || (!playing && performance.now() < pointerSeekUntil)) return;
    const x = t * pps;
    if (x < element.scrollLeft + (playing ? 0 : 40) || x > element.scrollLeft + element.clientWidth - 40) element.scrollLeft = Math.max(0, x - element.clientWidth / 3);
  }, [t, pps, playing, scroller]);
  return <div className="playhead" style={{ left: t * pps, top }} />;
}

const Markers = memo(function Markers({ model, pps }: { model: TimelineModel; pps: number }) {
  const groups = groupPins(model.markers, 70 / pps);
  return (
    <div className="tl-row markers" style={{ position: 'absolute', top: 0, height: BASE_ROWS.markers, left: 0, right: 0 }}>
      {groups.map((group, i) => {
        // A flag ends before the next one starts (its dot always shows); the tooltip names it in full.
        const next = groups[i + 1];
        const room = next ? (next.t - group.t) * pps - 3 : undefined;
        return (
          <span key={i} className="flag" style={{ left: group.t * pps, ...(room !== undefined && { maxWidth: Math.max(17, room) }) }} title={`${pinGroupName(group)}: ${pinGroupDetail(group)}`}>
            <i style={{ background: MARKER_DOT[group.kind] }} />
            <span>{pinGroupName(group)}</span>
          </span>
        );
      })}
    </div>
  );
});

const Ruler = memo(function Ruler({ duration, pps, view, top }: { duration: number; pps: number; view: { left: number; width: number }; top: number }) {
  const step = TICKS.find((tick) => tick * pps >= 70) ?? TICKS.at(-1)!;
  const first = Math.max(0, Math.floor(view.left / pps / step) * step);
  const last = Math.min(duration, (view.left + view.width) / pps);
  const ticks: number[] = [];
  for (let tick = first; tick <= last + 1e-9; tick += step) ticks.push(Math.round(tick * 1000) / 1000);
  return (
    <div className="tl-row ruler" style={{ position: 'absolute', top, height: BASE_ROWS.ruler, left: 0, right: 0 }}>
      {ticks.map((tick) => (
        <span key={tick} style={{ left: tick * pps }}>
          {step < 1 ? formatTime(tick) : formatTime(tick).replace(/\.\d$/, '')}
        </span>
      ))}
    </div>
  );
});

function Scene(props: { scene: SceneBlock; project: CuttleProject; pps: number; view: { left: number; width: number }; selected: boolean; onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void }) {
  const { scene, project, pps, view, selected, onPointerDown } = props;
  const thumbState = useStore(store, (state) => state.mediaState.thumbnails.state);
  const thumbPath = useStore(store, (state) => state.mediaState.thumbnails.path);
  const interval = useStore(store, (state) => state.mediaState.thumbnails.interval);
  const thumbWidth = useStore(store, (state) => state.mediaState.thumbnails.width ?? 160);
  const thumbHeight = useStore(store, (state) => state.mediaState.thumbnails.height ?? 90);
  const count = useStore(store, (state) => state.mediaState.thumbnails.count ?? 1);
  const columns = useStore(store, (state) => state.mediaState.thumbnails.columns ?? 1);
  const screenStart = useStore(store, (state) => state.media?.screen.start ?? 0);
  const left = scene.start * pps;
  const width = (scene.end - scene.start) * pps;
  const clip = project.scenes[scene.index];
  const tileHeight = BASE_ROWS.video - 10;
  const tiles: { x: number; index: number }[] = [];
  const ready = thumbState === 'ready' && thumbPath !== undefined && interval !== undefined;
  const tileWidth = Math.round((tileHeight * thumbWidth) / thumbHeight);
  if (ready && clip?.type === 'clip' && width > 0) {
    const from = Math.max(0, Math.floor((view.left - left) / tileWidth));
    const to = Math.min(Math.ceil(width / tileWidth), Math.ceil((view.left + view.width - left) / tileWidth) + 1);
    for (let i = from; i < to; i++) {
      const outT = scene.start + ((i + 0.5) * tileWidth) / pps;
      // The thumbnails count from the take's first frame.
      const source = clip.from + (outT - scene.start) * clip.speed - screenStart;
      tiles.push({ x: i * tileWidth, index: Math.min(count - 1, Math.max(0, Math.floor(source / interval!))) });
    }
  }
  const kindClass = scene.kind === 'clip' ? '' : ` ${scene.kind}`;
  const speed = scene.speed !== undefined && scene.speed !== 1 ? `${Math.round(scene.speed * 10) / 10}×` : '';
  const name = [speed, scene.title].filter(Boolean).join(' ');
  const inset = Math.max(0, Math.min(view.left - left, width - LABEL_MIN_PX - 14));
  const scale = tileHeight / thumbHeight;
  return (
    <button
      className={`scene${kindClass}${selected ? ' selected' : ''}`}
      style={{ left, width: Math.max(4, width - 2) }}
      title={`${name} · ${scene.detail} · drag to move, edges to trim`}
      data-id={scene.id}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => event.key === 'Enter' && select({ kind: 'scene', id: scene.id })}
    >
      {ready && tiles.length > 0 && (
        <span className="thumbs">
          {tiles.map((tile) => (
            <i
              key={tile.x}
              style={{
                left: tile.x,
                width: tileWidth,
                backgroundImage: `url("${mediaUrl(thumbPath!)}")`,
                backgroundSize: `${columns * thumbWidth * scale}px auto`,
                backgroundPosition: `${-(tile.index % columns) * thumbWidth * scale}px ${-Math.floor(tile.index / columns) * tileHeight}px`,
              }}
            />
          ))}
        </span>
      )}
      {width >= LABEL_MIN_PX ? (
        <span className="lbl" style={{ marginLeft: 7 + inset }}>
          {speed && <b>{speed} </b>}
          {scene.title}
          {width >= 160 && <span className="detail"> · {scene.detail}</span>}
        </span>
      ) : (
        // a narrow clip still says its speed
        speed &&
        width >= 30 && (
          <span className="lbl" style={{ marginLeft: 4, padding: '1px 4px' }}>
            <b>{speed}</b>
          </span>
        )
      )}
      {width >= 14 && <i className="edge start" data-edge="start" />}
      {width >= 14 && <i className="edge end" data-edge="end" />}
    </button>
  );
}

/** A canvas over the visible part of a lane, one bar per two pixels (0–1 each). */
function ColumnsCanvas(props: {
  top: number;
  height: number;
  view: { left: number; width: number };
  pps: number;
  color: string;
  mirrored?: boolean;
  columns: (from: number, to: number, count: number) => number[];
  deps: unknown[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { top: y, height, view, pps, color, mirrored } = props;
  useEffect(() => {
    const element = canvas.current;
    if (!element || !(pps > 0)) return;
    const ratio = window.devicePixelRatio || 1;
    const columns = Math.max(1, Math.floor(view.width / 2));
    element.width = Math.max(1, Math.round(view.width * ratio));
    element.height = Math.round(height * ratio);
    const context = element.getContext('2d')!;
    context.clearRect(0, 0, element.width, element.height);
    context.fillStyle = color;
    const values = props.columns(view.left / pps, (view.left + view.width) / pps, columns);
    const columnWidth = element.width / columns;
    const middle = element.height / 2;
    values.forEach((value, i) => {
      if (value <= 0) return;
      const bar = Math.max(1, value * (mirrored ? element.height - 4 * ratio : element.height - 2 * ratio));
      context.fillRect(i * columnWidth, mirrored ? middle - bar / 2 : element.height - bar, Math.max(1, columnWidth - ratio), bar);
    });
  }, [view.left, view.width, pps, height, color, ...props.deps]);
  return <canvas ref={canvas} className="tl-canvas" style={{ top: y, left: view.left, width: view.width, height }} />;
}
```

`apps/desktop/src/renderer/editor/Inspector.tsx`:

```
// The inspector: the selection's settings and the look, edited in place. A field saves when it is
// left or Enter is pressed (text also every 2 s while typing); each save is one step to undo.
// Output times read m:ss.t, source seconds "src 54.4 s", lengths "2.5 s".
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import { BACKGROUND_PRESETS, CLICK_EFFECTS, CURSOR_STYLES, EASES, FRAME_STYLES, MASK_STYLES, STILL_MOTIONS, TEXT_POSITIONS, TEXT_STYLES, WEBCAM_CORNERS, WEBCAM_SHAPES, type CuttleProject, type Rect } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import { formatDuration, formatSource, formatSpeed, formatTime } from '../../shared/format';
import {
  BACKGROUND_NAMES,
  CLICK_NAMES,
  CORNER_NAMES,
  CURSOR_NAMES,
  EASE_NAMES,
  FRAME_NAMES,
  MASK_STYLE_NAMES,
  MOTION_NAMES,
  POSITION_NAMES,
  TEXT_STYLE_NAMES,
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { outputTimesOf } from '../../shared/timeline-model';
import { CardIcon, FilmIcon, MaskIcon, PageIcon, TextIcon, ZoomIcon } from '../icons';
import { chooseImage, LIST_OF, SPEEDS } from './actions';
import { edit } from './doc';
import { setTool, store, type Selection } from './session';
import { useStore } from './store';

const TABS = [
  { id: 'selection', name: 'Selection' },
  { id: 'look', name: 'Look' },
] as const;

export function Inspector() {
  const tab = useStore(store, (state) => state.tab);
  const tabs = useRef<HTMLDivElement>(null);
  // Arrow keys move between the tabs, as in any tab list.
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const next = TABS[(TABS.findIndex((item) => item.id === tab) + 1) % TABS.length]!;
    store.set({ tab: next.id });
    tabs.current?.querySelector<HTMLButtonElement>(`#tab-${next.id}`)?.focus();
  };
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="tabs" role="tablist" ref={tabs} onKeyDown={onKey}>
        {TABS.map((item) => (
          <button
            key={item.id}
            id={`tab-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="inspector-panel"
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => store.set({ tab: item.id })}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="panel-body" id="inspector-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'selection' ? <SelectionPanel /> : <LookPanel />}
      </div>
    </aside>
  );
}

// ---- fields --------------------------------------------------------------------------------------

/**
 * A labelled field. The label is a <label> (a click on it reaches the field) unless `plain`: a row
 * with a button that is not its field (Replace…) must not press it from its label.
 */
function Row({ label, children, note, wide, plain }: { label: string; children: ReactNode; note?: ReactNode; wide?: boolean; plain?: boolean }) {
  const Tag = plain ? 'div' : 'label';
  return (
    <Tag className={`field${wide ? ' wide' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        {children}
        {note !== undefined && <em>{note}</em>}
      </span>
    </Tag>
  );
}

/** A text that saves when left, on Enter (not in a multi-line one), and every 2 s while typing. */
function TextInput({ value, onCommit, multiline, placeholder, testId }: { value: string; onCommit: (value: string) => void; multiline?: boolean; placeholder?: string; testId?: string }) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(draft);
  useEffect(() => {
    setDraft(value);
    latest.current = value;
  }, [value]);
  const commit = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (latest.current !== value) onCommit(latest.current);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const props = {
    value: draft,
    placeholder,
    'data-testid': testId,
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value);
      latest.current = event.target.value;
      timer.current ??= setTimeout(commit, 2000);
    },
    onBlur: commit,
    onKeyDown: (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Enter' && (!multiline || event.ctrlKey)) {
        event.preventDefault();
        commit();
      }
      if (event.key === 'Escape') {
        setDraft(value);
        latest.current = value;
        clearTimeout(timer.current);
        timer.current = undefined;
        (event.target as HTMLElement).blur();
      }
    },
  };
  return multiline ? <textarea rows={2} {...props} /> : <input type="text" {...props} />;
}

/** A number that saves when left or on Enter, clamped to [min, max]; arrows step it. */
function NumberInput({ value, onCommit, step = 0.1, min, max, digits = 2, testId }: { value: number; onCommit: (value: number) => void; step?: number; min?: number; max?: number; digits?: number; testId?: string }) {
  const shown = String(Math.round(value * 10 ** digits) / 10 ** digits);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = (text = draft) => {
    const parsed = Number(text.replace(',', '.'));
    if (!Number.isFinite(parsed)) return setDraft(shown);
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    if (Math.abs(clamped - value) > 1e-9) onCommit(clamped);
    else setDraft(shown);
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      {...(min !== undefined && { min })}
      {...(max !== undefined && { max })}
      value={draft}
      data-testid={testId}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => commit()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(shown);
      }}
    />
  );
}

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

function Toggle({ checked, onChange, label, testId, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)} aria-label={label} data-testid={testId} disabled={disabled}>
      <i />
    </button>
  );
}

function Head({ icon, color, name }: { icon: ReactNode; color: string; name: string }) {
  return (
    <div className="kind-head">
      <span className="kind-icon" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
        {icon}
      </span>
      <span className="name" title={name}>
        {name}
      </span>
    </div>
  );
}

// ---- the selection -------------------------------------------------------------------------------

const span = (from: number, to: number) => `${formatTime(from)} → ${formatTime(to)}`;
const set = (list: ListName, id: string, fields: Record<string, unknown>, label: string) => edit([{ type: 'set', list, id, fields }], label);

/** Where an overlay shows in the video (the clicked stretch, else its first) and the speed there. */
function stretchOf(project: CuttleProject, selection: Selection, from: number, to: number): { start: number; end: number; speed: number } | undefined {
  const spans = sceneSpans(project.scenes);
  const speedAt = (t: number) => {
    const scene = spans.find((item) => t >= item.start - 1e-9 && t < item.end)?.scene;
    return scene?.type === 'clip' ? scene.speed : 1;
  };
  if (selection.start !== undefined && selection.end !== undefined) return { start: selection.start, end: selection.end, speed: speedAt(selection.start) };
  const start = outputTimesOf(spans, from)[0];
  if (start === undefined) return undefined;
  const end = outputTimesOf(spans, Math.max(from, to - 1e-6)).find((time) => time >= start) ?? start;
  return { start, end, speed: speedAt(start) };
}

function SelectionPanel() {
  const selection = useStore(store, (state) => state.selection);
  const project = useStore(store, (state) => state.doc?.project);
  if (!project || !selection) {
    return (
      <p className="hint">
        Click a scene, zoom, mask or caption on the timeline to change it here. Drag on the timeline to trim, move and resize; S splits at the playhead. The Look tab holds the background, frame, cursor
        and more.
      </p>
    );
  }
  const list = LIST_OF[selection.kind];
  const item = (project[list] as { id?: string }[]).find((candidate) => candidate.id === selection.id);
  if (!item) return <p className="hint">The selection is not in the project any more.</p>;
  return <Details project={project} selection={selection} />;
}

function Details({ project, selection }: { project: CuttleProject; selection: Selection }) {
  const id = selection.id;
  if (selection.kind === 'scene') {
    const scene = project.scenes.find((item) => item.id === id)!;
    const stretch = sceneSpans(project.scenes).find((item) => item.scene === scene);
    const inVideo = stretch && <Row label="In the video">{span(stretch.start, stretch.end)}</Row>;
    if (scene.type === 'clip') {
      const name = [scene.speed !== 1 ? formatSpeed(scene.speed) : '', scene.label ?? (scene.speed === 1 ? 'Clip' : '')].filter(Boolean).join(' ');
      return (
        <>
          <Head icon={<FilmIcon />} color="var(--text)" name={name} />
          <Row label="Label">
            <TextInput value={scene.label ?? ''} placeholder="Clip" onCommit={(value) => set('scenes', id, { label: value.trim() || undefined }, 'Rename clip')} testId="clip-label" />
          </Row>
          <div className="field">
            <span className="field-label">Speed</span>
            <div className="chips" role="group" aria-label="Speed">
              {SPEEDS.map((speed) => (
                <button key={speed} type="button" aria-pressed={scene.speed === speed} onClick={() => edit([{ type: 'speed', id, speed }], `Speed ${speed}×`)}>
                  {speed}×
                </button>
              ))}
            </div>
            <span className="field-input narrow">
              <NumberInput value={scene.speed} min={0.25} max={64} step={0.5} onCommit={(speed) => edit([{ type: 'speed', id, speed }], `Speed ${speed}×`)} testId="clip-speed" />
              <em>× · {stretch ? formatDuration(stretch.end - stretch.start) : ''} in the video</em>
            </span>
          </div>
          {inVideo}
          <div className="grid2">
            <Row label="From (src s)">
              <NumberInput value={scene.from} min={0} onCommit={(from) => edit([{ type: 'trim', id, from }], 'Trim clip')} testId="clip-from" />
            </Row>
            <Row label="To (src s)">
              <NumberInput value={scene.to} min={0} onCommit={(to) => edit([{ type: 'trim', id, to }], 'Trim clip')} testId="clip-to" />
            </Row>
          </div>
          <Row label="Badge" note={scene.badge === undefined ? 'shows the speed when sped up' : undefined}>
            <TextInput value={scene.badge ?? ''} placeholder={scene.speed > 1 ? `${formatSpeed(scene.speed)} speed` : 'none'} onCommit={(value) => set('scenes', id, { badge: value === '' ? undefined : value }, 'Change badge')} />
          </Row>
        </>
      );
    }
    if (scene.type === 'still') {
      return (
        <>
          <Head icon={<PageIcon />} color="var(--still)" name={scene.label ?? 'Page'} />
          <Row label="Label">
            <TextInput value={scene.label ?? ''} placeholder="Page" onCommit={(value) => set('scenes', id, { label: value.trim() || undefined }, 'Rename page')} />
          </Row>
          <Row label="Image" plain>
            <span className="path" title={scene.image}>
              {scene.image}
            </span>
            <button type="button" className="ghost small" onClick={() => void chooseImage('still', id)}>
              Replace…
            </button>
          </Row>
          {inVideo}
          <div className="grid2">
            <Row label="Length (s)">
              <NumberInput value={scene.duration} min={0.1} onCommit={(duration) => edit([{ type: 'trim', id, duration }], 'Change the length of the page')} />
            </Row>
            <Row label="Motion">
              <Select value={scene.motion} options={STILL_MOTIONS} names={MOTION_NAMES} onChange={(motion) => set('scenes', id, { motion }, 'Change motion')} />
            </Row>
          </div>
          <Row label="Frame">
            <Select value={scene.frame} options={FRAME_STYLES} names={FRAME_NAMES} onChange={(frame) => set('scenes', id, { frame }, 'Change frame')} />
          </Row>
        </>
      );
    }
    return (
      <>
        <Head icon={<CardIcon />} color="var(--card)" name={scene.label ?? 'Card'} />
        <Row label="Title">
          <TextInput value={scene.title} onCommit={(value) => value.trim() && set('scenes', id, { title: value.trim() }, 'Change title')} testId="card-title" />
        </Row>
        <Row label="Subtitle">
          <TextInput value={scene.subtitle ?? ''} placeholder="none" onCommit={(value) => set('scenes', id, { subtitle: value.trim() || undefined }, 'Change subtitle')} />
        </Row>
        {inVideo}
        <Row label="Length (s)">
          <NumberInput value={scene.duration} min={0.1} onCommit={(duration) => edit([{ type: 'trim', id, duration }], 'Change the length of the card')} />
        </Row>
      </>
    );
  }

  /** An overlay's place: in the video (read), its start in source seconds, its length in the video. */
  const timing = (list: 'zooms' | 'texts' | 'masks', from: number, to: number) => {
    const stretch = stretchOf(project, selection, from, to);
    const label = list === 'masks' ? 'mask' : list === 'zooms' ? 'zoom' : 'caption';
    return (
      <>
        <Row label="In the video" note={formatSource(from)}>
          {stretch ? span(stretch.start, stretch.end) : 'Cut out: no clip shows it'}
        </Row>
        {list === 'masks' ? (
          <div className="grid2">
            <Row label="From (src s)">
              <NumberInput value={from} min={0} onCommit={(value) => set('masks', id, { from: value, to: Math.max(to, value + 0.05) }, 'Move mask')} />
            </Row>
            <Row label="To (src s)">
              <NumberInput value={to} min={0} onCommit={(value) => set('masks', id, { to: value }, 'Change the length of the mask')} />
            </Row>
          </div>
        ) : (
          <div className="grid2">
            <Row label="Start (src s)">
              <NumberInput value={from} min={0} onCommit={(at) => set(list, id, { at }, `Move ${label}`)} testId={`${label}-at`} />
            </Row>
            <Row label="Length (s)" note={stretch && stretch.speed !== 1 ? `${formatDuration(to - from)} src` : undefined}>
              <NumberInput
                value={stretch ? (to - from) / stretch.speed : to - from}
                min={0.05}
                onCommit={(length) => set(list, id, { duration: length * (stretch?.speed ?? 1) }, `Change the length of the ${label}`)}
                testId={`${label}-length`}
              />
            </Row>
          </div>
        )}
      </>
    );
  };

  const area = (list: 'zooms' | 'masks', rect: Rect, label: string) => (
    <div className="field">
      <span className="field-label">
        Area, in source pixels
        <button type="button" className="link" onClick={() => setTool(list === 'zooms' ? 'zoom' : 'mask')}>
          Draw on the video
        </button>
      </span>
      <div className="grid4">
        {(['x', 'y', 'w', 'h'] as const).map((name, i) => (
          <label key={name} className="field-input">
            <em>{name}</em>
            <NumberInput value={rect[i]!} digits={0} step={1} min={i < 2 ? 0 : 8} onCommit={(value) => set(list, id, { rect: rect.map((old, j) => (j === i ? value : old)) }, `Change the ${label} area`)} />
          </label>
        ))}
      </div>
    </div>
  );

  const enabled = (list: 'zooms' | 'masks' | 'texts', on: boolean, label: string) => (
    <Row label="In the video">
      <Toggle checked={on} label={`${label} on`} onChange={(value) => set(list, id, { enabled: value ? undefined : false }, value ? `Turn ${label} on` : `Turn ${label} off`)} />
      <em>{on ? 'On' : 'Off: not in the video'}</em>
    </Row>
  );

  if (selection.kind === 'zoom') {
    const zoom = project.zooms.find((item) => item.id === id)!;
    return (
      <>
        <Head icon={<ZoomIcon />} color="var(--zoom)" name={zoom.label ?? 'Zoom'} />
        <Row label="Label">
          <TextInput value={zoom.label ?? ''} placeholder="Zoom" onCommit={(value) => set('zooms', id, { label: value.trim() || undefined }, 'Rename zoom')} />
        </Row>
        {timing('zooms', zoom.at, zoom.at + zoom.duration)}
        {area('zooms', zoom.rect, 'zoom')}
        <Row label="Easing">
          <Select value={zoom.ease} options={EASES} names={EASE_NAMES} onChange={(ease) => set('zooms', id, { ease }, 'Change easing')} />
        </Row>
        {enabled('zooms', zoom.enabled, 'zoom')}
      </>
    );
  }
  if (selection.kind === 'mask') {
    const mask = project.masks.find((item) => item.id === id)!;
    return (
      <>
        <Head icon={<MaskIcon />} color="var(--mask)" name={mask.label ?? 'Mask'} />
        <Row label="Label">
          <TextInput value={mask.label ?? ''} placeholder="Mask" onCommit={(value) => set('masks', id, { label: value.trim() || undefined }, 'Rename mask')} />
        </Row>
        {timing('masks', mask.from, mask.to)}
        {area('masks', mask.rect, 'mask')}
        <Row label="Style">
          <Select value={mask.style} options={MASK_STYLES} names={MASK_STYLE_NAMES} onChange={(style) => set('masks', id, { style }, 'Change mask style')} />
        </Row>
        {enabled('masks', mask.enabled, 'mask')}
      </>
    );
  }
  const text = project.texts.find((item) => item.id === id)!;
  return (
    <>
      <Head icon={<TextIcon />} color="var(--caption)" name={text.label ?? 'Caption'} />
      <Row label="Text" wide>
        <TextInput value={text.text} multiline onCommit={(value) => value.trim() && set('texts', id, { text: value }, 'Edit caption')} testId="caption-text" />
      </Row>
      {timing('texts', text.at, text.at + text.duration)}
      <div className="grid2">
        <Row label="Style">
          <Select value={text.style} options={TEXT_STYLES} names={TEXT_STYLE_NAMES} onChange={(style) => set('texts', id, { style }, 'Change caption style')} />
        </Row>
        <Row label="Position">
          <Select value={text.position} options={TEXT_POSITIONS} names={POSITION_NAMES} onChange={(position) => set('texts', id, { position }, 'Move caption')} />
        </Row>
      </div>
      <Row label="Label">
        <TextInput value={text.label ?? ''} placeholder="Caption" onCommit={(value) => set('texts', id, { label: value.trim() || undefined }, 'Rename caption')} />
      </Row>
      {enabled('texts', text.enabled, 'caption')}
    </>
  );
}

// ---- the look ------------------------------------------------------------------------------------

const look = (path: string[], value: unknown, label: string) => edit([{ type: 'look', path, value } as Command], label);

const SIZES = [
  { name: '16:9', ...EXPORT_FORMATS['16:9'] },
  { name: '1:1', ...EXPORT_FORMATS['1:1'] },
  { name: '9:16', ...EXPORT_FORMATS['9:16'] },
];

function LookPanel() {
  const project = useStore(store, (state) => state.doc?.project);
  const raw = useStore(store, (state) => state.doc?.raw);
  if (!project || !raw) return null;
  const { look: current, output, sources } = project;
  const size = SIZES.find((item) => item.width === output.width && item.height === output.height);
  return (
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
      <div className="swatches" role="group" aria-label="Background">
        {BACKGROUND_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
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
        ))}
      </div>
      {current.background.preset === 'solid' && (
        <Row label="Colour">
          <input type="color" value={current.background.color ?? '#1c1c22'} onChange={(event) => look(['background', 'color'], event.target.value, 'Background colour')} />
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

      <div className="section-title">Window frame</div>
      <Row label="Frame">
        <Toggle checked={current.frame.enabled} label="Window frame" onChange={(on) => look(['frame', 'enabled'], on, on ? 'Window frame on' : 'Window frame off')} />
      </Row>
      {current.frame.enabled && (
        <>
          <Row label="Style">
            <Select value={current.frame.style} options={FRAME_STYLES} names={FRAME_NAMES} onChange={(style) => look(['frame', 'style'], style, 'Frame style')} testId="frame-style" />
          </Row>
          <Row label="Title">
            <TextInput value={current.frame.title} placeholder="none" onCommit={(title) => look(['frame', 'title'], title, 'Frame title')} />
          </Row>
          <div className="grid2">
            <Row label="Corners (px)">
              <NumberInput value={current.frame.radius} min={0} max={48} step={1} digits={0} onCommit={(radius) => look(['frame', 'radius'], radius, 'Frame corners')} />
            </Row>
            <Row label="Shadow">
              <Toggle checked={current.frame.shadow} label="Shadow" onChange={(on) => look(['frame', 'shadow'], on, on ? 'Shadow on' : 'Shadow off')} />
            </Row>
          </div>
        </>
      )}

      <div className="section-title">Cursor</div>
      <Row label="Cursor">
        <Toggle checked={current.cursor.enabled} label="Cursor" onChange={(on) => look(['cursor', 'enabled'], on, on ? 'Cursor on' : 'Cursor off')} />
      </Row>
      {current.cursor.enabled && (
        <>
          <Row label="Style">
            <Select value={current.cursor.style} options={CURSOR_STYLES} names={CURSOR_NAMES} onChange={(style) => look(['cursor', 'style'], style, 'Cursor style')} />
          </Row>
          <div className="grid2">
            <Row label="Size">
              <NumberInput value={current.cursor.size} min={0.5} max={4} step={0.25} onCommit={(value) => look(['cursor', 'size'], value, 'Cursor size')} />
            </Row>
            <Row label="Colour">
              <input type="color" value={current.cursor.color.toLowerCase()} onChange={(event) => look(['cursor', 'color'], event.target.value.toUpperCase(), 'Cursor colour')} />
            </Row>
          </div>
          <Row label="Clicks">
            <Select value={current.cursor.clickEffect} options={CLICK_EFFECTS} names={CLICK_NAMES} onChange={(effect) => look(['cursor', 'clickEffect'], effect, 'Click effect')} />
          </Row>
        </>
      )}

      <div className="section-title">Webcam</div>
      <Row label="Bubble" note={sources.webcam ? undefined : 'no webcam in this take'}>
        <Toggle checked={current.webcam.enabled} disabled={!sources.webcam} label="Webcam bubble" onChange={(on) => look(['webcam', 'enabled'], on, on ? 'Webcam on' : 'Webcam off')} />
      </Row>
      {current.webcam.enabled && sources.webcam && (
        <>
          <div className="grid2">
            <Row label="Shape">
              <Select value={current.webcam.shape} options={WEBCAM_SHAPES} names={WEBCAM_SHAPE_NAMES} onChange={(shape) => look(['webcam', 'shape'], shape, 'Webcam shape')} />
            </Row>
            <Row label="Corner">
              <Select value={current.webcam.corner} options={WEBCAM_CORNERS} names={CORNER_NAMES} onChange={(corner) => look(['webcam', 'corner'], corner, 'Webcam corner')} />
            </Row>
          </div>
          <Row label="Size" note="of the output's height">
            <NumberInput value={current.webcam.size} min={0.08} max={0.5} step={0.02} onCommit={(value) => look(['webcam', 'size'], value, 'Webcam size')} />
          </Row>
        </>
      )}

      <div className="section-title">Sound and transitions</div>
      <Row label="Mic">
        <Toggle checked={current.audio.enabled} label="Mic sound" onChange={(on) => look(['audio', 'enabled'], on, on ? 'Sound on' : 'Sound off')} />
      </Row>
      {current.audio.enabled && (
        <Row label="Sped-up clips">
          <Toggle checked={current.audio.muteSpedUp} label="Silent when sped up" onChange={(on) => look(['audio', 'muteSpedUp'], on, on ? 'Sped-up clips silent' : 'Sped-up clips heard')} />
          <em>{current.audio.muteSpedUp ? 'Silent' : 'Heard'}</em>
        </Row>
      )}
      <Row label="Crossfade">
        <Toggle checked={current.transition.enabled} label="Crossfade at cuts" onChange={(on) => look(['transition', 'enabled'], on, on ? 'Crossfade on' : 'Crossfade off')} />
      </Row>
      {current.transition.enabled && (
        <Row label="Length (s)">
          <NumberInput value={current.transition.duration} min={0} max={2} step={0.1} onCommit={(value) => look(['transition', 'duration'], value, 'Crossfade length')} />
        </Row>
      )}
    </>
  );
}
```

In `apps/desktop/src/renderer/editor/ExportSheet.tsx`, replace:

```
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import { formatBytes, formatDuration, formatTime } from '../../shared/format';
import type { ExportTarget } from '../../shared/ipc';
import { exportChecks } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, FolderIcon } from '../icons';
import { cancelExport, closeExport, currentPlayer, startExport, store } from './session';
import { useStore } from './store';
import { FORMATS, ownFormat, targetName } from './targets';
```

with:

```
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import { formatBytes, formatDuration, formatTime } from '../../shared/format';
import type { ExportTarget } from '../../shared/ipc';
import { sceneSpans } from '@cuttle/timeline';
import { exportChecks } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, FolderIcon } from '../icons';
import { cancelExport, closeExport, startExport, store } from './session';
import { useStore } from './store';
import { FORMATS, ownFormat, targetName } from './targets';
```

In the same file, replace:

```
  const end = useStore(store, (state) => state.exportEnd);
  const started = useStore(store, (state) => state.exportStarted);
  const format = useStore(store, (state) => state.format);
  const media = useStore(store, (state) => state.media);
  const output = media?.project.output;
  const own = ownFormat(output);
  // The project's own size first; a preset of the same size would write the same video again.
  const targets = useMemo<ExportTarget[]>(() => ['project', ...FORMATS.filter((name) => name !== own)], [own]);
```

with:

```
  const end = useStore(store, (state) => state.exportEnd);
  const started = useStore(store, (state) => state.exportStarted);
  const format = useStore(store, (state) => state.format);
  const project = useStore(store, (state) => state.doc?.project);
  const output = project?.output;
  const own = ownFormat(output);
  // The project's own size first; a preset of the same size would write the same video again.
  const targets = useMemo<ExportTarget[]>(() => ['project', ...FORMATS.filter((name) => name !== own)], [own]);
```

In the same file, replace:

```
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const checks = useMemo(() => (media ? exportChecks(media.project, currentPlayer()?.spans ?? []) : []), [media]);

  if (!open) return null;
```

with:

```
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const checks = useMemo(() => (project ? exportChecks(project, sceneSpans(project.scenes)) : []), [project]);

  if (!open) return null;
```

`apps/desktop/src/renderer/editor/editor.css`:

```
.app {
  display: grid;
  /* the video stays the largest part: the timeline takes a third of a small window */
  grid-template-rows: 44px minmax(0, 1fr) var(--timeline-height, clamp(220px, 34vh, 320px));
  /* the tools beside the video, the inspector on the right */
  grid-template-columns: 48px minmax(0, 1fr) 300px;
  height: 100%;
}

/* title bar: the window's caption buttons sit over its right end (titleBarOverlay) */
.titlebar {
  grid-column: 1 / 4;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 152px 0 14px;
  border-bottom: 1px solid var(--line);
  -webkit-app-region: drag;
  min-width: 0;
}
.titlebar button,
.titlebar .seg {
  -webkit-app-region: no-drag;
}
.titlebar .seg button {
  white-space: nowrap;
}
.chip-status .chip-text {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.project-name {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  white-space: nowrap;
}
.project-name b {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.project-name span {
  color: var(--faint);
  font-size: var(--size-s);
  overflow: hidden;
  text-overflow: ellipsis;
}
.grow {
  flex: 1;
}
.seg {
  display: flex;
  background: var(--raised);
  border-radius: var(--radius-m);
  padding: 2px;
  gap: 2px;
}
.seg button {
  padding: 3px 10px;
  border-radius: 7px;
  color: var(--muted);
  font-size: var(--size-s);
  font-weight: 500;
  transition: background var(--fast), color var(--fast);
}
.seg button:hover {
  color: var(--text);
}
.seg button[aria-pressed='true'] {
  background: var(--raised-active);
  color: var(--text);
}
.primary {
  height: 28px;
  padding: 0 14px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 7px;
  transition: background var(--fast);
}
.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
.ghost {
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--raised);
  color: var(--text);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--size-s);
  transition: background var(--fast);
}
.ghost:hover:not(:disabled) {
  background: var(--raised-hover);
}
.chip-status {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 4px;
  color: var(--muted);
  font-size: var(--size-s);
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
button.chip-status {
  padding: 0 10px;
  border-radius: 8px;
  background: var(--raised);
  transition: background var(--fast), color var(--fast);
}
button.chip-status:hover {
  background: var(--raised-hover);
  color: var(--text);
}
.chip-status.warn {
  color: var(--card);
}
.chip-status.done {
  color: var(--ok);
}
.chip-status .bar {
  width: 56px;
  height: 3px;
  border-radius: 2px;
  background: var(--raised-active);
  overflow: hidden;
  flex: none;
}
.chip-status .bar i {
  display: block;
  height: 100%;
  background: var(--muted);
}

/* stage: the output view, as large as it fits, with the transport under it */
.stage {
  grid-row: 2;
  grid-column: 2;
  background: var(--stage);
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px 24px 14px;
  min-height: 0;
  min-width: 0;
}
.viewport {
  flex: 1;
  width: 100%;
  min-height: 0;
  display: grid;
  place-items: center;
  position: relative;
}
.viewport canvas {
  display: block;
  border-radius: 4px;
  box-shadow: 0 0 0 1px var(--line);
  background: #000;
}
.stage-note {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--overlay);
  box-shadow: var(--shadow-float);
  font-size: var(--size-s);
  color: var(--muted);
  max-width: 80%;
  z-index: 2;
}
.stage-note.warn {
  color: var(--card);
}
.stage-note span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stage-note button {
  width: 22px;
  height: 22px;
  margin-right: -6px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--muted);
  flex: none;
}
.stage-note button:hover {
  background: var(--raised);
  color: var(--text);
}
.transport {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--muted);
}
.play {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--text);
  color: #111;
  display: grid;
  place-items: center;
  flex: none;
  transition: transform var(--fast) var(--ease-out);
}
.play:hover {
  transform: scale(1.06);
}
.play svg {
  margin-left: 1px;
}
.time b {
  color: var(--text);
  font-weight: 500;
}
.time em {
  color: var(--faint);
  font-style: normal;
  margin-left: 10px;
}

/* inspector */
.inspector {
  grid-row: 2 / 4;
  grid-column: 3;
  background: var(--panel);
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 10px 12px 0;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  padding: 8px 10px;
  color: var(--muted);
  font-weight: 500;
  border-bottom: 2px solid transparent;
  border-radius: 0;
}
.tabs button[aria-selected='true'] {
  color: var(--text);
  border-bottom-color: var(--text);
}
.panel-body {
  flex: 1;
  overflow: auto;
  padding: 14px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.kind-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.kind-icon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  flex: none;
}
.kind-head .name {
  display: block;
  flex: 1;
  min-width: 0;
  line-height: 30px;
  font-size: var(--size-l);
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.field-label {
  color: var(--muted);
  font-size: var(--size-s);
  margin-bottom: 2px;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}
.hint {
  color: var(--muted);
  font-size: var(--size-s);
  line-height: 1.5;
}
.section-title {
  color: var(--faint);
  font-size: var(--size-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  margin-top: 4px;
}

/* timeline */
.timeline {
  grid-row: 3;
  grid-column: 1 / 3;
  background: var(--panel);
  border-top: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}
.tl-bar {
  height: 38px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: var(--size-s);
}
.tl-bar .act {
  height: 26px;
  padding: 0 8px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  color: var(--muted);
}
.tl-bar .act:hover {
  background: var(--raised);
  color: var(--text);
}
.tl-bar input[type='range'] {
  width: 110px;
  accent-color: var(--muted);
}
.tl-status {
  color: var(--faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* the lanes scroll up and down together with their names when they are taller than the panel */
.tl-body {
  flex: 1;
  display: flex;
  align-items: flex-start;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.tl-names {
  width: 96px;
  flex: none;
  border-right: 1px solid var(--line);
}
.tl-names div {
  padding-left: 14px;
  color: var(--muted);
  font-size: var(--size-s);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  white-space: nowrap;
  overflow: hidden;
}
.tl-names small {
  color: var(--faint);
  font-size: 10px;
  line-height: 1.2;
}
.tl-scroll {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  position: relative;
  min-width: 0;
}
.tl-content {
  position: relative;
}
.tl-row {
  position: relative;
}
.flag {
  position: absolute;
  top: 5px;
  height: 17px;
  padding: 0 6px 0 5px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 5px;
  background: #24242b;
  color: var(--muted);
  white-space: nowrap;
  transform: translateX(-6px);
}
.flag i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: block;
  flex: none;
}
.flag {
  overflow: hidden;
}
.flag span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ruler {
  border-bottom: 1px solid var(--line);
  color: var(--faint);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  cursor: col-resize;
}
.ruler span {
  position: absolute;
  top: 3px;
  padding-left: 3px;
  border-left: 1px solid var(--line-strong);
  height: 14px;
  line-height: 12px;
}
.scene {
  position: absolute;
  top: 5px;
  bottom: 5px;
  border-radius: 7px;
  overflow: hidden;
  background: var(--raised);
  display: flex;
  align-items: flex-end;
}
.scene .thumbs {
  position: absolute;
  inset: 0;
}
.scene .thumbs i {
  position: absolute;
  top: 0;
  bottom: 0;
  background-repeat: no-repeat;
  border-right: 1px solid rgba(8, 8, 10, 0.6);
}
/* the outline (and selection, and keyboard focus) is drawn over the thumbnails */
.scene::after,
.item::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 1;
}
.scene::after {
  box-shadow: inset 0 0 0 1px var(--line);
}
.scene.selected::after,
.item.selected::after {
  box-shadow: inset 0 0 0 2px var(--accent);
}
.scene:focus-visible {
  border-radius: 7px;
  box-shadow: none;
}
.item:focus-visible {
  border-radius: 6px;
}
.scene:focus-visible::after,
.item:focus-visible::after {
  outline: 2px solid var(--text);
  outline-offset: -2px;
}
.scene .lbl {
  position: relative;
  z-index: 2;
  margin: 0 0 5px 7px;
  background: rgba(10, 10, 12, 0.78);
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 11px;
  color: #d6d6dc;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: calc(100% - 14px);
}
.scene .lbl b {
  font-weight: 600;
  color: #fff;
}
.scene.still {
  background: linear-gradient(180deg, rgba(60, 198, 201, 0.28), rgba(60, 198, 201, 0.12));
  box-shadow: inset 0 0 0 1px rgba(60, 198, 201, 0.45);
}
.scene.card {
  background: linear-gradient(180deg, rgba(242, 179, 74, 0.26), rgba(242, 179, 74, 0.1));
  box-shadow: inset 0 0 0 1px rgba(242, 179, 74, 0.45);
}
.item {
  position: absolute;
  height: 18px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  padding: 0 8px;
  white-space: nowrap;
  overflow: hidden;
  min-width: 6px;
}
.item span {
  position: relative;
  z-index: 2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item.zoom {
  background: rgba(90, 162, 255, 0.16);
  box-shadow: inset 0 0 0 1px rgba(90, 162, 255, 0.55);
  color: var(--zoom);
}
.item.mask {
  background: rgba(167, 123, 255, 0.15);
  box-shadow: inset 0 0 0 1px rgba(167, 123, 255, 0.5);
  color: var(--mask);
}
.item.caption {
  background: rgba(79, 209, 161, 0.13);
  box-shadow: inset 0 0 0 1px rgba(79, 209, 161, 0.5);
  color: var(--caption);
}
.item.off {
  background-image: repeating-linear-gradient(135deg, transparent 0 5px, rgba(255, 255, 255, 0.05) 5px 10px);
  opacity: 0.6;
}
.tl-canvas {
  position: absolute;
  left: 0;
  top: 0;
}
/* the playhead's knob sits at the foot of the markers row, clear of the ruler's labels */
.playhead {
  position: absolute;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--accent);
  pointer-events: none;
  z-index: 3;
}
.playhead::before {
  content: '';
  position: absolute;
  top: 0;
  left: -5px;
  width: 12px;
  height: 8px;
  border-radius: 2px 2px 6px 6px;
  background: var(--accent);
}

/* export sheet */
.scrim {
  position: fixed;
  inset: 44px 0 0 0;
  background: rgba(6, 6, 9, 0.55);
  display: grid;
  place-items: start center;
  padding-top: 64px;
  z-index: 10;
  animation: fade var(--normal) var(--ease-out);
}
.sheet {
  width: 440px;
  background: var(--panel);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-float);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: rise var(--normal) var(--ease-out);
}
.sheet h2 {
  margin: 0;
  font-size: var(--size-l);
  font-weight: 600;
}
.sheet .formats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
  gap: 8px;
}
.format {
  border-radius: 10px;
  background: var(--raised);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  color: var(--muted);
  box-shadow: inset 0 0 0 1px var(--line);
  transition: box-shadow var(--fast), color var(--fast);
}
.format[aria-pressed='true'] {
  color: var(--text);
  box-shadow: inset 0 0 0 2px var(--text);
}
.format .shape-box {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
}
.format .shape {
  border: 1.5px solid currentColor;
  border-radius: 3px;
}
.format small {
  color: var(--muted);
  font-size: var(--size-xs);
}
.sheet .note {
  color: var(--muted);
  font-size: var(--size-s);
  line-height: 1.45;
}
.sheet .note b {
  color: var(--text);
  font-weight: 500;
  font-feature-settings: 'calt' 0;
}
.checks {
  margin: 0;
  padding: 10px 12px 10px 30px;
  border-radius: 9px;
  background: var(--raised);
  color: var(--muted);
  font-size: var(--size-s);
  line-height: 1.5;
}
.checks li::marker {
  color: var(--card);
}
.sheet .row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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
  flex-direction: column;
  gap: 6px;
}
.progress .track {
  height: 6px;
  border-radius: 3px;
  background: var(--raised);
  overflow: hidden;
}
.progress .track i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 100ms linear;
}
.progress .meta {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: var(--size-s);
  font-variant-numeric: tabular-nums;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 9px;
  background: var(--raised);
  font-size: var(--size-s);
  /* Inter's contextual alternates would draw 16x9.mp4 as 16×9.mp4 */
  font-feature-settings: 'calt' 0;
}
.file-row div {
  flex: 1;
  min-width: 0;
}
.file-row small {
  display: block;
  color: var(--muted);
}
.sheet .actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.error-text {
  color: var(--danger);
  font-size: var(--size-s);
  white-space: pre-wrap;
  max-height: 160px;
  overflow: auto;
}

/* loading and errors */
.loading {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  background: var(--bg);
}
.app.failed {
  grid-template-rows: 44px minmax(0, 1fr);
  grid-template-columns: minmax(0, 1fr);
}
.app.failed .titlebar {
  grid-column: 1;
}
.failed-view {
  display: grid;
  place-items: center;
  padding: 40px;
  overflow: auto;
}
.failed-view > div {
  max-width: 560px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.failed-view h1 {
  font-size: var(--size-xl);
  font-weight: 600;
  margin: 6px 0 0;
}
.failed-view p {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.failed-view .actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
/* the spinner shows only when opening takes a while (no flash for a quick open) */
.spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid var(--raised);
  border-top-color: var(--accent);
  animation:
    appear 1ms 400ms backwards,
    spin 900ms linear infinite;
  margin: 0 auto;
}

.spinner.small {
  width: 12px;
  height: 12px;
  border-width: 2px;
  margin: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes appear {
  from {
    visibility: hidden;
  }
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}

/* ---- editing ---------------------------------------------------------------------------------- */

/* title bar: whether every edit is on disk; Undo and Redo */
.seg.icons button {
  width: 28px;
  height: 24px;
  padding: 0;
  display: grid;
  place-items: center;
}
.seg.icons button:disabled {
  opacity: 0.35;
}
.save-state {
  color: var(--faint);
  font-size: var(--size-s);
  white-space: nowrap;
}
.save-state.warn {
  color: var(--card);
}

/* the tools, beside the video */
.tools {
  grid-row: 2;
  grid-column: 1;
  background: var(--panel);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 0;
  min-height: 0;
}
.tools button {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  color: var(--muted);
  transition:
    background var(--fast),
    color var(--fast);
}
.tools button:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.tools button[aria-pressed='true'] {
  background: var(--raised-active);
  color: var(--text);
}
.tools [data-testid='tool-zoom'][aria-pressed='true'] {
  background: rgba(90, 162, 255, 0.16);
  color: var(--zoom);
}
.tools [data-testid='tool-mask'][aria-pressed='true'] {
  background: rgba(167, 123, 255, 0.16);
  color: var(--mask);
}
.tools [data-testid='tool-caption'][aria-pressed='true'] {
  background: rgba(79, 209, 161, 0.14);
  color: var(--caption);
}
.tools kbd {
  position: absolute;
  right: 2px;
  bottom: 1px;
  padding: 0 2px;
  background: none;
  font-size: 8.5px;
  line-height: 1.2;
  color: var(--faint);
}
.tools button[aria-pressed='true'] kbd {
  color: inherit;
  opacity: 0.8;
}

/* the video and what the tools draw on it */
.frame {
  position: relative;
}
.frame canvas {
  display: block;
}
.app[data-tool='caption'] .frame canvas {
  cursor: text;
}
.frame canvas.over-caption {
  cursor: pointer;
}
.caption-box {
  position: absolute;
  border-radius: 6px;
  box-shadow: 0 0 0 1px rgba(79, 209, 161, 0.7);
  pointer-events: none;
}
.caption-box.selected {
  box-shadow:
    0 0 0 2px var(--caption),
    0 0 0 5px rgba(79, 209, 161, 0.18);
}

/* the caption tool: typed on the video, away from where the caption goes */
.caption-bar {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: min(580px, calc(100% - 24px));
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 12px;
  background: var(--overlay);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(10px);
  z-index: 2;
  animation: fade var(--normal) var(--ease-out);
}
.caption-bar.near-top {
  top: 12px;
}
.caption-bar.near-bottom {
  bottom: 12px;
}
.caption-bar input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: var(--raised);
  box-shadow: inset 0 0 0 1px var(--line-strong);
  user-select: text;
}
.caption-bar input:focus {
  box-shadow: inset 0 0 0 1px var(--caption);
}
.caption-bar input::placeholder {
  color: var(--faint);
}
.caption-bar .seg {
  flex: none;
}
.primary.small {
  height: 30px;
  padding: 0 12px;
}

/* the source view: the screen at the playhead, with the zooms and masks on it */
.source-view {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: var(--stage);
  overflow: hidden;
  cursor: crosshair;
}
.app[data-tool='select'] .source-view,
.app[data-tool='caption'] .source-view {
  cursor: default;
}
.source-view canvas {
  position: absolute;
  left: 0;
  top: 0;
  box-shadow: none;
  border-radius: 0;
  background: none;
}
.zoom-dim {
  position: absolute;
  inset: 0;
  background: rgba(6, 6, 9, 0.6);
  pointer-events: none;
}
.source-box {
  position: absolute;
  border-radius: 2px;
  cursor: move;
}
.source-box.zoom {
  box-shadow:
    0 0 0 1.5px var(--zoom),
    0 0 0 4px rgba(90, 162, 255, 0.16);
}
.source-box.mask {
  box-shadow: 0 0 0 1.5px var(--mask);
  background: repeating-linear-gradient(135deg, rgba(167, 123, 255, 0.26) 0 6px, rgba(167, 123, 255, 0.1) 6px 12px);
}
.source-box.selected.zoom {
  box-shadow:
    0 0 0 2px var(--zoom),
    0 0 0 6px rgba(90, 162, 255, 0.2);
}
.source-box.selected.mask {
  box-shadow:
    0 0 0 2px var(--mask),
    0 0 0 6px rgba(167, 123, 255, 0.2);
}
/* a selected item the playhead is not on: drawn faint */
.source-box.elsewhere {
  opacity: 0.55;
}
.source-box.drawing {
  pointer-events: none;
}
.box-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 2px;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
}
/* a larger target than it looks */
.box-handle::before {
  content: '';
  position: absolute;
  inset: -6px;
}
.box-handle.nw {
  left: 0;
  top: 0;
  cursor: nwse-resize;
}
.box-handle.n {
  left: 50%;
  top: 0;
  cursor: ns-resize;
}
.box-handle.ne {
  left: 100%;
  top: 0;
  cursor: nesw-resize;
}
.box-handle.e {
  left: 100%;
  top: 50%;
  cursor: ew-resize;
}
.box-handle.se {
  left: 100%;
  top: 100%;
  cursor: nwse-resize;
}
.box-handle.s {
  left: 50%;
  top: 100%;
  cursor: ns-resize;
}
.box-handle.sw {
  left: 0;
  top: 100%;
  cursor: nesw-resize;
}
.box-handle.w {
  left: 0;
  top: 50%;
  cursor: ew-resize;
}
.source-chip {
  position: absolute;
  top: 10px;
  left: 10px;
  max-width: calc(100% - 190px);
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--overlay);
  box-shadow: var(--shadow-float);
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font-size: var(--size-s);
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;
  z-index: 2;
}
.source-chip b {
  color: var(--text);
  font-weight: 600;
}
.source-chip .sep {
  width: 1px;
  height: 12px;
  margin: 0 6px;
  background: var(--line-strong);
  flex: none;
}
.source-close {
  position: absolute;
  top: 10px;
  right: 10px;
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--overlay);
  box-shadow: var(--shadow-float);
  font-size: var(--size-s);
  z-index: 2;
  cursor: default;
}
.source-close:hover {
  background: var(--raised-hover);
}

/* cuttle.json does not parse: editing waits */
.banner {
  position: absolute;
  top: 12px;
  left: 24px;
  right: 24px;
  z-index: 3;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #261f14;
  box-shadow:
    var(--shadow-float),
    inset 0 0 0 1px rgba(242, 179, 74, 0.35);
}
.banner > svg {
  color: var(--card);
  margin-top: 1px;
}
.banner > div {
  flex: 1;
  min-width: 0;
}
.banner b {
  font-weight: 600;
}
.banner p {
  margin: 3px 0 6px;
  color: var(--muted);
  font-size: var(--size-s);
  line-height: 1.45;
}
.banner ul {
  margin: 0;
  padding-left: 16px;
  font: var(--size-xs) / 1.5 var(--mono);
  color: #ead6ad;
  overflow-wrap: anywhere;
  user-select: text;
}

/* what just happened, with Undo */
.toast {
  position: absolute;
  left: 50%;
  bottom: 62px;
  transform: translateX(-50%);
  max-width: min(640px, calc(100% - 48px));
  min-height: 36px;
  padding: 4px 6px 4px 14px;
  border-radius: 10px;
  background: var(--overlay);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--size-s);
  z-index: 4;
  animation: toast-in var(--normal) var(--ease-out);
}
/* two lines at most: a draft note says what happened and where your version is */
.toast span {
  min-width: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 1.4;
}
.toast.warn > svg {
  color: var(--card);
}
.toast-undo {
  height: 26px;
  padding: 0 10px;
  border-radius: 7px;
  color: var(--accent);
  font-weight: 600;
  flex: none;
}
.toast-undo:hover {
  background: var(--raised);
}
.toast-close {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--muted);
  flex: none;
}
.toast-close:hover {
  background: var(--raised);
  color: var(--text);
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, 8px);
  }
}

/* the command menu (Ctrl+K) */
.menu-scrim {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: start center;
  padding-top: 12vh;
  background: rgba(6, 6, 9, 0.4);
  animation: fade var(--fast) var(--ease-out);
}
.command-menu {
  width: min(560px, calc(100vw - 48px));
  max-height: 64vh;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-float);
  overflow: hidden;
  animation: rise var(--normal) var(--ease-out);
}
.command-menu input {
  flex: none;
  height: 48px;
  padding: 0 16px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: none;
  font-size: var(--size-l);
  user-select: text;
}
.command-menu input::placeholder {
  color: var(--faint);
}
.command-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px;
}
.command-list .hint {
  margin: 0;
  padding: 12px 10px;
}
.command-group {
  padding: 10px 10px 4px;
  color: var(--faint);
  font-size: var(--size-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.command {
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.command[data-active='true'] {
  background: var(--raised-active);
}
.command[aria-disabled='true'] {
  color: var(--faint);
}
.command-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.command em {
  flex: none;
  color: var(--faint);
  font-size: var(--size-xs);
  font-style: normal;
}
.command-foot {
  flex: none;
  display: flex;
  gap: 16px;
  padding: 8px 14px;
  border-top: 1px solid var(--line);
  color: var(--faint);
  font-size: var(--size-xs);
}
.command-foot kbd {
  margin-right: 3px;
}

/* inspector fields */
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.field .field-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
}
.field-input {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 28px;
}
.field-input em {
  color: var(--muted);
  font-size: var(--size-s);
  font-style: normal;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.field input[type='text'],
.field input[type='number'],
.field textarea,
.field select {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: var(--raised);
  box-shadow: inset 0 0 0 1px var(--line);
  color: var(--text);
  font: inherit;
  user-select: text;
  transition: box-shadow var(--fast);
}
.field textarea {
  height: auto;
  min-height: 52px;
  padding: 6px 8px;
  resize: vertical;
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
.field input[type='number']::-webkit-inner-spin-button {
  opacity: 0.3;
}
.field-input.narrow input {
  flex: 0 0 76px;
}
.field input[type='color'] {
  width: 40px;
  height: 26px;
  padding: 0;
  border: 0;
  background: none;
  flex: none;
}
.field input[type='color']::-webkit-color-swatch-wrapper {
  padding: 0;
}
.field input[type='color']::-webkit-color-swatch {
  border: 0;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px var(--line-strong);
}
.grid4 {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.grid4 .field-input {
  position: relative;
}
.grid4 .field-input em {
  position: absolute;
  left: 7px;
  font-size: var(--size-xs);
  color: var(--faint);
  pointer-events: none;
}
.grid4 input[type='number'] {
  padding: 0 4px 0 17px;
}
/* four numbers in a row: room for 4 digits, the arrow keys step them */
.grid4 input[type='number']::-webkit-inner-spin-button {
  display: none;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chips button {
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  background: var(--raised);
  color: var(--muted);
  font-size: var(--size-s);
  font-weight: 500;
  transition:
    background var(--fast),
    color var(--fast);
}
.chips button:hover {
  color: var(--text);
}
.chips button[aria-pressed='true'] {
  background: var(--raised-active);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--line-strong);
}
.toggle {
  position: relative;
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--raised-active);
  flex: none;
  transition: background var(--fast);
}
.toggle i {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--muted);
  transition:
    transform var(--fast) var(--ease-out),
    background var(--fast);
}
.toggle[aria-checked='true'] {
  background: var(--accent);
}
.toggle[aria-checked='true'] i {
  transform: translateX(14px);
  background: #fff;
}
.swatches {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.swatch-button {
  height: 46px;
  border-radius: 8px;
  display: flex;
  align-items: flex-end;
  padding: 4px 6px;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px var(--line-strong);
  transition: box-shadow var(--fast);
}
.swatch-button span {
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
}
.swatch-button[aria-pressed='true'] {
  box-shadow:
    0 0 0 2px var(--accent),
    inset 0 0 0 1px rgba(0, 0, 0, 0.3);
}
/* the swatches look like the engine's presets (packages/engine/src/presets/backgrounds.ts) */
.bg-sunset-sky {
  background: linear-gradient(180deg, #1b1c4a, #b85679 62%, #f9a866);
}
.bg-aurora {
  background:
    linear-gradient(180deg, transparent 28%, rgba(51, 242, 166, 0.45) 36%, transparent 44%),
    linear-gradient(180deg, transparent 42%, rgba(64, 153, 255, 0.4) 50%, transparent 58%),
    linear-gradient(180deg, transparent 54%, rgba(184, 92, 242, 0.4) 62%, transparent 72%),
    linear-gradient(180deg, #050816, #0a1126);
}
.bg-mesh {
  background:
    radial-gradient(circle at 15% 20%, #7c5cff 0, transparent 60%),
    radial-gradient(circle at 85% 18%, #ff7ab6 0, transparent 60%),
    radial-gradient(circle at 20% 88%, #4cc9f0 0, transparent 60%),
    radial-gradient(circle at 80% 82%, #ffb86b 0, transparent 60%),
    #a07ad0;
}
.bg-solid {
  background: #1c1c22;
}
.bg-image {
  background: repeating-linear-gradient(45deg, var(--raised) 0 6px, var(--raised-hover) 6px 12px);
}
.path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font: var(--size-xs) var(--mono);
}
.ghost.small {
  height: 26px;
  padding: 0 10px;
  flex: none;
}
.link {
  color: var(--accent);
  font-size: var(--size-xs);
  font-weight: 500;
}
.link:hover {
  text-decoration: underline;
}

/* timeline: dragging */
.edge {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  z-index: 3;
  cursor: ew-resize;
}
.edge.start {
  left: 0;
}
.edge.end {
  right: 0;
}
.item .edge {
  width: 6px;
}
.scene:hover .edge::after,
.item:hover .edge::after,
.selected .edge::after {
  content: '';
  position: absolute;
  top: 28%;
  bottom: 28%;
  left: 3px;
  width: 2px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.6);
}
.item .edge::after {
  left: 2px;
}
.snap-guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  margin-left: -0.5px;
  background: rgba(255, 255, 255, 0.75);
  z-index: 4;
  pointer-events: none;
}
.insert-mark {
  position: absolute;
  width: 3px;
  margin-left: -1.5px;
  border-radius: 2px;
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  z-index: 4;
  pointer-events: none;
}
.tl-sep {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--line-strong);
  flex: none;
}
.tl-bar .act:disabled:hover {
  background: none;
  color: var(--muted);
}
.tl-bar .act[aria-pressed='true'] {
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
.scene .lbl .detail {
  color: #a9a9b2;
  font-weight: 400;
}
/* one overlay shown by several clips: its blocks light up together */
.item.linked:not(.selected)::after {
  box-shadow: inset 0 0 0 1.5px currentColor;
}
/* the lane label's count of overlays no clip shows, and their list */
.tl-names .cut-out {
  color: var(--card);
  font-size: 10px;
  line-height: 1.2;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}
.tl-names .cut-out:hover {
  color: var(--text);
}
.cut-out-list {
  position: fixed;
  z-index: 15;
  min-width: 200px;
  max-width: 320px;
  padding: 6px;
  border-radius: 10px;
  background: var(--panel);
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  animation: fade var(--fast) var(--ease-out);
}
.cut-out-head {
  padding: 4px 8px 6px;
  color: var(--faint);
  font-size: var(--size-xs);
}
.cut-out-list button {
  height: 28px;
  padding: 0 8px;
  border-radius: 7px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cut-out-list button:hover,
.cut-out-list button:focus-visible {
  background: var(--raised-active);
}
```

- [ ] **Step 6: Typecheck and build**

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0, no output.

Run: `pnpm exec tsc -p packages/engine/tsconfig.json`
Expected: exits with code 0, no output.

Run: `pnpm app:build:js`
Expected: exits with code 0 and ends with `built apps/desktop/dist`.

- [ ] **Step 7: Commit**

```bash
git add packages/engine apps/desktop/src/renderer
git commit -m "desktop: editing: undo and redo, the tools and the source view, timeline edits, the inspector and the look, the command menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The end-to-end checks

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: Editing in the check**

In `apps/desktop/test/app.check.test.ts`, replace:

```ts

/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
 * output view with the export's frames (`cuttle preview`), play the proxy, export, open a project
 * twice at once, close an editor during its export, close the pill; record through the picker with
 * the recorder's `test` backend, stop from the HUD, and land in the take cut by suggest; record
 * again. Runs only with `pnpm app:check` (vitest --mode app, after app:build:js and cli:build).
```

with:

```ts

/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
 * output view with the export's frames (`cuttle preview`), play the proxy, export; edit (split,
 * trim, move, speed, zooms and masks drawn in the source view, a caption typed on the video, the
 * command menu), undo and redo, each checked in the file; a write from outside during a drag, a
 * broken file, a save conflict kept as a draft; open a project
 * twice at once, close an editor during its export, close the pill; record through the picker with
 * the recorder's `test` backend, stop from the HUD, and land in the take cut by suggest; record
 * again. Runs only with `pnpm app:check` (vitest --mode app, after app:build:js and cli:build).
```

In the same file, replace:

```ts
  playback(): { drawn: number; restarts: number; clock: number };
  pixels(): string;
  useProxy(): Promise<boolean>;
}

const electronPath = (): string => createRequire(import.meta.url)('electron') as unknown as string;
```

with:

```ts
  playback(): { drawn: number; restarts: number; clock: number };
  pixels(): string;
  useProxy(): Promise<boolean>;
  doc(): { hash: string; saving: boolean; problem?: string; issues?: string[]; toast?: { text: string; undo?: boolean; draft?: boolean }; undo?: string; redo?: string };
  flush(): Promise<void>;
}

/** cuttle.json as the checks read it back. */
interface Written {
  scenes: { id: string; type: string; from?: number; to?: number; speed?: number }[];
  zooms: { id: string; at: number; duration: number; rect: number[] }[];
  masks: { id: string; from: number; to: number; rect: number[]; style?: string; label?: string }[];
  texts: { id: string; text: string; position?: string }[];
}

const electronPath = (): string => createRequire(import.meta.url)('electron') as unknown as string;
```

In the same file, replace:

```ts
      });
    });
    await editor.setViewportSize({ width: 1440, height: 900 });
    await editor.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 60_000);
```

with:

```ts
      });
    });
    await editor.setViewportSize({ width: 1440, height: 900 });
    // A window that is never shown runs no CSS animations: without motion, what opens shows at once in the screenshots.
    await editor.emulateMedia({ reducedMotion: 'reduce' });
    await editor.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 60_000);
```

In the same file, replace:

```ts
  it('opens the project: the timeline shows its scenes, overlays and markers', async () => {
    expect(await editor.title()).toBe('demo · Cuttle');
    expect(await editor.locator('.scene').count()).toBe(5);
    expect(await editor.locator('.scene').first().getAttribute('title')).toBe('Prompt · 3 s');
    expect(await editor.locator('.item.zoom').count()).toBe(1);
    // the mask (source 0–9) runs across the continuous cut into the 8× clip as one block, then
    // shows again after the jump cut to source 8.5
```

with:

```ts
  it('opens the project: the timeline shows its scenes, overlays and markers', async () => {
    expect(await editor.title()).toBe('demo · Cuttle');
    expect(await editor.locator('.scene').count()).toBe(5);
    expect(await editor.locator('.scene').first().getAttribute('title')).toBe('Prompt · 3 s · drag to move, edges to trim');
    expect(await editor.locator('.item.zoom').count()).toBe(1);
    // the mask (source 0–9) runs across the continuous cut into the 8× clip as one block, then
    // shows again after the jump cut to source 8.5
```

In the same file, replace:

```ts
    const { t } = await state();
    expect(t).toBeGreaterThan(duration * 0.3);
    expect(t).toBeLessThan(duration * 0.7);
    // dragging across a scene scrubs too, and leaves the selection alone
    await seek(0);
    await press('.scene:nth-child(1)', 60);
    await editor.waitForTimeout(300);
    expect((await state()).t).toBeGreaterThan(0);
    expect(await editor.locator('.scene.selected').count()).toBe(0);
    // a click selects the 8× clip and shows it in the inspector
    await press('.scene:nth-child(2)');
    await editor.waitForSelector('.scene.selected');
    expect(await editor.locator('.inspector .kind-head .name').textContent()).toBe('8× Claude at work');
    await shot('03-selected');
    await editor.keyboard.press('Escape');
```

with:

```ts
    const { t } = await state();
    expect(t).toBeGreaterThan(duration * 0.3);
    expect(t).toBeLessThan(duration * 0.7);
    // a click selects the 8× clip, puts the playhead there and shows it in the inspector
    await seek(0);
    await press('.scene[data-id=s2]');
    await editor.waitForSelector('.scene.selected');
    await expect.poll(async () => (await state()).t).toBeGreaterThan(3);
    expect(await editor.locator('.inspector .kind-head .name').textContent()).toBe('8× Claude at work');
    await shot('03-selected');
    await editor.keyboard.press('Escape');
```

In the same file, replace:

```ts
    expect(await editor.locator('[data-testid=export-sheet]').count()).toBe(0);
  }, 150_000);

  it('opens a project once when asked twice at once, and cancels its export when it closes', async () => {
    const second = join(root, 'second');
    cpSync(project, second, { recursive: true, filter: (path) => !/[\\/](\.cuttle|out)$/.test(path) });
```

with:

```ts
    expect(await editor.locator('[data-testid=export-sheet]').count()).toBe(0);
  }, 150_000);

  // ---- editing: every edit is checked in the file ----------------------------------------------

  const projectFile = () => join(project, 'cuttle.json');
  const onDisk = (): Written => JSON.parse(readFileSync(projectFile(), 'utf8')) as Written;
  /** Waits until cuttle.json passes `ready` (an edit is saved when its gesture ends). */
  const savedWhen = (ready: (file: Written) => boolean) =>
    expect
      .poll(
        () => {
          try {
            return ready(onDisk());
          } catch {
            return false;
          }
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  const doc = () => editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.doc());
  /** Undoes until there is nothing left to undo (Ctrl+Z), and waits for the last save. */
  const undoAll = async () => {
    while ((await doc()).undo) await editor.keyboard.press('Control+Z');
    await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
  };
  /**
   * A drag on an element (a window that is never shown gets no real mouse): pressed at `from` (a
   * fraction of its box), moved by `by` px in eight steps, released unless `hold`; `release`
   * ends a held one `by` px further on.
   */
  const drag = (selector: string, by: [number, number], options: { from?: [number, number]; hold?: boolean } = {}) =>
    editor.evaluate(
      ({ selector, by, from, hold }) => {
        const element = document.querySelector(selector)!;
        const box = element.getBoundingClientRect();
        const start = { x: box.left + from[0] * box.width, y: box.top + from[1] * box.height };
        const fire = (type: string, x: number, y: number) =>
          element.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7 }));
        fire('pointerdown', start.x, start.y);
        for (let step = 1; step <= 8; step++) fire('pointermove', start.x + (by[0] * step) / 8, start.y + (by[1] * step) / 8);
        const end = { x: start.x + by[0], y: start.y + by[1] };
        if (hold) Object.assign(window, { __held: end });
        else fire('pointerup', end.x, end.y);
      },
      { selector, by, from: options.from ?? [0.5, 0.5], hold: options.hold ?? false },
    );
  const release = (by: [number, number]) =>
    editor.evaluate((by) => {
      const at = (window as unknown as { __held: { x: number; y: number } }).__held;
      const fire = (type: string, x: number, y: number) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7 }));
      for (let step = 1; step <= 8; step++) fire('pointermove', at.x + (by[0] * step) / 8, at.y + (by[1] * step) / 8);
      fire('pointerup', at.x + by[0], at.y + by[1]);
    }, by);

  it('splits, trims and moves scenes and sets a speed; undo and redo step through it, back to the file as it was, byte for byte', async () => {
    await editor.keyboard.press('Escape');
    const original = readFileSync(projectFile(), 'utf8');
    await seek(1);
    await editor.keyboard.press('s');
    await savedWhen((file) => file.scenes.length === 6);
    const [first, second] = onDisk().scenes;
    // a continuous cut at the playhead's source second
    expect(first!.to).toBeCloseTo(1, 3);
    expect(second!.from).toBe(first!.to);
    expect((await doc()).undo).toBe('Split clip');
    await editor.keyboard.press('Control+Z');
    await savedWhen((file) => file.scenes.length === 5);
    expect((await doc()).redo).toBe('Split clip');
    await editor.keyboard.press('Control+Shift+Z');
    await savedWhen((file) => file.scenes.length === 6);

    // the first clip's end edge, 30 px to the left: shorter at its end
    await drag('.scene[data-id=s1] .edge.end', [-30, 0]);
    await savedWhen((file) => file.scenes[0]!.to! < first!.to! - 0.1);
    expect((await doc()).undo).toBe('Trim clip');

    // the card, dragged before everything; the video shows it there (the renderer has the new order)
    await drag('.scene[data-id=s5]', [-2000, 0]);
    await savedWhen((file) => file.scenes[0]!.id === 's5');
    expect((await doc()).undo).toBe('Move scene');
    await seek(0.5);
    await expect.poll(async () => (await state()).source).toBeUndefined();
    expect((await state()).error).toBeUndefined();
    await shot('07-edited');

    // the 8× clip at 2×, from the timeline bar
    await press('.scene[data-id=s2]');
    await editor.selectOption('#speed-select', '2');
    await savedWhen((file) => file.scenes.find((scene) => scene.id === 's2')!.speed === 2);

    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('draws a zoom and a mask in the source view, moves and resizes them there, and sets the mask in the inspector', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await seek(1);
    await editor.keyboard.press('z');
    await editor.waitForSelector('[data-testid=source-view]');
    // a zoom drawn on the screen keeps its shape (1280×800): what is drawn is what it shows
    await drag('[data-testid=source-view]', [240, 60], { from: [0.3, 0.3] });
    await savedWhen((file) => file.zooms.length === 2);
    const zoom = onDisk().zooms.find((item) => item.id !== 'z1')!;
    expect(zoom.at).toBeCloseTo(1, 1);
    expect(zoom.rect[2]! / zoom.rect[3]!).toBeCloseTo(1280 / 800, 1);
    await editor.waitForSelector('.source-box.zoom.selected');
    await shot('08-source-view');
    // its corner handle makes it larger, its body moves it
    await drag('.source-box.selected .box-handle.se', [60, 0]);
    await savedWhen((file) => file.zooms.find((item) => item.id === zoom.id)!.rect[2]! > zoom.rect[2]! + 20);
    const larger = onDisk().zooms.find((item) => item.id === zoom.id)!;
    expect(larger.rect[2]! / larger.rect[3]!).toBeCloseTo(1280 / 800, 1);
    await drag('.source-box.selected', [-40, -20]);
    await savedWhen((file) => file.zooms.find((item) => item.id === zoom.id)!.rect[0]! < larger.rect[0]! - 20);
    // Esc: back to the video
    await editor.keyboard.press('Escape');
    expect(await editor.locator('[data-testid=source-view]').count()).toBe(0);

    // a mask is free in its shape
    await editor.keyboard.press('m');
    await drag('[data-testid=source-view]', [160, 30], { from: [0.55, 0.6] });
    await savedWhen((file) => file.masks.length === 2);
    const mask = onDisk().masks.find((item) => item.id !== 'm1')!;
    expect(mask.rect[2]! / mask.rect[3]!).toBeGreaterThan(3);
    await editor.selectOption('.inspector label.field:has-text("Style") select', 'blur');
    await savedWhen((file) => file.masks.find((item) => item.id === mask.id)!.style === 'blur');
    await shot('08-mask');
    // the look: a background swatch
    await click(editor, '#tab-look');
    await click(editor, '.swatch-button.bg-mesh');
    await savedWhen((file) => (file as unknown as { look: { background: { preset: string } } }).look.background.preset === 'mesh');
    await shot('08-look');
    await click(editor, '#tab-selection');
    await editor.keyboard.press('Escape');
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('types a caption on the video, selects it there with a click, and edits its text in the inspector', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await seek(1.2);
    await editor.keyboard.press('t');
    await editor.waitForSelector('[data-testid=caption-input]:focus');
    await editor.keyboard.type('Ship it');
    // shown while typed, saved on Enter
    await shot('09-caption-typed');
    expect(onDisk().texts).toHaveLength(1);
    await editor.keyboard.press('Enter');
    // at the top: the fixture's caption is at the bottom there
    await savedWhen((file) => file.texts.some((text) => text.text === 'Ship it' && text.position === 'top'));
    await editor.waitForSelector('.caption-box.selected');
    const box = (await editor.locator('.caption-box.selected').boundingBox())!;
    await shot('09-caption');
    await editor.keyboard.press('Escape');
    expect(await editor.locator('.caption-box.selected').count()).toBe(0);
    // a click on it selects it again
    await editor.evaluate(({ x, y }) => {
      const canvas = document.querySelector('[data-testid=output]')!;
      for (const type of ['pointermove', 'pointerdown', 'pointerup']) canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 7 }));
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await editor.waitForSelector('.caption-box.selected');
    await editor.fill('[data-testid=caption-text]', 'Ship it today');
    await editor.locator('[data-testid=caption-text]').blur();
    await savedWhen((file) => file.texts.some((text) => text.text === 'Ship it today'));
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('runs a command from the menu (Ctrl+K), by typing part of its name', async () => {
    await seek(1);
    await editor.keyboard.press('Control+K');
    await editor.waitForSelector('[data-testid=command-input]:focus');
    await editor.keyboard.type('split');
    await shot('10-command-menu');
    await editor.keyboard.press('Enter');
    expect(await editor.locator('[data-testid=command-input]').count()).toBe(0);
    await savedWhen((file) => file.scenes.length === 6);
    await undoAll();
  }, 30_000);

  it('keeps a drag going over a version written outside the app meanwhile: both are in the file, each undone on its own', async () => {
    await press('.item.zoom');
    await drag('.item.zoom', [40, 0], { hold: true });
    // Claude writes cuttle.json during the drag: a mask added
    const outside = onDisk();
    outside.masks.push({ id: 'm9', label: 'From Claude', from: 1, to: 2, rect: [10, 10, 100, 40] });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.waitForFunction(() => (window as unknown as Hooked).__cuttleCheck.doc().toast?.text === 'Changed outside the app: 1 mask added');
    expect(await editor.locator('[data-testid=toast-show]').count()).toBe(1);
    await shot('11-outside-change');
    await release([40, 0]);
    await savedWhen((file) => file.masks.length === 2 && file.zooms[0]!.at > 8.8 + 0.1);
    expect((await doc()).undo).toBe('Move zoom');
    await editor.keyboard.press('Control+Z');
    await savedWhen((file) => file.zooms[0]!.at === 8.8 && file.masks.length === 2);
    expect((await doc()).undo).toBe('the outside change');
    await editor.keyboard.press('Control+Z');
    await savedWhen((file) => file.masks.length === 1);
  }, 30_000);

  it('keeps the last good version while cuttle.json does not parse, and takes the fix', async () => {
    const good = readFileSync(projectFile(), 'utf8');
    writeFileSync(projectFile(), '{ "version": 1, "scenes": [ }');
    await editor.waitForSelector('[data-testid=issues]');
    expect(await editor.locator('[data-testid=save-state]').textContent()).toBe('Editing waits');
    await shot('12-broken-file');
    // an edit waits too: the broken file stays as it is
    await seek(1);
    await editor.keyboard.press('s');
    await editor.waitForTimeout(500);
    expect(readFileSync(projectFile(), 'utf8')).toBe('{ "version": 1, "scenes": [ }');
    writeFileSync(projectFile(), good);
    await editor.waitForSelector('[data-testid=issues]', { state: 'detached' });
    expect((await doc()).issues).toBeUndefined();
  }, 30_000);

  it('keeps an edit a newer version cannot take in cuttle.json.draft, and puts it back on "Use mine"', async () => {
    await press('.item.zoom');
    // Claude deletes the zoom just as it is deleted here (before the app sees Claude's write)
    const outside = onDisk();
    outside.zooms = [];
    outside.masks.push({ id: 'm9', label: 'From Claude', from: 1, to: 2, rect: [10, 10, 100, 40] });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.keyboard.press('Delete');
    await editor.waitForFunction(() => (window as unknown as Hooked).__cuttleCheck.doc().toast?.draft === true);
    // the newer version shows; the person's is kept, with the zoom deleted and without Claude's mask
    const draft = JSON.parse(readFileSync(join(project, 'cuttle.json.draft'), 'utf8')) as Written;
    expect(draft.zooms).toEqual([]);
    expect(draft.masks.map((item) => item.id)).toEqual(['m1']);
    expect(onDisk().masks.map((item) => item.id)).toEqual(['m1', 'm9']);
    await shot('13-draft');
    await click(editor, '[data-testid=toast-use-draft]');
    await savedWhen((file) => file.masks.length === 1 && file.zooms.length === 0);
    expect((await doc()).undo).toBe('Use your version');
    await undoAll();
  }, 30_000);

  it('opens a project once when asked twice at once, and cancels its export when it closes', async () => {
    const second = join(root, 'second');
    cpSync(project, second, { recursive: true, filter: (path) => !/[\\/](\.cuttle|out)$/.test(path) });
```

In the same file, replace:

```ts
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${made} · Cuttle`);
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    expect(await opened.locator('[data-testid=project-status]').count()).toBe(0);
    expect(await opened.locator('.scene').count()).toBe(cut.scenes.length);
  }, 120_000);
```

with:

```ts
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${made} · Cuttle`);
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    expect(await opened.locator('[data-testid=project-status]').count()).toBe(0);
    // the cut came in as a change of the file: one step to undo
    await expect.poll(() => opened.evaluate(() => (window as unknown as { __cuttleCheck: Check }).__cuttleCheck.doc().undo), { timeout: 10_000 }).toBe('Cut by suggest');
    expect(await opened.locator('.scene').count()).toBe(cut.scenes.length);
  }, 120_000);
```

- [ ] **Step 2: Run it**

Run: `pnpm app:check`
Expected: PASS, 22 tests (about a minute and a half). No window shows on the screen; every edit is checked in cuttle.json.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test
git commit -m "desktop: app:check edits (split, trim, move, speed, a zoom and a mask drawn, a caption typed, the menu), undoes and redoes, and writes from outside mid-drag, broken and conflicting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs and final verification

- [ ] **Step 1: The README**

In `README.md`, replace:

````markdown
```bash
pnpm app                                 # build and start the app (the pill near the top of the screen, an icon in the tray)
pnpm app -- --open <project folder>      # … and open a project in the editor
pnpm app:check                           # end to end with its windows hidden: open, play, scrub, select, compare with the export, play the proxy, export, record
pnpm app:build                           # an unpacked app in apps/desktop/build/Cuttle-<platform>-<arch>/, checked that it starts
```

The editor shows exactly what the export renders: the same engine and timeline, compared pixel for
pixel by `app:check`. It plays a 720p proxy of the take (made in the background into the project's
`.cuttle/` folder, with the thumbnails and the mic's waveform); the export always uses the take.
Editing arrives in a later milestone; in this version the timeline and inspector show the project.

**Recording.** "New recording" on the pill, in the tray, or Ctrl+Shift+Alt+R shows a picker over every
display: the window under the pointer lights up (the display where there is none), a drag draws a
````

with:

````markdown
```bash
pnpm app                                 # build and start the app (the pill near the top of the screen, an icon in the tray)
pnpm app -- --open <project folder>      # … and open a project in the editor
pnpm app:check                           # end to end with its windows hidden: open, play, scrub, compare with the export, play the proxy, export, edit, record
pnpm app:build                           # an unpacked app in apps/desktop/build/Cuttle-<platform>-<arch>/, checked that it starts
```

The editor shows exactly what the export renders: the same engine and timeline, compared pixel for
pixel by `app:check`. It plays a 720p proxy of the take (made in the background into the project's
`.cuttle/` folder, with the thumbnails and the mic's waveform); the export always uses the take.

**Editing.** Every edit is written to `cuttle.json` as its gesture ends, so Claude and the CLI see it
at once, and one gesture is one step to undo (Ctrl+Z, Ctrl+Shift+Z). On the timeline: S splits the
clip at the playhead, edges trim, a dragged scene moves, R or the bar sets a clip's speed, overlays
move and stretch (Alt copies, Ctrl skips snapping). The tools beside the video: V selects (a click
on a caption picks it), Z and M draw a zoom or a mask on the screen itself (the source view, Esc
for the video), T types a caption on the video. The inspector edits the selection and the look;
Ctrl+K lists every command and its keys. A change written while the project is open (by Claude,
the CLI or `suggest`) shows in a note with Undo; a gesture under way is carried over onto it, and
what cannot be is kept in `cuttle.json.draft` with "Use mine". `cuttle record` refuses a project
that is open in the app ("Record again" records it there).

**Recording.** "New recording" on the pill, in the tray, or Ctrl+Shift+Alt+R shows a picker over every
display: the window under the pointer lights up (the display where there is none), a drag draws a
````

- [ ] **Step 2: All tests, the typecheck and the unpacked build**

Run: `pnpm test`
Expected: PASS, 473 tests in 50 files, 30 skipped (the real-capture test and the Electron checks: cli, app, build).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 3 tests.

- [ ] **Step 3: Commit, and nothing left behind**

```bash
git add README.md
git commit -m "docs: editing in the app in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Run: `git status --short`
Expected: no output.

- [ ] **Step 4: By hand (the user)**

These need a person, a mouse and a real screen; the checks above drive the app with synthetic events and never show a window.

1. `pnpm app -- --open <a project>`: drag a clip's edge, drag a scene before another, press S on a clip, Ctrl+Z and Ctrl+Shift+Z. The file's changes show in a text editor at once.
2. Press Z and draw a zoom on the screen frame, drag its corner, play: the video shows the zoom. Press M, draw a mask over something private, set it to blur in the inspector.
3. Press T, type a caption (it shows as it will look), Enter. Click it on the video, double-click it to edit its text.
4. Ask Claude Code to add a mask to the project's `cuttle.json` while the editor is open: the note says "1 mask added" with Show and Undo.
5. Ctrl+K, type "speed", run "Faster" on a clip (R does the same; Shift+R goes back).
6. Close the window while typing a clip's label: the label is in `cuttle.json` afterwards.

## Changes during execution

The code blocks above are the original plan. Its tasks were replayed mechanically on a fresh clone,
byte-identical to the prototype, and those commits were pushed. Two reviews followed. The code review
probed the document functions directly, the renderer's document wired to the real watcher, and the
hidden app (`--cuttle-check`, the `test` recorder backend). The experience review photographed the
editor at 1100 to 1920 px, in 16:9 and 9:16, with every tool and the menu. Both found the problems
below, and all are fixed in the commits after the plan's. The repo is the source of truth.

**The document, the saves and outside changes**

- **An edit that met an outside write made the outside version invisible.** The save conflicted and
  was replayed onto the new version, which was right. But that version never became a step, so Undo
  wrote back a file from before it and Claude's change was gone without a word. Now a conflict pushes
  "the outside change" as its own step and puts each unsaved gesture on top of it as its own step,
  with its commands kept per gesture. Redo is cleared and a note says "Changed outside the app while
  you edited: … Your edit is on top of it." with Show. The main process no longer hides that version
  from its watcher.
- **A version this window had written once was ignored for good when it came back.** That covers
  Claude reverting its own edit byte for byte, a `git checkout`, or `cuttle.json.bak` copied back. The
  watcher now ignores only the version it last read or wrote (`current`). The renderer ignores the
  versions it has just replayed onto (`replayedOnto`). The watcher's looks and the saves run one at
  a time. Otherwise a look that read the file during a save would report the version before that
  save as someone else's. Fast undos did exactly that in `app:check` (`project-watch.test.ts`).
- **Another take written from outside was never opened.** The page's `location.reload()` was
  cancelled by the window's navigation guard, so the editor stayed on the old take. The page now asks
  the main process for a reload (`project:reload`), after keeping its edits in `cuttle.json.draft`.
- **Ids are pinned on replay.** An item added while Claude added one could get Claude's id on replay,
  and the next Delete then deleted Claude's item. `pinIds` keeps the id a gesture created. A replay
  drops a gesture whose pinned id is taken, and the later commands on it too. Deleting an item that
  is already gone counts as done, so no draft is offered when both sides deleted the same thing.
- **"Use mine" is its own note** (`draftNote`). It lasts until it is used or closed. Other notes and
  later edits no longer remove it. Only the first draft of a session is kept.
- **Export and closing respect "Not saved".** An export first writes what is unsaved, and refuses with
  "your latest edits are not saved (…)" when that fails. Closing the window is a handshake:
  `project:closing` → the page blurs the field being typed in, writes, or keeps a draft →
  `project:closed`. After 4 s the window closes anyway. A quit that waited for this goes on quitting.
- **Esc, Space and L cancel a drag under way**, with no edit and no preview (`gesture.ts`, tagged by
  the view that owns it). The source view going away cancels only its own drag.
- After five conflicts in a row, the save gives up with "cuttle.json keeps changing outside the app"
  instead of saying "Saved". A drag released while the file does not parse leaves no preview behind.
- Trimming stops an edge one frame before the other. A speed that would leave less than a frame is
  refused ("the clip is too short for 64×") instead of reaching into source the clip did not show.
- A colour well previews while the picker moves and is one step when the picker closes, instead of
  one step and one save per move. `importImage` compares bytes, not name and size. `project:save` and
  `project:draft` are capped at 4 MB. A lock from this computer without a numeric pid counts as stale.
  A lock whose pid now belongs to another program still needs `--force`.

**The editor**

- **The source view is inset** (a 52 px band for its chip, a 14 px margin), so masks at the top of
  the screen and handles on its edges are reachable. While a zoom is drawn, the rest dims and the
  factor shows. The chip's hint follows the state.
- **The caption bar sits under the frame.** It wraps in 9:16 and marks the positions that are taken.
- **Keys keep working after the mouse.** A click on a button no longer keeps the focus. The command
  menu gives the focus back where it was. A select gives it back after a change.
- **The menu ranks by name, then keywords.** Undo and Redo are never preselected, so "zoom" + Enter
  no longer undoes. Enter on a list of only blocked commands says why. The six speed entries are now
  Faster (R), Slower (Shift+R) and Normal speed.
- **The inspector:**
  - The head has Duplicate and Delete.
  - Numbers take a decimal point. The arrow keys step them (Shift ×10), and Esc puts the value back.
  - Its fields are disabled while the file is broken, and the banner says where the mistake is
    ("near line 12").
  - It follows a drag under way.
  - Labels are "Shows at", "Show" and "(s into the take)". A still has one name everywhere.
  - Webcam size is in %. The Look tab puts each switch on its label's row.
  - The empty hint is a short list for the tool in use.
- Copy and colour:
  - The accent is kept for selection and focus; "on" toggles are light.
  - "src" became "s into the take".
  - Blocked actions say "Zooms, masks and captions go on clips, not on a card or page."
  - Faint text is #85858f, and the rail's letters are 10 px.
  - Blocks show a grab cursor, and the ruler shows the default one.
  - The timeline refits when the window grows. Its status hides below 1250 px.
  - A 9:16 preview says on stage that it is a preview.
  - Notes sit in the transport row, not over the video.
- `app:check` gained the regressions:
  - an outside change met by a split (undo order);
  - a byte-for-byte revert;
  - another take written from outside (the page reloads);
  - a read-only `cuttle.json` (Not saved, the export refuses, Try again);
  - Esc while drawing;
  - a label typed and not left when the window closes;
  - no page error in the whole run.

  With them, `app:check` runs 27 checks in about 70 s.
- `pnpm test`: 511 tests in 55 files. 35 are skipped. One check in `record.test.ts` asks for the mic
  to start within 0.2 s of the screen. Under the full suite's load it measured 0.29 s once; alone it
  passes. The recorder is unchanged here, and P2-M4 looks at it.

Left as they were:

- The title bar's 16:9 / 1:1 / 9:16 stays a preview (see "Kept as it was").
- A moved scene shows only its insert mark, not a ghost following the pointer.

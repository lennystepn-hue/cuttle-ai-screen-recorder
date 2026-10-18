# Cuttle P5-M1f: Music and Sounds in the Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor plays the video's music and sounds as the export mixes them, and the person edits them there:
- the music Claude wrote renders again a moment after each edit or saved page, and plays with the video, down under speech;
- a Music lane shows its waveform and the parts its page named; its panel has the page, on and off, the volume, how far it goes down under speech, the params the page declares, and what the page said;
- sounds are chips on a Sound lane, moved by dragging; their panel has the sound, the moment, the volume and the switch;
- "+ Music" adds a template, "+ Sound" a sound at the playhead; the Look tab switches and scales the sounds.

**Architecture:**
- **The document:** sounds become one of the editor's id lists (`a1`), so selection, delete, duplicate, shift and undo work on them; a `music` command sets the music's fields or removes it. A scene takes the sounds placed in it along when it goes.
- **The timeline model:** a Sound lane (a chip each time the video plays a sound: at a source second where the clips show it, or seconds into a scene) and the music as a block over the video.
- **The main process** (`EditorSound`, one per editor): plans and renders the soundtrack with the export's own code (`planSoundtrack`, `renderSoundtrack`) 450 ms after the last change, keeps the last render by a key (the plan and the changes to the music's files), watches `music/` and `sounds/`, and says how it is doing (`sound:status`).
- **The player** asks for a new render's stems and plays them from the playhead: the music at its volume with the export's duck as a curve of gains, the effects at theirs. A render that comes while playing takes over at once.
- **The editor:** the lanes, the two panels, "+ Music" and "+ Sound" (the timeline's bar and the command menu), the sounds' switch and level in the Look tab.

**Tech Stack:** TypeScript strict, zod 4, vitest 5, Electron 44.7.2 (IPC, offscreen windows), React 19, WebAudio.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase5-motion-design.md` ("Sound", "In the editor"). Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m1e-music.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m1f`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch. The editor's files take sounds and music in Task 5, so the typecheck passes from there on; the full `pnpm test` and the typecheck run in Task 7.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The finished prototype passed `pnpm test` (832 tests, 68 skipped, in two full runs), the typecheck, `app:check` (50 tests) and `cli:check` (12). Every screenshot was looked at.

- **Sounds are an id list of the editor.** `sounds` joins scenes, zooms, masks, captions, motion overlays and cuts (`ID_PREFIXES.sounds = 'a'`): every edit command works on them, and "what changed" names them. A sound has a moment, not a length: a drag sets only `at`, its chip has no edges, its volume stays in 0–1. A sound in a scene (`scene`) moves inside its scene in output seconds; when its scene is deleted or the scenes are replaced (Show raw take), it goes with it.
- **The music is one, not a list.** A `music` command merges fields into it (`undefined` removes one; `null` removes the music); its volume stays in 0–1 and its duck in 0–40 dB. The selection's kind `music` shows its panel; Delete removes it; it cannot be duplicated.
- **The timeline model:**
  - a Sound lane: a 0.5 s chip each time the video plays a sound, rows for chips that overlap, the ones it never plays counted as cut out (and named by the export sheet);
  - the music: one block over the whole video with its page's name and its switch.
- **The soundtrack renders in the main process with the export's code,** so the editor plays what the export mixes:
  - `EditorSound` takes each version of the project (`sound:project`), waits 450 ms for the next (a drag, a param typed), plans the soundtrack and renders it when its key changed: the plan (the video's timeline, the page, its params, the sounds) and a count of changes to `music/` and `sounds/` (watched) and of Reloads;
  - while a render runs, the last one keeps its key and plays on; the status says `rendering`, then `ready` with the new key, the page's tempo, key and parts, its errors, console and skipped sounds, or `failed`;
  - `sound:soundtrack` hands the stems over as float32 (90 s of stereo is about 35 MB a stem), with the music's peaks at 50 a second for the lane.
- **The duck is one pure module** (`@cuttle/export/music-duck`): the export mixes with it, and the editor turns it into a curve of gains (one every 50 ms from the playhead on, `setValueCurveAtTime`). Volume, duck and the sounds' level need no new render.
- **The player** starts the music and effects buffers from the playhead with the mic and the typing (the video follows the same AudioContext). A new render while playing stops the old buffers and starts the new ones at the clock. An edit restarts playback as before, with the new levels.
- **The editor's look:**
  - the Music lane (gold): the waveform, a dashed line and a name for each part the page returned, and its state at the right (rendering, could not render, errors);
  - the Sound lane (lime): chips with the sound's name;
  - the music's panel: its state, the page with Show file and Reload, what it made (tempo, key, parts), on and off, the volume, how far it goes down under speech, the params its page declares (the motion panel's fields), its errors, console and skipped sounds;
  - the sound's panel: the sound (the built-ins, or the project's file), its moment (source seconds, or seconds into its scene), the volume, a label, on and off;
  - "+ Music" and "+ Sound" in the timeline's bar and the command menu; a sound goes at the source second the playhead shows on a clip, else that far into the scene;
  - the Look tab's sound part: the main switch is "Sound" (it switches the mic, the music and the sounds), and a "Sounds" switch and level join it.
- **Every lane fits:** an empty overlay lane is 24 px (it keeps its hint), and the timeline takes up to 40% of the window (at most 380 px): at 900 px every lane shows. The add menus never shrink; the scene count hides below 1500 px.
- **The IPC:** `sound:project`, `sound:soundtrack`, `sound:status`, `sound:params`, `sound:reload`, `sound:add-template`; the event `sound:status`. Every request is checked against its schema.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/ids.ts`, `apps/desktop/src/shared/{document,edit}.ts` | sounds as an id list, the music command |
| `apps/desktop/src/shared/timeline-model.ts` | the Sound lane, the music block |
| `packages/export/src/music/duck.ts`, `packages/export/src/main/soundtrack.ts`, `packages/export/src/index.ts`, `packages/export/package.json` | the duck for the editor, what the app imports |
| `apps/desktop/src/main/{sound-service,windows}.ts`, `apps/desktop/src/shared/{ipc,channels}.ts` | the soundtrack per editor, its IPC |
| `apps/desktop/src/renderer/editor/{soundtrack,player,session}.ts` | playing it |
| `apps/desktop/src/renderer/editor/{Timeline,Inspector}.tsx`, `apps/desktop/src/renderer/editor/{actions,commands}.ts`, `apps/desktop/src/renderer/{tokens.css,editor/editor.css}` | the lanes, the panels, the menus |
| `apps/desktop/test/app.check.test.ts`, `skill/cuttle/music.md` | the check, the guide |

---

### Task 1: Sounds and music in the document

**Files:**
- Modify: `packages/project/src/ids.ts`, `apps/desktop/src/shared/document.ts`, `apps/desktop/src/shared/edit.ts`, `apps/desktop/test/document.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m1f`; work there:

```bash
git switch p5-m1f
```

- [ ] **Step 2: Write the failing tests**

In `apps/desktop/test/document.test.ts`, replace:

```ts
    expect((faster.overlays as { duration: number }[])[0]!.duration).toBe(4);
  });

  it('shifts overlays in source seconds, never before 0', () => {
    const next = applyCommand(base, { type: 'shift', list: 'zooms', id: 'z1', by: -10 }, limits);
    expect((next.zooms as { at: number }[])[0]!.at).toBe(0);
```

with:

```ts
    expect((faster.overlays as { duration: number }[])[0]!.duration).toBe(4);
  });

  it('edits sounds as overlays of a moment: ids, a shift, a drag that sets only their moment, a copy, their level kept in 0–1', () => {
    const raw = ensureIds({ ...base, sounds: [{ sound: 'whoosh', at: 4 }, { sound: 'pop', at: 0.5, scene: 's3' }] });
    expect((raw.sounds as { id: string }[]).map((sound) => sound.id)).toEqual(['a1', 'a2']);
    let next = applyCommand(raw, { type: 'shift', list: 'sounds', id: 'a1', by: -5 }, limits);
    expect((next.sounds as { at: number }[])[0]!.at).toBe(0);
    next = applyCommand(next, { type: 'set', list: 'sounds', id: 'a1', fields: { ...rangeFields('sounds', 4.5, 4.5), volume: 1.4 } }, limits);
    expect((next.sounds as unknown[])[0]).toEqual({ sound: 'whoosh', at: 4.5, id: 'a1', volume: 1 });
    next = applyCommand(next, { type: 'duplicate', list: 'sounds', id: 'a2', shift: 0.25 }, limits);
    expect((next.sounds as { id: string; at: number; scene?: string }[]).map((sound) => [sound.id, sound.at, sound.scene])).toEqual([
      ['a1', 4.5, undefined],
      ['a2', 0.5, 's3'],
      ['a3', 0.75, 's3'],
    ]);
    expect(describeChange(project(raw), project(next))).toBe('1 sound added · 1 sound changed');
    expect(firstChanged(project(raw), project(next))).toEqual({ list: 'sounds', id: 'a1' });
    // a scene takes its sounds along
    const without = applyCommand(raw, { type: 'delete', list: 'scenes', id: 's3' }, limits);
    expect((without.sounds as { id: string }[]).map((sound) => sound.id)).toEqual(['a1']);
    expect(describeChange(project(raw), project(without))).toBe('1 scene removed · 1 sound removed');
  });

  it('sets the music: fields merged, levels kept in range, and removed', () => {
    let next = applyCommand(base, { type: 'music', fields: { src: 'music/pulse/index.html' } }, limits);
    expect(next.music).toEqual({ src: 'music/pulse/index.html' });
    expect(describeChange(project(base), project(next))).toBe('music added');
    next = applyCommand(next, { type: 'music', fields: { volume: 1.7, duck: 99, params: { bpm: 118 } } }, limits);
    expect(next.music).toEqual({ src: 'music/pulse/index.html', volume: 1, duck: 40, params: { bpm: 118 } });
    const off = applyCommand(next, { type: 'music', fields: { enabled: false, params: undefined } }, limits);
    expect(off.music).toEqual({ src: 'music/pulse/index.html', volume: 1, duck: 40, enabled: false });
    expect(describeChange(project(next), project(off))).toBe('the music changed');
    const gone = applyCommand(off, { type: 'music', fields: null }, limits);
    expect(gone.music).toBeUndefined();
    expect(describeChange(project(off), project(gone))).toBe('the music removed');
    // a music without its page does not parse
    expect(() => applyCommand(base, { type: 'music', fields: { volume: 0.5 } }, limits)).toThrow(DocumentError);
  });

  it('shifts overlays in source seconds, never before 0', () => {
    const next = applyCommand(base, { type: 'shift', list: 'zooms', id: 'z1', by: -10 }, limits);
    expect((next.zooms as { at: number }[])[0]!.at).toBe(0);
```

Run: `pnpm exec vitest run --project node apps/desktop/test/document.test.ts`
Expected: FAIL: sounds get no ids, and there is no `music` command.

- [ ] **Step 3: Sounds as an id list**

In `packages/project/src/ids.ts`, replace:

```ts
/** The lists whose items carry ids, and the prefix of the ids Cuttle gives their new items. */
export const ID_PREFIXES = { scenes: 's', zooms: 'z', masks: 'm', texts: 't', overlays: 'o', cuts: 'c' } as const;

export type IdList = keyof typeof ID_PREFIXES;

/** The prefix of a new sound's id (`sounds`, which the editor does not list yet). */
export const SOUND_ID_PREFIX = 'a';

/** The ids a project's items use (its sounds' too); the project may be parsed or as written (unchecked). */
export function usedIds(project: Partial<Record<IdList | 'sounds', unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const list of [...(Object.keys(ID_PREFIXES) as IdList[]), 'sounds' as const]) {
    const items = project[list];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
```

with:

```ts
/** The lists whose items carry ids, and the prefix of the ids Cuttle gives their new items. */
export const ID_PREFIXES = { scenes: 's', zooms: 'z', masks: 'm', texts: 't', overlays: 'o', cuts: 'c', sounds: 'a' } as const;

export type IdList = keyof typeof ID_PREFIXES;

/** The ids a project's items use; the project may be parsed or as written (unchecked). */
export function usedIds(project: Partial<Record<IdList, unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const list of Object.keys(ID_PREFIXES) as IdList[]) {
    const items = project[list];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
```

In the same file, replace:

```ts
}

/** A new id for an item of `list`: its prefix and the smallest number not in `taken`, which it is added to. */
export function newId(list: IdList | 'sounds', taken: Set<string>): string {
  const prefix = list === 'sounds' ? SOUND_ID_PREFIX : ID_PREFIXES[list];
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
```

with:

```ts
}

/** A new id for an item of `list`: its prefix and the smallest number not in `taken`, which it is added to. */
export function newId(list: IdList, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `${ID_PREFIXES[list]}${n}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
```

- [ ] **Step 4: The commands**

In `apps/desktop/src/shared/document.ts`, replace:

```ts

export type Raw = Record<string, unknown>;
export type ListName = IdList;
export type OverlayList = 'zooms' | 'masks' | 'texts' | 'overlays';
type Item = Record<string, unknown>;

/** What a command may need to clamp to: the take's length and the screen's size. */
```

with:

```ts

export type Raw = Record<string, unknown>;
export type ListName = IdList;
export type OverlayList = 'zooms' | 'masks' | 'texts' | 'overlays' | 'sounds';
type Item = Record<string, unknown>;

/** What a command may need to clamp to: the take's length and the screen's size. */
```

In the same file, replace:

```ts
  /** The words spoken in [at, end) read as `text` ("" for none); `undefined` takes the fixes there away. */
  | { type: 'caption-fix'; at: number; end: number; text: string | undefined }
  /** Replaces every scene (Show raw take). */
  | { type: 'scenes'; scenes: Item[] };

/** A command that cannot run: its item is gone (`gone`) or the result is not a valid project (`invalid`). */
export class DocumentError extends Error {
```

with:

```ts
  /** The words spoken in [at, end) read as `text` ("" for none); `undefined` takes the fixes there away. */
  | { type: 'caption-fix'; at: number; end: number; text: string | undefined }
  /** Replaces every scene (Show raw take). */
  | { type: 'scenes'; scenes: Item[] }
  /** Sets fields of the music (`undefined` removes a field); `null` removes the music. */
  | { type: 'music'; fields: Item | null };

/** A command that cannot run: its item is gone (`gone`) or the result is not a valid project (`invalid`). */
export class DocumentError extends Error {
```

In the same file, replace:

```ts

/** Gives every scene, overlay and cut without an id one (`s3`, `z1` …); returns the same object when all have one. */
export function ensureIds(raw: Raw): Raw {
  const lists = (['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts'] as const).filter((list) => items(raw, list).some((item) => typeof item.id !== 'string'));
  if (lists.length === 0) return raw;
  const next = structuredClone(raw);
  const taken = usedIds(next);
```

with:

```ts

/** Gives every scene, overlay and cut without an id one (`s3`, `z1` …); returns the same object when all have one. */
export function ensureIds(raw: Raw): Raw {
  const lists = (['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts', 'sounds'] as const).filter((list) => items(raw, list).some((item) => typeof item.id !== 'string'));
  if (lists.length === 0) return raw;
  const next = structuredClone(raw);
  const taken = usedIds(next);
```

In the same file, replace:

```ts
    } else item.duration = round(Math.max(frame, Number(item.duration)));
    return;
  }
  if (list === 'masks' || list === 'cuts') {
    item.from = round(Math.max(0, Number(item.from)));
    item.to = round(Math.max(Number(item.from) + frame, Number(item.to)));
```

with:

```ts
    } else item.duration = round(Math.max(frame, Number(item.duration)));
    return;
  }
  if (list === 'sounds') {
    item.at = round(Math.max(0, Number(item.at)));
    if (item.volume !== undefined) item.volume = round(clampNumber(Number(item.volume), 0, 1));
    return;
  }
  if (list === 'masks' || list === 'cuts') {
    item.from = round(Math.max(0, Number(item.from)));
    item.to = round(Math.max(Number(item.from) + frame, Number(item.to)));
```

In the same file, replace:

```ts
    case 'delete': {
      const { index } = find(next, command.list, command.id);
      list(command.list).splice(index, 1);
      break;
    }
    case 'duplicate': {
```

with:

```ts
    case 'delete': {
      const { index } = find(next, command.list, command.id);
      list(command.list).splice(index, 1);
      // a scene takes the sounds placed in it along
      if (command.list === 'scenes' && Array.isArray(next.sounds)) next.sounds = (next.sounds as Item[]).filter((sound) => sound.scene !== command.id);
      break;
    }
    case 'duplicate': {
```

In the same file, replace:

```ts
      else parent[last] = structuredClone(command.value);
      break;
    }
    case 'output': {
      const output = (next.output && typeof next.output === 'object' ? next.output : (next.output = {})) as Item;
      output.width = command.width;
```

with:

```ts
      else parent[last] = structuredClone(command.value);
      break;
    }
    case 'music': {
      if (command.fields === null) delete next.music;
      else {
        const music = (next.music && typeof next.music === 'object' ? next.music : (next.music = {})) as Item;
        setFields(music, structuredClone(command.fields));
        if (typeof music.volume === 'number') music.volume = round(clampNumber(music.volume, 0, 1));
        if (typeof music.duck === 'number') music.duck = round(clampNumber(music.duck, 0, 40));
      }
      break;
    }
    case 'output': {
      const output = (next.output && typeof next.output === 'object' ? next.output : (next.output = {})) as Item;
      output.width = command.width;
```

In the same file, replace:

```ts
      next.scenes = structuredClone(command.scenes);
      const ids = ensureIds(next);
      next.scenes = ids.scenes;
      break;
    }
  }
```

with:

```ts
      next.scenes = structuredClone(command.scenes);
      const ids = ensureIds(next);
      next.scenes = ids.scenes;
      // sounds placed in scenes that are gone go with them
      const kept = new Set(items(next, 'scenes').map((scene) => scene.id));
      if (Array.isArray(next.sounds)) next.sounds = (next.sounds as Item[]).filter((sound) => sound.scene === undefined || kept.has(sound.scene));
      break;
    }
  }
```

In the same file, replace:

```ts
  texts: ['caption', 'captions'],
  overlays: ['motion overlay', 'motion overlays'],
  cuts: ['cut', 'cuts'],
};
const noun = (list: ListName, count: number) => `${count} ${NOUNS[list][count === 1 ? 0 : 1]}`;
```

with:

```ts
  texts: ['caption', 'captions'],
  overlays: ['motion overlay', 'motion overlays'],
  cuts: ['cut', 'cuts'],
  sounds: ['sound', 'sounds'],
};
const noun = (list: ListName, count: number) => `${count} ${NOUNS[list][count === 1 ? 0 : 1]}`;
```

In the same file, replace:

```ts
  return changeParts(before, after).join(' · ') || 'no visible change';
}

/** The first item added or changed between two versions (scenes, then zooms, masks, captions, motion overlays, cuts), to show it. */
export function firstChanged(before: CuttleProject, after: CuttleProject): { list: ListName; id: string } | undefined {
  for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts'] as const) {
    const old = new Map(before[list].map((item) => [item.id, JSON.stringify(item)]));
    const found = after[list].find((item) => item.id !== undefined && old.get(item.id) !== JSON.stringify(item));
    if (found?.id) return { list, id: found.id };
```

with:

```ts
  return changeParts(before, after).join(' · ') || 'no visible change';
}

/** The first item added or changed between two versions (scenes, then zooms, masks, captions, motion overlays, cuts, sounds), to show it. */
export function firstChanged(before: CuttleProject, after: CuttleProject): { list: ListName; id: string } | undefined {
  for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts', 'sounds'] as const) {
    const old = new Map(before[list].map((item) => [item.id, JSON.stringify(item)]));
    const found = after[list].find((item) => item.id !== undefined && old.get(item.id) !== JSON.stringify(item));
    if (found?.id) return { list, id: found.id };
```

In the same file, replace:

```ts

function changeParts(before: CuttleProject, after: CuttleProject): string[] {
  const parts: string[] = [];
  for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts'] as const) {
    const key = (item: { id?: string }, index: number) => item.id ?? `#${index}`;
    const old = new Map(before[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
    const now = new Map(after[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
```

with:

```ts

function changeParts(before: CuttleProject, after: CuttleProject): string[] {
  const parts: string[] = [];
  for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts', 'sounds'] as const) {
    const key = (item: { id?: string }, index: number) => item.id ?? `#${index}`;
    const old = new Map(before[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
    const now = new Map(after[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
```

In the same file, replace:

```ts
    if (removed) parts.push(`${noun(list, removed)} removed`);
    if (changed) parts.push(`${noun(list, changed)} changed`);
  }
  if (JSON.stringify(before.look) !== JSON.stringify(after.look)) parts.push('the look changed');
  if (JSON.stringify(before.autoEdits) !== JSON.stringify(after.autoEdits)) parts.push('the automatic edits changed');
  if (JSON.stringify(before.output) !== JSON.stringify(after.output)) parts.push('the output size changed');
```

with:

```ts
    if (removed) parts.push(`${noun(list, removed)} removed`);
    if (changed) parts.push(`${noun(list, changed)} changed`);
  }
  if (JSON.stringify(before.music) !== JSON.stringify(after.music)) parts.push(!before.music ? 'music added' : !after.music ? 'the music removed' : 'the music changed');
  if (JSON.stringify(before.look) !== JSON.stringify(after.look)) parts.push('the look changed');
  if (JSON.stringify(before.autoEdits) !== JSON.stringify(after.autoEdits)) parts.push('the automatic edits changed');
  if (JSON.stringify(before.output) !== JSON.stringify(after.output)) parts.push('the output size changed');
```

A sound's drag sets its moment:

In `apps/desktop/src/shared/edit.ts`, replace:

```ts
  return item.from !== undefined && item.to !== undefined ? [item.from, item.to] : [item.at ?? 0, (item.at ?? 0) + (item.duration ?? 0)];
}

/** The fields that give an overlay of `list` the source range [from, to). */
export function rangeFields(list: 'zooms' | 'masks' | 'texts' | 'overlays', from: number, to: number): Record<string, number> {
  return list === 'masks' ? { from, to } : { at: from, duration: to - from };
}
```

with:

```ts
  return item.from !== undefined && item.to !== undefined ? [item.from, item.to] : [item.at ?? 0, (item.at ?? 0) + (item.duration ?? 0)];
}

/** The fields that give an overlay of `list` the source range [from, to) (a sound: its moment, `from`). */
export function rangeFields(list: 'zooms' | 'masks' | 'texts' | 'overlays' | 'sounds', from: number, to: number): Record<string, number> {
  if (list === 'sounds') return { at: from };
  return list === 'masks' ? { from, to } : { at: from, duration: to - from };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node apps/desktop/test/document.test.ts packages/project`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/project/src/ids.ts apps/desktop/src/shared/document.ts apps/desktop/src/shared/edit.ts apps/desktop/test/document.test.ts
git commit -m "app: sounds as an id list of the editor, and the music command; a scene takes its sounds along

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The Sound lane and the music block

**Files:**
- Modify: `apps/desktop/src/shared/timeline-model.ts`, `apps/desktop/test/timeline-model.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/test/timeline-model.test.ts`, replace:

```ts
    expect(exportChecks(motion, motionSpans)).toEqual(['1 motion overlay is cut out: no clip shows it.']);
  });

  it('pins markers where a clip shows them; a cut-out marker has no pin', () => {
    expect(model.markers.map((pin) => [pin.t, pin.kind])).toEqual([
      [2.5, 'prompt'],
```

with:

```ts
    expect(exportChecks(motion, motionSpans)).toEqual(['1 motion overlay is cut out: no clip shows it.']);
  });

  it('draws sounds as chips where the video plays them, in a scene that far in, and the music over the whole video', () => {
    const sounds = project({
      scenes: [
        { type: 'card', id: 'c1', title: 'Hi', duration: 2 },
        { type: 'clip', from: 0, to: 4 },
        { type: 'clip', from: 2, to: 6, speed: 2 },
      ],
      sounds: [
        { id: 'a1', sound: 'whoosh', at: 3 },
        { id: 'a2', sound: 'sounds/ding.wav', at: 1.5, scene: 'c1', label: 'Hello' },
        { id: 'a3', sound: 'pop', at: 9 },
        { id: 'a4', sound: 'tick', at: 3, enabled: false },
      ],
      music: { src: 'music/pulse/index.html', enabled: false },
    });
    const model = timelineModel(sounds, sceneSpans(sounds.scenes), []);
    // 3 s is in both clips: at 2 + 3 and at 6 + (3 − 2) / 2
    expect(model.lanes.sound.blocks.map((block) => [block.id, block.title, block.start, block.end - block.start, block.enabled])).toEqual([
      ['a2', 'Hello', 1.5, 0.5, true],
      ['a1', 'whoosh', 5, 0.5, true],
      ['a4', 'tick', 5, 0.5, false],
      ['a1', 'whoosh', 6.5, 0.5, true],
      ['a4', 'tick', 6.5, 0.5, false],
    ]);
    expect(model.lanes.sound.rows).toBe(2);
    expect(model.lanes.sound.cutOutItems).toEqual([{ id: 'a3', title: 'pop' }]);
    expect(model.music).toEqual({ title: 'pulse', src: 'music/pulse/index.html', enabled: false });
    expect(timelineModel(demo, spans, []).music).toBeUndefined();
    expect(exportChecks(sounds, sceneSpans(sounds.scenes))).toEqual(['1 sound is cut out: no clip shows it.']);
  });

  it('pins markers where a clip shows them; a cut-out marker has no pin', () => {
    expect(model.markers.map((pin) => [pin.t, pin.kind])).toEqual([
      [2.5, 'prompt'],
```

Run: `pnpm exec vitest run --project node apps/desktop/test/timeline-model.test.ts`
Expected: FAIL: the model has no sound lane.

- [ ] **Step 2: The lane and the block**

In `apps/desktop/src/shared/timeline-model.ts`, replace:

```ts
import { occurrences, type SceneSpan } from '@cuttle/timeline';
import { formatDuration } from './format';

export type OverlayKind = 'zoom' | 'mask' | 'caption' | 'motion';

export interface SceneBlock {
  /** The scene's index in the project's `scenes`. */
```

with:

```ts
import { occurrences, type SceneSpan } from '@cuttle/timeline';
import { formatDuration } from './format';

export type OverlayKind = 'zoom' | 'mask' | 'caption' | 'motion' | 'sound';

/** How long a sound's chip is on the timeline (output seconds): a sound is a moment. */
export const SOUND_CHIP_SECONDS = 0.5;

export interface SceneBlock {
  /** The scene's index in the project's `scenes`. */
```

In the same file, replace:

```ts

export interface OverlayBlock {
  kind: OverlayKind;
  /** Index in the project's `zooms`, `masks`, `texts` or `overlays`. */
  item: number;
  /** The item's id (`#<index>` for one without). */
  id: string;
```

with:

```ts

export interface OverlayBlock {
  kind: OverlayKind;
  /** Index in the project's `zooms`, `masks`, `texts`, `overlays` or `sounds`. */
  item: number;
  /** The item's id (`#<index>` for one without). */
  id: string;
```

In the same file, replace:

```ts
  label?: string;
}

export interface TimelineModel {
  duration: number;
  scenes: SceneBlock[];
  cuts: CutNotch[];
  lanes: Record<OverlayKind, OverlayLane>;
  markers: MarkerPin[];
}
```

with:

```ts
  label?: string;
}

/** The video's music, on a lane of its own over the whole video. */
export interface MusicBlock {
  /** Its page's name (`music/pulse/index.html` is "pulse"). */
  title: string;
  src: string;
  enabled: boolean;
}

export interface TimelineModel {
  duration: number;
  scenes: SceneBlock[];
  cuts: CutNotch[];
  lanes: Record<OverlayKind, OverlayLane>;
  music?: MusicBlock;
  markers: MarkerPin[];
}
```

In the same file, replace:

```ts
  return { blocks, cutOut: cutOutItems.length, cutOutItems, rows: Math.max(1, ends.length) };
}

/** The source second a clip block shows at output second `t` (past its last piece: on at its speed). */
export function blockSourceAt(block: SceneBlock, t: number): number {
  const pieces = block.pieces ?? [];
```

with:

```ts
  return { blocks, cutOut: cutOutItems.length, cutOutItems, rows: Math.max(1, ends.length) };
}

/**
 * The sounds, one chip each time the video plays one: a sound at a source second wherever a clip shows
 * that moment, a sound in a scene that many seconds into it. One that never plays is cut out.
 */
function soundLane(project: CuttleProject, spans: readonly SceneSpan[], duration: number): OverlayLane {
  const blocks: OverlayBlock[] = [];
  const cutOutItems: OverlayLane['cutOutItems'] = [];
  project.sounds.forEach((sound, index) => {
    const id = sound.id ?? `#${index}`;
    const title = sound.label ?? soundName(sound.sound);
    const times: number[] = [];
    if (sound.scene !== undefined) {
      const sceneIndex = project.scenes.findIndex((scene) => scene.id === sound.scene);
      const span = spans.find((candidate) => candidate.sceneIndex === sceneIndex);
      if (span && sound.at <= span.end - span.start) times.push(span.start + sound.at);
    } else times.push(...outputTimesOf(spans, sound.at));
    if (times.length === 0) cutOutItems.push({ id, title });
    for (const t of times) {
      const span = Math.max(0, spans.findIndex((candidate) => t >= candidate.start - 1e-9 && t < candidate.end));
      blocks.push({ kind: 'sound', item: index, id, start: t, end: Math.min(duration, t + SOUND_CHIP_SECONDS), span, enabled: sound.enabled, title, row: 0 });
    }
  });
  blocks.sort((a, b) => a.start - b.start);
  const ends: number[] = [];
  for (const block of blocks) {
    let row = ends.findIndex((end) => end <= block.start + 1e-9);
    if (row < 0) row = ends.length < MAX_LANE_ROWS ? ends.length : MAX_LANE_ROWS - 1;
    ends[row] = Math.max(ends[row] ?? 0, block.end);
    block.row = row;
  }
  return { blocks, cutOut: cutOutItems.length, cutOutItems, rows: Math.max(1, ends.length) };
}

/** A sound's name: a built-in's own, a file's without its folder and extension. */
export function soundName(sound: string): string {
  const file = sound.split(/[\\/]/).at(-1) ?? sound;
  return file.replace(/\.[a-z0-9]+$/i, '');
}

/** The source second a clip block shows at output second `t` (past its last piece: on at its speed). */
export function blockSourceAt(block: SceneBlock, t: number): number {
  const pieces = block.pieces ?? [];
```

In the same file, replace:

```ts
      mask: lane('mask', project.masks, spans, (mask) => [mask.from, mask.to], () => 'Mask', (mask) => (mask.moves ?? []).map((move) => move.at)),
      caption: lane('caption', project.texts, spans, (text) => [text.at, text.at + text.duration], (text) => text.text),
      motion: lane('motion', project.overlays, spans, (overlay) => [overlay.at, overlay.at + overlay.duration], (overlay) => motionName(overlay.src)),
    },
    markers: markers
      .flatMap((marker) => outputTimesOf(spans, marker.t).map((t) => ({ t, source: marker.t, kind: marker.kind, ...(marker.label !== undefined && { label: marker.label }) })))
      .sort((a, b) => a.t - b.t),
```

with:

```ts
      mask: lane('mask', project.masks, spans, (mask) => [mask.from, mask.to], () => 'Mask', (mask) => (mask.moves ?? []).map((move) => move.at)),
      caption: lane('caption', project.texts, spans, (text) => [text.at, text.at + text.duration], (text) => text.text),
      motion: lane('motion', project.overlays, spans, (overlay) => [overlay.at, overlay.at + overlay.duration], (overlay) => motionName(overlay.src)),
      sound: soundLane(project, spans, spans.at(-1)?.end ?? 0),
    },
    ...(project.music && { music: { title: motionName(project.music.src), src: project.music.src, enabled: project.music.enabled } }),
    markers: markers
      .flatMap((marker) => outputTimesOf(spans, marker.t).map((t) => ({ t, source: marker.t, kind: marker.kind, ...(marker.label !== undefined && { label: marker.label }) })))
      .sort((a, b) => a.t - b.t),
```

In the same file, replace:

```ts

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
/** What people call an overlay of each lane. */
const OVERLAY_NOUNS: Record<OverlayKind, string> = { zoom: 'zoom', mask: 'mask', caption: 'caption', motion: 'motion overlay' };
const list = (items: readonly string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
```

with:

```ts

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
/** What people call an overlay of each lane. */
const OVERLAY_NOUNS: Record<OverlayKind, string> = { zoom: 'zoom', mask: 'mask', caption: 'caption', motion: 'motion overlay', sound: 'sound' };
const list = (items: readonly string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
```

In the same file, replace:

```ts
  const checks: string[] = [];
  const off = project.masks.filter((mask) => !mask.enabled).length;
  if (off > 0) checks.push(`${count(off, 'mask')} ${off === 1 ? 'is off: what it covers shows' : 'are off: what they cover shows'} in the video.`);
  const cut = (['zoom', 'mask', 'caption', 'motion'] as const).filter((kind) => model.lanes[kind].cutOut > 0);
  const cutTotal = cut.reduce((sum, kind) => sum + model.lanes[kind].cutOut, 0);
  if (cutTotal > 0) {
    checks.push(`${list(cut.map((kind) => count(model.lanes[kind].cutOut, OVERLAY_NOUNS[kind])))} ${cutTotal === 1 ? 'is cut out: no clip shows it' : 'are cut out: no clip shows them'}.`);
```

with:

```ts
  const checks: string[] = [];
  const off = project.masks.filter((mask) => !mask.enabled).length;
  if (off > 0) checks.push(`${count(off, 'mask')} ${off === 1 ? 'is off: what it covers shows' : 'are off: what they cover shows'} in the video.`);
  const cut = (['zoom', 'mask', 'caption', 'motion', 'sound'] as const).filter((kind) => model.lanes[kind].cutOut > 0);
  const cutTotal = cut.reduce((sum, kind) => sum + model.lanes[kind].cutOut, 0);
  if (cutTotal > 0) {
    checks.push(`${list(cut.map((kind) => count(model.lanes[kind].cutOut, OVERLAY_NOUNS[kind])))} ${cutTotal === 1 ? 'is cut out: no clip shows it' : 'are cut out: no clip shows them'}.`);
```

- [ ] **Step 3: Run the test**

Run: `pnpm exec vitest run --project node apps/desktop/test/timeline-model.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/shared/timeline-model.ts apps/desktop/test/timeline-model.test.ts
git commit -m "app: the timeline model's Sound lane (a chip each time the video plays a sound) and the music block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The soundtrack in the app's main process

**Files:**
- Create: `packages/export/src/music/duck.ts`, `apps/desktop/src/main/sound-service.ts`
- Modify: `packages/export/src/main/soundtrack.ts`, `packages/export/src/index.ts`, `packages/export/package.json`, `apps/desktop/src/main/windows.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/shared/channels.ts`

- [ ] **Step 1: The duck for the editor too**

The duck moves to a module without the main process's code, which the editor imports as `@cuttle/export/music-duck`:

`packages/export/src/music/duck.ts`:

```ts
// The music under speech: how far down it goes and when, the same for the export's mix and the
// editor's preview. Pure, so the editor imports it without the main process's code.

/** The music goes down this long before speech starts, and comes back over this long after it ends (seconds). */
export const DUCK_ATTACK = 0.25;
export const DUCK_RELEASE = 0.45;

/** The stretches the music is down for: speech, joined over a gap too short to come back up in. */
export function duckSpans(speech: readonly { start: number; end: number }[]): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const span of [...speech].sort((a, b) => a.start - b.start)) {
    const last = spans.at(-1);
    if (last && span.start - last.end < DUCK_ATTACK + DUCK_RELEASE) last.end = Math.max(last.end, span.end);
    else spans.push({ ...span });
  }
  return spans;
}

/**
 * The music's gain at each moment: 1, down to `duck` dB under speech (it starts going down before the
 * words, and stays down over a gap too short to come back up in).
 */
export function duckEnvelope(speech: readonly { start: number; end: number }[], duckDb: number): (t: number) => number {
  const low = 10 ** (-duckDb / 20);
  if (duckDb <= 0 || speech.length === 0) return () => 1;
  const spans = duckSpans(speech);
  return (t) => {
    let depth = 0;
    for (const span of spans) {
      if (t < span.start - DUCK_ATTACK) break;
      if (t > span.end + DUCK_RELEASE) continue;
      const k = t < span.start ? (t - (span.start - DUCK_ATTACK)) / DUCK_ATTACK : t > span.end ? 1 - (t - span.end) / DUCK_RELEASE : 1;
      depth = Math.max(depth, Math.min(1, Math.max(0, k)));
    }
    return 1 - (1 - low) * depth;
  };
}
```

In `packages/export/src/main/soundtrack.ts`, replace:

```ts
import { declaredParams } from '../motion/params';
import { soundCues, videoData, type VideoInputs } from '../music/video';
import type { VideoData } from '../music/runtime';
import { renderMusic, type MusicStems } from './music';
import { pageUrl } from './motion';

/** The music goes down this long before speech starts, and comes back over this long after it ends (seconds). */
export const DUCK_ATTACK = 0.25;
export const DUCK_RELEASE = 0.45;
/** Samples mixed at a time: 10 s. */
const BLOCK = AUDIO_SAMPLE_RATE * 10;
```

with:

```ts
import { declaredParams } from '../motion/params';
import { soundCues, videoData, type VideoInputs } from '../music/video';
import type { VideoData } from '../music/runtime';
import { duckEnvelope } from '../music/duck';

export { DUCK_ATTACK, DUCK_RELEASE, duckEnvelope } from '../music/duck';
import { renderMusic, type MusicStems } from './music';
import { pageUrl } from './motion';

/** Samples mixed at a time: 10 s. */
const BLOCK = AUDIO_SAMPLE_RATE * 10;
```

In the same file, replace:

```ts
  return stems;
}

/**
 * The music's gain at each moment: 1, down to `duck` dB under speech (it starts going down before the
 * words, and stays down over a gap too short to come back up in).
 */
export function duckEnvelope(speech: readonly { start: number; end: number }[], duckDb: number): (t: number) => number {
  const low = 10 ** (-duckDb / 20);
  if (duckDb <= 0 || speech.length === 0) return () => 1;
  const spans: { start: number; end: number }[] = [];
  for (const span of [...speech].sort((a, b) => a.start - b.start)) {
    const last = spans.at(-1);
    if (last && span.start - last.end < DUCK_ATTACK + DUCK_RELEASE) last.end = Math.max(last.end, span.end);
    else spans.push({ ...span });
  }
  return (t) => {
    let depth = 0;
    for (const span of spans) {
      if (t < span.start - DUCK_ATTACK) break;
      if (t > span.end + DUCK_RELEASE) continue;
      const k = t < span.start ? (t - (span.start - DUCK_ATTACK)) / DUCK_ATTACK : t > span.end ? 1 - (t - span.end) / DUCK_RELEASE : 1;
      depth = Math.max(depth, Math.min(1, Math.max(0, k)));
    }
    return 1 - (1 - low) * depth;
  };
}

/** A WAV header for `frames` frames of 32-bit float stereo at the export's rate. */
export function floatWavHeader(frames: number): Buffer {
  const bytes = frames * 8;
```

with:

```ts
  return stems;
}

/** A WAV header for `frames` frames of 32-bit float stereo at the export's rate. */
export function floatWavHeader(frames: number): Buffer {
  const bytes = frames * 8;
```

In `packages/export/package.json`, replace:

```json
    "./track-reader": "./src/page/track-reader.ts",
    "./formats": "./src/formats.ts",
    "./motion-requests": "./src/motion/requests.ts",
    "./motion-params": "./src/motion/params.ts"
  },
  "dependencies": {
    "@cuttle/engine": "workspace:*",
```

with:

```json
    "./track-reader": "./src/page/track-reader.ts",
    "./formats": "./src/formats.ts",
    "./motion-requests": "./src/motion/requests.ts",
    "./motion-params": "./src/motion/params.ts",
    "./music-duck": "./src/music/duck.ts"
  },
  "dependencies": {
    "@cuttle/engine": "workspace:*",
```

What the app's main process imports:

In `packages/export/src/index.ts`, replace:

```ts
export { renderStills, stillName, type StillsOptions, type StillsResult } from './main/stills';
export { MOTION_SCHEME_PRIVILEGES } from './main/motion';
export { checkMusic, type MusicCheckOptions, type MusicCheckResult } from './main/music-check';
export type { SoundtrackReport } from './main/export';
export type { MotionItemReport } from './main/motion-host';
export { MotionPreview, type MotionPreviewOptions, type MotionStatus, type PreviewMode } from './main/motion-preview';
```

with:

```ts
export { renderStills, stillName, type StillsOptions, type StillsResult } from './main/stills';
export { MOTION_SCHEME_PRIVILEGES } from './main/motion';
export { checkMusic, type MusicCheckOptions, type MusicCheckResult } from './main/music-check';
export { planSoundtrack, renderSoundtrack, type SoundtrackPlan } from './main/soundtrack';
export type { MusicStems } from './main/music';
export { motionTake } from './main/sources';
export type { MusicInfo } from './music/runtime';
export type { SoundtrackReport } from './main/export';
export type { MotionItemReport } from './main/motion-host';
export { MotionPreview, type MotionPreviewOptions, type MotionStatus, type PreviewMode } from './main/motion-preview';
```

Run: `pnpm exec vitest run --project node packages/export/test/main/soundtrack.test.ts`
Expected: PASS (the duck's tests go through its old name).

- [ ] **Step 2: The service**

`apps/desktop/src/main/sound-service.ts`:

```ts
// An editor's music and sounds: the soundtrack the export would mix (the music page Claude wrote,
// rendered as long as the video, and the project's sounds), rendered again a moment after each edit
// and each change to the music's files, so the editor plays what the export makes.
import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { motionTake, planSoundtrack, renderSoundtrack, type MusicStems } from '@cuttle/export';
import { declaredParams } from '@cuttle/export/motion-params';
import { MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import { copyTemplate } from '@cuttle/motion-kit/files';
import { parseProject } from '@cuttle/project';
import type { MotionParams, SoundStatusView, SoundtrackAnswer } from '../shared/ipc';

/** An edit waits this long for the next before the soundtrack renders (a drag, typing a param). */
const SETTLE_MS = 450;
/** The music lane's waveform: this many peaks a second. */
export const MUSIC_PEAKS_RATE = 50;

const inside = (base: string, path: string) => {
  const rel = relative(base, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** The louder ear's peaks of a stem at `MUSIC_PEAKS_RATE` a second, 0–255, scaled by `gain`. */
export function stemPeaks(stem: Float32Array, rate: number, gain = 1): Uint8Array {
  const frames = stem.length / 2;
  const step = rate / MUSIC_PEAKS_RATE;
  const out = new Uint8Array(Math.ceil(frames / step));
  for (let column = 0; column < out.length; column++) {
    let peak = 0;
    const end = Math.min(frames, Math.round((column + 1) * step));
    for (let i = Math.round(column * step); i < end; i++) peak = Math.max(peak, Math.abs(stem[i * 2]!), Math.abs(stem[i * 2 + 1]!));
    out[column] = Math.min(255, Math.round(peak * gain * 255));
  }
  return out;
}

export class EditorSound {
  private raw: { version: number; raw: Record<string, unknown> } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private again = false;
  /** Changes to the music's files and Reloads: part of what a render is kept by. */
  private changes = 0;
  private current: { key: string; stems: MusicStems; speech: { start: number; end: number }[] } | undefined;
  private status: SoundStatusView = { state: 'none', errors: [], console: [], skipped: [] };
  private watcher: FSWatcher | undefined;
  private disposed = false;

  constructor(
    private readonly dir: string,
    private readonly events: { status: (status: SoundStatusView) => void },
  ) {}

  /** The project as the editor shows it: its soundtrack renders a moment later. */
  project(version: number, raw: Record<string, unknown>): void {
    this.raw = { version, raw };
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.render(), SETTLE_MS);
  }

  private setStatus(status: SoundStatusView): void {
    this.status = status;
    if (!this.disposed) this.events.status(status);
  }

  private async render(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    const shown = this.raw;
    if (!shown || this.disposed) return;
    this.running = true;
    try {
      const parsed = parseProject(shown.raw);
      if (!parsed.ok) return;
      const project = parsed.project;
      const plan = await planSoundtrack(this.dir, project, await motionTake(this.dir, project)).catch((error: Error) => {
        this.setStatus({ state: 'failed', version: shown.version, failure: error.message, errors: [], console: [], skipped: [] });
        return null;
      });
      if (plan === null) return;
      if (!plan) {
        this.current = undefined;
        this.setStatus({ state: 'none', version: shown.version, errors: [], console: [], skipped: [] });
        return;
      }
      this.watchFiles();
      const key = createHash('sha256').update(JSON.stringify({ plan, changes: this.changes })).digest('hex').slice(0, 24);
      if (this.current?.key === key) {
        this.setStatus({ ...this.status, version: shown.version });
        return;
      }
      this.setStatus({ ...this.status, state: 'rendering', version: shown.version });
      try {
        const stems = await renderSoundtrack(this.dir, plan);
        if (this.disposed) return;
        this.current = { key, stems, speech: plan.video.speech };
        const { result, report } = stems;
        this.setStatus({
          state: 'ready',
          version: shown.version,
          key,
          info: result.info ?? null,
          renderMs: result.renderMs,
          errors: report.errors,
          console: report.console,
          skipped: result.skipped,
        });
      } catch (error) {
        this.setStatus({ state: 'failed', version: shown.version, failure: (error as Error).message, errors: [], console: [], skipped: [] });
      }
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.schedule();
      }
    }
  }

  /** The soundtrack rendered last, when it is still `key`: the stems, their peaks for the lane, and the speech the music goes down for. */
  soundtrack(key: string): SoundtrackAnswer {
    const current = this.current;
    if (!current || current.key !== key) return null;
    const { stems } = current;
    return { key, rate: stems.rate, music: stems.music, effects: stems.effects, peaks: stemPeaks(stems.music, stems.rate), speech: current.speech };
  }

  currentStatus(): SoundStatusView {
    return this.status;
  }

  /** The params the music page declares. */
  async params(src: string): Promise<MotionParams> {
    const path = resolve(this.dir, src);
    if (!inside(this.dir, path)) throw new Error('only pages inside the project can be read');
    return declaredParams(await readFile(path, 'utf8'));
  }

  /** Copies a music template into `music/<name>/`: the page's path in the project. */
  async addTemplate(template: string): Promise<string> {
    if (!MUSIC_TEMPLATES.some((candidate) => candidate.name === template)) throw new Error(`no music template "${template}"`);
    return copyTemplate(this.dir, `music-${template}`, template, import.meta.url, 'music');
  }

  /** Renders the music again (Reload in the inspector). */
  reload(): void {
    this.changes++;
    this.schedule();
  }

  /** Watches the project's folder for changes to the music's pages and the sounds' files. */
  private watchFiles(): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.dir, { recursive: true }, (_event, name) => {
        if (!name) return;
        const top = name.split(/[\\/]/)[0];
        if (top !== 'music' && top !== 'sounds') return;
        this.changes++;
        this.schedule();
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = undefined;
      });
    } catch {
      // a folder that cannot be watched: an edited page plays after Reload
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
    this.current = undefined;
  }
}
```

- [ ] **Step 3: Its IPC**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
// their window's channels.
import { z } from 'zod';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { MOTION_TEMPLATES } from '@cuttle/motion-kit';
import type { LengthReport } from './media-jobs';
import type { PickedTarget, PickerDisplay, PickerWindow, RecordChoices } from './recording';
```

with:

```ts
// their window's channels.
import { z } from 'zod';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { MOTION_TEMPLATES, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import type { LengthReport } from './media-jobs';
import type { PickedTarget, PickerDisplay, PickerWindow, RecordChoices } from './recording';
```

In the same file, replace:

```ts
/** The motion templates the editor offers (as @cuttle/motion-kit has them). */
export const MOTION_TEMPLATE_NAMES = MOTION_TEMPLATES.map((template) => template.name) as [string, ...string[]];

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const box = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
/** A motion frame the player asks for (as @cuttle/export's MotionFrameRequest). */
```

with:

```ts
/** The motion templates the editor offers (as @cuttle/motion-kit has them). */
export const MOTION_TEMPLATE_NAMES = MOTION_TEMPLATES.map((template) => template.name) as [string, ...string[]];

/** The music templates the editor offers (as @cuttle/motion-kit has them). */
export const MUSIC_TEMPLATE_NAMES = MUSIC_TEMPLATES.map((template) => template.name) as [string, ...string[]];

/** What the music page told about its music (as @cuttle/export's MusicInfo). */
export interface MusicInfoView {
  bpm?: number;
  key?: string;
  sections?: { start: number; end: number; name: string; energy?: number }[];
}

/**
 * The editor's soundtrack (its music and sounds): `none` without music or sounds, `rendering` while it
 * renders (`key` is then the last one rendered, which plays meanwhile), `ready`, or `failed`.
 */
export interface SoundStatusView {
  state: 'none' | 'rendering' | 'ready' | 'failed';
  /** The project version it is for. */
  version?: number;
  /** The rendered soundtrack to ask for (`sound:soundtrack`). */
  key?: string;
  info?: MusicInfoView | null;
  renderMs?: number;
  failure?: string;
  errors: string[];
  console: string[];
  /** Sounds that could not play. */
  skipped: string[];
}

/** A rendered soundtrack: each stem interleaved stereo float at `rate`, the music's peaks for its lane, the speech it goes down for. */
export type SoundtrackAnswer = {
  key: string;
  rate: number;
  music: Float32Array;
  effects: Float32Array;
  /** The music's peaks, 50 a second, 0–255. */
  peaks: Uint8Array;
  speech: { start: number; end: number }[];
} | null;

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const box = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
/** A motion frame the player asks for (as @cuttle/export's MotionFrameRequest). */
```

In the same file, replace:

```ts
  'motion:reload': z.string().regex(/^(scenes|overlays)\[\d{1,6}\]$/),
  /** Copies a template of the motion kit into the project's `motion/` folder. */
  'motion:add-template': z.enum(MOTION_TEMPLATE_NAMES),
} as const;

export type Request = keyof typeof REQUESTS;
```

with:

```ts
  'motion:reload': z.string().regex(/^(scenes|overlays)\[\d{1,6}\]$/),
  /** Copies a template of the motion kit into the project's `motion/` folder. */
  'motion:add-template': z.enum(MOTION_TEMPLATE_NAMES),
  /** The project as the editor shows it now, numbered: its soundtrack renders a moment later. */
  'sound:project': z
    .strictObject({ version: z.number().int().nonnegative(), raw: z.record(z.string(), z.unknown()) })
    .refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'the project is too large'),
  /** The soundtrack rendered last, by its key (none when a newer one replaced it). */
  'sound:soundtrack': z.string().regex(/^[0-9a-f]{8,64}$/),
  'sound:status': z.undefined(),
  /** The params the music page declares. */
  'sound:params': z.string().min(1).max(4096),
  /** Renders the music again. */
  'sound:reload': z.undefined(),
  /** Copies a music template into the project's `music/` folder. */
  'sound:add-template': z.enum(MUSIC_TEMPLATE_NAMES),
} as const;

export type Request = keyof typeof REQUESTS;
```

In the same file, replace:

```ts
  'motion:reload': void;
  /** The page's path in the project (`motion/title/index.html`). */
  'motion:add-template': { src: string };
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
```

with:

```ts
  'motion:reload': void;
  /** The page's path in the project (`motion/title/index.html`). */
  'motion:add-template': { src: string };
  'sound:project': void;
  'sound:soundtrack': SoundtrackAnswer;
  'sound:status': SoundStatusView;
  'sound:params': MotionParams;
  'sound:reload': void;
  /** The page's path in the project (`music/pulse/index.html`). */
  'sound:add-template': { src: string };
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
```

In the same file, replace:

```ts
  'motion:status': MotionStatusView[];
  /** The project's files changed (a page edited): motion frames are drawn anew. Counts the changes. */
  'motion:changed': { files: number };
}

export type Event = keyof Events;
```

with:

```ts
  'motion:status': MotionStatusView[];
  /** The project's files changed (a page edited): motion frames are drawn anew. Counts the changes. */
  'motion:changed': { files: number };
  /** The soundtrack's state: rendering, ready (with its key), failed. */
  'sound:status': SoundStatusView;
}

export type Event = keyof Events;
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
      'motion:statuses',
      'motion:reload',
      'motion:add-template',
    ],
    events: [
      'media:state',
```

with:

```ts
      'motion:statuses',
      'motion:reload',
      'motion:add-template',
      'sound:project',
      'sound:soundtrack',
      'sound:status',
      'sound:params',
      'sound:reload',
      'sound:add-template',
    ],
    events: [
      'media:state',
```

In the same file, replace:

```ts
      'app:motion',
      'motion:status',
      'motion:changed',
    ],
  },
  pill: {
```

with:

```ts
      'app:motion',
      'motion:status',
      'motion:changed',
      'sound:status',
    ],
  },
  pill: {
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
import { EditorMotion } from './motion-service';
import { LockedError, lockProject, openProjectFile, projectInfo } from './project';
import { importImage, ProjectFileWatch } from './project-watch';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
```

with:

```ts
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
import { EditorMotion } from './motion-service';
import { EditorSound } from './sound-service';
import { LockedError, lockProject, openProjectFile, projectInfo } from './project';
import { importImage, ProjectFileWatch } from './project-watch';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
```

In the same file, replace:

```ts
  media: ProjectMedia;
  /** The preview of its motion scenes and overlays. */
  motion: EditorMotion;
  /** cuttle.json on disk: the editor's saves and the changes others make. */
  watch: ProjectFileWatch;
  release: () => Promise<void>;
```

with:

```ts
  media: ProjectMedia;
  /** The preview of its motion scenes and overlays. */
  motion: EditorMotion;
  sound: EditorSound;
  /** cuttle.json on disk: the editor's saves and the changes others make. */
  watch: ProjectFileWatch;
  release: () => Promise<void>;
```

In the same file, replace:

```ts
      editors.delete(key);
      editor.media.dispose();
      editor.motion.dispose();
      if (!editor.window.isDestroyed()) editor.window.destroy();
    }
    await release();
```

with:

```ts
      editors.delete(key);
      editor.media.dispose();
      editor.motion.dispose();
      editor.sound.dispose();
      if (!editor.window.isDestroyed()) editor.window.destroy();
    }
    await release();
```

In the same file, replace:

```ts
    status: (statuses) => send(contents, 'motion:status', statuses),
    changed: (files) => send(contents, 'motion:changed', { files }),
  });
  const editor: Editor = { window, contents, media: newMedia(file.project), motion, release, watch: new ProjectFileWatch(dir, (event) => onFileChange(event)) };
  editors.set(key, editor);
  function newMedia(project: ProjectFile['project']): ProjectMedia {
    return new ProjectMedia(dir, project, (state) => send(contents, 'media:state', state));
```

with:

```ts
    status: (statuses) => send(contents, 'motion:status', statuses),
    changed: (files) => send(contents, 'motion:changed', { files }),
  });
  const sound = new EditorSound(dir, { status: (status) => send(contents, 'sound:status', status) });
  const editor: Editor = { window, contents, media: newMedia(file.project), motion, sound, release, watch: new ProjectFileWatch(dir, (event) => onFileChange(event)) };
  editors.set(key, editor);
  function newMedia(project: ProjectFile['project']): ProjectMedia {
    return new ProjectMedia(dir, project, (state) => send(contents, 'media:state', state));
```

In the same file, replace:

```ts
    'motion:statuses': () => motion.statuses(),
    'motion:reload': (item) => motion.reload(item),
    'motion:add-template': async (template) => ({ src: await motion.addTemplate(template) }),
    'project:import-image': async ({ purpose }) => {
      const chosen =
        CHECK_IMAGE ??
```

with:

```ts
    'motion:statuses': () => motion.statuses(),
    'motion:reload': (item) => motion.reload(item),
    'motion:add-template': async (template) => ({ src: await motion.addTemplate(template) }),
    'sound:project': ({ version, raw }) => sound.project(version, raw),
    'sound:soundtrack': (key) => sound.soundtrack(key),
    'sound:status': () => sound.currentStatus(),
    'sound:params': (src) => sound.params(src),
    'sound:reload': () => sound.reload(),
    'sound:add-template': async (template) => ({ src: await sound.addTemplate(template) }),
    'project:import-image': async ({ purpose }) => {
      const chosen =
        CHECK_IMAGE ??
```

In the same file, replace:

```ts
    editor.watch.close();
    editor.media.dispose();
    editor.motion.dispose();
    editor.run?.cancel();
    void release();
    // Closing the last editor returns to the pill (not while an editor is reopened on a new take).
```

with:

```ts
    editor.watch.close();
    editor.media.dispose();
    editor.motion.dispose();
    editor.sound.dispose();
    editor.run?.cancel();
    void release();
    // Closing the last editor returns to the pill (not while an editor is reopened on a new take).
```

Run: `pnpm exec vitest run --project node apps/desktop/test/contract.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/export apps/desktop/src/main apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/channels.ts
git commit -m "app: the soundtrack per editor, rendered with the export's code a moment after each edit, and its IPC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Playing it

**Files:**
- Create: `apps/desktop/src/renderer/editor/soundtrack.ts`
- Modify: `apps/desktop/src/renderer/editor/player.ts`, `apps/desktop/src/renderer/editor/session.ts`

- [ ] **Step 1: The schedule**

`apps/desktop/src/renderer/editor/soundtrack.ts`:

```ts
// The music and sounds in the preview: the soundtrack the main process rendered for the project (the
// export's own render of the music page and the sounds), played from the playhead on the
// AudioContext the video follows: the music at its volume and down under speech, as the export
// mixes it, the effects at theirs.
import { duckEnvelope } from '@cuttle/export/music-duck';
import type { CuttleProject } from '@cuttle/project';
import type { SoundtrackAnswer } from '../../shared/ipc';

/** A rendered soundtrack, as the main process sends it. */
export type Soundtrack = Exclude<SoundtrackAnswer, null>;

/** The duck's gain is set this often (seconds): its ramps last a quarter second and more. */
const DUCK_STEP = 0.05;

const made = new WeakMap<Soundtrack, { context: AudioContext; music: AudioBuffer; effects: AudioBuffer }>();

/** The stems as buffers of `context` (made once per soundtrack). */
function buffersOf(context: AudioContext, track: Soundtrack): { music: AudioBuffer; effects: AudioBuffer } {
  const kept = made.get(track);
  if (kept && kept.context === context) return kept;
  const buffer = (stem: Float32Array) => {
    const frames = stem.length / 2;
    const out = context.createBuffer(2, Math.max(1, frames), track.rate);
    const left = out.getChannelData(0);
    const right = out.getChannelData(1);
    for (let i = 0; i < frames; i++) {
      left[i] = stem[i * 2]!;
      right[i] = stem[i * 2 + 1]!;
    }
    return out;
  };
  const buffers = { context, music: buffer(track.music), effects: buffer(track.effects) };
  made.set(track, buffers);
  return buffers;
}

/** Whether the project has music or sounds that play. */
export function hasSoundtrack(project: CuttleProject): boolean {
  return project.look.audio.enabled && ((project.music?.enabled ?? false) || (project.look.audio.effects && project.sounds.some((sound) => sound.enabled)));
}

/**
 * Plays a soundtrack from output time `from`; `contextStart` is the AudioContext time at which output
 * time `from` plays. Levels come from `project` (the music's volume and duck, the effects' volume).
 */
export class SoundtrackSchedule {
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioBufferSourceNode[] = [];
  /** Started buffers (the check reads it). */
  started = 0;

  constructor(context: AudioContext, track: Soundtrack, project: CuttleProject, from: number, contextStart: number) {
    const { audio } = project.look;
    if (!audio.enabled) return;
    const { music, effects } = buffersOf(context, track);
    // a start the clock already passed begins that much further in
    const start = Math.max(context.currentTime, contextStart);
    const offset = from + (start - contextStart);
    if (offset >= music.duration) return;
    const play = (buffer: AudioBuffer, level: number): GainNode => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = level;
      source.connect(gain).connect(context.destination);
      source.start(start, offset);
      this.sources.push(source);
      this.nodes.push(source, gain);
      this.started++;
      return gain;
    };
    const tune = project.music?.enabled ? project.music : undefined;
    if (tune && tune.volume > 0) {
      const gain = play(music, tune.volume);
      // the duck as a curve of gains from the playhead to the end, as the export's envelope has it
      const envelope = duckEnvelope(track.speech, tune.duck);
      const steps = Math.ceil((music.duration - offset) / DUCK_STEP) + 1;
      if (track.speech.length > 0 && tune.duck > 0 && steps > 1) {
        const curve = new Float32Array(steps);
        for (let i = 0; i < steps; i++) curve[i] = tune.volume * envelope(offset + i * DUCK_STEP);
        gain.gain.setValueCurveAtTime(curve, start, (steps - 1) * DUCK_STEP);
      }
    }
    if (audio.effects && audio.effectsVolume > 0) play(effects, audio.effectsVolume);
  }

  stop(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // not started yet
      }
    }
    for (const node of this.nodes) node.disconnect();
    this.sources.length = 0;
    this.nodes.length = 0;
  }
}
```

- [ ] **Step 2: The player plays it**

In `apps/desktop/src/renderer/editor/player.ts`, replace:

```ts
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
import type { EditorMedia, VideoSource } from './media';
import { MotionFrames } from './motion';

export interface PlayerState {
  /** Output seconds of the frame on screen. */
```

with:

```ts
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
import type { EditorMedia, VideoSource } from './media';
import { MotionFrames } from './motion';
import { SoundtrackSchedule, type Soundtrack } from './soundtrack';

export interface PlayerState {
  /** Output seconds of the frame on screen. */
```

In the same file, replace:

```ts
  clock: number;
  /** Motion frames that came while playing, and how long one took (ms, a running mean). */
  motion?: { frames: number; took: number };
}

export interface PlayerOptions {
```

with:

```ts
  clock: number;
  /** Motion frames that came while playing, and how long one took (ms, a running mean). */
  motion?: { frames: number; took: number };
  /** The soundtrack's buffers started in this run (music and effects; again after a new render came). */
  soundtrack?: number;
}

export interface PlayerOptions {
```

In the same file, replace:

```ts
  private audio: AudioSchedule | undefined;
  /** The typing sounds while playing (also without a mic). */
  private typing: TypingSchedule | undefined;
  private disposed = false;
  private readonly playback: PlaybackStats = { drawn: 0, restarts: 0, clicks: 0, clock: 0 };
  private clockNow: (() => number) | undefined;
```

with:

```ts
  private audio: AudioSchedule | undefined;
  /** The typing sounds while playing (also without a mic). */
  private typing: TypingSchedule | undefined;
  /** The music and sounds rendered for the project, and their playback while playing. */
  private soundtrack: Soundtrack | undefined;
  private sound: SoundtrackSchedule | undefined;
  private soundStarts = 0;
  /** The run under way: output time `from` plays at context time `contextStart`. */
  private runMap: { from: number; contextStart: number } | undefined;
  private disposed = false;
  private readonly playback: PlaybackStats = { drawn: 0, restarts: 0, clicks: 0, clock: 0 };
  private clockNow: (() => number) | undefined;
```

In the same file, replace:

```ts

  /** Playback counters since the last play, and the clock's time while playing. */
  stats(): PlaybackStats {
    return { ...this.playback, clicks: this.typing?.scheduled ?? this.playback.clicks, clock: this.clockNow?.() ?? this.state.t, motion: this.motion.stats() };
  }

  private makeTimeline(): Timeline {
```

with:

```ts

  /** Playback counters since the last play, and the clock's time while playing. */
  stats(): PlaybackStats {
    return {
      ...this.playback,
      clicks: this.typing?.scheduled ?? this.playback.clicks,
      clock: this.clockNow?.() ?? this.state.t,
      motion: this.motion.stats(),
      soundtrack: this.soundStarts,
    };
  }

  /** The soundtrack to play (a new render of the music comes in while playing: it takes over at once). */
  setSoundtrack(track: Soundtrack | undefined): void {
    if (track === this.soundtrack) return;
    this.soundtrack = track;
    if (!this.state.playing || !this.context || !this.runMap) return;
    this.sound?.stop();
    const contextStart = this.context.currentTime + 0.05;
    this.sound = track ? this.startSound(this.context, track, this.runMap.from + (contextStart - this.runMap.contextStart), contextStart) : undefined;
  }

  private startSound(context: AudioContext, track: Soundtrack, from: number, contextStart: number): SoundtrackSchedule {
    const schedule = new SoundtrackSchedule(context, track, this.project, from, contextStart);
    this.soundStarts += schedule.started;
    return schedule;
  }

  private makeTimeline(): Timeline {
```

In the same file, replace:

```ts
    this.audio = undefined;
    this.typing?.stop();
    this.typing = undefined;
    // A running context keeps the audio device busy (and the laptop awake) for nothing.
    void this.context?.suspend();
    this.set({ playing: false });
```

with:

```ts
    this.audio = undefined;
    this.typing?.stop();
    this.typing = undefined;
    this.sound?.stop();
    this.sound = undefined;
    this.runMap = undefined;
    // A running context keeps the audio device busy (and the laptop awake) for nothing.
    void this.context?.suspend();
    this.set({ playing: false });
```

In the same file, replace:

```ts
    try {
      if (this.media.mic) this.audio = new AudioSchedule(context, this.media.mic, this.project, this.timeline.spans, from, contextStart);
      this.typing = new TypingSchedule(context, this.project, this.timeline.spans, this.media.events, from, contextStart);
      frames = open(startFrame);
      while (token === this.playToken && !this.disposed) {
        const now = clock();
```

with:

```ts
    try {
      if (this.media.mic) this.audio = new AudioSchedule(context, this.media.mic, this.project, this.timeline.spans, from, contextStart);
      this.typing = new TypingSchedule(context, this.project, this.timeline.spans, this.media.events, from, contextStart);
      this.runMap = { from, contextStart };
      this.soundStarts = 0;
      if (this.soundtrack) this.sound = this.startSound(context, this.soundtrack, from, contextStart);
      frames = open(startFrame);
      while (token === this.playToken && !this.disposed) {
        const now = clock();
```

In the same file, replace:

```ts
        this.audio = undefined;
        this.typing?.stop();
        this.typing = undefined;
        void context.suspend();
        this.set({ playing: false, t: Math.min(this.state.t, this.duration) });
      }
```

with:

```ts
        this.audio = undefined;
        this.typing?.stop();
        this.typing = undefined;
        this.sound?.stop();
        this.sound = undefined;
        this.runMap = undefined;
        void context.suspend();
        this.set({ playing: false, t: Math.min(this.state.t, this.duration) });
      }
```

- [ ] **Step 3: The session sends each version and fetches each render**

In `apps/desktop/src/renderer/editor/session.ts`, replace:

```ts
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject } from '@cuttle/project';
import type { Command, EditLimits } from '../../shared/document';
import type { ExportEnd, ExportProgress, ExportTarget, MediaState, MotionStatusView, ProjectInfo, ProjectStatus } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { beforeClose, dismissToast, edit, flush, offerUndoRestart, openDocument, outsideChange, redo, toast, undo, type DocState } from './doc';
import { ensureMedia, openProjectMedia, openVideo, type EditorMedia } from './media';
import { Player, type PlayerState } from './player';
import { createStore } from './store';

/** What is selected: a scene or an overlay by id, an overlay with the stretch of the video where it was clicked. */
/** What is selected; a `crop` is a clip's (its id is the clip's). */
export type Selection = { kind: 'scene' | OverlayKind | 'cut' | 'crop'; id: string; start?: number; end?: number };

/** The tools: V selects; Z and M draw zooms and masks in the source view; T adds a caption. */
export type Tool = 'select' | 'zoom' | 'mask' | 'caption' | 'crop';
```

with:

```ts
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject } from '@cuttle/project';
import type { Command, EditLimits } from '../../shared/document';
import type { ExportEnd, ExportProgress, ExportTarget, MediaState, MotionStatusView, ProjectInfo, ProjectStatus, SoundStatusView } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { beforeClose, dismissToast, edit, flush, offerUndoRestart, openDocument, outsideChange, redo, toast, undo, type DocState } from './doc';
import { ensureMedia, openProjectMedia, openVideo, type EditorMedia } from './media';
import { Player, type PlayerState } from './player';
import type { Soundtrack } from './soundtrack';
import { createStore } from './store';

/** What is selected: a scene or an overlay by id, an overlay with the stretch of the video where it was clicked. */
/** What is selected; a `crop` is a clip's (its id is the clip's); the `music` is the project's one (its id is `music`). */
export type Selection = { kind: 'scene' | OverlayKind | 'cut' | 'crop' | 'music'; id: string; start?: number; end?: number };

/** The tools: V selects; Z and M draw zooms and masks in the source view; T adds a caption. */
export type Tool = 'select' | 'zoom' | 'mask' | 'caption' | 'crop';
```

In the same file, replace:

```ts
  motionStatus: MotionStatusView[];
  /** Counts the changes to the project's files (a motion page edited): what was read from them is read again. */
  motionFiles: number;
}

export const store = createStore<EditorState>({
```

with:

```ts
  motionStatus: MotionStatusView[];
  /** Counts the changes to the project's files (a motion page edited): what was read from them is read again. */
  motionFiles: number;
  /** The music and sounds: rendering, ready or failed, and what the music page said. */
  soundStatus: SoundStatusView;
  /** The soundtrack rendered last (it plays while a newer one renders). */
  soundtrack?: Soundtrack;
}

export const store = createStore<EditorState>({
```

In the same file, replace:

```ts
  menuOpen: false,
  motionStatus: [],
  motionFiles: 0,
});

let player: Player | undefined;
```

with:

```ts
  menuOpen: false,
  motionStatus: [],
  motionFiles: 0,
  soundStatus: { state: 'none', errors: [], console: [], skipped: [] },
});

let player: Player | undefined;
```

In the same file, replace:

```ts
      fullSizeMotion: query.get('check') === '1',
    });
    store.set({ phase: 'ready', media });
    await player.seek(0);
    followDocument();
    if (query.get('check') === '1') exposeCheckHook(canvas);
```

with:

```ts
      fullSizeMotion: query.get('check') === '1',
    });
    store.set({ phase: 'ready', media });
    player.setSoundtrack(store.get().soundtrack);
    await player.seek(0);
    followDocument();
    if (query.get('check') === '1') exposeCheckHook(canvas);
```

In the same file, replace:

```ts
    bridge.on('project:restarted', ({ discarded }) => offerUndoRestart(discarded));
    // a motion page changed (Claude edited it): its frames, params and errors anew
    bridge.on('motion:status', (statuses) => store.set({ motionStatus: statuses }));
    bridge.on('motion:changed', ({ files }) => {
      store.set({ motionFiles: files });
      player?.motionFilesChanged();
```

with:

```ts
    bridge.on('project:restarted', ({ discarded }) => offerUndoRestart(discarded));
    // a motion page changed (Claude edited it): its frames, params and errors anew
    bridge.on('motion:status', (statuses) => store.set({ motionStatus: statuses }));
    // the music and sounds: each version of the project renders in the main process, and plays here once it is in
    bridge.on('sound:status', (status) => void applySoundStatus(status));
    followSound();
    void bridge.invoke('sound:status').then(applySoundStatus);
    bridge.on('motion:changed', ({ files }) => {
      store.set({ motionFiles: files });
      player?.motionFilesChanged();
```

In the same file, replace:

```ts
  }
}

const LISTS = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', motion: 'overlays', cut: 'cuts', crop: 'scenes' } as const;

/** The player follows the document (edits, previews, outside changes) and the previewed format. */
function followDocument(): void {
```

with:

```ts
  }
}

const LISTS = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', motion: 'overlays', cut: 'cuts', crop: 'scenes', sound: 'sounds' } as const;

/** Whether the selected item is still in the project. */
function stillThere(selection: Selection, project: CuttleProject): boolean {
  if (selection.kind === 'music') return project.music !== undefined;
  return (project[LISTS[selection.kind]] as { id?: string }[]).some((item) => item.id === selection.id);
}

/** Whether a project has music or sounds (to render, or to stop rendering once it has none). */
const hasSound = (project: CuttleProject) => project.music !== undefined || project.sounds.length > 0;

/** The document's project goes to the main process at each edit: it renders its music and sounds a moment later. */
function followSound(): void {
  let last: CuttleProject | undefined;
  let version = 0;
  const send = () => {
    const project = store.get().doc?.project;
    if (!project || project === last) return;
    const before = last;
    last = project;
    if (!hasSound(project) && !(before && hasSound(before))) return;
    void bridge.invoke('sound:project', { version: ++version, raw: project as unknown as Record<string, unknown> }).catch(() => {});
  };
  store.subscribe(send);
  send();
}

/** A new state of the soundtrack: a new render is fetched and plays from then on; none stops it. */
async function applySoundStatus(status: SoundStatusView): Promise<void> {
  store.set({ soundStatus: status });
  if (status.state === 'none') {
    store.set({ soundtrack: undefined });
    player?.setSoundtrack(undefined);
    return;
  }
  if (!status.key || status.key === store.get().soundtrack?.key) return;
  const track = await bridge.invoke('sound:soundtrack', status.key).catch(() => null);
  if (!track || store.get().soundStatus.key !== track.key) return;
  store.set({ soundtrack: track });
  player?.setSoundtrack(track);
}

/** The player follows the document (edits, previews, outside changes) and the previewed format. */
function followDocument(): void {
```

In the same file, replace:

```ts
  store.subscribe(() => {
    // a selection whose item an undo or an outside change removed is cleared
    const { selection, doc } = store.get();
    if (selection && doc && !(doc.project[LISTS[selection.kind]] as { id?: string }[]).some((item) => item.id === selection.id)) select(undefined);
    const next = shownProject();
    if (next === last || !next) return;
    last = next;
```

with:

```ts
  store.subscribe(() => {
    // a selection whose item an undo or an outside change removed is cleared
    const { selection, doc } = store.get();
    if (selection && doc && !stillThere(selection, doc.project)) select(undefined);
    const next = shownProject();
    if (next === last || !next) return;
    last = next;
```

In the same file, replace:

```ts
        selection: store.get().selection,
        tool: store.get().tool,
        motion: { status: store.get().motionStatus, files: store.get().motionFiles },
      }),
      pixels: () => canvas.toDataURL('image/png'),
      /** Switches to the proxy (the check runs with `?proxy=off` to compare frames of the take first). */
```

with:

```ts
        selection: store.get().selection,
        tool: store.get().tool,
        motion: { status: store.get().motionStatus, files: store.get().motionFiles },
        sound: { status: store.get().soundStatus, track: store.get().soundtrack?.key, seconds: store.get().soundtrack ? store.get().soundtrack!.music.length / 2 / store.get().soundtrack!.rate : 0 },
      }),
      pixels: () => canvas.toDataURL('image/png'),
      /** Switches to the proxy (the check runs with `?proxy=off` to compare frames of the take first). */
```

In the same file, replace:

```ts
      redo,
      flush,
      select: (selection: Selection | undefined) => select(selection),
      tool: (tool: Tool) => setTool(tool),
    },
  });
```

with:

```ts
      redo,
      flush,
      select: (selection: Selection | undefined) => select(selection),
      /** The timeline's scale: pixels a second. */
      pps: () => store.get().pxPerSecond,
      tool: (tool: Tool) => setTool(tool),
    },
  });
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/editor/soundtrack.ts apps/desktop/src/renderer/editor/player.ts apps/desktop/src/renderer/editor/session.ts
git commit -m "app: the player plays the music and sounds from the playhead, down under speech, a new render at once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The lanes, the panels and the menus

**Files:**
- Modify: `apps/desktop/src/renderer/editor/Timeline.tsx`, `apps/desktop/src/renderer/editor/Inspector.tsx`, `apps/desktop/src/renderer/editor/actions.ts`, `apps/desktop/src/renderer/editor/commands.ts`, `apps/desktop/src/renderer/editor/editor.css`, `apps/desktop/src/renderer/tokens.css`

- [ ] **Step 1: The lanes**

In `apps/desktop/src/renderer/editor/Timeline.tsx`, replace:

```tsx
// scenes after move. The wheel scrolls along, Shift+wheel up and down, Ctrl+wheel zooms.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { MOTION_TEMPLATES } from '@cuttle/motion-kit';
import type { CuttleProject, MarkerKind } from '@cuttle/project';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans } from '@cuttle/timeline';
import type { Command, OverlayList } from '../../shared/document';
```

with:

```tsx
// scenes after move. The wheel scrolls along, Shift+wheel up and down, Ctrl+wheel zooms.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { BUILT_IN_SOUNDS, MOTION_TEMPLATES, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import type { CuttleProject, MarkerKind } from '@cuttle/project';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans } from '@cuttle/timeline';
import type { Command, OverlayList } from '../../shared/document';
```

In the same file, replace:

```tsx
} from '../../shared/timeline-model';
import { FitIcon } from '../icons';
import { Select } from '../Select';
import { addCard, addMask, addMotion, addPage, addZoom, overlayBlocked, selectedOrCurrentClip, setSpeed, split, SPEEDS, templateLabel } from './actions';
import { audible } from './audio';
import { edit, fitLength, preview } from './doc';
import { beginGesture } from './gesture';
```

with:

```tsx
} from '../../shared/timeline-model';
import { FitIcon } from '../icons';
import { Select } from '../Select';
import { addCard, addMask, addMotion, addMusic, addPage, addSound, addZoom, overlayBlocked, selectedOrCurrentClip, setSpeed, split, SPEEDS, templateLabel } from './actions';
import { audible } from './audio';
import { edit, fitLength, preview } from './doc';
import { beginGesture } from './gesture';
```

In the same file, replace:

```tsx
const END_SPACE = 40;
/** A row of an overlay lane (lanes grow a row for overlays that overlap in time). */
const ROW = 22;
const BASE_ROWS = { markers: 26, ruler: 20, video: 52, mic: 30, input: 26 } as const;
const LANES: { kind: OverlayKind; name: string; list: OverlayList }[] = [
  { kind: 'zoom', name: 'Zoom', list: 'zooms' },
  { kind: 'mask', name: 'Mask', list: 'masks' },
  { kind: 'caption', name: 'Caption', list: 'texts' },
  { kind: 'motion', name: 'Motion', list: 'overlays' },
];
const NOUN: Record<OverlayKind, string> = { zoom: 'zoom', mask: 'mask', caption: 'caption', motion: 'motion overlay' };
/** What an empty lane says: its key, and how to fill it. */
const LANE_HINTS: Record<OverlayKind, [string, string]> = {
  zoom: ['Z', 'and draw on the video: the part to zoom in on'],
  mask: ['M', 'and draw over what no one should see (a token, an address)'],
  caption: ['T', 'and type on the video'],
  motion: ['+ Motion', 'a lower third, rings on the clicks, word-by-word captions, or a page Claude writes'],
};
const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MAX_PPS = 400;
```

with:

```tsx
const END_SPACE = 40;
/** A row of an overlay lane (lanes grow a row for overlays that overlap in time). */
const ROW = 22;
const BASE_ROWS = { markers: 26, ruler: 20, video: 52, music: 34, mic: 30, input: 26 } as const;
const LANES: { kind: OverlayKind; name: string; list: OverlayList }[] = [
  { kind: 'zoom', name: 'Zoom', list: 'zooms' },
  { kind: 'mask', name: 'Mask', list: 'masks' },
  { kind: 'caption', name: 'Caption', list: 'texts' },
  { kind: 'motion', name: 'Motion', list: 'overlays' },
  { kind: 'sound', name: 'Sound', list: 'sounds' },
];
const NOUN: Record<OverlayKind, string> = { zoom: 'zoom', mask: 'mask', caption: 'caption', motion: 'motion overlay', sound: 'sound' };
/** What an empty lane says: its key, and how to fill it. */
const LANE_HINTS: Record<OverlayKind, [string, string]> = {
  zoom: ['Z', 'and draw on the video: the part to zoom in on'],
  mask: ['M', 'and draw over what no one should see (a token, an address)'],
  caption: ['T', 'and type on the video'],
  motion: ['+ Motion', 'a lower third, rings on the clicks, word-by-word captions, or a page Claude writes'],
  sound: ['+ Sound', 'a whoosh, a pop or a ding at the playhead'],
};
const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MAX_PPS = 400;
```

In the same file, replace:

```tsx
const MARKER_DOT: Record<MarkerKind, string> = { prompt: '#ececf1', tool: '#7a7a85', answer: '#4fd1a1', manual: '#9a9aa5', retake: '#f2b34a' };

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
    motion: 8 + ROW * (model?.lanes.motion.rows ?? 1),
  };
  const order = ['markers', 'ruler', 'video', 'zoom', 'mask', 'caption', 'motion', 'mic', 'input'] as const;
  const tops = {} as Layout['tops'];
  let y = 0;
  for (const row of order) {
```

with:

```tsx
const MARKER_DOT: Record<MarkerKind, string> = { prompt: '#ececf1', tool: '#7a7a85', answer: '#4fd1a1', manual: '#9a9aa5', retake: '#f2b34a' };

interface Layout {
  heights: Record<'markers' | 'ruler' | 'video' | OverlayKind | 'music' | 'mic' | 'input', number>;
  tops: Record<'markers' | 'ruler' | 'video' | OverlayKind | 'music' | 'mic' | 'input', number>;
  total: number;
}

/** An overlay lane's height: a row per overlap; an empty lane is slimmer, room for its hint. */
const laneHeight = (model: TimelineModel | undefined, kind: OverlayKind): number => {
  const lane = model?.lanes[kind];
  if (!lane) return 8 + ROW;
  return lane.blocks.length === 0 && lane.cutOut === 0 ? EMPTY_LANE : 8 + ROW * lane.rows;
};
/** An empty lane's height. */
const EMPTY_LANE = 24;

function layoutOf(model: TimelineModel | undefined): Layout {
  const heights = {
    ...BASE_ROWS,
    zoom: laneHeight(model, 'zoom'),
    mask: laneHeight(model, 'mask'),
    caption: laneHeight(model, 'caption'),
    motion: laneHeight(model, 'motion'),
    sound: laneHeight(model, 'sound'),
  };
  const order = ['markers', 'ruler', 'video', 'zoom', 'mask', 'caption', 'motion', 'sound', 'music', 'mic', 'input'] as const;
  const tops = {} as Layout['tops'];
  let y = 0;
  for (const row of order) {
```

In the same file, replace:

```tsx
    if (edge === 'move') seekTo(timeAt(event.clientX));
    const item = project[list].find((candidate) => candidate.id === block.id);
    const scene = spans[block.span]?.scene;
    if (!item || scene?.type !== 'clip') return;
    const range = overlayRange(item as { from?: number; to?: number; at?: number; duration?: number });
    const others = targets({ overlay: block.id });
```

with:

```tsx
    if (edge === 'move') seekTo(timeAt(event.clientX));
    const item = project[list].find((candidate) => candidate.id === block.id);
    const scene = spans[block.span]?.scene;
    // a sound in a scene moves inside it, in output seconds
    if (item && 'sound' in item && item.scene !== undefined) {
      const at = item.at;
      const length = (spans.filter((span) => span.sceneIndex === spans[block.span]?.sceneIndex).at(-1)?.end ?? block.end) - (block.start - at);
      let moves: Command[] | undefined;
      follow(
        event,
        (dx) => {
          const next = Math.min(Math.max(0, at + dx / pps), Math.max(0, length - 1 / fps));
          moves = copy ? [{ type: 'duplicate', list, id: block.id, shift: next - at }] : [{ type: 'set', list, id: block.id, fields: { at: Math.round(next * 1000) / 1000 } }];
          preview(moves);
        },
        (moved) => {
          if (!moved || !moves) return preview(undefined);
          edit(moves, copy ? 'Duplicate sound' : 'Move sound');
        },
      );
      return;
    }
    if (!item || scene?.type !== 'clip') return;
    const range = overlayRange(item as { from?: number; to?: number; at?: number; duration?: number });
    const others = targets({ overlay: block.id });
```

In the same file, replace:

```tsx
              )}
            </div>
          ))}
          <div style={{ height: heights.mic }}>Mic</div>
          <div style={{ height: heights.input }}>Input</div>
        </div>
```

with:

```tsx
              )}
            </div>
          ))}
          <div style={{ height: heights.music }}>Music</div>
          <div style={{ height: heights.mic }}>Mic</div>
          <div style={{ height: heights.input }}>Input</div>
        </div>
```

In the same file, replace:

```tsx
                          onPointerEnter={() => setHovered(block.id)}
                          onPointerLeave={() => setHovered((id) => (id === block.id ? undefined : id))}
                          style={{ left: blockLeft, width: blockWidth, top: 4 + block.row * ROW }}
                          title={`${block.title}${block.enabled ? '' : ' (off: not in the video)'} · drag to move, edges to change the length, Alt to copy, Del to delete`}
                          data-id={block.id}
                          onPointerDown={(event) => pressOverlay(event, block, lane.list)}
                          onKeyDown={(event) => event.key === 'Enter' && select({ kind: lane.kind, id: block.id, start: block.start, end: block.end })}
                        >
                          {blockWidth >= 14 && <i className="edge start" data-edge="start" />}
                          {blockWidth >= LABEL_MIN_PX && <span style={{ marginLeft: inset }}>{block.title}</span>}
                          {/* a zoom that follows: where it moves on */}
                          {block.marks?.map((mark) => <i key={mark} className="move-mark" style={{ left: (mark - block.start) * pps }} />)}
                          {blockWidth >= 14 && <i className="edge end" data-edge="end" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
                <ColumnsCanvas
                  top={tops.mic}
                  height={heights.mic}
```

with:

```tsx
                          onPointerEnter={() => setHovered(block.id)}
                          onPointerLeave={() => setHovered((id) => (id === block.id ? undefined : id))}
                          style={{ left: blockLeft, width: blockWidth, top: 4 + block.row * ROW }}
                          title={`${block.title}${block.enabled ? '' : ' (off: not in the video)'} · drag to move${lane.kind === 'sound' ? '' : ', edges to change the length'}, Alt to copy, Del to delete`}
                          data-id={block.id}
                          onPointerDown={(event) => pressOverlay(event, block, lane.list)}
                          onKeyDown={(event) => event.key === 'Enter' && select({ kind: lane.kind, id: block.id, start: block.start, end: block.end })}
                        >
                          {blockWidth >= 14 && lane.kind !== 'sound' && <i className="edge start" data-edge="start" />}
                          {blockWidth >= LABEL_MIN_PX && <span style={{ marginLeft: inset }}>{block.title}</span>}
                          {/* a zoom that follows: where it moves on */}
                          {block.marks?.map((mark) => <i key={mark} className="move-mark" style={{ left: (mark - block.start) * pps }} />)}
                          {blockWidth >= 14 && lane.kind !== 'sound' && <i className="edge end" data-edge="end" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
                <MusicLane model={model} top={tops.music} height={heights.music} pps={pps} view={view} duration={duration} selected={isSelected(selection, 'music', 'music')} />
                <ColumnsCanvas
                  top={tops.mic}
                  height={heights.mic}
```

In the same file, replace:

```tsx

const isSelected = (selection: Selection | undefined, kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id;

/** The timeline's bar: split, speed, new items, snapping, fit and scale. */
function TimelineBar({ status, duration, fit, zoomValue, onScale }: { status: string; duration?: number; fit: () => void; zoomValue: number; onScale: (value: number) => void }) {
  useStore(store, (state) => state.doc?.project);
```

with:

```tsx

const isSelected = (selection: Selection | undefined, kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id;

/** The rendered music's peaks: this many a second (as the main process makes them). */
const MUSIC_PEAKS_RATE = 50;

/**
 * The music's lane: one block over the video with the rendered music's waveform and the parts its page
 * named, and what it is doing (rendering, failed). Without music: how to add some.
 */
function MusicLane({ model, top, height, pps, view, duration, selected }: { model: TimelineModel; top: number; height: number; pps: number; view: { left: number; width: number }; duration: number; selected: boolean }) {
  const status = useStore(store, (state) => state.soundStatus);
  const track = useStore(store, (state) => state.soundtrack);
  const music = model.music;
  if (!music) {
    return (
      <span className="lane-hint" style={{ top: top + height / 2, left: view.left + 10 }}>
        <kbd>+ Music</kbd> a score written for this video: pulse, drift, lofi, bright or cinematic
      </span>
    );
  }
  const sections = status.info?.sections ?? [];
  const problems = status.errors.length;
  const state = status.state === 'rendering' ? 'rendering …' : status.state === 'failed' ? 'could not render' : problems > 0 ? `${problems} error${problems === 1 ? '' : 's'}` : '';
  const info = [status.info?.bpm ? `${Math.round(status.info.bpm * 10) / 10} BPM` : '', status.info?.key ?? ''].filter(Boolean).join(' · ');
  return (
    <>
      <button
        type="button"
        className={`item music${music.enabled ? '' : ' off'}${selected ? ' selected' : ''}${status.state === 'failed' || problems > 0 ? ' failed' : ''}`}
        style={{ left: 0, width: Math.max(6, duration * pps), top: top + 3, height: height - 6 }}
        title={`Music: ${music.title}${music.enabled ? '' : ' (off)'}${info ? ` · ${info}` : ''} · click for its page and params`}
        data-testid="music-lane"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          select({ kind: 'music', id: 'music' });
        }}
        onKeyDown={(event) => event.key === 'Enter' && select({ kind: 'music', id: 'music' })}
      >
        {sections.map((part, index) => (
          <span key={index} className="music-part" style={{ left: part.start * pps }}>
            {(part.end - part.start) * pps >= 56 ? `${part.name}${part.energy !== undefined ? ` · ${part.energy}` : ''}` : ''}
          </span>
        ))}
        {sections.length === 0 && <span style={{ marginLeft: Math.max(0, view.left) }}>{music.title}</span>}
        {state && (
          <span className="music-state" style={{ right: Math.max(8, duration * pps - view.left - view.width + 8) }}>
            {state}
          </span>
        )}
      </button>
      {track && (
        <ColumnsCanvas
          className="music-wave"
          top={top + 12}
          height={height - 16}
          view={view}
          color="rgba(232, 197, 71, 0.55)"
          columns={(from, to, count) => {
            const out = new Array<number>(count).fill(0);
            const per = (to - from) / count;
            for (let i = 0; i < count; i++) {
              const a = Math.max(0, Math.floor((from + i * per) * MUSIC_PEAKS_RATE));
              const b = Math.min(track.peaks.length, Math.ceil((from + (i + 1) * per) * MUSIC_PEAKS_RATE));
              let peak = 0;
              for (let k = a; k < b; k++) peak = Math.max(peak, track.peaks[k]!);
              out[i] = (peak / 255) * (music.enabled ? 1 : 0.4);
            }
            return out;
          }}
          pps={pps}
          mirrored
          deps={[track, music.enabled]}
        />
      )}
    </>
  );
}

/** The timeline's bar: split, speed, new items, snapping, fit and scale. */
function TimelineBar({ status, duration, fit, zoomValue, onScale }: { status: string; duration?: number; fit: () => void; zoomValue: number; onScale: (value: number) => void }) {
  useStore(store, (state) => state.doc?.project);
```

In the same file, replace:

```tsx
      >
        + Motion
      </Select>
      <span className="tl-status">{status}</span>
      {duration !== undefined && <LengthControl duration={duration} />}
      <div className="grow" />
```

with:

```tsx
      >
        + Motion
      </Select>
      <Select
        value={undefined}
        options={MUSIC_TEMPLATES.map((template) => ({ value: template.name, label: templateLabel(template.name), note: template.description.split(':')[0]! }))}
        onChange={(name) => void addMusic(name)}
        label="Add music from a template"
        variant="bare"
        disabled={broken}
        className="act music-add"
        testId="add-music"
        title="Music written for this video from a template (it follows the scenes and cuts and goes down under speech). Claude can change it or write the video's own."
      >
        + Music
      </Select>
      <Select
        value={undefined}
        options={BUILT_IN_SOUNDS.map(([name, description]) => ({ value: name, label: templateLabel(name), note: description }))}
        onChange={(name) => addSound(name)}
        label="Add a sound at the playhead"
        variant="bare"
        disabled={broken}
        className="act sound-add"
        testId="add-sound"
        title="A sound at the playhead: a whoosh, a pop, a ding (it moves with what the video shows there)"
      >
        + Sound
      </Select>
      <span className="tl-status">{status}</span>
      {duration !== undefined && <LengthControl duration={duration} />}
      <div className="grow" />
```

In the same file, replace:

```tsx

/** A canvas over the visible part of a lane, one bar per two pixels (0–1 each). */
function ColumnsCanvas(props: {
  top: number;
  height: number;
  view: { left: number; width: number };
```

with:

```tsx

/** A canvas over the visible part of a lane, one bar per two pixels (0–1 each). */
function ColumnsCanvas(props: {
  className?: string;
  top: number;
  height: number;
  view: { left: number; width: number };
```

In the same file, replace:

```tsx
      context.fillRect(i * columnWidth, mirrored ? middle - bar / 2 : element.height - bar, Math.max(1, columnWidth - ratio), bar);
    });
  }, [view.left, view.width, pps, height, color, ...props.deps]);
  return <canvas ref={canvas} className="tl-canvas" style={{ top: y, left: view.left, width: view.width, height }} />;
}
```

with:

```tsx
      context.fillRect(i * columnWidth, mirrored ? middle - bar / 2 : element.height - bar, Math.max(1, columnWidth - ratio), bar);
    });
  }, [view.left, view.width, pps, height, color, ...props.deps]);
  return <canvas ref={canvas} className={`tl-canvas${props.className ? ` ${props.className}` : ''}`} style={{ top: y, left: view.left, width: view.width, height }} />;
}
```

In `apps/desktop/src/renderer/tokens.css`, replace:

```css
  --still: #3cc6c9;
  --card: #f2b34a;
  --motion: #ec6fcf;

  /* states */
  --recording: #ff4d4f;
```

with:

```css
  --still: #3cc6c9;
  --card: #f2b34a;
  --motion: #ec6fcf;
  --music: #e8c547;
  --sound: #b5e05a;

  /* states */
  --recording: #ff4d4f;
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```css
.app {
  display: grid;
  /* the video stays the largest part: the timeline takes about a third of a small window, its lanes all shown at 900 px */
  grid-template-rows: 44px minmax(0, 1fr) var(--timeline-height, clamp(220px, 36vh, 340px));
  /* the tools beside the video, the inspector on the right */
  grid-template-columns: 48px minmax(0, 1fr) 300px;
  height: 100%;
```

with:

```css
.app {
  display: grid;
  /* the video stays the largest part: the timeline takes about a third of a small window, its lanes all shown at 900 px */
  grid-template-rows: 44px minmax(0, 1fr) var(--timeline-height, clamp(220px, 40vh, 380px));
  /* the tools beside the video, the inspector on the right */
  grid-template-columns: 48px minmax(0, 1fr) 300px;
  height: 100%;
```

In the same file, replace:

```css
  box-shadow: inset 0 0 0 1px rgba(236, 111, 207, 0.5);
  color: var(--motion);
}
/* a motion item whose page cannot draw */
.scene.failed,
.item.failed {
```

with:

```css
  box-shadow: inset 0 0 0 1px rgba(236, 111, 207, 0.5);
  color: var(--motion);
}
.item.sound {
  background: rgba(181, 224, 90, 0.16);
  box-shadow: inset 0 0 0 1px rgba(181, 224, 90, 0.55);
  color: var(--sound);
  padding: 0 4px;
}
/* the music: one block over the video, its waveform and its parts */
.item.music {
  height: auto;
  background: rgba(232, 197, 71, 0.08);
  box-shadow: inset 0 0 0 1px rgba(232, 197, 71, 0.4);
  color: var(--music);
  align-items: flex-start;
  padding: 2px 8px;
}
.item.music.selected {
  box-shadow: inset 0 0 0 1.5px var(--music), 0 0 0 1px rgba(232, 197, 71, 0.25);
}
.music-part {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px dashed rgba(232, 197, 71, 0.45);
  font-size: 10px;
  font-weight: 600;
  padding: 1px 4px;
  color: rgba(232, 197, 71, 0.85);
  pointer-events: none;
  white-space: nowrap;
}
.music-state {
  position: absolute;
  right: 8px;
  top: 2px;
  font-size: 10px;
  font-weight: 600;
  color: var(--muted);
  pointer-events: none;
}
.tl-canvas.music-wave {
  pointer-events: none;
  opacity: 0.85;
}
/* a motion item whose page cannot draw */
.scene.failed,
.item.failed {
```

In the same file, replace:

```css
.tl-bar .act.speed .select-trigger {
  min-width: 52px;
}
.tl-bar .select-trigger.motion-add {
  height: 26px;
  padding: 0 6px 0 8px;
  border-radius: 7px;
  gap: 4px;
}
.tl-bar .select-trigger.motion-add:hover:not(:disabled),
.tl-bar .select-trigger.motion-add[aria-expanded='true'] {
  background: var(--raised);
  color: var(--text);
}
```

with:

```css
.tl-bar .act.speed .select-trigger {
  min-width: 52px;
}
.tl-bar .select-trigger.motion-add,
.tl-bar .select-trigger.music-add,
.tl-bar .select-trigger.sound-add {
  flex-shrink: 0;
  height: 26px;
  padding: 0 6px 0 8px;
  border-radius: 7px;
  gap: 4px;
}
.tl-bar .select-trigger:is(.motion-add, .music-add, .sound-add):hover:not(:disabled),
.tl-bar .select-trigger:is(.motion-add, .music-add, .sound-add)[aria-expanded='true'] {
  background: var(--raised);
  color: var(--text);
}
```

In the same file, replace:

```css
.item:active {
  cursor: grabbing;
}
@media (max-width: 1250px) {
  .tl-status {
    display: none;
  }
```

with:

```css
.item:active {
  cursor: grabbing;
}
@media (max-width: 1500px) {
  .tl-status {
    display: none;
  }
```

- [ ] **Step 2: The panels**

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```tsx
  type CuttleProject,
  type MotionOverlay,
  type MotionScene,
  type Rect,
} from '@cuttle/project';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { sceneSpans, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import type { MotionParams, MotionStatusView } from '../../shared/ipc';
import { formatDuration, formatSource, formatSpeed, formatTime } from '../../shared/format';
import {
  BACKGROUND_NAMES,
```

with:

```tsx
  type CuttleProject,
  type MotionOverlay,
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

In the same file, replace:

```tsx
  TEXT_STYLE_NAMES,
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { motionName, outputTimesOf } from '../../shared/timeline-model';
import {
  BackgroundIcon,
  CameraIcon,
```

with:

```tsx
  TEXT_STYLE_NAMES,
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { motionName, outputTimesOf, soundName } from '../../shared/timeline-model';
import { BUILT_IN_SOUNDS } from '@cuttle/motion-kit';
import {
  BackgroundIcon,
  CameraIcon,
```

In the same file, replace:

```tsx
// ---- what Cuttle did on its own ------------------------------------------------------------------

interface AutoItem {
  kind: Selection['kind'];
  id: string;
  label: string;
  enabled: boolean;
```

with:

```tsx
// ---- what Cuttle did on its own ------------------------------------------------------------------

interface AutoItem {
  kind: Exclude<Selection['kind'], 'music'>;
  id: string;
  label: string;
  enabled: boolean;
```

In the same file, replace:

```tsx
  // a drag in progress shows here as it goes
  const project = useStore(store, (state) => state.doc?.preview ?? state.doc?.project);
  if (!project || !selection) return HINTS[tool];
  const list = LIST_OF[selection.kind];
  const item = (project[list] as { id?: string }[]).find((candidate) => candidate.id === selection.id);
  if (!item) return <p className="hint">The selection is not in the project any more.</p>;
```

with:

```tsx
  // a drag in progress shows here as it goes
  const project = useStore(store, (state) => state.doc?.preview ?? state.doc?.project);
  if (!project || !selection) return HINTS[tool];
  if (selection.kind === 'music') return project.music ? <MusicDetails music={project.music} /> : <p className="hint">The music is not in the project any more.</p>;
  const list = LIST_OF[selection.kind];
  const item = (project[list] as { id?: string }[]).find((candidate) => candidate.id === selection.id);
  if (!item) return <p className="hint">The selection is not in the project any more.</p>;
```

In the same file, replace:

```tsx
      />
    );
  }
  const text = project.texts.find((item) => item.id === id)!;
  return (
    <>
```

with:

```tsx
      />
    );
  }
  if (selection.kind === 'sound') return <SoundDetails project={project} id={id} />;
  const text = project.texts.find((item) => item.id === id)!;
  return (
    <>
```

In the same file, replace:

```tsx
  );
}

// ---- motion --------------------------------------------------------------------------------------

/** The params a page declares, read again when the project's files change (Claude edited the page). */
```

with:

```tsx
  );
}

// ---- music and sounds ----------------------------------------------------------------------------

/** The params the music page declares, read again with each new render (Claude edited the page). */
function useMusicParams(src: string): MotionParams | undefined {
  const rendered = useStore(store, (state) => state.soundStatus.key);
  const [read, setRead] = useState<{ src: string; params: MotionParams }>();
  useEffect(() => {
    let live = true;
    bridge.invoke('sound:params', src).then(
      (params) => live && setRead({ src, params }),
      (error: Error) => live && setRead({ src, params: { params: [], issues: [error.message] } }),
    );
    return () => {
      live = false;
    };
  }, [src, rendered]);
  return read?.src === src ? read.params : undefined;
}

const musicEdit = (fields: Record<string, unknown>): Command => ({ type: 'music', fields });

/**
 * The video's music: how its render is doing, its page, on or off, its level and how far it goes down
 * under speech, the params its page declares, what the page said.
 */
function MusicDetails({ music }: { music: Music }) {
  const status = useStore(store, (state) => state.soundStatus);
  const declared = useMusicParams(music.src);
  const info = status.info;
  const summary = [info?.bpm ? `${Math.round(info.bpm * 10) / 10} BPM` : '', info?.key ?? '', info?.sections?.length ? `${info.sections.length} parts` : ''].filter(Boolean).join(' · ');
  const values = music.params;
  const param = (name: string, value: unknown): Command => {
    const next: Record<string, unknown> = { ...values };
    if (value === undefined) delete next[name];
    else next[name] = value;
    return musicEdit({ params: next });
  };
  return (
    <>
      <Head icon={<SoundIcon />} color="var(--music)" name={`Music · ${motionName(music.src)}`} copies={false} />
      <MusicState status={status} />
      <div className="field">
        <span className="field-label">
          Page
          <span className="links">
            <button type="button" className="link" onClick={() => void bridge.invoke('project:reveal', music.src)} title="Show the page's file in its folder">
              Show file
            </button>
            <button type="button" className="link" onClick={() => void bridge.invoke('sound:reload')} title="Render the music again" data-testid="music-reload">
              Reload
            </button>
          </span>
        </span>
        <span className="field-input">
          <span className="path" title={music.src}>
            {music.src}
          </span>
        </span>
      </div>
      {summary && <Row label="Made">{summary}</Row>}
      <Row label="Music" inline>
        <em>{music.enabled ? 'On' : 'Off'}</em>
        <Toggle checked={music.enabled} label="Play the music" onChange={(on) => edit([musicEdit({ enabled: on ? undefined : false })], on ? 'Music on' : 'Music off')} testId="music-enabled" />
      </Row>
      <Row label={`Volume · ${Math.round(music.volume * 100)} %`}>
        <RangeInput value={Math.round(music.volume * 100)} min={0} max={100} label="Music volume" toCommand={(value) => musicEdit({ volume: value / 100 })} commitLabel="Music volume" testId="music-volume" />
      </Row>
      <Row label={`Under speech · ${music.duck > 0 ? `${music.duck} dB down` : 'stays as it is'}`}>
        <RangeInput value={music.duck} min={0} max={30} label="How far the music goes down under speech (dB)" toCommand={(value) => musicEdit({ duck: value })} commitLabel="Music under speech" testId="music-duck" />
      </Row>
      {declared && (declared.params.length > 0 || declared.issues.length > 0) && (
        <div className="motion-params" data-testid="music-params">
          <span className="section-title">Params</span>
          {declared.issues.map((issue) => (
            <p key={issue} className="note warning">
              {issue}
            </p>
          ))}
          {declared.params.map((declaration) => (
            <ParamField key={declaration.name} param={declaration} value={declaration.name in values ? values[declaration.name] : declaration.default} set={declaration.name in values} toCommand={(value) => param(declaration.name, value)} />
          ))}
        </div>
      )}
      <MotionLog status={{ item: 'music', src: music.src, state: status.state === 'failed' ? 'failed' : 'ready', errors: [...status.errors, ...status.skipped], console: status.console }} />
      <p className="hint motion-hint">Claude writes this music for the video: ask it in Claude Code for another mood, tempo or sound. A saved change plays here a moment later.</p>
    </>
  );
}

/** How the music's render is doing. */
function MusicState({ status }: { status: SoundStatusView }) {
  const errors = status.errors.length;
  const text =
    status.state === 'failed'
      ? `The music cannot render: ${status.failure ?? 'it failed'}`
      : status.state === 'rendering'
        ? 'Rendering the music…'
        : status.state === 'none'
          ? 'Waiting for the music'
          : errors > 0
            ? `Plays, but the page threw ${errors === 1 ? 'an error' : `${errors} errors`}`
            : `Ready${status.renderMs !== undefined ? ` · rendered in ${(status.renderMs / 1000).toFixed(1)} s` : ''}`;
  const state = status.state === 'ready' ? (errors > 0 ? 'warn' : 'ready') : status.state === 'failed' ? 'failed' : 'loading';
  return (
    <p className={`motion-state ${state}`} data-testid="music-state" title={text}>
      <i />
      {text}
    </p>
  );
}

/** A sound: which one, where it plays, how loud, on or off. */
function SoundDetails({ project, id }: { project: CuttleProject; id: string }) {
  const sound = project.sounds.find((item) => item.id === id)!;
  const scene = sound.scene !== undefined ? project.scenes.find((item) => item.id === sound.scene) : undefined;
  const options = [...BUILT_IN_SOUNDS.map(([name]) => name), ...(BUILT_IN_SOUNDS.some(([name]) => name === sound.sound) ? [] : [sound.sound])];
  return (
    <>
      <Head icon={<SoundIcon />} color="var(--sound)" name={sound.label ?? soundName(sound.sound)} />
      <Row label="Sound" note={BUILT_IN_SOUNDS.find(([name]) => name === sound.sound)?.[1] ?? 'a file of the project'}>
        <StyledSelect value={sound.sound} options={options.map((name) => ({ value: name, label: soundName(name) }))} onChange={(name) => set('sounds', id, { sound: name }, 'Change sound')} label="Sound" />
      </Row>
      <Row label={scene ? `Into ${scene.label ?? 'its scene'} (s)` : 'At (take s)'} note={scene ? undefined : formatSource(sound.at)}>
        <NumberInput value={sound.at} min={0} step={0.05} onCommit={(at) => set('sounds', id, { at }, 'Move sound')} testId="sound-at" />
      </Row>
      <Row label={`Volume · ${Math.round(sound.volume * 100)} %`}>
        <RangeInput value={Math.round(sound.volume * 100)} min={0} max={100} label="Sound volume" toCommand={(value) => ({ type: 'set', list: 'sounds', id, fields: { volume: value / 100 } })} commitLabel="Sound volume" testId="sound-volume" />
      </Row>
      <Row label="Label">
        <TextInput value={sound.label ?? ''} placeholder={soundName(sound.sound)} onCommit={(value) => set('sounds', id, { label: value.trim() || undefined }, 'Rename sound')} />
      </Row>
      <Row label="In the video" inline>
        <em>{sound.enabled ? 'On' : 'Off'}</em>
        <Toggle checked={sound.enabled} label="Play the sound" onChange={(on) => set('sounds', id, { enabled: on ? undefined : false }, on ? 'Sound on' : 'Sound off')} testId="sound-enabled" />
      </Row>
    </>
  );
}

// ---- motion --------------------------------------------------------------------------------------

/** The params a page declares, read again when the project's files change (Claude edited the page). */
```

In the same file, replace:

```tsx
        ? `${WEBCAM_SHAPE_NAMES[webcam.shape]} · ${webcam.position ? 'moved' : CORNER_NAMES[webcam.corner].toLowerCase()} · ${Math.round(webcam.size * 100)} %`
        : 'Off',
    subtitles: captions.enabled ? CAPTION_STYLE_NAMES[captions.style] : sources.transcript ? 'Off' : 'Not transcribed yet',
    sound: current.audio.enabled ? [sources.cleanMic && current.audio.cleanup ? 'Mic · clean voice' : 'Mic', current.audio.typing && 'key clicks'].filter(Boolean).join(' · ') : 'Muted',
    video: `${size?.name ?? `${output.width} × ${output.height}`} · ${output.fps} fps${current.transition.enabled ? ' · crossfades' : ''}`,
  };
  return (
```

with:

```tsx
        ? `${WEBCAM_SHAPE_NAMES[webcam.shape]} · ${webcam.position ? 'moved' : CORNER_NAMES[webcam.corner].toLowerCase()} · ${Math.round(webcam.size * 100)} %`
        : 'Off',
    subtitles: captions.enabled ? CAPTION_STYLE_NAMES[captions.style] : sources.transcript ? 'Off' : 'Not transcribed yet',
    sound: current.audio.enabled
      ? [sources.cleanMic && current.audio.cleanup ? 'Mic · clean voice' : 'Mic', current.audio.typing && 'key clicks', project.music?.enabled && 'music', current.audio.effects && project.sounds.length > 0 && 'sounds'].filter(Boolean).join(' · ')
      : 'Muted',
    video: `${size?.name ?? `${output.width} × ${output.height}`} · ${output.fps} fps${current.transition.enabled ? ' · crossfades' : ''}`,
  };
  return (
```

In the same file, replace:

```tsx
      </LookPart>

      <LookPart id="sound" summary={summaries.sound}>
        <Row label="Mic" inline>
          <Toggle checked={current.audio.enabled} label="Mic sound" onChange={(on) => look(['audio', 'enabled'], on, on ? 'Sound on' : 'Sound off')} />
        </Row>
        {current.audio.enabled && sources.cleanMic && (
          <Row label="Clean voice" inline note="less noise">
```

with:

```tsx
      </LookPart>

      <LookPart id="sound" summary={summaries.sound}>
        <Row label="Sound" inline note="the mic, the music and the sounds">
          <Toggle checked={current.audio.enabled} label="Sound" onChange={(on) => look(['audio', 'enabled'], on, on ? 'Sound on' : 'Sound off')} />
        </Row>
        {current.audio.enabled && sources.cleanMic && (
          <Row label="Clean voice" inline note="less noise">
```

In the same file, replace:

```tsx
            />
          </Row>
        )}
        {current.audio.enabled && (
          <Row label="Sped-up clips" inline>
            <Toggle checked={current.audio.muteSpedUp} label="Silent when sped up" onChange={(on) => look(['audio', 'muteSpedUp'], on, on ? 'Sped-up clips silent' : 'Sped-up clips heard')} />
```

with:

```tsx
            />
          </Row>
        )}
        {current.audio.enabled && (
          <Row label="Sounds" inline note="the sounds and the music's effects">
            <Toggle checked={current.audio.effects} label="Sounds" onChange={(on) => look(['audio', 'effects'], on, on ? 'Sounds on' : 'Sounds off')} testId="audio-effects" />
          </Row>
        )}
        {current.audio.enabled && current.audio.effects && (
          <Row label={`Sounds volume · ${Math.round(current.audio.effectsVolume * 100)} %`}>
            <RangeInput
              value={Math.round(current.audio.effectsVolume * 100)}
              min={0}
              max={100}
              label="Sounds volume"
              toCommand={(value) => ({ type: 'look', path: ['audio', 'effectsVolume'], value: value / 100 }) as Command}
              commitLabel="Sounds volume"
              testId="audio-effects-volume"
            />
          </Row>
        )}
        {current.audio.enabled && (
          <Row label="Sped-up clips" inline>
            <Toggle checked={current.audio.muteSpedUp} label="Silent when sped up" onChange={(on) => look(['audio', 'muteSpedUp'], on, on ? 'Sped-up clips silent' : 'Sped-up clips heard')} />
```

- [ ] **Step 3: "+ Music" and "+ Sound"**

In `apps/desktop/src/renderer/editor/actions.ts`, replace:

```ts
// The editor's actions on the document (the timeline bar, the keys, the command menu and the tools
// call these): each is one step to undo. Where the playhead stands decides where things go.
import { MOTION_TEMPLATES } from '@cuttle/motion-kit';
import type { ClipScene, CuttleProject, Scene } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks, TEXT_FADE_SECONDS, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
```

with:

```ts
// The editor's actions on the document (the timeline bar, the keys, the command menu and the tools
// call these): each is one step to undo. Where the playhead stands decides where things go.
import { MOTION_TEMPLATES, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import type { ClipScene, CuttleProject, Scene } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks, TEXT_FADE_SECONDS, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
```

In the same file, replace:

```ts
export const NEW_OVERLAY_SECONDS = 3;
export const SPEEDS = [1, 2, 4, 8, 12, 20] as const;

export const LIST_OF: Record<Selection['kind'], ListName> = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', motion: 'overlays', cut: 'cuts', crop: 'scenes' };
/** What people call a scene of each type. */
const SCENE_NOUNS: Record<Scene['type'], string> = { clip: 'clip', still: 'page', card: 'card', motion: 'motion scene' };
const NAMES: Record<ListName, string> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', overlays: 'motion overlay', cuts: 'cut' };

/** Where the playhead is: its scene and, in a clip, the source second it shows. */
export interface PlayheadPlace {
```

with:

```ts
export const NEW_OVERLAY_SECONDS = 3;
export const SPEEDS = [1, 2, 4, 8, 12, 20] as const;

export const LIST_OF: Record<Exclude<Selection['kind'], 'music'>, ListName> = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', motion: 'overlays', cut: 'cuts', crop: 'scenes', sound: 'sounds' };
/** What people call a scene of each type. */
const SCENE_NOUNS: Record<Scene['type'], string> = { clip: 'clip', still: 'page', card: 'card', motion: 'motion scene' };
const NAMES: Record<ListName, string> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', overlays: 'motion overlay', cuts: 'cut', sounds: 'sound' };

/** Where the playhead is: its scene and, in a clip, the source second it shows. */
export interface PlayheadPlace {
```

In the same file, replace:

```ts
export function deleteSelection(): void {
  const selection = store.get().selection;
  if (!selection) return;
  // a crop belongs to its clip: deleting it shows the whole screen again
  if (selection.kind === 'crop') {
    if (edit([{ type: 'set', list: 'scenes', id: selection.id, fields: { crop: undefined } }], 'Remove crop')) select({ kind: 'scene', id: selection.id });
```

with:

```ts
export function deleteSelection(): void {
  const selection = store.get().selection;
  if (!selection) return;
  if (selection.kind === 'music') {
    if (edit([{ type: 'music', fields: null }], 'Remove the music')) select(undefined);
    return;
  }
  // a crop belongs to its clip: deleting it shows the whole screen again
  if (selection.kind === 'crop') {
    if (edit([{ type: 'set', list: 'scenes', id: selection.id, fields: { crop: undefined } }], 'Remove crop')) select({ kind: 'scene', id: selection.id });
```

In the same file, replace:

```ts
  if (!selection) return;
  if (selection.kind === 'cut') return toast('A cut cannot be copied: the same stretch is cut once.', { tone: 'warning' });
  if (selection.kind === 'crop') return toast('A crop belongs to its clip: duplicate the clip instead.', { tone: 'warning' });
  const list = LIST_OF[selection.kind];
  edit([{ type: 'duplicate', list, id: selection.id, ...(list !== 'scenes' && { shift: 1 }) }], `Duplicate ${NAMES[list]}`);
}
```

with:

```ts
  if (!selection) return;
  if (selection.kind === 'cut') return toast('A cut cannot be copied: the same stretch is cut once.', { tone: 'warning' });
  if (selection.kind === 'crop') return toast('A crop belongs to its clip: duplicate the clip instead.', { tone: 'warning' });
  if (selection.kind === 'music') return toast('A video has one music: change its page or its params instead.', { tone: 'warning' });
  const list = LIST_OF[selection.kind];
  edit([{ type: 'duplicate', list, id: selection.id, ...(list !== 'scenes' && { shift: 1 }) }], `Duplicate ${NAMES[list]}`);
}
```

In the same file, replace:

```ts
  if (added) reveal(command.list, added);
}

/** Replaces a still's image or the background's with one the person picks. */
export async function chooseImage(purpose: 'still' | 'background', id?: string): Promise<void> {
  const chosen = await bridge.invoke('project:import-image', { purpose });
```

with:

```ts
  if (added) reveal(command.list, added);
}

/**
 * Copies a music template into `music/<name>/` and makes it the video's music (its level and duck stay
 * when the video had music before); the music lane is selected.
 */
export async function addMusic(name: string): Promise<void> {
  if (!MUSIC_TEMPLATES.some((candidate) => candidate.name === name) || !documentProject()) return;
  if (store.get().doc?.issues) return toast('cuttle.json has a mistake; fix it first (Claude or a text editor), then edit here again.', { tone: 'warning' });
  let src: string;
  try {
    ({ src } = await bridge.invoke('sound:add-template', name));
  } catch (error) {
    return toast(`The music template could not be copied: ${error instanceof Error ? error.message : String(error)}`, { tone: 'warning' });
  }
  if (edit([{ type: 'music', fields: { src, params: undefined, enabled: undefined } }], `Music: ${templateLabel(name)}`)) select({ kind: 'music', id: 'music' });
}

/**
 * A sound at the playhead: on a clip at the source second it shows (it plays wherever the video shows
 * that moment), elsewhere that many seconds into the scene; the sound is selected.
 */
export function addSound(sound = 'pop'): void {
  const project = documentProject();
  const place = playheadPlace();
  if (!project || !place) return toast('There is nothing in the video yet to put a sound on.', { tone: 'warning' });
  if (store.get().doc?.issues) return toast('cuttle.json has a mistake; fix it first (Claude or a text editor), then edit here again.', { tone: 'warning' });
  const round = (value: number) => Math.round(value * 1000) / 1000;
  let item: Record<string, unknown>;
  if (place.clip && place.source !== undefined) item = { sound, at: round(place.source) };
  else {
    const scene = project.scenes[place.index]!;
    if (!scene.id) return;
    item = { sound, at: round(Math.max(0, place.t - place.span.start)), scene: scene.id };
  }
  const before = new Set(project.sounds.map((entry) => entry.id));
  if (!edit([{ type: 'add', list: 'sounds', item }], `Add sound: ${sound}`)) return;
  const added = documentProject()?.sounds.find((entry) => entry.id !== undefined && !before.has(entry.id));
  if (added?.id) select({ kind: 'sound', id: added.id });
}

/** Replaces a still's image or the background's with one the person picks. */
export async function chooseImage(purpose: 'still' | 'background', id?: string): Promise<void> {
  const chosen = await bridge.invoke('project:import-image', { purpose });
```

In the same file, replace:

```ts
}

/** What selecting an item of each list selects. */
const KIND_OF: Record<ListName, Selection['kind']> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', overlays: 'motion', cuts: 'cut' };

/** Selects an item and moves the playhead to where the video first shows it (the toast's "Show"). */
export function reveal(list: ListName, id: string): void {
```

with:

```ts
}

/** What selecting an item of each list selects. */
const KIND_OF: Record<ListName, Selection['kind']> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', overlays: 'motion', cuts: 'cut', sounds: 'sound' };

/** Selects an item and moves the playhead to where the video first shows it (the toast's "Show"). */
export function reveal(list: ListName, id: string): void {
```

In `apps/desktop/src/renderer/editor/commands.ts`, replace:

```ts
// Everything the editor can do by name, with its keys: the command menu (Ctrl+K) lists these, and
// the keyboard runs them. Keys are written as the menu shows them.
import { MOTION_TEMPLATES } from '@cuttle/motion-kit';
import { bridge } from '../bridge';
import {
  addCard,
  addMask,
  addMotion,
  addPage,
  addZoom,
  autoZoomClicks,
```

with:

```ts
// Everything the editor can do by name, with its keys: the command menu (Ctrl+K) lists these, and
// the keyboard runs them. Keys are written as the menu shows them.
import { BUILT_IN_SOUNDS, MOTION_TEMPLATES, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import { bridge } from '../bridge';
import {
  addCard,
  addMask,
  addMotion,
  addMusic,
  addSound,
  addPage,
  addZoom,
  autoZoomClicks,
```

In the same file, replace:

```ts
        run: () => void addMotion(template.name),
      }),
    ),
    { id: 'tool-select', name: 'Select tool', keys: 'V', group: 'Tools', run: () => setTool('select') },
    { id: 'tool-zoom', name: 'Zoom tool: draw a zoom on the video', keys: 'Z', group: 'Tools', run: () => setTool('zoom'), blocked: () => overlayBlocked() },
    { id: 'tool-mask', name: 'Mask tool: draw a mask on the video', keys: 'M', group: 'Tools', run: () => setTool('mask'), blocked: () => overlayBlocked() },
```

with:

```ts
        run: () => void addMotion(template.name),
      }),
    ),
    ...MUSIC_TEMPLATES.map(
      (template): EditorCommand => ({
        id: `add-music-${template.name}`,
        name: `Add music: ${templateLabel(template.name)}`,
        keywords: `music soundtrack score song ${template.description}`,
        group: 'Add',
        run: () => void addMusic(template.name),
      }),
    ),
    ...BUILT_IN_SOUNDS.map(
      ([name, description]): EditorCommand => ({
        id: `add-sound-${name}`,
        name: `Add a sound at the playhead: ${templateLabel(name)}`,
        keywords: `sound effect sfx ${description}`,
        group: 'Add',
        run: () => addSound(name),
      }),
    ),
    { id: 'tool-select', name: 'Select tool', keys: 'V', group: 'Tools', run: () => setTool('select') },
    { id: 'tool-zoom', name: 'Zoom tool: draw a zoom on the video', keys: 'Z', group: 'Tools', run: () => setTool('zoom'), blocked: () => overlayBlocked() },
    { id: 'tool-mask', name: 'Mask tool: draw a mask on the video', keys: 'M', group: 'Tools', run: () => setTool('mask'), blocked: () => overlayBlocked() },
```

- [ ] **Step 4: The typecheck**

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "app: the Music and Sound lanes, their panels, + Music and + Sound, and the sounds in the Look tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The check and the guide

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`, `skill/cuttle/music.md`

- [ ] **Step 1: The check**

It adds music with "+ Music", waits for its render (its lane, its parts, its panel), sets a param and sees it render anew, plays it, adds two sounds (on the clip and in the intro) and drags one, and exports:

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion-editor · Cuttle')?.close());
  }, 240_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

with:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion-editor · Cuttle')?.close());
  }, 240_000);

  it('plays music made for the video: + Music renders it (its lane, its parts), a param renders it anew, it plays and goes into the export; + Sound puts a sound at the playhead, moved on its lane', async () => {
    const dir = join(root, 'music-editor');
    makeMotionFixture(dir);
    const page = await openEditor(dir);
    await page.waitForFunction(() => '__cuttleCheck' in window);
    type Sound = { status: { state: string; key?: string; info?: { bpm?: number; sections?: unknown[] } | null; errors: string[] }; track?: string; seconds: number };
    const seekTo = (t: number) => page.evaluate((time) => (window as unknown as Hooked).__cuttleCheck.seek(time), t);
    const now = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state() as CheckState & { sound: Sound });
    const saved = () => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { music?: { src: string; volume?: number; params?: Record<string, unknown> }; sounds?: { id: string; sound: string; at: number; scene?: string }[] };

    // + Music: the template copied into music/, the music set, rendered for the video, its lane and its panel
    await seekTo(0.5);
    await chooseIn(page, '[data-testid=add-music]', 'Pulse');
    await expect.poll(() => saved().music?.src).toBe('music/pulse/index.html');
    expect(existsSync(join(dir, 'music', 'pulse', 'index.html'))).toBe(true);
    await expect.poll(async () => (await now()).sound.status.state, { timeout: 90_000 }).toBe('ready');
    await expect.poll(async () => (await now()).sound.track, { timeout: 20_000 }).toBe((await now()).sound.status.key);
    const first = (await now()).sound;
    expect(first.status.errors).toEqual([]);
    expect(first.seconds).toBeCloseTo((await now()).duration, 1);
    expect(first.status.info?.bpm).toBeGreaterThanOrEqual(114);
    expect(first.status.info?.sections?.length).toBeGreaterThan(0);
    await page.waitForSelector('[data-testid=music-lane] .music-part');
    expect(await page.locator('[data-testid=music-state]').textContent()).toContain('Ready');
    await shotOf('40-music-editor', '/editor.html', 'music-editor · Cuttle');

    // a param: the music renders again with it
    await page.fill('[data-testid=param-bpm]', '100');
    await page.press('[data-testid=param-bpm]', 'Enter');
    await expect.poll(() => saved().music?.params).toEqual({ bpm: 100 });
    await expect.poll(async () => (await now()).sound.status.info?.bpm, { timeout: 90_000 }).toBe(100);
    await expect.poll(async () => (await now()).sound.track, { timeout: 20_000 }).not.toBe(first.track);

    // it plays with the video: the music and the effects start (the param's field gives the keys back first)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await seekTo(1);
    await click(page, 'button.play');
    await page.waitForTimeout(1200);
    const stats = await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.playback() as { soundtrack?: number });
    expect((await now()).playing).toBe(true);
    await click(page, 'button.play');
    expect(stats.soundtrack).toBe(2);

    // + Sound at the playhead: on the clip at the source second it shows, its chip on the lane, its panel
    await seekTo(3);
    await chooseIn(page, '[data-testid=add-sound]', 'Whoosh');
    await expect.poll(() => saved().sounds).toEqual([{ id: 'a1', sound: 'whoosh', at: 2 }]);
    const chip = page.locator('.item.sound[data-id=a1]');
    await chip.waitFor();
    expect(await page.locator('[data-testid=sound-volume]').count()).toBe(1);
    // dragged half a second later on its lane
    const box = (await chip.boundingBox())!;
    const pps = await page.evaluate(() => (window as unknown as { __cuttleCheck: { pps(): number } }).__cuttleCheck.pps());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + pps * 0.25, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2 + pps * 0.5, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => saved().sounds?.[0]?.at).toBeGreaterThan(2.3);
    // and in the intro (a motion scene): seconds into it
    await seekTo(0.4);
    await chooseIn(page, '[data-testid=add-sound]', 'Pop');
    await expect.poll(() => saved().sounds?.find((sound) => sound.id === 'a2')).toEqual({ id: 'a2', sound: 'pop', at: 0.4, scene: 's1' });
    await expect.poll(async () => (await now()).sound.status.state, { timeout: 90_000 }).toBe('ready');
    await shotOf('41-music-sounds', '/editor.html', 'music-editor · Cuttle');

    // the export has the music (the take has no mic: what is heard is the music and the sounds)
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-sheet]');
    await page.click('[data-testid=export-start]');
    await exported(page);
    const meter = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', join(dir, 'out', 'export.mp4'), '-map', '0:a', '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true }).stderr;
    const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(meter.slice(meter.lastIndexOf('Summary:')))?.[1]);
    expect(lufs).toBeGreaterThan(-30);
    await page.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'music-editor · Cuttle')?.close());
  }, 300_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

Run: `pnpm app:check`
Expected: PASS, 50 tests.

- [ ] **Step 2: The guide**

In `skill/cuttle/music.md`, replace:

```markdown
4. Render. The music renders beside the frames and is mixed with the mic, the typing and the sounds,
   limited below full scale.

Aim for about -16 LUFS for the music alone (`music check`), true peak below -1 dBFS; a quiet
walkthrough with a voice -20 or lower. `music.volume` (0–1) and `music.duck` (dB under speech,
default 12) set it in the mix without a new render of the page.
```

with:

```markdown
4. Render. The music renders beside the frames and is mixed with the mic, the typing and the sounds,
   limited below full scale.

**With the project open in the Cuttle app,** the user hears your music in its editor as they play the
video: the Music lane shows its waveform and the parts your page returned, its panel the params you
declared (declare a param for what they may want to set: the key, the tempo, how hard it drives),
its volume and how far it goes down under speech. Each page you save renders and plays there a
moment later; the user adds music from the templates and sounds at the playhead too.

Aim for about -16 LUFS for the music alone (`music check`), true peak below -1 dBFS; a quiet
walkthrough with a voice -20 or lower. `music.volume` (0–1) and `music.duck` (dB under speech,
default 12) set it in the mix without a new render of the page.
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/app.check.test.ts skill/cuttle/music.md
git commit -m "app: check the music and sounds in the editor end to end; the guide says the user hears Claude's music there

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 832 passed and 68 skipped (where a speech model is found, its real transcription runs too: 833 and 67; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 12 tests.

Run: `pnpm app:check`
Expected: PASS, 50 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Open a project in Cuttle and pick "+ Music" → Pulse: a moment later the Music lane shows its waveform and parts; play: the music plays with the video.
2. Change the volume and the key in its panel: the next play has them.
3. Ask Claude to change the music page: a moment after it saves, the new music plays.
4. "+ Sound" → Whoosh at the playhead: its chip on the Sound lane; drag it; play.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **Two lanes more did not fit:** at 900 px the Mic and Input lanes fell below the timeline, and the bar cut "+ Motion", "+ Music" and "+ Sound" to "+ Moti…". Empty lanes are slimmer, the timeline may take 40% of the window (at most 380 px), the add menus never shrink, and the scene count hides below 1500 px.
- **Deleting a scene with a sound in it** made the project invalid (the sound named a scene that was gone): a scene takes its sounds along, also when the scenes are replaced.
- **"What changed" left sounds out** (two of its lists were not the one with sounds): found by its test.
- **The look's main sound switch said "Mic"** but switches all the sound, the music's too: it says "Sound" now.
- **A fresh clone's Electron was half unpacked** when two tests started it at the same moment (no `path.txt`); unpacked again from the local cache. Nothing in the code.

**Spec points that move**
- **Sounds on the mic lane:** they have a lane of their own (Sound), and the music one too (Music), beside the Mic: the mic lane keeps the subtitles.
- **The rest of M1f's plan from M1e** (`cuttle.sound` cues from motion pages) is **P5-M1g**, with sounds in the motion templates. Then P5-M1d.

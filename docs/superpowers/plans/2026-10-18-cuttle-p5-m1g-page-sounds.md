# Cuttle P5-M1g: Sounds from Motion Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A motion page asks for its own sounds, so they stay on its motion however the video is cut, and the templates make theirs:
- `cuttle.sound('whoosh', { at: 0.3 })` in a page plays a built-in sound (or a file of the project) that far into the item, at every showing of it; `{ videoTime }` plays it at a second of the video (a click);
- the export, `cuttle music check` and the editor play them with the music and the project's sounds, under the effects level; a video of motion scenes alone gets its sound from them;
- the title whooshes in, the end card lands with a hit and types its URL with keys and a ding, the lower third swooshes, each callout pops, the code editor's keys clatter; each template's `sounds` param switches them off;
- the editor shows them as diamonds on the Sound lane, named after their item.

**Architecture:**
- **The page's world:** the motion runtime gives the page `cuttle.sound(name, { at, videoTime, volume })` and keeps what it asked for in `window.__cuttleSounds` (the same sound at the same moment once). `MotionPage.sounds()` reads it.
- **Gathering** (`packages/export/src/main/motion-sounds.ts`): each motion item whose page (or a script beside it) mentions `cuttle.sound` is opened once, as its first showing, and drawn once; what it asked for is placed on the video at every showing (`motionShowings`, `soundsOfShowings`). The editor keeps the answers in a cache until a file in `motion/` changes.
- **Planning:** `planSoundtrack` takes the pages' cues beside the project's sounds; with either, there is a soundtrack (no music needed). The effects switch takes them out.
- **The export** gathers them beside the frames, in the soundtrack's own promise, then plans and renders the soundtrack as before; a missing music page still fails before the frames.
- **The templates** ask for their sounds when they load, from their own timing (the URL's typing, the clicks the video shows).

**Tech Stack:** TypeScript strict, vitest 5 (node and browser), Electron 44.7.2 (offscreen windows), React 19, WebAudio.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase5-motion-design.md` ("Sound"). Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m1f-music-editor.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m1g`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` and the typecheck run in Task 7.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The finished prototype passed `pnpm test` (839 tests, 68 skipped, in two full runs), the typecheck, `app:check` (50 tests) and `cli:check` (12). Every screenshot was looked at.

- **A page asks; Cuttle plays.** A page still makes no sound itself (no `<audio>`, no WebAudio of its own): it names sounds, and the soundtrack renders them with the music page's kit like the project's `sounds`. So they share the effects level and switch, the limiter and the editor's playback, and `music check` measures them.
- **When a page asks:** while it loads (or before a `cuttle.ready` promise ends). Cuttle opens the page, draws its first frame and reads the list; a sound asked for later, in `onFrame`, is not heard (the guide says so). Without `at` or `videoTime` a sound plays at the moment it is asked, in the item's seconds.
- **Where a sound plays:**
  - `at` (seconds into the item): at that point of every showing it fits in (a scene has one showing; an overlay one per stretch of clips that shows it, as the frames have);
  - `videoTime` (an output second): there, when a showing covers it (a callout's click, from `take.toOutput`).
- **Only pages that may ask are opened:** the page's HTML, or a `.js`/`.mjs` file beside it, contains `cuttle.sound`. A page that fails to open names itself in the soundtrack's `skipped` list, and the others play.
- **The export gathers them beside the frames:** the soundtrack's promise opens the pages, plans and renders while the frames are drawn. The plan is also made once before the frames, without them, so a missing music page fails at once as before.
- **The editor** gathers them in the main process too (`EditorSound`), keeps each page's answer by what it was asked with (the page, the item, its first showing) until a file in `motion/` changes, and watches the project as soon as it has motion pages, so a page that starts to ask is heard after its save. The editor sends it every version of a project with music, sounds or any motion item. The status carries them (`pageSounds`: the moment, the sound, the item's name) and a page that could not be read (`skipped`, also when nothing plays), and the Sound lane draws a diamond for each: the page moves it, not a drag.
- **The templates' sounds,** each behind a `sounds` param that is on:
  - title: a whoosh peaking 0.45 s in, as the words rise;
  - end card: an impact as the mark lands (0.05 s), a burst of keys every 0.6 s while the URL types, a ding as the light sweeps it;
  - lower third: a swoosh-in landing as the name rises (0.4 s);
  - click callouts: a pop on each click, at the second the video shows it;
  - code typing: a burst of keys every 0.6 s while it types.
  Their levels come from `music check` on a reel of the title, the code and the end card: the whoosh and the keys were 15 to 25 dB under the end card's hit at first.

## File structure

| File | Responsibility |
|---|---|
| `packages/export/src/motion/runtime.ts`, `packages/export/src/main/motion.ts` | `cuttle.sound`, reading what a page asked for |
| `packages/export/src/main/motion-sounds.ts` | the showings, the pages' sounds on the video, the cache |
| `packages/export/src/main/{soundtrack,export,music-check}.ts`, `packages/export/src/index.ts` | planning, the export, the check |
| `packages/motion-kit/templates/{title,end-card,lower-third,click-callouts,code-typing}/index.html`, `packages/motion-kit/src/index.ts` | the templates' sounds |
| `apps/desktop/src/main/sound-service.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/renderer/editor/{session.ts,Timeline.tsx,editor.css}` | the editor |
| `apps/cli/test/electron.check.test.ts`, `apps/desktop/test/app.check.test.ts`, `skill/cuttle/*.md` | the checks, the guides |

---

### Task 1: `cuttle.sound` in the page

**Files:**
- Modify: `packages/export/src/motion/runtime.ts`, `packages/export/src/main/motion.ts`, `packages/export/test/motion-runtime.browser.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m1g`; work there:

```bash
git switch p5-m1g
```

- [ ] **Step 2: Write the failing test**

In `packages/export/test/motion-runtime.browser.test.ts`, replace:

```ts
    __cuttleDraw(ms: number, view?: import('../src/motion/runtime').MotionView): Promise<number>;
    __cuttleReady(): Promise<void>;
    __cuttleErrors: string[];
    seen: unknown[];
  };
```

with:

```ts
    __cuttleDraw(ms: number, view?: import('../src/motion/runtime').MotionView): Promise<number>;
    __cuttleReady(): Promise<void>;
    __cuttleErrors: string[];
    __cuttleSounds: import('../src/motion/runtime').PageSound[];
    seen: unknown[];
  };
```

In the same file, replace:

```ts
    await new Promise((done) => setTimeout(done, 0));
    expect(ready).toBe(true);
  });
});
```

with:

```ts
    await new Promise((done) => setTimeout(done, 0));
    expect(ready).toBe(true);
  });

  it('gathers the sounds the page asks for: into the item or at a second of the video, once each, at a level from 0 to 1', async () => {
    const win = page(
      '',
      `cuttle.sound('whoosh', { at: 0.3, volume: 0.7 });
       cuttle.sound('whoosh', { at: 0.3, volume: 0.7 });
       cuttle.sound('pop', { videoTime: 12.5, volume: 3 });
       cuttle.sound('sounds/ding.wav');
       cuttle.sound('');
       setTimeout(() => cuttle.sound('tick', { volume: -1 }), 400);`,
      { ...INIT, start: 10 },
    );
    expect(win.__cuttleSounds).toEqual([
      { sound: 'whoosh', at: 0.3, volume: 0.7 },
      { sound: 'pop', video: 12.5, volume: 1 },
      { sound: 'sounds/ding.wav', at: 0, volume: 0.8 },
    ]);
    expect(win.__cuttleErrors).toEqual(['Error: cuttle.sound needs the name of a sound']);
    // without a moment: the moment it is asked, in the item's seconds
    await win.__cuttleDraw(500);
    expect(win.__cuttleSounds.at(-1)).toEqual({ sound: 'tick', at: 0.4, volume: 0 });
  });
});
```

Run: `pnpm exec vitest run --project browser packages/export/test/motion-runtime.browser.test.ts`
Expected: FAIL: `cuttle.sound` is not a function.

- [ ] **Step 3: The runtime**

In `packages/export/src/motion/runtime.ts`, replace:

```ts
  readonly view: MotionView;
}

/** The page's `window.cuttle`. */
export interface CuttleApi {
  /** Seconds into this item. */
```

with:

```ts
  readonly view: MotionView;
}

/** A sound a page asks for (`cuttle.sound`): seconds into its showing (`at`) or an output second (`video`). */
export interface PageSound {
  sound: string;
  at?: number;
  video?: number;
  volume: number;
}

/** The page's `window.cuttle`. */
export interface CuttleApi {
  /** Seconds into this item. */
```

In the same file, replace:

```ts
  ready(promise: Promise<unknown>): void;
  /** The take (empty lists when the item has no take). */
  readonly take: CuttleTake;
}

export function motionRuntime(init: MotionInit): void {
```

with:

```ts
  ready(promise: Promise<unknown>): void;
  /** The take (empty lists when the item has no take). */
  readonly take: CuttleTake;
  /**
   * Asks for a sound (a built-in, as `cuttle sound list` names them, or a file of the project) at `at`
   * seconds into this item, or at `videoTime` (an output second); without either, now. Ask when the
   * page loads (or in `cuttle.ready`): the sounds are gathered from the page's start. The same sound at
   * the same moment counts once.
   */
  sound(name: string, options?: { at?: number; videoTime?: number; volume?: number }): void;
}

export function motionRuntime(init: MotionInit): void {
```

In the same file, replace:

```ts
    },
  };

  const api: CuttleApi = {
    get time() {
      return now / 1000;
```

with:

```ts
    },
  };

  /** The sounds the page asked for (the renderer reads them). */
  const sounds: PageSound[] = [];
  page.__cuttleSounds = sounds;

  const api: CuttleApi = {
    get time() {
      return now / 1000;
```

In the same file, replace:

```ts
    onFrame: (draw) => void drawers.push(draw),
    ready: (promise) => void holds.push(Promise.resolve(promise).catch(note)),
    take,
  };
  page.cuttle = api;
```

with:

```ts
    onFrame: (draw) => void drawers.push(draw),
    ready: (promise) => void holds.push(Promise.resolve(promise).catch(note)),
    take,
    sound: (name, options = {}) => {
      if (typeof name !== 'string' || name === '') return void note(new Error('cuttle.sound needs the name of a sound'));
      const volume = Math.min(1, Math.max(0, Number(options.volume ?? 0.8)));
      const asked: PageSound =
        options.videoTime !== undefined && Number.isFinite(Number(options.videoTime))
          ? { sound: name, video: Number(options.videoTime), volume }
          : { sound: name, at: Number.isFinite(Number(options.at)) ? Number(options.at) : now / 1000, volume };
      const key = JSON.stringify(asked);
      if (!sounds.some((known) => JSON.stringify(known) === key)) sounds.push(asked);
    },
  };
  page.cuttle = api;
```

- [ ] **Step 4: Reading it from the main process**

In `packages/export/src/main/motion.ts`, replace:

```ts
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER, withImportMap } from '@cuttle/motion-kit';
import { BrowserWindow, screen, session, type NativeImage, type Session } from 'electron';
import { motionRuntime, type MotionInit, type MotionView } from '../motion/runtime';

export const MOTION_SCHEME = 'cuttle-motion';
```

with:

```ts
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER, withImportMap } from '@cuttle/motion-kit';
import { BrowserWindow, screen, session, type NativeImage, type Session } from 'electron';
import { motionRuntime, type MotionInit, type MotionView, type PageSound } from '../motion/runtime';

export const MOTION_SCHEME = 'cuttle-motion';
```

In the same file, replace:

```ts
    return this.options.frameSize ?? { width: this.options.init.width, height: this.options.init.height };
  }

  /** What went wrong in the page so far (uncaught errors and rejections), and its console. */
  async report(): Promise<MotionReport> {
    const errors = this.win.isDestroyed() ? [] : ((await this.win.webContents.executeJavaScript('window.__cuttleErrors ?? []').catch(() => [])) as string[]);
```

with:

```ts
    return this.options.frameSize ?? { width: this.options.init.width, height: this.options.init.height };
  }

  /** The sounds the page asked for so far (`cuttle.sound`). */
  async sounds(): Promise<PageSound[]> {
    if (this.win.isDestroyed()) return [];
    return ((await this.win.webContents.executeJavaScript('window.__cuttleSounds ?? []').catch(() => [])) as PageSound[]).filter(
      (sound) => typeof sound?.sound === 'string' && typeof sound.volume === 'number' && (typeof sound.at === 'number' || typeof sound.video === 'number'),
    );
  }

  /** What went wrong in the page so far (uncaught errors and rejections), and its console. */
  async report(): Promise<MotionReport> {
    const errors = this.win.isDestroyed() ? [] : ((await this.win.webContents.executeJavaScript('window.__cuttleErrors ?? []').catch(() => [])) as string[]);
```

- [ ] **Step 5: Run the test**

Run: `pnpm exec vitest run --project browser packages/export/test/motion-runtime.browser.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/export/src/motion/runtime.ts packages/export/src/main/motion.ts packages/export/test/motion-runtime.browser.test.ts
git commit -m "export: cuttle.sound in motion pages: a sound into the item or at a second of the video

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The pages' sounds on the video, and in the plan

**Files:**
- Create: `packages/export/src/main/motion-sounds.ts`, `packages/export/test/main/motion-sounds.test.ts`
- Modify: `packages/export/src/main/soundtrack.ts`, `packages/export/src/index.ts`, `packages/export/test/main/soundtrack.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/export/test/main/motion-sounds.test.ts`:

```ts
import { parseProject } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { motionShowings, motionSoundCues, soundsOfShowings } from '../../src/main/motion-sounds';

function project(input: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

// output: s1 0–2, s2 2–12 (source 10–20), s3 12–22 (source 15–25), s4 22–25
const video = project({
  scenes: [
    { type: 'motion', id: 's1', label: 'Intro', src: 'motion/intro/index.html', duration: 2 },
    { type: 'clip', id: 's2', from: 10, to: 20 },
    { type: 'clip', id: 's3', from: 15, to: 25 },
    { type: 'card', id: 's4', title: 'Cuttle', duration: 3 },
  ],
  overlays: [
    { id: 'o1', src: 'motion/callouts/index.html', at: 16, duration: 2 },
    { id: 'o2', src: 'motion/late/index.html', at: 30, duration: 2 },
    { id: 'o3', src: 'motion/off/index.html', at: 11, duration: 1, enabled: false },
  ],
});

describe('the showings of motion items', () => {
  it('gives a scene its stretch and an overlay each stretch of clips that shows it, and skips the rest', () => {
    const showings = motionShowings(video);
    expect(showings.map(({ kind, index, showings }) => ({ kind, index, showings }))).toEqual([
      { kind: 'scene', index: 0, showings: [{ start: 0, duration: 2 }] },
      // source 16–18 plays in s2 (output 8–10) and again in s3 (output 13–15)
      { kind: 'overlay', index: 0, showings: [{ start: 8, duration: 2 }, { start: 13, duration: 2 }] },
    ]);
  });
});

describe('the sounds a page asked for, on the video', () => {
  const showings = [
    { start: 8, duration: 2 },
    { start: 13, duration: 2 },
  ];

  it('plays one asked for seconds into the item at every showing it fits in', () => {
    expect(
      soundsOfShowings(showings, [
        { sound: 'whoosh', at: 0.3, volume: 0.7 },
        { sound: 'ding', at: 2.5, volume: 0.8 },
      ]),
    ).toEqual([
      { at: 8.3, sound: 'whoosh', volume: 0.7 },
      { at: 13.3, sound: 'whoosh', volume: 0.7 },
    ]);
  });

  it('plays one asked for a second of the video there, when a showing covers it', () => {
    expect(
      soundsOfShowings(showings, [
        { sound: 'pop', video: 14.25, volume: 0.4 },
        { sound: 'pop', video: 9, volume: 0.4 },
        { sound: 'pop', video: 11, volume: 0.4 },
        { sound: 'pop', video: 15, volume: 0.4 },
      ]),
    ).toEqual([
      { at: 9, sound: 'pop', volume: 0.4 },
      { at: 14.25, sound: 'pop', volume: 0.4 },
    ]);
  });

  it('asks no page while the sound or the effects are off, or without pages', async () => {
    const pages = { root: '.', scenes: { 0: 'motion/intro/index.html' }, overlays: {} };
    const take = { events: [], words: [], markers: [] };
    expect(await motionSoundCues(video, undefined, take)).toEqual({ cues: [], errors: [], items: [] });
    const off = { ...video, look: { ...video.look, audio: { ...video.look.audio, effects: false } } };
    expect(await motionSoundCues(off, pages, take)).toEqual({ cues: [], errors: [], items: [] });
    // a page that never calls cuttle.sound (here: none at all) is not opened
    expect(await motionSoundCues(video, { ...pages, scenes: { 0: 'no/such/page.html' } }, take)).toEqual({ cues: [], errors: [], items: [] });
  });
});
```

In `packages/export/test/main/soundtrack.test.ts`, replace:

```ts
    expect(plan!.video.duration).toBe(4);
  });

  it('refuses a music page outside the project, and names one that is missing', async () => {
    const dir = temp();
    await expect(planSoundtrack(dir, project({ music: { src: '../x.html' } }), NO_TAKE)).rejects.toThrow(/outside the project/);
```

with:

```ts
    expect(plan!.video.duration).toBe(4);
  });

  it('plays the sounds motion pages ask for with the project\'s, in order, also without music or sounds of its own', async () => {
    const dir = temp();
    mkdirSync(join(dir, 'sounds'));
    writeFileSync(join(dir, 'sounds', 'ding.wav'), 'RIFF');
    const asked = [
      { at: 3.5, sound: 'sounds/ding.wav', volume: 0.5 },
      { at: 0.3, sound: 'whoosh', volume: 0.7 },
      { at: 2, sound: 'sounds/none.wav', volume: 0.8 },
    ];
    const alone = await planSoundtrack(dir, project({}), NO_TAKE, asked);
    expect(alone!.page).toBeUndefined();
    expect(alone!.sounds).toEqual([
      { at: 0.3, sound: 'whoosh', volume: 0.7 },
      { at: 3.5, sound: 'sounds/ding.wav', volume: 0.5, url: 'cuttle-motion://project/sounds/ding.wav' },
    ]);
    expect(alone!.skipped).toEqual(['sounds/none.wav: not a file in the project']);
    const both = await planSoundtrack(dir, project({ sounds: [{ sound: 'pop', at: 1 }] }), NO_TAKE, asked.slice(0, 2));
    expect(both!.sounds.map((cue) => [cue.at, cue.sound])).toEqual([[0.3, 'whoosh'], [1, 'pop'], [3.5, 'sounds/ding.wav']]);
    // the effects off: the pages' sounds go too
    expect(await planSoundtrack(dir, project({ look: { audio: { effects: false } } }), NO_TAKE, asked)).toBeUndefined();
  });

  it('refuses a music page outside the project, and names one that is missing', async () => {
    const dir = temp();
    await expect(planSoundtrack(dir, project({ music: { src: '../x.html' } }), NO_TAKE)).rejects.toThrow(/outside the project/);
```

Run: `pnpm exec vitest run --project node packages/export/test/main/motion-sounds.test.ts packages/export/test/main/soundtrack.test.ts`
Expected: FAIL: there is no `motion-sounds` module, and the plan takes no pages' sounds.

- [ ] **Step 2: The showings and the sounds on them**

`packages/export/src/main/motion-sounds.ts`:

```ts
// The sounds motion pages ask for (`cuttle.sound`): a page that asks for any is opened once, as
// its item's first showing, and drawn once; what it asked for plays at every showing of the item,
// in output seconds, with the project's other sounds.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { KIT_FONTS } from '@cuttle/motion-kit';
import type { CuttleProject, MotionOverlay, MotionScene } from '@cuttle/project';
import { occurrences, sceneSpans } from '@cuttle/timeline';
import type { MotionPages } from '../job';
import { motionInit } from '../motion/init';
import { declaredParams, paramDefaults } from '../motion/params';
import type { PageSound } from '../motion/runtime';
import type { SoundCue } from '../music/runtime';
import { takeData, type TakeInputs } from '../motion/take';
import { MotionPage, type MotionPageOptions } from './motion';

/** One stretch of the video that shows a motion item: its output start and how long. */
export interface Showing {
  start: number;
  duration: number;
}

const milli = (value: number) => Math.round(value * 1000) / 1000;

/** Each showing of each motion item: a scene's one, an overlay's per stretch of clips that shows it. */
export function motionShowings(project: CuttleProject): { kind: 'scene' | 'overlay'; index: number; item: MotionScene | MotionOverlay; showings: Showing[] }[] {
  const spans = sceneSpans(project.scenes, project.cuts);
  const out: ReturnType<typeof motionShowings> = [];
  project.scenes.forEach((scene, index) => {
    if (scene.type !== 'motion') return;
    const span = spans.find((candidate) => candidate.sceneIndex === index);
    if (span) out.push({ kind: 'scene', index, item: scene, showings: [{ start: span.start, duration: span.end - span.start }] });
  });
  project.overlays.forEach((overlay, index) => {
    if (!overlay.enabled) return;
    const shown = [...new Set(occurrences(spans, overlay.at, overlay.at + overlay.duration).filter((occurrence) => occurrence !== undefined))];
    if (shown.length > 0) out.push({ kind: 'overlay', index, item: overlay, showings: shown.map((occurrence) => ({ start: occurrence!.start, duration: occurrence!.end - occurrence!.start })) });
  });
  return out;
}

/**
 * Where a page's sounds play: one asked for `at` seconds into the item, at that point of every
 * showing it fits in; one asked for an output second, there when a showing covers it.
 */
export function soundsOfShowings(showings: readonly Showing[], sounds: readonly PageSound[]): SoundCue[] {
  const cues: SoundCue[] = [];
  for (const sound of sounds) {
    if (sound.video !== undefined) {
      const video = sound.video;
      if (showings.some((showing) => video >= showing.start - 1e-9 && video < showing.start + showing.duration)) cues.push({ at: milli(video), sound: sound.sound, volume: sound.volume });
      continue;
    }
    const at = sound.at ?? 0;
    for (const showing of showings) if (at >= 0 && at < showing.duration) cues.push({ at: milli(showing.start + at), sound: sound.sound, volume: sound.volume });
  }
  return cues.sort((a, b) => a.at - b.at);
}

/** Whether a page may ask for sounds: it, or a script beside it, calls `cuttle.sound`. */
async function asksForSounds(file: string): Promise<boolean> {
  const text = await readFile(file, 'utf8').catch(() => '');
  if (text.includes('cuttle.sound')) return true;
  const folder = dirname(file);
  const names = await readdir(folder).catch(() => [] as string[]);
  for (const name of names.filter((candidate) => /\.(m?js)$/i.test(candidate))) {
    if ((await readFile(join(folder, name), 'utf8').catch(() => '')).includes('cuttle.sound')) return true;
  }
  return false;
}

/** The sounds one motion item's page asked for, on the video: `name` is its label, else its id or `scenes[0]`. */
export interface ItemSounds {
  kind: 'scene' | 'overlay';
  index: number;
  name: string;
  cues: SoundCue[];
}

/** What a page asked for, by what it was asked with; kept across renders while nothing changes. */
export type PageSoundCache = Map<string, PageSound[]>;

/**
 * The sounds the project's motion pages ask for, in output seconds (none while the sound or the
 * effects are off). A page is opened only when it, or a script beside it, calls `cuttle.sound`; one
 * that fails says so in `errors`, and the rest play.
 * `changes` (a count of the pages' file changes) is part of what `cache` keeps a page's answer by.
 */
export async function motionSoundCues(
  project: CuttleProject,
  pages: MotionPages | undefined,
  take: TakeInputs,
  options: { cache?: PageSoundCache; changes?: number } & Pick<MotionPageOptions, 'kitDir' | 'loadTimeout' | 'frameTimeout'> = {},
): Promise<{ cues: SoundCue[]; errors: string[]; items: ItemSounds[] }> {
  const { audio } = project.look;
  if (!pages || !audio.enabled || !audio.effects) return { cues: [], errors: [], items: [] };
  const cues: SoundCue[] = [];
  const errors: string[] = [];
  const items: ItemSounds[] = [];
  for (const { kind, index, item, showings } of motionShowings(project)) {
    const file = (kind === 'scene' ? pages.scenes : pages.overlays)[index];
    if (file === undefined || !(await asksForSounds(file))) continue;
    const name = `${kind === 'scene' ? 'scenes' : 'overlays'}[${index}]`;
    const first = showings[0]!;
    const key = JSON.stringify({ file, item, first, changes: options.changes ?? 0 });
    let sounds = options.cache?.get(key);
    if (!sounds) {
      let page: MotionPage | undefined;
      try {
        const declared = declaredParams(await readFile(file, 'utf8'));
        const window = 'type' in item ? null : { from: item.at, to: item.at + item.duration };
        const init = motionInit(project, item, name, first, {
          take: takeData(project, take, { width: project.output.width, height: project.output.height }, window),
          fonts: [...KIT_FONTS],
          defaults: paramDefaults(declared.params),
        });
        const { kitDir, loadTimeout, frameTimeout } = options;
        page = await MotionPage.open({ file, root: pages.root, init, network: item.network, ...(kitDir && { kitDir }), ...(loadTimeout && { loadTimeout }), ...(frameTimeout && { frameTimeout }) });
        await page.frame(0);
        sounds = await page.sounds();
        options.cache?.set(key, sounds);
      } catch (error) {
        errors.push(`${name}: its sounds could not be read: ${(error as Error).message.split('\n')[0]}`);
        continue;
      } finally {
        page?.close();
      }
    }
    const played = soundsOfShowings(showings, sounds);
    if (played.length > 0) items.push({ kind, index, name: item.label ?? item.id ?? name, cues: played });
    cues.push(...played);
  }
  return { cues: cues.sort((a, b) => a.at - b.at), errors, items };
}
```

- [ ] **Step 3: The plan takes them**

In `packages/export/src/main/soundtrack.ts`, replace:

```ts
import { motionSeed } from '../motion/init';
import { declaredParams } from '../motion/params';
import { soundCues, videoData, type VideoInputs } from '../music/video';
import type { VideoData } from '../music/runtime';
import { duckEnvelope } from '../music/duck';

export { DUCK_ATTACK, DUCK_RELEASE, duckEnvelope } from '../music/duck';
```

with:

```ts
import { motionSeed } from '../motion/init';
import { declaredParams } from '../motion/params';
import { soundCues, videoData, type VideoInputs } from '../music/video';
import type { SoundCue, VideoData } from '../music/runtime';
import { duckEnvelope } from '../music/duck';

export { DUCK_ATTACK, DUCK_RELEASE, duckEnvelope } from '../music/duck';
```

In the same file, replace:

```ts

/**
 * What the project's soundtrack holds: none when the audio is off, or when it has no music that plays
 * and no sounds (the typing clicks alone are mixed without a page).
 */
export async function planSoundtrack(projectDir: string, project: CuttleProject, inputs: VideoInputs): Promise<SoundtrackPlan | undefined> {
  const { audio } = project.look;
  if (!audio.enabled) return undefined;
  const music = project.music?.enabled ? project.music : undefined;
  const sounds = audio.effects ? project.sounds.filter((sound) => sound.enabled) : [];
  if (!music && sounds.length === 0) return undefined;
  const root = resolve(projectDir);
  let params: Record<string, unknown> = {};
  let page: string | undefined;
```

with:

```ts

/**
 * What the project's soundtrack holds: none when the audio is off, or when it has no music that plays
 * and no sounds (the typing clicks alone are mixed without a page). `pageSounds` are the sounds its
 * motion pages asked for, in output seconds (`motionSoundCues`); they play with the project's own.
 */
export async function planSoundtrack(
  projectDir: string,
  project: CuttleProject,
  inputs: VideoInputs,
  pageSounds: readonly SoundCue[] = [],
): Promise<SoundtrackPlan | undefined> {
  const { audio } = project.look;
  if (!audio.enabled) return undefined;
  const music = project.music?.enabled ? project.music : undefined;
  const sounds = audio.effects ? project.sounds.filter((sound) => sound.enabled) : [];
  const fromPages = audio.effects ? pageSounds : [];
  if (!music && sounds.length === 0 && fromPages.length === 0) return undefined;
  const root = resolve(projectDir);
  let params: Record<string, unknown> = {};
  let page: string | undefined;
```

In the same file, replace:

```ts
  }
  const skipped: string[] = [];
  const cues: SoundtrackPlan['sounds'] = [];
  for (const cue of soundCues(project, sounds)) {
    if (!isSoundFile(cue.sound)) {
      cues.push(cue);
      continue;
```

with:

```ts
  }
  const skipped: string[] = [];
  const cues: SoundtrackPlan['sounds'] = [];
  const asked = [...soundCues(project, sounds), ...fromPages].sort((a, b) => a.at - b.at);
  for (const cue of asked) {
    if (!isSoundFile(cue.sound)) {
      cues.push(cue);
      continue;
```

In the same file, replace:

```ts
    const path = resolve(root, cue.sound);
    const exists = inside(root, path) && (await stat(path).then((info) => info.isFile(), () => false));
    if (!exists) skipped.push(`${cue.sound}: not a file in the project`);
    else cues.push({ ...cue, url: pageUrl(root, path) });
  }
  return {
    video: videoData(project, inputs),
```

with:

```ts
    const path = resolve(root, cue.sound);
    const exists = inside(root, path) && (await stat(path).then((info) => info.isFile(), () => false));
    if (!exists) skipped.push(`${cue.sound}: not a file in the project`);
    else cues.push({ at: cue.at, sound: cue.sound, volume: cue.volume, url: pageUrl(root, path) });
  }
  return {
    video: videoData(project, inputs),
```

What the app's main process imports:

In `packages/export/src/index.ts`, replace:

```ts
export { checkMusic, type MusicCheckOptions, type MusicCheckResult } from './main/music-check';
export { planSoundtrack, renderSoundtrack, type SoundtrackPlan } from './main/soundtrack';
export type { MusicStems } from './main/music';
export { motionTake } from './main/sources';
export type { MusicInfo } from './music/runtime';
export type { SoundtrackReport } from './main/export';
export type { MotionItemReport } from './main/motion-host';
```

with:

```ts
export { checkMusic, type MusicCheckOptions, type MusicCheckResult } from './main/music-check';
export { planSoundtrack, renderSoundtrack, type SoundtrackPlan } from './main/soundtrack';
export type { MusicStems } from './main/music';
export { motionPages, motionTake } from './main/sources';
export { motionSoundCues, type ItemSounds, type PageSoundCache } from './main/motion-sounds';
export type { MusicInfo } from './music/runtime';
export type { SoundtrackReport } from './main/export';
export type { MotionItemReport } from './main/motion-host';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/export/test/main/motion-sounds.test.ts packages/export/test/main/soundtrack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/export/src/main/motion-sounds.ts packages/export/src/main/soundtrack.ts packages/export/src/index.ts packages/export/test/main/motion-sounds.test.ts packages/export/test/main/soundtrack.test.ts
git commit -m "export: the sounds motion pages ask for, on each showing of their item, planned with the project's

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The export and the check play them

**Files:**
- Modify: `packages/export/src/main/export.ts`, `packages/export/src/main/music-check.ts`

- [ ] **Step 1: The export**

The soundtrack's promise gathers the pages' sounds beside the frames, then plans and renders; the plan before the frames stays, so a missing music page fails at once:

In `packages/export/src/main/export.ts`, replace:

```ts
import { checkFfmpeg, runFfmpeg } from './ffmpeg';
import { FileHost } from './files';
import { MotionHost, motionWarnings, serveMotion, type MotionItemReport } from './motion-host';
import { loadSources, motionTake, samePath } from './sources';
import { planSoundtrack, renderSoundtrack, writeSoundTrack, type SoundtrackPlan } from './soundtrack';
import type { MusicStems } from './music';
```

with:

```ts
import { checkFfmpeg, runFfmpeg } from './ffmpeg';
import { FileHost } from './files';
import { MotionHost, motionWarnings, serveMotion, type MotionItemReport } from './motion-host';
import { motionSoundCues } from './motion-sounds';
import { loadSources, motionTake, samePath } from './sources';
import { planSoundtrack, renderSoundtrack, writeSoundTrack, type SoundtrackPlan } from './soundtrack';
import type { MusicStems } from './music';
```

In the same file, replace:

```ts
  let files: FileHost | undefined;
  let window: ExportWindow | undefined;
  const motion = sources.motion && sources.motionTake ? new MotionHost(project, sources.motion, sources.motionTake) : undefined;
  // the music and sounds render beside the frames, in a page of their own
  const soundPlan = await planSoundtrack(projectDir, project, sources.motionTake ?? (await motionTake(projectDir, project)));
  let soundtrack: Promise<MusicStems> | undefined;
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const video = join(work, 'video.mp4');
```

with:

```ts
  let files: FileHost | undefined;
  let window: ExportWindow | undefined;
  const motion = sources.motion && sources.motionTake ? new MotionHost(project, sources.motion, sources.motionTake) : undefined;
  // the music and sounds render beside the frames, in a page of their own; checked here, so a missing
  // music page fails before the frames, and planned again with the sounds the motion pages ask for
  const take = sources.motionTake ?? (await motionTake(projectDir, project));
  await planSoundtrack(projectDir, project, take);
  let soundtrack: Promise<{ plan: SoundtrackPlan; stems: MusicStems } | undefined> | undefined;
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const video = join(work, 'video.mp4');
```

In the same file, replace:

```ts
      opts.onProgress?.(done, total);
    });
    serveMotion(ipc, motion, guard.alive);
    soundtrack = soundPlan ? renderSoundtrack(projectDir, soundPlan) : undefined;
    soundtrack?.catch(() => {});

    const page = await runPage<PageSuccess>(window, guard.stalled, cancel.promise);
    guard.stop();
```

with:

```ts
      opts.onProgress?.(done, total);
    });
    serveMotion(ipc, motion, guard.alive);
    soundtrack = (async () => {
      const asked = await motionSoundCues(project, sources.motion, take);
      const plan = await planSoundtrack(projectDir, project, take, asked.cues);
      if (!plan) return void asked.errors.forEach((error) => console.warn(`warning: ${error}`));
      plan.skipped.push(...asked.errors);
      return { plan, stems: await renderSoundtrack(projectDir, plan) };
    })();
    soundtrack.catch(() => {});

    const page = await runPage<PageSuccess>(window, guard.stalled, cancel.promise);
    guard.stop();
```

In the same file, replace:

```ts
    // the typing sounds: a track of their own on the video's timeline, mixed in after the mic
    const clicks = typingClicks(spans, sources.keys ?? [], project.look.audio);
    // with music or sounds, one stereo soundtrack holds them and the typing clicks; else the clicks alone
    const stems = soundtrack ? await soundtrack.catch((error: Error) => {
      throw new ExportError('render', `the music could not be rendered: ${error.message}`, { cause: error });
    }) : undefined;
    let musicReport: SoundtrackReport | undefined;
    let typing: string | undefined;
    let sound: string | undefined;
    if (stems && soundPlan) {
      musicReport = soundtrackReport(projectDir, soundPlan, stems);
      for (const warning of [...musicReport.errors, ...musicReport.skipped]) console.warn(`warning: music${musicReport.src ? ` (${musicReport.src})` : ''}: ${warning}`);
      sound = join(work, 'sound.wav');
      await writeSoundTrack(sound, {
        seconds,
        stems,
        ...(project.music?.enabled && { music: { volume: project.music.volume, duck: project.music.duck } }),
        speech: soundPlan.video.speech,
        effectsVolume: project.look.audio.effects ? project.look.audio.effectsVolume : 0,
        ...(clicks.length > 0 && { typing: { clicks, volume: project.look.audio.typingVolume } }),
      });
```

with:

```ts
    // the typing sounds: a track of their own on the video's timeline, mixed in after the mic
    const clicks = typingClicks(spans, sources.keys ?? [], project.look.audio);
    // with music or sounds, one stereo soundtrack holds them and the typing clicks; else the clicks alone
    const rendered = await soundtrack.catch((error: Error) => {
      throw new ExportError('render', `the music could not be rendered: ${error.message}`, { cause: error });
    });
    let musicReport: SoundtrackReport | undefined;
    let typing: string | undefined;
    let sound: string | undefined;
    if (rendered) {
      const { plan, stems } = rendered;
      musicReport = soundtrackReport(projectDir, plan, stems);
      for (const warning of [...musicReport.errors, ...musicReport.skipped]) console.warn(`warning: music${musicReport.src ? ` (${musicReport.src})` : ''}: ${warning}`);
      sound = join(work, 'sound.wav');
      await writeSoundTrack(sound, {
        seconds,
        stems,
        ...(project.music?.enabled && { music: { volume: project.music.volume, duck: project.music.duck } }),
        speech: plan.video.speech,
        effectsVolume: project.look.audio.effects ? project.look.audio.effectsVolume : 0,
        ...(clicks.length > 0 && { typing: { clicks, volume: project.look.audio.typingVolume } }),
      });
```

- [ ] **Step 2: `cuttle music check`**

In `packages/export/src/main/music-check.ts`, replace:

```ts
import { ExportError } from '../errors';
import { ffmpegPath } from './ffmpeg';
import { soundtrackReport, type SoundtrackReport } from './export';
import { motionTake, loadSources } from './sources';
import { duckEnvelope, planSoundtrack, renderSoundtrack, writeSoundTrack } from './soundtrack';
```

with:

```ts
import { ExportError } from '../errors';
import { ffmpegPath } from './ffmpeg';
import { soundtrackReport, type SoundtrackReport } from './export';
import { motionSoundCues } from './motion-sounds';
import { motionTake, loadSources } from './sources';
import { duckEnvelope, planSoundtrack, renderSoundtrack, writeSoundTrack } from './soundtrack';
```

In the same file, replace:

```ts
  let project = sources.project;
  if (options.src) project = { ...project, music: { volume: 0.8, duck: 12, network: false, params: {}, ...project.music, src: options.src, enabled: true } };
  const inputs = sources.motionTake ?? (await motionTake(projectDir, project));
  const plan = await planSoundtrack(projectDir, project, inputs);
  if (!plan) {
    const why = !project.look.audio.enabled ? 'the audio is off (look.audio.enabled)' : 'the project has no music and no sounds: add some with "cuttle music new" or "cuttle sound add"';
    throw new ExportError('invalid-project', why);
  }
  const stems = await renderSoundtrack(projectDir, plan);
  const report = soundtrackReport(projectDir, plan, stems);
  const seconds = plan.video.duration;
```

with:

```ts
  let project = sources.project;
  if (options.src) project = { ...project, music: { volume: 0.8, duck: 12, network: false, params: {}, ...project.music, src: options.src, enabled: true } };
  const inputs = sources.motionTake ?? (await motionTake(projectDir, project));
  const asked = await motionSoundCues(project, sources.motion, inputs);
  const plan = await planSoundtrack(projectDir, project, inputs, asked.cues);
  if (!plan) {
    const why = !project.look.audio.enabled ? 'the audio is off (look.audio.enabled)' : 'the project has no music and no sounds: add some with "cuttle music new" or "cuttle sound add"';
    throw new ExportError('invalid-project', why);
  }
  plan.skipped.push(...asked.errors);
  const stems = await renderSoundtrack(projectDir, plan);
  const report = soundtrackReport(projectDir, plan, stems);
  const seconds = plan.video.duration;
```

- [ ] **Step 3: The typecheck of the export**

Run: `pnpm exec tsc -p packages/export/tsconfig.node.json`
Expected: exits with code 0.

- [ ] **Step 4: Commit**

```bash
git add packages/export/src/main/export.ts packages/export/src/main/music-check.ts
git commit -m "export: the export and music check play the sounds motion pages ask for

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The templates make their sounds

**Files:**
- Modify: `packages/motion-kit/templates/title/index.html`, `packages/motion-kit/templates/end-card/index.html`, `packages/motion-kit/templates/lower-third/index.html`, `packages/motion-kit/templates/click-callouts/index.html`, `packages/motion-kit/templates/code-typing/index.html`, `packages/motion-kit/src/index.ts`, `packages/motion-kit/test/kit.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/motion-kit/test/kit.test.ts`, replace:

```ts
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copyTemplate, MissingTemplateError } from '../src/files';
import { KIT_FONTS, KIT_IMPORTS, KIT_ORIGIN, MOTION_TEMPLATES, MUSIC_TEMPLATES, importMapTag, withImportMap } from '../src/index';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
```

with:

```ts
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copyTemplate, MissingTemplateError } from '../src/files';
import { BUILT_IN_SOUNDS, KIT_FONTS, KIT_IMPORTS, KIT_ORIGIN, MOTION_TEMPLATES, MUSIC_TEMPLATES, importMapTag, withImportMap } from '../src/index';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
```

In the same file, replace:

```ts
    }
  });

  it('has a page for every music template that composes with cuttle.music and declares its params', () => {
    expect(MUSIC_TEMPLATES.map((template) => template.name)).toEqual(['pulse', 'drift', 'lofi', 'bright', 'cinematic']);
    for (const template of MUSIC_TEMPLATES) {
```

with:

```ts
    }
  });

  it('makes sounds in the templates that move, built-in ones, behind a sounds param that is on', () => {
    const names = new Set(BUILT_IN_SOUNDS.map(([name]) => name));
    const making: string[] = [];
    for (const template of MOTION_TEMPLATES) {
      const html = readFileSync(`${TEMPLATES}${template.name}/index.html`, 'utf8');
      const asked = [...html.matchAll(/cuttle\.sound\('([^']+)'/g)].map((match) => match[1]!);
      if (asked.length === 0) continue;
      making.push(template.name);
      const declared = html.split('id="cuttle-params">')[1]?.split('</' + 'script>')[0];
      const params = JSON.parse(declared ?? 'null') as { name: string; type: string; default: unknown }[];
      expect(params.find((param) => param.name === 'sounds'), template.name).toMatchObject({ type: 'bool', default: true });
      expect(html, template.name).toContain('params.sounds !== false');
      for (const name of asked) expect(names.has(name), `${template.name}: ${name}`).toBe(true);
    }
    expect(making).toEqual(['title', 'end-card', 'code-typing', 'lower-third', 'click-callouts']);
  });

  it('has a page for every music template that composes with cuttle.music and declares its params', () => {
    expect(MUSIC_TEMPLATES.map((template) => template.name)).toEqual(['pulse', 'drift', 'lofi', 'bright', 'cinematic']);
    for (const template of MUSIC_TEMPLATES) {
```

Run: `pnpm exec vitest run --project node packages/motion-kit/test/kit.test.ts`
Expected: FAIL: no template asks for a sound.

- [ ] **Step 2: The title and the end card**

In `packages/motion-kit/templates/title/index.html`, replace:

```html
    <meta charset="utf-8" />
    <title>Title</title>
    <!-- A kinetic title: an eyebrow line, the title's words rising out of a blur, an accent line
         that draws under them, a subtitle; everything leaves upward at the end. -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "title", "label": "Title", "type": "text", "default": "Built with Claude Code" },
        { "name": "subtitle", "label": "Subtitle", "type": "text", "default": "" },
        { "name": "eyebrow", "label": "Small line above", "type": "text", "default": "" },
        { "name": "align", "label": "Align", "type": "select", "default": "center", "options": ["center", "left"] },
        { "name": "background", "label": "Own background", "type": "bool", "default": true }
      ]
    </script>
    <style>
```

with:

```html
    <meta charset="utf-8" />
    <title>Title</title>
    <!-- A kinetic title: an eyebrow line, the title's words rising out of a blur, an accent line
         that draws under them, a subtitle; everything leaves upward at the end. A whoosh as the
         words come in (the "sounds" param). -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "title", "label": "Title", "type": "text", "default": "Built with Claude Code" },
        { "name": "subtitle", "label": "Subtitle", "type": "text", "default": "" },
        { "name": "eyebrow", "label": "Small line above", "type": "text", "default": "" },
        { "name": "align", "label": "Align", "type": "select", "default": "center", "options": ["center", "left"] },
        { "name": "background", "label": "Own background", "type": "bool", "default": true },
        { "name": "sounds", "label": "Sounds", "type": "bool", "default": true }
      ]
    </script>
    <style>
```

In the same file, replace:

```html
        g.fillRect(0, 0, w, h);
      }

      const line = document.getElementById('line');
      const bar = eyebrow.isConnected ? eyebrow.querySelector('i') : null;
      const leave = Math.max(1.6, duration - 0.65);
```

with:

```html
        g.fillRect(0, 0, w, h);
      }

      // its sound: a whoosh as the words rise in
      if (params.sounds !== false) cuttle.sound('whoosh', { at: 0.45, volume: 1 });

      const line = document.getElementById('line');
      const bar = eyebrow.isConnected ? eyebrow.querySelector('i') : null;
      const leave = Math.max(1.6, duration - 0.65);
```

In `packages/motion-kit/templates/end-card/index.html`, replace:

```html
    <title>End card</title>
    <!-- The end card: a logo (or a monogram tile) springs in with a ring, the headline rises letter by
         letter, the URL types itself into a glass pill that a light sweeps across, a call to action
         settles under it; particles drift up behind. -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "headline", "label": "Headline", "type": "text", "default": "Try it yourself" },
        { "name": "url", "label": "URL", "type": "text", "default": "example.com" },
        { "name": "cta", "label": "Call to action", "type": "text", "default": "Link in the description" },
        { "name": "logo", "label": "Logo (an image in the project)", "type": "image", "default": null },
        { "name": "monogram", "label": "Monogram without a logo", "type": "text", "default": "C" }
      ]
    </script>
    <style>
```

with:

```html
    <title>End card</title>
    <!-- The end card: a logo (or a monogram tile) springs in with a ring, the headline rises letter by
         letter, the URL types itself into a glass pill that a light sweeps across, a call to action
         settles under it; particles drift up behind. Its sounds: a hit as the mark lands, keys while
         the URL types, a ding once it is there (the "sounds" param). -->
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
    <style>
```

In the same file, replace:

```html
      const cta = document.getElementById('cta');
      const typeFrom = 1.05;
      const typedAt = typedUntil(params.url || '', { start: typeFrom, cps: 22 });
      cuttle.onFrame((t) => {
        particles(t);
        // the mark springs in, a ring leaves it
```

with:

```html
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
        // the mark springs in, a ring leaves it
```

- [ ] **Step 3: The lower third, the callouts and the code**

In `packages/motion-kit/templates/lower-third/index.html`, replace:

```html
    <meta charset="utf-8" />
    <title>Lower third</title>
    <!-- A name and a role over the video: an accent bar grows, a glass card wipes open from it, the
         name and the role rise out of their masks; at the end it all folds back. -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "name", "label": "Name", "type": "text", "default": "Lena Müller" },
        { "name": "role", "label": "Role", "type": "text", "default": "Founder · Cuttle" },
        { "name": "side", "label": "Side", "type": "select", "default": "left", "options": ["left", "right"] },
        { "name": "place", "label": "Place", "type": "select", "default": "bottom", "options": ["bottom", "top"] }
      ]
    </script>
    <style>
```

with:

```html
    <meta charset="utf-8" />
    <title>Lower third</title>
    <!-- A name and a role over the video: an accent bar grows, a glass card wipes open from it, the
         name and the role rise out of their masks; at the end it all folds back. A short swoosh as
         the name lands (the "sounds" param). -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "name", "label": "Name", "type": "text", "default": "Lena Müller" },
        { "name": "role", "label": "Role", "type": "text", "default": "Founder · Cuttle" },
        { "name": "side", "label": "Side", "type": "select", "default": "left", "options": ["left", "right"] },
        { "name": "place", "label": "Place", "type": "select", "default": "bottom", "options": ["bottom", "top"] },
        { "name": "sounds", "label": "Sounds", "type": "bool", "default": true }
      ]
    </script>
    <style>
```

In the same file, replace:

```html
      const name = document.getElementById('name');
      const role = document.getElementById('role-line');
      const right = params.side === 'right';

      cuttle.onFrame((t) => {
        // out: the last 0.7 s, in the reverse order
```

with:

```html
      const name = document.getElementById('name');
      const role = document.getElementById('role-line');
      const right = params.side === 'right';
      if (params.sounds !== false) cuttle.sound('swoosh-in', { at: 0.4, volume: 0.6 });

      cuttle.onFrame((t) => {
        // out: the last 0.7 s, in the reverse order
```

In `packages/motion-kit/templates/click-callouts/index.html`, replace:

```html
    <meta charset="utf-8" />
    <title>Click callouts</title>
    <!-- At every click the video shows: a dot that pops, two rings that leave it, and a numbered
         badge on a short stem; on the click itself, wherever the window, crop and zoom put it. -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "numbered", "label": "Numbers", "type": "bool", "default": true },
        { "name": "label", "label": "Word after the number", "type": "text", "default": "" },
        { "name": "color", "label": "Colour (empty: the accent)", "type": "color", "default": null },
        { "name": "size", "label": "Size", "type": "number", "default": 1, "min": 0.5, "max": 2 }
      ]
    </script>
    <style>
```

with:

```html
    <meta charset="utf-8" />
    <title>Click callouts</title>
    <!-- At every click the video shows: a dot that pops, two rings that leave it, and a numbered
         badge on a short stem; on the click itself, wherever the window, crop and zoom put it. A pop
         on each (the "sounds" param). -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "numbered", "label": "Numbers", "type": "bool", "default": true },
        { "name": "label", "label": "Word after the number", "type": "text", "default": "" },
        { "name": "color", "label": "Colour (empty: the accent)", "type": "color", "default": null },
        { "name": "size", "label": "Size", "type": "number", "default": 1, "min": 0.5, "max": 2 },
        { "name": "sounds", "label": "Sounds", "type": "bool", "default": true }
      ]
    </script>
    <style>
```

In the same file, replace:

```html
        .filter((click) => click.at !== null)
        .sort((a, b) => a.at - b.at)
        .map((click, i) => ({ ...click, number: i + 1 }));

      function callout(click, age) {
        const point = take.toScreen(click.x, click.y);
```

with:

```html
        .filter((click) => click.at !== null)
        .sort((a, b) => a.at - b.at)
        .map((click, i) => ({ ...click, number: i + 1 }));
      // a pop on each click, at the second the video shows it
      if (params.sounds !== false) for (const click of clicks) cuttle.sound('pop', { videoTime: click.at, volume: 0.5 });

      function callout(click, age) {
        const point = take.toScreen(click.x, click.y);
```

In `packages/motion-kit/templates/code-typing/index.html`, replace:

```html
    <meta charset="utf-8" />
    <title>Code typing</title>
    <!-- A code editor that types a file: syntax colours, line numbers, the current line lit, a caret
         that blinks once it is done, and the view scrolling along with the caret. -->
    <script type="application/json" id="cuttle-params">
      [
        {
```

with:

```html
    <meta charset="utf-8" />
    <title>Code typing</title>
    <!-- A code editor that types a file: syntax colours, line numbers, the current line lit, a caret
         that blinks once it is done, and the view scrolling along with the caret. Keys clatter while
         it types (the "sounds" param). -->
    <script type="application/json" id="cuttle-params">
      [
        {
```

In the same file, replace:

```html
        { "name": "language", "label": "Language", "type": "select", "default": "ts", "options": ["ts", "js", "python", "bash", "json", "html", "css", "go", "rust", "sql"] },
        { "name": "file", "label": "File name", "type": "text", "default": "demo.ts" },
        { "name": "cps", "label": "Characters a second", "type": "number", "default": 34, "min": 5, "max": 200 },
        { "name": "background", "label": "Own background", "type": "bool", "default": true }
      ]
    </script>
    <style>
```

with:

```html
        { "name": "language", "label": "Language", "type": "select", "default": "ts", "options": ["ts", "js", "python", "bash", "json", "html", "css", "go", "rust", "sql"] },
        { "name": "file", "label": "File name", "type": "text", "default": "demo.ts" },
        { "name": "cps", "label": "Characters a second", "type": "number", "default": 34, "min": 5, "max": 200 },
        { "name": "background", "label": "Own background", "type": "bool", "default": true },
        { "name": "sounds", "label": "Sounds", "type": "bool", "default": true }
      ]
    </script>
    <style>
```

In the same file, replace:

```html
      const cps = Number(params.cps) || 34;
      const start = 0.55;
      const done = typedUntil(code, { start, cps });
      const scroll = document.getElementById('scroll');
      const view = document.getElementById('view');
      const win = document.getElementById('window');
```

with:

```html
      const cps = Number(params.cps) || 34;
      const start = 0.55;
      const done = typedUntil(code, { start, cps });
      // the keys: a burst every 0.6 s while it types
      if (params.sounds !== false) for (let key = start; key < done - 0.1; key += 0.6) cuttle.sound('type-burst', { at: key, volume: 0.8 });
      const scroll = document.getElementById('scroll');
      const view = document.getElementById('view');
      const win = document.getElementById('window');
```

- [ ] **Step 4: What `motion templates` says**

In `packages/motion-kit/src/index.ts`, replace:

```ts
}

export const MOTION_TEMPLATES: readonly MotionTemplate[] = [
  { name: 'title', kind: 'scene', duration: 3.5, description: 'a kinetic title: the words rise out of a blur, an accent line draws under them' },
  { name: 'end-card', kind: 'scene', duration: 4, description: 'the end card: a logo or monogram, a line, the URL in a pill that types itself, a call to action' },
  { name: 'code-typing', kind: 'scene', duration: 6, description: 'a code editor that types a file with syntax colours, line by line' },
  { name: 'lower-third', kind: 'overlay', duration: 4, description: 'a name and a role in a bar that wipes in and out' },
  { name: 'click-callouts', kind: 'overlay', duration: 0, whole: true, description: 'a ring and a number at every click the video shows, on the click' },
  { name: 'kinetic-captions', kind: 'overlay', duration: 0, whole: true, description: 'the spoken words, word by word, the current one in the accent colour' },
];
```

with:

```ts
}

export const MOTION_TEMPLATES: readonly MotionTemplate[] = [
  { name: 'title', kind: 'scene', duration: 3.5, description: 'a kinetic title: the words rise out of a blur with a whoosh, an accent line draws under them' },
  { name: 'end-card', kind: 'scene', duration: 4, description: 'the end card: a logo or monogram that lands with a hit, a line, the URL in a pill that types itself (keys, a ding), a call to action' },
  { name: 'code-typing', kind: 'scene', duration: 6, description: 'a code editor that types a file with syntax colours, line by line, keys clattering' },
  { name: 'lower-third', kind: 'overlay', duration: 4, description: 'a name and a role in a bar that wipes in (a swoosh) and out' },
  { name: 'click-callouts', kind: 'overlay', duration: 0, whole: true, description: 'a ring, a number and a pop at every click the video shows, on the click' },
  { name: 'kinetic-captions', kind: 'overlay', duration: 0, whole: true, description: 'the spoken words, word by word, the current one in the accent colour' },
];
```

- [ ] **Step 5: Run the test**

Run: `pnpm exec vitest run --project node packages/motion-kit/test/kit.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/motion-kit
git commit -m "kit: the motion templates make their sounds (a whoosh, a hit, keys, a ding, a swoosh, a pop on each click), behind a sounds param

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The editor plays and shows them

**Files:**
- Modify: `apps/desktop/src/main/sound-service.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/renderer/editor/session.ts`, `apps/desktop/src/renderer/editor/Timeline.tsx`, `apps/desktop/src/renderer/editor/editor.css`

- [ ] **Step 1: The service gathers them**

In `apps/desktop/src/main/sound-service.ts`, replace:

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
```

with:

```ts
// An editor's music and sounds: the soundtrack the export would mix (the music page Claude wrote,
// rendered as long as the video, the project's sounds and those its motion pages ask for), rendered
// again a moment after each edit and each change to their files, so the editor plays what the export makes.
import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { motionPages, motionSoundCues, motionTake, planSoundtrack, renderSoundtrack, type MusicStems, type PageSoundCache } from '@cuttle/export';
import { declaredParams } from '@cuttle/export/motion-params';
import { MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import { copyTemplate } from '@cuttle/motion-kit/files';
```

In the same file, replace:

```ts
  private again = false;
  /** Changes to the music's files and Reloads: part of what a render is kept by. */
  private changes = 0;
  private current: { key: string; stems: MusicStems; speech: { start: number; end: number }[] } | undefined;
  private status: SoundStatusView = { state: 'none', errors: [], console: [], skipped: [] };
  private watcher: FSWatcher | undefined;
```

with:

```ts
  private again = false;
  /** Changes to the music's files and Reloads: part of what a render is kept by. */
  private changes = 0;
  /** What each motion page asked for (`cuttle.sound`), until a file in `motion/` changes. */
  private readonly pageSounds: PageSoundCache = new Map();
  private pageChanges = 0;
  private current: { key: string; stems: MusicStems; speech: { start: number; end: number }[] } | undefined;
  private status: SoundStatusView = { state: 'none', errors: [], console: [], skipped: [] };
  private watcher: FSWatcher | undefined;
```

In the same file, replace:

```ts
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
```

with:

```ts
      const parsed = parseProject(shown.raw);
      if (!parsed.ok) return;
      const project = parsed.project;
      const take = await motionTake(this.dir, project);
      // a page that is missing shows in the motion preview; the others' sounds play
      const pages = await motionPages(this.dir, project).catch(() => undefined);
      const asked = await motionSoundCues(project, pages, take, { cache: this.pageSounds, changes: this.pageChanges });
      // where they play, for the Sound lane
      const pageSounds = asked.items.flatMap((item) => item.cues.map((cue) => ({ at: cue.at, sound: cue.sound, item: item.name })));
      const plan = await planSoundtrack(this.dir, project, take, asked.cues).catch((error: Error) => {
        this.setStatus({ state: 'failed', version: shown.version, failure: error.message, errors: [], console: [], skipped: [] });
        return null;
      });
      if (plan === null) return;
      plan?.skipped.push(...asked.errors);
      // watched also while nothing plays: a page that starts to ask for sounds is heard at once
      if (plan || pages) this.watchFiles();
      if (!plan) {
        this.current = undefined;
        this.setStatus({ state: 'none', version: shown.version, errors: [], console: [], skipped: asked.errors });
        return;
      }
      const key = createHash('sha256').update(JSON.stringify({ plan, changes: this.changes })).digest('hex').slice(0, 24);
      if (this.current?.key === key) {
        this.setStatus({ ...this.status, version: shown.version, pageSounds });
        return;
      }
      this.setStatus({ ...this.status, state: 'rendering', version: shown.version, pageSounds });
      try {
        const stems = await renderSoundtrack(this.dir, plan);
        if (this.disposed) return;
```

In the same file, replace:

```ts
          errors: report.errors,
          console: report.console,
          skipped: result.skipped,
        });
      } catch (error) {
        this.setStatus({ state: 'failed', version: shown.version, failure: (error as Error).message, errors: [], console: [], skipped: [] });
      }
    } finally {
      this.running = false;
```

with:

```ts
          errors: report.errors,
          console: report.console,
          skipped: result.skipped,
          pageSounds,
        });
      } catch (error) {
        this.setStatus({ state: 'failed', version: shown.version, failure: (error as Error).message, errors: [], console: [], skipped: [], pageSounds });
      }
    } finally {
      this.running = false;
```

In the same file, replace:

```ts
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
```

with:

```ts
    this.schedule();
  }

  /** Watches the project's folder for changes to the music's pages, the sounds' files and the motion pages. */
  private watchFiles(): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.dir, { recursive: true }, (_event, name) => {
        if (!name) return;
        const top = name.split(/[\\/]/)[0];
        if (top === 'motion') {
          // a page may now ask for other sounds: asked again, and the music rendered only if they changed
          this.pageChanges++;
          this.pageSounds.clear();
        } else if (top === 'music' || top === 'sounds') this.changes++;
        else return;
        this.schedule();
      });
      this.watcher.on('error', () => {
```

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
  console: string[];
  /** Sounds that could not play. */
  skipped: string[];
}

/** A rendered soundtrack: each stem interleaved stereo float at `rate`, the music's peaks for its lane, the speech it goes down for. */
```

with:

```ts
  console: string[];
  /** Sounds that could not play. */
  skipped: string[];
  /** The sounds the motion pages asked for (`cuttle.sound`), in output seconds, with the item's name. */
  pageSounds?: PageSoundView[];
}

export interface PageSoundView {
  at: number;
  sound: string;
  item: string;
}

/** A rendered soundtrack: each stem interleaved stereo float at `rate`, the music's peaks for its lane, the speech it goes down for. */
```

The editor sends a project with motion items too (any of them may ask):

In `apps/desktop/src/renderer/editor/session.ts`, replace:

```ts
  return (project[LISTS[selection.kind]] as { id?: string }[]).some((item) => item.id === selection.id);
}

/** Whether a project has music or sounds (to render, or to stop rendering once it has none). */
const hasSound = (project: CuttleProject) => project.music !== undefined || project.sounds.length > 0;

/** The document's project goes to the main process at each edit: it renders its music and sounds a moment later. */
function followSound(): void {
```

with:

```ts
  return (project[LISTS[selection.kind]] as { id?: string }[]).some((item) => item.id === selection.id);
}

/**
 * Whether a project may have music or sounds (to render, or to stop rendering once it has none): its
 * own, or ones its motion pages ask for.
 */
const hasSound = (project: CuttleProject) =>
  project.music !== undefined || project.sounds.length > 0 || project.overlays.length > 0 || project.scenes.some((scene) => scene.type === 'motion');

/** The document's project goes to the main process at each edit: it renders its music and sounds a moment later. */
function followSound(): void {
```

- [ ] **Step 2: Diamonds on the Sound lane**

In `apps/desktop/src/renderer/editor/Timeline.tsx`, replace:

```tsx
  groupPins,
  pinGroupDetail,
  pinGroupName,
  timelineModel,
  waveformColumns,
  type OverlayBlock,
```

with:

```tsx
  groupPins,
  pinGroupDetail,
  pinGroupName,
  soundName,
  timelineModel,
  waveformColumns,
  type OverlayBlock,
```

In the same file, replace:

```tsx
  const pps = useStore(store, (state) => state.pxPerSecond);
  const selection = useStore(store, (state) => state.selection);
  const motionStatus = useStore(store, (state) => state.motionStatus);
  const snapOn = useStore(store, (state) => state.snap);
  const peaksState = useStore(store, (state) => state.mediaState.peaks.state);
  const peaksPath = useStore(store, (state) => state.mediaState.peaks.path);
```

with:

```tsx
  const pps = useStore(store, (state) => state.pxPerSecond);
  const selection = useStore(store, (state) => state.selection);
  const motionStatus = useStore(store, (state) => state.motionStatus);
  const pageSounds = useStore(store, (state) => state.soundStatus.pageSounds);
  const snapOn = useStore(store, (state) => state.snap);
  const peaksState = useStore(store, (state) => state.mediaState.peaks.state);
  const peaksPath = useStore(store, (state) => state.mediaState.peaks.path);
```

In the same file, replace:

```tsx
                )}
                {LANES.map((lane) => (
                  <div key={lane.kind} className="tl-row" style={{ position: 'absolute', top: tops[lane.kind], height: heights[lane.kind], left: 0, right: 0 }}>
                    {model.lanes[lane.kind].blocks.length === 0 && model.lanes[lane.kind].cutOut === 0 && (
                      <span className="lane-hint" style={{ top: '50%', left: view.left + 10 }}>
                        <kbd>{LANE_HINTS[lane.kind][0]}</kbd> {LANE_HINTS[lane.kind][1]}
                      </span>
```

with:

```tsx
                )}
                {LANES.map((lane) => (
                  <div key={lane.kind} className="tl-row" style={{ position: 'absolute', top: tops[lane.kind], height: heights[lane.kind], left: 0, right: 0 }}>
                    {model.lanes[lane.kind].blocks.length === 0 && model.lanes[lane.kind].cutOut === 0 && !(lane.kind === 'sound' && pageSounds?.length) && (
                      <span className="lane-hint" style={{ top: '50%', left: view.left + 10 }}>
                        <kbd>{LANE_HINTS[lane.kind][0]}</kbd> {LANE_HINTS[lane.kind][1]}
                      </span>
```

In the same file, replace:

```tsx
                        </button>
                      );
                    })}
                  </div>
                ))}
                <MusicLane model={model} top={tops.music} height={heights.music} pps={pps} view={view} duration={duration} selected={isSelected(selection, 'music', 'music')} />
```

with:

```tsx
                        </button>
                      );
                    })}
                    {/* the sounds motion pages ask for: where they play, theirs to move */}
                    {lane.kind === 'sound' &&
                      pageSounds?.map((mark, index) => (
                        <i
                          key={`${mark.item}@${mark.at}#${index}`}
                          className="page-sound"
                          style={{ left: mark.at * pps }}
                          title={`${soundName(mark.sound)} at ${formatTime(mark.at)}: ${mark.item} asks for it (its page moves it)`}
                          data-testid="page-sound"
                        />
                      ))}
                  </div>
                ))}
                <MusicLane model={model} top={tops.music} height={heights.music} pps={pps} view={view} duration={duration} selected={isSelected(selection, 'music', 'music')} />
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```css
  color: var(--sound);
  padding: 0 4px;
}
/* the music: one block over the video, its waveform and its parts */
.item.music {
  height: auto;
```

with:

```css
  color: var(--sound);
  padding: 0 4px;
}
/* a sound a motion page asks for: a diamond where it plays (the page moves it, not a drag) */
.page-sound {
  position: absolute;
  top: 50%;
  width: 7px;
  height: 7px;
  margin: -4px 0 0 -4px;
  transform: rotate(45deg);
  border: 1.5px solid var(--sound);
  background: rgba(181, 224, 90, 0.25);
}
/* the music: one block over the video, its waveform and its parts */
.item.music {
  height: auto;
```

- [ ] **Step 3: The typecheck**

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src
git commit -m "app: the editor plays the sounds motion pages ask for, and shows them on the Sound lane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The checks and the guides

**Files:**
- Modify: `apps/cli/test/electron.check.test.ts`, `apps/desktop/test/app.check.test.ts`, `skill/cuttle/motion.md`, `skill/cuttle/music.md`, `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`

- [ ] **Step 1: The CLI's check**

A video of the title and the end card has the templates' sounds as its sound, without music, measured by `music check`; their `sounds` param switches them off:

In `apps/cli/test/electron.check.test.ts`, replace:

```ts
      expect(json).toMatchObject({ frames: 225, seconds: 7.5 });
      expect((json.motion as { errors: string[] }[]).flatMap((report) => report.errors)).toEqual([]);
      expect(probe(json.out as string).split(/\r?\n/)[0]).toBe('h264,1920,1080');
      // the title is on screen at 1.5 s: its light letters over its dark background, in the middle
      const still = cuttle('-C', reel, 'preview', '--at', '1.5', '-o', join(reel, 'still'));
      const png = PNG.sync.read(readFileSync((still.json.stills as { file: string }[])[0]!.file));
```

with:

```ts
      expect(json).toMatchObject({ frames: 225, seconds: 7.5 });
      expect((json.motion as { errors: string[] }[]).flatMap((report) => report.errors)).toEqual([]);
      expect(probe(json.out as string).split(/\r?\n/)[0]).toBe('h264,1920,1080');
      // the templates' own sounds (a whoosh with the title; a hit, keys and a ding on the end card)
      // are the video's sound, without music
      expect(json.music).toMatchObject({ errors: [], skipped: [] });
      expect(json.music).not.toHaveProperty('src');
      const audio = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name,channels', '-of', 'csv=p=0', json.out as string], { encoding: 'utf8' }).stdout.trim();
      expect(audio).toBe('aac,2');
      const checked = cuttle('-C', reel, 'music', 'check');
      expect(checked.code).toBe(0);
      const parts = (checked.json as { parts: { name: string; effectsDb: number }[] }).parts;
      expect(parts.map((part) => part.name)).toEqual(['Title', 'End card']);
      for (const part of parts) expect(part.effectsDb, part.name).toBeGreaterThan(-50);
      // their sounds param switches them off
      const config = join(reel, 'cuttle.json');
      const raw = JSON.parse(readFileSync(config, 'utf8')) as { scenes: { params?: Record<string, unknown> }[] };
      writeFileSync(config, JSON.stringify({ ...raw, scenes: raw.scenes.map((scene) => ({ ...scene, params: { ...scene.params, sounds: false } })) }));
      expect(cuttle('-C', reel, 'music', 'check').code).toBe(1);
      // the title is on screen at 1.5 s: its light letters over its dark background, in the middle
      const still = cuttle('-C', reel, 'preview', '--at', '1.5', '-o', join(reel, 'still'));
      const png = PNG.sync.read(readFileSync((still.json.stills as { file: string }[])[0]!.file));
```

Run: `pnpm cli:check`
Expected: PASS, 12 tests.

- [ ] **Step 2: The editor's check**

"+ Motion" → Title: the whoosh its page asks for on the Sound lane, and the soundtrack rendered:

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    await expect.poll(async () => (await now()).t).toBe(1);
    // its block on the timeline shows frames of its page
    await page.waitForSelector('.scene.motion .thumbs i', { timeout: 30_000 });

    // the editor draws the scenes and the overlay as the export does (`cuttle preview`), pixel for pixel
    await flushPage();
```

with:

```ts
    await expect.poll(async () => (await now()).t).toBe(1);
    // its block on the timeline shows frames of its page
    await page.waitForSelector('.scene.motion .thumbs i', { timeout: 30_000 });
    // the whoosh its page asks for, on the Sound lane where it plays (0.45 s into it), and rendered
    type PageSounds = { sound: { status: { state: string; pageSounds?: { sound: string; at: number; item: string }[] } } };
    const sound = async () => ((await now()) as unknown as PageSounds).sound.status;
    await expect.poll(async () => (await sound()).pageSounds, { timeout: 60_000 }).toEqual([{ sound: 'whoosh', at: 1.45, item: 'Title' }]);
    await page.waitForSelector('[data-testid=page-sound]');
    await expect.poll(async () => (await sound()).state, { timeout: 90_000 }).toBe('ready');

    // the editor draws the scenes and the overlay as the export does (`cuttle preview`), pixel for pixel
    await flushPage();
```

Run: `pnpm app:check`
Expected: PASS, 50 tests.

- [ ] **Step 3: The guides**

In `skill/cuttle/motion.md`, replace:

```markdown
   to it (or shared, `motion/shared.js`, imported as `../shared.js`). Or start from a template:
   `cuttle -C "<project>" --json motion new <template>` (title, end-card, code-typing, lower-third,
   click-callouts, kinetic-captions; `cuttle --json motion templates` says what each shows); it
   copies the page and adds it to cuttle.json. Then change the copy as much as you like.
2. Add it (project.md has the fields): a scene,
   `{ "type": "motion", "id": "s9", "label": "Intro", "src": "motion/intro/index.html", "duration": 3 }`,
   or an overlay over the clips, `{ "id": "o1", "src": "motion/callouts/index.html", "at": 4, "duration": 20 }`.
```

with:

```markdown
   to it (or shared, `motion/shared.js`, imported as `../shared.js`). Or start from a template:
   `cuttle -C "<project>" --json motion new <template>` (title, end-card, code-typing, lower-third,
   click-callouts, kinetic-captions; `cuttle --json motion templates` says what each shows); it
   copies the page and adds it to cuttle.json. Then change the copy as much as you like. Most
   templates make their sounds (a whoosh with the title, a pop on each callout, keys while code
   types); their `sounds` param switches them off.
2. Add it (project.md has the fields): a scene,
   `{ "type": "motion", "id": "s9", "label": "Intro", "src": "motion/intro/index.html", "duration": 3 }`,
   or an overlay over the clips, `{ "id": "o1", "src": "motion/callouts/index.html", "at": 4, "duration": 20 }`.
```

In the same file, replace:

```markdown
  typing with a rhythm, syntax colours and springs, all as functions of time.
- **`window.cuttle`:** `time` and `duration` (the item's seconds), `videoTime` (the video's),
  `fps`, `size` (the output's pixels), `format` (`16:9`, `9:16`, `1:1`), `params`, `theme`,
  `ready(promise)` (the first frame waits for it: fonts, data, a model), and `take` (below).
- **Size:** the page is the output, one CSS pixel per pixel (1920×1080 for 16:9, 1080×1920 for
  9:16). Size things from the short side so one page works in every format:
  `--u: calc(100vmin / 1080)` and `font-size: calc(120 * var(--u))`. Canvases: `cuttle.size`.
```

with:

```markdown
  typing with a rhythm, syntax colours and springs, all as functions of time.
- **`window.cuttle`:** `time` and `duration` (the item's seconds), `videoTime` (the video's),
  `fps`, `size` (the output's pixels), `format` (`16:9`, `9:16`, `1:1`), `params`, `theme`,
  `ready(promise)` (the first frame waits for it: fonts, data, a model), `sound(…)` (below) and
  `take` (below).
- **Size:** the page is the output, one CSS pixel per pixel (1920×1080 for 16:9, 1080×1920 for
  9:16). Size things from the short side so one page works in every format:
  `--u: calc(100vmin / 1080)` and `font-size: calc(120 * var(--u))`. Canvases: `cuttle.size`.
```

In the same file, replace:

```markdown
  shows the video there. A page cannot see the video behind it (no `backdrop-filter` on it).
- **Only the project's files**, by relative paths, and the kit; no network unless the item has
  `"network": true`. Image params are paths in the project folder: use them as `/<path>`.
- **Silent:** pages make no sound (sounds come with Cuttle's sound items).

## The kit (no network needed)
```

with:

````markdown
  shows the video there. A page cannot see the video behind it (no `backdrop-filter` on it).
- **Only the project's files**, by relative paths, and the kit; no network unless the item has
  `"network": true`. Image params are paths in the project folder: use them as `/<path>`.
- **Sound by asking:** a page plays nothing itself (no `<audio>`, no WebAudio); it asks Cuttle for
  sounds, which play with the project's (see below).

## Sounds from the page

A page asks for its sounds where its motion happens, so they stay on it however the video is cut:

```js
cuttle.sound('whoosh', { at: 0.3 }); // 0.3 s into the item, at every showing of it
cuttle.sound('sounds/ding.wav', { at: 1.6, volume: 0.5 }); // a file of the project
for (const click of cuttle.take.clicks) {
  const shown = cuttle.take.toOutput(click.t);
  if (shown !== null) cuttle.sound('pop', { videoTime: shown, volume: 0.4 }); // a second of the video
}
```

- Names are the built-in sounds (`cuttle --json sound list`: whoosh, swoosh-in, riser, impact, pop,
  click, tick, ding, chime, success, type-burst, glitch …) or files of the project. `volume` is 0
  to 1 (`0.8`); without `at` or `videoTime`, the moment it is asked.
- Ask when the page loads (or before a `cuttle.ready` promise ends): Cuttle opens the page once,
  draws its first frame and reads what it asked for. A sound asked for later in `onFrame` is not
  heard. The same sound at the same moment counts once.
- They play under `look.audio.effectsVolume`, like the project's `sounds`, and not when
  `look.audio.effects` is off. `cuttle music check` renders them with the music; the editor plays
  them as you save the page.
- Time them to the motion: a whoosh peaks on its moment, a swoosh-in and a riser end on it, a pop or
  an impact starts on it. Two or three sounds an item are plenty; leave the quiet parts quiet.

## The kit (no network needed)
````

In `skill/cuttle/music.md`, replace:

```markdown
second: it plays wherever the video shows that moment) or `--scene s5 --at 0.2` (seconds into a
scene), `--volume 0.6`. A file of the project works too (`sounds/ding.wav`). `cuttle --json sound list`
lists the built-in sounds. `look.audio.effects` and `effectsVolume` switch and scale every sound.

## Music that feels composed
```

with:

```markdown
second: it plays wherever the video shows that moment) or `--scene s5 --at 0.2` (seconds into a
scene), `--volume 0.6`. A file of the project works too (`sounds/ding.wav`). `cuttle --json sound list`
lists the built-in sounds. `look.audio.effects` and `effectsVolume` switch and scale every sound.
A motion page asks for its own with `cuttle.sound('whoosh', { at: 0.3 })` ([motion.md](motion.md)),
so its sounds move with it; the templates do (their `sounds` param). `music check` and the export
play them with the music and the project's sounds, so a whoosh in the title and a hit in the music
on the same cut add up: leave one of them out.

## Music that feels composed
```

In `skill/cuttle/SKILL.md`, replace:

```markdown
  speech by itself; `music set --volume`, `--duck` and `--param` tune it. Ask the user before
  adding music to a video with a voice that should stand alone.
- **Sounds.** A sound at a moment, without the music: `cuttle -C "<project>" --json sound add whoosh --at 12.4`
  (source seconds) or `--scene s5 --at 0.2`; `sound list` has the built-in sounds.
- **End card.** A `card` scene at the end with the product name and URL, or a `motion` scene.

## 4. Render
```

with:

```markdown
  speech by itself; `music set --volume`, `--duck` and `--param` tune it. Ask the user before
  adding music to a video with a voice that should stand alone.
- **Sounds.** A sound at a moment, without the music: `cuttle -C "<project>" --json sound add whoosh --at 12.4`
  (source seconds) or `--scene s5 --at 0.2`; `sound list` has the built-in sounds. A motion page
  asks for its own with `cuttle.sound(…)` (motion.md); the templates come with theirs.
- **End card.** A `card` scene at the end with the product name and URL, or a `motion` scene.

## 4. Render
```

In `skill/cuttle/project.md`, replace:

```markdown
`sounds` are single sounds at moments: `sound` (a built-in sound, `cuttle sound list`, or a file of
the project: WAV, MP3, M4A, OGG, FLAC), `at` (source seconds: it plays wherever the video shows that
moment, and not where it is cut), or `scene` (a scene's id) with `at` seconds into that scene,
`volume` (`0.8`), `enabled` (`true`), and an `id` (`a1`) and `label`.

## Motion pages
```

with:

```markdown
`sounds` are single sounds at moments: `sound` (a built-in sound, `cuttle sound list`, or a file of
the project: WAV, MP3, M4A, OGG, FLAC), `at` (source seconds: it plays wherever the video shows that
moment, and not where it is cut), or `scene` (a scene's id) with `at` seconds into that scene,
`volume` (`0.8`), `enabled` (`true`), and an `id` (`a1`) and `label`. Motion pages add their own
sounds as they render (`cuttle.sound`, motion.md); those are not in `sounds`.

## Motion pages
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/test/electron.check.test.ts apps/desktop/test/app.check.test.ts skill/cuttle
git commit -m "check the templates' sounds in a video without music and in the editor; the guides tell Claude about cuttle.sound

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 839 passed and 68 skipped (where a speech model is found, its real transcription runs too: 840 and 67; off Windows and macOS the OCR tests are skipped too).

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

1. In a project, "+ Motion" → Title: a diamond on the Sound lane 0.45 s into it; play: the whoosh with the words.
2. Switch the title's Sounds param off: the diamond goes, the whoosh too.
3. Ask Claude for an end card from the template: a hit, keys and a ding as it plays.
4. A video with callouts over the clicks: a pop on each click.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **The first levels were off:** in `music check` of a reel the title's whoosh measured −46 dB and the code's keys −53 dB against −27 dB for the end card; the whoosh moved to its peak at 0.45 s at full level, the keys went up, and the end card's hit moved onto the cut (0.05 s), where `music check` now counts it as a hit.
- **The editor showed nothing of them:** a whoosh played with no chip to say where it came from; the Sound lane draws a diamond for each, named after its item.
- **A video of motion items alone was silent in the editor:** the editor sent its project to the soundtrack only when it had music or sounds of its own, so a title's whoosh never rendered there (the app check found it). It sends it with any motion item now. A page that cannot be read is named in the status also when nothing else plays.

**Flaky, and not this milestone's**
- **Recordings that did not start in time:** while the machine was busy, two runs of `app:check` lost one and two recording tests (the HUD showed no running take within 30 s). The same test failed on `main` (M1f) in a run at that time, and a third run of this milestone passed all 50, its per-test times matching `main`'s. Nothing here touches the recorder or the HUD.
- **The recorder's test take:** one run of `pnpm test` had the test backend's mic 3.7 s long for a 3 s take; the next two runs passed.

**Spec points that move**
- None. Next: **P5-M1d** (frames of the take in pages, transitions, the device-3d and fold templates).

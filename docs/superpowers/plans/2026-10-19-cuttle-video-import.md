# Cuttle: Import Video Files, Frame-Exact Video in Motion Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A video made of footage Cuttle did not record can be made in Cuttle alone.
- **`cuttle import <file>`:** a video made elsewhere (a phone, OBS, a download) becomes the project's take, as a recording does.
- **`cuttle.video(src)`:** a motion page draws a video of the project frame by frame, each frame once.
- **`frameAt` in the kit:** which image of a sequence shows at a moment, without the slips of a plain floor.

**Architecture:**
- **The import** (`packages/core/src/import.ts`, `importTake`):
  - ffmpeg turns the file's picture into `takes/<n>/screen.mp4` as the recorder writes one: 30 fps, H.264, BT.709 with its tags, a key frame every 2 s. The recorder gives its colour chain (`VIDEO_CHAIN`) and the next take folder (`allocateTake`).
  - The file's sound becomes `mic.m4a`. take.json gives picture and sound one start; events.jsonl and markers.json are written empty.
  - `useTake` points the project at the take, as `record` does; the previous cuttle.json stays as a backup.
- **The command** (`apps/cli/src/commands/import.ts`): `cuttle import <file> [--from <s>] [--to <s>] [--force]`. It refuses a project open in the Cuttle app (`project-open`), as `record` does.
- **`cuttle.video(src)`** (`packages/export/src/motion/runtime.ts`):
  - The take's frame reader becomes a factory, `frameReader`. Each video a page asks for gets a reader of its own: the kit's worker (`take-worker.js`), opened without masks and with the video's name for its errors.
  - The page's server already answers range requests for every file of the project, in the export and in the app's editor.
- **`frameAt(t, { start, fps, count })`** (`packages/motion-kit/kit/motion.js`): the floor of `(t - start) * fps` with an epsilon, kept between the first and the last frame.

**Tech Stack:** ffmpeg (libx264), mediabunny and WebCodecs in the kit's worker, commander, vitest (node, browser, and the CLI's Electron check).

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `video-import`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- ffmpeg and ffprobe must be on PATH. The checks never show a window and never capture this machine.
- The full `pnpm test` and the typecheck run in Task 4.

## Decisions made while planning

**Checked on the prototype before this plan was written**
- Each step's tests fail before its code, with the message the step names: Task 1 `Cannot find module '../src/import'`; Task 2 `frameAt is not a function` and `cuttle.video is not a function` (2 of 22 tests).
- `pnpm test` (996 passed, 82 skipped), the typecheck, the skill's tests and the CLI's new end-to-end check pass.
- The need came from a client's promo made of other people's footage: the frames had to be fetched and cut outside Cuttle and shown as a sequence of JPEGs, and a plain floor showed 30 of them twice.

**The import**
- **Written as a recording:** 30 fps, BT.709 with its tags, a key frame every 2 s. The editor, `suggest` (it decodes the key frames for its bands), the export and the kit's worker then read it as they read any take.
  - The preset is `veryfast`, not the recorder's `ultrafast`: an import need not keep up with a screen. CRF 18, as the recorder's.
  - The size is kept, made even (yuv420p), at most 3840 px on the long side; a larger picture is scaled down to it.
- **Its length counts its frames:** the take's `seconds` is the frame count ÷ 30.
  - ffmpeg's progress time, which `streamSeconds` reads, stops at the start of the last frame or before it. For a 1.2 s file it said 1.13 s, and the clip over the take lost its last two frames.
  - The same reading also ended an import without `--to` early, until the end-to-end check showed it. An import now runs to the file's end unless `--to` ends before it.
- **No input, no markers:** events.jsonl and markers.json are written empty, so every reader of a take accepts the take. `suggest` cuts it by its picture and sound alone; a CLI test cuts its still middle.
- **Nothing half-made:** a failed conversion removes the take's folder. The project is read (or made) before anything is converted, so a broken cuttle.json stops the import first.
- **Not into a project open in the app** (like `record`): the app would keep showing its take and save over the new one. `--force` imports anyway.

**The video in a page**
- **A reader per video:** each video gets its own worker, so each keeps its own place in its file; frames read forward fastest.
- **Exact:** the worker gives the frame shown at the second asked (the last one starting by then, within a microsecond), whatever the page's frame rate.
  - The end-to-end check renders a video whose frame n is red 20 + 6n, drawn by a page, and finds each frame once, none skipped. It checks the imported take's clip in the same video the same way.
  - The check's video is BT.709 and tagged. An untagged BT.601 video turns into other reds in Chromium than in ffmpeg (0 0 5 13 against 1 7 14 21), which first looked like a frame of lag.
- **`frameAt`:** `Math.floor((t - start) * fps)` lands just below a whole number now and then: 38/30 s from 1.2 s gives 1.9999999999999996. In a client's video that showed 30 of its 198 frames twice and skipped as many. The epsilon is 10⁻⁶ of a frame.

## File structure

| File | Responsibility |
|---|---|
| `packages/recorder/src/record.ts`, `args.ts`, `index.ts` | the next take folder and the colour chain, for the import |
| `packages/core/src/import.ts`, `index.ts` | `importTake` |
| `apps/cli/src/commands/import.ts`, `apps/cli/src/main.ts` | `cuttle import` |
| `packages/motion-kit/kit/motion.js`, `motion.d.ts` | `frameAt` |
| `packages/export/src/motion/runtime.ts`, `packages/motion-kit/kit/take-worker.js` | `cuttle.video`, a reader per video |
| `skill/cuttle/SKILL.md`, `motion.md`, `project.md`, `README.md` | the docs |

---

### Task 1: Import a video as a take

**Files:**
- Create: `packages/core/src/import.ts`, `packages/core/test/import.test.ts`, `apps/cli/src/commands/import.ts`
- Modify: `packages/recorder/src/record.ts`, `packages/recorder/src/args.ts`, `packages/recorder/src/index.ts`, `packages/core/src/index.ts`, `apps/cli/src/main.ts`
- Test: `apps/cli/test/cli.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `video-import`; work there:

```bash
git switch video-import
```

- [ ] **Step 2: Write the failing test**

`packages/core/test/import.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseMarkersJson, parseTakeJson } from '@cuttle/project';
import { importTake } from '../src/import';
import { runFfmpeg } from '../src/ffmpeg';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-import-'));
  dirs.push(dir);
  return dir;
};

/** A video as a phone or another tool makes one: 25 fps, BT.601 (ffmpeg's default), with a tone unless `sound` is false. */
const source = (file: string, seconds: number, { size = '640x360', sound = true } = {}) =>
  runFfmpeg([
    '-f', 'lavfi', '-i', `testsrc2=s=${size}:r=25:d=${seconds}`,
    ...(sound ? ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${seconds}`, '-c:a', 'aac'] : []),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', file,
  ]);

/** The first video stream of `file` and the times of its key frames, as ffprobe reads them. */
function probe(file: string) {
  const run = (args: string[]) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-of', 'json', ...args, file], { encoding: 'utf8' }).stdout);
  const stream = run(['-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,color_space,color_primaries,color_transfer,color_range']).streams[0];
  const keys = run(['-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time']).frames.map((frame: { pts_time: string }) => Number(frame.pts_time));
  return { ...stream, keys };
}

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

describe('importTake', () => {
  it('imports a video as the next take, as the recorder writes one (30 fps, BT.709, a key frame every 2 s), its sound as the mic, and the project uses it', async () => {
    const project = temp();
    const file = join(temp(), 'phone.mp4');
    await source(file, 4.4);

    const result = await importTake(project, file);
    // 4.4 s (110 frames at 25 fps): 132 frames at 30 fps, to the end of the last one
    expect(result).toMatchObject({ take: 'takes/1', file, seconds: 4.4, width: 640, height: 360, tracks: ['screen', 'mic'] });
    expect(result.backup).toBeUndefined();
    const take = join(project, 'takes', '1');
    expect(probe(join(take, 'screen.mp4'))).toEqual({
      width: 640,
      height: 360,
      r_frame_rate: '30/1',
      color_space: 'bt709',
      color_primaries: 'bt709',
      color_transfer: 'bt709',
      color_range: 'tv',
      keys: [0, 2, 4],
    });
    // picture and sound start together; no input and no markers, but files the take's readers accept
    const parsed = parseTakeJson(readFileSync(join(take, 'take.json'), 'utf8'));
    expect(parsed.ok && parsed.take.tracks).toEqual({ screen: { file: 'screen.mp4', start: expect.any(Number) }, mic: { file: 'mic.m4a', start: parsed.ok ? parsed.take.tracks.screen.start : 0 } });
    expect(readFileSync(join(take, 'events.jsonl'), 'utf8')).toBe('');
    expect(parseMarkersJson(readFileSync(join(take, 'markers.json'), 'utf8')).ok).toBe(true);
    // the project was made, and is one clip over the take
    const written = json(join(project, 'cuttle.json'));
    expect(written.sources).toEqual({ screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a', events: 'takes/1/events.jsonl', markers: 'takes/1/markers.json' });
    expect(written.scenes).toEqual([{ type: 'clip', from: 0, to: Math.floor(result.seconds * 1000) / 1000 }]);
  }, 60_000);

  it('takes a stretch of the file as the next take; the edit of the previous one stays in the backup', async () => {
    const project = temp();
    const file = join(temp(), 'long.mov');
    await source(file, 5);
    await importTake(project, file);

    const result = await importTake(project, file, { from: 1, to: 3.5 });
    expect(result.take).toBe('takes/2');
    expect(result.seconds).toBeCloseTo(2.5, 1);
    expect(result.backup).toBeDefined();
    expect(json(result.backup!).sources.screen).toBe('takes/1/screen.mp4');
    expect(json(join(project, 'cuttle.json')).sources.screen).toBe('takes/2/screen.mp4');
    // a stretch to past the end ends at the end: the file's last frame, at 30 fps (a frame or two short of 1 s)
    for (const to of [undefined, 99]) {
      const seconds = (await importTake(project, file, { from: 4, ...(to !== undefined && { to }) })).seconds;
      expect(seconds).toBeGreaterThan(0.9);
      expect(seconds).toBeLessThanOrEqual(1);
    }
  }, 60_000);

  it('scales a picture larger than 4K down to it, and a video without sound has no mic', async () => {
    const project = temp();
    const file = join(temp(), 'wide.mp4');
    await source(file, 1, { size: '4000x2000', sound: false });

    const result = await importTake(project, file);
    expect(result).toMatchObject({ width: 3840, height: 1920, tracks: ['screen'] });
    expect(existsSync(join(project, 'takes', '1', 'mic.m4a'))).toBe(false);
    expect(json(join(project, 'cuttle.json')).sources.mic).toBeUndefined();
  }, 60_000);

  it('refuses a missing file, a file without video and a start past the end, and leaves no take behind', async () => {
    const project = temp();
    const sound = join(temp(), 'tone.m4a');
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', '-y', sound]);
    const file = join(temp(), 'short.mp4');
    await source(file, 2);

    await expect(importTake(project, join(project, 'nothing.mp4'))).rejects.toMatchObject({ code: 'missing-file' });
    await expect(importTake(project, sound)).rejects.toMatchObject({ code: 'invalid-media', message: expect.stringContaining('has no video') });
    await expect(importTake(project, file, { from: 5 })).rejects.toMatchObject({ code: 'usage', message: expect.stringContaining('past the end') });
    await expect(importTake(project, file, { from: 1, to: 1 })).rejects.toMatchObject({ code: 'usage' });
    expect(existsSync(join(project, 'takes')) ? readdirSync(join(project, 'takes')) : []).toEqual([]);
  }, 60_000);
});
```

Run: `pnpm exec vitest run --project node packages/core/test/import.test.ts`
Expected: FAIL: `../src/import` does not exist.

- [ ] **Step 3: The recorder's take folder and colour chain, for the import**

In `packages/recorder/src/record.ts`, replace:

```ts
}

/** Creates the next free `takes/<n>` folder; `mkdir` fails on an existing one, so two recorders never share one. */
function allocateTake(projectDir: string): string {
  const takes = join(projectDir, 'takes');
  mkdirSync(takes, { recursive: true });
  let next = readdirSync(takes).reduce((max, name) => (/^\d+$/.test(name) ? Math.max(max, Number(name)) : max), 0) + 1;
```

with:

```ts
}

/** Creates the next free `takes/<n>` folder; `mkdir` fails on an existing one, so two recorders never share one. */
export function allocateTake(projectDir: string): string {
  const takes = join(projectDir, 'takes');
  mkdirSync(takes, { recursive: true });
  let next = readdirSync(takes).reduce((max, name) => (/^\d+$/.test(name) ? Math.max(max, Number(name)) : max), 0) + 1;
```

In `packages/recorder/src/args.ts`, replace:

```ts
 * BT.601 by default). `setparams` replaces the sRGB transfer that ddagrab frames carry, which the
 * encoder flags alone do not override.
 */
const VIDEO_CHAIN =
  'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';

/** H.264 at high quality; a key frame every 2 s, so a fragment (one GOP) loses at most 2 s in a crash. */
```

with:

```ts
 * BT.601 by default). `setparams` replaces the sRGB transfer that ddagrab frames carry, which the
 * encoder flags alone do not override.
 */
export const VIDEO_CHAIN =
  'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';

/** H.264 at high quality; a key frame every 2 s, so a fragment (one GOP) loses at most 2 s in a crash. */
```

In `packages/recorder/src/index.ts`, replace:

```ts
export { record, CLAUDE_BACKGROUND_SECONDS, CLAUDE_TAIL_SECONDS } from './record';
export { joinSegments } from './join';
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
```

with:

```ts
export { record, allocateTake, CLAUDE_BACKGROUND_SECONDS, CLAUDE_TAIL_SECONDS } from './record';
export { VIDEO_CHAIN } from './args';
export { joinSegments } from './join';
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
```

- [ ] **Step 4: `importTake`**

`packages/core/src/import.ts`:

```ts
// A video made elsewhere (a phone, OBS, a download) as a take of the project: its picture becomes a
// screen track as the recorder writes one (30 fps, H.264, BT.709, a key frame every 2 s) and its
// sound the mic track, so suggest, zooms, masks, the look and the export work on it as on a recording.
// It has no input events and no markers: suggest cuts it by what the picture and the sound do.
import { existsSync, statSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, type TakeFile } from '@cuttle/project';
import { allocateTake, VIDEO_CHAIN } from '@cuttle/recorder';
import { CoreError } from './errors';
import { runFfmpeg } from './ffmpeg';
import { newProjectFile, projectExists, readProjectFile, writeProjectFile } from './project-file';
import { parseAnalysis, streamSeconds } from './suggest/media';
import { useTake } from './use-take';

/** The screen track's frame rate, as the recorder's; and its longest side, larger pictures are scaled down to it. */
export const IMPORT_RULES = { fps: 30, maxSide: 3840 };

/** The recorder's H.264 (recorder/args.ts), at a slower preset: an import need not keep up with a screen. */
const VIDEO_CODEC = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
  '-force_key_frames', 'expr:gte(t,n_forced*2)',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
];

export interface ImportOptions {
  /** The second of the file to start at (default 0). */
  from?: number;
  /** The second of the file to end at (default its end). */
  to?: number;
}

export interface ImportResult {
  project: string;
  /** The take folder, relative to the project. */
  take: string;
  /** The file imported, as given. */
  file: string;
  seconds: number;
  width: number;
  height: number;
  tracks: string[];
  /** The previous cuttle.json, when the take replaced scenes or overlays. */
  backup?: string;
}

/**
 * Imports `file` (a video, read relative to the current folder) as the next take of the project (made
 * when missing) and points the project at it, as a recording does: one clip over the whole take, and
 * the previous take's edits kept in the backup. `from` and `to` take a stretch of the file.
 */
export async function importTake(projectDir: string, file: string, options: ImportOptions = {}): Promise<ImportResult> {
  const path = resolve(file);
  if (!existsSync(path) || !statSync(path).isFile()) throw new CoreError('missing-file', `${file} does not exist`, { path });
  // about its length: ffmpeg's progress time stops at its last frame's start, or a little before
  const length = await streamSeconds(path, 'v');
  if (length <= 0) throw new CoreError('invalid-media', `${file} has no video that ffmpeg can read`, { path });
  const from = options.from ?? 0;
  if (!(Number.isFinite(from) && from >= 0)) throw new CoreError('usage', 'from must be a second of the file, 0 or more');
  if (from >= length) throw new CoreError('usage', `from (${from} s) is past the end of ${file} (${length.toFixed(1)} s)`);
  if (options.to !== undefined && !(Number.isFinite(options.to) && options.to > from)) throw new CoreError('usage', `to must come after from (${from} s)`);
  // to the end of the file, unless the stretch ends before it
  const to = options.to !== undefined && options.to < length ? options.to : undefined;
  // Read (or created) now, so a broken project stops the command before anything is converted.
  if (projectExists(projectDir)) await readProjectFile(projectDir);
  else await writeProjectFile(newProjectFile(projectDir), 'import');

  const project = resolve(projectDir);
  const dir = allocateTake(project);
  const rel = relative(project, dir).split(sep).join('/');
  const stretch = ['-ss', from.toFixed(3), ...(to === undefined ? [] : ['-t', (to - from).toFixed(3)]), '-i', path];
  const hasSound = (await streamSeconds(path, 'a')) > 0;
  try {
    // the picture: 30 fps, at most IMPORT_RULES.maxSide on its longest side, an even size (yuv420p), BT.709
    const max = IMPORT_RULES.maxSide;
    const size = `scale=w='min(iw,${max})':h='min(ih,${max})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
    await runFfmpeg([...stretch, '-map', '0:v:0', '-vf', `fps=${IMPORT_RULES.fps},${size},${VIDEO_CHAIN}`, ...VIDEO_CODEC, '-an', '-movflags', '+faststart', '-y', join(dir, 'screen.mp4')]);
    if (hasSound) await runFfmpeg([...stretch, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '160k', '-y', join(dir, 'mic.m4a')]);
    // Its length to the end of its last frame, from the frames it has (ffmpeg's progress time stops
    // before that frame ends): the clip over the take shows each of them.
    const { stderr } = await runFfmpeg(['-i', join(dir, 'screen.mp4'), '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
    const { width, height } = parseAnalysis(stderr);
    const seconds = Number([...stderr.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1] ?? 0) / IMPORT_RULES.fps;
    // Picture and sound start together: take.json gives them one start, on the clock of the import.
    const start = Date.now() / 1000;
    const take: TakeFile = {
      version: TAKE_VERSION,
      tracks: { screen: { file: 'screen.mp4', start }, ...(hasSound && { mic: { file: 'mic.m4a', start } }) },
    };
    await writeFile(join(dir, 'take.json'), `${JSON.stringify(take, null, 2)}\n`);
    await writeFile(join(dir, 'events.jsonl'), '');
    await writeFile(join(dir, 'markers.json'), `${JSON.stringify({ version: MARKERS_VERSION, markers: [] }, null, 2)}\n`);

    // Read again: the project may have changed while the file was converted; that version gets the take.
    const projectFile = await readProjectFile(projectDir);
    const hadEdit = useTake(projectFile, {
      screen: `${rel}/screen.mp4`,
      ...(hasSound && { mic: `${rel}/mic.m4a` }),
      events: `${rel}/events.jsonl`,
      markers: `${rel}/markers.json`,
      seconds,
    });
    const { backup } = await writeProjectFile(projectFile, 'import', { backup: hadEdit });
    return { project: projectFile.path, take: rel, file, seconds, width, height, tracks: hasSound ? ['screen', 'mic'] : ['screen'], ...(backup && { backup }) };
  } catch (error) {
    // nothing half-made stays: the next import or recording takes the number again
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
```

In `packages/core/src/index.ts`, replace:

```ts
// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, run ffmpeg, transcribe the mic (the speech models, whisper, live captions, the speech
// edits), keep brand kits, and read a product's colours and the desktop's wallpaper for a background.
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
```

with:

```ts
// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, import a video as a take, suggest scenes,
// recover a take, grab a frame, run ffmpeg, transcribe the mic (the speech models, whisper, live
// captions, the speech edits), keep brand kits, and read a product's colours and the desktop's
// wallpaper for a background.
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
```

In the same file, replace:

```ts
export { samePath, useTake, type TakeFiles } from './use-take';
export { suggestProject, type SuggestOptions, type SuggestResult } from './suggest';
export { recoverTake, type RecoverResult } from './recover';
export { GRID_STEP, grabFrame, gridFilter, type FrameOptions, type FrameResult } from './frame';
export { ANALYSIS_DIR, analyseScreen, cachedAnalysis, grabGray, parseAnalysis, probeScreen, streamSeconds, type Gray, type ScreenAnalysis } from './suggest/media';
export { applyLengthFit, withLengthFit, withoutLengthFit, type LengthApplied, type LengthFitResult, type LengthInput } from './suggest/length';
```

with:

```ts
export { samePath, useTake, type TakeFiles } from './use-take';
export { suggestProject, type SuggestOptions, type SuggestResult } from './suggest';
export { recoverTake, type RecoverResult } from './recover';
export { IMPORT_RULES, importTake, type ImportOptions, type ImportResult } from './import';
export { GRID_STEP, grabFrame, gridFilter, type FrameOptions, type FrameResult } from './frame';
export { ANALYSIS_DIR, analyseScreen, cachedAnalysis, grabGray, parseAnalysis, probeScreen, streamSeconds, type Gray, type ScreenAnalysis } from './suggest/media';
export { applyLengthFit, withLengthFit, withoutLengthFit, type LengthApplied, type LengthFitResult, type LengthInput } from './suggest/length';
```

Run: `pnpm exec vitest run --project node packages/core/test/import.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: `cuttle import`**

The command, with `suggest` on what it imported:

In `apps/cli/test/cli.test.ts`, replace:

```ts
    expect(existsSync(join(take, 'markers.json'))).toBe(false);
  }, 30_000);

  it('refuses a take outside the project and one without video', async () => {
    const dir = temp();
    const outside = await cli('--json', '-C', dir, 'recover', '..');
```

with:

```ts
    expect(existsSync(join(take, 'markers.json'))).toBe(false);
  }, 30_000);

  it('imports a video made elsewhere as the next take, which suggest cuts by its picture alone; not into a project open in the app', async () => {
    const dir = join(temp(), 'imported');
    const file = join(temp(), 'phone.mp4');
    // a moving picture, 5 s of a still one, a moving one again
    spawnSync('ffmpeg', ['-v', 'error', '-filter_complex', 'testsrc2=s=320x240:r=25:d=1.5[a];color=c=gray:s=320x240:r=25:d=5[b];testsrc2=s=320x240:r=25:d=1.5[c];[a][b][c]concat=n=3:v=1:a=0', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', file]);
    const imported = await cli('--json', '-C', dir, 'import', file, '--to', '7.5');
    expect(imported.code).toBe(0);
    expect(stable(imported.json, dir)).toMatchObject({ project: '<project>/cuttle.json', take: 'takes/1', width: 320, height: 240, tracks: ['screen'] });

    const suggested = await cli('--json', '-C', dir, 'suggest');
    expect(suggested.code).toBe(0);
    const scenes = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')).scenes as { from: number; to: number }[];
    // the still middle is cut, half a second kept on both sides
    expect(scenes.map((scene) => [Math.round(scene.from * 10) / 10, Math.round(scene.to * 10) / 10])).toEqual([[0, 2], [6, 7.5]]);

    mkdirSync(join(dir, '.cuttle'), { recursive: true });
    writeFileSync(join(dir, '.cuttle', 'editor.lock'), JSON.stringify({ host: hostname(), pid: process.pid }));
    const refused = await cli('--json', '-C', dir, 'import', file);
    expect(refused.json).toMatchObject({ error: { code: 'project-open' } });
    expect(existsSync(join(dir, 'takes', '2'))).toBe(false);
    const missing = await cli('--json', '-C', dir, 'import', join(dir, 'nothing.mp4'), '--force');
    expect(missing).toMatchObject({ code: 1, json: { error: { code: 'missing-file' } } });
  }, 60_000);

  it('refuses a take outside the project and one without video', async () => {
    const dir = temp();
    const outside = await cli('--json', '-C', dir, 'recover', '..');
```

`apps/cli/src/commands/import.ts`:

```ts
import { hostname } from 'node:os';
import { editorLockOf, importTake, type ImportResult } from '@cuttle/core';
import { CliError } from '../errors';
import type { Output } from '../output';

export interface ImportArgs {
  /** The second of the file to start at. */
  from?: number;
  /** The second of the file to end at. */
  to?: number;
  /** Import even when the project is open in the Cuttle app. */
  force?: boolean;
}

/** `cuttle import <file>`: a video made elsewhere as the project's next take, which it uses (see @cuttle/core's importTake). */
export async function importCommand(projectDir: string, file: string, args: ImportArgs, output: Output): Promise<ImportResult> {
  // The app would keep showing the take it has open, and save it over this one.
  const open = args.force ? undefined : await editorLockOf(projectDir);
  if (open) {
    const where = open.host === hostname() ? '' : ` on ${open.host}`;
    throw new CliError('project-open', `the project is open in the Cuttle app${where}: close it first (--force imports anyway)`);
  }
  output.info(`importing ${file} …`);
  const result = await importTake(projectDir, file, { ...(args.from !== undefined && { from: args.from }), ...(args.to !== undefined && { to: args.to }) });
  output.result(result, () =>
    [
      `imported ${result.file} as ${result.take}: ${result.seconds.toFixed(1)} s, ${result.width}×${result.height}, tracks: ${result.tracks.join(', ')}`,
      `${result.project} now uses this take${result.backup ? ` (previous version: ${result.backup})` : ''}`,
    ].join('\n'),
  );
  return result;
}
```

In `apps/cli/src/main.ts`, replace:

```ts
import { devices } from './commands/devices';
import { fitCommand } from './commands/fit';
import { frameCommand } from './commands/frame';
import { init } from './commands/init';
import { motionCheckCommand, motionNewCommand, motionTemplatesCommand } from './commands/motion';
import { musicCheckCommand, musicNewCommand, musicSetCommand, musicTemplatesCommand, soundAddCommand, soundListCommand } from './commands/music';
```

with:

```ts
import { devices } from './commands/devices';
import { fitCommand } from './commands/fit';
import { frameCommand } from './commands/frame';
import { importCommand, type ImportArgs } from './commands/import';
import { init } from './commands/init';
import { motionCheckCommand, motionNewCommand, motionTemplatesCommand } from './commands/motion';
import { musicCheckCommand, musicNewCommand, musicSetCommand, musicTemplatesCommand, soundAddCommand, soundListCommand } from './commands/music';
```

In the same file, replace:

```ts
      ),
    );

  program
    .command('suggest')
    .description("propose scenes (quiet start and end trimmed, idle cut, waiting sped up, cropped to the content), a zoom on the answer, zooms on dialogs, zooms that follow typing and zooms on clicks, and the script's steps' titles and zooms")
```

with:

```ts
      ),
    );

  program
    .command('import <file>')
    .description('a video made elsewhere (a phone, OBS, a download) as the next take, converted as a recording is (30 fps, BT.709), its sound as the mic; the project uses it')
    .option('--from <seconds>', 'start at this second of the file', seconds)
    .option('--to <seconds>', 'end at this second of the file', positive)
    .option('--force', 'import even when the project is open in the Cuttle app')
    .action(action((output, project, file: string, options: ImportArgs) => importCommand(project, file, options, output)));

  program
    .command('suggest')
    .description("propose scenes (quiet start and end trimmed, idle cut, waiting sped up, cropped to the content), a zoom on the answer, zooms on dialogs, zooms that follow typing and zooms on clicks, and the script's steps' titles and zooms")
```

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts -t "imports a video"`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add packages/recorder/src packages/core/src/import.ts packages/core/src/index.ts packages/core/test/import.test.ts apps/cli/src apps/cli/test/cli.test.ts
git commit -m "cuttle import: a video made elsewhere as the next take, written as a recording is

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Video frames in motion pages

**Files:**
- Modify: `packages/motion-kit/kit/motion.js`, `packages/motion-kit/kit/motion.d.ts`, `packages/motion-kit/kit/take-worker.js`, `packages/export/src/motion/runtime.ts`
- Test: `packages/motion-kit/test/motion.test.ts`, `packages/export/test/motion-runtime.browser.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/motion-kit/test/motion.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { alpha, at, bezier, ease, highlight, inOut, keys, mix, random, spring, stagger, typed, typedUntil } from '../kit/motion.js';

describe("Cuttle's motion helpers", () => {
  it('ease from 0 to 1, as CSS does', () => {
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { alpha, at, bezier, ease, frameAt, highlight, inOut, keys, mix, random, spring, stagger, typed, typedUntil } from '../kit/motion.js';

describe("Cuttle's motion helpers", () => {
  it('ease from 0 to 1, as CSS does', () => {
```

In the same file, replace:

```ts
    expect(stagger(0, 5, 1, 'end')).toBe(4);
  });

  it('give the same random numbers for the same seed', () => {
    const a = random(7);
    const b = random(7);
```

with:

```ts
    expect(stagger(0, 5, 1, 'end')).toBe(4);
  });

  it('say which frame of a sequence shows: each one once, from the first to the last', () => {
    // the video's frames n / 30 s, a sequence of 198 frames at 30 fps from 1.2 s
    const times = Array.from({ length: 300 }, (_, n) => n / 30);
    const shown = times.map((t) => frameAt(t, { start: 1.2, fps: 30, count: 198 }));
    expect(shown.slice(0, 37)).toEqual(Array(37).fill(0));
    expect(shown.slice(36, 234)).toEqual(Array.from({ length: 198 }, (_, k) => k));
    expect(shown.slice(233)).toEqual(Array(67).fill(197));
    // what the floor alone does there: a frame twice, the next one never
    const floored = times.slice(36, 234).map((t) => Math.floor((t - 1.2) * 30));
    expect(floored.filter((k, i) => k !== i).length).toBeGreaterThan(10);
    expect(frameAt(2.5)).toBe(75);
    expect(frameAt(1, { fps: 24 })).toBe(24);
  });

  it('give the same random numbers for the same seed', () => {
    const a = random(7);
    const b = random(7);
```

In `packages/export/test/motion-runtime.browser.test.ts`, replace:

```ts
    await expect(page('', '').cuttle.take.frame(1)).rejects.toThrow('no screen recording');
  });

  it('gives a transition page the frames it goes between before it draws, and how far it is', async () => {
    // two raw frames at the page's size: red and blue
    const raw = (rgb: number[]) => {
```

with:

```ts
    await expect(page('', '').cuttle.take.frame(1)).rejects.toThrow('no screen recording');
  });

  it('hands the page frames of a video of the project, from a reader of its own, without the take\'s masks', async () => {
    // a stand-in for the kit's worker: red a tenth of the second asked, green 100 for a.mp4 (200 for any other), blue its masks
    const worker = URL.createObjectURL(
      new Blob(
        [
          `let opened;
          self.onmessage = (event) => {
            const message = event.data;
            if (message.type === 'open') return void (opened = message);
            if (message.source > 5) return self.postMessage({ id: message.id, error: opened.name + ' has no frame at ' + message.source });
            const canvas = new OffscreenCanvas(message.width ?? 16, 4);
            const g = canvas.getContext('2d');
            g.fillStyle = 'rgb(' + Math.round(message.source * 10) + ', ' + (opened.url.endsWith('a.mp4') ? 100 : 200) + ', ' + opened.masks.length + ')';
            g.fillRect(0, 0, canvas.width, 4);
            const bitmap = canvas.transferToImageBitmap();
            self.postMessage({ id: message.id, bitmap }, [bitmap]);
          };`,
        ],
        { type: 'text/javascript' },
      ),
    );
    const take: TakeData = {
      screen: { width: 32, height: 18 },
      events: [],
      words: [],
      markers: [],
      zooms: [],
      masks: [{ from: 0, to: 9, rect: [0, 0, 4, 4], style: 'fill' }],
      clips: [],
      cursor: null,
      window: null,
      recording: 'cuttle-motion://project/takes/1/screen.mp4',
    };
    const win = page(
      '',
      `const a = cuttle.video('cuttle-motion://project/clips/a.mp4');
       const b = cuttle.video('cuttle-motion://project/clips/b.mp4');
       seen.push({ same: cuttle.video('cuttle-motion://project/clips/a.mp4') === a, src: a.src });
       const pixel = (bitmap) => { const g = new OffscreenCanvas(1, 1).getContext('2d'); g.drawImage(bitmap, 0, 0); return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
       cuttle.onFrame(async (t) => {
         const [first, second, recording] = await Promise.all([a.frame(t), b.frame(2 * t, { width: 8 }), cuttle.take.frame(t)]);
         seen.push({ t, a: pixel(first), b: [...pixel(second), second.width], take: pixel(recording) });
       });`,
      { ...INIT, take, takeWorker: worker },
    );
    expect(await win.__cuttleDraw(500)).toBe(1);
    expect(win.seen).toEqual([
      { same: true, src: 'cuttle-motion://project/clips/a.mp4' },
      { t: 0.5, a: [5, 100, 0], b: [10, 200, 0, 8], take: [5, 200, 1] },
    ]);
    // what a reader could not do, the page is told, with the video's name
    await expect(win.cuttle.video('cuttle-motion://project/clips/a.mp4').frame(6)).rejects.toThrow('cuttle-motion://project/clips/a.mp4 has no frame at 6');
    // without the kit's worker nothing is read
    await expect(page('', '').cuttle.video('clip.mp4').frame(1)).rejects.toThrow('the frames of clip.mp4 cannot be read here');
  });

  it('gives a transition page the frames it goes between before it draws, and how far it is', async () => {
    // two raw frames at the page's size: red and blue
    const raw = (rgb: number[]) => {
```

Run: `pnpm exec vitest run packages/motion-kit/test/motion.test.ts packages/export/test/motion-runtime.browser.test.ts`
Expected: FAIL: `frameAt is not a function`, and `cuttle.video is not a function`.

- [ ] **Step 2: `frameAt`**

In `packages/motion-kit/kit/motion.js`, replace:

```
  return Math.abs(index - origin) * each;
}

/** A seeded random number generator (mulberry32): `random(7)` gives the same numbers every time. */
export function random(seed) {
  let state = seed >>> 0;
```

with:

```
  return Math.abs(index - origin) * each;
}

/**
 * Which frame of a sequence shows at time `t`: `fps` frames a second from `start` seconds, kept
 * between the first and the last (`count`). `Math.floor((t - start) * fps)` alone lands just below a
 * whole number now and then (at 38 / 30 s from 1.2 s it is 1.9999999999999996), which shows one frame
 * twice and skips the next.
 */
export function frameAt(t, { start = 0, fps = 30, count = Infinity } = {}) {
  return clamp(Math.floor((t - start) * fps + 1e-6), 0, count - 1);
}

/** A seeded random number generator (mulberry32): `random(7)` gives the same numbers every time. */
export function random(seed) {
  let state = seed >>> 0;
```

In `packages/motion-kit/kit/motion.d.ts`, replace:

```ts
export function alpha(color: string, a: number): string;
export function keys<T extends KeyValue>(t: number, frames: [time: number, value: T, curve?: Curve][]): T;
export function stagger(index: number, count: number, each: number, from?: 'start' | 'end' | 'center' | number): number;
export function random(seed: number): () => number;
export function split(element: Element, by?: 'word' | 'char'): HTMLSpanElement[];
export function typed(text: string, t: number, options?: { start?: number; cps?: number; pause?: number }): string;
```

with:

```ts
export function alpha(color: string, a: number): string;
export function keys<T extends KeyValue>(t: number, frames: [time: number, value: T, curve?: Curve][]): T;
export function stagger(index: number, count: number, each: number, from?: 'start' | 'end' | 'center' | number): number;
export function frameAt(t: number, options?: { start?: number; fps?: number; count?: number }): number;
export function random(seed: number): () => number;
export function split(element: Element, by?: 'word' | 'char'): HTMLSpanElement[];
export function typed(text: string, t: number, options?: { start?: number; cps?: number; pause?: number }): string;
```

- [ ] **Step 3: `cuttle.video`, a reader per video**

In `packages/export/src/motion/runtime.ts`, replace:

```ts
  readonly view: MotionView;
}

/** A sound a page asks for (`cuttle.sound`): seconds into its showing (`at`) or an output second (`video`). */
export interface PageSound {
  sound: string;
```

with:

```ts
  readonly view: MotionView;
}

/** A video of the project, read frame by frame (`cuttle.video`). */
export interface CuttleVideo {
  /** Its URL in the page. */
  readonly src: string;
  /**
   * The frame the video shows at second `seconds` of the file (the last one starting by then: exact,
   * whatever the page's frame rate), `width` px wide (the video's own size without). Await it in
   * `onFrame` (the frame waits for an async draw); close a bitmap once it is drawn. Frames read
   * forward fastest.
   */
  frame(seconds: number, options?: { width?: number }): Promise<ImageBitmap>;
}

/** A sound a page asks for (`cuttle.sound`): seconds into its showing (`at`) or an output second (`video`). */
export interface PageSound {
  sound: string;
```

In the same file, replace:

```ts
  ready(promise: Promise<unknown>): void;
  /** The take (empty lists when the item has no take). */
  readonly take: CuttleTake;
  /**
   * A transition page's outgoing and incoming frame for the frame being drawn (the output's size,
   * opaque; null in other pages and before the first frame), and how far it is from one to the other
```

with:

```ts
  ready(promise: Promise<unknown>): void;
  /** The take (empty lists when the item has no take). */
  readonly take: CuttleTake;
  /**
   * A video of the project (an MP4, MOV or WebM: a path from the page, or from the project with a
   * leading `/`) to draw frame by frame. Each video gets a reader of its own, as the take does.
   */
  video(src: string): CuttleVideo;
  /**
   * A transition page's outgoing and incoming frame for the frame being drawn (the output's size,
   * opaque; null in other pages and before the first frame), and how far it is from one to the other
```

In the same file, replace:

```ts
    const sy = content[1] + ((y - zoom[1]) * content[3]) / zoom[3];
    return { x: sx, y: sy, inside: sx >= content[0] && sx <= content[0] + content[2] && sy >= content[1] && sy <= content[1] + content[3] };
  };
  // the recording's frames: read in the kit's worker (off the page's clock), one request at a time
  let reader: Worker | undefined;
  let readerFailure: string | undefined;
  let asked = 0;
  const replies = new Map<number, { resolve: (bitmap: ImageBitmap) => void; reject: (error: Error) => void }>();
  const failAll = (message: string) => {
    readerFailure = message;
    for (const reply of replies.values()) reply.reject(new Error(message));
    replies.clear();
  };
  const frameOf = (source: number, options: { width?: number } = {}): Promise<ImageBitmap> => {
    if (!data.recording || !init.takeWorker) return Promise.reject(new Error('this item has no screen recording to take frames from'));
    if (readerFailure) return Promise.reject(new Error(readerFailure));
    if (!reader) {
      // a worker must come from the page's own origin: a module of the page's that imports the kit's
      const boot = URL.createObjectURL(new Blob([`import ${JSON.stringify(init.takeWorker)};`], { type: 'text/javascript' }));
      reader = new Worker(boot, { type: 'module' });
      reader.onmessage = (event: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>) => {
        const { id, bitmap, error } = event.data;
        const reply = replies.get(id);
        replies.delete(id);
        if (bitmap) reply?.resolve(bitmap);
        else reply?.reject(new Error(error ?? 'no frame'));
      };
      reader.onerror = (event) => failAll(`the take's frames could not be read: ${event.message || 'the reader failed'}`);
      reader.postMessage({ type: 'open', url: data.recording, masks: data.masks, screen: data.screen });
    }
    const id = ++asked;
    const width = options.width === undefined ? undefined : Math.max(1, Math.round(Number(options.width)));
    return new Promise((resolve, reject) => {
      replies.set(id, { resolve, reject });
      reader!.postMessage({ type: 'frame', id, source: Number(source), width });
    });
  };

  const { cursor: path, ...takeFields } = data;
```

with:

```ts
    const sy = content[1] + ((y - zoom[1]) * content[3]) / zoom[3];
    return { x: sx, y: sy, inside: sx >= content[0] && sx <= content[0] + content[2] && sy >= content[1] && sy <= content[1] + content[3] };
  };
  // A video's frames (the take's recording, or a video the page asks for): read in the kit's worker
  // (off the page's clock), a worker per video, one request at a time. `what` names them in errors.
  const frameReader = (open: { url: string; name: string; masks: TakeData['masks']; screen?: TakeData['screen'] }, what: string) => {
    let reader: Worker | undefined;
    let failure: string | undefined;
    let asked = 0;
    const replies = new Map<number, { resolve: (bitmap: ImageBitmap) => void; reject: (error: Error) => void }>();
    const failAll = (message: string) => {
      failure = message;
      for (const reply of replies.values()) reply.reject(new Error(message));
      replies.clear();
    };
    return (source: number, options: { width?: number } = {}): Promise<ImageBitmap> => {
      if (!init.takeWorker) return Promise.reject(new Error(`${what} cannot be read here`));
      if (failure) return Promise.reject(new Error(failure));
      if (!reader) {
        // a worker must come from the page's own origin: a module of the page's that imports the kit's
        const boot = URL.createObjectURL(new Blob([`import ${JSON.stringify(init.takeWorker)};`], { type: 'text/javascript' }));
        reader = new Worker(boot, { type: 'module' });
        reader.onmessage = (event: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>) => {
          const { id, bitmap, error } = event.data;
          const reply = replies.get(id);
          replies.delete(id);
          if (bitmap) reply?.resolve(bitmap);
          else reply?.reject(new Error(error ?? 'no frame'));
        };
        reader.onerror = (event) => failAll(`${what} could not be read: ${event.message || 'the reader failed'}`);
        reader.postMessage({ type: 'open', ...open });
      }
      const id = ++asked;
      const width = options.width === undefined ? undefined : Math.max(1, Math.round(Number(options.width)));
      return new Promise((resolve, reject) => {
        replies.set(id, { resolve, reject });
        reader!.postMessage({ type: 'frame', id, source: Number(source), width });
      });
    };
  };
  const takeFrame = data.recording ? frameReader({ url: data.recording, name: 'the screen recording', masks: data.masks, screen: data.screen }, "the take's frames") : undefined;
  const frameOf = (source: number, options?: { width?: number }): Promise<ImageBitmap> =>
    takeFrame && init.takeWorker ? takeFrame(source, options) : Promise.reject(new Error('this item has no screen recording to take frames from'));
  // the project's videos the page asks for (cuttle.video), by their URL in the page
  const videos = new Map<string, CuttleVideo>();
  const video = (src: string): CuttleVideo => {
    let url = String(src);
    try {
      url = new URL(url, location.href).href;
    } catch {
      // a page without a base keeps the path as it is: its reader says what it could not open
    }
    let known = videos.get(url);
    if (!known) {
      const read = frameReader({ url, name: String(src), masks: [] }, `the frames of ${String(src)}`);
      known = { src: url, frame: (seconds, options) => read(seconds, options) };
      videos.set(url, known);
    }
    return known;
  };

  const { cursor: path, ...takeFields } = data;
```

In the same file, replace:

```ts
    onFrame: (draw) => void drawers.push(draw),
    ready: (promise) => void holds.push(Promise.resolve(promise).catch(note)),
    take,
    sound: (name, options = {}) => {
      if (typeof name !== 'string' || name === '') return void note(new Error('cuttle.sound needs the name of a sound'));
      const volume = Math.min(1, Math.max(0, Number(options.volume ?? 0.8)));
```

with:

```ts
    onFrame: (draw) => void drawers.push(draw),
    ready: (promise) => void holds.push(Promise.resolve(promise).catch(note)),
    take,
    video,
    sound: (name, options = {}) => {
      if (typeof name !== 'string' || name === '') return void note(new Error('cuttle.sound needs the name of a sound'));
      const volume = Math.min(1, Math.max(0, Number(options.volume ?? 0.8)));
```

In `packages/motion-kit/kit/take-worker.js`, replace:

```
// Reads the screen recording's frames for a motion page (`cuttle.take.frame`), in a worker of its own,
// so the page's virtual clock does not hold it up. mediabunny reads the file over the project's URL
// (in ranges) and WebCodecs decodes it, on forward from the frame asked last where it can. Each frame
// goes back to the page as an ImageBitmap, the project's privacy masks painted over it as the video
// paints them: `fill` with the colour around it, `blur` beyond reading.
//
// Messages: { type: 'open', url, masks } once, then { type: 'frame', id, source, width? }; each frame
// is answered with { id, bitmap } or { id, error }, in the order asked.
import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from './mediabunny/mediabunny.min.mjs';
import { masksAt, ringColor } from './take.js';
```

with:

```
// Reads a video's frames for a motion page, in a worker of its own (one per video), so the page's
// virtual clock does not hold it up: the screen recording's (`cuttle.take.frame`) or a video of the
// project's (`cuttle.video`). mediabunny reads the file over the project's URL (in ranges) and
// WebCodecs decodes it, on forward from the frame asked last where it can. Each frame goes back to the
// page as an ImageBitmap; the recording's with the project's privacy masks painted over it as the
// video paints them: `fill` with the colour around it, `blur` beyond reading.
//
// Messages: { type: 'open', url, name, masks } once (`name` says what the video is, in errors), then
// { type: 'frame', id, source, width? }; each frame is answered with { id, bitmap } or { id, error },
// in the order asked.
import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from './mediabunny/mediabunny.min.mjs';
import { masksAt, ringColor } from './take.js';
```

In the same file, replace:

```
let startedAt = -Infinity;
let last = -Infinity;

async function open({ url, masks }) {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('the screen recording has no video track');
  if (!(await track.canDecode())) throw new Error('the screen recording cannot be decoded here');
  take = { sink: new VideoSampleSink(track), first: await track.getFirstTimestamp(), width: track.displayWidth, height: track.displayHeight, masks: masks ?? [] };
}

function restart(t) {
```

with:

```
let startedAt = -Infinity;
let last = -Infinity;

async function open({ url, name = 'the screen recording', masks }) {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error(String(name) + ' has no video track');
  if (!(await track.canDecode())) throw new Error(String(name) + ' cannot be decoded here');
  take = { name, sink: new VideoSampleSink(track), first: await track.getFirstTimestamp(), width: track.displayWidth, height: track.displayHeight, masks: masks ?? [] };
}

function restart(t) {
```

In the same file, replace:

```
}

async function frame({ id, source, width }) {
  if (!take) throw failure ?? new Error('the screen recording is not open');
  const t = Math.max(Number.isFinite(source) ? source : 0, take.first);
  const sample = await sampleAt(t);
  if (!sample) throw new Error(`the screen recording has no frame at ${t.toFixed(3)} s`);
  const w = Math.min(MAX_WIDTH, Math.max(1, Math.round(width ?? take.width)));
  const h = Math.max(1, Math.round((take.height * w) / take.width));
  const canvas = new OffscreenCanvas(w, h);
```

with:

```
}

async function frame({ id, source, width }) {
  if (!take) throw failure ?? new Error('the video is not open');
  const t = Math.max(Number.isFinite(source) ? source : 0, take.first);
  const sample = await sampleAt(t);
  if (!sample) throw new Error(`${take.name} has no frame at ${t.toFixed(3)} s`);
  const w = Math.min(MAX_WIDTH, Math.max(1, Math.round(width ?? take.width)));
  const h = Math.max(1, Math.round((take.height * w) / take.width));
  const canvas = new OffscreenCanvas(w, h);
```

Run: `pnpm exec vitest run packages/motion-kit/test/motion.test.ts packages/export/test/motion-runtime.browser.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 4: Commit**

```bash
git add packages/motion-kit packages/export/src/motion/runtime.ts packages/export/test/motion-runtime.browser.test.ts
git commit -m "motion: cuttle.video draws a video of the project frame by frame; frameAt in the kit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The end-to-end check, and the docs

**Files:**
- Modify: `apps/cli/test/electron.check.test.ts`, `skill/cuttle/SKILL.md`, `skill/cuttle/motion.md`, `skill/cuttle/project.md`, `skill/test/skill.test.ts`, `README.md`

- [ ] **Step 1: The end-to-end check**

An imported video and the same video in a page, rendered, each frame once:

In `apps/cli/test/electron.check.test.ts`, replace:

```ts
    }
  }, 180_000);

  it('goes into a scene through its transition page: the fold turns the card over onto the clip', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-fold-')), 'fold');
    cpSync(project, dir, { recursive: true });
```

with:

```ts
    }
  }, 180_000);

  it('plays an imported video and a video a page draws frame by frame: each frame once, none skipped', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-video-')), 'video');
    try {
      expect(cuttle('init', dir).code).toBe(0);
      // A video whose frame n is red 20 + n × 6: which frame the video shows can be read off a pixel.
      // BT.709 and tagged, so the browser and ffmpeg turn it into the same colours (an untagged one
      // they do not).
      mkdirSync(join(dir, 'clips'), { recursive: true });
      const clip = join(dir, 'clips', 'count.mp4');
      const colours = "format=rgb24,geq=r='20+N*6':g=128:b=0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p";
      const tags = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
      spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=black:s=320x180:r=30:d=1.2,${colours}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', ...tags, '-y', clip]);
      expect(cuttle('-C', dir, 'import', clip).json).toMatchObject({ take: 'takes/1', width: 320, height: 180 });
      // after the imported take, a page that draws the same video from the project, a frame at each of its seconds
      mkdirSync(join(dir, 'motion', 'count'), { recursive: true });
      writeFileSync(
        join(dir, 'motion', 'count', 'index.html'),
        `<!doctype html><body style="margin:0;background:#000"><canvas id="c" width="1920" height="1080"></canvas><script>
        const g = document.getElementById('c').getContext('2d');
        const video = cuttle.video('/clips/count.mp4');
        cuttle.onFrame(async (t) => { const frame = await video.frame(t); g.drawImage(frame, 0, 0, 1920, 1080); frame.close(); });
        </script></body>`,
      );
      const file = join(dir, 'cuttle.json');
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { scenes: unknown[] };
      writeFileSync(file, JSON.stringify({ ...raw, look: { frame: { enabled: false }, transition: { enabled: false } }, scenes: [...raw.scenes, { type: 'motion', src: 'motion/count/index.html', duration: 1 }] }));
      const { code, json } = cuttle('-C', dir, 'render', '-o', join(dir, 'out.mp4'));
      expect(code).toBe(0);
      expect((json.motion as { errors: string[] }[]).flatMap((report) => report.errors)).toEqual([]);
      // The red in the middle of each frame: of the video, of the imported take and of the clip. Each frame
      // of the video is nearest to the frame it should show (the clip's frames come through the take's
      // colours, the page's through the browser's): none twice, none skipped.
      const reds = (file: string, x: number, y: number) =>
        [...spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `crop=4:4:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 }).stdout].filter((_, i) => i % 3 === 0);
      const video = reds(join(dir, 'out.mp4'), 958, 538);
      const take = reds(join(dir, 'takes', '1', 'screen.mp4'), 158, 88);
      const source = reds(clip, 158, 88);
      expect([video.length, take.length, source.length]).toEqual([66, 36, 36]);
      const nearest = (red: number, frames: number[]) => frames.reduce((best, value, k) => (Math.abs(value - red) < Math.abs(frames[best]! - red) ? k : best), 0);
      expect(video.slice(0, 36).map((red) => nearest(red, take))).toEqual(Array.from({ length: 36 }, (_, k) => k));
      expect(video.slice(36).map((red) => nearest(red, source))).toEqual(Array.from({ length: 30 }, (_, k) => k));
    } finally {
      rmSync(dirname(dir), { recursive: true, force: true });
    }
  }, 180_000);

  it('goes into a scene through its transition page: the fold turns the card over onto the clip', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-fold-')), 'fold');
    cpSync(project, dir, { recursive: true });
```

Run: `pnpm cli:build && pnpm exec vitest run --mode cli apps/cli/test/electron.check.test.ts -t "plays an imported"`
Expected: PASS, 1 test.

- [ ] **Step 2: The docs**

In `skill/cuttle/SKILL.md`, replace:

````markdown
`cuttle -C "<project>" --json recover takes/<n>` before anything else. A new take replaces the
previous take's scenes and overlays; older versions stay as `cuttle.json.bak`, `.bak.1` and so on.

## 3. Edit

```bash
````

with:

````markdown
`cuttle -C "<project>" --json recover takes/<n>` before anything else. A new take replaces the
previous take's scenes and overlays; older versions stay as `cuttle.json.bak`, `.bak.1` and so on.

**A video made elsewhere** (a phone, OBS, a recording the user was sent) becomes the take with
`import` instead of `record`; `--from` and `--to` (seconds of the file) take a stretch of it:

```bash
cuttle -C "<project>" --json import "<file>" --from 12 --to 40
```

The picture is converted as a recording is (30 fps, BT.709, at most 3840 px on its long side) and
the sound becomes the mic. An imported take has no input events and no markers: `suggest` cuts it
by its picture and sound alone, so add zooms by hand where something happens.

## 3. Edit

```bash
````

In `skill/cuttle/motion.md`, replace:

```markdown
  that sets everything from `t` there is right on every frame; free-running CSS animations work too,
  but keyframes you compute are easier to time. A draw may be `async` (it awaits a frame of the take):
  the frame waits for it. `import { at, ease, keys, stagger, split, typed,
  highlight, spring, random } from 'cuttle'` gives you easing, keyframes, staggering, text splitting,
  typing with a rhythm, syntax colours and springs, all as functions of time.
- **`window.cuttle`:** `time` and `duration` (the item's seconds), `videoTime` (the video's),
  `fps`, `size` (the output's pixels), `format` (`16:9`, `9:16`, `1:1`), `params`, `theme`,
  `ready(promise)` (the first frame waits for it: fonts, data, a model), `sound(…)` (below) and
  `take` (below).
- **Size:** the page is the output, one CSS pixel per pixel (1920×1080 for 16:9, 1080×1920 for
  9:16). Size things from the short side so one page works in every format:
  `--u: calc(100vmin / 1080)` and `font-size: calc(120 * var(--u))`. Canvases: `cuttle.size`.
```

with:

```markdown
  that sets everything from `t` there is right on every frame; free-running CSS animations work too,
  but keyframes you compute are easier to time. A draw may be `async` (it awaits a frame of the take):
  the frame waits for it. `import { at, ease, keys, stagger, split, typed,
  highlight, spring, random, frameAt } from 'cuttle'` gives you easing, keyframes, staggering, text
  splitting, typing with a rhythm, syntax colours, springs and frame numbers, all as functions of time.
- **`window.cuttle`:** `time` and `duration` (the item's seconds), `videoTime` (the video's),
  `fps`, `size` (the output's pixels), `format` (`16:9`, `9:16`, `1:1`), `params`, `theme`,
  `ready(promise)` (the first frame waits for it: fonts, data, a model), `sound(…)` (below),
  `video(src)` and `take` (below).
- **A video in the page, frame by frame:** `const clip = cuttle.video('/clips/intro.mp4')` (a path
  from the page, or from the project with a leading `/`) reads it in a worker of its own;
  `await clip.frame(seconds)` is the frame the file shows at that second, an ImageBitmap to draw
  (close it after). So `clip.frame(t - 1.2)` plays it from 1.2 s on, each frame once. A `<video>`
  element does not follow the page's clock. For a sequence of images, `frameAt(t, { start, fps,
  count })` says which one shows: `Math.floor((t - start) * fps)` alone lands just below a whole
  number now and then, which shows one image twice and skips the next.
- **Size:** the page is the output, one CSS pixel per pixel (1920×1080 for 16:9, 1080×1920 for
  9:16). Size things from the short side so one page works in every format:
  `--u: calc(100vmin / 1080)` and `font-size: calc(120 * var(--u))`. Canvases: `cuttle.size`.
```

In `skill/cuttle/project.md`, replace:

```markdown
# cuttle.json reference

`cuttle.json` is the only file to edit. `cuttle record` and `cuttle suggest` write it, you refine
it by hand, check it with `cuttle preview` and export it with `cuttle render`. Unknown fields are
errors, and every command names the path of a problem, counting from 0
(`scenes[1].to: "to" must be greater than "from"`). A clip must end inside the take.

## Times and pixels
```

with:

```markdown
# cuttle.json reference

`cuttle.json` is the only file to edit. `cuttle record` (or `cuttle import`) and `cuttle suggest`
write it, you refine it by hand, check it with `cuttle preview` and export it with `cuttle render`.
Unknown fields are errors, and every command names the path of a problem, counting from 0
(`scenes[1].to: "to" must be greater than "from"`). A clip must end inside the take.

## Times and pixels
```

In `skill/test/skill.test.ts`, replace:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'motion new', 'motion templates', 'music new', 'music templates', 'music set', 'music check', 'sound add', 'sound list', 'brand list', 'brand save', 'brand apply', 'brand remove', 'background', 'init', 'render', 'chapters', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion', 'music', 'sound', 'brand'];
```

with:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'import', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'motion new', 'motion templates', 'music new', 'music templates', 'music set', 'music check', 'sound add', 'sound list', 'brand list', 'brand save', 'brand apply', 'brand remove', 'background', 'init', 'render', 'chapters', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion', 'music', 'sound', 'brand'];
```

In `README.md`, replace:

```markdown
cuttle init demo && cd demo
cuttle devices                       # monitors, windows, cameras, microphones
cuttle record --mic --until-claude   # stops when Claude Code in this folder has answered, background work included (or Ctrl+C)
cuttle suggest                       # scenes: quiet start and end trimmed, idle cut, waiting sped up, zooms on the answer and on clicks
cuttle preview                       # 12 stills and a contact sheet in preview/
cuttle frame 42.5 --grid             # a source frame with a numbered pixel grid, for masks and zooms
```

with:

```markdown
cuttle init demo && cd demo
cuttle devices                       # monitors, windows, cameras, microphones
cuttle record --mic --until-claude   # stops when Claude Code in this folder has answered, background work included (or Ctrl+C)
cuttle import phone.mp4 --to 40      # or a video made elsewhere as the take (30 fps, BT.709), its sound as the mic
cuttle suggest                       # scenes: quiet start and end trimmed, idle cut, waiting sped up, zooms on the answer and on clicks
cuttle preview                       # 12 stills and a contact sheet in preview/
cuttle frame 42.5 --grid             # a source frame with a numbered pixel grid, for masks and zooms
```

In the same file, replace:

```markdown
| `@cuttle/engine` | WebGL2 compositor: backgrounds, window frames, zoom, masks, cursors, webcam, texts, stills, cards, crossfades |
| `@cuttle/export` | MP4 export in a hidden Electron window: decode, render, encode H.264, mux; mic cut to the scenes with ffmpeg (AAC) |
| `@cuttle/recorder` | Records a take on Windows (ddagrab, a window by itself through gfxcapture, DirectShow, a global input hook) and macOS (avfoundation, an event tap): a monitor, region or window, webcam and mic, input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |
| `@cuttle/core` | Project operations for the CLI and the app: `cuttle.json` as written (hash-checked writes, backups), takes, suggest, recover, frame, ffmpeg |
| `apps/cli` | The `cuttle` command: init, devices, record, suggest, preview, frame, capture-page, render, recover; `--json` for Claude |
| `apps/desktop` | The Cuttle app (Electron, React): the pill and tray, an editor per project (the export's engine in the output view, played with the mic as the clock; a timeline with thumbnails, waveform, markers and input activity; the export sheet) |
| `skill/` | The Claude skill: `SKILL.md` (the workflow) and `project.md` (the `cuttle.json` reference), installed by `pnpm skill:install` |
```

with:

```markdown
| `@cuttle/engine` | WebGL2 compositor: backgrounds, window frames, zoom, masks, cursors, webcam, texts, stills, cards, crossfades |
| `@cuttle/export` | MP4 export in a hidden Electron window: decode, render, encode H.264, mux; mic cut to the scenes with ffmpeg (AAC) |
| `@cuttle/recorder` | Records a take on Windows (ddagrab, a window by itself through gfxcapture, DirectShow, a global input hook) and macOS (avfoundation, an event tap): a monitor, region or window, webcam and mic, input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |
| `@cuttle/core` | Project operations for the CLI and the app: `cuttle.json` as written (hash-checked writes, backups), takes, import, suggest, recover, frame, ffmpeg |
| `apps/cli` | The `cuttle` command: init, devices, record, import, suggest, preview, frame, capture-page, render, recover; `--json` for Claude |
| `apps/desktop` | The Cuttle app (Electron, React): the pill and tray, an editor per project (the export's engine in the output view, played with the mic as the clock; a timeline with thumbnails, waveform, markers and input activity; the export sheet) |
| `skill/` | The Claude skill: `SKILL.md` (the workflow) and `project.md` (the `cuttle.json` reference), installed by `pnpm skill:install` |
```

Run: `pnpm exec vitest run skill`
Expected: PASS: the skill uses `cuttle import` with options the CLI has.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/test/electron.check.test.ts skill README.md
git commit -m "import and cuttle.video end to end (each frame once), in the skill and the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: All tests, the typecheck and the checks

- [ ] **Step 1: Run them**

Run: `pnpm test`
Expected: PASS, 996 passed, 82 skipped (116 files).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 17 tests.

Run: `pnpm app:check`
Expected: PASS, 58 tests.

Run: `git status --short`
Expected: no output.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the replayed commits, built from them. Every screenshot was looked at.

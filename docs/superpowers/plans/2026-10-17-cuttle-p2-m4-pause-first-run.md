# Cuttle P2-M4: Pause, Restart, First Run and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real pause (nothing captured while paused, the pieces joined in step at the stop) and a safe restart; a first run that finds ffmpeg and installs the cuttle command and the Claude skill from the app; a settings window; empty states. The phase-2 desktop app is complete with it.

**Architecture:** A paused take is a list of segments: every track stops at a pause and starts new files at a resume, and `segments.json` keeps each segment's per-track start stamps. One pure function maps wall-clock time to take time from it (`takeTime`): input events, markers, Claude's transcript markers, the stop triggers and `recover` use it. The stop joins the segments: the screen by the concat demuxer with stream copy, the webcam and mic by a filter that lines each piece up with its screen piece. The app's HUD pauses and restarts (a held press: the take goes to `takes/.discarded`, the editor offers it back). The first run and the settings share one window. ffmpeg is looked for where the OS's PATH is now (read from the registry) and in WinGet's links folder, so "Check again" works right after `winget install`. The cuttle command the app installs runs the app's own copy of the CLI with the app as Node, and the app as its Electron.

**Tech Stack:** Electron 44.7.2, React 19.3.0, Playwright 1.64.1 (`_electron`), vitest 5, ffmpeg (concat demuxer, `atrim`/`adelay`/`apad`, `trim`/`tpad`).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-desktop-design.md` (milestone P2-M4; "Recording in the app": Pause, Restart; "Settings and first run"). P2-M3 (done): `docs/superpowers/plans/2026-10-17-cuttle-p2-m3-editing.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p2-m4`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg and ffprobe must be on PATH. The checks never show a window, never capture this machine, and never write to the user's PATH, `~/.claude` or login items: they use folders of their own (`CUTTLE_BIN_DIR`, `CLAUDE_CONFIG_DIR`) and only note what they would have registered.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 9.

## Decisions made while planning

A prototype of the whole milestone, reviewed against the spec, settled these points. On the prototype, `pnpm test` passes 488 tests (41 skipped), `pnpm typecheck` exits with 0, `pnpm app:check` passes its 32 tests, and `pnpm app:build` packages the app and passes its 4.

- **Segments** (`packages/project/src/segments.ts`, pure).
  - `segments.json` (version 1) lists the take's segments. Each has the screen's, and the webcam's and mic's, file and first-packet stamp (epoch seconds), and its length once it ended; `joined` says the stop joined them.
  - `takeTime(segments, wall)` is the take time of a wall-clock moment: the lengths of the segments before it plus the time into its own. During a pause it is where the take paused (`atPause`); before the first segment it is 0.
  - `segmentOffsets` gives each segment's start in take time.
- **Pausing in the recorder** (`packages/recorder`).
  - `Recording.pause()` stops every track's ffmpeg (each file is a complete fragmented MP4) and the input logging. `resume()` starts new files (`screen.2.mp4`, …) and reports `resuming` until every track runs, then `resumed`. At the first pause the first segment's files get their number too. The newest of pause and resume wins: a resume asked during a pause resumes as soon as the pause ends.
  - `segments.json` is written atomically (`.part`, then a rename that waits a moment when Windows holds the file) at every pause and resume.
  - Input events, manual markers and Claude's live markers use take time; a marker set while paused lands where the take paused. Nothing is logged while paused.
  - `--max` counts recorded time, not pauses. A stop for Claude's answer waits until after a resume.
  - At the stop, `joinSegments` writes the take's own files: the screen by the concat demuxer with stream copy (re-encoded when the segments' formats differ, after a display mode change); the webcam and mic each by one filter that trims, delays and pads every piece to its screen piece. A new `take.json` says the joined tracks start together. Then the segment files go, and `segments.json` keeps the stamps (`joined: true`).
  - The hotkey Ctrl+Shift+Alt+P pauses and resumes. `cuttle record` says so and reports the pauses.
- **Core.**
  - `recover` joins a paused take that was never joined (a crash while paused or after a pause), from the manifest.
  - `takeClock(takeDir)`: the take's wall-clock mapping (from `segments.json` when there is one, else the screen's start). Claude's transcript markers are placed with it, so a paused take's markers land right.
- **The app's HUD.**
  - Pause and resume (the button, or the hotkey): "Paused" with the time standing still, "Resuming…" until every track runs.
  - Restart is a press held 600 ms, with a ring that fills meanwhile; let go earlier and nothing happens. The take moves to `takes/.discarded/<n>` and the countdown starts again with the same choices.
  - The editor that opens on the new take shows "Restarted. The take before it is put aside." with **Undo restart**. It is a note of its own: suggest's note about the cut does not replace it. Undo restart moves the take back as the next take (`takes/<n+1>`), recovers it and cuts it; the restarted take stays restorable from the takes menu.
- **The first run and the settings** (one window, `settings.html`; `#welcome` for the first run).
  - The first plain start (no `--open`) shows the first run: ffmpeg (found, with its version and path; or missing, with `winget install Gyan.FFmpeg` to copy and **Check again**), then the cuttle command and the Claude skill (**Install**), then **Done**, which shows the pill. Closing it counts as seen too.
  - ffmpeg is looked for in the PATH as the OS has it now (Windows: the machine's and the user's from the registry, expanded), WinGet's links folder, and this process's PATH. Found outside this process's PATH, its folder goes first on it, and the idle recorder host and media worker start again with it. The picker's **Try again** looks again too: no restart after installing ffmpeg.
  - **The cuttle command.** Shims in `%LOCALAPPDATA%\Cuttle\bin` (`CUTTLE_BIN_DIR` overrides): `cuttle.cmd` (with `setlocal`, so nothing leaks into the terminal) and `cuttle` for Git Bash. They run the app's own copy of the CLI with the app as Node (`ELECTRON_RUN_AS_NODE`). A packaged app also passes itself as `CUTTLE_ELECTRON`; the CLI then starts the app with `CUTTLE_CLI_ELECTRON` naming its Electron entry for renders and stills, and the app's entry runs only its own copy, with a profile of its own. The folder goes on the user's PATH (`[Environment]::SetEnvironmentVariable`, which tells running programs). A `cuttle` already on PATH that is not the app's (the repository's `pnpm cli:install`) is left as it is.
  - **The skill** is copied into Claude Code's config folder (`CLAUDE_CONFIG_DIR`, default `~/.claude`) under the same marker as `pnpm skill:install`. A cuttle skill folder Cuttle did not write is left as it is. SKILL.md has an `{{INSTALL_CLI}}` placeholder: the repository's install says `pnpm cli:install`, the app's says where its Install button is.
  - The packaged app carries its CLI (`apps/cli/dist`) and the skill. The CLI and the native modules are unpacked from the archive whole, so Node resolves them.
  - **Settings:** the projects folder, the countdown (Off, 3 s, 5 s), the default camera and mic (the picker's last choice; a device not plugged in now stays listed), starting at sign-in (`setLoginItemSettings`), motion (like Windows, less, full: `data-motion` on every window's root, changed live), the tools as on the first run, and the recent projects: open, rename (its folder; not while it is open in Cuttle or while a recording runs), show, remove from the list. Every change is kept at once. The tray, the pill's menu, `--settings` and Ctrl+, in the editor open it.
  - Settings are written with a rename that waits a moment when Windows holds the file; a change was lost silently before.
- **Empty states.** An empty overlay lane says how to fill it ("Z, then draw on the video …"); a take without a mic or input says so in its lane. A project without scenes shows "Nothing in the video yet" with **Let Cuttle cut it** and **Show the whole take**; Export and Play are off then.
- **A fix the checks found in P2-M3's editor:** two undos within one write lost the second write (the first write cleared the "restore pending" flag the second had set). Restores are counted now.
- **Left for later (phase 3 or a polish pass):** the pickers created hidden at start (they open in about a third of a second); a camera busy retry inside the recorder; the Look tab's cursor and frame styles drawn by the engine; a minimap; a ghost under a dragged scene.

## File structure

```
cuttle/
├── README.md                                pause, restart, the first run and the settings
├── package.json                             app:build builds the CLI first
├── skill/                                   SKILL.md ({{INSTALL_CLI}}, pause); install.mjs
├── packages/project/src/                    segments (new); index
├── packages/recorder/src/                   join (new); record, types, input, args, index
├── packages/core/src/                       recover, suggest, suggest/transcript
├── apps/cli/src/                            commands/record (pauses); electron-runner (CUTTLE_ELECTRON)
└── apps/desktop/
    ├── scripts/                             build (the settings preload); package (the CLI and skill inside)
    ├── vite.main.config.ts, vite.renderer.config.ts
    ├── src/shared/                          ipc, channels, recording
    ├── src/main/                            tools, settings-window, cli-path, entry (new);
    │                                        index, recording, recorder-host, media-service, settings, tray, windows
    ├── src/preload/                         bridge (motion); settings (new)
    ├── src/workers/recorder.ts              pause and resume
    ├── src/renderer/                        settings page (new); picker: Hud, picker.css; tokens.css;
    │                                        editor: App, Timeline, commands, doc, session, editor.css
    └── test/                                doc (new); app.check (pause, restart, settings, empty, first run); build.check
```

---

### Task 1: Segments and take time

**Files:**
- Create: `packages/project/src/segments.ts`, `packages/project/test/segments.test.ts`
- Modify: `packages/project/src/index.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p2-m4`; work there:

```bash
git switch p2-m4
```

- [ ] **Step 2: Write the failing test**

`packages/project/test/segments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseSegmentsJson, segmentOffsets, takeTime, type Segment } from '../src/segments';

const segments: Segment[] = [
  { screen: { file: 'screen.1.mp4', start: 100 }, mic: { file: 'mic.1.m4a', start: 100.05 }, duration: 4 },
  // paused from 104 to 110
  { screen: { file: 'screen.2.mp4', start: 110 }, mic: { file: 'mic.2.m4a', start: 109.98 }, duration: 3 },
  // paused from 113 to 120; the third still records
  { screen: { file: 'screen.3.mp4', start: 120 } },
];

describe('takeTime', () => {
  it('counts only the time segments record, and nothing before, between or after them', () => {
    expect(takeTime(segments, 99)).toBeUndefined();
    expect(takeTime(segments, 100)).toBe(0);
    expect(takeTime(segments, 103.5)).toBe(3.5);
    expect(takeTime(segments, 104)).toBe(4);
    expect(takeTime(segments, 107)).toBeUndefined(); // paused
    expect(takeTime(segments, 110)).toBe(4);
    expect(takeTime(segments, 112.25)).toBe(6.25);
    expect(takeTime(segments, 116)).toBeUndefined(); // paused
    // the last segment has no length yet: it runs on
    expect(takeTime(segments, 130)).toBe(17);
    expect(takeTime(segments.slice(0, 2), 114)).toBeUndefined(); // after the end
  });

  it('puts a moment of a pause where the take paused, when asked to (a marker set while paused)', () => {
    expect(takeTime(segments, 107, true)).toBe(4);
    expect(takeTime(segments, 116, true)).toBe(7);
    expect(takeTime(segments.slice(0, 2), 114, true)).toBe(7);
    expect(takeTime(segments, 99, true)).toBeUndefined(); // before the take: nothing to put it on
  });

  it('places each segment after the ones before it', () => {
    expect(segmentOffsets(segments)).toEqual([0, 4, 7]);
  });

  it('reads segments.json, and says what is wrong with a broken one', () => {
    const text = JSON.stringify({ version: 1, segments, joined: false });
    expect(parseSegmentsJson(`\uFEFF${text}`)).toEqual({ ok: true, segments: { version: 1, segments, joined: false } });
    const broken = parseSegmentsJson(JSON.stringify({ version: 1, segments: [] }));
    expect(broken.ok).toBe(false);
    expect(parseSegmentsJson('{').ok).toBe(false);
  });
});
```

Run: `pnpm exec vitest run --project node packages/project/test/segments.test.ts`
Expected: FAIL: the test cannot load `../src/segments` (the file does not exist yet).

- [ ] **Step 3: The segments**

`packages/project/src/segments.ts`:

```ts
import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';

/** The segments.json format version this build reads and the recorder writes. */
export const SEGMENTS_VERSION = 1;

const TrackSchema = z.strictObject({
  file: z.string().min(1),
  /** Wall-clock seconds of the track's first frame or sample, on take.json's clock. */
  start: z.number(),
});

/** One stretch of a paused take: each track's file and first-sample stamp, and its length once it ended. */
const SegmentSchema = z.strictObject({
  screen: TrackSchema,
  webcam: TrackSchema.optional(),
  mic: TrackSchema.optional(),
  /** Seconds of the screen file; missing while it records (after a crash, recover measures it). */
  duration: z.number().nonnegative().optional(),
});

/**
 * segments.json, next to a take's tracks when it was paused: written at every pause and resume (a
 * new file, then renamed over the old one). The take's time runs only while a segment records;
 * `takeTime` maps the wall clock onto it. `joined`: the segments were joined into the take's tracks.
 */
export const SegmentsFileSchema = z.strictObject({
  version: z.literal(SEGMENTS_VERSION),
  segments: z.array(SegmentSchema).min(1),
  joined: z.boolean().optional(),
});

export type SegmentsFile = z.output<typeof SegmentsFileSchema>;
export type Segment = SegmentsFile['segments'][number];

export type SegmentsFileParseResult = { ok: true; segments: SegmentsFile } | { ok: false; issues: ProjectIssue[] };

export function parseSegmentsJson(text: string): SegmentsFileParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  const result = SegmentsFileSchema.safeParse(raw);
  if (result.success) return { ok: true, segments: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}

/**
 * The take seconds of a wall-clock time: the length of the segments before it plus the time since
 * its segment's screen track started; a segment without a duration (still recording) runs on.
 * Undefined before the first segment, and during a pause or after the last segment unless
 * `atPause`: then the moment it paused (a marker set while paused lands where the take resumes).
 */
export function takeTime(segments: readonly Segment[], wall: number, atPause = false): number | undefined {
  let offset = 0;
  for (const [index, segment] of segments.entries()) {
    const into = wall - segment.screen.start;
    if (into < 0) return atPause && index > 0 ? offset : undefined;
    if (segment.duration === undefined || into <= segment.duration) return offset + into;
    offset += segment.duration;
  }
  return atPause && segments.length > 0 ? offset : undefined;
}

/** Where each segment starts in the take (seconds): 0, then the sum of the lengths before it. */
export function segmentOffsets(segments: readonly Segment[]): number[] {
  let offset = 0;
  return segments.map((segment) => {
    const at = offset;
    offset += segment.duration ?? 0;
    return at;
  });
}
```

In `packages/project/src/index.ts`, replace:

```ts
export { defaultProject } from './defaults';
export { ID_PREFIXES, newId, usedIds, type IdList } from './ids';
export { parseEventsJsonl } from './events';
export { TAKE_VERSION, TakeFileSchema, parseTakeJson, trackOffset, type TakeFile, type TakeFileParseResult, type TakeFileTrack } from './take';
export {
  MARKERS_VERSION,
```

with:

```ts
export { defaultProject } from './defaults';
export { ID_PREFIXES, newId, usedIds, type IdList } from './ids';
export { parseEventsJsonl } from './events';
export { SEGMENTS_VERSION, SegmentsFileSchema, parseSegmentsJson, segmentOffsets, takeTime, type Segment, type SegmentsFile, type SegmentsFileParseResult } from './segments';
export { TAKE_VERSION, TakeFileSchema, parseTakeJson, trackOffset, type TakeFile, type TakeFileParseResult, type TakeFileTrack } from './take';
export {
  MARKERS_VERSION,
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run --project node packages/project/test/segments.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/project
git commit -m "project: segments.json and take time (the pieces of a paused take)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pausing in the recorder, and joining the pieces

**Files:**
- Create: `packages/recorder/src/join.ts`, `packages/recorder/test/join.test.ts`
- Modify: `packages/recorder/src/{record,types,input,args,index}.ts`, `packages/recorder/test/record.test.ts`, `apps/cli/src/commands/record.ts`

- [ ] **Step 1: Write the failing tests**

`packages/recorder/test/join.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Segment } from '@cuttle/project';
import { VIDEO_CODEC } from '../src/args';
import { concatList, joinSegments, mediaInfo, runFfmpeg } from '../src/join';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-join-'));
  dirs.push(dir);
  return dir;
};

const FRAME = 1 / 30;
const FRAGMENTED = ['-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4'];

/** A screen segment like the recorder's: black, with one white frame at `flash` seconds. */
const screen = (file: string, seconds: number, flash: number, size = '320x240') =>
  runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:s=${size}:r=30:d=${seconds},drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n\\,${Math.round(flash * 30)})'`,
    '-vf', 'format=yuv420p', ...VIDEO_CODEC, ...FRAGMENTED, '-y', file,
  ]);
/** A mic segment: silence with a 50 ms beep at `beep` seconds of the file. */
const mic = (file: string, seconds: number, beep: number) =>
  runFfmpeg(['-f', 'lavfi', '-i', `aevalsrc='0.8*sin(2*PI*1000*t)*between(t\\,${beep}\\,${beep + 0.05})':s=48000:d=${seconds}`, '-c:a', 'aac', '-b:a', '160k', ...FRAGMENTED, '-y', file]);

/** Seconds of the white frames in a video. */
async function flashes(file: string): Promise<number[]> {
  const out = await runFfmpeg(['-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-']);
  const times: number[] = [];
  let at: number | undefined;
  for (const line of out.split('\n')) {
    const time = /pts_time:(\d+(?:\.\d+)?)/.exec(line);
    if (time) at = Number(time[1]);
    const avg = /lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/.exec(line);
    if (avg && Number(avg[1]) > 128 && at !== undefined) times.push(at);
  }
  return times;
}

/** Seconds where a beep starts in an audio file (silencedetect also ends the last silence at the end of the file). */
async function beeps(file: string): Promise<number[]> {
  const out = await runFfmpeg(['-i', file, '-af', 'silencedetect=n=-30dB:d=0.02', '-f', 'null', '-']);
  const end = (await mediaInfo(file, 'a')).seconds;
  return [...out.matchAll(/silence_end: (\d+(?:\.\d+)?)/g)].map((match) => Number(match[1])).filter((t) => t < end - 0.05);
}

describe('joining a paused take', () => {
  it('keeps the mic in sync with the screen across pauses, within a frame, wherever each segment started', async () => {
    const dir = temp();
    // Three segments; the mic starts 0.2 s after, 0.1 s before and 0.05 s after its screen segment.
    // The beep and the flash happen at the same wall-clock moment in each.
    await Promise.all([
      screen(join(dir, 'screen.1.mp4'), 3, 1),
      mic(join(dir, 'mic.1.m4a'), 3.2, 0.8),
      screen(join(dir, 'screen.2.mp4'), 2, 0.5),
      mic(join(dir, 'mic.2.m4a'), 2.3, 0.6),
      screen(join(dir, 'screen.3.mp4'), 2.5, 2),
      mic(join(dir, 'mic.3.m4a'), 2.6, 1.95),
    ]);
    const segments: Segment[] = [
      { screen: { file: 'screen.1.mp4', start: 1000 }, mic: { file: 'mic.1.m4a', start: 1000.2 }, duration: 3 },
      { screen: { file: 'screen.2.mp4', start: 1010 }, mic: { file: 'mic.2.m4a', start: 1009.9 }, duration: 2 },
      { screen: { file: 'screen.3.mp4', start: 1020 }, mic: { file: 'mic.3.m4a', start: 1020.05 }, duration: 2.5 },
    ];
    const joined = await joinSegments(dir, segments, { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a' });
    expect(joined).toEqual({ webcam: false, mic: true });

    // the screen is copied end to end: 3 + 2 + 2.5 s, its flashes where each segment put them
    expect((await mediaInfo(join(dir, 'screen.mp4'), 'v')).seconds).toBeCloseTo(7.5, 1);
    const seen = await flashes(join(dir, 'screen.mp4'));
    expect(seen.map((t) => Math.round(t * 1000) / 1000)).toEqual([1, 3.5, 7]);
    // the mic is as long, and each beep sounds within a frame of its flash
    expect((await mediaInfo(join(dir, 'mic.m4a'), 'a')).seconds).toBeCloseTo(7.5, 1);
    const heard = await beeps(join(dir, 'mic.m4a'));
    expect(heard).toHaveLength(3);
    heard.forEach((t, i) => expect(Math.abs(t - seen[i]!)).toBeLessThan(FRAME));
  }, 60_000);

  it('re-encodes the screen to the first size when a segment has another, and fills a missing mic with silence', async () => {
    const dir = temp();
    await Promise.all([screen(join(dir, 'a.mp4'), 1, 0.5), screen(join(dir, 'b.mp4'), 1, 0.5, '640x360'), mic(join(dir, 'm.m4a'), 1, 0.2)]);
    const segments: Segment[] = [
      { screen: { file: 'a.mp4', start: 0 }, mic: { file: 'm.m4a', start: 0 }, duration: 1 },
      { screen: { file: 'b.mp4', start: 5 }, duration: 1 },
    ];
    await joinSegments(dir, segments, { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a' });
    expect(await mediaInfo(join(dir, 'screen.mp4'), 'v')).toEqual({ seconds: expect.closeTo(2, 1), width: 320, height: 240 });
    expect((await mediaInfo(join(dir, 'mic.m4a'), 'a')).seconds).toBeCloseTo(2, 1);
    expect(await beeps(join(dir, 'mic.m4a'))).toHaveLength(1);
  }, 60_000);

  it('writes a concat list that survives quotes and backslashes in paths', () => {
    expect(concatList(["C:\\takes\\it's\\screen.1.mp4", '/x/screen.2.mp4'])).toBe("file 'C:/takes/it'\\''s/screen.1.mp4'\nfile '/x/screen.2.mp4'\n");
  });
});
```

In `packages/recorder/test/record.test.ts`, replace:

```ts
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseEventsJsonl, parseMarkersJson, parseTakeJson, trackOffset } from '@cuttle/project';
import { CLAUDE_TAIL_SECONDS, claudeTranscriptDir, record, type RecordOptions, type RecorderEvent } from '../src/index';
import { inDeadZone } from '../src/record';
```

with:

```ts
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseEventsJsonl, parseMarkersJson, parseSegmentsJson, parseTakeJson, trackOffset } from '@cuttle/project';
import { CLAUDE_TAIL_SECONDS, claudeTranscriptDir, record, type RecordOptions, type RecorderEvent } from '../src/index';
import { inDeadZone } from '../src/record';
```

In the same file, replace:

```ts

    const takeFile = parseTakeJson(read(projectDir, 'takes/1/take.json'));
    if (!takeFile.ok) throw new Error(JSON.stringify(takeFile.issues));
    expect(Math.abs(trackOffset(takeFile.take, 'webcam')!)).toBeLessThan(0.2);
    expect(Math.abs(trackOffset(takeFile.take, 'mic')!)).toBeLessThan(0.2);

    const { events: input, issues } = parseEventsJsonl(read(projectDir, take.events));
    expect(issues).toEqual([]);
```

with:

```ts

    const takeFile = parseTakeJson(read(projectDir, 'takes/1/take.json'));
    if (!takeFile.ok) throw new Error(JSON.stringify(takeFile.issues));
    // each track's start is recorded (the engine lines them up); a loaded machine starts one late
    expect(Math.abs(trackOffset(takeFile.take, 'webcam')!)).toBeLessThan(0.5);
    expect(Math.abs(trackOffset(takeFile.take, 'mic')!)).toBeLessThan(0.5);

    const { events: input, issues } = parseEventsJsonl(read(projectDir, take.events));
    expect(issues).toEqual([]);
```

In the same file, replace:

```ts
});

// Not concurrent: these set CLAUDE_CONFIG_DIR, which the watcher reads when the recording starts.
describe('record until a Claude Code turn ends (test backend)', () => {
  function transcripts() {
    const config = temp('cuttle-claude-');
```

with:

```ts
});

// Not concurrent: these set CLAUDE_CONFIG_DIR, which the watcher reads when the recording starts.
describe.concurrent('pausing a take (test backend)', () => {
  it('records nothing while paused, joins the segments with every track in step, and counts maxSeconds in take time', async () => {
    const projectDir = project();
    const events: RecorderEvent['type'][] = [];
    let wallAtPause = 0;
    const started = Date.now() / 1000;
    const recording = record({
      ...test,
      projectDir,
      webcam: 'Test Camera',
      mic: 'Test Microphone',
      stop: { maxSeconds: 5 },
      onEvent: (event) => {
        events.push(event.type);
        if (event.type === 'recording') setTimeout(() => recording.pause(), 1200);
        if (event.type === 'paused' && wallAtPause === 0) {
          wallAtPause = Date.now() / 1000;
          // a marker set while paused lands where the take paused
          recording.marker('during the pause');
          setTimeout(() => recording.resume(), 1000);
        }
        if (event.type === 'resumed' && events.filter((type) => type === 'resumed').length === 1) {
          setTimeout(() => recording.pause(), 1000);
          // the second pause is short: resume asked before it even finished
          setTimeout(() => recording.resume(), 1100);
        }
      },
    });
    const take = await recording.done;
    const elapsed = Date.now() / 1000 - started;

    expect(take.stopReason).toBe('max-seconds');
    // 5 s of take (room for two segments that start late on a loaded machine), and at least a second more of pauses on the clock
    expect(take.seconds).toBeCloseTo(5, 0);
    expect(elapsed).toBeGreaterThan(take.seconds + 1);
    expect(events.filter((type) => type === 'paused')).toHaveLength(2);
    expect(events.filter((type) => type === 'resumed')).toHaveLength(2);
    expect(events.at(-1)).toBe('stopping');

    // the joined tracks are as long as the take (each segment lined up with its screen segment)
    const screen = probe(join(projectDir, take.screen));
    expect(screen).toMatchObject({ codec_name: 'h264', width: 1280, height: 720 });
    expect(screen.duration).toBeCloseTo(take.seconds, 1);
    expect(probe(join(projectDir, take.webcam!)).duration).toBeCloseTo(take.seconds, 1);
    expect(probe(join(projectDir, take.mic!)).duration).toBeCloseTo(take.seconds, 1);
    // take.json: the joined webcam and mic start with the screen
    const takeFile = parseTakeJson(read(projectDir, 'takes/1/take.json'));
    if (!takeFile.ok) throw new Error(JSON.stringify(takeFile.issues));
    expect(trackOffset(takeFile.take, 'webcam')).toBe(0);
    expect(trackOffset(takeFile.take, 'mic')).toBe(0);
    // segments.json keeps the stamps (for Claude's markers later); the segments' files are gone
    const manifest = parseSegmentsJson(read(projectDir, 'takes/1/segments.json'));
    if (!manifest.ok) throw new Error(JSON.stringify(manifest.issues));
    expect(manifest.segments.joined).toBe(true);
    expect(manifest.segments.segments).toHaveLength(3);
    const lengths = manifest.segments.segments.map((segment) => segment.duration!);
    expect(lengths.reduce((sum, length) => sum + length, 0)).toBeCloseTo(take.seconds, 1);
    expect(readdirSync(join(projectDir, 'takes/1')).sort()).toEqual(['events.jsonl', 'markers.json', 'mic.m4a', 'screen.mp4', 'segments.json', 'take.json', 'webcam.mp4']);

    // the marker set while paused is at the end of the first segment
    expect(markersOf(projectDir, take.markers)).toEqual([{ t: expect.closeTo(lengths[0]!, 1), kind: 'manual', label: 'during the pause' }]);
    // input is in take time: nothing beyond the take, and none while paused
    const { events: input } = parseEventsJsonl(read(projectDir, take.events));
    expect(input.at(-1)!.t).toBeLessThanOrEqual(take.seconds + 0.1);
    expect(Math.max(...input.map((event) => event.t))).toBeLessThanOrEqual(take.seconds + 0.1);
  }, SLOW);

  it('stops while paused: the take ends where it paused', async () => {
    const projectDir = project();
    let pausedAt = 0;
    let stoppedAt = 0;
    const recording = record({
      ...test,
      projectDir,
      mic: 'Test Microphone',
      stop: {},
      onEvent: (event) => {
        if (event.type === 'recording')
          setTimeout(() => {
            pausedAt = Date.now() / 1000;
            recording.pause();
          }, 1000);
        if (event.type === 'paused')
          setTimeout(() => {
            stoppedAt = Date.now() / 1000;
            void recording.stop();
          }, 800);
      },
    });
    const take = await recording.done;
    expect(take.stopReason).toBe('stop');
    // from the screen's first frame (the recording event waits for the mic too, later on a loaded
    // machine) to the pause; the 0.8 s paused before the stop are not in it
    const manifest = parseSegmentsJson(read(projectDir, 'takes/1/segments.json'));
    if (!manifest.ok) throw new Error(JSON.stringify(manifest.issues));
    const screenStart = manifest.segments.segments[0]!.screen.start;
    expect(take.seconds).toBeCloseTo(pausedAt - screenStart, 0);
    expect(take.seconds).toBeLessThan(stoppedAt - screenStart - 0.5);
    expect(probe(join(projectDir, take.screen)).duration).toBeCloseTo(take.seconds, 1);
    expect(probe(join(projectDir, take.mic!)).duration).toBeCloseTo(take.seconds, 1);
    expect(existsSync(join(projectDir, 'takes/1/screen.1.mp4'))).toBe(false);
  }, SLOW);
});

describe('record until a Claude Code turn ends (test backend)', () => {
  function transcripts() {
    const config = temp('cuttle-claude-');
```

Run: `pnpm exec vitest run --project node packages/recorder/test/join.test.ts`
Expected: FAIL: the test cannot load `../src/join` (the file does not exist yet).

- [ ] **Step 2: Joining**

`packages/recorder/src/join.ts`:

```ts
// Joining the segments of a paused take into its tracks. The screen's are copied end to end by the
// concat demuxer (lossless), or re-encoded when a segment's size changed (a display mode change).
// The mic's and the webcam's are lined up with their screen segment one by one: each starts as far
// after its screen segment as it did when recorded and lasts exactly as long, so the tracks stay
// in sync however many pauses there were (AAC joined as it is drifts ~23 ms per pause).
import { spawn } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';

/**
 * A rename that waits a moment when Windows holds the file (a virus scanner on a file just written,
 * a reader): tried again for about half a second, so a pause or a join does not fail on it.
 */
export function renameWhenFree(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      return renameSync(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * attempt);
    }
  }
}
import { join } from 'node:path';
import type { Segment } from '@cuttle/project';
import { VIDEO_CODEC } from './args';
import { RecorderError } from './errors';
import { ffmpegMissing, ffmpegPath } from './ffmpeg';

const AUDIO_RATE = 48_000;
const FPS = 30;

/** The concat demuxer's list file: one line per file, single quotes escaped. */
export function concatList(files: readonly string[]): string {
  return files.map((file) => `file '${file.replaceAll('\\', '/').replaceAll("'", "'\\''")}'\n`).join('');
}

/** The screen's segments copied end to end into `out` (all the same size). */
export function screenCopyArgs(list: string, out: string): string[] {
  return ['-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0', '-c', 'copy', '-movflags', '+faststart', '-y', out];
}

/** The screen's segments re-encoded to the first one's size (a segment's size changed while paused). */
export function screenEncodeArgs(files: readonly string[], size: { width: number; height: number }, out: string): string[] {
  const { width, height } = size;
  const chains = files.map((_, k) => `[${k}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[v${k}]`);
  const graph = `${chains.join(';')};${files.map((_, k) => `[v${k}]`).join('')}concat=n=${files.length}:v=1:a=0[out]`;
  return [...files.flatMap((file) => ['-i', file]), '-filter_complex', graph, '-map', '[out]', ...VIDEO_CODEC, '-movflags', '+faststart', '-y', out];
}

const seconds = (value: number) => value.toFixed(6);

/**
 * A track's segments lined up with the screen's, by the stamps in segments.json (the time of each
 * first frame or sample). A segment where the track did not start is silent (black for video).
 */
export function alignedArgs(track: 'mic' | 'webcam', segments: readonly Segment[], dir: string, size: { width: number; height: number } | undefined, out: string): string[] {
  const inputs: string[] = [];
  const chains: string[] = [];
  segments.forEach((segment, k) => {
    const duration = segment.duration ?? 0;
    const entry = segment[track];
    if (!entry) {
      chains.push(
        track === 'mic'
          ? `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=duration=${seconds(duration)}[s${k}]`
          : `color=c=black:s=${size!.width}x${size!.height}:r=${FPS},trim=duration=${seconds(duration)},format=yuv420p[s${k}]`,
      );
      return;
    }
    const input = inputs.length / 2;
    inputs.push('-i', join(dir, entry.file));
    // how much later than its screen segment the track started (negative: earlier)
    const delay = entry.start - segment.screen.start;
    if (track === 'mic') {
      const head = delay < 0 ? `atrim=start=${seconds(-delay)},asetpts=PTS-STARTPTS` : `adelay=${Math.round(delay * AUDIO_RATE)}S:all=1`;
      chains.push(
        `[${input}:a]aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:sample_rates=${AUDIO_RATE}:channel_layouts=stereo,${head},apad,atrim=duration=${seconds(duration)},asetpts=PTS-STARTPTS[s${k}]`,
      );
    } else {
      const head = delay < 0 ? `trim=start=${seconds(-delay)},setpts=PTS-STARTPTS` : `tpad=start_duration=${seconds(delay)}:start_mode=clone`;
      chains.push(
        `[${input}:v]fps=${FPS},scale=${size!.width}:${size!.height},setsar=1,${head},tpad=stop=-1:stop_mode=clone,trim=duration=${seconds(duration)},setpts=PTS-STARTPTS,format=yuv420p[s${k}]`,
      );
    }
  });
  const kind = track === 'mic' ? 'v=0:a=1' : 'v=1:a=0';
  const graph = `${chains.join(';')};${segments.map((_, k) => `[s${k}]`).join('')}concat=n=${segments.length}:${kind}[out]`;
  const codec = track === 'mic' ? ['-c:a', 'aac', '-b:a', '160k'] : VIDEO_CODEC;
  return [...inputs, '-filter_complex', graph, '-map', '[out]', ...codec, '-movflags', '+faststart', '-y', out];
}

/** Output kept from ffmpeg (its size and stream lines come first, its progress last). */
const OUTPUT_LIMIT = 4 * 1024 * 1024;

/** Runs ffmpeg to the end and resolves with its output; rejects with the end of it. */
export function runFfmpeg(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < OUTPUT_LIMIT) stderr += chunk;
    });
    child.on('error', (error: NodeJS.ErrnoException) => reject(error.code === 'ENOENT' ? ffmpegMissing(error) : error));
    child.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new RecorderError('capture', `ffmpeg failed (exit code ${code}): ${stderr.trim().split('\n').slice(-6).join('\n')}`));
    });
  });
}

/** A video or audio file's length (to ffmpeg's 10 ms) and, for video, its size. */
export async function mediaInfo(file: string, stream: 'v' | 'a'): Promise<{ seconds: number; width?: number; height?: number }> {
  const stderr = await runFfmpeg(['-i', file, '-map', `0:${stream}:0`, '-c', 'copy', '-f', 'null', '-']);
  const time = [...stderr.matchAll(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)].at(-1);
  const size = stream === 'v' ? /Stream #0:\d+[^\n]*Video:[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(stderr) : null;
  return {
    seconds: time ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : 0,
    ...(size && { width: Number(size[1]), height: Number(size[2]) }),
  };
}

/**
 * Joins the segments of the take in `dir` into `files` (the take's track names), each through a
 * `.joining` file renamed into place when it is complete. Returns the tracks that were joined.
 */
export async function joinSegments(dir: string, segments: readonly Segment[], files: { screen: string; webcam: string; mic: string }): Promise<{ webcam: boolean; mic: boolean }> {
  const screens = segments.map((segment) => join(dir, segment.screen.file));
  const sizes = await Promise.all(screens.map((file) => mediaInfo(file, 'v')));
  const first = { width: sizes[0]?.width ?? 0, height: sizes[0]?.height ?? 0 };
  const temp = (file: string) => join(dir, `${file}.joining.${file.endsWith('.m4a') ? 'm4a' : 'mp4'}`);
  const same = sizes.every((size) => size.width === first.width && size.height === first.height);
  if (same) {
    const list = join(dir, 'segments.txt');
    writeFileSync(list, concatList(screens));
    await runFfmpeg(screenCopyArgs(list, temp(files.screen)));
  } else {
    await runFfmpeg(screenEncodeArgs(screens, first, temp(files.screen)));
  }
  renameWhenFree(temp(files.screen), join(dir, files.screen));
  const has = { webcam: segments.some((segment) => segment.webcam), mic: segments.some((segment) => segment.mic) };
  if (has.mic) {
    await runFfmpeg(alignedArgs('mic', segments, dir, undefined, temp(files.mic)));
    renameWhenFree(temp(files.mic), join(dir, files.mic));
  }
  if (has.webcam) {
    const firstCamera = segments.find((segment) => segment.webcam)!.webcam!;
    const camera = await mediaInfo(join(dir, firstCamera.file), 'v');
    await runFfmpeg(alignedArgs('webcam', segments, dir, { width: camera.width ?? 640, height: camera.height ?? 480 }, temp(files.webcam)));
    renameWhenFree(temp(files.webcam), join(dir, files.webcam));
  }
  return has;
}
```

In `packages/recorder/src/args.ts`, replace:

```ts
  'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';

/** H.264 at high quality; a key frame every 2 s, so a fragment (one GOP) loses at most 2 s in a crash. */
const VIDEO_CODEC = [
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
  '-force_key_frames', 'expr:gte(t,n_forced*2)',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
```

with:

```ts
  'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';

/** H.264 at high quality; a key frame every 2 s, so a fragment (one GOP) loses at most 2 s in a crash. */
export const VIDEO_CODEC = [
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
  '-force_key_frames', 'expr:gte(t,n_forced*2)',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
```

Run: `pnpm exec vitest run --project node packages/recorder/test/join.test.ts`
Expected: PASS, 3 tests (a beep and a flash two segments later stay within a frame of each other).

- [ ] **Step 3: Pause and resume in `record`**

In `packages/recorder/src/types.ts`, replace:

```ts
  | { type: 'recording'; dir: string }
  | { type: 'marker'; marker: Marker }
  | { type: 'warning'; message: string }
  | { type: 'stopping'; reason: StopReason };

/** A finished take. Paths are relative to the project folder, with forward slashes. */
```

with:

```ts
  | { type: 'recording'; dir: string }
  | { type: 'marker'; marker: Marker }
  | { type: 'warning'; message: string }
  /** Every track has stopped: nothing is captured or logged until a resume. */
  | { type: 'paused' }
  /** The tracks are starting again (a camera can take a second or two). */
  | { type: 'resuming' }
  /** Every track records again. */
  | { type: 'resumed' }
  | { type: 'stopping'; reason: StopReason };

/** A finished take. Paths are relative to the project folder, with forward slashes. */
```

In the same file, replace:

```ts
export interface Recording {
  /** Stops every track and resolves with the take (same promise as `done`). */
  stop(): Promise<Take>;
  /** Adds a manual marker at the current time. */
  marker(label?: string): void;
  /** Replaces the dead zones (`RecordOptions.deadZones`), e.g. after the HUD was dragged. */
  setDeadZones(zones: Bounds[]): void;
  /** Resolves when the recording has stopped for any reason; rejects with a `RecorderError`. */
```

with:

```ts
export interface Recording {
  /** Stops every track and resolves with the take (same promise as `done`). */
  stop(): Promise<Take>;
  /** Adds a manual marker at the current time (while paused: where the take paused). */
  marker(label?: string): void;
  /**
   * Pauses the take: every track stops (each file is complete) and nothing is captured or logged
   * until `resume()`. The take's time stands still meanwhile; the stop joins the pieces. Events:
   * `paused`, then `resuming` and `resumed`. The newest of `pause` and `resume` wins.
   */
  pause(): void;
  resume(): void;
  /** Replaces the dead zones (`RecordOptions.deadZones`), e.g. after the HUD was dragged. */
  setDeadZones(zones: Bounds[]): void;
  /** Resolves when the recording has stopped for any reason; rejects with a `RecorderError`. */
```

In the same file, replace:

```ts
  | { type: 'shape'; time: number; shape: CursorShape }
  | { type: 'key'; time: number };

export type HotkeyAction = 'stop' | 'marker';
```

with:

```ts
  | { type: 'shape'; time: number; shape: CursorShape }
  | { type: 'key'; time: number };

export type HotkeyAction = 'stop' | 'marker' | 'pause';
```

In `packages/recorder/src/input.ts`, replace:

```ts
const now = () => Date.now() / 1000;

/** Ctrl+Shift+Alt+<key>: no app binds these, and AltGr+Shift+letter types nothing on common layouts. */
export const HOTKEYS: Record<HotkeyAction, string> = { stop: 'Ctrl+Shift+Alt+S', marker: 'Ctrl+Shift+Alt+M' };

export interface KeyEvent {
  keycode: number;
```

with:

```ts
const now = () => Date.now() / 1000;

/** Ctrl+Shift+Alt+<key>: no app binds these, and AltGr+Shift+letter types nothing on common layouts. */
export const HOTKEYS: Record<HotkeyAction, string> = { stop: 'Ctrl+Shift+Alt+S', marker: 'Ctrl+Shift+Alt+M', pause: 'Ctrl+Shift+Alt+P' };

export interface KeyEvent {
  keycode: number;
```

In the same file, replace:

```ts
    UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Shift, UiohookKey.ShiftRight,
    UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Meta, UiohookKey.MetaRight,
  ]);
  const keys = keyHandler(modifiers, new Map<number, HotkeyAction>([[UiohookKey.S, 'stop'], [UiohookKey.M, 'marker']]), onInput, onHotkey);
  const buttons = new Map<unknown, 'left' | 'right' | 'middle'>([[1, 'left'], [2, 'right'], [3, 'middle']]);
  let shape = win.cursorShape(); // before the hook starts: nothing to undo if it throws
```

with:

```ts
    UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Shift, UiohookKey.ShiftRight,
    UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Meta, UiohookKey.MetaRight,
  ]);
  const keys = keyHandler(modifiers, new Map<number, HotkeyAction>([[UiohookKey.S, 'stop'], [UiohookKey.M, 'marker'], [UiohookKey.P, 'pause']]), onInput, onHotkey);
  const buttons = new Map<unknown, 'left' | 'right' | 'middle'>([[1, 'left'], [2, 'right'], [3, 'middle']]);
  let shape = win.cursorShape(); // before the hook starts: nothing to undo if it throws
```

In `packages/recorder/src/index.ts`, replace:

```ts
export { record, CLAUDE_TAIL_SECONDS } from './record';
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
```

with:

```ts
export { record, CLAUDE_TAIL_SECONDS } from './record';
export { joinSegments } from './join';
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
```

In `packages/recorder/src/record.ts`, replace:

```ts
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, type Marker, type MarkersFile, type TakeFile } from '@cuttle/project';
import { SILENCE_SECONDS, freezeEnd, freezeStart, micArgs, screenArgs, silenceStart, webcamArgs } from './args';
import { claudeTranscriptDir, watchClaude, type ClaudeSignal } from './claude';
import { devicesFor, windowsFor } from './devices';
```

with:

```ts
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, SEGMENTS_VERSION, TAKE_VERSION, takeTime, type Marker, type MarkersFile, type Segment, type SegmentsFile, type TakeFile } from '@cuttle/project';
import { SILENCE_SECONDS, freezeEnd, freezeStart, micArgs, screenArgs, silenceStart, webcamArgs } from './args';
import { claudeTranscriptDir, watchClaude, type ClaudeSignal } from './claude';
import { devicesFor, windowsFor } from './devices';
```

In the same file, replace:

```ts
import { EventsWriter } from './events';
import { spawnCapture, type CaptureProcess } from './ffmpeg';
import { startInput, type InputSource } from './input';
import { areaGeometry, checkDevice, micInput, micLatency, platformFor, resolveArea, screenInput, webcamInput, type Platform, type ScreenArea } from './sources';
import type { Bounds, RawInput, RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';
```

with:

```ts
import { EventsWriter } from './events';
import { spawnCapture, type CaptureProcess } from './ffmpeg';
import { startInput, type InputSource } from './input';
import { joinSegments, mediaInfo, renameWhenFree } from './join';
import { areaGeometry, checkDevice, micInput, micLatency, platformFor, resolveArea, screenInput, webcamInput, type Platform, type ScreenArea } from './sources';
import type { Bounds, RawInput, RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';
```

In the same file, replace:

```ts
const FILE_POLL_MS = 200;
const IDLE_POLL_MS = 200;

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json' };

const now = () => Date.now() / 1000;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
```

with:

```ts
const FILE_POLL_MS = 200;
const IDLE_POLL_MS = 200;

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json', segments: 'segments.json' };
/** How often maxSeconds is checked against the take's time (which stands still while paused). */
const MAX_POLL_MS = 50;

const now = () => Date.now() / 1000;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
```

In the same file, replace:

```ts
      return done;
    },
    marker: (label) => control.marker(label),
    setDeadZones: (zones) => (control.deadZones = [...zones]),
    done,
  };
}

/** Stop requests and manual markers from the caller, the hotkeys and the triggers. */
class Control {
  reason: StopReason | undefined;
  onMarker: ((label?: string) => void) | undefined;
  /** Pointer input inside these is not logged. */
  deadZones: Bounds[] = [];
  private waiters: ((reason: StopReason) => void)[] = [];

  /** The first request wins. */
  request(reason: StopReason): void {
```

with:

```ts
      return done;
    },
    marker: (label) => control.marker(label),
    pause: () => control.setPaused(true),
    resume: () => control.setPaused(false),
    setDeadZones: (zones) => (control.deadZones = [...zones]),
    done,
  };
}

/** Stop requests, pauses and manual markers from the caller, the hotkeys and the triggers. */
class Control {
  reason: StopReason | undefined;
  onMarker: ((label?: string) => void) | undefined;
  /** Pointer input inside these is not logged. */
  deadZones: Bounds[] = [];
  private waiters: ((reason: StopReason) => void)[] = [];
  /** Whether the caller wants the take paused: the newest `pause` or `resume` wins. */
  private paused = false;
  private pauseWaiters: { paused: boolean; resolve: () => void }[] = [];

  setPaused(paused: boolean): void {
    this.paused = paused;
    const ready = this.pauseWaiters.filter((waiter) => waiter.paused === paused);
    this.pauseWaiters = this.pauseWaiters.filter((waiter) => waiter.paused !== paused);
    for (const waiter of ready) waiter.resolve();
  }

  toggle(): void {
    this.setPaused(!this.paused);
  }

  /** Resolves once the take should be paused; at once when it already should. */
  pauseWanted(): Promise<'pause'> {
    return this.until(true).then(() => 'pause' as const);
  }

  /** Resolves once the take should record again; at once when it already should. */
  resumeWanted(): Promise<'resume'> {
    return this.until(false).then(() => 'resume' as const);
  }

  private until(paused: boolean): Promise<void> {
    if (this.paused === paused) return Promise.resolve();
    return new Promise((resolve) => this.pauseWaiters.push({ paused, resolve }));
  }

  /** The first request wins. */
  request(reason: StopReason): void {
```

In the same file, replace:

```ts
  claude: ClaudeTrigger | undefined;
}

async function recordTake({ options, control, platform, area, projectDir, dir, reporter, claude }: TakeContext): Promise<Take> {
  const path = (file: string) => join(dir, file);
  const rel = (file: string) => relative(projectDir, file).split(sep).join('/');
  let screenStart: number | undefined;

  const markers: Marker[] = [];
  let markersFailed = false;
```

with:

```ts
  claude: ClaudeTrigger | undefined;
}

/** One stretch of the take's capture processes, from a start (or resume) to a pause or the stop. */
interface Tracks {
  screen: CaptureProcess;
  webcam?: CaptureProcess;
  mic?: CaptureProcess;
  /** Rejects with the first capture that fails; never resolves. */
  failed: Promise<never>;
  /** This screen process's freeze detection (a new one starts unfrozen). */
  frozen: boolean;
}

const all = (tracks: Tracks) => [tracks.screen, tracks.webcam, tracks.mic].filter((capture): capture is CaptureProcess => capture !== undefined);

/** A track's file in segment `k` of a paused take: `screen.2.mp4`. */
const numbered = (file: string, k: number) => file.replace(/\.(mp4|m4a)$/, `.${k}.$1`);

async function recordTake({ options, control, platform, area, projectDir, dir, reporter, claude }: TakeContext): Promise<Take> {
  const path = (file: string) => join(dir, file);
  const rel = (file: string) => relative(projectDir, file).split(sep).join('/');
  /** The take's stretches between pauses; written to segments.json from the first pause on. */
  const segments: Segment[] = [];
  /** It was paused at least once: its segments are joined at the end. */
  let paused = false;
  /** Input is logged and the take's time runs only while every track records. */
  let capturing = false;
  /** Seconds recorded before the segment that runs now. */
  const recordedBefore = () => segments.reduce((sum, segment) => sum + (segment.duration ?? 0), 0);
  const recordedNow = () => {
    const last = segments.at(-1);
    return recordedBefore() + (capturing && last && last.duration === undefined ? now() - last.screen.start : 0);
  };

  const markers: Marker[] = [];
  let markersFailed = false;
```

In the same file, replace:

```ts
    }
  };
  const addMarker = (marker: Omit<Marker, 't'>, time: number) => {
    if (screenStart === undefined || time < screenStart) return; // nothing on screen yet
    const entry = { t: Math.round((time - screenStart) * 1000) / 1000, ...marker };
    markers.push(entry);
    markers.sort((a, b) => a.t - b.t);
    saveMarkers();
```

with:

```ts
    }
  };
  const addMarker = (marker: Omit<Marker, 't'>, time: number) => {
    // nothing on screen yet; while paused, where the take paused
    const t = takeTime(segments, time, true);
    if (t === undefined) return;
    const entry = { t: Math.round(t * 1000) / 1000, ...marker };
    markers.push(entry);
    markers.sort((a, b) => a.t - b.t);
    saveMarkers();
```

In the same file, replace:

```ts
  saveMarkers();
  control.onMarker = (label) => addMarker({ kind: 'manual', ...(label && { label }) }, now());

  const { size, origin } = areaGeometry(area);
  const events = openSync(path(FILES.events), 'a');
  let eventsOpen = true;
```

with:

```ts
  saveMarkers();
  control.onMarker = (label) => addMarker({ kind: 'manual', ...(label && { label }) }, now());

  const writeSegments = (joined = false) => {
    const file = path(FILES.segments);
    writeJson(`${file}.part`, { version: SEGMENTS_VERSION, segments, ...(joined && { joined }) } satisfies SegmentsFile);
    renameWhenFree(`${file}.part`, file);
  };

  const { size, origin } = areaGeometry(area);
  const events = openSync(path(FILES.events), 'a');
  let eventsOpen = true;
```

In the same file, replace:

```ts
    }
  }, origin);
  let lastInput = now();
  const captures: CaptureProcess[] = [];
  let input: InputSource | undefined;
  const cleanups: (() => void)[] = [];
```

with:

```ts
    }
  }, origin);
  let lastInput = now();
  /** Every capture started, so a failure stops the ones still running. */
  const captures: CaptureProcess[] = [];
  let input: InputSource | undefined;
  const cleanups: (() => void)[] = [];
```

In the same file, replace:

```ts
    input?.stop();
  };

  try {
    input = await startInput(
      platform,
      (raw) => {
        // Nothing after a stop was asked for, nothing over the app's own controls: no take shows the
        // pointer travelling to Stop or its click.
        if (control.reason !== undefined || inDeadZone(raw, control.deadZones)) return;
        lastInput = raw.time;
        writer.push(raw);
      },
      (action) => (action === 'stop' ? control.request('hotkey') : control.marker()),
    );
    const screen = spawnCapture('screen', screenArgs(screenInput(platform, area, options.drawMouse ?? false), path(FILES.screen), options.stop.untilIdleSeconds));
    captures.push(screen);
    const webcam = options.webcam === undefined ? undefined : spawnCapture('webcam', webcamArgs(webcamInput(platform, options.webcam), path(FILES.webcam)));
    if (webcam) captures.push(webcam);
    const mic = options.mic === undefined ? undefined : spawnCapture('mic', micArgs(micInput(platform, options.mic), path(FILES.mic)));
    if (mic) captures.push(mic);
    reporter.emit({ type: 'processes', pids: captures.map((capture) => capture.pid).filter((pid): pid is number => pid !== undefined) });

    // A freeze that starts at 0 means the screen has not changed yet: untilIdleSeconds waits for one
    // after a change, and for the input to rest as long (someone pointing at a still chart is not idle).
    let frozen = false;
    screen.onLine((line) => {
      const start = freezeStart(line);
      if (start !== undefined && start > 0) frozen = true;
      if (freezeEnd(line) !== undefined) frozen = false;
    });
    let micWarned = false;
    mic?.onLine((line) => {
      const start = silenceStart(line);
      if (start === undefined || start >= SILENCE_SECONDS || micWarned) return;
      micWarned = true;
      reporter.warn(`the microphone "${options.mic}" records silence: it may be muted, or blocked for desktop apps (Windows: Settings > Privacy & security > Microphone)`);
    });
    // Rejects with the first capture that fails; `exited` only resolves after stop() was called.
    const failed: Promise<never> = Promise.race(captures.map((capture) => capture.exited)).then(() => new Promise<never>(() => {}));
    failed.catch(() => {});

    // The screen track's start is the take's clock: input, markers and maxSeconds count from it.
    const screenAt = await startedWithin(Promise.race([screen.started, failed, control.stopped().then(() => undefined)]), 'screen');
    if (screenAt === undefined) throw cancelled('the screen track started');
    screenStart = screenAt;
    writer.setStart(screenAt, input.initial(screenAt));

    // The other tracks: a stop before they deliver anything leaves them out of the take.
    const starts: { webcam?: number; mic?: number } = {};
    void webcam?.started.then((at) => (starts.webcam = at), () => {});
    void mic?.started.then((at) => (starts.mic = at), () => {});
    const others = [webcam && 'webcam', mic && 'mic'].filter(Boolean).join(' and ');
    if (others !== '') await startedWithin(Promise.race([Promise.all([webcam?.started, mic?.started]), failed, control.stopped()]), others);
    // The tracks of this take: one that starts while the stop runs is left out of take.json and the Take alike.
    const begun = { ...starts };
    for (const [track, capture] of [['webcam', webcam], ['mic', mic]] as const) {
      if (capture && begun[track] === undefined) reporter.warn(`the ${track} had not started when the recording was stopped; it is left out of the take`);
    }
    writeJson(path(FILES.take), {
      version: TAKE_VERSION,
      tracks: {
        screen: { file: FILES.screen, start: screenAt },
        ...(begun.webcam !== undefined && { webcam: { file: FILES.webcam, start: begun.webcam } }),
        ...(begun.mic !== undefined && { mic: { file: FILES.mic, start: begun.mic - micLatency(platform) } }),
      },
    } satisfies TakeFile);
    reporter.emit({ type: 'recording', dir: rel(dir) });
    startTriggers(options.stop, screenAt, control, () => frozen && now() - lastInput >= (options.stop.untilIdleSeconds ?? Infinity), timer);
    claude?.attach((signal) => {
      addMarker({ kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) }, signal.time);
      if (signal.kind === 'answer') timer(() => control.request('claude'), CLAUDE_TAIL_SECONDS * 1000);
    });

    const reason = await Promise.race([control.stopped(), failed]);
    reporter.emit({ type: 'stopping', reason });
    finish();
    await Promise.all(captures.map((capture) => capture.stop()));
    writer.close();
    closeEvents();
    // A track that was left out has no file of this take.
    for (const [track, file] of [['webcam', FILES.webcam], ['mic', FILES.mic]] as const) {
      if ((track === 'webcam' ? webcam : mic) && begun[track] === undefined) removeQuietly(path(file));
    }
    if (markersFailed) saveMarkers();
    return {
      dir: rel(dir),
      screen: rel(path(FILES.screen)),
      ...(begun.webcam !== undefined && { webcam: rel(path(FILES.webcam)) }),
      ...(begun.mic !== undefined && { mic: rel(path(FILES.mic)) }),
      events: rel(path(FILES.events)),
      markers: rel(path(FILES.markers)),
      screenSize: size,
      seconds: screen.seconds() ?? now() - screenAt,
      stopReason: reason,
      warnings: reporter.warnings,
    };
  } catch (error) {
    finish();
    // The tracks that still run finish their files first; the take folder keeps what was recorded.
    await Promise.allSettled(captures.map((capture) => capture.stop()));
    writer.close();
    closeEvents();
    if (screenStart === undefined) {
      removeQuietly(dir); // nothing on screen: no take
      throw error instanceof RecorderError ? error : new RecorderError('capture', `the recording failed: ${message(error)}`, { cause: error });
    }
```

with:

```ts
    input?.stop();
  };

  let micWarned = false;
  /** The capture processes of segment `k` (the first writes the take's own file names). */
  const spawnTracks = (k: number): Tracks => {
    const file = (name: string) => path(k === 1 ? name : numbered(name, k));
    const screen = spawnCapture('screen', screenArgs(screenInput(platform, area, options.drawMouse ?? false), file(FILES.screen), options.stop.untilIdleSeconds));
    const webcam = options.webcam === undefined ? undefined : spawnCapture('webcam', webcamArgs(webcamInput(platform, options.webcam), file(FILES.webcam)));
    const mic = options.mic === undefined ? undefined : spawnCapture('mic', micArgs(micInput(platform, options.mic), file(FILES.mic)));
    // Rejects with the first capture that fails; `exited` only resolves after stop() was called.
    const failed: Promise<never> = Promise.race([screen, webcam, mic].filter((capture) => capture !== undefined).map((capture) => capture.exited)).then(() => new Promise<never>(() => {}));
    failed.catch(() => {});
    const tracks: Tracks = { screen, ...(webcam && { webcam }), ...(mic && { mic }), failed, frozen: false };
    captures.push(...all(tracks));
    reporter.emit({ type: 'processes', pids: all(tracks).map((capture) => capture.pid).filter((pid): pid is number => pid !== undefined) });
    // A freeze that starts at 0 means the screen has not changed yet: untilIdleSeconds waits for one
    // after a change, and for the input to rest as long (someone pointing at a still chart is not idle).
    screen.onLine((line) => {
      const start = freezeStart(line);
      if (start !== undefined && start > 0) tracks.frozen = true;
      if (freezeEnd(line) !== undefined) tracks.frozen = false;
    });
    mic?.onLine((line) => {
      const start = silenceStart(line);
      if (start === undefined || start >= SILENCE_SECONDS || micWarned) return;
      micWarned = true;
      reporter.warn(`the microphone "${options.mic}" records silence: it may be muted, or blocked for desktop apps (Windows: Settings > Privacy & security > Microphone)`);
    });
    return tracks;
  };

  /**
   * Starts segment `k` and waits until its screen runs and its other tracks do, or a stop comes.
   * Undefined when the stop came before the screen's first frame. A track that has not started by
   * the stop is left out of the segment (and its file removed).
   */
  const startSegment = async (k: number): Promise<{ tracks: Tracks; segment: Segment } | { tracks: Tracks; segment: undefined }> => {
    const tracks = spawnTracks(k);
    const screenAt = await startedWithin(Promise.race([tracks.screen.started, tracks.failed, control.stopped().then(() => undefined)]), 'screen');
    if (screenAt === undefined) return { tracks, segment: undefined };
    const starts: { webcam?: number; mic?: number } = {};
    void tracks.webcam?.started.then((at) => (starts.webcam = at), () => {});
    void tracks.mic?.started.then((at) => (starts.mic = at), () => {});
    const others = [tracks.webcam && 'webcam', tracks.mic && 'mic'].filter(Boolean).join(' and ');
    if (others !== '') await startedWithin(Promise.race([Promise.all([tracks.webcam?.started, tracks.mic?.started]), tracks.failed, control.stopped()]), others);
    const begun = { ...starts };
    const name = (file: string) => (k === 1 ? file : numbered(file, k));
    for (const track of ['webcam', 'mic'] as const) {
      if (tracks[track] && begun[track] === undefined) reporter.warn(`the ${track} had not started when the recording was stopped; it is left out of the take`);
    }
    return {
      tracks,
      segment: {
        screen: { file: name(FILES.screen), start: screenAt },
        ...(begun.webcam !== undefined && { webcam: { file: name(FILES.webcam), start: begun.webcam } }),
        // the mic's stamp is when its first buffer arrived: its first sample came that much earlier
        ...(begun.mic !== undefined && { mic: { file: name(FILES.mic), start: begun.mic - micLatency(platform) } }),
      },
    };
  };

  /** Removes the files of `tracks` that `segment` does not list (they had not started). */
  const removeUnlisted = (k: number, segment: Segment | undefined) => {
    for (const [track, file] of [['screen', FILES.screen], ['webcam', FILES.webcam], ['mic', FILES.mic]] as const) {
      if (!segment?.[track]) removeQuietly(path(k === 1 ? file : numbered(file, k)));
    }
  };

  /** The screen file's length, to ffmpeg's 10 ms (what joining it end to end uses). */
  const lengthOf = async (file: string, fallback: number) => (await mediaInfo(path(file), 'v').catch(() => undefined))?.seconds || fallback;

  let tracks: Tracks | undefined;
  let k = 1;
  try {
    input = await startInput(
      platform,
      (raw) => {
        // Nothing while paused, nothing after a stop was asked for, nothing over the app's own
        // controls: no take shows the pointer travelling to Stop or its click.
        if (!capturing || control.reason !== undefined || inDeadZone(raw, control.deadZones)) return;
        lastInput = raw.time;
        writer.push(raw);
      },
      (action) => (action === 'stop' ? control.request('hotkey') : action === 'pause' ? control.toggle() : control.marker()),
    );

    // The screen track's start is the take's clock: input, markers and maxSeconds count from it.
    const first = await startSegment(1);
    tracks = first.tracks;
    if (!first.segment) throw cancelled('the screen track started');
    const screenAt = first.segment.screen.start;
    segments.push(first.segment);
    writer.setStart(screenAt, input.initial(screenAt));
    const begun = first.segment;
    writeJson(path(FILES.take), {
      version: TAKE_VERSION,
      tracks: {
        screen: { file: FILES.screen, start: screenAt },
        ...(begun.webcam && { webcam: { file: FILES.webcam, start: begun.webcam.start } }),
        ...(begun.mic && { mic: { file: FILES.mic, start: begun.mic.start } }),
      },
    } satisfies TakeFile);
    capturing = true;
    reporter.emit({ type: 'recording', dir: rel(dir) });
    // Claude's answer stops the take a little after it; while paused, a little after the resume.
    let claudeStop = false;
    const stopForClaude = () => timer(() => control.request('claude'), CLAUDE_TAIL_SECONDS * 1000);
    startTriggers(options.stop, recordedNow, control, () => capturing && tracks !== undefined && tracks.frozen && now() - lastInput >= (options.stop.untilIdleSeconds ?? Infinity), timer);
    claude?.attach((signal) => {
      addMarker({ kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) }, signal.time);
      if (signal.kind !== 'answer' || claudeStop) return;
      claudeStop = true;
      if (capturing) stopForClaude();
    });

    let reason: StopReason;
    let running = true;
    for (;;) {
      const next = await Promise.race([control.stopped(), tracks.failed, control.pauseWanted()]);
      if (next !== 'pause') {
        reason = next;
        break;
      }
      // Pause: every track finishes its file; the take's time stands still.
      capturing = false;
      await Promise.all(all(tracks).map((capture) => capture.stop()));
      running = false;
      const segment = segments.at(-1)!;
      segment.duration = await lengthOf(segment.screen.file, now() - segment.screen.start);
      if (!paused) {
        // the first pause: the first segment's files get their number too
        paused = true;
        for (const track of ['screen', 'webcam', 'mic'] as const) {
          const entry = segment[track];
          if (!entry) continue;
          renameWhenFree(path(entry.file), path(numbered(entry.file, 1)));
          entry.file = numbered(entry.file, 1);
        }
      }
      writeSegments();
      reporter.emit({ type: 'paused' });
      const after = await Promise.race([control.stopped(), control.resumeWanted()]);
      if (after !== 'resume') {
        reason = after;
        break;
      }
      // Resume: the next segment's tracks start; its input counts on from where the take paused.
      k++;
      reporter.emit({ type: 'resuming' });
      const resumed = await startSegment(k);
      tracks = resumed.tracks;
      running = true;
      if (!resumed.segment) {
        // stopped before the screen started again: that segment is not part of the take
        await Promise.allSettled(all(tracks).map((capture) => capture.stop()));
        running = false;
        removeUnlisted(k, undefined);
        reason = control.reason ?? 'stop';
        break;
      }
      const offset = recordedBefore();
      segments.push(resumed.segment);
      writeSegments();
      writer.setStart(resumed.segment.screen.start - offset, input.initial(resumed.segment.screen.start));
      lastInput = now();
      capturing = true;
      reporter.emit({ type: 'resumed' });
      if (claudeStop) stopForClaude();
    }
    reporter.emit({ type: 'stopping', reason });
    capturing = false;
    finish();
    if (running) {
      await Promise.all(all(tracks).map((capture) => capture.stop()));
      removeUnlisted(k, segments.at(-1));
    }
    writer.close();
    closeEvents();
    if (markersFailed) saveMarkers();
    const last = segments.at(-1)!;
    if (paused && last.duration === undefined) last.duration = await lengthOf(last.screen.file, now() - last.screen.start);
    const has = paused ? await joinTake() : { webcam: last.webcam !== undefined, mic: last.mic !== undefined };
    return {
      dir: rel(dir),
      screen: rel(path(FILES.screen)),
      ...(has.webcam && { webcam: rel(path(FILES.webcam)) }),
      ...(has.mic && { mic: rel(path(FILES.mic)) }),
      events: rel(path(FILES.events)),
      markers: rel(path(FILES.markers)),
      screenSize: size,
      seconds: paused ? recordedBefore() : (tracks.screen.seconds() ?? now() - segments[0]!.screen.start),
      stopReason: reason,
      warnings: reporter.warnings,
    };
  } catch (error) {
    capturing = false;
    finish();
    // The tracks that still run finish their files first; the take folder keeps what was recorded.
    await Promise.allSettled(captures.map((capture) => capture.stop()));
    writer.close();
    closeEvents();
    if (segments.length === 0) {
      removeQuietly(dir); // nothing on screen: no take
      throw error instanceof RecorderError ? error : new RecorderError('capture', `the recording failed: ${message(error)}`, { cause: error });
    }
```

In the same file, replace:

```ts
    control.onMarker = undefined;
    closeEvents();
  }
}

/** Removes a file or folder of the take; a lock (a virus scanner, OneDrive) must not turn a result into a failure. */
```

with:

```ts
    control.onMarker = undefined;
    closeEvents();
  }

  /**
   * Joins the segments into the take's own files, lined up (a new take.json says they start
   * together), marks segments.json joined, and removes the segments' files.
   */
  async function joinTake(): Promise<{ webcam: boolean; mic: boolean }> {
    const has = await joinSegments(dir, segments, { screen: FILES.screen, webcam: FILES.webcam, mic: FILES.mic });
    const start = segments[0]!.screen.start;
    writeJson(path(FILES.take), {
      version: TAKE_VERSION,
      tracks: {
        screen: { file: FILES.screen, start },
        ...(has.webcam && { webcam: { file: FILES.webcam, start } }),
        ...(has.mic && { mic: { file: FILES.mic, start } }),
      },
    } satisfies TakeFile);
    writeSegments(true);
    for (const segment of segments) for (const track of ['screen', 'webcam', 'mic'] as const) if (segment[track]) removeQuietly(path(segment[track].file));
    removeQuietly(path('segments.txt'));
    return has;
  }
}

/** Removes a file or folder of the take; a lock (a virus scanner, OneDrive) must not turn a result into a failure. */
```

In the same file, replace:

```ts
  }
}

/** Starts the time, file and idle triggers on `timer`, which stops them with the take. `maxSeconds` counts from the screen's start. */
function startTriggers(
  stop: StopOptions,
  screenAt: number,
  control: Control,
  idle: () => boolean,
  timer: (callback: () => void, ms: number, repeat?: boolean) => void,
): void {
  if (stop.maxSeconds !== undefined) timer(() => control.request('max-seconds'), Math.max(0, (screenAt + stop.maxSeconds - now()) * 1000));
  if (stop.untilFile !== undefined) {
    const file = resolve(stop.untilFile);
    timer(() => existsSync(file) && control.request('file'), FILE_POLL_MS, true);
```

with:

```ts
  }
}

/** Starts the time, file and idle triggers on `timer`, which stops them with the take. `maxSeconds` counts the take's time (`recorded`), not its pauses. */
function startTriggers(
  stop: StopOptions,
  recorded: () => number,
  control: Control,
  idle: () => boolean,
  timer: (callback: () => void, ms: number, repeat?: boolean) => void,
): void {
  const max = stop.maxSeconds;
  if (max !== undefined) timer(() => recorded() >= max && control.request('max-seconds'), MAX_POLL_MS, true);
  if (stop.untilFile !== undefined) {
    const file = resolve(stop.untilFile);
    timer(() => existsSync(file) && control.request('file'), FILE_POLL_MS, true);
```

In `apps/cli/src/commands/record.ts`, replace:

```ts
    backend: args.backend,
    onEvent(event) {
      if (event.type === 'countdown') output.info(`recording in ${event.seconds} …`);
      if (event.type === 'recording') output.info(`recording ${event.dir}; stop: Ctrl+C or ${HOTKEYS.stop}, marker: ${HOTKEYS.marker}`);
      if (event.type === 'marker') output.info(`marker ${event.marker.kind}${event.marker.label ? ` ${event.marker.label}` : ''} at ${event.marker.t.toFixed(2)} s`);
      if (event.type === 'warning') output.warn(event.message);
      if (event.type === 'stopping') output.info(`stopping (${event.reason}) …`);
```

with:

```ts
    backend: args.backend,
    onEvent(event) {
      if (event.type === 'countdown') output.info(`recording in ${event.seconds} …`);
      if (event.type === 'recording') output.info(`recording ${event.dir}; stop: Ctrl+C or ${HOTKEYS.stop}, marker: ${HOTKEYS.marker}, pause: ${HOTKEYS.pause}`);
      if (event.type === 'paused') output.info(`paused: nothing is recorded until ${HOTKEYS.pause} again`);
      if (event.type === 'resuming') output.info('resuming …');
      if (event.type === 'resumed') output.info('recording again');
      if (event.type === 'marker') output.info(`marker ${event.marker.kind}${event.marker.label ? ` ${event.marker.label}` : ''} at ${event.marker.t.toFixed(2)} s`);
      if (event.type === 'warning') output.warn(event.message);
      if (event.type === 'stopping') output.info(`stopping (${event.reason}) …`);
```

- [ ] **Step 4: Run the recorder's tests and the typecheck**

Run: `pnpm exec vitest run --project node packages/recorder`
Expected: PASS, 82 tests, 1 skipped (the real-capture test, which runs only in `vitest --mode real`).

Run: `pnpm exec tsc -p packages/recorder/tsconfig.json`
Expected: exits with code 0, no output.

Run: `pnpm exec tsc -p apps/cli/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 5: Commit**

```bash
git add packages/recorder apps/cli/src/commands/record.ts
git commit -m "recorder: pause by segments (every track stops, new files at the resume, take time), joined in step at the stop; Ctrl+Shift+Alt+P

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Recover a paused take, and Claude's markers in take time

**Files:**
- Create: `packages/core/test/recover.test.ts`
- Modify: `packages/core/src/{recover,suggest}.ts`, `packages/core/src/suggest/transcript.ts`, `packages/core/test/transcript.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/recover.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseSegmentsJson } from '@cuttle/project';
import { recoverTake } from '../src/recover';
import { runFfmpeg } from '../src/ffmpeg';
import { streamSeconds } from '../src/suggest/media';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const FRAGMENTED = ['-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4'];
const video = (file: string, seconds: number) => runFfmpeg(['-f', 'lavfi', '-i', `testsrc2=s=320x240:r=30:d=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ...FRAGMENTED, '-y', file]);
const audio = (file: string, seconds: number) => runFfmpeg(['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`, '-c:a', 'aac', ...FRAGMENTED, '-y', file]);

describe('recoverTake', () => {
  it('joins a paused take the recorder never joined (it ended during the take), the last segment measured', async () => {
    const project = mkdtempSync(join(tmpdir(), 'cuttle-recover-'));
    dirs.push(project);
    const take = join(project, 'takes', '1');
    mkdirSync(take, { recursive: true });
    await Promise.all([video(join(take, 'screen.1.mp4'), 2), audio(join(take, 'mic.1.m4a'), 2), video(join(take, 'screen.2.mp4'), 1.5), audio(join(take, 'mic.2.m4a'), 1.4)]);
    // as the recorder left it: the second segment still recording (no length), take.json naming the joined file to be
    writeFileSync(
      join(take, 'segments.json'),
      JSON.stringify({
        version: 1,
        segments: [
          { screen: { file: 'screen.1.mp4', start: 1000 }, mic: { file: 'mic.1.m4a', start: 1000 }, duration: 2 },
          { screen: { file: 'screen.2.mp4', start: 1010 }, mic: { file: 'mic.2.m4a', start: 1010.1 } },
        ],
      }),
    );
    writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 }, mic: { file: 'mic.m4a', start: 1000 } } }));
    writeFileSync(join(take, 'events.jsonl'), '');
    writeFileSync(join(take, 'markers.json'), JSON.stringify({ version: 1, markers: [] }));

    const result = await recoverTake(project, 'takes/1');
    expect(result.repaired).toContain('joined the 2 segments of the paused take');
    expect(result.seconds).toBeCloseTo(3.5, 1);
    expect(result.tracks).toEqual(['screen', 'mic']);
    expect(await streamSeconds(join(take, 'mic.m4a'), 'a')).toBeCloseTo(3.5, 1);
    const manifest = parseSegmentsJson(readFileSync(join(take, 'segments.json'), 'utf8'));
    expect(manifest.ok && manifest.segments.joined).toBe(true);
    expect(manifest.ok && manifest.segments.segments[1]!.duration).toBeCloseTo(1.5, 1);
    expect(readdirSync(take).filter((name) => /\.\d\./.test(name))).toEqual([]);
    expect(JSON.parse(readFileSync(join(project, 'cuttle.json'), 'utf8')).sources.screen).toBe('takes/1/screen.mp4');
    // a second recover finds it joined: nothing to join again
    expect((await recoverTake(project, 'takes/1')).repaired).not.toContain('joined the 2 segments of the paused take');
    expect(existsSync(join(take, 'screen.mp4'))).toBe(true);
  }, 60_000);
});
```

In `packages/core/test/transcript.test.ts`, replace:

```ts
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { claudeTranscriptDir } from '@cuttle/recorder';
import { transcriptMarkers } from '../src/suggest/transcript';

const config = mkdtempSync(join(tmpdir(), 'cuttle-transcript-'));
afterAll(() => rm(config, { recursive: true, force: true }));
```

with:

```ts
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { claudeTranscriptDir } from '@cuttle/recorder';
import { takeClock, transcriptMarkers } from '../src/suggest/transcript';

const config = mkdtempSync(join(tmpdir(), 'cuttle-transcript-'));
afterAll(() => rm(config, { recursive: true, force: true }));
```

In the same file, replace:

```ts
      ].join(''),
    );
    writeFileSync(join(dir, 'other.jsonl'), answer(5, 'o1'));
    expect(await transcriptMarkers(cwd, 1000, 60)).toEqual([
      { t: 2, kind: 'prompt' },
      { t: 4, kind: 'tool', label: 'Bash' },
      { t: 9, kind: 'answer' },
```

with:

```ts
      ].join(''),
    );
    writeFileSync(join(dir, 'other.jsonl'), answer(5, 'o1'));
    expect(await transcriptMarkers(cwd, (wall) => wall - 1000, 60)).toEqual([
      { t: 2, kind: 'prompt' },
      { t: 4, kind: 'tool', label: 'Bash' },
      { t: 9, kind: 'answer' },
```

In the same file, replace:

```ts

  it('finds nothing in a folder without transcripts', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', config);
    expect(await transcriptMarkers(join(config, 'nowhere'), 1000, 60)).toEqual([]);
  });
});
```

with:

```ts

  it('finds nothing in a folder without transcripts', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', config);
    expect(await transcriptMarkers(join(config, 'nowhere'), (wall) => wall - 1000, 60)).toEqual([]);
  });

  it("follows a paused take's clock: a prompt during the pause lands where it paused", async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', config);
    const cwd = join(config, 'paused');
    const dir = claudeTranscriptDir(cwd);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'paused.jsonl'), [prompt(3), prompt(10), tool(22, 't1', 'Bash'), answer(23, 'a1')].join(''));
    const take = join(config, 'take');
    mkdirSync(take, { recursive: true });
    writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 } } }));
    // recorded 1000–1005, paused until 1020, then recording on
    writeFileSync(
      join(take, 'segments.json'),
      JSON.stringify({ version: 1, joined: true, segments: [{ screen: { file: 'screen.1.mp4', start: 1000 }, duration: 5 }, { screen: { file: 'screen.2.mp4', start: 1020 }, duration: 5 }] }),
    );
    const clock = (await takeClock(take))!;
    expect(await transcriptMarkers(cwd, clock, 10)).toEqual([
      { t: 3, kind: 'prompt' },
      { t: 5, kind: 'prompt' },
      { t: 7, kind: 'tool', label: 'Bash' },
      { t: 8, kind: 'answer' },
    ]);
  });
});
```

Run: `pnpm exec vitest run --project node packages/core/test/recover.test.ts packages/core/test/transcript.test.ts`
Expected: FAIL, 3 tests: `takeClock is not a function`, and `recover` leaves the paused take unjoined.

- [ ] **Step 2: Recover and the take's clock**

In `packages/core/src/recover.ts`, replace:

```ts
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, parseEventsJsonl, parseMarkersJson, parseTakeJson, type TakeFile } from '@cuttle/project';
import { CoreError } from './errors';
import { backupFile, newProjectFile, projectExists, readProjectFile, writeProjectFile } from './project-file';
import { streamSeconds } from './suggest/media';
```

with:

```ts
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, parseEventsJsonl, parseMarkersJson, parseSegmentsJson, parseTakeJson, type Segment, type TakeFile } from '@cuttle/project';
import { joinSegments } from '@cuttle/recorder';
import { CoreError } from './errors';
import { backupFile, newProjectFile, projectExists, readProjectFile, writeProjectFile } from './project-file';
import { streamSeconds } from './suggest/media';
```

In the same file, replace:

```ts
  backup?: string;
}

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json' };

/**
 * Recovers a take (a folder relative to the project, e.g. takes/3): makes it usable after
```

with:

```ts
  backup?: string;
}

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json', segments: 'segments.json' };

/**
 * Recovers a take (a folder relative to the project, e.g. takes/3): makes it usable after
```

In the same file, replace:

```ts
  const source = (name: string) => `${rel.split(sep).join('/')}/${name}`;
  const repaired: string[] = [];

  const seconds = await streamSeconds(path(FILES.screen), 'v');
  if (seconds <= 0) throw new CoreError('invalid-media', `${path(FILES.screen)} is missing or has no readable video; nothing to recover`);
  const webcam = existsSync(path(FILES.webcam)) && (await streamSeconds(path(FILES.webcam), 'v')) > 0;
```

with:

```ts
  const source = (name: string) => `${rel.split(sep).join('/')}/${name}`;
  const repaired: string[] = [];

  await joinPaused(dir, repaired);
  const seconds = await streamSeconds(path(FILES.screen), 'v');
  if (seconds <= 0) throw new CoreError('invalid-media', `${path(FILES.screen)} is missing or has no readable video; nothing to recover`);
  const webcam = existsSync(path(FILES.webcam)) && (await streamSeconds(path(FILES.webcam), 'v')) > 0;
```

In the same file, replace:

```ts
  return result;
}

/** The track start times in a take.json that fails the schema but is still JSON. */
function readableStarts(text: string | undefined): Partial<Record<'screen' | 'webcam' | 'mic', number>> {
  try {
```

with:

```ts
  return result;
}

/**
 * A take that was paused and never joined (the recorder ended during it): its segments are joined
 * from segments.json as the recorder would have, lined up by their stamps. A segment without
 * readable video is left out, a track without readable media is left out of its segment, and the
 * last segment's length is measured (it was still recording).
 */
async function joinPaused(dir: string, repaired: string[]): Promise<void> {
  const manifest = join(dir, FILES.segments);
  const parsed = existsSync(manifest) ? parseSegmentsJson(await readFile(manifest, 'utf8')) : undefined;
  if (!parsed?.ok || parsed.segments.joined) return;
  const segments: Segment[] = [];
  for (const [index, segment] of parsed.segments.segments.entries()) {
    const seconds = await streamSeconds(join(dir, segment.screen.file), 'v');
    if (seconds <= 0) {
      repaired.push(`left out segment ${index + 1} of the paused take: ${segment.screen.file} has no readable video`);
      continue;
    }
    const kept: Segment = { ...segment, duration: segment.duration ?? seconds };
    for (const [track, stream] of [['webcam', 'v'], ['mic', 'a']] as const) {
      const entry = kept[track];
      if (entry && (await streamSeconds(join(dir, entry.file), stream)) <= 0) {
        delete kept[track];
        repaired.push(`left out ${entry.file}: it has nothing readable`);
      }
    }
    segments.push(kept);
  }
  if (segments.length === 0) return;
  const has = await joinSegments(dir, segments, { screen: FILES.screen, webcam: FILES.webcam, mic: FILES.mic });
  const start = segments[0]!.screen.start;
  const take: TakeFile = {
    version: TAKE_VERSION,
    tracks: {
      screen: { file: FILES.screen, start },
      ...(has.webcam && { webcam: { file: FILES.webcam, start } }),
      ...(has.mic && { mic: { file: FILES.mic, start } }),
    },
  };
  await writeFile(join(dir, FILES.take), `${JSON.stringify(take, null, 2)}\n`);
  await writeFile(manifest, `${JSON.stringify({ ...parsed.segments, segments, joined: true }, null, 2)}\n`);
  for (const segment of parsed.segments.segments) for (const track of ['screen', 'webcam', 'mic'] as const) if (segment[track]) await rm(join(dir, segment[track].file), { force: true });
  await rm(join(dir, 'segments.txt'), { force: true });
  repaired.push(`joined the ${segments.length} segments of the paused take`);
}

/** The track start times in a take.json that fails the schema but is still JSON. */
function readableStarts(text: string | undefined): Partial<Record<'screen' | 'webcam' | 'mic', number>> {
  try {
```

In `packages/core/src/suggest/transcript.ts`, replace:

```ts
// recorder existed): read from the transcripts of the folder Claude ran in.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Marker } from '@cuttle/project';
import { claudeTranscriptDir, SessionReader, type ClaudeSignal } from '@cuttle/recorder';

/**
 * The prompt, tool-call and answer markers of the session that was most active while the take ran
 * (`start`: the screen track's start in wall-clock seconds, `duration` its length), in source seconds.
 */
export async function transcriptMarkers(cwd: string, start: number, duration: number): Promise<Marker[]> {
  const dir = claudeTranscriptDir(cwd);
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith('.jsonl'));
  let best: Marker[] = [];
```

with:

```ts
// recorder existed): read from the transcripts of the folder Claude ran in.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSegmentsJson, parseTakeJson, takeTime, type Marker } from '@cuttle/project';
import { claudeTranscriptDir, SessionReader, type ClaudeSignal } from '@cuttle/recorder';

/**
 * The prompt, tool-call and answer markers of the session that was most active while the take ran,
 * in source seconds. `clock` turns a wall-clock time into the take's seconds (undefined: not during
 * the take; `takeClock` gives it), `duration` is the take's length.
 */
export async function transcriptMarkers(cwd: string, clock: (wall: number) => number | undefined, duration: number): Promise<Marker[]> {
  const dir = claudeTranscriptDir(cwd);
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith('.jsonl'));
  let best: Marker[] = [];
```

In the same file, replace:

```ts
    const markers: Marker[] = [];
    for (const line of text.split('\n')) {
      for (const signal of reader.read(line)) {
        const t = signal.time - start;
        if (t < 0 || t > duration || duplicate(signal, seen)) continue;
        markers.push({ t: Math.round(t * 1000) / 1000, kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) });
      }
    }
```

with:

```ts
    const markers: Marker[] = [];
    for (const line of text.split('\n')) {
      for (const signal of reader.read(line)) {
        const t = clock(signal.time);
        if (t === undefined || t < 0 || t > duration || duplicate(signal, seen)) continue;
        markers.push({ t: Math.round(t * 1000) / 1000, kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) });
      }
    }
```

In the same file, replace:

```ts
  return best.sort((a, b) => a.t - b.t);
}

function duplicate(signal: ClaudeSignal, seen: Set<string>): boolean {
  if (signal.id === undefined) return false;
  const key = `${signal.kind}:${signal.id}`;
```

with:

```ts
  return best.sort((a, b) => a.t - b.t);
}

/**
 * The take's clock: the screen track's start from take.json, and for a paused take its segments
 * (segments.json), where a moment of a pause counts as the moment it paused. Undefined without a
 * readable take.json (or one rebuilt by recover without a start).
 */
export async function takeClock(takeDir: string): Promise<((wall: number) => number | undefined) | undefined> {
  const take = parseTakeJson(await readFile(join(takeDir, 'take.json'), 'utf8').catch(() => ''));
  if (!take.ok || take.take.tracks.screen.start === 0) return undefined;
  const start = take.take.tracks.screen.start;
  const manifest = parseSegmentsJson(await readFile(join(takeDir, 'segments.json'), 'utf8').catch(() => ''));
  if (manifest.ok) return (wall) => takeTime(manifest.segments.segments, wall, true);
  return (wall) => wall - start;
}

function duplicate(signal: ClaudeSignal, seen: Set<string>): boolean {
  if (signal.id === undefined) return false;
  const key = `${signal.kind}:${signal.id}`;
```

In `packages/core/src/suggest.ts`, replace:

```ts
import { analyseScreen, grabGray } from './suggest/media';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { transcriptMarkers } from './suggest/transcript';

export interface SuggestOptions {
  /** The folder Claude Code ran in (true: the current folder), for a take without Claude markers. */
```

with:

```ts
import { analyseScreen, grabGray } from './suggest/media';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { takeClock, transcriptMarkers } from './suggest/transcript';

export interface SuggestOptions {
  /** The folder Claude Code ran in (true: the current folder), for a take without Claude markers. */
```

In the same file, replace:

```ts
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
```

with:

```ts
  let from: SuggestResult['markers']['from'] = markers.length > 0 ? 'take' : 'none';
  if (args.claude !== undefined && !markers.some((marker) => marker.kind !== 'manual')) {
    const cwd = args.claude === true ? process.cwd() : resolve(args.claude);
    await screenStart(dirname(screen)); // refuses a take without take.json
    const clock = await takeClock(dirname(screen));
    const found = clock ? await transcriptMarkers(cwd, clock, screenInfo.duration) : [];
    if (found.length > 0) {
      markers = [...markers, ...found].sort((a, b) => a.t - b.t);
      from = 'transcript';
    } else {
      notes.push(
        clock === undefined
          ? "no Claude markers: take.json has no start time (it was rebuilt by recover), so the transcript cannot be matched"
          : `no Claude markers: no Claude Code session in ${cwd} prompted, called a tool or answered during the take`,
      );
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/core/test/recover.test.ts packages/core/test/transcript.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm exec tsc -p packages/core/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 4: Commit**

```bash
git add packages/core
git commit -m "core: recover joins a paused take; Claude's transcript markers in take time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The packaged CLI and the skill's install hint

**Files:**
- Create: `apps/desktop/src/main/cli-path.ts`, `apps/desktop/src/main/entry.ts`
- Modify: `apps/cli/src/electron-runner.ts`, `apps/desktop/vite.main.config.ts`, `apps/desktop/scripts/package.mjs`, `package.json`, `skill/cuttle/SKILL.md`, `skill/install.mjs`

- [ ] **Step 1: The CLI runs its Electron part through the app when the app says so**

In `apps/cli/src/electron-runner.ts`, replace:

```ts
 * missing, runs Electron's installer with its output on stderr.
 */
function electronBinary(): string {
  let dir: string;
  try {
    dir = dirname(createRequire(import.meta.url).resolve('electron/package.json'));
```

with:

```ts
 * missing, runs Electron's installer with its output on stderr.
 */
function electronBinary(): string {
  // The Cuttle app's copy of the CLI: the app is the Electron (its shim says which)
  if (process.env.CUTTLE_ELECTRON) return process.env.CUTTLE_ELECTRON;
  let dir: string;
  try {
    dir = dirname(createRequire(import.meta.url).resolve('electron/package.json'));
```

In the same file, replace:

```ts
  return new Promise((resolve, reject) => {
    const binary = electronBinary(); // may download Electron first
    if (signal.aborted) return reject(new CliError('cancelled', 'cancelled before Electron started'));
    const child = spawn(binary, [electronEntry(), encodeRequest(request)], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'], windowsHide: true });
    child.stdout?.pipe(process.stderr);
    let response: ElectronResponse | undefined;
    child.on('message', (message: ResponseMessage) => {
```

with:

```ts
  return new Promise((resolve, reject) => {
    const binary = electronBinary(); // may download Electron first
    if (signal.aborted) return reject(new CliError('cancelled', 'cancelled before Electron started'));
    const entry = electronEntry();
    // Run as Node by the Cuttle app, the CLI must not pass that on to its Electron; the app runs the
    // CLI's Electron part instead of itself when CUTTLE_CLI_ELECTRON names it.
    const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env;
    if (process.env.CUTTLE_ELECTRON) env.CUTTLE_CLI_ELECTRON = entry;
    const child = spawn(binary, [entry, encodeRequest(request)], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'], windowsHide: true, env });
    child.stdout?.pipe(process.stderr);
    let response: ElectronResponse | undefined;
    child.on('message', (message: ResponseMessage) => {
```

`apps/desktop/src/main/cli-path.ts`:

```ts
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

/**
 * The app's own copy of the CLI: in a packaged app outside the archive (Node runs it, and it loads
 * the native modules unpacked beside it), else the repository's build ("pnpm cli:build"), found
 * from this bundle in apps/desktop/dist/main.
 */
export function cliEntry(): string {
  return app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'cli', 'cuttle.mjs') : fileURLToPath(new URL('../../../cli/dist/cuttle.mjs', import.meta.url));
}
```

`apps/desktop/src/main/entry.ts`:

```ts
// The main process's entry: the app, or the Electron part of the cuttle command the app installed.
// That command runs the app's own copy of the CLI with the app as Node; its renders, previews and
// page captures need Electron, and a packaged app has only itself, so the CLI starts the app with
// CUTTLE_CLI_ELECTRON naming the CLI's Electron entry (only the app's own copy is run).
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { cliEntry } from './cli-path';

const cli = process.env.CUTTLE_CLI_ELECTRON;
const real = (path: string) => {
  try {
    return realpathSync(path).toLowerCase();
  } catch {
    return undefined;
  }
};

if (cli !== undefined) {
  const own = join(dirname(cliEntry()), 'electron.mjs');
  if (real(cli) === undefined || real(cli) !== real(own)) {
    process.stderr.write(`CUTTLE_CLI_ELECTRON must name ${own}\n`);
    app.exit(1);
  } else {
    // a profile of its own: the app itself may be running with its own
    app.setPath('userData', join(app.getPath('userData'), 'cli'));
    await import(pathToFileURL(cli).href);
  }
} else {
  await import('./index');
}
```

In `apps/desktop/vite.main.config.ts`, replace:

```ts
    target: 'node22',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
        'media-worker': fileURLToPath(new URL('./src/workers/media.ts', import.meta.url)),
        'recorder-host': fileURLToPath(new URL('./src/workers/recorder.ts', import.meta.url)),
      },
```

with:

```ts
    target: 'node22',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./src/main/entry.ts', import.meta.url)),
        'media-worker': fileURLToPath(new URL('./src/workers/media.ts', import.meta.url)),
        'recorder-host': fileURLToPath(new URL('./src/workers/recorder.ts', import.meta.url)),
      },
```

- [ ] **Step 2: The app carries its CLI and the skill**

In `apps/desktop/scripts/package.mjs`, replace:

```js
// Packages the built app (apps/desktop/dist, from app:build:js) as an unpacked app folder in
// apps/desktop/build/Cuttle-<platform>-<arch>/: no installer, no signing. The native modules the
// recorder loads (koffi and uiohook-napi, with their prebuilt binaries for this platform) are
// copied next to the bundle and kept outside the asar archive.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
```

with:

```js
// Packages the built app (apps/desktop/dist, from app:build:js) as an unpacked app folder in
// apps/desktop/build/Cuttle-<platform>-<arch>/: no installer, no signing. The native modules the
// recorder loads (koffi and uiohook-napi, with their prebuilt binaries for this platform) are
// copied next to the bundle and kept outside the asar archive. So is the app's own copy of the CLI
// (apps/cli/dist, from cli:build): the cuttle command the app installs runs it with the app as Node,
// which cannot load modules from inside the archive. The skill's files go in for the same install.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
```

In the same file, replace:

```js
const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
const NATIVE = ['koffi', 'uiohook-napi'];

if (!existsSync(join(desktop, 'dist', 'main', 'index.mjs'))) throw new Error('apps/desktop/dist is missing: run "pnpm app:build:js" first');
rmSync(build, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
```

with:

```js
const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
const NATIVE = ['koffi', 'uiohook-napi'];

const cli = join(desktop, '..', 'cli', 'dist');
const skill = join(desktop, '..', '..', 'skill', 'cuttle');
if (!existsSync(join(desktop, 'dist', 'main', 'index.mjs'))) throw new Error('apps/desktop/dist is missing: run "pnpm app:build:js" first');
if (!existsSync(join(cli, 'cuttle.mjs'))) throw new Error('apps/cli/dist is missing: run "pnpm cli:build" first');
rmSync(build, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
```

In the same file, replace:

```js
}

cpSync(join(desktop, 'dist'), join(stage, 'dist'), { recursive: true });
cpSync(join(desktop, 'assets'), join(stage, 'assets'), { recursive: true });
writeFileSync(
  join(stage, 'package.json'),
```

with:

```js
}

cpSync(join(desktop, 'dist'), join(stage, 'dist'), { recursive: true });
cpSync(cli, join(stage, 'cli'), { recursive: true });
cpSync(skill, join(stage, 'skill'), { recursive: true, filter: (source) => source === skill || source.endsWith('.md') });
cpSync(join(desktop, 'assets'), join(stage, 'assets'), { recursive: true });
writeFileSync(
  join(stage, 'package.json'),
```

In the same file, replace:

```js
  platform: process.platform,
  arch: process.arch,
  icon: join(desktop, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
  asar: { unpack: '**/{*.node,*.dll}' },
  prune: false,
  overwrite: true,
  quiet: true,
```

with:

```js
  platform: process.platform,
  arch: process.arch,
  icon: join(desktop, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
  // the CLI and the native modules whole (with their package.json files), so Node resolves them
  asar: { unpack: '**/{*.node,*.dll}', unpackDir: `{cli,${[...modules.keys()].map((name) => `node_modules/${name}`).join(',')}}` },
  prune: false,
  overwrite: true,
  quiet: true,
```

In `package.json`, replace:

```json
    "app:build:js": "node apps/desktop/scripts/build.mjs",
    "app": "pnpm app:build:js && electron apps/desktop/dist/main/index.mjs",
    "app:check": "pnpm app:build:js && pnpm cli:build && vitest run --mode app apps/desktop/test/app.check.test.ts",
    "app:build": "pnpm app:build:js && node apps/desktop/scripts/package.mjs && vitest run --mode build apps/desktop/test/build.check.test.ts",
    "skill:install": "node skill/install.mjs",
    "skill:uninstall": "node skill/install.mjs --uninstall"
  },
```

with:

```json
    "app:build:js": "node apps/desktop/scripts/build.mjs",
    "app": "pnpm app:build:js && electron apps/desktop/dist/main/index.mjs",
    "app:check": "pnpm app:build:js && pnpm cli:build && vitest run --mode app apps/desktop/test/app.check.test.ts",
    "app:build": "pnpm app:build:js && pnpm cli:build && node apps/desktop/scripts/package.mjs && vitest run --mode build apps/desktop/test/build.check.test.ts",
    "skill:install": "node skill/install.mjs",
    "skill:uninstall": "node skill/install.mjs --uninstall"
  },
```

- [ ] **Step 3: The skill says how to get the command, for either install**

In `skill/cuttle/SKILL.md`, replace:

````markdown
cuttle --version
```

If the command is missing, ask the user to run `pnpm cli:install` in the cuttle repository
(`{{REPO}}`) and to open a new terminal. Recording and rendering also need ffmpeg on PATH
(Windows: `winget install Gyan.FFmpeg`). Recording works on Windows for now.

Give the project folder as an absolute path, `-C "<project>"`, for example
`-C "$HOME/cuttle-demos/<name>"` (a `~` inside quotes is not expanded). Use `--json` for every
````

with:

````markdown
cuttle --version
```

If the command is missing, {{INSTALL_CLI}}, and to open a new terminal. Recording and
rendering also need ffmpeg on PATH (Windows: `winget install Gyan.FFmpeg`). Recording works on
Windows for now.

Give the project folder as an absolute path, `-C "<project>"`, for example
`-C "$HOME/cuttle-demos/<name>"` (a `~` inside quotes is not expanded). Use `--json` for every
````

In the same file, replace:

```markdown
  markers. If that folder is the one you run in, tell the user not to write to you until the
  recording has stopped: your own next turn would end it.
- `--until-idle 5`: also ends once the screen and the input have rested 5 s.
- `--max <seconds>` is the safety net. The user can also stop with Ctrl+Shift+Alt+S and add a
  marker with Ctrl+Shift+Alt+M. Other sources: `--window "<part of the title>"`,
  `--region x,y,w,h` (pixels of `--monitor`). `--countdown 3` is the default.
- A project open in the Cuttle app is refused (`project-open`): the app records it itself
  ("Record again"). Ask the user to record there or to close it; `--force` only if they say so.
```

with:

```markdown
  markers. If that folder is the one you run in, tell the user not to write to you until the
  recording has stopped: your own next turn would end it.
- `--until-idle 5`: also ends once the screen and the input have rested 5 s.
- `--max <seconds>` is the safety net (it counts recorded time, not pauses). The user can also stop
  with Ctrl+Shift+Alt+S, add a marker with Ctrl+Shift+Alt+M and pause or resume with
  Ctrl+Shift+Alt+P (nothing is recorded while paused; the pieces are joined at the stop). Other
  sources: `--window "<part of the title>"`, `--region x,y,w,h` (pixels of `--monitor`).
  `--countdown 3` is the default.
- A project open in the Cuttle app is refused (`project-open`): the app records it itself
  ("Record again"). Ask the user to record there or to close it; `--force` only if they say so.
```

In `skill/install.mjs`, replace:

```js
const repoPath = repo.replace(/\\/g, '/');
for (const name of files) {
  // A function, so `$&` or `$'` in the path stays as it is.
  writeFileSync(join(target, name), readFileSync(join(source, name), 'utf8').replaceAll('{{REPO}}', () => repoPath));
}
console.log(`installed the cuttle skill in ${target} (${files.join(', ')})`);
console.log('Claude Code uses it when you ask for a demo or type /cuttle (a session that was already running may need /reload-skills); it needs the cuttle command: pnpm cli:install');
```

with:

```js
const repoPath = repo.replace(/\\/g, '/');
for (const name of files) {
  // A function, so `$&` or `$'` in the path stays as it is.
  const text = readFileSync(join(source, name), 'utf8').replaceAll('{{INSTALL_CLI}}', () => `ask the user to run \`pnpm cli:install\` in the cuttle repository (\`${repoPath}\`)`);
  writeFileSync(join(target, name), text.replaceAll('{{REPO}}', () => repoPath));
}
console.log(`installed the cuttle skill in ${target} (${files.join(', ')})`);
console.log('Claude Code uses it when you ask for a demo or type /cuttle (a session that was already running may need /reload-skills); it needs the cuttle command: pnpm cli:install');
```

- [ ] **Step 4: Run the skill's and the CLI's tests and the typecheck**

Run: `pnpm exec vitest run --project node skill`
Expected: PASS, 10 tests (the installed SKILL.md names this repository and `pnpm cli:install`).

Run: `pnpm exec tsc -p apps/cli/tsconfig.json`
Expected: exits with code 0, no output.

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/electron-runner.ts apps/desktop/src/main/cli-path.ts apps/desktop/src/main/entry.ts apps/desktop/vite.main.config.ts apps/desktop/scripts/package.mjs package.json skill
git commit -m "desktop: the packaged app carries its CLI and the skill; the CLI renders through the app (CUTTLE_ELECTRON)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The main process: pause and restart, the tools, the settings window

**Files:**
- Create: `apps/desktop/src/main/tools.ts`, `apps/desktop/src/main/settings-window.ts`, `apps/desktop/src/preload/settings.ts`
- Modify: `apps/desktop/src/shared/{ipc,channels,recording}.ts`, `apps/desktop/src/main/{index,recording,recorder-host,media-service,settings,tray,windows}.ts`, `apps/desktop/src/preload/bridge.ts`, `apps/desktop/src/workers/recorder.ts`, `apps/desktop/scripts/build.mjs`

- [ ] **Step 1: The contract**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts

/** What the HUD shows. */
export interface HudState {
  phase: 'countdown' | 'recording' | 'stopping';
  /** When the take started (epoch milliseconds). */
  startedAt?: number;
  markers: number;
  /** A warning in a few words ("Mic is silent: muted?"), or "Stopping…". */
  message?: string;
```

with:

```ts

/** What the HUD shows. */
export interface HudState {
  phase: 'countdown' | 'recording' | 'paused' | 'resuming' | 'stopping';
  /** When the running stretch started (epoch milliseconds); none while paused. */
  startedAt?: number;
  /** Seconds recorded before it (the take's time stands still while paused). */
  recorded?: number;
  markers: number;
  /** A warning in a few words ("Mic is silent: muted?"), or "Stopping…". */
  message?: string;
```

In the same file, replace:

```ts
  state?: 'working' | 'failed' | 'recording';
}

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const deviceName = z.string().min(1).max(512);
```

with:

```ts
  state?: 'working' | 'failed' | 'recording';
}

/** The tools around the app: ffmpeg, and for Claude Code the cuttle command and the skill. */
export interface ToolsStatus {
  /** ffmpeg where the OS's PATH has it now (or WinGet's links folder), with its version. */
  ffmpeg?: { path: string; version: string };
  /** A `cuttle` command on that PATH: the app's own copy (`ours`), or another (the repository's, say). */
  command?: { path: string; ours: boolean };
  /** The cuttle skill in Claude Code's config folder: put there by Cuttle, missing, or someone else's folder. */
  skill: { dir: string; state: 'installed' | 'missing' | 'other' };
  /** The app's command folder was just put on the user's PATH: a terminal opened before does not see it. */
  newTerminal?: boolean;
}

/** How motion is set: the OS's "reduce motion", or always on, or always off. */
export const MOTIONS = ['system', 'reduce', 'full'] as const;
export type Motion = (typeof MOTIONS)[number];

/** What the settings window shows. */
export interface SettingsView {
  projectsFolder: string;
  countdown: 0 | 3 | 5;
  /** The camera and microphone a new recording starts with (the picker's last choice). */
  camera?: string;
  mic?: string;
  launchAtLogin: boolean;
  motion: Motion;
  recent: { dir: string; name: string; opened: number }[];
  version: string;
}

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const deviceName = z.string().min(1).max(512);
```

In the same file, replace:

```ts
  // HUD
  'hud:stop': z.undefined(),
  'hud:marker': z.undefined(),
  // editor (editing)
  'project:save': z
    .strictObject({
```

with:

```ts
  // HUD
  'hud:stop': z.undefined(),
  'hud:marker': z.undefined(),
  'hud:pause': z.undefined(),
  'hud:resume': z.undefined(),
  /** Puts the take aside and records again with the same settings (the HUD asks for a press held 600 ms). */
  'hud:restart': z.undefined(),
  // editor (editing)
  'project:save': z
    .strictObject({
```

In the same file, replace:

```ts
  'project:reload': z.undefined(),
  /** The page has written its last edits (`project:closing`): the window may close. */
  'project:closed': z.undefined(),
} as const;

export type Request = keyof typeof REQUESTS;
```

with:

```ts
  'project:reload': z.undefined(),
  /** The page has written its last edits (`project:closing`): the window may close. */
  'project:closed': z.undefined(),
  /** Brings back the take a restart put aside (its folder inside `takes/.discarded`), as the project's take. */
  'project:undo-restart': z.string().min(1).max(4096),
  /** Opens the settings window. */
  'app:settings': z.undefined(),
  // settings and the first run
  'settings:get': z.undefined(),
  'settings:set': z.strictObject({
    countdown: z.union([z.literal(0), z.literal(3), z.literal(5)]).optional(),
    /** A device's name, or null for none. */
    camera: z.string().min(1).max(512).nullable().optional(),
    mic: z.string().min(1).max(512).nullable().optional(),
    launchAtLogin: z.boolean().optional(),
    motion: z.enum(MOTIONS).optional(),
  }),
  /** Asks for the projects folder (a folder dialog) and keeps it. */
  'settings:choose-folder': z.undefined(),
  'settings:devices': z.undefined(),
  /** The first run is done: the window closes and the pill shows. */
  'settings:welcomed': z.undefined(),
  'tools:status': z.undefined(),
  /** Looks for ffmpeg again (after `winget install`): found, the app uses it at once. */
  'tools:check': z.undefined(),
  /** Installs the cuttle command (the app's own copy of the CLI) and the Claude skill. */
  'tools:install': z.undefined(),
  'tools:copy': z.string().min(1).max(200),
  /** A recent project, by its folder (only folders in the recent list are accepted). */
  'recent:open': z.string().min(1).max(4096),
  'recent:reveal': z.string().min(1).max(4096),
  'recent:forget': z.string().min(1).max(4096),
  /** Renames a recent project's folder (not while it is open or recording). */
  'recent:rename': z.strictObject({ dir: z.string().min(1).max(4096), name: z.string().trim().min(1).max(120) }),
} as const;

export type Request = keyof typeof REQUESTS;
```

In the same file, replace:

```ts
  'picker:retry': void;
  'hud:stop': void;
  'hud:marker': void;
  /** Written (its new hash); or the file changed meanwhile (the version on disk now); or it could not be written. */
  'project:save': { hash: string } | { conflict: ProjectVersion & { origin: 'outside' | 'suggest' } } | { problem: string };
  /** An image chosen by the person, copied into the project when it lay outside (a path inside the project). */
```

with:

```ts
  'picker:retry': void;
  'hud:stop': void;
  'hud:marker': void;
  'hud:pause': void;
  'hud:resume': void;
  'hud:restart': void;
  /** Written (its new hash); or the file changed meanwhile (the version on disk now); or it could not be written. */
  'project:save': { hash: string } | { conflict: ProjectVersion & { origin: 'outside' | 'suggest' } } | { problem: string };
  /** An image chosen by the person, copied into the project when it lay outside (a path inside the project). */
```

In the same file, replace:

```ts
  'project:draft': void;
  'project:reload': void;
  'project:closed': void;
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
```

with:

```ts
  'project:draft': void;
  'project:reload': void;
  'project:closed': void;
  'project:undo-restart': void;
  'app:settings': void;
  'settings:get': SettingsView;
  'settings:set': SettingsView;
  'settings:choose-folder': SettingsView;
  /** The cameras and mics this machine has, or why they could not be listed. */
  'settings:devices': { cameras: string[]; mics: string[]; problem?: string };
  'settings:welcomed': void;
  'tools:status': ToolsStatus;
  'tools:check': ToolsStatus;
  /** What is installed now, and what could not be (said for people). */
  'tools:install': { status: ToolsStatus; problem?: string };
  'tools:copy': void;
  'recent:open': void;
  'recent:reveal': void;
  'recent:forget': SettingsView;
  /** The project's new folder, or why it could not be renamed. */
  'recent:rename': { dir: string } | { problem: string };
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
```

In the same file, replace:

```ts
  'project:file': ProjectFileEvent;
  /** The window is about to close: write the last edits, then `project:closed`. */
  'project:closing': Record<string, never>;
}

export type Event = keyof Events;

/** The bridge a preload exposes as `window.cuttle`. */
export interface Bridge {
  invoke<R extends Request>(channel: R, argument?: z.input<(typeof REQUESTS)[R]>): Promise<Responses[R]>;
```

with:

```ts
  'project:file': ProjectFileEvent;
  /** The window is about to close: write the last edits, then `project:closed`. */
  'project:closing': Record<string, never>;
  /** The take was restarted: the one before is kept in `discarded` (a folder relative to the project). */
  'project:restarted': { discarded: string };
  'settings:changed': SettingsView;
  /** Every window: how motion is set now (`data-motion` on the page's root). */
  'app:motion': Motion;
}

export type Event = keyof Events;

/** What a window sends with request `R`. */
export type RequestArgument<R extends Request> = z.input<(typeof REQUESTS)[R]>;

/** The bridge a preload exposes as `window.cuttle`. */
export interface Bridge {
  invoke<R extends Request>(channel: R, argument?: z.input<(typeof REQUESTS)[R]>): Promise<Responses[R]>;
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
      'project:draft',
      'project:reload',
      'project:closed',
    ],
    events: ['media:state', 'export:progress', 'export:end', 'project:status', 'project:file', 'project:closing'],
  },
  pill: {
    requests: ['pill:recent', 'pill:open', 'pill:hide', 'pill:menu', 'pill:record'],
    events: ['pill:recent'],
  },
  picker: {
    requests: ['picker:setup', 'picker:hover', 'picker:choices', 'picker:record', 'picker:cancel', 'picker:claude-folder', 'picker:retry'],
    events: ['picker:open', 'picker:active', 'picker:choices', 'picker:devices'],
  },
  hud: {
    requests: ['hud:stop', 'hud:marker'],
    events: ['hud:state'],
  },
  countdown: {
    requests: [],
    events: ['countdown:tick'],
  },
} as const satisfies Record<string, { requests: readonly Request[]; events: readonly Event[] }>;
```

with:

```ts
      'project:draft',
      'project:reload',
      'project:closed',
      'project:undo-restart',
      'app:settings',
    ],
    events: ['media:state', 'export:progress', 'export:end', 'project:status', 'project:file', 'project:closing', 'project:restarted', 'app:motion'],
  },
  pill: {
    requests: ['pill:recent', 'pill:open', 'pill:hide', 'pill:menu', 'pill:record'],
    events: ['pill:recent', 'app:motion'],
  },
  picker: {
    requests: ['picker:setup', 'picker:hover', 'picker:choices', 'picker:record', 'picker:cancel', 'picker:claude-folder', 'picker:retry'],
    events: ['picker:open', 'picker:active', 'picker:choices', 'picker:devices', 'app:motion'],
  },
  hud: {
    requests: ['hud:stop', 'hud:marker', 'hud:pause', 'hud:resume', 'hud:restart'],
    events: ['hud:state', 'app:motion'],
  },
  countdown: {
    requests: [],
    events: ['countdown:tick', 'app:motion'],
  },
  settings: {
    requests: [
      'settings:get',
      'settings:set',
      'settings:choose-folder',
      'settings:devices',
      'settings:welcomed',
      'tools:status',
      'tools:check',
      'tools:install',
      'tools:copy',
      'recent:open',
      'recent:reveal',
      'recent:forget',
      'recent:rename',
    ],
    events: ['settings:changed', 'app:motion'],
  },
} as const satisfies Record<string, { requests: readonly Request[]; events: readonly Event[] }>;
```

In `apps/desktop/src/shared/recording.ts`, replace:

```ts
  | { type: 'start'; options: Omit<RecordOptions, 'onEvent'> }
  | { type: 'stop' }
  | { type: 'marker'; label?: string }
  | { type: 'dead-zones'; zones: Bounds[] };

/** What the host answers and reports. */
```

with:

```ts
  | { type: 'start'; options: Omit<RecordOptions, 'onEvent'> }
  | { type: 'stop' }
  | { type: 'marker'; label?: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'dead-zones'; zones: Bounds[] };

/** What the host answers and reports. */
```

- [ ] **Step 2: Pause and restart in the host and the HUD's handlers**

In `apps/desktop/src/workers/recorder.ts`, replace:

```ts
    case 'marker':
      recording?.marker(data.label);
      return;
    case 'dead-zones':
      recording?.setDeadZones(data.zones);
      return;
```

with:

```ts
    case 'marker':
      recording?.marker(data.label);
      return;
    case 'pause':
      recording?.pause();
      return;
    case 'resume':
      recording?.resume();
      return;
    case 'dead-zones':
      recording?.setDeadZones(data.zones);
      return;
```

In `apps/desktop/src/main/recorder-host.ts`, replace:

```ts
  onEvent: (event: RecorderEvent) => void;
  resolve: (take: Take) => void;
  reject: (error: Error) => void;
  /** ffmpeg's process ids, reported by the recorder as the tracks start. */
  pids: number[];
}
```

with:

```ts
  onEvent: (event: RecorderEvent) => void;
  resolve: (take: Take) => void;
  reject: (error: Error) => void;
  /** The running ffmpegs' process ids, reported by the recorder as the tracks start (none while paused). */
  pids: number[];
}
```

In the same file, replace:

```ts
      }
      case 'event':
        if (message.event.type === 'processes' && this.running) this.running.pids.push(...message.event.pids);
        this.running?.onEvent(message.event);
        return;
      case 'done': {
```

with:

```ts
      }
      case 'event':
        if (message.event.type === 'processes' && this.running) this.running.pids.push(...message.event.pids);
        // paused: every capture has exited, and a process id can be given to another process later
        if (message.event.type === 'paused' && this.running) this.running.pids = [];
        this.running?.onEvent(message.event);
        return;
      case 'done': {
```

In the same file, replace:

```ts
    if (this.running) this.send({ type: 'marker', ...(label !== undefined && { label }) });
  }

  setDeadZones(zones: Bounds[]): void {
    if (this.running) this.send({ type: 'dead-zones', zones });
  }
```

with:

```ts
    if (this.running) this.send({ type: 'marker', ...(label !== undefined && { label }) });
  }

  /** Pauses the take: every track stops until `resume()` (events `paused`, `resuming`, `resumed`). */
  pause(): void {
    if (this.running) this.send({ type: 'pause' });
  }

  resume(): void {
    if (this.running) this.send({ type: 'resume' });
  }

  setDeadZones(zones: Bounds[]): void {
    if (this.running) this.send({ type: 'dead-zones', zones });
  }
```

In the same file, replace:

```ts
  quit(): void {
    this.process?.kill();
  }
}

export const recorderHost = new RecorderHost();
```

with:

```ts
  quit(): void {
    this.process?.kill();
  }

  /** Ends the host while it does nothing, so the next one starts with the environment as it is now (ffmpeg found since). */
  refresh(): void {
    if (!this.running && this.listings.size === 0) this.process?.kill();
  }
}

export const recorderHost = new RecorderHost();
```

In `apps/desktop/src/main/media-service.ts`, replace:

```ts
  stop(): void {
    this.process?.kill();
  }
}

export const mediaWorker = new Worker();
```

with:

```ts
  stop(): void {
    this.process?.kill();
  }

  /** Ends the worker while it has nothing to do, so the next one starts with the environment as it is now. */
  refresh(): void {
    if (this.pending.size === 0) this.process?.kill();
  }
}

export const mediaWorker = new Worker();
```

In `apps/desktop/src/main/recording.ts`, replace:

```ts
// the recorder host, and what happens after the stop: the take becomes the project's, the editor
// opens on it, and `suggest` cuts it in the background.
import { existsSync, realpathSync } from 'node:fs';
import { copyFile, mkdir, readdir, rmdir, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BrowserWindow, dialog, globalShortcut, screen, session, type Rectangle } from 'electron';
import { PROJECT_FILE, newProjectFile, projectExists, readProjectFile, recoverTake, useTake, writeProjectFile } from '@cuttle/core';
import { focusWindow, recentClaudeFolders, type Devices, type RecorderEvent, type Take } from '@cuttle/recorder';
```

with:

```ts
// the recorder host, and what happens after the stop: the take becomes the project's, the editor
// opens on it, and `suggest` cuts it in the background.
import { existsSync, realpathSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rmdir, statfs } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { BrowserWindow, dialog, globalShortcut, screen, session, type Rectangle } from 'electron';
import { PROJECT_FILE, newProjectFile, projectExists, readProjectFile, recoverTake, useTake, writeProjectFile } from '@cuttle/core';
import { focusWindow, recentClaudeFolders, type Devices, type RecorderEvent, type Take } from '@cuttle/recorder';
```

In the same file, replace:

```ts
import { cutTake } from './media-service';
import { APP_ORIGIN, serveApp, bundlePath } from './protocols';
import { recorderHost, RecordingError } from './recorder-host';
import { loadSettings, updateSettings } from './settings';
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, setEditorStatus, showPill, webPreferences } from './windows';

/** The HUD's window (the HUD and a margin for its shadow): never in the video, and a dead zone for the input log. */
const HUD_SIZE = { width: 380, height: 64 };
/** The recorder host answers a listing in this time, or the picker says it cannot record. */
const LISTING_TIMEOUT_MS = 10_000;
```

with:

```ts
import { cutTake } from './media-service';
import { APP_ORIGIN, serveApp, bundlePath } from './protocols';
import { recorderHost, RecordingError } from './recorder-host';
import { findFfmpeg } from './tools';
import { loadSettings, updateSettings } from './settings';
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, sendToEditor, setEditorStatus, showPill, webPreferences } from './windows';

/** The HUD's window (the HUD and a margin for its shadow): never in the video, and a dead zone for the input log. */
const HUD_SIZE = { width: 440, height: 64 };
/** The recorder host answers a listing in this time, or the picker says it cannot record. */
const LISTING_TIMEOUT_MS = 10_000;
```

In the same file, replace:

```ts
    },
    'picker:record': (target) => void beginRecording(target, displays),
    'picker:cancel': () => endPicking(true),
    'picker:retry': () => {
      const project = pickingFor;
      const fromPill = pillHidden;
      endPicking(false);
      busy = false;
      void startPicking(project, { fromPill });
    },
    'picker:claude-folder': async () => {
```

with:

```ts
    },
    'picker:record': (target) => void beginRecording(target, displays),
    'picker:cancel': () => endPicking(true),
    'picker:retry': async () => {
      const project = pickingFor;
      const fromPill = pillHidden;
      endPicking(false);
      busy = false;
      // ffmpeg installed since (winget): found where the OS's PATH has it now, without a restart
      await findFfmpeg().catch(() => undefined);
      void startPicking(project, { fromPill });
    },
    'picker:claude-folder': async () => {
```

In the same file, replace:

```ts
  return picker;
}

/** The cameras and mics for every picker, once DirectShow has listed them. */
async function listMedia(): Promise<void> {
  const listed = pickers;
```

with:

```ts
  return picker;
}

/** The cameras and mics this machine has (the settings' defaults), or why they could not be listed. */
export async function listCamerasAndMics(): Promise<{ cameras: string[]; mics: string[]; problem?: string }> {
  try {
    const devices = await withTimeout(recorderHost.devices(true), LISTING_TIMEOUT_MS, 'The device listing');
    return { cameras: devices.cameras, mics: devices.mics };
  } catch (error) {
    return { cameras: [], mics: [], problem: ffmpegMissing(error) ? 'Cuttle needs ffmpeg to list the cameras and mics.' : messageOf(error).split('\n')[0]! };
  }
}

/** The cameras and mics for every picker, once DirectShow has listed them. */
async function listMedia(): Promise<void> {
  const listed = pickers;
```

In the same file, replace:

```ts
    }

    const area = targetRect(target, display, picked);
    const countdown = overlay(inside(area, display.workArea), 'countdown.cjs', { focusable: false });
    countdown.setIgnoreMouseEvents(true);
    // Without a countdown (0 s) it closes before its page loaded, which rejects the load.
    void countdown.loadURL(`${APP_ORIGIN}/countdown.html`).then(
      () => !HIDDEN && !countdown.isDestroyed() && countdown.showInactive(),
      () => {},
    );
    const hud = overlay({ ...hudPosition(displays, display.id, area, HUD_SIZE), ...HUD_SIZE }, 'hud.cjs', { focusable: false, movable: true });
    const hudState: HudState = { phase: 'countdown', markers: 0 };
    // a check of the drive or the window still under way may note something after the HUD closed
    const showHud = () => !hud.isDestroyed() && send(hud.webContents, 'hud:state', { ...hudState });
    const note = (message: string, detail: string, tone: HudState['tone']) => {
      hudState.message = message;
      hudState.detail = detail;
      hudState.tone = tone;
      showHud();
    };
    bindRequests(hud.webContents, 'hud', {
      'hud:stop': () => {
        hudState.phase = 'stopping';
        note('Stopping…', 'Writing the take', 'info');
        recorderHost.stop();
      },
      'hud:marker': () => recorderHost.marker(),
    });
    bindRequests(countdown.webContents, 'countdown', {});
    const deadZone = () => screen.dipToScreenRect(null, hud.getBounds());
    hud.on('moved', () => recorderHost.setDeadZones([deadZone()]));
    // Windows ends the session (sign out, shut down): the end waits while the take is stopped and written.
    hud.on('query-session-end', (event) => {
      event.preventDefault();
      recorderHost.stop();
    });
    hud.on('session-end', () => recorderHost.stop());
    void hud.loadURL(`${APP_ORIGIN}/hud.html`).catch(() => {});
    const cancelKey = 'Escape';
    globalShortcut.register(cancelKey, () => recorderHost.stop());
    const closeOverlays = () => {
      if (globalShortcut.isRegistered(cancelKey)) globalShortcut.unregister(cancelKey);
      if (!countdown.isDestroyed()) countdown.destroy();
    };

    // While it records: a warning when the drive fills up, or when a recorded window moves (its area
    // stays where it was picked).
    let takeDir: string | undefined;
    let watch: ReturnType<typeof setInterval> | undefined;
    let lastSpaceCheck = 0;
    const pickedWindow = target.kind === 'window' ? picked?.windows.find((candidate) => candidate.id === target.window) : undefined;
    /** Whether a window's physical bounds left where it was picked (DIP bounds converted back). */
    const moved = (bounds: { x: number; y: number }) => {
      if (!pickedWindow) return false;
      const origin = TEST_BACKEND ? pickedWindow.bounds : screen.dipToScreenRect(null, roundRect(pickedWindow.bounds));
      return Math.abs(bounds.x - origin.x) > 2 || Math.abs(bounds.y - origin.y) > 2;
    };
    const watchTake = async () => {
      if (hudState.phase !== 'recording') return;
      if (Date.now() - lastSpaceCheck > 30_000) {
        lastSpaceCheck = Date.now();
        const left = await freeBytes(projectDir);
        if (left !== undefined && left < 2 * GB && hudState.message === undefined) note(`Disk almost full: ${gigabytes(left)}`, `Only ${gigabytes(left)} free on the drive of ${projectDir}.`, 'warn');
      }
      if (pickedWindow && hudState.message === undefined) {
        const now = (await recorderHost.devices(false).catch(() => undefined))?.windows.find((window) => window.id === pickedWindow.id);
        const before = pickedWindow.pixels;
        if (now && (now.bounds.width !== before.width || now.bounds.height !== before.height || moved(now.bounds))) {
          note('The window moved', 'The window moved or changed size: the area where it was picked is still recorded.', 'warn');
        }
      }
    };

    const onEvent = (event: RecorderEvent) => {
      switch (event.type) {
        case 'countdown':
          send(countdown.webContents, 'countdown:tick', { seconds: event.seconds });
          return;
        case 'recording':
          closeOverlays();
          takeDir = event.dir;
          hudState.phase = 'recording';
          hudState.startedAt = Date.now();
          if (!HIDDEN) hud.showInactive();
          showHud();
          watch = setInterval(() => void watchTake(), 2000);
          return;
        case 'marker':
          hudState.markers++;
          showHud();
          return;
        case 'warning': {
          const warning = hudWarning(event.message);
          note(warning.text, warning.detail, 'warn');
          return;
        }
        case 'stopping':
          hudState.phase = 'stopping';
          note('Stopping…', 'Writing the take', 'info');
          return;
      }
    };

    // The picker's camera preview lets go of the camera a moment after the picker closed.
    const countdownFor = await countdownSeconds();
    if (choices.camera && countdownFor < 1) await new Promise((resolve) => setTimeout(resolve, 600));
    let take: Take;
    try {
      if (quitting) throw new RecordingError('cancelled', 'The app quits');
      take = await recorderHost.record(
        {
          projectDir,
          source,
          ...(choices.camera && { webcam: choices.camera }),
          ...(choices.mic && { mic: choices.mic }),
          stop: stopOptionsFor(choices),
          countdownSeconds: countdownFor,
          deadZones: [deadZone()],
        },
        onEvent,
      );
    } catch (error) {
      clearInterval(watch);
      closeOverlays();
      if (!hud.isDestroyed()) hud.destroy();
      if (error instanceof RecordingError && error.code === 'cancelled') {
        await giveUp();
        return false;
      }
      // A take that had started is kept: repaired with recover, then opened like any other.
      if (takeDir) {
        cutting = await recoverAndOpen(projectDir, takeDir, (error as Error).message, showEditor);
        return cutting;
      }
      await giveUp();
      const failure = recordingFailure((error as Error).message);
      say(`The recording could not start. ${failure.text}`, failure.detail);
      return false;
    }
    clearInterval(watch);
    closeOverlays();
    if (!hud.isDestroyed()) hud.destroy();
    cutting = await finishTake(projectDir, take, showEditor);
    return cutting;
  } finally {
    if (!cutting) finishing.delete(project);
  }
}

/**
 * A take that ended badly (the capture failed after it started): `recover` repairs it and points the
 * project at it, and it is cut like any other. Returns whether the cut started.
 */
async function recoverAndOpen(projectDir: string, takeDir: string, why: string, showEditor: () => Promise<void>): Promise<boolean> {
  const dir = resolve(projectDir);
  const failure = recordingFailure(why);
  try {
    const result = await recoverTake(dir, takeDir);
    say(`The recording stopped early. ${failure.text} Cuttle kept the ${Math.round(result.seconds)} s it had and opened it.`, [failure.detail, ...result.repaired].join('\n'));
  } catch (error) {
    await showEditor();
    say(`The recording stopped early. ${failure.text} Its take in ${takeDir} could not be recovered: ${(error as Error).message.split('\n')[0]}`, failure.detail);
```

with:

```ts
    }

    const area = targetRect(target, display, picked);
    /** Takes a restart put aside, newest last (folders relative to the project). */
    const discarded: string[] = [];
    for (;;) {
      let restarting = false;
      const countdown = overlay(inside(area, display.workArea), 'countdown.cjs', { focusable: false });
      countdown.setIgnoreMouseEvents(true);
      // Without a countdown (0 s) it closes before its page loaded, which rejects the load.
      void countdown.loadURL(`${APP_ORIGIN}/countdown.html`).then(
        () => !HIDDEN && !countdown.isDestroyed() && countdown.showInactive(),
        () => {},
      );
      const hud = overlay({ ...hudPosition(displays, display.id, area, HUD_SIZE), ...HUD_SIZE }, 'hud.cjs', { focusable: false, movable: true });
      const hudState: HudState = { phase: 'countdown', markers: 0 };
      // a check of the drive or the window still under way may note something after the HUD closed
      const showHud = () => !hud.isDestroyed() && send(hud.webContents, 'hud:state', { ...hudState });
      const note = (message: string, detail: string, tone: HudState['tone']) => {
        hudState.message = message;
        hudState.detail = detail;
        hudState.tone = tone;
        showHud();
      };
      bindRequests(hud.webContents, 'hud', {
        'hud:stop': () => {
          hudState.phase = 'stopping';
          note('Stopping…', 'Writing the take', 'info');
          recorderHost.stop();
        },
        'hud:marker': () => recorderHost.marker(),
        'hud:pause': () => recorderHost.pause(),
        'hud:resume': () => recorderHost.resume(),
        'hud:restart': () => {
          if (hudState.phase === 'stopping' || hudState.phase === 'countdown') return;
          restarting = true;
          hudState.phase = 'stopping';
          note('Restarting…', 'This take is put aside: the editor can bring it back', 'info');
          recorderHost.stop();
        },
      });
      bindRequests(countdown.webContents, 'countdown', {});
      const deadZone = () => screen.dipToScreenRect(null, hud.getBounds());
      hud.on('moved', () => recorderHost.setDeadZones([deadZone()]));
      // Windows ends the session (sign out, shut down): the end waits while the take is stopped and written.
      hud.on('query-session-end', (event) => {
        event.preventDefault();
        recorderHost.stop();
      });
      hud.on('session-end', () => recorderHost.stop());
      void hud.loadURL(`${APP_ORIGIN}/hud.html`).catch(() => {});
      const cancelKey = 'Escape';
      globalShortcut.register(cancelKey, () => recorderHost.stop());
      const closeOverlays = () => {
        if (globalShortcut.isRegistered(cancelKey)) globalShortcut.unregister(cancelKey);
        if (!countdown.isDestroyed()) countdown.destroy();
      };

      // While it records: a warning when the drive fills up, or when a recorded window moves (its area
      // stays where it was picked).
      let takeDir: string | undefined;
      let watch: ReturnType<typeof setInterval> | undefined;
      let lastSpaceCheck = 0;
      const pickedWindow = target.kind === 'window' ? picked?.windows.find((candidate) => candidate.id === target.window) : undefined;
      /** Whether a window's physical bounds left where it was picked (DIP bounds converted back). */
      const moved = (bounds: { x: number; y: number }) => {
        if (!pickedWindow) return false;
        const origin = TEST_BACKEND ? pickedWindow.bounds : screen.dipToScreenRect(null, roundRect(pickedWindow.bounds));
        return Math.abs(bounds.x - origin.x) > 2 || Math.abs(bounds.y - origin.y) > 2;
      };
      const watchTake = async () => {
        if (hudState.phase !== 'recording') return;
        if (Date.now() - lastSpaceCheck > 30_000) {
          lastSpaceCheck = Date.now();
          const left = await freeBytes(projectDir);
          if (left !== undefined && left < 2 * GB && hudState.message === undefined) note(`Disk almost full: ${gigabytes(left)}`, `Only ${gigabytes(left)} free on the drive of ${projectDir}.`, 'warn');
        }
        if (pickedWindow && hudState.message === undefined) {
          const now = (await recorderHost.devices(false).catch(() => undefined))?.windows.find((window) => window.id === pickedWindow.id);
          const before = pickedWindow.pixels;
          if (now && (now.bounds.width !== before.width || now.bounds.height !== before.height || moved(now.bounds))) {
            note('The window moved', 'The window moved or changed size: the area where it was picked is still recorded.', 'warn');
          }
        }
      };

      const onEvent = (event: RecorderEvent) => {
        switch (event.type) {
          case 'countdown':
            send(countdown.webContents, 'countdown:tick', { seconds: event.seconds });
            return;
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
            hudState.recorded = (hudState.recorded ?? 0) + (Date.now() - (hudState.startedAt ?? Date.now())) / 1000;
            delete hudState.startedAt;
            hudState.phase = 'paused';
            note('Paused', 'Nothing is recorded until you resume (Ctrl+Shift+Alt+P)', 'info');
            return;
          case 'resuming':
            hudState.phase = 'resuming';
            note('Resuming…', 'Starting the tracks again', 'info');
            return;
          case 'resumed':
            hudState.phase = 'recording';
            hudState.startedAt = Date.now();
            delete hudState.message;
            delete hudState.detail;
            delete hudState.tone;
            showHud();
            return;
          case 'marker':
            hudState.markers++;
            showHud();
            return;
          case 'warning': {
            const warning = hudWarning(event.message);
            note(warning.text, warning.detail, 'warn');
            return;
          }
          case 'stopping':
            hudState.phase = 'stopping';
            note('Stopping…', 'Writing the take', 'info');
            return;
        }
      };

      // The picker's camera preview lets go of the camera a moment after the picker closed.
      const countdownFor = await countdownSeconds();
      if (choices.camera && countdownFor < 1) await new Promise((resolve) => setTimeout(resolve, 600));
      let take: Take;
      try {
        if (quitting) throw new RecordingError('cancelled', 'The app quits');
        take = await recorderHost.record(
          {
            projectDir,
            source,
            ...(choices.camera && { webcam: choices.camera }),
            ...(choices.mic && { mic: choices.mic }),
            stop: stopOptionsFor(choices),
            countdownSeconds: countdownFor,
            deadZones: [deadZone()],
          },
          onEvent,
        );
      } catch (error) {
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
          await giveUp();
          return false;
        }
        // A take that had started is kept: repaired with recover, then opened like any other.
        if (takeDir) {
          cutting = await recoverAndOpen(projectDir, takeDir, (error as Error).message, showEditor);
          return cutting;
        }
        await giveUp();
        const failure = recordingFailure((error as Error).message);
        say(`The recording could not start. ${failure.text}`, failure.detail);
        return false;
      }
      clearInterval(watch);
      closeOverlays();
      if (!hud.isDestroyed()) hud.destroy();
      if (restarting && !quitting) {
        // put aside, not deleted ("Undo restart" in the editor), and counted down again
        const aside = await putAside(projectDir, take.dir).catch(() => undefined);
        if (aside) {
          discarded.push(aside);
          continue;
        }
      }
      // the editor that opens on this take offers to bring back the one a restart put aside
      const restartedFrom = discarded.at(-1);
      if (restartedFrom) restarted.set(keyOf(projectDir), restartedFrom);
      cutting = await finishTake(projectDir, take, showEditor);
      if (!cutting) restarted.delete(keyOf(projectDir));
      return cutting;
    }
  } finally {
    if (!cutting) finishing.delete(project);
  }
}

/** Moves a take into `takes/.discarded/` (a restart); returns its new folder relative to the project. */
async function putAside(projectDir: string, takeDir: string): Promise<string> {
  const aside = join(projectDir, 'takes', '.discarded');
  await mkdir(aside, { recursive: true });
  const taken = new Set(await readdir(aside));
  const name = basename(takeDir);
  let target = name;
  for (let n = 2; taken.has(target); n++) target = `${name}-${n}`;
  await rename(join(projectDir, takeDir), join(aside, target));
  return ['takes', '.discarded', target].join('/');
}

/** Moves a take put aside back as the next take (`takes/<n>`); returns its folder, or undefined when it is not there. */
async function bringBack(projectDir: string, discarded: string): Promise<string | undefined> {
  const from = resolve(projectDir, discarded);
  const aside = resolve(projectDir, 'takes', '.discarded');
  const inside = relative(aside, from);
  if (inside === '' || inside.startsWith('..') || inside.includes(sep) || !existsSync(from)) return undefined;
  const names = await readdir(join(projectDir, 'takes')).catch(() => [] as string[]);
  const next = names.reduce((max, name) => (/^\d+$/.test(name) ? Math.max(max, Number(name)) : max), 0) + 1;
  await mkdir(dirname(join(projectDir, 'takes', String(next))), { recursive: true });
  await rename(from, join(projectDir, 'takes', String(next)));
  return `takes/${next}`;
}

/**
 * "Undo restart" in the editor: the take put aside becomes the project's again (the restarted one
 * stays restorable, "Back to take n"), and is cut like a new one.
 */
export async function undoRestart(projectDir: string, discarded: string): Promise<void> {
  const dir = resolve(projectDir);
  const file = projectExists(dir) ? await readProjectFile(dir).catch(() => undefined) : undefined;
  const current = file && currentTake(file.raw);
  if (current && existsSync(join(dir, 'takes', current))) await copyFile(join(dir, PROJECT_FILE), join(dir, 'takes', current, PROJECT_FILE)).catch(() => {});
  const back = await bringBack(dir, discarded);
  if (!back) return say('The take put aside by the restart is not there any more.');
  await recoverAndOpen(dir, back, '', async () => {}, true);
}

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
    say(`The recording stopped early. ${failure.text} Its take in ${takeDir} could not be recovered: ${(error as Error).message.split('\n')[0]}`, failure.detail);
```

In the same file, replace:

```ts
  await recut(dir);
}

/**
 * Opens the editor on the take at once while `suggest` cuts it in the background; the editor gets
 * the cut as a change of the file, one step to undo ("Cut by suggest").
```

with:

```ts
  await recut(dir);
}

/** Projects whose new take came after a restart: the take put aside, for the editor's "Undo restart". */
const restarted = new Map<string, string>();

/**
 * Opens the editor on the take at once while `suggest` cuts it in the background; the editor gets
 * the cut as a change of the file, one step to undo ("Cut by suggest").
```

In the same file, replace:

```ts
  finishing.add(keyOf(dir));
  try {
    await reopenEditor(dir);
    await cut(dir);
  } finally {
    finishing.delete(keyOf(dir));
```

with:

```ts
  finishing.add(keyOf(dir));
  try {
    await reopenEditor(dir);
    const discarded = restarted.get(keyOf(dir));
    restarted.delete(keyOf(dir));
    if (discarded) await sendToEditor(dir, 'project:restarted', { discarded });
    await cut(dir);
  } finally {
    finishing.delete(keyOf(dir));
```

- [ ] **Step 3: The tools: ffmpeg, the cuttle command, the skill**

`apps/desktop/src/main/tools.ts`:

```ts
// The tools around the app. ffmpeg is looked for where the OS's PATH has it now (read from the
// registry on Windows, so "Check again" finds it right after `winget install Gyan.FFmpeg` without a
// restart) and in WinGet's links folder; found outside this process's PATH, it is put on it. For
// Claude Code: the cuttle command (shims that run the app's own copy of the CLI with the app as
// Node) and the cuttle skill (copied into Claude's config folder). Nothing that belongs to someone
// else is overwritten: a cuttle command already on PATH and a skill folder Cuttle did not write
// are left as they are.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import type { ToolsStatus } from '../shared/ipc';
import { CHECK } from './check';
import { cliEntry } from './cli-path';
import { mediaWorker } from './media-service';
import { recorderHost } from './recorder-host';

const windows = process.platform === 'win32';

/** Marks the shims this app writes (the repository's `pnpm cli:install` has its own mark). */
const SHIM_MARK = 'cuttle shim (Cuttle app)';
/** Marks a skill folder Cuttle wrote (the app's install and the repository's write the same file). */
const SKILL_MARK = '.cuttle-skill.json';
/** What the skill tells Claude to ask for when the command is missing, for a skill the app installed. */
const APP_INSTALL_HINT = 'ask the user to open Cuttle\'s settings (the tray icon, Settings) and press "Install" under Claude Code';

const run = (file: string, args: string[]) =>
  new Promise<{ ok: boolean; stdout: string }>((resolve) =>
    execFile(file, args, { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout) })),
  );

const splitPath = (value: string | undefined) => (value ?? '').split(delimiter).map((part) => part.trim().replace(/^"(.*)"$/, '$1')).filter((part) => part !== '');
/** `%LOCALAPPDATA%\…` as the shell expands it (process.env is case-insensitive on Windows). */
const expand = (value: string) => value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
const sameDir = (a: string, b: string) => {
  const key = (dir: string) => dir.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return windows ? key(a).toLowerCase() === key(b).toLowerCase() : key(a) === key(b);
};
const unique = (dirs: string[]) => dirs.filter((dir, at) => dirs.findIndex((other) => sameDir(other, dir)) === at);

/** A REG_SZ or REG_EXPAND_SZ value from `reg query`'s output. */
export function registryValue(output: string, name: string): string | undefined {
  const line = output.split(/\r?\n/).find((row) => new RegExp(`^\\s*${name}\\s+REG_(EXPAND_)?SZ\\s`, 'i').test(row));
  return line?.replace(new RegExp(`^\\s*${name}\\s+REG_(EXPAND_)?SZ\\s+`, 'i'), '').trim();
}

async function registryPath(key: string): Promise<string | undefined> {
  const { ok, stdout } = await run('reg', ['query', key, '/v', 'Path']);
  return ok ? registryValue(stdout, 'Path') : undefined;
}

const USER_ENVIRONMENT = 'HKCU\\Environment';
const MACHINE_ENVIRONMENT = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
/** WinGet puts links to the commands of the packages it installs here (on PATH for new terminals). */
const wingetLinks = () => join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links');

/**
 * The folders a command is looked for in: the PATH as the OS has it now (Windows: the machine's and
 * the user's from the registry), WinGet's links folder, then this process's PATH. The check gives
 * its own list in a file (CUTTLE_CHECK_PATH_FILE), so it can make ffmpeg appear.
 */
export async function searchPath(): Promise<string[]> {
  const file = CHECK ? process.env.CUTTLE_CHECK_PATH_FILE : undefined;
  if (file) return splitPath(readFileSync(file, 'utf8'));
  if (!windows) return unique(splitPath(process.env.PATH));
  const [machine, user] = await Promise.all([registryPath(MACHINE_ENVIRONMENT), registryPath(USER_ENVIRONMENT)]);
  return unique([...splitPath(expand(machine ?? '')), ...splitPath(expand(user ?? '')), wingetLinks(), ...splitPath(process.env.PATH)]);
}

/** The first file for command `name` in `dirs` (Windows: name.exe, .cmd or .bat; elsewhere the name). */
export function findCommand(name: string, dirs: readonly string[], extensions = windows ? ['.exe', '.cmd', '.bat'] : ['']): string | undefined {
  for (const dir of dirs) {
    for (const extension of extensions) {
      const file = join(dir, `${name}${extension}`);
      if (existsSync(file)) return file;
    }
  }
  return undefined;
}

/** "7.1-full_build-www.gyan.dev" from `ffmpeg -version`'s first line. */
export const ffmpegVersion = (output: string) => /^ffmpeg version (\S+)/m.exec(output)?.[1];

/**
 * Finds ffmpeg and makes this process use it: a folder that is not on its PATH yet (installed since
 * the app started) is put first on it, so the recorder, the media worker and exports find it.
 * `changed` says the PATH changed: helper processes started before must start again.
 */
export async function findFfmpeg(): Promise<{ ffmpeg?: ToolsStatus['ffmpeg']; changed: boolean }> {
  const file = findCommand('ffmpeg', await searchPath(), windows ? ['.exe'] : ['']);
  if (!file) return { changed: false };
  const { ok, stdout } = await run(file, ['-version']);
  const version = ok ? ffmpegVersion(stdout) : undefined;
  if (!version) return { changed: false };
  const dir = join(file, '..');
  const onPath = splitPath(process.env.PATH).some((part) => sameDir(part, dir));
  if (!onPath) {
    process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`;
    // helpers started before look on the old PATH: idle ones start again with this one
    recorderHost.refresh();
    mediaWorker.refresh();
  }
  return { ffmpeg: { path: file, version }, changed: !onPath };
}

// ---- the cuttle command ------------------------------------------------------------------------

/** Where the app writes its shims: CUTTLE_BIN_DIR, else a folder of its own. */
export const binDir = () => process.env.CUTTLE_BIN_DIR || (windows ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Cuttle', 'bin') : join(homedir(), '.local', 'bin'));

const quoteSh = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const toPosix = (path: string) => path.replace(/\\/g, '/').replace(/^([A-Za-z]):\//, (_whole, drive: string) => `/${drive.toLowerCase()}/`);

/**
 * The shims: cmd.exe and PowerShell run cuttle.cmd, Git Bash and other shells run `cuttle`. The app
 * runs as Node (ELECTRON_RUN_AS_NODE, only for that command: `setlocal`); a packaged app also runs
 * the CLI's Electron part itself (CUTTLE_ELECTRON), since it has no Electron of its own to download.
 */
export function shims(exe: string, entry: string, packaged: boolean): Record<string, string> {
  const electron = packaged ? exe : undefined;
  return {
    ...(windows && {
      'cuttle.cmd': [`@rem ${SHIM_MARK}`, '@setlocal', '@set ELECTRON_RUN_AS_NODE=1', ...(electron ? [`@set "CUTTLE_ELECTRON=${electron}"`] : []), `@"${exe}" "${entry}" %*`, ''].join('\r\n'),
    }),
    cuttle: [
      '#!/bin/sh',
      `# ${SHIM_MARK}`,
      `ELECTRON_RUN_AS_NODE=1 ${electron ? `CUTTLE_ELECTRON=${quoteSh(electron)} ` : ''}exec ${quoteSh(windows ? toPosix(exe) : exe)} ${quoteSh(windows ? toPosix(entry) : entry)} "$@"`,
      '',
    ].join('\n'),
  };
}

const isOurShim = (file: string) => {
  try {
    return readFileSync(file, 'utf8').includes(SHIM_MARK);
  } catch {
    return false;
  }
};

/** Puts `dir` on the user's PATH for new terminals (Windows: the registry, announced to running programs). */
async function addToUserPath(dir: string): Promise<boolean> {
  if (!windows) return false;
  const current = (await registryPath(USER_ENVIRONMENT)) ?? '';
  if (splitPath(expand(current)).some((part) => sameDir(part, dir))) return false;
  // The check never touches the user's PATH: it says what it would have done.
  if (CHECK) {
    (globalThis as { __pathAdded?: string[] }).__pathAdded = [...((globalThis as { __pathAdded?: string[] }).__pathAdded ?? []), dir];
    return true;
  }
  // .NET writes the value and broadcasts WM_SETTINGCHANGE, so Explorer starts new terminals with it.
  const script = `$p = [Environment]::GetEnvironmentVariable('Path', 'User'); [Environment]::SetEnvironmentVariable('Path', ($(if ($p) { $p.TrimEnd(';') + ';' } else { '' }) + $env:CUTTLE_ADD_PATH), 'User')`;
  const done = await new Promise<boolean>((resolve) =>
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30_000, env: { ...process.env, CUTTLE_ADD_PATH: dir } }, (error) => resolve(!error)),
  );
  if (!done) throw new Error(`${dir} could not be put on your PATH`);
  return true;
}

// ---- the skill ---------------------------------------------------------------------------------

/** The skill's files in the app: packaged next to the bundle, else the repository's. */
const skillSource = () => (app.isPackaged ? join(app.getAppPath(), 'skill') : fileURLToPath(new URL('../../../../skill/cuttle/', import.meta.url)));
const skillDir = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'skills', 'cuttle');

function skillState(dir: string): ToolsStatus['skill']['state'] {
  if (existsSync(join(dir, SKILL_MARK))) return 'installed';
  return existsSync(dir) ? 'other' : 'missing';
}

/** Only plain Markdown names in the folder itself: a marker's list is never trusted with a path. */
const markdown = (name: unknown): name is string => typeof name === 'string' && /^[^/\\]+\.md$/.test(name);

async function installSkill(): Promise<void> {
  // the check writes only into a Claude folder of its own, never the user's
  if (CHECK && !process.env.CLAUDE_CONFIG_DIR) throw new Error('the check sets no CLAUDE_CONFIG_DIR');
  const target = skillDir();
  const marker = join(target, SKILL_MARK);
  const state = skillState(target);
  if (state === 'other') throw new Error(`${target} holds a cuttle skill Cuttle did not install; it was left as it is`);
  if (state === 'installed') {
    // an older version's files go first
    const previous = JSON.parse(await readFile(marker, 'utf8').catch(() => '{}')) as { files?: unknown };
    for (const name of (Array.isArray(previous.files) ? previous.files : []).filter(markdown)) await rm(join(target, name), { force: true });
  }
  const source = skillSource();
  const files = readdirSync(source).filter(markdown);
  await mkdir(target, { recursive: true });
  // the marker first: an install cut short still belongs to Cuttle
  await writeFile(marker, `${JSON.stringify({ app: true, files }, null, 2)}\n`);
  for (const name of files) {
    const text = await readFile(join(source, name), 'utf8');
    await writeFile(join(target, name), text.replaceAll('{{INSTALL_CLI}}', () => APP_INSTALL_HINT));
  }
}

// ---- status and install ------------------------------------------------------------------------

/** Whether the app put its command folder on the user's PATH in this run (terminals opened before do not see it). */
let pathAdded = false;

export async function toolsStatus(): Promise<ToolsStatus> {
  const dirs = await searchPath();
  const { ffmpeg } = await findFfmpeg();
  // the app's own folder counts once it is written, even before a new terminal sees it
  const command = findCommand('cuttle', [...dirs, binDir()].filter((dir, at, all) => all.findIndex((other) => sameDir(other, dir)) === at));
  return {
    ...(ffmpeg && { ffmpeg }),
    ...(command && { command: { path: command, ours: isOurShim(command) } }),
    skill: { dir: skillDir(), state: skillState(skillDir()) },
    ...(pathAdded && { newTerminal: true }),
  };
}

/**
 * Installs what is missing: the command (unless another cuttle is already on PATH; the app's own
 * shims are written again, so they follow the app when it moved) and the skill (unless a folder
 * Cuttle did not write is there). Says what could not be done, in a sentence.
 */
export async function installTools(): Promise<{ status: ToolsStatus; problem?: string }> {
  const problems: string[] = [];
  const before = await toolsStatus();
  if (!before.command || before.command.ours) {
    try {
      if (CHECK && !process.env.CUTTLE_BIN_DIR) throw new Error('the check sets no CUTTLE_BIN_DIR');
      const entry = cliEntry();
      if (!existsSync(entry)) throw new Error(`the app's copy of the cuttle command is missing (${entry})`);
      const dir = binDir();
      const files = shims(process.execPath, entry, app.isPackaged);
      const foreign = Object.keys(files).filter((name) => existsSync(join(dir, name)) && !isOurShim(join(dir, name)));
      if (foreign.length > 0) throw new Error(`${join(dir, foreign[0]!)} belongs to another program`);
      await mkdir(dir, { recursive: true });
      for (const [name, text] of Object.entries(files)) {
        await writeFile(join(dir, name), text);
        if (!name.includes('.')) await chmod(join(dir, name), 0o755);
      }
      if (await addToUserPath(dir)) pathAdded = true;
    } catch (error) {
      problems.push(`The cuttle command: ${(error as Error).message}.`);
    }
  }
  if (before.skill.state !== 'other') {
    try {
      await installSkill();
    } catch (error) {
      problems.push(`The skill: ${(error as Error).message}.`);
    }
  } else problems.push(`The skill: ${before.skill.dir} holds a cuttle skill Cuttle did not install; it was left as it is.`);
  return { status: await toolsStatus(), ...(problems.length > 0 && { problem: problems.join(' ') }) };
}
```

- [ ] **Step 4: The settings, their window, motion, the menus**

In `apps/desktop/src/main/settings.ts`, replace:

```ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';

const RECENT_MAX = 10;
```

with:

```ts
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import { z } from 'zod';
import { MOTIONS, type Motion, type SettingsView } from '../shared/ipc';

const RECENT_MAX = 10;
```

In the same file, replace:

```ts
  countdown: z.union([z.literal(0), z.literal(3), z.literal(5)]).catch(3).default(3),
  /** Projects whose take was written while the app quit: cut by suggest when they open next. */
  uncut: z.array(z.string()).catch([]).default([]),
  /** The picker bar's choices, kept between recordings. */
  record: z
    .object({ camera: z.string().optional(), mic: z.string().optional(), stop: z.enum(['none', 'claude', 'idle']).default('none'), claudeFolder: z.string().optional() })
    .catch({ stop: 'none' as const })
```

with:

```ts
  countdown: z.union([z.literal(0), z.literal(3), z.literal(5)]).catch(3).default(3),
  /** Projects whose take was written while the app quit: cut by suggest when they open next. */
  uncut: z.array(z.string()).catch([]).default([]),
  /** The first run was seen to its end (ffmpeg, the cuttle command and the skill). */
  welcomed: z.boolean().catch(false).default(false),
  /** Start with the computer (the OS's login item). */
  launchAtLogin: z.boolean().catch(false).default(false),
  /** Motion in the app's windows: the OS's "reduce motion" (system), or always reduced, or always full. */
  motion: z.enum(MOTIONS).catch('system').default('system'),
  /** The picker bar's choices, kept between recordings (the camera and mic are the defaults in the settings). */
  record: z
    .object({ camera: z.string().optional(), mic: z.string().optional(), stop: z.enum(['none', 'claude', 'idle']).default('none'), claudeFolder: z.string().optional() })
    .catch({ stop: 'none' as const })
```

In the same file, replace:

```ts
}

let writing = Promise.resolve();
const listeners = new Set<(settings: Settings) => void>();

/** Calls `listener` after every change of the settings. */
```

with:

```ts
}

let writing = Promise.resolve();

/**
 * Replaces `to` with `from`. Windows refuses a rename over a file another program has open for a
 * moment (a reader, a scanner, OneDrive): it is tried again for about a second.
 */
async function replace(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 12 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}
const listeners = new Set<(settings: Settings) => void>();

/** Calls `listener` after every change of the settings. */
```

In the same file, replace:

```ts
  writing = writing.then(async () => {
    await mkdir(dirname(file()), { recursive: true });
    await writeFile(`${file()}.part`, text);
    await rename(`${file()}.part`, file());
  }).catch(() => {});
  await writing;
  for (const listener of listeners) listener(settings);
  return settings;
}

/** Puts a project at the top of the recent list. */
export function addRecent(dir: string): Promise<Settings> {
  return updateSettings((settings) => {
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    settings.recent = [
      { dir, name: basename(dir), opened: Date.now() },
      ...settings.recent.filter((entry) => (process.platform === 'win32' ? entry.dir.toLowerCase() : entry.dir) !== key),
    ].slice(0, RECENT_MAX);
  });
}
```

with:

```ts
  writing = writing.then(async () => {
    await mkdir(dirname(file()), { recursive: true });
    await writeFile(`${file()}.part`, text);
    await replace(`${file()}.part`, file());
  }).catch(() => {});
  await writing;
  for (const listener of listeners) listener(settings);
  return settings;
}

/**
 * The app's version: the packaged app's, else apps/desktop/package.json's (run from the repository,
 * Electron reports its own version).
 */
export function appVersion(): string {
  if (app.isPackaged) return app.getVersion();
  try {
    return (JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string }).version;
  } catch {
    return app.getVersion();
  }
}

/** How motion is set, once the settings were loaded (the windows get it when they are made). */
export const motionSetting = (): Motion => cached?.motion ?? 'system';

/** The settings as the settings window shows them. */
export async function settingsView(): Promise<SettingsView> {
  const settings = await loadSettings();
  return {
    projectsFolder: settings.projectsFolder,
    countdown: settings.countdown,
    ...(settings.record.camera !== undefined && { camera: settings.record.camera }),
    ...(settings.record.mic !== undefined && { mic: settings.record.mic }),
    launchAtLogin: settings.launchAtLogin,
    motion: settings.motion,
    recent: settings.recent,
    version: appVersion(),
  };
}

/** The same folder, as Windows compares paths (case) and wherever it is written (separators, a trailing one). */
export const sameDir = (a: string, b: string) => {
  const key = (dir: string) => dir.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return process.platform === 'win32' ? key(a).toLowerCase() === key(b).toLowerCase() : key(a) === key(b);
};

/** Puts a project at the top of the recent list. */
export function addRecent(dir: string): Promise<Settings> {
  return updateSettings((settings) => {
    settings.recent = [{ dir, name: basename(dir), opened: Date.now() }, ...settings.recent.filter((entry) => !sameDir(entry.dir, dir))].slice(0, RECENT_MAX);
  });
}
```

`apps/desktop/src/main/settings-window.ts`:

```ts
// The settings window, which is also the first run ("Welcome": ffmpeg, the cuttle command and the
// skill, then the pill). One at a time: asking again brings it forward.
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, session, shell } from 'electron';
import { editorLockOf } from '@cuttle/core';
import type { Motion, SettingsView } from '../shared/ipc';
import { CHECK, HIDDEN } from './check';
import { bindRequests, send } from './ipc';
import { APP_ORIGIN, assetPath, bundlePath, serveApp } from './protocols';
import { listCamerasAndMics, recordingRuns } from './recording';
import { loadSettings, sameDir, settingsView, updateSettings } from './settings';
import { installTools, toolsStatus } from './tools';
import { guard, lockDown, openEditorOrSay, showPill, webPreferences } from './windows';

const BACKGROUND = '#0c0c0f';
/** The settings scroll; the first run fits without. */
const SIZE = { width: 640, height: 720 };
const WELCOME_SIZE = { width: 640, height: 580 };

let current: BrowserWindow | undefined;

/** Characters Windows does not take in a folder name, and names it keeps for devices. */
const BAD_NAME = /[<>:"/\\|?*\u0000-\u001f]|^\.+$|^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** The folder a recent entry names: only folders on the list are acted on, never one a page made up. */
async function recentDir(dir: string): Promise<string> {
  const entry = (await loadSettings()).recent.find((candidate) => sameDir(candidate.dir, dir));
  if (!entry) throw new Error('that project is not in the recent list');
  return entry.dir;
}

/** Shows the settings window (`welcome`: the first run), or brings it forward. */
export async function openSettings(options: { welcome?: boolean } = {}): Promise<BrowserWindow> {
  if (current && !current.isDestroyed()) {
    if (!HIDDEN) current.show();
    current.focus();
    return current;
  }
  const ses = session.fromPartition('settings');
  lockDown(ses);
  serveApp(ses, bundlePath('renderer'));
  const window = new BrowserWindow({
    ...(options.welcome ? WELCOME_SIZE : SIZE),
    minWidth: 560,
    minHeight: 480,
    show: false,
    backgroundColor: BACKGROUND,
    title: options.welcome ? 'Welcome to Cuttle' : 'Cuttle settings',
    // the page draws the title bar; Windows draws its buttons over it, in the app's colours
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BACKGROUND, symbolColor: '#9a9aa5', height: 40 },
    icon: assetPath('icon.png'),
    maximizable: false,
    fullscreenable: false,
    webPreferences: webPreferences('settings.cjs', ses),
  });
  const contents = window.webContents;
  guard(contents);
  const changed = (view: SettingsView) => {
    send(contents, 'settings:changed', view);
    return view;
  };

  bindRequests(contents, 'settings', {
    'settings:get': () => settingsView(),
    'settings:set': async (change) => {
      await updateSettings((settings) => {
        if (change.countdown !== undefined) settings.countdown = change.countdown;
        if (change.camera !== undefined) settings.record.camera = change.camera ?? undefined;
        if (change.mic !== undefined) settings.record.mic = change.mic ?? undefined;
        if (change.launchAtLogin !== undefined) settings.launchAtLogin = change.launchAtLogin;
        if (change.motion !== undefined) settings.motion = change.motion;
      });
      if (change.launchAtLogin !== undefined) applyLoginItem(change.launchAtLogin);
      if (change.motion !== undefined) broadcastMotion(change.motion);
      return changed(await settingsView());
    },
    'settings:choose-folder': async () => {
      const chosen = CHECK
        ? process.env.CUTTLE_CHECK_FOLDER
        : (
            await dialog.showOpenDialog(window, {
              title: 'Where new recordings go',
              defaultPath: (await loadSettings()).projectsFolder,
              properties: ['openDirectory', 'createDirectory'],
            })
          ).filePaths[0];
      if (chosen) {
        await updateSettings((settings) => {
          settings.projectsFolder = chosen;
        });
      }
      return changed(await settingsView());
    },
    'settings:devices': () => listCamerasAndMics(),
    'settings:welcomed': async () => {
      await updateSettings((settings) => {
        settings.welcomed = true;
      });
      window.close();
      await showPill();
    },
    'tools:status': () => toolsStatus(),
    'tools:check': () => toolsStatus(),
    'tools:install': () => installTools(),
    'tools:copy': (text) => clipboard.writeText(text),
    'recent:open': async (dir) => openEditorOrSay(await recentDir(dir)),
    'recent:reveal': async (dir) => shell.showItemInFolder(await recentDir(dir)),
    'recent:forget': async (dir) => {
      const known = await recentDir(dir);
      await updateSettings((settings) => {
        settings.recent = settings.recent.filter((entry) => !sameDir(entry.dir, known));
      });
      return changed(await settingsView());
    },
    'recent:rename': async ({ dir, name }) => {
      const known = await recentDir(dir);
      const answer = await renameProject(known, name);
      if ('dir' in answer) changed(await settingsView());
      return answer;
    },
  });
  // the first run counts as seen once it was closed, however
  if (options.welcome) {
    window.on('closed', () => {
      void loadSettings().then((settings) => {
        if (settings.welcomed) return;
        void updateSettings((latest) => {
          latest.welcomed = true;
        }).then(() => showPill());
      });
    });
  }
  window.on('closed', () => {
    if (current === window) current = undefined;
  });
  window.once('ready-to-show', () => {
    if (!HIDDEN) window.show();
  });
  current = window;
  await window.loadURL(`${APP_ORIGIN}/settings.html${options.welcome ? '#welcome' : ''}`);
  return window;
}

/**
 * Renames a project's folder (in the same parent folder), and its entries in the settings. Not
 * while it is open in Cuttle (here or on another computer) or while a recording runs.
 */
export async function renameProject(dir: string, name: string): Promise<{ dir: string } | { problem: string }> {
  const clean = name.trim();
  if (BAD_NAME.test(clean) || clean.endsWith('.') || clean.endsWith(' ')) return { problem: 'A folder name cannot have \\ / : * ? " < > | in it, or end in a dot or a space.' };
  if (clean === basename(dir)) return { dir };
  if (recordingRuns()) return { problem: 'Cuttle is recording. Rename the project after the stop.' };
  if (await editorLockOf(dir)) return { problem: 'The project is open in Cuttle. Close its editor first.' };
  const target = join(dirname(dir), clean);
  // a name that differs only in case is the same folder on Windows: renamed in place
  if (existsSync(target) && !sameDir(target, dir)) return { problem: `There is already a folder named "${clean}" there.` };
  try {
    await rename(dir, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { problem: code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' ? 'A program is using a file in the project (a player, a terminal there?). Close it and try again.' : (error as Error).message };
  }
  await updateSettings((settings) => {
    settings.recent = settings.recent.map((entry) => (sameDir(entry.dir, dir) ? { ...entry, dir: target, name: clean } : entry));
    settings.uncut = settings.uncut.map((entry) => (sameDir(entry, dir) ? target : entry));
  });
  return { dir: target };
}

/** Starts with the computer, or not (the check never registers a login item: it keeps what was asked). */
export function applyLoginItem(open: boolean): void {
  if (CHECK) {
    (globalThis as { __loginItem?: boolean }).__loginItem = open;
    return;
  }
  // unpacked from the repository (pnpm app), Electron needs the app's folder as an argument
  app.setLoginItemSettings({ openAtLogin: open, ...(!app.isPackaged && { path: process.execPath, args: [app.getAppPath()] }) });
}

/** Tells every window how motion is set now. */
function broadcastMotion(motion: Motion): void {
  for (const window of BrowserWindow.getAllWindows()) send(window.webContents, 'app:motion', motion);
}
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
import { PROJECT_FILE, backupFile, writeProjectFile, type ProjectFile } from '@cuttle/core';
import { parseProject } from '@cuttle/project';
import { plainIssue } from '../shared/format';
import type { ExportEnd, ProjectFileEvent, ProjectStatus } from '../shared/ipc';
import { isInside } from '../shared/media-path';
import { CHECK, CHECK_IMAGE, HIDDEN } from './check';
import { ExportRun, exportPath } from './export-service';
```

with:

```ts
import { PROJECT_FILE, backupFile, writeProjectFile, type ProjectFile } from '@cuttle/core';
import { parseProject } from '@cuttle/project';
import { plainIssue } from '../shared/format';
import type { Event, Events, ExportEnd, ProjectFileEvent, ProjectStatus } from '../shared/ipc';
import { isInside } from '../shared/media-path';
import { CHECK, CHECK_IMAGE, HIDDEN } from './check';
import { ExportRun, exportPath } from './export-service';
```

In the same file, replace:

```ts
import { LockedError, lockProject, openProjectFile, projectInfo } from './project';
import { importImage, ProjectFileWatch } from './project-watch';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
import { cutIfPending, recut, startPicking } from './recording';
import { addRecent, loadSettings, updateSettings } from './settings';

const BACKGROUND = '#0c0c0f';
const TITLE_BAR_HEIGHT = 44;
```

with:

```ts
import { LockedError, lockProject, openProjectFile, projectInfo } from './project';
import { importImage, ProjectFileWatch } from './project-watch';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
import { cutIfPending, recut, startPicking, undoRestart } from './recording';
import { addRecent, loadSettings, motionSetting, updateSettings } from './settings';
import { openSettings } from './settings-window';

const BACKGROUND = '#0c0c0f';
const TITLE_BAR_HEIGHT = 44;
```

In the same file, replace:

```ts

export const webPreferences = (preload: string, ses: Session) => ({
  preload: bundlePath('preload', preload),
  session: ses,
  sandbox: true,
  contextIsolation: true,
```

with:

```ts

export const webPreferences = (preload: string, ses: Session) => ({
  preload: bundlePath('preload', preload),
  // how motion is set when the window is made (`app:motion` changes it later)
  additionalArguments: [`--cuttle-motion=${motionSetting()}`],
  session: ses,
  sandbox: true,
  contextIsolation: true,
```

In the same file, replace:

```ts
    'project:record': () => void startPicking(dir),
    'project:takes': () => takesMenu(dir, window),
    'project:cut': () => void recut(dir),
    'project:save': ({ raw, base }) => editor.watch.save(raw, base),
    'project:draft': ({ raw }) => writeFile(join(dir, DRAFT_FILE), `${JSON.stringify(raw, null, 2)}\n`),
    // contents.reload() from here is not a navigation the page started (guard() refuses those)
```

with:

```ts
    'project:record': () => void startPicking(dir),
    'project:takes': () => takesMenu(dir, window),
    'project:cut': () => void recut(dir),
    'project:undo-restart': (discarded) => void undoRestart(dir, discarded),
    'app:settings': () => void openSettings(),
    'project:save': ({ raw, base }) => editor.watch.save(raw, base),
    'project:draft': ({ raw }) => writeFile(join(dir, DRAFT_FILE), `${JSON.stringify(raw, null, 2)}\n`),
    // contents.reload() from here is not a navigation the page started (guard() refuses those)
```

In the same file, replace:

```ts
}

/** Shows what the main process does to a project (`undefined`: nothing) in its editor's title bar. */
export async function setEditorStatus(dir: string, status: ProjectStatus | undefined): Promise<void> {
  const editor = await editorOf(dir);
  if (!editor) return;
```

with:

```ts
}

/** Shows what the main process does to a project (`undefined`: nothing) in its editor's title bar. */
/** Sends an event to the project's editor, when one is open. */
export async function sendToEditor<E extends Event>(dir: string, channel: E, payload: Events[E]): Promise<void> {
  const editor = await editorOf(dir);
  if (editor && !editor.window.isDestroyed()) send(editor.contents, channel, payload);
}

export async function setEditorStatus(dir: string, status: ProjectStatus | undefined): Promise<void> {
  const editor = await editorOf(dir);
  if (!editor) return;
```

In the same file, replace:

```ts
          : recent.map((entry) => ({ label: recentLabel(entry), toolTip: entry.dir, click: () => void openEditorOrSay(entry.dir) }))),
        { type: 'separator' },
        { label: 'Open folder…', click: () => void chooseAndOpen() },
      ]).popup({ window });
    },
  });
```

with:

```ts
          : recent.map((entry) => ({ label: recentLabel(entry), toolTip: entry.dir, click: () => void openEditorOrSay(entry.dir) }))),
        { type: 'separator' },
        { label: 'Open folder…', click: () => void chooseAndOpen() },
        { label: 'Settings…', click: () => void openSettings() },
      ]).popup({ window });
    },
  });
```

In `apps/desktop/src/main/tray.ts`, replace:

```ts
import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { Settings } from './settings';

/** A recent project in a menu: its name, and its parent folder to tell same-named projects apart. */
const label = (entry: { dir: string; name: string }) => `${entry.name} — ${entry.dir.split(/[\\/]/).at(-2) ?? ''}`;
```

with:

```ts
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { appVersion, type Settings } from './settings';

/** A recent project in a menu: its name, and its parent folder to tell same-named projects apart. */
const label = (entry: { dir: string; name: string }) => `${entry.name} — ${entry.dir.split(/[\\/]/).at(-2) ?? ''}`;
```

In the same file, replace:

```ts
  record(): void;
  showPill(): void;
  open(dir?: string): void;
  quit(): void;
}

/** The tray menu: a new recording, show the pill, the recent projects, open a folder, quit. */
export function trayMenu(recent: Settings['recent'], actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: 'New recording', accelerator: 'Control+Shift+Alt+R', click: () => actions.record() },
```

with:

```ts
  record(): void;
  showPill(): void;
  open(dir?: string): void;
  settings(): void;
  quit(): void;
}

/** The tray menu: a new recording, show the pill, the recent projects, open a folder, the settings, quit. */
export function trayMenu(recent: Settings['recent'], actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: 'New recording', accelerator: 'Control+Shift+Alt+R', click: () => actions.record() },
```

In the same file, replace:

```ts
      : recent.map((entry) => ({ label: label(entry), toolTip: entry.dir, click: () => actions.open(entry.dir) }))),
    { type: 'separator' },
    { label: 'Open folder…', click: () => actions.open() },
    { type: 'separator' },
    { label: 'Quit Cuttle', click: () => actions.quit() },
  ];
```

with:

```ts
      : recent.map((entry) => ({ label: label(entry), toolTip: entry.dir, click: () => actions.open(entry.dir) }))),
    { type: 'separator' },
    { label: 'Open folder…', click: () => actions.open() },
    { label: 'Settings…', click: () => actions.settings() },
    { type: 'separator' },
    { label: 'Quit Cuttle', click: () => actions.quit() },
  ];
```

In the same file, replace:

```ts
export function createTray(icon: string, recent: Settings['recent'], actions: TrayActions): Tray {
  tray?.destroy();
  tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip(`Cuttle ${app.getVersion()}`);
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu(recent, actions)));
  tray.on('click', () => actions.showPill());
  return tray;
```

with:

```ts
export function createTray(icon: string, recent: Settings['recent'], actions: TrayActions): Tray {
  tray?.destroy();
  tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip(`Cuttle ${appVersion()}`);
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu(recent, actions)));
  tray.on('click', () => actions.showPill());
  return tray;
```

In `apps/desktop/src/main/index.ts`, replace:

```ts
// The Cuttle app's main process: one instance, a tray icon and the pill; editors per project.
// `--open <folder>` (also from a second launch) opens a project. The end-to-end check passes
// --cuttle-check with CUTTLE_HIDDEN=1 (no window is shown); CUTTLE_USER_DATA moves the settings.
import { resolve } from 'node:path';
import { app, globalShortcut, Menu, session } from 'electron';
import { HIDDEN } from './check';
```

with:

```ts
// The Cuttle app's main process: one instance, a tray icon and the pill; editors per project.
// `--open <folder>` (also from a second launch) opens a project, `--settings` the settings; the
// first plain start shows the first run. The end-to-end check passes --cuttle-check with
// CUTTLE_HIDDEN=1 (no window is shown); CUTTLE_USER_DATA moves the settings.
import { resolve } from 'node:path';
import { app, globalShortcut, Menu, session } from 'electron';
import { HIDDEN } from './check';
```

In the same file, replace:

```ts
import { startPicking, stopForQuit, recordingRuns } from './recording';
import { assetPath, registerSchemes } from './protocols';
import { loadSettings, onSettingsChange } from './settings';
import { createTray, updateTray, type TrayActions } from './tray';
import { chooseAndOpen, createPill, lockDown, openEditorOrSay, showPill } from './windows';
```

with:

```ts
import { startPicking, stopForQuit, recordingRuns } from './recording';
import { assetPath, registerSchemes } from './protocols';
import { loadSettings, onSettingsChange } from './settings';
import { openSettings } from './settings-window';
import { findFfmpeg } from './tools';
import { createTray, updateTray, type TrayActions } from './tray';
import { chooseAndOpen, createPill, lockDown, openEditorOrSay, showPill } from './windows';
```

In the same file, replace:

```ts
    record: () => void startPicking(),
    showPill: () => void showPill(),
    open: (dir) => void (dir ? openEditorOrSay(dir) : chooseAndOpen()),
    quit: () => app.quit(),
  };

  app.on('second-instance', (_event, argv, workingDirectory) => {
    const dir = openArgument(argv, workingDirectory);
    if (dir) void openEditorOrSay(dir);
    else void showPill();
  });
```

with:

```ts
    record: () => void startPicking(),
    showPill: () => void showPill(),
    open: (dir) => void (dir ? openEditorOrSay(dir) : chooseAndOpen()),
    settings: () => void openSettings(),
    quit: () => app.quit(),
  };

  app.on('second-instance', (_event, argv, workingDirectory) => {
    const dir = openArgument(argv, workingDirectory);
    if (dir) void openEditorOrSay(dir);
    else if (argv.includes('--settings')) void openSettings();
    else void showPill();
  });
```

In the same file, replace:

```ts
    if (!HIDDEN) globalShortcut.register('Control+Shift+Alt+R', () => void startPicking());
    const dir = openArgument(process.argv, process.cwd());
    if (dir) await openEditorOrSay(dir);
    else await showPill();
    onSettingsChange((latest) => updateTray(latest.recent, actions));
  });
}
```

with:

```ts
    if (!HIDDEN) globalShortcut.register('Control+Shift+Alt+R', () => void startPicking());
    const dir = openArgument(process.argv, process.cwd());
    if (dir) await openEditorOrSay(dir);
    else if (process.argv.includes('--settings')) await openSettings();
    // the first plain start welcomes (ffmpeg, the cuttle command and the skill), then the pill
    else if (!settings.welcomed) await openSettings({ welcome: true });
    else await showPill();
    // ffmpeg where the OS has it now (installed since the last login, say): the helpers start with it
    void findFfmpeg().catch(() => undefined);
    onSettingsChange((latest) => updateTray(latest.recent, actions));
  });
}
```

In `apps/desktop/src/preload/bridge.ts`, replace:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { STREAM_EVENTS, WINDOW_CHANNELS, type WindowKind } from '../shared/channels';

export function exposeBridge(kind: WindowKind): void {
  const requests: readonly string[] = WINDOW_CHANNELS[kind].requests;
  const events: readonly string[] = WINDOW_CHANNELS[kind].events;
  // An event that says a state (the HUD's, a status, the media) is kept, so a listener that
```

with:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { STREAM_EVENTS, WINDOW_CHANNELS, type WindowKind } from '../shared/channels';

/**
 * How motion is set, as `data-motion` on the page's root: `reduce` turns animation off, `full`
 * keeps it when the OS asks for less, `system` follows the OS (the CSS's media query).
 */
function followMotion(): void {
  const apply = (motion: unknown) => {
    if (typeof motion === 'string' && document.documentElement) document.documentElement.dataset.motion = motion;
  };
  const initial = process.argv.find((arg) => arg.startsWith('--cuttle-motion='))?.slice('--cuttle-motion='.length);
  if (document.documentElement) apply(initial);
  else document.addEventListener('DOMContentLoaded', () => apply(initial), { once: true });
  ipcRenderer.on('app:motion', (_event, motion: unknown) => apply(motion));
}

export function exposeBridge(kind: WindowKind): void {
  followMotion();
  const requests: readonly string[] = WINDOW_CHANNELS[kind].requests;
  const events: readonly string[] = WINDOW_CHANNELS[kind].events;
  // An event that says a state (the HUD's, a status, the media) is kept, so a listener that
```

`apps/desktop/src/preload/settings.ts`:

```ts
import { exposeBridge } from './bridge';

exposeBridge('settings');
```

In `apps/desktop/scripts/build.mjs`, replace:

```js

rmSync(at('dist'), { recursive: true, force: true });
await build({ configFile: at('vite.main.config.ts') });
for (const kind of ['editor', 'pill', 'picker', 'hud', 'countdown']) {
  await build({
    configFile: false,
    root: desktop,
```

with:

```js

rmSync(at('dist'), { recursive: true, force: true });
await build({ configFile: at('vite.main.config.ts') });
for (const kind of ['editor', 'pill', 'picker', 'hud', 'countdown', 'settings']) {
  await build({
    configFile: false,
    root: desktop,
```

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/workers apps/desktop/scripts/build.mjs
git commit -m "desktop: pause and restart from the HUD; ffmpeg found as the OS has it now; the app installs the cuttle command and the skill; the settings window and the first run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The pages: the HUD, the settings, the editor's notes and empty states

**Files:**
- Create: `apps/desktop/src/renderer/settings.html`, `apps/desktop/src/renderer/settings/{main.tsx,Settings.tsx,settings.css}`, `apps/desktop/test/doc.test.ts`
- Modify: `apps/desktop/vite.renderer.config.ts`, `apps/desktop/src/renderer/tokens.css`, `apps/desktop/src/renderer/picker/{Hud.tsx,picker.css}`, `apps/desktop/src/renderer/editor/{App.tsx,Timeline.tsx,commands.ts,doc.ts,session.ts,editor.css}`

- [ ] **Step 1: Write the failing test (two undos within one write)**

`apps/desktop/test/doc.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

// The renderer's document with a main process that takes a while for each write: an undo comes in
// while the write of the one before still runs.
const written: unknown[] = [];
let writes = 0;
vi.mock('../src/renderer/bridge', () => ({
  bridge: {
    invoke: (channel: string, argument: { raw: unknown }) => {
      if (channel !== 'project:save') return Promise.resolve(undefined);
      return new Promise((resolve) =>
        setTimeout(() => {
          written.push(argument.raw);
          resolve({ hash: String(++writes).padStart(64, '0') });
        }, 30),
      );
    },
    on: () => () => {},
  },
}));
vi.mock('../src/renderer/editor/session', async () => {
  const { createStore } = await import('../src/renderer/editor/store');
  return { store: createStore<{ doc?: unknown }>({}) };
});

const { edit, flush, openDocument, undo } = await import('../src/renderer/editor/doc');
const { store } = await import('../src/renderer/editor/session');

const raw = {
  version: 1,
  sources: { screen: 'takes/1/screen.mp4' },
  scenes: [{ type: 'clip', id: 's1', from: 0, to: 8 }],
};
const limits = { sourceEnd: 8, screen: { width: 1280, height: 800 }, fps: 30 };
const zoom = (at: number) => ({ type: 'add' as const, list: 'zooms' as const, item: { at, duration: 1, rect: [0, 0, 640, 400] } });

describe('the editor document', () => {
  it('writes every undo, also one pressed while the write before it still runs', async () => {
    store.set({ doc: openDocument(raw, '0'.repeat(64), () => limits) });
    edit([zoom(1)], 'Draw zoom');
    edit([zoom(3)], 'Draw zoom');
    expect(await flush()).toBe(true);
    // two undos at once: the second comes while the first one's write runs
    undo();
    undo();
    expect(await flush()).toBe(true);
    const doc = (store.get() as { doc: { raw: { zooms?: unknown[] } } }).doc;
    expect(doc.raw.zooms ?? []).toEqual([]);
    expect((written.at(-1) as { zooms?: unknown[] }).zooms ?? []).toEqual([]);
  });
});
```

Run: `pnpm exec vitest run --project node apps/desktop/test/doc.test.ts`
Expected: FAIL: the last write still has the zoom at 1 s (`expected [ { at: 1, … } ] to deeply equal []`).

- [ ] **Step 2: The editor's document: restores counted, the restart offer**

In `apps/desktop/src/renderer/editor/doc.ts`, replace:

```ts
  toast?: Toast;
  /** A version a conflict set aside (cuttle.json.draft), offered back ("Use mine") until answered: why. */
  draftNote?: string;
}

const undoStack: Step[] = [];
```

with:

```ts
  toast?: Toast;
  /** A version a conflict set aside (cuttle.json.draft), offered back ("Use mine") until answered: why. */
  draftNote?: string;
  /** The take a restart put aside (its folder in the project), offered back ("Undo restart") until answered. */
  restartNote?: string;
}

const undoStack: Step[] = [];
```

In the same file, replace:

```ts
let unsaved: { label: string; commands: Command[] }[] = [];
/** A whole version to write (undo, redo, an outside change undone), instead of replaying commands. */
let unsavedRestore = false;
let saving: Promise<void> | undefined;
/** The person's version a save conflict could not carry over (also in cuttle.json.draft), until answered. */
let draft: Raw | undefined;
```

with:

```ts
let unsaved: { label: string; commands: Command[] }[] = [];
/** A whole version to write (undo, redo, an outside change undone), instead of replaying commands. */
let unsavedRestore = false;
/** Counts the restores: a write ends one only when no newer one came while it ran (two fast undos). */
let restores = 0;
let saving: Promise<void> | undefined;
/** The person's version a save conflict could not carry over (also in cuttle.json.draft), until answered. */
let draft: Raw | undefined;
```

In the same file, replace:

```ts
  setDoc({ toast: undefined });
}

/** Declines the draft: cuttle.json.draft stays on disk, the offer goes. */
export function dismissDraft(): void {
  draft = undefined;
```

with:

```ts
  setDoc({ toast: undefined });
}

/** The take was restarted: the one before is offered back, in a note no other note replaces. */
export function offerUndoRestart(discarded: string): void {
  setDoc({ restartNote: discarded });
}

/** Keeps the new take: the one before stays put aside (takes/.discarded), the offer goes. */
export function dismissRestart(): void {
  setDoc({ restartNote: undefined });
}

/** Declines the draft: cuttle.json.draft stays on disk, the offer goes. */
export function dismissDraft(): void {
  draft = undefined;
```

In the same file, replace:

```ts

function restore(raw: Raw): void {
  unsavedRestore = true;
  unsaved = [];
  setDoc({ raw, project: parse(raw), preview: undefined, toast: undefined });
  void save();
```

with:

```ts

function restore(raw: Raw): void {
  unsavedRestore = true;
  restores++;
  unsaved = [];
  setDoc({ raw, project: parse(raw), preview: undefined, toast: undefined });
  void save();
```

In the same file, replace:

```ts
      const { raw, hash } = doc();
      const writing = unsaved.length;
      const restoring = unsavedRestore;
      const answer = await bridge.invoke('project:save', { raw, base: hash }).catch((error: Error) => ({ problem: error.message }));
      if ('hash' in answer) {
        unsaved = unsaved.slice(writing);
        if (restoring) unsavedRestore = false;
        setDoc({ hash: answer.hash, problem: undefined });
        return finish();
      }
```

with:

```ts
      const { raw, hash } = doc();
      const writing = unsaved.length;
      const restoring = unsavedRestore;
      const restored = restores;
      const answer = await bridge.invoke('project:save', { raw, base: hash }).catch((error: Error) => ({ problem: error.message }));
      if ('hash' in answer) {
        unsaved = unsaved.slice(writing);
        // a restore that came while this one was written still has to be written (the save chained after this)
        if (restoring && restored === restores) unsavedRestore = false;
        setDoc({ hash: answer.hash, problem: undefined });
        return finish();
      }
```

In `apps/desktop/src/renderer/editor/session.ts`, replace:

```ts
import type { ExportEnd, ExportProgress, ExportTarget, MediaState, ProjectInfo, ProjectStatus } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { beforeClose, dismissToast, edit, flush, openDocument, outsideChange, redo, undo, type DocState } from './doc';
import { ensureMedia, openProjectMedia, openVideo, type EditorMedia } from './media';
import { Player, type PlayerState } from './player';
import { createStore } from './store';
```

with:

```ts
import type { ExportEnd, ExportProgress, ExportTarget, MediaState, ProjectInfo, ProjectStatus } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { beforeClose, dismissToast, edit, flush, offerUndoRestart, openDocument, outsideChange, redo, undo, type DocState } from './doc';
import { ensureMedia, openProjectMedia, openVideo, type EditorMedia } from './media';
import { Player, type PlayerState } from './player';
import { createStore } from './store';
```

In the same file, replace:

```ts
    bridge.on('export:end', (end) => store.set((state) => ({ exportEnd: end, exporting: false, exportUnseen: !state.exportOpen })));
    // (another take reloads the editor: outsideChange asks the main process)
    bridge.on('project:file', (event) => void outsideChange(event));
  } catch (error) {
    store.set({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
```

with:

```ts
    bridge.on('export:end', (end) => store.set((state) => ({ exportEnd: end, exporting: false, exportUnseen: !state.exportOpen })));
    // (another take reloads the editor: outsideChange asks the main process)
    bridge.on('project:file', (event) => void outsideChange(event));
    // A restarted take: the one before it is kept aside, and can be the take again.
    bridge.on('project:restarted', ({ discarded }) => offerUndoRestart(discarded));
  } catch (error) {
    store.set({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
```

In the same file, replace:

```ts
      /** The document as edited, and whether it is saved. */
      doc: () => {
        const doc = store.get().doc!;
        return { raw: doc.raw, hash: doc.hash, saving: doc.saving, problem: doc.problem, issues: doc.issues, toast: doc.toast, draftNote: doc.draftNote, undo: doc.undoLabel, redo: doc.redoLabel };
      },
      edit: (commands: Command[], label: string) => edit(commands, label),
      undo,
```

with:

```ts
      /** The document as edited, and whether it is saved. */
      doc: () => {
        const doc = store.get().doc!;
        return { raw: doc.raw, hash: doc.hash, saving: doc.saving, problem: doc.problem, issues: doc.issues, toast: doc.toast, draftNote: doc.draftNote, restartNote: doc.restartNote, undo: doc.undoLabel, redo: doc.redoLabel };
      },
      edit: (commands: Command[], label: string) => edit(commands, label),
      undo,
```

In the same file, replace:

```ts

/** Opens the export sheet: on the running export or one that ended unseen, else on a new one. */
export function openExport(): void {
  const { phase, exporting, exportUnseen } = store.get();
  if (phase !== 'ready') return;
  store.set({ exportOpen: true, exportUnseen: false, ...(!exporting && !exportUnseen && { exportEnd: undefined, exportProgress: undefined }) });
}
```

with:

```ts

/** Opens the export sheet: on the running export or one that ended unseen, else on a new one. */
export function openExport(): void {
  const { phase, exporting, exportUnseen, doc } = store.get();
  // nothing to export without a scene (the title bar's Export is off then too)
  if (phase !== 'ready' || (!exporting && (doc?.project.scenes.length ?? 0) === 0)) return;
  store.set({ exportOpen: true, exportUnseen: false, ...(!exporting && !exportUnseen && { exportEnd: undefined, exportProgress: undefined }) });
}
```

Run: `pnpm exec vitest run --project node apps/desktop/test/doc.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 3: The HUD: pause, resume, a held restart**

In `apps/desktop/src/renderer/picker/Hud.tsx`, replace:

```
// The recording HUD: the time, a warning when there is one, a marker and Stop. It is never in the
// video (content protection), never takes the focus (the recorded window keeps it), and its area is
// a dead zone for the input log. Its width is fixed, so Stop never moves under the pointer.
import { useEffect, useState } from 'react';
import type { HudState } from '../../shared/ipc';
import { bridge } from '../bridge';
import { WarningIcon } from '../icons';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function Hud() {
  const [state, setState] = useState<HudState>({ phase: 'countdown', markers: 0 });
```

with:

```
// The recording HUD: the time, a warning when there is one, restart, a marker, pause and Stop. It
// is never in the video (content protection), never takes the focus (the recorded window keeps it),
// and its area is a dead zone for the input log. Its width is fixed, so Stop never moves under the
// pointer. Restart asks for a press held 600 ms, so a stray click does not put a take aside.
import { useEffect, useRef, useState } from 'react';
import type { HudState } from '../../shared/ipc';
import { bridge } from '../bridge';
import { WarningIcon } from '../icons';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
/** How long Restart must be held. */
const HOLD_MS = 600;

export function Hud() {
  const [state, setState] = useState<HudState>({ phase: 'countdown', markers: 0 });
```

In the same file, replace:

```
      clearInterval(timer);
    };
  }, []);
  const seconds = state.startedAt ? Math.max(0, (now - state.startedAt) / 1000) : 0;
  return (
    <div className="hud-wrap">
      <div className={`hud${state.phase === 'recording' ? '' : ' stopping'}`} role="toolbar" aria-label="Recording">
        <span className="dot" />
        <span className="time" data-testid="hud-time">
          {clock(seconds)}
```

with:

```
      clearInterval(timer);
    };
  }, []);
  // The take's time: what was recorded before, plus the running stretch (it stands still while paused).
  const seconds = (state.recorded ?? 0) + (state.startedAt ? Math.max(0, (now - state.startedAt) / 1000) : 0);
  const paused = state.phase === 'paused';
  const live = state.phase === 'recording' || paused;
  return (
    <div className="hud-wrap">
      <div className={`hud ${state.phase}`} role="toolbar" aria-label="Recording">
        <span className="dot" />
        <span className="time" data-testid="hud-time">
          {clock(seconds)}
```

In the same file, replace:

```
          )}
        </span>
        <span className="sep" />
        <button
          className={`marker${flash ? ' flash' : ''}`}
          onClick={() => void bridge.invoke('hud:marker')}
          title={`Set a marker (Ctrl+Shift+Alt+M)${state.markers > 0 ? `: ${state.markers} so far` : ''}`}
          aria-label="Set a marker"
          disabled={state.phase !== 'recording'}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M4 14V2.5h8l-2 3 2 3H4" />
          </svg>
          {state.markers > 0 && <small>{state.markers}</small>}
        </button>
        <button className="stop" onClick={() => void bridge.invoke('hud:stop')} title="Stop (Ctrl+Shift+Alt+S)" aria-label="Stop the recording" data-testid="hud-stop" disabled={state.phase === 'stopping'}>
          <i />
        </button>
```

with:

```
          )}
        </span>
        <span className="sep" />
        <RestartButton disabled={!live} />
        <button
          className={`marker${flash ? ' flash' : ''}`}
          onClick={() => void bridge.invoke('hud:marker')}
          title={`Set a marker (Ctrl+Shift+Alt+M)${state.markers > 0 ? `: ${state.markers} so far` : ''}`}
          aria-label="Set a marker"
          disabled={!live}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M4 14V2.5h8l-2 3 2 3H4" />
          </svg>
          {state.markers > 0 && <small>{state.markers}</small>}
        </button>
        <button
          className={`pause${paused ? ' paused' : ''}`}
          onClick={() => void bridge.invoke(paused ? 'hud:resume' : 'hud:pause')}
          title={paused ? 'Resume (Ctrl+Shift+Alt+P)' : 'Pause: nothing is recorded until you resume (Ctrl+Shift+Alt+P)'}
          aria-label={paused ? 'Resume the recording' : 'Pause the recording'}
          aria-pressed={paused}
          disabled={!live}
          data-testid="hud-pause"
        >
          {paused ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M4.5 2.8v10.4L13 8z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
              <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
            </svg>
          )}
        </button>
        <button className="stop" onClick={() => void bridge.invoke('hud:stop')} title="Stop (Ctrl+Shift+Alt+S)" aria-label="Stop the recording" data-testid="hud-stop" disabled={state.phase === 'stopping'}>
          <i />
        </button>
```

In the same file, replace:

```
    </div>
  );
}
```

with:

```
    </div>
  );
}

/** Restart: held 600 ms (a ring fills meanwhile); let go earlier and nothing happens. */
function RestartButton({ disabled }: { disabled: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const release = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className={`restart${holding ? ' holding' : ''}`}
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        setHolding(true);
        timer.current = setTimeout(() => {
          setHolding(false);
          void bridge.invoke('hud:restart');
        }, HOLD_MS);
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      title="Hold to restart: this take is put aside (the editor can bring it back) and the countdown starts again"
      aria-label="Restart the recording (hold)"
      data-testid="hud-restart"
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5v2.2h2.2" />
      </svg>
      <span className="ring" aria-hidden="true" />
    </button>
  );
}
```

In `apps/desktop/src/renderer/picker/picker.css`, replace:

```
  place-items: center;
}
.hud {
  width: 360px;
  height: 48px;
  display: flex;
  align-items: center;
```

with:

```
  place-items: center;
}
.hud {
  width: 420px;
  height: 48px;
  display: flex;
  align-items: center;
```

In the same file, replace:

```
  box-shadow: 0 0 0 4px rgba(255, 77, 79, 0.22);
  animation: pulse 1.6s ease-in-out infinite;
}
.hud.stopping .dot {
  background: var(--muted);
  box-shadow: none;
  animation: none;
}
.hud .time {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
```

with:

```
  box-shadow: 0 0 0 4px rgba(255, 77, 79, 0.22);
  animation: pulse 1.6s ease-in-out infinite;
}
.hud.stopping .dot,
.hud.resuming .dot,
.hud.countdown .dot {
  background: var(--muted);
  box-shadow: none;
  animation: none;
}
/* paused: the dot stands still in amber, the time stands still too */
.hud.paused .dot {
  background: var(--card);
  box-shadow: 0 0 0 4px rgba(242, 179, 74, 0.2);
  animation: none;
}
.hud.paused .time {
  color: var(--card);
}
.hud button.pause.paused {
  color: var(--text);
  background: var(--raised);
}
/* restart: a ring fills while it is held */
.hud button.restart {
  position: relative;
}
.hud button.restart .ring {
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
}
.hud button.restart.holding .ring {
  opacity: 1;
  background: conic-gradient(var(--text) calc(var(--held, 0) * 1turn), transparent 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
  animation: hold 600ms linear forwards;
}
@property --held {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}
@keyframes hold {
  to {
    --held: 1;
  }
}
.hud .time {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
```

In the same file, replace:

```
  }
}
@media (prefers-reduced-motion: reduce) {
  .countdown b,
  .hud .dot {
    animation: none;
  }
}
```

with:

```
  }
}
@media (prefers-reduced-motion: reduce) {
  :root:not([data-motion='full']) .countdown b,
  :root:not([data-motion='full']) .hud .dot {
    animation: none;
  }
}
:root[data-motion='reduce'] .countdown b,
:root[data-motion='reduce'] .hud .dot {
  animation: none;
}
```

In `apps/desktop/src/renderer/tokens.css`, replace:

```
  --focus: 0 0 0 2px var(--accent);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --fast: 0ms;
    --normal: 0ms;
    --slow: 0ms;
  }
}
```

with:

```
  --focus: 0 0 0 2px var(--accent);
}

/* Motion: the OS's setting, unless the settings say always reduced or always full. */
@media (prefers-reduced-motion: reduce) {
  :root:not([data-motion='full']) {
    --fast: 0ms;
    --normal: 0ms;
    --slow: 0ms;
  }
}
:root[data-motion='reduce'] {
  --fast: 0ms;
  --normal: 0ms;
  --slow: 0ms;
}
```

- [ ] **Step 4: The settings page**

`apps/desktop/src/renderer/settings.html`:

```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cuttle settings</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./settings/main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/renderer/settings/main.tsx`:

```
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../base.css';
import './settings.css';
import { Settings } from './Settings';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Settings />
  </StrictMode>,
);
```

`apps/desktop/src/renderer/settings/Settings.tsx`:

```
// The settings window, and the first run in the same window (#welcome): ffmpeg, the cuttle command
// and the Claude skill, then the pill. Every change is kept at once; there is no Save.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Motion, RequestArgument, SettingsView, ToolsStatus } from '../../shared/ipc';
import { bridge } from '../bridge';
import { CheckIcon, CopyIcon, FolderIcon, Mark, WarningIcon } from '../icons';

const WINGET = 'winget install Gyan.FFmpeg';

type Devices = { cameras: string[]; mics: string[]; problem?: string };

/** A path as people read it: the user's folder as ~ (the whole path is in the tooltip). */
const shortPath = (path: string) => path.replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\)/i, '~').replace(/^\/(home|Users)\/[^/]+(?=\/)/, '~');
/** "9.0" from "9.0-full_build-www.gyan.dev". */
const shortVersion = (version: string) => /^n?(\d+(\.\d+)*)/.exec(version)?.[1] ?? version;

/** A request's failure, said in its first line (the rest is for logs). */
const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').split('\n')[0]!;

export function Settings() {
  const welcome = location.hash === '#welcome';
  const [view, setView] = useState<SettingsView>();
  const [tools, setTools] = useState<ToolsStatus>();
  const [devices, setDevices] = useState<Devices>();

  useEffect(() => {
    void bridge.invoke('settings:get').then(setView);
    void bridge.invoke('tools:status').then(setTools);
    void bridge.invoke('settings:devices').then(setDevices);
    return bridge.on('settings:changed', setView);
  }, []);

  const change = (next: RequestArgument<'settings:set'>) => void bridge.invoke('settings:set', next).then(setView);

  return (
    <div className="settings" data-mode={welcome ? 'welcome' : 'settings'} data-testid="settings">
      <header className="drag">{welcome ? 'Welcome to Cuttle' : 'Settings'}</header>
      <main>
        {welcome ? (
          <Welcome tools={tools} setTools={setTools} />
        ) : (
          <>
            <Section title="Recording">
              <Row label="Projects folder" hint="Every new recording gets a folder here, named by its date and time." stacked>
                <div className="path-row">
                  <span className="path" title={view?.projectsFolder} data-testid="projects-folder">
                    {view ? shortPath(view.projectsFolder) : ''}
                  </span>
                  <button className="ghost" onClick={() => void bridge.invoke('settings:choose-folder').then(setView)} data-testid="choose-folder">
                    Change…
                  </button>
                </div>
              </Row>
              <Row label="Countdown" hint="Before a recording starts, over what is recorded.">
                <Segmented
                  value={view?.countdown}
                  options={[
                    [0, 'Off'],
                    [3, '3 s'],
                    [5, '5 s'],
                  ]}
                  onChange={(countdown) => change({ countdown })}
                  label="Countdown"
                  testid="countdown"
                />
              </Row>
              <Row label="Camera" hint={devices?.problem ?? 'Shown as a bubble in the corner. The picker can change it for one recording.'}>
                <DeviceSelect kind="camera" value={view?.camera} devices={devices?.cameras} onChange={(camera) => change({ camera })} />
              </Row>
              <Row label="Microphone">
                <DeviceSelect kind="mic" value={view?.mic} devices={devices?.mics} onChange={(mic) => change({ mic })} />
              </Row>
            </Section>

            <Section title="Tools">
              <Tools tools={tools} setTools={setTools} />
            </Section>

            <Section title="App">
              <Row label="Start Cuttle when you sign in" hint="It waits in the tray; Ctrl+Shift+Alt+R starts a recording.">
                <button
                  className="toggle"
                  role="switch"
                  aria-checked={view?.launchAtLogin ?? false}
                  aria-label="Start Cuttle when you sign in"
                  onClick={() => view && change({ launchAtLogin: !view.launchAtLogin })}
                  data-testid="launch-at-login"
                >
                  <i />
                </button>
              </Row>
              <Row label="Motion" hint="Animations in Cuttle's windows. The video is not affected.">
                <Segmented<Motion>
                  value={view?.motion}
                  options={[
                    ['system', 'Like Windows'],
                    ['reduce', 'Less'],
                    ['full', 'Full'],
                  ]}
                  onChange={(motion) => change({ motion })}
                  label="Motion"
                  testid="motion"
                />
              </Row>
            </Section>

            <Section title="Recent projects">
              <Recent view={view} />
            </Section>
            <p className="version">Cuttle {view?.version}</p>
          </>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="card">{children}</div>
    </section>
  );
}

function Row({ label, hint, stacked, children }: { label: string; hint?: string; stacked?: boolean; children: ReactNode }) {
  return (
    <div className={`row${stacked ? ' stacked' : ''}`}>
      <div className="row-text">
        <div className="row-label">{label}</div>
        {hint && <div className="row-hint">{hint}</div>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, label, testid }: { value: T | undefined; options: [T, string][]; onChange: (value: T) => void; label: string; testid: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label} data-testid={testid}>
      {options.map(([option, text]) => (
        <button key={String(option)} role="radio" aria-checked={value === option} aria-pressed={value === option} onClick={() => onChange(option)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** A camera or mic: None, the devices listed, and the saved one when it is not plugged in now. */
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

/** ffmpeg, the cuttle command and the skill: what is there, and Install for what is not. */
function Tools({ tools, setTools }: { tools: ToolsStatus | undefined; setTools: (tools: ToolsStatus) => void }) {
  const [busy, setBusy] = useState<'check' | 'install'>();
  const [problem, setProblem] = useState<string>();
  const check = async () => {
    setBusy('check');
    try {
      setTools(await bridge.invoke('tools:check'));
    } finally {
      setBusy(undefined);
    }
  };
  const install = async () => {
    setBusy('install');
    setProblem(undefined);
    try {
      const answer = await bridge.invoke('tools:install');
      setTools(answer.status);
      setProblem(answer.problem);
    } catch (error) {
      setProblem(firstLine(error));
    } finally {
      setBusy(undefined);
    }
  };
  // Install while something is missing; Install again (quieter) rewrites the app's own copies, after the app moved
  const missing = tools !== undefined && (!tools.command || tools.skill.state === 'missing');
  const again = tools !== undefined && !missing && tools.command?.ours === true;
  return (
    <>
      <ToolLine
        ok={tools ? tools.ffmpeg !== undefined : undefined}
        name={tools?.ffmpeg ? `ffmpeg ${shortVersion(tools.ffmpeg.version)}` : 'ffmpeg'}
        detail={tools?.ffmpeg ? tools.ffmpeg.path : 'Missing. Cuttle records and exports with it: install it in a terminal, then check again.'}
        testid="tool-ffmpeg"
      >
        {tools && !tools.ffmpeg && (
          <>
            <Winget />
            <button className="ghost" onClick={() => void check()} disabled={busy !== undefined} data-testid="check-again">
              {busy === 'check' ? 'Looking…' : 'Check again'}
            </button>
          </>
        )}
      </ToolLine>
      <ToolLine ok={tools ? tools.command !== undefined : undefined} name="The cuttle command" detail={tools?.command ? tools.command.path : 'Claude runs it to record, cut and render.'} testid="tool-command" />
      <ToolLine
        ok={tools ? tools.skill.state === 'installed' : undefined}
        warn={tools?.skill.state === 'other'}
        name="The Claude skill"
        detail={tools?.skill.state === 'other' ? `${tools.skill.dir} holds a cuttle skill Cuttle did not install.` : tools?.skill.state === 'installed' ? tools.skill.dir : 'Tells Claude Code how to make a demo with Cuttle.'}
        testid="tool-skill"
      />
      <div className="tools-actions">
        <span className="row-hint" data-testid="tools-note">
          {problem ?? (tools?.newTerminal ? 'Open a new terminal: one opened before does not know the cuttle command yet.' : 'Claude Code finds both once they are installed.')}
        </span>
        {(missing || again) && (
          <button className={missing ? 'primary' : 'ghost'} onClick={() => void install()} disabled={busy !== undefined} data-testid="install-tools">
            {busy === 'install' ? 'Installing…' : missing ? 'Install' : 'Install again'}
          </button>
        )}
      </div>
    </>
  );
}

function ToolLine({ ok, warn, name, detail, testid, children }: { ok: boolean | undefined; warn?: boolean; name: string; detail: string; testid: string; children?: ReactNode }) {
  return (
    <div className="tool" data-state={ok === undefined ? 'unknown' : ok ? 'ok' : 'missing'} data-testid={testid}>
      <span className={`tool-mark${ok ? ' ok' : warn || ok === false ? ' warn' : ''}`} aria-hidden>
        {ok ? <CheckIcon size={12} /> : ok === false ? <WarningIcon size={12} /> : null}
      </span>
      <div className="tool-text">
        <div className="row-label">{name}</div>
        <div className={`row-hint${ok ? ' path-text' : ''}`} title={detail}>
          {ok === undefined ? 'Looking…' : ok ? shortPath(detail) : detail}
        </div>
        {children && <div className="tool-extra">{children}</div>}
      </div>
    </div>
  );
}

/** The command that installs ffmpeg, to copy into a terminal. */
function Winget() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="command"
      onClick={() => {
        void bridge.invoke('tools:copy', WINGET);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      title="Copy, then paste it in a terminal"
      data-testid="copy-winget"
    >
      <code>{WINGET}</code>
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

/** The recent projects: open, rename (its folder), show in the folder, take off the list. */
function Recent({ view }: { view: SettingsView | undefined }) {
  const [renaming, setRenaming] = useState<string>();
  const [problem, setProblem] = useState<{ dir: string; text: string }>();
  if (view && view.recent.length === 0) return <p className="empty">Projects you open or record show here.</p>;
  return (
    <ul className="recent" data-testid="recent">
      {view?.recent.map((entry) => (
        <li key={entry.dir}>
          {renaming === entry.dir ? (
            <RenameField
              initial={entry.name}
              onDone={async (name) => {
                if (name === undefined || name === entry.name) return setRenaming(undefined);
                const answer = await bridge.invoke('recent:rename', { dir: entry.dir, name });
                if ('problem' in answer) setProblem({ dir: entry.dir, text: answer.problem });
                else {
                  setProblem(undefined);
                  setRenaming(undefined);
                }
              }}
            />
          ) : (
            <button className="recent-name" onClick={() => void bridge.invoke('recent:open', entry.dir)} title={`Open ${entry.dir}`}>
              <b>{entry.name}</b>
              <span className="path-text">{shortPath(entry.dir.replace(/[\\/][^\\/]+$/, ''))}</span>
            </button>
          )}
          {renaming !== entry.dir && (
            <span className="recent-actions">
              <button
                onClick={() => {
                  setProblem(undefined);
                  setRenaming(entry.dir);
                }}
                data-testid="recent-rename"
              >
                Rename
              </button>
              <button onClick={() => void bridge.invoke('recent:reveal', entry.dir)} title="Show in its folder" aria-label="Show in its folder">
                <FolderIcon size={14} />
              </button>
              <button onClick={() => void bridge.invoke('recent:forget', entry.dir)} title="Take it off this list (the folder stays)">
                Remove
              </button>
            </span>
          )}
          {problem?.dir === entry.dir && (
            <div className="error-text" role="alert" data-testid="rename-problem">
              {problem.text}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  return (
    <input
      ref={input}
      className="rename"
      defaultValue={initial}
      aria-label="Project name"
      onKeyDown={(event) => {
        if (event.key === 'Enter') onDone(event.currentTarget.value.trim());
        if (event.key === 'Escape') onDone(undefined);
      }}
      onBlur={(event) => onDone(event.currentTarget.value.trim())}
      data-testid="rename-input"
    />
  );
}

/** The first run: ffmpeg and Claude Code, then Done (the pill). */
function Welcome({ tools, setTools }: { tools: ToolsStatus | undefined; setTools: (tools: ToolsStatus) => void }) {
  // one accent: Install while something is missing, Done once all is there
  const ready = tools !== undefined && tools.ffmpeg !== undefined && tools.command !== undefined && tools.skill.state !== 'missing';
  return (
    <div className="welcome">
      <div className="welcome-head">
        <Mark size={44} />
        <div>
          <h1>Record Claude Code at work.</h1>
          <p>Cuttle cuts the take for you: waiting sped up, a zoom on the answer, ready to export.</p>
        </div>
      </div>
      <Section title="Before the first recording">
        <Tools tools={tools} setTools={setTools} />
      </Section>
      <div className="welcome-foot">
        <span className="row-hint">Cuttle waits at the top of your screen and in the tray. Ctrl+Shift+Alt+R starts a recording from anywhere.</span>
        <button className={ready ? 'primary' : 'ghost'} onClick={() => void bridge.invoke('settings:welcomed')} data-testid="welcome-done">
          Done
        </button>
      </div>
    </div>
  );
}
```

`apps/desktop/src/renderer/settings/settings.css`:

```
/* The settings window and the first run: a column of cards on the app's dark ground. */
.settings {
  height: 100%;
  display: flex;
  flex-direction: column;
}
/* the title bar: dragged by the window's own top (Windows draws its buttons on the right) */
.settings header {
  height: 40px;
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 20px;
  color: var(--muted);
  font-size: var(--size-s);
  font-weight: 500;
  -webkit-app-region: drag;
}
.settings main {
  flex: 1;
  overflow-y: auto;
  padding: 8px 28px 28px;
}
.settings section + section {
  margin-top: 24px;
}
.settings h2 {
  margin: 0 0 8px 2px;
  font-size: var(--size-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--faint);
}
.card {
  background: var(--panel);
  border-radius: var(--radius-l);
  box-shadow: 0 0 0 1px var(--line);
}
.row,
.tool {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  min-height: 56px;
}
.row + .row,
.tool + .tool,
.tool + .tools-actions {
  border-top: 1px solid var(--line);
}
.row.stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.row-text {
  flex: 1;
  min-width: 0;
}
.row-label {
  font-weight: 500;
}
.row-hint {
  margin-top: 2px;
  color: var(--muted);
  font-size: var(--size-s);
}
.row-control {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.row.stacked .row-control {
  flex: 1;
}
.path-row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.path {
  flex: 1;
  min-width: 0;
  height: 30px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--raised);
  font-family: var(--mono);
  font-size: var(--size-s);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  user-select: text;
}
.path-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  user-select: text;
}

/* controls (the editor's look: one accent for the primary action, light for "on") */
.settings .primary {
  height: 30px;
  padding: 0 16px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
  white-space: nowrap;
  transition: background var(--fast);
}
.settings .primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
.settings .ghost {
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--raised);
  font-size: var(--size-s);
  white-space: nowrap;
  transition: background var(--fast);
}
.settings .ghost:hover:not(:disabled) {
  background: var(--raised-hover);
}
.seg {
  display: flex;
  background: var(--raised);
  border-radius: var(--radius-m);
  padding: 2px;
  gap: 2px;
}
.seg button {
  height: 26px;
  padding: 0 12px;
  border-radius: 7px;
  color: var(--muted);
  font-size: var(--size-s);
  font-weight: 500;
  white-space: nowrap;
  transition: background var(--fast), color var(--fast);
}
.seg button:hover {
  color: var(--text);
}
.seg button[aria-checked='true'] {
  background: var(--raised-active);
  color: var(--text);
}
.toggle {
  position: relative;
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--raised-active);
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
  transition: transform var(--fast) var(--ease-out), background var(--fast);
}
.toggle[aria-checked='true'] {
  background: var(--text);
}
.toggle[aria-checked='true'] i {
  transform: translateX(14px);
  background: var(--panel);
}
.settings select {
  width: 230px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: var(--raised);
  box-shadow: inset 0 0 0 1px var(--line);
}
.settings select:hover:not(:disabled) {
  box-shadow: inset 0 0 0 1px var(--line-strong);
}
.settings select:focus-visible {
  box-shadow: inset 0 0 0 1px var(--accent);
}

/* the tools: a mark, what it is, where it is */
.tool {
  align-items: flex-start;
}
.tool-text {
  flex: 1;
  min-width: 0;
}
.tool-mark {
  width: 20px;
  height: 20px;
  margin-top: 1px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--raised);
  color: var(--muted);
}
.tool-mark.ok {
  background: rgba(79, 209, 161, 0.14);
  color: var(--ok);
}
.tool-mark.warn {
  background: rgba(242, 179, 74, 0.14);
  color: var(--card);
}
.tool[data-state='ok'] .path-text {
  font-family: var(--mono);
  font-size: var(--size-xs);
}
.tool-extra {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.command {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--stage);
  box-shadow: inset 0 0 0 1px var(--line-strong);
  color: var(--muted);
  font-size: var(--size-s);
  transition: color var(--fast);
}
.command code {
  font-family: var(--mono);
  color: var(--text);
  user-select: text;
}
.command:hover {
  color: var(--text);
}
.tools-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
}
.tools-actions .row-hint {
  flex: 1;
  margin: 0;
}

/* recent projects */
.recent {
  list-style: none;
  margin: 0;
  padding: 4px;
}
.recent li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  border-radius: 10px;
}
.recent li:hover {
  background: var(--raised);
}
.recent-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 9px 12px;
  text-align: left;
}
.recent-name b {
  font-weight: 500;
  white-space: nowrap;
}
.recent-name .path-text {
  color: var(--faint);
  font-size: var(--size-s);
}
.recent-actions {
  display: flex;
  gap: 2px;
  padding-right: 6px;
  opacity: 0;
  transition: opacity var(--fast);
}
.recent li:hover .recent-actions,
.recent li:focus-within .recent-actions {
  opacity: 1;
}
.recent-actions button {
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  color: var(--muted);
  font-size: var(--size-s);
}
.recent-actions button:hover {
  background: var(--raised-hover);
  color: var(--text);
}
.rename {
  flex: 1;
  height: 32px;
  margin: 4px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: var(--stage);
  box-shadow: inset 0 0 0 1px var(--accent);
  user-select: text;
}
.error-text {
  flex-basis: 100%;
  padding: 0 12px 10px;
  color: var(--danger);
  font-size: var(--size-s);
}
.empty {
  margin: 0;
  padding: 16px;
  color: var(--muted);
}
.version {
  margin: 20px 2px 0;
  color: var(--faint);
  font-size: var(--size-xs);
}

/* the first run */
.welcome-head {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 8px 0 28px;
}
.welcome-head .mark {
  border-radius: 13px;
}
.welcome h1 {
  margin: 0;
  font-size: var(--size-xl);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.welcome-head p {
  margin: 4px 0 0;
  color: var(--muted);
}
.welcome-foot {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 24px;
}
.welcome-foot .row-hint {
  flex: 1;
  margin: 0;
}
```

In `apps/desktop/vite.renderer.config.ts`, replace:

```ts
        picker: fileURLToPath(new URL('./src/renderer/picker.html', import.meta.url)),
        hud: fileURLToPath(new URL('./src/renderer/hud.html', import.meta.url)),
        countdown: fileURLToPath(new URL('./src/renderer/countdown.html', import.meta.url)),
      },
    },
  },
```

with:

```ts
        picker: fileURLToPath(new URL('./src/renderer/picker.html', import.meta.url)),
        hud: fileURLToPath(new URL('./src/renderer/hud.html', import.meta.url)),
        countdown: fileURLToPath(new URL('./src/renderer/countdown.html', import.meta.url)),
        settings: fileURLToPath(new URL('./src/renderer/settings.html', import.meta.url)),
      },
    },
  },
```

- [ ] **Step 5: The editor: Undo restart, empty states, the settings command**

In `apps/desktop/src/renderer/editor/App.tsx`, replace:

```
  WarningIcon,
  ZoomIcon,
} from '../icons';
import { captionCommand, captionPositionsAt, chooseTool, cycleSpeed, freeCaptionPosition, deleteSelection, duplicateSelection, overlayBlocked, reveal, split, type CaptionPosition } from './actions';
import { CommandMenu, closeMenu, openMenu } from './CommandMenu';
import { cancelGesture } from './gesture';
import { dismissDraft, dismissToast, edit, preview, redo, retrySave, undo, useDraft } from './doc';
import { ExportSheet } from './ExportSheet';
import { Inspector } from './Inspector';
import { SourceView } from './SourceView';
```

with:

```
  WarningIcon,
  ZoomIcon,
} from '../icons';
import { captionCommand, captionPositionsAt, chooseTool, cycleSpeed, freeCaptionPosition, deleteSelection, duplicateSelection, overlayBlocked, reveal, showRawTake, split, type CaptionPosition } from './actions';
import { CommandMenu, closeMenu, openMenu } from './CommandMenu';
import { cancelGesture } from './gesture';
import { dismissDraft, dismissRestart, dismissToast, edit, preview, redo, retrySave, undo, useDraft } from './doc';
import { ExportSheet } from './ExportSheet';
import { Inspector } from './Inspector';
import { SourceView } from './SourceView';
```

In the same file, replace:

```
              <ChevronIcon size={13} />
            </button>
          </div>
          <button className="primary" onClick={openExport} title="Export (Ctrl+E)">
            <ExportIcon size={14} />
            Export
          </button>
```

with:

```
              <ChevronIcon size={13} />
            </button>
          </div>
          <button className="primary" onClick={openExport} disabled={(store.get().doc?.project.scenes.length ?? 0) === 0} title={(store.get().doc?.project.scenes.length ?? 0) === 0 ? 'Nothing to export yet: the project has no scenes' : 'Export (Ctrl+E)'}>
            <ExportIcon size={14} />
            Export
          </button>
```

In the same file, replace:

```
      <div className="viewport" ref={viewport}>
        <VideoFrame canvas={canvas} size={size} output={output} />
        <SourceView />
      </div>
      <DraftNote />
      <ToastNote />
      <Transport />
    </main>
```

with:

```
      <div className="viewport" ref={viewport}>
        <VideoFrame canvas={canvas} size={size} output={output} />
        <SourceView />
        {project && project.scenes.length === 0 && !issues && <EmptyStage />}
      </div>
      <div className="top-notes">
        <DraftNote />
        <RestartNote />
      </div>
      <ToastNote />
      <Transport />
    </main>
```

In the same file, replace:

```
  );
}

/** What just happened (an outside change, a cut by suggest, an edit that was not possible), with Undo where it applies. */
function ToastNote() {
  const toast = useStore(store, (state) => state.doc?.toast);
```

with:

```
  );
}

/** A project without scenes (all deleted, or a cuttle.json written so): what to do, over the empty frame. */
function EmptyStage() {
  const cutting = useStore(store, (state) => state.status?.state === 'working');
  return (
    <div className="empty-stage" data-testid="empty-stage">
      <div>
        <h2>Nothing in the video yet</h2>
        <p>The take is there, but no scene shows it. Let Cuttle cut it, or start from the whole take.</p>
        <div className="empty-actions">
          <button className="primary" onClick={() => void bridge.invoke('project:cut')} disabled={cutting}>
            {cutting ? 'Cutting…' : 'Let Cuttle cut it'}
          </button>
          <button className="ghost" onClick={showRawTake}>
            Show the whole take
          </button>
        </div>
      </div>
    </div>
  );
}

/** After a restart: the take before it is put aside, and can be the take again. */
function RestartNote() {
  const discarded = useStore(store, (state) => state.doc?.restartNote);
  if (!discarded) return null;
  return (
    <div className="draft-note restart" role="status" data-testid="restart-note">
      <span>Restarted. The take before it is put aside.</span>
      <button
        className="toast-undo"
        onClick={() => {
          void bridge.invoke('project:undo-restart', discarded);
          dismissRestart();
        }}
        title="Use the take from before the restart again (this one stays in the takes menu)"
        data-testid="undo-restart"
      >
        Undo restart
      </button>
      <button className="toast-close" onClick={dismissRestart} aria-label="Keep this take" title={`Keep this take (the one before stays in ${discarded})`}>
        <CloseIcon size={11} />
      </button>
    </div>
  );
}

/** What just happened (an outside change, a cut by suggest, an edit that was not possible), with Undo where it applies. */
function ToastNote() {
  const toast = useStore(store, (state) => state.doc?.toast);
```

In the same file, replace:

```
  const duration = currentPlayer()?.duration ?? 0;
  return (
    <div className="transport">
      <button className="play" onClick={() => currentPlayer()?.toggle()} aria-label={playing ? 'Pause (Space)' : 'Play (Space)'} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
      </button>
      <span className="time tabular" data-testid="time">
```

with:

```
  const duration = currentPlayer()?.duration ?? 0;
  return (
    <div className="transport">
      <button className="play" onClick={() => currentPlayer()?.toggle()} disabled={duration <= 0} aria-label={playing ? 'Pause (Space)' : 'Play (Space)'} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
      </button>
      <span className="time tabular" data-testid="time">
```

In the same file, replace:

```
        return;
      }
      if (menuOpen || target?.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      if (command && key === 'e') {
        event.preventDefault();
        if (!event.repeat) openExport();
```

with:

```
        return;
      }
      if (menuOpen || target?.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      if (command && key === ',') {
        event.preventDefault();
        if (!event.repeat) void bridge.invoke('app:settings');
        return;
      }
      if (command && key === 'e') {
        event.preventDefault();
        if (!event.repeat) openExport();
```

In `apps/desktop/src/renderer/editor/Timeline.tsx`, replace:

```
  { kind: 'caption', name: 'Caption', list: 'texts' },
];
const NOUN: Record<OverlayKind, string> = { zoom: 'zoom', mask: 'mask', caption: 'caption' };
const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MAX_PPS = 400;
/** A pointer that moves less than this between down and up clicked (selects); more drags. */
```

with:

```
  { kind: 'caption', name: 'Caption', list: 'texts' },
];
const NOUN: Record<OverlayKind, string> = { zoom: 'zoom', mask: 'mask', caption: 'caption' };
/** What an empty lane says: how to fill it. */
const LANE_HINTS: Record<OverlayKind, string> = {
  zoom: 'Z, then draw on the video: the part to zoom in on',
  mask: 'M, then draw over what no one should see (a token, an address)',
  caption: 'T, then type on the video',
};
const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MAX_PPS = 400;
/** A pointer that moves less than this between down and up clicked (selects); more drags. */
```

In the same file, replace:

```
                    <Scene key={scene.id} scene={scene} project={project} pps={pps} view={view} selected={isSelected(selection, 'scene', scene.id)} onPointerDown={(event) => pressScene(event, scene)} />
                  ))}
                </div>
                {LANES.map((lane) => (
                  <div key={lane.kind} className="tl-row" style={{ position: 'absolute', top: tops[lane.kind], height: heights[lane.kind], left: 0, right: 0 }}>
                    {model.lanes[lane.kind].blocks.map((block, index, blocks) => {
                      const blockLeft = block.start * pps;
                      const blockWidth = Math.max(6, (block.end - block.start) * pps);
```

with:

```
                    <Scene key={scene.id} scene={scene} project={project} pps={pps} view={view} selected={isSelected(selection, 'scene', scene.id)} onPointerDown={(event) => pressScene(event, scene)} />
                  ))}
                </div>
                {!project.sources.mic && (
                  <span className="lane-hint" style={{ top: tops.mic + heights.mic / 2, left: view.left + 10 }}>
                    No mic in this take
                  </span>
                )}
                {!project.sources.events && (
                  <span className="lane-hint" style={{ top: tops.input + heights.input / 2, left: view.left + 10 }}>
                    No input recorded in this take
                  </span>
                )}
                {LANES.map((lane) => (
                  <div key={lane.kind} className="tl-row" style={{ position: 'absolute', top: tops[lane.kind], height: heights[lane.kind], left: 0, right: 0 }}>
                    {model.lanes[lane.kind].blocks.length === 0 && model.lanes[lane.kind].cutOut === 0 && (
                      <span className="lane-hint" style={{ top: '50%', left: view.left + 10 }}>
                        {LANE_HINTS[lane.kind]}
                      </span>
                    )}
                    {model.lanes[lane.kind].blocks.map((block, index, blocks) => {
                      const blockLeft = block.start * pps;
                      const blockWidth = Math.max(6, (block.end - block.start) * pps);
```

In `apps/desktop/src/renderer/editor/commands.ts`, replace:

```ts
// Everything the editor can do by name, with its keys: the command menu (Ctrl+K) lists these, and
// the keyboard runs them. Keys are written as the menu shows them.
import { addCard, addMask, addPage, addZoom, cycleSpeed, deleteSelection, duplicateSelection, overlayBlocked, selectedOrCurrentClip, setSpeed, showRawTake, split } from './actions';
import { redo, undo } from './doc';
import { currentPlayer, openExport, select, setTool, store } from './session';
```

with:

```ts
// Everything the editor can do by name, with its keys: the command menu (Ctrl+K) lists these, and
// the keyboard runs them. Keys are written as the menu shows them.
import { bridge } from '../bridge';
import { addCard, addMask, addPage, addZoom, cycleSpeed, deleteSelection, duplicateSelection, overlayBlocked, selectedOrCurrentClip, setSpeed, showRawTake, split } from './actions';
import { redo, undo } from './doc';
import { currentPlayer, openExport, select, setTool, store } from './session';
```

In the same file, replace:

```ts
    { id: 'deselect', name: 'Clear the selection', keys: 'Esc', group: 'View', run: () => select(undefined) },
    { id: 'look', name: 'Show the look (background, frame, cursor…)', group: 'View', run: () => store.set({ tab: 'look' }) },
    { id: 'export', name: 'Export…', keys: 'Ctrl+E', group: 'Project', run: openExport },
  ];
}
```

with:

```ts
    { id: 'deselect', name: 'Clear the selection', keys: 'Esc', group: 'View', run: () => select(undefined) },
    { id: 'look', name: 'Show the look (background, frame, cursor…)', group: 'View', run: () => store.set({ tab: 'look' }) },
    { id: 'export', name: 'Export…', keys: 'Ctrl+E', group: 'Project', run: openExport },
    { id: 'settings', name: 'Settings…', keywords: 'preferences ffmpeg countdown camera microphone motion', keys: 'Ctrl+,', group: 'Project', run: () => void bridge.invoke('app:settings') },
  ];
}
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```
}

/* a version a conflict set aside: offered back until answered */
.draft-note {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  max-width: min(720px, calc(100% - 48px));
  min-height: 36px;
  padding: 4px 6px 4px 14px;
  border-radius: 10px;
```

with:

```
}

/* a version a conflict set aside: offered back until answered */
/* an empty lane says how to fill it; a missing track says so (never in the way of a click) */
.lane-hint {
  position: absolute;
  transform: translateY(-50%);
  color: var(--faint);
  font-size: var(--size-xs);
  white-space: nowrap;
  pointer-events: none;
}
/* a project without scenes: what to do, over the empty frame */
.empty-stage {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  z-index: 2;
}
.empty-stage > div {
  max-width: 420px;
  padding: 0 24px;
}
.empty-stage h2 {
  margin: 0 0 6px;
  font-size: var(--size-l);
  font-weight: 600;
}
.empty-stage p {
  margin: 0;
  color: var(--muted);
}
.empty-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 18px;
}

/* the notes that wait for an answer ("Use mine", "Undo restart"), over the top of the video */
.top-notes {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: min(720px, calc(100% - 48px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 4;
  pointer-events: none;
}
.draft-note {
  pointer-events: auto;
  max-width: 100%;
  min-height: 36px;
  padding: 4px 6px 4px 14px;
  border-radius: 10px;
```

In the same file, replace:

```
.draft-note > svg {
  color: var(--card);
}
.draft-note span {
  min-width: 0;
  overflow: hidden;
```

with:

```
.draft-note > svg {
  color: var(--card);
}
/* a choice, not a warning */
.draft-note.restart {
  background: var(--overlay);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(16px);
}
.draft-note span {
  min-width: 0;
  overflow: hidden;
```

- [ ] **Step 6: Typecheck and build**

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0, no output.

Run: `pnpm app:build:js`
Expected: exits with code 0 and ends with `built apps/desktop/dist`.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer apps/desktop/vite.renderer.config.ts apps/desktop/test/doc.test.ts
git commit -m "desktop: the HUD pauses and restarts; the settings page and the first run; Undo restart, empty states, Ctrl+, in the editor; two fast undos are both written

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The end-to-end checks

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`, `apps/desktop/test/build.check.test.ts`

- [ ] **Step 1: Pause, restart, the settings, a project without scenes, and the first run in the check**

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { _electron, type ElectronApplication, type Page } from 'playwright';
```

with:

```ts
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { _electron, type ElectronApplication, type Page } from 'playwright';
```

In the same file, replace:

```ts
 * broken file, a save conflict kept as a draft; open a project
 * twice at once, close an editor during its export, close the pill; record through the picker with
 * the recorder's `test` backend, stop from the HUD, and land in the take cut by suggest; record
 * again. Runs only with `pnpm app:check` (vitest --mode app, after app:build:js and cli:build).
 * CUTTLE_CHECK_SHOTS=<folder> keeps screenshots.
 */
const enabled = process.env.MODE === 'app';
```

with:

```ts
 * broken file, a save conflict kept as a draft; open a project
 * twice at once, close an editor during its export, close the pill; record through the picker with
 * the recorder's `test` backend, stop from the HUD, and land in the take cut by suggest; record
 * again; pause and restart from the HUD; the settings. Then the first run in an app of its own:
 * ffmpeg found once installed, the cuttle command and the skill installed (into folders of the
 * check's own). Runs only with `pnpm app:check` (vitest --mode app, after app:build:js and cli:build).
 * CUTTLE_CHECK_SHOTS=<folder> keeps screenshots.
 */
const enabled = process.env.MODE === 'app';
```

In the same file, replace:

```ts
    await editor.keyboard.press('Escape');
  }, 30_000);

  it('opens a project once when asked twice at once, and cancels its export when it closes', async () => {
    const second = join(root, 'second');
    cpSync(project, second, { recursive: true, filter: (path) => !/[\\/](\.cuttle|out)$/.test(path) });
```

with:

```ts
    await editor.keyboard.press('Escape');
  }, 30_000);

  it('says what to do when no scene is left: the whole take is one click away', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    const emptied = JSON.parse(original) as { scenes: unknown[] };
    emptied.scenes = [];
    writeFileSync(projectFile(), `${JSON.stringify(emptied, null, 2)}\n`);
    await editor.waitForSelector('[data-testid=empty-stage]');
    expect(await editor.locator('.titlebar .primary').isDisabled()).toBe(true);
    await click(editor, '[data-testid=empty-stage] .ghost');
    await savedWhen((file) => file.scenes.length === 1 && file.scenes[0]!.type === 'clip');
    expect(await editor.locator('[data-testid=empty-stage]').count()).toBe(0);
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('opens a project once when asked twice at once, and cancels its export when it closes', async () => {
    const second = join(root, 'second');
    cpSync(project, second, { recursive: true, filter: (path) => !/[\\/](\.cuttle|out)$/.test(path) });
```

In the same file, replace:

```ts
    await page.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('picker:cancel')).catch(() => {});
  }, 60_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

with:

```ts
    await page.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('picker:cancel')).catch(() => {});
  }, 60_000);

  /** The newest project the pill's recording made, once it is there. */
  async function newProject(before: Set<string>): Promise<string> {
    const projects = join(root, 'projects');
    let made: string | undefined;
    await expect.poll(() => (made = readdirSync(projects).find((name) => !before.has(name))), { timeout: 30_000 }).toBeDefined();
    return join(projects, made!);
  }
  const pillRecord = () =>
    app
      .windows()
      .find((page) => page.url().includes('/pill.html'))!
      .evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record'));
  const runningHud = () => waitForPage(app, async (page) => page.url().includes('/hud.html') && (await page.locator('.hud.recording').count()) === 1 && (await page.locator('[data-testid=hud-time]').textContent()) !== '0:00');
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('pauses from the HUD: nothing is recorded while paused, and the pieces are joined into the take', async () => {
    const before = new Set(readdirSync(join(root, 'projects')));
    await recordThroughPicker(pillRecord, { stop: 'none', camera: undefined }, false);
    const hud = await runningHud();
    await wait(1000);
    await click(hud, '[data-testid=hud-pause]');
    await hud.waitForSelector('.hud.paused');
    // the clock stands still while paused
    const shown = await hud.locator('[data-testid=hud-time]').textContent();
    await wait(2000);
    expect(await hud.locator('[data-testid=hud-time]').textContent()).toBe(shown);
    await click(hud, '[data-testid=hud-pause]');
    await hud.waitForSelector('.hud.recording');
    await wait(1000);
    await click(hud, '[data-testid=hud-stop]');
    const dir = await newProject(before);
    await projectWhen(dir, (written) => written.scenes[0]?.id !== undefined);
    const { segments, joined } = JSON.parse(readFileSync(join(dir, 'takes', '1', 'segments.json'), 'utf8')) as { segments: { duration: number; screen: { start: number } }[]; joined?: boolean };
    expect(joined).toBe(true);
    expect(segments).toHaveLength(2);
    // the 2 s paused are between the pieces, not in the take
    expect(segments[1]!.screen.start - (segments[0]!.screen.start + segments[0]!.duration)).toBeGreaterThan(1.8);
    const screen = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, 'takes', '1', 'screen.mp4')], { encoding: 'utf8' }).stdout.trim());
    expect(screen).toBeCloseTo(segments[0]!.duration + segments[1]!.duration, 1);
    expect(readdirSync(join(dir, 'takes', '1')).filter((name) => /\.\d+\.(mp4|m4a)$/.test(name))).toEqual([]);
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${basename(dir)} · Cuttle`);
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 120_000);

  it('restarts from the HUD on a held press only: the take is put aside, and Undo restart brings it back', async () => {
    const before = new Set(readdirSync(join(root, 'projects')));
    await recordThroughPicker(pillRecord, { stop: 'none' }, false);
    let hud = await runningHud();
    await wait(800);
    const press = (page: Page, type: string) => page.evaluate((type) => document.querySelector('[data-testid=hud-restart]')!.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 3 })), type);
    // let go early: nothing happens
    await press(hud, 'pointerdown');
    await wait(250);
    await press(hud, 'pointerup');
    const dir = await newProject(before);
    await wait(800);
    expect(existsSync(join(dir, 'takes', '.discarded'))).toBe(false);
    // held: the take goes aside and the recording starts again (no countdown in the check)
    await press(hud, 'pointerdown');
    await expect.poll(() => existsSync(join(dir, 'takes', '.discarded', '1')), { timeout: 15_000 }).toBe(true);
    hud = await runningHud();
    await wait(1000);
    await click(hud, '[data-testid=hud-stop]');
    await projectWhen(dir, (written) => written.sources.screen === 'takes/1/screen.mp4' && written.scenes[0]?.id !== undefined);
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${basename(dir)} · Cuttle`);
    // the offer outlasts suggest's note about its cut
    await opened.waitForSelector('[data-testid=undo-restart]', { timeout: 30_000 });
    await expect.poll(() => opened.evaluate(() => (window as unknown as { __cuttleCheck: Check }).__cuttleCheck.doc().undo), { timeout: 15_000 }).toBe('Cut by suggest');
    await click(opened, '[data-testid=undo-restart]');
    // the take from before the restart is the project's again (the new one stays as take 1)
    await projectWhen(dir, (written) => written.sources.screen === 'takes/2/screen.mp4' && written.scenes[0]?.id !== undefined);
    expect(existsSync(join(dir, 'takes', '1', 'screen.mp4'))).toBe(true);
    expect(existsSync(join(dir, 'takes', '.discarded', '1'))).toBe(false);
  }, 120_000);

  it('opens the settings from a second launch: changes are kept, motion reaches every window, an open project is not renamed', async () => {
    await launchAgain(['--settings']);
    // shown with the settings read (a click before would change nothing)
    const settings = await waitForPage(app, async (page) => page.url().includes('/settings.html') && (await page.locator('[data-testid=countdown] [aria-checked=true]').count()) === 1);
    const saved = () => JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { countdown: number; motion: string; launchAtLogin: boolean };
    await click(settings, '[data-testid=countdown] button:nth-child(3)');
    await expect.poll(() => saved().countdown).toBe(5);
    // less motion: the editor's transitions are off at once
    await click(settings, '[data-testid=motion] button:nth-child(2)');
    await expect.poll(() => editor.evaluate(() => document.documentElement.dataset.motion)).toBe('reduce');
    expect(parseFloat(await editor.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fast')))).toBe(0);
    await click(settings, '[data-testid=motion] button:nth-child(1)');
    await expect.poll(() => saved().motion).toBe('system');
    // the login item (the check only notes what it would register)
    await click(settings, '[data-testid=launch-at-login]');
    await expect.poll(() => app.evaluate(() => (globalThis as { __loginItem?: boolean }).__loginItem)).toBe(true);
    await click(settings, '[data-testid=launch-at-login]');
    await expect.poll(() => saved().launchAtLogin).toBe(false);
    // demo is open in its editor: its folder is not renamed
    await settings.evaluate(() => {
      const row = [...document.querySelectorAll('.recent li')].find((item) => item.querySelector('b')?.textContent === 'demo')!;
      (row.querySelector('[data-testid=recent-rename]') as HTMLElement).click();
    });
    await settings.fill('[data-testid=rename-input]', 'demo renamed');
    await settings.press('[data-testid=rename-input]', 'Enter');
    await settings.waitForSelector('[data-testid=rename-problem]');
    expect(await settings.locator('[data-testid=rename-problem]').textContent()).toContain('open in Cuttle');
    expect(existsSync(project)).toBe(true);
    await settings.press('[data-testid=rename-input]', 'Escape');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/settings.html'))?.close());
  }, 60_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

In the same file, replace:

```ts
    expect(JSON.parse(readFileSync(join(projects, made, 'cuttle.json'), 'utf8')).sources.screen).toBe('takes/1/screen.mp4');
  }, 60_000);
});
```

with:

```ts
    expect(JSON.parse(readFileSync(join(projects, made, 'cuttle.json'), 'utf8')).sources.screen).toBe('takes/1/screen.mp4');
  }, 60_000);
});

describe.runIf(enabled)('the first run', () => {
  let app: ElectronApplication;
  let root: string;
  const pathFile = () => join(root, 'path.txt');

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cuttle-first-run-'));
    // the PATH as the OS has it: ffmpeg is not on it yet
    writeFileSync(pathFile(), join(root, 'nothing-here'));
    app = await _electron.launch({
      executablePath: electronPath(),
      args: [MAIN, '--cuttle-check'],
      env: {
        ...process.env,
        CUTTLE_HIDDEN: '1',
        CUTTLE_CHECK: '1',
        CUTTLE_USER_DATA: join(root, 'user-data'),
        CUTTLE_RECORDER_BACKEND: 'test',
        CUTTLE_CHECK_PATH_FILE: pathFile(),
        // the command and the skill go into folders of the check's own, never the user's
        CUTTLE_BIN_DIR: join(root, 'bin'),
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });

  it('welcomes on the first start: finds ffmpeg once installed, installs the cuttle command and the skill, then shows the pill', async () => {
    const page = await waitForPage(app, async (candidate) => candidate.url().includes('/settings.html'));
    await page.waitForSelector('[data-testid=tool-ffmpeg][data-state=missing]');
    // installed meanwhile (winget): Check again finds it, without a restart
    const ffmpeg = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]!;
    writeFileSync(pathFile(), dirname(ffmpeg));
    await click(page, '[data-testid=check-again]');
    await page.waitForSelector('[data-testid=tool-ffmpeg][data-state=ok]');
    await click(page, '[data-testid=install-tools]');
    await page.waitForSelector('[data-testid=tool-command][data-state=ok]');
    await page.waitForSelector('[data-testid=tool-skill][data-state=ok]');
    if (process.platform === 'win32') expect(await app.evaluate(() => (globalThis as { __pathAdded?: string[] }).__pathAdded)).toEqual([join(root, 'bin')]);
    // the command runs the app's copy of the CLI, with the app as Node
    const version =
      process.platform === 'win32'
        ? spawnSync('cmd', ['/c', join(root, 'bin', 'cuttle.cmd'), '--version'], { encoding: 'utf8', windowsHide: true })
        : spawnSync('sh', [join(root, 'bin', 'cuttle'), '--version'], { encoding: 'utf8' });
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const skill = readFileSync(join(root, 'claude', 'skills', 'cuttle', 'SKILL.md'), 'utf8');
    expect(skill).toContain("open Cuttle's settings");
    expect(skill).not.toContain('{{');
    await click(page, '[data-testid=welcome-done]');
    await waitForPage(app, async (candidate) => candidate.url().includes('/pill.html'));
    await expect.poll(() => (JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { welcomed?: boolean }).welcomed).toBe(true);
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('/settings.html'))).toBe(false);
  }, 60_000);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm app:check`
Expected: PASS, 32 tests (about two minutes). No window shows on the screen; the first run installs into folders of the check's own.

- [ ] **Step 3: The unpacked app runs its own CLI**

In `apps/desktop/test/build.check.test.ts`, replace:

```ts
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

with:

```ts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

In the same file, replace:

```ts
    );
  }, 90_000);

  it("lists this machine's displays and windows in the recorder host (koffi loads)", async () => {
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    await pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record'));
```

with:

```ts
    );
  }, 90_000);

  it('runs its own copy of the CLI as the cuttle command would: the app as Node, and as Electron for a still', () => {
    const entry = join(EXE, '..', 'resources', 'app.asar.unpacked', 'cli', 'cuttle.mjs');
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', CUTTLE_ELECTRON: EXE };
    const version = spawnSync(EXE, [entry, '--version'], { env, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const still = spawnSync(EXE, [entry, '-C', join(root, 'demo'), 'preview', '--at', '1', '-o', join(root, 'stills'), '--json'], { env, encoding: 'utf8', windowsHide: true, timeout: 90_000 });
    expect(still.status, still.stderr).toBe(0);
    const { stills } = JSON.parse(still.stdout) as { stills: { file: string }[] };
    expect(stills).toHaveLength(1);
    expect(existsSync(stills[0]!.file)).toBe(true);
  }, 120_000);

  it("lists this machine's displays and windows in the recorder host (koffi loads)", async () => {
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    await pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record'));
```

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests (the CLI's version through the app as Node, and a still rendered through the app as Electron).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/test
git commit -m "desktop: app:check pauses and restarts from the HUD, changes settings, empties a project, and runs the first run; the build check runs the packaged CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs and final verification

- [ ] **Step 1: The README**

In `README.md`, replace:

````markdown
```bash
pnpm app                                 # build and start the app (the pill near the top of the screen, an icon in the tray)
pnpm app -- --open <project folder>      # … and open a project in the editor
pnpm app:check                           # end to end with its windows hidden: open, play, scrub, compare with the export, play the proxy, export, edit, record
pnpm app:build                           # an unpacked app in apps/desktop/build/Cuttle-<platform>-<arch>/, checked that it starts
```

The editor shows exactly what the export renders: the same engine and timeline, compared pixel for
````

with:

````markdown
```bash
pnpm app                                 # build and start the app (the pill near the top of the screen, an icon in the tray)
pnpm app -- --open <project folder>      # … and open a project in the editor
pnpm app -- --settings                   # … and show the settings
pnpm app:check                           # end to end with its windows hidden: open, play, scrub, compare with the export, play the proxy, export, edit, record, pause, the first run
pnpm app:build                           # an unpacked app in apps/desktop/build/Cuttle-<platform>-<arch>/ with its own CLI, checked that it starts
```

The editor shows exactly what the export renders: the same engine and timeline, compared pixel for
````

In the same file, replace:

```markdown
display: the window under the pointer lights up (the display where there is none), a drag draws a
region, and the bar sets the camera, the mic and when to stop (your stop, Claude's answer, an idle
screen). After the countdown only a small HUD remains, which never appears in the video;
Ctrl+Shift+Alt+S stops and Ctrl+Shift+Alt+M sets a marker. The editor opens on the take at once
while `suggest` cuts it in the background. "Record again" adds a take to the project; the earlier
one stays restorable ("Back to take 1"). New projects go into `~/Cuttle/<date time>`.

## The CLI
```

with:

```markdown
display: the window under the pointer lights up (the display where there is none), a drag draws a
region, and the bar sets the camera, the mic and when to stop (your stop, Claude's answer, an idle
screen). After the countdown only a small HUD remains, which never appears in the video;
Ctrl+Shift+Alt+S stops and Ctrl+Shift+Alt+M sets a marker. Pause (the HUD, or Ctrl+Shift+Alt+P)
records nothing until you resume; the pieces are joined at the stop. Restart is a held press: the
take is put aside, the countdown starts again, and the editor offers "Undo restart". The editor
opens on the take at once while `suggest` cuts it in the background. "Record again" adds a take to
the project; the earlier one stays restorable ("Back to take 1"). New projects go into
`~/Cuttle/<date time>`.

**First run and settings.** The first start looks for ffmpeg where Windows has it now (also right
after `winget install Gyan.FFmpeg`: "Check again", no restart) and installs, on request, the
`cuttle` command (the app's own copy of the CLI, run by the app itself, in
`%LOCALAPPDATA%\Cuttle\bin`, which goes on your PATH) and the Claude skill. The settings (the tray,
the pill's menu, Ctrl+, in the editor) hold the projects folder, the countdown, the default camera
and mic, starting at sign-in, motion, and the recent projects (open, rename, show, remove).

## The CLI
```

- [ ] **Step 2: All tests and the typecheck**

Run: `pnpm test`
Expected: PASS, 488 tests in 59 files, 41 skipped (the real-capture test and the Electron checks: cli, app, build).

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 3: Commit, and nothing left behind**

```bash
git add README.md
git commit -m "docs: pause, restart, the first run and the settings in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Run: `git status --short`
Expected: no output.

- [ ] **Step 4: By hand (the user)**

These need a person and a real screen; the checks drive the app with synthetic events, record test patterns and never show a window.

1. A real recording with a pause: record a window, pause from the HUD for a few seconds (do something private meanwhile), resume, stop. The video has no trace of the pause; the voice stays in step.
2. Hold the HUD's restart button: the countdown starts again. Stop, then press "Undo restart" in the editor: the first take is back.
3. Start the unpacked app once with a fresh profile (rename `%APPDATA%\Cuttle\settings.json`): the first run shows. Press Install, open a new terminal, run `cuttle --version`. Ask Claude Code (a new session) for a demo video: it finds the skill.
4. Settings: turn on "Start Cuttle when you sign in", sign out and in: Cuttle is in the tray. Set motion to "Less": the HUD's dot and the countdown stop pulsing.

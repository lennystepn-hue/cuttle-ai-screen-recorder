# Cuttle M4: Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@cuttle/recorder`: record a take (a monitor, a region or a window, plus optional webcam and mic) into `<project>/takes/<n>/` as fragmented MP4 tracks, events.jsonl (pointer, clicks, scroll, cursor shape, key counts), markers.json and take.json, and stop it by hotkey, time, a file, an idle screen or the end of a Claude Code turn. Real capture works on Windows; a `test` backend (ffmpeg test sources and synthetic input) runs everywhere and carries the tests.

**Architecture:** `record()` resolves the source against `listDevices()`, counts down, creates the take folder and starts one ffmpeg process per track (ddagrab for the screen, DirectShow for webcam and mic), each stamping its packets with the wall clock, so the first frame's time of every track goes into take.json. A global input hook (uiohook-napi) and a 30 Hz cursor-shape poll (user32 through koffi) feed an events writer that maps desktop pixels and wall-clock seconds into the screen track. Triggers (timer, file poll, ffmpeg's freezedetect, a Claude Code transcript watcher, hotkeys) request the stop; every ffmpeg then gets `q` and finishes its file.

**Tech Stack:** TypeScript 5, Node 22, ffmpeg 9 (ddagrab, dshow, lavfi test sources, libx264, AAC), uiohook-napi 1.5.5, koffi 3.3.2, zod 4 (markers.json schema), vitest 5.

Spec: `docs/superpowers/specs/2026-10-16-cuttle-design.md`. Roadmap and shared interfaces: `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`. M3 (done): `docs/superpowers/plans/2026-10-16-cuttle-m3-export.md`. Spike notes with every measurement: `docs/superpowers/spikes/2026-10-17-m4-recorder-spike.md` (written against the prototype; where they differ, this plan wins).

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `m4-recorder`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- The recorder tests need **ffmpeg and ffprobe on PATH** (ffmpeg 9 was used, `winget install Gyan.FFmpeg`; `CUTTLE_FFMPEG` overrides the ffmpeg path). They start real ffmpeg processes with test sources paced in real time, so a recording test takes as long as its take (the ten `record()` tests run concurrently, ~6 s).
- The task steps run only the tests they touch (`pnpm exec vitest run <files>`); the full `pnpm test`, which includes the engine's golden images in Chromium, runs once in Task 11.
- Tests delete the temp folders they create. The real-capture test (Task 9) records the screen: it reads only metadata and deletes the take; run it only on a machine where that is fine.

## Decisions made while planning

A spike and a full prototype (Windows 11, three monitors at 125 %/100 %/100 % with one rotated, one microphone, no webcam, ffmpeg 9.0, Node 22.16) settled these points. Every code block below ran: the plan was replayed mechanically, twice, on a fresh clone of `main` (542a2e9), applying every file block and edit from this text and running every command, 10 commits; the result is byte-identical to the prototype. `pnpm test` passes 311 tests in 36 files and skips the real-capture test, twice in a row (~12 s, engine goldens included), `pnpm typecheck` is clean, and `pnpm recorder:real` recorded the primary monitor (2560×1440, with the blocked microphone reported) and a 640×360 region of it.

- **Libraries.** `uiohook-napi` 1.5.5 (MIT, N-API prebuilds, works in Node and Electron) for the global mouse and keyboard hook; `koffi` 3.3.2 (MIT; 3.3.3 was younger than two weeks) for user32, dxgi, shcore and dwmapi. Both are pinned exactly. pnpm 11 refuses install scripts by default (`ERR_PNPM_IGNORED_BUILDS`); both ship prebuilt binaries, so `pnpm-workspace.yaml` gets `allowBuilds: { koffi: false, uiohook-napi: false }` and no foreign install script runs. Both are loaded with `import()` on the Windows path only, so the `test` backend never touches them.
- **One ffmpeg per track, stamped with the wall clock.** Every input gets `-use_wallclock_as_timestamps 1`, and ffmpeg's input dump then says when the first packet arrived (`Duration: N/A, start: 1792189686.207373`, Unix seconds; `settb=1/1000000` makes it microseconds). That start goes into take.json for each track; ffmpeg's clock and `Date.now()` agree to well under a millisecond, so input events stamped in Node line up. **A DirectShow mic buffers ~500 ms by default**, and a packet is stamped when it arrives: take.json would put the mic ~0.45 s late. The recorder passes `-audio_buffer_size 50` and writes `start − 0.05` for a DirectShow mic. Separate processes fail independently: when one track breaks off (ffmpeg exits before it was asked to), `done` rejects with `capture` and the other tracks get `q` and finish their files.
- **Monitors come from DXGI, in ddagrab's order.** ddagrab opens the outputs of the default adapter by index; enumerating the same outputs through DXGI (`CreateDXGIFactory1` → `EnumAdapters1(0)` → `EnumOutputs` → `GetDesc`, COM calls by vtable slot through koffi) gives each index its desktop rectangle and HMONITOR, exactly. This replaces the roadmap's plan to match Electron's displays by size and position. The process becomes per-monitor DPI aware first (`SetProcessDpiAwarenessContext(-4)`), so every coordinate is a physical pixel; uiohook's pointer positions then match the monitor rectangles exactly, also at 125 % and left of the primary monitor. `Monitor.scale` (from `GetDpiForMonitor`) is informational.
- **Regions and windows.** A region is `[x, y, width, height]` in its monitor's pixels; sizes are rounded down to even numbers (H.264 4:2:0) and the region must lie inside the monitor. ddagrab crops it on the GPU (`offset_x`, `offset_y`, `video_size`). A window is captured as the region of its visible frame (`DWMWA_EXTENDED_FRAME_BOUNDS`) when the recording starts, clipped to the monitor that holds its centre; a moved window is not followed. The title matches exactly, otherwise the one window whose title contains it (ignoring case); two candidates are an error naming both.
- **Encoding.** libx264 `ultrafast` CRF 18 kept up with 2560×1440 at 30 fps. BT.709 matrix and tags as the roadmap asks, plus `setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv` at the end of the chain: ddagrab's frames carry an sRGB transfer that the encoder flags alone did not override (a real capture came out `color_transfer=iec61966-2-1`; with `setparams` it is `bt709`). A key frame every 2 s. Mic: AAC 160 kbit/s at the device's rate (export resamples).
- **Crash safety needs `-flush_packets 1`.** The fragmented-MP4 flags alone left 28 bytes (no moov) when ffmpeg was killed during a still screen or a mic take: its write buffer never filled. With `-flush_packets 1` a killed video track is readable up to its last 2 s fragment. Audio has no GOPs, so `frag_keyframe` wrote no fragment at all: the mic adds `-frag_duration 1000000`. A Node parent killed with `taskkill /F` takes its ffmpeg children with it (libuv's job object), so a crash leaves no capture running.
- **Input events.** uiohook's mouse and wheel events are stamped with `Date.now()` (its own `time` is the system tick count). The writer maps desktop pixels to the screen track (minus the area's desktop origin), drops input before the first frame, writes the pointer's position and shape at t=0, thins moves to one per 1/60 s slot while keeping the last move of a burst, and writes a held-back move before a click. Key presses are counted per half second (no key, no exact timing of a press is stored), so a `keys` event can come after later events in the file (readers sort; the timeline does). The cursor shape is polled at 30 Hz through `GetCursorInfo` and compared with the system cursors (`IDC_APPSTARTING` counts as `wait`, unknown handles as `arrow`); only changes are written. The wheel's rotation is in notches, positive toward the user; a touchpad's small deltas arrive as rotation 0 first and are skipped.
- **Hotkeys: Ctrl+Shift+Alt+S stops, Ctrl+Shift+Alt+M adds a marker.** The hook cannot swallow keys, so they also reach the focused app: F-key combinations are bound in IDEs (Ctrl+Shift+F10 runs code in JetBrains), and Ctrl+Alt+letter is AltGr on German layouts (AltGr+M types µ). Hotkey presses are not counted as keys. `HOTKEYS` is exported for the CLI to print.
- **Stop triggers** (combinable; the first wins and becomes `Take.stopReason`): `maxSeconds` from the moment every track runs; `untilFile` (polled every 200 ms; a file that exists at the start is refused, or the take would stop at once); `untilIdleSeconds` (ffmpeg's `freezedetect` at −60 dB on a 320 px grey copy of the screen; a blinking caret stays far below that; a freeze that starts at 0 means the user has not begun yet and is ignored, so only a still screen after a change stops the take); `untilClaude` (below); the stop hotkey; `stop()`.
- **untilClaude follows one Claude Code session.** Transcripts are `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<the absolute cwd with every character but a-z, A-Z, 0-9 replaced by ->/<session>.jsonl`, polled every 250 ms (files that exist at the start from their end, new files from the start; UTF-8 split across reads is handled). Several sessions can run in one folder, among them the one that started the recorder, so the watcher follows the first session that submits a prompt after `record()` was called (prompts during the countdown count) and ignores the others. A prompt is a user line with text (not a tool result, not `isMeta`, not local command output); a tool call is a `tool_use` item; the turn ends at the first assistant line with `stop_reason: end_turn` or `isApiErrorMessage` (every line of a split assistant message carries the final `stop_reason`; deduplicated by message id). Subagent lines (`isSidechain`) are ignored. The take stops `CLAUDE_TAIL_SECONDS` (2 s) after the end, so the answer is on screen.
- **Markers.** `markers.json` (schema in `@cuttle/project`, like take.json): `{ "version": 1, "markers": [{ "t": 1.27, "kind": "tool", "label": "Bash" }] }`, `t` in source seconds of the screen track, kinds `manual` (hotkey or `Recording.marker(label?)`), `prompt`, `tool` (labelled with the tool's name) and `answer`. No prompt text is stored; `cuttle suggest` can read the transcript itself. The file is rewritten on every marker, so a crash keeps them.
- **A muted microphone is reported.** A copy of the mic runs through `silencedetect` at −80 dB: a muted or blocked microphone delivers digital zeros (−91 dB measured on the reference PC, whose microphone is blocked for desktop apps), room noise through a working one is far louder. Silence that starts in the first second gives one warning (`onEvent` and `Take.warnings`) naming the Windows privacy setting.
- **The take folder.** `takes/<n>` with the next free number, created with a non-recursive `mkdir` so two recorders never share one; created after the countdown, so a stop during the countdown leaves nothing (`cancelled`). take.json is written as soon as every track runs; events.jsonl is appended as input arrives. `Take` paths are relative to the project folder with forward slashes, ready for `cuttle.json`'s `sources`. Options are checked before anything starts (`invalid-options`, `device-not-found`).
- **The test backend.** Devices: "Test Monitor" (1280×720 `testsrc2`), "Still Test Monitor" (640×360, moves for 1 s and then stands still), "Test Window" (a 640×360 region of monitor 0), "Test Camera", "Failing Test Camera" (ends after 1 s), "Test Microphone" (sine) and "Silent Test Microphone" (`anullsrc`). lavfi sources are paced with `realtime`/`arealtime`: with wall-clock stamps an unpaced source delivers all frames at once (freezedetect saw nothing). Synthetic input circles the monitor centre at 60 Hz and clicks, scrolls, types and switches the cursor shape every second.
- **Windows only, for now.** On other platforms `record()` and `listDevices()` refuse with `unsupported-platform` unless `backend: 'test'`. macOS (avfoundation) needs a Mac to develop on; it is listed under "Open points". Real webcam capture (`-f dshow -rtbufsize 256M -i video=<name>`, the device's default format) could not be tried: the reference PC has no webcam.
- **The manual check.** `pnpm recorder:real` runs `test/real.test.ts` with `vitest --mode real --silent=false` (the test is skipped in every other run; `--silent=false` shows its summary line, which vitest 5 hides for a passing test): 3 s of the primary monitor with the first microphone, then a 640×360 region, checked with ffprobe and deleted.
- **Koffi type names.** koffi 3.3.2 gave an anonymous struct and an anonymous callback prototype the same internal name, and a pointer to the struct then came back as the callback pointer. Every type gets a name, with a per-load prefix because a name can be defined once per process and vitest loads a module more than once.
- **Interface changes against the roadmap** (Task 10 updates the roadmap): `RecordOptions` gains `onEvent` (countdown, recording, marker, warning, stopping); `Take` gains `stopReason` and `warnings`, and its paths are relative to the project; `record()` also returns `marker(label?)`; `listDevices()` takes `{ backend }`; `Monitor` (`index` = ddagrab `output_idx`, `name`, `bounds`, `scale`, `primary`) and `WindowInfo` (`title`, `bounds`, `monitor`) are defined, `bounds` in physical desktop pixels; failures are `RecorderError` with `code`: `invalid-options` (CLI exit 1), `device-not-found`, `ffmpeg-missing`, `capture`, `unsupported-platform` (2) and `cancelled` (130). Also exported: `HOTKEYS`, `CLAUDE_TAIL_SECONDS`, `claudeTranscriptDir`. New in `@cuttle/project`: `MarkersFileSchema`, `MarkerSchema`, `parseMarkersJson`, `MARKERS_VERSION`, `MARKER_KINDS`, types `Marker`, `MarkerKind`, `MarkersFile`, `MarkersParseResult`. koffi joins the tech stack.

## File structure

```
cuttle/
├── package.json                      typecheck covers the recorder; script recorder:real
├── pnpm-workspace.yaml               allowBuilds: koffi and uiohook-napi load from their prebuilt binaries
├── README.md                         recorder package row, recorder:real, the ffmpeg note
├── packages/project/
│   ├── src/markers.ts                MarkersFileSchema, parseMarkersJson (new)
│   ├── src/index.ts                  exports them
│   └── test/markers.test.ts
└── packages/recorder/
    ├── package.json                  @cuttle/recorder; project, koffi 3.3.2, uiohook-napi 1.5.5 (exact)
    ├── tsconfig.json                 Node types; src and test
    ├── src/
    │   ├── index.ts                  public API
    │   ├── types.ts                  RecordOptions, Take, Monitor, WindowInfo, events, raw input
    │   ├── errors.ts                 RecorderError with code
    │   ├── ffmpeg.ts                 one capture process: start time, stderr lines, graceful stop
    │   ├── args.ts                   ffmpeg command lines of the three tracks          (pure)
    │   ├── sources.ts                platform, test devices, capture areas, ffmpeg inputs (pure)
    │   ├── events.ts                 EventsWriter: raw input → events.jsonl lines         (pure)
    │   ├── claude.ts                 Claude Code transcripts: folder, line signals, watcher
    │   ├── win32.ts                  koffi: DXGI monitors, windows, pointer position and shape
    │   ├── devices.ts                listDevices (DXGI, windows, DirectShow listing)
    │   ├── input.ts                  uiohook + shape poll, or synthetic test input; hotkeys
    │   └── record.ts                 record(): countdown, tracks, triggers, markers, stop
    └── test/
        ├── args.test.ts, sources.test.ts, events.test.ts           (pure)
        ├── ffmpeg.test.ts, claude.test.ts, devices.test.ts, win32.test.ts
        ├── record.test.ts            the test backend end to end (done criterion)
        └── real.test.ts              a real capture, only with pnpm recorder:real
```

---

### Task 1: markers.json in `@cuttle/project`

The recorder writes markers next to the take's tracks; `cuttle suggest` (M5) reads them. The schema lives in `@cuttle/project` with take.json's and events.jsonl's.

**Files:**
- Create: `packages/project/src/markers.ts`
- Modify: `packages/project/src/index.ts`
- Test: `packages/project/test/markers.test.ts`

- [ ] **Step 1: Write the failing test**

The plan was committed on the branch `m4-recorder`; work there:

```bash
git switch m4-recorder
```

`packages/project/test/markers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseMarkersJson } from '../src/index';

const file = {
  version: 1,
  markers: [
    { t: 0.5, kind: 'prompt' },
    { t: 2.25, kind: 'tool', label: 'Bash' },
    { t: 7, kind: 'answer' },
    { t: 8, kind: 'manual', label: 'nice bit' },
  ],
};

describe('parseMarkersJson', () => {
  it('reads every marker kind', () => {
    expect(parseMarkersJson(JSON.stringify(file))).toEqual({ ok: true, markers: file.markers });
  });

  it('names the path of an invalid field', () => {
    const result = parseMarkersJson(JSON.stringify({ version: 1, markers: [{ t: -1, kind: 'tool' }] }));
    expect(result).toEqual({ ok: false, issues: [{ path: 'markers[0].t', message: expect.any(String) }] });
  });

  it('rejects an unknown kind and an unknown field', () => {
    const result = parseMarkersJson(JSON.stringify({ version: 1, markers: [{ t: 1, kind: 'note', text: 'x' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path).sort()).toEqual(['markers[0]', 'markers[0].kind']);
  });

  it('reports invalid JSON and accepts a byte order mark', () => {
    expect(parseMarkersJson('{').ok).toBe(false);
    expect(parseMarkersJson(String.fromCharCode(0xfeff) + JSON.stringify(file)).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/project/test/markers.test.ts`
Expected: FAIL, 4 tests fail with `TypeError: parseMarkersJson is not a function`.

- [ ] **Step 3: Implement the schema**

`packages/project/src/markers.ts`:

```ts
import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';

/** The markers.json format version this build reads and the recorder writes. */
export const MARKERS_VERSION = 1;

/**
 * `manual`: the marker hotkey or the recorder API. From a Claude Code transcript: `prompt` (a prompt
 * was submitted), `tool` (a tool call, labelled with the tool's name) and `answer` (the final answer).
 */
export const MARKER_KINDS = ['manual', 'prompt', 'tool', 'answer'] as const;

/** One marker; `t` is in source seconds of the screen track, like events.jsonl. */
export const MarkerSchema = z.strictObject({
  t: z.number().nonnegative(),
  kind: z.enum(MARKER_KINDS),
  label: z.string().min(1).optional(),
});

/** markers.json, written by the recorder next to the take's tracks, markers sorted by `t`. */
export const MarkersFileSchema = z.strictObject({
  version: z.literal(MARKERS_VERSION),
  markers: z.array(MarkerSchema),
});

export type Marker = z.output<typeof MarkerSchema>;
export type MarkerKind = (typeof MARKER_KINDS)[number];
export type MarkersFile = z.output<typeof MarkersFileSchema>;

export type MarkersParseResult = { ok: true; markers: Marker[] } | { ok: false; issues: ProjectIssue[] };

export function parseMarkersJson(text: string): MarkersParseResult {
  let raw: unknown;
  try {
    // A UTF-8 byte order mark (U+FEFF), as Windows editors and PowerShell 5.1 write one, is not JSON.
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  const result = MarkersFileSchema.safeParse(raw);
  if (result.success) return { ok: true, markers: result.data.markers };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}
```

In `packages/project/src/index.ts`, replace:

```ts
export { TAKE_VERSION, TakeFileSchema, parseTakeJson, trackOffset, type TakeFile, type TakeFileParseResult, type TakeFileTrack } from './take';
```

with:

```ts
export { TAKE_VERSION, TakeFileSchema, parseTakeJson, trackOffset, type TakeFile, type TakeFileParseResult, type TakeFileTrack } from './take';
export {
  MARKERS_VERSION,
  MARKER_KINDS,
  MarkerSchema,
  MarkersFileSchema,
  parseMarkersJson,
  type Marker,
  type MarkerKind,
  type MarkersFile,
  type MarkersParseResult,
} from './markers';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run packages/project/test/markers.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm exec vitest run packages/project`
Expected: PASS, 43 tests in 5 files.

- [ ] **Step 5: Commit**

```bash
git add packages/project/src/markers.ts packages/project/src/index.ts packages/project/test/markers.test.ts
git commit -m "project: markers.json schema (manual, prompt, tool, answer)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The recorder package and its ffmpeg capture process

`spawnCapture` runs one ffmpeg per track: it reads the first packet's wall clock from ffmpeg's input dump, passes every stderr line to listeners (the idle and silence detectors), stops ffmpeg with `q` and reports a capture that ends on its own as a failure.

**Files:**
- Create: `packages/recorder/package.json`, `packages/recorder/tsconfig.json`, `packages/recorder/src/types.ts`, `packages/recorder/src/errors.ts`, `packages/recorder/src/ffmpeg.ts`
- Modify: `package.json`
- Test: `packages/recorder/test/ffmpeg.test.ts`

- [ ] **Step 1: Create the package**

`packages/recorder/package.json`:

```json
{
  "name": "@cuttle/recorder",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@cuttle/project": "workspace:*"
  }
}
```

`src/index.ts` follows in Task 8; koffi and uiohook-napi in Task 7.

`packages/recorder/tsconfig.json`:

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
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json",
```

with:

```json
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json && tsc -p packages/recorder/tsconfig.json",
```

Run: `pnpm install`
Expected: the workspace links `@cuttle/recorder` (`pnpm-lock.yaml` gains the importer `packages/recorder`); no errors.

- [ ] **Step 2: Write the failing test**

`packages/recorder/test/ffmpeg.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ffmpegPath, spawnCapture } from '../src/ffmpeg';

afterEach(() => vi.unstubAllEnvs());
const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const duration = (file: string) =>
  Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout);
const testsrc = (seconds = '') => ['-use_wallclock_as_timestamps', '1', '-f', 'lavfi', '-i', `testsrc2=s=320x240:r=30${seconds},realtime,settb=1/1000000`];
const out = (file: string) => ['-c:v', 'libx264', '-preset', 'ultrafast', '-f', 'mp4', '-y', file];

describe('spawnCapture', () => {
  it('runs ffmpeg from PATH unless CUTTLE_FFMPEG names another one', () => {
    vi.stubEnv('CUTTLE_FFMPEG', '');
    expect(ffmpegPath()).toBe('ffmpeg');
    vi.stubEnv('CUTTLE_FFMPEG', 'C:/tools/ffmpeg.exe');
    expect(ffmpegPath()).toBe('C:/tools/ffmpeg.exe');
  });

  it('says how to install ffmpeg when it is missing', async () => {
    vi.stubEnv('CUTTLE_FFMPEG', join(tmpdir(), 'no-such-ffmpeg'));
    const capture = spawnCapture('screen', ['-version']);
    const missing = expect.objectContaining({ name: 'RecorderError', code: 'ffmpeg-missing', message: expect.stringContaining('winget install Gyan.FFmpeg') });
    await expect(capture.started).rejects.toEqual(missing);
    await expect(capture.exited).rejects.toEqual(missing);
  });

  it('reports the wall clock of the first frame and finishes the file on stop', async () => {
    const file = join(temp('cuttle-ffmpeg-'), 'out.mp4');
    const before = Date.now() / 1000;
    const capture = spawnCapture('screen', [...testsrc(), ...out(file)]);
    const start = await capture.started;
    expect(start).toBeGreaterThanOrEqual(before - 0.05);
    expect(start).toBeLessThan(Date.now() / 1000 + 0.002); // Date.now() drops the microseconds ffmpeg has
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await capture.stop();
    expect(capture.seconds()).toBeGreaterThan(0.8);
    expect(duration(file)).toBeCloseTo(capture.seconds()!, 1);
  });

  it('passes every stderr line to listeners', async () => {
    const capture = spawnCapture('screen', [...testsrc(':d=0.5'), '-f', 'null', '-']);
    const lines: string[] = [];
    capture.onLine((line) => lines.push(line));
    await capture.exited.catch(() => {});
    expect(lines.some((line) => line.includes('Stream #0:0'))).toBe(true);
  });

  it('fails when ffmpeg ends before stop() was called, with the end of its log', async () => {
    const capture = spawnCapture('webcam', [...testsrc(':d=0.5'), '-f', 'null', '-']);
    await expect(capture.exited).rejects.toMatchObject({ code: 'capture', message: expect.stringMatching(/^the webcam capture stopped unexpectedly \(ffmpeg exit code 0\):\n/) });
  });

  it('fails when ffmpeg cannot open its input, before any start time', async () => {
    const capture = spawnCapture('mic', ['-f', 'lavfi', '-i', 'no_such_source', '-f', 'null', '-']);
    await expect(capture.started).rejects.toMatchObject({ code: 'capture', message: expect.stringContaining('no_such_source') });
  });
});
```

- [ ] **Step 3: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/recorder/test/ffmpeg.test.ts`
Expected: FAIL, the suite cannot load: `Error: Cannot find module '../src/ffmpeg' imported from …/packages/recorder/test/ffmpeg.test.ts` and `Tests  no tests`.

- [ ] **Step 4: Types, errors and the capture process**

`packages/recorder/src/types.ts` (the whole package's types; later tasks use the rest):

```ts
import type { CursorShape, Marker, Rect } from '@cuttle/project';

/** A rectangle on the desktop, in physical pixels (negative left of and above the primary monitor). */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Monitor {
  /** ffmpeg ddagrab `output_idx` (Windows): the order of the default adapter's outputs. */
  index: number;
  name: string;
  bounds: Bounds;
  /** Display scale factor (1.25 at 125 %). */
  scale: number;
  primary: boolean;
}

export interface WindowInfo {
  title: string;
  /** The visible frame without the invisible resize border. */
  bounds: Bounds;
  /** Index of the monitor that holds the window's centre. */
  monitor: number;
}

export interface Devices {
  monitors: Monitor[];
  windows: WindowInfo[];
  cameras: string[];
  mics: string[];
}

export type Backend = 'auto' | 'test';

export type CaptureSource =
  | { kind: 'monitor'; index: number }
  /** `rect` is `[x, y, width, height]` in pixels of that monitor (origin at its top-left corner). */
  | { kind: 'region'; rect: Rect; monitor: number }
  /** Captured as the region of the window's bounds when the recording starts. */
  | { kind: 'window'; title: string };

export interface StopOptions {
  maxSeconds?: number;
  /** Stops once this file exists; it must not exist when the recording starts. */
  untilFile?: string;
  /** Stops once the screen has not changed for this many seconds, after it changed at least once. */
  untilIdleSeconds?: number;
  /**
   * The folder Claude Code runs in. Stops shortly after the first session in that folder that
   * submits a prompt during the recording finishes its turn; its prompts, tool calls and final
   * answer become markers.
   */
  untilClaude?: string;
}

export interface RecordOptions {
  projectDir: string;
  source: CaptureSource;
  /** Device names from `listDevices()`. */
  webcam?: string;
  mic?: string;
  stop: StopOptions;
  /** Seconds to wait before the capture starts (default 3). */
  countdownSeconds?: number;
  /** Bake the real pointer into the screen track (then set `look.cursor.enabled` to false). */
  drawMouse?: boolean;
  /** `test`: ffmpeg test sources and synthetic input instead of real devices (default `auto`). */
  backend?: Backend;
  onEvent?: (event: RecorderEvent) => void;
}

export type StopReason = 'stop' | 'hotkey' | 'max-seconds' | 'file' | 'idle' | 'claude';

export type RecorderEvent =
  | { type: 'countdown'; seconds: number }
  /** Every track is capturing; `dir` is the take folder relative to the project. */
  | { type: 'recording'; dir: string }
  | { type: 'marker'; marker: Marker }
  | { type: 'warning'; message: string }
  | { type: 'stopping'; reason: StopReason };

/** A finished take. Paths are relative to the project folder, with forward slashes. */
export interface Take {
  dir: string;
  screen: string;
  webcam?: string;
  mic?: string;
  events: string;
  markers: string;
  screenSize: { width: number; height: number };
  /** Length of the screen track. */
  seconds: number;
  stopReason: StopReason;
  warnings: string[];
}

export interface Recording {
  /** Stops every track and resolves with the take (same promise as `done`). */
  stop(): Promise<Take>;
  /** Adds a manual marker at the current time. */
  marker(label?: string): void;
  /** Resolves when the recording has stopped for any reason; rejects with a `RecorderError`. */
  done: Promise<Take>;
}

/** One input event before it is mapped into the screen track: wall-clock seconds, desktop pixels. */
export type RawInput =
  | { type: 'move'; time: number; x: number; y: number }
  | { type: 'click'; time: number; x: number; y: number; button: 'left' | 'right' | 'middle' }
  | { type: 'scroll'; time: number; x: number; y: number; dx: number; dy: number }
  | { type: 'shape'; time: number; shape: CursorShape }
  | { type: 'key'; time: number };

export type HotkeyAction = 'stop' | 'marker';
```

`packages/recorder/src/errors.ts`:

```ts
export type RecorderErrorCode = 'invalid-options' | 'device-not-found' | 'ffmpeg-missing' | 'capture' | 'unsupported-platform' | 'cancelled';

/**
 * A recording failure with a cause the caller can act on. Suggested CLI exit codes (spec: 1 usage or
 * validation, 2 device or permission): `invalid-options` → 1; `device-not-found`, `ffmpeg-missing`,
 * `capture` (a capture process failed) and `unsupported-platform` → 2; `cancelled` (stopped during the
 * countdown, nothing recorded) → 130, like Ctrl+C.
 */
export class RecorderError extends Error {
  readonly code: RecorderErrorCode;

  constructor(code: RecorderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RecorderError';
    this.code = code;
  }
}
```

`packages/recorder/src/ffmpeg.ts`:

```ts
import { spawn } from 'node:child_process';
import { RecorderError } from './errors';

/** The ffmpeg executable: `CUTTLE_FFMPEG` when set, otherwise `ffmpeg` from PATH. */
export function ffmpegPath(): string {
  return process.env.CUTTLE_FFMPEG || 'ffmpeg';
}

/** The error for an ffmpeg that is not installed (spawn failed with ENOENT). */
export function ffmpegMissing(cause: Error): RecorderError {
  return new RecorderError(
    'ffmpeg-missing',
    `ffmpeg was not found (looked for "${ffmpegPath()}"). Install it (Windows: winget install Gyan.FFmpeg, macOS: brew install ffmpeg) or set CUTTLE_FFMPEG to its path.`,
    { cause },
  );
}

/** Milliseconds ffmpeg gets to finish its file after "q" before it is killed. */
const STOP_TIMEOUT_MS = 10_000;
/** Lines of stderr kept for an error message. */
const STDERR_TAIL_LINES = 12;

/**
 * ffmpeg's input dump: `Duration: N/A, start: 1792189686.207373, bitrate: N/A`. With
 * `-use_wallclock_as_timestamps 1` the start is the first packet's wall clock (Unix seconds).
 */
const INPUT_START = /Duration: [^,]+, start: (\d+(?:\.\d+)?)/;
/** The progress report, `… time=00:00:03.13 …`; the last one is the output's length. */
const PROGRESS_TIME = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/;

export interface CaptureProcess {
  /** Wall-clock seconds (Unix epoch) of the first captured frame or sample. */
  readonly started: Promise<number>;
  /** Resolves when ffmpeg exits after `stop()`; rejects when it fails or exits on its own. */
  readonly exited: Promise<void>;
  /** Every stderr line (progress reports included), for filters that log what they detect. */
  onLine(listener: (line: string) => void): void;
  /** Length of the output so far, from ffmpeg's last progress report. */
  seconds(): number | undefined;
  /** Asks ffmpeg to finish the file ("q" on stdin); kills it if it has not exited after 10 s (the fragmented MP4 stays readable). */
  stop(): Promise<void>;
}

/** Starts one capture process. `name` labels its errors ("screen", "webcam", "mic"). */
export function spawnCapture(name: string, args: readonly string[]): CaptureProcess {
  const child = spawn(ffmpegPath(), ['-hide_banner', ...args], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  const listeners: ((line: string) => void)[] = [];
  const tail: string[] = [];
  let partial = '';
  let seconds: number | undefined;
  let stopping = false;
  let killed = false;

  let resolveStarted!: (start: number) => void;
  let rejectStarted!: (error: Error) => void;
  const started = new Promise<number>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  started.catch(() => {}); // `exited` reports the failure; a caller may never await `started`

  const line = (text: string) => {
    if (text.trim() === '') return;
    const start = INPUT_START.exec(text);
    if (start) resolveStarted(Number(start[1]));
    const time = PROGRESS_TIME.exec(text);
    if (time) seconds = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
    else {
      tail.push(text); // progress reports say nothing about a failure
      if (tail.length > STDERR_TAIL_LINES) tail.shift();
    }
    for (const listener of listeners) listener(text);
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    const parts = (partial + chunk).split(/\r\n|\r|\n/);
    partial = parts.pop() ?? '';
    parts.forEach(line);
  });
  // Without a listener, writing "q" to an ffmpeg that already exited throws EPIPE.
  child.stdin.on('error', () => {});

  const exited = new Promise<void>((resolve, reject) => {
    child.on('error', (error: NodeJS.ErrnoException) => {
      const failure =
        error.code === 'ENOENT'
          ? ffmpegMissing(error)
          : new RecorderError('capture', `the ${name} capture could not start: ${error.message}`, { cause: error });
      rejectStarted(failure);
      reject(failure);
    });
    child.on('close', (code) => {
      line(partial);
      partial = '';
      const what = stopping ? 'failed while stopping' : 'stopped unexpectedly';
      const failure = new RecorderError('capture', `the ${name} capture ${what} (ffmpeg exit code ${code}):\n${tail.join('\n')}`);
      rejectStarted(failure);
      // After "q", ffmpeg exits with 0; a kill leaves a readable fragmented file. Any exit before
      // stop() is a failure, even with code 0: a capture only ends when asked to.
      if (stopping && (code === 0 || killed)) resolve();
      else reject(failure);
    });
  });
  exited.catch(() => {}); // surfaced through `started`, `stop()` or the caller's own await

  return {
    started,
    exited,
    onLine: (listener) => void listeners.push(listener),
    seconds: () => seconds,
    stop() {
      if (child.exitCode === null && !stopping) {
        stopping = true;
        child.stdin.end('q');
        const timer = setTimeout(() => {
          killed = true;
          child.kill();
        }, STOP_TIMEOUT_MS);
        exited.finally(() => clearTimeout(timer)).catch(() => {});
      }
      return exited;
    },
  };
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm exec vitest run packages/recorder/test/ffmpeg.test.ts`
Expected: PASS, 6 tests.

Run: `pnpm typecheck`
Expected: exits with code 0 and prints the six `tsc` commands.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml packages/recorder
git commit -m "recorder: package skeleton, types and the ffmpeg capture process

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: ffmpeg command lines

Pure builders for the screen, webcam and mic processes: wall-clock stamps, BT.709 with `setparams`, a key frame every 2 s, fragmented MP4 with `-flush_packets 1`, 1 s audio fragments, the freezedetect branch for `untilIdleSeconds` and the silencedetect branch for the mic, and the parsers for their log lines.

**Files:**
- Create: `packages/recorder/src/args.ts`
- Test: `packages/recorder/test/args.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/recorder/test/args.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { freezeStart, micArgs, screenArgs, silenceStart, webcamArgs } from '../src/args';

const input = ['-f', 'lavfi', '-i', 'testsrc2'];
const BT709 = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';

describe('ffmpeg arguments', () => {
  it('stamps every input with the wall clock and writes fragmented MP4 that survives a kill', () => {
    for (const args of [screenArgs(input, 'screen.mp4'), webcamArgs(input, 'webcam.mp4'), micArgs(input, 'mic.m4a')]) {
      expect(args.slice(0, 2)).toEqual(['-use_wallclock_as_timestamps', '1']);
      expect(args.join(' ')).toContain('-movflags +frag_keyframe+empty_moov+default_base_moof -flush_packets 1 -f mp4');
    }
  });

  it('encodes video as tagged BT.709 with a key frame every 2 s', () => {
    const args = screenArgs(input, 'screen.mp4');
    expect(args).toContain(`[0:v]${BT709}[out]`);
    expect(args.join(' ')).toContain('-force_key_frames expr:gte(t,n_forced*2)');
    expect(args.join(' ')).toContain('-color_trc bt709');
    expect(args.slice(-2)).toEqual(['-y', 'screen.mp4']);
  });

  it('adds a freezedetect branch only for untilIdleSeconds', () => {
    expect(screenArgs(input, 'screen.mp4').join(' ')).not.toContain('freezedetect');
    expect(screenArgs(input, 'screen.mp4', 4)).toContain(
      `[0:v]split[rec][idle];[idle]scale=320:-2,format=gray,freezedetect=n=-60dB:d=4,nullsink;[rec]${BT709}[out]`,
    );
  });

  it('cuts the mic into 1 s fragments and watches it for digital silence', () => {
    const args = micArgs(input, 'mic.m4a').join(' ');
    expect(args).toContain('silencedetect=n=-80dB:d=1');
    expect(args).toContain('-c:a aac -b:a 160k -frag_duration 1000000');
  });

  it('reads freezedetect and silencedetect log lines', () => {
    expect(freezeStart('[Parsed_freezedetect_3 @ 00000132707ccd00] lavfi.freezedetect.freeze_start: 0.973633')).toBe(0.973633);
    expect(freezeStart('[Parsed_freezedetect_3 @ 0000] lavfi.freezedetect.freeze_start: 0')).toBe(0);
    expect(freezeStart('[Parsed_freezedetect_3 @ 0000] lavfi.freezedetect.freeze_end: 2.5')).toBeUndefined();
    expect(silenceStart('[Parsed_silencedetect_1 @ 000001d796c83380] silence_start: 0.0180833')).toBe(0.0180833);
    expect(silenceStart('[Parsed_silencedetect_1 @ 0000] silence_end: 3.032 | silence_duration: 3.01')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/recorder/test/args.test.ts`
Expected: FAIL, the suite cannot load: `Error: Cannot find module '../src/args' imported from …/packages/recorder/test/args.test.ts` and `Tests  no tests`.

- [ ] **Step 3: Implement the builders**

`packages/recorder/src/args.ts`:

```ts
// ffmpeg command lines for the three capture processes. Pure: the inputs come from sources.ts.

export const FRAME_RATE = 30;

/** Every capture input stamps its packets with the wall clock, so take.json can line tracks up. */
const WALLCLOCK = ['-use_wallclock_as_timestamps', '1'];

/**
 * BT.709 matrix and tags (Chromium decodes untagged HD video as BT.709; ffmpeg converts RGB with
 * BT.601 by default). `setparams` replaces the sRGB transfer that ddagrab frames carry, which the
 * encoder flags alone do not override.
 */
const VIDEO_CHAIN =
  'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';

/** H.264 at high quality; a key frame every 2 s, so a fragment (one GOP) loses at most 2 s in a crash. */
const VIDEO_CODEC = [
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
  '-force_key_frames', 'expr:gte(t,n_forced*2)',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
];
const AUDIO_CODEC = ['-c:a', 'aac', '-b:a', '160k'];

/**
 * Fragmented MP4, so a killed ffmpeg leaves a readable file up to its last fragment. A video fragment
 * is one GOP (2 s). `-flush_packets 1` writes every packet through: without it a killed ffmpeg left
 * 28 bytes (no moov) of a still screen or of the mic, because its write buffer never filled.
 */
const FRAGMENTED_MP4 = ['-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-flush_packets', '1', '-f', 'mp4'];
/** Audio has no GOPs (`frag_keyframe` alone wrote no fragment at all): cut a fragment every second. */
const AUDIO_FRAGMENTS = ['-frag_duration', '1000000'];

/** Change below this (a blinking caret is ~1e-5 of the picture) counts as an unchanged screen. */
const IDLE_NOISE = '-60dB';
/** Digital silence: a muted or blocked microphone delivers zeros (−91 dB measured); room noise is far louder. */
const SILENCE_NOISE = '-80dB';
/** Seconds of digital silence before the mic counts as silent. */
export const SILENCE_SECONDS = 1;

/**
 * The screen track. With `idleSeconds`, a small grey copy of the picture runs through
 * `freezedetect`, which logs `lavfi.freezedetect.freeze_start` once nothing changed for that long.
 */
export function screenArgs(input: readonly string[], file: string, idleSeconds?: number): string[] {
  const graph =
    idleSeconds === undefined
      ? `[0:v]${VIDEO_CHAIN}[out]`
      : `[0:v]split[rec][idle];[idle]scale=320:-2,format=gray,freezedetect=n=${IDLE_NOISE}:d=${idleSeconds},nullsink;[rec]${VIDEO_CHAIN}[out]`;
  return [...WALLCLOCK, ...input, '-filter_complex', graph, '-map', '[out]', ...VIDEO_CODEC, ...FRAGMENTED_MP4, '-y', file];
}

export function webcamArgs(input: readonly string[], file: string): string[] {
  return [...WALLCLOCK, ...input, '-filter_complex', `[0:v]${VIDEO_CHAIN}[out]`, '-map', '[out]', ...VIDEO_CODEC, ...FRAGMENTED_MP4, '-y', file];
}

/** The mic track, with `silencedetect` on a copy so a muted microphone can be reported. */
export function micArgs(input: readonly string[], file: string): string[] {
  const graph = `[0:a]asplit[rec][chk];[chk]silencedetect=n=${SILENCE_NOISE}:d=${SILENCE_SECONDS},anullsink;[rec]anull[out]`;
  return [...WALLCLOCK, ...input, '-filter_complex', graph, '-map', '[out]', ...AUDIO_CODEC, ...AUDIO_FRAGMENTS, ...FRAGMENTED_MP4, '-y', file];
}

/** `[Parsed_freezedetect_3 @ …] lavfi.freezedetect.freeze_start: 0.973633` → 0.973633 */
export function freezeStart(line: string): number | undefined {
  const match = /lavfi\.freezedetect\.freeze_start: (\d+(?:\.\d+)?)/.exec(line);
  return match ? Number(match[1]) : undefined;
}

/** `[Parsed_silencedetect_1 @ …] silence_start: 0.0180833` → 0.0180833 */
export function silenceStart(line: string): number | undefined {
  const match = /silence_start: (-?\d+(?:\.\d+)?)/.exec(line);
  return match ? Number(match[1]) : undefined;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run packages/recorder/test/args.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/args.ts packages/recorder/test/args.test.ts
git commit -m "recorder: ffmpeg command lines (BT.709, flushed fragments, idle and silence detection)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Test devices, capture areas and ffmpeg inputs

Which platform records (`windows` or `test`), the test backend's devices, how a monitor, region or window becomes a monitor plus an even-sized crop, and the ffmpeg inputs of each backend: ddagrab with GPU cropping, DirectShow with the small mic buffer, paced lavfi sources.

**Files:**
- Create: `packages/recorder/src/sources.ts`
- Test: `packages/recorder/test/sources.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/recorder/test/sources.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_DEVICES, areaGeometry, checkDevice, micInput, micLatency, platformFor, resolveArea, screenInput, webcamInput } from '../src/sources';
import type { Devices } from '../src/types';

const devices: Devices = {
  monitors: [
    { index: 0, name: 'DISPLAY1', bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scale: 1.25, primary: true },
    { index: 1, name: 'DISPLAY2', bounds: { x: 2560, y: 509, width: 1920, height: 1080 }, scale: 1, primary: false },
    { index: 2, name: 'DISPLAY3', bounds: { x: -1080, y: -335, width: 1080, height: 1920 }, scale: 1, primary: false },
  ],
  windows: [
    { title: 'Claude Code - demo', bounds: { x: 2600, y: 600, width: 801, height: 501 }, monitor: 1 },
    { title: 'Editor', bounds: { x: -1200, y: 100, width: 700, height: 400 }, monitor: 2 },
    { title: 'Browser - docs', bounds: { x: 10, y: 10, width: 100, height: 100 }, monitor: 0 },
    { title: 'Browser - mail', bounds: { x: 10, y: 10, width: 100, height: 100 }, monitor: 0 },
  ],
  cameras: ['Cam'],
  mics: ['Mic (USB)'],
};

afterEach(() => vi.unstubAllGlobals());

describe('platformFor', () => {
  it('uses the test backend anywhere and real capture on Windows only', () => {
    expect(platformFor('test')).toBe('test');
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    expect(() => platformFor('auto')).toThrow(expect.objectContaining({ code: 'unsupported-platform' }));
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    expect(platformFor()).toBe('windows');
  });
});

describe('resolveArea', () => {
  it('captures a whole monitor', () => {
    const area = resolveArea({ kind: 'monitor', index: 1 }, devices);
    expect(area).toEqual({ monitor: devices.monitors[1] });
    expect(areaGeometry(area)).toEqual({ size: { width: 1920, height: 1080 }, origin: { x: 2560, y: 509 } });
  });

  it('names the monitors when the index does not exist', () => {
    expect(() => resolveArea({ kind: 'monitor', index: 5 }, devices)).toThrow(
      expect.objectContaining({ code: 'device-not-found', message: 'there is no monitor 5; monitors: 0 (2560×1440), 1 (1920×1080), 2 (1080×1920)' }),
    );
  });

  it('crops a region in monitor pixels, rounding the size down to even numbers', () => {
    const area = resolveArea({ kind: 'region', rect: [100, 50, 401, 301], monitor: 2 }, devices);
    expect(area.crop).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    expect(areaGeometry(area)).toEqual({ size: { width: 400, height: 300 }, origin: { x: -980, y: -285 } });
  });

  it('treats a region that covers the whole monitor as the monitor', () => {
    expect(resolveArea({ kind: 'region', rect: [0, 0, 1920, 1080], monitor: 1 }, devices).crop).toBeUndefined();
  });

  it('refuses a region outside its monitor', () => {
    for (const rect of [[1800, 0, 200, 100], [-1, 0, 200, 100], [0, 0, 1, 100]] as const) {
      expect(() => resolveArea({ kind: 'region', rect: [...rect], monitor: 1 }, devices)).toThrow(expect.objectContaining({ code: 'invalid-options' }));
    }
  });

  it('captures a window as the region of its bounds', () => {
    const area = resolveArea({ kind: 'window', title: 'Claude Code - demo' }, devices);
    expect(area).toEqual({ monitor: devices.monitors[1], crop: { x: 40, y: 91, width: 800, height: 500 } });
    expect(areaGeometry(area).origin).toEqual({ x: 2600, y: 600 });
  });

  it('clips a window to the monitor that holds its centre', () => {
    expect(resolveArea({ kind: 'window', title: 'Editor' }, devices).crop).toEqual({ x: 0, y: 435, width: 580, height: 400 });
  });

  it('finds a window by a unique part of its title, ignoring case', () => {
    expect(resolveArea({ kind: 'window', title: 'claude code' }, devices).monitor.index).toBe(1);
    expect(() => resolveArea({ kind: 'window', title: 'browser' }, devices)).toThrow(
      expect.objectContaining({ code: 'invalid-options', message: '"browser" matches 2 windows: "Browser - docs", "Browser - mail"' }),
    );
    expect(() => resolveArea({ kind: 'window', title: 'Terminal' }, devices)).toThrow(expect.objectContaining({ code: 'device-not-found' }));
  });
});

describe('checkDevice', () => {
  it('checks camera and mic names against the list', () => {
    expect(() => checkDevice('mic', 'Mic (USB)', devices)).not.toThrow();
    expect(() => checkDevice('camera', 'Webcam', devices)).toThrow(
      expect.objectContaining({ code: 'device-not-found', message: 'there is no camera "Webcam"; cameras: "Cam"' }),
    );
  });
});

describe('ffmpeg inputs', () => {
  it('grabs a monitor with ddagrab on Windows, cropped on the GPU for a region', () => {
    const monitor = devices.monitors[1]!;
    expect(screenInput('windows', { monitor }, false)).toEqual(['-f', 'lavfi', '-i', 'ddagrab=output_idx=1:framerate=30:draw_mouse=0,hwdownload,format=bgra,settb=1/1000000']);
    expect(screenInput('windows', { monitor, crop: { x: 40, y: 92, width: 800, height: 500 } }, true)[3]).toBe(
      'ddagrab=output_idx=1:framerate=30:draw_mouse=1:offset_x=40:offset_y=92:video_size=800x500,hwdownload,format=bgra,settb=1/1000000',
    );
  });

  it('paces the test patterns in real time', () => {
    const [moving, still] = TEST_DEVICES.monitors;
    expect(screenInput('test', { monitor: moving! }, false)[3]).toBe('testsrc2=s=1280x720:r=30,realtime,settb=1/1000000');
    expect(screenInput('test', { monitor: still! }, false)[3]).toBe('testsrc2=s=640x360:r=30:d=1,tpad=stop=-1:stop_mode=clone,realtime,settb=1/1000000');
    expect(screenInput('test', { monitor: moving!, crop: { x: 2, y: 4, width: 100, height: 50 } }, false)[3]).toBe(
      'testsrc2=s=1280x720:r=30,crop=100:50:2:4,realtime,settb=1/1000000',
    );
    expect(webcamInput('test', 'Failing Test Camera')[3]).toBe('testsrc=s=640x480:r=30:d=1,realtime,settb=1/1000000');
    expect(micInput('test', 'Silent Test Microphone')[3]).toBe('anullsrc=r=48000:cl=mono,arealtime');
  });

  it('opens DirectShow devices with a small mic buffer and corrects the mic start by it', () => {
    expect(webcamInput('windows', 'Cam')).toEqual(['-f', 'dshow', '-rtbufsize', '256M', '-i', 'video=Cam']);
    expect(micInput('windows', 'Mic (USB)')).toEqual(['-f', 'dshow', '-audio_buffer_size', '50', '-i', 'audio=Mic (USB)']);
    expect(micLatency('windows')).toBe(0.05);
    expect(micLatency('test')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/recorder/test/sources.test.ts`
Expected: FAIL, the suite cannot load: `Error: Cannot find module '../src/sources' imported from …/packages/recorder/test/sources.test.ts` and `Tests  no tests`.

- [ ] **Step 3: Implement the sources**

`packages/recorder/src/sources.ts`:

```ts
// Which ffmpeg inputs a backend uses, and which part of which monitor a capture source covers.
import { FRAME_RATE } from './args';
import { RecorderError } from './errors';
import type { Backend, Bounds, CaptureSource, Devices, Monitor } from './types';

/** `test` works everywhere; real capture exists for Windows so far. */
export type Platform = 'windows' | 'test';

export function platformFor(backend: Backend = 'auto'): Platform {
  if (backend === 'test') return 'test';
  if (process.platform === 'win32') return 'windows';
  throw new RecorderError('unsupported-platform', `recording on ${process.platform} is not supported yet; only Windows (and backend "test")`);
}

/**
 * The test backend's devices. Monitor 0 shows a moving test pattern; monitor 1 moves for 1 s and
 * then stands still (for `untilIdleSeconds`). "Silent Test Microphone" delivers digital silence;
 * "Failing Test Camera" ends after 1 s, like a camera that is unplugged.
 */
export const TEST_DEVICES: Devices = {
  monitors: [
    { index: 0, name: 'Test Monitor', bounds: { x: 0, y: 0, width: 1280, height: 720 }, scale: 1, primary: true },
    { index: 1, name: 'Still Test Monitor', bounds: { x: 1280, y: 0, width: 640, height: 360 }, scale: 1, primary: false },
  ],
  windows: [{ title: 'Test Window', bounds: { x: 100, y: 60, width: 640, height: 360 }, monitor: 0 }],
  cameras: ['Test Camera', 'Failing Test Camera'],
  mics: ['Test Microphone', 'Silent Test Microphone'],
};

/** What the screen track captures: a monitor, optionally cropped (monitor pixels, even sizes). */
export interface ScreenArea {
  monitor: Monitor;
  crop?: Bounds;
}

/** The area's size and its top-left corner on the desktop (where events.jsonl's origin lies). */
export function areaGeometry(area: ScreenArea): { size: { width: number; height: number }; origin: { x: number; y: number } } {
  const { bounds } = area.monitor;
  const crop = area.crop ?? { x: 0, y: 0, width: bounds.width, height: bounds.height };
  return { size: { width: crop.width, height: crop.height }, origin: { x: bounds.x + crop.x, y: bounds.y + crop.y } };
}

const even = (value: number) => Math.floor(value / 2) * 2;

/** Resolves a capture source against the device list. */
export function resolveArea(source: CaptureSource, devices: Devices): ScreenArea {
  const monitorAt = (index: number) => {
    const monitor = devices.monitors.find((candidate) => candidate.index === index);
    if (monitor) return monitor;
    const known = devices.monitors.map((candidate) => `${candidate.index} (${candidate.bounds.width}×${candidate.bounds.height})`).join(', ');
    throw new RecorderError('device-not-found', `there is no monitor ${index}; monitors: ${known || 'none'}`);
  };
  switch (source.kind) {
    case 'monitor':
      return { monitor: monitorAt(source.index) };
    case 'region': {
      const monitor = monitorAt(source.monitor);
      const [x, y, width, height] = source.rect.map(Math.round) as [number, number, number, number];
      const crop = { x, y, width: even(width), height: even(height) };
      if (x < 0 || y < 0 || crop.width < 2 || crop.height < 2 || x + crop.width > monitor.bounds.width || y + crop.height > monitor.bounds.height) {
        throw new RecorderError(
          'invalid-options',
          `region [${source.rect.join(', ')}] is not inside monitor ${monitor.index} (${monitor.bounds.width}×${monitor.bounds.height}); give it in that monitor's pixels`,
        );
      }
      return { monitor, crop: fullOrCrop(monitor, crop) };
    }
    case 'window': {
      const window = findWindow(source.title, devices);
      const monitor = monitorAt(window.monitor);
      const { bounds } = monitor;
      // The part of the window on the monitor that holds its centre, in that monitor's pixels.
      const left = Math.max(window.bounds.x, bounds.x) - bounds.x;
      const top = Math.max(window.bounds.y, bounds.y) - bounds.y;
      const right = Math.min(window.bounds.x + window.bounds.width, bounds.x + bounds.width) - bounds.x;
      const bottom = Math.min(window.bounds.y + window.bounds.height, bounds.y + bounds.height) - bounds.y;
      const crop = { x: left, y: top, width: even(right - left), height: even(bottom - top) };
      if (crop.width < 2 || crop.height < 2) throw new RecorderError('invalid-options', `window "${window.title}" is not visible on a monitor`);
      return { monitor, crop: fullOrCrop(monitor, crop) };
    }
  }
}

function fullOrCrop(monitor: Monitor, crop: Bounds): Bounds | undefined {
  const full = crop.x === 0 && crop.y === 0 && crop.width === monitor.bounds.width && crop.height === monitor.bounds.height;
  return full ? undefined : crop;
}

/** An exact title, otherwise the one window whose title contains `title` (ignoring case). */
function findWindow(title: string, devices: Devices) {
  const exact = devices.windows.find((window) => window.title === title);
  if (exact) return exact;
  const needle = title.toLowerCase();
  const matches = devices.windows.filter((window) => window.title.toLowerCase().includes(needle));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new RecorderError('invalid-options', `"${title}" matches ${matches.length} windows: ${matches.map((window) => `"${window.title}"`).join(', ')}`);
  }
  throw new RecorderError('device-not-found', `no window title contains "${title}"`);
}

/** Checks a webcam or mic name against the device list. */
export function checkDevice(kind: 'camera' | 'mic', name: string, devices: Devices): void {
  const names = kind === 'camera' ? devices.cameras : devices.mics;
  if (names.includes(name)) return;
  throw new RecorderError('device-not-found', `there is no ${kind} "${name}"; ${kind}s: ${names.map((known) => `"${known}"`).join(', ') || 'none'}`);
}

const MICROSECONDS = 'settb=1/1000000';

/** ffmpeg input arguments of the screen track. */
export function screenInput(platform: Platform, area: ScreenArea, drawMouse: boolean): string[] {
  const { monitor, crop } = area;
  if (platform === 'test') {
    const { width, height } = monitor.bounds;
    const pattern = `testsrc2=s=${width}x${height}:r=${FRAME_RATE}`;
    // `realtime` paces the frames like a capture device; wall-clock timestamps need that.
    const source = monitor.name === 'Still Test Monitor' ? `${pattern}:d=1,tpad=stop=-1:stop_mode=clone` : pattern;
    const cropped = crop ? `${source},crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}` : source;
    return ['-f', 'lavfi', '-i', `${cropped},realtime,${MICROSECONDS}`];
  }
  const region = crop ? `:offset_x=${crop.x}:offset_y=${crop.y}:video_size=${crop.width}x${crop.height}` : '';
  const grab = `ddagrab=output_idx=${monitor.index}:framerate=${FRAME_RATE}:draw_mouse=${drawMouse ? 1 : 0}${region}`;
  return ['-f', 'lavfi', '-i', `${grab},hwdownload,format=bgra,${MICROSECONDS}`];
}

export function webcamInput(platform: Platform, name: string): string[] {
  if (platform === 'test') {
    const end = name === 'Failing Test Camera' ? ':d=1' : '';
    return ['-f', 'lavfi', '-i', `testsrc=s=640x480:r=${FRAME_RATE}${end},realtime,${MICROSECONDS}`];
  }
  return ['-f', 'dshow', '-rtbufsize', '256M', '-i', `video=${name}`];
}

/**
 * A small DirectShow buffer: with wall-clock timestamps a packet is stamped when it arrives, one
 * buffer after its first sample was captured (the device default measured ~500 ms).
 */
const MIC_BUFFER_MS = 50;

/** Seconds to subtract from the mic's stamped start to get the time of its first sample. */
export function micLatency(platform: Platform): number {
  return platform === 'windows' ? MIC_BUFFER_MS / 1000 : 0;
}

export function micInput(platform: Platform, name: string): string[] {
  if (platform === 'test') {
    const source = name === 'Silent Test Microphone' ? 'anullsrc=r=48000:cl=mono' : 'sine=frequency=440:sample_rate=48000';
    return ['-f', 'lavfi', '-i', `${source},arealtime`];
  }
  return ['-f', 'dshow', '-audio_buffer_size', String(MIC_BUFFER_MS), '-i', `audio=${name}`];
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run packages/recorder/test/sources.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/sources.ts packages/recorder/test/sources.test.ts
git commit -m "recorder: test devices, capture areas and ffmpeg inputs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The events.jsonl writer

Maps raw input (wall-clock seconds, desktop pixels) into events.jsonl lines in screen-track seconds and pixels, as `parseEventsJsonl` reads them.

**Files:**
- Create: `packages/recorder/src/events.ts`
- Test: `packages/recorder/test/events.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/recorder/test/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseEventsJsonl, type InputEvent } from '@cuttle/project';
import { EventsWriter } from '../src/events';
import type { RawInput } from '../src/types';

/** A writer whose screen track started at wall-clock 1000 s, capturing from desktop (100, 50). */
function writer() {
  let text = '';
  const events = new EventsWriter((line) => (text += line), { x: 100, y: 50 });
  const read = (): InputEvent[] => {
    const parsed = parseEventsJsonl(text);
    expect(parsed.issues).toEqual([]);
    return parsed.events;
  };
  return { events, read };
}

describe('EventsWriter', () => {
  it('maps wall-clock seconds and desktop pixels into the screen track', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
    events.push({ type: 'click', time: 1001.2345, x: 150, y: 70, button: 'right' });
    events.push({ type: 'scroll', time: 1001.5, x: 90, y: 40, dx: 0, dy: -2 });
    events.push({ type: 'shape', time: 1002, shape: 'text' });
    expect(read()).toEqual([
      { t: 1.235, type: 'click', x: 50, y: 20, button: 'right' },
      { t: 1.5, type: 'scroll', x: -10, y: -10, dx: 0, dy: -2 },
      { t: 2, type: 'shape', shape: 'text' },
    ]);
  });

  it('writes the initial pointer first, then input from before the start was known, dropping what came before the first frame', () => {
    const { events, read } = writer();
    events.push({ type: 'click', time: 999.9, x: 100, y: 50, button: 'left' });
    events.push({ type: 'click', time: 1000.4, x: 110, y: 60, button: 'left' });
    events.setStart(1000, [
      { type: 'move', time: 1000, x: 300, y: 250 },
      { type: 'shape', time: 1000, shape: 'arrow' },
    ]);
    expect(read()).toEqual([
      { t: 0, type: 'move', x: 200, y: 200 },
      { t: 0, type: 'shape', shape: 'arrow' },
      { t: 0.4, type: 'click', x: 10, y: 10, button: 'left' },
    ]);
  });

  it('thins moves to one per 1/60 s slot and keeps the last move of a burst', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
    // A 125 Hz mouse: 8 ms apart, from (100, 50) to (164, 50).
    for (let i = 0; i <= 8; i++) events.push({ type: 'move', time: 1000 + i * 0.008, x: 100 + i * 8, y: 50 });
    events.close();
    const moves = read();
    expect(moves.map((move) => move.t)).toEqual([0, 0.024, 0.04, 0.056, 0.064]);
    expect(moves.at(-1)).toEqual({ t: 0.064, type: 'move', x: 64, y: 0 });
  });

  it('writes a held-back move before a click, so the click comes after the pointer got there', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
    events.push({ type: 'move', time: 1000.001, x: 110, y: 50 });
    events.push({ type: 'move', time: 1000.005, x: 120, y: 50 });
    events.push({ type: 'click', time: 1000.006, x: 120, y: 50, button: 'left' });
    expect(read().map((event) => [event.type, event.t])).toEqual([
      ['move', 0.001],
      ['move', 0.005],
      ['click', 0.006],
    ]);
  });

  it('counts key presses per half second without storing which keys', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
    const keys: RawInput[] = [1000.1, 1000.2, 1000.45, 1000.6, 1002.05].map((time) => ({ type: 'key', time }));
    keys.forEach((key) => events.push(key));
    events.close();
    expect(read()).toEqual([
      { t: 0, type: 'keys', count: 3 },
      { t: 0.5, type: 'keys', count: 1 },
      { t: 2, type: 'keys', count: 1 },
    ]);
  });

  it('ignores input after close (the hook can deliver one more event)', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
    events.close();
    events.push({ type: 'click', time: 1003, x: 100, y: 50, button: 'left' });
    expect(read()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/recorder/test/events.test.ts`
Expected: FAIL, the suite cannot load: `Error: Cannot find module '../src/events' imported from …/packages/recorder/test/events.test.ts` and `Tests  no tests`.

- [ ] **Step 3: Implement the writer**

`packages/recorder/src/events.ts`:

```ts
import type { InputEvent } from '@cuttle/project';
import type { RawInput } from './types';

/**
 * Moves are thinned to one per 1/60 s slot (a 125 Hz mouse would double the file for nothing); the
 * last move of a burst is kept, so the pointer ends where it stopped.
 */
const MOVE_RATE = 60;
/**
 * Key presses are counted per half second: neither which keys nor the exact timing of each press is
 * stored. The `keys` event carries the start of its half second, so it can come after later events.
 */
export const KEY_WINDOW = 0.5;
/** Events kept while the screen track's start is not known yet (about 2 s of input). */
const MAX_PENDING = 2_000;

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * Maps raw input (wall-clock seconds, desktop pixels) into events.jsonl lines (screen-track seconds,
 * screen-track pixels) and hands each line to `write`. Input before the screen track's first frame is
 * dropped. Call `close()` at the end: it writes the held-back move and key count.
 */
export class EventsWriter {
  private start: number | undefined;
  private pending: RawInput[] = [];
  private lastSlot = -1;
  private heldMove: InputEvent | undefined;
  private keys: { window: number; count: number } | undefined;
  private closed = false;

  constructor(
    private readonly write: (line: string) => void,
    private readonly origin: { x: number; y: number },
  ) {}

  /**
   * The screen track's start (wall-clock seconds). Writes `initial` (the pointer's position and shape
   * at that moment) first, then the input that came in while the start was not known.
   */
  setStart(start: number, initial: readonly RawInput[]): void {
    this.start = start;
    const pending = this.pending;
    this.pending = [];
    for (const input of [...initial, ...pending]) this.push(input);
  }

  push(input: RawInput): void {
    if (this.closed) return; // the hook can deliver a last event after it was stopped
    if (this.start === undefined) {
      if (this.pending.length < MAX_PENDING) this.pending.push(input);
      return;
    }
    const t = input.time - this.start;
    if (t < 0) return;
    const at = round(t);
    const x = 'x' in input ? input.x - this.origin.x : 0;
    const y = 'y' in input ? input.y - this.origin.y : 0;
    switch (input.type) {
      case 'move': {
        const slot = Math.floor(t * MOVE_RATE);
        if (slot === this.lastSlot) {
          this.heldMove = { t: at, type: 'move', x, y };
          return;
        }
        this.lastSlot = slot;
        this.heldMove = undefined;
        return this.emit({ t: at, type: 'move', x, y });
      }
      case 'click':
        this.flushMove();
        return this.emit({ t: at, type: 'click', x, y, button: input.button });
      case 'scroll':
        this.flushMove();
        return this.emit({ t: at, type: 'scroll', x, y, dx: input.dx, dy: input.dy });
      case 'shape':
        this.flushMove();
        return this.emit({ t: at, type: 'shape', shape: input.shape });
      case 'key': {
        const window = Math.floor(t / KEY_WINDOW);
        if (this.keys?.window === window) {
          this.keys.count++;
          return;
        }
        this.flushKeys();
        this.keys = { window, count: 1 };
        return;
      }
    }
  }

  close(): void {
    this.flushMove();
    this.flushKeys();
    this.closed = true;
  }

  private flushMove(): void {
    if (this.heldMove === undefined) return;
    this.emit(this.heldMove);
    this.heldMove = undefined;
  }

  private flushKeys(): void {
    if (this.keys === undefined) return;
    this.emit({ t: round(this.keys.window * KEY_WINDOW), type: 'keys', count: this.keys.count });
    this.keys = undefined;
  }

  private emit(event: InputEvent): void {
    this.write(`${JSON.stringify(event)}\n`);
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run packages/recorder/test/events.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/events.ts packages/recorder/test/events.test.ts
git commit -m "recorder: events.jsonl writer (60 Hz moves, key counts per half second)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Claude Code transcripts

Where a folder's transcripts live, which lines are prompts, tool calls and the end of a turn, and a watcher that follows the first session to submit a prompt.

**Files:**
- Create: `packages/recorder/src/claude.ts`
- Test: `packages/recorder/test/claude.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/recorder/test/claude.test.ts`:

```ts
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { claudeTranscriptDir, readTranscriptLine, watchClaude, type ClaudeSignal } from '../src/claude';

afterEach(() => vi.unstubAllEnvs());
const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const at = '2026-10-16T21:00:05.250Z';
const time = Date.parse(at) / 1000;
const line = (value: object) => JSON.stringify({ timestamp: at, ...value });

describe('claudeTranscriptDir', () => {
  it('replaces every character but letters and digits in the absolute folder', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '');
    const cwd = process.platform === 'win32' ? 'C:\\Users\\me\\Rufi v0.1' : '/home/me/Rufi v0.1';
    const slug = process.platform === 'win32' ? 'C--Users-me-Rufi-v0-1' : '-home-me-Rufi-v0-1';
    expect(claudeTranscriptDir(cwd)).toBe(join(homedir(), '.claude', 'projects', slug));
  });

  it('follows CLAUDE_CONFIG_DIR like Claude Code', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(tmpdir(), 'claude-config'));
    expect(claudeTranscriptDir(tmpdir()).startsWith(join(tmpdir(), 'claude-config', 'projects'))).toBe(true);
  });
});

describe('readTranscriptLine', () => {
  it('reads a submitted prompt, as text or as text blocks', () => {
    expect(readTranscriptLine(line({ type: 'user', message: { role: 'user', content: 'build it' } }))).toEqual([{ kind: 'prompt', time }]);
    expect(readTranscriptLine(line({ type: 'user', message: { content: [{ type: 'text', text: 'see image' }, { type: 'image' }] } }))).toEqual([{ kind: 'prompt', time }]);
  });

  it('skips tool results, meta lines, subagents and local command output', () => {
    expect(readTranscriptLine(line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } }))).toEqual([]);
    expect(readTranscriptLine(line({ type: 'user', isMeta: true, message: { content: 'caveat' } }))).toEqual([]);
    expect(readTranscriptLine(line({ type: 'user', isSidechain: true, message: { content: 'subagent task' } }))).toEqual([]);
    expect(readTranscriptLine(line({ type: 'user', message: { content: '<local-command-stdout>ok</local-command-stdout>' } }))).toEqual([]);
  });

  it('reads tool calls and the end of the turn', () => {
    expect(readTranscriptLine(line({ type: 'assistant', message: { id: 'm1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash' }, { type: 'tool_use', id: 't2', name: 'Read' }] } }))).toEqual([
      { kind: 'tool', time, label: 'Bash', id: 't1' },
      { kind: 'tool', time, label: 'Read', id: 't2' },
    ]);
    expect(readTranscriptLine(line({ type: 'assistant', message: { id: 'm2', stop_reason: 'end_turn', content: [{ type: 'thinking' }] } }))).toEqual([{ kind: 'answer', time, id: 'm2' }]);
    expect(readTranscriptLine(line({ type: 'assistant', isApiErrorMessage: true, message: { id: 'm3', stop_reason: 'stop_sequence', content: [] } }))).toEqual([{ kind: 'answer', time, id: 'm3' }]);
    expect(readTranscriptLine(line({ type: 'assistant', isSidechain: true, message: { id: 'm4', stop_reason: 'end_turn', content: [] } }))).toEqual([]);
  });

  it('ignores lines it cannot read', () => {
    expect(readTranscriptLine('{"type":"user"')).toEqual([]);
    expect(readTranscriptLine('null')).toEqual([]);
    expect(readTranscriptLine(JSON.stringify({ type: 'user', message: { content: 'no time' } }))).toEqual([]);
    expect(readTranscriptLine(line({ type: 'attachment' }))).toEqual([]);
  });
});

describe('watchClaude', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const now = () => new Date().toISOString();
  const entry = (value: object) => `${JSON.stringify({ timestamp: now(), ...value })}\n`;
  const prompt = () => entry({ type: 'user', message: { content: 'go' } });
  const end = (id: string) => entry({ type: 'assistant', message: { id, stop_reason: 'end_turn', content: [{ type: 'text' }] } });

  function setup() {
    const dir = temp('cuttle-transcripts-');
    const signals: ClaudeSignal[] = [];
    return { dir, signals, kinds: () => signals.map((signal) => signal.kind) };
  }

  it('follows the first session that submits a prompt and ignores the others', async () => {
    const { dir, signals, kinds } = setup();
    writeFileSync(join(dir, 'busy.jsonl'), entry({ type: 'user', message: { content: 'old prompt' } }));
    const watcher = watchClaude(dir, Date.now() / 1000 - 0.1, (signal) => signals.push(signal));
    await sleep(300);
    appendFileSync(join(dir, 'busy.jsonl'), end('b1')); // another session finishing its own turn
    await sleep(300);
    appendFileSync(join(dir, 'demo.jsonl'), prompt());
    appendFileSync(join(dir, 'demo.jsonl'), entry({ type: 'assistant', message: { id: 'a1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } }));
    await sleep(300);
    appendFileSync(join(dir, 'busy.jsonl'), prompt() + end('b2')); // the other session again: not followed
    appendFileSync(join(dir, 'demo.jsonl'), end('a2') + end('a2')); // one message, two lines
    await sleep(400);
    watcher.stop();
    expect(kinds()).toEqual(['prompt', 'tool', 'answer']);
    expect(signals[1]).toMatchObject({ label: 'Bash' });
  });

  it('reads a file that exists when watching starts from its end, and ignores lines from before `since`', async () => {
    const { dir, signals, kinds } = setup();
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, prompt() + end('x1'));
    const watcher = watchClaude(dir, Date.now() / 1000 + 0.2, (signal) => signals.push(signal));
    await sleep(100);
    appendFileSync(file, prompt()); // written before `since`
    await sleep(400);
    appendFileSync(file, prompt());
    await sleep(400);
    watcher.stop();
    expect(kinds()).toEqual(['prompt']);
  });

  it('waits for the transcript folder and for lines that are written in pieces', async () => {
    const { dir, signals, kinds } = setup();
    const folder = join(dir, 'not-yet');
    const watcher = watchClaude(folder, Date.now() / 1000 - 0.1, (signal) => signals.push(signal));
    await sleep(300);
    mkdirSync(folder);
    const text = entry({ type: 'user', message: { content: 'größer als 🐟' } });
    const bytes = Buffer.from(text);
    const cut = bytes.indexOf(Buffer.from('🐟')) + 2; // in the middle of a 4-byte character
    appendFileSync(join(folder, 's.jsonl'), bytes.subarray(0, cut));
    await sleep(400);
    expect(kinds()).toEqual([]);
    appendFileSync(join(folder, 's.jsonl'), bytes.subarray(cut));
    await sleep(400);
    watcher.stop();
    expect(kinds()).toEqual(['prompt']);
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/recorder/test/claude.test.ts`
Expected: FAIL, the suite cannot load: `Error: Cannot find module '../src/claude' imported from …/packages/recorder/test/claude.test.ts` and `Tests  no tests`.

- [ ] **Step 3: Implement the transcript reader and watcher**

`packages/recorder/src/claude.ts`:

```ts
// Watches Claude Code transcripts for `untilClaude`: prompts, tool calls and the end of the turn.
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/** How often the transcript folder is read. */
const POLL_MS = 250;

/**
 * Where Claude Code keeps the transcripts (`<session id>.jsonl`) of sessions started in `cwd`:
 * `<config dir>/projects/<absolute cwd with every character but a-z, A-Z, 0-9 replaced by ->`.
 * The config dir is `CLAUDE_CONFIG_DIR` when set, like Claude Code itself.
 */
export function claudeTranscriptDir(cwd: string, configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')): string {
  return join(configDir, 'projects', resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'));
}

export interface ClaudeSignal {
  kind: 'prompt' | 'tool' | 'answer';
  /** Wall-clock seconds, from the line's `timestamp`. */
  time: number;
  /** The tool's name, for `tool`. */
  label?: string;
  /** For deduplication: the tool call's id, or the message id of an `answer`. */
  id?: string;
}

interface TranscriptLine {
  type?: unknown;
  timestamp?: unknown;
  isSidechain?: unknown;
  isMeta?: unknown;
  isApiErrorMessage?: unknown;
  message?: { id?: unknown; stop_reason?: unknown; content?: unknown };
}

/**
 * The signals in one transcript line. Subagent lines (`isSidechain`) and meta lines are skipped. A
 * prompt is a user line with text (tool results are user lines too); every line of an assistant
 * message carries the message's final `stop_reason`, so an `end_turn` (or an API error, which ends the
 * turn as well) shows up once per line and is deduplicated by message id.
 */
export function readTranscriptLine(text: string): ClaudeSignal[] {
  let line: TranscriptLine;
  try {
    line = JSON.parse(text) as TranscriptLine;
  } catch {
    return [];
  }
  if (typeof line !== 'object' || line === null || line.isSidechain === true || line.isMeta === true) return [];
  const time = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) / 1000 : Number.NaN;
  if (!Number.isFinite(time)) return [];
  const content = line.message?.content;
  if (line.type === 'user') return isPrompt(content) ? [{ kind: 'prompt', time }] : [];
  if (line.type !== 'assistant') return [];
  const signals: ClaudeSignal[] = [];
  for (const item of Array.isArray(content) ? (content as { type?: unknown; name?: unknown; id?: unknown }[]) : []) {
    if (item?.type === 'tool_use' && typeof item.name === 'string') {
      signals.push({ kind: 'tool', time, label: item.name, ...(typeof item.id === 'string' && { id: item.id }) });
    }
  }
  if (line.message?.stop_reason === 'end_turn' || line.isApiErrorMessage === true) {
    const id = line.message?.id;
    signals.push({ kind: 'answer', time, ...(typeof id === 'string' && { id }) });
  }
  return signals;
}

function isPrompt(content: unknown): boolean {
  // Output of a local slash command (`/model`, …) is written as a user line too.
  if (typeof content === 'string') return content.trim() !== '' && !content.startsWith('<local-command-');
  if (!Array.isArray(content)) return false;
  const types = content.map((item: { type?: unknown }) => item?.type);
  return types.includes('text') && !types.includes('tool_result');
}

export interface ClaudeWatcher {
  stop(): void;
}

/**
 * Polls the transcripts in `dir` and reports the signals of one session: the first one that submits
 * a prompt at or after `since` (wall-clock seconds). Other sessions in the same folder (another
 * Claude finishing its own turn) are ignored. Files that exist when watching starts are read from
 * their current end; files created later from the start.
 */
export function watchClaude(dir: string, since: number, onSignal: (signal: ClaudeSignal) => void): ClaudeWatcher {
  const files = new Map<string, { offset: number; partial: string; decoder: StringDecoder }>();
  const seen = new Set<string>();
  let session: string | undefined;
  let first = true;
  let busy = false;
  let stopped = false;

  const handle = (file: string, signal: ClaudeSignal) => {
    if (signal.time < since) return;
    if (session === undefined) {
      if (signal.kind !== 'prompt') return;
      session = file;
    }
    if (file !== session) return;
    if (signal.id !== undefined) {
      const key = `${signal.kind}:${signal.id}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
    onSignal(signal);
  };

  const poll = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const names = await readdir(dir).catch(() => [] as string[]);
      for (const name of names.filter((candidate) => candidate.endsWith('.jsonl'))) {
        const path = join(dir, name);
        const size = await stat(path).then((info) => info.size, () => undefined);
        if (size === undefined) continue;
        let state = files.get(name);
        if (state === undefined) {
          state = { offset: first ? size : 0, partial: '', decoder: new StringDecoder('utf8') };
          files.set(name, state);
        }
        if (size <= state.offset) continue;
        const text = state.decoder.write(await readRange(path, state.offset, size));
        state.offset = size;
        const lines = (state.partial + text).split('\n');
        state.partial = lines.pop() ?? '';
        for (const line of lines) for (const signal of readTranscriptLine(line)) if (!stopped) handle(name, signal);
      }
      first = false;
    } finally {
      busy = false;
    }
  };

  // A read that fails (a file locked for a moment) is retried on the next poll.
  const tick = () => void poll().catch(() => {});
  tick();
  const timer = setInterval(tick, POLL_MS);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function readRange(path: string, from: number, to: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(to - from);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, from);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run packages/recorder/test/claude.test.ts`
Expected: PASS, 9 tests (~3 s: the watcher tests wait for its polls).

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/claude.ts packages/recorder/test/claude.test.ts
git commit -m "recorder: Claude Code transcript watcher (follows one session, skips subagents)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Windows: monitors, windows, devices and input

The native side: koffi bindings for DXGI, windows and the pointer, `listDevices()` with the DirectShow listing, and the input sources (uiohook with the shape poll and the hotkeys, or synthetic input for the test backend).

**Files:**
- Create: `packages/recorder/src/win32.ts`, `packages/recorder/src/devices.ts`, `packages/recorder/src/input.ts`
- Modify: `packages/recorder/package.json`, `pnpm-workspace.yaml`
- Test: `packages/recorder/test/devices.test.ts`, `packages/recorder/test/win32.test.ts`

- [ ] **Step 1: Add the native dependencies**

In `packages/recorder/package.json`, replace:

```json
  "dependencies": {
    "@cuttle/project": "workspace:*"
  }
```

with:

```json
  "dependencies": {
    "@cuttle/project": "workspace:*",
    "koffi": "3.3.2",
    "uiohook-napi": "1.5.5"
  }
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
  - apps/*
allowBuilds:
  koffi: false
  uiohook-napi: false
```

Run: `pnpm install`
Expected: exits with code 0; `pnpm-lock.yaml` gains `koffi 3.3.2` (with its `@koromix/koffi-*` platform packages) and `uiohook-napi 1.5.5`. Without `allowBuilds`, pnpm 11 stops with `ERR_PNPM_IGNORED_BUILDS`.

- [ ] **Step 2: Write the failing tests**

`packages/recorder/test/devices.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { listDevices, parseDshowDevices } from '../src/devices';
import { TEST_DEVICES } from '../src/sources';

describe('parseDshowDevices', () => {
  it('reads camera and microphone names from the DirectShow listing', () => {
    const log = [
      '[in#0 @ 0000019655642000] "HD Pro Webcam C920" (video)',
      '[in#0 @ 0000019655642000]   Alternative name "@device_pnp_\\\\?\\usb#vid_046d"',
      '[in#0 @ 0000019655642000] "Microphone Array (AMD Audio Device)" (audio)',
      '[in#0 @ 0000019655642000]   Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{A1B2}"',
      '[in#0 @ 0000019655642000] "Capture Card" (audio, video)',
      'Error opening input file dummy.',
    ].join('\r\n');
    expect(parseDshowDevices(log)).toEqual({
      cameras: ['HD Pro Webcam C920', 'Capture Card'],
      mics: ['Microphone Array (AMD Audio Device)', 'Capture Card'],
    });
  });

  it('finds nothing when there are no devices', () => {
    expect(parseDshowDevices('[in#0 @ 0000] Could not enumerate video devices (or none found).')).toEqual({ cameras: [], mics: [] });
  });
});

describe('listDevices', () => {
  it('lists the test devices as a copy', async () => {
    const devices = await listDevices({ backend: 'test' });
    expect(devices).toEqual(TEST_DEVICES);
    devices.mics.push('changed');
    expect(TEST_DEVICES.mics).not.toContain('changed');
  });

  it.runIf(process.platform === 'win32')('lists the monitors in ddagrab order with their desktop bounds', async () => {
    const { monitors, windows, cameras, mics } = await listDevices();
    expect(monitors.map((monitor) => monitor.index)).toEqual(monitors.map((_, index) => index));
    for (const monitor of monitors) {
      expect(monitor.bounds.width).toBeGreaterThan(0);
      expect(monitor.scale).toBeGreaterThanOrEqual(1);
    }
    expect(monitors.filter((monitor) => monitor.primary).length).toBeLessThanOrEqual(1);
    for (const window of windows) expect(monitors.map((monitor) => monitor.index)).toContain(window.monitor);
    expect(Array.isArray(cameras) && Array.isArray(mics)).toBe(true);
  });
});
```

`packages/recorder/test/win32.test.ts` (skipped on other platforms):

```ts
import { describe, expect, it } from 'vitest';
import { CURSOR_SHAPES } from '@cuttle/project';
import { loadWin32 } from '../src/win32';

describe.runIf(process.platform === 'win32')('win32', () => {
  it('loads once per module and reads the pointer', async () => {
    const win = await loadWin32();
    expect(await loadWin32()).toBe(win);
    const { x, y } = win.cursorPosition();
    expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
    expect(CURSOR_SHAPES).toContain(win.cursorShape());
  });

  it('puts the pointer on a monitor, in the same pixels as the monitor bounds', async () => {
    const win = await loadWin32();
    const monitors = win.monitors();
    if (monitors.length === 0) return; // a machine without a desktop session
    const { x, y } = win.cursorPosition();
    const inside = monitors.filter(({ bounds }) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height);
    expect(inside.length).toBe(1);
  });

  it('lists windows with a title and a size on a listed monitor', async () => {
    const win = await loadWin32();
    const monitors = win.monitors();
    for (const window of win.windows()) {
      expect(window.title).not.toBe('');
      expect(window.bounds.width).toBeGreaterThanOrEqual(2);
      expect(monitors.some((monitor) => monitor.index === window.monitor)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run the tests to make sure they fail**

Run: `pnpm exec vitest run packages/recorder/test/devices.test.ts packages/recorder/test/win32.test.ts`
Expected: FAIL, both suites cannot load (`Error: Cannot find module '../src/devices'` and `'../src/win32'`).

- [ ] **Step 4: Implement the bindings, the device list and the input sources**

`packages/recorder/src/win32.ts`:

```ts
// Windows APIs through koffi: monitors in ddagrab order, windows, pointer position and shape.
import type { CursorShape } from '@cuttle/project';
import type { Monitor, WindowInfo } from './types';

export interface Win32 {
  /** Outputs of the default adapter, in the order of ffmpeg ddagrab's `output_idx`. */
  monitors(): Monitor[];
  /** Visible top-level windows with a title on one of the monitors, front to back. */
  windows(): WindowInfo[];
  cursorPosition(): { x: number; y: number };
  cursorShape(): CursorShape;
}

let loaded: Promise<Win32> | undefined;

/** Loads the bindings once and makes the process per-monitor DPI aware, so coordinates are physical pixels. */
export function loadWin32(): Promise<Win32> {
  loaded ??= create();
  return loaded;
}

// DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2; fails harmlessly when already set (Electron sets it).
const PER_MONITOR_AWARE_V2 = -4;
const MDT_EFFECTIVE_DPI = 0;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const MONITOR_DEFAULTTONULL = 0;
// IID_IDXGIFactory1 {770aae78-f26f-4dba-a829-253c83d1b387}
const IID_IDXGIFactory1 = { Data1: 0x770aae78, Data2: 0xf26f, Data3: 0x4dba, Data4: [0xa8, 0x29, 0x25, 0x3c, 0x83, 0xd1, 0xb3, 0x87] };
/** System cursor ids (`IDC_*`) and the shape each stands for; anything else is drawn as `arrow`. */
const SYSTEM_CURSORS: [number, CursorShape][] = [
  [32512, 'arrow'],
  [32513, 'text'],
  [32514, 'wait'],
  [32515, 'crosshair'],
  [32646, 'move'],
  [32648, 'not-allowed'],
  [32649, 'pointer'],
  [32650, 'wait'], // IDC_APPSTARTING, the arrow with an hourglass
];

interface OutputDesc {
  DeviceName: number[];
  DesktopCoordinates: { left: number; top: number; right: number; bottom: number };
  Monitor: unknown;
}

async function create(): Promise<Win32> {
  const { default: koffi } = await import('koffi');
  const user32 = koffi.load('user32.dll');
  const dxgi = koffi.load('dxgi.dll');
  const shcore = koffi.load('shcore.dll');
  const dwmapi = koffi.load('dwmapi.dll');

  // Type names are process-wide and can be defined once, but this module may load more than once in
  // a process (test files, two copies in a bundle), so every load gets its own prefix. Anonymous
  // types are no way out: koffi 3.3 gave a struct and a callback the same internal name, and a
  // pointer to the struct then came back as the callback pointer.
  const prefix = `cuttle${process.hrtime.bigint()}`;
  const typeName = (type: string) => `${prefix}_${type}`;
  const GUID = koffi.struct(typeName('GUID'), { Data1: 'uint32', Data2: 'uint16', Data3: 'uint16', Data4: koffi.array('uint8', 8) });
  const RECT = koffi.struct(typeName('RECT'), { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  const POINT = koffi.struct(typeName('POINT'), { x: 'int32', y: 'int32' });
  const CURSORINFO = koffi.struct(typeName('CURSORINFO'), { cbSize: 'uint32', flags: 'uint32', hCursor: 'void *', ptScreenPos: POINT });
  const DXGI_OUTPUT_DESC = koffi.struct(typeName('DXGI_OUTPUT_DESC'), {
    DeviceName: koffi.array('uint16', 32),
    DesktopCoordinates: RECT,
    AttachedToDesktop: 'int32',
    Rotation: 'uint32',
    Monitor: 'void *',
  });
  const WNDENUMPROC = koffi.proto('__stdcall', typeName('WNDENUMPROC'), 'int', ['void *', 'intptr_t']);

  const SetProcessDpiAwarenessContext = user32.func('__stdcall', 'SetProcessDpiAwarenessContext', 'int', ['intptr_t']);
  const GetCursorPos = user32.func('__stdcall', 'GetCursorPos', 'int', [koffi.out(koffi.pointer(POINT))]);
  const GetCursorInfo = user32.func('__stdcall', 'GetCursorInfo', 'int', [koffi.inout(koffi.pointer(CURSORINFO))]);
  const LoadCursorW = user32.func('__stdcall', 'LoadCursorW', 'void *', ['void *', 'uintptr_t']);
  const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'int', [koffi.pointer(WNDENUMPROC), 'intptr_t']);
  const IsWindowVisible = user32.func('__stdcall', 'IsWindowVisible', 'int', ['void *']);
  const IsIconic = user32.func('__stdcall', 'IsIconic', 'int', ['void *']);
  const GetWindowLongPtrW = user32.func('__stdcall', 'GetWindowLongPtrW', 'intptr_t', ['void *', 'int']);
  const GetWindowTextLengthW = user32.func('__stdcall', 'GetWindowTextLengthW', 'int', ['void *']);
  const GetWindowTextW = user32.func('__stdcall', 'GetWindowTextW', 'int', ['void *', 'void *', 'int']);
  const MonitorFromWindow = user32.func('__stdcall', 'MonitorFromWindow', 'void *', ['void *', 'uint32']);
  const DwmGetWindowAttribute = dwmapi.func('__stdcall', 'DwmGetWindowAttribute', 'long', ['void *', 'uint32', 'void *', 'uint32']);
  const GetDpiForMonitor = shcore.func('__stdcall', 'GetDpiForMonitor', 'long', ['void *', 'int', koffi.out(koffi.pointer('uint32')), koffi.out(koffi.pointer('uint32'))]);
  const CreateDXGIFactory1 = dxgi.func('__stdcall', 'CreateDXGIFactory1', 'long', [koffi.pointer(GUID), koffi.out(koffi.pointer('void *'))]);

  // COM methods by vtable slot: IUnknown::Release 2, IDXGIFactory1::EnumAdapters1 12,
  // IDXGIAdapter::EnumOutputs 7, IDXGIOutput::GetDesc 7.
  const Release = koffi.proto('__stdcall', typeName('Release'), 'uint32', ['void *']);
  const EnumAdapters1 = koffi.proto('__stdcall', typeName('EnumAdapters1'), 'long', ['void *', 'uint32', koffi.out(koffi.pointer('void *'))]);
  const EnumOutputs = koffi.proto('__stdcall', typeName('EnumOutputs'), 'long', ['void *', 'uint32', koffi.out(koffi.pointer('void *'))]);
  const GetDesc = koffi.proto('__stdcall', typeName('GetDesc'), 'long', ['void *', koffi.out(koffi.pointer(DXGI_OUTPUT_DESC))]);
  const call = (object: unknown, slot: number, proto: unknown, ...args: unknown[]) => {
    const vtable = koffi.decode(object, 'void *');
    const method = koffi.decode(vtable, slot * 8, 'void *');
    return koffi.call(method, proto as never, object, ...args) as number;
  };

  SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2);
  const cursorShapes = new Map(SYSTEM_CURSORS.map(([id, shape]) => [koffi.address(LoadCursorW(null, id)), shape]));

  /** The monitors with their HMONITOR, which places windows on them. */
  const outputs = (): { monitor: Monitor; handle: bigint }[] => {
    const factory: unknown[] = [null];
    if (CreateDXGIFactory1(IID_IDXGIFactory1, factory) < 0) return [];
    const adapter: unknown[] = [null];
    const result: { monitor: Monitor; handle: bigint }[] = [];
    if (call(factory[0], 12, EnumAdapters1, 0, adapter) >= 0) {
      for (let index = 0; ; index++) {
        const output: unknown[] = [null];
        if (call(adapter[0], 7, EnumOutputs, index, output) < 0) break;
        const desc = {} as OutputDesc;
        call(output[0], 7, GetDesc, desc);
        call(output[0], 2, Release);
        const { left, top, right, bottom } = desc.DesktopCoordinates;
        const dpiX = [96];
        const dpiY = [96];
        GetDpiForMonitor(desc.Monitor, MDT_EFFECTIVE_DPI, dpiX, dpiY);
        const name = String.fromCharCode(...desc.DeviceName.filter((code) => code !== 0)).replace(/^\\\\\.\\/, ''); // \\.\DISPLAY1 → DISPLAY1
        const monitor = {
          index,
          name,
          bounds: { x: left, y: top, width: right - left, height: bottom - top },
          scale: (dpiX[0] ?? 96) / 96,
          primary: left === 0 && top === 0, // the primary monitor's top-left is the desktop origin
        };
        result.push({ monitor, handle: koffi.address(desc.Monitor) });
      }
      call(adapter[0], 2, Release);
    }
    call(factory[0], 2, Release);
    return result;
  };

  const windows = (): WindowInfo[] => {
    const monitorOf = new Map(outputs().map(({ monitor, handle }) => [handle, monitor.index]));
    const found: WindowInfo[] = [];
    const rect = Buffer.alloc(16);
    const cloaked = Buffer.alloc(4);
    const visit = koffi.register((hwnd: unknown) => {
      if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return 1;
      if ((Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) !== 0) return 1;
      // Cloaked: on another virtual desktop, or a suspended UWP app that is "visible" but not shown.
      if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) >= 0 && cloaked.readUInt32LE(0) !== 0) return 1;
      const length = GetWindowTextLengthW(hwnd);
      if (length === 0) return 1;
      const text = Buffer.alloc((length + 1) * 2);
      const title = text.toString('utf16le', 0, GetWindowTextW(hwnd, text, length + 1) * 2);
      const monitor = monitorOf.get(koffi.address(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL)));
      if (title === '' || monitor === undefined) return 1;
      if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, 16) < 0) return 1;
      const [left, top, right, bottom] = [0, 4, 8, 12].map((offset) => rect.readInt32LE(offset)) as [number, number, number, number];
      if (right - left < 2 || bottom - top < 2) return 1;
      found.push({ title, bounds: { x: left, y: top, width: right - left, height: bottom - top }, monitor });
      return 1;
    }, koffi.pointer(WNDENUMPROC));
    try {
      EnumWindows(visit, 0);
    } finally {
      koffi.unregister(visit);
    }
    return found;
  };

  const point = { x: 0, y: 0 };
  const info = { cbSize: koffi.sizeof(CURSORINFO), flags: 0, hCursor: null as unknown, ptScreenPos: { x: 0, y: 0 } };
  return {
    monitors: () => outputs().map(({ monitor }) => monitor),
    windows,
    cursorPosition() {
      GetCursorPos(point);
      return { x: point.x, y: point.y };
    },
    cursorShape() {
      if (!GetCursorInfo(info) || info.hCursor === null) return 'arrow';
      return cursorShapes.get(koffi.address(info.hCursor)) ?? 'arrow';
    },
  };
}
```

`packages/recorder/src/devices.ts`:

```ts
import { spawn } from 'node:child_process';
import { ffmpegMissing, ffmpegPath } from './ffmpeg';
import { TEST_DEVICES, platformFor } from './sources';
import type { Backend, Devices } from './types';

/** Monitors, windows, cameras and microphones the recorder can capture. */
export async function listDevices(options: { backend?: Backend } = {}): Promise<Devices> {
  if (platformFor(options.backend) === 'test') return structuredClone(TEST_DEVICES);
  const { loadWin32 } = await import('./win32');
  const win = await loadWin32();
  const monitors = win.monitors();
  const { cameras, mics } = parseDshowDevices(await dshowListing());
  return { monitors, windows: win.windows(), cameras, mics };
}

/**
 * Device names from `ffmpeg -list_devices true -f dshow -i dummy`, which logs lines like
 * `[in#0 @ 0000…] "Microphone Array (AMD Audio Device)" (audio)` (each followed by an
 * "Alternative name" line).
 */
export function parseDshowDevices(log: string): { cameras: string[]; mics: string[] } {
  const cameras: string[] = [];
  const mics: string[] = [];
  for (const match of log.matchAll(/"([^"]+)" \(([^)]*)\)/g)) {
    const [, name, kinds] = match as unknown as [string, string, string];
    if (kinds.includes('video')) cameras.push(name);
    if (kinds.includes('audio')) mics.push(name);
  }
  return { cameras, mics };
}

/** The listing ends with "Error opening input file dummy" and a non-zero exit: that is expected. */
function dshowListing(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let log = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (log += chunk));
    child.on('error', (error: NodeJS.ErrnoException) => reject(error.code === 'ENOENT' ? ffmpegMissing(error) : error));
    child.on('close', () => resolve(log));
  });
}
```

`packages/recorder/src/input.ts`:

```ts
// Input sources: the global mouse and keyboard hook with the pointer shape (Windows), or synthetic
// input for the test backend. Both deliver wall-clock seconds and desktop pixels.
import type { Platform } from './sources';
import type { HotkeyAction, RawInput } from './types';

export interface InputSource {
  /** The pointer's position and shape now, stamped with `time`: the first events of the take. */
  initial(time: number): RawInput[];
  /** Stops delivering input; calling it again does nothing. */
  stop(): void;
}

export type InputSink = (input: RawInput) => void;
export type HotkeySink = (action: HotkeyAction) => void;

const now = () => Date.now() / 1000;

/** Ctrl+Shift+Alt+<key>: no app binds these, and AltGr+Shift+letter types nothing on common layouts. */
export const HOTKEYS: Record<HotkeyAction, string> = { stop: 'Ctrl+Shift+Alt+S', marker: 'Ctrl+Shift+Alt+M' };

export async function startInput(platform: Platform, onInput: InputSink, onHotkey: HotkeySink): Promise<InputSource> {
  return platform === 'test' ? startTestInput(onInput) : startWindowsInput(onInput, onHotkey);
}

/** How often the pointer shape is read (Windows has no event for it). */
const SHAPE_POLL_MS = 1000 / 30;

async function startWindowsInput(onInput: InputSink, onHotkey: HotkeySink): Promise<InputSource> {
  const { loadWin32 } = await import('./win32');
  const win = await loadWin32(); // DPI awareness first: the hook then reports physical pixels
  const { uIOhook, UiohookKey, WheelDirection } = await import('uiohook-napi');
  const modifiers = new Set<number>([
    UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Shift, UiohookKey.ShiftRight,
    UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Meta, UiohookKey.MetaRight,
  ]);
  const hotkeys = new Map<number, HotkeyAction>([[UiohookKey.S, 'stop'], [UiohookKey.M, 'marker']]);
  const buttons = new Map<unknown, 'left' | 'right' | 'middle'>([[1, 'left'], [2, 'right'], [3, 'middle']]);

  uIOhook.on('mousemove', (event) => onInput({ type: 'move', time: now(), x: event.x, y: event.y }));
  uIOhook.on('mousedown', (event) => {
    const button = buttons.get(event.button);
    if (button) onInput({ type: 'click', time: now(), x: event.x, y: event.y, button });
  });
  uIOhook.on('wheel', (event) => {
    // Whole notches; positive is down (toward the user) and right. A touchpad's small deltas add up to 0 first.
    if (event.rotation === 0) return;
    const vertical = event.direction === WheelDirection.VERTICAL;
    onInput({ type: 'scroll', time: now(), x: event.x, y: event.y, dx: vertical ? 0 : event.rotation, dy: vertical ? event.rotation : 0 });
  });
  uIOhook.on('keydown', (event) => {
    if (modifiers.has(event.keycode)) return;
    const action = event.ctrlKey && event.shiftKey && event.altKey ? hotkeys.get(event.keycode) : undefined;
    if (action) onHotkey(action);
    else onInput({ type: 'key', time: now() });
  });
  uIOhook.start();

  let shape = win.cursorShape();
  let stopped = false;
  const poll = setInterval(() => {
    const current = win.cursorShape();
    if (current === shape) return;
    shape = current;
    onInput({ type: 'shape', time: now(), shape });
  }, SHAPE_POLL_MS);

  return {
    initial(time) {
      const { x, y } = win.cursorPosition();
      return [
        { type: 'move', time, x, y },
        { type: 'shape', time, shape },
      ];
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(poll);
      uIOhook.stop();
      uIOhook.removeAllListeners();
    },
  };
}

/**
 * Synthetic input on the test monitor: the pointer circles its centre at 60 Hz; every second it
 * clicks, scrolls, types three keys and switches between the arrow and the text cursor.
 */
function startTestInput(onInput: InputSink): InputSource {
  const started = now();
  const position = (time: number) => {
    const angle = (time - started) * Math.PI;
    return { x: Math.round(640 + 200 * Math.cos(angle)), y: Math.round(360 + 200 * Math.sin(angle)) };
  };
  const timers = [
    setInterval(() => {
      const time = now();
      onInput({ type: 'move', time, ...position(time) });
    }, 1000 / 60),
    setInterval(() => {
      const time = now();
      onInput({ type: 'click', time, ...position(time), button: 'left' });
      onInput({ type: 'scroll', time, ...position(time), dx: 0, dy: 1 });
      onInput({ type: 'shape', time, shape: Math.round(time - started) % 2 === 0 ? 'arrow' : 'text' });
      for (let key = 0; key < 3; key++) onInput({ type: 'key', time });
    }, 1000),
  ];
  return {
    initial: (time) => [
      { type: 'move', time, ...position(time) },
      { type: 'shape', time, shape: 'arrow' },
    ],
    stop: () => timers.forEach(clearInterval),
  };
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm exec vitest run packages/recorder/test/devices.test.ts packages/recorder/test/win32.test.ts`
Expected: PASS, 7 tests on Windows (elsewhere 3 pass and 4 are skipped).

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/recorder
git commit -m "recorder: DXGI monitors, windows, DirectShow devices and the input hook (koffi, uiohook-napi)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `record()`

The recording itself: options and devices checked, countdown, take folder, the three tracks, take.json, events, markers, the triggers and the stop; the package's public API.

**Files:**
- Create: `packages/recorder/src/record.ts`, `packages/recorder/src/index.ts`
- Test: `packages/recorder/test/record.test.ts`

- [ ] **Step 1: Write the failing test**

These are the M4 done criterion with the test backend: a 3 s take with every track, `untilFile` and `untilClaude` with a fake transcript, and the other triggers and failure paths.

`packages/recorder/test/record.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseEventsJsonl, parseMarkersJson, parseTakeJson, trackOffset } from '@cuttle/project';
import { CLAUDE_TAIL_SECONDS, claudeTranscriptDir, record, type RecordOptions, type RecorderEvent } from '../src/index';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const project = () => temp('cuttle-record-');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const test = { source: { kind: 'monitor', index: 0 }, countdownSeconds: 0, backend: 'test' } as const satisfies Partial<RecordOptions>;

/** ffprobe's view of a track: codec, size, colour tags, sample rate and duration. */
function probe(file: string) {
  const { stdout } = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,color_transfer,sample_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const { streams, format } = JSON.parse(stdout) as { streams: Record<string, string | number>[]; format: { duration: string } };
  return { ...streams[0], duration: Number(format.duration) };
}

const read = (projectDir: string, file: string) => readFileSync(join(projectDir, file), 'utf8');

describe.concurrent('record (test backend)', () => {
  it('records a 3 s take with every track', async () => {
    const projectDir = project();
    const events: RecorderEvent[] = [];
    const recording = record({ ...test, projectDir, webcam: 'Test Camera', mic: 'Test Microphone', stop: { maxSeconds: 3 }, onEvent: (event) => events.push(event) });
    setTimeout(() => recording.marker('one second'), 1000);
    const take = await recording.done;

    expect(take).toEqual({
      dir: 'takes/1',
      screen: 'takes/1/screen.mp4',
      webcam: 'takes/1/webcam.mp4',
      mic: 'takes/1/mic.m4a',
      events: 'takes/1/events.jsonl',
      markers: 'takes/1/markers.json',
      screenSize: { width: 1280, height: 720 },
      seconds: expect.closeTo(3.2, 0),
      stopReason: 'max-seconds',
      warnings: [],
    });
    expect(probe(join(projectDir, take.screen))).toEqual({ codec_name: 'h264', width: 1280, height: 720, color_transfer: 'bt709', duration: expect.closeTo(take.seconds, 1) });
    expect(probe(join(projectDir, take.webcam!))).toMatchObject({ codec_name: 'h264', width: 640, height: 480, color_transfer: 'bt709' });
    expect(probe(join(projectDir, take.mic!))).toMatchObject({ codec_name: 'aac', sample_rate: '48000', duration: expect.closeTo(3, 0) });

    const takeFile = parseTakeJson(read(projectDir, 'takes/1/take.json'));
    if (!takeFile.ok) throw new Error(JSON.stringify(takeFile.issues));
    expect(Math.abs(trackOffset(takeFile.take, 'webcam')!)).toBeLessThan(0.2);
    expect(Math.abs(trackOffset(takeFile.take, 'mic')!)).toBeLessThan(0.2);

    const { events: input, issues } = parseEventsJsonl(read(projectDir, take.events));
    expect(issues).toEqual([]);
    expect(input.slice(0, 2)).toEqual([expect.objectContaining({ t: 0, type: 'move' }), { t: 0, type: 'shape', shape: 'arrow' }]);
    expect(new Set(input.map((event) => event.type))).toEqual(new Set(['move', 'shape', 'click', 'scroll', 'keys']));

    const markers = parseMarkersJson(read(projectDir, take.markers));
    expect(markers).toEqual({ ok: true, markers: [{ t: expect.closeTo(1, 0), kind: 'manual', label: 'one second' }] });
    expect(events.map((event) => event.type)).toEqual(['recording', 'marker', 'stopping']);
  });

  it('stops once untilFile exists', async () => {
    const projectDir = project();
    const flag = join(projectDir, 'done.flag');
    setTimeout(() => writeFileSync(flag, ''), 1500);
    const take = await record({ ...test, projectDir, stop: { untilFile: flag, maxSeconds: 20 } }).done;
    expect(take.stopReason).toBe('file');
    expect(take.seconds).toBeGreaterThan(1.2);
    expect(take.seconds).toBeLessThan(3);
  });

  it('stops shortly after the Claude session in that folder finishes its turn, with markers from its transcript', async () => {
    const projectDir = project();
    const config = temp('cuttle-claude-');
    const cwd = join(config, 'demo app');
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = config;
    try {
      const dir = claudeTranscriptDir(cwd);
      mkdirSync(dir, { recursive: true });
      const write = (session: string, value: object) => appendFileSync(join(dir, `${session}.jsonl`), `${JSON.stringify({ timestamp: new Date().toISOString(), ...value })}\n`);
      const recording = record({ ...test, projectDir, stop: { untilClaude: cwd, maxSeconds: 20 } });
      await sleep(600);
      write('other', { type: 'assistant', message: { id: 'o1', stop_reason: 'end_turn', content: [{ type: 'text' }] } });
      await sleep(400);
      write('demo', { type: 'user', message: { content: 'build it' } });
      await sleep(300);
      write('demo', { type: 'assistant', message: { id: 'a1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } });
      write('demo', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } });
      await sleep(300);
      write('demo', { type: 'assistant', isSidechain: true, message: { id: 's1', stop_reason: 'end_turn', content: [{ type: 'text' }] } });
      await sleep(300);
      write('demo', { type: 'assistant', message: { id: 'a2', stop_reason: 'end_turn', content: [{ type: 'text' }] } });
      const take = await recording.done;

      expect(take.stopReason).toBe('claude');
      const markers = parseMarkersJson(read(projectDir, take.markers));
      if (!markers.ok) throw new Error(JSON.stringify(markers.issues));
      expect(markers.markers.map(({ kind, label }) => (label ? `${kind}:${label}` : kind))).toEqual(['prompt', 'tool:Bash', 'answer']);
      const answer = markers.markers[2]!.t;
      expect(take.seconds).toBeGreaterThan(answer + CLAUDE_TAIL_SECONDS - 0.3);
      expect(take.seconds).toBeLessThan(answer + CLAUDE_TAIL_SECONDS + 1);
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  });

  it('stops once the screen stood still for untilIdleSeconds after it changed', async () => {
    // The still test monitor moves for 1 s, then stands still.
    const take = await record({ ...test, projectDir: project(), source: { kind: 'monitor', index: 1 }, stop: { untilIdleSeconds: 1, maxSeconds: 20 } }).done;
    expect(take.stopReason).toBe('idle');
    expect(take.seconds).toBeGreaterThan(1.8);
    expect(take.seconds).toBeLessThan(3);
    expect(take.screenSize).toEqual({ width: 640, height: 360 });
  });

  it('does not count a screen that has not changed yet as idle', async () => {
    // This strip at the top of the test pattern stays the same for the first 3 s.
    const take = await record({ ...test, projectDir: project(), source: { kind: 'region', rect: [540, 0, 200, 40], monitor: 0 }, stop: { untilIdleSeconds: 0.5, maxSeconds: 2 } }).done;
    expect(take.stopReason).toBe('max-seconds');
  });

  it('stops when asked and warns about a silent microphone', async () => {
    const projectDir = project();
    const warnings: string[] = [];
    const recording = record({ ...test, projectDir, mic: 'Silent Test Microphone', stop: {}, onEvent: (event) => event.type === 'warning' && warnings.push(event.message) });
    await sleep(2000);
    const take = await recording.stop();
    expect(take.stopReason).toBe('stop');
    expect(take.warnings).toEqual(['the microphone "Silent Test Microphone" records silence: it may be muted, or blocked for desktop apps (Windows: Settings > Privacy & security > Microphone)']);
    expect(warnings).toEqual(take.warnings);
  });

  it('cancels without a take folder when stopped during the countdown', async () => {
    const projectDir = project();
    const countdown: number[] = [];
    const recording = record({ ...test, projectDir, countdownSeconds: 3, stop: {}, onEvent: (event) => event.type === 'countdown' && countdown.push(event.seconds) });
    setTimeout(() => void recording.stop().catch(() => {}), 500);
    await expect(recording.done).rejects.toMatchObject({ name: 'RecorderError', code: 'cancelled' });
    expect(countdown).toEqual([3]);
    expect(existsSync(join(projectDir, 'takes'))).toBe(false);
  });

  it('fails when a track breaks off, and lets the other tracks finish their files', async () => {
    const projectDir = project();
    await expect(record({ ...test, projectDir, webcam: 'Failing Test Camera', stop: { maxSeconds: 20 } }).done).rejects.toMatchObject({
      code: 'capture',
      message: expect.stringContaining('the webcam capture stopped unexpectedly'),
    });
    expect(probe(join(projectDir, 'takes/1/screen.mp4')).duration).toBeGreaterThan(0.8);
  });

  it('captures a region and a window, with input relative to them, in numbered takes', async () => {
    const projectDir = project();
    const region = await record({ ...test, projectDir, source: { kind: 'region', rect: [100, 50, 401, 301], monitor: 0 }, stop: { maxSeconds: 1 } }).done;
    const window = await record({ ...test, projectDir, source: { kind: 'window', title: 'test window' }, stop: { maxSeconds: 1 } }).done;
    expect([region.dir, region.screenSize]).toEqual(['takes/1', { width: 400, height: 300 }]);
    expect([window.dir, window.screenSize]).toEqual(['takes/2', { width: 640, height: 360 }]);
    expect(probe(join(projectDir, window.screen))).toMatchObject({ width: 640, height: 360 });
    // The synthetic pointer circles (640, 360) on the desktop with a radius of 200; the window starts at (100, 60).
    const first = parseEventsJsonl(read(projectDir, window.events)).events[0]!;
    if (first.type !== 'move') throw new Error('expected a move');
    expect(Math.hypot(first.x + 100 - 640, first.y + 60 - 360)).toBeCloseTo(200, -1);
  });

  it('refuses options it cannot record with, before creating a take folder', async () => {
    const projectDir = project();
    const flag = join(projectDir, 'exists.flag');
    writeFileSync(flag, '');
    const cases: [Partial<RecordOptions>, string][] = [
      [{ projectDir: join(projectDir, 'missing') }, 'invalid-options'],
      [{ stop: { maxSeconds: 0 } }, 'invalid-options'],
      [{ stop: { untilFile: flag } }, 'invalid-options'],
      [{ countdownSeconds: -1 }, 'invalid-options'],
      [{ mic: 'No Such Microphone' }, 'device-not-found'],
      [{ source: { kind: 'monitor', index: 7 } }, 'device-not-found'],
    ];
    for (const [options, code] of cases) {
      await expect(record({ ...test, projectDir, stop: {}, ...options }).done).rejects.toMatchObject({ code });
    }
    expect(existsSync(join(projectDir, 'takes'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/recorder/test/record.test.ts`
Expected: FAIL, the suite cannot load: `Error: Cannot find module '../src/index' imported from …/packages/recorder/test/record.test.ts` and `Tests  no tests`.

- [ ] **Step 3: Implement `record()` and the public API**

`packages/recorder/src/record.ts`:

```ts
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, type Marker, type MarkersFile, type TakeFile } from '@cuttle/project';
import { SILENCE_SECONDS, freezeStart, micArgs, screenArgs, silenceStart, webcamArgs } from './args';
import { claudeTranscriptDir, watchClaude } from './claude';
import { listDevices } from './devices';
import { RecorderError } from './errors';
import { EventsWriter } from './events';
import { spawnCapture, type CaptureProcess } from './ffmpeg';
import { startInput, type InputSource } from './input';
import { areaGeometry, checkDevice, micInput, micLatency, platformFor, resolveArea, screenInput, webcamInput, type Platform, type ScreenArea } from './sources';
import type { RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';

const DEFAULT_COUNTDOWN_SECONDS = 3;
/** Seconds kept after Claude's final answer, so the video shows it. */
export const CLAUDE_TAIL_SECONDS = 2;
const FILE_POLL_MS = 200;

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json' };

const now = () => Date.now() / 1000;

/** Records a take into `<projectDir>/takes/<n>/`. See `RecordOptions` for the stop triggers. */
export function record(options: RecordOptions): Recording {
  const control = new Control();
  const done = run(options, control);
  done.catch(() => {}); // the caller sees a failure through `done` or `stop()`
  return {
    stop() {
      control.request('stop');
      return done;
    },
    marker: (label) => control.marker(label),
    done,
  };
}

/** Stop requests and manual markers from the caller, the hotkeys and the triggers. */
class Control {
  reason: StopReason | undefined;
  onMarker: ((label?: string) => void) | undefined;
  private waiters: ((reason: StopReason) => void)[] = [];

  /** The first request wins. */
  request(reason: StopReason): void {
    if (this.reason !== undefined) return;
    this.reason = reason;
    for (const waiter of this.waiters) waiter(reason);
  }

  stopped(): Promise<StopReason> {
    if (this.reason !== undefined) return Promise.resolve(this.reason);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  marker(label?: string): void {
    this.onMarker?.(label);
  }
}

async function run(options: RecordOptions, control: Control): Promise<Take> {
  const platform = platformFor(options.backend);
  const projectDir = resolve(options.projectDir);
  checkOptions(options, projectDir);
  const devices = await listDevices({ backend: options.backend });
  const area = resolveArea(options.source, devices);
  if (options.webcam !== undefined) checkDevice('camera', options.webcam, devices);
  if (options.mic !== undefined) checkDevice('mic', options.mic, devices);
  const emit = (event: RecorderEvent) => options.onEvent?.(event);
  const since = now(); // Claude prompts during the countdown count: the user may start early

  for (let left = options.countdownSeconds ?? DEFAULT_COUNTDOWN_SECONDS; left > 0; left--) {
    emit({ type: 'countdown', seconds: left });
    await Promise.race([sleep(Math.min(left, 1) * 1000), control.stopped()]);
    if (control.reason !== undefined) throw new RecorderError('cancelled', 'the recording was stopped before it started');
  }
  return recordTake({ options, control, platform, area, projectDir, dir: allocateTake(projectDir), since, emit });
}

interface TakeContext {
  options: RecordOptions;
  control: Control;
  platform: Platform;
  area: ScreenArea;
  projectDir: string;
  /** The take folder, already created. */
  dir: string;
  since: number;
  emit: (event: RecorderEvent) => void;
}

async function recordTake({ options, control, platform, area, projectDir, dir, since, emit }: TakeContext): Promise<Take> {
  const path = (file: string) => join(dir, file);
  const rel = (file: string) => relative(projectDir, file).split(sep).join('/');
  const warnings: string[] = [];
  let screenStart: number | undefined;

  const markers: Marker[] = [];
  const saveMarkers = () => writeJson(path(FILES.markers), { version: MARKERS_VERSION, markers } satisfies MarkersFile);
  const addMarker = (marker: Omit<Marker, 't'>, time: number) => {
    if (screenStart === undefined || time < screenStart) return; // nothing on screen yet
    const entry = { t: Math.round((time - screenStart) * 1000) / 1000, ...marker };
    markers.push(entry);
    markers.sort((a, b) => a.t - b.t);
    saveMarkers();
    emit({ type: 'marker', marker: entry });
  };
  saveMarkers();
  control.onMarker = (label) => addMarker({ kind: 'manual', ...(label && { label }) }, now());

  const { size, origin } = areaGeometry(area);
  const events = openSync(path(FILES.events), 'a');
  const writer = new EventsWriter((line) => writeSync(events, line), origin);
  const captures: CaptureProcess[] = [];
  let input: InputSource | undefined;
  let triggers: (() => void)[] = [];

  try {
    input = await startInput(platform, (raw) => writer.push(raw), (action) => (action === 'stop' ? control.request('hotkey') : control.marker()));
    const screen = spawnCapture('screen', screenArgs(screenInput(platform, area, options.drawMouse ?? false), path(FILES.screen), options.stop.untilIdleSeconds));
    captures.push(screen);
    const webcam = options.webcam === undefined ? undefined : spawnCapture('webcam', webcamArgs(webcamInput(platform, options.webcam), path(FILES.webcam)));
    if (webcam) captures.push(webcam);
    const mic = options.mic === undefined ? undefined : spawnCapture('mic', micArgs(micInput(platform, options.mic), path(FILES.mic)));
    if (mic) captures.push(mic);

    // A freeze that starts at 0 means the screen has not changed yet: untilIdleSeconds waits for one after a change.
    screen.onLine((line) => {
      const start = freezeStart(line);
      if (start !== undefined && start > 0) control.request('idle');
    });
    let micWarned = false;
    mic?.onLine((line) => {
      const start = silenceStart(line);
      if (start === undefined || start >= SILENCE_SECONDS || micWarned) return;
      micWarned = true;
      const message = `the microphone "${options.mic}" records silence: it may be muted, or blocked for desktop apps (Windows: Settings > Privacy & security > Microphone)`;
      warnings.push(message);
      emit({ type: 'warning', message });
    });
    // Rejects with the first capture that fails; `exited` only resolves after stop() was called.
    const failed: Promise<never> = Promise.race(captures.map((capture) => capture.exited)).then(() => new Promise<never>(() => {}));
    failed.catch(() => {});

    const [screenAt, webcamAt, micAt] = await Promise.race([Promise.all([screen.started, webcam?.started, mic?.started]), failed]);
    screenStart = screenAt;
    writer.setStart(screenAt, input.initial(screenAt));
    writeJson(path(FILES.take), {
      version: TAKE_VERSION,
      tracks: {
        screen: { file: FILES.screen, start: screenAt },
        ...(webcamAt !== undefined && { webcam: { file: FILES.webcam, start: webcamAt } }),
        ...(micAt !== undefined && { mic: { file: FILES.mic, start: micAt - micLatency(platform) } }),
      },
    } satisfies TakeFile);
    emit({ type: 'recording', dir: rel(dir) });
    triggers = startTriggers(options.stop, since, control, addMarker);

    const reason = await Promise.race([control.stopped(), failed]);
    emit({ type: 'stopping', reason });
    triggers.forEach((stop) => stop());
    input.stop();
    writer.close();
    await Promise.all(captures.map((capture) => capture.stop()));
    return {
      dir: rel(dir),
      screen: rel(path(FILES.screen)),
      ...(webcam && { webcam: rel(path(FILES.webcam)) }),
      ...(mic && { mic: rel(path(FILES.mic)) }),
      events: rel(path(FILES.events)),
      markers: rel(path(FILES.markers)),
      screenSize: size,
      seconds: screen.seconds() ?? now() - screenAt,
      stopReason: reason,
      warnings,
    };
  } catch (error) {
    triggers.forEach((stop) => stop());
    input?.stop();
    writer.close();
    // The tracks that still run finish their files; the take folder keeps what was recorded.
    await Promise.allSettled(captures.map((capture) => capture.stop()));
    throw error;
  } finally {
    control.onMarker = undefined;
    closeSync(events);
  }
}

/** Starts the time, file and Claude triggers; returns their stop functions. */
function startTriggers(stop: StopOptions, since: number, control: Control, addMarker: (marker: Omit<Marker, 't'>, time: number) => void): (() => void)[] {
  const stops: (() => void)[] = [];
  if (stop.maxSeconds !== undefined) {
    const timer = setTimeout(() => control.request('max-seconds'), stop.maxSeconds * 1000);
    stops.push(() => clearTimeout(timer));
  }
  if (stop.untilFile !== undefined) {
    const file = resolve(stop.untilFile);
    const timer = setInterval(() => existsSync(file) && control.request('file'), FILE_POLL_MS);
    stops.push(() => clearInterval(timer));
  }
  if (stop.untilClaude !== undefined) {
    const watcher = watchClaude(claudeTranscriptDir(stop.untilClaude), since, (signal) => {
      addMarker({ kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) }, signal.time);
      if (signal.kind !== 'answer') return;
      const timer = setTimeout(() => control.request('claude'), CLAUDE_TAIL_SECONDS * 1000);
      stops.push(() => clearTimeout(timer));
    });
    stops.push(() => watcher.stop());
  }
  return stops;
}

function checkOptions(options: RecordOptions, projectDir: string): void {
  const invalid = (message: string) => new RecorderError('invalid-options', message);
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) throw invalid(`project folder ${projectDir} does not exist`);
  const positive = (name: string, value: number | undefined) => {
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) throw invalid(`${name} must be a positive number of seconds`);
  };
  positive('maxSeconds', options.stop.maxSeconds);
  positive('untilIdleSeconds', options.stop.untilIdleSeconds);
  const countdown = options.countdownSeconds;
  if (countdown !== undefined && !(Number.isFinite(countdown) && countdown >= 0)) throw invalid('countdownSeconds must be 0 or more');
  const flag = options.stop.untilFile === undefined ? undefined : resolve(options.stop.untilFile);
  if (flag !== undefined && existsSync(flag)) throw invalid(`untilFile ${flag} already exists; delete it first, or the recording would stop at once`);
}

/** Creates the next free `takes/<n>` folder; `mkdir` fails on an existing one, so two recorders never share one. */
function allocateTake(projectDir: string): string {
  const takes = join(projectDir, 'takes');
  mkdirSync(takes, { recursive: true });
  let next = readdirSync(takes).reduce((max, name) => (/^\d+$/.test(name) ? Math.max(max, Number(name)) : max), 0) + 1;
  for (;;) {
    const dir = join(takes, String(next));
    try {
      mkdirSync(dir);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      next++;
    }
  }
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
```

`packages/recorder/src/index.ts`:

```ts
export { record, CLAUDE_TAIL_SECONDS } from './record';
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
export { claudeTranscriptDir } from './claude';
export type {
  Backend,
  Bounds,
  CaptureSource,
  Devices,
  Monitor,
  RecordOptions,
  RecorderEvent,
  Recording,
  StopOptions,
  StopReason,
  Take,
  WindowInfo,
} from './types';
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm exec vitest run packages/recorder/test/record.test.ts`
Expected: PASS, 10 tests in about 6 s (they run concurrently, each records in real time).

Run: `pnpm exec vitest run packages/project packages/recorder`
Expected: PASS, 99 tests in 13 files.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/record.ts packages/recorder/src/index.ts packages/recorder/test/record.test.ts
git commit -m "recorder: record() with countdown, tracks, triggers, markers and take.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: A real capture on Windows

The third part of the done criterion: a manual run records a monitor. The test is skipped unless vitest runs with `--mode real`.

**Files:**
- Create: `packages/recorder/test/real.test.ts`
- Modify: `package.json`

- [ ] **Step 1: The test and its script**

`packages/recorder/test/real.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseEventsJsonl, parseTakeJson } from '@cuttle/project';
import { listDevices, record } from '../src/index';

/**
 * A real capture of the primary monitor (and the first microphone), then of a region of it. Runs only
 * with `pnpm recorder:real` (vitest --mode real); reads nothing but metadata and deletes the take.
 */
it.runIf(process.env.MODE === 'real')('records the primary monitor and a region of it', async () => {
  const devices = await listDevices();
  const monitor = devices.monitors.find((candidate) => candidate.primary) ?? devices.monitors[0];
  if (!monitor) throw new Error('no monitor found');
  const mic = devices.mics[0];
  const projectDir = mkdtempSync(join(tmpdir(), 'cuttle-real-'));
  const probe = (file: string) =>
    spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,color_transfer:format=duration', '-of', 'json', join(projectDir, file)], { encoding: 'utf8' }).stdout;
  try {
    const take = await record({ projectDir, source: { kind: 'monitor', index: monitor.index }, ...(mic && { mic }), stop: { maxSeconds: 3 }, countdownSeconds: 0 }).done;
    console.log(`monitor ${monitor.index} ${monitor.bounds.width}×${monitor.bounds.height}, mic ${mic ?? 'none'}: ${take.seconds} s, warnings ${JSON.stringify(take.warnings)}`);
    expect(take.screenSize).toEqual({ width: monitor.bounds.width, height: monitor.bounds.height });
    expect(JSON.parse(probe(take.screen))).toMatchObject({ streams: [{ codec_name: 'h264', width: monitor.bounds.width, color_transfer: 'bt709' }] });
    if (take.mic) expect(JSON.parse(probe(take.mic))).toMatchObject({ streams: [{ codec_name: 'aac' }] });
    expect(parseTakeJson(readFileSync(join(projectDir, take.dir, 'take.json'), 'utf8')).ok).toBe(true);
    const events = parseEventsJsonl(readFileSync(join(projectDir, take.events), 'utf8'));
    expect(events.issues).toEqual([]);
    expect(events.events.slice(0, 2).map((event) => [event.t, event.type])).toEqual([[0, 'move'], [0, 'shape']]);

    const region = await record({ projectDir, source: { kind: 'region', rect: [100, 100, 640, 360], monitor: monitor.index }, stop: { maxSeconds: 1 }, countdownSeconds: 0 }).done;
    expect(JSON.parse(probe(region.screen))).toMatchObject({ streams: [{ width: 640, height: 360 }] });
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}, 60_000);
```

In `package.json`, replace:

```json
    "export:check": "pnpm export:build && electron packages/export/dist/check.mjs"
```

with:

```json
    "export:check": "pnpm export:build && electron packages/export/dist/check.mjs",
    "recorder:real": "vitest run --mode real --silent=false packages/recorder/test/real.test.ts"
```

- [ ] **Step 2: It is skipped in a normal run**

Run: `pnpm exec vitest run packages/recorder/test/real.test.ts`
Expected: `Test Files  1 skipped (1)`, `Tests  1 skipped (1)`.

- [ ] **Step 3: Record for real**

This records the primary monitor (and the first microphone) for 3 s, then a 640×360 region of it; only metadata is read and the take is deleted.

Run: `pnpm recorder:real`
Expected: PASS, 1 test, after printing a line like `monitor 0 2560×1440, mic Microphone Array (AMD Audio Device): 3.6 s, warnings […]` (a microphone that is muted or blocked for desktop apps shows up as a warning, not a failure). No `cuttle-real-*` folder is left in `%TEMP%`.

- [ ] **Step 4: Commit**

```bash
git add package.json packages/recorder/test/real.test.ts
git commit -m "recorder: manual real-capture check (pnpm recorder:real)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`, `docs/superpowers/specs/2026-10-16-cuttle-design.md`

- [ ] **Step 1: README**

In `README.md`, replace:

```markdown
| `@cuttle/export` | MP4 export in a hidden Electron window: decode, render, encode H.264, mux; mic cut to the scenes with ffmpeg (AAC) |
```

with:

```markdown
| `@cuttle/export` | MP4 export in a hidden Electron window: decode, render, encode H.264, mux; mic cut to the scenes with ffmpeg (AAC) |
| `@cuttle/recorder` | Records a take on Windows: a monitor, region or window (ddagrab), webcam and mic (DirectShow), input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |
```

In the same file, replace:

```markdown
pnpm export:check                        # export a testsrc fixture to 16:9, 1:1, 9:16 and check it with ffprobe
```

with:

```markdown
pnpm export:check                        # export a testsrc fixture to 16:9, 1:1, 9:16 and check it with ffprobe
pnpm recorder:real                       # record 3 s of the primary monitor for real, check the take, delete it
```

In the same file, replace:

```markdown
Export needs ffmpeg on PATH (or its path in `CUTTLE_FFMPEG`); `export:check` also needs ffprobe.
```

with:

```markdown
Export and recording need ffmpeg on PATH (or its path in `CUTTLE_FFMPEG`); `export:check` and the
recorder tests also need ffprobe. Recording works on Windows so far; the recorder's tests use its
`test` backend (ffmpeg test sources, synthetic input), which runs everywhere.
```

- [ ] **Step 2: Roadmap**

In `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`, replace:

```markdown
Mediabunny, ffmpeg, uiohook-napi, commander.
```

with:

```markdown
Mediabunny, ffmpeg, uiohook-napi, koffi, commander.
```

In the same file, replace:

```markdown
| M4 | `@cuttle/recorder` (devices, ffmpeg backends, events, triggers, markers) | write before starting |
```

with:

```markdown
| M4 | `@cuttle/recorder` (devices, ffmpeg backends, events, triggers, markers) | `2026-10-17-cuttle-m4-recorder.md` |
```

In the same file, replace:

```ts
export function trackOffset(take: TakeFile, track: 'webcam' | 'mic'): number | undefined; // track start − screen start
```

with:

```ts
export function trackOffset(take: TakeFile, track: 'webcam' | 'mic'): number | undefined; // track start − screen start
export type Marker = z.output<typeof MarkerSchema>;            // one entry of markers.json (M4): { t, kind, label? },
// t in source seconds; kind 'manual' | 'prompt' | 'tool' | 'answer'; label: the tool's name or a manual note
export function parseMarkersJson(text: string): { ok: true; markers: Marker[] } | { ok: false; issues: ProjectIssue[] };
```

In the same file, replace:

```ts
// @cuttle/recorder (M4)
export interface RecordOptions {
  projectDir: string;
  source: { kind: 'monitor'; index: number } | { kind: 'region'; rect: Rect; monitor: number } | { kind: 'window'; title: string };
  webcam?: string; mic?: string;           // device names from listDevices()
  stop: { maxSeconds?: number; untilFile?: string; untilIdleSeconds?: number; untilClaude?: string /* cwd */ };
  countdownSeconds?: number; drawMouse?: boolean;
  backend?: 'auto' | 'test';
}
export interface Take { dir: string; screen: string; webcam?: string; mic?: string; events: string; markers: string; screenSize: { width: number; height: number }; seconds: number }
export function listDevices(): Promise<{ monitors: Monitor[]; windows: WindowInfo[]; cameras: string[]; mics: string[] }>;
export function record(opts: RecordOptions): { stop(): Promise<Take>; done: Promise<Take> };
```

with:

```ts
// @cuttle/recorder (M4) – Node (plain or Electron's main process); real capture on Windows, backend 'test' everywhere
export interface RecordOptions {
  projectDir: string;                      // must exist; the take goes to takes/<n>/
  source: { kind: 'monitor'; index: number } | { kind: 'region'; rect: Rect; monitor: number } | { kind: 'window'; title: string };
                                           // rect in that monitor's pixels; a window is the region of its bounds at the start
  webcam?: string; mic?: string;           // device names from listDevices()
  stop: { maxSeconds?: number; untilFile?: string; untilIdleSeconds?: number; untilClaude?: string /* cwd */ };
  countdownSeconds?: number;               // default 3
  drawMouse?: boolean;
  backend?: 'auto' | 'test';
  onEvent?: (event: RecorderEvent) => void; // countdown, recording, marker, warning, stopping
}
export interface Take {                    // paths relative to projectDir, with forward slashes
  dir: string; screen: string; webcam?: string; mic?: string; events: string; markers: string;
  screenSize: { width: number; height: number }; seconds: number;
  stopReason: 'stop' | 'hotkey' | 'max-seconds' | 'file' | 'idle' | 'claude'; warnings: string[];
}
export interface Monitor { index: number; name: string; bounds: Bounds; scale: number; primary: boolean } // index = ddagrab output_idx
export interface WindowInfo { title: string; bounds: Bounds; monitor: number } // Bounds = { x, y, width, height }, physical desktop pixels
export function listDevices(opts?: { backend?: 'auto' | 'test' }): Promise<{ monitors: Monitor[]; windows: WindowInfo[]; cameras: string[]; mics: string[] }>;
export function record(opts: RecordOptions): { stop(): Promise<Take>; marker(label?: string): void; done: Promise<Take> };
export class RecorderError extends Error {    // CLI exit codes: 1, 2, 2, 2, 2, 130
  code: 'invalid-options' | 'device-not-found' | 'ffmpeg-missing' | 'capture' | 'unsupported-platform' | 'cancelled';
}
export const HOTKEYS: Record<'stop' | 'marker', string>; // Ctrl+Shift+Alt+S, Ctrl+Shift+Alt+M
```

In the same file, replace:

```markdown
- **M4:** Mapping from Electron `screen.getAllDisplays()` to ffmpeg `ddagrab output_idx` (on the
  user's PC, `output_idx=0` was the 2560×1440 primary and `1` a 1920×1080 secondary; match by
  size and position, never by order). Graceful ffmpeg stop by writing `q` to stdin. Fragmented MP4
  flags `-movflags +frag_keyframe+empty_moov+default_base_moof`. `uiohook-napi` prebuilt binaries for
  the Electron ABI. Cursor shape on Windows: poll `GetCursorInfo` (user32, via koffi) at ~30 Hz and
  compare `hCursor` with `LoadCursor(NULL, IDC_ARROW | IDC_IBEAM | IDC_HAND | IDC_WAIT | IDC_CROSS |
  IDC_SIZEALL | IDC_NO)`; write a `shape` event only when it changes; unknown handles map to `arrow`.
  macOS: best effort, `arrow` fallback. uiohook reports global desktop coordinates (negative left of
  the primary monitor; points, not Retina pixels, on macOS): subtract the capture origin and apply
  the display scale before writing `events.jsonl`. Drop events with `t < 0` (before the first
  frame). M3 added `parseEventsJsonl` (tolerant of a cut-off last line) and the take.json schema
  (`TakeFileSchema`, `parseTakeJson`, `trackOffset`) to `@cuttle/project`: write events.jsonl in
  screen-track seconds and take.json next to the tracks, each track with its file name and the time
  its first frame or sample was captured on one monotonic clock. Encode screen and webcam with the
  BT.709 matrix and tags (`-vf scale=out_color_matrix=bt709:out_range=tv,format=yuv420p -colorspace
  bt709 -color_range tv`): Chromium decodes untagged HD video as BT.709 and ffmpeg's default RGB
  conversion is BT.601, which shifts every colour. Force a key frame every 2 s
  (`-force_key_frames "expr:gte(t,n_forced*2)"`, works with variable frame rate): each fragment is
  one GOP, so libx264's default of 250 frames loses up to 8 s in a crash and makes export decode up
  to 249 extra frames at a scene start. Claude transcripts live in `~/.claude/projects/<cwd with : \ / replaced by ->/`
  and have `timestamp`, `type` and `message.stop_reason`.
```

with:

```markdown
- **M4:** done; see "Decisions made while planning" in `2026-10-17-cuttle-m4-recorder.md`.
```

In the same file, replace:

```markdown
  pull in any local file, so the app should ask before opening one.
```

with:

```markdown
  pull in any local file, so the app should ask before opening one. From M4: `record()` runs in
  plain Node (the CLI does not need Electron for it); in a Vite bundle keep `koffi` and
  `uiohook-napi` external (native modules) and ship them in `node_modules`. Turn Ctrl+C and a kill
  into `Recording.stop()` (a stop during the countdown rejects with `cancelled`, exit 130), print
  `HOTKEYS` when the recording starts, map `RecorderError.code` to exit codes 1/2/2/2/2/130, and
  print the `Take` for `--json`. A take does not touch `cuttle.json`: the CLI decides whether
  `cuttle record` points `sources` at the new take (its paths are already relative to the project).
```

- [ ] **Step 3: Spec**

In `docs/superpowers/specs/2026-10-16-cuttle-design.md`, replace:

```markdown
- Video tracks are written as fragmented MP4 (H.264, 4:2:0, high quality CRF, BT.709 matrix and
  tags, a key frame every 2 s) so a killed process leaves a readable file.
```

with:

```markdown
- Phase 1 records on Windows; macOS follows (until then `record()` says `unsupported-platform`). A
  `test` backend (ffmpeg test sources, synthetic input) runs everywhere and carries the tests.
- Video tracks are written as fragmented MP4 (H.264, 4:2:0, high quality CRF, BT.709 matrix and
  tags, a key frame every 2 s, every packet flushed) so a killed process leaves a readable file up
  to its last 2 s; the mic (AAC) is cut into 1 s fragments.
```

In the same file, replace:

```markdown
  counts. Key contents are never stored. Cursor shape comes from `GetCursorInfo` on Windows; on
  macOS it is best effort and falls back to `arrow`.
```

with:

```markdown
  counts per half second. Key contents and the timing of single presses are never stored. Cursor
  shape comes from `GetCursorInfo` on Windows; on macOS it is best effort and falls back to `arrow`.
```

In the same file, replace:

```markdown
  `start` = when the track's first frame or sample was captured (schema in `@cuttle/project`).
- Stop triggers, combinable: hotkey, max duration, `--until-file <path>`, `--until-idle <s>`
  (screen unchanged for N seconds), `--until-claude [<cwd>]` (latest Claude Code transcript for that
  folder shows an assistant message with `stop_reason: end_turn` after the recording started; then a
  short tail).
- Markers: a hotkey adds manual markers. In Claude mode, markers come from the transcript: prompt
  submitted, each tool call, final answer.
```

with:

```markdown
  `start` = when the track's first frame or sample was captured (schema in `@cuttle/project`). The
  recorder uses the wall clock (Unix seconds, from ffmpeg's packet stamps).
- Stop triggers, combinable: hotkey (Ctrl+Shift+Alt+S), max duration, `--until-file <path>` (must
  not exist yet), `--until-idle <s>` (screen unchanged for N seconds after it changed),
  `--until-claude [<cwd>]` (the first Claude Code session in that folder that submits a prompt after
  the recording started shows an assistant message with `stop_reason: end_turn`; then a 2 s tail;
  other sessions and subagents are ignored).
- Markers: a hotkey (Ctrl+Shift+Alt+M) adds manual markers. In Claude mode, markers come from the
  transcript: prompt submitted, each tool call (with the tool's name), final answer. `markers.json`:
  `{ "version": 1, "markers": [{ "t": 1.27, "kind": "tool", "label": "Bash" }] }`, `t` in source
  seconds, `kind` one of `manual`, `prompt`, `tool`, `answer` (schema in `@cuttle/project`).
- A microphone that delivers digital silence (muted, or blocked for desktop apps) is reported as a
  warning one second into the take.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md docs/superpowers/specs/2026-10-16-cuttle-design.md
git commit -m "docs: recorder in the README, roadmap and spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Final verification

- [ ] **Step 1: Unit, integration and golden tests, twice**

Run: `pnpm test`
Expected: PASS, `Test Files  36 passed | 1 skipped (37)` and `Tests  311 passed | 1 skipped (312)` (the skipped one is the real-capture test).

Run: `pnpm test`
Expected: the same again (nothing flaky, no golden rewritten).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exits with code 0 and prints the six `tsc` commands.

- [ ] **Step 3: The done criterion**

The test backend part ran in Step 1 (`packages/recorder/test/record.test.ts`: the 3 s take with every track, `untilFile`, `untilClaude` with a fake transcript). The Windows part:

Run: `pnpm recorder:real`
Expected: PASS, 1 test, as in Task 9.

- [ ] **Step 4: Nothing left behind**

```bash
git status --short
ls "$TEMP" | grep -E '^cuttle-(record|ffmpeg|claude|transcripts|real)-' || echo "no temp folders left"
```

Expected: `git status` prints nothing, then `no temp folders left`.

---

## Spec coverage (M4 scope)

| Spec or roadmap item | Task |
|---|---|
| Sources: a monitor, a region, a window (captured as the region of its bounds) | 4, 7, 8 |
| Screen: ffmpeg `ddagrab` (`draw_mouse=0`, `--draw-mouse` bakes it in), crop for regions | 3, 4, 8, 9 |
| Webcam and mic: ffmpeg `dshow`; device names from `listDevices()` | 4, 7 |
| Input events: `uiohook-napi`; mouse ~60 Hz, clicks, scroll, cursor shape (`GetCursorInfo`), key counts without contents | 5, 7 |
| Fragmented MP4, H.264 4:2:0, high-quality CRF, BT.709 matrix and tags, a key frame every 2 s; readable after a kill | 2, 3, 8 |
| take.json: per-track start times on one clock | 2, 8 |
| events.jsonl in source seconds and source pixels, `t < 0` dropped | 5, 8 |
| Stop triggers: hotkey, max duration, until-file, until-idle, until-claude with a tail | 3, 6, 7, 8 |
| Markers: hotkey and API (manual); prompt, tool call, final answer from the transcript | 1, 6, 8 |
| Countdown (default 3 s) | 8 |
| Mapping of monitors to ddagrab `output_idx` (roadmap: verify first) | 7 |
| `test` backend with ffmpeg test sources; trigger tests for until-file, until-idle, until-claude (fake transcript) | 4, 8 |
| Done criterion: test backend 3 s take with all tracks; until-file and until-claude stop it; a manual Windows run records a monitor | 8, 9, 11 |
| `pnpm typecheck` covers the new package | 2 |

## Open points for later milestones

- **macOS.** `avfoundation` for screen, webcam and mic, the device listing, the cursor shape and the coordinate scale (uiohook reports points on Retina screens) need a Mac; `record()` refuses with `unsupported-platform` until then.
- **Webcam.** Not tried for real (no webcam on the reference PC). The first real webcam take should be checked: format and size (DirectShow's default may be 640×480 or MJPEG), frame rate, and the start time (a camera's own latency is not corrected).
- **Hotkeys** were not pressed in a test (typing them through `SendInput` would reach the focused window too). Try both once by hand; make them configurable if they clash with an app.
- **A moved window** is not followed: the region is fixed when the recording starts.
- **Monitors on a second GPU** cannot be grabbed by ddagrab and are not listed.
- **untilClaude** stops at the first finished turn of the followed session; a demo with several prompts needs `untilFile` or the hotkey. A turn that ends because the user pressed Esc writes no `end_turn`; `maxSeconds` is the safety net.
- **M5 integration:** see the M5 bullet in the roadmap (plain Node, external native modules, Ctrl+C → `stop()`, exit codes, `--json`, `sources` in `cuttle.json`).

## Changes during execution

(Filled in after the plan has been executed.)

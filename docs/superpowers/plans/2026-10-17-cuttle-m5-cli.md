# Cuttle M5: CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/cli`, the `cuttle` command: `init`, `devices`, `record`, `suggest`, `preview`, `capture-page`, `render` and `recover`, each with `--json` for Claude, the spec's exit codes and a clean Ctrl+C. `suggest` turns a take into scenes (quiet start and end trimmed, idle stretches cut, waiting sped up, a zoom on Claude's answer); `preview` renders PNG stills and a contact sheet with the export's engine. Done when the treg demo can be rebuilt from its take with `cuttle suggest`, a few JSON edits and `cuttle render`.

**Architecture:** A Node CLI (commander) bundled by Vite into `apps/cli/dist/cuttle.mjs`. `record`, `devices`, `suggest` and `recover` run in plain Node (`@cuttle/recorder`, ffmpeg). `render`, `preview` and `capture-page` need Chromium: the CLI spawns Electron with `dist/electron.mjs` and one base64 JSON request; the answer and a cancel travel over Node's IPC channel. `@cuttle/export` gains `renderStills` (single output frames as PNGs, plus a contact sheet) on the export's page and decoders. `pnpm cli:install` puts small `cuttle` shims on PATH.

**Tech Stack:** TypeScript 5, Node 22, commander 15.0.0, Electron 44, Vite 8 (SSR bundles), ffmpeg 9 (freezedetect, frame grabs), vitest 5.

Spec: `docs/superpowers/specs/2026-10-16-cuttle-design.md`. Roadmap and shared interfaces: `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`. M3 and M4 (done): `2026-10-16-cuttle-m3-export.md`, `2026-10-17-cuttle-m4-recorder.md`. Spike notes with every measurement: `docs/superpowers/spikes/2026-10-17-m5-cli-spike.md` (written against the prototype; where they differ, this plan wins).

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `m5-cli`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- The CLI tests need **ffmpeg and ffprobe on PATH** (`CUTTLE_FFMPEG` overrides the ffmpeg path). `cuttle record` in the tests uses the recorder's `test` backend (ffmpeg test sources in real time), so a 2 s take takes about 2 s.
- The task steps run only the tests they touch (`pnpm exec vitest run <files>`); the full `pnpm test`, which includes the engine's golden images in Chromium, runs once in Task 9. The commands that run in Electron are checked through the built CLI with `pnpm cli:check` (Task 6).
- Tests delete the temp folders they create.

## Decisions made while planning

A spike and a full prototype (the M4 machine: Windows 11, three monitors, the primary at 125 %, ffmpeg 9.0, Node 22.16, Electron 44.7.2) settled these points. Every code block below ran: the plan was replayed mechanically, twice, on fresh clones of `main` (f553262), applying every file block and edit from this text and running every command, 8 commits; the result is byte-identical to the prototype. (The first replay, on a clone without the Electron binary, found Electron's download notice on stdout; see "Electron for render, preview and capture-page".) `pnpm test` passes 349 tests in 40 files and skips 5 (the real-capture test and the Electron checks), twice in a row (~18 s, engine goldens included), `pnpm typecheck` is clean, `pnpm cli:check` passes its 4 checks, and the treg demo was rebuilt from its take (Task 9).

- **commander 15.0.0** (MIT, Node ≥ 22.12), pinned exactly. `runCli(argv, streams?)` builds the program per call with `exitOverride()`, so the tests run the CLI in-process with their own stdout and stderr; it returns the exit code, and `src/bin.ts` sets `process.exitCode` (with an unref'd 2 s `process.exit` as a fallback for a stray handle). Global options: `-C, --project <dir>` (default `.`) and `--json`.
- **Output.** With `--json` stdout carries exactly one JSON document: the command's result, or `{ "error": { "code", "message" } }`. Status lines go to stderr, and only without `--json` (warnings always). Without `--json` stdout gets a short text for people with the next step (`next: cuttle suggest …`).
- **Exit codes** (spec): 0 ok, 1 usage or validation, 2 device or permission, 3 render, 130 cancelled. Recorder codes map 1/2/2/2/2/130 (`invalid-options`, `device-not-found`, `ffmpeg-missing`, `capture`, `unsupported-platform`, `cancelled`), export codes 1/1/1/2/3/130 (`invalid-project`, `missing-file`, `invalid-media`, `ffmpeg-missing`, `render`, `cancelled`), the CLI's own `usage` 1. commander's usage errors exit 1, `--help` and `--version` 0. Codes Electron reports that the CLI does not know (a module that did not load) count as `render`.
- **Electron for render, preview and capture-page.** The CLI spawns the Electron binary with `dist/electron.mjs` and the request as one base64 JSON argument (the last one: Chromium switches come before the script). **On Windows Electron gets neither the console's Ctrl+C (it has no console) nor stdin (its main process reads none)**, so the answer and a cancel go over Node's IPC channel (`stdio: ['ignore', 'pipe', 'inherit', 'ipc']`). Electron's stdout (warnings) is piped to stderr, so stdout stays free for `--json`. A cancel gives Electron 15 s to clean up, then it is killed. `dist/electron.mjs` is a tiny bootstrap that installs the `uncaughtException` handler and then imports the rest: an error while the bundle loads reaches the CLI as an error instead of Electron's modal dialog (roadmap item from M3). A no-op `window-all-closed` keeps Electron alive when the export window closes. **Electron 44 downloads its binary on first use** (`require('electron')` in a fresh install) and announces that on stdout, which belongs to `--json` (the first replay of this plan on a fresh clone failed on it): the CLI reads the binary's path itself (`path.txt` in the electron package names the executable in `dist/`) and, when it is missing, runs Electron's installer with its output on stderr.
- **Ctrl+C.** SIGINT, SIGTERM and SIGBREAK become an `AbortSignal` for `record`, `render`, `preview` and `capture-page`; a second one exits 130 at once. `record` turns it into `Recording.stop()`: the take is kept (exit 0, stop reason `stop`; during the countdown the recorder rejects with `cancelled`, exit 130). The Electron commands send the cancel: the export removes its temp files and writes nothing (exit 130). Tested with a real console Ctrl+C on Windows (spike notes, section 6).
- **A project is one take.** `cuttle record` (and `recover`) points `sources` at the take and sets one clip scene over the whole take. Scenes, zooms, masks and texts of a previous take refer to its source times, so they are dropped; when there were any, the old file is kept as `cuttle.json.bak`. `record` creates the project folder and `cuttle.json` when they are missing. The CLI edits the JSON as written (`raw`: defaults stay out of the file, unknown order kept), checks it with `parseProject` and writes it through a temp file and a rename. Defaults: the primary monitor; `--webcam` and `--mic` without a name take the first device; `--until-claude` without a folder means the current one.
- **`suggest` rules** (seconds of the take; constants in `src/suggest/plan.ts`). Activity is input (each event ±0.3 s; cursor-shape changes do not count), a changing screen (ffmpeg's `freezedetect` at −60 dB, 0.5 s, on a 320 px grey copy; a blinking caret stays below that) and Claude's turn, from its first prompt or tool marker to the answer. **Claude's turn is never cut**: while Claude works the screen often shows only a spinner, which counts as still (the first rules cut the treg take into 9 s of fragments). The take starts 0.5 s before the first activity (2 s before a prompt marker) and ends 1 s after the last (at least 2.5 s after the answer). A stretch without activity of 3 s or more is cut, keeping 0.5 s on both sides. A stretch without input of 8 s or more is sped up, keeping 1 s at 1× on both sides and the answer at 1× from 1.5 s before it: it shows about a twelfth of its length, at least 3 and at most 10 s of video, at the largest of 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64× that fits (the treg take: 145.1 s at 12×, as the hand-made demo had it). 1× pieces shorter than 0.6 s join the speed-up next to them. Every decision becomes a note (`trimmed the quiet start (0.0–1.8 s)`).
- **The zoom on the answer** compares grey frames (480 px wide) 6 s before the answer and 0.3 s after it: pixels that moved by more than 24 grey levels, fewer than 0.2 % is noise, the box spans the 2nd to the 98th percentile of their positions (a stray pixel cannot stretch it). The zoom rect gets 6 % of the screen's width as padding and at least 35 % of its width; when it would cover more than 75 % of the screen (the answer scrolled the whole terminal, as in the treg take) there is no zoom and a note says so. It starts 0.5 s before the answer and lasts up to 4 s.
- **Markers from the transcript.** `suggest --claude [cwd]` reads Claude Code's transcripts for a take without Claude markers (recorded without `--until-claude`, or before the recorder existed) with the recorder's `SessionReader`: the session with the most prompt, tool and answer markers inside the take, in the screen track's seconds (from the start in take.json); a split assistant message counts once (`kind:id`).
- **`suggest` writes** scenes and zooms (masks and texts stay), keeps the old file as `cuttle.json.bak`; `--dry-run` prints only, `--no-zoom` skips the zoom.
- **`preview`** renders with the export's engine and decoders in Electron (`renderStills` in `@cuttle/export`): PNGs of the output frames at `--at` times (repeatable; a time past the end shows the last frame), named `01-12.50s.png`, in `preview/` of the project (or `-o`). Without `--at`: 12 evenly spaced stills and a contact sheet (`sheet.png`: cells 480 px wide, 4 columns, the time under each), which is what Claude looks at. The page plans only the frames asked for (`planStills`), so a scene decodes just the source times they show.
- **`capture-page`** renders the page in an offscreen Electron window (`webPreferences.offscreen`): a hidden on-screen window paints a still page only once and the screenshot then hangs. The size comes from `Emulation.setDeviceMetricsOverride` at device scale 1 and a clip of `Page.captureScreenshot`, not from the window (at 125 % the window's pixels are 1.25× larger). `--scroll` captures the whole page (up to 16384 px tall) for a scrolling still. Default size: the project's output size; default wait after loading 1 s (fonts, maps); loading times out after 30 s, the capture after 20 s. The PNG goes to `stills/<name>.png`; `--add` appends a still scene (`frame: 'browser-light'`, `motion: 'scroll'` with `--scroll`, 4 s or `--duration`).
- **`recover <take>`** checks each track by copying its packets with ffmpeg (a crashed fragmented MP4 is readable up to its last fragment), leaves out a webcam or mic without readable data, keeps the valid lines of events.jsonl byte for byte (a crash cuts off the last one; the old file is kept as `.bak`), writes markers.json empty and take.json with every track at start 0 when they are missing or broken, and points the project at the take. A take folder outside the project is refused.
- **`render`** writes `out/<format>.mp4` (`out/16x9.mp4`; `out/export.mp4` without `--format`) or `-o`; `--encoder auto|hardware|software`. It checks the project before Electron starts.
- **On PATH.** `pnpm link --global` needs pnpm's global bin folder on PATH, which `pnpm setup` would add by editing the user's environment. `pnpm cli:install` instead writes three shims (`cuttle.cmd`, `cuttle.ps1`, `cuttle` for Git Bash) into npm's global folder, which every Node install on Windows puts on PATH (`%APPDATA%\npm`; `~/.local/bin` elsewhere; `CUTTLE_BIN_DIR` overrides). Each shim carries a marker comment; a `cuttle` file without it belongs to another tool and is never overwritten. `pnpm cli:uninstall` removes ours. `pnpm cuttle …` runs the built CLI without installing (pnpm runs it in the repo root, so give absolute paths there).
- **The bundle.** `vite.config.ts` in `apps/cli` bundles `src/bin.ts` (→ `dist/cuttle.mjs`) and `src/electron/bootstrap.ts` (→ `dist/electron.mjs`) as ES modules for Node 22, with the workspace packages inside; `electron`, `koffi` and `uiohook-napi` stay external and load from `node_modules` (native modules). Shared chunks stay next to the entries, and a second Vite build writes the export page to `dist/export-page/`, where `@cuttle/export` looks for it. Electron stays a root devDependency, as for `@cuttle/export`.
- **`export:run` is retired.** It was the export's development entry "until the CLI exists" (`packages/export/electron/cli.ts`); `cuttle render` replaces it. `export:check` stays.
- **Interface changes against the roadmap** (Task 8 updates it): `@cuttle/export` exports `renderStills(opts: StillsOptions): Promise<StillsResult>` and `stillName(n, t)`; its internal `ExportJob` gets `kind: 'video'` next to a `StillsJob`, and `ExportHost` gets `writeStill(name, data)`.

## File structure

```
cuttle/
├── package.json                      typecheck covers apps/cli; scripts cli:build, cli:install, cli:uninstall,
│                                     cli:check, cuttle; export:run removed
├── vitest.config.ts                  the node project also runs apps/*/test
├── README.md, docs/…                 the CLI in the README, roadmap and spec
├── packages/export/
│   ├── src/frame-plan.ts             planStills: a plan for single frames
│   ├── src/job.ts                    StillsJob, PageStillsSuccess, ExportHost.writeStill
│   ├── src/page/run.ts               withRendering shared by the video and the stills job; stills and the sheet
│   ├── src/main/export.ts            shares its helpers with stills.ts
│   ├── src/main/stills.ts            renderStills (new)
│   ├── src/index.ts                  exports renderStills, stillName
│   ├── electron/export-page/preload.cjs   writeStill
│   ├── electron/cli.ts               removed (export:run)
│   └── test/frame-plan.test.ts       planStills
└── apps/cli/
    ├── package.json                  @cuttle/cli; workspace packages, commander 15.0.0, koffi, uiohook-napi
    ├── tsconfig.json, vite.config.ts
    ├── scripts/install.mjs           the shims on PATH
    ├── src/
    │   ├── bin.ts, main.ts           entry; the commander program (runCli)
    │   ├── errors.ts, output.ts      CliError and exit codes; --json or text
    │   ├── project-file.ts, use-take.ts   cuttle.json as written; pointing a project at a take
    │   ├── ffmpeg.ts                 runFfmpeg
    │   ├── electron-runner.ts        spawns Electron, IPC answer and cancel
    │   ├── commands/                 init, devices, record, suggest, preview, capture-page, render, recover
    │   ├── suggest/                  spans, plan (the rules), media (ffmpeg), region (zoom), transcript
    │   └── electron/                 bootstrap, finish, main (Electron's side), protocol, capture-page
    └── test/
        ├── suggest.test.ts, transcript.test.ts   the rules, ffmpeg's log, the zoom box, transcript markers
        ├── cli.test.ts               every Node command in-process, JSON snapshots
        └── electron.check.test.ts    preview, capture-page, render through the built CLI (pnpm cli:check)
```

---

### Task 1: Stills in `@cuttle/export`

`cuttle preview` renders single output frames with the export's engine and decoders, and a contact sheet. The page gets a second kind of job; the main process gets `renderStills` next to `exportProject`.

**Files:**
- Modify: `packages/export/src/frame-plan.ts`, `packages/export/src/job.ts`, `packages/export/src/page/run.ts`, `packages/export/src/main/export.ts`, `packages/export/src/index.ts`, `packages/export/electron/export-page/preload.cjs`
- Create: `packages/export/src/main/stills.ts`
- Test: `packages/export/test/frame-plan.test.ts`

- [ ] **Step 1: Write the failing test**

The plan was committed on the branch `m5-cli`; work there:

```bash
git switch m5-cli
```

`packages/export/test/frame-plan.test.ts`:

```ts
import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import { createTimeline } from '@cuttle/timeline';
import { describe, expect, it } from 'vitest';
import { frameCount, planFrames, planStills } from '../src/frame-plan';

function plan(input: Omit<CuttleProjectInput, 'version' | 'sources'>, fps = 30) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input, output: { fps } });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return planFrames(createTimeline(parsed.project, { screenSize: { width: 1920, height: 1080 } }), fps);
}

describe('frameCount', () => {
  it('counts every started frame', () => {
    expect(frameCount(10, 30)).toBe(300);
    expect(frameCount(7.01, 30)).toBe(211);
    expect(frameCount(1 / 3, 30)).toBe(10);
    expect(frameCount(0.001, 30)).toBe(1);
  });
});

describe('planFrames', () => {
  it('covers each scene with its crossfade and lists its source times once, ascending', () => {
    const result = plan({
      scenes: [
        { type: 'clip', from: 0, to: 2 },
        { type: 'clip', from: 10, to: 18, speed: 4 },
        { type: 'card', title: 'End', duration: 1 },
      ],
    });
    expect(result.frames).toBe(150);
    // 0.3 s transition: 0.15 s (4.5 frames) on each side of a cut.
    expect(result.scenes.map(({ index, kind, firstFrame, lastFrame }) => ({ index, kind, firstFrame, lastFrame }))).toEqual([
      { index: 0, kind: 'clip', firstFrame: 0, lastFrame: 64 },
      { index: 1, kind: 'clip', firstFrame: 56, lastFrame: 124 },
      { index: 2, kind: 'card', firstFrame: 116, lastFrame: 149 },
    ]);
    const second = result.scenes[1]!.sourceTimes;
    expect(second[0]).toBe(10);
    expect(second.at(-1)).toBeLessThan(18);
    expect(second.every((t, i) => i === 0 || t > second[i - 1]!)).toBe(true);
    // 4× speed at 30 fps: 2 output seconds of the clip need 60 distinct source times.
    expect(second).toHaveLength(60);
    expect(result.scenes[2]!.sourceTimes).toEqual([]);
  });

  it('ends a clip on the last frame shown when it ends between two frames', () => {
    const result = plan({ scenes: [{ type: 'clip', from: 0, to: 1.01 }, { type: 'card', title: 'End', duration: 1 }] });
    const clip = result.scenes[0]!;
    // Frames 0 to 30 (t = 0 … 1.0) are inside [0, 1.01); the crossfade until frame 34 holds frame 30.
    expect(clip.lastFrame).toBe(34);
    expect(clip.sourceTimes).toHaveLength(31);
    expect(clip.sourceTimes.at(-1)).toBe(1);
  });

  it('refuses a project without scenes', () => {
    expect(() => plan({ scenes: [] })).toThrow(/no scenes/);
  });
});

describe('planStills', () => {
  function stills(frames: number[]) {
    const parsed = parseProject({
      version: 1,
      sources: { screen: 's.mp4' },
      scenes: [
        { type: 'clip', from: 0, to: 2 },
        { type: 'clip', from: 10, to: 18, speed: 4 },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    return planStills(createTimeline(parsed.project, { screenSize: { width: 1920, height: 1080 } }), 30, frames);
  }

  it('plans only the frames asked for, so each scene decodes just their source times', () => {
    const result = stills([90, 10, 10, 60]);
    expect(result.frames).toBe(3); // three distinct frames
    expect(result.scenes.map(({ index, firstFrame, lastFrame, sourceTimes }) => ({ index, firstFrame, lastFrame, sourceTimes }))).toEqual([
      // Frame 60 is the middle of the crossfade: the first clip holds its last frame (59/30 s).
      { index: 0, firstFrame: 10, lastFrame: 60, sourceTimes: [10 / 30, 59 / 30] },
      { index: 1, firstFrame: 60, lastFrame: 90, sourceTimes: [10, 14] },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/export/test/frame-plan.test.ts`
Expected: FAIL, the new test fails with `TypeError: planStills is not a function`; the 4 others pass.

- [ ] **Step 3: Plan single frames**

`packages/export/src/frame-plan.ts`:

```ts
import type { Timeline } from '@cuttle/timeline';

/** Where one scene is visible in the export and which source times its clip frames come from. */
export interface ScenePlan {
  index: number;
  kind: 'clip' | 'still' | 'card';
  /** First and last output frame (inclusive) on which the scene is drawn, crossfades included. */
  firstFrame: number;
  lastFrame: number;
  /**
   * Clip scenes: every source time the frames ask for, in frame order, without repeats (seconds
   * of the screen track). Ascending: the timeline never goes back within a clip. Empty for still
   * and card scenes.
   */
  sourceTimes: number[];
}

export interface FramePlan {
  fps: number;
  /** Output frames; frame i shows output time i / fps. */
  frames: number;
  /** Scenes in the order they first appear. */
  scenes: ScenePlan[];
}

/** Frames for `duration` output seconds: every started frame counts, so the video never ends early. */
export function frameCount(duration: number, fps: number): number {
  return Math.max(1, Math.ceil(duration * fps - 1e-6));
}

/**
 * Walks the timeline frame by frame and records, per scene, the frames it is visible on and the
 * source times it needs. Export opens each scene's decoder at `firstFrame`, closes it after
 * `lastFrame`, and decodes exactly `sourceTimes`.
 */
export function planFrames(timeline: Timeline, fps: number): FramePlan {
  if (timeline.spans.length === 0) throw new Error('planFrames: the project has no scenes');
  const frames = frameCount(timeline.duration, fps);
  return { fps, frames, scenes: planScenes(timeline, fps, Array.from({ length: frames }, (_, frame) => frame)) };
}

/**
 * The plan for single frames (stills of a preview): only `frames` (output frame numbers) are
 * visited, so each scene decodes just the source times those frames show. `frames` in the plan is
 * their count.
 */
export function planStills(timeline: Timeline, fps: number, frames: readonly number[]): FramePlan {
  if (timeline.spans.length === 0) throw new Error('planStills: the project has no scenes');
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
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
  }
  // Map order is first appearance: frame order, and within a frame the layers back to front.
  return [...byIndex.values()];
}
```

Run: `pnpm exec vitest run packages/export/test/frame-plan.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 4: The stills job on the page**

The page renders a `StillsJob` with the video job's setup (`withRendering`), encodes each frame as a PNG (`convertToBlob`) and draws the contact sheet on a 2D canvas with the engine's font.

`packages/export/src/job.ts`:

```ts
import type { CuttleProject, InputEvent } from '@cuttle/project';

/**
 * Contract between the main process and the export page. Pure types and constants: both sides
 * import this file, the preload script repeats the channel names (it cannot import TypeScript).
 */

export type EncoderPreference = 'auto' | 'hardware' | 'software';

/** Why an export failed; the CLI maps these to exit codes (see `ExportError`). */
export type ExportErrorCode = 'invalid-project' | 'missing-file' | 'invalid-media' | 'ffmpeg-missing' | 'render' | 'cancelled';

/** Everything the page needs for one export. Paths are absolute; the page may read only these files. */
export interface ExportJob {
  kind: 'video';
  /** Output size already set to the export format. */
  project: CuttleProject;
  screen: string;
  /** Present when the webcam bubble is on. `offset`: seconds the webcam started after the screen. */
  webcam?: { path: string; offset: number };
  /** Present when the cursor is on and the project has events. */
  events?: InputEvent[];
  /** Scene index → image of a still scene. */
  stills: Record<number, string>;
  /** Image for `look.background.preset: 'image'`. */
  backgroundImage?: string;
  encoder: EncoderPreference;
}

/**
 * Single frames instead of a video (a preview): PNGs of the output frames at `times` (output seconds),
 * written through `ExportHost.writeStill` as `still-<n>` in the order of `times`, and with `sheet` one
 * contact sheet of them (`sheet`), labelled with their times.
 */
export interface StillsJob extends Omit<ExportJob, 'kind' | 'encoder'> {
  kind: 'stills';
  times: number[];
  sheet?: { columns: number };
}

export type PageJob = ExportJob | StillsJob;

export interface PageTimings {
  /** Waiting for decoded frames and still images. */
  decodeMs: number;
  /** Timeline and renderer calls (GPU work runs on asynchronously). */
  renderMs: number;
  /** Handing frames to the encoder, including its back-pressure and the GPU finishing the frame. */
  encodeMs: number;
  /** Writing the moov and the last chunks. */
  finalizeMs: number;
  totalMs: number;
}

export interface PageSuccess {
  ok: true;
  frames: number;
  codec: string;
  hardwareAcceleration: 'prefer-hardware' | 'prefer-software';
  bitrate: number;
  /** WebGL renderer string, e.g. "ANGLE (AMD, … Direct3D11 …)"; SwiftShader means no GPU. */
  gpu: string;
  timings: PageTimings;
}

export interface PageFailure {
  ok: false;
  code: ExportErrorCode;
  message: string;
}

/** A stills job's result; `width` and `height` are the output size. */
export interface PageStillsSuccess {
  ok: true;
  stills: number;
  width: number;
  height: number;
  gpu: string;
  totalMs: number;
}

export type PageResult = PageSuccess | PageStillsSuccess | PageFailure;

/** What the preload script exposes to the page as `window.cuttleHost`. */
export interface ExportHost {
  job(): Promise<PageJob>;
  size(path: string): Promise<number>;
  /** Bytes `[start, end)` of a job file. */
  read(path: string, start: number, end: number): Promise<Uint8Array>;
  readFile(path: string): Promise<Uint8Array>;
  /** Writes into the video-only output file at a byte position. */
  write(data: Uint8Array, position: number): Promise<void>;
  progress(done: number, total: number): void;
  /** Writes a PNG of a stills job: `still-<n>` (0-based, in the order of `times`) or `sheet`. */
  writeStill(name: string, data: Uint8Array): Promise<void>;
}

/** IPC channel names; keep electron/export-page/preload.cjs in sync. */
export const CHANNELS = {
  job: 'cuttle-export:job',
  size: 'cuttle-export:size',
  read: 'cuttle-export:read',
  readFile: 'cuttle-export:read-file',
  write: 'cuttle-export:write',
  progress: 'cuttle-export:progress',
  writeStill: 'cuttle-export:write-still',
} as const;
```

`packages/export/electron/export-page/preload.cjs`:

```js
// Bridge between the sandboxed export page and the main process (src/main/export.ts).
// The channel names repeat CHANNELS from src/job.ts: a sandboxed preload cannot import TypeScript.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cuttleHost', {
  job: () => ipcRenderer.invoke('cuttle-export:job'),
  size: (path) => ipcRenderer.invoke('cuttle-export:size', path),
  read: (path, start, end) => ipcRenderer.invoke('cuttle-export:read', path, start, end),
  readFile: (path) => ipcRenderer.invoke('cuttle-export:read-file', path),
  write: (data, position) => ipcRenderer.invoke('cuttle-export:write', data, position),
  progress: (done, total) => ipcRenderer.send('cuttle-export:progress', done, total),
  writeStill: (name, data) => ipcRenderer.invoke('cuttle-export:write-still', name, data),
});
```

`packages/export/src/page/run.ts`:

```ts
import { FONT_FAMILY, createRenderer, loadEngineAssets, type Renderer } from '@cuttle/engine';
import { createCursorTrack, createTimeline, type Timeline } from '@cuttle/timeline';
import { frameCount, planFrames, planStills, type FramePlan } from '../frame-plan';
import type { ExportJob, PageJob, PageResult, PageStillsSuccess, PageSuccess, StillsJob } from '../job';
import { host, PageError } from './host';
import { loadImage } from './images';
import { openVideo, type VideoFile } from './media';
import { SceneSources } from './scene-sources';
import { createVideoOutput } from './video-output';

/** Seconds before a scene first shows that its decoders start. */
const LOOKAHEAD_SECONDS = 1;
/** A clip may end this far past the last frame of the recording (rounding of recorded durations). */
const END_TOLERANCE_SECONDS = 0.05;

function gpuName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

/**
 * MAX_TEXTURE_SIZE from a throwaway context: the background image must be decoded before
 * createRenderer, and the canvas's own context must be created by createRenderer (its attributes).
 */
function probeMaxTextureSize(): number {
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
  if (!gl) throw new Error('WebGL2 is not available');
  const size = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return size;
}

function checkClipRanges(job: PageJob, screen: VideoFile): void {
  job.project.scenes.forEach((scene, index) => {
    if (scene.type === 'clip' && scene.to > screen.end + END_TOLERANCE_SECONDS) {
      throw new PageError(
        'invalid-project',
        `scenes[${index}] ends at ${scene.to} s, but the screen recording ends at ${screen.end.toFixed(3)} s`,
      );
    }
  });
}

/** What a video and a stills job share: the timeline, the renderer on its canvas and the scene sources. */
interface Rendering {
  timeline: Timeline;
  plan: FramePlan;
  renderer: Renderer;
  canvas: OffscreenCanvas;
  gl: WebGL2RenderingContext;
  sources: SceneSources;
}

/**
 * Opens the job's media, builds the timeline and the plan (`makePlan`), creates the renderer and the
 * scene sources, runs `body` and frees everything afterwards.
 */
async function withRendering<T>(job: PageJob, makePlan: (timeline: Timeline) => FramePlan, lookahead: number, body: (rendering: Rendering) => Promise<T>): Promise<T> {
  const { project } = job;
  const [assets, screen, webcam] = await Promise.all([
    loadEngineAssets(),
    openVideo(job.screen, 'the screen recording'),
    job.webcam ? openVideo(job.webcam.path, 'the webcam recording') : undefined,
  ]);
  const canvas = new OffscreenCanvas(1, 1);
  let background: ImageBitmap | undefined;
  let sources: SceneSources | undefined;
  let renderer: Renderer | undefined;
  try {
    checkClipRanges(job, screen);
    const timeline = createTimeline(project, {
      screenSize: screen.size,
      cursor: job.events ? createCursorTrack(job.events) : undefined,
    });
    const plan = makePlan(timeline);
    if (job.backgroundImage) background = await loadImage(job.backgroundImage, probeMaxTextureSize(), 'the background image');
    renderer = createRenderer(canvas, project, { assets, screenSize: screen.size, backgroundImage: background });
    const gl = canvas.getContext('webgl2')!;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    sources = new SceneSources(
      plan,
      { screen, webcam: webcam && job.webcam ? { ...webcam, offset: job.webcam.offset } : undefined, stills: job.stills, maxTextureSize },
      lookahead,
    );
    return await body({ timeline, plan, renderer, canvas, gl, sources });
  } finally {
    await sources?.close();
    renderer?.dispose();
    // Free the context now instead of waiting for GC (browsers keep only ~16 live WebGL contexts).
    (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    background?.close();
    screen.input.dispose();
    webcam?.input.dispose();
  }
}

async function exportVideo(job: ExportJob): Promise<PageSuccess> {
  const started = performance.now();
  const fps = job.project.output.fps;
  return withRendering(job, (timeline) => planFrames(timeline, fps), Math.round(LOOKAHEAD_SECONDS * fps), async ({ timeline, plan, renderer, canvas, gl, sources }) => {
    const output = await createVideoOutput(canvas, job.project.output, job.encoder);
    const timings = { decodeMs: 0, renderMs: 0, encodeMs: 0, finalizeMs: 0, totalMs: 0 };
    try {
      for (let frame = 0; frame < plan.frames; frame++) {
        const t0 = performance.now();
        const state = timeline.frameAt(frame / fps);
        const frameSources = await sources.sourcesFor(frame, state);
        const t1 = performance.now();
        renderer.render(state, frameSources);
        // render() throws on a lost context too; this catches a loss between render and capture.
        if (gl.isContextLost()) throw new Error('the WebGL context was lost during the export');
        const t2 = performance.now();
        await output.add(frame / fps, 1 / fps);
        const t3 = performance.now();
        await sources.release(frame);
        host().progress(frame + 1, plan.frames);
        timings.decodeMs += t1 - t0;
        timings.renderMs += t2 - t1;
        timings.encodeMs += t3 - t2;
      }
      const t4 = performance.now();
      await output.finalize();
      timings.finalizeMs = performance.now() - t4;
    } catch (error) {
      await output.cancel().catch(() => {}); // the original error matters, not a failed cleanup
      throw error;
    }
    timings.totalMs = performance.now() - started;
    for (const key of Object.keys(timings) as (keyof typeof timings)[]) timings[key] = Math.round(timings[key]);
    return {
      ok: true,
      frames: plan.frames,
      codec: output.codec,
      hardwareAcceleration: output.hardwareAcceleration,
      bitrate: output.bitrate,
      gpu: gpuName(gl),
      timings,
    };
  });
}

/** Contact sheet: each still this wide, its time below it. */
const SHEET_CELL_WIDTH = 480;
const SHEET_LABEL_HEIGHT = 34;
const SHEET_GAP = 12;

async function png(canvas: OffscreenCanvas): Promise<Uint8Array> {
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

async function renderStills(job: StillsJob): Promise<PageStillsSuccess> {
  const started = performance.now();
  const { fps, width, height } = job.project.output;
  /** The output frame of each of `job.times`, set when the plan is made. */
  let byTime: number[] = [];
  return withRendering(
    job,
    (timeline) => {
      // The output frame on screen at each time; times past the end show the last frame.
      const last = frameCount(timeline.duration, fps) - 1;
      const frames = job.times.map((t) => Math.min(last, Math.max(0, Math.floor(t * fps + 1e-6))));
      const plan = planStills(timeline, fps, frames);
      byTime = frames;
      return plan;
    },
    0,
    async ({ timeline, renderer, canvas, gl, sources }) => {
      const columns = job.sheet ? Math.max(1, Math.min(job.sheet.columns, job.times.length)) : 0;
      const cellHeight = Math.round((SHEET_CELL_WIDTH * height) / width);
      const sheet = job.sheet
        ? new OffscreenCanvas(
            SHEET_GAP + columns * (SHEET_CELL_WIDTH + SHEET_GAP),
            SHEET_GAP + Math.ceil(job.times.length / columns) * (cellHeight + SHEET_LABEL_HEIGHT + SHEET_GAP),
          )
        : undefined;
      const context = sheet?.getContext('2d');
      if (context) {
        context.fillStyle = '#16161a';
        context.fillRect(0, 0, sheet!.width, sheet!.height);
        context.font = `500 20px "${FONT_FAMILY}", sans-serif`;
        context.textBaseline = 'middle';
      }
      const unique = [...new Set(byTime)].sort((a, b) => a - b);
      for (const [done, frame] of unique.entries()) {
        const state = timeline.frameAt(frame / fps);
        renderer.render(state, await sources.sourcesFor(frame, state));
        if (gl.isContextLost()) throw new Error('the WebGL context was lost while rendering stills');
        const image = await png(canvas);
        for (const [n, frameOfTime] of byTime.entries()) {
          if (frameOfTime !== frame) continue;
          await host().writeStill(`still-${n}`, image);
          if (context) {
            const x = SHEET_GAP + (n % columns) * (SHEET_CELL_WIDTH + SHEET_GAP);
            const y = SHEET_GAP + Math.floor(n / columns) * (cellHeight + SHEET_LABEL_HEIGHT + SHEET_GAP);
            context.drawImage(canvas, x, y, SHEET_CELL_WIDTH, cellHeight);
            context.fillStyle = '#e8e8ea';
            context.fillText(`${job.times[n]!.toFixed(2)} s`, x, y + cellHeight + SHEET_LABEL_HEIGHT / 2);
          }
        }
        await sources.release(frame);
        host().progress(done + 1, unique.length);
      }
      if (sheet) await host().writeStill('sheet', await png(sheet));
      return { ok: true, stills: job.times.length, width, height, gpu: gpuName(gl), totalMs: Math.round(performance.now() - started) };
    },
  );
}

/** Runs the job the main process prepared; never throws, failures come back as `{ ok: false }`. */
export async function run(): Promise<PageResult> {
  try {
    const job = await host().job();
    return job.kind === 'stills' ? await renderStills(job) : await exportVideo(job);
  } catch (error) {
    // Unexpected errors keep their stack on stderr. The main process forwards page errors as text, so
    // spell them out (a DOMException would print as "[object DOMException]"); a V8 stack starts with
    // "Name: message", a DOMException may have none.
    if (!(error instanceof PageError)) {
      console.error(error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error));
    }
    return {
      ok: false,
      code: error instanceof PageError ? error.code : 'render',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
```

- [ ] **Step 5: `renderStills` in the main process**

`stills.ts` reuses the export's helpers, so `export.ts` exports them.

In `packages/export/src/main/export.ts`, replace:

```ts
import { CHANNELS, type EncoderPreference, type ExportJob, type PageResult, type PageSuccess } from '../job';
```

with:

```ts
import { CHANNELS, type EncoderPreference, type ExportJob, type PageResult, type PageStillsSuccess, type PageSuccess } from '../job';
```

In the same file, replace:

```ts
function defaultPageDir(): string {
  return fileURLToPath(new URL('./export-page/', import.meta.url));
}

const cancelledError = (): ExportError => new ExportError('cancelled', 'the export was cancelled');

/** A promise that rejects with `cancelled` when `signal` aborts; `dispose` removes the listener. */
function whenCancelled(signal: AbortSignal | undefined): { promise: Promise<never>; dispose(): void } {
```

with:

```ts
export function defaultPageDir(): string {
  return fileURLToPath(new URL('./export-page/', import.meta.url));
}

export const cancelledError = (): ExportError => new ExportError('cancelled', 'the export was cancelled');

/** A promise that rejects with `cancelled` when `signal` aborts; `dispose` removes the listener. */
export function whenCancelled(signal: AbortSignal | undefined): { promise: Promise<never>; dispose(): void } {
```

In the same file, replace:

```ts
function watchdog(): { progress(done: number): void; alive(): void; stalled: Promise<never>; stop(): void } {
```

with:

```ts
export function watchdog(): { progress(done: number): void; alive(): void; stalled: Promise<never>; stop(): void } {
```

In the same file, replace:

```ts
async function runPage(window: ExportWindow, ...failures: Promise<never>[]): Promise<PageSuccess> {
```

with:

```ts
export async function runPage<T extends PageSuccess | PageStillsSuccess>(window: ExportWindow, ...failures: Promise<never>[]): Promise<T> {
```

In the same file, replace:

```ts
  if (!result.ok) throw new ExportError(result.code, result.message);
  return result;
```

with:

```ts
  if (!result.ok) throw new ExportError(result.code, result.message);
  return result as T;
```

In the same file, replace:

```ts
  const job: ExportJob = {
    project,
```

with:

```ts
  const job: ExportJob = {
    kind: 'video',
    project,
```

In the same file, replace:

```ts
    const page = await runPage(window, guard.stalled, cancel.promise);
```

with:

```ts
    const page = await runPage<PageSuccess>(window, guard.stalled, cancel.promise);
```

`packages/export/src/main/stills.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import { ExportError } from '../errors';
import { withFormat, type ExportFormat } from '../formats';
import { CHANNELS, type PageStillsSuccess, type StillsJob } from '../job';
import { cancelledError, defaultPageDir, runPage, watchdog, whenCancelled } from './export';
import { FileHost } from './files';
import { loadSources } from './sources';
import { openExportWindow, type ExportWindow } from './window';

export interface StillsOptions {
  projectDir: string;
  /** Output preset; without one the project's `output` size is used. */
  format?: ExportFormat;
  /** Output seconds to render; a time past the end shows the last frame. */
  times: number[];
  /** Folder for the PNGs (created when missing; files with the same names are replaced). */
  outDir: string;
  /** Also writes `sheet.png`: every still, smaller, in a grid with its time (default 4 columns). */
  sheet?: { columns?: number };
  /** Called after each rendered frame. */
  onProgress?: (done: number, total: number) => void;
  /** Folder of the export page bundle; defaults to `export-page` next to the bundle that contains this code. */
  pageDir?: string;
  /** Cancels: the window closes and `renderStills` rejects with `cancelled`. */
  signal?: AbortSignal;
}

export interface StillsResult {
  /** One PNG per time, in the order of `times`. */
  stills: { t: number; file: string }[];
  sheet?: string;
  /** The output size (each still's size). */
  width: number;
  height: number;
  stats: { gpu: string; totalMs: number };
}

const DEFAULT_SHEET_COLUMNS = 4;
/** A PNG the page sends may not be larger than this. */
const MAX_PNG_BYTES = 256 * 1024 * 1024;

/** File name of the still for `times[n]`, e.g. `01-12.50s.png`. */
export function stillName(n: number, t: number): string {
  return `${String(n + 1).padStart(2, '0')}-${t.toFixed(2)}s.png`;
}

/**
 * Renders single output frames of a project to PNGs with the export's engine and decoders (for
 * checking a project without exporting it), optionally with a contact sheet. Runs in Electron's
 * main process, like `exportProject`.
 */
export async function renderStills(opts: StillsOptions): Promise<StillsResult> {
  const started = performance.now();
  if (opts.times.length === 0 || !opts.times.every((t) => Number.isFinite(t) && t >= 0)) {
    throw new ExportError('invalid-project', 'stills need at least one time, each 0 or more seconds');
  }
  await app.whenReady();
  const outDir = resolve(opts.outDir);
  const sources = await loadSources(resolve(opts.projectDir));
  for (const warning of sources.warnings) console.warn(`warning: ${warning}`);
  if (opts.signal?.aborted) throw cancelledError();
  const project = withFormat(sources.project, opts.format);
  const columns = opts.sheet ? Math.max(1, Math.round(opts.sheet.columns ?? DEFAULT_SHEET_COLUMNS)) : undefined;
  const job: StillsJob = {
    kind: 'stills',
    project,
    screen: sources.screen,
    webcam: sources.webcam,
    events: sources.events,
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    times: opts.times,
    ...(columns !== undefined && { sheet: { columns } }),
  };
  try {
    await mkdir(outDir, { recursive: true });
  } catch (error) {
    throw new ExportError('invalid-project', `cannot create the folder ${outDir}: ${(error as Error).message}`, { cause: error });
  }
  const files = new Map(opts.times.map((t, n) => [`still-${n}`, join(outDir, stillName(n, t))]));
  if (columns !== undefined) files.set('sheet', join(outDir, 'sheet.png'));

  const cancel = whenCancelled(opts.signal);
  const guard = watchdog();
  const images = [...Object.values(sources.stills), ...(sources.backgroundImage ? [sources.backgroundImage] : [])];
  // Reads only: stills mode writes PNGs through writeStill, never into a video file.
  const host = new FileHost([sources.screen, ...(sources.webcam ? [sources.webcam.path] : [])], join(outDir, '.unused'), images);
  let window: ExportWindow | undefined;
  try {
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    const ipc = window.win.webContents.ipc;
    ipc.handle(CHANNELS.job, () => job);
    ipc.handle(CHANNELS.size, (_event, path: string) => host.size(path));
    ipc.handle(CHANNELS.read, (_event, path: string, start: number, end: number) => {
      guard.alive();
      return host.read(path, start, end);
    });
    ipc.handle(CHANNELS.readFile, (_event, path: string) => host.readFile(path));
    ipc.handle(CHANNELS.write, () => {
      throw new Error('a stills job writes no video');
    });
    ipc.handle(CHANNELS.writeStill, async (_event, name: string, data: Uint8Array) => {
      const file = files.get(name);
      if (file === undefined || !(data instanceof Uint8Array) || data.byteLength > MAX_PNG_BYTES) {
        throw new Error(`the export page sent an unexpected still "${name}"`);
      }
      guard.alive();
      await writeFile(file, data);
    });
    ipc.on(CHANNELS.progress, (_event, done: number, total: number) => {
      guard.progress(done);
      opts.onProgress?.(done, total);
    });
    const page = await runPage<PageStillsSuccess>(window, guard.stalled, cancel.promise);
    return {
      stills: opts.times.map((t, n) => ({ t, file: files.get(`still-${n}`)! })),
      ...(columns !== undefined && { sheet: files.get('sheet')! }),
      width: page.width,
      height: page.height,
      stats: { gpu: page.gpu, totalMs: Math.round(performance.now() - started) },
    };
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('render', error instanceof Error ? error.message : String(error), { cause: error });
  } finally {
    guard.stop();
    cancel.dispose();
    if (window && !window.win.isDestroyed()) window.win.destroy();
    await host.close();
  }
}
```

In `packages/export/src/index.ts`, replace:

```ts
export type { EncoderPreference, ExportErrorCode } from './job';
```

with:

```ts
export type { EncoderPreference, ExportErrorCode } from './job';
export { renderStills, stillName, type StillsOptions, type StillsResult } from './main/stills';
```

- [ ] **Step 6: Tests and typecheck**

`renderStills` needs Electron; Task 6 runs it end to end through `cuttle preview`.

Run: `pnpm exec vitest run --project node packages/export`
Expected: PASS, 48 tests in 8 files (the export tests that run in Node).

Run: `pnpm exec tsc -p packages/export/tsconfig.json && pnpm exec tsc -p packages/export/tsconfig.node.json`
Expected: exits with code 0, no output.

- [ ] **Step 7: Commit**

```bash
git add packages/export
git commit -m "export: renderStills, PNGs of single output frames and a contact sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The CLI package and its shared parts

The package, and what every command uses: errors with exit codes, the output (`--json` or text), `cuttle.json` as written, pointing a project at a take, and running ffmpeg. The commands in Tasks 4 and 5 exercise them; `cli.test.ts` (Task 5) covers them through the commands.

**Files:**
- Create: `apps/cli/package.json`, `apps/cli/tsconfig.json`, `apps/cli/src/errors.ts`, `apps/cli/src/output.ts`, `apps/cli/src/project-file.ts`, `apps/cli/src/use-take.ts`, `apps/cli/src/ffmpeg.ts`
- Modify: `package.json` (typecheck), `vitest.config.ts`, `pnpm-lock.yaml`

- [ ] **Step 1: The package**

`apps/cli/package.json`:

```json
{
  "name": "@cuttle/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@cuttle/export": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/recorder": "workspace:*",
    "@cuttle/timeline": "workspace:*",
    "commander": "15.0.0",
    "koffi": "3.3.2",
    "uiohook-napi": "1.5.5"
  }
}
```

`apps/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  // The Node CLI, the Electron entry for render, preview and capture-page, their tests, the build and install scripts.
  "include": ["src", "test", "scripts", "vite.config.ts"]
}
```

`pnpm-workspace.yaml` already lists `apps/*` and allows koffi and uiohook-napi to load without install scripts.

Run: `pnpm install`
Expected: exits with code 0; `pnpm-lock.yaml` gains the importer `apps/cli` and `commander@15.0.0`.

In `package.json`, replace:

```json
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json && tsc -p packages/recorder/tsconfig.json",
```

with:

```json
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json && tsc -p packages/recorder/tsconfig.json && tsc -p apps/cli/tsconfig.json",
```

In `vitest.config.ts`, replace:

```ts
          include: ['packages/*/test/**/*.test.ts'],
```

with:

```ts
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
```

- [ ] **Step 2: Errors and output**

`apps/cli/src/errors.ts`:

```ts
/**
 * Exit codes (spec): 0 ok, 1 usage or validation, 2 device or permission, 3 render; 130 when stopped
 * with Ctrl+C before anything was recorded or rendered.
 */
export const EXIT = { ok: 0, usage: 1, device: 2, render: 3, cancelled: 130 } as const;

/** Error codes of the recorder and the export, and the CLI's own, with their exit codes. */
const EXIT_CODES: Record<string, number> = {
  // CLI
  usage: EXIT.usage,
  'invalid-project': EXIT.usage,
  // @cuttle/recorder
  'invalid-options': EXIT.usage,
  'device-not-found': EXIT.device,
  'ffmpeg-missing': EXIT.device,
  capture: EXIT.device,
  'unsupported-platform': EXIT.device,
  cancelled: EXIT.cancelled,
  // @cuttle/export
  'missing-file': EXIT.usage,
  'invalid-media': EXIT.usage,
  render: EXIT.render,
};

/** A failure the CLI reports with a code and an exit code. */
export class CliError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CliError';
    this.code = code;
  }

  get exitCode(): number {
    return EXIT_CODES[this.code] ?? EXIT.usage;
  }
}

/** Whether `code` is one the CLI maps to an exit code. */
export function isKnownCode(code: string): boolean {
  return code in EXIT_CODES;
}

/** Any error as a CliError: errors with a known `code` keep it, anything else is an internal error. */
export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (code !== undefined && code in EXIT_CODES) return new CliError(code, message, { cause: error });
  return new CliError('internal', error instanceof Error && error.stack ? error.stack : message, { cause: error });
}
```

`apps/cli/src/output.ts`:

```ts
import type { CliError } from './errors';

/**
 * Where a command reports: with `--json`, stdout carries exactly one JSON document (the result, or
 * `{ "error": { code, message } }`) and everything else goes to stderr; without it, stdout gets text
 * for people. Progress and live status always go to stderr.
 */
export interface Output {
  json: boolean;
  /** The command's result: `value` as JSON, or `text()` for people. */
  result(value: unknown, text: () => string): void;
  /** Status for people while a command runs (stderr; quiet with --json unless it is a warning). */
  info(text: string): void;
  warn(text: string): void;
  error(error: CliError): void;
}

export interface Streams {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processStreams: Streams = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
};

export function createOutput(json: boolean, streams: Streams = processStreams): Output {
  return {
    json,
    result(value, text) {
      streams.stdout(json ? `${JSON.stringify(value, null, 2)}\n` : `${text()}\n`);
    },
    info(text) {
      if (!json) streams.stderr(`${text}\n`);
    },
    warn(text) {
      streams.stderr(`warning: ${text}\n`);
    },
    error(error) {
      if (json) streams.stdout(`${JSON.stringify({ error: { code: error.code, message: error.message } }, null, 2)}\n`);
      else streams.stderr(`error: ${error.message}\n`);
    },
  };
}
```

- [ ] **Step 3: The project file, takes and ffmpeg**

`apps/cli/src/project-file.ts`:

```ts
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CURRENT_VERSION, parseProject, parseProjectJson, type CuttleProject } from '@cuttle/project';
import { CliError } from './errors';

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
}

const issuesText = (issues: readonly { path: string; message: string }[]) => issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');

export async function readProjectFile(projectDir: string): Promise<ProjectFile> {
  const dir = resolve(projectDir);
  const path = join(dir, PROJECT_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError('invalid-project', `${path} does not exist; run "cuttle init" or "cuttle record" in the project folder (or pass -C <dir>)`);
    }
    throw new CliError('invalid-project', `cannot read ${path}: ${(error as Error).message}`, { cause: error });
  }
  const parsed = parseProjectJson(text);
  if (!parsed.ok) throw new CliError('invalid-project', `${path} is not a valid project:\n${issuesText(parsed.issues)}`);
  const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>;
  return { dir, path, raw, project: parsed.project };
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
 * Checks `file.raw` again and writes it (temp file and rename, so a crash never leaves half a file),
 * creating the project folder when it is new.
 */
export async function writeProjectFile(file: ProjectFile): Promise<ProjectFile> {
  const project = parse(file.raw);
  await mkdir(file.dir, { recursive: true });
  const temp = `${file.path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(file.raw, null, 2)}\n`);
  await rename(temp, file.path);
  return { ...file, project };
}

function parse(raw: unknown): CuttleProject {
  const parsed = parseProject(raw);
  if (!parsed.ok) throw new CliError('invalid-project', `the edited project is not valid:\n${issuesText(parsed.issues)}`);
  return parsed.project;
}
```

`apps/cli/src/use-take.ts`:

```ts
import { copyFile } from 'node:fs/promises';
import type { ProjectFile } from './project-file';

/** A take's files, relative to the project folder, and the screen track's length. */
export interface TakeFiles {
  screen: string;
  webcam?: string;
  mic?: string;
  events?: string;
  markers?: string;
  seconds: number;
}

/**
 * Points the project at a take: `sources` names its files and the take becomes one clip scene. A
 * project is one take: scenes, zooms, masks and texts of the previous take refer to its source
 * times, so they are dropped, and the previous cuttle.json is kept as cuttle.json.bak when it had any.
 * Returns the backup's path, if one was written.
 */
export async function useTake(file: ProjectFile, take: TakeFiles): Promise<string | undefined> {
  const { scenes, zooms, masks, texts } = file.project;
  let backup: string | undefined;
  if (scenes.length + zooms.length + masks.length + texts.length > 0) {
    backup = `${file.path}.bak`;
    await copyFile(file.path, backup);
  }
  file.raw.sources = {
    screen: take.screen,
    ...(take.webcam && { webcam: take.webcam }),
    ...(take.mic && { mic: take.mic }),
    ...(take.events && { events: take.events }),
    ...(take.markers && { markers: take.markers }),
  };
  // Milliseconds rounded down: the clip must end inside the screen track.
  file.raw.scenes = [{ type: 'clip', from: 0, to: Math.floor(take.seconds * 1000) / 1000 }];
  delete file.raw.zooms;
  delete file.raw.masks;
  delete file.raw.texts;
  return backup;
}
```

`apps/cli/src/ffmpeg.ts`:

```ts
import { spawn } from 'node:child_process';
import { CliError } from './errors';

/** The ffmpeg executable: `CUTTLE_FFMPEG` when set, otherwise `ffmpeg` from PATH. */
export function ffmpegPath(): string {
  return process.env.CUTTLE_FFMPEG || 'ffmpeg';
}

/** Runs ffmpeg and returns stdout (bytes) and stderr (text); a non-zero exit is a CliError with the end of the log. */
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
          ? new CliError('ffmpeg-missing', `ffmpeg was not found (looked for "${ffmpegPath()}"). Install it (Windows: winget install Gyan.FFmpeg) or set CUTTLE_FFMPEG.`)
          : error,
      ),
    );
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout: Buffer.concat(out), stderr });
      const tail = stderr.trim().split(/\r?\n/).slice(-8).join('\n');
      reject(new CliError('invalid-media', `ffmpeg failed (exit code ${code}):\n${tail}`));
    });
  });
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc -p apps/cli/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 5: Commit**

```bash
git add apps/cli package.json vitest.config.ts pnpm-lock.yaml
git commit -m "cli: the package, errors with exit codes, output, the project file

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: What `suggest` is made of

Pure rules over spans of the take, the ffmpeg reads they need, the zoom box and markers from Claude Code's transcripts. `cuttle suggest` (Task 5) puts them together.

**Files:**
- Create: `apps/cli/src/suggest/spans.ts`, `apps/cli/src/suggest/plan.ts`, `apps/cli/src/suggest/media.ts`, `apps/cli/src/suggest/region.ts`, `apps/cli/src/suggest/transcript.ts`
- Test: `apps/cli/test/suggest.test.ts`, `apps/cli/test/transcript.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/cli/test/suggest.test.ts`:

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
      { from: 1, to: 4.3, speed: 1 },
      { from: 4.3, to: 38.5, speed: 8 },
      { from: 38.5, to: 42.5, speed: 1 },
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
    expect(result.clips).toEqual([
      { from: 4.5, to: 5.5, speed: 1 },
      { from: 5.5, to: 151.1, speed: 12 },
      { from: 151.1, to: 153.3, speed: 1 },
    ]);
    expect(result.notes.some((note) => note.startsWith('cut'))).toBe(false);
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
  });
});
```

`apps/cli/test/transcript.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { claudeTranscriptDir } from '@cuttle/recorder';
import { transcriptMarkers } from '../src/suggest/transcript';

const config = mkdtempSync(join(tmpdir(), 'cuttle-transcript-'));
afterAll(() => rm(config, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

/** A line at `start + t` seconds. */
const at = (t: number, value: object) => `${JSON.stringify({ timestamp: new Date((1000 + t) * 1000).toISOString(), ...value })}\n`;
const prompt = (t: number) => at(t, { type: 'user', message: { content: 'build it' } });
const tool = (t: number, id: string, name: string) => at(t, { type: 'assistant', message: { id: `m${id}`, stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name }] } });
const answer = (t: number, id: string) => at(t, { type: 'assistant', message: { id, stop_reason: 'end_turn', content: [{ type: 'text' }] } });

describe('transcriptMarkers', () => {
  it("takes the session that was busiest during the take, in the take's seconds", async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', config);
    const cwd = join(config, 'demo');
    const dir = claudeTranscriptDir(cwd);
    mkdirSync(dir, { recursive: true });
    // The demo session: a local /model before the prompt, a tool call, the answer split over two lines.
    writeFileSync(
      join(dir, 'demo.jsonl'),
      [
        prompt(-30), // before the take
        at(1, { type: 'user', message: { content: '<command-name>/model</command-name>' } }),
        at(1.1, { type: 'user', message: { content: '<local-command-stdout>Set model</local-command-stdout>' } }),
        prompt(2),
        tool(4, 't1', 'Bash'),
        answer(9, 'a1'),
        answer(9, 'a1'),
        prompt(70), // after the take
      ].join(''),
    );
    writeFileSync(join(dir, 'other.jsonl'), answer(5, 'o1'));
    expect(await transcriptMarkers(cwd, 1000, 60)).toEqual([
      { t: 2, kind: 'prompt' },
      { t: 4, kind: 'tool', label: 'Bash' },
      { t: 9, kind: 'answer' },
    ]);
  });

  it('finds nothing in a folder without transcripts', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', config);
    expect(await transcriptMarkers(join(config, 'nowhere'), 1000, 60)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `pnpm exec vitest run apps/cli/test/suggest.test.ts apps/cli/test/transcript.test.ts`
Expected: FAIL, both suites cannot load (`Cannot find module '../src/suggest/media'` and `'../src/suggest/transcript'`), `Tests  no tests`.

- [ ] **Step 3: Spans and the rules**

`apps/cli/src/suggest/spans.ts`:

```ts
/** A stretch of source time, `from` < `to`, in seconds. */
export interface Span {
  from: number;
  to: number;
}

/** The spans sorted and merged where they overlap or touch. */
export function union(spans: readonly Span[]): Span[] {
  const sorted = spans.filter((span) => span.to > span.from).sort((a, b) => a.from - b.from);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}

/** The parts of `[from, to)` that `spans` do not cover. */
export function gaps(spans: readonly Span[], from: number, to: number): Span[] {
  const result: Span[] = [];
  let at = from;
  for (const span of union(spans)) {
    if (span.to <= at) continue;
    if (span.from >= to) break;
    if (span.from > at) result.push({ from: at, to: Math.min(span.from, to) });
    at = Math.max(at, span.to);
  }
  if (at < to) result.push({ from: at, to });
  return result;
}

export const length = (span: Span): number => span.to - span.from;
```

`apps/cli/src/suggest/plan.ts`:

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
  return { clips: clips.map((clip) => ({ from: ms(clip.from), to: ms(clip.to), speed: clip.speed })), notes, ...(answer !== undefined && { answer }) };
}

/** `kept` as 1× clips, with every long stretch without input sped up. */
function withSpeedUps(kept: Span, inputSpans: readonly Span[], answer: number | undefined, notes: string[]): SuggestedClip[] {
  const fast: SuggestedClip[] = [];
  for (const wait of gaps(inputSpans, kept.from, kept.to)) {
    if (length(wait) < RULES.waitMin) continue;
    const inner = { from: wait.from + RULES.waitKeep, to: wait.to - RULES.waitKeep };
    if (answer !== undefined && answer > inner.from && answer < wait.to) inner.to = Math.min(inner.to, answer - RULES.answerLead);
    const target = Math.min(RULES.waitLongest, Math.max(RULES.waitShortest, length(inner) * RULES.waitShare));
    const speed = SPEEDS.filter((candidate) => candidate <= length(inner) / target).at(-1);
    if (speed === undefined) continue;
    fast.push({ ...inner, speed });
    notes.push(`sped up ${length(inner).toFixed(1)} s without input ${speed}× (${range(inner)})`);
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

- [ ] **Step 4: ffmpeg reads and the zoom box**

`apps/cli/src/suggest/media.ts`:

```ts
// What suggest needs from the screen track, read with ffmpeg.
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

/**
 * Seconds of the first video (`v`) or audio (`a`) stream of a file, read by copying its packets
 * (fast: nothing is decoded); 0 when the file has no such stream or nothing readable.
 */
export async function streamSeconds(path: string, stream: 'v' | 'a'): Promise<number> {
  try {
    const { stderr } = await runFfmpeg(['-i', path, '-map', `0:${stream}:0`, '-c', 'copy', '-f', 'null', '-']);
    const last = [...stderr.matchAll(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)].at(-1);
    return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : 0;
  } catch {
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

`apps/cli/src/suggest/region.ts`:

```ts
// Where the screen changed between two moments: the zoom on Claude's answer.
import type { Rect } from '@cuttle/project';
import type { Gray } from './media';

/** A pixel counts as changed when its grey value moved more than this. */
const THRESHOLD = 24;
/** Fewer changed pixels than this share of the picture is noise (a caret, a clock). */
const MIN_SHARE = 0.002;
/** The box spans the changed pixels from this quantile to its complement, so stray pixels do not stretch it. */
const QUANTILE = 0.02;

/** The box (in the grey pictures' pixels) around what changed between `before` and `after`. */
export function changedRegion(before: Gray, after: Gray): { x: number; y: number; width: number; height: number } | undefined {
  if (before.width !== after.width || before.height !== after.height) return undefined;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < before.width; x++) {
      const i = y * before.width + x;
      if (Math.abs(before.data[i]! - after.data[i]!) > THRESHOLD) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length < MIN_SHARE * before.width * before.height) return undefined;
  const bounds = (values: number[]) => {
    values.sort((a, b) => a - b);
    const low = values[Math.floor(QUANTILE * (values.length - 1))]!;
    const high = values[Math.ceil((1 - QUANTILE) * (values.length - 1))]!;
    return [low, high] as const;
  };
  const [x0, x1] = bounds(xs);
  const [y0, y1] = bounds(ys);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Padding around the changed box, as a share of the screen's width. */
const PADDING = 0.06;
/** A zoom shows at least this share of the screen's width. */
const MIN_WIDTH = 0.35;
/** Above this share of the screen's area a zoom is no focus at all: none is made. */
const MAX_AREA = 0.75;

/**
 * The zoom rect (screen pixels) for a changed box found in grey pictures `grayWidth` pixels wide,
 * padded and at least `MIN_WIDTH` wide, inside the screen; undefined when it would cover most of it.
 * The timeline fits it to the screen's aspect.
 */
export function zoomRect(region: { x: number; y: number; width: number; height: number }, grayWidth: number, screen: { width: number; height: number }): Rect | undefined {
  const scale = screen.width / grayWidth;
  const pad = PADDING * screen.width;
  let x = region.x * scale - pad;
  let y = region.y * scale - pad;
  let width = region.width * scale + 2 * pad;
  let height = region.height * scale + 2 * pad;
  if (width < MIN_WIDTH * screen.width) {
    x -= (MIN_WIDTH * screen.width - width) / 2;
    width = MIN_WIDTH * screen.width;
  }
  width = Math.min(width, screen.width);
  height = Math.min(height, screen.height);
  x = Math.min(Math.max(0, x), screen.width - width);
  y = Math.min(Math.max(0, y), screen.height - height);
  if (width * height > MAX_AREA * screen.width * screen.height) return undefined;
  return [Math.round(x), Math.round(y), Math.round(width), Math.round(height)];
}
```

- [ ] **Step 5: Markers from the transcript**

`apps/cli/src/suggest/transcript.ts`:

```ts
// Markers for a take that has none from Claude Code (recorded without untilClaude, or before the
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
  for (const name of names) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => '');
    const seen = new Set<string>();
    const reader = new SessionReader();
    const markers: Marker[] = [];
    for (const line of text.split('\n')) {
      for (const signal of reader.read(line)) {
        const t = signal.time - start;
        if (t < 0 || t > duration || duplicate(signal, seen)) continue;
        markers.push({ t: Math.round(t * 1000) / 1000, kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) });
      }
    }
    if (markers.length > best.length) best = markers;
  }
  return best.sort((a, b) => a.t - b.t);
}

function duplicate(signal: ClaudeSignal, seen: Set<string>): boolean {
  if (signal.id === undefined) return false;
  const key = `${signal.kind}:${signal.id}`;
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run apps/cli/test/suggest.test.ts apps/cli/test/transcript.test.ts`
Expected: PASS, 12 tests.

Run: `pnpm exec tsc -p apps/cli/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 7: Commit**

```bash
git add apps/cli
git commit -m "cli: the suggest rules, ffmpeg reads, the zoom box, transcript markers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Electron side: render, preview, capture-page

The Node CLI spawns Electron with one request and talks to it over IPC. Electron's entry is a bootstrap that installs the error handler before anything else loads.

**Files:**
- Create: `apps/cli/src/electron/protocol.ts`, `apps/cli/src/electron/finish.ts`, `apps/cli/src/electron/bootstrap.ts`, `apps/cli/src/electron/main.ts`, `apps/cli/src/electron/capture-page.ts`, `apps/cli/src/electron-runner.ts`, `apps/cli/src/commands/render.ts`, `apps/cli/src/commands/preview.ts`, `apps/cli/src/commands/capture-page.ts`

- [ ] **Step 1: The protocol and Electron's side**

`apps/cli/src/electron/protocol.ts`:

```ts
// How the Node CLI and its Electron process talk: the request is one base64 JSON argument; the
// answer and a cancel go over Node's IPC channel (Electron's main process reads no stdin on
// Windows, and the console's Ctrl+C does not reach it). Pure: both sides import it.

export type ElectronRequest =
  | { command: 'render'; projectDir: string; out: string; format?: string; encoder?: string }
  | { command: 'preview'; projectDir: string; outDir: string; times: number[]; format?: string; sheet?: { columns?: number } }
  | { command: 'capture-page'; target: string; out: string; width: number; height: number; fullPage: boolean; waitMs: number };

export type ElectronResponse = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } };

/** Electron → CLI. */
export interface ResponseMessage {
  type: 'response';
  response: ElectronResponse;
}

/** CLI → Electron: stop the job and clean up (Ctrl+C). */
export interface CancelMessage {
  type: 'cancel';
}

export function encodeRequest(request: ElectronRequest): string {
  return Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
}

export function decodeRequest(argument: string): ElectronRequest {
  return JSON.parse(Buffer.from(argument, 'base64').toString('utf8')) as ElectronRequest;
}
```

`apps/cli/src/electron/finish.ts`:

```ts
import { app } from 'electron';
import type { ElectronResponse, ResponseMessage } from './protocol';

/** Sends the answer to the CLI and exits once it is on its way. */
export function finish(response: ElectronResponse, exitCode = 0): void {
  if (!process.send) {
    process.stderr.write(`${JSON.stringify(response)}\n`); // started by hand, without the CLI
    app.exit(exitCode);
    return;
  }
  process.send({ type: 'response', response } satisfies ResponseMessage, () => app.exit(exitCode));
}

/** A failure as an answer; errors with a string `code` (ExportError, CaptureError) keep it. */
export function failure(error: unknown): ElectronResponse {
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'render';
  return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error) } };
}
```

`apps/cli/src/electron/bootstrap.ts`:

```ts
// Entry of the CLI's Electron process (dist/electron.mjs). It only installs the error handler and
// then loads the rest: an error while the bundle's modules load would otherwise show Electron's
// modal dialog instead of reaching the CLI.
import { failure, finish } from './finish';

// Electron's default for an uncaught exception is a modal dialog; a CLI must answer and exit instead.
process.on('uncaughtException', (error) => finish(failure(error), 1));
import('./main').catch((error: unknown) => finish(failure(error), 1));
```

`apps/cli/src/electron/capture-page.ts`:

```ts
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow } from 'electron';

export interface CaptureOptions {
  /** An http(s) URL or a local file. */
  target: string;
  /** PNG to write. */
  out: string;
  /** Viewport in CSS pixels; the PNG has these pixels (device scale 1). */
  width: number;
  height: number;
  /** The whole page (for a scrolling still) instead of the viewport. */
  fullPage: boolean;
  /** Time after the page loaded, for fonts, maps and animations. */
  waitMs: number;
}

export interface CaptureResult {
  file: string;
  width: number;
  height: number;
}

/** Chromium cannot capture taller pictures in one go; longer pages are cut here. */
export const MAX_PAGE_HEIGHT = 16_384;
const LOAD_TIMEOUT_MS = 30_000;
const CAPTURE_TIMEOUT_MS = 20_000;

export class CaptureError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

/**
 * A page as a PNG. The window renders offscreen: a hidden on-screen window paints a still page only
 * once, and a screenshot then waits for a frame that never comes. The size comes from a
 * device-metrics override at scale 1 and a clip, not from the window, whose pixels depend on the
 * display's scale.
 */
export async function capturePage(options: CaptureOptions): Promise<CaptureResult> {
  const url = /^https?:\/\//i.test(options.target) ? options.target : fileUrl(options.target);
  const win = new BrowserWindow({
    show: false,
    width: options.width,
    height: options.height,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await withTimeout(win.loadURL(url), LOAD_TIMEOUT_MS, `${options.target} did not load within ${LOAD_TIMEOUT_MS / 1000} s`).catch((error: Error) => {
      throw error instanceof CaptureError ? error : new CaptureError('invalid-media', `cannot load ${options.target}: ${error.message}`);
    });
    await new Promise((done) => setTimeout(done, options.waitMs));
    const debug = win.webContents.debugger;
    debug.attach('1.3');
    const viewport = (height: number) =>
      debug.sendCommand('Emulation.setDeviceMetricsOverride', { width: options.width, height, deviceScaleFactor: 1, mobile: false });
    await viewport(options.height);
    let height = options.height;
    if (options.fullPage) {
      const scrollHeight = (await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)')) as number;
      height = Math.min(MAX_PAGE_HEIGHT, Math.max(options.height, scrollHeight));
      await viewport(height);
    }
    await new Promise((done) => setTimeout(done, 300)); // layout and paint at the final size
    const shot = (await withTimeout(
      debug.sendCommand('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: options.width, height, scale: 1 } }),
      CAPTURE_TIMEOUT_MS,
      `the capture of ${options.target} did not finish within ${CAPTURE_TIMEOUT_MS / 1000} s`,
    )) as { data: string };
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, Buffer.from(shot.data, 'base64'));
    return { file: options.out, width: options.width, height };
  } finally {
    win.destroy();
  }
}

function fileUrl(target: string): string {
  const path = resolve(target);
  if (!existsSync(path)) throw new CaptureError('usage', `${path} does not exist (give a file or an http(s) URL)`);
  return pathToFileURL(path).href;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new CaptureError('invalid-media', message)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

`apps/cli/src/electron/main.ts`:

```ts
// The CLI's Electron process: renders, previews and page captures (Chromium has WebGL2 and
// WebCodecs). Started by the Node CLI (electron-runner.ts) with one base64 JSON request and an IPC
// channel, which carries the answer back and a cancel in; progress and warnings go to stderr.
// Loaded by bootstrap.ts, which handles uncaught exceptions.
import { app } from 'electron';
import { exportProject, isExportFormat, renderStills, type EncoderPreference, type ExportFormat } from '@cuttle/export';
import { capturePage } from './capture-page';
import { failure, finish } from './finish';
import { decodeRequest, type CancelMessage, type ElectronRequest, type ElectronResponse } from './protocol';

// The export window is the app's only window; closing it must not quit before the job is done.
app.on('window-all-closed', () => {});
// The CLI cancels over IPC (Ctrl+C in its console never reaches this process on Windows); a signal
// does the same where one arrives. A second one exits at once.
const cancel = new AbortController();
const onCancel = () => {
  if (cancel.signal.aborted) app.exit(130);
  cancel.abort();
};
process.on('message', (message: CancelMessage) => message?.type === 'cancel' && onCancel());
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(signal, onCancel);

/** Progress for people on stderr, every 10 %. */
function progress(label: string): (done: number, total: number) => void {
  let shown = -1;
  return (done, total) => {
    const percent = Math.floor((done / total) * 10) * 10;
    if (percent === shown) return;
    shown = percent;
    process.stderr.write(`${label} ${done}/${total}\n`);
  };
}

function exportFormat(format: string | undefined): { format?: ExportFormat } {
  if (format === undefined) return {};
  if (!isExportFormat(format)) throw Object.assign(new Error(`unknown format "${format}" (16:9, 1:1 or 9:16)`), { code: 'usage' });
  return { format };
}

async function handle(request: ElectronRequest): Promise<unknown> {
  switch (request.command) {
    case 'render':
      return exportProject({
        projectDir: request.projectDir,
        out: request.out,
        ...exportFormat(request.format),
        ...(request.encoder !== undefined && { encoder: request.encoder as EncoderPreference }),
        signal: cancel.signal,
        onProgress: progress('frames'),
      });
    case 'preview':
      return renderStills({
        projectDir: request.projectDir,
        outDir: request.outDir,
        times: request.times,
        ...exportFormat(request.format),
        ...(request.sheet && { sheet: request.sheet }),
        signal: cancel.signal,
        onProgress: progress('stills'),
      });
    case 'capture-page':
      return capturePage(request);
  }
}

app.whenReady().then(async () => {
  let response: ElectronResponse;
  try {
    response = { ok: true, result: await handle(decodeRequest(process.argv.at(-1) ?? '')) };
  } catch (error) {
    response = failure(error);
  }
  finish(response);
});
```

- [ ] **Step 2: The runner and the three commands**

`apps/cli/src/electron-runner.ts`:

```ts
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError, isKnownCode } from './errors';
import { encodeRequest, type CancelMessage, type ElectronRequest, type ElectronResponse, type ResponseMessage } from './electron/protocol';

/** After Ctrl+C, Electron gets this long to clean up before it is killed. */
const CANCEL_GRACE_MS = 15_000;

/** The Electron entry that sits next to the bundled CLI (dist/electron.mjs). */
function electronEntry(): string {
  const entry = fileURLToPath(new URL('./electron.mjs', import.meta.url));
  if (!existsSync(entry)) throw new CliError('internal', `the Electron part of the CLI is missing (${entry}); run "pnpm cli:build"`);
  return entry;
}

/**
 * The Electron binary. `require('electron')` would return its path, but Electron downloads the
 * binary on first use and announces that on stdout, which belongs to --json: so the CLI reads the
 * path itself (the package's path.txt names the executable inside dist/) and, when the binary is
 * missing, runs Electron's installer with its output on stderr.
 */
function electronBinary(): string {
  let dir: string;
  try {
    dir = dirname(createRequire(import.meta.url).resolve('electron/package.json'));
  } catch (error) {
    throw new CliError('internal', `Electron is not installed next to the CLI: ${(error as Error).message}`, { cause: error });
  }
  const binary = (): string | undefined => {
    const name = existsSync(join(dir, 'path.txt')) ? readFileSync(join(dir, 'path.txt'), 'utf8').trim() : '';
    return name !== '' && existsSync(join(dir, 'dist', name)) ? join(dir, 'dist', name) : undefined;
  };
  const found = binary();
  if (found !== undefined) return found;
  process.stderr.write('downloading Electron (once) …\n');
  const install = spawnSync(process.execPath, [join(dir, 'install.js')], { stdio: ['ignore', 2, 2], windowsHide: true });
  const installed = binary();
  if (install.status !== 0 || installed === undefined) {
    throw new CliError('internal', `Electron could not be downloaded; run "node ${join(dir, 'install.js')}" and try again`);
  }
  return installed;
}

/**
 * Runs a render, preview or page capture in Electron (Chromium: WebGL2, WebCodecs) and returns its
 * result. Electron's output (progress, warnings) goes to stderr, so stdout stays free for --json.
 * `signal` (Ctrl+C) sends a cancel over the IPC channel: Electron runs without a console, so the
 * console's Ctrl+C never reaches it on Windows. After a grace period Electron is killed.
 */
export function runInElectron<T>(request: ElectronRequest, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(electronBinary(), [electronEntry(), encodeRequest(request)], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'], windowsHide: true });
    child.stdout?.pipe(process.stderr);
    let response: ElectronResponse | undefined;
    child.on('message', (message: ResponseMessage) => {
      if (message?.type === 'response') response = message.response;
    });
    let grace: NodeJS.Timeout | undefined;
    const onAbort = () => {
      if (child.connected) child.send({ type: 'cancel' } satisfies CancelMessage, () => {});
      grace = setTimeout(() => child.kill(), CANCEL_GRACE_MS);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (error) => reject(new CliError('internal', `Electron could not start: ${error.message}`, { cause: error })));
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      clearTimeout(grace);
      if (response === undefined) {
        reject(new CliError(signal.aborted ? 'cancelled' : 'render', `Electron exited (code ${code}) without a result`));
      } else if (response.ok) {
        resolve(response.result as T);
      } else {
        // Electron's own failures (a module that did not load, a crash in Chromium) count as render errors.
        const { code, message } = response.error;
        reject(new CliError(isKnownCode(code) ? code : 'render', message));
      }
    });
  });
}
```

`apps/cli/src/commands/render.ts`:

```ts
import { join, resolve } from 'node:path';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '../project-file';

export interface RenderArgs {
  format?: string;
  out?: string;
  encoder?: string;
}

/** What @cuttle/export's exportProject returns (the CLI does not import the Electron package). */
export interface RenderResult {
  out: string;
  frames: number;
  seconds: number;
  stats: { gpu: string; codec: string; hardwareAcceleration: string; bitrate: number; totalMs: number } & Record<string, unknown>;
}

/** `cuttle render`: the project as an MP4 (default out/<format>.mp4 in the project). */
export async function renderCommand(projectDir: string, args: RenderArgs, output: Output, signal: AbortSignal): Promise<RenderResult> {
  const file = await readProjectFile(projectDir); // fails fast, before Electron starts, on a broken project
  const out = args.out ? resolve(args.out) : join(file.dir, 'out', `${(args.format ?? 'export').replace(':', 'x')}.mp4`);
  output.info(`rendering ${out} …`);
  const result = await runInElectron<RenderResult>(
    {
      command: 'render',
      projectDir: file.dir,
      out,
      ...(args.format !== undefined && { format: args.format }),
      ...(args.encoder !== undefined && { encoder: args.encoder }),
    },
    signal,
  );
  output.result(result, () => `rendered ${result.out}: ${result.frames} frames, ${result.seconds.toFixed(2)} s, in ${(result.stats.totalMs / 1000).toFixed(1)} s`);
  return result;
}
```

`apps/cli/src/commands/preview.ts`:

```ts
import { join, resolve } from 'node:path';
import { sceneSpans, totalDuration } from '@cuttle/timeline';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '../project-file';

export interface PreviewArgs {
  /** Output seconds; without them, a sheet of `SHEET_STILLS` evenly spaced stills. */
  at?: number[];
  sheet?: boolean;
  format?: string;
  /** Folder for the PNGs (default preview/ in the project). */
  out?: string;
}

/** What @cuttle/export's renderStills returns. */
export interface PreviewResult {
  stills: { t: number; file: string }[];
  sheet?: string;
  width: number;
  height: number;
  stats: { gpu: string; totalMs: number };
}

/** Stills of a default contact sheet. */
export const SHEET_STILLS = 12;

/** `cuttle preview`: PNG stills of the output, and a contact sheet, for checking a project. */
export async function previewCommand(projectDir: string, args: PreviewArgs, output: Output, signal: AbortSignal): Promise<PreviewResult> {
  const file = await readProjectFile(projectDir);
  const duration = totalDuration(sceneSpans(file.project.scenes));
  if (duration <= 0) throw new CliError('invalid-project', `${file.path} has no scenes yet; run "cuttle suggest" or add scenes`);
  const times = args.at && args.at.length > 0 ? args.at : Array.from({ length: SHEET_STILLS }, (_, i) => Math.round(((i + 0.5) * duration * 1000) / SHEET_STILLS) / 1000);
  const bad = times.find((t) => !Number.isFinite(t) || t < 0);
  if (bad !== undefined) throw new CliError('usage', `--at takes output seconds of 0 or more (got ${bad})`);
  const sheet = args.sheet ?? !(args.at && args.at.length > 0);
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview');
  output.info(`rendering ${times.length} still(s) into ${outDir} …`);
  const result = await runInElectron<PreviewResult>(
    { command: 'preview', projectDir: file.dir, outDir, times, ...(args.format !== undefined && { format: args.format }), ...(sheet && { sheet: {} }) },
    signal,
  );
  output.result(result, () =>
    [...result.stills.map((still) => `${still.t.toFixed(2)} s  ${still.file}`), ...(result.sheet ? [`sheet  ${result.sheet}`] : [])].join('\n'),
  );
  return result;
}
```

`apps/cli/src/commands/capture-page.ts`:

```ts
import { basename, extname, join, relative, sep } from 'node:path';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile, writeProjectFile } from '../project-file';

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
    { command: 'capture-page', target, out, width: Math.round(width), height: Math.round(height), fullPage: args.scroll ?? false, waitMs: Math.round(args.wait ?? 1000) },
    signal,
  );
  let scene: CaptureResult['scene'];
  if (args.add) {
    scene = {
      type: 'still',
      image: relative(file.dir, out).split(sep).join('/'),
      duration: args.duration ?? DEFAULT_SCENE_SECONDS,
      motion: args.scroll ? 'scroll' : 'none',
      frame: 'browser-light',
    };
    file.raw.scenes = [...((file.raw.scenes as unknown[] | undefined) ?? []), scene];
    await writeProjectFile(file);
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

- [ ] **Step 3: Typecheck**

They run only in the built CLI; Task 6 checks them end to end.

Run: `pnpm exec tsc -p apps/cli/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 4: Commit**

```bash
git add apps/cli
git commit -m "cli: render, preview and capture-page in Electron, answers and cancel over IPC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Node commands and the program

`init`, `devices`, `record`, `suggest` and `recover`, and the commander program that wires every command to the global options, the output and Ctrl+C.

**Files:**
- Create: `apps/cli/src/commands/init.ts`, `apps/cli/src/commands/devices.ts`, `apps/cli/src/commands/record.ts`, `apps/cli/src/commands/suggest.ts`, `apps/cli/src/commands/recover.ts`, `apps/cli/src/main.ts`, `apps/cli/src/bin.ts`
- Test: `apps/cli/test/cli.test.ts`

- [ ] **Step 1: Write the failing test**

The snapshots were reviewed by hand: the paths of the temp project read `<project>`. The suggest fixture is a 20 s screen where a box moves from 3 to 17 s, typing at 3.2–3.8 s, a prompt at 3.8 s and the answer at 16 s.

`apps/cli/test/cli.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../src/main';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-cli-'));
  dirs.push(dir);
  return dir;
};

/** Runs the CLI in-process; `json` is stdout parsed when it is JSON. */
async function cli(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: (text) => void (stderr += text) });
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = undefined;
  }
  return { code, stdout, stderr, json };
}

/** The project folder's path in a result as `<project>`, with forward slashes, so a snapshot holds on every platform. */
const stable = (value: unknown, dir: string) =>
  JSON.parse(JSON.stringify(value).split(JSON.stringify(dir).slice(1, -1)).join('<project>').replaceAll('\\\\', '/'));

describe('cuttle init and errors', () => {
  it('creates a project and refuses to overwrite one', async () => {
    const dir = join(temp(), 'demo');
    const first = await cli('--json', 'init', dir);
    expect(first.code).toBe(0);
    expect(stable(first.json, dir)).toMatchInlineSnapshot(`
      {
        "project": "<project>/cuttle.json",
      }
    `);
    expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'))).toEqual({ version: 1, sources: { screen: 'takes/1/screen.mp4' } });
    const again = await cli('--json', 'init', dir);
    expect(again.code).toBe(1);
    expect(stable(again.json, dir)).toMatchInlineSnapshot(`
      {
        "error": {
          "code": "usage",
          "message": "<project> already has a cuttle.json",
        },
      }
    `);
  });

  it('maps usage and project errors to exit code 1, with one JSON error on stdout', async () => {
    const dir = temp();
    expect((await cli('nonsense')).code).toBe(1);
    const missing = await cli('--json', '-C', dir, 'suggest');
    expect(missing.code).toBe(1);
    expect((missing.json as { error: { code: string } }).error.code).toBe('invalid-project');
    await cli('init', join(dir, 'p'));
    const noScenes = await cli('--json', '-C', join(dir, 'p'), 'preview');
    expect(noScenes.code).toBe(1);
    expect((noScenes.json as { error: { message: string } }).error.message).toMatch(/has no scenes yet/);
    const region = await cli('--json', '-C', join(dir, 'p'), 'record', '--backend', 'test', '--region', '1,2');
    expect(region.code).toBe(1);
    expect((region.json as { error: { message: string } }).error.message).toMatch(/--region needs x,y,w,h/);
  });
});

describe('cuttle devices and record (test backend)', () => {
  it('lists the test devices', async () => {
    const { code, json } = await cli('--json', 'devices', '--backend', 'test');
    expect(code).toBe(0);
    expect(json).toMatchInlineSnapshot(`
      {
        "cameras": [
          "Test Camera",
          "Failing Test Camera",
        ],
        "mics": [
          "Test Microphone",
          "Silent Test Microphone",
        ],
        "monitors": [
          {
            "bounds": {
              "height": 720,
              "width": 1280,
              "x": 0,
              "y": 0,
            },
            "index": 0,
            "name": "Test Monitor",
            "primary": true,
            "scale": 1,
          },
          {
            "bounds": {
              "height": 360,
              "width": 640,
              "x": 1280,
              "y": 0,
            },
            "index": 1,
            "name": "Still Test Monitor",
            "primary": false,
            "scale": 1,
          },
        ],
        "windows": [
          {
            "bounds": {
              "height": 360,
              "width": 640,
              "x": 100,
              "y": 60,
            },
            "monitor": 0,
            "title": "Test Window",
          },
        ],
      }
    `);
  });

  it('records a take into a new project and points the project at it', async () => {
    const dir = join(temp(), 'demo');
    const { code, json, stderr } = await cli('--json', '-C', dir, 'record', '--backend', 'test', '--mic', '--max', '2', '--countdown', '0');
    expect(code).toBe(0);
    expect(stderr).toBe(''); // --json: no status lines
    const result = json as { project: string; take: { dir: string; seconds: number; stopReason: string; mic?: string } };
    expect(result.take).toMatchObject({ dir: 'takes/1', mic: 'takes/1/mic.m4a', stopReason: 'max-seconds' });
    const project = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    expect(project.sources).toEqual({
      screen: 'takes/1/screen.mp4',
      mic: 'takes/1/mic.m4a',
      events: 'takes/1/events.jsonl',
      markers: 'takes/1/markers.json',
    });
    expect(project.scenes).toEqual([{ type: 'clip', from: 0, to: Math.floor(result.take.seconds * 1000) / 1000 }]);
  }, 20_000);
});

/**
 * A 20 s screen recording where only a white box moves, from 3 to 17 s; typing at 3.2–3.8 s, a
 * prompt marker at 3.8 s and Claude's answer at 16 s.
 */
function takeFixture(projectDir: string, take = 'takes/1'): void {
  const dir = join(projectDir, take);
  mkdirSync(dir, { recursive: true });
  const graph = "color=c=0x202020:s=1280x720:r=30:d=20[bg];color=c=white:s=80x80:r=30:d=20[box];[bg][box]overlay=x='100+mod(t*200,300)':y=500:enable='between(t,3,17)'[out0]";
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', graph, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(dir, 'screen.mp4')]);
  if (result.status !== 0) throw new Error(String(result.stderr));
  writeFileSync(join(dir, 'events.jsonl'), [3.2, 3.5, 3.8].map((t) => `${JSON.stringify({ t, type: 'keys', count: 1 })}\n`).join(''));
  writeFileSync(join(dir, 'markers.json'), JSON.stringify({ version: 1, markers: [{ t: 3.8, kind: 'prompt' }, { t: 16, kind: 'answer' }] }));
  writeFileSync(join(dir, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 } } }));
  writeFileSync(
    join(projectDir, 'cuttle.json'),
    JSON.stringify({ version: 1, sources: { screen: `${take}/screen.mp4`, events: `${take}/events.jsonl`, markers: `${take}/markers.json` } }),
  );
}

describe('cuttle suggest and recover', () => {
  let fixture: string;
  beforeAll(() => {
    fixture = temp();
    takeFixture(fixture);
  });

  it('trims, speeds up the wait and zooms on the answer', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const { code, json } = await cli('--json', '-C', dir, 'suggest');
    expect(code).toBe(0);
    expect(stable(json, dir)).toMatchInlineSnapshot(`
      {
        "backup": "<project>/cuttle.json.bak",
        "markers": {
          "count": 2,
          "from": "take",
        },
        "notes": [
          "trimmed the quiet start (0.0–1.8 s)",
          "trimmed the quiet end (18.5–20.0 s)",
          "sped up 9.4 s without input 3× (5.1–14.5 s)",
          "zoom on Claude's answer at 15.5 s (145, 422, 448, 236)",
        ],
        "project": "<project>/cuttle.json",
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
        ],
        "written": true,
        "zooms": [
          {
            "at": 15.5,
            "duration": 3,
            "rect": [
              145,
              422,
              448,
              236,
            ],
          },
        ],
      }
    `);
    const project = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    expect(project.scenes).toEqual((json as { scenes: unknown }).scenes);
    expect(existsSync(join(dir, 'cuttle.json.bak'))).toBe(true);
  }, 30_000);

  it('leaves cuttle.json alone with --dry-run', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const before = readFileSync(join(dir, 'cuttle.json'), 'utf8');
    const { code, json } = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-zoom');
    expect(code).toBe(0);
    expect(json).toMatchObject({ written: false, zooms: [] });
    expect(readFileSync(join(dir, 'cuttle.json'), 'utf8')).toBe(before);
  }, 30_000);

  it('repairs a crashed take and uses it', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const take = join(dir, 'takes', '1');
    rmSync(join(take, 'take.json'));
    rmSync(join(take, 'markers.json'));
    writeFileSync(join(take, 'events.jsonl'), '{"t":1,"type":"keys","count":1}\n{"t":2,"type":"ke'); // cut off by the crash
    const { code, json } = await cli('--json', '-C', dir, 'recover', 'takes/1');
    expect(code).toBe(0);
    expect(stable(json, dir)).toMatchInlineSnapshot(`
      {
        "project": "<project>/cuttle.json",
        "repaired": [
          "events.jsonl: kept 1 events, dropped 1 broken or cut-off line(s) (old file: events.jsonl.bak)",
          "markers.json was missing: written empty",
          "take.json was missing: written with the tracks starting together",
        ],
        "seconds": 20,
        "take": "takes/1",
        "tracks": [
          "screen",
        ],
      }
    `);
    expect(readFileSync(join(take, 'events.jsonl'), 'utf8')).toBe('{"t":1,"type":"keys","count":1}\n');
    expect(JSON.parse(readFileSync(join(take, 'take.json'), 'utf8'))).toEqual({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 0 } } });
    const recovered = await cli('--json', '-C', dir, 'recover', 'takes/1');
    expect((recovered.json as { repaired: string[] }).repaired).toEqual([]); // nothing left to repair
  }, 30_000);

  it('refuses a take outside the project and one without video', async () => {
    const dir = temp();
    expect((await cli('--json', '-C', dir, 'recover', '..')).code).toBe(1);
    mkdirSync(join(dir, 'takes', '9'), { recursive: true });
    const empty = await cli('--json', '-C', dir, 'recover', 'takes/9');
    expect(empty.code).toBe(1);
    expect((empty.json as { error: { code: string } }).error.code).toBe('invalid-media');
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run apps/cli/test/cli.test.ts`
Expected: FAIL, the suite cannot load: `Error: Cannot find module '../src/main' imported from …/cli.test.ts` and `Tests  no tests`.

- [ ] **Step 3: init and devices**

`apps/cli/src/commands/init.ts`:

```ts
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CliError } from '../errors';
import type { Output } from '../output';
import { newProjectFile, projectExists, PROJECT_FILE, writeProjectFile } from '../project-file';

export interface InitResult {
  project: string;
}

/** `cuttle init [dir]`: a project folder with a default cuttle.json that records into takes/1. */
export async function init(dir: string, output: Output): Promise<InitResult> {
  const target = resolve(dir);
  if (projectExists(target)) throw new CliError('usage', `${target} already has a ${PROJECT_FILE}`);
  await mkdir(target, { recursive: true });
  const file = await writeProjectFile(newProjectFile(target));
  const result = { project: file.path };
  output.result(result, () => `created ${file.path}\nnext: cuttle record (in that folder)`);
  return result;
}
```

`apps/cli/src/commands/devices.ts`:

```ts
import { listDevices, type Backend, type Devices } from '@cuttle/recorder';
import type { Output } from '../output';

/** `cuttle devices`: monitors (index, size, position), windows, cameras and microphones. */
export async function devices(backend: Backend, output: Output): Promise<Devices> {
  const result = await listDevices({ backend });
  output.result(result, () => describe(result));
  return result;
}

function describe({ monitors, windows, cameras, mics }: Devices): string {
  const list = (items: string[]) => (items.length === 0 ? ['  (none)'] : items.map((item) => `  ${item}`));
  return [
    'monitors (--monitor N):',
    ...list(
      monitors.map(
        ({ index, name, bounds, scale, primary }) =>
          `${index}  ${bounds.width}×${bounds.height} at ${bounds.x},${bounds.y}  ${Math.round(scale * 100)} %  ${name}${primary ? '  (primary)' : ''}`,
      ),
    ),
    'windows (--window "title"):',
    ...list(windows.map(({ title, bounds, monitor }) => `${JSON.stringify(title)}  ${bounds.width}×${bounds.height} on monitor ${monitor}`)),
    'cameras (--webcam "name"):',
    ...list(cameras.map((name) => JSON.stringify(name))),
    'microphones (--mic "name"):',
    ...list(mics.map((name) => JSON.stringify(name))),
  ].join('\n');
}
```

- [ ] **Step 4: record**

`apps/cli/src/commands/record.ts`:

```ts
import { resolve } from 'node:path';
import { HOTKEYS, listDevices, record, type Backend, type CaptureSource, type Take } from '@cuttle/recorder';
import type { Rect } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';
import { newProjectFile, projectExists, readProjectFile, writeProjectFile } from '../project-file';
import { useTake } from '../use-take';

export interface RecordArgs {
  monitor?: number;
  /** "x,y,w,h" in pixels of `monitor` (default: the primary monitor). */
  region?: string;
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
  const file = projectExists(projectDir) ? await readProjectFile(projectDir) : await writeProjectFile(newProjectFile(projectDir));

  const recording = record({
    projectDir: file.dir,
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
  let take: Take;
  try {
    take = await recording.done;
  } finally {
    signal.removeEventListener('abort', stop);
  }

  const backup = await useTake(file, take);
  await writeProjectFile(file);
  const result: RecordResult = { project: file.path, take, ...(backup && { backup }) };
  output.result(result, () =>
    [
      `recorded ${take.dir}: ${take.seconds.toFixed(1)} s, ${take.screenSize.width}×${take.screenSize.height} (${take.stopReason})`,
      ...take.warnings.map((warning) => `warning: ${warning}`),
      `${file.path} now uses this take${backup ? ` (previous version: ${backup})` : ''}`,
      'next: cuttle suggest, then cuttle preview --sheet',
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
  const parts = args.region.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    throw new CliError('usage', `--region needs x,y,w,h in pixels of the monitor, e.g. 0,0,1920,1080 (got "${args.region}"; in PowerShell quote it)`);
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

- [ ] **Step 5: suggest and recover**

`apps/cli/src/commands/suggest.ts`:

```ts
import { copyFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseEventsJsonl, parseMarkersJson, parseTakeJson, type InputEvent, type Marker, type Rect } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';
import { readProjectFile, writeProjectFile } from '../project-file';
import { analyseScreen, grabGray } from '../suggest/media';
import { suggestClips } from '../suggest/plan';
import { changedRegion, zoomRect } from '../suggest/region';
import { transcriptMarkers } from '../suggest/transcript';

export interface SuggestArgs {
  /** The folder Claude Code ran in (true: the current folder), for a take without Claude markers. */
  claude?: string | true;
  /** Print the suggestion without writing cuttle.json. */
  dryRun?: boolean;
  /** Zoom on Claude's final answer (default true). */
  zoom?: boolean;
}

export interface SuggestResult {
  project: string;
  scenes: { type: 'clip'; from: number; to: number; speed?: number }[];
  zooms: { at: number; duration: number; rect: Rect }[];
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
 * `cuttle suggest`: scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
 * sped up) and a zoom on Claude's answer, written to cuttle.json (scenes and zooms are replaced;
 * the previous file is kept as cuttle.json.bak).
 */
export async function suggestCommand(projectDir: string, args: SuggestArgs, output: Output): Promise<SuggestResult> {
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  const screen = join(file.dir, sources.screen);
  output.info('reading the screen recording …');
  const screenInfo = await analyseScreen(screen);
  if (screenInfo.duration <= 0) throw new CliError('invalid-media', `${screen} has no video frames`);
  const events = sources.events ? await readEvents(join(file.dir, sources.events)) : [];
  let markers = sources.markers ? await readMarkers(join(file.dir, sources.markers)) : [];
  let from: SuggestResult['markers']['from'] = markers.length > 0 ? 'take' : 'none';
  if (args.claude !== undefined && !markers.some((marker) => marker.kind !== 'manual')) {
    const start = await screenStart(dirname(screen));
    const found = await transcriptMarkers(args.claude === true ? process.cwd() : resolve(args.claude), start, screenInfo.duration);
    if (found.length > 0) {
      markers = [...markers, ...found].sort((a, b) => a.t - b.t);
      from = 'transcript';
    }
  }

  const suggestion = suggestClips({ duration: screenInfo.duration, events, markers, still: screenInfo.still });
  const scenes = suggestion.clips.map(({ from: start, to, speed }) => ({ type: 'clip' as const, from: start, to, ...(speed !== 1 && { speed }) }));
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
      zooms.push({ at: Math.round(at * 1000) / 1000, duration: Math.round(duration * 1000) / 1000, rect });
      suggestion.notes.push(`zoom on Claude's answer at ${at.toFixed(1)} s (${rect.join(', ')})`);
    } else {
      suggestion.notes.push(region ? 'no zoom: most of the screen changed with the answer (add one by hand)' : 'no zoom: nothing changed around the answer');
    }
  }

  let backup: string | undefined;
  if (!args.dryRun) {
    backup = `${file.path}.bak`;
    await copyFile(file.path, backup);
    file.raw.scenes = scenes;
    file.raw.zooms = zooms;
    await writeProjectFile(file);
  }
  const result: SuggestResult = {
    project: file.path,
    scenes,
    zooms,
    notes: suggestion.notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
    ...(backup && { backup }),
  };
  output.result(result, () => {
    const seconds = scenes.reduce((sum, scene) => sum + (scene.to - scene.from) / (scene.speed ?? 1), 0);
    return [
      ...suggestion.notes.map((note) => `- ${note}`),
      `${scenes.length} scene(s), about ${seconds.toFixed(1)} s${zooms.length > 0 ? `, ${zooms.length} zoom` : ''}`,
      args.dryRun ? '(dry run: cuttle.json unchanged)' : `written to ${file.path} (previous version: ${backup})`,
      'next: cuttle preview --sheet',
    ].join('\n');
  });
  return result;
}

async function readEvents(path: string): Promise<InputEvent[]> {
  const text = await readFile(path, 'utf8').catch(() => '');
  return parseEventsJsonl(text).events;
}

async function readMarkers(path: string): Promise<Marker[]> {
  const parsed = parseMarkersJson(await readFile(path, 'utf8').catch(() => ''));
  return parsed.ok ? parsed.markers : [];
}

/** The screen track's start (wall-clock seconds) from the take.json next to it. */
async function screenStart(takeDir: string): Promise<number> {
  const path = join(takeDir, 'take.json');
  const parsed = parseTakeJson(await readFile(path, 'utf8').catch(() => ''));
  if (!parsed.ok) throw new CliError('usage', `--claude needs the take's start time from ${path}, which is missing or invalid`);
  return parsed.take.tracks.screen.start;
}
```

`apps/cli/src/commands/recover.ts`:

```ts
import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, parseEventsJsonl, parseMarkersJson, parseTakeJson, type TakeFile } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';
import { newProjectFile, projectExists, readProjectFile, writeProjectFile } from '../project-file';
import { streamSeconds } from '../suggest/media';
import { useTake } from '../use-take';

export interface RecoverResult {
  project: string;
  /** The take folder, relative to the project. */
  take: string;
  seconds: number;
  tracks: string[];
  /** What was repaired, for people; empty when the take was fine. */
  repaired: string[];
  backup?: string;
}

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json' };

/**
 * `cuttle recover <take>`: makes a take usable after a crash (the recorder's fragmented MP4s stay
 * readable up to their last fragment): checks every track, drops a cut-off events.jsonl line, writes
 * markers.json and take.json when they are missing or broken, and points the project at the take.
 */
export async function recoverCommand(projectDir: string, takeDir: string, output: Output): Promise<RecoverResult> {
  const project = resolve(projectDir);
  const dir = resolve(project, takeDir);
  const rel = relative(project, dir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new CliError('usage', `the take ${dir} must be a folder inside the project ${project}`);
  const path = (file: string) => join(dir, file);
  const source = (file: string) => `${rel.split(sep).join('/')}/${file}`;
  const repaired: string[] = [];

  const seconds = await streamSeconds(path(FILES.screen), 'v');
  if (seconds <= 0) throw new CliError('invalid-media', `${path(FILES.screen)} is missing or has no readable video; nothing to recover`);
  const webcam = existsSync(path(FILES.webcam)) && (await streamSeconds(path(FILES.webcam), 'v')) > 0;
  const mic = existsSync(path(FILES.mic)) && (await streamSeconds(path(FILES.mic), 'a')) > 0;
  for (const [ok, file] of [[webcam, FILES.webcam], [mic, FILES.mic]] as const) {
    if (!ok && existsSync(path(file))) repaired.push(`left out ${file}: it has nothing readable`);
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
      await copyFile(path(FILES.events), `${path(FILES.events)}.bak`);
      await writeFile(path(FILES.events), kept.map((line) => `${line}\n`).join(''));
      repaired.push(`events.jsonl: kept ${kept.length} events, dropped ${lines.length - kept.length} broken or cut-off line(s) (old file: events.jsonl.bak)`);
    }
  } else {
    await writeFile(path(FILES.events), '');
    repaired.push('events.jsonl was missing: written empty (no cursor, clicks or keys)');
  }

  const markersText = existsSync(path(FILES.markers)) ? await readFile(path(FILES.markers), 'utf8') : undefined;
  if (markersText === undefined || !parseMarkersJson(markersText).ok) {
    if (markersText !== undefined) await copyFile(path(FILES.markers), `${path(FILES.markers)}.bak`);
    await writeFile(path(FILES.markers), `${JSON.stringify({ version: MARKERS_VERSION, markers: [] }, null, 2)}\n`);
    repaired.push(markersText === undefined ? 'markers.json was missing: written empty' : 'markers.json was broken: written empty (old file: markers.json.bak)');
  }

  const takeText = existsSync(path(FILES.take)) ? await readFile(path(FILES.take), 'utf8') : undefined;
  const parsed = takeText === undefined ? undefined : parseTakeJson(takeText);
  if (!parsed?.ok) {
    // The start times were lost with the crash: the tracks are taken to start together.
    const take: TakeFile = {
      version: TAKE_VERSION,
      tracks: {
        screen: { file: FILES.screen, start: 0 },
        ...(webcam && { webcam: { file: FILES.webcam, start: 0 } }),
        ...(mic && { mic: { file: FILES.mic, start: 0 } }),
      },
    };
    await writeFile(path(FILES.take), `${JSON.stringify(take, null, 2)}\n`);
    repaired.push(
      `take.json was ${takeText === undefined ? 'missing' : 'broken'}: written with the tracks starting together${webcam || mic ? ' (webcam and mic may be off by up to a second)' : ''}`,
    );
  }

  const file = projectExists(project) ? await readProjectFile(project) : await writeProjectFile(newProjectFile(project));
  const backup = await useTake(file, {
    screen: source(FILES.screen),
    ...(webcam && { webcam: source(FILES.webcam) }),
    ...(mic && { mic: source(FILES.mic) }),
    events: source(FILES.events),
    markers: source(FILES.markers),
    seconds,
  });
  await writeProjectFile(file);
  const result: RecoverResult = {
    project: file.path,
    take: rel.split(sep).join('/'),
    seconds,
    tracks: ['screen', ...(webcam ? ['webcam'] : []), ...(mic ? ['mic'] : [])],
    repaired,
    ...(backup && { backup }),
  };
  output.result(result, () =>
    [
      `${result.take}: ${seconds.toFixed(1)} s, tracks: ${result.tracks.join(', ')}`,
      ...(repaired.length > 0 ? repaired.map((note) => `- ${note}`) : ['nothing needed repair']),
      `${file.path} now uses this take${backup ? ` (previous version: ${backup})` : ''}`,
    ].join('\n'),
  );
  return result;
}
```

- [ ] **Step 6: The program**

`apps/cli/src/main.ts`:

```ts
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { capturePageCommand } from './commands/capture-page';
import { devices } from './commands/devices';
import { init } from './commands/init';
import { previewCommand } from './commands/preview';
import { recordCommand } from './commands/record';
import { recoverCommand } from './commands/recover';
import { renderCommand } from './commands/render';
import { suggestCommand } from './commands/suggest';
import { EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';

export const VERSION = '0.1.0';

const seconds = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new InvalidArgumentError('expected seconds, 0 or more');
  return parsed;
};
const positive = (value: string): number => {
  const parsed = seconds(value);
  if (parsed === 0) throw new InvalidArgumentError('expected more than 0 seconds');
  return parsed;
};
const integer = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new InvalidArgumentError('expected a whole number, 0 or more');
  return parsed;
};
const collect = (value: string, previous: number[] = []): number[] => [...previous, seconds(value)];

/**
 * Ctrl+C (and SIGTERM, SIGBREAK) as an AbortSignal for the commands that can stop cleanly; a second
 * one exits at once. `dispose` removes the handlers.
 */
function interruptible(output: Output): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const onSignal = () => {
    if (controller.signal.aborted) process.exit(EXIT.cancelled);
    output.info('stopping … (Ctrl+C again to quit at once)');
    controller.abort();
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const;
  for (const name of signals) process.on(name, onSignal);
  return { signal: controller.signal, dispose: () => signals.forEach((name) => process.off(name, onSignal)) };
}

/** Runs the CLI with `argv` (without node and the script); returns the exit code. */
export async function runCli(argv: readonly string[], streams?: Streams): Promise<number> {
  let exitCode: number = EXIT.ok;
  const program = new Command('cuttle')
    .description('Record a screen take and turn it into a polished demo video')
    .version(VERSION)
    .option('-C, --project <dir>', 'the project folder', '.')
    .option('--json', 'machine-readable output: one JSON document on stdout')
    .showHelpAfterError()
    .exitOverride();
  if (streams) program.configureOutput({ writeOut: streams.stdout, writeErr: streams.stderr });

  /** Wraps a command's action: output with the global options, errors mapped to exit codes. */
  const action =
    <A extends unknown[]>(run: (output: Output, project: string, ...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      const globals = program.opts<{ project: string; json?: boolean }>();
      const output = createOutput(globals.json ?? false, streams);
      try {
        await run(output, globals.project, ...args);
      } catch (error) {
        const failure = toCliError(error);
        output.error(failure);
        exitCode = failure.exitCode;
      }
    };
  const withSignal = async <T>(output: Output, body: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const interrupt = interruptible(output);
    try {
      return await body(interrupt.signal);
    } finally {
      interrupt.dispose();
    }
  };

  program
    .command('init [dir]')
    .description('create a project folder with a default cuttle.json')
    .action(action((output, project, dir?: string) => init(dir ?? project, output)));

  program
    .command('devices')
    .description('list monitors (index, size, position), windows, cameras and microphones')
    .addOption(new Option('--backend <name>', 'capture backend').choices(['auto', 'test']).default('auto').hideHelp())
    .action(action((output, _project, options: { backend: 'auto' | 'test' }) => devices(options.backend, output)));

  program
    .command('record')
    .description('record a take into the project and use it')
    .option('--monitor <n>', 'monitor index from "cuttle devices" (default: the primary monitor)', integer)
    .option('--region <x,y,w,h>', 'a region of the monitor, in its pixels')
    .option('--window <title>', 'a window, by (part of) its title')
    .option('--webcam [name]', 'record a webcam (default: the first one)')
    .option('--mic [name]', 'record a microphone (default: the first one)')
    .option('--until-claude [cwd]', 'stop when the Claude Code session in that folder (default: here) finishes its turn')
    .option('--until-file <path>', 'stop when this file appears')
    .option('--until-idle <seconds>', 'stop when the screen and the input rested this long', positive)
    .option('--max <seconds>', 'stop after this long', positive)
    .option('--countdown <seconds>', 'seconds before the recording starts (default 3)', seconds)
    .option('--draw-mouse', 'bake the real pointer into the video')
    .addOption(new Option('--backend <name>', 'capture backend').choices(['auto', 'test']).default('auto').hideHelp())
    .action(
      action((output, project, options: Parameters<typeof recordCommand>[1]) =>
        withSignal(output, (signal) => recordCommand(project, options, output, signal)),
      ),
    );

  program
    .command('suggest')
    .description('propose scenes (quiet start and end trimmed, idle cut, waiting sped up) and a zoom on the answer')
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zoom on the answer')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(action((output, project, options: { claude?: string | true; zoom: boolean; dryRun?: boolean }) => suggestCommand(project, options, output)));

  program
    .command('preview')
    .description('PNG stills of the output, and a contact sheet')
    .option('--at <seconds...>', 'output times (default: 12 evenly spaced, with a sheet)', collect)
    .option('--sheet', 'also a contact sheet of the stills')
    .option('--format <format>', '16:9, 1:1 or 9:16 (default: the project output)')
    .option('-o, --out <dir>', 'folder for the PNGs (default: preview/ in the project)')
    .action(
      action((output, project, options: { at?: number[]; sheet?: boolean; format?: string; out?: string }) =>
        withSignal(output, (signal) => previewCommand(project, options, output, signal)),
      ),
    );

  program
    .command('capture-page <target>')
    .description('a web page (URL or file) as a PNG in stills/, optionally as a still scene')
    .option('--scroll', 'the whole page, shown as a scrolling still')
    .option('--width <px>', 'viewport width (default: the output width)', integer)
    .option('--height <px>', 'viewport height (default: the output height)', integer)
    .option('--name <name>', 'file name in stills/ (default: from the URL or file)')
    .option('--add', 'append a still scene that shows it')
    .option('--duration <seconds>', 'length of that scene (default 4)', positive)
    .option('--wait <ms>', 'wait after loading, for fonts and maps (default 1000)', integer)
    .action(
      action((output, project, target: string, options: Parameters<typeof capturePageCommand>[2]) =>
        withSignal(output, (signal) => capturePageCommand(project, target, options, output, signal)),
      ),
    );

  program
    .command('render')
    .description('export the project as an MP4')
    .option('--format <format>', '16:9, 1:1 or 9:16 (default: the project output)')
    .option('-o, --out <file>', 'output file (default: out/<format>.mp4 in the project)')
    .addOption(new Option('--encoder <encoder>', 'H.264 encoder').choices(['auto', 'hardware', 'software']))
    .action(
      action((output, project, options: { format?: string; out?: string; encoder?: string }) =>
        withSignal(output, (signal) => renderCommand(project, options, output, signal)),
      ),
    );

  program
    .command('recover <take>')
    .description('make a take usable after a crash (e.g. takes/3) and use it')
    .action(action((output, project, take: string) => recoverCommand(project, take, output)));

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? EXIT.ok : EXIT.usage; // help, version, or a usage error
    throw error;
  }
  return exitCode;
}
```

`apps/cli/src/bin.ts`:

```ts
// Entry of the bundled CLI (dist/cuttle.mjs), started by the cuttle shims.
import { runCli } from './main';

const code = await runCli(process.argv.slice(2));
process.exitCode = code;
// Exits when the work is done; a stray handle (a closed hook, a timer) must not keep the CLI alive.
setTimeout(() => process.exit(code), 2000).unref();
```

- [ ] **Step 7: Run the tests**

Run: `pnpm exec vitest run apps/cli`
Expected: PASS, 20 tests (8 in cli.test.ts, 12 from Task 3); electron.check.test.ts does not exist yet.

Run: `pnpm exec tsc -p apps/cli/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 8: Commit**

```bash
git add apps/cli
git commit -m "cli: init, devices, record, suggest, recover and the commander program

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The bundle and the Electron check

Vite bundles the CLI and its Electron entry; a check runs `preview`, `capture-page` and `render` through the built CLI. The export's development entry `export:run` goes: `cuttle render` replaces it.

**Files:**
- Create: `apps/cli/vite.config.ts`
- Test: `apps/cli/test/electron.check.test.ts`
- Modify: `package.json` (scripts), `packages/export/electron/vite.main.config.ts`, `packages/export/tsconfig.node.json`
- Delete: `packages/export/electron/cli.ts`

- [ ] **Step 1: Write the failing check**

The check runs only with `--mode cli` (it is skipped in `pnpm test`): a 3 s take with the test backend, then stills, a page capture and a 1:1 render, each checked through its PNG or ffprobe.

`apps/cli/test/electron.check.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The commands that run in Electron (preview, capture-page, render), end to end through the built
 * CLI. Runs only with `pnpm cli:check` (vitest --mode cli, after cli:build).
 */
const CLI = fileURLToPath(new URL('../dist/cuttle.mjs', import.meta.url));
const enabled = process.env.MODE === 'cli';

function cuttle(...argv: string[]): { code: number; json: Record<string, unknown> } {
  const result = spawnSync('node', [CLI, '--json', ...argv], { encoding: 'utf8', timeout: 120_000 });
  return { code: result.status ?? -1, json: JSON.parse(result.stdout || '{}') as Record<string, unknown> };
}

/** Width and height of a PNG, from its IHDR chunk. */
function pngSize(file: string): [number, number] {
  const bytes = readFileSync(file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function probe(file: string): string {
  return spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim();
}

describe.runIf(enabled)('cuttle in Electron', () => {
  let project: string;
  beforeAll(() => {
    project = mkdtempSync(join(tmpdir(), 'cuttle-check-'));
    expect(cuttle('-C', project, 'record', '--backend', 'test', '--mic', '--max', '3', '--countdown', '0').code).toBe(0);
  }, 60_000);
  afterAll(() => rm(project, { recursive: true, force: true }));

  it('renders stills at given times, and a contact sheet by default', () => {
    const some = cuttle('-C', project, 'preview', '--at', '0.5', '--at', '2');
    expect(some.code).toBe(0);
    const stills = some.json.stills as { t: number; file: string }[];
    expect(stills.map((still) => still.t)).toEqual([0.5, 2]);
    expect(stills.map((still) => pngSize(still.file))).toEqual([[1920, 1080], [1920, 1080]]);
    expect(some.json.sheet).toBeUndefined();
    const sheet = cuttle('-C', project, 'preview', '--format', '9:16');
    expect(sheet.code).toBe(0);
    expect((sheet.json.stills as unknown[]).length).toBe(12);
    expect(pngSize((sheet.json.stills as { file: string }[])[0]!.file)).toEqual([1080, 1920]);
    expect(pngSize(sheet.json.sheet as string)[0]).toBeGreaterThan(1000);
  }, 120_000);

  it('captures a whole page and appends it as a scrolling still scene', () => {
    const page = join(project, 'page.html');
    writeFileSync(page, '<!doctype html><body style="margin:0"><div style="height:3000px;background:linear-gradient(#08f,#f80)"></div></body>');
    const { code, json } = cuttle('-C', project, 'capture-page', page, '--scroll', '--add', '--duration', '3');
    expect(code).toBe(0);
    expect(json).toMatchObject({ width: 1920, height: 3000, scene: { type: 'still', image: 'stills/page.png', duration: 3, motion: 'scroll', frame: 'browser-light' } });
    expect(pngSize(json.file as string)).toEqual([1920, 3000]);
  }, 120_000);

  it('renders the project with its still scene to 1:1', () => {
    const { code, json } = cuttle('-C', project, 'render', '--format', '1:1');
    expect(code).toBe(0);
    const seconds = json.seconds as number;
    expect(seconds).toBeGreaterThan(5.5); // the 3 s take plus the 3 s still, less one crossfade
    expect(probe(json.out as string).split(/\r?\n/).slice(0, 2)).toEqual(['h264,1080,1080', 'aac']);
  }, 120_000);

  it('fails on an unknown format before rendering, and on a page that does not exist', () => {
    expect(cuttle('-C', project, 'render', '--format', '4:3').code).toBe(1);
    expect(cuttle('-C', project, 'capture-page', join(project, 'missing.html')).code).toBe(1);
  }, 120_000);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm exec vitest run --mode cli apps/cli/test/electron.check.test.ts`
Expected: FAIL, `beforeAll` fails: `expected 1 to be +0` (`dist/cuttle.mjs` does not exist yet).

- [ ] **Step 3: The bundle and the scripts**

`apps/cli/vite.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The CLI as self-contained ES modules: dist/cuttle.mjs (Node) and dist/electron.mjs (Electron's main
// process for render, preview and capture-page). Workspace packages ship TypeScript, so they are
// bundled; Electron and the native modules (koffi, uiohook-napi) stay external and load from
// node_modules. The export page goes to dist/export-page/ (root script cli:build), where
// @cuttle/export finds it next to the bundle.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'warn',
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    target: 'node22',
    rollupOptions: {
      input: {
        cuttle: fileURLToPath(new URL('./src/bin.ts', import.meta.url)),
        electron: fileURLToPath(new URL('./src/electron/bootstrap.ts', import.meta.url)),
      },
      external: ['electron', 'koffi', 'uiohook-napi'],
      // Shared chunks stay next to the entries: export finds export-page/ relative to its own file.
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
    },
  },
});
```

In `package.json`, replace:

```json
    "export:run": "pnpm export:build && electron packages/export/dist/cli.mjs",
    "export:check": "pnpm export:build && electron packages/export/dist/check.mjs",
    "recorder:real": "vitest run --mode real --silent=false packages/recorder/test/real.test.ts"
```

with:

```json
    "export:check": "pnpm export:build && electron packages/export/dist/check.mjs",
    "recorder:real": "vitest run --mode real --silent=false packages/recorder/test/real.test.ts",
    "cli:build": "vite build --config apps/cli/vite.config.ts && vite build --config packages/export/electron/vite.page.config.ts --outDir ../../../apps/cli/dist/export-page",
    "cli:check": "pnpm cli:build && vitest run --mode cli apps/cli/test/electron.check.test.ts",
    "cuttle": "node apps/cli/dist/cuttle.mjs"
```

- [ ] **Step 4: Retire `export:run`**

```bash
git rm packages/export/electron/cli.ts
```

In `packages/export/electron/vite.main.config.ts`, replace:

```ts
        cli: fileURLToPath(new URL('./cli.ts', import.meta.url)),
        check: fileURLToPath(new URL('./check.ts', import.meta.url)),
```

with:

```ts
        check: fileURLToPath(new URL('./check.ts', import.meta.url)),
```

In `packages/export/tsconfig.node.json`, replace:

```json
  // Electron main process and its tests, the dev CLI, the end-to-end check, the fixture builder and the bundle configs.
```

with:

```json
  // Electron main process and its tests, the end-to-end check, the fixture builder and the bundle configs.
```

- [ ] **Step 5: Run the check**

Run: `pnpm cli:check`
Expected: PASS, 4 tests (~15 s). `apps/cli/dist/` holds `cuttle.mjs`, `electron.mjs`, a few chunks and `export-page/` (ignored by git).

Run: `pnpm exec tsc -p apps/cli/tsconfig.json && pnpm exec tsc -p packages/export/tsconfig.node.json && pnpm export:build`
Expected: exits with code 0; `packages/export/dist/` holds `check.mjs` and `export-page/`.

- [ ] **Step 6: Commit**

```bash
git add apps/cli package.json packages/export
git commit -m "cli: the Vite bundle and the Electron check; cuttle render replaces export:run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `cuttle` on PATH

**Files:**
- Create: `apps/cli/scripts/install.mjs`
- Modify: `package.json` (scripts)

- [ ] **Step 1: The install script**

`apps/cli/scripts/install.mjs`:

```js
// Puts `cuttle` on PATH: small shims that run the built CLI (dist/cuttle.mjs) with node, next to npm's
// global commands (Windows: %APPDATA%\npm, which every Node install puts on PATH; elsewhere
// ~/.local/bin). CUTTLE_BIN_DIR picks another folder. `--uninstall` removes them. Shims of other
// tools with the same name are never overwritten.
//   node apps/cli/scripts/install.mjs [--uninstall]
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARK = 'cuttle shim (pnpm cli:install)';
const entry = fileURLToPath(new URL('../dist/cuttle.mjs', import.meta.url));
const windows = process.platform === 'win32';
const dir = process.env.CUTTLE_BIN_DIR || (windows ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm') : join(homedir(), '.local', 'bin'));
const posixEntry = entry.replace(/\\/g, '/');

const shims = {
  // cmd.exe and PowerShell (which also runs .cmd files); Git Bash runs the file without extension.
  ...(windows && {
    'cuttle.cmd': `@rem ${MARK}\r\n@node "${entry}" %*\r\n`,
    'cuttle.ps1': `# ${MARK}\r\n& node "${entry}" @args\r\nexit $LASTEXITCODE\r\n`,
  }),
  cuttle: `#!/bin/sh\n# ${MARK}\nexec node "${posixEntry}" "$@"\n`,
};

const ours = (file) => !existsSync(file) || readFileSync(file, 'utf8').includes(MARK);

if (process.argv.includes('--uninstall')) {
  for (const name of Object.keys(shims)) {
    const file = join(dir, name);
    if (existsSync(file) && ours(file)) {
      rmSync(file);
      console.log(`removed ${file}`);
    }
  }
  process.exit(0);
}

if (!existsSync(entry)) {
  console.error(`${entry} is missing; run "pnpm cli:build" first`);
  process.exit(1);
}
const foreign = Object.keys(shims).map((name) => join(dir, name)).filter((file) => !ours(file));
if (foreign.length > 0) {
  console.error(`not overwriting files that belong to another tool:\n  ${foreign.join('\n  ')}\nset CUTTLE_BIN_DIR to install somewhere else`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(shims)) {
  const file = join(dir, name);
  writeFileSync(file, text);
  if (!name.includes('.')) chmodSync(file, 0o755);
  console.log(`wrote ${file}`);
}
const onPath = (process.env.PATH ?? '').split(delimiter).some((part) => part.replace(/[\\/]+$/, '').toLowerCase() === dir.replace(/[\\/]+$/, '').toLowerCase());
console.log(onPath ? 'cuttle is on PATH: open a new terminal and run "cuttle --help"' : `${dir} is not on PATH; add it, or run node "${entry}"`);
```

In `package.json`, replace:

```json
    "cli:check": "pnpm cli:build && vitest run --mode cli apps/cli/test/electron.check.test.ts",
```

with:

```json
    "cli:install": "pnpm cli:build && node apps/cli/scripts/install.mjs",
    "cli:uninstall": "node apps/cli/scripts/install.mjs --uninstall",
    "cli:check": "pnpm cli:build && vitest run --mode cli apps/cli/test/electron.check.test.ts",
```

- [ ] **Step 2: Try it in a temp folder**

The real install (into `%APPDATA%\npm`) is the user's call; this writes the shims into a temp folder, runs two of them, refuses to replace another tool's file and removes ours.

```bash
BIN=$(cygpath -m "$(mktemp -d)")
CUTTLE_BIN_DIR="$BIN" pnpm cli:install
ls "$BIN"
"$BIN/cuttle" --version
cmd //c "$(cygpath -w "$BIN")\\cuttle.cmd" --version
CUTTLE_BIN_DIR="$BIN" pnpm cli:uninstall
echo "left: $(ls -A "$BIN" | wc -l)"
echo "@echo another tool" > "$BIN/cuttle.cmd"
CUTTLE_BIN_DIR="$BIN" node apps/cli/scripts/install.mjs; echo "exit $?"
rm -r "$BIN"
```

Expected: `wrote …/cuttle.cmd`, `…/cuttle.ps1`, `…/cuttle` and `… is not on PATH; add it, or run node "…"`; `ls` lists `cuttle  cuttle.cmd  cuttle.ps1`; both shims print `0.1.0`; the uninstall prints three `removed …` lines and `left: 0`; the last install prints `not overwriting files that belong to another tool:` with the `.cmd` and `exit 1`.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/scripts package.json
git commit -m "cli: pnpm cli:install puts cuttle shims on PATH

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`, `docs/superpowers/specs/2026-10-16-cuttle-design.md`

- [ ] **Step 1: README**

In `README.md`, replace:

```markdown
| `@cuttle/recorder` | Records a take on Windows: a monitor, region or window (ddagrab), webcam and mic (DirectShow), input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |
```

with:

```markdown
| `@cuttle/recorder` | Records a take on Windows: a monitor, region or window (ddagrab), webcam and mic (DirectShow), input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |
| `apps/cli` | The `cuttle` command: init, devices, record, suggest, preview, capture-page, render, recover; `--json` for Claude |
```

In the same file, replace:

```markdown
pnpm recorder:real                       # record 3 s of the primary monitor and first mic for real, check, delete
pnpm export:run <projectDir> --format 9:16 -o out.mp4   # export a project (until the CLI exists)
```

with:

```markdown
pnpm recorder:real                       # record 3 s of the primary monitor and first mic for real, check, delete
pnpm cli:check                           # build the CLI; preview, capture-page and render through it in Electron
pnpm cuttle <command>                    # the built CLI without installing it (runs in the repo root)
```

In the same file, replace:

```markdown
Engine golden images live in `packages/engine/test/__golden__/`, one PNG per platform. A new
```

with:

````markdown
## The CLI

`pnpm cli:install` builds the CLI and puts `cuttle` on PATH: shims in npm's global folder
(`%APPDATA%\npm` on Windows, `~/.local/bin` elsewhere; `CUTTLE_BIN_DIR` picks another one).
`pnpm cli:uninstall` removes them.

```bash
cuttle init demo && cd demo
cuttle devices                       # monitors, windows, cameras, microphones
cuttle record --mic --until-claude   # stops when Claude Code in this folder ends its turn (or Ctrl+C)
cuttle suggest                       # scenes: quiet start and end trimmed, idle cut, waiting sped up, a zoom on the answer
cuttle preview                       # 12 stills and a contact sheet in preview/
cuttle capture-page https://example.com --scroll --add
cuttle render --format 9:16          # out/9x16.mp4
cuttle recover takes/2               # after a crash
```

Every command takes `-C <project folder>` and `--json` (one JSON document on stdout, errors as
`{ "error": { "code", "message" } }`). Exit codes: 0 ok, 1 usage or validation, 2 device or
permission, 3 render, 130 cancelled with Ctrl+C.

Engine golden images live in `packages/engine/test/__golden__/`, one PNG per platform. A new
````

- [ ] **Step 2: Roadmap**

In `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`, replace:

```markdown
| M5 | `apps/cli` (`cuttle …`) | write before starting |
```

with:

```markdown
| M5 | `apps/cli` (`cuttle …`) | `2026-10-17-cuttle-m5-cli.md` |
```

In the same file, replace:

```ts
export const EXPORT_FORMATS: Record<'16:9' | '1:1' | '9:16', { width: number; height: number }>; // 1920×1080, 1080×1080, 1080×1920
```

with:

```ts
export const EXPORT_FORMATS: Record<'16:9' | '1:1' | '9:16', { width: number; height: number }>; // 1920×1080, 1080×1080, 1080×1920
export function renderStills(opts: StillsOptions): Promise<StillsResult>; // M5: PNGs of output frames (cuttle preview)
// StillsOptions: projectDir, format?, times (output seconds), outDir, sheet?: { columns? } (default 4), onProgress?, pageDir?, signal?
// StillsResult: { stills: { t, file }[]; sheet?: string; width; height; stats: { gpu, totalMs } }; files 01-12.50s.png, sheet.png
```

In the same file, replace:

```markdown
- **M5:** commander version; how the CLI starts the bundled Electron for `render`, `preview` and
  `capture-page`; `pnpm link --global` on Windows. From M3: bundle the Electron entry with Vite like
  `packages/export/electron/vite.main.config.ts` (`ssr.noExternal: true`, `electron` external) and
  copy the page build (`vite.page.config.ts`) to `export-page/` next to it, or pass `pageDir`;
  register a no-op `window-all-closed` (closing the export window must not quit) and an
  `uncaughtException` handler; drop Chromium switches from `process.argv` (see
  `packages/export/electron/cli.ts`); map `ExportError.code` to exit codes 1/1/1/2/3/130; `--json`
  prints `ExportResult`. From the M3 reviews: turn Ctrl+C and a kill (SIGINT, SIGTERM, SIGBREAK)
  into `ExportOptions.signal` so the export cleans up (Claude Code's Bash tool kills long commands
  at its timeout: run renders in the background); a packaged Electron keeps Chromium switches in
  `process.argv` without `process.defaultApp`, so strip them there too; install the
  `uncaughtException` handler in a tiny bootstrap entry that then imports the CLI, because a
  failure while the bundle's static imports load would otherwise show Electron's modal dialog;
  projects with more than ~170 audible clips need ffmpeg 7 or later (the graph goes into a file).
  Phase 2 note: `loadSources` does not confine paths to the project folder; a shared project could
  pull in any local file, so the app should ask before opening one. From M4: `record()` runs in
  plain Node (the CLI does not need Electron for it); in a Vite bundle keep `koffi` and
  `uiohook-napi` external (native modules) and ship them in `node_modules`. Turn Ctrl+C and a kill
  into `Recording.stop()` (a stop during the countdown rejects with `cancelled`, exit 130), print
  `HOTKEYS` when the recording starts, map `RecorderError.code` to exit codes 1/2/2/2/2/130, and
  print the `Take` for `--json`. A take does not touch `cuttle.json`: the CLI decides whether
  `cuttle record` points `sources` at the new take (its paths are already relative to the project).
```

with:

```markdown
- **M5:** done; see "Decisions made while planning" in `2026-10-17-cuttle-m5-cli.md`.
```

In the same file, replace:

```markdown
- **M6:** current Claude skill frontmatter (`name`, `description`) and the user-level skill folder.
```

with:

```markdown
- **M6:** current Claude skill frontmatter (`name`, `description`) and the user-level skill folder.
  From M5: the skill drives `cuttle … --json` and reads one JSON document per command (exit codes
  0/1/2/3/130). `cuttle record` blocks until a stop trigger, and Claude cannot press Ctrl+C or the
  hotkey: start it in the background and stop it with `--until-claude` or `--until-file` (Claude
  creates the file), with `--max` as a safety net. Run `render` in the background too (Claude
  Code's Bash tool kills long commands at its timeout). Check the edit with `cuttle preview` and
  look at `sheet.png`. The skill should check `cuttle --version` and point to `pnpm cli:install`
  when it is missing; the shims run the repo's build, so the repo must stay where it was built.
```

- [ ] **Step 3: Spec**

In `docs/superpowers/specs/2026-10-16-cuttle-design.md`, replace:

```markdown
| `cuttle record [--monitor N \| --region x,y,w,h \| --window "title"] [--webcam] [--mic] [--until-claude [cwd]] [--until-file p] [--until-idle s] [--max s] [--countdown s] [--draw-mouse]` | Record a take into the project |
| `cuttle suggest` | From markers, events and the Claude transcript, propose scenes (trim idle start/end, speed up waiting, zoom on key moments) and write them to `cuttle.json` |
| `cuttle preview [--at t…] [--sheet]` | Stills or a contact sheet PNG with timestamps, for checking |
| `cuttle capture-page <url\|file> [--scroll]` | Headless capture of a page as a still or scroll scene |
| `cuttle render [--format 16:9\|1:1\|9:16] [-o file]` | Export |
| `cuttle recover <take>` | Repair a take after a crash |

Every command supports `--json` for machine-readable output. Exit codes: 0 ok, 1 usage or
validation error, 2 device or permission error, 3 render error.
```

with:

```markdown
| `cuttle record [--monitor N] [--region x,y,w,h] [--window "title"] [--webcam [name]] [--mic [name]] [--until-claude [cwd]] [--until-file p] [--until-idle s] [--max s] [--countdown s] [--draw-mouse]` | Record a take into the project (created when missing) and use it: `sources` point at the take, one clip scene covers it; scenes and overlays of the previous take are dropped (the old file stays as `cuttle.json.bak`) |
| `cuttle suggest [--claude [cwd]] [--no-zoom] [--dry-run]` | From markers, events and the screen, propose scenes (trim the quiet start and end, cut idle stretches, speed up waiting) and a zoom on Claude's answer, and write them to `cuttle.json` (old file as `.bak`); `--claude` reads the transcript for a take without Claude markers |
| `cuttle preview [--at t…] [--sheet] [--format f] [-o dir]` | PNG stills of the output; without `--at` 12 evenly spaced stills and a contact sheet with timestamps, for checking |
| `cuttle capture-page <url\|file> [--scroll] [--add] [--duration s] [--wait ms] [--width px] [--height px] [--name n]` | Capture a page (offscreen Chromium, scale 1) into `stills/`; `--add` appends a still scene (browser frame, scrolling with `--scroll`) |
| `cuttle render [--format 16:9\|1:1\|9:16] [-o file] [--encoder auto\|hardware\|software]` | Export (default `out/<format>.mp4` in the project) |
| `cuttle recover <take>` | Repair a take after a crash and use it: checks the tracks, drops a cut-off events line, rewrites a missing or broken markers.json or take.json |

Every command takes `-C <dir>` (the project folder, default the current one) and `--json`: exactly
one JSON document on stdout (the result, or `{ "error": { "code", "message" } }`), everything else
on stderr. Exit codes: 0 ok, 1 usage or validation error, 2 device or permission error, 3 render
error, 130 cancelled. Ctrl+C stops a recording (the take is kept) and cancels a render, preview or
capture (nothing is written); a second Ctrl+C quits at once. `render`, `preview` and `capture-page`
run in Electron, started by the Node CLI; the answer and a cancel travel over Node's IPC channel
(on Windows Electron has no console, so the console's Ctrl+C would not reach it).

`suggest` works in seconds of the take. Activity is input (±0.3 s per event), a changing screen and
Claude's turn (from its first prompt or tool call to the answer; never cut, because the screen
often shows only a spinner). It keeps 0.5 s before the first activity (2 s before a prompt) and
1 s after the last (2.5 s after the answer), cuts stretches without activity of 3 s or more down to
0.5 s on each side, and speeds up stretches without input of 8 s or more (1 s at 1× on each side,
the answer at 1×) to about a twelfth of their length, 3–10 s of video, at 2, 3, 4, 6, 8, 12, 16, 24,
32, 48 or 64×. The zoom frames what changed on screen around the answer; when that is most of the
screen, there is none and a note says so.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md docs/superpowers/specs/2026-10-16-cuttle-design.md
git commit -m "docs: the CLI in the README, roadmap and spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Final verification

- [ ] **Step 1: Unit, integration and golden tests, twice**

Run: `pnpm test`
Expected: PASS, `Test Files  40 passed | 2 skipped (42)` and `Tests  349 passed | 5 skipped (354)` (skipped: the real-capture test and the four Electron checks, which run with `pnpm cli:check`).

Run: `pnpm test`
Expected: the same again (nothing flaky, no golden rewritten).

- [ ] **Step 2: Typecheck and the Electron check**

Run: `pnpm typecheck`
Expected: exits with code 0 and prints the seven `tsc` commands.

Run: `pnpm cli:check`
Expected: PASS, 4 tests.

- [ ] **Step 3: The done criterion: the treg demo from its take**

The treg demo's raw take is a 2560×1440 ddagrab recording from before the recorder existed (spike notes, section 5). With the take converted to the recorder's format (`takes/1/screen.mp4` in BT.709 4:2:0, `takes/1/take.json` with its start time 2026-10-16T11:29:53.338+01:00), in that project folder:

```text
cuttle recover takes/1
cuttle suggest --claude C:\Users\ender\treg-demo
  (edit cuttle.json: a zoom on the answer, look.frame.title, a card scene "Claude Code + treg" / "treg.to")
cuttle capture-page <treg>\index.html --scroll --add --duration 6 --wait 2500
cuttle preview
cuttle render
```

Expected: `suggest` reads 8 markers from the transcript and proposes 1 s at 1×, about 145 s at 12× and the answer at 1×; the sheet shows the 12× badge, the zoom, the scrolling page and the card; `render` writes a ~24 s 1920×1080 MP4. (Done while planning: 713 frames, 23.77 s.)

- [ ] **Step 4: Ctrl+C by hand**

In PowerShell or cmd (Git Bash children ignore Ctrl+C), in a temp folder:

```text
node <repo>\apps\cli\dist\cuttle.mjs record --backend test --mic --max 60      → Ctrl+C after a few seconds
node <repo>\apps\cli\dist\cuttle.mjs render                                    → Ctrl+C while it renders
```

Expected: the recording stops (`stopping (stop) …`, exit 0, the take is in `takes/1`); the render stops with `error: the export was cancelled`, exit 130, and no `out/export.mp4`.

- [ ] **Step 5: Nothing left behind**

```bash
git status --short
ls "$TEMP" | grep -E '^cuttle-(cli|check|transcript|export)-' || echo "no temp folders left"
```

Expected: `git status` prints nothing, then `no temp folders left`.

---

## Spec coverage (M5 scope)

| Spec or roadmap item | Task |
|---|---|
| `cuttle init`, `devices`, `record` (every flag), `suggest`, `preview`, `capture-page`, `render`, `recover` | 4, 5 |
| `--json` on every command; exit codes 0/1/2/3 (and 130) | 2, 5 |
| `record`: Ctrl+C → `Recording.stop()`, `HOTKEYS` printed, the `Take` for `--json`, `sources` pointed at the take | 5 |
| `suggest`: trim idle start and end, speed up waiting, zoom on key moments, from markers, events and the transcript | 3, 5 |
| `preview`: stills or a contact sheet with timestamps | 1, 4, 6 |
| `capture-page`: a page as a still or scroll scene | 4, 6 |
| `render` in the bundled Electron; Ctrl+C and kills cancel the export; `uncaughtException` handler in a bootstrap entry; `window-all-closed` no-op | 4, 6 |
| `recover`: repair a take after a crash | 5 |
| `cuttle` on PATH (`pnpm link --global` on Windows, roadmap) | 7 |
| Snapshot tests pass | 5, 6 |
| The treg demo rebuilt from its take with `suggest`, a few JSON edits and `render` | 9 |
| `pnpm typecheck` covers the new package | 2 |

## Open points for later milestones

- **The treg rebuild lacks the typed prompt**: it was in an earlier take, and a project is one take. Several takes per project (and joining them) is a phase-2 question.
- **`suggest` sees no inside of a terminal**: a still screen is idle even when the user reads. The rules keep Claude's turn whole; demos without Claude rely on input and screen changes only.
- **`capture-page` waits a fixed time** after loading (`--wait`); pages that load content later need a longer wait. No cookie banners are dismissed.
- **The shims run the repo's build**: moving or deleting the repo breaks `cuttle`; `pnpm cli:install` again fixes it. A packaged CLI (npm package or the desktop app) is phase 2.
- **macOS**: the CLI runs, but recording needs the recorder's macOS backend (M4 open point).
- **M6 integration:** see the M6 bullet in the roadmap (background `record` and `render`, stop triggers Claude can use, `preview` sheets).

## Changes during execution

The code blocks above are the original plan. Its tasks were executed by replaying the plan
mechanically (twice, on fresh clones; byte-identical to the prototype) and bringing those commits
in; two code reviews (tasks 1–4 and 5–8) and a re-review of their fixes then found the defects
below. The repo is the source of truth. The CLI has 25 tests in Node (plus the 4 Electron checks)
instead of 20; the full `pnpm test` passes 354 tests in 40 files (5 skipped: the real-capture test
and the Electron checks).

- **`--json` (Task 5, both reviews):** commander's own usage errors (`--json nonsense`,
  `--json record --monitor x`) left stdout empty. With `--json` before a `--`, they now also print
  `{ "error": { "code": "usage", … } }`; commander's explanation stays on stderr. No command at
  all says so (`no command given`), and `--help` and `--version` answer as `{ "help": … }` and
  `{ "version": … }` (re-review). Electron's progress lines are left out with `--json` (`quiet` in
  the request). An internal error keeps its stack out of the JSON (stderr only).
- **Backups (Tasks 2, 5):** the single `cuttle.json.bak` was overwritten by the next command, so
  `record` → `suggest` lost a hand-made edit from both files. `backupFile` keeps `.bak` and up to
  four older versions (`.bak.1` … `.bak.4`), skips a backup identical to the newest one, and is
  used before a command replaces scenes or overlays in cuttle.json and before `recover` rewrites a
  take file. Writing cuttle.json retries a file that OneDrive or a scanner holds for a moment and
  removes its temp file on failure.
- **`recover` (Task 5):**
  - It reads cuttle.json first: a broken project stops it before the take changes.
  - For the take the project already uses, `sources` change and the scenes, zooms, masks and texts
    stay; a clip over the whole take is added only when there are no scenes (`useTake(…,
    keepEdit)`, `keptEdit` in the result).
  - A take.json that fails the schema (an unknown key, a newer version) is backed up, and its
    readable start times are kept (they sync webcam and mic and place Claude's markers). Without the
    screen's start, every track starts at 0 (re-review: a readable webcam start next to a screen at
    0 put the webcam 1.8·10⁹ s off).
- **`suggest` (Tasks 3, 5):**
  - Still and card scenes (a `capture-page --add`, a card) keep their place: those before the
    first clip (a title card) stay in front, the others after the clips; masks and texts stay as
    before.
  - Waiting after Claude's answer is sped up too: a wait around the answer becomes two speed-ups,
    with the answer at 1× between them.
  - The zoom's 75 % area check runs after the rect is fitted to the screen's aspect, as the
    timeline shows it (a tall, narrow change grew to a 1.0× "zoom").
  - Sources are resolved (absolute paths work); an unreadable events.jsonl and a `--claude` run
    that finds no markers (or a take.json without a start time) are reported as notes.
- **`record` (Task 5):** a Ctrl+C while the devices are listed or the project is read is no longer
  lost (exit 130 before the recorder starts, or a stop right after it starts). `--region` is
  variadic, because PowerShell passes `0,0,640,360` as four arguments. `--draw-mouse` sets
  `look.cursor.enabled` to `false` (the spec's warning about two cursors); a later take without
  it warns while the cursor is still off (re-review).
- **`capture-page` (Task 4):**
  - Ctrl+C cancels it (exit 130, no PNG, no scene); the command checks the signal before it adds
    the scene. Checked with a real console Ctrl+C: exit 130 after 1.06 s.
  - `--scroll` no longer resizes the viewport to the page's height, which stretched sections sized
    in `vh`: the viewport keeps its height, `Page.getLayoutMetrics` gives the content height and
    `captureBeyondViewport` takes the rest (works offscreen; the Electron check has a 100vh page,
    and the treg page still comes out 1920×2039 with its map). The re-review found that a viewport
    of fixed height never scrolls, so sections revealed on scroll (IntersectionObserver) and lazy
    images stayed blank: the page is now scrolled through a viewport at a time (150 ms each), back
    to the top, and measured again before the capture. The check's page has such a section (it
    stays white without the scrolling).
  - Pages load in an in-memory session that refuses every permission and every download.
  - One deadline (the wait plus 20 s) covers everything after loading; `--width` and `--height`
    take 1 to 16384.
- **`preview` (Tasks 1, 4):** stills are written into a work folder inside the output folder and
  moved there only when every one is done, so a cancelled or failed run adds nothing (checked
  with a real Ctrl+C after 6 of 12 stills). In the default `preview/` folder, stills of earlier
  runs (`NN-<t>s.png`, `sheet.png`) and work folders of killed runs (their process is gone) are
  removed first (`clean`). A work folder that cannot be removed no longer replaces the result or
  the error, and the moves retry a locked file (re-review).
- **Electron runner (Task 4):** a Ctrl+C before Electron started (or while it downloads) is not
  lost; Electron cancels its job when the CLI's IPC channel disconnects (a killed CLI on macOS and
  Linux, where no job object takes Electron along).
- **`streamSeconds` (Task 3):** a missing ffmpeg is reported as `ffmpeg-missing` (exit 2), not as
  an unreadable screen track.
- **Tests:** usage errors, `--help` and `--version` with `--json`, a region split at its commas
  with `--draw-mouse`, Ctrl+C in-process (SIGBREAK, handlers removed), rotating backups and kept
  title and end cards, recover keeping
  the edit, a broken take.json with its start time, a broken cuttle.json that leaves the take
  alone, the outside-the-project error code, a speed-up after the answer, a tall narrow zoom. The
  Electron check's comment on crossfades was wrong (a crossfade does not shorten the video).
- **Docs:** the spec's CLI section names the backups, what `suggest` keeps, `recover` relative to
  the project and its kept edit, `out/export.mp4` without `--format`, the capture session and
  `vh`; the skill's step 2 uses a short test take (a preview needs scenes). The decisions above
  that describe a single `.bak`, `recover` dropping the edit and take.json starts at 0 are
  superseded by these entries.

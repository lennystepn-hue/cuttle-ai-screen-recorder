# Cuttle M3: Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@cuttle/export`: render a `cuttle.json` project to an MP4 (H.264 High, AAC 48 kHz) in 16:9, 1:1 or 9:16 inside a hidden Electron window. The recordings are decoded with WebCodecs, every output frame is drawn by `@cuttle/engine`, encoded and muxed, and ffmpeg cuts the mic to the scene list. Partial output never reaches the target path.

**Architecture:** `exportProject` runs in Electron's main process: it validates the project folder (cuttle.json, take.json, events.jsonl, files), opens a hidden sandboxed window and serves the job's files to it over IPC by byte range. The page walks the timeline once to plan every output frame, decodes each scene's frames with Mediabunny (one decoder per scene and track, opened a second before the scene shows), renders them with the engine into an `OffscreenCanvas`, and encodes the canvas with Mediabunny's `CanvasSource` (WebCodecs `VideoEncoder`) into an MP4 that streams back to a temp file. A pure filter-graph builder then lets ffmpeg add the mic (cut, shifted, muted where sped up) as AAC, and the result is renamed into place.

**Tech Stack:** TypeScript 5, Electron 44 (Chromium 152: WebCodecs, WebGL2), Mediabunny 1.61.0 (demux, decode orchestration, encode, mux), ffmpeg 9 (audio pass, test fixtures), Vite 8 (bundles for the page and the main process), vitest 5.

Spec: `docs/superpowers/specs/2026-10-16-cuttle-design.md`. Roadmap and shared interfaces: `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`. M2 (done): `docs/superpowers/plans/2026-10-16-cuttle-m2-engine.md`. Spike notes with every measurement: `docs/superpowers/spikes/2026-10-16-m3-export-spike.md` (written against the prototype; where they differ, this plan wins).

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `m3-export`, in Git Bash (some steps use `grep`, `ls`, `rm` and `VAR=value command`); the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- `*.browser.test.ts` files run in headless Chromium (the `browser` vitest project); all other `*.test.ts` files run in Node (the `node` project). `pnpm test` runs both. In `packages/export`, `test/*.test.ts` cover the pure modules (typechecked with the DOM config `tsconfig.json`), `test/main/*.test.ts` use Node APIs (typechecked with `tsconfig.node.json`).
- The export page and `exportProject` are not unit-tested: H.264 needs Electron's Chromium (Playwright's Chromium has no H.264 decoder). They are checked by running them: `pnpm export:run` (Task 13) and `pnpm export:check` (Task 14). Both need **ffmpeg on PATH** (or its path in `CUTTLE_FFMPEG`; ffmpeg 9 was used, `winget install Gyan.FFmpeg`); the check also needs **ffprobe**. Electron's binary is already cached since M2. A GPU is used when present.
- Scratch output of manual runs goes to `out/`, which `.gitignore` already ignores.
- Golden images follow M2's convention: a new scenario writes its PNG on the first run and fails once with `golden created, look at it and run the tests again: <path>`; look at the PNG, then run again. Commit the PNG.

## Decisions made while planning

A spike and a full prototype (Electron 44.7.2 with Chromium 152.0.7977.149, Windows 11, AMD Radeon iGPU, ffmpeg 9.0, Node 22.16) settled these points. Every code block below ran: the plan was replayed mechanically, twice, on a fresh clone of `main` (b0d17d4), applying every file block and edit from this text and running every command, 15 commits; the result is byte-identical to the prototype. `pnpm test` passes 231 tests in 26 files twice in a row, `pnpm typecheck` is clean, `pnpm engine:electron` matches all 40 goldens with 0 differing pixels, `pnpm export:check` passes all three formats (300 frames, 10.000000 s video, audio and container each), and the 60 s 1080p30 benchmark took 17.5–18.0 s (0.29–0.30× the video's duration).

- **Library: Mediabunny only.** `mp4-muxer` is deprecated on npm ("This library is superseded by Mediabunny. Please migrate to it."); mp4box.js only demuxes. `mediabunny` (MPL-2.0, file-level copyleft: no obligation for Cuttle's own code; ship its licence notice with a distributed build) demuxes MP4 including fragmented MP4 (`Input` + `CustomSource`), drives `VideoDecoder` (`VideoSampleSink.samplesAtTimestamps`), drives `VideoEncoder` with back-pressure (`CanvasSource`) and muxes (`Output`, `Mp4OutputFormat`, `StreamTarget`). Pinned to **1.61.0** (2026-09-29): 1.61.1 and later were less than two weeks old when this plan was written. Checked: the recorder's fragmented MP4 (`-movflags +frag_keyframe+empty_moov+default_base_moof`), variable frame rate with a 2 s gap (the last frame before the gap is held), two decoders on one file at once (crossfade between clips of the same recording, a scene jumping back in source time), timestamps exact to 0.0000 s. `samplesAtTimestamps` decodes from the key frame before each needed time, decodes every packet at most once, skips GOPs that no time needs and yields `null` where it has no frame.
- **File access: IPC by byte range.** The sandboxed page (`contextIsolation`, no node integration) reads through a preload bridge (`window.cuttleHost`); the main process answers on the window's own `webContents.ipc` with `FileHandle.read` and serves only the job's files (allow-list), so multi-GB recordings never sit in memory and several exports in one process do not clash. Measured: ~0.4 ms per IPC call, 149 MB/s with 64 KiB reads, 355 MB/s with 1 MiB; Mediabunny's reads average ~100 KB; a 1800-frame export waits 0.3 s in total for decoded frames. The video-only MP4 streams back in 8 MiB chunks to a temp file (`fastStart: false`, positional writes). The page is loaded with `loadFile` (a secure context; WebCodecs is undefined on `data:` URLs) and has a CSP. A custom protocol with Range support (for `<video src>` in the phase-2 preview) was not needed here.
- **Encoding.** H.264 High at the smallest level that fits size, **frame rate** and bitrate: `avcCodecString` (Mediabunny's own string ignores the frame rate). 16:9 and 9:16 at 30 fps are `avc1.640028` (1080×1920 is 8160 macroblocks ≤ 8192), 1:1 is `avc1.640020`. VBR at 0.16 bit per pixel and frame (9.95 Mbit/s at 1080p30), a key frame every 2 s, `latencyMode: 'quality'`. `prefer-hardware` first, `prefer-software` when `VideoEncoder.isConfigSupported` says no; `encoder: 'hardware' | 'software'` forces one. On the reference PC both report support for `avc1.640028` at 1920×1080 and 1080×1920 (`quantizer` mode only in hardware). Hardware first follows the spec although Windows' software encoder (Media Foundation, also High profile) was faster there (60 s: 14.5 s vs 17.5 s) and wrote 3× smaller files (its rate control undershoots: 2–3 Mbit/s instead of 10, and it ignored a 75 Mbit/s target). On a scrolling-terminal fixture both keep text legible at 2× zoom; against a 75 Mbit/s hardware export, PSNR-Y is 60.1 dB for hardware at 10 Mbit/s and 37.8 dB for software. The export window renders on the real GPU (`ANGLE (AMD, AMD Radeon (TM) Graphics … Direct3D11 …)`, `MAX_TEXTURE_SIZE` 16384; SwiftShader would say 8192); every result reports this string. `CanvasSource.add(i / fps, 1 / fps)` gives ffprobe `nb_frames=300`, `duration=10.000000`. The loop checks `gl.isContextLost()` between `render` and encoding; a context lost at frame 100 (simulated) ends with exit code 3, no partial file and the previous target file untouched.
- **Decoding in software.** Hardware decode and hardware encode share the GPU's video engine. 60 s 1080p30 export with webcam, cursor, zoom, masks and texts: hardware decode 20.4 s, software decode 17.5 s (both with the hardware encoder); a 12× speed-up (5 s + 50 s at 12× + 5 s = 14.2 s of output) 12.6 s vs **5.9 s**. Sequential decode alone: 431 fps hardware, 1015 fps software. So `VideoSampleSink` gets `hardwareAcceleration: 'prefer-software'`. Each clip scene gets its own reader per track, created one second before it shows (decoding runs ahead in the background, the incoming crossfade frame is ready) and closed after its last frame. The encoder is the bottleneck (60 s: 13.5 s encode, 1.9 s render calls, 0.4 s waiting for frames), not the texture upload M2 worried about.
- **Audio graph.** A pure builder (`src/audio.ts`) cuts one segment per scene on the video's boundaries, in samples at 48 kHz; the last one ends at `frames / fps`, so audio and video end on the same sample. The mic is shifted once by its take.json offset (`adelay=<n>S` or `atrim=start_sample`), split per clip, trimmed by sample, sped up with `atempo` when `look.audio.muteSpedUp` is off (one filter covers 0.5–100 in ffmpeg 9; slower speeds chain), padded, faded and concatenated; stills, cards and muted clips are `anullsrc`. Cuts fade out and in over half the crossfade on each side (at least 10 ms): a short dip where the picture crossfades, never mic from outside a scene's range. Without a mic (or with `look.audio.enabled: false`) the file still gets a silent AAC track: uniform output, as the done criterion asks. **Gotcha:** when a clip's mic range lies past the mic's end, `apad` gets no frame and emits frames without timestamps; `concat` then fails with "Invalid data found when processing input". `asetpts=N/SR/TB` after the final trim fixes it (`atrim` counts samples, not timestamps). Measured sync: the fixture mic beeps at every mic second and starts 0.2 s before the screen; the beeps land at 0.800, 1.800, 2.800, 7.300 and 8.300 s, exactly where scenes and offset put them. The mux copies the video: `-c:v copy -c:a aac -b:a 160k -ar 48000 -movflags +faststart`.
- **Track sync: take.json.** M3 defines it in `@cuttle/project` (`TakeFileSchema`, `parseTakeJson`, `trackOffset`; the type is `TakeFile` because the roadmap's M4 already names the recorder's result `Take`); M4 writes it next to the take's tracks. Each track has its file name and `start`: seconds on one monotonic clock when its first frame or sample was captured. Track time = source time − (track start − screen start). An entry applies only when its file is the one `sources.<track>` points at; without take.json the tracks count as lined up. events.jsonl needs no entry (already in screen seconds). `cuttle.json` gets no new fields.
- **events.jsonl parsing moves to M3.** `parseEventsJsonl` in `@cuttle/project` (the roadmap had it as M4's first step): blank lines and CRLF are fine, an unterminated last line that is not JSON is dropped silently (a crashed recorder), every other bad line is an issue at `line <n>` or `line <n>.<field>`. Export treats issues as a validation error. An empty events.jsonl is valid (no input).
- **screenSize** comes from the screen track (`getDisplayWidth/Height`). A missing size, no video track, an undecodable codec, an unreadable or empty file fail with `invalid-media` naming the file. A take cut off mid-fragment is listed by the demuxer up to the fragment's end (8.33 s) although only 5.97 s of data exist; the reader yields no frame there, and the export fails with "the screen recording has no frame at 5.967 s (scenes[0]); the file may be cut off, end the scene earlier" instead of freezing the picture (which the first prototype did). A clip ending after the track's end (+50 ms) fails before rendering.
- **Timeline hold fix (Task 3).** Past a clip's end the timeline held `length − 1/fps`, which is up to one frame earlier than the last frame shown when the clip length is not a multiple of 1/fps: a 0–1.01 s clip at 30 fps gave frames 29–34 the source times `0.9667 1.0000 0.9767 0.9767 0.9767 0.9767`. The timeline now holds the last frame actually shown (`(ceil(end · fps) − 1) / fps`), so a clip's source time never goes back; the frame plan relies on that and throws if it ever does.
- **Stills** decode with `createImageBitmap(blob, { premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' })` and are decoded again at a smaller size when their longer side exceeds `MAX_TEXTURE_SIZE` (a 1280×20000 PNG exports fine). Band upload is not needed below 16384 px on a real GPU.
- **Packaging.** `@cuttle/export`'s `src/index.ts` is the main-process API. Two Vite builds: `vite.main.config.ts` bundles the Electron entries (`cli.ts`, `check.ts`) into self-contained `.mjs` files (workspace packages ship TypeScript, so `ssr.noExternal: true`; only `electron` stays external; shared chunks next to the entries), `vite.page.config.ts` bundles the page into one IIFE with the fonts inlined (as M2) and copies `index.html` and `preload.cjs`. `exportProject` finds the page in `export-page/` next to the bundle that contains it (`ExportOptions.pageDir` overrides). Vite first put the shared chunk into `dist/assets/`, where that lookup failed; `chunkFileNames: '[name]-[hash].mjs'` keeps it next to the entries. Electron surprises: closing an app's last window quits it (the export window stays open until ffmpeg is done, and the entries register a no-op `window-all-closed`); `process.argv` keeps Chromium switches (`electron --enable-logging x.mjs a` gives `[exe, '--enable-logging', 'x.mjs', 'a']`), so the CLI drops everything up to the script; Electron's default `uncaughtException` handler is a modal dialog, so the entries exit instead (the M2 review asked for this); page warnings and errors are forwarded to stderr, stdout stays free for JSON.
- **Colour.** Chromium decodes untagged HD H.264 as BT.709, while ffmpeg converts RGB with BT.601 unless told otherwise: an untagged fixture came out with shifted colours (red 253,0,0 became 255,23,0). Encoded with `scale=out_color_matrix=bt709:out_range=tv` and tagged `-colorspace bt709 -color_range tv`, the export reproduces testsrc within 2 (yellow 253,253,0; red 254,0,0). The fixture does this; **M4 must as well** (Task 15 writes it into the roadmap). The export is tagged `tv, bt709`. For byte comparisons, extract frames with `-vf scale=in_color_matrix=bt709:in_range=tv,format=rgb24`: ffmpeg 9's default PNG conversion applies the BT.709 transfer tag and shifts values (red 254,0,0 to 232,0,1).
- **Memory and leaks.** Peak working sets stay flat with length: 10 s export GPU process ~250 MB, page ~320 MB; 5 min (9000 frames, 80.7 s = 0.27×) GPU 240 MB, page 349 MB. Every decoded `VideoSample` and its `VideoFrame` copy is closed by its reader; `CanvasSource` closes its own frames.
- **Partial output.** Frames go to `<os tmp>/cuttle-export-*/video.mp4`; ffmpeg writes `.<name>.<random>.partial` next to the target, which is renamed at the end (replacing an existing file). On any failure the partial and the temp folder are deleted and an existing target stays. ffmpeg is checked (`ffmpeg -version`) before rendering, so a missing ffmpeg fails at once. Windows paths with spaces and umlauts work everywhere (the check's fixture lives in `%TEMP%\cuttle export Grüße …\Projekt mit Ümlaut`).
- **Recorder notes for M4** (Task 15 adds them to the roadmap): BT.709 matrix and tags; a key frame every 2 s (`-force_key_frames "expr:gte(t,n_forced*2)"`), because the fragment is the GOP: with libx264's default of 250 frames a crash loses up to 8 s and a scene starting mid-GOP decodes up to 249 extra frames.
- **Interface changes against the roadmap** (Task 15 updates the roadmap): `ExportOptions.format` is optional (without it the project's `output` size is used; its default is the 16:9 preset); `ExportOptions` gains `encoder?: 'auto' | 'hardware' | 'software'` and `pageDir?: string`; the result gains `stats` (GPU string, codec, acceleration, bitrate, timings); failures are `ExportError` with `code`: `invalid-project`, `missing-file`, `invalid-media` (CLI exit 1), `ffmpeg-missing` (2), `render` (3). New in `@cuttle/project`: `parseEventsJsonl`, `TakeFileSchema`, `parseTakeJson`, `trackOffset`, `TAKE_VERSION`, types `TakeFile`, `TakeFileTrack`, `TakeFileParseResult`. Mediabunny replaces mp4box.js and mp4-muxer in the tech stack.
- **M2 review notes handled:** one renderer per export and `loseContext()` at the end; `isContextLost()` before encoding; a webcam frame wherever the webcam track covers the source time; a golden for a clip→clip crossfade with a mask and a cursor (Task 4); popups and navigation denied, a CSP on the page, `uncaughtException` handled.

## File structure

```
cuttle/
├── package.json                      scripts: export:build, export:run, export:check; typecheck covers the export configs
├── README.md                         export package row, the two export scripts, the ffmpeg note
├── packages/project/
│   ├── src/events.ts                 parseEventsJsonl (new)
│   ├── src/take.ts                   TakeFileSchema, parseTakeJson, trackOffset (new)
│   ├── src/index.ts                  exports both
│   └── test/events.test.ts, test/take.test.ts
├── packages/timeline/
│   ├── src/frame.ts                  holds the last frame shown past a clip's end
│   └── test/frame.test.ts            + the off-grid hold test
├── packages/engine/test/
│   ├── scenarios.ts                  + crossfade-clips
│   └── __golden__/golden.browser.test.ts/crossfade-clips.win32.png
└── packages/export/
    ├── package.json                  @cuttle/export; engine, project, timeline, mediabunny 1.61.0 (exact)
    ├── tsconfig.json                 DOM: page, pure modules, their tests
    ├── tsconfig.node.json            Node: main process, its tests, entries, fixture, Vite configs
    ├── src/
    │   ├── index.ts                  main-process API (exportProject, ExportError, EXPORT_FORMATS, types)
    │   ├── formats.ts                output presets                                    (pure)
    │   ├── codec.ts                  H.264 codec string and bitrate                    (pure)
    │   ├── frame-plan.ts             frames per scene and the source times they need   (pure)
    │   ├── audio.ts                  audio segments, ffmpeg filter graph, mux arguments (pure)
    │   ├── job.ts                    contract between main process and page (types, IPC channels)
    │   ├── errors.ts                 ExportError with code
    │   ├── main/
    │   │   ├── files.ts              FileHost: allow-listed byte-range reads, positional writes
    │   │   ├── ffmpeg.ts             checkFfmpeg, runFfmpeg
    │   │   ├── sources.ts            loadSources: cuttle.json, take.json, events.jsonl, file checks
    │   │   ├── window.ts             hidden sandboxed export window
    │   │   └── export.ts             exportProject
    │   └── page/
    │       ├── host.ts               window.cuttleHost typing, PageError
    │       ├── media.ts              openVideo: Mediabunny Input over IPC
    │       ├── track-reader.ts       one decoder per scene and track
    │       ├── images.ts             still and background images
    │       ├── scene-sources.ts      opens scenes ahead, closes them after, FrameSources per frame
    │       ├── video-output.ts       encoder choice, CanvasSource, MP4 muxer, streaming target
    │       ├── run.ts                the frame loop
    │       └── index.ts              bundle entry
    ├── electron/
    │   ├── export-page/index.html    page with CSP
    │   ├── export-page/preload.cjs   contextBridge → window.cuttleHost
    │   ├── vite.page.config.ts       page bundle → dist/export-page/
    │   ├── vite.main.config.ts       cli.ts, check.ts → dist/*.mjs
    │   ├── cli.ts                    development CLI until M5 (pnpm export:run)
    │   └── check.ts                  the M3 done criterion end to end (pnpm export:check)
    └── test/
        ├── formats.test.ts, codec.test.ts, frame-plan.test.ts, audio.test.ts   (pure, DOM config)
        ├── main/files.test.ts, main/ffmpeg.test.ts, main/sources.test.ts        (Node APIs)
        └── fixture.ts                ffmpeg testsrc project builder for check.ts
```

---

### Task 1: Parse events.jsonl in `@cuttle/project`

The roadmap listed `parseEventsJsonl` as M4's first step; export needs the cursor track now, so it moves here. M4 and M5 import it.

**Files:**
- Create: `packages/project/src/events.ts`
- Modify: `packages/project/src/index.ts`
- Test: `packages/project/test/events.test.ts`

- [ ] **Step 1: Create the branch and write the failing test**

```bash
git switch main
git switch -c m3-export
```

`packages/project/test/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseEventsJsonl } from '../src/index';

describe('parseEventsJsonl', () => {
  it('parses one event per line and skips blank lines', () => {
    const text = '{"t":0,"type":"move","x":1,"y":2}\n\n{"t":0.5,"type":"click","x":3,"y":4,"button":"left"}\n';
    expect(parseEventsJsonl(text)).toEqual({
      events: [
        { t: 0, type: 'move', x: 1, y: 2 },
        { t: 0.5, type: 'click', x: 3, y: 4, button: 'left' },
      ],
      issues: [],
    });
  });

  it('drops a cut-off last line without an issue', () => {
    const text = '{"t":0,"type":"move","x":1,"y":2}\n{"t":0.1,"type":"mo';
    expect(parseEventsJsonl(text)).toEqual({ events: [{ t: 0, type: 'move', x: 1, y: 2 }], issues: [] });
  });

  it('reports broken lines in the middle and invalid events with their line number', () => {
    const text = '{"t":0,"type":"move","x":1,"y":2}\n{"t":0.1,"type":"mo\n{"t":-1,"type":"keys","count":2}\n';
    const result = parseEventsJsonl(text);
    expect(result.events).toHaveLength(1);
    expect(result.issues.map((issue) => issue.path)).toEqual(['line 2', 'line 3.t']);
  });

  it('accepts Windows line endings and a last line without a newline', () => {
    const text = '{"t":0,"type":"keys","count":1}\r\n{"t":1,"type":"shape","shape":"text"}';
    expect(parseEventsJsonl(text).events).toEqual([
      { t: 0, type: 'keys', count: 1 },
      { t: 1, type: 'shape', shape: 'text' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/project/test/events.test.ts`
Expected: FAIL, 4 tests fail with `TypeError: parseEventsJsonl is not a function`.

- [ ] **Step 3: Implement the parser and export it**

`packages/project/src/events.ts`:

```ts
import { formatPath, type ProjectIssue } from './parse';
import { InputEventSchema, type InputEvent } from './schema';

/**
 * Parses events.jsonl: one input event per line, blank lines ignored. A recorder that crashed can
 * leave the last line cut off; an unterminated last line that is not valid JSON is dropped without
 * an issue. Every other invalid line becomes an issue with the path `line <n>` (1-based) and is
 * left out of `events`.
 */
export function parseEventsJsonl(text: string): { events: InputEvent[]; issues: ProjectIssue[] } {
  const events: InputEvent[] = [];
  const issues: ProjectIssue[] = [];
  const lines = text.split('\n');
  const unterminated = !text.endsWith('\n');
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    const path = `line ${index + 1}`;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      if (unterminated && index === lines.length - 1) return;
      issues.push({ path, message: `Invalid JSON: ${(error as Error).message}` });
      return;
    }
    const result = InputEventSchema.safeParse(value);
    if (result.success) {
      events.push(result.data);
      return;
    }
    for (const issue of result.error.issues) {
      const field = issue.path.length > 0 ? `.${formatPath(issue.path)}` : '';
      issues.push({ path: `${path}${field}`, message: issue.message });
    }
  });
  return { events, issues };
}
```

In `packages/project/src/index.ts`, replace:

```ts
export { defaultProject } from './defaults';
```

with:

```ts
export { defaultProject } from './defaults';
export { parseEventsJsonl } from './events';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run packages/project/test/events.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm test`
Expected: PASS, 194 tests in 18 files.

- [ ] **Step 5: Commit**

```bash
git add packages/project/src/events.ts packages/project/src/index.ts packages/project/test/events.test.ts
git commit -m "project: parseEventsJsonl, tolerant of a cut-off last line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: take.json in `@cuttle/project`

The recorder (M4) writes each track's first-capture time on one clock; export lines the webcam and mic up with the screen from it.

**Files:**
- Create: `packages/project/src/take.ts`
- Modify: `packages/project/src/index.ts`
- Test: `packages/project/test/take.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/project/test/take.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseTakeJson, trackOffset } from '../src/index';

const take = {
  version: 1,
  tracks: {
    screen: { file: 'screen.mp4', start: 100.25 },
    webcam: { file: 'webcam.mp4', start: 100.75 },
    mic: { file: 'mic.m4a', start: 100.05 },
  },
};

describe('parseTakeJson', () => {
  it('reads the per-track start times', () => {
    const result = parseTakeJson(JSON.stringify(take));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trackOffset(result.take, 'webcam')).toBeCloseTo(0.5);
    expect(trackOffset(result.take, 'mic')).toBeCloseTo(-0.2);
  });

  it('has no offset for a track it does not list', () => {
    const result = parseTakeJson(JSON.stringify({ version: 1, tracks: { screen: take.tracks.screen } }));
    expect(result.ok && trackOffset(result.take, 'mic')).toBeUndefined();
  });

  it('names the path of an invalid field', () => {
    const result = parseTakeJson(JSON.stringify({ ...take, tracks: { ...take.tracks, mic: { file: 'mic.m4a' } } }));
    expect(result).toEqual({ ok: false, issues: [{ path: 'tracks.mic.start', message: expect.any(String) }] });
  });

  it('reports invalid JSON', () => {
    const result = parseTakeJson('{');
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/project/test/take.test.ts`
Expected: FAIL, 4 tests fail with `TypeError: parseTakeJson is not a function`.

- [ ] **Step 3: Implement the schema and export it**

`packages/project/src/take.ts`:

```ts
import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';

/** The take.json format version this build reads and the recorder writes. */
export const TAKE_VERSION = 1;

/**
 * When a track's first frame or sample was captured, in seconds on the take's one monotonic clock
 * (any origin). `file` is the track's file name inside the take folder.
 */
const TrackStartSchema = z.strictObject({
  file: z.string().min(1),
  start: z.number(),
});

/**
 * take.json, written by the recorder next to the take's tracks (e.g. `takes/1/take.json`). Export
 * reads it to line the webcam and the mic up with the screen track; events.jsonl is already in
 * screen-track seconds and needs no entry. (`TakeFile`, because `Take` is the recorder's result.)
 */
export const TakeFileSchema = z.strictObject({
  version: z.literal(TAKE_VERSION),
  tracks: z.strictObject({
    screen: TrackStartSchema,
    webcam: TrackStartSchema.optional(),
    mic: TrackStartSchema.optional(),
  }),
});

export type TakeFile = z.output<typeof TakeFileSchema>;
export type TakeFileTrack = keyof TakeFile['tracks'];

export type TakeFileParseResult = { ok: true; take: TakeFile } | { ok: false; issues: ProjectIssue[] };

export function parseTakeJson(text: string): TakeFileParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  const result = TakeFileSchema.safeParse(raw);
  if (result.success) return { ok: true, take: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}

/**
 * Seconds by which `track` started after the screen track (negative: before). A track time is
 * `sourceTime - offset`. Undefined when take.json does not list the track.
 */
export function trackOffset(take: TakeFile, track: Exclude<TakeFileTrack, 'screen'>): number | undefined {
  const entry = take.tracks[track];
  return entry === undefined ? undefined : entry.start - take.tracks.screen.start;
}
```

In `packages/project/src/index.ts`, replace:

```ts
export { parseEventsJsonl } from './events';
```

with:

```ts
export { parseEventsJsonl } from './events';
export { TAKE_VERSION, TakeFileSchema, parseTakeJson, trackOffset, type TakeFile, type TakeFileParseResult, type TakeFileTrack } from './take';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run packages/project/test/take.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm test`
Expected: PASS, 198 tests in 19 files.

- [ ] **Step 5: Commit**

```bash
git add packages/project/src/take.ts packages/project/src/index.ts packages/project/test/take.test.ts
git commit -m "project: take.json schema with per-track start times

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The timeline holds the last frame actually shown

Past a clip's end (the outgoing side of a crossfade) the timeline held `length − 1/fps`. When the clip length is not a multiple of 1/fps that is up to one frame earlier than the last frame shown before the end, so the source time went back by up to a frame. The export decodes each clip's source times in order and relies on them never going back.

**Files:**
- Modify: `packages/timeline/src/frame.ts`
- Test: `packages/timeline/test/frame.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/timeline/test/frame.test.ts`, replace:

```ts
    expect(sourceTime).toBeLessThan(5);
    expect(sourceTime).toBeCloseTo(5 - 1 / 30, 9);
  });
```

with:

```ts
    expect(sourceTime).toBeLessThan(5);
    expect(sourceTime).toBeCloseTo(5 - 1 / 30, 9);
  });

  it('holds the last frame shown when the clip ends between two frames', () => {
    const offGrid = parseProject({
      version: 1,
      sources: { screen: 's.mp4' },
      scenes: [
        { type: 'clip', from: 0, to: 1.01 },
        { type: 'card', title: 'End', duration: 1 },
      ],
    });
    if (!offGrid.ok) throw new Error('fixture');
    const t = createTimeline(offGrid.project, { screenSize });
    // At 30 fps, frame 30 (t = 1.0) is the last one inside [0, 1.01); frames 31 to 34 crossfade.
    const times = [29, 30, 31, 32, 34].map((frame) => t.frameAt(frame / 30).layers.find((l) => l.index === 0)?.sourceTime);
    expect(times).toEqual([29 / 30, 1, 1, 1, 1]);
  });
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/timeline/test/frame.test.ts`
Expected: FAIL, 1 of 18 tests: `holds the last frame shown when the clip ends between two frames`; the diff shows `0.9766666666666667` three times where `1` is expected.

- [ ] **Step 3: Hold the last frame shown**

In `packages/timeline/src/frame.ts`, replace:

```ts
    // Past the end, hold the clip's last output frame, which lies inside [from, to).
    const sourceLocal = t >= span.end ? Math.max(0, length - 1 / project.output.fps) : local;
```

with:

```ts
    // Past the end, hold the last output frame shown before it (frame i at i / fps): its source
    // time lies inside [from, to), and a clip's source time never goes back during a crossfade.
    const lastShown = (Math.ceil(span.end * project.output.fps - 1e-6) - 1) / project.output.fps;
    const sourceLocal = t >= span.end ? clamp(lastShown - span.start, 0, length) : local;
```

`clamp` is already imported from `./easing`. Span ends are snapped to whole microseconds, so the `1e-6` frame tolerance only absorbs floating-point noise. For clip lengths on the frame grid nothing changes (the existing hold tests still expect `20 - 1/30` and `5 - 1/30`).

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run packages/timeline`
Expected: PASS, 57 tests in 6 files.

Run: `pnpm test`
Expected: PASS, 199 tests in 19 files (no golden changes).

- [ ] **Step 5: Commit**

```bash
git add packages/timeline/src/frame.ts packages/timeline/test/frame.test.ts
git commit -m "timeline: past a clip's end, hold the last frame actually shown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Golden for a crossfade between two clips

The M2 reviews asked for one when the export first crossfades real clips: the outgoing clip keeps its mask and cursor on its held frame, the incoming clip starts at another source time.

**Files:**
- Modify: `packages/engine/test/scenarios.ts`
- Create (by the test run): `packages/engine/test/__golden__/golden.browser.test.ts/crossfade-clips.win32.png`

- [ ] **Step 1: Add the scenario**

In `packages/engine/test/scenarios.ts`, replace:

```ts
    t: 2,
  },

  // Other output formats: everything scales with the short side
```

with:

```ts
    t: 2,
  },
  // Crossfade between two clips of one recording, halfway: the outgoing clip holds its last frame
  // with its mask and cursor, the incoming clip starts at a later source time without either.
  {
    name: 'crossfade-clips',
    project: project(
      { frame: { title: TITLE } },
      {
        scenes: [
          { type: 'clip', from: 0, to: 2 },
          { type: 'clip', from: 6, to: 8 },
        ],
        masks: [{ from: 0, to: 2, rect: [270, 170, 700, 22], style: 'fill' }],
      },
    ),
    t: 2,
    events: [
      { t: 0, type: 'move', x: 400, y: 300 },
      { t: 2, type: 'move', x: 440, y: 340 },
      { t: 6, type: 'move', x: 900, y: 600 },
    ],
  },

  // Other output formats: everything scales with the short side
```

- [ ] **Step 2: Create the golden and look at it**

Run: `pnpm test`
Expected: FAIL, 1 failed | 199 passed (200): `crossfade-clips` with `golden created, look at it and run the tests again: …\packages\engine\test\__golden__\golden.browser.test.ts\crossfade-clips.win32.png`.

Open the PNG (640×360): the fake editor screen in a `mac-dark` window titled `claude · ~/treg-demo` on the sunset sky. The third row of code (source y 170) is dimmed to about half its colour across the editor area (the fill mask at 50 %), and two small half-transparent arrow cursors show: one in the left half of the code (source 440, 340) and one at the left edge of the white panel (source 900, 600); zoom in to see them. If the mask row is at full strength or a cursor is missing, the crossfade layers are wrong; fix the code, delete the PNG and repeat.

- [ ] **Step 3: Run the tests and the Electron check**

Run: `pnpm test`
Expected: PASS, 200 tests in 19 files.

Run: `pnpm engine:electron`
Expected: one `ok   <name> (0 px differ)` line per scenario, including `ok   crossfade-clips (0 px differ)`, and finally `all 40 scenarios match the goldens`.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/test/scenarios.ts packages/engine/test/__golden__/golden.browser.test.ts/crossfade-clips.win32.png
git commit -m "engine: golden for a crossfade between two clips with a mask and a cursor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The export package and its output formats

**Files:**
- Create: `packages/export/package.json`, `packages/export/tsconfig.json`, `packages/export/src/formats.ts`
- Modify: `package.json`
- Test: `packages/export/test/formats.test.ts`

- [ ] **Step 1: Create the package**

`packages/export/package.json`:

```json
{
  "name": "@cuttle/export",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@cuttle/engine": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/timeline": "workspace:*",
    "mediabunny": "1.61.0"
  }
}
```

Mediabunny is pinned exactly (see "Decisions"); the page code uses it from Task 11 on.

`packages/export/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  // The export page and the pure modules it shares with the main process. The main process and its
  // Node tests are in tsconfig.node.json.
  "include": ["src", "test/*.test.ts"],
  "exclude": ["src/index.ts", "src/main"]
}
```

In `package.json`, replace:

```json
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json"
```

with:

```json
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json"
```

Run: `pnpm install`
Expected: the workspace links `@cuttle/export`, `pnpm-lock.yaml` gains `mediabunny 1.61.0` (with `@types/dom-webcodecs` and `@types/dom-mediacapture-transform`); no errors.

- [ ] **Step 2: Write the failing test**

`packages/export/test/formats.test.ts`:

```ts
import { defaultProject } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { EXPORT_FORMATS, isExportFormat, withFormat } from '../src/formats';

describe('withFormat', () => {
  it('sets the output size of the preset and keeps the frame rate', () => {
    const project = defaultProject();
    project.output.fps = 60;
    expect(withFormat(project, '9:16').output).toEqual({ width: 1080, height: 1920, fps: 60 });
    expect(withFormat(project, '1:1').output).toEqual({ width: 1080, height: 1080, fps: 60 });
    expect(project.output.width).toBe(1920);
  });

  it('keeps the project output without a format', () => {
    const project = defaultProject();
    expect(withFormat(project, undefined)).toBe(project);
  });

  it('only knows the three presets', () => {
    expect(Object.keys(EXPORT_FORMATS)).toEqual(['16:9', '1:1', '9:16']);
    expect(isExportFormat('9:16')).toBe(true);
    expect(isExportFormat('4:3')).toBe(false);
    expect(isExportFormat('toString')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/export/test/formats.test.ts`
Expected: FAIL, the suite cannot load: `Error: Cannot find module '../src/formats' imported from …/packages/export/test/formats.test.ts` and `Tests  no tests`.

- [ ] **Step 4: Implement the formats**

`packages/export/src/formats.ts`:

```ts
import type { CuttleProject } from '@cuttle/project';

/** Output presets. The window frame and the content scale to fit; masks and zooms keep their source coordinates. */
export const EXPORT_FORMATS = {
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
} as const;

export type ExportFormat = keyof typeof EXPORT_FORMATS;

export function isExportFormat(value: string): value is ExportFormat {
  return Object.hasOwn(EXPORT_FORMATS, value);
}

/** The project with its output size set to `format`'s preset (fps unchanged); without a format, the project as it is. */
export function withFormat(project: CuttleProject, format: ExportFormat | undefined): CuttleProject {
  if (format === undefined) return project;
  return { ...project, output: { ...project.output, ...EXPORT_FORMATS[format] } };
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm exec vitest run packages/export/test/formats.test.ts`
Expected: PASS, 3 tests.

Run: `pnpm test`
Expected: PASS, 203 tests in 20 files.

Run: `pnpm typecheck`
Expected: exits with code 0 and prints the four `tsc` commands.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml packages/export
git commit -m "export: package skeleton and the 16:9, 1:1 and 9:16 presets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: H.264 codec string and bitrate

**Files:**
- Create: `packages/export/src/codec.ts`
- Test: `packages/export/test/codec.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/export/test/codec.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { avcCodecString, videoBitrate } from '../src/codec';

describe('videoBitrate', () => {
  it('is about 10 Mbit/s at 1080p30 and scales with pixels and frame rate', () => {
    expect(videoBitrate(1920, 1080, 30)).toBe(9_953_280);
    expect(videoBitrate(1080, 1920, 30)).toBe(videoBitrate(1920, 1080, 30));
    expect(videoBitrate(1920, 1080, 60)).toBe(2 * videoBitrate(1920, 1080, 30));
  });
});

describe('avcCodecString', () => {
  const at = (w: number, h: number, fps: number) => avcCodecString(w, h, fps, videoBitrate(w, h, fps));

  it('uses High profile at level 4 for the 16:9 and 9:16 presets at 30 fps', () => {
    expect(at(1920, 1080, 30)).toBe('avc1.640028');
    expect(at(1080, 1920, 30)).toBe('avc1.640028');
  });

  it('picks the smallest level for the frame size, frame rate and bitrate', () => {
    expect(at(1080, 1080, 30)).toBe('avc1.640020'); // 3.2
    expect(at(1920, 1080, 60)).toBe('avc1.64002a'); // 4.2
    expect(at(3840, 2160, 30)).toBe('avc1.640033'); // 5.1
    expect(at(4096, 4096, 30)).toBe('avc1.64003c'); // 6
    expect(avcCodecString(1920, 1080, 30, 30_000_000)).toBe('avc1.640029'); // 4.1 for the bitrate
  });

  it('covers everything the project schema allows and refuses larger outputs', () => {
    expect(at(4096, 4096, 120)).toBe('avc1.64003d'); // 6.1
    expect(() => avcCodecString(8192, 8192, 30, 10_000_000)).toThrow(/level 6.2/);
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/export/test/codec.test.ts`
Expected: FAIL, the suite cannot load: `Error: Cannot find module '../src/codec' imported from …/packages/export/test/codec.test.ts` and `Tests  no tests`.

- [ ] **Step 3: Implement the codec string**

`packages/export/src/codec.ts`:

```ts
/**
 * H.264 High profile levels (ITU-T H.264 Table A-1): the smallest level whose macroblock rate,
 * frame size and bitrate cover the output. High profile allows 1.25 × the Baseline/Main bitrate.
 */
const AVC_LEVELS = [
  { idc: 0x1f, maxMbps: 108_000, maxFs: 3_600, maxKbps: 14_000 }, // 3.1
  { idc: 0x20, maxMbps: 216_000, maxFs: 5_120, maxKbps: 20_000 }, // 3.2
  { idc: 0x28, maxMbps: 245_760, maxFs: 8_192, maxKbps: 20_000 }, // 4
  { idc: 0x29, maxMbps: 245_760, maxFs: 8_192, maxKbps: 50_000 }, // 4.1
  { idc: 0x2a, maxMbps: 522_240, maxFs: 8_704, maxKbps: 50_000 }, // 4.2
  { idc: 0x32, maxMbps: 589_824, maxFs: 22_080, maxKbps: 135_000 }, // 5
  { idc: 0x33, maxMbps: 983_040, maxFs: 36_864, maxKbps: 240_000 }, // 5.1
  { idc: 0x34, maxMbps: 2_073_600, maxFs: 36_864, maxKbps: 240_000 }, // 5.2
  { idc: 0x3c, maxMbps: 4_177_920, maxFs: 139_264, maxKbps: 240_000 }, // 6
  { idc: 0x3d, maxMbps: 8_355_840, maxFs: 139_264, maxKbps: 480_000 }, // 6.1
  { idc: 0x3e, maxMbps: 16_711_680, maxFs: 139_264, maxKbps: 800_000 }, // 6.2
] as const;

/** High profile allows this much more bitrate than the level table lists (Baseline/Main). */
const HIGH_BITRATE_FACTOR = 1.25;

/** Bits per output pixel and frame: about 10 Mbit/s at 1080p30, enough for sharp screen text. */
const BITS_PER_PIXEL = 0.16;

/** Target video bitrate in bit/s for an output size and frame rate. */
export function videoBitrate(width: number, height: number, fps: number): number {
  return Math.round(width * height * fps * BITS_PER_PIXEL);
}

/**
 * The WebCodecs codec string for H.264 High profile at the smallest level that fits, e.g.
 * `avc1.640028` (level 4) for 1920×1080 or 1080×1920 at 30 fps and 10 Mbit/s.
 */
export function avcCodecString(width: number, height: number, fps: number, bitrate: number): string {
  const mbWidth = Math.ceil(width / 16);
  const mbHeight = Math.ceil(height / 16);
  const frameSize = mbWidth * mbHeight;
  const level = AVC_LEVELS.find(
    (candidate) =>
      frameSize <= candidate.maxFs &&
      // A level also caps each side at sqrt(8 × MaxFS) macroblocks, so very thin frames need a higher level.
      Math.max(mbWidth, mbHeight) <= Math.sqrt(8 * candidate.maxFs) &&
      frameSize * fps <= candidate.maxMbps &&
      bitrate <= candidate.maxKbps * 1000 * HIGH_BITRATE_FACTOR,
  );
  if (!level) throw new Error(`avcCodecString: ${width}×${height} at ${fps} fps and ${bitrate} bit/s exceeds H.264 level 6.2`);
  return `avc1.6400${level.idc.toString(16).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run packages/export/test/codec.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm test`
Expected: PASS, 207 tests in 21 files.

- [ ] **Step 5: Commit**

```bash
git add packages/export/src/codec.ts packages/export/test/codec.test.ts
git commit -m "export: H.264 High codec string with the level from size, frame rate and bitrate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The frame plan

Walks the timeline once and records, per scene, the frames it is visible on (crossfades included) and the source times its frames need, in order. The page opens a scene's decoders from this plan and decodes exactly these times. It relies on Task 3: a clip's source time never goes back, so the times are collected in frame order without sorting, and the plan throws if one ever does (a timeline regression would otherwise show as a stuck frame).

**Files:**
- Create: `packages/export/src/frame-plan.ts`
- Test: `packages/export/test/frame-plan.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/export/test/frame-plan.test.ts`:

```ts
import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import { createTimeline } from '@cuttle/timeline';
import { describe, expect, it } from 'vitest';
import { frameCount, planFrames } from '../src/frame-plan';

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
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/export/test/frame-plan.test.ts`
Expected: FAIL, the suite cannot load: `Error: Cannot find module '../src/frame-plan' imported from …/packages/export/test/frame-plan.test.ts` and `Tests  no tests`.

- [ ] **Step 3: Implement the plan**

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
  const byIndex = new Map<number, ScenePlan>();
  for (let frame = 0; frame < frames; frame++) {
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
  return { fps, frames, scenes: [...byIndex.values()] };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run packages/export/test/frame-plan.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm test`
Expected: PASS, 211 tests in 22 files.

- [ ] **Step 5: Commit**

```bash
git add packages/export/src/frame-plan.ts packages/export/test/frame-plan.test.ts
git commit -m "export: frame plan with each scene's frames and source times

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Audio segments and the ffmpeg filter graph

**Files:**
- Create: `packages/export/src/audio.ts`
- Test: `packages/export/test/audio.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/export/test/audio.test.ts`:

```ts
import { parseProject, type CuttleProject, type CuttleProjectInput } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import { describe, expect, it } from 'vitest';
import { atempoChain, audioFilterGraph, muxArgs, planAudio } from '../src/audio';

function project(input: Omit<CuttleProjectInput, 'version' | 'sources'>): CuttleProject {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4', mic: 'm.m4a' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

const scenes: CuttleProjectInput['scenes'] = [
  { type: 'clip', from: 1, to: 3 },
  { type: 'clip', from: 3, to: 11, speed: 4 },
  { type: 'still', image: 'p.png', duration: 1 },
  { type: 'clip', from: 0.5, to: 1.5 },
];

function plan(input: Omit<CuttleProjectInput, 'version' | 'sources'>, seconds = 6, mic = true) {
  const p = project(input);
  return planAudio({ spans: sceneSpans(p.scenes), look: p.look, mic, seconds });
}

describe('planAudio', () => {
  it('cuts one segment per scene on the video boundaries, together exactly as long as the video', () => {
    const segments = plan({ scenes }, 6.02);
    expect(segments.map((s) => s.samples)).toEqual([96_000, 96_000, 48_000, 48_960]);
    expect(segments.reduce((sum, s) => sum + s.samples, 0)).toBe(Math.round(6.02 * 48_000));
  });

  it('plays the mic for clips, mutes sped-up clips and keeps stills silent', () => {
    const segments = plan({ scenes });
    expect(segments.map((s) => s.mic)).toEqual([
      { from: 48_000, to: 144_000, speed: 1 },
      undefined,
      undefined,
      { from: 24_000, to: 72_000, speed: 1 },
    ]);
    const loud = plan({ scenes, look: { audio: { muteSpedUp: false } } });
    expect(loud[1]!.mic).toEqual({ from: 144_000, to: 528_000, speed: 4 });
  });

  it('is silent without a mic or with audio switched off', () => {
    expect(plan({ scenes }, 6, false).every((s) => s.mic === undefined)).toBe(true);
    expect(plan({ scenes, look: { audio: { enabled: false } } }).every((s) => s.mic === undefined)).toBe(true);
  });

  it('fades over half the crossfade at cuts and 10 ms at the very start and end', () => {
    const segments = plan({ scenes });
    expect(segments[0]).toMatchObject({ fadeIn: 480, fadeOut: 7_200 });
    expect(segments[3]).toMatchObject({ fadeIn: 7_200, fadeOut: 480 });
    const hard = plan({ scenes, look: { transition: { enabled: false } } });
    expect(hard.every((s) => s.fadeIn === 480 && s.fadeOut === 480)).toBe(true);
  });
});

describe('atempoChain', () => {
  it('uses one filter from 0.5 to 100 and chains slower speeds', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(12)).toEqual(['atempo=12']);
    expect(atempoChain(0.2)).toEqual(['atempo=0.5', 'atempo=0.5', 'atempo=0.8']);
  });
});

describe('audioFilterGraph', () => {
  it('shifts the mic once, splits it per clip and concatenates the segments into stereo', () => {
    const graph = audioFilterGraph(plan({ scenes }), 0.5);
    expect(graph.split(';')).toEqual([
      '[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,adelay=delays=24000S:all=1,asplit=2[m0][m1]',
      '[m0]atrim=start_sample=48000:end_sample=144000,asetpts=N/SR/TB,apad,atrim=end_sample=96000,asetpts=N/SR/TB,afade=t=in:ss=0:ns=480,afade=t=out:ss=88800:ns=7200[s0]',
      'anullsrc=r=48000:cl=mono,atrim=end_sample=96000[s1]',
      'anullsrc=r=48000:cl=mono,atrim=end_sample=48000[s2]',
      '[m1]atrim=start_sample=24000:end_sample=72000,asetpts=N/SR/TB,apad,atrim=end_sample=48000,asetpts=N/SR/TB,afade=t=in:ss=0:ns=7200,afade=t=out:ss=47520:ns=480[s3]',
      '[s0][s1][s2][s3]concat=n=4:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]',
    ]);
  });

  it('drops the start of a mic that started before the screen', () => {
    expect(audioFilterGraph(plan({ scenes }), -0.25)).toContain('channel_layouts=mono,atrim=start_sample=12000,asetpts=N/SR/TB,asplit=2');
  });

  it('needs no mic input when every segment is silent', () => {
    const graph = audioFilterGraph(plan({ scenes }, 6, false));
    expect(graph).not.toContain('[1:a]');
    expect(graph.endsWith('concat=n=4:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]')).toBe(true);
  });
});

describe('muxArgs', () => {
  it('copies the video and encodes AAC at 48 kHz with the moov in front', () => {
    const args = muxArgs({ video: 'v.mp4', mic: 'm.m4a', graph: 'G', out: 'o.mp4' });
    expect(args.join(' ')).toBe(
      '-hide_banner -nostdin -loglevel error -y -i v.mp4 -i m.m4a -filter_complex G -map 0:v:0 -map [aout] -c:v copy -c:a aac -b:a 160k -ar 48000 -movflags +faststart -f mp4 o.mp4',
    );
    expect(muxArgs({ video: 'v.mp4', graph: 'G', out: 'o.mp4' })).not.toContain('m.m4a');
  });
});
```

The expected graph in `shifts the mic once, …` is the exact string ffmpeg runs in Task 14; every filter in it was checked with ffmpeg 9, including the `asetpts=N/SR/TB` after `apad` (see "Decisions").

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/export/test/audio.test.ts`
Expected: FAIL, the suite cannot load: `Error: Cannot find module '../src/audio' imported from …/packages/export/test/audio.test.ts` and `Tests  no tests`.

- [ ] **Step 3: Implement the audio plan**

`packages/export/src/audio.ts`:

```ts
import type { Look } from '@cuttle/project';
import type { SceneSpan } from '@cuttle/timeline';

/** Sample rate of the exported audio (AAC). */
export const AUDIO_SAMPLE_RATE = 48_000;
/** AAC bitrate of the exported audio, stereo. */
export const AUDIO_BITRATE = '160k';
/** Shortest fade at a cut, so hard cuts do not click. */
const MIN_FADE_SECONDS = 0.01;

/** One scene's stretch of the exported audio, in samples at `AUDIO_SAMPLE_RATE`. */
export interface AudioSegment {
  /** Length in output samples; segments are laid end to end. */
  samples: number;
  /** The mic stretch it plays, in samples of the mic lined up with the screen track; none means silence. */
  mic?: { from: number; to: number; speed: number };
  /** Fade lengths in output samples at the segment's start and end. */
  fadeIn: number;
  fadeOut: number;
}

export interface AudioPlanOptions {
  spans: readonly SceneSpan[];
  look: Pick<Look, 'audio' | 'transition'>;
  /** Whether a mic track is exported (the project has one and `look.audio.enabled`). */
  mic: boolean;
  /** Length of the exported video in seconds (frames / fps); the audio ends exactly there. */
  seconds: number;
}

const toSamples = (seconds: number): number => Math.round(seconds * AUDIO_SAMPLE_RATE);

/**
 * Cuts the audio into one segment per scene, on the same boundaries as the video. Clip scenes play
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
    if (audible) segment.mic = { from: toSamples(scene.from), to: toSamples(scene.to), speed: scene.speed };
    return segment;
  });
}

/** `atempo` filters for `speed`; one filter covers 0.5 to 100, slower speeds need a chain. */
export function atempoChain(speed: number): string[] {
  if (!(speed > 0)) throw new Error(`atempoChain: speed must be positive, got ${speed}`);
  const chain: string[] = [];
  let rest = speed;
  while (rest < 0.5) {
    chain.push('atempo=0.5');
    rest /= 0.5;
  }
  if (Math.abs(rest - 1) > 1e-9) chain.push(`atempo=${rest}`);
  return chain;
}

/**
 * The ffmpeg `-filter_complex` graph that turns the mic (input `micInput`) into the export's audio,
 * labelled `[aout]`: 48 kHz stereo, exactly the sum of the segments' samples long. `micOffset` is
 * how many seconds after the screen track the mic started (negative: before); the mic is shifted
 * once so its time 0 is the screen track's time 0. Without mic segments the graph is silence only.
 */
export function audioFilterGraph(segments: readonly AudioSegment[], micOffset = 0, micInput = 1): string {
  const filters: string[] = [];
  const micSegments = segments.filter((segment) => segment.mic !== undefined).length;
  if (micSegments > 0) {
    const shift = toSamples(micOffset);
    const align =
      shift > 0 ? [`adelay=delays=${shift}S:all=1`] : shift < 0 ? [`atrim=start_sample=${-shift}`, 'asetpts=N/SR/TB'] : [];
    const outputs = Array.from({ length: micSegments }, (_, i) => `[m${i}]`).join('');
    filters.push(
      [`[${micInput}:a]aresample=${AUDIO_SAMPLE_RATE}`, 'aformat=sample_fmts=fltp:channel_layouts=mono', ...align, `asplit=${micSegments}${outputs}`].join(','),
    );
  }
  let micIndex = 0;
  segments.forEach((segment, i) => {
    const chain: string[] = [];
    if (segment.mic) {
      chain.push(
        `[m${micIndex++}]atrim=start_sample=${segment.mic.from}:end_sample=${segment.mic.to}`,
        'asetpts=N/SR/TB',
        ...atempoChain(segment.mic.speed),
        // Pads a mic that ends early (or started late); without input frames apad's timestamps are
        // unset, so they are rebuilt after the trim or concat fails ("Invalid data found").
        'apad',
        `atrim=end_sample=${segment.samples}`,
        'asetpts=N/SR/TB',
      );
      if (segment.fadeIn > 0) chain.push(`afade=t=in:ss=0:ns=${segment.fadeIn}`);
      if (segment.fadeOut > 0) chain.push(`afade=t=out:ss=${segment.samples - segment.fadeOut}:ns=${segment.fadeOut}`);
    } else {
      chain.push(`anullsrc=r=${AUDIO_SAMPLE_RATE}:cl=mono`, `atrim=end_sample=${segment.samples}`);
    }
    filters.push(`${chain.join(',')}[s${i}]`);
  });
  const inputs = segments.map((_, i) => `[s${i}]`).join('');
  filters.push(`${inputs}concat=n=${segments.length}:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]`);
  return filters.join(';');
}

export interface MuxArgsOptions {
  /** The video-only MP4 from the frame loop. */
  video: string;
  /** The mic file, when the graph uses it. */
  mic?: string;
  graph: string;
  out: string;
}

/** ffmpeg arguments that add the audio to the video without re-encoding it: AAC 48 kHz, moov at the front. */
export function muxArgs({ video, mic, graph, out }: MuxArgsOptions): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-i',
    video,
    ...(mic ? ['-i', mic] : []),
    '-filter_complex',
    graph,
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    AUDIO_BITRATE,
    '-ar',
    String(AUDIO_SAMPLE_RATE),
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    out,
  ];
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run packages/export/test/audio.test.ts`
Expected: PASS, 9 tests.

Run: `pnpm test`
Expected: PASS, 220 tests in 23 files.

- [ ] **Step 5: Commit**

```bash
git add packages/export/src/audio.ts packages/export/test/audio.test.ts
git commit -m "export: audio segments on the scene boundaries and the ffmpeg filter graph

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Page contract, errors, file host and ffmpeg runner

The types both sides share, the error the CLI maps to exit codes, the main process's file access for the page, and ffmpeg.

**Files:**
- Create: `packages/export/src/job.ts`, `packages/export/src/errors.ts`, `packages/export/src/main/files.ts`, `packages/export/src/main/ffmpeg.ts`, `packages/export/tsconfig.node.json`
- Modify: `package.json`
- Test: `packages/export/test/main/files.test.ts`, `packages/export/test/main/ffmpeg.test.ts`

- [ ] **Step 1: Write the contract and the error**

`packages/export/src/job.ts`:

```ts
import type { CuttleProject, InputEvent } from '@cuttle/project';

/**
 * Contract between the main process and the export page. Pure types and constants: both sides
 * import this file, the preload script repeats the channel names (it cannot import TypeScript).
 */

export type EncoderPreference = 'auto' | 'hardware' | 'software';

/** Why an export failed; the CLI maps these to exit codes (see `ExportError`). */
export type ExportErrorCode = 'invalid-project' | 'missing-file' | 'invalid-media' | 'ffmpeg-missing' | 'render';

/** Everything the page needs for one export. Paths are absolute; the page may read only these files. */
export interface ExportJob {
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

export type PageResult = PageSuccess | PageFailure;

/** What the preload script exposes to the page as `window.cuttleHost`. */
export interface ExportHost {
  job(): Promise<ExportJob>;
  size(path: string): Promise<number>;
  /** Bytes `[start, end)` of a job file. */
  read(path: string, start: number, end: number): Promise<Uint8Array>;
  readFile(path: string): Promise<Uint8Array>;
  /** Writes into the video-only output file at a byte position. */
  write(data: Uint8Array, position: number): Promise<void>;
  progress(done: number, total: number): void;
}

/** IPC channel names; keep electron/export-page/preload.cjs in sync. */
export const CHANNELS = {
  job: 'cuttle-export:job',
  size: 'cuttle-export:size',
  read: 'cuttle-export:read',
  readFile: 'cuttle-export:read-file',
  write: 'cuttle-export:write',
  progress: 'cuttle-export:progress',
} as const;
```

`packages/export/src/errors.ts`:

```ts
import type { ExportErrorCode } from './job';

/**
 * An export failure with a cause the caller can act on. Suggested CLI exit codes (spec: 1 usage or
 * validation, 2 device or permission, 3 render): `invalid-project`, `missing-file` and
 * `invalid-media` → 1, `ffmpeg-missing` → 2, `render` → 3.
 */
export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExportError';
    this.code = code;
  }
}
```

`packages/export/tsconfig.node.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  // Electron main process and its tests, the dev CLI, the end-to-end check, the fixture builder and the bundle configs.
  "include": ["src/index.ts", "src/main", "test/main", "test/fixture.ts", "electron/*.ts"]
}
```

In `package.json`, replace:

```json
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json"
```

with:

```json
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json"
```

- [ ] **Step 2: Write the failing tests**

`packages/export/test/main/files.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileHost } from '../../src/main/files';

let dir: string;
let media: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cuttle-files-'));
  media = join(dir, 'screen.mp4');
  await writeFile(media, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  await writeFile(join(dir, 'cuttle.json'), '{}');
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe('FileHost', () => {
  it('reads sizes and byte ranges of the job files', async () => {
    const host = new FileHost([media], join(dir, 'out.mp4'));
    expect(await host.size(media)).toBe(10);
    expect([...(await host.read(media, 2, 5))]).toEqual([2, 3, 4]);
    expect([...(await host.read(media, 8, 20))]).toEqual([8, 9]);
    expect((await host.readFile(media)).length).toBe(10);
    await host.close();
  });

  it('refuses every other file', async () => {
    const host = new FileHost([media], join(dir, 'out.mp4'));
    await expect(host.read(join(dir, 'cuttle.json'), 0, 1)).rejects.toThrow('outside the job');
    await expect(host.readFile(join(dir, 'cuttle.json'))).rejects.toThrow('outside the job');
    await host.close();
  });

  it('writes the output at byte positions', async () => {
    const out = join(dir, 'out.mp4');
    const host = new FileHost([], out);
    await host.write(Uint8Array.from([5, 6, 7]), 2);
    await host.write(Uint8Array.from([1, 2]), 0);
    await host.close();
    expect([...(await readFile(out))]).toEqual([1, 2, 5, 6, 7]);
  });
});
```

`packages/export/test/main/ffmpeg.test.ts`:

```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkFfmpeg, ffmpegPath } from '../../src/main/ffmpeg';

afterEach(() => vi.unstubAllEnvs());

describe('ffmpeg', () => {
  it('runs ffmpeg from PATH unless CUTTLE_FFMPEG names another one', () => {
    vi.stubEnv('CUTTLE_FFMPEG', '');
    expect(ffmpegPath()).toBe('ffmpeg');
    vi.stubEnv('CUTTLE_FFMPEG', 'C:/tools/ffmpeg.exe');
    expect(ffmpegPath()).toBe('C:/tools/ffmpeg.exe');
  });

  it('says how to install ffmpeg when it is missing', async () => {
    vi.stubEnv('CUTTLE_FFMPEG', join(tmpdir(), 'no-such-ffmpeg'));
    await expect(checkFfmpeg()).rejects.toMatchObject({
      name: 'ExportError',
      code: 'ffmpeg-missing',
      message: expect.stringContaining('winget install Gyan.FFmpeg'),
    });
  });
});
```

The ffmpeg test needs no ffmpeg: it points `CUTTLE_FFMPEG` at a file that does not exist.

- [ ] **Step 3: Run the tests to make sure they fail**

Run: `pnpm exec vitest run packages/export/test/main`
Expected: FAIL, both files: the suite cannot load: `Error: Cannot find module '../../src/main/files' imported from …/packages/export/test/main/files.test.ts` and `Tests  no tests` and the same for `../../src/main/ffmpeg`.

- [ ] **Step 4: Implement the file host and the ffmpeg runner**

`packages/export/src/main/files.ts`:

```ts
import { open, readFile, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * The files one export page may touch: reads only from the job's sources (by absolute path), writes
 * only into the video-only output. Streams media by byte range, so multi-GB recordings never sit in
 * memory.
 */
export class FileHost {
  private readonly allowed: Set<string>;
  private readonly handles = new Map<string, Promise<FileHandle>>();
  private output: Promise<FileHandle> | undefined;

  constructor(
    readable: Iterable<string>,
    private readonly outputPath: string,
  ) {
    this.allowed = new Set([...readable].map((path) => resolve(path)));
  }

  private handle(path: string): Promise<FileHandle> {
    const key = resolve(path);
    if (!this.allowed.has(key)) throw new Error(`the export page asked for a file outside the job: ${path}`);
    let handle = this.handles.get(key);
    if (!handle) {
      handle = open(key, 'r');
      this.handles.set(key, handle);
    }
    return handle;
  }

  async size(path: string): Promise<number> {
    return (await (await this.handle(path)).stat()).size;
  }

  async read(path: string, start: number, end: number): Promise<Uint8Array> {
    const handle = await this.handle(path);
    const buffer = Buffer.allocUnsafe(end - start);
    const { bytesRead } = await handle.read(buffer, 0, end - start, start);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
  }

  async readFile(path: string): Promise<Uint8Array> {
    await this.handle(path); // allow-list check
    return readFile(resolve(path));
  }

  async write(data: Uint8Array, position: number): Promise<void> {
    this.output ??= open(this.outputPath, 'w');
    const handle = await this.output;
    let written = 0;
    while (written < data.byteLength) {
      const { bytesWritten } = await handle.write(data, written, data.byteLength - written, position + written);
      written += bytesWritten;
    }
  }

  async close(): Promise<void> {
    const all = [...this.handles.values(), ...(this.output ? [this.output] : [])];
    this.handles.clear();
    this.output = undefined;
    await Promise.allSettled(all.map(async (handle) => (await handle).close()));
  }
}
```

`packages/export/src/main/ffmpeg.ts`:

```ts
import { spawn } from 'node:child_process';
import { ExportError } from '../errors';

/** The ffmpeg executable: `CUTTLE_FFMPEG` when set, otherwise `ffmpeg` from PATH. */
export function ffmpegPath(): string {
  return process.env.CUTTLE_FFMPEG || 'ffmpeg';
}

/** Lines of ffmpeg's stderr kept for an error message. */
const STDERR_TAIL_LINES = 12;

/** Fails fast with `ffmpeg-missing` before minutes of rendering, instead of at the audio step. */
export function checkFfmpeg(): Promise<void> {
  return runFfmpeg(['-hide_banner', '-version']);
}

/** Runs ffmpeg and resolves when it exits with 0; otherwise rejects with the end of its stderr. */
export function runFfmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(
          new ExportError(
            'ffmpeg-missing',
            `ffmpeg was not found (looked for "${ffmpegPath()}"). Install it (Windows: winget install Gyan.FFmpeg, macOS: brew install ffmpeg) or set CUTTLE_FFMPEG to its path.`,
            { cause: error },
          ),
        );
      } else {
        reject(new ExportError('render', `ffmpeg could not start: ${error.message}`, { cause: error }));
      }
    });
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const tail = stderr.trim().split(/\r?\n/).slice(-STDERR_TAIL_LINES).join('\n');
      reject(new ExportError('render', `ffmpeg exited with code ${code}:\n${tail}`));
    });
  });
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm exec vitest run packages/export/test/main`
Expected: PASS, 5 tests in 2 files.

Run: `pnpm test`
Expected: PASS, 225 tests in 25 files.

Run: `pnpm typecheck`
Expected: exits with code 0 and prints the five `tsc` commands.

- [ ] **Step 6: Commit**

```bash
git add package.json packages/export/tsconfig.node.json packages/export/src/job.ts packages/export/src/errors.ts packages/export/src/main packages/export/test/main
git commit -m "export: page contract, ExportError, allow-listed file host and ffmpeg runner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Loading the project's sources

Reads and validates cuttle.json, take.json and events.jsonl and checks every file the export reads, before any window opens.

**Files:**
- Create: `packages/export/src/main/sources.ts`
- Test: `packages/export/test/main/sources.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/export/test/main/sources.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadSources } from '../../src/main/sources';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const TAKE = {
  version: 1,
  tracks: {
    screen: { file: 'screen.mp4', start: 100 },
    webcam: { file: 'webcam.mp4', start: 100.5 },
    mic: { file: 'mic.m4a', start: 99.8 },
  },
};

const EVENTS = '{"t":0,"type":"move","x":1,"y":2}\n{"t":1,"type":"click","x":3,"y":4,"button":"left"}\n';

/** A project folder: cuttle.json from `project`, plus `files` (path → content, "" for an empty file). */
async function projectDir(project: Record<string, unknown>, files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cuttle-sources-'));
  dirs.push(dir);
  await writeFile(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, ...project }));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

const SOURCES = { screen: 'take/screen.mp4', webcam: 'take/webcam.mp4', mic: 'take/mic.m4a', events: 'take/events.jsonl' };
const MEDIA = { 'take/screen.mp4': 'v', 'take/webcam.mp4': 'w', 'take/mic.m4a': 'a', 'take/events.jsonl': EVENTS, 'page.png': 'p' };
const SCENES = [
  { type: 'clip', from: 0, to: 1 },
  { type: 'still', image: 'page.png', duration: 1 },
];

describe('loadSources', () => {
  it('resolves the files the look uses and lines the tracks up with take.json', async () => {
    const dir = await projectDir(
      { sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES },
      { ...MEDIA, 'take/take.json': JSON.stringify(TAKE) },
    );
    const sources = await loadSources(dir);
    expect(sources.screen).toBe(join(dir, 'take', 'screen.mp4'));
    expect(sources.webcam?.path).toBe(join(dir, 'take', 'webcam.mp4'));
    expect(sources.webcam?.offset).toBeCloseTo(0.5, 9);
    expect(sources.mic?.offset).toBeCloseTo(-0.2, 9);
    expect(sources.events).toHaveLength(2);
    expect(sources.stills).toEqual({ 1: join(dir, 'page.png') });
  });

  it('leaves out what the look switches off', async () => {
    const dir = await projectDir(
      { sources: SOURCES, look: { webcam: { enabled: false }, audio: { enabled: false }, cursor: { enabled: false } }, scenes: SCENES },
      MEDIA,
    );
    const sources = await loadSources(dir);
    expect(sources.webcam).toBeUndefined();
    expect(sources.mic).toBeUndefined();
    expect(sources.events).toBeUndefined();
  });

  it('takes the tracks as lined up without take.json and ignores entries for other files', async () => {
    const plain = await projectDir({ sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES }, MEDIA);
    expect((await loadSources(plain)).mic?.offset).toBe(0);
    const other = { ...TAKE, tracks: { ...TAKE.tracks, mic: { file: 'other.m4a', start: 99 } } };
    const swapped = await projectDir(
      { sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES },
      { ...MEDIA, 'take/take.json': JSON.stringify(other) },
    );
    const sources = await loadSources(swapped);
    expect(sources.mic?.offset).toBe(0);
    expect(sources.webcam?.offset).toBeCloseTo(0.5, 9);
  });

  it('names a missing or empty media file, but accepts empty events', async () => {
    const noWebcam = Object.fromEntries(Object.entries(MEDIA).filter(([path]) => path !== 'take/webcam.mp4'));
    const missing = await projectDir({ sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES }, noWebcam);
    await expect(loadSources(missing)).rejects.toMatchObject({ code: 'missing-file', message: expect.stringContaining('webcam recording (sources.webcam) not found') });
    const empty = await projectDir({ sources: SOURCES, scenes: SCENES }, { ...MEDIA, 'take/screen.mp4': '' });
    await expect(loadSources(empty)).rejects.toMatchObject({ code: 'invalid-media', message: expect.stringContaining('is empty (0 bytes)') });
    const quiet = await projectDir({ sources: SOURCES, scenes: SCENES }, { ...MEDIA, 'take/events.jsonl': '' });
    expect((await loadSources(quiet)).events).toEqual([]);
  });

  it('reports invalid cuttle.json, take.json and events.jsonl with their paths', async () => {
    const project = await projectDir({ sources: SOURCES, scenes: [{ type: 'clip', from: 2, to: 1 }] }, MEDIA);
    await expect(loadSources(project)).rejects.toMatchObject({ code: 'invalid-project', message: expect.stringContaining('scenes[0].to') });
    const take = await projectDir({ sources: SOURCES, scenes: SCENES }, { ...MEDIA, 'take/take.json': '{"version":1,"tracks":{}}' });
    await expect(loadSources(take)).rejects.toMatchObject({ code: 'invalid-project', message: expect.stringContaining('tracks.screen') });
    const events = await projectDir({ sources: SOURCES, scenes: SCENES }, { ...MEDIA, 'take/events.jsonl': '{"t":-1,"type":"keys","count":1}\n' });
    await expect(loadSources(events)).rejects.toMatchObject({ code: 'invalid-project', message: expect.stringContaining('line 1.t') });
  });

  it('refuses a folder without cuttle.json and a project without scenes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cuttle-sources-'));
    dirs.push(dir);
    await expect(loadSources(dir)).rejects.toMatchObject({ code: 'missing-file', message: expect.stringContaining('no cuttle.json') });
    const empty = await projectDir({ sources: SOURCES, scenes: [] }, MEDIA);
    await expect(loadSources(empty)).rejects.toMatchObject({ code: 'invalid-project', message: expect.stringContaining('has no scenes') });
  });
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run: `pnpm exec vitest run packages/export/test/main/sources.test.ts`
Expected: FAIL, the suite cannot load: `Error: Cannot find module '../../src/main/sources' imported from …/packages/export/test/main/sources.test.ts` and `Tests  no tests`.

- [ ] **Step 3: Implement loadSources**

`packages/export/src/main/sources.ts`:

```ts
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseEventsJsonl, parseProjectJson, parseTakeJson, trackOffset, type CuttleProject, type InputEvent, type TakeFile } from '@cuttle/project';
import { ExportError } from '../errors';

/** cuttle.json inside the project folder. */
export const PROJECT_FILE = 'cuttle.json';
/** take.json next to the screen track. */
export const TAKE_FILE = 'take.json';

/** The project's files resolved and checked, ready for an export. */
export interface ProjectSources {
  project: CuttleProject;
  screen: string;
  webcam?: { path: string; offset: number };
  mic?: { path: string; offset: number };
  events?: InputEvent[];
  stills: Record<number, string>;
  backgroundImage?: string;
}

const issuesText = (issues: readonly { path: string; message: string }[]): string =>
  issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');

/**
 * Absolute path of a project file that exists. Media must not be empty (a recorder killed at once
 * leaves 0 bytes); an empty events.jsonl is fine (no input events).
 */
async function existing(projectDir: string, relative: string, what: string, media = true): Promise<string> {
  const path = resolve(projectDir, relative);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    throw new ExportError('missing-file', `${what} not found: ${path}`);
  }
  if (media && size === 0) throw new ExportError('invalid-media', `${what} is empty (0 bytes): ${path}`);
  return path;
}

async function readTake(screen: string): Promise<TakeFile | undefined> {
  const path = join(dirname(screen), TAKE_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined; // no take.json: the tracks are taken as already lined up
  }
  const result = parseTakeJson(text);
  if (!result.ok) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(result.issues)}`);
  return result.take;
}

/** Offset of a track from take.json, only when take.json describes that very file. */
function offsetFor(take: TakeFile | undefined, track: 'webcam' | 'mic', path: string, screen: string): number {
  const entry = take?.tracks[track];
  if (!take || !entry || resolve(dirname(screen), entry.file) !== path) return 0;
  return trackOffset(take, track) ?? 0;
}

/**
 * Reads and validates cuttle.json, take.json and events.jsonl and checks that every file the
 * export reads exists. Sources that the look switches off are left out.
 */
export async function loadSources(projectDir: string): Promise<ProjectSources> {
  const projectPath = join(projectDir, PROJECT_FILE);
  let text: string;
  try {
    text = await readFile(projectPath, 'utf8');
  } catch {
    throw new ExportError('missing-file', `no ${PROJECT_FILE} in ${projectDir}`);
  }
  const parsed = parseProjectJson(text);
  if (!parsed.ok) throw new ExportError('invalid-project', `${projectPath} is invalid:\n${issuesText(parsed.issues)}`);
  const project = parsed.project;
  if (project.scenes.length === 0) throw new ExportError('invalid-project', `${projectPath} has no scenes`);
  const { look, sources } = project;

  const screen = await existing(projectDir, sources.screen, 'screen recording (sources.screen)');
  const take = await readTake(screen);
  const result: ProjectSources = { project, screen, stills: {} };

  if (look.webcam.enabled && sources.webcam) {
    const path = await existing(projectDir, sources.webcam, 'webcam recording (sources.webcam)');
    result.webcam = { path, offset: offsetFor(take, 'webcam', path, screen) };
  }
  if (look.audio.enabled && sources.mic) {
    const path = await existing(projectDir, sources.mic, 'mic recording (sources.mic)');
    result.mic = { path, offset: offsetFor(take, 'mic', path, screen) };
  }
  if (look.cursor.enabled && sources.events) {
    const path = await existing(projectDir, sources.events, 'input events (sources.events)', false);
    const events = parseEventsJsonl(await readFile(path, 'utf8'));
    if (events.issues.length > 0) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(events.issues)}`);
    result.events = events.events;
  }
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type === 'still') result.stills[index] = await existing(projectDir, scene.image, `image of scene ${index}`);
  }
  if (look.background.preset === 'image' && look.background.image) {
    result.backgroundImage = await existing(projectDir, look.background.image, 'background image (look.background.image)');
  }
  return result;
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm exec vitest run packages/export/test/main/sources.test.ts`
Expected: PASS, 6 tests.

Run: `pnpm test`
Expected: PASS, 231 tests in 26 files.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/export/src/main/sources.ts packages/export/test/main/sources.test.ts
git commit -m "export: load and validate the project's sources, take offsets and events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Page: reading the media

The page side runs in Electron's renderer and cannot be unit-tested (no H.264 in Playwright's Chromium); this task must typecheck, and Task 13 runs it.

**Files:**
- Create: `packages/export/src/page/host.ts`, `packages/export/src/page/media.ts`, `packages/export/src/page/track-reader.ts`, `packages/export/src/page/images.ts`

- [ ] **Step 1: The bridge to the main process**

`packages/export/src/page/host.ts`:

```ts
import type { ExportErrorCode, ExportHost, PageResult } from '../job';

declare global {
  interface Window {
    /** Set by the preload script. */
    cuttleHost: ExportHost;
    /** Set by the page; the main process calls `run()` once. */
    cuttleExport: { run(): Promise<PageResult> };
  }
}

export function host(): ExportHost {
  return window.cuttleHost;
}

/** A failure the page can name precisely; anything else counts as a render error. */
export class PageError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PageError';
  }
}
```

- [ ] **Step 2: Opening a video over IPC**

`packages/export/src/page/media.ts`:

```ts
import { ALL_FORMATS, CustomSource, Input, type InputVideoTrack } from 'mediabunny';
import { host, PageError } from './host';

/** An opened video file: its first video track, display size and time range in seconds. */
export interface VideoFile {
  input: Input;
  track: InputVideoTrack;
  size: { width: number; height: number };
  /** Timestamp of the first frame and end of the last one. */
  start: number;
  end: number;
}

/**
 * Opens a video through the main process, reading only the byte ranges the demuxer asks for.
 * Fragmented MP4 (what the recorder writes) works, including a file cut off by a crash.
 */
export async function openVideo(path: string, what: string): Promise<VideoFile> {
  const source = new CustomSource({
    getSize: () => host().size(path),
    read: (start, end) => host().read(path, start, end),
    prefetchProfile: 'fileSystem',
  });
  const input = new Input({ source, formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new PageError('invalid-media', `${what} has no video track: ${path}`);
    if (!(await track.canDecode())) {
      throw new PageError('invalid-media', `${what} uses a codec this build cannot decode (${await track.getCodecParameterString()}): ${path}`);
    }
    const size = { width: await track.getDisplayWidth(), height: await track.getDisplayHeight() };
    if (!(size.width > 0 && size.height > 0)) {
      throw new PageError('invalid-media', `${what} does not say its frame size (a take cut off by a crash? run cuttle recover): ${path}`);
    }
    const start = await input.getFirstTimestamp([track]);
    const end = await input.computeDuration([track]);
    if (!(end > start)) throw new PageError('invalid-media', `${what} has no frames: ${path}`);
    return { input, track, size, start, end };
  } catch (error) {
    input.dispose();
    if (error instanceof PageError) throw error;
    throw new PageError('invalid-media', `${what} could not be read (${error instanceof Error ? error.message : String(error)}): ${path}`);
  }
}
```

`fileSystem` prefetching reads a little around each request; the reads average ~100 KB.

- [ ] **Step 3: One reader per scene and track**

`packages/export/src/page/track-reader.ts`:

```ts
import { VideoSampleSink, type InputVideoTrack, type VideoSample, type VideoSinkDecoderOptions } from 'mediabunny';

/**
 * Decoded frames of one track for one scene. `times` (ascending, no duplicates) are all the track
 * times the scene will ask for; decoding starts at once in the background, from the key frame before
 * the first time, and skips whole GOPs that no time needs (sped-up scenes).
 */
export class TrackReader {
  private readonly samples: AsyncGenerator<VideoSample | null, void, unknown>;
  private next = 0;
  private current: { sample: VideoSample; frame: VideoFrame } | undefined;
  private closed = false;

  constructor(
    track: InputVideoTrack,
    private readonly times: readonly number[],
    decoder: VideoSinkDecoderOptions,
  ) {
    this.samples = new VideoSampleSink(track, decoder).samplesAtTimestamps(times);
  }

  /**
   * The frame shown at `time`: the one decoded for the newest planned time up to `time`. Times
   * never go back; asking for the same time again (a held crossfade layer) returns the same frame.
   * Undefined where the track has no frame: before its first frame, or where a cut-off file has no
   * data (the demuxer can list samples whose bytes are missing). The frame stays valid until a later
   * call moves on or `close()`; do not close it.
   */
  async frameAt(time: number): Promise<VideoFrame | undefined> {
    if (this.closed) throw new Error('TrackReader: read after close');
    while (this.next < this.times.length && this.times[this.next]! <= time) {
      const result = await this.samples.next();
      this.next++;
      this.release();
      if (result.done) break;
      if (result.value) this.current = { sample: result.value, frame: result.value.toVideoFrame() };
    }
    return this.current?.frame;
  }

  private release(): void {
    this.current?.frame.close();
    this.current?.sample.close();
    this.current = undefined;
  }

  /** Stops decoding and frees every frame. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.release();
    await this.samples.return(undefined);
  }
}
```

`frameAt` closes the previous sample and its `VideoFrame` copy whenever it moves on, and a `null` from Mediabunny (no frame for that time, e.g. a cut-off take) makes it return `undefined` instead of holding an old frame.

- [ ] **Step 4: Still and background images**

`packages/export/src/page/images.ts`:

```ts
import { host, PageError } from './host';

/**
 * Decodes a PNG or JPEG for the engine: premultiplied, not flipped, and scaled down to fit
 * `maxSize` on its longer side (the GPU's MAX_TEXTURE_SIZE) when it is larger.
 */
export async function loadImage(path: string, maxSize: number, what: string): Promise<ImageBitmap> {
  const blob = new Blob([(await host().readFile(path)) as Uint8Array<ArrayBuffer>]);
  const options: ImageBitmapOptions = { premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, options);
  } catch (error) {
    throw new PageError('invalid-media', `${what} is not an image this build can decode (${(error as Error).message}): ${path}`);
  }
  const longer = Math.max(bitmap.width, bitmap.height);
  if (longer <= maxSize) return bitmap;
  const scale = maxSize / longer;
  const width = Math.max(1, Math.floor(bitmap.width * scale));
  const height = Math.max(1, Math.floor(bitmap.height * scale));
  bitmap.close();
  return createImageBitmap(blob, { ...options, resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm test`
Expected: PASS, 231 tests in 26 files (nothing new runs in Node).

- [ ] **Step 6: Commit**

```bash
git add packages/export/src/page
git commit -m "export page: IPC bridge, video input, per-scene track readers, images

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Page: frame loop, encoder and bundle

**Files:**
- Create: `packages/export/src/page/scene-sources.ts`, `packages/export/src/page/video-output.ts`, `packages/export/src/page/run.ts`, `packages/export/src/page/index.ts`
- Create: `packages/export/electron/export-page/index.html`, `packages/export/electron/export-page/preload.cjs`, `packages/export/electron/vite.page.config.ts`

- [ ] **Step 1: Scene sources**

`packages/export/src/page/scene-sources.ts`:

```ts
import type { FrameSources } from '@cuttle/engine';
import type { RenderState } from '@cuttle/timeline';
import type { VideoSinkDecoderOptions } from 'mediabunny';
import type { FramePlan, ScenePlan } from '../frame-plan';
import { PageError } from './host';
import { loadImage } from './images';
import type { VideoFile } from './media';
import { TrackReader } from './track-reader';

export interface SceneMedia {
  screen: VideoFile;
  /** `offset`: seconds the webcam started after the screen; webcam time = source time − offset. */
  webcam?: VideoFile & { offset: number };
  /** Scene index → image path of a still scene. */
  stills: Readonly<Record<number, string>>;
  maxTextureSize: number;
  decoder: VideoSinkDecoderOptions;
}

interface OpenScene {
  plan: ScenePlan;
  screen?: TrackReader;
  webcam?: TrackReader;
  still?: Promise<ImageBitmap>;
}

/**
 * Opens each scene's decoders (or its still image) `lookahead` frames before it first shows, so
 * decoding runs ahead in the background, and closes them after its last frame. Hands the renderer
 * the frames for every visible layer.
 */
export class SceneSources {
  private readonly open = new Map<number, OpenScene>();
  private readonly pending: ScenePlan[];
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };

  constructor(
    plan: FramePlan,
    private readonly media: SceneMedia,
    private readonly lookahead: number,
  ) {
    this.pending = [...plan.scenes];
  }

  private screenTime(sourceTime: number): number {
    return Math.max(sourceTime, this.media.screen.start);
  }

  /** Webcam time for a source time, or undefined where the webcam track has no frame. */
  private webcamTime(sourceTime: number): number | undefined {
    const webcam = this.media.webcam;
    if (!webcam) return undefined;
    const time = sourceTime - webcam.offset;
    return time >= webcam.start && time < webcam.end ? time : undefined;
  }

  private openScene(plan: ScenePlan): OpenScene {
    const { screen, webcam, decoder } = this.media;
    if (plan.kind === 'clip') {
      const screenTimes = [...new Set(plan.sourceTimes.map((t) => this.screenTime(t)))];
      const webcamTimes = plan.sourceTimes.map((t) => this.webcamTime(t)).filter((t): t is number => t !== undefined);
      return {
        plan,
        screen: new TrackReader(screen.track, screenTimes, decoder),
        webcam: webcam && webcamTimes.length > 0 ? new TrackReader(webcam.track, webcamTimes, decoder) : undefined,
      };
    }
    if (plan.kind === 'still') {
      const path = this.media.stills[plan.index];
      if (path === undefined) throw new Error(`no image path for still scene ${plan.index}`);
      const still = loadImage(path, this.media.maxTextureSize, `the image of scene ${plan.index}`);
      still.catch(() => {}); // awaited when the scene shows; avoid an unhandled rejection before that
      return { plan, still };
    }
    return { plan };
  }

  /** Frames for every layer of `state`, which is output frame `frame`. */
  async sourcesFor(frame: number, state: RenderState): Promise<FrameSources> {
    while (this.pending.length > 0 && this.pending[0]!.firstFrame <= frame + this.lookahead) {
      const plan = this.pending.shift()!;
      this.open.set(plan.index, this.openScene(plan));
    }
    const { screens, webcams, stills } = this.sources;
    screens.clear();
    webcams.clear();
    stills.clear();
    for (const layer of state.layers) {
      const scene = this.open.get(layer.index);
      if (!scene) throw new Error(`scene ${layer.index} shows on frame ${frame}, outside its planned frames`);
      if (layer.sourceTime !== undefined && scene.screen) {
        const screenFrame = await scene.screen.frameAt(this.screenTime(layer.sourceTime));
        if (!screenFrame) {
          throw new PageError(
            'invalid-media',
            `the screen recording has no frame at ${layer.sourceTime.toFixed(3)} s (scenes[${layer.index}]); the file may be cut off, end the scene earlier`,
          );
        }
        screens.set(layer.index, screenFrame);
        const webcamTime = this.webcamTime(layer.sourceTime);
        const webcamFrame = webcamTime === undefined ? undefined : await scene.webcam?.frameAt(webcamTime);
        if (webcamFrame) webcams.set(layer.index, webcamFrame);
      } else if (scene.still) {
        stills.set(layer.index, await scene.still);
      }
    }
    return this.sources;
  }

  /** Closes the scenes whose last frame was `frame`. */
  async release(frame: number): Promise<void> {
    for (const [index, scene] of this.open) {
      if (scene.plan.lastFrame > frame) continue;
      this.open.delete(index);
      await closeScene(scene);
    }
  }

  async close(): Promise<void> {
    const scenes = [...this.open.values()];
    this.open.clear();
    await Promise.allSettled(scenes.map(closeScene));
  }
}

async function closeScene(scene: OpenScene): Promise<void> {
  await scene.screen?.close();
  await scene.webcam?.close();
  if (scene.still) (await scene.still.catch(() => undefined))?.close();
}
```

- [ ] **Step 2: Encoder and muxer**

`packages/export/src/page/video-output.ts`:

```ts
import type { Output as OutputSettings } from '@cuttle/project';
import { CanvasSource, Mp4OutputFormat, Output, Quality, StreamTarget, type StreamTargetChunk } from 'mediabunny';
import { avcCodecString, videoBitrate } from '../codec';
import type { EncoderPreference } from '../job';
import { host, PageError } from './host';

type Acceleration = 'prefer-hardware' | 'prefer-software';

/** Seconds between key frames. */
const KEY_FRAME_INTERVAL = 2;
/** Bytes collected before one write to the main process. */
const WRITE_CHUNK_BYTES = 8 * 1024 * 1024;

export interface VideoOutput {
  codec: string;
  hardwareAcceleration: Acceleration;
  bitrate: number;
  /** Encodes the canvas as it is now; resolves when the encoder and the writer can take more. */
  add(timestamp: number, duration: number): Promise<void>;
  finalize(): Promise<void>;
  cancel(): Promise<void>;
}

const CANDIDATES: Record<EncoderPreference, Acceleration[]> = {
  auto: ['prefer-hardware', 'prefer-software'],
  hardware: ['prefer-hardware'],
  software: ['prefer-software'],
};

async function chooseAcceleration(codec: string, settings: OutputSettings, bitrate: number, preference: EncoderPreference): Promise<Acceleration> {
  for (const hardwareAcceleration of CANDIDATES[preference]) {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec,
      width: settings.width,
      height: settings.height,
      framerate: settings.fps,
      bitrate,
      bitrateMode: 'variable',
      latencyMode: 'quality',
      hardwareAcceleration,
      avc: { format: 'avc' },
    });
    if (supported) return hardwareAcceleration;
  }
  throw new PageError('render', `no ${preference === 'auto' ? '' : `${preference} `}H.264 encoder for ${codec} at ${settings.width}×${settings.height}, ${settings.fps} fps`);
}

/**
 * H.264 High encoder plus MP4 muxer for the canvas. The MP4 (video only, moov at the end) streams
 * to the main process in chunks; ffmpeg moves the moov to the front when it adds the audio.
 */
export async function createVideoOutput(canvas: OffscreenCanvas, settings: OutputSettings, preference: EncoderPreference): Promise<VideoOutput> {
  const bitrate = videoBitrate(settings.width, settings.height, settings.fps);
  const codec = avcCodecString(settings.width, settings.height, settings.fps, bitrate);
  const hardwareAcceleration = await chooseAcceleration(codec, settings, bitrate, preference);
  const writable = new WritableStream<StreamTargetChunk>({ write: (chunk) => host().write(chunk.data, chunk.position) });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable, { chunked: true, chunkSize: WRITE_CHUNK_BYTES }),
  });
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    fullCodecString: codec,
    quality: new Quality({ bitrate, bitrateMode: 'variable' }),
    keyFrameInterval: KEY_FRAME_INTERVAL,
    latencyMode: 'quality',
    hardwareAcceleration,
  });
  output.addVideoTrack(source, { frameRate: settings.fps });
  await output.start();
  return {
    codec,
    hardwareAcceleration,
    bitrate,
    add: (timestamp, duration) => source.add(timestamp, duration),
    finalize: () => output.finalize(),
    cancel: () => output.cancel(),
  };
}
```

- [ ] **Step 3: The frame loop and the bundle entry**

`packages/export/src/page/run.ts`:

```ts
import { createRenderer, loadEngineAssets } from '@cuttle/engine';
import { createCursorTrack, createTimeline } from '@cuttle/timeline';
import type { VideoSinkDecoderOptions } from 'mediabunny';
import { planFrames } from '../frame-plan';
import type { ExportJob, PageResult, PageSuccess } from '../job';
import { host, PageError } from './host';
import { loadImage } from './images';
import { openVideo, type VideoFile } from './media';
import { SceneSources } from './scene-sources';
import { createVideoOutput } from './video-output';

/** Seconds before a scene first shows that its decoders start. */
const LOOKAHEAD_SECONDS = 1;
/**
 * Decode in software: Chromium's software H.264 decoder is multi-threaded and keeps the GPU's video
 * engine free for the encoder. On the reference PC it made a 12× speed-up export 2.1× faster and a
 * plain 60 s export 1.2× faster than hardware decoding.
 */
const DECODER: VideoSinkDecoderOptions = { hardwareAcceleration: 'prefer-software' };
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

function checkClipRanges(job: ExportJob, screen: VideoFile): void {
  job.project.scenes.forEach((scene, index) => {
    if (scene.type === 'clip' && scene.to > screen.end + END_TOLERANCE_SECONDS) {
      throw new PageError(
        'invalid-project',
        `scenes[${index}] ends at ${scene.to} s, but the screen recording ends at ${screen.end.toFixed(3)} s`,
      );
    }
  });
}

async function exportVideo(job: ExportJob): Promise<PageSuccess> {
  const started = performance.now();
  const { project } = job;
  const fps = project.output.fps;
  const [assets, screen, webcam] = await Promise.all([
    loadEngineAssets(),
    openVideo(job.screen, 'the screen recording'),
    job.webcam ? openVideo(job.webcam.path, 'the webcam recording') : undefined,
  ]);
  const canvas = new OffscreenCanvas(1, 1);
  let background: ImageBitmap | undefined;
  let sources: SceneSources | undefined;
  let renderer: ReturnType<typeof createRenderer> | undefined;
  try {
    checkClipRanges(job, screen);
    const timeline = createTimeline(project, {
      screenSize: screen.size,
      cursor: job.events ? createCursorTrack(job.events) : undefined,
    });
    const plan = planFrames(timeline, fps);
    if (job.backgroundImage) background = await loadImage(job.backgroundImage, probeMaxTextureSize(), 'the background image');
    renderer = createRenderer(canvas, project, { assets, screenSize: screen.size, backgroundImage: background });
    const gl = canvas.getContext('webgl2')!;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const output = await createVideoOutput(canvas, project.output, job.encoder);
    sources = new SceneSources(
      plan,
      { screen, webcam: webcam && job.webcam ? { ...webcam, offset: job.webcam.offset } : undefined, stills: job.stills, maxTextureSize, decoder: DECODER },
      Math.round(LOOKAHEAD_SECONDS * fps),
    );

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

/** Runs the export the main process prepared; never throws, failures come back as `{ ok: false }`. */
export async function run(): Promise<PageResult> {
  try {
    return await exportVideo(await host().job());
  } catch (error) {
    // Unexpected errors keep their stack on stderr (the main process forwards page errors).
    if (!(error instanceof PageError)) console.error(error);
    return {
      ok: false,
      code: error instanceof PageError ? error.code : 'render',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
```

`packages/export/src/page/index.ts`:

```ts
// Entry of the export page bundle (electron/vite.page.config.ts).
import { run } from './run';

window.cuttleExport = { run };
```

- [ ] **Step 4: The page, the preload bridge and the bundle config**

`packages/export/electron/export-page/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <!-- The page loads only its own script; fonts are inlined, cursor art and images become blob: URLs. -->
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self'; img-src blob: data:; font-src data:; worker-src blob:"
    />
    <title>Cuttle export</title>
  </head>
  <body>
    <script src="./page.js"></script>
  </body>
</html>
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
});
```

A sandboxed preload must be CommonJS and cannot import TypeScript, so it repeats the channel names of `CHANNELS` in `src/job.ts`.

`packages/export/electron/vite.page.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The export page: one classic script (library mode inlines the engine's fonts as data: URLs), plus
// index.html and preload.cjs copied from export-page/. Output: packages/export/dist/export-page/.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: 'export-page',
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: '../dist/export-page',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('../src/page/index.ts', import.meta.url)),
      formats: ['iife'],
      name: 'CuttleExportPage',
      fileName: () => 'page.js',
    },
  },
});
```

- [ ] **Step 5: Typecheck and build the page**

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm exec vite build --config packages/export/electron/vite.page.config.ts`
Expected: no output (log level `warn`), exit code 0.

Run: `ls packages/export/dist/export-page`
Expected: `index.html`, `page.js`, `preload.cjs`.

Run: `grep -c "data:font/woff2;base64" packages/export/dist/export-page/page.js`
Expected: `2` (both Inter weights are inlined; `dist/` is ignored by git).

- [ ] **Step 6: Commit**

```bash
git add packages/export/src/page packages/export/electron
git commit -m "export page: scene sources, H.264 output, frame loop, page bundle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Main process, development CLI and a first export

**Files:**
- Create: `packages/export/src/main/window.ts`, `packages/export/src/main/export.ts`, `packages/export/src/index.ts`
- Create: `packages/export/electron/cli.ts`, `packages/export/electron/vite.main.config.ts`
- Modify: `package.json`

- [ ] **Step 1: The export window**

`packages/export/src/main/window.ts`:

```ts
import { join } from 'node:path';
import { BrowserWindow } from 'electron';

export interface ExportWindow {
  win: BrowserWindow;
  /** Rejects when the page's renderer process dies (a pending executeJavaScript would never settle). */
  gone: Promise<never>;
}

/**
 * A hidden, sandboxed window for the export page. Loaded from a file (a secure context, which
 * WebCodecs needs; a data: URL is not). It renders on the real GPU unless the app switched
 * hardware acceleration off.
 */
export async function openExportWindow(pageDir: string): Promise<ExportWindow> {
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 360,
    webPreferences: {
      preload: join(pageDir, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Long exports must not be slowed down by timer throttling of hidden pages.
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  // Page warnings and errors go to stderr; stdout stays free for machine-readable output.
  win.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error') console.error(`[export page] ${event.message}`);
  });
  const gone = new Promise<never>((_, reject) => {
    win.webContents.on('render-process-gone', (_event, details) => {
      reject(new Error(`the export page's renderer is gone: ${details.reason} (exit code ${details.exitCode})`));
    });
  });
  gone.catch(() => {}); // observed by the caller through Promise.race; avoid an unhandled rejection otherwise
  await win.loadFile(join(pageDir, 'index.html'));
  return { win, gone };
}
```

- [ ] **Step 2: exportProject and the public API**

`packages/export/src/main/export.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sceneSpans } from '@cuttle/timeline';
import { app } from 'electron';
import { audioFilterGraph, muxArgs, planAudio } from '../audio';
import { ExportError } from '../errors';
import { withFormat, type ExportFormat } from '../formats';
import { CHANNELS, type EncoderPreference, type ExportJob, type PageResult, type PageSuccess } from '../job';
import { checkFfmpeg, runFfmpeg } from './ffmpeg';
import { FileHost } from './files';
import { loadSources } from './sources';
import { openExportWindow, type ExportWindow } from './window';

export interface ExportOptions {
  projectDir: string;
  /** Output preset; without one the project's `output` size is used (its default is 16:9 1920×1080). */
  format?: ExportFormat;
  /** Target file. Written only when the export succeeded (a temp file next to it is renamed). */
  out: string;
  /** Called after each rendered frame. */
  onProgress?: (done: number, total: number) => void;
  /** H.264 encoder: hardware when available (`auto`, the default), or one of them forced. */
  encoder?: EncoderPreference;
  /** Folder of the export page bundle; defaults to `export-page` next to the bundle that contains this code. */
  pageDir?: string;
}

export interface ExportStats {
  gpu: string;
  codec: string;
  hardwareAcceleration: PageSuccess['hardwareAcceleration'];
  bitrate: number;
  page: PageSuccess['timings'];
  audioMs: number;
  totalMs: number;
}

export interface ExportResult {
  out: string;
  frames: number;
  /** Length of the exported video in seconds (frames / fps). */
  seconds: number;
  stats: ExportStats;
}

function defaultPageDir(): string {
  return fileURLToPath(new URL('./export-page/', import.meta.url));
}

async function runPage(window: ExportWindow): Promise<PageSuccess> {
  let result: PageResult;
  try {
    result = await Promise.race([window.win.webContents.executeJavaScript('window.cuttleExport.run()') as Promise<PageResult>, window.gone]);
  } catch (error) {
    throw new ExportError('render', error instanceof Error ? error.message : String(error), { cause: error });
  }
  if (!result.ok) throw new ExportError(result.code, result.message);
  return result;
}

/**
 * Renders a project to an MP4 (H.264 High + AAC 48 kHz) in a hidden window: decode, render with the
 * engine, encode, mux; then ffmpeg cuts the mic to the scenes and adds it. Runs in Electron's main
 * process. Partial output never reaches `out`.
 */
export async function exportProject(opts: ExportOptions): Promise<ExportResult> {
  const started = performance.now();
  await app.whenReady();
  const projectDir = resolve(opts.projectDir);
  const out = resolve(opts.out);
  const sources = await loadSources(projectDir);
  await checkFfmpeg();
  const project = withFormat(sources.project, opts.format);
  const job: ExportJob = {
    project,
    screen: sources.screen,
    webcam: sources.webcam,
    events: sources.events,
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    encoder: opts.encoder ?? 'auto',
  };

  await mkdir(dirname(out), { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'cuttle-export-'));
  const video = join(work, 'video.mp4');
  const partial = join(dirname(out), `.${basename(out)}.${randomUUID().slice(0, 8)}.partial`);
  const readable = [sources.screen, ...(sources.webcam ? [sources.webcam.path] : []), ...Object.values(sources.stills)];
  if (sources.backgroundImage) readable.push(sources.backgroundImage);
  const files = new FileHost(readable, video);
  let window: ExportWindow | undefined;
  try {
    window = await openExportWindow(opts.pageDir ?? defaultPageDir());
    const ipc = window.win.webContents.ipc;
    ipc.handle(CHANNELS.job, () => job);
    ipc.handle(CHANNELS.size, (_event, path: string) => files.size(path));
    ipc.handle(CHANNELS.read, (_event, path: string, start: number, end: number) => files.read(path, start, end));
    ipc.handle(CHANNELS.readFile, (_event, path: string) => files.readFile(path));
    ipc.handle(CHANNELS.write, (_event, data: Uint8Array, position: number) => files.write(data, position));
    ipc.on(CHANNELS.progress, (_event, done: number, total: number) => opts.onProgress?.(done, total));

    const page = await runPage(window);
    // The window stays open until the end: closing an app's last window quits it by default.
    await files.close(); // flushes the video-only MP4 before ffmpeg reads it

    const audioStarted = performance.now();
    const seconds = page.frames / project.output.fps;
    const segments = planAudio({ spans: sceneSpans(project.scenes), look: project.look, mic: sources.mic !== undefined, seconds });
    const usesMic = segments.some((segment) => segment.mic !== undefined);
    const graph = audioFilterGraph(segments, sources.mic?.offset ?? 0);
    await runFfmpeg(muxArgs({ video, mic: usesMic ? sources.mic?.path : undefined, graph, out: partial }));
    try {
      await rename(partial, out);
    } catch (error) {
      throw new ExportError('render', `could not replace ${out} (is it open in a player?): ${(error as Error).message}`, { cause: error });
    }
    return {
      out,
      frames: page.frames,
      seconds,
      stats: {
        gpu: page.gpu,
        codec: page.codec,
        hardwareAcceleration: page.hardwareAcceleration,
        bitrate: page.bitrate,
        page: page.timings,
        audioMs: Math.round(performance.now() - audioStarted),
        totalMs: Math.round(performance.now() - started),
      },
    };
  } catch (error) {
    await rm(partial, { force: true });
    if (error instanceof ExportError) throw error;
    throw new ExportError('render', error instanceof Error ? error.message : String(error), { cause: error });
  } finally {
    window?.win.destroy();
    await files.close();
    await rm(work, { recursive: true, force: true });
  }
}
```

`packages/export/src/index.ts`:

```ts
// Main-process API (Electron). Bundle it with Vite: the packages ship TypeScript source.
export { exportProject, type ExportOptions, type ExportResult, type ExportStats } from './main/export';
export { ExportError } from './errors';
export { EXPORT_FORMATS, isExportFormat, type ExportFormat } from './formats';
export type { EncoderPreference, ExportErrorCode } from './job';
```

- [ ] **Step 3: The development CLI and the main-process bundle**

`packages/export/electron/cli.ts`:

```ts
// Development entry until apps/cli exists (M5):
//   pnpm export:run <projectDir> [--format 16:9|1:1|9:16] [-o <file>] [--encoder auto|hardware|software]
// Prints the result as JSON. Exit codes as in the spec: 1 usage or validation, 2 missing ffmpeg, 3 render.
import { join } from 'node:path';
import { app } from 'electron';
import { ExportError, exportProject, isExportFormat, type EncoderPreference, type ExportErrorCode, type ExportFormat } from '../src/index';

const EXIT_CODES: Record<ExportErrorCode, number> = {
  'invalid-project': 1,
  'missing-file': 1,
  'invalid-media': 1,
  'ffmpeg-missing': 2,
  render: 3,
};

const USAGE = 'usage: pnpm export:run <projectDir> [--format 16:9|1:1|9:16] [-o <file>] [--encoder auto|hardware|software]';

interface CliArgs {
  projectDir: string;
  format?: ExportFormat;
  out?: string;
  encoder: EncoderPreference;
}

/** The user's arguments: `electron [chromium switches] <script> <args>` keeps the switches in process.argv. */
function userArgs(): string[] {
  const args = process.argv.slice(1);
  if (process.defaultApp) args.splice(0, args.findIndex((arg) => !arg.startsWith('-')) + 1);
  return args;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const rest = [...argv];
  const args: Partial<CliArgs> & { encoder: EncoderPreference } = { encoder: 'auto' };
  while (rest.length > 0) {
    const arg = rest.shift()!;
    const value = (): string => {
      const next = rest.shift();
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--format') {
      const format = value();
      if (!isExportFormat(format)) throw new Error(`unknown format "${format}"`);
      args.format = format;
    } else if (arg === '-o' || arg === '--out') {
      args.out = value();
    } else if (arg === '--encoder') {
      const encoder = value();
      if (encoder !== 'auto' && encoder !== 'hardware' && encoder !== 'software') throw new Error(`unknown encoder "${encoder}"`);
      args.encoder = encoder;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option ${arg}`);
    } else if (args.projectDir === undefined) {
      args.projectDir = arg;
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  if (args.projectDir === undefined) throw new Error('missing <projectDir>');
  return args as CliArgs;
}

// Electron's default for an uncaught exception is a modal dialog; a CLI must exit instead.
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(EXIT_CODES.render);
});
// The export window is the app's only window; closing it must not quit before the audio is muxed.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  let args: CliArgs;
  try {
    args = parseArgs(userArgs());
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    app.exit(1);
    return;
  }
  const out = args.out ?? join(args.projectDir, 'out', `${(args.format ?? 'export').replace(':', 'x')}.mp4`);
  let lastPercent = -1;
  try {
    const result = await exportProject({
      projectDir: args.projectDir,
      format: args.format,
      out,
      encoder: args.encoder,
      onProgress(done, total) {
        const percent = Math.floor((done / total) * 100);
        if (percent !== lastPercent && percent % 10 === 0) console.error(`frames ${done}/${total}`);
        lastPercent = percent;
      },
    });
    console.log(JSON.stringify(result, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    app.exit(error instanceof ExportError ? EXIT_CODES[error.code] : EXIT_CODES.render);
  }
});
```

`packages/export/electron/vite.main.config.ts` (Task 14 adds `check.ts` to `input`):

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The Electron main-process entries as self-contained ES modules (workspace packages ship TypeScript,
// so they are bundled; only electron stays external). Output: packages/export/dist/<entry>.mjs, next to
// export-page/, which exportProject finds relative to its own bundle.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'warn',
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    outDir: '../dist',
    emptyOutDir: true, // runs before the page build, which then writes export-page/
    minify: false,
    target: 'node22',
    rollupOptions: {
      input: {
        cli: fileURLToPath(new URL('./cli.ts', import.meta.url)),
      },
      external: ['electron'],
      // Shared chunks stay next to the entries: exportProject finds export-page/ relative to its own file.
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
    },
  },
});
```

In `package.json`, replace:

```json
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json"
```

with:

```json
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json",
    "export:build": "vite build --config packages/export/electron/vite.main.config.ts && vite build --config packages/export/electron/vite.page.config.ts",
    "export:run": "pnpm export:build && electron packages/export/dist/cli.mjs"
```

The main build runs first and empties `dist/`; the page build then writes `dist/export-page/`.

- [ ] **Step 4: Typecheck and build**

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm export:build`
Expected: exit code 0; `packages/export/dist/` holds `cli.mjs` and `export-page/` (a shared `src-<hash>.mjs` chunk appears in Task 14, when `check.mjs` is the second entry).

- [ ] **Step 5: Export a small project**

A 3 s testsrc screen recording, tagged BT.709 like the recorder will write it, and a one-scene project:

```bash
mkdir -p out/m3-smoke/take
ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc=size=1280x720:rate=30:duration=3 -vf scale=out_color_matrix=bt709:out_range=tv,format=yuv420p -c:v libx264 -preset ultrafast -crf 18 -colorspace bt709 -color_range tv -movflags +frag_keyframe+empty_moov+default_base_moof out/m3-smoke/take/screen.mp4
echo '{"version":1,"sources":{"screen":"take/screen.mp4"},"scenes":[{"type":"clip","from":0,"to":3}]}' > out/m3-smoke/cuttle.json
pnpm export:run out/m3-smoke --format 1:1 -o out/m3-smoke/out/square.mp4
```

Expected: progress lines on stderr every 10 % (`frames 9/90`, `frames 18/90`, …, `frames 90/90`), then JSON on stdout with `"frames": 90`, `"seconds": 3`, `"codec": "avc1.640020"`, `"hardwareAcceleration": "prefer-hardware"` (or `"prefer-software"` on a machine without a hardware H.264 encoder) and a `"gpu"` string that names the real GPU (`ANGLE (…)` with the vendor; `SwiftShader` there means no GPU). Exit code 0. Electron must not show a window.

Run: `ffprobe -v error -show_entries stream=codec_name,profile,width,height,nb_frames,duration,sample_rate,channels -of compact out/m3-smoke/out/square.mp4`
Expected:

```
stream|codec_name=h264|profile=High|width=1080|height=1080|duration=3.000000|nb_frames=90
stream|codec_name=aac|profile=LC|sample_rate=48000|channels=2|duration=3.000000|nb_frames=142
```

(The project has no mic: the audio track is silent AAC.)

Run: `ffmpeg -v error -y -ss 1.5 -i out/m3-smoke/out/square.mp4 -vf scale=in_color_matrix=bt709:in_range=tv,format=rgb24 -frames:v 1 out/m3-smoke/out/square-1.5s.png`

Open the PNG: a 1080×1080 frame with the sunset sky, a `mac-dark` window with an empty title in the middle, and inside it the testsrc pattern (colour bars, a gradient band, the big counter digit `1` on the right).

- [ ] **Step 6: Check the error paths**

```bash
pnpm export:run out/no-such-project
echo "exit $?"
CUTTLE_FFMPEG=no-such-ffmpeg pnpm export:run out/m3-smoke -o out/m3-smoke/out/never.mp4
echo "exit $?"
ls out/m3-smoke/out
```

Expected: `no cuttle.json in …\out\no-such-project` and `exit 1`; `ffmpeg was not found (looked for "no-such-ffmpeg"). Install it (Windows: winget install Gyan.FFmpeg, macOS: brew install ffmpeg) or set CUTTLE_FFMPEG to its path.` and `exit 2` (pnpm adds an `ELIFECYCLE` line after each); `ls` lists only `square-1.5s.png` and `square.mp4` (no `never.mp4`, no `.partial` file).

- [ ] **Step 7: Commit**

```bash
git add package.json packages/export/src/main/window.ts packages/export/src/main/export.ts packages/export/src/index.ts packages/export/electron/cli.ts packages/export/electron/vite.main.config.ts
git commit -m "export: exportProject in a hidden window, ffmpeg audio pass, development CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Fixture project and the end-to-end check

The M3 done criterion: a 10 s testsrc fixture renders to 16:9, 1:1 and 9:16, and ffprobe shows the expected duration (±1 frame), size, H.264 and AAC. The fixture exercises every scene type, a 4× speed-up, a zoom, a fill and a blur mask, two texts, the webcam bubble (offset by take.json), the cursor (events.jsonl with a cut-off last line), crossfades and a scene that jumps back in source time. The same script is the benchmark (`--seconds 60 --layout long|speedup`).

**Files:**
- Create: `packages/export/test/fixture.ts`, `packages/export/electron/check.ts`
- Modify: `packages/export/electron/vite.main.config.ts`, `package.json`

- [ ] **Step 1: The fixture builder**

`packages/export/test/fixture.ts`:

```ts
// Builds a project folder from ffmpeg test sources, shaped like a recorder take: fragmented MP4
// screen and webcam tracks, an AAC mic, events.jsonl, take.json, a still image and cuttle.json.
// Node only (child_process); used by electron/check.ts.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** `showcase`: every scene type, speed-up, zoom, masks, text, webcam, cursor, crossfades. `long`: one clip. `speedup`: mostly a 12× clip. */
export type FixtureLayout = 'showcase' | 'long' | 'speedup';

export interface FixtureOptions {
  /** Length of the screen recording in seconds; the showcase needs 10. */
  seconds: number;
  layout: FixtureLayout;
  width?: number;
  height?: number;
  fps?: number;
}

/** What the fixture's take.json says: the webcam started 0.5 s after the screen, the mic 0.2 s before. */
export const FIXTURE_OFFSETS = { webcam: 0.5, mic: -0.2 } as const;

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${args.join(' ')} failed (${code}): ${stderr}`))));
  });
}

/** The recorder's container flags: a killed process still leaves a readable file. */
const FRAGMENTED = ['-movflags', '+frag_keyframe+empty_moov+default_base_moof'];
// BT.709 matrix and tags, as the recorder must write them: Chromium decodes untagged HD video as BT.709,
// while ffmpeg converts RGB with BT.601 unless told otherwise, which shifts every colour.
const H264 = [
  '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
];

/** Pointer path: a slow loop with clicks, shape changes and a cut-off last line (a crashed recorder). */
function eventsJsonl(seconds: number, width: number, height: number): string {
  const lines: string[] = [];
  for (let i = 0; i <= seconds * 60; i++) {
    const t = i / 60;
    const x = width / 2 + (width / 3) * Math.cos(t * 0.9);
    const y = height / 2 + (height / 3) * Math.sin(t * 1.3);
    lines.push(JSON.stringify({ t: Number(t.toFixed(4)), type: 'move', x: Math.round(x), y: Math.round(y) }));
  }
  for (const t of [1.5, 2.2, 4, 7]) {
    if (t >= seconds) continue;
    const x = Math.round(width / 2 + (width / 3) * Math.cos(t * 0.9));
    const y = Math.round(height / 2 + (height / 3) * Math.sin(t * 1.3));
    lines.push(JSON.stringify({ t, type: 'click', x, y, button: 'left' }));
  }
  lines.push(JSON.stringify({ t: 1, type: 'shape', shape: 'pointer' }), JSON.stringify({ t: 2.5, type: 'shape', shape: 'text' }));
  lines.push(JSON.stringify({ t: 2.6, type: 'keys', count: 3 }));
  return `${lines.join('\n')}\n{"t":${seconds},"type":"mo`;
}

function scenes(layout: FixtureLayout, seconds: number): unknown[] {
  switch (layout) {
    case 'showcase':
      return [
        { type: 'clip', from: 0, to: 3 },
        { type: 'clip', from: 3, to: 9, speed: 4 },
        { type: 'still', image: 'page.png', duration: 2, motion: 'scroll', frame: 'browser-light' },
        { type: 'clip', from: 1, to: 3 },
        { type: 'card', title: 'Cuttle', subtitle: 'Export-Fixture · Grüße', duration: 1.5 },
      ];
    case 'long':
      return [{ type: 'clip', from: 0, to: seconds }];
    case 'speedup':
      return [
        { type: 'clip', from: 0, to: 5 },
        { type: 'clip', from: 5, to: seconds - 5, speed: 12 },
        { type: 'clip', from: seconds - 5, to: seconds },
      ];
  }
}

/** Writes the fixture project into `dir` (created if needed). */
export async function createFixtureProject(dir: string, options: FixtureOptions): Promise<void> {
  const { seconds, layout, width = 1920, height = 1080, fps = 30 } = options;
  const take = join(dir, 'takes', '1');
  await mkdir(take, { recursive: true });
  const webcamSeconds = seconds - 1;
  const micSeconds = seconds - 0.5;
  await Promise.all([
    ffmpeg(['-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=${fps}:duration=${seconds}`, ...H264, ...FRAGMENTED, join(take, 'screen.mp4')]),
    // Grey, with the testsrc counter in view, so the bubble shows which webcam second it plays.
    ffmpeg(['-f', 'lavfi', '-i', `testsrc=size=640x480:rate=30:duration=${webcamSeconds},crop=480:480:160:0,hue=s=0`, ...H264, ...FRAGMENTED, join(take, 'webcam.mp4')]),
    // A 100 ms beep at the start of every mic second: easy to find when checking sync.
    ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=0.5*sin(2*PI*1000*t)*lt(mod(t\\,1)\\,0.1):s=48000:d=${micSeconds}`, '-c:a', 'aac', '-b:a', '96k', join(take, 'mic.m4a')]),
    ffmpeg([
      '-f', 'lavfi', '-i', 'color=c=0xF4F4F5:s=1280x2400',
      '-vf', 'drawbox=x=0:y=0:w=1280:h=96:color=0x111827:t=fill,drawbox=x=80:y=160:w=1120:h=420:color=0x6366F1:t=fill,drawbox=x=80:y=660:w=540:h=700:color=0xFCE7F3:t=fill,drawbox=x=660:y=660:w=540:h=700:color=0xDCFCE7:t=fill,drawbox=x=80:y=1440:w=1120:h=760:color=0xE0E7FF:t=fill,drawbox=x=0:y=2280:w=1280:h=120:color=0x111827:t=fill',
      '-frames:v', '1', join(dir, 'page.png'),
    ]),
  ]);
  await writeFile(join(take, 'events.jsonl'), eventsJsonl(seconds, width, height));
  await writeFile(
    join(take, 'take.json'),
    `${JSON.stringify(
      {
        version: 1,
        tracks: {
          screen: { file: 'screen.mp4', start: 1000 },
          webcam: { file: 'webcam.mp4', start: 1000 + FIXTURE_OFFSETS.webcam },
          mic: { file: 'mic.m4a', start: 1000 + FIXTURE_OFFSETS.mic },
        },
      },
      null,
      2,
    )}\n`,
  );
  const project = {
    version: 1,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: { screen: 'takes/1/screen.mp4', webcam: 'takes/1/webcam.mp4', mic: 'takes/1/mic.m4a', events: 'takes/1/events.jsonl' },
    look: {
      frame: { title: 'cuttle · Grüße aus dem Export' },
      webcam: { enabled: true, corner: 'bottom-right' },
      cursor: { style: 'system' },
    },
    scenes: scenes(layout, seconds),
    zooms: [{ at: 1, duration: 1.8, rect: [960, 400, 800, 450] }],
    masks: [
      { from: 0, to: 3, rect: [120, 120, 520, 240], style: 'fill' },
      { from: 1, to: 3, rect: [1240, 700, 520, 260], style: 'blur' },
    ],
    texts: [
      { at: 0.4, duration: 2.2, text: 'Hallo aus dem Export', style: 'pill', position: 'top' },
      { at: 1.2, duration: 1.6, text: 'Untertitel mit Umlauten: äöü', style: 'lower-third', position: 'bottom' },
    ],
  };
  await writeFile(join(dir, 'cuttle.json'), `${JSON.stringify(project, null, 2)}\n`);
}
```

- [ ] **Step 2: The check**

`packages/export/electron/check.ts`:

```ts
// End-to-end check of the export (M3 done criterion): builds a testsrc fixture project in a temp
// folder whose path has spaces and umlauts, exports it to 16:9, 1:1 and 9:16, and checks each file
// with ffprobe: duration (±1 frame), frame count, size, H.264 High and AAC 48 kHz stereo.
//   pnpm export:check [--seconds 10] [--layout showcase|long|speedup] [--formats 16:9,1:1,9:16]
//                     [--encoder auto|hardware|software] [--keep <dir>] [--frames t1,t2,...]
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseProjectJson } from '@cuttle/project';
import { sceneSpans, totalDuration } from '@cuttle/timeline';
import { app } from 'electron';
import { frameCount } from '../src/frame-plan';
import { EXPORT_FORMATS, exportProject, isExportFormat, type EncoderPreference, type ExportFormat } from '../src/index';
import { createFixtureProject, type FixtureLayout } from '../test/fixture';

const run = promisify(execFile);

interface ProbeStream {
  codec_type: string;
  codec_name: string;
  profile?: string;
  width?: number;
  height?: number;
  nb_frames?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function probe(file: string): Promise<{ streams: ProbeStream[]; format: { duration: string } }> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,profile,width,height,nb_frames,duration,sample_rate,channels:format=duration',
    '-of', 'json', file,
  ]);
  return JSON.parse(stdout);
}

/** Samples the working set of every Electron process once a second; returns the peak per process type in MB. */
function sampleMemory(): () => Record<string, number> {
  const peak: Record<string, number> = {};
  const sample = () => {
    const byType: Record<string, number> = {};
    for (const metric of app.getAppMetrics()) byType[metric.type] = (byType[metric.type] ?? 0) + metric.memory.workingSetSize / 1024;
    for (const [type, mb] of Object.entries(byType)) peak[type] = Math.max(peak[type] ?? 0, Math.round(mb));
  };
  const timer = setInterval(sample, 1000);
  return () => {
    clearInterval(timer);
    sample();
    return peak;
  };
}

async function check(): Promise<boolean> {
  const seconds = Number(option('--seconds') ?? 10);
  const layout = (option('--layout') ?? 'showcase') as FixtureLayout;
  const formats = (option('--formats') ?? '16:9,1:1,9:16').split(',');
  const encoder = (option('--encoder') ?? 'auto') as EncoderPreference;
  const keep = option('--keep');
  const frameTimes = option('--frames')?.split(',').map(Number) ?? [];
  if (!formats.every(isExportFormat)) throw new Error(`unknown format in ${formats.join(',')}`);

  const root = keep ?? (await mkdtemp(join(tmpdir(), 'cuttle export Grüße ')));
  const projectDir = join(root, 'Projekt mit Ümlaut');
  const started = performance.now();
  await createFixtureProject(projectDir, { seconds, layout });
  console.log(`fixture (${layout}, ${seconds} s) in ${Math.round(performance.now() - started)} ms: ${projectDir}`);

  const parsed = parseProjectJson(await readFile(join(projectDir, 'cuttle.json'), 'utf8'));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const fps = parsed.project.output.fps;
  const expectedFrames = frameCount(totalDuration(sceneSpans(parsed.project.scenes)), fps);
  const expectedSeconds = expectedFrames / fps;

  let failures = 0;
  for (const format of formats as ExportFormat[]) {
    const out = join(root, 'out', `${format.replace(':', 'x')}.mp4`);
    const stopSampling = sampleMemory();
    const result = await exportProject({ projectDir, format, out, encoder });
    const memory = stopSampling();
    const { streams, format: container } = await probe(out);
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');
    const { width, height } = EXPORT_FORMATS[format];
    const near = (value: string | undefined, target: number) => value !== undefined && Math.abs(Number(value) - target) <= 1 / fps + 1e-6;
    const problems = [
      video?.codec_name === 'h264' || `video codec ${video?.codec_name}`,
      video?.profile === 'High' || `video profile ${video?.profile}`,
      (video?.width === width && video?.height === height) || `size ${video?.width}x${video?.height}`,
      Number(video?.nb_frames) === expectedFrames || `video frames ${video?.nb_frames}, expected ${expectedFrames}`,
      near(video?.duration, expectedSeconds) || `video duration ${video?.duration}`,
      audio?.codec_name === 'aac' || `audio codec ${audio?.codec_name}`,
      audio?.sample_rate === '48000' || `audio sample rate ${audio?.sample_rate}`,
      audio?.channels === 2 || `audio channels ${audio?.channels}`,
      near(audio?.duration, expectedSeconds) || `audio duration ${audio?.duration}`,
      near(container.duration, expectedSeconds) || `container duration ${container.duration}`,
    ].filter((entry): entry is string => entry !== true);
    const total = result.stats.totalMs / 1000;
    console.log(
      `${problems.length === 0 ? 'ok  ' : 'FAIL'} ${format} ${width}x${height}: ${video?.nb_frames} frames, video ${video?.duration} s, ` +
        `audio ${audio?.duration} s, container ${container.duration} s (expected ${expectedSeconds} s)`,
    );
    console.log(
      `     ${total.toFixed(1)} s total = ${(total / expectedSeconds).toFixed(2)}× the video's duration, ` +
        `${(result.frames / (result.stats.page.totalMs / 1000)).toFixed(1)} frames/s in the page; ${JSON.stringify(result.stats)}; peak MB ${JSON.stringify(memory)}`,
    );
    for (const problem of problems) console.log(`     ${problem}`);
    failures += problems.length > 0 ? 1 : 0;
    for (const t of frameTimes) {
      const png = join(root, 'out', `${format.replace(':', 'x')}-${t.toFixed(2)}s.png`);
      // Explicit BT.709: the export is tagged so, but ffmpeg's PNG conversion does not always honour the tag.
      await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', out, '-vf', 'scale=in_color_matrix=bt709:in_range=tv,format=rgb24', '-frames:v', '1', png]);
      console.log(`     frame at ${t} s: ${png}`);
    }
  }
  if (!keep) await rm(root, { recursive: true, force: true });
  console.log(failures === 0 ? `all ${formats.length} formats pass` : `${failures} of ${formats.length} formats fail`);
  return failures === 0;
}

process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let ok = false;
  try {
    ok = await check();
  } catch (error) {
    console.error(error);
  }
  app.exit(ok ? 0 : 1);
});
```

In `packages/export/electron/vite.main.config.ts`, replace:

```ts
      input: {
        cli: fileURLToPath(new URL('./cli.ts', import.meta.url)),
      },
```

with:

```ts
      input: {
        cli: fileURLToPath(new URL('./cli.ts', import.meta.url)),
        check: fileURLToPath(new URL('./check.ts', import.meta.url)),
      },
```

In `package.json`, replace:

```json
    "export:run": "pnpm export:build && electron packages/export/dist/cli.mjs"
```

with:

```json
    "export:run": "pnpm export:build && electron packages/export/dist/cli.mjs",
    "export:check": "pnpm export:build && electron packages/export/dist/check.mjs"
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 4: Run the check and keep the files**

Run: `pnpm export:check --keep out/m3-check --frames 1.5,3,3.8,5.5,7.6,9.5`
Expected (times vary; the `ok` lines and the durations must match exactly):

```
fixture (showcase, 10 s) in … ms: out\m3-check\Projekt mit Ümlaut
ok   16:9 1920x1080: 300 frames, video 10.000000 s, audio 10.000000 s, container 10.000000 s (expected 10 s)
     … s total = …× the video's duration, … frames/s in the page; {"gpu":"ANGLE (…)","codec":"avc1.640028","hardwareAcceleration":"prefer-hardware","bitrate":9953280,…}; peak MB {…}
     frame at 1.5 s: …\out\m3-check\out\16x9-1.50s.png
     …
ok   1:1 1080x1080: 300 frames, video 10.000000 s, audio 10.000000 s, container 10.000000 s (expected 10 s)
     … "codec":"avc1.640020" …
ok   9:16 1080x1920: 300 frames, video 10.000000 s, audio 10.000000 s, container 10.000000 s (expected 10 s)
     … "codec":"avc1.640028" …
all 3 formats pass
```

Exit code 0. On the reference PC each format took 2.4–4.6 s (0.24–0.46× the video's duration).

- [ ] **Step 5: Look at the 16:9 frames**

Open `out/m3-check/out/16x9-*.png` (BT.709-correct grabs; the testsrc counter digit on the right of the screen is the source second):

- `1.50s`: zoomed in on the right half of the screen (yellow, green, red bars, the black counter box showing `1`); a smooth blur over the lower right (the blur mask); the pill `Hallo aus dem Export` at the top over the title bar; the lower third `Untertitel mit Umlauten: äöü` at the bottom left; the grey webcam bubble at the bottom right showing its own counter `1` (the webcam starts 0.5 s after the screen).
- `3.00s`: the cut from scene 0 to the 4× scene, halfway: the full testsrc frame, the fill mask (a translucent box at the top left) and the blur mask at half strength, the `4× speed` badge half visible, the counter a blend of `2` and `3`, an I-beam cursor (the two layers' cursors lie almost on top of each other), the webcam bubble `2`.
- `3.80s`: the 4× scene at source 6.2 s: counter `6`, badge `4× speed`, webcam bubble `5`, an I-beam cursor.
- `5.50s`: the still: a light `browser-light` window with an empty address field and the page scrolled to its middle (pink and green boxes).
- `7.60s`: the scene that jumps back to source 1–3 s: zoomed again, counter `2`, both texts, the blur mask.
- `9.50s`: the card: `Cuttle` and below it `Export-Fixture · Grüße`, centred on the sunset sky.

Run: `ffmpeg -hide_banner -i "out/m3-check/out/16x9.mp4" -af silencedetect=n=-30dB:d=0.03 -f null -` and look at the `silence_end` values.
Expected: `0.800021`, `1.800021`, `2.800021`, `7.300021`, `8.300021` (and `10` for the final silence): the mic's beeps where take.json's −0.2 s offset puts them; nothing in the 4× scene (`muteSpedUp`), the still or the card.

- [ ] **Step 6: Commit**

```bash
git add package.json packages/export/test/fixture.ts packages/export/electron/check.ts packages/export/electron/vite.main.config.ts
git commit -m "export: testsrc fixture project and the end-to-end check for all three formats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Documentation

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`, `docs/superpowers/specs/2026-10-16-cuttle-design.md`

- [ ] **Step 1: README**

In `README.md`, replace:

```markdown
| `@cuttle/engine` | WebGL2 compositor: backgrounds, window frames, zoom, masks, cursors, webcam, texts, stills, cards, crossfades |
```

with:

```markdown
| `@cuttle/engine` | WebGL2 compositor: backgrounds, window frames, zoom, masks, cursors, webcam, texts, stills, cards, crossfades |
| `@cuttle/export` | MP4 export in a hidden Electron window: decode, render, encode H.264, mux; mic cut to the scenes with ffmpeg (AAC) |
```

In `README.md`, replace (the last command of the development block and its closing fence):

````text
pnpm engine:electron                     # the engine goldens in a hidden Electron window
```
````

with:

````text
pnpm engine:electron                     # the engine goldens in a hidden Electron window
pnpm export:check                        # export a testsrc fixture to 16:9, 1:1, 9:16 and check it with ffprobe
pnpm export:run <projectDir> --format 9:16 -o out.mp4   # export a project (until the CLI exists)
```

Export needs ffmpeg on PATH (or its path in `CUTTLE_FFMPEG`); `export:check` also needs ffprobe.
````

- [ ] **Step 2: Roadmap**

In `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`, replace:

```markdown
**Tech Stack:** TypeScript 5, pnpm workspaces, vitest, zod 4, Electron, WebGL2, WebCodecs,
mp4box.js, mp4-muxer, ffmpeg, uiohook-napi, commander.
```

with:

```markdown
**Tech Stack:** TypeScript 5, pnpm workspaces, vitest, zod 4, Electron, WebGL2, WebCodecs,
Mediabunny, ffmpeg, uiohook-napi, commander.
```

In the same file, replace:

```markdown
| M3 | `@cuttle/export` (decode → render → encode → mux, audio via ffmpeg) | write before starting |
```

with:

```markdown
| M3 | `@cuttle/export` (decode → render → encode → mux, audio via ffmpeg) | `2026-10-16-cuttle-m3-export.md` |
```

In the same file, replace:

```ts
export function parseEventsJsonl(text: string): { events: InputEvent[]; issues: ProjectIssue[] }; // M4, first step
```

with:

```ts
export function parseEventsJsonl(text: string): { events: InputEvent[]; issues: ProjectIssue[] }; // M3; drops a cut-off last line
export type TakeFile = z.output<typeof TakeFileSchema>;         // take.json (M3): per-track first-capture times
// { version: 1, tracks: { screen: { file, start }, webcam?: { file, start }, mic?: { file, start } } },
// start in seconds on one monotonic clock; written by the recorder next to the take's tracks
export function parseTakeJson(text: string): { ok: true; take: TakeFile } | { ok: false; issues: ProjectIssue[] };
export function trackOffset(take: TakeFile, track: 'webcam' | 'mic'): number | undefined; // track start − screen start
```

In the same file, replace:

```ts
// @cuttle/export (M3)
export interface ExportOptions { projectDir: string; format: '16:9' | '1:1' | '9:16'; out: string; onProgress?: (done: number, total: number) => void }
export function exportProject(opts: ExportOptions): Promise<{ out: string; frames: number; seconds: number }>;
```

with:

```ts
// @cuttle/export (M3) – Electron main process; bundle it with Vite and ship dist/export-page/ next to the bundle
export interface ExportOptions {
  projectDir: string;
  format?: '16:9' | '1:1' | '9:16';                         // without it: the project's output size
  out: string;                                               // written only on success (temp file + rename)
  onProgress?: (done: number, total: number) => void;        // frames
  encoder?: 'auto' | 'hardware' | 'software';                // auto: hardware first, software fallback
  pageDir?: string;                                          // default: export-page/ next to the bundle
}
export interface ExportResult {
  out: string; frames: number; seconds: number;              // seconds = frames / fps
  stats: { gpu: string; codec: string; hardwareAcceleration: 'prefer-hardware' | 'prefer-software'; bitrate: number;
           page: { decodeMs: number; renderMs: number; encodeMs: number; finalizeMs: number; totalMs: number };
           audioMs: number; totalMs: number };
}
export function exportProject(opts: ExportOptions): Promise<ExportResult>;
export class ExportError extends Error {                     // CLI exit codes: 1, 1, 1, 2, 3
  code: 'invalid-project' | 'missing-file' | 'invalid-media' | 'ffmpeg-missing' | 'render';
}
export const EXPORT_FORMATS: Record<'16:9' | '1:1' | '9:16', { width: number; height: number }>; // 1920×1080, 1080×1080, 1080×1920
```

In the same file, replace the whole `**M3:**` bullet in "Things each later plan must verify first", from:

```markdown
- **M3:** Electron's WebCodecs H.264 encoder availability (`VideoEncoder.isConfigSupported` with
  `avc1.640028`, 1920×1080) on Windows and macOS; fallback is piping RGBA frames to an ffmpeg
  child on stdin. Current mp4-muxer and mp4box.js APIs. Decoding strategy: sequential decode with
  a frame queue, not per-frame seeking; but a crossfade needs the incoming clip's first frame
  before the boundary while the outgoing clip still plays, so pre-decode each clip's first frame
  (or run a second decoder) and hold one cloned frame for the outgoing layer. Read `screenSize`
  from the track metadata and fail clearly when it is missing (a crashed take).
  Already verified in the M2 spike (Electron 44.7.2, Chromium 152, Windows): `VideoEncoder` reports
  `avc1.640028` 1080p30 as supported (hardware and software); a 30-frame H.264 encode and decode of
  a WebGL canvas through `new VideoFrame(canvas)` works at 640×360 and 1920×1080, under SwiftShader
  too. WebCodecs needs a secure context: load the export page with `loadFile` (as
  `packages/engine/electron/main.mjs` does), never a `data:` URL, where `VideoEncoder` is undefined.
  A hidden window (`show: false`) keeps rendering at full rate; `offscreen: true` and
  `backgroundThrottling: false` changed nothing.
  From the M2 reviews: create one renderer per export or preview session (each `createRenderer`
  compiles every program) and drop the canvas or call `loseContext()` when it ends; `render` throws
  on a lost context, but check `gl.isContextLost()` before encoding each frame as well. It also
  throws on an empty (0×0) screen frame, e.g. a closed `VideoFrame`; a missing or empty webcam
  frame only drops the bubble, so supply one wherever the webcam track covers the source time.
  No golden covers a clip inside the crossfade target yet (clip→clip with masks and a cursor);
  add one when the export first crossfades real clips. Still images larger than
  `MAX_TEXTURE_SIZE` (8192 under SwiftShader) are refused: upload only the visible band
  (`UNPACK_SKIP_ROWS` with a sized `texImage2D`, checked in a probe) or downscale at decode time.
```

with:

```markdown
- **M3:** done; see "Decisions made while planning" in `2026-10-16-cuttle-m3-export.md`.
```

In the same file, replace:

```markdown
  frame). First step of M4: `parseEventsJsonl` in `@cuttle/project`, tolerant of a truncated last
  line, shared by M3 (cursor track for export) and M5 (`cuttle suggest`). Claude transcripts live in `~/.claude/projects/<cwd with : \ / replaced by ->/`
  and have `timestamp`, `type` and `message.stop_reason`.
```

with:

```markdown
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

In the same file, replace:

```markdown
- **M5:** commander version; how the CLI starts the bundled Electron for `render`, `preview` and
  `capture-page`; `pnpm link --global` on Windows.
```

with:

```markdown
- **M5:** commander version; how the CLI starts the bundled Electron for `render`, `preview` and
  `capture-page`; `pnpm link --global` on Windows. From M3: bundle the Electron entry with Vite like
  `packages/export/electron/vite.main.config.ts` (`ssr.noExternal: true`, `electron` external) and
  copy the page build (`vite.page.config.ts`) to `export-page/` next to it, or pass `pageDir`;
  register a no-op `window-all-closed` (closing the export window must not quit) and an
  `uncaughtException` handler; drop Chromium switches from `process.argv` (see
  `packages/export/electron/cli.ts`); map `ExportError.code` to exit codes 1/1/1/2/3; `--json`
  prints `ExportResult`.
```

- [ ] **Step 3: Spec**

In `docs/superpowers/specs/2026-10-16-cuttle-design.md`, replace:

```markdown
- Video tracks are written as fragmented MP4 (H.264, 4:2:0, high quality CRF) so a killed process
  leaves a readable file.
```

with:

```markdown
- Video tracks are written as fragmented MP4 (H.264, 4:2:0, high quality CRF, BT.709 matrix and
  tags, a key frame every 2 s) so a killed process leaves a readable file.
```

In the same file, replace:

```markdown
- `take.json`: per-track start times on one monotonic clock, used for sync.
```

with:

```markdown
- `take.json`: per-track start times on one monotonic clock, used for sync: `{ "version": 1,
  "tracks": { "screen": { "file": "screen.mp4", "start": 1000.0 }, "webcam": { … }, "mic": { … } } }`,
  `start` = when the track's first frame or sample was captured (schema in `@cuttle/project`).
```

In the same file, replace:

```markdown
- A clip that is still visible after its end (outgoing side of a crossfade) holds its last output
  frame, which lies inside `[from, to)`, so masks stay on.
```

with:

```markdown
- A clip that is still visible after its end (outgoing side of a crossfade) holds the last output
  frame shown before its end, which lies inside `[from, to)`, so masks stay on and the clip's
  source time never goes back.
```

In the same file, replace:

```markdown
- Runs in a hidden Electron window (CLI and app).
- Demux with mp4box.js, decode with WebCodecs `VideoDecoder`, render each output frame with the
  engine, encode with `VideoEncoder` (H.264 High, hardware when available), mux with mp4-muxer.
- Audio: ffmpeg cuts the mic track to the scene list, mutes sped-up scenes (`muteSpedUp`), and muxes
  it into the final file. AAC 48 kHz.
```

with:

```markdown
- Runs in a hidden, sandboxed Electron window (CLI and app). The main process serves the project's
  files to it over IPC by byte range, so recordings never sit in memory.
- Demux, decode and mux with Mediabunny: decode with WebCodecs `VideoDecoder` (in software, one
  decoder per scene and track, started a second before the scene shows), render each output frame
  with the engine, encode with `VideoEncoder` (H.264 High at the smallest fitting level, about
  10 Mbit/s at 1080p30, a key frame every 2 s; hardware when available, software otherwise).
- Webcam and mic are lined up with the screen by the start times in `take.json`.
- Audio: ffmpeg cuts the mic track to the scene list, mutes sped-up scenes (`muteSpedUp`; otherwise
  `atempo`), fades out and in at cuts over half the crossfade (at least 10 ms), and muxes it into
  the final file. AAC 48 kHz stereo; a silent track when there is no mic or audio is off.
```

In the same file, replace:

```markdown
- `export`: end-to-end render of a short ffmpeg `testsrc` fixture; check duration, frame count and
  audio with ffprobe.
```

with:

```markdown
- `export`: unit tests for the pure parts (formats, codec string, frame plan, audio filter graph,
  source loading); `pnpm export:check` renders a 10 s ffmpeg `testsrc` fixture (every scene type,
  speed-up, zoom, masks, texts, webcam, cursor, crossfades, mic) to all three formats in a hidden
  Electron window and checks duration, frame count, size, codecs and audio with ffprobe.
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test`
Expected: PASS, 231 tests in 26 files.

- [ ] **Step 5: Commit**

```bash
git add README.md docs
git commit -m "docs: export in the README, M3 interfaces and recorder notes in the roadmap, export rules in the spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Final verification

- [ ] **Step 1: Unit and golden tests, twice**

Run: `pnpm test`
Expected: PASS, 231 tests in 26 files.

Run: `pnpm test`
Expected: PASS, 231 tests in 26 files again (no golden rewritten, nothing flaky).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exits with code 0 and prints the five `tsc` commands.

- [ ] **Step 3: Engine goldens in Electron**

Run: `pnpm engine:electron`
Expected: `all 40 scenarios match the goldens`.

- [ ] **Step 4: The done criterion**

Run: `pnpm export:check`
Expected: three `ok` lines with `300 frames, video 10.000000 s, audio 10.000000 s, container 10.000000 s (expected 10 s)` for `16:9 1920x1080`, `1:1 1080x1080` and `9:16 1080x1920`, then `all 3 formats pass`, exit code 0. The temp fixture folder (`%TEMP%\cuttle export Grüße …`) is deleted afterwards.

- [ ] **Step 5: The 2× target**

Run: `pnpm export:check --formats 16:9 --seconds 60 --layout long`
Expected: `ok   16:9 1920x1080: 1800 frames, video 60.000000 s, audio 60.000000 s, container 60.000000 s (expected 60 s)`, `all 1 formats pass`. On the reference PC the total was 17.5–18.0 s (0.29–0.30× the video's duration, about 105 frames/s in the page); anything up to 2× (120 s) meets the spec's target.

Run: `pnpm export:check --formats 16:9 --seconds 60 --layout speedup`
Expected: `ok   16:9 1920x1080: 426 frames, video 14.200000 s, audio 14.200000 s, container 14.200000 s (expected 14.2 s)`. Reference: 5.9–6.2 s total (0.42–0.44×).

- [ ] **Step 6: Clean up**

```bash
rm -rf out/m3-smoke out/m3-check
git status --short
```

Expected: `git status` prints nothing (everything is committed; `out/` and `dist/` are ignored).

---

## Spec coverage (M3 scope)

| Spec or roadmap item | Task |
|---|---|
| Runs in a hidden Electron window; CLI and app use it (`exportProject` in the main process) | 12, 13 |
| Per output frame: timeline → decoded screen and webcam frames at each layer's source time, stills, cursor from events.jsonl → engine → H.264 High → MP4 | 7, 11, 12 |
| Demux and decode fragmented MP4 (WebCodecs), mux MP4 (Mediabunny instead of mp4box.js and mp4-muxer) | 11, 12 |
| H.264 High, hardware when available | 6, 12 |
| Crossfades between two clips of one recording; a later scene jumping back in source time | 3, 4, 7, 12, 14 |
| Audio: mic cut to the scene list, sped-up scenes muted, AAC 48 kHz, muxed into the final file | 8, 13 |
| Track sync via take.json (per-track start times on one clock) | 2, 10, 14 |
| Cursor track from events.jsonl (`parseEventsJsonl`, roadmap's M4 first step) | 1, 10 |
| Output presets 16:9 1920×1080, 1:1 1080×1080, 9:16 1080×1920 | 5, 14 |
| `screenSize` from the track metadata, a clear failure when missing (crashed take) | 11, 12 |
| Still images premultiplied, unflipped, within `MAX_TEXTURE_SIZE` | 11 |
| Errors: partial output kept out of the target path (temp file, rename); render errors → exit 3 | 13 |
| Missing ffmpeg: a message with the cause and the fix | 9, 13 |
| Target: 1080p30 export in at most 2× the video's duration | 16 |
| Done criterion: 10 s testsrc fixture → 16:9, 1:1, 9:16; ffprobe duration (±1 frame), size, H.264, AAC | 14, 16 |
| `pnpm typecheck` covers the new package (own tsconfigs listed in the root script) | 5, 9 |
| M2 review notes: one renderer per export, `loseContext`, `isContextLost` before encoding, webcam frames, clip→clip crossfade golden, CSP, no popups or navigation, `uncaughtException` | 4, 12, 13, 14 |

## Open points for later milestones

- **macOS.** Nothing ran on a Mac. Run `pnpm export:check` once there: software decoding, `prefer-hardware` (VideoToolbox) and whether `prefer-software` H.264 High is offered at all (Chromium's software H.264 encoder on macOS may be Baseline only; `auto` then stays with VideoToolbox).
- **Hardware encoder failing mid-export** (driver reset) is a render error (exit 3). A retry with `encoder: 'software'` inside `exportProject` is cheap to add if it ever shows up.
- **Very tall stills** are scaled down to `MAX_TEXTURE_SIZE` (16384 on the reference GPU, 8192 under SwiftShader). Uploading only the visible band (`UNPACK_SKIP_ROWS`) would keep their full resolution; it needs an engine change.
- **M5 integration:** bundle the CLI's Electron entry the same way and ship `export-page/` next to it (or pass `pageDir`); keep the `window-all-closed` and `uncaughtException` handlers and the argv handling from `electron/cli.ts`; `--json` prints `ExportResult`. How the `cuttle` command starts Electron is M5's question.
- **Encoder default.** Hardware first per the spec, although Windows' software encoder was faster and smaller on the reference PC (with lower PSNR). Revisit with a second Windows GPU and a Mac; `--encoder software` is the escape hatch.
- **Audio at crossfades** dips (fade out, fade in) instead of overlapping, so no mic from outside a scene's range plays. An overlap would need that audio.

## Changes during execution

The code blocks above are the original plan. Its tasks were executed by replaying the plan
mechanically (twice, on fresh clones) and bringing those commits in; three code reviews (tasks 1–4,
5–10, 11–14) and a re-review of their fixes then found the defects below. The repo is the source
of truth. The full suite has 251 tests in 27 files instead of 231 in 26; `pnpm export:check` also checks three failure paths.
Final numbers: `pnpm test` twice green, `pnpm typecheck` clean, `pnpm engine:electron` 40/40
goldens with 0 px, `pnpm export:check` 3/3 formats (300 frames, 10.000000 s) and 3/3 failure paths,
60 s benchmark 17.6 s (0.29×), speed-up benchmark 5.9 s (0.41×), mic beeps at 0.800, 1.800,
2.800, 7.300 and 8.300 s.

- **Task 3 (privacy):** the planned hold could put the held frame exactly at a clip's `to`, where a
  mask that ends with the clip is off, for the whole outgoing half of the crossfade. Span ends are
  rounded to the microsecond, so on sped-up clips (3×, 6×, 1.5×, …) a frame could fall inside the
  span with its source time at `to`. And at frame rates such as 29 fps the planned 1e-6 tolerance
  picked an earlier frame than the one drawn, so the source time went back and `planFrames` threw
  on valid projects. `frame.ts` now finds the last frame shown with the same strict comparisons as
  `spanAt` (`lastFrameShown`), and a frame whose source time would be `to` counts as past the end.
  Two tests: masks stay on through the held frame at 3×, 6× and 1.5×; no going back at 29 fps.
- **Tasks 1–2:** `parseProjectJson` and `parseTakeJson` accept a UTF-8 BOM (a file saved by a
  Windows editor failed with "Unexpected token"). Issue lists in error messages are capped at 20
  plus "… and N more".
- **Task 4:** the `crossfade-clips` comment says the incoming clip has its cursor (at 900, 600).
- **Task 8 (audio):** the fade-out ends where a clip's sound ends (`AudioSegment.mic.content`), not
  in the padding up to the frame grid: the last clip ended with a hard cut (a click) whenever the
  video ended between two frames. `atempo` returns several hundred samples fewer than
  (to − from) / speed, so sped-up and slowed-down clips get 200 000 samples of silence (`apad`)
  before it and are cut back to their length after it; a first fix read real mic audio past `to`
  instead, which put up to half a second from after the cut into the export (found by the
  re-review). Graphs longer than 30 000 characters go into a file (`-/filter_complex`, ffmpeg 7+):
  Windows ends a command line at 32 767 characters (about 150 audible clips fit inline). Tests:
  three ffmpeg-backed ones in `test/main/audio-ffmpeg.test.ts` (skipped without ffmpeg: the ramp to
  silence at the end, a sped-up clip reaching its fade, nothing from after the cut at 1.5×, 2×,
  0.5× and 0.25×) and string tests.
- **Task 9:** `FileHost` refuses every call after `close()` (a late write reopened the output with
  `'w'` and truncated it), checks byte ranges (safe integers, at most 64 MiB) and write positions,
  and reads whole files only for the job's images. `runFfmpeg` takes an `AbortSignal` (the child is
  killed); the new `ExportErrorCode` `cancelled` maps to exit 130 like Ctrl+C.
- **Task 10:** take.json entries match their files by the file system's case rules (Windows,
  macOS), a take.json whose screen entry names another file is ignored, and only a missing
  take.json counts as absent (a lock or permission error is reported instead of dropping the sync
  silently). A folder where a file belongs is reported (EISDIR escaped before). `loadSources`
  returns `inputs`, every file the project names, also sources the look switches off (the
  re-review overwrote a disabled webcam recording), and `warnings` (a take.json that describes
  another screen recording).
- **Task 11:** the decoder is chosen per track: `prefer-software` when `VideoDecoder` supports it
  there, `no-preference` otherwise, `invalid-media` before rendering when neither does. A screen
  track only a hardware decoder handles (HEVC from a phone) passed validation and failed mid-render
  with exit 3; checked with an HEVC screen track (300 frames, same picture). Unexpected page errors
  print name and message (a DOMException printed as "[object DOMException]").
- **Task 13:** `exportProject` refuses an output that is one of the project's files (same path by
  the case rules, or the same file on disk by device and inode), which replaced the screen recording
  with exit 0. An export window closed from outside fails the export (`closed` rejects `gone`)
  instead of leaving it pending forever; a window whose page does not load is destroyed.
  `ExportOptions.signal` cancels an export (window destroyed, ffmpeg killed, everything cleaned up);
  the dev CLI turns SIGINT, SIGTERM and SIGBREAK into it (a second one exits at once). A watchdog
  fails an export after 60 s without progress (a stalled hardware encoder never errors); rendered
  frames and the page's file reads and writes count, and the gap after the computer slept does not. A
  mic that ffmpeg cannot read fails before rendering (`invalid-media`). The output folder, the temp
  folder and cleanup are inside the error handling; cleanup retries Windows locks and never masks
  the real error; work folders and partial files of killed exports are removed after a day.
- **Task 14:** `pnpm export:check` also checks three failure paths: the output is the project file
  (`invalid-project`), cancelled after 10 frames (`cancelled`), the export window closed from
  outside after 10 frames (`render`); each must fail within seconds and leave no output, no partial
  file, no work folder and an unchanged cuttle.json.
- **Task 15:** the roadmap's export interface has `signal` and `cancelled`; its M5 notes add signal
  handling, argv in a packaged Electron, a bootstrap entry for the `uncaughtException` handler,
  ffmpeg 7+ for very long projects and a phase-2 note (project paths are not confined to the
  project folder). The spec's Export section says the decoder fallback, the fade rule, the output
  rule, cancelling and the stall timeout.

Not changed (reviews, Minor): the window title can be covered by a top text moved below a top-left
webcam (M2); test gaps for `rippleAt`, `blurLod` and `webcamCrop` (M2); `FileHost` reads are not
rate-limited; a packaged Electron's argv and the bootstrap entry are left to M5. To try in M5: a
real Ctrl+C on Windows during the audio pass (the console also signals ffmpeg, which may exit
before the abort is seen, giving `render` instead of `cancelled`; cleanup still runs). Unchecked:
on ReFS (Dev Drive) the file index behind `ino` may not be unique, which could refuse a legitimate
re-export; on macOS `samePath` does not normalise NFC and NFD names.

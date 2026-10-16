# M3 spike: `@cuttle/export` findings

Date: 2026-10-16. Machine: Windows 11 Pro 26200, AMD Radeon iGPU (PCI 1002:15E7, driver
31.0.21923.1000), Node 22.16, pnpm 11.20, ffmpeg/ffprobe 9.0 (gyan.dev full build), Electron
44.7.2 (Chromium 152.0.7977.149), vite 8.3.4, vitest 5.0.5.

Prototype: in a clone of `~/Projects/cuttle` at b0d17d4 (`scratchpad/m3`; nothing committed,
nothing pushed; the real repo untouched). The whole prototype as one patch against b0d17d4:
`scratchpad/m3-prototype.patch` (42 files, +2187). Scratch outputs (fixtures, exports, frame grabs,
logs, probes) are in `scratchpad/m3work`.

**Status: the prototype meets the M3 done criterion.** `pnpm export:check` builds a 10 s testsrc
fixture project (fragmented MP4 screen and webcam, AAC mic, events.jsonl with a cut-off last line,
take.json, PNG still, cuttle.json with clip/still/card scenes, a 4× speed-up, a zoom, a fill and a
blur mask, two texts, crossfades, a scene that jumps back in source time) in a temp folder whose
path has spaces and umlauts, exports it to 16:9, 1:1 and 9:16, and checks each file with ffprobe:

```
== 16x9.mp4
stream|codec_name=h264|profile=High|codec_type=video|width=1920|height=1080|pix_fmt=yuv420p|level=40|color_space=bt709|r_frame_rate=30/1|duration=10.000000|bit_rate=9365478|nb_frames=300
stream|codec_name=aac|profile=LC|codec_type=audio|sample_rate=48000|channels=2|duration=10.000000|nb_frames=470
format|duration=10.000000|size=11733363
== 1x1.mp4
stream|codec_name=h264|profile=High|codec_type=video|width=1080|height=1080|pix_fmt=yuv420p|level=32|color_space=bt709|r_frame_rate=30/1|duration=10.000000|bit_rate=5592120|nb_frames=300
stream|codec_name=aac|profile=LC|codec_type=audio|sample_rate=48000|channels=2|duration=10.000000|nb_frames=470
format|duration=10.000000|size=7016666
== 9x16.mp4
stream|codec_name=h264|profile=High|codec_type=video|width=1080|height=1920|pix_fmt=yuv420p|level=40|color_space=bt709|r_frame_rate=30/1|duration=10.000000|bit_rate=9461160|nb_frames=300
stream|codec_name=aac|profile=LC|codec_type=audio|sample_rate=48000|channels=2|duration=10.000000|nb_frames=470
format|duration=10.000000|size=11852966
```

Last full run (`pnpm export:check`, 14.0 s wall time including two builds and the fixture):

```
ok   16:9 1920x1080: 300 frames, video 10.000000 s, audio 10.000000 s, container 10.000000 s (expected 10 s)
     3.9 s total = 0.39× the video's duration, 84.0 frames/s in the page; … peak MB {"Browser":123,"GPU":243,"Utility":46,"Tab":311}
ok   1:1 1080x1080: … 2.5 s total = 0.25× …
ok   9:16 1080x1920: … 3.2 s total = 0.32× …
all 3 formats pass
```

`pnpm test`: 23 files, 217 tests (190 before + 8 project + 19 export), 8.2 s. `pnpm typecheck`:
clean with the two new configs. A 60 s 1080p30 export takes 14.5–20.4 s (0.24–0.34× the video's
duration; target ≤ 2×), a 5-minute one 80.7 s (0.27×) with flat memory.

---

## Prototype files (paths as the real code should have them)

```
package.json                                  scripts export:build, export:run, export:check; typecheck += 2 configs
README.md                                     package row, the two scripts, ffmpeg note
pnpm-lock.yaml                                mediabunny 1.61.0, @cuttle/export
packages/project/src/events.ts                parseEventsJsonl (moved from M4)
packages/project/src/take.ts                  TakeSchema, parseTakeJson, trackOffset, TAKE_VERSION
packages/project/src/index.ts                 exports of both
packages/project/test/events.test.ts, take.test.ts
packages/export/
├── package.json                              @cuttle/export; deps engine, project, timeline, mediabunny 1.61.0 (exact)
├── tsconfig.json                             DOM: page + pure modules + unit tests
├── tsconfig.node.json                        node: main process, CLI, check, fixture, Vite configs
├── src/
│   ├── index.ts                              main-process API: exportProject, ExportError, EXPORT_FORMATS, types
│   ├── formats.ts                            EXPORT_FORMATS, isExportFormat, withFormat            (pure)
│   ├── codec.ts                              videoBitrate, avcCodecString (level from size, fps, bitrate) (pure)
│   ├── frame-plan.ts                         frameCount, planFrames: per-scene frames and source times (pure)
│   ├── audio.ts                              planAudio, atempoChain, audioFilterGraph, muxArgs      (pure)
│   ├── job.ts                                ExportJob, PageResult, ExportHost, CHANNELS (main ↔ page contract)
│   ├── errors.ts                             ExportError + code
│   ├── main/
│   │   ├── export.ts                         exportProject: validate, window, IPC, ffmpeg, rename
│   │   ├── sources.ts                        cuttle.json, take.json, events.jsonl, file checks
│   │   ├── files.ts                          FileHost: allow-listed range reads, positional writes
│   │   ├── window.ts                         hidden sandboxed window, crash detection, console forwarding
│   │   └── ffmpeg.ts                         checkFfmpeg, runFfmpeg (CUTTLE_FFMPEG)
│   └── page/
│       ├── index.ts                          bundle entry: window.cuttleExport = { run }
│       ├── run.ts                            the frame loop
│       ├── host.ts                           window.cuttleHost typing, PageError
│       ├── media.ts                          openVideo: Mediabunny Input over IPC, size, time range
│       ├── track-reader.ts                   TrackReader: one decoder per scene and track
│       ├── scene-sources.ts                  SceneSources: open ahead, close after, FrameSources per frame
│       ├── images.ts                         loadImage: premultiplied, downscaled to MAX_TEXTURE_SIZE
│       └── video-output.ts                   CanvasSource + Mp4OutputFormat + StreamTarget, encoder choice
├── electron/
│   ├── export-page/index.html                page with CSP (copied into the page bundle)
│   ├── export-page/preload.cjs               contextBridge → window.cuttleHost
│   ├── vite.main.config.ts                   cli.ts, check.ts → dist/*.mjs (self-contained, electron external)
│   ├── vite.page.config.ts                   src/page → dist/export-page/page.js (IIFE)
│   ├── cli.ts                                dev CLI until M5 (exit codes 1/2/3)
│   └── check.ts                              done-criterion check and benchmark
└── test/
    ├── formats.test.ts, codec.test.ts, frame-plan.test.ts, audio.test.ts   (Node, in pnpm test)
    └── fixture.ts                            ffmpeg fixture project builder (used by check.ts)
```

How to run (from the repo root):

```bash
pnpm export:check                                         # done criterion: 16:9, 1:1, 9:16 of the 10 s fixture
pnpm export:check --formats 16:9 --seconds 60 --layout long --keep <dir>     # 60 s benchmark, keeps files
pnpm export:check --layout speedup --seconds 60 --formats 16:9               # 5 s + 50 s at 12× + 5 s
pnpm export:check --frames 1.5,3,3.8 --keep <dir>         # also writes PNG frame grabs of each output
pnpm export:run <projectDir> --format 9:16 -o out.mp4 [--encoder auto|hardware|software]
```

---

## 1. Library: Mediabunny for demux, decode orchestration and mux

Evidence (`npm view <pkg> version license deprecated time`, 2026-10-16):

| Package | Latest | License | State |
|---|---|---|---|
| `mp4-muxer` | 5.2.2 (2025-07-02) | MIT | **deprecated on npm**: "This library is superseded by Mediabunny. Please migrate to it." |
| `mp4box` (mp4box.js) | 2.4.1 (2026-06-19) | BSD-3-Clause | maintained (GPAC); demux only |
| `mediabunny` | 1.61.6 (2026-10-16, today) | MPL-2.0 | very active: 195 versions, 1.55.0 → 1.61.6 since 2026-08-17 |
| `web-demuxer` | 4.0.0 (2025-12-20) | – | WASM demuxer, not needed |

Two-week rule: 1.61.1 is from 2026-10-03 (13 days), so **`mediabunny@1.61.0` (2026-09-29)** is the
newest allowed version; pinned exactly. Unpacked size 10.9 MB; dependencies only two `@types`
packages. The page bundle (engine + mediabunny + zod) is 1.13 MB unminified.

Recommendation: **Mediabunny only**, no mp4box.js, no mp4-muxer. `Input` + `CustomSource` demux
(MP4 including fragmented), `VideoSampleSink.samplesAtTimestamps` drives WebCodecs `VideoDecoder`,
`CanvasSource` drives `VideoEncoder` with back-pressure, `Output` + `Mp4OutputFormat` +
`StreamTarget` mux. Pure TypeScript; its types typecheck under the repo's strict config. MPL-2.0 is
file-level copyleft: using it unmodified as a dependency puts no obligation on Cuttle's own code
(ship its licence notice with a distributed build). The spec ("Export") and the roadmap tech stack
should name Mediabunny instead of mp4box.js + mp4-muxer.

Requirements checked:

- **Fragmented MP4 as the recorder writes it** (`libx264 … -movflags +frag_keyframe+empty_moov+default_base_moof`):
  reads fine; display size comes from the (empty) moov; `computeDuration()` walks the moofs in
  1–2 ms for a 60 s file (`getDurationFromMetadata()` is `null` for these files).
- **VFR**: testsrc with random drops and a 2.1 s gap (`select='eq(n,0)+not(between(n,40,100))*lt(random(0),0.7)'`,
  `-fps_mode vfr`, avg_frame_rate 82/5) exports correctly; inside the gap the last frame before it
  is held; counter digits match the source time (`m3work/vfr/digits.png`).
- **Arbitrary, mostly increasing times on two layers at once**: one `VideoSampleSink` (own decoder)
  per scene and track, each given the scene's sorted, de-duplicated source times. Crossfades between
  two clips of the same file and a scene that jumps back to source 1–3 s show the right frames
  (counter digits checked in `m3work/run1 Grüße/out/16x9-*.png`).
- `samplesAtTimestamps` (read in `dist/modules/src/media-sink.js`) decodes from the key frame before
  each needed time, decodes every packet at most once, skips GOPs no time needs, clones a sample
  when two times map to one frame, yields `null` where it has no frame, and flushes the decoder at
  every key-frame change.

Decode probe (`m3work/probe1/page-decode.ts`), 60 s 1920×1080 30 fps fragmented MP4 (testsrc2,
CRF 18 ultrafast, 149 MB, key frame every 8.33 s):

| | result |
|---|---|
| `samples()` sequential, hardware decoder | 1800 frames in 4177 ms = **431 fps** |
| `samples()` sequential, software decoder | 1800 frames in 1773 ms = **1015 fps** |
| `samplesAtTimestamps`, speed 1 (600 times, default decoder) | 348 fps |
| `samplesAtTimestamps`, speed 4 | 96 output fps |
| `samplesAtTimestamps`, speed 12 | 35 output fps (all frames decoded: GOP 250 > 12) |
| timestamp error | 0.0000 s |

## 2. File access from the page: IPC with byte ranges

Decision: the sandboxed page reads files through **IPC** handlers registered on its own
`webContents.ipc`, exposed by a CJS preload as `window.cuttleHost`. Mediabunny's
`CustomSource({ getSize, read(start, end), prefetchProfile: 'fileSystem' })` asks for byte ranges;
the main process answers with `FileHandle.read` (`src/main/files.ts`), so a multi-GB recording never
sits in memory. The main process serves only files on the job's allow-list (absolute paths of
screen, webcam, stills, background image) and writes only the one video-only output.

- Secure context kept: page loaded with `loadFile` (`isSecureContext === true`, `VideoEncoder`
  defined). Window: `show: false`, `sandbox: true`, `contextIsolation: true`, no node integration,
  popups and navigation denied, `backgroundThrottling: false` (long exports in a hidden page). CSP
  meta: `default-src 'none'; script-src 'self'; img-src blob: data:; font-src data:; worker-src blob:`
  (Mediabunny may start blob: workers). A run with `--enable-logging=stderr` showed no CSP
  violation and no Electron security warning.
- Throughput (`m3work/probe1/page-ipc-throughput.ts`, reading the 149 MB file sequentially):
  16 KiB reads 41 MB/s (395 µs/call), 64 KiB 149 MB/s (438 µs), 1 MiB 355 MB/s, 8 MiB 552 MB/s.
  Mediabunny's reads averaged ~99 KB (8763 reads, 870 MB in the decode probe). A CRF-18 1080p
  recording is ~2.5 MB/s, ~30 MB/s at 12×; in the exports the frame loop waited 0.3–1.3 s in total
  on decoded frames per 1800–9000 frames. IPC is not a bottleneck.
- Output: Mediabunny `StreamTarget(writable, { chunked: true, chunkSize: 8 MiB })` → `host.write(data,
  position)` → positional `FileHandle.write` into `<os tmp>/cuttle-export-*/video.mp4`
  (`fastStart: false`: moov written once at finalize; ffmpeg moves it to the front).
- Per-window IPC (not global `ipcMain.handle`): several exports in one process do not clash.
- Considered, not built: a privileged custom protocol with Range support and Mediabunny's
  `UrlSource`. Useful in phase 2 if the preview wants `<video src>`; for export, IPC is simpler,
  needs no CORS between `file://` and the scheme, and keeps the allow-list.

## 3. Encoding

- `VideoEncoder.isConfigSupported` in the export window (Electron 44, real GPU): `avc1.640028`
  1920×1080, 1080×1920 and 1080×1080, `avc1.64002A` 1080×1920, `avc1.640033` 3840×2160: supported
  with `prefer-hardware` and `prefer-software` and bitrate modes `variable`/`constant`; `quantizer`
  only with hardware. `VideoDecoder` H.264 1080p: hardware and software.
- **Real GPU**: `UNMASKED_RENDERER_WEBGL` = `ANGLE (AMD, AMD Radeon (TM) Graphics (0x000015E7)
  Direct3D11 vs_5_0 ps_5_0, D3D11)`, `MAX_TEXTURE_SIZE` 16384 (SwiftShader 8192). The export does
  not touch the GPU switches; every result reports the renderer string (`stats.gpu`).
- Codec string: `avcCodecString(width, height, fps, bitrate)` in `src/codec.ts`: High profile,
  smallest level by frame size, per-side limit √(8·MaxFS), **macroblock rate** and bitrate ×1.25.
  Mediabunny's builder ignores the frame rate, so ours goes in as `fullCodecString`.
  16:9 and 9:16 at 30 fps → `avc1.640028` (level 4: 1080×1920 = 68×120 = 8160 MB ≤ 8192,
  244 800 MB/s ≤ 245 760); 1:1 → `avc1.640020` (3.2); 1080p60 → `avc1.64002a` (4.2); the schema's
  maximum 4096² at 120 fps → `avc1.64003d` (6.1).
- Rate control: VBR, 0.16 bit per pixel and frame (`videoBitrate`: 9.95 Mbit/s at 1080p30, 5.6 at
  1080²), key frame every 2 s (Mediabunny `keyFrameInterval`), `latencyMode: 'quality'`. Output:
  High, `yuv420p(tv, bt709)` with bt709 primaries/transfer, no B-frames, 30/1.
- Hardware first, software fallback: `chooseAcceleration` checks `prefer-hardware`, then
  `prefer-software` with `isConfigSupported` (`ExportOptions.encoder: 'auto' | 'hardware' |
  'software'`, CLI `--encoder`). Measured here (table in section 4): Windows' software encoder
  (Media Foundation MFT, also High profile) is faster on this PC and writes 3× smaller files: its
  rate control undershoots (2–3 Mbit/s vs 6–10 for AMD's encoder, and it ignored a 75 Mbit/s
  target). Text quality on a scrolling-terminal fixture (`m3work/textq`, Consolas 20 px) is legible
  with both at 2× zoom (`m3work/textq/out/both-text.png`); against a 75 Mbit/s hardware export,
  PSNR-Y is 60.1 dB (hardware at 10 Mbit/s) vs 37.8 dB (software). Keep hardware first (spec:
  "hardware when available").
- Timestamps: `CanvasSource.add(i / fps, 1 / fps)`, track metadata `frameRate: fps`; ffprobe:
  `nb_frames=300`, `duration=10.000000` for video, audio and container in every format.
- Back-pressure and frame lifetime: `CanvasSource.add` waits for `dequeue` when `encodeQueueSize ≥ 4`
  and for the writer; it creates and closes the canvas `VideoFrame` itself. Decoded frames are
  closed by `TrackReader` (the `VideoSample` and its `toVideoFrame()` copy) when it moves on or
  closes. Memory stays flat over 9000 frames (section 11).
- Lost context: `render()` throws on a lost context (M2) and the loop checks `gl.isContextLost()`
  between `render` and `add`. Simulated with `WEBGL_lose_context` at frame 100 (temporary patch,
  reverted): exit code 3, "the WebGL context was lost during the export", no partial file, the
  previous file at the target path untouched.

## 4. Decode strategy and performance

Strategy (`src/frame-plan.ts`, `src/page/scene-sources.ts`, `src/page/track-reader.ts`):

1. `planFrames(timeline, fps)` walks every output frame once (`frameAt(i / fps)`) and records per
   scene the first and last frame it is visible on (crossfades included) and its distinct source
   times, ascending. `frameCount = ceil(duration · fps − 1e-6)`.
2. Each clip scene gets a `TrackReader` (own decoder) for the screen and one for the webcam,
   created **1 s before** the scene first shows, so `samplesAtTimestamps` decodes ahead in the
   background (the incoming crossfade frame is ready), and closed after the scene's last frame.
   A scene that jumps back in source time is just another reader; nothing seeks backwards.
3. `frameAt(time)` steps through the planned times ≤ `time` and returns the newest decoded frame;
   an earlier time returns the current one (the outgoing crossfade layer holds its last frame).
   Screen times are clamped to the track's first timestamp; webcam times outside the webcam's range
   give no bubble.
4. Still images load at the same lookahead and are closed after the scene.

**Decode in software** (`DECODER = { hardwareAcceleration: 'prefer-software' }` in `run.ts`):
hardware decode and hardware encode share the GPU's video engine. 60 s 1080p30 sources, output
1080p30, fixture with webcam bubble, cursor, zoom, two masks, two texts:

| decoder | encoder | `long`: one 60 s clip | `speedup`: 5 s + 50 s at 12× + 5 s = 14.2 s |
|---|---|---|---|
| hardware | hardware | 20.4 s, 91 fps (0.34×) | 12.6 s, 35 fps (0.89×) |
| hardware | software | 15.1 s, 124 fps (0.25×) | – |
| **software** | **hardware (default)** | **17.5 s, 107 fps (0.29×)** | **5.9 s, 76 fps (0.42×)** |
| software | software | 14.5 s, 130 fps (0.24×) | 5.1 s, 89 fps (0.36×) |

Times are `exportProject` wall time (window, decode, render, encode, mux and the ffmpeg audio pass);
fps = frames / page time. Where the time goes (software decode, hardware encode, `long`): waiting
for decoded frames 0.4 s, render 1.9 s (CPU side of the GL calls), encode 13.5 s (includes the GPU
finishing the frame, the canvas `VideoFrame` and encoder back-pressure), finalize 0.1 s, ffmpeg
audio 0.5 s. The encoder is the bottleneck; texture upload of decoded frames (M2's open point) is
not, so `texSubImage2D` is not needed.

Five minutes (`--seconds 300 --layout long`, software decode, hardware encode): 9000 frames, video,
audio and container exactly 300.000000 s, **80.7 s (0.27×)**, 115 fps.

Speed-ups: below the GOP length every source frame is decoded anyway (12× with a 250-frame GOP).
With the recommended 2 s GOP (section 11) whole GOPs are skipped only above 60×. Decode cost is
therefore ~speed × the normal rate, fine with the ~1000 fps software decoder up to the schema's 64×.

## 5. Audio with ffmpeg

`src/audio.ts`, pure and unit-tested (`test/audio.test.ts`):

- `planAudio({ spans, look, mic, seconds })`: one segment per scene on the **video's** boundaries,
  in samples at 48 kHz (`round(span.start · 48000)`); the last segment runs to `frames / fps`, so
  audio and video end on the same sample. Clips play their mic range (`from`/`to` in samples)
  unless `muteSpedUp && speed > 1`; stills, cards and a missing mic are silence.
- Crossfades: the video crossfades around each cut. Audio does **not** overlap (that would play mic
  outside `[from, to)`): a segment fades out over the half-crossfade before the cut and the next
  fades in over the half after it (at least 10 ms, so hard cuts do not click). A short dip where the
  picture crossfades.
- `audioFilterGraph(segments, micOffset)`:
  `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,<shift>,asplit=N[m0]…`, per
  clip `[mK]atrim=start_sample=…:end_sample=…,asetpts=N/SR/TB,<atempo…>,apad,atrim=end_sample=…,asetpts=N/SR/TB,afade=t=in:ss=0:ns=…,afade=t=out:ss=…:ns=…[sI]`,
  silence `anullsrc=r=48000:cl=mono,atrim=end_sample=…[sI]`, then
  `[s0][s1]…concat=n=…:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]`. The mic is shifted once (`adelay=<n>S:all=1`
  when it started after the screen, `atrim=start_sample=<n>,asetpts=N/SR/TB` when before), so every
  segment uses screen times.
- **Gotcha**: when a clip's mic range lies past the mic's end, `apad` gets no input frame and emits
  frames without timestamps; `concat` then fails with "Invalid data found when processing input"
  (verbose log: `Segment finished at pts=-9223372036853702475`). Fix: `asetpts=N/SR/TB` after the
  final `atrim`. `atrim` counts samples, not timestamps, so the length stays exact.
- `atempo` takes 0.5–100 in ffmpeg 9 (`ffmpeg -h filter=atempo`: "from 0.5 to 100"); slower speeds
  chain (`atempoChain(0.2)` = `0.5,0.5,0.8`). With `muteSpedUp: false` the 4× scene plays the mic
  4× faster: beeps every 0.25 s at 3.196, 3.435, 3.686, 3.942, 4.195, 4.435 s (atempo adds ~5 ms
  latency) — `m3work/edge/loud`.
- No mic or `look.audio.enabled: false`: **a silent AAC track** (same graph, no mic input):
  AAC 48 kHz stereo, 10.000000 s, `max_volume: -91.0 dB` (`m3work/edge/nomic`). Uniform files for
  players, editors and platforms; matches the done criterion; ~13 kbit/s.
- Mux (`muxArgs`): `ffmpeg -hide_banner -nostdin -loglevel error -y -i video.mp4 [-i mic]
  -filter_complex <graph> -map 0:v:0 -map [aout] -c:v copy -c:a aac -b:a 160k -ar 48000
  -movflags +faststart -f mp4 <target>.partial`. 0.13 s for 10 s, 0.5 s for 60 s, 2.4 s for 5 min.
  The graph is a command-line argument; with ~150 characters per scene, Windows' 32 767-character
  limit allows ~200 scenes (`-/filter_complex <file>` if that ever matters).
- **Sync verified** with `silencedetect` on the 16:9 export: the fixture mic beeps at every mic
  second and started 0.2 s before the screen (take.json). Expected beeps (source = mic − 0.2): 0.8,
  1.8, 2.8 in scene 0, none in the 4× scene, still or card, 1.8 → 7.3 and 2.8 → 8.3 in the scene that
  replays source 1–3 s. Measured: `silence_end: 0.800021, 1.800021, 2.800021, 7.300021, 8.300021`.
  The mic is 0.5 s shorter than the screen and is padded.

## 6. Track sync: `take.json`

Recommendation: M3 defines `take.json` in `@cuttle/project` (`src/take.ts`), M4 writes it, export
reads it when present.

```json
{ "version": 1,
  "tracks": { "screen": { "file": "screen.mp4", "start": 1000.0 },
              "webcam": { "file": "webcam.mp4", "start": 1000.5 },
              "mic":    { "file": "mic.m4a",    "start": 999.8 } } }
```

- `start`: seconds on one monotonic clock (any origin) when the track's first frame or sample was
  captured. `trackOffset(take, 'mic')` = mic start − screen start; track time = source time − offset.
- Looked up next to the screen track (`dirname(sources.screen)/take.json`). An offset applies only
  when `tracks.<name>.file` resolves to the file `sources.<name>` points at, so a swapped file gets
  no wrong offset. No take.json: offsets 0 (tracks taken as lined up). An invalid take.json is a
  validation error with zod paths.
- events.jsonl needs no entry: the spec has the recorder write screen-track seconds.
- No new fields in `cuttle.json`. Rejected alternative: requiring M4 to write aligned tracks
  (trimming a started track means re-encoding or cutting at key frames).
- Webcam sync verified: the fixture webcam (grey testsrc with counter) started 0.5 s after the
  screen; the bubble shows webcam second 1 at output 1.5 s and 5 at 3.8 s (source 6.2 s)
  (`m3work/run3/out/bubbles.png`). The audio check above verifies the mic offset.
- Left to M4: measuring each track's real first-capture time on that clock.

## 7. events.jsonl parsing

`@cuttle/project` only had `InputEventSchema`. The prototype adds `parseEventsJsonl(text)` to
`@cuttle/project` (`src/events.ts`) with the roadmap's signature `{ events, issues }`: one event per
line, blank lines and CRLF tolerated, an **unterminated** last line that is not valid JSON dropped
without an issue (a crashed recorder), every other bad line an issue at `line <n>` or
`line <n>.<field>`. Export treats issues as a validation error (exit 1). Proposal: M3 owns
`parseEventsJsonl` (the roadmap's "M4, first step" moves to M3; M4 and M5 import it). The main
process parses the file before the window opens; the events reach the page in the job.

## 8. screenSize

From the screen track: `track.getDisplayWidth()/getDisplayHeight()` (after rotation and pixel
aspect). No video track, no size, an undecodable codec or an unreadable file → `invalid-media`
naming the file (exit 1). An empty (0 byte) file is caught before the window opens: "screen
recording (sources.screen) is empty (0 bytes): …" (Mediabunny alone said "Assertion failed.").

Found with a cut-off take (screen.mp4 truncated to 60 % of its bytes, as a killed ffmpeg leaves a
half-written fragment): Mediabunny lists all of the fragment's samples (`computeDuration()` = 8.33 s)
but only 5.97 s of data exist (ffprobe: 179 frames, "partial file"); `samplesAtTimestamps` yields
`null` for the rest. The first prototype held the last good frame silently (a frozen screen with a
moving cursor and webcam, `m3work/fail/g2-7s.png`). Fixed: `TrackReader.frameAt` returns
`undefined` where the track has no frame and `SceneSources` fails with "the screen recording has
no frame at 5.967 s (scenes[0]); the file may be cut off, end the scene earlier" (exit 1). Scenes
inside the readable part export fine. A clip ending after `computeDuration()` + 50 ms fails before
rendering: "scenes[3] ends at 30 s, but the screen recording ends at 10.000 s".

## 9. Stills

`loadImage` (`src/page/images.ts`): bytes over IPC → `Blob` → `createImageBitmap(blob,
{ premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' })`; when the longer side exceeds
`MAX_TEXTURE_SIZE` it decodes again with `resizeWidth`/`resizeHeight`, `resizeQuality: 'high'`. A
1280×20000 PNG (> 16384) exports without error (`m3work/edge/tall`). The scroll still with the
`browser-light` frame renders as expected (`16x9-5.50s.png`). A band upload would keep the full
resolution of very tall pages; not needed below 16384 px on a real GPU.

## 10. Packaging, scripts, tests

- `@cuttle/export` exports the **main-process** API from `src/index.ts`: `exportProject`,
  `ExportOptions`, `ExportResult`, `ExportStats`, `ExportError`, `EXPORT_FORMATS`,
  `isExportFormat`, types `ExportFormat`, `EncoderPreference`, `ExportErrorCode`. Unit tests import
  the pure modules directly (importing `src/index.ts` would pull in `electron`).
- Two Vite builds (`packages/export/electron/`), run in this order by `pnpm export:build`:
  - `vite.main.config.ts`: SSR build of `cli.ts` and `check.ts` to `packages/export/dist/*.mjs`,
    `ssr.noExternal: true` (workspace packages ship TS; zod is bundled), only `electron` external,
    shared chunks next to the entries (`chunkFileNames: '[name]-[hash].mjs'`), empties `dist/`.
  - `vite.page.config.ts`: the page as one IIFE (`dist/export-page/page.js`, fonts inlined as in
    M2), `publicDir: 'export-page'` copies `index.html` and `preload.cjs`.
  - `exportProject` finds the page at `new URL('./export-page/', import.meta.url)`: next to whichever
    bundle contains it; `ExportOptions.pageDir` overrides. Surprise on the way: Vite first put the
    shared chunk into `dist/assets/`, where that URL pointed to `dist/assets/export-page/`.
- Scripts: `export:build`, `export:run` (pnpm appends the arguments: `pnpm export:run <dir>
  --format 9:16 -o x.mp4` works), `export:check`. The check needs ffmpeg, ffprobe and a GPU, so it
  is a script like `engine:electron`, not part of `pnpm test`.
- `pnpm typecheck` covers the package through two configs added to the root script. Electron's
  typings need no DOM lib.
- Electron details that bit:
  - Closing an app's last window quits it by default: the export window stays open until ffmpeg
    is done, and the CLI also registers a no-op `window-all-closed`.
  - `process.argv` keeps Chromium switches: `electron --enable-logging=stderr x.mjs a --b c` gives
    `[exe, '--enable-logging=stderr', 'x.mjs', 'a', '--b', 'c']`. The CLI drops everything up to the
    script when `process.defaultApp`.
  - `uncaughtException` handlers in the entries (Electron's default is a modal dialog).
  - Page warnings and errors are forwarded to stderr as `[export page] …`; stdout stays clean for
    JSON.

## 11. Other things that bite

- **Colour.** Chromium decodes **untagged** HD H.264 as BT.709; ffmpeg converts RGB→YUV with BT.601
  unless told. The first fixture (untagged, BT.601 matrix) came out shifted (red 253,0,0 → 255,23,0;
  green 0,255,0 → 0,215,0). With `-vf scale=out_color_matrix=bt709:out_range=tv,format=yuv420p
  -colorspace bt709 -color_range tv` the export reproduces testsrc within 2 (yellow 253,253,0,
  blue 0,0,254, green 0,254,0, red 254,0,0). **M4 must write BT.709 matrix and tags.** For byte
  comparisons extract frames with `-vf scale=in_color_matrix=bt709:in_range=tv,format=rgb24`:
  ffmpeg 9's default PNG conversion of the export (tagged bt709 matrix, primaries and transfer)
  shifts values (red 254,0,0 → 232,0,1); for a file tagged only with the bt709 matrix it does not.
- **Memory** (working set peaks, `app.getAppMetrics()` every second): 10 s exports GPU 241–281 MB,
  page 311–325 MB, browser ~125 MB; 60 s GPU 208–469, page 187–534 (software decode keeps frames in
  the renderer); 5 min GPU 240, page 349, browser 127 MB. No growth with length.
- **Partial output**: frames go to `<os tmp>/cuttle-export-*/video.mp4`; ffmpeg writes
  `.<name>.<random>.partial` next to the target; `rename` at the end replaces an existing file (a
  file open in a player fails with a clear message). On any failure the partial and the temp dir are
  deleted and an existing target stays (lost-context run). ffmpeg is checked (`ffmpeg -version`)
  before rendering, so a missing ffmpeg fails at once (exit 2).
- **Windows paths**: all runs used project and output folders like
  `…\run1 Grüße\Projekt mit Ümlaut\…` and `%TEMP%\cuttle export Grüße XXXX\…`.
- **Recorder GOP**: the fragment is the GOP (`frag_keyframe`); with libx264's default key frame
  every 250 frames a crash loses up to 8 s and a scene starting mid-GOP decodes up to 249 extra
  frames. Recommend M4 `-force_key_frames "expr:gte(t,n_forced*2)"` (works with VFR) or `-g 60`.
  The ultrafast preset writes Constrained Baseline; fine.
- **Timeline quirk (M1)**: past a clip's end the timeline holds `length − 1/fps`, which is up to one
  frame *earlier* than the last frame shown before the end when the clip length is not a multiple
  of 1/fps. Measured with a throwaway test for a 0–1.01 s clip followed by a card at 30 fps:
  frames 29–34 get source times `0.9667 1.0000 0.9767 0.9767 0.9767 0.9767`. Export de-duplicates the times and returns
  the newest decoded frame for an earlier request; masks are computed for the held time, so a mask
  edge could be off by one frame there.
- **Exit codes** (dev CLI): missing screen → 1, invalid cuttle.json → 1 with zod paths (`look.frame:
  Unrecognized key: "colour"`, `scenes[0].to: Too small …`), clip past the recording → 1, cut-off
  take → 1, empty file → 1, `CUTTLE_FFMPEG=no-such-ffmpeg` → 2, lost WebGL context → 3, bad CLI
  arguments → 1.

## Interface changes against the roadmap

- `ExportOptions.format` is **optional**: without it the project's `output` size is used (its
  default is the 16:9 preset). Names unchanged.
- `ExportOptions` gains `encoder?: 'auto' | 'hardware' | 'software'` and `pageDir?: string`.
- `ExportResult` gains `stats` (GPU string, codec, acceleration, bitrate, page timings, audio and
  total ms).
- `ExportError` with `code`: `invalid-project` | `missing-file` | `invalid-media` → exit 1,
  `ffmpeg-missing` → 2, `render` → 3.
- New in `@cuttle/project`: `parseEventsJsonl` (from M4), `TakeSchema`, `parseTakeJson`,
  `trackOffset`, `TAKE_VERSION`, types `Take`, `TakeTrack`, `TakeParseResult`.
- Tech stack: `mediabunny` 1.61.0 instead of mp4box.js + mp4-muxer.

## Open questions (with recommendations)

1. **Encoder default.** Hardware first (spec) or software first (faster and smaller here)?
   Recommend hardware first, `--encoder software` as the escape hatch; revisit on macOS
   (VideoToolbox) and on a second Windows GPU.
2. **macOS.** Nothing ran on a Mac. Software decode, `prefer-software` H.264 High encode support
   and the GPU path need one run of `pnpm export:check` there (WebCodecs software H.264 encoding on
   macOS may be Baseline-only; `auto` would then use VideoToolbox).
3. **Hardware encoder failing mid-export** (driver reset): currently a render error (exit 3). A
   retry with `encoder: 'software'` in `exportProject` would be cheap to add; recommend doing it
   only if it shows up.
4. **Very tall stills** are downscaled to `MAX_TEXTURE_SIZE`; recommend keeping that (16384 on real
   GPUs) and moving the engine's band upload to a later milestone.
5. **Audio at crossfades**: fade-out/fade-in dip (no overlap). Recommend keeping it; an overlapping
   crossfade would need mic audio from outside the scenes' ranges.
6. **M5 integration**: the CLI's Electron entry must bundle `@cuttle/export` with the same Vite
   setup and ship `export-page/` next to it (or pass `pageDir`), register `window-all-closed` and
   `uncaughtException`, and strip Chromium switches from argv. How the `cuttle` command starts
   Electron is M5's question.
7. **Timeline hold time** (section 11): fix in `@cuttle/timeline` (hold the last frame actually
   shown) or leave it; recommend a small M3 task with a unit test, since export is where it shows.

# M4 spike: `@cuttle/recorder` findings

Date: 2026-10-16/17. Machine: Windows 11 Pro 26200, AMD Radeon iGPU, three monitors (2560×1440 at
125 % as primary, 1920×1080 to its right, 1080×1920 rotated to its left), one microphone
("Microphone Array (AMD Audio Device)", muted for desktop apps), **no webcam**. Node 22.16, pnpm
11.20, ffmpeg/ffprobe 9.0 (gyan.dev full build), vitest 5.0.5.

Prototype: in a clone of `~/Projects/cuttle` at 542a2e9 (`scratchpad/m4`; nothing committed,
nothing pushed; the real repo untouched); the whole prototype as one patch: `scratchpad/m4-prototype.patch`.
Real captures were made with the owner's OK, only their metadata was read, and every file was
deleted right after.

**Status: the prototype meets the M4 done criterion.** The `test` backend records a 3 s take with
screen, webcam, mic, events.jsonl, markers.json and take.json; `untilFile` and `untilClaude` (a fake
transcript) stop it; a real Windows run records a monitor and a region of it. 56 recorder tests and
the manual real-capture test pass, `pnpm typecheck` is clean.

## 1. Libraries

| Package | Version | Licence | Notes |
|---|---|---|---|
| `uiohook-napi` | 1.5.5 (2026-03-21) | MIT | N-API prebuilds for win32-x64/arm64, darwin, linux; works in Node 22 and Electron alike |
| `koffi` | 3.3.2 (2026-09-27; 3.3.3 is younger than two weeks) | MIT | FFI for user32, dxgi, shcore, dwmapi; prebuilt |

pnpm 11 refuses install scripts by default (`ERR_PNPM_IGNORED_BUILDS`, exit 1 on `pnpm install`).
Both packages ship prebuilt binaries and load without their scripts, so `pnpm-workspace.yaml` gets
`allowBuilds: { koffi: false, uiohook-napi: false }`: no foreign install script runs, install exits 0.
Both are loaded with `import()` only on the Windows path, so the `test` backend never touches them.

## 2. Track start times: wall-clock timestamps from ffmpeg

Every capture input gets `-use_wallclock_as_timestamps 1`; ffmpeg then prints the input's start as
`Input #0, …: Duration: N/A, start: 1792189686.207373` (Unix seconds of the first packet). Without
`-copyts` the output file still starts at 0. That start goes into take.json; all tracks share the
clock, so their differences are the offsets export needs. Precision depends on the stream's time
base: testsrc at 30 fps gave `start: 1792189669.000000` (quantized to 1/30 s); `settb=1/1000000` at
the end of a lavfi graph gives microseconds. ffmpeg's clock and Node's `Date.now()` agree to well
under a millisecond (a start 0.03 ms "after" `Date.now()` was only `Date.now()` dropping the
microseconds), so input events stamped with `Date.now()` line up with the tracks.

All lavfi sources of the test backend need real-time pacing (`realtime` / `arealtime`): otherwise
they deliver their frames at once and the wall-clock stamps collapse (freezedetect saw nothing).

## 3. Monitors: DXGI outputs = ddagrab `output_idx`

ddagrab only logs "Opened dxgi output N with dimensions WxH" (no position). It opens the outputs of
the default D3D11 adapter, so the same enumeration through DXGI (koffi COM calls:
`CreateDXGIFactory1` → `EnumAdapters1(0)` → `EnumOutputs(i)` → `GetDesc`) gives each index its
desktop rectangle, rotation and HMONITOR (→ `GetDpiForMonitor`):

```
output 0: \\.\DISPLAY1 at (0, 0) 2560x1440 rotation 1 dpi 120
output 1: \\.\DISPLAY2 at (2560, 509) 1920x1080 rotation 1 dpi 96
output 2: \\.\DISPLAY3 at (-1080, -335) 1080x1920 rotation 4 dpi 96
```

ddagrab: output 0 2560×1440, 1 1920×1080, 2 1080×1920, 3 fails: same order and sizes. This is exact,
unlike matching Electron's displays by size and position (the roadmap's plan). Monitors on a second
adapter cannot be grabbed by ddagrab and are not listed. The process must be per-monitor DPI aware
(`SetProcessDpiAwarenessContext(-4)`) before anything reads coordinates.

## 4. Mouse coordinates: uiohook reports physical desktop pixels

Pointer moved with `SendInput` (absolute, virtual desktop; no clicks) to the centre of every
monitor; uiohook's last `mousemove` equals `GetCursorPos`, including the 125 % monitor and negative
coordinates left of the primary:

```
target (1280, 720)   GetCursorPos (1280, 720)   uiohook (1280, 720)
target (3520, 1049)  GetCursorPos (3520, 1049)  uiohook (3520, 1049)
target (-540, 625)   GetCursorPos (-540, 625)   uiohook (-540, 625)
```

In the prototype's real `record()` on monitor 1 (origin 2560, 509), moves to monitor pixels (100, 100),
(960, 540) and (1800, 1000) arrived in events.jsonl as exactly those values, after a `move` at t=0
with the pointer's position when the screen track started. uiohook's own event `time` is the
system tick count (not wall clock), so the recorder stamps events with `Date.now()`. Dragging is
reported as `mousemove`. The wheel's `rotation` is in notches, positive toward the user; a touchpad's
small deltas add up and arrive as rotation 0 first (skipped).

## 5. Cursor shape: `GetCursorInfo`

`LoadCursorW(NULL, IDC_*)` gives the shared system handles (arrow 0x10003, text 0x10005, wait 0x10007,
crosshair 0x10009, move 0x10015, not-allowed 0x10017, pointer 0x1001f, appstarting 0x10019);
`GetCursorInfo().hCursor` is compared with them (appstarting → `wait`, anything else → `arrow`).
Cheap: 73 728 calls in 200 ms, so polling at 30 Hz costs nothing.

## 6. koffi: name every type

koffi 3.3.2 gave an anonymous struct (`DXGI_OUTPUT_DESC`) and an anonymous callback prototype
(`WNDENUMPROC`) the same internal name `<anonymous_52>`; `koffi.pointer(struct)` then returned the
cached callback pointer and `koffi.out()` threw "Unexpected <anonymous_52> * type, expected pointer
or string type". Named types fix it, but a name can be defined once per process and vitest (or a
bundle with two copies) loads a module more than once: names get a per-load prefix
(`cuttle${process.hrtime.bigint()}_RECT`). Then: DXGI monitors in 25 ms (scale 1.25, 1, 1), 15
windows in 1.4 ms (visible, not minimized, not cloaked, no tool windows, bounds from
`DWMWA_EXTENDED_FRAME_BOUNDS`, monitor from `MonitorFromWindow` matched to the DXGI output's
HMONITOR), pointer position and shape.

## 7. A real capture

Monitor 0 without the pointer and the microphone at the same time, 3 s, both stopped with `q`:

- screen: `ddagrab=output_idx=0:framerate=30:draw_mouse=0,hwdownload,format=bgra,settb=1/1000000`,
  libx264 ultrafast CRF 18, BT.709 matrix, fragmented MP4: 2560×1440, 93 frames in 3.13 s (29.7 fps),
  not black, start 0.148 s after spawn, stop 302 ms after `q`, exit 0. **The transfer tag came out
  `iec61966-2-1`** (sRGB, carried by ddagrab's frames) although `-color_trc bt709` was given;
  `setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv` at the end of the filter
  chain fixes it (checked: `bt709` on a real capture and on a region).
- mic: `-f dshow -i "audio=…"`, AAC: 44.1 kHz stereo (the device's format; export resamples), stop
  915 ms after `q`, exit 0. **The signal was digital silence (mean −91 dB, max −84 dB)**: the
  microphone is muted or blocked for desktop apps. The recorder now says so (section 10).
- A region through ddagrab's own options (`offset_x=100:offset_y=100:video_size=640x360`) gave a
  640×360 track, cropped before the GPU download.
- The prototype's `record()` on the primary monitor: 3.6 s for `maxSeconds: 3` (start-up and the
  stop latency), wall time 4.0 s.

## 8. Mic timing: the DirectShow buffer

With wall-clock timestamps a packet is stamped when it reaches ffmpeg, one device buffer after its
first sample was captured. Mic start after spawn, two runs each:

```
default buffer          0.802 s, 0.694 s
-audio_buffer_size 50   0.244 s, 0.234 s
```

The default buffer is ~500 ms here: take.json would put the mic ~0.45 s late (lip sync off). The
recorder passes `-audio_buffer_size 50` and writes `start − 0.05` for a DirectShow mic.

## 9. Stop triggers

- **untilIdle**: `[0:v]split[rec][idle];[idle]scale=320:-2,format=gray,freezedetect=n=-60dB:d=<s>,nullsink`
  logs `lavfi.freezedetect.freeze_start: <t>` once the picture has not changed for `d` seconds. A
  blinking caret changes ~1e-5 of the picture, far below −60 dB. A freeze that starts at 0 means the
  screen has not changed since the take started (the user has not begun yet): the recorder ignores
  it and waits for a freeze after a change. Checked with the still test monitor (moves 1 s, then
  still: stopped at 2.06 s with d=1) and a strip of testsrc2 that does not change in its first 3 s
  (`freeze_start: 0` only, no stop).
- **untilFile**: polled every 200 ms; a flag that already exists at the start is refused, or the
  take would stop at once. Written 1.5 s in: stopped at 2.06 s.
- **untilClaude**: transcripts are `~/.claude/projects/<cwd with every non-alphanumeric replaced by
  ->/<session>.jsonl` (checked against 32 project folders, e.g. `Rufi v0.1` → `Rufi-v0-1`;
  `CLAUDE_CONFIG_DIR` moves `~/.claude` as in Claude Code). Line shapes, counted in the treg-demo
  project (structure only, no content read):

  ```
  14 assistant stop=tool_use items=[tool_use]     10 assistant stop=tool_use items=[thinking]
   5 assistant stop=tool_use items=[text]          1 assistant stop=end_turn items=[thinking]
   1 assistant stop=end_turn items=[text]          1 assistant stop=stop_sequence items=[text] apiError
  14 user array[tool_result] toolUseResult         2 user string (prompts)
   2 user string starting "<" (slash commands)     2 user meta lines (string or array[text])
  31 attachment, 7 last-prompt, 6 mode, 6 permission-mode, 5 ai-title, 3 system, … (skipped)
  ```

  One assistant message is split over several lines (9 of 15 ids) and **every line carries the
  final `stop_reason`**: the end of a turn is the first `end_turn` line of a message (deduplicated by
  message id). An API error ends a turn with `isApiErrorMessage: true` and counts as the end too.
  Subagent lines carry `isSidechain: true`; their `end_turn` must not stop the recording. Meta user
  lines and local command output (`<local-command-stdout>`) are not prompts. Several sessions can
  run in one folder (the session that started the recorder among them), so the watcher follows the
  first session that submits a prompt after `record()` was called and ignores the others. With a
  fake transcript: another session's `end_turn` and a subagent's `end_turn` were ignored, the take
  stopped 2 s (the tail) after the answer, markers prompt 0.96 s, tool "Bash" 1.27 s, answer 1.89 s.

## 10. Muted microphone

`[0:a]asplit[rec][chk];[chk]silencedetect=n=-80dB:d=1,anullsink` logs `silence_start: 0.018` one
second into a silent mic (`anullsrc`) and nothing for a sine. Digital silence is −91 dB; room noise
through a real, unmuted microphone is far louder than −80 dB. The recorder warns once (event and
`Take.warnings`) when silence starts in the first second. The real microphone here triggers it.

## 11. Crash safety

- **A killed ffmpeg left 28 bytes** (ftyp only, no moov) for a still screen and for the mic: the
  fragmented-MP4 flags alone are not enough, ffmpeg's write buffer never filled. With
  `-flush_packets 1` a still 1280×720 screen killed after 4.5 s was readable for 2.0 s (one GOP
  lost). Audio has no GOPs: `frag_keyframe` wrote no fragment at all; `-frag_duration 1000000
  -flush_packets 1` gave 4.03 s of 4.5 s (4 fragments).
- **No orphans on Windows**: a Node parent killed with `taskkill /F` took its ffmpeg child with it
  (libuv puts children in a job object that kills them when the parent goes away); the file was
  readable up to its last fragment.
- `record()` with the screen ffmpeg killed mid-take: `done` rejected with `capture` ("the screen
  capture stopped unexpectedly (ffmpeg exit code 1)") within ~0.5 s; the mic was stopped with `q`
  and kept its full length; take.json, events.jsonl and markers.json stayed. The plan tests the same
  path with a test camera that ends after 1 s.

## 12. The test backend end to end

- 3 s take, monitor 0 + "Test Camera" + "Test Microphone", `maxSeconds: 3`, no countdown: wall time
  3.2 s; screen 1280×720 and webcam 640×480 H.264 tagged bt709, mic AAC 48 kHz, ~3.17 s each;
  take.json offsets webcam +7 ms, mic +19 ms; events.jsonl valid, starting with the pointer's
  position and shape at t=0; a manual marker at 0.948 s.
- Region `[100, 50, 401, 301]` → 400×300; window "test win" → 640×360 with events relative to it; a
  region outside the monitor → `invalid-options`; a stop during the countdown → `cancelled`, no take
  folder.
- The ten `record()` integration tests run concurrently in ~6 s.

## 13. Not covered here

- **No webcam on this machine**: real DirectShow video capture (`-f dshow -rtbufsize 256M -i
  video=<name>`, the device's default format) is untested; the user's first real webcam take should
  be checked (format, frame rate, latency).
- **macOS**: no Mac here. `avfoundation` capture, device listing and the cursor shape stay for a
  later milestone; `record()` and `listDevices()` refuse with `unsupported-platform` (the `test`
  backend runs everywhere).
- The hotkeys (Ctrl+Shift+Alt+S stop, Ctrl+Shift+Alt+M marker) were not pressed in a test: typing
  them through `SendInput` would also reach whatever window has the focus.

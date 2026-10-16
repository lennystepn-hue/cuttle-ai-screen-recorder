# Cuttle: design

Date: 2026-10-16. Status: approved in chat, phase 1 ready for an implementation plan.

Cuttle records the screen (plus webcam, mic and input events) and turns the take into a polished
demo video: cuts, speed-ups, smooth zooms, masks for private content, a window frame on a designed
background, text overlays and an end card. A person drives it through a desktop app, Claude drives
it through a CLI and a skill. Both edit the same project file and render with the same engine.

Name: Cuttle (cuttlefish change their look in an instant; "cut" is in the name). CLI: `cuttle`.
Project file: `cuttle.json`. Repo: `~/Projects/cuttle`.

## Origin

Built from a manual pipeline used on 2026-10-16 to produce a treg launch demo: ffmpeg `ddagrab`
recording of one monitor, a watcher that stopped the recording when Claude Code's transcript showed
`end_turn`, ffmpeg cuts with fill masks over private lines, a 12x speed-up with a badge, zoom crops on
the key output, a headless Edge capture of the generated web page, and a final pass that put every
segment into a macOS-style window on a sunset sky background rendered from HTML. Cuttle makes each
of those steps a feature.

## Goals

- One project format that a person (app) and Claude (CLI) both edit.
- Preview and export come from the same engine, so what you see is what you get.
- Every feature can be switched off (`enabled: false`).
- Windows and macOS. Windows is the tested platform in phase 1.
- The app's design is a first-class requirement: quiet, contextual UI that only shows controls when
  they matter.
- Personal tool first, built clean enough to become a product later. No accounts, payments,
  auto-update or code signing in v1.

## Non-goals (v1)

- Cloud upload or share links (a Cloudflare Worker + R2 is available later if wanted).
- Music library, voice-over generation, AI narration.
- Multi-take editing on one timeline (one take per project; scenes cut from it).
- Live streaming.

## Phases

1. **Engine, CLI, skill**: `project`, `timeline`, `engine`, `export`, `recorder`, `apps/cli`,
   `skill/`. Webcam bubble, mic audio, text overlays and the cursor (real system pointer or one of
   five designed styles, with click effect) included. Input events are not yet used for zooms.
2. **Desktop app**: Electron app with source picker overlay, capture-excluded recording HUD, editor
   with timeline and contextual inspector. Gets its own spec.
3. **Auto-zoom on clicks, smoothed cursor, polish, macOS validation**. Gets its own spec.

This document fixes the architecture for all phases and details phase 1.

## Architecture

pnpm monorepo, TypeScript, Electron (Chromium provides WebGL2 and WebCodecs on both platforms).

| Unit | Responsibility | Depends on |
|---|---|---|
| `packages/project` | Types, Zod schema, defaults, version migration for `cuttle.json` | – |
| `packages/timeline` | Pure functions: `frameAt(project, outputTime) → RenderState`; output↔source time mapping, zoom easing, active masks/texts, scene transitions | project |
| `packages/engine` | WebGL2 compositor that draws a `RenderState` into a canvas; preset registry (backgrounds, frames, text styles) | timeline |
| `packages/export` | Frame loop: demux + decode sources (WebCodecs), render each frame with the engine, encode H.264, mux MP4, then mix audio with ffmpeg | engine |
| `packages/recorder` | Node: device listing, ffmpeg capture per track, input-event log, stop triggers, markers, take metadata | project |
| `apps/cli` | `cuttle` command; runs `export` and page capture inside a hidden Electron window | all packages |
| `apps/desktop` | Electron app (phase 2), same engine for live preview | all packages |
| `skill/` | Claude skill, installed to `~/.claude/skills/cuttle/` | – |

The project file is the only interface between the app, the CLI and Claude.

## Project format (`cuttle.json`, version 1)

```jsonc
{
  "version": 1,
  "output": { "width": 1920, "height": 1080, "fps": 30 },
  "sources": {
    "screen": "takes/1/screen.mp4",
    "webcam": "takes/1/webcam.mp4",
    "mic": "takes/1/mic.m4a",
    "events": "takes/1/events.jsonl",
    "markers": "takes/1/markers.json"
  },
  "look": {
    "background": { "preset": "sunset-sky" },
    "frame": { "enabled": true, "style": "mac-dark", "title": "claude · ~/treg-demo", "radius": 14, "shadow": true },
    "cursor": { "enabled": true, "style": "system", "size": 1, "color": "#D97757", "clickEffect": "ripple" },
    "webcam": { "enabled": false, "shape": "circle", "corner": "bottom-left", "size": 0.18 },
    "audio": { "enabled": true, "muteSpedUp": true },
    "transition": { "enabled": true, "duration": 0.3 }
  },
  "scenes": [
    { "type": "clip", "from": 63.5, "to": 70.5, "speed": 1 },
    { "type": "clip", "from": 5.3, "to": 152.5, "speed": 12, "badge": "12× speed" },
    { "type": "still", "image": "page.png", "duration": 4, "motion": "scroll", "frame": "browser-light" },
    { "type": "card", "title": "Claude Code + treg", "subtitle": "treg.to", "duration": 2.5 }
  ],
  "zooms": [
    { "at": 150.0, "duration": 4, "rect": [0, 170, 1600, 900], "ease": "smooth" }
  ],
  "masks": [
    { "from": 0, "to": 70, "rect": [30, 774, 780, 84], "style": "fill" }
  ],
  "texts": [
    { "at": 2, "duration": 3, "text": "One prompt, one call", "style": "pill", "position": "top" }
  ]
}
```

Rules:

- Times in `zooms`, `masks` and `texts` are **source seconds** of the screen track, so they stay
  attached to the content when scenes are cut or sped up. They only show while a clip scene covers
  that source time.
- Rects are in source pixels `[x, y, w, h]`.
- `still` and `card` scenes have their own duration and are not affected by source-time items.
- Scenes play in array order, with a crossfade between scenes (`look.transition`, default on, 0.3 s).
- Unknown fields are rejected with a message naming the path, so Claude can fix the file.
- `version` drives migrations; old files are upgraded on load, never silently rewritten.
- `look.cursor.style` is `system` (the real OS pointer, including shape changes such as text
  cursor and hand) or one of five designed cursors: `arrow-white`, `arrow-black`, `dot`, `ring`,
  `spotlight`. `color` tints `dot`, `ring`, `spotlight` and every style's click ripple. `clickEffect` is `ripple` or `none`.
  `enabled: false` hides the cursor.
- `events.jsonl` holds one input event per line, times in source seconds and positions in source
  pixels of the screen track (the recorder subtracts the capture origin and applies the display
  scale; positions outside the frame mean the pointer is off the captured area):
  `{"t":1.2,"type":"move","x":10,"y":20}`, `click` (+ `button`), `scroll` (+ `dx`, `dy`),
  `shape` (+ `shape`: `arrow`, `text`, `pointer`, `wait`, `crosshair`, `move`, `not-allowed`) and
  `keys` (+ `count`).

## Recorder (`packages/recorder`)

Sources: a monitor, a region, or a window (captured as the region of its bounds), plus optional
webcam and mic.

| Track | Windows | macOS |
|---|---|---|
| Screen | ffmpeg `ddagrab` (`draw_mouse=0`), crop for regions | ffmpeg `avfoundation` screen device, crop for regions |
| Webcam | ffmpeg `dshow` | ffmpeg `avfoundation` |
| Mic | ffmpeg `dshow` | ffmpeg `avfoundation` |
| Input events | `uiohook-napi` | `uiohook-napi` |

- Video tracks are written as fragmented MP4 (H.264, 4:2:0, high quality CRF) so a killed process
  leaves a readable file.
- `events.jsonl`: mouse position (~60 Hz), clicks, scroll, cursor shape changes and key-press
  counts. Key contents are never stored. Cursor shape comes from `GetCursorInfo` on Windows; on
  macOS it is best effort and falls back to `arrow`.
- `take.json`: per-track start times on one monotonic clock, used for sync.
- Stop triggers, combinable: hotkey, max duration, `--until-file <path>`, `--until-idle <s>`
  (screen unchanged for N seconds), `--until-claude [<cwd>]` (latest Claude Code transcript for that
  folder shows an assistant message with `stop_reason: end_turn` after the recording started; then a
  short tail).
- Markers: a hotkey adds manual markers. In Claude mode, markers come from the transcript: prompt
  submitted, each tool call, final answer.
- Countdown (default 3 s) before capture starts.
- The cursor is not baked into the video, so its style can change after recording; the engine
  draws it from `events.jsonl`. `--draw-mouse` bakes the real cursor in instead (then set
  `look.cursor.enabled` to `false`, or the video shows two cursors).

## Timeline and engine

`timeline` (pure, unit-tested):

- Maps output time to scene and source time, honoring `speed`.
- Zoom state: rect interpolated from full frame to target and back with an ease-in-out curve
  (default 0.6 s in, 0.6 s out). Overlapping zooms fold in `at` order, each easing from the rect
  already on screen, so the one with the later `at` wins without jumping to the full frame. Zoom
  targets are fitted to the screen's aspect ratio and kept inside the screen.
- A clip that is still visible after its end (outgoing side of a crossfade) holds its last output
  frame, which lies inside `[from, to)`, so masks stay on.
- Active masks and texts for the current source time.
- Badge text for scenes with `speed > 1`.
- Cursor at the source time: position interpolated between logged samples, the latest shape, and
  click effects that run for 0.4 output seconds. Smoothing is phase 3.

`engine` (WebGL2) draws, back to front:

1. Background: preset shader, gradient, solid color or image; the procedural presets drift slowly.
2. Window frame: title bar with title, traffic lights, rounded corners and soft shadow (SDF based).
3. Screen video, cropped by the zoom rect, with masks drawn as fill (sampled background color) or
   blur.
4. Cursor in the chosen style, scaled with the zoom, with its click effect.
5. Webcam bubble: circle mask, border, shadow.
6. Texts and the speed badge.
7. Crossfade between scenes.

Preset set for v1: backgrounds `sunset-sky`, `aurora`, `mesh`, `solid`, `image`; frames `mac-dark`,
`mac-light`, `browser-light`, `none`; text styles `pill`, `lower-third`, `caption`; cursors
`system` (lookalikes of the standard Windows and macOS pointers per shape, drawn for Cuttle as
SVG rather than copied from the OS), `arrow-white`,
`arrow-black`, `dot`, `ring`, `spotlight` (a soft light circle that slightly dims the rest). Presets are data
plus a shader, so new ones are added without touching the engine core.

Look rules (fixed in M2):

- Chrome sizes are in units: 1 unit is 1 px when the output's short side is 1080 px, so every
  format scales the same way.
- `look.frame.enabled: false` shows the screen alone, filling the output (letterboxed) with square
  corners and no shadow. `style: "none"` keeps the padding, the rounded corners and the shadow,
  without a title bar. Still scenes use their own `frame` style with `look.frame.radius` and
  `shadow`, and no title; `look.frame.enabled` does not apply to them, and their window has the
  screen's aspect, not the image's. Transparent parts of a still show white, like a blank page.
- Only `system` follows the pointer shape; its art is Windows-like for now (macOS lookalikes come in
  phase 3), and the designed cursors keep their look. The cursor is 32 source px tall on a
  1080-row screen (proportionally bigger on taller screens), times `size`, scaled with the zoom
  like the screen, clipped to the window's rounded corners, and hidden while off the captured area.
- `fill` masks use the median colour around the mask; `blur` masks blur so strongly that text
  cannot be read, and more strongly the larger the mask. Both cover every source pixel they touch
  plus at least one extra output pixel on every side, more under strong zoom, so no hairline of
  the hidden content shows. `fill` is the safer choice for tokens and keys.
- Texts: `position` picks top, centre or bottom of the output; `lower-third` is left-aligned, the
  other styles centred. The speed badge sits in the screen's top-right corner. Texts and the
  badge never cover the webcam bubble: a top or bottom text that would moves vertically clear of
  it, and the badge moves to its left. The webcam bubble is not mirrored.
- Procedural backgrounds drift slowly with output time.

## Export (`packages/export`)

- Runs in a hidden Electron window (CLI and app).
- Demux with mp4box.js, decode with WebCodecs `VideoDecoder`, render each output frame with the
  engine, encode with `VideoEncoder` (H.264 High, hardware when available), mux with mp4-muxer.
- Audio: ffmpeg cuts the mic track to the scene list, mutes sped-up scenes (`muteSpedUp`), and muxes
  it into the final file. AAC 48 kHz.
- Output presets: 16:9 1920×1080 (default), 1:1 1080×1080, 9:16 1080×1920. The window frame and
  content scale to fit; masks and zooms keep their source coordinates.
- Target: 1080p30 export in at most 2× the video's duration on the user's PC.

## CLI (`apps/cli`)

| Command | Purpose |
|---|---|
| `cuttle init [dir]` | New project folder with a default `cuttle.json` |
| `cuttle devices` | Monitors (index, size, position), windows, cameras, mics |
| `cuttle record [--monitor N \| --region x,y,w,h \| --window "title"] [--webcam] [--mic] [--until-claude [cwd]] [--until-file p] [--until-idle s] [--max s] [--countdown s] [--draw-mouse]` | Record a take into the project |
| `cuttle suggest` | From markers, events and the Claude transcript, propose scenes (trim idle start/end, speed up waiting, zoom on key moments) and write them to `cuttle.json` |
| `cuttle preview [--at t…] [--sheet]` | Stills or a contact sheet PNG with timestamps, for checking |
| `cuttle capture-page <url\|file> [--scroll]` | Headless capture of a page as a still or scroll scene |
| `cuttle render [--format 16:9\|1:1\|9:16] [-o file]` | Export |
| `cuttle recover <take>` | Repair a take after a crash |

Every command supports `--json` for machine-readable output. Exit codes: 0 ok, 1 usage or
validation error, 2 device or permission error, 3 render error.

## Skill (`skill/` → `~/.claude/skills/cuttle/`)

`SKILL.md` triggers on requests to record, demo, screencast or edit a screen recording. Workflow:

1. Agree the scenario and the output format with the user.
2. `cuttle devices`, pick the monitor; check font size and fullscreen with a `preview` still.
3. Start `cuttle record` before the user acts; prefer `--until-claude` for agent demos.
4. `cuttle suggest`, then `cuttle preview --sheet` and look at it.
5. Scan stills for private data (names, emails, tokens, file paths with user names, hook errors) and
   add masks.
6. `cuttle render`, check a sheet of the result, send the file.

It also records the lessons from the treg demo:

- Claude must not start Claude Code itself or change Claude's config to trust a folder; ask the user
  to start it and to accept the trust dialog.
- Start the recording before asking the user to act; never rely on "done" messages for timing.
- PowerShell treats `a,b` as an array: quote comma-separated flag values.
- Global user hooks and plugins leak into demo sessions; suggest
  `--setting-sources "project,local" --strict-mcp-config` when the user starts Claude Code.
- X accepts H.264 MP4 up to 1920×1200; keep demos under 60 s.

## Desktop app (phase 2 guidelines)

- Idle: a small floating pill or tray icon with "New recording".
- Source picker: overlay across all monitors; hover highlights a monitor or window, drag selects a
  region with the outside dimmed, live size label, 16:9 snapping. Chips for webcam, mic, cursor and
  clicks next to the selection, with a live webcam bubble preview.
- Recording: everything disappears except a minimal control bar (timer, pause, marker, stop). The
  bar is excluded from capture (Windows `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`, macOS
  `NSWindow.sharingType = .none`). 3-2-1 countdown overlay.
- Editor after stop: large preview in the center, timeline at the bottom with tracks for scenes,
  speed, zooms, masks and texts (drag handles), and a right-hand inspector that only shows the
  selected item's settings. Looks as visual swatches, including the six cursor styles shown live
  on the preview. Export dialog with format presets.
- Design language: dark, quiet, glass surfaces, spring motion, keyboard shortcuts; strong defaults
  so most takes need no settings.
- Opens projects that Claude produced.

## Errors

- Missing ffmpeg, a missing device, or a missing macOS screen-recording permission: a message that
  names the cause and the fix.
- Invalid `cuttle.json`: Zod error with the JSON path.
- A crash during recording leaves readable fragmented MP4s; `cuttle recover` rebuilds `take.json`.
- Export failure keeps partial output out of the target path (write to a temp file, rename at the
  end).

## Testing

- `project`, `timeline`: vitest unit tests (time mapping, easing, overlaps, migrations).
- `engine`: golden-image tests: known states rendered in headless Chromium (vitest browser mode,
  SwiftShader) and compared with committed PNGs, one set per platform; `pnpm engine:electron`
  renders the same states in a hidden Electron window and compares them with the same PNGs.
- `export`: end-to-end render of a short ffmpeg `testsrc` fixture; check duration, frame count and
  audio with ffprobe.
- `recorder`: a test backend that uses ffmpeg `testsrc`/`sine` instead of real devices; trigger
  tests for `--until-file`, `--until-idle` and `--until-claude` with a fake transcript.
- `cli`: snapshot tests of `--json` output.
- CI on GitHub Actions for Windows and macOS (build, unit and golden tests). Real capture on macOS
  needs one manual test by the user.

## Open points for later phases

- Phase 2 spec: app windows, state machine, IPC, design system.
- Phase 3 spec: cursor smoothing model and auto-zoom clustering.
- Optional later: share links via a Cloudflare Worker and R2.

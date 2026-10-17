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
  pixels of the screen track (the recorder subtracts the capture origin and, where the system
  reports points instead of pixels, applies the display scale; positions outside the frame mean the
  pointer is off the captured area):
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

- Phase 1 records on Windows; macOS follows (until then `record()` says `unsupported-platform`). A
  `test` backend (ffmpeg test sources, synthetic input) runs everywhere and carries the tests.
- Video tracks are written as fragmented MP4 (H.264, 4:2:0, high quality CRF, BT.709 matrix and
  tags, a key frame every 2 s, every packet flushed) so a killed process leaves a readable file up
  to its last 2 s; the mic (AAC) is cut into 1 s fragments.
- `events.jsonl`: mouse position (~60 Hz), clicks, scroll, cursor shape changes and key-press
  counts per half second. Key contents and the timing of single presses are never stored. Cursor
  shape comes from `GetCursorInfo` on Windows; on macOS it is best effort and falls back to `arrow`.
- `take.json`: per-track start times on one clock, used for sync: `{ "version": 1,
  "tracks": { "screen": { "file": "screen.mp4", "start": 1000.0 }, "webcam": { … }, "mic": { … } } }`,
  `start` = when the track's first frame or sample was captured (schema in `@cuttle/project`). The
  recorder uses the wall clock (Unix seconds, from ffmpeg's packet stamps).
- Stop triggers, combinable: hotkey (Ctrl+Shift+Alt+S), max duration, `--until-file <path>` (must
  not exist yet), `--until-idle <s>` (screen unchanged and no input for N seconds, after the screen
  changed), `--until-claude [<cwd>]` (the first Claude Code session in that folder that submits a
  prompt after `cuttle record` was started, countdown included, shows an assistant message with
  `stop_reason: end_turn`; then a 2 s tail; other sessions and subagents are ignored).
- Markers: a hotkey (Ctrl+Shift+Alt+M) adds manual markers. In Claude mode, markers come from the
  transcript: prompt submitted, each tool call (with the tool's name), final answer. `markers.json`:
  `{ "version": 1, "markers": [{ "t": 1.27, "kind": "tool", "label": "Bash" }] }`, `t` in source
  seconds, `kind` one of `manual`, `prompt`, `tool`, `answer` (schema in `@cuttle/project`).
- A microphone that delivers digital silence (muted, or blocked for desktop apps) is reported as a
  warning one second into the take.
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
- A clip that is still visible after its end (outgoing side of a crossfade) holds the last output
  frame shown before its end, which lies inside `[from, to)`, so masks stay on and the clip's
  source time never goes back.
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
  other styles centred. The speed badge sits in the screen's top-right corner. When the project
  has a webcam, top and bottom texts and the badge keep clear of its bubble: the badge moves to
  the bubble's left (below it if there is no room), and a top or bottom text moves vertically past
  the bubble and the badge. Centre texts stay put and can cover a very large bubble; texts are
  placed independently of each other. The webcam bubble is not mirrored.
- Procedural backgrounds drift slowly with output time.

## Export (`packages/export`)

- Runs in a hidden, sandboxed Electron window (CLI and app). The main process serves the project's
  files to it over IPC by byte range, so recordings never sit in memory.
- Demux, decode and mux with Mediabunny: decode with WebCodecs `VideoDecoder` (in software, one
  decoder per scene and track when it can, any decoder otherwise, started a second before the scene
  shows), render each output frame
  with the engine, encode with `VideoEncoder` (H.264 High at the smallest fitting level, about
  10 Mbit/s at 1080p30, a key frame every 2 s; hardware when available, software otherwise).
- Webcam and mic are lined up with the screen by the start times in `take.json`.
- Audio: ffmpeg cuts the mic track to the scene list, mutes sped-up scenes (`muteSpedUp`; otherwise
  `atempo`), fades out and in at cuts over half the crossfade (at least 10 ms, always inside the
  clip's own sound), and muxes it into the final file. AAC 48 kHz stereo; a silent track when there
  is no mic or audio is off.
- Output presets: 16:9 1920×1080 (default), 1:1 1080×1080, 9:16 1080×1920. The window frame and
  content scale to fit; masks and zooms keep their source coordinates.
- Target: 1080p30 export in at most 2× the video's duration on the user's PC.
- The output path may not be one of the project's files. An export can be cancelled (the CLI maps
  Ctrl+C to it); one that renders no frame for 60 s fails as stalled. Either way nothing is left at
  the output path or in the temp folder.

## CLI (`apps/cli`)

| Command | Purpose |
|---|---|
| `cuttle init [dir]` | New project folder with a default `cuttle.json` |
| `cuttle devices` | Monitors (index, size, position), windows, cameras, mics |
| `cuttle record [--monitor N] [--region x,y,w,h] [--window "title"] [--webcam [name]] [--mic [name]] [--until-claude [cwd]] [--until-file p] [--until-idle s] [--max s] [--countdown s] [--draw-mouse]` | Record a take into the project (created when missing) and use it: `sources` point at the take, one clip scene covers it; scenes and overlays of the previous take are dropped. `--draw-mouse` also sets `look.cursor.enabled` to `false` (the pointer is in the video). After a stop by `--until-file` the file is removed, so the next take can use it |
| `cuttle suggest [--claude [cwd]] [--no-zoom] [--dry-run]` | From markers, events and the screen, propose scenes (trim the quiet start and end, cut idle stretches, speed up waiting) and a zoom on Claude's answer, and write them to `cuttle.json`: clip scenes and zooms are replaced, still and card scenes keep their place before or after the clips, masks and texts stay; `--claude` reads the transcript for a take without Claude markers |
| `cuttle preview [--at t…] [--sheet] [--format f] [-o dir]` | PNG stills of the output; without `--at` 12 evenly spaced stills and a contact sheet with timestamps, for checking. The JSON names the source second each still shows. A run that fails or is cancelled writes nothing; in the default folder (`preview/`) stills of earlier runs are replaced |
| `cuttle frame <seconds> [--grid] [-o file]` | A frame of the screen track at a source second, at full size (the pixels masks and zooms use); `--grid` draws a line every 100 px with its pixel number, to read rects from |
| `cuttle capture-page <url\|file> [--scroll] [--add] [--duration s] [--wait ms] [--width px] [--height px] [--name n]` | Capture a page (offscreen Chromium, scale 1, a session without stored cookies, permissions or downloads) into `stills/`; `--scroll` takes the whole page with the viewport's height kept (sections sized in `vh` stay their size); `--add` appends a still scene (browser frame, scrolling with `--scroll`) |
| `cuttle render [--format 16:9\|1:1\|9:16] [-o file] [--encoder auto\|hardware\|software]` | Export (default `out/<format>.mp4` in the project, `out/export.mp4` without `--format`) |
| `cuttle recover <take>` | Repair a take after a crash and use it (`<take>` relative to the project, e.g. `takes/2`): checks the tracks, drops a cut-off events line, rewrites a missing or broken markers.json or take.json (keeping readable start times). When the project already uses the take, its scenes and overlays stay (a clip is added only when it has no scenes) |

Every command takes `-C <dir>` (the project folder, default the current one) and `--json`: exactly
one JSON document on stdout (the result, or `{ "error": { "code", "message" } }`, usage errors
included), everything else on stderr. Exit codes: 0 ok, 1 usage or validation error, 2 device or
permission error, 3 render error, 130 cancelled (`--help` and `--version` answer as JSON too).
Ctrl+C stops a recording (the take is kept) and cancels a render or preview (nothing is written)
or a page capture (no scene is added); a second Ctrl+C quits at once. `render`,
`preview` and `capture-page` run in Electron, started by the Node CLI; the answer and a cancel
travel over Node's IPC channel (on Windows Electron has no console, so the console's Ctrl+C would
not reach it). Before a command replaces scenes or overlays in `cuttle.json` (`record`, `suggest`,
`recover`), or `recover` rewrites a take's events.jsonl, markers.json or take.json, it keeps the
old file as `<file>.bak`, moving older backups to `.bak.1` … `.bak.4`.

`suggest` works in seconds of the take. Activity is input (±0.3 s per event), a changing screen and
Claude's turn (from its first prompt or tool call to the answer; never cut, because the screen
often shows only a spinner). It keeps 0.5 s before the first activity (2 s before a prompt) and
1 s after the last (2.5 s after the answer), cuts stretches without activity of 3 s or more down to
0.5 s on each side, and speeds up stretches without input of 8 s or more (1 s at 1× on each side,
the answer at 1×, so waiting before and after it is sped up separately) to about a twelfth of
their length, 3–10 s of video, at 2, 3, 4, 6, 8, 12, 16, 24, 32, 48 or 64×. The zoom frames what
changed on screen around the answer; when that is most of the screen once fitted to its aspect,
there is none and a note says so.

## Skill (`skill/` → `~/.claude/skills/cuttle/`)

`SKILL.md` (frontmatter `name: cuttle` and a description of when to use it: requests to record a
demo, a screencast or screen recording, a launch or product video, or to edit a cuttle project)
and `project.md` (the `cuttle.json` reference it links) are copied into Claude Code's personal
skills by `pnpm skill:install`, with the repository's path filled in. It also works as `/cuttle`.
Workflow:

1. `cuttle --version` (when it is missing, ask the user for `pnpm cli:install`). Agree the
   scenario, the screen, the output format and a project folder with the user; ask for large text
   and a clean screen.
2. `cuttle devices`, pick the monitor or window.
3. Start `cuttle record` in the background before the user acts, stopped by `--until-claude` for
   agent demos or `--until-file` (Claude creates the file when the user is done), with `--max` as a
   safety net; tell the user to start once it prints `recording takes/<n>`.
4. `cuttle suggest`, then `cuttle preview` and look at the sheet.
5. Scan stills for private data (names, emails, tokens, file paths with user names, hook errors)
   and add masks, reading their rects off `cuttle frame <source second> --grid`; refine zooms, the
   look, cards and captions.
6. `cuttle render` (in the background for long takes) and tell the user the file's path.

It also records the lessons from the treg demo:

- Claude must not start Claude Code itself or change Claude's config to trust a folder; ask the user
  to start it and to accept the trust dialog.
- Start the recording before asking the user to act; never rely on "done" messages for timing.
- PowerShell treats `a,b` as an array: quote comma-separated flag values.
- Global user hooks and plugins leak into demo sessions; suggest
  `--setting-sources "project,local" --strict-mcp-config` when the user starts Claude Code.
- X accepts H.264 MP4 up to 1920×1200; keep demos under 60 s.

## Desktop app (phase 2 guidelines)

Detailed, and in places revised, in `2026-10-17-cuttle-desktop-design.md`.

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
- `export`: unit tests for the pure parts (formats, codec string, frame plan, audio filter graph,
  source loading); `pnpm export:check` renders a 10 s ffmpeg `testsrc` fixture (every scene type,
  speed-up, zoom, masks, texts, webcam, cursor, crossfades, mic) to all three formats in a hidden
  Electron window and checks duration, frame count, size, codecs and audio with ffprobe.
- `recorder`: a test backend that uses ffmpeg `testsrc`/`sine` instead of real devices; trigger
  tests for `--until-file`, `--until-idle` and `--until-claude` with a fake transcript.
- `cli`: snapshot tests of `--json` output.
- CI on GitHub Actions for Windows and macOS (build, unit and golden tests). Real capture on macOS
  needs one manual test by the user.

## Open points for later phases

- Phase 2 spec: `2026-10-17-cuttle-desktop-design.md` (app windows, flows, IPC, design system).
- Phase 3 spec: cursor smoothing model and auto-zoom clustering.
- Optional later: share links via a Cloudflare Worker and R2.

# Cuttle desktop app: design (phase 2)

Date: 2026-10-17. Status: written autonomously (the owner asked for phase 2 to be done on its own and
thought through hard), then torn apart by an independent design review and rewritten (section
"Review"). Every technical claim was tried in a spike first (section "Evidence"). Phase 1
(`2026-10-16-cuttle-design.md`) fixed the architecture; this document details the app and the
changes it needs in the shared packages.

The app is how a person uses Cuttle: press a key, pick what to record, record, and get a video that
is already cut, then polish it in an editor that shows exactly what the export will be. It reads and
writes the same `cuttle.json` as the CLI and Claude, renders with the same engine, and cuts with the
same `suggest` rules.

## Scope

In:

- A launcher (a small pill and a tray icon), a global hotkey for a new recording, recent projects.
- A picker over every display: a screen, a window or a dragged region; camera and microphone with
  live previews; a stop condition; a countdown.
- A recording HUD that never appears in the video, in the input events or in the window's focus:
  timer, pause, marker, restart, stop.
- A real pause (nothing is captured while paused) and a safe restart.
- After stop: the editor opens at once on the take while `suggest` cuts it.
- The editor: a preview that plays and scrubs the output; a source view to draw and adjust zooms and
  masks; a timeline (scenes, zooms, masks, captions, Claude's markers, input activity, the mic's
  waveform); an inspector for the selection and a permanent Look tab; undo and redo; saving that
  never loses Claude's work or the user's.
- An export sheet: one or more formats, progress, cancel, reveal the file.
- Settings and a first run: the projects folder, the countdown, default devices, ffmpeg, installing
  the CLI and the skill.
- An unpacked app build (no installer).

Out (phase 3 or later): auto-zoom on clicks, cursor smoothing, several takes in one edit, macOS
recording, an installer, code signing and auto-update (the phase-1 spec rules them out for v1), a
light theme, music and voice-over.

## Principles

1. **The video is the hero.** The preview is the largest thing on screen; everything else is quiet,
   dark and low in contrast until it is needed.
2. **Done before you start.** Every take opens already cut (`suggest`): trimmed, waiting sped up, a
   zoom on Claude's answer. Polishing is optional.
3. **What you see is the export.** The output view is the export's engine on the export's timeline
   (tested pixel for pixel); the source view is clearly a different, editing view.
4. **Contextual, not hidden.** The inspector shows the selection; the look is always one click away
   in its own tab. Controls appear where the work is (handles on the source view, edges on the
   timeline).
5. **Direct.** Zooms and masks are drawn on the source frame; clips are trimmed by their edges; the
   playhead is dragged. Every number can also be typed; edits clamp to valid values instead of being
   refused.
6. **Keyboard first.** Every action has a key, shown in its tooltip; Ctrl+K finds any command; `?`
   lists the keys.
7. **Private by default.** A pause records nothing; the pill, picker and HUD are never in the video
   or its input events; the app reads only files inside the project; nothing leaves the machine.
8. **Nothing is lost.** No one-click action destroys a take or an edit: restart and "record again"
   keep what they replace, saving never overwrites changes it has not seen, and Claude's edits can be
   undone like the user's.
9. **Calm motion.** 120–320 ms, ease-out or a spring with little overshoot; nothing bounces; the
   OS's reduced-motion setting turns animation off.
10. **One project format.** The app edits `cuttle.json` as written (order, defaults and 2-space
    formatting kept, as the CLI does), so a person and Claude can take turns on the same project.

## Changes to the shared packages (milestone P2-M0, before the app)

The review found problems in phase 1 that every editor would hit. They are fixed first, for the CLI
and Claude too.

- **Continuous cuts.** Today every boundary between two scenes crossfades: the outgoing clip holds
  its last frame, the incoming one is frozen on its first, and the export's audio fades out and back
  in. `suggest` already produces boundaries in the middle of continuous footage (1× → 12× → 1×), and
  an editor's split makes more. A boundary between two clips where the first ends where the second
  begins (`a.to` within 1 ms of `b.from`) becomes a continuous cut: no crossfade, no held frame, no
  audio fade. Other boundaries keep the crossfade.
- **Overlay ramps in output time.** A zoom's 0.6 s ramps and a text's 0.25 s fades are output
  seconds, but today they are converted with the speed of the clip on screen, so a zoom across a
  1× | 4× boundary jumps from full to half in one frame. The timeline computes, per zoom and text,
  where it shows in output time (its occurrences: runs of clips that show its source range,
  continuous cuts joined), and ramps within each occurrence in output seconds. A ramp-in happens only
  where the occurrence contains the overlay's start (a cut into the middle of a zoom lands zoomed),
  a ramp-out only where it contains its end.
- **Identity and names.** Scenes, zooms, masks and texts gain optional `id` (a short string, unique
  in the project) and `label` (a name for people: "Answer", "Claude at work", "Hook error"). The CLI
  and the skill keep them; `suggest` sets them on what it makes (clip labels from Claude's markers).
  The app adds ids to items without one on its first save. Selection, undo, conflict replay and "Show
  hidden" all work by id.
- **`@cuttle/core`.** The CLI's project operations move into a package both use: the project file as
  written (read, write, backups), pointing a project at a take, `suggest`, `recover`, `frame`, ffmpeg.
- **Writes that see each other.** Reading cuttle.json records its content hash; writing refuses
  (`CoreError('conflict')`, CLI exit 1, "cuttle.json changed while … ran; run it again") when the file
  on disk no longer has that hash. `suggest`, which decodes the whole take between its read and its
  write, can then never overwrite what the app saved meanwhile. The serialization stays 2-space JSON.

## The flow

```
idle (pill, tray) ──Ctrl+Shift+Alt+R──► picker ──Enter──► countdown ──► recording (HUD)
      ▲                                    │Esc                              │ stop · stop file ·
      │                                    ▼                                 │ Claude's answer · max
      └──────────── editor (take shown at once; "Cutting…" while suggest runs) ◄┘
                     │ Export (Ctrl+E) ──► export sheet ──► out/<format>.mp4
```

- **Idle.** The app lives in the tray. A pill (48 px tall, near the top of the primary display,
  draggable, content-protected so it is never in a recording, hidden with Esc and brought back from
  the tray or the hotkey) offers "New recording", "Open" and the recent projects. The app starts at
  login only if the user turns it on.
- **Pick.** Overlays (created hidden at start, shown in under 150 ms) cover every display. Hovering
  lights the window under the pointer; hovering empty desktop lights the display; dragging draws a
  region. A bar under the target sets the mode, camera, microphone and stop condition, and starts the
  recording (Enter).
- **Count down.** A translucent ring with 3-2-1 over the target (the target stays visible; Esc
  cancels); the recorder's own countdown drives it. When it ends, the picked window gets the focus
  back (`SetForegroundWindow`).
- **Record.** Only the HUD remains. The recorder's hotkeys (Ctrl+Shift+Alt+S stop, +M marker) keep
  working.
- **Edit.** The editor opens at once on the take (one clip over all of it) with "Cutting the take…"
  in the timeline bar while `suggest` runs in the background; its cut arrives as one undoable step
  ("Cut by suggest"); "Show raw take" is a command, not a position in the undo history. Closing the
  editor returns to the pill.

## Windows

| Window | Kind | Notes |
|---|---|---|
| Pill | frameless, transparent, always on top, skip taskbar, content-protected | 380×60 DIP; remembers its position per display; its transparent margin passes clicks through |
| Tray | tray icon with a menu | New recording, recent projects, open, settings, quit |
| Picker | one per display, created hidden at start: frameless, transparent, fullscreen on that display, always on top (screen-saver level), focusable | never in the video; keys work on every display's overlay |
| Countdown | frameless, transparent, over the target, content-protected, click-through, not focusable | |
| HUD | frameless, always on top, content-protected, `focusable: false`, shown with `showInactive` | 360×60 DIP; never takes the focus |
| Editor | frameless with Windows' own caption buttons (`titleBarOverlay`), min 1100×700 | one per project (a lock file); hidden, with its player suspended, while its project records again |
| Export sheet, command menu | inside the editor | |
| Settings | a small window from the tray or the editor | |

## The picker in detail

- **Hit testing.** The main process asks the recorder for the window list (z-order, physical desktop
  bounds, window id, process id, window class) and sends each overlay the windows on its display,
  converted to DIP with `screen.screenToDipRect`. The overlay hit-tests locally on every pointer move
  (no IPC per move): the first window in z-order containing the point. Left out: the app's own windows
  (by process id), the desktop and taskbars (classes `Progman`, `WorkerW`, `Shell_TrayWnd`,
  `Shell_SecondaryTrayWnd`, which pass the recorder's other filters), and the recorder's existing
  exclusions (minimized, cloaked, tool windows).
- **Modes.** Automatic by default (window under the pointer, else the display; a drag makes a region).
  Tabs force Screen, Window or Region; Tab cycles stacked windows under the pointer.
- **A window is a fixed area.** The label says so ("Window · claude · ~/demo · 1780 × 1200 · records
  this area"); what moves over it is recorded; the HUD warns if the window moves during the take.
- **Region.** Drag to draw; eight handles adjust it; arrows nudge by 1 px (Shift: 10 px); Shift while
  dragging keeps 16:9. The label shows physical pixels, which is what the take will be. A region stays
  on its display.
- **The bar.** Mode tabs; Camera (toggle, device menu, a live bubble at the look's corner); Mic
  (toggle, device menu, a live level meter); Stop on (nothing; Claude's answer, with a folder chooser
  that defaults to the most recently active Claude Code project; an idle screen); Record (Enter).
  Device names come from the recorder (DirectShow names, often cut to 31 characters); the previews use
  `getUserMedia` with the device whose label matches by normalised prefix (a leading "Default - "
  dropped). Previews are stopped before the recording starts, and the recorder retries a camera that
  is still busy for up to 2 s. Device names never wrap: one line, ellipsis, the full name in a tooltip.
- **Keyboard.** Esc cancels, Enter records, Tab cycles windows, S/W/R switch modes, on whichever
  display the pointer is.
- **Checks before recording.** ffmpeg present; the device there; free disk space for at least 10
  minutes at the expected bitrate (a warning, and again in the HUD below 2 GB).

## Recording in the app

- **The recorder host.** `record()` runs in a utility process (koffi and uiohook-napi work there,
  spike). If it dies, the main process kills the ffmpeg processes it started (their process ids are
  reported), so no capture outlives it.
- **HUD placement.** Top centre of the work area (the taskbar excluded) of the recorded display, or on
  another display when there is one; outside the target when it fits; draggable. Its transparent
  margin passes clicks through.
- **Dead zones.** The recorder takes rectangles whose input is not logged (the HUD's, updated when it
  is dragged) and logs nothing after a stop was requested, so no take shows the pointer travelling to
  the HUD, a click ripple on Stop, or `suggest` keeping a second for that click.
- **Pause** (milestone P2-M4). `Recording.pause()` stops every track's ffmpeg (each file is a complete
  fragmented MP4) and the input logging; `resume()` starts new segment files and shows "Resuming…"
  in the HUD until every track runs (a camera can take 1–2 s). A `segments.json` next to the tracks is
  written atomically at every pause and resume with each segment's per-track first-packet stamps. One
  pure function maps wall-clock time to take time (`takeTime`) from that manifest; events, manual
  markers, Claude's markers (live and from the transcript later), the triggers and `recover` all use
  it. Stopping on Claude's answer or an idle screen waits until after a resume. On stop the segments
  are joined: video by the concat demuxer with stream copy (spike: lossless), or re-encoded when a
  segment's format changed (a display mode change); mic and webcam by a filter that trims and delays
  each segment to its screen segment (joined AAC alone drifts ~23 ms per pause). `recover` joins from
  the manifest too. Nothing is captured while paused. A test plays a beep and a flash at known times
  with the `test` backend, pauses twice, and checks the joined take's A/V offset is under one frame.
- **Restart.** Stops the take, moves its folder to `takes/.discarded/<n>`, counts down again with the
  same settings, and offers "Undo restart" in the editor afterwards; the restart button is a
  press-and-hold (600 ms, with a ring) so a stray click does not discard a take.
- **Record again** (from the editor): a new take goes to `takes/<n+1>`; the previous take and its
  edit stay restorable ("Back to take <n>").
- **Windows by id.** `WindowInfo` gains `id` (the handle as a number), `pid` and `className`; a window
  source can be given by id. The CLI keeps titles.
- **After stop.** The editor opens on the take; `suggest` runs in a worker utility process (it decodes
  the whole take: minutes for a 30-minute take) and can be cancelled; a take that ended badly is
  repaired with `recover` first, and the editor says so.

## The editor in detail

```
┌ title bar: mark · project name · status ············ 16:9 1:1 9:16 · undo redo · Export · ─ ▢ ✕ ┐
│ tools │                                                         │ [Selection] [Look]            │
│  V    │        stage: the output view, or the source view       │  the selection's fields,      │
│  Z    │        while a zoom or mask is drawn or selected        │  or the look                  │
│  M    │        transport: play · output time · source second    │                               │
│  T    ├─────────────────────────────────────────────────────────┤                               │
│       │ bar: split · speed · + zoom · + mask · + caption · + card · + page · snap · fit · scale    │
│       │ markers row: Prompt · tool calls (clustered) · Answer · manual markers                    │
│       │ ruler                                                                                      │
│       │ Video    [1× ][12× Claude at work ···············][Answer][Page ······][End card]        │
│       │ Zoom                                              [Answer]                                 │
│       │ Mask     [Hook error ·][········][·········]   (one block per clip that shows it)          │
│       │ Caption  [One prompt]                                                                      │
│       │ Mic      ▁▂▅▃▁▁▁▁▁▁▁▁▁▁▁▁▃▅▂▁ (waveform)                                                    │
│       │ Input    ▁▃▇▅▁▁▁▁▁▁▁▁▁▁▁▁▁▁▃▆▃▁ (activity)                                                 │
│       │ minimap (long takes)                                                                       │
└───────┴─────────────────────────────────────────────────────────┴───────────────────────────────┘
```

### Output view and player

- The engine's renderer draws the timeline's `RenderState` into a canvas at the output's aspect, at
  the output size scaled to the canvas; at half resolution while scrubbing, full once the playhead
  rests for 150 ms. A pixel-parity test compares output-view frames with `renderStills` of the same
  project.
- **Media.** Mediabunny reads the take through the `cuttle-media` protocol (Range requests; spike:
  seeks of 21–64 ms on the 2560×1440 treg take).
- **A proxy.** After a take (or on first open), a worker makes a 720p proxy with a key frame every
  0.5 s (ffmpeg, in the background, with progress). The preview plays from the proxy when it exists,
  else from the take. Up to 6× it decodes sequentially from the playhead; above 6× (most of
  `suggest`'s output is 12×) it shows key frames only, which at 0.5 s spacing is every frame a 30 fps
  output needs up to 15× and a smooth enough sample above. The export always uses the take.
- **Scrubbing** asks for the frame at each layer's source time and drops requests that are no longer
  the latest. The frame queue is capped (a few frames per layer) and frames are closed as soon as they
  are drawn.
- **Audio is the clock.** The mic is decoded in chunks of a few seconds around the playhead (a 30-
  minute mic would be 345–690 MB of PCM decoded at once) and scheduled through WebAudio; video follows
  the audio clock and drops frames rather than drifting. Sped-up clips are silent when
  `look.audio.muteSpedUp`; otherwise they play at their speed with the pitch kept by `preservesPitch`
  where available (the export uses `atempo`; the difference is noted in the export sheet's check).
- **Webcam, stills, background, cursor** as in the export.
- **Transport.** Space plays and pauses; J/K/L shuttle; ←/→ step a frame (Shift: a second); Home/End;
  the time shows the output second and the source second on screen.

### Source view (drawing and selecting zooms and masks)

- While the Zoom or Mask tool is active, or a zoom or mask is selected, the stage shows the source
  frame at the playhead filling the stage (not the composed output), with the selected item's box,
  the area outside a zoom dimmed, and every other mask outlined. A chip at the top says "Source view ·
  Esc for the video". In 9:16 this is the only way to draw precisely; in every format it removes the
  zoom's own effect while placing it.
- A zoom box keeps the screen's aspect while it is drawn or resized (what you draw is what the zoom
  shows); a mask box is free. Both clamp to the screen.
- Drawing creates the item at the playhead's source second: a zoom of 3 output seconds (so it rests at
  full zoom for 1.8 s), a mask until the end of the clip; both clamped to the clip.
- The mapping between the stage and source pixels is a pure function (with tests).

### Tools

- **V Select** (the output view): click a caption to select it; zooms and masks are selected on the
  timeline or with Z/M active.
- **Z Zoom, M Mask**: the source view; drag to create, drag a box to move, handles to resize.
- **T Caption**: click to add a caption at the playhead (3 output seconds), typed in place.
- Tools are disabled on stills, cards and inside crossfades, with the reason in the tooltip; "+ zoom",
  "+ mask" and "+ caption" on the timeline bar do the same as the tools.

### Timeline

- **Rows.** A markers row (Prompt, tool calls clustered when they crowd, Answer, manual markers; each at
  the output second where a clip shows it; markers in cut-out stretches not drawn), the ruler, then the
  lanes: Video, Zoom, Mask, Caption, Mic (waveform), Input (activity); a minimap for takes longer than
  the visible range. Zoom-to-fit (Shift+Z) shows the whole video.
- **Video lane.** Scenes as wide as their output duration, with thumbnails (made by the worker with
  ffmpeg from key frames, cached in `.cuttle/` inside the project), the label (`Claude at work · 12× ·
  145 s → 12 s`), stills and cards in their own colours.
- **Overlay lanes.** Overlays live in source seconds and are drawn in output time, one block per clip
  that shows their range (a mask over three clips is three blocks, linked: hovering one highlights the
  others). An overlay no clip shows is "cut out" and counted in the lane label ("Mask · 1 cut out"), a
  click lists them. "Off" is the separate `enabled: false` (drawn hatched).
- **Edits** (one gesture = one undo step; all ripple: later scenes move):
  - select a scene; drag its edges to trim (source seconds, snapped to frames; a clip's end is clamped
    to the take's length);
  - S splits the clip at the playhead (a continuous cut);
  - Delete removes the selection;
  - drag a scene to move it;
  - R or the inspector sets a clip's speed; zooms and captions that lie entirely inside that clip are
    rescaled so their output length stays the same (a 3 s caption stays 3 s at 12×);
  - drag an overlay block to move it (its source seconds move by the drag at that clip's speed), its
    edges to change its duration;
  - Alt-drag duplicates; Ctrl while dragging bypasses snapping.
- **Snapping** (on by default): the playhead, scene edges, markers, other overlays' edges, frames.
- Blocks have a minimum hit width of 6 px at any scale.

### Inspector

Two tabs: **Selection** (the selected item; empty with a hint when nothing is selected) and **Look**
(always available). Every time is shown as the output second of the occurrence under the playhead,
with the source second beside it in grey; inside a cut it shows only the source second.

| Selection | Fields |
|---|---|
| Clip | label, speed (chips and a number), badge text, from and to |
| Still | image (replace: copied into the project), duration, motion (none, Ken Burns, scroll), frame style |
| Card | title, subtitle, duration |
| Zoom | label, start, length, area (x, y, w, h, editable), easing (smooth, linear), off |
| Mask | label, from, to, area, style (fill, blur), off |
| Caption | text, start, length, style (pill, lower third, caption), position (top, centre, bottom), off |

Look: background (swatches of the presets, a colour well for solid, an image picker that copies the
image into the project), frame (style swatches, title, radius, shadow), cursor (six swatches drawn by
the engine, size, colour, click effect), webcam (shape, corner, size), audio (on, mute sped-up),
transition (on, length), and the output size (also the title bar's 16:9 / 1:1 / 9:16).

### The document, saving and Claude

- The open project is a document: the JSON as written and its parsed form. Edits are commands
  (operations on items by id) applied by pure functions; a result is clamped to valid values and then
  validated with `parseProject`. Undo and redo keep whole snapshots (projects are small).
- **Saving** happens when a gesture ends (and at most every 2 s while typing), through `@cuttle/core`'s
  hash-checked write. The app remembers the hash of what it wrote and ignores the watcher's event for
  it.
- **Outside changes** (Claude, the CLI): the watcher reloads the file; if the app had nothing unsaved,
  the new version replaces the document and a toast names the change ("Claude added 2 masks · Show ·
  Undo"); Undo writes the previous version back as a new change. Redo history is cleared. If the app
  had an unsaved gesture, it replays that gesture's commands (by id) on the new version and saves; a
  command whose item is gone is dropped with a note. If the file stops parsing, the editor keeps the
  last good document and shows the issues with their paths.
- On open the file as found is backed up once (`.bak` rotation as in the CLI).
- The CLI's `record` refuses a project that is open in the app (the editor's lock file names it).
- **Export** takes a snapshot of the document at the moment it starts; the sheet says which (the time).

## The export sheet

Formats as checkboxes (the project's output first; 16:9, 1:1, 9:16), the folder (`out/` by default),
the encoder (auto). Before it starts, a check lists anything worth a second look: masks that are off,
overlays that are cut out, captions shorter than 1 output second, sped-up audio that the preview
pitched differently. Export runs `exportProject` in the main process (it opens its own hidden window),
one format after another, with progress (frames, elapsed, remaining), cancel, and at the end "Show in
folder" with the file's size and length.

## Settings and first run

- First run: find ffmpeg (PATH as the OS has it now, read from the registry, plus WinGet's links
  folder, so "Check again" works right after `winget install Gyan.FFmpeg`); offer "Install the cuttle
  command and the Claude skill" (the app's own copy of the CLI, run with the app's Node); then the pill.
- Settings: projects folder (default `~/Cuttle`; new takes go to `<folder>/<date time>`; renaming a
  project renames its folder from the recent list), countdown (0, 3, 5 s), default camera and mic,
  launch at login, reduce motion (follows the OS by default).

## Architecture

```
packages/
  project      + optional id and label on scenes and overlays
  timeline     + continuous cuts; overlay ramps in output time
  export       + no audio fade at continuous cuts
  recorder     + window id, pid, class; dead zones; pause by segments (P2-M4)
  core         NEW: the project file (hash-checked writes, backups), takes, suggest, recover, frame,
               ffmpeg; used by the CLI and the app
apps/
  cli          uses @cuttle/core
  desktop      NEW
    src/main        lifecycle, windows, tray, hotkey, project service, media and app protocols,
                    export, settings, locks
    src/workers     utility processes: the recorder host; a worker for suggest, proxies,
                    thumbnails and waveforms (ffmpeg)
    src/preload     a narrow bridge per window kind (contextBridge, CommonJS)
    src/renderer    React 19: pill, picker, countdown, HUD, editor
    src/shared      the IPC contract (zod), the document's commands, layout maths, hit testing
```

- **Processes.** The main process stays light (windows, files, IPC, media); everything that decodes or
  waits on ffmpeg runs in a worker; the export keeps its own hidden window.
- **IPC.** One contract module lists every channel with zod schemas; IPC handlers are registered per
  `webContents` (as the export does), so a window can only reach its own channels.
- **Files.** The renderer is served from an `app://` protocol (so the CSP's `'self'` means the app).
  `cuttle-media://<id>/<path>` serves files under the window's project folder: the path is decoded,
  resolved and `realpath`ed (junctions), then compared with the folder case-insensitively including the
  separator; ids map to projects per window; Range requests supported. Images from outside the project
  are copied in, never served from where they are.
- **Security.** `sandbox`, `contextIsolation`, no `nodeIntegration`, a strict CSP, navigation and new
  windows denied; camera and mic granted by checking the requesting `webContents` (the picker's), not
  its origin.
- **Build.** Vite: the main process and the workers as SSR bundles, the preloads as CommonJS, the
  renderer as a multi-page React build. `pnpm app` (development), `pnpm app:check` (end to end),
  `pnpm app:build` (an unpacked app: koffi and uiohook-napi unpacked from the asar, ffmpeg found as in
  the first run). The packaged build exists from the first milestone on.
- **Versions** (two weeks or older): react and react-dom 19.3.0, @types/react and @types/react-dom
  19.3.0, @vitejs/plugin-react 6.1.1. No state or UI library: a small store with
  `useSyncExternalStore`, plain CSS with tokens, inline SVG icons.

## Design system

- **Tokens** (`apps/desktop/src/renderer/tokens.css`, drafted in `docs/design/desktop/tokens.css`): a
  dark scale (background #0c0c0f, stage #08080a, panel #131317, raised #1b1b21, floating surfaces
  rgba(19,19,23,0.86)), lines at 6 % and 12 % white, text #ececf1 / #9a9aa5 / #62626c.
- **One accent, used sparingly**: Claude's orange (#d97757) only for the primary action (Export,
  Record), the playhead and the selection outline; not for markers, chips or status.
- **Item colours, one hue each**: zoom blue #5aa2ff, mask violet #a77bff, caption green #4fd1a1,
  still teal #3cc6c9, card amber #f2b34a; speed shown as text (`12×`), not colour; markers neutral
  with a coloured dot (prompt white, tools grey, answer green).
- **Type.** Inter (the engine's font files) 11–20 px, tabular numbers for times, shortcut letters at
  10 px minimum.
- **Icons.** One small inline SVG set, 16 px, 1.6 px strokes, drawn for Cuttle.
- **Motion.** 120 ms hover, 200 ms panels, 320 ms the editor opening; reduced motion: none.
- **Accessibility.** Every control is reachable by keyboard with a visible focus ring (2 px, the
  accent); content text at least 4.5:1, quiet labels 3:1; tooltips name the shortcut; hints are quiet
  text, never the loudest element.
- **Mockups** (`docs/design/desktop/`): the editor (source view with a selected zoom, the Look tab),
  the picker, the pill, countdown and HUD, as HTML with their rendered PNGs (made with `cuttle
  capture-page`). They set the direction; the implementation follows the tokens.

## Errors

- No ffmpeg, no device, a device in use, too little disk: the picker says which and how to fix it;
  recording does not start.
- The recorder fails mid-take: the HUD says so; the take is recovered and opened if it has video.
- A project that does not parse: the editor keeps the last good document and shows the issues with
  their paths; Open refuses with the same list.
- A save conflict that cannot be replayed: the editor keeps the user's version as a draft
  (`cuttle.json.draft`) and shows both, never silently choosing.
- An export failure: the sheet shows the error; nothing is left at the output path (the export's rule).

## Testing

- **Pure modules** (vitest, Node): continuous cuts and output-time ramps (golden images for a zoom and a
  caption across a speed change, a split with no freeze), the export's audio without fades at
  continuous cuts, ids and labels round-tripping through the CLI, hash-checked writes and the CLI's
  conflict exit, the document's commands (property tests over random edit sequences: every result
  parses, undo restores byte for byte), conflict replay, preview↔source mapping, picker hit testing
  (with the desktop classes left out), DIP conversions, region snapping, overlay placement, the media
  protocol's path checks (traversal, junctions, case, other projects), dead-zone filtering, `takeTime`
  and segment joining arithmetic.
- **Recorder** (`test` backend): a paused take joined and checked with ffprobe (A/V offset under one
  frame from a beep and a flash), `recover` of a take killed while paused, dead zones.
- **End to end** (`pnpm app:check`, Playwright's Electron driver, windows hidden): open a fixture;
  play and scrub; pixel parity of the output view with `renderStills`; split, trim, draw a zoom and a
  mask in the source view, undo, redo, check the file; a CLI write during a drag (replayed, nothing
  lost); export 16:9 and check it with ffprobe; record with the `test` backend through the picker, stop,
  and see the editor cut it. A 30-minute `test`-backend take opens, scrubs and plays within set time and
  memory budgets.
- **By hand** (a checklist in each plan): real recordings of a window and a region on two displays with
  different scales, the HUD absent from video and events, focus back in the picked window, a real
  pause, the camera bubble, the packaged build.

## Milestones (each: a spike, a plan written from a prototype, reviews, a merge)

| # | Milestone | Done when |
|---|---|---|
| P2-M0 | Shared packages: `@cuttle/core`; continuous cuts; output-time overlay ramps; ids and labels; hash-checked writes | the CLI and skill tests pass with the new rules; goldens show no freeze at a split and no zoom jump at a speed change; a conflicting write is refused |
| P2-M1 | A walking skeleton that ships: `apps/desktop` with protocols, IPC contract, open a project, the editor's output view and player (proxy, audio clock), a read-only timeline with thumbnails and waveform, the export sheet; the pill and tray; `app:build` | `app:check` opens a fixture, plays, scrubs, matches `renderStills`, exports; the unpacked build starts |
| P2-M2 | Recording without pause: recorder ids, classes and dead zones; the recorder host; picker; countdown; HUD; focus restore; the editor on the raw take with suggest in the background; record again | `app:check` records with the `test` backend through the picker and lands in the cut take; a real recording by hand |
| P2-M3 | Editing: commands, undo, saving with conflict replay and outside changes; timeline edits; source view and tools; inspector and Look tab; command menu; shortcuts | `app:check` performs every edit and checks the file; a CLI write mid-drag is replayed |
| P2-M4 | Pause by segments and restart; first run and settings; empty states; polish | the paused-take tests pass; a real paused recording by hand |

## Review (what the independent review changed)

The first draft was reviewed against the code. Its main findings, all adopted above: every split
froze for 0.3 s and dipped the audio (the timeline crossfades every boundary); overlay ramps used the
speed of the clip on screen; the format had no ids or labels for the editor to hold on to; two writers
(the app's autosave and a running `suggest`) would lose work; the pause design missed `recover`,
Claude's transcript markers, device start-up time and A/V tests; the HUD's clicks and the picker's
focus would leak into every take; playback could not keep up with 12–64× clips and would decode a
30-minute mic at once; drawing on the composed preview is imprecise and contradicts "what you see";
overlays in source seconds surprise people when speeds change; restart and "record again" were
destructive; packaging and recording came too late. Smaller points: the desktop and taskbar windows
pass the recorder's filters, DirectShow names are truncated, the picker needs a folder chooser for
Claude's stop, permissions must be checked per `webContents`, the protocol must resolve junctions, a
crashed utility process could leave ffmpeg recording, PATH is stale right after installing ffmpeg, the
palette had three hues for five kinds and overused the accent, and the mockups contradicted the spec
in places.

## Evidence (spikes, 2026-10-17)

1. `setContentProtection(true)` is `WDA_EXCLUDEFROMCAPTURE` on Windows 11: ddagrab captures the window
   behind it, not a black box.
2. `screen.dipToScreenRect` gives exactly the recorder's DXGI monitor rects (125 % primary, a rotated
   display, negative origins).
3. koffi and uiohook-napi load and run in Electron's main process and in a utility process.
4. Scrubbing and playback in a renderer: random seeks 59 ms median (software decoding), sequential
   decode 564 fps on a mostly still 2560×1440 H.264 take (busier screens decode slower; hence the
   proxy).
5. The recorder's window list keeps z-order but drops only its own process's windows.
6. Renderer stack versions: React 19.3.0, @vitejs/plugin-react 6.1.1.
7. HTML mockups render with `cuttle capture-page` for review.
8. Pause by segments: lossless video joins; audio needs the trimming filter (~23 ms per segment
   otherwise).
9. The `cuttle-media` protocol with Range requests feeds Mediabunny's `UrlSource` (seeks 21–64 ms).
10. Playwright's Electron driver controls hidden windows (393 ms to the first click).

Still to spike in their milestones: overlay windows on a second display with another scale (P2-M2), a
utility process's ffmpeg children when it crashes (P2-M2), the 720p proxy's encode time and
key-frame playback (P2-M1), packaging the native modules (P2-M1).

## Open questions (decided when their milestone starts)

- Whether the preview shows a safe-area guide for 9:16 captions.
- A light theme (not in v1).
- Several takes in one edit (phase-1 non-goal; "record again" keeps the previous take restorable).

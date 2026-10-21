# Cuttle's redesign: calm, spacious, quick

The editor and the windows around it feel cramped: the video takes 27 % of the editor's window, the
timeline shows eleven rows whether they hold anything or not (five of them sentences of
instructions), the inspector is a 300 px column of eight equal rows, and every pane is cut off from
the next by a line. Controls come in five heights, text goes down to 9.5 px, and the same choice is
drawn four ways. The build is denser than its own design reference (`docs/design/desktop/`).

This plan makes Cuttle feel like a premium tool, without making it slower and without touching the
recording HUD (`hud.html`, the bar while recording), which stays as it is.

It rests on four audits (the editor and its timeline, the inspector, the other windows, and how
Cap, Screen Studio, Tella, Descript, Linear and Figma do it) and on screenshots of the current
editor taken from this checkout.

## Where it stands

Every phase is in: 1–4 (#97–#100), the inspector's second pass (#101), the other windows (#102),
the polish (#103), and what phases 2 and 3 had left: the inspector resizable (320–440 px) and
hideable (Ctrl+I), the timeline's height set by a handle (both kept in `layout.tsx`), blocks too
narrow for their label showing its first letter, and the timeline's bar folding on a narrow window.

## Principles

1. **The video leads.** The stage gets the space: the timeline and the inspector are tools around it.
2. **Show what is there, offer the rest.** A timeline lane shows when it has something; an empty
   project shows one way to add each kind, not a sentence per lane. Advanced settings sit behind
   "Advanced"; hints appear on hover.
3. **Structure is felt, not seen.** Panels are cards on a darker window (8 px gutters, 12 px
   radius, a hairline ring) instead of lines between every pane and row; surfaces differ by
   brightness, not by borders.
4. **One scale for everything.** Spacing 4·8·12·16·24·32; control heights 24·30·36; radii
   6·8·10·12·16 (an inner radius is the outer one less the padding); type 11·12·13·15·20 with no
   text under 11 px (Windows renders thin text worst); tabular figures for every number.
5. **One accent, used for one thing at a time.** Cuttle's clay (`--accent`) marks the primary action
   (Export), the selection and the playhead. Each kind of item (zoom, mask, caption, …) has one
   mid-tone hue, drawn as a tint (`color-mix`, 15–20 %) with a 1 px inset outline, never as a
   saturated block.
6. **One control per kind of choice.** 2–5 options: a recessed segmented control. Visual choices
   (backgrounds, frames, caption styles): tiles with pictures. Booleans: switches. Numbers: inputs
   with their unit inside, or 3 px sliders with a live readout. Selection: an accent ring for
   pickers, a raised fill for segments; everywhere the same.
7. **Hover is the second layer.** Trim handles, lane hints and item actions come on hover; labels
   shrink with the width of what they name.
8. **Quick is part of the design.** No `backdrop-filter`, no blurred shadows on many elements, no
   transitions on layout; colour changes in 150 ms, things that enter in 220 ms
   (`cubic-bezier(.22,1,.36,1)`), menus and tabs without animation. Nothing new subscribes to the
   player's time above the small components that already do.

## Phases

Each phase is a pull request of its own that leaves the app whole: screenshots before and after
(`scratchpad/ui/shots.mjs`, the editor opened from the checkout on a copy of a take), `pnpm
typecheck`, the node tests, `pnpm app:check` on macOS (and CI's on Windows), and a playback check
that the renderer's main thread does no more work than before.

### 1. Foundations (no visible layout change)

- `tokens.css`: spacing, control heights, radii and a type floor as tokens; `--warn`/`--warn-soft`
  (the end card's amber stops doubling as the warning colour); soft variants of ok, danger and
  recording; `--shadow-bar` (the HUD's); `--mono` with `ui-monospace, 'SF Mono', Menlo` first (macOS
  falls back to a generic font today). New tokens only: existing values stay, so the HUD does not
  move.
- The HUD's rules move from `picker.css` into `hud.css`, so the picker can change without it.
- `editor.css`: kind tints through `color-mix` instead of 72 `rgba()` literals; radii, gaps and
  control heights through the tokens; duplicate rules (`.field-label`, `.chips`) merged.
- Paint fixes: `.cut-notch` loses its per-notch `filter:drop-shadow`; `.toast` and
  `.draft-note.restart` lose `backdrop-filter` (it re-blurs the playing canvas every frame).

### 2. The editor's shell

- Panels as cards: stage, inspector and timeline on the window's background with 8 px gutters.
- The stage gets most of the window: the video from 27 % to about 40 % of a 1600 × 1000 window.
  The transport sits under the video's edge, not the stage's.
- The title bar: the project's name 14/600, one quiet line of meta, then format, undo/redo, Record
  again (quiet) and Export (the one accent button). Every segmented control 28 px.
- The tool rail joins the stage (no column of its own, no border); its key letters move into the
  tooltips.
- The inspector 360 px (from 300), resizable between 320 and 440 and hideable; the timeline's
  height resizable by a grabber (`--timeline-height`, kept per window), throttled to a frame.

### 3. The timeline

- Lanes 40 px with 6 px between them (from 22–34 px with none); chips 26 px, 12/500 labels.
- A lane shows when it has something (video, zoom and mic by default); "+ Track" adds the others;
  mic and input become one thin activity strip. With no markers, no markers row.
- Items: the kind's tint, a 1 px inset outline, an 8 px radius and a 3 px bar of the kind's colour
  on the left; the selection an accent ring. Labels shrink with the item: full, short, a glyph.
- The toolbar in groups — Split · Speed | Zoom Mask Caption Card Page (a coloured dot each, no
  "+") · Motion Music Sound | scenes and length — Snap · Fit · scale, folding to dots on a narrow
  window (container queries).
- The ruler thinner (labels every 5–10 s, dots between, 11 px tabular figures); the playhead an
  accent line with a round head, moved with `transform`.
- Lane hints only on hover, and short.

### 4. The inspector

- Sections with titles (a clip: Speed, Timing, Look; a zoom or mask: Timing, Area, Movement,
  Visibility), 12 px between rows, 20 px between sections; notes under their control, not beside it.
- One segmented control (full width, 30 px) for speed and the other 2–5-option choices; switches
  for every boolean; units inside the inputs ("From", not "From (take s)"); read-only values as
  label and value on one line.
- "Advanced" (a native `<details>`) for take seconds, x/y/w/h, a page's path, its network and the
  motion blur's samples; "Draw on the video" as a button with the tool's icon and key.
- The Look tab: each part's switch in its head, its summary on a second line, parts that close
  again; sliders with a live readout; colours with a hex field.
- With nothing selected: buttons for the tools (Zoom, Mask, Caption, Crop) and the shortcuts.
- The tabs' arrow keys fixed (ArrowLeft moves right today), Home and End added.
- Shorter help: an automatic item says "Made by Cuttle · for a filler word"; the rest in a tooltip.

### 5. The other windows

- The picker's bar on the HUD's grid (36 px options, the HUD's shadow, no blur), its notice placed
  where there is room, a line per missing permission with "Open System Settings", the reason a
  take cannot start shown, not only in a tooltip; "records this window" on macOS.
- Settings: a title per page, a permissions card (macOS) and a hotkeys card, the version once,
  Welcome with a fixed footer that turns into "Start recording" once everything is ready.
- The pill: its key chip through `hotkey()` (it shows Windows' keys on a Mac today), sized to its
  content, no blur.

### 6. Polish

- Motion details (entering panels, the track picker), every action in the command menu, and a
  last pass over wording and empty states with the screenshots of every window side by side.

## What must keep working

- Every `data-testid`, class and text the app check reads (the audits list them: tabs `#tab-*`,
  `.kind-head .name`, `.look-part` order, `.select-list [role=option]`, `.auto-count` texts,
  `export-note`, the picker's and settings' test ids, the prompter's width equal to the HUD's).
  A change that must move one changes the test in the same pull request.
- The overflow check (`outsideItsPanel`): nothing reaches past an inspector panel's content box.
- Windows and macOS: title-bar space (152 px on the right on Windows, 84 px on the left on macOS),
  `-webkit-app-region: no-drag` on every control in a title bar, keys through `hotkey()` and
  `shortcut()`, `:root[data-platform='darwin']` for platform spacing; `titleBar()` in `windows.ts`
  hard-codes the Windows caption colours, which follow `--bg`.
- Performance: the components that follow the player (VideoFrame, Transport, Playhead, SourceView,
  the tool rail, the timeline's bar) stay small; nothing new per clip or chip but CSS; the timeline
  root does not re-render more often than on drags, scrolls and hovers today.

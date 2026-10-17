# Cuttle phase 3: smoothed cursor, auto-zoom on clicks, polish (design)

Date: 2026-10-17. Status: written for the autonomous run the user asked for ("alle M und alle
Phasen"); the decisions below are the author's, made against the phase-1 and phase-2 specs.

Phase 1 built the engine, the CLI and the skill; phase 2 the desktop app. The phase-1 spec names
phase 3 as "auto-zoom on clicks, smoothed cursor, polish, macOS validation" and leaves two models
open: cursor smoothing and auto-zoom clustering. This document settles them.

## Scope

In:

- **A smoothed cursor.** The recorded pointer path is jittery and robotic (a straight line between
  logged samples). The export draws a smooth path that still clicks exactly where and when the
  person clicked.
- **Auto-zoom on clicks.** `suggest` (and the editor, on request) adds zooms that follow the clicks
  of a take, grouped so the video zooms in on a spot, stays while the work happens there, and
  leaves; never during sped-up waiting, never more than the eye can take.
- **Polish** the phase-2 reviews left for later: the Look tab's cursor and frame styles as swatches
  the engine draws, and a ghost under a dragged scene.

Out:

- **macOS validation.** This machine runs Windows; recording on macOS does not exist yet
  (`record()` says `unsupported-platform`), and nothing here can be tried on a Mac. The code stays
  platform-guarded; a later milestone with a Mac adds the macOS recorder, the macOS cursor
  lookalikes for `system`, and the checks on a real Mac.
- **Pickers created at start** and **a busy camera tried again.** The pickers open in about a
  third of a second, and most of it is the recorder listing windows, not making them: measured
  first, then decided. No camera here can be made busy on purpose, so a retry could not be tried.
  M2's 0.6 s wait already covers the picker's own preview holding the camera. Both are for later.
- Typing zooms. Key events carry no position (the cursor is not the caret), so zooms that follow
  typing would guess; the answer zoom from screen changes already covers Claude's reply.
- Several takes in one edit, an installer, signing, auto-update, a light theme, music and voice
  (as before).

## Principles (in addition to phase 2's)

1. **What you see is the export.** Smoothing and auto-zooms are data the engine reads (`look` and
   `zooms` in cuttle.json), computed by pure functions shared by the editor, the export and the CLI:
   the preview and the file always agree, and Claude can read and change them.
2. **A click is sacred.** Whatever the smoothing, the cursor is exactly at the click's position at
   the click's moment, and the ripple starts there.
3. **No lag.** Smoothing never makes the cursor arrive late: the filter is zero-phase.
4. **Fewer, better zooms.** A wrong zoom is worse than none: when in doubt, no zoom.

## The smoothed cursor (P3-M1)

**Format.** `look.cursor.smoothing`: 0 (the path as recorded) to 1 (very smooth), default 0.5. Old
projects get the default, so their next render is smoothed; 0 keeps the recorded path exactly.
The smoothed path is made on first use per track and smoothing (`cursorAt(track, t, speed,
smoothing)`), so the editor's Look tab can change it without opening the media again.

**Model** (`packages/timeline/src/cursor.ts`, pure, deterministic, random access):

1. The move samples are split into **stretches** at anchors: every click (position and time kept
   exactly), every rest (no move for 0.25 s or more: the cursor holds still until the next move,
   it does not drift), and every jump (400 px or more within 20 ms: a teleport by a program or
   between displays, which is not smoothed across). The first and last sample are anchors too.
2. Each stretch is resampled at 120 Hz in source time (linear between samples).
3. A Gaussian kernel smooths it, zero-phase (centred), with sigma `0.02 + 0.16 × smoothing`
   seconds (0.5 → 0.1 s), the window clamped at the stretch's ends.
4. The smoothed stretch is corrected so its ends meet the anchors exactly: each end's error fades
   out within the kernel's reach (3 sigma), so an anchor's own jitter bends the path near it only.
5. `cursorAt` reads the smoothed samples (linear between them). Shapes and click effects are as
   before.

**Editor.** The Look tab's cursor section gets "Movement": As recorded, Light smoothing, Smooth,
Very smooth (0, 0.3, 0.5, 0.8), and keeps an exact value set in cuttle.json.

**Tests.** Unit: zero smoothing equals the recorded path; the path passes through every click
exactly at its time; a rest holds still; a jump is not smoothed across; the jitter goes and a
steady move keeps its place (no lag); a path is made once per smoothing. The goldens keep their
images: the one golden whose cursor moved (a crossfade, with 2 s between its samples) pins
smoothing 0, since smoothing would hold its cursor still through that rest.

## Auto-zoom on clicks (P3-M2)

**Model** (`packages/timeline/src/click-zooms.ts`, pure, shared by `suggest` and the editor):

1. **Clicks considered:** left clicks inside a clip whose speed is at most 2 (waiting sped up is
   not zoomed), outside the answer zoom, and on the screen (not a click on the app's own HUD: those
   are not logged anyway).
2. **Clusters:** clicks in time order; a click joins the open cluster when it comes within 3 s of
   its last click and the cluster's bounding box with it stays within 40 % of the screen's width
   and height; otherwise it opens a new cluster.
3. **A zoom per cluster:** the bounding box, padded by 10 % of the screen's width on every side, at
   least 45 % of the screen's width (so at most about 2.2× zoom), in the screen's aspect, kept
   inside the screen. It starts 0.7 s before the first click (the zoom eases in for 0.6 s, so it
   arrives as the click happens) and lasts until 1.2 s after the last one, at least 1.8 s. A
   cluster is within one clip.
4. **Fewer, better:**
   - Two zooms whose rectangles overlap by more than 60 % and that are less than 1.5 s apart
     become one.
   - A zoom that would cover more than 80 % of the screen is dropped: it would barely zoom.
   - At most one zoom starts in any 5 s of output.
   - Nothing within 1 s of its clip's cut (a cut and a zoom at once is too much): the zoom
     starts or ends a second inside, or is left out when that leaves less than 1.8 s.
5. Zooms are labelled "Click" (one click) or "Clicks" (several), with ids like every other.

**Where.**

- `cuttle suggest` adds them with the answer zoom; `--no-click-zooms` keeps the old behaviour,
  `--no-zoom` adds none.
- The editor's command menu gets "Auto-zoom on clicks". It replaces the zooms labelled
  Click/Clicks with a fresh set, as one step to undo.
- Suggest's note says how many it added.

**Tests.** Unit, over synthetic event logs:

- a single click;
- a burst of clicks in one spot;
- clicks across the screen (two zooms);
- clicks in a sped-up clip (none);
- clicks too close in time (merged or dropped);
- the cap per 5 s;
- the screen's edge.

The CLI's test: suggest on a take with clicks at 1× adds a "Clicks" zoom (and none with
`--no-click-zooms`).

## Polish (P3-M3)

- **Swatches drawn by the engine.**
  - The Look tab shows the cursor styles (system, two arrows, dot, ring, spotlight) and the frame
    styles (mac-dark, mac-light, browser-light, none) as pictures the engine draws, instead of
    menus.
  - The editor draws them once, when the Look tab first shows, with the engine's renderer on an
    offscreen canvas: a one-clip project on a calm background. A frame shows its window's top-left
    corner, enlarged. A cursor shows close up.
- **A ghost under a dragged scene.** While a scene is dragged, a translucent copy of its block
  follows the pointer; the insert mark still says where it lands.

## Milestones

The three are small. They share one plan, written from one prototype and replayed, and one pull request with its reviews; each milestone has its own tasks in the plan.

| # | Milestone | Done when |
|---|---|---|
| P3-M1 | Smoothed cursor: the model, the format, the Look tab | unit tests and a golden pass; the export and the editor draw the same smoothed path |
| P3-M2 | Auto-zoom on clicks: clustering, suggest, the editor command | unit tests pass; suggest adds click zooms to a take with clicks; app:check shows them |
| P3-M3 | Polish: engine swatches, the scene ghost | app:check passes; screenshots reviewed |

## By hand (the user, later)

- A real take with clicks in a browser: the zooms land where the work is, and the cursor glides.
- On a Mac (when the macOS recorder exists): everything above, and the `system` cursor's macOS
  lookalikes.

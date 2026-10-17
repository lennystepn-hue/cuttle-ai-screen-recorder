# Cuttle phase 4: auto-direction and speech (design)

Builds on phases 1 to 3 (`2026-10-16-cuttle-design.md`, `2026-10-17-cuttle-desktop-design.md`,
`2026-10-17-cuttle-phase3-design.md`). The roadmap is `2026-10-17-cuttle-roadmap-p4-p6.md`.

## Goal

After a take, Cuttle understands what happened (the speech, the text on screen, the shape of the
app) and edits for it:

- crops to the content;
- masks private data;
- removes retakes, filler words and pauses;
- zooms where the person types and where dialogs open;
- puts captions on the speech;
- fits the video to a target length.

Every automatic edit is visible, says why it is there, and can be switched off one by one or by
kind. A rerun never changes what the person or Claude adjusted.

The first real take shows what this is for. It was the Holofish landing page in a browser, on the
whole display. The cut by hand needed a crop to hide 30 tab titles, the bookmarks, the sidebar and
the taskbar. It needed a better zoom on the FAQ, a cut of the pause on the hero, and an end before
a window switch. Phase 4 does each of those by itself.

## Decisions

1. **Understanding is hybrid.**
   - **While recording,** only facts that are cheap and can only be had live are logged: the
     content area of the window shown, the caret or focused field, dialogs, menus and
     notifications, and the mistake key.
   - **After the stop,** in the background like `suggest` today: transcription and reading the
     screen.
   - Rejected: only after the stop, from the video (no app structure, so a worse crop and no
     caret); everything live (too heavy beside the capture).
2. **Automatic edits are tagged items.** A new list `cuts` removes source ranges. An `auto` field
   on cuts, zooms, masks and a clip's crop names the kind. Editing an item by hand removes its
   tag, and a rerun replaces only tagged items.
   - Rejected: rewriting `scenes`. It is opaque, and it clobbered hand edits in phase 3. Also
     rejected: a separate auto file, which would be a second source of truth.
3. **Speech is the Whisper in ffmpeg** (the `whisper` filter, ffmpeg 8+; this machine has 9.0).
   The models are whisper.cpp ggml files, downloaded once when the person asks.
   - Rejected: a bundled whisper.cpp binary (another native binary per platform); Windows speech
     recognition (much worse); cloud APIs (cost and privacy).
4. **UI Automation and OCR run in a helper process.** It is Windows PowerShell 5.1 with C#
   compiled at start (`Add-Type`): managed UI Automation and `Windows.Media.Ocr`, with JSON lines
   over stdio. Every Windows 10 and 11 machine has it, and it needs no build tools.
   - Rejected: COM through koffi (UI Automation's vtables by hand); a compiled exe (a toolchain in
     the build).
   - The spike measures its speed. If it is too slow, the fallback is the .NET Framework's
     `csc.exe`, which is on every Windows, compiling a small exe at first run.
5. **Windows on screen come from the recorder.** Dialogs, menus and notifications are found by
   the recorder's own window enumeration (koffi, already there), not by UI Automation.

## What the person sees

1. **Recording.** As before. New: the **mistake key** (Ctrl+Shift+Alt+X, or the scissors button
   on the HUD). The person misspoke or misclicked, presses it, and does the bit again. Saying
   "nochmal" (or "again") does the same. The HUD flashes "Cut back to 0:12".
2. **After the stop.** The editor opens on the take at once, as today. The title bar's chip shows
   the steps: "Cutting the take…", "Transcribing… 40 %", "Reading the screen…". The automatic
   edits arrive as one step to undo, named "Auto-direction".
3. **The Auto tab** (a new inspector tab: Selection · Auto · Transcript · Look) says what Cuttle
   did, one row per kind with a count and a switch:
   - "Cropped to the page: browser tabs and bookmarks hidden"
   - "Masked 5 private things: 2 email addresses, 1 API key, 2 notifications"
   - "Removed 2 retakes"
   - "Removed 14 filler words and 6 pauses"
   - "Zooms: 3 while typing, 1 on a dialog, 2 on clicks"
   - "Captions: on, German"

   Each row opens to its items, with a time and a reason. "Show" goes there, and each item has
   its own switch. The tab never says "safe": it says what it found and what it read ("Read 84
   frames").
4. **The Transcript tab:**
   - The words in paragraphs; the word being played is highlighted.
   - A click on a word goes there. A double click fixes its text, and the captions follow.
   - Selecting words and pressing Delete cuts them out of the video.
   - Cut words are struck through and can be restored; filler words are faint.
   - Ctrl+F finds a word.
5. **The Look tab** gains Captions: on or off, the style (pictures drawn by the engine, as for
   cursors), the position, the size and the highlight colour.
6. **The timeline:**
   - Cuts show as notches on the video lane; a click selects one.
   - A captions lane shows the lines.
   - The bar's "Length" control ("44 s ▾": 15 s, 30 s, 60 s, custom) fits the video.
7. **Export** gains captions: burned in (the default when they are on), also as `.srt` and
   `.vtt`, or off.
8. **Settings** gain Speech:
   - Off, or one of three models: Fast (`base`, 142 MB), Good (`small`, 466 MB), Best
     (`large-v3-turbo-q5_0`, 574 MB). The spike sets the default and checks the sizes.
   - The language: Auto, Deutsch, English.
   - A download with progress, cancel and a checksum.
   - "Always mask": words such as the person's name or address, masked wherever they show.
9. **The picker** says when notifications are on: "Notifications can appear in the video".
   Its button opens Windows' Do not disturb setting. Cuttle does not change the setting itself.

## The project format

All times are source seconds and all rects are source pixels, as before.

```jsonc
{
  "scenes": [
    // a clip shows only `crop` of the screen; the window takes its shape
    { "type": "clip", "id": "s1", "from": 0.4, "to": 44.3, "crop": { "rect": [62, 141, 2478, 1237], "auto": "crop" } }
  ],
  // source ranges taken out of whatever clip covers them (a jump cut, no crossfade, 10 ms audio fades)
  "cuts": [
    { "id": "c1", "label": "Filler: ähm", "from": 12.41, "to": 12.83, "auto": "filler" },
    { "id": "c2", "label": "Retake", "from": 20.1, "to": 27.6, "auto": "retake" },
    { "id": "c3", "label": "Words: \"wie gesagt\"", "from": 31.0, "to": 31.6, "enabled": false }
  ],
  "zooms": [
    // `moves`: a zoom that follows; between keyframes it eases from one rect to the next
    { "id": "z4", "label": "Typing", "at": 33.2, "duration": 5.1, "rect": [700, 400, 1200, 675], "auto": "typing",
      "moves": [{ "at": 35.0, "rect": [760, 520, 1200, 675] }] }
  ],
  "masks": [
    // `moves`: a mask that follows scrolling text; between keyframes it covers both rects
    { "id": "m3", "label": "Email address", "from": 8.0, "to": 14.5, "rect": [880, 610, 420, 44], "style": "fill", "auto": "privacy",
      "moves": [{ "at": 10.5, "rect": [880, 420, 420, 44] }] }
  ],
  "captions": {
    "enabled": true, "style": "karaoke", "position": "bottom", "size": 1, "color": "#D97757",
    // fixes the person made in the Transcript tab: the words in [at, end) read as `text`
    "fixes": [{ "at": 3.12, "end": 3.58, "text": "Holofish" }]
  },
  // kinds the automatic edits make; a kind switched off is not made again on a rerun
  "autoEdits": { "fillers": true, "pauses": true, "retakes": true, "crop": true, "privacy": true,
                 "typingZooms": true, "dialogZooms": true, "clickZooms": true }
}
```

- **`auto`** is one of `crop`, `privacy`, `notification`, `retake`, `filler`, `pause`, `length`,
  `typing`, `dialog`, `click` or `answer`. Phase 3's click zooms and answer zoom become `click`
  and `answer` when they are made.
- **Hand edits win.**
  - The editor removes `auto` from an item when the person changes its time, place or size;
    switching it off keeps the tag.
  - The skill tells Claude to do the same.
  - A rerun replaces only the items that still carry their kind's tag, and keeps out of the way
    of the others: no click zoom over a zoom made by hand, no mask doubling one made by hand.
  - When a rerun makes an item again where one of its kind was switched off (the same kind,
    ≥ 50 % overlap in time, rects ≥ 50 % alike), the new item stays off.
- **`cuts`.** A cut removes `[from, to)` from every clip that covers it. `sceneSpans` splits a
  clip into pieces around its enabled cuts. A clip that is entirely cut disappears. The pieces of
  one clip join without a crossfade. The audio fades for 10 ms on each side, as at a speed change.
  The smoothed cursor is kept apart at each cut (phase 3 already does this at clip edges).
- **`crop`** applies to clips only.
  - The engine treats it as the screen: zooms fit inside it, and the cursor and click ripples
    outside it are not drawn.
  - The window takes the crop's aspect, so a page wider than 16:9 gets more background above and
    below rather than a cut.
  - A crop changes only at scene boundaries; `suggest` splits a clip where the content area
    changes for good.
- **Mask `moves`.** Before the first keyframe the mask is `rect`. Between two keyframes it covers
  the union of both rects, which is safe however the text moved between samples. After the last
  keyframe it holds that rect.
- **Zoom `moves`.** The zoom eases from one rect to the next over 0.6 output seconds, centred on
  the keyframe. The ramps in and out are as before.
- **`captions`.**
  - The words come from `takes/<n>/transcript.json`, with `fixes` applied, and only words in
    kept stretches show.
  - Lines break at pauses ≥ 0.6 s, at sentence ends, or at 42 characters (`bold`: 1 to 3 words).
  - Styles:
    - `subtitle`: classic, two lines at most, on a dark box;
    - `karaoke`: the current word in `color`;
    - `bold`: large, centred, for 9:16.
- **`autoEdits`** holds the person's switches per kind. The Auto tab writes it, and the switch
  turns that kind's items off or on in the same step.

## The take's new files

- `takes/<n>/transcript.json`, written by transcription and never edited by hand (fixes live in
  `cuttle.json`):

  ```jsonc
  { "version": 1, "language": "de", "model": "small", "words": [{ "t": 3.12, "end": 3.58, "text": "Holofisch" }] }
  ```

  Times are source seconds; the mic track's offset from `take.json` is applied.
- `takes/<n>/screen-text.jsonl`, written by the OCR pass. One line per frame read:
  `{ "t", "lines": [{ "text", "rect", "words": [{ "text", "rect" }] }] }`.
- `takes/<n>/mic.clean.m4a`, when audio cleanup is on: speech denoising (`arnndn`) and loudness
  (`loudnorm`, −16 LUFS). The preview and the export both use it, so they sound the same.
- New lines in `events.jsonl`, logged while recording:
  - `{ "type": "area", "t", "rect": [x, y, w, h] | null }`: the content area of the window shown
    (a browser's page, an editor's text, a terminal's grid), from UI Automation. Logged on a
    change of foreground, position or size, and checked every second.
  - `{ "type": "caret", "t", "rect" }`: the caret, or else the focused text field, while keys are
    typed (at most 5 a second).
  - `{ "type": "window", "t", "id", "kind": "dialog" | "menu" | "notification", "rect", "open" }`:
    a dialog, menu or notification opens or closes over the captured area, from the recorder's
    window enumeration (every 250 ms).
- A new marker kind `retake` in `markers.json`, for the mistake key.

Typed characters are never logged. Element names are not logged in phase 4 (phase 6's guide adds
them for buttons, links and menu items only).

## The pieces

| Piece | What it does | Depends on |
|---|---|---|
| `packages/sense` (new) | The Windows helper: UI Automation (content area, caret or focus) and OCR on PNG files. JSON lines over stdio; started by the recorder host at the start of a take and by the analysis for OCR. A crash is logged, and the take goes on without those events. | PowerShell 5.1 |
| `packages/analysis` (new) | `transcribe` (ffmpeg whisper, JSON, word segments), the OCR pass (frames where the screen changed, at most 2 a second), audio cleanup, and the detectors. Each detector is a pure function from events, transcript and screen text to tagged items, tested on fixtures. | ffmpeg, sense |
| `packages/core` | `suggest` becomes the director. It runs the analysis when it can, merges the detectors' items by the tag rules, splits clips at crop changes, and keeps the phase 3 spacing for zooms in output time (priority: answer, dialog, typing, click). `--length` fits the length. | analysis, timeline |
| `packages/project` | The schema above, the `retake` marker and the new event types. | |
| `packages/timeline` | Cuts in `sceneSpans` and `frameAt`; the crop as the screen; the moves of masks and zooms; caption layout and timing (lines, the karaoke word); the importance curve for length fitting. | |
| `packages/engine` | The crop in the content pass, the caption pass (sprites, three styles), and masks that move. | |
| `packages/recorder` | Runs the sense helper for the take, logs window events through koffi, and takes the `retake` hotkey. | sense |
| `apps/desktop` | The model manager (download, checksum, progress), the Auto and Transcript tabs, captions in Look, the length control, the HUD's mistake button, the picker's notification hint, export captions, and the `Select` and `Menu` components replacing every native `<select>` (8 today). | |
| `apps/cli` | `cuttle analyze`, `cuttle transcript [--srt \| --vtt \| --text]`, `cuttle models [list \| download <name>]`, `suggest --length <s>` and `--no-<kind>` switches. | |
| `skill/` | Auto items and the rule for their tags, cuts, caption fixes, and privacy review: auto masks help, but Claude still looks. | |

## The detectors

All take source seconds, give tagged items, and are pure.

- **Crop.**
  - From `area` events: each stretch where the area stays within 8 px for ≥ 2 s gets that crop.
  - No crop when the area covers ≥ 95 % of the screen or less than 30 % of it.
  - The spike decides whether an image fallback is worth it for takes without `area` events:
    bands at the edges that never change while the middle does.
- **Retakes.** A `retake` marker, or a spoken cue: "nochmal", "noch mal", "noch einmal", "again",
  "one more time" or "let me redo".
  - The cue counts only when the next 4 s repeat ≥ 40 % of the 8 words before it.
  - The cut runs from the last pause before it (a speech gap ≥ 0.7 s with input at rest ≥ 0.5 s,
    at most 20 s back; else 5 s back) to 0.15 s after the cue.
  - It never crosses a scene boundary.
- **Fillers.** Words in a lexicon:
  - German: äh, ähm, öh, öhm, ehm, hm, hmm;
  - English: uh, um, uhm, er, erm, hmm.

  Each is cut with 50 ms on both sides, and only where the picture rests: no input and almost no
  screen change from 0.2 s before to 0.2 s after.

  Whisper tends to leave fillers out. The spike measures this. If it does, a sounding gap between
  words (energy, but no word, ≥ 0.25 s) counts as a filler too.
- **Pauses.** A gap of ≥ 1.0 s between words where the picture rests is cut down to 0.4 s. Where
  the picture moves (waiting for a load), `suggest`'s speed-ups decide, as today.
- **Typing zooms.**
  - A key burst (gaps < 1.5 s, ≥ 1.5 s long) with `caret` events gets a zoom on the caret's line
    at ≥ 45 % of the screen's width.
  - The zoom moves with the caret when it leaves the middle 60 % (`moves`).
- **Dialog zooms.** A dialog open ≥ 1 s gets a zoom on it, padded, from 0.3 s before it opens to
  0.3 s after it closes.
- **Privacy.**
  - On the OCR text:
    - email addresses and URLs with tokens (`token=`, `access_token=`, `key=`);
    - keys: `sk-`, `sk-ant-`, `ghp_`, `gho_`, `github_pat_`, `glpat-`, `xox[abp]-`,
      `AKIA[0-9A-Z]{16}`, `AIza…`, JWTs (`eyJ…`), and `-----BEGIN … PRIVATE KEY-----`;
    - IBANs (mod 97), card numbers (13 to 19 digits, Luhn), phone numbers (+ and ≥ 9 digits, or
      a national format);
    - the person's "Always mask" words.
  - A mask runs from 0.5 s before the first sight to 0.5 s after the last, padded 6 px, with
    `moves` where the text moved, in the style `fill`.
  - Every `notification` window is masked while it is open, plus 0.3 s.
- **Length.**
  - Importance per 0.25 s of output: speech, clicks and keys, the answer zoom and the first
    second of a scene are high; a screen change is middle; rest and pauses are low.
  - The lowest runs (≥ 0.6 s) are cut until the video fits, never inside a word or within 0.3 s
    of a click.
  - When speech alone is longer than the target, it stops there and says "Shortest without
    cutting speech: 42 s".

## When something is missing or fails

- **No speech model, or speech switched off.** Transcription, captions, fillers, pauses and
  spoken retakes are skipped; everything else runs. The Auto tab says "Speech is off" and links
  to Settings.
- **An ffmpeg without `whisper`.** The same, with "Update ffmpeg: `winget upgrade Gyan.FFmpeg`".
- **No mic track.** No speech features, and nothing to say about it beyond the take's facts.
- **The helper does not start** (policy, or not Windows). No `area` and `caret` events: no crop
  (unless the image fallback), no typing zooms, no OCR, so no privacy masks. The Auto tab says
  plainly that the screen was not read.
- **A step fails or times out** (transcription after 4× the take's length, OCR after 2×). It is
  noted in the Auto tab; the other steps still run, and "Try again" reruns that step.
- **Analysis meets an edit in progress.** Its result is merged like any outside change: one step,
  undoable. A gesture under way carries over (phase 2's rules).
- **Long takes.** OCR reads only frames where the screen changed (at most 2 a second, at least
  one every 5 s). Transcription runs with the person's model. Both show progress, and the editor
  works meanwhile.

## Testing

- **Detectors:** unit tests on synthetic events, transcripts and OCR samples. There is a case for
  each rule above, and the false-positive cases matter as much: "noch mal" without a repeat, a
  date that looks like a phone number, a clean frame.
- **Format and timeline:** cuts in `sceneSpans` and `frameAt` (pieces, audio fades, cursor kept
  apart), crop with zooms, the moves of masks and zooms, caption lines and the karaoke word, the
  tag rules on rerun.
- **Engine:** golden images for the three caption styles, a cropped clip, and a mask between two
  keyframes.
- **Speech, end to end:** sentences spoken by Windows' own text-to-speech (offline, free) in
  German and English, with a filler, "nochmal" and a repeat. They are muxed into a generated test
  take. The test runs where a model is present and is skipped elsewhere. For local runs the
  `base` model is downloaded once, with the user's OK.
- **The helper:** an integration test against an Electron window placed off every display (shown
  but never visible), if the spike shows UI Automation sees it. Else a by-hand check.
- **App checks** (hidden windows, the `test` recorder backend):
  - the Auto tab with fixture results (switches, Show);
  - the Transcript tab (seek, fix, cut, restore);
  - captions in the Look tab;
  - the length control;
  - the keyboard for `Select` and `Menu`;
  - the HUD's mistake button.

  Every screenshot is looked at.
- **By hand (the user):**
  - a spoken browser demo with a mistake and the key, an email on screen, and a notification;
  - typing in an editor;
  - a dialog.

## Milestones

| Milestone | Content | Done when |
|---|---|---|
| P4-M0 | Spike: Whisper speed per model on this machine (CPU and GPU), word timing, fillers kept or dropped; the helper's start-up time, UI Automation `area` and caret in Opera, Chrome, Edge, VS Code and Windows Terminal; OCR speed and quality on a 2560×1440 frame; windows of notifications, menus and dialogs; TTS fixtures | `docs/superpowers/spikes/<date>-p4-spike.md` answers each with numbers, and the spec is updated where it was wrong |
| P4-M1 | `cuts`, `auto`, `autoEdits` and crop in the format, timeline and engine; the tag rules in `suggest`; the Auto tab (with phase 3's click and answer zooms as its first items); `Select` and `Menu` replacing all 8 native selects | Unit tests, goldens and app:check pass; no `<select>` is left in the renderer |
| P4-M2 | Speech: models, transcription after the stop, `transcript.json`, captions (format, timeline, engine, Look), the Transcript tab, fillers, pauses, audio cleanup, SRT and VTT, `cuttle transcript` and `cuttle models` | The TTS fixture comes out with captions and without its filler; app:check covers the tab |
| P4-M3 | The mistake key: hotkey, HUD button, spoken cue, the retake detector | Unit tests; app:check presses the HUD button with the test backend |
| P4-M4 | The helper while recording: `area`, `caret` and `window` events; crop, typing zooms and dialog zooms | Unit tests on logged fixtures; a scripted off-screen window recorded with the test backend gets them |
| P4-M5 | Privacy: the OCR pass, patterns, masks that move, notification masks, "Always mask", the picker's hint | Planted secrets on fixture frames are masked, clean frames get nothing; app:check shows the Privacy row |
| P4-M6 | Length: importance, the fitter, `suggest --length`, the editor's control | Unit tests; app:check fits the fixture to 5 s |

Each milestone follows the roadmap's process: prototype, plan from it, replay, own reviews with
screenshots, merge.

## Not in phase 4

- Motion scenes and overlays built as HTML pages (end cards, intros, 3D, code on screen), templates
  and themes, voiceover, the teleprompter, live captions in the HUD and webcam work (phase 5).
- The format package, agent overlays, the interactive demo and the guide (phase 6).
- Zooming to what the speaker names (later).

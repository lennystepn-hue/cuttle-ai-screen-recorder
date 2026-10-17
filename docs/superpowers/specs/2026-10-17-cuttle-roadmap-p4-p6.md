# Cuttle roadmap: phases 4 to 6

Phases 1 to 3 built a recorder, an engine, a CLI with a Claude skill, and a desktop app. Together
they turn a take into a framed, cut and zoomed video. This roadmap is for what comes next. Each
phase gets its own design spec before it starts; phase 4's is
`2026-10-17-cuttle-phase4-design.md`.

## The direction: record, and the video is finished

Other tools make recordings pretty. Cuttle can also know **what happens** in a take:

- every click, key count, scroll and pointer shape;
- the windows;
- Claude Code's steps;
- from phase 4 on, the speech, the text on screen and the structure of the app being shown.

The next phases use that knowledge so that a take comes out finished. The person corrects; they
do not build.

## Principles for every phase

1. **Automatic, but accountable.** Every automatic edit is an item in `cuttle.json` with its kind
   and a reason ("Email address", "Filler: ähm", "Retake"). The person can see each one, switch it
   off, or switch off a whole kind. A rerun never changes what a person or Claude edited by hand.
2. **Local and free.** Speech recognition is the Whisper in ffmpeg. Text recognition is built
   into Windows. The engine runs on the GPU. Nothing goes over the network,
   except downloads the person starts, such as a speech model. Paid services only behind a
   setting that is off by default, and none is planned.
3. **Light while recording.** The recorder logs only cheap facts while it records. Heavy work
   (transcription, reading the screen) runs after the stop, in the background, as `suggest` does
   today.
4. **Private by default.** Typed characters are never logged; key counts and modifier shortcuts
   are. Masks for private data are on by default. Nothing is uploaded.
5. **Designed, not default.** No native control without the app's styling. Every new panel follows
   the design system (tokens, focus rings, motion, empty states).
6. **No limits for Claude.** Anything a browser can draw can go into a video: Claude writes it as
   a page, and the editor shows it like any other scene (phase 5).
7. **Quality checks without subagents.** Each milestone runs the same checks:
   - a prototype, then a plan written from it;
   - a replay of the plan on a fresh clone;
   - unit tests and the hidden app checks;
   - a code review and an experience review with hidden screenshots, both done in the session;
   - then the merge.

## Phase 4: auto-direction and speech

Cuttle understands a take and edits it:

- it crops to the content;
- it masks private data;
- it removes retakes, filler words and pauses;
- it zooms where the person types and where dialogs open;
- it puts captions on what the person says;
- it fits the video to a target length.

| Milestone | Content | Done when |
|---|---|---|
| P4-M0 | Spike (done, `docs/superpowers/spikes/2026-10-17-p4-spike.md`): Whisper speed, quality and word timing with an alignment of its own; the content area from Win32 child windows and from the picture; OCR speed and quality; TTS speech fixtures | The spike doc answers each question with numbers |
| P4-M1 | Foundation: `cuts` and `auto` in the project format, timeline and engine; the Auto tab; styled Select and Menu components replacing every native `<select>` | Unit tests and app:check pass; screenshots reviewed; no native select left |
| P4-M2 | Speech: the model download, transcription after the stop, `transcript.json`, captions (3 styles), the Transcript tab (seek, fix text, delete words to cut), filler and pause cuts, mic cleanup, SRT/VTT | A TTS fixture transcribes and gets captions in the export; app:check covers the Transcript tab |
| P4-M3 | The mistake key: hotkey, HUD button and spoken "nochmal" cut back to the last pause | Unit tests on synthetic takes; app:check with the test backend |
| P4-M4 | Live facts: the recorder logs the content area (Win32 child windows), the caret where there is one, and dialog and notification windows; auto-crop (with the picture as fallback), typing zooms from what the screen changes, dialog zooms | Unit tests on logged fixtures; the 12:12 take gets its crop from the picture |
| P4-M5 | Privacy guard: OCR after the stop; patterns for emails, keys, tokens, IBANs, cards and phone numbers; masks that follow scrolling text; notification masks; a "Do not disturb" hint in the picker | Fixture frames with planted secrets come out masked; nothing else is |
| P4-M6 | Target length: "Fit to 30 s" cuts the least important stretches, never speech | Unit tests on importance and fitting; the editor's control in app:check |

## Phase 5: motion, presenting and look

### Motion: Claude can build anything into the video

In plain words: Claude writes code, and the code becomes part of the video. A video should be
able to carry anything a browser can draw: an animated end card, an intro, a 3D product shot, a
chart that builds, a scrolling page, a phone that turns to show a frame of the take. Claude
builds these as HTML pages. Cuttle renders them frame-accurately into the video, and the editor
shows and plays them live like any other scene.

- **Motion scenes** go anywhere in `scenes`: before, between or after the clips. For example
  `{ "type": "motion", "src": "motion/end-card/index.html", "duration": 4, "params": { "title": "Holofish" } }`.
- **Motion overlays** (`overlays`) sit over clips: lower thirds, animated callouts, a logo bug,
  a graphic beside the screen. They are timed in source seconds like texts, placed in the
  output, with alpha.
- **The page contract.** A page includes Cuttle's small motion script. It gets
  `cuttle.params`, `cuttle.duration` and the project's theme as CSS variables, plus
  `cuttle.frame(t)` for a frame of the take as an image. Whatever the page animates runs on a
  virtual clock that the renderer steps frame by frame:
  - CSS animations and transitions;
  - the Web Animations API;
  - `requestAnimationFrame` loops (Three.js, canvas);
  - GSAP timelines, Lottie and `<video>` elements.

  `cuttle.ready()` waits for fonts and images before the first frame.
- **Rendering.** The export renders each page in a sandboxed offscreen window at the output size,
  steps the clock, and takes the frames into the engine, with transparency for overlays. The
  editor shows the page in a sandboxed frame over the preview: it plays in real time, and
  scrubbing seeks it.
- **A kit that works offline**, bundled with the app: Three.js, GSAP and Lottie, plus templates
  Claude and the person start from:
  - end cards: logo reveal, App Store and website call to action, feature list, counter;
  - kinetic intro titles and lower thirds;
  - a 3D device showing a frame of the take;
  - scene transitions;
  - **code on screen:** a syntax-highlighted block that types itself line by line, or
    highlights a diff (for developer and agent demos).
- **Pages may not reach the network**, only the project's files and the kit. A switch per page
  allows it, off by default.
- **In the editor:**
  - motion blocks on the timeline, with thumbnails;
  - the inspector builds a form from the page's declared params (title, colours, logo…);
  - "Open the page" opens it in the person's editor;
  - a reload on save makes changes from Claude show at once.
- **For Claude:**
  - the skill gets an authoring guide (the contract, the kit, the templates, how to check frames
    with `cuttle preview`);
  - `cuttle motion new <template>` copies a template into the project.

| Milestone | Content |
|---|---|
| P5-M1 | Motion: the `motion` scene, `overlays`, the page contract and virtual clock, sandboxed offscreen rendering into the engine (with alpha), the editor's live preview, params form and reload, the kit (Three.js, GSAP, Lottie), `cuttle motion new`, the skill's authoring guide |
| P5-M2 | Templates and the brand kit: end cards, intros, lower thirds, transitions, a 3D device and code on screen, all reading one theme (logo, colours, font, background, frame, cursor). The theme is saved once and applied with a click. Plus more backgrounds (a gradient builder, a blurred wallpaper, quiet animated ones, colours taken from the product), device frames (iPhone, Android, Windows 11, terminal, dark browser) and a watermark |
| P5-M3 | Script and teleprompter: steps written before the take (or by Claude from the project). During the take they show in a window that is never recorded, and a hotkey moves to the next step. Each step becomes a chapter, a caption and a zoom point; a step may name a motion template for its title |
| P5-M4 | Live captions in the HUD while recording, with a mic level (also a check that the mic works) |
| P5-M5 | Presenting overlays: pressed shortcuts shown on screen (logged as modifier combinations only), callouts (arrow, box, number badge, dim everything but a region; built on motion overlays), optional click sounds |
| P5-M6 | Voiceover: record narration over the finished cut in the editor; the take's own sound is ducked under it, and the captions follow it |
| P5-M7 | Webcam: background blur or removal (a local segmentation model), a layout that follows the take (large while the person talks over a still screen, small while they work), more shapes |
| P5-M8 | Music: the person's own track, ducked under speech, faded at the ends |

## Phase 6: output and sharing

| Milestone | Content |
|---|---|
| P6-M1 | Format package: 16:9, 9:16 and 1:1 in one export. 9:16 and 1:1 are reframed automatically along the focus (cursor, zooms, typing), with overrides per format. Also: a thumbnail from the best frame with the title, SRT/VTT, GIF, 60 fps and 4K, and a post text written by Claude through the skill |
| P6-M2 | Agent demos: an overlay with Claude's steps (from the markers), and diff cards for the files Claude changed (the code template from P5-M2, filled from Claude's edits) |
| P6-M3 | Interactive demo: a self-contained HTML walkthrough, one step per click, with a hotspot, a caption and keyboard navigation; it can be embedded on a landing page |
| P6-M4 | Step-by-step guide: Markdown with PNGs, and a PDF. The texts come from the clicked element's name ("Click 'Download on the App Store'") and the transcript. Element names are logged for buttons, links and menu items only, never for text fields |

## Later, each only with the user's go

- Share links (a Cloudflare Worker and R2).
- macOS (it needs a Mac).
- An installer with auto-update. Code signing costs money.
- Zooming to what the speaker names ("the button top right") by matching speech to text on
  screen.

## Order and reasons

Phase 4 comes first: everything after it uses its understanding of the take. The speech feeds
the teleprompter, the voiceover captions and the guide texts. The content area and the focus
feed the auto-reframe. The `cuts` and `auto` model carries every later automatic edit. Phase 5
opens the video to anything Claude can build in code (motion scenes and overlays), and makes
presenting easier and the videos personal; its templates and themes stand on the motion pages.
Phase 6 turns one take into several results: formats, an interactive demo, a guide.

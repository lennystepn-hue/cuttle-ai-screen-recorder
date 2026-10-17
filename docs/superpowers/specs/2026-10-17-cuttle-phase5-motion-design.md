# Cuttle phase 5, part 1: Motion (design)

Status: draft for the user's review. Roadmap: `2026-10-17-cuttle-roadmap-p4-p6.md` (Phase 5,
Motion). Spike: `docs/superpowers/spikes/2026-10-17-p5-virtual-clock.md`.

## The idea

Claude writes code, and the code becomes part of the video. Anything a browser can draw can be in
it:
- an intro or an end card;
- a chart that builds, or kinetic type;
- a 3D phone showing the take;
- a callout at every click, or a code block that types itself;
- a transition that folds one scene into the next.

The code knows the take. A page can ask what happened and when (clicks, typing, the cursor's path,
zooms, Claude's prompt and answer, every spoken word) and can show any frame of the recording. So
motion is tied to the recording, not pasted over it. Cuttle renders every page frame-accurately,
with transparency, the same in the editor and in the export.

## Three places for motion

| Kind | In `cuttle.json` | What it is |
|---|---|---|
| Scene | `scenes: [{ "type": "motion", "src": "motion/intro/index.html", "duration": 3, "params": {…} }]` | A full frame, before, between or after the clips |
| Overlay | `overlays: [{ "id": "o1", "src": "motion/callouts/index.html", "at": 4.2, "duration": 6, "params": {…} }]` | A transparent layer over the video, timed in source seconds like texts, placed over the whole output (not zoomed with the screen) |
| Transition | `scenes[i].transition: { "src": "motion/fold/index.html", "duration": 0.6 }` | Replaces the crossfade into scene `i`; the page gets the outgoing and the incoming frame as images |

The look still frames clips (background, window frame, cursor, webcam). A motion scene fills the
whole output, so it draws its own background. It can ask for the theme's background (below).

## The page contract

A motion page is an HTML file in the project (`motion/<name>/index.html`) with
`<script src="cuttle:motion.js"></script>` first. The script gives the page `window.cuttle`:

- **Time.** The page's clock is virtual (the spike's): `performance.now`, `Date`, timers,
  `requestAnimationFrame`, and every CSS animation, transition and Web Animation follow the frame
  being drawn. Ordinary animation code works unchanged. `Math.random` is seeded per page.
  - `cuttle.time`: seconds into this motion item.
  - `cuttle.duration`.
  - `cuttle.onFrame(t => …)`: a pure render function, the most robust way to draw. Cuttle calls it
    for every frame, also when it seeks.
- **Size and theme.**
  - `cuttle.size` (`{ width, height }`) and `cuttle.format` (`16:9`, `9:16`, `1:1`).
  - The project's theme as CSS variables: `--cuttle-accent`, `--cuttle-font`, `--cuttle-bg`, and
    the logo as `cuttle.theme.logo`.
- **Params.** The page declares them in `<script type="application/json" id="cuttle-params">`
  (name, label, type `text | color | number | image | bool | select`, default). The editor builds a
  form from them, and Claude sets them in `cuttle.json`. `cuttle.params` holds the values.
- **The take** (`cuttle.take`), all in source seconds with converters:
  - `events`: clicks (with position and button), key counts, the cursor's path and scrolls;
  - `words`: the transcript, word by word;
  - `markers`: Claude's prompt, tools and answer, slips;
  - `zooms` and `masks`, as the project has them;
  - `toOutput(source)` and `toSource(output)`: where a moment of the take is in the video;
  - `cursorAt(t)`: the cursor's smoothed position;
  - `frame(t, { width })`: a frame of the take as an `ImageBitmap`, for a 3D screen, a freeze or a
    blurred backdrop;
  - for an overlay, `cuttle.take.window`: the source stretch it covers.
- **Ready.** `cuttle.ready(promise)` holds frame 0 until fonts, images, models and frames are
  loaded. Cuttle also waits for `document.fonts.ready` by itself.
- **Transitions.** `cuttle.from` and `cuttle.to` are the outgoing and the incoming frame
  (`ImageBitmap`s at the output size), and `cuttle.progress` runs from 0 to 1.

## Rendering

From the spike (`docs/superpowers/spikes/2026-10-17-p5-virtual-clock.md`):
- **The window:** each page renders in its own sandboxed offscreen window. It is transparent and
  never shown, `offscreen: true`, at 240 Hz.
- **The clock:** it is injected before the page's scripts (CDP `Page.addScriptToEvaluateOnNewDocument`,
  after `about:blank`).
- **Stepping:** `__cuttleAdvance` answers after two real browser frames.
- **The frame:** it comes from the window's `paint` event; a marker pixel below the page proves
  which frame it is. Empty paints are ignored.
- **Speed and determinism:** 11.75 ms a frame at 640×360 in the spike, and the same frame byte for
byte at any rate.

- **Export:** the main process runs a `MotionRenderer` per item. It hands the frames (BGRA with
  alpha) to the export page, which uploads them as textures. The engine composites them:
  - a scene fills the frame;
  - an overlay goes over the finished frame, after zooms, masks and the cursor, before captions;
  - a transition takes the place of the crossfade.

  Items render ahead of the frame loop in parallel windows (at most two at a time).
- **Preview:** the editor uses the same renderer, so what it shows is what the export makes.
  - Frames are streamed into the player at its clock.
  - A seek renders the page from its start up to the time without painting (stepping is cheap; the
    paint is the cost).
  - Rendered frames are cached per item, so playing again is free; an edit, a param or a changed file
    clears the cache.
- **Thumbnails:** the timeline's motion blocks show frames from the same renderer.
- **Limits:** a frame that takes more than 2 s fails the item with the page's own error. The
  console goes to the editor and to `cuttle motion check`.

## Safety

- **Isolation:** pages run sandboxed, without Node, with `contextIsolation`. They are served from
  a protocol of their own that reaches only the project's files and the kit.
- **No network:** a Content Security Policy refuses every connection and every outside URL.
  `"network": true` on an item allows `https:`, after the person switches it on in the editor
  (off by default).
- **Never shown:** no window ever shows; the windows are offscreen.

## The kit, offline

Bundled with the app and the CLI, served at `cuttle:kit/…`:
- **Three.js** (MIT), for 3D.
- **lottie-web** (MIT), for After Effects animations exported as Lottie.
- **A small tween and stagger helper of Cuttle's own**, written on the Web Animations API (so
  nothing is needed for most motion). GSAP's license allows free use but limits redistribution in a
  tool; it is not bundled, and a page may load it from the project if the person adds it.
- **Fonts:** Inter (there already) and a monospace font (JetBrains Mono, OFL) for code.

## Templates (`cuttle motion new <template>`)

P5-M1 ships the ones that show the contract; P5-M2 adds the brand kit's set.
- `title`: kinetic intro text, the theme's font and colours.
- `end-card`: logo, line, URL, call to action.
- `lower-third`: a name and a role, over a clip.
- `click-callouts` (overlay): a ring and a label at every click the video shows, from
  `cuttle.take.events`.
- `kinetic-captions` (overlay): the spoken words, word by word, from `cuttle.take.words`.
- `device-3d` (scene): a phone or laptop in Three.js whose screen plays the take
  (`cuttle.take.frame`), turning in.
- `code-typing` (scene): a syntax-highlighted file that types itself, or a diff.
- `fold` (transition): the outgoing frame folds away in 3D, onto the incoming one.

## In the editor

- **Timeline:** motion scenes are blocks in the video lane with thumbnails. Overlays get a lane of
  their own ("Motion") and are dragged and trimmed as texts are; transitions show on the cut
  between scenes.
- **Inspector:**
  - the params form (with the colour and image pickers);
  - the duration;
  - "Open the page" (in the person's editor);
  - "Reload";
  - the page's console errors;
  - the network switch.
- **Live:** a change to the page's files (Claude editing it) reloads the item in the preview at
  once.
- **Adding:** "+ Motion" adds from the templates.

## For Claude

- **CLI:**
  - `cuttle motion new <template> [--name]` copies a template into `motion/<name>/` and adds it to
    `cuttle.json` (a scene at the end, or an overlay with `--at`).
  - `cuttle motion check <src>` renders a few frames, writes a contact sheet and lists the page's
    errors and console.
  - `cuttle preview` and `cuttle render` draw motion like everything else.
- **Skill:** an authoring guide:
  - the contract;
  - `onFrame` over free-running animation when it matters;
  - the take API with examples (a callout at each click, a word on each spoken word, the 3D screen);
  - checking with `motion check` and `preview --at`;
  - the size and format rules (9:16);
  - no network.

## Milestones

| Milestone | Content | Done when |
|---|---|---|
| P5-M1a | Format (`motion` scenes, `overlays`, transitions), the runtime script and virtual clock, the `MotionRenderer` (offscreen, marker, alpha), the export compositing, `cuttle motion check`, `cuttle preview`/`render` | A fixture page with CSS, WAAPI, rAF, canvas and timers renders the same frames twice, with alpha; golden frames of a scene, an overlay and a transition |
| P5-M1b | The take API (`cuttle.take`: events, words, markers, zooms, converters, `cursorAt`, `frame(t)`), the kit (Three.js, lottie-web, the tween helper, fonts), templates (title, end card, lower third, click callouts, kinetic captions, device 3D, code typing, fold), `cuttle motion new`, the skill's guide | Each template renders against the demo take; the callouts land on the take's clicks |
| P5-M1c | The editor: blocks, thumbnails, the Motion lane, the params form, live reload, the frame cache, "+ Motion", the network switch, console errors | app:check adds a template, changes a param, sees the frame change, and exports |

After them, the roadmap goes on: P5-M2 (templates and the brand kit, more backgrounds and device
frames), P5-M3 (script and teleprompter) and so on.

## Decisions for the user

1. **Downloads for the kit.** Bundling Three.js, lottie-web and JetBrains Mono means downloading
   them as dependencies (npm, about 2 MB). They are MIT and OFL licensed. Is that all right?
2. **GSAP** is left out (see the kit). Pages can still use it from the project.
3. **Preview from the renderer** rather than a live iframe: a little slower on the first play of
   an item, but the editor and the export always match. (A live iframe is faster but would differ
   for transitions and with masks over overlays.)

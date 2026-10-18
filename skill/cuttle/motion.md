# Motion: videos written in code

A motion item is a web page that Cuttle renders frame by frame into the video. Anything a browser
draws can be in it: kinetic type, shapes and patterns, a chart that builds, particles, a 3D scene,
an After Effects animation (Lottie), a code editor that types itself. You are free in what you make
and how: the templates are only starting points, and a page can be plain HTML and CSS, a canvas,
SVG, WebGL, Three.js or all of them at once. Make it look like the work of a great motion designer.

## Two kinds of video

- **Over a recording:** motion scenes between the clips (an intro, a chapter card, an end card) and
  overlays over them (a lower third, callouts on the clicks, captions on the words).
- **Without a recording:** a promo, a showreel, an explainer made only of motion scenes. Run
  `cuttle init "<folder>"`, write the pages, add them as `motion` scenes, render. A project without
  clips needs no take.

## Make one

1. Write the page in the project: `motion/<name>/index.html`, with its scripts, images and data next
   to it (or shared, `motion/shared.js`, imported as `../shared.js`). Or start from a template:
   `cuttle -C "<project>" --json motion new <template>` (title, end-card, code-typing, lower-third,
   click-callouts, kinetic-captions; `cuttle --json motion templates` says what each shows); it
   copies the page and adds it to cuttle.json. Then change the copy as much as you like.
2. Add it (project.md has the fields): a scene,
   `{ "type": "motion", "id": "s9", "label": "Intro", "src": "motion/intro/index.html", "duration": 3 }`,
   or an overlay over the clips, `{ "id": "o1", "src": "motion/callouts/index.html", "at": 4, "duration": 20 }`.
3. Check it: `cuttle -C "<project>" --json motion check motion/<name>/index.html`. It renders eight
   frames into `preview/motion-<name>/` with a contact sheet, and lists the page's `errors` and
   `console`. A scene is checked on its own; an overlay over the video, where the video shows it.
   Read the sheet; fix every error; check single moments with `--at 0.4 --at 1.2` (seconds into it).
4. Look at it in the video with `cuttle preview --at …`, and render.

**With the project open in the Cuttle app,** the user watches you work: every page you save shows
in its editor at once (it plays and scrubs them as the export draws them), with what a page threw
and logged in its inspector, and they can change the params you declared there. So declare a param
for what they may want to set themselves (a text, a colour, a side), with a clear `label`; and say
which page you changed, so they can look. The app adds templates too (+ Motion): you may find a
page in `motion/` you did not write.

## The page's world

- **The clock is the video's.** `performance.now`, `Date`, `setTimeout`, `setInterval`,
  `requestAnimationFrame`, CSS animations and transitions and Web Animations follow the frame being
  drawn, from 0 at the item's start. `Math.random` is seeded per item: every render is the same.
- **Draw from time.** `cuttle.onFrame((t) => …)` runs before each frame (also after a jump). A page
  that sets everything from `t` there is right on every frame; free-running CSS animations work too,
  but keyframes you compute are easier to time. `import { at, ease, keys, stagger, split, typed,
  highlight, spring, random } from 'cuttle'` gives you easing, keyframes, staggering, text splitting,
  typing with a rhythm, syntax colours and springs, all as functions of time.
- **`window.cuttle`:** `time` and `duration` (the item's seconds), `videoTime` (the video's),
  `fps`, `size` (the output's pixels), `format` (`16:9`, `9:16`, `1:1`), `params`, `theme`,
  `ready(promise)` (the first frame waits for it: fonts, data, a model), and `take` (below).
- **Size:** the page is the output, one CSS pixel per pixel (1920×1080 for 16:9, 1080×1920 for
  9:16). Size things from the short side so one page works in every format:
  `--u: calc(100vmin / 1080)` and `font-size: calc(120 * var(--u))`. Canvases: `cuttle.size`.
- **Transparent by default.** Where a scene draws nothing, the look's background shows; an overlay
  shows the video there. A page cannot see the video behind it (no `backdrop-filter` on it).
- **Only the project's files**, by relative paths, and the kit; no network unless the item has
  `"network": true`. Image params are paths in the project folder: use them as `/<path>`.
- **Silent:** pages make no sound (sounds come with Cuttle's sound items).

## The kit (no network needed)

- `import * as THREE from 'three'` and its addons, `import { RoundedBoxGeometry } from
  'three/addons/geometries/RoundedBoxGeometry.js'`; create the renderer with
  `preserveDrawingBuffer: true` and `setPixelRatio(1)`, and render in `onFrame`.
- `import lottie from 'lottie-web'`: load with `autoplay: false`, then `goToAndStop(t * 1000)` in
  `onFrame`.
- Fonts, ready in every page: `Inter` (the theme's `--cuttle-font`), `JetBrains Mono`
  (`--cuttle-mono`), `Archivo` (variable weight 100–900 and width: `font-stretch` 62% condensed to
  125% expanded, animatable), `Space Grotesk`, `Bebas Neue`, `Fraunces` (a variable display serif)
  and `Instrument Serif` (upright and italic). Call `cuttle.ready(document.fonts.load('900 200px
  Archivo'))` before you measure text.
- The theme as CSS variables: `--cuttle-accent`, `--cuttle-bg`, `--cuttle-fg`, `--cuttle-font`,
  `--cuttle-mono`. Use them to match the project's look, or set your own palette.

## The take (overlays over a recording)

`cuttle.take` holds the recording in source seconds and source pixels: `events` (`click` with `x`,
`y`, `button`; `keys` counts; `scroll`; `move`), `clicks`, `words` (the transcript), `markers`
(Claude's prompt, tools, answer), `zooms`, `masks`, `screen` (its size) and `window` (the overlay's
stretch). To place things on the video:
- `take.toOutput(source)` is where a moment plays in the video (compare with `cuttle.videoTime`);
  `take.toSource(output)` the other way.
- `take.toScreen(x, y)` is where a point of the recording is in this frame, with the window frame,
  the crop and the zoom (`{ x, y, inside }`, null in a scene); `take.cursor` is the pointer there.
- `take.cursorAt(source)` is the pointer's path at any moment.

```js
// a ring at each click, on the click, as the video plays it
cuttle.onFrame(() => {
  for (const click of cuttle.take.clicks) {
    const shown = cuttle.take.toOutput(click.t);
    const age = shown === null ? -1 : cuttle.videoTime - shown;
    const point = cuttle.take.toScreen(click.x, click.y);
    if (age >= 0 && age < 1 && point?.inside) drawRing(point.x, point.y, age);
  }
});
```

## Motion that feels designed

- Hard cuts between full scenes are strong (set `look.transition.enabled: false` for a reel);
  crossfades suit calmer videos.
- Give fast motion **motion blur**: `"motionBlur": { "samples": 8, "shutter": 0.5 }` on the item
  renders 8 moments per frame while the shutter is open (8× the time) and averages them.
- Ease everything (`ease.outExpo` in, `ease.in` out), stagger groups, let shapes overshoot
  (`spring`, `ease.outBack`), animate type on the width and weight axes, and match exits to the
  next scene's entrance (a shape that grows to fill the frame in the next scene's colour).
- `output.fps` may be 60 for very smooth motion (twice the frames to render).
- Keep the DOM light per frame; draw particles and patterns on a canvas; reuse geometry in Three.js.

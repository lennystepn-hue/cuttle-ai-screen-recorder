# Motion: videos written in code

A motion item is a web page that Cuttle renders frame by frame into the video. Anything a browser
draws can be in it: kinetic type, shapes and patterns, a chart that builds, particles, a 3D scene,
an After Effects animation (Lottie), a code editor that types itself. You are free in what you make
and how: the templates are only starting points, and a page can be plain HTML and CSS, a canvas,
SVG, WebGL, Three.js or all of them at once. Make it look like the work of a great motion designer.

## Two kinds of video

- **Over a recording:** motion scenes between the clips (an intro, a chapter card, an end card),
  overlays over them (a lower third, callouts on the clicks, captions on the words), and
  transitions between scenes (a fold, a wipe, a zoom through) in place of the crossfade.
- **Without a recording:** a promo, a showreel, an explainer made only of motion scenes. Run
  `cuttle init "<folder>"`, write the pages, add them as `motion` scenes, render. A project without
  clips needs no take.

## Make one

1. Write the page in the project: `motion/<name>/index.html`, with its scripts, images and data next
   to it (or shared, `motion/shared.js`, imported as `../shared.js`). Or start from a template:
   `cuttle -C "<project>" --json motion new <template>` (title, end-card, code-typing, device-3d,
   fold, lower-third, click-callouts, kinetic-captions; `cuttle --json motion templates` says what
   each shows; a transition takes `--into <scene id>`); it
   copies the page and adds it to cuttle.json. Then change the copy as much as you like. Most
   templates make their sounds (a whoosh with the title, a pop on each callout, keys while code
   types); their `sounds` param switches them off.
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
  but keyframes you compute are easier to time. A draw may be `async` (it awaits a frame of the take):
  the frame waits for it. `import { at, ease, keys, stagger, split, typed,
  highlight, spring, random } from 'cuttle'` gives you easing, keyframes, staggering, text splitting,
  typing with a rhythm, syntax colours and springs, all as functions of time.
- **`window.cuttle`:** `time` and `duration` (the item's seconds), `videoTime` (the video's),
  `fps`, `size` (the output's pixels), `format` (`16:9`, `9:16`, `1:1`), `params`, `theme`,
  `ready(promise)` (the first frame waits for it: fonts, data, a model), `sound(…)` (below) and
  `take` (below).
- **Size:** the page is the output, one CSS pixel per pixel (1920×1080 for 16:9, 1080×1920 for
  9:16). Size things from the short side so one page works in every format:
  `--u: calc(100vmin / 1080)` and `font-size: calc(120 * var(--u))`. Canvases: `cuttle.size`.
- **Transparent by default.** Where a scene draws nothing, the look's background shows; an overlay
  shows the video there. A page cannot see the video behind it (no `backdrop-filter` on it).
- **Only the project's files**, by relative paths, and the kit; no network unless the item has
  `"network": true`. Image params are paths in the project folder: use them as `/<path>`.
- **Sound by asking:** a page plays nothing itself (no `<audio>`, no WebAudio); it asks Cuttle for
  sounds, which play with the project's (see below).

## Transitions between scenes

A transition is a page on the scene it leads into, `"transition": { "src": "motion/fold/index.html",
"duration": 0.9 }`. It plays around the cut, half before and half after, in place of the crossfade
(also with crossfades off). Each frame it is given the two scenes as the video draws them, the
look, the window and the cursor in:

- `cuttle.from` and `cuttle.to`: the outgoing and the incoming frame, `ImageBitmap`s at the output's
  size (a Three.js texture: `flipY = false`); new ones every frame, so do not close them;
- `cuttle.progress`: 0 to 1 through the transition.

Draw the whole frame from them: at 0 it should look like `from`, at 1 like `to`, so the cut is
seamless. `fold` turns the outgoing frame over its middle like a page. `motion check` shows a
transition in the video, between its two scenes. A first scene, or one right after a cut, has
nothing to go between. The editor shows a crossfade where a transition is, for now; the export
and `cuttle preview` draw the page.

## Sounds from the page

A page asks for its sounds where its motion happens, so they stay on it however the video is cut:

```js
cuttle.sound('whoosh', { at: 0.3 }); // 0.3 s into the item, at every showing of it
cuttle.sound('sounds/ding.wav', { at: 1.6, volume: 0.5 }); // a file of the project
for (const click of cuttle.take.clicks) {
  const shown = cuttle.take.toOutput(click.t);
  if (shown !== null) cuttle.sound('pop', { videoTime: shown, volume: 0.4 }); // a second of the video
}
```

- Names are the built-in sounds (`cuttle --json sound list`: whoosh, swoosh-in, riser, impact, pop,
  click, tick, ding, chime, success, type-burst, glitch …) or files of the project. `volume` is 0
  to 1 (`0.8`); without `at` or `videoTime`, the moment it is asked.
- Ask when the page loads (or before a `cuttle.ready` promise ends): Cuttle opens the page once,
  draws its first frame and reads what it asked for. A sound asked for later in `onFrame` is not
  heard. The same sound at the same moment counts once.
- They play under `look.audio.effectsVolume`, like the project's `sounds`, and not when
  `look.audio.effects` is off. `cuttle music check` renders them with the music; the editor plays
  them as you save the page.
- Time them to the motion: a whoosh peaks on its moment, a swoosh-in and a riser end on it, a pop or
  an impact starts on it. Two or three sounds an item are plenty; leave the quiet parts quiet.

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

## The take (what was recorded)

`cuttle.take` holds the recording in source seconds and source pixels: `events` (`click` with `x`,
`y`, `button`; `keys` counts; `scroll`; `move`), `clicks`, `words` (the transcript), `markers`
(Claude's prompt, tools, answer), `zooms`, `masks`, `screen` (its size) and `window` (the overlay's
stretch). To place things on the video:
- `take.toOutput(source)` is where a moment plays in the video (compare with `cuttle.videoTime`);
  `take.toSource(output)` the other way.
- `take.toScreen(x, y)` is where a point of the recording is in this frame, with the window frame,
  the crop and the zoom (`{ x, y, inside }`, null in a scene); `take.cursor` is the pointer there.
- `take.cursorAt(source)` is the pointer's path at any moment.
- `await take.frame(source, { width })` is the screen recording's frame at a source second, as an
  `ImageBitmap`, with the project's privacy masks painted over it: for a screen in 3D, a freeze, a
  lens, a wall of moments. Make the draw `async` and await it in `onFrame` (the frame waits for it);
  draw it (`drawImage`, a Three.js texture with `flipY = false`), then `close()` it. Frames read
  forward fastest; `width` (at most the recording's) keeps them light. The device-3d template plays
  the take on a laptop's screen this way, then flies into it.

```js
// a moment of the take, frozen and tilted in a scene of its own
cuttle.onFrame(async (t) => {
  const frame = await cuttle.take.frame(cuttle.take.clips[0].from + 2, { width: 1280 });
  g.clearRect(0, 0, w, h);
  g.setTransform(0.6, -0.08, 0.08, 0.6, w * 0.2, h * 0.25);
  g.drawImage(frame, 0, 0);
  frame.close();
});
```

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
  crossfades suit calmer videos; a transition page marks a real change (into the result, into
  the end card). One or two a video, not at every cut.
- Give fast motion **motion blur**: `"motionBlur": { "samples": 8, "shutter": 0.5 }` on the item
  renders 8 moments per frame while the shutter is open (8× the time) and averages them.
- Ease everything (`ease.outExpo` in, `ease.in` out), stagger groups, let shapes overshoot
  (`spring`, `ease.outBack`), animate type on the width and weight axes, and match exits to the
  next scene's entrance (a shape that grows to fill the frame in the next scene's colour).
- `output.fps` may be 60 for very smooth motion (twice the frames to render).
- Keep the DOM light per frame; draw particles and patterns on a canvas; reuse geometry in Three.js.

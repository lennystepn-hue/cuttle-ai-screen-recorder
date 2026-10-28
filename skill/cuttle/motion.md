# Motion: videos written in code

A motion item is a web page that Cuttle renders frame by frame into the video. Anything a browser
draws can be in it: kinetic type, shapes and patterns, a chart that builds, particles, a 3D scene,
an After Effects animation (Lottie), a code editor that types itself, the product's interface
rebuilt in HTML. **You write these pages.** The templates are examples, not the choice: read
them for technique, copy one to start fast, or write every page from nothing. A page can be plain
HTML and CSS, a canvas, SVG, WebGL, Three.js or all of them at once, as many as the video needs.
Make it look like the work of a great motion designer, and like this video's, not like a template.

## Two kinds of video

- **Over a recording:** motion scenes between the clips (an intro, a chapter card, an end card),
  overlays over them (a lower third, callouts on the clicks, captions on the words), and
  transitions between scenes (a fold, a wipe, a zoom through) in place of the crossfade.
- **Without a recording:** a promo, a showreel, an explainer made only of motion scenes. Run
  `cuttle init "<folder>"`, write the pages, add them as `motion` scenes, render. A project without
  clips needs no take.

## Make one

1. Write the page in the project: `motion/<name>/index.html`, with its scripts, images and data next
   to it (or shared, `motion/shared.js`, imported as `../shared.js`). The smallest page:

   ```html
   <!doctype html>
   <style>
     :root { --u: calc(100vmin / 1080); }
     body { margin: 0; height: 100vh; display: grid; place-items: center; color: var(--cuttle-fg);
            font: 800 calc(140 * var(--u)) var(--cuttle-display); }
   </style>
   <h1 id="title">Ship it.</h1>
   <script type="module">
     import { at, ease } from 'cuttle';
     const title = document.getElementById('title');
     cuttle.onFrame((t) => {
       const shown = at(t, 0.2, 0.8, ease.outExpo);
       title.style.opacity = shown;
       title.style.transform = `translateY(${(1 - shown) * 60}px)`;
     });
   </script>
   ```

   Or start from a template: `cuttle -C "<project>" --json motion new <template>` (title, end-card,
   code-typing, device-3d, lower-third, click-callouts, kinetic-captions, and the transitions below;
   `cuttle --json motion templates` says what each shows; a transition takes `--into <scene id>`)
   copies the page and adds it to cuttle.json. Then change the copy as much as you like. Most
   templates make their sounds (a whoosh with the title, a pop on each callout, keys while code
   types); their `sounds` param switches them off.
2. Add a page you wrote: `cuttle -C "<project>" --json motion add motion/<name>/index.html` makes it
   a scene at the end (`--first`, `--after <scene>`, `--duration 4`, `--label "Intro"`);
   `--as overlay --at <source s> --duration <s>` puts it over the clips, `--as transition --into
   <scene>` makes it the way into a scene. Or write the item into cuttle.json yourself (project.md
   has the fields): a scene,
   `{ "type": "motion", "id": "s9", "label": "Intro", "src": "motion/intro/index.html", "duration": 3 }`,
   or an overlay over the clips, `{ "id": "o1", "src": "motion/callouts/index.html", "at": 4, "duration": 20 }`.
3. Check it: `cuttle -C "<project>" --json motion check motion/<name>/index.html`. It renders eight
   frames into `preview/motion-<name>/` with a contact sheet, and lists the page's `errors` and
   `console`. A scene is checked on its own; an overlay over the video, where the video shows it.
   Read the sheet; fix every error; check single moments with `--at 0.4 --at 1.2` (seconds into it).
   `cuttle -C "<project>" --json watch`, left running, checks each page again as you save it.
4. Look at it in the video with `cuttle preview --at …`, and render.

**With the project open in the Cuttle app,** the user watches you work: every page you save shows
in its editor at once (it plays and scrubs them as the export draws them), with what a page threw
and logged in its inspector, and they can change the params you declared there. So declare a param
for what they may want to set themselves (a text, a colour, a side), with a clear `label`; and say
which page you changed, so they can look. The app adds templates too (+ Motion): you may find a
page in `motion/` you did not write.

## Pages of your own, as many as the video needs

- **One design for the whole video:** a `motion/shared.css` and `motion/shared.js` (palette, type
  scale, easing curves, the background, the logo's mark, helpers you write) that every page imports,
  so the scenes read as one film.
- **Generate pages:** a script you write (Node, Python, anything) may write many pages from data:
  one scene per feature, per changelog entry, per number, per quote. Add each with `motion add`.
- **Real content:** a page reads the project's files (`fetch('./data.json')`, images as
  `/brand/logo.svg`): put the real numbers, texts and screenshots there. `cuttle capture-page
  <url or file>` turns a web page, also one you wrote, into a PNG in `stills/` for a page to use.
- **Rebuild instead of record:** the product's interface, a terminal, a chat, a dashboard can be
  rebuilt in HTML and animated exactly: perfect text, any size, no private data to mask.
- **Mix:** pages between clips, over them, and as the way between scenes; `card` and `still` scenes
  and recorded clips in the same video.

## Blocks from open collections

A beat that needs one thing done really well (a bar chart race, an extruded 3D logo, a shader
dissolve, a carousel, a camera move, a Lottie character) may start from what others made:

```bash
cuttle --json blocks search chart race            # HyperFrames' registry: about 200 blocks, best first
cuttle -C "<project>" --json blocks show bar-chart-race   # its preview picture, its params
cuttle -C "<project>" --json blocks add bar-chart-race --after s2
cuttle -C "<project>" --json blocks add https://lottie.host/<id>/<name>.json   # a Lottie animation
cuttle --json blocks search rocket --source icons           # Iconify's sets, then blocks add icons:ph:rocket-launch
```

`blocks add` brings a block into `motion/<name>/` with what its page loads from the network
(GSAP, Google Fonts, modules; Three.js is the kit's own): it renders offline and the same every
time. The block's variables become the item's params (the app's inspector shows them), `fit` says
how its 1920×1080 frame sits in the format (`contain` or `cover`), and its timeline follows the
video's clock. A Lottie JSON (LottieFiles' free animations: the "Lottie JSON" link on its page)
becomes a page that plays it (`loop`, `speed`, `start`, `fit`); an icon of Iconify's becomes
`media/icons/<set>-<name>.svg`. Where each came from and its licence go into `credits.json` and
`CREDITS.md`: say them to the user. Look at a block before you bring it in, then make it this
video's own (its params, colours, type, timing); a block left as it came is a template by another
name. `blocks search --tag transition` (or `chart`, `title`, `3d`, `code`, `camera`) narrows the list.

## The page's world

- **The clock is the video's.** `performance.now`, `Date`, `setTimeout`, `setInterval`,
  `requestAnimationFrame`, CSS animations and transitions and Web Animations follow the frame being
  drawn, from 0 at the item's start. `Math.random` is seeded per item: every render is the same.
- **Draw from time.** `cuttle.onFrame((t) => …)` runs before each frame (also after a jump). A page
  that sets everything from `t` there is right on every frame; free-running CSS animations work too,
  but keyframes you compute are easier to time. A draw may be `async` (it awaits a frame of the take):
  the frame waits for it. `import { at, ease, keys, stagger, split, typed,
  highlight, spring, random, frameAt } from 'cuttle'` gives you easing, keyframes, staggering, text
  splitting, typing with a rhythm, syntax colours, springs and frame numbers, all as functions of time.
- **`window.cuttle`:** `time` and `duration` (the item's seconds), `videoTime` (the video's),
  `fps`, `size` (the output's pixels), `format` (`16:9`, `9:16`, `1:1`), `params`, `theme`,
  `ready(promise)` (the first frame waits for it: fonts, data, a model), `sound(…)` (below),
  `video(src)` and `take` (below).
- **A video in the page, frame by frame:** `const clip = cuttle.video('/clips/intro.mp4')` (a path
  from the page, or from the project with a leading `/`) reads it in a worker of its own;
  `await clip.frame(seconds)` is the frame the file shows at that second, an ImageBitmap to draw
  (close it after). So `clip.frame(t - 1.2)` plays it from 1.2 s on, each frame once. A `<video>`
  element does not follow the page's clock. For a sequence of images, `frameAt(t, { start, fps,
  count })` says which one shows: `Math.floor((t - start) * fps)` alone lands just below a whole
  number now and then, which shows one image twice and skips the next.
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
seamless. `motion check` shows a transition in the video, between its two scenes. A first scene, or
one right after a cut, has nothing to go between. The export, `cuttle preview` and the Cuttle app
draw the page (the app makes its frames a moment after an edit, and crossfades until then).

The kit's transitions, each `motion new <name> --into <scene id>` with its params and its sound:
`fold` (a page turned over in 3D), `wipe` (a tilted edge, soft or hard, an accent line; `direction`,
`softness`, `angle`), `zoom` (a rush into a point in a zoom blur; `x`, `y`, `strength`), `whip` (a
whip pan, both frames smeared; `direction`, `blur`), `push` (the new frame pushes the old one out,
which sinks into its shadow), `iris` (a circle opens from a point: the button that was clicked;
`x`, `y`), `glitch` (bands, split colours, scan lines), `pixels` (blocks to the cut and back),
`liquid` (melts away in waves of noise), `flood` (a colour floods out from a point and opens onto the
next scene; `color`, `x`, `y`) and `burn` (burns away like paper, a glowing edge). Pick the one the
cut has a cause for (story.md): an iris from the click, a zoom into the button, a flood in the
brand's colour; a whip or a glitch on the beat. All but the fold are drawn with `cuttle/shader`
(below): a copy is a short page to change, or the start of a transition of your own.

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
- **Timelines** for choreography: anime.js, `import { createTimeline, stagger, svg } from 'animejs'`
  (its timelines, staggers, springs, SVG line drawing with `svg.createDrawable` and shape morphing
  with `svg.morphTo`). Hand each timeline to the video's clock and build it the way you think about
  it, in labels and overlaps rather than in sums of seconds:

  ```js
  import { createTimeline, stagger } from 'animejs';
  const tl = cuttle.timeline(createTimeline({ autoplay: false, defaults: { ease: 'outExpo', duration: 700 } }));
  tl.add('.word', { y: ['0.6em', 0], opacity: [0, 1], delay: stagger(70) }, 200)
    .add('.line', { scaleX: [0, 1], duration: 500 }, '-=400')
    .add('.card', { x: ['-110vw', 0], ease: 'inOutQuart', duration: 900 }, 1600);
  ```

  `cuttle.timeline(timeline, { at })` pauses it and sets it to the frame's time before every frame
  (also after a jump), `at` seconds into the item being its start. It takes an anime.js timeline or
  animation, a GSAP timeline or tween (GSAP is not in the kit: its licence is its own; a page may
  bring a copy of it as a file of the project), a Web Animation (`element.animate(…)`) or a function
  of seconds. Pages written for HyperFrames, whose paused timelines sit in `window.__timelines`,
  play as they are. Tweens a page starts on no timeline it hands over follow the clock too, but only
  a handed timeline lands exactly on a frame after a jump.
- **Shaders** in a few lines: `import { shader } from 'cuttle/shader'`. A canvas fills the page and
  runs your `vec4 effect(vec2 uv)` for every pixel of every frame (`uv` from 0,0 at the top left),
  with `time`, `progress`, `resolution`, `aspect`, the theme's `accent`, `fg` and `bg`, a
  transition's `fromColor(uv)` and `toColor(uv)`, uniforms of your own (`set(name, value)` changes
  them) and a library: `noise`, `gnoise`, `fbm` (2D and 3D), `curl`, `grain`, `vignette`,
  `halftone`, `bayer` (dithering), `grade`, `luma`, `rotate` and easing (`inOutCubic`, `outExpo`…).
  A moving ground, grain over a scene, a halftone or risograph treatment, a transition: GLSL's
  errors come back with the effect's own line numbers. `GLSL` is the library as text, for a
  Three.js `ShaderMaterial` of your own.

  ```js
  import { shader } from 'cuttle/shader';
  shader(`vec4 effect(vec2 uv) {
    float n = fbm(vec3(uv * vec2(aspect, 1.0) * 2.5, time * 0.15));
    vec3 c = mix(bg, accent, smoothstep(0.35, 0.75, n)) + 0.06 * grain(uv, time);
    return vec4(c * vignette(uv, 0.35), 1.0);
  }`);
  ```
- **Icons**: about 2,000 of Lucide's, as SVG, `import { icon, iconImage } from 'cuttle/icons'`:
  `cuttle.ready(icon('rocket', { size: 180, color: 'var(--cuttle-accent)', stroke: 1.5 }).then((svg) =>
  stage.append(svg)))`; `iconImage(name, options)` is one to draw on a canvas or as a texture. Find a
  name by what it shows: `cuttle --json motion icons rocket launch`. A real icon reads at once where
  a circle with a letter does not.
- Fonts, ready in every page: `Inter` (the theme's `--cuttle-font`), `JetBrains Mono`
  (`--cuttle-mono`), `Archivo` (variable weight 100–900 and width: `font-stretch` 62% condensed to
  125% expanded, animatable), `Space Grotesk`, `Bebas Neue`, `Fraunces` (a variable display serif)
  and `Instrument Serif` (upright and italic); and faces with more character: `Syne` (400–800, wide
  and odd at its heavy end), `Unbounded` (200–900, round and wide), `Anton` (tall poster capitals),
  `Bricolage Grotesque` (200–800, `font-stretch` 75–100%), `Big Shoulders Display` (100–900,
  condensed signage), `DM Serif Display` and `Playfair Display` (high-contrast serifs, upright and
  italic), `Space Mono` (400 and 700, italic too), `Rubik Mono One` (heavy rounded capitals) and
  `Caveat` (handwriting, 400–700). Pick the face from the video's look (story.md), not the first in
  the list. Call `cuttle.ready(document.fonts.load('900 200px Archivo'))` before you measure text.
- The theme, the project's brand (project.md, `theme`), as CSS variables: `--cuttle-accent`,
  `--cuttle-bg`, `--cuttle-fg`, `--cuttle-font`, `--cuttle-display` (the brand's heading font),
  `--cuttle-mono`; and `cuttle.theme.name`, `url`, `logo` (a URL, or `""`) and `font`. Use them so
  one brand set once reaches every page: headings in `var(--cuttle-display)`, loaded with
  ``document.fonts.load(`800 100px "${cuttle.theme.font}"`)``, with `font-synthesis: none` (Bebas Neue
  and Instrument Serif have one weight: they are not made bold); the name, URL and logo where a param
  is left empty, as the templates do. Or set your own palette where the page asks for one.

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

What the video is comes first ([story.md](story.md)); these are the numbers for how it moves. They
are defaults: a reference the person gave, or a moment that breaks them on purpose, wins.

- **One hero move a shot.** Secondary moves travel about half as far and start 0.1–0.2 s after it;
  everything else holds still.
- **Arrive slow, leave clean.** An entrance lands on a long ease-out (`ease.outExpo`,
  `ease.outQuint`) over 0.5–0.9 s; an exit takes about half as long on an ease-in (`ease.in`), in
  one motion, never slide, stop, then leave. A camera move or a colour flood eases both ways
  (`ease.inOut`); linear only for what is constant (a rotation, a ticker, a progress bar). One curve
  and one duration on everything is what makes a video look generated.
- **Overlap.** The next element starts when the one before is a third to half done. Stagger
  letters about 0.03 s apart (a frame), words 0.06–0.12 s, the items of a list 0.04–0.08 s
  (`stagger`).
- **Springs** (`spring(seconds, { stiffness, damping, mass })`): the default (stiffness 170,
  damping 20, a damping ratio of about 0.77) settles calmly; a damping of about 12 is playful; about
  26 does not bounce. Position and scale may overshoot; opacity and colour never do.
- **Titles land, then stay still**: the motion moves on to the next element, the camera or the
  world behind. Vary how titles come in within a video: per word out of a blur without moving, per
  word from a light grey into the ink, a mask that wipes the line in, a stamp (from 1.15 to 1 in two
  frames, with a hit), letter by letter for a name, one word rolling through options like a slot
  machine. Never the same entrance in every scene.
- **Holds.** A line the viewer must read stays 0.5 s plus 0.3 s a word; the video's last line at
  least 2 s. Too many words: cut words, never shrink the type.
- **Sizes.** Text to be read is at least 2.6 % of the short side (`calc(28 * var(--u))`, 28 px at
  1080). The hero of a shot fills at least 40 % of the frame's width or height: a small thing alone
  in the middle of an empty frame is not a shot; push in, crop, or give it a world.
- **Pace.** Something new every 2–4 s; with music, a new layout on the bar. Contrast the speeds:
  quick cuts through the work, a breath of 0.3–0.7 s before the payoff, the payoff at normal speed.
- **Cuts.** Cut on the fastest frame of a move, with the same direction and speed on both sides: a
  page that ends in motion hands it to the next. Hard cuts between full scenes are strong (set
  `look.transition.enabled: false` for a reel); crossfades suit calmer videos.
- **Transitions with a cause.** Hand over in three to five ways across a video, each caused by
  something on screen: a match cut, a shape that grows into the next ground, a colour flood, an
  iris that opens from the click, a whip with motion blur. A transition page marks the one or two
  real changes (into the result, into the end card), never every cut.
- Give fast motion **motion blur**: `"motionBlur": { "samples": 8, "shutter": 0.5 }` on the item
  renders 8 moments per frame while the shutter is open (8× the time) and averages them.
- Let shapes overshoot (`spring`, `ease.outBack`), animate type on the width and weight axes, and
  match exits to the next scene's entrance (a shape that grows to fill the frame in the next scene's
  colour).
- `output.fps` may be 60 for very smooth motion (twice the frames to render).
- Keep the DOM light per frame; draw particles and patterns on a canvas; reuse geometry in Three.js.

When it does not work:

- **It feels like slides**: enter the next scene through something on screen, and cut in the middle
  of a move instead of after it settles.
- **It is too busy**: take out a third of the motion and keep the moves that lead the eye.
- **The titles feel cheap**: land them and hold them still, give each its own entrance, and put one
  word in the accent colour, not three.
- **It is too fast**: slow the camera's moves to about 0.7 of their speed, and nothing else.

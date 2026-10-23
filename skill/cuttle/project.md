# cuttle.json reference

`cuttle.json` is the only file to edit. `cuttle record` (or `cuttle import`) and `cuttle suggest`
write it, you refine it by hand, check it with `cuttle preview` and export it with `cuttle render`.
Unknown fields are errors, and every command names the path of a problem, counting from 0
(`scenes[1].to: "to" must be greater than "from"`). A clip must end inside the take.

## Times and pixels

- **Source seconds** are seconds of the take's screen track (`takes/<n>/screen.mp4`). Scenes cut
  and speed them up. `zooms`, `masks`, `texts`, motion `overlays` and `sounds` use source seconds too, so
  they stay on their content; they show only while a clip scene covers that source time. In a clip at speed `s`, `d`
  source seconds last `d / s` output seconds: a 3 s caption over a 12× clip is on screen for a
  quarter second, so give it `"duration": 36` there.
- **Output seconds** are seconds of the rendered video. `cuttle preview --at` and the times on the
  contact sheet are output seconds; each still in `preview`'s JSON also has the `source` second it
  shows.
- **Rects** are `[x, y, width, height]` in pixels of the screen track (the recorded monitor, region
  or window, e.g. 2560×1440), not of the output.

## A complete example

```json
{
  "version": 1,
  "output": { "width": 1920, "height": 1080, "fps": 30 },
  "sources": {
    "screen": "takes/1/screen.mp4",
    "mic": "takes/1/mic.m4a",
    "system": "takes/1/system.m4a",
    "events": "takes/1/events.jsonl",
    "markers": "takes/1/markers.json",
    "transcript": "takes/1/transcript.json",
    "cleanMic": "takes/1/mic.clean.m4a"
  },
  "look": {
    "background": { "preset": "sunset-sky" },
    "frame": { "style": "mac-dark", "title": "claude · ~/demo" },
    "cursor": { "style": "system" }
  },
  "scenes": [
    { "type": "motion", "id": "s0", "label": "Intro", "src": "motion/intro/index.html", "duration": 2.5, "params": { "title": "One prompt" } },
    { "type": "clip", "id": "s1", "label": "Prompt", "from": 1.2, "to": 7.5 },
    { "type": "clip", "id": "s2", "label": "Claude at work", "from": 7.5, "to": 120.4, "speed": 12 },
    { "type": "clip", "id": "s3", "label": "Answer", "from": 120.4, "to": 128 },
    { "type": "still", "image": "stills/example-com.png", "duration": 5, "motion": "scroll", "frame": "browser-light" },
    { "type": "card", "title": "Built with Claude Code", "subtitle": "example.com", "duration": 2.5 }
  ],
  "zooms": [{ "id": "z1", "label": "Answer", "at": 121, "duration": 4, "rect": [0, 600, 1400, 788] }],
  "masks": [{ "from": 0, "to": 128, "rect": [2200, 0, 360, 40], "style": "fill" }],
  "texts": [{ "at": 2, "duration": 3, "text": "One prompt", "style": "pill", "position": "bottom" }],
  "overlays": [{ "id": "o1", "label": "Callout", "src": "motion/callout/index.html", "at": 121, "duration": 4 }],
  "music": { "src": "music/pulse/index.html", "params": { "key": "E" }, "volume": 0.7 },
  "sounds": [{ "id": "a1", "sound": "whoosh", "at": 120.3 }]
}
```

## Fields

`output`: `width` and `height` (even, at most 4096; default 1920×1080) and `fps` (default 30).
`cuttle render --format` overrides the size: `16:9` is 1920×1080, `1:1` is 1080×1080, `9:16` is
1080×1920.

`sources`: paths relative to the project folder. `cuttle record` sets them; `transcript` is set
once the mic was transcribed (`cuttle transcribe`, or `suggest` with a speech model). Never edit
transcript.json: `{ "language", "model", "words": [{ "t", "end", "text" }], "sounds": [{ "t", "end" }] }`,
in source seconds; `sounds` are stretches the mic heard without a word (a cough, a dropped filler).
`cleanMic` is the mic cleaned up with it (less noise, even loudness), played instead of the mic
while `look.audio.cleanup` is on. `system` is what the computer played while the take recorded
(`record --system-audio`: its apps' sound, stereo; a window take on macOS hears the window's app
alone), cut and sped up with the clips like the mic. `screenText` is the screen's text, read where the picture
changed (`suggest`, on Windows): one JSON line per frame read,
`{ "t", "lines": [{ "text", "rect", "words": [{ "text", "rect" }] }] }`. Read it to find what the
screen showed where; never edit it.

`script`: the demo's steps, written before the take, at most 50:
`[{ "id": "step1", "title": "Open the settings", "note": "The gear, top right." }]`. `id` is
unique in the project (the app gives `step1`, `step2` …); `title` says in up to 80 characters what
the step shows; `note` (optional, up to 1000) is what to say, shown only in the app's prompter and
never in the video. A take starts at the first step; the step key (Ctrl+Shift+Alt+N, back
Ctrl+Shift+Alt+B) or the prompter's buttons move on, and each move is a `step` marker. The video's
chapters come from these markers: one where the video shows each step reached (a move undone
within 2 s is none; a step in a stretch that is cut starts where the video goes on), the first at
0, each named by its step's title. Fixing a title in `script` renames its chapter. `motion`
(optional: `lower-third` or `title`) draws the step's title with that template of the kit, as an
overlay; without it the title is a text. `suggest` makes the titles and a zoom on where each step
happens (below).

`look` (every field is optional):

| Field | Values (default first) |
|---|---|
| `background.preset` | `sunset-sky`, `aurora`, `mesh`, `solid` (needs `color`, e.g. `"#0c0c0c"`), `image` (needs `image`: a path; `blur` 0–1 softens it, `dim` 0–0.8 darkens it), `gradient` (needs `colors`: 2 to 4, first to last; `angle` as in CSS, `135` by default; `kind` `linear` or `radial`), and the quiet animated `flow`, `bokeh` and `dots`; `mesh`, `flow`, `bokeh` and `dots` take `colors` too (else their own) |
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `browser-dark`, `windows-light`, `windows-dark`, `terminal`, `none`; and the phones `iphone` and `android`, a bezel and a camera around the screen, for a tall recording of a phone or a narrow window), `title` (`""`), `radius` (`14`; not for the phones), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `keys` | `enabled` (`true`), `show` (`shortcuts`: keys pressed with ⌘ or Ctrl, on Windows also Alt or Win, as `⌘ ⇧ P` or `Ctrl Shift P`; `keys`: also Esc, Enter, Tab, the arrows, Home, End, Page Up and Down and F1–F12 pressed alone), `position` (`bottom`, `top`), `size` (`1`, 0.5 to 2): a badge of each shortcut pressed, as keycaps; the same one again within a second counts up (`⌘ Z ×3`); none in clips faster than 2×, clear of the webcam bubble and the subtitles |
| `webcam` | `enabled` (`false`; a take recorded with a camera switches it on), `shape` (`circle`, `rounded`, `squircle`, `square`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5), `position` (`{ x, y }`: the bubble's centre as a share of the video, 0–1; it replaces `corner`), `border` (`true`: a white ring), `shadow` (`true`), `mirror` (`false`: flipped left to right) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one), `typing` (`true`: a key click for each key typed, where the clip is heard), `typingVolume` (`0.5`, 0 to 1), `effects` (`true`: the `sounds` and the music page's effects), `effectsVolume` (`0.8`, 0 to 1), `system` (`true`: the computer's sound, `sources.system`, where the clip is heard), `systemVolume` (`0.8`, 0 to 1), `systemDuck` (`12`: dB it goes down under speech, as the music; 0 to 40, 0 leaves it) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |
| `motionBlur` | `0.25`: how long a frame's shutter is open, as a share of the frame (0 off, `0.25` light, `0.5` a film camera's, `1` strong); the screen smears along a zoom's moves and the pointer along its path, in clips up to 2× fast; masks cover every place they pass |
| `watermark` | `enabled` (`false`), `image` (a path; without it the brand's logo, `theme.logo`), `text` (shown without an image; without it the brand's name), `corner` (`bottom-right`, `bottom-left`, `top-left`, `top-right`), `size` (`0.06`: its height as a share of the short side, 0.02 to 0.3), `opacity` (`0.7`, 0.1 to 1): a mark over the whole video, clear of the webcam bubble |

`theme` is the project's brand, which its motion pages read (every field is optional): `name` and
`url` (the product's, for titles and end cards), `logo` (an image in the project, e.g.
`brand/logo.svg`: copy a file the user gives you into `brand/` first), `accent` (the brand's
colour; without it the cursor's), `foreground` (`#FFFFFF`: the text's), `background` (the tone pages
draw their own background in; without it a dark tone of the look's background), `font` (the
headings': `Archivo`, `Inter`, `Space Grotesk`, `Fraunces`, `Instrument Serif`, `Bebas Neue`) and
`kit` (the brand kit it came from). The title, end card, lower third and captions templates use it:
an empty title shows the name, and an end card without its own URL or logo shows the brand's.

**Brand kits** keep a brand for the next video:
- `cuttle --json brand list` lists them.
- `cuttle -C "<project>" --json brand save "<name>"` keeps the project's theme, background, frame
  style and cursor style and colour, with copies of the logo and background image.
- `cuttle -C "<project>" --json brand apply "<name>"` sets them and copies the files into `brand/`
  (cuttle.json.bak keeps the version before).
- `cuttle --json brand remove "<name>"` removes one.

When the user has kits, ask which one the video wears before you set the look by hand; the app's
Look tab applies them too.

Two clips where the second starts where the first ends (within 1 ms), as `suggest`'s speed-ups and
any split make, are one continuous piece: no crossfade, zooms and texts run on across the cut, and
the sound runs on where the speed stays the same (a speed change gets a 10 ms fade against clicks).

`frame.enabled: false` shows the screen alone, filling the output. A take recorded with
`--draw-mouse` has the real pointer in the video; `record` then sets `cursor.enabled` to `false`, so
there are not two cursors.

`scenes` play in order:

| Type | Fields |
|---|---|
| `clip` | `from`, `to` (source seconds, `to` > `from`), `speed` (`1`, up to 64; above 1 a badge like "12× speed" shows), `badge` (custom badge text, `""` for none), `crop` (`{ "rect": [x, y, w, h], "enabled": true }`: the part of the screen the clip shows, e.g. a browser's page without its tabs; the window takes its shape and zooms stay inside it; `suggest` makes it, tagged `auto: "crop"`, and cuts a clip where the content area changes for good) |
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`, `browser-dark`, `windows-light`, `windows-dark`, `terminal`, `iphone`, `android`: a phone frame suits a page captured at a phone's width) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |
| `motion` | `src` (an HTML page in the project, e.g. `motion/intro/index.html`), `duration` (output seconds), `params` (`{ "name": value }`: text, numbers, `true`/`false` or `null`, for the page), `network` (`false`; `true` lets the page load from https), `motionBlur` (`{ "samples": 8, "shutter": 0.5 }`: each frame the average of that many moments while a camera's shutter would be open, half a frame here; off without it): a page drawn frame by frame over the whole output, over the background where it is clear (see "Motion pages" and [motion.md](motion.md)) |

`zooms`: `at` and `duration` (source seconds), `rect`, `ease` (`smooth`, `linear`) and `enabled`
(`true`). The rect is widened to the screen's aspect and kept inside the screen. The zoom comes in
and goes out over 0.8 output seconds each where it starts and ends on screen, as a camera settles
(`smooth`: it sets off at once and slows into place, 95 % there after half a second; a cut into
its middle lands zoomed), so give it 2.5 output seconds or more (`2.5 × speed` source seconds over
a sped-up clip). A zoom that follows (a typing zoom from `suggest`) has `moves`: `[{ "at", "rect" }]`, each
`at` (source seconds) after the one before and inside the zoom. It starts on `rect` and goes to each
move's rect in turn, settling over 0.8 output seconds from 0.3 s before the move's `at` (three
quarters there at it). To move the whole path, change every rect by the same amount; without
`moves` it holds still.

`masks` hide private things: `from` and `to` (source seconds), `rect`, `style` (`fill`: the colour
around it, safest for tokens and keys; `blur`) and `enabled` (`true`). Make the rect generous: a
few pixels too small leaves letters readable. Masks cover clips only, not still scenes (a captured
page). A mask over text that scrolls has `moves` (`[{ "at", "rect" }]`, as a zoom's): its places
are `rect` at `from`, then each move's; between two places it covers both. `suggest` follows the
text in every frame: a place in each frame it moved, and the mask ends where the text left the
picture. `privacy.words` are
words masked wherever the screen shows them (`suggest --mask` adds to them).

`texts`: `at` and `duration` (source seconds), `text`, `style` (`pill`, `lower-third`, `caption`),
`position` (`top`, `center`, `bottom`) and `enabled` (`true`). A `top` text sits over the window's
title bar; `bottom` keeps the title visible. Texts fade in and out over 0.25 output seconds.

`overlays` are motion pages over the video: `src`, `at` and `duration` (source seconds, as a
text's), `params`, `network`, `motionBlur` and `enabled` (`true`). A page covers the whole output with its
transparency (a lower third, a callout, a logo), over the clip, its zooms, masks, cursor and texts,
and under the captions. Its clock runs in output seconds from where the video first shows its
stretch, across cuts and speed-ups; a clip shown twice shows it twice.

`captions`: the subtitles from the transcript (none without one). `enabled` (`true`), `style`
(`subtitle`: two lines on a dark box; `karaoke`: the spoken word in `color`; `bold`: a few big words),
`position` (`bottom`, `top`, `center`), `size` (`1`, 0.5 to 2), `color` (`#D97757`), and `fixes`:
`[{ "at", "end", "text" }]`, the words spoken in `[at, end)` (source seconds) read as `text`, `""`
for none. Take `at` and `end` from the words in transcript.json. Words in sped-up clips and in
cuts have no subtitle.

`cuts` take a stretch out of whatever clip covers it, without splitting the clip: `from` and `to`
(source seconds) and `enabled` (`true`). The video jumps there (no crossfade); zooms, masks and
texts run on across it. Use them for a slip, a filler or a pause inside a clip; `suggest` makes
them for slips ("Retake": the mistake key, or a spoken "nochmal" with the bit said again;
"Restart": a sentence begun again), filler words ("Filler: äh") and pauses ("Pause: 2.4 s") from
the transcript, each beginning and ending where the mic is quiet.

Every scene, zoom, mask, text, overlay and cut may have an `id` (1 to 64 letters, digits, `-` or `_`,
unique in the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest`
sets both on what it makes (`s1`, `z1`; "Prompt", "Claude at work", "Waiting", "Answer"). Keep
them when you edit an item; give a new item an id no other item uses (`s7`, `m2`, `c3`) and a
short label.

Every scene may also have a `transition`: the page it is gone into with, in place of the crossfade,
`{ "src": "motion/fold/index.html", "duration": 0.9 }` with `params`, `network` (`false`) and
`enabled` (`true`); `duration` (`0.8`, up to 4 s) is around the cut, half before and half after,
also with the look's crossfades off. [motion.md](motion.md) has how such a page is written.

**Automatic items.** Cuttle tags what it makes on its own with `auto` (on a zoom, mask, cut, text,
overlay or a clip's `crop`): `answer` and `click` zooms from `suggest`, and later `crop`, `privacy`,
`notification`, `retake`, `filler`, `pause`, `length`, `typing` and `dialog`; `title` (a
step's title: a text, or an overlay of its `motion` template) and `step` (a zoom on where a step
happens) from the script. A rerun replaces
only tagged items. **When you change a tagged item's time, place or size, remove its `auto`**: then
it is yours and the next `suggest` keeps it (switching it on or off keeps the tag). `autoEdits`
(`clickZooms`, `answerZoom`, `crop`, `privacy`, `retakes`, `fillers`, `pauses`, `typingZooms`,
`dialogZooms`, `stepTitles`, `stepZooms`: all `true`) holds which kinds are made at all; one set
to `false` is not made again.

## Music and sounds

`music` is the video's music: a page that composes it in WebAudio for this video
(`music/<name>/index.html`; [music.md](music.md) is the guide). `src`, `params` (`{ "name": value }`
for the page), `volume` (`0.8`, 0 to 1), `duck` (`12`: dB it goes down under speech; 0 not at all),
`network` (`false`) and `enabled` (`true`). It is rendered as long as the video and follows every
edit. Without `music` the video has none.

`sounds` are single sounds at moments: `sound` (a built-in sound, `cuttle sound list`, or a file of
the project: WAV, MP3, M4A, OGG, FLAC), `at` (source seconds: it plays wherever the video shows that
moment, and not where it is cut), or `scene` (a scene's id) with `at` seconds into that scene,
`volume` (`0.8`), `enabled` (`true`), and an `id` (`a1`) and `label`. Motion pages add their own
sounds as they render (`cuttle.sound`, motion.md); those are not in `sounds`.

## Motion pages

A motion scene, overlay or transition is a web page in the project folder, usually `motion/<name>/index.html`
with its own CSS, scripts, images and fonts next to it. Anything a browser draws works: HTML and
CSS, SVG, a canvas, WebGL, Three.js and Lottie from the kit. Cuttle renders it frame by frame, the
same in every render. [motion.md](motion.md) is the guide: the kit, the take as a page sees it
(`cuttle.take`), and how to make it look designed. A project of motion scenes only needs no
recording.

- **Its clock is the video's.** `performance.now`, `Date`, `setTimeout`, `setInterval`,
  `requestAnimationFrame`, CSS animations and transitions and Web Animations all follow the frame
  being drawn, from 0 at the item's start. `Math.random` is seeded per item. Ordinary animation
  code works as it is.
- **`window.cuttle`** (there before the page's scripts run): `time` (seconds into the item),
  `duration`, `fps`, `size` (`{ width, height }`: the output), `format` (`16:9`, `9:16`, `1:1`),
  `params` (the item's), `theme`, `onFrame((t) => …)` (called before each frame is drawn, also
  after a jump: draw everything from `t` there and the frame is always right), and
  `ready(promise)` (the first frame waits for it: data, a model, images it loads late; fonts and
  `<img>`s are waited for anyway).
- **The brand and the look** as CSS variables: `--cuttle-accent` (the brand's colour, else the
  cursor's), `--cuttle-bg`, `--cuttle-fg`, `--cuttle-font`, `--cuttle-display` (the brand's heading
  font), `--cuttle-mono`; and in `cuttle.theme`: `name`, `url`, `logo` (its URL in the page, or `""`)
  and `font`.
- **Transparent by default.** Where the page draws nothing, a scene shows the look's background and
  an overlay the video. A scene that wants its own background sets one on `body`.
- **The size is the output's**: 1920×1080 for 16:9, 1080×1920 for 9:16. Lay out in `%`, `vw` and
  `vh`, or from `cuttle.size`, so one page works in every format.
- **Only the project's files.** Load them by relative paths. Nothing else is reachable (no
  network, no other files) unless the item has `"network": true`.

```html
<!doctype html>
<style>
  body { margin: 0; display: grid; place-items: center; height: 100vh; font: 700 8vh var(--cuttle-font); color: var(--cuttle-fg); }
  h1 { animation: rise 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(6vh); } }
</style>
<h1 id="title"></h1>
<script>
  title.textContent = cuttle.params.title ?? 'Hello';
  cuttle.onFrame((t) => (title.style.opacity = String(Math.min(1, (cuttle.duration - t) / 0.4))));
</script>
```

## Finding source seconds and rects

- `cuttle --json preview` lists each still's `source` second next to its output second `t`.
- `cuttle --json frame <source second> --grid` writes that frame of the screen track at full size
  with a numbered grid every 100 pixels (stronger lines every 500). Read the PNG and take rects off
  the grid; `frames/<t>s-grid.png` is the default file.
- `takes/<n>/markers.json` lists the prompt, each tool call and Claude's answer in source seconds,
  each press of the mistake key (kind `retake`), and where the take reached each step of the
  script (kind `step`, labelled with the step's id; the first at 0).
- `takes/<n>/events.jsonl` has the input: `move`, `click` and `scroll` with `x` and `y`, `keys`
  (presses per half second, never which keys), `shortcut` with its `keys` as the system writes
  them (`["⌘", "⇧", "P"]`, `["Ctrl", "Shift", "P"]`: only keys pressed with ⌘ or Ctrl, on Windows
  also Alt or Win, and the keys that type nothing alone, Esc, Enter, the arrows; a letter typed is
  never named) and the pointer's `shape`. On Windows it also has
  facts about the screen: `caret` with a `rect` (where text is typed, while it is, where the app
  keeps a system caret), `area` with the `rect` of the content area of the window in front (a
  browser's page; `null` for none), and `window` when a `dialog` or `menu` opens or closes
  (`id`, `kind`, `rect`, `open`). No titles or text are logged.
- `cuttle --json suggest` prints notes with source seconds (`sped up 112.9 s without input 12×
  (7.5–120.4 s)`).
- To get from output to source seconds by hand, walk the scenes. A clip lasts
  `(to − from) / speed` output seconds and a still or card its `duration`; the video is their sum
  (a crossfade is centred on the boundary and does not shorten it). Inside a clip,
  source = `from + (output − scene start) × speed`.

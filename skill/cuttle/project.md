# cuttle.json reference

`cuttle.json` is the only file to edit. `cuttle record` and `cuttle suggest` write it, you refine
it by hand, check it with `cuttle preview` and export it with `cuttle render`. Unknown fields are
errors, and every command names the path of a problem, counting from 0
(`scenes[1].to: "to" must be greater than "from"`). A clip must end inside the take.

## Times and pixels

- **Source seconds** are seconds of the take's screen track (`takes/<n>/screen.mp4`). Scenes cut
  and speed them up. `zooms`, `masks` and `texts` use source seconds too, so they stay on their
  content; they show only while a clip scene covers that source time. In a clip at speed `s`, `d`
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
    { "type": "clip", "id": "s1", "label": "Prompt", "from": 1.2, "to": 7.5 },
    { "type": "clip", "id": "s2", "label": "Claude at work", "from": 7.5, "to": 120.4, "speed": 12 },
    { "type": "clip", "id": "s3", "label": "Answer", "from": 120.4, "to": 128 },
    { "type": "still", "image": "stills/example-com.png", "duration": 5, "motion": "scroll", "frame": "browser-light" },
    { "type": "card", "title": "Built with Claude Code", "subtitle": "example.com", "duration": 2.5 }
  ],
  "zooms": [{ "id": "z1", "label": "Answer", "at": 121, "duration": 4, "rect": [0, 600, 1400, 788] }],
  "masks": [{ "from": 0, "to": 128, "rect": [2200, 0, 360, 40], "style": "fill" }],
  "texts": [{ "at": 2, "duration": 3, "text": "One prompt", "style": "pill", "position": "bottom" }]
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
while `look.audio.cleanup` is on. `screenText` is the screen's text, read where the picture
changed (`suggest`, on Windows): one JSON line per frame read,
`{ "t", "lines": [{ "text", "rect", "words": [{ "text", "rect" }] }] }`. Read it to find what the
screen showed where; never edit it.

`look` (every field is optional):

| Field | Values (default first) |
|---|---|
| `background.preset` | `sunset-sky`, `aurora`, `mesh`, `solid` (needs `color`, e.g. `"#0c0c0c"`), `image` (needs `image`: a path) |
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`, `squircle`, `square`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5), `position` (`{ x, y }`: the bubble's centre as a share of the video, 0–1; it replaces `corner`), `border` (`true`: a white ring), `shadow` (`true`), `mirror` (`false`: flipped left to right) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one), `typing` (`true`: a key click for each key typed, where the clip is heard), `typingVolume` (`0.5`, 0 to 1) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

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
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |

`zooms`: `at` and `duration` (source seconds), `rect`, `ease` (`smooth`, `linear`) and `enabled`
(`true`). The rect is widened to the screen's aspect and kept inside the screen. The zoom eases in
and out over 0.6 output seconds each where it starts and ends on screen (a cut into its middle
lands zoomed), so give it 2 output seconds or more (`2 × speed` source seconds over a sped-up
clip). A zoom that follows (a typing zoom from `suggest`) has `moves`: `[{ "at", "rect" }]`, each
`at` (source seconds) after the one before and inside the zoom. It starts on `rect` and goes to each
move's rect in turn, eased over 0.6 output seconds centred on the move's `at`. To move the whole
path, change every rect by the same amount; without `moves` it holds still.

`masks` hide private things: `from` and `to` (source seconds), `rect`, `style` (`fill`: the colour
around it, safest for tokens and keys; `blur`) and `enabled` (`true`). Make the rect generous: a
few pixels too small leaves letters readable. Masks cover clips only, not still scenes (a captured
page). A mask over text that scrolls has `moves` (`[{ "at", "rect" }]`, as a zoom's): its places
are `rect` at `from`, then each move's; between two places it covers both. `privacy.words` are
words masked wherever the screen shows them (`suggest --mask` adds to them).

`texts`: `at` and `duration` (source seconds), `text`, `style` (`pill`, `lower-third`, `caption`),
`position` (`top`, `center`, `bottom`) and `enabled` (`true`). A `top` text sits over the window's
title bar; `bottom` keeps the title visible. Texts fade in and out over 0.25 output seconds.

`captions`: the subtitles from the transcript (none without one). `enabled` (`true`), `style`
(`subtitle`: two lines on a dark box; `karaoke`: the spoken word in `color`; `bold`: a few big words),
`position` (`bottom`, `top`, `center`), `size` (`1`, 0.5 to 2), `color` (`#D97757`), and `fixes`:
`[{ "at", "end", "text" }]`, the words spoken in `[at, end)` (source seconds) read as `text`, `""`
for none. Take `at` and `end` from the words in transcript.json. Words in sped-up clips and in
cuts have no subtitle.

`cuts` take a stretch out of whatever clip covers it, without splitting the clip: `from` and `to`
(source seconds) and `enabled` (`true`). The video jumps there (no crossfade); zooms, masks and
texts run on across it. Use them for a slip, a filler or a pause inside a clip; `suggest` makes
them for slips ("Retake": the mistake key, or a spoken "nochmal" with the bit said again), filler
words ("Filler: äh") and pauses ("Pause: 2.4 s") from the transcript.

Every scene, zoom, mask, text and cut may have an `id` (1 to 64 letters, digits, `-` or `_`,
unique in the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest`
sets both on what it makes (`s1`, `z1`; "Prompt", "Claude at work", "Waiting", "Answer"). Keep
them when you edit an item; give a new item an id no other item uses (`s7`, `m2`, `c3`) and a
short label.

**Automatic items.** Cuttle tags what it makes on its own with `auto` (on a zoom, mask, cut or a
clip's `crop`): `answer` and `click` zooms from `suggest`, and later `crop`, `privacy`,
`notification`, `retake`, `filler`, `pause`, `length`, `typing` and `dialog`. A rerun replaces
only tagged items. **When you change a tagged item's time, place or size, remove its `auto`**: then
it is yours and the next `suggest` keeps it (switching it on or off keeps the tag). `autoEdits`
(`clickZooms`, `answerZoom`, `crop`, `privacy`, `retakes`, `fillers`, `pauses`, `typingZooms`,
`dialogZooms`: all `true`) holds which kinds are made at all; one set to `false` is not made again.

## Finding source seconds and rects

- `cuttle --json preview` lists each still's `source` second next to its output second `t`.
- `cuttle --json frame <source second> --grid` writes that frame of the screen track at full size
  with a numbered grid every 100 pixels (stronger lines every 500). Read the PNG and take rects off
  the grid; `frames/<t>s-grid.png` is the default file.
- `takes/<n>/markers.json` lists the prompt, each tool call and Claude's answer in source seconds,
  and each press of the mistake key (kind `retake`).
- `takes/<n>/events.jsonl` has the input: `move`, `click` and `scroll` with `x` and `y`, `keys`
  (presses per half second, never which keys) and the pointer's `shape`. On Windows it also has
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

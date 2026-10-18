# Music: a score written for this video

The video's music is a page you write: it composes the music in WebAudio, for this video, from its
scenes, its cuts, its clicks, its typing and its words. Cuttle renders it as long as the video,
mixes it under the voice (it goes down while someone speaks), and renders it again after every
edit, so a trimmed scene keeps its hit on the cut. Nothing is downloaded or licensed: every sound is
synthesized.

**Every video gets its own music.** The templates are starting points, not tracks to reuse: choose
the one closest to the video's mood, then make it this video's: its tempo and key, its chords, the
instruments, how it builds over the scenes, and the moments it marks (the prompt, the answer, the
reveal, the end card). Two videos should never sound the same.

## Make it

1. Start from a template: `cuttle -C "<project>" --json music new <template>` copies it into
   `music/<name>/index.html` and makes it the video's music (`cuttle --json music templates` lists
   them: pulse, drift, lofi, bright, cinematic).
2. Change the page for this video (below). Small changes go through its params:
   `cuttle -C "<project>" --json music set --param key=E --param bpm=118 --volume 0.7`.
3. Check it: `cuttle -C "<project>" --json music check`. It renders the music and the sounds alone
   (seconds, not minutes) into `preview/music.wav` and `preview/music.png`, and tells you what you
   cannot hear:
   - `info`: the tempo, key and sections the page returned;
   - `parts`: each section's level (`musicDb`, after the volume and the duck; `effectsDb`) and energy;
   - `cuts`: each scene change and whether the sound hits on it (`hit`, `riseDb`);
   - `loudness`: LUFS and true peak of the music and sounds without the voice;
   - `errors`, `console` and `skipped` sounds.
   Read the sheet (`music.png`): the waveforms over the scenes, the speech, the cuts in green (hit)
   or red. Fix every error, then check again. `--src music/<other>/index.html` checks another page
   without making it the music.
4. Render. The music renders beside the frames and is mixed with the mic, the typing and the sounds,
   limited below full scale.

**With the project open in the Cuttle app,** the user hears your music in its editor as they play the
video: the Music lane shows its waveform and the parts your page returned, its panel the params you
declared (declare a param for what they may want to set: the key, the tempo, how hard it drives),
its volume and how far it goes down under speech. Each page you save renders and plays there a
moment later; the user adds music from the templates and sounds at the playhead too.

Aim for about -16 LUFS for the music alone (`music check`), true peak below -1 dBFS; a quiet
walkthrough with a voice -20 or lower. `music.volume` (0–1) and `music.duck` (dB under speech,
default 12) set it in the mix without a new render of the page.

## The page

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script type="application/json" id="cuttle-params">
      [{ "name": "key", "label": "Key", "type": "select", "default": "D", "options": ["C", "D", "E"] }]
    </script>
  </head>
  <body>
    <script type="module">
      import { song, kick, bass, pad, fx, progression, sections, fitTempo } from 'cuttle/sound';

      cuttle.music((audio) => {
        const { video, params } = audio;
        const { bpm, offset } = fitTempo(video, { min: 112, max: 126 });
        const s = song(audio, { bpm, offset, key: params.key, mode: 'minor' });
        // … instruments, notes on the grid, effects on the cuts …
        return { bpm, key: `${params.key} minor`, sections: sections(video).map(({ start, end, name, energy }) => ({ start, end, name, energy })) };
      });
    </script>
  </body>
</html>
```

- **`cuttle.music(compose)`** is called once with `audio`: `context` (an `OfflineAudioContext` as
  long as the video), `music` and `effects` (stereo buses: the music goes down under speech, the
  effects never), `video`, `params`, `duration`, `at(t, fn)` and `random()` (seeded: the same music
  on every render; `Math.random` is seeded too). Return `{ bpm, key, sections }`: `music check`
  shows them. `cuttle.ready(promise)` holds the composition until samples have loaded.
- **Make nodes when they play, not up front.** Every connected node costs time on every 128 samples
  of the render, started or not, so a track that makes all its nodes first renders ten times
  slower. `audio.at(t, fn)` runs `fn` shortly before the render reaches `t`; the kit's instruments
  and effects do this for every note. Your own WebAudio code should too.
- **Params** are declared as in a motion page (`text`, `number`, `bool`, `select`, `color`), with
  their values in `music.params`; the user can change them.
- The page runs like a motion page: no network, only the project's files and the kit.

## The video (`cuttle.video`, also `audio.video`)

All in output seconds, as the video plays them:
- `duration`, `fps`;
- `scenes`: `index`, `id`, `label`, `type` (`clip`, `still`, `card`, `motion`), `start`, `end`, and
  for a clip `speed`, `from`, `to` (a clip with cuts comes in pieces);
- `cuts`: `{ t, scene, jump }` where one scene gives way to the next (`jump`: a cut inside a clip);
- `clicks` and `keys` (each key pressed) the video shows;
- `words` (`{ t, end, text }`) and `speech` (`{ start, end }`, words joined);
- `markers`: Claude's `prompt`, `tool` and `answer`, where the video shows them;
- `zooms`: `{ start, end, label }`.

## The kit (`cuttle/sound`)

- **`song(audio, { bpm, offset, key, mode, swing, reverb, brightness, delay })`**: the grid
  (`s.time(bar, beat)` with swing, `s.bars(from, to)`, `s.barAt(t)`, `s.beat`, `s.bar`), the buses
  `s.drums`, `s.bassBus`, `s.keys`, `s.pads`, `s.lead` (each with reverb and delay sends) into a
  glue compressor and a limiter, `s.bus({ gain, pan, reverb, delay, lowpass, highpass })` for more,
  and `s.duck(bus, times, { depth, release })` to pump a bus on the kicks.
- **Drums** (`.hit(t, velocity)`): `kick`, `snare`, `clap`, `hat` (`{ open: true }`), `shaker`,
  `tom` (`.hit(t, velocity, note)`), `rim`, `crash`, `ride`.
- **Tonal** (`.play(t, note or notes, seconds, { velocity })`): `bass`, `sub`, `pad`, `pluck`,
  `keys` (FM: `epiano`, `bell`, `glass`), `bell`, `strings`, `lead` (glides). Options shape each
  (`cutoff`, `attack`, `release`, `detune`, `drive`, `gain` …; see `sound.d.ts` in the kit).
- **Effects** at a moment `t` (`fx.name(audio, t, { volume })`), on the effects bus: `riser` and
  `reverseCymbal` and `swell` end on `t` (put them on a cut), `impact`, `braam`, `subDrop`,
  `downlifter` start on it, `whoosh` peaks on it, `swooshIn`, `pop`, `click`, `tick`, `ding`,
  `chime`, `success`, `error`, `typeBurst`, `glitch`.
- **Harmony and rhythm**: `midi('F#3')`, `hz`, `scale(key, mode)` (`degree(n, octave)`),
  `chord('Dm7', 3)`, `progression(key, mode, 'i VI III VII')`, `voiceLead(chords, { low, high })`,
  `arp(notes, { pattern, octaves })`, `steps('x..x..x.')`, `euclid(5, 8)`.
- **The video's shape**: `sections(video, { energy })` gives each scene an energy from 0 to 3
  (intro and outro 1, clips 2, sped-up work and Claude's answer 3, a climax before the outro; in a
  video without clips its scenes are 2);
  `{ energy: { Hook: 3, s4: 1 } }` sets one by label or id. `fitTempo(video, { min, max })` finds
  the tempo and start whose beats meet the scene changes.

## Sounds at moments

For a single sound where something happens (a pop when a card appears, a whoosh on a zoom),
without touching the music: `cuttle -C "<project>" --json sound add whoosh --at 12.4` (a source
second: it plays wherever the video shows that moment) or `--scene s5 --at 0.2` (seconds into a
scene), `--volume 0.6`. A file of the project works too (`sounds/ding.wav`). `cuttle --json sound list`
lists the built-in sounds. `look.audio.effects` and `effectsVolume` switch and scale every sound.
A motion page asks for its own with `cuttle.sound('whoosh', { at: 0.3 })` ([motion.md](motion.md)),
so its sounds move with it; the templates do (their `sounds` param). `music check` and the export
play them with the music and the project's sounds, so a whoosh in the title and a hit in the music
on the same cut add up: leave one of them out.

## Music that feels composed

- **Follow the story.** Sparse while the video sets up, building while Claude works, the fullest
  where the result appears, resolving on the home chord as the end card comes. Energy comes from
  more parts and brighter sounds, not only from loudness.
- **Land on the cuts.** Fit the tempo so the scene changes fall on beats (`fitTempo`), let a riser
  end on a big cut and a hit start it; drop everything for a beat before the reveal. Mark Claude's
  answer (a chime, a lift).
- **Leave room for the voice.** Under speech, keep the middle (300 Hz – 3 kHz) clear: pads and bass
  low, no busy melody. The duck does the rest.
- **One idea, varied.** A short motif or chord loop that comes back changed (an octave up, another
  instrument, the arpeggio in the lift) holds a track together.
- **Make each one different.** Pick key, mode, tempo and instruments for this product and this
  video: a calm walkthrough in a lydian major at 84 BPM, a launch in minor at 124. Change the
  progression, the drum pattern, the sounds. Never ship a template as it came.
- **End on time.** The render stops where the video stops; let the last chord ring into the end
  card and fade, rather than cut off mid-phrase.

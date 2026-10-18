# Cuttle P5-M1e: Music and Sounds Made for the Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every video can have music written for it, and sounds where things happen:
- Claude writes the music as a page that composes it in WebAudio from the video's own timeline (its scenes, cuts, clicks, typing, words, Claude's markers), starting from a template and making it this video's own;
- it renders as long as the video, follows every edit, goes down under speech, and is mixed with the mic and the typing, limited below full scale;
- single sounds (built-in effects or the project's files) play at moments of the take or of a scene;
- `cuttle music check` renders the music alone and tells Claude what it cannot hear: each part's level, the hits on the scene changes, the loudness, the page's errors, a sheet of the waveforms.

**Architecture:**
- **The format:** `music` (`src`, `params`, `volume`, `duck`, `network`, `enabled`) and `sounds` (`sound`, `at`, `scene`, `volume`, `enabled`, an id `a1`); `look.audio.effects` and `effectsVolume`.
- **The sound kit** (`cuttle/sound`, in the motion kit): a song's grid and buses, drums, bass, pads, plucks, FM keys, strings, a lead, eighteen effects, harmony (notes, scales, chords, roman numerals, voice leading), rhythm, the video's parts with an energy, and a tempo fitted to the cuts. Five music templates (pulse, drift, lofi, bright, cinematic).
- **The runtime** (`musicRuntime`, injected into the page like a motion page's): `cuttle.music(compose)` gets an `OfflineAudioContext` as long as the video with two stereo buses, music and effects, and the video's timeline (`cuttle.video`); it adds the project's sounds, renders the two stems, and makes each note's nodes a moment before the render reaches them.
- **The renderer** (`MusicPage`, `renderMusic`): the page in a hidden, sandboxed, offscreen window of the motion pages' kind; the stems read out as float32.
- **The mix** (`planSoundtrack`, `renderSoundtrack`, `writeSoundTrack`): the export renders the soundtrack beside the frames and writes one stereo float track (the music at its volume, lowered under speech; the effects; the typing clicks), which ffmpeg mixes with the mic and limits.
- **The CLI:** `music new | templates | set | check`, `sound add | list`; the check measures the render and draws a sheet.
- **The guide** (`skill/cuttle/music.md`): how to compose for a video, and that no two videos should sound alike.

**Tech Stack:** TypeScript strict, zod 4, vitest 5 (node and Chromium browser projects), Electron 44.7.2 (offscreen windows), WebAudio (`OfflineAudioContext`), ffmpeg.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase5-motion-design.md` ("Sound"). Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p5-m1c-motion-editor.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m1e`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 7.

## Decisions made while planning

A prototype of the milestone, checked against the spec and with the user's wish, settled these points. The finished prototype passed `pnpm test` (829 tests, 67 skipped, in two full runs), the typecheck, `app:check` (49 tests) and `cli:check` (12). Every sheet was looked at.

- **The music is a page Claude writes for each video,** not a track picked from a list. The user asked for music "angepasst für das Video … nicht immer das gleiche": the page composes in WebAudio from the video's timeline, so it follows the edit, and Claude makes it this video's own. The templates are starting points; the guide says never to ship one unchanged.
- **WebAudio, rendered offline, in the motion pages' sandbox** (a spike on 2026-10-18):
  - an `OfflineAudioContext` renders in a hidden, sandboxed, offscreen window, without the network;
  - a dense 90 s track (4826 nodes) took 51 s with every node made up front, because every connected node is pulled through every 128-frame quantum, started or not; made a window ahead (the render stops every second, `context.suspend`, and makes the next two seconds of notes), it took 6.8 s. So `audio.at(t, fn)` runs `fn` shortly before the render reaches `t`, and the kit makes every note's nodes there;
  - two renders differ by at most 2 LSB of 16 bit in 0.07 % of samples (the order of float sums): the same music, not the same bytes. `Math.random` is seeded;
  - 90 s of stereo float reads out in 10 s chunks of base64 in about 0.25 s.
- **Two stems in one render:** a four-channel context, music on channels 0–1 and effects on 2–3. The export lowers the music under speech and sets each stem's level, so `music.volume`, `music.duck` and `effectsVolume` need no new render of the page. A 30 ms fade where the video ends.
- **`cuttle.video`** (output seconds, as the video plays): the scenes (a clip's pieces around a cut each a scene, with their speed and source range), the cuts (`jump` inside a clip), clicks, key presses (at most 30 a second), words with the project's caption fixes, stretches of speech (words closer than 0.6 s joined), Claude's markers, and zooms (one stretch over a cut).
- **The kit** (`packages/motion-kit/kit/sound.js`, typed by `sound.d.ts`, imported as `cuttle/sound`):
  - `song(audio, { bpm, offset, key, mode, swing, reverb, brightness, delay })`: a grid with swing, buses (drums, bass, keys, pads, lead) with sends to a convolution reverb and a ping-pong delay, into a glue compressor and a limiter, then the level (about -16 LUFS when full); `s.duck` pumps a bus on the kicks;
  - instruments of WebAudio nodes (the oscillators are band-limited); a saturation that adds harmonics, not volume (quiet signals come out `1 + drive` times louder; a plain tanh curve made them five times louder);
  - eighteen effects at a moment (a riser ends on it, a whoosh peaks on it, an impact starts on it), on the effects bus with a reverb of their own;
  - harmony and rhythm: notes by name, scales, chords with slash basses, roman numerals with qualities, voice leading, arpeggios, step patterns, Euclidean rhythms;
  - `sections(video)`: an energy from 0 to 3 per part, from what it shows (intro and outro 1, clips 2, sped-up work and Claude's answer 3, a climax before the outro; in a video without clips the scenes are its content); a part's energy can be set by its label or id;
  - `fitTempo(video)`: the tempo in a range, and the start, whose beats come closest to the scene changes.
- **Five templates,** each a different idea of music for a demo: pulse (driving electronic), drift (calm and wide, for a voice), lofi (swing, an electric piano, crackle), bright (an upbeat launch), cinematic (a trailer: toms, braams, sub drops). Each fits its tempo to the cuts, follows the parts' energy, and marks the cuts its own way.
- **Sounds:** a built-in sound (eighteen: whoosh, swoosh-in, riser, impact, downlifter, sub-drop, braam, reverse-cymbal, swell, pop, click, tick, ding, chime, success, error, type-burst, glitch) or a file of the project, at a source second (it plays wherever the video shows that moment, and not where it is cut) or a number of seconds into a scene (`scene`: its id; for motion scenes, which have no source seconds). Files outside the project are skipped with a warning. Their ids start with `a`; the editor does not list them yet, so `sounds` is not one of its id lists.
- **The mix:** with music or sounds, one stereo float WAV holds them and the typing clicks (the music at `volume`, down by `duck` dB under speech: 0.25 s before the words, back over 0.45 s after, held down over a shorter gap); ffmpeg adds it to the mic as it is and limits the sum at 0.89 at four times the rate (peaks between samples count). Without music or sounds, the typing track stays as it was. The soundtrack renders beside the frames, so the export takes no longer.
- **`cuttle music check`** renders the music and sounds alone (about 10 s for 90 s of video) into `preview/music.wav` and `preview/music.png`, and reports the page's tempo, key and sections, each section's level (music after its volume and duck, effects), whether each scene change has a hit (the 60 ms after it at least 4 dB above the second before, a riser's last 0.3 s left out), LUFS and true peak (ffmpeg's EBU R128 meter), and the page's errors, console and skipped sounds.
- **The CLI:** `music new <template> [--name]` (copies into `music/<name>/` and makes it the music, keeping its level), `music templates`, `music set [--volume] [--duck] [--param name=value…] [--src] [--on|--off]`, `music check [--src] [-o]`, `sound add <sound> --at <s> [--scene] [--volume] [--label]`, `sound list`.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/{schema,ids,index}.ts` | `music`, `sounds`, the effects' switch and level, sound ids |
| `packages/motion-kit/kit/{sound.js,sound.d.ts,blank.html}`, `packages/motion-kit/src/index.ts` | the sound kit, the built-in sounds, the music templates' list |
| `packages/motion-kit/templates/music-*/index.html`, `packages/motion-kit/src/files.ts` | the five templates, copying one into `music/` |
| `packages/export/src/music/{video,runtime}.ts` | the video as the music sees it, the page's runtime |
| `packages/export/src/main/{music,soundtrack,music-check,motion,export}.ts`, `packages/export/src/{audio,index}.ts` | rendering the page, the soundtrack, the mix, the check |
| `apps/cli/src/commands/music.ts`, `apps/cli/src/{main.ts,electron/main.ts,electron/protocol.ts}` | the commands |
| `skill/cuttle/{music,SKILL,project}.md` | the guide |

---

### Task 1: The format

**Files:**
- Modify: `packages/project/src/schema.ts`, `packages/project/src/ids.ts`, `packages/project/src/index.ts`, `packages/project/test/schema.test.ts`, `packages/project/test/ids.test.ts`, `packages/timeline/test/typing.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m1e`; work there:

```bash
git switch p5-m1e
```

- [ ] **Step 2: Write the failing tests**

In `packages/project/test/schema.test.ts`, replace:

```ts
    expect(p.look.frame).toEqual({ enabled: true, style: 'mac-dark', title: '', radius: 14, shadow: true });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'system', size: 1, color: '#D97757', clickEffect: 'ripple', smoothing: 0.5 });
    expect(p.look.webcam).toEqual({ enabled: false, shape: 'circle', corner: 'bottom-left', size: 0.18, border: true, shadow: true, mirror: false });
    expect(p.look.audio).toEqual({ enabled: true, muteSpedUp: true, cleanup: true, typing: true, typingVolume: 0.5 });
    expect(p.look.transition).toEqual({ enabled: true, duration: 0.3 });
    expect(p.scenes).toEqual([]);
    expect(p.zooms).toEqual([]);
    expect(p.masks).toEqual([]);
    expect(p.texts).toEqual([]);
    expect(p.overlays).toEqual([]);
  });

  it('parses the spec example and applies item defaults', () => {
```

with:

```ts
    expect(p.look.frame).toEqual({ enabled: true, style: 'mac-dark', title: '', radius: 14, shadow: true });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'system', size: 1, color: '#D97757', clickEffect: 'ripple', smoothing: 0.5 });
    expect(p.look.webcam).toEqual({ enabled: false, shape: 'circle', corner: 'bottom-left', size: 0.18, border: true, shadow: true, mirror: false });
    expect(p.look.audio).toEqual({ enabled: true, muteSpedUp: true, cleanup: true, typing: true, typingVolume: 0.5, effects: true, effectsVolume: 0.8 });
    expect(p.look.transition).toEqual({ enabled: true, duration: 0.3 });
    expect(p.scenes).toEqual([]);
    expect(p.zooms).toEqual([]);
    expect(p.masks).toEqual([]);
    expect(p.texts).toEqual([]);
    expect(p.overlays).toEqual([]);
    expect(p.music).toBeUndefined();
    expect(p.sounds).toEqual([]);
  });

  it("takes the video's music and its sounds, with their defaults", () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [{ type: 'card', id: 's1', title: 'Hi', duration: 2 }],
      music: { src: 'music/pulse/index.html', params: { key: 'E', bpm: 0, hits: true } },
      sounds: [{ id: 'a1', sound: 'whoosh', at: 3.5 }, { sound: 'sounds/ding.wav', at: 0.4, scene: 's1', volume: 0.5, label: 'Done' }],
    });
    expect(p.music).toEqual({ src: 'music/pulse/index.html', params: { key: 'E', bpm: 0, hits: true }, network: false, volume: 0.8, duck: 12, enabled: true });
    expect(p.sounds).toEqual([
      { id: 'a1', sound: 'whoosh', at: 3.5, volume: 0.8, enabled: true },
      { sound: 'sounds/ding.wav', at: 0.4, scene: 's1', volume: 0.5, label: 'Done', enabled: true },
    ]);
  });

  it("rejects a sound in a scene that does not exist, a sound's id used elsewhere, and levels out of range", () => {
    expect(pathsOf({ ...minimal, sounds: [{ sound: 'pop', at: 1, scene: 's9' }] })).toEqual(['sounds.0.scene']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'card', id: 'x', title: 'Hi', duration: 2 }], sounds: [{ id: 'x', sound: 'pop', at: 1 }] })).toEqual(['sounds.0.id']);
    expect(pathsOf({ ...minimal, music: { src: 'm.html', volume: 2, duck: -1 } })).toEqual(['music.volume', 'music.duck']);
    expect(pathsOf({ ...minimal, music: { volume: 0.5 } })).toEqual(['music.src']);
  });

  it('parses the spec example and applies item defaults', () => {
```

In `packages/project/test/ids.test.ts`, replace:

```ts
      texts: [{ id: 7 }],
    };
    expect([...usedIds(raw)]).toEqual(['s1', 'answer']);
    expect(usedIds({})).toEqual(new Set());
  });
});
```

with:

```ts
      texts: [{ id: 7 }],
    };
    expect([...usedIds(raw)]).toEqual(['s1', 'answer']);
    expect([...usedIds({ ...raw, sounds: [{ id: 'a1' }, { sound: 'pop' }] })]).toEqual(['s1', 'answer', 'a1']);
    expect(usedIds({})).toEqual(new Set());
  });
});
```

In the same file, replace:

```ts
    expect(newId('zooms', taken)).toBe('z2');
    expect(newId('masks', taken)).toBe('m1');
    expect(newId('texts', taken)).toBe('t1');
    expect(taken).toEqual(new Set(['s1', 's2', 's3', 's4', 'z1', 'z2', 'm1', 't1']));
  });
});
```

with:

```ts
    expect(newId('zooms', taken)).toBe('z2');
    expect(newId('masks', taken)).toBe('m1');
    expect(newId('texts', taken)).toBe('t1');
    expect(newId('sounds', taken)).toBe('a1');
    expect(taken).toEqual(new Set(['s1', 's2', 's3', 's4', 'z1', 'z2', 'm1', 't1', 'a1']));
  });
});
```

Run: `pnpm exec vitest run --project node packages/project`
Expected: FAIL: the schema has no `music` or `sounds`, and `newId` no `sounds`.

- [ ] **Step 3: `music`, `sounds`, the effects, the ids**

In `packages/project/src/schema.ts`, replace:

```ts
  typing: z.boolean().default(true),
  /** The clicks' volume, 0 to 1. */
  typingVolume: z.number().min(0).max(1).default(0.5),
});

const TransitionSchema = z.strictObject({
```

with:

```ts
  typing: z.boolean().default(true),
  /** The clicks' volume, 0 to 1. */
  typingVolume: z.number().min(0).max(1).default(0.5),
  /** The sounds (`sounds`) and the music page's effects. */
  effects: z.boolean().default(true),
  /** Their volume, 0 to 1. */
  effectsVolume: z.number().min(0).max(1).default(0.8),
});

const TransitionSchema = z.strictObject({
```

In the same file, replace:

```ts
  enabled: z.boolean().default(true),
});

export const ProjectSchema = z
  .strictObject({
    version: z.literal(CURRENT_VERSION),
```

with:

```ts
  enabled: z.boolean().default(true),
});

/**
 * The video's music: a page that composes it in WebAudio for this video (`music/<name>/index.html`),
 * from the video's scenes, cuts, clicks, typing and words. It is rendered as long as the video,
 * follows every edit, and goes down under speech.
 */
const MusicSchema = z.strictObject({
  /** The page: an HTML file in the project. */
  src: z.string().min(1),
  /** The values of the params the page declares. */
  params: z.record(z.string(), ParamValue).default({}),
  /** Let the page reach https: (off: only the project's files). */
  network: z.boolean().default(false),
  /** Its level, 0 to 1. */
  volume: z.number().min(0).max(1).default(0.8),
  /** How far it goes down under speech, in dB (0: it does not). */
  duck: z.number().min(0).max(40).default(12),
  enabled: z.boolean().default(true),
});

/**
 * A sound at a moment: a built-in sound (`whoosh`, `pop`; `cuttle sound list`) or a file in the
 * project (`sounds/ding.wav`). At a source second it plays wherever the video shows that moment (and
 * not where it is cut); with `scene` (an id) it plays `at` seconds into that scene.
 */
const SoundSchema = z.strictObject({
  ...named,
  sound: z.string().min(1),
  at: seconds,
  scene: z.string().regex(ID_PATTERN).optional(),
  volume: z.number().min(0).max(1).default(0.8),
  enabled: z.boolean().default(true),
});

export const ProjectSchema = z
  .strictObject({
    version: z.literal(CURRENT_VERSION),
```

In the same file, replace:

```ts
    texts: z.array(TextSchema).default([]),
    overlays: z.array(MotionOverlaySchema).default([]),
    cuts: z.array(CutSchema).default([]),
    autoEdits: AutoEditsSchema.prefault({}),
    captions: CaptionsSchema.prefault({}),
    privacy: PrivacySchema.prefault({}),
```

with:

```ts
    texts: z.array(TextSchema).default([]),
    overlays: z.array(MotionOverlaySchema).default([]),
    cuts: z.array(CutSchema).default([]),
    music: MusicSchema.optional(),
    sounds: z.array(SoundSchema).default([]),
    autoEdits: AutoEditsSchema.prefault({}),
    captions: CaptionsSchema.prefault({}),
    privacy: PrivacySchema.prefault({}),
```

In the same file, replace:

```ts
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
    const seen = new Map<string, string>();
    for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts'] as const) {
      project[list].forEach((item: { id?: string }, index) => {
        if (item.id === undefined) return;
        const first = seen.get(item.id);
```

with:

```ts
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
    const seen = new Map<string, string>();
    for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts', 'sounds'] as const) {
      project[list].forEach((item: { id?: string }, index) => {
        if (item.id === undefined) return;
        const first = seen.get(item.id);
```

In the same file, replace:

```ts
        else ctx.addIssue({ code: 'custom', message: `the id "${item.id}" is already used by ${first}`, path: [list, index, 'id'] });
      });
    }
  });

// One line of events.jsonl. Times are source seconds (seconds since the screen track started).
```

with:

```ts
        else ctx.addIssue({ code: 'custom', message: `the id "${item.id}" is already used by ${first}`, path: [list, index, 'id'] });
      });
    }
    project.sounds.forEach((sound, index) => {
      if (sound.scene !== undefined && !project.scenes.some((scene) => scene.id === sound.scene)) {
        ctx.addIssue({ code: 'custom', message: `no scene has the id "${sound.scene}"`, path: ['sounds', index, 'scene'] });
      }
    });
  });

// One line of events.jsonl. Times are source seconds (seconds since the screen track started).
```

In the same file, replace:

```ts
export type CardScene = Extract<Scene, { type: 'card' }>;
export type MotionScene = Extract<Scene, { type: 'motion' }>;
export type MotionOverlay = CuttleProject['overlays'][number];
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
```

with:

```ts
export type CardScene = Extract<Scene, { type: 'card' }>;
export type MotionScene = Extract<Scene, { type: 'motion' }>;
export type MotionOverlay = CuttleProject['overlays'][number];
export type Music = NonNullable<CuttleProject['music']>;
export type Sound = CuttleProject['sounds'][number];
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
```

In `packages/project/src/ids.ts`, replace:

```ts

export type IdList = keyof typeof ID_PREFIXES;

/** The ids a project's items use; the project may be parsed or as written (unchecked). */
export function usedIds(project: Partial<Record<IdList, unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const list of Object.keys(ID_PREFIXES) as IdList[]) {
    const items = project[list];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
```

with:

```ts

export type IdList = keyof typeof ID_PREFIXES;

/** The prefix of a new sound's id (`sounds`, which the editor does not list yet). */
export const SOUND_ID_PREFIX = 'a';

/** The ids a project's items use (its sounds' too); the project may be parsed or as written (unchecked). */
export function usedIds(project: Partial<Record<IdList | 'sounds', unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const list of [...(Object.keys(ID_PREFIXES) as IdList[]), 'sounds' as const]) {
    const items = project[list];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
```

In the same file, replace:

```ts
}

/** A new id for an item of `list`: its prefix and the smallest number not in `taken`, which it is added to. */
export function newId(list: IdList, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `${ID_PREFIXES[list]}${n}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
```

with:

```ts
}

/** A new id for an item of `list`: its prefix and the smallest number not in `taken`, which it is added to. */
export function newId(list: IdList | 'sounds', taken: Set<string>): string {
  const prefix = list === 'sounds' ? SOUND_ID_PREFIX : ID_PREFIXES[list];
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
```

In `packages/project/src/index.ts`, replace:

```ts
  type CaptionStyle,
  type CardScene,
  type MotionOverlay,
  type MotionScene,
  type ClipScene,
  type CursorShape,
```

with:

```ts
  type CaptionStyle,
  type CardScene,
  type MotionOverlay,
  type Music,
  type Sound,
  type MotionScene,
  type ClipScene,
  type CursorShape,
```

A test that writes the audio settings out in full gets the two new ones:

In `packages/timeline/test/typing.test.ts`, replace:

```ts

const keys = (t: number, count: number): InputEvent => ({ t, type: 'keys', count });
const clip = (from: number, to: number, speed = 1): Scene => ({ type: 'clip', from, to, speed });
const audio: Look['audio'] = { enabled: true, muteSpedUp: true, cleanup: true, typing: true, typingVolume: 0.5 };
/** The largest absolute sample (a spread of a long track would overflow the stack). */
const peakOf = (samples: Float32Array) => samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
/** The share of a sound's energy below `cutoff` Hz (a one-pole low-pass). */
```

with:

```ts

const keys = (t: number, count: number): InputEvent => ({ t, type: 'keys', count });
const clip = (from: number, to: number, speed = 1): Scene => ({ type: 'clip', from, to, speed });
const audio: Look['audio'] = { enabled: true, muteSpedUp: true, cleanup: true, typing: true, typingVolume: 0.5, effects: true, effectsVolume: 0.8 };
/** The largest absolute sample (a spread of a long track would overflow the stack). */
const peakOf = (samples: Float32Array) => samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
/** The share of a sound's energy below `cutoff` Hz (a one-pole low-pass). */
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/project packages/timeline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project packages/timeline/test/typing.test.ts
git commit -m "project: the video's music (a page), sounds at moments, and the effects' switch and level

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The sound kit and the music templates

**Files:**
- Create: `packages/motion-kit/kit/sound.js`, `packages/motion-kit/kit/sound.d.ts`, `packages/motion-kit/kit/blank.html`, `packages/motion-kit/templates/music-pulse/index.html`, `packages/motion-kit/templates/music-drift/index.html`, `packages/motion-kit/templates/music-lofi/index.html`, `packages/motion-kit/templates/music-bright/index.html`, `packages/motion-kit/templates/music-cinematic/index.html`, `packages/motion-kit/test/sound.test.ts`
- Modify: `packages/motion-kit/src/index.ts`, `packages/motion-kit/src/files.ts`, `packages/motion-kit/test/kit.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/motion-kit/test/sound.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BUILT_IN_SOUNDS } from '../src/index';
import { SOUND_LIST, SOUNDS, arp, chord, euclid, fitTempo, hz, midi, progression, scale, sections, steps, voiceLead, type Video } from '../kit/sound.js';

const video = (scenes: Video['scenes'], extra: Partial<Video> = {}): Video => ({
  duration: scenes.at(-1)!.end,
  fps: 30,
  scenes,
  cuts: scenes.slice(1).map((scene) => ({ t: scene.start, scene: scene.index, jump: false })),
  clicks: [],
  keys: [],
  words: [],
  speech: [],
  markers: [],
  zooms: [],
  ...extra,
});

describe('the sound kit: notes and harmony', () => {
  it('reads notes as MIDI numbers and frequencies', () => {
    expect([midi('C4'), midi('A4'), midi('F#3'), midi('Bb2'), midi('D'), midi(40)]).toEqual([60, 69, 54, 46, 62, 40]);
    expect(hz('A4')).toBe(440);
    expect(hz(81)).toBeCloseTo(880, 6);
    expect(() => midi('H2')).toThrow(/not a note/);
  });

  it('walks a scale by its degrees, across octaves both ways', () => {
    const d = scale('D', 'minor');
    expect(d.notes(4)).toEqual([62, 64, 65, 67, 69, 70, 72]);
    expect([d.degree(7, 4), d.degree(-1, 4), d.degree(9, 3)]).toEqual([74, 60, 65]);
    expect(scale('C', 'pentatonic').notes(4)).toEqual([60, 62, 64, 67, 69]);
  });

  it('spells chords, with a bass note under a slash', () => {
    expect(chord('Dm7', 3)).toEqual([50, 53, 57, 60]);
    expect(chord('Bbmaj7')).toEqual([70, 74, 77, 81]);
    expect(chord('F/A')).toEqual([57, 65, 69, 72]);
    expect(chord('Csus4', 3)).toEqual([48, 53, 55]);
    expect(() => chord('Cblah')).toThrow(/quality/);
  });

  it('turns roman numerals into the key\'s chords: case for major and minor, a suffix on top', () => {
    expect(progression('D', 'minor', 'i VI III VII', 3)).toEqual([
      [50, 53, 57],
      [58, 62, 65],
      [53, 57, 60],
      [60, 64, 67],
    ]);
    expect(progression('C', 'major', 'ii7 V7 Imaj7', 3)).toEqual([
      [50, 53, 57, 60],
      [55, 59, 62, 65],
      [48, 52, 55, 59],
    ]);
    expect(progression('A', 'minor', 'ii°', 3)).toEqual([[59, 62, 65]]);
  });

  it('voices each chord close to the one before, inside the range', () => {
    const plain = progression('C', 'major', 'I V vi IV', 3);
    const voiced = voiceLead(plain, { low: 'C3', high: 'C5' });
    for (const notes of voiced) {
      expect(Math.min(...notes)).toBeGreaterThanOrEqual(48);
      expect(Math.max(...notes)).toBeLessThanOrEqual(72);
    }
    // the chords' middles move less, all told, than in root position
    const centre = (notes: number[]) => notes.reduce((a, b) => a + b, 0) / notes.length;
    const travel = (chords: number[][]) => chords.slice(1).reduce((sum, notes, i) => sum + Math.abs(centre(notes) - centre(chords[i]!)), 0);
    expect(travel(voiced)).toBeLessThan(travel(plain));
  });

  it('writes rhythms as steps and spreads hits evenly', () => {
    expect(steps('x..X .o')).toEqual([0.75, 0, 0, 1, 0, 0.45]);
    const tresillo = euclid(3, 8);
    expect(tresillo.filter((v) => v > 0)).toHaveLength(3);
    expect(tresillo.length).toBe(8);
    expect(arp([67, 60, 64], { pattern: 'updown' })).toEqual([60, 64, 67, 64]);
    expect(arp([60, 64], { octaves: 2 })).toEqual([60, 64, 72, 76]);
  });
});

describe('the sound kit: the video', () => {
  const scenes: Video['scenes'] = [
    { index: 0, type: 'motion', start: 0, end: 3, label: 'Title' },
    { index: 1, type: 'clip', start: 3, end: 10, speed: 1, from: 0, to: 7 },
    { index: 2, type: 'clip', start: 10, end: 14, speed: 8, from: 7, to: 39 },
    { index: 3, type: 'clip', start: 14, end: 20, speed: 1, from: 39, to: 45, id: 's4' },
    { index: 4, type: 'clip', start: 20, end: 26, speed: 1, from: 45, to: 51 },
    { index: 5, type: 'card', start: 26, end: 30 },
  ];

  it('gives each part an energy from what it shows, and builds to the part before the outro', () => {
    const parts = sections(video(scenes, { markers: [{ t: 16, kind: 'answer' }] }));
    expect(parts.map((part) => [part.name, part.energy])).toEqual([
      ['intro', 1],
      ['main', 2],
      ['drive', 3],
      ['payoff', 3],
      ['climax', 3],
      ['outro', 1],
    ]);
  });

  it('takes a part\'s energy from its label or id, and leaves a part set so as it is', () => {
    const parts = sections(video(scenes), { energy: { Title: 0, s4: 1, 4: 2 } });
    expect(parts.map((part) => part.energy)).toEqual([0, 2, 3, 1, 2, 1]);
  });

  it('takes the scenes of a video without clips as its content, a card at the end as the outro', () => {
    const reel: Video['scenes'] = [
      { index: 0, type: 'motion', start: 0, end: 3 },
      { index: 1, type: 'motion', start: 3, end: 6 },
      { index: 2, type: 'motion', start: 6, end: 9 },
      { index: 3, type: 'card', start: 9, end: 11 },
    ];
    expect(sections(video(reel)).map((part) => [part.name, part.energy])).toEqual([
      ['main', 2],
      ['main', 2],
      ['climax', 3],
      ['outro', 1],
    ]);
    expect(sections(video(reel.slice(0, 2))).map((part) => part.energy)).toEqual([2, 2]);
  });

  it('keeps the pieces of a clip around a jump cut one part', () => {
    const cutUp: Video['scenes'] = [
      { index: 0, type: 'clip', start: 0, end: 4, speed: 1, from: 0, to: 4 },
      { index: 0, type: 'clip', start: 4, end: 9, speed: 1, from: 6, to: 11 },
    ];
    const parts = sections({ ...video(cutUp), cuts: [{ t: 4, scene: 0, jump: true }] });
    expect(parts.map((part) => [part.start, part.end])).toEqual([[0, 9]]);
  });

  it('finds a tempo whose beats meet the scene changes', () => {
    const cuts = [2, 5.5, 9, 13.5, 21];
    const { bpm, offset, error } = fitTempo(cuts, { min: 100, max: 128 });
    expect(bpm).toBeGreaterThanOrEqual(100);
    expect(bpm).toBeLessThanOrEqual(128);
    expect(error).toBeLessThan(0.01);
    const beat = 60 / bpm;
    for (const t of cuts) {
      const beats = (t - offset) / beat;
      expect(Math.abs(beats - Math.round(beats)) * beat).toBeLessThan(0.02);
    }
    // from a video: its scene changes, not its jump cuts
    const fromVideo = fitTempo({ ...video(scenes), cuts: [...video(scenes).cuts, { t: 4.1, scene: 1, jump: true }] }, { min: 100, max: 128 });
    expect(fromVideo.error).toBeLessThan(0.05);
  });
});

describe('the sound kit: the built-in sounds', () => {
  it('plays every built-in sound a project can name, as the CLI lists them', () => {
    expect(SOUND_LIST).toEqual(BUILT_IN_SOUNDS.map(([name, description]) => [name, description]));
    expect(Object.keys(SOUNDS).sort()).toEqual(BUILT_IN_SOUNDS.map(([name]) => name).sort());
  });
});
```

In `packages/motion-kit/test/kit.test.ts`, replace:

```ts
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copyTemplate, MissingTemplateError } from '../src/files';
import { KIT_FONTS, KIT_IMPORTS, KIT_ORIGIN, MOTION_TEMPLATES, importMapTag, withImportMap } from '../src/index';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
```

with:

```ts
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copyTemplate, MissingTemplateError } from '../src/files';
import { KIT_FONTS, KIT_IMPORTS, KIT_ORIGIN, MOTION_TEMPLATES, MUSIC_TEMPLATES, importMapTag, withImportMap } from '../src/index';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
```

In the same file, replace:

```ts
      three: 'cuttle-motion://kit/three/three.module.js',
      'three/addons/': 'cuttle-motion://kit/three/addons/',
      cuttle: 'cuttle-motion://kit/motion.js',
      'lottie-web': 'cuttle-motion://kit/lottie/lottie.mjs',
    });
    expect(KIT_FONTS.every((font) => font.src.startsWith(`${KIT_ORIGIN}/fonts/`))).toBe(true);
```

with:

```ts
      three: 'cuttle-motion://kit/three/three.module.js',
      'three/addons/': 'cuttle-motion://kit/three/addons/',
      cuttle: 'cuttle-motion://kit/motion.js',
      'cuttle/sound': 'cuttle-motion://kit/sound.js',
      'lottie-web': 'cuttle-motion://kit/lottie/lottie.mjs',
    });
    expect(KIT_FONTS.every((font) => font.src.startsWith(`${KIT_ORIGIN}/fonts/`))).toBe(true);
```

In the same file, replace:

```ts
    }
  });

  it('copies a template into the project, beside a folder of its name already there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-kit-'));
    try {
```

with:

```ts
    }
  });

  it('has a page for every music template that composes with cuttle.music and declares its params', () => {
    expect(MUSIC_TEMPLATES.map((template) => template.name)).toEqual(['pulse', 'drift', 'lofi', 'bright', 'cinematic']);
    for (const template of MUSIC_TEMPLATES) {
      const html = readFileSync(`${TEMPLATES}music-${template.name}/index.html`, 'utf8');
      expect(html, template.name).toMatch(/^<!doctype html>/);
      expect(html, template.name).toContain('cuttle.music(');
      expect(html, template.name).toContain("from 'cuttle/sound'");
      const declared = html.split('id="cuttle-params">')[1]?.split('</' + 'script>')[0];
      const params = JSON.parse(declared ?? 'null') as { name: string; type: string }[];
      expect(params.map((param) => param.name), template.name).toContain('bpm');
    }
  });

  it('copies a music template into music/', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-kit-'));
    try {
      expect(await copyTemplate(dir, 'music-pulse', 'pulse', import.meta.url, 'music')).toBe('music/pulse/index.html');
      expect(await copyTemplate(dir, 'music-pulse', 'pulse', import.meta.url, 'music')).toBe('music/pulse-2/index.html');
      expect(existsSync(join(dir, 'motion'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('copies a template into the project, beside a folder of its name already there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-kit-'));
    try {
```

Run: `pnpm exec vitest run --project node packages/motion-kit`
Expected: FAIL: `../kit/sound.js` does not exist, the kit has no `cuttle/sound`, no music templates, and `copyTemplate` copies only into `motion/`.

- [ ] **Step 2: The kit**

`packages/motion-kit/kit/sound.js`:

```
// Cuttle's sound kit for music pages: import { song, kick, pad, fx, chord } from 'cuttle/sound'.
//
// Everything is made of WebAudio nodes in the page's OfflineAudioContext. Each note makes its nodes
// a moment before it plays (`audio.at`), so a long, dense track renders fast. Times are output
// seconds of the video; notes are MIDI numbers or names ('D3', 'F#4').
//
//   song(audio, { bpm, key, mode })   the grid, the buses (drums, bass, keys, pads, lead), reverb, delay
//   kick snare clap hat shaker tom rim crash ride   drums: .hit(t, velocity)
//   bass pad pluck keys bell strings lead sub        tonal: .play(t, note | notes, seconds, { velocity })
//   fx.riser fx.impact fx.whoosh …                   effects at a moment (a riser ends on it)
//   chord scale progression voiceLead arp euclid steps   harmony and rhythm
//   sections fitTempo                                parts of the video with an energy, a tempo whose beats meet its cuts

// ---- nodes ------------------------------------------------------------------------------------------

/** Counts a node the kit made (the runtime reports how many). */
function made(ctx, node) {
  ctx.__cuttleNodes = (ctx.__cuttleNodes ?? 0) + 1;
  return node;
}
const osc = (ctx, type, frequency) => {
  const node = made(ctx, ctx.createOscillator());
  node.type = type;
  node.frequency.value = frequency;
  return node;
};
const amp = (ctx, value = 1) => {
  const node = made(ctx, ctx.createGain());
  node.gain.value = value;
  return node;
};
const filter = (ctx, type, frequency, q = 0.707) => {
  const node = made(ctx, ctx.createBiquadFilter());
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
};
const panner = (ctx, pan) => {
  const node = made(ctx, ctx.createStereoPanner());
  node.pan.value = Math.max(-1, Math.min(1, pan));
  return node;
};

/** A seeded random for the kit's own noise (the same on every render). */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noises = new WeakMap();
/** Two seconds of white noise per context, shared by every noisy sound (each starts at its own offset). */
function noiseBuffer(ctx) {
  let buffer = noises.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
    const random = seeded(0x51ed);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
    }
    noises.set(ctx, buffer);
  }
  return buffer;
}
let noiseOffset = 0;
/** A looping noise source starting at `t` (stopped at `stop`). */
function noise(ctx, t, stop) {
  const node = made(ctx, ctx.createBufferSource());
  node.buffer = noiseBuffer(ctx);
  node.loop = true;
  noiseOffset = (noiseOffset + 0.37) % 1.9;
  node.start(t, noiseOffset);
  node.stop(stop);
  return node;
}

const curves = new Map();
/**
 * A soft saturation curve (tanh), `drive` 0 (clean) to 1 (hot): quiet signals come out `1 + drive`
 * times louder, loud ones are rounded off (harmonics, not volume).
 */
function saturator(ctx, drive) {
  const key = Math.round(drive * 100);
  let curve = curves.get(key);
  if (!curve) {
    const d = key / 100;
    const k = 1 + 4 * d;
    curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = ((1 + d) * Math.tanh(k * x)) / k;
    }
    curves.set(key, curve);
  }
  const node = made(ctx, ctx.createWaveShaper());
  node.curve = curve;
  node.oversample = '2x';
  return node;
}

/** An envelope on `param`: up to `peak` in `attack`, down to `sustain × peak` in `decay`, held to `end`, released over `release`. */
function envelope(param, t, { attack = 0.005, decay = 0.1, sustain = 0, release = 0.08, peak = 1, end }) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + attack);
  const level = Math.max(0.0001, peak * sustain);
  if (sustain > 0) param.setTargetAtTime(level, t + attack, decay / 3);
  else param.setTargetAtTime(0.0001, t + attack, decay / 4);
  if (end !== undefined && sustain > 0) {
    param.setValueAtTime(level, Math.max(t + attack + decay, end));
    param.setTargetAtTime(0.0001, Math.max(t + attack + decay, end), release / 4);
  }
}

// ---- notes and harmony ------------------------------------------------------------------------------

const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** A note as a MIDI number: 62, 'D4' (62), 'F#3', 'Bb2'; a note name without an octave is in octave 4. */
export function midi(note) {
  if (typeof note === 'number') return note;
  const match = /^([A-Ga-g])([#b]*)(-?\d+)?$/.exec(String(note).trim());
  if (!match) throw new Error(`not a note: ${note}`);
  const pitch = PITCH[match[1].toUpperCase()] + [...match[2]].reduce((sum, sign) => sum + (sign === '#' ? 1 : -1), 0);
  const octave = match[3] === undefined ? 4 : Number(match[3]);
  return 12 * (octave + 1) + pitch;
}
/** A note's frequency in Hz. */
export const hz = (note) => 440 * Math.pow(2, (midi(note) - 69) / 12);

/** The scales a key can be in (semitones from the root). */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

/** A key's scale: `degree(n, octave)` is its n-th note (0 the root; negative and past 7 wrap octaves), `notes(octave)` all of them. */
export function scale(key = 'C', mode = 'minor') {
  const root = midi(`${String(key).replace(/-?\d+$/, '')}0`) % 12;
  const steps = SCALES[mode] ?? SCALES.minor;
  const degree = (n, octave = 4) => {
    const size = steps.length;
    const wrapped = ((n % size) + size) % size;
    return 12 * (octave + 1 + Math.floor(n / size)) + root + steps[wrapped];
  };
  return { root, mode, steps, degree, notes: (octave = 4) => steps.map((_, i) => degree(i, octave)) };
}

const QUALITIES = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  5: [0, 7],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  9: [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  11: [0, 4, 7, 10, 14, 17],
  m11: [0, 3, 7, 10, 14, 17],
  '7sus4': [0, 5, 7, 10],
};
/** A chord's notes: 'Dm7', 'Bbmaj7', 'F/A' (A in the bass), 'Csus4', in `octave` (its root's). */
export function chord(symbol, octave = 4) {
  const match = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(String(symbol).trim());
  if (!match) throw new Error(`not a chord: ${symbol}`);
  const quality = QUALITIES[match[2]];
  if (!quality) throw new Error(`not a chord quality: ${match[2]} (in ${symbol})`);
  const root = midi(`${match[1]}${octave}`);
  const notes = quality.map((step) => root + step);
  if (match[3]) {
    let bass = midi(`${match[3]}${octave}`);
    while (bass >= root) bass -= 12;
    notes.unshift(bass);
  }
  return notes;
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
/**
 * Chords from roman numerals in a key: 'i VI III VII', 'I V vi IV', 'ii7 V7 Imaj7'. Upper case is major,
 * lower minor, ° diminished; a suffix (7, maj7, sus4, add9…) is the chord's quality on top.
 */
export function progression(key, mode, numerals, octave = 3) {
  const sc = scale(key, mode);
  return String(numerals)
    .trim()
    .split(/[\s,|-]+/)
    .map((numeral) => {
      const match = /^(b|#)?([ivIV]+)(°|o)?(.*)$/.exec(numeral);
      if (!match) throw new Error(`not a numeral: ${numeral}`);
      const index = NUMERALS.indexOf(match[2].toUpperCase());
      if (index < 0) throw new Error(`not a numeral: ${numeral}`);
      const shift = match[1] === 'b' ? -1 : match[1] === '#' ? 1 : 0;
      const root = sc.degree(index, octave) + shift;
      const minor = match[2] === match[2].toLowerCase();
      const diminished = match[3] !== undefined;
      let suffix = match[4];
      let quality = diminished ? 'dim' : minor ? 'm' : '';
      if (suffix === '7' && minor) quality = diminished ? 'm7b5' : 'm7';
      else if (suffix === '7' && diminished) quality = 'm7b5';
      else if (suffix) quality = minor && !/^m/.test(suffix) && !['sus2', 'sus4', '5', '7sus4'].includes(suffix) ? `m${suffix}` : suffix;
      const steps = QUALITIES[quality] ?? QUALITIES[minor ? 'm' : ''];
      return steps.map((step) => root + step);
    });
}

/** Each chord turned (inverted, moved an octave) to lie close to the one before, inside [low, high]. */
export function voiceLead(chords, { low = 'A2', high = 'E5' } = {}) {
  const lo = midi(low);
  const hi = midi(high);
  let previous;
  return chords.map((notes) => {
    const options = [];
    for (let shift = -24; shift <= 24; shift += 12) {
      for (let inversion = 0; inversion < notes.length; inversion++) {
        const voiced = notes.map((n, i) => n + shift + (i < inversion ? 12 : 0)).sort((a, b) => a - b);
        if (voiced[0] >= lo && voiced.at(-1) <= hi) options.push(voiced);
      }
    }
    if (options.length === 0) return notes;
    const centre = previous ? previous.reduce((a, b) => a + b, 0) / previous.length : (lo + hi) / 2;
    const best = options.reduce((a, b) => {
      const da = Math.abs(a.reduce((x, y) => x + y, 0) / a.length - centre);
      const db = Math.abs(b.reduce((x, y) => x + y, 0) / b.length - centre);
      return db < da ? b : a;
    });
    previous = best;
    return best;
  });
}

/** A rhythm from text: 'x..x..x.' (x a hit, X an accent, . a rest), as velocities (0 for a rest). */
export const steps = (text) => [...String(text).replace(/\s/g, '')].map((c) => (c === 'X' ? 1 : c === 'x' ? 0.75 : c === 'o' ? 0.45 : 0));

/** `hits` spread as evenly as can be over `count` steps (Bjorklund), turned by `rotate`, as velocities. */
export function euclid(hits, count, rotate = 0) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(Math.floor(((i + rotate) * hits) / count) !== Math.floor(((i + rotate - 1) * hits) / count) ? 0.8 : 0);
  return out;
}

/** The notes of `notes` in turn, `pattern` 'up' | 'down' | 'updown' | 'random', over `octaves`. */
export function arp(notes, { pattern = 'up', octaves = 1, random = Math.random } = {}) {
  const base = [...notes].sort((a, b) => a - b);
  const all = [];
  for (let o = 0; o < octaves; o++) for (const n of base) all.push(n + 12 * o);
  if (pattern === 'down') return all.reverse();
  if (pattern === 'updown') return [...all, ...all.slice(1, -1).reverse()];
  if (pattern === 'random') return all.map(() => all[Math.floor(random() * all.length)]);
  return all;
}

// ---- the video --------------------------------------------------------------------------------------

/**
 * The video's parts, one per scene (a clip's pieces joined), each with an energy from 0 (quiet) to 3
 * (full), from what it shows:
 * - a motion scene, a still or a card at the start: an intro (1); at the end: the outro (1);
 * - a clip: 2; a sped-up clip (Claude at work): 3; the clip with Claude's answer: 3;
 * - in a video without clips (a reel of motion scenes) the scenes are the content (2), only a card
 *   at the end is the outro;
 * - the last part before the outro is the climax (3), so the music builds to it;
 * `energy`: what to set by a scene's id or label ({ s3: 0, Answer: 3 }), over all of these.
 */
export function sections(video, { energy = {} } = {}) {
  const parts = [];
  const scenes = video.scenes;
  const hasClips = scenes.some((scene) => scene.type === 'clip');
  scenes.forEach((scene, i) => {
    const previous = parts.at(-1);
    // pieces of one clip (a jump cut between) stay one part
    if (previous && previous.scene.type === 'clip' && scene.type === 'clip' && previous.scene.speed === scene.speed && video.cuts.some((cut) => cut.jump && Math.abs(cut.t - scene.start) < 1e-3)) {
      previous.end = scene.end;
      return;
    }
    let level = 2;
    let name = 'main';
    if (scene.type !== 'clip' && !hasClips) {
      if (i === scenes.length - 1 && i > 0 && scene.type === 'card') [level, name] = [1, 'outro'];
    } else if (scene.type !== 'clip') {
      if (i === 0) [level, name] = [1, 'intro'];
      else if (i === scenes.length - 1) [level, name] = [1, 'outro'];
      else [level, name] = [2, 'interlude'];
    } else if ((scene.speed ?? 1) > 1.5) [level, name] = [3, 'drive'];
    else if (video.markers.some((m) => m.kind === 'answer' && m.t >= scene.start && m.t < scene.end)) [level, name] = [3, 'payoff'];
    parts.push({ start: scene.start, end: scene.end, energy: level, name, scene, set: false });
    for (const key of [scene.id, scene.label, String(i)]) {
      if (key !== undefined && energy[key] !== undefined) Object.assign(parts.at(-1), { energy: Number(energy[key]), set: true });
    }
  });
  if (parts.length === 0) parts.push({ start: 0, end: video.duration, energy: 2, name: 'main', scene: null, set: false });
  // the music builds to the last part before the outro
  const last = parts.findLast((part) => part.name !== 'outro');
  if (parts.length >= 3 && last && !last.set && last.energy === 2) Object.assign(last, { energy: 3, name: 'climax' });
  return parts.map(({ set: _set, ...part }) => part);
}

/**
 * A tempo in [min, max] BPM and a start (`offset`, seconds) whose beats come closest to `times` (the
 * video's cuts, by default the scene changes): a cut on a beat feels made for the music. `snap`: beats
 * (1) or bars (4) to aim for.
 */
export function fitTempo(timesOrVideo, { min = 100, max = 128, snap = 1, step = 0.25 } = {}) {
  const times = Array.isArray(timesOrVideo) ? timesOrVideo : timesOrVideo.cuts.filter((cut) => !cut.jump).map((cut) => cut.t);
  if (times.length === 0) return { bpm: Math.round((min + max) / 2), offset: 0, error: 0 };
  let best = { bpm: min, offset: 0, error: Infinity };
  for (let bpm = min; bpm <= max + 1e-9; bpm += step) {
    const period = (60 / bpm) * snap;
    // the offset that best fits the first cut, tried for each cut in turn
    for (const anchor of times) {
      const offset = ((anchor % period) + period) % period;
      let error = 0;
      for (const t of times) {
        const phase = (((t - offset) % period) + period) % period;
        const miss = Math.min(phase, period - phase);
        error += miss * miss;
      }
      if (error < best.error - 1e-12) best = { bpm: Math.round(bpm * 100) / 100, offset, error };
    }
  }
  return { bpm: best.bpm, offset: best.offset, error: Math.sqrt(best.error / times.length) };
}

// ---- the song: the grid and the buses ---------------------------------------------------------------

/** A reverb's impulse: decorrelated noise in each ear, decaying over `seconds`, darker as it goes. */
function impulse(ctx, seconds, { brightness = 0.5, seed = 7 } = {}) {
  const length = Math.round(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const random = seeded(seed + c * 101);
    const data = buffer.getChannelData(c);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const x = i / length;
      // a one-pole low-pass that closes as the tail goes on
      const k = 0.15 + brightness * 0.8 * (1 - x);
      low += k * (random() * 2 - 1 - low);
      data[i] = low * Math.pow(1 - x, 2.4) * (i < ctx.sampleRate * 0.004 ? i / (ctx.sampleRate * 0.004) : 1);
    }
  }
  return buffer;
}

/**
 * A song on the video: a tempo grid from `offset` (seconds), a key, and buses into the music stem
 * (`audio.music`) through a glue compressor: `drums`, `bass`, `keys`, `pads`, `lead`, each with
 * sends to a shared reverb and delay. `song.duck(bus, times)` pumps a bus on the kicks.
 */
export function song(audio, { bpm = 120, offset = 0, key = 'C', mode = 'minor', swing = 0, reverb = 2.4, brightness = 0.5, delay = 0.75 } = {}) {
  const ctx = audio.context;
  const beat = 60 / bpm;
  const glue = made(ctx, ctx.createDynamicsCompressor());
  glue.threshold.value = -12;
  glue.knee.value = 10;
  glue.ratio.value = 1.8;
  glue.attack.value = 0.012;
  glue.release.value = 0.18;
  // a limiter after the glue: the music's peaks stay near -3 dBFS
  const limit = made(ctx, ctx.createDynamicsCompressor());
  limit.threshold.value = -4;
  limit.knee.value = 0;
  limit.ratio.value = 20;
  limit.attack.value = 0.001;
  limit.release.value = 0.08;
  // the compressors make up the gain they take; the level is set after them (about -14 LUFS when full)
  const master = amp(ctx, 0.8);
  master.connect(glue).connect(limit).connect(amp(ctx, 0.6)).connect(audio.music);

  const verb = made(ctx, ctx.createConvolver());
  verb.buffer = impulse(ctx, reverb, { brightness });
  const verbIn = amp(ctx, 1);
  const verbHigh = filter(ctx, 'highpass', 220);
  verbIn.connect(verbHigh).connect(verb).connect(amp(ctx, 0.5)).connect(master);

  // a ping-pong delay of `delay` beats, filtered so its repeats sit back
  const delayIn = amp(ctx, 1);
  const left = made(ctx, ctx.createDelay(4));
  const right = made(ctx, ctx.createDelay(4));
  left.delayTime.value = right.delayTime.value = beat * delay;
  const feedback = amp(ctx, 0.38);
  const tone = filter(ctx, 'lowpass', 3200);
  const merge = made(ctx, ctx.createChannelMerger(2));
  delayIn.connect(tone).connect(left);
  left.connect(right);
  right.connect(feedback).connect(left);
  left.connect(merge, 0, 0);
  right.connect(merge, 0, 1);
  merge.connect(amp(ctx, 0.45)).connect(master);

  const s = {
    audio,
    context: ctx,
    bpm,
    beat,
    bar: beat * 4,
    offset,
    key,
    mode,
    swing,
    scale: scale(key, mode),
    master,
    reverb: verbIn,
    delay: delayIn,
    random: audio.random,
    at: audio.at,
    /** Seconds of bar `bar`, beat `b` (fractions for sixteenths: 0.25), with the swing on the off sixteenths. */
    time(bar, b = 0) {
      const whole = bar * 4 + b;
      const sixteenth = Math.round(whole * 4);
      const off = Math.abs(whole * 4 - sixteenth) < 1e-6 && sixteenth % 2 === 1 ? swing * beat * 0.25 : 0;
      return offset + whole * beat + off;
    },
    /** The bar playing at `t` (a fraction inside it). */
    barAt(t) {
      return (t - offset) / (beat * 4);
    },
    /** Each bar that starts in [from, to): its number and its time. */
    bars(from, to) {
      const out = [];
      for (let b = Math.ceil(this.barAt(from) - 1e-6); this.time(b) < to - 1e-6; b++) out.push({ bar: b, t: this.time(b) });
      return out;
    },
    /** A bus into the master: its level, pan, sends (0–1), and filters. */
    bus({ gain = 1, pan = 0, reverb: wet = 0.15, delay: echo = 0, lowpass, highpass } = {}) {
      const input = amp(ctx, 1);
      let last = input;
      if (highpass) last = last.connect(filter(ctx, 'highpass', highpass));
      if (lowpass) last = last.connect(filter(ctx, 'lowpass', lowpass));
      const level = amp(ctx, gain);
      const duck = amp(ctx, 1);
      last.connect(duck).connect(level);
      const out = pan ? level.connect(panner(ctx, pan)) : level;
      out.connect(master);
      if (wet > 0) level.connect(amp(ctx, wet)).connect(verbIn);
      if (echo > 0) level.connect(amp(ctx, echo)).connect(delayIn);
      return { input, level, duck };
    },
    /** Pumps a bus: down by `depth` at each time, back over `release` seconds (sidechain to the kick). */
    duck(bus, times, { depth = 0.6, release = 0.18 } = {}) {
      for (const t of times) {
        bus.duck.gain.setValueAtTime(1 - depth, t);
        bus.duck.gain.setTargetAtTime(1, t + 0.01, release / 3);
      }
    },
  };
  s.drums = s.bus({ gain: 0.9, reverb: 0.08 });
  s.bassBus = s.bus({ gain: 0.8, reverb: 0 });
  s.keys = s.bus({ gain: 0.7, reverb: 0.25, delay: 0.12 });
  s.pads = s.bus({ gain: 0.55, reverb: 0.4, highpass: 140 });
  s.lead = s.bus({ gain: 0.6, reverb: 0.25, delay: 0.2 });
  return s;
}

const destinationOf = (s, bus, fallback) => (bus ? bus.input ?? bus : (s[fallback]?.input ?? s.master));
/** How long before a note its nodes are made. */
const LEAD = 0.05;

// ---- drums ------------------------------------------------------------------------------------------

/** A kick: a sine that drops from `punch` × 160 Hz to `tone`, a click on top, a little drive. */
export function kick(s, { tone = 48, punch = 1, decay = 0.42, click = 0.5, drive = 0.25, gain = 1, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const body = osc(ctx, 'sine', tone);
        body.frequency.setValueAtTime(tone * 3.4 * punch, t);
        body.frequency.exponentialRampToValueAtTime(tone, t + 0.07);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.003);
        env.gain.setTargetAtTime(0.0001, t + 0.03, decay / 4);
        const shape = saturator(ctx, drive);
        body.connect(env).connect(shape).connect(out);
        body.start(t);
        body.stop(t + decay * 2);
        if (click > 0) {
          const n = noise(ctx, t, t + 0.03);
          const hp = filter(ctx, 'highpass', 2500);
          const ce = amp(ctx, 0);
          ce.gain.setValueAtTime(click * velocity * gain * 0.5, t);
          ce.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
          n.connect(hp).connect(ce).connect(out);
        }
      });
    },
  };
}

/** A snare: a short tone and bright noise. `snap`: how much noise. */
export function snare(s, { tone = 190, snap = 0.8, decay = 0.18, gain = 0.8, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const body = osc(ctx, 'triangle', tone * 1.3);
        body.frequency.setValueAtTime(tone * 1.3, t);
        body.frequency.exponentialRampToValueAtTime(tone, t + 0.03);
        const be = amp(ctx, 0);
        be.gain.setValueAtTime(0.0001, t);
        be.gain.linearRampToValueAtTime(velocity * gain * 0.7, t + 0.002);
        be.gain.setTargetAtTime(0.0001, t + 0.01, 0.03);
        body.connect(be).connect(out);
        body.start(t);
        body.stop(t + 0.3);
        const n = noise(ctx, t, t + decay * 2.5);
        const bp = filter(ctx, 'bandpass', 3200, 0.6);
        const hp = filter(ctx, 'highpass', 900);
        const ne = amp(ctx, 0);
        ne.gain.setValueAtTime(0.0001, t);
        ne.gain.linearRampToValueAtTime(velocity * gain * snap, t + 0.002);
        ne.gain.setTargetAtTime(0.0001, t + 0.01, decay / 4);
        n.connect(bp).connect(hp).connect(ne).connect(out);
        if (s.reverb) ne.connect(amp(ctx, 0.15)).connect(s.reverb);
      });
    },
  };
}

/** A clap: three quick bursts of noise and a tail. */
export function clap(s, { tone = 1200, decay = 0.22, gain = 0.8, spread = 0.011, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const n = noise(ctx, t, t + decay * 3);
        const bp = filter(ctx, 'bandpass', tone, 1.2);
        const hp = filter(ctx, 'highpass', 600);
        const env = amp(ctx, 0);
        const g = velocity * gain;
        env.gain.setValueAtTime(0.0001, t);
        for (let k = 0; k < 3; k++) {
          const at = t + k * spread;
          env.gain.setValueAtTime(g, at);
          env.gain.setTargetAtTime(0.0001, at + 0.001, 0.004);
        }
        env.gain.setValueAtTime(g * 0.8, t + 3 * spread);
        env.gain.setTargetAtTime(0.0001, t + 3 * spread + 0.002, decay / 4);
        n.connect(bp).connect(hp).connect(env).connect(out);
        if (s.reverb) env.connect(amp(ctx, 0.3)).connect(s.reverb);
      });
    },
  };
}

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
/** A hi-hat: six square waves at metallic ratios, band-passed high. `open`: a longer one. */
export function hat(s, { tone = 1, decay = 0.045, openDecay = 0.32, gain = 0.32, pan = 0.15, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1, { open = false } = {}) {
      s.at(t - LEAD, () => {
        const length = open ? openDecay : decay;
        const n = noise(ctx, t, t + length * 2.5);
        const ring = filter(ctx, 'peaking', 9000 * tone, 4);
        ring.gain.value = 9;
        const hp = filter(ctx, 'highpass', 7200 * tone, 0.9);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain * 0.8, t + 0.001);
        env.gain.setTargetAtTime(0.0001, t + 0.002, length / 4);
        n.connect(hp).connect(ring).connect(env).connect(panner(ctx, pan)).connect(out);
      });
    },
  };
}

/** A shaker: soft noise, high, a slow front. */
export function shaker(s, { decay = 0.07, gain = 0.18, pan = -0.25, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const n = noise(ctx, t, t + decay * 4);
        const bp = filter(ctx, 'bandpass', 6500, 1.4);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + decay * 0.35);
        env.gain.setTargetAtTime(0.0001, t + decay * 0.4, decay / 3);
        n.connect(bp).connect(env).connect(panner(ctx, pan)).connect(out);
      });
    },
  };
}

/** A tom: a sine that falls a little, `pitch` its note. */
export function tom(s, { pitch = 'A2', decay = 0.5, gain = 0.8, pan = 0, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1, note = pitch) {
      s.at(t - LEAD, () => {
        const f = hz(note);
        const body = osc(ctx, 'sine', f);
        body.frequency.setValueAtTime(f * 1.6, t);
        body.frequency.exponentialRampToValueAtTime(f, t + 0.12);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.003);
        env.gain.setTargetAtTime(0.0001, t + 0.02, decay / 4);
        body.connect(env).connect(saturator(ctx, 0.3)).connect(panner(ctx, pan)).connect(out);
        if (s.reverb) env.connect(amp(ctx, 0.25)).connect(s.reverb);
        body.start(t);
        body.stop(t + decay * 2);
      });
    },
  };
}

/** A rim shot: a short knock. */
export function rim(s, { gain = 0.4, pan = 0.2, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(velocity * gain, t);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
        for (const f of [1720, 460]) {
          const o = osc(ctx, 'triangle', f);
          o.connect(env);
          o.start(t);
          o.stop(t + 0.05);
        }
        env.connect(filter(ctx, 'bandpass', 1700, 2)).connect(panner(ctx, pan)).connect(out);
      });
    },
  };
}

/** A crash cymbal: bright noise and metal, a long tail. */
export function crash(s, { decay = 1.8, gain = 0.28, pan = -0.2, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const n = noise(ctx, t, t + decay * 2);
        const hp = filter(ctx, 'highpass', 5200);
        const peak = filter(ctx, 'peaking', 8500);
        peak.gain.value = 6;
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.004);
        env.gain.setTargetAtTime(0.0001, t + 0.02, decay / 4);
        n.connect(hp).connect(peak).connect(env).connect(panner(ctx, pan)).connect(out);
        if (s.reverb) env.connect(amp(ctx, 0.3)).connect(s.reverb);
      });
    },
  };
}

/** A ride: metal with a bell, softer than a crash. */
export function ride(s, { decay = 0.6, gain = 0.16, pan = 0.3, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const sum = amp(ctx, 0.3);
        for (const f of METAL) {
          const o = osc(ctx, 'square', f * 1.9);
          o.connect(sum);
          o.start(t);
          o.stop(t + decay * 3);
        }
        const bp = filter(ctx, 'bandpass', 6500, 1.6);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.002);
        env.gain.setTargetAtTime(0.0001, t + 0.01, decay / 4);
        sum.connect(bp).connect(env).connect(panner(ctx, pan)).connect(out);
      });
    },
  };
}

// ---- tonal ------------------------------------------------------------------------------------------

const notesOf = (note) => (Array.isArray(note) ? note.map(midi) : [midi(note)]);

/** A bass: a saw (or `wave`) with a sine an octave down, through a low-pass that opens on each note, a little drive. */
export function bass(s, { wave = 'sawtooth', cutoff = 520, resonance = 3, envelope: amount = 3, decay = 0.22, sub = 0.5, drive = 0.3, gain = 0.38, release = 0.06, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'bassBus');
  return {
    play(t, note, seconds = s.beat / 2, { velocity = 1 } = {}) {
      s.at(t - LEAD, () => {
        const f = hz(notesOf(note)[0]);
        const lp = filter(ctx, 'lowpass', cutoff, resonance);
        lp.frequency.setValueAtTime(cutoff * (1 + amount * velocity), t);
        lp.frequency.setTargetAtTime(cutoff, t + 0.005, decay / 3);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.004);
        env.gain.setValueAtTime(velocity * gain, t + Math.max(0.01, seconds - release));
        env.gain.setTargetAtTime(0.0001, t + Math.max(0.01, seconds - release), release / 3);
        const main = osc(ctx, wave, f);
        main.connect(lp);
        const low = osc(ctx, 'sine', f / 2);
        const lowGain = amp(ctx, sub);
        low.connect(lowGain).connect(env);
        lp.connect(saturator(ctx, drive)).connect(env).connect(out);
        for (const o of [main, low]) {
          o.start(t);
          o.stop(t + seconds + release * 3);
        }
      });
    },
  };
}

/** A sub: a plain sine, felt more than heard. */
export function sub(s, { gain = 0.5, attack = 0.01, release = 0.12, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'bassBus');
  return {
    play(t, note, seconds = s.beat, { velocity = 1 } = {}) {
      s.at(t - LEAD, () => {
        const o = osc(ctx, 'sine', hz(notesOf(note)[0]));
        const env = amp(ctx, 0);
        envelope(env.gain, t, { attack, decay: 0.1, sustain: 1, release, peak: velocity * gain, end: t + seconds });
        o.connect(env).connect(out);
        o.start(t);
        o.stop(t + seconds + release * 4);
      });
    },
  };
}

/** A pad: `voices` detuned saws a note, spread across the stereo field, a slow filter. */
export function pad(s, { wave = 'sawtooth', voices = 3, detune = 14, cutoff = 1500, attack = 0.8, release = 1.4, width = 0.8, gain = 0.12, motion = 0.25, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'pads');
  return {
    play(t, notes, seconds = s.bar, { velocity = 1, brightness = 1 } = {}) {
      s.at(t - LEAD, () => {
        const lp = filter(ctx, 'lowpass', cutoff * brightness, 0.9);
        // the filter breathes over the chord
        lp.frequency.setValueAtTime(cutoff * brightness * (1 - motion), t);
        lp.frequency.linearRampToValueAtTime(cutoff * brightness, t + Math.min(seconds, attack * 2));
        lp.frequency.linearRampToValueAtTime(cutoff * brightness * (1 - motion * 0.6), t + seconds + release);
        const env = amp(ctx, 0);
        const list = notesOf(notes);
        // as loud with any number of voices and notes
        const level = (velocity * gain * 2) / Math.sqrt(voices * list.length);
        envelope(env.gain, t, { attack, decay: 0.5, sustain: 1, release, peak: level, end: t + seconds });
        lp.connect(env).connect(out);
        list.forEach((n, k) => {
          for (let v = 0; v < voices; v++) {
            const spread = voices === 1 ? 0 : v / (voices - 1) - 0.5;
            const o = osc(ctx, wave, hz(n));
            o.detune.value = spread * 2 * detune + (s.random() - 0.5) * 3;
            const p = panner(ctx, spread * 2 * width * (k % 2 ? -1 : 1));
            o.connect(p).connect(lp);
            o.start(t);
            o.stop(t + seconds + release * 2);
          }
        });
      });
    },
  };
}

/** A pluck: a bright saw and square that close fast; good for arpeggios. */
export function pluck(s, { wave = 'sawtooth', cutoff = 900, decay = 0.18, gain = 0.16, pan = 0, resonance = 2, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'keys');
  return {
    play(t, notes, seconds = s.beat / 4, { velocity = 1, pan: at = pan } = {}) {
      s.at(t - LEAD, () => {
        const lp = filter(ctx, 'lowpass', cutoff, resonance);
        lp.frequency.setValueAtTime(cutoff * 7 * velocity, t);
        lp.frequency.setTargetAtTime(cutoff, t + 0.002, decay / 3);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.002);
        env.gain.setTargetAtTime(0.0001, t + 0.004, Math.max(decay, seconds) / 3);
        lp.connect(env).connect(panner(ctx, at)).connect(out);
        for (const n of notesOf(notes)) {
          for (const [type, level, cents] of [
            [wave, 1, -4],
            ['square', 0.5, 4],
          ]) {
            const o = osc(ctx, type, hz(n));
            o.detune.value = cents;
            const g = amp(ctx, level);
            o.connect(g).connect(lp);
            o.start(t);
            o.stop(t + Math.max(decay, seconds) * 2 + 0.03);
          }
        }
      });
    },
  };
}

/** Keys: an electric piano by FM (a tine and a bark that fade), soft and warm. `type`: 'epiano' | 'bell' | 'glass'. */
export function keys(s, { type = 'epiano', decay = 2.2, gain = 0.2, release = 0.25, tremolo = 0.15, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'keys');
  const [ratio, index, tine] = type === 'bell' ? [3.5, 6, 0] : type === 'glass' ? [2, 3, 0.6] : [1, 2.2, 0.35];
  return {
    play(t, notes, seconds = s.beat, { velocity = 1 } = {}) {
      s.at(t - LEAD, () => {
        const env = amp(ctx, 0);
        const length = Math.min(seconds, decay);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.003);
        env.gain.setTargetAtTime(velocity * gain * 0.3, t + 0.01, decay / 3);
        env.gain.setValueAtTime(velocity * gain * 0.3 * Math.exp(-3 * (length / decay)) + 0.0001, t + length);
        env.gain.setTargetAtTime(0.0001, t + length, release / 3);
        let last = env;
        if (tremolo > 0) {
          const trem = amp(ctx, 1 - tremolo / 2);
          const lfo = osc(ctx, 'sine', 4.5);
          const depth = amp(ctx, tremolo / 2);
          lfo.connect(depth).connect(trem.gain);
          lfo.start(t);
          lfo.stop(t + length + release * 3);
          env.connect(trem);
          last = trem;
        }
        last.connect(out);
        for (const n of notesOf(notes)) {
          const f = hz(n);
          const carrier = osc(ctx, 'sine', f);
          const modulator = osc(ctx, 'sine', f * ratio);
          const depth = amp(ctx, 0);
          depth.gain.setValueAtTime(f * index * velocity, t);
          depth.gain.setTargetAtTime(f * index * 0.15, t + 0.005, (type === 'bell' ? 1.2 : 0.35) / 3);
          modulator.connect(depth).connect(carrier.frequency);
          const voice = amp(ctx, 1 / Math.sqrt(notesOf(notes).length));
          carrier.connect(voice).connect(env);
          const nodes = [carrier, modulator];
          if (tine > 0) {
            const bright = osc(ctx, 'sine', f * 14);
            const bd = amp(ctx, 0);
            bd.gain.setValueAtTime(f * tine * velocity, t);
            bd.gain.setTargetAtTime(0, t + 0.002, 0.02);
            bright.connect(bd).connect(carrier.frequency);
            nodes.push(bright);
          }
          for (const o of nodes) {
            o.start(t);
            o.stop(t + length + release * 4);
          }
        }
      });
    },
  };
}

/** A bell: keys with a bell's ratio, ringing long. */
export const bell = (s, options = {}) => keys(s, { type: 'bell', decay: 3.5, gain: 0.12, tremolo: 0, ...options });

/** Strings: an ensemble of saws, slow in, a gentle vibrato. */
export function strings(s, { cutoff = 2400, attack = 0.5, release = 1.2, gain = 0.1, vibrato = 6, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'pads');
  return {
    play(t, notes, seconds = s.bar, { velocity = 1 } = {}) {
      s.at(t - LEAD, () => {
        const lp = filter(ctx, 'lowpass', cutoff, 0.5);
        const env = amp(ctx, 0);
        envelope(env.gain, t, { attack, decay: 0.3, sustain: 1, release, peak: velocity * gain, end: t + seconds });
        lp.connect(env).connect(out);
        const lfo = osc(ctx, 'sine', 5.2);
        const depth = amp(ctx, vibrato);
        lfo.connect(depth);
        lfo.start(t);
        lfo.stop(t + seconds + release * 2);
        for (const n of notesOf(notes)) {
          for (const cents of [-11, -4, 4, 11]) {
            const o = osc(ctx, 'sawtooth', hz(n));
            o.detune.value = cents;
            depth.connect(o.detune);
            o.connect(panner(ctx, cents / 14)).connect(lp);
            o.start(t);
            o.stop(t + seconds + release * 2);
          }
        }
      });
    },
  };
}

/** A lead: one voice (a saw or a square) with a glide from the note before and a vibrato that comes in late. */
export function lead(s, { wave = 'square', cutoff = 2600, gain = 0.12, glide = 0.04, vibrato = 12, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'lead');
  let previous;
  return {
    play(t, note, seconds = s.beat, { velocity = 1 } = {}) {
      const f = hz(notesOf(note)[0]);
      const from = previous;
      previous = f;
      s.at(t - LEAD, () => {
        const o = osc(ctx, wave, f);
        if (from && glide > 0) {
          o.frequency.setValueAtTime(from, t);
          o.frequency.exponentialRampToValueAtTime(f, t + glide);
        }
        const lfo = osc(ctx, 'sine', 5.5);
        const depth = amp(ctx, 0);
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(vibrato, t + Math.max(0.05, seconds * 0.6));
        lfo.connect(depth).connect(o.detune);
        const lp = filter(ctx, 'lowpass', cutoff, 1);
        const env = amp(ctx, 0);
        envelope(env.gain, t, { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.12, peak: velocity * gain, end: t + seconds });
        o.connect(lp).connect(env).connect(out);
        for (const node of [o, lfo]) {
          node.start(t);
          node.stop(t + seconds + 0.6);
        }
      });
    },
  };
}

// ---- effects ----------------------------------------------------------------------------------------

const effectsReverbs = new WeakMap();
/** The effects bus's own reverb (effects stay on their stem, loud and clear under speech). */
function effectsReverb(audio) {
  let input = effectsReverbs.get(audio.context);
  if (!input) {
    const ctx = audio.context;
    input = amp(ctx, 1);
    const verb = made(ctx, ctx.createConvolver());
    verb.buffer = impulse(ctx, 2.8, { brightness: 0.6, seed: 31 });
    input.connect(filter(ctx, 'highpass', 180)).connect(verb).connect(amp(ctx, 0.6)).connect(audio.effects);
    effectsReverbs.set(ctx, input);
  }
  return input;
}

/** Where an effect goes: `destination`, else the effects bus; `audioOf` takes a song or the composition's audio. */
const audioOf = (target) => target.audio ?? target;
function routeEffect(target, options) {
  const audio = audioOf(target);
  return { audio, ctx: audio.context, out: options.destination ?? audio.effects, verb: options.reverb === 0 ? null : effectsReverb(audio), volume: options.volume ?? 1 };
}
const at = (target, t, fn) => audioOf(target).at(t - 3, fn);

/** Rising noise and a rising tone that end on `t` (a cut), over `length` seconds. */
function riser(target, t, options = {}) {
  const { length = 2, tone = true, height = 1 } = options;
  at(target, t - length, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const start = Math.max(0, t - length);
    const n = noise(ctx, start, t + 0.05);
    const bp = filter(ctx, 'bandpass', 300, 2.2);
    bp.frequency.setValueAtTime(250, start);
    bp.frequency.exponentialRampToValueAtTime(7000 * height, t);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.32 * volume, t - 0.01);
    env.gain.linearRampToValueAtTime(0.0001, t + 0.03);
    n.connect(bp).connect(env).connect(out);
    if (verb) env.connect(amp(ctx, 0.35)).connect(verb);
    if (tone) {
      const o = osc(ctx, 'sawtooth', 110);
      o.frequency.setValueAtTime(110, start);
      o.frequency.exponentialRampToValueAtTime(880 * height, t);
      const lp = filter(ctx, 'lowpass', 400, 4);
      lp.frequency.setValueAtTime(400, start);
      lp.frequency.exponentialRampToValueAtTime(5000, t);
      const g = amp(ctx, 0);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.12 * volume, t - 0.01);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.03);
      o.connect(lp).connect(g).connect(out);
      o.start(start);
      o.stop(t + 0.1);
    }
  });
}

/** A hit on `t`: a deep boom, a crack, and a long tail. */
function impact(target, t, options = {}) {
  const { size = 1 } = options;
  at(target, t, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const boom = osc(ctx, 'sine', 40);
    boom.frequency.setValueAtTime(110, t);
    boom.frequency.exponentialRampToValueAtTime(36, t + 0.25);
    const be = amp(ctx, 0);
    be.gain.setValueAtTime(0.0001, t);
    be.gain.linearRampToValueAtTime(0.5 * volume, t + 0.004);
    be.gain.setTargetAtTime(0.0001, t + 0.05, (0.6 * size) / 3);
    boom.connect(be).connect(saturator(ctx, 0.5)).connect(out);
    boom.start(t);
    boom.stop(t + 2.5 * size);
    const n = noise(ctx, t, t + 0.6);
    const lp = filter(ctx, 'lowpass', 5000);
    const ne = amp(ctx, 0);
    ne.gain.setValueAtTime(0.28 * volume, t);
    ne.gain.setTargetAtTime(0.0001, t + 0.005, 0.05);
    n.connect(lp).connect(ne).connect(out);
    if (verb) {
      be.connect(amp(ctx, 0.3)).connect(verb);
      ne.connect(amp(ctx, 0.8 * size)).connect(verb);
    }
  });
}

/** Air rushing past, loudest on `t`, from left to right (`direction` -1 for right to left). */
function whoosh(target, t, options = {}) {
  const { length = 0.8, direction = 1, height = 1 } = options;
  at(target, t - length / 2, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const start = Math.max(0, t - length / 2);
    const end = t + length / 2;
    const n = noise(ctx, start, end + 0.05);
    const bp = filter(ctx, 'bandpass', 500, 1.6);
    bp.frequency.setValueAtTime(400 * height, start);
    bp.frequency.exponentialRampToValueAtTime(3800 * height, t);
    bp.frequency.exponentialRampToValueAtTime(700 * height, end);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.4 * volume, t);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    const p = panner(ctx, -0.7 * direction);
    p.pan.setValueAtTime(-0.7 * direction, start);
    p.pan.linearRampToValueAtTime(0.7 * direction, end);
    n.connect(bp).connect(env).connect(p).connect(out);
    if (verb) env.connect(amp(ctx, 0.25)).connect(verb);
  });
}

/** A short whoosh in that lands on `t`. */
const swooshIn = (target, t, options = {}) => whoosh(target, t - 0.12, { length: 0.3, height: 1.3, ...options });

/** Falling noise and a falling tone from `t`, over `length`. */
function downlifter(target, t, options = {}) {
  const { length = 1.6 } = options;
  at(target, t, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const n = noise(ctx, t, t + length + 0.1);
    const bp = filter(ctx, 'bandpass', 6000, 2);
    bp.frequency.setValueAtTime(6000, t);
    bp.frequency.exponentialRampToValueAtTime(200, t + length);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.45 * volume, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    n.connect(bp).connect(env).connect(out);
    if (verb) env.connect(amp(ctx, 0.3)).connect(verb);
  });
}

/** A sub that drops from `t`: a falling sine you feel. */
function subDrop(target, t, options = {}) {
  const { length = 1.6 } = options;
  at(target, t, () => {
    const { ctx, out, volume } = routeEffect(target, options);
    const o = osc(ctx, 'sine', 90);
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + length);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.55 * volume, t + 0.01);
    env.gain.setTargetAtTime(0.0001, t + length * 0.5, length / 4);
    o.connect(env).connect(out);
    o.start(t);
    o.stop(t + length * 1.5);
  });
}

/** A cinematic braam on `t`: low brass of detuned saws through an opening filter, driven. */
function braam(target, t, options = {}) {
  const { note = 'D1', length = 2.4 } = options;
  at(target, t, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const lp = filter(ctx, 'lowpass', 150, 3);
    lp.frequency.setValueAtTime(150, t);
    lp.frequency.exponentialRampToValueAtTime(1800, t + 0.25);
    lp.frequency.setTargetAtTime(300, t + 0.4, length / 3);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.35 * volume, t + 0.06);
    env.gain.setTargetAtTime(0.0001, t + length * 0.5, length / 4);
    lp.connect(saturator(ctx, 0.7)).connect(env).connect(out);
    if (verb) env.connect(amp(ctx, 0.5)).connect(verb);
    for (const [n, cents] of [
      [note, -12],
      [note, 9],
      [midi(note) + 12, -6],
      [midi(note) + 19, 5],
    ]) {
      const o = osc(ctx, 'sawtooth', hz(n));
      o.detune.value = cents;
      o.connect(lp);
      o.start(t);
      o.stop(t + length * 2);
    }
  });
}

/** A noise swell that ends on `t` (a cymbal played backwards). */
function reverseCymbal(target, t, options = {}) {
  const { length = 1.5 } = options;
  at(target, t - length, () => {
    const { ctx, out, volume } = routeEffect(target, options);
    const start = Math.max(0, t - length);
    const n = noise(ctx, start, t + 0.02);
    const hp = filter(ctx, 'highpass', 4000);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.35 * volume, t - 0.005);
    env.gain.linearRampToValueAtTime(0.0001, t + 0.01);
    n.connect(hp).connect(env).connect(panner(ctx, 0.2)).connect(out);
  });
}

/** A bubble pop: a sine that leaps up and falls. */
function pop(target, t, options = {}) {
  const { pitch = 1 } = options;
  at(target, t, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const o = osc(ctx, 'sine', 400 * pitch);
    o.frequency.setValueAtTime(260 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(980 * pitch, t + 0.025);
    o.frequency.exponentialRampToValueAtTime(520 * pitch, t + 0.09);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.45 * volume, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(env).connect(out);
    if (verb) env.connect(amp(ctx, 0.12)).connect(verb);
    o.start(t);
    o.stop(t + 0.15);
  });
}

/** A UI click: a tiny tick of noise and a high knock. */
function click(target, t, options = {}) {
  at(target, t, () => {
    const { ctx, out, volume } = routeEffect(target, options);
    const n = noise(ctx, t, t + 0.02);
    const bp = filter(ctx, 'bandpass', 4200, 1.5);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.6 * volume, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    n.connect(bp).connect(env).connect(out);
    const o = osc(ctx, 'square', 1900);
    const oe = amp(ctx, 0);
    oe.gain.setValueAtTime(0.06 * volume, t);
    oe.gain.exponentialRampToValueAtTime(0.0001, t + 0.008);
    o.connect(oe).connect(out);
    o.start(t);
    o.stop(t + 0.02);
  });
}

/** A soft tick (a counter, a step). */
function tick(target, t, options = {}) {
  at(target, t, () => {
    const { ctx, out, volume } = routeEffect(target, options);
    const o = osc(ctx, 'sine', 2300);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.25 * volume, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(env).connect(out);
    o.start(t);
    o.stop(t + 0.05);
  });
}

/** A bell-like ding (a notification, a done). */
function ding(target, t, options = {}) {
  const { note = 'E6' } = options;
  at(target, t, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const f = hz(note);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.32 * volume, t + 0.003);
    env.gain.setTargetAtTime(0.0001, t + 0.01, 0.35);
    env.connect(out);
    if (verb) env.connect(amp(ctx, 0.4)).connect(verb);
    for (const [ratio, level] of [
      [1, 1],
      [2.76, 0.35],
      [5.4, 0.12],
    ]) {
      const o = osc(ctx, 'sine', f * ratio);
      const g = amp(ctx, level);
      o.connect(g).connect(env);
      o.start(t);
      o.stop(t + 2);
    }
  });
}

/** Three bell notes up a chord: something appears. */
function chime(target, t, options = {}) {
  const { notes = ['C6', 'E6', 'G6'], gap = 0.07 } = options;
  notes.forEach((n, i) => ding(target, t + i * gap, { ...options, note: n, volume: (options.volume ?? 1) * (0.8 - i * 0.1) }));
}

/** Two bright notes up a fifth: it worked. */
function success(target, t, options = {}) {
  chime(target, t, { notes: ['G5', 'D6'], gap: 0.09, ...options });
}

/** Two dull notes down a semitone: it did not. */
function error(target, t, options = {}) {
  ['A3', 'G#3'].forEach((n, i) =>
    at(target, t, () => {
      const { ctx, out, volume } = routeEffect(target, options);
      const start = t + i * 0.13;
      const o = osc(ctx, 'square', hz(n));
      const lp = filter(ctx, 'lowpass', 1400);
      const env = amp(ctx, 0);
      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(0.14 * volume, start + 0.005);
      env.gain.setTargetAtTime(0.0001, start + 0.08, 0.04);
      o.connect(lp).connect(env).connect(out);
      o.start(start);
      o.stop(start + 0.4);
    }),
  );
}

/** A chord that swells up to `t` and stops (a breath before a reveal). */
function swell(target, t, options = {}) {
  const { length = 2, notes = ['D3', 'A3', 'D4', 'F4'] } = options;
  at(target, t - length, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const start = Math.max(0, t - length);
    const lp = filter(ctx, 'lowpass', 300, 1);
    lp.frequency.setValueAtTime(300, start);
    lp.frequency.exponentialRampToValueAtTime(4000, t);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.18 * volume, t - 0.02);
    env.gain.linearRampToValueAtTime(0.0001, t + 0.04);
    lp.connect(env).connect(out);
    if (verb) env.connect(amp(ctx, 0.4)).connect(verb);
    for (const n of notes) {
      for (const cents of [-8, 8]) {
        const o = osc(ctx, 'sawtooth', hz(n));
        o.detune.value = cents;
        o.connect(lp);
        o.start(start);
        o.stop(t + 0.1);
      }
    }
  });
}

/** A burst of keys typed fast, from `t`. */
function typeBurst(target, t, options = {}) {
  const { count = 9, rate = 13 } = options;
  const random = seeded(Math.round(t * 1000));
  let when = t;
  for (let i = 0; i < count; i++) {
    const start = when;
    at(target, start, () => {
      const { ctx, out, volume } = routeEffect(target, { ...options, reverb: 0 });
      const n = noise(ctx, start, start + 0.04);
      const bp = filter(ctx, 'bandpass', 2400 + random() * 1600, 1.8);
      const env = amp(ctx, 0);
      env.gain.setValueAtTime(0.35 * volume * (0.7 + random() * 0.3), start);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.025);
      n.connect(bp).connect(env).connect(panner(ctx, (random() - 0.5) * 0.4)).connect(out);
    });
    when += (1 / rate) * (0.7 + random() * 0.6);
  }
}

/** A digital stutter on `t`: short bursts of a square and noise. */
function glitch(target, t, options = {}) {
  const { length = 0.25 } = options;
  const random = seeded(Math.round(t * 997));
  at(target, t, () => {
    const { ctx, out, volume } = routeEffect(target, { ...options, reverb: 0 });
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, t);
    for (let x = t; x < t + length; x += 0.028) {
      env.gain.setValueAtTime(random() < 0.6 ? 0.22 * volume : 0.0001, x);
    }
    env.gain.setValueAtTime(0.0001, t + length);
    const o = osc(ctx, 'square', 180 + random() * 600);
    const n = noise(ctx, t, t + length + 0.02);
    const mix = amp(ctx, 0.5);
    o.connect(mix);
    n.connect(mix);
    mix.connect(filter(ctx, 'bandpass', 1800, 0.8)).connect(env).connect(out);
    o.start(t);
    o.stop(t + length + 0.02);
  });
}

/** The effects, each at a moment `t` of the video: `fx.riser(audio, t, { length })`. A song works in place of `audio`. */
export const fx = { riser, impact, whoosh, swooshIn, downlifter, subDrop, braam, reverseCymbal, pop, click, tick, ding, chime, success, error, swell, typeBurst, glitch };

/**
 * The built-in sounds a project's `sounds` (and `cuttle sound add`) can name, with what each is. A
 * sound that has a length starts before its moment so that it ends on it (a riser), or is centred on
 * it (a whoosh).
 */
export const SOUND_LIST = [
  ['whoosh', 'air rushing past, loudest on its moment, left to right'],
  ['swoosh-in', 'a short whoosh that lands on its moment'],
  ['riser', 'rising noise and tone for 2 s that end on its moment (a cut, a reveal)'],
  ['impact', 'a deep boom and a crack with a long tail'],
  ['downlifter', 'falling noise from its moment'],
  ['sub-drop', 'a falling sub you feel more than hear'],
  ['braam', 'a cinematic low brass hit'],
  ['reverse-cymbal', 'a cymbal swell that ends on its moment'],
  ['swell', 'a chord that swells up to its moment'],
  ['pop', 'a bubble pop (something appears)'],
  ['click', 'a UI click'],
  ['tick', 'a soft tick (a counter, a step)'],
  ['ding', 'a bell-like ding (a notification)'],
  ['chime', 'three bell notes up a chord'],
  ['success', 'two bright notes up: it worked'],
  ['error', 'two dull notes down: it did not'],
  ['type-burst', 'a burst of keys typed fast'],
  ['glitch', 'a digital stutter'],
];
const BY_NAME = {
  whoosh,
  'swoosh-in': swooshIn,
  riser,
  impact,
  downlifter,
  'sub-drop': subDrop,
  braam,
  'reverse-cymbal': reverseCymbal,
  swell,
  pop,
  click,
  tick,
  ding,
  chime,
  success,
  error,
  'type-burst': typeBurst,
  glitch,
};
/** The built-in sounds by name, as the runtime plays a project's `sounds`: (audio, t, { volume, destination }). */
export const SOUNDS = Object.fromEntries(Object.entries(BY_NAME).map(([name, play]) => [name, (audio, t, options) => play(audio, t, options)]));
```

Its types, served beside it for whoever writes a page:

`packages/motion-kit/kit/sound.d.ts`:

```ts
// Types of Cuttle's sound kit (sound.js), served with it at cuttle-motion://kit/sound.d.ts.

/** A note: a MIDI number (62) or a name ('D4', 'F#3', 'Bb2'; without an octave, octave 4). */
export type Note = number | string;

/** The video as its music sees it (`cuttle.video`), in output seconds. */
export interface Video {
  duration: number;
  fps: number;
  scenes: { index: number; id?: string; label?: string; type: 'clip' | 'still' | 'card' | 'motion'; start: number; end: number; speed?: number; from?: number; to?: number; src?: string }[];
  cuts: { t: number; scene: number; jump: boolean }[];
  clicks: number[];
  keys: number[];
  words: { t: number; end: number; text: string }[];
  speech: { start: number; end: number }[];
  markers: { t: number; kind: string; label?: string }[];
  zooms: { start: number; end: number; label?: string }[];
}

/** What a composition gets from `cuttle.music(compose)`. */
export interface Audio {
  context: OfflineAudioContext;
  /** The music's bus: lowered under speech by the export. */
  music: GainNode;
  /** The effects' bus: never lowered. */
  effects: GainNode;
  video: Video;
  params: Record<string, unknown>;
  duration: number;
  /** Runs `fn` shortly before the render reaches `t`: make a note's nodes there, not up front. */
  at(t: number, fn: () => void): void;
  random(): number;
}

export interface Bus {
  input: GainNode;
  level: GainNode;
  duck: GainNode;
}

export interface Song {
  audio: Audio;
  context: OfflineAudioContext;
  bpm: number;
  /** Seconds of a beat, and of a bar (four beats). */
  beat: number;
  bar: number;
  /** Where bar 0 starts (seconds). */
  offset: number;
  key: string;
  mode: keyof typeof SCALES;
  swing: number;
  scale: Scale;
  master: GainNode;
  reverb: GainNode;
  delay: GainNode;
  drums: Bus;
  bassBus: Bus;
  keys: Bus;
  pads: Bus;
  lead: Bus;
  random(): number;
  at(t: number, fn: () => void): void;
  /** Seconds of bar `bar`, beat `beat` (0.25 a sixteenth), with the swing. */
  time(bar: number, beat?: number): number;
  barAt(t: number): number;
  bars(from: number, to: number): { bar: number; t: number }[];
  bus(options?: { gain?: number; pan?: number; reverb?: number; delay?: number; lowpass?: number; highpass?: number }): Bus;
  duck(bus: Bus, times: number[], options?: { depth?: number; release?: number }): void;
}

export interface Scale {
  root: number;
  mode: string;
  steps: number[];
  degree(n: number, octave?: number): number;
  notes(octave?: number): number[];
}

export interface Drum {
  hit(t: number, velocity?: number, options?: { open?: boolean }): void;
}
export interface Tom {
  hit(t: number, velocity?: number, note?: Note): void;
}
export interface Instrument {
  play(t: number, note: Note | Note[], seconds?: number, options?: { velocity?: number; brightness?: number; pan?: number }): void;
}

type BusOption = { bus?: Bus | AudioNode };

export function song(audio: Audio, options?: { bpm?: number; offset?: number; key?: string; mode?: keyof typeof SCALES; swing?: number; reverb?: number; brightness?: number; delay?: number }): Song;

export function kick(s: Song, options?: { tone?: number; punch?: number; decay?: number; click?: number; drive?: number; gain?: number } & BusOption): Drum;
export function snare(s: Song, options?: { tone?: number; snap?: number; decay?: number; gain?: number } & BusOption): Drum;
export function clap(s: Song, options?: { tone?: number; decay?: number; gain?: number; spread?: number } & BusOption): Drum;
export function hat(s: Song, options?: { tone?: number; decay?: number; openDecay?: number; gain?: number; pan?: number } & BusOption): Drum;
export function shaker(s: Song, options?: { decay?: number; gain?: number; pan?: number } & BusOption): Drum;
export function tom(s: Song, options?: { pitch?: Note; decay?: number; gain?: number; pan?: number } & BusOption): Tom;
export function rim(s: Song, options?: { gain?: number; pan?: number } & BusOption): Drum;
export function crash(s: Song, options?: { decay?: number; gain?: number; pan?: number } & BusOption): Drum;
export function ride(s: Song, options?: { decay?: number; gain?: number; pan?: number } & BusOption): Drum;

export function bass(s: Song, options?: { wave?: OscillatorType; cutoff?: number; resonance?: number; envelope?: number; decay?: number; sub?: number; drive?: number; gain?: number; release?: number } & BusOption): Instrument;
export function sub(s: Song, options?: { gain?: number; attack?: number; release?: number } & BusOption): Instrument;
export function pad(s: Song, options?: { wave?: OscillatorType; voices?: number; detune?: number; cutoff?: number; attack?: number; release?: number; width?: number; gain?: number; motion?: number } & BusOption): Instrument;
export function pluck(s: Song, options?: { wave?: OscillatorType; cutoff?: number; decay?: number; gain?: number; pan?: number; resonance?: number } & BusOption): Instrument;
export function keys(s: Song, options?: { type?: 'epiano' | 'bell' | 'glass'; decay?: number; gain?: number; release?: number; tremolo?: number } & BusOption): Instrument;
export function bell(s: Song, options?: { decay?: number; gain?: number; release?: number } & BusOption): Instrument;
export function strings(s: Song, options?: { cutoff?: number; attack?: number; release?: number; gain?: number; vibrato?: number } & BusOption): Instrument;
export function lead(s: Song, options?: { wave?: OscillatorType; cutoff?: number; gain?: number; glide?: number; vibrato?: number } & BusOption): Instrument;

type Target = Audio | Song;
type EffectOptions = { volume?: number; destination?: AudioNode; reverb?: 0 };
export const fx: {
  riser(target: Target, t: number, options?: EffectOptions & { length?: number; tone?: boolean; height?: number }): void;
  impact(target: Target, t: number, options?: EffectOptions & { size?: number }): void;
  whoosh(target: Target, t: number, options?: EffectOptions & { length?: number; direction?: 1 | -1; height?: number }): void;
  swooshIn(target: Target, t: number, options?: EffectOptions): void;
  downlifter(target: Target, t: number, options?: EffectOptions & { length?: number }): void;
  subDrop(target: Target, t: number, options?: EffectOptions & { length?: number }): void;
  braam(target: Target, t: number, options?: EffectOptions & { note?: Note; length?: number }): void;
  reverseCymbal(target: Target, t: number, options?: EffectOptions & { length?: number }): void;
  pop(target: Target, t: number, options?: EffectOptions & { pitch?: number }): void;
  click(target: Target, t: number, options?: EffectOptions): void;
  tick(target: Target, t: number, options?: EffectOptions): void;
  ding(target: Target, t: number, options?: EffectOptions & { note?: Note }): void;
  chime(target: Target, t: number, options?: EffectOptions & { notes?: Note[]; gap?: number }): void;
  success(target: Target, t: number, options?: EffectOptions): void;
  error(target: Target, t: number, options?: EffectOptions): void;
  swell(target: Target, t: number, options?: EffectOptions & { length?: number; notes?: Note[] }): void;
  typeBurst(target: Target, t: number, options?: EffectOptions & { count?: number; rate?: number }): void;
  glitch(target: Target, t: number, options?: EffectOptions & { length?: number }): void;
};
/** The built-in sounds of a project's `sounds`: [name, what it is]. */
export const SOUND_LIST: [name: string, description: string][];
export const SOUNDS: Record<string, (audio: Audio, t: number, options: { volume: number; destination: AudioNode }) => void>;

export function midi(note: Note): number;
export function hz(note: Note): number;
export const SCALES: Record<'major' | 'minor' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'harmonicMinor' | 'pentatonic' | 'minorPentatonic' | 'blues', number[]>;
export function scale(key?: string, mode?: keyof typeof SCALES): Scale;
export function chord(symbol: string, octave?: number): number[];
export function progression(key: string, mode: keyof typeof SCALES, numerals: string, octave?: number): number[][];
export function voiceLead(chords: number[][], options?: { low?: Note; high?: Note }): number[][];
export function steps(pattern: string): number[];
export function euclid(hits: number, count: number, rotate?: number): number[];
export function arp(notes: number[], options?: { pattern?: 'up' | 'down' | 'updown' | 'random'; octaves?: number; random?: () => number }): number[];

export interface Section {
  start: number;
  end: number;
  /** 0 quiet … 3 full. */
  energy: number;
  name: 'intro' | 'outro' | 'interlude' | 'main' | 'drive' | 'payoff' | 'climax';
  scene: Video['scenes'][number] | null;
}
export function sections(video: Video, options?: { energy?: Record<string, number> }): Section[];
export function fitTempo(timesOrVideo: number[] | Video, options?: { min?: number; max?: number; snap?: number; step?: number }): { bpm: number; offset: number; error: number };
```

The page a video's sounds render in when it has no music page:

`packages/motion-kit/kit/blank.html`:

```html
<!doctype html>
<!-- The page a video's sound renders in when the project has sounds and no music page. -->
<meta charset="utf-8" />
```

Its import name, the built-in sounds the CLI lists (a test keeps them the kit's), and the music templates:

In `packages/motion-kit/src/index.ts`, replace:

```ts
// cuttle-motion://kit/ from a folder that scripts/copy.mjs builds next to each bundle (the CLI's,
// the app's, the export check's):
//   motion.js            Cuttle's helpers (easing, tweens, text, code)
//   three/               Three.js (three.module.js, three.core.js) and its addons (three/addons/)
//   lottie/              lottie-web: lottie.mjs (a module) and lottie.min.js (a script)
//   fonts/               Inter, JetBrains Mono and display faces (woff2, Latin; see KIT_FONTS)
```

with:

```ts
// cuttle-motion://kit/ from a folder that scripts/copy.mjs builds next to each bundle (the CLI's,
// the app's, the export check's):
//   motion.js            Cuttle's helpers (easing, tweens, text, code)
//   sound.js             Cuttle's sound kit for music pages (instruments, effects, harmony, the video's parts)
//   blank.html           the page a video's sounds render in when it has no music page
//   three/               Three.js (three.module.js, three.core.js) and its addons (three/addons/)
//   lottie/              lottie-web: lottie.mjs (a module) and lottie.min.js (a script)
//   fonts/               Inter, JetBrains Mono and display faces (woff2, Latin; see KIT_FONTS)
```

In the same file, replace:

```ts
/** The folder of the kit next to a bundle. */
export const KIT_FOLDER = 'motion-kit';

/** Bare names a page may import (its import map): Three.js and its addons, Cuttle's helpers, lottie-web. */
export const KIT_IMPORTS: Readonly<Record<string, string>> = {
  three: `${KIT_ORIGIN}/three/three.module.js`,
  'three/addons/': `${KIT_ORIGIN}/three/addons/`,
  cuttle: `${KIT_ORIGIN}/motion.js`,
  'lottie-web': `${KIT_ORIGIN}/lottie/lottie.mjs`,
};
```

with:

```ts
/** The folder of the kit next to a bundle. */
export const KIT_FOLDER = 'motion-kit';

/** Bare names a page may import (its import map): Three.js and its addons, Cuttle's helpers and sound kit, lottie-web. */
export const KIT_IMPORTS: Readonly<Record<string, string>> = {
  three: `${KIT_ORIGIN}/three/three.module.js`,
  'three/addons/': `${KIT_ORIGIN}/three/addons/`,
  cuttle: `${KIT_ORIGIN}/motion.js`,
  'cuttle/sound': `${KIT_ORIGIN}/sound.js`,
  'lottie-web': `${KIT_ORIGIN}/lottie/lottie.mjs`,
};
```

In the same file, replace:

```ts
  const doctype = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? '';
  return `${doctype}${importMapTag()}${html.slice(doctype.length)}`;
}
```

with:

```ts
  const doctype = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? '';
  return `${doctype}${importMapTag()}${html.slice(doctype.length)}`;
}

/** A music page `cuttle music new` copies into `music/<name>/`: a starting point for the video's own music. */
export interface MusicTemplate {
  name: string;
  description: string;
}

/** The music templates (their folders in templates/ are `music-<name>`). */
export const MUSIC_TEMPLATES: readonly MusicTemplate[] = [
  { name: 'pulse', description: 'driving electronic: four on the floor where the video is busy, a pad where it breathes, risers and hits on the scene changes' },
  { name: 'drift', description: 'calm and wide, for a walkthrough with a voice: strings and a pad, a glassy arpeggio, a soft pulse, swells into the scene changes' },
  { name: 'lofi', description: 'laid back with swing: a dusty beat, an electric piano on seventh chords, a round bass, record crackle, a tick on each click' },
  { name: 'bright', description: 'upbeat and friendly for a launch: claps, an octave bass, a marimba, bells on the scene changes, a pop on each click' },
  { name: 'cinematic', description: 'a trailer: low strings and a drone, toms that grow with the energy, a ticking clock, braams, impacts and sub drops on the cuts' },
];

/** The built-in sounds of a project's `sounds` (kit/sound.js plays them; a test keeps the two lists the same). */
export const BUILT_IN_SOUNDS: readonly (readonly [name: string, description: string])[] = [
  ['whoosh', 'air rushing past, loudest on its moment, left to right'],
  ['swoosh-in', 'a short whoosh that lands on its moment'],
  ['riser', 'rising noise and tone for 2 s that end on its moment (a cut, a reveal)'],
  ['impact', 'a deep boom and a crack with a long tail'],
  ['downlifter', 'falling noise from its moment'],
  ['sub-drop', 'a falling sub you feel more than hear'],
  ['braam', 'a cinematic low brass hit'],
  ['reverse-cymbal', 'a cymbal swell that ends on its moment'],
  ['swell', 'a chord that swells up to its moment'],
  ['pop', 'a bubble pop (something appears)'],
  ['click', 'a UI click'],
  ['tick', 'a soft tick (a counter, a step)'],
  ['ding', 'a bell-like ding (a notification)'],
  ['chime', 'three bell notes up a chord'],
  ['success', 'two bright notes up: it worked'],
  ['error', 'two dull notes down: it did not'],
  ['type-burst', 'a burst of keys typed fast'],
  ['glitch', 'a digital stutter'],
];
```

- [ ] **Step 3: The templates**

Pulse, driving electronic:

`packages/motion-kit/templates/music-pulse/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <!--
      Pulse: driving electronic music for a launch or a demo with momentum. Four on the floor where the
      video is busy, a pad and a sub where it breathes, risers into the scene changes and a hit on each,
      a whoosh on each zoom. The tempo is fitted so the scene changes fall on beats.
      Change anything: it is a starting point for this video's own music.
    -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "key", "label": "Key", "type": "select", "default": "D", "options": ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] },
        { "name": "mode", "label": "Mode", "type": "select", "default": "minor", "options": ["minor", "dorian", "major", "mixolydian"] },
        { "name": "progression", "label": "Chords", "type": "text", "default": "i VI III VII" },
        { "name": "bpm", "label": "Tempo (0: fitted to the cuts)", "type": "number", "default": 0, "min": 0, "max": 180 },
        { "name": "drive", "label": "Drive (0 to 1)", "type": "number", "default": 0.7, "min": 0, "max": 1 },
        { "name": "energies", "label": "Energy by scene (Hook=3, s4=1)", "type": "text", "default": "" },
        { "name": "hits", "label": "Risers and hits on the cuts", "type": "bool", "default": true }
      ]
    </script>
  </head>
  <body>
    <script type="module">
      import { song, kick, clap, hat, shaker, crash, bass, sub, pad, pluck, tom, fx, progression, voiceLead, sections, fitTempo, arp } from 'cuttle/sound';

      cuttle.music((audio) => {
        const { video, params } = audio;
        const fitted = fitTempo(video, { min: 114, max: 128 });
        const bpm = params.bpm > 0 ? params.bpm : fitted.bpm;
        const s = song(audio, { bpm, offset: params.bpm > 0 ? 0 : fitted.offset, key: params.key, mode: params.mode, swing: 0.03 });
        const chords = voiceLead(progression(params.key, params.mode, params.progression, 3), { low: 'G2', high: 'D4' });
        // "Hook=3, s4=1": a scene's energy (0 quiet … 3 full) by its label or id
        const energy = Object.fromEntries(String(params.energies ?? '').split(',').map((pair) => pair.split('=').map((x) => x.trim())).filter(([k, v]) => k && v !== undefined && v !== ''));
        const parts = sections(video, { energy });
        const partAt = (t) => parts.find((part) => t >= part.start && t < part.end);
        const energyAt = (t) => partAt(t)?.energy ?? 2;
        // inside a long part the music moves in 8-bar phrases: a groove, then a lift with the arpeggio
        const lifted = (t) => {
          const part = partAt(t);
          return part ? Math.floor((s.barAt(t) - s.barAt(part.start) + 0.01) / 8) % 2 === 1 : false;
        };
        const drive = Number(params.drive);

        const k = kick(s, { tone: 46, punch: 1.1, drive: 0.2 + 0.3 * drive });
        const cl = clap(s, { gain: 0.6 });
        const hh = hat(s, { gain: 0.26 });
        const sh = shaker(s);
        const cr = crash(s);
        const low = bass(s, { cutoff: 380 + 260 * drive, envelope: 3.5, drive: 0.35 });
        const deep = sub(s, { gain: 0.45 });
        const air = pad(s, { voices: 3, detune: 16, cutoff: 1300, attack: 0.9, gain: 0.11 });
        const arpeggio = pluck(s, { cutoff: 1100, gain: 0.11, decay: 0.16 });
        const fill = tom(s, { gain: 0.6 });

        const kicks = [];
        let previous = -1;
        for (const { bar, t } of s.bars(-1, video.duration)) {
          const notes = chords[((bar % chords.length) + chords.length) % chords.length];
          const energy = energyAt(Math.max(0, t));
          // the pad holds the chord everywhere, brighter as the energy rises
          air.play(Math.max(0, t), notes.map((n) => n + 12), s.bar, { velocity: 0.35 + 0.2 * energy, brightness: 0.5 + 0.25 * energy });
          if (energy <= 1) deep.play(Math.max(0, t), notes[0] - 12, s.bar * 0.95, { velocity: 0.5 });
          // a crash where the music lifts
          if (energy > previous && previous >= 0 && energy >= 2 && t >= 0) cr.hit(t, 0.7);
          previous = energy;
          for (let beat = 0; beat < 4; beat++) {
            const bt = s.time(bar, beat);
            if (bt < 0 || bt >= video.duration) continue;
            const e = energyAt(bt);
            if (e >= 2) {
              k.hit(bt, beat === 0 ? 1 : 0.92);
              kicks.push(bt);
              if (beat % 2 === 1) cl.hit(bt, 0.85);
              hh.hit(s.time(bar, beat + 0.5), 0.75, { open: beat === 3 && e >= 3 });
              low.play(bt, notes[0] - 12, s.beat * 0.45, { velocity: 0.9 });
              low.play(s.time(bar, beat + 0.5), notes[0] - (beat === 3 ? 0 : 12), s.beat * 0.45, { velocity: 0.75 });
            }
            if (e >= 3) {
              hh.hit(s.time(bar, beat + 0.25), 0.3);
              hh.hit(s.time(bar, beat + 0.75), 0.35);
              sh.hit(s.time(bar, beat + 0.5), 0.6);
            }
          }
          // sixteenths over the chord where the video is busiest, and in the lifts
          if (energy >= 3 || (energy >= 2 && (lifted(Math.max(0, t)) || drive > 0.85))) {
            const line = arp(notes.map((n) => n + 24), { pattern: 'updown', octaves: 1 });
            for (let i = 0; i < 16; i++) {
              const at = s.time(bar, i / 4);
              if (at >= 0 && at < video.duration && energyAt(at) >= 2) arpeggio.play(at, line[i % line.length], s.beat / 4, { velocity: i % 4 === 0 ? 1 : 0.7, pan: i % 2 ? 0.35 : -0.35 });
            }
          }
          // a tom fill in the last beat before the music lifts
          const next = s.time(bar + 1);
          if (next < video.duration && energyAt(next) > energy) {
            [0, 0.25, 0.5, 0.75].forEach((x, i) => fill.hit(s.time(bar, 3 + x), 0.55 + i * 0.12, ['D3', 'A2', 'F2', 'D2'][i]));
          }
        }
        // the pad and the bass make room for the kick
        s.duck(s.pads, kicks, { depth: 0.55, release: 0.22 });
        s.duck(s.bassBus, kicks, { depth: 0.35, release: 0.12 });

        // the scene changes: a riser into each, a hit on it
        if (params.hits) {
          for (const cut of video.cuts.filter((c) => !c.jump)) {
            const before = video.scenes.find((scene) => Math.abs(scene.end - cut.t) < 1e-3);
            const room = before ? before.end - before.start : 2;
            fx.riser(audio, cut.t, { length: Math.min(1.8, room * 0.6), volume: 0.5 });
            fx.impact(audio, cut.t, { volume: 0.6 });
          }
          if (video.duration > 1) fx.subDrop(audio, 0.02, { volume: 0.6 });
        }
        // air past the camera on each zoom
        for (const zoom of video.zooms) fx.whoosh(audio, zoom.start + 0.15, { length: 0.6, volume: 0.3 });

        return {
          bpm,
          key: `${params.key} ${params.mode}`,
          sections: parts.map((part) => ({ start: part.start, end: part.end, name: part.name, energy: part.energy })),
        };
      });
    </script>
  </body>
</html>
```

Drift, calm and wide, for a voice:

`packages/motion-kit/templates/music-drift/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <!--
      Drift: calm, wide and warm, for a walkthrough with a voice over it. Slow chords on strings and a
      pad, a glassy arpeggio that drifts through a long delay, a soft pulse only where the video moves,
      swells into the scene changes instead of hits. Change anything: it is a starting point.
    -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "key", "label": "Key", "type": "select", "default": "F", "options": ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] },
        { "name": "mode", "label": "Mode", "type": "select", "default": "lydian", "options": ["major", "lydian", "dorian", "minor"] },
        { "name": "progression", "label": "Chords", "type": "text", "default": "I V vi IV" },
        { "name": "bpm", "label": "Tempo (0: fitted to the cuts)", "type": "number", "default": 0, "min": 0, "max": 140 },
        { "name": "pulse", "label": "A soft beat where the video moves", "type": "bool", "default": true },
        { "name": "energies", "label": "Energy by scene (Intro=0, s4=2)", "type": "text", "default": "" }
      ]
    </script>
  </head>
  <body>
    <script type="module">
      import { song, kick, shaker, rim, sub, pad, strings, keys, fx, progression, voiceLead, sections, fitTempo, arp } from 'cuttle/sound';

      cuttle.music((audio) => {
        const { video, params } = audio;
        const fitted = fitTempo(video, { min: 78, max: 92, snap: 2 });
        const bpm = params.bpm > 0 ? params.bpm : fitted.bpm;
        const s = song(audio, { bpm, offset: params.bpm > 0 ? 0 : fitted.offset, key: params.key, mode: params.mode, reverb: 3.6, brightness: 0.35, delay: 0.75 });
        const chords = voiceLead(progression(params.key, params.mode, params.progression, 3), { low: 'C3', high: 'G4' });
        const energy = Object.fromEntries(String(params.energies ?? '').split(',').map((pair) => pair.split('=').map((x) => x.trim())).filter(([k, v]) => k && v));
        const parts = sections(video, { energy });
        const energyAt = (t) => parts.find((part) => t >= part.start && t < part.end)?.energy ?? 2;

        const bed = strings(s, { gain: 0.07, attack: 1.4, release: 2.2, cutoff: 1800 });
        const air = pad(s, { wave: 'triangle', voices: 2, detune: 9, cutoff: 2600, attack: 1.8, release: 2.5, gain: 0.09, width: 1 });
        const glass = keys(s, { type: 'glass', gain: 0.07, decay: 2.8, tremolo: 0 });
        const low = sub(s, { gain: 0.32, attack: 0.4, release: 0.8 });
        const soft = kick(s, { tone: 52, punch: 0.7, click: 0.1, drive: 0, gain: 0.55, decay: 0.5 });
        const shake = shaker(s, { gain: 0.1 });
        const knock = rim(s, { gain: 0.16 });

        const kicks = [];
        for (const { bar, t } of s.bars(-1, video.duration)) {
          const notes = chords[((bar % chords.length) + chords.length) % chords.length];
          const start = Math.max(0, t);
          const e = energyAt(start);
          bed.play(start, notes, s.bar, { velocity: 0.5 + 0.15 * e });
          air.play(start, notes.map((n) => n + 12), s.bar, { velocity: 0.4 + 0.15 * e, brightness: 0.6 + 0.15 * e });
          low.play(start, notes[0] - 12, s.bar * 0.98, { velocity: 0.6 + 0.1 * e });
          // the glass arpeggio: eighths, one note left out now and then, wider as the energy rises
          if (e >= 1) {
            const line = arp(notes.map((n) => n + 24), { pattern: 'updown', octaves: e >= 2 ? 2 : 1 });
            for (let i = 0; i < 8; i++) {
              const at = s.time(bar, i / 2);
              if (at < 0 || at >= video.duration || s.random() < 0.25) continue;
              glass.play(at, line[i % line.length], s.beat, { velocity: 0.5 + 0.3 * s.random() });
            }
          }
          if (params.pulse && e >= 2) {
            for (let beat = 0; beat < 4; beat++) {
              const bt = s.time(bar, beat);
              if (bt < 0 || bt >= video.duration) continue;
              if (beat % 2 === 0) {
                soft.hit(bt, 0.7);
                kicks.push(bt);
              }
              shake.hit(s.time(bar, beat + 0.5), 0.5);
              if (e >= 3 && beat === 3) knock.hit(s.time(bar, beat + 0.75), 0.6);
            }
          }
        }
        s.duck(s.pads, kicks, { depth: 0.25, release: 0.4 });

        // the scene changes: a swell into each, a soft sub under it, a chime where Claude answers
        for (const cut of video.cuts.filter((c) => !c.jump)) {
          const notes = chords[((Math.floor(s.barAt(cut.t)) % chords.length) + chords.length) % chords.length];
          fx.swell(audio, cut.t, { length: 1.6, notes: notes.map((n) => n + 12), volume: 0.5 });
          fx.subDrop(audio, cut.t, { length: 1.2, volume: 0.35 });
        }
        for (const marker of video.markers.filter((m) => m.kind === 'answer')) fx.chime(audio, marker.t, { volume: 0.4 });

        return { bpm, key: `${params.key} ${params.mode}`, sections: parts.map((part) => ({ start: part.start, end: part.end, name: part.name, energy: part.energy })) };
      });
    </script>
  </body>
</html>
```

Lofi, with swing and crackle:

`packages/motion-kit/templates/music-lofi/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <!--
      Lofi: a laid-back beat with swing, a warm electric piano on seventh chords, a round bass, and
      the crackle of a record, all a little dark. Good under a coding session or a calm explanation.
      Change anything: it is a starting point.
    -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "key", "label": "Key", "type": "select", "default": "Eb", "options": ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] },
        { "name": "chords", "label": "Chords", "type": "text", "default": "Ebmaj7 Cm7 Fm9 Bb7sus4" },
        { "name": "bpm", "label": "Tempo (0: fitted to the cuts)", "type": "number", "default": 0, "min": 0, "max": 120 },
        { "name": "swing", "label": "Swing (0 to 0.5)", "type": "number", "default": 0.22, "min": 0, "max": 0.5 },
        { "name": "crackle", "label": "Record crackle", "type": "bool", "default": true },
        { "name": "energies", "label": "Energy by scene (Intro=1, s4=3)", "type": "text", "default": "" }
      ]
    </script>
  </head>
  <body>
    <script type="module">
      import { song, kick, snare, hat, rim, bass, keys, pad, fx, chord, voiceLead, sections, fitTempo, steps } from 'cuttle/sound';

      cuttle.music((audio) => {
        const { video, params, context } = audio;
        const fitted = fitTempo(video, { min: 76, max: 90, snap: 2 });
        const bpm = params.bpm > 0 ? params.bpm : fitted.bpm;
        const s = song(audio, { bpm, offset: params.bpm > 0 ? 0 : fitted.offset, key: params.key, mode: 'major', swing: Number(params.swing), reverb: 1.6, brightness: 0.3, delay: 0.5 });
        const chords = voiceLead(String(params.chords).trim().split(/\s+/).map((symbol) => chord(symbol, 3)), { low: 'Bb2', high: 'F4' });
        const energy = Object.fromEntries(String(params.energies ?? '').split(',').map((pair) => pair.split('=').map((x) => x.trim())).filter(([k, v]) => k && v));
        const parts = sections(video, { energy });
        const energyAt = (t) => parts.find((part) => t >= part.start && t < part.end)?.energy ?? 2;

        // everything a little dark: a gentle low-pass on the drums and the keys
        s.drums.input.disconnect();
        const dusty = context.createBiquadFilter();
        dusty.type = 'lowpass';
        dusty.frequency.value = 6500;
        s.drums.input.connect(dusty).connect(s.drums.duck);

        const k = kick(s, { tone: 50, punch: 0.8, click: 0.15, drive: 0.35, gain: 0.85, decay: 0.38 });
        const sn = snare(s, { tone: 170, snap: 0.55, decay: 0.16, gain: 0.55 });
        const hh = hat(s, { gain: 0.16, tone: 0.8 });
        const rm = rim(s, { gain: 0.18 });
        const low = bass(s, { wave: 'triangle', cutoff: 420, envelope: 1.2, resonance: 1, drive: 0.2, sub: 0.7, gain: 0.42 });
        const ep = keys(s, { type: 'epiano', gain: 0.13, decay: 2.6, tremolo: 0.22 });
        const haze = pad(s, { wave: 'triangle', voices: 2, cutoff: 1100, attack: 1.2, release: 1.8, gain: 0.06 });

        const KICK = steps('x......x..x.....');
        const SNARE = steps('....x.......x...');
        const HATS = steps('x.x.x.x.x.x.x.xo');
        for (const { bar, t } of s.bars(-1, video.duration)) {
          const notes = chords[((bar % chords.length) + chords.length) % chords.length];
          const start = Math.max(0, t);
          const e = energyAt(start);
          // the chord on the one, and again, softer, on the "and" of two (a lazy push)
          ep.play(start, notes, s.bar * 0.6, { velocity: 0.55 + 0.1 * e });
          if (e >= 2) ep.play(s.time(bar, 1.5), notes.slice(1), s.beat * 1.2, { velocity: 0.4 });
          haze.play(start, notes.map((n) => n + 12), s.bar, { velocity: 0.35 + 0.1 * e });
          for (let i = 0; i < 16; i++) {
            const at = s.time(bar, i / 4);
            if (at < 0 || at >= video.duration) continue;
            const ee = energyAt(at);
            if (ee >= 2 && KICK[i]) k.hit(at, KICK[i]);
            if (ee >= 2 && SNARE[i]) sn.hit(at, 0.9);
            if (ee >= 1 && HATS[i]) hh.hit(at, HATS[i] * (0.6 + 0.4 * s.random()), { open: HATS[i] < 0.5 });
            if (ee >= 3 && i % 8 === 6) rm.hit(at, 0.7);
          }
          if (e >= 1) {
            low.play(start, notes[0] - 12, s.beat * 1.4, { velocity: 0.9 });
            low.play(s.time(bar, 2.5), notes[0] - 12, s.beat * 0.9, { velocity: 0.7 });
          }
        }

        // the record: a quiet hiss and crackles all through
        if (params.crackle) {
          const hiss = context.createBufferSource();
          const length = Math.round(context.sampleRate * 2);
          const buffer = context.createBuffer(1, length, context.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * 0.5 + (Math.random() < 0.0004 ? (Math.random() * 2 - 1) * 8 : 0);
          hiss.buffer = buffer;
          hiss.loop = true;
          const tone = context.createBiquadFilter();
          tone.type = 'bandpass';
          tone.frequency.value = 3200;
          tone.Q.value = 0.5;
          const level = context.createGain();
          level.gain.value = 0.018;
          hiss.connect(tone).connect(level).connect(s.master);
          hiss.start(0);
        }
        // a soft knock into each scene change, a tick on the clicks the video shows
        for (const cut of video.cuts.filter((c) => !c.jump)) fx.reverseCymbal(audio, cut.t, { length: 1.2, volume: 0.35 });
        for (const t of video.clicks) fx.tick(audio, t, { volume: 0.25 });

        return { bpm, key: `${params.key} major`, sections: parts.map((part) => ({ start: part.start, end: part.end, name: part.name, energy: part.energy })) };
      });
    </script>
  </body>
</html>
```

Bright, an upbeat launch:

`packages/motion-kit/templates/music-bright/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <!--
      Bright: upbeat and friendly, for a launch or a social clip. Claps on two and four, a bouncing bass
      in octaves, a marimba-like pluck, bells on the scene changes, a pop on each click the video shows,
      and the full beat where it peaks. Change anything: it is a starting point.
    -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "key", "label": "Key", "type": "select", "default": "G", "options": ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] },
        { "name": "progression", "label": "Chords", "type": "text", "default": "I V vi IV" },
        { "name": "bpm", "label": "Tempo (0: fitted to the cuts)", "type": "number", "default": 0, "min": 0, "max": 160 },
        { "name": "pops", "label": "A pop on each click", "type": "bool", "default": true },
        { "name": "energies", "label": "Energy by scene (Intro=1, s4=3)", "type": "text", "default": "" }
      ]
    </script>
  </head>
  <body>
    <script type="module">
      import { song, kick, clap, hat, shaker, crash, bass, pluck, keys, pad, fx, progression, voiceLead, sections, fitTempo, euclid } from 'cuttle/sound';

      cuttle.music((audio) => {
        const { video, params } = audio;
        const fitted = fitTempo(video, { min: 112, max: 124 });
        const bpm = params.bpm > 0 ? params.bpm : fitted.bpm;
        const s = song(audio, { bpm, offset: params.bpm > 0 ? 0 : fitted.offset, key: params.key, mode: 'major', swing: 0.06, reverb: 1.8, brightness: 0.7 });
        const chords = voiceLead(progression(params.key, 'major', params.progression, 3), { low: 'B2', high: 'G4' });
        const energy = Object.fromEntries(String(params.energies ?? '').split(',').map((pair) => pair.split('=').map((x) => x.trim())).filter(([k, v]) => k && v));
        const parts = sections(video, { energy });
        const energyAt = (t) => parts.find((part) => t >= part.start && t < part.end)?.energy ?? 2;

        const k = kick(s, { tone: 50, punch: 1, click: 0.4, drive: 0.25, gain: 0.85 });
        const cl = clap(s, { gain: 0.7, tone: 1400 });
        const hh = hat(s, { gain: 0.2, tone: 1.1 });
        const sh = shaker(s, { gain: 0.14 });
        const cr = crash(s, { gain: 0.22 });
        const low = bass(s, { wave: 'square', cutoff: 700, envelope: 2, resonance: 1.5, drive: 0.15, sub: 0.4, gain: 0.32 });
        const marimba = keys(s, { type: 'glass', gain: 0.12, decay: 0.6, tremolo: 0 });
        const sparkle = pluck(s, { wave: 'triangle', cutoff: 2400, gain: 0.08, decay: 0.12 });
        const warm = pad(s, { voices: 2, cutoff: 2200, attack: 0.3, release: 0.8, gain: 0.07 });

        const RHYTHM = euclid(5, 8, 1);
        const kicks = [];
        let previous = -1;
        for (const { bar, t } of s.bars(-1, video.duration)) {
          const notes = chords[((bar % chords.length) + chords.length) % chords.length];
          const start = Math.max(0, t);
          const e = energyAt(start);
          if (e > previous && previous >= 0 && e >= 2 && t >= 0) cr.hit(t, 0.8);
          previous = e;
          warm.play(start, notes.map((n) => n + 12), s.bar, { velocity: 0.3 + 0.15 * e });
          // the marimba plays the chord in a 5-of-8 rhythm
          for (let i = 0; i < 8; i++) {
            const at = s.time(bar, i / 2);
            if (at < 0 || at >= video.duration || !RHYTHM[i]) continue;
            marimba.play(at, notes[(i + bar) % notes.length] + 12, s.beat / 2, { velocity: 0.7 + 0.2 * s.random() });
          }
          for (let beat = 0; beat < 4; beat++) {
            const bt = s.time(bar, beat);
            if (bt < 0 || bt >= video.duration) continue;
            const ee = energyAt(bt);
            if (ee >= 2) {
              if (ee >= 3 || beat % 2 === 0) {
                k.hit(bt, 0.95);
                kicks.push(bt);
              }
              if (beat % 2 === 1) cl.hit(bt, 0.9);
              hh.hit(s.time(bar, beat + 0.5), 0.7);
              // octave bass: root, up, root, up
              low.play(bt, notes[0] - 12, s.beat * 0.4, { velocity: 0.9 });
              low.play(s.time(bar, beat + 0.5), notes[0], s.beat * 0.35, { velocity: 0.7 });
            } else if (ee === 1) sh.hit(s.time(bar, beat + 0.5), 0.6);
            if (ee >= 3) {
              sh.hit(s.time(bar, beat + 0.25), 0.5);
              sparkle.play(s.time(bar, beat + 0.75), notes[(beat + 1) % notes.length] + 24, s.beat / 4, { velocity: 0.8, pan: beat % 2 ? 0.4 : -0.4 });
            }
          }
        }
        s.duck(s.pads, kicks, { depth: 0.4, release: 0.18 });
        s.duck(s.bassBus, kicks, { depth: 0.25, release: 0.1 });

        // bells on the scene changes, a pop on each click, a success where Claude answers
        for (const cut of video.cuts.filter((c) => !c.jump)) {
          fx.swooshIn(audio, cut.t, { volume: 0.5 });
          fx.chime(audio, cut.t + 0.02, { volume: 0.4 });
        }
        if (params.pops) for (const t of video.clicks) fx.pop(audio, t, { volume: 0.35, pitch: 0.9 + audio.random() * 0.3 });
        for (const marker of video.markers.filter((m) => m.kind === 'answer')) fx.success(audio, marker.t, { volume: 0.5 });

        return { bpm, key: `${params.key} major`, sections: parts.map((part) => ({ start: part.start, end: part.end, name: part.name, energy: part.energy })) };
      });
    </script>
  </body>
</html>
```

Cinematic, a trailer:

`packages/motion-kit/templates/music-cinematic/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <!--
      Cinematic: a trailer. Low strings and a drone hold the key, toms hammer an ostinato that grows
      with the energy, a clock ticks where it builds, and every scene change lands on a braam, an
      impact and a sub drop after a riser. Brutal where the video peaks. Change anything: it is a
      starting point.
    -->
    <script type="application/json" id="cuttle-params">
      [
        { "name": "key", "label": "Key", "type": "select", "default": "D", "options": ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] },
        { "name": "progression", "label": "Chords", "type": "text", "default": "i VI iv V" },
        { "name": "bpm", "label": "Tempo (0: fitted to the cuts)", "type": "number", "default": 0, "min": 0, "max": 160 },
        { "name": "braams", "label": "Braams on the scene changes", "type": "bool", "default": true },
        { "name": "energies", "label": "Energy by scene (Intro=1, s4=3)", "type": "text", "default": "" }
      ]
    </script>
  </head>
  <body>
    <script type="module">
      import { song, tom, kick, crash, strings, sub, pad, bell, fx, progression, voiceLead, sections, fitTempo, midi } from 'cuttle/sound';

      cuttle.music((audio) => {
        const { video, params } = audio;
        const fitted = fitTempo(video, { min: 92, max: 112 });
        const bpm = params.bpm > 0 ? params.bpm : fitted.bpm;
        const s = song(audio, { bpm, offset: params.bpm > 0 ? 0 : fitted.offset, key: params.key, mode: 'harmonicMinor', reverb: 3.2, brightness: 0.4 });
        const chords = voiceLead(progression(params.key, 'harmonicMinor', params.progression, 3), { low: 'A2', high: 'D4' });
        const energy = Object.fromEntries(String(params.energies ?? '').split(',').map((pair) => pair.split('=').map((x) => x.trim())).filter(([k, v]) => k && v));
        const parts = sections(video, { energy });
        const energyAt = (t) => parts.find((part) => t >= part.start && t < part.end)?.energy ?? 2;
        const root = midi(`${params.key}1`);

        const lows = strings(s, { gain: 0.09, attack: 0.8, release: 1.6, cutoff: 1500, vibrato: 4 });
        const drone = pad(s, { voices: 3, detune: 7, cutoff: 500, attack: 2, release: 2.5, gain: 0.1, motion: 0.4 });
        const deep = sub(s, { gain: 0.4, attack: 0.3, release: 0.8 });
        const t1 = tom(s, { pitch: 'D2', gain: 0.7, decay: 0.6, pan: -0.2 });
        const t2 = tom(s, { pitch: 'A1', gain: 0.75, decay: 0.7, pan: 0.2 });
        const boom = kick(s, { tone: 40, punch: 1.3, click: 0.2, drive: 0.5, gain: 0.9, decay: 0.7 });
        const cr = crash(s, { gain: 0.25, decay: 2.5 });
        const top = bell(s, { gain: 0.06 });

        // the ostinato: which sixteenths the toms hit at each energy
        const OSTINATO = { 1: [0], 2: [0, 6, 8, 14], 3: [0, 3, 6, 8, 10, 12, 14, 15] };
        for (const { bar, t } of s.bars(-1, video.duration)) {
          const notes = chords[((bar % chords.length) + chords.length) % chords.length];
          const start = Math.max(0, t);
          const e = energyAt(start);
          drone.play(start, [root + 12, root + 19], s.bar, { velocity: 0.6 + 0.1 * e });
          deep.play(start, root + 12, s.bar * 0.98, { velocity: 0.5 + 0.1 * e });
          if (e >= 1) lows.play(start, notes, s.bar, { velocity: 0.45 + 0.15 * e });
          if (e >= 3) top.play(s.time(bar, 2), notes.at(-1) + 24, s.beat * 2, { velocity: 0.6 });
          for (const i of OSTINATO[Math.min(3, Math.max(1, e))] ?? []) {
            const at = s.time(bar, i / 4);
            if (at < 0 || at >= video.duration) continue;
            (i % 8 === 0 ? t2 : t1).hit(at, i % 4 === 0 ? 0.95 : 0.65);
            if (e >= 3 && i % 8 === 0) boom.hit(at, 0.9);
          }
          // a clock that ticks where the music builds
          if (e === 2) for (let beat = 0; beat < 4; beat++) {
            const at = s.time(bar, beat + 0.5);
            if (at >= 0 && at < video.duration) fx.tick(audio, at, { volume: 0.18, destination: s.drums.input });
          }
        }

        // the scene changes: a riser, then a braam, an impact, a sub drop and a crash
        for (const cut of video.cuts.filter((c) => !c.jump)) {
          const before = video.scenes.find((scene) => Math.abs(scene.end - cut.t) < 1e-3);
          const room = before ? before.end - before.start : 2;
          fx.riser(audio, cut.t, { length: Math.min(2.5, room * 0.7), volume: 0.45 });
          fx.reverseCymbal(audio, cut.t, { length: Math.min(1.5, room * 0.5), volume: 0.35 });
          if (params.braams) fx.braam(audio, cut.t, { note: root, volume: 0.55 });
          fx.impact(audio, cut.t, { volume: 0.65, size: 1.3 });
          fx.subDrop(audio, cut.t + 0.05, { volume: 0.45 });
          if (cut.t > 0) cr.hit(cut.t, 0.8);
        }
        if (video.duration > 1) fx.braam(audio, 0.02, { note: root, volume: 0.45, length: 3 });
        // the last second fades on a downlifter
        if (video.duration > 3) fx.downlifter(audio, video.duration - 2.5, { length: 2.4, volume: 0.35 });

        return { bpm, key: `${params.key} harmonic minor`, sections: parts.map((part) => ({ start: part.start, end: part.end, name: part.name, energy: part.energy })) };
      });
    </script>
  </body>
</html>
```

A template is copied into `music/` as into `motion/`:

In `packages/motion-kit/src/files.ts`, replace:

```ts
}

/**
 * Copies a template of the kit next to a bundle (`bundleUrl`) into the project's `motion/<name>/`,
 * or `motion/<name>-2/` and so on when that folder is taken. Answers the page's path in the project
 * (`motion/<folder>/index.html`).
 */
export async function copyTemplate(projectDir: string, template: string, name: string, bundleUrl: string): Promise<string> {
  const from = join(templatesFolder(bundleUrl), template);
  if (!(await isFolder(from))) throw new MissingTemplateError(`the template ${template} is missing from the motion kit (${from})`);
  let folder = name;
  for (let n = 2; await stat(join(projectDir, 'motion', folder)).then(() => true, () => false); n++) folder = `${name}-${n}`;
  await copyFolder(from, join(projectDir, 'motion', folder));
  return `motion/${folder}/index.html`;
}
```

with:

```ts
}

/**
 * Copies a template of the kit next to a bundle (`bundleUrl`) into the project's `<into>/<name>/`
 * (`motion`, or `music` for a music page), or `<name>-2/` and so on when that folder is taken.
 * Answers the page's path in the project (`motion/<folder>/index.html`).
 */
export async function copyTemplate(projectDir: string, template: string, name: string, bundleUrl: string, into: 'motion' | 'music' = 'motion'): Promise<string> {
  const from = join(templatesFolder(bundleUrl), template);
  if (!(await isFolder(from))) throw new MissingTemplateError(`the template ${template} is missing from the motion kit (${from})`);
  let folder = name;
  for (let n = 2; await stat(join(projectDir, into, folder)).then(() => true, () => false); n++) folder = `${name}-${n}`;
  await copyFolder(from, join(projectDir, into, folder));
  return `${into}/${folder}/index.html`;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/motion-kit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/motion-kit
git commit -m "motion-kit: the sound kit (a song's grid and buses, drums, bass, pads, keys, effects, harmony, the video's parts, a tempo fitted to its cuts) and five music templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The video as the music sees it, and the page's runtime

**Files:**
- Create: `packages/export/src/music/video.ts`, `packages/export/src/music/runtime.ts`, `packages/export/test/music-video.test.ts`, `packages/export/test/music-runtime.browser.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/export/test/music-video.test.ts`:

```ts
import { parseProject, type InputEvent } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { soundCues, videoData } from '../src/music/video';

function project(input: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

describe('the video as its music sees it', () => {
  const p = project({
    scenes: [
      { type: 'motion', id: 's1', label: 'Intro', src: 'motion/intro/index.html', duration: 2 },
      { type: 'clip', id: 's2', from: 10, to: 20 },
      { type: 'clip', id: 's3', label: 'Claude at work', from: 20, to: 60, speed: 8 },
      { type: 'card', id: 's4', title: 'Cuttle', duration: 3 },
    ],
    cuts: [{ from: 14, to: 15 }],
    zooms: [
      { at: 12, duration: 4, rect: [0, 0, 1280, 720], label: 'Answer' },
      { at: 30, duration: 3, rect: [0, 0, 1280, 720], enabled: false },
    ],
    captions: { fixes: [{ at: 18, end: 18.4, text: 'Cuttle' }] },
  });
  const events: InputEvent[] = [
    { t: 11, type: 'click', x: 5, y: 5, button: 'left' },
    { t: 14.5, type: 'click', x: 5, y: 5, button: 'left' },
    { t: 40, type: 'click', x: 5, y: 5, button: 'left' },
    { t: 12, type: 'keys', count: 3 },
  ];
  const words = [
    { t: 11, end: 11.3, text: 'Now' },
    { t: 11.5, end: 11.9, text: 'watch.' },
    { t: 13, end: 13.4, text: 'Done.' },
    { t: 18, end: 18.2, text: 'Kutl' },
  ];
  const markers = [
    { t: 12.5, kind: 'prompt' as const, label: 'Build it' },
    { t: 14.2, kind: 'tool' as const },
    { t: 44, kind: 'answer' as const },
  ];
  const video = videoData(p, { events, words, markers });

  it('lists the scenes and the cuts between them, a jump cut marked', () => {
    expect(video.duration).toBe(2 + 9 + 5 + 3);
    expect(video.scenes.map((scene) => [scene.id, scene.type, scene.start, scene.end])).toEqual([
      ['s1', 'motion', 0, 2],
      ['s2', 'clip', 2, 6],
      ['s2', 'clip', 6, 11],
      ['s3', 'clip', 11, 16],
      ['s4', 'card', 16, 19],
    ]);
    expect(video.scenes[0]).toMatchObject({ label: 'Intro', src: 'motion/intro/index.html' });
    expect(video.scenes[3]).toMatchObject({ speed: 8, from: 20, to: 60, label: 'Claude at work' });
    expect(video.cuts).toEqual([
      { t: 2, scene: 1, jump: false },
      { t: 6, scene: 1, jump: true },
      { t: 11, scene: 2, jump: false },
      { t: 16, scene: 3, jump: false },
    ]);
  });

  it('puts the take\'s clicks, keys, markers and zooms where the video shows them, and leaves out what is cut', () => {
    // 11 s at 1× from 2; 14.5 s is cut; 40 s at 8× from 11
    expect(video.clicks).toEqual([3, 13.5]);
    expect(video.keys.length).toBe(3);
    expect(video.keys.every((t) => t >= 4 && t < 4.5)).toBe(true);
    expect(video.markers).toEqual([
      { t: 4.5, kind: 'prompt', label: 'Build it' },
      { t: 14, kind: 'answer' },
    ]);
    // the zoom (12–16 s) shows on both pieces around the cut, one stretch
    expect(video.zooms).toEqual([{ start: 4, end: 7, label: 'Answer' }]);
  });

  it('gives the words with the fixes, and joins them into stretches of speech', () => {
    expect(video.words.map((word) => word.text)).toEqual(['Now', 'watch.', 'Done.', 'Cuttle']);
    expect(video.speech).toEqual([
      { start: 3, end: 3.9 },
      { start: 5, end: 5.4 },
      { start: 9, end: 9.4 },
    ]);
  });
});

describe('the project\'s sounds on the video', () => {
  const p = project({
    scenes: [
      { type: 'clip', id: 's1', from: 0, to: 10 },
      { type: 'motion', id: 's2', src: 'motion/x/index.html', duration: 4 },
      { type: 'clip', id: 's3', from: 5, to: 8, speed: 2 },
    ],
    cuts: [{ from: 3, to: 4 }],
  });

  it('plays a sound at a source second wherever the video shows it, and one in a scene that far in', () => {
    const cues = soundCues(p, [
      { sound: 'pop', at: 6, volume: 0.5, enabled: true },
      { sound: 'whoosh', at: 3.5, volume: 1, enabled: true },
      { sound: 'ding', at: 1, scene: 's2', volume: 0.8, enabled: true },
      { sound: 'sounds/x.wav', at: 9, volume: 0.8, enabled: false },
      { sound: 'tick', at: 9, scene: 's2', volume: 0.8, enabled: true },
    ]);
    expect(cues).toEqual([
      // 6 s: in the first clip (after the 1 s cut: 5 s in) and in the last at 2× (13 + 0.5)
      { at: 5, sound: 'pop', volume: 0.5 },
      { at: 10, sound: 'ding', volume: 0.8 },
      { at: 13.5, sound: 'pop', volume: 0.5 },
    ]);
  });
});
```

`packages/export/test/music-runtime.browser.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { musicRuntime, type CuttleMusicApi, type MusicInit, type MusicRenderResult, type VideoData } from '../src/music/runtime';

/** The kit as the test's server serves it. */
const KIT = new URL('../../motion-kit/kit/sound.js', import.meta.url).href;

const VIDEO: VideoData = {
  duration: 2,
  fps: 30,
  scenes: [{ index: 0, type: 'clip', start: 0, end: 2, speed: 1, from: 0, to: 2 }],
  cuts: [],
  clicks: [0.5],
  keys: [],
  words: [],
  speech: [],
  markers: [],
  zooms: [],
};
const INIT: MusicInit = { duration: 2, rate: 48_000, params: { level: 0.5 }, seed: 3, video: VIDEO, sounds: [], kit: KIT };

type Page = Window &
  typeof globalThis & {
    cuttle: CuttleMusicApi;
    __cuttleReady(): Promise<void>;
    __cuttleCompose(): Promise<MusicRenderResult>;
    __cuttleStem(which: 'music' | 'effects', from: number, to: number): string;
    __cuttleErrors: string[];
    seen: unknown[];
  };

const frames: HTMLIFrameElement[] = [];
afterEach(() => frames.splice(0).forEach((frame) => frame.remove()));

/** A page in an iframe, as the renderer makes one: the runtime from its source text first, then the page's script. */
function page(script: string, init: MusicInit = INIT): Page {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const win = frame.contentWindow as Page;
  win.eval(`(${musicRuntime.toString()})(${JSON.stringify(init)});`);
  win.seen = [];
  win.eval(script);
  return win;
}

/** A stem read back as the renderer reads it: interleaved stereo float32. */
function stem(win: Page, which: 'music' | 'effects', from: number, to: number): Float32Array {
  const bytes = Uint8Array.from(atob(win.__cuttleStem(which, from, to)), (c) => c.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}

const peak = (samples: Float32Array, from = 0, to = samples.length) => {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(samples[i]!));
  return max;
};

describe('the music runtime', () => {
  it('renders the composition as long as the video into two stems, music and effects', async () => {
    const win = page(`cuttle.music((audio) => {
      seen.push(audio.duration, audio.params.level, audio.video.clicks);
      // a 220 Hz tone on the music bus, a burst on the effects bus at 1 s
      const tone = audio.context.createOscillator();
      tone.frequency.value = 220;
      const level = audio.context.createGain();
      level.gain.value = audio.params.level;
      tone.connect(level).connect(audio.music);
      tone.start(0);
      audio.at(1, () => {
        const burst = audio.context.createOscillator();
        burst.connect(audio.effects);
        burst.start(1);
        burst.stop(1.1);
      });
      return { bpm: 120, key: 'D minor', sections: [{ start: 0, end: 2, name: 'all' }] };
    });`);
    await win.__cuttleReady();
    const result = await win.__cuttleCompose();
    expect(win.seen).toEqual([2, 0.5, [0.5]]);
    expect(result.length).toBe(96_000);
    expect(result.info).toEqual({ bpm: 120, key: 'D minor', sections: [{ start: 0, end: 2, name: 'all' }] });
    expect(result.peaks.music).toBeCloseTo(0.5, 2);
    expect(result.peaks.effects).toBeGreaterThan(0.9);
    const music = stem(win, 'music', 0, 96_000);
    const effects = stem(win, 'effects', 0, 96_000);
    expect(music.length).toBe(192_000);
    expect(peak(music, 0, 4800)).toBeCloseTo(0.5, 2);
    // the effect only on its own stem, only from 1 s to 1.1 s
    expect(peak(effects, 0, 2 * 47_000)).toBe(0);
    expect(peak(effects, 2 * 48_200, 2 * 52_000)).toBeGreaterThan(0.9);
    expect(peak(effects, 2 * 53_000, 2 * 96_000)).toBe(0);
    // the last 30 ms fade to silence: no click where the video ends
    expect(Math.abs(music[music.length - 2]!)).toBeLessThan(0.01);
    expect(win.__cuttleErrors).toEqual([]);
  });

  it('makes what plays later a moment before the render reaches it, not up front', async () => {
    const init = { ...INIT, duration: 6, video: { ...VIDEO, duration: 6 } };
    const win = page(
      `cuttle.music((audio) => {
        for (const t of [0.5, 3, 5.5]) audio.at(t, () => seen.push([t, audio.context.currentTime]));
      });`,
      init,
    );
    await win.__cuttleReady();
    await win.__cuttleCompose();
    const made = win.seen as [number, number][];
    expect(made.map(([t]) => t)).toEqual([0.5, 3, 5.5]);
    for (const [t, when] of made) {
      expect(when).toBeLessThanOrEqual(t);
      expect(when).toBeGreaterThanOrEqual(t - 2.01);
    }
    // the first is made before the render starts, the last during it
    expect(made[0]![1]).toBe(0);
    expect(made[2]![1]).toBeGreaterThan(3);
  });

  it('plays the project\'s built-in sounds on the effects stem and names the ones it cannot', async () => {
    const win = page('', { ...INIT, sounds: [{ at: 0.5, sound: 'pop', volume: 1 }, { at: 1, sound: 'kazoo', volume: 1 }] });
    await win.__cuttleReady();
    const result = await win.__cuttleCompose();
    expect(result.skipped).toEqual(['kazoo: no such sound (cuttle sound list)']);
    const effects = stem(win, 'effects', 0, 96_000);
    expect(peak(effects, 0, 2 * 23_500)).toBe(0);
    expect(peak(effects, 2 * 24_000, 2 * 30_000)).toBeGreaterThan(0.05);
    expect(peak(stem(win, 'music', 0, 96_000))).toBe(0);
  });

  it('notes what the composition threw, and renders on', async () => {
    const win = page(`cuttle.music(() => { throw new Error('no chords'); }); cuttle.music(() => {});`);
    await win.__cuttleReady();
    const result = await win.__cuttleCompose();
    expect(result.length).toBe(96_000);
    expect(win.__cuttleErrors).toEqual(['Error: cuttle.music was called more than once; the first composition plays', 'Error: no chords']);
  });

  it('seeds Math.random: the same music on every render', () => {
    const a = page('seen.push(Math.random(), Math.random());');
    const b = page('seen.push(Math.random(), Math.random());');
    expect(a.seen).toEqual(b.seen);
    expect(a.seen[0]).not.toBe(a.seen[1]);
  });

  it('plays a song from the kit: drums, bass and a pad on the grid, effects on the cuts', async () => {
    const init = { ...INIT, duration: 4, video: { ...VIDEO, duration: 4, cuts: [{ t: 2, scene: 1, jump: false }] } };
    const win = page(
      `cuttle.ready(import(${JSON.stringify(KIT)}).then((kit) => {
        cuttle.music((audio) => {
          const s = kit.song(audio, { bpm: 120, key: 'D', mode: 'minor' });
          const k = kit.kick(s);
          const b = kit.bass(s);
          const p = kit.pad(s);
          for (let beat = 0; beat < 8; beat++) {
            k.hit(s.time(0, beat));
            b.play(s.time(0, beat), 'D2', s.beat / 2);
          }
          p.play(0, kit.chord('Dm', 3), 4);
          kit.fx.impact(audio, 2);
          kit.fx.riser(audio, 2, { length: 1 });
          return { bpm: s.bpm };
        });
      }));`,
      init,
    );
    await win.__cuttleReady();
    const result = await win.__cuttleCompose();
    expect(win.__cuttleErrors).toEqual([]);
    expect(result.nodes).toBeGreaterThan(30);
    expect(result.peaks.music).toBeGreaterThan(0.1);
    expect(result.peaks.music).toBeLessThan(1);
    const effects = stem(win, 'effects', 0, 192_000);
    // the riser grows into the cut, the impact hits on it
    expect(peak(effects, 2 * 48_000, 2 * 60_000)).toBeLessThan(peak(effects, 2 * 90_000, 2 * 96_000));
    expect(peak(effects, 2 * 96_000, 2 * 100_000)).toBeGreaterThan(0.1);
  });
});
```

Run: `pnpm exec vitest run --project node packages/export/test/music-video.test.ts`
Expected: FAIL: `../src/music/video` does not exist.

- [ ] **Step 2: The video**

`packages/export/src/music/video.ts`:

```ts
import type { CuttleProject, InputEvent, Marker, TranscriptWord } from '@cuttle/project';
import { applyCaptionFixes, captionWords, keyPresses, occurrences, sceneSpans, totalDuration, type SceneSpan } from '@cuttle/timeline';
import type { SoundCue, VideoData } from './runtime';

/** Words closer than this (seconds) are one stretch of speech. */
const SPEECH_GAP = 0.6;
/** Key presses closer than this are one (a page needs no more than 30 a second). */
const KEY_GAP = 1 / 30;

const milli = (value: number) => Math.round(value * 1000) / 1000;

/** What the take holds that the music can follow. */
export interface VideoInputs {
  events: readonly InputEvent[];
  words: readonly TranscriptWord[];
  markers: readonly Marker[];
}

/** Each output second where the clips show source second `t` (once per showing). */
function shown(spans: readonly SceneSpan[], t: number): number[] {
  const out: number[] = [];
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'clip' || t < scene.from || t >= scene.to) continue;
    out.push(milli(span.start + (t - scene.from) / scene.speed));
  }
  return out;
}

/**
 * The video as its music sees it (`cuttle.video`): its scenes, the cuts between them, and what the
 * clips show of the take (clicks, typing, words, Claude's markers, zooms), all in output seconds.
 */
export function videoData(project: CuttleProject, inputs: VideoInputs): VideoData {
  const spans = sceneSpans(project.scenes, project.cuts);
  const duration = milli(totalDuration(spans));
  const scenes: VideoData['scenes'] = spans.map((span) => {
    const scene = span.scene;
    return {
      index: span.sceneIndex,
      ...(scene.id !== undefined && { id: scene.id }),
      ...(scene.label !== undefined && { label: scene.label }),
      type: scene.type,
      start: milli(span.start),
      end: milli(span.end),
      ...(scene.type === 'clip' && { speed: scene.speed, from: scene.from, to: scene.to }),
      ...(scene.type === 'motion' && { src: scene.src }),
    };
  });
  const cuts = spans.slice(1).map((span) => ({ t: milli(span.start), scene: span.sceneIndex, jump: span.cutBefore === true }));
  const clicks: number[] = [];
  for (const event of inputs.events) if (event.type === 'click') clicks.push(...shown(spans, event.t));
  const keys: number[] = [];
  for (const press of keyPresses(inputs.events)) keys.push(...shown(spans, press.t));
  keys.sort((a, b) => a - b);
  const sparse: number[] = [];
  for (const t of keys) if (sparse.length === 0 || t - sparse.at(-1)! >= KEY_GAP) sparse.push(t);
  const words = captionWords(applyCaptionFixes(inputs.words, project.captions.fixes), spans).map(({ t, end, text }) => ({ t, end, text }));
  const speech: VideoData['speech'] = [];
  for (const word of words) {
    const last = speech.at(-1);
    if (last && word.t - last.end < SPEECH_GAP) last.end = Math.max(last.end, word.end);
    else speech.push({ start: word.t, end: word.end });
  }
  const markers: VideoData['markers'] = [];
  for (const marker of inputs.markers) {
    for (const t of shown(spans, marker.t)) markers.push({ t, kind: marker.kind, ...(marker.label !== undefined && { label: marker.label }) });
  }
  const zooms: VideoData['zooms'] = [];
  for (const zoom of project.zooms.filter((z) => z.enabled)) {
    const seen = new Set<object>();
    for (const occurrence of occurrences(spans, zoom.at, zoom.at + zoom.duration)) {
      if (!occurrence || seen.has(occurrence)) continue;
      seen.add(occurrence);
      zooms.push({ start: milli(occurrence.start), end: milli(occurrence.end), ...(zoom.label !== undefined && { label: zoom.label }) });
    }
  }
  return {
    duration,
    fps: project.output.fps,
    scenes,
    cuts,
    clicks: clicks.sort((a, b) => a - b),
    keys: sparse,
    words,
    speech,
    markers: markers.sort((a, b) => a.t - b.t),
    zooms: zooms.sort((a, b) => a.start - b.start),
  };
}

/** A sound of the project, by its name or file: `url` is set by the caller for files. */
export interface ProjectSound {
  sound: string;
  at: number;
  scene?: string;
  volume: number;
  enabled: boolean;
}

/**
 * The project's sounds on the output timeline: one at a source second plays wherever the clips show
 * it (once per showing, gone where it is cut); one with a `scene` plays that many seconds into it.
 */
export function soundCues(project: CuttleProject, sounds: readonly ProjectSound[]): SoundCue[] {
  const spans = sceneSpans(project.scenes, project.cuts);
  const cues: SoundCue[] = [];
  for (const sound of sounds) {
    if (!sound.enabled) continue;
    if (sound.scene !== undefined) {
      const index = project.scenes.findIndex((scene) => scene.id === sound.scene);
      const span = spans.find((s) => s.sceneIndex === index);
      if (span && sound.at <= span.end - span.start) cues.push({ at: milli(span.start + sound.at), sound: sound.sound, volume: sound.volume });
      continue;
    }
    for (const t of shown(spans, sound.at)) cues.push({ at: t, sound: sound.sound, volume: sound.volume });
  }
  return cues.sort((a, b) => a.at - b.at);
}
```

- [ ] **Step 3: The runtime**

`packages/export/src/music/runtime.ts`:

```ts
/// <reference lib="dom" />
// The page side of a video's sound: run in the page before its own scripts (the renderer injects
// this function's source with its argument), so it must not use anything from outside itself.
//
// A music page composes the video's music in WebAudio: `cuttle.music(compose)` hands `compose` an
// OfflineAudioContext as long as the video, the video's timeline (`cuttle.video`: its scenes, cuts,
// clicks, typing, words, markers, all in output seconds) and two buses, `music` and `effects`.
// After the composition the runtime adds the project's sounds (built-ins from the kit, files from the
// project) to `effects`, renders, and keeps the two stems for the renderer to read out.
//
// Rendering is fast only when nodes are made shortly before they play: every connected node is
// pulled through each 128-frame quantum, started or not. `audio.at(t, fn)` runs `fn` a moment before
// the render reaches `t` (the kit's instruments do so for every note); the runtime suspends the
// render every second to run what is due.

/** A scene of the video, in output seconds. */
export interface VideoScene {
  index: number;
  id?: string;
  label?: string;
  type: 'clip' | 'still' | 'card' | 'motion';
  start: number;
  end: number;
  /** A clip's speed, and the source seconds it shows. */
  speed?: number;
  from?: number;
  to?: number;
  /** A motion scene's page. */
  src?: string;
}

/** What the music can follow, in output seconds. */
export interface VideoData {
  /** Seconds the video lasts. */
  duration: number;
  fps: number;
  scenes: VideoScene[];
  /** Where one scene gives way to the next (`scene` is the incoming one's index); `jump`: a cut inside a clip. */
  cuts: { t: number; scene: number; jump: boolean }[];
  /** Clicks the video shows. */
  clicks: number[];
  /** Key presses the video shows (typing), at most one per 1/30 s. */
  keys: number[];
  /** The spoken words, and the stretches with speech (words closer than 0.6 s joined). */
  words: { t: number; end: number; text: string }[];
  speech: { start: number; end: number }[];
  /** Claude's prompt, tool calls and answer, where the video shows them. */
  markers: { t: number; kind: string; label?: string }[];
  /** Zooms as the video shows them. */
  zooms: { start: number; end: number; label?: string }[];
}

/** A sound of the project's `sounds`, at an output second: a built-in (`whoosh`) or a file of the project (its URL). */
export interface SoundCue {
  at: number;
  sound: string;
  url?: string;
  volume: number;
}

/** What the renderer tells the page. */
export interface MusicInit {
  /** The video's length: the render's length (seconds). */
  duration: number;
  rate: number;
  params: Record<string, unknown>;
  seed: number;
  video: VideoData;
  sounds: SoundCue[];
  /** The kit's sound module (built-in sounds), imported once the composition is done. */
  kit: string;
}

/** What `compose` gets. */
export interface MusicAudio {
  context: OfflineAudioContext;
  /** The music's bus (stereo): the export lowers it under speech and sets its level. */
  music: GainNode;
  /** The effects' bus (stereo): hits, whooshes, clicks; never lowered under speech. */
  effects: GainNode;
  video: VideoData;
  params: Record<string, unknown>;
  duration: number;
  /** Runs `fn` shortly before the render reaches `t` (seconds), to make the nodes of what plays then. */
  at(t: number, fn: () => void): void;
  /** A seeded random in [0, 1): the same music on every render. */
  random(): number;
}

/** What a page may tell about its music (shown by `cuttle music check`). */
export interface MusicInfo {
  bpm?: number;
  key?: string;
  /** Its parts, in output seconds. */
  sections?: { start: number; end: number; name: string; energy?: number }[];
  [key: string]: unknown;
}

/** The page's `window.cuttle`. */
export interface CuttleMusicApi {
  readonly video: VideoData;
  readonly params: Record<string, unknown>;
  readonly duration: number;
  /** Composes the music: called once, with the context and the buses. May return what it made (bpm, key, sections). */
  music(compose: (audio: MusicAudio) => void | MusicInfo | Promise<void | MusicInfo>): void;
  /** Holds the composition until `promise` settles (samples, impulse responses). */
  ready(promise: Promise<unknown>): void;
}

/** What a render reports. */
export interface MusicRenderResult {
  /** Frames rendered (rate × duration). */
  length: number;
  /** Each stem's highest sample (absolute), before any level is applied. */
  peaks: { music: number; effects: number };
  /** Nodes the composition made, and how long it took to build and to render (ms). */
  nodes: number;
  buildMs: number;
  renderMs: number;
  info: MusicInfo | null;
  /** Sounds of the project that could not play (an unknown name, a file that does not decode). */
  skipped: string[];
}

export function musicRuntime(init: MusicInit): void {
  const page = window as unknown as Record<string, unknown>;
  const errors: string[] = [];
  page.__cuttleErrors = errors;
  const note = (error: unknown) => errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  window.addEventListener('error', (event) => note(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => note(event.reason));

  // a seeded random (mulberry32), also for Math.random
  let seed = init.seed >>> 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = random;

  let composer: ((audio: MusicAudio) => unknown) | undefined;
  const holds: Promise<unknown>[] = [];
  const api: CuttleMusicApi = {
    video: init.video,
    params: init.params,
    duration: init.duration,
    music: (compose) => {
      if (composer) note(new Error('cuttle.music was called more than once; the first composition plays'));
      else composer = compose as (audio: MusicAudio) => unknown;
    },
    ready: (promise) => void holds.push(Promise.resolve(promise).catch(note)),
  };
  page.cuttle = api;

  /** Seconds the render runs ahead of what is made: what starts within this of the render's time is made before it. */
  const AHEAD = 2;
  /** The render stops this often to make what is due. */
  const STEP = 1;
  let rendered: AudioBuffer | undefined;

  page.__cuttleReady = async () => {
    await Promise.all(holds);
  };

  page.__cuttleCompose = async (): Promise<MusicRenderResult> => {
    const started = performance.now();
    const length = Math.max(1, Math.round(init.duration * init.rate));
    const context = new OfflineAudioContext({ numberOfChannels: 4, length, sampleRate: init.rate });
    // two stereo stems in one render: music on channels 0 and 1, effects on 2 and 3
    const merger = context.createChannelMerger(4);
    merger.connect(context.destination);
    context.destination.channelCount = 4;
    context.destination.channelCountMode = 'explicit';
    context.destination.channelInterpretation = 'discrete';
    const stem = (first: number): GainNode => {
      const bus = context.createGain();
      bus.channelCount = 2;
      bus.channelCountMode = 'explicit';
      bus.channelInterpretation = 'speakers';
      const split = context.createChannelSplitter(2);
      bus.connect(split);
      split.connect(merger, 0, first);
      split.connect(merger, 1, first + 1);
      return bus;
    };
    const music = stem(0);
    const effects = stem(2);

    // what to make, by the time it plays
    const due: { t: number; order: number; fn: () => void }[] = [];
    let order = 0;
    let made = Infinity;
    const run = (until: number) => {
      due.sort((a, b) => a.t - b.t || a.order - b.order);
      while (due.length > 0 && due[0]!.t < until) {
        const item = due.shift()!;
        try {
          item.fn();
        } catch (error) {
          note(error);
        }
      }
    };
    const audio: MusicAudio = {
      context,
      music,
      effects,
      video: init.video,
      params: init.params,
      duration: init.duration,
      at: (t, fn) => {
        // during the render, what is due before the next stop is made at once
        if (t < made) {
          try {
            fn();
          } catch (error) {
            note(error);
          }
        } else due.push({ t, order: order++, fn });
      },
      random,
    };
    // a context's node count is not exposed: the kit counts what it makes on the context
    (context as unknown as { __cuttleNodes: number }).__cuttleNodes = 0;

    // the composition: everything it schedules goes into `due` (before the render, `made` is -Infinity)
    made = -Infinity;
    let info: MusicInfo | null = null;
    if (composer) {
      try {
        const result = await composer(audio);
        if (result && typeof result === 'object') info = result as MusicInfo;
      } catch (error) {
        note(error);
      }
    }
    // the project's sounds, on the effects bus
    const skipped: string[] = [];
    if (init.sounds.length > 0) {
      let kit: Record<string, unknown> = {};
      try {
        // a dynamic import a bundler leaves alone (this function runs as text in the page)
        const load = new Function('url', 'return import(url)') as (url: string) => Promise<Record<string, unknown>>;
        kit = await load(init.kit);
      } catch (error) {
        note(error);
      }
      const builtIns = (kit.SOUNDS ?? {}) as Record<string, (audio: MusicAudio, at: number, options: { volume: number; destination: AudioNode }) => void>;
      for (const cue of init.sounds) {
        if (cue.url) {
          try {
            const bytes = await (await fetch(cue.url)).arrayBuffer();
            const buffer = await context.decodeAudioData(bytes);
            audio.at(cue.at - 0.05, () => {
              const source = context.createBufferSource();
              source.buffer = buffer;
              const gain = context.createGain();
              gain.gain.value = cue.volume;
              source.connect(gain).connect(effects);
              source.start(Math.max(0, cue.at));
            });
          } catch {
            skipped.push(`${cue.sound}: the file does not decode as audio`);
          }
        } else if (typeof builtIns[cue.sound] === 'function') {
          const play = builtIns[cue.sound]!;
          audio.at(cue.at - 0.05, () => play(audio, cue.at, { volume: cue.volume, destination: effects }));
        } else skipped.push(`${cue.sound}: no such sound (cuttle sound list)`);
      }
    }
    const built = performance.now();
    // make the first window now, then stop every STEP to make the next
    made = AHEAD;
    run(made);
    for (let t = STEP; t < init.duration; t += STEP) {
      const when = t;
      context
        .suspend(when)
        .then(() => {
          made = when + AHEAD;
          run(made);
          return context.resume();
        })
        .catch(note);
    }
    rendered = await context.startRendering();
    const done = performance.now();
    // no click where the video ends
    const fade = Math.min(rendered.length, Math.round(0.03 * init.rate));
    const peaks = { music: 0, effects: 0 };
    for (let c = 0; c < 4; c++) {
      const data = rendered.getChannelData(c);
      for (let i = 0; i < fade; i++) data[rendered.length - 1 - i]! *= i / fade;
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]!);
        if (v > peak) peak = v;
      }
      if (c < 2) peaks.music = Math.max(peaks.music, peak);
      else peaks.effects = Math.max(peaks.effects, peak);
    }
    return {
      length: rendered.length,
      peaks,
      nodes: (context as unknown as { __cuttleNodes: number }).__cuttleNodes,
      buildMs: Math.round(built - started),
      renderMs: Math.round(done - built),
      info,
      skipped,
    };
  };

  /** Frames `from` to `to` of a stem (`music` or `effects`) as interleaved stereo float32, in base64. */
  page.__cuttleStem = (which: 'music' | 'effects', from: number, to: number): string => {
    if (!rendered) throw new Error('nothing is rendered yet');
    const first = which === 'music' ? 0 : 2;
    const left = rendered.getChannelData(first);
    const right = rendered.getChannelData(first + 1);
    const end = Math.min(to, rendered.length);
    const n = Math.max(0, end - from);
    const out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      out[i * 2] = left[from + i]!;
      out[i * 2 + 1] = right[from + i]!;
    }
    const bytes = new Uint8Array(out.buffer);
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/export/test/music-video.test.ts`
Expected: PASS.

Run: `pnpm exec vitest run --project browser packages/export/test/music-runtime.browser.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/export/src/music packages/export/test/music-video.test.ts packages/export/test/music-runtime.browser.test.ts
git commit -m "export: the video as its music sees it, and the music page's runtime: an offline render in two stems, nodes made as the render reaches them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rendering the soundtrack and mixing it

**Files:**
- Create: `packages/export/src/main/music.ts`, `packages/export/src/main/soundtrack.ts`, `packages/export/src/main/music-check.ts`, `packages/export/test/main/soundtrack.test.ts`
- Modify: `packages/export/src/main/motion.ts`, `packages/export/src/main/export.ts`, `packages/export/src/audio.ts`, `packages/export/src/index.ts`, `packages/export/test/audio.test.ts`, `packages/export/test/main/audio-ffmpeg.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/export/test/main/soundtrack.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import { mixTyping, sceneSpans, typingClicks } from '@cuttle/timeline';
import { DUCK_ATTACK, DUCK_RELEASE, duckEnvelope, planSoundtrack, writeSoundTrack } from '../../src/main/soundtrack';
import type { MusicStems } from '../../src/main/music';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-soundtrack-'));
  dirs.push(dir);
  return dir;
};

function project(input: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, scenes: [{ type: 'clip', id: 's1', from: 0, to: 4 }], ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

const NO_TAKE = { events: [], words: [], markers: [] };

describe('the music under speech', () => {
  it('goes down by the duck while someone speaks, from a moment before the words to a moment after', () => {
    const gain = duckEnvelope([{ start: 2, end: 3 }], 12);
    const low = 10 ** (-12 / 20);
    expect(gain(1)).toBe(1);
    expect(gain(2 - DUCK_ATTACK)).toBe(1);
    expect(gain(2 - DUCK_ATTACK / 2)).toBeCloseTo((1 + low) / 2, 6);
    expect(gain(2.5)).toBeCloseTo(low, 6);
    expect(gain(3 + DUCK_RELEASE / 2)).toBeCloseTo((1 + low) / 2, 6);
    expect(gain(3 + DUCK_RELEASE + 0.01)).toBe(1);
  });

  it('stays down between words close together, and stays up without a duck', () => {
    const gain = duckEnvelope([{ start: 1, end: 2 }, { start: 2.4, end: 3 }], 10);
    expect(gain(2.2)).toBeCloseTo(10 ** (-10 / 20), 6);
    expect(duckEnvelope([{ start: 1, end: 2 }], 0)(1.5)).toBe(1);
  });
});

describe('the soundtrack file', () => {
  it('mixes the music at its volume and duck, the effects at theirs and the typing in the middle, as float stereo', async () => {
    const rate = 48_000;
    const seconds = 12;
    const frames = seconds * rate;
    // music: a constant 0.5 on the left, 0.25 on the right; effects: 0.4 on both from 1 s to 1.1 s
    const music = new Float32Array(frames * 2);
    const effects = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      music[i * 2] = 0.5;
      music[i * 2 + 1] = 0.25;
      if (i >= rate && i < rate * 1.1) effects[i * 2] = effects[i * 2 + 1] = 0.4;
    }
    const stems = { rate, music, effects } as MusicStems;
    const p = project({ scenes: [{ type: 'clip', from: 0, to: seconds }] });
    const clicks = typingClicks(sceneSpans(p.scenes), [{ t: 11, type: 'keys', count: 2 }], p.look.audio);
    const path = join(temp(), 'sound.wav');
    await writeSoundTrack(path, { seconds, stems, music: { volume: 0.5, duck: 6 }, speech: [{ start: 5, end: 6 }], effectsVolume: 0.5, typing: { clicks, volume: 0.5 } });
    const bytes = readFileSync(path);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect([bytes.readUInt16LE(20), bytes.readUInt16LE(22), bytes.readUInt32LE(24), bytes.readUInt16LE(34)]).toEqual([3, 2, rate, 32]);
    expect(bytes.length).toBe(44 + frames * 8);
    const sample = (t: number, channel: 0 | 1) => bytes.readFloatLE(44 + (Math.round(t * rate) * 2 + channel) * 4);
    expect(sample(0.5, 0)).toBeCloseTo(0.25, 5);
    expect(sample(0.5, 1)).toBeCloseTo(0.125, 5);
    expect(sample(1.05, 0)).toBeCloseTo(0.25 + 0.2, 5);
    // under speech: 6 dB down
    expect(sample(5.5, 0)).toBeCloseTo(0.25 * 10 ** (-6 / 20), 3);
    // the typing clicks, the same in both ears on top of the music
    const typing = new Float32Array(frames);
    mixTyping(clicks, 0.5, typing, 0);
    let worst = 0;
    for (let i = 11 * rate; i < frames; i += 7) {
      worst = Math.max(worst, Math.abs(bytes.readFloatLE(44 + i * 8) - 0.25 - typing[i]!), Math.abs(bytes.readFloatLE(44 + i * 8 + 4) - 0.125 - typing[i]!));
    }
    expect(worst).toBeLessThan(1e-5);
    expect(typing.some((v) => Math.abs(v) > 0.01)).toBe(true);
  });
});

describe('the soundtrack\'s plan', () => {
  it('is none when the audio is off, or with neither music nor sounds', async () => {
    const dir = temp();
    expect(await planSoundtrack(dir, project({}), NO_TAKE)).toBeUndefined();
    expect(await planSoundtrack(dir, project({ sounds: [{ sound: 'pop', at: 1 }], look: { audio: { enabled: false } } }), NO_TAKE)).toBeUndefined();
    expect(await planSoundtrack(dir, project({ music: { src: 'music/a/index.html', enabled: false } }), NO_TAKE)).toBeUndefined();
    // effects off: the sounds go, music stays
    expect(await planSoundtrack(dir, project({ sounds: [{ sound: 'pop', at: 1 }], look: { audio: { effects: false } } }), NO_TAKE)).toBeUndefined();
  });

  it('takes the page\'s params with the project\'s over them, and the sounds\' files from the project only', async () => {
    const dir = temp();
    mkdirSync(join(dir, 'music', 'a'), { recursive: true });
    mkdirSync(join(dir, 'sounds'));
    writeFileSync(
      join(dir, 'music', 'a', 'index.html'),
      '<!doctype html><script type="application/json" id="cuttle-params">[{"name":"key","type":"text","default":"D"},{"name":"bpm","type":"number","default":0}]</script>',
    );
    writeFileSync(join(dir, 'sounds', 'ding.wav'), 'RIFF');
    const plan = await planSoundtrack(
      dir,
      project({
        music: { src: 'music/a/index.html', params: { bpm: 120 } },
        sounds: [
          { sound: 'pop', at: 1 },
          { sound: 'sounds/ding.wav', at: 2, volume: 0.5 },
          { sound: 'sounds/missing.wav', at: 3 },
          { sound: '../outside.wav', at: 3 },
        ],
      }),
      NO_TAKE,
    );
    expect(plan).toMatchObject({ page: join(dir, 'music', 'a', 'index.html'), params: { key: 'D', bpm: 120 }, network: false });
    expect(plan!.sounds).toEqual([
      { at: 1, sound: 'pop', volume: 0.8 },
      { at: 2, sound: 'sounds/ding.wav', volume: 0.5, url: 'cuttle-motion://project/sounds/ding.wav' },
    ]);
    expect(plan!.skipped).toEqual(['sounds/missing.wav: not a file in the project', '../outside.wav: not a file in the project']);
    expect(plan!.video.duration).toBe(4);
  });

  it('refuses a music page outside the project, and names one that is missing', async () => {
    const dir = temp();
    await expect(planSoundtrack(dir, project({ music: { src: '../x.html' } }), NO_TAKE)).rejects.toThrow(/outside the project/);
    await expect(planSoundtrack(dir, project({ music: { src: 'music/none/index.html' } }), NO_TAKE)).rejects.toThrow(/no music page at music\/none\/index.html/);
  });
});
```

In `packages/export/test/audio.test.ts`, replace:

```ts
    ]);
  });

  it('needs no mic input when every segment is silent', () => {
    const graph = audioFilterGraph(plan({ scenes }, 6, false));
    expect(graph).not.toContain('[1:a]');
```

with:

```ts
    ]);
  });

  it('mixes a soundtrack in stereo under the mic, then keeps the sum below full scale', () => {
    const parts = audioFilterGraph(plan({ scenes }), 0.5, 1, undefined, 2).split(';');
    expect(parts.slice(-3)).toEqual([
      '[s0][s1][s2][s3]concat=n=4:v=0:a=1,pan=stereo|c0=c0|c1=c0[voice]',
      '[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=end_sample=288000,asetpts=N/SR/TB[sound]',
      '[voice][sound]amix=inputs=2:duration=first:normalize=0,aresample=192000,alimiter=limit=0.89:attack=1:release=60:level=false,aresample=48000[aout]',
    ]);
  });

  it('needs no mic input when every segment is silent', () => {
    const graph = audioFilterGraph(plan({ scenes }, 6, false));
    expect(graph).not.toContain('[1:a]');
```

In the same file, replace:

```ts
    expect(muxArgs({ video: 'v.mp4', graph: 'G', out: 'o.mp4' })).not.toContain('m.m4a');
    // the typing sounds' track comes after the mic
    expect(muxArgs({ video: 'v.mp4', mic: 'm.m4a', typing: 't.wav', graph: 'G', out: 'o.mp4' }).join(' ')).toContain('-i v.mp4 -i m.m4a -i t.wav -filter_complex G');
  });

  it('reads a long graph from a file (Windows limits a command line to 32 767 characters)', () => {
```

with:

```ts
    expect(muxArgs({ video: 'v.mp4', graph: 'G', out: 'o.mp4' })).not.toContain('m.m4a');
    // the typing sounds' track comes after the mic
    expect(muxArgs({ video: 'v.mp4', mic: 'm.m4a', typing: 't.wav', graph: 'G', out: 'o.mp4' }).join(' ')).toContain('-i v.mp4 -i m.m4a -i t.wav -filter_complex G');
    expect(muxArgs({ video: 'v.mp4', sound: 's.wav', graph: 'G', out: 'o.mp4' }).join(' ')).toContain('-i v.mp4 -i s.wav -filter_complex G');
  });

  it('reads a long graph from a file (Windows limits a command line to 32 767 characters)', () => {
```

In `packages/export/test/main/audio-ffmpeg.test.ts`, replace:

```ts
import { audioFilterGraph, planAudio } from '../../src/audio';
import { ffmpegPath } from '../../src/main/ffmpeg';
import { writeTypingTrack } from '../../src/main/typing-track';

const hasFfmpeg = spawnSync(ffmpegPath(), ['-version'], { windowsHide: true }).status === 0;
```

with:

```ts
import { audioFilterGraph, planAudio } from '../../src/audio';
import { ffmpegPath } from '../../src/main/ffmpeg';
import { writeTypingTrack } from '../../src/main/typing-track';
import { writeSoundTrack } from '../../src/main/soundtrack';
import type { MusicStems } from '../../src/main/music';

const hasFfmpeg = spawnSync(ffmpegPath(), ['-version'], { windowsHide: true }).status === 0;
```

In the same file, replace:

```ts
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

with:

```ts
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('mixes a stereo soundtrack under the mic, both ears kept, and limits a sum that would clip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-sound-mix-'));
    try {
      const parsed = parseProject({ version: 1, sources: { screen: 's.mp4', mic: 'm.m4a' }, scenes: [{ type: 'clip', from: 0, to: 3 }], look: { transition: { enabled: false } } });
      if (!parsed.ok) throw new Error('invalid');
      const spans = sceneSpans(parsed.project.scenes);
      // a soundtrack: 0.3 left and 0.1 right for 2 s, then 0.95 in both (with the mic, past full scale)
      const frames = 3 * 48_000;
      const music = new Float32Array(frames * 2);
      for (let i = 0; i < frames; i++) {
        const loud = i >= 2 * 48_000;
        music[i * 2] = loud ? 0.95 : 0.3;
        music[i * 2 + 1] = loud ? 0.95 : 0.1;
      }
      const wav = join(dir, 'sound.wav');
      await writeSoundTrack(wav, { seconds: 3, stems: { rate: 48_000, music, effects: new Float32Array(frames * 2) } as MusicStems, music: { volume: 1, duck: 0 }, effectsVolume: 1 });
      const segments = planAudio({ spans, look: parsed.project.look, mic: true, seconds: 3 });
      const result = spawnSync(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', SINE, '-i', wav, '-filter_complex', audioFilterGraph(segments, 0, 0, undefined, 1), '-map', '[aout]', '-f', 'f32le', '-'], {
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
      if (result.status !== 0) throw new Error(result.stderr.toString());
      const stereo = new Float32Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength / 4);
      expect(stereo.length).toBe(frames * 2);
      const left = stereo.filter((_, i) => i % 2 === 0);
      const right = stereo.filter((_, i) => i % 2 === 1);
      // the mic (a 0.125 sine) rides on each ear's level
      expect(peak(left, 48_000, 48_000 * 1.5)).toBeCloseTo(0.3 + 0.125, 2);
      expect(peak(right, 48_000, 48_000 * 1.5)).toBeCloseTo(0.1 + 0.125, 2);
      // 0.95 + 0.125 would clip: the limiter holds it near 0.89
      expect(peak(left, Math.round(48_000 * 2.2), frames)).toBeLessThan(0.9);
      expect(peak(left, Math.round(48_000 * 2.2), frames)).toBeGreaterThan(0.8);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

Run: `pnpm exec vitest run --project node packages/export/test/main/soundtrack.test.ts packages/export/test/audio.test.ts`
Expected: FAIL: `../../src/main/soundtrack` does not exist, and the graph takes no soundtrack.

- [ ] **Step 2: The page in a hidden window**

A music page uses the motion pages' sessions (the project's files, the kit, no network):

In `packages/export/src/main/motion.ts`, replace:

```ts
/** A frame whose paint has not come in this long is drawn again (ms). */
const REDRAW_MS = 400;
/** At most this many console lines are kept per page. */
const MAX_LOG_LINES = 200;

/** A page's frame: premultiplied RGBA, top row first. */
export interface MotionFrame {
```

with:

```ts
/** A frame whose paint has not come in this long is drawn again (ms). */
const REDRAW_MS = 400;
/** At most this many console lines are kept per page. */
export const MAX_LOG_LINES = 200;

/** A page's frame: premultiplied RGBA, top row first. */
export interface MotionFrame {
```

In the same file, replace:

```ts
const poolKey = (root: string, network: boolean, kitDir: string) => `${resolve(root)}|${network}|${resolve(kitDir)}`;

/** A session of its own for one page: its files from `root` and the kit's, no permissions, no network unless asked. */
function takeSession(root: string, network: boolean, kitDir: string): Session {
  return idle.get(poolKey(root, network, kitDir))?.pop() ?? pageSession(root, network, kitDir);
}

/** A page is done with `ses`: what the page stored is wiped, and the next page may take it. */
function giveBack(ses: Session, root: string, network: boolean, kitDir: string): void {
  void ses
    .clearStorageData()
    .catch(() => {})
```

with:

```ts
const poolKey = (root: string, network: boolean, kitDir: string) => `${resolve(root)}|${network}|${resolve(kitDir)}`;

/** A session of its own for one page: its files from `root` and the kit's, no permissions, no network unless asked. */
export function takeSession(root: string, network: boolean, kitDir: string): Session {
  return idle.get(poolKey(root, network, kitDir))?.pop() ?? pageSession(root, network, kitDir);
}

/** A page is done with `ses`: what the page stored is wiped, and the next page may take it. */
export function giveBack(ses: Session, root: string, network: boolean, kitDir: string): void {
  void ses
    .clearStorageData()
    .catch(() => {})
```

`packages/export/src/main/music.ts`:

```ts
// A video's sound, rendered by a page: the music page Claude wrote (or the kit's blank page, for the
// project's sounds alone) in a hidden offscreen window, sandboxed like a motion page (the project's
// files and the kit, no network). The page renders the whole video's length in an
// OfflineAudioContext (`musicRuntime`), and its two stems, music and effects, are read out as
// interleaved stereo float32.
import { KIT_ORIGIN } from '@cuttle/motion-kit';
import { BrowserWindow, screen } from 'electron';
import { musicRuntime, type MusicInit, type MusicRenderResult } from '../music/runtime';
import { MAX_LOG_LINES, defaultKitDir, giveBack, pageUrl, takeSession, type MotionReport } from './motion';

/** Longest wait for the page to load (its samples, `cuttle.ready`), in ms. */
export const MUSIC_LOAD_TIMEOUT_MS = 30_000;
/** Longest render: this much, plus two seconds for each second of video (ms). */
const RENDER_BASE_MS = 30_000;
/** Frames read out at a time: ten seconds. */
const CHUNK_SECONDS = 10;
/** The kit's page for a video with sounds and no music page. */
export const BLANK_MUSIC_PAGE = `${KIT_ORIGIN}/blank.html`;

export interface MusicPageOptions {
  /** The music page (an HTML file inside `root`); without one, the kit's blank page (the sounds alone). */
  file?: string;
  /** The project's folder: the only files the page reaches. */
  root: string;
  init: Omit<MusicInit, 'kit'>;
  network?: boolean;
  kitDir?: string;
  loadTimeout?: number;
  renderTimeout?: number;
}

/** A rendered soundtrack: each stem interleaved stereo (L, R, L, R…) at `rate`. */
export interface MusicStems {
  rate: number;
  music: Float32Array;
  effects: Float32Array;
  result: MusicRenderResult;
  report: MotionReport;
}

export class MusicPage {
  private readonly logs: string[] = [];
  private failure: string | undefined;

  private constructor(
    private readonly win: BrowserWindow,
    private readonly options: MusicPageOptions,
    private readonly release: () => void,
  ) {
    const contents = win.webContents;
    contents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
      if (this.logs.length >= MAX_LOG_LINES || message.startsWith('%cElectron Security Warning')) return;
      const where = sourceId ? ` (${sourceId.replace(/^.*\//, '')}:${lineNumber})` : '';
      this.logs.push(`${level}: ${message}${where}`);
    });
    contents.on('render-process-gone', (_event, details) => {
      this.failure = `the music page's renderer stopped (${details.reason})`;
    });
  }

  static async open(options: MusicPageOptions): Promise<MusicPage> {
    const kitDir = options.kitDir ?? defaultKitDir();
    const network = options.network === true;
    const ses = takeSession(options.root, network, kitDir);
    const origin = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      show: false,
      x: origin.x,
      y: origin.y,
      width: 64,
      height: 64,
      frame: false,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, session: ses },
    });
    const contents = win.webContents;
    contents.setAudioMuted(true);
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    const page = new MusicPage(win, options, () => giveBack(ses, options.root, network, kitDir));
    const loadTimeout = options.loadTimeout ?? MUSIC_LOAD_TIMEOUT_MS;
    const init: MusicInit = { ...options.init, kit: `${KIT_ORIGIN}/sound.js` };
    try {
      await win.loadURL('about:blank');
      const cdp = contents.debugger;
      cdp.attach('1.3');
      await cdp.sendCommand('Page.enable');
      await cdp.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(${musicRuntime.toString()})(${JSON.stringify(init)});` });
      const url = options.file ? pageUrl(options.root, options.file) : BLANK_MUSIC_PAGE;
      await page.timed(win.loadURL(url), loadTimeout, 'to load');
      await page.timed(contents.executeJavaScript('window.__cuttleReady()'), loadTimeout, 'to get ready');
    } catch (error) {
      const report = await page.report().catch(() => undefined);
      page.close();
      const errors = report?.errors.length ? `\n${report.errors.join('\n')}` : '';
      throw new Error(`${(error as Error).message}${errors}`, { cause: error });
    }
    return page;
  }

  private timed<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`the music page took more than ${Math.round(ms / 1000)} s ${what}`)), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  /** Composes and renders the whole video's sound. */
  async render(): Promise<MusicRenderResult> {
    if (this.failure) throw new Error(this.failure);
    const ms = this.options.renderTimeout ?? RENDER_BASE_MS + this.options.init.duration * 2000;
    return this.timed(this.win.webContents.executeJavaScript('window.__cuttleCompose()') as Promise<MusicRenderResult>, ms, 'to render');
  }

  /** A stem, interleaved stereo float32, read in chunks. */
  async stem(which: 'music' | 'effects', length: number): Promise<Float32Array> {
    const out = new Float32Array(length * 2);
    const chunk = this.options.init.rate * CHUNK_SECONDS;
    for (let from = 0; from < length; from += chunk) {
      const text = (await this.win.webContents.executeJavaScript(`window.__cuttleStem(${JSON.stringify(which)}, ${from}, ${from + chunk})`)) as string;
      const bytes = Buffer.from(text, 'base64');
      out.set(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4), from * 2);
    }
    return out;
  }

  /** What went wrong in the page (uncaught errors and rejections), and its console. */
  async report(): Promise<MotionReport> {
    const errors = this.win.isDestroyed() ? [] : ((await this.win.webContents.executeJavaScript('window.__cuttleErrors ?? []').catch(() => [])) as string[]);
    return { errors: [...(this.failure ? [this.failure] : []), ...errors], console: [...this.logs] };
  }

  close(): void {
    if (this.win.isDestroyed()) return;
    this.win.destroy();
    this.release();
  }
}

/** Opens the page, renders, reads both stems out, and closes it. */
export async function renderMusic(options: MusicPageOptions): Promise<MusicStems> {
  const page = await MusicPage.open(options);
  try {
    const result = await page.render();
    const music = await page.stem('music', result.length);
    const effects = await page.stem('effects', result.length);
    const report = await page.report();
    return { rate: options.init.rate, music, effects, result, report };
  } catch (error) {
    const report = await page.report().catch(() => undefined);
    const errors = report?.errors.length ? `\n${report.errors.join('\n')}` : '';
    throw new Error(`${(error as Error).message}${errors}`, { cause: error });
  } finally {
    page.close();
  }
}


```

- [ ] **Step 3: The soundtrack**

`packages/export/src/main/soundtrack.ts`:

```ts
// The video's own sound besides the mic: its music (a page Claude wrote, rendered as long as the
// video), the project's sounds, and the typing clicks, mixed into one stereo track on the video's
// timeline: the music lowered under speech, each part at its level. The export adds it to the mic.
import { open, readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { CuttleProject } from '@cuttle/project';
import { mixTyping, type TypingClick } from '@cuttle/timeline';
import { AUDIO_SAMPLE_RATE } from '../audio';
import { ExportError } from '../errors';
import { motionSeed } from '../motion/init';
import { declaredParams } from '../motion/params';
import { soundCues, videoData, type VideoInputs } from '../music/video';
import type { VideoData } from '../music/runtime';
import { renderMusic, type MusicStems } from './music';
import { pageUrl } from './motion';

/** The music goes down this long before speech starts, and comes back over this long after it ends (seconds). */
export const DUCK_ATTACK = 0.25;
export const DUCK_RELEASE = 0.45;
/** Samples mixed at a time: 10 s. */
const BLOCK = AUDIO_SAMPLE_RATE * 10;

const inside = (base: string, path: string) => {
  const rel = relative(base, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** A sound names a file (a path with an extension) rather than a built-in sound. */
export const isSoundFile = (sound: string): boolean => /[./\\]/.test(sound);

/** What the soundtrack is made of, before it is rendered. */
export interface SoundtrackPlan {
  video: VideoData;
  /** The music page (absolute), when the project has music that plays. */
  page?: string;
  params: Record<string, unknown>;
  network: boolean;
  seed: number;
  sounds: { at: number; sound: string; url?: string; volume: number }[];
  /** Sounds that cannot play (a file outside the project or missing). */
  skipped: string[];
}

/**
 * What the project's soundtrack holds: none when the audio is off, or when it has no music that plays
 * and no sounds (the typing clicks alone are mixed without a page).
 */
export async function planSoundtrack(projectDir: string, project: CuttleProject, inputs: VideoInputs): Promise<SoundtrackPlan | undefined> {
  const { audio } = project.look;
  if (!audio.enabled) return undefined;
  const music = project.music?.enabled ? project.music : undefined;
  const sounds = audio.effects ? project.sounds.filter((sound) => sound.enabled) : [];
  if (!music && sounds.length === 0) return undefined;
  const root = resolve(projectDir);
  let params: Record<string, unknown> = {};
  let page: string | undefined;
  if (music) {
    page = resolve(root, music.src);
    if (!inside(root, page)) throw new ExportError('invalid-project', `music.src ${music.src} is outside the project folder`);
    const html = await readFile(page, 'utf8').catch(() => {
      throw new ExportError('missing-file', `no music page at ${music.src}`);
    });
    const defaults = Object.fromEntries(declaredParams(html).params.map((param) => [param.name, param.default]));
    params = { ...defaults, ...music.params };
  }
  const skipped: string[] = [];
  const cues: SoundtrackPlan['sounds'] = [];
  for (const cue of soundCues(project, sounds)) {
    if (!isSoundFile(cue.sound)) {
      cues.push(cue);
      continue;
    }
    const path = resolve(root, cue.sound);
    const exists = inside(root, path) && (await stat(path).then((info) => info.isFile(), () => false));
    if (!exists) skipped.push(`${cue.sound}: not a file in the project`);
    else cues.push({ ...cue, url: pageUrl(root, path) });
  }
  return {
    video: videoData(project, inputs),
    ...(page && { page }),
    params,
    network: music?.network ?? false,
    seed: motionSeed(music?.src ?? 'sounds'),
    sounds: cues,
    skipped,
  };
}

/** Renders a planned soundtrack's music and sounds (the page in a hidden window). */
export async function renderSoundtrack(projectDir: string, plan: SoundtrackPlan, options: { kitDir?: string } = {}): Promise<MusicStems> {
  const stems = await renderMusic({
    ...(plan.page && { file: plan.page }),
    root: projectDir,
    network: plan.network,
    ...(options.kitDir && { kitDir: options.kitDir }),
    init: { duration: plan.video.duration, rate: AUDIO_SAMPLE_RATE, params: plan.params, seed: plan.seed, video: plan.video, sounds: plan.sounds },
  });
  stems.result.skipped.push(...plan.skipped);
  return stems;
}

/**
 * The music's gain at each moment: 1, down to `duck` dB under speech (it starts going down before the
 * words, and stays down over a gap too short to come back up in).
 */
export function duckEnvelope(speech: readonly { start: number; end: number }[], duckDb: number): (t: number) => number {
  const low = 10 ** (-duckDb / 20);
  if (duckDb <= 0 || speech.length === 0) return () => 1;
  const spans: { start: number; end: number }[] = [];
  for (const span of [...speech].sort((a, b) => a.start - b.start)) {
    const last = spans.at(-1);
    if (last && span.start - last.end < DUCK_ATTACK + DUCK_RELEASE) last.end = Math.max(last.end, span.end);
    else spans.push({ ...span });
  }
  return (t) => {
    let depth = 0;
    for (const span of spans) {
      if (t < span.start - DUCK_ATTACK) break;
      if (t > span.end + DUCK_RELEASE) continue;
      const k = t < span.start ? (t - (span.start - DUCK_ATTACK)) / DUCK_ATTACK : t > span.end ? 1 - (t - span.end) / DUCK_RELEASE : 1;
      depth = Math.max(depth, Math.min(1, Math.max(0, k)));
    }
    return 1 - (1 - low) * depth;
  };
}

/** A WAV header for `frames` frames of 32-bit float stereo at the export's rate. */
export function floatWavHeader(frames: number): Buffer {
  const bytes = frames * 8;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + bytes, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(3, 20); // IEEE float
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  head.writeUInt32LE(AUDIO_SAMPLE_RATE * 8, 28);
  head.writeUInt16LE(8, 32);
  head.writeUInt16LE(32, 34);
  head.write('data', 36);
  head.writeUInt32LE(bytes, 40);
  return head;
}

export interface SoundTrackParts {
  seconds: number;
  /** The rendered music and sounds, if any, with the music's level and duck. */
  stems?: MusicStems;
  music?: { volume: number; duck: number };
  speech?: readonly { start: number; end: number }[];
  effectsVolume: number;
  /** The typing clicks at their volume, if any. */
  typing?: { clicks: readonly TypingClick[]; volume: number };
}

/**
 * Writes the soundtrack (32-bit float stereo WAV, `seconds` long) at `path`, block by block: the music
 * at its volume and lowered under speech, the effects at theirs, the typing clicks in the middle.
 */
export async function writeSoundTrack(path: string, parts: SoundTrackParts): Promise<void> {
  const total = Math.round(parts.seconds * AUDIO_SAMPLE_RATE);
  const duck = duckEnvelope(parts.speech ?? [], parts.music?.duck ?? 0);
  const musicVolume = parts.music?.volume ?? 0;
  const file = await open(path, 'w');
  try {
    await file.write(floatWavHeader(total));
    for (let start = 0; start < total; start += BLOCK) {
      const n = Math.min(BLOCK, total - start);
      const mono = new Float32Array(n);
      if (parts.typing) mixTyping(parts.typing.clicks, parts.typing.volume, mono, start, AUDIO_SAMPLE_RATE);
      const out = new Float32Array(n * 2);
      const stems = parts.stems;
      const length = stems ? stems.music.length / 2 : 0;
      // the duck changes slowly: worked out every 64 samples
      let gain = 1;
      for (let i = 0; i < n; i++) {
        const frame = start + i;
        if (i % 64 === 0) gain = duck(frame / AUDIO_SAMPLE_RATE);
        let left = mono[i]!;
        let right = mono[i]!;
        if (stems && frame < length) {
          const m = musicVolume * gain;
          left += stems.music[frame * 2]! * m + stems.effects[frame * 2]! * parts.effectsVolume;
          right += stems.music[frame * 2 + 1]! * m + stems.effects[frame * 2 + 1]! * parts.effectsVolume;
        }
        out[i * 2] = left;
        out[i * 2 + 1] = right;
      }
      await file.write(Buffer.from(out.buffer, out.byteOffset, out.byteLength));
    }
  } finally {
    await file.close();
  }
}
```

The graph mixes it with the mic and limits the sum; the mux takes it as an input:

In `packages/export/src/audio.ts`, replace:

```ts
export const AUDIO_BITRATE = '160k';
/** Shortest fade at a cut, so hard cuts do not click. */
const MIN_FADE_SECONDS = 0.01;
/**
 * Silence (input samples) appended before `atempo`: it returns several hundred samples fewer than
 * (to − from) / speed and needs input past the end to flush, so the clip's sound reaches its
```

with:

```ts
export const AUDIO_BITRATE = '160k';
/** Shortest fade at a cut, so hard cuts do not click. */
const MIN_FADE_SECONDS = 0.01;
/** The soundtrack's ceiling under the mic: about -1 dBFS. */
const LIMIT = 0.89;
/**
 * Silence (input samples) appended before `atempo`: it returns several hundred samples fewer than
 * (to − from) / speed and needs input past the end to flush, so the clip's sound reaches its
```

In the same file, replace:

```ts
 * how many seconds after the screen track the mic started (negative: before); the mic is shifted
 * once so its time 0 is the screen track's time 0. Without mic segments the graph is silence only.
 * `typingInput`: the typing sounds' track (on the output timeline already), mixed in at its level.
 */
export function audioFilterGraph(segments: readonly AudioSegment[], micOffset = 0, micInput = 1, typingInput?: number): string {
  const filters: string[] = [];
  const micSegments = segments.filter((segment) => segment.mic !== undefined).length;
  if (micSegments > 0) {
```

with:

```ts
 * how many seconds after the screen track the mic started (negative: before); the mic is shifted
 * once so its time 0 is the screen track's time 0. Without mic segments the graph is silence only.
 * `typingInput`: the typing sounds' track (on the output timeline already), mixed in at its level.
 * `soundInput`: the soundtrack instead (stereo: the music, the sounds and the typing clicks), mixed
 * with the mic and then limited, so the sum cannot clip.
 */
export function audioFilterGraph(segments: readonly AudioSegment[], micOffset = 0, micInput = 1, typingInput?: number, soundInput?: number): string {
  const filters: string[] = [];
  const micSegments = segments.filter((segment) => segment.mic !== undefined).length;
  if (micSegments > 0) {
```

In the same file, replace:

```ts
    filters.push(`${chain.join(',')}[s${i}]`);
  });
  const inputs = segments.map((_, i) => `[s${i}]`).join('');
  if (typingInput === undefined) {
    filters.push(`${inputs}concat=n=${segments.length}:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]`);
    return filters.join(';');
```

with:

```ts
    filters.push(`${chain.join(',')}[s${i}]`);
  });
  const inputs = segments.map((_, i) => `[s${i}]`).join('');
  if (soundInput !== undefined) {
    const total = segments.reduce((sum, segment) => sum + segment.samples, 0);
    filters.push(
      `${inputs}concat=n=${segments.length}:v=0:a=1,pan=stereo|c0=c0|c1=c0[voice]`,
      [`[${soundInput}:a]aresample=${AUDIO_SAMPLE_RATE}`, 'aformat=sample_fmts=fltp:channel_layouts=stereo', 'apad', `atrim=end_sample=${total}`, 'asetpts=N/SR/TB[sound]'].join(','),
      // added as they are, then kept below full scale (at four times the rate, so peaks between samples count)
      `[voice][sound]amix=inputs=2:duration=first:normalize=0,aresample=${AUDIO_SAMPLE_RATE * 4},alimiter=limit=${LIMIT}:attack=1:release=60:level=false,aresample=${AUDIO_SAMPLE_RATE}[aout]`,
    );
    return filters.join(';');
  }
  if (typingInput === undefined) {
    filters.push(`${inputs}concat=n=${segments.length}:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]`);
    return filters.join(';');
```

In the same file, replace:

```ts
  mic?: string;
  /** The typing sounds' track, when the graph mixes it in (the input after the mic). */
  typing?: string;
  graph: string;
  /** A file holding `graph`, used instead of the inline graph when given. */
  graphFile?: string;
```

with:

```ts
  mic?: string;
  /** The typing sounds' track, when the graph mixes it in (the input after the mic). */
  typing?: string;
  /** The soundtrack (music, sounds, typing), when the graph mixes it in (the input after the mic). */
  sound?: string;
  graph: string;
  /** A file holding `graph`, used instead of the inline graph when given. */
  graphFile?: string;
```

In the same file, replace:

```ts
}

/** ffmpeg arguments that add the audio to the video without re-encoding it: AAC 48 kHz, moov at the front. */
export function muxArgs({ video, mic, typing, graph, graphFile, out }: MuxArgsOptions): string[] {
  return [
    '-hide_banner',
    '-nostdin',
```

with:

```ts
}

/** ffmpeg arguments that add the audio to the video without re-encoding it: AAC 48 kHz, moov at the front. */
export function muxArgs({ video, mic, typing, sound, graph, graphFile, out }: MuxArgsOptions): string[] {
  return [
    '-hide_banner',
    '-nostdin',
```

In the same file, replace:

```ts
    video,
    ...(mic ? ['-i', mic] : []),
    ...(typing ? ['-i', typing] : []),
    ...(graphFile ? ['-/filter_complex', graphFile] : ['-filter_complex', graph]),
    '-map',
    '0:v:0',
```

with:

```ts
    video,
    ...(mic ? ['-i', mic] : []),
    ...(typing ? ['-i', typing] : []),
    ...(sound ? ['-i', sound] : []),
    ...(graphFile ? ['-/filter_complex', graphFile] : ['-filter_complex', graph]),
    '-map',
    '0:v:0',
```

The export renders it beside the frames and reports what the page said:

In `packages/export/src/main/export.ts`, replace:

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans, toSrt, toVtt, typingClicks } from '@cuttle/timeline';
import { app } from 'electron';
```

with:

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans, toSrt, toVtt, typingClicks } from '@cuttle/timeline';
import { app } from 'electron';
```

In the same file, replace:

```ts
import { checkFfmpeg, runFfmpeg } from './ffmpeg';
import { FileHost } from './files';
import { MotionHost, motionWarnings, serveMotion, type MotionItemReport } from './motion-host';
import { loadSources, samePath } from './sources';
import { writeTypingTrack } from './typing-track';
import { openExportWindow, type ExportWindow } from './window';
```

with:

```ts
import { checkFfmpeg, runFfmpeg } from './ffmpeg';
import { FileHost } from './files';
import { MotionHost, motionWarnings, serveMotion, type MotionItemReport } from './motion-host';
import { loadSources, motionTake, samePath } from './sources';
import { planSoundtrack, renderSoundtrack, writeSoundTrack, type SoundtrackPlan } from './soundtrack';
import type { MusicStems } from './music';
import { writeTypingTrack } from './typing-track';
import { openExportWindow, type ExportWindow } from './window';
```

In the same file, replace:

```ts
  subtitles?: string[];
  /** What the motion items' pages said (errors and console), when the project has any. */
  motion?: MotionItemReport[];
  stats: ExportStats;
}

/** Without a newly rendered frame for this long the export counts as stalled (a hung encoder or decoder). */
const STALL_SECONDS = 60;
/** Leftovers of exports that were killed before they could clean up are removed after this long. */
```

with:

```ts
  subtitles?: string[];
  /** What the motion items' pages said (errors and console), when the project has any. */
  motion?: MotionItemReport[];
  /** The music and sounds, when the project has any: what the page made and said, and sounds that could not play. */
  music?: SoundtrackReport;
  stats: ExportStats;
}

/** What rendering a project's music and sounds came to. */
export interface SoundtrackReport {
  /** The music page, relative to the project folder (none: the sounds alone). */
  src?: string;
  /** What the page told about its music (bpm, key, sections). */
  info: MusicStems['result']['info'];
  /** Each stem's highest sample before its level. */
  peaks: MusicStems['result']['peaks'];
  nodes: number;
  renderMs: number;
  /** Sounds that could not play. */
  skipped: string[];
  errors: string[];
  console: string[];
}

/** The report of a rendered soundtrack. */
export function soundtrackReport(projectDir: string, plan: SoundtrackPlan, stems: MusicStems): SoundtrackReport {
  const { result, report } = stems;
  return {
    ...(plan.page && { src: relativeSrc(projectDir, plan.page) }),
    info: result.info,
    peaks: result.peaks,
    nodes: result.nodes,
    renderMs: result.renderMs,
    skipped: result.skipped,
    errors: report.errors,
    console: report.console,
  };
}

const relativeSrc = (projectDir: string, page: string) => relative(resolve(projectDir), page).split(sep).join('/');

/** Without a newly rendered frame for this long the export counts as stalled (a hung encoder or decoder). */
const STALL_SECONDS = 60;
/** Leftovers of exports that were killed before they could clean up are removed after this long. */
```

In the same file, replace:

```ts
  let files: FileHost | undefined;
  let window: ExportWindow | undefined;
  const motion = sources.motion && sources.motionTake ? new MotionHost(project, sources.motion, sources.motionTake) : undefined;
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const video = join(work, 'video.mp4');
```

with:

```ts
  let files: FileHost | undefined;
  let window: ExportWindow | undefined;
  const motion = sources.motion && sources.motionTake ? new MotionHost(project, sources.motion, sources.motionTake) : undefined;
  // the music and sounds render beside the frames, in a page of their own
  const soundPlan = await planSoundtrack(projectDir, project, sources.motionTake ?? (await motionTake(projectDir, project)));
  let soundtrack: Promise<MusicStems> | undefined;
  try {
    work = await mkdtemp(join(tmpdir(), WORK_PREFIX));
    const video = join(work, 'video.mp4');
```

In the same file, replace:

```ts
      opts.onProgress?.(done, total);
    });
    serveMotion(ipc, motion, guard.alive);

    const page = await runPage<PageSuccess>(window, guard.stalled, cancel.promise);
    guard.stop();
```

with:

```ts
      opts.onProgress?.(done, total);
    });
    serveMotion(ipc, motion, guard.alive);
    soundtrack = soundPlan ? renderSoundtrack(projectDir, soundPlan) : undefined;
    soundtrack?.catch(() => {});

    const page = await runPage<PageSuccess>(window, guard.stalled, cancel.promise);
    guard.stop();
```

In the same file, replace:

```ts
    const usesMic = segments.some((segment) => segment.mic !== undefined);
    // the typing sounds: a track of their own on the video's timeline, mixed in after the mic
    const clicks = typingClicks(spans, sources.keys ?? [], project.look.audio);
    const typing = clicks.length > 0 ? join(work, 'typing.wav') : undefined;
    if (typing) await writeTypingTrack(typing, clicks, project.look.audio.typingVolume, seconds);
    const graph = audioFilterGraph(segments, sources.mic?.offset ?? 0, 1, typing ? (usesMic ? 2 : 1) : undefined);
    const graphFile = graph.length > INLINE_GRAPH_LIMIT ? join(work, 'audio.graph') : undefined;
    if (graphFile) await writeFile(graphFile, graph);
    await runFfmpeg(muxArgs({ video, mic: usesMic ? sources.mic?.path : undefined, typing, graph, graphFile, out: partial }), signal);
    throwIfCancelled();
    try {
      await rename(partial, out);
```

with:

```ts
    const usesMic = segments.some((segment) => segment.mic !== undefined);
    // the typing sounds: a track of their own on the video's timeline, mixed in after the mic
    const clicks = typingClicks(spans, sources.keys ?? [], project.look.audio);
    // with music or sounds, one stereo soundtrack holds them and the typing clicks; else the clicks alone
    const stems = soundtrack ? await soundtrack.catch((error: Error) => {
      throw new ExportError('render', `the music could not be rendered: ${error.message}`, { cause: error });
    }) : undefined;
    let musicReport: SoundtrackReport | undefined;
    let typing: string | undefined;
    let sound: string | undefined;
    if (stems && soundPlan) {
      musicReport = soundtrackReport(projectDir, soundPlan, stems);
      for (const warning of [...musicReport.errors, ...musicReport.skipped]) console.warn(`warning: music${musicReport.src ? ` (${musicReport.src})` : ''}: ${warning}`);
      sound = join(work, 'sound.wav');
      await writeSoundTrack(sound, {
        seconds,
        stems,
        ...(project.music?.enabled && { music: { volume: project.music.volume, duck: project.music.duck } }),
        speech: soundPlan.video.speech,
        effectsVolume: project.look.audio.effects ? project.look.audio.effectsVolume : 0,
        ...(clicks.length > 0 && { typing: { clicks, volume: project.look.audio.typingVolume } }),
      });
    } else if (clicks.length > 0) {
      typing = join(work, 'typing.wav');
      await writeTypingTrack(typing, clicks, project.look.audio.typingVolume, seconds);
    }
    const extra = usesMic ? 2 : 1;
    const graph = audioFilterGraph(segments, sources.mic?.offset ?? 0, 1, typing ? extra : undefined, sound ? extra : undefined);
    const graphFile = graph.length > INLINE_GRAPH_LIMIT ? join(work, 'audio.graph') : undefined;
    if (graphFile) await writeFile(graphFile, graph);
    await runFfmpeg(muxArgs({ video, mic: usesMic ? sources.mic?.path : undefined, typing, sound, graph, graphFile, out: partial }), signal);
    throwIfCancelled();
    try {
      await rename(partial, out);
```

In the same file, replace:

```ts
      seconds,
      ...(written.length > 0 && { subtitles: written }),
      ...(said && { motion: said }),
      stats: {
        gpu: page.gpu,
        codec: page.codec,
```

with:

```ts
      seconds,
      ...(written.length > 0 && { subtitles: written }),
      ...(said && { motion: said }),
      ...(musicReport && { music: musicReport }),
      stats: {
        gpu: page.gpu,
        codec: page.codec,
```

- [ ] **Step 4: The check**

`packages/export/src/main/music-check.ts`:

```ts
// `cuttle music check`: the project's music and sounds rendered alone (no frames), written as a WAV
// to listen to, and measured for whoever cannot listen: the loudness (LUFS, true peak), each part's
// level, whether a hit lands on each scene change, and a sheet of the waveforms over the scenes.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { BrowserWindow, app } from 'electron';
import { AUDIO_SAMPLE_RATE } from '../audio';
import { ExportError } from '../errors';
import { ffmpegPath } from './ffmpeg';
import { soundtrackReport, type SoundtrackReport } from './export';
import { motionTake, loadSources } from './sources';
import { duckEnvelope, planSoundtrack, renderSoundtrack, writeSoundTrack } from './soundtrack';

export interface MusicCheckOptions {
  projectDir: string;
  /** The WAV to write (the music and sounds, no mic). */
  out: string;
  /** The sheet to draw (PNG). */
  sheet?: string;
  /** A page to check in place of the project's `music.src`. */
  src?: string;
}

export interface MusicCheckPart {
  name: string;
  start: number;
  end: number;
  energy?: number;
  /** The music's level (RMS dBFS, after its volume and the duck) and the effects'. */
  musicDb: number;
  effectsDb: number;
}

export interface MusicCheckResult extends SoundtrackReport {
  out: string;
  sheet?: string;
  seconds: number;
  /** Integrated loudness and true peak of the music and sounds alone. */
  loudness: { lufs: number | null; truePeak: number | null };
  /** The page's sections (or the video's scenes) with their levels. */
  parts: MusicCheckPart[];
  /** Each scene change (not a jump cut), and whether the sound gets louder on it (a hit). */
  cuts: { t: number; hit: boolean; riseDb: number }[];
}

const db = (rms: number) => (rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -120);

/** RMS of an interleaved stereo stem from `from` to `to` seconds, each sample scaled by `gain(t)`. */
function rms(stem: Float32Array, from: number, to: number, gain: (t: number) => number = () => 1): number {
  const a = Math.max(0, Math.floor(from * AUDIO_SAMPLE_RATE));
  const b = Math.min(stem.length / 2, Math.floor(to * AUDIO_SAMPLE_RATE));
  if (b <= a) return 0;
  let sum = 0;
  let g = 1;
  for (let i = a; i < b; i++) {
    if ((i - a) % 256 === 0) g = gain(i / AUDIO_SAMPLE_RATE);
    const l = stem[i * 2]! * g;
    const r = stem[i * 2 + 1]! * g;
    sum += (l * l + r * r) / 2;
  }
  return Math.sqrt(sum / (b - a));
}

/** Integrated loudness and true peak by ffmpeg's EBU R128 meter. */
async function loudness(wav: string): Promise<{ lufs: number | null; truePeak: number | null }> {
  const text = await new Promise<string>((done) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.on('close', () => done(err));
    child.on('error', () => done(''));
  });
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const lufs = /I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1];
  const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1];
  return { lufs: lufs ? Number(lufs) : null, truePeak: peak ? Number(peak) : null };
}

/** The sheet's page: the stems' waveforms over the scenes, the speech, the cuts and their hits. */
function sheetHtml(data: unknown): string {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden;background:#101014"><canvas id="c" width="1600" height="900"></canvas><script>
const d = ${JSON.stringify(data)};
const c = document.getElementById('c').getContext('2d');
const W = 1600, L = 40, R = 1560, x = (t) => L + (t / d.seconds) * (R - L);
c.fillStyle = '#101014'; c.fillRect(0, 0, W, 900);
c.font = '600 22px Segoe UI, sans-serif'; c.fillStyle = '#f2f2f5';
c.fillText(d.title, L, 42);
c.font = '15px Segoe UI, sans-serif'; c.fillStyle = '#9a9aa6';
c.fillText(d.subtitle, L, 68);
const lanes = [{ name: 'music (after its volume and the duck)', y: 120, h: 300, peaks: d.music, color: '#d97757' }, { name: 'effects', y: 470, h: 220, peaks: d.effects, color: '#7ec8e3' }];
// the parts, as bands
d.parts.forEach((p, i) => {
  c.fillStyle = i % 2 ? '#17171d' : '#1d1d25';
  c.fillRect(x(p.start), 100, x(p.end) - x(p.start), 610);
  c.fillStyle = '#c9c9d6'; c.font = '600 14px Segoe UI, sans-serif';
  c.fillText(p.name + (p.energy !== undefined ? ' · ' + p.energy : ''), x(p.start) + 6, 116);
  c.fillStyle = '#7d7d8a'; c.font = '12px Segoe UI, sans-serif';
  c.fillText(p.musicDb + ' dB', x(p.start) + 6, 412);
});
// speech
c.fillStyle = 'rgba(126, 224, 165, 0.16)';
for (const s of d.speech) c.fillRect(x(s.start), 720, Math.max(1, x(s.end) - x(s.start)), 18);
c.fillStyle = '#7ee0a5'; c.font = '12px Segoe UI, sans-serif'; c.fillText('speech', L, 754);
for (const lane of lanes) {
  const mid = lane.y + lane.h / 2;
  c.strokeStyle = '#2a2a33'; c.beginPath(); c.moveTo(L, mid); c.lineTo(R, mid); c.stroke();
  c.fillStyle = lane.color;
  lane.peaks.forEach(([lo, hi], i) => {
    const px = L + i;
    c.fillRect(px, mid - hi * lane.h / 2, 1, Math.max(1, (hi - lo) * lane.h / 2));
  });
  c.fillStyle = '#9a9aa6'; c.font = '12px Segoe UI, sans-serif'; c.fillText(lane.name, L, lane.y + lane.h + 14);
}
// the cuts and whether they hit
for (const cut of d.cuts) {
  c.strokeStyle = cut.hit ? '#7ee0a5' : '#ff6b6b'; c.lineWidth = 2; c.setLineDash([5, 4]);
  c.beginPath(); c.moveTo(x(cut.t), 100); c.lineTo(x(cut.t), 710); c.stroke(); c.setLineDash([]);
  c.fillStyle = cut.hit ? '#7ee0a5' : '#ff6b6b'; c.font = '11px Segoe UI, sans-serif';
  c.fillText((cut.hit ? 'hit ' : 'no hit ') + cut.riseDb + ' dB', x(cut.t) + 3, 704);
}
// seconds
c.fillStyle = '#7d7d8a'; c.font = '12px Segoe UI, sans-serif';
const step = d.seconds > 120 ? 10 : 5;
for (let t = 0; t <= d.seconds; t += step) { c.fillRect(x(t), 770, 1, 8); c.fillText(t + ' s', x(t) - 8, 795); }
window.done = true;
</script>`;
}

/** Min and max of a stem in each of `columns` columns (mono: the louder ear), scaled by `gain(t)`. */
function columnsOf(stem: Float32Array, columns: number, gain: (t: number) => number = () => 1): [number, number][] {
  const frames = stem.length / 2;
  const out: [number, number][] = [];
  for (let c = 0; c < columns; c++) {
    const a = Math.floor((c * frames) / columns);
    const b = Math.max(a + 1, Math.floor(((c + 1) * frames) / columns));
    let lo = 0;
    let hi = 0;
    const g = gain(a / AUDIO_SAMPLE_RATE);
    for (let i = a; i < b && i < frames; i++) {
      const v = (Math.abs(stem[i * 2]!) > Math.abs(stem[i * 2 + 1]!) ? stem[i * 2]! : stem[i * 2 + 1]!) * g;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out.push([Math.max(-1, lo), Math.min(1, hi)]);
  }
  return out;
}

/** Draws the sheet in a hidden window and writes it as a PNG. */
async function drawSheet(path: string, data: unknown): Promise<void> {
  const win = new BrowserWindow({ show: false, width: 1600, height: 900, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, javascript: true } });
  try {
    await win.loadURL(`data:text/html;base64,${Buffer.from(sheetHtml(data)).toString('base64')}`);
    for (let i = 0; i < 50 && !(await win.webContents.executeJavaScript('window.done === true')); i++) await new Promise((done) => setTimeout(done, 50));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1600, height: 900 });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, image.resize({ width: 1600, height: 900 }).toPNG());
  } finally {
    win.destroy();
  }
}

export async function checkMusic(options: MusicCheckOptions): Promise<MusicCheckResult> {
  await app.whenReady();
  const projectDir = resolve(options.projectDir);
  const sources = await loadSources(projectDir);
  let project = sources.project;
  if (options.src) project = { ...project, music: { volume: 0.8, duck: 12, network: false, params: {}, ...project.music, src: options.src, enabled: true } };
  const inputs = sources.motionTake ?? (await motionTake(projectDir, project));
  const plan = await planSoundtrack(projectDir, project, inputs);
  if (!plan) {
    const why = !project.look.audio.enabled ? 'the audio is off (look.audio.enabled)' : 'the project has no music and no sounds: add some with "cuttle music new" or "cuttle sound add"';
    throw new ExportError('invalid-project', why);
  }
  const stems = await renderSoundtrack(projectDir, plan);
  const report = soundtrackReport(projectDir, plan, stems);
  const seconds = plan.video.duration;
  const music = project.music?.enabled ? project.music : undefined;
  const volume = music?.volume ?? 0;
  const duck = duckEnvelope(plan.video.speech, music?.duck ?? 0);
  const musicGain = (t: number) => volume * duck(t);
  const effectsVolume = project.look.audio.effects ? project.look.audio.effectsVolume : 0;
  const out = resolve(options.out);
  await mkdir(dirname(out), { recursive: true });
  await writeSoundTrack(out, { seconds, stems, ...(music && { music: { volume: music.volume, duck: music.duck } }), speech: plan.video.speech, effectsVolume });

  // the page's own sections (what it says is checked), else the scenes
  const told = (Array.isArray(report.info?.sections) ? report.info.sections : [])
    .filter((part) => typeof part?.start === 'number' && typeof part.end === 'number' && part.end > part.start)
    .map((part) => ({ start: part.start, end: part.end, name: String(part.name ?? ''), ...(typeof part.energy === 'number' && { energy: part.energy }) }));
  const sections: { start: number; end: number; name: string; energy?: number }[] =
    told.length > 0 ? told : plan.video.scenes.map((scene) => ({ start: scene.start, end: scene.end, name: scene.label ?? scene.type }));
  const parts: MusicCheckPart[] = sections.map((part) => ({
    name: part.name,
    start: part.start,
    end: part.end,
    ...(part.energy !== undefined && { energy: part.energy }),
    musicDb: db(rms(stems.music, part.start, part.end, musicGain)),
    effectsDb: db(rms(stems.effects, part.start, part.end, () => effectsVolume)),
  }));
  // a hit: the 60 ms after the cut are clearly louder than the second before it (a riser's last 0.3 s left out)
  const both = new Float32Array(stems.music.length);
  let gain = 0;
  for (let i = 0; i < both.length; i++) {
    if (i % 512 === 0) gain = musicGain(i / 2 / AUDIO_SAMPLE_RATE);
    both[i] = stems.music[i]! * gain + stems.effects[i]! * effectsVolume;
  }
  const cuts = plan.video.cuts
    .filter((cut) => !cut.jump)
    .map((cut) => {
      const rise = db(rms(both, cut.t, cut.t + 0.06)) - db(rms(both, Math.max(0, cut.t - 1.3), cut.t - 0.3));
      return { t: cut.t, hit: rise >= 4, riseDb: Math.round(rise * 10) / 10 };
    });
  const level = await loudness(out);
  const sheet = options.sheet ? resolve(options.sheet) : undefined;
  if (sheet) {
    const info = report.info;
    await drawSheet(sheet, {
      title: `${report.src ?? 'the sounds'}${info?.bpm ? ` · ${info.bpm} BPM` : ''}${info?.key ? ` · ${info.key}` : ''}`,
      subtitle: `${seconds.toFixed(1)} s · ${level.lufs ?? '?'} LUFS · true peak ${level.truePeak ?? '?'} dBFS · ${cuts.filter((cut) => cut.hit).length} of ${cuts.length} scene changes hit · ${report.errors.length} errors`,
      seconds,
      parts,
      cuts,
      speech: plan.video.speech,
      music: columnsOf(stems.music, 1520, musicGain),
      effects: columnsOf(stems.effects, 1520, () => effectsVolume),
    });
  }
  return { ...report, out, ...(sheet && { sheet }), seconds, loudness: level, parts, cuts };
}
```

In `packages/export/src/index.ts`, replace:

```ts
export type { EncoderPreference, ExportErrorCode } from './job';
export { renderStills, stillName, type StillsOptions, type StillsResult } from './main/stills';
export { MOTION_SCHEME_PRIVILEGES } from './main/motion';
export type { MotionItemReport } from './main/motion-host';
export { MotionPreview, type MotionPreviewOptions, type MotionStatus, type PreviewMode } from './main/motion-preview';
export type { MotionFrameRequest, MotionPixels } from './job';
```

with:

```ts
export type { EncoderPreference, ExportErrorCode } from './job';
export { renderStills, stillName, type StillsOptions, type StillsResult } from './main/stills';
export { MOTION_SCHEME_PRIVILEGES } from './main/motion';
export { checkMusic, type MusicCheckOptions, type MusicCheckResult } from './main/music-check';
export type { SoundtrackReport } from './main/export';
export type { MotionItemReport } from './main/motion-host';
export { MotionPreview, type MotionPreviewOptions, type MotionStatus, type PreviewMode } from './main/motion-preview';
export type { MotionFrameRequest, MotionPixels } from './job';
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node packages/export`
Expected: PASS.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/export
git commit -m "export: render the music page beside the frames, mix it with the sounds and typing under the mic, limited; the music check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The commands

**Files:**
- Create: `apps/cli/src/commands/music.ts`, `apps/cli/test/music.test.ts`
- Modify: `apps/cli/src/main.ts`, `apps/cli/src/electron/main.ts`, `apps/cli/src/electron/protocol.ts`, `apps/cli/test/electron.check.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/cli/test/music.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUILT_IN_SOUNDS, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import { runCli } from '../src/main';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-music-'));
  dirs.push(dir);
  writeFileSync(
    join(dir, 'cuttle.json'),
    JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, scenes: [{ type: 'clip', id: 's1', from: 0, to: 10 }, { type: 'card', id: 's2', title: 'Hi', duration: 3 }] }),
  );
  return dir;
};

async function cli(...argv: string[]) {
  let stdout = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: () => {} });
  return { code, json: JSON.parse(stdout) as Record<string, unknown> };
}

const project = (dir: string) => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { music?: Record<string, unknown>; sounds?: Record<string, unknown>[] };

describe('cuttle music', () => {
  it('lists the music templates', async () => {
    const { code, json } = await cli('--json', 'music', 'templates');
    expect(code).toBe(0);
    expect(json.templates).toEqual(MUSIC_TEMPLATES);
  });

  it('copies a template into music/ and makes it the music, keeping the level of the music before', async () => {
    const dir = temp();
    const pulse = await cli('--json', '-C', dir, 'music', 'new', 'pulse');
    expect(pulse.code).toBe(0);
    expect(pulse.json).toEqual({ template: 'pulse', src: 'music/pulse/index.html', music: { src: 'music/pulse/index.html', params: {}, enabled: true } });
    expect(readFileSync(join(dir, 'music', 'pulse', 'index.html'), 'utf8')).toContain('cuttle.music(');
    expect((await cli('--json', '-C', dir, 'music', 'set', '--volume', '0.5', '--param', 'key=E', '--param', 'bpm=118', '--param', 'hits=false')).code).toBe(0);
    expect(project(dir).music).toEqual({ src: 'music/pulse/index.html', params: { key: 'E', bpm: 118, hits: false }, enabled: true, volume: 0.5 });
    // another template: a folder of its own, the level kept, the params its own
    const drift = await cli('--json', '-C', dir, 'music', 'new', 'drift', '--name', 'calm');
    expect(drift.json.src).toBe('music/calm/index.html');
    expect(project(dir).music).toEqual({ src: 'music/calm/index.html', params: {}, enabled: true, volume: 0.5 });
  });

  it('sets the duck, a param away, another page, and on and off', async () => {
    const dir = temp();
    await cli('--json', '-C', dir, 'music', 'new', 'lofi');
    await cli('--json', '-C', dir, 'music', 'set', '--param', 'swing=0.3', '--duck', '18', '--off');
    expect(project(dir).music).toMatchObject({ params: { swing: 0.3 }, duck: 18, enabled: false });
    mkdirSync(join(dir, 'music', 'mine'));
    writeFileSync(join(dir, 'music', 'mine', 'index.html'), '<!doctype html>');
    await cli('--json', '-C', dir, 'music', 'set', '--param', 'swing=', '--src', 'music/mine/index.html', '--on');
    expect(project(dir).music).toMatchObject({ src: 'music/mine/index.html', params: {}, enabled: true });
  });

  it('refuses what it cannot do', async () => {
    const dir = temp();
    expect((await cli('--json', '-C', dir, 'music', 'new', 'polka')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'music', 'set', '--volume', '0.4')).json).toMatchObject({ error: { code: 'invalid-project' } });
    expect((await cli('--json', '-C', dir, 'music', 'set', '--volume', '1.5')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'music', 'set', '--src', '../x.html')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'music', 'check', '--src', 'music/none.html')).json).toMatchObject({ error: { code: 'missing-file' } });
  });
});

describe('cuttle sound', () => {
  it('lists the built-in sounds', async () => {
    const { code, json } = await cli('--json', 'sound', 'list');
    expect(code).toBe(0);
    expect(json.sounds).toEqual(BUILT_IN_SOUNDS.map(([name, description]) => ({ name, description })));
  });

  it('adds a built-in sound at a source second, and a file of the project into a scene', async () => {
    const dir = temp();
    mkdirSync(join(dir, 'sounds'));
    writeFileSync(join(dir, 'sounds', 'ding.wav'), 'RIFF');
    expect((await cli('--json', '-C', dir, 'sound', 'add', 'whoosh', '--at', '4.5')).json).toEqual({ sound: { id: 'a1', sound: 'whoosh', at: 4.5 } });
    expect((await cli('--json', '-C', dir, 'sound', 'add', './sounds/ding.wav', '--at', '0.5', '--scene', 's2', '--volume', '0.6', '--label', 'Done')).json).toEqual({
      sound: { id: 'a2', label: 'Done', sound: 'sounds/ding.wav', at: 0.5, scene: 's2', volume: 0.6 },
    });
    expect(project(dir).sounds).toHaveLength(2);
  });

  it('refuses an unknown sound, a file outside the project or of another kind, and a scene that is not there', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect((await cli('--json', '-C', dir, 'sound', 'add', 'kazoo', '--at', '1')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'sound', 'add', 'notes.txt', '--at', '1')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'sound', 'add', '../x.wav', '--at', '1')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'sound', 'add', 'pop', '--at', '1', '--scene', 's9')).json).toMatchObject({ error: { code: 'usage' } });
    expect(project(dir).sounds).toBeUndefined();
  });
});
```

Run: `pnpm exec vitest run --project node apps/cli/test/music.test.ts`
Expected: FAIL: there is no `music` command.

- [ ] **Step 2: `music` and `sound`**

`apps/cli/src/commands/music.ts`:

```ts
import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { BUILT_IN_SOUNDS, MUSIC_TEMPLATES, type MusicTemplate } from '@cuttle/motion-kit';
import { copyTemplate, MissingTemplateError } from '@cuttle/motion-kit/files';
import { newId, usedIds } from '@cuttle/project';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
const isInside = (dir: string, path: string): boolean => {
  const rel = relative(dir, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** `cuttle music templates`: the music pages `music new` copies. */
export async function musicTemplatesCommand(output: Output): Promise<{ templates: readonly MusicTemplate[] }> {
  const result = { templates: MUSIC_TEMPLATES };
  output.result(result, () => MUSIC_TEMPLATES.map((template) => `${template.name.padEnd(12)} ${template.description}`).join('\n'));
  return result;
}

export interface MusicNewResult {
  template: string;
  /** The page, from the project folder. */
  src: string;
  music: Record<string, unknown>;
}

/**
 * `cuttle music new <template>`: copies a music template into `music/<name>/` and makes it the
 * project's music (its level and duck stay when the project had music before).
 */
export async function musicNewCommand(projectDir: string, template: string, args: { name?: string }, output: Output): Promise<MusicNewResult> {
  if (!MUSIC_TEMPLATES.some((candidate) => candidate.name === template)) {
    throw new CliError('usage', `no music template "${template}" (${MUSIC_TEMPLATES.map((candidate) => candidate.name).join(', ')})`);
  }
  const name = args.name ?? template;
  if (!NAME.test(name)) throw new CliError('usage', `--name "${name}" must be lower-case letters, digits and dashes`);
  const file = await readProjectFile(projectDir);
  let src: string;
  try {
    src = await copyTemplate(file.dir, `music-${template}`, name, import.meta.url, 'music');
  } catch (error) {
    if (error instanceof MissingTemplateError) throw new CliError('missing-file', `${error.message}: build the CLI again`);
    throw error;
  }
  const before = (file.raw.music as Record<string, unknown> | undefined) ?? {};
  const music: Record<string, unknown> = { ...before, src, params: {}, enabled: true };
  file.raw.music = music;
  await writeProjectFile(file, 'music new');
  const result: MusicNewResult = { template, src, music };
  output.result(result, () => `the music is ${src} now (${template}); hear it with "cuttle music check"`);
  return result;
}

export interface MusicSetArgs {
  volume?: number;
  duck?: number;
  /** `name=value` pairs for the page's params ("" removes one). */
  param?: string[];
  on?: boolean;
  off?: boolean;
  src?: string;
}

/** A param's value from the command line: a number, true or false, null, else the text. */
function paramValue(text: string): string | number | boolean | null {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (text.trim() !== '' && Number.isFinite(Number(text))) return Number(text);
  return text;
}

/** `cuttle music set`: the music's level, duck, params, page, or on and off. */
export async function musicSetCommand(projectDir: string, args: MusicSetArgs, output: Output): Promise<{ music: Record<string, unknown> }> {
  if (args.on && args.off) throw new CliError('usage', '--on and --off together');
  const file = await readProjectFile(projectDir);
  const music = { ...((file.raw.music as Record<string, unknown> | undefined) ?? {}) };
  if (args.src !== undefined) {
    const path = resolve(file.dir, args.src);
    if (!isInside(file.dir, path)) throw new CliError('usage', `${args.src} is not in the project folder`);
    if (!(await stat(path).then((info) => info.isFile(), () => false))) throw new CliError('missing-file', `no page at ${args.src}`);
    music.src = relative(file.dir, path).split(sep).join('/');
  }
  if (music.src === undefined) throw new CliError('invalid-project', 'the project has no music: add a page with "cuttle music new <template>" first');
  if (args.volume !== undefined) music.volume = args.volume;
  if (args.duck !== undefined) music.duck = args.duck;
  if (args.on) music.enabled = true;
  if (args.off) music.enabled = false;
  if (args.param?.length) {
    const params = { ...((music.params as Record<string, unknown> | undefined) ?? {}) };
    for (const pair of args.param) {
      const at = pair.indexOf('=');
      if (at <= 0) throw new CliError('usage', `--param ${pair}: write name=value`);
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === '') delete params[name];
      else params[name] = paramValue(value);
    }
    music.params = params;
  }
  file.raw.music = music;
  await writeProjectFile(file, 'music set');
  output.result({ music }, () => `music: ${JSON.stringify(music)}`);
  return { music };
}

/** What `cuttle music check` reports (see @cuttle/export's checkMusic). */
export interface MusicCheckReport {
  out: string;
  sheet?: string;
  seconds: number;
  src?: string;
  info: { bpm?: number; key?: string; sections?: unknown[] } | null;
  loudness: { lufs: number | null; truePeak: number | null };
  parts: { name: string; start: number; end: number; energy?: number; musicDb: number; effectsDb: number }[];
  cuts: { t: number; hit: boolean; riseDb: number }[];
  peaks: { music: number; effects: number };
  nodes: number;
  renderMs: number;
  skipped: string[];
  errors: string[];
  console: string[];
}

/**
 * `cuttle music check`: renders the music and sounds alone (no frames) into a WAV and a sheet, and
 * says what they came to: loudness, each part's level, the hits on the scene changes, the page's errors.
 */
export async function musicCheckCommand(projectDir: string, args: { src?: string; out?: string }, output: Output, signal: AbortSignal): Promise<MusicCheckReport> {
  const file = await readProjectFile(projectDir);
  let src: string | undefined;
  if (args.src !== undefined) {
    const path = resolve(file.dir, args.src);
    if (!isInside(file.dir, path)) throw new CliError('usage', `${args.src} is not in the project folder`);
    if (!(await stat(path).then((info) => info.isFile(), () => false))) throw new CliError('missing-file', `no page at ${args.src}`);
    src = relative(file.dir, path).split(sep).join('/');
  }
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview');
  output.info('rendering the music and sounds …');
  const result = await runInElectron<MusicCheckReport>(
    { command: 'music', projectDir: file.dir, out: join(outDir, 'music.wav'), sheet: join(outDir, 'music.png'), ...(src && { src }), quiet: output.json },
    signal,
  );
  output.result(result, () =>
    [
      `${result.src ?? 'the sounds'}: ${result.seconds.toFixed(1)} s${result.info?.bpm ? `, ${result.info.bpm} BPM` : ''}${result.info?.key ? `, ${result.info.key}` : ''}`,
      `loudness ${result.loudness.lufs ?? '?'} LUFS, true peak ${result.loudness.truePeak ?? '?'} dBFS (music and sounds alone)`,
      ...result.parts.map((part) => `  ${part.start.toFixed(1).padStart(6)}–${part.end.toFixed(1).padEnd(6)} ${part.name.padEnd(12)} ${part.energy !== undefined ? `energy ${part.energy}  ` : ''}music ${part.musicDb} dB, effects ${part.effectsDb} dB`),
      `scene changes: ${result.cuts.filter((cut) => cut.hit).length} of ${result.cuts.length} hit${result.cuts.some((cut) => !cut.hit) ? ` (none at ${result.cuts.filter((cut) => !cut.hit).map((cut) => `${cut.t.toFixed(2)} s`).join(', ')})` : ''}`,
      `wav    ${result.out}`,
      ...(result.sheet ? [`sheet  ${result.sheet}`] : []),
      ...(result.skipped.length > 0 ? [`skipped:\n${result.skipped.map((line) => `  ${line}`).join('\n')}`] : []),
      result.errors.length > 0 ? `errors:\n${result.errors.map((line) => `  ${line}`).join('\n')}` : 'no errors',
      ...(result.console.length > 0 ? [`console:\n${result.console.map((line) => `  ${line}`).join('\n')}`] : []),
    ].join('\n'),
  );
  return result;
}

/** `cuttle sound list`: the built-in sounds. */
export async function soundListCommand(output: Output): Promise<{ sounds: { name: string; description: string }[] }> {
  const sounds = BUILT_IN_SOUNDS.map(([name, description]) => ({ name, description }));
  output.result({ sounds }, () => sounds.map((sound) => `${sound.name.padEnd(15)} ${sound.description}`).join('\n'));
  return { sounds };
}

export interface SoundAddArgs {
  /** Source seconds, or seconds into `scene`. */
  at: number;
  scene?: string;
  volume?: number;
  label?: string;
}

/**
 * `cuttle sound add <sound> --at <seconds>`: a built-in sound or a file of the project at a moment of
 * the take (source seconds: it plays wherever the video shows that moment), or `--scene <id>` seconds
 * into a scene.
 */
export async function soundAddCommand(projectDir: string, sound: string, args: SoundAddArgs, output: Output): Promise<{ sound: Record<string, unknown> }> {
  const file = await readProjectFile(projectDir);
  let name = sound;
  if (!BUILT_IN_SOUNDS.some(([builtIn]) => builtIn === sound)) {
    const path = resolve(file.dir, sound);
    const isFile = isInside(file.dir, path) && (await stat(path).then((info) => info.isFile(), () => false));
    if (!isFile) throw new CliError('usage', `"${sound}" is neither a built-in sound (cuttle sound list) nor a file in the project`);
    if (!/\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(path)) throw new CliError('usage', `${sound}: a sound file is a WAV, MP3, M4A, OGG, FLAC or AAC`);
    name = relative(file.dir, path).split(sep).join('/');
  }
  if (args.scene !== undefined && !file.project.scenes.some((scene) => scene.id === args.scene)) {
    throw new CliError('usage', `--scene ${args.scene}: no scene has that id`);
  }
  const item: Record<string, unknown> = {
    id: newId('sounds', usedIds(file.project)),
    ...(args.label !== undefined && { label: args.label }),
    sound: name,
    at: args.at,
    ...(args.scene !== undefined && { scene: args.scene }),
    ...(args.volume !== undefined && { volume: args.volume }),
  };
  file.raw.sounds = [...((file.raw.sounds as unknown[] | undefined) ?? []), item];
  await writeProjectFile(file, 'sound add');
  output.result({ sound: item }, () => `added ${name} ${args.scene ? `${args.at} s into ${args.scene}` : `at source ${args.at} s`} (${String(item.id)})`);
  return { sound: item };
}
```

In `apps/cli/src/main.ts`, replace:

```ts
import { frameCommand } from './commands/frame';
import { init } from './commands/init';
import { motionCheckCommand, motionNewCommand, motionTemplatesCommand } from './commands/motion';
import { previewCommand } from './commands/preview';
import { recordCommand } from './commands/record';
import { recoverCommand } from './commands/recover';
```

with:

```ts
import { frameCommand } from './commands/frame';
import { init } from './commands/init';
import { motionCheckCommand, motionNewCommand, motionTemplatesCommand } from './commands/motion';
import { musicCheckCommand, musicNewCommand, musicSetCommand, musicTemplatesCommand, soundAddCommand, soundListCommand } from './commands/music';
import { previewCommand } from './commands/preview';
import { recordCommand } from './commands/record';
import { recoverCommand } from './commands/recover';
```

In the same file, replace:

```ts
  return parsed;
};
const collect = (value: string, previous: number[] = []): number[] => [...previous, seconds(value)];

/** `--json` before a `--`: usage errors then answer in JSON too. */
const wantsJson = (argv: readonly string[]): boolean => {
```

with:

```ts
  return parsed;
};
const collect = (value: string, previous: number[] = []): number[] => [...previous, seconds(value)];
const fraction = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new InvalidArgumentError('expected a number from 0 to 1');
  return parsed;
};
const decibels = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 40) throw new InvalidArgumentError('expected decibels from 0 to 40');
  return parsed;
};

/** `--json` before a `--`: usage errors then answer in JSON too. */
const wantsJson = (argv: readonly string[]): boolean => {
```

In the same file, replace:

```ts
      ),
    );

  program
    .command('capture-page <target>')
    .description('a web page (URL or file) as a PNG in stills/, optionally as a still scene')
```

with:

```ts
      ),
    );

  const music = program.command('music').description('the video\'s music: a page that composes it for this video in WebAudio, fitted to its scenes and cuts');
  music
    .command('new <template>')
    .description('copy a music template into music/<name>/ and make it the video\'s music (music templates lists them)')
    .option('--name <name>', 'the folder in music/ (default: the template\'s name)')
    .action(action((output, project, template: string, options: { name?: string }) => musicNewCommand(project, template, options, output)));
  music
    .command('templates')
    .description('the music templates music new copies')
    .action(action((output) => musicTemplatesCommand(output)));
  music
    .command('set')
    .description('the music\'s level, its duck under speech, its page\'s params, its page, or on and off')
    .option('--volume <0-1>', 'its level', (value: string) => fraction(value))
    .option('--duck <dB>', 'how far it goes down under speech (0: not at all)', (value: string) => decibels(value))
    .option('--param <name=value...>', 'a param of the page (name= removes it)', (value: string, previous: string[] = []) => [...previous, value])
    .option('--src <page>', 'another page in the project')
    .option('--on', 'play it')
    .option('--off', 'leave it out')
    .action(action((output, project, options: { volume?: number; duck?: number; param?: string[]; src?: string; on?: boolean; off?: boolean }) => musicSetCommand(project, options, output)));
  music
    .command('check')
    .description('render the music and sounds alone: a WAV, a sheet of the waveforms over the scenes, loudness, hits on the scene changes, errors')
    .option('--src <page>', 'check this page instead of the project\'s music')
    .option('-o, --out <dir>', 'folder for music.wav and music.png (default: preview/ in the project)')
    .action(action((output, project, options: { src?: string; out?: string }) => withSignal(output, (signal) => musicCheckCommand(project, options, output, signal))));

  const sound = program.command('sound').description('sounds at moments of the video: built-in effects or files of the project');
  sound
    .command('list')
    .description('the built-in sounds')
    .action(action((output) => soundListCommand(output)));
  sound
    .command('add <sound>')
    .description('a built-in sound or a file of the project at a moment: source seconds (where the video shows it), or --scene seconds into a scene')
    .requiredOption('--at <seconds>', 'source seconds, or seconds into --scene', seconds)
    .option('--scene <id>', 'a scene\'s id: --at counts from its start')
    .option('--volume <0-1>', 'its level (default 0.8)', (value: string) => fraction(value))
    .option('--label <text>', 'a name for it')
    .action(action((output, project, name: string, options: { at: number; scene?: string; volume?: number; label?: string }) => soundAddCommand(project, name, options, output)));

  program
    .command('capture-page <target>')
    .description('a web page (URL or file) as a PNG in stills/, optionally as a still scene')
```

The check runs in Electron:

In `apps/cli/src/electron/protocol.ts`, replace:

```ts
  | { command: 'render'; projectDir: string; out: string; format?: string; encoder?: string; captions?: boolean; subtitles?: string[] }
  | { command: 'preview'; projectDir: string; outDir: string; times: number[]; format?: string; sheet?: { columns?: number }; clean?: boolean; motion?: MotionCheck }
  | { command: 'capture-page'; target: string; out: string; width: number; height: number; fullPage: boolean; waitMs: number }
) & {
  /** No progress lines on stderr (--json). */
  quiet?: boolean;
```

with:

```ts
  | { command: 'render'; projectDir: string; out: string; format?: string; encoder?: string; captions?: boolean; subtitles?: string[] }
  | { command: 'preview'; projectDir: string; outDir: string; times: number[]; format?: string; sheet?: { columns?: number }; clean?: boolean; motion?: MotionCheck }
  | { command: 'capture-page'; target: string; out: string; width: number; height: number; fullPage: boolean; waitMs: number }
  | { command: 'music'; projectDir: string; out: string; sheet?: string; src?: string }
) & {
  /** No progress lines on stderr (--json). */
  quiet?: boolean;
```

In `apps/cli/src/electron/main.ts`, replace:

```ts
// channel, which carries the answer back and a cancel in; progress and warnings go to stderr.
// Loaded by bootstrap.ts, which handles uncaught exceptions.
import { app, protocol } from 'electron';
import { MOTION_SCHEME_PRIVILEGES, SUBTITLE_FORMATS, exportProject, isExportFormat, renderStills, type EncoderPreference, type ExportFormat, type SubtitleFormat } from '@cuttle/export';
import { capturePage } from './capture-page';
import { failure, finish } from './finish';
import { decodeRequest, type CancelMessage, type ElectronRequest, type ElectronResponse, type MotionCheck } from './protocol';
```

with:

```ts
// channel, which carries the answer back and a cancel in; progress and warnings go to stderr.
// Loaded by bootstrap.ts, which handles uncaught exceptions.
import { app, protocol } from 'electron';
import { MOTION_SCHEME_PRIVILEGES, SUBTITLE_FORMATS, checkMusic, exportProject, isExportFormat, renderStills, type EncoderPreference, type ExportFormat, type SubtitleFormat } from '@cuttle/export';
import { capturePage } from './capture-page';
import { failure, finish } from './finish';
import { decodeRequest, type CancelMessage, type ElectronRequest, type ElectronResponse, type MotionCheck } from './protocol';
```

In the same file, replace:

```ts
      });
    case 'capture-page':
      return capturePage(request, cancel.signal);
  }
}
```

with:

```ts
      });
    case 'capture-page':
      return capturePage(request, cancel.signal);
    case 'music':
      return checkMusic({ projectDir: request.projectDir, out: request.out, ...(request.sheet && { sheet: request.sheet }), ...(request.src && { src: request.src }) });
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node apps/cli`
Expected: PASS.

- [ ] **Step 4: The check end to end**

It composes music for a recorded take with a mic, checks it and renders it:

In `apps/cli/test/electron.check.test.ts`, replace:

```ts
    }
  }, 180_000);

  it('fails on an unknown format before rendering, and on a page that does not exist', () => {
    expect(cuttle('-C', project, 'render', '--format', '4:3').code).toBe(1);
    expect(cuttle('-C', project, 'capture-page', join(project, 'missing.html')).code).toBe(1);
```

with:

```ts
    }
  }, 180_000);

  it('composes music for the video and mixes it with its sounds under the mic', () => {
    const copy = join(mkdtempSync(join(tmpdir(), 'cuttle-music-')), 'take');
    cpSync(project, copy, { recursive: true });
    try {
      expect(cuttle('-C', copy, 'music', 'new', 'pulse').code).toBe(0);
      expect(cuttle('-C', copy, 'sound', 'add', 'pop', '--at', '1').code).toBe(0);
      const checked = cuttle('-C', copy, 'music', 'check');
      expect(checked.code).toBe(0);
      const report = checked.json as { seconds: number; errors: string[]; skipped: string[]; info: { bpm: number }; loudness: { lufs: number; truePeak: number }; out: string; sheet: string; parts: unknown[] };
      expect(report.errors).toEqual([]);
      expect(report.skipped).toEqual([]);
      expect(report.seconds).toBeGreaterThan(2);
      expect(report.info.bpm).toBeGreaterThanOrEqual(114);
      expect(report.parts.length).toBeGreaterThan(0);
      expect(report.loudness.lufs).toBeGreaterThan(-40);
      expect(report.loudness.truePeak).toBeLessThan(0);
      expect(pngSize(report.sheet)).toEqual([1600, 900]);
      expect(readFileSync(report.out).toString('ascii', 0, 4)).toBe('RIFF');
      const { code, json } = cuttle('-C', copy, 'render');
      expect(code).toBe(0);
      expect(json.music).toMatchObject({ src: 'music/pulse/index.html', errors: [], skipped: [] });
      const audio = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name,channels', '-of', 'csv=p=0', json.out as string], { encoding: 'utf8' }).stdout.trim();
      expect(audio).toBe('aac,2');
    } finally {
      rmSync(dirname(copy), { recursive: true, force: true });
    }
  }, 180_000);

  it('fails on an unknown format before rendering, and on a page that does not exist', () => {
    expect(cuttle('-C', project, 'render', '--format', '4:3').code).toBe(1);
    expect(cuttle('-C', project, 'capture-page', join(project, 'missing.html')).code).toBe(1);
```

Run: `pnpm cli:check`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/cli
git commit -m "cli: music new, templates, set and check; sound add and list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The guide

**Files:**
- Create: `skill/cuttle/music.md`
- Modify: `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`, `skill/test/skill.test.ts`

- [ ] **Step 1: The test knows the new commands and the new page**

In `skill/test/skill.test.ts`, replace:

```ts
const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const reference = readFileSync(join(SKILL_DIR, 'project.md'), 'utf8');
const motion = readFileSync(join(SKILL_DIR, 'motion.md'), 'utf8');
const docs = [skill, reference, motion];

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
```

with:

```ts
const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const reference = readFileSync(join(SKILL_DIR, 'project.md'), 'utf8');
const motion = readFileSync(join(SKILL_DIR, 'motion.md'), 'utf8');
const music = readFileSync(join(SKILL_DIR, 'music.md'), 'utf8');
const docs = [skill, reference, motion, music];

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
```

In the same file, replace:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'motion new', 'motion templates', 'init', 'render', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
```

with:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'motion new', 'motion templates', 'music new', 'music templates', 'music set', 'music check', 'sound add', 'sound list', 'init', 'render', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion', 'music', 'sound'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
```

In the same file, replace:

```ts
    const config = temp();
    expect(install(config).status).toBe(0);
    const target = join(config, 'skills', 'cuttle');
    expect(readdirSync(target).sort()).toEqual(['.cuttle-skill.json', 'SKILL.md', 'motion.md', 'project.md']);
    const installed = readFileSync(join(target, 'SKILL.md'), 'utf8');
    expect(installed).not.toContain('{{REPO}}');
    expect(installed).toContain(`(\`${REPO}\`)`);
```

with:

```ts
    const config = temp();
    expect(install(config).status).toBe(0);
    const target = join(config, 'skills', 'cuttle');
    expect(readdirSync(target).sort()).toEqual(['.cuttle-skill.json', 'SKILL.md', 'motion.md', 'music.md', 'project.md']);
    const installed = readFileSync(join(target, 'SKILL.md'), 'utf8');
    expect(installed).not.toContain('{{REPO}}');
    expect(installed).toContain(`(\`${REPO}\`)`);
```

Run: `pnpm exec vitest run --project node skill`
Expected: FAIL: `music.md` does not exist.

- [ ] **Step 2: How to compose for a video**

`skill/cuttle/music.md`:

````markdown
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
````

In `skill/cuttle/SKILL.md`, replace:

```markdown
---
name: cuttle
description: Records the screen and turns the take into a polished demo video with the cuttle CLI (cuts, speed-ups, zooms, masks over private data, a framed window on a designed background, captions, an end card; MP4 in 16:9, 1:1 or 9:16). Use when the user wants to record a demo, a screencast or screen recording, a launch or product video, a video of what Claude Code built, or to edit or re-render a cuttle project (cuttle.json).
---

# Cuttle: screen recordings that edit themselves
```

with:

```markdown
---
name: cuttle
description: Records the screen and turns the take into a polished demo video with the cuttle CLI (cuts, speed-ups, zooms, masks over private data, a framed window on a designed background, captions, motion graphics written in code, music composed for the video, an end card; MP4 in 16:9, 1:1 or 9:16). Use when the user wants to record a demo, a screencast or screen recording, a launch or product video, a video of what Claude Code built, or to edit or re-render a cuttle project (cuttle.json).
---

# Cuttle: screen recordings that edit themselves
```

In the same file, replace:

```markdown
  Read the sheet, fix every error, then look at it in the video with `preview --at`. A video made
  only of motion scenes (a promo, a reel) needs no recording: `cuttle init "<folder>"`, then the
  pages.
- **End card.** A `card` scene at the end with the product name and URL, or a `motion` scene.

## 4. Render
```

with:

```markdown
  Read the sheet, fix every error, then look at it in the video with `preview --at`. A video made
  only of motion scenes (a promo, a reel) needs no recording: `cuttle init "<folder>"`, then the
  pages.
- **Music.** Give the video music written for it: read [music.md](music.md), start from a template
  (`cuttle -C "<project>" --json music new pulse`; `music templates` lists the moods), then make the
  page this video's own (tempo, key, chords, instruments, how it builds over the scenes, hits on the
  cuts). Never ship a template unchanged: no two videos should sound alike. Check it with
  `cuttle -C "<project>" --json music check`: it renders the music alone into `preview/music.wav`
  and `preview/music.png` and reports each part's level, the hits on the scene changes, the
  loudness and the page's errors. Read the sheet, fix the errors, check again. It goes down under
  speech by itself; `music set --volume`, `--duck` and `--param` tune it. Ask the user before
  adding music to a video with a voice that should stand alone.
- **Sounds.** A sound at a moment, without the music: `cuttle -C "<project>" --json sound add whoosh --at 12.4`
  (source seconds) or `--scene s5 --at 0.2`; `sound list` has the built-in sounds.
- **End card.** A `card` scene at the end with the product name and URL, or a `motion` scene.

## 4. Render
```

In `skill/cuttle/project.md`, replace:

```markdown
## Times and pixels

- **Source seconds** are seconds of the take's screen track (`takes/<n>/screen.mp4`). Scenes cut
  and speed them up. `zooms`, `masks`, `texts` and motion `overlays` use source seconds too, so
  they stay on their content; they show only while a clip scene covers that source time. In a clip at speed `s`, `d`
  source seconds last `d / s` output seconds: a 3 s caption over a 12× clip is on screen for a
  quarter second, so give it `"duration": 36` there.
```

with:

```markdown
## Times and pixels

- **Source seconds** are seconds of the take's screen track (`takes/<n>/screen.mp4`). Scenes cut
  and speed them up. `zooms`, `masks`, `texts`, motion `overlays` and `sounds` use source seconds too, so
  they stay on their content; they show only while a clip scene covers that source time. In a clip at speed `s`, `d`
  source seconds last `d / s` output seconds: a 3 s caption over a 12× clip is on screen for a
  quarter second, so give it `"duration": 36` there.
```

In the same file, replace:

````markdown
  "zooms": [{ "id": "z1", "label": "Answer", "at": 121, "duration": 4, "rect": [0, 600, 1400, 788] }],
  "masks": [{ "from": 0, "to": 128, "rect": [2200, 0, 360, 40], "style": "fill" }],
  "texts": [{ "at": 2, "duration": 3, "text": "One prompt", "style": "pill", "position": "bottom" }],
  "overlays": [{ "id": "o1", "label": "Callout", "src": "motion/callout/index.html", "at": 121, "duration": 4 }]
}
```
````

with:

````markdown
  "zooms": [{ "id": "z1", "label": "Answer", "at": 121, "duration": 4, "rect": [0, 600, 1400, 788] }],
  "masks": [{ "from": 0, "to": 128, "rect": [2200, 0, 360, 40], "style": "fill" }],
  "texts": [{ "at": 2, "duration": 3, "text": "One prompt", "style": "pill", "position": "bottom" }],
  "overlays": [{ "id": "o1", "label": "Callout", "src": "motion/callout/index.html", "at": 121, "duration": 4 }],
  "music": { "src": "music/pulse/index.html", "params": { "key": "E" }, "volume": 0.7 },
  "sounds": [{ "id": "a1", "sound": "whoosh", "at": 120.3 }]
}
```
````

In the same file, replace:

```markdown
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`, `squircle`, `square`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5), `position` (`{ x, y }`: the bubble's centre as a share of the video, 0–1; it replaces `corner`), `border` (`true`: a white ring), `shadow` (`true`), `mirror` (`false`: flipped left to right) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one), `typing` (`true`: a key click for each key typed, where the clip is heard), `typingVolume` (`0.5`, 0 to 1) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

Two clips where the second starts where the first ends (within 1 ms), as `suggest`'s speed-ups and
```

with:

```markdown
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`, `squircle`, `square`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5), `position` (`{ x, y }`: the bubble's centre as a share of the video, 0–1; it replaces `corner`), `border` (`true`: a white ring), `shadow` (`true`), `mirror` (`false`: flipped left to right) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one), `typing` (`true`: a key click for each key typed, where the clip is heard), `typingVolume` (`0.5`, 0 to 1), `effects` (`true`: the `sounds` and the music page's effects), `effectsVolume` (`0.8`, 0 to 1) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

Two clips where the second starts where the first ends (within 1 ms), as `suggest`'s speed-ups and
```

In the same file, replace:

```markdown
(`clickZooms`, `answerZoom`, `crop`, `privacy`, `retakes`, `fillers`, `pauses`, `typingZooms`,
`dialogZooms`: all `true`) holds which kinds are made at all; one set to `false` is not made again.

## Motion pages

A motion scene or overlay is a web page in the project folder, usually `motion/<name>/index.html`
```

with:

```markdown
(`clickZooms`, `answerZoom`, `crop`, `privacy`, `retakes`, `fillers`, `pauses`, `typingZooms`,
`dialogZooms`: all `true`) holds which kinds are made at all; one set to `false` is not made again.

## Music and sounds

`music` is the video's music: a page that composes it in WebAudio for this video
(`music/<name>/index.html`; [music.md](music.md) is the guide). `src`, `params` (`{ "name": value }`
for the page), `volume` (`0.8`, 0 to 1), `duck` (`12`: dB it goes down under speech; 0 not at all),
`network` (`false`) and `enabled` (`true`). It is rendered as long as the video and follows every
edit. Without `music` the video has none.

`sounds` are single sounds at moments: `sound` (a built-in sound, `cuttle sound list`, or a file of
the project: WAV, MP3, M4A, OGG, FLAC), `at` (source seconds: it plays wherever the video shows that
moment, and not where it is cut), or `scene` (a scene's id) with `at` seconds into that scene,
`volume` (`0.8`), `enabled` (`true`), and an `id` (`a1`) and `label`.

## Motion pages

A motion scene or overlay is a web page in the project folder, usually `motion/<name>/index.html`
```

- [ ] **Step 3: Run the test**

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add skill
git commit -m "skill: the music guide: a score written for each video, the kit, the check, never the same twice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 829 passed and 67 skipped (where a speech model is found, its real transcription runs too: 830 and 66; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 12 tests.

Run: `pnpm app:check`
Expected: PASS, 49 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. In a project with a take, run `cuttle music new pulse` and `cuttle music check`, and listen to `preview/music.wav`: the music follows the scenes, with a hit on each scene change.
2. Render: the music is under the voice and goes down while someone speaks.
3. Ask Claude to give a video music of its own: it starts from a template, changes it for the video, checks it, and says what it made.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits.
- The music was checked by its numbers and sheets (it cannot be heard here): each of the five templates against the launch film's project (90 s, ten scenes): 8–13 s to render, -16 to -20 LUFS, true peak below -1 dBFS, no errors. The user got the launch film with two of them to listen to.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **Every node made up front made the render crawl** (the spike: 51 s for 90 s). The kit makes each note's nodes as the render reaches it; the hi-hat became band-passed noise with a ring instead of six oscillators, and notes stop sooner after their release. The pulse template went from 32 s to 10 s for 90 s.
- **The music was too loud and the energy too flat.** The kit's saturation made quiet signals five times louder, and a compressor makes up the gain it takes, so a lower master gain changed little: the level is set after the limiter now, the glue compressor is gentler, a pad is as loud with any number of voices, and the bass sits lower. The pulse template went from -10 LUFS and a true peak of +4.6 dBFS to -17.8 LUFS and -3.4 dBFS, with the intro quieter than the main parts.
- **`voiceLead` compared note names with numbers** (`'G2'` against MIDI), so no chord was ever voiced and every template played root positions. Found by its test.
- **A dynamic import in the runtime broke in the browser test:** the runtime runs as text in the page, and a bundler may rewrite `import()` in it. It loads the kit through `new Function('url', 'return import(url)')`, which no bundler touches (the pages' policy allows it).
- **A riser hid its own hit** in the check (the second before a cut was loud with the riser): the check compares with the second before, leaving out the riser's last 0.3 s.
- **A reel of motion scenes was all intro and outro,** and quiet: in a video without clips the scenes are its content now.
- **The music page's duck** dipped back up between two words 0.4 s apart: it stays down over a gap shorter than its attack and release.
- **The recorder's "stops while paused" test** failed in most full runs and then alone: a paused piece kept the half second the tracks took to stop (0.52–0.54 s against a tolerance of 0.5 s). That was a bug of its own, fixed before this milestone in #34: a pause ends the piece where it was asked for, and the screen's pieces are cut there when they are joined. This branch starts after it.

**Spec points that move**
- **Music.** The spec had built-in sounds and `cuttle.sound` cues. With the user's wish (2026-10-18) the video's music comes first: a page Claude writes per video, in WebAudio, with a sound kit and five templates, rendered by Cuttle and fitted to the video's cuts. The built-in sounds are part of the kit.
- **The milestones.** This is P5-M1e. What it leaves moves to **P5-M1f**: the music and sounds in the editor (heard while it plays and scrubs, the sounds on the mic lane, the music in the inspector), and `cuttle.sound` cues from motion pages. Then P5-M1d (frames of the take, transitions, device-3d and fold).
- **A sound in a scene.** A sound may be placed seconds into a scene (`scene`), not only at a source second: motion scenes have no source seconds.
- **The levels.** `music.volume` and `music.duck` (12 dB) for the music, `look.audio.effects` and `effectsVolume` for the sounds and the music page's effects; the sum is limited at about -1 dBFS.

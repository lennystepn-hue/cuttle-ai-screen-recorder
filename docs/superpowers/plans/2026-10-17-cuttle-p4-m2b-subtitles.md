# Cuttle P4-M2b: Subtitles, the Transcript Tab and a Clean Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** What was said shows and sounds right in the video:
- subtitles from the transcript in three styles, drawn by the engine, the same in the editor and the export;
- `.srt` and `.vtt` files;
- the editor's Transcript tab: go to a word, fix it, cut words out, bring them back, find;
- a cleaned-up mic (less noise, even loudness) that the preview and the export both play.

**Architecture:**
- **Format** (`@cuttle/project`):
  - `captions`: `enabled`, `style`, `position`, `size`, `color`, `fixes`;
  - `look.audio.cleanup` and `sources.cleanMic`;
  - the word helpers (`normWord`, the filler lexicon) move here from `@cuttle/core`, so the editor can use them.
- **Timeline** (`@cuttle/timeline`, `captions.ts`):
  - the transcript's words with the fixes, in output seconds;
  - cues of one or two lines;
  - the cue and spoken word of a frame (`RenderState.caption`);
  - SRT and VTT.
- **Engine:** a caption sprite per cue and spoken word, drawn over the whole frame.
- **Core:** `cleanMic` (highpass, `afftdn` with its delay taken out, `loudnorm`), made with the transcription and linked as `sources.cleanMic`.
- **Export:**
  - the transcript in the job;
  - `captions` to burn in or leave out per export;
  - `subtitles: ['srt', 'vtt']` written next to the video.
- **CLI:** `cuttle transcript [--srt | --vtt | --text]`, `render --no-captions --srt --vtt`.
- **Editor:**
  - the Transcript tab (Ctrl+F finds);
  - the Look tab's Subtitles section and Clean voice;
  - the subtitles over the mic's waveform;
  - the export sheet's subtitles.

**Tech Stack:** TypeScript strict, zod 4, vitest 5 (node and browser), Electron 44.7.2, React 19.3.0, Playwright (`_electron`), ffmpeg (`afftdn`, `loudnorm`).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase4-design.md`. Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p4-m2a-speech.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p4-m2b`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 10.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The prototype passed `pnpm test` (588 tests, 50 skipped), the typecheck, the engine goldens, `app:check` (40 tests), `cli:check` (5) and `export:check`. Every screenshot and every new golden was looked at.

- **Names.** The format says `captions`, as the spec does. The editor already calls text overlays "Captions" (the T tool), so it calls these **Subtitles**.
- **The format:**
  - `captions` is on by default: a transcribed take gets subtitles, and one without a transcript has none. The default look is `subtitle` at the bottom, `size` 1, `color` `#D97757`.
  - `fixes: [{ at, end, text }]` are source seconds. The words starting in `[at, end)` read as `text`, as one word from `at` to `end`; `""` takes them out. A new fix takes the place of the fixes it overlaps.
  - `look.audio.cleanup` (on) plays `sources.cleanMic` instead of the mic where there is one.
- **Cues** (`captionCues`):
  - The words come in output seconds. A word is captioned only where a clip shows its start at 1×: words in cuts and in sped-up clips have none. Its end stays inside its clip's piece.
  - A new cue starts after a pause of 0.6 s, after a sentence's end, or when the words no longer fit two lines of 42 characters. `bold` shows at most 3 words or 18 characters at a time.
  - A cue shows from its first word to 0.6 s after its last, at least 0.8 s, never past the next cue. Two lines are balanced, and each stays within 42 characters where it can.
  - The spoken word is the last one that has started.
  - The timeline keeps the cues even while the subtitles are off (`Timeline.cues`: the editor's lane, the subtitle files). `frameAt` gives `caption` only while they are on; an export can override that.
  - SRT and VTT are written with the `subtitle` cues, whatever style the video burns in.
- **The engine:**
  - `subtitle` and `karaoke` draw two lines on a dark box (38 units); `karaoke` lights the spoken word in `color`.
  - `bold` draws a few upper-case words, outlined (74 units).
  - The font shrinks when a line would pass 86 % (bold: 90 %) of the output's width.
  - Subtitles are placed like text overlays, clear of the webcam bubble, after every layer: also over a crossfade.
  - A sprite is drawn per cue and spoken word, and kept by the sprite cache.
- **The export:**
  - The job carries the transcript's words. `captions` burns them in or leaves them out for one export.
  - `subtitles` writes `<name>.srt` and `<name>.vtt` next to the video. Without a transcript that is an error before rendering.
  - The transcript and the cleaned-up mic are project files: no output may replace them.
  - A transcript that cannot be read is a warning, and the video has no subtitles.
- **The clean voice:**
  - The chain is `aresample=48000, highpass=f=80, afftdn=nr=12:nf=-50:tn=1`, the noise filter's delay trimmed off the start and padded at the end, then `loudnorm=I=-16:TP=-1.5:LRA=11`, as AAC, as long as the mic.
  - `afftdn` holds back 1200 samples (25 ms) at 48 kHz, whatever the input's rate. The delay is measured once per process with a click, because another ffmpeg may differ.
  - `anlmdn` crashes this ffmpeg build (9.0), so it is not used.
  - `loudnorm` adds about 90 ms at the end, so the output is cut to the mic's length.
  - On the English fixture the cleaned voice is about 5 dB louder, in step with the mic to 10 ms, and has the same speech stretches.
  - `transcribeTake` writes it next to the transcript (`cleanup`, on by default) and links it with the transcript. The app's speech step links both with the cuts, in one write.
- **The editor:**
  - **The Transcript tab:**
    - the words in paragraphs (a pause of 1.2 s, or a sentence's end and 0.6 s), each with its time;
    - the spoken word lit, and kept in view while playing;
    - a click goes to a word; Shift+click selects up to it;
    - a double click (or Enter) fixes its text;
    - Delete makes one hand cut over the selected words, padded 50 ms up to the words around them;
    - Restore takes away the hand cuts over them, and switches automatic ones off;
    - filler words are faint, words in a sped-up clip italic, cut words struck through, words outside every clip struck through and dim;
    - a fixed word is underlined, and Undo fix takes the fix away;
    - Ctrl+F (from anywhere) finds a word; Enter goes to the next match after the selected word, Shift+Enter back.
  - **The Look tab** gets a Subtitles section (on, style, position, size, the spoken word's colour) and Clean voice under Sound.
  - **The timeline** shows the cues as strips over the mic's waveform (faint while subtitles are off); a click goes there.
  - **The export sheet** shows, for a transcribed take, "Subtitles: In the video / Not in the video" and `.srt` and `.vtt` chips.
  - When the speech step links the transcript, the editor's note of the change says "the take was transcribed", not "another take".

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/schema.ts`, `words.ts` (new), `index.ts` | `captions`, `cleanMic`, `audio.cleanup`; the word helpers |
| `packages/timeline/src/captions.ts` (new), `frame.ts`, `index.ts` | words in output time, cues, the frame's caption, SRT and VTT |
| `packages/engine/src/captions.ts` (new), `sprites.ts`, `renderer.ts` | the three styles |
| `packages/core/src/speech/cleanup.ts` (new), `transcribe.ts`, `apply.ts`, `whisper.ts`, `align.ts`, `edits.ts`, `use-take.ts`, `recover.ts`, `index.ts` | the clean voice; the word helpers from the project |
| `packages/export/src/{job,index}.ts`, `src/page/run.ts`, `src/main/{export,sources,stills}.ts` | subtitles in the video and beside it |
| `apps/cli/src/commands/transcript.ts` (new), `render.ts`, `main.ts`, `electron/{main,protocol}.ts` | the commands |
| `apps/desktop/src/renderer/editor/Transcript.tsx` (new), `Inspector.tsx`, `Timeline.tsx`, `ExportSheet.tsx`, `App.tsx`, `media.ts`, `player.ts`, `session.ts`, `editor.css` | the editor |
| `apps/desktop/src/shared/{document,ipc,names,take,media-jobs}.ts`, `src/main/{export-service,windows,speech}.ts`, `src/workers/media.ts` | commands, the contract, the export and the speech step |
| `skill/cuttle/{SKILL,project}.md` | subtitles and the clean voice for Claude |

---

### Task 1: The format

**Files:**
- Create: `packages/project/src/words.ts`
- Modify: `packages/project/src/{schema,index}.ts`, `packages/project/test/schema.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p4-m2b`; work there:

```bash
git switch p4-m2b
```

- [ ] **Step 2: Write the failing tests**

In `packages/project/test/schema.test.ts`, replace:

```ts
    expect(p.look.frame).toEqual({ enabled: true, style: 'mac-dark', title: '', radius: 14, shadow: true });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'system', size: 1, color: '#D97757', clickEffect: 'ripple', smoothing: 0.5 });
    expect(p.look.webcam).toEqual({ enabled: false, shape: 'circle', corner: 'bottom-left', size: 0.18 });
    expect(p.look.audio).toEqual({ enabled: true, muteSpedUp: true });
    expect(p.look.transition).toEqual({ enabled: true, duration: 0.3 });
    expect(p.scenes).toEqual([]);
    expect(p.zooms).toEqual([]);
```

with:

```ts
    expect(p.look.frame).toEqual({ enabled: true, style: 'mac-dark', title: '', radius: 14, shadow: true });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'system', size: 1, color: '#D97757', clickEffect: 'ripple', smoothing: 0.5 });
    expect(p.look.webcam).toEqual({ enabled: false, shape: 'circle', corner: 'bottom-left', size: 0.18 });
    expect(p.look.audio).toEqual({ enabled: true, muteSpedUp: true, cleanup: true });
    expect(p.look.transition).toEqual({ enabled: true, duration: 0.3 });
    expect(p.scenes).toEqual([]);
    expect(p.zooms).toEqual([]);
```

In the same file, replace:

```ts
    expect(pathsOf({ ...minimal, zooms: [{ id: 'c1', at: 1, duration: 2, rect: [0, 0, 10, 10] }], cuts: [{ id: 'c1', from: 1, to: 2 }] })).toEqual(['cuts.0.id']);
  });
});
```

with:

```ts
    expect(pathsOf({ ...minimal, zooms: [{ id: 'c1', at: 1, duration: 2, rect: [0, 0, 10, 10] }], cuts: [{ id: 'c1', from: 1, to: 2 }] })).toEqual(['cuts.0.id']);
  });
});

describe('captions', () => {
  it('are on, as subtitles at the bottom, by default', () => {
    expect(ProjectSchema.parse(minimal).captions).toEqual({ enabled: true, style: 'subtitle', position: 'bottom', size: 1, color: '#D97757', fixes: [] });
  });

  it('read a style, a size and fixes of the transcript', () => {
    const p = ProjectSchema.parse({ ...minimal, captions: { style: 'karaoke', size: 1.4, fixes: [{ at: 3.12, end: 3.58, text: 'Holofish' }, { at: 5, end: 5.2, text: '' }] } });
    expect(p.captions).toMatchObject({ enabled: true, style: 'karaoke', size: 1.4, fixes: [{ at: 3.12, end: 3.58, text: 'Holofish' }, { at: 5, end: 5.2, text: '' }] });
  });

  it('refuse an unknown style, a size out of range and a fix that ends before it starts', () => {
    expect(pathsOf({ ...minimal, captions: { style: 'marquee' } })).toEqual(['captions.style']);
    expect(pathsOf({ ...minimal, captions: { size: 3 } })).toEqual(['captions.size']);
    expect(pathsOf({ ...minimal, captions: { fixes: [{ at: 2, end: 1, text: 'x' }] } })).toEqual(['captions.fixes.0.end']);
  });
});
```

Run: `pnpm exec vitest run --project node packages/project/test/schema.test.ts`
Expected: FAIL: `captions` is an unknown field, and `audio` has no `cleanup`.

- [ ] **Step 3: The schema and the word helpers**

In `packages/project/src/schema.ts`, replace:

```ts
export const EASES = ['smooth', 'linear'] as const;
export const MASK_STYLES = ['fill', 'blur'] as const;
export const TEXT_POSITIONS = ['top', 'center', 'bottom'] as const;
export const STILL_MOTIONS = ['none', 'kenburns', 'scroll'] as const;
export const WEBCAM_SHAPES = ['circle', 'rounded'] as const;
export const WEBCAM_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
```

with:

```ts
export const EASES = ['smooth', 'linear'] as const;
export const MASK_STYLES = ['fill', 'blur'] as const;
export const TEXT_POSITIONS = ['top', 'center', 'bottom'] as const;
/** How captions look: classic subtitles on a dark box, the spoken word in colour, or a few big words at a time. */
export const CAPTION_STYLES = ['subtitle', 'karaoke', 'bold'] as const;
export const STILL_MOTIONS = ['none', 'kenburns', 'scroll'] as const;
export const WEBCAM_SHAPES = ['circle', 'rounded'] as const;
export const WEBCAM_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
```

In the same file, replace:

```ts
  markers: z.string().min(1).optional(),
  /** What the mic said, word by word (`cuttle transcribe`, the app after a take). */
  transcript: z.string().min(1).optional(),
});

// Cross-field checks live on the object they belong to, so zod reports them in the same pass
```

with:

```ts
  markers: z.string().min(1).optional(),
  /** What the mic said, word by word (`cuttle transcribe`, the app after a take). */
  transcript: z.string().min(1).optional(),
  /** The mic cleaned up (made with the transcription): less noise, even loudness, in step with the mic. */
  cleanMic: z.string().min(1).optional(),
});

// Cross-field checks live on the object they belong to, so zod reports them in the same pass
```

In the same file, replace:

```ts
const AudioSchema = z.strictObject({
  enabled: z.boolean().default(true),
  muteSpedUp: z.boolean().default(true),
});

const TransitionSchema = z.strictObject({
```

with:

```ts
const AudioSchema = z.strictObject({
  enabled: z.boolean().default(true),
  muteSpedUp: z.boolean().default(true),
  /** Play the cleaned-up mic (`sources.cleanMic`: less noise, even loudness) where there is one. */
  cleanup: z.boolean().default(true),
});

const TransitionSchema = z.strictObject({
```

In the same file, replace:

```ts
  })
  .refine((mask) => mask.to > mask.from, { message: '"to" must be greater than "from"', path: ['to'] });

/** A source range taken out of every clip that covers it: a jump cut, no crossfade. */
const CutSchema = z
  .strictObject({
```

with:

```ts
  })
  .refine((mask) => mask.to > mask.from, { message: '"to" must be greater than "from"', path: ['to'] });

/** A fix the person made to the transcript: the words spoken in [at, end) (source seconds) read as `text` ("" for none). */
const CaptionFixSchema = z
  .strictObject({ at: seconds, end: seconds, text: z.string().max(200) })
  .refine((fix) => fix.end > fix.at, { message: '"end" must be greater than "at"', path: ['end'] });

/** Captions from the take's transcript (`sources.transcript`); none without one. */
const CaptionsSchema = z.strictObject({
  enabled: z.boolean().default(true),
  style: z.enum(CAPTION_STYLES).default('subtitle'),
  position: z.enum(TEXT_POSITIONS).default('bottom'),
  /** Scale of the style's text size. */
  size: z.number().min(0.5).max(2).default(1),
  /** The spoken word's colour (`karaoke`, `bold`). */
  color: hexColor.default('#D97757'),
  fixes: z.array(CaptionFixSchema).default([]),
});

/** A source range taken out of every clip that covers it: a jump cut, no crossfade. */
const CutSchema = z
  .strictObject({
```

In the same file, replace:

```ts
    texts: z.array(TextSchema).default([]),
    cuts: z.array(CutSchema).default([]),
    autoEdits: AutoEditsSchema.prefault({}),
  })
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
```

with:

```ts
    texts: z.array(TextSchema).default([]),
    cuts: z.array(CutSchema).default([]),
    autoEdits: AutoEditsSchema.prefault({}),
    captions: CaptionsSchema.prefault({}),
  })
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
```

In the same file, replace:

```ts
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];
export type FrameStyle = (typeof FRAME_STYLES)[number];
export type TextStyle = (typeof TEXT_STYLES)[number];
export type CuttleProject = z.output<typeof ProjectSchema>;
export type CuttleProjectInput = z.input<typeof ProjectSchema>;
export type Look = CuttleProject['look'];
```

with:

```ts
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];
export type FrameStyle = (typeof FRAME_STYLES)[number];
export type TextStyle = (typeof TEXT_STYLES)[number];
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
export type CuttleProject = z.output<typeof ProjectSchema>;
export type CuttleProjectInput = z.input<typeof ProjectSchema>;
export type Look = CuttleProject['look'];
```

In the same file, replace:

```ts
export type Cut = CuttleProject['cuts'][number];
export type AutoKind = (typeof AUTO_KINDS)[number];
export type AutoEdits = CuttleProject['autoEdits'];
```

with:

```ts
export type Cut = CuttleProject['cuts'][number];
export type AutoKind = (typeof AUTO_KINDS)[number];
export type AutoEdits = CuttleProject['autoEdits'];
export type Captions = CuttleProject['captions'];
export type CaptionFix = Captions['fixes'][number];
```

`packages/project/src/words.ts`:

```ts
// What Cuttle knows about spoken words, shared by the speech edits (@cuttle/core) and the editor's
// Transcript tab: how words compare, and which are fillers.

/** Letters and digits only, lower case: how words are compared. */
export const normWord = (text: string) => text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '');

/** Fillers in German, in English, and those safe whatever the language ("um" and "er" are German words). */
const FILLERS: Record<'de' | 'en' | 'auto', ReadonlySet<string>> = {
  de: new Set(['äh', 'ähm', 'öh', 'öhm', 'ehm', 'hm', 'hmm', 'mhm', 'ähh', 'ähmm']),
  en: new Set(['uh', 'uhm', 'um', 'umm', 'er', 'erm', 'hm', 'hmm', 'mhm', 'ehm']),
  auto: new Set(['äh', 'ähm', 'öh', 'öhm', 'ehm', 'hm', 'hmm', 'mhm', 'uh', 'uhm', 'erm']),
};

/** How whisper writes fillers it misheard (the spike: "Äh" as "E.", "Ähm" as "M."); fillers only alone between pauses. */
export const SHORT_SPELLINGS: ReadonlySet<string> = new Set(['e', 'eh', 'ee', 'm', 'mm', 'hm', 'ä', 'äh', 'ah', 'uh']);

/** The filler words of a language (`de`, `en`, else those safe in both). */
export const fillerLexicon = (language: string): ReadonlySet<string> => FILLERS[language === 'de' || language === 'en' ? language : 'auto'];

/** Whether a word is likely a filler: in the language's lexicon, or one of whisper's short spellings of one. */
export const likelyFiller = (text: string, language: string): boolean => {
  const word = normWord(text);
  return fillerLexicon(language).has(word) || SHORT_SPELLINGS.has(word);
};
```

In `packages/project/src/index.ts`, replace:

```ts
export {
  AUTO_KINDS,
  BACKGROUND_PRESETS,
  CLICK_EFFECTS,
  CURRENT_VERSION,
  CURSOR_SHAPES,
```

with:

```ts
export {
  AUTO_KINDS,
  BACKGROUND_PRESETS,
  CAPTION_STYLES,
  CLICK_EFFECTS,
  CURRENT_VERSION,
  CURSOR_SHAPES,
```

In the same file, replace:

```ts
  type AutoEdits,
  type AutoKind,
  type BackgroundPreset,
  type CardScene,
  type ClipScene,
  type CursorShape,
```

with:

```ts
  type AutoEdits,
  type AutoKind,
  type BackgroundPreset,
  type CaptionFix,
  type Captions,
  type CaptionStyle,
  type CardScene,
  type ClipScene,
  type CursorShape,
```

In the same file, replace:

```ts
  type TranscriptWord,
} from './transcript';
export { ID_PREFIXES, newId, usedIds, type IdList } from './ids';
export { parseEventsJsonl } from './events';
export { SEGMENTS_VERSION, SegmentsFileSchema, parseSegmentsJson, segmentOffsets, takeTime, type Segment, type SegmentsFile, type SegmentsFileParseResult } from './segments';
export { TAKE_VERSION, TakeFileSchema, parseTakeJson, trackOffset, type TakeFile, type TakeFileParseResult, type TakeFileTrack } from './take';
```

with:

```ts
  type TranscriptWord,
} from './transcript';
export { ID_PREFIXES, newId, usedIds, type IdList } from './ids';
export { SHORT_SPELLINGS, fillerLexicon, likelyFiller, normWord } from './words';
export { parseEventsJsonl } from './events';
export { SEGMENTS_VERSION, SegmentsFileSchema, parseSegmentsJson, segmentOffsets, takeTime, type Segment, type SegmentsFile, type SegmentsFileParseResult } from './segments';
export { TAKE_VERSION, TakeFileSchema, parseTakeJson, trackOffset, type TakeFile, type TakeFileParseResult, type TakeFileTrack } from './take';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/project`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project
git commit -m "project: captions (style, position, size, colour, fixes), the clean voice, and the word helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Subtitles in the timeline

**Files:**
- Create: `packages/timeline/src/captions.ts`, `packages/timeline/test/captions.test.ts`
- Modify: `packages/timeline/src/{frame,index}.ts`

- [ ] **Step 1: Write the failing test**

`packages/timeline/test/captions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import { applyCaptionFixes, captionAt, captionCues, captionWords, toSrt, toVtt, type CaptionWord, type SpokenWord } from '../src/captions';
import { createTimeline } from '../src/frame';
import { sceneSpans } from '../src/time';

const SCREEN = { width: 1280, height: 720 };
const said = (...items: [number, number, string][]): SpokenWord[] => items.map(([t, end, text]) => ({ t, end, text }));
const project = (rest: Partial<CuttleProjectInput> = {}) => {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4', transcript: 't.json' }, scenes: [{ type: 'clip', from: 0, to: 30 }], ...rest });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
};

describe('the caption words', () => {
  it('apply the fixes: the words in a fix read as its text, an empty fix takes them out', () => {
    const words = said([1, 1.4, 'Holo'], [1.4, 1.8, 'fisch'], [2, 2.3, 'ist'], [2.4, 2.6, 'äh'], [2.8, 3.2, 'toll']);
    expect(applyCaptionFixes(words, [{ at: 1, end: 1.8, text: 'Holofish' }, { at: 2.4, end: 2.6, text: '' }])).toEqual(said([1, 1.8, 'Holofish'], [2, 2.3, 'ist'], [2.8, 3.2, 'toll']));
  });

  it('are in output seconds: none in a cut or a sped-up clip, the end kept inside its piece', () => {
    const p = project({
      scenes: [
        { type: 'card', title: 'Hi', duration: 2 },
        { type: 'clip', from: 0, to: 10 },
        { type: 'clip', from: 10, to: 40, speed: 6 },
      ],
      cuts: [{ from: 3, to: 4 }],
    });
    const words = captionWords(said([1, 1.5, 'eins'], [3.2, 3.6, 'weg'], [4.5, 5, 'zwei'], [9.8, 10.4, 'drei'], [20, 20.5, 'schnell']), sceneSpans(p.scenes, p.cuts));
    expect(words).toEqual([
      { t: 3, end: 3.5, text: 'eins' },
      { t: 5.5, end: 6, text: 'zwei' },
      { t: 10.8, end: 11, text: 'drei' },
    ]);
  });
});

const w = (t: number, end: number, text: string): CaptionWord => ({ t, end, text });

describe('the cues', () => {
  const words = [w(0, 0.3, 'Das'), w(0.3, 0.5, 'ist'), w(0.5, 1.1, 'Cuttle.'), w(1.2, 1.4, 'Es'), w(1.4, 1.9, 'schneidet'), w(3, 3.4, 'Pausen'), w(3.4, 3.6, 'raus')];

  it('break after a sentence and at a pause, and show until shortly after the last word', () => {
    const cues = captionCues(words, 'subtitle');
    expect(cues.map((cue) => [cue.start, cue.end, cue.lines.map((line) => line.map((word) => word.text).join(' '))])).toEqual([
      [0, 1.2, ['Das ist Cuttle.']],
      [1.2, 2.5, ['Es schneidet']],
      [3, 4.2, ['Pausen raus']],
    ]);
  });

  it('wrap a long cue onto two balanced lines, and start a new one past two lines', () => {
    const long = 'Cuttle nimmt den Bildschirm auf und schneidet das Video dann ganz von selbst für dich zurecht damit es passt und gut aussieht'.split(' ').map((text, i) => w(i * 0.3, i * 0.3 + 0.25, text));
    const cues = captionCues(long, 'subtitle');
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) expect(line.map((word) => word.text).join(' ').length).toBeLessThanOrEqual(42);
    }
    const [a, b] = cues[0]!.lines.map((line) => line.map((word) => word.text).join(' ').length);
    expect(Math.abs(a! - b!)).toBeLessThan(12);
  });

  it('show a few words at a time in the bold style', () => {
    const cues = captionCues(words, 'bold');
    expect(cues.map((cue) => cue.lines[0]!.map((word) => word.text).join(' '))).toEqual(['Das ist Cuttle.', 'Es schneidet', 'Pausen raus']);
    const many = captionCues('eins zwei drei vier fünf sechs'.split(' ').map((text, i) => w(i * 0.3, i * 0.3 + 0.25, text)), 'bold');
    expect(many.map((cue) => cue.lines[0]!.length)).toEqual([3, 3]);
  });

  it('know the cue and the word spoken at a time', () => {
    const cues = captionCues(words, 'karaoke');
    expect(captionAt(cues, 0.4)).toEqual({ cue: cues[0], current: 1 });
    expect(captionAt(cues, 1.15)?.current).toBe(2);
    expect(captionAt(cues, 2.6)).toBeUndefined();
    expect(captionAt(cues, 3.5)?.cue).toBe(cues[2]);
  });

  it('write SubRip and WebVTT', () => {
    const cues = captionCues(words, 'subtitle');
    expect(toSrt(cues.slice(0, 2))).toBe('1\n00:00:00,000 --> 00:00:01,200\nDas ist Cuttle.\n\n2\n00:00:01,200 --> 00:00:02,500\nEs schneidet\n');
    expect(toVtt(cues.slice(2))).toBe('WEBVTT\n\n00:00:03.000 --> 00:00:04.200\nPausen raus\n');
  });
});

describe('captions in the timeline', () => {
  const transcript = said([1, 1.3, 'Hallo'], [1.3, 1.8, 'zusammen.'], [3, 3.5, 'Los']);

  it('come with the frames while they are on, and stay in the cues while they are off', () => {
    const on = createTimeline(project(), { screenSize: SCREEN, transcript });
    expect(on.cues).toHaveLength(2);
    expect(on.frameAt(1.5).caption).toEqual({ cue: on.cues[0], current: 1 });
    expect(on.frameAt(0.5).caption).toBeUndefined();
    const off = createTimeline(project({ captions: { enabled: false } }), { screenSize: SCREEN, transcript });
    expect(off.cues).toHaveLength(2);
    expect(off.frameAt(1.5).caption).toBeUndefined();
    expect(createTimeline(project(), { screenSize: SCREEN, transcript, captions: false }).frameAt(1.5).caption).toBeUndefined();
    expect(createTimeline(project(), { screenSize: SCREEN }).cues).toEqual([]);
  });
});
```

Run: `pnpm exec vitest run --project node packages/timeline/test/captions.test.ts`
Expected: FAIL: `../src/captions` does not exist.

- [ ] **Step 2: The cues**

`packages/timeline/src/captions.ts`:

```ts
// Captions from the take's transcript: its words in output seconds (only where a clip shows them at
// 1×), the person's fixes applied, grouped into cues of one or two lines that the video shows one at
// a time. Pure: the engine draws the cue of a frame, the export writes them as SRT and VTT.
import type { CaptionFix, CaptionStyle } from '@cuttle/project';
import type { SceneSpan } from './time';

/** A word in source seconds, as transcript.json has it. */
export interface SpokenWord {
  t: number;
  end: number;
  text: string;
}

/** A word as the captions show it, in output seconds. */
export interface CaptionWord {
  t: number;
  end: number;
  text: string;
}

/** What the video shows from `start` to `end` (output seconds): one or two lines of words. */
export interface CaptionCue {
  start: number;
  end: number;
  lines: CaptionWord[][];
}

/** The cue of a frame, and the word being spoken in it (its index, counted over the lines). */
export interface ActiveCaption {
  cue: CaptionCue;
  current?: number;
}

export const CAPTION_RULES = {
  /** A gap this long (output seconds) between words starts a new cue. */
  pause: 0.6,
  /** Most characters on a line of `subtitle` and `karaoke` (two lines a cue). */
  lineChars: 42,
  /** `bold` shows at most this many words, and characters, at a time. */
  boldWords: 3,
  boldChars: 18,
  /** A cue stays this long after its last word ends, unless the next one starts. */
  hold: 0.6,
  /** A cue shows at least this long, unless the next one starts. */
  minSeconds: 0.8,
};

/**
 * The words with the person's fixes: the words spoken in a fix's [at, end) read as its text, one
 * word from `at` to `end`; a fix with no text takes them out.
 */
export function applyCaptionFixes(words: readonly SpokenWord[], fixes: readonly CaptionFix[]): SpokenWord[] {
  if (fixes.length === 0) return words.map((word) => ({ ...word }));
  const fixed = words.filter((word) => !fixes.some((fix) => word.t >= fix.at && word.t < fix.end)).map((word) => ({ ...word }));
  for (const fix of fixes) if (fix.text.trim() !== '') fixed.push({ t: fix.at, end: fix.end, text: fix.text.trim() });
  return fixed.sort((a, b) => a.t - b.t);
}

/**
 * The words in output seconds: each word whose start a clip shows at 1× (a sped-up clip's speech is
 * not captioned), once per time it is shown, its end kept inside its clip's piece.
 */
export function captionWords(words: readonly SpokenWord[], spans: readonly SceneSpan[]): CaptionWord[] {
  const shown: CaptionWord[] = [];
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'clip' || scene.speed !== 1) continue;
    for (const word of words) {
      if (word.t < scene.from || word.t >= scene.to) continue;
      const t = span.start + (word.t - scene.from);
      const end = span.start + (Math.min(word.end, scene.to) - scene.from);
      shown.push({ t: round(t), end: round(Math.max(t, Math.min(end, span.end))), text: word.text });
    }
  }
  return shown.sort((a, b) => a.t - b.t);
}

const round = (seconds: number) => Math.round(seconds * 1e6) / 1e6;
const chars = (words: readonly CaptionWord[]) => words.reduce((sum, word) => sum + word.text.length, 0) + Math.max(0, words.length - 1);
const endsSentence = (text: string) => /[.!?…]["'’”)\]]*$/.test(text);

/** Whether the words fit on two lines of at most `max` characters. */
function fitsTwoLines(words: readonly CaptionWord[], max: number): boolean {
  for (let k = 0; k <= words.length; k++) if (chars(words.slice(0, k)) <= max && chars(words.slice(k)) <= max) return true;
  return false;
}

/** Two lines of about the same length, each at most `max` characters where they can be. */
function balance(words: CaptionWord[], max: number): CaptionWord[][] {
  if (chars(words) <= max || words.length < 2) return [words];
  let best = 1;
  let bestLonger = Infinity;
  for (let k = 1; k < words.length; k++) {
    const first = chars(words.slice(0, k));
    const second = chars(words.slice(k));
    // splits that keep both lines short come first; among them, the most even
    const longer = Math.max(first, second) + (first > max || second > max ? 1000 : 0);
    if (longer < bestLonger) {
      bestLonger = longer;
      best = k;
    }
  }
  return [words.slice(0, best), words.slice(best)];
}

/**
 * The cues of `words` (output seconds, in order) for a style: a new cue at a pause, after a
 * sentence's end, or when the words would not fit (`subtitle` and `karaoke`: two lines; `bold`: a
 * few short words). A cue shows from its first word to `hold` after its last, or the next cue.
 */
export function captionCues(words: readonly CaptionWord[], style: CaptionStyle, rules = CAPTION_RULES): CaptionCue[] {
  const groups: CaptionWord[][] = [];
  let group: CaptionWord[] = [];
  const full = (next: CaptionWord) =>
    style === 'bold' ? group.length >= rules.boldWords || chars([...group, next]) > rules.boldChars : !fitsTwoLines([...group, next], rules.lineChars);
  for (const word of words) {
    const last = group.at(-1);
    if (last && (word.t - last.end >= rules.pause || endsSentence(last.text) || full(word))) {
      groups.push(group);
      group = [];
    }
    group.push(word);
  }
  if (group.length > 0) groups.push(group);
  return groups.map((cue, i) => {
    const start = cue[0]!.t;
    const next = groups[i + 1]?.[0]!.t ?? Infinity;
    const end = Math.min(next, Math.max(cue.at(-1)!.end + rules.hold, start + rules.minSeconds));
    return { start, end: round(end), lines: style === 'bold' ? [cue] : balance(cue, rules.lineChars) };
  });
}

/** The cue shown at `t` (output seconds), and the word spoken there: the last one that started. */
export function captionAt(cues: readonly CaptionCue[], t: number): ActiveCaption | undefined {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = cues[mid]!;
    if (t < cue.start) hi = mid - 1;
    else if (t >= cue.end) lo = mid + 1;
    else {
      const words = cue.lines.flat();
      let current: number | undefined;
      words.forEach((word, index) => {
        if (word.t <= t) current = index;
      });
      return { cue, ...(current !== undefined && { current }) };
    }
  }
  return undefined;
}

const stamp = (seconds: number, separator: ',' | '.') => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${separator}${pad(ms % 1000, 3)}`;
};
const cueText = (cue: CaptionCue) => cue.lines.map((line) => line.map((word) => word.text).join(' ')).join('\n');

/** The cues as SubRip (`.srt`). */
export function toSrt(cues: readonly CaptionCue[]): string {
  return cues.map((cue, i) => `${i + 1}\n${stamp(cue.start, ',')} --> ${stamp(cue.end, ',')}\n${cueText(cue)}\n`).join('\n');
}

/** The cues as WebVTT (`.vtt`). */
export function toVtt(cues: readonly CaptionCue[]): string {
  return `WEBVTT\n\n${cues.map((cue) => `${stamp(cue.start, '.')} --> ${stamp(cue.end, '.')}\n${cueText(cue)}\n`).join('\n')}`;
}
```

In `packages/timeline/src/frame.ts`, replace:

```ts
import type { CuttleProject, Ease, Mask, Rect } from '@cuttle/project';
import { cursorAt, type CursorFrame, type CursorTrack } from './cursor';
import { clamp } from './easing';
import { occurrences, rampAmount, type Occurrence } from './occurrences';
```

with:

```ts
import type { CuttleProject, Ease, Mask, Rect } from '@cuttle/project';
import { applyCaptionFixes, captionAt, captionCues, captionWords, type ActiveCaption, type CaptionCue, type SpokenWord } from './captions';
import { cursorAt, type CursorFrame, type CursorTrack } from './cursor';
import { clamp } from './easing';
import { occurrences, rampAmount, type Occurrence } from './occurrences';
```

In the same file, replace:

```ts
export interface RenderState {
  t: number;
  layers: SceneFrame[];
}

export interface Timeline {
  duration: number;
  spans: SceneSpan[];
  frameAt(t: number): RenderState;
}

export interface TimelineOptions {
  screenSize: { width: number; height: number };
  cursor?: CursorTrack;
}

export function createTimeline(project: CuttleProject, opts: TimelineOptions): Timeline {
```

with:

```ts
export interface RenderState {
  t: number;
  layers: SceneFrame[];
  /** The caption shown over the frame, when captions are on and someone speaks. */
  caption?: ActiveCaption;
}

export interface Timeline {
  duration: number;
  spans: SceneSpan[];
  /** The captions of the transcript (output seconds), also when the project does not show them. */
  cues: CaptionCue[];
  frameAt(t: number): RenderState;
}

export interface TimelineOptions {
  screenSize: { width: number; height: number };
  cursor?: CursorTrack;
  /** The take's transcript (source seconds), for the captions. */
  transcript?: readonly SpokenWord[];
  /** Show the captions (default: `captions.enabled`); an export without them passes false. */
  captions?: boolean;
}

export function createTimeline(project: CuttleProject, opts: TimelineOptions): Timeline {
```

In the same file, replace:

```ts
  });
  cuts.sort((a, b) => a - b);
  const full: Rect = [0, 0, opts.screenSize.width, opts.screenSize.height];

  // Where each zoom and text shows in output time, per span: their ramps run in output seconds.
  const zoomShown = new Map(project.zooms.map((zoom) => [zoom, occurrences(spans, zoom.at, zoom.at + zoom.duration)]));
```

with:

```ts
  });
  cuts.sort((a, b) => a - b);
  const full: Rect = [0, 0, opts.screenSize.width, opts.screenSize.height];
  const { captions } = project;
  const cues = opts.transcript ? captionCues(captionWords(applyCaptionFixes(opts.transcript, captions.fixes), spans), captions.style) : [];
  const showCaptions = (opts.captions ?? captions.enabled) && cues.length > 0;

  // Where each zoom and text shows in output time, per span: their ramps run in output seconds.
  const zoomShown = new Map(project.zooms.map((zoom) => [zoom, occurrences(spans, zoom.at, zoom.at + zoom.duration)]));
```

In the same file, replace:

```ts

  function frameAt(t: number): RenderState {
    const time = Number.isNaN(t) ? 0 : clamp(t, 0, duration);
    let span = spanAt(spans, time);
    if (!span) return { t: time, layers: [] };
    // Span ends are rounded to the microsecond, so a frame can fall inside a clip while its source
```

with:

```ts

  function frameAt(t: number): RenderState {
    const time = Number.isNaN(t) ? 0 : clamp(t, 0, duration);
    const state = layersAt(time);
    const caption = showCaptions ? captionAt(cues, time) : undefined;
    return caption ? { ...state, caption } : state;
  }

  function layersAt(time: number): RenderState {
    let span = spanAt(spans, time);
    if (!span) return { t: time, layers: [] };
    // Span ends are rounded to the microsecond, so a frame can fall inside a clip while its source
```

In the same file, replace:

```ts
    return { t: time, layers: [sceneFrame(span, time, 1)] };
  }

  return { duration, spans, frameAt };
}
```

with:

```ts
    return { t: time, layers: [sceneFrame(span, time, 1)] };
  }

  return { duration, spans, cues, frameAt };
}
```

In `packages/timeline/src/index.ts`, replace:

```ts
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
export { clickZooms, shownClicks, zoomRectFor, type ClickZoom, type ClipSpan } from './click-zooms';
```

with:

```ts
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
export {
  CAPTION_RULES,
  applyCaptionFixes,
  captionAt,
  captionCues,
  captionWords,
  toSrt,
  toVtt,
  type ActiveCaption,
  type CaptionCue,
  type CaptionWord,
  type SpokenWord,
} from './captions';
export { clickZooms, shownClicks, zoomRectFor, type ClickZoom, type ClipSpan } from './click-zooms';
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/timeline`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/timeline
git commit -m "timeline: subtitles from the transcript: words in output time, cues of two lines, the spoken word, SRT and VTT

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The engine draws subtitles

**Files:**
- Create: `packages/engine/src/captions.ts`, `packages/engine/test/__golden__/golden.browser.test.ts/caption-{subtitle,karaoke,bold,bold-vertical}.win32.png` (written by the first run)
- Modify: `packages/engine/src/{sprites,renderer}.ts`, `packages/engine/test/{scenarios,run-scenario}.ts`

- [ ] **Step 1: The scenarios**

In `packages/engine/test/scenarios.ts`, replace:

```ts
import type { CuttleProjectInput, InputEvent } from '@cuttle/project';

/** One golden image: a project, the output time to render and the fake inputs to feed it. */
export interface Scenario {
```

with:

```ts
import type { CuttleProjectInput, InputEvent, TranscriptWord } from '@cuttle/project';

/** One golden image: a project, the output time to render and the fake inputs to feed it. */
export interface Scenario {
```

In the same file, replace:

```ts
  events?: InputEvent[];
  /** Feed the fake webcam frame to clip layers (the project must enable `look.webcam`). */
  webcam?: boolean;
}

type Look = NonNullable<CuttleProjectInput['look']>;
```

with:

```ts
  events?: InputEvent[];
  /** Feed the fake webcam frame to clip layers (the project must enable `look.webcam`). */
  webcam?: boolean;
  /** The take's transcript, for captions. */
  transcript?: TranscriptWord[];
}

type Look = NonNullable<CuttleProjectInput['look']>;
```

In the same file, replace:

```ts
  };
}

export const SCENARIOS: Scenario[] = [
  // Backgrounds, behind an end card
  ...(['sunset-sky', 'aurora', 'mesh'] as const).map((preset) => ({
    name: `background-${preset}`,
```

with:

```ts
  };
}

/** Two sentences spoken over the clip; at t = 5 the word "Bildschirm" is being said. */
const SPOKEN: TranscriptWord[] = 'Cuttle nimmt deinen Bildschirm auf und schneidet das Video für dich'
  .split(' ')
  .map((text, i) => ({ t: 3.2 + i * 0.45, end: 3.2 + i * 0.45 + 0.4, text }));

function captionScenario(style: 'subtitle' | 'karaoke' | 'bold', format: 'wide' | 'vertical' = 'wide'): Scenario {
  const output = format === 'wide' ? { width: 640, height: 360, fps: 30 } : { width: 360, height: 640, fps: 30 };
  return {
    name: `caption-${style}${format === 'vertical' ? '-vertical' : ''}`,
    project: project({ frame: { title: TITLE } }, { output, captions: { style, ...(style === 'bold' && { position: 'center' }) } }),
    t: 4.6,
    transcript: SPOKEN,
  };
}

export const SCENARIOS: Scenario[] = [
  // Captions in their three styles; bold in a 9:16 video too
  captionScenario('subtitle'),
  captionScenario('karaoke'),
  captionScenario('bold'),
  captionScenario('bold', 'vertical'),
  // Backgrounds, behind an end card
  ...(['sunset-sky', 'aurora', 'mesh'] as const).map((preset) => ({
    name: `background-${preset}`,
```

In `packages/engine/test/run-scenario.ts`, replace:

```ts
  if (!parsed.ok) throw new Error(`scenario ${scenario.name}: ${JSON.stringify(parsed.issues)}`);
  const project = parsed.project;
  const cursor = scenario.events ? createCursorTrack(scenario.events) : undefined;
  const state = createTimeline(project, { screenSize: SCREEN, cursor }).frameAt(scenario.t);

  const fake = await fixtures();
  const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };
```

with:

```ts
  if (!parsed.ok) throw new Error(`scenario ${scenario.name}: ${JSON.stringify(parsed.issues)}`);
  const project = parsed.project;
  const cursor = scenario.events ? createCursorTrack(scenario.events) : undefined;
  const state = createTimeline(project, { screenSize: SCREEN, cursor, ...(scenario.transcript && { transcript: scenario.transcript }) }).frameAt(scenario.t);

  const fake = await fixtures();
  const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };
```

- [ ] **Step 2: The styles and the renderer**

`packages/engine/src/captions.ts`:

```ts
// Captions drawn into a sprite: one or two lines of words, the spoken word in the caption colour
// (karaoke, bold), on a dark box (subtitle, karaoke) or outlined (bold).
import type { CaptionStyle } from '@cuttle/project';
import { cssFont } from './sprites';

/** How a style draws a caption. Sizes are in units (1 px at 1080p). */
export interface CaptionLook {
  size: number;
  /** Line height, in ems. */
  lineHeight: number;
  /** Box behind the lines; without it the words are outlined. */
  fill?: string;
  padX: number;
  padY: number;
  radius: number;
  /** Outline of the words (no box), in units. */
  stroke?: number;
  shadow?: { blur: number; y: number; color: string };
  /** The spoken word in the caption colour. */
  highlight: boolean;
  upper: boolean;
  /** Share of the output width the caption may use. */
  maxWidth: number;
}

export const CAPTION_LOOKS: Record<CaptionStyle, CaptionLook> = {
  subtitle: { size: 38, lineHeight: 1.28, fill: 'rgba(8, 8, 10, 0.74)', padX: 22, padY: 12, radius: 12, highlight: false, upper: false, maxWidth: 0.86 },
  karaoke: { size: 38, lineHeight: 1.28, fill: 'rgba(8, 8, 10, 0.74)', padX: 22, padY: 12, radius: 12, highlight: true, upper: false, maxWidth: 0.86 },
  bold: {
    size: 74,
    lineHeight: 1.15,
    padX: 0,
    padY: 0,
    radius: 0,
    stroke: 9,
    shadow: { blur: 22, y: 6, color: 'rgba(0, 0, 0, 0.45)' },
    highlight: true,
    upper: true,
    maxWidth: 0.9,
  },
};

const WHITE = '#FFFFFF';

/**
 * Draws a caption's lines centred, at `scale` × the style's size, smaller where the widest line
 * would pass `maxWidth` px. `current`: the spoken word, counted over the lines.
 */
export function drawCaption(
  lines: readonly (readonly string[])[],
  current: number | undefined,
  style: CaptionStyle,
  color: string,
  unit: number,
  scale: number,
  maxWidth: number,
): { canvas: OffscreenCanvas; margin: number } {
  const look = CAPTION_LOOKS[style];
  const texts = lines.map((line) => line.map((word) => (look.upper ? word.toLocaleUpperCase() : word)));
  const padX = Math.round(look.padX * unit * scale);
  const padY = Math.round(look.padY * unit * scale);
  const stroke = look.stroke ? Math.max(1, Math.round(look.stroke * unit * scale)) : 0;
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!;
  let fontPx = Math.max(1, Math.round(look.size * unit * scale));
  measure.font = cssFont(600, fontPx);
  const widest = Math.max(...texts.map((line) => measure.measureText(line.join(' ')).width));
  const room = maxWidth - 2 * padX - 2 * stroke;
  if (widest > room && widest > 0) {
    fontPx = Math.max(1, Math.floor((fontPx * room) / widest));
    measure.font = cssFont(600, fontPx);
  }
  const space = measure.measureText(' ').width;
  const widths = texts.map((line) => line.map((word) => measure.measureText(word).width));
  const lineWidths = widths.map((line) => line.reduce((sum, width) => sum + width, 0) + space * Math.max(0, line.length - 1));
  const lineHeight = Math.round(fontPx * look.lineHeight);
  const boxWidth = Math.max(1, Math.ceil(Math.max(...lineWidths)) + 2 * padX + 2 * stroke);
  const boxHeight = lineHeight * texts.length + 2 * padY + 2 * stroke;
  const shadow = look.shadow ? Math.ceil((look.shadow.blur + Math.abs(look.shadow.y)) * unit * scale) : 0;
  const margin = Math.max(shadow, Math.ceil(fontPx * 0.15));

  const canvas = new OffscreenCanvas(boxWidth + 2 * margin, boxHeight + 2 * margin);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(margin, margin);
  if (look.fill) {
    ctx.fillStyle = look.fill;
    ctx.beginPath();
    ctx.roundRect(0, 0, boxWidth, boxHeight, look.radius * unit * scale);
    ctx.fill();
  }
  ctx.font = cssFont(600, fontPx);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  let index = 0;
  texts.forEach((line, row) => {
    let x = (boxWidth - lineWidths[row]!) / 2;
    const y = padY + stroke + lineHeight * row + lineHeight / 2;
    line.forEach((word, i) => {
      const spoken = look.highlight && index === current;
      if (stroke > 0) {
        if (look.shadow) {
          ctx.shadowColor = look.shadow.color;
          ctx.shadowBlur = look.shadow.blur * unit * scale;
          ctx.shadowOffsetY = look.shadow.y * unit * scale;
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
        ctx.lineWidth = stroke * 2;
        ctx.strokeText(word, x, y);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = spoken ? color : WHITE;
      ctx.fillText(word, x, y);
      x += widths[row]![i]! + space;
      index++;
    });
  });
  return { canvas, margin };
}
```

In `packages/engine/src/sprites.ts`, replace:

```ts
  ) {}

  label(text: string, style: LabelStyle, unit: number, maxWidth: number): Sprite {
    const key = JSON.stringify([text, style, unit, maxWidth]);
    let sprite = this.sprites.get(key);
    if (!sprite) {
      const { canvas, margin } = drawLabel(text, style, unit, maxWidth);
      const texture = createTexture(this.gl, false);
      uploadTexture(this.gl, texture, canvas, false);
      sprite = {
```

with:

```ts
  ) {}

  label(text: string, style: LabelStyle, unit: number, maxWidth: number): Sprite {
    return this.drawn(JSON.stringify([text, style, unit, maxWidth]), () => drawLabel(text, style, unit, maxWidth));
  }

  /** A sprite drawn by `draw` once per `key` (anything else drawn into a canvas: a caption). */
  drawn(key: string, draw: () => { canvas: OffscreenCanvas; margin: number }): Sprite {
    let sprite = this.sprites.get(key);
    if (!sprite) {
      const { canvas, margin } = draw();
      const texture = createTexture(this.gl, false);
      uploadTexture(this.gl, texture, canvas, false);
      sprite = {
```

In `packages/engine/src/renderer.ts`, replace:

```ts
import type { CardScene, CuttleProject, FrameStyle, Rect, Scene, StillScene, TextOverlay } from '@cuttle/project';
import type { ActiveText, RenderState, SceneFrame } from '@cuttle/timeline';
import type { EngineAssets } from './assets';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, sourceSize, uploadTexture } from './gl/texture';
import { placeBadge, placeOverlay, stillCrop, unitFor, uvRect, webcamRect, windowLayout, type Size, type WindowLayout } from './layout';
```

with:

```ts
import type { CardScene, CuttleProject, FrameStyle, Rect, Scene, StillScene, TextOverlay } from '@cuttle/project';
import type { ActiveCaption, ActiveText, RenderState, SceneFrame } from '@cuttle/timeline';
import type { EngineAssets } from './assets';
import { CAPTION_LOOKS, drawCaption } from './captions';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, sourceSize, uploadTexture } from './gl/texture';
import { placeBadge, placeOverlay, stillCrop, unitFor, uvRect, webcamRect, windowLayout, type Size, type WindowLayout } from './layout';
```

In the same file, replace:

```ts
    }
  }

  function drawLayer(layer: SceneFrame, sources: FrameSources, t: number): void {
    const scene = scenes[layer.sceneIndex];
    if (!scene) throw new Error(`render: the project has no scene ${layer.sceneIndex}`);
```

with:

```ts
    }
  }

  /** The caption over the whole frame (also over a crossfade), clear of the webcam bubble. */
  function drawCaptionOver(caption: ActiveCaption): void {
    const { style, color, size, position } = project.captions;
    const lines = caption.cue.lines.map((line) => line.map((word) => word.text));
    const maxWidth = Math.round(output.width * CAPTION_LOOKS[style].maxWidth);
    const key = JSON.stringify(['caption', lines, caption.current, style, color, unit, size, maxWidth]);
    const sprite = sprites.drawn(key, () => drawCaption(lines, caption.current, style, color, unit, size, maxWidth));
    const [x, y] = placeOverlay(output, sprite.box, position, 'center', webcamArea ? [webcamArea] : []);
    spritePass.drawSprite(sprite, x, y, 1);
  }

  function drawLayer(layer: SceneFrame, sources: FrameSources, t: number): void {
    const scene = scenes[layer.sceneIndex];
    if (!scene) throw new Error(`render: the project has no scene ${layer.sceneIndex}`);
```

In the same file, replace:

```ts
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        spritePass.draw(layerTarget.texture, [0, 0, output.width, output.height], layer.opacity, true);
      }
      sprites.endFrame();
    },
    drawnTexts: () => drawn,
```

with:

```ts
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        spritePass.draw(layerTarget.texture, [0, 0, output.width, output.height], layer.opacity, true);
      }
      if (state.caption) drawCaptionOver(state.caption);
      sprites.endFrame();
    },
    drawnTexts: () => drawn,
```

- [ ] **Step 3: Run the goldens; look at the new ones**

Run: `pnpm exec vitest run --project browser packages/engine`
Expected: FAIL once for each of the four new scenarios with "golden created, look at it and run the tests again". Open the PNGs. At 4.6 s the word "Bildschirm" is spoken:
- `caption-subtitle`: two balanced white lines on a dark box at the bottom, "Cuttle nimmt deinen Bildschirm auf / und schneidet das Video für dich";
- `caption-karaoke`: the same with "Bildschirm" in orange;
- `caption-bold`: "DEINEN BILDSCHIRM" outlined in the middle, "BILDSCHIRM" orange;
- `caption-bold-vertical`: the same in a 9:16 video.

Run the command again.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/engine
git commit -m "engine: subtitles in three styles (subtitle, karaoke, bold), over the whole frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The clean voice; the word helpers from the project

**Files:**
- Create: `packages/core/src/speech/cleanup.ts`
- Modify: `packages/core/src/speech/{transcribe,apply,whisper,align,edits}.ts`, `packages/core/src/{use-take,recover,index}.ts`, `packages/core/test/{speech,speech-take}.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/speech.test.ts`, replace:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import type { InputEvent, TranscriptWord } from '@cuttle/project';
import { runFfmpeg } from '../src/ffmpeg';
import { suggestClips } from '../src/suggest/plan';
import { alignWords, guessLanguage } from '../src/speech/align';
import { fillerCuts, fillerWords, likelyFiller, mergeCuts, pauseCuts, restingAt, speechCuts, type SpeechEditInput } from '../src/speech/edits';
import { LEVEL_SECONDS, micLevels, speechStretches } from '../src/speech/levels';
import { downloadFile } from '../src/speech/models';
import { filterValue, normWord, parseWhisperLines, type HeardWord } from '../src/speech/whisper';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
```

with:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import type { InputEvent, TranscriptWord } from '@cuttle/project';
import { runFfmpeg } from '../src/ffmpeg';
import { streamSeconds } from '../src/suggest/media';
import { suggestClips } from '../src/suggest/plan';
import { alignWords, guessLanguage } from '../src/speech/align';
import { cleanMic, cleanupFilter, denoiseLatency } from '../src/speech/cleanup';
import { likelyFiller, normWord } from '@cuttle/project';
import { fillerCuts, fillerWords, mergeCuts, pauseCuts, restingAt, speechCuts, type SpeechEditInput } from '../src/speech/edits';
import { LEVEL_SECONDS, micLevels, speechStretches } from '../src/speech/levels';
import { downloadFile } from '../src/speech/models';
import { filterValue, parseWhisperLines, type HeardWord } from '../src/speech/whisper';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
```

In the same file, replace:

```ts
    expect(existsSync(`${path}.part`)).toBe(false);
  });
});
```

with:

```ts
    expect(existsSync(`${path}.part`)).toBe(false);
  });
});

describe('the cleaned-up mic', () => {
  it('takes the noise filter\'s delay out again and keeps the length', () => {
    expect(cleanupFilter(1200)).toBe('aresample=48000,highpass=f=80,afftdn=nr=12:nf=-50:tn=1,atrim=start_sample=1200,asetpts=PTS-STARTPTS,apad=pad_len=1200,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000');
    expect(cleanupFilter(0)).not.toContain('atrim');
  });

  it('is louder, as long as the mic, and in step with it', async () => {
    expect(await denoiseLatency()).toBeGreaterThan(0);
    const mic = join(fixtures, 'en.m4a');
    const out = join(temp(), 'mic.clean.m4a');
    await cleanMic(mic, out);
    expect(Math.abs((await streamSeconds(out, 'a')) - (await streamSeconds(mic, 'a')))).toBeLessThan(0.03);
    const [before, after] = [await micLevels(mic), await micLevels(out)];
    // the best lag between the two loudness curves, in 10 ms steps
    let best = 0;
    let bestScore = -Infinity;
    for (let lag = -10; lag <= 10; lag++) {
      let score = 0;
      for (let i = 100; i < before.length - 100; i++) score -= Math.abs(before[i]! - (after[i + lag] ?? -100));
      if (score > bestScore) [best, bestScore] = [lag, score];
    }
    expect(best).toBe(0);
    const loud = (levels: Float32Array) => Float32Array.from(levels).sort()[Math.floor(levels.length * 0.95)]!;
    expect(loud(after)).toBeGreaterThan(loud(before) + 3);
    expect(speechStretches(after)).toHaveLength(speechStretches(before).length);
  }, 30_000);
});
```

In `packages/core/test/speech-take.test.ts`, replace:

```ts
    const dir = await spokenTake();
    const progress: number[] = [];
    const done = await transcribeTake(dir, { model, onProgress: (fraction) => progress.push(fraction) });
    expect(done).toMatchObject({ transcript: 'takes/1/transcript.json', model, language: 'en', aligned: true });
    expect(progress.at(-1)).toBe(1);
    const parsed = parseTranscriptJson(readFileSync(join(dir, 'takes', '1', 'transcript.json'), 'utf8'));
    if (!parsed.ok) throw new Error('invalid transcript');
```

with:

```ts
    const dir = await spokenTake();
    const progress: number[] = [];
    const done = await transcribeTake(dir, { model, onProgress: (fraction) => progress.push(fraction) });
    expect(done).toMatchObject({ transcript: 'takes/1/transcript.json', cleanMic: 'takes/1/mic.clean.m4a', model, language: 'en', aligned: true });
    expect(progress.at(-1)).toBe(1);
    const parsed = parseTranscriptJson(readFileSync(join(dir, 'takes', '1', 'transcript.json'), 'utf8'));
    if (!parsed.ok) throw new Error('invalid transcript');
```

In the same file, replace:

```ts
    const records = parsed.transcript.words.find((word) => /records/i.test(word.text));
    expect(records?.t).toBeCloseTo(2.945, 0);
    expect(Math.abs(records!.t - 2.945)).toBeLessThan(0.25);
    expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')).sources.transcript).toBe('takes/1/transcript.json');

    const result = await suggestProject(dir);
    expect(result.speech.from).toBe('transcript');
```

with:

```ts
    const records = parsed.transcript.words.find((word) => /records/i.test(word.text));
    expect(records?.t).toBeCloseTo(2.945, 0);
    expect(Math.abs(records!.t - 2.945)).toBeLessThan(0.25);
    expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')).sources).toMatchObject({ transcript: 'takes/1/transcript.json', cleanMic: 'takes/1/mic.clean.m4a' });

    const result = await suggestProject(dir);
    expect(result.speech.from).toBe('transcript');
```

Run: `pnpm exec vitest run --project node packages/core/test/speech.test.ts`
Expected: FAIL: `../src/speech/cleanup` does not exist.

- [ ] **Step 2: The clean voice**

`packages/core/src/speech/cleanup.ts`:

```ts
// The mic cleaned up for the video: low rumble cut, steady noise taken down, the loudness evened out
// to −16 LUFS, kept in step with the screen. The preview and the export both play it (when
// `look.audio.cleanup` is on), so they sound the same.
import { spawn } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';
import { CoreError } from '../errors';
import { ffmpegPath } from '../ffmpeg';
import { streamSeconds } from '../suggest/media';

/** The cleaned-up mic, next to the mic in the take's folder. */
export const CLEAN_MIC_FILE = 'mic.clean.m4a';
const RATE = 48_000;
const DENOISE = 'afftdn=nr=12:nf=-50:tn=1';

/** Runs ffmpeg and returns its raw stdout. */
function ffmpeg(args: readonly string[], signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-2000)));
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(error.code === 'ENOENT' ? new CoreError('ffmpeg-missing', `ffmpeg was not found (looked for "${ffmpegPath()}")`) : error),
    );
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new CoreError('cancelled', 'cancelled'));
      if (code === 0) return resolve(Buffer.concat(out));
      reject(new CoreError('invalid-media', `ffmpeg failed (exit code ${code}):\n${stderr.trim()}`));
    });
  });
}

let latency: Promise<number> | undefined;

/**
 * How many samples (at 48 kHz) the noise filter holds back: a click sent through it shows where it
 * comes out (1200, 25 ms, with ffmpeg 9). Measured once per process: another ffmpeg may differ.
 */
export function denoiseLatency(): Promise<number> {
  latency ??= ffmpeg(['-f', 'lavfi', '-i', `aevalsrc='if(eq(n,${RATE}),0.9,0)':s=${RATE}:d=2`, '-af', DENOISE, '-ac', '1', '-f', 's16le', '-']).then(
    (data) => {
      let peak = 0;
      let at = RATE;
      for (let i = 0; i + 1 < data.length; i += 2) {
        const value = Math.abs(data.readInt16LE(i));
        if (value > peak) [peak, at] = [value, i / 2];
      }
      return Math.max(0, at - RATE);
    },
    (error: unknown) => {
      latency = undefined;
      throw error;
    },
  );
  return latency;
}

/** The filter that cleans up a mic: the noise filter's delay taken out again, the length kept. */
export function cleanupFilter(delay: number): string {
  return [
    `aresample=${RATE}`,
    'highpass=f=80',
    DENOISE,
    ...(delay > 0 ? [`atrim=start_sample=${delay}`, 'asetpts=PTS-STARTPTS', `apad=pad_len=${delay}`] : []),
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    `aresample=${RATE}`,
  ].join(',');
}

/** Writes the cleaned-up `mic` to `out` (AAC, 48 kHz, as long as the mic: the loudness filter adds a tail), through `<out>.part`. */
export async function cleanMic(mic: string, out: string, signal?: AbortSignal): Promise<void> {
  const [delay, seconds] = await Promise.all([denoiseLatency(), streamSeconds(mic, 'a')]);
  const filter = cleanupFilter(delay);
  const part = `${out}.${process.pid}.part`;
  try {
    await ffmpeg(['-y', '-i', mic, '-map', '0:a:0', '-af', filter, '-ac', '1', '-ar', String(RATE), '-c:a', 'aac', '-b:a', '160k', ...(seconds > 0 ? ['-t', seconds.toFixed(3)] : []), '-f', 'mp4', part], signal);
    await rename(part, out);
  } catch (error) {
    await rm(part, { force: true }).catch(() => {});
    throw error;
  }
}
```

In `packages/core/src/speech/transcribe.ts`, replace:

```ts
// stretches, written as takes/<n>/transcript.json and linked from cuttle.json.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseTakeJson, parseTranscriptJson, trackOffset, TRANSCRIPT_VERSION, type TranscriptFile } from '@cuttle/project';
import { CoreError } from '../errors';
import { readProjectFile, writeProjectFile } from '../project-file';
import { streamSeconds } from '../suggest/media';
import { samePath } from '../use-take';
import { alignWords, guessLanguage } from './align';
import { likelyFiller } from './edits';
import { micLevels, speechStretches } from './levels';
import { chooseModel, modelPath, SPEECH_MODELS } from './models';
import { runWhisper } from './whisper';
```

with:

```ts
// stretches, written as takes/<n>/transcript.json and linked from cuttle.json.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { likelyFiller, parseTakeJson, parseTranscriptJson, trackOffset, TRANSCRIPT_VERSION, type TranscriptFile } from '@cuttle/project';
import { CoreError } from '../errors';
import { readProjectFile, writeProjectFile } from '../project-file';
import { streamSeconds } from '../suggest/media';
import { samePath } from '../use-take';
import { alignWords, guessLanguage } from './align';
import { CLEAN_MIC_FILE, cleanMic } from './cleanup';
import { micLevels, speechStretches } from './levels';
import { chooseModel, modelPath, SPEECH_MODELS } from './models';
import { runWhisper } from './whisper';
```

In the same file, replace:

```ts
  onStatus?: (text: string) => void;
  signal?: AbortSignal;
  /**
   * Link the transcript from cuttle.json (default true). The app links it together with the speech
   * edits instead (`applySpeechEdits`'s `link`), so the editor gets one change.
   */
  link?: boolean;
}

export interface TranscribeResult {
  project: string;
  /** transcript.json, relative to the project folder. */
  transcript: string;
  model: string;
  language: string;
  words: number;
```

with:

```ts
  onStatus?: (text: string) => void;
  signal?: AbortSignal;
  /**
   * Link the transcript (and the cleaned-up mic) from cuttle.json (default true). The app links them
   * together with the speech edits instead (`applySpeechEdits`'s `link`), so the editor gets one change.
   */
  link?: boolean;
  /** Also write the cleaned-up mic, `mic.clean.m4a` (default true). */
  cleanup?: boolean;
}

export interface TranscribeResult {
  project: string;
  /** transcript.json, relative to the project folder. */
  transcript: string;
  /** The cleaned-up mic, relative to the project folder (unless `cleanup` was false). */
  cleanMic?: string;
  model: string;
  language: string;
  words: number;
```

In the same file, replace:

```ts
  if (seconds <= 0) throw new CoreError('invalid-media', `${mic} has no audio`);
  options.onStatus?.(`transcribing ${seconds.toFixed(1)} s of the mic with the ${model} model …`);
  options.onProgress?.(0);
  const [levels, heard, offset] = await Promise.all([
    micLevels(mic, options.signal),
    runWhisper(mic, { model: modelPath(model), language, seconds, ...(options.onProgress && { onProgress: options.onProgress }), ...(options.signal && { signal: options.signal }) }),
    micOffset(screen, mic),
  ]);
  const spoken = language === 'auto' ? guessLanguage(heard) : language;
  const alignment = alignWords(heard, speechStretches(levels), { filler: (word) => likelyFiller(word.text, spoken) });
```

with:

```ts
  if (seconds <= 0) throw new CoreError('invalid-media', `${mic} has no audio`);
  options.onStatus?.(`transcribing ${seconds.toFixed(1)} s of the mic with the ${model} model …`);
  options.onProgress?.(0);
  const cleaned = join(dirname(mic), CLEAN_MIC_FILE);
  const [levels, heard, offset] = await Promise.all([
    micLevels(mic, options.signal),
    runWhisper(mic, { model: modelPath(model), language, seconds, ...(options.onProgress && { onProgress: options.onProgress }), ...(options.signal && { signal: options.signal }) }),
    micOffset(screen, mic),
    ...(options.cleanup !== false ? [cleanMic(mic, cleaned, options.signal)] : []),
  ]);
  const spoken = language === 'auto' ? guessLanguage(heard) : language;
  const alignment = alignWords(heard, speechStretches(levels), { filler: (word) => likelyFiller(word.text, spoken) });
```

In the same file, replace:

```ts
  await writeFile(part, `${JSON.stringify(transcript, null, 1)}\n`);
  await rename(part, path);
  const link = projectPath(file.dir, path);
  if (options.link !== false) await linkTranscript(projectDir, link);
  options.onProgress?.(1);
  return {
    project: file.path,
    transcript: link,
    model,
    language: transcript.language,
    words: words.length,
```

with:

```ts
  await writeFile(part, `${JSON.stringify(transcript, null, 1)}\n`);
  await rename(part, path);
  const link = projectPath(file.dir, path);
  const cleanLink = options.cleanup !== false ? projectPath(file.dir, cleaned) : undefined;
  if (options.link !== false) await linkTranscript(projectDir, link, cleanLink);
  options.onProgress?.(1);
  return {
    project: file.path,
    transcript: link,
    ...(cleanLink && { cleanMic: cleanLink }),
    model,
    language: transcript.language,
    words: words.length,
```

In the same file, replace:

```ts
  return sources.mic !== undefined && samePath(dirname(resolve(dir, sources.mic)), dirname(resolve(dir, link)));
}

/** Links a transcript from cuttle.json (`sources.transcript`), refusing when the project moved to another take. */
async function linkTranscript(projectDir: string, link: string): Promise<void> {
  const file = await readProjectFile(projectDir);
  if (!transcriptOfMic(file.dir, file.project.sources, link)) {
    throw new CoreError('conflict', `the project moved to another take while it was transcribed: ${link} is not linked`);
  }
  if ((file.raw.sources as Record<string, unknown>).transcript === link) return;
  file.raw.sources = { ...(file.raw.sources as Record<string, unknown>), transcript: link };
  await writeProjectFile(file, 'transcribe');
}
```

with:

```ts
  return sources.mic !== undefined && samePath(dirname(resolve(dir, sources.mic)), dirname(resolve(dir, link)));
}

/**
 * Links a transcript (`sources.transcript`) and the cleaned-up mic (`sources.cleanMic`) from
 * cuttle.json, refusing when the project moved to another take.
 */
async function linkTranscript(projectDir: string, link: string, cleanLink?: string): Promise<void> {
  const file = await readProjectFile(projectDir);
  if (!transcriptOfMic(file.dir, file.project.sources, link)) {
    throw new CoreError('conflict', `the project moved to another take while it was transcribed: ${link} is not linked`);
  }
  const sources = file.raw.sources as Record<string, unknown>;
  if (sources.transcript === link && sources.cleanMic === (cleanLink ?? sources.cleanMic)) return;
  file.raw.sources = { ...sources, transcript: link, ...(cleanLink && { cleanMic: cleanLink }) };
  await writeProjectFile(file, 'transcribe');
}
```

In `packages/core/src/speech/apply.ts`, replace:

```ts
/**
 * Applies the speech edits of the project's transcript to cuttle.json, leaving its scenes and every
 * other item as they are: the app's step once the transcript arrives after the cut. `link`: a
 * transcript to link first (in the same write), which must belong to the project's mic.
 */
export async function applySpeechEdits(projectDir: string, options: { link?: string; onStatus?: (text: string) => void } = {}): Promise<SpeechEditsResult> {
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  if (options.link !== undefined) {
    if (!transcriptOfMic(file.dir, sources, options.link)) throw new CoreError('conflict', `the project moved to another take while it was transcribed: ${options.link} is not linked`);
    file.raw.sources = { ...(file.raw.sources as Record<string, unknown>), transcript: options.link };
  }
  const linked = options.link ?? sources.transcript;
  const { transcript, note } = await readTranscript(file.dir, linked);
```

with:

```ts
/**
 * Applies the speech edits of the project's transcript to cuttle.json, leaving its scenes and every
 * other item as they are: the app's step once the transcript arrives after the cut. `link`: a
 * transcript to link first (in the same write), which must belong to the project's mic; `cleanMic`:
 * the cleaned-up mic, linked with it.
 */
export async function applySpeechEdits(projectDir: string, options: { link?: string; cleanMic?: string; onStatus?: (text: string) => void } = {}): Promise<SpeechEditsResult> {
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  if (options.link !== undefined) {
    if (!transcriptOfMic(file.dir, sources, options.link)) throw new CoreError('conflict', `the project moved to another take while it was transcribed: ${options.link} is not linked`);
    file.raw.sources = { ...(file.raw.sources as Record<string, unknown>), transcript: options.link, ...(options.cleanMic && { cleanMic: options.cleanMic }) };
  }
  const linked = options.link ?? sources.transcript;
  const { transcript, note } = await readTranscript(file.dir, linked);
```

In the same file, replace:

```ts
  const clips = file.project.scenes.flatMap((scene) => (scene.type === 'clip' && scene.speed === 1 ? [{ from: scene.from, to: scene.to }] : []));
  const result = withSpeechCuts(file.raw, file.project, transcript, { still: screen.still, events, clips });
  const before = JSON.stringify(file.raw.cuts ?? []);
  const linking = options.link !== undefined && options.link !== sources.transcript;
  if (JSON.stringify(result.cuts) === before && !linking) return { ...result, project: file.path, written: false };
  if (result.cuts.length > 0 || file.raw.cuts !== undefined) file.raw.cuts = result.cuts;
  await writeProjectFile(file, 'the speech edits');
```

with:

```ts
  const clips = file.project.scenes.flatMap((scene) => (scene.type === 'clip' && scene.speed === 1 ? [{ from: scene.from, to: scene.to }] : []));
  const result = withSpeechCuts(file.raw, file.project, transcript, { still: screen.still, events, clips });
  const before = JSON.stringify(file.raw.cuts ?? []);
  const linking = (options.link !== undefined && options.link !== sources.transcript) || (options.cleanMic !== undefined && options.cleanMic !== sources.cleanMic);
  if (JSON.stringify(result.cuts) === before && !linking) return { ...result, project: file.path, written: false };
  if (result.cuts.length > 0 || file.raw.cuts !== undefined) file.raw.cuts = result.cuts;
  await writeProjectFile(file, 'the speech edits');
```

In `packages/core/src/use-take.ts`, replace:

```ts
  markers?: string;
  /** What the mic said (`transcript.json`), when the take was transcribed. */
  transcript?: string;
  seconds: number;
}
```

with:

```ts
  markers?: string;
  /** What the mic said (`transcript.json`), when the take was transcribed. */
  transcript?: string;
  /** The cleaned-up mic, made with the transcription. */
  cleanMic?: string;
  seconds: number;
}
```

In the same file, replace:

```ts
    ...(take.events && { events: take.events }),
    ...(take.markers && { markers: take.markers }),
    ...(take.transcript && { transcript: take.transcript }),
  };
  if (keepEdit) {
    if (scenes.length === 0) file.raw.scenes = [{ type: 'clip', from: 0, to: Math.floor(take.seconds * 1000) / 1000 }];
```

with:

```ts
    ...(take.events && { events: take.events }),
    ...(take.markers && { markers: take.markers }),
    ...(take.transcript && { transcript: take.transcript }),
    ...(take.cleanMic && { cleanMic: take.cleanMic }),
  };
  if (keepEdit) {
    if (scenes.length === 0) file.raw.scenes = [{ type: 'clip', from: 0, to: Math.floor(take.seconds * 1000) / 1000 }];
```

In `packages/core/src/recover.ts`, replace:

```ts
  backup?: string;
}

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json', segments: 'segments.json', transcript: 'transcript.json' };

/**
 * Recovers a take (a folder relative to the project, e.g. takes/3): makes it usable after
```

with:

```ts
  backup?: string;
}

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json', segments: 'segments.json', transcript: 'transcript.json', cleanMic: 'mic.clean.m4a' };

/**
 * Recovers a take (a folder relative to the project, e.g. takes/3): makes it usable after
```

In the same file, replace:

```ts
      events: source(FILES.events),
      markers: source(FILES.markers),
      ...(existsSync(path(FILES.transcript)) && { transcript: source(FILES.transcript) }),
      seconds,
    },
    sameTake,
```

with:

```ts
      events: source(FILES.events),
      markers: source(FILES.markers),
      ...(existsSync(path(FILES.transcript)) && { transcript: source(FILES.transcript) }),
      ...(mic && existsSync(path(FILES.cleanMic)) && { cleanMic: source(FILES.cleanMic) }),
      seconds,
    },
    sameTake,
```

- [ ] **Step 3: The word helpers come from the project**

In `packages/core/src/speech/whisper.ts`, replace:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreError } from '../errors';
import { ffmpegPath, runFfmpeg } from '../ffmpeg';
```

with:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normWord } from '@cuttle/project';
import { CoreError } from '../errors';
import { ffmpegPath, runFfmpeg } from '../ffmpeg';
```

In the same file, replace:

```ts
  return option.replace(/[\\'[\],;]/g, '\\$&');
}

/** Letters and digits only, lower case: how words are compared. */
export const normWord = (text: string) => text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The words of the filter's `format=json` output, one per line: `{"start":ms,"end":ms,"text":"…"}`.
 * The text is not escaped (a quotation mark in the speech is written as is), so each line is read
```

with:

```ts
  return option.replace(/[\\'[\],;]/g, '\\$&');
}

/**
 * The words of the filter's `format=json` output, one per line: `{"start":ms,"end":ms,"text":"…"}`.
 * The text is not escaped (a quotation mark in the speech is written as is), so each line is read
```

In `packages/core/src/speech/align.ts`, replace:

```ts
// stretch takes, in order, the run of words whose letters fit its length at the take's speaking rate,
// near where whisper put them; inside a stretch the words share its length by their letters. In the
// spike this cut the median start error from about 500 ms to 35 to 76 ms.
import type { Span } from '../suggest/spans';
import { normWord, type HeardWord } from './whisper';

export const ALIGN_RULES = {
  /** A stretch shorter than this may take no word, cheaply: a filler whisper left out, a cough, a click. */
```

with:

```ts
// stretch takes, in order, the run of words whose letters fit its length at the take's speaking rate,
// near where whisper put them; inside a stretch the words share its length by their letters. In the
// spike this cut the median start error from about 500 ms to 35 to 76 ms.
import { normWord } from '@cuttle/project';
import type { Span } from '../suggest/spans';
import type { HeardWord } from './whisper';

export const ALIGN_RULES = {
  /** A stretch shorter than this may take no word, cheaply: a filler whisper left out, a cough, a click. */
```

In `packages/core/src/speech/edits.ts`, replace:

```ts
// The speech edits: filler words and long pauses cut out where the picture rests. Pure: the inputs
// are the transcript, the screen's still stretches and the input events, in source seconds.
import { newId, type InputEvent, type TranscriptWord } from '@cuttle/project';
import { gaps, union, type Span } from '../suggest/spans';
import { normWord } from './whisper';

export const SPEECH_EDIT_RULES = {
  /** Kept on both sides of a filler's cut, up to the words around it. */
```

with:

```ts
// The speech edits: filler words and long pauses cut out where the picture rests. Pure: the inputs
// are the transcript, the screen's still stretches and the input events, in source seconds.
import { SHORT_SPELLINGS, fillerLexicon, newId, normWord, type InputEvent, type TranscriptWord } from '@cuttle/project';
import { gaps, union, type Span } from '../suggest/spans';

export const SPEECH_EDIT_RULES = {
  /** Kept on both sides of a filler's cut, up to the words around it. */
```

In the same file, replace:

```ts
  pointerSlack: 12,
};

/** Fillers in German, in English, and those safe whatever the language ("um" and "er" are German words). */
const FILLERS: Record<'de' | 'en' | 'auto', ReadonlySet<string>> = {
  de: new Set(['äh', 'ähm', 'öh', 'öhm', 'ehm', 'hm', 'hmm', 'mhm', 'ähh', 'ähmm']),
  en: new Set(['uh', 'uhm', 'um', 'umm', 'er', 'erm', 'hm', 'hmm', 'mhm', 'ehm']),
  auto: new Set(['äh', 'ähm', 'öh', 'öhm', 'ehm', 'hm', 'hmm', 'mhm', 'uh', 'uhm', 'erm']),
};
/** How whisper writes fillers it misheard (the spike: "Äh" as "E.", "Ähm" as "M."), when alone between pauses. */
const SHORT_SPELLINGS: ReadonlySet<string> = new Set(['e', 'eh', 'ee', 'm', 'mm', 'hm', 'ä', 'äh', 'ah', 'uh']);

export interface SpeechCut {
  from: number;
  to: number;
```

with:

```ts
  pointerSlack: 12,
};

export interface SpeechCut {
  from: number;
  to: number;
```

In the same file, replace:

```ts
  return !busy.some((other) => other.from < span.to && span.from < other.to);
}

const fillerSet = (language: string) => FILLERS[language === 'de' || language === 'en' ? language : 'auto'];

/** Whether a word is likely a filler: in the language's lexicon, or one of whisper's short spellings of one. */
export const likelyFiller = (text: string, language: string): boolean => {
  const word = normWord(text);
  return fillerSet(language).has(word) || SHORT_SPELLINGS.has(word);
};

/** The filler words of a transcript: in the lexicon, or a short spelling alone between pauses. */
export function fillerWords(words: readonly TranscriptWord[], language: string, rules = SPEECH_EDIT_RULES): number[] {
  const lexicon = fillerSet(language);
  const found: number[] = [];
  words.forEach((word, n) => {
    const text = normWord(word.text);
```

with:

```ts
  return !busy.some((other) => other.from < span.to && span.from < other.to);
}

/** The filler words of a transcript: in the lexicon, or a short spelling alone between pauses. */
export function fillerWords(words: readonly TranscriptWord[], language: string, rules = SPEECH_EDIT_RULES): number[] {
  const lexicon = fillerLexicon(language);
  const found: number[] = [];
  words.forEach((word, n) => {
    const text = normWord(word.text);
```

In `packages/core/src/index.ts`, replace:

```ts
export { gaps, length, union, type Span } from './suggest/spans';
export { transcriptMarkers } from './suggest/transcript';
export { DEFAULT_MODEL, MODEL_NAMES, SPEECH_MODELS, chooseModel, downloadFile, downloadModel, installedModels, modelInstalled, modelPath, modelUrl, modelsDir, removeModel, speechModel, type DownloadOptions, type ModelName, type SpeechModel } from './speech/models';
export { filterValue, hasWhisper, normWord, parseWhisperLines, runWhisper, type HeardWord, type WhisperOptions } from './speech/whisper';
export { LEVEL_SECONDS, SPEECH_RULES, micLevels, speechStretches } from './speech/levels';
export { ALIGN_RULES, alignWords, guessLanguage, type Alignment } from './speech/align';
export { SPEECH_EDIT_RULES, fillerCuts, fillerWords, inputSpans, likelyFiller, mergeCuts, pauseCuts, restingAt, speechCuts, type RawCut, type SpeechCut, type SpeechEditInput } from './speech/edits';
export { TRANSCRIPT_FILE, micOffset, readTranscript, transcribeTake, transcriptOfMic, type TranscribeOptions, type TranscribeResult } from './speech/transcribe';
export { applySpeechEdits, speechActivity, withSpeechCuts, type SpeechCutsResult, type SpeechEditsResult } from './speech/apply';
```

with:

```ts
export { gaps, length, union, type Span } from './suggest/spans';
export { transcriptMarkers } from './suggest/transcript';
export { DEFAULT_MODEL, MODEL_NAMES, SPEECH_MODELS, chooseModel, downloadFile, downloadModel, installedModels, modelInstalled, modelPath, modelUrl, modelsDir, removeModel, speechModel, type DownloadOptions, type ModelName, type SpeechModel } from './speech/models';
export { filterValue, hasWhisper, parseWhisperLines, runWhisper, type HeardWord, type WhisperOptions } from './speech/whisper';
export { LEVEL_SECONDS, SPEECH_RULES, micLevels, speechStretches } from './speech/levels';
export { ALIGN_RULES, alignWords, guessLanguage, type Alignment } from './speech/align';
export { SPEECH_EDIT_RULES, fillerCuts, fillerWords, inputSpans, mergeCuts, pauseCuts, restingAt, speechCuts, type RawCut, type SpeechCut, type SpeechEditInput } from './speech/edits';
export { TRANSCRIPT_FILE, micOffset, readTranscript, transcribeTake, transcriptOfMic, type TranscribeOptions, type TranscribeResult } from './speech/transcribe';
export { applySpeechEdits, speechActivity, withSpeechCuts, type SpeechCutsResult, type SpeechEditsResult } from './speech/apply';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/core`
Expected: PASS (the real transcription only where a speech model is downloaded).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "core: the clean voice (denoised, even loudness, in step with the mic), made with the transcription

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Subtitles in the export

**Files:**
- Modify: `packages/export/src/{job,index}.ts`, `packages/export/src/page/run.ts`, `packages/export/src/main/{export,sources,stills}.ts`, `packages/export/test/main/sources.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/export/test/main/sources.test.ts`, replace:

```ts
    expect(sources.webcam?.offset).toBeCloseTo(0.5, 9);
  });

  it('names a missing or empty media file, but accepts empty events', async () => {
    const noWebcam = Object.fromEntries(Object.entries(MEDIA).filter(([path]) => path !== 'take/webcam.mp4'));
    const missing = await projectDir({ sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES }, noWebcam);
```

with:

```ts
    expect(sources.webcam?.offset).toBeCloseTo(0.5, 9);
  });

  it('reads the transcript for the captions, and goes on without one it cannot read', async () => {
    const transcript = { version: 1, language: 'de', model: 'small', words: [{ t: 0.2, end: 0.6, text: 'Hallo' }] };
    const dir = await projectDir({ sources: { ...SOURCES, transcript: 'take/transcript.json' }, scenes: SCENES }, { ...MEDIA, 'take/transcript.json': JSON.stringify(transcript) });
    const sources = await loadSources(dir);
    expect(sources.transcript).toEqual(transcript.words);
    // the transcript is one of the project's files: no output may replace it
    expect(sources.inputs).toContain(join(dir, 'take', 'transcript.json'));
    const broken = await projectDir({ sources: { ...SOURCES, transcript: 'take/transcript.json' }, scenes: SCENES }, { ...MEDIA, 'take/transcript.json': '{' });
    const without = await loadSources(broken);
    expect(without.transcript).toBeUndefined();
    expect(without.warnings).toEqual(['take/transcript.json is invalid: no captions']);
    const gone = await projectDir({ sources: { ...SOURCES, transcript: 'take/transcript.json' }, scenes: SCENES }, MEDIA);
    expect((await loadSources(gone)).warnings).toEqual(['take/transcript.json cannot be read: no captions']);
  });

  it('names a missing or empty media file, but accepts empty events', async () => {
    const noWebcam = Object.fromEntries(Object.entries(MEDIA).filter(([path]) => path !== 'take/webcam.mp4'));
    const missing = await projectDir({ sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES }, noWebcam);
```

Run: `pnpm exec vitest run --project node packages/export/test/main/sources.test.ts`
Expected: FAIL: `sources.transcript` is undefined.

- [ ] **Step 2: The export**

In `packages/export/src/job.ts`, replace:

```ts
import type { CuttleProject, InputEvent } from '@cuttle/project';

/**
 * Contract between the main process and the export page. Pure types and constants: both sides
```

with:

```ts
import type { CuttleProject, InputEvent, TranscriptWord } from '@cuttle/project';

/**
 * Contract between the main process and the export page. Pure types and constants: both sides
```

In the same file, replace:

```ts
  webcam?: { path: string; offset: number };
  /** Present when the cursor is on and the project has events. */
  events?: InputEvent[];
  /** Scene index → image of a still scene. */
  stills: Record<number, string>;
  /** Image for `look.background.preset: 'image'`. */
```

with:

```ts
  webcam?: { path: string; offset: number };
  /** Present when the cursor is on and the project has events. */
  events?: InputEvent[];
  /** The take's transcript (source seconds), for the captions; present when the project has one. */
  transcript?: TranscriptWord[];
  /** Burn the captions in (default: the project's `captions.enabled`). */
  captions?: boolean;
  /** Scene index → image of a still scene. */
  stills: Record<number, string>;
  /** Image for `look.background.preset: 'image'`. */
```

In `packages/export/src/page/run.ts`, replace:

```ts
    const timeline = createTimeline(project, {
      screenSize: screen.size,
      cursor: job.events ? createCursorTrack(job.events) : undefined,
    });
    const plan = makePlan(timeline);
    if (job.backgroundImage) background = await loadImage(job.backgroundImage, probeMaxTextureSize(), 'the background image');
```

with:

```ts
    const timeline = createTimeline(project, {
      screenSize: screen.size,
      cursor: job.events ? createCursorTrack(job.events) : undefined,
      ...(job.transcript && { transcript: job.transcript }),
      ...(job.captions !== undefined && { captions: job.captions }),
    });
    const plan = makePlan(timeline);
    if (job.backgroundImage) background = await loadImage(job.backgroundImage, probeMaxTextureSize(), 'the background image');
```

In `packages/export/src/main/sources.ts`, replace:

```ts
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseEventsJsonl, parseProjectJson, parseTakeJson, trackOffset, type CuttleProject, type InputEvent, type TakeFile } from '@cuttle/project';
import { ExportError } from '../errors';

/** cuttle.json inside the project folder. */
```

with:

```ts
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseEventsJsonl, parseProjectJson, parseTakeJson, parseTranscriptJson, trackOffset, type CuttleProject, type InputEvent, type TakeFile, type TranscriptWord } from '@cuttle/project';
import { ExportError } from '../errors';

/** cuttle.json inside the project folder. */
```

In the same file, replace:

```ts
  webcam?: { path: string; offset: number };
  mic?: { path: string; offset: number };
  events?: InputEvent[];
  stills: Record<number, string>;
  backgroundImage?: string;
  /** Every file the project names (cuttle.json and take.json included): the output must not replace one. */
```

with:

```ts
  webcam?: { path: string; offset: number };
  mic?: { path: string; offset: number };
  events?: InputEvent[];
  /** The take's transcript (source seconds), for captions and subtitle files. */
  transcript?: TranscriptWord[];
  stills: Record<number, string>;
  backgroundImage?: string;
  /** Every file the project names (cuttle.json and take.json included): the output must not replace one. */
```

In the same file, replace:

```ts
  const take = takeFile?.take;
  // Every file the project names, including sources the look switches off: the output must not
  // replace a recording just because this export does not read it.
  const named = [sources.webcam, sources.mic, sources.events, sources.markers, look.background.image].filter((path) => path !== undefined);
  const inputs = [resolve(projectPath), screen, join(dirname(screen), TAKE_FILE), ...named.map((path) => resolve(projectDir, path))];
  const result: ProjectSources = { project, screen, stills: {}, inputs, warnings: takeFile?.warning ? [takeFile.warning] : [] };
```

with:

```ts
  const take = takeFile?.take;
  // Every file the project names, including sources the look switches off: the output must not
  // replace a recording just because this export does not read it.
  const named = [sources.webcam, sources.mic, sources.cleanMic, sources.events, sources.markers, sources.transcript, look.background.image].filter((path) => path !== undefined);
  const inputs = [resolve(projectPath), screen, join(dirname(screen), TAKE_FILE), ...named.map((path) => resolve(projectDir, path))];
  const result: ProjectSources = { project, screen, stills: {}, inputs, warnings: takeFile?.warning ? [takeFile.warning] : [] };
```

In the same file, replace:

```ts
  }
  if (look.audio.enabled && sources.mic) {
    const path = await existing(projectDir, sources.mic, 'mic recording (sources.mic)');
    result.mic = { path, offset: offsetFor(take, 'mic', path, screen) };
  }
  if (look.cursor.enabled && sources.events) {
    const path = await existing(projectDir, sources.events, 'input events (sources.events)', false);
```

with:

```ts
  }
  if (look.audio.enabled && sources.mic) {
    const path = await existing(projectDir, sources.mic, 'mic recording (sources.mic)');
    // the cleaned-up mic plays in its place, in step with it (take.json describes the mic itself)
    const clean = look.audio.cleanup && sources.cleanMic ? await existing(projectDir, sources.cleanMic, 'cleaned-up mic (sources.cleanMic)') : undefined;
    result.mic = { path: clean ?? path, offset: offsetFor(take, 'mic', path, screen) };
  }
  if (look.cursor.enabled && sources.events) {
    const path = await existing(projectDir, sources.events, 'input events (sources.events)', false);
```

In the same file, replace:

```ts
    if (events.issues.length > 0) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(events.issues)}`);
    result.events = events.events;
  }
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type !== 'still') continue;
    result.stills[index] = await existing(projectDir, scene.image, `image of scene ${index}`);
```

with:

```ts
    if (events.issues.length > 0) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(events.issues)}`);
    result.events = events.events;
  }
  if (sources.transcript) {
    // without it the video has no captions: worth a warning, not a failed export
    const path = resolve(projectDir, sources.transcript);
    const text = await readFile(path, 'utf8').catch(() => undefined);
    const parsed = text === undefined ? undefined : parseTranscriptJson(text);
    if (parsed?.ok) result.transcript = parsed.transcript.words;
    else result.warnings.push(`${sources.transcript} ${parsed ? 'is invalid' : 'cannot be read'}: no captions`);
  }
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type !== 'still') continue;
    result.stills[index] = await existing(projectDir, scene.image, `image of scene ${index}`);
```

In `packages/export/src/main/stills.ts`, replace:

```ts
    screen: sources.screen,
    webcam: sources.webcam,
    events: sources.events,
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    times: opts.times,
```

with:

```ts
    screen: sources.screen,
    webcam: sources.webcam,
    events: sources.events,
    ...(sources.transcript && { transcript: sources.transcript }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    times: opts.times,
```

In `packages/export/src/main/export.ts`, replace:

```ts
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sceneSpans } from '@cuttle/timeline';
import { app } from 'electron';
import { INLINE_GRAPH_LIMIT, audioFilterGraph, muxArgs, planAudio } from '../audio';
import { ExportError } from '../errors';
```

with:

```ts
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans, toSrt, toVtt } from '@cuttle/timeline';
import { app } from 'electron';
import { INLINE_GRAPH_LIMIT, audioFilterGraph, muxArgs, planAudio } from '../audio';
import { ExportError } from '../errors';
```

In the same file, replace:

```ts
  pageDir?: string;
  /** Cancels the export: the window closes, ffmpeg stops, nothing reaches `out`; rejects with `cancelled`. */
  signal?: AbortSignal;
}

export interface ExportStats {
  gpu: string;
  codec: string;
```

with:

```ts
  pageDir?: string;
  /** Cancels the export: the window closes, ffmpeg stops, nothing reaches `out`; rejects with `cancelled`. */
  signal?: AbortSignal;
  /** Burn the captions into the video (default: the project's `captions.enabled`). */
  captions?: boolean;
  /** Subtitle files written next to `out` (`<name>.srt`, `<name>.vtt`); the project needs a transcript. */
  subtitles?: readonly SubtitleFormat[];
}

export const SUBTITLE_FORMATS = ['srt', 'vtt'] as const;
export type SubtitleFormat = (typeof SUBTITLE_FORMATS)[number];

/** The subtitle file of `out` in `format`: its name with the format's extension. */
export const subtitlePath = (out: string, format: SubtitleFormat) => join(dirname(out), `${basename(out).replace(/\.[^.]*$/, '')}.${format}`);

export interface ExportStats {
  gpu: string;
  codec: string;
```

In the same file, replace:

```ts
  frames: number;
  /** Length of the exported video in seconds (frames / fps). */
  seconds: number;
  stats: ExportStats;
}
```

with:

```ts
  frames: number;
  /** Length of the exported video in seconds (frames / fps). */
  seconds: number;
  /** The subtitle files written next to it. */
  subtitles?: string[];
  stats: ExportStats;
}
```

In the same file, replace:

```ts
  const sources = await loadSources(projectDir);
  for (const warning of sources.warnings) console.warn(`warning: ${warning}`);
  await checkOutput(out, sources.inputs);
  await checkFfmpeg();
  if (sources.mic) await checkMic(sources.mic.path, signal);
  throwIfCancelled();
```

with:

```ts
  const sources = await loadSources(projectDir);
  for (const warning of sources.warnings) console.warn(`warning: ${warning}`);
  await checkOutput(out, sources.inputs);
  const subtitles = [...new Set(opts.subtitles ?? [])];
  if (subtitles.length > 0 && !sources.transcript) {
    throw new ExportError('missing-file', 'subtitle files need the take\'s transcript (sources.transcript): run "cuttle transcribe" first');
  }
  for (const format of subtitles) await checkOutput(subtitlePath(out, format), sources.inputs);
  await checkFfmpeg();
  if (sources.mic) await checkMic(sources.mic.path, signal);
  throwIfCancelled();
```

In the same file, replace:

```ts
    screen: sources.screen,
    webcam: sources.webcam,
    events: sources.events,
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    encoder: opts.encoder ?? 'auto',
```

with:

```ts
    screen: sources.screen,
    webcam: sources.webcam,
    events: sources.events,
    ...(sources.transcript && { transcript: sources.transcript }),
    ...(opts.captions !== undefined && { captions: opts.captions }),
    stills: sources.stills,
    backgroundImage: sources.backgroundImage,
    encoder: opts.encoder ?? 'auto',
```

In the same file, replace:

```ts
    } catch (error) {
      throw new ExportError('render', `could not replace ${out} (is it open in a player?): ${(error as Error).message}`, { cause: error });
    }
    return {
      out,
      frames: page.frames,
      seconds,
      stats: {
        gpu: page.gpu,
        codec: page.codec,
```

with:

```ts
    } catch (error) {
      throw new ExportError('render', `could not replace ${out} (is it open in a player?): ${(error as Error).message}`, { cause: error });
    }
    const written: string[] = [];
    if (subtitles.length > 0 && sources.transcript) {
      // as subtitles, whatever the burned-in style: two lines a cue, on the video's timeline
      const spans = sceneSpans(project.scenes, project.cuts);
      const cues = captionCues(captionWords(applyCaptionFixes(sources.transcript, project.captions.fixes), spans), 'subtitle');
      for (const format of subtitles) {
        const path = subtitlePath(out, format);
        await writeFile(path, format === 'srt' ? toSrt(cues) : toVtt(cues));
        written.push(path);
      }
    }
    return {
      out,
      frames: page.frames,
      seconds,
      ...(written.length > 0 && { subtitles: written }),
      stats: {
        gpu: page.gpu,
        codec: page.codec,
```

In `packages/export/src/index.ts`, replace:

```ts
// Main-process API (Electron). Bundle it with Vite: the packages ship TypeScript source.
export { exportProject, type ExportOptions, type ExportResult, type ExportStats } from './main/export';
export { ExportError } from './errors';
export { EXPORT_FORMATS, isExportFormat, type ExportFormat } from './formats';
export type { EncoderPreference, ExportErrorCode } from './job';
```

with:

```ts
// Main-process API (Electron). Bundle it with Vite: the packages ship TypeScript source.
export { SUBTITLE_FORMATS, exportProject, subtitlePath, type ExportOptions, type ExportResult, type ExportStats, type SubtitleFormat } from './main/export';
export { ExportError } from './errors';
export { EXPORT_FORMATS, isExportFormat, type ExportFormat } from './formats';
export type { EncoderPreference, ExportErrorCode } from './job';
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/export`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/export
git commit -m "export: subtitles burned in or left out, .srt and .vtt beside the video, and the clean voice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: cuttle transcript and the render's subtitles

**Files:**
- Create: `apps/cli/src/commands/transcript.ts`
- Modify: `apps/cli/src/main.ts`, `apps/cli/src/commands/render.ts`, `apps/cli/src/electron/{main,protocol}.ts`, `apps/cli/test/{cli.test,electron.check.test}.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/cli/test/cli.test.ts`, replace:

```ts
  }, 30_000);
});

describe('cuttle suggest and recover', () => {
  let fixture: string;
  beforeAll(() => {
```

with:

```ts
  }, 30_000);
});

describe('cuttle transcript', () => {
  it('gives the words with the fixes, and the captions on the video\'s time as JSON, SRT, VTT or text', async () => {
    const dir = temp();
    takeFixture(dir);
    expect((await cli('--json', '-C', dir, 'transcript')).json).toEqual({ error: { code: 'usage', message: 'the project has no transcript: run "cuttle transcribe" first' } });
    writeFileSync(
      join(dir, 'takes', '1', 'transcript.json'),
      JSON.stringify({ version: 1, language: 'de', model: 'small', words: [{ t: 1, end: 1.4, text: 'Das' }, { t: 1.4, end: 1.8, text: 'ist' }, { t: 1.8, end: 2.4, text: 'Holofisch.' }, { t: 6, end: 6.5, text: 'Weg' }] }),
    );
    const path = join(dir, 'cuttle.json');
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(
      path,
      JSON.stringify({
        ...raw,
        sources: { ...raw.sources, transcript: 'takes/1/transcript.json' },
        // the second clip starts at 1 s of the video; "Weg" lies in the cut
        scenes: [{ type: 'clip', from: 0.5, to: 3 }, { type: 'clip', from: 5, to: 8 }],
        cuts: [{ from: 5.9, to: 6.6 }],
        captions: { fixes: [{ at: 1.8, end: 2.4, text: 'Holofish.' }] },
      }),
    );
    const { code, json } = await cli('--json', '-C', dir, 'transcript');
    expect(code).toBe(0);
    expect(json).toEqual({
      transcript: 'takes/1/transcript.json',
      language: 'de',
      model: 'small',
      words: [
        { t: 1, end: 1.4, text: 'Das' },
        { t: 1.4, end: 1.8, text: 'ist' },
        { t: 1.8, end: 2.4, text: 'Holofish.' },
        { t: 6, end: 6.5, text: 'Weg' },
      ],
      cues: [{ start: 0.5, end: 2.5, text: 'Das ist Holofish.' }],
    });
    expect((await cli('-C', dir, 'transcript', '--srt')).stdout).toBe('1\n00:00:00,500 --> 00:00:02,500\nDas ist Holofish.\n');
    expect((await cli('-C', dir, 'transcript', '--vtt')).stdout).toBe('WEBVTT\n\n00:00:00.500 --> 00:00:02.500\nDas ist Holofish.\n');
    expect((await cli('-C', dir, 'transcript', '--text')).stdout).toBe('Das ist Holofish. Weg\n');
    expect((await cli('--json', '-C', dir, 'transcript', '--srt')).json).toEqual({ format: 'srt', content: '1\n00:00:00,500 --> 00:00:02,500\nDas ist Holofish.\n' });
    expect((await cli('--json', '-C', dir, 'transcript', '--srt', '--vtt')).json).toEqual({ error: { code: 'usage', message: 'choose one of --srt, --vtt and --text' } });
  });
});

describe('cuttle suggest and recover', () => {
  let fixture: string;
  beforeAll(() => {
```

In `apps/cli/test/electron.check.test.ts`, replace:

```ts
    expect(probe(json.out as string).split(/\r?\n/).slice(0, 2)).toEqual(['h264,1080,1080', 'aac']);
  }, 120_000);

  it('fails on an unknown format before rendering, and on a page that does not exist', () => {
    expect(cuttle('-C', project, 'render', '--format', '4:3').code).toBe(1);
    expect(cuttle('-C', project, 'capture-page', join(project, 'missing.html')).code).toBe(1);
```

with:

```ts
    expect(probe(json.out as string).split(/\r?\n/).slice(0, 2)).toEqual(['h264,1080,1080', 'aac']);
  }, 120_000);

  it('burns the captions in, writes them as SRT and VTT, and leaves them out on --no-captions', () => {
    const file = join(project, 'cuttle.json');
    const before = readFileSync(file, 'utf8');
    const raw = JSON.parse(before) as { sources: Record<string, string> };
    writeFileSync(join(project, 'takes', '1', 'transcript.json'), JSON.stringify({ version: 1, language: 'en', model: 'small', words: [{ t: 0.4, end: 0.8, text: 'Hello' }, { t: 0.8, end: 1.6, text: 'captions.' }] }));
    writeFileSync(file, JSON.stringify({ ...raw, sources: { ...raw.sources, transcript: 'takes/1/transcript.json' } }));
    try {
      const out = join(project, 'out', 'captions.mp4');
      const { code, json } = cuttle('-C', project, 'render', '-o', out, '--srt', '--vtt');
      expect(code).toBe(0);
      expect(json.subtitles).toEqual([join(project, 'out', 'captions.srt'), join(project, 'out', 'captions.vtt')]);
      expect(readFileSync(join(project, 'out', 'captions.srt'), 'utf8')).toBe('1\n00:00:00,400 --> 00:00:02,200\nHello captions.\n');
      expect(readFileSync(join(project, 'out', 'captions.vtt'), 'utf8')).toBe('WEBVTT\n\n00:00:00.400 --> 00:00:02.200\nHello captions.\n');
      // a frame with the caption differs from the same frame without it, at the bottom only
      const frame = (extra: string[]) => {
        const still = cuttle('-C', project, 'preview', '--at', '1', '-o', join(project, `frame-${extra.length}`), ...extra);
        return PNG.sync.read(readFileSync((still.json.stills as { file: string }[])[0]!.file));
      };
      const shown = frame([]);
      writeFileSync(file, JSON.stringify({ ...raw, sources: { ...raw.sources, transcript: 'takes/1/transcript.json' }, captions: { enabled: false } }));
      const hidden = frame(['--sheet']);
      const differs = (top: number, bottom: number) => {
        for (let y = top; y < bottom; y++) for (let x = 0; x < shown.width; x += 4) if (shown.data[(y * shown.width + x) * 4] !== hidden.data[(y * shown.width + x) * 4]) return true;
        return false;
      };
      expect(differs(shown.height - 200, shown.height)).toBe(true);
      expect(differs(0, shown.height / 2)).toBe(false);
      expect(cuttle('-C', project, 'render', '-o', join(project, 'out', 'plain.mp4'), '--no-captions').code).toBe(0);
    } finally {
      writeFileSync(file, before);
    }
  }, 240_000);

  it('fails on an unknown format before rendering, and on a page that does not exist', () => {
    expect(cuttle('-C', project, 'render', '--format', '4:3').code).toBe(1);
    expect(cuttle('-C', project, 'capture-page', join(project, 'missing.html')).code).toBe(1);
```

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts`
Expected: FAIL: `transcript` is an unknown command.

- [ ] **Step 2: The commands**

`apps/cli/src/commands/transcript.ts`:

```ts
import { CoreError, readProjectFile, readTranscript } from '@cuttle/core';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans, toSrt, toVtt } from '@cuttle/timeline';
import type { Output } from '../output';

export interface TranscriptArgs {
  srt?: boolean;
  vtt?: boolean;
  text?: boolean;
}

export interface TranscriptView {
  transcript: string;
  language: string;
  model: string;
  /** Every word the mic said (the fixes applied), in source seconds. */
  words: { t: number; end: number; text: string }[];
  /** The captions as the video shows them: output seconds, the words of cut and sped-up stretches left out. */
  cues: { start: number; end: number; text: string }[];
}

/**
 * `cuttle transcript`: what the mic said, with the person's fixes: as JSON (the words in source
 * seconds and the captions in output seconds), or as SubRip, WebVTT or plain text.
 */
export async function transcriptCommand(projectDir: string, args: TranscriptArgs, output: Output): Promise<TranscriptView | { format: string; content: string }> {
  const formats = [args.srt && 'srt', args.vtt && 'vtt', args.text && 'text'].filter(Boolean);
  if (formats.length > 1) throw new CoreError('usage', 'choose one of --srt, --vtt and --text');
  const file = await readProjectFile(projectDir);
  const { sources, captions, scenes, cuts } = file.project;
  if (sources.transcript === undefined) throw new CoreError('usage', 'the project has no transcript: run "cuttle transcribe" first');
  const { transcript, note } = await readTranscript(file.dir, sources.transcript);
  if (!transcript) throw new CoreError('invalid-project', note ?? `${sources.transcript} cannot be read`);
  const words = applyCaptionFixes(transcript.words, captions.fixes);
  const cues = captionCues(captionWords(words, sceneSpans(scenes, cuts)), 'subtitle');
  const text = words.map((word) => word.text).join(' ');
  const format = formats[0];
  if (format) {
    const content = format === 'srt' ? toSrt(cues) : format === 'vtt' ? toVtt(cues) : `${text}\n`;
    const result = { format, content };
    output.result(result, () => content.replace(/\n$/, ''));
    return result;
  }
  const view: TranscriptView = {
    transcript: sources.transcript,
    language: transcript.language,
    model: transcript.model,
    words,
    cues: cues.map((cue) => ({ start: cue.start, end: cue.end, text: cue.lines.map((line) => line.map((word) => word.text).join(' ')).join('\n') })),
  };
  output.result(view, () => `${text}\n(${words.length} words, ${transcript.language}, ${cues.length} captions in the video)`);
  return view;
}
```

In `apps/cli/src/commands/render.ts`, replace:

```ts
  format?: string;
  out?: string;
  encoder?: string;
}

/** What @cuttle/export's exportProject returns (the CLI does not import the Electron package). */
```

with:

```ts
  format?: string;
  out?: string;
  encoder?: string;
  /** false: no captions burned in, whatever the project says (`--no-captions`). */
  captions?: boolean;
  srt?: boolean;
  vtt?: boolean;
}

/** What @cuttle/export's exportProject returns (the CLI does not import the Electron package). */
```

In the same file, replace:

```ts
  out: string;
  frames: number;
  seconds: number;
  stats: { gpu: string; codec: string; hardwareAcceleration: string; bitrate: number; totalMs: number } & Record<string, unknown>;
}
```

with:

```ts
  out: string;
  frames: number;
  seconds: number;
  /** Subtitle files written next to it (`--srt`, `--vtt`). */
  subtitles?: string[];
  stats: { gpu: string; codec: string; hardwareAcceleration: string; bitrate: number; totalMs: number } & Record<string, unknown>;
}
```

In the same file, replace:

```ts
      out,
      ...(args.format !== undefined && { format: args.format }),
      ...(args.encoder !== undefined && { encoder: args.encoder }),
    },
    signal,
  );
  output.result(result, () => `rendered ${result.out}: ${result.frames} frames, ${result.seconds.toFixed(2)} s, in ${(result.stats.totalMs / 1000).toFixed(1)} s`);
  return result;
}
```

with:

```ts
      out,
      ...(args.format !== undefined && { format: args.format }),
      ...(args.encoder !== undefined && { encoder: args.encoder }),
      ...(args.captions === false && { captions: false }),
      ...((args.srt || args.vtt) && { subtitles: [...(args.srt ? ['srt'] : []), ...(args.vtt ? ['vtt'] : [])] }),
    },
    signal,
  );
  output.result(result, () =>
    [
      `rendered ${result.out}: ${result.frames} frames, ${result.seconds.toFixed(2)} s, in ${(result.stats.totalMs / 1000).toFixed(1)} s`,
      ...(result.subtitles ?? []).map((path) => `subtitles: ${path}`),
    ].join('\n'),
  );
  return result;
}
```

In `apps/cli/src/electron/protocol.ts`, replace:

```ts
// Windows, and the console's Ctrl+C does not reach it). Pure: both sides import it.

export type ElectronRequest = (
  | { command: 'render'; projectDir: string; out: string; format?: string; encoder?: string }
  | { command: 'preview'; projectDir: string; outDir: string; times: number[]; format?: string; sheet?: { columns?: number }; clean?: boolean }
  | { command: 'capture-page'; target: string; out: string; width: number; height: number; fullPage: boolean; waitMs: number }
) & {
```

with:

```ts
// Windows, and the console's Ctrl+C does not reach it). Pure: both sides import it.

export type ElectronRequest = (
  | { command: 'render'; projectDir: string; out: string; format?: string; encoder?: string; captions?: boolean; subtitles?: string[] }
  | { command: 'preview'; projectDir: string; outDir: string; times: number[]; format?: string; sheet?: { columns?: number }; clean?: boolean }
  | { command: 'capture-page'; target: string; out: string; width: number; height: number; fullPage: boolean; waitMs: number }
) & {
```

In `apps/cli/src/electron/main.ts`, replace:

```ts
// channel, which carries the answer back and a cancel in; progress and warnings go to stderr.
// Loaded by bootstrap.ts, which handles uncaught exceptions.
import { app } from 'electron';
import { exportProject, isExportFormat, renderStills, type EncoderPreference, type ExportFormat } from '@cuttle/export';
import { capturePage } from './capture-page';
import { failure, finish } from './finish';
import { decodeRequest, type CancelMessage, type ElectronRequest, type ElectronResponse } from './protocol';
```

with:

```ts
// channel, which carries the answer back and a cancel in; progress and warnings go to stderr.
// Loaded by bootstrap.ts, which handles uncaught exceptions.
import { app } from 'electron';
import { SUBTITLE_FORMATS, exportProject, isExportFormat, renderStills, type EncoderPreference, type ExportFormat, type SubtitleFormat } from '@cuttle/export';
import { capturePage } from './capture-page';
import { failure, finish } from './finish';
import { decodeRequest, type CancelMessage, type ElectronRequest, type ElectronResponse } from './protocol';
```

In the same file, replace:

```ts
  return { format };
}

async function handle(request: ElectronRequest): Promise<unknown> {
  switch (request.command) {
    case 'render':
```

with:

```ts
  return { format };
}

function subtitleFormats(formats: readonly string[]): SubtitleFormat[] {
  const unknown = formats.find((format) => !(SUBTITLE_FORMATS as readonly string[]).includes(format));
  if (unknown !== undefined) throw Object.assign(new Error(`unknown subtitle format "${unknown}" (srt or vtt)`), { code: 'usage' });
  return formats as SubtitleFormat[];
}

async function handle(request: ElectronRequest): Promise<unknown> {
  switch (request.command) {
    case 'render':
```

In the same file, replace:

```ts
        out: request.out,
        ...exportFormat(request.format),
        ...(request.encoder !== undefined && { encoder: request.encoder as EncoderPreference }),
        signal: cancel.signal,
        onProgress: progress('frames', request.quiet),
      });
```

with:

```ts
        out: request.out,
        ...exportFormat(request.format),
        ...(request.encoder !== undefined && { encoder: request.encoder as EncoderPreference }),
        ...(request.captions !== undefined && { captions: request.captions }),
        ...(request.subtitles && { subtitles: subtitleFormats(request.subtitles) }),
        signal: cancel.signal,
        onProgress: progress('frames', request.quiet),
      });
```

In `apps/cli/src/main.ts`, replace:

```ts
import { suggestCommand } from './commands/suggest';
import { modelsDownloadCommand, modelsListCommand, modelsRemoveCommand } from './commands/models';
import { transcribeCommand } from './commands/transcribe';
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';
```

with:

```ts
import { suggestCommand } from './commands/suggest';
import { modelsDownloadCommand, modelsListCommand, modelsRemoveCommand } from './commands/models';
import { transcribeCommand } from './commands/transcribe';
import { transcriptCommand } from './commands/transcript';
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';
```

In the same file, replace:

```ts
    .option('--format <format>', '16:9, 1:1 or 9:16 (default: the project output)')
    .option('-o, --out <file>', 'output file (default: out/<format>.mp4 in the project)')
    .addOption(new Option('--encoder <encoder>', 'H.264 encoder').choices(['auto', 'hardware', 'software']))
    .action(
      action((output, project, options: { format?: string; out?: string; encoder?: string }) =>
        withSignal(output, (signal) => renderCommand(project, options, output, signal)),
      ),
    );

  program
    .command('recover <take>')
    .description('make a take usable after a crash (e.g. takes/3) and use it')
```

with:

```ts
    .option('--format <format>', '16:9, 1:1 or 9:16 (default: the project output)')
    .option('-o, --out <file>', 'output file (default: out/<format>.mp4 in the project)')
    .addOption(new Option('--encoder <encoder>', 'H.264 encoder').choices(['auto', 'hardware', 'software']))
    .option('--no-captions', 'no captions burned in, whatever the project says')
    .option('--srt', 'also write the captions as <name>.srt next to the video')
    .option('--vtt', 'also write the captions as <name>.vtt next to the video')
    .action(
      action((output, project, options: { format?: string; out?: string; encoder?: string; captions: boolean; srt?: boolean; vtt?: boolean }) =>
        withSignal(output, (signal) => renderCommand(project, options, output, signal)),
      ),
    );

  program
    .command('transcript')
    .description('what the mic said (cuttle transcribe), with your fixes: as JSON, or as captions on the video\'s time')
    .option('--srt', 'the captions as SubRip')
    .option('--vtt', 'the captions as WebVTT')
    .option('--text', 'the words as plain text')
    .action(action((output, project, options: { srt?: boolean; vtt?: boolean; text?: boolean }) => transcriptCommand(project, options, output)));

  program
    .command('recover <take>')
    .description('make a take usable after a crash (e.g. takes/3) and use it')
```

- [ ] **Step 3: Run the tests, and the commands in Electron**

Run: `pnpm exec vitest run --project node apps/cli`
Expected: PASS.

Run: `pnpm cli:check`
Expected: PASS, 5 tests. The render with `--srt --vtt` writes both files, and a still differs from one without the subtitles only at the bottom.

- [ ] **Step 4: Commit**

```bash
git add apps/cli
git commit -m "cli: cuttle transcript (JSON, SRT, VTT or text), render --no-captions --srt --vtt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The editor: the Transcript tab, subtitles and the clean voice

**Files:**
- Create: `apps/desktop/src/renderer/editor/Transcript.tsx`
- Modify: `apps/desktop/src/shared/{document,ipc,names,take,media-jobs}.ts`, `apps/desktop/src/main/{export-service,windows,speech}.ts`, `apps/desktop/src/workers/media.ts`, `apps/desktop/src/renderer/editor/{App.tsx,ExportSheet.tsx,Inspector.tsx,Timeline.tsx,editor.css,media.ts,player.ts,session.ts}`, `apps/desktop/test/document.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/test/document.test.ts`, replace:

```ts
    expect(describeChange(project(tagged), project(cut))).toBe('1 cut added');
  });
});
```

with:

```ts
    expect(describeChange(project(tagged), project(cut))).toBe('1 cut added');
  });
});

describe('captions in the document', () => {
  it('sets their fields, and fixes words: a fix takes the place of those it overlaps, and none leaves no list', () => {
    const styled = applyCommand(base, { type: 'captions', field: 'style', value: 'karaoke' }, limits);
    expect(styled.captions).toEqual({ style: 'karaoke' });
    expect(describeChange(project(base), project(styled))).toBe('the subtitles changed');
    const fixed = applyCommand(styled, { type: 'caption-fix', at: 3.1, end: 3.6, text: 'Holofish' }, limits);
    const again = applyCommand(fixed, { type: 'caption-fix', at: 3.4, end: 4, text: 'Holofish App' }, limits);
    expect((again.captions as Raw).fixes).toEqual([{ at: 3.4, end: 4, text: 'Holofish App' }]);
    const both = applyCommand(fixed, { type: 'caption-fix', at: 1, end: 1.2, text: '' }, limits);
    expect((both.captions as Raw).fixes).toEqual([{ at: 1, end: 1.2, text: '' }, { at: 3.1, end: 3.6, text: 'Holofish' }]);
    const undone = applyCommand(fixed, { type: 'caption-fix', at: 3, end: 3.2, text: undefined }, limits);
    expect(undone.captions).toEqual({ style: 'karaoke' });
    expect(() => applyCommand(base, { type: 'caption-fix', at: 2, end: 2, text: 'x' }, limits)).toThrow(DocumentError);
  });

  it('says that a take was transcribed, not that it is another take', () => {
    const transcribed = { ...base, sources: { ...(base.sources as Raw), transcript: 'takes/1/transcript.json' } };
    expect(describeChange(project(base), project(transcribed))).toBe('the take was transcribed');
  });
});
```

Run: `pnpm exec vitest run --project node apps/desktop/test/document.test.ts`
Expected: FAIL: the commands `captions` and `caption-fix` are unknown.

- [ ] **Step 2: The document, the contract and the names**

In `apps/desktop/src/shared/document.ts`, replace:

```ts
// valid values and checked with `parseProject`; a command whose item is gone throws, so a replay
// on a newer version of the file can drop it with a note.
import { newId, parseProject, usedIds, type AutoEdits, type CuttleProject, type IdList } from '@cuttle/project';

export type Raw = Record<string, unknown>;
export type ListName = IdList;
```

with:

```ts
// valid values and checked with `parseProject`; a command whose item is gone throws, so a replay
// on a newer version of the file can drop it with a note.
import { newId, parseProject, usedIds, type AutoEdits, type CuttleProject, type IdList } from '@cuttle/project';
import { takeKey } from './take';

export type Raw = Record<string, unknown>;
export type ListName = IdList;
```

In the same file, replace:

```ts
  | { type: 'output'; width: number; height: number }
  /** Switches a kind of automatic edit on or off (`autoEdits`). */
  | { type: 'auto-edits'; kind: keyof AutoEdits; value: boolean }
  /** Replaces every scene (Show raw take). */
  | { type: 'scenes'; scenes: Item[] };
```

with:

```ts
  | { type: 'output'; width: number; height: number }
  /** Switches a kind of automatic edit on or off (`autoEdits`). */
  | { type: 'auto-edits'; kind: keyof AutoEdits; value: boolean }
  /** Sets a field of the captions (the subtitles from the transcript). */
  | { type: 'captions'; field: 'enabled' | 'style' | 'position' | 'size' | 'color'; value: unknown }
  /** The words spoken in [at, end) read as `text` ("" for none); `undefined` takes the fixes there away. */
  | { type: 'caption-fix'; at: number; end: number; text: string | undefined }
  /** Replaces every scene (Show raw take). */
  | { type: 'scenes'; scenes: Item[] };
```

In the same file, replace:

```ts
      autoEdits[command.kind] = command.value;
      break;
    }
    case 'scenes': {
      next.scenes = structuredClone(command.scenes);
      const ids = ensureIds(next);
```

with:

```ts
      autoEdits[command.kind] = command.value;
      break;
    }
    case 'captions': {
      const captions = (next.captions && typeof next.captions === 'object' ? next.captions : (next.captions = {})) as Item;
      captions[command.field] = structuredClone(command.value);
      break;
    }
    case 'caption-fix': {
      if (!(command.end > command.at)) throw new DocumentError('invalid', 'a fix must end after it starts');
      const captions = (next.captions && typeof next.captions === 'object' ? next.captions : (next.captions = {})) as Item;
      const fixes = (Array.isArray(captions.fixes) ? captions.fixes : []) as { at: number; end: number; text: string }[];
      // a new fix takes the place of the fixes it overlaps
      const kept = fixes.filter((fix) => !(fix.at < command.end && command.at < fix.end));
      if (command.text !== undefined) kept.push({ at: command.at, end: command.end, text: command.text });
      if (kept.length > 0) captions.fixes = kept.sort((a, b) => a.at - b.at);
      else delete captions.fixes;
      break;
    }
    case 'scenes': {
      next.scenes = structuredClone(command.scenes);
      const ids = ensureIds(next);
```

In the same file, replace:

```ts
  if (JSON.stringify(before.look) !== JSON.stringify(after.look)) parts.push('the look changed');
  if (JSON.stringify(before.autoEdits) !== JSON.stringify(after.autoEdits)) parts.push('the automatic edits changed');
  if (JSON.stringify(before.output) !== JSON.stringify(after.output)) parts.push('the output size changed');
  if (JSON.stringify(before.sources) !== JSON.stringify(after.sources)) parts.push('another take');
  return parts;
}
```

with:

```ts
  if (JSON.stringify(before.look) !== JSON.stringify(after.look)) parts.push('the look changed');
  if (JSON.stringify(before.autoEdits) !== JSON.stringify(after.autoEdits)) parts.push('the automatic edits changed');
  if (JSON.stringify(before.output) !== JSON.stringify(after.output)) parts.push('the output size changed');
  if (JSON.stringify(before.captions) !== JSON.stringify(after.captions)) parts.push('the subtitles changed');
  if (takeKey(before.sources) !== takeKey(after.sources)) parts.push('another take');
  else if (before.sources.transcript !== after.sources.transcript) parts.push(after.sources.transcript ? 'the take was transcribed' : 'the transcript was unlinked');
  return parts;
}
```

In `apps/desktop/src/shared/take.ts`, replace:

```ts
/**
 * The take a project's `sources` name, as a key: its tracks, not what was made from them. A
 * transcript linked to the take is not another take (the editor and its media stay).
 */
export function takeKey(sources: unknown): string {
  if (sources === null || typeof sources !== 'object') return JSON.stringify(sources);
  const { transcript: _made, ...tracks } = sources as Record<string, unknown>;
  return JSON.stringify(tracks);
}
```

with:

```ts
/**
 * The take a project's `sources` name, as a key: its tracks, not what was made from them. A
 * transcript or a cleaned-up mic linked to the take is not another take (the editor and its media stay).
 */
export function takeKey(sources: unknown): string {
  if (sources === null || typeof sources !== 'object') return JSON.stringify(sources);
  const { transcript: _made, cleanMic: _cleaned, ...tracks } = sources as Record<string, unknown>;
  return JSON.stringify(tracks);
}
```

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
export const EXPORT_TARGETS = ['project', ...EXPORT_FORMATS] as const;
export type ExportTarget = (typeof EXPORT_TARGETS)[number];
export const ENCODERS = ['auto', 'hardware', 'software'] as const;

/** The origin of the media protocol in an editor window: `cuttle-media://project/<path in the project>`. */
export const MEDIA_ORIGIN = 'cuttle-media://project';
```

with:

```ts
export const EXPORT_TARGETS = ['project', ...EXPORT_FORMATS] as const;
export type ExportTarget = (typeof EXPORT_TARGETS)[number];
export const ENCODERS = ['auto', 'hardware', 'software'] as const;
/** Subtitle files an export can write next to the video (as @cuttle/export's SUBTITLE_FORMATS). */
export const SUBTITLE_FILES = ['srt', 'vtt'] as const;

/** The origin of the media protocol in an editor window: `cuttle-media://project/<path in the project>`. */
export const MEDIA_ORIGIN = 'cuttle-media://project';
```

In the same file, replace:

```ts
  out: string;
  seconds: number;
  bytes: number;
}

export type ExportEnd =
```

with:

```ts
  out: string;
  seconds: number;
  bytes: number;
  /** The subtitle files written next to it. */
  subtitles?: string[];
}

export type ExportEnd =
```

In the same file, replace:

```ts
  'export:start': z.strictObject({
    formats: z.array(z.enum(EXPORT_TARGETS)).min(1).max(4),
    encoder: z.enum(ENCODERS),
  }),
  'export:cancel': z.undefined(),
  // pill
```

with:

```ts
  'export:start': z.strictObject({
    formats: z.array(z.enum(EXPORT_TARGETS)).min(1).max(4),
    encoder: z.enum(ENCODERS),
    /** Burn the subtitles in (default: the project's `captions.enabled`). */
    captions: z.boolean().optional(),
    /** Subtitle files next to each video. */
    subtitles: z.array(z.enum(SUBTITLE_FILES)).max(2).optional(),
  }),
  'export:cancel': z.undefined(),
  // pill
```

In `apps/desktop/src/shared/names.ts`, replace:

```ts
// The project's enum values as people read them in the editor ("mac-dark" is "Mac, dark").
import type {
  BACKGROUND_PRESETS,
  CLICK_EFFECTS,
  CURSOR_STYLES,
  EASES,
```

with:

```ts
// The project's enum values as people read them in the editor ("mac-dark" is "Mac, dark").
import type {
  BACKGROUND_PRESETS,
  CAPTION_STYLES,
  CLICK_EFFECTS,
  CURSOR_STYLES,
  EASES,
```

In the same file, replace:

```ts
};
export const TEXT_STYLE_NAMES: Names<typeof TEXT_STYLES> = { pill: 'Pill', 'lower-third': 'Lower third', caption: 'Caption' };
export const POSITION_NAMES: Names<typeof TEXT_POSITIONS> = { top: 'Top', center: 'Centre', bottom: 'Bottom' };
export const MOTION_NAMES: Names<typeof STILL_MOTIONS> = { none: 'None', kenburns: 'Ken Burns', scroll: 'Scroll' };
export const EASE_NAMES: Names<typeof EASES> = { smooth: 'Smooth', linear: 'Linear' };
export const MASK_STYLE_NAMES: Names<typeof MASK_STYLES> = { fill: 'Fill', blur: 'Blur' };
```

with:

```ts
};
export const TEXT_STYLE_NAMES: Names<typeof TEXT_STYLES> = { pill: 'Pill', 'lower-third': 'Lower third', caption: 'Caption' };
export const POSITION_NAMES: Names<typeof TEXT_POSITIONS> = { top: 'Top', center: 'Centre', bottom: 'Bottom' };
export const CAPTION_STYLE_NAMES: Names<typeof CAPTION_STYLES> = { subtitle: 'Subtitle', karaoke: 'Karaoke', bold: 'Bold' };
export const MOTION_NAMES: Names<typeof STILL_MOTIONS> = { none: 'None', kenburns: 'Ken Burns', scroll: 'Scroll' };
export const EASE_NAMES: Names<typeof EASES> = { smooth: 'Smooth', linear: 'Linear' };
export const MASK_STYLE_NAMES: Names<typeof MASK_STYLES> = { fill: 'Fill', blur: 'Blur' };
```

- [ ] **Step 3: The export and the speech step in the main process**

In `apps/desktop/src/main/export-service.ts`, replace:

```ts
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { exportProject, ExportError, type EncoderPreference } from '@cuttle/export';
import type { ExportEnd, ExportFile, ExportProgress, ExportTarget } from '../shared/ipc';
import { bundlePath } from './protocols';

type Format = ExportTarget;

/** The file a format is exported to, inside the project's `out/`, named as the CLI names it (`export.mp4` for the project's own size). */
export function exportPath(projectDir: string, format: Format): string {
  return join(projectDir, 'out', `${format === 'project' ? 'export' : format.replace(':', 'x')}.mp4`);
```

with:

```ts
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { exportProject, ExportError, type EncoderPreference } from '@cuttle/export';
import type { ExportEnd, ExportFile, ExportProgress, ExportTarget, SUBTITLE_FILES } from '../shared/ipc';
import { bundlePath } from './protocols';

type Format = ExportTarget;

/** How a run exports: the encoder, whether the subtitles are burned in, and the subtitle files beside each video. */
export interface ExportSettings {
  encoder: EncoderPreference;
  captions?: boolean;
  subtitles?: readonly (typeof SUBTITLE_FILES)[number][];
}

/** The file a format is exported to, inside the project's `out/`, named as the CLI names it (`export.mp4` for the project's own size). */
export function exportPath(projectDir: string, format: Format): string {
  return join(projectDir, 'out', `${format === 'project' ? 'export' : format.replace(':', 'x')}.mp4`);
```

In the same file, replace:

```ts
  private readonly controller = new AbortController();
  readonly done: Promise<ExportEnd>;

  constructor(projectDir: string, formats: readonly Format[], encoder: EncoderPreference, onProgress: (progress: ExportProgress) => void) {
    this.done = this.run(projectDir, formats, encoder, onProgress);
  }

  private async run(projectDir: string, formats: readonly Format[], encoder: EncoderPreference, onProgress: (progress: ExportProgress) => void): Promise<ExportEnd> {
    const files: ExportFile[] = [];
    const started = Date.now();
    for (const [position, format] of formats.entries()) {
```

with:

```ts
  private readonly controller = new AbortController();
  readonly done: Promise<ExportEnd>;

  constructor(projectDir: string, formats: readonly Format[], settings: ExportSettings, onProgress: (progress: ExportProgress) => void) {
    this.done = this.run(projectDir, formats, settings, onProgress);
  }

  private async run(projectDir: string, formats: readonly Format[], settings: ExportSettings, onProgress: (progress: ExportProgress) => void): Promise<ExportEnd> {
    const files: ExportFile[] = [];
    const started = Date.now();
    for (const [position, format] of formats.entries()) {
```

In the same file, replace:

```ts
          projectDir,
          ...(format !== 'project' && { format }),
          out,
          encoder,
          pageDir: bundlePath('main', 'export-page'),
          signal: this.controller.signal,
          onProgress: (done, total) => {
```

with:

```ts
          projectDir,
          ...(format !== 'project' && { format }),
          out,
          encoder: settings.encoder,
          ...(settings.captions !== undefined && { captions: settings.captions }),
          ...(settings.subtitles && settings.subtitles.length > 0 && { subtitles: settings.subtitles }),
          pageDir: bundlePath('main', 'export-page'),
          signal: this.controller.signal,
          onProgress: (done, total) => {
```

In the same file, replace:

```ts
            onProgress({ format, position, formats: formats.length, done, total, elapsed: (now - started) / 1000 });
          },
        });
        files.push({ format, out: result.out, seconds: result.seconds, bytes: (await stat(result.out)).size });
      } catch (error) {
        if (error instanceof ExportError && error.code === 'cancelled') return { state: 'cancelled', files };
        const code = error instanceof ExportError ? error.code : 'internal';
```

with:

```ts
            onProgress({ format, position, formats: formats.length, done, total, elapsed: (now - started) / 1000 });
          },
        });
        files.push({ format, out: result.out, seconds: result.seconds, bytes: (await stat(result.out)).size, ...(result.subtitles && { subtitles: result.subtitles }) });
      } catch (error) {
        if (error instanceof ExportError && error.code === 'cancelled') return { state: 'cancelled', files };
        const code = error instanceof ExportError ? error.code : 'internal';
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
          return { format, out, ...(info?.isFile() && { modified: info.mtimeMs }) };
        }),
      ),
    'export:start': ({ formats, encoder }) => {
      if (editor.run) throw new Error('an export is already running');
      const run = new ExportRun(dir, formats, encoder, (progress) => send(contents, 'export:progress', progress));
      editor.run = run;
      void run.done.then((end: ExportEnd) => {
        editor.run = undefined;
```

with:

```ts
          return { format, out, ...(info?.isFile() && { modified: info.mtimeMs }) };
        }),
      ),
    'export:start': ({ formats, encoder, captions, subtitles }) => {
      if (editor.run) throw new Error('an export is already running');
      const settings = { encoder, ...(captions !== undefined && { captions }), ...(subtitles && { subtitles }) };
      const run = new ExportRun(dir, formats, settings, (progress) => send(contents, 'export:progress', progress));
      editor.run = run;
      void run.done.then((end: ExportEnd) => {
        editor.run = undefined;
```

In `apps/desktop/src/shared/media-jobs.ts`, replace:

```ts
  language: string;
}

/** Links `transcript` and cuts the filler words and pauses of a project (`input`: its folder), in one write. */
export interface SpeechEditsJob {
  job: 'speech-edits';
  input: string;
  output: string;
  transcript: string;
}

export type MediaJob = ProxyJob | ThumbnailsJob | PeaksJob | SuggestJob | TranscribeJob | SpeechEditsJob;
```

with:

```ts
  language: string;
}

/** Links `transcript` (and `cleanMic`) and cuts the filler words and pauses of a project (`input`: its folder), in one write. */
export interface SpeechEditsJob {
  job: 'speech-edits';
  input: string;
  output: string;
  transcript: string;
  cleanMic?: string;
}

export type MediaJob = ProxyJob | ThumbnailsJob | PeaksJob | SuggestJob | TranscribeJob | SpeechEditsJob;
```

In `apps/desktop/src/workers/media.ts`, replace:

```ts
      return undefined;
    }
    case 'speech-edits': {
      await applySpeechEdits(job.input, { link: job.transcript });
      return undefined;
    }
    case 'peaks': {
```

with:

```ts
      return undefined;
    }
    case 'speech-edits': {
      await applySpeechEdits(job.input, { link: job.transcript, ...(job.cleanMic && { cleanMic: job.cleanMic }) });
      return undefined;
    }
    case 'peaks': {
```

In `apps/desktop/src/main/speech.ts`, replace:

```ts
// Speech in the app: the models (download with progress and cancel, remove), and transcribing a
// take after its cut, in the media worker, then its filler words and pauses cut as one change.
import { dirname, join, relative, resolve, sep } from 'node:path';
import { CoreError, SPEECH_MODELS, TRANSCRIPT_FILE, downloadModel, hasWhisper, installedModels, modelInstalled, modelsDir, readProjectFile, removeModel } from '@cuttle/core';
import type { SpeechModelName, SpeechStatus } from '../shared/ipc';
import { mediaWorker } from './media-service';
import { loadSettings } from './settings';
```

with:

```ts
// Speech in the app: the models (download with progress and cancel, remove), and transcribing a
// take after its cut, in the media worker, then its filler words and pauses cut as one change.
import { dirname, join, relative, resolve, sep } from 'node:path';
import { CLEAN_MIC_FILE, CoreError, SPEECH_MODELS, TRANSCRIPT_FILE, downloadModel, hasWhisper, installedModels, modelInstalled, modelsDir, readProjectFile, removeModel } from '@cuttle/core';
import type { SpeechModelName, SpeechStatus } from '../shared/ipc';
import { mediaWorker } from './media-service';
import { loadSettings } from './settings';
```

In the same file, replace:

```ts
    try {
      await status(0);
      await mediaWorker.run({ job: 'transcribe', input: dir, output: '', model: model.name, language: speech.language }, (progress) => void status(progress)).promise;
      const transcript = relative(file.dir, join(dirname(resolve(file.dir, mic)), TRANSCRIPT_FILE)).split(sep).join('/');
      await setEditorStatus(dir, { text: 'Cutting filler words and pauses…', state: 'working' });
      await expectSpeech(dir, true);
      try {
        await mediaWorker.run({ job: 'speech-edits', input: dir, output: '', transcript }, () => {}).promise;
      } catch (error) {
        // nothing was written: the next outside change is someone else's
        await expectSpeech(dir, false);
```

with:

```ts
    try {
      await status(0);
      await mediaWorker.run({ job: 'transcribe', input: dir, output: '', model: model.name, language: speech.language }, (progress) => void status(progress)).promise;
      const take = (name: string) => relative(file.dir, join(dirname(resolve(file.dir, mic)), name)).split(sep).join('/');
      const transcript = take(TRANSCRIPT_FILE);
      await setEditorStatus(dir, { text: 'Cutting filler words and pauses…', state: 'working' });
      await expectSpeech(dir, true);
      try {
        await mediaWorker.run({ job: 'speech-edits', input: dir, output: '', transcript, cleanMic: take(CLEAN_MIC_FILE) }, () => {}).promise;
      } catch (error) {
        // nothing was written: the next outside change is someone else's
        await expectSpeech(dir, false);
```

- [ ] **Step 4: The transcript and the clean voice in the editor's media and player**

In `apps/desktop/src/renderer/editor/media.ts`, replace:

```ts
// The project's media in the editor, read through the cuttle-media protocol (Range requests).
import { ALL_FORMATS, Input, UrlSource, type InputAudioTrack, type InputVideoTrack, type VideoSinkDecoderOptions } from 'mediabunny';
import { createCursorTrack, type CursorTrack } from '@cuttle/timeline';
import { parseEventsJsonl, parseMarkersJson, parseProject, type CuttleProject, type InputEvent, type Marker } from '@cuttle/project';
import { plainIssue } from '../../shared/format';
import { MEDIA_ORIGIN, type ProjectInfo } from '../../shared/ipc';
```

with:

```ts
// The project's media in the editor, read through the cuttle-media protocol (Range requests).
import { ALL_FORMATS, Input, UrlSource, type InputAudioTrack, type InputVideoTrack, type VideoSinkDecoderOptions } from 'mediabunny';
import { createCursorTrack, type CursorTrack } from '@cuttle/timeline';
import { parseEventsJsonl, parseMarkersJson, parseProject, parseTranscriptJson, type CuttleProject, type InputEvent, type Marker, type TranscriptFile } from '@cuttle/project';
import { plainIssue } from '../../shared/format';
import { MEDIA_ORIGIN, type ProjectInfo } from '../../shared/ipc';
```

In the same file, replace:

```ts
  screen: VideoSource;
  webcam?: VideoSource & { offset: number };
  mic?: AudioSource;
  events: InputEvent[];
  /** The pointer's track from the input events (drawn when the look's cursor is on). */
  cursor?: CursorTrack;
  markers: Marker[];
  /** Still images by their project path. */
  stills: Map<string, ImageBitmap>;
  backgroundImage?: ImageBitmap;
```

with:

```ts
  screen: VideoSource;
  webcam?: VideoSource & { offset: number };
  mic?: AudioSource;
  /** The file `mic` was opened from: the mic, or its cleaned-up copy (`look.audio.cleanup`). */
  micPath?: string;
  events: InputEvent[];
  /** The pointer's track from the input events (drawn when the look's cursor is on). */
  cursor?: CursorTrack;
  markers: Marker[];
  /** What the mic said (`sources.transcript`), and the path it was read from: it can be linked after the editor opened. */
  transcript?: TranscriptFile;
  transcriptPath?: string;
  /** Still images by their project path. */
  stills: Map<string, ImageBitmap>;
  backgroundImage?: ImageBitmap;
```

In the same file, replace:

```ts
export async function ensureMedia(media: EditorMedia, project: CuttleProject): Promise<boolean> {
  const { sources, look } = project;
  let added = false;
  for (const scene of project.scenes) {
    if (scene.type !== 'still' || media.stills.has(scene.image)) continue;
    media.stills.set(scene.image, (await optional(media, scene.image, () => loadImage(scene.image, MAX_IMAGE, 'The image of a page'))) ?? (await placeholder(scene.image)));
```

with:

```ts
export async function ensureMedia(media: EditorMedia, project: CuttleProject): Promise<boolean> {
  const { sources, look } = project;
  let added = false;
  if (sources.transcript !== media.transcriptPath) {
    // the speech edits link the transcript once it is there; Undo can take it away again
    media.transcriptPath = sources.transcript;
    delete media.transcript;
    if (sources.transcript) {
      const path = sources.transcript;
      const text = await optional(media, path, async () => {
        const found = await fetchText(path);
        if (found === undefined) throw new MediaError(`${path} cannot be read: no subtitles.`);
        return found;
      });
      const parsed = text === undefined ? undefined : parseTranscriptJson(text);
      if (parsed?.ok) media.transcript = parsed.transcript;
      else if (parsed) media.warnings.push(`${path} is invalid: no subtitles.`);
    }
    added = true;
  }
  for (const scene of project.scenes) {
    if (scene.type !== 'still' || media.stills.has(scene.image)) continue;
    media.stills.set(scene.image, (await optional(media, scene.image, () => loadImage(scene.image, MAX_IMAGE, 'The image of a page'))) ?? (await placeholder(scene.image)));
```

In the same file, replace:

```ts
      added = true;
    }
  }
  if (sources.mic && look.audio.enabled && !media.mic) {
    const mic = await optional(media, sources.mic, async () => {
      const audio = await openAudio(sources.mic!, media.offsets.mic);
      if (audio) return audio;
      throw (await present(sources.mic!)) ? new MediaError(`The mic recording (${sources.mic}) cannot be played.`) : missing(sources.mic!);
    });
    if (mic) {
      media.mic = mic;
      added = true;
    }
  }
```

with:

```ts
      added = true;
    }
  }
  // the cleaned-up mic plays in the mic's place when the look asks for it and there is one
  const micPath = sources.mic && (look.audio.cleanup && sources.cleanMic ? sources.cleanMic : sources.mic);
  if (micPath && look.audio.enabled && media.micPath !== micPath) {
    const mic = await optional(media, micPath, async () => {
      const audio = await openAudio(micPath, media.offsets.mic);
      if (audio) return audio;
      throw (await present(micPath)) ? new MediaError(`The mic recording (${micPath}) cannot be played.`) : missing(micPath);
    });
    if (mic) {
      media.mic = mic;
      media.micPath = micPath;
      added = true;
    }
  }
```

In `apps/desktop/src/renderer/editor/player.ts`, replace:

```ts
  }

  private makeTimeline(): Timeline {
    return createTimeline(this.project, { screenSize: this.media.screen.size, ...(this.media.cursor && { cursor: this.media.cursor }) });
  }

  private makeRenderer(): Renderer {
```

with:

```ts
  }

  private makeTimeline(): Timeline {
    return createTimeline(this.project, {
      screenSize: this.media.screen.size,
      ...(this.media.cursor && { cursor: this.media.cursor }),
      ...(this.media.transcript && { transcript: this.media.transcript.words }),
    });
  }

  private makeRenderer(): Renderer {
```

In `apps/desktop/src/renderer/editor/session.ts`, replace:

```ts
  player: PlayerState;
  selection?: Selection;
  tool: Tool;
  tab: 'selection' | 'auto' | 'look';
  /** Snapping on the timeline (Ctrl while dragging turns it off for that drag). */
  snap: boolean;
  mediaState: MediaState;
```

with:

```ts
  player: PlayerState;
  selection?: Selection;
  tool: Tool;
  tab: 'selection' | 'auto' | 'transcript' | 'look';
  /** Ctrl+F asked for the Transcript tab's find field (a new number each time). */
  findRequest?: number;
  /** Snapping on the timeline (Ctrl while dragging turns it off for that drag). */
  snap: boolean;
  mediaState: MediaState;
```

In the same file, replace:

```ts
}

/** Exports what is saved: every edit is written first (the export reads the file). */
export async function startExport(formats: ExportTarget[], encoder: 'auto' | 'hardware' | 'software'): Promise<void> {
  store.set({ exporting: true, exportEnd: undefined, exportProgress: undefined, exportStarted: Date.now() });
  try {
    if (!(await flush())) throw new Error(`your latest edits are not saved (${store.get().doc?.problem ?? 'cuttle.json has a mistake'}), so the export would not have them. Save them first (Try again in the title bar).`);
    await bridge.invoke('export:start', { formats, encoder });
  } catch (error) {
    store.set({ exporting: false, exportEnd: { state: 'failed', files: [], format: formats[0]!, code: 'internal', message: (error as Error).message } });
  }
```

with:

```ts
}

/** Exports what is saved: every edit is written first (the export reads the file). */
export async function startExport(
  formats: ExportTarget[],
  encoder: 'auto' | 'hardware' | 'software',
  subtitles: { captions?: boolean; files?: ('srt' | 'vtt')[] } = {},
): Promise<void> {
  store.set({ exporting: true, exportEnd: undefined, exportProgress: undefined, exportStarted: Date.now() });
  try {
    if (!(await flush())) throw new Error(`your latest edits are not saved (${store.get().doc?.problem ?? 'cuttle.json has a mistake'}), so the export would not have them. Save them first (Try again in the title bar).`);
    await bridge.invoke('export:start', {
      formats,
      encoder,
      ...(subtitles.captions !== undefined && { captions: subtitles.captions }),
      ...(subtitles.files && subtitles.files.length > 0 && { subtitles: subtitles.files }),
    });
  } catch (error) {
    store.set({ exporting: false, exportEnd: { state: 'failed', files: [], format: formats[0]!, code: 'internal', message: (error as Error).message } });
  }
```

- [ ] **Step 5: The Transcript tab**

`apps/desktop/src/renderer/editor/Transcript.tsx`:

```
// The Transcript tab: what the mic said, in paragraphs. The word being played is lit; a click goes
// there, a double click fixes its text (the subtitles follow), selected words are cut out of the
// video with Delete and come back with Restore; filler words are faint; Ctrl+F finds a word.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { likelyFiller, normWord, type CuttleProject, type TranscriptFile } from '@cuttle/project';
import { applyCaptionFixes, sceneSpans, type SceneSpan } from '@cuttle/timeline';
import type { Command } from '../../shared/document';
import { formatTime } from '../../shared/format';
import { outputTimesOf } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { edit } from './doc';
import { currentPlayer, store } from './session';
import { useStore } from './store';

/** Where a word is: shown at 1×, in a sped-up clip, taken out by a cut, or outside every clip. */
type WordState = 'shown' | 'fast' | 'cut' | 'out';

interface Word {
  t: number;
  end: number;
  text: string;
  state: WordState;
  filler: boolean;
  /** The text comes from a fix the person made. */
  fixed: boolean;
}

/** A gap this long (source seconds), or a sentence's end and half of it, starts a paragraph. */
const PARAGRAPH_GAP = 1.2;
/** Kept on both sides of words cut out, up to the words around them. */
const CUT_PAD = 0.05;

function wordsOf(transcript: TranscriptFile, project: CuttleProject): Word[] {
  const { fixes } = project.captions;
  return applyCaptionFixes(transcript.words, fixes).map((word) => {
    const clip = project.scenes.find((scene) => scene.type === 'clip' && word.t >= scene.from && word.t < scene.to);
    const cut = project.cuts.some((range) => range.enabled && word.t >= range.from && word.t < range.to);
    const state: WordState = !clip ? 'out' : cut ? 'cut' : clip.type === 'clip' && clip.speed > 1 ? 'fast' : 'shown';
    const fixed = fixes.some((fix) => fix.at === word.t && fix.end === word.end);
    return { ...word, state, filler: likelyFiller(word.text, transcript.language), fixed };
  });
}

function paragraphsOf(words: readonly Word[]): number[][] {
  const paragraphs: number[][] = [];
  words.forEach((word, i) => {
    const before = words[i - 1];
    const gap = before ? word.t - before.end : Infinity;
    if (!before || gap >= PARAGRAPH_GAP || (/[.!?…]["')\]]*$/.test(before.text) && gap >= PARAGRAPH_GAP / 2)) paragraphs.push([]);
    paragraphs.at(-1)!.push(i);
  });
  return paragraphs;
}

const TITLES: Record<WordState, string> = {
  shown: 'Click to go there, double-click to fix the word',
  fast: 'In a sped-up clip: it has no subtitle',
  cut: 'Cut from the video: select it and Restore',
  out: 'Outside every clip: lengthen a clip on the timeline to bring it back',
};

export function TranscriptPanel() {
  const project = useStore(store, (state) => state.doc?.project);
  const transcript = useStore(store, (state) => state.media?.transcript);
  const source = useStore(store, (state) => state.player.source);
  const findRequest = useStore(store, (state) => state.findRequest);
  const [selection, setSelection] = useState<{ anchor: number; focus: number }>();
  const [editing, setEditing] = useState<number>();
  const [query, setQuery] = useState('');
  const find = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const words = useMemo(() => (transcript && project ? wordsOf(transcript, project) : []), [transcript, project]);
  const paragraphs = useMemo(() => paragraphsOf(words), [words]);
  const spans = useMemo<SceneSpan[]>(() => (project ? sceneSpans(project.scenes, project.cuts) : []), [project]);

  useEffect(() => {
    if (findRequest === undefined) return;
    find.current?.focus();
    find.current?.select();
  }, [findRequest]);
  // the spoken word: the last one that started at the source second shown
  const spoken = source === undefined ? -1 : words.findLastIndex((word) => word.t <= source && source < word.end + 0.3);
  useEffect(() => {
    if (spoken >= 0) list.current?.querySelector(`[data-index="${spoken}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [spoken]);

  if (!project) return null;
  if (!transcript) return <SpeechNote />;
  if (words.length === 0) return <p className="hint">The mic was transcribed, but no words were heard.</p>;

  const [from, to] = selection ? [Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus)] : [-1, -2];
  const chosen = selection ? words.slice(from, to + 1) : [];
  const matches = query.trim() ? words.flatMap((word, i) => (normWord(word.text).includes(normWord(query)) ? [i] : [])) : [];
  const seekTo = (word: Word) => {
    const at = outputTimesOf(spans, word.t)[0];
    if (at !== undefined) void currentPlayer()?.seek(at);
  };
  const pick = (index: number, event: MouseEvent) => {
    setEditing(undefined);
    setSelection(event.shiftKey && selection ? { anchor: selection.anchor, focus: index } : { anchor: index, focus: index });
    if (!event.shiftKey) seekTo(words[index]!);
  };
  const quoted = (items: readonly Word[]) => {
    const text = items.map((word) => word.text).join(' ');
    return text.length > 40 ? `${text.slice(0, 39).trimEnd()}…` : text;
  };
  /** Cuts the selected words out of the video: one cut, padded up to the words around them. */
  const cutOut = () => {
    if (chosen.length === 0) return;
    const before = words[from - 1];
    const after = words[to + 1];
    const start = Math.max(before ? before.end : 0, chosen[0]!.t - CUT_PAD);
    const end = Math.min(after ? after.t : Infinity, chosen.at(-1)!.end + CUT_PAD);
    edit([{ type: 'add', list: 'cuts', item: { label: `Words: “${quoted(chosen)}”`, from: round(start), to: round(end) } }], 'Cut words');
  };
  /** Brings the selected words back: cuts made by hand over them go, automatic ones are switched off. */
  const restore = () => {
    const first = chosen[0];
    const last = chosen.at(-1);
    if (!first || !last) return;
    const over = project.cuts.filter((cut) => cut.enabled && cut.id && cut.from < last.end && first.t < cut.to);
    const commands: Command[] = over.map((cut) => (cut.auto ? { type: 'set', list: 'cuts', id: cut.id!, fields: { enabled: false } } : { type: 'delete', list: 'cuts', id: cut.id! }));
    if (commands.length > 0) edit(commands, 'Restore words');
  };
  const fix = (index: number, text: string) => {
    const word = words[index]!;
    setEditing(undefined);
    if (text.trim() === word.text) return;
    edit([{ type: 'caption-fix', at: word.t, end: word.end, text: text.trim() }], `Fix “${quoted([word])}”`);
  };
  const unfix = (word: Word) => edit([{ type: 'caption-fix', at: word.t, end: word.end, text: undefined }], `Unfix “${quoted([word])}”`);
  const canCut = chosen.length > 0 && chosen.some((word) => word.state === 'shown' || word.state === 'fast');
  const canRestore = chosen.some((word) => word.state === 'cut');
  const onKey = (event: KeyboardEvent) => {
    if (editing !== undefined || chosen.length === 0) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      // the words, not the timeline's selection
      event.preventDefault();
      event.stopPropagation();
      if (canCut) cutOut();
      else if (canRestore) restore();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setSelection(undefined);
    } else if (event.key === 'Enter' && chosen.length === 1) {
      event.preventDefault();
      setEditing(from);
    }
  };
  const next = (step: 1 | -1) => {
    if (matches.length === 0) return;
    const current = selection ? from : -1;
    const index = step === 1 ? (matches.find((i) => i > current) ?? matches[0]!) : (matches.findLast((i) => i < current) ?? matches.at(-1)!);
    setSelection({ anchor: index, focus: index });
    seekTo(words[index]!);
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'center' });
  };

  return (
    <div className="transcript" data-testid="transcript">
      <div className="transcript-find">
        <input
          ref={find}
          type="search"
          value={query}
          placeholder="Find a word (Ctrl+F)"
          aria-label="Find a word"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              next(event.shiftKey ? -1 : 1);
            } else if (event.key === 'Escape') {
              event.stopPropagation();
              setQuery('');
              event.currentTarget.blur();
            }
          }}
          data-testid="transcript-find"
        />
        {query.trim() && <span className="transcript-count">{matches.length === 0 ? 'none' : `${matches.length} found`}</span>}
      </div>
      <p className="hint transcript-meta">
        {words.length} words · {transcript.language === 'auto' ? 'language not told' : transcript.language === 'de' ? 'German' : transcript.language === 'en' ? 'English' : transcript.language} · {transcript.model} model
      </p>
      <div className="transcript-words" ref={list} tabIndex={0} onKeyDown={onKey} role="listbox" aria-multiselectable="true" aria-label="Transcript">
        {paragraphs.map((paragraph) => (
          <p key={paragraph[0]}>
            <span className="transcript-time">{formatTime(outputTimesOf(spans, words[paragraph[0]!]!.t)[0] ?? words[paragraph[0]!]!.t)}</span>
            {paragraph.map((index) => {
              const word = words[index]!;
              if (editing === index) {
                return <WordField key={index} initial={word.text} onDone={(text) => (text === undefined ? setEditing(undefined) : fix(index, text))} />;
              }
              const classes = [
                'word',
                word.state,
                word.filler && 'filler',
                word.fixed && 'fixed',
                index === spoken && 'spoken',
                index >= from && index <= to && 'selected',
                matches.includes(index) && 'match',
              ].filter(Boolean);
              return (
                <span
                  key={index}
                  data-index={index}
                  role="option"
                  aria-selected={index >= from && index <= to}
                  className={classes.join(' ')}
                  title={word.fixed ? `Fixed; heard as said in the take. ${TITLES[word.state]}` : TITLES[word.state]}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    list.current?.focus();
                    pick(index, event);
                  }}
                  onDoubleClick={() => word.state !== 'out' && setEditing(index)}
                >
                  {word.text || '·'}{' '}
                </span>
              );
            })}
          </p>
        ))}
      </div>
      {chosen.length > 0 && (
        <div className="transcript-actions" data-testid="transcript-actions">
          <span className="hint">
            {chosen.length === 1 ? `“${quoted(chosen)}”` : `${chosen.length} words`} · {formatTime(chosen[0]!.t)}
          </span>
          {canCut && (
            <button type="button" className="ghost small" onClick={cutOut} data-testid="transcript-cut">
              Cut out
            </button>
          )}
          {canRestore && (
            <button type="button" className="ghost small" onClick={restore} data-testid="transcript-restore">
              Restore
            </button>
          )}
          {chosen.length === 1 && chosen[0]!.fixed && (
            <button type="button" className="ghost small" onClick={() => unfix(chosen[0]!)} data-testid="transcript-unfix">
              Undo fix
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** The text of a word being fixed: Enter keeps it, Esc goes back. */
function WordField({ initial, onDone }: { initial: string; onDone: (text: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const ended = useRef(false);
  useEffect(() => input.current?.select(), []);
  const end = (text: string | undefined) => {
    if (ended.current) return;
    ended.current = true;
    onDone(text);
  };
  return (
    <input
      ref={input}
      className="word-field"
      defaultValue={initial}
      aria-label="The word's text"
      size={Math.max(4, initial.length + 1)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') end(event.currentTarget.value);
        if (event.key === 'Escape') end(undefined);
      }}
      onBlur={(event) => end(event.currentTarget.value)}
      data-testid="word-field"
    />
  );
}

/**
 * A take whose mic is not transcribed: what transcribing adds, and Transcribe. When it cannot run
 * (speech off, no model, an old ffmpeg), why, with the way to the settings.
 */
export function SpeechNote() {
  const sources = useStore(store, (state) => state.doc?.project.sources);
  const working = useStore(store, (state) => state.status?.state === 'working');
  const [problem, setProblem] = useState<{ text: string; settings?: boolean }>();
  if (!sources?.mic || sources.transcript) return null;
  const transcribe = async () => {
    const answer = await bridge.invoke('project:transcribe');
    setProblem('problem' in answer ? { text: answer.problem, ...(answer.settings && { settings: true }) } : undefined);
  };
  return (
    <div className="speech-note" data-testid="speech-note">
      <p>
        <b>The mic is not transcribed.</b> Once it is, Cuttle cuts filler words and pauses where the picture rests, and the video gets subtitles.
      </p>
      {problem && (
        <p className="speech-problem" role="alert" data-testid="speech-problem">
          {problem.text}
        </p>
      )}
      <div className="speech-actions">
        <button type="button" className="ghost small" disabled={working} onClick={() => void transcribe()} data-testid="transcribe">
          {working ? 'Busy…' : 'Transcribe'}
        </button>
        {problem?.settings && (
          <button type="button" className="ghost small" onClick={() => void bridge.invoke('app:settings')} data-testid="speech-settings">
            Settings
          </button>
        )}
      </div>
    </div>
  );
}
```

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import {
  BACKGROUND_PRESETS,
  CLICK_EFFECTS,
  CURSOR_STYLES,
  EASES,
```

with:

```
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import {
  BACKGROUND_PRESETS,
  CAPTION_STYLES,
  CLICK_EFFECTS,
  CURSOR_STYLES,
  EASES,
```

In the same file, replace:

```
import { formatDuration, formatSource, formatSpeed, formatTime } from '../../shared/format';
import {
  BACKGROUND_NAMES,
  CLICK_NAMES,
  CORNER_NAMES,
  CURSOR_NAMES,
```

with:

```
import { formatDuration, formatSource, formatSpeed, formatTime } from '../../shared/format';
import {
  BACKGROUND_NAMES,
  CAPTION_STYLE_NAMES,
  CLICK_NAMES,
  CORNER_NAMES,
  CURSOR_NAMES,
```

In the same file, replace:

```
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { outputTimesOf } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { CardIcon, ChevronIcon, CopyIcon, CropIcon, FilmIcon, MaskIcon, PageIcon, SplitIcon, TextIcon, TrashIcon, ZoomIcon } from '../icons';
import { Select as StyledSelect } from '../Select';
import { chooseImage, cutShownAt, deleteSelection, duplicateSelection, LIST_OF, playheadPlace, reveal, SPEEDS } from './actions';
```

with:

```
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { outputTimesOf } from '../../shared/timeline-model';
import { CardIcon, ChevronIcon, CopyIcon, CropIcon, FilmIcon, MaskIcon, PageIcon, SplitIcon, TextIcon, TrashIcon, ZoomIcon } from '../icons';
import { Select as StyledSelect } from '../Select';
import { chooseImage, cutShownAt, deleteSelection, duplicateSelection, LIST_OF, playheadPlace, reveal, SPEEDS } from './actions';
```

In the same file, replace:

```
import { currentPlayer, engineAssets, select, setTool, store, type Selection, type Tool } from './session';
import { isColoured, swatch, type SwatchKey } from './swatches';
import { useStore } from './store';

const TABS = [
  { id: 'selection', name: 'Selection' },
  { id: 'auto', name: 'Auto' },
  { id: 'look', name: 'Look' },
] as const;
```

with:

```
import { currentPlayer, engineAssets, select, setTool, store, type Selection, type Tool } from './session';
import { isColoured, swatch, type SwatchKey } from './swatches';
import { useStore } from './store';
import { SpeechNote, TranscriptPanel } from './Transcript';

const TABS = [
  { id: 'selection', name: 'Selection' },
  { id: 'auto', name: 'Auto' },
  { id: 'transcript', name: 'Transcript' },
  { id: 'look', name: 'Look' },
] as const;
```

In the same file, replace:

```
      </div>
      <div className="panel-body" id="inspector-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <fieldset className="panel-fields" disabled={broken}>
          {tab === 'selection' ? <SelectionPanel /> : tab === 'auto' ? <AutoPanel /> : <LookPanel />}
        </fieldset>
      </div>
    </aside>
```

with:

```
      </div>
      <div className="panel-body" id="inspector-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <fieldset className="panel-fields" disabled={broken}>
          {tab === 'selection' ? <SelectionPanel /> : tab === 'auto' ? <AutoPanel /> : tab === 'transcript' ? <TranscriptPanel /> : <LookPanel />}
        </fieldset>
      </div>
    </aside>
```

In the same file, replace:

```
      <span className="field-label">{label}</span>
      <span className="field-input">
        {children}
        {note !== undefined && <em>{note}</em>}
      </span>
    </Tag>
  );
```

with:

```
      <span className="field-label">{label}</span>
      <span className="field-input">
        {children}
        {note !== undefined && <em title={typeof note === 'string' ? note : undefined}>{note}</em>}
      </span>
    </Tag>
  );
```

In the same file, replace:

```
  );
}

/**
 * A take whose mic is not transcribed: what transcribing adds, and Transcribe. When it cannot run
 * (speech off, no model, an old ffmpeg), why, with the way to the settings.
 */
function SpeechNote() {
  const sources = useStore(store, (state) => state.doc?.project.sources);
  const working = useStore(store, (state) => state.status?.state === 'working');
  const [problem, setProblem] = useState<{ text: string; settings?: boolean }>();
  if (!sources?.mic || sources.transcript) return null;
  const transcribe = async () => {
    const answer = await bridge.invoke('project:transcribe');
    setProblem('problem' in answer ? { text: answer.problem, ...(answer.settings && { settings: true }) } : undefined);
  };
  return (
    <div className="speech-note" data-testid="speech-note">
      <p>
        <b>The mic is not transcribed.</b> Once it is, Cuttle cuts filler words and pauses where the picture rests.
      </p>
      {problem && (
        <p className="speech-problem" role="alert" data-testid="speech-problem">
          {problem.text}
        </p>
      )}
      <div className="speech-actions">
        <button type="button" className="ghost small" disabled={working} onClick={() => void transcribe()} data-testid="transcribe">
          {working ? 'Busy…' : 'Transcribe'}
        </button>
        {problem?.settings && (
          <button type="button" className="ghost small" onClick={() => void bridge.invoke('app:settings')} data-testid="speech-settings">
            Settings
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, testId, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)} aria-label={label} data-testid={testId} disabled={disabled}>
```

with:

```
  );
}

function Toggle({ checked, onChange, label, testId, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)} aria-label={label} data-testid={testId} disabled={disabled}>
```

In the same file, replace:

```
// ---- the look ------------------------------------------------------------------------------------

const look = (path: string[], value: unknown, label: string) => edit([{ type: 'look', path, value } as Command], label);

/**
 * A colour well: the video follows the picker while it moves, and the colour is one step to undo
 * once the picker closes (its native change), not one per move.
 */
function ColorInput({ value, path, label, upper }: { value: string; path: string[]; label: string; upper?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const shape = (colour: string) => (upper ? colour.toUpperCase() : colour);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const commit = () => {
      preview(undefined);
      look(path, shape(element.value), label);
    };
    element.addEventListener('change', commit);
    return () => element.removeEventListener('change', commit);
```

with:

```
// ---- the look ------------------------------------------------------------------------------------

const look = (path: string[], value: unknown, label: string) => edit([{ type: 'look', path, value } as Command], label);
const caption = (field: 'enabled' | 'style' | 'position' | 'size' | 'color', value: unknown, label: string) => edit([{ type: 'captions', field, value }], label);

/**
 * A colour well: the video follows the picker while it moves, and the colour is one step to undo
 * once the picker closes (its native change), not one per move. It sets `look.<path>`, or what
 * `toCommand` makes of the colour.
 */
function ColorInput({ value, path = [], label, upper, toCommand }: { value: string; path?: string[]; label: string; upper?: boolean; toCommand?: (colour: string) => Command }) {
  const input = useRef<HTMLInputElement>(null);
  const shape = (colour: string) => (upper ? colour.toUpperCase() : colour);
  const command = (colour: string): Command => toCommand?.(colour) ?? ({ type: 'look', path, value: colour } as Command);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const commit = () => {
      preview(undefined);
      edit([command(shape(element.value))], label);
    };
    element.addEventListener('change', commit);
    return () => element.removeEventListener('change', commit);
```

In the same file, replace:

```
      ref={input}
      type="color"
      defaultValue={value.toLowerCase()}
      onInput={(event) => preview([{ type: 'look', path, value: shape((event.target as HTMLInputElement).value) } as Command])}
      aria-label={label}
    />
  );
```

with:

```
      ref={input}
      type="color"
      defaultValue={value.toLowerCase()}
      onInput={(event) => preview([command(shape((event.target as HTMLInputElement).value))])}
      aria-label={label}
    />
  );
```

In the same file, replace:

```
  const project = useStore(store, (state) => state.doc?.project);
  const raw = useStore(store, (state) => state.doc?.raw);
  if (!project || !raw) return null;
  const { look: current, output, sources } = project;
  const size = SIZES.find((item) => item.width === output.width && item.height === output.height);
  return (
    <>
```

with:

```
  const project = useStore(store, (state) => state.doc?.project);
  const raw = useStore(store, (state) => state.doc?.raw);
  if (!project || !raw) return null;
  const { look: current, output, sources, captions } = project;
  const size = SIZES.find((item) => item.width === output.width && item.height === output.height);
  return (
    <>
```

In the same file, replace:

```
        </>
      )}

      <div className="section-title">Sound and transitions</div>
      <Row label="Mic" inline>
        <Toggle checked={current.audio.enabled} label="Mic sound" onChange={(on) => look(['audio', 'enabled'], on, on ? 'Sound on' : 'Sound off')} />
      </Row>
      {current.audio.enabled && (
        <Row label="Sped-up clips" inline>
          <Toggle checked={current.audio.muteSpedUp} label="Silent when sped up" onChange={(on) => look(['audio', 'muteSpedUp'], on, on ? 'Sped-up clips silent' : 'Sped-up clips heard')} />
```

with:

```
        </>
      )}

      <div className="section-title">Subtitles</div>
      <Row label="Subtitles" inline note={sources.transcript ? undefined : 'the take is not transcribed yet'}>
        <Toggle checked={captions.enabled} label="Subtitles" onChange={(on) => caption('enabled', on, on ? 'Subtitles on' : 'Subtitles off')} testId="captions-enabled" />
      </Row>
      {captions.enabled && (
        <>
          <div className="grid2">
            <Row label="Style">
              <Select value={captions.style} options={CAPTION_STYLES} names={CAPTION_STYLE_NAMES} onChange={(style) => caption('style', style, `Subtitles: ${CAPTION_STYLE_NAMES[style]}`)} testId="captions-style" />
            </Row>
            <Row label="Position">
              <Select value={captions.position} options={TEXT_POSITIONS} names={POSITION_NAMES} onChange={(position) => caption('position', position, 'Subtitles position')} testId="captions-position" />
            </Row>
          </div>
          <div className="grid2">
            <Row label="Size">
              <NumberInput value={captions.size} min={0.5} max={2} step={0.1} onCommit={(size) => caption('size', size, 'Subtitles size')} testId="captions-size" />
            </Row>
            {captions.style !== 'subtitle' && (
              <Row label="Spoken word">
                <ColorInput value={captions.color} label="Spoken word colour" upper toCommand={(color) => ({ type: 'captions', field: 'color', value: color })} />
              </Row>
            )}
          </div>
        </>
      )}

      <div className="section-title">Sound and transitions</div>
      <Row label="Mic" inline>
        <Toggle checked={current.audio.enabled} label="Mic sound" onChange={(on) => look(['audio', 'enabled'], on, on ? 'Sound on' : 'Sound off')} />
      </Row>
      {current.audio.enabled && sources.cleanMic && (
        <Row label="Clean voice" inline note="less noise">
          <Toggle checked={current.audio.cleanup} label="Clean voice" onChange={(on) => look(['audio', 'cleanup'], on, on ? 'Clean voice on' : 'Clean voice off')} testId="audio-cleanup" />
        </Row>
      )}
      {current.audio.enabled && (
        <Row label="Sped-up clips" inline>
          <Toggle checked={current.audio.muteSpedUp} label="Silent when sped up" onChange={(on) => look(['audio', 'muteSpedUp'], on, on ? 'Sped-up clips silent' : 'Sped-up clips heard')} />
```

In `apps/desktop/src/renderer/editor/App.tsx`, replace:

```
/**
 * The editor's keys (the command menu lists them): Space (K pauses, L plays, J a second back),
 * arrows (Shift: a second), Home/End, S split, Delete, Ctrl+D, R/Shift+R speed, V/Z/M/T tools, Shift+Z
 * fit, Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y, Ctrl+K or ? the menu, Ctrl+E export, Esc back out. Typing in a
 * field, and Space or Enter on a focused button outside the timeline, keep their own meaning.
 */
function useShortcuts(): void {
```

with:

```
/**
 * The editor's keys (the command menu lists them): Space (K pauses, L plays, J a second back),
 * arrows (Shift: a second), Home/End, S split, Delete, Ctrl+D, R/Shift+R speed, V/Z/M/T tools, Shift+Z
 * fit, Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y, Ctrl+K or ? the menu, Ctrl+E export, Ctrl+F find in the transcript, Esc back out. Typing in a
 * field, and Space or Enter on a focused button outside the timeline, keep their own meaning.
 */
function useShortcuts(): void {
```

In the same file, replace:

```
        if (!event.repeat) openMenu();
        return;
      }
      if (menuOpen || target?.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      if (command && key === ',') {
        event.preventDefault();
```

with:

```
        if (!event.repeat) openMenu();
        return;
      }
      // Ctrl+F finds a word in the transcript, from anywhere
      if (command && key === 'f' && !menuOpen) {
        event.preventDefault();
        store.set({ tab: 'transcript', findRequest: (store.get().findRequest ?? 0) + 1 });
        return;
      }
      if (menuOpen || target?.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      if (command && key === ',') {
        event.preventDefault();
```

- [ ] **Step 6: The timeline, the export sheet and the styles**

In `apps/desktop/src/renderer/editor/Timeline.tsx`, replace:

```
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { CuttleProject, MarkerKind } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import type { Command, OverlayList } from '../../shared/document';
import { dragRange, overlayRange, rangeFields, snapTime } from '../../shared/edit';
import { formatTime } from '../../shared/format';
```

with:

```
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { CuttleProject, MarkerKind } from '@cuttle/project';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans } from '@cuttle/timeline';
import type { Command, OverlayList } from '../../shared/document';
import { dragRange, overlayRange, rangeFields, snapTime } from '../../shared/edit';
import { formatTime } from '../../shared/format';
```

In the same file, replace:

```
  const spans = useMemo(() => (project ? sceneSpans(project.scenes, project.cuts) : []), [project]);
  const duration = spans.at(-1)?.end ?? 0;
  const model = useMemo(() => (project ? timelineModel(project, spans, media?.markers) : undefined), [project, spans, media]);
  const layout = useMemo(() => layoutOf(model), [model]);

  /** The whole video is in view: it stays so when the window changes size, until the person scales it. */
```

with:

```
  const spans = useMemo(() => (project ? sceneSpans(project.scenes, project.cuts) : []), [project]);
  const duration = spans.at(-1)?.end ?? 0;
  const model = useMemo(() => (project ? timelineModel(project, spans, media?.markers) : undefined), [project, spans, media]);
  // the subtitles over the mic's waveform: where each one shows, as the video has them
  const cues = useMemo(
    () => (project && media?.transcript ? captionCues(captionWords(applyCaptionFixes(media.transcript.words, project.captions.fixes), spans), project.captions.style) : []),
    [project, spans, media],
  );
  const layout = useMemo(() => layoutOf(model), [model]);

  /** The whole video is in view: it stays so when the window changes size, until the person scales it. */
```

In the same file, replace:

```
                  mirrored
                  deps={[peaks, spans, project]}
                />
                <ColumnsCanvas
                  top={tops.input}
                  height={heights.input}
```

with:

```
                  mirrored
                  deps={[peaks, spans, project]}
                />
                {cues.map((cue) => {
                  const left = cue.start * pps;
                  const width = (cue.end - cue.start) * pps;
                  if (left + width < view.left || left > view.left + view.width) return null;
                  const text = cue.lines.map((line) => line.map((word) => word.text).join(' ')).join(' ');
                  return (
                    <button
                      key={cue.start}
                      type="button"
                      className={`subtitle-cue${project.captions.enabled ? '' : ' off'}`}
                      style={{ left, width: Math.max(2, width - 1), top: tops.mic + 2 }}
                      title={`${text}${project.captions.enabled ? '' : ' (subtitles are off)'} · click to go there`}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        void currentPlayer()?.seek(cue.start);
                      }}
                      tabIndex={-1}
                      data-testid="subtitle-cue"
                    >
                      {width >= 28 && text}
                    </button>
                  );
                })}
                <ColumnsCanvas
                  top={tops.input}
                  height={heights.input}
```

In `apps/desktop/src/renderer/editor/ExportSheet.tsx`, replace:

```
  const targets = useMemo<ExportTarget[]>(() => ['project', ...FORMATS.filter((name) => name !== own)], [own]);
  const [chosen, setChosen] = useState<ExportTarget[]>([]);
  const [encoder, setEncoder] = useState<keyof typeof ENCODERS>('auto');
  const [files, setFiles] = useState<{ format: ExportTarget; out: string; modified?: number }[]>([]);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !exporting) setChosen([format ?? 'project']);
  }, [open]);

  // Which files the chosen formats write, and when an export already there was made.
```

with:

```
  const targets = useMemo<ExportTarget[]>(() => ['project', ...FORMATS.filter((name) => name !== own)], [own]);
  const [chosen, setChosen] = useState<ExportTarget[]>([]);
  const [encoder, setEncoder] = useState<keyof typeof ENCODERS>('auto');
  // subtitles: burned in as the project has them (Look tab), and the files beside the video
  const [burned, setBurned] = useState<'in' | 'off'>('in');
  const [subtitleFiles, setSubtitleFiles] = useState<('srt' | 'vtt')[]>([]);
  const transcribed = project?.sources.transcript !== undefined;
  const [files, setFiles] = useState<{ format: ExportTarget; out: string; modified?: number }[]>([]);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !exporting) {
      setChosen([format ?? 'project']);
      setBurned(project?.captions.enabled === false ? 'off' : 'in');
    }
  }, [open]);

  // Which files the chosen formats write, and when an export already there was made.
```

In the same file, replace:

```
                testId="encoder"
              />
            </div>
            {files.length > 0 && (
              <div className="note" data-testid="export-note">
                Saves {files.map((file, i) => (
```

with:

```
                testId="encoder"
              />
            </div>
            {transcribed && (
              <div className="row">
                Subtitles
                <Select
                  value={burned}
                  options={[
                    { value: 'in', label: 'In the video' },
                    { value: 'off', label: 'Not in the video' },
                  ]}
                  onChange={setBurned}
                  label="Subtitles"
                  variant="compact"
                  testId="export-subtitles"
                />
                <span className="subtitle-files" role="group" aria-label="Subtitle files">
                  {(['srt', 'vtt'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className="chip"
                      aria-pressed={subtitleFiles.includes(kind)}
                      onClick={() => setSubtitleFiles((list) => (list.includes(kind) ? list.filter((item) => item !== kind) : [...list, kind].sort()))}
                      title={`Also save the subtitles as a .${kind} file next to the video`}
                      data-testid={`export-${kind}`}
                    >
                      .{kind}
                    </button>
                  ))}
                </span>
              </div>
            )}
            {files.length > 0 && (
              <div className="note" data-testid="export-note">
                Saves {files.map((file, i) => (
```

In the same file, replace:

```
              <button className="ghost" onClick={closeExport}>
                Cancel
              </button>
              <button className="primary" disabled={chosen.length === 0} onClick={() => void startExport(chosen, encoder)} data-testid="export-start" data-autofocus>
                Export {chosen.length > 1 ? `${chosen.length} formats` : chosen[0] ? targetName(chosen[0], output) : ''}
              </button>
            </div>
```

with:

```
              <button className="ghost" onClick={closeExport}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={chosen.length === 0}
                onClick={() => void startExport(chosen, encoder, transcribed ? { captions: burned === 'in', files: subtitleFiles } : {})}
                data-testid="export-start"
                data-autofocus
              >
                Export {chosen.length > 1 ? `${chosen.length} formats` : chosen[0] ? targetName(chosen[0], output) : ''}
              </button>
            </div>
```

In the same file, replace:

```
                  {fileName(file.out)}
                  <small>
                    {targetName(file.format, output)} · {formatDuration(file.seconds)} · {formatBytes(file.bytes)}
                  </small>
                </div>
                <button className="ghost" onClick={() => void bridge.invoke('project:reveal', file.out)} title="Show in folder">
```

with:

```
                  {fileName(file.out)}
                  <small>
                    {targetName(file.format, output)} · {formatDuration(file.seconds)} · {formatBytes(file.bytes)}
                    {file.subtitles && ` · with ${file.subtitles.map((path) => `.${path.split('.').at(-1)}`).join(' and ')}`}
                  </small>
                </div>
                <button className="ghost" onClick={() => void bridge.invoke('project:reveal', file.out)} title="Show in folder">
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```
  color: var(--muted);
  font-size: var(--size-s);
}
.sheet .select-trigger {
  height: 28px;
  border-radius: 8px;
```

with:

```
  color: var(--muted);
  font-size: var(--size-s);
}
/* the subtitle files beside the video: .srt and .vtt */
.subtitle-files {
  display: inline-flex;
  gap: 4px;
}
.sheet .chip {
  height: 26px;
  padding: 0 10px;
  border-radius: 13px;
  background: var(--raised);
  color: var(--muted);
  font-size: var(--size-s);
  font-family: var(--mono);
}
.sheet .chip:hover {
  color: var(--text);
}
.sheet .chip[aria-pressed='true'] {
  color: var(--text);
  box-shadow: inset 0 0 0 1.5px var(--text);
}
.sheet .select-trigger {
  height: 28px;
  border-radius: 8px;
```

In the same file, replace:

```
  min-width: 0;
  min-height: 28px;
}
.field-input em {
  color: var(--muted);
  font-size: var(--size-s);
```

with:

```
  min-width: 0;
  min-height: 28px;
}
/* a menu next to a note keeps room for its value */
.field-input > .select-trigger {
  min-width: 112px;
}
.field-input em {
  color: var(--muted);
  font-size: var(--size-s);
```

In the same file, replace:

```
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.field input[type='text'],
.field textarea {
```

with:

```
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* a long note gives way (with an ellipsis) before the field it explains */
  min-width: 0;
}
.field input[type='text'],
.field textarea {
```

In the same file, replace:

```
.auto-empty p {
  margin: 0;
}
/* the mic not transcribed yet, at the top of the Auto tab */
.speech-note {
  display: flex;
  flex-direction: column;
```

with:

```
.auto-empty p {
  margin: 0;
}
/* the subtitles over the mic's waveform on the timeline */
.subtitle-cue {
  position: absolute;
  height: 13px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(236, 236, 241, 0.16);
  color: var(--text);
  font-size: 9.5px;
  line-height: 13px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.subtitle-cue:hover {
  background: rgba(236, 236, 241, 0.28);
}
.subtitle-cue.off {
  background: rgba(236, 236, 241, 0.06);
  color: var(--faint);
}

/* the Transcript tab: the words in paragraphs */
.transcript {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.transcript-find {
  display: flex;
  align-items: center;
  gap: 8px;
}
.transcript-find input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: none;
  background: var(--raised);
  color: var(--text);
  font: inherit;
}
.transcript-find input:focus-visible {
  outline: none;
  box-shadow: var(--focus);
}
.transcript-count {
  color: var(--muted);
  font-size: var(--size-s);
  white-space: nowrap;
}
.transcript-meta {
  margin: 0;
}
.transcript-words {
  border-radius: 10px;
  padding: 4px 2px;
  line-height: 1.75;
  user-select: none;
}
.transcript-words:focus-visible {
  outline: none;
  box-shadow: var(--focus);
}
.transcript-words p {
  margin: 0 0 10px;
}
.transcript-time {
  display: inline-block;
  margin-right: 6px;
  color: var(--faint);
  font-size: var(--size-xs);
  font-variant-numeric: tabular-nums;
}
.word {
  border-radius: 4px;
  padding: 1px 0;
  cursor: pointer;
}
.word:hover {
  background: var(--raised-hover);
}
.word.filler {
  color: var(--faint);
}
.word.fast {
  color: var(--muted);
  font-style: italic;
}
.word.cut,
.word.out {
  color: var(--faint);
  text-decoration: line-through;
}
.word.out {
  opacity: 0.6;
}
.word.fixed {
  text-decoration: underline dotted var(--muted);
  text-underline-offset: 3px;
}
.word.match {
  box-shadow: inset 0 -2px var(--card);
}
.word.spoken {
  color: var(--accent);
}
.word.selected {
  background: var(--accent-soft);
  color: var(--text);
}
.word-field {
  height: 24px;
  padding: 0 6px;
  border-radius: 6px;
  border: none;
  background: var(--raised-active);
  color: var(--text);
  font: inherit;
}
.word-field:focus-visible {
  outline: none;
  box-shadow: var(--focus);
}
.transcript-actions {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--raised);
  box-shadow: 0 -8px 16px var(--panel);
}
.transcript-actions .hint {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* the mic not transcribed yet, at the top of the Auto and Transcript tabs */
.speech-note {
  display: flex;
  flex-direction: column;
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `pnpm exec vitest run --project node apps/desktop`
Expected: PASS.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src apps/desktop/test/document.test.ts
git commit -m "desktop: the Transcript tab, subtitles in the Look tab, on the timeline and in the export, and the clean voice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The skill

**Files:**
- Modify: `skill/cuttle/{SKILL,project}.md`, `skill/test/skill.test.ts`

- [ ] **Step 1: Write the failing test**

In `skill/test/skill.test.ts`, replace:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'preview', 'frame', 'capture-page', 'render', 'recover'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
```

with:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'frame', 'capture-page', 'render', 'recover'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
```

Run: `pnpm exec vitest run --project node skill/test`
Expected: FAIL: the skill does not use `transcript`.

- [ ] **Step 2: The skill**

In `skill/cuttle/SKILL.md`, replace:

```markdown
words ("äh", "um") and pauses longer than a second down to 0.4 s, only where the picture rests
(cuts tagged `filler` and `pause`). `--no-speech` leaves the speech out.
`cuttle -C "<project>" --json transcribe --language de` transcribes again (`--model` picks one).

`preview` writes 12 stills and `preview/sheet.png`. **Look at the sheet** (Read the PNG). Each
still in the JSON has its output second `t` and the `source` second it shows. For details, run
```

with:

```markdown
words ("äh", "um") and pauses longer than a second down to 0.4 s, only where the picture rests
(cuts tagged `filler` and `pause`). `--no-speech` leaves the speech out.
`cuttle -C "<project>" --json transcribe --language de` transcribes again (`--model` picks one).
Transcribing also writes a cleaned-up mic (less noise, even loudness) that the video plays.

**Subtitles.** A transcribed take gets subtitles in the video (`captions`, project.md): as
subtitles at the bottom, `karaoke` (the spoken word in colour) or `bold` (a few big words, for
9:16). `cuttle -C "<project>" transcript --text` prints what was said; `--srt` the subtitles on
the video's time. Read them for misheard names and fix them in `captions.fixes`. Check a still
with a subtitle on it before you render.

`preview` writes 12 stills and `preview/sheet.png`. **Look at the sheet** (Read the PNG). Each
still in the JSON has its output second `t` and the `source` second it shows. For details, run
```

In the same file, replace:

````markdown
cuttle -C "<project>" --json render --format 16:9
```

Run it in the background when the video is longer than about a minute; the Bash tool stops long
commands. It writes `out/16x9.mp4` (or `-o <file>`); the JSON has the frames, the seconds and the
encoder (`stats`). For 9:16, check `preview --format 9:16` first. Render each format the user
wants. Tell the user the file's path and length. Do not upload it anywhere.
````

with:

````markdown
cuttle -C "<project>" --json render --format 16:9
```

With a transcript, `--srt` and `--vtt` also write the subtitles next to the video, and
`--no-captions` leaves them out of the picture. Run it in the background when the video is longer than about a minute; the Bash tool stops long
commands. It writes `out/16x9.mp4` (or `-o <file>`); the JSON has the frames, the seconds and the
encoder (`stats`). For 9:16, check `preview --format 9:16` first. Render each format the user
wants. Tell the user the file's path and length. Do not upload it anywhere.
````

In `skill/cuttle/project.md`, replace:

```markdown
    "mic": "takes/1/mic.m4a",
    "events": "takes/1/events.jsonl",
    "markers": "takes/1/markers.json",
    "transcript": "takes/1/transcript.json"
  },
  "look": {
    "background": { "preset": "sunset-sky" },
```

with:

```markdown
    "mic": "takes/1/mic.m4a",
    "events": "takes/1/events.jsonl",
    "markers": "takes/1/markers.json",
    "transcript": "takes/1/transcript.json",
    "cleanMic": "takes/1/mic.clean.m4a"
  },
  "look": {
    "background": { "preset": "sunset-sky" },
```

In the same file, replace:

```markdown
once the mic was transcribed (`cuttle transcribe`, or `suggest` with a speech model). Never edit
transcript.json: `{ "language", "model", "words": [{ "t", "end", "text" }], "sounds": [{ "t", "end" }] }`,
in source seconds; `sounds` are stretches the mic heard without a word (a cough, a dropped filler).

`look` (every field is optional):
```

with:

```markdown
once the mic was transcribed (`cuttle transcribe`, or `suggest` with a speech model). Never edit
transcript.json: `{ "language", "model", "words": [{ "t", "end", "text" }], "sounds": [{ "t", "end" }] }`,
in source seconds; `sounds` are stretches the mic heard without a word (a cough, a dropped filler).
`cleanMic` is the mic cleaned up with it (less noise, even loudness), played instead of the mic
while `look.audio.cleanup` is on.

`look` (every field is optional):
```

In the same file, replace:

```markdown
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

Two clips where the second starts where the first ends (within 1 ms), as `suggest`'s speed-ups and
```

with:

```markdown
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

Two clips where the second starts where the first ends (within 1 ms), as `suggest`'s speed-ups and
```

In the same file, replace:

```markdown
`position` (`top`, `center`, `bottom`) and `enabled` (`true`). A `top` text sits over the window's
title bar; `bottom` keeps the title visible. Texts fade in and out over 0.25 output seconds.

`cuts` take a stretch out of whatever clip covers it, without splitting the clip: `from` and `to`
(source seconds) and `enabled` (`true`). The video jumps there (no crossfade); zooms, masks and
texts run on across it. Use them for a slip, a filler or a pause inside a clip; `suggest` makes
```

with:

```markdown
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
```

- [ ] **Step 3: Run the test**

Run: `pnpm exec vitest run --project node skill/test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add skill
git commit -m "skill: subtitles, cuttle transcript, and the clean voice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The end-to-end check

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The check**

The spoken take of M2a gets a transcript made from its words' true starts: this check needs no speech model.

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
const MAIN = fileURLToPath(new URL('../dist/main/index.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../../cli/dist/cuttle.mjs', import.meta.url));
const SHOTS = process.env.CUTTLE_CHECK_SHOTS;
/** The English text-to-speech take of the core tests. */
const SPOKEN = fileURLToPath(new URL('../../../packages/core/test/fixtures/speech/en.m4a', import.meta.url));
/**
 * The `base` speech model where one is downloaded (`CUTTLE_TEST_MODELS`, else the user's models
 * folder): the check downloads it from a server of its own, so the model can be checked end to end.
```

with:

```ts
const MAIN = fileURLToPath(new URL('../dist/main/index.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../../cli/dist/cuttle.mjs', import.meta.url));
const SHOTS = process.env.CUTTLE_CHECK_SHOTS;
/** The English text-to-speech take of the core tests, and the true start of each of its words. */
const SPOKEN = fileURLToPath(new URL('../../../packages/core/test/fixtures/speech/en.m4a', import.meta.url));
const SPOKEN_WORDS = fileURLToPath(new URL('../../../packages/core/test/fixtures/speech/en.words.json', import.meta.url));
/**
 * The `base` speech model where one is downloaded (`CUTTLE_TEST_MODELS`, else the user's models
 * folder): the check downloads it from a server of its own, so the model can be checked end to end.
```

In the same file, replace:

```ts
    );
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  };
  /** Asks the running app to open `argv` as a second launch would, `times` times at once. */
  const launchAgain = (argv: string[], times = 1) =>
    app.evaluate(
```

with:

```ts
    );
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  };
  /** Opens a project folder as a second launch would, and finds its editor (others may be open: the takes recorded before). */
  const openEditor = async (dir: string): Promise<Page> => {
    const name = basename(dir);
    await launchAgain(['--open', dir]);
    await expect.poll(editorTitles, { timeout: 30_000 }).toContain(`${name} · Cuttle`);
    const page = await waitForPage(
      app,
      async (candidate) =>
        candidate.url().includes('/editor.html') &&
        basename((await candidate.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<{ dir: string }> } }).cuttle.invoke('project:info'))).dir) === name,
    );
    await page.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    await page.setViewportSize({ width: 1440, height: 900 });
    return page;
  };
  /** Asks the running app to open `argv` as a second launch would, `times` times at once. */
  const launchAgain = (argv: string[], times = 1) =>
    app.evaluate(
```

In the same file, replace:

```ts
    // a spoken take, opened: the Auto tab offers to transcribe it
    const spoken = join(root, 'spoken');
    makeSpokenFixture(spoken, SPOKEN);
    await launchAgain(['--open', spoken]);
    await expect.poll(editorTitles, { timeout: 30_000 }).toContain('spoken · Cuttle');
    // other editors may be open (the takes recorded before): this one by its project
    const page = await waitForPage(
      app,
      async (candidate) =>
        candidate.url().includes('/editor.html') &&
        /[\\/]spoken$/.test((await candidate.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<{ dir: string }> } }).cuttle.invoke('project:info'))).dir),
    );
    await page.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await click(page, '#tab-auto');
    await page.waitForSelector('[data-testid=speech-note]');
    await click(page, '[data-testid=transcribe]');
```

with:

```ts
    // a spoken take, opened: the Auto tab offers to transcribe it
    const spoken = join(root, 'spoken');
    makeSpokenFixture(spoken, SPOKEN);
    const page = await openEditor(spoken);
    await click(page, '#tab-auto');
    await page.waitForSelector('[data-testid=speech-note]');
    await click(page, '[data-testid=transcribe]');
```

In the same file, replace:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'spoken · Cuttle')?.close());
  }, 120_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

with:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'spoken · Cuttle')?.close());
  }, 120_000);

  it('shows the transcript (a click goes to a word, a fix reads in the subtitles, Delete cuts words and Restore brings them back), styles the subtitles, and exports them as .srt', async () => {
    const dir = join(root, 'subtitled');
    makeSpokenFixture(dir, SPOKEN);
    // the transcript the spoken take gets, from its words' true starts: no speech model needed here
    const truth = JSON.parse(readFileSync(SPOKEN_WORDS, 'utf8')) as { t: number; text: string }[];
    const words = truth.map((word, i) => ({ t: word.t, end: Math.min(truth[i + 1]?.t ?? word.t + 0.5, word.t + 0.5), text: word.text }));
    const take = join(dir, 'takes', '1');
    writeFileSync(join(take, 'transcript.json'), JSON.stringify({ version: 1, language: 'en', model: 'small', words }));
    cpSync(join(take, 'mic.m4a'), join(take, 'mic.clean.m4a'));
    const path = join(dir, 'cuttle.json');
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { sources: Record<string, string> };
    writeFileSync(path, JSON.stringify({ ...raw, sources: { ...raw.sources, transcript: 'takes/1/transcript.json', cleanMic: 'takes/1/mic.clean.m4a' } }, null, 2));
    type Saved = { cuts?: { label?: string }[]; captions?: { style?: string; fixes?: { at: number; end: number; text: string }[] }; look?: { audio?: { cleanup?: boolean } } };
    const saved = () => JSON.parse(readFileSync(path, 'utf8')) as Saved;
    const page = await openEditor(dir);
    const pageState = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state());
    const index = (text: string) => words.findIndex((word) => word.text === text);
    const word = (text: string) => `[data-testid=transcript] .word[data-index="${index(text)}"]`;
    // the subtitles over the mic's waveform
    await page.waitForSelector('[data-testid=subtitle-cue]');
    // the Transcript tab: every word; a click goes there
    await click(page, '#tab-transcript');
    await page.waitForSelector('[data-testid=transcript] .word');
    expect(await page.locator('[data-testid=transcript] .word').count()).toBe(words.length);
    await click(page, word('records'));
    await expect.poll(async () => (await pageState()).t).toBeCloseTo(words[index('records')]!.t, 1);
    // a double click fixes a word; the fix is one step in the file
    await page.evaluate((selector) => document.querySelector(selector)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), word('Cuttle'));
    await page.fill('[data-testid=word-field]', 'Cuttle!');
    await page.press('[data-testid=word-field]', 'Enter');
    const cuttle = words[index('Cuttle')]!;
    await expect.poll(() => saved().captions?.fixes).toEqual([{ at: cuttle.t, end: cuttle.end, text: 'Cuttle!' }]);
    // one word for one: it keeps its place in the list
    await page.waitForSelector(`${word('Cuttle')}.fixed`);
    // Delete cuts the selected word out of the video; Restore brings it back
    await click(page, word('every'));
    await page.keyboard.press('Delete');
    await expect.poll(() => saved().cuts?.map((cut) => cut.label)).toEqual(['Words: “every”']);
    await page.waitForSelector(`${word('every')}.cut`);
    await click(page, '[data-testid=transcript-restore]');
    await expect.poll(() => saved().cuts ?? []).toEqual([]);
    // Ctrl+F finds words; Enter goes to the next one after the selected word ("every"), Shift+Enter back
    await page.keyboard.press('Control+F');
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid)).toBe('transcript-find');
    await page.keyboard.type('click');
    expect(await page.locator('.transcript-count').textContent()).toBe('2 found');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${word('click')}.selected`);
    await page.keyboard.press('Shift+Enter');
    await page.waitForSelector(`${word('clicks')}.selected`);
    await shotOf('28-transcript', '/editor.html', 'subtitled · Cuttle');
    // the Look tab: the subtitles' style, and the clean voice
    await click(page, '#tab-look');
    await page.waitForSelector('[data-testid=captions-enabled][aria-checked=true]');
    await page.locator('[data-testid=captions-style]').evaluate((element) => (element as HTMLElement).click());
    await page.waitForSelector('.select-list [role=option]');
    await page.evaluate(() => {
      const option = [...document.querySelectorAll('.select-list [role=option]')].find((item) => item.querySelector('.option-label')?.textContent === 'Karaoke');
      (option as HTMLElement).click();
    });
    await expect.poll(() => saved().captions?.style).toBe('karaoke');
    await click(page, '[data-testid=audio-cleanup]');
    await expect.poll(() => saved().look?.audio?.cleanup).toBe(false);
    await page.evaluate((t) => (window as unknown as Hooked).__cuttleCheck.seek(t), words[index('zooms')]!.t + 0.1);
    await page.locator('[data-testid=captions-style]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('29-subtitles-karaoke', '/editor.html', 'subtitled · Cuttle');
    // the export writes the subtitles next to the video
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-subtitles]');
    await click(page, '[data-testid=export-srt]');
    await page.waitForSelector('[data-testid=export-srt][aria-pressed=true]');
    await shotOf('30-export-subtitles', '/editor.html', 'subtitled · Cuttle');
    await click(page, '[data-testid=export-start]');
    await page.waitForSelector('[data-testid=export-file]', { timeout: 120_000 });
    expect(await page.locator('[data-testid=export-file] small').textContent()).toContain('with .srt');
    const srt = readFileSync(join(dir, 'out', 'export.srt'), 'utf8');
    expect(srt.startsWith('1\n00:00:00,100 --> ')).toBe(true);
    expect(srt).toContain('Cuttle!');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'subtitled · Cuttle')?.close());
  }, 180_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

- [ ] **Step 2: Run it, with screenshots, and look at them**

```bash
mkdir -p "$TEMP/cuttle-p4m2b-shots"
CUTTLE_HIDDEN=1 CUTTLE_RECORDER_BACKEND=test CUTTLE_CHECK_SHOTS="$TEMP/cuttle-p4m2b-shots" pnpm app:check
```

Expected: PASS, 40 tests. Look at `28-transcript`, `29-subtitles-karaoke` and `30-export-subtitles`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/app.check.test.ts
git commit -m "desktop: app:check covers the Transcript tab, the subtitles and their export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Final verification

- [ ] **Step 1: All tests, the typecheck, the export and the packaged build**

Run: `pnpm test`
Expected: PASS, 588 passed and 50 skipped (on a machine without a speech model, the real transcription is among the skipped).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm export:check`
Expected: every check passes.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Record a take with the mic and a few sentences. Once it is transcribed, play it: the subtitles follow the speech, and the voice sounds clean.
2. In the Transcript tab, fix a misheard name with a double click; the subtitle shows the fix. Select a sentence, press Delete, play it: it is gone. Restore it.
3. In the Look tab, try Karaoke and Bold, and 9:16 with Bold.
4. Export with `.srt`, and open the video with the `.srt` in a player.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran once, on the prototype, whose tree the replay matches byte for byte: the task steps' tests, the goldens, `pnpm test`, the typecheck, `app:check`, `cli:check` and `export:check`, with every screenshot and golden looked at. The packaged build (`pnpm app:build`) ran on the replayed commits.

**Found while checking, and already in the plan above**
- **A subtitle line was 44 characters.** A cue was cut at 84 characters, but two balanced lines of whole words can need more than 42 on one. A cue now ends when its words would not fit two lines of 42.
- **The cleaned-up voice came 25 ms late.** `afftdn` holds samples back and does not say so. Its delay is measured with a click and taken out; a check compares the loudness of the mic and the clean voice to 10 ms.
- **The cleaned-up voice was 90 ms long.** `loudnorm` adds a tail. The output is cut to the mic's length.
- **`anlmdn` crashed ffmpeg 9.0** on this machine (an access violation). It was tried as a denoiser without a delay, and is not used.
- **Find's Enter went to the next match after the selected word**, not the first. That is how finding works in editors; the check now says so, and Shift+Enter goes back.
- **A menu beside a long note was squeezed to nothing** (the Look tab's Movement showed "S."): left over from M1, where Cuttle's menus came. A note now gives way with an ellipsis (its whole text in its tooltip), and a menu keeps 112 px.
- **The editor's word helpers lived in `@cuttle/core`**, which the editor cannot load (it runs ffmpeg). They moved to `@cuttle/project`.

- **No merge conflicts with the macOS branch** (`macos-support`): a test merge found one, the `node:fs` import of the app check, which both changed. The check copies with `cpSync`, already imported, and the speech check ran again.

**Spec points that move**
- **A captions lane** is a row of strips over the mic's waveform rather than a lane of its own: the subtitles belong to the speech, and the timeline keeps its height.
- **Caption pictures in the Look tab** (pictures drawn by the engine, as for cursors) wait for P5's look work; the Look tab has a menu for the style, and the preview shows it at once.

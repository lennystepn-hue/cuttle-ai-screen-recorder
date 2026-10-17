# Cuttle P4-M2a: Speech, Transcription, Filler Words and Pauses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuttle understands what was said in a take:
- the speech models, downloaded once with a checksum;
- the mic transcribed after the stop, into `takes/<n>/transcript.json`, word by word;
- filler words and long pauses cut where the picture rests, as tagged cuts;
- speech kept by `suggest` (never cut as idle, never sped up);
- `cuttle transcribe` and `cuttle models`, a Speech section in the settings, and the Auto tab's offer to transcribe.

**Architecture:**
- **Format** (`@cuttle/project`): `transcript.json` (`words` and `sounds` in source seconds) and `sources.transcript`.
- **Speech** (`@cuttle/core`, `src/speech/`):
  - `models`: the catalogue (pinned sizes and SHA-256), the folder, the download;
  - `whisper`: one run of ffmpeg's `whisper` filter, its option values escaped, its lines read by pattern;
  - `levels`: the mic's loudness every 10 ms and the stretches clearly above its floor;
  - `align`: whisper's words placed into those stretches (the spike's dynamic programming);
  - `edits`: the filler and pause detectors and the tag rules for cuts;
  - `transcribe` and `apply`: the steps on a project folder.
- **`suggest`** keeps speech as activity, transcribes first when it can, and makes the speech cuts.
- **CLI:** `cuttle transcribe`, `cuttle models [list | download | remove]`, `suggest --no-speech --no-transcribe`.
- **App:** the cut as before, then the transcription in the media worker and the speech edits as a second step to undo ("Cuttle's speech edits"); the settings' Speech section; the Auto tab's Transcribe.

**Tech Stack:** TypeScript strict, zod 4, vitest 5, Electron 44.7.2, React 19.3.0, Playwright (`_electron`), ffmpeg 8 or later with the `whisper` filter (9.0 here).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase4-design.md`. Spike: `docs/superpowers/spikes/2026-10-17-p4-spike.md`. Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p4-m1-foundation.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p4-m2a`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The tests never use the user's speech models by chance: `vitest.config.ts` points `CUTTLE_MODELS_DIR` at an empty folder. The tests that transcribe for real find a model on their own (`CUTTLE_TEST_MODELS`, else the user's models folder) and are skipped without one.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 8.

## Decisions made while planning

A prototype of the milestone, checked against the spec and the spike, settled these points. The prototype passed `pnpm test` (566 tests, 48 skipped; one recorder test that wobbles under load, see below), the typecheck and `app:check` (39 tests, the real transcription included). Every screenshot was looked at.

- **Where the code lives.** The speech steps are in `@cuttle/core` (`src/speech/`), not in a new `packages/analysis`: they run where `suggest` runs (the CLI, the app's media worker), and the core already owns ffmpeg. The privacy pass (M5) can join them there.
- **The models.**
  - `base` "Fast" (147 951 465 bytes), `small` "Good" (487 601 967), `large-v3-turbo-q5_0` "Best" (574 041 195), with the SHA-256 of their Git LFS pointers.
  - They come from `huggingface.co/ggerganov/whisper.cpp`, through `<file>.part`, renamed only once the size and checksum match.
  - They live in `%LOCALAPPDATA%\Cuttle\models` (macOS: `~/Library/Application Support/Cuttle/models`), shared by the app and the CLI; `CUTTLE_MODELS_DIR` and `CUTTLE_MODELS_URL` move them for tests.
  - Without a choice, `small` is used when it is there, else the most accurate model there.
- **Whisper.**
  - One run over the mic: `queue=30`, `max_len=1`, `use_gpu=1`, `format=json` into a temporary file.
  - Option values are escaped for both of ffmpeg's levels (the option list: `\ ' :`; the graph: `\ ' [ ] , ;`), with backslashes in paths made slashes. A real filter graph takes a path with every special character.
  - The lines are read with a pattern (the filter does not escape the text). Whisper's notes in brackets (`[BLANK_AUDIO]`) are not words.
  - The filter does not say which language it heard. With `auto`, common short words decide (`de`, `en`, else `auto`), because the fillers depend on it.
  - An ffmpeg without the filter is the error `ffmpeg-old`; no model is `model-missing`.
- **The mic's speech without a model.**
  - The loudness every 10 ms; the threshold lies halfway in dB between the take's 10th and 98th percentile.
  - Gaps under 0.25 s are bridged, and runs under 60 ms dropped. A track that hardly varies (a muted mic, a steady tone) has no speech.
  - On the spike's fixtures, with pink noise added at three levels, this found the filler stretches like the spike's fixed −35 dB did.
- **The alignment** is the spike's, with three changes:
  - each run's distance cost is added as it grows (an hour of speech aligns in well under 5 s);
  - a word may be left out at a cost (whisper makes up words in silence, such as a closing "Vielen Dank.");
  - a likely filler costs 0.3 in a stretch it shares with other words. On the English fixture `base` heard "Um," 0.3 s early, and without this it was put at the head of the next sentence; a cut there would have clipped "it".

  On the fixtures (`small`), the median start error falls from 245 to 445 ms to under 100 ms.
- **The cuts** (`auto: 'filler'` and `'pause'`):
  - **Fillers:**
    - the language's lexicon ("um" and "er" are words in German, so only for English);
    - whisper's short spellings ("e", "eh", "m", …);
    - stretches under 0.8 s that took no word.

    A filler is cut only when it stands alone between pauses (inside running speech its time is an estimate), padded 50 ms up to the words around it. Fillers in a row are one cut.
  - **Pauses:** a gap of 1 s or more between words keeps 0.2 s after the word before and 0.2 s before the word after. The rest is cut where the picture rests, in parts at least 0.3 s long. A short sound in the pause goes with it; a long one stays.
  - **The picture rests:**
    - the screen is still from 0.2 s before to 0.2 s after;
    - nothing is clicked, typed or scrolled;
    - the pointer moves no more than 12 px.
  - Cuts are made only inside 1× clips. A filler inside a pause's cut is not cut twice.
  - **The tag rules** are those of M1:
    - a rerun replaces the cuts still tagged `filler` or `pause`;
    - a new cut overlapping any other cut is not made;
    - a new cut in the place of a replaced one of its kind keeps its id and its switch (off stays off);
    - a kind switched off in `autoEdits` is not made.
- **`suggest`:**
  - The speech (the transcript's words, else the mic's loud stretches) counts as activity: a stretch where someone speaks over a still screen is not cut as idle, and a wait is sped up only where nobody speaks.
  - Before it reads the take, `suggest` transcribes the mic when the take has one, no transcript yet, a model is there and ffmpeg can. A failed transcription is a note, and the cut goes on.
  - `--no-speech` leaves the speech out altogether; `--no-transcribe` only skips the transcription. A dry run never transcribes.
- **The app:**
  - The cut runs as before (without transcribing). Then, when the settings' speech model is not Off, the take has a mic and no transcript, the model is there and ffmpeg can, the media worker transcribes it (the title bar: "Transcribing… N %").
  - A second job links the transcript and writes the speech cuts in one write: the editor gets one change, "Cuttle's speech edits", with "Cuttle cut 2 filler words and 3 pauses where the picture rests." A failure says "The speech could not be transcribed · Try again".
  - A transcript linked to a take is not a new take: the editor and its media stay.
  - The Auto tab offers Transcribe for a take with a mic and no transcript. When it cannot run, it says why, and Settings is one click away.
  - The settings' Speech section:
    - the model (Off, Fast, Good, Best; Good by default);
    - the chosen model's line: its download with progress and Cancel, Remove, or a failure with Try again;
    - one download at a time, shown whichever model is chosen;
    - the language (Auto, Deutsch, English).
- **Fixed on the way:**
  - A new take dropped the zooms, masks and texts of the take before, but not its cuts. It drops them now. `recover` keeps a take's transcript.
  - The editor's title bar and transport read the video's length from the player, which takes a new version a moment after the document: a change from outside (a cut) showed the old length until the next click. The length is now part of the player's state.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/transcript.ts` (new), `schema.ts`, `index.ts` | `transcript.json`, `sources.transcript` |
| `packages/core/src/speech/models.ts` (new) | the catalogue, the folder, the download with checksum |
| `packages/core/src/speech/whisper.ts` (new) | escaping, one whisper run with progress, its lines |
| `packages/core/src/speech/levels.ts` (new) | the mic's loudness and speech stretches |
| `packages/core/src/speech/align.ts` (new) | the alignment, the language guess |
| `packages/core/src/speech/edits.ts` (new) | filler and pause cuts, where the picture rests, the tag rules |
| `packages/core/src/speech/transcribe.ts`, `apply.ts` (new) | transcribing a project, applying the speech edits |
| `packages/core/src/suggest.ts`, `suggest/plan.ts` | speech as activity, transcribing first, the speech cuts |
| `packages/core/src/use-take.ts`, `recover.ts`, `errors.ts`, `index.ts` | cuts dropped with a new take; new error codes; exports |
| `apps/cli/src/commands/transcribe.ts`, `models.ts` (new), `suggest.ts`, `main.ts`, `errors.ts` | the commands |
| `apps/desktop/src/main/speech.ts` (new) | the models in the app, transcribing after the cut |
| `apps/desktop/src/shared/{ipc,channels,media-jobs,take}.ts`, `workers/media.ts` | the contract, the worker's jobs |
| `apps/desktop/src/main/{settings,settings-window,recording,windows,project-watch}.ts` | the settings, the pipeline, the editor's origin |
| `apps/desktop/src/renderer/…` | the Speech section, the Auto tab's Transcribe, the toasts, the length |
| `skill/cuttle/{SKILL,project}.md` | speech for Claude |

---

### Task 1: The transcript format

**Files:**
- Create: `packages/project/src/transcript.ts`, `packages/project/test/transcript.test.ts`
- Modify: `packages/project/src/{schema,index}.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p4-m2a`; work there:

```bash
git switch p4-m2a
```

- [ ] **Step 2: Write the failing test**

`packages/project/test/transcript.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseProject, parseTranscriptJson } from '../src/index';

const file = {
  version: 1,
  language: 'de',
  model: 'small',
  words: [
    { t: 0.1, end: 0.4, text: 'Das' },
    { t: 0.4, end: 0.79, text: '"Zitat"' },
  ],
  sounds: [{ t: 8.75, end: 8.99 }],
};

describe('parseTranscriptJson', () => {
  it('reads the words and the sounds, with a byte order mark too', () => {
    expect(parseTranscriptJson(JSON.stringify(file))).toEqual({ ok: true, transcript: file });
    expect(parseTranscriptJson(`﻿${JSON.stringify(file)}`).ok).toBe(true);
    const { sounds: _, ...without } = file;
    expect(parseTranscriptJson(JSON.stringify(without))).toEqual({ ok: true, transcript: { ...without, sounds: [] } });
  });

  it('names the path of a word that ends before it starts, and rejects another version', () => {
    const result = parseTranscriptJson(JSON.stringify({ ...file, words: [{ t: 2, end: 1, text: 'x' }] }));
    expect(result).toEqual({ ok: false, issues: [{ path: 'words[0].end', message: '"end" must not be before "t"' }] });
    expect(parseTranscriptJson(JSON.stringify({ ...file, version: 2 })).ok).toBe(false);
    expect(parseTranscriptJson('{').ok).toBe(false);
  });

  it('is linked from the project as a source', () => {
    const result = parseProject({ version: 1, sources: { screen: 'takes/1/screen.mp4', transcript: 'takes/1/transcript.json' } });
    expect(result.ok && result.project.sources.transcript).toBe('takes/1/transcript.json');
  });
});
```

Run: `pnpm exec vitest run --project node packages/project/test/transcript.test.ts`
Expected: FAIL: `parseTranscriptJson` is not exported.

- [ ] **Step 3: The format**

`packages/project/src/transcript.ts`:

```ts
import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';

/** The transcript.json format version this build reads and writes. */
export const TRANSCRIPT_VERSION = 1;

const seconds = z.number().nonnegative();

/** One spoken word; `t` and `end` are source seconds of the screen track, like events.jsonl. */
export const TranscriptWordSchema = z
  .strictObject({ t: seconds, end: seconds, text: z.string().min(1) })
  .refine((word) => word.end >= word.t, { message: '"end" must not be before "t"', path: ['end'] });

/**
 * transcript.json, written next to the take's tracks once the mic was transcribed (`cuttle
 * transcribe`, the app after a take). `sounds`: stretches the mic heard where no word was written
 * (a filler the speech model left out, a cough, a click), in source seconds.
 */
export const TranscriptFileSchema = z.strictObject({
  version: z.literal(TRANSCRIPT_VERSION),
  /** What was spoken, as told or guessed from the words (`de`, `en`, … or `auto` when unclear). */
  language: z.string().min(1),
  /** The speech model that wrote it (`small`, …). */
  model: z.string().min(1),
  words: z.array(TranscriptWordSchema),
  sounds: z.array(z.strictObject({ t: seconds, end: seconds })).default([]),
});

export type TranscriptWord = z.output<typeof TranscriptWordSchema>;
export type TranscriptFile = z.output<typeof TranscriptFileSchema>;
export type TranscriptParseResult = { ok: true; transcript: TranscriptFile } | { ok: false; issues: ProjectIssue[] };

export function parseTranscriptJson(text: string): TranscriptParseResult {
  let raw: unknown;
  try {
    // A UTF-8 byte order mark (U+FEFF), as Windows editors and PowerShell 5.1 write one, is not JSON.
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  const result = TranscriptFileSchema.safeParse(raw);
  if (result.success) return { ok: true, transcript: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}
```

In `packages/project/src/schema.ts`, replace:

```ts
  mic: z.string().min(1).optional(),
  events: z.string().min(1).optional(),
  markers: z.string().min(1).optional(),
});

// Cross-field checks live on the object they belong to, so zod reports them in the same pass
```

with:

```ts
  mic: z.string().min(1).optional(),
  events: z.string().min(1).optional(),
  markers: z.string().min(1).optional(),
  /** What the mic said, word by word (`cuttle transcribe`, the app after a take). */
  transcript: z.string().min(1).optional(),
});

// Cross-field checks live on the object they belong to, so zod reports them in the same pass
```

In `packages/project/src/index.ts`, replace:

```ts
} from './schema';
export { formatPath, parseProject, parseProjectJson, type ParseResult, type ProjectIssue } from './parse';
export { defaultProject } from './defaults';
export { ID_PREFIXES, newId, usedIds, type IdList } from './ids';
export { parseEventsJsonl } from './events';
export { SEGMENTS_VERSION, SegmentsFileSchema, parseSegmentsJson, segmentOffsets, takeTime, type Segment, type SegmentsFile, type SegmentsFileParseResult } from './segments';
```

with:

```ts
} from './schema';
export { formatPath, parseProject, parseProjectJson, type ParseResult, type ProjectIssue } from './parse';
export { defaultProject } from './defaults';
export {
  TRANSCRIPT_VERSION,
  TranscriptFileSchema,
  TranscriptWordSchema,
  parseTranscriptJson,
  type TranscriptFile,
  type TranscriptParseResult,
  type TranscriptWord,
} from './transcript';
export { ID_PREFIXES, newId, usedIds, type IdList } from './ids';
export { parseEventsJsonl } from './events';
export { SEGMENTS_VERSION, SegmentsFileSchema, parseSegmentsJson, segmentOffsets, takeTime, type Segment, type SegmentsFile, type SegmentsFileParseResult } from './segments';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/project`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project
git commit -m "project: transcript.json and sources.transcript

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Speech in the core

**Files:**
- Create: `packages/core/src/speech/{models,whisper,levels,align,edits,transcribe,apply}.ts`, `packages/core/test/{speech,use-take}.test.ts`, `packages/core/test/fixtures/speech/*`
- Modify: `packages/core/src/{errors,index,use-take,recover}.ts`, `packages/core/src/suggest/plan.ts`, `vitest.config.ts`, `.gitattributes`

- [ ] **Step 1: The fixtures**

The spike's two text-to-speech recordings (`tts.ps1`: Windows' voices Hedda and Zira; "Äh", "Ähm", "Uh", "Um", "Nochmal", "Again" and pauses), as AAC like the recorder's mic. `SPIKE` is the spike's folder, with `fixtures/de.wav` and `fixtures/en.wav`:

```bash
SPIKE="${SPIKE:?the spike folder, with fixtures/de.wav and fixtures/en.wav}"
mkdir -p packages/core/test/fixtures/speech
for language in de en; do
  ffmpeg -hide_banner -loglevel error -y -i "$SPIKE/fixtures/$language.wav" -ar 48000 -ac 1 -c:a aac -b:a 64k "packages/core/test/fixtures/speech/$language.m4a"
done
```

The words' true starts from the voices' `SpeakProgress`, and whisper's own output for them (`small`, and `base` for English), as the spike wrote them:

`packages/core/test/fixtures/speech/de.words.json`:

```json
[{"t":0.100,"text":"Das"},{"t":0.345,"text":"ist"},{"t":0.545,"text":"Holofish"},{"t":2.460,"text":"Äh"},{"t":3.160,"text":"du"},{"t":3.335,"text":"fotografierst"},{"t":4.265,"text":"deinen"},{"t":4.585,"text":"Fang"},{"t":4.860,"text":"und"},{"t":5.050,"text":"bekommst"},{"t":5.580,"text":"eine"},{"t":5.805,"text":"Karte"},{"t":8.730,"text":"Ähm"},{"t":9.495,"text":"die"},{"t":9.675,"text":"App"},{"t":9.845,"text":"erkennt"},{"t":10.285,"text":"die"},{"t":10.410,"text":"Art."},{"t":11.635,"text":"Nochmal"},{"t":13.190,"text":"Die"},{"t":13.370,"text":"App"},{"t":13.545,"text":"erkennt"},{"t":13.960,"text":"die"},{"t":14.090,"text":"Art"},{"t":14.360,"text":"und"},{"t":14.570,"text":"misst"},{"t":14.795,"text":"die"},{"t":14.895,"text":"Länge"},{"t":16.970,"text":"Jeder"},{"t":17.280,"text":"Fang"},{"t":17.555,"text":"wird"},{"t":17.765,"text":"zu"},{"t":17.895,"text":"einer"},{"t":18.125,"text":"Karte"},{"t":19.170,"text":"von"},{"t":19.435,"text":"gewöhnlich"},{"t":19.975,"text":"bis"},{"t":20.190,"text":"mythisch"}]
```

`packages/core/test/fixtures/speech/en.words.json`:

```json
[{"t":0.100,"text":"This"},{"t":0.305,"text":"is"},{"t":0.440,"text":"Cuttle"},{"t":2.020,"text":"Uh"},{"t":2.620,"text":"it"},{"t":2.745,"text":"records"},{"t":3.215,"text":"your"},{"t":3.375,"text":"screen"},{"t":3.755,"text":"and"},{"t":3.910,"text":"edits"},{"t":4.245,"text":"the"},{"t":4.330,"text":"video"},{"t":4.730,"text":"for"},{"t":4.910,"text":"you"},{"t":7.555,"text":"Um"},{"t":8.225,"text":"it"},{"t":8.340,"text":"zooms"},{"t":8.695,"text":"on"},{"t":8.880,"text":"clicks"},{"t":10.290,"text":"Again"},{"t":11.650,"text":"It"},{"t":11.780,"text":"zooms"},{"t":12.135,"text":"on"},{"t":12.285,"text":"every"},{"t":12.555,"text":"click"},{"t":12.860,"text":"and"},{"t":12.980,"text":"cuts"},{"t":13.290,"text":"the"},{"t":13.375,"text":"pauses"},{"t":15.645,"text":"Your"},{"t":15.830,"text":"demo"},{"t":16.170,"text":"is"},{"t":16.325,"text":"finished"},{"t":16.735,"text":"when"},{"t":16.890,"text":"you"},{"t":17.020,"text":"stop"},{"t":17.380,"text":"recording"}]
```

`packages/core/test/fixtures/speech/de.small.txt`:

```
{"start":100,"end":400,"text":"Das"}
{"start":400,"end":790,"text":"ist"}
{"start":790,"end":1850,"text":"Holophis"}
{"start":1850,"end":2000,"text":"H."}
{"start":2000,"end":3200,"text":"E."}
{"start":3200,"end":3920,"text":"Du"}
{"start":3920,"end":4470,"text":"fotografierst"}
{"start":4470,"end":5000,"text":"seinen"}
{"start":5000,"end":5150,"text":"Fang"}
{"start":5150,"end":5300,"text":"und"}
{"start":5300,"end":6080,"text":"bekommst"}
{"start":6080,"end":6480,"text":"eine"}
{"start":6480,"end":7000,"text":"Karte."}
{"start":7000,"end":9000,"text":"M."}
{"start":9000,"end":9470,"text":"Die"}
{"start":9470,"end":9540,"text":"App"}
{"start":9540,"end":10170,"text":"erkennt"}
{"start":10170,"end":10440,"text":"die"}
{"start":10440,"end":11000,"text":"Art."}
{"start":11000,"end":13000,"text":"Nochmal."}
{"start":13000,"end":13250,"text":"Die"}
{"start":13250,"end":13590,"text":"App"}
{"start":13590,"end":14090,"text":"erkennt"}
{"start":14090,"end":14590,"text":"die"}
{"start":14590,"end":14590,"text":"Art"}
{"start":14590,"end":14840,"text":"und"}
{"start":14840,"end":15470,"text":"misst"}
{"start":15470,"end":15510,"text":"die"}
{"start":15510,"end":16000,"text":"Länge."}
{"start":16000,"end":16590,"text":"Jeder"}
{"start":16590,"end":16960,"text":"Fang"}
{"start":16960,"end":17650,"text":"wird"}
{"start":17650,"end":17650,"text":"zu"}
{"start":17650,"end":18310,"text":"einer"}
{"start":18310,"end":19150,"text":"Karte,"}
{"start":19150,"end":19220,"text":"von"}
{"start":19220,"end":19970,"text":"gewöhnlich"}
{"start":19970,"end":20280,"text":"bis"}
{"start":20280,"end":21000,"text":"mythisch."}
```

`packages/core/test/fixtures/speech/en.small.txt`:

```
{"start":130,"end":660,"text":"This"}
{"start":660,"end":1150,"text":"is"}
{"start":1150,"end":2000,"text":"Cuddle."}
{"start":2000,"end":2240,"text":"It"}
{"start":2240,"end":3090,"text":"records"}
{"start":3090,"end":4020,"text":"your"}
{"start":4020,"end":4620,"text":"screen"}
{"start":4620,"end":4660,"text":"and"}
{"start":4660,"end":5260,"text":"edits"}
{"start":5260,"end":5620,"text":"the"}
{"start":5620,"end":6280,"text":"video"}
{"start":6280,"end":6580,"text":"for"}
{"start":6580,"end":7500,"text":"you."}
{"start":7500,"end":8670,"text":"Um,"}
{"start":8670,"end":8670,"text":"it"}
{"start":8670,"end":9500,"text":"zooms"}
{"start":9500,"end":9520,"text":"on"}
{"start":9520,"end":10240,"text":"clicks."}
{"start":10240,"end":11600,"text":"Again."}
{"start":11600,"end":11820,"text":"It"}
{"start":11820,"end":12380,"text":"zooms"}
{"start":12380,"end":13170,"text":"on"}
{"start":13170,"end":13620,"text":"every"}
{"start":13620,"end":13740,"text":"click"}
{"start":13740,"end":14220,"text":"and"}
{"start":14220,"end":14570,"text":"cuts"}
{"start":14570,"end":14870,"text":"the"}
{"start":14870,"end":15600,"text":"pauses."}
{"start":15600,"end":15820,"text":"Your"}
{"start":15820,"end":16080,"text":"demo"}
{"start":16080,"end":16150,"text":"is"}
{"start":16150,"end":16820,"text":"finished"}
{"start":16820,"end":16820,"text":"when"}
{"start":16820,"end":16990,"text":"you"}
{"start":16990,"end":17620,"text":"stop"}
{"start":17620,"end":17940,"text":"recording."}
```

`packages/core/test/fixtures/speech/en.base.txt`:

```
{"start":130,"end":660,"text":"This"}
{"start":660,"end":1150,"text":"is"}
{"start":1150,"end":2000,"text":"Cuddle."}
{"start":2000,"end":2480,"text":"Uh,"}
{"start":2480,"end":2660,"text":"it"}
{"start":2660,"end":3870,"text":"records"}
{"start":3870,"end":4020,"text":"your"}
{"start":4020,"end":4620,"text":"screen"}
{"start":4620,"end":4890,"text":"and"}
{"start":4890,"end":5410,"text":"edits"}
{"start":5410,"end":5740,"text":"the"}
{"start":5740,"end":6290,"text":"video"}
{"start":6290,"end":6620,"text":"for"}
{"start":6620,"end":7000,"text":"you."}
{"start":7000,"end":7540,"text":"Um,"}
{"start":7540,"end":7810,"text":"it"}
{"start":7810,"end":8480,"text":"zooms"}
{"start":8480,"end":9020,"text":"on"}
{"start":9020,"end":10000,"text":"clicks."}
{"start":10000,"end":11000,"text":"Again."}
{"start":11000,"end":11210,"text":"It"}
{"start":11210,"end":11730,"text":"zooms"}
{"start":11730,"end":12460,"text":"on"}
{"start":12460,"end":12980,"text":"every"}
{"start":12980,"end":13020,"text":"click"}
{"start":13020,"end":13620,"text":"and"}
{"start":13620,"end":13750,"text":"cuts"}
{"start":13750,"end":14020,"text":"the"}
{"start":14020,"end":15000,"text":"pauses."}
{"start":15000,"end":15390,"text":"Your"}
{"start":15390,"end":15780,"text":"demo"}
{"start":15780,"end":16740,"text":"is"}
{"start":16740,"end":17020,"text":"finished"}
{"start":17020,"end":17130,"text":"when"}
{"start":17130,"end":17620,"text":"you"}
{"start":17620,"end":17810,"text":"stop"}
{"start":17810,"end":19000,"text":"recording."}
```

In `.gitattributes`, replace:

```
* text=auto eol=lf
*.png binary
*.mp4 binary
```

with:

```
* text=auto eol=lf
*.png binary
*.m4a binary
*.mp4 binary
```

- [ ] **Step 2: Keep the tests away from the user's models**

In `vitest.config.ts`, replace:

```ts
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { matchGolden } from './tools/vitest/golden-command.ts';
```

with:

```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { matchGolden } from './tools/vitest/golden-command.ts';
```

In the same file, replace:

```ts
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'skill/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.browser.test.ts'],
        },
      },
      {
```

with:

```ts
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'skill/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.browser.test.ts'],
          // No speech model unless a test asks for one: a take with a mic is never transcribed by chance.
          env: { CUTTLE_MODELS_DIR: join(tmpdir(), 'cuttle-test-no-models') },
        },
      },
      {
```

- [ ] **Step 3: Write the failing tests**

`packages/core/test/speech.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
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
const temp = (prefix = 'cuttle-speech-') => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const fixtures = join(import.meta.dirname, 'fixtures', 'speech');

describe('the whisper filter', () => {
  it("escapes an option value for both of ffmpeg's levels", () => {
    expect(filterValue('C:\\Users\\me\\ggml-small.bin')).toBe('C\\\\:/Users/me/ggml-small.bin');
    expect(filterValue("D:\\it's [a],b;c")).toBe("D\\\\:/it\\\\\\'s \\[a\\]\\,b\\;c");
    expect(filterValue('de', false)).toBe('de');
  });

  it('takes a path with every special character in a real filter graph', async () => {
    const dir = join(temp(), "a b,c;d [e] it's");
    mkdirSync(dir);
    const out = join(dir, 'meta.txt');
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=duration=0.2', '-af', `ametadata=mode=print:file=${filterValue(out)}`, '-f', 'null', '-']);
    expect(existsSync(out)).toBe(true);
  });

  it('reads its lines by pattern: unescaped quotes, CRLF, notes and punctuation are handled', () => {
    const text = [
      '{"start":100,"end":400,"text":" Das"}',
      '{"start":400,"end":790,"text":""Zitat""}\r',
      '{"start":790,"end":900,"text":"."}',
      '{"start":900,"end":1000,"text":"[BLANK_AUDIO]"}',
      '{"start":1000,"end":1200,"text":"(Musik)"}',
      'not a line',
      '{"start":1200,"end":1100,"text":"Ende."}',
    ].join('\n');
    expect(parseWhisperLines(text)).toEqual([
      { t: 0.1, end: 0.4, text: 'Das' },
      { t: 0.4, end: 0.79, text: '"Zitat"' },
      { t: 1.2, end: 1.2, text: 'Ende.' },
    ]);
    expect(normWord(' Ähm,')).toBe('ähm');
  });
});

/** Loudness values: `floor` dB, with `loud` dB over the given stretches. */
function levels(seconds: number, loud: [number, number][], floor = -60, level = -20): Float32Array {
  const values = new Float32Array(Math.round(seconds / LEVEL_SECONDS)).fill(floor);
  for (const [from, to] of loud) for (let i = Math.round(from / LEVEL_SECONDS); i < Math.round(to / LEVEL_SECONDS); i++) values[i] = level;
  return values;
}

describe('speechStretches', () => {
  it('finds the loud stretches, bridging short gaps and dropping clicks', () => {
    const found = speechStretches(levels(10, [[1, 2], [2.1, 3], [5, 5.03], [6, 7.5]]));
    expect(found).toEqual([
      { from: 1, to: 3 },
      { from: 6, to: 7.5 },
    ]);
  });

  it('finds none in a muted or steady track', () => {
    expect(speechStretches(levels(5, []))).toEqual([]);
    expect(speechStretches(levels(5, [[0, 5]]))).toEqual([]);
    expect(speechStretches(new Float32Array())).toEqual([]);
  });

  it('adapts to the noise floor', () => {
    // a noisy room: floor −35 dB, speech −10 dB
    expect(speechStretches(levels(10, [[2, 4]], -35, -10))).toEqual([{ from: 2, to: 4 }]);
  });
});

const word = (t: number, end: number, text: string): HeardWord => ({ t, end, text });

describe('alignWords', () => {
  it('puts each run of words into the stretch it fits, leaving a short one empty', () => {
    // whisper's times drift by about half a second; the mic says where the speech is
    const heard = [word(0.5, 0.9, 'Das'), word(0.9, 1.6, 'ist'), word(1.6, 2.4, 'Holofish.'), word(4.2, 4.8, 'Die'), word(4.8, 5.6, 'App'), word(5.6, 6.6, 'erkennt')];
    const stretches = [
      { from: 1, to: 2.4 },
      { from: 3, to: 3.4 },
      { from: 4.6, to: 6.4 },
    ];
    const result = alignWords(heard, stretches);
    expect(result.aligned).toBe(true);
    expect(result.words.map((w) => [w.text, w.t])).toEqual([
      ['Das', 1],
      ['ist', 1.329],
      ['Holofish.', 1.659],
      ['Die', 4.6],
      ['App', 5.05],
      ['erkennt', 5.5],
    ]);
    expect(result.sounds).toEqual([{ from: 3, to: 3.4 }]);
    expect(result.dropped).toEqual([]);
  });

  it('gives a likely filler the short stretch of its own that whisper put it beside', () => {
    // the English fixture with the base model: "Um," heard at 7.0–7.54 s, spoken at 7.55–7.84 s
    const heard = parseWhisperLines(readFileSync(join(fixtures, 'en.base.txt'), 'utf8'));
    const stretches = [[0.11, 0.88], [2.02, 2.24], [2.62, 5.22], [7.55, 7.84], [8.22, 9.45], [10.29, 10.83], [11.65, 14], [15.65, 17.98]].map(([from, to]) => ({ from: from!, to: to! }));
    expect(alignWords(heard, stretches).words.find((w) => w.text === 'Um,')?.t).toBe(8.22);
    const result = alignWords(heard, stretches, { filler: (w) => w.text === 'Um,' });
    expect(result.words.find((w) => w.text === 'Um,')).toEqual({ text: 'Um,', t: 7.55, end: 7.84 });
    expect(result.sounds).toEqual([]);
  });

  it('leaves out words heard where the mic is quiet', () => {
    const heard = [word(1, 1.5, 'Hallo'), word(1.5, 2, 'zusammen'), word(30, 31, 'Vielen'), word(31, 32, 'Dank.')];
    const result = alignWords(heard, [{ from: 1, to: 2.2 }]);
    expect(result.words.map((w) => w.text)).toEqual(['Hallo', 'zusammen']);
    expect(result.dropped.map((w) => w.text)).toEqual(['Vielen', 'Dank.']);
  });

  it("keeps whisper's times when there is no stretch, and gives the stretches as sounds when there is no word", () => {
    const heard = [word(1, 2, 'Hallo')];
    expect(alignWords(heard, [])).toEqual({ words: heard, sounds: [], dropped: [], aligned: false });
    expect(alignWords([], [{ from: 1, to: 2 }]).sounds).toEqual([{ from: 1, to: 2 }]);
  });

  it('is fast on an hour of speech', () => {
    const heard: HeardWord[] = [];
    const stretches: { from: number; to: number }[] = [];
    for (let t = 0; t < 3600; t += 4) {
      stretches.push({ from: t, to: t + 3 });
      for (let i = 0; i < 8; i++) heard.push(word(t + 0.3 + i * 0.37, t + 0.6 + i * 0.37, 'wort'));
    }
    const started = performance.now();
    const result = alignWords(heard, stretches);
    expect(result.aligned).toBe(true);
    expect(result.words).toHaveLength(heard.length);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('guesses German or English from common words', () => {
    const says = (text: string) => text.split(' ').map((w, i) => word(i, i + 0.5, w));
    expect(guessLanguage(says('Das ist die App und sie erkennt den Fisch'))).toBe('de');
    expect(guessLanguage(says('This is the app and it zooms on clicks'))).toBe('en');
    expect(guessLanguage(says('Holofish Cuttle'))).toBe('auto');
  });
});

/** Line up whisper's words on the TTS fixtures by the mic, and compare the starts with the truth. */
function startErrors(truth: { t: number; text: string }[], words: { t: number; text: string }[]): number[] {
  const a = truth.filter((w) => normWord(w.text));
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: words.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  const same = (i: number, j: number) => normWord(a[i - 1]!.text) === normWord(words[j - 1]!.text);
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= words.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (same(i, j) ? 0 : 1));
  const errors: number[] = [];
  for (let i = a.length, j = words.length; i > 0 && j > 0; ) {
    if (same(i, j) && d[i]![j] === d[i - 1]![j - 1]) {
      errors.push(Math.abs(a[i - 1]!.t - words[j - 1]!.t));
      i--;
      j--;
    } else if (d[i]![j] === d[i - 1]![j - 1]! + 1) (i--, j--);
    else if (d[i]![j] === d[i - 1]![j]! + 1) i--;
    else j--;
  }
  return errors.sort((x, y) => x - y);
}

describe('the alignment on spoken fixtures', () => {
  for (const [language, filler] of [['de', 8.73], ['en', 7.555]] as const) {
    it(`lines up the small model's words in ${language} and finds the filler it left out`, async () => {
      const heard = parseWhisperLines(readFileSync(join(fixtures, `${language}.small.txt`), 'utf8'));
      const truth = JSON.parse(readFileSync(join(fixtures, `${language}.words.json`), 'utf8')) as { t: number; text: string }[];
      const result = alignWords(heard, speechStretches(await micLevels(join(fixtures, `${language}.m4a`))), { filler: (w) => likelyFiller(w.text, language) });
      const before = startErrors(truth, heard);
      const after = startErrors(truth, result.words);
      const median = (errors: number[]) => errors[Math.floor(errors.length / 2)]!;
      expect(median(before)).toBeGreaterThan(0.2);
      expect(median(after)).toBeLessThan(0.1);
      expect(after[Math.floor(after.length * 0.9)]).toBeLessThan(0.25);
      // the filler whisper did not write is a sound of its own
      expect(result.sounds.some((sound) => Math.abs(sound.from - filler) < 0.1 && sound.to - sound.from < 0.8)).toBe(true);
    });
  }
});

const tw = (t: number, end: number, text: string): TranscriptWord => ({ t, end, text });
const input = (over: Partial<SpeechEditInput>): SpeechEditInput => ({ words: [], sounds: [], language: 'de', still: [{ from: 0, to: 60 }], events: [], clips: [{ from: 0, to: 60 }], ...over });

describe('filler and pause cuts', () => {
  it('knows the fillers of each language, and short spellings only alone between pauses', () => {
    const words = [tw(1, 1.3, 'Das'), tw(1.35, 1.6, 'ist'), tw(2, 2.3, 'äh,'), tw(2.6, 2.8, 'um'), tw(3, 3.3, 'E.'), tw(3.6, 3.8, 'zwölf'), tw(3.85, 4, 'm')];
    expect(fillerWords(words, 'de')).toEqual([2, 4]);
    // in English, "um" is a filler, and "äh" one of whisper's short spellings, alone between pauses
    expect(fillerWords(words, 'en')).toEqual([2, 3, 4]);
    // "um" is a German word and "er" a German pronoun: unknown language takes neither
    expect(fillerWords([tw(1, 1.2, 'um'), tw(2, 2.2, 'er')], 'auto')).toEqual([]);
    expect(fillerWords([tw(1, 1.2, 'Uh,')], 'auto')).toEqual([0]);
  });

  it('cuts a filler alone between pauses with a little room, where the picture rests', () => {
    const words = [tw(1, 1.5, 'Das'), tw(1.55, 1.8, 'ist'), tw(2.05, 2.4, 'ähm'), tw(2.6, 3, 'Cuttle')];
    expect(fillerCuts(input({ words }))).toEqual([{ from: 2, to: 2.45, auto: 'filler', label: 'Filler: ähm' }]);
    // inside running speech it stays: its time there is an estimate
    expect(fillerCuts(input({ words: [tw(1, 1.5, 'Das'), tw(1.5, 1.8, 'ist'), tw(1.8, 2.1, 'ähm'), tw(2.1, 2.6, 'Cuttle')] }))).toEqual([]);
    // a key pressed, a click, a scroll or the pointer moving away: the picture does not rest
    const at = (event: InputEvent) => fillerCuts(input({ words, events: [event] }));
    expect(at({ t: 2.5, type: 'keys', count: 1 })).toEqual([]);
    expect(at({ t: 1.9, type: 'click', x: 1, y: 1, button: 'left' })).toEqual([]);
    expect(fillerCuts(input({ words, events: [{ t: 1, type: 'move', x: 100, y: 100 }, { t: 2.2, type: 'move', x: 160, y: 100 }] }))).toEqual([]);
    // a few pixels of jitter, or a move long before, are fine
    expect(fillerCuts(input({ words, events: [{ t: 1, type: 'move', x: 100, y: 100 }, { t: 2.2, type: 'move', x: 104, y: 101 }] }))).toHaveLength(1);
    // the screen changing, or the cut leaving the clip
    expect(fillerCuts(input({ words, still: [{ from: 0, to: 2.3 }] }))).toEqual([]);
    expect(fillerCuts(input({ words, clips: [{ from: 0, to: 2.2 }] }))).toEqual([]);
  });

  it('cuts a short sound without a word, and fillers in a row as one', () => {
    const words = [tw(1, 1.5, 'Karte'), tw(3, 3.3, 'Die'), tw(3.6, 3.75, 'äh'), tw(3.75, 3.9, 'ähm'), tw(4.2, 4.5, 'App')];
    const sounds = [{ from: 2, to: 2.4 }, { from: 5, to: 6 }];
    expect(fillerCuts(input({ words, sounds }))).toEqual([
      { from: 1.95, to: 2.45, auto: 'filler', label: 'Filler (a sound)' },
      { from: 3.55, to: 3.95, auto: 'filler', label: 'Filler: äh, ähm' },
    ]);
  });

  it('cuts a pause down to 0.4 s where the picture rests, around clicks and sounds', () => {
    const words = [tw(1, 2, 'Erstens'), tw(5, 6, 'zweitens')];
    expect(pauseCuts(input({ words }))).toEqual([{ from: 2.2, to: 4.8, auto: 'pause', label: 'Pause: 3.0 s' }]);
    // a click in the middle: the pause around it is cut on both sides of it
    expect(pauseCuts(input({ words, events: [{ t: 3.5, type: 'click', x: 1, y: 1, button: 'left' }] })).map((cut) => [cut.from, cut.to])).toEqual([
      [2.2, 3.3],
      [3.7, 4.8],
    ]);
    // the screen moves from 3 s to 4 s (a page loading): only the still parts go
    expect(pauseCuts(input({ words, still: [{ from: 0, to: 3 }, { from: 4, to: 60 }] })).map((cut) => [cut.from, cut.to])).toEqual([
      [2.2, 2.8],
      [4.2, 4.8],
    ]);
    // shorter than a second: no pause
    expect(pauseCuts(input({ words: [tw(1, 2, 'eins'), tw(2.9, 3.5, 'zwei')] }))).toEqual([]);
  });

  it('takes a short sound in a pause with the pause, and keeps a long one', () => {
    const words = [tw(1, 2, 'Erstens'), tw(5, 6, 'zweitens')];
    const cuts = speechCuts(input({ words, sounds: [{ from: 3.2, to: 3.5 }] }), { fillers: true, pauses: true });
    expect(cuts.map((cut) => [cut.auto, cut.from, cut.to])).toEqual([['pause', 2.2, 4.8]]);
    expect(pauseCuts(input({ words, sounds: [{ from: 3, to: 4 }] })).map((cut) => [cut.from, cut.to])).toEqual([
      [2.2, 2.9],
      [4.1, 4.8],
    ]);
    expect(speechCuts(input({ words, sounds: [{ from: 3.2, to: 3.5 }] }), { fillers: true, pauses: false }).map((cut) => cut.auto)).toEqual(['filler']);
    expect(restingAt({ from: 1, to: 2 }, { still: [], events: [] })).toBe(false);
  });
});

describe('mergeCuts', () => {
  it('replaces the tagged cuts of its kinds (keeping the ids and switches of the same cuts), keeps the others and stays clear of them', () => {
    const raw = [
      { id: 'c1', from: 1, to: 2, auto: 'filler', label: 'Filler: äh' },
      { id: 'c2', from: 4, to: 5, label: 'My cut' },
      { id: 'c3', from: 7, to: 8, auto: 'pause', enabled: false },
      { id: 'c4', from: 10, to: 11, auto: 'retake' },
    ];
    const made = [
      { from: 1.1, to: 1.9, auto: 'filler' as const, label: 'Filler: äh' },
      { from: 4.5, to: 4.8, auto: 'filler' as const, label: 'Filler: ähm' },
      { from: 7.2, to: 8, auto: 'pause' as const, label: 'Pause: 1.4 s' },
      { from: 12, to: 12.3, auto: 'filler' as const, label: 'Filler (a sound)' },
    ];
    const taken = new Set(['c1', 'c2', 'c3', 'c4', 's1']);
    const { cuts, added, kept } = mergeCuts(raw, made, ['filler', 'pause'], taken);
    expect(kept).toBe(2);
    expect(cuts).toEqual([
      { id: 'c1', label: 'Filler: äh', from: 1.1, to: 1.9, auto: 'filler' },
      { id: 'c2', from: 4, to: 5, label: 'My cut' },
      { id: 'c3', label: 'Pause: 1.4 s', from: 7.2, to: 8, enabled: false, auto: 'pause' },
      { id: 'c4', from: 10, to: 11, auto: 'retake' },
      { id: 'c5', label: 'Filler (a sound)', from: 12, to: 12.3, auto: 'filler' },
    ]);
    expect(added).toHaveLength(3);
  });
});

describe('suggestClips with speech', () => {
  it('keeps someone speaking over a still screen, and never speeds speech up', () => {
    const keys = (...times: number[]): InputEvent[] => times.map((t) => ({ t, type: 'keys', count: 1 }));
    // typing at 1–2 s and 30–31 s; the screen rests in between; someone talks from 10 to 16 s
    const without = suggestClips({ duration: 40, events: keys(1, 2, 30, 31), markers: [], still: [{ from: 0, to: 40 }] });
    expect(without.clips.map((clip) => [clip.from, clip.to])).toEqual([
      [0.2, 2.8],
      [29.2, 32.3],
    ]);
    const spoken = suggestClips({ duration: 40, events: keys(1, 2, 30, 31), markers: [], still: [{ from: 0, to: 40 }], speech: [{ from: 10, to: 16 }] });
    expect(spoken.clips.map((clip) => [clip.from, clip.to, clip.speed])).toEqual([
      [0.2, 2.8, 1],
      [9.2, 16.8, 1],
      [29.2, 32.3, 1],
    ]);
    // Claude at work (the screen changes, no input) is sped up around the speech, not over it
    const markers = [{ t: 3, kind: 'prompt' as const }, { t: 60, kind: 'answer' as const }];
    const working = suggestClips({ duration: 70, events: keys(2, 3), markers, still: [], speech: [{ from: 30, to: 34 }] });
    const over = working.clips.filter((clip) => clip.from < 34 && 30 < clip.to);
    expect(over.every((clip) => clip.speed === 1)).toBe(true);
    // before the speech, and before and after the answer
    expect(working.clips.filter((clip) => clip.speed > 1)).toHaveLength(3);
  });
});

describe('downloadFile', () => {
  const body = Buffer.from('a speech model, or rather a few bytes of one');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const serve = async (send: (res: import('node:http').ServerResponse) => void) => {
    const server = createServer((_req, res) => send(res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as { port: number };
    return { url: `http://127.0.0.1:${port}/ggml-test.bin`, close: () => new Promise((resolve) => server.close(resolve)) };
  };

  it('writes the file once its size and checksum match, with progress', async () => {
    const server = await serve((res) => res.end(body));
    const path = join(temp(), 'models', 'ggml-test.bin');
    const seen: number[] = [];
    await downloadFile(server.url, path, { bytes: body.length, sha256 }, { onProgress: (received) => seen.push(received) });
    await server.close();
    expect(readFileSync(path)).toEqual(body);
    expect(seen.at(-1)).toBe(body.length);
  });

  it('keeps nothing of a download that is cut short or does not match', async () => {
    const dir = temp();
    const short = await serve((res) => res.end(body.subarray(0, 10)));
    await expect(downloadFile(short.url, join(dir, 'a.bin'), { bytes: body.length, sha256 })).rejects.toThrow(/ended at 10 of/);
    await short.close();
    const wrong = await serve((res) => res.end(Buffer.from(body).fill(0x62, 0, 1)));
    await expect(downloadFile(wrong.url, join(dir, 'b.bin'), { bytes: body.length, sha256 })).rejects.toThrow(/checksum/);
    await wrong.close();
    const missing = await serve((res) => {
      res.statusCode = 404;
      res.end();
    });
    await expect(downloadFile(missing.url, join(dir, 'c.bin'), { bytes: body.length, sha256 })).rejects.toThrow(/HTTP 404/);
    await missing.close();
    expect(existsSync(join(dir, 'a.bin')) || existsSync(join(dir, 'a.bin.part')) || existsSync(join(dir, 'b.bin'))).toBe(false);
  });

  it('stops when cancelled', async () => {
    const server = await serve((res) => {
      res.write(body.subarray(0, 5)); // and never ends
    });
    const controller = new AbortController();
    const path = join(temp(), 'd.bin');
    const download = downloadFile(server.url, path, { bytes: body.length, sha256 }, { signal: controller.signal, onProgress: () => controller.abort() });
    await expect(download).rejects.toMatchObject({ code: 'cancelled' });
    await server.close();
    expect(existsSync(`${path}.part`)).toBe(false);
  });
});
```

`packages/core/test/use-take.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import type { ProjectFile } from '../src/project-file';
import { useTake } from '../src/use-take';

/** A project file as read, with the edit of its first take. */
function fileWith(raw: Record<string, unknown>): ProjectFile {
  const parsed = parseProject(raw);
  if (!parsed.ok) throw new Error('invalid');
  return { dir: '/demo', path: '/demo/cuttle.json', raw: structuredClone(raw), project: parsed.project };
}

const first = {
  version: 1,
  sources: { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a', transcript: 'takes/1/transcript.json' },
  scenes: [{ type: 'clip', from: 0, to: 10 }],
  cuts: [{ id: 'c1', from: 2, to: 2.4, auto: 'filler' }],
};

describe('useTake', () => {
  it("drops the previous take's cuts (and its transcript) with its other edits", () => {
    const file = fileWith(first);
    const hadEdit = useTake(file, { screen: 'takes/2/screen.mp4', mic: 'takes/2/mic.m4a', seconds: 8 });
    expect(hadEdit).toBe(true);
    expect(file.raw).toEqual({ version: 1, sources: { screen: 'takes/2/screen.mp4', mic: 'takes/2/mic.m4a' }, scenes: [{ type: 'clip', from: 0, to: 8 }] });
  });

  it('counts cuts alone as an edit, and keeps them and the transcript for the same take (recover)', () => {
    const file = fileWith({ ...first, scenes: [] });
    expect(useTake(fileWith({ version: 1, sources: first.sources, cuts: first.cuts }), { screen: 'takes/1/screen.mp4', seconds: 10 })).toBe(true);
    useTake(file, { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a', transcript: 'takes/1/transcript.json', seconds: 10 }, true);
    expect(file.raw.cuts).toEqual(first.cuts);
    expect((file.raw.sources as { transcript?: string }).transcript).toBe('takes/1/transcript.json');
  });
});
```

Run: `pnpm exec vitest run --project node packages/core/test/speech.test.ts packages/core/test/use-take.test.ts`
Expected: FAIL: `../src/speech/align` does not exist, and a new take keeps the cuts.

- [ ] **Step 4: The error codes**

In `packages/core/src/errors.ts`, replace:

```ts
/** Why a project operation failed; the CLI maps the code to its exit code, the app shows the message. */
export type CoreErrorCode = 'usage' | 'invalid-project' | 'missing-file' | 'invalid-media' | 'ffmpeg-missing' | 'conflict';

/** A failure of a project operation (reading a project, running ffmpeg, a take that cannot be used). */
export class CoreError extends Error {
```

with:

```ts
/** Why a project operation failed; the CLI maps the code to its exit code, the app shows the message. */
export type CoreErrorCode =
  | 'usage'
  | 'invalid-project'
  | 'missing-file'
  | 'invalid-media'
  | 'ffmpeg-missing'
  | 'conflict'
  /** No speech model is downloaded, or not the one asked for. */
  | 'model-missing'
  /** A model download failed (network, size, checksum). */
  | 'download'
  /** ffmpeg has no `whisper` filter (before 8.0, or a build without it). */
  | 'ffmpeg-old'
  | 'cancelled';

/** A failure of a project operation (reading a project, running ffmpeg, a take that cannot be used). */
export class CoreError extends Error {
```

- [ ] **Step 5: The models**

`packages/core/src/speech/models.ts`:

```ts
// The speech models: whisper.cpp's ggml files, downloaded once when the person asks, checked by
// size and SHA-256, and kept in one folder for the app and the CLI.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CoreError } from '../errors';

export const MODEL_NAMES = ['base', 'small', 'large-v3-turbo-q5_0'] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

export interface SpeechModel {
  name: ModelName;
  /** What the settings call it. */
  label: 'Fast' | 'Good' | 'Best';
  bytes: number;
  sha256: string;
  /** About this many seconds of speech per second of work (the spike's machine, GPU on). */
  realtime: number;
  note: string;
}

/** The models, fastest first; `small` is the default. Sizes and hashes from the files' Git LFS pointers. */
export const SPEECH_MODELS: readonly SpeechModel[] = [
  {
    name: 'base',
    label: 'Fast',
    bytes: 147_951_465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    realtime: 20,
    note: 'good for English, weak for German',
  },
  {
    name: 'small',
    label: 'Good',
    bytes: 487_601_967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    realtime: 5,
    note: 'German and English, about 5× real time',
  },
  {
    name: 'large-v3-turbo-q5_0',
    label: 'Best',
    bytes: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    realtime: 2.6,
    note: 'the most accurate, about 2.6× real time',
  },
];

export const DEFAULT_MODEL: ModelName = 'small';

export function speechModel(name: string): SpeechModel {
  const model = SPEECH_MODELS.find((entry) => entry.name === name);
  if (!model) throw new CoreError('usage', `unknown speech model "${name}" (one of ${MODEL_NAMES.join(', ')})`);
  return model;
}

/**
 * Where a model is downloaded from: whisper.cpp's models on Hugging Face, or `CUTTLE_MODELS_URL`
 * (a folder URL ending in `/`, for the app's checks). The pinned size and SHA-256 hold either way.
 */
export const modelUrl = (name: ModelName) => `${process.env.CUTTLE_MODELS_URL || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/'}ggml-${name}.bin`;

/**
 * The folder the models are kept in: `CUTTLE_MODELS_DIR` when set, else the user's local app data
 * (Windows: `%LOCALAPPDATA%\Cuttle\models`; macOS: `~/Library/Application Support/Cuttle/models`;
 * elsewhere `$XDG_DATA_HOME/cuttle/models`). The app and the CLI share it.
 */
export function modelsDir(): string {
  if (process.env.CUTTLE_MODELS_DIR) return process.env.CUTTLE_MODELS_DIR;
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Cuttle', 'models');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Cuttle', 'models');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'cuttle', 'models');
}

export const modelPath = (name: ModelName) => join(modelsDir(), `ggml-${name}.bin`);

/** Whether a model's file is there at its full size (the hash was checked when it was downloaded). */
export async function modelInstalled(name: ModelName): Promise<boolean> {
  try {
    return (await stat(modelPath(name))).size === speechModel(name).bytes;
  } catch {
    return false;
  }
}

export async function installedModels(): Promise<ModelName[]> {
  const present = await Promise.all(MODEL_NAMES.map((name) => modelInstalled(name)));
  return MODEL_NAMES.filter((_, i) => present[i]);
}

/**
 * The model to transcribe with: `wanted` when it is installed (an error when not), else the
 * default when installed, else the most accurate one installed; undefined when there is none.
 */
export async function chooseModel(wanted?: string): Promise<ModelName | undefined> {
  if (wanted !== undefined) {
    const { name } = speechModel(wanted);
    if (!(await modelInstalled(name))) throw new CoreError('model-missing', `the speech model "${name}" is not downloaded: run "cuttle models download ${name}"`);
    return name;
  }
  const installed = await installedModels();
  if (installed.includes(DEFAULT_MODEL)) return DEFAULT_MODEL;
  return installed.at(-1);
}

export interface DownloadOptions {
  onProgress?: (received: number, total: number) => void;
  signal?: AbortSignal;
}

/** Downloads a model into `modelsDir()`, checking its size and SHA-256; a model already there is kept. */
export async function downloadModel(name: ModelName, options: DownloadOptions = {}): Promise<string> {
  const model = speechModel(name);
  const path = modelPath(name);
  if (await modelInstalled(name)) return path;
  await downloadFile(modelUrl(name), path, { bytes: model.bytes, sha256: model.sha256 }, options);
  return path;
}

/**
 * Downloads `url` to `path` through `<path>.part`, renamed only once the size and SHA-256 match:
 * a broken or cancelled download never passes for a model.
 */
export async function downloadFile(url: string, path: string, expect: { bytes: number; sha256: string }, options: DownloadOptions = {}): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const part = `${path}.part`;
  try {
    let response: Response;
    try {
      response = await fetch(url, { redirect: 'follow', ...(options.signal && { signal: options.signal }) });
    } catch (error) {
      if (options.signal?.aborted) throw cancelled();
      throw new CoreError('download', `the download from ${url} failed: ${(error as Error).message}`);
    }
    if (!response.ok || !response.body) throw new CoreError('download', `the download from ${url} failed: HTTP ${response.status}`);
    const hash = createHash('sha256');
    const out = createWriteStream(part);
    let received = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > expect.bytes) throw new CoreError('download', `the download from ${url} is larger than the ${expect.bytes} bytes expected`);
        hash.update(value);
        if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));
        options.onProgress?.(received, expect.bytes);
      }
    } catch (error) {
      if (options.signal?.aborted) throw cancelled();
      throw error instanceof CoreError ? error : new CoreError('download', `the download from ${url} broke off: ${(error as Error).message}`);
    } finally {
      await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    }
    if (received !== expect.bytes) throw new CoreError('download', `the download from ${url} ended at ${received} of ${expect.bytes} bytes`);
    if (hash.digest('hex') !== expect.sha256) throw new CoreError('download', `the download from ${url} does not match its checksum`);
    await rename(part, path);
  } catch (error) {
    await rm(part, { force: true }).catch(() => {});
    throw error;
  }
}

const cancelled = () => new CoreError('cancelled', 'the download was cancelled');

/** Removes a downloaded model. */
export async function removeModel(name: ModelName): Promise<void> {
  await rm(modelPath(speechModel(name).name), { force: true });
}
```

- [ ] **Step 6: Whisper**

`packages/core/src/speech/whisper.ts`:

```ts
// One run of ffmpeg's `whisper` filter over a track: its option values escaped for the filter
// graph, its JSON lines read by pattern (the filter does not escape the text), progress from
// `-progress`.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreError } from '../errors';
import { ffmpegPath, runFfmpeg } from '../ffmpeg';

/** A word as whisper wrote it, in seconds of the track it heard. */
export interface HeardWord {
  t: number;
  end: number;
  text: string;
}

/**
 * A value for a filter option inside `-af`, escaped for both levels ffmpeg parses: the option list
 * (`\`, `'` and `:` are special) and the filter graph around it (`\`, `'`, `[`, `]`, `,`, `;`).
 * Backslashes in Windows paths become slashes first, which ffmpeg takes on every platform.
 */
export function filterValue(value: string, path = true): string {
  const plain = path ? value.replaceAll('\\', '/') : value;
  const option = plain.replace(/[\\':]/g, '\\$&');
  return option.replace(/[\\'[\],;]/g, '\\$&');
}

/** Letters and digits only, lower case: how words are compared. */
export const normWord = (text: string) => text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The words of the filter's `format=json` output, one per line: `{"start":ms,"end":ms,"text":"…"}`.
 * The text is not escaped (a quotation mark in the speech is written as is), so each line is read
 * with a pattern. Lines without a letter or digit and whisper's notes in brackets (`[BLANK_AUDIO]`,
 * `(Musik)`) are not words.
 */
export function parseWhisperLines(text: string): HeardWord[] {
  const words: HeardWord[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\{"start":(\d+),"end":(\d+),"text":"(.*)"\}\s*$/.exec(line);
    if (!match) continue;
    const word = match[3]!.trim();
    if (!normWord(word) || /^[[(*].*[\])*]$/.test(word)) continue;
    const t = Number(match[1]) / 1000;
    words.push({ t, end: Math.max(t, Number(match[2]) / 1000), text: word });
  }
  return words;
}

let whisperChecked: Promise<boolean> | undefined;

/**
 * Whether the ffmpeg in use has the `whisper` filter (ffmpeg 8 or later, built with whisper.cpp).
 * The answer is kept; `fresh` asks ffmpeg again (the app, after ffmpeg was updated).
 */
export function hasWhisper(fresh = false): Promise<boolean> {
  if (fresh) whisperChecked = undefined;
  whisperChecked ??= runFfmpeg(['-filters']).then(
    ({ stdout }) => /^\s*\S+\s+whisper\s/m.test(stdout.toString('utf8')),
    (error: unknown) => {
      whisperChecked = undefined;
      throw error;
    },
  );
  return whisperChecked;
}

export interface WhisperOptions {
  model: string;
  /** `auto`, or a language code such as `de` or `en`. */
  language: string;
  /** Seconds of the track, for the progress. */
  seconds: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Transcribes the first audio stream of `input` in one run: 30 s windows (shorter ones break words
 * at their edges), one word per line, on the GPU where there is one.
 */
export async function runWhisper(input: string, options: WhisperOptions): Promise<HeardWord[]> {
  if (!(await hasWhisper())) {
    throw new CoreError('ffmpeg-old', 'this ffmpeg cannot transcribe: it has no whisper filter (ffmpeg 8 or later). Update it: winget upgrade Gyan.FFmpeg (macOS: brew upgrade ffmpeg)');
  }
  const dir = await mkdtemp(join(tmpdir(), 'cuttle-whisper-'));
  const out = join(dir, 'words.json');
  try {
    const filter = [
      `whisper=model=${filterValue(options.model)}`,
      `language=${filterValue(options.language, false)}`,
      'format=json',
      `destination=${filterValue(out)}`,
      'max_len=1',
      'queue=30',
      'use_gpu=1',
    ].join(':');
    await new Promise<void>((resolve, reject) => {
      if (options.signal?.aborted) return reject(cancelled());
      const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-i', input, '-map', '0:a:0', '-af', filter, '-f', 'null', '-'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const abort = () => child.kill();
      options.signal?.addEventListener('abort', abort, { once: true });
      let stderr = '';
      let buffered = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffered += chunk;
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          const match = /^out_time_us=(\d+)$/.exec(line.trim());
          if (match && options.seconds > 0) options.onProgress?.(Math.min(1, Number(match[1]) / 1e6 / options.seconds));
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-4000)));
      child.on('error', (error: NodeJS.ErrnoException) =>
        reject(error.code === 'ENOENT' ? new CoreError('ffmpeg-missing', `ffmpeg was not found (looked for "${ffmpegPath()}")`) : error),
      );
      child.on('close', (code) => {
        options.signal?.removeEventListener('abort', abort);
        if (options.signal?.aborted) return reject(cancelled());
        if (code === 0) return resolve();
        reject(new CoreError('invalid-media', `transcribing ${input} failed (exit code ${code}):\n${stderr.trim().split(/\r?\n/).slice(-6).join('\n')}`));
      });
    });
    return parseWhisperLines(await readFile(out, 'utf8').catch(() => ''));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const cancelled = () => new CoreError('cancelled', 'the transcription was cancelled');
```

- [ ] **Step 7: The mic's speech stretches**

`packages/core/src/speech/levels.ts`:

```ts
// Where the mic hears someone: the track's loudness every 10 ms, and the stretches clearly louder
// than its quiet floor. No model needed; `suggest` keeps speech, and the alignment places words in
// these stretches.
import { spawn } from 'node:child_process';
import { CoreError } from '../errors';
import { ffmpegPath } from '../ffmpeg';
import type { Span } from '../suggest/spans';

/** Seconds per loudness value. */
export const LEVEL_SECONDS = 0.01;
const RATE = 8000;
const WINDOW = RATE * LEVEL_SECONDS;
/** Quieter than this counts as this (digital silence has no level). */
const FLOOR_DB = -100;

/** The loudness of the first audio stream every `LEVEL_SECONDS`, in dB of full scale (RMS). */
export function micLevels(path: string, signal?: AbortSignal): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    const levels: number[] = [];
    let sum = 0;
    let count = 0;
    let odd: number | undefined;
    const sample = (value: number) => {
      sum += value * value;
      if (++count === WINDOW) {
        levels.push(toDb(sum / count));
        sum = 0;
        count = 0;
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      let i = 0;
      if (odd !== undefined && chunk.length > 0) {
        sample(((odd | (chunk[0]! << 8)) << 16) >> 16);
        odd = undefined;
        i = 1;
      }
      for (; i + 1 < chunk.length; i += 2) sample(((chunk[i]! | (chunk[i + 1]! << 8)) << 16) >> 16);
      if (i < chunk.length) odd = chunk[i];
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-2000)));
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(error.code === 'ENOENT' ? new CoreError('ffmpeg-missing', `ffmpeg was not found (looked for "${ffmpegPath()}")`) : error),
    );
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new CoreError('cancelled', 'cancelled'));
      if (code !== 0) return reject(new CoreError('invalid-media', `reading the mic track ${path} failed:\n${stderr.trim()}`));
      if (count > 0) levels.push(toDb(sum / count));
      resolve(Float32Array.from(levels));
    });
  });
}

const toDb = (meanSquare: number) => (meanSquare > 0 ? Math.max(FLOOR_DB, 10 * Math.log10(meanSquare / 32768 ** 2)) : FLOOR_DB);

export const SPEECH_RULES = {
  /** A quieter gap shorter than this does not split a stretch (between words, stops like "t"). */
  minSilence: 0.25,
  /** A louder run shorter than this is not a stretch (a click). */
  minSound: 0.06,
  /** The loud level is the take's 98th percentile, the floor its 10th; the threshold lies halfway, in dB. */
  share: 0.5,
  /** Less than this between the floor and the loud level: nobody spoke (a muted mic, steady noise). */
  minRange: 12,
};

function percentile(sorted: Float32Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]!;
}

/**
 * The stretches that are clearly louder than the track's quiet floor: the threshold lies halfway
 * (in dB) between its 10th and 98th percentile, gaps shorter than `minSilence` are bridged, and
 * runs shorter than `minSound` dropped. None when the track hardly varies (a muted mic).
 */
export function speechStretches(levels: Float32Array, rules = SPEECH_RULES): Span[] {
  if (levels.length === 0) return [];
  const sorted = Float32Array.from(levels).sort();
  const floor = percentile(sorted, 0.1);
  const loud = percentile(sorted, 0.98);
  if (loud - floor < rules.minRange) return [];
  const threshold = floor + rules.share * (loud - floor);
  const runs: Span[] = [];
  let start: number | undefined;
  for (let i = 0; i <= levels.length; i++) {
    const on = i < levels.length && levels[i]! >= threshold;
    if (on && start === undefined) start = i;
    else if (!on && start !== undefined) {
      runs.push({ from: start * LEVEL_SECONDS, to: i * LEVEL_SECONDS });
      start = undefined;
    }
  }
  const merged: Span[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && run.from - last.to < rules.minSilence) last.to = run.to;
    else merged.push({ ...run });
  }
  return merged.filter((span) => span.to - span.from >= rules.minSound).map((span) => ({ from: round(span.from), to: round(span.to) }));
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
```

- [ ] **Step 8: The alignment**

`packages/core/src/speech/align.ts`:

```ts
// Word times from one whisper run (good text, coarse times) refined by the audio: each speech
// stretch takes, in order, the run of words whose letters fit its length at the take's speaking rate,
// near where whisper put them; inside a stretch the words share its length by their letters. In the
// spike this cut the median start error from about 500 ms to 35 to 76 ms.
import type { Span } from '../suggest/spans';
import { normWord, type HeardWord } from './whisper';

export const ALIGN_RULES = {
  /** A stretch shorter than this may take no word, cheaply: a filler whisper left out, a cough, a click. */
  shortSound: 0.8,
  /** What an empty short stretch costs; a longer one costs twice its length. */
  shortSoundCost: 0.15,
  /** Words whisper put further than this (seconds) from a stretch never go into it. */
  band: 10,
  /**
   * What leaving a word out costs: a word heard where the mic was quiet (whisper makes up words
   * in silence, such as a closing "Vielen Dank.") fits no stretch and is dropped.
   */
  drop: 1.5,
  /**
   * What a likely filler costs in a stretch it shares with other words: a filler usually has a short
   * stretch of its own, and whisper often puts it a little early or late.
   */
  fillerShared: 0.3,
};

export interface Alignment {
  words: HeardWord[];
  /** The stretches that took no word. */
  sounds: Span[];
  /** Words left out: heard where no stretch could take them. */
  dropped: HeardWord[];
  /** False when the words could not be fitted at all (whisper's times are kept). */
  aligned: boolean;
}

const MAX_DROPPED = 40;
const letters = (word: HeardWord) => normWord(word.text).length + 1;
const middle = (word: HeardWord) => (word.t + word.end) / 2;

/**
 * Aligns `words` (whisper's, in order) to `stretches` (the mic's, in order, not overlapping) by
 * dynamic programming over (stretch, words placed so far). Cost of a stretch [a, b] taking words
 * i…j−1: how far their letters at the take's rate miss its length, plus how far whisper put them
 * outside it on average, plus `fillerShared` for each likely filler (`options.filler`) in a run of
 * several; a stretch may take none, and a word may be left out (`drop`). Words further
 * than `band` from a stretch are never placed in it, which keeps an hour-long take fast.
 */
export function alignWords(
  words: readonly HeardWord[],
  stretches: readonly Span[],
  options: { rules?: typeof ALIGN_RULES; filler?: (word: HeardWord) => boolean } = {},
): Alignment {
  const rules = options.rules ?? ALIGN_RULES;
  const filler = words.map((word) => options.filler?.(word) ?? false);
  const W = words.length;
  const S = stretches.length;
  const unchanged = (): Alignment => ({ words: words.map((word) => ({ ...word })), sounds: [], dropped: [], aligned: false });
  if (W === 0) return { words: [], sounds: stretches.map((span) => ({ ...span })), dropped: [], aligned: true };
  if (S === 0) return unchanged();
  const speechTotal = stretches.reduce((sum, span) => sum + (span.to - span.from), 0);
  const rate = speechTotal / words.reduce((sum, word) => sum + letters(word), 0);

  let state = new Float64Array(W + 1).fill(Infinity);
  state[0] = 0;
  let lo = 0;
  let hi = 0;
  /** Per layer (before stretch k; k = S after the last): states reached by leaving out the word before them. */
  const drops: { lo: number; marks: Uint8Array }[] = [];
  /** Per stretch: for each state after it, the state before it. */
  const back: { lo: number; from: Int32Array }[] = [];
  const leaveOut = () => {
    const marks = new Uint8Array(W + 1 - lo);
    // at most `MAX_DROPPED` words in a row past the states reached: a longer run is never cheaper
    const limit = Math.min(W, hi + MAX_DROPPED);
    for (let i = lo; i < limit; i++) {
      if (state[i]! + rules.drop < state[i + 1]!) {
        state[i + 1] = state[i]! + rules.drop;
        marks[i + 1 - lo] = 1;
        if (i + 1 > hi) hi = i + 1;
      }
    }
    drops.push({ lo, marks });
  };
  for (let k = 0; k < S; k++) {
    leaveOut();
    const { from: a, to: b } = stretches[k]!;
    const len = b - a;
    const cur = new Float64Array(W + 1).fill(Infinity);
    const from = new Int32Array(W + 1).fill(-1);
    const empty = len < rules.shortSound ? rules.shortSoundCost : len * 2;
    let nextLo = W + 1;
    let nextHi = -1;
    const relax = (i: number, j: number, cost: number) => {
      if (cost < cur[j]!) {
        cur[j] = cost;
        from[j] = i;
        if (j < nextLo) nextLo = j;
        if (j > nextHi) nextHi = j;
      }
    };
    for (let i = lo; i <= hi; i++) {
      const base = state[i]!;
      if (base === Infinity) continue;
      relax(i, i, base + empty);
      // A word whisper put far before this stretch is not placed in it (only left out).
      if (i < W && middle(words[i]!) < a - rules.band) continue;
      let chars = 0;
      let far = 0;
      let fillers = 0;
      for (let j = i + 1; j <= W; j++) {
        const word = words[j - 1]!;
        const mid = middle(word);
        if (mid > b + rules.band) break;
        chars += letters(word);
        far += mid < a ? a - mid : mid > b ? mid - b : 0;
        if (filler[j - 1]) fillers++;
        relax(i, j, base + Math.abs(len - chars * rate) + far / (j - i) + (j - i > 1 ? fillers * rules.fillerShared : 0));
        // Far more letters than fit: longer runs only cost more.
        if (chars * rate > len * 3 + 2) break;
      }
    }
    if (nextHi < 0) return unchanged();
    back.push({ lo: nextLo, from: from.slice(nextLo, nextHi + 1) });
    state = cur;
    lo = nextLo;
    hi = nextHi;
  }
  hi = W; // the words after the last stretch can only be left out
  leaveOut();
  if (state[W] === Infinity) return unchanged();

  const groups: [number, number][] = new Array(S);
  const dropped: HeardWord[] = [];
  for (let k = S, j = W; k >= 0; k--) {
    const layer = drops[k]!;
    while (j > layer.lo && layer.marks[j - layer.lo] === 1) {
      dropped.unshift({ ...words[j - 1]! });
      j--;
    }
    if (k === 0) break;
    const { lo: start, from } = back[k - 1]!;
    const i = from[j - start]!;
    groups[k - 1] = [i, j];
    j = i;
  }
  const aligned: HeardWord[] = [];
  const sounds: Span[] = [];
  groups.forEach(([i, j], k) => {
    const { from: a, to: b } = stretches[k]!;
    if (i === j) {
      sounds.push({ from: a, to: b });
      return;
    }
    const group = words.slice(i, j);
    const total = group.reduce((sum, word) => sum + letters(word), 0);
    let sum = 0;
    for (const word of group) {
      const t = a + ((b - a) * sum) / total;
      sum += letters(word);
      aligned.push({ text: word.text, t: round(t), end: round(a + ((b - a) * sum) / total) });
    }
  });
  return { words: aligned, sounds, dropped, aligned: true };
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

const GERMAN = new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'du', 'wir', 'mit', 'ein', 'eine', 'auf', 'für', 'zu', 'den', 'dem', 'es', 'sie', 'hier', 'jetzt', 'auch', 'noch', 'dann', 'wie', 'was', 'man', 'kann', 'sind']);
const ENGLISH = new Set(['the', 'and', 'is', 'to', 'of', 'a', 'you', 'it', 'that', 'in', 'this', 'with', 'for', 'we', 'i', 'on', 'can', 'are', 'here', 'now', 'just', 'so', 'what', 'how', 'be', 'have', 'an', 'not', 'your']);

/**
 * German, English or unknown (`auto`), by common short words: whisper's filter does not say which
 * language it heard. The filler words depend on it ("um" is a filler in English, a word in German).
 */
export function guessLanguage(words: readonly HeardWord[]): string {
  let de = 0;
  let en = 0;
  for (const word of words) {
    const text = normWord(word.text);
    if (GERMAN.has(text)) de++;
    if (ENGLISH.has(text)) en++;
  }
  if (de + en < 3) return 'auto';
  if (de >= 2 * en) return 'de';
  if (en >= 2 * de) return 'en';
  return 'auto';
}
```

- [ ] **Step 9: Filler and pause cuts**

`packages/core/src/speech/edits.ts`:

```ts
// The speech edits: filler words and long pauses cut out where the picture rests. Pure: the inputs
// are the transcript, the screen's still stretches and the input events, in source seconds.
import { newId, type InputEvent, type TranscriptWord } from '@cuttle/project';
import { gaps, union, type Span } from '../suggest/spans';
import { normWord } from './whisper';

export const SPEECH_EDIT_RULES = {
  /** Kept on both sides of a filler's cut, up to the words around it. */
  fillerPad: 0.05,
  /** A stretch the mic heard without a word counts as a filler when shorter than this. */
  soundMax: 0.8,
  /** A short spelling counts only alone between pauses this long (the take's edges count as pauses). */
  alonePause: 0.2,
  /** A gap between words at least this long is a pause … */
  pauseMin: 1,
  /** … and keeps this much after the word before it and before the word after it (0.4 s in all). */
  pauseKeep: 0.2,
  /** A pause's cut is made only when it removes at least this much. */
  pauseCutMin: 0.3,
  /** The picture must rest this long before and after a cut: no input, no change on screen. */
  rest: 0.2,
  /** The pointer moving less than this (source pixels) while the picture rests does not count. */
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
  auto: 'filler' | 'pause';
  label: string;
}

export interface SpeechEditInput {
  words: readonly TranscriptWord[];
  /** Stretches the mic heard where no word was written. */
  sounds: readonly Span[];
  language: string;
  /** Where the screen did not change. */
  still: readonly Span[];
  events: readonly InputEvent[];
  /** The clips' source stretches at 1×: cuts are made only inside them. */
  clips: readonly Span[];
}

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * When the person acts, padded `rest` on both sides: clicks, keys, scrolls, and the pointer
 * moving (each time it is `pointerSlack` away from where it last was still).
 */
export function inputSpans(events: readonly InputEvent[], rules = SPEECH_EDIT_RULES): Span[] {
  const spans: Span[] = [];
  let anchor: { x: number; y: number } | undefined;
  for (const event of events) {
    if (event.type === 'shape') continue;
    if (event.type === 'move') {
      if (anchor && Math.hypot(event.x - anchor.x, event.y - anchor.y) <= rules.pointerSlack) continue;
      const first = anchor === undefined;
      anchor = { x: event.x, y: event.y };
      if (first) continue;
    }
    spans.push({ from: event.t - rules.rest, to: event.t + rules.rest });
  }
  return union(spans);
}

/** Where the picture rests: still on screen from `rest` before to `rest` after, and no input then (`inputSpans`). */
export function restingAt(span: Span, input: Pick<SpeechEditInput, 'still' | 'events'>, rules = SPEECH_EDIT_RULES, busy = inputSpans(input.events, rules)): boolean {
  const from = span.from - rules.rest;
  const to = span.to + rules.rest;
  if (!input.still.some((still) => still.from <= from && to <= still.to)) return false;
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
    if (lexicon.has(text)) return void found.push(n);
    if (!SHORT_SPELLINGS.has(text)) return;
    const before = n === 0 ? Infinity : word.t - words[n - 1]!.end;
    const after = n === words.length - 1 ? Infinity : words[n + 1]!.t - word.end;
    if (before >= rules.alonePause && after >= rules.alonePause) found.push(n);
  });
  return found;
}

/** The clip a stretch lies in entirely, if any. */
const insideClip = (span: Span, clips: readonly Span[]) => clips.some((clip) => clip.from <= span.from && span.to <= clip.to);

/**
 * Cuts for filler words (the lexicon, whisper's short spellings) and for the short sounds the mic
 * heard without a word, each padded `fillerPad` up to the words around it, made only where the
 * picture rests and inside a 1× clip. Fillers in a row are one cut, made only when they stand alone
 * between pauses: inside running speech the word times are estimates, and a cut there would clip
 * the words around it.
 */
export function fillerCuts(input: SpeechEditInput, rules = SPEECH_EDIT_RULES): SpeechCut[] {
  const { words } = input;
  const found: { from: number; to: number; label: string }[] = [];
  const fillers = fillerWords(words, input.language, rules);
  for (let k = 0; k < fillers.length; ) {
    // a run of fillers in a row: words[first … last]
    const first = fillers[k]!;
    let last = first;
    while (fillers[k + 1] === last + 1) last = fillers[++k]!;
    k++;
    const before = first === 0 ? -Infinity : words[first - 1]!.end;
    const after = last === words.length - 1 ? Infinity : words[last + 1]!.t;
    if (words[first]!.t - before < rules.alonePause || after - words[last]!.end < rules.alonePause) continue;
    const label = words
      .slice(first, last + 1)
      .map((word) => word.text.replace(/[^\p{L}\p{N}]+$/u, ''))
      .filter((text, i, all) => all.indexOf(text) === i)
      .join(', ');
    found.push({ from: Math.max(before, words[first]!.t - rules.fillerPad, 0), to: Math.min(after, words[last]!.end + rules.fillerPad), label });
  }
  for (const sound of input.sounds) {
    if (sound.to - sound.from >= rules.soundMax) continue;
    const before = words.filter((word) => word.end <= sound.from).at(-1)?.end ?? 0;
    const after = words.find((word) => word.t >= sound.to)?.t ?? Infinity;
    found.push({ from: Math.max(before, sound.from - rules.fillerPad), to: Math.min(after, sound.to + rules.fillerPad), label: '' });
  }
  found.sort((a, b) => a.from - b.from);
  const merged: typeof found = [];
  for (const cut of found) {
    const last = merged.at(-1);
    if (last && cut.from <= last.to + 0.01) {
      last.to = Math.max(last.to, cut.to);
      if (cut.label && !last.label.split(', ').includes(cut.label)) last.label = last.label ? `${last.label}, ${cut.label}` : cut.label;
    } else merged.push({ ...cut });
  }
  const busy = inputSpans(input.events, rules);
  return merged
    .filter((cut) => cut.to - cut.from > 0.02 && insideClip(cut, input.clips) && restingAt(cut, input, rules, busy))
    .map((cut) => ({ from: ms(cut.from), to: ms(cut.to), auto: 'filler', label: cut.label ? `Filler: ${cut.label}` : 'Filler (a sound)' }));
}

/**
 * Cuts for pauses: a gap of at least `pauseMin` between words keeps `pauseKeep` after the word
 * before and before the word after; of the rest, each part where the picture rests is cut, when it
 * is at least `pauseCutMin` long and inside a 1× clip. A short sound in the pause goes with it; a
 * long one (music, a word whisper missed) stays.
 */
export function pauseCuts(input: SpeechEditInput, rules = SPEECH_EDIT_RULES): SpeechCut[] {
  const { words } = input;
  const cuts: SpeechCut[] = [];
  const busy = union([
    ...input.sounds.filter((sound) => sound.to - sound.from >= rules.soundMax).map((sound) => ({ from: sound.from - 0.1, to: sound.to + 0.1 })),
    ...inputSpans(input.events, rules),
  ]);
  for (let n = 1; n < words.length; n++) {
    const gap = words[n]!.t - words[n - 1]!.end;
    if (gap < rules.pauseMin) continue;
    const inner = { from: words[n - 1]!.end + rules.pauseKeep, to: words[n]!.t - rules.pauseKeep };
    for (const clip of input.clips) {
      const from = Math.max(inner.from, clip.from);
      const to = Math.min(inner.to, clip.to);
      if (to - from < rules.pauseCutMin) continue;
      for (const still of input.still) {
        // inside the still stretch, `rest` from its edges
        const a = Math.max(from, still.from + rules.rest);
        const b = Math.min(to, still.to - rules.rest);
        if (b - a < rules.pauseCutMin) continue;
        for (const part of gaps(busy, a, b)) {
          if (part.to - part.from < rules.pauseCutMin) continue;
          cuts.push({ from: ms(part.from), to: ms(part.to), auto: 'pause', label: `Pause: ${gap.toFixed(1)} s` });
        }
      }
    }
  }
  return cuts;
}

/** The speech edits, pauses first; a filler inside a pause's cut is already gone. */
export function speechCuts(input: SpeechEditInput, kinds: { fillers: boolean; pauses: boolean }, rules = SPEECH_EDIT_RULES): SpeechCut[] {
  const pauses = kinds.pauses ? pauseCuts(input, rules) : [];
  const fillers = kinds.fillers ? fillerCuts(input, rules).filter((cut) => !pauses.some((pause) => cut.from < pause.to && pause.from < cut.to)) : [];
  return [...pauses, ...fillers].sort((a, b) => a.from - b.from);
}

/** A cut as written to cuttle.json (kept ones as they were, with whatever fields they had). */
export interface RawCut {
  id?: string;
  label?: string;
  from: number;
  to: number;
  enabled?: boolean;
  auto?: string;
  [field: string]: unknown;
}

/**
 * The cuts after a rerun of `kinds`: the cuts of those kinds still tagged are replaced by `made`;
 * every other cut stays. A new cut overlapping a cut that stays is not made. A new cut that takes
 * the place of a replaced one of its kind (overlapping at least half of the shorter) keeps its id,
 * and stays off when the person had switched that one off; the others get unused ids from `taken`.
 */
export function mergeCuts(raw: readonly RawCut[], made: readonly SpeechCut[], kinds: readonly string[], taken: Set<string>): { cuts: RawCut[]; added: RawCut[]; kept: number } {
  const ours = (cut: RawCut) => cut.auto !== undefined && kinds.includes(cut.auto);
  const kept = raw.filter((cut) => !ours(cut));
  const replaced = raw.filter(ours);
  const overlap = (a: Span, b: Span) => Math.min(a.to, b.to) - Math.max(a.from, b.from);
  const reused = new Set<RawCut>();
  const added: RawCut[] = [];
  for (const cut of made) {
    if (kept.some((other) => overlap(cut, other) > 0)) continue;
    const before = replaced.find((other) => !reused.has(other) && other.auto === cut.auto && overlap(cut, other) >= 0.5 * Math.min(cut.to - cut.from, other.to - other.from));
    if (before) reused.add(before);
    const id = typeof before?.id === 'string' ? before.id : newId('cuts', taken);
    added.push({ id, label: cut.label, from: cut.from, to: cut.to, ...(before?.enabled === false && { enabled: false }), auto: cut.auto });
  }
  return { cuts: [...kept, ...added].sort((a, b) => a.from - b.from), added, kept: kept.length };
}
```

- [ ] **Step 10: Transcribing a project, and applying its speech edits**

`packages/core/src/speech/transcribe.ts`:

```ts
// Transcribes a project's mic track: one whisper run, the words aligned to the mic's speech
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

export const TRANSCRIPT_FILE = 'transcript.json';

export interface TranscribeOptions {
  /** The speech model (default: `small` when downloaded, else the best one there is). */
  model?: string;
  /** `auto` (the default), or a language code such as `de` or `en`. */
  language?: string;
  /** The fraction done, 0 to 1. */
  onProgress?: (fraction: number) => void;
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
  /** Stretches the mic heard without a word. */
  sounds: number;
  /** Words whisper heard where the mic was quiet, left out. */
  dropped: number;
  /** Whether the word times were aligned to the mic (else whisper's own). */
  aligned: boolean;
  notes: string[];
}

/**
 * Seconds by which the mic track started after the screen track, from the take.json next to the
 * screen track; 0 when it does not describe this mic file.
 */
export async function micOffset(screen: string, mic: string): Promise<number> {
  const parsed = parseTakeJson(await readFile(join(dirname(screen), 'take.json'), 'utf8').catch(() => ''));
  if (!parsed.ok) return 0;
  const { take } = parsed;
  if (!samePath(resolve(dirname(screen), take.tracks.screen.file), screen)) return 0;
  const entry = take.tracks.mic;
  if (!entry || !samePath(resolve(dirname(screen), entry.file), mic)) return 0;
  return trackOffset(take, 'mic') ?? 0;
}

const projectPath = (dir: string, path: string) => relative(dir, path).split(sep).join('/');

/**
 * Transcribes the project's mic track and links the result (`sources.transcript`). The words are in
 * source seconds (the mic's offset applied); words before the screen track started are left out.
 */
export async function transcribeTake(projectDir: string, options: TranscribeOptions = {}): Promise<TranscribeResult> {
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  if (sources.mic === undefined) throw new CoreError('usage', 'the take has no mic track: record with --mic to transcribe what was said');
  const language = options.language ?? 'auto';
  if (!/^(auto|[a-z]{2,3})$/.test(language)) throw new CoreError('usage', `--language takes "auto" or a language code such as "de" or "en", not "${language}"`);
  const model = await chooseModel(options.model);
  if (model === undefined) {
    const small = SPEECH_MODELS.find((entry) => entry.name === 'small')!;
    throw new CoreError('model-missing', `no speech model is downloaded: run "cuttle models download small" (${Math.round(small.bytes / 1e6)} MB, once)`);
  }
  const mic = resolve(file.dir, sources.mic);
  const screen = resolve(file.dir, sources.screen);
  const seconds = await streamSeconds(mic, 'a');
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
  const shift = (t: number) => Math.round((t + offset) * 1000) / 1000;
  const words = alignment.words.map((word) => ({ t: shift(word.t), end: shift(word.end), text: word.text })).filter((word) => word.t >= 0);
  const sounds = alignment.sounds.map((sound) => ({ t: shift(sound.from), end: shift(sound.to) })).filter((sound) => sound.t >= 0);
  const transcript: TranscriptFile = {
    version: TRANSCRIPT_VERSION,
    language: spoken,
    model,
    words,
    sounds,
  };
  const notes: string[] = [];
  if (!alignment.aligned) notes.push("the word times could not be lined up with the mic's speech: they are whisper's own (about half a second off)");
  if (alignment.dropped.length > 0) notes.push(`left out ${alignment.dropped.length} word(s) heard where the mic was quiet: ${alignment.dropped.map((word) => `"${word.text}"`).slice(0, 5).join(', ')}`);
  if (words.length === 0) notes.push('no words were heard');

  const path = join(dirname(mic), TRANSCRIPT_FILE);
  const part = `${path}.${process.pid}.part`;
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
    sounds: sounds.length,
    dropped: alignment.dropped.length,
    aligned: alignment.aligned,
    notes,
  };
}

/**
 * Whether `link` (a transcript, relative to the project) belongs to the project's mic: it lies in
 * the mic's take folder. Transcription takes a while, and the project may have moved to another take.
 */
export function transcriptOfMic(dir: string, sources: { mic?: string | undefined }, link: string): boolean {
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

/** The project's transcript; undefined when it has none, or the file is missing or invalid (with a note why). */
export async function readTranscript(projectDir: string, link: string | undefined): Promise<{ transcript?: TranscriptFile; note?: string }> {
  if (link === undefined) return {};
  const text = await readFile(resolve(projectDir, link), 'utf8').catch(() => undefined);
  if (text === undefined) return { note: `${link} cannot be read: no speech edits` };
  const parsed = parseTranscriptJson(text);
  if (!parsed.ok) return { note: `${link} is invalid (${parsed.issues[0]?.path}: ${parsed.issues[0]?.message}): no speech edits` };
  return { transcript: parsed.transcript };
}
```

`packages/core/src/speech/apply.ts`:

```ts
// The speech edits applied to a project: filler and pause cuts from its transcript, merged with
// the cuts there by the tag rules. `suggest` does this as part of its run; the app does it again
// once the transcript arrives after the cut.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEventsJsonl, usedIds, type CuttleProject, type InputEvent, type TranscriptFile } from '@cuttle/project';
import { CoreError } from '../errors';
import { readProjectFile, writeProjectFile } from '../project-file';
import { analyseScreen } from '../suggest/media';
import { union, type Span } from '../suggest/spans';
import { mergeCuts, speechCuts, type RawCut } from './edits';
import { micLevels, speechStretches } from './levels';
import { micOffset, readTranscript, transcriptOfMic } from './transcribe';

/** Words closer than this are one stretch of speech. */
const WORD_JOIN = 0.3;

/**
 * Where someone speaks, in source seconds: the transcript's words when there is one, else the
 * stretches where the mic is clearly louder than its floor (no model needed); none without a mic.
 */
export async function speechActivity(
  dir: string,
  sources: CuttleProject['sources'],
  transcript: TranscriptFile | undefined,
): Promise<{ spans: Span[]; from: 'transcript' | 'mic' | 'none' }> {
  if (transcript) {
    return { spans: union(transcript.words.map((word) => ({ from: word.t - WORD_JOIN / 2, to: word.end + WORD_JOIN / 2 }))), from: 'transcript' };
  }
  if (sources.mic === undefined) return { spans: [], from: 'none' };
  const mic = resolve(dir, sources.mic);
  try {
    const [levels, offset] = await Promise.all([micLevels(mic), micOffset(resolve(dir, sources.screen), mic)]);
    const spans = speechStretches(levels).map((span) => ({ from: Math.max(0, span.from + offset), to: span.to + offset })).filter((span) => span.to > 0);
    return { spans, from: 'mic' };
  } catch (error) {
    if (error instanceof CoreError && error.code === 'ffmpeg-missing') throw error;
    return { spans: [], from: 'none' };
  }
}

export interface SpeechCutsResult {
  cuts: RawCut[];
  fillers: number;
  pauses: number;
  /** Of those, made switched off (where the person had switched one off). */
  off: number;
  notes: string[];
}

/**
 * The project's cuts with the speech edits of `transcript` (the tagged filler and pause cuts
 * replaced; the others kept). `clips`: the stretches of 1× clips, where cuts are made.
 */
export function withSpeechCuts(
  raw: Record<string, unknown>,
  project: CuttleProject,
  transcript: TranscriptFile,
  input: { still: readonly Span[]; events: readonly InputEvent[]; clips: readonly Span[] },
  taken = usedIds(raw),
): SpeechCutsResult {
  const made = speechCuts(
    {
      words: transcript.words,
      sounds: transcript.sounds.map((sound) => ({ from: sound.t, to: sound.end })),
      language: transcript.language,
      ...input,
    },
    { fillers: project.autoEdits.fillers, pauses: project.autoEdits.pauses },
  );
  const { cuts, added, kept } = mergeCuts((raw.cuts as RawCut[] | undefined) ?? [], made, ['filler', 'pause'], taken);
  const fillers = added.filter((cut) => cut.auto === 'filler').length;
  const pauses = added.filter((cut) => cut.auto === 'pause').length;
  const off = added.filter((cut) => cut.enabled === false).length;
  const notes: string[] = [];
  if (fillers + pauses > 0) {
    const removed = added.filter((cut) => cut.enabled !== false).reduce((sum, cut) => sum + cut.to - cut.from, 0);
    notes.push(`cut ${fillers} filler word${fillers === 1 ? '' : 's'} and ${pauses} pause${pauses === 1 ? '' : 's'} where the picture rests (${removed.toFixed(1)} s)${off > 0 ? `; ${off} stay off, as before` : ''}`);
  }
  if (!project.autoEdits.fillers) notes.push('filler cuts are switched off (autoEdits.fillers)');
  if (!project.autoEdits.pauses) notes.push('pause cuts are switched off (autoEdits.pauses)');
  if (kept > 0) notes.push(`kept ${kept} cut${kept === 1 ? '' : 's'} made by hand or by other steps`);
  return { cuts, fillers, pauses, off, notes };
}

export interface SpeechEditsResult extends SpeechCutsResult {
  project: string;
  written: boolean;
}

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
  if (!transcript) throw new CoreError('usage', note ?? 'the project has no transcript: run "cuttle transcribe" first');
  options.onStatus?.('reading the screen recording …');
  const screen = await analyseScreen(resolve(file.dir, sources.screen));
  let events: InputEvent[] = [];
  if (sources.events) {
    const text = await readFile(resolve(file.dir, sources.events), 'utf8').catch(() => undefined);
    if (text !== undefined) events = parseEventsJsonl(text).events;
  }
  const clips = file.project.scenes.flatMap((scene) => (scene.type === 'clip' && scene.speed === 1 ? [{ from: scene.from, to: scene.to }] : []));
  const result = withSpeechCuts(file.raw, file.project, transcript, { still: screen.still, events, clips });
  const before = JSON.stringify(file.raw.cuts ?? []);
  const linking = options.link !== undefined && options.link !== sources.transcript;
  if (JSON.stringify(result.cuts) === before && !linking) return { ...result, project: file.path, written: false };
  if (result.cuts.length > 0 || file.raw.cuts !== undefined) file.raw.cuts = result.cuts;
  await writeProjectFile(file, 'the speech edits');
  return { ...result, project: file.path, written: true };
}
```

- [ ] **Step 11: Speech counts as activity**

In `packages/core/src/suggest/plan.ts`, replace:

```ts
  markers: readonly Marker[];
  /** Where the screen did not change. */
  still: readonly Span[];
}

export interface SuggestedClip {
```

with:

```ts
  markers: readonly Marker[];
  /** Where the screen did not change. */
  still: readonly Span[];
  /** Where someone speaks (the transcript's words, or the mic's loud stretches): kept, and never sped up. */
  speech?: readonly Span[];
}

export interface SuggestedClip {
```

In the same file, replace:

```ts
  // spinner now and then (a still screen), and the speed-up shows it working.
  const turnStart = answer === undefined ? undefined : input.markers.filter((marker) => marker.kind !== 'manual' && marker.t <= answer).at(0)?.t;
  const turn = turnStart !== undefined && answer !== undefined && answer > turnStart ? [{ from: turnStart, to: answer }] : [];
  const active = union([...inputSpans, ...gaps(input.still, 0, duration), ...turn]);
  if (active.length === 0 || duration <= 0) {
    return { clips: duration > 0 ? [{ from: 0, to: ms(duration), speed: 1 }] : [], notes: ['nothing happened on screen or at the keyboard: the whole take, unchanged'] };
  }
```

with:

```ts
  // spinner now and then (a still screen), and the speed-up shows it working.
  const turnStart = answer === undefined ? undefined : input.markers.filter((marker) => marker.kind !== 'manual' && marker.t <= answer).at(0)?.t;
  const turn = turnStart !== undefined && answer !== undefined && answer > turnStart ? [{ from: turnStart, to: answer }] : [];
  const speechSpans = union(
    (input.speech ?? []).map((span) => ({ from: Math.max(0, span.from - RULES.inputPad), to: Math.min(duration, span.to + RULES.inputPad) })),
  );
  const active = union([...inputSpans, ...speechSpans, ...gaps(input.still, 0, duration), ...turn]);
  if (active.length === 0 || duration <= 0) {
    return { clips: duration > 0 ? [{ from: 0, to: ms(duration), speed: 1 }] : [], notes: ['nothing happened on screen or at the keyboard: the whole take, unchanged'] };
  }
```

In the same file, replace:

```ts
  for (const cut of cuts) notes.push(`cut ${length(cut).toFixed(1)} s of idle screen (${range(cut)})`);

  const clips: SuggestedClip[] = [];
  for (const kept of gaps(cuts, start, end)) clips.push(...withSpeedUps(kept, inputSpans, answer, notes));
  return {
    clips: clips.map((clip) => {
      const label = labelOf(clip, prompt, answer, turn);
```

with:

```ts
  for (const cut of cuts) notes.push(`cut ${length(cut).toFixed(1)} s of idle screen (${range(cut)})`);

  const clips: SuggestedClip[] = [];
  // Speech is never sped up: a wait is a stretch without input and without speech.
  const busy = union([...inputSpans, ...speechSpans]);
  for (const kept of gaps(cuts, start, end)) clips.push(...withSpeedUps(kept, busy, answer, notes));
  return {
    clips: clips.map((clip) => {
      const label = labelOf(clip, prompt, answer, turn);
```

In the same file, replace:

```ts
  return undefined;
}

/** `kept` as 1× clips, with every long stretch without input sped up. */
function withSpeedUps(kept: Span, inputSpans: readonly Span[], answer: number | undefined, notes: string[]): SuggestedClip[] {
  const fast: SuggestedClip[] = [];
  for (const wait of gaps(inputSpans, kept.from, kept.to)) {
    if (length(wait) < RULES.waitMin) continue;
    const inner = { from: wait.from + RULES.waitKeep, to: wait.to - RULES.waitKeep };
    // Claude's answer stays at 1×: a wait around it is sped up before and after it.
```

with:

```ts
  return undefined;
}

/** `kept` as 1× clips, with every long stretch without input (and speech) sped up. */
function withSpeedUps(kept: Span, busy: readonly Span[], answer: number | undefined, notes: string[]): SuggestedClip[] {
  const fast: SuggestedClip[] = [];
  for (const wait of gaps(busy, kept.from, kept.to)) {
    if (length(wait) < RULES.waitMin) continue;
    const inner = { from: wait.from + RULES.waitKeep, to: wait.to - RULES.waitKeep };
    // Claude's answer stays at 1×: a wait around it is sped up before and after it.
```

- [ ] **Step 12: A new take drops the cuts; recover keeps the transcript**

In `packages/core/src/use-take.ts`, replace:

```ts
  mic?: string;
  events?: string;
  markers?: string;
  seconds: number;
}
```

with:

```ts
  mic?: string;
  events?: string;
  markers?: string;
  /** What the mic said (`transcript.json`), when the take was transcribed. */
  transcript?: string;
  seconds: number;
}
```

In the same file, replace:

```ts

/**
 * Points the project at a take: `sources` names its files. A project is one take: by default the
 * take becomes one clip scene, and the scenes, zooms, masks and texts of the previous take (which
 * refer to its source times) are dropped. With `keepEdit` (recovering the take the project already
 * uses) they stay, and a clip over the whole take is added only when there are no scenes. Returns
 * whether the project had scenes or overlays, so the caller keeps the previous cuttle.json as a
 * backup when it writes (`writeProjectFile`'s `backup`).
 */
export function useTake(file: ProjectFile, take: TakeFiles, keepEdit = false): boolean {
  const { scenes, zooms, masks, texts } = file.project;
  const hadEdit = scenes.length + zooms.length + masks.length + texts.length > 0;
  file.raw.sources = {
    screen: take.screen,
    ...(take.webcam && { webcam: take.webcam }),
    ...(take.mic && { mic: take.mic }),
    ...(take.events && { events: take.events }),
    ...(take.markers && { markers: take.markers }),
  };
  if (keepEdit) {
    if (scenes.length === 0) file.raw.scenes = [{ type: 'clip', from: 0, to: Math.floor(take.seconds * 1000) / 1000 }];
```

with:

```ts

/**
 * Points the project at a take: `sources` names its files. A project is one take: by default the
 * take becomes one clip scene, and the scenes, zooms, masks, texts and cuts of the previous take
 * (which refer to its source times) are dropped. With `keepEdit` (recovering the take the project already
 * uses) they stay, and a clip over the whole take is added only when there are no scenes. Returns
 * whether the project had scenes or overlays, so the caller keeps the previous cuttle.json as a
 * backup when it writes (`writeProjectFile`'s `backup`).
 */
export function useTake(file: ProjectFile, take: TakeFiles, keepEdit = false): boolean {
  const { scenes, zooms, masks, texts, cuts } = file.project;
  const hadEdit = scenes.length + zooms.length + masks.length + texts.length + cuts.length > 0;
  file.raw.sources = {
    screen: take.screen,
    ...(take.webcam && { webcam: take.webcam }),
    ...(take.mic && { mic: take.mic }),
    ...(take.events && { events: take.events }),
    ...(take.markers && { markers: take.markers }),
    ...(take.transcript && { transcript: take.transcript }),
  };
  if (keepEdit) {
    if (scenes.length === 0) file.raw.scenes = [{ type: 'clip', from: 0, to: Math.floor(take.seconds * 1000) / 1000 }];
```

In the same file, replace:

```ts
  delete file.raw.zooms;
  delete file.raw.masks;
  delete file.raw.texts;
  return hadEdit;
}
```

with:

```ts
  delete file.raw.zooms;
  delete file.raw.masks;
  delete file.raw.texts;
  delete file.raw.cuts;
  return hadEdit;
}
```

In `packages/core/src/recover.ts`, replace:

```ts
  backup?: string;
}

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json', segments: 'segments.json' };

/**
 * Recovers a take (a folder relative to the project, e.g. takes/3): makes it usable after
```

with:

```ts
  backup?: string;
}

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json', segments: 'segments.json', transcript: 'transcript.json' };

/**
 * Recovers a take (a folder relative to the project, e.g. takes/3): makes it usable after
```

In the same file, replace:

```ts
    );
  }

  const { scenes, zooms, masks, texts } = file.project;
  const sameTake = samePath(resolve(file.dir, file.project.sources.screen), path(FILES.screen));
  const keepEdit = sameTake && scenes.length + zooms.length + masks.length + texts.length > 0;
  const hadEdit = useTake(
    file,
    {
```

with:

```ts
    );
  }

  const { scenes, zooms, masks, texts, cuts } = file.project;
  const sameTake = samePath(resolve(file.dir, file.project.sources.screen), path(FILES.screen));
  const keepEdit = sameTake && scenes.length + zooms.length + masks.length + texts.length + cuts.length > 0;
  const hadEdit = useTake(
    file,
    {
```

In the same file, replace:

```ts
      ...(mic && { mic: source(FILES.mic) }),
      events: source(FILES.events),
      markers: source(FILES.markers),
      seconds,
    },
    sameTake,
```

with:

```ts
      ...(mic && { mic: source(FILES.mic) }),
      events: source(FILES.events),
      markers: source(FILES.markers),
      ...(existsSync(path(FILES.transcript)) && { transcript: source(FILES.transcript) }),
      seconds,
    },
    sameTake,
```

- [ ] **Step 13: The exports**

In `packages/core/src/index.ts`, replace:

```ts
// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, and run ffmpeg.
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
```

with:

```ts
// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, run ffmpeg, and transcribe the mic (the speech models, whisper, the speech edits).
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
```

In the same file, replace:

```ts
export { changedRegion, zoomRect } from './suggest/region';
export { gaps, length, union, type Span } from './suggest/spans';
export { transcriptMarkers } from './suggest/transcript';
```

with:

```ts
export { changedRegion, zoomRect } from './suggest/region';
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

- [ ] **Step 14: Run the tests**

Run: `pnpm exec vitest run --project node packages/core`
Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add .gitattributes vitest.config.ts packages/core
git commit -m "core: speech models, whisper, the mic's speech, the alignment, and filler and pause cuts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: suggest keeps the speech and cuts filler words and pauses

**Files:**
- Create: `packages/core/test/speech-take.test.ts`
- Modify: `packages/core/src/suggest.ts`

- [ ] **Step 1: Write the failing test**

It transcribes for real: it runs where a model is downloaded and is skipped elsewhere.

`packages/core/test/speech-take.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseTranscriptJson } from '@cuttle/project';
import { ffmpegPath, runFfmpeg } from '../src/ffmpeg';
import { applySpeechEdits } from '../src/speech/apply';
import { transcribeTake } from '../src/speech/transcribe';
import { suggestProject } from '../src/suggest';

/**
 * The speech pipeline on a take spoken by Windows' text to speech (the English fixture: "Uh" and
 * "Um" as fillers, pauses between the sentences), muxed under a still screen. It runs where a speech
 * model is downloaded (`CUTTLE_TEST_MODELS`, else the user's models folder; `base` first, the
 * fastest) and ffmpeg has the whisper filter; it is skipped elsewhere.
 */
const modelsDir = process.env.CUTTLE_TEST_MODELS || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Cuttle', 'models') : join(homedir(), 'Library', 'Application Support', 'Cuttle', 'models'));
const model = ['base', 'small', 'large-v3-turbo-q5_0'].find((name) => existsSync(join(modelsDir, `ggml-${name}.bin`)));
const whisper = / whisper /.test(spawnSync(ffmpegPath(), ['-hide_banner', '-filters'], { encoding: 'utf8', windowsHide: true }).stdout ?? '');
const fixtures = join(import.meta.dirname, 'fixtures', 'speech');

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

/** A project whose take is a still screen and the English fixture as its mic, which started 0.2 s after the screen. */
async function spokenTake(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-spoken-'));
  dirs.push(dir);
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=640x360:r=30:d=19.5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(take, 'screen.mp4')]);
  copyFileSync(join(fixtures, 'en.m4a'), join(take, 'mic.m4a'));
  writeFileSync(join(take, 'events.jsonl'), '');
  writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 }, mic: { file: 'mic.m4a', start: 1000.2 } } }));
  writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a', events: 'takes/1/events.jsonl' } }));
  return dir;
}

describe.runIf(model !== undefined && whisper)(`speech on a spoken take (${model} model)`, () => {
  it('transcribes the mic in source seconds, and suggest keeps the speech and cuts the fillers and pauses', async () => {
    process.env.CUTTLE_MODELS_DIR = modelsDir;
    const dir = await spokenTake();
    const progress: number[] = [];
    const done = await transcribeTake(dir, { model, onProgress: (fraction) => progress.push(fraction) });
    expect(done).toMatchObject({ transcript: 'takes/1/transcript.json', model, language: 'en', aligned: true });
    expect(progress.at(-1)).toBe(1);
    const parsed = parseTranscriptJson(readFileSync(join(dir, 'takes', '1', 'transcript.json'), 'utf8'));
    if (!parsed.ok) throw new Error('invalid transcript');
    // "records" starts at 2.745 s of the mic: 2.945 s of the screen
    const records = parsed.transcript.words.find((word) => /records/i.test(word.text));
    expect(records?.t).toBeCloseTo(2.945, 0);
    expect(Math.abs(records!.t - 2.945)).toBeLessThan(0.25);
    expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')).sources.transcript).toBe('takes/1/transcript.json');

    const result = await suggestProject(dir);
    expect(result.speech.from).toBe('transcript');
    // the screen never changes and nobody types: only the speech keeps the take from being cut away
    expect(result.scenes.length).toBeGreaterThan(0);
    const fillers = (result.cuts ?? []).filter((cut) => cut.auto === 'filler');
    const pauses = (result.cuts ?? []).filter((cut) => cut.auto === 'pause');
    // "Uh" at 2.22 s and "Um" at 7.755 s of the screen
    for (const at of [2.22, 7.755]) expect(fillers.some((cut) => cut.from - 0.15 <= at && at <= cut.to), `a filler cut at ${at}`).toBe(true);
    expect(pauses.length).toBeGreaterThan(0);
    expect(result.notes.some((note) => /^cut \d+ filler words? and \d+ pauses?/.test(note))).toBe(true);

    // the app's step once the transcript arrives: the same cuts again, nothing else touched
    const before = readFileSync(join(dir, 'cuttle.json'), 'utf8');
    const again = await applySpeechEdits(dir);
    expect(again.written).toBe(false);
    expect(readFileSync(join(dir, 'cuttle.json'), 'utf8')).toBe(before);
  }, 120_000);
});
```

Run: `pnpm exec vitest run --project node packages/core/test/speech-take.test.ts`
Expected: FAIL: `result.speech` is undefined (skipped without a model).

- [ ] **Step 2: suggest**

In `packages/core/src/suggest.ts`, replace:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { newId, parseEventsJsonl, parseMarkersJson, parseProject, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
```

with:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { newId, parseEventsJsonl, parseMarkersJson, parseProject, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect, type TranscriptFile } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
```

In the same file, replace:

```ts
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { takeClock, transcriptMarkers } from './suggest/transcript';

export interface SuggestOptions {
  /** The folder Claude Code ran in (true: the current folder), for a take without Claude markers. */
```

with:

```ts
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { takeClock, transcriptMarkers } from './suggest/transcript';
import { speechActivity, withSpeechCuts } from './speech/apply';
import type { RawCut } from './speech/edits';
import { chooseModel } from './speech/models';
import { readTranscript, transcribeTake } from './speech/transcribe';
import { hasWhisper } from './speech/whisper';

export interface SuggestOptions {
  /** The folder Claude Code ran in (true: the current folder), for a take without Claude markers. */
```

In the same file, replace:

```ts
  zoom?: boolean;
  /** Zooms that follow the clicks (default true; `zoom: false` turns them off too). */
  clickZooms?: boolean;
  /** Status for people while it runs. */
  onStatus?: (text: string) => void;
}

type ClipScene = { type: 'clip'; id: string; label?: string; from: number; to: number; speed?: number };
```

with:

```ts
  zoom?: boolean;
  /** Zooms that follow the clicks (default true; `zoom: false` turns them off too). */
  clickZooms?: boolean;
  /**
   * The mic's speech (default true): it is kept and never sped up, and the transcript's filler words
   * and pauses are cut where the picture rests.
   */
  speech?: boolean;
  /** Transcribe the mic first when it has no transcript and a speech model is downloaded (default true). */
  transcribe?: boolean;
  /** Status for people while it runs. */
  onStatus?: (text: string) => void;
  /** The transcription's progress, 0 to 1. */
  onProgress?: (fraction: number) => void;
}

type ClipScene = { type: 'clip'; id: string; label?: string; from: number; to: number; speed?: number };
```

In the same file, replace:

```ts
  scenes: (ClipScene | Record<string, unknown>)[];
  /** Every zoom of the file afterwards: those kept (made by hand) and the new automatic ones, by start. */
  zooms: SuggestedZoom[];
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
```

with:

```ts
  scenes: (ClipScene | Record<string, unknown>)[];
  /** Every zoom of the file afterwards: those kept (made by hand) and the new automatic ones, by start. */
  zooms: SuggestedZoom[];
  /** Every cut of the file afterwards, when the speech edits were made (a transcript was there). */
  cuts?: RawCut[];
  /** Where the speech came from: the transcript, the mic's loudness, or none; and the cuts made for it. */
  speech: { from: 'transcript' | 'mic' | 'none'; fillers: number; pauses: number };
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
```

In the same file, replace:

```ts
 * ids no kept item uses and labels from Claude's markers.
 */
export async function suggestProject(projectDir: string, args: SuggestOptions = {}): Promise<SuggestResult> {
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  const screen = resolve(file.dir, sources.screen);
  args.onStatus?.('reading the screen recording …');
  const screenInfo = await analyseScreen(screen);
  if (screenInfo.duration <= 0) throw new CoreError('invalid-media', `${screen} has no video frames`);
  const notes: string[] = [];
  let events: InputEvent[] = [];
  if (sources.events) {
    const read = await readEvents(resolve(file.dir, sources.events));
```

with:

```ts
 * ids no kept item uses and labels from Claude's markers.
 */
export async function suggestProject(projectDir: string, args: SuggestOptions = {}): Promise<SuggestResult> {
  const notes: string[] = [];
  if (args.speech !== false && args.transcribe !== false && !args.dryRun) await transcribeFirst(projectDir, args, notes);
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  const screen = resolve(file.dir, sources.screen);
  args.onStatus?.('reading the screen recording …');
  const screenInfo = await analyseScreen(screen);
  if (screenInfo.duration <= 0) throw new CoreError('invalid-media', `${screen} has no video frames`);
  let transcript: TranscriptFile | undefined;
  let speech: { spans: { from: number; to: number }[]; from: SuggestResult['speech']['from'] } = { spans: [], from: 'none' };
  if (args.speech !== false) {
    const read = await readTranscript(file.dir, sources.transcript);
    if (read.note) notes.push(read.note);
    transcript = read.transcript;
    speech = await speechActivity(file.dir, sources, transcript);
    if (speech.from === 'mic' && speech.spans.length > 0) notes.push(`speech (${speech.spans.length} stretches, from the mic's loudness) is kept and never sped up`);
  }
  let events: InputEvent[] = [];
  if (sources.events) {
    const read = await readEvents(resolve(file.dir, sources.events));
```

In the same file, replace:

```ts
    }
  }

  const suggestion = suggestClips({ duration: screenInfo.duration, events, markers, still: screenInfo.still });
  notes.push(...suggestion.notes);
  // Page captures and cards stay where they were: before the first clip (a title card) or after it.
  const previous = (file.raw.scenes as Record<string, unknown>[] | undefined) ?? [];
```

with:

```ts
    }
  }

  const suggestion = suggestClips({ duration: screenInfo.duration, events, markers, still: screenInfo.still, speech: speech.spans });
  notes.push(...suggestion.notes);
  // Page captures and cards stay where they were: before the first clip (a title card) or after it.
  const previous = (file.raw.scenes as Record<string, unknown>[] | undefined) ?? [];
```

In the same file, replace:

```ts
    notes.push(`kept ${before.length + after.length} still or card scene(s)${before.length > 0 ? `, ${before.length} before the clips` : ''}`);
  }
  const scenes = [...before, ...clips, ...after];
  // The zooms suggest made before are replaced; the others stay, and the new ones avoid them.
  const rawZooms = (file.raw.zooms as SuggestedZoom[] | undefined) ?? [];
  const isOurs = (zoom: { auto?: string }) => zoom.auto === 'answer' || zoom.auto === 'click';
```

with:

```ts
    notes.push(`kept ${before.length + after.length} still or card scene(s)${before.length > 0 ? `, ${before.length} before the clips` : ''}`);
  }
  const scenes = [...before, ...clips, ...after];
  // The filler words and pauses, inside the new 1× clips, where the picture rests.
  let cuts: RawCut[] | undefined;
  let made = { fillers: 0, pauses: 0 };
  if (transcript) {
    const atNormalSpeed = suggestion.clips.filter((clip) => clip.speed === 1).map(({ from: start, to }) => ({ from: start, to }));
    const result = withSpeechCuts(file.raw, file.project, transcript, { still: screenInfo.still, events, clips: atNormalSpeed }, taken);
    notes.push(...result.notes);
    cuts = result.cuts;
    made = { fillers: result.fillers, pauses: result.pauses };
  }
  // The zooms suggest made before are replaced; the others stay, and the new ones avoid them.
  const rawZooms = (file.raw.zooms as SuggestedZoom[] | undefined) ?? [];
  const isOurs = (zoom: { auto?: string }) => zoom.auto === 'answer' || zoom.auto === 'click';
```

In the same file, replace:

```ts
  }
  if (args.zoom !== false && args.clickZooms !== false && file.project.autoEdits.clickZooms && events.length > 0) {
    // where each clip piece starts in the output, with the cards and pages around the clips and the cuts counted
    const parsed = parseProject({ ...file.raw, scenes, zooms: [] });
    const spans = parsed.ok ? sceneSpans(parsed.project.scenes, parsed.project.cuts) : [];
    const shown = spans.flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
    const there = [...kept, ...zooms];
```

with:

```ts
  }
  if (args.zoom !== false && args.clickZooms !== false && file.project.autoEdits.clickZooms && events.length > 0) {
    // where each clip piece starts in the output, with the cards and pages around the clips and the cuts counted
    const parsed = parseProject({ ...file.raw, scenes, ...(cuts && { cuts }), zooms: [] });
    const spans = parsed.ok ? sceneSpans(parsed.project.scenes, parsed.project.cuts) : [];
    const shown = spans.flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
    const there = [...kept, ...zooms];
```

In the same file, replace:

```ts
  if (!args.dryRun) {
    file.raw.scenes = scenes;
    file.raw.zooms = allZooms;
    ({ backup } = await writeProjectFile(file, 'suggest', { backup: true }));
  }
  const result: SuggestResult = {
    project: file.path,
    scenes,
    zooms: allZooms,
    notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
```

with:

```ts
  if (!args.dryRun) {
    file.raw.scenes = scenes;
    file.raw.zooms = allZooms;
    if (cuts && (cuts.length > 0 || file.raw.cuts !== undefined)) file.raw.cuts = cuts;
    ({ backup } = await writeProjectFile(file, 'suggest', { backup: true }));
  }
  const result: SuggestResult = {
    project: file.path,
    scenes,
    zooms: allZooms,
    ...(cuts && { cuts }),
    speech: { from: speech.from, ...made },
    notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
```

In the same file, replace:

```ts
  return result;
}

/** A zoom as written to cuttle.json (kept ones as they were, with whatever fields they had). */
export interface SuggestedZoom {
  id?: string;
```

with:

```ts
  return result;
}

/**
 * Transcribes the mic before the cut when the take has one, it has no transcript yet, and a speech
 * model is downloaded; says why not otherwise. A failed transcription is noted, not thrown: the
 * cut goes on without the speech edits.
 */
async function transcribeFirst(projectDir: string, args: SuggestOptions, notes: string[]): Promise<void> {
  const { project } = await readProjectFile(projectDir);
  if (project.sources.mic === undefined || project.sources.transcript !== undefined) return;
  if ((await chooseModel()) === undefined) {
    notes.push('the mic was not transcribed: no speech model is downloaded ("cuttle models download small"), so filler words and pauses stay');
    return;
  }
  if (!(await hasWhisper())) {
    notes.push('the mic was not transcribed: this ffmpeg has no whisper filter (update it: winget upgrade Gyan.FFmpeg, or on macOS brew upgrade ffmpeg)');
    return;
  }
  try {
    const done = await transcribeTake(projectDir, { ...(args.onStatus && { onStatus: args.onStatus }), ...(args.onProgress && { onProgress: args.onProgress }) });
    notes.push(`transcribed the mic with the ${done.model} model: ${done.words} words (${done.language}), in ${done.transcript}`, ...done.notes);
  } catch (error) {
    if (error instanceof CoreError && (error.code === 'cancelled' || error.code === 'conflict' || error.code === 'ffmpeg-missing')) throw error;
    notes.push(`the mic could not be transcribed: ${(error as Error).message.split('\n')[0]}`);
  }
}

/** A zoom as written to cuttle.json (kept ones as they were, with whatever fields they had). */
export interface SuggestedZoom {
  id?: string;
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/core`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core
git commit -m "core: suggest transcribes the mic first, keeps speech, and cuts filler words and pauses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: cuttle transcribe and cuttle models

**Files:**
- Create: `apps/cli/src/commands/{transcribe,models}.ts`
- Modify: `apps/cli/src/{main,errors}.ts`, `apps/cli/src/commands/suggest.ts`, `apps/cli/test/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/cli/test/cli.test.ts`, replace:

```ts
  );
}

describe('cuttle suggest and recover', () => {
  let fixture: string;
  beforeAll(() => {
```

with:

```ts
  );
}

describe('cuttle models and transcribe', () => {
  it('lists the speech models, none downloaded here', async () => {
    const { code, json } = await cli('--json', 'models');
    expect(code).toBe(0);
    const list = json as { dir: string; models: { name: string; installed: boolean; default: boolean; bytes: number }[] };
    // the tests' own empty folder (vitest.config.ts), never the user's
    expect(list.dir).toBe(process.env.CUTTLE_MODELS_DIR);
    expect(list.models.map((model) => [model.name, model.installed, model.default, Math.round(model.bytes / 1e6)])).toEqual([
      ['base', false, false, 148],
      ['small', false, true, 488],
      ['large-v3-turbo-q5_0', false, false, 574],
    ]);
    const text = await cli('models');
    expect(text.stdout).toContain('download one: cuttle models download small');
    expect((await cli('--json', 'models', 'download', 'huge')).json).toEqual({
      error: { code: 'usage', message: 'unknown speech model "huge" (one of base, small, large-v3-turbo-q5_0)' },
    });
  });

  it('says what transcribe needs (a mic, then a model), and suggest goes on without it', async () => {
    const dir = temp();
    takeFixture(dir);
    const noMic = await cli('--json', '-C', dir, 'transcribe');
    expect(noMic.code).toBe(1);
    expect(noMic.json).toEqual({ error: { code: 'usage', message: 'the take has no mic track: record with --mic to transcribe what was said' } });
    const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=20', '-c:a', 'aac', '-y', join(dir, 'takes', '1', 'mic.m4a')]);
    if (result.status !== 0) throw new Error(String(result.stderr));
    const path = join(dir, 'cuttle.json');
    const project = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...project, sources: { ...project.sources, mic: 'takes/1/mic.m4a' } }));
    const noModel = await cli('--json', '-C', dir, 'transcribe', '--language', 'de');
    expect(noModel.code).toBe(1);
    expect(noModel.json).toEqual({ error: { code: 'model-missing', message: 'no speech model is downloaded: run "cuttle models download small" (488 MB, once)' } });
    expect((await cli('--json', '-C', dir, 'transcribe', '--language', 'Deutsch')).json).toEqual({
      error: { code: 'usage', message: '--language takes "auto" or a language code such as "de" or "en", not "Deutsch"' },
    });
    const suggested = await cli('--json', '-C', dir, 'suggest');
    expect(suggested.code).toBe(0);
    const { notes, speech } = suggested.json as { notes: string[]; speech: unknown };
    expect(notes[0]).toBe('the mic was not transcribed: no speech model is downloaded ("cuttle models download small"), so filler words and pauses stay');
    // a steady tone is not speech
    expect(speech).toEqual({ from: 'mic', fillers: 0, pauses: 0 });
    // --no-speech leaves the mic out altogether
    const without = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-speech');
    expect((without.json as { notes: string[]; speech: unknown }).speech).toEqual({ from: 'none', fillers: 0, pauses: 0 });
  }, 30_000);
});

describe('cuttle suggest and recover', () => {
  let fixture: string;
  beforeAll(() => {
```

In the same file, replace:

```ts
            "type": "clip",
          },
        ],
        "written": true,
        "zooms": [
          {
```

with:

```ts
            "type": "clip",
          },
        ],
        "speech": {
          "fillers": 0,
          "from": "none",
          "pauses": 0,
        },
        "written": true,
        "zooms": [
          {
```

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts`
Expected: FAIL: `models` and `transcribe` are unknown commands.

- [ ] **Step 2: The commands**

`apps/cli/src/commands/transcribe.ts`:

```ts
import { transcribeTake, type TranscribeResult } from '@cuttle/core';
import type { Output } from '../output';

/** Calls `report` with whole percents, every `step` of them (and at 100). */
export function percentSteps(report: (percent: number) => void, step = 10): (fraction: number) => void {
  let last = -step;
  return (fraction) => {
    const percent = Math.floor(fraction * 100);
    if (percent >= last + step || (percent === 100 && last !== 100)) {
      last = percent - (percent % step);
      report(percent);
    }
  };
}

/**
 * `cuttle transcribe`: what the mic said, word by word, written to takes/<n>/transcript.json and
 * linked from cuttle.json (see @cuttle/core's transcribeTake).
 */
export async function transcribeCommand(projectDir: string, args: { model?: string; language?: string }, output: Output, signal: AbortSignal): Promise<TranscribeResult> {
  const result = await transcribeTake(projectDir, {
    ...args,
    signal,
    onStatus: (text) => output.info(text),
    onProgress: percentSteps((percent) => output.info(`transcribing … ${percent} %`)),
  });
  output.result(result, () =>
    [
      ...result.notes.map((note) => `- ${note}`),
      `${result.words} words (${result.language}, ${result.model} model) in ${result.transcript}`,
      'next: cuttle suggest (it cuts filler words and pauses)',
    ].join('\n'),
  );
  return result;
}
```

`apps/cli/src/commands/models.ts`:

```ts
import { DEFAULT_MODEL, SPEECH_MODELS, downloadModel, installedModels, modelPath, modelsDir, removeModel, speechModel, type ModelName } from '@cuttle/core';
import type { Output } from '../output';
import { percentSteps } from './transcribe';

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

export interface ModelsList {
  dir: string;
  models: { name: ModelName; label: string; bytes: number; installed: boolean; default: boolean; note: string }[];
}

/** `cuttle models`: the speech models, which are downloaded, and where they are kept. */
export async function modelsListCommand(output: Output): Promise<ModelsList> {
  const installed = await installedModels();
  const result: ModelsList = {
    dir: modelsDir(),
    models: SPEECH_MODELS.map((model) => ({
      name: model.name,
      label: model.label,
      bytes: model.bytes,
      installed: installed.includes(model.name),
      default: model.name === DEFAULT_MODEL,
      note: model.note,
    })),
  };
  output.result(result, () =>
    [
      ...result.models.map((model) => `${model.installed ? '✓' : ' '} ${model.name.padEnd(20)} ${model.label.padEnd(5)} ${megabytes(model.bytes).padStart(7)}  ${model.note}${model.default ? ' (default)' : ''}`),
      `kept in ${result.dir}`,
      ...(installed.length === 0 ? [`download one: cuttle models download ${DEFAULT_MODEL}`] : []),
    ].join('\n'),
  );
  return result;
}

/** `cuttle models download <name>`: downloads a model once, checking its size and checksum. */
export async function modelsDownloadCommand(name: string, output: Output, signal: AbortSignal): Promise<{ name: ModelName; path: string; bytes: number }> {
  const model = speechModel(name);
  output.info(`downloading the ${model.name} model (${megabytes(model.bytes)}) into ${modelsDir()} …`);
  const report = percentSteps((percent) => output.info(`downloading … ${percent} %`), 5);
  const path = await downloadModel(model.name, { signal, onProgress: (received, total) => report(received / total) });
  const result = { name: model.name, path, bytes: model.bytes };
  output.result(result, () => `${model.name} is ready (${path})`);
  return result;
}

/** `cuttle models remove <name>`: removes a downloaded model. */
export async function modelsRemoveCommand(name: string, output: Output): Promise<{ name: ModelName; removed: string }> {
  const model = speechModel(name);
  await removeModel(model.name);
  const result = { name: model.name, removed: modelPath(model.name) };
  output.result(result, () => `removed ${result.removed}`);
  return result;
}
```

In `apps/cli/src/commands/suggest.ts`, replace:

```ts
import { suggestProject, type SuggestOptions, type SuggestResult } from '@cuttle/core';
import type { Output } from '../output';

/**
 * `cuttle suggest`: scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
 * sped up) and a zoom on Claude's answer, written to cuttle.json (see @cuttle/core's suggestProject).
 */
export async function suggestCommand(projectDir: string, args: Omit<SuggestOptions, 'onStatus'>, output: Output): Promise<SuggestResult> {
  const result = await suggestProject(projectDir, { ...args, onStatus: (text) => output.info(text) });
  output.result(result, () => {
    const clips = result.scenes.filter((scene): scene is { type: 'clip'; from: number; to: number; speed?: number } => scene.type === 'clip');
    const seconds = clips.reduce((sum, scene) => sum + (scene.to - scene.from) / (scene.speed ?? 1), 0);
```

with:

```ts
import { suggestProject, type SuggestOptions, type SuggestResult } from '@cuttle/core';
import type { Output } from '../output';
import { percentSteps } from './transcribe';

/**
 * `cuttle suggest`: scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
 * sped up, speech kept), zooms on Claude's answer and the clicks, and cuts for filler words and
 * pauses, written to cuttle.json (see @cuttle/core's suggestProject).
 */
export async function suggestCommand(projectDir: string, args: Omit<SuggestOptions, 'onStatus' | 'onProgress'>, output: Output): Promise<SuggestResult> {
  const result = await suggestProject(projectDir, {
    ...args,
    onStatus: (text) => output.info(text),
    onProgress: percentSteps((percent) => output.info(`transcribing … ${percent} %`)),
  });
  output.result(result, () => {
    const clips = result.scenes.filter((scene): scene is { type: 'clip'; from: number; to: number; speed?: number } => scene.type === 'clip');
    const seconds = clips.reduce((sum, scene) => sum + (scene.to - scene.from) / (scene.speed ?? 1), 0);
```

In `apps/cli/src/errors.ts`, replace:

```ts
  render: EXIT.render,
  // @cuttle/core
  conflict: EXIT.usage,
};

/** A failure the CLI reports with a code and an exit code. */
```

with:

```ts
  render: EXIT.render,
  // @cuttle/core
  conflict: EXIT.usage,
  'model-missing': EXIT.usage,
  download: EXIT.device,
  'ffmpeg-old': EXIT.device,
};

/** A failure the CLI reports with a code and an exit code. */
```

In `apps/cli/src/main.ts`, replace:

```ts
import { recoverCommand } from './commands/recover';
import { renderCommand } from './commands/render';
import { suggestCommand } from './commands/suggest';
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';
```

with:

```ts
import { recoverCommand } from './commands/recover';
import { renderCommand } from './commands/render';
import { suggestCommand } from './commands/suggest';
import { modelsDownloadCommand, modelsListCommand, modelsRemoveCommand } from './commands/models';
import { transcribeCommand } from './commands/transcribe';
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';
```

In the same file, replace:

```ts
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer nor on clicks)')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(action((output, project, options: { claude?: string | true; zoom: boolean; clickZooms: boolean; dryRun?: boolean }) => suggestCommand(project, options, output)));

  program
    .command('preview')
```

with:

```ts
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer nor on clicks)')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-speech', 'leave the speech out: no filler or pause cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, options: { claude?: string | true; zoom: boolean; clickZooms: boolean; speech: boolean; transcribe: boolean; dryRun?: boolean }) =>
        suggestCommand(project, options, output),
      ),
    );

  program
    .command('transcribe')
    .description("what the mic said, word by word, into the take's transcript.json (a speech model is needed: cuttle models)")
    .option('--model <name>', 'base, small or large-v3-turbo-q5_0 (default: small when downloaded)')
    .option('--language <code>', 'auto, de, en, … (default: auto)')
    .action(
      action((output, project, options: { model?: string; language?: string }) => withSignal(output, (signal) => transcribeCommand(project, options, output, signal))),
    );

  const models = program.command('models').description('the speech models for transcribe: list, download or remove them');
  models
    .command('list', { isDefault: true })
    .description('the models, and which are downloaded')
    .action(action((output) => modelsListCommand(output)));
  models
    .command('download <name>')
    .description('download a model once (base 148 MB, small 488 MB, large-v3-turbo-q5_0 574 MB), checked by its checksum')
    .action(action((output, _project, name: string) => withSignal(output, (signal) => modelsDownloadCommand(name, output, signal))));
  models
    .command('remove <name>')
    .description('remove a downloaded model')
    .action(action((output, _project, name: string) => modelsRemoveCommand(name, output)));

  program
    .command('preview')
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node apps/cli`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cli
git commit -m "cli: cuttle transcribe, cuttle models, and suggest --no-speech --no-transcribe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The app transcribes after the cut

**Files:**
- Create: `apps/desktop/src/main/speech.ts`, `apps/desktop/src/shared/take.ts`
- Modify: `apps/desktop/src/shared/{ipc,channels,media-jobs}.ts`, `apps/desktop/src/workers/media.ts`, `apps/desktop/src/main/{settings,settings-window,recording,windows,project-watch}.ts`, `apps/desktop/src/renderer/editor/{App.tsx,Inspector.tsx,doc.ts,player.ts,editor.css}`, `apps/desktop/src/renderer/settings/{Settings.tsx,settings.css}`, `apps/desktop/test/contract.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/test/contract.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { WINDOW_CHANNELS } from '../src/shared/channels';
import { REQUESTS } from '../src/shared/ipc';
import { MAX_THUMBS, PeakFolder, PEAKS_RATE, PEAKS_SAMPLE_RATE, progressOf, proxyArgs, thumbnailsArgs, thumbnailsMeta } from '../src/shared/media-jobs';

describe('the IPC contract', () => {
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { MODEL_NAMES } from '@cuttle/core';
import { WINDOW_CHANNELS } from '../src/shared/channels';
import { REQUESTS, SPEECH_MODEL_NAMES } from '../src/shared/ipc';
import { takeKey } from '../src/shared/take';
import { MAX_THUMBS, PeakFolder, PEAKS_RATE, PEAKS_SAMPLE_RATE, progressOf, proxyArgs, thumbnailsArgs, thumbnailsMeta } from '../src/shared/media-jobs';

describe('the IPC contract', () => {
```

In the same file, replace:

```ts
    expect(REQUESTS['pill:open'].safeParse({ dir: 'C:\\demo' }).success).toBe(true);
    expect(REQUESTS['pill:open'].safeParse({ dir: '' }).success).toBe(false);
    expect(REQUESTS['project:info'].safeParse({ any: 1 }).success).toBe(false);
  });
});
```

with:

```ts
    expect(REQUESTS['pill:open'].safeParse({ dir: 'C:\\demo' }).success).toBe(true);
    expect(REQUESTS['pill:open'].safeParse({ dir: '' }).success).toBe(false);
    expect(REQUESTS['project:info'].safeParse({ any: 1 }).success).toBe(false);
    expect(REQUESTS['speech:download'].safeParse('small').success).toBe(true);
    expect(REQUESTS['speech:download'].safeParse('../../evil').success).toBe(false);
  });

  it('names the speech models as @cuttle/core does (the windows cannot import it)', () => {
    expect(SPEECH_MODEL_NAMES).toEqual(MODEL_NAMES);
  });

  it('takes a transcript linked to the take for the same take', () => {
    const take = { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a' };
    expect(takeKey({ ...take, transcript: 'takes/1/transcript.json' })).toBe(takeKey(take));
    expect(takeKey({ ...take, mic: 'takes/2/mic.m4a' })).not.toBe(takeKey(take));
  });
});
```

Run: `pnpm exec vitest run --project node apps/desktop/test/contract.test.ts`
Expected: FAIL: `SPEECH_MODEL_NAMES` and `../src/shared/take` do not exist.

- [ ] **Step 2: The contract**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
/** What the main process is doing to a project, shown in its editor's title bar. */
export interface ProjectStatus {
  text?: string;
  /** `working`: cutting the take (a spinner); `failed`: it could not (Try again); `recording`: a new take records (the player pauses). */
  state?: 'working' | 'failed' | 'recording';
}

/** The tools around the app: ffmpeg, and for Claude Code the cuttle command and the skill. */
```

with:

```ts
/** What the main process is doing to a project, shown in its editor's title bar. */
export interface ProjectStatus {
  text?: string;
  /** `working`: cutting the take or transcribing it (a spinner); `failed`: it could not (Try again); `recording`: a new take records (the player pauses). */
  state?: 'working' | 'failed' | 'recording';
  /** What Try again does after a failure: cut the take again (the default), or transcribe it again. */
  retry?: 'cut' | 'speech';
}

/** The speech models (as @cuttle/core's MODEL_NAMES; a contract test keeps them alike). */
export const SPEECH_MODEL_NAMES = ['base', 'small', 'large-v3-turbo-q5_0'] as const;
export type SpeechModelName = (typeof SPEECH_MODEL_NAMES)[number];
export const SPEECH_LANGUAGES = ['auto', 'de', 'en'] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];

/** The speech models on this computer, and a download under way or the last one that failed. */
export interface SpeechStatus {
  /** Where the models are kept. */
  dir: string;
  models: { name: SpeechModelName; label: string; bytes: number; note: string; installed: boolean }[];
  /** Whether ffmpeg can transcribe (its `whisper` filter); undefined without ffmpeg. */
  whisper?: boolean;
  download?: { name: SpeechModelName; received: number; total: number };
  failure?: { name: SpeechModelName; message: string };
}

/** The tools around the app: ffmpeg, and for Claude Code the cuttle command and the skill. */
```

In the same file, replace:

```ts
  mic?: string;
  launchAtLogin: boolean;
  motion: Motion;
  /** `open`: the project is open in Cuttle, here (`here`) or on the computer named. */
  recent: { dir: string; name: string; opened: number; open?: string }[];
  version: string;
```

with:

```ts
  mic?: string;
  launchAtLogin: boolean;
  motion: Motion;
  /** Transcribing a take after its cut: the model (or off) and the language spoken. */
  speech: { model: SpeechModelName | 'off'; language: SpeechLanguage };
  /** `open`: the project is open in Cuttle, here (`here`) or on the computer named. */
  recent: { dir: string; name: string; opened: number; open?: string }[];
  version: string;
```

In the same file, replace:

```ts
  'project:takes': z.undefined(),
  // cut the take with suggest again, after it failed
  'project:cut': z.undefined(),
  // picker
  'picker:setup': z.undefined(),
  'picker:hover': z.undefined(),
```

with:

```ts
  'project:takes': z.undefined(),
  // cut the take with suggest again, after it failed
  'project:cut': z.undefined(),
  // transcribe the take's mic (after it failed, or a model came later) and cut its filler words and pauses
  'project:transcribe': z.undefined(),
  // picker
  'picker:setup': z.undefined(),
  'picker:hover': z.undefined(),
```

In the same file, replace:

```ts
    mic: z.string().min(1).max(512).nullable().optional(),
    launchAtLogin: z.boolean().optional(),
    motion: z.enum(MOTIONS).optional(),
  }),
  /** Asks for the projects folder (a folder dialog) and keeps it. */
  'settings:choose-folder': z.undefined(),
```

with:

```ts
    mic: z.string().min(1).max(512).nullable().optional(),
    launchAtLogin: z.boolean().optional(),
    motion: z.enum(MOTIONS).optional(),
    speechModel: z.enum(['off', ...SPEECH_MODEL_NAMES]).optional(),
    speechLanguage: z.enum(SPEECH_LANGUAGES).optional(),
  }),
  /** Asks for the projects folder (a folder dialog) and keeps it. */
  'settings:choose-folder': z.undefined(),
```

In the same file, replace:

```ts
  'recent:forget': z.string().min(1).max(4096),
  /** Renames a recent project's folder (not while it is open or recording). */
  'recent:rename': z.strictObject({ dir: z.string().min(1).max(4096), name: z.string().trim().min(1).max(120) }),
} as const;

export type Request = keyof typeof REQUESTS;
```

with:

```ts
  'recent:forget': z.string().min(1).max(4096),
  /** Renames a recent project's folder (not while it is open or recording). */
  'recent:rename': z.strictObject({ dir: z.string().min(1).max(4096), name: z.string().trim().min(1).max(120) }),
  'speech:status': z.undefined(),
  /** Downloads a speech model (checked by size and checksum); answers once it is there or failed. */
  'speech:download': z.enum(SPEECH_MODEL_NAMES),
  'speech:cancel': z.undefined(),
  'speech:remove': z.enum(SPEECH_MODEL_NAMES),
} as const;

export type Request = keyof typeof REQUESTS;
```

In the same file, replace:

```ts
  'project:record': void;
  'project:takes': void;
  'project:cut': void;
  'picker:setup': PickerSetup | undefined;
  'picker:hover': void;
  'picker:choices': void;
```

with:

```ts
  'project:record': void;
  'project:takes': void;
  'project:cut': void;
  /** Started (the title bar shows it), or why not, and whether Settings is the place to fix it. */
  'project:transcribe': { started: true } | { problem: string; settings?: boolean };
  'picker:setup': PickerSetup | undefined;
  'picker:hover': void;
  'picker:choices': void;
```

In the same file, replace:

```ts
  'hud:resume': void;
  'hud:restart': void;
  /** Written (its new hash); or the file changed meanwhile (the version on disk now); or it could not be written. */
  'project:save': { hash: string } | { conflict: ProjectVersion & { origin: 'outside' | 'suggest' } } | { problem: string };
  /** An image chosen by the person, copied into the project when it lay outside (a path inside the project). */
  'project:import-image': { path: string } | undefined;
  /** The person's version a save conflict could not carry over, written to cuttle.json.draft. */
```

with:

```ts
  'hud:resume': void;
  'hud:restart': void;
  /** Written (its new hash); or the file changed meanwhile (the version on disk now); or it could not be written. */
  'project:save': { hash: string } | { conflict: ProjectVersion & { origin: ChangeOrigin } } | { problem: string };
  /** An image chosen by the person, copied into the project when it lay outside (a path inside the project). */
  'project:import-image': { path: string } | undefined;
  /** The person's version a save conflict could not carry over, written to cuttle.json.draft. */
```

In the same file, replace:

```ts
  'recent:forget': SettingsView;
  /** The project's new folder, or why it could not be renamed. */
  'recent:rename': { dir: string } | { problem: string };
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
```

with:

```ts
  'recent:forget': SettingsView;
  /** The project's new folder, or why it could not be renamed. */
  'recent:rename': { dir: string } | { problem: string };
  'speech:status': SpeechStatus;
  'speech:download': SpeechStatus;
  'speech:cancel': void;
  'speech:remove': SpeechStatus;
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
```

In the same file, replace:

```ts

/**
 * cuttle.json changed on disk, not by this window: a new version (`origin`: `suggest` when the app's
 * own suggest cut the take, else another program, Claude or the CLI), or one that does not parse.
 */
export type ProjectFileEvent = (ProjectVersion & { origin: 'outside' | 'suggest' }) | { issues: string[] };

/** Events (main → window). */
export interface Events {
```

with:

```ts

/**
 * cuttle.json changed on disk, not by this window: a new version (`origin`: `suggest` when the app's
 * own suggest cut the take, `speech` when the app cut its filler words and pauses, else another
 * program, Claude or the CLI), or one that does not parse.
 */
export type ProjectFileEvent = (ProjectVersion & { origin: ChangeOrigin }) | { issues: string[] };

/** Who changed cuttle.json outside the editor: another program, or the app's own cut or speech edits. */
export type ChangeOrigin = 'outside' | 'suggest' | 'speech';

/** Events (main → window). */
export interface Events {
```

In the same file, replace:

```ts
  /** A note for the editor's person once the take is in, said there (an undone restart). */
  'project:note': { text: string };
  'settings:changed': SettingsView;
  /** Every window: how motion is set now (`data-motion` on the page's root). */
  'app:motion': Motion;
}
```

with:

```ts
  /** A note for the editor's person once the take is in, said there (an undone restart). */
  'project:note': { text: string };
  'settings:changed': SettingsView;
  /** The speech models changed, or a download moved on. */
  'speech:status': SpeechStatus;
  /** Every window: how motion is set now (`data-motion` on the page's root). */
  'app:motion': Motion;
}
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
      'project:record',
      'project:takes',
      'project:cut',
      'project:save',
      'project:import-image',
      'project:draft',
```

with:

```ts
      'project:record',
      'project:takes',
      'project:cut',
      'project:transcribe',
      'project:save',
      'project:import-image',
      'project:draft',
```

In the same file, replace:

```ts
      'recent:reveal',
      'recent:forget',
      'recent:rename',
    ],
    events: ['settings:changed', 'app:motion'],
  },
} as const satisfies Record<string, { requests: readonly Request[]; events: readonly Event[] }>;
```

with:

```ts
      'recent:reveal',
      'recent:forget',
      'recent:rename',
      'speech:status',
      'speech:download',
      'speech:cancel',
      'speech:remove',
    ],
    events: ['settings:changed', 'speech:status', 'app:motion'],
  },
} as const satisfies Record<string, { requests: readonly Request[]; events: readonly Event[] }>;
```

`apps/desktop/src/shared/take.ts`:

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

- [ ] **Step 3: The media worker's jobs**

In `apps/desktop/src/shared/media-jobs.ts`, replace:

```ts
  output: string;
}

export type MediaJob = ProxyJob | ThumbnailsJob | PeaksJob | SuggestJob;

export interface ThumbnailsMeta {
  interval: number;
```

with:

```ts
  output: string;
}

/** Transcribes a project's mic (`input`: its folder) into its take's transcript.json, not linked yet. */
export interface TranscribeJob {
  job: 'transcribe';
  input: string;
  output: string;
  model: string;
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

export interface ThumbnailsMeta {
  interval: number;
```

In `apps/desktop/src/workers/media.ts`, replace:

```ts
// the main process queues them.
import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { ffmpegPath, probeScreen, streamSeconds, suggestProject } from '@cuttle/core';
import {
  PEAKS_SAMPLE_RATE,
  PeakFolder,
```

with:

```ts
// the main process queues them.
import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { applySpeechEdits, ffmpegPath, probeScreen, streamSeconds, suggestProject, transcribeTake } from '@cuttle/core';
import {
  PEAKS_SAMPLE_RATE,
  PeakFolder,
```

In the same file, replace:

```ts
const port = (process as unknown as { parentPort: ParentPort }).parentPort;
const running = new Map<number, ChildProcess>();
const cancelled = new Set<number>();

const reply = (message: WorkerReply) => port.postMessage(message);
```

with:

```ts
const port = (process as unknown as { parentPort: ParentPort }).parentPort;
const running = new Map<number, ChildProcess>();
const cancelled = new Set<number>();
/** The jobs that run ffmpeg through @cuttle/core, stopped by their signal. */
const controllers = new Map<number, AbortController>();

const reply = (message: WorkerReply) => port.postMessage(message);
```

In the same file, replace:

```ts
      return meta;
    }
    case 'suggest': {
      await suggestProject(job.input, { onStatus: () => reply({ id, progress: 0 }) });
      return undefined;
    }
    case 'peaks': {
```

with:

```ts
      return meta;
    }
    case 'suggest': {
      // the app transcribes after the cut, as a step of its own (`transcribe`, `speech-edits`)
      await suggestProject(job.input, { transcribe: false, onStatus: () => reply({ id, progress: 0 }) });
      return undefined;
    }
    case 'transcribe': {
      const controller = new AbortController();
      controllers.set(id, controller);
      try {
        await transcribeTake(job.input, { model: job.model, language: job.language, link: false, signal: controller.signal, onProgress: (progress) => reply({ id, progress }) });
      } finally {
        controllers.delete(id);
      }
      return undefined;
    }
    case 'speech-edits': {
      await applySpeechEdits(job.input, { link: job.transcript });
      return undefined;
    }
    case 'peaks': {
```

In the same file, replace:

```ts
  if (data.cancel) {
    cancelled.add(data.id);
    running.get(data.id)?.kill();
    return;
  }
  const { id, ...job } = data;
```

with:

```ts
  if (data.cancel) {
    cancelled.add(data.id);
    running.get(data.id)?.kill();
    controllers.get(data.id)?.abort();
    return;
  }
  const { id, ...job } = data;
```

- [ ] **Step 4: The settings and the speech in the main process**

In `apps/desktop/src/main/settings.ts`, replace:

```ts
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import { z } from 'zod';
import { MOTIONS, type Motion, type SettingsView } from '../shared/ipc';

const RECENT_MAX = 10;
```

with:

```ts
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import { z } from 'zod';
import { MOTIONS, SPEECH_LANGUAGES, SPEECH_MODEL_NAMES, type Motion, type SettingsView } from '../shared/ipc';

const RECENT_MAX = 10;
```

In the same file, replace:

```ts
  launchAtLogin: z.boolean().catch(false).default(false),
  /** Motion in the app's windows: the OS's "reduce motion" (system), or always reduced, or always full. */
  motion: z.enum(MOTIONS).catch('system').default('system'),
  /** The picker bar's choices, kept between recordings (the camera and mic are the defaults in the settings). */
  record: z
    .object({ camera: z.string().optional(), mic: z.string().optional(), stop: z.enum(['none', 'claude', 'idle']).default('none'), claudeFolder: z.string().optional() })
```

with:

```ts
  launchAtLogin: z.boolean().catch(false).default(false),
  /** Motion in the app's windows: the OS's "reduce motion" (system), or always reduced, or always full. */
  motion: z.enum(MOTIONS).catch('system').default('system'),
  /** Transcribing a take after its cut: the speech model (`small` until the person picks), and the language spoken. */
  speech: z
    .object({
      model: z.enum(['off', ...SPEECH_MODEL_NAMES]).catch('small').default('small'),
      language: z.enum(SPEECH_LANGUAGES).catch('auto').default('auto'),
    })
    .catch({ model: 'small' as const, language: 'auto' as const })
    .default({ model: 'small' as const, language: 'auto' as const }),
  /** The picker bar's choices, kept between recordings (the camera and mic are the defaults in the settings). */
  record: z
    .object({ camera: z.string().optional(), mic: z.string().optional(), stop: z.enum(['none', 'claude', 'idle']).default('none'), claudeFolder: z.string().optional() })
```

In the same file, replace:

```ts
    ...(settings.record.mic !== undefined && { mic: settings.record.mic }),
    launchAtLogin: settings.launchAtLogin,
    motion: settings.motion,
    recent: settings.recent,
    version: appVersion(),
  };
```

with:

```ts
    ...(settings.record.mic !== undefined && { mic: settings.record.mic }),
    launchAtLogin: settings.launchAtLogin,
    motion: settings.motion,
    speech: { ...settings.speech },
    recent: settings.recent,
    version: appVersion(),
  };
```

`apps/desktop/src/main/speech.ts`:

```ts
// Speech in the app: the models (download with progress and cancel, remove), and transcribing a
// take after its cut, in the media worker, then its filler words and pauses cut as one change.
import { dirname, join, relative, resolve, sep } from 'node:path';
import { CoreError, SPEECH_MODELS, TRANSCRIPT_FILE, downloadModel, hasWhisper, installedModels, modelInstalled, modelsDir, readProjectFile, removeModel } from '@cuttle/core';
import type { SpeechModelName, SpeechStatus } from '../shared/ipc';
import { mediaWorker } from './media-service';
import { loadSettings } from './settings';
import { expectSpeech, setEditorStatus } from './windows';

let download: { name: SpeechModelName; received: number; total: number; controller: AbortController; percent: number } | undefined;
let failure: SpeechStatus['failure'];
const listeners = new Set<(status: SpeechStatus) => void>();

/** Whether ffmpeg can transcribe, as last asked (undefined: no ffmpeg). */
let whisper: boolean | undefined;

/**
 * The models here, whether ffmpeg can transcribe, and the download under way or the one that
 * failed. `fresh`: ask ffmpeg again (the settings window asks when it opens; ffmpeg may have been
 * updated), else its last answer, as while a download moves on.
 */
export async function speechStatus(fresh = true): Promise<SpeechStatus> {
  const installed = await installedModels();
  if (fresh) whisper = await hasWhisper(true).catch(() => undefined);
  return {
    dir: modelsDir(),
    models: SPEECH_MODELS.map((model) => ({ name: model.name, label: model.label, bytes: model.bytes, note: model.note, installed: installed.includes(model.name) })),
    ...(whisper !== undefined && { whisper }),
    ...(download && { download: { name: download.name, received: download.received, total: download.total } }),
    ...(failure && { failure }),
  };
}

/** Calls `listener` whenever the models change or a download moves on (every whole percent). */
export function onSpeechStatus(listener: (status: SpeechStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const announce = async () => {
  if (listeners.size === 0) return;
  const status = await speechStatus(false);
  for (const listener of listeners) listener(status);
};

/** Downloads a model (one at a time), answering once it is there, failed or was cancelled. */
export async function downloadSpeechModel(name: SpeechModelName): Promise<SpeechStatus> {
  if (download) return speechStatus(false);
  const model = SPEECH_MODELS.find((entry) => entry.name === name)!;
  const controller = new AbortController();
  download = { name, received: 0, total: model.bytes, controller, percent: 0 };
  failure = undefined;
  void announce();
  try {
    await downloadModel(name, {
      signal: controller.signal,
      onProgress: (received, total) => {
        if (!download) return;
        download.received = received;
        download.total = total;
        const percent = Math.floor((received / total) * 100);
        if (percent !== download.percent) {
          download.percent = percent;
          void announce();
        }
      },
    });
  } catch (error) {
    if (!(error instanceof CoreError && error.code === 'cancelled')) failure = { name, message: (error as Error).message.split('\n')[0]! };
  } finally {
    download = undefined;
  }
  void announce();
  return speechStatus(false);
}

export function cancelSpeechDownload(): void {
  download?.controller.abort();
}

/** Removes a downloaded model (not the one being downloaded). */
export async function removeSpeechModel(name: SpeechModelName): Promise<SpeechStatus> {
  if (download?.name !== name) await removeModel(name);
  void announce();
  return speechStatus(false);
}

/** Projects being transcribed now (their folders, as given). */
const transcribing = new Set<string>();

/**
 * Transcribes the project's mic after its cut and cuts its filler words and pauses, when speech is
 * on in the settings, the take has a mic and no transcript yet, the model is downloaded and ffmpeg
 * can transcribe. The editor's title bar shows the progress, and the speech edits arrive as one
 * step to undo ("Cuttle's speech edits"). `asked`: the person asked for it (the Auto tab, Try again):
 * it runs again over a transcript there, and says why it cannot instead of staying quiet.
 */
export async function transcribeProject(dir: string, asked = false): Promise<{ started: true } | { problem: string; settings?: boolean }> {
  const quiet = (problem: string, settings?: boolean) => (asked ? { problem, ...(settings && { settings }) } : { problem });
  if (transcribing.has(dir)) return { started: true };
  const { speech } = await loadSettings();
  if (speech.model === 'off') return quiet('Speech is off in the settings.', true);
  const file = await readProjectFile(dir).catch(() => undefined);
  const mic = file?.project.sources.mic;
  if (!file || mic === undefined) return quiet('This take has no mic.');
  if (file.project.sources.transcript !== undefined && !asked) return { problem: 'already transcribed' };
  const model = SPEECH_MODELS.find((entry) => entry.name === speech.model)!;
  if (!(await modelInstalled(model.name))) return quiet(`Download the ${model.label} speech model in the settings first.`, true);
  if (!(await hasWhisper(true).catch(() => false))) return quiet('This ffmpeg cannot transcribe: it needs version 8 or later (winget upgrade Gyan.FFmpeg, or on macOS brew upgrade ffmpeg).', true);
  transcribing.add(dir);
  void (async () => {
    const status = (progress: number) => setEditorStatus(dir, { text: `Transcribing… ${Math.round(progress * 100)} %`, state: 'working' });
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
        throw error;
      }
      await setEditorStatus(dir, undefined);
    } catch (error) {
      const cancelled = (error as { cancelled?: boolean }).cancelled === true;
      await setEditorStatus(dir, cancelled ? undefined : { text: `The speech could not be transcribed: ${(error as Error).message.split('\n')[0]}`, state: 'failed', retry: 'speech' });
    } finally {
      transcribing.delete(dir);
    }
  })();
  return { started: true };
}
```

In `apps/desktop/src/main/settings-window.ts`, replace:

```ts
import { APP_ORIGIN, assetPath, bundlePath, serveApp } from './protocols';
import { keyOf, listCamerasAndMics, recordingRuns } from './recording';
import { loadSettings, sameDir, settingsView, updateSettings } from './settings';
import { installTools, skillFolder, toolsStatus } from './tools';
import { guard, lockDown, openEditorOrSay, showPill, webPreferences } from './windows';
```

with:

```ts
import { APP_ORIGIN, assetPath, bundlePath, serveApp } from './protocols';
import { keyOf, listCamerasAndMics, recordingRuns } from './recording';
import { loadSettings, sameDir, settingsView, updateSettings } from './settings';
import { cancelSpeechDownload, downloadSpeechModel, onSpeechStatus, removeSpeechModel, speechStatus } from './speech';
import { installTools, skillFolder, toolsStatus } from './tools';
import { guard, lockDown, openEditorOrSay, showPill, webPreferences } from './windows';
```

In the same file, replace:

```ts
        if (change.mic !== undefined) settings.record.mic = change.mic ?? undefined;
        if (change.launchAtLogin !== undefined) settings.launchAtLogin = change.launchAtLogin;
        if (change.motion !== undefined) settings.motion = change.motion;
      });
      if (change.launchAtLogin !== undefined) applyLoginItem(change.launchAtLogin);
      if (change.motion !== undefined) broadcastMotion(change.motion);
```

with:

```ts
        if (change.mic !== undefined) settings.record.mic = change.mic ?? undefined;
        if (change.launchAtLogin !== undefined) settings.launchAtLogin = change.launchAtLogin;
        if (change.motion !== undefined) settings.motion = change.motion;
        if (change.speechModel !== undefined) settings.speech.model = change.speechModel;
        if (change.speechLanguage !== undefined) settings.speech.language = change.speechLanguage;
      });
      if (change.launchAtLogin !== undefined) applyLoginItem(change.launchAtLogin);
      if (change.motion !== undefined) broadcastMotion(change.motion);
```

In the same file, replace:

```ts
      if ('dir' in answer) changed(await viewNow());
      return answer;
    },
  });
  // the first run counts as seen once it was closed, however
  if (options.welcome) {
    window.on('closed', () => {
```

with:

```ts
      if ('dir' in answer) changed(await viewNow());
      return answer;
    },
    'speech:status': () => speechStatus(),
    'speech:download': (name) => downloadSpeechModel(name),
    'speech:cancel': () => cancelSpeechDownload(),
    'speech:remove': (name) => removeSpeechModel(name),
  });
  // a download goes on while the window is closed; an open one follows it
  const offSpeech = onSpeechStatus((status) => {
    if (!contents.isDestroyed()) send(contents, 'speech:status', status);
  });
  window.on('closed', offSpeech);
  // the first run counts as seen once it was closed, however
  if (options.welcome) {
    window.on('closed', () => {
```

- [ ] **Step 5: After the cut, and the editor's origin**

In `apps/desktop/src/main/recording.ts`, replace:

```ts
import { recorderHost, RecordingError } from './recorder-host';
import { findFfmpeg } from './tools';
import { loadSettings, updateSettings } from './settings';
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, sendToEditor, setEditorStatus, showPill, webPreferences } from './windows';

/** The HUD's window (the HUD and a margin for its shadow): never in the video, and a dead zone for the input log. */
```

with:

```ts
import { recorderHost, RecordingError } from './recorder-host';
import { findFfmpeg } from './tools';
import { loadSettings, updateSettings } from './settings';
import { transcribeProject } from './speech';
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, sendToEditor, setEditorStatus, showPill, webPreferences } from './windows';

/** The HUD's window (the HUD and a margin for its shadow): never in the video, and a dead zone for the input log. */
```

In the same file, replace:

```ts
    return;
  }
  await setEditorStatus(dir, undefined);
}

/** "Try again" in the editor after a failed cut. */
```

with:

```ts
    return;
  }
  await setEditorStatus(dir, undefined);
  // then what was said: transcribed, its filler words and pauses cut (a step of its own)
  await transcribeProject(dir);
}

/** "Try again" in the editor after a failed cut. */
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
import { plainIssue } from '../shared/format';
import type { Event, Events, ExportEnd, ProjectFileEvent, ProjectStatus } from '../shared/ipc';
import { isInside } from '../shared/media-path';
import { CHECK, CHECK_IMAGE, HIDDEN } from './check';
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
```

with:

```ts
import { plainIssue } from '../shared/format';
import type { Event, Events, ExportEnd, ProjectFileEvent, ProjectStatus } from '../shared/ipc';
import { isInside } from '../shared/media-path';
import { takeKey } from '../shared/take';
import { CHECK, CHECK_IMAGE, HIDDEN } from './check';
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
```

In the same file, replace:

```ts
import { cutIfPending, recut, startPicking, undoRestart } from './recording';
import { addRecent, loadSettings, motionSetting, updateSettings } from './settings';
import { openSettings } from './settings-window';

const BACKGROUND = '#0c0c0f';
const TITLE_BAR_HEIGHT = 44;
```

with:

```ts
import { cutIfPending, recut, startPicking, undoRestart } from './recording';
import { addRecent, loadSettings, motionSetting, updateSettings } from './settings';
import { openSettings } from './settings-window';
import { transcribeProject } from './speech';

const BACKGROUND = '#0c0c0f';
const TITLE_BAR_HEIGHT = 44;
```

In the same file, replace:

```ts
  function onFileChange(event: ProjectFileEvent): void {
    if ('raw' in event) {
      const parsed = parseProject(event.raw);
      if (parsed.ok && JSON.stringify(parsed.project.sources) !== JSON.stringify(editor.media.sources)) {
        editor.media.dispose();
        editor.media = newMedia(parsed.project);
        void editor.media.start();
```

with:

```ts
  function onFileChange(event: ProjectFileEvent): void {
    if ('raw' in event) {
      const parsed = parseProject(event.raw);
      if (parsed.ok && takeKey(parsed.project.sources) !== takeKey(editor.media.sources)) {
        editor.media.dispose();
        editor.media = newMedia(parsed.project);
        void editor.media.start();
```

In the same file, replace:

```ts
    'project:record': () => void startPicking(dir),
    'project:takes': () => takesMenu(dir, window),
    'project:cut': () => void recut(dir),
    'project:undo-restart': (discarded) => void undoRestart(dir, discarded),
    'app:settings': () => void openSettings(),
    'project:save': ({ raw, base }) => editor.watch.save(raw, base),
```

with:

```ts
    'project:record': () => void startPicking(dir),
    'project:takes': () => takesMenu(dir, window),
    'project:cut': () => void recut(dir),
    'project:transcribe': () => transcribeProject(dir, true),
    'project:undo-restart': (discarded) => void undoRestart(dir, discarded),
    'app:settings': () => void openSettings(),
    'project:save': ({ raw, base }) => editor.watch.save(raw, base),
```

In the same file, replace:

```ts
  if (editor) editor.watch.origin = expecting ? 'suggest' : 'outside';
}

/** The window of a project's open editor, if there is one. */
export async function editorWindowOf(dir: string): Promise<BrowserWindow | undefined> {
  const editor = await editorOf(dir);
```

with:

```ts
  if (editor) editor.watch.origin = expecting ? 'suggest' : 'outside';
}

/** The next outside change of the project comes from the app's own speech edits ("Cuttle's speech edits"). */
export async function expectSpeech(dir: string, expecting: boolean): Promise<void> {
  const editor = await editorOf(dir);
  if (editor) editor.watch.origin = expecting ? 'speech' : 'outside';
}

/** The window of a project's open editor, if there is one. */
export async function editorWindowOf(dir: string): Promise<BrowserWindow | undefined> {
  const editor = await editorOf(dir);
```

In `apps/desktop/src/main/project-watch.ts`, replace:

```ts
import { CoreError, PROJECT_FILE, projectHash, readProjectFile, writeProjectFile } from '@cuttle/core';
import { parseProject, parseProjectJson } from '@cuttle/project';
import { locateJsonIssue, plainIssue } from '../shared/format';
import type { ProjectFileEvent, Responses } from '../shared/ipc';
import { isInside } from '../shared/media-path';

const firstLine = (message: string) => message.split('\n')[0]!;
```

with:

```ts
import { CoreError, PROJECT_FILE, projectHash, readProjectFile, writeProjectFile } from '@cuttle/core';
import { parseProject, parseProjectJson } from '@cuttle/project';
import { locateJsonIssue, plainIssue } from '../shared/format';
import type { ChangeOrigin, ProjectFileEvent, Responses } from '../shared/ipc';
import { isInside } from '../shared/media-path';

const firstLine = (message: string) => message.split('\n')[0]!;
```

In the same file, replace:

```ts
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The last version reported did not parse: the next that does is reported even when known (a fix back to it). */
  private broken = false;
  /** Who the next outside change comes from: the app's own suggest, while it cuts a take. */
  origin: 'outside' | 'suggest' = 'outside';
  /**
   * Looks and saves, one at a time: a look that read the file while a save replaced it would take
   * the version before the save for someone else's (fast undos), and report a version already gone.
```

with:

```ts
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The last version reported did not parse: the next that does is reported even when known (a fix back to it). */
  private broken = false;
  /** Who the next outside change comes from: the app's own suggest while it cuts a take, or its speech edits. */
  origin: ChangeOrigin = 'outside';
  /**
   * Looks and saves, one at a time: a look that read the file while a save replaced it would take
   * the version before the save for someone else's (fast undos), and report a version already gone.
```

- [ ] **Step 6: The editor**

In `apps/desktop/src/renderer/editor/doc.ts`, replace:

```ts
// removes it without saying so.
import { parseProject, type CuttleProject } from '@cuttle/project';
import { applyCommand, describeChange, DocumentError, ensureIds, firstChanged, pinIds, replayCommands, type Command, type EditLimits, type ListName, type Raw } from '../../shared/document';
import type { ProjectFileEvent } from '../../shared/ipc';
import { bridge } from '../bridge';
import { store } from './session';
```

with:

```ts
// removes it without saying so.
import { parseProject, type CuttleProject } from '@cuttle/project';
import { applyCommand, describeChange, DocumentError, ensureIds, firstChanged, pinIds, replayCommands, type Command, type EditLimits, type ListName, type Raw } from '../../shared/document';
import type { ChangeOrigin, ProjectFileEvent } from '../../shared/ipc';
import { takeKey } from '../../shared/take';
import { bridge } from '../bridge';
import { store } from './session';
```

In the same file, replace:

```ts
  void save();
}

const sourcesOf = (raw: Raw) => JSON.stringify(raw.sources);

/** The editor opens anew on another take (its media); the main process reloads it (a page cannot). */
function reloadForTake(): void {
```

with:

```ts
  void save();
}

const sourcesOf = (raw: Raw) => takeKey(raw.sources);

/** The undo step of a change made outside the editor, by who made it. */
const ORIGIN_LABELS: Record<ChangeOrigin, string> = { outside: 'the outside change', suggest: "Cuttle's cut", speech: "Cuttle's speech edits" };

/** What the app's speech edits did, said once they arrive. */
function speechToast(project: CuttleProject): string {
  const count = (kind: 'filler' | 'pause') => project.cuts.filter((cut) => cut.auto === kind && cut.enabled).length;
  const fillers = count('filler');
  const pauses = count('pause');
  if (fillers + pauses === 0) return 'Cuttle transcribed the take: no filler words or pauses to cut.';
  const parts = [fillers > 0 && `${fillers} filler word${fillers === 1 ? '' : 's'}`, pauses > 0 && `${pauses} pause${pauses === 1 ? '' : 's'}`].filter(Boolean);
  return `Cuttle cut ${parts.join(' and ')} where the picture rests.`;
}

/** The editor opens anew on another take (its media); the main process reloads it (a page cannot). */
function reloadForTake(): void {
```

In the same file, replace:

```ts
        setDoc({ problem: 'cuttle.json changed outside the app and has a mistake: your edit is saved once it is fixed' });
        return finish();
      }
      const outside = conflict.origin === 'suggest' ? "Cuttle's cut" : 'the outside change';
      if (restoring) {
        // An undo or redo is a whole version: the newer one shows, as a step to undo (back to the
        // version the person had asked for).
```

with:

```ts
        setDoc({ problem: 'cuttle.json changed outside the app and has a mistake: your edit is saved once it is fixed' });
        return finish();
      }
      const outside = ORIGIN_LABELS[conflict.origin];
      if (restoring) {
        // An undo or redo is a whole version: the newer one shows, as a step to undo (back to the
        // version the person had asked for).
```

In the same file, replace:

```ts
  } catch {
    return;
  }
  undoStack.push({ raw: before.raw, label: event.origin === 'suggest' ? "Cuttle's cut" : 'the outside change' });
  redoStack.length = 0;
  setDoc({ raw, project, hash: event.hash, preview: undefined });
  const show = firstChanged(before.project, project);
  toast(event.origin === 'suggest' ? 'Cuttle cut the take.' : `Changed outside the app: ${describeChange(before.project, project)}`, { undo: true, ...(show && event.origin !== 'suggest' && { show }) });
}
```

with:

```ts
  } catch {
    return;
  }
  undoStack.push({ raw: before.raw, label: ORIGIN_LABELS[event.origin] });
  redoStack.length = 0;
  setDoc({ raw, project, hash: event.hash, preview: undefined });
  const show = firstChanged(before.project, project);
  const said = event.origin === 'suggest' ? 'Cuttle cut the take.' : event.origin === 'speech' ? speechToast(project) : `Changed outside the app: ${describeChange(before.project, project)}`;
  toast(said, { undo: true, ...(show && event.origin === 'outside' && { show }) });
}
```

In `apps/desktop/src/renderer/editor/player.ts`, replace:

```ts
  source?: number;
  /** Set when a frame could not be drawn, said for people. */
  error?: string;
}

/** Frames the playback decoders open before a scene shows. */
```

with:

```ts
  source?: number;
  /** Set when a frame could not be drawn, said for people. */
  error?: string;
  /** The video's length in output seconds, as the timeline the player shows has it. */
  duration?: number;
}

/** Frames the playback decoders open before a scene shows. */
```

In the same file, replace:

```ts
    const renew = look(project) !== look(this.project) || background !== this.drawnBackground;
    this.project = project;
    this.timeline = this.makeTimeline();
    if (renew) {
      this.renderer.dispose();
      this.renderer = this.makeRenderer();
```

with:

```ts
    const renew = look(project) !== look(this.project) || background !== this.drawnBackground;
    this.project = project;
    this.timeline = this.makeTimeline();
    // the title bar and the transport show the length: they learn it changed with the state
    this.set({ duration: this.timeline.duration });
    if (renew) {
      this.renderer.dispose();
      this.renderer = this.makeRenderer();
```

In `apps/desktop/src/renderer/editor/App.tsx`, replace:

```
  const media = useStore(store, (state) => state.media);
  const status = useStore(store, (state) => state.status);
  useStore(store, (state) => state.doc?.project);
  const duration = currentPlayer()?.duration ?? 0;
  const recorded = media ? media.screen.end - media.screen.start : 0;
  return (
```

with:

```
  const media = useStore(store, (state) => state.media);
  const status = useStore(store, (state) => state.status);
  useStore(store, (state) => state.doc?.project);
  // the player takes a new version a moment after the document: its length comes with its state
  useStore(store, (state) => state.player.duration);
  const duration = currentPlayer()?.duration ?? 0;
  const recorded = media ? media.screen.end - media.screen.start : 0;
  return (
```

In the same file, replace:

```
      {phase === 'ready' && <RestartChip />}
      <div className="grow" />
      {status?.state === 'failed' ? (
        <button className="chip-status warn" onClick={() => void bridge.invoke('project:cut')} title={`${status.text}. Click to try again.`} data-testid="project-status">
          <WarningIcon size={14} />
          <span className="chip-text">The take could not be cut</span> · Try again
        </button>
      ) : (
        status && (
```

with:

```
      {phase === 'ready' && <RestartChip />}
      <div className="grow" />
      {status?.state === 'failed' ? (
        <button
          className="chip-status warn"
          onClick={() => void bridge.invoke(status.retry === 'speech' ? 'project:transcribe' : 'project:cut')}
          title={`${status.text}. Click to try again.`}
          data-testid="project-status"
        >
          <WarningIcon size={14} />
          <span className="chip-text">{status.retry === 'speech' ? 'The speech could not be transcribed' : 'The take could not be cut'}</span> · Try again
        </button>
      ) : (
        status && (
```

In the same file, replace:

```
  const format = useStore(store, (state) => state.format);
  const output = useStore(store, (state) => state.doc?.project.output);
  const own = ownFormat(output);
  const duration = currentPlayer()?.duration ?? 0;
  return (
    <div className="transport">
```

with:

```
  const format = useStore(store, (state) => state.format);
  const output = useStore(store, (state) => state.doc?.project.output);
  const own = ownFormat(output);
  useStore(store, (state) => state.player.duration);
  const duration = currentPlayer()?.duration ?? 0;
  return (
    <div className="transport">
```

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { outputTimesOf } from '../../shared/timeline-model';
import { CardIcon, ChevronIcon, CopyIcon, CropIcon, FilmIcon, MaskIcon, PageIcon, SplitIcon, TextIcon, TrashIcon, ZoomIcon } from '../icons';
import { Select as StyledSelect } from '../Select';
import { chooseImage, cutShownAt, deleteSelection, duplicateSelection, LIST_OF, playheadPlace, reveal, SPEEDS } from './actions';
```

with:

```
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { outputTimesOf } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { CardIcon, ChevronIcon, CopyIcon, CropIcon, FilmIcon, MaskIcon, PageIcon, SplitIcon, TextIcon, TrashIcon, ZoomIcon } from '../icons';
import { Select as StyledSelect } from '../Select';
import { chooseImage, cutShownAt, deleteSelection, duplicateSelection, LIST_OF, playheadPlace, reveal, SPEEDS } from './actions';
```

In the same file, replace:

```
  if (groups.length === 0) {
    return (
      <div className="auto-empty" data-testid="auto-empty">
        <p>
          <b>Nothing automatic yet.</b>
        </p>
```

with:

```
  if (groups.length === 0) {
    return (
      <div className="auto-empty" data-testid="auto-empty">
        <SpeechNote />
        <p>
          <b>Nothing automatic yet.</b>
        </p>
```

In the same file, replace:

```
  return (
    <div className="auto-panel" data-testid="auto-panel">
      <p className="hint auto-intro">What Cuttle did on its own. Switch a kind off and it leaves the video and is not made again; change an item and it is yours.</p>
      {groups.map(({ group, items }) => {
        const on = items.filter((item) => item.enabled).length;
        const kindOn = group.key ? project.autoEdits[group.key] : on > 0;
```

with:

```
  return (
    <div className="auto-panel" data-testid="auto-panel">
      <p className="hint auto-intro">What Cuttle did on its own. Switch a kind off and it leaves the video and is not made again; change an item and it is yours.</p>
      <SpeechNote />
      {groups.map(({ group, items }) => {
        const on = items.filter((item) => item.enabled).length;
        const kindOn = group.key ? project.autoEdits[group.key] : on > 0;
```

In the same file, replace:

```
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

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```
.auto-empty p {
  margin: 0;
}
/* "Made by Cuttle for …" under an automatic item's name */
.auto-note {
  margin: -4px 0 0;
```

with:

```
.auto-empty p {
  margin: 0;
}
/* the mic not transcribed yet, at the top of the Auto tab */
.speech-note {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--raised);
  color: var(--muted);
  font-size: var(--size-s);
  line-height: 1.5;
}
.speech-note p {
  margin: 0;
}
.speech-note b {
  color: var(--text);
  font-weight: 600;
}
.speech-problem {
  color: var(--card);
}
.speech-actions {
  display: flex;
  gap: 6px;
}
/* "Made by Cuttle for …" under an automatic item's name */
.auto-note {
  margin: -4px 0 0;
```

- [ ] **Step 7: The settings window**

In `apps/desktop/src/renderer/settings/Settings.tsx`, replace:

```
// The settings window, and the first run in the same window (#welcome): ffmpeg, the cuttle command
// and the Claude skill, then the pill. Every change is kept at once; there is no Save.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Motion, RequestArgument, SettingsView, ToolsStatus } from '../../shared/ipc';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, CopyIcon, FolderIcon, Mark, WarningIcon } from '../icons';
import { Select } from '../Select';
```

with:

```
// The settings window, and the first run in the same window (#welcome): ffmpeg, the cuttle command
// and the Claude skill, then the pill. Every change is kept at once; there is no Save.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Motion, RequestArgument, SettingsView, SpeechLanguage, SpeechModelName, SpeechStatus, ToolsStatus } from '../../shared/ipc';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, CopyIcon, FolderIcon, Mark, WarningIcon } from '../icons';
import { Select } from '../Select';
```

In the same file, replace:

```
              </Row>
            </Section>

            <Section title="To record">
              <FfmpegLine tools={tools} setTools={setTools} />
            </Section>
```

with:

```
              </Row>
            </Section>

            <Section title="Speech">
              <SpeechSettings view={view} change={change} />
            </Section>

            <Section title="To record">
              <FfmpegLine tools={tools} setTools={setTools} />
            </Section>
```

In the same file, replace:

```
  );
}

/** ffmpeg: found (its version and where), or how to install it and look again. */
function FfmpegLine({ tools, setTools }: { tools: ToolsStatus | undefined; setTools: (tools: ToolsStatus) => void }) {
  const [looking, setLooking] = useState(false);
```

with:

```
  );
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/**
 * Transcribing a take after its cut: the model (or off), its download (progress, cancel, checksum)
 * or removal, and the language spoken. Everything runs on this computer.
 */
function SpeechSettings({ view, change }: { view: SettingsView | undefined; change: (next: RequestArgument<'settings:set'>) => void }) {
  const [status, setStatus] = useState<SpeechStatus>();
  useEffect(() => {
    void bridge.invoke('speech:status').then(setStatus);
    return bridge.on('speech:status', setStatus);
  }, []);
  const chosen = view?.speech.model;
  const model = status?.models.find((entry) => entry.name === chosen);
  const download = status?.download;
  const failed = status?.failure?.name === chosen ? status?.failure : undefined;
  // one download at a time: the line shows it whichever model is chosen, so it can be cancelled
  const fetching = download !== undefined;
  const fetched = status?.models.find((entry) => entry.name === download?.name);
  const percent = fetching ? Math.floor((download.received / download.total) * 100) : 0;
  return (
    <>
      <Row label="Transcribe after a take" hint="Cuttle cuts filler words and pauses where the picture rests. It runs on this computer: nothing is uploaded.">
        <Select<SpeechModelName | 'off'>
          value={chosen}
          options={[
            { value: 'off', label: 'Off' },
            ...(status?.models ?? []).map((entry) => ({ value: entry.name, label: `${entry.label} (${entry.name})`, note: entry.installed ? 'downloaded' : megabytes(entry.bytes) })),
          ]}
          onChange={(speechModel) => change({ speechModel })}
          disabled={status === undefined}
          label="Speech model"
          className="device"
          testId="speech-model"
        />
      </Row>
      {model && (
        <ToolLine
          state={failed ? 'failed' : model.installed ? (status?.whisper === false ? 'warn' : 'ok') : fetching ? 'unknown' : 'off'}
          name={`The ${model.label} model`}
          detail={
            failed
              ? `The download failed: ${failed.message}`
              : fetching
                ? download.name === chosen
                  ? `Downloading… ${percent} % of ${megabytes(download.total)}`
                  : `The ${fetched?.label} model is downloading (${percent} % of ${megabytes(download.total)}): one download at a time.`
                : model.installed
                  ? status?.whisper === false
                    ? 'Downloaded, but this ffmpeg cannot transcribe: it needs version 8 or later (winget upgrade Gyan.FFmpeg, or on macOS brew upgrade ffmpeg).'
                    : `Downloaded: ${model.note}.`
                  : `${model.note[0]!.toUpperCase()}${model.note.slice(1)}. ${megabytes(model.bytes)} to download, once.`
          }
          title={status?.dir}
          testid="speech-line"
          busy={fetching}
          plain
        >
          {fetching ? (
            <>
              <progress className="download" max={download.total} value={download.received} aria-label={`Downloading the ${fetched?.label} model`} />
              <button className="ghost" onClick={() => void bridge.invoke('speech:cancel')} data-testid="speech-cancel">
                Cancel
              </button>
            </>
          ) : model.installed ? (
            <button className="ghost" onClick={() => void bridge.invoke('speech:remove', model.name).then(setStatus)} data-testid="speech-remove">
              Remove
            </button>
          ) : (
            <button className="primary" onClick={() => void bridge.invoke('speech:download', model.name).then(setStatus)} data-testid="speech-download">
              {failed ? 'Try again' : `Download (${megabytes(model.bytes)})`}
            </button>
          )}
        </ToolLine>
      )}
      <Row label="Language" hint="What is spoken in your takes. Auto finds out by itself.">
        <Segmented<SpeechLanguage>
          value={view?.speech.language}
          options={[
            ['auto', 'Auto'],
            ['de', 'Deutsch'],
            ['en', 'English'],
          ]}
          onChange={(speechLanguage) => change({ speechLanguage })}
          label="Language"
          testid="speech-language"
        />
      </Row>
    </>
  );
}

/** ffmpeg: found (its version and where), or how to install it and look again. */
function FfmpegLine({ tools, setTools }: { tools: ToolsStatus | undefined; setTools: (tools: ToolsStatus) => void }) {
  const [looking, setLooking] = useState(false);
```

In the same file, replace:

```

type ToolState = 'unknown' | 'ok' | 'off' | 'warn' | 'failed';

function ToolLine({ state, name, detail, title, testid, children }: { state: ToolState; name: string; detail: string; title?: string; testid: string; children?: ReactNode }) {
  return (
    <div className="tool" data-state={state === 'ok' ? 'ok' : state === 'unknown' ? 'unknown' : 'missing'} data-testid={testid}>
      <span className={`tool-mark ${state}`} aria-hidden>
```

with:

```

type ToolState = 'unknown' | 'ok' | 'off' | 'warn' | 'failed';

/** A tool or a model: a mark, its name, and a line on it (a path, in monospace, once it is there; `plain`: words). */
function ToolLine({ state, name, detail, title, testid, busy, plain, children }: { state: ToolState; name: string; detail: string; title?: string; testid: string; busy?: boolean; plain?: boolean; children?: ReactNode }) {
  return (
    <div className="tool" data-state={state === 'ok' ? 'ok' : state === 'unknown' ? 'unknown' : 'missing'} data-testid={testid}>
      <span className={`tool-mark ${state}`} aria-hidden>
```

In the same file, replace:

```
      </span>
      <div className="tool-text">
        <div className="row-label">{name}</div>
        <div className={`row-hint${state === 'ok' ? ' path-text' : ''}${state === 'failed' ? ' error-inline' : ''}`} title={title ?? detail} role={state === 'failed' ? 'alert' : undefined}>
          {state === 'unknown' ? 'Looking…' : detail}
        </div>
        {children && <div className="tool-extra">{children}</div>}
      </div>
```

with:

```
      </span>
      <div className="tool-text">
        <div className="row-label">{name}</div>
        <div className={`row-hint${state === 'ok' && !plain ? ' path-text' : ''}${state === 'failed' ? ' error-inline' : ''}`} title={title ?? detail} role={state === 'failed' ? 'alert' : undefined}>
          {state === 'unknown' && !busy ? 'Looking…' : detail}
        </div>
        {children && <div className="tool-extra">{children}</div>}
      </div>
```

In `apps/desktop/src/renderer/settings/settings.css`, replace:

```
  min-height: 56px;
}
.row + .row,
.tool + .tool,
.tool + .tools-actions {
  border-top: 1px solid var(--line);
```

with:

```
  min-height: 56px;
}
.row + .row,
.row + .tool,
.tool + .row,
.tool + .tool,
.tool + .tools-actions {
  border-top: 1px solid var(--line);
```

In the same file, replace:

```
  margin: 0;
}

/* recent projects */
.recent {
  list-style: none;
```

with:

```
  margin: 0;
}

/* a model's download */
progress.download {
  flex: 1;
  min-width: 120px;
  height: 6px;
  border: none;
  border-radius: 3px;
  overflow: hidden;
  background: var(--raised);
  appearance: none;
}
progress.download::-webkit-progress-bar {
  background: var(--raised);
}
progress.download::-webkit-progress-value {
  background: var(--accent);
  border-radius: 3px;
  transition: width var(--normal) var(--ease-out);
}

/* recent projects */
.recent {
  list-style: none;
```

- [ ] **Step 8: Run the tests and the typecheck**

Run: `pnpm exec vitest run --project node apps/desktop`
Expected: PASS.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop
git commit -m "desktop: transcription after the cut, the speech edits as one step, and the settings' Speech section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The skill

**Files:**
- Modify: `skill/cuttle/{SKILL,project}.md`, `skill/test/skill.test.ts`

- [ ] **Step 1: Write the failing test**

In `skill/test/skill.test.ts`, replace:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'preview', 'frame', 'capture-page', 'render', 'recover'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
```

with:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'preview', 'frame', 'capture-page', 'render', 'recover'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
```

Run: `pnpm exec vitest run --project node skill/test`
Expected: FAIL: the skill does not use `transcribe` and `models`.

- [ ] **Step 2: The skill**

In `skill/cuttle/SKILL.md`, replace:

```markdown
  X takes H.264 up to 1920×1200; keep demos under 60 s. A 16:9 screen fills only about a third
  of a 9:16 video: for 9:16 record a narrow window or region, or plan tight zooms.
- Webcam and mic only when asked (`--webcam`, `--mic`). A muted mic is reported as a warning.
- Ask the user to make text large (terminal font 16 px or more, or zoom the browser), to close
  private windows and notifications, and to use a clean folder or browser profile.
- The project folder: a new one per demo (`record` creates it).
```

with:

```markdown
  X takes H.264 up to 1920×1200; keep demos under 60 s. A 16:9 screen fills only about a third
  of a 9:16 video: for 9:16 record a narrow window or region, or plan tight zooms.
- Webcam and mic only when asked (`--webcam`, `--mic`). A muted mic is reported as a warning.
  When the user will speak, Cuttle transcribes the mic on this computer and cuts filler words and
  pauses. That needs a speech model: `cuttle --json models` lists them. If none is downloaded, ask
  the user before `cuttle models download small` (488 MB, once).
- Ask the user to make text large (terminal font 16 px or more, or zoom the browser), to close
  private windows and notifications, and to use a clean folder or browser profile.
- The project folder: a new one per demo (`record` creates it).
```

In the same file, replace:

```markdown
For a take recorded without `--until-claude`, add `--claude "<demo folder>"` to read the markers
from Claude Code's transcript.

`preview` writes 12 stills and `preview/sheet.png`. **Look at the sheet** (Read the PNG). Each
still in the JSON has its output second `t` and the `source` second it shows. For details, run
`cuttle -C "<project>" --json preview --at 3.5 --at 12` (output seconds). Each run replaces the
```

with:

```markdown
For a take recorded without `--until-claude`, add `--claude "<demo folder>"` to read the markers
from Claude Code's transcript.

**Speech.** With a mic, `suggest` keeps the stretches where someone speaks (never cut or sped up),
and when a speech model is downloaded it first transcribes the mic into `takes/<n>/transcript.json`
(every word with its source seconds; read it to find what was said where). It then cuts filler
words ("äh", "um") and pauses longer than a second down to 0.4 s, only where the picture rests
(cuts tagged `filler` and `pause`). `--no-speech` leaves the speech out.
`cuttle -C "<project>" --json transcribe --language de` transcribes again (`--model` picks one).

`preview` writes 12 stills and `preview/sheet.png`. **Look at the sheet** (Read the PNG). Each
still in the JSON has its output second `t` and the `source` second it shows. For details, run
`cuttle -C "<project>" --json preview --at 3.5 --at 12` (output seconds). Each run replaces the
```

In the same file, replace:

```markdown
- A crash or a killed recording: `cuttle -C "<project>" --json recover takes/<n>` makes the take
  usable.
- `suggest` found no Claude markers: pass `--claude "<demo folder>"`.
- `frame` says no frame starts at that second: the take ends there; take an earlier second.
- A render fails with `render`: try `--encoder software`.
- `conflict`: `cuttle.json` was saved by someone else (the user, or the Cuttle app) while the
```

with:

```markdown
- A crash or a killed recording: `cuttle -C "<project>" --json recover takes/<n>` makes the take
  usable.
- `suggest` found no Claude markers: pass `--claude "<demo folder>"`.
- `model-missing` (or the note "the mic was not transcribed"): no speech model is downloaded; ask
  the user before `cuttle models download small`.
- `ffmpeg-old`: this ffmpeg cannot transcribe (before 8.0). Ask the user to run
  `winget upgrade Gyan.FFmpeg` (macOS: `brew upgrade ffmpeg`).
- `frame` says no frame starts at that second: the take ends there; take an earlier second.
- A render fails with `render`: try `--encoder software`.
- `conflict`: `cuttle.json` was saved by someone else (the user, or the Cuttle app) while the
```

In `skill/cuttle/project.md`, replace:

```markdown
    "screen": "takes/1/screen.mp4",
    "mic": "takes/1/mic.m4a",
    "events": "takes/1/events.jsonl",
    "markers": "takes/1/markers.json"
  },
  "look": {
    "background": { "preset": "sunset-sky" },
```

with:

```markdown
    "screen": "takes/1/screen.mp4",
    "mic": "takes/1/mic.m4a",
    "events": "takes/1/events.jsonl",
    "markers": "takes/1/markers.json",
    "transcript": "takes/1/transcript.json"
  },
  "look": {
    "background": { "preset": "sunset-sky" },
```

In the same file, replace:

```markdown
`cuttle render --format` overrides the size: `16:9` is 1920×1080, `1:1` is 1080×1080, `9:16` is
1080×1920.

`sources`: paths relative to the project folder. `cuttle record` sets them.

`look` (every field is optional):
```

with:

```markdown
`cuttle render --format` overrides the size: `16:9` is 1920×1080, `1:1` is 1080×1080, `9:16` is
1080×1920.

`sources`: paths relative to the project folder. `cuttle record` sets them; `transcript` is set
once the mic was transcribed (`cuttle transcribe`, or `suggest` with a speech model). Never edit
transcript.json: `{ "language", "model", "words": [{ "t", "end", "text" }], "sounds": [{ "t", "end" }] }`,
in source seconds; `sounds` are stretches the mic heard without a word (a cough, a dropped filler).

`look` (every field is optional):
```

In the same file, replace:

```markdown

`cuts` take a stretch out of whatever clip covers it, without splitting the clip: `from` and `to`
(source seconds) and `enabled` (`true`). The video jumps there (no crossfade); zooms, masks and
texts run on across it. Use them for a slip, a filler or a pause inside a clip.

Every scene, zoom, mask, text and cut may have an `id` (1 to 64 letters, digits, `-` or `_`,
unique in the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest`
```

with:

```markdown

`cuts` take a stretch out of whatever clip covers it, without splitting the clip: `from` and `to`
(source seconds) and `enabled` (`true`). The video jumps there (no crossfade); zooms, masks and
texts run on across it. Use them for a slip, a filler or a pause inside a clip; `suggest` makes
them for filler words ("Filler: äh") and pauses ("Pause: 2.4 s") from the transcript.

Every scene, zoom, mask, text and cut may have an `id` (1 to 64 letters, digits, `-` or `_`,
unique in the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest`
```

- [ ] **Step 3: Run the test**

Run: `pnpm exec vitest run --project node skill/test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add skill
git commit -m "skill: speech, cuttle transcribe and cuttle models

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The end-to-end check

**Files:**
- Modify: `apps/desktop/test/{fixture,app.check.test}.ts`

- [ ] **Step 1: The checks**

The check serves the models itself: `base` from a model already downloaded on this computer (`CUTTLE_TEST_MODELS`, else the user's models folder; without one the transcription part is skipped), `small` broken off, and `large-v3-turbo-q5_0` never ending.

In `apps/desktop/test/fixture.ts`, replace:

```ts
// markers, a page still, and a cuttle.json with a continuous cut into an 8× clip (above 6×, playback
// from the proxy shows key frames only), a jump cut, a card, a zoom, a mask and a caption.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURE_OUTPUT = { width: 640, height: 360, fps: 30 } as const;
```

with:

```ts
// markers, a page still, and a cuttle.json with a continuous cut into an 8× clip (above 6×, playback
// from the proxy shows key frames only), a jump cut, a card, a zoom, a mask and a caption.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURE_OUTPUT = { width: 640, height: 360, fps: 30 } as const;
```

In the same file, replace:

```ts
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

export function makeFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
```

with:

```ts
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

/**
 * A spoken take: a still screen (a dark grey frame) for 19.5 s, and `mic` (the core tests' English
 * text-to-speech fixture, with "Uh" and "Um" and pauses) as its mic, started with the screen. One
 * clip over the whole take, no input.
 */
export function makeSpokenFixture(dir: string, mic: string): void {
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=1280x720:r=30:d=19.5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(take, 'screen.mp4')]);
  copyFileSync(mic, join(take, 'mic.m4a'));
  writeFileSync(join(take, 'events.jsonl'), '');
  writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 100 }, mic: { file: 'mic.m4a', start: 100 } } }));
  const project = {
    version: 1,
    output: FIXTURE_OUTPUT,
    sources: { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a', events: 'takes/1/events.jsonl' },
    scenes: [{ type: 'clip', id: 's1', from: 0, to: 19.5 }],
  };
  writeFileSync(join(dir, 'cuttle.json'), `${JSON.stringify(project, null, 2)}\n`);
}

export function makeFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
```

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
```

with:

```ts
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
```

In the same file, replace:

```ts
import { PNG } from 'pngjs';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OUTPUT, makeFixture } from './fixture';

/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
```

with:

```ts
import { PNG } from 'pngjs';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OUTPUT, makeFixture, makeSpokenFixture } from './fixture';

/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
```

In the same file, replace:

```ts
const MAIN = fileURLToPath(new URL('../dist/main/index.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../../cli/dist/cuttle.mjs', import.meta.url));
const SHOTS = process.env.CUTTLE_CHECK_SHOTS;

interface CheckState {
  t: number;
```

with:

```ts
const MAIN = fileURLToPath(new URL('../dist/main/index.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../../cli/dist/cuttle.mjs', import.meta.url));
const SHOTS = process.env.CUTTLE_CHECK_SHOTS;
/** The English text-to-speech take of the core tests. */
const SPOKEN = fileURLToPath(new URL('../../../packages/core/test/fixtures/speech/en.m4a', import.meta.url));
/**
 * The `base` speech model where one is downloaded (`CUTTLE_TEST_MODELS`, else the user's models
 * folder): the check downloads it from a server of its own, so the model can be checked end to end.
 */
const BASE_MODEL = [process.env.CUTTLE_TEST_MODELS, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Cuttle', 'models')]
  .filter((dir): dir is string => !!dir)
  .map((dir) => join(dir, 'ggml-base.bin'))
  .find((path) => existsSync(path));
const hasWhisper = /\swhisper\s/.test(spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', windowsHide: true }).stdout ?? '');

interface CheckState {
  t: number;
```

In the same file, replace:

```ts
  let root: string;
  let project: string;
  let app: ElectronApplication;
  let editor: Page;
  const pageErrors: string[] = [];
  // The page's hook (`__cuttleCheck`); each call is its own function, as the page's CSP allows no eval.
```

with:

```ts
  let root: string;
  let project: string;
  let app: ElectronApplication;
  /** Serves the speech models: `base` from BASE_MODEL, `small` broken, `large-v3-turbo-q5_0` never ending. */
  let models: Server;
  const hanging: ServerResponse[] = [];
  let editor: Page;
  const pageErrors: string[] = [];
  // The page's hook (`__cuttleCheck`); each call is its own function, as the page's CSP allows no eval.
```

In the same file, replace:

```ts
    });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  };
  /** Asks the running app to open `argv` as a second launch would, `times` times at once. */
  const launchAgain = (argv: string[], times = 1) =>
    app.evaluate(
```

with:

```ts
    });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  };
  /** A screenshot of the window whose URL has `part` and whose title is `title` (when given). */
  const shotOf = async (name: string, part: string, title?: string) => {
    if (!SHOTS) return;
    const png = await app.evaluate(
      async ({ BrowserWindow }, { part, title }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes(part) && (title === undefined || candidate.getTitle() === title))!;
        // the first capture of a window never shown can be its first paint: the second is now
        for (let round = 0; round < 2; round++) {
          window.webContents.invalidate();
          await new Promise((resolve) => setTimeout(resolve, 1600));
          await window.webContents.capturePage();
        }
        return (await window.webContents.capturePage()).toPNG().toString('base64');
      },
      { part, title },
    );
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  };
  /** Asks the running app to open `argv` as a second launch would, `times` times at once. */
  const launchAgain = (argv: string[], times = 1) =>
    app.evaluate(
```

In the same file, replace:

```ts
    // New recordings go into a folder of the check's own.
    mkdirSync(join(root, 'user-data'));
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects') }));
    app = await _electron.launch({
      executablePath: electronPath(),
      args: [MAIN, '--cuttle-check', '--open', project],
```

with:

```ts
    // New recordings go into a folder of the check's own.
    mkdirSync(join(root, 'user-data'));
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects') }));
    models = createServer((request, response) => {
      if (request.url === '/ggml-base.bin' && BASE_MODEL) return void response.end(readFileSync(BASE_MODEL));
      if (request.url === '/ggml-small.bin') return void response.end('not a model');
      if (request.url === '/ggml-large-v3-turbo-q5_0.bin') {
        response.write(Buffer.alloc(1_000_000));
        return void hanging.push(response);
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => models.listen(0, '127.0.0.1', () => resolve()));
    app = await _electron.launch({
      executablePath: electronPath(),
      args: [MAIN, '--cuttle-check', '--open', project],
```

In the same file, replace:

```ts
        CUTTLE_USER_DATA: join(root, 'user-data'),
        CUTTLE_RECORDER_BACKEND: 'test',
        CUTTLE_COUNTDOWN: '0',
      },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
```

with:

```ts
        CUTTLE_USER_DATA: join(root, 'user-data'),
        CUTTLE_RECORDER_BACKEND: 'test',
        CUTTLE_COUNTDOWN: '0',
        // the check's own models folder (empty at first), and the models from the check's server
        CUTTLE_MODELS_DIR: join(root, 'models'),
        CUTTLE_MODELS_URL: `http://127.0.0.1:${(models.address() as { port: number }).port}/`,
      },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
```

In the same file, replace:

```ts

  afterAll(async () => {
    await app?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
```

with:

```ts

  afterAll(async () => {
    await app?.close().catch(() => {});
    for (const response of hanging) response.destroy();
    models?.closeAllConnections();
    models?.close();
    await rm(root, { recursive: true, force: true });
  });
```

In the same file, replace:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/settings.html'))?.close());
  }, 60_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

with:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/settings.html'))?.close());
  }, 60_000);

  it('downloads a speech model in the settings (checked, cancelled, failed), and transcribes a spoken take from the Auto tab: its filler words and pauses cut as one step', async () => {
    await launchAgain(['--settings']);
    const settings = await waitForPage(app, async (page) => page.url().includes('/settings.html') && (await page.locator('[data-testid=speech-line]').count()) === 1);
    const saved = () => JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { speech?: { model: string; language: string } };
    const line = () => settings.locator('[data-testid=speech-line] .row-hint').textContent();
    const choose = async (label: string) => {
      await settings.locator('[data-testid=speech-model]').evaluate((element) => (element as HTMLElement).click());
      await settings.waitForSelector('.select-list [role=option]');
      await settings.evaluate((label) => {
        const option = [...document.querySelectorAll('.select-list [role=option]')].find((item) => item.querySelector('.option-label')?.textContent?.startsWith(label));
        if (!option) throw new Error(`no option "${label}"`);
        (option as HTMLElement).click();
      }, label);
    };
    // Good (small), the default: not downloaded here; its download breaks off, and says so
    expect(await line()).toBe('German and English, about 5× real time. 488 MB to download, once.');
    await click(settings, '[data-testid=speech-download]');
    await expect.poll(line).toMatch(/^The download failed: the download from .* ended at 11 of 487601967 bytes$/);
    expect(await settings.locator('[data-testid=speech-download]').textContent()).toBe('Try again');
    expect(existsSync(join(root, 'models'))).toBe(true);
    expect(readdirSync(join(root, 'models'))).toEqual([]);
    // Best: its download runs on (progress) until it is cancelled
    await choose('Best');
    await expect.poll(() => saved().speech?.model).toBe('large-v3-turbo-q5_0');
    await expect.poll(line).toBe('The most accurate, about 2.6× real time. 574 MB to download, once.');
    await click(settings, '[data-testid=speech-download]');
    await settings.waitForSelector('[data-testid=speech-line] progress.download');
    expect(await line()).toBe('Downloading… 0 % of 574 MB');
    // another model chosen meanwhile: the line still shows the download, to cancel it
    await choose('Good');
    await expect.poll(line).toBe('The Best model is downloading (0 % of 574 MB): one download at a time.');
    await choose('Best');
    await expect.poll(line).toBe('Downloading… 0 % of 574 MB');
    await settings.locator('[data-testid=speech-line]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('25-speech-download', '/settings.html');
    await click(settings, '[data-testid=speech-cancel]');
    await settings.waitForSelector('[data-testid=speech-download]');
    expect(await line()).toBe('The most accurate, about 2.6× real time. 574 MB to download, once.');
    expect(readdirSync(join(root, 'models'))).toEqual([]);
    // the language spoken
    await click(settings, '[data-testid=speech-language] button:nth-child(3)');
    await expect.poll(() => saved().speech?.language).toBe('en');
    if (!BASE_MODEL || !hasWhisper) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/settings.html'))?.close());
      return;
    }
    // Fast (base): downloaded from the check's server, its checksum right
    await choose('Fast');
    await expect.poll(line).toBe('Good for English, weak for German. 148 MB to download, once.');
    await click(settings, '[data-testid=speech-download]');
    await settings.waitForSelector('[data-testid=speech-remove]', { timeout: 60_000 });
    expect(await line()).toBe('Downloaded: good for English, weak for German.');
    expect(readdirSync(join(root, 'models'))).toEqual(['ggml-base.bin']);
    await settings.locator('[data-testid=speech-line]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('26-speech-ready', '/settings.html');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/settings.html'))?.close());

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
    // the title bar says how far it is; the cuts arrive as one step, "Cuttle's speech edits"
    const file = () => JSON.parse(readFileSync(join(spoken, 'cuttle.json'), 'utf8')) as { sources: { transcript?: string }; cuts?: { auto?: string; from: number; to: number }[] };
    await expect.poll(() => file().sources.transcript, { timeout: 60_000 }).toBe('takes/1/transcript.json');
    const cuts = file().cuts ?? [];
    const fillers = cuts.filter((cut) => cut.auto === 'filler').length;
    const pauses = cuts.filter((cut) => cut.auto === 'pause').length;
    expect(fillers).toBeGreaterThanOrEqual(2);
    expect(pauses).toBeGreaterThanOrEqual(1);
    // "Uh" at 2.02 s and "Um" at 7.55 s are gone from the video
    for (const at of [2.1, 7.7]) expect(cuts.some((cut) => cut.from <= at && at < cut.to), `a cut at ${at} s`).toBe(true);
    await page.waitForSelector('[data-testid=auto-group-fillers]');
    await page.waitForSelector('[data-testid=speech-note]', { state: 'detached' });
    expect(await page.locator('[data-testid=auto-group-fillers] .auto-count').textContent()).toBe(`${fillers} on`);
    expect(await page.locator('[data-testid=auto-group-pauses] .auto-count').textContent()).toBe(`${pauses} on`);
    const pageDoc = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.doc());
    expect((await pageDoc()).undo).toBe("Cuttle's speech edits");
    expect((await pageDoc()).toast?.text).toBe(`Cuttle cut ${fillers} filler words and ${pauses} pause${pauses === 1 ? '' : 's'} where the picture rests.`);
    expect(await page.locator('[data-testid=project-status]').count()).toBe(0);
    // the video is shorter by the cuts, in the player and the title bar
    const removed = cuts.reduce((sum, cut) => sum + (cut.to - cut.from), 0);
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state())).duration).toBeCloseTo(19.5 - removed, 1);
    const duration = (await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state())).duration;
    expect(await page.locator('.titlebar .project-name span').textContent()).toBe(`19.5 s recorded · ${Math.floor(duration * 10 + 1e-6) / 10} s video`);
    await click(page, '[data-testid=auto-group-fillers] .auto-toggle');
    await shotOf('27-speech-edits', '/editor.html', 'spoken · Cuttle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'spoken · Cuttle')?.close());
  }, 120_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

- [ ] **Step 2: Run it, with screenshots, and look at them**

```bash
mkdir -p "$TEMP/cuttle-p4m2a-shots"
CUTTLE_HIDDEN=1 CUTTLE_RECORDER_BACKEND=test CUTTLE_CHECK_SHOTS="$TEMP/cuttle-p4m2a-shots" pnpm app:check
```

Expected: PASS, 39 tests. Look at `25-speech-download`, `26-speech-ready` and `27-speech-edits`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test
git commit -m "desktop: app:check downloads a speech model and transcribes a spoken take

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Final verification

- [ ] **Step 1: All tests, the typecheck and the packaged build**

Run: `pnpm test`
Expected: PASS, 566 passed and 48 skipped (on a machine without a speech model, the real transcription is among the skipped).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Settings, Speech: download Good (488 MB). Cancel once halfway, then download it to the end.
2. Record a take with the mic: say something with an "äh" and a pause of two seconds while nothing moves on screen. The editor opens on the cut, then "Transcribing… N %", then "Cuttle cut … filler words and … pauses". Play it: the filler and most of the pause are gone, the words around them whole.
3. In the Auto tab, switch "Filler words cut" off and on.
4. In a terminal: `cuttle -C "<that project>" --json transcribe --language de`, then read `takes/1/transcript.json`.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran once, on the prototype, whose tree the replay matches byte for byte: the task steps' tests, `pnpm test`, the typecheck and the full `app:check` with every screenshot looked at. The packaged build (`pnpm app:build`) ran on the replayed commits. The user asked for no double testing and no review subagents.

**Found while checking, and already in the plan above**
- **A filler word cut into the next sentence.** On the English fixture, `base` heard "Um," 0.3 s before it was spoken, and the alignment put it at the head of "it zooms on clicks"; its cut took the start of "it". Two changes: a likely filler costs 0.3 in a stretch it shares, and a filler is cut only when it stands alone between pauses.
- **Reruns gave new ids.** A rerun of the speech edits replaced each cut with a new id, so the app's speech step rewrote an unchanged file. A new cut in the place of a replaced one of its kind keeps its id.
- **Two changes for one transcription.** Linking the transcript and writing the cuts were two writes, so the editor showed two outside changes; the app now does both in one write.
- **The settings asked ffmpeg about whisper at every percent of a download.** A hundred ffmpeg processes slowed the download to a halt in the check. The answer is now kept, and asked again only when the window asks.
- **A download for another model was invisible.** It could only be cancelled after choosing that model again. The model line now shows any download under way, with Cancel.
- **The check clicked Download before the new choice had reached the window,** and downloaded the model before it. It now waits for the chosen model's line.
- **The video's length showed the old value after a change from outside** (see Fixed on the way).
- **A screenshot of a window that was never shown** can be its first paint. `shotOf` captures twice.
- **The check took the wrong editor in the full run.** The editors of the takes recorded earlier in the run were open too; it now finds the spoken project's editor by its folder.
- **Words for people name both platforms**, as the macOS branch's notes ask: the hints to update ffmpeg say `winget upgrade Gyan.FFmpeg` and `brew upgrade ffmpeg`. That text came after the last `app:check`; `pnpm test`, the typecheck and `app:build` ran with it.
- **No merge conflicts with the macOS branch** (`macos-support`, with CI for both platforms): a test merge found two, both lines both sides had added. `*.m4a binary` now sits before `*.mp4` in `.gitattributes`, and the check serves the model with `readFileSync`, so the `node:fs` import stays as it was. The speech check ran again after that.

**Tests that wobble under load** (not changed by this milestone)
- The recorder's "records a 3 s take with every track" (the mic was 3.76 s) and "cancels without a take folder when stopped during the countdown" (the countdown ticked once more) each failed once in a full `pnpm test`. Both pass alone. On a machine with a speech model, the real transcription runs during the full suite and adds load.
- They are for the milestone that hardens the recorder's tests.

**Spec points that move**
- **`cuttle transcript [--srt | --vtt | --text]` moves to M2b** with captions; this milestone has `cuttle transcribe`, which writes the transcript. `cuttle analyze` is not needed: `suggest` runs the analysis it can.
- **Audio cleanup moves to M2b**, where the export reads the speech for captions.
- **The automatic edits arrive in two steps, not one** ("Cuttle's cut", then "Cuttle's speech edits"). Transcription takes seconds to minutes; the cut should not wait for it.
- **Speech counts as activity even without a model** (the mic's loudness): a narration over a still screen is never cut as idle, nor sped up.

# Cuttle P4-M3: The Mistake Key and Spoken Retakes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A slip needs no new take. The person presses the mistake key (Ctrl+Shift+Alt+X, or the scissors on the HUD) or says "nochmal" / "again", and does the bit again; Cuttle cuts the slip, from the pause before it to where the bit starts again.

**Architecture:**
- **Format** (`@cuttle/project`): a marker kind `retake` in `markers.json`.
- **Recorder:** the hotkey `retake`, and `Recording.retake()`, which writes a `retake` marker.
- **Core** (`speech/retakes.ts`):
  - `spokenCues`: a cue that starts a phrase, followed by the slip said again word for word;
  - `retakeCuts`: per key press and cue, a cut from the last pause before the slip to just after the key or the cue, inside its clip.
  - `withSpeechCuts` makes the retakes first; a filler or pause cut that touches a retake joins it (the pause after the key goes too). `suggest` and the app's speech step both use it; the key works without a transcript.
- **CLI:** the key in `record`'s status line; `suggest` reports `speech.retakes`.
- **App:**
  - the HUD's scissors (and "Slip marked: do it again");
  - a `retake` pin on the timeline;
  - the speech step's toast and status name the retakes.
- **Skill:** a Slips paragraph.

**Tech Stack:** TypeScript strict, zod 4, vitest 5, Electron 44.7.2, React 19.3.0, Playwright (`_electron`), uiohook-napi.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase4-design.md`. Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p4-m2b-subtitles.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p4-m3`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 7.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The prototype passed `pnpm test` (597 tests, 51 skipped), the typecheck, `app:check` (41 tests) and `cli:check` (5). Every screenshot was looked at.

- **The key.**
  - Ctrl+Shift+Alt+X, next to S (stop), M (marker) and P (pause). It writes a marker `{ t, kind: 'retake' }`; nothing happens to the take while recording.
  - The HUD gets a scissors button between restart and the marker flag (enabled while recording), and says "Slip marked: do it again" for 2 s. The HUD is 460 px wide (from 420), so the note keeps its room (141 px; the hint takes 125).
  - The HUD counts the key's markers apart from the person's own markers (`HudState.retakes`).
  - Claude's markers are only `prompt`, `tool` and `answer`: a `retake` marker never starts Claude's turn in `suggestClips`, and does not stop `suggest --claude` from reading Claude's transcript.
- **Where a slip begins** (`RETAKE_RULES`):
  - From the key (or the cue's slip), look back for the last pause: a gap in the speech of 0.7 s or more with no click, key or scroll in its last 0.5 s, at most 20 s back. The cut starts 0.15 s before the speech after that gap.
  - Without such a pause (or without speech: no mic, or `--no-speech`), the cut starts 5 s back. Never before the start of the clip the key lies in; a key outside every clip makes nothing.
  - The speech is the transcript's words, else the mic's loud stretches.
  - The cut ends 0.15 s after the key or the cue, inside its clip. Cuts that overlap become one.
- **A spoken cue** (`spokenCues`):
  - The cues: "nochmal", "nochmals", "noch mal", "noch einmal", each also with "von vorne"; "again", "one more time", "let me redo that", "again from the top". The longest that fits wins.
  - It starts a phrase: a pause of 0.3 s or more comes before it. "sorry", "okay", "oops", "hoppla", "mist", "nee", "nein", "no", "also", "so" and fillers right before or after it are skipped. "Click it again." in a sentence is no cue.
  - It counts when what follows (within 4 s) repeats the start of the slip word for word: 2 words or more, or the whole slip of one word. The slip began at most 12 words before the cue; of the words that fit, the one the repeat matches longest wins (the nearest on a tie).
  - The cut's label quotes the cue: `Retake: “Nochmal”`.
- **Among the speech edits** (`withSpeechCuts`):
  - The retakes come first (`autoEdits.retakes`). Then, with a transcript, the filler and pause cuts in 1× clips. A filler or pause cut that touches a retake (within 0.1 s, in its clip) joins it: the pause after the key, before the bit is said again, belongs to the retake.
  - With a transcript, the tagged `retake`, `filler` and `pause` cuts are made again; without one only the `retake` cuts, and the others stay as they are.
  - `suggest` makes retakes when there is a transcript, a `retake` marker, or a `retake` cut from before. `--no-speech` leaves out the spoken cues, fillers and pauses, but the key's retakes are still cut (5 s back).
  - The English fixture says "Um, it zooms on clicks. Again. It zooms on every click": the slip, the "Um" in it and the pauses around it go as one retake.
- **The app.**
  - The speech step's status says "Cutting retakes, filler words and pauses…", and its toast "Cuttle cut 1 retake, and 1 filler word and 2 pauses where the picture rests."
  - The timeline pins a `retake` marker in amber, named "Retake", on the take before its cut. Once the cut is in, the marker lies inside it and has no pin; the cut's notch (labelled "Retake") stands for it. The Auto tab's "Retakes cut" row (made in M1) lists the cuts.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/markers.ts` | the `retake` marker kind |
| `packages/recorder/src/{types,input,record}.ts` | the hotkey and `Recording.retake()` |
| `packages/core/src/speech/retakes.ts` (new), `apply.ts`, `edits.ts`, `suggest.ts`, `suggest/plan.ts`, `index.ts` | the retake detector, among the speech edits |
| `apps/cli/src/commands/record.ts`, `main.ts` | the key in the status line, `--no-speech` |
| `apps/desktop/src/shared/{recording,ipc,channels,timeline-model}.ts`, `src/workers/recorder.ts`, `src/main/{recorder-host,recording,speech}.ts` | the key from the HUD to the recorder, the pin's name, the status |
| `apps/desktop/src/renderer/picker/{Hud.tsx,picker.css}`, `src/renderer/editor/{Timeline.tsx,doc.ts}` | the scissors, the pin's colour, the toast |
| `skill/cuttle/{SKILL,project}.md` | slips for Claude |

---

### Task 1: The marker and the key

**Files:**
- Modify: `packages/project/src/markers.ts`, `packages/project/test/markers.test.ts`
- Modify: `packages/recorder/src/{types,input,record}.ts`, `packages/recorder/test/record.test.ts`
- Modify: `apps/desktop/src/renderer/editor/Timeline.tsx` (the new kind's colour, so the editor keeps type-checking)

- [ ] **Step 1: The branch**

The plan was committed on the branch `p4-m3`; work there:

```bash
git switch p4-m3
```

- [ ] **Step 2: Write the failing tests**

In `packages/project/test/markers.test.ts`, replace:

```ts
    { t: 2.25, kind: 'tool', label: 'Bash' },
    { t: 7, kind: 'answer' },
    { t: 8, kind: 'manual', label: 'nice bit' },
  ],
};
```

with:

```ts
    { t: 2.25, kind: 'tool', label: 'Bash' },
    { t: 7, kind: 'answer' },
    { t: 8, kind: 'manual', label: 'nice bit' },
    { t: 9.5, kind: 'retake' },
  ],
};
```

In `packages/recorder/test/record.test.ts`, replace:

```ts
    const projectDir = project();
    const events: RecorderEvent[] = [];
    let markedAt = 0;
    const recording = record({
      ...test,
      projectDir,
```

with:

```ts
    const projectDir = project();
    const events: RecorderEvent[] = [];
    let markedAt = 0;
    let slipAt = 0;
    const recording = record({
      ...test,
      projectDir,
```

In the same file, replace:

```ts
            markedAt = Date.now() / 1000;
            recording.marker('one second');
          }, 1000);
        }
      },
    });
```

with:

```ts
            markedAt = Date.now() / 1000;
            recording.marker('one second');
          }, 1000);
          // the mistake key
          setTimeout(() => {
            slipAt = Date.now() / 1000;
            recording.retake();
          }, 1600);
        }
      },
    });
```

In the same file, replace:

```ts

    // Marker times count from the screen's first frame, which starts late on a loaded machine.
    const markedSecond = markedAt - takeFile.take.tracks.screen.start;
    expect(markersOf(projectDir, take.markers)).toEqual([{ t: expect.closeTo(markedSecond, 1), kind: 'manual', label: 'one second' }]);
    expect(events.map((event) => event.type)).toEqual(['processes', 'recording', 'marker', 'stopping']);
    // screen, webcam and mic: the app kills these when its recorder host dies
    const processes = events[0]!;
    expect(processes.type === 'processes' && processes.pids.length === 3 && processes.pids.every(Number.isInteger)).toBe(true);
```

with:

```ts

    // Marker times count from the screen's first frame, which starts late on a loaded machine.
    const markedSecond = markedAt - takeFile.take.tracks.screen.start;
    const slipSecond = slipAt - takeFile.take.tracks.screen.start;
    expect(markersOf(projectDir, take.markers)).toEqual([
      { t: expect.closeTo(markedSecond, 1), kind: 'manual', label: 'one second' },
      { t: expect.closeTo(slipSecond, 1), kind: 'retake' },
    ]);
    expect(events.map((event) => event.type)).toEqual(['processes', 'recording', 'marker', 'marker', 'stopping']);
    // screen, webcam and mic: the app kills these when its recorder host dies
    const processes = events[0]!;
    expect(processes.type === 'processes' && processes.pids.length === 3 && processes.pids.every(Number.isInteger)).toBe(true);
```

Run: `pnpm exec vitest run --project node packages/project/test/markers.test.ts packages/recorder/test/record.test.ts`
Expected: FAIL: `retake` is not a marker kind, and `recording.retake` is not a function.

- [ ] **Step 3: The kind, the hotkey and `retake()`**

In `packages/project/src/markers.ts`, replace:

```ts
 * `manual`: the marker hotkey or the recorder API. From a Claude Code transcript: `prompt` (a prompt
 * was submitted), `tool` (a tool call, labelled with the tool's name) and `answer` (the final answer).
 */
export const MARKER_KINDS = ['manual', 'prompt', 'tool', 'answer'] as const;

/** One marker; `t` is in source seconds of the screen track, like events.jsonl. */
export const MarkerSchema = z.strictObject({
```

with:

```ts
 * `manual`: the marker hotkey or the recorder API. From a Claude Code transcript: `prompt` (a prompt
 * was submitted), `tool` (a tool call, labelled with the tool's name) and `answer` (the final answer).
 */
/** `retake`: the person pressed the mistake key (a slip: Cuttle cuts back to the pause before it). */
export const MARKER_KINDS = ['manual', 'prompt', 'tool', 'answer', 'retake'] as const;

/** One marker; `t` is in source seconds of the screen track, like events.jsonl. */
export const MarkerSchema = z.strictObject({
```

In `packages/recorder/src/types.ts`, replace:

```ts
  stop(): Promise<Take>;
  /** Adds a manual marker at the current time (while paused: where the take paused). */
  marker(label?: string): void;
  /**
   * Pauses the take: every track stops (each file is complete) and nothing is captured or logged
   * until `resume()`. The take's time stands still meanwhile; the stop joins the pieces. Events:
```

with:

```ts
  stop(): Promise<Take>;
  /** Adds a manual marker at the current time (while paused: where the take paused). */
  marker(label?: string): void;
  /** Marks a slip (the mistake key): Cuttle cuts back to the pause before it. */
  retake(): void;
  /**
   * Pauses the take: every track stops (each file is complete) and nothing is captured or logged
   * until `resume()`. The take's time stands still meanwhile; the stop joins the pieces. Events:
```

In the same file, replace:

```ts
  | { type: 'shape'; time: number; shape: CursorShape }
  | { type: 'key'; time: number };

export type HotkeyAction = 'stop' | 'marker' | 'pause';
```

with:

```ts
  | { type: 'shape'; time: number; shape: CursorShape }
  | { type: 'key'; time: number };

export type HotkeyAction = 'stop' | 'marker' | 'pause' | 'retake';
```

In `packages/recorder/src/input.ts`, replace:

```ts
const now = () => Date.now() / 1000;

/** Ctrl+Shift+Alt+<key>: no app binds these, and AltGr+Shift+letter types nothing on common layouts. */
export const HOTKEYS: Record<HotkeyAction, string> = { stop: 'Ctrl+Shift+Alt+S', marker: 'Ctrl+Shift+Alt+M', pause: 'Ctrl+Shift+Alt+P' };

export interface KeyEvent {
  keycode: number;
```

with:

```ts
const now = () => Date.now() / 1000;

/** Ctrl+Shift+Alt+<key>: no app binds these, and AltGr+Shift+letter types nothing on common layouts. */
export const HOTKEYS: Record<HotkeyAction, string> = { stop: 'Ctrl+Shift+Alt+S', marker: 'Ctrl+Shift+Alt+M', pause: 'Ctrl+Shift+Alt+P', retake: 'Ctrl+Shift+Alt+X' };

export interface KeyEvent {
  keycode: number;
```

In the same file, replace:

```ts
    UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Shift, UiohookKey.ShiftRight,
    UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Meta, UiohookKey.MetaRight,
  ]);
  const keys = keyHandler(modifiers, new Map<number, HotkeyAction>([[UiohookKey.S, 'stop'], [UiohookKey.M, 'marker'], [UiohookKey.P, 'pause']]), onInput, onHotkey);
  const buttons = new Map<unknown, 'left' | 'right' | 'middle'>([[1, 'left'], [2, 'right'], [3, 'middle']]);
  let shape = win.cursorShape(); // before the hook starts: nothing to undo if it throws
```

with:

```ts
    UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Shift, UiohookKey.ShiftRight,
    UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Meta, UiohookKey.MetaRight,
  ]);
  const keys = keyHandler(modifiers, new Map<number, HotkeyAction>([[UiohookKey.S, 'stop'], [UiohookKey.M, 'marker'], [UiohookKey.P, 'pause'], [UiohookKey.X, 'retake']]), onInput, onHotkey);
  const buttons = new Map<unknown, 'left' | 'right' | 'middle'>([[1, 'left'], [2, 'right'], [3, 'middle']]);
  let shape = win.cursorShape(); // before the hook starts: nothing to undo if it throws
```

In `packages/recorder/src/record.ts`, replace:

```ts
      return done;
    },
    marker: (label) => control.marker(label),
    pause: () => control.setPaused(true),
    resume: () => control.setPaused(false),
    setDeadZones: (zones) => (control.deadZones = [...zones]),
```

with:

```ts
      return done;
    },
    marker: (label) => control.marker(label),
    retake: () => control.retake(),
    pause: () => control.setPaused(true),
    resume: () => control.setPaused(false),
    setDeadZones: (zones) => (control.deadZones = [...zones]),
```

In the same file, replace:

```ts
/** Stop requests, pauses and manual markers from the caller, the hotkeys and the triggers. */
class Control {
  reason: StopReason | undefined;
  onMarker: ((label?: string) => void) | undefined;
  /** Pointer input inside these is not logged. */
  deadZones: Bounds[] = [];
  private waiters: ((reason: StopReason) => void)[] = [];
```

with:

```ts
/** Stop requests, pauses and manual markers from the caller, the hotkeys and the triggers. */
class Control {
  reason: StopReason | undefined;
  onMarker: ((label?: string, kind?: 'manual' | 'retake') => void) | undefined;
  /** Pointer input inside these is not logged. */
  deadZones: Bounds[] = [];
  private waiters: ((reason: StopReason) => void)[] = [];
```

In the same file, replace:

```ts
  marker(label?: string): void {
    this.onMarker?.(label);
  }
}

/** Events for the caller and the take's warnings. A throwing `onEvent` becomes a warning, never a failed take. */
```

with:

```ts
  marker(label?: string): void {
    this.onMarker?.(label);
  }

  retake(): void {
    this.onMarker?.(undefined, 'retake');
  }
}

/** Events for the caller and the take's warnings. A throwing `onEvent` becomes a warning, never a failed take. */
```

In the same file, replace:

```ts
    reporter.emit({ type: 'marker', marker: entry });
  };
  saveMarkers();
  control.onMarker = (label) => addMarker({ kind: 'manual', ...(label && { label }) }, now());

  const writeSegments = (joined = false) => {
    const file = path(FILES.segments);
```

with:

```ts
    reporter.emit({ type: 'marker', marker: entry });
  };
  saveMarkers();
  control.onMarker = (label, kind = 'manual') => addMarker({ kind, ...(label && { label }) }, now());

  const writeSegments = (joined = false) => {
    const file = path(FILES.segments);
```

In the same file, replace:

```ts
        lastInput = raw.time;
        writer.push(raw);
      },
      (action) => (action === 'stop' ? control.request('hotkey') : action === 'pause' ? control.toggle() : control.marker()),
    );

    // The screen track's start is the take's clock: input, markers and maxSeconds count from it.
```

with:

```ts
        lastInput = raw.time;
        writer.push(raw);
      },
      (action) => (action === 'stop' ? control.request('hotkey') : action === 'pause' ? control.toggle() : action === 'retake' ? control.retake() : control.marker()),
    );

    // The screen track's start is the take's clock: input, markers and maxSeconds count from it.
```

In `apps/desktop/src/renderer/editor/Timeline.tsx`, replace:

```
 */
let pointerSeekUntil = 0;

const MARKER_DOT: Record<MarkerKind, string> = { prompt: '#ececf1', tool: '#7a7a85', answer: '#4fd1a1', manual: '#9a9aa5' };

interface Layout {
  heights: Record<'markers' | 'ruler' | 'video' | OverlayKind | 'mic' | 'input', number>;
```

with:

```
 */
let pointerSeekUntil = 0;

const MARKER_DOT: Record<MarkerKind, string> = { prompt: '#ececf1', tool: '#7a7a85', answer: '#4fd1a1', manual: '#9a9aa5', retake: '#f2b34a' };

interface Layout {
  heights: Record<'markers' | 'ruler' | 'video' | OverlayKind | 'mic' | 'input', number>;
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/project packages/recorder`
Expected: PASS. (The recorder's timing tests can wobble on a loaded machine; run them alone then.)

- [ ] **Step 5: Commit**

```bash
git add packages/project packages/recorder apps/desktop/src/renderer/editor/Timeline.tsx
git commit -m "project, recorder: the mistake key (Ctrl+Shift+Alt+X) writes a retake marker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The retake detector

**Files:**
- Create: `packages/core/src/speech/retakes.ts`, `packages/core/test/retakes.test.ts`
- Modify: `packages/core/src/speech/{apply,edits}.ts`, `packages/core/src/{suggest,index}.ts`, `packages/core/src/suggest/plan.ts`, `packages/core/test/speech-take.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/retakes.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProject, type InputEvent, type Marker, type TranscriptWord } from '@cuttle/project';
import { withSpeechCuts, wordStretches } from '../src/speech/apply';
import { retakeCuts, spokenCues, type RetakeInput } from '../src/speech/retakes';

const key = (t: number): Marker => ({ t, kind: 'retake' });
const said = (...items: [number, number, string][]): TranscriptWord[] => items.map(([t, end, text]) => ({ t, end, text }));
const input = (over: Partial<RetakeInput>): RetakeInput => ({ markers: [], speech: [], events: [], clips: [{ from: 0, to: 60 }], ...over });

describe('the mistake key', () => {
  // a sentence, a pause, the slip, the key, the slip said again
  const speech = [{ from: 1, to: 3 }, { from: 4, to: 6.5 }, { from: 7.5, to: 10 }];

  it('cuts back to the pause before the slip, and just past the key', () => {
    expect(retakeCuts(input({ markers: [key(6.8)], speech }))).toEqual([{ from: 3.85, to: 6.95, auto: 'retake', label: 'Retake' }]);
  });

  it('takes a pause only where the input rested, else the one before', () => {
    const events: InputEvent[] = [{ t: 3.8, type: 'click', x: 1, y: 1, button: 'left' }];
    expect(retakeCuts(input({ markers: [key(6.8)], speech, events }))[0]!.from).toBe(0.85);
    // a short gap between words is no pause
    expect(retakeCuts(input({ markers: [key(6.8)], speech: [{ from: 1, to: 3.8 }, { from: 4, to: 6.5 }] }))[0]!.from).toBe(0.85);
  });

  it('goes 5 s back without a pause in the last 20 s, and never past the clip\'s start', () => {
    expect(retakeCuts(input({ markers: [key(25)], speech: [{ from: 0, to: 30 }] }))[0]).toMatchObject({ from: 20, to: 25.15 });
    expect(retakeCuts(input({ markers: [key(6.8)], speech: [{ from: 1, to: 6.5 }], clips: [{ from: 3, to: 10 }] }))[0]).toMatchObject({ from: 3, to: 6.95 });
    // no speech at all (no mic): 5 s back
    expect(retakeCuts(input({ markers: [key(12)] }))[0]).toMatchObject({ from: 7, to: 12.15 });
    // a key outside every clip makes nothing
    expect(retakeCuts(input({ markers: [key(12)], clips: [{ from: 0, to: 10 }] }))).toEqual([]);
  });
});

/** The German fixture's words, as the text-to-speech said them (each until the next starts, at most 0.5 s). */
function germanWords(): TranscriptWord[] {
  const truth = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'speech', 'de.words.json'), 'utf8')) as { t: number; text: string }[];
  return truth.map((word, i) => ({ t: word.t, end: Math.min(truth[i + 1]?.t ?? word.t + 0.5, word.t + 0.5), text: word.text }));
}

describe('a spoken cue', () => {
  it('counts when what follows repeats what came before: "Nochmal" in the German fixture', () => {
    const words = germanWords();
    expect(spokenCues(words)).toEqual([{ at: 11.635, end: 12.135, text: 'Nochmal', slip: 9.495 }]);
    // the cut runs from the pause before the slip ("Ähm, die App erkennt die Art.") to just past the cue
    expect(retakeCuts(input({ words, speech: wordStretches({ version: 1, language: 'de', model: 'small', words, sounds: [] }) }))).toEqual([
      { from: 8.58, to: 12.285, auto: 'retake', label: 'Retake: “Nochmal”' },
    ]);
  });

  it('does not count in a sentence or without a repeat, and knows the English cues', () => {
    const plain = said([1, 1.3, 'Ich'], [1.3, 1.6, 'sag'], [1.6, 1.8, 'es'], [1.8, 2.1, 'noch'], [2.1, 2.3, 'mal'], [2.3, 2.8, 'anders:'], [3, 3.4, 'Cuttle'], [3.4, 3.8, 'schneidet']);
    expect(spokenCues(plain)).toEqual([]);
    // "again" inside a sentence is no cue, even when the words after it repeat
    const inSentence = said([1, 1.3, 'Click'], [1.3, 1.5, 'it'], [1.5, 1.9, 'again.'], [2.6, 2.9, 'Click'], [2.9, 3.1, 'it'], [3.1, 3.3, 'and'], [3.3, 3.7, 'save']);
    expect(spokenCues(inSentence)).toEqual([]);
    // a cue after a pause without a repeat is none either
    const noRepeat = said([1, 1.5, 'Fertig.'], [2.5, 3, 'Nochmal:'], [3.5, 4, 'Cuttle'], [4, 4.5, 'schneidet']);
    expect(spokenCues(noRepeat)).toEqual([]);
    // the English fixture: "Um, it zooms on clicks. Again. It zooms on every click"
    const english = said([0.5, 0.8, 'you.'], [1, 1.3, 'Um,'], [1.4, 1.6, 'it'], [1.6, 1.9, 'zooms'], [1.9, 2.1, 'on'], [2.1, 2.5, 'clicks.'], [3.5, 3.9, 'Again.'], [4.5, 4.7, 'It'], [4.7, 5.1, 'zooms'], [5.1, 5.4, 'on'], [5.4, 5.7, 'every'], [5.7, 6.1, 'click']);
    expect(spokenCues(english)).toEqual([{ at: 3.5, end: 3.9, text: 'Again', slip: 1.4 }]);
    const phrase = said([1, 1.3, 'Lass'], [1.3, 1.6, 'mich'], [2, 2.4, 'one'], [2.4, 2.7, 'more'], [2.7, 3, 'time'], [3.5, 3.8, 'Lass'], [3.8, 4.1, 'mich']);
    expect(spokenCues(phrase)).toEqual([{ at: 2, end: 3, text: 'one more time', slip: 1 }]);
  });

  it('skips a "sorry" or an "äh" around the cue, and takes "nochmal von vorne" whole', () => {
    const sorry = said([1, 1.3, 'Die'], [1.3, 1.6, 'App'], [1.6, 2, 'misst'], [2.6, 3, 'sorry,'], [3, 3.5, 'nochmal.'], [4, 4.2, 'Äh,'], [4.4, 4.6, 'die'], [4.6, 4.9, 'App'], [4.9, 5.4, 'erkennt']);
    expect(spokenCues(sorry)).toEqual([{ at: 3, end: 3.5, text: 'nochmal', slip: 1 }]);
    const fromTheTop = said([1, 1.3, 'Das'], [1.3, 1.6, 'ist'], [2.2, 2.6, 'nochmal'], [2.6, 2.8, 'von'], [2.8, 3.2, 'vorne.'], [3.8, 4, 'Das'], [4, 4.2, 'ist'], [4.2, 4.6, 'Cuttle']);
    expect(spokenCues(fromTheTop)).toEqual([{ at: 2.2, end: 3.2, text: 'nochmal von vorne', slip: 1 }]);
    // a slip of one word, said again
    const one = said([1, 1.5, 'Speichern.'], [2.2, 2.7, 'Nochmal.'], [3.2, 3.7, 'Speichern'], [3.7, 4, 'unter']);
    expect(spokenCues(one)).toEqual([{ at: 2.2, end: 2.7, text: 'Nochmal', slip: 1 }]);
  });

  it('joins the key and a cue at the same slip into one cut', () => {
    const words = germanWords();
    const cuts = retakeCuts(input({ words, markers: [key(12)], speech: wordStretches({ version: 1, language: 'de', model: 'small', words, sounds: [] }) }));
    expect(cuts).toEqual([{ from: 8.58, to: 12.285, auto: 'retake', label: 'Retake: “Nochmal”' }]);
  });
});

describe('retakes among the speech edits', () => {
  const project = (rest: Record<string, unknown> = {}) => {
    const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, scenes: [{ type: 'clip', from: 0, to: 30 }], ...rest });
    if (!parsed.ok) throw new Error('invalid');
    return parsed.project;
  };
  const words = said([1, 1.5, 'Erstens'], [2.5, 2.8, 'äh'], [3.5, 4, 'falsch'], [5.5, 6, 'zweitens']);
  const transcript = { version: 1 as const, language: 'de', model: 'small', words, sounds: [] };
  const base = { markers: [key(4.2)], speech: wordStretches(transcript), still: [{ from: 0, to: 30 }], events: [], clips: [{ from: 0, to: 30, speed: 1 }] };

  it('take in the pause after the key, and the key works without a transcript', () => {
    const raw = { cuts: [] };
    const result = withSpeechCuts(raw, project(), { ...base, transcript }, new Set());
    // "Erstens, äh, falsch [key] … zweitens": the slip and the pause after it go as one cut
    expect(result.cuts.map((cut) => [cut.auto, cut.from, cut.to])).toEqual([
      ['pause', 1.7, 2.3],
      ['filler', 2.45, 2.85],
      ['retake', 3.35, 5.3],
    ]);
    expect(result).toMatchObject({ retakes: 1, fillers: 1, pauses: 1 });
    expect(result.notes[0]).toMatch(/^cut 1 retake: back to the pause before each slip/);
    const keyOnly = withSpeechCuts({ cuts: [{ id: 'c1', from: 9, to: 9.5, auto: 'filler' }] }, project(), base, new Set(['c1']));
    // without a transcript the filler cut stays as it was
    expect(keyOnly.cuts.map((cut) => cut.auto)).toEqual(['retake', 'filler']);
  });

  it('are not made while switched off', () => {
    const result = withSpeechCuts({}, project({ autoEdits: { retakes: false } }), base, new Set());
    expect(result.cuts).toEqual([]);
    expect(result.notes).toContain('retake cuts are switched off (autoEdits.retakes)');
  });
});
```

Run: `pnpm exec vitest run --project node packages/core/test/retakes.test.ts`
Expected: FAIL: `../src/speech/retakes` does not exist.

- [ ] **Step 2: The detector**

`packages/core/src/speech/retakes.ts`:

```ts
// Retakes: the person slipped, pressed the mistake key (a `retake` marker) or said "nochmal", and did
// the bit again. The slip is cut: from the last pause before it to just after the key or the cue.
// Pure: the inputs are the markers, the transcript (or the mic's speech stretches) and the input
// events, in source seconds.
import { fillerLexicon, normWord, type InputEvent, type Marker, type TranscriptWord } from '@cuttle/project';
import type { Span } from '../suggest/spans';

export const RETAKE_RULES = {
  /** A gap in the speech this long is a pause … */
  pause: 0.7,
  /** … when nothing was clicked, typed or scrolled in its last this many seconds. */
  restingInput: 0.5,
  /** A pause is looked for at most this far back; without one, the cut starts this far back. */
  lookBack: 20,
  fallback: 5,
  /** Kept of the pause before the slip. */
  keepBefore: 0.15,
  /** The cut ends this long after the key or the spoken cue. */
  after: 0.15,
  /** A spoken cue starts a phrase: a pause this long comes before it ("…die Art. Nochmal."). */
  cuePause: 0.3,
  /** It counts when what follows (within this long) repeats the start of the slip … */
  repeatWindow: 4,
  /** … word for word, this many words or the whole slip … */
  repeatMatch: 2,
  /** … which began at most these many words before the cue. */
  repeatWords: 12,
};

/** The spoken cues for "once more", as normalised words in a row (the longest that fits wins). */
const CUES: readonly (readonly string[])[] = [
  ['nochmal'],
  ['nochmals'],
  ['noch', 'mal'],
  ['noch', 'einmal'],
  ['nochmal', 'von', 'vorne'],
  ['noch', 'mal', 'von', 'vorne'],
  ['noch', 'einmal', 'von', 'vorne'],
  ['again'],
  ['one', 'more', 'time'],
  ['let', 'me', 'redo', 'that'],
  ['again', 'from', 'the', 'top'],
];

/** Words that may stand around a cue ("Sorry, nochmal. Äh, die App …"): skipped when the slip and the repeat are compared. */
const AROUND_CUES: ReadonlySet<string> = new Set([...fillerLexicon('auto'), 'sorry', 'okay', 'ok', 'oops', 'hoppla', 'mist', 'nee', 'nein', 'no', 'also', 'so']);

export interface RetakeCut {
  from: number;
  to: number;
  auto: 'retake';
  label: string;
}

export interface RetakeInput {
  markers: readonly Marker[];
  /** The transcript's words, when there is one. */
  words?: readonly TranscriptWord[];
  /** Where someone speaks (the words, or the mic's loud stretches); the gaps between them are the pauses. */
  speech: readonly Span[];
  events: readonly InputEvent[];
  /** The clips' source stretches: a cut never crosses one's edge. */
  clips: readonly Span[];
}

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;

export interface SpokenCue {
  at: number;
  end: number;
  text: string;
  /** Where the slip it takes back began: the first of the words before it that is said again. */
  slip: number;
}

/**
 * The spoken cues that take a slip back: a cue that starts a phrase (after a pause), followed by the
 * slip said again, word for word from its start ("Die App erkennt die Art. Nochmal. Die App erkennt
 * die Art und misst …"). "Click it again" in a sentence is no cue.
 */
export function spokenCues(words: readonly TranscriptWord[], rules = RETAKE_RULES): SpokenCue[] {
  const normal = words.map((word) => normWord(word.text));
  const found: SpokenCue[] = [];
  for (let i = 0; i < words.length; i++) {
    const cue = CUES.filter((phrase) => phrase.every((part, k) => normal[i + k] === part)).sort((a, b) => b.length - a.length)[0];
    if (!cue) continue;
    const last = words[i + cue.length - 1]!;
    // the slip ends at `p` (before a "sorry" or an "äh"), with a pause there
    let p = i;
    while (p > 0 && AROUND_CUES.has(normal[p - 1]!)) p--;
    if (p === 0 || words[p]!.t - words[p - 1]!.end < rules.cuePause) continue;
    // the repeat starts at `a`, after the cue (and an "äh")
    let a = i + cue.length;
    while (a < words.length && AROUND_CUES.has(normal[a]!)) a++;
    const repeat = normal.slice(a).filter((_, k) => words[a + k]!.t <= last.end + rules.repeatWindow);
    // where the slip began: the word before the cue from which the repeat matches longest
    let best: { at: number; length: number } | undefined;
    for (let j = Math.max(0, p - rules.repeatWords); j < p; j++) {
      let length = 0;
      while (j + length < p && length < repeat.length && normal[j + length] === repeat[length]) length++;
      const counts = length >= rules.repeatMatch || (length > 0 && j + length === p);
      if (counts && length >= (best?.length ?? 0)) best = { at: j, length };
    }
    if (!best) continue;
    const text = words
      .slice(i, i + cue.length)
      .map((word) => word.text.replace(/[^\p{L}\p{N}]+$/u, ''))
      .join(' ');
    found.push({ at: words[i]!.t, end: last.end, text, slip: words[best.at]!.t });
    i += cue.length - 1;
  }
  return found;
}

/**
 * Where the slip before `back` began: the end of the last pause in the speech (a gap of `pause` or
 * more, with no click, key or scroll in its last `restingInput`), at most `lookBack` back; else
 * `fallback` back. Never before `floor` (the clip's start).
 */
function slipStart(back: number, input: RetakeInput, floor: number, rules: typeof RETAKE_RULES): number {
  const speech = [...input.speech].filter((span) => span.from < back).sort((a, b) => a.from - b.from);
  const acts = input.events.filter((event) => event.type === 'click' || event.type === 'keys' || event.type === 'scroll').map((event) => event.t);
  for (let k = speech.length - 1; k >= 0; k--) {
    const gapEnd = speech[k]!.from;
    if (gapEnd < back - rules.lookBack || gapEnd < floor) break;
    const gapStart = k > 0 ? speech[k - 1]!.to : floor;
    if (gapEnd - gapStart < rules.pause && k > 0) continue;
    if (acts.some((t) => t > gapEnd - rules.restingInput && t <= gapEnd)) continue;
    return Math.max(floor, gapEnd - rules.keepBefore);
  }
  return Math.max(floor, back - rules.fallback);
}

/**
 * The retakes: one cut per mistake key (a `retake` marker) and per spoken cue that is followed by a
 * repeat, from the last pause before the slip to `after` past the key or the cue, inside the clip it
 * lies in. Cuts that overlap become one.
 */
export function retakeCuts(input: RetakeInput, rules = RETAKE_RULES): RetakeCut[] {
  // `back`: where to look back from for the pause before the slip (a cue's: the slip's first word)
  const slips: { at: number; back: number; end: number; label: string }[] = [
    ...input.markers.filter((marker) => marker.kind === 'retake').map((marker) => ({ at: marker.t, back: marker.t, end: marker.t, label: 'Retake' })),
    ...(input.words ? spokenCues(input.words, rules).map((cue) => ({ at: cue.at, back: cue.slip + 0.001, end: cue.end, label: `Retake: “${cue.text}”` })) : []),
  ];
  const cuts: RetakeCut[] = [];
  for (const slip of slips.sort((a, b) => a.at - b.at)) {
    const clip = input.clips.find((span) => span.from <= slip.at && slip.at < span.to);
    if (!clip) continue;
    const from = slipStart(slip.back, input, clip.from, rules);
    const to = Math.min(clip.to, slip.end + rules.after);
    if (!(to > from)) continue;
    const last = cuts.at(-1);
    if (last && from <= last.to) {
      last.to = Math.max(last.to, ms(to));
      continue;
    }
    cuts.push({ from: ms(from), to: ms(to), auto: 'retake', label: slip.label });
  }
  return cuts;
}
```

- [ ] **Step 3: Among the speech edits, in suggest and the app's step**

In `packages/core/src/speech/apply.ts`, replace:

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
```

with:

```ts
// The speech edits applied to a project: retakes (the mistake key, a spoken "nochmal"), and filler
// and pause cuts from its transcript, merged with the cuts there by the tag rules. `suggest` does
// this as part of its run; the app does it again once the transcript arrives after the cut.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEventsJsonl, parseMarkersJson, usedIds, type CuttleProject, type InputEvent, type Marker, type TranscriptFile } from '@cuttle/project';
import { CoreError } from '../errors';
import { readProjectFile, writeProjectFile } from '../project-file';
import { analyseScreen } from '../suggest/media';
import { union, type Span } from '../suggest/spans';
import { mergeCuts, speechCuts, type RawCut } from './edits';
import { micLevels, speechStretches } from './levels';
import { retakeCuts, type RetakeCut } from './retakes';
import { micOffset, readTranscript, transcriptOfMic } from './transcribe';

/** Words closer than this are one stretch of speech. */
```

In the same file, replace:

```ts
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
```

with:

```ts
  cuts: RawCut[];
  fillers: number;
  pauses: number;
  retakes: number;
  /** Of those, made switched off (where the person had switched one off). */
  off: number;
  notes: string[];
}

export interface SpeechCutsInput {
  /** The take's transcript: without one, only the retakes of the mistake key are made. */
  transcript?: TranscriptFile;
  markers: readonly Marker[];
  /** Where someone speaks (the words, or the mic's loud stretches), for the pause before a slip. */
  speech: readonly Span[];
  still: readonly Span[];
  events: readonly InputEvent[];
  /** The clips' source stretches and speeds: fillers and pauses are cut in 1× clips only. */
  clips: readonly (Span & { speed: number })[];
}

/** Filler and pause cuts this close to a retake, in its clip, become part of it. */
const RETAKE_JOIN = 0.1;

/**
 * Whether `cut` (a filler or a pause) touches one of the retakes, which then takes it in: the
 * pause after the key, before the bit is said again, belongs to the retake.
 */
function joinRetake(retakes: RetakeCut[], cut: Span, clips: readonly Span[]): boolean {
  const retake = retakes.find((one) => cut.from < one.to + RETAKE_JOIN && one.from - RETAKE_JOIN < cut.to);
  const clip = retake && clips.find((span) => span.from <= retake.from && retake.to <= span.to);
  if (!retake || !clip || cut.from < clip.from || cut.to > clip.to) return false;
  retake.from = Math.min(retake.from, cut.from);
  retake.to = Math.max(retake.to, cut.to);
  return true;
}

/**
 * The project's cuts with the speech edits: the retakes (the mistake key's markers, and with a
 * transcript the spoken cues), then the filler and pause cuts of the transcript (one that touches a
 * retake joins it). The tagged cuts of the kinds made are replaced; every other cut is kept.
 */
export function withSpeechCuts(raw: Record<string, unknown>, project: CuttleProject, input: SpeechCutsInput, taken = usedIds(raw)): SpeechCutsResult {
  const { transcript } = input;
  const retakes = project.autoEdits.retakes
    ? retakeCuts({ markers: input.markers, ...(transcript && { words: transcript.words }), speech: input.speech, events: input.events, clips: input.clips })
    : [];
  const speech = transcript
    ? speechCuts(
        {
          words: transcript.words,
          sounds: transcript.sounds.map((sound) => ({ from: sound.t, to: sound.end })),
          language: transcript.language,
          still: input.still,
          events: input.events,
          clips: input.clips.filter((clip) => clip.speed === 1),
        },
        { fillers: project.autoEdits.fillers, pauses: project.autoEdits.pauses },
      ).filter((cut) => !joinRetake(retakes, cut, input.clips))
    : [];
  // without a transcript the filler and pause cuts there stay as they are: nothing to make them again from
  const kinds = transcript ? ['retake', 'filler', 'pause'] : ['retake'];
  const made = [...retakes, ...speech].sort((a, b) => a.from - b.from);
  const { cuts, added, kept } = mergeCuts((raw.cuts as RawCut[] | undefined) ?? [], made, kinds, taken);
  const fillers = added.filter((cut) => cut.auto === 'filler').length;
  const pauses = added.filter((cut) => cut.auto === 'pause').length;
  const retaken = added.filter((cut) => cut.auto === 'retake').length;
  const off = added.filter((cut) => cut.enabled === false).length;
  const notes: string[] = [];
  if (retaken > 0) notes.push(`cut ${retaken} retake${retaken === 1 ? '' : 's'}: back to the pause before each slip (the mistake key, or a spoken "nochmal" that was then said again)`);
  if (!project.autoEdits.retakes) notes.push('retake cuts are switched off (autoEdits.retakes)');
  if (fillers + pauses > 0) {
    const removed = added.filter((cut) => cut.enabled !== false && cut.auto !== 'retake').reduce((sum, cut) => sum + cut.to - cut.from, 0);
    notes.push(`cut ${fillers} filler word${fillers === 1 ? '' : 's'} and ${pauses} pause${pauses === 1 ? '' : 's'} where the picture rests (${removed.toFixed(1)} s)${off > 0 ? `; ${off} stay off, as before` : ''}`);
  }
  if (transcript && !project.autoEdits.fillers) notes.push('filler cuts are switched off (autoEdits.fillers)');
  if (transcript && !project.autoEdits.pauses) notes.push('pause cuts are switched off (autoEdits.pauses)');
  if (kept > 0) notes.push(`kept ${kept} cut${kept === 1 ? '' : 's'} made by hand or by other steps`);
  return { cuts, fillers, pauses, retakes: retaken, off, notes };
}

/** The speech of a transcript as stretches: its words, joined where they touch. */
export const wordStretches = (transcript: TranscriptFile): Span[] => union(transcript.words.map((word) => ({ from: word.t, to: word.end })));

/** The markers of markers.json; none when it cannot be read. */
export async function readMarkers(path: string): Promise<Marker[]> {
  const parsed = parseMarkersJson(await readFile(path, 'utf8').catch(() => ''));
  return parsed.ok ? parsed.markers : [];
}

export interface SpeechEditsResult extends SpeechCutsResult {
```

In the same file, replace:

```ts
    const text = await readFile(resolve(file.dir, sources.events), 'utf8').catch(() => undefined);
    if (text !== undefined) events = parseEventsJsonl(text).events;
  }
  const clips = file.project.scenes.flatMap((scene) => (scene.type === 'clip' && scene.speed === 1 ? [{ from: scene.from, to: scene.to }] : []));
  const result = withSpeechCuts(file.raw, file.project, transcript, { still: screen.still, events, clips });
  const before = JSON.stringify(file.raw.cuts ?? []);
  const linking = (options.link !== undefined && options.link !== sources.transcript) || (options.cleanMic !== undefined && options.cleanMic !== sources.cleanMic);
  if (JSON.stringify(result.cuts) === before && !linking) return { ...result, project: file.path, written: false };
```

with:

```ts
    const text = await readFile(resolve(file.dir, sources.events), 'utf8').catch(() => undefined);
    if (text !== undefined) events = parseEventsJsonl(text).events;
  }
  const markers = sources.markers ? await readMarkers(resolve(file.dir, sources.markers)) : [];
  const clips = file.project.scenes.flatMap((scene) => (scene.type === 'clip' ? [{ from: scene.from, to: scene.to, speed: scene.speed }] : []));
  const result = withSpeechCuts(file.raw, file.project, { transcript, markers, speech: wordStretches(transcript), still: screen.still, events, clips });
  const before = JSON.stringify(file.raw.cuts ?? []);
  const linking = (options.link !== undefined && options.link !== sources.transcript) || (options.cleanMic !== undefined && options.cleanMic !== sources.cleanMic);
  if (JSON.stringify(result.cuts) === before && !linking) return { ...result, project: file.path, written: false };
```

In `packages/core/src/speech/edits.ts`, replace:

```ts
 * the place of a replaced one of its kind (overlapping at least half of the shorter) keeps its id,
 * and stays off when the person had switched that one off; the others get unused ids from `taken`.
 */
export function mergeCuts(raw: readonly RawCut[], made: readonly SpeechCut[], kinds: readonly string[], taken: Set<string>): { cuts: RawCut[]; added: RawCut[]; kept: number } {
  const ours = (cut: RawCut) => cut.auto !== undefined && kinds.includes(cut.auto);
  const kept = raw.filter((cut) => !ours(cut));
  const replaced = raw.filter(ours);
```

with:

```ts
 * the place of a replaced one of its kind (overlapping at least half of the shorter) keeps its id,
 * and stays off when the person had switched that one off; the others get unused ids from `taken`.
 */
export function mergeCuts(
  raw: readonly RawCut[],
  made: readonly { from: number; to: number; auto: string; label: string }[],
  kinds: readonly string[],
  taken: Set<string>,
): { cuts: RawCut[]; added: RawCut[]; kept: number } {
  const ours = (cut: RawCut) => cut.auto !== undefined && kinds.includes(cut.auto);
  const kept = raw.filter((cut) => !ours(cut));
  const replaced = raw.filter(ours);
```

In `packages/core/src/suggest.ts`, replace:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { newId, parseEventsJsonl, parseMarkersJson, parseProject, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect, type TranscriptFile } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
```

with:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { newId, parseEventsJsonl, parseProject, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect, type TranscriptFile } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
```

In the same file, replace:

```ts
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { takeClock, transcriptMarkers } from './suggest/transcript';
import { speechActivity, withSpeechCuts } from './speech/apply';
import type { RawCut } from './speech/edits';
import { chooseModel } from './speech/models';
import { readTranscript, transcribeTake } from './speech/transcribe';
```

with:

```ts
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { takeClock, transcriptMarkers } from './suggest/transcript';
import { readMarkers, speechActivity, withSpeechCuts, wordStretches } from './speech/apply';
import type { RawCut } from './speech/edits';
import { chooseModel } from './speech/models';
import { readTranscript, transcribeTake } from './speech/transcribe';
```

In the same file, replace:

```ts
  /** Every cut of the file afterwards, when the speech edits were made (a transcript was there). */
  cuts?: RawCut[];
  /** Where the speech came from: the transcript, the mic's loudness, or none; and the cuts made for it. */
  speech: { from: 'transcript' | 'mic' | 'none'; fillers: number; pauses: number };
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
```

with:

```ts
  /** Every cut of the file afterwards, when the speech edits were made (a transcript was there). */
  cuts?: RawCut[];
  /** Where the speech came from: the transcript, the mic's loudness, or none; and the cuts made for it. */
  speech: { from: 'transcript' | 'mic' | 'none'; fillers: number; pauses: number; retakes: number };
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
```

In the same file, replace:

```ts
  }
  let markers = sources.markers ? await readMarkers(resolve(file.dir, sources.markers)) : [];
  let from: SuggestResult['markers']['from'] = markers.length > 0 ? 'take' : 'none';
  if (args.claude !== undefined && !markers.some((marker) => marker.kind !== 'manual')) {
    const cwd = args.claude === true ? process.cwd() : resolve(args.claude);
    await screenStart(dirname(screen)); // refuses a take without take.json
    const clock = await takeClock(dirname(screen));
```

with:

```ts
  }
  let markers = sources.markers ? await readMarkers(resolve(file.dir, sources.markers)) : [];
  let from: SuggestResult['markers']['from'] = markers.length > 0 ? 'take' : 'none';
  if (args.claude !== undefined && !markers.some(fromClaude)) {
    const cwd = args.claude === true ? process.cwd() : resolve(args.claude);
    await screenStart(dirname(screen)); // refuses a take without take.json
    const clock = await takeClock(dirname(screen));
```

In the same file, replace:

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
```

with:

```ts
    notes.push(`kept ${before.length + after.length} still or card scene(s)${before.length > 0 ? `, ${before.length} before the clips` : ''}`);
  }
  const scenes = [...before, ...clips, ...after];
  // The retakes, then the filler words and pauses inside the new 1× clips, where the picture rests.
  let cuts: RawCut[] | undefined;
  let made = { fillers: 0, pauses: 0, retakes: 0 };
  const hasRetakes = markers.some((marker) => marker.kind === 'retake') || ((file.raw.cuts as RawCut[] | undefined) ?? []).some((cut) => cut.auto === 'retake');
  // the mistake key's retakes are cut even with the speech left out (then 5 s back)
  if (transcript || hasRetakes) {
    // the pauses before a slip: between the words, or between the mic's loud stretches
    const pauses = transcript ? wordStretches(transcript) : speech.from === 'mic' ? speech.spans : [];
    const clips = suggestion.clips.map(({ from: start, to, speed }) => ({ from: start, to, speed }));
    const result = withSpeechCuts(file.raw, file.project, { ...(transcript && { transcript }), markers, speech: pauses, still: screenInfo.still, events, clips }, taken);
    notes.push(...result.notes);
    cuts = result.cuts;
    made = { fillers: result.fillers, pauses: result.pauses, retakes: result.retakes };
  }
  // The zooms suggest made before are replaced; the others stay, and the new ones avoid them.
  const rawZooms = (file.raw.zooms as SuggestedZoom[] | undefined) ?? [];
```

In the same file, replace:

```ts
  });
}

/** The events of events.jsonl; undefined when the file cannot be read. */
async function readEvents(path: string): Promise<InputEvent[] | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  return text === undefined ? undefined : parseEventsJsonl(text).events;
}

async function readMarkers(path: string): Promise<Marker[]> {
  const parsed = parseMarkersJson(await readFile(path, 'utf8').catch(() => ''));
  return parsed.ok ? parsed.markers : [];
}

/** The screen track's start (wall-clock seconds) from the take.json next to it. */
async function screenStart(takeDir: string): Promise<number> {
  const path = join(takeDir, 'take.json');
```

with:

```ts
  });
}

/** A marker Claude Code's session made (not the person's own, nor the mistake key's). */
const fromClaude = (marker: Marker) => marker.kind === 'prompt' || marker.kind === 'tool' || marker.kind === 'answer';

/** The events of events.jsonl; undefined when the file cannot be read. */
async function readEvents(path: string): Promise<InputEvent[] | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  return text === undefined ? undefined : parseEventsJsonl(text).events;
}

/** The screen track's start (wall-clock seconds) from the take.json next to it. */
async function screenStart(takeDir: string): Promise<number> {
  const path = join(takeDir, 'take.json');
```

In `packages/core/src/suggest/plan.ts`, replace:

```ts
  );
  // Claude's turn, from its first prompt or tool call to the answer, is never cut: it only waits on a
  // spinner now and then (a still screen), and the speed-up shows it working.
  const turnStart = answer === undefined ? undefined : input.markers.filter((marker) => marker.kind !== 'manual' && marker.t <= answer).at(0)?.t;
  const turn = turnStart !== undefined && answer !== undefined && answer > turnStart ? [{ from: turnStart, to: answer }] : [];
  const speechSpans = union(
    (input.speech ?? []).map((span) => ({ from: Math.max(0, span.from - RULES.inputPad), to: Math.min(duration, span.to + RULES.inputPad) })),
```

with:

```ts
  );
  // Claude's turn, from its first prompt or tool call to the answer, is never cut: it only waits on a
  // spinner now and then (a still screen), and the speed-up shows it working.
  const turnStart = answer === undefined ? undefined : input.markers.filter((marker) => (marker.kind === 'prompt' || marker.kind === 'tool') && marker.t <= answer).at(0)?.t;
  const turn = turnStart !== undefined && answer !== undefined && answer > turnStart ? [{ from: turnStart, to: answer }] : [];
  const speechSpans = union(
    (input.speech ?? []).map((span) => ({ from: Math.max(0, span.from - RULES.inputPad), to: Math.min(duration, span.to + RULES.inputPad) })),
```

In `packages/core/src/index.ts`, replace:

```ts
export { ALIGN_RULES, alignWords, guessLanguage, type Alignment } from './speech/align';
export { SPEECH_EDIT_RULES, fillerCuts, fillerWords, inputSpans, mergeCuts, pauseCuts, restingAt, speechCuts, type RawCut, type SpeechCut, type SpeechEditInput } from './speech/edits';
export { TRANSCRIPT_FILE, micOffset, readTranscript, transcribeTake, transcriptOfMic, type TranscribeOptions, type TranscribeResult } from './speech/transcribe';
export { applySpeechEdits, speechActivity, withSpeechCuts, type SpeechCutsResult, type SpeechEditsResult } from './speech/apply';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
```

with:

```ts
export { ALIGN_RULES, alignWords, guessLanguage, type Alignment } from './speech/align';
export { SPEECH_EDIT_RULES, fillerCuts, fillerWords, inputSpans, mergeCuts, pauseCuts, restingAt, speechCuts, type RawCut, type SpeechCut, type SpeechEditInput } from './speech/edits';
export { TRANSCRIPT_FILE, micOffset, readTranscript, transcribeTake, transcriptOfMic, type TranscribeOptions, type TranscribeResult } from './speech/transcribe';
export { applySpeechEdits, speechActivity, withSpeechCuts, wordStretches, type SpeechCutsInput, type SpeechCutsResult, type SpeechEditsResult } from './speech/apply';
export { RETAKE_RULES, retakeCuts, spokenCues, type RetakeCut, type RetakeInput, type SpokenCue } from './speech/retakes';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
```

- [ ] **Step 4: The spoken take's retake**

Where a speech model is downloaded, the spoken take of M2a is transcribed for real. Its "Again." is a slip said again:

In `packages/core/test/speech-take.test.ts`, replace:

```ts
    expect(result.scenes.length).toBeGreaterThan(0);
    const fillers = (result.cuts ?? []).filter((cut) => cut.auto === 'filler');
    const pauses = (result.cuts ?? []).filter((cut) => cut.auto === 'pause');
    // "Uh" at 2.22 s and "Um" at 7.755 s of the screen
    for (const at of [2.22, 7.755]) expect(fillers.some((cut) => cut.from - 0.15 <= at && at <= cut.to), `a filler cut at ${at}`).toBe(true);
    expect(pauses.length).toBeGreaterThan(0);
    expect(result.notes.some((note) => /^cut \d+ filler words? and \d+ pauses?/.test(note))).toBe(true);

    // the app's step once the transcript arrives: the same cuts again, nothing else touched
    const before = readFileSync(join(dir, 'cuttle.json'), 'utf8');
```

with:

```ts
    expect(result.scenes.length).toBeGreaterThan(0);
    const fillers = (result.cuts ?? []).filter((cut) => cut.auto === 'filler');
    const pauses = (result.cuts ?? []).filter((cut) => cut.auto === 'pause');
    // "Uh" at 2.22 s of the screen
    expect(fillers.some((cut) => cut.from - 0.15 <= 2.22 && 2.22 <= cut.to), 'a filler cut at 2.22').toBe(true);
    expect(pauses.length).toBeGreaterThan(0);
    expect(result.notes.some((note) => /^cut \d+ filler words? and \d+ pauses?/.test(note))).toBe(true);
    // "Um, it zooms on clicks. Again. It zooms on every click": the slip goes, from the pause before
    // "Um" (7.755 s of the screen) through "Again" (10.49 s) to the repeat ("It" at 11.85 s)
    const retakes = (result.cuts ?? []).filter((cut) => cut.auto === 'retake');
    expect(result.speech.retakes).toBe(1);
    expect(retakes).toEqual([expect.objectContaining({ label: 'Retake: “Again”' })]);
    expect(retakes[0]!.from).toBeLessThan(7.755);
    expect(retakes[0]!.to).toBeGreaterThan(10.49 + 0.3);
    expect(retakes[0]!.to).toBeLessThanOrEqual(11.85);

    // the app's step once the transcript arrives: the same cuts again, nothing else touched
    const before = readFileSync(join(dir, 'cuttle.json'), 'utf8');
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node packages/core`
Expected: PASS (`speech-take` is skipped without a speech model).

Run: `pnpm exec tsc -p packages/core/tsconfig.json`
Expected: exits with code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "core: retakes: the mistake key and a spoken \"nochmal\" cut back to the pause before the slip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The CLI

**Files:**
- Modify: `apps/cli/src/commands/record.ts`, `apps/cli/src/main.ts`, `apps/cli/test/cli.test.ts`

- [ ] **Step 1: The expectations**

`suggest` reports `speech.retakes`:

In `apps/cli/test/cli.test.ts`, replace:

```ts
    const { notes, speech } = suggested.json as { notes: string[]; speech: unknown };
    expect(notes[0]).toBe('the mic was not transcribed: no speech model is downloaded ("cuttle models download small"), so filler words and pauses stay');
    // a steady tone is not speech
    expect(speech).toEqual({ from: 'mic', fillers: 0, pauses: 0 });
    // --no-speech leaves the mic out altogether
    const without = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-speech');
    expect((without.json as { notes: string[]; speech: unknown }).speech).toEqual({ from: 'none', fillers: 0, pauses: 0 });
  }, 30_000);
});
```

with:

```ts
    const { notes, speech } = suggested.json as { notes: string[]; speech: unknown };
    expect(notes[0]).toBe('the mic was not transcribed: no speech model is downloaded ("cuttle models download small"), so filler words and pauses stay');
    // a steady tone is not speech
    expect(speech).toEqual({ from: 'mic', fillers: 0, pauses: 0, retakes: 0 });
    // --no-speech leaves the mic out altogether
    const without = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-speech');
    expect((without.json as { notes: string[]; speech: unknown }).speech).toEqual({ from: 'none', fillers: 0, pauses: 0, retakes: 0 });
  }, 30_000);
});
```

In the same file, replace:

```ts
          "fillers": 0,
          "from": "none",
          "pauses": 0,
        },
        "written": true,
        "zooms": [
```

with:

```ts
          "fillers": 0,
          "from": "none",
          "pauses": 0,
          "retakes": 0,
        },
        "written": true,
        "zooms": [
```

- [ ] **Step 2: The status line and `--no-speech`**

In `apps/cli/src/commands/record.ts`, replace:

```ts
    backend: args.backend,
    onEvent(event) {
      if (event.type === 'countdown') output.info(`recording in ${event.seconds} …`);
      if (event.type === 'recording') output.info(`recording ${event.dir}; stop: Ctrl+C or ${HOTKEYS.stop}, marker: ${HOTKEYS.marker}, pause: ${HOTKEYS.pause}`);
      if (event.type === 'paused') output.info(`paused: nothing is recorded until ${HOTKEYS.pause} again`);
      if (event.type === 'resuming') output.info('resuming …');
      if (event.type === 'resumed') output.info('recording again');
```

with:

```ts
    backend: args.backend,
    onEvent(event) {
      if (event.type === 'countdown') output.info(`recording in ${event.seconds} …`);
      if (event.type === 'recording') output.info(`recording ${event.dir}; stop: Ctrl+C or ${HOTKEYS.stop}, marker: ${HOTKEYS.marker}, pause: ${HOTKEYS.pause}, a slip: ${HOTKEYS.retake}`);
      if (event.type === 'paused') output.info(`paused: nothing is recorded until ${HOTKEYS.pause} again`);
      if (event.type === 'resuming') output.info('resuming …');
      if (event.type === 'resumed') output.info('recording again');
```

In `apps/cli/src/main.ts`, replace:

```ts
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer nor on clicks)')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-speech', 'leave the speech out: no filler or pause cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
```

with:

```ts
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer nor on clicks)')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-speech', 'leave the speech out: no filler, pause or spoken retake cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cli
git commit -m "cli: the mistake key in record's status line; suggest reports retakes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The app

**Files:**
- Modify: `apps/desktop/src/shared/{recording,ipc,channels,timeline-model}.ts`, `apps/desktop/src/workers/recorder.ts`
- Modify: `apps/desktop/src/main/{recorder-host,recording,speech}.ts`
- Modify: `apps/desktop/src/renderer/picker/{Hud.tsx,picker.css}`, `apps/desktop/src/renderer/editor/doc.ts`
- Test: `apps/desktop/test/timeline-model.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/test/timeline-model.test.ts`, replace:

```ts
    const [same] = groupPins([tool(1, 'Bash'), tool(1.1, 'Bash')], 1);
    const [mixed] = groupPins([tool(1, 'Read'), tool(1.1, 'Bash'), tool(1.2, 'Read')], 1);
    expect([pinGroupName(same!), pinGroupName(mixed!)]).toEqual(['Bash ×2', '3 tool calls']);
    expect(pinGroupDetail(mixed!)).toBe('Read 2 · Bash 1');
  });
```

with:

```ts
    const [same] = groupPins([tool(1, 'Bash'), tool(1.1, 'Bash')], 1);
    const [mixed] = groupPins([tool(1, 'Read'), tool(1.1, 'Bash'), tool(1.2, 'Read')], 1);
    expect([pinGroupName(same!), pinGroupName(mixed!)]).toEqual(['Bash ×2', '3 tool calls']);
    const [slip] = groupPins([{ t: 2, source: 2, kind: 'retake' }], 1);
    expect(pinGroupName(slip!)).toBe('Retake');
    expect(pinGroupDetail(mixed!)).toBe('Read 2 · Bash 1');
  });
```

Run: `pnpm exec vitest run --project node apps/desktop/test/timeline-model.test.ts`
Expected: FAIL: the pin is named "Tool".

- [ ] **Step 2: From the HUD to the recorder**

In `apps/desktop/src/shared/recording.ts`, replace:

```ts
  | { type: 'start'; options: Omit<RecordOptions, 'onEvent'> }
  | { type: 'stop' }
  | { type: 'marker'; label?: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'dead-zones'; zones: Bounds[] };
```

with:

```ts
  | { type: 'start'; options: Omit<RecordOptions, 'onEvent'> }
  | { type: 'stop' }
  | { type: 'marker'; label?: string }
  | { type: 'retake' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'dead-zones'; zones: Bounds[] };
```

In `apps/desktop/src/workers/recorder.ts`, replace:

```ts
    case 'marker':
      recording?.marker(data.label);
      return;
    case 'pause':
      recording?.pause();
      return;
```

with:

```ts
    case 'marker':
      recording?.marker(data.label);
      return;
    case 'retake':
      recording?.retake();
      return;
    case 'pause':
      recording?.pause();
      return;
```

In `apps/desktop/src/main/recorder-host.ts`, replace:

```ts
    if (this.running) this.send({ type: 'marker', ...(label !== undefined && { label }) });
  }

  /** Pauses the take: every track stops until `resume()` (events `paused`, `resuming`, `resumed`). */
  pause(): void {
    if (this.running) this.send({ type: 'pause' });
```

with:

```ts
    if (this.running) this.send({ type: 'marker', ...(label !== undefined && { label }) });
  }

  /** The mistake key: a `retake` marker. */
  retake(): void {
    if (this.running) this.send({ type: 'retake' });
  }

  /** Pauses the take: every track stops until `resume()` (events `paused`, `resuming`, `resumed`). */
  pause(): void {
    if (this.running) this.send({ type: 'pause' });
```

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
  /** Seconds recorded before it (the take's time stands still while paused). */
  recorded?: number;
  markers: number;
  /** A warning in a few words ("Mic is silent: muted?"), or "Stopping…". */
  message?: string;
  /** The whole warning, for the tooltip. */
```

with:

```ts
  /** Seconds recorded before it (the take's time stands still while paused). */
  recorded?: number;
  markers: number;
  /** How often the mistake key was pressed (its markers are not counted in `markers`). */
  retakes?: number;
  /** A warning in a few words ("Mic is silent: muted?"), or "Stopping…". */
  message?: string;
  /** The whole warning, for the tooltip. */
```

In the same file, replace:

```ts
  // HUD
  'hud:stop': z.undefined(),
  'hud:marker': z.undefined(),
  'hud:pause': z.undefined(),
  'hud:resume': z.undefined(),
  /** Puts the take aside and records again with the same settings (the HUD asks for a press held 600 ms). */
```

with:

```ts
  // HUD
  'hud:stop': z.undefined(),
  'hud:marker': z.undefined(),
  /** The mistake key: Cuttle cuts back to the pause before it. */
  'hud:retake': z.undefined(),
  'hud:pause': z.undefined(),
  'hud:resume': z.undefined(),
  /** Puts the take aside and records again with the same settings (the HUD asks for a press held 600 ms). */
```

In the same file, replace:

```ts
  'picker:retry': void;
  'hud:stop': void;
  'hud:marker': void;
  'hud:pause': void;
  'hud:resume': void;
  'hud:restart': void;
```

with:

```ts
  'picker:retry': void;
  'hud:stop': void;
  'hud:marker': void;
  'hud:retake': void;
  'hud:pause': void;
  'hud:resume': void;
  'hud:restart': void;
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
    events: ['picker:open', 'picker:active', 'picker:choices', 'picker:devices', 'app:motion'],
  },
  hud: {
    requests: ['hud:stop', 'hud:marker', 'hud:pause', 'hud:resume', 'hud:restart'],
    events: ['hud:state', 'app:motion'],
  },
  countdown: {
```

with:

```ts
    events: ['picker:open', 'picker:active', 'picker:choices', 'picker:devices', 'app:motion'],
  },
  hud: {
    requests: ['hud:stop', 'hud:marker', 'hud:retake', 'hud:pause', 'hud:resume', 'hud:restart'],
    events: ['hud:state', 'app:motion'],
  },
  countdown: {
```

In `apps/desktop/src/main/recording.ts`, replace:

```ts
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, sendToEditor, setEditorStatus, showPill, webPreferences } from './windows';

/** The HUD's window (the HUD and a margin for its shadow): never in the video, and a dead zone for the input log. */
const HUD_SIZE = { width: 440, height: 64 };
/** The recorder host answers a listing in this time, or the picker says it cannot record. */
const LISTING_TIMEOUT_MS = 10_000;
```

with:

```ts
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, sendToEditor, setEditorStatus, showPill, webPreferences } from './windows';

/** The HUD's window (the HUD and a margin for its shadow): never in the video, and a dead zone for the input log. */
const HUD_SIZE = { width: 480, height: 64 };
/** The recorder host answers a listing in this time, or the picker says it cannot record. */
const LISTING_TIMEOUT_MS = 10_000;
```

In the same file, replace:

```ts
          recorderHost.stop();
        },
        'hud:marker': () => recorderHost.marker(),
        'hud:pause': () => recorderHost.pause(),
        'hud:resume': () => recorderHost.resume(),
        'hud:restart': () => {
```

with:

```ts
          recorderHost.stop();
        },
        'hud:marker': () => recorderHost.marker(),
        'hud:retake': () => recorderHost.retake(),
        'hud:pause': () => recorderHost.pause(),
        'hud:resume': () => recorderHost.resume(),
        'hud:restart': () => {
```

In the same file, replace:

```ts
            showHud();
            return;
          case 'marker':
            hudState.markers++;
            showHud();
            return;
          case 'warning': {
```

with:

```ts
            showHud();
            return;
          case 'marker':
            // the mistake key's marker is a retake, not one of the person's markers
            if (event.marker.kind === 'retake') hudState.retakes = (hudState.retakes ?? 0) + 1;
            else hudState.markers++;
            showHud();
            return;
          case 'warning': {
```

- [ ] **Step 3: The scissors**

In `apps/desktop/src/renderer/picker/Hud.tsx`, replace:

```
// The recording HUD: the time, a warning when there is one, restart, a marker, pause and Stop. It
// is never in the video (content protection), never takes the focus (the recorded window keeps it),
// and its area is a dead zone for the input log. Its width is fixed, so Stop never moves under the
// pointer. Restart asks for a press held 600 ms, so a stray click does not put a take aside.
```

with:

```
// The recording HUD: the time, a warning when there is one, restart, the mistake key, a marker,
// pause and Stop. It
// is never in the video (content protection), never takes the focus (the recorded window keeps it),
// and its area is a dead zone for the input log. Its width is fixed, so Stop never moves under the
// pointer. Restart asks for a press held 600 ms, so a stray click does not put a take aside.
```

In the same file, replace:

```
          setFlash(true);
          setTimeout(() => setFlash(false), 900);
        }
        return next;
      });
    });
```

with:

```
          setFlash(true);
          setTimeout(() => setFlash(false), 900);
        }
        // the mistake key: what Cuttle will do with it, for a moment
        if ((next.retakes ?? 0) > (previous.retakes ?? 0)) showHint('Slip marked: do it again');
        return next;
      });
    });
```

In the same file, replace:

```
        </span>
        <span className="sep" />
        <RestartButton disabled={!live} onShortPress={() => showHint('Hold to restart')} />
        <button
          className={`marker${flash ? ' flash' : ''}`}
          onClick={() => void bridge.invoke('hud:marker')}
```

with:

```
        </span>
        <span className="sep" />
        <RestartButton disabled={!live} onShortPress={() => showHint('Hold to restart')} />
        <button
          className="retake"
          onClick={() => void bridge.invoke('hud:retake')}
          title="A slip? Press it, then say or do the bit again: Cuttle cuts back to the pause before (Ctrl+Shift+Alt+X)"
          aria-label="Mark a slip: cut back to the pause before"
          disabled={state.phase !== 'recording'}
          data-testid="hud-retake"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <circle cx="4.5" cy="4.5" r="2" />
            <circle cx="4.5" cy="11.5" r="2" />
            <path d="M6.2 5.6 13.5 12.5M6.2 10.4 13.5 3.5" />
          </svg>
        </button>
        <button
          className={`marker${flash ? ' flash' : ''}`}
          onClick={() => void bridge.invoke('hud:marker')}
```

In `apps/desktop/src/renderer/picker/picker.css`, replace:

```
  place-items: center;
}
.hud {
  width: 420px;
  height: 48px;
  display: flex;
  align-items: center;
```

with:

```
  place-items: center;
}
.hud {
  width: 460px;
  height: 48px;
  display: flex;
  align-items: center;
```

- [ ] **Step 4: The pin's name, the status and the toast**

In `apps/desktop/src/shared/timeline-model.ts`, replace:

```ts
  if (group.kind === 'prompt') return 'Prompt';
  if (group.kind === 'answer') return 'Answer';
  if (group.kind === 'manual') return first.label ?? 'Marker';
  if (group.pins.length === 1) return first.label ?? 'Tool';
  const tools = new Set(group.pins.map((pin) => pin.label ?? 'Tool'));
  return tools.size === 1 ? `${first.label ?? 'Tool'} ×${group.pins.length}` : `${group.pins.length} tool calls`;
```

with:

```ts
  if (group.kind === 'prompt') return 'Prompt';
  if (group.kind === 'answer') return 'Answer';
  if (group.kind === 'manual') return first.label ?? 'Marker';
  if (group.kind === 'retake') return 'Retake';
  if (group.pins.length === 1) return first.label ?? 'Tool';
  const tools = new Set(group.pins.map((pin) => pin.label ?? 'Tool'));
  return tools.size === 1 ? `${first.label ?? 'Tool'} ×${group.pins.length}` : `${group.pins.length} tool calls`;
```

In `apps/desktop/src/main/speech.ts`, replace:

```ts
// Speech in the app: the models (download with progress and cancel, remove), and transcribing a
// take after its cut, in the media worker, then its filler words and pauses cut as one change.
import { dirname, join, relative, resolve, sep } from 'node:path';
import { CLEAN_MIC_FILE, CoreError, SPEECH_MODELS, TRANSCRIPT_FILE, downloadModel, hasWhisper, installedModels, modelInstalled, modelsDir, readProjectFile, removeModel } from '@cuttle/core';
import type { SpeechModelName, SpeechStatus } from '../shared/ipc';
```

with:

```ts
// Speech in the app: the models (download with progress and cancel, remove), and transcribing a
// take after its cut, in the media worker, then its retakes, filler words and pauses cut as one
// change.
import { dirname, join, relative, resolve, sep } from 'node:path';
import { CLEAN_MIC_FILE, CoreError, SPEECH_MODELS, TRANSCRIPT_FILE, downloadModel, hasWhisper, installedModels, modelInstalled, modelsDir, readProjectFile, removeModel } from '@cuttle/core';
import type { SpeechModelName, SpeechStatus } from '../shared/ipc';
```

In the same file, replace:

```ts
const transcribing = new Set<string>();

/**
 * Transcribes the project's mic after its cut and cuts its filler words and pauses, when speech is
 * on in the settings, the take has a mic and no transcript yet, the model is downloaded and ffmpeg
 * can transcribe. The editor's title bar shows the progress, and the speech edits arrive as one
 * step to undo ("Cuttle's speech edits"). `asked`: the person asked for it (the Auto tab, Try again):
 * it runs again over a transcript there, and says why it cannot instead of staying quiet.
 */
```

with:

```ts
const transcribing = new Set<string>();

/**
 * Transcribes the project's mic after its cut and cuts its retakes, filler words and pauses, when
 * speech is on in the settings, the take has a mic and no transcript yet, the model is downloaded
 * and ffmpeg can transcribe. The editor's title bar shows the progress, and the speech edits arrive as one
 * step to undo ("Cuttle's speech edits"). `asked`: the person asked for it (the Auto tab, Try again):
 * it runs again over a transcript there, and says why it cannot instead of staying quiet.
 */
```

In the same file, replace:

```ts
      await mediaWorker.run({ job: 'transcribe', input: dir, output: '', model: model.name, language: speech.language }, (progress) => void status(progress)).promise;
      const take = (name: string) => relative(file.dir, join(dirname(resolve(file.dir, mic)), name)).split(sep).join('/');
      const transcript = take(TRANSCRIPT_FILE);
      await setEditorStatus(dir, { text: 'Cutting filler words and pauses…', state: 'working' });
      await expectSpeech(dir, true);
      try {
        await mediaWorker.run({ job: 'speech-edits', input: dir, output: '', transcript, cleanMic: take(CLEAN_MIC_FILE) }, () => {}).promise;
```

with:

```ts
      await mediaWorker.run({ job: 'transcribe', input: dir, output: '', model: model.name, language: speech.language }, (progress) => void status(progress)).promise;
      const take = (name: string) => relative(file.dir, join(dirname(resolve(file.dir, mic)), name)).split(sep).join('/');
      const transcript = take(TRANSCRIPT_FILE);
      await setEditorStatus(dir, { text: 'Cutting retakes, filler words and pauses…', state: 'working' });
      await expectSpeech(dir, true);
      try {
        await mediaWorker.run({ job: 'speech-edits', input: dir, output: '', transcript, cleanMic: take(CLEAN_MIC_FILE) }, () => {}).promise;
```

In `apps/desktop/src/renderer/editor/doc.ts`, replace:

```ts

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
```

with:

```ts

/** What the app's speech edits did, said once they arrive. */
function speechToast(project: CuttleProject): string {
  const count = (kind: 'retake' | 'filler' | 'pause') => project.cuts.filter((cut) => cut.auto === kind && cut.enabled).length;
  const retakes = count('retake');
  const fillers = count('filler');
  const pauses = count('pause');
  if (retakes + fillers + pauses === 0) return 'Cuttle transcribed the take: no filler words or pauses to cut.';
  const slips = retakes > 0 ? `${retakes} retake${retakes === 1 ? '' : 's'}` : '';
  if (fillers + pauses === 0) return `Cuttle cut ${slips}.`;
  const parts = [fillers > 0 && `${fillers} filler word${fillers === 1 ? '' : 's'}`, pauses > 0 && `${pauses} pause${pauses === 1 ? '' : 's'}`].filter(Boolean);
  return `Cuttle cut ${slips ? `${slips}, and ` : ''}${parts.join(' and ')} where the picture rests.`;
}

/** The editor opens anew on another take (its media); the main process reloads it (a page cannot). */
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm exec vitest run --project node apps/desktop/test/timeline-model.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src apps/desktop/test/timeline-model.test.ts
git commit -m "desktop: the HUD's scissors, the retake pin, and retakes in the speech step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The skill

**Files:**
- Modify: `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`

- [ ] **Step 1: Slips**

In `skill/cuttle/SKILL.md`, replace:

```markdown
- Webcam and mic only when asked (`--webcam`, `--mic`). A muted mic is reported as a warning.
  When the user will speak, Cuttle transcribes the mic on this computer and cuts filler words and
  pauses. That needs a speech model: `cuttle --json models` lists them. If none is downloaded, ask
  the user before `cuttle models download small` (488 MB, once).
- Ask the user to make text large (terminal font 16 px or more, or zoom the browser), to close
  private windows and notifications, and to use a clean folder or browser profile.
- The project folder: a new one per demo (`record` creates it).
```

with:

```markdown
- Webcam and mic only when asked (`--webcam`, `--mic`). A muted mic is reported as a warning.
  When the user will speak, Cuttle transcribes the mic on this computer and cuts filler words and
  pauses. That needs a speech model: `cuttle --json models` lists them. If none is downloaded, ask
  the user before `cuttle models download small` (488 MB, once). Tell them that a slip needs no
  new take: press Ctrl+Shift+Alt+X (or say "nochmal", "again") and do the bit again.
- Ask the user to make text large (terminal font 16 px or more, or zoom the browser), to close
  private windows and notifications, and to use a clean folder or browser profile.
- The project folder: a new one per demo (`record` creates it).
```

In the same file, replace:

```markdown
`cuttle -C "<project>" --json transcribe --language de` transcribes again (`--model` picks one).
Transcribing also writes a cleaned-up mic (less noise, even loudness) that the video plays.

**Subtitles.** A transcribed take gets subtitles in the video (`captions`, project.md): as
subtitles at the bottom, `karaoke` (the spoken word in colour) or `bold` (a few big words, for
9:16). `cuttle -C "<project>" transcript --text` prints what was said; `--srt` the subtitles on
```

with:

```markdown
`cuttle -C "<project>" --json transcribe --language de` transcribes again (`--model` picks one).
Transcribing also writes a cleaned-up mic (less noise, even loudness) that the video plays.

**Slips.** The mistake key (Ctrl+Shift+Alt+X, or the scissors in the recording bar) marks a slip
in `markers.json` (kind `retake`). A spoken cue counts too when the bit is then said again ("…die
Art. Nochmal. Die App erkennt die Art …"; also "noch mal", "again", "one more time"). `suggest`
cuts each slip from the pause before it to where the bit starts again (cuts tagged `retake`,
"Retake" or "Retake: “Nochmal”"); the key needs no speech model. Check each with `preview --at`
just before and after the cut; if it took too much or too little, move its `from` or `to` and
remove its `auto`.

**Subtitles.** A transcribed take gets subtitles in the video (`captions`, project.md): as
subtitles at the bottom, `karaoke` (the spoken word in colour) or `bold` (a few big words, for
9:16). `cuttle -C "<project>" transcript --text` prints what was said; `--srt` the subtitles on
```

In `skill/cuttle/project.md`, replace:

```markdown
`cuts` take a stretch out of whatever clip covers it, without splitting the clip: `from` and `to`
(source seconds) and `enabled` (`true`). The video jumps there (no crossfade); zooms, masks and
texts run on across it. Use them for a slip, a filler or a pause inside a clip; `suggest` makes
them for filler words ("Filler: äh") and pauses ("Pause: 2.4 s") from the transcript.

Every scene, zoom, mask, text and cut may have an `id` (1 to 64 letters, digits, `-` or `_`,
unique in the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest`
```

with:

```markdown
`cuts` take a stretch out of whatever clip covers it, without splitting the clip: `from` and `to`
(source seconds) and `enabled` (`true`). The video jumps there (no crossfade); zooms, masks and
texts run on across it. Use them for a slip, a filler or a pause inside a clip; `suggest` makes
them for slips ("Retake": the mistake key, or a spoken "nochmal" with the bit said again), filler
words ("Filler: äh") and pauses ("Pause: 2.4 s") from the transcript.

Every scene, zoom, mask, text and cut may have an `id` (1 to 64 letters, digits, `-` or `_`,
unique in the whole project) and a `label` (a name for people, shown in the Cuttle app). `suggest`
```

In the same file, replace:

```markdown
- `cuttle --json frame <source second> --grid` writes that frame of the screen track at full size
  with a numbered grid every 100 pixels (stronger lines every 500). Read the PNG and take rects off
  the grid; `frames/<t>s-grid.png` is the default file.
- `takes/<n>/markers.json` lists the prompt, each tool call and Claude's answer in source seconds.
- `cuttle --json suggest` prints notes with source seconds (`sped up 112.9 s without input 12×
  (7.5–120.4 s)`).
- To get from output to source seconds by hand, walk the scenes. A clip lasts
```

with:

```markdown
- `cuttle --json frame <source second> --grid` writes that frame of the screen track at full size
  with a numbered grid every 100 pixels (stronger lines every 500). Read the PNG and take rects off
  the grid; `frames/<t>s-grid.png` is the default file.
- `takes/<n>/markers.json` lists the prompt, each tool call and Claude's answer in source seconds,
  and each press of the mistake key (kind `retake`).
- `cuttle --json suggest` prints notes with source seconds (`sped up 112.9 s without input 12×
  (7.5–120.4 s)`).
- To get from output to source seconds by hand, walk the scenes. A clip lasts
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run --project node skill/test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add skill
git commit -m "skill: slips (the mistake key and a spoken \"nochmal\")

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The end-to-end check

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The checks**

A new check presses the scissors with the test backend: the hint fits the HUD, the marker is in `markers.json`, the cut goes back from it, and once the cut is in the editor, its notch selects as "Retake" and the Auto tab has its row. The speech check's spoken take now has its retake ("Again."):

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 120_000);

  it('restarts from the HUD on a held press only: the take is put aside, and Undo restart brings it back', async () => {
    const before = new Set(readdirSync(join(root, 'projects')));
    await recordThroughPicker(pillRecord, { stop: 'none' }, false);
```

with:

```ts
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 120_000);

  it('marks a slip from the HUD (the mistake key): it says what to do next, and the cut goes back from there', async () => {
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    await recordThroughPicker(pillRecord, { stop: 'none', camera: undefined }, false);
    const hud = await runningHud();
    await wait(2500);
    await click(hud, '[data-testid=hud-retake]');
    await expect.poll(() => hud.locator('[data-testid=hud-note]').textContent(), { timeout: 5_000 }).toBe('Slip marked: do it again');
    // the hint fits the HUD whole
    expect(await hud.evaluate(() => [...document.querySelectorAll('[data-testid=hud-note], [data-testid=hud-note] *')].every((element) => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
    await shotOf('31-hud-retake', '/hud.html');
    await click(hud, '[data-testid=hud-stop]');
    const dir = await newProject(before);
    const written = (await projectWhen(dir, (file) => file.scenes[0]?.id !== undefined)) as unknown as { cuts?: { to: number; auto?: string; label?: string }[] };
    const { markers } = JSON.parse(readFileSync(join(dir, 'takes', '1', 'markers.json'), 'utf8')) as { markers: { t: number; kind: string }[] };
    const slip = markers.find((marker) => marker.kind === 'retake');
    expect(slip?.t).toBeGreaterThan(2);
    // no speech in this take: the cut goes back 5 s at most (not before the clip) to just past the key
    expect((written.cuts ?? []).filter((cut) => cut.auto === 'retake')).toEqual([expect.objectContaining({ label: 'Retake', to: expect.closeTo(slip!.t + 0.15, 2) })]);
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${basename(dir)} · Cuttle`);
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    // once Cuttle's cut is in, the slip is a notch (its pin lies in the cut), and a row in the Auto tab
    await expect.poll(() => opened.evaluate(() => (window as unknown as { __cuttleCheck: Check }).__cuttleCheck.doc().undo), { timeout: 15_000 }).toBe("Cuttle's cut");
    await click(opened, '[data-testid=cut-notch]');
    await opened.waitForSelector('[data-testid=auto-note]');
    expect(await opened.locator('.inspector .kind-head .name').textContent()).toBe('Retake');
    await click(opened, '#tab-auto');
    expect(await opened.locator('[data-testid=auto-group-retakes] .auto-count').textContent()).toBe('1 on');
  }, 120_000);

  it('restarts from the HUD on a held press only: the take is put aside, and Undo restart brings it back', async () => {
    const before = new Set(readdirSync(join(root, 'projects')));
    await recordThroughPicker(pillRecord, { stop: 'none' }, false);
```

In the same file, replace:

```ts
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
```

with:

```ts
    const cuts = file().cuts ?? [];
    const fillers = cuts.filter((cut) => cut.auto === 'filler').length;
    const pauses = cuts.filter((cut) => cut.auto === 'pause').length;
    expect(fillers).toBeGreaterThanOrEqual(1);
    expect(pauses).toBeGreaterThanOrEqual(1);
    // "Uh" at 2.02 s is gone from the video, and "Um, it zooms on clicks. Again." (7.55 to 10.8 s)
    // with it: a slip said again
    expect(cuts.filter((cut) => cut.auto === 'retake')).toEqual([expect.objectContaining({ label: 'Retake: “Again”' })]);
    for (const at of [2.1, 7.7, 9, 10.5]) expect(cuts.some((cut) => cut.from <= at && at < cut.to), `a cut at ${at} s`).toBe(true);
    await page.waitForSelector('[data-testid=auto-group-fillers]');
    await page.waitForSelector('[data-testid=speech-note]', { state: 'detached' });
    expect(await page.locator('[data-testid=auto-group-fillers] .auto-count').textContent()).toBe(`${fillers} on`);
    expect(await page.locator('[data-testid=auto-group-pauses] .auto-count').textContent()).toBe(`${pauses} on`);
    expect(await page.locator('[data-testid=auto-group-retakes] .auto-count').textContent()).toBe('1 on');
    const pageDoc = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.doc());
    expect((await pageDoc()).undo).toBe("Cuttle's speech edits");
    expect((await pageDoc()).toast?.text).toBe(`Cuttle cut 1 retake, and ${fillers} filler word${fillers === 1 ? '' : 's'} and ${pauses} pause${pauses === 1 ? '' : 's'} where the picture rests.`);
    expect(await page.locator('[data-testid=project-status]').count()).toBe(0);
    // the video is shorter by the cuts, in the player and the title bar
    const removed = cuts.reduce((sum, cut) => sum + (cut.to - cut.from), 0);
```

- [ ] **Step 2: Run it, with screenshots, and look at them**

```bash
mkdir -p "$TEMP/cuttle-p4m3-shots"
CUTTLE_HIDDEN=1 CUTTLE_RECORDER_BACKEND=test CUTTLE_CHECK_SHOTS="$TEMP/cuttle-p4m3-shots" pnpm app:check
```

Expected: PASS, 41 tests. Look at `27-speech-edits` (the Auto tab: a retake, a filler, two pauses) and `31-hud-retake` (the scissors between restart and the flag).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/app.check.test.ts
git commit -m "desktop: app:check presses the HUD's scissors, and finds the spoken take's retake

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

- [ ] **Step 1: All tests, the typecheck, the CLI and the packaged build**

Run: `pnpm test`
Expected: PASS, 597 passed and 51 skipped (on a machine without a speech model the real transcription is skipped too: 596 and 52).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 5 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Record a take with the mic. Say a sentence, slip on the next, press Ctrl+Shift+Alt+X (or the scissors), and say it again. The HUD says "Slip marked: do it again". Once the take is cut, the slip is gone, from the pause before it to the repeat.
2. Record another: slip, pause, say "Nochmal.", pause, say the sentence again. Once it is transcribed, the Auto tab lists `Retake: “Nochmal”`; switch it off and on and play it.
3. Say "Klick es nochmal an" in a sentence: nothing is cut there.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran once, on the prototype, whose tree the replay matches byte for byte: the task steps' tests, `pnpm test`, the typecheck, `app:check` and `cli:check`, with every screenshot looked at. The packaged build (`pnpm app:build`) ran on the replayed commits.

**Found while checking, and already in the plan above**
- **The spec's cue rule missed the English fixture.** "Um, it zooms on clicks. Again. It zooms on every click" repeats 3 of the 8 words before the cue (37 %): the window took in "video for you" from the sentence before. And "Click it again. Click it and save." passed it. The cue now has to start a phrase, and the repeat has to match the slip's start word for word.
- **The pause after the key stayed in the video.** A pause cut that overlapped a retake was dropped, so the silence between the key and the repeat was kept. A filler or pause cut that touches a retake now joins it.
- **The HUD's "Cut back to 0:12" did not fit**, and the cut's start is not known while recording (the pause comes from the speech, after the take). The HUD says "Slip marked: do it again", which fits (125 of 141 px) and says what to do next; a check measures it.
- **`suggest --no-speech` dropped the key's retakes too.** The spec keeps everything but the spoken ones: the key's cuts are made, 5 s back.
- **The speech step's toast** named only fillers and pauses; it names the retakes now, as its status does.
- **A retake pin was named "Tool"** (the default of `pinGroupName`); it is "Retake".
- **The new app check looked for the pin**, and found it alone only because the editor showed the uncut take first; in the full run the cut was in, and the pin (inside the cut) was gone. It now waits for Cuttle's cut and selects the notch.
- **The model-gated spoken take** found the retake (5.62 to 11.0 s of the screen), but whisper's base model put "It" at 10.85 s, right after "Again", where the voice says it at 11.85 s. The test checks against the fixture's true times.
- **A recorder timing test wobbled** under the full run's load ("cancels … during the countdown": the stop at 500 ms came after the second tick). It passed three times in a row alone, and its code is unchanged.

- **The macOS branch** (`macos-support`) maps its hotkeys in `MAC_HOTKEYS`; it needs `[0x07, 'retake']` (X) when it merges this.

**Spec points that move**
- **The HUD's flash** says "Slip marked: do it again" instead of "Cut back to 0:12" (above).
- **The cue rule** is a word-for-word repeat of the slip's start after a cue that starts a phrase, instead of 40 % of the 8 words before it (above). "let me redo" is "let me redo that"; "von vorne" and "again from the top" join the cues.
- **The cut** runs on to the repeat when the pause after the key is cut, instead of always ending 0.15 s after the key.

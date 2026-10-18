# Cuttle P5-M4b: Live Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a take with a mic records, the HUD shows what the mic hears, about two seconds after it is said (the roadmap's "live captions in the HUD while recording"):
- **In the HUD:** a line under the bar, the newest words at its right end, the older ones fading out at its left. "Listening…" until the first words; dimmed while the take does not record.
- **In the settings:** "Live captions while recording", on by default; they run once a speech model is downloaded, with the fastest one there. Nothing of them is saved.

**Architecture:**
- **`@cuttle/recorder`:**
  - `record` hands the mic's 16 kHz samples (P5-M4a's, on the capture's stdout) to a new `onAudio` option while the take records, as whole samples.
  - A "Spoken Test Microphone" plays a sound file, for the checks.
- **`@cuttle/core`:** `liveCaptions` transcribes the samples pushed to it.
  - With ffmpeg's whisper filter, one ffmpeg reads them on its stdin and writes each word to its stdout as soon as it has transcribed a two-second window.
  - With whisper-cli (macOS), a whisper run per window of three to five seconds, cut where the sound is quietest.
- **The app:**
  - The main process asks for live captions when a take with a mic starts.
  - The recorder host (a utility process) runs them beside `record` and sends the words back.
  - The main process passes them to the HUD (`hud:caption`), which draws the line.

**Tech Stack:** TypeScript strict, ffmpeg 8 (its `whisper` filter) or whisper.cpp's `whisper-cli`, React 19, Electron 44.7.2.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-roadmap-p4-p6.md` (P5-M4: "Live captions in the HUD while recording, with a mic level (also a check that the mic works)"). P5-M4a made the level; this milestone makes the live captions. Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m4a-mic-level.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m4b`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The tests that transcribe for real run where a speech model is downloaded (`CUTTLE_TEST_MODELS`, else the user's models folder: `%LOCALAPPDATA%\Cuttle\models`, or `~/Library/Application Support/Cuttle/models` on macOS) and ffmpeg has the whisper filter. Elsewhere they are skipped. They only read the folder.
- The full `pnpm test` and the typecheck run in Task 4.

## Decisions made while planning

A prototype of the milestone, checked against the roadmap, settled these points. The finished prototype passed `pnpm test` (947 tests, 79 skipped, in two full runs), the typecheck, `app:check` (58 tests) and `cli:check` (15). Every screenshot was looked at.

- **The samples come from the mic's own capture:**
  - They are P5-M4a's 16 kHz mono 16-bit samples, which the capture already writes to its stdout for the level.
  - `record` hands them to `onAudio` while the take records (not while paused). They are whole samples: a pipe's chunk may end inside one, and its odd byte waits for the next chunk.
  - Each capture (a pause ends one) gets its own count, so a chunk dropped before the take records never shifts the bytes after it.
  - An `onAudio` that throws gets no more samples. The take goes on and says so in its warnings.
- **Streaming with ffmpeg's whisper filter** (Windows: Gyan's ffmpeg):
  - One ffmpeg reads the samples on its stdin (`-f s16le -ar 16000 -ac 1 -i pipe:0`).
  - It writes each word to its stdout (`destination=pipe\:1`, `format=json`, `max_len=1`) as soon as it has transcribed a window of `queue=2` seconds.
  - Tried on the English fixture, words arrive about two seconds after they are said. Twelve seconds of noise and six of silence gave no words at all.
- **whisper-cli (macOS) reads files only:**
  - The samples go to it in windows of 3 to 5 s, each cut in the middle of the quietest tenth of a second between 3 and 5 s, so a word is rarely cut in two.
  - One run at a time (`runWhisper` on a WAV file). When whisper is behind, a window that waits is dropped for the newer one.
  - The same windows can be asked for with ffmpeg (`mode: 'windows'`), which is how they are tested here.
- **The captions stay current:** sound that would wait more than 4 s for whisper is dropped. When whisper is slower than speech, some words are missed rather than all shown later and later.
- **A word heard twice at a window's edge** ("you. you."), starting within 0.3 s of its first end, is dropped. A word said twice ("that that") is not.
- **The fastest model downloaded:** `base` (Fast) if it is there, else `small`, else `large-v3-turbo-q5_0`.
  - The captions must keep up with speech.
  - On the fixture, `base` was also the more accurate at two-second windows: `small` made up words at their edges ("a lot of time").
  - The language is the transcription's (Auto, Deutsch, English).
- **Failures:** a whisper that fails (or none) ends the captions with a note in the HUD's line ("Live captions stopped", the reason in its tooltip). The take goes on.
- **The recorder host runs them:**
  - The utility process that runs `record` also runs `liveCaptions`, so the samples never cross to the main process.
  - It sends the words back as they come (`live`), and stops the captions when the take stops.
- **The HUD:**
  - Its window is 38 DIP taller (102 instead of 64) when the take has live captions.
  - A line under the bar, as wide as it, keeps the last 24 words; each word keeps its key, so only new words fade in.
  - The newest words sit at the right end, and the older ones fade out over the left 48 px. The line is dimmed while the take does not record.
  - Its tooltip says that nothing of it is saved. Words are not kept anywhere: the take's transcript comes from the transcription after the cut, as before.
- **The setting:** "Live captions while recording", on by default (`speech.live`). Without a speech model the row says that it needs one.
- **Not in `cuttle record`:** Claude reads the take's transcript after the cut; a line per word in its output would not help it.

## File structure

| File | Responsibility |
|---|---|
| `packages/recorder/src/{level,record,types,sources,index}.ts` | the samples to `onAudio`, the spoken test mic |
| `packages/core/src/speech/live.ts`, `packages/core/src/index.ts` | the live captions |
| `apps/desktop/src/shared/{recording,ipc,channels}.ts`, `apps/desktop/src/main/{recorder-host,recording,speech,settings,settings-window}.ts`, `apps/desktop/src/workers/recorder.ts` | asking for them, running them in the recorder host, passing the words on |
| `apps/desktop/src/renderer/picker/{Hud.tsx,picker.css}`, `apps/desktop/src/renderer/settings/Settings.tsx` | the HUD's line, the setting |
| `README.md` | the guide |

---

### Task 1: The mic's samples for whoever listens, and a spoken test mic

**Files:**
- Modify: `packages/recorder/src/level.ts`, `packages/recorder/src/record.ts`, `packages/recorder/src/types.ts`, `packages/recorder/src/sources.ts`, `packages/recorder/src/index.ts`, `packages/recorder/test/level.test.ts`, `packages/recorder/test/sources.test.ts`, `packages/recorder/test/record.test.ts`, `apps/cli/test/cli.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m4b`; work there:

```bash
git switch p5-m4b
```

- [ ] **Step 2: Write the failing tests**

In `packages/recorder/test/level.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { levelMeter, PCM_RATE, type MicLevel } from '../src/level';

/** `seconds` of a sine at `amplitude` (of full scale) as 16-bit little-endian samples. */
function sine(seconds: number, amplitude: number): Uint8Array {
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { levelMeter, PCM_RATE, wholeSamples, type MicLevel } from '../src/level';

/** `seconds` of a sine at `amplitude` (of full scale) as 16-bit little-endian samples. */
function sine(seconds: number, amplitude: number): Uint8Array {
```

In the same file, replace:

```ts
  return bytes;
}

describe('levelMeter', () => {
  it('tells the RMS and the peak in dBFS for every tenth of a second', () => {
    const levels: MicLevel[] = [];
```

with:

```ts
  return bytes;
}

describe('wholeSamples', () => {
  it("hands on whole samples only, keeping a chunk's odd byte for the next", () => {
    const sound = sine(0.01, 1 / 2);
    const handed: Uint8Array[] = [];
    const align = wholeSamples((samples) => handed.push(samples.slice()));
    // three bytes at a time, and an empty chunk
    for (let i = 0; i < sound.length; i += 3) align(sound.subarray(i, i + 3));
    align(new Uint8Array(0));
    expect(handed.every((samples) => samples.length > 0 && samples.length % 2 === 0)).toBe(true);
    expect(Buffer.concat(handed)).toEqual(Buffer.from(sound));
  });
});

describe('levelMeter', () => {
  it('tells the RMS and the peak in dBFS for every tenth of a second', () => {
    const levels: MicLevel[] = [];
```

In `packages/recorder/test/sources.test.ts`, replace:

```ts
    expect(micInput('test', 'Silent Test Microphone')[3]).toBe('anullsrc=r=48000:cl=mono,arealtime');
  });

  it('opens DirectShow devices with a small mic buffer and corrects the mic start by it', () => {
    expect(webcamInput('windows', 'Cam')).toEqual(['-f', 'dshow', '-rtbufsize', '256M', '-i', 'video=Cam']);
    expect(micInput('windows', 'Mic (USB)')).toEqual(['-f', 'dshow', '-audio_buffer_size', '50', '-i', 'audio=Mic (USB)']);
```

with:

```ts
    expect(micInput('test', 'Silent Test Microphone')[3]).toBe('anullsrc=r=48000:cl=mono,arealtime');
  });

  it('plays the sound file CUTTLE_TEST_SPEECH names as the spoken test mic, looped in real time', () => {
    const saved = process.env.CUTTLE_TEST_SPEECH;
    try {
      process.env.CUTTLE_TEST_SPEECH = 'C:/speech/en.m4a';
      expect(micInput('test', 'Spoken Test Microphone')).toEqual(['-re', '-stream_loop', '-1', '-i', 'C:/speech/en.m4a']);
      delete process.env.CUTTLE_TEST_SPEECH;
      expect(() => micInput('test', 'Spoken Test Microphone')).toThrow(expect.objectContaining({ code: 'device-not-found' }));
    } finally {
      if (saved === undefined) delete process.env.CUTTLE_TEST_SPEECH;
      else process.env.CUTTLE_TEST_SPEECH = saved;
    }
  });

  it('opens DirectShow devices with a small mic buffer and corrects the mic start by it', () => {
    expect(webcamInput('windows', 'Cam')).toEqual(['-f', 'dshow', '-rtbufsize', '256M', '-i', 'video=Cam']);
    expect(micInput('windows', 'Mic (USB)')).toEqual(['-f', 'dshow', '-audio_buffer_size', '50', '-i', 'audio=Mic (USB)']);
```

In `packages/recorder/test/record.test.ts`, replace:

```ts
  return { ...streams[0], duration: Number(format.duration) };
}

const read = (projectDir: string, file: string) => readFileSync(join(projectDir, file), 'utf8');

function markersOf(projectDir: string, file: string) {
```

with:

```ts
  return { ...streams[0], duration: Number(format.duration) };
}

/** A spoken sentence, for the spoken test mic. */
const SPEECH = join(import.meta.dirname, '..', '..', 'core', 'test', 'fixtures', 'speech', 'en.m4a');

const read = (projectDir: string, file: string) => readFileSync(join(projectDir, file), 'utf8');

function markersOf(projectDir: string, file: string) {
```

In the same file, replace:

```ts
    expect(new Set(levels)).toEqual(new Set([-90]));
  }, SLOW);

  it('turns a throwing onEvent into a warning instead of a failed take', async () => {
    const recording = record({
      ...test,
```

with:

```ts
    expect(new Set(levels)).toEqual(new Set([-90]));
  }, SLOW);

  it("hands the mic's samples to onAudio while it records: whole samples, as long as the take", async () => {
    const projectDir = project();
    const chunks: Uint8Array[] = [];
    let recordingSeen = false;
    let early = 0;
    const take = await record({
      ...test,
      projectDir,
      mic: 'Test Microphone',
      stop: { maxSeconds: 1.5 },
      onEvent: (event) => {
        if (event.type === 'recording') recordingSeen = true;
      },
      onAudio: (samples) => {
        if (!recordingSeen) early++;
        chunks.push(samples.slice());
      },
    }).done;
    expect(early).toBe(0);
    expect(chunks.every((samples) => samples.length % 2 === 0)).toBe(true);
    const seconds = chunks.reduce((sum, samples) => sum + samples.length, 0) / 2 / 16_000;
    expect(seconds).toBeGreaterThan(take.seconds - 0.5);
    expect(seconds).toBeLessThan(take.seconds + 0.5);
  }, SLOW);

  it('stops handing samples to an onAudio that throws, with a warning, and keeps the take', async () => {
    let calls = 0;
    const take = await record({
      ...test,
      projectDir: project(),
      mic: 'Test Microphone',
      stop: { maxSeconds: 1.5 },
      onAudio: () => {
        calls++;
        throw new Error('listener bug');
      },
    }).done;
    expect(calls).toBe(1);
    expect(take.mic).toBe('takes/1/mic.m4a');
    expect(take.warnings).toEqual(['onAudio failed: listener bug']);
  }, SLOW);

  it('records the spoken test mic: the sound file CUTTLE_TEST_SPEECH names, looped', async () => {
    process.env.CUTTLE_TEST_SPEECH = SPEECH;
    const levels: number[] = [];
    const take = await record({
      ...test,
      projectDir: project(),
      mic: 'Spoken Test Microphone',
      stop: { maxSeconds: 2 },
      onEvent: (event) => event.type === 'level' && levels.push(event.rms),
    }).done;
    expect(take.warnings).toEqual([]);
    expect(take.mic).toBe('takes/1/mic.m4a');
    // speech: loud and quiet tenths of a second
    expect(Math.max(...levels)).toBeGreaterThan(-35);
    expect(Math.min(...levels)).toBeLessThan(Math.max(...levels) - 10);
  }, SLOW);

  it('turns a throwing onEvent into a warning instead of a failed take', async () => {
    const recording = record({
      ...test,
```

In `apps/cli/test/cli.test.ts`, replace:

```ts
        "mics": [
          "Test Microphone",
          "Silent Test Microphone",
        ],
        "monitors": [
          {
```

with:

```ts
        "mics": [
          "Test Microphone",
          "Silent Test Microphone",
          "Spoken Test Microphone",
        ],
        "monitors": [
          {
```

Run: `pnpm exec vitest run --project node packages/recorder/test/level.test.ts packages/recorder/test/sources.test.ts`
Expected: FAIL: there is no `wholeSamples`, and no spoken test mic.

- [ ] **Step 3: Whole samples, `onAudio`, the spoken test mic**

In `packages/recorder/src/level.ts`, replace:

```ts
// The mic's level while it records, from its sound as 16 kHz mono 16-bit samples (the mic's capture
// writes them to its stdout beside the track): how loud it is (RMS) and its loudest sample, in dB
// below full scale, every tenth of a second. Pure.

/** The rate of the samples the mic's capture gives (16 kHz mono, as speech recognition takes them too). */
export const PCM_RATE = 16_000;
```

with:

```ts
// The mic's level while it records, from its sound as 16 kHz mono 16-bit samples (the mic's capture
// writes them to its stdout beside the track): how loud it is (RMS) and its loudest sample, in dB
// below full scale, every tenth of a second. The samples themselves go to whoever listens (live
// captions) as whole samples. Pure.

/** The rate of the samples the mic's capture gives (16 kHz mono, as speech recognition takes them too). */
export const PCM_RATE = 16_000;
```

In the same file, replace:

```ts

const decibels = (value: number) => (value <= 0 ? LEVEL_FLOOR : Math.max(LEVEL_FLOOR, Math.round(20 * Math.log10(value) * 10) / 10));

/**
 * Takes the samples as they come (a chunk may end inside a sample) and calls `onLevel` once for each
 * tenth of a second of them.
```

with:

```ts

const decibels = (value: number) => (value <= 0 ? LEVEL_FLOOR : Math.max(LEVEL_FLOOR, Math.round(20 * Math.log10(value) * 10) / 10));

/**
 * Hands on the samples as whole samples: a chunk from a pipe may end inside one, so its odd byte is
 * kept for the next chunk. `onSamples` gets each chunk's whole samples (none for an empty chunk).
 */
export function wholeSamples(onSamples: (samples: Uint8Array) => void): (chunk: Uint8Array) => void {
  let half: number | undefined;
  return (chunk) => {
    let bytes = chunk;
    if (half !== undefined && chunk.length > 0) {
      bytes = new Uint8Array(chunk.length + 1);
      bytes[0] = half;
      bytes.set(chunk, 1);
      half = undefined;
    }
    const even = bytes.length - (bytes.length % 2);
    if (even < bytes.length) half = bytes[even];
    if (even > 0) onSamples(bytes.subarray(0, even));
  };
}

/**
 * Takes the samples as they come (a chunk may end inside a sample) and calls `onLevel` once for each
 * tenth of a second of them.
```

In the same file, replace:

```ts
  let sum = 0;
  let peak = 0;
  let count = 0;
  let half: number | undefined;
  return (chunk) => {
    let i = 0;
    const take = (sample: number) => {
      const value = sample / 32768;
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
      if (++count < size) return;
      onLevel({ rms: decibels(Math.sqrt(sum / count)), peak: decibels(peak) });
      sum = 0;
      peak = 0;
      count = 0;
    };
    if (half !== undefined && chunk.length > 0) {
      take(((chunk[0]! << 8) | half) << 16 >> 16);
      half = undefined;
      i = 1;
    }
    for (; i + 1 < chunk.length; i += 2) take(((chunk[i + 1]! << 8) | chunk[i]!) << 16 >> 16);
    if (i < chunk.length) half = chunk[i]!;
  };
}
```

with:

```ts
  let sum = 0;
  let peak = 0;
  let count = 0;
  return wholeSamples((samples) => {
    for (let i = 0; i < samples.length; i += 2) {
      const value = ((((samples[i + 1]! << 8) | samples[i]!) << 16) >> 16) / 32768;
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
      if (++count < size) continue;
      onLevel({ rms: decibels(Math.sqrt(sum / count)), peak: decibels(peak) });
      sum = 0;
      peak = 0;
      count = 0;
    }
  });
}
```

In `packages/recorder/src/types.ts`, replace:

```ts
   */
  steps?: string[];
  onEvent?: (event: RecorderEvent) => void;
}

export type StopReason = 'stop' | 'hotkey' | 'max-seconds' | 'file' | 'idle' | 'claude';
```

with:

```ts
   */
  steps?: string[];
  onEvent?: (event: RecorderEvent) => void;
  /**
   * The mic's sound while the take records (nothing while paused), as it comes: 16 kHz mono 16-bit
   * little-endian samples, whole samples. Live captions read it. One that throws gets no more, and
   * the take says so in its warnings.
   */
  onAudio?: (samples: Uint8Array) => void;
}

export type StopReason = 'stop' | 'hotkey' | 'max-seconds' | 'file' | 'idle' | 'claude';
```

In `packages/recorder/src/record.ts`, replace:

```ts
import { spawnCapture, type CaptureProcess } from './ffmpeg';
import { captureHelper, helperArgs, helperInput } from './mac-capture';
import { startInput, type InputSource } from './input';
import { levelMeter } from './level';
import { FPS as JOIN_FPS, joinSegments, mediaInfo, renameWhenFree } from './join';
import { areaGeometry, checkDevice, deviceClock, micInput, micLatency, platformFor, resolveArea, screenFilter, screenInput, screenLatency, webcamInput, type CameraMode, type Platform, type ScreenArea } from './sources';
import type { Bounds, RawInput, RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';
```

with:

```ts
import { spawnCapture, type CaptureProcess } from './ffmpeg';
import { captureHelper, helperArgs, helperInput } from './mac-capture';
import { startInput, type InputSource } from './input';
import { levelMeter, wholeSamples } from './level';
import { FPS as JOIN_FPS, joinSegments, mediaInfo, renameWhenFree } from './join';
import { areaGeometry, checkDevice, deviceClock, micInput, micLatency, platformFor, resolveArea, screenFilter, screenInput, screenLatency, webcamInput, type CameraMode, type Platform, type ScreenArea } from './sources';
import type { Bounds, RawInput, RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';
```

In the same file, replace:

```ts
  };

  let micWarned = false;
  // macOS: ScreenCaptureKit through the helper, which leaves out the app's own windows; avfoundation without it
  const helper = platform === 'macos' ? captureHelper() : undefined;
  // macOS: the camera's and the mic's starts are their capture times on the host clock, mapped to the wall clock
```

with:

```ts
  };

  let micWarned = false;
  let audioFailed = false;
  // macOS: ScreenCaptureKit through the helper, which leaves out the app's own windows; avfoundation without it
  const helper = platform === 'macos' ? captureHelper() : undefined;
  // macOS: the camera's and the mic's starts are their capture times on the host clock, mapped to the wall clock
```

In the same file, replace:

```ts
      ? spawnCapture('screen', screenArgs(helperInput(area), file(FILES.screen), options.stop.untilIdleSeconds), { command: helper, args: helperArgs(area, drawMouse, options.hideWindowsOf ?? []) })
      : spawnCapture('screen', screenArgs(screenInput(platform, area, drawMouse), file(FILES.screen), options.stop.untilIdleSeconds, screenFilter(platform, area)));
    const webcam = options.webcam === undefined ? undefined : spawnCapture('webcam', webcamArgs(webcamInput(platform, options.webcam, cameraMode), file(FILES.webcam), !ownStamps));
    // the mic's level, told while the take records
    const level = levelMeter((heard) => capturing && reporter.emit({ type: 'level', ...heard }));
    const mic = options.mic === undefined ? undefined : spawnCapture('mic', micArgs(micInput(platform, options.mic), file(FILES.mic), !ownStamps), undefined, level);
    // Rejects with the first capture that fails; `exited` only resolves after stop() was called.
    const failed: Promise<never> = Promise.race([screen, webcam, mic].filter((capture) => capture !== undefined).map((capture) => capture.exited)).then(() => new Promise<never>(() => {}));
    failed.catch(() => {});
```

with:

```ts
      ? spawnCapture('screen', screenArgs(helperInput(area), file(FILES.screen), options.stop.untilIdleSeconds), { command: helper, args: helperArgs(area, drawMouse, options.hideWindowsOf ?? []) })
      : spawnCapture('screen', screenArgs(screenInput(platform, area, drawMouse), file(FILES.screen), options.stop.untilIdleSeconds, screenFilter(platform, area)));
    const webcam = options.webcam === undefined ? undefined : spawnCapture('webcam', webcamArgs(webcamInput(platform, options.webcam, cameraMode), file(FILES.webcam), !ownStamps));
    // the mic's level and its samples, while the take records (whole samples per capture: one that
    // stops at a pause may end inside a sample)
    const level = levelMeter((heard) => capturing && reporter.emit({ type: 'level', ...heard }));
    const samples = wholeSamples((heard) => {
      if (!capturing || audioFailed || !options.onAudio) return;
      try {
        options.onAudio(heard);
      } catch (error) {
        audioFailed = true;
        reporter.warn(`onAudio failed: ${message(error)}`);
      }
    });
    const sound = (chunk: Uint8Array) => {
      level(chunk);
      samples(chunk);
    };
    const mic = options.mic === undefined ? undefined : spawnCapture('mic', micArgs(micInput(platform, options.mic), file(FILES.mic), !ownStamps), undefined, sound);
    // Rejects with the first capture that fails; `exited` only resolves after stop() was called.
    const failed: Promise<never> = Promise.race([screen, webcam, mic].filter((capture) => capture !== undefined).map((capture) => capture.exited)).then(() => new Promise<never>(() => {}));
    failed.catch(() => {});
```

In `packages/recorder/src/sources.ts`, replace:

```ts
/**
 * The test backend's devices. Monitor 0 shows a moving test pattern; monitor 1 moves for 1 s and
 * then stands still (for `untilIdleSeconds`). "Silent Test Microphone" delivers digital silence;
 * "Failing Test Camera" ends after 1 s, like a camera that is unplugged.
 */
export const TEST_DEVICES: Devices = {
```

with:

```ts
/**
 * The test backend's devices. Monitor 0 shows a moving test pattern; monitor 1 moves for 1 s and
 * then stands still (for `untilIdleSeconds`). "Silent Test Microphone" delivers digital silence;
 * "Spoken Test Microphone" plays the sound file CUTTLE_TEST_SPEECH names, over and over;
 * "Failing Test Camera" ends after 1 s, like a camera that is unplugged.
 */
export const TEST_DEVICES: Devices = {
```

In the same file, replace:

```ts
  ],
  windows: [{ id: 1001, pid: 4242, className: 'TestWindow', title: 'Test Window', bounds: { x: 100, y: 60, width: 640, height: 360 }, monitor: 0 }],
  cameras: ['Test Camera', 'Failing Test Camera'],
  mics: ['Test Microphone', 'Silent Test Microphone'],
};

/** What the screen track captures: a monitor, optionally cropped (monitor pixels, even sizes). */
```

with:

```ts
  ],
  windows: [{ id: 1001, pid: 4242, className: 'TestWindow', title: 'Test Window', bounds: { x: 100, y: 60, width: 640, height: 360 }, monitor: 0 }],
  cameras: ['Test Camera', 'Failing Test Camera'],
  mics: ['Test Microphone', 'Silent Test Microphone', 'Spoken Test Microphone'],
};

/** What the screen track captures: a monitor, optionally cropped (monitor pixels, even sizes). */
```

In the same file, replace:

```ts
/** Whether the camera and the mic keep the device's own timestamps (macOS) instead of the wall clock's at arrival. */
export const deviceClock = (platform: Platform) => platform === 'macos';

export function micInput(platform: Platform, name: string): string[] {
  if (platform === 'test') {
    const source = name === 'Silent Test Microphone' ? 'anullsrc=r=48000:cl=mono' : 'sine=frequency=440:sample_rate=48000';
    return ['-f', 'lavfi', '-i', `${source},arealtime`];
  }
```

with:

```ts
/** Whether the camera and the mic keep the device's own timestamps (macOS) instead of the wall clock's at arrival. */
export const deviceClock = (platform: Platform) => platform === 'macos';

/** The spoken test mic: the file CUTTLE_TEST_SPEECH names, in real time and looped. */
function spokenInput(): string[] {
  const file = process.env.CUTTLE_TEST_SPEECH;
  if (!file) throw new RecorderError('device-not-found', 'the Spoken Test Microphone plays the sound file CUTTLE_TEST_SPEECH names, and it is not set');
  return ['-re', '-stream_loop', '-1', '-i', file];
}

export function micInput(platform: Platform, name: string): string[] {
  if (platform === 'test') {
    if (name === 'Spoken Test Microphone') return spokenInput();
    const source = name === 'Silent Test Microphone' ? 'anullsrc=r=48000:cl=mono' : 'sine=frequency=440:sample_rate=48000';
    return ['-f', 'lavfi', '-i', `${source},arealtime`];
  }
```

In `packages/recorder/src/index.ts`, replace:

```ts
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
export { LEVEL_FLOOR, PCM_RATE, levelMeter, type MicLevel } from './level';
export { claudeTranscriptDir, readTranscriptLine, recentClaudeFolders, SessionReader, type ClaudeFolder, type ClaudeSignal } from './claude';
export { focusWindow } from './devices';
/** macOS's helper (native/macos/capture.swift), which also reads pictures' text (`cuttle-capture ocr`). */
```

with:

```ts
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
export { LEVEL_FLOOR, PCM_RATE, levelMeter, wholeSamples, type MicLevel } from './level';
export { claudeTranscriptDir, readTranscriptLine, recentClaudeFolders, SessionReader, type ClaudeFolder, type ClaudeSignal } from './claude';
export { focusWindow } from './devices';
/** macOS's helper (native/macos/capture.swift), which also reads pictures' text (`cuttle-capture ocr`). */
```

Run: `pnpm exec vitest run --project node packages/recorder apps/cli/test/cli.test.ts`
Expected: PASS (the test mic's samples as long as the take, a throwing `onAudio` warned about, the spoken mic loud and quiet by turns).

- [ ] **Step 4: Commit**

```bash
git add packages/recorder apps/cli/test/cli.test.ts
git commit -m "recorder: the mic's samples to onAudio while it records, and a spoken test mic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Live captions in `@cuttle/core`

**Files:**
- Create: `packages/core/src/speech/live.ts`, `packages/core/test/live.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

The window's cut and the edge's echo are pure. The real runs push the English fixture at twice its speed into each mode and look for its words. A model that is not there ends the captions once.

`packages/core/test/live.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normWord } from '@cuttle/project';
import { ffmpegPath, runFfmpeg } from '../src/ffmpeg';
import { LIVE_RATE, liveCaptions, quietestCut, withoutEchoes, type LiveMode } from '../src/speech/live';
import type { HeardWord } from '../src/speech/whisper';

/**
 * Real live captions run where a speech model is downloaded (`CUTTLE_TEST_MODELS`, else the user's
 * models folder; `base` first, the fastest) and ffmpeg has the whisper filter; they are skipped elsewhere.
 */
const modelsDir = process.env.CUTTLE_TEST_MODELS || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Cuttle', 'models') : join(homedir(), 'Library', 'Application Support', 'Cuttle', 'models'));
const model = ['base', 'small', 'large-v3-turbo-q5_0'].map((name) => join(modelsDir, `ggml-${name}.bin`)).find((file) => existsSync(file));
const whisper = / whisper /.test(spawnSync(ffmpegPath(), ['-hide_banner', '-filters'], { encoding: 'utf8', windowsHide: true }).stdout ?? '');
const SPEECH = join(import.meta.dirname, 'fixtures', 'speech', 'en.m4a');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `seconds` of 16 kHz samples: a sine at `amplitude` of full scale, or silence. */
function tone(seconds: number, amplitude: number): Uint8Array {
  const count = Math.round(seconds * LIVE_RATE);
  const bytes = new Uint8Array(count * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i++) view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 220 * i) / LIVE_RATE) * amplitude * 32767), true);
  return bytes;
}

const join2 = (...parts: Uint8Array[]) => Uint8Array.from(Buffer.concat(parts));

describe('quietestCut', () => {
  it('cuts a window in its quietest tenth of a second between 3 and 5 s', () => {
    const samples = join2(tone(3.6, 0.3), tone(0.1, 0.02), tone(0.1, 0), tone(1.6, 0.3));
    // the silence from 3.7 s: its tenth's middle, in bytes
    expect(quietestCut(samples) / 2 / LIVE_RATE).toBeCloseTo(3.75, 5);
  });

  it('takes the latest of equally quiet tenths, so a steady sound gets the longest window', () => {
    expect(quietestCut(tone(6, 0.3)) / 2 / LIVE_RATE).toBeCloseTo(4.95, 5);
  });
});

describe('withoutEchoes', () => {
  const word = (t: number, end: number, text: string): HeardWord => ({ t, end, text });

  it("drops a word heard again at a window's edge, and keeps a word said twice", () => {
    const last = word(9.7, 9.94, 'you.');
    expect(withoutEchoes([word(9.92, 10.42, 'you.'), word(10.5, 10.8, 'It')], last)).toEqual([word(10.5, 10.8, 'It')]);
    // "that that": the second starts well after the first ends
    expect(withoutEchoes([word(1, 1.2, 'that'), word(1.6, 1.8, 'that')], undefined)).toHaveLength(2);
    // a different word right after
    expect(withoutEchoes([word(9.92, 10.1, 'your')], last)).toEqual([word(9.92, 10.1, 'your')]);
  });
});

/** The spoken fixture as 16 kHz samples. */
async function spokenSamples(): Promise<Uint8Array> {
  const { stdout } = await runFfmpeg(['-i', SPEECH, '-ar', String(LIVE_RATE), '-ac', '1', '-f', 's16le', 'pipe:1']);
  return Uint8Array.from(stdout);
}

/** Pushes the samples at twice their speed (a fifth of a second every tenth), then 6 s of quiet. */
async function caption(mode: LiveMode): Promise<{ words: HeardWord[]; errors: Error[] }> {
  const samples = await spokenSamples();
  const words: HeardWord[] = [];
  const errors: Error[] = [];
  const live = liveCaptions({ model: model!, language: 'en', mode, onWords: (heard) => words.push(...heard), onError: (error) => errors.push(error) });
  const piece = LIVE_RATE * 2 * 0.2;
  for (let i = 0; i < samples.length; i += piece) {
    live.push(samples.subarray(i, i + piece));
    await sleep(100);
  }
  // then quiet, so the last window is heard
  for (let i = 0; i < 30; i++) {
    live.push(new Uint8Array(piece));
    await sleep(100);
  }
  live.stop();
  return { words, errors };
}

describe.runIf(model !== undefined && whisper)('liveCaptions (a real model)', () => {
  it.each<LiveMode>(['stream', 'windows'])('hears the spoken fixture as it is pushed (%s)', async (mode) => {
    const { words, errors } = await caption(mode);
    expect(errors).toEqual([]);
    const said = words.map((word) => normWord(word.text));
    for (const expected of ['screen', 'video', 'click', 'pauses']) expect(said).toContain(expected);
    // in the order said, in seconds of the sound pushed (18.7 s of speech)
    expect(words.every((word, i) => i === 0 || word.t >= words[i - 1]!.t - 0.5)).toBe(true);
    expect(words.at(-1)!.t).toBeLessThan(21);
  }, 90_000);

  it('tells once when whisper fails, and the captions end', async () => {
    const errors: Error[] = [];
    const live = liveCaptions({ model: join(modelsDir, 'no-such-model.bin'), language: 'en', onWords: () => {}, onError: (error) => errors.push(error) });
    for (let i = 0; i < 20 && errors.length === 0; i++) {
      live.push(tone(0.1, 0.1));
      await sleep(100);
    }
    live.push(tone(0.1, 0.1));
    live.stop();
    expect(errors).toEqual([expect.objectContaining({ code: 'invalid-media', message: expect.stringMatching(/^the live captions stopped/) })]);
  }, 30_000);
});
```

Run: `pnpm exec vitest run --project node packages/core/test/live.test.ts`
Expected: FAIL: there is no `../src/speech/live`.

- [ ] **Step 2: The live captions**

`packages/core/src/speech/live.ts`:

```ts
// Live captions: the mic's samples transcribed while a take records, each word about two seconds
// after it is said. With ffmpeg's whisper filter one ffmpeg reads the samples on its stdin and writes
// each word to its stdout as soon as it has transcribed a short window. whisper-cli (macOS) reads
// files only: the samples go to it in windows of a few seconds, each cut where the sound is quietest,
// one run at a time.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normWord } from '@cuttle/project';
import { CoreError } from '../errors';
import { ffmpegPath } from '../ffmpeg';
import { installedModels, type ModelName } from './models';
import { filterValue, NO_WHISPER, parseWhisperLines, runWhisper, whisperEngine, type HeardWord } from './whisper';

/** The samples' rate: 16 kHz mono 16-bit little-endian, as the mic's capture gives them. */
export const LIVE_RATE = 16_000;

export const LIVE_RULES = {
  /** The filter's window, in seconds of sound: shorter is sooner, longer understands more. */
  window: 2,
  /** whisper-cli's windows: cut between these seconds, in the quietest tenth of a second. */
  least: 3,
  most: 5,
  /** Seconds of sound that may wait for whisper: more is dropped, so the captions stay current. */
  behind: 4,
  /** A word heard again within this many seconds of itself is one word at a window's edge. */
  echo: 0.3,
} as const;

/** How the captions run: one ffmpeg that reads the samples as they come, or a whisper run per window. */
export type LiveMode = 'stream' | 'windows';

export interface LiveOptions {
  /** The model's file. */
  model: string;
  /** `auto`, or a language code such as `de` or `en`. */
  language: string;
  /** Default: `stream` with ffmpeg's whisper filter, `windows` with whisper-cli. */
  mode?: LiveMode;
  /** New words as they are heard, in seconds of the sound whisper was given. */
  onWords: (words: HeardWord[]) => void;
  /** Whisper failed, or this machine has none: the captions end (once), and the take goes on. */
  onError?: (error: Error) => void;
}

export interface LiveCaptions {
  /** Whole 16 kHz mono 16-bit samples, as the mic gives them. */
  push(samples: Uint8Array): void;
  /** Ends the captions; words still being transcribed are not waited for. */
  stop(): void;
}

interface Feed {
  push(samples: Uint8Array): void;
  stop(): void;
}

type Heard = (words: HeardWord[]) => void;
type Fail = (error: Error) => void;

const BYTES_PER_SECOND = LIVE_RATE * 2;

/** The model for live captions: the fastest one downloaded, since they must keep up with speech. */
export async function liveModel(): Promise<ModelName | undefined> {
  return (await installedModels())[0];
}

/**
 * Transcribes the samples pushed while it runs. Whisper is looked for first; samples pushed until
 * then wait (at most `LIVE_RULES.behind` seconds of them).
 */
export function liveCaptions(options: LiveOptions): LiveCaptions {
  let feed: Feed | undefined;
  let stopped = false;
  let failed = false;
  const waiting: Uint8Array[] = [];
  let last: HeardWord | undefined;
  const heard: Heard = (words) => {
    if (stopped || failed) return;
    const fresh = withoutEchoes(words, last);
    last = words.at(-1) ?? last;
    if (fresh.length > 0) options.onWords(fresh);
  };
  const fail: Fail = (error) => {
    if (stopped || failed) return;
    failed = true;
    feed?.stop();
    options.onError?.(error);
  };
  whisperEngine().then((engine) => {
    if (stopped || failed) return;
    if (!engine) return fail(new CoreError('ffmpeg-old', `there are no live captions: ${NO_WHISPER}`));
    const mode = options.mode ?? (engine.kind === 'filter' ? 'stream' : 'windows');
    feed = mode === 'stream' ? streamFeed(options, heard, fail) : windowFeed(options, heard, fail);
    for (const samples of waiting.splice(0)) feed.push(samples);
  }, fail);
  return {
    push(samples) {
      if (stopped || failed) return;
      if (feed) return feed.push(samples);
      waiting.push(samples);
      let bytes = waiting.reduce((sum, chunk) => sum + chunk.length, 0);
      while (bytes > LIVE_RULES.behind * BYTES_PER_SECOND) bytes -= waiting.shift()!.length;
    },
    stop() {
      stopped = true;
      feed?.stop();
    },
  };
}

/**
 * The words that are new: a word at a window's edge can be heard in both windows, the second time
 * starting within `LIVE_RULES.echo` seconds of the first's end.
 */
export function withoutEchoes(words: readonly HeardWord[], last: HeardWord | undefined): HeardWord[] {
  const fresh: HeardWord[] = [];
  let previous = last;
  for (const word of words) {
    const echo = previous !== undefined && normWord(word.text) === normWord(previous.text) && word.t - previous.end < LIVE_RULES.echo;
    if (!echo) fresh.push(word);
    previous = word;
  }
  return fresh;
}

/** ffmpeg's whisper filter on the samples as they come, its words on its stdout. */
function streamFeed(options: LiveOptions, heard: Heard, fail: Fail): Feed {
  const filter = [
    `whisper=model=${filterValue(options.model)}`,
    `language=${filterValue(options.language, false)}`,
    'format=json',
    `destination=${filterValue('pipe:1', false)}`,
    'max_len=1',
    `queue=${LIVE_RULES.window}`,
    'use_gpu=1',
  ].join(':');
  const args = ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(LIVE_RATE), '-ac', '1', '-i', 'pipe:0', '-af', filter, '-f', 'null', '-'];
  const child = spawn(ffmpegPath(), args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stopping = false;
  let lines = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    lines += chunk;
    const end = lines.lastIndexOf('\n');
    if (end < 0) return;
    heard(parseWhisperLines(lines.slice(0, end)));
    lines = lines.slice(end + 1);
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-2000)));
  child.stdin.on('error', () => {}); // ffmpeg ended: its exit says why
  child.on('error', (error: NodeJS.ErrnoException) =>
    fail(error.code === 'ENOENT' ? new CoreError('ffmpeg-missing', `ffmpeg was not found (looked for "${ffmpegPath()}")`) : error),
  );
  child.on('close', (code) => {
    if (stopping) return;
    const why = stderr.trim().split(/\r?\n/).slice(-3).join(' ');
    fail(new CoreError('invalid-media', `the live captions stopped (ffmpeg exit code ${code})${why ? `: ${why}` : ''}`));
  });
  return {
    push(samples) {
      // whisper is behind: the sound is dropped rather than heard later and later
      if (stopping || child.stdin.writableLength > LIVE_RULES.behind * BYTES_PER_SECOND) return;
      child.stdin.write(samples);
    },
    stop() {
      stopping = true;
      child.stdin.end();
      child.kill();
    },
  };
}

/**
 * A whisper run per window of a few seconds (whisper-cli reads files only): one at a time, and when
 * whisper is behind, a window waiting is dropped for the newer one.
 */
function windowFeed(options: LiveOptions, heard: Heard, fail: Fail): Feed {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-live-'));
  const abort = new AbortController();
  let pending: Uint8Array = new Uint8Array(0);
  /** Seconds of sound before `pending`. */
  let start = 0;
  let waiting: { samples: Uint8Array; start: number } | undefined;
  let running = false;
  let count = 0;
  const run = () => {
    if (running || !waiting || abort.signal.aborted) return;
    const window = waiting;
    waiting = undefined;
    running = true;
    const file = join(dir, `window-${++count}.wav`);
    const seconds = window.samples.length / BYTES_PER_SECOND;
    writeFile(file, wav(window.samples))
      .then(() => runWhisper(file, { model: options.model, language: options.language, seconds, signal: abort.signal }))
      .then((words) => heard(words.map((word) => ({ ...word, t: word.t + window.start, end: word.end + window.start }))))
      .catch((error: unknown) => !abort.signal.aborted && fail(error instanceof Error ? error : new Error(String(error))))
      .finally(() => {
        running = false;
        void rm(file, { force: true }).catch(() => {});
        run();
      });
  };
  return {
    push(samples) {
      if (abort.signal.aborted) return;
      const joined = new Uint8Array(pending.length + samples.length);
      joined.set(pending);
      joined.set(samples, pending.length);
      pending = joined;
      if (pending.length < LIVE_RULES.most * BYTES_PER_SECOND) return;
      const cut = quietestCut(pending);
      waiting = { samples: pending.slice(0, cut), start };
      start += cut / BYTES_PER_SECOND;
      pending = pending.slice(cut);
      run();
    },
    stop() {
      abort.abort();
      void rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/**
 * Where to cut the samples into a window (a byte offset): in the middle of the quietest tenth of a
 * second between `LIVE_RULES.least` and `LIVE_RULES.most` seconds (the later one of equals), so a
 * word is rarely cut in two.
 */
export function quietestCut(samples: Uint8Array): number {
  const view = new DataView(samples.buffer, samples.byteOffset, samples.byteLength);
  const slot = BYTES_PER_SECOND / 10;
  const end = Math.min(samples.length, LIVE_RULES.most * BYTES_PER_SECOND);
  let best = Math.min(end, LIVE_RULES.least * BYTES_PER_SECOND);
  let quietest = Infinity;
  for (let from = LIVE_RULES.least * BYTES_PER_SECOND; from + slot <= end; from += slot) {
    let sum = 0;
    for (let i = from; i < from + slot; i += 2) sum += view.getInt16(i, true) ** 2;
    if (sum <= quietest) {
      quietest = sum;
      best = from + slot / 2;
    }
  }
  return best;
}

/** The samples as a WAV file (16 kHz mono 16-bit). */
function wav(samples: Uint8Array): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + samples.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(LIVE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}
```

In `packages/core/src/index.ts`, replace:

```ts
// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, run ffmpeg, transcribe the mic (the speech models, whisper, the speech edits), keep brand kits,
// and read a product's colours and the desktop's wallpaper for a background.
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
```

with:

```ts
// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, run ffmpeg, transcribe the mic (the speech models, whisper, live captions, the speech
// edits), keep brand kits, and read a product's colours and the desktop's wallpaper for a background.
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
```

In the same file, replace:

```ts
export { transcriptMarkers } from './suggest/transcript';
export { DEFAULT_MODEL, MODEL_NAMES, SPEECH_MODELS, chooseModel, downloadFile, downloadModel, installedModels, modelInstalled, modelPath, modelUrl, modelsDir, removeModel, speechModel, type DownloadOptions, type ModelName, type SpeechModel } from './speech/models';
export { filterValue, hasWhisper, NO_WHISPER, parseWhisperCliJson, parseWhisperLines, runWhisper, whisperCliPath, whisperEngine, type HeardWord, type WhisperEngine, type WhisperOptions } from './speech/whisper';
export { LEVEL_SECONDS, SPEECH_RULES, micLevels, speechStretches } from './speech/levels';
export { ALIGN_RULES, alignWords, guessLanguage, type Alignment } from './speech/align';
export { SPEECH_EDIT_RULES, fillerCuts, fillerWords, inputSpans, mergeCuts, pauseCuts, restingAt, speechCuts, type RawCut, type SpeechCut, type SpeechEditInput } from './speech/edits';
```

with:

```ts
export { transcriptMarkers } from './suggest/transcript';
export { DEFAULT_MODEL, MODEL_NAMES, SPEECH_MODELS, chooseModel, downloadFile, downloadModel, installedModels, modelInstalled, modelPath, modelUrl, modelsDir, removeModel, speechModel, type DownloadOptions, type ModelName, type SpeechModel } from './speech/models';
export { filterValue, hasWhisper, NO_WHISPER, parseWhisperCliJson, parseWhisperLines, runWhisper, whisperCliPath, whisperEngine, type HeardWord, type WhisperEngine, type WhisperOptions } from './speech/whisper';
export { LIVE_RATE, LIVE_RULES, liveCaptions, liveModel, quietestCut, withoutEchoes, type LiveCaptions, type LiveMode, type LiveOptions } from './speech/live';
export { LEVEL_SECONDS, SPEECH_RULES, micLevels, speechStretches } from './speech/levels';
export { ALIGN_RULES, alignWords, guessLanguage, type Alignment } from './speech/align';
export { SPEECH_EDIT_RULES, fillerCuts, fillerWords, inputSpans, mergeCuts, pauseCuts, restingAt, speechCuts, type RawCut, type SpeechCut, type SpeechEditInput } from './speech/edits';
```

Run: `pnpm exec vitest run --project node packages/core/test/live.test.ts`
Expected: PASS: 6 tests where a model and the whisper filter are there (each real run takes about 12 s), else the 3 pure ones.

- [ ] **Step 3: Commit**

```bash
git add packages/core
git commit -m "core: live captions from the mic's samples (ffmpeg's whisper filter on a stream, or whisper-cli by windows)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The captions in the HUD

**Files:**
- Modify: `apps/desktop/src/shared/recording.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/main/recorder-host.ts`, `apps/desktop/src/workers/recorder.ts`, `apps/desktop/src/main/speech.ts`, `apps/desktop/src/main/settings.ts`, `apps/desktop/src/main/settings-window.ts`, `apps/desktop/src/main/recording.ts`, `apps/desktop/src/renderer/picker/Hud.tsx`, `apps/desktop/src/renderer/picker/picker.css`, `apps/desktop/src/renderer/settings/Settings.tsx`, `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The recorder host runs them**

In `apps/desktop/src/shared/recording.ts`, replace:

```ts
// and the pure geometry of picking what to record.
import type { Bounds, CaptureSource, Devices, RecordOptions, RecorderEvent, StopOptions, Take } from '@cuttle/recorder';

/** What the main process asks of the host. */
export type HostRequest =
  | { type: 'devices'; id: number; media: boolean }
  | { type: 'start'; options: Omit<RecordOptions, 'onEvent'> }
  | { type: 'stop' }
  | { type: 'marker'; label?: string }
  | { type: 'retake' }
```

with:

```ts
// and the pure geometry of picking what to record.
import type { Bounds, CaptureSource, Devices, RecordOptions, RecorderEvent, StopOptions, Take } from '@cuttle/recorder';

/** Live captions for a take: the speech model's file and the language spoken (`auto` or a code). */
export interface LiveRequest {
  model: string;
  language: string;
}

/** What the main process asks of the host. */
export type HostRequest =
  | { type: 'devices'; id: number; media: boolean }
  | { type: 'start'; options: Omit<RecordOptions, 'onEvent' | 'onAudio'>; live?: LiveRequest }
  | { type: 'stop' }
  | { type: 'marker'; label?: string }
  | { type: 'retake' }
```

In the same file, replace:

```ts
export type HostReply =
  | { type: 'devices'; id: number; devices?: Devices; error?: string }
  | { type: 'event'; event: RecorderEvent }
  | { type: 'done'; take: Take }
  | { type: 'failed'; code: string; message: string };
```

with:

```ts
export type HostReply =
  | { type: 'devices'; id: number; devices?: Devices; error?: string }
  | { type: 'event'; event: RecorderEvent }
  /** Words the live captions heard, newest last. */
  | { type: 'live'; words: string[] }
  /** The live captions stopped (the take goes on). */
  | { type: 'live-failed'; message: string }
  | { type: 'done'; take: Take }
  | { type: 'failed'; code: string; message: string };
```

In `apps/desktop/src/main/recorder-host.ts`, replace:

```ts
import { utilityProcess, type UtilityProcess } from 'electron';
import type { Bounds, Devices, RecordOptions, RecorderEvent, Take } from '@cuttle/recorder';
import type { HostReply, HostRequest } from '../shared/recording';
import { TEST_BACKEND } from './check';
import { bundlePath } from './protocols';
```

with:

```ts
import { utilityProcess, type UtilityProcess } from 'electron';
import type { Bounds, Devices, RecordOptions, RecorderEvent, Take } from '@cuttle/recorder';
import type { HostReply, HostRequest, LiveRequest } from '../shared/recording';
import { TEST_BACKEND } from './check';
import { bundlePath } from './protocols';
```

In the same file, replace:

```ts
  }
}

interface Running {
  onEvent: (event: RecorderEvent) => void;
  resolve: (take: Take) => void;
  reject: (error: Error) => void;
  /** The running ffmpegs' process ids, reported by the recorder as the tracks start (none while paused). */
```

with:

```ts
  }
}

/** What the live captions tell: words they heard (newest last), or why they stopped. */
export type LiveNews = { words: string[] } | { failed: string };

interface Running {
  onEvent: (event: RecorderEvent) => void;
  onLive?: (news: LiveNews) => void;
  resolve: (take: Take) => void;
  reject: (error: Error) => void;
  /** The running ffmpegs' process ids, reported by the recorder as the tracks start (none while paused). */
```

In the same file, replace:

```ts
        if (message.event.type === 'paused' && this.running) this.running.pids = [];
        this.running?.onEvent(message.event);
        return;
      case 'done': {
        const running = this.running;
        this.running = undefined;
```

with:

```ts
        if (message.event.type === 'paused' && this.running) this.running.pids = [];
        this.running?.onEvent(message.event);
        return;
      case 'live':
        this.running?.onLive?.({ words: message.words });
        return;
      case 'live-failed':
        this.running?.onLive?.({ failed: message.message });
        return;
      case 'done': {
        const running = this.running;
        this.running = undefined;
```

In the same file, replace:

```ts
    return this.running !== undefined;
  }

  /** Records a take; resolves with it when the recording stops (by `stop()`, the hotkey or a trigger). */
  record(options: Omit<RecordOptions, 'onEvent'>, onEvent: (event: RecorderEvent) => void): Promise<Take> {
    if (this.running) return Promise.reject(new RecordingError('invalid-options', 'a recording is already running'));
    const promise = new Promise<Take>((resolve, reject) => (this.running = { onEvent, resolve, reject, pids: [] }));
    this.send({ type: 'start', options });
    return promise;
  }
```

with:

```ts
    return this.running !== undefined;
  }

  /**
   * Records a take; resolves with it when the recording stops (by `stop()`, the hotkey or a trigger).
   * With `live`, the mic's words come to `onLive` while it records.
   */
  record(options: Omit<RecordOptions, 'onEvent' | 'onAudio'>, onEvent: (event: RecorderEvent) => void, live?: { request: LiveRequest; onLive: (news: LiveNews) => void }): Promise<Take> {
    if (this.running) return Promise.reject(new RecordingError('invalid-options', 'a recording is already running'));
    const promise = new Promise<Take>((resolve, reject) => (this.running = { onEvent, ...(live && { onLive: live.onLive }), resolve, reject, pids: [] }));
    this.send({ type: 'start', options, ...(live && { live: live.request }) });
    return promise;
  }
```

In `apps/desktop/src/workers/recorder.ts`, replace:

```ts
// The recorder host: a utility process that runs `record()` (its input hook and koffi calls work
// here, away from the main process's event loop). One recording at a time; the main process sees
// every event and kills the capture processes if this process dies.
import { listDevices, record, RecorderError, type Backend, type Recording } from '@cuttle/recorder';
import type { HostReply, HostRequest } from '../shared/recording';
```

with:

```ts
// The recorder host: a utility process that runs `record()` (its input hook and koffi calls work
// here, away from the main process's event loop), and the take's live captions from the mic's
// samples. One recording at a time; the main process sees every event and kills the capture
// processes if this process dies.
import { liveCaptions } from '@cuttle/core';
import { listDevices, record, RecorderError, type Backend, type Recording } from '@cuttle/recorder';
import type { HostReply, HostRequest } from '../shared/recording';
```

In the same file, replace:

```ts
      return;
    case 'start': {
      if (recording) return reply({ type: 'failed', code: 'invalid-options', message: 'a recording is already running' });
      const current = record({ ...data.options, backend, onEvent: (event) => reply({ type: 'event', event }) });
      recording = current;
      current.done.then(
        (take) => reply({ type: 'done', take }),
        (error: unknown) =>
          reply({ type: 'failed', code: error instanceof RecorderError ? error.code : 'capture', message: error instanceof Error ? error.message : String(error) }),
      ).finally(() => {
        if (recording === current) recording = undefined;
      });
      return;
```

with:

```ts
      return;
    case 'start': {
      if (recording) return reply({ type: 'failed', code: 'invalid-options', message: 'a recording is already running' });
      const live =
        data.live &&
        liveCaptions({
          ...data.live,
          onWords: (words) => reply({ type: 'live', words: words.map((word) => word.text) }),
          onError: (error) => reply({ type: 'live-failed', message: error.message }),
        });
      const current = record({
        ...data.options,
        backend,
        onEvent: (event) => {
          if (event.type === 'stopping') live?.stop();
          reply({ type: 'event', event });
        },
        ...(live && { onAudio: (samples: Uint8Array) => live.push(samples) }),
      });
      recording = current;
      current.done.then(
        (take) => reply({ type: 'done', take }),
        (error: unknown) =>
          reply({ type: 'failed', code: error instanceof RecorderError ? error.code : 'capture', message: error instanceof Error ? error.message : String(error) }),
      ).finally(() => {
        live?.stop();
        if (recording === current) recording = undefined;
      });
      return;
```

- [ ] **Step 2: The setting, and the words to the HUD**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
  tone?: 'warn' | 'info';
  /** The take records a mic: the HUD shows its level (`hud:level`). */
  mic?: boolean;
}

/** What the main process is doing to a project, shown in its editor's title bar. */
```

with:

```ts
  tone?: 'warn' | 'info';
  /** The take records a mic: the HUD shows its level (`hud:level`). */
  mic?: boolean;
  /** The take has live captions: the HUD shows them under its bar (`hud:caption`); `failed` says why they stopped. */
  captions?: { failed?: string };
}

/** What the main process is doing to a project, shown in its editor's title bar. */
```

In the same file, replace:

```ts
  mic?: string;
  launchAtLogin: boolean;
  motion: Motion;
  /** Transcribing a take after its cut: the model (or off) and the language spoken. */
  speech: { model: SpeechModelName | 'off'; language: SpeechLanguage };
  /** After a take's cut: read the screen's text to mask what it showed, and the words always masked. */
  privacy: { read: boolean; words: string[] };
  /** `open`: the project is open in Cuttle, here (`here`) or on the computer named. */
```

with:

```ts
  mic?: string;
  launchAtLogin: boolean;
  motion: Motion;
  /** Transcribing a take after its cut: the model (or off) and the language spoken; `live`: captions in the HUD while it records. */
  speech: { model: SpeechModelName | 'off'; language: SpeechLanguage; live: boolean };
  /** After a take's cut: read the screen's text to mask what it showed, and the words always masked. */
  privacy: { read: boolean; words: string[] };
  /** `open`: the project is open in Cuttle, here (`here`) or on the computer named. */
```

In the same file, replace:

```ts
    motion: z.enum(MOTIONS).optional(),
    speechModel: z.enum(['off', ...SPEECH_MODEL_NAMES]).optional(),
    speechLanguage: z.enum(SPEECH_LANGUAGES).optional(),
    privacyRead: z.boolean().optional(),
    privacyWords: z.array(z.string().trim().min(1).max(PRIVACY_WORD_MAX)).max(PRIVACY_WORDS_MAX).optional(),
  }),
```

with:

```ts
    motion: z.enum(MOTIONS).optional(),
    speechModel: z.enum(['off', ...SPEECH_MODEL_NAMES]).optional(),
    speechLanguage: z.enum(SPEECH_LANGUAGES).optional(),
    speechLive: z.boolean().optional(),
    privacyRead: z.boolean().optional(),
    privacyWords: z.array(z.string().trim().min(1).max(PRIVACY_WORD_MAX)).max(PRIVACY_WORDS_MAX).optional(),
  }),
```

In the same file, replace:

```ts
  'hud:state': HudState;
  /** The mic's level now (dBFS), ten times a second while the take records. */
  'hud:level': { rms: number; peak: number };
  /** What the main process is doing to the project (cutting the take), or nothing. */
  'project:status': ProjectStatus;
  'project:file': ProjectFileEvent;
```

with:

```ts
  'hud:state': HudState;
  /** The mic's level now (dBFS), ten times a second while the take records. */
  'hud:level': { rms: number; peak: number };
  /** Words the live captions heard since they last told, oldest first. */
  'hud:caption': { words: string[] };
  /** What the main process is doing to the project (cutting the take), or nothing. */
  'project:status': ProjectStatus;
  'project:file': ProjectFileEvent;
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
  },
  hud: {
    requests: ['hud:stop', 'hud:marker', 'hud:retake', 'hud:pause', 'hud:resume', 'hud:restart'],
    events: ['hud:state', 'hud:level', 'app:motion'],
  },
  prompter: {
    requests: ['prompter:next', 'prompter:previous', 'prompter:size'],
```

with:

```ts
  },
  hud: {
    requests: ['hud:stop', 'hud:marker', 'hud:retake', 'hud:pause', 'hud:resume', 'hud:restart'],
    events: ['hud:state', 'hud:level', 'hud:caption', 'app:motion'],
  },
  prompter: {
    requests: ['prompter:next', 'prompter:previous', 'prompter:size'],
```

In `apps/desktop/src/main/settings.ts`, replace:

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
  /** The privacy step after a take's cut: read the screen's text (Windows' OCR, macOS's Vision) to mask what it showed, and the words always masked. */
  privacy: z
    .object({
```

with:

```ts
  launchAtLogin: z.boolean().catch(false).default(false),
  /** Motion in the app's windows: the OS's "reduce motion" (system), or always reduced, or always full. */
  motion: z.enum(MOTIONS).catch('system').default('system'),
  /**
   * Transcribing a take after its cut: the speech model (`small` until the person picks), and the
   * language spoken. `live`: the HUD shows what the mic hears while a take records.
   */
  speech: z
    .object({
      model: z.enum(['off', ...SPEECH_MODEL_NAMES]).catch('small').default('small'),
      language: z.enum(SPEECH_LANGUAGES).catch('auto').default('auto'),
      live: z.boolean().catch(true).default(true),
    })
    .catch({ model: 'small' as const, language: 'auto' as const, live: true })
    .default({ model: 'small' as const, language: 'auto' as const, live: true }),
  /** The privacy step after a take's cut: read the screen's text (Windows' OCR, macOS's Vision) to mask what it showed, and the words always masked. */
  privacy: z
    .object({
```

In `apps/desktop/src/main/settings-window.ts`, replace:

```ts
        if (change.motion !== undefined) settings.motion = change.motion;
        if (change.speechModel !== undefined) settings.speech.model = change.speechModel;
        if (change.speechLanguage !== undefined) settings.speech.language = change.speechLanguage;
        if (change.privacyRead !== undefined) settings.privacy.read = change.privacyRead;
        // each word once, as it was first written
        if (change.privacyWords !== undefined) settings.privacy.words = change.privacyWords.filter((word, k, all) => all.findIndex((other) => other.toLowerCase() === word.toLowerCase()) === k);
```

with:

```ts
        if (change.motion !== undefined) settings.motion = change.motion;
        if (change.speechModel !== undefined) settings.speech.model = change.speechModel;
        if (change.speechLanguage !== undefined) settings.speech.language = change.speechLanguage;
        if (change.speechLive !== undefined) settings.speech.live = change.speechLive;
        if (change.privacyRead !== undefined) settings.privacy.read = change.privacyRead;
        // each word once, as it was first written
        if (change.privacyWords !== undefined) settings.privacy.words = change.privacyWords.filter((word, k, all) => all.findIndex((other) => other.toLowerCase() === word.toLowerCase()) === k);
```

In `apps/desktop/src/main/speech.ts`, replace:

```ts
// Speech in the app: the models (download with progress and cancel, remove), and transcribing a
// take after its cut, in the media worker, then its retakes, filler words and pauses cut as one
// change.
import { dirname, join, relative, resolve, sep } from 'node:path';
import { CLEAN_MIC_FILE, CoreError, SPEECH_MODELS, TRANSCRIPT_FILE, downloadModel, hasWhisper, installedModels, modelInstalled, modelsDir, readProjectFile, removeModel } from '@cuttle/core';
import type { SpeechModelName, SpeechStatus } from '../shared/ipc';
import { mediaWorker } from './media-service';
import { loadSettings } from './settings';
import { expectSpeech, setEditorStatus } from './windows';
```

with:

```ts
// Speech in the app: the models (download with progress and cancel, remove), transcribing a take
// after its cut, in the media worker, then its retakes, filler words and pauses cut as one change,
// and which model the live captions use while a take records.
import { dirname, join, relative, resolve, sep } from 'node:path';
import { CLEAN_MIC_FILE, CoreError, SPEECH_MODELS, TRANSCRIPT_FILE, downloadModel, hasWhisper, installedModels, liveModel, modelInstalled, modelPath, modelsDir, readProjectFile, removeModel } from '@cuttle/core';
import type { SpeechModelName, SpeechStatus } from '../shared/ipc';
import type { LiveRequest } from '../shared/recording';
import { mediaWorker } from './media-service';
import { loadSettings } from './settings';
import { expectSpeech, setEditorStatus } from './windows';
```

In the same file, replace:

```ts
  };
}

/** Calls `listener` whenever the models change or a download moves on (every whole percent). */
export function onSpeechStatus(listener: (status: SpeechStatus) => void): () => void {
  listeners.add(listener);
```

with:

```ts
  };
}

/**
 * Live captions for a take with a mic, when they are on: the fastest model downloaded (they must
 * keep up with speech) and the language spoken. None without a model or whisper.
 */
export async function liveRequest(): Promise<LiveRequest | undefined> {
  const { speech } = await loadSettings();
  if (!speech.live) return undefined;
  const model = await liveModel();
  if (!model || !(await hasWhisper().catch(() => false))) return undefined;
  return { model: modelPath(model), language: speech.language };
}

/** Calls `listener` whenever the models change or a download moves on (every whole percent). */
export function onSpeechStatus(listener: (status: SpeechStatus) => void): () => void {
  listeners.add(listener);
```

In `apps/desktop/src/main/recording.ts`, replace:

```ts
import { bindRequests, send } from './ipc';
import { cutTake } from './media-service';
import { APP_ORIGIN, serveApp, bundlePath } from './protocols';
import { recorderHost, RecordingError } from './recorder-host';
import { findFfmpeg } from './tools';
import { loadSettings, updateSettings } from './settings';
import { maskPrivacy } from './privacy';
import { openPrompter, type Prompter } from './prompter';
import { transcribeProject } from './speech';
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, sendToEditor, setEditorStatus, showPill, webPreferences } from './windows';

/** The HUD's window (the HUD and a margin for its shadow): never in the video, and a dead zone for the input log. */
const HUD_SIZE = { width: 512, height: 64 };
/** The recorder host answers a listing in this time, or the picker says it cannot record. */
const LISTING_TIMEOUT_MS = 10_000;
```

with:

```ts
import { bindRequests, send } from './ipc';
import { cutTake } from './media-service';
import { APP_ORIGIN, serveApp, bundlePath } from './protocols';
import { recorderHost, RecordingError, type LiveNews } from './recorder-host';
import { findFfmpeg } from './tools';
import { loadSettings, updateSettings } from './settings';
import { maskPrivacy } from './privacy';
import { openPrompter, type Prompter } from './prompter';
import { liveRequest, transcribeProject } from './speech';
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, sendToEditor, setEditorStatus, showPill, webPreferences } from './windows';

/** The HUD's window (the HUD and a margin for its shadow): never in the video, and a dead zone for the input log. */
const HUD_SIZE = { width: 512, height: 64 };
/** With live captions: the strip of words under the bar. */
const HUD_CAPTIONED_SIZE = { width: 512, height: 102 };
/** The recorder host answers a listing in this time, or the picker says it cannot record. */
const LISTING_TIMEOUT_MS = 10_000;
```

In the same file, replace:

```ts
    const script = scriptForTake(steps, usedIds({ ...file?.raw, script: [] }));

    const area = targetRect(target, display, picked);
    /** Takes a restart put aside, newest last (folders relative to the project). */
    const discarded: string[] = [];
    for (;;) {
```

with:

```ts
    const script = scriptForTake(steps, usedIds({ ...file?.raw, script: [] }));

    const area = targetRect(target, display, picked);
    // what the mic hears, in the HUD while the take records
    const live = choices.mic ? await liveRequest().catch(() => undefined) : undefined;
    const hudSize = live ? HUD_CAPTIONED_SIZE : HUD_SIZE;
    /** Takes a restart put aside, newest last (folders relative to the project). */
    const discarded: string[] = [];
    for (;;) {
```

In the same file, replace:

```ts
        () => !HIDDEN && !countdown.isDestroyed() && countdown.showInactive(),
        () => {},
      );
      const hud = overlay({ ...hudPosition(displays, display.id, area, HUD_SIZE), ...HUD_SIZE }, 'hud.cjs', { focusable: false, movable: true });
      const hudState: HudState = { phase: 'countdown', markers: 0, ...(choices.mic && { mic: true }) };
      // a check of the drive or the window still under way may note something after the HUD closed
      const showHud = () => !hud.isDestroyed() && send(hud.webContents, 'hud:state', { ...hudState });
      /** The last warning: a pause shows its own note, the resume brings the warning back. */
```

with:

```ts
        () => !HIDDEN && !countdown.isDestroyed() && countdown.showInactive(),
        () => {},
      );
      const hud = overlay({ ...hudPosition(displays, display.id, area, hudSize), ...hudSize }, 'hud.cjs', { focusable: false, movable: true });
      const hudState: HudState = { phase: 'countdown', markers: 0, ...(choices.mic && { mic: true }), ...(live && { captions: {} }) };
      // a check of the drive or the window still under way may note something after the HUD closed
      const showHud = () => !hud.isDestroyed() && send(hud.webContents, 'hud:state', { ...hudState });
      /** The last warning: a pause shows its own note, the resume brings the warning back. */
```

In the same file, replace:

```ts
        }
      };

      const onEvent = (event: RecorderEvent) => {
        switch (event.type) {
          case 'countdown':
```

with:

```ts
        }
      };

      const onLive = (news: LiveNews) => {
        if ('failed' in news) {
          hudState.captions = { failed: news.failed };
          showHud();
        } else if (!hud.isDestroyed()) send(hud.webContents, 'hud:caption', { words: news.words });
      };

      const onEvent = (event: RecorderEvent) => {
        switch (event.type) {
          case 'countdown':
```

In the same file, replace:

```ts
            hideWindowsOf: [process.pid],
          },
          onEvent,
        );
      } catch (error) {
        clearInterval(watch);
```

with:

```ts
            hideWindowsOf: [process.pid],
          },
          onEvent,
          live && { request: live, onLive },
        );
      } catch (error) {
        clearInterval(watch);
```

- [ ] **Step 3: The HUD's line and the setting's switch**

In `apps/desktop/src/renderer/picker/Hud.tsx`, replace:

```tsx
// The recording HUD: the time, the mic's level, a warning when there is one, restart, the mistake
// key, a marker, pause and Stop. It
// is never in the video (content protection), never takes the focus (the recorded window keeps it),
// and its area is a dead zone for the input log. Its width is fixed, so Stop never moves under the
// pointer. Restart asks for a press held 600 ms, so a stray click does not put a take aside.
import { useEffect, useRef, useState } from 'react';
```

with:

```tsx
// The recording HUD: the time, the mic's level, a warning when there is one, restart, the mistake
// key, a marker, pause and Stop, and under them the live captions when the take has them. It is
// never in the video (content protection), never takes the focus (the recorded window keeps it),
// and its area is a dead zone for the input log. Its width is fixed, so Stop never moves under the
// pointer. Restart asks for a press held 600 ms, so a stray click does not put a take aside.
import { useEffect, useRef, useState } from 'react';
```

In the same file, replace:

```tsx
          <i />
        </button>
      </div>
    </div>
  );
}
```

with:

```tsx
          <i />
        </button>
      </div>
      {state.captions && <Captions failed={state.captions.failed} live={state.phase === 'recording'} />}
    </div>
  );
}

/** The live captions keep this many words: more than one line holds. */
const LINE_WORDS = 24;

/**
 * The live captions: what the mic heard last, in one line under the bar, the newest words at its
 * right end and the older ones fading out at its left. "Listening…" until the first words; dimmed
 * while the take does not record.
 */
function Captions({ failed, live }: { failed: string | undefined; live: boolean }) {
  // the last words heard, and the number of the first of them (a word keeps its number as the line
  // moves on, so only new words fade in)
  const [line, setLine] = useState<{ first: number; words: string[] }>({ first: 0, words: [] });
  useEffect(
    () =>
      bridge.on('hud:caption', ({ words: heard }) =>
        setLine((before) => {
          const words = [...before.words, ...heard];
          const dropped = Math.max(0, words.length - LINE_WORDS);
          return { first: before.first + dropped, words: words.slice(dropped) };
        }),
      ),
    [],
  );
  const { first, words } = line;
  return (
    <div className={`captions${live ? '' : ' resting'}${failed ? ' failed' : ''}`} role="log" aria-live="polite" aria-label="Live captions" title={failed ? `The live captions stopped: ${failed}` : 'What the mic hears, as Cuttle understands it (not saved)'} data-testid="hud-captions">
      <span className="line">
        {failed ? (
          <span className="said">
            <WarningIcon size={13} />
            Live captions stopped
          </span>
        ) : words.length === 0 ? (
          <span className="said waiting">Listening…</span>
        ) : (
          <span className="said">
            {words.map((word, i) => (
              <span key={first + i}>{word} </span>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}
```

In `apps/desktop/src/renderer/picker/picker.css`, replace:

```css
/* HUD: never in the video, never takes the focus */
.hud-wrap {
  height: 100%;
  display: grid;
  place-items: center;
}
.hud {
  width: 492px;
```

with:

```css
/* HUD: never in the video, never takes the focus */
.hud-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.hud {
  width: 492px;
```

In the same file, replace:

```css
  background: rgba(79, 209, 161, 0.14);
}

@keyframes pop {
  from {
    transform: scale(0.85);
```

with:

```css
  background: rgba(79, 209, 161, 0.14);
}

/* the live captions under the bar: the newest words at the right, the older ones fading out at the left */
.captions {
  width: 492px;
  height: 30px;
  display: flex;
  padding: 0 14px;
  border-radius: 12px;
  background: var(--overlay);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.07);
  color: var(--text);
  font-size: var(--size-s);
  -webkit-app-region: drag;
}
.captions .line {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  overflow: hidden;
  -webkit-mask: linear-gradient(to right, transparent 0, #000 48px);
  mask: linear-gradient(to right, transparent 0, #000 48px);
}
.captions .said {
  flex: none;
  white-space: nowrap;
}
.captions .said > span {
  animation: heard 240ms ease-out;
}
.captions .waiting,
.captions.resting {
  color: var(--muted);
}
.captions.failed {
  color: var(--card);
}
.captions.failed .line {
  justify-content: flex-start;
  -webkit-mask: none;
  mask: none;
}
.captions.failed .said {
  display: flex;
  align-items: center;
  gap: 6px;
}
@keyframes heard {
  from {
    opacity: 0;
  }
}

@keyframes pop {
  from {
    transform: scale(0.85);
```

In the same file, replace:

```css
}
@media (prefers-reduced-motion: reduce) {
  :root:not([data-motion='full']) .countdown b,
  :root:not([data-motion='full']) .hud .dot {
    animation: none;
  }
}
:root[data-motion='reduce'] .countdown b,
:root[data-motion='reduce'] .hud .dot {
  animation: none;
}
```

with:

```css
}
@media (prefers-reduced-motion: reduce) {
  :root:not([data-motion='full']) .countdown b,
  :root:not([data-motion='full']) .hud .dot,
  :root:not([data-motion='full']) .captions .said > span {
    animation: none;
  }
}
:root[data-motion='reduce'] .countdown b,
:root[data-motion='reduce'] .hud .dot,
:root[data-motion='reduce'] .captions .said > span {
  animation: none;
}
```

In `apps/desktop/src/renderer/settings/Settings.tsx`, replace:

```tsx
          testid="speech-language"
        />
      </Row>
    </>
  );
}
```

with:

```tsx
          testid="speech-language"
        />
      </Row>
      <Row
        label="Live captions while recording"
        hint={
          status && !status.models.some((entry) => entry.installed)
            ? 'The HUD shows what the mic hears as you speak. It needs a speech model: download one above.'
            : 'The HUD shows what the mic hears as you speak, with the fastest model downloaded. Nothing of it is saved.'
        }
      >
        <button
          className="toggle"
          role="switch"
          aria-checked={view?.speech.live ?? true}
          aria-label="Live captions while recording"
          disabled={!view}
          onClick={() => view && change({ speechLive: !view.speech.live })}
          data-testid="speech-live"
        >
          <i />
        </button>
      </Row>
    </>
  );
}
```

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 4: The checks**

- The speech settings' check switches the live captions off and on again, and reads the row's hint without a model.
- A new check (where the `base` model and whisper are there) records with the spoken test mic. "screen" shows in the HUD's line, which fits under the bar with the newest word at its right end.

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
        CUTTLE_CHECK_IMAGE: join(root, 'nimbus.svg'),
        // the desktop's wallpaper, the check's own (never this computer's)
        CUTTLE_WALLPAPER: join(root, 'wallpaper.png'),
      },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
```

with:

```ts
        CUTTLE_CHECK_IMAGE: join(root, 'nimbus.svg'),
        // the desktop's wallpaper, the check's own (never this computer's)
        CUTTLE_WALLPAPER: join(root, 'wallpaper.png'),
        // what the spoken test mic says
        CUTTLE_TEST_SPEECH: SPOKEN,
      },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
```

In the same file, replace:

```ts
    const settings = await waitForPage(app, async (page) => page.url().includes('/settings.html') && (await page.locator('[data-testid=settings-page-speech]').count()) === 1);
    await click(settings, '[data-testid=settings-page-speech]');
    await settings.waitForSelector('[data-testid=speech-line]');
    const saved = () => JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { speech?: { model: string; language: string } };
    const line = () => settings.locator('[data-testid=speech-line] .row-hint').textContent();
    const choose = (label: string) => chooseIn(settings, '[data-testid=speech-model]', label, true);
    // Good (small), the default: not downloaded here; its download breaks off, and says so
```

with:

```ts
    const settings = await waitForPage(app, async (page) => page.url().includes('/settings.html') && (await page.locator('[data-testid=settings-page-speech]').count()) === 1);
    await click(settings, '[data-testid=settings-page-speech]');
    await settings.waitForSelector('[data-testid=speech-line]');
    const saved = () => JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { speech?: { model: string; language: string; live?: boolean } };
    const line = () => settings.locator('[data-testid=speech-line] .row-hint').textContent();
    const choose = (label: string) => chooseIn(settings, '[data-testid=speech-model]', label, true);
    // Good (small), the default: not downloaded here; its download breaks off, and says so
```

In the same file, replace:

```ts
    // the language spoken
    await click(settings, '[data-testid=speech-language] button:nth-child(3)');
    await expect.poll(() => saved().speech?.language).toBe('en');
    if (!BASE_MODEL || !hasWhisper) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/settings.html'))?.close());
      return;
```

with:

```ts
    // the language spoken
    await click(settings, '[data-testid=speech-language] button:nth-child(3)');
    await expect.poll(() => saved().speech?.language).toBe('en');
    // live captions while recording: on until switched off; without a model the row says what they need
    expect(await settings.locator('[data-testid=speech-live]').getAttribute('aria-checked')).toBe('true');
    expect(await settings.locator('.row:has([data-testid=speech-live]) .row-hint').textContent()).toBe('The HUD shows what the mic hears as you speak. It needs a speech model: download one above.');
    await click(settings, '[data-testid=speech-live]');
    await expect.poll(() => saved().speech?.live).toBe(false);
    await click(settings, '[data-testid=speech-live]');
    await expect.poll(() => saved().speech?.live).toBe(true);
    if (!BASE_MODEL || !hasWhisper) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/settings.html'))?.close());
      return;
```

In the same file, replace:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'spoken · Cuttle')?.close());
  }, 120_000);

  it('shows the transcript (a click goes to a word, a fix reads in the subtitles, Delete cuts words and Restore brings them back), styles the subtitles, and exports them as .srt', async () => {
    const dir = join(root, 'subtitled');
    makeSpokenFixture(dir, SPOKEN);
```

with:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'spoken · Cuttle')?.close());
  }, 120_000);

  it.runIf(!!BASE_MODEL && hasWhisper)("shows live captions in the HUD while a take with a mic records: the spoken test mic's words, newest at the right", async () => {
    // the fastest model downloaded (the test before downloads it; alone, this one copies it)
    if (!existsSync(join(root, 'models', 'ggml-base.bin'))) {
      mkdirSync(join(root, 'models'), { recursive: true });
      cpSync(BASE_MODEL!, join(root, 'models', 'ggml-base.bin'));
    }
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    await recordThroughPicker(pillRecord, { stop: 'none', camera: undefined, mic: 'Spoken Test Microphone' }, false);
    const hud = await runningHud();
    const captions = hud.locator('[data-testid=hud-captions]');
    // "Uh, this is Cuttle. It records your screen…": about two seconds after it is said
    await expect.poll(() => captions.textContent(), { timeout: 45_000 }).toMatch(/\bscreen\b/i);
    // the strip fits under the bar in the HUD's window, the newest word at its right end
    const fits = await hud.evaluate(() => {
      const strip = document.querySelector('.captions')!.getBoundingClientRect();
      const said = document.querySelector('.captions .said')!.getBoundingClientRect();
      const bar = document.querySelector('.hud')!;
      return { inside: strip.bottom <= window.innerHeight && strip.top >= bar.getBoundingClientRect().bottom, newest: said.right <= strip.right, bar: bar.scrollWidth <= bar.clientWidth };
    });
    expect(fits).toEqual({ inside: true, newest: true, bar: true });
    await shotOf('31c-hud-captions', '/hud.html');
    await click(hud, '[data-testid=hud-stop]');
    const dir = await newProject(before);
    const written = await projectWhen(dir, (file) => file.scenes[0]?.id !== undefined);
    expect(written.sources.mic).toBe('takes/1/mic.m4a');
  }, 120_000);

  it('shows the transcript (a click goes to a word, a fix reads in the subtitles, Delete cuts words and Restore brings them back), styles the subtitles, and exports them as .srt', async () => {
    const dir = join(root, 'subtitled');
    makeSpokenFixture(dir, SPOKEN);
```

Run: `pnpm app:check`
Expected: PASS, 58 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "app: live captions in the HUD while a take with a mic records

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The guide, and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: The README**

In `README.md`, replace:

```markdown
(Ctrl+Shift+Option+R on a Mac) shows a picker over every display: the window under the pointer lights up (the display where there is none), a drag draws a
region, and the bar sets the camera, the mic and when to stop (your stop, Claude's answer, an idle
screen). After the countdown only a small HUD remains, which never appears in the video; with a
mic, its bars show the mic's level, so a mic that hears nothing shows at once;
Ctrl+Shift+Alt+S stops and Ctrl+Shift+Alt+M sets a marker. The bar's Script holds the steps of
the demo (a title each, and what to say; a pasted list becomes steps). While recording, a prompter
by the HUD shows the step now, its note and the step after it, never in the video:
```

with:

```markdown
(Ctrl+Shift+Option+R on a Mac) shows a picker over every display: the window under the pointer lights up (the display where there is none), a drag draws a
region, and the bar sets the camera, the mic and when to stop (your stop, Claude's answer, an idle
screen). After the countdown only a small HUD remains, which never appears in the video; with a
mic, its bars show the mic's level, so a mic that hears nothing shows at once, and once a speech
model is downloaded, a line under it shows what the mic hears as you speak (live captions, about
two seconds behind, with the fastest model there; nothing of it is saved);
Ctrl+Shift+Alt+S stops and Ctrl+Shift+Alt+M sets a marker. The bar's Script holds the steps of
the demo (a title each, and what to say; a pasted list becomes steps). While recording, a prompter
by the HUD shows the step now, its note and the step after it, never in the video:
```

In the same file, replace:

```markdown
request, the `cuttle` command (the app's own copy of the CLI, run by the app itself, in
`%LOCALAPPDATA%\Cuttle\bin`, which goes on your PATH; `~/.local/bin` on macOS) and the Claude skill. The settings (the tray,
the pill's menu, Ctrl+, in the editor) hold the projects folder, the countdown, the default camera
and mic, starting at sign-in, motion, and the recent projects (open, rename, show, remove).

## The CLI
```

with:

```markdown
request, the `cuttle` command (the app's own copy of the CLI, run by the app itself, in
`%LOCALAPPDATA%\Cuttle\bin`, which goes on your PATH; `~/.local/bin` on macOS) and the Claude skill. The settings (the tray,
the pill's menu, Ctrl+, in the editor) hold the projects folder, the countdown, the default camera
and mic, speech (the model, the language, the live captions), starting at sign-in, motion, and the
recent projects (open, rename, show, remove).

## The CLI
```

```bash
git add README.md
git commit -m "docs: live captions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 947 passed and 79 skipped (here, with a speech model and ffmpeg's whisper filter; without them the real transcriptions are skipped too, and off Windows and macOS the OCR tests).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 15 tests.

Run: `pnpm app:check`
Expected: PASS, 58 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 3: By hand (the user)**

1. With a speech model downloaded, record with your mic and speak. Your words show under the HUD's bar about two seconds later; while paused the line dims.
2. Watch the take afterwards for stutters: whisper runs beside the capture (on the GPU where there is one). If a take stutters with the captions on and not with them off, switch them off in the settings (Speech, "Live captions while recording").
3. Switch them off in the settings: the next take's HUD has no line.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run. The windows mode that macOS's whisper-cli uses was tested with ffmpeg's filter on Windows; whisper-cli itself was not run.

**Found while checking, and already in the plan above**
- **The HUD came up empty** with the first build: its window may only listen to the channels `channels.ts` lists, and `hud:caption` was not among them yet.
- **The fade at the line's left end hid the line's own background:** it is on the words only.
- **The words stood two spaces apart:** the line was a flex box with a gap; the words are plain inline text now.
- **The HUD gave each word a key from the end of its list**, so a new word took over an old word's element and never faded in. Each word now keeps its number.

**Seen while checking, not changed**
- In one of the two full `pnpm test` runs, a random edit-sequence test of `document.test.ts` ran past its 5 s, as it has before on a loaded machine; the new real transcriptions run beside it. It passed in the other run and alone.

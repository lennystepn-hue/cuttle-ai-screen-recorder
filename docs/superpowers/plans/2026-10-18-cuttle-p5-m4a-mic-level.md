# Cuttle P5-M4a: the Mic's Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a take records with a mic, its level shows, so a mic that hears nothing is seen at once (the roadmap's "a check that the mic works"):
- **In the HUD:** five bars by the time rise with the sound and turn red at the top when the mic clips. They go dark while paused.
- **In `cuttle record`:** a line after the mic's first second says whether it hears sound, so Claude can ask the user to check the mic.

**Architecture:**
- **`@cuttle/recorder`:**
  - The mic's ffmpeg writes its sound a second time, as 16 kHz mono 16-bit samples, to its stdout.
  - `spawnCapture` hands that to the caller as it comes.
  - `levelMeter` turns the samples into an RMS and a peak in dBFS every tenth of a second, which `record` reports as `level` events while the take records.
  - The same samples will feed P5-M4b's live captions.
- **The app:**
  - The HUD's state says whether the take has a mic.
  - The main process passes each level on (`hud:level`).
  - The HUD draws the bars.
- **The CLI:** `cuttle record` tells after the first second whether the mic hears sound.

**Tech Stack:** TypeScript strict, ffmpeg, React 19, Electron 44.7.2.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-roadmap-p4-p6.md` (P5-M4: "Live captions in the HUD while recording, with a mic level (also a check that the mic works)"). This milestone makes the level; P5-M4b the live captions. Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m3c-step-titles-zooms.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m4a`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The full `pnpm test` and the typecheck run in Task 4.

## Decisions made while planning

A prototype of the milestone, checked against the roadmap, settled these points. The finished prototype passed `pnpm test` (936 tests, 78 skipped, in two full runs), the typecheck, `app:check` (57 tests) and `cli:check` (15). Every screenshot was looked at.

- **The level comes from the mic's own capture:**
  - A third branch of its filter graph (`asplit=3`) resamples the sound to 16 kHz mono 16-bit and writes it to ffmpeg's stdout, after the track's own output.
  - Nothing else opens the device (a second capture of it could fail or drift), and the track is written as before.
  - 16 kHz mono is what speech recognition takes, so P5-M4b's live captions read the same samples.
  - `-flush_packets 1` sends the samples as they come.
- **The stdout is always read** while ffmpeg runs: a full pipe would stall the capture.
- **A level every tenth of a second:** the RMS and the peak in dBFS, rounded to 0.1, at least −90 (digital silence). Only while the take records: nothing while paused, nothing after the stop.
- **The HUD's bars:**
  - Five bars, lit from −55, −45, −35, −25 and −15 dBFS.
  - They rise at once and fall by 6 dB a tenth of a second, so speech does not flicker.
  - The top one turns red when a sample reaches −1 dBFS (the mic clips).
  - They show only for a take with a mic, by the time, and go dark while the take does not record.
  - Their tooltip says what no bars mean ("muted, or the wrong mic?"). The silent-mic warning stays as it was.
- **`cuttle record` tells it once,** after the mic's first second (its loudest level then):
  - `mic: it hears sound (-21 dBFS at the loudest)`.
  - Below −60 dBFS: `mic: it hears almost nothing … muted, or the wrong mic?`.
  - Digital silence says nothing more: the silent-mic warning already does.
  - The skill tells Claude to ask the user to check the mic then.

## File structure

| File | Responsibility |
|---|---|
| `packages/recorder/src/{level,args,ffmpeg,record,types,index}.ts` | the samples, the level, the `level` event |
| `apps/cli/src/commands/record.ts` | the first second's line |
| `apps/desktop/src/shared/{ipc,channels}.ts`, `apps/desktop/src/main/recording.ts`, `apps/desktop/src/renderer/picker/{Hud.tsx,picker.css}` | the HUD's bars |
| `README.md`, `skill/cuttle/SKILL.md` | the guides |

---

### Task 1: The mic's samples and its level in the recorder

**Files:**
- Create: `packages/recorder/src/level.ts`, `packages/recorder/test/level.test.ts`
- Modify: `packages/recorder/src/args.ts`, `packages/recorder/src/ffmpeg.ts`, `packages/recorder/src/record.ts`, `packages/recorder/src/types.ts`, `packages/recorder/src/index.ts`, `packages/recorder/test/args.test.ts`, `packages/recorder/test/record.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m4a`; work there:

```bash
git switch p5-m4a
```

- [ ] **Step 2: Write the failing tests**

`packages/recorder/test/level.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { levelMeter, PCM_RATE, type MicLevel } from '../src/level';

/** `seconds` of a sine at `amplitude` (of full scale) as 16-bit little-endian samples. */
function sine(seconds: number, amplitude: number): Uint8Array {
  const count = Math.round(seconds * PCM_RATE);
  const bytes = new Uint8Array(count * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i++) view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / PCM_RATE) * amplitude * 32767), true);
  return bytes;
}

describe('levelMeter', () => {
  it('tells the RMS and the peak in dBFS for every tenth of a second', () => {
    const levels: MicLevel[] = [];
    const meter = levelMeter((level) => levels.push(level));
    // a sine at 1/8 of full scale: its RMS is 1/8 ÷ √2, about −21 dBFS; its peak −18 dBFS
    meter(sine(0.35, 1 / 8));
    expect(levels).toHaveLength(3);
    for (const level of levels) {
      expect(level.rms).toBeCloseTo(-21.1, 0);
      expect(level.peak).toBeCloseTo(-18.1, 0);
    }
  });

  it('takes chunks that end inside a sample, and tells digital silence as −90 dBFS', () => {
    const levels: MicLevel[] = [];
    const meter = levelMeter((level) => levels.push(level));
    const loud = sine(0.1, 1);
    // three bytes at a time: every other chunk ends inside a sample
    for (let i = 0; i < loud.length; i += 3) meter(loud.subarray(i, i + 3));
    meter(new Uint8Array(PCM_RATE * 0.1 * 2));
    expect(levels).toEqual([
      { rms: expect.closeTo(-3, 0), peak: expect.closeTo(0, 0) },
      { rms: -90, peak: -90 },
    ]);
  });
});
```

In `packages/recorder/test/args.test.ts`, replace:

```ts
    expect(args).toContain('-c:a aac -b:a 160k -frag_duration 1000000');
  });

  it('reads freezedetect and silencedetect log lines', () => {
    expect(freezeStart('[Parsed_freezedetect_3 @ 00000132707ccd00] lavfi.freezedetect.freeze_start: 0.973633')).toBe(0.973633);
    expect(freezeStart('[Parsed_freezedetect_3 @ 0000] lavfi.freezedetect.freeze_start: 0')).toBe(0);
```

with:

```ts
    expect(args).toContain('-c:a aac -b:a 160k -frag_duration 1000000');
  });

  it('writes the mic as 16 kHz mono samples to stdout too, for its level, after the track', () => {
    const args = micArgs(input, 'mic.m4a');
    expect(args.join(' ')).toContain('[pcm]aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono[raw]');
    expect(args.slice(args.indexOf('mic.m4a'))).toEqual(['mic.m4a', '-map', '[raw]', '-f', 's16le', '-flush_packets', '1', 'pipe:1']);
  });

  it('reads freezedetect and silencedetect log lines', () => {
    expect(freezeStart('[Parsed_freezedetect_3 @ 00000132707ccd00] lavfi.freezedetect.freeze_start: 0.973633')).toBe(0.973633);
    expect(freezeStart('[Parsed_freezedetect_3 @ 0000] lavfi.freezedetect.freeze_start: 0')).toBe(0);
```

In `packages/recorder/test/record.test.ts`, replace:

```ts
      { t: expect.closeTo(markedSecond, 1), kind: 'manual', label: 'one second' },
      { t: expect.closeTo(slipSecond, 1), kind: 'retake' },
    ]);
    expect(events.map((event) => event.type)).toEqual(['processes', 'recording', 'marker', 'marker', 'stopping']);
    // screen, webcam and mic: the app kills these when its recorder host dies
    const processes = events[0]!;
    expect(processes.type === 'processes' && processes.pids.length === 3 && processes.pids.every(Number.isInteger)).toBe(true);
```

with:

```ts
      { t: expect.closeTo(markedSecond, 1), kind: 'manual', label: 'one second' },
      { t: expect.closeTo(slipSecond, 1), kind: 'retake' },
    ]);
    expect(events.filter((event) => event.type !== 'level').map((event) => event.type)).toEqual(['processes', 'recording', 'marker', 'marker', 'stopping']);
    // the mic's level while it records: the test mic's sine at 1/8 of full scale is about -21 dBFS
    const levels = events.flatMap((event) => (event.type === 'level' ? [event.rms] : []));
    expect(levels.length).toBeGreaterThan(15);
    expect(levels.every((rms) => rms > -22.5 && rms < -19.5)).toBe(true);
    // screen, webcam and mic: the app kills these when its recorder host dies
    const processes = events[0]!;
    expect(processes.type === 'processes' && processes.pids.length === 3 && processes.pids.every(Number.isInteger)).toBe(true);
```

In the same file, replace:

```ts
  it('stops when asked and warns about a silent microphone', async () => {
    const projectDir = project();
    const warnings: string[] = [];
    const recording = record({ ...test, projectDir, mic: 'Silent Test Microphone', stop: {}, onEvent: (event) => event.type === 'warning' && warnings.push(event.message) });
    await sleep(2000);
    const take = await recording.stop();
    expect(take.stopReason).toBe('stop');
    expect(take.warnings).toEqual(['the microphone "Silent Test Microphone" records silence: it may be muted, or blocked for desktop apps (Windows: Settings > Privacy & security > Microphone)']);
    expect(warnings).toEqual(take.warnings);
  }, SLOW);

  it('turns a throwing onEvent into a warning instead of a failed take', async () => {
```

with:

```ts
  it('stops when asked and warns about a silent microphone', async () => {
    const projectDir = project();
    const warnings: string[] = [];
    const levels: number[] = [];
    const recording = record({
      ...test,
      projectDir,
      mic: 'Silent Test Microphone',
      stop: {},
      onEvent: (event) => {
        if (event.type === 'warning') warnings.push(event.message);
        if (event.type === 'level') levels.push(event.rms, event.peak);
      },
    });
    await sleep(2000);
    const take = await recording.stop();
    expect(take.stopReason).toBe('stop');
    expect(take.warnings).toEqual(['the microphone "Silent Test Microphone" records silence: it may be muted, or blocked for desktop apps (Windows: Settings > Privacy & security > Microphone)']);
    expect(warnings).toEqual(take.warnings);
    // its level says so too: digital silence
    expect(levels.length).toBeGreaterThan(0);
    expect(new Set(levels)).toEqual(new Set([-90]));
  }, SLOW);

  it('turns a throwing onEvent into a warning instead of a failed take', async () => {
```

Run: `pnpm exec vitest run --project node packages/recorder/test/level.test.ts packages/recorder/test/args.test.ts`
Expected: FAIL: there is no `../src/level`, and the mic's samples are not on stdout.

- [ ] **Step 3: The level, the samples, the event**

`packages/recorder/src/level.ts`:

```ts
// The mic's level while it records, from its sound as 16 kHz mono 16-bit samples (the mic's capture
// writes them to its stdout beside the track): how loud it is (RMS) and its loudest sample, in dB
// below full scale, every tenth of a second. Pure.

/** The rate of the samples the mic's capture gives (16 kHz mono, as speech recognition takes them too). */
export const PCM_RATE = 16_000;
/** A level is measured over this many seconds. */
export const LEVEL_SECONDS = 0.1;
/** The quietest level told (dBFS): digital silence. */
export const LEVEL_FLOOR = -90;

export interface MicLevel {
  /** How loud, on average (RMS), in dBFS. */
  rms: number;
  /** The loudest sample, in dBFS (0: the mic clips). */
  peak: number;
}

const decibels = (value: number) => (value <= 0 ? LEVEL_FLOOR : Math.max(LEVEL_FLOOR, Math.round(20 * Math.log10(value) * 10) / 10));

/**
 * Takes the samples as they come (a chunk may end inside a sample) and calls `onLevel` once for each
 * tenth of a second of them.
 */
export function levelMeter(onLevel: (level: MicLevel) => void): (chunk: Uint8Array) => void {
  const size = Math.round(PCM_RATE * LEVEL_SECONDS);
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

In `packages/recorder/src/args.ts`, replace:

```ts
// ffmpeg command lines for the three capture processes. Pure: the inputs come from sources.ts.

export const FRAME_RATE = 30;
```

with:

```ts
// ffmpeg command lines for the three capture processes. Pure: the inputs come from sources.ts.
import { PCM_RATE } from './level';

export const FRAME_RATE = 30;
```

In the same file, replace:

```ts
  return [...(wallclock ? WALLCLOCK : []), ...input, '-filter_complex', `[0:v]${VIDEO_CHAIN}[out]`, '-map', '[out]', ...VIDEO_CODEC, ...FRAGMENTED_MP4, '-y', file];
}

/** The mic track, with `silencedetect` on a copy so a muted microphone can be reported. */
export function micArgs(input: readonly string[], file: string, wallclock = true): string[] {
  const graph = `[0:a]asplit[rec][chk];[chk]silencedetect=n=${SILENCE_NOISE}:d=${SILENCE_SECONDS},anullsink;[rec]anull[out]`;
  return [...(wallclock ? WALLCLOCK : []), ...input, '-filter_complex', graph, '-map', '[out]', ...AUDIO_CODEC, ...AUDIO_FRAGMENTS, ...FRAGMENTED_MP4, '-y', file];
}

/** `[Parsed_freezedetect_3 @ …] lavfi.freezedetect.freeze_start: 0.973633` → 0.973633 */
```

with:

```ts
  return [...(wallclock ? WALLCLOCK : []), ...input, '-filter_complex', `[0:v]${VIDEO_CHAIN}[out]`, '-map', '[out]', ...VIDEO_CODEC, ...FRAGMENTED_MP4, '-y', file];
}

/**
 * The mic track, with `silencedetect` on a copy so a muted microphone can be reported, and its sound
 * as 16 kHz mono 16-bit samples on stdout, for its level while it records.
 */
export function micArgs(input: readonly string[], file: string, wallclock = true): string[] {
  const graph = `[0:a]asplit=3[rec][chk][pcm];[chk]silencedetect=n=${SILENCE_NOISE}:d=${SILENCE_SECONDS},anullsink;[rec]anull[out];[pcm]aresample=${PCM_RATE},aformat=sample_fmts=s16:channel_layouts=mono[raw]`;
  return [
    ...(wallclock ? WALLCLOCK : []),
    ...input,
    '-filter_complex',
    graph,
    '-map',
    '[out]',
    ...AUDIO_CODEC,
    ...AUDIO_FRAGMENTS,
    ...FRAGMENTED_MP4,
    '-y',
    file,
    '-map',
    '[raw]',
    '-f',
    's16le',
    '-flush_packets',
    '1',
    'pipe:1',
  ];
}

/** `[Parsed_freezedetect_3 @ …] lavfi.freezedetect.freeze_start: 0.973633` → 0.973633 */
```

In `packages/recorder/src/ffmpeg.ts`, replace:

```ts
/**
 * Starts one capture process. `name` labels its errors ("screen", "webcam", "mic"). With a `feeder`,
 * ffmpeg reads that process's output; the feeder ends with ffmpeg, and its own failure is the one reported.
 */
export function spawnCapture(name: string, args: readonly string[], feeder?: Feeder): CaptureProcess {
  const feed = feeder && spawn(feeder.command, [...feeder.args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const feedTail: string[] = [];
  feed?.stderr?.setEncoding('utf8');
  feed?.stderr?.on('data', (chunk: string) => feedTail.push(...chunk.split(/\r?\n/).filter((line) => line.trim() !== '')));
  feed?.on('error', () => {}); // a feeder that cannot start ends its pipe: ffmpeg reports that
  const feedExit = feed && new Promise<number | null>((resolve) => feed.once('close', (code) => resolve(code)));
  // stdin for "q", stderr for the log; a feeder's pipe as file descriptor 3
  const child = spawn(ffmpegPath(), ['-hide_banner', ...args], { stdio: ['pipe', 'ignore', 'pipe', ...(feed ? [feed.stdout] : [])], windowsHide: true }) as ChildProcessByStdio<Writable, null, Readable>;
  // ffmpeg holds the pipe now: this process lets go of it, so the feeder sees ffmpeg's end
  feed?.stdout?.destroy();
  const listeners: ((line: string) => void)[] = [];
```

with:

```ts
/**
 * Starts one capture process. `name` labels its errors ("screen", "webcam", "mic"). With a `feeder`,
 * ffmpeg reads that process's output; the feeder ends with ffmpeg, and its own failure is the one reported.
 * `onStdout` takes what ffmpeg writes to its stdout (the mic's samples), as it comes.
 */
export function spawnCapture(name: string, args: readonly string[], feeder?: Feeder, onStdout?: (chunk: Buffer) => void): CaptureProcess {
  const feed = feeder && spawn(feeder.command, [...feeder.args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const feedTail: string[] = [];
  feed?.stderr?.setEncoding('utf8');
  feed?.stderr?.on('data', (chunk: string) => feedTail.push(...chunk.split(/\r?\n/).filter((line) => line.trim() !== '')));
  feed?.on('error', () => {}); // a feeder that cannot start ends its pipe: ffmpeg reports that
  const feedExit = feed && new Promise<number | null>((resolve) => feed.once('close', (code) => resolve(code)));
  // stdin for "q", stdout for what the caller reads (else nothing), stderr for the log; a feeder's pipe as file descriptor 3
  const child = spawn(ffmpegPath(), ['-hide_banner', ...args], { stdio: ['pipe', onStdout ? 'pipe' : 'ignore', 'pipe', ...(feed ? [feed.stdout] : [])], windowsHide: true }) as ChildProcessByStdio<Writable, Readable | null, Readable>;
  // read as it comes: a full pipe would stall ffmpeg
  if (onStdout) child.stdout?.on('data', onStdout);
  // ffmpeg holds the pipe now: this process lets go of it, so the feeder sees ffmpeg's end
  feed?.stdout?.destroy();
  const listeners: ((line: string) => void)[] = [];
```

In `packages/recorder/src/types.ts`, replace:

```ts
  /** Every track is capturing; `dir` is the take folder relative to the project. */
  | { type: 'recording'; dir: string }
  | { type: 'marker'; marker: Marker }
  | { type: 'warning'; message: string }
  /** Every track has stopped: nothing is captured or logged until a resume. */
  | { type: 'paused' }
```

with:

```ts
  /** Every track is capturing; `dir` is the take folder relative to the project. */
  | { type: 'recording'; dir: string }
  | { type: 'marker'; marker: Marker }
  /** How loud the mic is now (dBFS), every tenth of a second while it records. */
  | { type: 'level'; rms: number; peak: number }
  | { type: 'warning'; message: string }
  /** Every track has stopped: nothing is captured or logged until a resume. */
  | { type: 'paused' }
```

In `packages/recorder/src/record.ts`, replace:

```ts
import { spawnCapture, type CaptureProcess } from './ffmpeg';
import { captureHelper, helperArgs, helperInput } from './mac-capture';
import { startInput, type InputSource } from './input';
import { FPS as JOIN_FPS, joinSegments, mediaInfo, renameWhenFree } from './join';
import { areaGeometry, checkDevice, deviceClock, micInput, micLatency, platformFor, resolveArea, screenFilter, screenInput, screenLatency, webcamInput, type CameraMode, type Platform, type ScreenArea } from './sources';
import type { Bounds, RawInput, RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';
```

with:

```ts
import { spawnCapture, type CaptureProcess } from './ffmpeg';
import { captureHelper, helperArgs, helperInput } from './mac-capture';
import { startInput, type InputSource } from './input';
import { levelMeter } from './level';
import { FPS as JOIN_FPS, joinSegments, mediaInfo, renameWhenFree } from './join';
import { areaGeometry, checkDevice, deviceClock, micInput, micLatency, platformFor, resolveArea, screenFilter, screenInput, screenLatency, webcamInput, type CameraMode, type Platform, type ScreenArea } from './sources';
import type { Bounds, RawInput, RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';
```

In the same file, replace:

```ts
      ? spawnCapture('screen', screenArgs(helperInput(area), file(FILES.screen), options.stop.untilIdleSeconds), { command: helper, args: helperArgs(area, drawMouse, options.hideWindowsOf ?? []) })
      : spawnCapture('screen', screenArgs(screenInput(platform, area, drawMouse), file(FILES.screen), options.stop.untilIdleSeconds, screenFilter(platform, area)));
    const webcam = options.webcam === undefined ? undefined : spawnCapture('webcam', webcamArgs(webcamInput(platform, options.webcam, cameraMode), file(FILES.webcam), !ownStamps));
    const mic = options.mic === undefined ? undefined : spawnCapture('mic', micArgs(micInput(platform, options.mic), file(FILES.mic), !ownStamps));
    // Rejects with the first capture that fails; `exited` only resolves after stop() was called.
    const failed: Promise<never> = Promise.race([screen, webcam, mic].filter((capture) => capture !== undefined).map((capture) => capture.exited)).then(() => new Promise<never>(() => {}));
    failed.catch(() => {});
```

with:

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

In `packages/recorder/src/index.ts`, replace:

```ts
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
export { claudeTranscriptDir, readTranscriptLine, recentClaudeFolders, SessionReader, type ClaudeFolder, type ClaudeSignal } from './claude';
export { focusWindow } from './devices';
/** macOS's helper (native/macos/capture.swift), which also reads pictures' text (`cuttle-capture ocr`). */
```

with:

```ts
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
export { LEVEL_FLOOR, PCM_RATE, levelMeter, type MicLevel } from './level';
export { claudeTranscriptDir, readTranscriptLine, recentClaudeFolders, SessionReader, type ClaudeFolder, type ClaudeSignal } from './claude';
export { focusWindow } from './devices';
/** macOS's helper (native/macos/capture.swift), which also reads pictures' text (`cuttle-capture ocr`). */
```

Run: `pnpm exec vitest run --project node packages/recorder`
Expected: PASS (the test mic's tone at about −21 dBFS, the silent one at −90).

- [ ] **Step 4: Commit**

```bash
git add packages/recorder
git commit -m "recorder: the mic's level while it records, from its samples on the capture's stdout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `cuttle record` says whether the mic hears sound

**Files:**
- Modify: `apps/cli/src/commands/record.ts`, `apps/cli/test/cli.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/cli/test/cli.test.ts`, replace:

```ts
    const script = [{ id: 'step1', title: 'Open the settings', note: 'The gear, top right.' }, { id: 'step2', title: 'Turn on dark mode' }];
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), script }));
    let stderr = '';
    const code = await runCli(['-C', dir, 'record', '--backend', 'test', '--max', '1', '--countdown', '0'], { stdout: () => {}, stderr: (chunk) => void (stderr += chunk) });
    expect(code, stderr).toBe(0);
    expect(stderr).toContain('script: 2 steps; next step: Ctrl+Shift+Alt+N, back: Ctrl+Shift+Alt+B');
    expect(stderr).toContain('step 1/2: Open the settings at 0.00 s');
    expect(JSON.parse(readFileSync(join(dir, 'takes/1/markers.json'), 'utf8')).markers).toEqual([{ t: 0, kind: 'step', label: 'step1' }]);
```

with:

```ts
    const script = [{ id: 'step1', title: 'Open the settings', note: 'The gear, top right.' }, { id: 'step2', title: 'Turn on dark mode' }];
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), script }));
    let stderr = '';
    const code = await runCli(['-C', dir, 'record', '--backend', 'test', '--mic', '--max', '2', '--countdown', '0'], { stdout: () => {}, stderr: (chunk) => void (stderr += chunk) });
    expect(code, stderr).toBe(0);
    // and whether the mic hears anything, after its first second: the test mic's tone
    expect(stderr).toContain('mic: it hears sound (-21 dBFS at the loudest)');
    expect(stderr).toContain('script: 2 steps; next step: Ctrl+Shift+Alt+N, back: Ctrl+Shift+Alt+B');
    expect(stderr).toContain('step 1/2: Open the settings at 0.00 s');
    expect(JSON.parse(readFileSync(join(dir, 'takes/1/markers.json'), 'utf8')).markers).toEqual([{ t: 0, kind: 'step', label: 'step1' }]);
```

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts -t "project's script"`
Expected: FAIL: no `mic:` line.

- [ ] **Step 2: The line after the first second**

In `apps/cli/src/commands/record.ts`, replace:

```ts
import { rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { HOTKEYS, listDevices, record, type Backend, type CaptureSource, type Take } from '@cuttle/recorder';
import type { Rect } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';
import { editorLockOf, newProjectFile, projectExists, readProjectFile, useTake, writeProjectFile } from '@cuttle/core';

export interface RecordArgs {
  monitor?: number;
  /** "x,y,w,h" in pixels of `monitor` (default: the primary monitor); PowerShell passes it split at the commas. */
```

with:

```ts
import { rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { HOTKEYS, LEVEL_FLOOR, listDevices, record, type Backend, type CaptureSource, type Take } from '@cuttle/recorder';
import type { Rect } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';
import { editorLockOf, newProjectFile, projectExists, readProjectFile, useTake, writeProjectFile } from '@cuttle/core';

/** The mic's first second (its levels, a tenth of a second each) tells whether it hears anything. */
const MIC_CHECK_LEVELS = 10;
/** A mic whose loudest level in its first second stays below this (dBFS) hears almost nothing. */
const MIC_QUIET = -60;

export interface RecordArgs {
  monitor?: number;
  /** "x,y,w,h" in pixels of `monitor` (default: the primary monitor); PowerShell passes it split at the commas. */
```

In the same file, replace:

```ts
  const before = projectExists(projectDir) ? await readProjectFile(projectDir) : (await writeProjectFile(newProjectFile(projectDir), 'record')).file;
  if (signal.aborted) throw new CliError('cancelled', 'stopped before the recording started');
  const script = before.project.script;
  const stepLine = (id: string | undefined) => {
    const index = script.findIndex((step) => step.id === id);
    return index < 0 ? undefined : `step ${index + 1}/${script.length}: ${script[index]!.title}`;
```

with:

```ts
  const before = projectExists(projectDir) ? await readProjectFile(projectDir) : (await writeProjectFile(newProjectFile(projectDir), 'record')).file;
  if (signal.aborted) throw new CliError('cancelled', 'stopped before the recording started');
  const script = before.project.script;
  // the mic's level in its first second: whether it hears anything (a silent one is warned about apart)
  let heard: number[] | undefined = [];
  const hearing = (rms: number) => {
    if (!heard) return;
    heard.push(rms);
    if (heard.length < MIC_CHECK_LEVELS) return;
    const loudest = Math.max(...heard);
    heard = undefined;
    if (loudest <= LEVEL_FLOOR) return;
    output.info(loudest < MIC_QUIET ? `mic: it hears almost nothing (${Math.round(loudest)} dBFS at the loudest): muted, or the wrong mic? ("cuttle devices" lists them)` : `mic: it hears sound (${Math.round(loudest)} dBFS at the loudest)`);
  };
  const stepLine = (id: string | undefined) => {
    const index = script.findIndex((step) => step.id === id);
    return index < 0 ? undefined : `step ${index + 1}/${script.length}: ${script[index]!.title}`;
```

In the same file, replace:

```ts
    ...(script.length > 0 && { steps: script.map((step) => step.id) }),
    onEvent(event) {
      if (event.type === 'countdown') output.info(`recording in ${event.seconds} …`);
      if (event.type === 'recording') output.info(`recording ${event.dir}; stop: Ctrl+C or ${HOTKEYS.stop}, marker: ${HOTKEYS.marker}, pause: ${HOTKEYS.pause}, a slip: ${HOTKEYS.retake}`);
      if (event.type === 'recording' && script.length > 0) output.info(`script: ${script.length} steps; next step: ${HOTKEYS.next}, back: ${HOTKEYS.previous}`);
      if (event.type === 'paused') output.info(`paused: nothing is recorded until ${HOTKEYS.pause} again`);
```

with:

```ts
    ...(script.length > 0 && { steps: script.map((step) => step.id) }),
    onEvent(event) {
      if (event.type === 'countdown') output.info(`recording in ${event.seconds} …`);
      if (event.type === 'level') hearing(event.rms);
      if (event.type === 'recording') output.info(`recording ${event.dir}; stop: Ctrl+C or ${HOTKEYS.stop}, marker: ${HOTKEYS.marker}, pause: ${HOTKEYS.pause}, a slip: ${HOTKEYS.retake}`);
      if (event.type === 'recording' && script.length > 0) output.info(`script: ${script.length} steps; next step: ${HOTKEYS.next}, back: ${HOTKEYS.previous}`);
      if (event.type === 'paused') output.info(`paused: nothing is recorded until ${HOTKEYS.pause} again`);
```

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/cli
git commit -m "cli: record says after the mic's first second whether it hears sound

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The HUD's bars

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/main/recording.ts`, `apps/desktop/src/renderer/picker/Hud.tsx`, `apps/desktop/src/renderer/picker/picker.css`, `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The level to the HUD**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
  detail?: string;
  /** `warn`: a warning (amber); `info`: a state ("Stopping…"). */
  tone?: 'warn' | 'info';
}

/** What the main process is doing to a project, shown in its editor's title bar. */
```

with:

```ts
  detail?: string;
  /** `warn`: a warning (amber); `info`: a state ("Stopping…"). */
  tone?: 'warn' | 'info';
  /** The take records a mic: the HUD shows its level (`hud:level`). */
  mic?: boolean;
}

/** What the main process is doing to a project, shown in its editor's title bar. */
```

In the same file, replace:

```ts
  /** `restart`: counting down again after a restart (the take before is kept). */
  'countdown:tick': { seconds: number; restart?: boolean };
  'hud:state': HudState;
  /** What the main process is doing to the project (cutting the take), or nothing. */
  'project:status': ProjectStatus;
  'project:file': ProjectFileEvent;
```

with:

```ts
  /** `restart`: counting down again after a restart (the take before is kept). */
  'countdown:tick': { seconds: number; restart?: boolean };
  'hud:state': HudState;
  /** The mic's level now (dBFS), ten times a second while the take records. */
  'hud:level': { rms: number; peak: number };
  /** What the main process is doing to the project (cutting the take), or nothing. */
  'project:status': ProjectStatus;
  'project:file': ProjectFileEvent;
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
  },
  hud: {
    requests: ['hud:stop', 'hud:marker', 'hud:retake', 'hud:pause', 'hud:resume', 'hud:restart'],
    events: ['hud:state', 'app:motion'],
  },
  prompter: {
    requests: ['prompter:next', 'prompter:previous', 'prompter:size'],
```

with:

```ts
  },
  hud: {
    requests: ['hud:stop', 'hud:marker', 'hud:retake', 'hud:pause', 'hud:resume', 'hud:restart'],
    events: ['hud:state', 'hud:level', 'app:motion'],
  },
  prompter: {
    requests: ['prompter:next', 'prompter:previous', 'prompter:size'],
```

In `apps/desktop/src/main/recording.ts`, replace:

```ts
        () => {},
      );
      const hud = overlay({ ...hudPosition(displays, display.id, area, HUD_SIZE), ...HUD_SIZE }, 'hud.cjs', { focusable: false, movable: true });
      const hudState: HudState = { phase: 'countdown', markers: 0 };
      // a check of the drive or the window still under way may note something after the HUD closed
      const showHud = () => !hud.isDestroyed() && send(hud.webContents, 'hud:state', { ...hudState });
      /** The last warning: a pause shows its own note, the resume brings the warning back. */
```

with:

```ts
        () => {},
      );
      const hud = overlay({ ...hudPosition(displays, display.id, area, HUD_SIZE), ...HUD_SIZE }, 'hud.cjs', { focusable: false, movable: true });
      const hudState: HudState = { phase: 'countdown', markers: 0, ...(choices.mic && { mic: true }) };
      // a check of the drive or the window still under way may note something after the HUD closed
      const showHud = () => !hud.isDestroyed() && send(hud.webContents, 'hud:state', { ...hudState });
      /** The last warning: a pause shows its own note, the resume brings the warning back. */
```

In the same file, replace:

```ts
            else hudState.markers++;
            showHud();
            return;
          case 'warning': {
            const warning = hudWarning(event.message);
            note(warning.text, warning.detail, 'warn');
```

with:

```ts
            else hudState.markers++;
            showHud();
            return;
          case 'level':
            if (!hud.isDestroyed()) send(hud.webContents, 'hud:level', { rms: event.rms, peak: event.peak });
            return;
          case 'warning': {
            const warning = hudWarning(event.message);
            note(warning.text, warning.detail, 'warn');
```

- [ ] **Step 2: The bars**

In `apps/desktop/src/renderer/picker/Hud.tsx`, replace:

```tsx
// The recording HUD: the time, a warning when there is one, restart, the mistake key, a marker,
// pause and Stop. It
// is never in the video (content protection), never takes the focus (the recorded window keeps it),
// and its area is a dead zone for the input log. Its width is fixed, so Stop never moves under the
// pointer. Restart asks for a press held 600 ms, so a stray click does not put a take aside.
```

with:

```tsx
// The recording HUD: the time, the mic's level, a warning when there is one, restart, the mistake
// key, a marker, pause and Stop. It
// is never in the video (content protection), never takes the focus (the recorded window keeps it),
// and its area is a dead zone for the input log. Its width is fixed, so Stop never moves under the
// pointer. Restart asks for a press held 600 ms, so a stray click does not put a take aside.
```

In the same file, replace:

```tsx
        <span className="time" data-testid="hud-time">
          {clock(seconds)}
        </span>
        <span className={`note${state.tone === 'warn' && !hint ? ' warn' : ''}`} title={hint ?? state.detail ?? state.message} role="status" data-testid="hud-note">
          {hint ? (
            <span>{hint}</span>
```

with:

```tsx
        <span className="time" data-testid="hud-time">
          {clock(seconds)}
        </span>
        {state.mic && <MicLevel live={state.phase === 'recording'} />}
        <span className={`note${state.tone === 'warn' && !hint ? ' warn' : ''}`} title={hint ?? state.detail ?? state.message} role="status" data-testid="hud-note">
          {hint ? (
            <span>{hint}</span>
```

In the same file, replace:

```tsx
  );
}

/** Restart: held 600 ms (a ring fills meanwhile); let go earlier and nothing happens. */
function RestartButton({ disabled, onShortPress }: { disabled: boolean; onShortPress: () => void }) {
  const [holding, setHolding] = useState(false);
```

with:

```tsx
  );
}

/** Where the mic's bars light up (dBFS of its level); the top one turns red when the mic clips. */
const BARS = [-55, -45, -35, -25, -15];
/** A level this close to full scale (dBFS) clips. */
const CLIPS = -1;

/**
 * The mic's level: five bars that light up as it hears something, so a mic that hears nothing shows
 * at once. They rise with the sound and fall back slowly; dark while the take does not record.
 */
function MicLevel({ live }: { live: boolean }) {
  const [shown, setShown] = useState({ rms: -90, peak: -90 });
  useEffect(
    () =>
      bridge.on('hud:level', (level) =>
        // up at once, down by 6 dB a tenth of a second
        setShown((before) => ({ rms: Math.max(level.rms, before.rms - 6), peak: level.peak })),
      ),
    [],
  );
  const rms = live ? shown.rms : -90;
  const lit = BARS.filter((at) => rms >= at).length;
  const clips = live && shown.peak >= CLIPS;
  return (
    <span className="level" role="meter" aria-label="Mic level" aria-valuemin={-90} aria-valuemax={0} aria-valuenow={Math.round(rms)} title={lit === 0 ? 'The mic hears nothing: muted, or the wrong mic?' : 'The mic’s level'} data-testid="hud-level" data-level={lit}>
      {BARS.map((at, i) => (
        <i key={at} className={i < lit ? (clips && i === BARS.length - 1 ? 'on clip' : 'on') : undefined} style={{ height: 4 + i * 2.5 }} />
      ))}
    </span>
  );
}

/** Restart: held 600 ms (a ring fills meanwhile); let go earlier and nothing happens. */
function RestartButton({ disabled, onShortPress }: { disabled: boolean; onShortPress: () => void }) {
  const [holding, setHolding] = useState(false);
```

In `apps/desktop/src/renderer/picker/picker.css`, replace:

```css
  min-width: 52px;
  color: var(--text);
}
.hud .sep {
  width: 1px;
  height: 22px;
```

with:

```css
  min-width: 52px;
  color: var(--text);
}
/* the mic's level: five bars by the time, rising as it hears something */
.hud .level {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
  margin: 0 10px 0 0;
  flex: none;
}
.hud .level i {
  width: 3px;
  border-radius: 1px;
  background: var(--raised-active);
  transition: background 80ms linear;
}
.hud .level i.on {
  background: var(--caption);
}
.hud .level i.clip {
  background: var(--recording);
}
.hud .sep {
  width: 1px;
  height: 22px;
```

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 3: The check**

A take from the pill with the test mic:
- four bars light (its tone is about −21 dBFS), and they fit the HUD;
- dark while paused, and lit again after the resume.

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 120_000);

  it('marks a slip from the HUD (the mistake key): it says what to do next, and the cut goes back from there', async () => {
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    await recordThroughPicker(pillRecord, { stop: 'none', camera: undefined }, false);
```

with:

```ts
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 120_000);

  it("shows the mic's level in the HUD: its bars rise with the test mic's tone and go dark while paused", async () => {
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    await recordThroughPicker(pillRecord, { stop: 'none', camera: undefined, mic: 'Test Microphone' }, false);
    const hud = await runningHud();
    const lit = () => hud.locator('[data-testid=hud-level]').getAttribute('data-level');
    // the test mic's tone is about -21 dBFS: four of the five bars
    await expect.poll(lit, { timeout: 10_000 }).toBe('4');
    // the bars fit the HUD beside the time, the note and the buttons
    expect(await hud.evaluate(() => document.querySelector('.hud')!.scrollWidth <= document.querySelector('.hud')!.clientWidth)).toBe(true);
    await shotOf('31b-hud-level', '/hud.html');
    await click(hud, '[data-testid=hud-pause]');
    await hud.waitForSelector('.hud.paused');
    await expect.poll(lit).toBe('0');
    await click(hud, '[data-testid=hud-pause]');
    await hud.waitForSelector('.hud.recording');
    await expect.poll(lit, { timeout: 10_000 }).toBe('4');
    await click(hud, '[data-testid=hud-stop]');
    const dir = await newProject(before);
    await projectWhen(dir, (written) => written.scenes[0]?.id !== undefined);
  }, 120_000);

  it('marks a slip from the HUD (the mistake key): it says what to do next, and the cut goes back from there', async () => {
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    await recordThroughPicker(pillRecord, { stop: 'none', camera: undefined }, false);
```

Run: `pnpm app:check`
Expected: PASS, 57 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop
git commit -m "app: the mic's level in the HUD

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The guides, and final verification

**Files:**
- Modify: `README.md`, `skill/cuttle/SKILL.md`

- [ ] **Step 1: The README and the skill**

In `README.md`, replace:

```markdown
**Recording.** "New recording" on the pill, in the tray (the menu bar on macOS), or Ctrl+Shift+Alt+R
(Ctrl+Shift+Option+R on a Mac) shows a picker over every display: the window under the pointer lights up (the display where there is none), a drag draws a
region, and the bar sets the camera, the mic and when to stop (your stop, Claude's answer, an idle
screen). After the countdown only a small HUD remains, which never appears in the video;
Ctrl+Shift+Alt+S stops and Ctrl+Shift+Alt+M sets a marker. The bar's Script holds the steps of
the demo (a title each, and what to say; a pasted list becomes steps). While recording, a prompter
by the HUD shows the step now, its note and the step after it, never in the video:
```

with:

```markdown
**Recording.** "New recording" on the pill, in the tray (the menu bar on macOS), or Ctrl+Shift+Alt+R
(Ctrl+Shift+Option+R on a Mac) shows a picker over every display: the window under the pointer lights up (the display where there is none), a drag draws a
region, and the bar sets the camera, the mic and when to stop (your stop, Claude's answer, an idle
screen). After the countdown only a small HUD remains, which never appears in the video; with a
mic, its bars show the mic's level, so a mic that hears nothing shows at once;
Ctrl+Shift+Alt+S stops and Ctrl+Shift+Alt+M sets a marker. The bar's Script holds the steps of
the demo (a title each, and what to say; a pasted list becomes steps). While recording, a prompter
by the HUD shows the step now, its note and the step after it, never in the video:
```

In `skill/cuttle/SKILL.md`, replace:

```markdown
- The format: 16:9 for X, YouTube and LinkedIn; 9:16 for Shorts, Reels and TikTok; 1:1 for feeds.
  X takes H.264 up to 1920×1200; keep demos under 60 s. A 16:9 screen fills only about a third
  of a 9:16 video: for 9:16 record a narrow window or region, or plan tight zooms.
- Webcam and mic only when asked (`--webcam`, `--mic`). A muted mic is reported as a warning.
  When the user will speak, Cuttle transcribes the mic on this computer and cuts filler words and
  pauses. That needs a speech model: `cuttle --json models` lists them. If none is downloaded, ask
  the user before `cuttle models download small` (488 MB, once). Tell them that a slip needs no
```

with:

```markdown
- The format: 16:9 for X, YouTube and LinkedIn; 9:16 for Shorts, Reels and TikTok; 1:1 for feeds.
  X takes H.264 up to 1920×1200; keep demos under 60 s. A 16:9 screen fills only about a third
  of a 9:16 video: for 9:16 record a narrow window or region, or plan tight zooms.
- Webcam and mic only when asked (`--webcam`, `--mic`). A muted mic is reported as a warning;
  after the mic's first second the output says whether it hears sound (`mic: it hears sound`, or
  `it hears almost nothing`: then ask the user to check the mic before going on).
  When the user will speak, Cuttle transcribes the mic on this computer and cuts filler words and
  pauses. That needs a speech model: `cuttle --json models` lists them. If none is downloaded, ask
  the user before `cuttle models download small` (488 MB, once). Tell them that a slip needs no
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

```bash
git add README.md skill
git commit -m "docs: the mic's level

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 936 passed and 78 skipped (where a speech model is found, its real transcription runs too: 937 and 77; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 15 tests.

Run: `pnpm app:check`
Expected: PASS, 57 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 3: By hand (the user)**

1. Record with your mic: the HUD's bars rise as you speak and fall back when you stop; they are dark while paused.
2. Mute the mic (or pick another one that hears nothing): the bars stay dark, and the HUD warns that the mic is silent.
3. In a terminal, `cuttle record --mic --max 3` prints `mic: it hears sound (… dBFS at the loudest)` after a second.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run. The macOS mic (avfoundation) goes through the same filter graph; its level was not seen there.

**Found while checking, and already in the plan above**
- **The new HUD check found no projects folder** when it ran alone (before any take). It reads the folder only when it is there, as the other recording checks do.

**Spec points that move**
- To **P5-M4b**: the live captions in the HUD, from the same samples.

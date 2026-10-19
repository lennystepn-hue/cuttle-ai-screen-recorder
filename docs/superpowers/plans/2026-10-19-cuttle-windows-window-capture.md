# Cuttle on Windows: a Window Take Records the Window by Itself Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Windows, a window take records that window by itself, as on a Mac.
- The user may work in other windows meanwhile, also over it: what lies over the window is not in the take, and only what is done in the window is logged.
- Until now Windows recorded the screen where the window was (ddagrab, cropped), so the window had to stay in front.
- It needs ffmpeg 8 or newer, which has the `gfxcapture` source (Windows.Graphics.Capture). With an older ffmpeg, `record` warns and records as before.

**Architecture:** `@cuttle/recorder`.
- **The feeder:** a second ffmpeg reads the window with `gfxcapture=hwnd=…` and writes raw BGRA frames to its stdout (`window-capture.ts`). gfxcapture sends a frame only when the window changes.
- **The relay:** the recorder keeps the newest frame and writes it into the take's ffmpeg 30 times a second on its stdin (`relayFrames` in `ffmpeg.ts`, `Feeder.frameBytes`), as the macOS helper writes its frames. ffmpeg stamps each with the wall clock as it reads it. A stop ends stdin.
- **The area:** the whole window at its size when the take starts (`wholeWindow`), its origin the window's corner. The window gate that macOS uses (input only from the window in front, the origin moving with the window) runs on Windows too, with `win32.foreground()`.
- **Its end:** when the window is closed, gfxcapture ends, and the take ends with the stop reason `window` and a warning.
- **The test backend's windows** go the same way, with a test pattern as the window, so the relay runs in every full test run.

**Tech Stack:** TypeScript strict, ffmpeg 8+ (`gfxcapture`), koffi (`timeBeginPeriod`).

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `windows-window-capture`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine; only `pnpm recorder:real` records for real.
- The full `pnpm test` and the typecheck run in Task 3.

## Decisions made while planning

The finished prototype passed `pnpm test` (986 tests, 81 skipped, in two full runs), the typecheck, `cli:check` (16 tests) and `app:check` (58). Every screenshot was looked at. The real check passed on this machine.

Measured on this machine (ffmpeg 9.0, Windows 11) before writing the code, with windows of a probe script that no one sees:
- **Covered windows are captured:** a window entirely under the taskbar came out in its own colours (17 frames in 1.7 s while it repainted 10 times a second), and so did one that lay almost entirely below the monitor.
- **Not a window entirely off every monitor:** Windows does not draw it, so it sends nothing. A take of a minimized window keeps its last picture.
- **A frame only on a change:** ffmpeg's source confirms it never repeats one. While it waits for the next, ffmpeg does not stop on "q" (5 s and still running). Writing the newest frame from the recorder keeps the take at 30 frames a second, lets `--until-idle` see a still window, and stops at once.
- **The cost:** Node pipes 2560×1440 at 30 frames a second (324 MB/s) with 0.3 to 5 % of one core.
- **The clock:**
  - A 33 ms `setInterval` fires every 47 ms on Windows (its timers tick every 15.6 ms), so only 21 frames a second arrived.
  - Writing by the clock (one frame per 1/30 s slot, a late tick writes one) gives 30.3 a second, at gaps of 30 to 49 ms.
  - With `timeBeginPeriod(1)` while the take records, the gaps are 32 to 37 ms (median 33.3).
- **`capture_border=1`:** the frame is the window's bounds as the window list gives them (`DWMWA_EXTENDED_FRAME_BOUNDS`, 624×352 in the probe); without it, only the client area (622×313). So the take's size and origin are the window's, and the gate's moves line up.
- **All of the window,** also where it reaches past its monitor (no longer the part on the monitor): gfxcapture takes it whole.
- **A closed window:** gfxcapture logs "Capture item closed" and ffmpeg exits with 0. The relay writes the last frame on until the recorder has stopped the take, with the reason `window`.
- **A failed start** (no Windows.Graphics.Capture): the feeder exits before its first frame; the take's ffmpeg ends too, and the error carries the feeder's log.
- **Older Windows 10** cannot hide the yellow border Windows draws round a captured window: ffmpeg only warns, and the border is not in the take.
- **`hasWindowCapture()`** asks `ffmpeg -h filter=gfxcapture` once per ffmpeg, while the countdown runs.

## File structure

| File | Responsibility |
|---|---|
| `packages/recorder/src/window-capture.ts` | the feeder's command line, whether ffmpeg has gfxcapture, the take's input |
| `packages/recorder/src/ffmpeg.ts` | the relay: newest frame 30 times a second, stop by the end of stdin, `ended` |
| `packages/recorder/src/sources.ts`, `types.ts` | the window's frame, `wholeWindow`, the stop reason `window` |
| `packages/recorder/src/record.ts`, `window-gate.ts`, `win32.ts` | the take: the feeder, the gate on Windows, fine timers, the end when the window closes |
| `packages/recorder/test/fixtures/hidden-window.cjs` | the real check's window, under the taskbar |
| `README.md`, `skill/cuttle/SKILL.md` | the guide and Claude's skill |

---

### Task 1: The feeder and the relay

**Files:**
- Create: `packages/recorder/src/window-capture.ts`, `packages/recorder/test/window-capture.test.ts`
- Modify: `packages/recorder/src/ffmpeg.ts`
- Test: `packages/recorder/test/ffmpeg.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `windows-window-capture`; work there:

```bash
git switch windows-window-capture
```

- [ ] **Step 2: Write the failing tests**

The feeder's command line, the test window's, and the question to ffmpeg:

`packages/recorder/test/window-capture.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasWindowCapture, relayInput, testWindowFeeder, windowFeeder } from '../src/window-capture';

afterEach(() => vi.unstubAllEnvs());

describe('window capture', () => {
  it('reads the window with gfxcapture: its frame at an even size, without the yellow border, the pointer when asked', () => {
    vi.stubEnv('CUTTLE_FFMPEG', '');
    expect(windowFeeder(198788, { width: 800, height: 500 }, false)).toEqual({
      command: 'ffmpeg',
      args: [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'gfxcapture=hwnd=198788:capture_cursor=0:capture_border=1:display_border=0:max_framerate=30:width=800:height=500,hwdownload,format=bgra',
        '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1',
      ],
      frameBytes: 800 * 500 * 4,
    });
    expect(windowFeeder(1, { width: 2, height: 2 }, true).args[6]).toContain('capture_cursor=1');
    expect(relayInput({ width: 800, height: 500 })).toEqual(['-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', '800x500', '-framerate', '1000000', '-i', 'pipe:0']);
  });

  it("gives the test backend's window a test pattern, which closes after CUTTLE_TEST_WINDOW_CLOSES seconds", () => {
    expect(testWindowFeeder({ width: 640, height: 360 }).args[6]).toBe('testsrc2=s=640x360:r=10,realtime,format=bgra');
    vi.stubEnv('CUTTLE_TEST_WINDOW_CLOSES', '1.5');
    expect(testWindowFeeder({ width: 640, height: 360 }).args[6]).toBe('testsrc2=s=640x360:r=10:d=1.5,realtime,format=bgra');
  });

  it('asks ffmpeg once whether it has gfxcapture; a missing ffmpeg has not', async () => {
    const missing = join(tmpdir(), 'no-such-ffmpeg');
    expect(hasWindowCapture(missing)).toBe(hasWindowCapture(missing));
    expect(await hasWindowCapture(missing)).toBe(false);
  });

  // ffmpeg 8 brought gfxcapture (Gyan's builds say "8.0-full_build-www.gyan.dev")
  const major = Number(/ffmpeg version n?(\d+)\./.exec(spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).stdout ?? '')?.[1]);
  it.runIf(process.platform === 'win32' && major >= 8)('finds gfxcapture in ffmpeg 8 and newer on Windows', async () => {
    expect(await hasWindowCapture('ffmpeg')).toBe(true);
  });
});
```

The relay, with a test pattern at 2 frames a second as the feeder; one that ends after half a second; one that fails:

In `packages/recorder/test/ffmpeg.test.ts`, replace:

```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ffmpegPath, spawnCapture } from '../src/ffmpeg';

afterEach(() => vi.unstubAllEnvs());
const dirs: string[] = [];
```

with:

```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ffmpegPath, spawnCapture, type Feeder } from '../src/ffmpeg';
import { relayInput } from '../src/window-capture';

afterEach(() => vi.unstubAllEnvs());
const dirs: string[] = [];
```

In the same file, replace:

```ts
    await expect(capture.exited).rejects.toMatchObject({ code: 'capture', message: expect.stringMatching(/^the webcam capture stopped unexpectedly \(ffmpeg exit code 0\):\n/) });
  });

  it('fails when ffmpeg cannot open its input, before any start time', async () => {
    const capture = spawnCapture('mic', ['-f', 'lavfi', '-i', 'no_such_source', '-f', 'null', '-']);
    await expect(capture.started).rejects.toMatchObject({ code: 'capture', message: expect.stringContaining('no_such_source') });
```

with:

```ts
    await expect(capture.exited).rejects.toMatchObject({ code: 'capture', message: expect.stringMatching(/^the webcam capture stopped unexpectedly \(ffmpeg exit code 0\):\n/) });
  });

  describe('relaying a feeder that sends a frame only when the picture changes', () => {
    const size = { width: 64, height: 36 };
    /** Raw frames of a test pattern at `rate` a second, for `seconds` (or until killed). */
    const feeder = (rate: number, seconds = ''): Feeder => ({
      command: ffmpegPath(),
      args: ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=64x36:r=${rate}${seconds},realtime,format=bgra`, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'],
      frameBytes: size.width * size.height * 4,
    });
    const frames = (file: string) =>
      Number(spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout);
    const relayed = (file: string) => ['-use_wallclock_as_timestamps', '1', ...relayInput(size), ...out(file)];

    it('writes 30 frames a second from 2 a second, and stops at once though no frame is coming', async () => {
      const file = join(temp('cuttle-relay-'), 'out.mp4');
      const capture = spawnCapture('screen', relayed(file), feeder(2));
      await capture.started;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const asked = Date.now();
      await capture.stop();
      expect(Date.now() - asked).toBeLessThan(2000);
      const seconds = duration(file);
      expect(seconds).toBeGreaterThan(1.3);
      expect(frames(file) / seconds).toBeGreaterThan(27);
      expect(frames(file) / seconds).toBeLessThan(33);
    }, 15_000);

    it('says when the feeder ended after its first frame (the window was closed), and writes its last frame on until stop()', async () => {
      const file = join(temp('cuttle-relay-'), 'out.mp4');
      const capture = spawnCapture('screen', relayed(file), feeder(10, ':d=0.5'));
      const start = await capture.started;
      await capture.ended;
      expect(Date.now() / 1000 - start).toBeGreaterThan(0.3);
      await new Promise((resolve) => setTimeout(resolve, 700));
      await capture.stop();
      expect(duration(file)).toBeGreaterThan(1);
    }, 15_000);

    it("fails with the feeder's log when it ends before its first frame", async () => {
      const capture = spawnCapture('screen', relayed(join(temp('cuttle-relay-'), 'out.mp4')), { command: ffmpegPath(), args: ['-hide_banner', '-f', 'lavfi', '-i', 'no_such_window', '-f', 'rawvideo', 'pipe:1'], frameBytes: 64 * 36 * 4 });
      await expect(capture.exited).rejects.toMatchObject({ code: 'capture', message: expect.stringContaining('no_such_window') });
    }, 15_000);
  });

  it('fails when ffmpeg cannot open its input, before any start time', async () => {
    const capture = spawnCapture('mic', ['-f', 'lavfi', '-i', 'no_such_source', '-f', 'null', '-']);
    await expect(capture.started).rejects.toMatchObject({ code: 'capture', message: expect.stringContaining('no_such_source') });
```

Run: `pnpm exec vitest run --project node packages/recorder/test/window-capture.test.ts packages/recorder/test/ffmpeg.test.ts`
Expected: FAIL: `../src/window-capture` does not exist.

- [ ] **Step 3: The feeder**

`packages/recorder/src/window-capture.ts`:

```ts
// A window by itself on Windows: ffmpeg's gfxcapture (Windows.Graphics.Capture, in ffmpeg 8 and
// newer) takes the window wherever it is and whatever lies over it. It sends a frame only when the
// window changes, and an ffmpeg that waits for one does not stop on "q". So a second ffmpeg reads
// the window (the feeder), and the recorder writes its newest frame into the take's ffmpeg 30 times
// a second (`frameBytes` in ffmpeg.ts), as the macOS helper does. The test backend's windows go the
// same way, with a test pattern as the window.
import { spawn } from 'node:child_process';
import { FRAME_RATE } from './args';
import { ffmpegPath } from './ffmpeg';
import type { Feeder } from './ffmpeg';

const known = new Map<string, Promise<boolean>>();

/** Whether this ffmpeg has gfxcapture (asked once per ffmpeg; false when it cannot be asked). */
export function hasWindowCapture(ffmpeg = ffmpegPath()): Promise<boolean> {
  let answer = known.get(ffmpeg);
  if (!answer) {
    answer = new Promise<boolean>((resolve) => {
      const child = spawn(ffmpeg, ['-hide_banner', '-h', 'filter=gfxcapture'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      let help = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => (help += chunk));
      child.on('error', () => resolve(false));
      child.on('close', () => resolve(help.includes('gfxcapture AVOptions')));
    });
    known.set(ffmpeg, answer);
  }
  return answer;
}

/**
 * The feeder of a window take: the window `id` (an HWND) with its frame (`capture_border`, the
 * bounds the window list gives) at `size` (even: the right and bottom are cut), the pointer only
 * with `drawMouse`, without the yellow border Windows draws round a captured window where it can
 * leave it out (Windows 11). Raw BGRA frames on stdout, one each time the window changes.
 */
export function windowFeeder(id: number, size: { width: number; height: number }, drawMouse: boolean): Feeder {
  const source = `gfxcapture=hwnd=${id}:capture_cursor=${drawMouse ? 1 : 0}:capture_border=1:display_border=0:max_framerate=${FRAME_RATE}:width=${size.width}:height=${size.height}`;
  return { command: ffmpegPath(), args: feederArgs(`${source},hwdownload,format=bgra`), frameBytes: size.width * size.height * 4 };
}

/**
 * The test backend's window: a test pattern at 10 frames a second (a window changes now and then).
 * It closes after CUTTLE_TEST_WINDOW_CLOSES seconds when that is set.
 */
export function testWindowFeeder(size: { width: number; height: number }): Feeder {
  const closes = Number(process.env.CUTTLE_TEST_WINDOW_CLOSES);
  const end = closes > 0 ? `:d=${closes}` : '';
  return { command: ffmpegPath(), args: feederArgs(`testsrc2=s=${size.width}x${size.height}:r=10${end},realtime,format=bgra`), frameBytes: size.width * size.height * 4 };
}

/** Frames as they come (`passthrough`: never repeated or dropped to a rate), raw on stdout. */
const feederArgs = (graph: string) => ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', graph, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'];

/**
 * The take's ffmpeg input for the frames the recorder writes on its stdin. The time base is a
 * microsecond, as the wall clock stamps each frame when ffmpeg reads it.
 */
export function relayInput(size: { width: number; height: number }): string[] {
  return ['-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', `${size.width}x${size.height}`, '-framerate', '1000000', '-i', 'pipe:0'];
}
```

- [ ] **Step 4: The relay**

In `packages/recorder/src/ffmpeg.ts`, replace:

```ts
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { RecorderError } from './errors';

/** The ffmpeg executable: `CUTTLE_FFMPEG` when set, otherwise `ffmpeg` from PATH. */
```

with:

```ts
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { FRAME_RATE } from './args';
import { RecorderError } from './errors';

/** The ffmpeg executable: `CUTTLE_FFMPEG` when set, otherwise `ffmpeg` from PATH. */
```

In the same file, replace:

```ts
  seconds(): number | undefined;
  /** Asks ffmpeg to finish the file ("q" on stdin); kills it if it has not exited after 10 s (the fragmented MP4 stays readable). */
  stop(): Promise<void>;
}

/** A process that feeds ffmpeg: its stdout becomes ffmpeg's file descriptor 3 (`-i /dev/fd/3`). */
export interface Feeder {
  command: string;
  args: readonly string[];
}

/** A feeder's exit code that means the OS does not allow the capture (cuttle-capture: screen recording). */
```

with:

```ts
  seconds(): number | undefined;
  /** Asks ffmpeg to finish the file ("q" on stdin); kills it if it has not exited after 10 s (the fragmented MP4 stays readable). */
  stop(): Promise<void>;
  /**
   * A relayed capture (`Feeder.frameBytes`): resolves when the feeder ended on its own after its first
   * frame (the window was closed). Its last frame is written on until stop().
   */
  readonly ended?: Promise<void>;
}

/** A process that feeds ffmpeg: its stdout becomes ffmpeg's file descriptor 3 (`-i /dev/fd/3`). */
export interface Feeder {
  command: string;
  args: readonly string[];
  /**
   * The feeder sends raw frames of this many bytes, only when the picture changed (Windows'
   * gfxcapture): this process writes the newest into ffmpeg's stdin FRAME_RATE times a second
   * (`relayFrames`), and stop() ends stdin instead of sending "q".
   */
  frameBytes?: number;
}

/** A feeder's exit code that means the OS does not allow the capture (cuttle-capture: screen recording). */
```

In the same file, replace:

```ts
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
  const tail: string[] = [];
  let partial = '';
```

with:

```ts
 * `onStdout` takes what ffmpeg writes to its stdout (the mic's samples), as it comes.
 */
export function spawnCapture(name: string, args: readonly string[], feeder?: Feeder, onStdout?: (chunk: Buffer) => void): CaptureProcess {
  const feed = feeder && spawn(feeder.command, [...feeder.args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const frameBytes = feeder?.frameBytes;
  const feedTail: string[] = [];
  feed?.stderr?.setEncoding('utf8');
  feed?.stderr?.on('data', (chunk: string) => feedTail.push(...chunk.split(/\r?\n/).filter((line) => line.trim() !== '')));
  feed?.on('error', () => {}); // a feeder that cannot start ends its pipe: ffmpeg reports that
  const feedExit = feed && new Promise<number | null>((resolve) => feed.once('close', (code) => resolve(code)));
  // stdin for "q" (a relay's frames), stdout for what the caller reads (else nothing), stderr for the log; a feeder's pipe as file descriptor 3
  const direct = feed && frameBytes === undefined ? [feed.stdout] : [];
  const child = spawn(ffmpegPath(), ['-hide_banner', ...args], { stdio: ['pipe', onStdout ? 'pipe' : 'ignore', 'pipe', ...direct], windowsHide: true }) as ChildProcessByStdio<Writable, Readable | null, Readable>;
  // read as it comes: a full pipe would stall ffmpeg
  if (onStdout) child.stdout?.on('data', onStdout);
  // ffmpeg holds the pipe now: this process lets go of it, so the feeder sees ffmpeg's end
  if (direct.length > 0) feed?.stdout?.destroy();
  let resolveEnded!: () => void;
  const ended = frameBytes === undefined ? undefined : new Promise<void>((resolve) => (resolveEnded = resolve));
  const relay =
    feed?.stdout && frameBytes !== undefined
      ? relayFrames(feed.stdout, child.stdin, frameBytes, (framed) => {
          // a feeder that ended before its first frame failed (its log says why): ffmpeg ends too
          if (framed) resolveEnded();
          else child.stdin.end();
        })
      : undefined;
  const listeners: ((line: string) => void)[] = [];
  const tail: string[] = [];
  let partial = '';
```

In the same file, replace:

```ts
      reject(failure);
    });
    child.on('close', (code) => {
      line(partial);
      partial = '';
      // a feeder still running is done now; one that ended first says why the capture failed
```

with:

```ts
      reject(failure);
    });
    child.on('close', (code) => {
      relay?.stop();
      line(partial);
      partial = '';
      // a feeder still running is done now; one that ended first says why the capture failed
```

In the same file, replace:

```ts
    exited,
    onLine: (listener) => void listeners.push(listener),
    seconds: () => seconds,
    stop() {
      if (child.exitCode === null && !stopping) {
        stopping = true;
        child.stdin.end('q');
        const timer = setTimeout(() => {
          killed = true;
          child.kill();
```

with:

```ts
    exited,
    onLine: (listener) => void listeners.push(listener),
    seconds: () => seconds,
    ...(ended && { ended }),
    stop() {
      if (child.exitCode === null && !stopping) {
        stopping = true;
        if (relay) {
          // the frames written so far, then the end of the input: ffmpeg finishes the file
          relay.stop();
          child.stdin.end();
          if (feed && feed.exitCode === null && feed.signalCode === null) feed.kill();
        } else child.stdin.end('q');
        const timer = setTimeout(() => {
          killed = true;
          child.kill();
```

In the same file, replace:

```ts
    },
  };
}
```

with:

```ts
    },
  };
}

/**
 * Writes the newest whole frame `source` sent (`frameBytes` each) into `sink` FRAME_RATE times a
 * second, from the first frame on: one for each 1/30 s by the clock (a timer that fires late writes
 * one; ffmpeg stamps each frame with the wall clock as it reads it). While the pipe still holds a
 * frame and the next, none is written, as a capture that falls behind drops frames. `ended` is
 * called when the source ends, with whether it sent a frame.
 */
function relayFrames(source: Readable, sink: Writable, frameBytes: number, ended: (framed: boolean) => void): { stop(): void } {
  const period = 1000 / FRAME_RATE;
  let newest: Buffer | undefined;
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let begun: number | undefined;
  let written = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const tick = () => {
    if (stopped || begun === undefined || !newest) return;
    const slot = Math.floor((performance.now() - begun) / period);
    if (slot >= written) {
      if (sink.writableLength <= frameBytes) sink.write(newest);
      written = slot + 1;
    }
    timer = setTimeout(tick, Math.max(0, begun + written * period - performance.now()));
  };
  source.on('data', (chunk: Buffer) => {
    pending.push(chunk);
    pendingBytes += chunk.length;
    if (pendingBytes < frameBytes) return;
    // the last whole frame in what came; the rest begins the next
    const all = Buffer.concat(pending, pendingBytes);
    const whole = Math.floor(all.length / frameBytes) * frameBytes;
    newest = all.subarray(whole - frameBytes, whole);
    pending = whole < all.length ? [all.subarray(whole)] : [];
    pendingBytes = all.length - whole;
    if (begun === undefined && !stopped) {
      begun = performance.now();
      tick();
    }
  });
  source.on('error', () => {}); // its end says enough
  source.on('close', () => {
    if (!stopped) ended(newest !== undefined);
  });
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
```

Run: `pnpm exec vitest run --project node packages/recorder/test/window-capture.test.ts packages/recorder/test/ffmpeg.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/recorder
git commit -m "recorder: a feeder whose frames come only on a change, relayed 30 times a second

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A window take by itself on Windows

**Files:**
- Create: `packages/recorder/test/fixtures/hidden-window.cjs`
- Modify: `packages/recorder/src/sources.ts`, `packages/recorder/src/types.ts`, `packages/recorder/src/record.ts`, `packages/recorder/src/window-gate.ts`, `packages/recorder/src/win32.ts`
- Test: `packages/recorder/test/sources.test.ts`, `packages/recorder/test/record.test.ts`, `packages/recorder/test/win32.test.ts`, `packages/recorder/test/real.test.ts`

- [ ] **Step 1: Write the failing tests**

The window's frame and all of the window:

In `packages/recorder/test/sources.test.ts`, replace:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_DEVICES, areaGeometry, checkDevice, micInput, micLatency, pickCameraMode, platformFor, resolveArea, screenFilter, screenInput, webcamInput } from '../src/sources';
import type { Devices } from '../src/types';

const devices: Devices = {
```

with:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_DEVICES, areaGeometry, checkDevice, micInput, micLatency, pickCameraMode, platformFor, resolveArea, screenFilter, screenInput, webcamInput, wholeWindow } from '../src/sources';
import type { Devices } from '../src/types';

const devices: Devices = {
```

In the same file, replace:

```ts

  it('captures a window as the region of its bounds', () => {
    const area = resolveArea({ kind: 'window', title: 'Claude Code - demo' }, devices);
    // the window's id too: macOS's helper takes the window by itself
    expect(area).toEqual({ monitor: devices.monitors[1], crop: { x: 40, y: 91, width: 800, height: 500 }, window: 11 });
    expect(areaGeometry(area).origin).toEqual({ x: 2600, y: 600 });
  });

  it('clips a window to the monitor that holds most of it', () => {
    expect(resolveArea({ kind: 'window', title: 'Editor' }, devices).crop).toEqual({ x: 0, y: 435, width: 580, height: 400 });
  });
```

with:

```ts

  it('captures a window as the region of its bounds', () => {
    const area = resolveArea({ kind: 'window', title: 'Claude Code - demo' }, devices);
    // the window's id and frame too: macOS's helper and Windows' gfxcapture take the window by itself
    expect(area).toEqual({ monitor: devices.monitors[1], crop: { x: 40, y: 91, width: 800, height: 500 }, window: 11, frame: devices.windows[0]!.bounds });
    expect(areaGeometry(area).origin).toEqual({ x: 2600, y: 600 });
  });

  it('takes all of a window by itself, also where it reaches past its monitor, in even sizes', () => {
    const editor = wholeWindow(resolveArea({ kind: 'window', title: 'Editor' }, devices));
    expect(areaGeometry(editor)).toEqual({ size: { width: 700, height: 400 }, origin: { x: -1200, y: 100 } });
    expect(areaGeometry(wholeWindow(resolveArea({ kind: 'window', id: 11 }, devices)))).toEqual({ size: { width: 800, height: 500 }, origin: { x: 2600, y: 600 } });
    // anything but a window stays as it is
    const region = resolveArea({ kind: 'region', rect: [100, 50, 400, 300], monitor: 2 }, devices);
    expect(wholeWindow(region)).toBe(region);
  });

  it('clips a window to the monitor that holds most of it', () => {
    expect(resolveArea({ kind: 'window', title: 'Editor' }, devices).crop).toEqual({ x: 0, y: 435, width: 580, height: 400 });
  });
```

A window take of the test backend at 30 frames a second, and one whose window closes (`CUTTLE_TEST_WINDOW_CLOSES`, in a describe of its own: the environment is the process's):

In `packages/recorder/test/record.test.ts`, replace:

```ts
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseEventsJsonl, parseMarkersJson, parseSegmentsJson, parseTakeJson, trackOffset } from '@cuttle/project';
import { CLAUDE_TAIL_SECONDS, claudeTranscriptDir, record, type RecordOptions, type RecorderEvent } from '../src/index';
import { inDeadZone } from '../src/record';
```

with:

```ts
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { parseEventsJsonl, parseMarkersJson, parseSegmentsJson, parseTakeJson, trackOffset } from '@cuttle/project';
import { CLAUDE_TAIL_SECONDS, claudeTranscriptDir, record, type RecordOptions, type RecorderEvent } from '../src/index';
import { inDeadZone } from '../src/record';
```

In the same file, replace:

```ts
    expect(Math.hypot(first.x + 100 - 640, first.y + 60 - 360)).toBeCloseTo(200, -1);
  }, SLOW);

  it('refuses options it cannot record with, before creating a take folder', async () => {
    const projectDir = project();
    const flag = join(projectDir, 'exists.flag');
```

with:

```ts
    expect(Math.hypot(first.x + 100 - 640, first.y + 60 - 360)).toBeCloseTo(200, -1);
  }, SLOW);

  it('records a window by itself, its frame changing only now and then, at 30 frames a second', async () => {
    const projectDir = project();
    const take = await record({ ...test, projectDir, source: { kind: 'window', title: 'Test Window' }, stop: { maxSeconds: 2 } }).done;
    expect(take.warnings).toEqual([]);
    // the test window's pattern changes 10 times a second; the take has a frame every 1/30 s
    const { stdout } = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', join(projectDir, take.screen)], { encoding: 'utf8' });
    expect(Number(stdout) / take.seconds).toBeGreaterThan(26);
  }, SLOW);

  it('refuses options it cannot record with, before creating a take folder', async () => {
    const projectDir = project();
    const flag = join(projectDir, 'exists.flag');
```

In the same file, replace:

```ts
    expect(inDeadZone({ type: 'move', time: 0, x: 150, y: 120 }, [])).toBe(false);
  });
});
```

with:

```ts
    expect(inDeadZone({ type: 'move', time: 0, x: 150, y: 120 }, [])).toBe(false);
  });
});

describe('record (test backend), a window that is closed', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('ends the take when the window it records by itself is closed, and says so', async () => {
    vi.stubEnv('CUTTLE_TEST_WINDOW_CLOSES', '1');
    const projectDir = project();
    const take = await record({ ...test, projectDir, source: { kind: 'window', id: 1001 }, stop: { maxSeconds: 10 } }).done;
    expect(take.stopReason).toBe('window');
    expect(take.warnings).toEqual(['the window was closed: the take ends there']);
    expect(take.seconds).toBeGreaterThan(0.8);
    expect(take.seconds).toBeLessThan(3);
    expect(probe(join(projectDir, take.screen))).toMatchObject({ width: 640, height: 360 });
  }, SLOW);
});
```

Fine timers:

In `packages/recorder/test/win32.test.ts`, replace:

```ts
    expect(CURSOR_SHAPES).toContain(win.cursorShape());
  });

  it('puts the pointer on a monitor, in the same pixels as the monitor bounds', async () => {
    const win = await loadWin32();
    const monitors = win.monitors();
```

with:

```ts
    expect(CURSOR_SHAPES).toContain(win.cursorShape());
  });

  it('sets timers to the millisecond until told to end, once', async () => {
    const end = (await loadWin32()).fineTimers();
    expect(() => {
      end();
      end();
    }).not.toThrow();
  });

  it('puts the pointer on a monitor, in the same pixels as the monitor bounds', async () => {
    const win = await loadWin32();
    const monitors = win.monitors();
```

The real check (`pnpm recorder:real`, Windows): a window of its own under the taskbar, which no one sees, recorded in its own colours, then closed:

`packages/recorder/test/fixtures/hidden-window.cjs`:

```js
// A window for the real window-take check, that no one sees: all of it on the primary monitor, but
// inside the taskbar's strip, under the taskbar. It is never activated and has no taskbar button (an
// owner that is never shown). It paints itself red, green and blue in turn, 10 times a second.
// Prints {"id":…,"bounds":…} once it is there; "close" on stdin closes the window; the end of stdin
// ends the process. Refuses to start (exit 2) where the taskbar is not at the bottom.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');
const MSG = koffi.struct('MSG', { hwnd: 'void *', message: 'uint32', wParam: 'uintptr_t', lParam: 'intptr_t', time: 'uint32', x: 'int32', y: 'int32', priv: 'uint32' });
const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });
const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const MONITORINFO = koffi.struct('MONITORINFO', { cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32' });
const SetProcessDpiAwarenessContext = user32.func('__stdcall', 'SetProcessDpiAwarenessContext', 'int', ['intptr_t']);
const CreateWindowExW = user32.func('__stdcall', 'CreateWindowExW', 'void *', ['uint32', 'str16', 'str16', 'uint32', 'int', 'int', 'int', 'int', 'void *', 'void *', 'void *', 'void *']);
const DestroyWindow = user32.func('__stdcall', 'DestroyWindow', 'int', ['void *']);
const PeekMessageW = user32.func('__stdcall', 'PeekMessageW', 'int', [koffi.out(koffi.pointer(MSG)), 'void *', 'uint32', 'uint32', 'uint32']);
const TranslateMessage = user32.func('__stdcall', 'TranslateMessage', 'int', [koffi.pointer(MSG)]);
const DispatchMessageW = user32.func('__stdcall', 'DispatchMessageW', 'intptr_t', [koffi.pointer(MSG)]);
const MonitorFromPoint = user32.func('__stdcall', 'MonitorFromPoint', 'void *', [POINT, 'uint32']);
const GetMonitorInfoW = user32.func('__stdcall', 'GetMonitorInfoW', 'int', ['void *', koffi.inout(koffi.pointer(MONITORINFO))]);
const GetDC = user32.func('__stdcall', 'GetDC', 'void *', ['void *']);
const ReleaseDC = user32.func('__stdcall', 'ReleaseDC', 'int', ['void *', 'void *']);
const FillRect = user32.func('__stdcall', 'FillRect', 'int', ['void *', koffi.pointer(RECT), 'void *']);
const CreateSolidBrush = gdi32.func('__stdcall', 'CreateSolidBrush', 'void *', ['uint32']);

SetProcessDpiAwarenessContext(-4); // per-monitor aware: physical pixels, as the recorder's
const WS_POPUP = 0x80000000;
const WS_VISIBLE = 0x10000000;
const WS_EX_NOACTIVATE = 0x08000000;
const WS_EX_TRANSPARENT = 0x20; // clicks go through it
const MONITOR_DEFAULTTOPRIMARY = 1;

const info = { cbSize: koffi.sizeof(MONITORINFO), rcMonitor: {}, rcWork: {}, dwFlags: 0 };
GetMonitorInfoW(MonitorFromPoint({ x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY), info);
const strip = info.rcMonitor.bottom - info.rcWork.bottom;
if (strip < 20) {
  process.stderr.write('the taskbar is not at the bottom of the primary monitor: the window would show\n');
  process.exit(2);
}
const owner = CreateWindowExW(0, 'STATIC', '', WS_POPUP, 0, 0, 1, 1, null, null, null, null);
const bounds = { x: info.rcMonitor.left + 100, y: info.rcWork.bottom + 4, width: 640, height: strip - 8 };
const hwnd = CreateWindowExW(WS_EX_NOACTIVATE | WS_EX_TRANSPARENT, 'STATIC', 'Cuttle window check', WS_POPUP | WS_VISIBLE, bounds.x, bounds.y, bounds.width, bounds.height, owner, null, null, null);
const brushes = [0x0000ff, 0x00ff00, 0xff0000].map((bgr) => CreateSolidBrush(bgr));
let open = true;
let n = 0;
const paint = setInterval(() => {
  if (!open) return;
  const dc = GetDC(hwnd);
  FillRect(dc, { left: 0, top: 0, right: bounds.width, bottom: bounds.height }, brushes[n++ % 3]);
  ReleaseDC(hwnd, dc);
}, 100);
const pump = setInterval(() => {
  const msg = {};
  while (PeekMessageW(msg, null, 0, 0, 1)) {
    TranslateMessage(msg);
    DispatchMessageW(msg);
  }
}, 10);
process.stdout.write(`${JSON.stringify({ id: Number(BigInt.asUintN(32, koffi.address(hwnd))), bounds })}\n`);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (text) => {
  if (!text.includes('close') || !open) return;
  open = false;
  DestroyWindow(hwnd);
  process.stdout.write('closed\n');
});
process.stdin.on('end', () => {
  clearInterval(paint);
  clearInterval(pump);
  if (open) DestroyWindow(hwnd);
  DestroyWindow(owner);
  process.exit(0);
});
```

In `packages/recorder/test/real.test.ts`, replace:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

with:

```ts
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

In the same file, replace:

```ts
    rmSync(projectDir, { recursive: true, force: true });
  }
}, 60_000);
```

with:

```ts
    rmSync(projectDir, { recursive: true, force: true });
  }
}, 60_000);

/**
 * A window take of a window that lies under the taskbar (fixtures/hidden-window.cjs, which no one
 * sees): the take shows the window's own colours, not the taskbar over it, and ends when the window
 * is closed. Windows with ffmpeg 8 or newer; reads one averaged pixel and deletes the takes.
 */
it.runIf(process.env.MODE === 'real' && process.platform === 'win32')('records a window by itself though the taskbar lies over it, and ends when it is closed', async () => {
  const child = spawn(process.execPath, [join(import.meta.dirname, 'fixtures', 'hidden-window.cjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines: string[] = [];
  const line = () =>
    new Promise<string>((resolve, reject) => {
      if (lines.length > 0) return resolve(lines.shift()!);
      child.stdout.once('data', (chunk: Buffer) => {
        lines.push(...String(chunk).trim().split('\n'));
        resolve(lines.shift()!);
      });
      child.once('exit', (code) => reject(new Error(`the window's process ended (${code})`)));
    });
  const projectDir = mkdtempSync(join(tmpdir(), 'cuttle-real-window-'));
  try {
    const { id, bounds } = JSON.parse(await line()) as { id: number; bounds: { width: number; height: number } };
    expect((await listDevices({ media: false })).windows.map((window) => window.id)).toContain(id);
    const take = await record({ projectDir, source: { kind: 'window', id }, stop: { maxSeconds: 2 }, countdownSeconds: 0 }).done;
    console.log(`window ${id} ${bounds.width}×${bounds.height}: ${take.seconds} s, warnings ${JSON.stringify(take.warnings)}`);
    expect(take.warnings).toEqual([]);
    expect(take.screenSize).toEqual({ width: bounds.width - (bounds.width % 2), height: bounds.height - (bounds.height % 2) });
    // one second in, the whole picture averaged: one of the window's colours, not the dark taskbar
    const pixel = spawnSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', join(projectDir, take.screen), '-frames:v', '1', '-vf', 'scale=1:1:flags=area,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' }).stdout;
    const rgb = [...pixel.subarray(0, 3)];
    console.log(`its colour at 1 s: ${rgb.join(', ')}`);
    expect(Math.max(...rgb)).toBeGreaterThan(150);
    expect(rgb.filter((channel) => channel < 90).length).toBe(2);
    // a frame every 1/30 s, though the window sends one only when it changes (10 times a second)
    const frames = Number(spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', join(projectDir, take.screen)], { encoding: 'utf8' }).stdout);
    console.log(`${frames} frames in ${take.seconds} s`);
    expect(frames / take.seconds).toBeGreaterThan(27);

    const closing = record({
      projectDir,
      source: { kind: 'window', id },
      stop: { maxSeconds: 20 },
      countdownSeconds: 0,
      onEvent: (event) => {
        if (event.type === 'recording') setTimeout(() => child.stdin.write('close\n'), 1000);
      },
    }).done;
    const closed = await closing;
    expect(closed.stopReason).toBe('window');
    expect(closed.seconds).toBeLessThan(5);
  } finally {
    child.stdin.end();
    rmSync(projectDir, { recursive: true, force: true });
  }
}, 60_000);
```

Run: `pnpm exec vitest run --project node packages/recorder/test/sources.test.ts packages/recorder/test/win32.test.ts`
Expected: FAIL: `wholeWindow` is not exported, and `fineTimers` is not a function.

- [ ] **Step 2: The frame, all of the window, the stop reason**

In `packages/recorder/src/sources.ts`, replace:

```ts
  crop?: Bounds;
  /**
   * The window a window take shows (`WindowInfo.id`). macOS's capture helper takes that window by
   * itself, at the crop's size: what lies over it is not in the take. Elsewhere the crop is the screen
   * where the window is.
   */
  window?: number;
}

/** The area's size and its top-left corner on the desktop (where events.jsonl's origin lies). */
```

with:

```ts
  crop?: Bounds;
  /**
   * The window a window take shows (`WindowInfo.id`). macOS's capture helper takes that window by
   * itself, at the crop's size, and so does Windows' gfxcapture (window-capture.ts), all of it
   * (`wholeWindow`): what lies over it is not in the take. Otherwise the crop is the screen where the
   * window is.
   */
  window?: number;
  /** A window take: the window's frame on the desktop when the take starts. */
  frame?: Bounds;
}

/** The area's size and its top-left corner on the desktop (where events.jsonl's origin lies). */
```

In the same file, replace:

```ts
      const bottom = Math.min(window.bounds.y + window.bounds.height, bounds.y + bounds.height) - bounds.y;
      const crop = { x: left, y: top, width: even(right - left), height: even(bottom - top) };
      if (crop.width < 2 || crop.height < 2) throw new RecorderError('invalid-options', `window "${window.title}" is not visible on a monitor`);
      return { monitor, crop: fullOrCrop(monitor, crop), window: window.id };
    }
  }
}

function fullOrCrop(monitor: Monitor, crop: Bounds): Bounds | undefined {
  const full = crop.x === 0 && crop.y === 0 && crop.width === monitor.bounds.width && crop.height === monitor.bounds.height;
  return full ? undefined : crop;
```

with:

```ts
      const bottom = Math.min(window.bounds.y + window.bounds.height, bounds.y + bounds.height) - bounds.y;
      const crop = { x: left, y: top, width: even(right - left), height: even(bottom - top) };
      if (crop.width < 2 || crop.height < 2) throw new RecorderError('invalid-options', `window "${window.title}" is not visible on a monitor`);
      return { monitor, crop: fullOrCrop(monitor, crop), window: window.id, frame: window.bounds };
    }
  }
}

/**
 * A window take of the window by itself (Windows' gfxcapture): all of the window, also where it
 * reaches past its monitor, in even sizes (the right and bottom are cut). Its origin is the window's
 * corner, as the window gate's.
 */
export function wholeWindow(area: ScreenArea): ScreenArea {
  const { frame, monitor } = area;
  if (!frame) return area;
  return { ...area, crop: { x: frame.x - monitor.bounds.x, y: frame.y - monitor.bounds.y, width: even(frame.width), height: even(frame.height) } };
}

function fullOrCrop(monitor: Monitor, crop: Bounds): Bounds | undefined {
  const full = crop.x === 0 && crop.y === 0 && crop.width === monitor.bounds.width && crop.height === monitor.bounds.height;
  return full ? undefined : crop;
```

In `packages/recorder/src/types.ts`, replace:

```ts
  | { kind: 'monitor'; index: number }
  /** `rect` is `[x, y, width, height]` in pixels of that monitor (origin at its top-left corner). */
  | { kind: 'region'; rect: Rect; monitor: number }
  /** Captured as the region of the window's bounds when the recording starts; by title or by id (`WindowInfo.id`). */
  | { kind: 'window'; title: string }
  | { kind: 'window'; id: number };
```

with:

```ts
  | { kind: 'monitor'; index: number }
  /** `rect` is `[x, y, width, height]` in pixels of that monitor (origin at its top-left corner). */
  | { kind: 'region'; rect: Rect; monitor: number }
  /**
   * The window by itself, wherever it is and whatever lies over it (macOS with the capture helper;
   * Windows with ffmpeg 8 or newer, which has gfxcapture), at its size when the recording starts;
   * otherwise the region of its bounds then. By title or by id (`WindowInfo.id`).
   */
  | { kind: 'window'; title: string }
  | { kind: 'window'; id: number };
```

In the same file, replace:

```ts
  onAudio?: (samples: Uint8Array) => void;
}

export type StopReason = 'stop' | 'hotkey' | 'max-seconds' | 'file' | 'idle' | 'claude';

export type RecorderEvent =
  | { type: 'countdown'; seconds: number }
```

with:

```ts
  onAudio?: (samples: Uint8Array) => void;
}

/** `window`: the window of a window take recorded by itself was closed. */
export type StopReason = 'stop' | 'hotkey' | 'max-seconds' | 'file' | 'idle' | 'claude' | 'window';

export type RecorderEvent =
  | { type: 'countdown'; seconds: number }
```

- [ ] **Step 3: Fine timers, and the gate on Windows**

In `packages/recorder/src/win32.ts`, replace:

```ts
  processName(pid: number): string;
  /** The dialogs, menus and notifications on the desktop now (not this process's own). */
  popups(): { id: number; kind: WindowKind; bounds: Bounds }[];
}

/** Chromium and Electron draw a page in a child window of this class: its rect is the page's. */
```

with:

```ts
  processName(pid: number): string;
  /** The dialogs, menus and notifications on the desktop now (not this process's own). */
  popups(): { id: number; kind: WindowKind; bounds: Bounds }[];
  /**
   * Timers of this process to the millisecond (`timeBeginPeriod(1)`; Windows' default is 15.6 ms),
   * for frames written 30 times a second; the function it returns ends that.
   */
  fineTimers(): () => void;
}

/** Chromium and Electron draw a page in a child window of this class: its rect is the page's. */
```

In the same file, replace:

```ts
  const dxgi = koffi.load('dxgi.dll');
  const shcore = koffi.load('shcore.dll');
  const dwmapi = koffi.load('dwmapi.dll');

  // Type names are process-wide and can be defined once, but this module may load more than once in
  // a process (test files, two copies in a bundle), so every load gets its own prefix. Anonymous
```

with:

```ts
  const dxgi = koffi.load('dxgi.dll');
  const shcore = koffi.load('shcore.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const winmm = koffi.load('winmm.dll');

  // Type names are process-wide and can be defined once, but this module may load more than once in
  // a process (test files, two copies in a bundle), so every load gets its own prefix. Anonymous
```

In the same file, replace:

```ts
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const DwmGetWindowAttribute = dwmapi.func('__stdcall', 'DwmGetWindowAttribute', 'long', ['void *', 'uint32', 'void *', 'uint32']);
  const GetDpiForMonitor = shcore.func('__stdcall', 'GetDpiForMonitor', 'long', ['void *', 'int', koffi.out(koffi.pointer('uint32')), koffi.out(koffi.pointer('uint32'))]);
  const CreateDXGIFactory1 = dxgi.func('__stdcall', 'CreateDXGIFactory1', 'long', [koffi.pointer(GUID), koffi.out(koffi.pointer('void *'))]);

  // COM methods by vtable slot: IUnknown::Release 2, IDXGIFactory1::EnumAdapters1 12,
```

with:

```ts
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const DwmGetWindowAttribute = dwmapi.func('__stdcall', 'DwmGetWindowAttribute', 'long', ['void *', 'uint32', 'void *', 'uint32']);
  const GetDpiForMonitor = shcore.func('__stdcall', 'GetDpiForMonitor', 'long', ['void *', 'int', koffi.out(koffi.pointer('uint32')), koffi.out(koffi.pointer('uint32'))]);
  const timeBeginPeriod = winmm.func('__stdcall', 'timeBeginPeriod', 'uint32', ['uint32']);
  const timeEndPeriod = winmm.func('__stdcall', 'timeEndPeriod', 'uint32', ['uint32']);
  const CreateDXGIFactory1 = dxgi.func('__stdcall', 'CreateDXGIFactory1', 'long', [koffi.pointer(GUID), koffi.out(koffi.pointer('void *'))]);

  // COM methods by vtable slot: IUnknown::Release 2, IDXGIFactory1::EnumAdapters1 12,
```

In the same file, replace:

```ts
      }
      return found;
    },
    caret(thread = 0) {
      const gui = { cbSize: koffi.sizeof(GUITHREADINFO), flags: 0, hwndActive: null, hwndFocus: null, hwndCapture: null, hwndMenuOwner: null, hwndMoveSize: null, hwndCaret: null as unknown, rcCaret: rect() };
      if (!GetGUIThreadInfo(thread, gui) || !gui.hwndCaret) return undefined;
```

with:

```ts
      }
      return found;
    },
    fineTimers() {
      const begun = timeBeginPeriod(1) === 0;
      let ended = false;
      return () => {
        if (begun && !ended) timeEndPeriod(1);
        ended = true;
      };
    },
    caret(thread = 0) {
      const gui = { cbSize: koffi.sizeof(GUITHREADINFO), flags: 0, hwndActive: null, hwndFocus: null, hwndCapture: null, hwndMenuOwner: null, hwndMoveSize: null, hwndCaret: null as unknown, rcCaret: rect() };
      if (!GetGUIThreadInfo(thread, gui) || !gui.hwndCaret) return undefined;
```

In `packages/recorder/src/window-gate.ts`, replace:

```ts
// A window take on macOS, where the capture helper takes the window by itself: only what is done in
// that window is the take's input. While another window is in front, the pointer, the clicks, the
// keys and the content area are not logged (the take shows none of it), nor ever what opens over
// the screen (a dialog or notification of another window is not in the take), nor a click or a
// scroll beside the window. When the window has moved, the events' origin moves with it. Pure: the
```

with:

```ts
// A window take recorded by itself (macOS's capture helper, Windows' gfxcapture): only what is done
// in that window is the take's input. While another window is in front, the pointer, the clicks, the
// keys and the content area are not logged (the take shows none of it), nor ever what opens over
// the screen (a dialog or notification of another window is not in the take), nor a click or a
// scroll beside the window. When the window has moved, the events' origin moves with it. Pure: the
```

In the same file, replace:

```ts
export const WINDOW_GATE_MS = 250;

export interface WindowGate {
  /** The front window now (its id and frame in desktop pixels, as darwin.ts's `foreground()` gives it). */
  look(front: { id: number; bounds: Bounds } | undefined): void;
  /** Whether `input` is the take's. */
  allows(input: RawInput): boolean;
```

with:

```ts
export const WINDOW_GATE_MS = 250;

export interface WindowGate {
  /** The front window now (its id and frame in desktop pixels, as `foreground()` in darwin.ts and win32.ts gives it). */
  look(front: { id: number; bounds: Bounds } | undefined): void;
  /** Whether `input` is the take's. */
  allows(input: RawInput): boolean;
```

- [ ] **Step 4: The take**

In `packages/recorder/src/record.ts`, replace:

```ts
import { startInput, type InputSource } from './input';
import { levelMeter, wholeSamples } from './level';
import { FPS as JOIN_FPS, joinSegments, mediaInfo, renameWhenFree } from './join';
import { areaGeometry, checkDevice, deviceClock, micInput, micLatency, platformFor, resolveArea, screenFilter, screenInput, screenLatency, webcamInput, type CameraMode, type Platform, type ScreenArea } from './sources';
import { WINDOW_GATE_MS, windowGate } from './window-gate';
import type { Bounds, RawInput, RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';
```

with:

```ts
import { startInput, type InputSource } from './input';
import { levelMeter, wholeSamples } from './level';
import { FPS as JOIN_FPS, joinSegments, mediaInfo, renameWhenFree } from './join';
import { areaGeometry, checkDevice, deviceClock, micInput, micLatency, platformFor, resolveArea, screenFilter, screenInput, screenLatency, webcamInput, wholeWindow, type CameraMode, type Platform, type ScreenArea } from './sources';
import { hasWindowCapture, relayInput, testWindowFeeder, windowFeeder } from './window-capture';
import { WINDOW_GATE_MS, windowGate } from './window-gate';
import type { Bounds, RawInput, RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';
```

In the same file, replace:

```ts
  const cameraMode = options.webcam === undefined ? undefined : await cameraModeFor(platform, options.webcam);
  const reporter = new Reporter(options.onEvent);
  const claude = options.stop.untilClaude === undefined ? undefined : claudeTrigger(options.stop.untilClaude, since);
  try {
    for (let left = options.countdownSeconds ?? DEFAULT_COUNTDOWN_SECONDS; left > 0 && control.reason === undefined; left--) {
      reporter.emit({ type: 'countdown', seconds: left });
```

with:

```ts
  const cameraMode = options.webcam === undefined ? undefined : await cameraModeFor(platform, options.webcam);
  const reporter = new Reporter(options.onEvent);
  const claude = options.stop.untilClaude === undefined ? undefined : claudeTrigger(options.stop.untilClaude, since);
  // a window by itself: on Windows where ffmpeg has gfxcapture (asked while the countdown runs), and the test backend's
  const window = options.source.kind === 'window';
  const byItself = window && platform === 'windows' ? hasWindowCapture() : Promise.resolve(window && platform === 'test');
  try {
    for (let left = options.countdownSeconds ?? DEFAULT_COUNTDOWN_SECONDS; left > 0 && control.reason === undefined; left--) {
      reporter.emit({ type: 'countdown', seconds: left });
```

In the same file, replace:

```ts
    if (control.reason !== undefined) throw cancelled('it started');
    // A window is captured where it is when the recording starts, not where it was before the countdown.
    if (options.source.kind === 'window') area = resolveArea(options.source, { ...devices, windows: await windowsFor(platform) });
    return await recordTake({ options, control, platform, area, cameraMode, projectDir, dir: allocateTake(projectDir), reporter, claude });
  } finally {
    claude?.stop();
  }
```

with:

```ts
    if (control.reason !== undefined) throw cancelled('it started');
    // A window is captured where it is when the recording starts, not where it was before the countdown.
    if (options.source.kind === 'window') area = resolveArea(options.source, { ...devices, windows: await windowsFor(platform) });
    const whole = await byItself;
    if (whole) area = wholeWindow(area);
    else if (window && platform === 'windows') {
      reporter.warn('this ffmpeg cannot record a window by itself (ffmpeg 8 or newer can: winget upgrade Gyan.FFmpeg): the screen where the window is is recorded, so keep the window in front');
    }
    return await recordTake({ options, control, platform, area, byItself: whole, cameraMode, projectDir, dir: allocateTake(projectDir), reporter, claude });
  } finally {
    claude?.stop();
  }
```

In the same file, replace:

```ts
  control: Control;
  platform: Platform;
  area: ScreenArea;
  /** The webcam's picture size, where the platform needs to ask for one (macOS). */
  cameraMode: CameraMode | undefined;
  projectDir: string;
```

with:

```ts
  control: Control;
  platform: Platform;
  area: ScreenArea;
  /** A window take of the window by itself through gfxcapture (Windows) or a test pattern (the test backend). */
  byItself: boolean;
  /** The webcam's picture size, where the platform needs to ask for one (macOS). */
  cameraMode: CameraMode | undefined;
  projectDir: string;
```

In the same file, replace:

```ts
/** A track's file in segment `k` of a paused take: `screen.2.mp4`. */
const numbered = (file: string, k: number) => file.replace(/\.(mp4|m4a)$/, `.${k}.$1`);

async function recordTake({ options, control, platform, area, cameraMode, projectDir, dir, reporter, claude }: TakeContext): Promise<Take> {
  const path = (file: string) => join(dir, file);
  const rel = (file: string) => relative(projectDir, file).split(sep).join('/');
  /** The take's stretches between pauses; written to segments.json from the first pause on. */
```

with:

```ts
/** A track's file in segment `k` of a paused take: `screen.2.mp4`. */
const numbered = (file: string, k: number) => file.replace(/\.(mp4|m4a)$/, `.${k}.$1`);

async function recordTake({ options, control, platform, area, byItself, cameraMode, projectDir, dir, reporter, claude }: TakeContext): Promise<Take> {
  const path = (file: string) => join(dir, file);
  const rel = (file: string) => relative(projectDir, file).split(sep).join('/');
  /** The take's stretches between pauses; written to segments.json from the first pause on. */
```

In the same file, replace:

```ts
  // macOS: the camera's and the mic's starts are their capture times on the host clock, mapped to the wall clock
  const ownStamps = deviceClock(platform);
  const toWall = ownStamps ? (await import('./darwin').then(({ loadDarwin }) => loadDarwin())).hostToWall : (seconds: number) => seconds;
  // macOS, a window take through the helper: the window by itself, and only the input done in it
  const gate = helper && area.window !== undefined ? windowGate(area.window, { ...origin, ...size }, (corner) => writer.moveOrigin(corner)) : undefined;
  if (gate) {
    const mac = await (await import('./darwin')).loadDarwin();
    const look = () => {
      try {
        gate.look(mac.foreground());
      } catch {
        // the next look tries again
      }
```

with:

```ts
  // macOS: the camera's and the mic's starts are their capture times on the host clock, mapped to the wall clock
  const ownStamps = deviceClock(platform);
  const toWall = ownStamps ? (await import('./darwin').then(({ loadDarwin }) => loadDarwin())).hostToWall : (seconds: number) => seconds;
  // a window take by itself (macOS's helper, Windows' gfxcapture): only the input done in the window
  const gate = area.window !== undefined && (helper !== undefined || (byItself && platform === 'windows')) ? windowGate(area.window, { ...origin, ...size }, (corner) => writer.moveOrigin(corner)) : undefined;
  if (gate) {
    const os = platform === 'macos' ? await (await import('./darwin')).loadDarwin() : await (await import('./win32')).loadWin32();
    const look = () => {
      try {
        gate.look(os.foreground());
      } catch {
        // the next look tries again
      }
```

In the same file, replace:

```ts
    look();
    timer(look, WINDOW_GATE_MS, true);
  }
  if (platform === 'macos' && !helper && (options.hideWindowsOf?.length ?? 0) > 0) {
    reporter.warn("Cuttle's own windows show in this take: the capture helper is missing (it is built by pnpm install with Xcode's command line tools)");
  }
```

with:

```ts
    look();
    timer(look, WINDOW_GATE_MS, true);
  }
  // Windows and the test backend, a window by itself: a feeder reads it, its newest frame is written 30 times a second
  const feeder = byItself ? (platform === 'windows' ? windowFeeder(area.window!, size, options.drawMouse ?? false) : testWindowFeeder(size)) : undefined;
  if (byItself && platform === 'windows') cleanups.push((await (await import('./win32')).loadWin32()).fineTimers());
  if (platform === 'macos' && !helper && (options.hideWindowsOf?.length ?? 0) > 0) {
    reporter.warn("Cuttle's own windows show in this take: the capture helper is missing (it is built by pnpm install with Xcode's command line tools)");
  }
```

In the same file, replace:

```ts
    const drawMouse = options.drawMouse ?? false;
    const screen = helper
      ? spawnCapture('screen', screenArgs(helperInput(area), file(FILES.screen), options.stop.untilIdleSeconds), { command: helper, args: helperArgs(area, drawMouse, options.hideWindowsOf ?? []) })
      : spawnCapture('screen', screenArgs(screenInput(platform, area, drawMouse), file(FILES.screen), options.stop.untilIdleSeconds, screenFilter(platform, area)));
    const webcam = options.webcam === undefined ? undefined : spawnCapture('webcam', webcamArgs(webcamInput(platform, options.webcam, cameraMode), file(FILES.webcam), !ownStamps));
    // the mic's level and its samples, while the take records (whole samples per capture: one that
    // stops at a pause may end inside a sample)
```

with:

```ts
    const drawMouse = options.drawMouse ?? false;
    const screen = helper
      ? spawnCapture('screen', screenArgs(helperInput(area), file(FILES.screen), options.stop.untilIdleSeconds), { command: helper, args: helperArgs(area, drawMouse, options.hideWindowsOf ?? []) })
      : feeder
        ? spawnCapture('screen', screenArgs(relayInput(size), file(FILES.screen), options.stop.untilIdleSeconds), feeder)
        : spawnCapture('screen', screenArgs(screenInput(platform, area, drawMouse), file(FILES.screen), options.stop.untilIdleSeconds, screenFilter(platform, area)));
    // the window was closed: the take ends there
    void screen.ended?.then(() => {
      if (control.reason !== undefined) return;
      reporter.warn('the window was closed: the take ends there');
      control.request('window');
    });
    const webcam = options.webcam === undefined ? undefined : spawnCapture('webcam', webcamArgs(webcamInput(platform, options.webcam, cameraMode), file(FILES.webcam), !ownStamps));
    // the mic's level and its samples, while the take records (whole samples per capture: one that
    // stops at a pause may end inside a sample)
```

Run: `pnpm exec vitest run --project node packages/recorder/test/sources.test.ts packages/recorder/test/win32.test.ts packages/recorder/test/window-gate.test.ts`
Expected: PASS.

Run: `pnpm exec vitest run --project realtime packages/recorder/test/record.test.ts`
Expected: PASS, 26 tests.

Run (Windows, ffmpeg 8 or newer, the taskbar at the bottom): `pnpm exec vitest run --mode real --silent=false packages/recorder/test/real.test.ts -t "records a window by itself"`
Expected: PASS, with lines like `window 393500 640×52: 2.03 s, warnings []`, `its colour at 1 s: 0, 255, 1` and `61 frames in 2.03 s`.

- [ ] **Step 5: Commit**

```bash
git add packages/recorder
git commit -m "recorder: a window take on Windows records the window by itself

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The guide, and final verification

**Files:**
- Modify: `README.md`, `skill/cuttle/SKILL.md`

- [ ] **Step 1: The README and the skill**

In `README.md`, replace:

```markdown
    <td width="50%"><img src="docs/media/feature-auto-edit.jpg" alt="Cuttle's timeline after its cut: 4:12 became 0:38" /></td>
  </tr>
  <tr>
    <td valign="top"><b>Record a window, a screen or a region.</b> With your webcam and mic, a countdown and a small recording bar that never shows in the video. On a Mac a window take records only that window, so you can keep working (or chatting) beside it. Pause, mark a slip with one key, and keep a script of your steps in a prompter.</td>
    <td valign="top"><b>It cuts itself.</b> Idle stretches out, waiting sped up with a speed badge, slips and long pauses gone, zooms placed where they belong. A take of four minutes becomes a tight demo, in seconds, on your computer.</td>
  </tr>
  <tr>
```

with:

```markdown
    <td width="50%"><img src="docs/media/feature-auto-edit.jpg" alt="Cuttle's timeline after its cut: 4:12 became 0:38" /></td>
  </tr>
  <tr>
    <td valign="top"><b>Record a window, a screen or a region.</b> With your webcam and mic, a countdown and a small recording bar that never shows in the video. A window take records only that window, also while another one lies over it, so you can keep working (or chatting) beside it. Pause, mark a slip with one key, and keep a script of your steps in a prompter.</td>
    <td valign="top"><b>It cuts itself.</b> Idle stretches out, waiting sped up with a speed badge, slips and long pauses gone, zooms placed where they belong. A take of four minutes becomes a tight demo, in seconds, on your computer.</td>
  </tr>
  <tr>
```

In the same file, replace:

```markdown
| Node 22 or newer | `winget install OpenJS.NodeJS.LTS` | `brew install node`, or the installer from nodejs.org |
| pnpm 11 | `corepack enable` (or `npm install -g pnpm@11`) | the same |
| ffmpeg and ffprobe | `winget install Gyan.FFmpeg` | `brew install ffmpeg` |
| Transcription (whisper) | in Gyan's ffmpeg (its `whisper` filter) | `brew install whisper-cpp` (no macOS ffmpeg has the filter; Cuttle runs `whisper-cli` instead) |
| Permissions | none | the first recording asks for them (below) |
```

with:

```markdown
| Node 22 or newer | `winget install OpenJS.NodeJS.LTS` | `brew install node`, or the installer from nodejs.org |
| pnpm 11 | `corepack enable` (or `npm install -g pnpm@11`) | the same |
| ffmpeg and ffprobe | `winget install Gyan.FFmpeg` | `brew install ffmpeg` |
| A window by itself | in ffmpeg 8 and newer (its `gfxcapture` source); with an older one Cuttle records the screen where the window is | the same as a screen |
| Transcription (whisper) | in Gyan's ffmpeg (its `whisper` filter) | `brew install whisper-cpp` (no macOS ffmpeg has the filter; Cuttle runs `whisper-cli` instead) |
| Permissions | none | the first recording asks for them (below) |
```

In the same file, replace:

```markdown
| `@cuttle/timeline` | What is on screen at any output time: scenes, speed, zooms, masks, texts, cursor, crossfades (none at a continuous cut), overlay ramps in output time |
| `@cuttle/engine` | WebGL2 compositor: backgrounds, window frames, zoom, masks, cursors, webcam, texts, stills, cards, crossfades |
| `@cuttle/export` | MP4 export in a hidden Electron window: decode, render, encode H.264, mux; mic cut to the scenes with ffmpeg (AAC) |
| `@cuttle/recorder` | Records a take on Windows (ddagrab, DirectShow, a global input hook) and macOS (avfoundation, an event tap): a monitor, region or window, webcam and mic, input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |
| `@cuttle/core` | Project operations for the CLI and the app: `cuttle.json` as written (hash-checked writes, backups), takes, suggest, recover, frame, ffmpeg |
| `apps/cli` | The `cuttle` command: init, devices, record, suggest, preview, frame, capture-page, render, recover; `--json` for Claude |
| `apps/desktop` | The Cuttle app (Electron, React): the pill and tray, an editor per project (the export's engine in the output view, played with the mic as the clock; a timeline with thumbnails, waveform, markers and input activity; the export sheet) |
```

with:

```markdown
| `@cuttle/timeline` | What is on screen at any output time: scenes, speed, zooms, masks, texts, cursor, crossfades (none at a continuous cut), overlay ramps in output time |
| `@cuttle/engine` | WebGL2 compositor: backgrounds, window frames, zoom, masks, cursors, webcam, texts, stills, cards, crossfades |
| `@cuttle/export` | MP4 export in a hidden Electron window: decode, render, encode H.264, mux; mic cut to the scenes with ffmpeg (AAC) |
| `@cuttle/recorder` | Records a take on Windows (ddagrab, a window by itself through gfxcapture, DirectShow, a global input hook) and macOS (avfoundation, an event tap): a monitor, region or window, webcam and mic, input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |
| `@cuttle/core` | Project operations for the CLI and the app: `cuttle.json` as written (hash-checked writes, backups), takes, suggest, recover, frame, ffmpeg |
| `apps/cli` | The `cuttle` command: init, devices, record, suggest, preview, frame, capture-page, render, recover; `--json` for Claude |
| `apps/desktop` | The Cuttle app (Electron, React): the pill and tray, an editor per project (the export's engine in the output view, played with the mic as the clock; a timeline with thumbnails, waveform, markers and input activity; the export sheet) |
```

In `skill/cuttle/SKILL.md`, replace:

```markdown

- What the demo shows, and how it ends (Claude's answer, a page, a result on screen).
- Which screen: run `cuttle --json devices` and name the monitors (index, size, primary) and
  matching windows. A window (`--window`) or a region keeps the video small and private. On a Mac
  a window take records that window by itself: the user may switch to other apps (and to you)
  meanwhile, and only what is done in the window is logged. On Windows the screen where the window
  is is recorded: keep the window in front.
- The format: 16:9 for X, YouTube and LinkedIn; 9:16 for Shorts, Reels and TikTok; 1:1 for feeds.
  X takes H.264 up to 1920×1200; keep demos under 60 s. A 16:9 screen fills only about a third
  of a 9:16 video: for 9:16 record a narrow window or region, or plan tight zooms.
```

with:

```markdown

- What the demo shows, and how it ends (Claude's answer, a page, a result on screen).
- Which screen: run `cuttle --json devices` and name the monitors (index, size, primary) and
  matching windows. A window (`--window`) or a region keeps the video small and private. A window
  take records that window by itself: the user may switch to other apps (and to you) meanwhile, even
  over it, and only what is done in the window is logged; closing the window ends the take. On
  Windows that needs ffmpeg 8 or newer: with an older one `record` warns and records the screen
  where the window is, so the window must stay in front.
- The format: 16:9 for X, YouTube and LinkedIn; 9:16 for Shorts, Reels and TikTok; 1:1 for feeds.
  X takes H.264 up to 1920×1200; keep demos under 60 s. A 16:9 screen fills only about a third
  of a 9:16 video: for 9:16 record a narrow window or region, or plan tight zooms.
```

```bash
git add README.md skill/cuttle/SKILL.md
git commit -m "docs: a window take records the window by itself on Windows too

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 986 passed and 81 skipped (here, with a speech model and ffmpeg's whisper filter; without them the real transcriptions are skipped too, and off Windows and macOS the OCR tests).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 16 tests.

Run: `pnpm app:check`
Expected: PASS, 58 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 3: By hand (the user)**

1. In the app, pick a window and record it; meanwhile put another window over it and work there. The video shows only the recorded window, and the clicks in the other window are not in it.
2. `cuttle -C "<project>" record --window "<part of its title>" --max 30`, then close that window: the take ends at once, `(window)`.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **The first probes counted no frames at all:** ffmpeg buffered its frame list, and the probe ended it by a kill. With `-flush_packets 1` the frames were there; the decisions above rest on the second measurements.
- **A probe window entirely off every monitor** sent no frames even while it repainted, so the real check's window lies under the taskbar instead.

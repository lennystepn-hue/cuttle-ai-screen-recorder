# Cuttle: Faster Screen Reading, a Helper That Cannot Hang, Checks That Do Not Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user asked for an app and code that are sturdier and, where possible, faster. Measuring first showed where a take's wait goes, and these changes came out of it:
- **Faster screen reading:** the screen's text is read by up to three OCR helpers at once. On the measured take this is 2.0 times faster (11.3 s down to 5.5 s); with more frames it gets closer to 2.7 times.
- **A helper that hangs:** an OCR helper that does not answer within 60 s is ended. The take is then cut without reading the screen, with a note, instead of waiting for good.
- **App checks that do not cascade:** a test that fails while a take records no longer fails the tests after it, and the prompter's step gets 5 s instead of 1.
- **The relay's tests under load:** the frame rate of a window take is checked against 20 a second (ten times what its feeder sends), not 27: beside a hundred other test files a full run measured 24.6.

**Architecture:** `@cuttle/core`, `privacy/`:
- `readFrames` starts `helpersFor(frames)` OCR helpers: one for every four logical processors, three at most, and one for every four frames.
- Each helper takes the next frame not taken yet and writes it while it reads the one before. The frames come back in order.
- `answerWithin` gives each answer of a helper a time limit.

The app's check reaches the recorder host through a check-only global (`__recorder`), like `__deleteTake`.

**Tech Stack:** TypeScript strict, Windows.Media.Ocr through Windows PowerShell 5.1, Vision on macOS.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `faster-screen-reading`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The full `pnpm test` and the typecheck run in Task 2.

## Decisions made while planning

The finished prototype passed `pnpm test` (989 tests, 81 skipped; four full runs, the first with the relay test this plan loosens: see the end), the typecheck, `cli:check` (16 tests) and `app:check` (58). Every screenshot was looked at.

**What was measured.** A synthetic take: 60 s of a terminal at 2560×1440, encoded as Cuttle records. It types, prints output in bursts and rests in between. The machine has 16 logical processors and an AMD Radeon GPU.

| Step after a take | Time |
|---|---|
| `analyseScreen` (still stretches, the whole take decoded) | 2.0 s |
| `framesToRead` (which frames to read, the clips decoded again) | 1.6 s |
| `screenBands`, typing frames, `probeScreen` | 0.4 s, 0.4 s, 0.1 s |
| **`readFrames` (15 frames read with the OCR)** | **11.3 s** |

**Inside the OCR**, a frame costs:
- 170 ms to write it (ffmpeg); this already overlaps the reading.
- 175 ms to decode it and scale it to twice its size: Windows' OCR takes up to 10000 px.
- 435 ms to recognize it.
- 4 to 56 ms to build the JSON.

The OCR keeps about one processor busy. Helpers at once on the same 15 frames:

| Helpers | Per frame |
|---|---|
| 1 | 659 ms |
| 2 | 403 ms |
| 3 | 242 ms |
| 4 | 199 ms |

Three at most, because the fourth gains little and each Windows PowerShell helper holds about 100 MB. With 15 frames and three helpers, `readFrames` takes 5.5 s, the helpers' start (about a second, in parallel) included.

**Measured and left as they are:**
- **Hardware decoding** (`-hwaccel d3d11va`) for the analysis: 6.7 s instead of 2.0, since the frames come back from the GPU. Decoding alone is 1.35 s.
- **`fast_bilinear` scaling** in the analysis: 0.4 s less a minute. But it changes which small changes count, for a small gain.
- **The export's H.264 encoder:**
  - Chromium offers no hardware encoder on this GPU in any configuration, so `auto` rightly falls back to software.
  - The software encoder takes 150 to 200 frames a second in both latency modes.
  - A 60 s export at 1080p takes 18.4 s.
- **The editor's proxy:** 6 s for a minute, in the background, blocking nothing.
- **A smaller OCR upscale on high-DPI screens:** it would be faster, but it could miss small text, so it is not done without a study of what it reads.

**The rest:**
- **One helper per four frames:** a take with few frames to read does not start helpers it does not need.
- **A helper that cannot start beside one that can** only leaves the others more to do. Only when none starts is the screen not read (`ocr-missing`, as before).
- **The time limit:**
  - 60 s to start (a cold Windows PowerShell can take several) and 60 s for one picture.
  - A hung helper is ended, and the error is `ocr-missing`.
  - suggest then goes on without the screen's text, with its note "the screen's text was not read: …, so look for private things yourself". The app shows its error.
- **The app check's cascade:**
  - The first full run of the check for privacy 3 failed 7 of 58 tests. The prompter's step was polled for 1 s, which ran out under load, and the take that test left running made the next six find no new window.
  - An `afterEach` now stops a take that is still running and waits for its end. The step's poll waits up to 5 s.

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/privacy/read.ts` | helpers at once, in order |
| `packages/core/src/privacy/ocr.ts` | a time limit for each answer |
| `apps/desktop/src/main/recorder-host.ts`, `apps/desktop/test/app.check.test.ts` | the check stops a take a failed test left running |
| `packages/recorder/test/ffmpeg.test.ts`, `packages/recorder/test/record.test.ts` | the relay's frame rate under load |

---

### Task 1: OCR helpers at once, and a time limit

**Files:**
- Modify: `packages/core/src/privacy/read.ts`, `packages/core/src/privacy/ocr.ts`
- Test: `packages/core/test/privacy-read.test.ts`, `packages/core/test/privacy-ocr.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `faster-screen-reading`; work there:

```bash
git switch faster-screen-reading
```

- [ ] **Step 2: Write the failing tests**

How many helpers:

In `packages/core/test/privacy-read.test.ts`, replace:

```ts
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runFfmpeg } from '../src/ffmpeg';
import { READ_RULES, framesToRead } from '../src/privacy/read';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
```

with:

```ts
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runFfmpeg } from '../src/ffmpeg';
import { READ_RULES, framesToRead, helpersFor } from '../src/privacy/read';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
```

In the same file, replace:

```ts
    expect(await framesToRead(file, [{ from: 0.5, to: 1.5 }, { from: 2, to: 4 }], size)).toEqual([0.5, 2, 2.5]);
  });
});
```

with:

```ts
    expect(await framesToRead(file, [{ from: 0.5, to: 1.5 }, { from: 2, to: 4 }], size)).toEqual([0.5, 2, 2.5]);
  });
});

describe('helpersFor', () => {
  it('reads with one OCR helper for every four logical processors, three at most, and one for every four frames', () => {
    expect([helpersFor(1, 16), helpersFor(6, 16), helpersFor(15, 16), helpersFor(100, 32)]).toEqual([1, 2, 3, 3]);
    expect([helpersFor(15, 8), helpersFor(15, 4), helpersFor(15, 2)]).toEqual([2, 1, 1]);
    expect(helpersFor(0, 16)).toBe(1);
  });
});
```

A helper that does not answer, and the fixture page read by three helpers as by one (where there is an OCR):

In `packages/core/test/privacy-ocr.test.ts`, replace:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Rect } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';
import { redactFrames } from '../src/privacy/redact';
import { ScreenReader } from '../src/privacy/ocr';

/**
 * The system's own OCR (Windows', macOS's Vision) on a page with planted fake secrets
```

with:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';
import { readFrames } from '../src/privacy/read';
import { redactFrames } from '../src/privacy/redact';
import { ScreenReader, answerWithin } from '../src/privacy/ocr';

describe('answerWithin', () => {
  it("ends a helper that does not answer in time, and passes an answer that comes", async () => {
    const hung = vi.fn();
    const never: AsyncIterator<string> = { next: () => new Promise(() => {}) };
    await expect(answerWithin(never, 0.05, 'reading a.png', hung)).rejects.toMatchObject({ code: 'ocr-missing', message: 'the OCR helper did not answer within 0.05 s (reading a.png)' });
    expect(hung).toHaveBeenCalledOnce();
    const soon: AsyncIterator<string> = { next: () => Promise.resolve({ done: false, value: '{"lines":[]}' }) };
    await expect(answerWithin(soon, 1, 'reading b.png', hung)).resolves.toEqual({ done: false, value: '{"lines":[]}' });
    expect(hung).toHaveBeenCalledOnce();
  });
});

/**
 * The system's own OCR (Windows', macOS's Vision) on a page with planted fake secrets
```

In the same file, replace:

```ts
    for (const clean of ['Release', 'Order']) expect(keptText, clean).toContain(clean);
    expect(privacyMasks(kept, [], { width: 1920, height: 1080 })).toEqual(masks);
  }, 60_000);
});
```

with:

```ts
    for (const clean of ['Release', 'Order']) expect(keptText, clean).toContain(clean);
    expect(privacyMasks(kept, [], { width: 1920, height: 1080 })).toEqual(masks);
  }, 60_000);

  it('reads frames with several helpers at once, each frame its own text, in order', async () => {
    delete process.env.CUTTLE_OCR;
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-ocr-'));
    try {
      // the page for 6 s, its upper half black in every odd second (lossless: each second's frames are the same)
      const video = join(dir, 'page.mp4');
      const made = spawnSync('ffmpeg', ['-v', 'error', '-loop', '1', '-i', join(import.meta.dirname, 'fixtures', 'privacy', 'secrets.png'), '-t', '6', '-r', '10', '-vf', "drawbox=x=0:y=0:w=1920:h=540:color=black:t=fill:enable='mod(floor(t),2)',format=yuv420p", '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-y', video]);
      expect(made.status).toBe(0);
      const times = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
      const size = { width: 1920, height: 1080 };
      const one = await readFrames(video, times, size, { helpers: 1 });
      const progress: number[] = [];
      const three = await readFrames(video, times, size, { helpers: 3, onProgress: (share) => progress.push(share) });
      expect(three).toEqual(one);
      expect(three.frames.map((frame) => frame.t)).toEqual(times);
      const counts = three.frames.map((frame) => frame.lines.length);
      expect(counts[0]).toBeGreaterThan(counts[1]!);
      expect([counts[2], counts[4]]).toEqual([counts[0], counts[0]]);
      expect([counts[3], counts[5]]).toEqual([counts[1], counts[1]]);
      expect(progress).toEqual([1, 2, 3, 4, 5, 6].map((done) => done / 6));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
```

Run: `pnpm exec vitest run --project node packages/core/test/privacy-read.test.ts packages/core/test/privacy-ocr.test.ts`
Expected: FAIL: `helpersFor` and `answerWithin` are not exported.

- [ ] **Step 3: The time limit**

In `packages/core/src/privacy/ocr.ts`, replace:

```ts
/** Pictures are read at up to twice their size on Windows (its OCR reads small text much better so; Vision needs no help). */
export const OCR_SCALE = 2;

/** What the helper answers to a picture: its lines, each a list of words with their rects. */
type Answer = { lines?: { t: string; r: [number, number, number, number] }[][]; error?: string };
```

with:

```ts
/** Pictures are read at up to twice their size on Windows (its OCR reads small text much better so; Vision needs no help). */
export const OCR_SCALE = 2;

/**
 * Seconds the helper may take to start (Windows PowerShell, cold, can take several) and to read one
 * picture (well under one here) before it counts as hung: then it is ended, and the screen is not read.
 */
export const OCR_TIMEOUT = { start: 60, read: 60 };

/**
 * The helper's next answer, or `ocr-missing` when none came within `seconds` (`hung` is called
 * then: it ends the helper).
 */
export function answerWithin(answers: AsyncIterator<string>, seconds: number, what: string, hung: () => void): Promise<IteratorResult<string>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hung();
      reject(new CoreError('ocr-missing', `the OCR helper did not answer within ${seconds} s (${what})`));
    }, seconds * 1000);
    answers.next().then(
      (answer) => {
        clearTimeout(timer);
        resolve(answer);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** What the helper answers to a picture: its lines, each a list of words with their rects. */
type Answer = { lines?: { t: string; r: [number, number, number, number] }[][]; error?: string };
```

In the same file, replace:

```ts
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const started = new Promise<never>((_, reject) => child.on('error', (error) => reject(new CoreError('ocr-missing', `the OCR helper did not start (${error.message})`))));
    const first = await Promise.race([answers.next(), started]);
    const hello = first.done ? undefined : (JSON.parse(first.value) as { ready: boolean; language?: string; max?: number });
    if (!hello?.ready) {
      child.kill();
```

with:

```ts
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const started = new Promise<never>((_, reject) => child.on('error', (error) => reject(new CoreError('ocr-missing', `the OCR helper did not start (${error.message})`))));
    const first = await Promise.race([answerWithin(answers, OCR_TIMEOUT.start, 'starting', () => child.kill()), started]);
    const hello = first.done ? undefined : (JSON.parse(first.value) as { ready: boolean; language?: string; max?: number });
    if (!hello?.ready) {
      child.kill();
```

In the same file, replace:

```ts
  async read(path: string, width: number, height: number): Promise<ScreenTextLine[]> {
    const scale = this.upscales ? Math.max(1, Math.min(OCR_SCALE, this.maxSide / Math.max(width, height))) : 1;
    this.child.stdin.write(`${JSON.stringify({ path, scale })}\n`);
    const next = await this.answers.next();
    if (next.done) throw new CoreError('ocr-missing', 'the OCR helper stopped');
    const answer = JSON.parse(next.value) as Answer;
    if (answer.error) throw new CoreError('invalid-media', `the OCR could not read ${path}: ${answer.error}`);
```

with:

```ts
  async read(path: string, width: number, height: number): Promise<ScreenTextLine[]> {
    const scale = this.upscales ? Math.max(1, Math.min(OCR_SCALE, this.maxSide / Math.max(width, height))) : 1;
    this.child.stdin.write(`${JSON.stringify({ path, scale })}\n`);
    const next = await answerWithin(this.answers, OCR_TIMEOUT.read, `reading ${path}`, () => this.child.kill());
    if (next.done) throw new CoreError('ocr-missing', 'the OCR helper stopped');
    const answer = JSON.parse(next.value) as Answer;
    if (answer.error) throw new CoreError('invalid-media', `the OCR could not read ${path}: ${answer.error}`);
```

- [ ] **Step 4: Helpers at once**

In `packages/core/src/privacy/read.ts`, replace:

```ts
// clips (compared 10 times a second; read at most 2 a second while it keeps changing, at least one
// every 5 s, and once more where a change showed only a moment), each read with the system's OCR
// (ocr.ts), written as the take's screen-text.jsonl with each private thing in it marked instead
// (redact.ts). Only the frames that are read are written to a temporary folder, one at a time, and
// removed once read.
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScreenTextFrame } from '@cuttle/project';
import { CoreError } from '../errors';
```

with:

```ts
// clips (compared 10 times a second; read at most 2 a second while it keeps changing, at least one
// every 5 s, and once more where a change showed only a moment), each read with the system's OCR
// (ocr.ts), written as the take's screen-text.jsonl with each private thing in it marked instead
// (redact.ts). Only the frames that are read are written to a temporary folder, one at a time for
// each OCR helper, and removed once read.
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScreenTextFrame } from '@cuttle/project';
import { CoreError } from '../errors';
```

In the same file, replace:

```ts
}

/**
 * Reads the screen's text of `screen` at `times` (source seconds) with the OCR helper, in order;
 * `onProgress` gets the share done. `ocr-missing` where the helper cannot run.
 */
export async function readFrames(
  screen: string,
  times: readonly number[],
  size: { width: number; height: number },
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<{ frames: ScreenTextFrame[]; language: string }> {
  const reader = await ScreenReader.start();
  const folder = mkdtempSync(join(tmpdir(), 'cuttle-screen-'));
  const extract = async (k: number) => {
    const path = join(folder, `${k}.png`);
```

with:

```ts
}

/**
 * OCR helpers that read at once: the OCR keeps about one logical processor busy, and the helpers
 * scale (a 2560 × 1440 frame on 16 logical processors: 659 ms a frame with one helper, 403 with two,
 * 242 with three, 199 with four). One for every `processors` of them, `most` at most, and one for
 * every `frames` frames (a helper takes a second or so to start).
 */
export const OCR_HELPERS = { processors: 4, most: 3, frames: 4 };

/** How many OCR helpers read `count` frames on this computer. */
export function helpersFor(count: number, processors = cpus().length, rules = OCR_HELPERS): number {
  return Math.max(1, Math.min(rules.most, Math.floor(processors / rules.processors), Math.ceil(count / rules.frames)));
}

/**
 * Reads the screen's text of `screen` at `times` (source seconds) with OCR helpers (`helpers`, else
 * `helpersFor`), the frames in order; `onProgress` gets the share done. `ocr-missing` where no
 * helper can run; a helper that cannot start besides one that can only leaves the others more to do.
 */
export async function readFrames(
  screen: string,
  times: readonly number[],
  size: { width: number; height: number },
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal; helpers?: number } = {},
): Promise<{ frames: ScreenTextFrame[]; language: string }> {
  const started = await Promise.allSettled(Array.from({ length: options.helpers ?? helpersFor(times.length) }, () => ScreenReader.start()));
  const readers = started.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  if (readers.length === 0) throw (started[0] as PromiseRejectedResult).reason;
  const folder = mkdtempSync(join(tmpdir(), 'cuttle-screen-'));
  const extract = async (k: number) => {
    const path = join(folder, `${k}.png`);
```

In the same file, replace:

```ts
    return path;
  };
  const frames: ScreenTextFrame[] = [];
  try {
    // the next frame is written while the OCR reads this one
    let next = times.length > 0 ? extract(0) : undefined;
    for (let k = 0; k < times.length; k++) {
      if (options.signal?.aborted) throw new CoreError('cancelled', 'reading the screen was cancelled');
      const path = await next!;
      next = k + 1 < times.length ? extract(k + 1) : undefined;
      next?.catch(() => {});
      const lines = await reader.read(path, size.width, size.height);
      rmSync(path, { force: true });
      frames.push({ t: times[k]!, lines });
      options.onProgress?.((k + 1) / times.length);
    }
    await next?.catch(() => {});
  } finally {
    reader.close();
    rmSync(folder, { recursive: true, force: true });
  }
  return { frames, language: reader.language };
}

/**
```

with:

```ts
    return path;
  };
  const frames: ScreenTextFrame[] = [];
  let taken = 0;
  let done = 0;
  let failed = false;
  /** One helper's share: the next frame not taken yet, written while the helper reads the one before. */
  const work = async (reader: ScreenReader) => {
    let k = taken++;
    let next = k < times.length ? extract(k) : undefined;
    try {
      while (k < times.length && !failed) {
        if (options.signal?.aborted) throw new CoreError('cancelled', 'reading the screen was cancelled');
        const path = await next!;
        const after = taken++;
        next = after < times.length ? extract(after) : undefined;
        next?.catch(() => {});
        const lines = await reader.read(path, size.width, size.height);
        rmSync(path, { force: true });
        frames[k] = { t: times[k]!, lines };
        options.onProgress?.(++done / times.length);
        k = after;
      }
    } catch (error) {
      failed = true; // the other helpers take no new frame
      throw error;
    } finally {
      await next?.catch(() => {});
    }
  };
  try {
    await Promise.all(readers.map(work));
  } finally {
    for (const reader of readers) reader.close();
    rmSync(folder, { recursive: true, force: true });
  }
  return { frames, language: readers[0]!.language };
}

/**
```

Run: `pnpm exec vitest run --project node packages/core/test/privacy-read.test.ts packages/core/test/privacy-ocr.test.ts packages/core/test/privacy-apply.test.ts packages/core/test/suggest.test.ts`
Expected: PASS, 22 tests (on Windows and macOS; elsewhere the OCR tests are skipped).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "privacy: the screen's text read by up to three OCR helpers at once, each answer within 60 s

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Checks that do not cascade or flake, and final verification

**Files:**
- Modify: `apps/desktop/src/main/recorder-host.ts`, `apps/desktop/test/app.check.test.ts`, `packages/recorder/test/ffmpeg.test.ts`, `packages/recorder/test/record.test.ts`

- [ ] **Step 1: The recorder host for the check, the stop after a failed test, the step's poll**

In `apps/desktop/src/main/recorder-host.ts`, replace:

```ts
import { utilityProcess, type UtilityProcess } from 'electron';
import type { Bounds, Devices, RecordOptions, RecorderEvent, Take } from '@cuttle/recorder';
import type { HostReply, HostRequest, LiveRequest } from '../shared/recording';
import { TEST_BACKEND } from './check';
import { bundlePath } from './protocols';

/** A failed recording, with the recorder's error code (`capture`, `device-not-found`, …). */
```

with:

```ts
import { utilityProcess, type UtilityProcess } from 'electron';
import type { Bounds, Devices, RecordOptions, RecorderEvent, Take } from '@cuttle/recorder';
import type { HostReply, HostRequest, LiveRequest } from '../shared/recording';
import { CHECK, TEST_BACKEND } from './check';
import { bundlePath } from './protocols';

/** A failed recording, with the recorder's error code (`capture`, `device-not-found`, …). */
```

In the same file, replace:

```ts
}

export const recorderHost = new RecorderHost();
```

with:

```ts
}

export const recorderHost = new RecorderHost();
// the end-to-end check stops a take that a failed test left running, so the next test starts clean
if (CHECK) Object.assign(globalThis, { __recorder: recorderHost });
```

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
import { parseEventsJsonl, parseProjectJson } from '@cuttle/project';
import { sceneSpans, typingClicks } from '@cuttle/timeline';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OUTPUT, makeFixture, makeMotionFixture, makePrivateFixture, makeRestingFixture, makeSpokenFixture } from './fixture';

/**
```

with:

```ts
import { parseEventsJsonl, parseProjectJson } from '@cuttle/project';
import { sceneSpans, typingClicks } from '@cuttle/timeline';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OUTPUT, makeFixture, makeMotionFixture, makePrivateFixture, makeRestingFixture, makeSpokenFixture } from './fixture';

/**
```

In the same file, replace:

```ts
    await editor.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    for (const response of hanging) response.destroy();
```

with:

```ts
    await editor.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 60_000);

  // A test that failed while a take recorded (its HUD, its windows) would fail the tests after it,
  // which find no new window while it runs: the take is stopped, and the next test waits for its end.
  afterEach(async () => {
    type Host = { recording: boolean; stop(): void };
    const running = () => app.evaluate(() => (globalThis as { __recorder?: Host }).__recorder?.recording ?? false);
    if (!(await running().catch(() => false))) return;
    await app.evaluate(() => (globalThis as { __recorder?: Host }).__recorder?.stop());
    await expect.poll(running, { timeout: 30_000 }).toBe(false);
  });

  afterAll(async () => {
    await app?.close().catch(() => {});
    for (const response of hanging) response.destroy();
```

In the same file, replace:

```ts
    expect(await prompter.locator('[data-testid=prompter-count]').textContent()).toBe('Step 1 of 3');
    await wait(800);
    await click(prompter, '[data-testid=prompter-next]');
    await expect.poll(() => prompter.locator('[data-testid=prompter-title]').textContent()).toBe('Turn on dark mode');
    expect(await prompter.locator('[data-testid=prompter-count]').textContent()).toBe('Step 2 of 3');
    expect(await prompter.locator('.prompter-note').textContent()).toBe('Say that it follows the system.');
    expect(await prompter.locator('.prompter-then').textContent()).toBe('Then Export the video');
```

with:

```ts
    expect(await prompter.locator('[data-testid=prompter-count]').textContent()).toBe('Step 1 of 3');
    await wait(800);
    await click(prompter, '[data-testid=prompter-next]');
    // the step goes to the recorder's process and back: under load more than a second
    await expect.poll(() => prompter.locator('[data-testid=prompter-title]').textContent(), { timeout: 5_000 }).toBe('Turn on dark mode');
    expect(await prompter.locator('[data-testid=prompter-count]').textContent()).toBe('Step 2 of 3');
    expect(await prompter.locator('.prompter-note').textContent()).toBe('Say that it follows the system.');
    expect(await prompter.locator('.prompter-then').textContent()).toBe('Then Export the video');
```

```bash
git add apps/desktop
git commit -m "app check: a take a failed test left running is stopped; the prompter's step polled for 5 s

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: The relay's frame rate under load**

In `packages/recorder/test/ffmpeg.test.ts`, replace:

```ts
      expect(Date.now() - asked).toBeLessThan(2000);
      const seconds = duration(file);
      expect(seconds).toBeGreaterThan(1.3);
      expect(frames(file) / seconds).toBeGreaterThan(27);
      expect(frames(file) / seconds).toBeLessThan(33);
    }, 15_000);
```

with:

```ts
      expect(Date.now() - asked).toBeLessThan(2000);
      const seconds = duration(file);
      expect(seconds).toBeGreaterThan(1.3);
      // ten times what the feeder sends; beside a hundred other test files the clock's ticks come
      // late, and a late tick writes one frame (a full run measured 24.6 a second)
      expect(frames(file) / seconds).toBeGreaterThan(20);
      expect(frames(file) / seconds).toBeLessThan(33);
    }, 15_000);
```

In `packages/recorder/test/record.test.ts`, replace:

```ts
    const projectDir = project();
    const take = await record({ ...test, projectDir, source: { kind: 'window', title: 'Test Window' }, stop: { maxSeconds: 2 } }).done;
    expect(take.warnings).toEqual([]);
    // the test window's pattern changes 10 times a second; the take has a frame every 1/30 s
    const { stdout } = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', join(projectDir, take.screen)], { encoding: 'utf8' });
    expect(Number(stdout) / take.seconds).toBeGreaterThan(26);
  }, SLOW);

  it('refuses options it cannot record with, before creating a take folder', async () => {
```

with:

```ts
    const projectDir = project();
    const take = await record({ ...test, projectDir, source: { kind: 'window', title: 'Test Window' }, stop: { maxSeconds: 2 } }).done;
    expect(take.warnings).toEqual([]);
    // the test window's pattern changes 10 times a second; the take has a frame every 1/30 s (under
    // load fewer: a late tick of the clock writes one)
    const { stdout } = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', join(projectDir, take.screen)], { encoding: 'utf8' });
    expect(Number(stdout) / take.seconds).toBeGreaterThan(20);
  }, SLOW);

  it('refuses options it cannot record with, before creating a take folder', async () => {
```

Run: `pnpm exec vitest run --project node packages/recorder/test/ffmpeg.test.ts` and `pnpm exec vitest run --project realtime packages/recorder/test/record.test.ts -t "window"`
Expected: PASS.

```bash
git add packages/recorder/test
git commit -m "recorder tests: a window take's frame rate checked against 20 a second, which holds under load

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 989 passed and 81 skipped (here, with a speech model and ffmpeg's whisper filter; without them the real transcriptions are skipped too, and off Windows and macOS the OCR tests).

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

- [ ] **Step 4: By hand (the user)**

1. Record a take of a minute or two with the screen read after it (Settings, Privacy): "Reading the screen" ends sooner than before.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **The first full run failed one test:** the relay's from #58, at 24.6 frames a second against 27. The second run passed it. Its bound and the window take's are 20 now (Task 2, Step 2), and two more full runs passed whole.

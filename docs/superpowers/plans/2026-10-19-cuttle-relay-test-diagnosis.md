# Cuttle: The Relay Test Says Where It Stalls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The next time the relay test stalls on a runner, its failure says where and why.

The test is "writes 30 frames a second from 2 a second, and stops at once though no frame is coming". It hung on GitHub's Windows runner once, and its cause could not be found.

**Architecture:** Only the test changes (`packages/recorder/test/ffmpeg.test.ts`).
- It waits for each step of the relayed capture for at most a few seconds: the start at most 8 s, the stop at most 4 s.
- A step that stalls fails at once. The failure names the step, says whether ffmpeg and its feeder still run, and gives ffmpeg's last 20 lines. Then it ends both processes.
- Before, it said only "Test timed out in 15000ms".

**Tech Stack:** vitest, ffmpeg.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `relay-diagnosis`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- ffmpeg and ffprobe must be on PATH.

## What was looked into

**The failure**
- It came in PR #61's CI, run 39314736895, job 118273166360, on `windows-latest`. The test ran out of its 15 s, and its retry did too.
- The next two relay tests in the same file passed right after it: 1.85 s and 0.27 s.
- The test passed in every other run: both of PR #60's, PR #61's next one, and the diagnostic PR #62's.
- PR #61 does not touch the recorder beyond two exports.

**Trying to make it happen again**
- **Locally, under load:** 80 runs of the test's scenario, as 8 loops at once while busy loops kept all 16 cores full.
  - The start took at most 4.1 s, and the stop at most 0.25 s.
  - Each step was timed, through logs in `spawnCapture` (the feeder's first data, `started`, the stop asked, the feeder's and ffmpeg's exit and close).
- **Locally, as on a runner:** the node test suite three times on 4 cores (`start /affinity F`): 839 passed each time.
- **On the Windows runner:** 40 runs of the scenario in the draft PR #62, with the same logs. The start took at most 1.47 s, and the stop at most 25 ms.
  - The original test passed there too.
  - PR #62 was closed without merging.

**What the code allows**
- **The start:** a real take waits for it at most 20 s (`START_TIMEOUT_SECONDS`). The test waited 15 s.
- **The stop:**
  - `stop()` ends ffmpeg's input, kills the feeder, and kills ffmpeg if it has not ended after 10 s (`STOP_TIMEOUT_MS`).
  - A start of 2–3 s, the test's 1.5 s and that kill come to 13.5–15 s: about the test's whole time.
- **The suspect, not shown:** ffmpeg did not end after its input ended, with its feeder killed at the same moment. That is what differs from the next test, whose feeder had ended on its own before `stop()`.

**The other way the test failed, while this plan was checked**
- A full local `pnpm test` measured 18.8 relayed frames a second. The test asked for more than 20; #59 had lowered that from 30 for a run at 24.6.
- Here the cause is plain:
  - Beside a hundred other test files, the relay's ticks come late, and a late tick writes one frame.
  - The capture drops frames as it falls behind, as the relay's own comment says it should.
- What the bound shows is that the relay writes frames between the feeder's: far more than 2 a second. It now asks for more than 10, five times the feeder's rate, and keeps the upper bound of 33.

**No fix without a cause**
- Nothing in the recorder changes. The test now says which step stalled and in what state.
  - "ffmpeg still runs" at the stop would confirm the suspect.
  - "its feeder still runs" would point at the feeder's close.
- A test with a feeder that sends nothing (not committed) gave: "the start took over 2 s; ffmpeg still runs, its feeder still runs. ffmpeg's last lines: …".

---

### Task 1: The relay test's steps, each with its own limit, and the frame rate it asks for

**Files:**
- Modify: `packages/recorder/test/ffmpeg.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `relay-diagnosis`; work there:

```bash
git switch relay-diagnosis
```

- [ ] **Step 2: The steps with their limits**

In `packages/recorder/test/ffmpeg.test.ts`, replace:

```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ffmpegPath, spawnCapture, type Feeder } from '../src/ffmpeg';
import { relayInput } from '../src/window-capture';

afterEach(() => vi.unstubAllEnvs());
```

with:

```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ffmpegPath, spawnCapture, type CaptureProcess, type Feeder } from '../src/ffmpeg';
import { relayInput } from '../src/window-capture';

afterEach(() => vi.unstubAllEnvs());
```

In the same file, replace:

```ts
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
      // ten times what the feeder sends; beside a hundred other test files the clock's ticks come
      // late, and a late tick writes one frame (a full run measured 24.6 a second)
      expect(frames(file) / seconds).toBeGreaterThan(20);
      expect(frames(file) / seconds).toBeLessThan(33);
    }, 15_000);
```

with:

```ts
    const frames = (file: string) =>
      Number(spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout);
    const relayed = (file: string) => ['-use_wallclock_as_timestamps', '1', ...relayInput(size), ...out(file)];
    const running = (pid: number | undefined) => {
      if (pid === undefined) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    /**
     * Waits for one step of a relayed capture, at most `seconds`. Once it hung on GitHub's Windows
     * runner (the test's 15 s ran out, twice in a row) and never here: a step that stalls fails at
     * once, saying which one, whether ffmpeg and its feeder still run, and ffmpeg's last lines.
     */
    const step = async <T,>(what: string, promise: Promise<T>, capture: CaptureProcess, lines: readonly string[], seconds: number): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const state = `ffmpeg ${running(capture.pid) ? 'still runs' : 'has exited'}, its feeder ${running(capture.feederPid) ? 'still runs' : 'has exited'}`;
          for (const pid of [capture.pid, capture.feederPid]) if (running(pid)) process.kill(pid!);
          reject(new Error(`${what} took over ${seconds} s; ${state}. ffmpeg's last lines:\n${lines.slice(-20).join('\n')}`));
        }, seconds * 1000);
      });
      try {
        return await Promise.race([promise, stalled]);
      } finally {
        clearTimeout(timer);
      }
    };

    it('writes 30 frames a second from 2 a second, and stops at once though no frame is coming', async () => {
      const file = join(temp('cuttle-relay-'), 'out.mp4');
      const capture = spawnCapture('screen', relayed(file), feeder(2));
      const lines: string[] = [];
      capture.onLine((line) => lines.push(line));
      await step('the start', capture.started, capture, lines, 8);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const asked = Date.now();
      await step('the stop', capture.stop(), capture, lines, 4);
      expect(Date.now() - asked).toBeLessThan(2000);
      const seconds = duration(file);
      expect(seconds).toBeGreaterThan(1.3);
      // Far more than the feeder's 2 a second: the relay writes them. Beside a hundred other test
      // files the clock's ticks come late, and a late tick writes one frame (full runs measured 24.6
      // and 18.8 a second), so only that is asked: at least five times what the feeder sends.
      expect(frames(file) / seconds).toBeGreaterThan(10);
      expect(frames(file) / seconds).toBeLessThan(33);
    }, 15_000);
```

Run: `pnpm exec vitest run --project node packages/recorder/test/ffmpeg.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 3: Commit**

```bash
git add packages/recorder/test/ffmpeg.test.ts
git commit -m "recorder: the relay test says which step stalled and in what state, and asks for the relay at work, not 20 frames a second

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: All tests, the typecheck and the checks

- [ ] **Step 1: Run them**

Run: `pnpm test`
Expected: PASS, 998 passed, 81 skipped (116 files).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 16 tests.

Run: `pnpm app:check`
Expected: PASS, 58 tests.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype and replayed on a fresh clone for its commit; the tree came out byte-identical to the prototype.
- The checks ran on the replayed commit.

- On the prototype: `pnpm test` passed (998, 81 skipped) after the frame-rate bound; before it, a full run failed at 18.8 frames a second.

**What CI found on this PR, fixed in a commit after the plan's**
- **macOS: the script check's step 2 had no title again** (`app.check.test.ts`, "records with a script": titles `[Open the settings]` only). The branch already had #60's fix for a step after the last activity, which this failure turned out not to be.
- **Measured here, with the step times and the take's length logged:**
  - With the check's 0.6 s before the stop, step 2 came at 1.96 s and the take ended at 3.13 s. Its title got 1.17 s, only 0.37 s above the 0.8 s a title needs (`MIN_TITLE_SECONDS`).
  - Without the wait, step 2 came at 2.02 s and the take ended at 2.13 s. There was no title, and the check failed as on the runner.
  - The check's screen (the test pattern) moves all the time, so nothing is trimmed: the take simply ended too soon after the step.
- **#60's explanation of the first failure was a guess.** It added the case of a step reached after all activity, which is right for the product, but a moving screen never has that case. This failure is the check stopping too soon.
- **The check now waits 2 s before the stop.** When the title is missing, the check names the step times and the clips; the runner's log had said nothing about them.
- Checked: the script check three times in a row, then `app:check` (58).

# Cuttle Privacy 2: the Screen's Text Read Where It Only Flashes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A secret that shows only a moment is read, and masked.
- Until now the privacy step compared and read the screen two times a second. A token that showed for a fifth of a second between two of those frames was never read.
- Now the picture is compared ten times a second. A change that comes too soon after a read, and goes again before the next read is due, is read as well.
- While the screen keeps changing (typing, scrolling) it is still read two times a second.

**Architecture:** `framesToRead` (`@cuttle/core`, `privacy/read.ts`):
- It samples the take at `READ_RULES.detect` (10) frames a second instead of `rate` (2).
- A frame that changed since the last one read is read when half a second has passed since that read, as before. A change that came sooner waits.
- When the picture goes back to what was read before the next read is due, the change that waited is read too. So is one still waiting at the clip's end.

**Tech Stack:** TypeScript strict, ffmpeg.

The second of three PRs on gaps that questions under the launch post found. The first: `docs/superpowers/plans/2026-10-19-cuttle-privacy-1-edges-keys.md`. The third: random-looking strings, and the screen's text kept redacted.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `privacy-flashes`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The full `pnpm test` and the typecheck run in Task 3.

## Decisions made while planning

The gap was checked in the code first: `framesToRead` sampled at `fps=2` and compared only those samples, so what showed between two of them was never seen. The finished prototype passed `pnpm test` (970 tests, 80 skipped, in three full runs), the typecheck, `app:check` (58 tests) and `cli:check` (16). Every screenshot was looked at.

- **Ten comparisons a second:**
  - The samples are 320 px wide and grey, so ten a second cost little: ffmpeg decodes every frame either way.
  - What costs is the OCR, and it still reads at most two frames a second while the picture keeps changing.
- **A change that came too soon is read only when it goes before the next read is due** (the picture is back to what was read):
  - That is the token that flashed.
  - A change that is still there at the next read is read then, as before.
  - Reading every change that came too soon would double the OCR's work while someone types or scrolls: the picture never stands still there.
  - What is not covered: a change that shows less than half a second and is followed at once by another change, without the picture going back in between.
- **A change still waiting at a clip's end is read:** that part of the clip was not read otherwise.
- **The masks need nothing new:** a secret read once is masked from 0.5 s before to 0.5 s after (`MASK_RULES.margin`), and until the next frame read shows it gone.
- **Sped-up stretches need nothing either:** the screen is read in source seconds, so a clip at 12× is read as densely as one at 1×.
- **The full test runs had gone red on main:**
  - The editor's random edit sequences ran past their 5 s beside a hundred other test files.
  - The recorder's takes in real time came out short.
  - The random sequences get 30 s, and the recorder's takes (`record.test.ts`) run in a group of their own after the other tests (`sequence.groupOrder`), before the real transcriptions, which go last since the PR before.
  - A full run takes about two minutes now instead of one.

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/privacy/read.ts` | which frames are read |
| `vitest.config.ts`, `apps/desktop/test/document.test.ts` | the full runs stay green |
| `README.md` | the guide |

---

### Task 1: A change that showed only a moment is read

**Files:**
- Create: `packages/core/test/privacy-read.test.ts`
- Modify: `packages/core/src/privacy/read.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `privacy-flashes`; work there:

```bash
git switch privacy-flashes
```

- [ ] **Step 2: Write the failing tests**

Videos made with ffmpeg:
- **A flash:** a white screen, a box that appears at 1 s, and a token that flashes from 1.15 to 1.35 s.
- **Moving:** a picture that keeps moving.
- **Still:** one that stands still for 11 s.

`packages/core/test/privacy-read.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runFfmpeg } from '../src/ffmpeg';
import { READ_RULES, framesToRead } from '../src/privacy/read';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const size = { width: 640, height: 360 };

/** A screen video, 640×360 at 30 fps: white (or `source`), with dark boxes shown from `from` to `to` (seconds). */
async function screen(seconds: number, boxes: { from: number; to: number; x: number }[], source = 'color=c=white'): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-read-'));
  dirs.push(dir);
  const file = join(dir, 'screen.mp4');
  const draw = boxes.map((box) => `drawbox=x=${box.x}:y=150:w=200:h=40:color=black:t=fill:enable='between(t,${box.from},${box.to})'`).join(',');
  await runFfmpeg(['-f', 'lavfi', '-i', `${source}${source.includes('=') ? ':' : '='}s=640x360:r=30:d=${seconds}`, ...(draw ? ['-vf', draw] : []), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', file]);
  return file;
}

describe('framesToRead', () => {
  it('reads a change that showed only a moment, right after a read', async () => {
    // a box appears at 1 s (read), a token flashes from 1.15 to 1.35 s: too soon after that read,
    // and gone before the next one is due
    const file = await screen(3, [
      { from: 0.95, to: 3, x: 40 },
      { from: 1.15, to: 1.35, x: 360 },
    ]);
    expect(await framesToRead(file, [{ from: 0, to: 3 }], size)).toEqual([0, 1, 1.2]);
  });

  it('reads at most `rate` frames a second while the picture keeps changing, and one every `every` seconds of a still one', async () => {
    const moving = await screen(3, [], 'testsrc2');
    const times = await framesToRead(moving, [{ from: 0, to: 3 }], size);
    expect(times.slice(0, 3 * READ_RULES.rate)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    // and the change after the last read, before the clip ends
    expect(times.slice(3 * READ_RULES.rate)).toEqual([2.6]);
    const still = await screen(11, []);
    expect(await framesToRead(still, [{ from: 0, to: 11 }], size)).toEqual([0, 5, 10]);
  });

  it('reads each span from its first frame, in source seconds', async () => {
    const file = await screen(4, [{ from: 2.45, to: 4, x: 40 }]);
    expect(await framesToRead(file, [{ from: 0.5, to: 1.5 }, { from: 2, to: 4 }], size)).toEqual([0.5, 2, 2.5]);
  });
});
```

Run: `pnpm exec vitest run --project node packages/core/test/privacy-read.test.ts`
Expected: FAIL: the flash test reads `[0, 1]`: the token is missed.

- [ ] **Step 3: Ten comparisons a second, and the change that waited**

In `packages/core/src/privacy/read.ts`, replace:

```ts
// Reading the screen's text for the privacy masks: the frames where the picture changed inside the
// clips (at most 2 a second, at least one every 5 s), each read with the system's OCR (ocr.ts), written as the
// take's screen-text.jsonl. Only the frames that are read are written to a temporary folder, one at
// a time, and removed once read.
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

with:

```ts
// Reading the screen's text for the privacy masks: the frames where the picture changed inside the
// clips (compared 10 times a second; read at most 2 a second while it keeps changing, at least one
// every 5 s, and once more where a change showed only a moment), each read with the system's OCR
// (ocr.ts), written as the take's screen-text.jsonl. Only the frames that are read are written to a
// temporary folder, one at a time, and removed once read.
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

In the same file, replace:

```ts
import { ScreenReader } from './ocr';

export const READ_RULES = {
  /** At most this many frames a second are read… */
  rate: 2,
  /** …and at least one every this many seconds while the clips run. */
  every: 5,
```

with:

```ts
import { ScreenReader } from './ocr';

export const READ_RULES = {
  /** The picture is compared this many times a second, so a change that shows only a moment is seen… */
  detect: 10,
  /** …at most this many frames a second are read while it keeps changing (typing, scrolling)… */
  rate: 2,
  /** …and at least one every this many seconds while the clips run. */
  every: 5,
```

In the same file, replace:

```ts
export const SCREEN_TEXT_FILE = 'screen-text.jsonl';

/**
 * The source seconds to read inside `spans`: each span's first frame, then every frame (at `rate`
 * a second) that changed since the last one kept, and one at least every `every` seconds.
 */
export async function framesToRead(screen: string, spans: readonly Span[], size: { width: number; height: number }, rules = READ_RULES): Promise<number[]> {
  const width = rules.width;
```

with:

```ts
export const SCREEN_TEXT_FILE = 'screen-text.jsonl';

/**
 * The source seconds to read inside `spans`: each span's first frame; a frame that changed since the
 * last one read, `rate` a second at most; one at least every `every` seconds. A change that came
 * too soon after a read and went before the next read was due (a token that flashed) is read as
 * well. The frames are compared `detect` times a second.
 */
export async function framesToRead(screen: string, spans: readonly Span[], size: { width: number; height: number }, rules = READ_RULES): Promise<number[]> {
  const width = rules.width;
```

In the same file, replace:

```ts
  const times: number[] = [];
  for (const span of spans) {
    if (!(span.to > span.from)) continue;
    let kept: { t: number; data: Buffer } | undefined;
    let pending: Buffer = Buffer.alloc(0);
    let index = 0;
    await runFfmpeg(['-ss', span.from.toFixed(3), '-t', (span.to - span.from).toFixed(3), '-i', screen, '-map', '0:v:0', '-vf', `fps=${rules.rate},scale=${width}:${height},format=gray`, '-f', 'rawvideo', '-'], (chunk) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length >= area) {
        const data = pending.subarray(0, area);
        pending = pending.subarray(area);
        const t = Math.round((span.from + index++ / rules.rate) * 1000) / 1000;
        if (t >= span.to) continue;
        let changed = rules.minPixels;
        if (kept && t - kept.t < rules.every) {
          changed = 0;
          for (let i = 0; i < area && changed < rules.minPixels; i++) if (Math.abs(data[i]! - kept.data[i]!) > rules.threshold) changed++;
        }
        if (changed < rules.minPixels) continue;
        kept = { t, data };
        times.push(t);
      }
    });
  }
  return times;
}
```

with:

```ts
  const times: number[] = [];
  for (const span of spans) {
    if (!(span.to > span.from)) continue;
    /** The last frame read, and the first change since then that came too soon to be read. */
    let kept: { t: number; data: Buffer } | undefined;
    let waiting: number | undefined;
    const read = (t: number, data: Buffer) => {
      kept = { t, data };
      times.push(t);
    };
    let pending: Buffer = Buffer.alloc(0);
    let index = 0;
    await runFfmpeg(['-ss', span.from.toFixed(3), '-t', (span.to - span.from).toFixed(3), '-i', screen, '-map', '0:v:0', '-vf', `fps=${rules.detect},scale=${width}:${height},format=gray`, '-f', 'rawvideo', '-'], (chunk) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length >= area) {
        const data = pending.subarray(0, area);
        pending = pending.subarray(area);
        const t = Math.round((span.from + index++ / rules.detect) * 1000) / 1000;
        if (t >= span.to) continue;
        if (!kept || t - kept.t >= rules.every) {
          read(t, data);
          continue;
        }
        let changed = 0;
        for (let i = 0; i < area && changed < rules.minPixels; i++) if (Math.abs(data[i]! - kept.data[i]!) > rules.threshold) changed++;
        if (changed >= rules.minPixels && t - kept.t >= 1 / rules.rate) {
          waiting = undefined;
          read(t, data);
        } else if (changed >= rules.minPixels) waiting ??= t;
        else if (waiting !== undefined) {
          // back to what was read before the next read was due: the change showed only a moment
          times.push(waiting);
          waiting = undefined;
        }
      }
    });
    if (waiting !== undefined) times.push(waiting);
  }
  return times;
}
```

Run: `pnpm exec vitest run --project node packages/core/test/privacy-read.test.ts packages/core/test/privacy-apply.test.ts packages/core/test/privacy-ocr.test.ts packages/core/test/suggest.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core
git commit -m "privacy: the screen's text read where a change showed only a moment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Full test runs that stay green

**Files:**
- Modify: `vitest.config.ts`, `apps/desktop/test/document.test.ts`

- [ ] **Step 1: The recorder's takes after the other tests, the random sequences with time enough**

In `vitest.config.ts`, replace:

```ts
import { defineConfig } from 'vitest/config';
import { matchGolden } from './tools/vitest/golden-command.ts';

/**
 * Tests that transcribe with a real speech model (where one is downloaded): they keep the GPU and
 * the processor busy for many seconds, and beside them the recorder's takes in real time come out
```

with:

```ts
import { defineConfig } from 'vitest/config';
import { matchGolden } from './tools/vitest/golden-command.ts';

/**
 * The recorder's takes in real time (the test backend): beside a hundred other test files their
 * input and their timing come out short, so they run after them.
 */
const REALTIME = ['packages/recorder/test/record.test.ts'];
/**
 * Tests that transcribe with a real speech model (where one is downloaded): they keep the GPU and
 * the processor busy for many seconds, and beside them the recorder's takes in real time come out
```

In the same file, replace:

```ts
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'skill/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.browser.test.ts', ...HEAVY],
          env: NODE_ENV,
        },
      },
      {
```

with:

```ts
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'skill/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.browser.test.ts', ...REALTIME, ...HEAVY],
          env: NODE_ENV,
        },
      },
      {
        test: {
          name: 'realtime',
          environment: 'node',
          include: REALTIME,
          env: NODE_ENV,
          sequence: { groupOrder: 1 },
        },
      },
      {
```

In the same file, replace:

```ts
          include: HEAVY,
          env: NODE_ENV,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
      {
```

with:

```ts
          include: HEAVY,
          env: NODE_ENV,
          fileParallelism: false,
          sequence: { groupOrder: 2 },
        },
      },
      {
```

In `apps/desktop/test/document.test.ts`, replace:

```ts
    }
    // the sequences do edit (not only refusals)
    expect(applied).toBeGreaterThan(1500);
  });
});

describe('automatic items in the document', () => {
```

with:

```ts
    }
    // the sequences do edit (not only refusals)
    expect(applied).toBeGreaterThan(1500);
    // 150 sequences take seconds; beside the other test files more than the default 5
  }, 30_000);
});

describe('automatic items in the document', () => {
```

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 2: Commit**

```bash
git add vitest.config.ts apps/desktop/test/document.test.ts
git commit -m "tests: the recorder's takes in real time after the other tests, the random edits with 30 s

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The guide, and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: The README**

In `README.md`, replace:

```markdown

Cuttle works on your computer. Recording, cutting, the screen's text (Windows' own OCR or macOS's
Vision), transcription (Whisper models, downloaded once) and the export all run locally; nothing is
uploaded. Masks over private things are suggestions to check, not a guarantee: look at the stills
before you share a video (`cuttle preview --masks` shows each mask's edges).

The masks are drawn only into what Cuttle renders (the export, previews). The project folder keeps
the take as it was recorded (`takes/`, with the text the screen showed) and the editor's copies of it
```

with:

```markdown

Cuttle works on your computer. Recording, cutting, the screen's text (Windows' own OCR or macOS's
Vision), transcription (Whisper models, downloaded once) and the export all run locally; nothing is
uploaded. The screen is compared ten times a second, and its text is read where it changed (twice
a second at most while it keeps changing), also where something showed only a moment. Masks over
private things are suggestions to check, not a guarantee: look at the stills before you share a
video (`cuttle preview --masks` shows each mask's edges).

The masks are drawn only into what Cuttle renders (the export, previews). The project folder keeps
the take as it was recorded (`takes/`, with the text the screen showed) and the editor's copies of it
```

```bash
git add README.md
git commit -m "docs: the screen's text read where something showed only a moment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 970 passed and 80 skipped (here, with a speech model and ffmpeg's whisper filter; without them the real transcriptions are skipped too, and off Windows and macOS the OCR tests).

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

1. Record a take in which a token shows for a moment (paste it and delete it at once), let Cuttle cut it, and look at the Auto tab: the token is masked.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **Reading every change that came too soon** (also when the next read showed something else), the first version, read four frames a second of a moving picture. It reads a change that waited only when the picture went back now.
- **The two full runs before Task 2 failed** 4 and 1 tests, each one that records in real time or has a 5 s limit. After Task 2, three full runs in a row passed whole.

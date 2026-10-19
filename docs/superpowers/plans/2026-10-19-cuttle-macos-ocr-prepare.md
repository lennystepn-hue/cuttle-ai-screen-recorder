# Cuttle: macOS Prepares Vision Before It Reads the Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On macOS, reading the screen after a take works the first time, too.

In the installed Cuttle 0.1.1 (signed, notarized), reading the screen stayed at 0 % and then said "Cuttle could not read the screen: the OCR helper did not answer within 60 s (reading …/0.png)". The helper had said it was ready, then took longer than 60 s for its first picture.

**Architecture:**
- **The helper prepares Vision first.** `cuttle-capture ocr` (`packages/recorder/native/macos/capture.swift`) first says `{"preparing": true}`. Then it reads a line of text of its own (320 × 64, drawn with CoreText), and only then says it is ready. On a first use, that one picture is where macOS compiles Vision's networks.
- **Preparing has its own limit.** `ScreenReader.start` (`packages/core/src/privacy/ocr.ts`) gives the preparation `OCR_TIMEOUT.prepare` (300 s). A picture still has 60 s, and the start still has 60 s.
- **One helper prepares alone.** On macOS (`ScreenReader.prepares`), `readFrames` (`packages/core/src/privacy/read.ts`) starts one helper, and the others only once it is ready. The others then find the networks compiled. If the first cannot start, the others are not tried.
- **Windows does not change:** its helper says no `preparing`, and its helpers start together, as #59 measured.

**Tech Stack:** Swift (Vision, CoreText), TypeScript strict, vitest.

Conventions for every task:

- Run all commands from the repo root `/Users/lennyenderle/Desktop/Cuttle`, on the branch `macos-ocr-hang`, in zsh.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- ffmpeg must be on PATH. The measurements print only times and byte counts, never what was read.
- Don't touch `packages/core/src/use-take.ts`: a parallel PR changes it.

## What was measured

The machine is a MacBook Air M1 (MacBookAir10,1, 8 logical processors) on macOS 27.0.1. The picture is a 2880 × 1800 screenshot. "First" is the helper's first picture after it said it was ready.

| Helper | First picture | Then |
|---|---|---|
| Installed 0.1.1 (signed, hardened runtime), one, first run here | 34.0 s | 0.21 s |
| Installed, one, again | 0.36 s | 0.20 s |
| Installed, three at once | 0.48 s each | 0.28 s each |
| Dev build (ad hoc signed), one, its first run | **66.5 s** | 0.20 s |
| Dev build, one, again | 0.37 s | 0.20 s |
| Dev build, three at once | 0.45 s each | 0.26 s each |

**Signing makes no difference.** Unsigned is as slow as signed the first time, and as fast as signed after it.

**Where the time goes.** `log show` for `cuttle-capture`, `aned` and `ANECompilerService`:
- In the first request, the helper waits on Vision's text recognition. `aned` hands its networks to `ANECompilerService`, which compiles them for the Neural Engine: a small one (about 2 s) and two large ones (26 to 30 s each).
- The helper's own CPU is idle meanwhile (3.7 s of CPU over 34 s).
- `ANECompilerService` compiles **one network at a time** for all processes.

**The app's failed run** (23:15, two helpers: `helpersFor` gives two on 8 processors). Both helpers asked for the same large network:
- It was compiled twice, one after the other (23:15:22–49 and 23:15:49–23:16:15).
- The second large network started at 23:16:16. Both helpers were ended at 23:16:18, 60 s after their first picture, and that compile was lost.
- The next run of the installed helper (34 s) compiled only that second network. What was compiled before had been kept.

**What compiled networks are kept for.** A copy of the dev helper, a new build of it with a new LC_UUID, and the same helper again were all fast. A new signing identity (`codesign -s - -i <new>`) was always slow the first time, and so was the dev helper rebuilt from changed source (68 s in the first test run of this branch). Whatever the key, a newly installed or built helper can pay the minute once.

**One helper alone is too slow, too.** Under identities never used before:

| What | First picture |
|---|---|
| One helper, Vision's default devices | 60–66 s |
| `setComputeDevice(.gpu / .cpu, for: .main)` | 61.2 s (it still maps Neural Engine programs) |
| `usesCPUOnly = true` | 62.1 s |
| A 320 × 64 line of text first, then the screenshot | 60.0 s, then **0.25 s** |
| Two helpers at once, each with the small line first | **86.7 s and 113.1 s** |

What these show:
- **The compile cannot be avoided:** Vision's text recognition uses the Neural Engine whatever device is asked for. It is the same whether the helper is signed or not.
- **A small picture compiles everything:** after it, the full screenshot reads in 0.25 s.
- **Helpers at once wait for each other:** each waits for the others' compiles.

**Why CI passed.** GitHub's macOS runners are virtual machines, which have no Neural Engine as far as can be seen. Vision runs there without this compile.

**Not the cause:** the hardened runtime and its entitlements (`entitlements.mac.plist`), the path in `app.asar.unpacked`, and three helpers once compiled (0.28 s a picture).

## Decisions

- **Fix the cause:** prepare Vision, as one step, before the helper says it is ready. Raising the 60 s a picture would only have hidden it:
  - The helper is ended in the middle of compiling, which loses that network.
  - With three helpers, each waits for the others' compiles, so the wait grows.
- **300 s for preparing** is five times the minute measured on the slowest Apple silicon Mac here. A picture still has 60 s: a helper that hangs while reading is ended as before.
- **One helper prepares, the others start after it:**
  - With the networks compiled, three helpers still read more than twice as fast as one (0.28 s against 0.20 s a picture, three at once). So `helpersFor` stays.
  - Starting one after the other costs about 0.4 s once they are compiled (preparing then takes 0.35 s).
  - On Windows nothing waits: PowerShell's helpers start together, as #59 measured.
- **The real OCR tests** (`privacy-ocr.test.ts`, the CLI's "reads the screen") get `OCR_TIMEOUT.prepare` besides their own time. Their first run after a new build of the helper prepares for a minute.
- **Not done here:**
  - A status text for the preparation in the app: it shows "Reading the screen… 0 %" for that minute.
  - The installed helper's minimum macOS: it is `minos 26.0` (built with the release machine's SDK default), while the app says 13.0.

## File structure

| File | Responsibility |
|---|---|
| `packages/recorder/native/macos/capture.swift` | `cuttle-capture ocr` says it prepares, reads a line of its own, then says it is ready |
| `packages/core/src/privacy/ocr.ts` | `OCR_TIMEOUT.prepare`, `ScreenReader.prepares`, `start(timeout)` |
| `packages/core/src/privacy/read.ts` | the first helper alone where helpers prepare |
| `packages/core/src/index.ts` | exports `OCR_TIMEOUT` (the CLI's test) |
| `packages/core/test/privacy-ocr.test.ts`, `apps/cli/test/cli.test.ts` | a helper that prepares; the real tests' time |

---

### Task 1: The helper prepares Vision, the reader waits for it, one helper prepares alone

**Files:**
- Modify: `packages/recorder/native/macos/capture.swift`, `packages/core/src/privacy/ocr.ts`, `packages/core/src/privacy/read.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/privacy-ocr.test.ts`, `apps/cli/test/cli.test.ts`

- [ ] **Step 1: The branch**

```bash
git switch macos-ocr-hang
```

- [ ] **Step 2: Write the failing tests**

In `packages/core/test/privacy-ocr.test.ts`, add a stand-in for macOS's helper. It is a Node script written into a temporary folder and chosen with `CUTTLE_CAPTURE_HELPER`:
- It says `{"preparing":true}`, waits `ms` (-1: for good), says it is ready, and reads every picture as empty.
- It notes `<pid> started|ready <ms>` in a log.

Add a `describe.runIf(process.platform === 'darwin')` with three tests:
- **Preparing has its own time:** a helper that prepares for 0.5 s starts with `{ start: 10, prepare: 10, read: 0.25 }` and reads its first picture. A helper that never gets ready fails with `{ start: 10, prepare: 0.25, read: 10 }`, as `ocr-missing` "the OCR helper did not answer within 0.25 s (preparing macOS's text recognition)".
- **One helper alone:** `readFrames(…, { helpers: 3 })` on a white 64 × 36 video, at 0, 0.5, 1 and 1.5 s. The frames come back in order, and the two other helpers started no earlier than the first was ready.
- **What cuttle-capture does:** the real helper's first line is `{"preparing":true}`, and its second has `ready: true`.

Run: `pnpm exec vitest run --project node packages/core/test/privacy-ocr.test.ts`
Expected: all three fail.
- The first two because the reader takes `{"preparing":true}` for its hello, which is not ready.
- The third because the helper's first line is the hello.

- [ ] **Step 3: The helper** (`capture.swift`)

- `textRequest(languages)`: the request the pictures were read with (`.accurate`, no language correction, `minimumTextHeight = 0`), now in one place.
- `sampleLine()`: "Cuttle 0123" in Helvetica 28, black on white, 320 × 64, through CoreText (`import CoreText`).
- `readText()`:
  - It says `{"preparing": true}` first.
  - After the languages, it reads `sampleLine()` with `textRequest(languages)`. A failure is not said: each picture asked for says it.
  - Then it says it is ready, as before.
- The file's header says the two first lines.

- [ ] **Step 4: The reader** (`ocr.ts`)

```ts
export const OCR_TIMEOUT = { start: 60, prepare: 300, read: 60 };
```

`ScreenReader`:
- `static readonly prepares = process.platform === 'darwin'`.
- `start(timeout = OCR_TIMEOUT)` reads the first line within `timeout.start`. Is it `preparing`? Then it reads the next within `timeout.prepare` ("preparing macOS's text recognition"), then checks `ready` as before.
- The reader keeps `timeout.read` for its pictures.

- [ ] **Step 5: The first helper alone** (`read.ts`)

```ts
const count = options.helpers ?? helpersFor(times.length);
const start = (helpers: number) => Promise.allSettled(Array.from({ length: helpers }, () => ScreenReader.start()));
const first = ScreenReader.prepares ? await start(1) : [];
// where the first could not start, the others would not either: they would only wait as long again
const started = first[0]?.status === 'rejected' ? first : [...first, ...(await start(count - first.length))];
```

- [ ] **Step 6: The real tests' time**

- `privacy-ocr.test.ts`'s two system OCR tests take `60_000 + OCR_TIMEOUT.prepare * 1000` and `120_000 + OCR_TIMEOUT.prepare * 1000`.
- The CLI's "cuttle suggest reads the screen" takes `120_000 + OCR_TIMEOUT.prepare * 1000`, with `OCR_TIMEOUT` exported from `@cuttle/core`.

- [ ] **Step 7: Run the tests, then commit**

```bash
pnpm exec vitest run --project node packages/core/test/privacy-ocr.test.ts packages/core/test/privacy-read.test.ts
git add packages/recorder/native/macos/capture.swift packages/core/src/privacy/ocr.ts packages/core/src/privacy/read.ts packages/core/src/index.ts packages/core/test/privacy-ocr.test.ts apps/cli/test/cli.test.ts
git commit -m "macOS: the OCR helper prepares Vision before it reads, one helper at a time"
```

### Task 2: The checks

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] On the Mac: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts -t "reads the screen"`
- [ ] Measure the new helper under a new identity (`codesign -s - -i <new>` on a copy). It should say `preparing` at once and be ready after about a minute, then read its first picture in well under a second. Run it again: ready in under a second.
- [ ] The PR says what CI cannot cover. Its macOS runner has no Neural Engine as far as can be seen, so it never compiles. The signed app was not rebuilt here: the release workflow builds it.

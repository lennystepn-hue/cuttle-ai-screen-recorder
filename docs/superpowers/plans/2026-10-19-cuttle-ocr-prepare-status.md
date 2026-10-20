# Cuttle: Reading the Screen Says When It Prepares Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While macOS prepares Vision's text recognition, the app and the CLI say so, so it no longer looks stuck at 0 %.

Since #66, macOS's OCR helper prepares Vision before it says it is ready. Where macOS compiles Vision's text recognition, that takes a minute on an M1, otherwise a fraction of a second. It compiles on a helper's first use, and again once another program had the networks compiled for itself (#66's plan: macOS kept them for one signing identity at a time). Until now, the editor showed "Reading the screen… 0 %" for that whole time, and the CLI showed "reading the screen …".

**Architecture:**
- **The reader says it.** `ScreenReader.start` (`packages/core/src/privacy/ocr.ts`) takes options `{ timeout, onPreparing, notice }`.
  - When the helper still prepares after `PREPARING_NOTICE` seconds (2), it calls `onPreparing` once.
  - A warm start (0.25–0.35 s) never calls it, so the status does not flash.
- **It is passed along.** `readFrames` and `readScreenTake` take `onPreparing` and hand it to every start.
- **The CLI.** `suggest` says "reading the screen … preparing macOS's text recognition (about a minute)".
- **The app.**
  - The media worker answers `{ id, progress: 0, preparing: true }` (`WorkerReply`), and `mediaWorker.run`'s `onProgress` gets `preparing` as its second argument.
  - The editor's status chip then says "Reading the screen… preparing (a minute)": short enough for the chip's 260 px. The longer "… preparing (this can take a minute)" needed 314 px and was cut off after "this can ta…". The first frame read sets "Reading the screen… N %" again.
- **Windows does not change:** its helper never says it prepares.

**Tech Stack:** TypeScript strict, vitest, Electron utility process.

Conventions for every task:

- Run all commands from the repo root `/Users/lennyenderle/Desktop/Cuttle`, on the branch `ocr-prepare-status` (made from `macos-ocr-hang`, #66), in zsh.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Don't touch `packages/core/src/use-take.ts`: a parallel PR changes it.

## Decisions

- **2 s before it is said.**
  - Prepared before, the helper is ready in 0.25–0.35 s (#66's measurements). A notice then would only flash.
  - Compiling takes a minute or more, so 2 s of "0 %" before the notice does not matter.
- **Once per start.** The notice is said once per helper start.
  - On macOS the first helper prepares alone. The others start once it is ready and find Vision prepared, so in practice it is said once per reading.
  - A second notice would only set the same text again.
- **"(a minute)", not "the first time".**
  - The first draft said "the first time". Then it was measured that another signing identity's compile pushes a helper's compiled networks out (#66's plan).
  - "(this can take a minute)" needed 314 px of the chip's 260 and was cut off. "(a minute)" takes 239 px.
  - A minute is what an M1 measured awake (#66's plan). Times taken while the Mac slept do not count. From about 00:15 the MacBook, on battery, only woke for seconds at a time (`pmset -g log`), which stretched one network's compile to 79 s and stopped later runs of the app check.
- **Where it is decided.** The core decides when to say it, so the CLI and the app need no timers of their own. The words differ: the app's chip is short and starts like its other texts ("Reading the screen…"), while the CLI writes its whole line.
- **The worker.** The flag rides on the progress reply instead of a new reply kind, since only read-screen uses it. Other jobs never set it.
- **The stand-in helper** of `privacy-ocr.test.ts` now acts like Vision's compiled networks:
  - It prepares for `ms` until one of its runs in the same folder was ready (a marker file), then at once.
  - That is how the first helper prepares and the others find it prepared.
- **Not checked by the app check:** there, Vision is prepared before (a fraction of a second), so the chip shows no notice. The app's part was checked once, not committed:
  - The app check's privacy test ran with `CUTTLE_CAPTURE_HELPER` set to a copy of `cuttle-capture` signed under a new identity, so it prepared for real.
  - A few lines added before the new take's `projectWhen` read the chip.
  - It went "Cutting the take…" → "Reading the screen… 0 %" → "Reading the screen… preparing (…)", and the text was measured against the chip's width.
  - Before that, while the Mac was awake, a wrapper that held back the real helper's "ready" for 8 s showed the same sequence: "Reading the screen… 0 %" → "Reading the screen… preparing (…)" → done.

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/privacy/ocr.ts` | `PREPARING_NOTICE`, `ScreenReader.start({ timeout, onPreparing, notice })` |
| `packages/core/src/privacy/read.ts`, `packages/core/src/privacy/apply.ts` | `onPreparing` passed to the starts |
| `packages/core/src/suggest.ts` | the CLI's status line |
| `apps/desktop/src/shared/media-jobs.ts`, `apps/desktop/src/workers/media.ts`, `apps/desktop/src/main/media-service.ts` | the worker's `preparing` |
| `apps/desktop/src/main/privacy.ts` | the editor's status chip |
| `packages/core/test/privacy-ocr.test.ts` | the notice, once, and only when it takes long |

---

### Task 1: The reader says when the helper takes long to prepare

**Files:**
- Modify: `packages/core/src/privacy/ocr.ts`, `packages/core/src/privacy/read.ts`, `packages/core/src/privacy/apply.ts`, `packages/core/src/suggest.ts`
- Test: `packages/core/test/privacy-ocr.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/privacy-ocr.test.ts`, change the stand-in helper: it prepares for `ms` only until a run of it in the same folder was ready (it writes `prepared` there). Then:
- **The notice:** `ScreenReader.start({ notice: 0.1, onPreparing })` with a helper that prepares for 0.5 s calls `onPreparing` once. A second start in the same folder (now prepared) does not call it.
- **Passed along:** `readFrames(…, { helpers: 3, onPreparing })` with a helper that prepares for 2.3 s calls it once.
- **Updated:** the test from #66 calls `ScreenReader.start({ timeout: { … } })`.

Run: `pnpm exec vitest run --project node packages/core/test/privacy-ocr.test.ts`
Expected: the notice tests fail, since `start` takes no options yet.

- [ ] **Step 2: The reader**

```ts
/** Seconds a helper may prepare before it is said to (`onPreparing`): prepared before, it takes a fraction of one. */
export const PREPARING_NOTICE = 2;
```

`ScreenReader.start(options: { timeout?, onPreparing?, notice? } = {})`:
- On `preparing`, it sets a timer for `notice` seconds that calls `onPreparing`.
- It clears the timer once the next line came, or the start failed.

- [ ] **Step 3: Passed along, and the CLI's line**

- `readFrames`' and `readScreenTake`'s options take `onPreparing` and pass it to `ScreenReader.start`.
- In `suggest.ts`, `onPreparing: () => args.onStatus?.("reading the screen … preparing macOS's text recognition (about a minute)")`.

- [ ] **Step 4: Run the tests, then commit**

### Task 2: The app's status chip

**Files:**
- Modify: `apps/desktop/src/shared/media-jobs.ts`, `apps/desktop/src/workers/media.ts`, `apps/desktop/src/main/media-service.ts`, `apps/desktop/src/main/privacy.ts`

- [ ] **Step 1: The worker**
  - `WorkerReply`'s progress gets `preparing?: boolean`.
  - The read-screen job passes `onPreparing: () => reply({ id, progress: 0, preparing: true })`.
  - `Worker.run`'s `onProgress` is `(progress, preparing?) => void`.
- [ ] **Step 2: The chip:** `status(progress, preparing)` in `privacy.ts` says "Reading the screen… preparing (a minute)" while it prepares.
- [ ] **Step 3: Commit**

### Task 3: The checks

- [ ] `pnpm typecheck`, `pnpm test`.
- [ ] On the Mac: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts -t "reads the screen"` and `pnpm app:check`.
- [ ] Once, not committed: the app check's privacy test with `CUTTLE_CAPTURE_HELPER` set to a copy of `cuttle-capture` signed under a new identity (`codesign -s - -i <new>`), and a look at the new take's chip (see the decisions).

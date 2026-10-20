# Cuttle 0.1.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuttle 0.1.2 can be released: the version is raised and its notes say what is new since 0.1.1.

What went into main after 0.1.1:
- #65: a take recorded with a camera shows the webcam bubble.
- #67: auto cuts that never cut into a word, sentences begun again cut out, subtitles that match.
- #69: the macOS capture helper is built for macOS 13, as the app is.
- #66 and #68: on macOS, reading the screen waits while macOS prepares its text recognition, and says so.

**Architecture:** As the README's "Releases" says:
- `apps/desktop/package.json`'s version and the CLI's `VERSION` go to 0.1.2. A test keeps them alike.
- `docs/releases/0.1.2.md` holds the notes. The Release workflow makes the draft release from it.

**Tech Stack:** Markdown, the Release workflow (GitHub Actions).

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `release-0.1.2`, in Git Bash.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions made while planning

- **0.1.2, a patch:** fixes and better auto cuts, nothing that changes how a project is written. The user asked for a new version after these merges.
- **The notes** follow 0.1.1's: the same download part with the new file names, one line on the update from 0.1.1, then what is new, in the person's words.
- **Nothing else names the version:** the updates test's `0.1.1` and `0.1.2` are a fake updater's versions, not the app's.
- Checked on the prototype: the updates and CLI tests (41) after raising the version, `pnpm test` (1017 passed, 87 skipped) and `pnpm typecheck`.

---

### Task 1: The version and its notes

**Files:**
- Create: `docs/releases/0.1.2.md`
- Modify: `apps/desktop/package.json`, `apps/cli/src/main.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `release-0.1.2`; work there:

```bash
git switch release-0.1.2
```

- [ ] **Step 2: The version**

In `apps/desktop/package.json`, replace:

```json
{
  "name": "@cuttle/desktop",
  "version": "0.1.1",
  "private": true,
  "type": "module",
  "description": "Cuttle: screen recordings that edit themselves",
```

with:

```json
{
  "name": "@cuttle/desktop",
  "version": "0.1.2",
  "private": true,
  "type": "module",
  "description": "Cuttle: screen recordings that edit themselves",
```

In `apps/cli/src/main.ts`, replace:

```ts
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';

export const VERSION = '0.1.1';

const seconds = (value: string): number => {
  const parsed = Number(value);
```

with:

```ts
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';

export const VERSION = '0.1.2';

const seconds = (value: string): number => {
  const parsed = Number(value);
```

Run: `pnpm exec vitest run --project node apps/desktop/test/updates.test.ts apps/cli/test/cli.test.ts`
Expected: PASS.

- [ ] **Step 3: The notes**

`docs/releases/0.1.2.md`:

```markdown
Auto cuts that never cut into a word, subtitles that match them, and fixes for the Mac. Cuttle records your screen, or Claude Code at work, and edits the take itself: it cuts the waiting, zooms on what matters, masks your secrets and frames it into a demo you can post. Everything runs on your computer.

## Download

- **Windows:** `Cuttle-0.1.2-win-x64.exe`. It installs for you alone, without admin rights, with Start menu and desktop shortcuts. It is not code-signed yet, so SmartScreen may not know it: choose *More info*, then *Run anyway*.
- **macOS (Apple silicon):** `Cuttle-0.1.2-mac-arm64.dmg`. Open it and drag Cuttle into Applications. The first recording asks for the screen, the microphone, input monitoring and accessibility.

Cuttle also needs ffmpeg: `winget install Gyan.FFmpeg` on Windows, `brew install ffmpeg` on a Mac. Its first start says what is missing.

Cuttle 0.1.1 updates itself to this version within a day, or at once with *Restart and update* (Settings, General).

## New in this version

- **Auto cuts that never cut into a word:**
  - A sentence you break off and begin again after a pause is cut out, like a slip marked with the mistake key or a spoken "nochmal". It shows as "Restart" among the retakes.
  - Every cut of a slip, a filler word or a pause begins and ends where the mic is quiet. The word times from speech recognition are estimates, often a tenth of a second off. Cuttle now checks each cut's edges against the mic and moves an edge that lies in a word up to 0.4 s into the quiet, keeping a short pause next to the words that stay.
  - A cut with no quiet near it is left out rather than chopping a word.
  - The words of the transcript are placed more exactly, so the subtitles match what the video says after the cuts.
- **The webcam shows:** a take recorded with a camera now shows the webcam bubble in the video. Before, the camera was recorded but its bubble stayed off.
- **macOS:**
  - Reading the screen no longer stops at 0 %. The first time, and again after macOS rebuilt it, macOS prepares its text recognition for about a minute. Cuttle now waits for it, and the editor and `cuttle suggest` say "preparing (a minute)".
  - The capture helper is built for macOS 13 and later, as the app is. With 0.1.1, screen takes and reading the screen most likely failed on macOS 13 to 15.
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/package.json apps/cli/src/main.ts docs/releases/0.1.2.md
git commit -m "Cuttle 0.1.2: the version and its notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: All tests and the typecheck

- [ ] **Step 1: Run them**

Run: `pnpm test`
Expected: PASS, 1017 passed, 87 skipped.

Run: `pnpm typecheck`
Expected: exits with code 0.

## After the merge

Run the Release workflow (Actions > Release > Run workflow, or `gh workflow run release.yml --ref main`). Look at the draft release `v0.1.2`: the notes, `Cuttle-0.1.2-win-x64.exe`, `Cuttle-0.1.2-mac-arm64.dmg`, the zip, `latest.yml` and `latest-mac.yml`. Then publish it.

## Changes during execution

- It was written from the finished prototype and replayed on a fresh clone for its commit; the tree came out byte-identical to the prototype.

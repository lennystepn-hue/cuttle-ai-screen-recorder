# Cuttle 0.1.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuttle 0.1.3 can be released: the version is raised and its notes say what is new since 0.1.2.

What went into main after 0.1.2:
- #72: privacy masks that stay on text that scrolls, each private thing followed in every frame of the take.
- #73: email addresses found as Windows' OCR reads them in a code editor's font.

**Architecture:** As the README's "Releases" says:
- `apps/desktop/package.json`'s version and the CLI's `VERSION` go to 0.1.3. A test keeps them alike.
- `docs/releases/0.1.3.md` holds the notes. The Release workflow makes the draft release from it.

**Tech Stack:** Markdown, the Release workflow (GitHub Actions).

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `release-0.1.3`, in Git Bash.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions made while planning

- **0.1.3, a patch:** fixes to the privacy masks, nothing that changes how a project is written. The user asked for a new version after these merges.
- **The notes** follow 0.1.2's: the same download part with the new file names, one line on the update from 0.1.1 and 0.1.2, then what is new, in the person's words, with what was measured.
- **Nothing else names the version:** the updates test's `0.1.1` and `0.1.2` are a fake updater's versions, not the app's.
- Checked on the prototype: the updates and CLI tests (41) after raising the version, `pnpm test` (1029 passed, 87 skipped) and `pnpm typecheck`.

---

### Task 1: The version and its notes

**Files:**
- Create: `docs/releases/0.1.3.md`
- Modify: `apps/desktop/package.json`, `apps/cli/src/main.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `release-0.1.3`; work there:

```bash
git switch release-0.1.3
```

- [ ] **Step 2: The version**

In `apps/desktop/package.json`, replace:

```json
{
  "name": "@cuttle/desktop",
  "version": "0.1.2",
  "private": true,
  "type": "module",
  "description": "Cuttle: screen recordings that edit themselves",
```

with:

```json
{
  "name": "@cuttle/desktop",
  "version": "0.1.3",
  "private": true,
  "type": "module",
  "description": "Cuttle: screen recordings that edit themselves",
```

In `apps/cli/src/main.ts`, replace:

```ts
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';

export const VERSION = '0.1.2';

const seconds = (value: string): number => {
  const parsed = Number(value);
```

with:

```ts
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';

export const VERSION = '0.1.3';

const seconds = (value: string): number => {
  const parsed = Number(value);
```

Run: `pnpm exec vitest run --project node apps/desktop/test/updates.test.ts apps/cli/test/cli.test.ts`
Expected: PASS, 41 tests.

- [ ] **Step 3: The notes**

`docs/releases/0.1.3.md`:

```markdown
Privacy masks that stay on what scrolls, and email addresses found in code. Cuttle records your screen, or Claude Code at work, and edits the take itself: it cuts the waiting, zooms on what matters, masks your secrets and frames it into a demo you can post. Everything runs on your computer.

## Download

- **Windows:** `Cuttle-0.1.3-win-x64.exe`. It installs for you alone, without admin rights, with Start menu and desktop shortcuts. It is not code-signed yet, so SmartScreen may not know it: choose *More info*, then *Run anyway*.
- **macOS (Apple silicon):** `Cuttle-0.1.3-mac-arm64.dmg`. Open it and drag Cuttle into Applications. The first recording asks for the screen, the microphone, input monitoring and accessibility.

Cuttle also needs ffmpeg: `winget install Gyan.FFmpeg` on Windows, `brew install ffmpeg` on a Mac. Its first start says what is missing.

Cuttle 0.1.1 and 0.1.2 update themselves to this version within a day, or at once with *Restart and update* (Settings, General).

## New in this version

- **Masks that stay on text that scrolls:**
  - Cuttle reads the screen's text at most twice a second. A mask used to know only those moments. A key that scrolled in showed until it was read. A key that scrolled out left its mask behind, over other text, while the key went by uncovered.
  - Now each private thing it finds is followed in every frame of the take. Its mask moves with it as it comes in, scrolls, goes away and back, and goes out, also under a page's header and when the page jumps (Page Down).
  - On the scrolling pages it was measured on, a key showed in up to 34 frames before. Now it shows in none, also in the video rendered with zooms.
  - In the editor's source view, such a mask shows its way, with its box where it rests.
- **Email addresses in code:** Windows' OCR reads addresses in an editor's monospaced font with slips: spaces beside a dot ("example . com"), a long dash for a hyphen, a space for an underscore. Cuttle now finds them anyway. On a page of editor fonts and colours, 5 % of the addresses' pixels stay unmasked instead of 21 %: the addresses the OCR left out or misread too far.
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/package.json apps/cli/src/main.ts docs/releases/0.1.3.md
git commit -m "Cuttle 0.1.3: the version and its notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: All tests and the typecheck

- [ ] **Step 1: Run them**

Run: `pnpm test`
Expected: PASS, 1029 passed, 87 skipped.

Run: `pnpm typecheck`
Expected: exits with code 0.

## After the merge

Run the Release workflow (Actions > Release > Run workflow, or `gh workflow run release.yml --ref main`). Look at the draft release `v0.1.3`: the notes, `Cuttle-0.1.3-win-x64.exe`, `Cuttle-0.1.3-mac-arm64.dmg`, the zip, `latest.yml` and `latest-mac.yml`. Then publish it.

## Changes during execution

- It was written from the finished prototype and replayed on a fresh clone for its commit; the tree came out byte-identical to the prototype.

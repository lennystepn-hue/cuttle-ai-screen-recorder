# Cuttle Fix: a Loading Status Covered the Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the music renders (or a motion page loads), the editor stays in sight. Until now the window went dark and showed only "Rendering the music…" at its left edge until the render was done.

**Architecture:** The status line of the music and of a motion page has the class `loading` while it works. The editor's cover for a project that is opening had the same class name, as a fixed layer over the whole window in the window's colour, its content centred. So the status line became that cover. The cover is called `opening` now; the status lines keep `loading`.

**Tech Stack:** React 19, CSS, Electron 44.7.2.

Reported by the user on 2026-10-18 (a project of 2.5 minutes with the lofi music; its swing changed, and the window went dark during each render). Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m2b-backgrounds.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `fix-status-cover`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The checks never show a window and never capture this machine.

## Decisions made while planning

The fault was reproduced in the hidden app check before it was fixed. The fixed tree passed `pnpm test` (895 tests, 72 skipped, in two full runs), the typecheck, `app:check` (52 tests) and `cli:check` (14). Every screenshot was looked at.

- **Reproduced first.** A project like the user's (four clips over three minutes of a test recording, the lofi music, the music selected, its swing changed): every capture during the render showed the dark window with the status line alone at its left, as in the user's screenshot. Memory stayed ordinary (no process over 420 MB), and the GPU process had not restarted: the page itself was laid out wrong.
- **The cover gets its own name.** `.loading` was a name both a state and a layout used. The cover is `.opening`, as the project is opening; the states keep their names (`loading`, `ready`, `failed`), which their own rules (`.motion-state.loading`) style.
- **The check catches it where it happened:** while the music renders, its status line is less than 60 px high and the title bar is in sight. Without the fix that line is the whole window (904 px).

---

### Task 1: The cover's own name, and the check

**Files:**
- Modify: `apps/desktop/src/renderer/editor/App.tsx`, `apps/desktop/src/renderer/editor/editor.css`, `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `fix-status-cover`; work there:

```bash
git switch fix-status-cover
```

- [ ] **Step 2: Write the failing check**

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    await chooseIn(page, '[data-testid=add-music]', 'Pulse');
    await expect.poll(() => saved().music?.src).toBe('music/pulse/index.html');
    expect(existsSync(join(dir, 'music', 'pulse', 'index.html'))).toBe(true);
    await expect.poll(async () => (await now()).sound.status.state, { timeout: 90_000 }).toBe('ready');
    await expect.poll(async () => (await now()).sound.track, { timeout: 20_000 }).toBe((await now()).sound.status.key);
    const first = (await now()).sound;
```

with:

```ts
    await chooseIn(page, '[data-testid=add-music]', 'Pulse');
    await expect.poll(() => saved().music?.src).toBe('music/pulse/index.html');
    expect(existsSync(join(dir, 'music', 'pulse', 'index.html'))).toBe(true);
    // while it renders, its state is a line in the panel and the editor stays in sight (a state's "loading" once took the window's loading cover)
    const rendering = await page.waitForSelector('[data-testid=music-state].loading', { timeout: 30_000 });
    expect((await rendering.boundingBox())!.height).toBeLessThan(60);
    expect(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, 22)?.closest('.titlebar') !== null)).toBe(true);
    await shotOf('40a-music-rendering', '/editor.html', 'music-editor · Cuttle');
    await expect.poll(async () => (await now()).sound.status.state, { timeout: 90_000 }).toBe('ready');
    await expect.poll(async () => (await now()).sound.track, { timeout: 20_000 }).toBe((await now()).sound.status.key);
    const first = (await now()).sound;
```

Run: `pnpm app:check`
Expected: FAIL in "plays music made for the video": `expected 904 to be less than 60` (the status line covers the window).

- [ ] **Step 3: The cover's own name**

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```css
  overflow: auto;
}

/* loading and errors */
.loading {
  position: fixed;
  inset: 0;
  z-index: 10;
```

with:

```css
  overflow: auto;
}

/* the project opening (its own name: a status line that is loading must not cover the window) and errors */
.opening {
  position: fixed;
  inset: 0;
  z-index: 10;
```

In `apps/desktop/src/renderer/editor/App.tsx`, replace:

```tsx
      <ExportSheet />
      <CommandMenu />
      {phase === 'loading' && (
        <div className="loading">
          <div className="spinner" role="status" aria-label="Opening the project" />
        </div>
      )}
```

with:

```tsx
      <ExportSheet />
      <CommandMenu />
      {phase === 'loading' && (
        <div className="opening">
          <div className="spinner" role="status" aria-label="Opening the project" />
        </div>
      )}
```

Run: `pnpm app:check`
Expected: PASS, 52 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/editor/App.tsx apps/desktop/src/renderer/editor/editor.css apps/desktop/test/app.check.test.ts
git commit -m "app: the cover of a project that is opening has a name of its own; a loading status line no longer covers the editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 895 passed and 72 skipped (where a speech model is found, its real transcription runs too: 896 and 71; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 14 tests.

Run: `pnpm app:check`
Expected: PASS, 52 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Open a project with music, select the music and change a param: while it renders, the editor stays, and the panel says "Rendering the music…" on its line.
2. Add a motion template: while its page loads, the editor stays too.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished fix. Its task was replayed on a fresh clone for its commit, and the tree came out byte-identical.
- The checks ran on the finished fix; the packaged build on the replayed commit. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this is merged on the local checks: Windows only, macOS not run.

**Flaky, and not this fix's**
- **The recorder's pause test** took longer than it allows in one of the two full `pnpm test` runs, under load, as seen on `main` before; the other run passed it.

**Spec points that move**
- None. Next: **P5-M2c** (device frames and the watermark).

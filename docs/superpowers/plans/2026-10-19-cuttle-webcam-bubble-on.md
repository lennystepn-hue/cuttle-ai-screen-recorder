# Cuttle: A Take With a Camera Shows It Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a take recorded with a camera, the video shows the webcam bubble.

The user recorded on a Mac with a camera, allowed it, and found no bubble in the editor. The bubble is off by default (`look.webcam.enabled: false`), and nothing switched it on.

**Architecture:** `useTake` (`packages/core/src/use-take.ts`) points a project at a new take, for recording in the app and in the CLI, for an import, and for a recover.
- A take with a webcam track switches `look.webcam.enabled` on.
- The bubble's other fields (place, size, shape) stay as set.
- The same take recovered (`keepEdit`) and a take without a camera leave the look as it is.

**Tech Stack:** TypeScript, vitest.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `webcam-bubble-on`, in Git Bash.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions made while planning

- **On for every new take with a camera, even after the person switched it off:** the camera was chosen for this take. Switching it off in the Look tab still works afterwards.
- **One place for all ways a take comes in:** the app's recording, `cuttle record`, `cuttle import` and `cuttle recover` all call `useTake`.
- **The reference says so:** `skill/cuttle/project.md`'s `webcam` row.
- Checked on the prototype: the new test failed before the change (no `enabled: true`), and `pnpm test` passed after it (1006, 82 skipped).

---

### Task 1: The bubble comes on with a camera

**Files:**
- Modify: `packages/core/src/use-take.ts`, `skill/cuttle/project.md`
- Test: `packages/core/test/use-take.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `webcam-bubble-on`; work there:

```bash
git switch webcam-bubble-on
```

- [ ] **Step 2: Write the failing test**

In `packages/core/test/use-take.test.ts`, replace:

```ts
    expect((file.raw.sources as { transcript?: string }).transcript).toBe('takes/1/transcript.json');
  });

  it('drops the motion overlays, which are timed on the previous take, and counts them as an edit', () => {
    const raw = { version: 1, sources: first.sources, overlays: [{ id: 'o1', src: 'motion/callouts/index.html', at: 2, duration: 3 }] };
    const file = fileWith(raw);
```

with:

```ts
    expect((file.raw.sources as { transcript?: string }).transcript).toBe('takes/1/transcript.json');
  });

  it('switches the webcam bubble on for a take with a camera, keeping where and how it is drawn', () => {
    const file = fileWith({ ...first, look: { frame: { style: 'mac-light' }, webcam: { corner: 'top-right', size: 0.25 } } });
    useTake(file, { screen: 'takes/2/screen.mp4', webcam: 'takes/2/webcam.mp4', seconds: 8 });
    expect(file.raw.look).toEqual({ frame: { style: 'mac-light' }, webcam: { corner: 'top-right', size: 0.25, enabled: true } });
    // switched off by the person and a new take with a camera: on again (the camera was chosen for it)
    const off = fileWith({ ...first, look: { webcam: { enabled: false } } });
    useTake(off, { screen: 'takes/2/screen.mp4', webcam: 'takes/2/webcam.mp4', seconds: 8 });
    expect(off.raw.look).toEqual({ webcam: { enabled: true } });
    // a take without a camera, and the same take recovered, leave the look as it is
    const plain = fileWith(first);
    useTake(plain, { screen: 'takes/2/screen.mp4', seconds: 8 });
    expect(plain.raw.look).toBeUndefined();
    const same = fileWith({ ...first, look: { webcam: { enabled: false } } });
    useTake(same, { screen: 'takes/1/screen.mp4', webcam: 'takes/1/webcam.mp4', seconds: 10 }, true);
    expect(same.raw.look).toEqual({ webcam: { enabled: false } });
  });

  it('drops the motion overlays, which are timed on the previous take, and counts them as an edit', () => {
    const raw = { version: 1, sources: first.sources, overlays: [{ id: 'o1', src: 'motion/callouts/index.html', at: 2, duration: 3 }] };
    const file = fileWith(raw);
```

Run: `pnpm exec vitest run --project node packages/core/test/use-take.test.ts`
Expected: FAIL: the look has no `enabled: true`.

- [ ] **Step 3: The bubble on**

In `packages/core/src/use-take.ts`, replace:

```ts

/**
 * Points the project at a take: `sources` names its files. A project is one take: by default the
 * take becomes one clip scene, and the scenes, zooms, masks, texts, motion overlays and cuts of the previous take
 * (which refer to its source times) are dropped. With `keepEdit` (recovering the take the project already
 * uses) they stay, and a clip over the whole take is added only when there are no scenes. Returns
 * whether the project had scenes or overlays, so the caller keeps the previous cuttle.json as a
 * backup when it writes (`writeProjectFile`'s `backup`).
 */
export function useTake(file: ProjectFile, take: TakeFiles, keepEdit = false): boolean {
  const { scenes, zooms, masks, texts, overlays, cuts } = file.project;
```

with:

```ts

/**
 * Points the project at a take: `sources` names its files. A project is one take: by default the
 * take becomes one clip scene, and the scenes, zooms, masks, texts, motion overlays and cuts of the
 * previous take (which refer to its source times) are dropped; a take with a camera switches the
 * webcam bubble on. With `keepEdit` (recovering the take the project already uses) they stay, and a
 * clip over the whole take is added only when there are no scenes. Returns whether the project had
 * scenes or overlays, so the caller keeps the previous cuttle.json as a backup when it writes
 * (`writeProjectFile`'s `backup`).
 */
export function useTake(file: ProjectFile, take: TakeFiles, keepEdit = false): boolean {
  const { scenes, zooms, masks, texts, overlays, cuts } = file.project;
```

In the same file, replace:

```ts
  }
  // Milliseconds rounded down: the clip must end inside the screen track.
  file.raw.scenes = [{ type: 'clip', from: 0, to: Math.floor(take.seconds * 1000) / 1000 }];
  delete file.raw.zooms;
  delete file.raw.masks;
  delete file.raw.texts;
```

with:

```ts
  }
  // Milliseconds rounded down: the clip must end inside the screen track.
  file.raw.scenes = [{ type: 'clip', from: 0, to: Math.floor(take.seconds * 1000) / 1000 }];
  // A take with a camera shows it: the bubble comes on (it is off by default), drawn as it was set.
  if (take.webcam) {
    const look = (file.raw.look ?? {}) as Record<string, unknown>;
    file.raw.look = { ...look, webcam: { ...((look.webcam as Record<string, unknown> | undefined) ?? {}), enabled: true } };
  }
  delete file.raw.zooms;
  delete file.raw.masks;
  delete file.raw.texts;
```

In `skill/cuttle/project.md`, replace:

```markdown
| `background.preset` | `sunset-sky`, `aurora`, `mesh`, `solid` (needs `color`, e.g. `"#0c0c0c"`), `image` (needs `image`: a path; `blur` 0–1 softens it, `dim` 0–0.8 darkens it), `gradient` (needs `colors`: 2 to 4, first to last; `angle` as in CSS, `135` by default; `kind` `linear` or `radial`), and the quiet animated `flow`, `bokeh` and `dots`; `mesh`, `flow`, `bokeh` and `dots` take `colors` too (else their own) |
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `browser-dark`, `windows-light`, `windows-dark`, `terminal`, `none`; and the phones `iphone` and `android`, a bezel and a camera around the screen, for a tall recording of a phone or a narrow window), `title` (`""`), `radius` (`14`; not for the phones), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`, `squircle`, `square`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5), `position` (`{ x, y }`: the bubble's centre as a share of the video, 0–1; it replaces `corner`), `border` (`true`: a white ring), `shadow` (`true`), `mirror` (`false`: flipped left to right) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one), `typing` (`true`: a key click for each key typed, where the clip is heard), `typingVolume` (`0.5`, 0 to 1), `effects` (`true`: the `sounds` and the music page's effects), `effectsVolume` (`0.8`, 0 to 1) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |
| `watermark` | `enabled` (`false`), `image` (a path; without it the brand's logo, `theme.logo`), `text` (shown without an image; without it the brand's name), `corner` (`bottom-right`, `bottom-left`, `top-left`, `top-right`), `size` (`0.06`: its height as a share of the short side, 0.02 to 0.3), `opacity` (`0.7`, 0.1 to 1): a mark over the whole video, clear of the webcam bubble |
```

with:

```markdown
| `background.preset` | `sunset-sky`, `aurora`, `mesh`, `solid` (needs `color`, e.g. `"#0c0c0c"`), `image` (needs `image`: a path; `blur` 0–1 softens it, `dim` 0–0.8 darkens it), `gradient` (needs `colors`: 2 to 4, first to last; `angle` as in CSS, `135` by default; `kind` `linear` or `radial`), and the quiet animated `flow`, `bokeh` and `dots`; `mesh`, `flow`, `bokeh` and `dots` take `colors` too (else their own) |
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `browser-dark`, `windows-light`, `windows-dark`, `terminal`, `none`; and the phones `iphone` and `android`, a bezel and a camera around the screen, for a tall recording of a phone or a narrow window), `title` (`""`), `radius` (`14`; not for the phones), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`; a take recorded with a camera switches it on), `shape` (`circle`, `rounded`, `squircle`, `square`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5), `position` (`{ x, y }`: the bubble's centre as a share of the video, 0–1; it replaces `corner`), `border` (`true`: a white ring), `shadow` (`true`), `mirror` (`false`: flipped left to right) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent), `cleanup` (`true`: the cleaned-up mic plays, where there is one), `typing` (`true`: a key click for each key typed, where the clip is heard), `typingVolume` (`0.5`, 0 to 1), `effects` (`true`: the `sounds` and the music page's effects), `effectsVolume` (`0.8`, 0 to 1) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |
| `watermark` | `enabled` (`false`), `image` (a path; without it the brand's logo, `theme.logo`), `text` (shown without an image; without it the brand's name), `corner` (`bottom-right`, `bottom-left`, `top-left`, `top-right`), `size` (`0.06`: its height as a share of the short side, 0.02 to 0.3), `opacity` (`0.7`, 0.1 to 1): a mark over the whole video, clear of the webcam bubble |
```

Run: `pnpm exec vitest run --project node packages/core/test/use-take.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/use-take.ts packages/core/test/use-take.test.ts skill/cuttle/project.md
git commit -m "a take recorded with a camera switches the webcam bubble on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: All tests, the typecheck and the checks

- [ ] **Step 1: Run them**

Run: `pnpm test`
Expected: PASS, 1006 passed, 82 skipped.

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 17 tests.

Run: `pnpm app:check`
Expected: PASS, 58 tests.

## Changes during execution

- It was written from the finished prototype and replayed on a fresh clone for its commit; the tree came out byte-identical to the prototype.

# Cuttle Fix: Notes Ran Out of the Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every row of the inspector stays inside its panel. Until now the Look tab's Sound part ran out of it: the notes beside its switches ("the mic, the music and the sounds", "the sounds and the music's effects") were cut off at the window's edge, and its switches did not line up.

**Architecture:** An inline row (`Row … inline`) put its note after its control, both in one box that could not shrink (`flex: none`). A note longer than the room left could not give way, so the box reached past the panel. A row with a note and a control now puts the note under its name, and the control keeps its place at the right. A state word beside a switch ("On: the video jumps over it") gives way with an ellipsis instead of running out. The app check now looks for anything in the inspector that reaches past its panel: in every part of the Look tab, and at each of its screenshots of an editor.

**Tech Stack:** React 19, CSS, Electron 44.7.2, Playwright.

Reported by the user on 2026-10-18 with a screenshot of the Sound part ("manchmal geht text raus"). Previous fix: `docs/superpowers/plans/2026-10-18-cuttle-fix-status-cover.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `fix-inspector-overflow`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The checks never show a window and never capture this machine.

## Decisions made while planning

The fault was reproduced in the hidden app check before it was fixed. The fixed tree passed `pnpm test` (910 tests, 74 skipped, in two full runs), the typecheck, `app:check` (54 tests) and `cli:check` (14). Every screenshot was looked at.

- **Reproduced first.** The new check opened each part of the Look tab of a project with a webcam, a transcript, a clean voice and the watermark on, so every row shows. Only the Sound part ran out: its row Sound by 28 px, its row Sounds by 38 px. The inspector is 300 px wide at every window size, so it happens on every screen.
- **The note goes under the name.** Cut off with an ellipsis, the note would have lost what it says. Under the name it wraps when it must, and every switch of a part sits at the same place on the right, as in the system's own settings. The row Sped-up clips said its state after its switch ("Silent"); it is that row's note now, so its switch lines up too.
- **A state word gives way.** In the Selection tab a state word sits before its switch ("On: the video jumps over it", "Off: kept, not in the video"). The row's control box may shrink now, so such a word ends in an ellipsis before the row could run out; its name and its switch keep their size.
- **The check looks everywhere it takes a picture.** A function of the app check lists what in an inspector reaches past the right edge of its box (a Look part's card, else the panel inside its padding). It runs in a check of its own over every Look part, and at each of the app check's 23 screenshots of an editor, with screenshots or without.

---

### Task 1: The check, and the rows that stay inside

**Files:**
- Modify: `apps/desktop/src/renderer/editor/Inspector.tsx`, `apps/desktop/src/renderer/editor/editor.css`, `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `fix-inspector-overflow`; work there:

```bash
git switch fix-inspector-overflow
```

- [ ] **Step 2: Write the failing check**

In `apps/desktop/test/app.check.test.ts`, replace:

```ts

/** Clicks an element in a page without a real mouse (the window is never shown). */
const click = (page: Page, selector: string) => page.evaluate((target) => (document.querySelector(target) as HTMLElement).click(), selector);
/**
 * Picks the option labelled `label` (`prefix`: starting with it) from a select (Select.tsx): a click
 * opens it, a click on the option picks it. A list closed again before the pick (a scroll still due
```

with:

```ts

/** Clicks an element in a page without a real mouse (the window is never shown). */
const click = (page: Page, selector: string) => page.evaluate((target) => (document.querySelector(target) as HTMLElement).click(), selector);
/**
 * What in the inspector reaches past the right edge of its box (a Look part's card, else the panel
 * inside its padding): a text or a control running out of its panel. Each as its tag, classes and
 * text, with how far it reaches out.
 */
const outsideItsPanel = (page: Page) =>
  page.evaluate(() => {
    const found: string[] = [];
    for (const panel of document.querySelectorAll<HTMLElement>('.inspector .panel-body')) {
      const style = getComputedStyle(panel);
      const panelRight = panel.getBoundingClientRect().left + panel.clientWidth - parseFloat(style.paddingRight);
      for (const element of panel.querySelectorAll<HTMLElement>('*')) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const card = element.closest('.look-part');
        const right = card && card !== element ? card.getBoundingClientRect().right : panelRight;
        if (rect.right > right + 0.5) found.push(`${element.tagName.toLowerCase()}${[...element.classList].map((name) => `.${name}`).join('')} "${(element.textContent ?? '').trim().slice(0, 40)}" by ${Math.round(rect.right - right)} px`);
      }
    }
    return found;
  });
/**
 * Picks the option labelled `label` (`prefix`: starting with it) from a select (Select.tsx): a click
 * opens it, a click on the option picks it. A list closed again before the pick (a scroll still due
```

In the same file, replace:

```ts
  };
  /** A screenshot of the window whose URL has `part` and whose title is `title` (when given). */
  const shotOf = async (name: string, part: string, title?: string) => {
    if (!SHOTS) return;
    const png = await app.evaluate(
      async ({ BrowserWindow }, { part, title }) => {
```

with:

```ts
  };
  /** A screenshot of the window whose URL has `part` and whose title is `title` (when given). */
  const shotOf = async (name: string, part: string, title?: string) => {
    // what an editor shows here stays inside its inspector, screenshots taken or not
    if (part === '/editor.html') {
      for (const page of app.windows()) {
        if (!page.url().includes(part) || (title !== undefined && (await page.title().catch(() => '')) !== title)) continue;
        expect({ shot: name, outside: await outsideItsPanel(page) }).toEqual({ shot: name, outside: [] });
      }
    }
    if (!SHOTS) return;
    const png = await app.evaluate(
      async ({ BrowserWindow }, { part, title }) => {
```

In the same file, replace:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'frames · Cuttle')?.close());
  }, 240_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

with:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'frames · Cuttle')?.close());
  }, 240_000);

  it('keeps every part of the Look tab inside the inspector, each with all its rows shown', async () => {
    const dir = join(root, 'looks');
    makeFixture(dir);
    // a transcript and a clean voice, so the subtitles' and the sound's rows all show; a watermark on
    const take = join(dir, 'takes', '1');
    writeFileSync(join(take, 'transcript.json'), JSON.stringify({ version: 1, language: 'en', model: 'small', words: [{ t: 1, end: 1.4, text: 'Hello' }] }));
    cpSync(join(take, 'mic.m4a'), join(take, 'mic.clean.m4a'));
    const path = join(dir, 'cuttle.json');
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { sources: Record<string, string>; look: Record<string, unknown> };
    raw.sources = { ...raw.sources, transcript: 'takes/1/transcript.json', cleanMic: 'takes/1/mic.clean.m4a' };
    raw.look = { ...raw.look, watermark: { enabled: true } };
    writeFileSync(path, JSON.stringify(raw, null, 2));
    const page = await openEditor(dir);
    await click(page, '#tab-look');
    const parts = await page.$$eval('.look-part', (sections) => sections.map((section) => (section as HTMLElement).dataset.testid!.replace(/^look-/, '')));
    expect(parts).toEqual(['brand', 'watermark', 'background', 'window', 'cursor', 'camera', 'subtitles', 'sound', 'video']);
    const outside: Record<string, string[]> = {};
    const look = async (part: string) => {
      const found = await outsideItsPanel(page);
      if (found.length > 0) outside[part] = found;
    };
    await look('closed');
    for (const part of parts) {
      await click(page, `[data-testid=look-open-${part}]`);
      await page.waitForSelector(`[data-testid=look-${part}] .look-body`);
      // a moment for what a part loads (the frames' and cursors' pictures, the kits)
      await page.waitForTimeout(400);
      await look(part);
    }
    expect(outside).toEqual({});
    await click(page, '[data-testid=look-open-sound]');
    await shotOf('45-sound', '/editor.html', 'looks · Cuttle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'looks · Cuttle')?.close());
  }, 120_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

Run: `pnpm app:check`
Expected: FAIL in "keeps every part of the Look tab inside the inspector": the Sound part's `span.field-input "the mic, the music and the sounds" by 28 px` and `"the sounds and the music's effects" by 38 px`.

- [ ] **Step 3: The note under the name, a state word that gives way**

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```tsx
 */
function Row({ label, children, note, wide, plain, inline }: { label: string; children: ReactNode; note?: ReactNode; wide?: boolean; plain?: boolean; inline?: boolean }) {
  const Tag = plain ? 'div' : 'label';
  return (
    <Tag className={`field${wide ? ' wide' : ''}${inline ? ' inline' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        {children}
        {note !== undefined && <em title={typeof note === 'string' ? note : undefined}>{note}</em>}
      </span>
    </Tag>
  );
```

with:

```tsx
 */
function Row({ label, children, note, wide, plain, inline }: { label: string; children: ReactNode; note?: ReactNode; wide?: boolean; plain?: boolean; inline?: boolean }) {
  const Tag = plain ? 'div' : 'label';
  const said = note !== undefined && <em title={typeof note === 'string' ? note : undefined}>{note}</em>;
  return (
    <Tag className={`field${wide ? ' wide' : ''}${inline ? ' inline' : ''}`}>
      {inline && said ? (
        // beside a switch the note goes under the name: the switches line up, and a long note wraps
        <span className="field-text">
          <span className="field-label">{label}</span>
          {said}
        </span>
      ) : (
        <span className="field-label">{label}</span>
      )}
      <span className="field-input">
        {children}
        {!inline && said}
      </span>
    </Tag>
  );
```

In the same file, replace:

```tsx
          </Row>
        )}
        {current.audio.enabled && (
          <Row label="Sped-up clips" inline>
            <Toggle checked={current.audio.muteSpedUp} label="Silent when sped up" onChange={(on) => look(['audio', 'muteSpedUp'], on, on ? 'Sped-up clips silent' : 'Sped-up clips heard')} />
            <em>{current.audio.muteSpedUp ? 'Silent' : 'Heard'}</em>
          </Row>
        )}
      </LookPart>
```

with:

```tsx
          </Row>
        )}
        {current.audio.enabled && (
          <Row label="Sped-up clips" inline note={current.audio.muteSpedUp ? 'silent' : 'heard'}>
            <Toggle checked={current.audio.muteSpedUp} label="Silent when sped up" onChange={(on) => look(['audio', 'muteSpedUp'], on, on ? 'Sped-up clips silent' : 'Sped-up clips heard')} />
          </Row>
        )}
      </LookPart>
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```css
  justify-content: space-between;
  gap: 12px;
}
.field.inline .field-input {
  flex: none;
  min-height: 0;
}
.hint-list {
  margin: 0;
  padding-left: 16px;
```

with:

```css
  justify-content: space-between;
  gap: 12px;
}
/* a state word beside a switch gives way (with an ellipsis) before the row runs out of its panel */
.field.inline .field-input {
  flex: 0 1 auto;
  min-width: 0;
  min-height: 0;
}
.field.inline > .field-label,
.field-text + .field-input {
  flex: none;
}
/* an inline row's name with its note under it: it gives way and wraps, the control keeps its place */
.field-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.field-text em {
  color: var(--faint);
  font-size: var(--size-xs);
  font-style: normal;
  line-height: 1.35;
}
.hint-list {
  margin: 0;
  padding-left: 16px;
```

Run: `pnpm app:check`
Expected: PASS, 54 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/editor/Inspector.tsx apps/desktop/src/renderer/editor/editor.css apps/desktop/test/app.check.test.ts
git commit -m "app: a switch's note goes under its name, a state word gives way; the app check finds what runs out of the inspector

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 910 passed and 74 skipped (where a speech model is found, its real transcription runs too: 911 and 73; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 14 tests.

Run: `pnpm app:check`
Expected: PASS, 54 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Open the Look tab and its Sound part: each switch's note is under its name, the switches line up on the right, and nothing is cut off.
2. Select a cut in the Auto tab or the timeline: "On: the video jumps over it" fits beside its switch.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished fix. Its task was replayed on a fresh clone for its commit, and the tree came out byte-identical.
- The checks ran on the finished fix; the packaged build on the replayed commit. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this is merged on the local checks: Windows only, macOS not run.

**Flaky, and not this fix's**
- **The recorder's pause test** took longer than it allows in one of the two full `pnpm test` runs, as on `main` before; the other run passed it.
- **The app check that reads the screen after a take** lost its editor window in the full run, as in the milestones before; run alone it passed.

**Spec points that move**
- None. Next: **P5-M3a** (the script and the prompter).

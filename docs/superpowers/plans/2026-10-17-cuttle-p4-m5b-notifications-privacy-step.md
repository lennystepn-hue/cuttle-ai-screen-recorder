# Cuttle P4-M5b: Notification Masks and the App's Privacy Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notifications that open over the screen are masked while they are open, and the app reads the screen after each take's cut, so what it showed that is private is masked without a command; the settings say whether it reads and which words it always masks.

**Architecture:**
- **Recorder:** the shell's toasts and notification centre (`Windows.UI.Core.CoreWindow` windows of ShellExperienceHost.exe) are windows of kind `notification` in the take's events.
- **Core** (`privacy/`):
  - `notifications.ts`: a mask per notification, from just before it was seen open to just after it was seen gone;
  - `apply.ts`: the privacy and notification masks merged by the tag rules; `readScreenTake` and `applyPrivacy`, the app's two steps.
  - `suggest` makes the notification masks too.
- **App:**
  - the settings' `privacy` (read the screen after a take, the words always masked) and a Privacy section in the settings window;
  - two media jobs (`read-screen`, `privacy-edits`) and a privacy step after the speech step (`main/privacy.ts`), one step to undo ("Cuttle's privacy masks");
  - the Auto tab's "Read the screen" note.
- **Skill:** notifications are masked; Do not disturb is still better.

**Tech Stack:** TypeScript strict, zod 4, vitest 5, koffi (kernel32), Windows PowerShell 5.1 with `Windows.Media.Ocr`, ffmpeg, Electron 44.7.2, React 19.3.0, Playwright (`_electron`).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase4-design.md`. Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p4-m5a-privacy-masks.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p4-m5b`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 7.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The prototype passed `pnpm test` (690 tests, 56 skipped), the typecheck, `app:check` (45 tests) and `cli:check` (5). Every screenshot was looked at.

- **What a notification is.** The recorder looks at the desktop's top-level windows about 4 times a second (M4b's `windowWatch`).
  - A `Windows.UI.Core.CoreWindow` of `ShellExperienceHost.exe` is a notification: the toasts, the notification centre (Win+N), and the shell's other flyouts, which are masked with them (safe).
  - The process's name comes from `QueryFullProcessImageNameW`, read only for CoreWindows and kept per process id.
  - Another app's CoreWindow (the Start menu's `SearchHost.exe`) is none.
- **A notification's mask** (`NOTIFICATION_RULES`):
  - from 0.3 s before it was seen open to 0.3 s after it was seen gone (the windows are looked at 4 times a second);
  - one never seen gone lasts to the take's end;
  - padded 6 px and kept on the screen; one entirely off it gets none;
  - `fill`, labelled "Notification", `auto: "notification"`, whatever it says: it may be private.
- **The tag rules**, now for both kinds (`withPrivacyMasks`):
  - Cuttle's privacy masks are made again only when the screen's text is there, its notification masks only when the take's events are; the other kind stays as it is.
  - A new mask that takes the place of one switched off stays off; every mask without the kind's tag stays.
  - **A mask made the same as before keeps its id:** a rerun that finds nothing new writes nothing.
- **The app's privacy step** (`main/privacy.ts`):
  - after the cut, once the speech step has ended: one write at a time, each its own step to undo;
  - it reads the screen when the settings say so (default on) and the take was not read yet, then masks in one write: the link to the text, the masks, and the settings' words added to `privacy.words`;
  - only reading shows in the title bar ("Reading the screen… 40 %"); masking the notifications alone shows nothing until it arrives;
  - it arrives as one step to undo, "Cuttle's privacy masks", with a toast that counts what was masked;
  - before it says the next change is its own, the editor's watcher looks at once (`settle`): the cut's write, still waiting for the watcher's 150 ms pause, keeps "Cuttle's cut";
  - **without Windows' OCR** (macOS, no OCR language) the notifications are masked all the same, and a note says why the screen was not read, once per run of the app or when asked;
  - **a failure** shows in the title bar with Try again, which reads again.
  - The step reads only on Windows unless asked: elsewhere the OCR is missing, and the Auto tab's button says why.
- **Linking the screen's text is not another take:** the editor keeps its document, its undo and its media (`takeKey` leaves out `screenText`, as it leaves out the transcript). Before, a `suggest` that linked it reloaded an open editor.
- **The settings:**
  - `privacy.read` (default on) and `privacy.words` (at most 50, each at most 120 characters, each once whatever its case);
  - a Privacy section with a switch and the words as chips: Enter adds (commas between), the cross takes one away;
  - off Windows the switch is off and disabled, and its hint says why.
  - The section is a file of its own (`PrivacySettings.tsx`) and uses the window's `Row`, so a new design of the settings carries it along.
- **The Auto tab** shows "The screen is not read" with a Read the screen button on Windows while the take was not read and the privacy kind is on.

## File structure

| File | Responsibility |
|---|---|
| `packages/recorder/src/win32.ts` | notification windows, a process's name |
| `packages/core/src/privacy/{notifications,apply}.ts`, `src/{suggest,index}.ts` | notification masks; the app's two steps |
| `apps/cli/test/cli.test.ts` | `suggest` masks a notification |
| `apps/desktop/src/main/{settings,settings-window,privacy,speech,recording,windows,media-service,project-watch}.ts` | the settings, the privacy step, its undo step's name |
| `apps/desktop/src/shared/{ipc,channels,media-jobs,take}.ts`, `src/workers/media.ts` | the requests, the jobs |
| `apps/desktop/src/renderer/editor/{App,Inspector,PrivacyNote}.tsx`, `doc.ts` | the title bar, the Auto tab, the toast |
| `apps/desktop/src/renderer/settings/{Settings,PrivacySettings}.tsx`, `settings.css` | the Privacy section |
| `skill/cuttle/SKILL.md` | for Claude |

---

### Task 1: Notifications in the recorder

**Files:**
- Modify: `packages/recorder/src/win32.ts`, `packages/recorder/test/win32.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p4-m5b`; work there:

```bash
git switch p4-m5b
```

- [ ] **Step 2: Write the failing test**

In `packages/recorder/test/win32.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { CURSOR_SHAPES } from '@cuttle/project';
import { RENDER_WIDGET, SHELL_CLASSES, loadWin32, windowKind } from '../src/win32';
```

with:

```ts
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CURSOR_SHAPES } from '@cuttle/project';
import { RENDER_WIDGET, SHELL_CLASSES, loadWin32, windowKind } from '../src/win32';
```

In the same file, replace:

```ts
    expect(windowKind('Chrome_WidgetWin_1', true, box(240, 400))).toBe('menu');
    expect(windowKind('Chrome_WidgetWin_1', false, box(1600, 900))).toBeUndefined();
    expect(windowKind('Notepad', false, box(800, 600))).toBeUndefined();
    const win = await loadWin32();
    for (const popup of win.popups()) {
      expect(['dialog', 'menu']).toContain(popup.kind);
      expect(popup.bounds.width).toBeGreaterThanOrEqual(2);
    }
    const front = win.foreground();
```

with:

```ts
    expect(windowKind('Chrome_WidgetWin_1', true, box(240, 400))).toBe('menu');
    expect(windowKind('Chrome_WidgetWin_1', false, box(1600, 900))).toBeUndefined();
    expect(windowKind('Notepad', false, box(800, 600))).toBeUndefined();
    // the shell's toasts and notification centre; another app's CoreWindow is none
    expect(windowKind('Windows.UI.Core.CoreWindow', false, box(364, 120), 'ShellExperienceHost.exe')).toBe('notification');
    expect(windowKind('Windows.UI.Core.CoreWindow', false, box(800, 600), 'SearchHost.exe')).toBeUndefined();
    const win = await loadWin32();
    expect(win.processName(process.pid).toLowerCase()).toBe(basename(process.execPath).toLowerCase());
    for (const popup of win.popups()) {
      expect(['dialog', 'menu', 'notification']).toContain(popup.kind);
      expect(popup.bounds.width).toBeGreaterThanOrEqual(2);
    }
    const front = win.foreground();
```

Run: `pnpm exec vitest run --project node packages/recorder/test/win32.test.ts`
Expected: FAIL: `windowKind` has no notifications, and `processName` does not exist.

- [ ] **Step 3: Notification windows**

In `packages/recorder/src/win32.ts`, replace:

```ts
   * page in one), visible unless `hidden` counts too; undefined without one.
   */
  contentArea(id: number, hidden?: boolean): Bounds | undefined;
  /** The dialogs and menus on the desktop now (not this process's own). */
  popups(): { id: number; kind: WindowKind; bounds: Bounds }[];
}

/** Chromium and Electron draw a page in a child window of this class: its rect is the page's. */
export const RENDER_WIDGET = 'Chrome_RenderWidgetHostHWND';

/**
 * What a top-level window is, by its class: `#32770` a dialog, `#32768` a menu, and a Chromium popup
 * that has an owner a dialog when it is at least 320 × 200, else a menu (a dropdown, a tooltip).
 */
export function windowKind(className: string, owned: boolean, bounds: Bounds): WindowKind | undefined {
  if (className === '#32770') return 'dialog';
  if (className === '#32768') return 'menu';
  if (className === 'Chrome_WidgetWin_1' && owned) return bounds.width >= 320 && bounds.height >= 200 ? 'dialog' : 'menu';
```

with:

```ts
   * page in one), visible unless `hidden` counts too; undefined without one.
   */
  contentArea(id: number, hidden?: boolean): Bounds | undefined;
  /** A process's executable's name (`node.exe`); '' when it cannot be read. */
  processName(pid: number): string;
  /** The dialogs, menus and notifications on the desktop now (not this process's own). */
  popups(): { id: number; kind: WindowKind; bounds: Bounds }[];
}

/** Chromium and Electron draw a page in a child window of this class: its rect is the page's. */
export const RENDER_WIDGET = 'Chrome_RenderWidgetHostHWND';

/** The shell's own windows: notifications (toasts) and the notification centre, among its flyouts. */
const SHELL_HOST = 'shellexperiencehost.exe';

/**
 * What a top-level window is, by its class: `#32770` a dialog, `#32768` a menu, and a Chromium popup
 * that has an owner a dialog when it is at least 320 × 200, else a menu (a dropdown, a tooltip). The
 * shell's `Windows.UI.Core.CoreWindow`s (`process`: ShellExperienceHost.exe) are notifications: the
 * toasts and the notification centre (its other flyouts are masked with them, which is safe).
 */
export function windowKind(className: string, owned: boolean, bounds: Bounds, process = ''): WindowKind | undefined {
  if (className === 'Windows.UI.Core.CoreWindow' && process.toLowerCase() === SHELL_HOST) return 'notification';
  if (className === '#32770') return 'dialog';
  if (className === '#32768') return 'menu';
  if (className === 'Chrome_WidgetWin_1' && owned) return bounds.width >= 320 && bounds.height >= 200 ? 'dialog' : 'menu';
```

In the same file, replace:

```ts
  const MonitorFromWindow = user32.func('__stdcall', 'MonitorFromWindow', 'void *', ['void *', 'uint32']);
  const GetConsoleWindow = kernel32.func('__stdcall', 'GetConsoleWindow', 'void *', []);
  const GetConsoleTitleW = kernel32.func('__stdcall', 'GetConsoleTitleW', 'uint32', ['void *', 'uint32']);
  const DwmGetWindowAttribute = dwmapi.func('__stdcall', 'DwmGetWindowAttribute', 'long', ['void *', 'uint32', 'void *', 'uint32']);
  const GetDpiForMonitor = shcore.func('__stdcall', 'GetDpiForMonitor', 'long', ['void *', 'int', koffi.out(koffi.pointer('uint32')), koffi.out(koffi.pointer('uint32'))]);
  const CreateDXGIFactory1 = dxgi.func('__stdcall', 'CreateDXGIFactory1', 'long', [koffi.pointer(GUID), koffi.out(koffi.pointer('void *'))]);
```

with:

```ts
  const MonitorFromWindow = user32.func('__stdcall', 'MonitorFromWindow', 'void *', ['void *', 'uint32']);
  const GetConsoleWindow = kernel32.func('__stdcall', 'GetConsoleWindow', 'void *', []);
  const GetConsoleTitleW = kernel32.func('__stdcall', 'GetConsoleTitleW', 'uint32', ['void *', 'uint32']);
  const OpenProcess = kernel32.func('__stdcall', 'OpenProcess', 'void *', ['uint32', 'int', 'uint32']);
  const QueryFullProcessImageNameW = kernel32.func('__stdcall', 'QueryFullProcessImageNameW', 'int', ['void *', 'uint32', 'void *', koffi.inout(koffi.pointer('uint32'))]);
  const CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'int', ['void *']);
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const DwmGetWindowAttribute = dwmapi.func('__stdcall', 'DwmGetWindowAttribute', 'long', ['void *', 'uint32', 'void *', 'uint32']);
  const GetDpiForMonitor = shcore.func('__stdcall', 'GetDpiForMonitor', 'long', ['void *', 'int', koffi.out(koffi.pointer('uint32')), koffi.out(koffi.pointer('uint32'))]);
  const CreateDXGIFactory1 = dxgi.func('__stdcall', 'CreateDXGIFactory1', 'long', [koffi.pointer(GUID), koffi.out(koffi.pointer('void *'))]);
```

In the same file, replace:

```ts
  const point = { x: 0, y: 0 };
  const info = { cbSize: koffi.sizeof(CURSORINFO), flags: 0, hCursor: null as unknown, ptScreenPos: { x: 0, y: 0 } };
  const rect = () => ({ left: 0, top: 0, right: 0, bottom: 0 });
  /** A window id (32 bits, unsigned) as the handle Windows takes. */
  const handleOf = (id: number) => (id >= 2 ** 31 ? id - 2 ** 32 : id);
  const idOf = (hwnd: unknown) => Number(BigInt.asUintN(32, koffi.address(hwnd)));
```

with:

```ts
  const point = { x: 0, y: 0 };
  const info = { cbSize: koffi.sizeof(CURSORINFO), flags: 0, hCursor: null as unknown, ptScreenPos: { x: 0, y: 0 } };
  const rect = () => ({ left: 0, top: 0, right: 0, bottom: 0 });
  /** A process's executable's name (`ShellExperienceHost.exe`), kept per process id; '' when it cannot be read. */
  const processNames = new Map<number, string>();
  const processName = (pid: number): string => {
    let name = processNames.get(pid);
    if (name !== undefined) return name;
    name = '';
    const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (handle) {
      try {
        const buffer = Buffer.alloc(1040);
        const size = [520];
        if (QueryFullProcessImageNameW(handle, 0, buffer, size)) name = buffer.toString('utf16le', 0, size[0]! * 2).split('\\').pop() ?? '';
      } finally {
        CloseHandle(handle);
      }
    }
    if (processNames.size > 500) processNames.clear();
    processNames.set(pid, name);
    return name;
  };
  /** A window id (32 bits, unsigned) as the handle Windows takes. */
  const handleOf = (id: number) => (id >= 2 ** 31 ? id - 2 ** 32 : id);
  const idOf = (hwnd: unknown) => Number(BigInt.asUintN(32, koffi.address(hwnd)));
```

In the same file, replace:

```ts
      if (!GetCursorInfo(info) || info.hCursor === null) return 'arrow';
      return cursorShapes.get(koffi.address(info.hCursor)) ?? 'arrow';
    },
    foreground() {
      const hwnd = GetForegroundWindow();
      const bounds = hwnd ? frame(hwnd) : undefined;
```

with:

```ts
      if (!GetCursorInfo(info) || info.hCursor === null) return 'arrow';
      return cursorShapes.get(koffi.address(info.hCursor)) ?? 'arrow';
    },
    processName,
    foreground() {
      const hwnd = GetForegroundWindow();
      const bounds = hwnd ? frame(hwnd) : undefined;
```

In the same file, replace:

```ts
        if (pid[0] === process.pid) return 1;
        if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) >= 0 && cloaked.readUInt32LE(0) !== 0) return 1;
        const bounds = frame(hwnd);
        const kind = bounds && windowKind(className(hwnd), GetWindow(hwnd, GW_OWNER) !== null, bounds);
        if (bounds && kind && bounds.width >= 2 && bounds.height >= 2) found.push({ id: idOf(hwnd), kind, bounds });
        return 1;
      }, koffi.pointer(WNDENUMPROC));
```

with:

```ts
        if (pid[0] === process.pid) return 1;
        if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) >= 0 && cloaked.readUInt32LE(0) !== 0) return 1;
        const bounds = frame(hwnd);
        const kindOf = className(hwnd);
        const kind = bounds && windowKind(kindOf, GetWindow(hwnd, GW_OWNER) !== null, bounds, kindOf === 'Windows.UI.Core.CoreWindow' ? processName(pid[0]!) : '');
        if (bounds && kind && bounds.width >= 2 && bounds.height >= 2) found.push({ id: idOf(hwnd), kind, bounds });
        return 1;
      }, koffi.pointer(WNDENUMPROC));
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run --project node packages/recorder/test/win32.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/recorder
git commit -m "recorder: the shell's toasts and notification centre are notification windows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Notification masks, and the app's two steps in the core

**Files:**
- Create: `packages/core/src/privacy/notifications.ts`, `packages/core/test/privacy-apply.test.ts`
- Modify: `packages/core/src/privacy/apply.ts`, `packages/core/src/{suggest,index}.ts`, `apps/cli/test/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/privacy-apply.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { InputEvent } from '@cuttle/project';
import { runFfmpeg } from '../src/ffmpeg';
import { applyPrivacy } from '../src/privacy/apply';
import { notificationMasks } from '../src/privacy/notifications';

const screen = { width: 1920, height: 1080 };
const toast = (t: number, open: boolean, id = 9, rect: [number, number, number, number] = [1530, 980, 380, 110]): InputEvent => ({ t, type: 'window', id, kind: 'notification', rect, open });

describe('notificationMasks', () => {
  it('masks a notification from just before it was seen open to just after it was seen gone, padded and on the screen', () => {
    // 1530 + 380 + 6 runs past the screen's right edge: it ends at 1920
    expect(notificationMasks([toast(4, true), toast(9, false)], screen)).toEqual([{ from: 3.7, to: 9.3, rect: [1524, 974, 392, 106] }]);
  });

  it('lasts to the take\'s end when it never closed, and leaves out one off the screen and other windows', () => {
    expect(notificationMasks([toast(4, true)], screen, 12)).toEqual([{ from: 3.7, to: 12, rect: [1524, 974, 392, 106] }]);
    expect(notificationMasks([toast(4, true, 9, [2000, 100, 300, 100])], screen)).toEqual([]);
    expect(notificationMasks([{ t: 4, type: 'window', id: 3, kind: 'dialog', rect: [100, 100, 400, 300], open: true }], screen)).toEqual([]);
  });
});

describe('applyPrivacy', () => {
  const dirs: string[] = [];
  afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

  /** A project whose 6 s take had a notification from 2 to 4 s, and whose screen showed an email address at 1 s. */
  async function project(): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-privacy-'));
    dirs.push(dir);
    const take = join(dir, 'takes', '1');
    mkdirSync(take, { recursive: true });
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=1920x1080:r=30:d=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(take, 'screen.mp4')]);
    writeFileSync(join(take, 'events.jsonl'), [toast(2, true), toast(4, false)].map((event) => `${JSON.stringify(event)}\n`).join(''));
    const line = { text: 'lena@example.com', rect: [100, 200, 160, 20], words: [{ text: 'lena@example.com', rect: [100, 200, 160, 20] }] };
    writeFileSync(join(take, 'screen-text.jsonl'), [{ t: 1, lines: [line] }, { t: 3, lines: [] }, { t: 4, lines: [] }].map((frame) => `${JSON.stringify(frame)}\n`).join(''));
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', events: 'takes/1/events.jsonl' }, scenes: [{ type: 'clip', from: 0, to: 6 }], masks: [{ id: 'm1', from: 0, to: 1, rect: [0, 0, 50, 50] }] }));
    return dir;
  }
  const masksOf = (dir: string) => (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { masks: { label?: string; auto?: string }[] }).masks;

  it('links the screen text with the masks in one write, keeps the person\'s masks, and adds the app\'s words', async () => {
    const dir = await project();
    const result = await applyPrivacy(dir, { link: 'takes/1/screen-text.jsonl', words: ['Lena Müller'] });
    expect(result).toMatchObject({ written: true, made: 1, notifications: 1, kinds: { email: 1 } });
    const file = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { sources: { screenText?: string }; privacy: { words: string[] } };
    expect(file.sources.screenText).toBe('takes/1/screen-text.jsonl');
    expect(file.privacy.words).toEqual(['Lena Müller']);
    expect(masksOf(dir).map((mask) => [mask.label ?? 'mine', mask.auto ?? 'mine'])).toEqual([
      ['mine', 'mine'],
      ['Email address', 'privacy'],
      ['Notification', 'notification'],
    ]);
    // again, with nothing new: nothing is written
    expect((await applyPrivacy(dir)).written).toBe(false);
  });

  it('masks the notifications without the screen\'s text, and leaves the privacy masks there as they are', async () => {
    const dir = await project();
    expect(await applyPrivacy(dir)).toMatchObject({ written: true, made: 0, notifications: 1 });
    expect(masksOf(dir).map((mask) => mask.auto ?? 'mine')).toEqual(['mine', 'notification']);
  });
});
```

In `apps/cli/test/cli.test.ts`, replace:

```ts
        ],
        "privacy": {
          "masks": 0,
          "read": false,
        },
        "project": "<project>/cuttle.json",
```

with:

```ts
        ],
        "privacy": {
          "masks": 0,
          "notifications": 0,
          "read": false,
        },
        "project": "<project>/cuttle.json",
```

In the same file, replace:

```ts
      type Rect = [number, number, number, number];
      type Mask = { label: string; from: number; to: number; rect: Rect; moves?: { at: number; rect: Rect }[]; auto?: string; style?: string };
      const first = (await cli('--json', '-C', dir, 'suggest', '--no-crop', '--mask', 'Lena Müller')).json as { privacy: { read: boolean; masks: number }; notes: string[] };
      expect(first.privacy).toEqual({ read: true, masks: 3 });
      expect(first.notes.some((note) => /^read the screen's text in \d+ frames \(.+\), into takes\/1\/screen-text\.jsonl$/.test(note))).toBe(true);
      const file = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { masks: Mask[]; sources: { screenText?: string }; privacy?: { words: string[] } };
      expect(file.sources.screenText).toBe('takes/1/screen-text.jsonl');
```

with:

```ts
      type Rect = [number, number, number, number];
      type Mask = { label: string; from: number; to: number; rect: Rect; moves?: { at: number; rect: Rect }[]; auto?: string; style?: string };
      const first = (await cli('--json', '-C', dir, 'suggest', '--no-crop', '--mask', 'Lena Müller')).json as { privacy: { read: boolean; masks: number }; notes: string[] };
      expect(first.privacy).toEqual({ read: true, masks: 3, notifications: 0 });
      expect(first.notes.some((note) => /^read the screen's text in \d+ frames \(.+\), into takes\/1\/screen-text\.jsonl$/.test(note))).toBe(true);
      const file = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { masks: Mask[]; sources: { screenText?: string }; privacy?: { words: string[] } };
      expect(file.sources.screenText).toBe('takes/1/screen-text.jsonl');
```

In the same file, replace:

```ts
      const again = (await cli('--json', '-C', dir, 'suggest', '--no-crop')).json as { privacy: { masks: number }; notes: string[] };
      expect(again.privacy.masks).toBe(3);
      expect(again.notes.some((note) => note.startsWith("read the screen's text"))).toBe(false);
      expect((await cli('--json', '-C', dir, 'suggest', '--no-crop', '--no-privacy', '--dry-run')).json).toMatchObject({ privacy: { read: false, masks: 0 } });
    } finally {
      if (off !== undefined) process.env.CUTTLE_OCR = off;
    }
  }, 120_000);
});

describe('cuttle frame', () => {
  it('writes a source frame at full size, with a numbered grid on request', async () => {
    const dir = temp();
```

with:

```ts
      const again = (await cli('--json', '-C', dir, 'suggest', '--no-crop')).json as { privacy: { masks: number }; notes: string[] };
      expect(again.privacy.masks).toBe(3);
      expect(again.notes.some((note) => note.startsWith("read the screen's text"))).toBe(false);
      expect((await cli('--json', '-C', dir, 'suggest', '--no-crop', '--no-privacy', '--dry-run')).json).toMatchObject({ privacy: { read: false, masks: 0, notifications: 0 } });
    } finally {
      if (off !== undefined) process.env.CUTTLE_OCR = off;
    }
  }, 120_000);
});

describe('cuttle suggest masks notifications', () => {
  it('masks a notification while it was open, and a rerun leaves the mask as it is', async () => {
    const dir = temp();
    mkdirSync(join(dir, 'takes', '1'), { recursive: true });
    const made = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x1e1e1e:s=1280x720:r=30:d=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(dir, 'takes', '1', 'screen.mp4')]);
    expect(made.status, String(made.stderr)).toBe(0);
    // a toast in the bottom right corner from 2 to 4 s
    const toast = (t: number, open: boolean) => ({ t, type: 'window', id: 7, kind: 'notification', rect: [880, 600, 380, 110], open });
    writeFileSync(join(dir, 'takes', '1', 'events.jsonl'), [toast(2, true), toast(4, false)].map((event) => `${JSON.stringify(event)}\n`).join(''));
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', events: 'takes/1/events.jsonl' } }));
    const first = (await cli('--json', '-C', dir, 'suggest', '--no-crop')).json as { privacy: unknown; notes: string[] };
    expect(first.privacy).toEqual({ read: false, masks: 0, notifications: 1 });
    expect(first.notes).toContain('masked 1 notification while it was open');
    const masks = () => (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { masks: unknown[] }).masks;
    const before = masks();
    expect(before).toEqual([{ id: expect.any(String), label: 'Notification', from: 1.7, to: 4.3, rect: [874, 594, 392, 122], style: 'fill', auto: 'notification' }]);
    await cli('--json', '-C', dir, 'suggest', '--no-crop');
    expect(masks()).toEqual(before);
  });
});

describe('cuttle frame', () => {
  it('writes a source frame at full size, with a numbered grid on request', async () => {
    const dir = temp();
```

Run: `pnpm exec vitest run --project node packages/core/test/privacy-apply.test.ts`
Expected: FAIL: `notificationMasks` and `applyPrivacy` do not exist.

- [ ] **Step 2: Notification masks**

`packages/core/src/privacy/notifications.ts`:

```ts
// Notification masks: a notification that opens over the screen (a toast, the notification centre)
// is masked while it is open, whatever it says: it may be private. The recorder logs when one opens
// and closes (`window` events of kind `notification`). Pure.
import type { InputEvent, Rect } from '@cuttle/project';

export const NOTIFICATION_RULES = {
  /** The recorder looks at the windows about 4 times a second: a mask starts this long before one was seen… */
  before: 0.3,
  /** …and ends this long after it was seen gone (source s). */
  after: 0.3,
  /** Room around it (px). */
  pad: 6,
};

export interface NotificationMask {
  from: number;
  to: number;
  rect: Rect;
}

/**
 * A mask per notification over the screen, from just before it opened to just after it closed (the
 * take's `end` when it never did), padded and kept on the screen; one entirely off the screen gets none.
 */
export function notificationMasks(events: readonly InputEvent[], screen: { width: number; height: number }, end = Infinity, rules = NOTIFICATION_RULES): NotificationMask[] {
  const windows = events.flatMap((event) => (event.type === 'window' && event.kind === 'notification' ? [event] : [])).sort((a, b) => a.t - b.t);
  const masks: NotificationMask[] = [];
  for (const opened of windows.filter((event) => event.open)) {
    const [x, y, width, height] = opened.rect;
    const left = Math.max(0, x - rules.pad);
    const top = Math.max(0, y - rules.pad);
    const right = Math.min(screen.width, x + width + rules.pad);
    const bottom = Math.min(screen.height, y + height + rules.pad);
    if (right <= left || bottom <= top) continue;
    const closed = windows.find((event) => !event.open && event.id === opened.id && event.t > opened.t)?.t;
    const to = closed === undefined ? (Number.isFinite(end) ? end : opened.t + 5) : closed + rules.after;
    masks.push({ from: round(Math.max(0, opened.t - rules.before)), to: round(to), rect: [Math.round(left), Math.round(top), Math.round(right - left), Math.round(bottom - top)] });
  }
  return masks;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
```

- [ ] **Step 3: Both kinds by the tag rules; reading a take and applying the masks as the app's steps**

`packages/core/src/privacy/apply.ts`:

```ts
// The privacy masks applied to a project: made from the screen's text (screen-text.jsonl), the
// person's words and the notifications the recorder saw, merged with the masks there by the tag
// rules: Cuttle's privacy and notification masks are made again, one the person switched off stays
// off, every other mask stays. The app runs this as steps of its own after the cut.
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { newId, parseEventsJsonl, parseScreenTextJsonl, usedIds, type CuttleProject, type InputEvent, type Rect, type ScreenTextFrame } from '@cuttle/project';
import { CoreError } from '../errors';
import { readProjectFile, writeProjectFile } from '../project-file';
import { probeScreen } from '../suggest/media';
import { union } from '../suggest/spans';
import { privacyMasks, type PrivacyMask } from './masks';
import { notificationMasks } from './notifications';
import type { SecretKind } from './patterns';
import { SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './read';

/** A mask as written to cuttle.json. */
export type RawMask = Record<string, unknown> & { from: number; to: number; rect: Rect; auto?: string; enabled?: boolean; label?: string };

/** The frames of a screen-text.jsonl; none when it cannot be read. */
export async function readScreenText(path: string): Promise<ScreenTextFrame[] | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  return text === undefined ? undefined : parseScreenTextJsonl(text).frames;
}

/** How many of each kind, for people: "2 email addresses, 1 key". */
const NAMES: Record<SecretKind, [string, string]> = {
  email: ['email address', 'email addresses'],
  key: ['key', 'keys'],
  token: ['token in a link', 'tokens in links'],
  value: ['secret value', 'secret values'],
  iban: ['IBAN', 'IBANs'],
  card: ['card number', 'card numbers'],
  phone: ['phone number', 'phone numbers'],
  word: ['word you always mask', 'words you always mask'],
};

export interface PrivacyInput {
  /** The screen's text: without it, the privacy masks there stay as they are. */
  frames?: readonly ScreenTextFrame[];
  /** The take's events (its notification windows): without them, the notification masks stay. */
  events?: readonly InputEvent[];
  /** The screen's size, and the take's length (where a mask ends that nothing showed gone). */
  screen: { width: number; height: number; duration?: number };
  /** The words to mask (default the project's `privacy.words`). */
  words?: readonly string[];
}

export interface PrivacyMasksResult {
  masks: RawMask[];
  /** How many privacy masks Cuttle made, and of which kinds; how many notification masks. */
  made: number;
  kinds: Partial<Record<SecretKind, number>>;
  notifications: number;
  notes: string[];
}

const alike = (a: Rect, b: Rect) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  const inter = w > 0 && h > 0 ? w * h : 0;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter) >= 0.5;
};

/**
 * The project's masks with the privacy masks of `frames` (the words masked too) and the
 * notification masks of `events`. Cuttle's masks of a kind made here (`auto: "privacy"`,
 * `"notification"`) are made again; a new one that takes the place of one switched off (half its
 * time, its rect half alike) stays off; every other mask stays.
 */
export function withPrivacyMasks(raw: Record<string, unknown>, project: CuttleProject, input: PrivacyInput, taken = usedIds(raw)): PrivacyMasksResult {
  const old = (raw.masks as RawMask[] | undefined) ?? [];
  const { screen } = input;
  const staysOff = (auto: string, mask: { from: number; to: number; rect: Rect }) =>
    old.some((other) => {
      if (other.auto !== auto || other.enabled !== false) return false;
      const shared = Math.min(other.to, mask.to) - Math.max(other.from, mask.from);
      return shared >= 0.5 * Math.min(other.to - other.from, mask.to - mask.from) && alike(other.rect, mask.rect);
    });
  // A mask made the same as before keeps its id: a run that finds nothing new changes nothing.
  const reused = new Set<unknown>();
  const idFor = (auto: string, mask: { from: number; to: number; rect: Rect }) => {
    const same = old.find((other) => other.auto === auto && typeof other.id === 'string' && !reused.has(other.id) && other.from === mask.from && other.to === mask.to && other.rect.every((value, i) => value === mask.rect[i]));
    if (!same) return newId('masks', taken);
    reused.add(same.id);
    return same.id as string;
  };
  const made: PrivacyMask[] = input.frames ? privacyMasks(input.frames, input.words ?? project.privacy.words, screen, screen.duration) : [];
  const shown = input.events ? notificationMasks(input.events, screen, screen.duration) : [];
  const fresh: RawMask[] = [
    ...made.map((mask) => ({
      id: idFor('privacy', mask),
      label: mask.label,
      from: mask.from,
      to: mask.to,
      rect: mask.rect,
      ...(mask.moves && { moves: mask.moves }),
      style: 'fill',
      ...(staysOff('privacy', mask) && { enabled: false }),
      auto: 'privacy',
    })),
    ...shown.map((mask) => ({ id: idFor('notification', mask), label: 'Notification', from: mask.from, to: mask.to, rect: mask.rect, style: 'fill', ...(staysOff('notification', mask) && { enabled: false }), auto: 'notification' })),
  ];
  const replaced = new Set([...(input.frames ? ['privacy'] : []), ...(input.events ? ['notification'] : [])]);
  const kept = old.filter((mask) => mask.auto === undefined || !replaced.has(mask.auto));
  const kinds: Partial<Record<SecretKind, number>> = {};
  for (const mask of made) kinds[mask.kind] = (kinds[mask.kind] ?? 0) + 1;
  const notes: string[] = [];
  const stayOff = fresh.filter((mask) => mask.enabled === false).length;
  if (input.frames && made.length > 0) {
    const list = Object.entries(kinds).map(([kind, count]) => `${count} ${NAMES[kind as SecretKind][count === 1 ? 0 : 1]}`);
    notes.push(`masked ${made.length} private thing${made.length === 1 ? '' : 's'} the screen showed: ${list.join(', ')}`);
  } else if (input.frames) notes.push(`nothing private found in the screen's text (${input.frames.length} frame${input.frames.length === 1 ? '' : 's'} read)`);
  if (shown.length > 0) notes.push(`masked ${shown.length} notification${shown.length === 1 ? '' : 's'} while ${shown.length === 1 ? 'it was' : 'they were'} open`);
  if (stayOff > 0) notes.push(`${stayOff} mask${stayOff === 1 ? '' : 's'} you switched off stay${stayOff === 1 ? 's' : ''} off`);
  return { masks: [...kept, ...fresh].sort((a, b) => a.from - b.from), made: made.length, kinds, notifications: shown.length, notes };
}

/** The source stretches the project's clips show. */
const clipSpans = (project: CuttleProject) => union(project.scenes.flatMap((scene) => (scene.type === 'clip' ? [{ from: scene.from, to: scene.to }] : [])));

/**
 * Reads the screen's text inside the project's clips (`dir`: its folder) into its take's
 * screen-text.jsonl, not linked yet (`applyPrivacy` links it with the masks, in one write).
 */
export async function readScreenTake(dir: string, options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<{ path: string; frames: number; language: string }> {
  const file = await readProjectFile(dir);
  const screen = resolve(file.dir, file.project.sources.screen);
  const size = await probeScreen(screen);
  const times = await framesToRead(screen, clipSpans(file.project), size);
  const { frames, language } = await readFrames(screen, times, size, options);
  const path = join(dirname(screen), SCREEN_TEXT_FILE);
  writeScreenText(path, frames);
  return { path: relative(file.dir, path).split(sep).join('/'), frames: frames.length, language };
}

export interface PrivacyResult extends Omit<PrivacyMasksResult, 'masks'> {
  /** Whether cuttle.json was written (nothing changed: not written). */
  written: boolean;
}

/**
 * The privacy and notification masks of a project (`dir`: its folder), from the screen's text
 * (`link`, read by `readScreenTake`, linked as `sources.screenText` in the same write; else the one
 * linked) and the take's notifications. `words` are added to `privacy.words` (the app's "Always
 * mask"). Written only when something changed.
 */
export async function applyPrivacy(dir: string, options: { link?: string; words?: readonly string[] } = {}): Promise<PrivacyResult> {
  const file = await readProjectFile(dir);
  const { sources } = file.project;
  const linked = options.link ?? sources.screenText;
  const frames = linked ? await readScreenText(resolve(file.dir, linked)) : undefined;
  if (options.link && !frames) throw new CoreError('missing-file', `${options.link} cannot be read`);
  const text = sources.events ? await readFile(resolve(file.dir, sources.events), 'utf8').catch(() => undefined) : undefined;
  const events = text === undefined ? undefined : parseEventsJsonl(text).events;
  const size = await probeScreen(resolve(file.dir, sources.screen));
  const words = [...new Set([...file.project.privacy.words, ...(options.words ?? []).map((word) => word.trim()).filter(Boolean)])];
  const result = withPrivacyMasks(file.raw, file.project, { ...(frames && { frames }), ...(events && { events }), screen: size, words });
  const { masks: _masks, ...counts } = result;
  const linking = options.link !== undefined && options.link !== sources.screenText;
  const wordsAdded = words.length > file.project.privacy.words.length;
  const before = JSON.stringify((file.raw.masks as unknown[] | undefined) ?? []);
  if (!linking && !wordsAdded && JSON.stringify(result.masks) === before) return { ...counts, written: false };
  file.raw.masks = result.masks;
  if (linking) file.raw.sources = { ...(file.raw.sources as object), screenText: options.link };
  if (wordsAdded) file.raw.privacy = { ...(file.raw.privacy as object), words };
  await writeProjectFile(file, 'the privacy masks');
  return { ...counts, written: true };
}
```

In `packages/core/src/suggest.ts`, replace:

```ts
  cuts?: RawCut[];
  /** Where the speech came from: the transcript, the mic's loudness, or none; and the cuts made for it. */
  speech: { from: 'transcript' | 'mic' | 'none'; fillers: number; pauses: number; retakes: number };
  /** Whether the screen's text was there to mask from, and how many privacy masks were made. */
  privacy: { read: boolean; masks: number };
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
```

with:

```ts
  cuts?: RawCut[];
  /** Where the speech came from: the transcript, the mic's loudness, or none; and the cuts made for it. */
  speech: { from: 'transcript' | 'mic' | 'none'; fillers: number; pauses: number; retakes: number };
  /** Whether the screen's text was there to mask from, and how many privacy and notification masks were made. */
  privacy: { read: boolean; masks: number; notifications: number };
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
```

In the same file, replace:

```ts
  }

  // The privacy masks: what the screen showed that is private, from its text (read inside the new
  // clips where it was not yet) and the person's words.
  const words = [...new Set([...file.project.privacy.words, ...(args.maskWords ?? []).map((word) => word.trim()).filter(Boolean)])];
  let masks: RawMask[] | undefined;
  let privacy = { read: false, masks: 0 };
  if (args.privacy !== false && file.project.autoEdits.privacy) {
    const text = await screenTextFor(file.dir, screen, sources.screenText, clips, screenInfo, args, notes);
    if (text) {
      const result = withPrivacyMasks(file.raw, file.project, text.frames, screenInfo, words, taken);
      notes.push(...result.notes);
      masks = result.masks;
      privacy = { read: true, masks: result.made };
      if (text.made) file.raw.sources = { ...(file.raw.sources as object), screenText: text.made };
    }
  }

  const allZooms = [...kept, ...zooms].sort((a, b) => a.at - b.at);
```

with:

```ts
  }

  // The privacy masks: what the screen showed that is private, from its text (read inside the new
  // clips where it was not yet) and the person's words; and the notifications while they were open.
  const words = [...new Set([...file.project.privacy.words, ...(args.maskWords ?? []).map((word) => word.trim()).filter(Boolean)])];
  let masks: RawMask[] | undefined;
  let privacy = { read: false, masks: 0, notifications: 0 };
  if (args.privacy !== false && file.project.autoEdits.privacy) {
    const text = await screenTextFor(file.dir, screen, sources.screenText, clips, screenInfo, args, notes);
    const result = withPrivacyMasks(file.raw, file.project, { ...(text && { frames: text.frames }), events, screen: screenInfo, words }, taken);
    notes.push(...result.notes);
    masks = result.masks;
    privacy = { read: text !== undefined, masks: result.made, notifications: result.notifications };
    if (text?.made) file.raw.sources = { ...(file.raw.sources as object), screenText: text.made };
  }

  const allZooms = [...kept, ...zooms].sort((a, b) => a.at - b.at);
```

In `packages/core/src/index.ts`, replace:

```ts
export { MASK_RULES, privacyMasks, type PrivacyMask } from './privacy/masks';
export { ScreenReader } from './privacy/ocr';
export { READ_RULES, SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
export { readScreenText, withPrivacyMasks, type PrivacyMasksResult, type RawMask } from './privacy/apply';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
```

with:

```ts
export { MASK_RULES, privacyMasks, type PrivacyMask } from './privacy/masks';
export { ScreenReader } from './privacy/ocr';
export { READ_RULES, SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
export { applyPrivacy, readScreenTake, readScreenText, withPrivacyMasks, type PrivacyInput, type PrivacyMasksResult, type PrivacyResult, type RawMask } from './privacy/apply';
export { NOTIFICATION_RULES, notificationMasks, type NotificationMask } from './privacy/notifications';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/core/test/privacy-apply.test.ts packages/core/test/privacy-masks.test.ts packages/core/test/privacy-ocr.test.ts packages/core/test/suggest.test.ts apps/cli/test/cli.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core apps/cli/test/cli.test.ts
git commit -m "core: notification masks, and reading a take and its privacy masks as steps of their own

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The app's privacy step

**Files:**
- Create: `apps/desktop/src/main/privacy.ts`
- Modify: `apps/desktop/src/main/{settings,settings-window,speech,recording,windows,media-service,project-watch}.ts`, `apps/desktop/src/shared/{ipc,channels,media-jobs,take}.ts`, `apps/desktop/src/workers/media.ts`, `apps/desktop/test/{contract,project-watch}.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/test/contract.test.ts`, replace:

```ts
    expect(REQUESTS['project:info'].safeParse({ any: 1 }).success).toBe(false);
    expect(REQUESTS['speech:download'].safeParse('small').success).toBe(true);
    expect(REQUESTS['speech:download'].safeParse('../../evil').success).toBe(false);
  });

  it('names the speech models as @cuttle/core does (the windows cannot import it)', () => {
    expect(SPEECH_MODEL_NAMES).toEqual(MODEL_NAMES);
  });

  it('takes a transcript linked to the take for the same take', () => {
    const take = { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a' };
    expect(takeKey({ ...take, transcript: 'takes/1/transcript.json' })).toBe(takeKey(take));
    expect(takeKey({ ...take, mic: 'takes/2/mic.m4a' })).not.toBe(takeKey(take));
  });
});
```

with:

```ts
    expect(REQUESTS['project:info'].safeParse({ any: 1 }).success).toBe(false);
    expect(REQUESTS['speech:download'].safeParse('small').success).toBe(true);
    expect(REQUESTS['speech:download'].safeParse('../../evil').success).toBe(false);
    expect(REQUESTS['settings:set'].safeParse({ privacyRead: false, privacyWords: ['Lena Müller'] }).success).toBe(true);
    expect(REQUESTS['settings:set'].safeParse({ privacyWords: ['x'.repeat(121)] }).success).toBe(false);
    expect(REQUESTS['settings:set'].safeParse({ privacyWords: Array.from({ length: 51 }, (_, k) => `w${k}`) }).success).toBe(false);
  });

  it('names the speech models as @cuttle/core does (the windows cannot import it)', () => {
    expect(SPEECH_MODEL_NAMES).toEqual(MODEL_NAMES);
  });

  it("takes a transcript or the screen's text linked to the take for the same take", () => {
    const take = { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a' };
    expect(takeKey({ ...take, transcript: 'takes/1/transcript.json' })).toBe(takeKey(take));
    expect(takeKey({ ...take, screenText: 'takes/1/screen-text.jsonl' })).toBe(takeKey(take));
    expect(takeKey({ ...take, mic: 'takes/2/mic.m4a' })).not.toBe(takeKey(take));
  });
});
```

In `apps/desktop/test/project-watch.test.ts`, replace:

```ts
    await expect.poll(() => events.length, { timeout: 3000 }).toBe(1);
    expect(events[0]).toMatchObject({ hash: projectHash(bytes(version('Second'))), origin: 'outside' });
  }, 20_000);
});
```

with:

```ts
    await expect.poll(() => events.length, { timeout: 3000 }).toBe(1);
    expect(events[0]).toMatchObject({ hash: projectHash(bytes(version('Second'))), origin: 'outside' });
  }, 20_000);

  it('reports a change already on disk with its own origin when asked to look before the next is set', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cuttle-watch-'));
    writeFileSync(join(dir, 'cuttle.json'), bytes(version('Take')));
    const events: ProjectFileEvent[] = [];
    watch = new ProjectFileWatch(dir, (event) => events.push(event));
    watch.start(projectHash(bytes(version('Take'))));
    // the app's cut writes, and its privacy step follows within the watcher's pause
    watch.origin = 'suggest';
    writeFileSync(join(dir, 'cuttle.json'), bytes(version('Cut')));
    await watch.settle();
    watch.origin = 'privacy';
    expect(events).toEqual([expect.objectContaining({ hash: projectHash(bytes(version('Cut'))), origin: 'suggest' })]);
    // the watcher's own look comes later and finds nothing new; the privacy masks are the next change
    await pause(400);
    expect(events).toHaveLength(1);
    writeFileSync(join(dir, 'cuttle.json'), bytes(version('Masked')));
    await expect.poll(() => events.length, { timeout: 3000 }).toBe(2);
    expect(events[1]).toMatchObject({ origin: 'privacy' });
  });
});
```

Run: `pnpm exec vitest run --project node apps/desktop/test/contract.test.ts apps/desktop/test/project-watch.test.ts`
Expected: FAIL: `settings:set` has no privacy fields, a linked `screenText` makes another take, and the watch has no `settle`.

- [ ] **Step 2: The settings, the requests and the jobs**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
  text?: string;
  /** `working`: cutting the take or transcribing it (a spinner); `failed`: it could not (Try again); `recording`: a new take records (the player pauses). */
  state?: 'working' | 'failed' | 'recording';
  /** What Try again does after a failure: cut the take again (the default), or transcribe it again. */
  retry?: 'cut' | 'speech';
}

/** The speech models (as @cuttle/core's MODEL_NAMES; a contract test keeps them alike). */
```

with:

```ts
  text?: string;
  /** `working`: cutting the take or transcribing it (a spinner); `failed`: it could not (Try again); `recording`: a new take records (the player pauses). */
  state?: 'working' | 'failed' | 'recording';
  /** What Try again does after a failure: cut the take again (the default), transcribe it again, or read the screen again. */
  retry?: 'cut' | 'speech' | 'privacy';
}

/** The speech models (as @cuttle/core's MODEL_NAMES; a contract test keeps them alike). */
```

In the same file, replace:

```ts
  pathLine?: string;
}

/** How motion is set: the OS's "reduce motion", or always on, or always off. */
export const MOTIONS = ['system', 'reduce', 'full'] as const;
export type Motion = (typeof MOTIONS)[number];
```

with:

```ts
  pathLine?: string;
}

/** The words always masked (the settings' "Always mask"): how long each, and how many. */
export const PRIVACY_WORD_MAX = 120;
export const PRIVACY_WORDS_MAX = 50;

/** How motion is set: the OS's "reduce motion", or always on, or always off. */
export const MOTIONS = ['system', 'reduce', 'full'] as const;
export type Motion = (typeof MOTIONS)[number];
```

In the same file, replace:

```ts
  motion: Motion;
  /** Transcribing a take after its cut: the model (or off) and the language spoken. */
  speech: { model: SpeechModelName | 'off'; language: SpeechLanguage };
  /** `open`: the project is open in Cuttle, here (`here`) or on the computer named. */
  recent: { dir: string; name: string; opened: number; open?: string }[];
  version: string;
```

with:

```ts
  motion: Motion;
  /** Transcribing a take after its cut: the model (or off) and the language spoken. */
  speech: { model: SpeechModelName | 'off'; language: SpeechLanguage };
  /** After a take's cut: read the screen's text to mask what it showed, and the words always masked. */
  privacy: { read: boolean; words: string[] };
  /** `open`: the project is open in Cuttle, here (`here`) or on the computer named. */
  recent: { dir: string; name: string; opened: number; open?: string }[];
  version: string;
```

In the same file, replace:

```ts
    motion: z.enum(MOTIONS).optional(),
    speechModel: z.enum(['off', ...SPEECH_MODEL_NAMES]).optional(),
    speechLanguage: z.enum(SPEECH_LANGUAGES).optional(),
  }),
  /** Asks for the projects folder (a folder dialog) and keeps it. */
  'settings:choose-folder': z.undefined(),
```

with:

```ts
    motion: z.enum(MOTIONS).optional(),
    speechModel: z.enum(['off', ...SPEECH_MODEL_NAMES]).optional(),
    speechLanguage: z.enum(SPEECH_LANGUAGES).optional(),
    privacyRead: z.boolean().optional(),
    privacyWords: z.array(z.string().trim().min(1).max(PRIVACY_WORD_MAX)).max(PRIVACY_WORDS_MAX).optional(),
  }),
  /** Asks for the projects folder (a folder dialog) and keeps it. */
  'settings:choose-folder': z.undefined(),
```

In the same file, replace:

```ts
  'speech:download': z.enum(SPEECH_MODEL_NAMES),
  'speech:cancel': z.undefined(),
  'speech:remove': z.enum(SPEECH_MODEL_NAMES),
} as const;

export type Request = keyof typeof REQUESTS;
```

with:

```ts
  'speech:download': z.enum(SPEECH_MODEL_NAMES),
  'speech:cancel': z.undefined(),
  'speech:remove': z.enum(SPEECH_MODEL_NAMES),
  /** Reads the screen's text of the project's take again and masks what it showed (the Auto tab, Try again). */
  'project:read-screen': z.undefined(),
} as const;

export type Request = keyof typeof REQUESTS;
```

In the same file, replace:

```ts
  'speech:download': SpeechStatus;
  'speech:cancel': void;
  'speech:remove': SpeechStatus;
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
```

with:

```ts
  'speech:download': SpeechStatus;
  'speech:cancel': void;
  'speech:remove': SpeechStatus;
  /** Started (the title bar shows it), or why not. */
  'project:read-screen': { started: true } | { problem: string };
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
```

In the same file, replace:

```ts

/**
 * cuttle.json changed on disk, not by this window: a new version (`origin`: `suggest` when the app's
 * own suggest cut the take, `speech` when the app cut its filler words and pauses, else another
 * program, Claude or the CLI), or one that does not parse.
 */
export type ProjectFileEvent = (ProjectVersion & { origin: ChangeOrigin }) | { issues: string[] };

/** Who changed cuttle.json outside the editor: another program, or the app's own cut or speech edits. */
export type ChangeOrigin = 'outside' | 'suggest' | 'speech';

/** Events (main → window). */
export interface Events {
```

with:

```ts

/**
 * cuttle.json changed on disk, not by this window: a new version (`origin`: `suggest` when the app's
 * own suggest cut the take, `speech` when the app cut its filler words and pauses, `privacy` when it
 * masked what the screen showed, else another
 * program, Claude or the CLI), or one that does not parse.
 */
export type ProjectFileEvent = (ProjectVersion & { origin: ChangeOrigin }) | { issues: string[] };

/** Who changed cuttle.json outside the editor: another program, or the app's own cut, speech edits or privacy masks. */
export type ChangeOrigin = 'outside' | 'suggest' | 'speech' | 'privacy';

/** Events (main → window). */
export interface Events {
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
      'project:takes',
      'project:cut',
      'project:transcribe',
      'project:save',
      'project:import-image',
      'project:draft',
```

with:

```ts
      'project:takes',
      'project:cut',
      'project:transcribe',
      'project:read-screen',
      'project:save',
      'project:import-image',
      'project:draft',
```

In `apps/desktop/src/shared/take.ts`, replace:

```ts
/**
 * The take a project's `sources` name, as a key: its tracks, not what was made from them. A
 * transcript or a cleaned-up mic linked to the take is not another take (the editor and its media stay).
 */
export function takeKey(sources: unknown): string {
  if (sources === null || typeof sources !== 'object') return JSON.stringify(sources);
  const { transcript: _made, cleanMic: _cleaned, ...tracks } = sources as Record<string, unknown>;
  return JSON.stringify(tracks);
}
```

with:

```ts
/**
 * The take a project's `sources` name, as a key: its tracks, not what was made from them. A
 * transcript, a cleaned-up mic or the screen's text linked to the take is not another take (the
 * editor and its media stay).
 */
export function takeKey(sources: unknown): string {
  if (sources === null || typeof sources !== 'object') return JSON.stringify(sources);
  const { transcript: _made, cleanMic: _cleaned, screenText: _read, ...tracks } = sources as Record<string, unknown>;
  return JSON.stringify(tracks);
}
```

In `apps/desktop/src/shared/media-jobs.ts`, replace:

```ts
  cleanMic?: string;
}

export type MediaJob = ProxyJob | ThumbnailsJob | PeaksJob | SuggestJob | TranscribeJob | SpeechEditsJob;

export interface ThumbnailsMeta {
  interval: number;
```

with:

```ts
  cleanMic?: string;
}

/** Reads the screen's text inside a project's clips (`input`: its folder) into its take's screen-text.jsonl, not linked yet. */
export interface ReadScreenJob {
  job: 'read-screen';
  input: string;
  output: string;
}

/** Links `link` (the screen's text just read) and masks what the screen showed and the notifications, in one write. */
export interface PrivacyEditsJob {
  job: 'privacy-edits';
  input: string;
  output: string;
  link?: string;
  /** The settings' "Always mask", added to the project's words. */
  words: string[];
}

export type MediaJob = ProxyJob | ThumbnailsJob | PeaksJob | SuggestJob | TranscribeJob | SpeechEditsJob | ReadScreenJob | PrivacyEditsJob;

export interface ThumbnailsMeta {
  interval: number;
```

In the same file, replace:

```ts
export type WorkerReply =
  | { id: number; progress: number }
  | { id: number; done: true; meta?: ThumbnailsMeta }
  | { id: number; error: string; cancelled?: boolean };

/** Height of the proxy (the screen track is scaled down to it, never up). */
export const PROXY_HEIGHT = 720;
```

with:

```ts
export type WorkerReply =
  | { id: number; progress: number }
  | { id: number; done: true; meta?: ThumbnailsMeta }
  | { id: number; error: string; cancelled?: boolean; code?: string };

/** Height of the proxy (the screen track is scaled down to it, never up). */
export const PROXY_HEIGHT = 720;
```

In `apps/desktop/src/workers/media.ts`, replace:

```ts
// the main process queues them.
import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { applySpeechEdits, ffmpegPath, probeScreen, streamSeconds, suggestProject, transcribeTake } from '@cuttle/core';
import {
  PEAKS_SAMPLE_RATE,
  PeakFolder,
```

with:

```ts
// the main process queues them.
import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { applyPrivacy, applySpeechEdits, ffmpegPath, probeScreen, readScreenTake, streamSeconds, suggestProject, transcribeTake } from '@cuttle/core';
import {
  PEAKS_SAMPLE_RATE,
  PeakFolder,
```

In the same file, replace:

```ts
      await applySpeechEdits(job.input, { link: job.transcript, ...(job.cleanMic && { cleanMic: job.cleanMic }) });
      return undefined;
    }
    case 'peaks': {
      const seconds = await streamSeconds(job.input, 'a');
      const folder = new PeakFolder();
```

with:

```ts
      await applySpeechEdits(job.input, { link: job.transcript, ...(job.cleanMic && { cleanMic: job.cleanMic }) });
      return undefined;
    }
    case 'read-screen': {
      const controller = new AbortController();
      controllers.set(id, controller);
      try {
        await readScreenTake(job.input, { signal: controller.signal, onProgress: (progress) => reply({ id, progress }) });
      } finally {
        controllers.delete(id);
      }
      return undefined;
    }
    case 'privacy-edits': {
      await applyPrivacy(job.input, { ...(job.link && { link: job.link }), words: job.words });
      return undefined;
    }
    case 'peaks': {
      const seconds = await streamSeconds(job.input, 'a');
      const folder = new PeakFolder();
```

In the same file, replace:

```ts
  const { id, ...job } = data;
  run(id, job as MediaJob).then(
    (meta) => reply({ id, done: true, ...(meta && { meta }) }),
    (error: Error) => reply({ id, error: error.message, ...(cancelled.has(id) && { cancelled: true }) }),
  );
});
```

with:

```ts
  const { id, ...job } = data;
  run(id, job as MediaJob).then(
    (meta) => reply({ id, done: true, ...(meta && { meta }) }),
    // the core's error code too (`ocr-missing`: the screen cannot be read here)
    (error: Error & { code?: unknown }) => reply({ id, error: error.message, ...(cancelled.has(id) && { cancelled: true }), ...(typeof error.code === 'string' && { code: error.code }) }),
  );
});
```

In `apps/desktop/src/main/media-service.ts`, replace:

```ts
      if ('progress' in message) return job.onProgress(message.progress);
      this.finish(message.id);
      if ('done' in message) job.resolve(message.meta);
      else job.reject(Object.assign(new Error(message.error), { cancelled: message.cancelled === true }));
    });
    child.on('exit', () => {
      // a worker let go by refresh(): the new one's jobs are not its own
```

with:

```ts
      if ('progress' in message) return job.onProgress(message.progress);
      this.finish(message.id);
      if ('done' in message) job.resolve(message.meta);
      else job.reject(Object.assign(new Error(message.error), { cancelled: message.cancelled === true, ...(message.code && { code: message.code }) }));
    });
    child.on('exit', () => {
      // a worker let go by refresh(): the new one's jobs are not its own
```

In `apps/desktop/src/main/settings.ts`, replace:

```ts
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import { z } from 'zod';
import { MOTIONS, SPEECH_LANGUAGES, SPEECH_MODEL_NAMES, type Motion, type SettingsView } from '../shared/ipc';

const RECENT_MAX = 10;
```

with:

```ts
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import { z } from 'zod';
import { MOTIONS, PRIVACY_WORD_MAX, PRIVACY_WORDS_MAX, SPEECH_LANGUAGES, SPEECH_MODEL_NAMES, type Motion, type SettingsView } from '../shared/ipc';

const RECENT_MAX = 10;
```

In the same file, replace:

```ts
    })
    .catch({ model: 'small' as const, language: 'auto' as const })
    .default({ model: 'small' as const, language: 'auto' as const }),
  /** The picker bar's choices, kept between recordings (the camera and mic are the defaults in the settings). */
  record: z
    .object({ camera: z.string().optional(), mic: z.string().optional(), stop: z.enum(['none', 'claude', 'idle']).default('none'), claudeFolder: z.string().optional() })
```

with:

```ts
    })
    .catch({ model: 'small' as const, language: 'auto' as const })
    .default({ model: 'small' as const, language: 'auto' as const }),
  /** The privacy step after a take's cut: read the screen's text (Windows' OCR) to mask what it showed, and the words always masked. */
  privacy: z
    .object({
      read: z.boolean().catch(true).default(true),
      words: z.array(z.string().trim().min(1).max(PRIVACY_WORD_MAX)).max(PRIVACY_WORDS_MAX).catch([]).default([]),
    })
    .catch({ read: true, words: [] })
    .default({ read: true, words: [] }),
  /** The picker bar's choices, kept between recordings (the camera and mic are the defaults in the settings). */
  record: z
    .object({ camera: z.string().optional(), mic: z.string().optional(), stop: z.enum(['none', 'claude', 'idle']).default('none'), claudeFolder: z.string().optional() })
```

In the same file, replace:

```ts
    launchAtLogin: settings.launchAtLogin,
    motion: settings.motion,
    speech: { ...settings.speech },
    recent: settings.recent,
    version: appVersion(),
  };
```

with:

```ts
    launchAtLogin: settings.launchAtLogin,
    motion: settings.motion,
    speech: { ...settings.speech },
    privacy: { read: settings.privacy.read, words: [...settings.privacy.words] },
    recent: settings.recent,
    version: appVersion(),
  };
```

In `apps/desktop/src/main/settings-window.ts`, replace:

```ts
        if (change.motion !== undefined) settings.motion = change.motion;
        if (change.speechModel !== undefined) settings.speech.model = change.speechModel;
        if (change.speechLanguage !== undefined) settings.speech.language = change.speechLanguage;
      });
      if (change.launchAtLogin !== undefined) applyLoginItem(change.launchAtLogin);
      if (change.motion !== undefined) broadcastMotion(change.motion);
```

with:

```ts
        if (change.motion !== undefined) settings.motion = change.motion;
        if (change.speechModel !== undefined) settings.speech.model = change.speechModel;
        if (change.speechLanguage !== undefined) settings.speech.language = change.speechLanguage;
        if (change.privacyRead !== undefined) settings.privacy.read = change.privacyRead;
        // each word once, as it was first written
        if (change.privacyWords !== undefined) settings.privacy.words = change.privacyWords.filter((word, k, all) => all.findIndex((other) => other.toLowerCase() === word.toLowerCase()) === k);
      });
      if (change.launchAtLogin !== undefined) applyLoginItem(change.launchAtLogin);
      if (change.motion !== undefined) broadcastMotion(change.motion);
```

- [ ] **Step 3: The step, after the speech step**

In `apps/desktop/src/main/speech.ts`, replace:

```ts

/** Projects being transcribed now (their folders, as given). */
const transcribing = new Set<string>();

/**
 * Transcribes the project's mic after its cut and cuts its retakes, filler words and pauses, when
```

with:

```ts

/** Projects being transcribed now (their folders, as given). */
const transcribing = new Set<string>();
/** Who waits for a project's speech step to end (its privacy step comes after it: one write at a time, each its own step to undo). */
const waiting = new Map<string, (() => void)[]>();

/** Resolves once the project's speech step, if one runs, has ended. */
export function speechDone(dir: string): Promise<void> {
  if (!transcribing.has(dir)) return Promise.resolve();
  return new Promise((resolve) => waiting.set(dir, [...(waiting.get(dir) ?? []), resolve]));
}

/**
 * Transcribes the project's mic after its cut and cuts its retakes, filler words and pauses, when
```

In the same file, replace:

```ts
      await setEditorStatus(dir, cancelled ? undefined : { text: `The speech could not be transcribed: ${(error as Error).message.split('\n')[0]}`, state: 'failed', retry: 'speech' });
    } finally {
      transcribing.delete(dir);
    }
  })();
  return { started: true };
```

with:

```ts
      await setEditorStatus(dir, cancelled ? undefined : { text: `The speech could not be transcribed: ${(error as Error).message.split('\n')[0]}`, state: 'failed', retry: 'speech' });
    } finally {
      transcribing.delete(dir);
      for (const resolve of waiting.get(dir) ?? []) resolve();
      waiting.delete(dir);
    }
  })();
  return { started: true };
```

In `apps/desktop/src/main/project-watch.ts`, replace:

```ts
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The last version reported did not parse: the next that does is reported even when known (a fix back to it). */
  private broken = false;
  /** Who the next outside change comes from: the app's own suggest while it cuts a take, or its speech edits. */
  origin: ChangeOrigin = 'outside';
  /**
   * Looks and saves, one at a time: a look that read the file while a save replaced it would take
```

with:

```ts
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The last version reported did not parse: the next that does is reported even when known (a fix back to it). */
  private broken = false;
  /** Who the next outside change comes from: the app's own suggest while it cuts a take, its speech edits or its privacy masks. */
  origin: ChangeOrigin = 'outside';
  /**
   * Looks and saves, one at a time: a look that read the file while a save replaced it would take
```

In the same file, replace:

```ts
    }
  }

  /** A save is a write followed by a rename: look once things have settled. */
  private schedule(): void {
    clearTimeout(this.timer);
```

with:

```ts
    }
  }

  /**
   * Looks now, not after the pause: a change already on disk is reported with the origin set for
   * it, before another is set (the app's privacy step can follow its cut within the pause).
   */
  settle(): Promise<void> {
    clearTimeout(this.timer);
    return this.serial(() => this.check());
  }

  /** A save is a write followed by a rename: look once things have settled. */
  private schedule(): void {
    clearTimeout(this.timer);
```

`apps/desktop/src/main/privacy.ts`:

```ts
// Privacy in the app: after a take's cut and its speech step, the screen's text is read inside the
// clips (Windows' own OCR, in the media worker), then what it showed that is private and the
// notifications are masked, as one step to undo ("Cuttle's privacy masks").
import { dirname, join, relative, resolve, sep } from 'node:path';
import { SCREEN_TEXT_FILE, readProjectFile } from '@cuttle/core';
import { mediaWorker } from './media-service';
import { loadSettings } from './settings';
import { speechDone } from './speech';
import { expectPrivacy, sendToEditor, setEditorStatus } from './windows';

/** Whether this system can read the screen's text (Windows' own OCR); elsewhere it is tried only when asked, which says why not. */
const CAN_READ = process.platform === 'win32';
/** Projects whose privacy step runs now (their folders, as given). */
const masking = new Set<string>();
/** Said once per run of the app: the screen's text cannot be read here. */
let toldMissing = false;

/** The SHA-256 of cuttle.json as it is now (undefined: it cannot be read). */
const hashOf = async (dir: string) => (await readProjectFile(dir).catch(() => undefined))?.hash;

/**
 * Masks what the project's screen showed that is private, and the notifications, once its speech
 * step has ended (one write at a time, each its own step to undo): the screen's text is read
 * inside the clips first when reading is on in the settings and the take was not read yet. Without
 * Windows' OCR the notifications are masked all the same, and a note says why the screen was not
 * read (once per run of the app, or when asked). The editor's title bar shows the progress.
 * `asked`: the person asked for it (the Auto tab, Try again): the screen is read again.
 */
export async function maskPrivacy(dir: string, asked = false): Promise<{ started: true } | { problem: string }> {
  if (masking.has(dir)) return { started: true };
  masking.add(dir);
  const first = await readProjectFile(dir).catch(() => undefined);
  const problem = !first ? 'cuttle.json cannot be read.' : !first.project.autoEdits.privacy ? 'Masking private things is switched off: switch it on first.' : undefined;
  if (problem) {
    masking.delete(dir);
    return { problem };
  }
  void (async () => {
    const status = (progress: number) => setEditorStatus(dir, { text: `Reading the screen… ${Math.round(progress * 100)} %`, state: 'working' });
    try {
      await speechDone(dir);
      const file = await readProjectFile(dir);
      const { privacy } = await loadSettings();
      let link: string | undefined;
      // only reading takes long enough to show: masking the notifications alone shows nothing until it arrives
      const read = asked || (CAN_READ && privacy.read && file.project.sources.screenText === undefined);
      if (read) {
        try {
          await status(0);
          await mediaWorker.run({ job: 'read-screen', input: dir, output: '' }, (progress) => void status(progress)).promise;
          link = relative(file.dir, join(dirname(resolve(file.dir, file.project.sources.screen)), SCREEN_TEXT_FILE)).split(sep).join('/');
        } catch (error) {
          if ((error as { code?: string }).code !== 'ocr-missing') throw error;
          if (asked || !toldMissing) await sendToEditor(dir, 'project:note', { text: `Cuttle could not read the screen: ${(error as Error).message}. Look for private things yourself.` });
          toldMissing = true;
        }
      }
      if (read) await setEditorStatus(dir, { text: 'Masking private things…', state: 'working' });
      const before = await hashOf(dir);
      await expectPrivacy(dir, true);
      try {
        await mediaWorker.run({ job: 'privacy-edits', input: dir, output: '', ...(link && { link }), words: privacy.words }, () => {}).promise;
      } finally {
        // nothing was written (nothing new, or it failed): the next outside change is someone else's
        if ((await hashOf(dir)) === before) await expectPrivacy(dir, false);
      }
      if (read) await setEditorStatus(dir, undefined);
    } catch (error) {
      const cancelled = (error as { cancelled?: boolean }).cancelled === true;
      await setEditorStatus(dir, cancelled ? undefined : { text: `The screen could not be read: ${(error as Error).message.split('\n')[0]}`, state: 'failed', retry: 'privacy' });
    } finally {
      masking.delete(dir);
    }
  })();
  return { started: true };
}
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
import { deletableTakes, sizeText, trashName } from '../shared/takes';
import { addRecent, loadSettings, motionSetting, updateSettings } from './settings';
import { openSettings } from './settings-window';
import { transcribeProject } from './speech';

const BACKGROUND = '#0c0c0f';
```

with:

```ts
import { deletableTakes, sizeText, trashName } from '../shared/takes';
import { addRecent, loadSettings, motionSetting, updateSettings } from './settings';
import { openSettings } from './settings-window';
import { maskPrivacy } from './privacy';
import { transcribeProject } from './speech';

const BACKGROUND = '#0c0c0f';
```

In the same file, replace:

```ts
    'project:takes': () => takesMenu(dir, window),
    'project:cut': () => void recut(dir),
    'project:transcribe': () => transcribeProject(dir, true),
    'project:undo-restart': (discarded) => void undoRestart(dir, discarded),
    'app:settings': () => void openSettings(),
    'project:save': ({ raw, base }) => editor.watch.save(raw, base),
```

with:

```ts
    'project:takes': () => takesMenu(dir, window),
    'project:cut': () => void recut(dir),
    'project:transcribe': () => transcribeProject(dir, true),
    'project:read-screen': () => maskPrivacy(dir, true),
    'project:undo-restart': (discarded) => void undoRestart(dir, discarded),
    'app:settings': () => void openSettings(),
    'project:save': ({ raw, base }) => editor.watch.save(raw, base),
```

In the same file, replace:

```ts
  if (editor) editor.watch.origin = expecting ? 'speech' : 'outside';
}

/** The window of a project's open editor, if there is one. */
export async function editorWindowOf(dir: string): Promise<BrowserWindow | undefined> {
  const editor = await editorOf(dir);
```

with:

```ts
  if (editor) editor.watch.origin = expecting ? 'speech' : 'outside';
}

/** The next outside change of the project comes from the app's own privacy masks ("Cuttle's privacy masks"). */
export async function expectPrivacy(dir: string, expecting: boolean): Promise<void> {
  const editor = await editorOf(dir);
  if (!editor) return;
  // the cut's write may still wait for the watcher's look: it keeps its own origin
  if (expecting) await editor.watch.settle();
  editor.watch.origin = expecting ? 'privacy' : 'outside';
}

/** The window of a project's open editor, if there is one. */
export async function editorWindowOf(dir: string): Promise<BrowserWindow | undefined> {
  const editor = await editorOf(dir);
```

In `apps/desktop/src/main/recording.ts`, replace:

```ts
import { recorderHost, RecordingError } from './recorder-host';
import { findFfmpeg } from './tools';
import { loadSettings, updateSettings } from './settings';
import { transcribeProject } from './speech';
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, sendToEditor, setEditorStatus, showPill, webPreferences } from './windows';
```

with:

```ts
import { recorderHost, RecordingError } from './recorder-host';
import { findFfmpeg } from './tools';
import { loadSettings, updateSettings } from './settings';
import { maskPrivacy } from './privacy';
import { transcribeProject } from './speech';
import { editorWindowOf, expectSuggest, guard, hidePill, reopenEditor, sendToEditor, setEditorStatus, showPill, webPreferences } from './windows';
```

In the same file, replace:

```ts
    return;
  }
  await setEditorStatus(dir, undefined);
  // then what was said: transcribed, its filler words and pauses cut (a step of its own)
  await transcribeProject(dir);
}

/** "Try again" in the editor after a failed cut. */
```

with:

```ts
    return;
  }
  await setEditorStatus(dir, undefined);
  // then what was said: transcribed, its filler words and pauses cut (a step of its own); then what
  // the screen showed: its private things and the notifications masked (a step of its own, after it)
  await transcribeProject(dir);
  await maskPrivacy(dir);
}

/** "Try again" in the editor after a failed cut. */
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node apps/desktop/test/contract.test.ts apps/desktop/test/project-watch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main apps/desktop/src/shared apps/desktop/src/workers apps/desktop/test/contract.test.ts apps/desktop/test/project-watch.test.ts
git commit -m "desktop: the app reads the screen after the speech step and masks what it showed, as one step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: In the windows

**Files:**
- Create: `apps/desktop/src/renderer/editor/PrivacyNote.tsx`, `apps/desktop/src/renderer/settings/PrivacySettings.tsx`
- Modify: `apps/desktop/src/renderer/editor/{App,Inspector}.tsx`, `apps/desktop/src/renderer/editor/doc.ts`, `apps/desktop/src/renderer/settings/Settings.tsx`, `apps/desktop/src/renderer/settings/settings.css`

- [ ] **Step 1: The editor: Try again reads again, the toast, the Auto tab's note**

In `apps/desktop/src/renderer/editor/App.tsx`, replace:

```
      {status?.state === 'failed' ? (
        <button
          className="chip-status warn"
          onClick={() => void bridge.invoke(status.retry === 'speech' ? 'project:transcribe' : 'project:cut')}
          title={`${status.text}. Click to try again.`}
          data-testid="project-status"
        >
          <WarningIcon size={14} />
          <span className="chip-text">{status.retry === 'speech' ? 'The speech could not be transcribed' : 'The take could not be cut'}</span> · Try again
        </button>
      ) : (
        status && (
```

with:

```
      {status?.state === 'failed' ? (
        <button
          className="chip-status warn"
          onClick={() => void bridge.invoke(status.retry === 'speech' ? 'project:transcribe' : status.retry === 'privacy' ? 'project:read-screen' : 'project:cut')}
          title={`${status.text}. Click to try again.`}
          data-testid="project-status"
        >
          <WarningIcon size={14} />
          <span className="chip-text">{status.retry === 'speech' ? 'The speech could not be transcribed' : status.retry === 'privacy' ? 'The screen could not be read' : 'The take could not be cut'}</span> · Try again
        </button>
      ) : (
        status && (
```

In `apps/desktop/src/renderer/editor/doc.ts`, replace:

```ts
const sourcesOf = (raw: Raw) => takeKey(raw.sources);

/** The undo step of a change made outside the editor, by who made it. */
const ORIGIN_LABELS: Record<ChangeOrigin, string> = { outside: 'the outside change', suggest: "Cuttle's cut", speech: "Cuttle's speech edits" };

/** What the app's speech edits did, said once they arrive. */
function speechToast(project: CuttleProject): string {
```

with:

```ts
const sourcesOf = (raw: Raw) => takeKey(raw.sources);

/** The undo step of a change made outside the editor, by who made it. */
const ORIGIN_LABELS: Record<ChangeOrigin, string> = { outside: 'the outside change', suggest: "Cuttle's cut", speech: "Cuttle's speech edits", privacy: "Cuttle's privacy masks" };

/** What the app's speech edits did, said once they arrive. */
function speechToast(project: CuttleProject): string {
```

In the same file, replace:

```ts
  return `Cuttle cut ${slips ? `${slips}, and ` : ''}${parts.join(' and ')} where the picture rests.`;
}

/** The editor opens anew on another take (its media); the main process reloads it (a page cannot). */
function reloadForTake(): void {
  void bridge.invoke('project:reload');
```

with:

```ts
  return `Cuttle cut ${slips ? `${slips}, and ` : ''}${parts.join(' and ')} where the picture rests.`;
}

/** What the app's privacy masks did, said once they arrive. */
function privacyToast(project: CuttleProject): string {
  const count = (kind: 'privacy' | 'notification') => project.masks.filter((mask) => mask.auto === kind && mask.enabled).length;
  const found = count('privacy');
  const notifications = count('notification');
  if (found + notifications === 0) return 'Cuttle read the screen: nothing private to mask.';
  const parts = [found > 0 && `${found} private thing${found === 1 ? '' : 's'} the screen showed`, notifications > 0 && `${notifications} notification${notifications === 1 ? '' : 's'}`].filter(Boolean);
  return `Cuttle masked ${parts.join(' and ')}: check them in the Auto tab.`;
}

/** The editor opens anew on another take (its media); the main process reloads it (a page cannot). */
function reloadForTake(): void {
  void bridge.invoke('project:reload');
```

In the same file, replace:

```ts
  redoStack.length = 0;
  setDoc({ raw, project, hash: event.hash, preview: undefined });
  const show = firstChanged(before.project, project);
  const said = event.origin === 'suggest' ? 'Cuttle cut the take.' : event.origin === 'speech' ? speechToast(project) : `Changed outside the app: ${describeChange(before.project, project)}`;
  toast(said, { undo: true, ...(show && event.origin === 'outside' && { show }) });
}
```

with:

```ts
  redoStack.length = 0;
  setDoc({ raw, project, hash: event.hash, preview: undefined });
  const show = firstChanged(before.project, project);
  const said =
    event.origin === 'suggest'
      ? 'Cuttle cut the take.'
      : event.origin === 'speech'
        ? speechToast(project)
        : event.origin === 'privacy'
          ? privacyToast(project)
          : `Changed outside the app: ${describeChange(before.project, project)}`;
  toast(said, { undo: true, ...(show && event.origin === 'outside' && { show }) });
}
```

`apps/desktop/src/renderer/editor/PrivacyNote.tsx`:

```
// The Auto tab's note while the take's screen was not read: once it is (Windows' own OCR), Cuttle
// masks the private things it showed. A button reads it now.
import { useState } from 'react';
import { bridge } from '../bridge';
import { store } from './session';
import { useStore } from './store';

/** Only Windows reads the screen's text for now. */
const READS_SCREEN = navigator.userAgent.includes('Windows');

export function PrivacyNote() {
  const read = useStore(store, (state) => state.doc?.project.sources.screenText !== undefined);
  const on = useStore(store, (state) => state.doc?.project.autoEdits.privacy === true);
  const working = useStore(store, (state) => state.status?.state === 'working');
  const [problem, setProblem] = useState<string>();
  if (!READS_SCREEN || read || !on) return null;
  const readScreen = async () => {
    const answer = await bridge.invoke('project:read-screen');
    setProblem('problem' in answer ? answer.problem : undefined);
  };
  return (
    <div className="speech-note" data-testid="privacy-note">
      <p>
        <b>The screen is not read.</b> Once it is, Cuttle masks the email addresses, keys and other private things it shows.
      </p>
      {problem && (
        <p className="speech-problem" role="alert" data-testid="privacy-problem">
          {problem}
        </p>
      )}
      <div className="speech-actions">
        <button type="button" className="ghost small" disabled={working} onClick={() => void readScreen()} data-testid="read-screen">
          {working ? 'Busy…' : 'Read the screen'}
        </button>
      </div>
    </div>
  );
}
```

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```
import { currentPlayer, engineAssets, select, setTool, store, type Selection, type Tool } from './session';
import { isColoured, swatch, type SwatchKey } from './swatches';
import { useStore } from './store';
import { SpeechNote, TranscriptPanel } from './Transcript';

const TABS = [
```

with:

```
import { currentPlayer, engineAssets, select, setTool, store, type Selection, type Tool } from './session';
import { isColoured, swatch, type SwatchKey } from './swatches';
import { useStore } from './store';
import { PrivacyNote } from './PrivacyNote';
import { SpeechNote, TranscriptPanel } from './Transcript';

const TABS = [
```

In the same file, replace:

```
    return (
      <div className="auto-empty" data-testid="auto-empty">
        <SpeechNote />
        <p>
          <b>Nothing automatic yet.</b>
        </p>
```

with:

```
    return (
      <div className="auto-empty" data-testid="auto-empty">
        <SpeechNote />
        <PrivacyNote />
        <p>
          <b>Nothing automatic yet.</b>
        </p>
```

In the same file, replace:

```
    <div className="auto-panel" data-testid="auto-panel">
      <p className="hint auto-intro">What Cuttle did on its own. Switch a kind off and it leaves the video and is not made again; change an item and it is yours.</p>
      <SpeechNote />
      {groups.map(({ group, items }) => {
        const on = items.filter((item) => item.enabled).length;
        const kindOn = group.key ? project.autoEdits[group.key] : on > 0;
```

with:

```
    <div className="auto-panel" data-testid="auto-panel">
      <p className="hint auto-intro">What Cuttle did on its own. Switch a kind off and it leaves the video and is not made again; change an item and it is yours.</p>
      <SpeechNote />
      <PrivacyNote />
      {groups.map(({ group, items }) => {
        const on = items.filter((item) => item.enabled).length;
        const kindOn = group.key ? project.autoEdits[group.key] : on > 0;
```

- [ ] **Step 2: The settings' Privacy section**

`apps/desktop/src/renderer/settings/PrivacySettings.tsx`:

```
// The settings' privacy part: whether a new take's screen is read (Windows' own OCR, on this
// computer) to mask the private things it shows, and the words always masked.
import { useState } from 'react';
import { PRIVACY_WORD_MAX, PRIVACY_WORDS_MAX, type RequestArgument, type SettingsView } from '../../shared/ipc';
import { CloseIcon } from '../icons';
import { Row } from './Settings';

/** Only Windows reads the screen's text for now. */
const READS_SCREEN = navigator.userAgent.includes('Windows');

export function PrivacySettings({ view, change }: { view: SettingsView | undefined; change: (next: RequestArgument<'settings:set'>) => void }) {
  const [draft, setDraft] = useState('');
  const words = view?.privacy.words ?? [];
  const read = READS_SCREEN && (view?.privacy.read ?? true);
  // "Lena Müller, ACME": each name once, as it was first written
  const add = () => {
    const added = draft.split(/[,;\n]/).map((word) => word.trim().slice(0, PRIVACY_WORD_MAX)).filter(Boolean);
    setDraft('');
    if (added.length > 0) change({ privacyWords: [...words, ...added].slice(0, PRIVACY_WORDS_MAX) });
  };
  return (
    <>
      <Row
        label="Read the screen after a take"
        hint={
          READS_SCREEN
            ? 'Cuttle reads the text of each new take with Windows’ own OCR, on this computer, and masks email addresses, keys and other private things it finds. Notifications are masked either way.'
            : 'Cuttle reads the screen’s text with Windows’ own OCR, which this system does not have yet. Notifications are masked either way.'
        }
      >
        <button
          className="toggle"
          role="switch"
          aria-checked={read}
          aria-label="Read the screen after a take"
          disabled={!READS_SCREEN || !view}
          onClick={() => view && change({ privacyRead: !view.privacy.read })}
          data-testid="privacy-read"
        >
          <i />
        </button>
      </Row>
      <Row label="Always mask" hint="Names and words masked wherever the screen shows them, in every new take." stacked>
        <div className="words" data-testid="privacy-words">
          {words.map((word) => (
            <span className="word" key={word}>
              {word}
              <button className="icon" aria-label={`Stop masking ${word}`} title="Stop masking it" onClick={() => change({ privacyWords: words.filter((other) => other !== word) })}>
                <CloseIcon size={11} />
              </button>
            </span>
          ))}
          <input
            className="word-input"
            value={draft}
            placeholder={words.length === 0 ? 'A name, a customer, a project: Enter adds it' : 'Add another'}
            aria-label="A word to always mask"
            disabled={!view || words.length >= PRIVACY_WORDS_MAX}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            onBlur={add}
            data-testid="privacy-word-input"
          />
        </div>
      </Row>
    </>
  );
}
```

In `apps/desktop/src/renderer/settings/Settings.tsx`, replace:

```
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, CopyIcon, FolderIcon, Mark, WarningIcon } from '../icons';
import { Select } from '../Select';

const MAC = navigator.userAgent.includes('Macintosh');
/** The command that installs ffmpeg on this OS. */
```

with:

```
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, CopyIcon, FolderIcon, Mark, WarningIcon } from '../icons';
import { Select } from '../Select';
import { PrivacySettings } from './PrivacySettings';

const MAC = navigator.userAgent.includes('Macintosh');
/** The command that installs ffmpeg on this OS. */
```

In the same file, replace:

```
              <SpeechSettings view={view} change={change} />
            </Section>

            <Section title="To record">
              <FfmpegLine tools={tools} setTools={setTools} />
            </Section>
```

with:

```
              <SpeechSettings view={view} change={change} />
            </Section>

            <Section title="Privacy">
              <PrivacySettings view={view} change={change} />
            </Section>

            <Section title="To record">
              <FfmpegLine tools={tools} setTools={setTools} />
            </Section>
```

In the same file, replace:

```
  );
}

function Row({ label, hint, stacked, children }: { label: string; hint?: ReactNode; stacked?: boolean; children: ReactNode }) {
  return (
    <div className={`row${stacked ? ' stacked' : ''}`}>
      <div className="row-text">
```

with:

```
  );
}

export function Row({ label, hint, stacked, children }: { label: string; hint?: ReactNode; stacked?: boolean; children: ReactNode }) {
  return (
    <div className={`row${stacked ? ' stacked' : ''}`}>
      <div className="row-text">
```

In `apps/desktop/src/renderer/settings/settings.css`, replace:

```
.welcome-foot .row-hint {
  flex: 1;
  margin: 0;
}
```

with:

```
.welcome-foot .row-hint {
  flex: 1;
  margin: 0;
}
/* the words always masked (PrivacySettings.tsx) */
.words {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px;
  border-radius: 8px;
  background: var(--stage);
  box-shadow: inset 0 0 0 1px var(--line);
}
.words:focus-within {
  box-shadow: inset 0 0 0 1px var(--accent);
}
.word {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 24px;
  padding: 0 2px 0 8px;
  border-radius: 6px;
  background: var(--raised-active);
  font-size: var(--size-s);
}
.word button.icon {
  width: 20px;
  height: 20px;
  padding: 0;
  display: grid;
  place-items: center;
  color: var(--muted);
}
.word button.icon:hover {
  color: var(--text);
}
.word-input {
  flex: 1;
  min-width: 140px;
  height: 24px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  user-select: text;
}
/* the box around the words shows the focus */
.words .word-input:focus-visible {
  box-shadow: none;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: exits with code 0. The check in Task 6 drives both windows.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "desktop: the Privacy settings, Read the screen in the Auto tab, and the privacy masks' toast

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The skill

**Files:**
- Modify: `skill/cuttle/SKILL.md`

- [ ] **Step 1: Notifications are masked; Do not disturb is better**

In `skill/cuttle/SKILL.md`, replace:

```markdown
  the user before `cuttle models download small` (488 MB, once). Tell them that a slip needs no
  new take: press Ctrl+Shift+Alt+X (or say "nochmal", "again") and do the bit again.
- Ask the user to make text large (terminal font 16 px or more, or zoom the browser), to close
  private windows and notifications, and to use a clean folder or browser profile.
- The project folder: a new one per demo (`record` creates it).

## 2. Record
```

with:

```markdown
  the user before `cuttle models download small` (488 MB, once). Tell them that a slip needs no
  new take: press Ctrl+Shift+Alt+X (or say "nochmal", "again") and do the bit again.
- Ask the user to make text large (terminal font 16 px or more, or zoom the browser), to close
  private windows, to switch on Do not disturb (Cuttle masks the notifications it sees, but none is
  better), and to use a clean folder or browser profile.
- The project folder: a new one per demo (`record` creates it).

## 2. Record
```

In the same file, replace:

```markdown

Then refine `cuttle.json` ([project.md](project.md)) and preview again:

- **Privacy first.** On Windows `suggest` reads the screen's text (Windows' own OCR, on this
  computer) and masks what it finds: email addresses, keys and tokens, the value of a `…KEY=`,
  `…TOKEN=` or `password:` line, IBANs, card and phone numbers (masks tagged `auto: "privacy"`,
  following text that scrolls). Pass the user's name and address once with
  `--mask "<word>"` (kept in cuttle.json). This is a help, not a guarantee: the OCR misses small
```

with:

```markdown

Then refine `cuttle.json` ([project.md](project.md)) and preview again:

- **Privacy first.** `suggest` masks each notification (a toast, the notification centre) while it
  was open (`auto: "notification"`). On Windows it also reads the screen's text (Windows' own OCR,
  on this computer) and masks what it finds: email addresses, keys and tokens, the value of a `…KEY=`,
  `…TOKEN=` or `password:` line, IBANs, card and phone numbers (masks tagged `auto: "privacy"`,
  following text that scrolls). Pass the user's name and address once with
  `--mask "<word>"` (kept in cuttle.json). This is a help, not a guarantee: the OCR misses small
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run --project node skill/test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add skill
git commit -m "skill: notification masks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The end-to-end check

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`, `apps/desktop/test/fixture.ts`

- [ ] **Step 1: The check**

On Windows (the real OCR reads):
- the settings switch reading on (the check starts with it off: its other takes are not read) and keep a word;
- a new take is read after its cut, as one step to undo;
- a take whose screen shows an email address, with a notification from 3 to 5 s, is read from the Auto tab: both masks arrive as one step, with the toast, and one undo takes both and the link away.

In `apps/desktop/test/fixture.ts`, replace:

```ts
  writeFileSync(join(dir, 'cuttle.json'), `${JSON.stringify(project, null, 2)}\n`);
}

export function makeFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
```

with:

```ts
  writeFileSync(join(dir, 'cuttle.json'), `${JSON.stringify(project, null, 2)}\n`);
}

/**
 * A take whose screen shows an email address (drawn with Windows' Consolas: the app reads it with
 * Windows' OCR), with a notification open from 3 to 5 s in its bottom right corner. One clip over
 * the whole take, no mic.
 */
export function makePrivateFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
  // the drive's colon escaped for the option and again for the graph
  const text = (value: string, y: number) => `drawtext=fontfile=C\\\\:/Windows/Fonts/consola.ttf:fontsize=28:fontcolor=white:x=80:y=${y}:text='${value}'`;
  const graph = ['color=c=0x1e1e1e:s=1280x720:r=30:d=8', text('Signed in as lena.mueller@example.com', 80), text('npm run build', 300)].join(',');
  ffmpeg(['-f', 'lavfi', '-i', graph, '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-pix_fmt', 'yuv420p', join(take, 'screen.mp4')]);
  const toast = (t: number, open: boolean) => ({ t, type: 'window', id: 7, kind: 'notification', rect: [880, 600, 380, 110], open });
  writeFileSync(join(take, 'events.jsonl'), [toast(3, true), toast(5, false)].map((event) => `${JSON.stringify(event)}\n`).join(''));
  writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 100 } } }));
  const project = { version: 1, output: FIXTURE_OUTPUT, sources: { screen: 'takes/1/screen.mp4', events: 'takes/1/events.jsonl' }, scenes: [{ type: 'clip', id: 's1', from: 0, to: 8 }] };
  writeFileSync(join(dir, 'cuttle.json'), `${JSON.stringify(project, null, 2)}\n`);
}

export function makeFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
```

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
import { PNG } from 'pngjs';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OUTPUT, makeFixture, makeSpokenFixture } from './fixture';

/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
```

with:

```ts
import { PNG } from 'pngjs';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OUTPUT, makeFixture, makePrivateFixture, makeSpokenFixture } from './fixture';

/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
```

In the same file, replace:

```ts
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    // New recordings go into a folder of the check's own.
    mkdirSync(join(root, 'user-data'));
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects') }));
    models = createServer((request, response) => {
      if (request.url === '/ggml-base.bin' && BASE_MODEL) return void response.end(readFileSync(BASE_MODEL));
      if (request.url === '/ggml-small.bin') return void response.end('not a model');
```

with:

```ts
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    // New recordings go into a folder of the check's own.
    mkdirSync(join(root, 'user-data'));
    // The screen is read after a take's cut only where the check asks for it (it says so in the settings).
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects'), privacy: { read: false } }));
    models = createServer((request, response) => {
      if (request.url === '/ggml-base.bin' && BASE_MODEL) return void response.end(readFileSync(BASE_MODEL));
      if (request.url === '/ggml-small.bin') return void response.end('not a model');
```

In the same file, replace:

```ts
        CUTTLE_USER_DATA: join(root, 'user-data'),
        CUTTLE_RECORDER_BACKEND: 'test',
        CUTTLE_COUNTDOWN: '0',
        // the check's own models folder (empty at first), and the models from the check's server
        CUTTLE_MODELS_DIR: join(root, 'models'),
        CUTTLE_MODELS_URL: `http://127.0.0.1:${(models.address() as { port: number }).port}/`,
```

with:

```ts
        CUTTLE_USER_DATA: join(root, 'user-data'),
        CUTTLE_RECORDER_BACKEND: 'test',
        CUTTLE_COUNTDOWN: '0',
        // the app reads the screen (the settings above say when)
        CUTTLE_OCR: '',
        // the check's own models folder (empty at first), and the models from the check's server
        CUTTLE_MODELS_DIR: join(root, 'models'),
        CUTTLE_MODELS_URL: `http://127.0.0.1:${(models.address() as { port: number }).port}/`,
```

In the same file, replace:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'subtitled · Cuttle')?.close());
  }, 180_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

with:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'subtitled · Cuttle')?.close());
  }, 180_000);

  it.runIf(process.platform === 'win32')('reads the screen after a take when the settings say so, and from the Auto tab: what it shows that is private and the notifications masked as one step', async () => {
    // the settings: reading is off in this check; switched on, each new take is read after its cut
    await launchAgain(['--settings']);
    const settings = await waitForPage(app, async (page) => page.url().includes('/settings.html') && (await page.locator('[data-testid=privacy-read]').count()) === 1);
    const saved = () => (JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { privacy?: { read: boolean; words: string[] } }).privacy;
    await settings.waitForSelector('[data-testid=privacy-read][aria-checked=false]');
    await click(settings, '[data-testid=privacy-read]');
    await expect.poll(() => saved()?.read).toBe(true);
    // words always masked: Enter adds them (commas between), the cross takes one away
    await settings.fill('[data-testid=privacy-word-input]', 'Lena Müller, ACME');
    await settings.press('[data-testid=privacy-word-input]', 'Enter');
    await expect.poll(() => saved()?.words).toEqual(['Lena Müller', 'ACME']);
    await settings.waitForSelector('[data-testid=privacy-words] .word:nth-child(2) button');
    await click(settings, '[data-testid=privacy-words] .word:nth-child(2) button');
    await expect.poll(() => saved()?.words).toEqual(['Lena Müller']);
    await settings.locator('[data-testid=privacy-read]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('34-privacy-settings', '/settings.html');

    // a new take: read after its cut, linked as one step ("Cuttle's privacy masks")
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    await recordThroughPicker(pillRecord, { stop: 'none', camera: undefined }, false);
    const hud = await runningHud();
    await wait(1500);
    await click(hud, '[data-testid=hud-stop]');
    const recorded = await newProject(before);
    await projectWhen(recorded, (written) => (written.sources as { screenText?: string }).screenText === 'takes/1/screen-text.jsonl', 90_000);
    const title = `${basename(recorded)} · Cuttle`;
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === title);
    await expect.poll(() => opened.evaluate(() => (window as unknown as Hooked).__cuttleCheck.doc().undo), { timeout: 15_000 }).toBe("Cuttle's privacy masks");
    await app.evaluate(({ BrowserWindow }, title) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === title)?.close(), title);
    await click(settings, '[data-testid=privacy-read]');
    await expect.poll(() => saved()?.read).toBe(false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/settings.html'))?.close());

    // a take whose screen shows an email address, with a notification from 3 to 5 s: the Auto tab offers to read it
    const dir = join(root, 'private');
    makePrivateFixture(dir);
    const page = await openEditor(dir);
    await click(page, '#tab-auto');
    await page.waitForSelector('[data-testid=privacy-note]');
    await click(page, '[data-testid=read-screen]');
    type Saved = { sources: { screenText?: string }; masks?: { label?: string; auto?: string; from: number; to: number; rect: number[] }[]; privacy?: { words: string[] } };
    const file = () => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as Saved;
    await expect.poll(() => file().sources.screenText, { timeout: 60_000 }).toBe('takes/1/screen-text.jsonl');
    const masks = file().masks ?? [];
    expect(masks.map((mask) => [mask.label, mask.auto])).toEqual([
      ['Email address', 'privacy'],
      ['Notification', 'notification'],
    ]);
    expect(masks[0]!.rect[1]).toBeLessThan(130);
    expect(masks[1]).toMatchObject({ from: 2.7, to: 5.3, rect: [874, 594, 392, 122] });
    // the settings' words go into the project
    expect(file().privacy?.words).toEqual(['Lena Müller']);
    await page.waitForSelector('[data-testid=privacy-note]', { state: 'detached' });
    await page.waitForSelector('[data-testid=auto-group-privacy]');
    expect(await page.locator('[data-testid=auto-group-privacy] .auto-count').textContent()).toBe('2 on');
    const pageDoc = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.doc());
    await expect.poll(async () => (await pageDoc()).undo).toBe("Cuttle's privacy masks");
    expect((await pageDoc()).toast?.text).toBe('Cuttle masked 1 private thing the screen showed and 1 notification: check them in the Auto tab.');
    expect(await page.locator('[data-testid=project-status]').count()).toBe(0);
    await click(page, '[data-testid=auto-group-privacy] .auto-toggle');
    await page.evaluate((t) => (window as unknown as Hooked).__cuttleCheck.seek(t), 4);
    await shotOf('35-privacy-read', '/editor.html', 'private · Cuttle');
    // one step to undo: the masks and the link go together
    await page.keyboard.press('Control+Z');
    await expect.poll(() => file().masks ?? []).toEqual([]);
    expect(file().sources.screenText).toBeUndefined();
    await page.waitForSelector('[data-testid=privacy-note]');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'private · Cuttle')?.close());
  }, 180_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

- [ ] **Step 2: Run it, with screenshots, and look at them**

```bash
mkdir -p "$TEMP/cuttle-p4m5b-shots"
CUTTLE_HIDDEN=1 CUTTLE_RECORDER_BACKEND=test CUTTLE_CHECK_SHOTS="$TEMP/cuttle-p4m5b-shots" pnpm app:check
```

Expected: PASS, 45 tests. Look at `34-privacy-settings` and `35-privacy-read`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test
git commit -m "desktop: app:check reads the screen after a take and from the Auto tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 690 passed and 56 skipped (on a machine without a speech model the real transcription is skipped too: 689 and 57; off Windows the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 5 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Record a take in the app while a notification comes in (send yourself a message, or Win+N): the take's cut and speech step run, then "Reading the screen…", and the notification is masked (Auto tab: "Private things masked").
2. Show an email address in the take: it is masked too.
3. In Settings, Privacy: add your name under "Always mask", record again: it is masked where the screen shows it.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran once, on the prototype, whose tree the replay matches byte for byte: the task steps' tests, `pnpm test`, the typecheck, `app:check` and `cli:check`. The packaged build (`pnpm app:build`) ran on the replayed commits.

**Found while checking, and already in the plan above**
- **Linking the screen's text reloaded an open editor** (M5a's `suggest` did it too): the editor took the new `sources` for another take, and the step to undo was lost. `takeKey` leaves `screenText` out now.
- **A rerun wrote cuttle.json again** though nothing was new: each run gave the masks new ids. A mask made the same as before keeps its id.
- **The cut came in as "Cuttle's privacy masks"** in three of the check's recordings: without reading, the privacy step followed the cut within the watcher's 150 ms pause and set its origin first. The watcher now looks at once (`settle`) before the privacy step sets its origin.
- **Read the screen waited for the speech step** before it answered, so the Auto tab's button would hang for a long transcription. The step answers at once and waits in the background.
- **Every cut flashed "Masking private things…"** in the title bar, also when nothing was read. Only reading shows now.
- **The check's other takes would have been read** (and with OCR off, said so in a note). The check starts with reading off in its settings; its own test switches it on and off again.
- **The words' field showed two focus rings** (its own and the box's): the box shows the focus.
- **The expected notification rects in the new test were 4 px too wide**: the screen's edge cuts the padding off.

**Spec points that move**
- **The picker's notification hint is left out.** Notifications are masked on their own now, and the skill asks for Do not disturb; a hint read from the registry (`ToastEnabled`) would say less than the masks do. The picker is also where the macOS branch works now.
- **The masks' toast says what was masked** ("Cuttle masked 1 private thing the screen showed and 1 notification: check them in the Auto tab"), not the kinds: the Auto tab lists each.

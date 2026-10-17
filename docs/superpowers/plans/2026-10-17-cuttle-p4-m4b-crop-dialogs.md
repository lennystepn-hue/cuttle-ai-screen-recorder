# Cuttle P4-M4b: The Crop to the Content and Zooms on Dialogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The video shows the content, not the desktop around it: each clip is cropped to the page or app (no browser tabs, bookmarks or taskbar), and a dialog that opens gets a zoom while it is open.

**Architecture:**
- **Format** (`@cuttle/project`): input events `area` (the content area of the window in front, or none) and `window` (a dialog or menu opens or closes); `isFact` tells facts about the screen from input.
- **Recorder** (Windows, koffi):
  - the foreground window and its content area (its largest `Chrome_RenderWidgetHostHWND` child);
  - the dialogs and menus over the desktop, by class.
  - Both are polled from the input loop and written as events when they change.
- **Core:**
  - `suggest/crop.ts`: content areas into stretches, clips cut where the crop changes, and the crop from the picture's still edges where there are no areas (a pass over the keyframes only).
  - `suggest/dialogs.ts`: a zoom per dialog open a second or more.
  - `suggest` crops its clips (keeping crops made by hand) and makes the zooms in the order answer, dialog, typing, click.
- **CLI:** `--no-crop`, `--no-dialog-zooms`.
- **Skill:** the crop, dialog zooms and the new events.

**Tech Stack:** TypeScript strict, zod 4, vitest 5, koffi (user32, dwmapi), ffmpeg (`-skip_frame nokey`).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase4-design.md`. Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p4-m4a-typing-camera.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p4-m4b`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 7.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The prototype passed `pnpm test` (636 tests, 52 skipped), the typecheck, `app:check` (42 tests) and `cli:check` (5).

- **The events.**
  - `{ t, type: "area", rect }`: the content area of the window in front, in screen-track pixels; `rect` is `null` when it has none.
  - `{ t, type: "window", id, kind, rect, open }`: a `dialog` or `menu` opened (`open: true`) or closed; `id` pairs the two. `notification` is in the format for P4-M5, not logged yet.
  - No title or text is logged.
  - `isFact(event)` is true for `shape`, `caret`, `area` and `window`: facts about the screen, which no activity counts (`suggest`'s plan, the speech edits' rest, the timeline's input lane, and the recorder's idle stop).
- **The content area** (Windows):
  - The foreground window's largest visible `Chrome_RenderWidgetHostHWND` child, over 50 × 50: every Chromium browser and Electron app draws the page in one (the spike measured Opera's page area within 6 px).
  - Firefox draws its page in its own window: no area there, so the picture decides.
  - It is read once a second, and at once when the window in front changes or moves (looked at 4 times a second). It is written when it changes by more than 2 px.
- **Windows over the screen** (Windows), looked at 4 times a second, written when one opens or closes:
  - `#32770` is a dialog, `#32768` a menu.
  - A Chromium popup with an owner (`Chrome_WidgetWin_1`) is a dialog from 320 × 200, else a menu (a dropdown, a tooltip).
  - The recorder's own windows are left out.
  - The real dialogs, menus and notifications are for the test by hand: none is opened on this machine.
- **The crop** (`CROP_RULES`):
  - **A content area as a crop:** the part inside the screen, when it is at least 90 % inside, and covers at least 30 % and under 95 % of the screen.
  - **From the areas:** the take is cut into stretches by area. Areas within 8 px are one; one held under 2 s (resizing, a glance at another window) belongs to the stretch before it. Each stretch has its crop or none.
  - **Clips:** each clip is cut where the crop changes inside it (a piece under 0.5 s goes to its neighbour), and each piece gets its crop.
  - **From the picture**, where the take has no areas (older takes, macOS, an app without a render widget):
    - Read the keyframes only (one every 2 s in Cuttle's takes, so a long take is read quickly), 640 px wide.
    - Count per row and column how often a pixel changed by more than 6 between keyframes.
    - From each edge inward, rows (columns) that change less than 5 % as much as the middle (the middle 40 %) are a band. They are left out.
    - None when the middle hardly changes (under 0.2 % of its pixels).
    - One crop for the whole take.
    - On the 12:12 take (48 s, 2560 × 1440) that gives [64, 148, 2496, 1232] in 0.3 s: the page without tabs, bookmarks and taskbar.
  - **In `suggest`** (`autoEdits.crop`, `--no-crop`):
    - Crops are tagged `auto: "crop"`.
    - A crop made by hand on an old clip goes to every new clip it overlaps, and no crop is made there.
    - A crop of Cuttle's switched off stays off when the new one is at least half alike.
    - The note says where it came from.
- **Dialog zooms** (`DIALOG_RULES`):
  - A dialog open at least 1 output second gets a zoom from 0.3 s before it opens to 0.3 s after it closes (or to its clip's end), inside the clip it opened in.
  - **The view:** padded by 15 % of the dialog's larger side, at least 45 % of the screen wide, in the screen's shape. The dialog fills about two thirds of it; the click zooms' padding (10 % of the screen) left a 760 × 420 dialog only 1.5×.
  - **Left out:**
    - dialogs on another monitor (under 90 % inside);
    - those in clips faster than 2×;
    - views over 80 % of the screen;
    - those overlapping another zoom.
  - **Priority:** answer, dialog, typing, click (`autoEdits.dialogZooms`, `--no-dialog-zooms`).

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/{schema,index}.ts` | `area`, `window`, `isFact` |
| `packages/recorder/src/{types,events,win32,input,record}.ts` | the content area and the windows, read while recording |
| `packages/core/src/suggest/{crop,dialogs}.ts` (new), `media.ts`, `plan.ts`, `suggest.ts`, `ffmpeg.ts`, `speech/edits.ts`, `index.ts` | the crop and the dialog zooms |
| `apps/cli/src/main.ts` | `--no-crop`, `--no-dialog-zooms` |
| `apps/desktop/src/shared/timeline-model.ts` | facts are no input |
| `skill/cuttle/{SKILL,project}.md` | for Claude |

---

### Task 1: The format

**Files:**
- Modify: `packages/project/src/{schema,index}.ts`, `packages/project/test/events.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p4-m4b`; work there:

```bash
git switch p4-m4b
```

- [ ] **Step 2: Write the failing test**

In `packages/project/test/events.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { parseEventsJsonl } from '../src/index';

describe('parseEventsJsonl', () => {
  it('parses one event per line and skips blank lines', () => {
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { isFact, parseEventsJsonl, type InputEvent } from '../src/index';

describe('parseEventsJsonl', () => {
  it('parses one event per line and skips blank lines', () => {
```

In the same file, replace:

```ts
    expect(parseEventsJsonl('{"t":1.5,"type":"caret","x":812,"y":440}\n').issues.map((issue) => issue.path)).toEqual(['line 1.rect', 'line 1']);
  });

  it('accepts Windows line endings and a last line without a newline', () => {
    const text = '{"t":0,"type":"keys","count":1}\r\n{"t":1,"type":"shape","shape":"text"}';
    expect(parseEventsJsonl(text).events).toEqual([
```

with:

```ts
    expect(parseEventsJsonl('{"t":1.5,"type":"caret","x":812,"y":440}\n').issues.map((issue) => issue.path)).toEqual(['line 1.rect', 'line 1']);
  });

  it('reads the content area (or none) and the windows over the screen, facts like the shape and the caret', () => {
    const text = ['{"t":0.2,"type":"area","rect":[65,147,2495,1233]}', '{"t":4,"type":"area","rect":null}', '{"t":5,"type":"window","id":4242,"kind":"dialog","rect":[600,350,600,300],"open":true}'].join('\n');
    const { events, issues } = parseEventsJsonl(text);
    expect(issues).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(['area', 'area', 'window']);
    expect(parseEventsJsonl('{"t":5,"type":"window","id":1,"kind":"tooltip","rect":[0,0,9,9],"open":true}').issues.map((issue) => issue.path)).toEqual(['line 1.kind']);
    const others: InputEvent[] = [{ t: 1, type: 'shape', shape: 'text' }, { t: 1, type: 'caret', rect: [1, 1, 2, 9] }];
    expect([...events, ...others].every(isFact)).toBe(true);
    expect(isFact({ t: 1, type: 'keys', count: 2 })).toBe(false);
  });

  it('accepts Windows line endings and a last line without a newline', () => {
    const text = '{"t":0,"type":"keys","count":1}\r\n{"t":1,"type":"shape","shape":"text"}';
    expect(parseEventsJsonl(text).events).toEqual([
```

Run: `pnpm exec vitest run --project node packages/project/test/events.test.ts`
Expected: FAIL: `isFact` does not exist, and `area` and `window` are unknown events.

- [ ] **Step 3: The events**

In `packages/project/src/schema.ts`, replace:

```ts
// where the system reports points instead of pixels, applies the display scale); positions outside
// [0, width) x [0, height) mean the pointer is off the captured area.
const point = { t: seconds, x: z.number(), y: z.number() };
export const InputEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), ...point }),
  z.strictObject({ type: z.literal('click'), ...point, button: z.enum(MOUSE_BUTTONS) }),
```

with:

```ts
// where the system reports points instead of pixels, applies the display scale); positions outside
// [0, width) x [0, height) mean the pointer is off the captured area.
const point = { t: seconds, x: z.number(), y: z.number() };
/** What a window over the screen is, by its class (see the recorder). */
export const WINDOW_KINDS = ['dialog', 'menu', 'notification'] as const;
export const InputEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), ...point }),
  z.strictObject({ type: z.literal('click'), ...point, button: z.enum(MOUSE_BUTTONS) }),
```

In the same file, replace:

```ts
  z.strictObject({ type: z.literal('keys'), t: seconds, count: z.number().int().positive() }),
  // where text is typed: the system caret, where the app keeps one (a fact, not input)
  z.strictObject({ type: z.literal('caret'), t: seconds, rect: RectSchema }),
]);

export type InputEvent = z.output<typeof InputEventSchema>;
export type CursorShape = (typeof CURSOR_SHAPES)[number];
export type CursorStyle = (typeof CURSOR_STYLES)[number];
```

with:

```ts
  z.strictObject({ type: z.literal('keys'), t: seconds, count: z.number().int().positive() }),
  // where text is typed: the system caret, where the app keeps one (a fact, not input)
  z.strictObject({ type: z.literal('caret'), t: seconds, rect: RectSchema }),
  // the content area of the window shown (a browser's page, an Electron app's view); null: none
  z.strictObject({ type: z.literal('area'), t: seconds, rect: RectSchema.nullable() }),
  // a dialog, menu or notification opens (`open`) or closes over the screen; `id` pairs the two
  z.strictObject({ type: z.literal('window'), t: seconds, id: z.number().int().nonnegative(), kind: z.enum(WINDOW_KINDS), rect: RectSchema, open: z.boolean() }),
]);

/** Events that are facts about the screen, not input: the pointer's shape, the caret, the content area, windows. */
const FACTS: ReadonlySet<string> = new Set(['shape', 'caret', 'area', 'window']);
export const isFact = (event: InputEvent): boolean => FACTS.has(event.type);

export type InputEvent = z.output<typeof InputEventSchema>;
export type CursorShape = (typeof CURSOR_SHAPES)[number];
export type CursorStyle = (typeof CURSOR_STYLES)[number];
```

In the same file, replace:

```ts
export type CardScene = Extract<Scene, { type: 'card' }>;
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type Mask = CuttleProject['masks'][number];
export type TextOverlay = CuttleProject['texts'][number];
export type Cut = CuttleProject['cuts'][number];
```

with:

```ts
export type CardScene = Extract<Scene, { type: 'card' }>;
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
export type Mask = CuttleProject['masks'][number];
export type TextOverlay = CuttleProject['texts'][number];
export type Cut = CuttleProject['cuts'][number];
```

In `packages/project/src/index.ts`, replace:

```ts
  TEXT_STYLES,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
  InputEventSchema,
  ProjectSchema,
  RectSchema,
  type AutoEdits,
  type AutoKind,
  type BackgroundPreset,
```

with:

```ts
  TEXT_STYLES,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
  WINDOW_KINDS,
  InputEventSchema,
  ProjectSchema,
  RectSchema,
  isFact,
  type AutoEdits,
  type AutoKind,
  type BackgroundPreset,
```

In the same file, replace:

```ts
  type TextOverlay,
  type TextPosition,
  type TextStyle,
  type Zoom,
  type ZoomMove,
} from './schema';
```

with:

```ts
  type TextOverlay,
  type TextPosition,
  type TextStyle,
  type WindowKind,
  type Zoom,
  type ZoomMove,
} from './schema';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/project`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project
git commit -m "project: the area and window events, and isFact

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The recorder

**Files:**
- Modify: `packages/recorder/src/{types,events,win32,input,record}.ts`, `packages/recorder/test/{events,input,win32}.test.ts`

- [ ] **Step 1: Write the failing tests**

The Win32 check registers a window class named like Chromium's render widget, and finds the content area in a parent that is never shown:

In `packages/recorder/test/win32.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { CURSOR_SHAPES } from '@cuttle/project';
import { SHELL_CLASSES, loadWin32 } from '../src/win32';

/**
 * A caret of this thread in a window that is never shown (`WS_POPUP` without `WS_VISIBLE`): where
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { CURSOR_SHAPES } from '@cuttle/project';
import { RENDER_WIDGET, SHELL_CLASSES, loadWin32, windowKind } from '../src/win32';

/**
 * A caret of this thread in a window that is never shown (`WS_POPUP` without `WS_VISIBLE`): where
```

In the same file, replace:

```ts
    expect(win.caret(thread)).toBeUndefined();
  });

  it('lists windows with a title and a size on a listed monitor', async () => {
    const win = await loadWin32();
    const monitors = win.monitors();
```

with:

```ts
    expect(win.caret(thread)).toBeUndefined();
  });

  it('finds a window\'s content area: its largest render widget', async () => {
    const win = await loadWin32();
    const { default: koffi } = await import('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const prefix = `check${process.hrtime.bigint()}`;
    const WNDPROC = koffi.proto('__stdcall', `${prefix}_WNDPROC`, 'intptr_t', ['void *', 'uint32', 'uintptr_t', 'intptr_t']);
    const WNDCLASSW = koffi.struct(`${prefix}_WNDCLASSW`, {
      style: 'uint32',
      lpfnWndProc: koffi.pointer(WNDPROC),
      cbClsExtra: 'int',
      cbWndExtra: 'int',
      hInstance: 'void *',
      hIcon: 'void *',
      hCursor: 'void *',
      hbrBackground: 'void *',
      lpszMenuName: 'str16',
      lpszClassName: 'str16',
    });
    const DefWindowProcW = user32.func('__stdcall', 'DefWindowProcW', 'intptr_t', ['void *', 'uint32', 'uintptr_t', 'intptr_t']);
    const RegisterClassW = user32.func('__stdcall', 'RegisterClassW', 'uint16', [koffi.pointer(WNDCLASSW)]);
    const UnregisterClassW = user32.func('__stdcall', 'UnregisterClassW', 'int', ['str16', 'void *']);
    const CreateWindowExW = user32.func('__stdcall', 'CreateWindowExW', 'void *', ['uint32', 'str16', 'str16', 'uint32', 'int', 'int', 'int', 'int', 'void *', 'void *', 'void *', 'void *']);
    const DestroyWindow = user32.func('__stdcall', 'DestroyWindow', 'int', ['void *']);
    const GetModuleHandleW = kernel32.func('__stdcall', 'GetModuleHandleW', 'void *', ['void *']);
    const instance = GetModuleHandleW(null);
    const proc = koffi.register((hwnd: unknown, message: number, wParam: number, lParam: number) => DefWindowProcW(hwnd, message, wParam, lParam), koffi.pointer(WNDPROC));
    const [WS_POPUP, WS_CHILD] = [0x80000000, 0x40000000];
    // a parent that is never shown, with two render widgets (a page and a small panel) and a sibling of another class
    expect(RegisterClassW({ style: 0, lpfnWndProc: proc, cbClsExtra: 0, cbWndExtra: 0, hInstance: instance, hIcon: null, hCursor: null, hbrBackground: null, lpszMenuName: null, lpszClassName: RENDER_WIDGET })).not.toBe(0);
    const parent = CreateWindowExW(0, 'STATIC', 'cuttle area check', WS_POPUP, 100, 100, 900, 700, null, null, null, null);
    try {
      for (const [x, y, w, h, kind] of [[10, 60, 860, 600, RENDER_WIDGET], [10, 0, 120, 60, RENDER_WIDGET], [10, 0, 880, 50, 'STATIC']] as const) {
        expect(CreateWindowExW(0, kind, '', WS_CHILD, x, y, w, h, parent, null, instance, null)).not.toBeNull();
      }
      const id = Number(BigInt.asUintN(32, koffi.address(parent)));
      expect(win.contentArea(id, true)).toEqual({ x: 110, y: 160, width: 860, height: 600 });
      // as the recorder looks: only what is shown
      expect(win.contentArea(id)).toBeUndefined();
    } finally {
      DestroyWindow(parent);
      UnregisterClassW(RENDER_WIDGET, instance);
      koffi.unregister(proc);
    }
  });

  it('knows a dialog and a menu by their class, and lists those on the desktop', async () => {
    const box = (width: number, height: number) => ({ x: 0, y: 0, width, height });
    expect(windowKind('#32770', true, box(400, 200))).toBe('dialog');
    expect(windowKind('#32768', false, box(200, 300))).toBe('menu');
    // a Chromium popup: a dialog when large, a dropdown or tooltip when small; a main window is none
    expect(windowKind('Chrome_WidgetWin_1', true, box(480, 320))).toBe('dialog');
    expect(windowKind('Chrome_WidgetWin_1', true, box(240, 400))).toBe('menu');
    expect(windowKind('Chrome_WidgetWin_1', false, box(1600, 900))).toBeUndefined();
    expect(windowKind('Notepad', false, box(800, 600))).toBeUndefined();
    const win = await loadWin32();
    for (const popup of win.popups()) {
      expect(['dialog', 'menu']).toContain(popup.kind);
      expect(popup.bounds.width).toBeGreaterThanOrEqual(2);
    }
    const front = win.foreground();
    if (front) expect(front.id).toBeGreaterThan(0);
  });

  it('lists windows with a title and a size on a listed monitor', async () => {
    const win = await loadWin32();
    const monitors = win.monitors();
```

In `packages/recorder/test/events.test.ts`, replace:

```ts
    expect(read()).toEqual([{ t: 1.5, type: 'caret', rect: [800, 400, 2, 19] }]);
  });

  it('ignores input after close (the hook can deliver one more event)', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
```

with:

```ts
    expect(read()).toEqual([{ t: 1.5, type: 'caret', rect: [800, 400, 2, 19] }]);
  });

  it('writes the content area and the windows over the screen in the screen track', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
    events.push({ type: 'area', time: 1001, rect: { x: 165, y: 197, width: 2495, height: 1233 } });
    events.push({ type: 'window', time: 1002, id: 4242, kind: 'dialog', rect: { x: 700, y: 400, width: 600, height: 300 }, open: true });
    events.push({ type: 'area', time: 1003, rect: null });
    expect(read()).toEqual([
      { t: 1, type: 'area', rect: [65, 147, 2495, 1233] },
      { t: 2, type: 'window', id: 4242, kind: 'dialog', rect: [600, 350, 600, 300], open: true },
      { t: 3, type: 'area', rect: null },
    ]);
  });

  it('ignores input after close (the hook can deliver one more event)', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
```

In `packages/recorder/test/input.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { caretWatch, keyHandler, wheelInput } from '../src/input';
import type { HotkeyAction, RawInput } from '../src/types';

// Key codes as uiohook reports them: Ctrl 29, Shift 42, Alt 56, S 31, M 50, A 30.
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { caretWatch, keyHandler, wheelInput, windowWatch } from '../src/input';
import type { HotkeyAction, RawInput } from '../src/types';

// Key codes as uiohook reports them: Ctrl 29, Shift 42, Alt 56, S 31, M 50, A 30.
```

In the same file, replace:

```ts
  });
});

describe('wheelInput', () => {
  const VERTICAL = 3;
  const HORIZONTAL = 4;
```

with:

```ts
  });
});

describe('windowWatch', () => {
  /** A desktop whose foreground window, content area and popups the test sets. */
  function desktop() {
    const state = {
      front: { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } } as { id: number; bounds: { x: number; y: number; width: number; height: number } } | undefined,
      area: { x: 10, y: 100, width: 980, height: 690 } as { x: number; y: number; width: number; height: number } | undefined,
      popups: [] as { id: number; kind: 'dialog' | 'menu'; bounds: { x: number; y: number; width: number; height: number } }[],
      areaReads: 0,
    };
    const win = {
      foreground: () => state.front,
      contentArea: () => (state.areaReads++, state.area),
      popups: () => state.popups,
    };
    return { state, win };
  }

  it('passes on the content area at once, when the window moves, and then once a second when it changed', () => {
    const { state, win } = desktop();
    const seen: RawInput[] = [];
    const tick = windowWatch(win, (input) => seen.push(input));
    let time = 0;
    const run = (reads: number) => {
      for (let i = 0; i < reads; i++) tick((time += 1 / 30));
    };
    run(1);
    expect(seen).toEqual([{ type: 'area', time: 1 / 30, rect: { x: 10, y: 100, width: 980, height: 690 } }]);
    // a second later, 1 px off: no change
    state.area = { x: 11, y: 100, width: 980, height: 690 };
    run(30);
    expect(seen).toHaveLength(1);
    // the window moves: the area is read at the next look at the windows
    state.front = { id: 1, bounds: { x: 200, y: 0, width: 1000, height: 800 } };
    state.area = { x: 210, y: 100, width: 980, height: 690 };
    run(8);
    expect(seen.at(-1)).toMatchObject({ type: 'area', rect: { x: 210 } });
    // a window without one: null
    state.front = { id: 2, bounds: { x: 0, y: 0, width: 500, height: 400 } };
    state.area = undefined;
    run(8);
    expect(seen.at(-1)).toMatchObject({ type: 'area', rect: null });
    expect(state.areaReads).toBeLessThan(8);
  });

  it('passes on each dialog or menu as it opens and closes', () => {
    const { state, win } = desktop();
    const seen: RawInput[] = [];
    const tick = windowWatch(win, (input) => seen.push(input));
    const dialog = { id: 7, kind: 'dialog' as const, bounds: { x: 300, y: 200, width: 400, height: 300 } };
    tick(1);
    state.popups = [dialog];
    for (let i = 0; i < 8; i++) tick(2);
    state.popups = [];
    for (let i = 0; i < 8; i++) tick(3);
    expect(seen.filter((input) => input.type === 'window')).toEqual([
      { type: 'window', time: 2, id: 7, kind: 'dialog', rect: dialog.bounds, open: true },
      { type: 'window', time: 3, id: 7, kind: 'dialog', rect: dialog.bounds, open: false },
    ]);
  });
});

describe('wheelInput', () => {
  const VERTICAL = 3;
  const HORIZONTAL = 4;
```

Run: `pnpm exec vitest run --project node packages/recorder/test/win32.test.ts packages/recorder/test/events.test.ts packages/recorder/test/input.test.ts`
Expected: FAIL: `windowKind`, `contentArea` and `windowWatch` do not exist, and the events are not written.

- [ ] **Step 2: Read them while recording**

In `packages/recorder/src/types.ts`, replace:

```ts
import type { CursorShape, Marker, Rect } from '@cuttle/project';

/** A rectangle on the desktop, in physical pixels (negative left of and above the primary monitor). */
export interface Bounds {
```

with:

```ts
import type { CursorShape, Marker, Rect, WindowKind } from '@cuttle/project';

/** A rectangle on the desktop, in physical pixels (negative left of and above the primary monitor). */
export interface Bounds {
```

In the same file, replace:

```ts
  | { type: 'shape'; time: number; shape: CursorShape }
  | { type: 'key'; time: number }
  /** The system caret (where text is typed), where the app keeps one. */
  | { type: 'caret'; time: number; x: number; y: number; width: number; height: number };

export type HotkeyAction = 'stop' | 'marker' | 'pause' | 'retake';
```

with:

```ts
  | { type: 'shape'; time: number; shape: CursorShape }
  | { type: 'key'; time: number }
  /** The system caret (where text is typed), where the app keeps one. */
  | { type: 'caret'; time: number; x: number; y: number; width: number; height: number }
  /** The content area of the window shown (null: it has none). */
  | { type: 'area'; time: number; rect: Bounds | null }
  /** A dialog or menu opened or closed. */
  | { type: 'window'; time: number; id: number; kind: WindowKind; rect: Bounds; open: boolean };

export type HotkeyAction = 'stop' | 'marker' | 'pause' | 'retake';
```

In `packages/recorder/src/events.ts`, replace:

```ts
      case 'caret':
        this.flushMove();
        return this.emit({ t: at, type: 'caret', rect: [x, y, input.width, input.height] });
      case 'key': {
        const window = Math.floor(t / KEY_WINDOW);
        if (this.keys?.window === window) {
```

with:

```ts
      case 'caret':
        this.flushMove();
        return this.emit({ t: at, type: 'caret', rect: [x, y, input.width, input.height] });
      case 'area':
        this.flushMove();
        return this.emit({ t: at, type: 'area', rect: input.rect && this.rect(input.rect) });
      case 'window':
        this.flushMove();
        return this.emit({ t: at, type: 'window', id: input.id, kind: input.kind, rect: this.rect(input.rect), open: input.open });
      case 'key': {
        const window = Math.floor(t / KEY_WINDOW);
        if (this.keys?.window === window) {
```

In the same file, replace:

```ts
    this.keys = undefined;
  }

  private emit(event: InputEvent): void {
    this.write(`${JSON.stringify(event)}\n`);
  }
```

with:

```ts
    this.keys = undefined;
  }

  /** A desktop rect in the screen track's pixels. */
  private rect(bounds: { x: number; y: number; width: number; height: number }): [number, number, number, number] {
    return [bounds.x - this.origin.x, bounds.y - this.origin.y, bounds.width, bounds.height];
  }

  private emit(event: InputEvent): void {
    this.write(`${JSON.stringify(event)}\n`);
  }
```

In `packages/recorder/src/win32.ts`, replace:

```ts
// Windows APIs through koffi: monitors in ddagrab order, windows, pointer position and shape, the caret.
import type { CursorShape } from '@cuttle/project';
import type { Monitor, WindowInfo } from './types';

export interface Win32 {
  /** Outputs of the default adapter, in the order of ffmpeg ddagrab's `output_idx`. */
```

with:

```ts
// Windows APIs through koffi: monitors in ddagrab order, windows, pointer position and shape, the
// caret, the content area of a window, and the dialogs and menus over the desktop.
import type { CursorShape, WindowKind } from '@cuttle/project';
import type { Bounds, Monitor, WindowInfo } from './types';

export interface Win32 {
  /** Outputs of the default adapter, in the order of ffmpeg ddagrab's `output_idx`. */
```

In the same file, replace:

```ts
   * each way; undefined where the app keeps none (many draw their own).
   */
  caret(thread?: number): { x: number; y: number; width: number; height: number } | undefined;
}

let loaded: Promise<Win32> | undefined;
```

with:

```ts
   * each way; undefined where the app keeps none (many draw their own).
   */
  caret(thread?: number): { x: number; y: number; width: number; height: number } | undefined;
  /** The foreground window: its id and its frame (without the invisible resize border). */
  foreground(): { id: number; bounds: Bounds } | undefined;
  /**
   * A window's content area: its largest render widget (Chromium browsers and Electron apps draw the
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
  return undefined;
}

let loaded: Promise<Win32> | undefined;
```

In the same file, replace:

```ts
    Monitor: 'void *',
  });
  const WNDENUMPROC = koffi.proto('__stdcall', typeName('WNDENUMPROC'), 'int', ['void *', 'intptr_t']);

  const SetProcessDpiAwarenessContext = user32.func('__stdcall', 'SetProcessDpiAwarenessContext', 'int', ['intptr_t']);
  // Physical pixels whatever the process's DPI awareness (GetCursorPos would be logical in a process
```

with:

```ts
    Monitor: 'void *',
  });
  const WNDENUMPROC = koffi.proto('__stdcall', typeName('WNDENUMPROC'), 'int', ['void *', 'intptr_t']);
  const GW_OWNER = 4;

  const SetProcessDpiAwarenessContext = user32.func('__stdcall', 'SetProcessDpiAwarenessContext', 'int', ['intptr_t']);
  // Physical pixels whatever the process's DPI awareness (GetCursorPos would be logical in a process
```

In the same file, replace:

```ts
  const GetCursorInfo = user32.func('__stdcall', 'GetCursorInfo', 'int', [koffi.inout(koffi.pointer(CURSORINFO))]);
  const GetGUIThreadInfo = user32.func('__stdcall', 'GetGUIThreadInfo', 'int', ['uint32', koffi.inout(koffi.pointer(GUITHREADINFO))]);
  const ClientToScreen = user32.func('__stdcall', 'ClientToScreen', 'int', ['void *', koffi.inout(koffi.pointer(POINT))]);
  const LoadCursorW = user32.func('__stdcall', 'LoadCursorW', 'void *', ['void *', 'uintptr_t']);
  const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'int', [koffi.pointer(WNDENUMPROC), 'intptr_t']);
  const IsWindowVisible = user32.func('__stdcall', 'IsWindowVisible', 'int', ['void *']);
```

with:

```ts
  const GetCursorInfo = user32.func('__stdcall', 'GetCursorInfo', 'int', [koffi.inout(koffi.pointer(CURSORINFO))]);
  const GetGUIThreadInfo = user32.func('__stdcall', 'GetGUIThreadInfo', 'int', ['uint32', koffi.inout(koffi.pointer(GUITHREADINFO))]);
  const ClientToScreen = user32.func('__stdcall', 'ClientToScreen', 'int', ['void *', koffi.inout(koffi.pointer(POINT))]);
  const GetForegroundWindow = user32.func('__stdcall', 'GetForegroundWindow', 'void *', []);
  const EnumChildWindows = user32.func('__stdcall', 'EnumChildWindows', 'int', ['intptr_t', koffi.pointer(WNDENUMPROC), 'intptr_t']);
  const GetWindowRect = user32.func('__stdcall', 'GetWindowRect', 'int', ['void *', koffi.out(koffi.pointer(RECT))]);
  const GetWindow = user32.func('__stdcall', 'GetWindow', 'void *', ['void *', 'uint32']);
  const LoadCursorW = user32.func('__stdcall', 'LoadCursorW', 'void *', ['void *', 'uintptr_t']);
  const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'int', [koffi.pointer(WNDENUMPROC), 'intptr_t']);
  const IsWindowVisible = user32.func('__stdcall', 'IsWindowVisible', 'int', ['void *']);
```

In the same file, replace:

```ts
  const point = { x: 0, y: 0 };
  const info = { cbSize: koffi.sizeof(CURSORINFO), flags: 0, hCursor: null as unknown, ptScreenPos: { x: 0, y: 0 } };
  const rect = () => ({ left: 0, top: 0, right: 0, bottom: 0 });
  return {
    monitors: () => outputs().map(({ monitor }) => monitor),
    windows,
```

with:

```ts
  const point = { x: 0, y: 0 };
  const info = { cbSize: koffi.sizeof(CURSORINFO), flags: 0, hCursor: null as unknown, ptScreenPos: { x: 0, y: 0 } };
  const rect = () => ({ left: 0, top: 0, right: 0, bottom: 0 });
  /** A window id (32 bits, unsigned) as the handle Windows takes. */
  const handleOf = (id: number) => (id >= 2 ** 31 ? id - 2 ** 32 : id);
  const idOf = (hwnd: unknown) => Number(BigInt.asUintN(32, koffi.address(hwnd)));
  const className = (hwnd: unknown) => {
    const buffer = Buffer.alloc(512);
    return buffer.toString('utf16le', 0, GetClassNameW(hwnd, buffer, 256) * 2);
  };
  /** A window's frame without the invisible resize border. */
  const frame = (hwnd: unknown): Bounds | undefined => {
    const bounds = Buffer.alloc(16);
    if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, bounds, 16) < 0) return undefined;
    const [left, top, right, bottom] = [0, 4, 8, 12].map((offset) => bounds.readInt32LE(offset)) as [number, number, number, number];
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  return {
    monitors: () => outputs().map(({ monitor }) => monitor),
    windows,
```

In the same file, replace:

```ts
      if (!GetCursorInfo(info) || info.hCursor === null) return 'arrow';
      return cursorShapes.get(koffi.address(info.hCursor)) ?? 'arrow';
    },
    caret(thread = 0) {
      const gui = { cbSize: koffi.sizeof(GUITHREADINFO), flags: 0, hwndActive: null, hwndFocus: null, hwndCapture: null, hwndMenuOwner: null, hwndMoveSize: null, hwndCaret: null as unknown, rcCaret: rect() };
      if (!GetGUIThreadInfo(thread, gui) || !gui.hwndCaret) return undefined;
```

with:

```ts
      if (!GetCursorInfo(info) || info.hCursor === null) return 'arrow';
      return cursorShapes.get(koffi.address(info.hCursor)) ?? 'arrow';
    },
    foreground() {
      const hwnd = GetForegroundWindow();
      const bounds = hwnd ? frame(hwnd) : undefined;
      return hwnd && bounds ? { id: idOf(hwnd), bounds } : undefined;
    },
    contentArea(id, hidden = false) {
      let best: Bounds | undefined;
      const visit = koffi.register((hwnd: unknown) => {
        if ((!hidden && !IsWindowVisible(hwnd)) || className(hwnd) !== RENDER_WIDGET) return 1;
        const box = rect();
        if (!GetWindowRect(hwnd, box)) return 1;
        const area = { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top };
        if (area.width > 50 && area.height > 50 && area.width * area.height > (best ? best.width * best.height : 0)) best = area;
        return 1;
      }, koffi.pointer(WNDENUMPROC));
      try {
        EnumChildWindows(handleOf(id), visit, 0);
      } finally {
        koffi.unregister(visit);
      }
      return best;
    },
    popups() {
      const found: { id: number; kind: WindowKind; bounds: Bounds }[] = [];
      const cloaked = Buffer.alloc(4);
      const visit = koffi.register((hwnd: unknown) => {
        if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return 1;
        const pid = [0];
        GetWindowThreadProcessId(hwnd, pid);
        if (pid[0] === process.pid) return 1;
        if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) >= 0 && cloaked.readUInt32LE(0) !== 0) return 1;
        const bounds = frame(hwnd);
        const kind = bounds && windowKind(className(hwnd), GetWindow(hwnd, GW_OWNER) !== null, bounds);
        if (bounds && kind && bounds.width >= 2 && bounds.height >= 2) found.push({ id: idOf(hwnd), kind, bounds });
        return 1;
      }, koffi.pointer(WNDENUMPROC));
      try {
        EnumWindows(visit, 0);
      } finally {
        koffi.unregister(visit);
      }
      return found;
    },
    caret(thread = 0) {
      const gui = { cbSize: koffi.sizeof(GUITHREADINFO), flags: 0, hwndActive: null, hwndFocus: null, hwndCapture: null, hwndMenuOwner: null, hwndMoveSize: null, hwndCaret: null as unknown, rcCaret: rect() };
      if (!GetGUIThreadInfo(thread, gui) || !gui.hwndCaret) return undefined;
```

In `packages/recorder/src/input.ts`, replace:

```ts

type Caret = { x: number; y: number; width: number; height: number };

/**
 * Where text is typed, while it is: called on every shape read, it reads the caret every
 * `CARET_EVERY`th time while a key came in the last `CARET_AFTER_KEYS` seconds, and passes it on
```

with:

```ts

type Caret = { x: number; y: number; width: number; height: number };

/** The window and its popups are looked at every this many shape reads (about 4 times a second)… */
const WINDOWS_EVERY = 8;
/** …and the content area every this many (once a second), or at once when the window moved. */
const AREA_EVERY = 30;
/** A content area that moved less than this (px) has not moved. */
const AREA_SLACK = 2;

type Watched = Pick<import('./win32').Win32, 'foreground' | 'contentArea' | 'popups'>;

/**
 * The window shown and what opens over it: called on every shape read, it passes on the foreground
 * window's content area when it changes (`area`, null for none), and each dialog or menu that opens
 * or closes (`window`).
 */
export function windowWatch(win: Watched, onInput: InputSink): (time: number) => void {
  let reads = -1;
  let shown: { id: number; bounds: Caret } | undefined;
  let area: Caret | null | undefined;
  let open = new Map<number, ReturnType<Watched['popups']>[number]>();
  const same = (a: Caret | null | undefined, b: Caret | null) =>
    a === b || (!!a && !!b && Math.abs(a.x - b.x) <= AREA_SLACK && Math.abs(a.y - b.y) <= AREA_SLACK && Math.abs(a.width - b.width) <= AREA_SLACK && Math.abs(a.height - b.height) <= AREA_SLACK);
  return (time) => {
    reads++;
    if (reads % WINDOWS_EVERY !== 0) return;
    const now = new Map(win.popups().map((popup) => [popup.id, popup]));
    for (const [id, popup] of now) if (!open.has(id)) onInput({ type: 'window', time, id, kind: popup.kind, rect: popup.bounds, open: true });
    for (const [id, popup] of open) if (!now.has(id)) onInput({ type: 'window', time, id, kind: popup.kind, rect: popup.bounds, open: false });
    open = now;
    const front = win.foreground();
    const moved = front?.id !== shown?.id || !same(front?.bounds, shown?.bounds ?? null);
    shown = front;
    if (!moved && reads % AREA_EVERY !== 0) return;
    const next = (front && win.contentArea(front.id)) ?? null;
    if (area !== undefined && same(area, next)) return;
    area = next;
    onInput({ type: 'area', time, rect: next });
  };
}

/**
 * Where text is typed, while it is: called on every shape read, it reads the caret every
 * `CARET_EVERY`th time while a key came in the last `CARET_AFTER_KEYS` seconds, and passes it on
```

In the same file, replace:

```ts

  let stopped = false;
  const caret = caretWatch(() => win.caret(), onInput);
  const poll = setInterval(() => {
    const current = win.cursorShape();
    if (current !== shape) {
```

with:

```ts

  let stopped = false;
  const caret = caretWatch(() => win.caret(), onInput);
  const windows = windowWatch(win, onInput);
  const poll = setInterval(() => {
    const current = win.cursorShape();
    if (current !== shape) {
```

In the same file, replace:

```ts
      onInput({ type: 'shape', time: now(), shape });
    }
    caret(now(), typedAt);
  }, SHAPE_POLL_MS);

  return {
```

with:

```ts
      onInput({ type: 'shape', time: now(), shape });
    }
    caret(now(), typedAt);
    windows(now());
  }, SHAPE_POLL_MS);

  return {
```

In `packages/recorder/src/record.ts`, replace:

```ts

/** Whether a pointer event lies in one of the dead zones (keys and shapes have no position). */
export function inDeadZone(input: RawInput, zones: readonly Bounds[]): boolean {
  if (input.type === 'key' || input.type === 'shape') return false;
  return zones.some((zone) => input.x >= zone.x && input.x < zone.x + zone.width && input.y >= zone.y && input.y < zone.y + zone.height);
}
```

with:

```ts

/** Whether a pointer event lies in one of the dead zones (keys and shapes have no position). */
export function inDeadZone(input: RawInput, zones: readonly Bounds[]): boolean {
  if (input.type === 'key' || input.type === 'shape' || input.type === 'area' || input.type === 'window') return false;
  return zones.some((zone) => input.x >= zone.x && input.x < zone.x + zone.width && input.y >= zone.y && input.y < zone.y + zone.height);
}
```

In the same file, replace:

```ts
        // Nothing while paused, nothing after a stop was asked for, nothing over the app's own
        // controls: no take shows the pointer travelling to Stop or its click.
        if (!capturing || control.reason !== undefined || inDeadZone(raw, control.deadZones)) return;
        lastInput = raw.time;
        writer.push(raw);
      },
      (action) => (action === 'stop' ? control.request('hotkey') : action === 'pause' ? control.toggle() : action === 'retake' ? control.retake() : control.marker()),
```

with:

```ts
        // Nothing while paused, nothing after a stop was asked for, nothing over the app's own
        // controls: no take shows the pointer travelling to Stop or its click.
        if (!capturing || control.reason !== undefined || inDeadZone(raw, control.deadZones)) return;
        // the facts about the screen (the content area, a window opening) are no one's input
        if (raw.type !== 'area' && raw.type !== 'window') lastInput = raw.time;
        writer.push(raw);
      },
      (action) => (action === 'stop' ? control.request('hotkey') : action === 'pause' ? control.toggle() : action === 'retake' ? control.retake() : control.marker()),
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/recorder`
Expected: PASS. (The recorder's timing tests can wobble on a loaded machine; run them alone then.)

- [ ] **Step 4: Commit**

```bash
git add packages/recorder
git commit -m "recorder: the content area of the window in front, and the dialogs and menus that open

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The crop and the dialog zooms

**Files:**
- Create: `packages/core/src/suggest/crop.ts`, `packages/core/src/suggest/dialogs.ts`, `packages/core/test/crop.test.ts`
- Modify: `packages/core/src/ffmpeg.ts`, `packages/core/src/suggest/{media,plan}.ts`, `packages/core/src/{suggest,index}.ts`, `packages/core/src/speech/edits.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/crop.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { InputEvent, Rect } from '@cuttle/project';
import type { ClipSpan } from '@cuttle/timeline';
import { areaStretches, bandCrop, cropOf, cropPieces } from '../src/suggest/crop';
import { dialogZooms } from '../src/suggest/dialogs';

const screen = { width: 2560, height: 1440 };
const area = (t: number, rect: Rect | null): InputEvent => ({ t, type: 'area', rect });
const page: Rect = [65, 147, 2495, 1233];

describe('cropOf', () => {
  it('takes the part inside the screen, unless it is (nearly) all of it, too little, or elsewhere', () => {
    expect(cropOf(page, screen)).toEqual(page);
    expect(cropOf([60, 140, 2510, 1320], screen)).toEqual([60, 140, 2500, 1300]);
    expect(cropOf([0, 20, 2560, 1420], screen)).toBeUndefined();
    expect(cropOf([100, 100, 800, 600], screen)).toBeUndefined();
    // on the monitor to the left
    expect(cropOf([-1900, 100, 1800, 1000], screen)).toBeUndefined();
    expect(cropOf(null, screen)).toBeUndefined();
  });
});

describe('areaStretches', () => {
  it('holds the content area from the start, one within 8 px is the same, and a short one belongs to the stretch before', () => {
    const events = [area(0.4, page), area(3, [66, 149, 2493, 1231]), area(10, [700, 300, 1400, 900]), area(10.5, page), area(20, null)];
    expect(areaStretches(events, 30, screen)).toEqual([
      { from: 0, to: 20, rect: page },
      { from: 20, to: 30 },
    ]);
  });

  it('gives none without area events', () => {
    expect(areaStretches([{ t: 1, type: 'keys', count: 2 }], 30, screen)).toEqual([]);
  });
});

describe('cropPieces', () => {
  it('cuts a clip where the crop changes inside it, and gives a short piece to its neighbour', () => {
    const stretches = [{ from: 0, to: 12, rect: page }, { from: 12, to: 12.3 }, { from: 12.3, to: 30 }];
    const clips = [{ from: 2, to: 8, speed: 1 }, { from: 9, to: 25, speed: 4 }];
    expect(cropPieces(clips, stretches).map(({ clip, ...piece }) => [clip.speed, piece])).toEqual([
      [1, { from: 2, to: 8, rect: page }],
      [4, { from: 9, to: 12.3, rect: page }],
      [4, { from: 12.3, to: 25 }],
    ]);
    expect(cropPieces(clips, [])).toEqual(clips.map((clip) => ({ clip, from: clip.from, to: clip.to })));
  });
});

describe('bandCrop', () => {
  /** 64 rows × 128 columns: the middle changes, the edge bands not. */
  const bands = (top: number, bottom: number, left: number, right: number, middle = 0.2) => ({
    rows: Array.from({ length: 64 }, (_, y) => (y < top || y >= 64 - bottom ? 0.001 * middle : middle)),
    cols: Array.from({ length: 128 }, (_, x) => (x < left || x >= 128 - right ? 0.001 * middle : middle)),
    frames: 24,
  });

  it('leaves out the edges that hardly change while the middle does', () => {
    // a browser: tabs and bars at the top, a taskbar at the bottom, a side bar on the left
    expect(bandCrop(bands(7, 3, 3, 0), screen)).toEqual([60, 158, 2500, 1215]);
  });

  it('gives none when the middle hardly changes, when nothing is still, or when too little is left', () => {
    expect(bandCrop(bands(7, 3, 3, 0, 0.001), screen)).toBeUndefined();
    expect(bandCrop(bands(0, 0, 0, 0), screen)).toBeUndefined();
    expect(bandCrop(bands(25, 25, 0, 0), screen)).toBeUndefined();
  });
});

describe('dialogZooms', () => {
  const clips: ClipSpan[] = [{ from: 0, to: 20, speed: 1, start: 0 }, { from: 20, to: 40, speed: 8, start: 20 }];
  const dialog = (t: number, open: boolean, id = 5, rect: Rect = [900, 500, 760, 420]): InputEvent => ({ t, type: 'window', id, kind: 'dialog', rect, open });

  it('zooms on a dialog open a second or more, from just before it opens to just after it closes', () => {
    // padded by 15 % of its width, in the screen's shape: the dialog fills two thirds of the view
    expect(dialogZooms([dialog(5, true), dialog(9, false)], clips, screen)).toEqual([{ at: 4.7, duration: 4.6, rect: [704, 386, 1152, 648] }]);
  });

  it('leaves out a short one, a menu, one on another monitor, one in sped-up waiting, and one under another zoom', () => {
    expect(dialogZooms([dialog(5, true), dialog(5.5, false)], clips, screen)).toEqual([]);
    expect(dialogZooms([{ t: 5, type: 'window', id: 6, kind: 'menu', rect: [900, 500, 200, 300], open: true }], clips, screen)).toEqual([]);
    expect(dialogZooms([dialog(5, true, 7, [-1200, 500, 760, 420])], clips, screen)).toEqual([]);
    expect(dialogZooms([dialog(25, true), dialog(35, false)], clips, screen)).toEqual([]);
    expect(dialogZooms([dialog(5, true), dialog(9, false)], clips, screen, [{ at: 8, duration: 3 }])).toEqual([]);
  });

  it('lasts to its clip\'s end when it never closed', () => {
    expect(dialogZooms([dialog(17, true)], clips, screen)).toEqual([{ at: 16.7, duration: 3.3, rect: [704, 386, 1152, 648] }]);
  });
});
```

Run: `pnpm exec vitest run --project node packages/core/test/crop.test.ts`
Expected: FAIL: `../src/suggest/crop` does not exist.

- [ ] **Step 2: The rules**

`packages/core/src/suggest/crop.ts`:

```ts
// The crop: the part of the screen a clip shows, so a browser's tabs and bars, a taskbar or a side
// bar stay out of the video. It comes from the recorder's `area` events (the content area of the
// window shown) where there are any, else from the picture: the edge bands that hardly change while
// the middle does. Pure: `suggest` reads the picture's statistics for it.
import type { InputEvent, Rect } from '@cuttle/project';

export const CROP_RULES = {
  /** A content area that moved less than this (px) is the same… */
  slack: 8,
  /** …and it counts once it held this long (source s); a shorter one goes to the stretch before. */
  hold: 2,
  /** No crop when it covers this share of the screen or more… */
  maxShare: 0.95,
  /** …or less than this. */
  minShare: 0.3,
  /** An area less than this share inside the screen is another monitor's or window's: none. */
  inside: 0.9,
  /** An edge band: rows (columns) from the edge inward that change less than this share of the middle's… */
  band: 0.05,
  /** …where the middle changes at least this share of its pixels between frames (else no crop). */
  minMiddle: 0.002,
  /** No piece of a clip shorter than this (source s): it goes to its neighbour. */
  minPiece: 0.5,
};

/** A content area as a crop of the screen: the part inside it, when that is neither (nearly) all of the screen nor too little. */
export function cropOf(rect: Rect | null | undefined, screen: { width: number; height: number }, rules = CROP_RULES): Rect | undefined {
  if (!rect) return undefined;
  const [x, y, width, height] = rect;
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(screen.width, x + width);
  const bottom = Math.min(screen.height, y + height);
  if (right <= left || bottom <= top) return undefined;
  const inside = (right - left) * (bottom - top);
  if (inside < rules.inside * width * height) return undefined;
  const share = inside / (screen.width * screen.height);
  if (share >= rules.maxShare || share < rules.minShare) return undefined;
  return [Math.round(left), Math.round(top), Math.round(right - left), Math.round(bottom - top)];
}

/** A stretch of the take (source seconds) with the crop it gets, or none. */
export interface CropStretch {
  from: number;
  to: number;
  rect?: Rect;
}

const near = (a: Rect | undefined, b: Rect | undefined, slack: number) => a === b || (!!a && !!b && a.every((value, k) => Math.abs(value - b[k]!) <= slack));

/**
 * The take's stretches by the content area the recorder saw, each with its crop (or none), from 0 to
 * `duration`; none without `area` events. Areas within `slack` are one; one that held less than `hold`
 * belongs to the stretch before it.
 */
export function areaStretches(events: readonly InputEvent[], duration: number, screen: { width: number; height: number }, rules = CROP_RULES): CropStretch[] {
  const areas = events.flatMap((event) => (event.type === 'area' ? [event] : [])).sort((a, b) => a.t - b.t);
  const stretches: CropStretch[] = [];
  areas.forEach((area, i) => {
    const stretch = { from: i === 0 ? 0 : area.t, to: areas[i + 1]?.t ?? duration, rect: cropOf(area.rect, screen, rules) };
    if (stretch.to <= stretch.from) return;
    const last = stretches.at(-1);
    if (last && (near(last.rect, stretch.rect, rules.slack) || stretch.to - stretch.from < rules.hold)) last.to = stretch.to;
    else stretches.push(stretch);
  });
  // a short first one goes to the next
  if (stretches.length > 1 && stretches[0]!.to - stretches[0]!.from < rules.hold) {
    stretches[1]!.from = stretches[0]!.from;
    stretches.shift();
  }
  return stretches.map(({ rect, ...span }) => ({ ...span, ...(rect && { rect }) }));
}

/**
 * Each clip cut where the crop changes inside it (at the stretches' edges), each piece with its
 * crop; a piece shorter than `minPiece` goes to its neighbour.
 */
export function cropPieces<T extends { from: number; to: number }>(clips: readonly T[], stretches: readonly CropStretch[], rules = CROP_RULES): { clip: T; from: number; to: number; rect?: Rect }[] {
  return clips.flatMap((clip) => {
    const pieces: { clip: T; from: number; to: number; rect?: Rect }[] = [];
    for (const stretch of stretches) {
      if (stretch.to <= clip.from || stretch.from >= clip.to) continue;
      const piece = { clip, from: Math.max(clip.from, stretch.from), to: Math.min(clip.to, stretch.to), ...(stretch.rect && { rect: stretch.rect }) };
      const last = pieces.at(-1);
      if (last && (near(last.rect, piece.rect, 0) || piece.to - piece.from < rules.minPiece)) last.to = piece.to;
      else pieces.push(piece);
    }
    if (pieces.length === 0) return [{ clip, from: clip.from, to: clip.to }];
    if (pieces.length > 1 && pieces[0]!.to - pieces[0]!.from < rules.minPiece) {
      pieces[1]!.from = pieces[0]!.from;
      pieces.shift();
    }
    pieces[0]!.from = clip.from;
    pieces.at(-1)!.to = clip.to;
    return pieces;
  });
}

/** How much each row and column of the picture changed between frames: a share of its pixels, on average. */
export interface ScreenBands {
  rows: readonly number[];
  cols: readonly number[];
  frames: number;
}

/**
 * The crop from the picture alone: the bands from each edge inward whose rows (columns) change
 * less than `band` as much as the middle's. None when the middle hardly changes, or when what is
 * left is no crop (`cropOf`).
 */
export function bandCrop(bands: ScreenBands, screen: { width: number; height: number }, rules = CROP_RULES): Rect | undefined {
  const { rows, cols } = bands;
  if (bands.frames < 2 || rows.length === 0 || cols.length === 0) return undefined;
  const middle = (list: readonly number[]) => {
    const part = list.slice(Math.floor(list.length * 0.3), Math.ceil(list.length * 0.7));
    return part.reduce((sum, value) => sum + value, 0) / Math.max(1, part.length);
  };
  const [rowMiddle, colMiddle] = [middle(rows), middle(cols)];
  if (Math.min(rowMiddle, colMiddle) < rules.minMiddle) return undefined;
  const band = (list: readonly number[], limit: number, fromEnd: boolean) => {
    let count = 0;
    for (const value of fromEnd ? [...list].reverse() : list) {
      if (value > limit) break;
      count++;
    }
    return count;
  };
  const top = band(rows, rowMiddle * rules.band, false);
  const bottom = band(rows, rowMiddle * rules.band, true);
  const left = band(cols, colMiddle * rules.band, false);
  const right = band(cols, colMiddle * rules.band, true);
  if (top + bottom >= rows.length || left + right >= cols.length) return undefined;
  const [sx, sy] = [screen.width / cols.length, screen.height / rows.length];
  return cropOf([left * sx, top * sy, (cols.length - left - right) * sx, (rows.length - top - bottom) * sy], screen, rules);
}
```

`packages/core/src/suggest/dialogs.ts`:

```ts
// Zooms on dialogs: a dialog that stays open at least a second over the screen gets a zoom on it,
// padded, from just before it opens to just after it closes. The recorder logs when one opens and
// closes (`window` events). Pure.
import type { InputEvent, Rect } from '@cuttle/project';
import type { ClipSpan } from '@cuttle/timeline';

export const DIALOG_RULES = {
  /** A dialog open at least this long (output s) gets a zoom… */
  minOpen: 1,
  /** …from this long before it opens to this long after it closes (output s). */
  before: 0.3,
  after: 0.3,
  /** Room around the dialog: this share of its larger side… */
  pad: 0.15,
  /** …in a view at least this share of the screen's width (at most about 2.2×). */
  minWidth: 0.45,
  /** A dialog less than this share inside the screen is on another monitor: none. */
  inside: 0.9,
  /** A zoom that would show more than this share of the screen's area barely zooms: none. */
  maxArea: 0.8,
  /** Dialogs in clips faster than this are not zoomed (waiting sped up). */
  maxSpeed: 2,
};

export interface DialogZoom {
  at: number;
  duration: number;
  rect: Rect;
}

/**
 * The zooms for the dialogs in `clips`, in source seconds and pixels: each from `before` its opening
 * to `after` its closing (the take's end when it never closed), inside the clip it opened in, padded
 * as a click zoom is. None overlaps a zoom of `avoid` or another dialog's.
 */
export function dialogZooms(events: readonly InputEvent[], clips: readonly ClipSpan[], screen: { width: number; height: number }, avoid: readonly { at: number; duration: number }[] = [], rules = DIALOG_RULES): DialogZoom[] {
  const windows = events.flatMap((event) => (event.type === 'window' && event.kind === 'dialog' ? [event] : [])).sort((a, b) => a.t - b.t);
  const result: DialogZoom[] = [];
  for (const opened of windows.filter((event) => event.open)) {
    const clip = clips.find((span) => opened.t >= span.from && opened.t < span.to);
    if (!clip || clip.speed > rules.maxSpeed) continue;
    const closed = windows.find((event) => !event.open && event.id === opened.id && event.t > opened.t)?.t ?? clip.to;
    const s = clip.speed;
    if ((Math.min(closed, clip.to) - opened.t) / s < rules.minOpen) continue;
    const [x, y, width, height] = opened.rect;
    const inside = Math.max(0, Math.min(screen.width, x + width) - Math.max(0, x)) * Math.max(0, Math.min(screen.height, y + height) - Math.max(0, y));
    if (inside < rules.inside * width * height) continue;
    const rect = dialogRect(opened.rect, screen, rules);
    if ((rect[2] * rect[3]) / (screen.width * screen.height) > rules.maxArea) continue;
    const at = Math.max(clip.from, opened.t - rules.before * s);
    const end = Math.min(clip.to, closed + rules.after * s);
    if ([...avoid, ...result].some((other) => at < other.at + other.duration && other.at < end)) continue;
    result.push({ at: round(at), duration: round(end - at), rect });
  }
  return result;
}

/** The view on a dialog: padded by `pad` of its larger side, at least `minWidth` wide, in the screen's shape, on the screen. */
function dialogRect([x, y, width, height]: Rect, screen: { width: number; height: number }, rules: typeof DIALOG_RULES): Rect {
  const aspect = screen.width / screen.height;
  const pad = rules.pad * Math.max(width, height);
  let w = Math.max(width + 2 * pad, (height + 2 * pad) * aspect, rules.minWidth * screen.width);
  w = Math.min(w, screen.width);
  const h = Math.min(w / aspect, screen.height);
  const left = Math.min(Math.max(x + width / 2 - w / 2, 0), screen.width - w);
  const top = Math.min(Math.max(y + height / 2 - h / 2, 0), screen.height - h);
  return [Math.round(left), Math.round(top), Math.round(w), Math.round(h)];
}

const round = (value: number) => Math.round(value * 1000) / 1000;
```

- [ ] **Step 3: The keyframes' statistics, and both in `suggest`**

In `packages/core/src/ffmpeg.ts`, replace:

```ts
  return process.env.CUTTLE_FFMPEG || 'ffmpeg';
}

/** Runs ffmpeg and returns stdout (bytes) and stderr (text); a non-zero exit is a CoreError with the end of the log. */
export function runFfmpeg(args: readonly string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error: NodeJS.ErrnoException) =>
```

with:

```ts
  return process.env.CUTTLE_FFMPEG || 'ffmpeg';
}

/**
 * Runs ffmpeg and returns stdout (bytes) and stderr (text); a non-zero exit is a CoreError with the
 * end of the log. With `onStdout`, stdout goes there as it comes (the result's is then empty).
 */
export function runFfmpeg(args: readonly string[], onStdout?: (chunk: Buffer) => void): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (onStdout ? onStdout(chunk) : out.push(chunk)));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error: NodeJS.ErrnoException) =>
```

In `packages/core/src/suggest/media.ts`, replace:

```ts
// What suggest needs from the screen track, read with ffmpeg.
import { CoreError } from '../errors';
import { runFfmpeg } from '../ffmpeg';
import type { Span } from './spans';

export interface ScreenAnalysis {
```

with:

```ts
// What suggest needs from the screen track, read with ffmpeg.
import { CoreError } from '../errors';
import { runFfmpeg } from '../ffmpeg';
import type { ScreenBands } from './crop';
import type { Span } from './spans';

export interface ScreenAnalysis {
```

In the same file, replace:

```ts
  return { duration, width: Number(size?.[1] ?? 0), height: Number(size?.[2] ?? 0), still };
}

/** Size and length of the screen track from a pass that copies its packets (fast: nothing is decoded). */
export async function probeScreen(path: string): Promise<{ duration: number; width: number; height: number }> {
  const { stderr } = await runFfmpeg(['-i', path, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
```

with:

```ts
  return { duration, width: Number(size?.[1] ?? 0), height: Number(size?.[2] ?? 0), still };
}

/** A pixel whose grey value moved more than this between frames changed (video noise does not). */
const BAND_THRESHOLD = 6;

/**
 * How much each row and column of the screen track changed from keyframe to keyframe (a keyframe
 * every 2 s in Cuttle's takes: only those are decoded, so a long take is read quickly), 640 px wide.
 */
export async function screenBands(path: string, size: { width: number; height: number }): Promise<ScreenBands> {
  const width = 640;
  const height = 2 * Math.round((width * size.height) / size.width / 2);
  const area = width * height;
  const rows = new Float64Array(height);
  const cols = new Float64Array(width);
  let previous: Buffer | undefined;
  let pending: Buffer = Buffer.alloc(0);
  let frames = 0;
  await runFfmpeg(['-skip_frame', 'nokey', '-i', path, '-map', '0:v:0', '-vf', `scale=${width}:${height}:flags=area,format=gray`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'], (chunk) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    while (pending.length >= area) {
      const frame = pending.subarray(0, area);
      pending = pending.subarray(area);
      if (previous) {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (Math.abs(frame[i]! - previous[i]!) > BAND_THRESHOLD) {
              rows[y]!++;
              cols[x]!++;
            }
          }
        }
      }
      previous = frame;
      frames++;
    }
  });
  const pairs = Math.max(1, frames - 1);
  return { rows: Array.from(rows, (count) => count / (pairs * width)), cols: Array.from(cols, (count) => count / (pairs * height)), frames };
}

/** Size and length of the screen track from a pass that copies its packets (fast: nothing is decoded). */
export async function probeScreen(path: string): Promise<{ duration: number; width: number; height: number }> {
  const { stderr } = await runFfmpeg(['-i', path, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
```

In `packages/core/src/suggest.ts`, replace:

```ts
import { clickZooms, sceneSpans, shownClicks } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
import { analyseScreen, grabGray, grayFrames } from './suggest/media';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { screenStretches, typingZooms, type ScreenChange } from './suggest/typing';
```

with:

```ts
import { clickZooms, sceneSpans, shownClicks } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
import { areaStretches, bandCrop, cropPieces, type CropStretch } from './suggest/crop';
import { dialogZooms } from './suggest/dialogs';
import { analyseScreen, grabGray, grayFrames, screenBands } from './suggest/media';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { screenStretches, typingZooms, type ScreenChange } from './suggest/typing';
```

In the same file, replace:

```ts
  clickZooms?: boolean;
  /** Zooms that follow typing (default true; `zoom: false` turns them off too). */
  typingZooms?: boolean;
  /**
   * The mic's speech (default true): it is kept and never sped up, and the transcript's filler words
   * and pauses are cut where the picture rests.
```

with:

```ts
  clickZooms?: boolean;
  /** Zooms that follow typing (default true; `zoom: false` turns them off too). */
  typingZooms?: boolean;
  /** Zooms on dialogs (default true; `zoom: false` turns them off too). */
  dialogZooms?: boolean;
  /** Crops each clip to the content (default true): the window's content area, else the picture's still edges. */
  crop?: boolean;
  /**
   * The mic's speech (default true): it is kept and never sped up, and the transcript's filler words
   * and pauses are cut where the picture rests.
```

In the same file, replace:

```ts
  onProgress?: (fraction: number) => void;
}

type ClipScene = { type: 'clip'; id: string; label?: string; from: number; to: number; speed?: number };

export interface SuggestResult {
  project: string;
```

with:

```ts
  onProgress?: (fraction: number) => void;
}

/** A clip's crop as written to cuttle.json. */
type ClipCrop = { rect: Rect; enabled?: boolean; auto?: 'crop' };
type ClipScene = { type: 'clip'; id: string; label?: string; from: number; to: number; speed?: number; crop?: ClipCrop };

export interface SuggestResult {
  project: string;
```

In the same file, replace:

```ts
  // Every id of the file as read, also those of the clips and zoom being replaced: an id that an
  // editor or an undo step still holds must never name a different item.
  const taken = usedIds(file.raw);
  const clips: ClipScene[] = suggestion.clips.map(({ from: start, to, speed, label }) => ({
    type: 'clip',
    id: newId('scenes', taken),
    ...(label !== undefined && { label }),
    from: start,
    to,
    ...(speed !== 1 && { speed }),
  }));
  if (before.length + after.length > 0) {
    notes.push(`kept ${before.length + after.length} still or card scene(s)${before.length > 0 ? `, ${before.length} before the clips` : ''}`);
  }
```

with:

```ts
  // Every id of the file as read, also those of the clips and zoom being replaced: an id that an
  // editor or an undo step still holds must never name a different item.
  const taken = usedIds(file.raw);
  // The crop: what each clip shows of the screen; a clip is cut where the content area changes for good.
  const crops = args.crop !== false && file.project.autoEdits.crop ? await cropsFor(screen, events, screenInfo, previous, notes) : undefined;
  const pieces = crops ? cropPieces(suggestion.clips, crops.stretches) : suggestion.clips.map((clip) => ({ clip, from: clip.from, to: clip.to }));
  const clips: ClipScene[] = pieces.map(({ clip: { speed, label }, from: start, to, ...piece }) => {
    const rect = (piece as { rect?: Rect }).rect;
    const crop = rect ? crops?.crop(rect, start, to) : crops?.kept(start, to);
    return {
      type: 'clip',
      id: newId('scenes', taken),
      ...(label !== undefined && { label }),
      from: start,
      to,
      ...(speed !== 1 && { speed }),
      ...(crop && { crop }),
    };
  });
  if (before.length + after.length > 0) {
    notes.push(`kept ${before.length + after.length} still or card scene(s)${before.length > 0 ? `, ${before.length} before the clips` : ''}`);
  }
```

In the same file, replace:

```ts
  }
  // The zooms suggest made before are replaced; the others stay, and the new ones avoid them.
  const rawZooms = (file.raw.zooms as SuggestedZoom[] | undefined) ?? [];
  const isOurs = (zoom: { auto?: string }) => zoom.auto === 'answer' || zoom.auto === 'typing' || zoom.auto === 'click';
  const kept = rawZooms.filter((zoom) => !isOurs(zoom));
  const switchedOff = file.project.zooms.filter((zoom) => isOurs(zoom) && !zoom.enabled);
  if (kept.length > 0) notes.push(`kept ${kept.length} zoom${kept.length === 1 ? '' : 's'} made or changed by hand`);
  const zooms: SuggestedZoom[] = [];
  const add = (zoom: SuggestedZoom & { auto: 'answer' | 'typing' | 'click' }) => zooms.push(staysOff(zoom, switchedOff) ? { ...zoom, enabled: false } : zoom);
  const first = suggestion.clips[0];
  const last = suggestion.clips.at(-1);
  const keptOverlaps = (at: number, end: number) => kept.some((zoom) => at < zoom.at + zoom.duration && zoom.at < end);
```

with:

```ts
  }
  // The zooms suggest made before are replaced; the others stay, and the new ones avoid them.
  const rawZooms = (file.raw.zooms as SuggestedZoom[] | undefined) ?? [];
  const isOurs = (zoom: { auto?: string }) => zoom.auto === 'answer' || zoom.auto === 'dialog' || zoom.auto === 'typing' || zoom.auto === 'click';
  const kept = rawZooms.filter((zoom) => !isOurs(zoom));
  const switchedOff = file.project.zooms.filter((zoom) => isOurs(zoom) && !zoom.enabled);
  if (kept.length > 0) notes.push(`kept ${kept.length} zoom${kept.length === 1 ? '' : 's'} made or changed by hand`);
  const zooms: SuggestedZoom[] = [];
  const add = (zoom: SuggestedZoom & { auto: 'answer' | 'dialog' | 'typing' | 'click' }) => zooms.push(staysOff(zoom, switchedOff) ? { ...zoom, enabled: false } : zoom);
  const first = suggestion.clips[0];
  const last = suggestion.clips.at(-1);
  const keptOverlaps = (at: number, end: number) => kept.some((zoom) => at < zoom.at + zoom.duration && zoom.at < end);
```

In the same file, replace:

```ts
  const parsed = parseProject({ ...file.raw, scenes, ...(cuts && { cuts }), zooms: [] });
  const spans = parsed.ok ? sceneSpans(parsed.project.scenes, parsed.project.cuts) : [];
  const shown = spans.flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
  if (args.zoom !== false && args.typingZooms !== false && file.project.autoEdits.typingZooms && events.some((event) => event.type === 'keys')) {
    // where the text goes: the caret, else what the screen changes while keys are typed
    const changes = await typingChanges(screen, screenStretches(events, shown, screenInfo), screenInfo);
```

with:

```ts
  const parsed = parseProject({ ...file.raw, scenes, ...(cuts && { cuts }), zooms: [] });
  const spans = parsed.ok ? sceneSpans(parsed.project.scenes, parsed.project.cuts) : [];
  const shown = spans.flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
  if (args.zoom !== false && args.dialogZooms !== false && file.project.autoEdits.dialogZooms && events.some((event) => event.type === 'window')) {
    const opened = dialogZooms(events, shown, screenInfo, [...kept, ...zooms]);
    for (const zoom of opened) add({ id: newId('zooms', taken), label: 'Dialog', at: zoom.at, duration: zoom.duration, rect: zoom.rect, auto: 'dialog' });
    if (opened.length > 0) notes.push(`${opened.length} zoom${opened.length === 1 ? '' : 's'} on a dialog`);
  }
  if (args.zoom !== false && args.typingZooms !== false && file.project.autoEdits.typingZooms && events.some((event) => event.type === 'keys')) {
    // where the text goes: the caret, else what the screen changes while keys are typed
    const changes = await typingChanges(screen, screenStretches(events, shown, screenInfo), screenInfo);
```

In the same file, replace:

```ts
  });
}

/** What the screen changed in each stretch, frame by frame (`TYPING_RATE` a second), in screen pixels. */
async function typingChanges(screen: string, stretches: readonly { from: number; to: number }[], size: { width: number; height: number; duration: number }): Promise<ScreenChange[]> {
  const height = 2 * Math.round((TYPING_WIDTH * size.height) / size.width / 2);
```

with:

```ts
  });
}

/**
 * The crops of the new clips. From the recorder's content areas where the take has them, else one
 * from the picture's still edges for all clips. A crop the person made on an old clip stays on the
 * new ones it overlaps (and none is made there); one of Cuttle's they switched off stays off.
 */
async function cropsFor(
  screen: string,
  events: readonly InputEvent[],
  screenInfo: { width: number; height: number; duration: number },
  previous: readonly Record<string, unknown>[],
  notes: string[],
): Promise<{ stretches: CropStretch[]; crop: (rect: Rect, from: number, to: number) => ClipCrop | undefined; kept: (from: number, to: number) => ClipCrop | undefined }> {
  type Old = { from: number; to: number; crop: ClipCrop };
  const old = previous.filter((scene): scene is Record<string, unknown> & Old => scene.type === 'clip' && typeof scene.crop === 'object' && scene.crop !== null);
  const over = (from: number, to: number) => old.filter((scene) => scene.from < to && from < scene.to);
  /** A crop made by hand on a clip that showed this stretch. */
  const kept = (from: number, to: number) => over(from, to).find((scene) => scene.crop.auto === undefined)?.crop;
  const crop = (rect: Rect, from: number, to: number): ClipCrop | undefined => {
    const mine = kept(from, to);
    if (mine) return mine;
    const off = over(from, to).some((scene) => scene.crop.auto === 'crop' && scene.crop.enabled === false && alike(scene.crop.rect, rect));
    return { rect, auto: 'crop', ...(off && { enabled: false }) };
  };
  let stretches = areaStretches(events, screenInfo.duration, screenInfo);
  if (stretches.length > 0) {
    const cropped = stretches.filter((stretch) => stretch.rect).length;
    notes.push(cropped > 0 ? `cropped to the window's content area (${cropped} stretch${cropped === 1 ? '' : 'es'}, from the recorder)` : 'no crop: the windows shown had no content area to crop to');
  } else {
    const rect = bandCrop(await screenBands(screen, screenInfo), screenInfo);
    stretches = [{ from: 0, to: screenInfo.duration, ...(rect && { rect }) }];
    notes.push(rect ? `cropped to ${rect.join(', ')}: the screen's edges that hardly change (tabs, bars, a taskbar) are left out` : 'no crop: no still edges around what changes');
  }
  return { stretches, crop, kept };
}

/** Two rects at least half alike (intersection over union). */
function alike(a: Rect, b: Rect): boolean {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  const inter = w > 0 && h > 0 ? w * h : 0;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter) >= 0.5;
}

/** What the screen changed in each stretch, frame by frame (`TYPING_RATE` a second), in screen pixels. */
async function typingChanges(screen: string, stretches: readonly { from: number; to: number }[], size: { width: number; height: number; duration: number }): Promise<ScreenChange[]> {
  const height = 2 * Math.round((TYPING_WIDTH * size.height) / size.width / 2);
```

In `packages/core/src/index.ts`, replace:

```ts
export { applySpeechEdits, speechActivity, withSpeechCuts, wordStretches, type SpeechCutsInput, type SpeechCutsResult, type SpeechEditsResult } from './speech/apply';
export { RETAKE_RULES, retakeCuts, spokenCues, type RetakeCut, type RetakeInput, type SpokenCue } from './speech/retakes';
export { TYPING_RULES, keyBursts, screenStretches, typingZooms, type Burst, type ScreenChange, type TypingInput, type TypingZoom } from './suggest/typing';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
```

with:

```ts
export { applySpeechEdits, speechActivity, withSpeechCuts, wordStretches, type SpeechCutsInput, type SpeechCutsResult, type SpeechEditsResult } from './speech/apply';
export { RETAKE_RULES, retakeCuts, spokenCues, type RetakeCut, type RetakeInput, type SpokenCue } from './speech/retakes';
export { TYPING_RULES, keyBursts, screenStretches, typingZooms, type Burst, type ScreenChange, type TypingInput, type TypingZoom } from './suggest/typing';
export { CROP_RULES, areaStretches, bandCrop, cropOf, cropPieces, type CropStretch, type ScreenBands } from './suggest/crop';
export { DIALOG_RULES, dialogZooms, type DialogZoom } from './suggest/dialogs';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
```

- [ ] **Step 4: Facts are no activity**

In `packages/core/src/suggest/plan.ts`, replace:

```ts
// Scenes from what happened in a take: trim the quiet start and end, cut idle stretches, speed up
// waiting. Pure: the inputs come from events.jsonl, markers.json and an ffmpeg pass over the screen.
import type { InputEvent, Marker } from '@cuttle/project';
import { gaps, length, union, type Span } from './spans';

/** The rules, in seconds of the take. */
```

with:

```ts
// Scenes from what happened in a take: trim the quiet start and end, cut idle stretches, speed up
// waiting. Pure: the inputs come from events.jsonl, markers.json and an ffmpeg pass over the screen.
import { isFact, type InputEvent, type Marker } from '@cuttle/project';
import { gaps, length, union, type Span } from './spans';

/** The rules, in seconds of the take. */
```

In the same file, replace:

```ts
  const prompt = input.markers.find((marker) => marker.kind === 'prompt')?.t;
  const inputSpans = union(
    input.events
      .filter((event) => event.type !== 'shape' && event.type !== 'caret')
      .map((event) => ({ from: Math.max(0, event.t - RULES.inputPad), to: Math.min(duration, event.t + RULES.inputPad) })),
  );
  // Claude's turn, from its first prompt or tool call to the answer, is never cut: it only waits on a
```

with:

```ts
  const prompt = input.markers.find((marker) => marker.kind === 'prompt')?.t;
  const inputSpans = union(
    input.events
      .filter((event) => !isFact(event))
      .map((event) => ({ from: Math.max(0, event.t - RULES.inputPad), to: Math.min(duration, event.t + RULES.inputPad) })),
  );
  // Claude's turn, from its first prompt or tool call to the answer, is never cut: it only waits on a
```

In `packages/core/src/speech/edits.ts`, replace:

```ts
// The speech edits: filler words and long pauses cut out where the picture rests. Pure: the inputs
// are the transcript, the screen's still stretches and the input events, in source seconds.
import { SHORT_SPELLINGS, fillerLexicon, newId, normWord, type InputEvent, type TranscriptWord } from '@cuttle/project';
import { gaps, union, type Span } from '../suggest/spans';

export const SPEECH_EDIT_RULES = {
```

with:

```ts
// The speech edits: filler words and long pauses cut out where the picture rests. Pure: the inputs
// are the transcript, the screen's still stretches and the input events, in source seconds.
import { SHORT_SPELLINGS, fillerLexicon, isFact, newId, normWord, type InputEvent, type TranscriptWord } from '@cuttle/project';
import { gaps, union, type Span } from '../suggest/spans';

export const SPEECH_EDIT_RULES = {
```

In the same file, replace:

```ts
  const spans: Span[] = [];
  let anchor: { x: number; y: number } | undefined;
  for (const event of events) {
    // the pointer's shape and the caret are facts about the screen, not input
    if (event.type === 'shape' || event.type === 'caret') continue;
    if (event.type === 'move') {
      if (anchor && Math.hypot(event.x - anchor.x, event.y - anchor.y) <= rules.pointerSlack) continue;
      const first = anchor === undefined;
```

with:

```ts
  const spans: Span[] = [];
  let anchor: { x: number; y: number } | undefined;
  for (const event of events) {
    // the pointer's shape, the caret, the content area and windows are facts about the screen, not input
    if (isFact(event)) continue;
    if (event.type === 'move') {
      if (anchor && Math.hypot(event.x - anchor.x, event.y - anchor.y) <= rules.pointerSlack) continue;
      const first = anchor === undefined;
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node packages/core`
Expected: PASS.

Run: `pnpm exec tsc -p packages/core/tsconfig.json`
Expected: exits with code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "core: suggest crops each clip to the content (the content area, else the still edges) and zooms on dialogs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The CLI

**Files:**
- Modify: `apps/cli/src/main.ts`, `apps/cli/test/cli.test.ts`

- [ ] **Step 1: The tests**

A new test generates a "browser": still bars at the top and on the left, and a page that changes everywhere. It checks:
- the crop from the picture;
- the crop from the content area, with the clip cut where a window without one comes to the front;
- `--no-crop`;
- a dialog zoom, and `--no-dialog-zooms`.

The answer test's snapshot gets the note that its moving box has no still edges.

In `apps/cli/test/cli.test.ts`, replace:

```ts
          "trimmed the quiet start (0.0–1.8 s)",
          "trimmed the quiet end (18.5–20.0 s)",
          "sped up 9.4 s without input 3× (5.1–14.5 s)",
          "zoom on Claude's answer at 15.5 s (145, 422, 448, 236)",
        ],
        "project": "<project>/cuttle.json",
```

with:

```ts
          "trimmed the quiet start (0.0–1.8 s)",
          "trimmed the quiet end (18.5–20.0 s)",
          "sped up 9.4 s without input 3× (5.1–14.5 s)",
          "no crop: no still edges around what changes",
          "zoom on Claude's answer at 15.5 s (145, 422, 448, 236)",
        ],
        "project": "<project>/cuttle.json",
```

In the same file, replace:

```ts
    expect(none.zooms.filter((zoom) => zoom.auto === 'typing')).toEqual([]);
  }, 60_000);

  it('leaves cuttle.json alone with --dry-run', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
```

with:

```ts
    expect(none.zooms.filter((zoom) => zoom.auto === 'typing')).toEqual([]);
  }, 60_000);

  it('crops each clip to the content: from the window\'s content area, cut where it changes, else from the picture', async () => {
    const dir = temp();
    mkdirSync(join(dir, 'takes', '1'), { recursive: true });
    // a 1280×720 "browser": still bars at the top (100 px) and on the left (80 px), and a page that
    // changes everywhere (a game of life); a keyframe a second, as Cuttle's recorder writes one every 2
    const graph = 'color=c=0x30343c:s=1280x720:r=30:d=12,drawbox=x=0:y=0:w=1280:h=100:color=0x4a4f5a:t=fill,drawbox=x=0:y=0:w=80:h=720:color=0x262a30:t=fill[bg];life=s=1200x620:r=30:mold=10:ratio=0.5:death_color=0x101010:life_color=0xe0e0e0[page];[bg][page]overlay=x=80:y=100';
    const made = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', graph, '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-pix_fmt', 'yuv420p', '-y', join(dir, 'takes', '1', 'screen.mp4')]);
    expect(made.status, String(made.stderr)).toBe(0);
    const keys = Array.from({ length: 20 }, (_, k) => ({ t: 1 + 0.5 * k, type: 'keys', count: 1 }));
    const write = (events: unknown[]) => writeFileSync(join(dir, 'takes', '1', 'events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    write(keys);
    writeFileSync(join(dir, 'takes', '1', 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 } } }));
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', events: 'takes/1/events.jsonl' } }));
    type Result = { scenes: { from: number; to: number; crop?: { rect: number[]; auto?: string; enabled?: boolean } }[]; zooms: { auto?: string; label?: string; at: number; rect: number[] }[]; notes: string[] };
    const suggest = async (...flags: string[]) => (await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-typing-zooms', ...flags)).json as Result;
    // without the recorder's content area: the still edges of the picture are left out
    const picture = await suggest();
    expect(picture.scenes).toHaveLength(1);
    const [x, y, width, height] = picture.scenes[0]!.crop!.rect;
    expect([Math.abs(x! - 80) <= 4, Math.abs(y! - 100) <= 4, Math.abs(x! + width! - 1280) <= 4, Math.abs(y! + height! - 720) <= 4]).toEqual([true, true, true, true]);
    expect(picture.scenes[0]!.crop!.auto).toBe('crop');
    expect(picture.notes.some((note) => note.startsWith('cropped to ') && note.includes("the screen's edges that hardly change"))).toBe(true);
    // with it: the area the recorder saw, and the clip cut where another window (without one) came to the front at 7 s
    write([{ t: 0.2, type: 'area', rect: [80, 100, 1200, 620] }, { t: 7, type: 'area', rect: null }, ...keys].sort((a, b) => a.t - b.t));
    const area = await suggest();
    expect(area.scenes.map((scene) => [scene.from, scene.to, scene.crop?.rect])).toEqual([
      [area.scenes[0]!.from, 7, [80, 100, 1200, 620]],
      [7, area.scenes[1]!.to, undefined],
    ]);
    expect(area.notes).toContain("cropped to the window's content area (1 stretch, from the recorder)");
    expect((await suggest('--no-crop')).scenes.every((scene) => scene.crop === undefined)).toBe(true);
    // a dialog open from 3 to 5 s gets a zoom on it
    write([{ t: 3, type: 'window', id: 77, kind: 'dialog', rect: [440, 260, 400, 200], open: true }, { t: 5, type: 'window', id: 77, kind: 'dialog', rect: [440, 260, 400, 200], open: false }, ...keys].sort((a, b) => a.t - b.t));
    const dialog = await suggest();
    expect(dialog.zooms).toEqual([expect.objectContaining({ label: 'Dialog', auto: 'dialog', at: 2.7, duration: 2.6 })]);
    expect(dialog.notes).toContain('1 zoom on a dialog');
    expect((await suggest('--no-dialog-zooms')).zooms).toEqual([]);
  }, 60_000);

  it('leaves cuttle.json alone with --dry-run', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
```

- [ ] **Step 2: The flags**

In `apps/cli/src/main.ts`, replace:

```ts

  program
    .command('suggest')
    .description('propose scenes (quiet start and end trimmed, idle cut, waiting sped up), a zoom on the answer, zooms that follow typing and zooms on clicks')
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer, nor on typing, nor on clicks)')
    .option('--no-typing-zooms', 'no zooms that follow typing')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-speech', 'leave the speech out: no filler, pause or spoken retake cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, options: { claude?: string | true; zoom: boolean; typingZooms: boolean; clickZooms: boolean; speech: boolean; transcribe: boolean; dryRun?: boolean }) =>
        suggestCommand(project, options, output),
      ),
    );
```

with:

```ts

  program
    .command('suggest')
    .description('propose scenes (quiet start and end trimmed, idle cut, waiting sped up, cropped to the content), a zoom on the answer, zooms on dialogs, zooms that follow typing and zooms on clicks')
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer, nor on dialogs, nor on typing, nor on clicks)')
    .option('--no-crop', 'no crop to the content (a browser\'s page without its tabs and bars)')
    .option('--no-dialog-zooms', 'no zooms on dialogs')
    .option('--no-typing-zooms', 'no zooms that follow typing')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-speech', 'leave the speech out: no filler, pause or spoken retake cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, options: { claude?: string | true; zoom: boolean; crop: boolean; dialogZooms: boolean; typingZooms: boolean; clickZooms: boolean; speech: boolean; transcribe: boolean; dryRun?: boolean }) =>
        suggestCommand(project, options, output),
      ),
    );
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cli
git commit -m "cli: suggest --no-crop and --no-dialog-zooms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The timeline's input lane

**Files:**
- Modify: `apps/desktop/src/shared/timeline-model.ts`, `apps/desktop/test/timeline-model.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/test/timeline-model.test.ts`, replace:

```ts
    // click at 8.2 s is cut out
    expect(activityColumns(events, spans, 0, 5, 5)).toEqual([0, 1 / 3.25, 0, 1, 0]);
    expect(activityColumns([], spans, 0, 5, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('takes the loudest peak of the source each column plays and leaves muted clips silent', () => {
```

with:

```ts
    // click at 8.2 s is cut out
    expect(activityColumns(events, spans, 0, 5, 5)).toEqual([0, 1 / 3.25, 0, 1, 0]);
    expect(activityColumns([], spans, 0, 5, 5)).toEqual([0, 0, 0, 0, 0]);
    // facts about the screen are no input
    const facts: InputEvent[] = [
      { t: 1, type: 'caret', rect: [10, 10, 2, 18] },
      { t: 1, type: 'area', rect: [0, 80, 1280, 640] },
      { t: 1, type: 'window', id: 3, kind: 'dialog', rect: [400, 300, 400, 200], open: true },
    ];
    expect(activityColumns(facts, spans, 0, 5, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('takes the loudest peak of the source each column plays and leaves muted clips silent', () => {
```

Run: `pnpm exec vitest run --project node apps/desktop/test/timeline-model.test.ts`
Expected: FAIL: the area and the window count as input.

- [ ] **Step 2: `isFact`**

In `apps/desktop/src/shared/timeline-model.ts`, replace:

```ts
// What the editor's timeline draws, in output seconds: pure, so it is tested without a window.
import type { AutoKind, CuttleProject, InputEvent, Marker, MarkerKind } from '@cuttle/project';
import { occurrences, type SceneSpan } from '@cuttle/timeline';
import { formatDuration } from './format';
```

with:

```ts
// What the editor's timeline draws, in output seconds: pure, so it is tested without a window.
import { isFact, type AutoKind, type CuttleProject, type InputEvent, type Marker, type MarkerKind } from '@cuttle/project';
import { occurrences, type SceneSpan } from '@cuttle/timeline';
import { formatDuration } from './format';
```

In the same file, replace:

```ts
  const width = (to - from) / columns;
  if (!(width > 0)) return counts;
  for (const event of events) {
    if (event.type === 'shape' || event.type === 'caret') continue;
    const weight = event.type === 'move' ? 0.25 : event.type === 'keys' ? event.count : 1;
    for (const t of outputTimesOf(spans, event.t)) {
      const column = Math.floor((t - from) / width);
```

with:

```ts
  const width = (to - from) / columns;
  if (!(width > 0)) return counts;
  for (const event of events) {
    if (isFact(event)) continue;
    const weight = event.type === 'move' ? 0.25 : event.type === 'keys' ? event.count : 1;
    for (const t of outputTimesOf(spans, event.t)) {
      const column = Math.floor((t - from) / width);
```

- [ ] **Step 3: Run the test and the typecheck**

Run: `pnpm exec vitest run --project node apps/desktop/test/timeline-model.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop
git commit -m "desktop: the facts about the screen are no input on the timeline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The skill

**Files:**
- Modify: `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`

- [ ] **Step 1: The crop, dialog zooms and the events**

In `skill/cuttle/SKILL.md`, replace:

````markdown
```

`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work),
zooms on Claude's answer, zooms in where someone types and follows the text along ("Typing": the
camera moves on as the text leaves the middle of the view; `--no-typing-zooms` leaves those out),
and zooms where clicks happen at normal speed ("Click", "Clicks"; `--no-click-zooms` leaves those
out, `--no-zoom` every zoom). Its `notes` say what it did, in
source seconds. It replaces every clip and the zooms it made before (tagged `auto`; masks, texts,
cuts, stills, cards and zooms made by hand stay), so run it once, before your hand edits. Its clips and zooms have ids, and labels where Claude's markers say
what they show ("Claude at work", "Answer"): keep them when you edit, and give items you add an
````

with:

````markdown
```

`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work),
and crops each clip to the content: a browser's page without its tabs and bars, without the
taskbar (from the window's content area the recorder saw, else from the screen's still edges;
`--no-crop` leaves it out). It zooms on Claude's answer, on a dialog while it is open ("Dialog";
`--no-dialog-zooms`), in where someone types, following the text along ("Typing": the camera
moves on as the text leaves the middle of the view; `--no-typing-zooms`), and where clicks
happen at normal speed ("Click", "Clicks"; `--no-click-zooms`; `--no-zoom` leaves out every zoom). Its `notes` say what it did, in
source seconds. It replaces every clip and the zooms it made before (tagged `auto`; masks, texts,
cuts, stills, cards and zooms made by hand stay), so run it once, before your hand edits. Its clips and zooms have ids, and labels where Claude's markers say
what they show ("Claude at work", "Answer"): keep them when you edit, and give items you add an
````

In `skill/cuttle/project.md`, replace:

```markdown

| Type | Fields |
|---|---|
| `clip` | `from`, `to` (source seconds, `to` > `from`), `speed` (`1`, up to 64; above 1 a badge like "12× speed" shows), `badge` (custom badge text, `""` for none), `crop` (`{ "rect": [x, y, w, h], "enabled": true }`: the part of the screen the clip shows, e.g. a browser's page without its tabs; the window takes its shape and zooms stay inside it) |
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |
```

with:

```markdown

| Type | Fields |
|---|---|
| `clip` | `from`, `to` (source seconds, `to` > `from`), `speed` (`1`, up to 64; above 1 a badge like "12× speed" shows), `badge` (custom badge text, `""` for none), `crop` (`{ "rect": [x, y, w, h], "enabled": true }`: the part of the screen the clip shows, e.g. a browser's page without its tabs; the window takes its shape and zooms stay inside it; `suggest` makes it, tagged `auto: "crop"`, and cuts a clip where the content area changes for good) |
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |
```

In the same file, replace:

```markdown
- `takes/<n>/markers.json` lists the prompt, each tool call and Claude's answer in source seconds,
  and each press of the mistake key (kind `retake`).
- `takes/<n>/events.jsonl` has the input: `move`, `click` and `scroll` with `x` and `y`, `keys`
  (presses per half second, never which keys) and the pointer's `shape`; on Windows also `caret`
  with a `rect` (where text is typed, while it is, where the app keeps a system caret).
- `cuttle --json suggest` prints notes with source seconds (`sped up 112.9 s without input 12×
  (7.5–120.4 s)`).
- To get from output to source seconds by hand, walk the scenes. A clip lasts
```

with:

```markdown
- `takes/<n>/markers.json` lists the prompt, each tool call and Claude's answer in source seconds,
  and each press of the mistake key (kind `retake`).
- `takes/<n>/events.jsonl` has the input: `move`, `click` and `scroll` with `x` and `y`, `keys`
  (presses per half second, never which keys) and the pointer's `shape`. On Windows it also has
  facts about the screen: `caret` with a `rect` (where text is typed, while it is, where the app
  keeps a system caret), `area` with the `rect` of the content area of the window in front (a
  browser's page; `null` for none), and `window` when a `dialog` or `menu` opens or closes
  (`id`, `kind`, `rect`, `open`). No titles or text are logged.
- `cuttle --json suggest` prints notes with source seconds (`sped up 112.9 s without input 12×
  (7.5–120.4 s)`).
- To get from output to source seconds by hand, walk the scenes. A clip lasts
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run --project node skill/test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add skill
git commit -m "skill: the crop to the content, dialog zooms, and the area and window events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 636 passed and 52 skipped (on a machine without a speech model the real transcription is skipped too: 635 and 53).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `CUTTLE_HIDDEN=1 CUTTLE_RECORDER_BACKEND=test pnpm app:check`
Expected: PASS, 42 tests (the test pattern has no still edges: no crop there).

Run: `pnpm cli:check`
Expected: PASS, 5 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Record the whole screen while you show a page in a browser. `events.jsonl` has `area` lines. Once it is cut, the video shows the page without tabs, bookmarks and taskbar.
2. In the same take, switch to a terminal for a while: the clip is cut there, and that part is not cropped.
3. Open a dialog (File → Save as) for a few seconds: the video zooms on it. Open a menu: `events.jsonl` has a `window` line of kind `menu`, and no zoom comes.
4. A notification: note what `events.jsonl` says (nothing yet; notifications come in P4-M5).

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran once, on the prototype, whose tree the replay matches byte for byte: the task steps' tests, `pnpm test`, the typecheck, `app:check` and `cli:check`. The packaged build (`pnpm app:build`) ran on the replayed commits.
- The 12:12 take was read once by a probe that was not kept: only its row and column statistics, nothing of its picture.

**Found while checking, and already in the plan above**
- **Reading the whole take at 2 frames a second** for the picture crop would decode every frame of a long take again. Cuttle's takes have a keyframe every 2 s, so only keyframes are decoded (0.3 s for the 12:12 take).
- **A dialog's zoom with the click zooms' padding** barely zoomed. Dialogs are padded by their own size.
- **The answer test's snapshot** has the new note "no crop: no still edges around what changes".
- **The app checks' test pattern** (`testsrc2`) has no still edges, so its clips stay uncropped. A probe checked that before the run.
- **The events test did not typecheck** (an array literal of two kinds of event is not an `InputEvent[]`); it names the type.

**Spec points that move**
- **Notifications** are in the format, but the recorder does not tell them yet: a toast's window class is shared with other shell surfaces. They come with the notification masks in P4-M5.
- **Firefox's content window:** Firefox has no child window for its page, so the picture decides there.
- **The picture crop** reads keyframes (every 2 s) instead of 2 frames a second.

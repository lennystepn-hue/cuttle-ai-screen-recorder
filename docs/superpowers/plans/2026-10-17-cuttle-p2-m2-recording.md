# Cuttle P2-M2: Recording from the App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record from the app without pause: "New recording" (pill, tray, Ctrl+Shift+Alt+R) shows a picker over every display, a countdown over the target, then only a HUD; the stop lands in the editor on the raw take while `suggest` cuts it in the background; "Record again" adds a take to an open project and keeps the earlier one restorable.

**Architecture:** The recorder runs in its own utility process (the recorder host), so its input hook and koffi calls stay off the main process's event loop; the main process kills the ffmpeg captures it reported if the host dies. The picker is one transparent, content-protected window per display that hit-tests the recorder's window list locally (in DIP); the countdown and the HUD are content-protected, never focused, and the HUD's area is a dead zone for the input log. After the stop, `@cuttle/core`'s `useTake` points the project at the take, the editor opens on it at once, and the media worker runs `suggest` and reloads the editor when it is done. A failed capture that had started is repaired with `recoverTake` and opened like any other.

**Tech Stack:** Electron 44.7.2, React 19.3.0, koffi 3.3.2 and uiohook-napi 1.5.5 (in the recorder host), Playwright 1.64.1 (`_electron`), ffmpeg 9, vitest 5.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-desktop-design.md` (milestone P2-M2; sections "The flow", "Windows", "The picker in detail", "Recording in the app"). P2-M1 (done): `docs/superpowers/plans/2026-10-17-cuttle-p2-m1-desktop.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p2-m2`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg and ffprobe must be on PATH. The checks never show a window and never capture this machine: `app:check` records with the recorder's `test` backend (ffmpeg test sources and synthetic input).
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 6.

## Decisions made while planning

A prototype of the whole milestone, reviewed against the spec, settled these points. On the prototype, `pnpm test` passes 447 tests (21 skipped), `pnpm typecheck` exits with 0, `pnpm app:check` passes its 13 tests, and `pnpm app:build` packages the app and passes its 3.

- **The recorder** (`@cuttle/recorder`).
  - `WindowInfo` gains `id` (the window handle as a number), `pid` and `className`. A window source can be given by id; the CLI keeps titles. The desktop and taskbars (`Progman`, `WorkerW`, `Shell_TrayWnd`, `Shell_SecondaryTrayWnd`) are left out of the window list.
  - `focusWindow(id)` gives the focus back to the recorded window (`SetForegroundWindow`) after the picker had it.
  - `deadZones` (physical pixels) and `Recording.setDeadZones`: pointer input there is not logged, and nothing is logged after a stop was asked for, so no take shows the pointer going to the HUD or the click on Stop.
  - A `processes` event reports the capture ffmpegs' process ids as they start.
  - `recentClaudeFolders()` reads the `cwd` of the newest transcript in each Claude Code project folder, most recently active first (the picker's default folder for "Stop on Claude's answer").
  - `listDevices({ media: false })` lists monitors and windows without ffmpeg's DirectShow listing, which is slow.
- **The recorder host** (`dist/main/recorder-host.mjs`, a utility process).
  - One recording at a time; every recorder event goes to the main process.
  - If the host exits during a recording, the main process kills the reported ffmpeg processes and fails the recording, so no capture outlives the app's knowledge.
  - The `test` backend is chosen by the main process (`--test-backend`), only in the check (`--cuttle-check` with `CUTTLE_RECORDER_BACKEND=test`).
- **The check's switches** live in `main/check.ts`: `CUTTLE_HIDDEN`, `CUTTLE_RECORDER_BACKEND` and `CUTTLE_COUNTDOWN` act only with `--cuttle-check` on the command line.
- **The picker** (one window per display, frameless, transparent, always on top at screen-saver level, content-protected).
  - The main process sends each picker its display (DIP bounds, work area, scale, physical size, the recorder's monitor) and the windows on it in DIP, front to back; the app's own windows are left out by process id. The page hit-tests locally on every pointer move: the window under the pointer, else the display; a drag draws a region (Shift keeps 16:9) with eight handles; arrows nudge it.
  - Keys: Esc cancels, Enter records, Tab cycles the windows under the pointer, S/W/R force a mode. The display under the pointer has the focus.
  - The bar: modes; camera and mic (toggle, a device menu, a live camera bubble at the look's corner, a live level meter; previews match the recorder's DirectShow names by prefix); "Stop on" (your stop, Claude's answer with its folder, 10 s without change); Record. The choices are kept in the settings.
  - Before recording it warns when the drive has less room than about ten minutes of the largest display (0.1 bit per pixel and frame at 30 fps, plus a camera and the mic), or when the recorder cannot list the devices.
- **Countdown and HUD.**
  - The countdown is a ring over the target, click-through and never focused; the recorder's own countdown drives it. Esc cancels during it.
  - The HUD (380×64 DIP, content-protected, never focused, draggable) sits at the top centre of the recorded display's work area: the time, a marker button and Stop. Its bounds are the recorder's dead zone, updated when it moves.
  - While recording, the HUD warns when the drive has less than 2 GB left (checked every 30 s) or when a recorded window moves (its area stays where it was picked).
  - A page that subscribes late still gets the newest state: the preload's bridge replays an event's last payload to a new listener (every event is a state, not a stream). Without this the HUD showed 0:00, because its first state arrived before React listened.
- **After the stop.**
  - The take becomes the project's with `useTake` (its previous edit backed up), the editor opens on it at once with "Cutting the take…" in the title bar, the media worker runs `suggest` (a `suggest` job), and the editor reloads with the cut.
  - New recordings go to `<projects folder>/<date time>` (`~/Cuttle` by default; "(2)" when the second is taken).
  - **Record again** (the editor's title bar): the next take goes into the same project; the edit of the take it used is copied next to that take (`takes/<n>/cuttle.json`), and the takes menu offers "Back to take n". The editor is hidden while its project records, so it is never in its own take.
  - A capture that fails after it started (a camera unplugged) keeps its take: `recoverTake` repairs it and the editor opens on it; the dialog says what was kept.
  - Closing the last editor brings the pill back.
- **The end-to-end check** records twice through the picker with the `test` backend (from the pill, then "Record again"), stops from the HUD, waits for the cut take, checks the kept first take, and records once more with the test backend's failing camera to check the recovery. The unpacked build's check opens a picker, which starts the recorder host from the packaged app and lists this machine's displays and windows (names and bounds only; nothing is captured).

## File structure

```
cuttle/
├── README.md                          recording from the app
├── packages/recorder/src/             types, win32, sources, devices, ffmpeg, record, claude, index
├── apps/cli/test/cli.test.ts          `cuttle devices` lists window ids, processes and classes
└── apps/desktop/
    ├── package.json                   @cuttle/recorder
    ├── scripts/build.mjs              the picker, HUD and countdown pages' preloads
    ├── vite.main.config.ts            the recorder host bundle
    ├── vite.renderer.config.ts        picker.html, hud.html, countdown.html
    ├── src/shared/                    recording (the pick's pure model), media-jobs; ipc, channels (Task 3)
    ├── src/main/                      check, recorder-host, recording; windows, index, tray, settings, media-service
    ├── src/workers/                   recorder (the host); media (+ suggest)
    ├── src/preload/                   bridge (replays the last state), picker, hud, countdown
    ├── src/renderer/                  picker.html, hud.html, countdown.html; picker/ (Picker, Hud, Countdown, mains, picker.css); editor (take controls, status)
    └── test/                          recording (unit); app.check and build.check (recording)
```

---

### Task 1: The recorder: window ids, dead zones, process ids, Claude's folders

**Files:**
- Modify: `packages/recorder/src/{types,win32,sources,devices,ffmpeg,record,claude,index}.ts`, `packages/recorder/test/{claude,record,sources,win32}.test.ts`, `apps/cli/test/cli.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p2-m2`; work there:

```bash
git switch p2-m2
```

- [ ] **Step 2: Write the failing tests**

In `packages/recorder/test/win32.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import { CURSOR_SHAPES } from '@cuttle/project';
import { loadWin32 } from '../src/win32';

describe.runIf(process.platform === 'win32')('win32', () => {
  it('loads once per module and reads the pointer', async () => {
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { CURSOR_SHAPES } from '@cuttle/project';
import { SHELL_CLASSES, loadWin32 } from '../src/win32';

describe.runIf(process.platform === 'win32')('win32', () => {
  it('loads once per module and reads the pointer', async () => {
```

In the same file, replace:

```ts
    const monitors = win.monitors();
    for (const window of win.windows()) {
      expect(window.title).not.toBe('');
      expect(window.bounds.width).toBeGreaterThanOrEqual(2);
      expect(monitors.some((monitor) => monitor.index === window.monitor)).toBe(true);
    }
```

with:

```ts
    const monitors = win.monitors();
    for (const window of win.windows()) {
      expect(window.title).not.toBe('');
      expect(Number.isSafeInteger(window.id) && window.id > 0).toBe(true);
      expect(Number.isInteger(window.pid)).toBe(true);
      expect(SHELL_CLASSES.has(window.className)).toBe(false);
      expect(window.bounds.width).toBeGreaterThanOrEqual(2);
      expect(monitors.some((monitor) => monitor.index === window.monitor)).toBe(true);
    }
```

In `packages/recorder/test/sources.test.ts`, replace:

```ts
    { index: 2, name: 'DISPLAY3', bounds: { x: -1080, y: -335, width: 1080, height: 1920 }, scale: 1, primary: false },
  ],
  windows: [
    { title: 'Claude Code - demo', bounds: { x: 2600, y: 600, width: 801, height: 501 }, monitor: 1 },
    { title: 'Editor', bounds: { x: -1200, y: 100, width: 700, height: 400 }, monitor: 2 },
    { title: 'Browser - docs', bounds: { x: 10, y: 10, width: 100, height: 100 }, monitor: 0 },
    { title: 'Browser - mail', bounds: { x: 10, y: 10, width: 100, height: 100 }, monitor: 0 },
  ],
  cameras: ['Cam'],
  mics: ['Mic (USB)'],
```

with:

```ts
    { index: 2, name: 'DISPLAY3', bounds: { x: -1080, y: -335, width: 1080, height: 1920 }, scale: 1, primary: false },
  ],
  windows: [
    { id: 11, pid: 100, className: 'CASCADIA_HOSTING_WINDOW_CLASS', title: 'Claude Code - demo', bounds: { x: 2600, y: 600, width: 801, height: 501 }, monitor: 1 },
    { id: 12, pid: 200, className: 'Chrome_WidgetWin_1', title: 'Editor', bounds: { x: -1200, y: 100, width: 700, height: 400 }, monitor: 2 },
    { id: 13, pid: 300, className: 'Chrome_WidgetWin_1', title: 'Browser - docs', bounds: { x: 10, y: 10, width: 100, height: 100 }, monitor: 0 },
    { id: 14, pid: 300, className: 'Chrome_WidgetWin_1', title: 'Browser - mail', bounds: { x: 10, y: 10, width: 100, height: 100 }, monitor: 0 },
  ],
  cameras: ['Cam'],
  mics: ['Mic (USB)'],
```

In the same file, replace:

```ts
    expect(() => resolveArea({ kind: 'window', title: 'Terminal' }, devices)).toThrow(expect.objectContaining({ code: 'device-not-found' }));
  });

  it('refuses a title that two windows have exactly', () => {
    const twins = { ...devices, windows: [...devices.windows, { ...devices.windows[1]! }] };
    expect(() => resolveArea({ kind: 'window', title: 'Editor' }, twins)).toThrow(
```

with:

```ts
    expect(() => resolveArea({ kind: 'window', title: 'Terminal' }, devices)).toThrow(expect.objectContaining({ code: 'device-not-found' }));
  });

  it('finds a window by its id, whatever its title, and says when it is gone', () => {
    expect(resolveArea({ kind: 'window', id: 14 }, devices)).toEqual(resolveArea({ kind: 'window', title: 'Browser - docs' }, devices));
    expect(() => resolveArea({ kind: 'window', id: 99 }, devices)).toThrow(expect.objectContaining({ code: 'device-not-found', message: 'the window 99 is gone (closed, minimized or on another desktop)' }));
  });

  it('refuses a title that two windows have exactly', () => {
    const twins = { ...devices, windows: [...devices.windows, { ...devices.windows[1]! }] };
    expect(() => resolveArea({ kind: 'window', title: 'Editor' }, twins)).toThrow(
```

In `packages/recorder/test/record.test.ts`, replace:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { parseEventsJsonl, parseMarkersJson, parseTakeJson, trackOffset } from '@cuttle/project';
import { CLAUDE_TAIL_SECONDS, claudeTranscriptDir, record, type RecordOptions, type RecorderEvent } from '../src/index';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
```

with:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { parseEventsJsonl, parseMarkersJson, parseTakeJson, trackOffset } from '@cuttle/project';
import { CLAUDE_TAIL_SECONDS, claudeTranscriptDir, record, type RecordOptions, type RecorderEvent } from '../src/index';
import { inDeadZone } from '../src/record';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
```

In the same file, replace:

```ts
    // Marker times count from the screen's first frame, which starts late on a loaded machine.
    const markedSecond = markedAt - takeFile.take.tracks.screen.start;
    expect(markersOf(projectDir, take.markers)).toEqual([{ t: expect.closeTo(markedSecond, 1), kind: 'manual', label: 'one second' }]);
    expect(events.map((event) => event.type)).toEqual(['recording', 'marker', 'stopping']);
  }, SLOW);

  it('stops once untilFile exists', async () => {
```

with:

```ts
    // Marker times count from the screen's first frame, which starts late on a loaded machine.
    const markedSecond = markedAt - takeFile.take.tracks.screen.start;
    expect(markersOf(projectDir, take.markers)).toEqual([{ t: expect.closeTo(markedSecond, 1), kind: 'manual', label: 'one second' }]);
    expect(events.map((event) => event.type)).toEqual(['processes', 'recording', 'marker', 'stopping']);
    // screen, webcam and mic: the app kills these when its recorder host dies
    const processes = events[0]!;
    expect(processes.type === 'processes' && processes.pids.length === 3 && processes.pids.every(Number.isInteger)).toBe(true);
  }, SLOW);

  it('stops once untilFile exists', async () => {
```

In the same file, replace:

```ts
    expect(probe(join(projectDir, 'takes/1/screen.mp4')).duration).toBeGreaterThan(0.8);
  }, SLOW);

  it('captures a region and a window, with input relative to them, in numbered takes', async () => {
    const projectDir = project();
    const region = await record({ ...test, projectDir, source: { kind: 'region', rect: [100, 50, 401, 301], monitor: 0 }, stop: { maxSeconds: 1 } }).done;
    const window = await record({ ...test, projectDir, source: { kind: 'window', title: 'test window' }, stop: { maxSeconds: 1 } }).done;
    expect([region.dir, region.screenSize]).toEqual(['takes/1', { width: 400, height: 300 }]);
    expect([window.dir, window.screenSize]).toEqual(['takes/2', { width: 640, height: 360 }]);
    expect(probe(join(projectDir, window.screen))).toMatchObject({ width: 640, height: 360 });
```

with:

```ts
    expect(probe(join(projectDir, 'takes/1/screen.mp4')).duration).toBeGreaterThan(0.8);
  }, SLOW);

  it("logs no pointer input inside a dead zone (the app's HUD), but keys", async () => {
    const projectDir = project();
    // The synthetic pointer circles (640, 360) with a radius of 200: the zone takes its upper half.
    const take = await record({ ...test, projectDir, stop: { maxSeconds: 2 }, deadZones: [{ x: 0, y: 0, width: 1280, height: 360 }] }).done;
    const { events } = parseEventsJsonl(read(projectDir, take.events));
    const pointer = events.slice(2).filter((event) => event.type === 'move' || event.type === 'click' || event.type === 'scroll');
    expect(pointer.length).toBeGreaterThan(10);
    expect(pointer.every((event) => 'y' in event && event.y >= 360)).toBe(true);
    expect(events.some((event) => event.type === 'keys')).toBe(true);
  }, SLOW);

  it('captures a region and a window, with input relative to them, in numbered takes', async () => {
    const projectDir = project();
    const region = await record({ ...test, projectDir, source: { kind: 'region', rect: [100, 50, 401, 301], monitor: 0 }, stop: { maxSeconds: 1 } }).done;
    const window = await record({ ...test, projectDir, source: { kind: 'window', id: 1001 }, stop: { maxSeconds: 1 } }).done;
    expect([region.dir, region.screenSize]).toEqual(['takes/1', { width: 400, height: 300 }]);
    expect([window.dir, window.screenSize]).toEqual(['takes/2', { width: 640, height: 360 }]);
    expect(probe(join(projectDir, window.screen))).toMatchObject({ width: 640, height: 360 });
```

In the same file, replace:

```ts
    });
  }, SLOW);
});
```

with:

```ts
    });
  }, SLOW);
});

describe('inDeadZone', () => {
  const zones = [{ x: 100, y: 100, width: 200, height: 50 }];
  it('takes pointer input inside a zone (left and top edges in, right and bottom out), never keys or shapes', () => {
    expect(inDeadZone({ type: 'move', time: 0, x: 100, y: 100 }, zones)).toBe(true);
    expect(inDeadZone({ type: 'click', time: 0, x: 299, y: 149, button: 'left' }, zones)).toBe(true);
    expect(inDeadZone({ type: 'scroll', time: 0, x: 300, y: 120, dx: 0, dy: 1 }, zones)).toBe(false);
    expect(inDeadZone({ type: 'move', time: 0, x: 150, y: 150 }, zones)).toBe(false);
    expect(inDeadZone({ type: 'key', time: 0 }, zones)).toBe(false);
    expect(inDeadZone({ type: 'shape', time: 0, shape: 'text' }, zones)).toBe(false);
    expect(inDeadZone({ type: 'move', time: 0, x: 150, y: 120 }, [])).toBe(false);
  });
});
```

In `packages/recorder/test/claude.test.ts`, replace:

```ts
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { claudeTranscriptDir, readTranscriptLine, SessionReader, watchClaude, type ClaudeSignal } from '../src/claude';

afterEach(() => vi.unstubAllEnvs());
const dirs: string[] = [];
```

with:

```ts
import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { claudeTranscriptDir, readTranscriptLine, recentClaudeFolders, SessionReader, watchClaude, type ClaudeSignal } from '../src/claude';

afterEach(() => vi.unstubAllEnvs());
const dirs: string[] = [];
```

In the same file, replace:

```ts
    expect(kinds()).toEqual(['prompt']);
  });
});
```

with:

```ts
    expect(kinds()).toEqual(['prompt']);
  });
});

describe('recentClaudeFolders', () => {
  it('lists the folders Claude Code ran in, the most recently active first, skipping folders that are gone', async () => {
    const config = temp('claude-config-');
    const [older, newer, gone] = [temp('older-'), temp('newer-'), join(tmpdir(), 'cuttle-no-such-folder')];
    const transcript = (cwd: string, name: string, seconds: number) => {
      const dir = claudeTranscriptDir(cwd, config);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, name);
      writeFileSync(file, `${line({ type: 'user', cwd, message: { content: 'hi' } })}
not json
`);
      utimesSync(file, seconds, seconds);
    };
    transcript(older, 'a.jsonl', 1_000_000);
    transcript(newer, 'b.jsonl', 2_000_000);
    transcript(gone, 'c.jsonl', 3_000_000);
    expect(await recentClaudeFolders(5, config)).toEqual([
      { cwd: newer, active: 2_000_000 },
      { cwd: older, active: 1_000_000 },
    ]);
    expect(await recentClaudeFolders(1, config)).toHaveLength(1);
    expect(await recentClaudeFolders(5, join(config, 'nothing'))).toEqual([]);
  });
});
```

In `apps/cli/test/cli.test.ts`, replace:

```ts
              "x": 100,
              "y": 60,
            },
            "monitor": 0,
            "title": "Test Window",
          },
        ],
```

with:

```ts
              "x": 100,
              "y": 60,
            },
            "className": "TestWindow",
            "id": 1001,
            "monitor": 0,
            "pid": 4242,
            "title": "Test Window",
          },
        ],
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm exec vitest run --project node packages/recorder apps/cli/test/cli.test.ts`
Expected: FAIL, 8 tests: the window list has no `id`, `pid` or `className`; a window source by `id` is refused; `inDeadZone` and `recentClaudeFolders` are not exported; a take reports no `processes` event and logs pointer input inside a dead zone; the devices snapshot lacks the new fields.

- [ ] **Step 4: The recorder**

In `packages/recorder/src/types.ts`, replace:

```ts
}

export interface WindowInfo {
  title: string;
  /** The visible frame without the invisible resize border. */
  bounds: Bounds;
```

with:

```ts
}

export interface WindowInfo {
  /** The window's handle (HWND) as a number: unique while the window exists. */
  id: number;
  /** The process that owns it. */
  pid: number;
  /** Its window class, e.g. `CASCADIA_HOSTING_WINDOW_CLASS`. */
  className: string;
  title: string;
  /** The visible frame without the invisible resize border. */
  bounds: Bounds;
```

In the same file, replace:

```ts
  | { kind: 'monitor'; index: number }
  /** `rect` is `[x, y, width, height]` in pixels of that monitor (origin at its top-left corner). */
  | { kind: 'region'; rect: Rect; monitor: number }
  /** Captured as the region of the window's bounds when the recording starts. */
  | { kind: 'window'; title: string };

export interface StopOptions {
  /** Stops this many seconds after the screen track's first frame. */
```

with:

```ts
  | { kind: 'monitor'; index: number }
  /** `rect` is `[x, y, width, height]` in pixels of that monitor (origin at its top-left corner). */
  | { kind: 'region'; rect: Rect; monitor: number }
  /** Captured as the region of the window's bounds when the recording starts; by title or by id (`WindowInfo.id`). */
  | { kind: 'window'; title: string }
  | { kind: 'window'; id: number };

export interface StopOptions {
  /** Stops this many seconds after the screen track's first frame. */
```

In the same file, replace:

```ts
  drawMouse?: boolean;
  /** `test`: ffmpeg test sources and synthetic input instead of real devices (default `auto`). */
  backend?: Backend;
  onEvent?: (event: RecorderEvent) => void;
}
```

with:

```ts
  drawMouse?: boolean;
  /** `test`: ffmpeg test sources and synthetic input instead of real devices (default `auto`). */
  backend?: Backend;
  /**
   * Desktop areas (physical pixels) whose pointer input is not logged: the app's own controls, such
   * as a recording HUD, so no take shows the pointer going to them or a click on Stop.
   */
  deadZones?: Bounds[];
  onEvent?: (event: RecorderEvent) => void;
}
```

In the same file, replace:

```ts

export type RecorderEvent =
  | { type: 'countdown'; seconds: number }
  /** Every track is capturing; `dir` is the take folder relative to the project. */
  | { type: 'recording'; dir: string }
  | { type: 'marker'; marker: Marker }
```

with:

```ts

export type RecorderEvent =
  | { type: 'countdown'; seconds: number }
  /** The capture processes started (ffmpeg's process ids), so a host that dies can be cleaned up after. */
  | { type: 'processes'; pids: number[] }
  /** Every track is capturing; `dir` is the take folder relative to the project. */
  | { type: 'recording'; dir: string }
  | { type: 'marker'; marker: Marker }
```

In the same file, replace:

```ts
  stop(): Promise<Take>;
  /** Adds a manual marker at the current time. */
  marker(label?: string): void;
  /** Resolves when the recording has stopped for any reason; rejects with a `RecorderError`. */
  done: Promise<Take>;
}
```

with:

```ts
  stop(): Promise<Take>;
  /** Adds a manual marker at the current time. */
  marker(label?: string): void;
  /** Replaces the dead zones (`RecordOptions.deadZones`), e.g. after the HUD was dragged. */
  setDeadZones(zones: Bounds[]): void;
  /** Resolves when the recording has stopped for any reason; rejects with a `RecorderError`. */
  done: Promise<Take>;
}
```

In `packages/recorder/src/win32.ts`, replace:

```ts
  windows(): WindowInfo[];
  /** The pointer in physical desktop pixels, like the input hook's events. */
  cursorPosition(): { x: number; y: number };
  cursorShape(): CursorShape;
}
```

with:

```ts
  windows(): WindowInfo[];
  /** The pointer in physical desktop pixels, like the input hook's events. */
  cursorPosition(): { x: number; y: number };
  /** Brings a window (`WindowInfo.id`) to the front; false when it is gone or Windows refused. */
  focus(id: number): boolean;
  cursorShape(): CursorShape;
}
```

In the same file, replace:

```ts
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const MONITOR_DEFAULTTONULL = 0;
// IID_IDXGIFactory1 {770aae78-f26f-4dba-a829-253c83d1b387}
const IID_IDXGIFactory1 = { Data1: 0x770aae78, Data2: 0xf26f, Data3: 0x4dba, Data4: [0xa8, 0x29, 0x25, 0x3c, 0x83, 0xd1, 0xb3, 0x87] };
/** System cursor ids (`IDC_*`) and the shape each stands for; anything else is drawn as `arrow`. */
```

with:

```ts
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const MONITOR_DEFAULTTONULL = 0;
/** The desktop (Progman, WorkerW) and the taskbars pass the other filters, but are no window to record. */
export const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);
// IID_IDXGIFactory1 {770aae78-f26f-4dba-a829-253c83d1b387}
const IID_IDXGIFactory1 = { Data1: 0x770aae78, Data2: 0xf26f, Data3: 0x4dba, Data4: [0xa8, 0x29, 0x25, 0x3c, 0x83, 0xd1, 0xb3, 0x87] };
/** System cursor ids (`IDC_*`) and the shape each stands for; anything else is drawn as `arrow`. */
```

In the same file, replace:

```ts
  const GetWindowTextLengthW = user32.func('__stdcall', 'GetWindowTextLengthW', 'int', ['void *']);
  const GetWindowTextW = user32.func('__stdcall', 'GetWindowTextW', 'int', ['void *', 'void *', 'int']);
  const GetWindowThreadProcessId = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['void *', koffi.out(koffi.pointer('uint32'))]);
  const MonitorFromWindow = user32.func('__stdcall', 'MonitorFromWindow', 'void *', ['void *', 'uint32']);
  const GetConsoleWindow = kernel32.func('__stdcall', 'GetConsoleWindow', 'void *', []);
  const GetConsoleTitleW = kernel32.func('__stdcall', 'GetConsoleTitleW', 'uint32', ['void *', 'uint32']);
```

with:

```ts
  const GetWindowTextLengthW = user32.func('__stdcall', 'GetWindowTextLengthW', 'int', ['void *']);
  const GetWindowTextW = user32.func('__stdcall', 'GetWindowTextW', 'int', ['void *', 'void *', 'int']);
  const GetWindowThreadProcessId = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['void *', koffi.out(koffi.pointer('uint32'))]);
  const GetClassNameW = user32.func('__stdcall', 'GetClassNameW', 'int', ['void *', 'void *', 'int']);
  // A window id (the HWND's address) goes in as an integer.
  const SetForegroundWindow = user32.func('__stdcall', 'SetForegroundWindow', 'int', ['intptr_t']);
  const IsWindow = user32.func('__stdcall', 'IsWindow', 'int', ['intptr_t']);
  const MonitorFromWindow = user32.func('__stdcall', 'MonitorFromWindow', 'void *', ['void *', 'uint32']);
  const GetConsoleWindow = kernel32.func('__stdcall', 'GetConsoleWindow', 'void *', []);
  const GetConsoleTitleW = kernel32.func('__stdcall', 'GetConsoleTitleW', 'uint32', ['void *', 'uint32']);
```

In the same file, replace:

```ts
      const pid = [0];
      GetWindowThreadProcessId(hwnd, pid);
      if (pid[0] === process.pid || (ownConsole !== 0n && koffi.address(hwnd) === ownConsole)) return 1;
      // Cloaked: on another virtual desktop, or a suspended UWP app that is "visible" but not shown.
      if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) >= 0 && cloaked.readUInt32LE(0) !== 0) return 1;
      const length = GetWindowTextLengthW(hwnd);
```

with:

```ts
      const pid = [0];
      GetWindowThreadProcessId(hwnd, pid);
      if (pid[0] === process.pid || (ownConsole !== 0n && koffi.address(hwnd) === ownConsole)) return 1;
      const classBuffer = Buffer.alloc(512);
      const className = classBuffer.toString('utf16le', 0, GetClassNameW(hwnd, classBuffer, 256) * 2);
      if (SHELL_CLASSES.has(className)) return 1;
      // Cloaked: on another virtual desktop, or a suspended UWP app that is "visible" but not shown.
      if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) >= 0 && cloaked.readUInt32LE(0) !== 0) return 1;
      const length = GetWindowTextLengthW(hwnd);
```

In the same file, replace:

```ts
      if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, 16) < 0) return 1;
      const [left, top, right, bottom] = [0, 4, 8, 12].map((offset) => rect.readInt32LE(offset)) as [number, number, number, number];
      if (right - left < 2 || bottom - top < 2) return 1;
      found.push({ title, bounds: { x: left, y: top, width: right - left, height: bottom - top }, monitor });
      return 1;
    }, koffi.pointer(WNDENUMPROC));
    try {
```

with:

```ts
      if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, 16) < 0) return 1;
      const [left, top, right, bottom] = [0, 4, 8, 12].map((offset) => rect.readInt32LE(offset)) as [number, number, number, number];
      if (right - left < 2 || bottom - top < 2) return 1;
      found.push({ id: Number(koffi.address(hwnd)), pid: pid[0]!, className, title, bounds: { x: left, y: top, width: right - left, height: bottom - top }, monitor });
      return 1;
    }, koffi.pointer(WNDENUMPROC));
    try {
```

In the same file, replace:

```ts
      GetPhysicalCursorPos(point);
      return { x: point.x, y: point.y };
    },
    cursorShape() {
      if (!GetCursorInfo(info) || info.hCursor === null) return 'arrow';
      return cursorShapes.get(koffi.address(info.hCursor)) ?? 'arrow';
```

with:

```ts
      GetPhysicalCursorPos(point);
      return { x: point.x, y: point.y };
    },
    focus(id) {
      return IsWindow(id) !== 0 && SetForegroundWindow(id) !== 0;
    },
    cursorShape() {
      if (!GetCursorInfo(info) || info.hCursor === null) return 'arrow';
      return cursorShapes.get(koffi.address(info.hCursor)) ?? 'arrow';
```

In `packages/recorder/src/sources.ts`, replace:

```ts
    { index: 0, name: 'Test Monitor', bounds: { x: 0, y: 0, width: 1280, height: 720 }, scale: 1, primary: true },
    { index: 1, name: 'Still Test Monitor', bounds: { x: 1280, y: 0, width: 640, height: 360 }, scale: 1, primary: false },
  ],
  windows: [{ title: 'Test Window', bounds: { x: 100, y: 60, width: 640, height: 360 }, monitor: 0 }],
  cameras: ['Test Camera', 'Failing Test Camera'],
  mics: ['Test Microphone', 'Silent Test Microphone'],
};
```

with:

```ts
    { index: 0, name: 'Test Monitor', bounds: { x: 0, y: 0, width: 1280, height: 720 }, scale: 1, primary: true },
    { index: 1, name: 'Still Test Monitor', bounds: { x: 1280, y: 0, width: 640, height: 360 }, scale: 1, primary: false },
  ],
  windows: [{ id: 1001, pid: 4242, className: 'TestWindow', title: 'Test Window', bounds: { x: 100, y: 60, width: 640, height: 360 }, monitor: 0 }],
  cameras: ['Test Camera', 'Failing Test Camera'],
  mics: ['Test Microphone', 'Silent Test Microphone'],
};
```

In the same file, replace:

```ts
      return { monitor, crop: fullOrCrop(monitor, crop) };
    }
    case 'window': {
      const window = findWindow(source.title, devices);
      const monitor = monitorAt(window.monitor);
      const { bounds } = monitor;
      // The part of the window on the monitor that holds most of it, in that monitor's pixels.
```

with:

```ts
      return { monitor, crop: fullOrCrop(monitor, crop) };
    }
    case 'window': {
      const window = 'id' in source ? windowById(source.id, devices) : findWindow(source.title, devices);
      const monitor = monitorAt(window.monitor);
      const { bounds } = monitor;
      // The part of the window on the monitor that holds most of it, in that monitor's pixels.
```

In the same file, replace:

```ts
  return full ? undefined : crop;
}

/** The one window with exactly this title, otherwise the one whose title contains it (ignoring case). */
function findWindow(title: string, devices: Devices) {
  const exact = devices.windows.filter((window) => window.title === title);
```

with:

```ts
  return full ? undefined : crop;
}

function windowById(id: number, devices: Devices) {
  const window = devices.windows.find((candidate) => candidate.id === id);
  if (!window) throw new RecorderError('device-not-found', `the window ${id} is gone (closed, minimized or on another desktop)`);
  return window;
}

/** The one window with exactly this title, otherwise the one whose title contains it (ignoring case). */
function findWindow(title: string, devices: Devices) {
  const exact = devices.windows.filter((window) => window.title === title);
```

In `packages/recorder/src/devices.ts`, replace:

```ts
const LISTING_TIMEOUT_SECONDS = 10;

/** Monitors, windows, cameras and microphones the recorder can capture. */
export function listDevices(options: { backend?: Backend } = {}): Promise<Devices> {
  return devicesFor(platformFor(options.backend), true);
}

/**
```

with:

```ts
const LISTING_TIMEOUT_SECONDS = 10;

/** Monitors, windows, cameras and microphones the recorder can capture. */
export function listDevices(options: { backend?: Backend; media?: boolean } = {}): Promise<Devices> {
  return devicesFor(platformFor(options.backend), options.media ?? true);
}

/**
```

In the same file, replace:

```ts
  return { monitors: win.monitors(), windows: win.windows(), cameras, mics };
}

/** The windows now, for a window source that is resolved again when the countdown ends. */
export async function windowsFor(platform: Platform): Promise<WindowInfo[]> {
  if (platform === 'test') return structuredClone(TEST_DEVICES.windows);
```

with:

```ts
  return { monitors: win.monitors(), windows: win.windows(), cameras, mics };
}

/**
 * Brings a window (`WindowInfo.id`) to the front, e.g. the one a picker took the focus from. Only
 * the process that has the focus may do so on Windows; false when it is gone or Windows refused, and
 * always with the test backend.
 */
export async function focusWindow(id: number, options: { backend?: Backend } = {}): Promise<boolean> {
  if (platformFor(options.backend) === 'test') return false;
  const { loadWin32 } = await import('./win32');
  return (await loadWin32()).focus(id);
}

/** The windows now, for a window source that is resolved again when the countdown ends. */
export async function windowsFor(platform: Platform): Promise<WindowInfo[]> {
  if (platform === 'test') return structuredClone(TEST_DEVICES.windows);
```

In `packages/recorder/src/ffmpeg.ts`, replace:

```ts
const PROGRESS_TIME = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/;

export interface CaptureProcess {
  /** Wall-clock seconds (Unix epoch) of the first captured frame or sample. */
  readonly started: Promise<number>;
  /** Resolves when ffmpeg exits after `stop()`; rejects when it fails or exits on its own. */
```

with:

```ts
const PROGRESS_TIME = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/;

export interface CaptureProcess {
  /** ffmpeg's process id (undefined when it could not be started). */
  readonly pid: number | undefined;
  /** Wall-clock seconds (Unix epoch) of the first captured frame or sample. */
  readonly started: Promise<number>;
  /** Resolves when ffmpeg exits after `stop()`; rejects when it fails or exits on its own. */
```

In the same file, replace:

```ts
  exited.catch(() => {}); // surfaced through `started`, `stop()` or the caller's own await

  return {
    started,
    exited,
    onLine: (listener) => void listeners.push(listener),
```

with:

```ts
  exited.catch(() => {}); // surfaced through `started`, `stop()` or the caller's own await

  return {
    pid: child.pid,
    started,
    exited,
    onLine: (listener) => void listeners.push(listener),
```

In `packages/recorder/src/record.ts`, replace:

```ts
import { spawnCapture, type CaptureProcess } from './ffmpeg';
import { startInput, type InputSource } from './input';
import { areaGeometry, checkDevice, micInput, micLatency, platformFor, resolveArea, screenInput, webcamInput, type Platform, type ScreenArea } from './sources';
import type { RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';

const DEFAULT_COUNTDOWN_SECONDS = 3;
/** Seconds kept after Claude's final answer, so the video shows it. */
```

with:

```ts
import { spawnCapture, type CaptureProcess } from './ffmpeg';
import { startInput, type InputSource } from './input';
import { areaGeometry, checkDevice, micInput, micLatency, platformFor, resolveArea, screenInput, webcamInput, type Platform, type ScreenArea } from './sources';
import type { Bounds, RawInput, RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';

const DEFAULT_COUNTDOWN_SECONDS = 3;
/** Seconds kept after Claude's final answer, so the video shows it. */
```

In the same file, replace:

```ts
export function record(options: RecordOptions): Recording {
  const control = new Control();
  const since = now(); // Claude prompts count from here, during the device listing and the countdown too
  const done = run(options, control, since);
  done.catch(() => {}); // the caller sees a failure through `done` or `stop()`
  return {
```

with:

```ts
export function record(options: RecordOptions): Recording {
  const control = new Control();
  const since = now(); // Claude prompts count from here, during the device listing and the countdown too
  control.deadZones = [...(options.deadZones ?? [])];
  const done = run(options, control, since);
  done.catch(() => {}); // the caller sees a failure through `done` or `stop()`
  return {
```

In the same file, replace:

```ts
      return done;
    },
    marker: (label) => control.marker(label),
    done,
  };
}
```

with:

```ts
      return done;
    },
    marker: (label) => control.marker(label),
    setDeadZones: (zones) => (control.deadZones = [...zones]),
    done,
  };
}
```

In the same file, replace:

```ts
class Control {
  reason: StopReason | undefined;
  onMarker: ((label?: string) => void) | undefined;
  private waiters: ((reason: StopReason) => void)[] = [];

  /** The first request wins. */
```

with:

```ts
class Control {
  reason: StopReason | undefined;
  onMarker: ((label?: string) => void) | undefined;
  /** Pointer input inside these is not logged. */
  deadZones: Bounds[] = [];
  private waiters: ((reason: StopReason) => void)[] = [];

  /** The first request wins. */
```

In the same file, replace:

```ts

const cancelled = (what: string) => new RecorderError('cancelled', `the recording was stopped before ${what}`);

async function run(options: RecordOptions, control: Control, since: number): Promise<Take> {
  try {
    return await prepareAndRecord(options, control, since);
```

with:

```ts

const cancelled = (what: string) => new RecorderError('cancelled', `the recording was stopped before ${what}`);

/** Whether a pointer event lies in one of the dead zones (keys and shapes have no position). */
export function inDeadZone(input: RawInput, zones: readonly Bounds[]): boolean {
  if (input.type === 'key' || input.type === 'shape') return false;
  return zones.some((zone) => input.x >= zone.x && input.x < zone.x + zone.width && input.y >= zone.y && input.y < zone.y + zone.height);
}

async function run(options: RecordOptions, control: Control, since: number): Promise<Take> {
  try {
    return await prepareAndRecord(options, control, since);
```

In the same file, replace:

```ts
    input = await startInput(
      platform,
      (raw) => {
        lastInput = raw.time;
        writer.push(raw);
      },
```

with:

```ts
    input = await startInput(
      platform,
      (raw) => {
        // Nothing after a stop was asked for, nothing over the app's own controls: no take shows the
        // pointer travelling to Stop or its click.
        if (control.reason !== undefined || inDeadZone(raw, control.deadZones)) return;
        lastInput = raw.time;
        writer.push(raw);
      },
```

In the same file, replace:

```ts
    if (webcam) captures.push(webcam);
    const mic = options.mic === undefined ? undefined : spawnCapture('mic', micArgs(micInput(platform, options.mic), path(FILES.mic)));
    if (mic) captures.push(mic);

    // A freeze that starts at 0 means the screen has not changed yet: untilIdleSeconds waits for one
    // after a change, and for the input to rest as long (someone pointing at a still chart is not idle).
```

with:

```ts
    if (webcam) captures.push(webcam);
    const mic = options.mic === undefined ? undefined : spawnCapture('mic', micArgs(micInput(platform, options.mic), path(FILES.mic)));
    if (mic) captures.push(mic);
    reporter.emit({ type: 'processes', pids: captures.map((capture) => capture.pid).filter((pid): pid is number => pid !== undefined) });

    // A freeze that starts at 0 means the screen has not changed yet: untilIdleSeconds waits for one
    // after a change, and for the input to rest as long (someone pointing at a still chart is not idle).
```

In `packages/recorder/src/claude.ts`, replace:

```ts
    await file.close();
  }
}
```

with:

```ts
    await file.close();
  }
}

/** A folder Claude Code ran in, and when its newest transcript last changed (wall-clock seconds). */
export interface ClaudeFolder {
  cwd: string;
  active: number;
}

/** How much of a transcript's end is read to find the folder it ran in. */
const CWD_TAIL_BYTES = 256 * 1024;

/**
 * The folders Claude Code ran in, the most recently active first (at most `limit`), from the `cwd`
 * of the newest transcript in each project folder. Folders that no longer exist are left out.
 */
export async function recentClaudeFolders(limit = 5, configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')): Promise<ClaudeFolder[]> {
  const projects = join(configDir, 'projects');
  const newest: { path: string; mtime: number }[] = [];
  for (const name of await readdir(projects).catch(() => [] as string[])) {
    let best: { path: string; mtime: number } | undefined;
    for (const file of await readdir(join(projects, name)).catch(() => [] as string[])) {
      if (!file.endsWith('.jsonl')) continue;
      const info = await stat(join(projects, name, file)).catch(() => undefined);
      if (info?.isFile() && (!best || info.mtimeMs > best.mtime)) best = { path: join(projects, name, file), mtime: info.mtimeMs };
    }
    if (best) newest.push(best);
  }
  newest.sort((a, b) => b.mtime - a.mtime);
  const folders: ClaudeFolder[] = [];
  for (const transcript of newest) {
    if (folders.length >= limit) break;
    const size = (await stat(transcript.path)).size;
    const text = (await readRange(transcript.path, Math.max(0, size - CWD_TAIL_BYTES), size)).toString('utf8');
    const cwd = text
      .split('\n')
      .reverse()
      .map((line) => {
        try {
          const value = (JSON.parse(line) as { cwd?: unknown }).cwd;
          return typeof value === 'string' ? value : undefined;
        } catch {
          return undefined;
        }
      })
      .find((value) => value !== undefined);
    if (cwd === undefined || folders.some((folder) => folder.cwd === cwd)) continue;
    if (!(await stat(cwd).then((info) => info.isDirectory(), () => false))) continue;
    folders.push({ cwd, active: transcript.mtime / 1000 });
  }
  return folders;
}
```

In `packages/recorder/src/index.ts`, replace:

```ts
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
export { claudeTranscriptDir, readTranscriptLine, SessionReader, type ClaudeSignal } from './claude';
export type {
  Backend,
  Bounds,
```

with:

```ts
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
export { claudeTranscriptDir, readTranscriptLine, recentClaudeFolders, SessionReader, type ClaudeFolder, type ClaudeSignal } from './claude';
export { focusWindow } from './devices';
export type {
  Backend,
  Bounds,
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node packages/recorder apps/cli/test/cli.test.ts`
Expected: PASS, 96 tests (1 skipped: the real-capture test).

Run: `pnpm exec tsc -p packages/recorder/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 6: Commit**

```bash
git add packages/recorder apps/cli/test/cli.test.ts
git commit -m "recorder: window ids, processes and classes; dead zones; capture process ids; focus; Claude's recent folders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The recording model

**Files:**
- Create: `apps/desktop/src/shared/recording.ts`, `apps/desktop/test/recording.test.ts`
- Modify: `apps/desktop/package.json`, `pnpm-lock.yaml`, `apps/desktop/src/shared/media-jobs.ts`, `apps/desktop/src/main/settings.ts`

- [ ] **Step 1: The dependency**

In `apps/desktop/package.json`, replace:

```json
    "@cuttle/engine": "workspace:*",
    "@cuttle/export": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/timeline": "workspace:*",
    "@fontsource/inter": "5.3.0",
    "koffi": "3.3.2",
```

with:

```json
    "@cuttle/engine": "workspace:*",
    "@cuttle/export": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/recorder": "workspace:*",
    "@cuttle/timeline": "workspace:*",
    "@fontsource/inter": "5.3.0",
    "koffi": "3.3.2",
```

Run: `pnpm install`
Expected: exits with code 0; `pnpm-lock.yaml` gains `@cuttle/recorder` for `apps/desktop`.

- [ ] **Step 2: Write the failing test**

`apps/desktop/test/recording.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  captureSourceFor,
  dragRect,
  hudPosition,
  matchMediaDevice,
  stopOptionsFor,
  toDisplayPixels,
  windowAt,
  windowsAt,
  type PickerDisplay,
  type PickerWindow,
} from '../src/shared/recording';

// The primary display of the spike machine: 2560×1440 pixels at 125 %, 2048×1152 DIP.
const primary: PickerDisplay = {
  id: 1,
  bounds: { x: 0, y: 0, width: 2048, height: 1152 },
  workArea: { x: 0, y: 0, width: 2048, height: 1104 },
  scaleFactor: 1.25,
  monitor: 0,
  pixels: { width: 2560, height: 1440 },
  label: 'Q24h-10',
};
// A second display to the right, 1920×1080 at 100 %.
const second: PickerDisplay = { ...primary, id: 2, bounds: { x: 2048, y: 407, width: 1920, height: 1080 }, workArea: { x: 2048, y: 407, width: 1920, height: 1040 }, scaleFactor: 1, monitor: 1 };

const window = (id: number, x: number, y: number, width: number, height: number): PickerWindow => ({
  id,
  title: `w${id}`,
  className: 'C',
  bounds: { x, y, width, height },
  pixels: { width: width * 1.25, height: height * 1.25 },
});

describe('hit testing', () => {
  const windows = [window(1, 100, 100, 400, 300), window(2, 300, 200, 600, 400), window(3, 0, 0, 2048, 1104)];
  it('takes the frontmost window under the point, and lists every one for Tab', () => {
    expect(windowAt(windows, 350, 250)?.id).toBe(1);
    expect(windowAt(windows, 800, 500)?.id).toBe(2);
    expect(windowAt(windows, 1500, 900)?.id).toBe(3);
    expect(windowAt(windows, 1500, 1110)).toBeUndefined();
    expect(windowsAt(windows, 350, 250).map((found) => found.id)).toEqual([1, 2, 3]);
    // right and bottom edges are outside
    expect(windowAt([window(1, 0, 0, 10, 10)], 10, 5)).toBeUndefined();
  });
});

describe('dragRect', () => {
  const area = primary.bounds;
  it('spans the two points in either direction, clamped to the display', () => {
    expect(dragRect({ x: 300, y: 200 }, { x: 100, y: 50 }, area)).toEqual({ x: 100, y: 50, width: 200, height: 150 });
    expect(dragRect({ x: 1900, y: 1000 }, { x: 2400, y: 1300 }, area)).toEqual({ x: 1900, y: 1000, width: 148, height: 152 });
  });

  it('keeps 16:9 when asked', () => {
    expect(dragRect({ x: 100, y: 100 }, { x: 420, y: 999 }, area, true)).toEqual({ x: 100, y: 100, width: 320, height: 180 });
    expect(dragRect({ x: 500, y: 500 }, { x: 180, y: 0 }, area, true)).toEqual({ x: 180, y: 320, width: 320, height: 180 });
  });
});

describe('from a pick to the recorder', () => {
  it('turns DIP on a scaled display into whole pixels of that display', () => {
    expect(toDisplayPixels({ x: 100.2, y: 80, width: 640.4, height: 360 }, primary)).toEqual({ x: 125, y: 100, width: 801, height: 450 });
    expect(toDisplayPixels({ x: 2148, y: 507, width: 640, height: 360 }, second)).toEqual({ x: 100, y: 100, width: 640, height: 360 });
  });

  it('records a screen by its monitor, a window by its id and a region in monitor pixels', () => {
    expect(captureSourceFor({ kind: 'screen', display: 2 }, second)).toEqual({ kind: 'monitor', index: 1 });
    expect(captureSourceFor({ kind: 'window', display: 1, window: 77 }, primary)).toEqual({ kind: 'window', id: 77 });
    expect(captureSourceFor({ kind: 'region', display: 1, rect: { x: 0, y: 0, width: 1024, height: 576 } }, primary)).toEqual({
      kind: 'region',
      monitor: 0,
      rect: [0, 0, 1280, 720],
    });
    expect(() => captureSourceFor({ kind: 'screen', display: 3 }, { ...primary, monitor: undefined })).toThrow('the recorder does not know the display "Q24h-10"');
  });

  it("stops on Claude's answer in the chosen folder, on an idle screen, or by hand", () => {
    expect(stopOptionsFor({ stop: 'claude', claudeFolder: 'C:\\demo' })).toEqual({ untilClaude: 'C:\\demo' });
    expect(stopOptionsFor({ stop: 'claude' })).toEqual({});
    expect(stopOptionsFor({ stop: 'idle' })).toEqual({ untilIdleSeconds: 10 });
    expect(stopOptionsFor({ stop: 'none' })).toEqual({});
  });

  it('puts the HUD at the top centre of the work area', () => {
    expect(hudPosition(second, { width: 360, height: 60 })).toEqual({ x: 2048 + 780, y: 419 });
  });
});

describe('matchMediaDevice', () => {
  const devices = [{ label: 'Default - Microphone Array (AMD Audio Device)' }, { label: 'Logitech BRIO Webcam (046d:085e)' }, { label: 'Logi C920' }];
  it("finds the browser's device for a DirectShow name, also one cut to 31 characters", () => {
    expect(matchMediaDevice('Microphone Array (AMD Audio Device)', devices)).toBe(devices[0]);
    expect(matchMediaDevice('Logitech BRIO Webcam (046d:085', devices)).toBe(devices[1]);
    expect(matchMediaDevice('logi c920', devices)).toBe(devices[2]);
    expect(matchMediaDevice('Elgato Facecam', devices)).toBeUndefined();
    expect(matchMediaDevice('', devices)).toBeUndefined();
  });
});
```

Run: `pnpm exec vitest run --project node apps/desktop/test/recording.test.ts`
Expected: FAIL: `Cannot find module '../src/shared/recording'`.

- [ ] **Step 3: The model, the suggest job and the settings**

`apps/desktop/src/shared/recording.ts`:

```ts
// Messages between the main process and the recorder host (a utility process running `record()`),
// and the pure geometry of picking what to record.
import type { Bounds, CaptureSource, Devices, RecordOptions, RecorderEvent, StopOptions, Take } from '@cuttle/recorder';

/** What the main process asks of the host. */
export type HostRequest =
  | { type: 'devices'; id: number; media: boolean }
  | { type: 'start'; options: Omit<RecordOptions, 'onEvent'> }
  | { type: 'stop' }
  | { type: 'marker'; label?: string }
  | { type: 'dead-zones'; zones: Bounds[] };

/** What the host answers and reports. */
export type HostReply =
  | { type: 'devices'; id: number; devices?: Devices; error?: string }
  | { type: 'event'; event: RecorderEvent }
  | { type: 'done'; take: Take }
  | { type: 'failed'; code: string; message: string };

/** A rectangle in DIP (Electron's coordinates). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A display as the picker sees it: its DIP bounds and work area, and the recorder's monitor index. */
export interface PickerDisplay {
  id: number;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
  /** `Monitor.index` of the recorder for this display; undefined when the recorder does not know it. */
  monitor?: number;
  /** Physical pixels (what the take will be). */
  pixels: { width: number; height: number };
  label: string;
}

/** A window under the picker, in DIP of the display it is on. */
export interface PickerWindow {
  id: number;
  title: string;
  className: string;
  bounds: Rect;
  /** Physical size: what a take of it will be. */
  pixels: { width: number; height: number };
}

/** What the person picked. */
export type PickedTarget =
  | { kind: 'screen'; display: number }
  | { kind: 'window'; display: number; window: number }
  | { kind: 'region'; display: number; rect: Rect };

/** The bar's choices, kept between recordings. */
export interface RecordChoices {
  camera?: string;
  mic?: string;
  stop: 'none' | 'claude' | 'idle';
  /** The folder Claude Code runs in, for `stop: 'claude'`. */
  claudeFolder?: string;
}

/** The first window whose bounds contain the point (front to back), or undefined: the display. */
export function windowAt(windows: readonly PickerWindow[], x: number, y: number): PickerWindow | undefined {
  return windows.find(({ bounds }) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height);
}

/** Every window under the point, front to back (Tab cycles them). */
export function windowsAt(windows: readonly PickerWindow[], x: number, y: number): PickerWindow[] {
  return windows.filter(({ bounds }) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height);
}

/** The rectangle two drag points span, clamped to `area` (a display's bounds, both in DIP). */
export function dragRect(from: { x: number; y: number }, to: { x: number; y: number }, area: Rect, keep16by9 = false): Rect {
  const clampX = (value: number) => Math.min(Math.max(value, area.x), area.x + area.width);
  const clampY = (value: number) => Math.min(Math.max(value, area.y), area.y + area.height);
  const x0 = clampX(from.x);
  const y0 = clampY(from.y);
  let x1 = clampX(to.x);
  let y1 = clampY(to.y);
  if (keep16by9) {
    const width = Math.abs(x1 - x0);
    const height = (width * 9) / 16;
    y1 = clampY(y0 + Math.sign(y1 - y0 || 1) * height);
    x1 = x0 + Math.sign(x1 - x0 || 1) * (Math.abs(y1 - y0) * 16) / 9;
  }
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

/** A DIP rectangle on a display in physical pixels of that display (its top-left at 0, 0), whole pixels. */
export function toDisplayPixels(rect: Rect, display: Pick<PickerDisplay, 'bounds' | 'scaleFactor'>): Rect {
  const s = display.scaleFactor;
  const x = Math.round((rect.x - display.bounds.x) * s);
  const y = Math.round((rect.y - display.bounds.y) * s);
  return { x, y, width: Math.round((rect.x + rect.width - display.bounds.x) * s) - x, height: Math.round((rect.y + rect.height - display.bounds.y) * s) - y };
}

/** The recorder's capture source for a pick. */
export function captureSourceFor(target: PickedTarget, display: PickerDisplay): CaptureSource {
  if (display.monitor === undefined) throw new Error(`the recorder does not know the display "${display.label}"`);
  switch (target.kind) {
    case 'screen':
      return { kind: 'monitor', index: display.monitor };
    case 'window':
      return { kind: 'window', id: target.window };
    case 'region': {
      const { x, y, width, height } = toDisplayPixels(target.rect, display);
      return { kind: 'region', monitor: display.monitor, rect: [x, y, width, height] };
    }
  }
}

/** The recorder's stop options for the bar's choice. */
export function stopOptionsFor(choices: RecordChoices): StopOptions {
  if (choices.stop === 'claude' && choices.claudeFolder) return { untilClaude: choices.claudeFolder };
  if (choices.stop === 'idle') return { untilIdleSeconds: 10 };
  return {};
}

/**
 * Where the HUD goes: top centre of the display's work area, 12 DIP below its top edge, clamped
 * inside the work area. `size` is the HUD's size in DIP.
 */
export function hudPosition(display: Pick<PickerDisplay, 'workArea'>, size: { width: number; height: number }): { x: number; y: number } {
  const area = display.workArea;
  return { x: Math.round(area.x + (area.width - size.width) / 2), y: area.y + 12 };
}

/**
 * The camera device among `getUserMedia`'s, for a DirectShow name from the recorder (often cut to 31
 * characters): the first label that starts with the name, ignoring case and a leading "Default - ".
 */
export function matchMediaDevice<T extends { label: string }>(name: string, devices: readonly T[]): T | undefined {
  const normal = (label: string) => label.replace(/^default\s*-\s*/i, '').trim().toLowerCase();
  const wanted = normal(name);
  return devices.find((device) => normal(device.label) === wanted) ?? devices.find((device) => wanted !== '' && normal(device.label).startsWith(wanted));
}
```

In `apps/desktop/src/shared/media-jobs.ts`, replace:

```ts
  output: string;
}

export type MediaJob = ProxyJob | ThumbnailsJob | PeaksJob;

export interface ThumbnailsMeta {
  interval: number;
```

with:

```ts
  output: string;
}

/** `suggest` on a project (`input`: its folder): it decodes the whole take, so it runs here, not in the main process. */
export interface SuggestJob {
  job: 'suggest';
  input: string;
  output: string;
}

export type MediaJob = ProxyJob | ThumbnailsJob | PeaksJob | SuggestJob;

export interface ThumbnailsMeta {
  interval: number;
```

The IPC contract (`ipc.ts`, `channels.ts`) changes in Task 3, with the handlers that answer it.

In `apps/desktop/src/main/settings.ts`, replace:

```ts
  recent: z.array(z.object({ dir: z.string(), name: z.string(), opened: z.number() })).catch([]).default([]),
  /** Where the pill sits, per display (DIP), keyed by the display's id. */
  pill: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).catch({}).default({}),
});

export type Settings = z.output<typeof SettingsSchema>;
```

with:

```ts
  recent: z.array(z.object({ dir: z.string(), name: z.string(), opened: z.number() })).catch([]).default([]),
  /** Where the pill sits, per display (DIP), keyed by the display's id. */
  pill: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).catch({}).default({}),
  /** New recordings go into a new folder here. */
  projectsFolder: z
    .string()
    .min(1)
    .catch(() => join(app.getPath('home'), 'Cuttle'))
    .default(() => join(app.getPath('home'), 'Cuttle')),
  /** Seconds of countdown before a recording starts. */
  countdown: z.union([z.literal(0), z.literal(3), z.literal(5)]).catch(3).default(3),
  /** The picker bar's choices, kept between recordings. */
  record: z
    .object({ camera: z.string().optional(), mic: z.string().optional(), stop: z.enum(['none', 'claude', 'idle']).default('none'), claudeFolder: z.string().optional() })
    .catch({ stop: 'none' as const })
    .default({ stop: 'none' as const }),
});

export type Settings = z.output<typeof SettingsSchema>;
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node apps/desktop/test/recording.test.ts`
Expected: PASS, 8 tests.

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/shared apps/desktop/src/main/settings.ts apps/desktop/test/recording.test.ts
git commit -m "desktop: the recording model (hit tests, regions, capture sources, the HUD's place), the suggest job, the recording settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The main process: the recorder host, the picker's windows, the HUD, after the stop

**Files:**
- Create: `apps/desktop/src/main/{check,recorder-host,recording}.ts`, `apps/desktop/src/workers/recorder.ts`, `apps/desktop/src/preload/{picker,hud,countdown}.ts`
- Modify: `apps/desktop/src/main/{windows,index,tray,media-service}.ts`, `apps/desktop/src/workers/media.ts`, `apps/desktop/src/shared/{ipc,channels}.ts`, `apps/desktop/src/preload/bridge.ts`, `apps/desktop/vite.main.config.ts`

- [ ] **Step 1: The IPC contract, the check's switches and the recorder host**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
// what a window may send. The main process checks each request against it; the preloads expose only
// their window's channels.
import { z } from 'zod';

export const EXPORT_FORMATS = ['16:9', '1:1', '9:16'] as const;
/** What an export makes: the project's own output size, or a preset. */
```

with:

```ts
// what a window may send. The main process checks each request against it; the preloads expose only
// their window's channels.
import { z } from 'zod';
import type { PickedTarget, PickerDisplay, PickerWindow, RecordChoices } from './recording';

export type { PickedTarget, PickerDisplay, PickerWindow, Rect, RecordChoices } from './recording';

export const EXPORT_FORMATS = ['16:9', '1:1', '9:16'] as const;
/** What an export makes: the project's own output size, or a preset. */
```

In the same file, replace:

```ts
  | { state: 'cancelled'; files: ExportFile[] }
  | { state: 'failed'; files: ExportFile[]; format: ExportTarget; code: string; message: string };

/** Requests (window → main), each with the schema of its argument. */
export const REQUESTS = {
  // editor
```

with:

```ts
  | { state: 'cancelled'; files: ExportFile[] }
  | { state: 'failed'; files: ExportFile[]; format: ExportTarget; code: string; message: string };

/** What a picker shows: its display, the windows on it, the devices and the bar's choices. */
export interface PickerSetup {
  display: PickerDisplay;
  windows: PickerWindow[];
  cameras: string[];
  mics: string[];
  choices: RecordChoices;
  /** Whether this picker is on the display the pointer is on (it shows the bar). */
  active: boolean;
  countdown: number;
  /** Why recording cannot start (no ffmpeg, the recorder failed), said for people. */
  problem?: string;
}

/** What the HUD shows. */
export interface HudState {
  phase: 'countdown' | 'recording' | 'stopping';
  /** When the take started (epoch milliseconds). */
  startedAt?: number;
  markers: number;
  /** A warning from the recorder, or "Stopping…". */
  message?: string;
}

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const deviceName = z.string().min(1).max(512);

/** Requests (window → main), each with the schema of its argument. */
export const REQUESTS = {
  // editor
```

In the same file, replace:

```ts
  'pill:open': z.strictObject({ dir: z.string().min(1).max(4096) }).optional(),
  'pill:hide': z.undefined(),
  'pill:menu': z.undefined(),
} as const;

export type Request = keyof typeof REQUESTS;
```

with:

```ts
  'pill:open': z.strictObject({ dir: z.string().min(1).max(4096) }).optional(),
  'pill:hide': z.undefined(),
  'pill:menu': z.undefined(),
  'pill:record': z.undefined(),
  // editor (recording)
  'project:record': z.undefined(),
  'project:takes': z.undefined(),
  // picker
  'picker:setup': z.undefined(),
  'picker:hover': z.undefined(),
  'picker:choices': z.strictObject({
    camera: deviceName.optional(),
    mic: deviceName.optional(),
    stop: z.enum(['none', 'claude', 'idle']),
    claudeFolder: z.string().min(1).max(4096).optional(),
  }),
  'picker:record': z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('screen'), display: z.number().int() }),
    z.strictObject({ kind: z.literal('window'), display: z.number().int(), window: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal('region'), display: z.number().int(), rect }),
  ]),
  'picker:cancel': z.undefined(),
  'picker:claude-folder': z.undefined(),
  // HUD
  'hud:stop': z.undefined(),
  'hud:marker': z.undefined(),
} as const;

export type Request = keyof typeof REQUESTS;
```

In the same file, replace:

```ts
  'pill:open': void;
  'pill:hide': void;
  'pill:menu': void;
}

/** Events (main → window). */
```

with:

```ts
  'pill:open': void;
  'pill:hide': void;
  'pill:menu': void;
  'pill:record': void;
  'project:record': void;
  'project:takes': void;
  'picker:setup': PickerSetup | undefined;
  'picker:hover': void;
  'picker:choices': void;
  'picker:record': void;
  'picker:cancel': void;
  'picker:claude-folder': string | undefined;
  'hud:stop': void;
  'hud:marker': void;
}

/** Events (main → window). */
```

In the same file, replace:

```ts
  'export:progress': ExportProgress;
  'export:end': ExportEnd;
  'pill:recent': Responses['pill:recent'];
}

export type Event = keyof Events;
```

with:

```ts
  'export:progress': ExportProgress;
  'export:end': ExportEnd;
  'pill:recent': Responses['pill:recent'];
  'picker:open': PickerSetup;
  'picker:active': { display: number };
  'picker:choices': RecordChoices;
  'countdown:tick': { seconds: number };
  'hud:state': HudState;
  /** What the main process is doing to the project (cutting the take), or nothing. */
  'project:status': { text?: string };
}

export type Event = keyof Events;
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts

export const WINDOW_CHANNELS = {
  editor: {
    requests: ['project:info', 'project:reveal', 'media:state', 'media:retry', 'export:targets', 'export:start', 'export:cancel'],
    events: ['media:state', 'export:progress', 'export:end'],
  },
  pill: {
    requests: ['pill:recent', 'pill:open', 'pill:hide', 'pill:menu'],
    events: ['pill:recent'],
  },
} as const satisfies Record<string, { requests: readonly Request[]; events: readonly Event[] }>;

export type WindowKind = keyof typeof WINDOW_CHANNELS;
```

with:

```ts

export const WINDOW_CHANNELS = {
  editor: {
    requests: ['project:info', 'project:reveal', 'media:state', 'media:retry', 'export:targets', 'export:start', 'export:cancel', 'project:record', 'project:takes'],
    events: ['media:state', 'export:progress', 'export:end', 'project:status'],
  },
  pill: {
    requests: ['pill:recent', 'pill:open', 'pill:hide', 'pill:menu', 'pill:record'],
    events: ['pill:recent'],
  },
  picker: {
    requests: ['picker:setup', 'picker:hover', 'picker:choices', 'picker:record', 'picker:cancel', 'picker:claude-folder'],
    events: ['picker:open', 'picker:active', 'picker:choices'],
  },
  hud: {
    requests: ['hud:stop', 'hud:marker'],
    events: ['hud:state'],
  },
  countdown: {
    requests: [],
    events: ['countdown:tick'],
  },
} as const satisfies Record<string, { requests: readonly Request[]; events: readonly Event[] }>;

export type WindowKind = keyof typeof WINDOW_CHANNELS;
```

`apps/desktop/src/main/check.ts`:

```ts
// The end-to-end check's switches. Each acts only with --cuttle-check on the command line as well, so
// a stray environment variable cannot hide a real app or make it record test patterns.

export const CHECK = process.argv.includes('--cuttle-check');

/** Windows are never shown and dialogs become log lines (CUTTLE_HIDDEN=1). */
export const HIDDEN = CHECK && process.env.CUTTLE_HIDDEN === '1';

/** The recorder's `test` backend (ffmpeg test sources, synthetic input) instead of this machine (CUTTLE_RECORDER_BACKEND=test). */
export const TEST_BACKEND = CHECK && process.env.CUTTLE_RECORDER_BACKEND === 'test';

/** The countdown's seconds instead of the setting's (CUTTLE_COUNTDOWN=0 skips it). */
export const COUNTDOWN = CHECK && process.env.CUTTLE_COUNTDOWN !== undefined ? Number(process.env.CUTTLE_COUNTDOWN) : undefined;
```

`apps/desktop/src/workers/recorder.ts`:

```ts
// The recorder host: a utility process that runs `record()` (its input hook and koffi calls work
// here, away from the main process's event loop). One recording at a time; the main process sees
// every event and kills the capture processes if this process dies.
import { listDevices, record, RecorderError, type Backend, type Recording } from '@cuttle/recorder';
import type { HostReply, HostRequest } from '../shared/recording';

interface ParentPort {
  on(event: 'message', listener: (message: { data: HostRequest }) => void): void;
  postMessage(message: HostReply): void;
}

const port = (process as unknown as { parentPort: ParentPort }).parentPort;
/** The main process asks for the `test` backend only in the end-to-end check. */
const backend: Backend = process.argv.includes('--test-backend') ? 'test' : 'auto';
let recording: Recording | undefined;

const reply = (message: HostReply) => port.postMessage(message);

port.on('message', ({ data }) => {
  switch (data.type) {
    case 'devices':
      listDevices({ backend, media: data.media }).then(
        (devices) => reply({ type: 'devices', id: data.id, devices }),
        (error: Error) => reply({ type: 'devices', id: data.id, error: error.message }),
      );
      return;
    case 'start': {
      if (recording) return reply({ type: 'failed', code: 'invalid-options', message: 'a recording is already running' });
      const current = record({ ...data.options, backend, onEvent: (event) => reply({ type: 'event', event }) });
      recording = current;
      current.done.then(
        (take) => reply({ type: 'done', take }),
        (error: unknown) =>
          reply({ type: 'failed', code: error instanceof RecorderError ? error.code : 'capture', message: error instanceof Error ? error.message : String(error) }),
      ).finally(() => {
        if (recording === current) recording = undefined;
      });
      return;
    }
    case 'stop':
      void recording?.stop().catch(() => {});
      return;
    case 'marker':
      recording?.marker(data.label);
      return;
    case 'dead-zones':
      recording?.setDeadZones(data.zones);
      return;
  }
});
```

`apps/desktop/src/main/recorder-host.ts`:

```ts
import { utilityProcess, type UtilityProcess } from 'electron';
import type { Bounds, Devices, RecordOptions, RecorderEvent, Take } from '@cuttle/recorder';
import type { HostReply, HostRequest } from '../shared/recording';
import { TEST_BACKEND } from './check';
import { bundlePath } from './protocols';

/** A failed recording, with the recorder's error code (`capture`, `device-not-found`, …). */
export class RecordingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RecordingError';
  }
}

interface Running {
  onEvent: (event: RecorderEvent) => void;
  resolve: (take: Take) => void;
  reject: (error: Error) => void;
  /** ffmpeg's process ids, reported by the recorder as the tracks start. */
  pids: number[];
}

/**
 * The recorder host: a utility process running `record()`. If it dies during a recording, every
 * capture process it reported is killed, so nothing keeps recording without the app knowing.
 */
export class RecorderHost {
  private process: UtilityProcess | undefined;
  private next = 1;
  private readonly listings = new Map<number, { resolve: (devices: Devices) => void; reject: (error: Error) => void }>();
  private running: Running | undefined;

  private start(): UtilityProcess {
    if (this.process) return this.process;
    const child = utilityProcess.fork(bundlePath('main', 'recorder-host.mjs'), TEST_BACKEND ? ['--test-backend'] : [], { serviceName: 'Cuttle recorder', stdio: 'ignore' });
    child.on('message', (message: HostReply) => this.receive(message));
    child.on('exit', (code) => {
      this.process = undefined;
      for (const listing of this.listings.values()) listing.reject(new RecordingError('capture', 'the recorder stopped'));
      this.listings.clear();
      const running = this.running;
      if (running) {
        this.running = undefined;
        for (const pid of running.pids) {
          try {
            process.kill(pid);
          } catch {
            // already gone
          }
        }
        running.reject(new RecordingError('capture', `the recorder stopped unexpectedly (exit code ${code}); the capture was ended`));
      }
    });
    this.process = child;
    return child;
  }

  private send(request: HostRequest): void {
    this.start().postMessage(request);
  }

  private receive(message: HostReply): void {
    switch (message.type) {
      case 'devices': {
        const listing = this.listings.get(message.id);
        this.listings.delete(message.id);
        if (message.devices) listing?.resolve(message.devices);
        else listing?.reject(new RecordingError('device-not-found', message.error ?? 'the devices could not be listed'));
        return;
      }
      case 'event':
        if (message.event.type === 'processes' && this.running) this.running.pids.push(...message.event.pids);
        this.running?.onEvent(message.event);
        return;
      case 'done': {
        const running = this.running;
        this.running = undefined;
        running?.resolve(message.take);
        return;
      }
      case 'failed': {
        const running = this.running;
        this.running = undefined;
        running?.reject(new RecordingError(message.code, message.message));
        return;
      }
    }
  }

  /** Monitors, windows, and (with `media`) cameras and mics, as the recorder sees them. */
  devices(media: boolean): Promise<Devices> {
    const id = this.next++;
    const promise = new Promise<Devices>((resolve, reject) => this.listings.set(id, { resolve, reject }));
    this.send({ type: 'devices', id, media });
    return promise;
  }

  get recording(): boolean {
    return this.running !== undefined;
  }

  /** Records a take; resolves with it when the recording stops (by `stop()`, the hotkey or a trigger). */
  record(options: Omit<RecordOptions, 'onEvent'>, onEvent: (event: RecorderEvent) => void): Promise<Take> {
    if (this.running) return Promise.reject(new RecordingError('invalid-options', 'a recording is already running'));
    const promise = new Promise<Take>((resolve, reject) => (this.running = { onEvent, resolve, reject, pids: [] }));
    this.send({ type: 'start', options });
    return promise;
  }

  stop(): void {
    if (this.running) this.send({ type: 'stop' });
  }

  marker(label?: string): void {
    if (this.running) this.send({ type: 'marker', ...(label !== undefined && { label }) });
  }

  setDeadZones(zones: Bounds[]): void {
    if (this.running) this.send({ type: 'dead-zones', zones });
  }

  quit(): void {
    this.process?.kill();
  }
}

export const recorderHost = new RecorderHost();
```

In `apps/desktop/vite.main.config.ts`, replace:

```ts
      input: {
        index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
        'media-worker': fileURLToPath(new URL('./src/workers/media.ts', import.meta.url)),
      },
      external: ['electron', 'koffi', 'uiohook-napi'],
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
```

with:

```ts
      input: {
        index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
        'media-worker': fileURLToPath(new URL('./src/workers/media.ts', import.meta.url)),
        'recorder-host': fileURLToPath(new URL('./src/workers/recorder.ts', import.meta.url)),
      },
      external: ['electron', 'koffi', 'uiohook-napi'],
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
```

- [ ] **Step 2: `suggest` in the media worker**

In `apps/desktop/src/workers/media.ts`, replace:

```ts
// the main process queues them.
import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { ffmpegPath, probeScreen, streamSeconds } from '@cuttle/core';
import {
  PEAKS_SAMPLE_RATE,
  PeakFolder,
```

with:

```ts
// the main process queues them.
import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { ffmpegPath, probeScreen, streamSeconds, suggestProject } from '@cuttle/core';
import {
  PEAKS_SAMPLE_RATE,
  PeakFolder,
```

In the same file, replace:

```ts
      );
      return meta;
    }
    case 'peaks': {
      const seconds = await streamSeconds(job.input, 'a');
      const folder = new PeakFolder();
```

with:

```ts
      );
      return meta;
    }
    case 'suggest': {
      await suggestProject(job.input, { onStatus: () => reply({ id, progress: 0 }) });
      return undefined;
    }
    case 'peaks': {
      const seconds = await streamSeconds(job.input, 'a');
      const folder = new PeakFolder();
```

In `apps/desktop/src/main/media-service.ts`, replace:

```ts

export const mediaWorker = new Worker();

async function sourceKey(path: string, file: string): Promise<SourceKey | undefined> {
  try {
    const info = await stat(path);
```

with:

```ts

export const mediaWorker = new Worker();

/** Cuts a project's take with `suggest` (in the media worker); its hash-checked write never overwrites a newer save. */
export async function cutTake(dir: string): Promise<void> {
  await mediaWorker.run({ job: 'suggest', input: dir, output: '' }, () => {}).promise;
}

async function sourceKey(path: string, file: string): Promise<SourceKey | undefined> {
  try {
    const info = await stat(path);
```

- [ ] **Step 3: Recording: pickers, countdown, HUD, and after the stop**

`apps/desktop/src/main/recording.ts`:

```ts
// Recording from the app: the pickers (one per display), the countdown over the target, the HUD,
// the recorder host, and what happens after the stop: the take becomes the project's, the editor
// opens on it, and `suggest` cuts it in the background.
import { copyFile, mkdir, statfs } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BrowserWindow, dialog, globalShortcut, screen, session, type Rectangle } from 'electron';
import { PROJECT_FILE, newProjectFile, projectExists, readProjectFile, recoverTake, useTake, writeProjectFile } from '@cuttle/core';
import { focusWindow, recentClaudeFolders, type Devices, type RecorderEvent, type Take } from '@cuttle/recorder';
import type { HudState, PickedTarget, PickerSetup, RecordChoices } from '../shared/ipc';
import { captureSourceFor, hudPosition, stopOptionsFor, type PickerDisplay, type PickerWindow } from '../shared/recording';
import { COUNTDOWN, HIDDEN, TEST_BACKEND } from './check';
import { bindRequests, send } from './ipc';
import { cutTake } from './media-service';
import { APP_ORIGIN, serveApp, bundlePath } from './protocols';
import { recorderHost, RecordingError } from './recorder-host';
import { loadSettings, updateSettings } from './settings';
import { editorWindowOf, guard, reopenEditor, setEditorStatus, webPreferences } from './windows';

/** The window the recorder never sees and logs no input from. */
const HUD_SIZE = { width: 380, height: 64 };

interface Picker {
  window: BrowserWindow;
  display: number;
  setup?: PickerSetup;
}

let pickers: Picker[] = [];
let pickerSession: Electron.Session | undefined;
/** The project folder the next take goes into; undefined: a new project. */
let pickingFor: string | undefined;
let picking = false;

function pickerSessionOnce(): Electron.Session {
  if (pickerSession) return pickerSession;
  const ses = session.fromPartition('picker');
  // Camera and mic previews, for the picker's own pages only (checked by the requesting contents).
  const isPicker = (contents: Electron.WebContents | null) => contents !== null && pickers.some((picker) => !picker.window.isDestroyed() && picker.window.webContents.id === contents.id);
  ses.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'media' && isPicker(contents)));
  ses.setPermissionCheckHandler((contents, permission) => permission === 'media' && isPicker(contents));
  ses.on('will-download', (event) => event.preventDefault());
  serveApp(ses, bundlePath('renderer'));
  pickerSession = ses;
  return ses;
}

/** A frameless, transparent, content-protected window over everything. */
function overlay(bounds: Rectangle, preload: string, options: Electron.BrowserWindowConstructorOptions = {}): BrowserWindow {
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Cuttle',
    webPreferences: webPreferences(preload, pickerSessionOnce()),
    ...options,
  });
  guard(window.webContents);
  window.setContentProtection(true);
  window.setAlwaysOnTop(true, 'screen-saver');
  return window;
}

/** Electron's displays matched with the recorder's monitors (equal physical bounds; by order with the test backend). */
function pickerDisplays(devices: Devices): PickerDisplay[] {
  const displays = screen.getAllDisplays();
  return displays.map((display, order) => {
    const physical = screen.dipToScreenRect(null, display.bounds);
    const monitor = TEST_BACKEND
      ? devices.monitors[order]
      : devices.monitors.find(({ bounds }) => bounds.x === physical.x && bounds.y === physical.y && bounds.width === physical.width && bounds.height === physical.height);
    return {
      id: display.id,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      ...(monitor && { monitor: monitor.index }),
      pixels: monitor ? { width: monitor.bounds.width, height: monitor.bounds.height } : { width: physical.width, height: physical.height },
      label: display.label || monitor?.name || `Display ${order + 1}`,
    };
  });
}

/** The recorder's windows on a display, in DIP, front to back; the app's own windows left out. */
function windowsOn(display: PickerDisplay, devices: Devices): PickerWindow[] {
  return devices.windows
    .filter((window) => window.pid !== process.pid && window.monitor === display.monitor)
    .map((window) => ({
      id: window.id,
      title: window.title,
      className: window.className,
      bounds: TEST_BACKEND ? window.bounds : screen.screenToDipRect(null, window.bounds),
      pixels: { width: window.bounds.width, height: window.bounds.height },
    }));
}

async function choicesNow(devices: Devices): Promise<RecordChoices> {
  const saved = (await loadSettings()).record;
  const claudeFolder = saved.claudeFolder ?? (await recentClaudeFolders(1).catch(() => []))[0]?.cwd;
  return {
    stop: saved.stop,
    ...(saved.camera && devices.cameras.includes(saved.camera) && { camera: saved.camera }),
    ...(saved.mic && devices.mics.includes(saved.mic) && { mic: saved.mic }),
    ...(claudeFolder && { claudeFolder }),
  };
}

const countdownSeconds = async () => COUNTDOWN ?? (await loadSettings()).countdown;

const GB = 1024 ** 3;

/** Free bytes on the drive that holds `folder` (its nearest existing parent); undefined when that cannot be read. */
async function freeBytes(folder: string): Promise<number | undefined> {
  let path = resolve(folder);
  while (!existsSync(path) && resolve(path, '..') !== path) path = resolve(path, '..');
  try {
    const info = await statfs(path);
    return info.bavail * info.bsize;
  } catch {
    return undefined;
  }
}

/**
 * About ten minutes of a take of the largest display, in bytes: the screen at about 0.1 bit per pixel
 * and frame (30 fps), plus a camera and the mic. A warning below it, not a refusal.
 */
function tenMinutes(displays: readonly PickerDisplay[]): number {
  const pixels = Math.max(0, ...displays.map((display) => display.pixels.width * display.pixels.height));
  return ((pixels * 30 * 0.1 + 2_500_000 + 128_000) / 8) * 600;
}

const gigabytes = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;

/**
 * Shows the pickers on every display: a new recording (`projectDir` undefined: a new project in the
 * projects folder) or the next take of an open project. Does nothing while one records or picks.
 */
export async function startPicking(projectDir?: string): Promise<void> {
  if (picking || recorderHost.recording) return;
  picking = true;
  pickingFor = projectDir;
  let devices: Devices;
  let problem: string | undefined;
  try {
    devices = await recorderHost.devices(true);
  } catch (error) {
    devices = { monitors: [], windows: [], cameras: [], mics: [] };
    problem = `Cuttle cannot record: ${(error as Error).message}`;
  }
  const displays = pickerDisplays(devices);
  const choices = await choicesNow(devices);
  const free = await freeBytes(projectDir ?? (await loadSettings()).projectsFolder);
  if (!problem && free !== undefined && free < tenMinutes(displays)) problem = `Only ${gigabytes(free)} free on this drive: a take longer than a few minutes may not fit.`;
  const countdown = await countdownSeconds();
  const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  for (const picker of pickers) if (!picker.window.isDestroyed()) picker.window.destroy();
  pickers = displays.map((display) => {
    const window = overlay(display.bounds, 'picker.cjs', { focusable: true });
    const picker: Picker = { window, display: display.id };
    picker.setup = {
      display,
      windows: windowsOn(display, devices),
      cameras: devices.cameras,
      mics: devices.mics,
      choices,
      active: display.id === cursor.id,
      countdown,
      ...((problem ?? (display.monitor === undefined ? 'The recorder does not know this display; pick another one.' : undefined)) && {
        problem: problem ?? 'The recorder does not know this display; pick another one.',
      }),
    };
    bindRequests(window.webContents, 'picker', {
      'picker:setup': () => picker.setup,
      'picker:hover': () => activate(display.id),
      'picker:choices': async (next) => {
        await updateSettings((settings) => {
          settings.record = { ...settings.record, ...next, stop: next.stop };
          if (next.camera === undefined) delete settings.record.camera;
          if (next.mic === undefined) delete settings.record.mic;
        });
        for (const other of pickers) {
          if (other.setup) other.setup.choices = next;
          if (other !== picker) send(other.window.webContents, 'picker:choices', next);
        }
      },
      'picker:record': (target) => void beginRecording(target, displays),
      'picker:cancel': () => endPicking(),
      'picker:claude-folder': async () => {
        const result = await dialog.showOpenDialog(window, { title: 'The folder Claude Code runs in', properties: ['openDirectory'] });
        return result.canceled ? undefined : result.filePaths[0];
      },
    });
    // A picker closed before its page loaded (Esc at once) rejects the load: nothing to show then.
    void window.loadURL(`${APP_ORIGIN}/picker.html`).then(
      () => {
        if (window.isDestroyed()) return;
        if (!HIDDEN) window.show();
        if (display.id === cursor.id) window.focus();
      },
      () => {},
    );
    return picker;
  });
}

function activate(display: number): void {
  for (const picker of pickers) {
    if (picker.setup) picker.setup.active = picker.display === display;
    send(picker.window.webContents, 'picker:active', { display });
    if (picker.display === display && !picker.window.isFocused()) picker.window.focus();
  }
}

function endPicking(): void {
  picking = false;
  for (const picker of pickers) if (!picker.window.isDestroyed()) picker.window.destroy();
  pickers = [];
}

/** The rectangle (DIP) a pick covers, for the countdown. */
function targetRect(target: PickedTarget, display: PickerDisplay, picked: PickerSetup | undefined): Rectangle {
  if (target.kind === 'region') return roundRect(target.rect);
  if (target.kind === 'window') {
    const window = picked?.windows.find((candidate) => candidate.id === target.window);
    if (window) return roundRect(window.bounds);
  }
  return display.bounds;
}

const roundRect = (rect: { x: number; y: number; width: number; height: number }): Rectangle => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  width: Math.max(1, Math.round(rect.width)),
  height: Math.max(1, Math.round(rect.height)),
});

/** A new project's folder in the projects folder: the date and time (no colons on Windows), "(2)" … when it is taken. */
async function newProjectDir(): Promise<string> {
  const { projectsFolder } = await loadSettings();
  await mkdir(projectsFolder, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replaceAll(':', '.');
  for (let n = 1; ; n++) {
    const dir = join(projectsFolder, n === 1 ? stamp : `${stamp} (${n})`);
    try {
      await mkdir(dir);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** The take folder number a project uses now (`takes/<n>/screen.mp4`), if any. */
function currentTake(raw: Record<string, unknown>): string | undefined {
  const screen = (raw.sources as { screen?: unknown } | undefined)?.screen;
  const match = typeof screen === 'string' ? /^takes\/(\d+)\//.exec(screen.replaceAll('\\', '/')) : null;
  return match?.[1];
}

async function beginRecording(target: PickedTarget, displays: PickerDisplay[]): Promise<void> {
  const display = displays.find((candidate) => candidate.id === target.display);
  const picked = pickers.find((picker) => picker.display === target.display)?.setup;
  const choices = picked?.choices ?? { stop: 'none' as const };
  endPicking();
  if (!display) return;
  let source;
  try {
    source = captureSourceFor(target, display);
  } catch (error) {
    return say(`Cuttle cannot record this: ${(error as Error).message}`);
  }
  const projectDir = pickingFor ?? (await newProjectDir());
  // The project's editor is not in its own take: hidden while it records again, shown after.
  const editor = pickingFor ? await editorWindowOf(pickingFor) : undefined;
  editor?.hide();
  const showEditor = () => editor && !editor.isDestroyed() && !HIDDEN && editor.show();
  // The edit of the take the project uses now stays restorable ("Back to take n").
  if (projectExists(projectDir)) {
    const file = await readProjectFile(projectDir).catch(() => undefined);
    const take = file && currentTake(file.raw);
    if (take && existsSync(join(projectDir, 'takes', take))) await copyFile(join(projectDir, PROJECT_FILE), join(projectDir, 'takes', take, PROJECT_FILE)).catch(() => {});
  }

  const countdown = overlay(targetRect(target, display, picked), 'countdown.cjs', { focusable: false });
  countdown.setIgnoreMouseEvents(true);
  // Without a countdown (0 s) it closes before its page loaded, which rejects the load.
  void countdown.loadURL(`${APP_ORIGIN}/countdown.html`).then(
    () => !HIDDEN && !countdown.isDestroyed() && countdown.showInactive(),
    () => {},
  );
  const position = hudPosition(display, HUD_SIZE);
  const hud = overlay({ ...position, ...HUD_SIZE }, 'hud.cjs', { focusable: false, movable: true });
  const hudState: HudState = { phase: 'countdown', markers: 0 };
  const showHud = () => send(hud.webContents, 'hud:state', { ...hudState });
  bindRequests(hud.webContents, 'hud', {
    'hud:stop': () => {
      hudState.phase = 'stopping';
      hudState.message = 'Stopping…';
      showHud();
      recorderHost.stop();
    },
    'hud:marker': () => recorderHost.marker(),
  });
  bindRequests(countdown.webContents, 'countdown', {});
  const deadZone = () => screen.dipToScreenRect(null, hud.getBounds());
  hud.on('moved', () => recorderHost.setDeadZones([deadZone()]));
  void hud.loadURL(`${APP_ORIGIN}/hud.html`).catch(() => {});
  const cancelKey = 'Escape';
  globalShortcut.register(cancelKey, () => recorderHost.stop());
  const closeOverlays = () => {
    if (globalShortcut.isRegistered(cancelKey)) globalShortcut.unregister(cancelKey);
    if (!countdown.isDestroyed()) countdown.destroy();
  };

  const onEvent = (event: RecorderEvent) => {
    switch (event.type) {
      case 'countdown':
        send(countdown.webContents, 'countdown:tick', { seconds: event.seconds });
        return;
      case 'recording':
        closeOverlays();
        takeDir = event.dir;
        hudState.phase = 'recording';
        hudState.startedAt = Date.now();
        if (!HIDDEN) hud.showInactive();
        showHud();
        // The picker had the focus: give it back to the window being recorded.
        if (target.kind === 'window' && !TEST_BACKEND) void focusWindow(target.window).catch(() => false);
        watch = setInterval(() => void watchTake(), 2000);
        return;
      case 'marker':
        hudState.markers++;
        showHud();
        return;
      case 'warning':
        hudState.message = event.message;
        showHud();
        return;
      case 'stopping':
        hudState.phase = 'stopping';
        hudState.message = 'Stopping…';
        showHud();
        return;
    }
  };

  // While it records: a warning when the drive fills up, or when a recorded window moves (its area
  // stays where it was picked).
  let takeDir: string | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;
  let lastSpaceCheck = 0;
  const pickedWindow = target.kind === 'window' ? picked?.windows.find((candidate) => candidate.id === target.window) : undefined;
  const watchTake = async () => {
    if (hudState.phase !== 'recording') return;
    if (Date.now() - lastSpaceCheck > 30_000) {
      lastSpaceCheck = Date.now();
      const left = await freeBytes(projectDir);
      if (left !== undefined && left < 2 * GB && hudState.message === undefined) {
        hudState.message = `Disk almost full: ${gigabytes(left)} left`;
        showHud();
      }
    }
    if (pickedWindow && hudState.message === undefined) {
      const now = (await recorderHost.devices(false).catch(() => undefined))?.windows.find((window) => window.id === pickedWindow.id);
      const before = pickedWindow.pixels;
      if (now && (now.bounds.width !== before.width || now.bounds.height !== before.height || moved(now.bounds))) {
        hudState.message = 'The window moved: its old area is recorded';
        showHud();
      }
    }
  };
  /** Whether a window's physical bounds left where it was picked (DIP bounds converted back). */
  const moved = (bounds: { x: number; y: number }) => {
    if (!pickedWindow) return false;
    const origin = TEST_BACKEND ? pickedWindow.bounds : screen.dipToScreenRect(null, roundRect(pickedWindow.bounds));
    return Math.abs(bounds.x - origin.x) > 2 || Math.abs(bounds.y - origin.y) > 2;
  };

  let take: Take;
  try {
    take = await recorderHost.record(
      {
        projectDir,
        source,
        ...(choices.camera && { webcam: choices.camera }),
        ...(choices.mic && { mic: choices.mic }),
        stop: stopOptionsFor(choices),
        countdownSeconds: await countdownSeconds(),
        deadZones: [deadZone()],
      },
      onEvent,
    );
  } catch (error) {
    clearInterval(watch);
    closeOverlays();
    if (!hud.isDestroyed()) hud.destroy();
    if (error instanceof RecordingError && error.code === 'cancelled') return void showEditor();
    // A take that had started is kept: repaired with recover, then opened like any other.
    if (takeDir) return recoverAndOpen(projectDir, takeDir, (error as Error).message);
    showEditor();
    return say(`The recording failed: ${(error as Error).message}`);
  }
  clearInterval(watch);
  closeOverlays();
  if (!hud.isDestroyed()) hud.destroy();
  await finishTake(projectDir, take);
}

/** A take that ended badly (the capture failed after it started): `recover` repairs it and points the project at it. */
async function recoverAndOpen(projectDir: string, takeDir: string, why: string): Promise<void> {
  const dir = resolve(projectDir);
  try {
    const result = await recoverTake(dir, takeDir);
    say(`The recording stopped early (${why}). Cuttle kept the ${Math.round(result.seconds)} s it had${result.repaired.length > 0 ? ` and repaired it: ${result.repaired.join('; ')}` : ''}.`);
  } catch (error) {
    return say(`The recording failed (${why}), and its take in ${takeDir} could not be recovered: ${(error as Error).message}`);
  }
  await cutAndShow(dir);
}

/** The take becomes the project's (its previous version kept as a backup), the editor opens on it, and `suggest` cuts it. */
async function finishTake(projectDir: string, take: Take): Promise<void> {
  try {
    const file = projectExists(projectDir) ? await readProjectFile(projectDir) : newProjectFile(projectDir);
    const hadEdit = useTake(file, take);
    await writeProjectFile(file, 'record', { backup: hadEdit });
  } catch (error) {
    return say(`The take is saved in ${take.dir}, but cuttle.json could not be pointed at it: ${(error as Error).message}. Run "cuttle recover ${take.dir}".`);
  }
  await cutAndShow(resolve(projectDir));
}

/** Opens the editor on the take at once, and reloads it once `suggest` has cut it in the background. */
async function cutAndShow(dir: string): Promise<void> {
  await reopenEditor(dir);
  await setEditorStatus(dir, 'Cutting the take…');
  try {
    await cutTake(dir);
  } catch (error) {
    await setEditorStatus(dir, `The take could not be cut: ${(error as Error).message}`);
    return;
  }
  await setEditorStatus(dir, undefined);
  await reopenEditor(dir, { reload: true });
}

function say(message: string): void {
  if (HIDDEN) {
    console.error(message);
    return;
  }
  void dialog.showMessageBox({ type: 'warning', title: 'Cuttle', message });
}
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, Menu, screen, session, shell, type Session, type WebContents } from 'electron';
import { PROJECT_FILE, type ProjectFile } from '@cuttle/core';
import { plainIssue } from '../shared/format';
import type { ExportEnd } from '../shared/ipc';
import { isInside } from '../shared/media-path';
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
import { LockedError, lockProject, openProjectFile, projectInfo } from './project';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
import { addRecent, loadSettings, updateSettings } from './settings';

/**
 * Windows are never shown and dialogs become log lines: the end-to-end check, which sets
 * CUTTLE_HIDDEN=1 and passes --cuttle-check (both, so a stray variable cannot hide a real app).
 */
export const CHECK = process.argv.includes('--cuttle-check');
export const HIDDEN = CHECK && process.env.CUTTLE_HIDDEN === '1';

const BACKGROUND = '#0c0c0f';
const TITLE_BAR_HEIGHT = 44;
```

with:

```ts
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, Menu, screen, session, shell, type Session, type WebContents } from 'electron';
import { PROJECT_FILE, writeProjectFile, type ProjectFile } from '@cuttle/core';
import { plainIssue } from '../shared/format';
import type { ExportEnd } from '../shared/ipc';
import { isInside } from '../shared/media-path';
import { CHECK, HIDDEN } from './check';
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
import { LockedError, lockProject, openProjectFile, projectInfo } from './project';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
import { startPicking } from './recording';
import { addRecent, loadSettings, updateSettings } from './settings';


const BACKGROUND = '#0c0c0f';
const TITLE_BAR_HEIGHT = 44;
```

In the same file, replace:

```ts
  media: ProjectMedia;
  release: () => Promise<void>;
  run?: ExportRun;
}

/** Open editors and editors being opened, by the project folder's real path (junction and case aliases are one project). */
```

with:

```ts
  media: ProjectMedia;
  release: () => Promise<void>;
  run?: ExportRun;
  /** What the main process is doing to the project, shown in the title bar. */
  status?: string;
}

/** Open editors and editors being opened, by the project folder's real path (junction and case aliases are one project). */
```

In the same file, replace:

```ts
      return { out: join(dir, 'out') };
    },
    'export:cancel': () => editor.run?.cancel(),
  });

  window.on('closed', () => {
    if (editors.get(key) === editor) editors.delete(key);
    media.dispose();
    editor.run?.cancel();
    void release();
  });
  window.once('ready-to-show', () => {
    if (!HIDDEN) window.show();
```

with:

```ts
      return { out: join(dir, 'out') };
    },
    'export:cancel': () => editor.run?.cancel(),
    'project:record': () => void startPicking(dir),
    'project:takes': () => takesMenu(dir, window),
  });
  contents.on('did-finish-load', () => send(contents, 'project:status', { ...(editor.status !== undefined && { text: editor.status }) }));

  window.on('closed', () => {
    if (editors.get(key) === editor) editors.delete(key);
    media.dispose();
    editor.run?.cancel();
    void release();
    // Closing the last editor returns to the pill (not while an editor is reopened on a new take).
    if (editors.size === 0 && opening.size === 0 && reopening === 0 && !quitting) void showPill();
  });
  window.once('ready-to-show', () => {
    if (!HIDDEN) window.show();
```

In the same file, replace:

```ts
  return window;
}

/** One sentence for people from an error's message: the first line. */
const firstLine = (message: string) => message.split('\n')[0]!;
```

with:

```ts
  return window;
}

/** The open editor of a project folder (by its real path), if there is one. */
async function editorOf(dir: string): Promise<Editor | undefined> {
  const real = await realpath(resolve(dir)).catch(() => resolve(dir));
  return editors.get(keyOf(real));
}

/** The window of a project's open editor, if there is one. */
export async function editorWindowOf(dir: string): Promise<BrowserWindow | undefined> {
  const editor = await editorOf(dir);
  return editor && !editor.window.isDestroyed() ? editor.window : undefined;
}

/** Shows what the main process does to a project (`undefined`: nothing) in its editor's title bar. */
export async function setEditorStatus(dir: string, text: string | undefined): Promise<void> {
  const editor = await editorOf(dir);
  if (!editor) return;
  editor.status = text;
  send(editor.contents, 'project:status', { ...(text !== undefined && { text }) });
}

/**
 * Shows the project in an editor again after its take or its cut changed: `reload` reloads the
 * page (the same take, new scenes); otherwise the window is opened anew (a new take needs new media).
 */
export async function reopenEditor(dir: string, options: { reload?: boolean } = {}): Promise<void> {
  const editor = await editorOf(dir);
  reopening++;
  try {
    if (editor && !editor.window.isDestroyed()) {
      if (options.reload) {
        editor.contents.reload();
        if (!HIDDEN) editor.window.show();
        return;
      }
      const closed = new Promise<void>((done) => editor.window.once('closed', () => done()));
      editor.window.destroy();
      await closed;
      await editor.release();
    }
    await openEditorOrSay(dir);
  } finally {
    reopening--;
  }
}

/** Editors being reopened on a new take: their close does not bring the pill back. */
let reopening = 0;

/** The take folder a project uses now (`takes/<n>/screen.mp4` → n). */
const currentTake = (file: { raw: Record<string, unknown> }): string | undefined => /^takes\/(\d+)\//.exec(String((file.raw.sources as { screen?: unknown }).screen ?? '').replaceAll('\\', '/'))?.[1];

/** The takes a project can go back to (`takes/<n>/cuttle.json`, kept when it recorded again), as a menu. */
async function takesMenu(dir: string, window: BrowserWindow): Promise<void> {
  const current = currentTake(await openProjectFile(dir));
  const names = await readdir(join(dir, 'takes')).catch(() => [] as string[]);
  const kept = names
    .filter((name) => /^\d+$/.test(name) && name !== current && existsSync(join(dir, 'takes', name, PROJECT_FILE)))
    .sort((a, b) => Number(b) - Number(a));
  Menu.buildFromTemplate([
    { label: `Take ${current ?? '?'} (now)`, enabled: false },
    ...(kept.length === 0
      ? [{ label: 'No earlier take to go back to', enabled: false }]
      : kept.map((take) => ({ label: `Back to take ${take}`, click: () => void backToTake(dir, take) }))),
    { type: 'separator' },
    { label: 'Record a new take…', click: () => void startPicking(dir) },
  ]).popup({ window });
}

/** Makes an earlier take the project's again, with the edit it had; the current one stays restorable. */
async function backToTake(dir: string, take: string): Promise<void> {
  try {
    const file = await openProjectFile(dir);
    const current = currentTake(file);
    if (current) await copyFile(join(dir, PROJECT_FILE), join(dir, 'takes', current, PROJECT_FILE));
    const kept = JSON.parse(await readFile(join(dir, 'takes', take, PROJECT_FILE), 'utf8')) as Record<string, unknown>;
    await writeProjectFile({ ...file, raw: kept }, 'back to take', { backup: true });
  } catch (error) {
    if (!HIDDEN) void dialog.showMessageBox({ type: 'warning', title: 'Cuttle', message: `Cuttle cannot go back to take ${take}`, detail: (error as Error).message });
    return;
  }
  await reopenEditor(dir);
}

/** One sentence for people from an error's message: the first line. */
const firstLine = (message: string) => message.split('\n')[0]!;
```

In the same file, replace:

```ts
      else await chooseAndOpen();
    },
    'pill:hide': () => window.hide(),
    'pill:menu': async () => {
      const recent = (await loadSettings()).recent;
      Menu.buildFromTemplate([
```

with:

```ts
      else await chooseAndOpen();
    },
    'pill:hide': () => window.hide(),
    'pill:record': () => {
      window.hide();
      void startPicking();
    },
    'pill:menu': async () => {
      const recent = (await loadSettings()).recent;
      Menu.buildFromTemplate([
```

In `apps/desktop/src/main/tray.ts`, replace:

```ts
const label = (entry: { dir: string; name: string }) => `${entry.name} — ${entry.dir.split(/[\\/]/).at(-2) ?? ''}`;

export interface TrayActions {
  showPill(): void;
  open(dir?: string): void;
  quit(): void;
}

/** The tray menu: show the pill, the recent projects, open a folder, quit. */
export function trayMenu(recent: Settings['recent'], actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: 'Show Cuttle', click: () => actions.showPill() },
    { type: 'separator' },
    ...(recent.length === 0
```

with:

```ts
const label = (entry: { dir: string; name: string }) => `${entry.name} — ${entry.dir.split(/[\\/]/).at(-2) ?? ''}`;

export interface TrayActions {
  record(): void;
  showPill(): void;
  open(dir?: string): void;
  quit(): void;
}

/** The tray menu: a new recording, show the pill, the recent projects, open a folder, quit. */
export function trayMenu(recent: Settings['recent'], actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: 'New recording', accelerator: 'Control+Shift+Alt+R', click: () => actions.record() },
    { label: 'Show Cuttle', click: () => actions.showPill() },
    { type: 'separator' },
    ...(recent.length === 0
```

In `apps/desktop/src/main/index.ts`, replace:

```ts
// `--open <folder>` (also from a second launch) opens a project. The end-to-end check passes
// --cuttle-check with CUTTLE_HIDDEN=1 (no window is shown); CUTTLE_USER_DATA moves the settings.
import { resolve } from 'node:path';
import { app, Menu, session } from 'electron';
import { mediaWorker } from './media-service';
import { assetPath, registerSchemes } from './protocols';
import { loadSettings, onSettingsChange } from './settings';
import { createTray, updateTray, type TrayActions } from './tray';
import { HIDDEN, chooseAndOpen, createPill, lockDown, openEditorOrSay, showPill } from './windows';

app.setName('Cuttle');
if (process.env.CUTTLE_USER_DATA) app.setPath('userData', resolve(process.env.CUTTLE_USER_DATA));
```

with:

```ts
// `--open <folder>` (also from a second launch) opens a project. The end-to-end check passes
// --cuttle-check with CUTTLE_HIDDEN=1 (no window is shown); CUTTLE_USER_DATA moves the settings.
import { resolve } from 'node:path';
import { app, globalShortcut, Menu, session } from 'electron';
import { HIDDEN } from './check';
import { mediaWorker } from './media-service';
import { recorderHost } from './recorder-host';
import { startPicking } from './recording';
import { assetPath, registerSchemes } from './protocols';
import { loadSettings, onSettingsChange } from './settings';
import { createTray, updateTray, type TrayActions } from './tray';
import { chooseAndOpen, createPill, lockDown, openEditorOrSay, showPill } from './windows';

app.setName('Cuttle');
if (process.env.CUTTLE_USER_DATA) app.setPath('userData', resolve(process.env.CUTTLE_USER_DATA));
```

In the same file, replace:

```ts
  Menu.setApplicationMenu(null);

  const actions: TrayActions = {
    showPill: () => void showPill(),
    open: (dir) => void (dir ? openEditorOrSay(dir) : chooseAndOpen()),
    quit: () => app.quit(),
```

with:

```ts
  Menu.setApplicationMenu(null);

  const actions: TrayActions = {
    record: () => void startPicking(),
    showPill: () => void showPill(),
    open: (dir) => void (dir ? openEditorOrSay(dir) : chooseAndOpen()),
    quit: () => app.quit(),
```

In the same file, replace:

```ts

  // The app lives in the tray: closing the last editor does not quit it.
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => mediaWorker.stop());

  void app.whenReady().then(async () => {
    // The default session (the export's hidden window uses it) grants nothing either.
```

with:

```ts

  // The app lives in the tray: closing the last editor does not quit it.
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    mediaWorker.stop();
    recorderHost.quit();
  });

  void app.whenReady().then(async () => {
    // The default session (the export's hidden window uses it) grants nothing either.
```

In the same file, replace:

```ts
    const settings = await loadSettings();
    if (!HIDDEN) createTray(assetPath(process.platform === 'win32' ? 'tray.png' : 'tray@2x.png'), settings.recent, actions);
    await createPill();
    const dir = openArgument(process.argv, process.cwd());
    if (dir) await openEditorOrSay(dir);
    else await showPill();
```

with:

```ts
    const settings = await loadSettings();
    if (!HIDDEN) createTray(assetPath(process.platform === 'win32' ? 'tray.png' : 'tray@2x.png'), settings.recent, actions);
    await createPill();
    // A new recording from anywhere (the recorder's own keys stop it and set markers).
    if (!HIDDEN) globalShortcut.register('Control+Shift+Alt+R', () => void startPicking());
    const dir = openArgument(process.argv, process.cwd());
    if (dir) await openEditorOrSay(dir);
    else await showPill();
```

- [ ] **Step 4: The preloads**

In `apps/desktop/src/preload/bridge.ts`, replace:

```ts
export function exposeBridge(kind: WindowKind): void {
  const requests: readonly string[] = WINDOW_CHANNELS[kind].requests;
  const events: readonly string[] = WINDOW_CHANNELS[kind].events;
  contextBridge.exposeInMainWorld('cuttle', {
    invoke(channel: string, argument?: unknown): Promise<unknown> {
      if (!requests.includes(channel)) return Promise.reject(new Error(`unknown request ${channel}`));
```

with:

```ts
export function exposeBridge(kind: WindowKind): void {
  const requests: readonly string[] = WINDOW_CHANNELS[kind].requests;
  const events: readonly string[] = WINDOW_CHANNELS[kind].events;
  // Every event says a state (the HUD's, a status, the media), so a listener that subscribes after
  // one arrived (React sets up after the page loaded) starts from the newest instead of nothing.
  const last = new Map<string, unknown>();
  for (const channel of events) ipcRenderer.on(channel, (_event, payload: unknown) => last.set(channel, payload));
  contextBridge.exposeInMainWorld('cuttle', {
    invoke(channel: string, argument?: unknown): Promise<unknown> {
      if (!requests.includes(channel)) return Promise.reject(new Error(`unknown request ${channel}`));
```

In the same file, replace:

```ts
      if (!events.includes(channel)) throw new Error(`unknown event ${channel}`);
      const wrapped = (_event: unknown, payload: unknown) => listener(payload);
      ipcRenderer.on(channel, wrapped);
      return () => ipcRenderer.removeListener(channel, wrapped);
    },
  });
```

with:

```ts
      if (!events.includes(channel)) throw new Error(`unknown event ${channel}`);
      const wrapped = (_event: unknown, payload: unknown) => listener(payload);
      ipcRenderer.on(channel, wrapped);
      if (last.has(channel)) {
        const payload = last.get(channel);
        queueMicrotask(() => listener(payload));
      }
      return () => ipcRenderer.removeListener(channel, wrapped);
    },
  });
```

`apps/desktop/src/preload/picker.ts`:

```ts
import { exposeBridge } from './bridge';

exposeBridge('picker');
```

`apps/desktop/src/preload/hud.ts`:

```ts
import { exposeBridge } from './bridge';

exposeBridge('hud');
```

`apps/desktop/src/preload/countdown.ts`:

```ts
import { exposeBridge } from './bridge';

exposeBridge('countdown');
```

- [ ] **Step 5: Test, typecheck and commit**

Run: `pnpm exec vitest run --project node apps/desktop/test/contract.test.ts apps/desktop/test/recording.test.ts`
Expected: PASS, 14 tests (every request belongs to one kind of window).

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0, no output.

```bash
git add apps/desktop/src/main apps/desktop/src/workers apps/desktop/src/preload apps/desktop/src/shared apps/desktop/vite.main.config.ts
git commit -m "desktop: the recorder host, the pickers, countdown and HUD windows, and the take after the stop (suggest in the media worker, recover after a failed capture)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The picker, the countdown and the HUD pages; the editor's take controls

**Files:**
- Create: `apps/desktop/src/renderer/{picker,hud,countdown}.html`, `apps/desktop/src/renderer/picker/{Picker,Hud,Countdown,main,hud-main,countdown-main}.tsx`, `apps/desktop/src/renderer/picker/picker.css`
- Modify: `apps/desktop/src/renderer/editor/{App.tsx,session.ts,editor.css}`, `apps/desktop/src/renderer/pill/Pill.tsx`, `apps/desktop/scripts/build.mjs`, `apps/desktop/vite.renderer.config.ts`

- [ ] **Step 1: The pages**

`apps/desktop/src/renderer/picker.html`:

```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cuttle</title>
  </head>
  <body class="transparent">
    <div id="root"></div>
    <script type="module" src="./picker/main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/renderer/hud.html`:

```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cuttle</title>
  </head>
  <body class="transparent">
    <div id="root"></div>
    <script type="module" src="./picker/hud-main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/renderer/countdown.html`:

```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cuttle</title>
  </head>
  <body class="transparent">
    <div id="root"></div>
    <script type="module" src="./picker/countdown-main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/renderer/picker/main.tsx`:

```
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../base.css';
import './picker.css';
import { Picker } from './Picker';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Picker />
  </StrictMode>,
);
```

`apps/desktop/src/renderer/picker/hud-main.tsx`:

```
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../base.css';
import './picker.css';
import { Hud } from './Hud';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Hud />
  </StrictMode>,
);
```

`apps/desktop/src/renderer/picker/countdown-main.tsx`:

```
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../base.css';
import './picker.css';
import { Countdown } from './Countdown';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Countdown />
  </StrictMode>,
);
```

- [ ] **Step 2: The picker**

`apps/desktop/src/renderer/picker/Picker.tsx`:

```
// The picker: one transparent window per display, over everything. Hovering lights the window under
// the pointer (the display where there is none), dragging draws a region; the bar sets the camera,
// the mic and when to stop, and Enter records. Never in a recording (content protection).
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PickedTarget, PickerSetup, Rect, RecordChoices } from '../../shared/ipc';
import { dragRect, matchMediaDevice, windowsAt } from '../../shared/recording';
import { bridge } from '../bridge';
import { MicIcon, WarningIcon } from '../icons';

type Mode = 'auto' | 'screen' | 'window' | 'region';
type Shown = { kind: 'screen' | 'window' | 'region'; rect: Rect; title: string; pixels: { width: number; height: number }; window?: number };

const MIN_REGION = 16;
const BAR_HEIGHT = 52;

function Camera({ size }: { size?: number }) {
  return (
    <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="1.5" y="4" width="9" height="8" rx="1.5" />
      <path d="m10.5 7 4-2.5v7l-4-2.5" />
    </svg>
  );
}

const ModeIcons = {
  screen: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M5 14h6" />
    </svg>
  ),
  window: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M1.5 5.5h13" />
    </svg>
  ),
  region: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1" />
    </svg>
  ),
};

/** A local rect (DIP inside this display) in physical pixels of the display. */
const pixelsOf = (rect: Rect, scale: number) => ({ width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) });

export function Picker() {
  const [setup, setSetup] = useState<PickerSetup>();
  const [active, setActive] = useState(false);
  const [choices, setChoices] = useState<RecordChoices>({ stop: 'none' });
  const [mode, setMode] = useState<Mode>('auto');
  const [pointer, setPointer] = useState<{ x: number; y: number }>();
  const [cycle, setCycle] = useState(0);
  const [region, setRegion] = useState<Rect>();
  const [frozen, setFrozen] = useState<Shown>();
  const drag = useRef<{ from: { x: number; y: number }; handle?: string; start?: Rect; moved: boolean }>(undefined);

  useEffect(() => {
    const offOpen = bridge.on('picker:open', (next) => {
      setSetup(next);
      setActive(next.active);
      setChoices(next.choices);
      setMode('auto');
      setRegion(undefined);
      setFrozen(undefined);
      setCycle(0);
    });
    const offActive = bridge.on('picker:active', ({ display }) => setActive((current) => (setup ? display === setup.display.id : current)));
    const offChoices = bridge.on('picker:choices', (next) => setChoices(next));
    void bridge.invoke('picker:setup').then((initial) => {
      if (!initial) return;
      setSetup(initial);
      setActive(initial.active);
      setChoices(initial.choices);
    });
    return () => {
      offOpen();
      offActive();
      offChoices();
    };
  }, [setup?.display.id]);

  const display = setup?.display;
  const local = useMemo(
    () => (setup ? setup.windows.map((window) => ({ ...window, bounds: { ...window.bounds, x: window.bounds.x - setup.display.bounds.x, y: window.bounds.y - setup.display.bounds.y } })) : []),
    [setup],
  );
  const full: Rect = display ? { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height } : { x: 0, y: 0, width: 0, height: 0 };

  // What would be recorded now.
  const shown: Shown | undefined = useMemo(() => {
    if (!display) return undefined;
    if (frozen) return frozen;
    const screen: Shown = { kind: 'screen', rect: full, title: display.label, pixels: display.pixels };
    if (region && (mode === 'region' || mode === 'auto')) return { kind: 'region', rect: region, title: 'Region', pixels: pixelsOf(region, display.scaleFactor) };
    if (mode === 'region') return undefined;
    if (mode === 'screen') return screen;
    const under = pointer ? windowsAt(local, pointer.x, pointer.y) : [];
    const window = under.length > 0 ? under[cycle % under.length] : undefined;
    if (window) return { kind: 'window', rect: window.bounds, title: window.title, pixels: window.pixels, window: window.id };
    return mode === 'window' ? undefined : screen;
  }, [display, frozen, region, mode, pointer, local, cycle, full]);

  const record = useCallback(() => {
    if (!display || !shown) return;
    const target: PickedTarget =
      shown.kind === 'screen'
        ? { kind: 'screen', display: display.id }
        : shown.kind === 'window'
          ? { kind: 'window', display: display.id, window: shown.window! }
          : { kind: 'region', display: display.id, rect: { ...shown.rect, x: shown.rect.x + display.bounds.x, y: shown.rect.y + display.bounds.y } };
    void bridge.invoke('picker:record', target);
  }, [display, shown]);

  const updateChoices = (change: Partial<RecordChoices>) => {
    const next = { ...choices, ...change };
    setChoices(next);
    void bridge.invoke('picker:choices', next);
  };

  // Keys work on the display the pointer is on (that picker has the focus).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLSelectElement) return;
      const key = event.key;
      if (key === 'Escape') return void bridge.invoke('picker:cancel');
      if (key === 'Enter') return record();
      if (key === 'Tab') {
        event.preventDefault();
        setFrozen(undefined);
        setCycle((value) => value + 1);
        return;
      }
      const forced = ({ s: 'screen', w: 'window', r: 'region' } as const)[key.toLowerCase() as 's' | 'w' | 'r'];
      if (forced && !event.ctrlKey && !event.altKey) {
        setMode((current) => (current === forced ? 'auto' : forced));
        setFrozen(undefined);
        return;
      }
      if (region && key.startsWith('Arrow')) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1 / (display?.scaleFactor ?? 1);
        const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
        const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
        setRegion({ ...region, x: Math.min(Math.max(0, region.x + dx), full.width - region.width), y: Math.min(Math.max(0, region.y + dy), full.height - region.height) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [record, region, display, full.width, full.height]);

  const onMove = (event: ReactPointerEvent) => {
    const at = { x: event.clientX, y: event.clientY };
    if (!active) {
      setActive(true);
      void bridge.invoke('picker:hover');
    }
    const current = drag.current;
    if (current) {
      const moved = Math.hypot(at.x - current.from.x, at.y - current.from.y) > 4;
      current.moved ||= moved;
      if (current.handle && current.start) setRegion(resize(current.start, current.handle, at.x - current.from.x, at.y - current.from.y, full));
      else if (current.moved) setRegion(dragRect(current.from, at, full, event.shiftKey));
      return;
    }
    if (!frozen) setPointer(at);
  };

  const onDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    try {
      (event.target as Element).setPointerCapture(event.pointerId);
    } catch {
      // a synthetic pointer (the check) has nothing to capture
    }
    const handle = (event.target as HTMLElement).dataset.handle;
    drag.current = { from: { x: event.clientX, y: event.clientY }, handle, start: region, moved: false };
    setFrozen(undefined);
  };

  const onUp = () => {
    const current = drag.current;
    drag.current = undefined;
    if (!current) return;
    if (current.handle) return;
    if (current.moved) {
      setRegion((rect) => (rect && rect.width >= MIN_REGION && rect.height >= MIN_REGION ? rect : undefined));
      setMode((value) => (value === 'auto' || value === 'region' ? value : 'region'));
      return;
    }
    // A click picks what is lit and keeps it while the pointer goes to the bar.
    setRegion(undefined);
    if (shown) setFrozen(shown);
  };

  if (!setup || !display) return null;
  const rect = shown?.rect;
  const hole = rect
    ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.x}px ${rect.y}px, ${rect.x + rect.width}px ${rect.y}px, ${rect.x + rect.width}px ${rect.y + rect.height}px, ${rect.x}px ${rect.y + rect.height}px, ${rect.x}px ${rect.y}px)`
    : undefined;
  const barTop = rect ? Math.min(rect.y + rect.height + 24, full.height - BAR_HEIGHT - 56) : full.height - BAR_HEIGHT - 56;
  const labelTop = rect ? (rect.y >= 40 ? rect.y - 36 : rect.y + 8) : 0;
  const kindName = shown?.kind === 'screen' ? 'Screen' : shown?.kind === 'window' ? 'Window' : 'Region';
  const effective = shown?.kind ?? (mode === 'auto' ? 'screen' : mode);

  return (
    <div className={`picker${active ? '' : ' inactive'}`} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} data-testid="picker">
      <div className="dim" style={{ clipPath: active ? hole : undefined }} />
      {active && rect && (
        <>
          <div className={`target ${shown!.kind}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />
          <div className="target-label" style={{ left: Math.max(16, rect.x), top: labelTop }}>
            <b>
              {kindName}
              {shown!.kind === 'window' ? ` · ${shown!.title}` : shown!.kind === 'screen' ? ` · ${shown!.title}` : ''}
            </b>
            <span>
              {shown!.pixels.width} × {shown!.pixels.height} · {shown!.kind === 'window' ? 'records this area' : 'pixels'}
            </span>
          </div>
          {shown!.kind === 'region' &&
            ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => {
              const x = handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.width : rect.x + rect.width / 2;
              const y = handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.height : rect.y + rect.height / 2;
              return <div key={handle} className="handle" data-handle={handle} style={{ left: x, top: y, cursor: `${handle}-resize`, pointerEvents: 'auto' }} />;
            })}
        </>
      )}
      {active && (
        <>
          <div className="hint">
            <kbd>Esc</kbd> cancel · <kbd>Tab</kbd> next window · drag for a region · <kbd>S</kbd> <kbd>W</kbd> <kbd>R</kbd> mode
          </div>
          {choices.camera && rect && <CameraBubble name={choices.camera} rect={rect} />}
          {setup.problem && (
            <div className="problem" style={{ top: barTop - 52 }}>
              <WarningIcon size={15} />
              {setup.problem}
            </div>
          )}
          <div className="bar-rec" style={{ top: barTop }} onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
            <div className="modes" role="group" aria-label="What to record">
              {(['screen', 'window', 'region'] as const).map((kind) => (
                <button key={kind} aria-pressed={effective === kind} onClick={() => setMode((current) => (current === kind ? 'auto' : kind))} title={`${kind[0]!.toUpperCase()}${kind.slice(1)} (${kind[0]!.toUpperCase()})`}>
                  {ModeIcons[kind]}
                  {kind[0]!.toUpperCase() + kind.slice(1)}
                </button>
              ))}
            </div>
            <div className="divider" />
            <Device label="Camera" icon={<Camera />} names={setup.cameras} chosen={choices.camera} onChange={(camera) => updateChoices({ camera })} />
            <Device label="Mic" icon={<MicIcon />} names={setup.mics} chosen={choices.mic} onChange={(mic) => updateChoices({ mic })} meter={choices.mic && active ? <MicMeter name={choices.mic} /> : undefined} />
            <div className={`opt${choices.stop !== 'none' ? ' on' : ''}`}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
                <circle cx="8" cy="8" r="2" />
              </svg>
              <div className="name">
                Stop on
                <select value={choices.stop} onChange={(event) => updateChoices({ stop: event.target.value as RecordChoices['stop'] })} aria-label="Stop on">
                  <option value="none">my stop (Ctrl Shift Alt S)</option>
                  <option value="claude">Claude's answer</option>
                  <option value="idle">10 s without change</option>
                </select>
              </div>
              {choices.stop === 'claude' && (
                <button
                  className="more"
                  title={choices.claudeFolder ? `Claude Code runs in ${choices.claudeFolder}; choose another folder` : 'Choose the folder Claude Code runs in'}
                  onClick={() => void bridge.invoke('picker:claude-folder').then((folder) => folder && updateChoices({ claudeFolder: folder }))}
                >
                  <small>{choices.claudeFolder ? choices.claudeFolder.split(/[\\/]/).at(-1) : 'folder…'}</small>
                </button>
              )}
            </div>
            <div className="divider" />
            <button className="rec" onClick={record} disabled={!shown || (choices.stop === 'claude' && !choices.claudeFolder)} data-testid="picker-record">
              <i />
              Record <kbd>Enter</kbd>
            </button>
          </div>
          <div className="stopwhen" style={{ top: barTop + BAR_HEIGHT + 12 }}>
            <span>
              <b>{setup.countdown} s</b> countdown
            </span>
            <span>
              stop <kbd>Ctrl Shift Alt S</kbd>
            </span>
            <span>
              marker <kbd>Ctrl Shift Alt M</kbd>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** A region resized by one of its eight handles, kept inside the display and at least 16 DIP. */
function resize(start: Rect, handle: string, dx: number, dy: number, area: Rect): Rect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = Math.min(Math.max(area.x, left + dx), right - MIN_REGION);
  if (handle.includes('e')) right = Math.max(Math.min(area.x + area.width, right + dx), left + MIN_REGION);
  if (handle.includes('n')) top = Math.min(Math.max(area.y, top + dy), bottom - MIN_REGION);
  if (handle.includes('s')) bottom = Math.max(Math.min(area.y + area.height, bottom + dy), top + MIN_REGION);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function Device(props: { label: string; icon: React.ReactNode; names: string[]; chosen?: string; onChange: (name: string | undefined) => void; meter?: React.ReactNode }) {
  const { label, icon, names, chosen, onChange, meter } = props;
  const on = chosen !== undefined;
  return (
    <div className={`opt${on ? ' on' : ''}`} title={chosen ?? (names.length === 0 ? `No ${label.toLowerCase()} found` : `${label} off`)}>
      <button className="toggle" onClick={() => onChange(on ? undefined : names[0])} disabled={names.length === 0} aria-pressed={on} aria-label={`${label} ${on ? 'on' : 'off'}`}>
        {icon}
        <span className="name">
          {label}
          <small>{chosen ?? (names.length === 0 ? 'none found' : 'off')}</small>
        </span>
      </button>
      {on && names.length > 1 && (
        <select className="more" value={chosen} onChange={(event) => onChange(event.target.value)} aria-label={`${label} device`} style={{ width: 20 }}>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
      {meter}
    </div>
  );
}

/** A live preview of the camera at the target's bottom-left corner, where the look puts the bubble. */
function CameraBubble({ name, rect }: { name: string; rect: Rect }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const device = matchMediaDevice(name, (await navigator.mediaDevices.enumerateDevices()).filter((info) => info.kind === 'videoinput'));
        if (device && stream.getVideoTracks()[0]?.getSettings().deviceId !== device.deviceId) {
          stream.getTracks().forEach((track) => track.stop());
          stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: device.deviceId } } });
        }
        if (cancelled) return stream.getTracks().forEach((track) => track.stop());
        if (video.current) video.current.srcObject = stream;
      } catch {
        setProblem('No preview');
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [name]);
  return (
    <div className="bubble" style={{ left: rect.x + 24, top: rect.y + rect.height - 144 }}>
      {problem ? problem : <video ref={video} autoPlay muted playsInline />}
    </div>
  );
}

/** The mic's level, live. */
function MicMeter({ name }: { name: string }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let frame = 0;
    let cancelled = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const device = matchMediaDevice(name, (await navigator.mediaDevices.enumerateDevices()).filter((info) => info.kind === 'audioinput'));
        if (device && stream.getAudioTracks()[0]?.getSettings().deviceId !== device.deviceId) {
          stream.getTracks().forEach((track) => track.stop());
          stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: device.deviceId } } });
        }
        if (cancelled) return;
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(data);
          let peak = 0;
          for (const value of data) peak = Math.max(peak, Math.abs(value));
          setLevel(Math.min(1, peak * 1.6));
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setLevel(0);
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
  }, [name]);
  return (
    <span className="meter" aria-hidden="true">
      <i style={{ width: `${Math.round(level * 100)}%` }} />
    </span>
  );
}
```

`apps/desktop/src/renderer/picker/picker.css`:

```
body.transparent,
body.transparent #root {
  background: transparent;
}
.picker {
  position: fixed;
  inset: 0;
  cursor: crosshair;
  font-size: var(--size-s);
}
.dim {
  position: absolute;
  inset: 0;
  background: rgba(6, 6, 9, 0.55);
  pointer-events: none;
  transition: clip-path 90ms var(--ease-out);
}
.picker.inactive .dim {
  background: rgba(6, 6, 9, 0.35);
}
.target {
  position: absolute;
  border-radius: 6px;
  box-shadow: 0 0 0 2px var(--accent), 0 0 0 6px rgba(217, 119, 87, 0.22);
  pointer-events: none;
  transition:
    left 90ms var(--ease-out),
    top 90ms var(--ease-out),
    width 90ms var(--ease-out),
    height 90ms var(--ease-out);
}
.target.screen {
  border-radius: 0;
  box-shadow: inset 0 0 0 3px var(--accent);
}
.target-label {
  position: absolute;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
  white-space: nowrap;
  max-width: calc(100% - 32px);
  pointer-events: none;
}
.target-label span {
  font-weight: 500;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
}
.target-label b {
  overflow: hidden;
  text-overflow: ellipsis;
}
.handle {
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  background: #fff;
  border-radius: 2px;
  box-shadow: 0 0 0 1.5px var(--accent);
}
.hint {
  position: absolute;
  right: 24px;
  top: 20px;
  color: rgba(255, 255, 255, 0.75);
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.hint kbd,
.stopwhen kbd {
  font: 600 10.5px var(--font);
  background: rgba(255, 255, 255, 0.14);
  padding: 2px 7px;
  border-radius: 4px;
  color: #fff;
}
.bar-rec {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-radius: 16px;
  background: var(--overlay);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(20px);
  cursor: default;
  white-space: nowrap;
}
.modes {
  display: flex;
  background: var(--raised);
  border-radius: 11px;
  padding: 3px;
  gap: 2px;
}
.modes button {
  height: 34px;
  padding: 0 11px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
}
.modes button[aria-pressed='true'] {
  background: var(--raised-active);
  color: var(--text);
}
.modes button:hover {
  color: var(--text);
}
.opt {
  height: 40px;
  border-radius: 11px;
  padding: 0 10px 0 12px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--muted);
  max-width: 230px;
}
.opt.on {
  background: var(--raised);
  color: var(--text);
}
.opt button.toggle {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  color: inherit;
  height: 100%;
}
.opt .name {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  line-height: 1.15;
}
.opt small {
  color: var(--faint);
  font-size: 10.5px;
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.opt select {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--faint);
  font-size: 10.5px;
  max-width: 140px;
  padding: 0;
  text-overflow: ellipsis;
}
.opt .more {
  color: var(--faint);
  width: 20px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 6px;
}
.opt .more:hover {
  color: var(--text);
  background: var(--raised-hover);
}
/* the device menu is only its chevron: the chosen name shows beside the toggle */
.opt select.more {
  appearance: none;
  border: 0;
  padding: 0;
  font-size: 0;
  background: transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='%239a9aa5' stroke-width='1.8'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E") center / 12px no-repeat;
}
.opt select.more:hover {
  background-color: var(--raised-hover);
}
.opt select.more option {
  font-size: var(--size-m);
  color: var(--text);
  background: var(--panel);
}
.meter {
  width: 34px;
  height: 4px;
  border-radius: 2px;
  background: #2a2a33;
  overflow: hidden;
}
.meter i {
  display: block;
  height: 100%;
  background: var(--caption);
  transition: width 60ms linear;
}
.divider {
  width: 1px;
  height: 26px;
  background: var(--line-strong);
  margin: 0 2px;
}
.rec {
  height: 40px;
  padding: 0 16px 0 12px;
  border-radius: 11px;
  background: var(--recording);
  color: #fff;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 9px;
}
.rec:hover:not(:disabled) {
  background: #ff6365;
}
.rec i {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  display: block;
}
.rec kbd {
  font: 600 10px var(--font);
  opacity: 0.8;
  background: none;
  color: #fff;
  padding: 0;
}
.stopwhen {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.75);
  display: flex;
  gap: 14px;
  white-space: nowrap;
  pointer-events: none;
}
.stopwhen b {
  color: #fff;
  font-weight: 600;
}
.bubble {
  position: absolute;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  overflow: hidden;
  background: #1b1b21;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 3px rgba(255, 255, 255, 0.85);
  pointer-events: none;
  display: grid;
  place-items: center;
  color: var(--faint);
  font-size: 11px;
  text-align: center;
}
.bubble video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1);
}
.problem {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--overlay);
  color: var(--card);
  box-shadow: var(--shadow-float);
  max-width: 640px;
  white-space: normal;
}

/* countdown: a ring over the target, which stays visible */
.countdown {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  box-shadow: inset 0 0 0 2px var(--accent);
  border-radius: 6px;
}
.countdown b {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: rgba(19, 19, 23, 0.45);
  border: 3px solid rgba(255, 255, 255, 0.85);
  display: grid;
  place-items: center;
  font-size: 56px;
  font-weight: 600;
  color: #fff;
  animation: pop 1s var(--ease-out);
}
.countdown small {
  position: absolute;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.85);
  background: rgba(19, 19, 23, 0.55);
  padding: 4px 10px;
  border-radius: 8px;
  white-space: nowrap;
}

/* HUD: never in the video, never takes the focus */
.hud-wrap {
  height: 100%;
  display: grid;
  place-items: center;
}
.hud {
  height: 48px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 6px 6px 14px;
  border-radius: 16px;
  background: var(--overlay);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.07);
  -webkit-app-region: drag;
  color: var(--muted);
}
.hud button {
  -webkit-app-region: no-drag;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: var(--muted);
}
.hud button:hover {
  background: var(--raised);
  color: var(--text);
}
.hud .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--recording);
  box-shadow: 0 0 0 4px rgba(255, 77, 79, 0.22);
  animation: pulse 1.6s ease-in-out infinite;
}
.hud.stopping .dot {
  background: var(--muted);
  box-shadow: none;
  animation: none;
}
.hud .time {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  margin: 0 8px 0 6px;
  min-width: 52px;
  color: var(--text);
}
.hud .sep {
  width: 1px;
  height: 22px;
  background: var(--line-strong);
  margin: 0 2px;
}
.hud button.stop {
  background: var(--raised);
}
.hud button.stop i {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--recording);
  display: block;
}
.hud .note {
  font-size: var(--size-s);
  margin: 0 8px;
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hud .flash {
  color: var(--ok);
}

@keyframes pop {
  from {
    transform: scale(0.85);
    opacity: 0.3;
  }
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 0 7px rgba(255, 77, 79, 0.1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .countdown b,
  .hud .dot {
    animation: none;
  }
}
```

- [ ] **Step 3: The countdown and the HUD**

`apps/desktop/src/renderer/picker/Countdown.tsx`:

```
// The countdown over what will be recorded: the target stays visible behind a ring; Esc cancels.
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';

export function Countdown() {
  const [seconds, setSeconds] = useState<number>();
  useEffect(() => bridge.on('countdown:tick', ({ seconds: left }) => setSeconds(left)), []);
  return (
    <div className="countdown" aria-live="assertive">
      {seconds !== undefined && <b key={seconds}>{seconds}</b>}
      <small>Esc to cancel</small>
    </div>
  );
}
```

`apps/desktop/src/renderer/picker/Hud.tsx`:

```
// The recording HUD: the time, a marker and Stop. It is never in the video (content protection),
// never takes the focus (the recorded window keeps it), and its area is a dead zone for the input log.
import { useEffect, useState } from 'react';
import type { HudState } from '../../shared/ipc';
import { bridge } from '../bridge';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function Hud() {
  const [state, setState] = useState<HudState>({ phase: 'countdown', markers: 0 });
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const off = bridge.on('hud:state', (next) => {
      setState((previous) => {
        if (next.markers > previous.markers) {
          setFlash(true);
          setTimeout(() => setFlash(false), 900);
        }
        return next;
      });
    });
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);
  const seconds = state.startedAt ? Math.max(0, (now - state.startedAt) / 1000) : 0;
  return (
    <div className="hud-wrap">
      <div className={`hud${state.phase === 'recording' ? '' : ' stopping'}`} role="toolbar" aria-label="Recording">
        <span className="dot" />
        <span className="time" data-testid="hud-time">
          {clock(seconds)}
        </span>
        {state.message ? <span className="note" title={state.message}>{state.message}</span> : flash && <span className="note flash">Marker set</span>}
        <span className="sep" />
        <button onClick={() => void bridge.invoke('hud:marker')} title="Marker (Ctrl Shift Alt M)" aria-label="Set a marker" disabled={state.phase !== 'recording'}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M4 14V2.5h8l-2 3 2 3H4" />
          </svg>
        </button>
        <button className="stop" onClick={() => void bridge.invoke('hud:stop')} title="Stop (Ctrl Shift Alt S)" aria-label="Stop the recording" data-testid="hud-stop" disabled={state.phase === 'stopping'}>
          <i />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: The pill's button, the editor's take controls and status**

In `apps/desktop/src/renderer/pill/Pill.tsx`, replace:

```
    <div className="pill-wrap">
      <div className="pill" role="toolbar" aria-label="Cuttle">
        <Mark size={36} />
        <button className="main" disabled title="Recording from the app is coming soon. Record with the cuttle record command for now.">
          <i />
          New recording
        </button>
        <button onClick={() => void bridge.invoke('pill:open')} title="Open a project folder">
          <FolderIcon size={15} />
```

with:

```
    <div className="pill-wrap">
      <div className="pill" role="toolbar" aria-label="Cuttle">
        <Mark size={36} />
        <button className="main" onClick={() => void bridge.invoke('pill:record')} title="Pick a screen, a window or a region (Ctrl+Shift+Alt+R)" data-testid="new-recording">
          <i />
          New recording <kbd>Ctrl Shift Alt R</kbd>
        </button>
        <button onClick={() => void bridge.invoke('pill:open')} title="Open a project folder">
          <FolderIcon size={15} />
```

In `apps/desktop/src/renderer/editor/session.ts`, replace:

```ts
  exportUnseen: boolean;
  /** Timeline scale; 0 until the timeline fits itself. */
  pxPerSecond: number;
}

export const store = createStore<EditorState>({
```

with:

```ts
  exportUnseen: boolean;
  /** Timeline scale; 0 until the timeline fits itself. */
  pxPerSecond: number;
  /** What the main process is doing to the project ("Cutting the take…"). */
  status?: string;
}

export const store = createStore<EditorState>({
```

In the same file, replace:

```ts

/** Opens the window's project: its media through the protocol, the engine's assets, the player. */
export async function openSession(canvas: HTMLCanvasElement): Promise<void> {
  try {
    const info = await bridge.invoke('project:info');
    document.title = `${info.name} · Cuttle`;
```

with:

```ts

/** Opens the window's project: its media through the protocol, the engine's assets, the player. */
export async function openSession(canvas: HTMLCanvasElement): Promise<void> {
  // The status comes before the project is open (the window opens while the take is cut).
  bridge.on('project:status', ({ text }) => store.set({ status: text }));
  try {
    const info = await bridge.invoke('project:info');
    document.title = `${info.name} · Cuttle`;
```

In `apps/desktop/src/renderer/editor/App.tsx`, replace:

```
import { formatDuration, formatSource, formatTime, plainIssue } from '../../shared/format';
import type { MediaState } from '../../shared/ipc';
import { bridge } from '../bridge';
import { CloseIcon, ExportIcon, FolderIcon, Mark, PauseIcon, PlayIcon, WarningIcon } from '../icons';
import { ExportSheet } from './ExportSheet';
import { Inspector } from './Inspector';
import { currentPlayer, openExport, openSession, retryMedia, select, setFormat, shownProject, store } from './session';
```

with:

```
import { formatDuration, formatSource, formatTime, plainIssue } from '../../shared/format';
import type { MediaState } from '../../shared/ipc';
import { bridge } from '../bridge';
import { ChevronIcon, CloseIcon, ExportIcon, FolderIcon, Mark, PauseIcon, PlayIcon, RecordIcon, WarningIcon } from '../icons';
import { ExportSheet } from './ExportSheet';
import { Inspector } from './Inspector';
import { currentPlayer, openExport, openSession, retryMedia, select, setFormat, shownProject, store } from './session';
```

In the same file, replace:

```
  const phase = useStore(store, (state) => state.phase);
  const info = useStore(store, (state) => state.info);
  const media = useStore(store, (state) => state.media);
  const duration = currentPlayer()?.duration ?? 0;
  const recorded = media ? media.screen.end - media.screen.start : 0;
  return (
```

with:

```
  const phase = useStore(store, (state) => state.phase);
  const info = useStore(store, (state) => state.info);
  const media = useStore(store, (state) => state.media);
  const status = useStore(store, (state) => state.status);
  const duration = currentPlayer()?.duration ?? 0;
  const recorded = media ? media.screen.end - media.screen.start : 0;
  return (
```

In the same file, replace:

```
        )}
      </div>
      <div className="grow" />
      {phase === 'ready' && (
        <>
          <MediaChip />
          <ExportChip />
          <FormatSwitch />
          <button className="primary" onClick={openExport} title="Export (Ctrl+E)">
            <ExportIcon size={14} />
            Export
```

with:

```
        )}
      </div>
      <div className="grow" />
      {status && (
        <div className="chip-status" role="status" data-testid="project-status">
          <span className="spinner small" aria-hidden="true" />
          {status}
        </div>
      )}
      {phase === 'ready' && (
        <>
          <MediaChip />
          <ExportChip />
          <FormatSwitch />
          <div className="seg" role="group" aria-label="Takes">
            <button onClick={() => void bridge.invoke('project:record')} title="Record a new take for this project; this one stays restorable" data-testid="record-again">
              <RecordIcon size={10} style={{ color: 'var(--recording)', display: 'inline-block', marginRight: 6, verticalAlign: -1 }} />
              Record again
            </button>
            <button onClick={() => void bridge.invoke('project:takes')} title="Earlier takes of this project" aria-label="Takes">
              <ChevronIcon size={13} />
            </button>
          </div>
          <button className="primary" onClick={openExport} title="Export (Ctrl+E)">
            <ExportIcon size={14} />
            Export
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```
  margin: 0 auto;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
```

with:

```
  margin: 0 auto;
}

.spinner.small {
  width: 12px;
  height: 12px;
  border-width: 2px;
  margin: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
```

- [ ] **Step 5: The build**

In `apps/desktop/vite.renderer.config.ts`, replace:

```ts
      input: {
        editor: fileURLToPath(new URL('./src/renderer/editor.html', import.meta.url)),
        pill: fileURLToPath(new URL('./src/renderer/pill.html', import.meta.url)),
      },
    },
  },
```

with:

```ts
      input: {
        editor: fileURLToPath(new URL('./src/renderer/editor.html', import.meta.url)),
        pill: fileURLToPath(new URL('./src/renderer/pill.html', import.meta.url)),
        picker: fileURLToPath(new URL('./src/renderer/picker.html', import.meta.url)),
        hud: fileURLToPath(new URL('./src/renderer/hud.html', import.meta.url)),
        countdown: fileURLToPath(new URL('./src/renderer/countdown.html', import.meta.url)),
      },
    },
  },
```

In `apps/desktop/scripts/build.mjs`, replace:

```js

rmSync(at('dist'), { recursive: true, force: true });
await build({ configFile: at('vite.main.config.ts') });
for (const kind of ['editor', 'pill']) {
  await build({
    configFile: false,
    root: desktop,
```

with:

```js

rmSync(at('dist'), { recursive: true, force: true });
await build({ configFile: at('vite.main.config.ts') });
for (const kind of ['editor', 'pill', 'picker', 'hud', 'countdown']) {
  await build({
    configFile: false,
    root: desktop,
```

Run: `pnpm app:build:js`
Expected: exits with code 0 and ends with `built apps/desktop/dist`. `apps/desktop/dist` also holds `main/recorder-host.mjs`, `preload/picker.cjs`, `preload/hud.cjs`, `preload/countdown.cjs` and `renderer/picker.html`, `renderer/hud.html`, `renderer/countdown.html`.

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer apps/desktop/scripts/build.mjs apps/desktop/vite.renderer.config.ts
git commit -m "desktop: the picker (windows, displays, regions, devices, stop on), the countdown and the HUD; Record again and the takes menu in the editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The end-to-end checks

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`, `apps/desktop/test/build.check.test.ts`

- [ ] **Step 1: Recording in the checks**

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
 * output view with the export's frames (`cuttle preview`), play the proxy, export, open a project
 * twice at once, close an editor during its export, close the pill. Runs only with `pnpm app:check`
 * (vitest --mode app, after app:build:js and cli:build). CUTTLE_CHECK_SHOTS=<folder> keeps screenshots.
 */
const enabled = process.env.MODE === 'app';
const MAIN = fileURLToPath(new URL('../dist/main/index.mjs', import.meta.url));
```

with:

```ts
/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
 * output view with the export's frames (`cuttle preview`), play the proxy, export, open a project
 * twice at once, close an editor during its export, close the pill; record through the picker with
 * the recorder's `test` backend, stop from the HUD, and land in the take cut by suggest; record
 * again. Runs only with `pnpm app:check` (vitest --mode app, after app:build:js and cli:build).
 * CUTTLE_CHECK_SHOTS=<folder> keeps screenshots.
 */
const enabled = process.env.MODE === 'app';
const MAIN = fileURLToPath(new URL('../dist/main/index.mjs', import.meta.url));
```

In the same file, replace:

```ts

const electronPath = (): string => createRequire(import.meta.url)('electron') as unknown as string;

function decode(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
}
```

with:

```ts

const electronPath = (): string => createRequire(import.meta.url)('electron') as unknown as string;

/** The first window (page) for which `test` holds, waiting for it. */
async function waitForPage(app: ElectronApplication, test: (page: Page) => Promise<boolean>, timeout = 30_000): Promise<Page> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      if (await test(page).catch(() => false)) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('no such window appeared');
}

/** Clicks an element in a page without a real mouse (the window is never shown). */
const click = (page: Page, selector: string) => page.evaluate((target) => (document.querySelector(target) as HTMLElement).click(), selector);

/** cuttle.json of a project, once `ready` holds for it. */
async function projectWhen(dir: string, ready: (project: { sources: { screen: string }; scenes: { id?: string }[] }) => boolean, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const project = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
      if (ready(project)) return project;
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${dir}/cuttle.json never got ready`);
}

function decode(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
}
```

In the same file, replace:

```ts
    mkdirSync(project);
    makeFixture(project);
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    app = await _electron.launch({
      executablePath: electronPath(),
      args: [MAIN, '--cuttle-check', '--open', project],
      env: { ...process.env, CUTTLE_HIDDEN: '1', CUTTLE_CHECK: '1', CUTTLE_NO_PROXY: '1', CUTTLE_USER_DATA: join(root, 'user-data') },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
    await app.evaluate(() => {
```

with:

```ts
    mkdirSync(project);
    makeFixture(project);
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    // New recordings go into a folder of the check's own.
    mkdirSync(join(root, 'user-data'));
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects') }));
    app = await _electron.launch({
      executablePath: electronPath(),
      args: [MAIN, '--cuttle-check', '--open', project],
      env: {
        ...process.env,
        CUTTLE_HIDDEN: '1',
        CUTTLE_CHECK: '1',
        CUTTLE_NO_PROXY: '1',
        CUTTLE_USER_DATA: join(root, 'user-data'),
        CUTTLE_RECORDER_BACKEND: 'test',
        CUTTLE_COUNTDOWN: '0',
      },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
    await app.evaluate(() => {
```

In the same file, replace:

```ts
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().includes('/pill.html')).length)).toBe(1);
  });

  it('had no unhandled rejection in the main process', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
  });
```

with:

```ts
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().includes('/pill.html')).length)).toBe(1);
  });

  /** Records one take through the picker on the display that has the bar, stopping from the HUD after about 2 s. */
  async function recordThroughPicker(start: () => Promise<unknown>): Promise<void> {
    await start();
    const picker = await waitForPage(app, async (page) => page.url().includes('/picker.html') && (await page.locator('[data-testid=picker-record]').count()) > 0);
    await click(picker, '[data-testid=picker-record]');
    const hud = await waitForPage(app, async (page) => page.url().includes('/hud.html') && (await page.locator('[data-testid=hud-time]').textContent()) !== '0:00');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await click(hud, '[data-testid=hud-stop]');
  }

  it('records through the picker, stops from the HUD, and opens the take cut by suggest', async () => {
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    await recordThroughPicker(() => pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record')));
    const [made] = await new Promise<string[]>((resolve) => {
      const poll = setInterval(() => {
        const found = existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : [];
        if (found.length > 0) {
          clearInterval(poll);
          resolve(found);
        }
      }, 100);
    });
    const dir = join(root, 'projects', made!);
    // The editor opens on the take while suggest cuts it; the cut arrives with ids and labels.
    const cut = await projectWhen(dir, (written) => written.scenes[0]?.id === 's1');
    expect(cut.sources.screen).toBe('takes/1/screen.mp4');
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${made} · Cuttle`);
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    expect(await opened.locator('[data-testid=project-status]').count()).toBe(0);
    expect(await opened.locator('.scene').count()).toBe(cut.scenes.length);
  }, 120_000);

  it('records again into the same project, keeping the first take restorable', async () => {
    const dir = join(root, 'projects', readdirSync(join(root, 'projects'))[0]!);
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) !== 'demo · Cuttle');
    await recordThroughPicker(() => click(opened, '[data-testid=record-again]'));
    const second = await projectWhen(dir, (written) => written.sources.screen === 'takes/2/screen.mp4' && written.scenes[0]?.id !== undefined);
    expect(second.scenes.length).toBeGreaterThan(0);
    // The first take's edit is kept next to it, for "Back to take 1".
    expect(JSON.parse(readFileSync(join(dir, 'takes', '1', 'cuttle.json'), 'utf8')).sources.screen).toBe('takes/1/screen.mp4');
  }, 120_000);

  it('keeps a take whose capture broke off: recover repairs it and the editor opens on it', async () => {
    const projects = join(root, 'projects');
    const before = new Set(readdirSync(projects));
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    await pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record'));
    const picker = await waitForPage(app, async (page) => page.url().includes('/picker.html') && (await page.locator('[data-testid=picker-record]').count()) > 0);
    // The test backend's failing camera ends after 1 s, as an unplugged one does: the capture fails.
    await picker.evaluate(() =>
      (window as unknown as { cuttle: { invoke(channel: string, argument: unknown): Promise<unknown> } }).cuttle.invoke('picker:choices', { stop: 'none', camera: 'Failing Test Camera' }),
    );
    await click(picker, '[data-testid=picker-record]');
    let made: string | undefined;
    await expect.poll(() => (made = readdirSync(projects).find((name) => !before.has(name))), { timeout: 30_000 }).toBeDefined();
    const recovered = await projectWhen(join(projects, made!), (written) => written.sources.screen === 'takes/1/screen.mp4' && written.scenes[0]?.id !== undefined);
    expect(recovered.scenes.length).toBeGreaterThan(0);
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${made} · Cuttle`);
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 120_000);

  it('had no unhandled rejection in the main process', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
  });
```

In `apps/desktop/test/build.check.test.ts`, replace:

```ts

/**
 * The unpacked app (pnpm app:build) starts from its folder, opens a project, draws its first frame,
 * and runs the media worker from inside the asar archive. Runs only with vitest --mode build.
 */
const enabled = process.env.MODE === 'build';
const EXE = fileURLToPath(new URL(`../build/Cuttle-${process.platform}-${process.arch}/Cuttle${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
```

with:

```ts

/**
 * The unpacked app (pnpm app:build) starts from its folder, opens a project, draws its first frame,
 * runs the media worker from inside the asar archive, and starts the recorder host, whose native
 * modules (koffi, uiohook-napi) load from outside it. Runs only with vitest --mode build.
 */
const enabled = process.env.MODE === 'build';
const EXE = fileURLToPath(new URL(`../build/Cuttle-${process.platform}-${process.arch}/Cuttle${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
```

In the same file, replace:

```ts
      { timeout: 60_000 },
    );
  }, 90_000);
});
```

with:

```ts
      { timeout: 60_000 },
    );
  }, 90_000);

  it("lists this machine's displays and windows in the recorder host (koffi loads)", async () => {
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    await pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record'));
    let picker: Page | undefined;
    await expect.poll(() => (picker = app.windows().find((page) => page.url().includes('/picker.html'))), { timeout: 30_000 }).toBeDefined();
    await picker!.waitForSelector('[data-testid=picker]', { timeout: 30_000 });
    const setup = await picker!.evaluate(() =>
      (window as unknown as { cuttle: { invoke(channel: string): Promise<{ display: { monitor?: number }; problem?: string } | undefined> } }).cuttle.invoke('picker:setup'),
    );
    // Only the names and bounds are read; nothing is captured.
    expect(setup?.problem).toBeUndefined();
    expect(setup?.display.monitor).toBeTypeOf('number');
    await picker!.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('picker:cancel')).catch(() => {});
  }, 60_000);
});
```

- [ ] **Step 2: Run them**

Run: `pnpm app:check`
Expected: PASS, 13 tests (about two minutes). No window shows on the screen, and nothing on this machine is captured: the recordings use the `test` backend.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 3 tests.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test
git commit -m "desktop: app:check records through the picker, records again, and recovers a failed capture; the unpacked build starts the recorder host

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs and final verification

- [ ] **Step 1: The README**

In `README.md`, replace:

````markdown
```bash
pnpm app                                 # build and start the app (the pill near the top of the screen, an icon in the tray)
pnpm app -- --open <project folder>      # … and open a project in the editor
pnpm app:check                           # end to end with its windows hidden: open, play, scrub, select, compare with the export, play the proxy, export
pnpm app:build                           # an unpacked app in apps/desktop/build/Cuttle-<platform>-<arch>/, checked that it starts
```
````

with:

````markdown
```bash
pnpm app                                 # build and start the app (the pill near the top of the screen, an icon in the tray)
pnpm app -- --open <project folder>      # … and open a project in the editor
pnpm app:check                           # end to end with its windows hidden: open, play, scrub, select, compare with the export, play the proxy, export, record
pnpm app:build                           # an unpacked app in apps/desktop/build/Cuttle-<platform>-<arch>/, checked that it starts
```
````

In the same file, replace:

```markdown
pixel by `app:check`. It plays a 720p proxy of the take (made in the background into the project's
`.cuttle/` folder, with the thumbnails and the mic's waveform); the export always uses the take.
Editing arrives in a later milestone; in this version the timeline and inspector show the project.
Recording from the app comes next; until then, record with `cuttle record`.

## The CLI
```

with:

```markdown
pixel by `app:check`. It plays a 720p proxy of the take (made in the background into the project's
`.cuttle/` folder, with the thumbnails and the mic's waveform); the export always uses the take.
Editing arrives in a later milestone; in this version the timeline and inspector show the project.

**Recording.** "New recording" on the pill, in the tray, or Ctrl+Shift+Alt+R shows a picker over every
display: the window under the pointer lights up (the display where there is none), a drag draws a
region, and the bar sets the camera, the mic and when to stop (your stop, Claude's answer, an idle
screen). After the countdown only a small HUD remains, which never appears in the video;
Ctrl+Shift+Alt+S stops and Ctrl+Shift+Alt+M sets a marker. The editor opens on the take at once
while `suggest` cuts it in the background. "Record again" adds a take to the project; the earlier
one stays restorable ("Back to take 1"). New projects go into `~/Cuttle/<date time>`.

## The CLI
```

- [ ] **Step 2: All tests and the typecheck**

Run: `pnpm test`
Expected: PASS, 447 tests in 49 files, 21 skipped (the real-capture test and the Electron checks: cli, app, build).

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 3: Commit, and nothing left behind**

```bash
git add README.md
git commit -m "docs: recording from the app in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Run: `git status --short`
Expected: no output.

- [ ] **Step 4: By hand (the user)**

These need a person and a real screen; the checks above never show a window or capture this machine.

1. `pnpm app`, then Ctrl+Shift+Alt+R: the picker covers every display. Hover a terminal window (it lights up with its size), drag a region, press Tab over stacked windows, press Esc.
2. Record a window for about 20 seconds with the mic on: the countdown sits over the window, the HUD at the top of the display; the recorded window has the focus after the countdown. Stop from the HUD.
3. The editor opens on the take with "Cutting the take…", then shows the cut. The take shows neither the picker, the countdown, the HUD nor the pointer going to Stop.
4. "Record again", record a region, then "Back to take 1" in the takes menu.
5. On a second display with another scale, if there is one: pick a window there and check the take's size.

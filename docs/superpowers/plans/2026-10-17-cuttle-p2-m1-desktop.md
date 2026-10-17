# Cuttle P2-M1: Desktop Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first version of the Cuttle app that ships: a pill and a tray icon, an editor per project whose output view is the export's engine on the export's timeline (played from a proxy with the mic as the clock, scrubbed frame by frame), a read-only timeline with thumbnails, waveform, Claude's markers and input activity, a read-only inspector, the export sheet, an end-to-end check with hidden windows, and an unpacked build that starts.

**Architecture:** `apps/desktop` is an Electron app built with Vite: the main process (windows, tray, protocols, IPC, the project, exports) and a media worker (a utility process running ffmpeg) as ES modules, one sandboxed CommonJS preload per window kind, and React 19 pages. Each editor window has its own session in which `app://cuttle/` serves the app and `cuttle-media://project/` serves only files inside its project (Range requests, paths checked after junctions are resolved). The renderer opens the take with Mediabunny through that protocol and draws `@cuttle/timeline`'s frames with `@cuttle/engine`, exactly as the export page does. Pure modules (paths, ranges, the timeline's model, ffmpeg arguments, the IPC contract) carry the unit tests; Playwright's Electron driver checks the whole app with its windows never shown.

**Tech Stack:** Electron 44.7.2, React 19.3.0, @vitejs/plugin-react 6.1.1, Vite 8, Mediabunny 1.61.0, zod 4, Playwright 1.64.1 (`_electron`), @electron/packager 20.3.0, ffmpeg 9, vitest 5.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-desktop-design.md` (milestone P2-M1; sections "Windows", "Output view and player", "Timeline", "Inspector", "The export sheet", "Architecture", "Design system"). Spike notes: `docs/superpowers/spikes/2026-10-17-p2-desktop-spike.md`. P2-M0 (done): `docs/superpowers/plans/2026-10-17-cuttle-p2-m0-shared.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p2-m1`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg and ffprobe must be on PATH. The checks never show a window: `app:check` and `app:build` drive the app with `CUTTLE_HIDDEN=1`.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 6.

## Decisions made while planning

A spike (the phase-2 spike notes) and a full prototype settled these points. On the prototype, `pnpm test` passes 427 tests (14 skipped), `pnpm typecheck` exits with 0, `pnpm app:check` passes its 7 tests, and `pnpm app:build` packages the app and passes its 2.

- **Processes and IPC.**
  - The main process stays light: windows, tray, protocols, IPC, the project file, exports (`exportProject` opens its own hidden window).
  - ffmpeg work (the proxy, thumbnails, the mic's peaks) runs in one utility process for the whole app (`dist/main/media-worker.mjs`). It imports no Electron API and talks over `parentPort`.
  - `src/shared/ipc.ts` lists every request with the zod schema of its argument. `src/shared/channels.ts` (no zod, so the preloads stay small) says which window kind may use which channels.
  - Handlers are registered on each window's own `webContents.ipc`, so a pill cannot reach an editor's channels. Every argument is parsed first.
- **Windows.**
  - Every window: sandboxed, `contextIsolation`, no `nodeIntegration`, `backgroundThrottling: false`. No new windows, navigation or webviews. A session that grants no permission and allows no download.
  - The editor: frameless with Windows' caption buttons (`titleBarOverlay`), minimum 1100×700. One per project: a second open brings it to the front, and `.cuttle/editor.lock` (the process id) keeps another Cuttle out. A lock from a process that is gone is taken over.
  - The pill: 420×64 DIP, transparent, always on top, content-protected (never in a recording), skips the taskbar, remembers its position per display. Esc hides it; the tray brings it back.
  - "New recording" is disabled until P2-M2. "Open" picks a folder. The chevron pops a native menu of the recent projects.
  - The tray menu is rebuilt whenever the settings change (recent projects in `<userData>/settings.json`).
- **Protocols.**
  - `app://cuttle/` serves `dist/renderer` (also from inside the asar archive), HTML with a strict CSP:
    - `script-src 'self'` and `style-src 'self'` (React's style properties need no `'unsafe-inline'`);
    - media and images also from `cuttle-media:`;
    - no network.
  - `cuttle-media://project/<path>` is registered on each editor's own session, for its project only, with `corsEnabled` (the page's origin is `app://cuttle`, so answers carry `Access-Control-Allow-Origin` and expose `Content-Range`).
  - Paths are decoded per segment, and `.`, `..`, empty segments, `\`, `:` and NUL are refused. The result is resolved with `realpath` (junctions) and compared with the project folder by the platform's rules (no case on Windows and macOS), separator included. One byte range per request; a range past the end is 416.
- **The player** (`renderer/editor/player.ts`).
  - The engine draws into a canvas at the output size, scaled to the stage with CSS.
  - Scrubbing decodes single frames with `VideoSampleSink.getSample`; while one decodes, newer requests replace each other ("latest wins").
  - Playback plans the frames from the playhead on with the export's own `planStills` and decodes them with its `TrackReader`s, which open 20 frames ahead of each scene and close after it.
  - The clock is an `AudioContext`. The mic is decoded with Mediabunny's `AudioBufferSink` and scheduled 2.5 s ahead, each clip's stretch at the clip's speed. The preview's pitch moves with the speed; the export's `atempo` keeps it.
  - Clips joined by continuous cuts at one speed play without a fade between them; elsewhere 8 ms edge fades prevent clicks.
  - When decoding falls 0.5 s behind the clock, playback starts again at the clock: frames are dropped, never delayed.
  - The loop waits for the next animation frame or 20 ms, whichever comes first: a never-shown window counts as visible but gets about one animation frame a second (the first prototype drew 3 frames in 2 s there, while its check, which looked only at the time, passed).
- **The proxy and the timeline's media** (`.cuttle/` in the project, `media.json` keyed by the source's size and modification time).
  - **The proxy:** ffmpeg makes a 720p H.264 copy with the take's timestamps (`-copyts`, `-fps_mode passthrough`) and a key frame every 0.5 s. The player switches to it once it is made.
  - **Above 6×** it shows key frames only, found with `EncodedPacketSink.getKeyPacket`. The engine places a frame by the take's size, so the smaller frame shows the same picture.
  - **Thumbnails:** one 160×90 frame per second, taken from the proxy (fewer for long takes: at most 600) and tiled 20 wide into one JPEG.
  - **The mic's peaks:** one byte per 10 ms, read from 8 kHz mono.
- **The timeline (read-only)** follows the mockup: markers, the ruler, Video, Zoom, Mask, Caption, Mic and Input.
  - **Scenes** sit at their output lengths, with thumbnails of the source each part shows and labels such as `4× Claude at work · 5 s → 1.3 s`.
  - **Overlays** get one block per occurrence (`@cuttle/timeline`'s `occurrences`). A lane counts the items no clip shows ("1 cut out").
  - **Markers** are pinned at every output second that shows them; tool calls closer than 70 px merge (`Bash ×2`).
  - **Waveform and activity** are drawn on canvases over the visible part only.
  - **Navigation:** the playhead is dragged on the ruler and the lanes. Fit is Shift+Z, and a slider scales up to 400 px/s.
- **The inspector (read-only)** shows the selection's settings with times in output and source seconds, and a Look tab. The title bar's format chips preview 16:9, 1:1 or 9:16 without saving.
- **The export sheet:**
  - choose one or more formats and the encoder;
  - progress per format, with the time left;
  - cancel;
  - the files at the end with their length and size, and "Show".
  - It exports cuttle.json as saved into `out/`, as the CLI does.
- **The end-to-end check** (`pnpm app:check`, vitest `--mode app`).
  - **Setup:** Playwright's `_electron` launches the built app on a generated fixture project with:
    - `CUTTLE_HIDDEN=1` (windows never shown);
    - `CUTTLE_CHECK=1` (a `window.__cuttleCheck` hook to seek and read the canvas);
    - `CUTTLE_NO_PROXY=1` (frames from the take, to compare with the export);
    - `CUTTLE_USER_DATA` (a temp settings folder).
  - **What it checks:**
    - the timeline;
    - frames at 1, 4, 6.8 and 9.9 s against `cuttle preview` of the same project (mean channel difference under 0.5, largest at most 24);
    - playback against the clock: after 2 s the clock is at 1.5–2.4 s, the picture at most 0.7 s behind it, and more than 25 frames were drawn; then pausing;
    - scrubbing on the ruler;
    - the proxy, thumbnails and peaks;
    - a 16:9 export checked with ffprobe;
    - the pill's channels, and that the editor cannot use them.
  - **Mechanics:** a never-shown window gets no real mouse, so the scrub dispatches pointer events. Screenshots (`CUTTLE_CHECK_SHOTS=<folder>`) use `webContents.invalidate()` and `capturePage()`.
- **The unpacked build** (`pnpm app:build`):
  - @electron/packager, Electron from the local cache, `Cuttle.exe` with the app's icon;
  - the bundle in an asar archive, with every `.node` file unpacked;
  - koffi (with `@koromix/koffi-win32-x64`) and uiohook-napi (with node-gyp-build) copied flat, ready for the recorder in P2-M2, only this platform's prebuilds (373 MB in all, Electron included);
  - `build.check.test.ts` launches the built `Cuttle.exe` hidden, opens a project, reads a frame and waits for the proxy, which shows the worker runs from inside the archive.
- **Icons** (`tools/desktop-icons.mjs`, no image library): Cuttle's mark as `icon.png` (256), `icon.ico` (16–256) and the tray's 16 and 32 px PNGs, drawn with 4×4 supersampling.

## File structure

```
cuttle/
├── package.json                    app, app:build:js, app:check, app:build; typecheck covers apps/desktop
├── .gitignore                      apps/desktop/build/
├── README.md                       the desktop app
├── packages/export/package.json    exports frame-plan, track-reader and formats for the player
├── tools/desktop-icons.mjs         the app's icons
└── apps/desktop/
    ├── package.json, tsconfig.json, vite.main.config.ts, vite.renderer.config.ts
    ├── assets/                     icon.png, icon.ico, tray.png, tray@2x.png (generated)
    ├── scripts/build.mjs           main + worker, preloads, pages, export page into dist/
    ├── scripts/package.mjs         the unpacked app into build/
    ├── src/shared/                 ipc, channels, media-path, range, format, timeline-model, media-jobs
    ├── src/main/                   index, windows, tray, protocols, ipc, project, settings, media-service, export-service
    ├── src/workers/media.ts        the media worker
    ├── src/preload/                bridge, editor, pill
    ├── src/renderer/               tokens.css, base.css, icons, bridge, editor.html, pill.html
    │   ├── editor/                 App, Timeline, Inspector, ExportSheet, player, frames, audio, media, session, store, editor.css
    │   └── pill/                   Pill, pill.css
    └── test/                       protocol, timeline-model, contract (unit); fixture, app.check, build.check
```

---

### Task 1: The package and its pure modules

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/src/shared/{format,range,media-path,timeline-model,media-jobs,ipc,channels}.ts`, `apps/desktop/test/{protocol,timeline-model,contract}.test.ts`
- Modify: `packages/export/package.json`

- [ ] **Step 1: The package**

The plan was committed on the branch `p2-m1`; work there:

```bash
git switch p2-m1
```

`apps/desktop/package.json`:

```json
{
  "name": "@cuttle/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Cuttle: screen recordings that edit themselves",
  "dependencies": {
    "@cuttle/core": "workspace:*",
    "@cuttle/engine": "workspace:*",
    "@cuttle/export": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/timeline": "workspace:*",
    "@fontsource/inter": "5.3.0",
    "koffi": "3.3.2",
    "mediabunny": "1.61.0",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "uiohook-napi": "1.5.5",
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "@electron/packager": "20.3.0",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1"
  }
}
```

`apps/desktop/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node"]
  },
  "include": ["src", "test", "vite.*.config.ts"]
}
```

In `packages/export/package.json`, replace:

```json
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@cuttle/engine": "workspace:*",
```

with:

```json
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./frame-plan": "./src/frame-plan.ts",
    "./track-reader": "./src/page/track-reader.ts",
    "./formats": "./src/formats.ts"
  },
  "dependencies": {
    "@cuttle/engine": "workspace:*",
```

Run: `pnpm install`
Expected: exits with code 0; `pnpm-lock.yaml` gains the importer `apps/desktop` (react 19.3.0, @vitejs/plugin-react 6.1.1, @electron/packager 20.3.0, …).

- [ ] **Step 2: Write the failing tests**

`apps/desktop/test/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isInside, mediaFile, mediaType } from '../src/shared/media-path';
import { parseRange } from '../src/shared/range';

/** A fake file system: the files that exist, and junctions (a folder that really lies elsewhere). */
function windowsFs(files: string[], junctions: Record<string, string> = {}) {
  return (path: string): string => {
    let real = path;
    for (const [from, to] of Object.entries(junctions)) {
      if (real.toLowerCase().startsWith(from.toLowerCase())) real = to + real.slice(from.length);
    }
    if (!files.some((file) => file.toLowerCase() === real.toLowerCase())) throw new Error('ENOENT');
    return real;
  };
}

describe('mediaFile', () => {
  const root = 'C:\\Users\\me\\demo';
  const files = ['C:\\Users\\me\\demo\\takes\\1\\screen.mp4', 'C:\\Users\\me\\demo\\stills\\a page.png', 'C:\\Users\\me\\secret.txt', 'D:\\elsewhere\\x.mp4'];
  const options = { root, realpath: windowsFs(files, { 'C:\\Users\\me\\demo\\linked': 'D:\\elsewhere' }), platform: 'win32' as const };

  it('names files inside the project, decoded', () => {
    expect(mediaFile('/takes/1/screen.mp4', options)).toBe('C:\\Users\\me\\demo\\takes\\1\\screen.mp4');
    expect(mediaFile('/stills/a%20page.png', options)).toBe('C:\\Users\\me\\demo\\stills\\a page.png');
  });

  it('refuses dot segments, encoded or not, and separators, colons or NUL inside a segment', () => {
    for (const path of ['/../secret.txt', '/takes/../../secret.txt', '/%2e%2e/secret.txt', '/takes/%2E%2E/%2e%2e/secret.txt', '/.%2fsecret.txt', '/..%5csecret.txt', '/C:%5cUsers%5cme%5csecret.txt', '/takes%00/1', '/takes//1/screen.mp4', '/']) {
      expect(mediaFile(path, options), path).toBeUndefined();
    }
  });

  it('refuses a file that a junction places outside the project, bad encoding and missing files', () => {
    expect(mediaFile('/linked/x.mp4', options)).toBeUndefined();
    expect(mediaFile('/takes/%E0%A4%A/screen.mp4', options)).toBeUndefined();
    expect(mediaFile('/takes/2/screen.mp4', options)).toBeUndefined();
    expect(mediaFile('takes/1/screen.mp4', options)).toBeUndefined();
  });

  it('compares names without case on Windows and macOS, with case on Linux', () => {
    expect(isInside('c:\\users\\ME\\DEMO\\takes\\1\\screen.mp4', root, 'win32')).toBe(true);
    expect(isInside('C:\\Users\\me\\demo-other\\x.mp4', root, 'win32')).toBe(false);
    expect(isInside('C:\\Users\\me\\demo', root, 'win32')).toBe(false);
    expect(isInside('/Users/me/Demo/x.mp4', '/Users/me/demo', 'darwin')).toBe(true);
    expect(isInside('/home/me/Demo/x.mp4', '/home/me/demo', 'linux')).toBe(false);
    expect(isInside('/home/me/demo/x.mp4', '/home/me/demo/', 'linux')).toBe(true);
  });

  it('serves the media types the editor reads', () => {
    expect(['a.mp4', 'b.M4A', 'c.png', 'd.jsonl', 'e.bin', 'f.exe'].map(mediaType)).toEqual([
      'video/mp4',
      'audio/mp4',
      'image/png',
      'application/x-ndjson',
      'application/octet-stream',
      'application/octet-stream',
    ]);
  });
});

describe('parseRange', () => {
  it('reads one byte range, an open end and a suffix, cut to the file', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=990-2000', 1000)).toEqual({ start: 990, end: 999 });
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('serves the whole file for no header or one it ignores, and refuses a start past the end', () => {
    for (const header of [null, undefined, '', 'items=0-1', 'bytes=0-1,5-9', 'bytes=-', 'bytes=50-10']) expect(parseRange(header, 1000), String(header)).toBeUndefined();
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
  });
});
```

`apps/desktop/test/timeline-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProjectInput, type InputEvent } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import { formatBytes, formatDuration, formatSpeed, formatTime } from '../src/shared/format';
import { activityColumns, groupPins, outputTimesOf, timelineModel, waveformColumns } from '../src/shared/timeline-model';

function project(input: Partial<CuttleProjectInput>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

// 0–3 at 1× (output 0–3), 3–8 at 4× (3–4.25), a jump to 8.5–11.5 (4.25–7.25), a still, a card.
const demo = project({
  scenes: [
    { type: 'clip', label: 'Prompt', from: 0, to: 3 },
    { type: 'clip', from: 3, to: 8, speed: 4 },
    { type: 'clip', from: 8.5, to: 11.5 },
    { type: 'still', image: 'stills/page.png', duration: 2, motion: 'scroll' },
    { type: 'card', title: 'The end', duration: 1.5 },
  ],
  zooms: [{ at: 8.8, duration: 2.5, rect: [0, 0, 100, 100], label: 'Answer' }],
  masks: [
    { from: 0, to: 9, rect: [0, 0, 10, 10] },
    { from: 8.1, to: 8.4, rect: [0, 0, 10, 10], enabled: false },
  ],
  texts: [{ at: 0.5, duration: 2, text: 'One prompt' }],
});
const spans = sceneSpans(demo.scenes);

describe('timelineModel', () => {
  const model = timelineModel(demo, spans, [
    { t: 2.5, kind: 'prompt' },
    { t: 4, kind: 'tool', label: 'Bash' },
    { t: 8.2, kind: 'tool', label: 'Read' },
    { t: 9, kind: 'answer' },
  ]);

  it('lays the scenes out in output seconds, named by label or by what they are', () => {
    expect(model.duration).toBe(10.75);
    expect(model.scenes.map((scene) => [scene.kind, scene.start, scene.end, scene.title, scene.detail])).toEqual([
      ['clip', 0, 3, 'Prompt', '3 s'],
      ['clip', 3, 4.25, 'Sped up', '4× · 5 s → 1.3 s'],
      ['clip', 4.25, 7.25, 'Clip', '3 s'],
      ['still', 7.25, 9.25, 'page.png', '2 s · scroll'],
      ['card', 9.25, 10.75, 'The end', '1.5 s'],
    ]);
  });

  it('draws an overlay once per stretch of output that shows it and counts what no clip shows', () => {
    expect(model.lanes.mask.blocks.map((block) => [block.start, block.end, block.enabled])).toEqual([
      [0, 4.25, true],
      [4.25, 4.75, true],
    ]);
    expect(model.lanes.mask.cutOut).toBe(1);
    const [zoom] = model.lanes.zoom.blocks;
    expect([zoom?.start, zoom?.end, zoom?.title]).toEqual([expect.closeTo(4.55, 9), expect.closeTo(7.05, 9), 'Answer']);
    expect(model.lanes.caption.blocks.map((block) => block.title)).toEqual(['One prompt']);
  });

  it('pins markers where a clip shows them; a cut-out marker has no pin', () => {
    expect(model.markers.map((pin) => [pin.t, pin.kind])).toEqual([
      [2.5, 'prompt'],
      [3.25, 'tool'],
      [4.75, 'answer'],
    ]);
  });
});

describe('outputTimesOf and groupPins', () => {
  it('finds a source second in every clip that shows it', () => {
    const repeated = sceneSpans(project({ scenes: [{ type: 'clip', from: 0, to: 4 }, { type: 'clip', from: 2, to: 6, speed: 2 }] }).scenes);
    expect(outputTimesOf(repeated, 3)).toEqual([3, 4.5]);
    expect(outputTimesOf(repeated, 7)).toEqual([]);
  });

  it('merges tool calls that crowd, never prompts or answers', () => {
    const groups = groupPins(
      [
        { t: 1, source: 1, kind: 'tool' },
        { t: 1.2, source: 1.2, kind: 'tool' },
        { t: 1.3, source: 1.3, kind: 'answer' },
        { t: 5, source: 5, kind: 'tool' },
      ],
      0.5,
    );
    expect(groups.map((group) => [group.t, group.kind, group.pins.length])).toEqual([
      [1, 'tool', 2],
      [1.3, 'answer', 1],
      [5, 'tool', 1],
    ]);
  });
});

describe('activity and waveform columns', () => {
  it('counts input in output time, sped-up input denser, and scales to the busiest column', () => {
    const events: InputEvent[] = [
      { t: 1, type: 'click', x: 0, y: 0, button: 'left' },
      { t: 4, type: 'keys', count: 3 },
      { t: 4.1, type: 'move', x: 1, y: 1 },
      { t: 8.2, type: 'click', x: 0, y: 0, button: 'left' },
      { t: 0.5, type: 'shape', shape: 'text' },
    ];
    // the click at 1 s in column 1; keys and a move in the 4× clip (output 3.25) in column 3; the
    // click at 8.2 s is cut out
    expect(activityColumns(events, spans, 0, 5, 5)).toEqual([0, 1 / 3.25, 0, 1, 0]);
    expect(activityColumns([], spans, 0, 5, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('takes the loudest peak of the source each column plays and leaves muted clips silent', () => {
    // one peak per 1/10 s of the mic, which started 1 s after the screen: peak i is source 1 + i / 10
    const data = new Uint8Array(120).map((_, i) => (i === 25 ? 255 : 51));
    const peaks = { rate: 10, offset: 1, data };
    const muted = (speed: number) => speed > 1;
    const columns = waveformColumns(peaks, spans, 0, 5, 5, muted);
    // output 0–1 is source 0–1, before the mic: silent; 3–4 is the muted 4× clip
    expect(columns).toEqual([0, 0.2, 0.2, 0, 0.2]);
    // source 3.5 (peak 25) plays in output 3–4 at 4×: heard when sped-up clips are not muted
    expect(waveformColumns(peaks, spans, 0, 5, 5, () => false)[3]).toBe(1);
  });
});

describe('format', () => {
  it('writes times, lengths, speeds and sizes for people', () => {
    expect([0, 9.99, 42.55, 754.2, 3723].map(formatTime)).toEqual(['0:00.0', '0:09.9', '0:42.5', '12:34.2', '1:02:03.0']);
    expect([0.42, 9.96, 12.4, 125, 3720].map(formatDuration)).toEqual(['0.4 s', '10 s', '12 s', '2 min 5 s', '1 h 2 min']);
    expect([12, 1.25, 1].map(formatSpeed)).toEqual(['12×', '1.3×', '1×']);
    expect([2048, 13_002_342, 2.5 * 1024 ** 3].map(formatBytes)).toEqual(['2 KB', '12.4 MB', '2.5 GB']);
  });
});
```

`apps/desktop/test/contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WINDOW_CHANNELS } from '../src/shared/channels';
import { REQUESTS } from '../src/shared/ipc';
import { MAX_THUMBS, PeakFolder, PEAKS_RATE, PEAKS_SAMPLE_RATE, progressOf, proxyArgs, thumbnailsArgs, thumbnailsMeta } from '../src/shared/media-jobs';

describe('the IPC contract', () => {
  it('gives every request to exactly one kind of window', () => {
    const owners = Object.keys(REQUESTS).map((channel) =>
      Object.entries(WINDOW_CHANNELS)
        .filter(([, channels]) => (channels.requests as readonly string[]).includes(channel))
        .map(([kind]) => kind),
    );
    expect(owners.every((kinds) => kinds.length === 1)).toBe(true);
  });

  it('checks what a window sends', () => {
    expect(REQUESTS['export:start'].safeParse({ formats: ['16:9', '9:16'], encoder: 'auto' }).success).toBe(true);
    expect(REQUESTS['export:start'].safeParse({ formats: [], encoder: 'auto' }).success).toBe(false);
    expect(REQUESTS['export:start'].safeParse({ formats: ['4:3'], encoder: 'auto' }).success).toBe(false);
    expect(REQUESTS['export:start'].safeParse({ formats: ['16:9'], encoder: 'auto', out: 'C:\\Windows' }).success).toBe(false);
    expect(REQUESTS['pill:open'].safeParse({ dir: 'C:\\demo' }).success).toBe(true);
    expect(REQUESTS['pill:open'].safeParse({ dir: '' }).success).toBe(false);
    expect(REQUESTS['project:info'].safeParse({ any: 1 }).success).toBe(false);
  });
});

describe('the media jobs', () => {
  it('makes a 720p proxy with the take timestamps and a key frame every half second', () => {
    const args = proxyArgs('in.mp4', 'out.mp4');
    expect(args).toContain('-copyts');
    expect(args.join(' ')).toContain("scale=-2:'min(720,ih)'");
    expect(args.join(' ')).toContain('-force_key_frames expr:gte(t,n_forced*0.5)');
    expect(args.at(-1)).toBe('out.mp4');
  });

  it('takes a thumbnail every second, fewer for long takes, tiled 20 wide', () => {
    expect(thumbnailsMeta(12.3)).toEqual({ interval: 1, width: 160, height: 90, count: 13, columns: 13 });
    const long = thumbnailsMeta(1800);
    expect(long.interval).toBe(3);
    expect(long.count).toBeLessThanOrEqual(MAX_THUMBS);
    expect(long.columns).toBe(20);
    expect(thumbnailsArgs('in.mp4', 'out.jpg', long).join(' ')).toContain('tile=20x30');
  });

  it('folds 16-bit samples into peaks, also when a chunk splits a sample', () => {
    const window = PEAKS_SAMPLE_RATE / PEAKS_RATE;
    const samples = new Int16Array(window * 2 + 10);
    samples[5] = 16384; // half scale in the first window
    samples[window + 3] = -32768; // full scale in the second
    samples[window * 2 + 1] = 3277; // a tenth in the short last one
    const bytes = new Uint8Array(samples.buffer);
    const folder = new PeakFolder();
    folder.push(bytes.subarray(0, 11)); // ends in the middle of a sample
    folder.push(bytes.subarray(11));
    expect([...folder.finish()]).toEqual([128, 255, 26]);
  });

  it("reads ffmpeg's progress", () => {
    expect(progressOf('out_time_us=2500000', 10)).toBe(0.25);
    expect(progressOf('out_time_us=20000000', 10)).toBe(1);
    expect(progressOf('progress=continue', 10)).toBeUndefined();
    expect(progressOf('out_time_us=1', 0)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm exec vitest run --project node apps/desktop/test/protocol.test.ts apps/desktop/test/timeline-model.test.ts apps/desktop/test/contract.test.ts`
Expected: FAIL: the three suites cannot load (`Cannot find module '../src/shared/media-path'`, `'../src/shared/format'`, `'../src/shared/channels'`).

- [ ] **Step 4: The pure modules**

`apps/desktop/src/shared/format.ts`:

```ts
/** A time for people: `0:42.5`, `12:03.0`, `1:02:03.0` (tenths, never rounded up past the time). */
export function formatTime(seconds: number): string {
  const tenths = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10 + 1e-6);
  const s = Math.floor(tenths / 10) % 60;
  const m = Math.floor(tenths / 600) % 60;
  const h = Math.floor(tenths / 36_000);
  const rest = `${String(s).padStart(2, '0')}.${tenths % 10}`;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** A length for people: `0.4 s`, `12 s`, `2 min 5 s`, `1 h 2 min`. */
export function formatDuration(seconds: number): string {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  if (value < 10) return `${(Math.round(value * 10) / 10).toString()} s`;
  if (value < 60) return `${Math.round(value)} s`;
  const total = Math.round(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h} h ${m} min` : s > 0 ? `${m} min ${s} s` : `${m} min`;
}

/** A speed for people: `12×`, `1.5×`. */
export function formatSpeed(speed: number): string {
  return `${Math.round(speed * 10) / 10}×`;
}

/** A file size for people: `840 KB`, `12.4 MB`, `1.2 GB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
```

`apps/desktop/src/shared/range.ts`:

```ts
/** Byte range of a file to send: `start` and `end` inclusive, as in a Content-Range header. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * The range a `Range` header asks for in a file of `size` bytes: undefined for the whole file (no
 * header, another unit, several ranges, or a header that does not parse, which servers may ignore),
 * `'unsatisfiable'` for a range that starts past the end (answered with 416). Supports `bytes=a-b`,
 * `bytes=a-` and `bytes=-n` (the last n bytes); an end past the file is cut to the file.
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | 'unsatisfiable' | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, first, last] = match;
  if (first === '' && last === '') return undefined;
  if (first === '') {
    const length = Number(last);
    if (length === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size) return 'unsatisfiable';
  if (end < start) return undefined;
  return { start, end };
}
```

`apps/desktop/src/shared/media-path.ts`:

```ts
// Which file a cuttle-media:// request may read. Pure (the file system comes in as `realpath`), so
// the rules are tested on every platform: only files inside the project folder, after junctions and
// symbolic links are resolved, compared the way the platform's file system compares names.

export interface MediaPathOptions {
  /** The real path of the project folder (junctions resolved), absolute. */
  root: string;
  /** Resolves a path to its real path; throws when it does not exist. */
  realpath: (path: string) => string;
  /** `win32` and `darwin` compare names without case. */
  platform: NodeJS.Platform;
}

/**
 * The real path of the file that the URL path `pathname` (percent-encoded, starting with "/") names
 * inside the project, or undefined when it is not one: an empty, "." or ".." segment, a backslash,
 * colon or NUL in a segment, bad percent-encoding, a file that does not exist, or a real path that
 * leaves the folder (a junction or link pointing elsewhere).
 */
export function mediaFile(pathname: string, { root, realpath, platform }: MediaPathOptions): string | undefined {
  if (!pathname.startsWith('/')) return undefined;
  const segments: string[] = [];
  for (const raw of pathname.slice(1).split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    if (segment === '' || segment === '.' || segment === '..' || /[\\:\0]/.test(segment)) return undefined;
    segments.push(segment);
  }
  if (segments.length === 0) return undefined;
  const separator = platform === 'win32' ? '\\' : '/';
  const joined = [root.replace(/[\\/]+$/, ''), ...segments].join(separator);
  let real: string;
  try {
    real = realpath(joined);
  } catch {
    return undefined;
  }
  return isInside(real, root, platform) ? real : undefined;
}

/** Whether `path` lies inside the folder `root` (not the folder itself), both real absolute paths. */
export function isInside(path: string, root: string, platform: NodeJS.Platform): boolean {
  const fold = (value: string) => {
    const unified = platform === 'win32' ? value.replaceAll('/', '\\') : value;
    return platform === 'win32' || platform === 'darwin' ? unified.toLowerCase() : unified;
  };
  const separator = platform === 'win32' ? '\\' : '/';
  const folder = fold(root).replace(/[\\/]+$/, '') + separator;
  return fold(path).startsWith(folder);
}

/** MIME types of the files the editor reads from a project. */
const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.bin': 'application/octet-stream',
};

export function mediaType(path: string): string {
  const dot = path.lastIndexOf('.');
  return (dot >= 0 && TYPES[path.slice(dot).toLowerCase()]) || 'application/octet-stream';
}
```

`apps/desktop/src/shared/timeline-model.ts`:

```ts
// What the editor's timeline draws, in output seconds: pure, so it is tested without a window.
import type { CuttleProject, InputEvent, Marker, MarkerKind } from '@cuttle/project';
import { occurrences, type SceneSpan } from '@cuttle/timeline';
import { formatDuration, formatSpeed } from './format';

export type OverlayKind = 'zoom' | 'mask' | 'caption';

export interface SceneBlock {
  index: number;
  kind: 'clip' | 'still' | 'card';
  /** Output seconds. */
  start: number;
  end: number;
  /** The label, or a name made from the scene. */
  title: string;
  /** Speed and lengths of a clip (`12× · 145 s → 12 s`), the motion of a still. */
  detail: string;
  speed?: number;
}

export interface OverlayBlock {
  kind: OverlayKind;
  /** Index in the project's `zooms`, `masks` or `texts`. */
  item: number;
  /** One occurrence, in output seconds. */
  start: number;
  end: number;
  enabled: boolean;
  title: string;
}

export interface OverlayLane {
  blocks: OverlayBlock[];
  /** Items no clip shows. */
  cutOut: number;
}

export interface MarkerPin {
  /** Output seconds; a marker shown by several clips has a pin for each. */
  t: number;
  source: number;
  kind: MarkerKind;
  label?: string;
}

export interface TimelineModel {
  duration: number;
  scenes: SceneBlock[];
  lanes: Record<OverlayKind, OverlayLane>;
  markers: MarkerPin[];
}

const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

function sceneBlock(span: SceneSpan): SceneBlock {
  const { scene, index, start, end } = span;
  if (scene.type === 'clip') {
    const source = scene.to - scene.from;
    const detail = scene.speed === 1 ? formatDuration(source) : `${formatSpeed(scene.speed)} · ${formatDuration(source)} → ${formatDuration(end - start)}`;
    return { index, kind: 'clip', start, end, title: scene.label ?? (scene.speed > 1 ? 'Sped up' : 'Clip'), detail, speed: scene.speed };
  }
  if (scene.type === 'still') {
    const motion = scene.motion === 'none' ? '' : ` · ${scene.motion === 'kenburns' ? 'Ken Burns' : 'scroll'}`;
    return { index, kind: 'still', start, end, title: scene.label ?? baseName(scene.image), detail: `${formatDuration(scene.duration)}${motion}` };
  }
  return { index, kind: 'card', start, end, title: scene.label ?? scene.title, detail: formatDuration(scene.duration) };
}

function lane<T extends { enabled: boolean; label?: string }>(
  kind: OverlayKind,
  items: readonly T[],
  spans: readonly SceneSpan[],
  range: (item: T) => [number, number],
  title: (item: T) => string,
): OverlayLane {
  const blocks: OverlayBlock[] = [];
  let cutOut = 0;
  items.forEach((item, index) => {
    const [from, to] = range(item);
    const shown = [...new Set(occurrences(spans, from, to).filter((occurrence) => occurrence !== undefined))];
    if (shown.length === 0) cutOut++;
    for (const occurrence of shown) {
      blocks.push({ kind, item: index, start: occurrence.start, end: occurrence.end, enabled: item.enabled, title: item.label ?? title(item) });
    }
  });
  return { blocks, cutOut };
}

/** The output seconds at which the clips show source second `t` (none when it is cut out). */
export function outputTimesOf(spans: readonly SceneSpan[], t: number): number[] {
  const times: number[] = [];
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'clip' || t < scene.from || t >= scene.to) continue;
    times.push(span.start + (t - scene.from) / scene.speed);
  }
  return times;
}

export function timelineModel(project: CuttleProject, spans: readonly SceneSpan[], markers: readonly Marker[] = []): TimelineModel {
  return {
    duration: spans.at(-1)?.end ?? 0,
    scenes: spans.map(sceneBlock),
    lanes: {
      zoom: lane('zoom', project.zooms, spans, (zoom) => [zoom.at, zoom.at + zoom.duration], () => 'Zoom'),
      mask: lane('mask', project.masks, spans, (mask) => [mask.from, mask.to], () => 'Mask'),
      caption: lane('caption', project.texts, spans, (text) => [text.at, text.at + text.duration], (text) => text.text),
    },
    markers: markers
      .flatMap((marker) => outputTimesOf(spans, marker.t).map((t) => ({ t, source: marker.t, kind: marker.kind, ...(marker.label !== undefined && { label: marker.label }) })))
      .sort((a, b) => a.t - b.t),
  };
}

/** Pins closer than `minGap` output seconds that are tool calls merge into one pin with a count. */
export interface PinGroup {
  t: number;
  kind: MarkerKind;
  pins: MarkerPin[];
}

export function groupPins(pins: readonly MarkerPin[], minGap: number): PinGroup[] {
  const groups: PinGroup[] = [];
  for (const pin of pins) {
    const last = groups.at(-1);
    if (last && pin.kind === 'tool' && last.kind === 'tool' && pin.t - last.pins.at(-1)!.t < minGap) last.pins.push(pin);
    else groups.push({ t: pin.t, kind: pin.kind, pins: [pin] });
  }
  return groups;
}

/**
 * Input activity per output-time column: how many input events (clicks, keys, scrolls and moves)
 * the clips show in each of `columns` equal slices of `[from, to)` output seconds, scaled to 0–1 by
 * the busiest column.
 */
export function activityColumns(events: readonly InputEvent[], spans: readonly SceneSpan[], from: number, to: number, columns: number): number[] {
  const counts = new Array<number>(columns).fill(0);
  const width = (to - from) / columns;
  if (!(width > 0)) return counts;
  for (const event of events) {
    if (event.type === 'shape') continue;
    const weight = event.type === 'move' ? 0.25 : event.type === 'keys' ? event.count : 1;
    for (const t of outputTimesOf(spans, event.t)) {
      const column = Math.floor((t - from) / width);
      if (column >= 0 && column < columns) counts[column]! += weight;
    }
  }
  const most = Math.max(0, ...counts);
  return most === 0 ? counts : counts.map((count) => count / most);
}

/** The mic's loudness: one peak (0–255) per `1 / rate` seconds of the mic, which starts `offset` seconds after the screen. */
export interface Peaks {
  rate: number;
  offset: number;
  data: Uint8Array;
}

/**
 * The mic's peak (0–1) per output-time column of `[from, to)`: each column takes the loudest peak of
 * the source seconds the clips play there; still and card scenes, and clips that are silent in the
 * export (`muted(speed)`), are 0.
 */
export function waveformColumns(peaks: Peaks, spans: readonly SceneSpan[], from: number, to: number, columns: number, muted: (speed: number) => boolean): number[] {
  const out = new Array<number>(columns).fill(0);
  const width = (to - from) / columns;
  if (!(width > 0)) return out;
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'clip' || muted(scene.speed) || span.end <= from || span.start >= to) continue;
    const first = Math.max(0, Math.floor((span.start - from) / width));
    const last = Math.min(columns - 1, Math.ceil((span.end - from) / width) - 1);
    for (let column = first; column <= last; column++) {
      const outStart = Math.max(span.start, from + column * width);
      const outEnd = Math.min(span.end, from + (column + 1) * width);
      if (outEnd <= outStart) continue;
      // Mic seconds of this column; none before the mic started or after it ended.
      const micStart = scene.from + (outStart - span.start) * scene.speed - peaks.offset;
      const micEnd = scene.from + (outEnd - span.start) * scene.speed - peaks.offset;
      if (micEnd <= 0 || micStart * peaks.rate >= peaks.data.length) continue;
      const a = Math.max(0, Math.floor(micStart * peaks.rate));
      const b = Math.min(peaks.data.length, Math.max(a + 1, Math.ceil(micEnd * peaks.rate)));
      let peak = 0;
      for (let i = a; i < b; i++) peak = Math.max(peak, peaks.data[i]!);
      out[column] = Math.max(out[column]!, peak / 255);
    }
  }
  return out;
}
```

`apps/desktop/src/shared/media-jobs.ts`:

```ts
// Messages between the main process and the media worker (a utility process running ffmpeg), and
// the ffmpeg arguments of each job: pure, so they are tested without ffmpeg.

/** A 720p copy of the screen track with a key frame every half second, for playback and scrubbing. */
export interface ProxyJob {
  job: 'proxy';
  input: string;
  output: string;
}

/** Small frames of a video every `interval` seconds, tiled `columns` wide into one JPEG. */
export interface ThumbnailsJob {
  job: 'thumbnails';
  input: string;
  output: string;
}

/** The mic's loudness: one byte (0–255) per 1/`rate` seconds. */
export interface PeaksJob {
  job: 'peaks';
  input: string;
  output: string;
}

export type MediaJob = ProxyJob | ThumbnailsJob | PeaksJob;

export interface ThumbnailsMeta {
  interval: number;
  width: number;
  height: number;
  count: number;
  columns: number;
}

export type WorkerRequest = { id: number; cancel?: false } & MediaJob;
export type WorkerCancel = { id: number; cancel: true };
export type WorkerReply =
  | { id: number; progress: number }
  | { id: number; done: true; meta?: ThumbnailsMeta }
  | { id: number; error: string; cancelled?: boolean };

/** Height of the proxy (the screen track is scaled down to it, never up). */
export const PROXY_HEIGHT = 720;
/** Seconds between the proxy's key frames: above 6× the player shows key frames only. */
export const PROXY_KEY_SECONDS = 0.5;
export const THUMB_WIDTH = 160;
export const THUMB_HEIGHT = 90;
export const THUMB_COLUMNS = 20;
/** At most this many thumbnails per take; longer takes get a longer interval. */
export const MAX_THUMBS = 600;
export const PEAKS_RATE = 100;
/** Samples per second the mic is decoded at for its peaks. */
export const PEAKS_SAMPLE_RATE = 8000;

export function proxyArgs(input: string, output: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-loglevel', 'error',
    '-i', input,
    '-map', '0:v:0', '-an',
    // The proxy keeps the take's timestamps, so a source second is the same frame in both.
    '-copyts', '-fps_mode', 'passthrough',
    '-vf', `scale=-2:'min(${PROXY_HEIGHT},ih)':flags=bilinear,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
    '-force_key_frames', `expr:gte(t,n_forced*${PROXY_KEY_SECONDS})`,
    '-movflags', '+faststart',
    '-f', 'mp4', output,
  ];
}

/** The thumbnail interval for a take of `seconds`: 1 s, longer when it would make more than `MAX_THUMBS`. */
export function thumbnailInterval(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / MAX_THUMBS));
}

export function thumbnailsMeta(seconds: number): ThumbnailsMeta {
  const interval = thumbnailInterval(seconds);
  const count = Math.max(1, Math.ceil(seconds / interval));
  return { interval, width: THUMB_WIDTH, height: THUMB_HEIGHT, count, columns: Math.min(THUMB_COLUMNS, count) };
}

export function thumbnailsArgs(input: string, output: string, meta: ThumbnailsMeta): string[] {
  const rows = Math.ceil(meta.count / meta.columns);
  return [
    '-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-loglevel', 'error',
    '-i', input,
    '-map', '0:v:0', '-an',
    // One frame per interval (the first at 0), letterboxed into 160×90, tiled in reading order.
    '-vf',
    [
      `fps=1/${meta.interval}:round=down`,
      `scale=${meta.width}:${meta.height}:force_original_aspect_ratio=decrease:flags=bilinear`,
      `pad=${meta.width}:${meta.height}:(ow-iw)/2:(oh-ih)/2:color=0x08080a`,
      `tile=${meta.columns}x${rows}:color=0x08080a`,
    ].join(','),
    '-frames:v', '1', '-q:v', '5',
    '-f', 'image2', '-update', '1', output,
  ];
}

export function peaksArgs(input: string): string[] {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', input, '-map', '0:a:0', '-ac', '1', '-ar', String(PEAKS_SAMPLE_RATE), '-f', 's16le', 'pipe:1'];
}

/**
 * Folds 16-bit mono samples into peaks: the loudest sample of each `PEAKS_SAMPLE_RATE / PEAKS_RATE`
 * samples, 0–255. `carry` keeps a window that a chunk boundary split.
 */
export class PeakFolder {
  private readonly window = PEAKS_SAMPLE_RATE / PEAKS_RATE;
  private filled = 0;
  private peak = 0;
  private odd: number | undefined;
  readonly peaks: number[] = [];

  push(chunk: Uint8Array): void {
    let i = 0;
    if (this.odd !== undefined && chunk.length > 0) {
      this.sample((this.odd | (chunk[0]! << 8)) << 16 >> 16);
      this.odd = undefined;
      i = 1;
    }
    for (; i + 1 < chunk.length; i += 2) this.sample((chunk[i]! | (chunk[i + 1]! << 8)) << 16 >> 16);
    if (i < chunk.length) this.odd = chunk[i];
  }

  private sample(value: number): void {
    this.peak = Math.max(this.peak, Math.abs(value));
    if (++this.filled === this.window) this.flush();
  }

  private flush(): void {
    this.peaks.push(Math.min(255, Math.round((this.peak / 32768) * 255)));
    this.filled = 0;
    this.peak = 0;
  }

  /** The peaks, the last window counted even when it is short. */
  finish(): Uint8Array {
    if (this.filled > 0) this.flush();
    return Uint8Array.from(this.peaks);
  }
}

/** The fraction done from ffmpeg's `-progress` output (`out_time_us=…`), for a job over `seconds`. */
export function progressOf(line: string, seconds: number): number | undefined {
  const match = /^out_time_us=(\d+)$/.exec(line.trim());
  if (!match || !(seconds > 0)) return undefined;
  return Math.min(1, Number(match[1]) / 1e6 / seconds);
}
```

`apps/desktop/src/shared/ipc.ts`:

```ts
// The IPC contract between the main process and the windows: every channel with the zod schema of
// what a window may send. The main process checks each request against it; the preloads expose only
// their window's channels.
import { z } from 'zod';

export const EXPORT_FORMATS = ['16:9', '1:1', '9:16'] as const;
export const ENCODERS = ['auto', 'hardware', 'software'] as const;

/** The origin of the media protocol in an editor window: `cuttle-media://project/<path in the project>`. */
export const MEDIA_ORIGIN = 'cuttle-media://project';

/** What the editor needs to open its project; the rest it reads through the media protocol. */
export interface ProjectInfo {
  dir: string;
  name: string;
  /** cuttle.json as written (parse it with `parseProject`) and the SHA-256 of its bytes. */
  raw: Record<string, unknown>;
  hash: string;
  /** Seconds after the screen track that the webcam and mic started (take.json); 0 when unknown. */
  offsets: { webcam: number; mic: number };
}

/** The editor's background media: a 720p proxy of the screen track, a thumbnail strip, the mic's peaks. */
export interface MediaState {
  /** Counts the changes, so a window keeps the newest of an answer and an event that cross. */
  seq: number;
  proxy: { state: 'none' | 'working' | 'ready' | 'failed'; progress?: number; path?: string; message?: string };
  thumbnails: {
    state: 'none' | 'working' | 'ready' | 'failed';
    path?: string;
    interval?: number;
    width?: number;
    height?: number;
    count?: number;
    columns?: number;
    message?: string;
  };
  peaks: { state: 'none' | 'working' | 'ready' | 'failed'; path?: string; rate?: number; message?: string };
}

export interface ExportProgress {
  format: (typeof EXPORT_FORMATS)[number];
  /** 0-based position of this format in the job, and the job's number of formats. */
  position: number;
  formats: number;
  done: number;
  total: number;
  elapsed: number;
}

export interface ExportFile {
  format: (typeof EXPORT_FORMATS)[number];
  out: string;
  seconds: number;
  bytes: number;
}

export type ExportEnd =
  | { state: 'done'; files: ExportFile[] }
  | { state: 'cancelled'; files: ExportFile[] }
  | { state: 'failed'; files: ExportFile[]; format: (typeof EXPORT_FORMATS)[number]; code: string; message: string };

/** Requests (window → main), each with the schema of its argument. */
export const REQUESTS = {
  // editor
  'project:info': z.undefined(),
  'project:reveal': z.string().max(4096).optional(),
  'media:state': z.undefined(),
  'export:start': z.strictObject({
    formats: z.array(z.enum(EXPORT_FORMATS)).min(1).max(3),
    encoder: z.enum(ENCODERS),
  }),
  'export:cancel': z.undefined(),
  // pill
  'pill:recent': z.undefined(),
  'pill:open': z.strictObject({ dir: z.string().min(1).max(4096) }).optional(),
  'pill:hide': z.undefined(),
  'pill:menu': z.undefined(),
} as const;

export type Request = keyof typeof REQUESTS;

/** What each request answers. */
export interface Responses {
  'project:info': ProjectInfo;
  'project:reveal': void;
  'media:state': MediaState;
  'export:start': { out: string };
  'export:cancel': void;
  'pill:recent': { dir: string; name: string; opened: number }[];
  'pill:open': void;
  'pill:hide': void;
  'pill:menu': void;
}

/** Events (main → window). */
export interface Events {
  'media:state': MediaState;
  'export:progress': ExportProgress;
  'export:end': ExportEnd;
  'pill:recent': Responses['pill:recent'];
}

export type Event = keyof Events;

/** The bridge a preload exposes as `window.cuttle`. */
export interface Bridge {
  invoke<R extends Request>(channel: R, argument?: z.input<(typeof REQUESTS)[R]>): Promise<Responses[R]>;
  on<E extends Event>(channel: E, listener: (payload: Events[E]) => void): () => void;
}
```

`apps/desktop/src/shared/channels.ts`:

```ts
// The channels each kind of window may use. No zod here: the preloads bundle this file.
import type { Event, Request } from './ipc';

export const WINDOW_CHANNELS = {
  editor: {
    requests: ['project:info', 'project:reveal', 'media:state', 'export:start', 'export:cancel'],
    events: ['media:state', 'export:progress', 'export:end'],
  },
  pill: {
    requests: ['pill:recent', 'pill:open', 'pill:hide', 'pill:menu'],
    events: ['pill:recent'],
  },
} as const satisfies Record<string, { requests: readonly Request[]; events: readonly Event[] }>;

export type WindowKind = keyof typeof WINDOW_CHANNELS;
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node apps/desktop/test/protocol.test.ts apps/desktop/test/timeline-model.test.ts apps/desktop/test/contract.test.ts`
Expected: PASS, 21 tests.

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop packages/export/package.json pnpm-lock.yaml
git commit -m "desktop: the package, the IPC contract and the pure modules (media paths, ranges, the timeline's model, ffmpeg jobs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The main process, the media worker and the preloads

**Files:**
- Create: `apps/desktop/src/main/{protocols,ipc,settings,project,media-service,export-service,windows,tray,index}.ts`, `apps/desktop/src/workers/media.ts`, `apps/desktop/src/preload/{bridge,editor,pill}.ts`, `apps/desktop/vite.main.config.ts`, `tools/desktop-icons.mjs`, `apps/desktop/assets/*` (generated)

- [ ] **Step 1: Protocols, IPC, settings and the project**

`apps/desktop/src/main/protocols.ts`:

```ts
import { createReadStream, realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { net, protocol, type Session } from 'electron';
import { mediaFile, mediaType } from '../shared/media-path';
import { parseRange } from '../shared/range';

/** The app's own pages: `app://cuttle/editor.html`, so a CSP's 'self' means the app. */
export const APP_ORIGIN = 'app://cuttle';

/**
 * The pages' content security policy: scripts and styles only from the app, media and images also
 * from the project (cuttle-media:), nothing from the network.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: cuttle-media:",
  "media-src 'self' blob: cuttle-media:",
  "connect-src 'self' cuttle-media: data:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Must run before the app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'cuttle-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

const notFound = (headers: Record<string, string> = {}) => new Response('not found', { status: 404, headers: { ...headers, 'Content-Type': 'text/plain' } });

/** The app's pages read media from another origin (cuttle-media: from app:), so the answers allow them. */
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

/**
 * Serves the renderer's built files (`rendererDir`, which may lie inside the app's asar archive) as
 * `app://cuttle/…` in `session`, HTML with the CSP.
 */
export function serveApp(session: Session, rendererDir: string): void {
  // The app's own folder holds no junctions, and the asar archive has no real paths to resolve.
  const options = { root: rendererDir, realpath: (path: string) => path, platform: process.platform };
  session.protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'cuttle') return notFound();
    const file = mediaFile(url.pathname, options);
    if (!file) return notFound();
    let response: Response;
    try {
      response = await net.fetch(pathToFileURL(file).toString());
    } catch {
      return notFound();
    }
    if (!file.endsWith('.html')) return response;
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(response.body, { status: response.status, headers });
  });
}

/**
 * Serves files inside the project folder `projectDir` as `cuttle-media://project/<path>` in
 * `session` (one session per editor window, so a window reaches only its own project), with Range
 * requests for the video demuxer. Paths are checked after junctions are resolved (`mediaFile`).
 */
export function serveMedia(session: Session, projectDir: string): void {
  const root = realpathSync.native(projectDir);
  const options = { root, realpath: (path: string) => realpathSync.native(path), platform: process.platform };
  session.protocol.handle('cuttle-media', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'project') return notFound(CORS);
    const file = mediaFile(url.pathname, options);
    if (!file) return notFound(CORS);
    let size: number;
    try {
      const info = await stat(file);
      if (!info.isFile()) return notFound(CORS);
      size = info.size;
    } catch {
      return notFound(CORS);
    }
    const headers: Record<string, string> = { ...CORS, 'Content-Type': mediaType(file), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    const range = parseRange(request.headers.get('range'), size);
    if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    if (size === 0) return new Response(new Uint8Array(0), { status: 200, headers: { ...headers, 'Content-Length': '0' } });
    const { start, end } = range ?? { start: 0, end: size - 1 };
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
    headers['Content-Length'] = String(end - start + 1);
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(body, { status: range ? 206 : 200, headers });
  });
}

/** An image of the app (icons): `assets/<name>` next to `dist/`. */
export function assetPath(name: string): string {
  return fileURLToPath(new URL(`../../assets/${name}`, import.meta.url));
}

/** A file of the app's bundle: `dist/<parts>` (the main bundle lives in dist/main/). */
export function bundlePath(...parts: string[]): string {
  return join(fileURLToPath(new URL('../', import.meta.url)), ...parts);
}
```

`apps/desktop/src/main/ipc.ts`:

```ts
import type { WebContents } from 'electron';
import { WINDOW_CHANNELS, type WindowKind } from '../shared/channels';
import { REQUESTS, type Events, type Request, type Responses } from '../shared/ipc';

type Channels<K extends WindowKind> = (typeof WINDOW_CHANNELS)[K]['requests'][number];

export type Handlers<K extends WindowKind> = {
  [R in Channels<K>]: (argument: ReturnType<(typeof REQUESTS)[R]['parse']>) => Promise<Responses[R]> | Responses[R];
};

/**
 * Registers the request handlers of one window on its own `webContents` (not globally), so a window
 * reaches only its kind's channels. Every argument is checked against the contract first.
 */
export function bindRequests<K extends WindowKind>(contents: WebContents, kind: K, handlers: Handlers<K>): void {
  for (const channel of WINDOW_CHANNELS[kind].requests as readonly Request[]) {
    const handler = (handlers as Record<string, (argument: unknown) => unknown>)[channel]!;
    contents.ipc.handle(channel, async (_event, argument: unknown) => {
      const parsed = REQUESTS[channel].safeParse(argument);
      if (!parsed.success) throw new Error(`${channel}: invalid request (${parsed.error.issues.map((issue) => issue.message).join('; ')})`);
      return handler(parsed.data);
    });
  }
}

/** Sends an event to a window, unless it is gone. */
export function send<E extends keyof Events>(contents: WebContents, channel: E, payload: Events[E]): void {
  if (!contents.isDestroyed()) contents.send(channel, payload);
}
```

`apps/desktop/src/main/settings.ts`:

```ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';

const RECENT_MAX = 10;

const SettingsSchema = z.object({
  recent: z.array(z.object({ dir: z.string(), name: z.string(), opened: z.number() })).catch([]).default([]),
  /** Where the pill sits, per display (DIP), keyed by the display's id. */
  pill: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).catch({}).default({}),
});

export type Settings = z.output<typeof SettingsSchema>;

const file = () => join(app.getPath('userData'), 'settings.json');

let cached: Settings | undefined;

/** The settings in the user's app data folder; defaults for a missing or broken file. */
export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;
  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(file(), 'utf8'));
  } catch {
    raw = {};
  }
  const parsed = SettingsSchema.safeParse(raw);
  cached = parsed.success ? parsed.data : SettingsSchema.parse({});
  return cached;
}

let writing = Promise.resolve();
const listeners = new Set<(settings: Settings) => void>();

/** Calls `listener` after every change of the settings. */
export function onSettingsChange(listener: (settings: Settings) => void): void {
  listeners.add(listener);
}

/** Changes the settings and writes them (one write at a time, temp file and rename). */
export async function updateSettings(change: (settings: Settings) => void): Promise<Settings> {
  const settings = await loadSettings();
  change(settings);
  const text = `${JSON.stringify(settings, null, 2)}\n`;
  writing = writing.then(async () => {
    await mkdir(dirname(file()), { recursive: true });
    await writeFile(`${file()}.part`, text);
    await rename(`${file()}.part`, file());
  }).catch(() => {});
  await writing;
  for (const listener of listeners) listener(settings);
  return settings;
}

/** Puts a project at the top of the recent list. */
export function addRecent(dir: string): Promise<Settings> {
  return updateSettings((settings) => {
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    settings.recent = [
      { dir, name: basename(dir), opened: Date.now() },
      ...settings.recent.filter((entry) => (process.platform === 'win32' ? entry.dir.toLowerCase() : entry.dir) !== key),
    ].slice(0, RECENT_MAX);
  });
}
```

`apps/desktop/src/main/project.ts`:

```ts
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { readProjectFile, samePath, type ProjectFile } from '@cuttle/core';
import { parseTakeJson, trackOffset, type CuttleProject } from '@cuttle/project';
import type { ProjectInfo } from '../shared/ipc';
import { CACHE_DIR } from './media-service';

/**
 * Seconds after the screen track that the webcam and the mic started, from the take.json next to
 * the screen track, used only where take.json describes those very files (as the export does);
 * 0 otherwise.
 */
export async function trackOffsets(dir: string, project: CuttleProject): Promise<ProjectInfo['offsets']> {
  const screen = resolve(dir, project.sources.screen);
  const text = await readFile(join(dirname(screen), 'take.json'), 'utf8').catch(() => undefined);
  const parsed = text === undefined ? undefined : parseTakeJson(text);
  if (!parsed?.ok || !samePath(resolve(dirname(screen), parsed.take.tracks.screen.file), screen)) return { webcam: 0, mic: 0 };
  const take = parsed.take;
  const offset = (track: 'webcam' | 'mic') => {
    const source = project.sources[track];
    const entry = take.tracks[track];
    if (source === undefined || !entry || !samePath(resolve(dirname(screen), entry.file), resolve(dir, source))) return 0;
    return trackOffset(take, track) ?? 0;
  };
  return { webcam: offset('webcam'), mic: offset('mic') };
}

export async function projectInfo(file: ProjectFile): Promise<ProjectInfo> {
  return { dir: file.dir, name: basename(file.dir), raw: file.raw, hash: file.hash ?? '', offsets: await trackOffsets(file.dir, file.project) };
}

/** Reads the project for an editor; throws the core's readable error for a missing or invalid cuttle.json. */
export function openProjectFile(dir: string): Promise<ProjectFile> {
  return readProjectFile(dir);
}

const LOCK = 'editor.lock';

/** Whether a process with this id runs. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Marks the project as open in this app (`.cuttle/editor.lock` with the process id), so another
 * Cuttle does not open it too and the CLI's `record` can refuse it. Throws when another running
 * Cuttle holds it; a lock left by a process that is gone is taken over. Returns the release.
 */
export async function lockProject(dir: string): Promise<() => Promise<void>> {
  const path = join(dir, CACHE_DIR, LOCK);
  const held = await readFile(path, 'utf8').then((text) => JSON.parse(text) as { pid?: unknown }, () => undefined);
  if (held && typeof held.pid === 'number' && held.pid !== process.pid && alive(held.pid)) {
    throw new Error(`${basename(dir)} is open in another Cuttle window (process ${held.pid})`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ pid: process.pid, opened: new Date().toISOString() })}\n`);
  return () => rm(path, { force: true });
}
```

- [ ] **Step 2: The media worker and its service; exports**

`apps/desktop/src/workers/media.ts`:

```ts
// The media worker: a utility process (no Electron APIs here) that runs ffmpeg for the editor's
// proxies, thumbnails and waveforms, away from the main process. One job at a time per request;
// the main process queues them.
import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { ffmpegPath, probeScreen, streamSeconds } from '@cuttle/core';
import {
  PEAKS_SAMPLE_RATE,
  PeakFolder,
  peaksArgs,
  progressOf,
  proxyArgs,
  thumbnailsArgs,
  thumbnailsMeta,
  type MediaJob,
  type ThumbnailsMeta,
  type WorkerCancel,
  type WorkerReply,
  type WorkerRequest,
} from '../shared/media-jobs';

interface ParentPort {
  on(event: 'message', listener: (message: { data: WorkerRequest | WorkerCancel }) => void): void;
  postMessage(message: WorkerReply): void;
}

const port = (process as unknown as { parentPort: ParentPort }).parentPort;
const running = new Map<number, ChildProcess>();
const cancelled = new Set<number>();

const reply = (message: WorkerReply) => port.postMessage(message);

/** Runs ffmpeg; `onLine` gets each stdout line (`-progress` output), `onData` raw stdout instead. */
function ffmpeg(id: number, args: string[], handlers: { onLine?: (line: string) => void; onData?: (chunk: Buffer) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    running.set(id, child);
    let stderr = '';
    let buffered = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (handlers.onData) return handlers.onData(chunk);
      buffered += chunk.toString('utf8');
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) handlers.onLine?.(line);
    });
    child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString('utf8')).slice(-4000)));
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      running.delete(id);
      if (cancelled.has(id)) return reject(new Error('cancelled'));
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().split(/\r?\n/).slice(-4).join(' / ')}`));
    });
  });
}

/** Writes to `<output>.part` and renames it when the job succeeded, so a half-made file never passes for a done one. */
async function into<T>(output: string, make: (part: string) => Promise<T>): Promise<T> {
  const part = `${output}.part`;
  try {
    const result = await make(part);
    await rename(part, output);
    return result;
  } catch (error) {
    await rm(part, { force: true }).catch(() => {});
    throw error;
  }
}

async function run(id: number, job: MediaJob): Promise<ThumbnailsMeta | undefined> {
  switch (job.job) {
    case 'proxy': {
      const { duration } = await probeScreen(job.input);
      await into(job.output, (part) =>
        ffmpeg(id, proxyArgs(job.input, part), {
          onLine(line) {
            const progress = progressOf(line, duration);
            if (progress !== undefined) reply({ id, progress });
          },
        }),
      );
      return undefined;
    }
    case 'thumbnails': {
      const { duration } = await probeScreen(job.input);
      const meta = thumbnailsMeta(duration);
      await into(job.output, (part) =>
        ffmpeg(id, thumbnailsArgs(job.input, part, meta), {
          onLine(line) {
            const progress = progressOf(line, duration);
            if (progress !== undefined) reply({ id, progress });
          },
        }),
      );
      return meta;
    }
    case 'peaks': {
      const seconds = await streamSeconds(job.input, 'a');
      const folder = new PeakFolder();
      let samples = 0;
      await ffmpeg(id, peaksArgs(job.input), {
        onData(chunk) {
          folder.push(chunk);
          samples += chunk.length / 2;
          if (seconds > 0) reply({ id, progress: Math.min(1, samples / PEAKS_SAMPLE_RATE / seconds) });
        },
      });
      await into(job.output, (part) => writeFile(part, folder.finish()));
      return undefined;
    }
  }
}

port.on('message', ({ data }) => {
  if (data.cancel) {
    cancelled.add(data.id);
    running.get(data.id)?.kill();
    return;
  }
  const { id, ...job } = data;
  run(id, job as MediaJob).then(
    (meta) => reply({ id, done: true, ...(meta && { meta }) }),
    (error: Error) => reply({ id, error: error.message, ...(cancelled.has(id) && { cancelled: true }) }),
  );
});
```

`apps/desktop/src/main/media-service.ts`:

```ts
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { CuttleProject } from '@cuttle/project';
import type { MediaState } from '../shared/ipc';
import type { MediaJob, ThumbnailsMeta, WorkerReply } from '../shared/media-jobs';
import { PEAKS_RATE } from '../shared/media-jobs';
import { bundlePath } from './protocols';

/** The editor's cache inside the project: proxies, thumbnails and peaks, made from the take. */
export const CACHE_DIR = '.cuttle';
const CACHE_FILE = 'media.json';
const CACHE_VERSION = 1;

/** Which source file a cached file was made from (by size and modification time). */
interface SourceKey {
  file: string;
  size: number;
  mtimeMs: number;
}

interface CacheEntry {
  source: SourceKey;
  meta?: ThumbnailsMeta;
}

interface Cache {
  version: number;
  proxy?: CacheEntry;
  thumbnails?: CacheEntry;
  peaks?: CacheEntry;
}

type Kind = 'proxy' | 'thumbnails' | 'peaks';
const OUTPUT: Record<Kind, string> = { proxy: 'proxy.mp4', thumbnails: 'thumbnails.jpg', peaks: 'peaks.bin' };

/** The one media worker of the app, started on first use; jobs from every window go through it. */
class Worker {
  private process: UtilityProcess | undefined;
  private next = 1;
  private readonly pending = new Map<number, { onProgress: (p: number) => void; resolve: (meta?: ThumbnailsMeta) => void; reject: (error: Error) => void }>();

  private start(): UtilityProcess {
    if (this.process) return this.process;
    const child = utilityProcess.fork(bundlePath('main', 'media-worker.mjs'), [], { serviceName: 'Cuttle media', stdio: 'ignore' });
    child.on('message', (message: WorkerReply) => {
      const job = this.pending.get(message.id);
      if (!job) return;
      if ('progress' in message) return job.onProgress(message.progress);
      this.pending.delete(message.id);
      if ('done' in message) job.resolve(message.meta);
      else job.reject(Object.assign(new Error(message.error), { cancelled: message.cancelled === true }));
    });
    child.on('exit', () => {
      this.process = undefined;
      for (const job of this.pending.values()) job.reject(new Error('the media worker stopped'));
      this.pending.clear();
    });
    this.process = child;
    return child;
  }

  run(job: MediaJob, onProgress: (progress: number) => void): { promise: Promise<ThumbnailsMeta | undefined>; cancel(): void } {
    const id = this.next++;
    const child = this.start();
    const promise = new Promise<ThumbnailsMeta | undefined>((resolve, reject) => this.pending.set(id, { onProgress, resolve, reject }));
    child.postMessage({ id, ...job });
    return { promise, cancel: () => this.process?.postMessage({ id, cancel: true }) };
  }

  stop(): void {
    this.process?.kill();
  }
}

export const mediaWorker = new Worker();

async function sourceKey(path: string, file: string): Promise<SourceKey | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0 ? { file, size: info.size, mtimeMs: info.mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

const sameSource = (a: SourceKey | undefined, b: SourceKey | undefined) => !!a && !!b && a.file === b.file && a.size === b.size && a.mtimeMs === b.mtimeMs;

/** Project-relative path with forward slashes, as the media protocol takes it. */
const projectPath = (dir: string, path: string) => relative(dir, path).split(sep).join('/');

/**
 * The editor's background media for one project: a proxy of the screen track, thumbnails (from the
 * proxy when it is there) and the mic's peaks, made once per take and kept in `.cuttle/`. Reports
 * its state on every change.
 */
export class ProjectMedia {
  private readonly state: MediaState = { seq: 0, proxy: { state: 'none' }, thumbnails: { state: 'none' }, peaks: { state: 'none' } };
  private readonly jobs: { cancel(): void }[] = [];
  private disposed = false;
  private cache: Cache = { version: CACHE_VERSION };

  constructor(
    private readonly dir: string,
    private readonly project: CuttleProject,
    private readonly onChange: (state: MediaState) => void,
  ) {}

  current(): MediaState {
    return structuredClone(this.state);
  }

  private cacheDir = () => join(this.dir, CACHE_DIR);

  private set<K extends Kind>(kind: K, value: MediaState[K]): void {
    if (this.disposed) return;
    this.state[kind] = value;
    this.state.seq++;
    this.onChange(this.current());
  }

  private async readCache(): Promise<void> {
    try {
      const cache = JSON.parse(await readFile(join(this.cacheDir(), CACHE_FILE), 'utf8')) as Cache;
      if (cache.version === CACHE_VERSION) this.cache = cache;
    } catch {
      this.cache = { version: CACHE_VERSION };
    }
  }

  private async writeCache(): Promise<void> {
    const path = join(this.cacheDir(), CACHE_FILE);
    await writeFile(`${path}.part`, `${JSON.stringify(this.cache, null, 2)}\n`);
    await rename(`${path}.part`, path);
  }

  /** Starts what is missing: the proxy, then the thumbnails from it; the peaks alongside. */
  async start(): Promise<void> {
    await mkdir(this.cacheDir(), { recursive: true });
    await this.readCache();
    const screen = resolve(this.dir, this.project.sources.screen);
    const screenKey = await sourceKey(screen, this.project.sources.screen);
    const mic = this.project.sources.mic === undefined ? undefined : resolve(this.dir, this.project.sources.mic);
    const micKey = mic === undefined ? undefined : await sourceKey(mic, this.project.sources.mic!);
    await Promise.all([this.visual(screen, screenKey), mic && micKey ? this.peaks(mic, micKey) : Promise.resolve()]);
  }

  private async visual(screen: string, key: SourceKey | undefined): Promise<void> {
    if (!key) return;
    const proxy = await this.make('proxy', screen, key, (progress) => this.set('proxy', { state: 'working', progress }));
    if (proxy) this.set('proxy', { state: 'ready', path: projectPath(this.dir, proxy) });
    const input = proxy ?? screen;
    const thumbs = await this.make('thumbnails', input, key);
    const meta = this.cache.thumbnails?.meta;
    if (thumbs && meta) this.set('thumbnails', { state: 'ready', path: projectPath(this.dir, thumbs), ...meta });
  }

  private async peaks(mic: string, key: SourceKey): Promise<void> {
    const peaks = await this.make('peaks', mic, key);
    if (peaks) this.set('peaks', { state: 'ready', path: projectPath(this.dir, peaks), rate: PEAKS_RATE });
  }

  /** The cached file of `kind` for `key`, made first when it is missing or stale; undefined when making it failed. */
  private async make(kind: Kind, input: string, key: SourceKey, onProgress?: (progress: number) => void): Promise<string | undefined> {
    const output = join(this.cacheDir(), OUTPUT[kind]);
    const cached = this.cache[kind];
    if (cached && sameSource(cached.source, key) && (await sourceKey(output, OUTPUT[kind]))) return output;
    if (this.disposed) return undefined;
    this.set(kind, { state: 'working', ...(kind === 'proxy' && { progress: 0 }) } as MediaState[typeof kind]);
    const job = mediaWorker.run({ job: kind, input, output }, (progress) => onProgress?.(progress));
    this.jobs.push(job);
    try {
      const meta = await job.promise;
      this.cache[kind] = { source: key, ...(meta && { meta }) };
      await this.writeCache();
      return output;
    } catch (error) {
      if (!(error as { cancelled?: boolean }).cancelled) this.set(kind, { state: 'failed', message: (error as Error).message } as MediaState[typeof kind]);
      return undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.jobs) job.cancel();
  }
}
```

`apps/desktop/src/main/export-service.ts`:

```ts
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { exportProject, ExportError, type EncoderPreference } from '@cuttle/export';
import type { EXPORT_FORMATS, ExportEnd, ExportFile, ExportProgress } from '../shared/ipc';
import { bundlePath } from './protocols';

type Format = (typeof EXPORT_FORMATS)[number];

/** The file a format is exported to, inside the project's `out/` (as the CLI does). */
export function exportPath(projectDir: string, format: Format): string {
  return join(projectDir, 'out', `${format.replace(':', 'x')}.mp4`);
}

/** Progress events at most this often. */
const PROGRESS_MS = 100;

/**
 * One export run of an editor: its formats one after another, with progress, cancel and the files
 * it wrote. `exportProject` reads cuttle.json from disk, so the run exports what was saved when it
 * started.
 */
export class ExportRun {
  private readonly controller = new AbortController();
  readonly done: Promise<ExportEnd>;

  constructor(projectDir: string, formats: readonly Format[], encoder: EncoderPreference, onProgress: (progress: ExportProgress) => void) {
    this.done = this.run(projectDir, formats, encoder, onProgress);
  }

  private async run(projectDir: string, formats: readonly Format[], encoder: EncoderPreference, onProgress: (progress: ExportProgress) => void): Promise<ExportEnd> {
    const files: ExportFile[] = [];
    const started = Date.now();
    for (const [position, format] of formats.entries()) {
      let last = 0;
      try {
        const out = exportPath(projectDir, format);
        const result = await exportProject({
          projectDir,
          format,
          out,
          encoder,
          pageDir: bundlePath('main', 'export-page'),
          signal: this.controller.signal,
          onProgress: (done, total) => {
            const now = Date.now();
            if (done < total && now - last < PROGRESS_MS) return;
            last = now;
            onProgress({ format, position, formats: formats.length, done, total, elapsed: (now - started) / 1000 });
          },
        });
        files.push({ format, out: result.out, seconds: result.seconds, bytes: (await stat(result.out)).size });
      } catch (error) {
        if (error instanceof ExportError && error.code === 'cancelled') return { state: 'cancelled', files };
        const code = error instanceof ExportError ? error.code : 'internal';
        return { state: 'failed', files, format, code, message: error instanceof Error ? error.message : String(error) };
      }
    }
    return { state: 'done', files };
  }

  cancel(): void {
    this.controller.abort();
  }
}
```

- [ ] **Step 3: Windows, tray and the app's start**

`apps/desktop/src/main/windows.ts`:

```ts
import { join, resolve } from 'node:path';
import { BrowserWindow, Menu, dialog, screen, session, shell, type Session, type WebContents } from 'electron';
import { PROJECT_FILE } from '@cuttle/core';
import type { ExportEnd } from '../shared/ipc';
import { isInside } from '../shared/media-path';
import { ExportRun } from './export-service';
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
import { lockProject, openProjectFile, projectInfo } from './project';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
import { addRecent, loadSettings, updateSettings } from './settings';

/** Windows are never shown (the end-to-end check drives them hidden). */
export const HIDDEN = process.env.CUTTLE_HIDDEN === '1';

const BACKGROUND = '#0c0c0f';

/** No permissions (camera, mic, notifications …), no downloads, no navigation, no new windows. */
function lockDown(ses: Session): void {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
}

function guard(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

const webPreferences = (preload: string, ses: Session) => ({
  preload: bundlePath('preload', preload),
  session: ses,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  spellcheck: false,
  // The player keeps its own clock; a hidden window (the check) must keep rendering too.
  backgroundThrottling: false,
});

interface Editor {
  window: BrowserWindow;
  media: ProjectMedia;
  release: () => Promise<void>;
  run?: ExportRun;
}

const editors = new Map<string, Editor>();
const key = (dir: string) => (process.platform === 'win32' ? resolve(dir).toLowerCase() : resolve(dir));
let partitions = 0;

/** Opens the project in `dir` in an editor window (or brings its window to the front). Throws a readable error. */
export async function openEditor(projectDir: string): Promise<BrowserWindow> {
  const dir = resolve(projectDir);
  const existing = editors.get(key(dir));
  if (existing && !existing.window.isDestroyed()) {
    if (!HIDDEN) existing.window.show();
    existing.window.focus();
    return existing.window;
  }
  const file = await openProjectFile(dir);
  const release = await lockProject(dir);
  const ses = session.fromPartition(`editor-${++partitions}`);
  lockDown(ses);
  serveApp(ses, bundlePath('renderer'));
  serveMedia(ses, dir);

  const area = screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({
    width: Math.min(1600, area.width),
    height: Math.min(1000, area.height),
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: `${file.dir.split(/[\\/]/).at(-1)} · Cuttle`,
    backgroundColor: BACKGROUND,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BACKGROUND, symbolColor: '#9a9aa5', height: 40 },
    icon: assetPath('icon.png'),
    webPreferences: webPreferences('editor.cjs', ses),
  });
  guard(window.webContents);
  const media = new ProjectMedia(dir, file.project, (state) => send(window.webContents, 'media:state', state));
  const editor: Editor = { window, media, release };
  editors.set(key(dir), editor);

  bindRequests(window.webContents, 'editor', {
    'project:info': () => projectInfo(file),
    'project:reveal': (path) => {
      const target = resolve(dir, path ?? PROJECT_FILE);
      if (!isInside(target, dir, process.platform)) throw new Error('only files inside the project can be shown');
      shell.showItemInFolder(target);
    },
    'media:state': () => media.current(),
    'export:start': ({ formats, encoder }) => {
      if (editor.run) throw new Error('an export is already running');
      const run = new ExportRun(dir, formats, encoder, (progress) => send(window.webContents, 'export:progress', progress));
      editor.run = run;
      void run.done.then((end: ExportEnd) => {
        editor.run = undefined;
        send(window.webContents, 'export:end', end);
      });
      return { out: join(dir, 'out') };
    },
    'export:cancel': () => editor.run?.cancel(),
  });

  window.on('closed', () => {
    editors.delete(key(dir));
    media.dispose();
    editor.run?.cancel();
    void release();
  });
  window.once('ready-to-show', () => {
    if (!HIDDEN) window.show();
  });
  // The end-to-end check asks for a hook to drive the player (CUTTLE_CHECK=1) and for frames from
  // the take itself rather than the proxy (CUTTLE_NO_PROXY=1), to compare them with the export's.
  const query = new URLSearchParams({ ...(process.env.CUTTLE_NO_PROXY === '1' && { proxy: 'off' }), ...(process.env.CUTTLE_CHECK === '1' && { check: '1' }) }).toString();
  await window.loadURL(`${APP_ORIGIN}/editor.html${query ? `?${query}` : ''}`);
  void media.start();
  void addRecent(dir);
  return window;
}

/** Opens a project, showing what went wrong in a dialog instead of throwing. */
export async function openEditorOrSay(dir: string): Promise<void> {
  try {
    await openEditor(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (HIDDEN) {
      console.error(`cannot open ${dir}: ${message}`);
      return;
    }
    await dialog.showMessageBox({ type: 'warning', title: 'Cuttle', message: `Cuttle cannot open ${dir}`, detail: message });
  }
}

/** Asks for a project folder and opens it. */
export async function chooseAndOpen(parent?: BrowserWindow): Promise<void> {
  const options = { title: 'Open a Cuttle project', properties: ['openDirectory'] as ('openDirectory')[], buttonLabel: 'Open' };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (!result.canceled && result.filePaths[0]) await openEditorOrSay(result.filePaths[0]);
}

let pill: BrowserWindow | undefined;
const PILL_SIZE = { width: 420, height: 64 };

/** The pill: a small launcher near the top of the primary display, kept out of every recording. */
export async function createPill(): Promise<BrowserWindow> {
  if (pill && !pill.isDestroyed()) return pill;
  const ses = session.fromPartition('pill');
  lockDown(ses);
  serveApp(ses, bundlePath('renderer'));
  const display = screen.getPrimaryDisplay();
  const saved = (await loadSettings()).pill[String(display.id)];
  const area = display.workArea;
  const window = new BrowserWindow({
    ...PILL_SIZE,
    x: saved?.x ?? Math.round(area.x + (area.width - PILL_SIZE.width) / 2),
    y: saved?.y ?? area.y + 24,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Cuttle',
    webPreferences: webPreferences('pill.cjs', ses),
  });
  guard(window.webContents);
  window.setContentProtection(true);
  window.setAlwaysOnTop(true, 'floating');
  bindRequests(window.webContents, 'pill', {
    'pill:recent': async () => (await loadSettings()).recent,
    'pill:open': async (target) => {
      if (target) await openEditorOrSay(target.dir);
      else await chooseAndOpen();
    },
    'pill:hide': () => window.hide(),
    'pill:menu': async () => {
      const recent = (await loadSettings()).recent;
      Menu.buildFromTemplate([
        ...(recent.length === 0
          ? [{ label: 'No recent projects', enabled: false }]
          : recent.map((entry) => ({ label: entry.name, sublabel: entry.dir, click: () => void openEditorOrSay(entry.dir) }))),
        { type: 'separator' },
        { label: 'Open folder…', click: () => void chooseAndOpen() },
      ]).popup({ window });
    },
  });
  window.on('moved', () => {
    const [x, y] = window.getPosition();
    const on = screen.getDisplayMatching(window.getBounds());
    void updateSettings((settings) => {
      settings.pill[String(on.id)] = { x: x!, y: y! };
    });
  });
  window.on('show', () => void loadSettings().then((settings) => send(window.webContents, 'pill:recent', settings.recent)));
  window.on('closed', () => (pill = undefined));
  await window.loadURL(`${APP_ORIGIN}/pill.html`);
  pill = window;
  return window;
}

export async function showPill(): Promise<void> {
  const window = await createPill();
  if (!HIDDEN) window.showInactive();
}
```

`apps/desktop/src/main/tray.ts`:

```ts
import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { Settings } from './settings';

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
      ? [{ label: 'No recent projects', enabled: false }]
      : recent.map((entry) => ({ label: entry.name, sublabel: entry.dir, click: () => actions.open(entry.dir) }))),
    { type: 'separator' },
    { label: 'Open folder…', click: () => actions.open() },
    { type: 'separator' },
    { label: 'Quit Cuttle', click: () => actions.quit() },
  ];
}

let tray: Tray | undefined;

export function createTray(icon: string, recent: Settings['recent'], actions: TrayActions): Tray {
  tray?.destroy();
  tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip(`Cuttle ${app.getVersion()}`);
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu(recent, actions)));
  tray.on('click', () => actions.showPill());
  return tray;
}

export function updateTray(recent: Settings['recent'], actions: TrayActions): void {
  tray?.setContextMenu(Menu.buildFromTemplate(trayMenu(recent, actions)));
}
```

`apps/desktop/src/main/index.ts`:

```ts
// The Cuttle app's main process: one instance, a tray icon and the pill; editors per project.
// `--open <folder>` (also from a second launch) opens a project. CUTTLE_HIDDEN=1 keeps every window
// hidden (the end-to-end check); CUTTLE_USER_DATA moves the settings.
import { resolve } from 'node:path';
import { app, Menu } from 'electron';
import { mediaWorker } from './media-service';
import { assetPath, registerSchemes } from './protocols';
import { loadSettings, onSettingsChange } from './settings';
import { createTray, updateTray, type TrayActions } from './tray';
import { HIDDEN, chooseAndOpen, createPill, openEditorOrSay, showPill } from './windows';

app.setName('Cuttle');
if (process.env.CUTTLE_USER_DATA) app.setPath('userData', resolve(process.env.CUTTLE_USER_DATA));

/** The folder after `--open` in `argv`, if any. */
function openArgument(argv: readonly string[]): string | undefined {
  const at = argv.indexOf('--open');
  return at >= 0 ? argv[at + 1] : undefined;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerSchemes();
  Menu.setApplicationMenu(null);

  const actions: TrayActions = {
    showPill: () => void showPill(),
    open: (dir) => void (dir ? openEditorOrSay(dir) : chooseAndOpen()),
    quit: () => app.quit(),
  };

  app.on('second-instance', (_event, argv) => {
    const dir = openArgument(argv);
    if (dir) void openEditorOrSay(dir);
    else void showPill();
  });

  // The app lives in the tray: closing the last editor does not quit it.
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => mediaWorker.stop());

  void app.whenReady().then(async () => {
    const settings = await loadSettings();
    if (!HIDDEN) createTray(assetPath(process.platform === 'win32' ? 'tray.png' : 'tray@2x.png'), settings.recent, actions);
    await createPill();
    const dir = openArgument(process.argv);
    if (dir) await openEditorOrSay(dir);
    else await showPill();
    onSettingsChange((latest) => updateTray(latest.recent, actions));
  });
}
```

- [ ] **Step 4: The preloads and the main bundle's config**

`apps/desktop/src/preload/bridge.ts`:

```ts
// The bridge a sandboxed preload exposes as `window.cuttle`: only its window's channels.
import { contextBridge, ipcRenderer } from 'electron';
import { WINDOW_CHANNELS, type WindowKind } from '../shared/channels';

export function exposeBridge(kind: WindowKind): void {
  const requests: readonly string[] = WINDOW_CHANNELS[kind].requests;
  const events: readonly string[] = WINDOW_CHANNELS[kind].events;
  contextBridge.exposeInMainWorld('cuttle', {
    invoke(channel: string, argument?: unknown): Promise<unknown> {
      if (!requests.includes(channel)) return Promise.reject(new Error(`unknown request ${channel}`));
      return ipcRenderer.invoke(channel, argument);
    },
    on(channel: string, listener: (payload: unknown) => void): () => void {
      if (!events.includes(channel)) throw new Error(`unknown event ${channel}`);
      const wrapped = (_event: unknown, payload: unknown) => listener(payload);
      ipcRenderer.on(channel, wrapped);
      return () => ipcRenderer.removeListener(channel, wrapped);
    },
  });
}
```

`apps/desktop/src/preload/editor.ts`:

```ts
import { exposeBridge } from './bridge';

exposeBridge('editor');
```

`apps/desktop/src/preload/pill.ts`:

```ts
import { exposeBridge } from './bridge';

exposeBridge('pill');
```

`apps/desktop/vite.main.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The main process and the media worker as self-contained ES modules in dist/main/ (workspace
// packages ship TypeScript, so they are bundled; Electron and the native modules stay external).
// The export page goes to dist/main/export-page/, where @cuttle/export finds it next to its chunk.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'warn',
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    outDir: 'dist/main',
    emptyOutDir: true,
    minify: false,
    target: 'node22',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
        'media-worker': fileURLToPath(new URL('./src/workers/media.ts', import.meta.url)),
      },
      external: ['electron', 'koffi', 'uiohook-napi'],
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
    },
  },
});
```

- [ ] **Step 5: The icons**

`tools/desktop-icons.mjs`:

```js
// Draws the app's icons (Cuttle's mark: an orange tile with a dark arrow) into apps/desktop/assets/:
// icon.png (256), icon.ico (16–256), tray.png (16) and tray@2x.png (32). No image library: a small
// rasterizer with 4×4 supersampling and a PNG encoder on zlib.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../apps/desktop/assets/', import.meta.url);
const TOP_LEFT = [0xf0, 0x95, 0x6f];
const BOTTOM_RIGHT = [0xc4, 0x5a, 0x3f];
const ARROW = [0x1b, 0x0f, 0x0a];
/** The arrow in a 12-unit box: M2 2h5l3 4-3 4H2z. */
const POLYGON = [[2, 2], [7, 2], [10, 6], [7, 10], [2, 10]];

function insideRoundedSquare(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function insidePolygon(x, y) {
  let inside = false;
  for (let i = 0, j = POLYGON.length - 1; i < POLYGON.length; j = i++) {
    const [xi, yi] = POLYGON[i];
    const [xj, yj] = POLYGON[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size * 0.24;
  const arrow = size * 0.58;
  const offset = (size - arrow) / 2;
  const samples = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tile = 0;
      let dark = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = px + (sx + 0.5) / samples;
          const y = py + (sy + 0.5) / samples;
          if (!insideRoundedSquare(x, y, size, radius)) continue;
          tile++;
          if (insidePolygon(((x - offset) / arrow) * 12, ((y - offset) / arrow) * 12)) dark++;
        }
      }
      const n = samples * samples;
      const g = (px + py) / (2 * size);
      const base = TOP_LEFT.map((c, i) => c + (BOTTOM_RIGHT[i] - c) * g);
      const mix = tile === 0 ? 0 : dark / tile;
      const color = base.map((c, i) => Math.round(c + (ARROW[i] - c) * mix));
      const at = (py * size + px) * 4;
      pixels[at] = color[0];
      pixels[at + 1] = color[1];
      pixels[at + 2] = color[2];
      pixels[at + 3] = Math.round((tile / n) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(size) {
  const pixels = draw(size);
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(sizes) {
  const images = sizes.map(png);
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i;
    header[entry] = size >= 256 ? 0 : size;
    header[entry + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('icon.png', OUT), png(256));
writeFileSync(new URL('icon.ico', OUT), ico([16, 24, 32, 48, 64, 128, 256]));
writeFileSync(new URL('tray.png', OUT), png(16));
writeFileSync(new URL('tray@2x.png', OUT), png(32));
console.log('wrote apps/desktop/assets: icon.png, icon.ico, tray.png, tray@2x.png');
```

Run: `node tools/desktop-icons.mjs`
Expected: `wrote apps/desktop/assets: icon.png, icon.ico, tray.png, tray@2x.png`. Read `apps/desktop/assets/icon.png`: an orange tile with rounded corners, lighter at the top left, and a dark arrow pointing right.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0, no output.

```bash
git add apps/desktop tools/desktop-icons.mjs
git commit -m "desktop: main process (protocols per window, IPC per webContents, project lock, settings, tray, pill and editor windows), media worker and preloads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The editor and the pill

**Files:**
- Create: `apps/desktop/src/renderer/**`, `apps/desktop/vite.renderer.config.ts`, `apps/desktop/scripts/build.mjs`
- Modify: `package.json`

- [ ] **Step 1: Styles, icons and the bridge**

`apps/desktop/src/renderer/tokens.css`:

```
/* Cuttle desktop: design tokens (see docs/design/desktop/tokens.css and the spec's "Design system") */
:root {
  /* surfaces, darkest first */
  --bg: #0c0c0f;
  --stage: #08080a;
  --panel: #131317;
  --raised: #1b1b21;
  --raised-hover: #22222a;
  --raised-active: #2b2b33;
  --overlay: rgba(19, 19, 23, 0.86);
  --line: rgba(255, 255, 255, 0.06);
  --line-strong: rgba(255, 255, 255, 0.12);

  /* text */
  --text: #ececf1;
  --muted: #9a9aa5;
  --faint: #62626c;

  /* one accent, used sparingly: the primary action, the playhead, the selection outline */
  --accent: #d97757;
  --accent-hover: #e2876a;
  --accent-text: #1b0f0a;
  --accent-soft: rgba(217, 119, 87, 0.14);

  /* item kinds */
  --zoom: #5aa2ff;
  --mask: #a77bff;
  --caption: #4fd1a1;
  --still: #3cc6c9;
  --card: #f2b34a;

  /* states */
  --recording: #ff4d4f;
  --danger: #ff6b6b;
  --ok: #4fd1a1;

  --font: 'Inter', 'Segoe UI', system-ui, sans-serif;
  --mono: 'Cascadia Mono', Consolas, monospace;
  --size-xs: 11px;
  --size-s: 12px;
  --size-m: 13px;
  --size-l: 15px;
  --size-xl: 20px;

  --radius-s: 6px;
  --radius-m: 9px;
  --radius-l: 14px;

  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --fast: 120ms;
  --normal: 200ms;
  --slow: 320ms;

  --shadow-float: 0 16px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06);
  --focus: 0 0 0 2px var(--accent);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --fast: 0ms;
    --normal: 0ms;
    --slow: 0ms;
  }
}
```

`apps/desktop/src/renderer/base.css`:

```
@import '@fontsource/inter/latin-400.css';
@import '@fontsource/inter/latin-500.css';
@import '@fontsource/inter/latin-600.css';
@import './tokens.css';

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background: var(--bg);
  color: var(--text);
  font: var(--size-m) / 1.4 var(--font);
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
  user-select: none;
  cursor: default;
}

svg {
  display: block;
  flex: none;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  cursor: default;
}

button:disabled {
  opacity: 0.4;
}

:focus {
  outline: none;
}

:focus-visible {
  box-shadow: var(--focus);
  border-radius: var(--radius-s);
}

input,
select {
  font: inherit;
  color: inherit;
}

kbd {
  font: 600 10px var(--font);
  color: var(--faint);
  background: var(--raised);
  padding: 1px 5px;
  border-radius: 4px;
}

.tabular {
  font-variant-numeric: tabular-nums;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

::-webkit-scrollbar-track {
  background: transparent;
}
```

`apps/desktop/src/renderer/icons.tsx`:

```
// Cuttle's icon set: 16 px, 1.6 px strokes, drawn for Cuttle.
import type { ReactElement, SVGProps } from 'react';

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'children'>;

function icon(paths: ReactElement, filled = false) {
  return function Icon({ size = 16, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

export const PlayIcon = icon(<path d="M4.5 2.8v10.4L13 8z" />, true);
export const PauseIcon = icon(
  <>
    <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
    <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
  </>,
  true,
);
export const ExportIcon = icon(<path d="M8 2v8.5M4.5 7 8 10.5 11.5 7M3 13.5h10" />);
export const UndoIcon = icon(<path d="M5 4 2 7l3 3M2.5 7H10a3.5 3.5 0 0 1 0 7H8" />);
export const RedoIcon = icon(<path d="m11 4 3 3-3 3M13.5 7H6a3.5 3.5 0 0 0 0 7h2" />);
export const SelectIcon = icon(<path d="M3.5 2.5 12 8l-3.7.9 2 4-1.6.8-2-4L4 12z" />);
export const ZoomIcon = icon(
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3M7 5v4M5 7h4" />
  </>,
);
export const MaskIcon = icon(
  <>
    <rect x="2" y="4" width="12" height="8" rx="1.5" />
    <path d="m2.5 11.5 11-7" />
  </>,
);
export const TextIcon = icon(<path d="M3 4V3h10v1M8 3v10M6 13h4" />);
export const SplitIcon = icon(
  <>
    <circle cx="4.5" cy="4.5" r="2" />
    <circle cx="4.5" cy="11.5" r="2" />
    <path d="M6.2 5.6 13.5 12M6.2 10.4 13.5 4" />
  </>,
);
export const FitIcon = icon(<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />);
export const FolderIcon = icon(<path d="M2 4.5h4l1.5 1.5H14v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />);
export const CloseIcon = icon(<path d="m4 4 8 8M12 4l-8 8" />);
export const CheckIcon = icon(<path d="m3 8.5 3 3 7-7" />);
export const FilmIcon = icon(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M5 3v10M11 3v10M2 6.5h3M2 9.5h3M11 6.5h3M11 9.5h3" />
  </>,
);
export const CardIcon = icon(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M5 7h6M6 9.5h4" />
  </>,
);
export const PageIcon = icon(<path d="M4 2h5.5L12 4.5V14H4zM9.5 2v2.5H12M6 7.5h4M6 10h4" />);
export const MicIcon = icon(
  <>
    <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" />
    <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
  </>,
);
export const WarningIcon = icon(<path d="M8 2.5 14 13H2zM8 6.5v3M8 11.2v.1" />);
export const RecordIcon = icon(<circle cx="8" cy="8" r="5" />, true);
export const ChevronIcon = icon(<path d="m4.5 6 3.5 3.5L11.5 6" />);

/** Cuttle's mark: an orange tile with a dark arrow. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <span className="mark" style={{ width: size, height: size, borderRadius: size * 0.32 }} aria-hidden="true">
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 12 12">
        <path d="M2 2h5l3 4-3 4H2z" fill="#1b0f0a" />
      </svg>
    </span>
  );
}
```

`apps/desktop/src/renderer/bridge.ts`:

```ts
import type { Bridge } from '../shared/ipc';

declare global {
  interface Window {
    cuttle: Bridge;
  }
}

/** The preload's bridge to the main process (`window.cuttle`). */
export const bridge: Bridge = window.cuttle;
```

- [ ] **Step 2: Media, frames, audio and the player**

`apps/desktop/src/renderer/editor/media.ts`:

```ts
// The project's media in the editor, read through the cuttle-media protocol (Range requests).
import { ALL_FORMATS, Input, UrlSource, type InputAudioTrack, type InputVideoTrack, type VideoSinkDecoderOptions } from 'mediabunny';
import { createCursorTrack, type CursorTrack } from '@cuttle/timeline';
import { parseEventsJsonl, parseMarkersJson, parseProject, type CuttleProject, type InputEvent, type Marker } from '@cuttle/project';
import { MEDIA_ORIGIN, type ProjectInfo } from '../../shared/ipc';

/** The protocol URL of a path inside the project (as cuttle.json writes it, forward or back slashes). */
export function mediaUrl(path: string): string {
  return `${MEDIA_ORIGIN}/${path.replaceAll('\\', '/').split('/').filter((part) => part !== '' && part !== '.').map(encodeURIComponent).join('/')}`;
}

export interface VideoSource {
  /** Project-relative path. */
  path: string;
  input: Input;
  track: InputVideoTrack;
  size: { width: number; height: number };
  /** Timestamp of the first frame and the end of the last one, in seconds. */
  start: number;
  end: number;
  decoder: VideoSinkDecoderOptions;
}

export interface AudioSource {
  input: Input;
  track: InputAudioTrack;
  /** Seconds after the screen track that it started. */
  offset: number;
}

/** A problem with the project or one of its files, said for people. */
export class MediaError extends Error {}

/**
 * Decoder options for a track: software first (it decodes faster here and leaves the GPU's video
 * engine to the export), any decoder when only a hardware one handles the codec.
 */
async function decoderFor(track: InputVideoTrack): Promise<VideoSinkDecoderOptions | undefined> {
  const config = await track.getDecoderConfig();
  if (!config) return undefined;
  for (const hardwareAcceleration of ['prefer-software', 'no-preference'] as const) {
    if ((await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration })).supported) return { hardwareAcceleration };
  }
  return undefined;
}

export async function openVideo(path: string, what: string): Promise<VideoSource> {
  const input = new Input({ source: new UrlSource(mediaUrl(path)), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new MediaError(`${what} has no video track (${path})`);
    const decoder = await decoderFor(track);
    if (!decoder) throw new MediaError(`${what} uses a codec Cuttle cannot decode (${await track.getCodecParameterString()})`);
    const size = { width: await track.getDisplayWidth(), height: await track.getDisplayHeight() };
    if (!(size.width > 0 && size.height > 0)) throw new MediaError(`${what} does not say its frame size; a take cut off by a crash needs "cuttle recover"`);
    const start = await input.getFirstTimestamp([track]);
    const end = await input.computeDuration([track]);
    if (!(end > start)) throw new MediaError(`${what} has no frames (${path})`);
    return { path, input, track, size, start, end, decoder };
  } catch (error) {
    input.dispose();
    if (error instanceof MediaError) throw error;
    throw new MediaError(`${what} cannot be read (${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function openAudio(path: string, offset: number): Promise<AudioSource | undefined> {
  const input = new Input({ source: new UrlSource(mediaUrl(path)), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return undefined;
    }
    return { input, track, offset };
  } catch {
    input.dispose();
    return undefined;
  }
}

async function fetchText(path: string): Promise<string | undefined> {
  const response = await fetch(mediaUrl(path)).catch(() => undefined);
  return response?.ok ? response.text() : undefined;
}

/** An image for the engine: premultiplied, not flipped, at most `maxSize` on its longer side. */
export async function loadImage(path: string, maxSize: number, what: string): Promise<ImageBitmap> {
  const response = await fetch(mediaUrl(path)).catch(() => undefined);
  if (!response?.ok) throw new MediaError(`${what} not found (${path})`);
  const blob = await response.blob();
  const options: ImageBitmapOptions = { premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, options);
  } catch {
    throw new MediaError(`${what} is not an image Cuttle can decode (${path})`);
  }
  const longer = Math.max(bitmap.width, bitmap.height);
  if (longer <= maxSize) return bitmap;
  const scale = maxSize / longer;
  const resizeWidth = Math.max(1, Math.floor(bitmap.width * scale));
  const resizeHeight = Math.max(1, Math.floor(bitmap.height * scale));
  bitmap.close();
  return createImageBitmap(blob, { ...options, resizeWidth, resizeHeight, resizeQuality: 'high' });
}

/** Everything the editor shows of a project, opened once. */
export interface EditorMedia {
  project: CuttleProject;
  screen: VideoSource;
  webcam?: VideoSource & { offset: number };
  mic?: AudioSource;
  events: InputEvent[];
  cursor?: CursorTrack;
  markers: Marker[];
  stills: Map<number, ImageBitmap>;
  backgroundImage?: ImageBitmap;
  /** Things that work without, said for people (a missing webcam file, unreadable events). */
  warnings: string[];
}

/** Larger images are scaled down: textures of 8192 px work on every GPU Cuttle runs on. */
const MAX_IMAGE = 8192;

export async function openProjectMedia(info: ProjectInfo): Promise<EditorMedia> {
  const parsed = parseProject(info.raw);
  if (!parsed.ok) throw new MediaError(`cuttle.json is not valid:\n${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n')}`);
  const project = parsed.project;
  const { sources, look } = project;
  const warnings: string[] = [];
  const screen = await openVideo(sources.screen, 'The screen recording');

  let webcam: EditorMedia['webcam'];
  if (sources.webcam && look.webcam.enabled) {
    try {
      webcam = { ...(await openVideo(sources.webcam, 'The webcam recording')), offset: info.offsets.webcam };
    } catch (error) {
      warnings.push((error as Error).message);
    }
  }
  const mic = sources.mic && look.audio.enabled ? await openAudio(sources.mic, info.offsets.mic) : undefined;
  if (sources.mic && look.audio.enabled && !mic) warnings.push(`The mic recording cannot be played (${sources.mic})`);

  let events: InputEvent[] = [];
  if (sources.events) {
    const text = await fetchText(sources.events);
    if (text === undefined) warnings.push(`${sources.events} cannot be read: no cursor or input activity`);
    else events = parseEventsJsonl(text).events;
  }
  const cursor = look.cursor.enabled && events.length > 0 ? createCursorTrack(events) : undefined;
  let markers: Marker[] = [];
  if (sources.markers) {
    const parsedMarkers = parseMarkersJson((await fetchText(sources.markers)) ?? '');
    if (parsedMarkers.ok) markers = parsedMarkers.markers;
  }

  const stills = new Map<number, ImageBitmap>();
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type === 'still') stills.set(index, await loadImage(scene.image, MAX_IMAGE, `The image of scene ${index + 1}`));
  }
  const backgroundImage =
    look.background.preset === 'image' && look.background.image ? await loadImage(look.background.image, MAX_IMAGE, 'The background image') : undefined;
  return { project, screen, ...(webcam && { webcam }), ...(mic && { mic }), events, ...(cursor && { cursor }), markers, stills, ...(backgroundImage && { backgroundImage }), warnings };
}
```

`apps/desktop/src/renderer/editor/frames.ts`:

```ts
// Frames of the screen and webcam tracks for the player: single frames for scrubbing (the latest
// request wins) and decoders running ahead of the playhead for playback.
import { EncodedPacketSink, VideoSampleSink } from 'mediabunny';
import { TrackReader } from '@cuttle/export/track-reader';
import type { FramePlan, ScenePlan } from '@cuttle/export/frame-plan';
import type { FrameSources } from '@cuttle/engine';
import type { RenderState } from '@cuttle/timeline';
import type { VideoSource } from './media';

/** Above this speed, playback from the proxy shows its key frames only (every 0.5 s of the take). */
export const KEYFRAMES_ONLY_ABOVE = 6;

/** A frame for the engine, closed after it was drawn. */
export interface HeldFrame {
  frame: VideoFrame;
  close(): void;
}

/**
 * One frame at a time from a video, for scrubbing: while one decode runs, newer requests replace
 * each other, and only the newest is decoded next; older callers get `undefined`.
 */
export class FrameGrabber {
  private readonly sink: VideoSampleSink;
  private running: Promise<void> | undefined;
  private queued: { time: number; resolve: (frame: HeldFrame | undefined) => void } | undefined;

  constructor(readonly source: VideoSource) {
    this.sink = new VideoSampleSink(source.track, source.decoder);
  }

  grab(time: number): Promise<HeldFrame | undefined> {
    return new Promise((resolve) => {
      this.queued?.resolve(undefined);
      this.queued = { time, resolve };
      if (!this.running) this.running = this.drain();
    });
  }

  private async drain(): Promise<void> {
    while (this.queued) {
      const { time, resolve } = this.queued;
      this.queued = undefined;
      try {
        const sample = await this.sink.getSample(Math.max(time, this.source.start));
        if (!sample) {
          resolve(undefined);
          continue;
        }
        const frame = sample.toVideoFrame();
        sample.close();
        // A newer request came in while this one decoded: hand it nothing, the newer one draws.
        if (this.queued) {
          frame.close();
          resolve(undefined);
        } else resolve({ frame, close: () => frame.close() });
      } catch {
        resolve(undefined);
      }
    }
    this.running = undefined;
  }
}

/** The key frames of a video (the proxy has one every 0.5 s), looked up from its sample table. */
export class KeyFrames {
  private readonly sink: EncodedPacketSink;
  private readonly cache = new Map<number, number>();

  constructor(private readonly source: VideoSource) {
    this.sink = new EncodedPacketSink(source.track);
  }

  /** The timestamp of the key frame at or before `time`. */
  async at(time: number): Promise<number> {
    const key = Math.round(time * 1000);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const packet = await this.sink.getKeyPacket(Math.max(time, this.source.start), { metadataOnly: true });
    const found = packet ? packet.timestamp : time;
    this.cache.set(key, found);
    return found;
  }
}

export interface PlaybackVideo {
  screen: VideoSource;
  /** The proxy's key frames, when the screen is the proxy: speeds above 6× show only those. */
  keyFrames?: KeyFrames;
  webcam?: VideoSource & { offset: number };
}

interface OpenScene {
  plan: ScenePlan;
  screen?: TrackReader;
  webcam?: TrackReader;
  /** Planned source time → the screen time to read (a key frame above 6×). */
  screenTimes?: Map<number, number>;
}

/**
 * Decoders for playing from a frame on, as the export runs them: each scene's readers open
 * `lookahead` frames before it shows and decode its planned times in the background; they close
 * after its last frame.
 */
export class PlaybackFrames {
  private readonly open = new Map<number, OpenScene>();
  private readonly pending: ScenePlan[];
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };

  constructor(
    plan: FramePlan,
    private readonly video: PlaybackVideo,
    private readonly stills: ReadonlyMap<number, ImageBitmap>,
    private readonly lookahead: number,
  ) {
    this.pending = [...plan.scenes].sort((a, b) => a.firstFrame - b.firstFrame);
  }

  private webcamTime(sourceTime: number): number | undefined {
    const webcam = this.video.webcam;
    if (!webcam) return undefined;
    const time = sourceTime - webcam.offset;
    return time >= webcam.start && time < webcam.end ? time : undefined;
  }

  private async openScene(plan: ScenePlan, speed: number): Promise<OpenScene> {
    if (plan.kind !== 'clip') return { plan };
    const { screen, keyFrames, webcam } = this.video;
    const screenTimes = new Map<number, number>();
    for (const time of plan.sourceTimes) {
      const clamped = Math.max(time, screen.start);
      screenTimes.set(time, keyFrames && speed > KEYFRAMES_ONLY_ABOVE ? await keyFrames.at(clamped) : clamped);
    }
    const times = [...new Set(screenTimes.values())].sort((a, b) => a - b);
    const webcamTimes = plan.sourceTimes.map((t) => this.webcamTime(t)).filter((t): t is number => t !== undefined);
    return {
      plan,
      screenTimes,
      screen: new TrackReader(screen.track, times, screen.decoder),
      webcam: webcam && webcamTimes.length > 0 ? new TrackReader(webcam.track, webcamTimes, webcam.decoder) : undefined,
    };
  }

  /** The frames of every layer of `state`, output frame `frame`; `speedOf` gives a scene's speed. */
  async sourcesFor(frame: number, state: RenderState, speedOf: (index: number) => number): Promise<FrameSources | undefined> {
    while (this.pending.length > 0 && this.pending[0]!.firstFrame <= frame + this.lookahead) {
      const plan = this.pending.shift()!;
      this.open.set(plan.index, await this.openScene(plan, speedOf(plan.index)));
    }
    const { screens, webcams, stills } = this.sources;
    screens.clear();
    webcams.clear();
    stills.clear();
    for (const layer of state.layers) {
      if (layer.kind === 'still') {
        const image = this.stills.get(layer.index);
        if (!image) return undefined;
        stills.set(layer.index, image);
        continue;
      }
      if (layer.kind !== 'clip' || layer.sourceTime === undefined) continue;
      const scene = this.open.get(layer.index);
      const time = scene?.screenTimes?.get(layer.sourceTime);
      if (!scene?.screen || time === undefined) return undefined;
      const screenFrame = await scene.screen.frameAt(time);
      if (!screenFrame) return undefined;
      screens.set(layer.index, screenFrame);
      const webcamTime = this.webcamTime(layer.sourceTime);
      const webcamFrame = webcamTime === undefined ? undefined : await scene.webcam?.frameAt(webcamTime);
      if (webcamFrame) webcams.set(layer.index, webcamFrame);
    }
    return this.sources;
  }

  /** Closes the scenes whose last frame was `frame` or earlier. */
  async release(frame: number): Promise<void> {
    for (const [index, scene] of this.open) {
      if (scene.plan.lastFrame > frame) continue;
      this.open.delete(index);
      await closeScene(scene);
    }
  }

  async close(): Promise<void> {
    const scenes = [...this.open.values()];
    this.open.clear();
    this.pending.length = 0;
    await Promise.allSettled(scenes.map(closeScene));
  }
}

async function closeScene(scene: OpenScene): Promise<void> {
  await scene.screen?.close();
  await scene.webcam?.close();
}
```

`apps/desktop/src/renderer/editor/audio.ts`:

```ts
// The mic in the preview: decoded in chunks a few seconds ahead of the playhead and scheduled on the
// AudioContext, whose clock the video follows.
import { AudioBufferSink } from 'mediabunny';
import type { CuttleProject } from '@cuttle/project';
import { isContinuousCut, type SceneSpan } from '@cuttle/timeline';
import type { AudioSource } from './media';

/** Audio is scheduled this far ahead of the clock. */
const AHEAD_SECONDS = 2.5;
/** Short fades at the edges of each clip's sound, against clicks. */
const EDGE_FADE = 0.008;

/** Whether the export plays a clip's sound (`look.audio`: on, and sped-up clips muted unless asked). */
export function audible(project: CuttleProject, speed: number): boolean {
  return project.look.audio.enabled && !(project.look.audio.muteSpedUp && speed > 1);
}

/**
 * Plays the clips' sound from output time `from`: each audible clip's stretch of the mic, at the
 * clip's speed (the preview's pitch changes with it; the export keeps the pitch with atempo).
 * `contextStart` is the AudioContext time at which output time `from` plays.
 */
export class AudioSchedule {
  private readonly nodes = new Set<AudioScheduledSourceNode>();
  private stopped = false;
  private readonly done: Promise<void>;

  constructor(
    private readonly context: AudioContext,
    private readonly mic: AudioSource,
    private readonly project: CuttleProject,
    private readonly spans: readonly SceneSpan[],
    private readonly from: number,
    private readonly contextStart: number,
  ) {
    this.done = this.run().catch(() => {});
  }

  /** The AudioContext time at which output time `t` plays. */
  private when(t: number): number {
    return this.contextStart + (t - this.from);
  }

  private async waitUntil(contextTime: number): Promise<void> {
    while (!this.stopped && contextTime - this.context.currentTime > AHEAD_SECONDS) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Whether the sound runs on from span `a` into span `b` (a continuous cut, both heard at one speed): no fade there. */
  private runsOn(a: SceneSpan | undefined, b: SceneSpan | undefined): boolean {
    if (!a || !b || a.scene.type !== 'clip' || b.scene.type !== 'clip' || !isContinuousCut(a.scene, b.scene)) return false;
    return a.scene.speed === b.scene.speed && audible(this.project, a.scene.speed);
  }

  private async run(): Promise<void> {
    for (const [i, span] of this.spans.entries()) {
      if (this.stopped) return;
      const scene = span.scene;
      if (span.end <= this.from || scene.type !== 'clip' || !audible(this.project, scene.speed)) continue;
      const outStart = Math.max(span.start, this.from);
      await this.waitUntil(this.when(outStart));
      if (this.stopped) return;
      // Mic seconds of this clip's stretch from outStart on.
      const sourceStart = scene.from + (outStart - span.start) * scene.speed;
      const micStart = sourceStart - this.mic.offset;
      const micEnd = scene.to - this.mic.offset;
      if (micEnd <= 0) continue;
      const gain = this.context.createGain();
      gain.connect(this.context.destination);
      const fadeIn = this.when(outStart);
      const fadeOut = this.when(span.end);
      const start = Math.max(this.context.currentTime, fadeIn);
      const fadesIn = outStart > span.start || !this.runsOn(this.spans[i - 1], span);
      gain.gain.setValueAtTime(fadesIn ? 0 : 1, start);
      if (fadesIn) gain.gain.linearRampToValueAtTime(1, start + EDGE_FADE);
      if (!this.runsOn(span, this.spans[i + 1])) {
        gain.gain.setValueAtTime(1, Math.max(start + EDGE_FADE, fadeOut - EDGE_FADE));
        gain.gain.linearRampToValueAtTime(0, fadeOut);
      }
      const sink = new AudioBufferSink(this.mic.track);
      for await (const { buffer, timestamp, duration } of sink.buffers(Math.max(0, micStart), micEnd)) {
        if (this.stopped) return;
        // This buffer's mic seconds, cut to the clip's stretch.
        const playFrom = Math.max(timestamp, micStart);
        const playTo = Math.min(timestamp + duration, micEnd);
        if (playTo <= playFrom) continue;
        const out = span.start + (playFrom + this.mic.offset - scene.from) / scene.speed;
        const at = this.when(out);
        await this.waitUntil(at);
        if (this.stopped) return;
        const node = this.context.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = scene.speed;
        node.connect(gain);
        const now = this.context.currentTime;
        // A chunk whose start already passed plays from where the clock is.
        const late = Math.max(0, now - at) * scene.speed;
        const offset = playFrom - timestamp + late;
        const length = playTo - playFrom - late;
        if (length <= 0) continue;
        node.start(Math.max(now, at), offset, length);
        this.nodes.add(node);
        node.onended = () => this.nodes.delete(node);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        // never started
      }
    }
    this.nodes.clear();
  }

  finished(): Promise<void> {
    return this.done;
  }
}
```

`apps/desktop/src/renderer/editor/player.ts`:

```ts
// The editor's output view: the export's engine drawing the export's timeline into a canvas, played
// with the mic as the clock (video follows the audio and drops frames rather than drifting) and
// scrubbed one frame at a time.
import { createRenderer, type EngineAssets, type FrameSources, type Renderer } from '@cuttle/engine';
import { planStills } from '@cuttle/export/frame-plan';
import type { CuttleProject } from '@cuttle/project';
import { createTimeline, type RenderState, type Timeline } from '@cuttle/timeline';
import { AudioSchedule } from './audio';
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
import type { EditorMedia, VideoSource } from './media';

export interface PlayerState {
  /** Output seconds of the frame on screen. */
  t: number;
  playing: boolean;
  /** The source second of the most visible clip, when one shows. */
  source?: number;
  /** Set when a frame could not be drawn, said for people. */
  error?: string;
}

/** Frames the playback decoders open before a scene shows. */
const LOOKAHEAD_FRAMES = 20;
/** Playback this far behind the clock restarts its decoders at the clock (frames are dropped). */
const BEHIND_SECONDS = 0.5;

/** What playback did, for the check: frames drawn, decoder restarts at the clock (frames dropped), the clock. */
export interface PlaybackStats {
  drawn: number;
  restarts: number;
  /** The clock's output time (where the sound is), while playing. */
  clock: number;
}

export interface PlayerOptions {
  canvas: HTMLCanvasElement;
  media: EditorMedia;
  assets: EngineAssets;
  /** The project as shown (the editor may preview another output format than the file's). */
  project: CuttleProject;
  onChange: (state: PlayerState) => void;
}

export class Player {
  private project: CuttleProject;
  private timeline: Timeline;
  private renderer: Renderer;
  private readonly media: EditorMedia;
  private readonly canvas: HTMLCanvasElement;
  private readonly assets: EngineAssets;
  private readonly onChange: (state: PlayerState) => void;
  private state: PlayerState = { t: 0, playing: false };
  private screen: VideoSource;
  private keyFrames: KeyFrames | undefined;
  private screenGrabber: FrameGrabber;
  private readonly webcamGrabber: FrameGrabber | undefined;
  private seekToken = 0;
  private playToken = 0;
  private context: AudioContext | undefined;
  private audio: AudioSchedule | undefined;
  private disposed = false;
  private readonly playback: PlaybackStats = { drawn: 0, restarts: 0, clock: 0 };
  private clockNow: (() => number) | undefined;

  constructor(options: PlayerOptions) {
    this.media = options.media;
    this.canvas = options.canvas;
    this.assets = options.assets;
    this.onChange = options.onChange;
    this.project = options.project;
    this.screen = this.media.screen;
    this.screenGrabber = new FrameGrabber(this.screen);
    this.webcamGrabber = this.media.webcam ? new FrameGrabber(this.media.webcam) : undefined;
    this.timeline = this.makeTimeline();
    this.renderer = this.makeRenderer();
  }

  get duration(): number {
    return this.timeline.duration;
  }

  get fps(): number {
    return this.project.output.fps;
  }

  get spans() {
    return this.timeline.spans;
  }

  current(): PlayerState {
    return this.state;
  }

  /** Playback counters since the last play, and the clock's time while playing. */
  stats(): PlaybackStats {
    return { ...this.playback, clock: this.clockNow?.() ?? this.state.t };
  }

  private makeTimeline(): Timeline {
    return createTimeline(this.project, { screenSize: this.media.screen.size, ...(this.media.cursor && { cursor: this.media.cursor }) });
  }

  private makeRenderer(): Renderer {
    return createRenderer(this.canvas, this.project, {
      assets: this.assets,
      screenSize: this.media.screen.size,
      ...(this.media.backgroundImage && { backgroundImage: this.media.backgroundImage }),
    });
  }

  private set(change: Partial<PlayerState>): void {
    this.state = { ...this.state, ...change };
    this.onChange(this.state);
  }

  /** Shows another version of the project (another output format); keeps the playhead. */
  setProject(project: CuttleProject): void {
    const playing = this.state.playing;
    this.pause();
    this.renderer.dispose();
    this.project = project;
    this.timeline = this.makeTimeline();
    this.renderer = this.makeRenderer();
    void this.seek(Math.min(this.state.t, this.timeline.duration));
    if (playing) this.play();
  }

  /**
   * Plays and scrubs the proxy (720p, a key frame every 0.5 s) instead of the take. The engine
   * places the frame by the take's size, so a smaller frame shows the same picture.
   */
  useProxy(proxy: VideoSource): void {
    const playing = this.state.playing;
    this.pause();
    this.screen = proxy;
    this.keyFrames = new KeyFrames(proxy);
    this.screenGrabber = new FrameGrabber(proxy);
    if (playing) this.play();
    else void this.seek(this.state.t);
  }

  /** The output frame number of a time. */
  frameOf(t: number): number {
    return Math.max(0, Math.min(Math.floor(t * this.fps + 1e-6), Math.ceil(this.duration * this.fps - 1e-6) - 1));
  }

  private sourceOf(state: RenderState): number | undefined {
    const most = Math.max(...state.layers.map((layer) => layer.opacity));
    return state.layers.filter((layer) => layer.opacity >= most - 1e-9).at(-1)?.sourceTime;
  }

  private draw(state: RenderState, sources: FrameSources): boolean {
    try {
      this.renderer.render(state, sources);
      return true;
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /** Shows the frame at output time `t` (paused); a newer seek wins over one still decoding. */
  async seek(t: number): Promise<void> {
    if (this.disposed) return;
    if (this.state.playing) this.pause();
    const token = ++this.seekToken;
    const time = Math.max(0, Math.min(t, this.duration));
    const frame = this.frameOf(time);
    const state = this.timeline.frameAt(frame / this.fps);
    const held: HeldFrame[] = [];
    const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };
    try {
      for (const layer of state.layers) {
        if (layer.kind === 'still') {
          const image = this.media.stills.get(layer.index);
          if (image) sources.stills.set(layer.index, image);
          continue;
        }
        if (layer.kind !== 'clip' || layer.sourceTime === undefined) continue;
        const screen = await this.screenGrabber.grab(layer.sourceTime);
        if (!screen || token !== this.seekToken) {
          screen?.close();
          return;
        }
        held.push(screen);
        sources.screens.set(layer.index, screen.frame);
        const webcam = this.media.webcam;
        if (webcam && this.webcamGrabber) {
          const webcamTime = layer.sourceTime - webcam.offset;
          if (webcamTime >= webcam.start && webcamTime < webcam.end) {
            const frameOfWebcam = await this.webcamGrabber.grab(webcamTime);
            if (token !== this.seekToken) {
              frameOfWebcam?.close();
              return;
            }
            if (frameOfWebcam) {
              held.push(frameOfWebcam);
              sources.webcams.set(layer.index, frameOfWebcam.frame);
            }
          }
        }
      }
      if (token !== this.seekToken || this.disposed) return;
      if (this.draw(state, sources)) this.set({ t: time, source: this.sourceOf(state), error: undefined });
    } finally {
      for (const frame of held) frame.close();
    }
  }

  /** Plays from the playhead (from the start when it is at the end). */
  play(): void {
    if (this.disposed || this.state.playing) return;
    const from = this.state.t >= this.duration - 1 / this.fps ? 0 : this.state.t;
    this.seekToken++;
    const token = ++this.playToken;
    this.context ??= new AudioContext({ latencyHint: 'playback' });
    void this.context.resume();
    this.set({ playing: true, t: from });
    void this.run(token, from);
  }

  pause(): void {
    if (!this.state.playing) return;
    this.playToken++;
    this.audio?.stop();
    this.audio = undefined;
    this.set({ playing: false });
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  /** One playback run from output time `from` until the end, a pause or a restart. */
  private async run(token: number, from: number): Promise<void> {
    const context = this.context!;
    const fps = this.fps;
    const last = this.frameOf(this.duration);
    let startFrame = this.frameOf(from);
    // The clock: output time = from + (context time − contextStart).
    const contextStart = context.currentTime + 0.12;
    const clock = () => from + Math.max(0, context.currentTime - contextStart);
    this.clockNow = clock;
    this.playback.drawn = 0;
    this.playback.restarts = 0;
    if (this.media.mic) this.audio = new AudioSchedule(context, this.media.mic, this.project, this.timeline.spans, from, contextStart);

    const video: PlaybackVideo = {
      screen: this.screen,
      ...(this.keyFrames && { keyFrames: this.keyFrames }),
      ...(this.media.webcam && { webcam: this.media.webcam }),
    };
    const speedOf = (index: number) => {
      const scene = this.timeline.spans[index]?.scene;
      return scene?.type === 'clip' ? scene.speed : 1;
    };
    const open = (frame: number) => {
      const frames = Array.from({ length: last - frame + 1 }, (_, i) => frame + i);
      return new PlaybackFrames(planStills(this.timeline, fps, frames), video, this.media.stills, LOOKAHEAD_FRAMES);
    };
    let frames = open(startFrame);
    let shown = startFrame - 1;
    try {
      while (token === this.playToken && !this.disposed) {
        const now = clock();
        if (now >= this.duration) break;
        const wanted = this.frameOf(now);
        if (wanted - shown > BEHIND_SECONDS * fps) {
          // Decoding fell behind: drop the frames in between and start again at the clock.
          await frames.close();
          this.playback.restarts++;
          startFrame = wanted;
          frames = open(startFrame);
          shown = wanted - 1;
        }
        if (wanted > shown) {
          const frame = Math.max(wanted, shown + 1);
          const state = this.timeline.frameAt(frame / fps);
          const sources = await frames.sourcesFor(frame, state, speedOf);
          if (token !== this.playToken || this.disposed) break;
          if (sources && this.draw(state, sources)) {
            this.playback.drawn++;
            this.set({ t: frame / fps, source: this.sourceOf(state) });
          }
          shown = frame;
          await frames.release(frame);
        }
        await nextTick();
      }
    } finally {
      await frames.close();
      if (token === this.playToken) {
        this.clockNow = undefined;
        this.audio?.stop();
        this.audio = undefined;
        this.set({ playing: false, t: Math.min(this.state.t, this.duration) });
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    this.renderer.dispose();
    void this.context?.close();
  }
}

/**
 * The next animation frame, or a timer a little longer than a frame, whichever comes first: a window
 * that is hidden, or never shown (the check), may count as visible and still get no animation frames.
 */
function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 20);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
```

- [ ] **Step 3: The editor's state and views**

`apps/desktop/src/renderer/editor/store.ts`:

```ts
// A tiny store: one state object, replaced on every change, read with useSyncExternalStore.
import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(change: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(change) {
      const next = typeof change === 'function' ? change(state) : change;
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The part of the store's state `select` picks; the component re-renders when it changes (by `Object.is`). */
export function useStore<T, S>(store: Store<T>, select: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
```

`apps/desktop/src/renderer/editor/session.ts`:

```ts
// The open project in an editor window: its media, the player, what is selected and the export.
import { loadEngineAssets } from '@cuttle/engine';
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject } from '@cuttle/project';
import type { ExportEnd, ExportProgress, MediaState, ProjectInfo } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { openProjectMedia, openVideo, type EditorMedia } from './media';
import { Player, type PlayerState } from './player';
import { createStore } from './store';

export type Selection = { kind: 'scene' | OverlayKind; index: number };

export interface EditorState {
  phase: 'loading' | 'ready' | 'failed';
  error?: string;
  info?: ProjectInfo;
  media?: EditorMedia;
  /** The output format the preview shows; undefined: the project's own output. */
  format?: ExportFormat;
  player: PlayerState;
  selection?: Selection;
  tab: 'selection' | 'look';
  mediaState: MediaState;
  exportOpen: boolean;
  exportProgress?: ExportProgress;
  exportEnd?: ExportEnd;
  exporting: boolean;
  /** Timeline scale; 0 until the timeline fits itself. */
  pxPerSecond: number;
}

export const store = createStore<EditorState>({
  phase: 'loading',
  player: { t: 0, playing: false },
  tab: 'selection',
  mediaState: { seq: -1, proxy: { state: 'none' }, thumbnails: { state: 'none' }, peaks: { state: 'none' } },
  exportOpen: false,
  exporting: false,
  pxPerSecond: 0,
});

let player: Player | undefined;

export function currentPlayer(): Player | undefined {
  return player;
}

let shown: { media: EditorMedia; format: ExportFormat | undefined; project: CuttleProject } | undefined;

/** The project as the preview shows it: the file's, or with the previewed output format (the same object until either changes). */
export function shownProject(state: EditorState = store.get()): CuttleProject | undefined {
  if (!state.media) return undefined;
  if (shown?.media !== state.media || shown.format !== state.format) shown = { media: state.media, format: state.format, project: withFormat(state.media.project, state.format) };
  return shown.project;
}

/** Opens the window's project: its media through the protocol, the engine's assets, the player. */
export async function openSession(canvas: HTMLCanvasElement): Promise<void> {
  try {
    const info = await bridge.invoke('project:info');
    document.title = `${info.name} · Cuttle`;
    const [media, assets] = await Promise.all([openProjectMedia(info), loadEngineAssets()]);
    player = new Player({
      canvas,
      media,
      assets,
      project: media.project,
      onChange: (state) => store.set({ player: state }),
    });
    store.set({ phase: 'ready', info, media });
    await player.seek(0);
    if (new URLSearchParams(location.search).get('check') === '1') exposeCheckHook(canvas);
    bridge.on('media:state', (state) => applyMediaState(state));
    applyMediaState(await bridge.invoke('media:state'));
    bridge.on('export:progress', (progress) => store.set({ exportProgress: progress }));
    bridge.on('export:end', (end) => store.set({ exportEnd: end, exporting: false }));
  } catch (error) {
    store.set({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}

/** What the end-to-end check drives and reads (only with `?check=1`). */
function exposeCheckHook(canvas: HTMLCanvasElement): void {
  Object.assign(window, {
    __cuttleCheck: {
      seek: (t: number) => player?.seek(t),
      playback: () => player?.stats(),
      state: () => ({ ...store.get().player, duration: player?.duration ?? 0, mediaState: store.get().mediaState }),
      pixels: () => canvas.toDataURL('image/png'),
    },
  });
}

let proxyInUse = false;

async function applyMediaState(state: MediaState): Promise<void> {
  if (state.seq < store.get().mediaState.seq) return;
  store.set({ mediaState: state });
  // Playback and scrubbing switch to the proxy once it is made. `?proxy=off` (CUTTLE_NO_PROXY=1)
  // lets the check compare the output view with the export's frames from the take itself.
  if (state.proxy.state === 'ready' && state.proxy.path && !proxyInUse && player && new URLSearchParams(location.search).get('proxy') !== 'off') {
    proxyInUse = true;
    try {
      player.useProxy(await openVideo(state.proxy.path, 'The proxy'));
    } catch {
      proxyInUse = false;
    }
  }
}

export function setFormat(format: ExportFormat | undefined): void {
  store.set({ format });
  const project = shownProject();
  if (project) player?.setProject(project);
}

export function select(selection: Selection | undefined): void {
  store.set({ selection, ...(selection && { tab: 'selection' as const }) });
}

export function openExport(): void {
  store.set({ exportOpen: true, ...(!store.get().exporting && { exportEnd: undefined, exportProgress: undefined }) });
}

export function closeExport(): void {
  store.set({ exportOpen: false });
}

export async function startExport(formats: ExportFormat[], encoder: 'auto' | 'hardware' | 'software'): Promise<void> {
  store.set({ exporting: true, exportEnd: undefined, exportProgress: undefined });
  try {
    await bridge.invoke('export:start', { formats, encoder });
  } catch (error) {
    store.set({ exporting: false, exportEnd: { state: 'failed', files: [], format: formats[0]!, code: 'internal', message: (error as Error).message } });
  }
}

export function cancelExport(): void {
  void bridge.invoke('export:cancel');
}
```

`apps/desktop/src/renderer/editor/App.tsx`:

```
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EXPORT_FORMATS, type ExportFormat } from '@cuttle/export/formats';
import { formatDuration, formatTime } from '../../shared/format';
import { ExportIcon, Mark, PauseIcon, PlayIcon, WarningIcon } from '../icons';
import { ExportSheet } from './ExportSheet';
import { Inspector } from './Inspector';
import { currentPlayer, openExport, openSession, setFormat, shownProject, store } from './session';
import { useStore } from './store';
import { Timeline } from './Timeline';

const FORMATS = Object.keys(EXPORT_FORMATS) as ExportFormat[];

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = useStore(store, (state) => state.phase);
  const error = useStore(store, (state) => state.error);

  useEffect(() => {
    if (canvas.current) void openSession(canvas.current);
  }, []);
  useShortcuts();

  if (phase === 'failed') {
    return (
      <div className="center">
        <div>
          <WarningIcon size={28} style={{ margin: '0 auto', color: 'var(--card)' }} />
          <h1>This project cannot be opened</h1>
          <pre>{error}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="app" data-phase={phase}>
      <TitleBar />
      <Stage canvas={canvas} />
      <Inspector />
      <Timeline />
      <ExportSheet />
      {phase === 'loading' && (
        <div className="scrim" style={{ inset: 0, background: 'var(--bg)', placeItems: 'center', padding: 0 }}>
          <div className="spinner" aria-label="Opening the project" />
        </div>
      )}
    </div>
  );
}

function TitleBar() {
  const info = useStore(store, (state) => state.info);
  const media = useStore(store, (state) => state.media);
  const format = useStore(store, (state) => state.format);
  const proxy = useStore(store, (state) => state.mediaState.proxy);
  const duration = currentPlayer()?.duration ?? 0;
  const output = media?.project.output;
  const own = FORMATS.find((name) => output && EXPORT_FORMATS[name].width === output.width && EXPORT_FORMATS[name].height === output.height);
  const recorded = media ? media.screen.end - media.screen.start : 0;
  return (
    <header className="titlebar">
      <Mark />
      <div className="project-name">
        <b>{info?.name ?? 'Cuttle'}</b>
        {media && (
          <span>
            {formatDuration(recorded)} recorded · {formatDuration(duration)} video
          </span>
        )}
      </div>
      <div className="grow" />
      {proxy.state === 'working' && (
        <div className="chip-status" title="A smaller copy of the take for smooth playback; the export always uses the take">
          Preparing playback
          <span className="bar">
            <i style={{ width: `${Math.round((proxy.progress ?? 0) * 100)}%` }} />
          </span>
        </div>
      )}
      <div className="seg" role="group" aria-label="Preview format">
        {!own && output && (
          <button aria-pressed={format === undefined} onClick={() => setFormat(undefined)} title="The project's own output size">
            {output.width}×{output.height}
          </button>
        )}
        {FORMATS.map((name) => (
          <button key={name} aria-pressed={format === name || (format === undefined && own === name)} onClick={() => setFormat(name === own ? undefined : name)} title={`Preview in ${name}`}>
            {name}
          </button>
        ))}
      </div>
      <button className="primary" onClick={openExport} disabled={!media} title="Export (Ctrl+E)">
        <ExportIcon size={14} />
        Export
      </button>
    </header>
  );
}

function Stage({ canvas }: { canvas: React.RefObject<HTMLCanvasElement | null> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const player = useStore(store, (state) => state.player);
  const media = useStore(store, (state) => state.media);
  const format = useStore(store, (state) => state.format);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const project = shownProject();
  const output = project?.output ?? { width: 1920, height: 1080 };

  // The canvas keeps the output's size (the engine draws at it); CSS fits it into the viewport.
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const fit = () => {
      const box = element.getBoundingClientRect();
      const scale = Math.min(box.width / output.width, box.height / output.height);
      setSize({ width: Math.floor(output.width * scale), height: Math.floor(output.height * scale) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [output.width, output.height, format]);

  const duration = currentPlayer()?.duration ?? 0;
  const warning = player.error ?? media?.warnings[0];
  return (
    <main className="stage">
      {warning && (
        <div className={`stage-note${player.error ? ' warn' : ''}`} title={warning}>
          <WarningIcon size={14} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{warning}</span>
        </div>
      )}
      <div className="viewport" ref={viewport}>
        <canvas ref={canvas} data-testid="output" style={{ width: size.width || undefined, height: size.height || undefined }} />
      </div>
      <div className="transport">
        <button className="play" onClick={() => currentPlayer()?.toggle()} aria-label={player.playing ? 'Pause (Space)' : 'Play (Space)'} title={player.playing ? 'Pause (Space)' : 'Play (Space)'}>
          {player.playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
        </button>
        <span className="time tabular" data-testid="time">
          <b>{formatTime(player.t)}</b> / {formatTime(duration)}
          {player.source !== undefined && <em>source {player.source.toFixed(1)} s</em>}
        </span>
      </div>
    </main>
  );
}

/** The editor's keys: Space, J/K/L, arrows (Shift: a second), Home/End, Ctrl+E. */
function useShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const player = currentPlayer();
      if (!player || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      const { t } = player.current();
      const frame = 1 / player.fps;
      const keys: Record<string, () => void> = {
        ' ': () => player.toggle(),
        k: () => player.pause(),
        l: () => player.play(),
        j: () => void player.seek(t - 1),
        ArrowLeft: () => void player.seek(t - (event.shiftKey ? 1 : frame)),
        ArrowRight: () => void player.seek(t + (event.shiftKey ? 1 : frame)),
        Home: () => void player.seek(0),
        End: () => void player.seek(player.duration),
        // Shift+Z: the whole video in the timeline
        z: () => event.shiftKey && store.set({ pxPerSecond: 0 }),
      };
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        openExport();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || store.get().exportOpen) return;
      const action = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
```

`apps/desktop/src/renderer/editor/Timeline.tsx`:

```
// The timeline (read-only in this version): markers, ruler, scenes with thumbnails, the overlay lanes
// (one block per stretch of output that shows an overlay), the mic's waveform and input activity.
// The playhead is dragged on the ruler and the lanes.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { MarkerKind } from '@cuttle/project';
import { formatTime } from '../../shared/format';
import { activityColumns, groupPins, timelineModel, waveformColumns, type OverlayKind, type Peaks, type SceneBlock } from '../../shared/timeline-model';
import { FitIcon } from '../icons';
import { audible } from './audio';
import { mediaUrl } from './media';
import { currentPlayer, select, shownProject, store, type Selection } from './session';
import { useStore } from './store';

const NAME_WIDTH = 88;
const END_SPACE = 40;
const ROWS = { markers: 26, ruler: 20, video: 52, zoom: 34, mask: 34, caption: 34, mic: 30, input: 26 } as const;
const LANES: { kind: OverlayKind; name: string }[] = [
  { kind: 'zoom', name: 'Zoom' },
  { kind: 'mask', name: 'Mask' },
  { kind: 'caption', name: 'Caption' },
];
const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MAX_PPS = 400;

const top = (row: keyof typeof ROWS) => {
  let y = 0;
  for (const key of Object.keys(ROWS) as (keyof typeof ROWS)[]) {
    if (key === row) return y;
    y += ROWS[key];
  }
  return y;
};

const MARKER_DOT: Record<MarkerKind, string> = { prompt: '#ececf1', tool: '#62626c', answer: '#4fd1a1', manual: '#9a9aa5' };

export function Timeline() {
  const scroller = useRef<HTMLDivElement>(null);
  const media = useStore(store, (state) => state.media);
  const format = useStore(store, (state) => state.format);
  const t = useStore(store, (state) => state.player.t);
  const playing = useStore(store, (state) => state.player.playing);
  const pps = useStore(store, (state) => state.pxPerSecond);
  const selection = useStore(store, (state) => state.selection);
  const mediaState = useStore(store, (state) => state.mediaState);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [peaks, setPeaks] = useState<Peaks>();

  const player = currentPlayer();
  const project = shownProject();
  const spans = player?.spans ?? [];
  const duration = player?.duration ?? 0;
  const model = useMemo(() => (project ? timelineModel(project, spans, media?.markers) : undefined), [project, spans, media, format]);

  const fit = useCallback(() => {
    const element = scroller.current;
    if (!element || !(duration > 0)) return;
    store.set({ pxPerSecond: Math.max(0.01, (element.clientWidth - END_SPACE - 8) / duration) });
    element.scrollLeft = 0;
  }, [duration]);

  useLayoutEffect(() => {
    if (pps === 0 && duration > 0) fit();
  }, [pps, duration, fit]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => setView({ left: element.scrollLeft, width: element.clientWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, []);

  // The mic's peaks, once the worker has made them.
  useEffect(() => {
    const ready = mediaState.peaks;
    if (ready.state !== 'ready' || !ready.path || !ready.rate || !media?.mic) return;
    let cancelled = false;
    void fetch(mediaUrl(ready.path))
      .then((response) => (response.ok ? response.arrayBuffer() : undefined))
      .then((buffer) => {
        if (!cancelled && buffer) setPeaks({ rate: ready.rate!, offset: media.mic!.offset, data: new Uint8Array(buffer) });
      });
    return () => {
      cancelled = true;
    };
  }, [mediaState.peaks, media]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !playing) return;
    const x = t * pps;
    if (x < element.scrollLeft || x > element.scrollLeft + element.clientWidth - 40) element.scrollLeft = Math.max(0, x - element.clientWidth / 3);
  }, [t, pps, playing]);

  const timeAt = (clientX: number) => {
    const element = scroller.current!;
    const box = element.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (clientX - box.left + element.scrollLeft) / pps));
  };

  const scrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !player) return;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // a synthetic pointer (the check) has nothing to capture
    }
    void player.seek(timeAt(event.clientX));
    const move = (moved: PointerEvent) => void player.seek(timeAt(moved.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const width = duration * pps;
  const height = Object.values(ROWS).reduce((sum, rowHeight) => sum + rowHeight, 0);
  const fitPps = scroller.current && duration > 0 ? (scroller.current.clientWidth - END_SPACE - 8) / duration : pps;
  const zoomValue = pps > 0 && fitPps > 0 ? Math.log(pps / fitPps) / Math.log(Math.max(1.0001, MAX_PPS / fitPps)) : 0;

  const cutOut = (kind: OverlayKind) => model?.lanes[kind].cutOut ?? 0;
  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tl-bar">
        <span className="tl-status">
          {model ? `${model.scenes.length} scene${model.scenes.length === 1 ? '' : 's'} · ${formatTime(duration)}` : ''}
        </span>
        <div className="grow" />
        <button className="act" onClick={fit} title="Fit the whole video (Shift+Z)">
          <FitIcon size={14} />
          Fit
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={Math.max(0, Math.min(1, zoomValue))}
          aria-label="Timeline scale"
          onChange={(event) => {
            const element = scroller.current;
            if (!element || !(fitPps > 0)) return;
            const next = fitPps * Math.pow(MAX_PPS / fitPps, Number(event.target.value));
            const anchor = t;
            store.set({ pxPerSecond: next });
            requestAnimationFrame(() => (element.scrollLeft = Math.max(0, anchor * next - element.clientWidth / 2)));
          }}
        />
      </div>
      <div className="tl-body">
        <div className="tl-names" aria-hidden="true">
          <div style={{ height: ROWS.markers }} />
          <div style={{ height: ROWS.ruler }} />
          <div style={{ height: ROWS.video }}>Video</div>
          {LANES.map((lane) => (
            <div key={lane.kind} style={{ height: ROWS[lane.kind] }}>
              {lane.name}
              {cutOut(lane.kind) > 0 && <small title="Not shown by any clip">· {cutOut(lane.kind)} cut out</small>}
            </div>
          ))}
          <div style={{ height: ROWS.mic }}>Mic</div>
          <div style={{ height: ROWS.input }}>Input</div>
        </div>
        <div className="tl-scroll" ref={scroller} data-testid="timeline">
          <div className="tl-content" style={{ width: width + END_SPACE, height }} onPointerDown={scrub}>
            {model && pps > 0 && (
              <>
                <Markers model={model} pps={pps} />
                <Ruler duration={duration} pps={pps} view={view} />
                <div className="tl-row" style={{ position: 'absolute', top: top('video'), height: ROWS.video, left: 0, right: 0 }}>
                  {model.scenes.map((scene) => (
                    <Scene key={scene.index} scene={scene} pps={pps} view={view} selected={selection?.kind === 'scene' && selection.index === scene.index} />
                  ))}
                </div>
                {LANES.map((lane) => (
                  <div key={lane.kind} className="tl-row" style={{ position: 'absolute', top: top(lane.kind), height: ROWS[lane.kind], left: 0, right: 0 }}>
                    {model.lanes[lane.kind].blocks.map((block, i) => (
                      <button
                        key={`${block.item}-${i}`}
                        className={`item ${lane.kind}${block.enabled ? '' : ' off'}${isSelected(selection, lane.kind, block.item) ? ' selected' : ''}`}
                        style={{ left: block.start * pps, width: Math.max(6, (block.end - block.start) * pps) }}
                        title={`${block.title}${block.enabled ? '' : ' (off)'}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => select({ kind: lane.kind, index: block.item })}
                        onDoubleClick={() => void player?.seek(block.start)}
                      >
                        {block.title}
                      </button>
                    ))}
                  </div>
                ))}
                {project && (
                  <ColumnsCanvas
                    top={top('mic')}
                    height={ROWS.mic}
                    view={view}
                    color="#3b3b46"
                    columns={(from, to, count) => (peaks ? waveformColumns(peaks, spans, from, to, count, (speed) => !audible(project, speed)) : new Array<number>(count).fill(0))}
                    pps={pps}
                    mirrored
                    deps={[peaks, spans, project]}
                  />
                )}
                <ColumnsCanvas
                  top={top('input')}
                  height={ROWS.input}
                  view={view}
                  color="#34343e"
                  columns={(from, to, count) => activityColumns(media?.events ?? [], spans, from, to, count)}
                  pps={pps}
                  deps={[media, spans]}
                />
                <div className="playhead" style={{ left: t * pps, top: ROWS.markers }} />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const isSelected = (selection: Selection | undefined, kind: Selection['kind'], index: number) => selection?.kind === kind && selection.index === index;

function Markers({ model, pps }: { model: NonNullable<ReturnType<typeof timelineModel>>; pps: number }) {
  const groups = groupPins(model.markers, 70 / pps);
  return (
    <div className="tl-row" style={{ position: 'absolute', top: 0, height: ROWS.markers, left: 0, right: 0 }}>
      {groups.map((group, i) => {
        const first = group.pins[0]!;
        const name =
          group.kind === 'prompt' ? 'Prompt' : group.kind === 'answer' ? 'Answer' : group.kind === 'tool' ? (first.label ?? 'Tool') : (first.label ?? 'Marker');
        return (
          <span key={i} className="flag" style={{ left: group.t * pps }} title={group.pins.map((pin) => `${pin.label ?? pin.kind} at source ${pin.source.toFixed(1)} s`).join('\n')}>
            <i style={{ background: MARKER_DOT[group.kind] }} />
            {name}
            {group.pins.length > 1 ? ` ×${group.pins.length}` : ''}
          </span>
        );
      })}
    </div>
  );
}

function Ruler({ duration, pps, view }: { duration: number; pps: number; view: { left: number; width: number } }) {
  const step = TICKS.find((tick) => tick * pps >= 70) ?? TICKS.at(-1)!;
  const first = Math.max(0, Math.floor(view.left / pps / step) * step);
  const last = Math.min(duration, (view.left + view.width) / pps);
  const ticks: number[] = [];
  for (let tick = first; tick <= last + 1e-9; tick += step) ticks.push(Math.round(tick * 1000) / 1000);
  return (
    <div className="tl-row ruler" style={{ position: 'absolute', top: ROWS.markers, height: ROWS.ruler, left: 0, right: 0 }}>
      {ticks.map((tick) => (
        <span key={tick} style={{ left: tick * pps }}>
          {step < 1 ? tick.toFixed(1) : formatTime(tick).replace(/\.\d$/, '')}
        </span>
      ))}
    </div>
  );
}

function Scene({ scene, pps, view, selected }: { scene: SceneBlock; pps: number; view: { left: number; width: number }; selected: boolean }) {
  const thumbnails = useStore(store, (state) => state.mediaState.thumbnails);
  const project = shownProject();
  const left = scene.start * pps;
  const width = (scene.end - scene.start) * pps;
  const tiles: { x: number; index: number }[] = [];
  const clip = project?.scenes[scene.index];
  const tileHeight = ROWS.video - 10;
  const meta = thumbnails.state === 'ready' && thumbnails.path && thumbnails.interval ? thumbnails : undefined;
  if (meta && clip?.type === 'clip' && width > 0) {
    const tileWidth = Math.round((tileHeight * (meta.width ?? 160)) / (meta.height ?? 90));
    const from = Math.max(0, Math.floor((view.left - left) / tileWidth));
    const to = Math.min(Math.ceil(width / tileWidth), Math.ceil((view.left + view.width - left) / tileWidth) + 1);
    for (let i = from; i < to; i++) {
      const outT = scene.start + ((i + 0.5) * tileWidth) / pps;
      const source = clip.from + (outT - scene.start) * clip.speed;
      tiles.push({ x: i * tileWidth, index: Math.min((meta.count ?? 1) - 1, Math.max(0, Math.floor(source / meta.interval!))) });
    }
  }
  const kindClass = scene.kind === 'clip' ? '' : ` ${scene.kind}`;
  return (
    <button
      className={`scene${kindClass}${selected ? ' selected' : ''}`}
      style={{ left, width: Math.max(4, width - 2) }}
      title={`${scene.title} · ${scene.detail}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => select({ kind: 'scene', index: scene.index })}
      onDoubleClick={() => void currentPlayer()?.seek(scene.start)}
    >
      {meta && tiles.length > 0 && (
        <span className="thumbs">
          {tiles.map((tile) => {
            const tileWidth = Math.round((tileHeight * (meta.width ?? 160)) / (meta.height ?? 90));
            const columns = meta.columns ?? 1;
            const scale = tileHeight / (meta.height ?? 90);
            return (
              <i
                key={tile.x}
                style={{
                  left: tile.x,
                  width: tileWidth,
                  backgroundImage: `url("${mediaUrl(meta.path!)}")`,
                  backgroundSize: `${columns * (meta.width ?? 160) * scale}px auto`,
                  backgroundPosition: `${-(tile.index % columns) * (meta.width ?? 160) * scale}px ${-Math.floor(tile.index / columns) * tileHeight}px`,
                }}
              />
            );
          })}
        </span>
      )}
      <span className="lbl">
        {scene.speed !== undefined && scene.speed !== 1 && <b>{Math.round(scene.speed * 10) / 10}× </b>}
        {scene.title} · {scene.detail}
      </span>
    </button>
  );
}

/** A canvas over the visible part of a lane, one bar per pixel column (0–1 each). */
function ColumnsCanvas(props: {
  top: number;
  height: number;
  view: { left: number; width: number };
  pps: number;
  color: string;
  mirrored?: boolean;
  columns: (from: number, to: number, count: number) => number[];
  deps: unknown[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { top: y, height, view, pps, color, mirrored } = props;
  useEffect(() => {
    const element = canvas.current;
    if (!element || !(pps > 0)) return;
    const ratio = window.devicePixelRatio || 1;
    const columns = Math.max(1, Math.floor(view.width / 2));
    element.width = Math.max(1, Math.round(view.width * ratio));
    element.height = Math.round(height * ratio);
    const context = element.getContext('2d')!;
    context.clearRect(0, 0, element.width, element.height);
    context.fillStyle = color;
    const values = props.columns(view.left / pps, (view.left + view.width) / pps, columns);
    const columnWidth = element.width / columns;
    const middle = element.height / 2;
    values.forEach((value, i) => {
      if (value <= 0) return;
      const bar = Math.max(1, value * (mirrored ? element.height - 4 * ratio : element.height - 2 * ratio));
      context.fillRect(i * columnWidth, mirrored ? middle - bar / 2 : element.height - bar, Math.max(1, columnWidth - ratio), bar);
    });
  }, [view.left, view.width, pps, height, color, ...props.deps]);
  return <canvas ref={canvas} className="tl-canvas" style={{ top: y, left: view.left, width: view.width, height }} />;
}
```

`apps/desktop/src/renderer/editor/Inspector.tsx`:

```
// The inspector: the selection's settings and the look (read-only in this version).
import type { ReactNode } from 'react';
import type { CuttleProject, Rect } from '@cuttle/project';
import { formatDuration, formatSpeed, formatTime } from '../../shared/format';
import { outputTimesOf } from '../../shared/timeline-model';
import { CardIcon, FilmIcon, MaskIcon, PageIcon, TextIcon, ZoomIcon } from '../icons';
import { currentPlayer, shownProject, store, type Selection } from './session';
import { useStore } from './store';

export function Inspector() {
  const tab = useStore(store, (state) => state.tab);
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'selection'} onClick={() => store.set({ tab: 'selection' })}>
          Selection
        </button>
        <button role="tab" aria-selected={tab === 'look'} onClick={() => store.set({ tab: 'look' })}>
          Look
        </button>
      </div>
      <div className="panel-body">{tab === 'selection' ? <SelectionPanel /> : <LookPanel />}</div>
    </aside>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div>
      <div className="field-label">
        {label}
        {note && <em>{note}</em>}
      </div>
      {children}
    </div>
  );
}

const Value = ({ children, note }: { children: ReactNode; note?: string }) => (
  <div className="value tabular">
    <span>{children}</span>
    {note && <em>{note}</em>}
  </div>
);

function Head({ icon, color, name }: { icon: ReactNode; color: string; name: string }) {
  return (
    <div className="kind-head">
      <span className="kind-icon" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
        {icon}
      </span>
      <span className="name" title={name}>
        {name}
      </span>
    </div>
  );
}

function AreaFields({ rect }: { rect: Rect }) {
  return (
    <Field label="Area" note="source pixels">
      <div className="grid4">
        {(['x', 'y', 'w', 'h'] as const).map((name, i) => (
          <div key={name} className="value tabular">
            <em>{name}</em>
            {Math.round(rect[i]!)}
          </div>
        ))}
      </div>
    </Field>
  );
}

/** The output second where a source second first shows (in the clip under the playhead, when it shows there). */
function shownAt(project: CuttleProject, source: number): string {
  const player = currentPlayer();
  if (!player) return '';
  const times = outputTimesOf(player.spans, source);
  if (times.length === 0) return 'cut out';
  const t = player.current().t;
  const nearest = times.reduce((best, time) => (Math.abs(time - t) < Math.abs(best - t) ? time : best), times[0]!);
  return project && formatTime(nearest);
}

function SelectionPanel() {
  const selection = useStore(store, (state) => state.selection);
  useStore(store, (state) => state.player.t);
  const project = shownProject();
  if (!project || !selection) {
    return <p className="hint">Click a scene, zoom, mask or caption on the timeline to see its settings here. The Look tab holds the background, frame, cursor and more.</p>;
  }
  return <Details project={project} selection={selection} />;
}

function Details({ project, selection }: { project: CuttleProject; selection: Selection }) {
  if (selection.kind === 'scene') {
    const scene = project.scenes[selection.index];
    if (!scene) return null;
    const span = currentPlayer()?.spans[selection.index];
    const length = span ? span.end - span.start : 0;
    if (scene.type === 'clip') {
      return (
        <>
          <Head icon={<FilmIcon />} color="var(--text)" name={scene.label ?? (scene.speed > 1 ? 'Sped up' : 'Clip')} />
          <div className="grid2">
            <Field label="Speed">
              <Value>{formatSpeed(scene.speed)}</Value>
            </Field>
            <Field label="Length">
              <Value note={scene.speed !== 1 ? `${formatDuration(scene.to - scene.from)} src` : undefined}>{formatDuration(length)}</Value>
            </Field>
          </div>
          <div className="grid2">
            <Field label="From" note="source">
              <Value>{scene.from.toFixed(2)} s</Value>
            </Field>
            <Field label="To" note="source">
              <Value>{scene.to.toFixed(2)} s</Value>
            </Field>
          </div>
          <Field label="Starts at">
            <Value>{formatTime(span?.start ?? 0)}</Value>
          </Field>
          {scene.badge !== undefined && (
            <Field label="Badge">
              <Value>{scene.badge === '' ? 'none' : scene.badge}</Value>
            </Field>
          )}
        </>
      );
    }
    if (scene.type === 'still') {
      return (
        <>
          <Head icon={<PageIcon />} color="var(--still)" name={scene.label ?? scene.image.split(/[\\/]/).at(-1) ?? 'Still'} />
          <Field label="Image">
            <Value>{scene.image}</Value>
          </Field>
          <div className="grid2">
            <Field label="Length">
              <Value>{formatDuration(length)}</Value>
            </Field>
            <Field label="Motion">
              <Value>{scene.motion === 'kenburns' ? 'Ken Burns' : scene.motion === 'scroll' ? 'Scroll' : 'None'}</Value>
            </Field>
          </div>
          <Field label="Frame">
            <Value>{scene.frame}</Value>
          </Field>
        </>
      );
    }
    return (
      <>
        <Head icon={<CardIcon />} color="var(--card)" name={scene.label ?? scene.title} />
        <Field label="Title">
          <Value>{scene.title}</Value>
        </Field>
        {scene.subtitle && (
          <Field label="Subtitle">
            <Value>{scene.subtitle}</Value>
          </Field>
        )}
        <Field label="Length">
          <Value>{formatDuration(length)}</Value>
        </Field>
      </>
    );
  }
  if (selection.kind === 'zoom') {
    const zoom = project.zooms[selection.index];
    if (!zoom) return null;
    return (
      <>
        <Head icon={<ZoomIcon />} color="var(--zoom)" name={zoom.label ?? 'Zoom'} />
        <div className="grid2">
          <Field label="Starts" note={`${zoom.at.toFixed(1)} s src`}>
            <Value>{shownAt(project, zoom.at)}</Value>
          </Field>
          <Field label="Length" note="source">
            <Value>{formatDuration(zoom.duration)}</Value>
          </Field>
        </div>
        <AreaFields rect={zoom.rect} />
        <div className="grid2">
          <Field label="Easing">
            <Value>{zoom.ease === 'smooth' ? 'Smooth' : 'Linear'}</Value>
          </Field>
          <Field label="State">
            <Value>{zoom.enabled ? 'On' : 'Off'}</Value>
          </Field>
        </div>
      </>
    );
  }
  if (selection.kind === 'mask') {
    const mask = project.masks[selection.index];
    if (!mask) return null;
    return (
      <>
        <Head icon={<MaskIcon />} color="var(--mask)" name={mask.label ?? 'Mask'} />
        <div className="grid2">
          <Field label="From" note={`${mask.from.toFixed(1)} s src`}>
            <Value>{shownAt(project, mask.from)}</Value>
          </Field>
          <Field label="To" note="source">
            <Value>{mask.to.toFixed(1)} s</Value>
          </Field>
        </div>
        <AreaFields rect={mask.rect} />
        <div className="grid2">
          <Field label="Style">
            <Value>{mask.style === 'fill' ? 'Fill' : 'Blur'}</Value>
          </Field>
          <Field label="State">
            <Value>{mask.enabled ? 'On' : 'Off'}</Value>
          </Field>
        </div>
      </>
    );
  }
  const text = project.texts[selection.index];
  if (!text) return null;
  return (
    <>
      <Head icon={<TextIcon />} color="var(--caption)" name={text.label ?? text.text} />
      <Field label="Text">
        <Value>{text.text}</Value>
      </Field>
      <div className="grid2">
        <Field label="Starts" note={`${text.at.toFixed(1)} s src`}>
          <Value>{shownAt(project, text.at)}</Value>
        </Field>
        <Field label="Length" note="source">
          <Value>{formatDuration(text.duration)}</Value>
        </Field>
      </div>
      <div className="grid2">
        <Field label="Style">
          <Value>{text.style === 'lower-third' ? 'Lower third' : text.style === 'pill' ? 'Pill' : 'Caption'}</Value>
        </Field>
        <Field label="Position">
          <Value>{text.position[0]!.toUpperCase() + text.position.slice(1)}</Value>
        </Field>
      </div>
    </>
  );
}

const BACKGROUNDS: Record<string, string> = { 'sunset-sky': 'Sunset sky', aurora: 'Aurora', mesh: 'Mesh', solid: 'Solid', image: 'Image' };

function LookPanel() {
  useStore(store, (state) => state.format);
  const project = shownProject();
  if (!project) return null;
  const { look, output } = project;
  const row = (name: string, value: ReactNode) => (
    <div className="look-row">
      {name}
      <b>{value}</b>
    </div>
  );
  return (
    <>
      <div className="section-title">Output</div>
      {row('Size', `${output.width} × ${output.height}`)}
      {row('Frame rate', `${output.fps} fps`)}
      <div className="section-title">Background</div>
      {row(
        'Preset',
        <>
          {look.background.preset === 'solid' && look.background.color && <span className="swatch" style={{ background: look.background.color }} />}
          {BACKGROUNDS[look.background.preset] ?? look.background.preset}
        </>,
      )}
      {look.background.image && row('Image', look.background.image)}
      <div className="section-title">Window frame</div>
      {row('Style', look.frame.enabled ? look.frame.style : 'Off')}
      {look.frame.enabled && look.frame.title && row('Title', look.frame.title)}
      {look.frame.enabled && row('Corners', `${look.frame.radius} px${look.frame.shadow ? ' · shadow' : ''}`)}
      <div className="section-title">Cursor</div>
      {row('Style', look.cursor.enabled ? look.cursor.style : 'Off')}
      {look.cursor.enabled && row('Size', `${look.cursor.size}×`)}
      {look.cursor.enabled &&
        row(
          'Clicks',
          <>
            <span className="swatch" style={{ background: look.cursor.color }} />
            {look.cursor.clickEffect === 'ripple' ? 'Ripple' : 'None'}
          </>,
        )}
      <div className="section-title">Webcam</div>
      {row('Bubble', look.webcam.enabled ? `${look.webcam.shape}, ${look.webcam.corner}` : 'Off')}
      <div className="section-title">Sound and transitions</div>
      {row('Mic', look.audio.enabled ? (look.audio.muteSpedUp ? 'On, sped-up clips silent' : 'On') : 'Off')}
      {row('Crossfade', look.transition.enabled ? formatDuration(look.transition.duration) : 'Off')}
    </>
  );
}
```

`apps/desktop/src/renderer/editor/ExportSheet.tsx`:

```
// The export sheet: formats, encoder, progress, cancel, and the files at the end.
import { useEffect, useState } from 'react';
import { EXPORT_FORMATS, type ExportFormat } from '@cuttle/export/formats';
import { formatBytes, formatDuration } from '../../shared/format';
import { CheckIcon, CloseIcon, FolderIcon } from '../icons';
import { bridge } from '../bridge';
import { cancelExport, closeExport, startExport, store } from './session';
import { useStore } from './store';

const FORMATS = Object.keys(EXPORT_FORMATS) as ExportFormat[];
const ENCODERS = { auto: 'Automatic', hardware: 'Graphics card', software: 'Processor' } as const;

export function ExportSheet() {
  const open = useStore(store, (state) => state.exportOpen);
  const exporting = useStore(store, (state) => state.exporting);
  const progress = useStore(store, (state) => state.exportProgress);
  const end = useStore(store, (state) => state.exportEnd);
  const format = useStore(store, (state) => state.format);
  const output = useStore(store, (state) => state.media?.project.output);
  const own = FORMATS.find((name) => output && EXPORT_FORMATS[name].width === output.width && EXPORT_FORMATS[name].height === output.height);
  const [chosen, setChosen] = useState<ExportFormat[]>([]);
  const [encoder, setEncoder] = useState<keyof typeof ENCODERS>('auto');

  useEffect(() => {
    if (open && !exporting) setChosen([format ?? own ?? '16:9']);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) closeExport();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, exporting]);

  if (!open) return null;
  const toggle = (name: ExportFormat) => setChosen((list) => (list.includes(name) ? list.filter((item) => item !== name) : FORMATS.filter((item) => item === name || list.includes(item))));
  const done = progress ? progress.done / Math.max(1, progress.total) : 0;
  const finishing = progress !== undefined && progress.position === progress.formats - 1 && progress.done >= progress.total;
  const remaining = progress && done > 0.02 && !finishing ? (progress.elapsed / (progress.position + done)) * (progress.formats - progress.position - done) : undefined;

  return (
    <div className="scrim" onPointerDown={(event) => event.target === event.currentTarget && !exporting && closeExport()}>
      <div className="sheet" role="dialog" aria-label="Export" data-testid="export-sheet">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2 style={{ flex: 1 }}>Export</h2>
          {!exporting && (
            <button className="ghost" style={{ width: 28, padding: 0, justifyContent: 'center' }} onClick={closeExport} aria-label="Close (Esc)">
              <CloseIcon size={14} />
            </button>
          )}
        </div>

        {!exporting && !end && (
          <>
            <div className="formats" role="group" aria-label="Formats">
              {FORMATS.map((name) => {
                const { width, height } = EXPORT_FORMATS[name];
                const scale = 34 / Math.max(width, height);
                return (
                  <button key={name} className="format" aria-pressed={chosen.includes(name)} onClick={() => toggle(name)}>
                    <span className="shape" style={{ width: width * scale, height: height * scale }} />
                    {name}
                    <small>
                      {width}×{height}
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="row">
              Encoder
              <select value={encoder} onChange={(event) => setEncoder(event.target.value as keyof typeof ENCODERS)}>
                {Object.entries(ENCODERS).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <span>
                Into <b style={{ color: 'var(--text)', fontWeight: 500 }}>out/</b> in the project, as it is saved now
              </span>
            </div>
            <div className="actions">
              <button className="ghost" onClick={closeExport}>
                Cancel
              </button>
              <button className="primary" disabled={chosen.length === 0} onClick={() => void startExport(chosen, encoder)} data-testid="export-start">
                Export {chosen.length > 1 ? `${chosen.length} formats` : chosen[0]}
              </button>
            </div>
          </>
        )}

        {exporting && (
          <>
            <div className="progress" aria-live="polite">
              <div className="meta">
                <span>
                  {progress ? `${progress.format}${progress.formats > 1 ? ` · ${progress.position + 1} of ${progress.formats}` : ''}` : 'Starting…'}
                </span>
                <span>{progress ? `${Math.round(done * 100)} %` : ''}</span>
              </div>
              <div className="track">
                <i style={{ width: `${Math.round(done * 100)}%` }} />
              </div>
              <div className="meta">
                <span>{progress ? `${progress.done} of ${progress.total} frames` : ''}</span>
                <span>{finishing ? 'Adding the sound…' : remaining !== undefined ? `about ${formatDuration(remaining)} left` : ''}</span>
              </div>
            </div>
            <div className="actions">
              <button className="ghost" onClick={cancelExport}>
                Cancel export
              </button>
            </div>
          </>
        )}

        {!exporting && end && (
          <>
            {end.state === 'failed' && (
              <div className="error-text">
                The {end.format} export failed ({end.code}): {end.message}
              </div>
            )}
            {end.state === 'cancelled' && <div className="hint">The export was cancelled; nothing was left half-written.</div>}
            {end.files.map((file) => (
              <div key={file.out} className="file-row" data-testid="export-file">
                <CheckIcon size={14} style={{ color: 'var(--ok)' }} />
                <div>
                  {file.out.split(/[\\/]/).at(-1)}
                  <small>
                    {file.format} · {formatDuration(file.seconds)} · {formatBytes(file.bytes)}
                  </small>
                </div>
                <button className="ghost" onClick={() => void bridge.invoke('project:reveal', file.out)} title="Show in folder">
                  <FolderIcon size={14} />
                  Show
                </button>
              </div>
            ))}
            <div className="actions">
              <button className="ghost" onClick={() => store.set({ exportEnd: undefined })}>
                Export again
              </button>
              <button className="primary" onClick={closeExport}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

`apps/desktop/src/renderer/editor/editor.css`:

```
.app {
  display: grid;
  grid-template-rows: 44px minmax(0, 1fr) var(--timeline-height, 320px);
  grid-template-columns: minmax(0, 1fr) 300px;
  height: 100%;
}

/* title bar: the window's caption buttons sit over its right end (titleBarOverlay) */
.titlebar {
  grid-column: 1 / 3;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 152px 0 14px;
  border-bottom: 1px solid var(--line);
  -webkit-app-region: drag;
  min-width: 0;
}
.titlebar button,
.titlebar .seg {
  -webkit-app-region: no-drag;
}
.mark {
  display: grid;
  place-items: center;
  flex: none;
  background: linear-gradient(135deg, #f0956f, #c45a3f);
}
.project-name {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  white-space: nowrap;
}
.project-name b {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.project-name span {
  color: var(--faint);
  font-size: var(--size-s);
  overflow: hidden;
  text-overflow: ellipsis;
}
.grow {
  flex: 1;
}
.seg {
  display: flex;
  background: var(--raised);
  border-radius: var(--radius-m);
  padding: 2px;
  gap: 2px;
}
.seg button {
  padding: 3px 10px;
  border-radius: 7px;
  color: var(--muted);
  font-size: var(--size-s);
  font-weight: 500;
  transition: background var(--fast), color var(--fast);
}
.seg button:hover {
  color: var(--text);
}
.seg button[aria-pressed='true'] {
  background: var(--raised-active);
  color: var(--text);
}
.primary {
  height: 28px;
  padding: 0 14px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 7px;
  transition: background var(--fast);
}
.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
.ghost {
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--raised);
  color: var(--text);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--size-s);
  transition: background var(--fast);
}
.ghost:hover:not(:disabled) {
  background: var(--raised-hover);
}
.chip-status {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--faint);
  font-size: var(--size-s);
  white-space: nowrap;
}
.chip-status .bar {
  width: 56px;
  height: 3px;
  border-radius: 2px;
  background: var(--raised);
  overflow: hidden;
}
.chip-status .bar i {
  display: block;
  height: 100%;
  background: var(--muted);
}

/* stage: the output view, as large as it fits, with the transport under it */
.stage {
  background: var(--stage);
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px 24px 14px;
  min-height: 0;
  min-width: 0;
}
.viewport {
  flex: 1;
  width: 100%;
  min-height: 0;
  display: grid;
  place-items: center;
  position: relative;
}
.viewport canvas {
  display: block;
  border-radius: 4px;
  box-shadow: 0 0 0 1px var(--line);
  background: #000;
}
.stage-note {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--overlay);
  box-shadow: var(--shadow-float);
  font-size: var(--size-s);
  color: var(--muted);
  max-width: 80%;
  z-index: 2;
}
.stage-note.warn {
  color: var(--card);
}
.transport {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--muted);
}
.play {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--text);
  color: #111;
  display: grid;
  place-items: center;
  flex: none;
  transition: transform var(--fast) var(--ease-out);
}
.play:hover {
  transform: scale(1.06);
}
.play svg {
  margin-left: 1px;
}
.time b {
  color: var(--text);
  font-weight: 500;
}
.time em {
  color: var(--faint);
  font-style: normal;
  margin-left: 10px;
}

/* inspector */
.inspector {
  grid-row: 2 / 4;
  grid-column: 2;
  background: var(--panel);
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 10px 12px 0;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  padding: 8px 10px;
  color: var(--muted);
  font-weight: 500;
  border-bottom: 2px solid transparent;
  border-radius: 0;
}
.tabs button[aria-selected='true'] {
  color: var(--text);
  border-bottom-color: var(--text);
}
.panel-body {
  flex: 1;
  overflow: auto;
  padding: 14px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.kind-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.kind-icon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  flex: none;
}
.kind-head .name {
  height: 30px;
  flex: 1;
  min-width: 0;
  border-radius: 8px;
  background: var(--raised);
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.field-label {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: var(--size-s);
  margin-bottom: 6px;
}
.field-label em {
  font-style: normal;
  color: var(--faint);
}
.value {
  min-height: 30px;
  background: var(--raised);
  border-radius: 8px;
  display: flex;
  align-items: center;
  padding: 4px 10px;
  font-variant-numeric: tabular-nums;
  justify-content: space-between;
  box-shadow: inset 0 0 0 1px var(--line);
  overflow-wrap: anywhere;
}
.value em {
  color: var(--faint);
  font-style: normal;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.grid4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.grid4 .value {
  padding: 4px 8px;
  justify-content: flex-start;
  gap: 6px;
}
.grid4 .value em {
  font-size: var(--size-xs);
}
.hint {
  color: var(--faint);
  font-size: var(--size-s);
  line-height: 1.5;
}
.section-title {
  color: var(--faint);
  font-size: var(--size-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  margin-top: 4px;
}
.look-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--size-s);
  color: var(--muted);
  min-height: 22px;
  align-items: center;
}
.look-row b {
  color: var(--text);
  font-weight: 500;
  text-align: right;
  overflow-wrap: anywhere;
}
.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-block;
  vertical-align: -1px;
  margin-right: 6px;
  box-shadow: 0 0 0 1px var(--line-strong);
}

/* timeline */
.timeline {
  grid-column: 1;
  background: var(--panel);
  border-top: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}
.tl-bar {
  height: 38px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: var(--size-s);
}
.tl-bar .act {
  height: 26px;
  padding: 0 8px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  color: var(--muted);
}
.tl-bar .act:hover {
  background: var(--raised);
  color: var(--text);
}
.tl-bar input[type='range'] {
  width: 110px;
  accent-color: var(--muted);
}
.tl-status {
  color: var(--faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tl-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.tl-names {
  width: 88px;
  flex: none;
  border-right: 1px solid var(--line);
}
.tl-names div {
  padding-left: 14px;
  color: var(--faint);
  font-size: var(--size-s);
  display: flex;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
}
.tl-names small {
  color: var(--faint);
  margin-left: 4px;
  font-size: 10px;
}
.tl-scroll {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  position: relative;
  min-width: 0;
}
.tl-content {
  position: relative;
  height: 100%;
}
.tl-row {
  position: relative;
}
.flag {
  position: absolute;
  top: 5px;
  height: 17px;
  padding: 0 6px 0 5px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 5px;
  background: #24242b;
  color: var(--muted);
  white-space: nowrap;
  transform: translateX(-6px);
}
.flag i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: block;
}
.ruler {
  border-bottom: 1px solid var(--line);
  color: var(--faint);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  cursor: col-resize;
}
.ruler span {
  position: absolute;
  top: 3px;
  padding-left: 3px;
  border-left: 1px solid var(--line-strong);
  height: 14px;
  line-height: 12px;
}
.scene {
  position: absolute;
  top: 5px;
  bottom: 5px;
  border-radius: 7px;
  overflow: hidden;
  background: var(--raised);
  display: flex;
  align-items: flex-end;
  box-shadow: inset 0 0 0 1px var(--line);
}
.scene .thumbs {
  position: absolute;
  inset: 0;
}
.scene .thumbs i {
  position: absolute;
  top: 0;
  bottom: 0;
  background-repeat: no-repeat;
  border-right: 1px solid rgba(8, 8, 10, 0.6);
}
.scene .lbl {
  position: relative;
  margin: 0 0 5px 7px;
  background: rgba(10, 10, 12, 0.78);
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 11px;
  color: #d6d6dc;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: calc(100% - 14px);
}
.scene .lbl b {
  font-weight: 600;
  color: #fff;
}
.scene.still {
  background: linear-gradient(180deg, rgba(60, 198, 201, 0.28), rgba(60, 198, 201, 0.12));
  box-shadow: inset 0 0 0 1px rgba(60, 198, 201, 0.45);
}
.scene.card {
  background: linear-gradient(180deg, rgba(242, 179, 74, 0.26), rgba(242, 179, 74, 0.1));
  box-shadow: inset 0 0 0 1px rgba(242, 179, 74, 0.45);
}
.scene.selected,
.item.selected {
  box-shadow: inset 0 0 0 2px var(--accent);
}
.item {
  position: absolute;
  top: 7px;
  bottom: 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  padding: 0 8px;
  white-space: nowrap;
  overflow: hidden;
  min-width: 6px;
}
.item.zoom {
  background: rgba(90, 162, 255, 0.16);
  box-shadow: inset 0 0 0 1px rgba(90, 162, 255, 0.55);
  color: var(--zoom);
}
.item.mask {
  background: rgba(167, 123, 255, 0.15);
  box-shadow: inset 0 0 0 1px rgba(167, 123, 255, 0.5);
  color: var(--mask);
}
.item.caption {
  background: rgba(79, 209, 161, 0.13);
  box-shadow: inset 0 0 0 1px rgba(79, 209, 161, 0.5);
  color: var(--caption);
}
.item.off {
  background-image: repeating-linear-gradient(135deg, transparent 0 5px, rgba(255, 255, 255, 0.05) 5px 10px);
  opacity: 0.6;
}
.item.zoom.selected,
.item.mask.selected,
.item.caption.selected {
  box-shadow: inset 0 0 0 2px var(--accent);
}
.tl-canvas {
  position: absolute;
  left: 0;
  top: 0;
}
.playhead {
  position: absolute;
  top: 26px;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--accent);
  pointer-events: none;
  z-index: 2;
}
.playhead::before {
  content: '';
  position: absolute;
  top: 0;
  left: -5px;
  width: 12px;
  height: 10px;
  border-radius: 2px 2px 6px 6px;
  background: var(--accent);
}

/* export sheet */
.scrim {
  position: fixed;
  inset: 44px 0 0 0;
  background: rgba(6, 6, 9, 0.55);
  display: grid;
  place-items: start center;
  padding-top: 64px;
  z-index: 10;
  animation: fade var(--normal) var(--ease-out);
}
.sheet {
  width: 440px;
  background: var(--panel);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-float);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: rise var(--normal) var(--ease-out);
}
.sheet h2 {
  margin: 0;
  font-size: var(--size-l);
  font-weight: 600;
}
.sheet .formats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.format {
  border-radius: 10px;
  background: var(--raised);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  color: var(--muted);
  box-shadow: inset 0 0 0 1px var(--line);
  transition: box-shadow var(--fast), color var(--fast);
}
.format[aria-pressed='true'] {
  color: var(--text);
  box-shadow: inset 0 0 0 2px var(--text);
}
.format .shape {
  border: 1.5px solid currentColor;
  border-radius: 3px;
}
.format small {
  color: var(--faint);
  font-size: var(--size-xs);
}
.sheet .row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--muted);
  font-size: var(--size-s);
}
.sheet select {
  background: var(--raised);
  border: 0;
  border-radius: 8px;
  height: 28px;
  padding: 0 8px;
  box-shadow: inset 0 0 0 1px var(--line);
}
.progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.progress .track {
  height: 6px;
  border-radius: 3px;
  background: var(--raised);
  overflow: hidden;
}
.progress .track i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 100ms linear;
}
.progress .meta {
  display: flex;
  justify-content: space-between;
  color: var(--faint);
  font-size: var(--size-s);
  font-variant-numeric: tabular-nums;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 9px;
  background: var(--raised);
  font-size: var(--size-s);
}
.file-row div {
  flex: 1;
  min-width: 0;
}
.file-row small {
  display: block;
  color: var(--faint);
}
.sheet .actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.error-text {
  color: var(--danger);
  font-size: var(--size-s);
  white-space: pre-wrap;
  max-height: 160px;
  overflow: auto;
}

/* loading and errors */
.center {
  height: 100%;
  display: grid;
  place-items: center;
  text-align: center;
  color: var(--muted);
  padding: 40px;
}
.center h1 {
  font-size: var(--size-xl);
  color: var(--text);
  font-weight: 600;
  margin: 16px 0 8px;
}
.center pre {
  text-align: left;
  color: var(--muted);
  background: var(--panel);
  padding: 12px 14px;
  border-radius: 10px;
  max-width: 720px;
  white-space: pre-wrap;
  font: var(--size-s) / 1.5 var(--mono);
}
.spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid var(--raised);
  border-top-color: var(--accent);
  animation: spin 900ms linear infinite;
  margin: 0 auto;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}
```

`apps/desktop/src/renderer/editor/main.tsx`:

```
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../base.css';
import './editor.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/desktop/src/renderer/editor.html`:

```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cuttle</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./editor/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: The pill**

`apps/desktop/src/renderer/pill/Pill.tsx`:

```
// The pill: a small launcher near the top of the screen (never in a recording). New recording, open
// a project (the recent ones in a menu), and Esc to hide it until the tray brings it back.
import { useEffect } from 'react';
import { bridge } from '../bridge';
import { ChevronIcon, CloseIcon, FolderIcon, Mark } from '../icons';

export function Pill() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void bridge.invoke('pill:hide');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="pill-wrap">
      <div className="pill" role="toolbar" aria-label="Cuttle">
        <Mark size={36} />
        <button className="main" disabled title="Recording comes with the next milestone (Ctrl+Shift+Alt+R)">
          <i />
          New recording <kbd>Ctrl Shift Alt R</kbd>
        </button>
        <button onClick={() => void bridge.invoke('pill:open')} title="Open a project folder">
          <FolderIcon size={15} />
          Open
        </button>
        <button className="icon-only" onClick={() => void bridge.invoke('pill:menu')} aria-label="Recent projects" title="Recent projects">
          <ChevronIcon size={15} />
        </button>
        <button className="icon-only" onClick={() => void bridge.invoke('pill:hide')} aria-label="Hide (Esc)" title="Hide (Esc); the tray icon brings it back">
          <CloseIcon size={13} />
        </button>
      </div>
    </div>
  );
}
```

`apps/desktop/src/renderer/pill/pill.css`:

```
body.transparent,
body.transparent #root {
  background: transparent;
}
.pill-wrap {
  height: 100%;
  display: grid;
  place-items: center;
}
.pill {
  height: 48px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-radius: 16px;
  background: var(--overlay);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(20px);
  -webkit-app-region: drag;
}
.pill .mark {
  width: 36px;
  height: 36px;
  border-radius: 11px;
}
.pill button {
  -webkit-app-region: no-drag;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: var(--size-s);
  white-space: nowrap;
  transition: background var(--fast), color var(--fast);
}
.pill button:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.pill button.main {
  color: var(--text);
  background: var(--raised);
}
.pill button.main:hover:not(:disabled) {
  background: var(--raised-hover);
}
.pill button.main i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--recording);
  display: block;
}
.pill kbd {
  background: none;
  padding: 0;
}
.pill .icon-only {
  width: 32px;
  padding: 0;
  justify-content: center;
}
```

`apps/desktop/src/renderer/pill/main.tsx`:

```
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../base.css';
import './pill.css';
import { Pill } from './Pill';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Pill />
  </StrictMode>,
);
```

`apps/desktop/src/renderer/pill.html`:

```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cuttle</title>
  </head>
  <body class="transparent">
    <div id="root"></div>
    <script type="module" src="./pill/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: The build**

`apps/desktop/vite.renderer.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The windows' pages (React), served from app://cuttle/ by the main process.
export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: '/',
  logLevel: 'warn',
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome140',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        editor: fileURLToPath(new URL('./src/renderer/editor.html', import.meta.url)),
        pill: fileURLToPath(new URL('./src/renderer/pill.html', import.meta.url)),
      },
    },
  },
});
```

`apps/desktop/scripts/build.mjs`:

```js
// Builds the app into apps/desktop/dist: the main process and media worker (dist/main), one
// self-contained CommonJS preload per window kind (dist/preload: a sandboxed preload can require
// only electron), the pages (dist/renderer) and the export page (dist/main/export-page).
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const at = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

rmSync(at('dist'), { recursive: true, force: true });
await build({ configFile: at('vite.main.config.ts') });
for (const kind of ['editor', 'pill']) {
  await build({
    configFile: false,
    root: desktop,
    logLevel: 'warn',
    build: {
      outDir: at('dist/preload'),
      emptyOutDir: false,
      minify: false,
      target: 'node22',
      lib: { entry: at(`src/preload/${kind}.ts`), formats: ['cjs'], fileName: () => `${kind}.cjs` },
      rollupOptions: { external: ['electron'] },
    },
  });
}
await build({ configFile: at('vite.renderer.config.ts') });
await build({ configFile: at('../../packages/export/electron/vite.page.config.ts'), build: { outDir: at('dist/main/export-page') } });
console.log('built apps/desktop/dist');
```

In `package.json`, replace:

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "engine:electron": "vite build --config packages/engine/electron/vite.config.ts && electron packages/engine/electron/main.mjs",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json && tsc -p packages/recorder/tsconfig.json && tsc -p packages/core/tsconfig.json && tsc -p apps/cli/tsconfig.json && tsc -p skill/tsconfig.json",
    "export:build": "vite build --config packages/export/electron/vite.main.config.ts && vite build --config packages/export/electron/vite.page.config.ts",
    "export:check": "pnpm export:build && electron packages/export/dist/check.mjs",
    "recorder:real": "vitest run --mode real --silent=false packages/recorder/test/real.test.ts",
```

with:

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "engine:electron": "vite build --config packages/engine/electron/vite.config.ts && electron packages/engine/electron/main.mjs",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json && tsc -p packages/recorder/tsconfig.json && tsc -p packages/core/tsconfig.json && tsc -p apps/cli/tsconfig.json && tsc -p apps/desktop/tsconfig.json && tsc -p skill/tsconfig.json",
    "export:build": "vite build --config packages/export/electron/vite.main.config.ts && vite build --config packages/export/electron/vite.page.config.ts",
    "export:check": "pnpm export:build && electron packages/export/dist/check.mjs",
    "recorder:real": "vitest run --mode real --silent=false packages/recorder/test/real.test.ts",
```

In the same file, replace:

```json
    "cli:uninstall": "node apps/cli/scripts/install.mjs --uninstall",
    "cli:check": "pnpm cli:build && vitest run --mode cli apps/cli/test/electron.check.test.ts",
    "cuttle": "node apps/cli/dist/cuttle.mjs",
    "skill:install": "node skill/install.mjs",
    "skill:uninstall": "node skill/install.mjs --uninstall"
  },
```

with:

```json
    "cli:uninstall": "node apps/cli/scripts/install.mjs --uninstall",
    "cli:check": "pnpm cli:build && vitest run --mode cli apps/cli/test/electron.check.test.ts",
    "cuttle": "node apps/cli/dist/cuttle.mjs",
    "app:build:js": "node apps/desktop/scripts/build.mjs",
    "app": "pnpm app:build:js && electron apps/desktop/dist/main/index.mjs",
    "app:check": "pnpm app:build:js && pnpm cli:build && vitest run --mode app apps/desktop/test/app.check.test.ts",
    "app:build": "pnpm app:build:js && node apps/desktop/scripts/package.mjs && vitest run --mode build apps/desktop/test/build.check.test.ts",
    "skill:install": "node skill/install.mjs",
    "skill:uninstall": "node skill/install.mjs --uninstall"
  },
```

Run: `pnpm app:build:js`
Expected: exits with code 0 and ends with `built apps/desktop/dist` (Vite warns that the editor's chunk is larger than 500 kB: the engine and Mediabunny). `apps/desktop/dist` holds `main/index.mjs`, `main/media-worker.mjs`, `main/export-page/`, `preload/editor.cjs`, `preload/pill.cjs` and `renderer/editor.html`, `renderer/pill.html`.

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop package.json
git commit -m "desktop: the editor (output view and player, read-only timeline and inspector, export sheet) and the pill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The end-to-end check

**Files:**
- Create: `apps/desktop/test/fixture.ts`, `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The fixture and the check**

`apps/desktop/test/fixture.ts`:

```ts
// A small project for the app's checks, made with ffmpeg: a 12 s screen recording (a test pattern
// with a moving box), a mic (a tone), input events, Claude's markers, a page still, and a
// cuttle.json with a continuous cut into a 4× clip, a jump cut, a card, a zoom, a mask and a caption.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURE_OUTPUT = { width: 640, height: 360, fps: 30 } as const;

function ffmpeg(args: string[]): void {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

export function makeFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
  mkdirSync(join(dir, 'stills'), { recursive: true });
  const screen = "testsrc2=s=1280x800:r=30:d=12[bg];color=c=white:s=120x120:r=30:d=12[box];[bg][box]overlay=x='100+t*80':y=520";
  ffmpeg(['-f', 'lavfi', '-i', screen, '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60', '-pix_fmt', 'yuv420p', '-color_trc', 'bt709', join(take, 'screen.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=12', '-c:a', 'aac', '-b:a', '96k', join(take, 'mic.m4a')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=s=1200x1600:d=1', '-frames:v', '1', join(dir, 'stills', 'page.png')]);
  const events = [
    { t: 0, type: 'move', x: 400, y: 300 },
    { t: 0, type: 'shape', shape: 'arrow' },
    { t: 1.5, type: 'move', x: 640, y: 400 },
    { t: 2, type: 'click', x: 640, y: 400, button: 'left' },
    { t: 2.4, type: 'keys', count: 6 },
    { t: 9, type: 'click', x: 900, y: 600, button: 'left' },
  ];
  writeFileSync(join(take, 'events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
  writeFileSync(join(take, 'markers.json'), JSON.stringify({ version: 1, markers: [{ t: 2.5, kind: 'prompt' }, { t: 4, kind: 'tool', label: 'Bash' }, { t: 4.6, kind: 'tool', label: 'Bash' }, { t: 9, kind: 'answer' }] }));
  writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 100 }, mic: { file: 'mic.m4a', start: 100 } } }));
  const project = {
    version: 1,
    output: FIXTURE_OUTPUT,
    sources: { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a', events: 'takes/1/events.jsonl', markers: 'takes/1/markers.json' },
    look: { background: { preset: 'aurora' }, frame: { title: 'claude · ~/demo' } },
    scenes: [
      { type: 'clip', id: 's1', label: 'Prompt', from: 0, to: 3 },
      { type: 'clip', id: 's2', label: 'Claude at work', from: 3, to: 8, speed: 4 },
      { type: 'clip', id: 's3', label: 'Answer', from: 8.5, to: 11.5 },
      { type: 'still', id: 's4', image: 'stills/page.png', duration: 2, motion: 'scroll', frame: 'browser-light' },
      { type: 'card', id: 's5', title: 'Built with Claude Code', subtitle: 'example.com', duration: 1.5 },
    ],
    zooms: [{ id: 'z1', label: 'Answer', at: 8.8, duration: 2.5, rect: [600, 400, 640, 400] }],
    masks: [{ id: 'm1', label: 'Token', from: 0, to: 9, rect: [40, 40, 300, 60] }],
    texts: [{ id: 't1', label: 'Hook', at: 0.5, duration: 2, text: 'One prompt', style: 'pill', position: 'bottom' }],
  };
  writeFileSync(join(dir, 'cuttle.json'), `${JSON.stringify(project, null, 2)}\n`);
}
```

`apps/desktop/test/app.check.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OUTPUT, makeFixture } from './fixture';

/**
 * The app end to end, its windows never shown: open a project, play, scrub, compare the output view
 * with the export's frames (`cuttle preview`), export. Runs only with `pnpm app:check` (vitest
 * --mode app, after app:build:js and cli:build). CUTTLE_CHECK_SHOTS=<folder> keeps screenshots.
 */
const enabled = process.env.MODE === 'app';
const MAIN = fileURLToPath(new URL('../dist/main/index.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../../cli/dist/cuttle.mjs', import.meta.url));
const SHOTS = process.env.CUTTLE_CHECK_SHOTS;

interface CheckState {
  t: number;
  playing: boolean;
  source?: number;
  error?: string;
  duration: number;
  mediaState: { proxy: { state: string }; thumbnails: { state: string }; peaks: { state: string } };
}

const electronPath = (): string => createRequire(import.meta.url)('electron') as unknown as string;

function decode(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
}

/** Mean and largest per-channel difference of two same-sized RGBA images. */
function difference(a: PNG, b: PNG): { mean: number; max: number } {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c]! - b.data[i + c]!);
      sum += d;
      max = Math.max(max, d);
    }
  }
  return { mean: sum / ((a.data.length / 4) * 3), max };
}

describe.runIf(enabled)('the Cuttle app', () => {
  let root: string;
  let project: string;
  let app: ElectronApplication;
  let editor: Page;
  const state = () => editor.evaluate(() => (window as unknown as { __cuttleCheck: { state(): CheckState } }).__cuttleCheck.state());
  const seek = (t: number) => editor.evaluate((time) => (window as unknown as { __cuttleCheck: { seek(t: number): Promise<void> } }).__cuttleCheck.seek(time), t);
  /** A screenshot of the editor (CUTTLE_CHECK_SHOTS): Electron's capturePage, which works on a window never shown. */
  const shot = async (name: string) => {
    if (!SHOTS) return;
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('/editor.html'))!;
      // A hidden window paints only when asked: repaint, then capture.
      window.webContents.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return (await window.webContents.capturePage()).toPNG().toString('base64');
    });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cuttle-app-'));
    project = join(root, 'demo');
    mkdirSync(project);
    makeFixture(project);
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    app = await _electron.launch({
      executablePath: electronPath(),
      args: [MAIN, '--open', project],
      env: { ...process.env, CUTTLE_HIDDEN: '1', CUTTLE_CHECK: '1', CUTTLE_NO_PROXY: '1', CUTTLE_USER_DATA: join(root, 'user-data') },
    });
    editor = await new Promise<Page>((resolve) => {
      const find = () => app.windows().find((page) => page.url().includes('/editor.html'));
      const found = find();
      if (found) return resolve(found);
      app.on('window', (page) => {
        if (page.url().includes('/editor.html')) resolve(page);
        else void page.waitForURL(/editor\.html/).then(() => resolve(page), () => {});
      });
    });
    await editor.setViewportSize({ width: 1440, height: 900 });
    await editor.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });

  it('opens the project: the timeline shows its scenes, overlays and markers', async () => {
    expect(await editor.title()).toBe('demo · Cuttle');
    expect(await editor.locator('.scene').count()).toBe(5);
    expect(await editor.locator('.scene').first().getAttribute('title')).toBe('Prompt · 3 s');
    expect(await editor.locator('.item.zoom').count()).toBe(1);
    // the mask (source 0–9) runs across the continuous cut into the 4× clip as one block, then
    // shows again after the jump cut to source 8.5
    expect(await editor.locator('.item.mask').count()).toBe(2);
    // a caption's block shows its label ("Hook"), its text when it has none
    expect(await editor.locator('.item.caption').textContent()).toBe('Hook');
    expect(await editor.locator('.flag').allTextContents()).toEqual(['Prompt', 'Bash ×2', 'Answer']);
    const { duration } = await state();
    expect(duration).toBeCloseTo(3 + 5 / 4 + 3 + 2 + 1.5, 6);
    await shot('01-opened');
  });

  it('shows what the export renders, frame for frame', async () => {
    const stills = join(root, 'stills');
    const times = [1, 4, 6.8, 9.9];
    const result = spawnSync('node', [CLI, '--json', '-C', project, 'preview', ...times.flatMap((t) => ['--at', String(t)]), '-o', stills], { encoding: 'utf8', timeout: 120_000 });
    expect(result.status, result.stderr).toBe(0);
    const files = (JSON.parse(result.stdout) as { stills: { file: string }[] }).stills.map((still) => still.file);
    for (const [i, t] of times.entries()) {
      await seek(t);
      const view = decode(await editor.evaluate(() => (window as unknown as { __cuttleCheck: { pixels(): string } }).__cuttleCheck.pixels()));
      expect([view.width, view.height]).toEqual([FIXTURE_OUTPUT.width, FIXTURE_OUTPUT.height]);
      const { mean, max } = difference(view, PNG.sync.read(readFileSync(files[i]!)));
      expect(mean, `t = ${t}: mean difference`).toBeLessThan(0.5);
      expect(max, `t = ${t}: largest difference`).toBeLessThanOrEqual(24);
    }
    await shot('02-zoom');
  }, 120_000);

  it('plays with the mic as the clock, the picture keeping up, and pauses', async () => {
    await seek(0);
    await editor.keyboard.press('Space');
    await editor.waitForTimeout(2000);
    const playing = await state();
    const stats = await editor.evaluate(() => (window as unknown as { __cuttleCheck: { playback(): { drawn: number; restarts: number; clock: number } } }).__cuttleCheck.playback());
    console.log(`playback after 2 s: clock ${stats.clock.toFixed(2)} s, picture ${playing.t.toFixed(2)} s, ${stats.drawn} frames drawn, ${stats.restarts} restarts`);
    expect(playing.playing).toBe(true);
    // the clock (the sound) runs in real time, from 0.12 s after the key
    expect(stats.clock).toBeGreaterThan(1.5);
    expect(stats.clock).toBeLessThan(2.4);
    // the picture follows it, never more than about half a second behind (then it drops frames)
    expect(stats.clock - playing.t).toBeLessThan(0.7);
    // and plays as a movie, not a slideshow: about 55 frames at 30 fps, at least 25 on a busy machine
    expect(stats.drawn).toBeGreaterThan(25);
    await editor.keyboard.press('Space');
    const paused = await state();
    expect(paused.playing).toBe(false);
    await editor.waitForTimeout(300);
    expect((await state()).t).toBe(paused.t);
  });

  it('scrubs with the playhead on the ruler', async () => {
    const { duration } = await state();
    // A window that is never shown gets no real mouse: the pointer events are dispatched on the ruler's lane.
    await editor.evaluate(() => {
      const lane = document.querySelector('.tl-content')!;
      const box = document.querySelector('[data-testid=timeline]')!.getBoundingClientRect();
      const at = (type: string, x: number) =>
        lane.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: box.left + x, clientY: box.top + 34, button: 0, pointerId: 7 }));
      at('pointerdown', 20);
      for (let step = 1; step <= 8; step++) at('pointermove', 20 + ((box.width / 2 - 20) * step) / 8);
      at('pointerup', box.width / 2);
    });
    await editor.waitForTimeout(500);
    const { t } = await state();
    expect(t).toBeGreaterThan(duration * 0.3);
    expect(t).toBeLessThan(duration * 0.7);
  });

  it('makes the proxy, the thumbnails and the waveform in the background', async () => {
    await editor.waitForFunction(
      () => {
        const media = (window as unknown as { __cuttleCheck: { state(): CheckState } }).__cuttleCheck.state().mediaState;
        return media.proxy.state === 'ready' && media.thumbnails.state === 'ready' && media.peaks.state === 'ready';
      },
      undefined,
      { timeout: 60_000 },
    );
    expect(existsSync(join(project, '.cuttle', 'proxy.mp4'))).toBe(true);
    await editor.waitForSelector('.scene .thumbs i');
    await shot('03-thumbnails');
  }, 90_000);

  it('exports 16:9 into out/ and says where', async () => {
    await editor.keyboard.press('Control+E');
    await editor.waitForSelector('[data-testid=export-sheet]');
    await shot('04-export-sheet');
    await editor.click('[data-testid=export-start]');
    await editor.waitForSelector('[data-testid=export-file]', { timeout: 120_000 });
    await shot('05-exported');
    const out = join(project, 'out', '16x9.mp4');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/);
    expect(probe).toEqual(['h264,1920,1080', 'aac']);
    await editor.keyboard.press('Escape');
  }, 150_000);

  it('keeps the pill out of recordings, with the project in its recent list', async () => {
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    expect(pill).toBeDefined();
    const recent = await pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<{ name: string }[]> } }).cuttle.invoke('pill:recent'));
    expect(recent.map((entry) => entry.name)).toEqual(['demo']);
    const editorBridge = await editor.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:recent').then(() => 'reached', (error: Error) => error.message));
    expect(editorBridge).toContain('unknown request');
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm app:check`
Expected: PASS, 7 tests (about a minute: the export and the proxy take most of it). No window shows on the screen.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test
git commit -m "desktop: app:check drives the app with hidden windows: open, compare with the export, play, scrub, media, export, pill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The unpacked build

**Files:**
- Create: `apps/desktop/scripts/package.mjs`, `apps/desktop/test/build.check.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: The packaging script and its check**

`apps/desktop/scripts/package.mjs`:

```js
// Packages the built app (apps/desktop/dist, from app:build:js) as an unpacked app folder in
// apps/desktop/build/Cuttle-<platform>-<arch>/: no installer, no signing. The native modules the
// recorder loads (koffi and uiohook-napi, with their prebuilt binaries for this platform) are
// copied next to the bundle and kept outside the asar archive.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const build = join(desktop, 'build');
const stage = join(build, 'stage');
const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
const NATIVE = ['koffi', 'uiohook-napi'];

if (!existsSync(join(desktop, 'dist', 'main', 'index.mjs'))) throw new Error('apps/desktop/dist is missing: run "pnpm app:build:js" first');
rmSync(build, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

/**
 * The real folder of package `name` as Node finds it from the folder `from` (node_modules there and
 * in every parent; a package's own exports may hide its package.json from require.resolve);
 * undefined when it is not installed (an optional dependency for another platform).
 */
function packageDir(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

/** The native modules and everything they need at run time, flat: name → real folder. */
const modules = new Map();
const queue = NATIVE.map((name) => [name, desktop]);
while (queue.length > 0) {
  const [name, from] = queue.shift();
  if (modules.has(name)) continue;
  const dir = packageDir(name, from);
  if (!dir) {
    if (NATIVE.includes(name)) throw new Error(`${name} is not installed for apps/desktop`);
    continue;
  }
  modules.set(name, dir);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) queue.push([dependency, dir]);
}

const platform = `${process.platform}-${process.arch}`;
for (const [name, dir] of modules) {
  cpSync(dir, join(stage, 'node_modules', name), {
    recursive: true,
    dereference: true,
    // No nested node_modules (dependencies are flat beside it), no sources, no other platforms' binaries.
    filter: (source) => {
      const rel = source.slice(dir.length).replaceAll('\\', '/');
      if (/\/node_modules(\/|$)/.test(rel)) return false;
      const prebuild = /\/prebuilds\/([^/]+)/.exec(rel);
      return !prebuild || prebuild[1] === platform;
    },
  });
}

cpSync(join(desktop, 'dist'), join(stage, 'dist'), { recursive: true });
cpSync(join(desktop, 'assets'), join(stage, 'assets'), { recursive: true });
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'cuttle',
      productName: 'Cuttle',
      version: manifest.version,
      description: manifest.description,
      type: 'module',
      main: 'dist/main/index.mjs',
      dependencies: Object.fromEntries([...modules.keys()].map((name) => [name, JSON.parse(readFileSync(join(modules.get(name), 'package.json'), 'utf8')).version])),
    },
    null,
    2,
  )}\n`,
);

const electronVersion = JSON.parse(readFileSync(createRequire(join(desktop, '..', '..', 'package.json')).resolve('electron/package.json'), 'utf8')).version;
const [out] = await packager({
  dir: stage,
  out: build,
  name: 'Cuttle',
  executableName: 'Cuttle',
  appVersion: manifest.version,
  electronVersion,
  platform: process.platform,
  arch: process.arch,
  icon: join(desktop, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
  asar: { unpack: '**/{*.node,*.dll}' },
  prune: false,
  overwrite: true,
  quiet: true,
  win32metadata: { CompanyName: 'Cuttle', ProductName: 'Cuttle', FileDescription: 'Cuttle' },
});
rmSync(stage, { recursive: true, force: true });
console.log(`packaged ${basename(out)}: ${out}`);
```

`apps/desktop/test/build.check.test.ts`:

```ts
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeFixture } from './fixture';

/**
 * The unpacked app (pnpm app:build) starts from its folder, opens a project, draws its first frame,
 * and runs the media worker from inside the asar archive. Runs only with vitest --mode build.
 */
const enabled = process.env.MODE === 'build';
const EXE = fileURLToPath(new URL(`../build/Cuttle-${process.platform}-${process.arch}/Cuttle${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));

describe.runIf(enabled)('the unpacked Cuttle app', () => {
  let root: string;
  let app: ElectronApplication;
  let editor: Page;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cuttle-build-'));
    const project = join(root, 'demo');
    mkdirSync(project);
    makeFixture(project);
    app = await _electron.launch({
      executablePath: EXE,
      args: ['--open', project],
      env: { ...process.env, CUTTLE_HIDDEN: '1', CUTTLE_CHECK: '1', CUTTLE_USER_DATA: join(root, 'user-data') },
    });
    editor = await new Promise<Page>((resolve) => {
      const found = app.windows().find((page) => page.url().includes('/editor.html'));
      if (found) return resolve(found);
      app.on('window', (page) => void page.waitForURL(/editor\.html/).then(() => resolve(page), () => {}));
    });
    await editor.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });

  it('opens a project and draws its first frame', async () => {
    expect(await app.evaluate(({ app: electronApp }) => [electronApp.getName(), electronApp.isPackaged])).toEqual(['Cuttle', true]);
    const pixels: string = await editor.evaluate(() => (window as unknown as { __cuttleCheck: { pixels(): string } }).__cuttleCheck.pixels());
    expect(pixels.length).toBeGreaterThan(10_000);
  });

  it('makes the proxy in its media worker', async () => {
    await editor.waitForFunction(
      () => (window as unknown as { __cuttleCheck: { state(): { mediaState: { proxy: { state: string } } } } }).__cuttleCheck.state().mediaState.proxy.state === 'ready',
      undefined,
      { timeout: 60_000 },
    );
  }, 90_000);
});
```

In `.gitignore`, replace:

```
*.log
.DS_Store
.vitest/
```

with:

```
*.log
.DS_Store
.vitest/
apps/desktop/build/
```

- [ ] **Step 2: Build it**

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …\apps\desktop\build\Cuttle-win32-x64`, then PASS, 2 tests. `apps/desktop/build/Cuttle-win32-x64/resources/app.asar.unpacked` holds `node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node` and `node_modules/uiohook-napi/prebuilds/win32-x64/uiohook-napi.node`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/scripts/package.mjs apps/desktop/test/build.check.test.ts .gitignore
git commit -m "desktop: app:build makes an unpacked app with the native modules outside the asar archive, checked that it starts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs and final verification

- [ ] **Step 1: The README**

In `README.md`, replace:

```markdown
| `@cuttle/recorder` | Records a take on Windows: a monitor, region or window (ddagrab), webcam and mic (DirectShow), input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |
| `@cuttle/core` | Project operations for the CLI and the app: `cuttle.json` as written (hash-checked writes, backups), takes, suggest, recover, frame, ffmpeg |
| `apps/cli` | The `cuttle` command: init, devices, record, suggest, preview, frame, capture-page, render, recover; `--json` for Claude |
| `skill/` | The Claude skill: `SKILL.md` (the workflow) and `project.md` (the `cuttle.json` reference), installed by `pnpm skill:install` |

## Development
```

with:

```markdown
| `@cuttle/recorder` | Records a take on Windows: a monitor, region or window (ddagrab), webcam and mic (DirectShow), input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |
| `@cuttle/core` | Project operations for the CLI and the app: `cuttle.json` as written (hash-checked writes, backups), takes, suggest, recover, frame, ffmpeg |
| `apps/cli` | The `cuttle` command: init, devices, record, suggest, preview, frame, capture-page, render, recover; `--json` for Claude |
| `apps/desktop` | The Cuttle app (Electron, React): the pill and tray, an editor per project (the export's engine in the output view, played with the mic as the clock; a timeline with thumbnails, waveform, markers and input activity; the export sheet) |
| `skill/` | The Claude skill: `SKILL.md` (the workflow) and `project.md` (the `cuttle.json` reference), installed by `pnpm skill:install` |

## Development
```

In the same file, replace:

```markdown
recorder tests also need ffprobe. Recording works on Windows so far; the recorder's tests use its
`test` backend (ffmpeg test sources, synthetic input), which runs everywhere.

## The CLI

`pnpm cli:install` builds the CLI and puts `cuttle` on PATH: shims in npm's global folder
```

with:

````markdown
recorder tests also need ffprobe. Recording works on Windows so far; the recorder's tests use its
`test` backend (ffmpeg test sources, synthetic input), which runs everywhere.

## The desktop app

```bash
pnpm app                                 # build and start the app (the pill near the top of the screen, an icon in the tray)
pnpm app -- --open <project folder>      # … and open a project in the editor
pnpm app:check                           # end to end with its windows hidden: open, play, scrub, compare with the export, export
pnpm app:build                           # an unpacked app in apps/desktop/build/Cuttle-<platform>-<arch>/, checked that it starts
```

The editor shows exactly what the export renders: the same engine and timeline, compared pixel for
pixel by `app:check`. It plays a 720p proxy of the take (made in the background into the project's
`.cuttle/` folder, with the thumbnails and the mic's waveform); the export always uses the take.
Editing arrives in a later milestone; in this version the timeline and inspector show the project.
Recording from the app comes next; until then, record with `cuttle record`.

## The CLI

`pnpm cli:install` builds the CLI and puts `cuttle` on PATH: shims in npm's global folder
````

- [ ] **Step 2: All tests and the typecheck**

Run: `pnpm test`
Expected: PASS, 427 tests in 47 files, 14 skipped (the real-capture test and the Electron checks: cli, app, build).

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 3: Commit, and nothing left behind**

```bash
git add README.md
git commit -m "docs: the desktop app in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Run: `git status --short`
Expected: no output.

- [ ] **Step 4: By hand (the user)**

Start the app (`pnpm app`), see the pill near the top of the primary screen and the tray icon, open a recorded project with "Open", play it (sound and picture together), scrub, switch the preview to 9:16, and export. This needs a person; the checks above never show a window.

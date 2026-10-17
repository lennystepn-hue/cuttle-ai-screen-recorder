# Phase 2 spike: the desktop app

Date: 2026-10-17. Machine as in the M4–M6 spikes (Windows 11 Pro 26200, three displays, the primary
2560×1440 at 125 %; Electron 44.7.2, Mediabunny 1.61.0, ffmpeg 9.0). The spike scripts lived in the
planning session's scratchpad (`p2spike/`); nothing here touched the user's screen beyond pixel counts
of test windows, and no capture was kept. The design spec that uses these results:
`docs/superpowers/specs/2026-10-17-cuttle-desktop-design.md`.

## 1. A capture-excluded HUD (2026-10-17)

`protect.mjs` (scratchpad/p2spike), Electron 44.7.2, Windows 11 26200, primary monitor 2560×1440 at
125 %: a frameless 400×300 DIP window (magenta) over a 440×340 one (green), both `alwaysOnTop`,
`showInactive`, `focusable: false`; ddagrab (`output_idx=0`, region inside the magenta window,
3 frames, BGRA) counted pixels only (nothing was looked at, nothing kept).

| `setContentProtection` | magenta | green (window behind) | black |
|---|---|---|---|
| false | 1.000 | 0 | 0 |
| true | 0 | 1.000 | 0 |
| false again | 1.000 | 0 | 0 |

So Electron's content protection is `WDA_EXCLUDEFROMCAPTURE` on this Windows: the protected window
is not in the Desktop Duplication image at all, and what lies behind it is captured (no black box).
Toggling works at runtime. The recording HUD can float over the captured area.

## 2. Electron displays against the recorder's monitors

`displays.mjs`: `screen.getAllDisplays()` gives DIP bounds (the 125 % primary is 2048×1152 DIP);
`screen.dipToScreenRect(null, display.bounds)` gives exactly the DXGI desktop rectangles that
`listDevices()` reports (0,0 2560×1440; 2560,509 1920×1080; −1080,−335 1080×1920, rotation 270).
So the app maps an Electron display to the recorder's `Monitor.index` by equal physical bounds, and
a region picked in DIP on a display converts with `dipToScreenRect` minus the monitor's origin.
Display labels are the model names ("Q24h-10", two "VA27EHF"), not unique.

## 3. The recorder's native modules in Electron

koffi 3.3.2 (`GetCursorPos` through user32) and uiohook-napi 1.5.5 (start, 300 ms, stop) both load
and work in Electron 44's main process and in a `utilityProcess.fork` child (an ES module; it must
not import `app`/`utilityProcess` from `electron`, which a utility process does not provide: the
first try exited 1). So the app can run `record()` in a utility process, away from the main
process's event loop, and talk to it over `process.parentPort`.

## 4. Scrubbing and playback in a renderer (the editor's preview)

`seek/main.mjs`: a hidden window reads the treg take (2560×1440 H.264 High, 153 s, key frame every
2 s) through IPC byte ranges (as the export page does) with Mediabunny 1.61.0's `VideoSampleSink`.

| Decoder | random seek (`getSample`), median / p90 / max | 0.2 s scrub steps, median / max | sequential `samples(60, 70)` |
|---|---|---|---|
| prefer-hardware | 112 / 193 / 196 ms | 113 / 187 ms | 283 fps |
| prefer-software | 59 / 93 / 96 ms | 55 / 109 ms | 564 fps |

Software decoding wins here too (as in the export). A seek decodes from the key frame before it, so
nearby scrub steps cost as much as far ones: the player should drop stale seek requests (latest
wins, ~10–15 seeks/s) and play from a sequential iterator restarted at the playhead. The treg take
is a mostly still terminal; busier screens decode slower, so the editor measures and degrades (a
lower preview resolution) rather than assuming.

## 5. The recorder's window list in the app

`win32.ts` keeps EnumWindows' z-order (top first), so a picker hit-test takes the first window whose
bounds contain the point. It drops windows of its own process: in the app the recorder runs in a
utility process, so the app's own windows (overlay, HUD, editor; other processes) would be listed.
`WindowInfo` needs the window's id (HWND as a number) and process id, so the app can drop its own
and the recorder can capture a window by id rather than by title (titles are not unique).

## 6. Versions for the renderer UI (two weeks or older on 2026-10-17)

react / react-dom 19.3.0 (2026-09-09; 19.3.1 is from 2026-10-14), @types/react and
@types/react-dom 19.3.0, @vitejs/plugin-react 6.1.1 (2026-08-28; 6.1.2 is from 2026-10-05).
A store library is not needed: a small store with `useSyncExternalStore` holds the project.

## 7. Design mockups render with our own capture-page

`p2design/editor.html` (a static HTML mockup at 1600×1000) rendered with
`cuttle capture-page … --width 1600 --height 1000` (offscreen, scale 1) gives a PNG to look at and
iterate on, without touching the screen. Editor v1 critique: the inspector mixes the selection
(zoom) with the Look sections (the spec: only the selection's settings; Look when nothing is
selected); the timeline leaves its bottom empty; tools need icons; the zoom rect's outside should
dim on the preview; the scene lane's thumbnails should be real frames.

## 8. A real pause: segments, joined on stop

A pause that keeps recording would capture exactly what the user paused for. So a pause stops the
track processes and a resume starts new ones (segment files); on stop the segments are joined.
`concat/`: two 3 s fragmented-MP4 segments made with the recorder's flags (libx264 ultrafast,
frag_keyframe+empty_moov+default_base_moof, flush_packets, key frame every 2 s) join with the concat
demuxer and `-c copy` in 0.09 s: 180 frames, 6.000 s, decodes cleanly. AAC segments joined the same
way come out 6.046 s: each segment's encoder priming adds ~23 ms, so the mic would drift ~23 ms per
pause. The mic (and the webcam) are joined with a filter instead: each segment trimmed and delayed
to its screen segment's start and duration, then `concat=v=0:a=1` and one AAC encode (cheap).
events.jsonl keeps a running paused total so its seconds match the joined screen; input during a
pause is dropped.

## 9. Media for the editor over a custom protocol

`proto/`: `protocol.handle('cuttle-media', …)` (scheme registered as standard, secure, fetch, stream)
answers Range requests with 206 and a file stream; Mediabunny's `UrlSource` reads the treg take
through it: 7 ranged requests to open it, seeks of 21–64 ms (faster than the export page's IPC
reads). The same protocol serves stills, the background image, events.jsonl and markers.json to the
renderer, and only from inside the open project folder.

## 10. End-to-end tests of the app with Playwright

`pw/`: Playwright 1.64.1's `_electron.launch` with Electron 44 drives a window that is never
shown (`show: false`): click, read text, evaluate in the main process; 393 ms from launch to the
answer. So the app's e2e checks run without windows flashing on the screen.

# Cuttle

Screen recordings that edit themselves: record a monitor, region or window with webcam and mic,
then turn the take into a polished demo with cuts, speed-ups, smooth zooms, masks, a framed window
on a designed background, text overlays and an end card. A desktop app for people, a CLI and a
skill for Claude, one project file (`cuttle.json`) and one render engine for both.

Status: phase 1 in progress. Spec: `docs/superpowers/specs/2026-10-16-cuttle-design.md`.

## Packages

| Package | What it does |
|---|---|
| `@cuttle/project` | `cuttle.json` schema, defaults and readable validation errors |
| `@cuttle/timeline` | What is on screen at any output time: scenes, speed, zooms, masks, texts, cursor, crossfades |
| `@cuttle/engine` | WebGL2 compositor: backgrounds, window frames, zoom, masks, cursors, webcam, texts, stills, cards, crossfades |
| `@cuttle/export` | MP4 export in a hidden Electron window: decode, render, encode H.264, mux; mic cut to the scenes with ffmpeg (AAC) |
| `@cuttle/recorder` | Records a take on Windows: a monitor, region or window (ddagrab), webcam and mic (DirectShow), input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |

## Development

```bash
pnpm install
pnpm exec playwright install chromium   # once: headless Chromium for the engine tests
pnpm test                                # unit tests (Node) and engine golden images (Chromium)
pnpm typecheck
pnpm engine:electron                     # the engine goldens in a hidden Electron window
pnpm export:check                        # export a testsrc fixture to 16:9, 1:1, 9:16 and check it with ffprobe
pnpm recorder:real                       # record 3 s of the primary monitor for real, check the take, delete it
pnpm export:run <projectDir> --format 9:16 -o out.mp4   # export a project (until the CLI exists)
```

Export and recording need ffmpeg on PATH (or its path in `CUTTLE_FFMPEG`); `export:check` and the
recorder tests also need ffprobe. Recording works on Windows so far; the recorder's tests use its
`test` backend (ffmpeg test sources, synthetic input), which runs everywhere.

Engine golden images live in `packages/engine/test/__golden__/`, one PNG per platform. A new
scenario writes its PNG on the first run and fails once so you can look at it.
`pnpm exec vitest run -u` rewrites goldens after an intended change of look; that run fails once
for every rewritten PNG, so look at each one and run the tests again.

# Cuttle

Screen recordings that edit themselves: record a monitor, region or window with webcam and mic,
then turn the take into a polished demo with cuts, speed-ups, smooth zooms, masks, a framed window
on a designed background, text overlays and an end card. A desktop app for people, a CLI and a
skill for Claude, one project file (`cuttle.json`) and one render engine for both. Runs on
Windows and macOS.

Status: phase 1 (engine, CLI, skill) done; phase 2 (the desktop app) in progress. Specs:
`docs/superpowers/specs/2026-10-16-cuttle-design.md` and `2026-10-17-cuttle-desktop-design.md`;
design mockups in `docs/design/desktop/`.

## Packages

| Package | What it does |
|---|---|
| `@cuttle/project` | `cuttle.json` schema, defaults and readable validation errors |
| `@cuttle/timeline` | What is on screen at any output time: scenes, speed, zooms, masks, texts, cursor, crossfades (none at a continuous cut), overlay ramps in output time |
| `@cuttle/engine` | WebGL2 compositor: backgrounds, window frames, zoom, masks, cursors, webcam, texts, stills, cards, crossfades |
| `@cuttle/export` | MP4 export in a hidden Electron window: decode, render, encode H.264, mux; mic cut to the scenes with ffmpeg (AAC) |
| `@cuttle/recorder` | Records a take on Windows (ddagrab, DirectShow, a global input hook) and macOS (avfoundation, an event tap): a monitor, region or window, webcam and mic, input events, markers; stops by hotkey, time, a file, an idle screen or the end of a Claude Code turn |
| `@cuttle/core` | Project operations for the CLI and the app: `cuttle.json` as written (hash-checked writes, backups), takes, suggest, recover, frame, ffmpeg |
| `apps/cli` | The `cuttle` command: init, devices, record, suggest, preview, frame, capture-page, render, recover; `--json` for Claude |
| `apps/desktop` | The Cuttle app (Electron, React): the pill and tray, an editor per project (the export's engine in the output view, played with the mic as the clock; a timeline with thumbnails, waveform, markers and input activity; the export sheet) |
| `skill/` | The Claude skill: `SKILL.md` (the workflow) and `project.md` (the `cuttle.json` reference), installed by `pnpm skill:install` |

## Setup

| | Windows | macOS (Apple silicon or Intel) |
|---|---|---|
| Node 22 or newer | `winget install OpenJS.NodeJS.LTS` | `brew install node`, or the installer from nodejs.org |
| pnpm 11 | `corepack enable` (or `npm install -g pnpm@11`) | the same |
| ffmpeg and ffprobe | `winget install Gyan.FFmpeg` | `brew install ffmpeg` |
| Transcription (whisper) | in Gyan's ffmpeg (its `whisper` filter) | `brew install whisper-cpp` (no macOS ffmpeg has the filter; Cuttle runs `whisper-cli` instead) |
| Permissions | none | the first recording asks for them (see below) |

`pnpm install` also downloads Electron's binary for the platform. Native modules come prebuilt:
koffi (the OS APIs) for both, uiohook-napi (the input hook) for Windows.

**macOS permissions.** macOS asks the app the recorder runs in: the terminal for the `cuttle`
command, Cuttle (or "Electron" when it runs from this repository) for the app. Allow it under
System Settings > Privacy & Security: *Screen & System Audio Recording* (needed; quit and reopen
the app afterwards), *Microphone* and *Camera* (when a take uses them), *Input Monitoring*
(the clicks, scrolls, key counts and hotkeys; without it a take has no input log and warns), and
*Accessibility* (where text is typed, for zooms that follow typing; where a notification banner
is and a browser's page; without it zooms follow what the screen changes, a notification is
masked on the whole right side of the screen and the crop comes from the picture).

## Development

```bash
pnpm install
pnpm exec playwright install chromium   # once: headless Chromium for the engine tests
pnpm test                                # unit tests (Node) and engine golden images (Chromium)
pnpm typecheck
pnpm engine:electron                     # the engine goldens in a hidden Electron window (Windows; skipped on macOS, see main.mjs)
pnpm export:check                        # export a testsrc fixture to 16:9, 1:1, 9:16 and check it with ffprobe
pnpm recorder:real                       # record 3 s of the primary monitor and first mic for real, check, delete
pnpm cli:check                           # build the CLI; preview, capture-page and render through it in Electron
pnpm cuttle <command>                    # the built CLI without installing it (runs in the repo root)
```

The checks of reading the screen draw their text with ffmpeg's `drawtext`: on macOS they need
`brew install ffmpeg-full` (keg-only: put `$(brew --prefix ffmpeg-full)/bin` first on PATH), as
Homebrew's `ffmpeg` has no `drawtext`.

Export and recording need ffmpeg on PATH (or its path in `CUTTLE_FFMPEG`); `export:check` and the
recorder tests also need ffprobe. Recording works on Windows and macOS; the recorder's tests use its
`test` backend (ffmpeg test sources, synthetic input), which runs everywhere.

## The desktop app

```bash
pnpm app                                 # build and start the app (the pill near the top of the screen, an icon in the tray)
pnpm app -- --open <project folder>      # … and open a project in the editor
pnpm app -- --settings                   # … and show the settings
pnpm app:check                           # end to end with its windows hidden: open, play, scrub, compare with the export, play the proxy, export, edit, record, pause, the first run
pnpm app:build                           # an unpacked app in apps/desktop/build/Cuttle-<platform>-<arch>/ (Cuttle.exe, or Cuttle.app on macOS) with its own CLI, checked that it starts
pnpm icons                               # draw both platforms' icons and the app's mark (tools/icons.mjs; the icns on macOS only)
```

**Signing on macOS.** `pnpm app:build` signs Cuttle.app when `CUTTLE_SIGN_IDENTITY` names an
identity: a "Developer ID Application: …" from the keychain, or `-` for an ad-hoc signature that runs
on this Mac only. It signs with the hardened runtime and `apps/desktop/scripts/entitlements.mac.plist`
(JIT, the native modules, camera, microphone), the capture helper and the native modules included,
and zips the app (`apps/desktop/build/Cuttle-<version>-mac-<arch>.zip`). It also notarizes with
`CUTTLE_NOTARIZE_PROFILE` (a profile from `xcrun notarytool store-credentials`), or with `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.

```bash
CUTTLE_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" CUTTLE_NOTARIZE_PROFILE=cuttle pnpm app:build
```

The icons are one design for both platforms (`tools/icons.mjs`): the brand's arrow grown into a
cuttlefish on the orange tile, a full tile for Windows (icon.ico, tray.png) and a squircle with a
glass highlight for macOS (icon.icns, the Dock icon, the menu bar's template icon), a plain
silhouette at 32 px and below, and the same silhouette as the app's own mark (`renderer/mark.ts`).

The editor shows exactly what the export renders: the same engine and timeline, compared pixel for
pixel by `app:check`. It plays a 720p proxy of the take (made in the background into the project's
`.cuttle/` folder, with the thumbnails and the mic's waveform); the export always uses the take.

**Editing.** Every edit is written to `cuttle.json` as its gesture ends, so Claude and the CLI see it
at once, and one gesture is one step to undo (Ctrl+Z, Ctrl+Shift+Z; on a Mac ⌘ works wherever Ctrl
does). On the timeline: S splits the
clip at the playhead, edges trim, a dragged scene moves, R or the bar sets a clip's speed, overlays
move and stretch (Alt copies, Ctrl skips snapping). The tools beside the video: V selects (a click
on a caption picks it), Z and M draw a zoom or a mask on the screen itself (the source view, Esc
for the video), T types a caption on the video. The inspector edits the selection and the look;
Ctrl+K lists every command and its keys. A change written while the project is open (by Claude,
the CLI or `suggest`) shows in a note with Undo; a gesture under way is carried over onto it, and
what cannot be is kept in `cuttle.json.draft` with "Use mine". `cuttle record` refuses a project
that is open in the app ("Record again" records it there).

**Recording.** "New recording" on the pill, in the tray (the menu bar on macOS), or Ctrl+Shift+Alt+R
(Ctrl+Shift+Option+R on a Mac) shows a picker over every display: the window under the pointer lights up (the display where there is none), a drag draws a
region, and the bar sets the camera, the mic and when to stop (your stop, Claude's answer, an idle
screen). After the countdown only a small HUD remains, which never appears in the video;
Ctrl+Shift+Alt+S stops and Ctrl+Shift+Alt+M sets a marker. Pause (the HUD, or Ctrl+Shift+Alt+P)
records nothing until you resume; the pieces are joined at the stop. Restart is a held press: the
take is put aside, the countdown starts again, and the editor offers "Undo restart". The editor
opens on the take at once while `suggest` cuts it in the background. "Record again" adds a take to
the project; the earlier one stays restorable ("Back to take 1"). New projects go into
`~/Cuttle/<date time>`.

**First run and settings.** The first start looks for ffmpeg where Windows has it now (also right
after `winget install Gyan.FFmpeg`: "Check again", no restart), on macOS also in Homebrew's folders
and `~/.local/bin` (an app started from the Dock does not see a terminal's PATH), and installs, on
request, the `cuttle` command (the app's own copy of the CLI, run by the app itself, in
`%LOCALAPPDATA%\Cuttle\bin`, which goes on your PATH; `~/.local/bin` on macOS) and the Claude skill. The settings (the tray,
the pill's menu, Ctrl+, in the editor) hold the projects folder, the countdown, the default camera
and mic, starting at sign-in, motion, and the recent projects (open, rename, show, remove).

## The CLI

`pnpm cli:install` builds the CLI and puts `cuttle` on PATH: shims in npm's global folder
(`%APPDATA%\npm` on Windows, `~/.local/bin` on macOS, where zsh needs
`export PATH="$HOME/.local/bin:$PATH"` in `~/.zshrc` once; `CUTTLE_BIN_DIR` picks another one).
`pnpm cli:uninstall` removes them.

```bash
cuttle init demo && cd demo
cuttle devices                       # monitors, windows, cameras, microphones
cuttle record --mic --until-claude   # stops when Claude Code in this folder ends its turn (or Ctrl+C)
cuttle suggest                       # scenes: quiet start and end trimmed, idle cut, waiting sped up, zooms on the answer and on clicks
cuttle preview                       # 12 stills and a contact sheet in preview/
cuttle frame 42.5 --grid             # a source frame with a numbered pixel grid, for masks and zooms
cuttle capture-page https://example.com --scroll --add
cuttle render --format 9:16          # out/9x16.mp4
cuttle recover takes/2               # after a crash
```

Every command takes `-C <project folder>` and `--json` (one JSON document on stdout, errors as
`{ "error": { "code", "message" } }`). Exit codes: 0 ok, 1 usage or validation, 2 device or
permission, 3 render, 130 cancelled with Ctrl+C.

## The Claude skill

`pnpm skill:install` copies the skill into Claude Code's personal skills
(`~/.claude/skills/cuttle/`, or under `CLAUDE_CONFIG_DIR`) with this repository's path filled in.
`pnpm skill:uninstall` removes it; a `cuttle` skill it did not install is never touched. The skill
needs `cuttle` on PATH (`pnpm cli:install`). Then ask Claude Code for a demo video, or type
`/cuttle`.

Engine golden images live in `packages/engine/test/__golden__/`, one PNG per platform. A new
scenario writes its PNG on the first run and fails once so you can look at it.
`pnpm exec vitest run -u` rewrites goldens after an intended change of look; that run fails once
for every rewritten PNG, so look at each one and run the tests again.

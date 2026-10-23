# Cuttle: notes for Claude

Cuttle runs on **Windows and macOS**. A change made on one has to keep working on the other; CI
(`.github/workflows/ci.yml`) runs the typecheck and the node tests on `windows-latest` and
`macos-latest` for every pull request. The README says how to set up and check each platform.

## Where the platforms differ

- **Platform code stays in its own modules.** Recorder: `win32.ts` (DXGI, Win32) and `darwin.ts`
  (CoreGraphics, the ObjC runtime) through koffi; `mac-capture.ts` with `native/macos/capture.swift`
  (the ScreenCaptureKit helper, built by `postinstall`); the ffmpeg inputs per platform in
  `sources.ts`. App: `desktop-pixels.ts`. Shared code takes a `Platform` (`windows`, `macos`,
  `test`) or checks `process.platform` once, at the edge.
- **Desktop pixels**: physical pixels on Windows, a display's backing pixels on macOS (see
  `darwin.ts`). Never call Electron's `screen.dipToScreenRect`, `screenToDipRect` or
  `dipToScreenPoint` directly: they exist on Windows only. Use `desktop-pixels.ts`.
- **Keys**: every Ctrl shortcut also takes ⌘ (`event.ctrlKey || event.metaKey`). The recording
  hotkeys are Ctrl+Shift+Alt+letter on both (Option on a Mac; macOS virtual key codes in `input.ts`).
- **Input**: uiohook-napi on Windows only; on macOS it deadlocks Node at the first key press, so
  macOS uses the event tap in `darwin.ts`, each event at its own timestamp. The caret: Win32's
  system caret on Windows, the Accessibility API on macOS (the character before the insertion point;
  Electron apps and Chromium browsers show it only once asked, `askForText`). Where neither tells,
  typing zooms follow where the screen changes on from the field clicked into (`typing.ts`).
- **Cuttle's windows in a take**: Windows leaves out content-protected windows; macOS leaves out
  the windows of `hideWindowsOf` (the app's process) through the ScreenCaptureKit helper. A new
  window that must not show in takes needs content protection and to belong to the app's process.
- **A window take**: macOS's helper takes the window by itself (`--window`, ScreenCaptureKit), so
  what lies over it or is done elsewhere is not in the take, and `window-gate.ts` logs only the input
  done in it (none while another window is in front, no popups, the origin following the window).
  Windows still records the screen where the window is, so whatever covers it shows: Windows'
  counterpart would be Windows.Graphics.Capture.
- **Windows of the app**: title bar buttons sit on the right on Windows, the traffic lights on the
  left on macOS (`titleBar()` in `windows.ts`, `:root[data-platform='darwin']` in CSS). macOS opens
  an app's windows behind the active app: show what the person asked for with `bringToFront()`.
  Overlays need `enableLargerThanScreen` to cover the menu bar.
- **Files**: Windows refuses to replace a read-only or open file; POSIX renames over it. Windows
  compares paths ignoring case. macOS's temporary folder is behind a link (`/var` is
  `/private/var`): tests compare real paths.
- **The computer's sound** (`--system-audio`, `system-audio.ts`): macOS through the capture
  helper's `audio` (ScreenCaptureKit: the display's sound without Cuttle's processes, or a window's
  app alone), Windows through `native/windows/loopback.cs` (`cuttle-loopback.exe`, WASAPI's loopback
  of the default output device: everything it plays), built by `native/build-windows.mjs` with
  .NET Framework's C# compiler (C# 5). Both write 48 kHz stereo float, silence where nothing played,
  and stamp their first sample on the wall clock; a change to that protocol changes both.
- **Whisper**: Windows transcribes with ffmpeg's `whisper` filter (Gyan's builds have it); no macOS
  ffmpeg does, so `speech/whisper.ts` runs whisper.cpp's `whisper-cli` with the filter's settings
  there (`whisperEngine()`). A change to how whisper runs changes both.
- **What opens over the screen** (dialog zooms, notification masks, the crop to a page): Windows
  tells them by window class (`windowKind` in `win32.ts`) and a page by Chromium's render widget;
  macOS by CGWindowList level and shape (`macPopups` in `darwin.ts`: modal panels and centred
  sheets are dialogs) and, through the Accessibility API, the Notification Center's banners and a
  browser's page (`pageOf`). macOS hides notifications from screen recordings unless the person
  allows them while sharing the screen.
- **The screen's text**: Windows' own OCR through a PowerShell helper, macOS's Vision through
  `cuttle-capture ocr`; both speak the protocol in `core/src/privacy/ocr.ts`. Vision's boxes jitter
  around still text, which the privacy masks allow for (`MASK_RULES.jitter`).
- **Words for people** name both ways: `winget install Gyan.FFmpeg` and `brew install ffmpeg`,
  Windows' Settings and macOS's System Settings (Privacy & Security for the screen, camera,
  microphone and Input Monitoring).
- **Icons**: one generator for both, `tools/icons.mjs` (`pnpm icons`): Windows' icon.ico, icon.png
  and tray.png, macOS's icon.icns (packed on a Mac only), icon-mac.png and trayTemplate, and the
  app's mark (`renderer/mark.ts`). A change to the design is made there, never to one platform's files.

## Checks

- Everywhere: `pnpm typecheck`, `pnpm test`. Engine goldens are kept per platform
  (`*.win32.png`, `*.darwin.png`).
- On the machine itself: `pnpm recorder:real`, `pnpm app:check`, `pnpm app:build` (Cuttle.exe
  or Cuttle.app). A change to the other platform's module that could not be run there is said so
  in the pull request: CI covers the types and the test backend, not a real capture.

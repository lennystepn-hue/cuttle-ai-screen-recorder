# Cuttle: The Capture Helper Runs Where the App Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `cuttle-capture` (the screen through ScreenCaptureKit, and the OCR) runs on every macOS the app says it runs on: 13 and later.

**Architecture:**
- **A fixed target.** `packages/recorder/native/build-macos.mjs` builds the helper for `<arch>-apple-macos13.0`, the app's minimum. Before, it took the build machine's SDK.
  - An API newer than 13.0 is then a compile error. A later change has to guard it with `#available`.
  - The helper is built again when the build script changed, not only when `capture.swift` did. A target that changes then reaches every checkout.
- **A guard when packaging.** `apps/desktop/scripts/package.mjs` stops on macOS if the packaged helper's `minos` is newer than the app's `LSMinimumSystemVersion`. The release workflow runs `package.mjs`, so a release cannot ship it again.
- **A test.** A node test on macOS checks that the built helper needs no newer macOS than Electron's app does. CI runs it on `macos-latest` for every pull request.

**Tech Stack:** Swift (`swiftc -target`), Node scripts, vitest, `otool`, `plutil`.

Conventions for every task:

- Run all commands from the repo root `/Users/lennyenderle/Desktop/Cuttle`, on the branch `helper-macos-target` (from `main`), in zsh.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Don't touch `packages/core/src/use-take.ts`: a parallel PR changes it.

## What was looked into

**The mismatch**

| What | Minimum macOS |
|---|---|
| The app (Electron 44's Info.plist `LSMinimumSystemVersion`, and its binary's `minos`) | 13.0 |
| The installed 0.1.1's `cuttle-capture` (`otool -l`, `LC_BUILD_VERSION`) | **26.0** (SDK 26.5, the release runner's) |
| The dev helper built here (SDK 27.0) | **27.0** |

`build-macos.mjs` runs `xcrun swiftc -O -swift-version 5 -o … capture.swift` without `-target`, so the target is the SDK's own version.

**What that does on an older macOS**
- A higher `minos` by itself does not stop it: a helper built for 28.0 ran here on 27.0.
- What stops it is what the build links. The 0.1.1 helper links `/usr/lib/swift/libswift_DarwinFoundation3.dylib` strongly (`LC_LOAD_DYLIB`), together with newer runtime entry points such as `swift_getTypeByMangledNameInContext2` and `_swiftImmortalRefCount`.
- Built from the same source, `swiftc` links that library only for a target of 26.0. For 14.0 it links `libswiftDarwin`, for 15.x neither.
- So on macOS 13, 14 and 15 (there is no 16–25), the 0.1.1 helper most likely fails to load. Not run on such a Mac here.
- `record.ts` takes the helper whenever its file exists (`captureHelper()`), with no fallback to avfoundation. So on those systems the screen take and the OCR would fail, not just leave Cuttle's windows in the take.

**What the helper needs**
- `capture.swift` from `main` and from #66 both compile for `arm64-apple-macos13.0` without an error or a guard.
- For 12.3, `SCStreamConfiguration.capturesAudio` is "only available in macOS 13.0 or newer". For 11.0, ScreenCaptureKit itself is missing.
- So 13.0 is both the app's minimum and the helper's own floor.

**The architecture:** the release builds on `macos-latest` (Apple silicon) for `process.arch`. The target follows the build machine's arch: `arm64`, or `x86_64` on an Intel Mac.

## Decisions

- **13.0, from Electron:** the helper runs wherever the app does. The value is written once in `build-macos.mjs`, with why.
  - The test compares the built helper with Electron's own `LSMinimumSystemVersion`. An Electron that raises its minimum leaves the helper fine, since it runs on more. Only a helper that needs more fails.
- **Rebuild when the script changes:** the stale check compares the binary with `capture.swift` and with `build-macos.mjs`. Without that, `pnpm install` in a checkout that had built the helper before would keep its 27.0 build.
- **The guard is in `package.mjs`, not in the build check.** The release workflow runs `package.mjs` directly and not `build.check.test.ts`. It reads the packaged helper's `minos` with `otool -l` and the packaged app's `LSMinimumSystemVersion` with `plutil`.
- **Not done here:** a fallback to avfoundation when the helper cannot start. With the target, it starts.

## File structure

| File | Responsibility |
|---|---|
| `packages/recorder/native/build-macos.mjs` | `-target <arch>-apple-macos13.0`; rebuilt when the script changes |
| `apps/desktop/scripts/package.mjs` | stops when the packaged helper needs a newer macOS than the app |
| `packages/recorder/test/mac-capture.test.ts` | the built helper needs no newer macOS than Electron's app |

---

### Task 1: The target, the guard, the test

**Files:**
- Modify: `packages/recorder/native/build-macos.mjs`, `apps/desktop/scripts/package.mjs`
- Test: `packages/recorder/test/mac-capture.test.ts`

- [ ] **Step 1: The failing test**

In `mac-capture.test.ts`, add a test on macOS only (`it.runIf(process.platform === 'darwin')`):
- It reads the built helper's `minos` (`otool -l`, `LC_BUILD_VERSION`).
- It reads Electron's `LSMinimumSystemVersion`, from `electron/dist/Electron.app/Contents/Info.plist` found from the repo root.
- It expects the helper's to be no newer.

Run: `pnpm exec vitest run --project node packages/recorder/test/mac-capture.test.ts`
Expected: FAIL here, since the dev helper is 27.0.

- [ ] **Step 2: The target** (`build-macos.mjs`)

```js
/** The oldest macOS the helper runs on: the app's (Electron's LSMinimumSystemVersion), and ScreenCaptureKit's capturesAudio's. */
const MACOS = '13.0';
const target = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos${MACOS}`;
// … ['swiftc', '-O', '-swift-version', '5', '-target', target, '-o', binary, source]
```

The stale check also takes the script's own time: `statSync(fileURLToPath(import.meta.url)).mtimeMs`.

- [ ] **Step 3: The guard** (`package.mjs`)

After packaging on macOS:
- Compare the helper's `minos` under `Cuttle.app/Contents/Resources/app.asar.unpacked/cli/cuttle-capture` with the app's `LSMinimumSystemVersion`.
- Throw when the helper's is newer, naming both.

- [ ] **Step 4: Run the test, then commit**

```bash
node packages/recorder/native/build-macos.mjs
pnpm exec vitest run --project node packages/recorder/test/mac-capture.test.ts
```

### Task 2: The checks

- [ ] `pnpm typecheck`, `pnpm test`.
- [ ] On the Mac: `pnpm recorder:real`, then `pnpm app:build`, unsigned. Its `package.mjs` runs the guard, and the packaged helper says `minos 13.0`.
- [ ] The PR says that no Mac with macOS 13–15 was at hand. What a helper built for 26.0 links, and what one built for 13.0 links, was compared with `otool` and `dyld_info`.

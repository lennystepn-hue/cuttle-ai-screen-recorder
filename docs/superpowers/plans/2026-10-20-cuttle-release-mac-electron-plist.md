# Cuttle: The macOS Release Reads Electron's Minimum From a Fetched Electron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Release workflow builds the macOS app of 0.1.2.

The first run for 0.1.2 built Windows and failed on macOS in `package.mjs` before packaging:
- `plutil -extract LSMinimumSystemVersion … electron/dist/Electron.app/Contents/Info.plist`: "The file “Info.plist” couldn’t be opened because there is no such file."
- The check came with #69: the capture helper must not need a newer macOS than Electron's app.
- Electron 44 is not installed with its package. `require('electron')` fetches the binary the first time it is used (`index.js`: "Downloading Electron binary..."). The packager takes a copy of its own, so on the release runner nothing had fetched it.
- #69's test read the same path. In CI it passed only because tests that ran before it had fetched Electron.

**Architecture:** `apps/desktop/scripts/package.mjs` and `packages/recorder/test/mac-capture.test.ts` take the path through `require('electron')`. It fetches the binary where it is missing, and returns its executable, `dist/Electron.app/Contents/MacOS/Electron` on macOS (`install.js`'s `getPlatformPath`). The Info.plist is two folders up from it, in `Electron.app/Contents`.

**Tech Stack:** Node (ESM script), vitest, Electron 44.7.2.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `release-mac-electron-plist`, in Git Bash.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions made while planning

- **Through Electron's own entry point, not its `install.js`:** `require('electron')` is what Electron's tools and the app checks use. It honours `ELECTRON_OVERRIDE_DIST_PATH` and fetches only when the binary is missing.
- **The check stays before packaging:** a release still stops before it is signed and notarized when the helper needs a newer macOS.
- **Proven on macOS by CI:** the test is macOS-only, and the PR's `macos-latest` job runs it through the same path. The release workflow's next run is the check of `package.mjs`.
- Checked on the prototype (Windows): `package.mjs` parses, `require('electron')` returns the executable (`dist/electron.exe` here; `install.js` names `Electron.app/Contents/MacOS/Electron` for macOS), the test file passes (4, the macOS one skipped), `pnpm typecheck` passes.

---

### Task 1: Electron fetched before its Info.plist is read

**Files:**
- Modify: `apps/desktop/scripts/package.mjs`
- Test: `packages/recorder/test/mac-capture.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `release-mac-electron-plist`; work there:

```bash
git switch release-mac-electron-plist
```

- [ ] **Step 2: The test through `require('electron')`**

In `packages/recorder/test/mac-capture.test.ts`, replace:

```ts
  it.runIf(process.platform === 'darwin')('is built for the oldest macOS the app runs on, not for the SDK of the Mac that builds it', () => {
    const helper = captureHelper('');
    expect(helper, 'cuttle-capture is built (pnpm install)').toBeDefined();
    // the app's minimum is Electron's own (package.mjs takes its Info.plist as it is)
    const electron = dirname(createRequire(join(import.meta.dirname, '..', '..', '..', 'package.json')).resolve('electron/package.json'));
    const app = execFileSync('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', join(electron, 'dist', 'Electron.app', 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
    const minos = minosOf(helper!);
    expect(minos).toBeDefined();
    expect(compareVersions(minos!, app), `cuttle-capture needs macOS ${minos}, the app runs on ${app}`).toBeLessThanOrEqual(0);
```

with:

```ts
  it.runIf(process.platform === 'darwin')('is built for the oldest macOS the app runs on, not for the SDK of the Mac that builds it', () => {
    const helper = captureHelper('');
    expect(helper, 'cuttle-capture is built (pnpm install)').toBeDefined();
    // the app's minimum is Electron's own (package.mjs takes its Info.plist as it is); `require('electron')`
    // fetches the binary where it is missing, as package.mjs does, and says where its executable is
    const executable = createRequire(join(import.meta.dirname, '..', '..', '..', 'package.json'))('electron') as string;
    const app = execFileSync('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', join(dirname(dirname(executable)), 'Info.plist')], { encoding: 'utf8' }).trim();
    const minos = minosOf(helper!);
    expect(minos).toBeDefined();
    expect(compareVersions(minos!, app), `cuttle-capture needs macOS ${minos}, the app runs on ${app}`).toBeLessThanOrEqual(0);
```

- [ ] **Step 3: The release script likewise**

In `apps/desktop/scripts/package.mjs`, replace:

```js
if (process.platform === 'darwin') {
  // the capture helper (the CLI's copy, which the app takes) runs wherever the app does: on the macOS of
  // Electron's own Info.plist. 0.1.1's was built for the release runner's macOS 26. Before packaging,
  // so a release stops before it is signed and notarized.
  const helper = join(cli, 'cuttle-capture');
  const app = execFileSync('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', join(dirname(electron), 'dist', 'Electron.app', 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
  const minos = existsSync(helper) ? execFileSync('otool', ['-l', helper], { encoding: 'utf8' }).match(/cmd LC_BUILD_VERSION[\s\S]*?minos (\S+)/)?.[1] : undefined;
  const parts = (version) => version.split('.').map(Number);
  const newer = minos !== undefined && parts(minos).reduce((order, part, i) => order || part - (parts(app)[i] ?? 0), 0) > 0;
```

with:

```js
if (process.platform === 'darwin') {
  // the capture helper (the CLI's copy, which the app takes) runs wherever the app does: on the macOS of
  // Electron's own Info.plist. 0.1.1's was built for the release runner's macOS 26. Before packaging,
  // so a release stops before it is signed and notarized. Electron's binary is not installed with the
  // package (the packager takes a copy of its own): `require('electron')` fetches it where it is missing,
  // and says where its executable is, in Electron.app/Contents/MacOS.
  const helper = join(cli, 'cuttle-capture');
  const executable = createRequire(join(desktop, '..', '..', 'package.json'))('electron');
  const app = execFileSync('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', join(dirname(dirname(executable)), 'Info.plist')], { encoding: 'utf8' }).trim();
  const minos = existsSync(helper) ? execFileSync('otool', ['-l', helper], { encoding: 'utf8' }).match(/cmd LC_BUILD_VERSION[\s\S]*?minos (\S+)/)?.[1] : undefined;
  const parts = (version) => version.split('.').map(Number);
  const newer = minos !== undefined && parts(minos).reduce((order, part, i) => order || part - (parts(app)[i] ?? 0), 0) > 0;
```

Run: `node --check apps/desktop/scripts/package.mjs && pnpm exec vitest run --project node packages/recorder/test/mac-capture.test.ts`
Expected: PASS (on macOS 5 tests; elsewhere 4, the macOS one skipped).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/scripts/package.mjs packages/recorder/test/mac-capture.test.ts
git commit -m "release: macOS reads Electron's minimum from a fetched Electron

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The typecheck

- [ ] **Step 1: Run it**

Run: `pnpm typecheck`
Expected: exits with code 0.

## After the merge

Point the draft `v0.1.2` at the merge commit (`gh release edit v0.1.2 --target <sha>`) and run the Release workflow again. It adds the macOS installers to the draft, and replaces the Windows ones with the same build of the newer commit.

## Changes during execution

- It was written from the finished prototype and replayed on a fresh clone for its commit; the tree came out byte-identical to the prototype.

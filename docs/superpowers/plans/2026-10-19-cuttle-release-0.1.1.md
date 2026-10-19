# Cuttle 0.1.1: Installers, Updates in the App, a Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuttle can be downloaded and keeps itself up to date.
- **Version 0.1.1:** the user chose the number.
- **Downloads:** a Windows installer and a Mac DMG on the GitHub release.
- **Updates:** the app looks for a new version once a day, downloads it and installs it when it quits.
- **CI:** the CI workflow is on again; the repository is public, so GitHub's standard runners cost nothing.
- **The release workflow** builds both platforms and makes the draft release; someone publishes it.

**Architecture:**
- **Installers** (`apps/desktop/scripts/installer.mjs`): electron-builder 26 makes them from the app package.mjs packaged (`prepackaged`), into `apps/desktop/build/installers`.
  - Windows: NSIS, one click, per user, into `%LOCALAPPDATA%\Programs\cuttle`, where Cuttle has always gone.
  - macOS: a DMG and the zip the updates use.
  - Beside them `latest.yml` and `latest-mac.yml`. With `--publish` they go to the draft GitHub release of the version.
- **The update feed** (`resources/app-update.yml`): package.mjs writes it from `scripts/releases.mjs`, which reads package.json's `repository`. It names GitHub and the cache folder `cuttle-updater`.
- **Updates in the app** (electron-updater 6):
  - `update-state.ts` turns the updater's events into an `UpdateStatus`. It is pure and tested with a fake updater.
  - `updates.ts` wires it: the first check 30 s after the start, then one a day while `settings.updates` is on. The download happens in the background and the install when Cuttle quits.
  - The settings' General page shows it, under Updates.
  - The end-to-end check has a feed of its own (`CUTTLE_UPDATE_FEED`) and never asks GitHub.
- **The Release workflow** (`.github/workflows/release.yml`, started by hand):
  - It makes the draft release from `docs/releases/<version>.md`.
  - It builds Windows on `windows-latest` and macOS on `macos-latest` (Apple silicon) and adds the installers.
  - macOS is signed and notarized with the repository's Apple secrets; without them its build is the run's artifact.

**Tech Stack:** electron-builder 26.15.3 and electron-updater 6.8.9 (the maintainers' `latest`, both from June 2026), NSIS 3, GitHub Actions.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `release-0.1.1`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- ffmpeg must be on PATH. The checks never show a window, never capture this machine and never ask GitHub for updates.
- The full `pnpm test` and the typecheck run in Task 3.

## Decisions made while planning

The finished prototype passed `pnpm test` (995 tests, 81 skipped, in two full runs), the typecheck, `cli:check` (16 tests) and `app:check` (58), after the fixes at the end of this plan. Every screenshot was looked at. Its Windows installer was made from a clone at a short path (see the decisions): `Cuttle-0.1.1-win-x64.exe` (122 MB), its blockmap and `latest.yml`, installing as `APP_FILENAME=cuttle`.

**The installer**
- **electron-builder's NSIS installer from the packaged folder** (`prepackaged`), not Squirrel: Squirrel installs into `%LOCALAPPDATA%\<name>`, which is Cuttle's own data folder (its models and the `cuttle` command), into a new folder per version. NSIS puts the app where package.mjs's folder has always been installed, so the `cuttle` command and the login item keep their path.
- **`extraMetadata.name: 'cuttle'`:** without it electron-builder names the install folder and the update cache after the workspace's package name, `@cuttledesktop`. The installer's defines read `APP_FILENAME=cuttle` and `cuttle-updater\installer.exe` now.
- **`electron-winstaller: false`** in pnpm's `allowBuilds`: electron-builder brings Squirrel's installer maker, whose install script Cuttle does not need. pnpm 11 refuses to install until each build script is allowed or not.
- **Not signed on Windows:** a certificate costs money every year. SmartScreen may warn, and the README and the release notes say what to press.
- **A long path breaks the installer build on Windows:** electron-builder starts `makensis` in its template folder inside pnpm's store. Below the scratchpad that folder's path is over 260 characters, and Windows reports `ENOENT`. In the repository (and on GitHub's runners) the path is short; the prototype's installer was made from a short clone.

**The updates**
- **`app-update.yml` in the app's resources:** electron-updater reads its download cache's folder from that file, so a feed set in code alone fails at the download. The packaged app has it, from the repository in package.json, and a test keeps that, the settings' link and both versions alike.
- **When it looks:**
  - The first check comes 30 s after the start (no slower start) and then one a day, while the setting is on (default).
  - The download runs in the background, and the install happens when Cuttle quits.
  - *Restart and update* installs at once, never while a take records.
  - A repository without a release yet (or whose latest release has no file for this platform) counts as "nothing newer", not as a failure. GitHub says so in its own words; any other 404 is a failure.
- **What it says, in the settings (General, Updates):**
  - this version;
  - nothing newer (and when it looked);
  - a version found, downloading with a bar, ready;
  - a failure in one line, with *Try again* and *Download page*.
  - Run from the repository it says to use `git pull`.
- **The check:**
  - Its settings turn the daily check off.
  - Its server serves a feed with version 99.0.0: run from the repository, the app reports Electron's version.
  - *Check now* shows "Version 99.0.0 is out." and *Download version 99.0.0*.
  - It downloads nothing: electron-updater would keep the file in the user's real `%LOCALAPPDATA%`.

**The release**
- **A draft first:** the workflow makes the release as a draft (`gh release create --draft`). electron-builder adds the files to it, and a person publishes it. Installed apps see only published releases.
- **macOS signing and notarizing:**
  - package.mjs already signs with `CUTTLE_SIGN_IDENTITY` and notarizes with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.
  - The workflow imports `APPLE_CERTIFICATE_P12` into a keychain of the run and reads the identity from it.
  - Updates on a Mac need a signed app, so an unsigned macOS build is not released.
- **Apple silicon only:** `macos-latest` is arm64. Intel Macs can run Cuttle from the repository.
- **CI is on again:** the user turned it off when the private repository's minutes were used up. Public repositories use GitHub's standard runners for free, and the user said to turn it on.

## File structure

| File | Responsibility |
|---|---|
| `apps/desktop/package.json`, `apps/cli/src/main.ts` | version 0.1.1, the author, electron-updater and electron-builder |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Squirrel's install script not run; the lockfile from `pnpm install` |
| `apps/desktop/scripts/releases.mjs`, `package.mjs`, `installer.mjs`, `package.json` | the feed in the app, the installers (`pnpm app:installer`) |
| `apps/desktop/src/main/update-state.ts`, `updates.ts` | the updates |
| `apps/desktop/src/shared/ipc.ts`, `channels.ts`, `src/main/settings.ts`, `settings-window.ts`, `index.ts`, `src/renderer/settings/Settings.tsx` | the setting, the requests, the settings' Updates |
| `.github/workflows/release.yml`, `docs/releases/0.1.1.md`, `README.md` | the release |

---

### Task 1: Version 0.1.1, the update feed in the app, the installer

**Files:**
- Create: `apps/desktop/scripts/releases.mjs` (and its types, `releases.d.mts`), `apps/desktop/scripts/installer.mjs`
- Modify: `apps/desktop/package.json`, `apps/cli/src/main.ts`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/desktop/scripts/package.mjs`, `package.json`
- Test: `apps/desktop/test/build.check.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `release-0.1.1`; work there:

```bash
git switch release-0.1.1
```

- [ ] **Step 2: Write the failing test**

The packaged app has the version and its update feed:

In `apps/desktop/test/build.check.test.ts`, replace:

```ts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

with:

```ts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

In the same file, replace:

```ts

  it('opens a project and draws its first frame', async () => {
    expect(await app.evaluate(({ app: electronApp }) => [electronApp.getName(), electronApp.isPackaged])).toEqual(['Cuttle', true]);
    const pixels: string = await editor.evaluate(() => (window as unknown as { __cuttleCheck: { pixels(): string } }).__cuttleCheck.pixels());
    expect(pixels.length).toBeGreaterThan(10_000);
  });
```

with:

```ts

  it('opens a project and draws its first frame', async () => {
    expect(await app.evaluate(({ app: electronApp }) => [electronApp.getName(), electronApp.isPackaged])).toEqual(['Cuttle', true]);
    // its version, and its update feed beside the archive (electron-updater reads it there)
    const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getVersion())).toBe(version);
    expect(readFileSync(join(RESOURCES, 'app-update.yml'), 'utf8')).toContain('updaterCacheDirName: cuttle-updater');
    const pixels: string = await editor.evaluate(() => (window as unknown as { __cuttleCheck: { pixels(): string } }).__cuttleCheck.pixels());
    expect(pixels.length).toBeGreaterThan(10_000);
  });
```

- [ ] **Step 3: The version, the author, the two packages**

In `apps/desktop/package.json`, replace:

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
```

with:

```json
{
  "name": "@cuttle/desktop",
  "version": "0.1.1",
  "private": true,
  "type": "module",
  "description": "Cuttle: screen recordings that edit themselves",
  "author": "Lenny Enderle",
  "dependencies": {
    "@cuttle/core": "workspace:*",
    "@cuttle/engine": "workspace:*",
```

In the same file, replace:

```json
    "@cuttle/recorder": "workspace:*",
    "@cuttle/timeline": "workspace:*",
    "@fontsource/inter": "5.3.0",
    "koffi": "3.3.2",
    "mediabunny": "1.61.0",
    "react": "19.3.0",
```

with:

```json
    "@cuttle/recorder": "workspace:*",
    "@cuttle/timeline": "workspace:*",
    "@fontsource/inter": "5.3.0",
    "electron-updater": "6.8.9",
    "koffi": "3.3.2",
    "mediabunny": "1.61.0",
    "react": "19.3.0",
```

In the same file, replace:

```json
    "@electron/packager": "20.3.0",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1"
  }
}
```

with:

```json
    "@electron/packager": "20.3.0",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "electron-builder": "26.15.3"
  }
}
```

In `apps/cli/src/main.ts`, replace:

```ts
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';

export const VERSION = '0.1.0';

const seconds = (value: string): number => {
  const parsed = Number(value);
```

with:

```ts
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';

export const VERSION = '0.1.1';

const seconds = (value: string): number => {
  const parsed = Number(value);
```

In `pnpm-workspace.yaml`, replace:

```yaml
allowBuilds:
  # its postinstall downloads the Electron binary (checked against its checksums)
  electron: true
  koffi: false
  uiohook-napi: false
```

with:

```yaml
allowBuilds:
  # its postinstall downloads the Electron binary (checked against its checksums)
  electron: true
  # electron-builder's Squirrel installer, which Cuttle does not build (its installer is NSIS)
  electron-winstaller: false
  koffi: false
  uiohook-napi: false
```

The lockfile follows from the new dependencies:

```bash
pnpm install
```

- [ ] **Step 4: The feed in the app, and the installers**

`apps/desktop/scripts/releases.mjs`:

```js
// Where Cuttle's releases are: the GitHub repository of package.json's "repository"
// (github:<owner>/<repo>). The installers are published there, and the app's updates read them.
import { readFileSync } from 'node:fs';

const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const match = /^github:([^/]+)\/(.+)$/.exec(root.repository ?? '');
if (!match) throw new Error(`package.json's repository is not github:<owner>/<repo>: ${root.repository}`);
export const RELEASES = { owner: match[1], repo: match[2] };

/**
 * The packaged app's update feed (electron-updater reads resources/app-update.yml): the GitHub
 * releases, the downloads kept in %LOCALAPPDATA%\\cuttle-updater (macOS: ~/Library/Caches/cuttle-updater),
 * where the installer keeps itself too.
 */
export const APP_UPDATE_YML = `provider: github\nowner: ${RELEASES.owner}\nrepo: ${RELEASES.repo}\nupdaterCacheDirName: cuttle-updater\n`;
```

`apps/desktop/scripts/releases.d.mts`:

```
// The types of releases.mjs (for the tests that read it).
/** The GitHub repository of package.json's "repository". */
export declare const RELEASES: { owner: string; repo: string };
/** The packaged app's update feed, resources/app-update.yml. */
export declare const APP_UPDATE_YML: string;
```

In `apps/desktop/scripts/package.mjs`, replace:

```js
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const build = join(desktop, 'build');
```

with:

```js
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { APP_UPDATE_YML } from './releases.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const build = join(desktop, 'build');
```

In the same file, replace:

```js
if (!existsSync(join(cli, 'cuttle.mjs'))) throw new Error('apps/cli/dist is missing: run "pnpm cli:build" first');
rmSync(build, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

/**
 * The real folder of package `name` as Node finds it from the folder `from` (node_modules there and
```

with:

```js
if (!existsSync(join(cli, 'cuttle.mjs'))) throw new Error('apps/cli/dist is missing: run "pnpm cli:build" first');
rmSync(build, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
// the update feed, beside the app's archive in its resources folder (electron-updater looks there)
const updateFeed = join(build, 'app-update.yml');
writeFileSync(updateFeed, APP_UPDATE_YML);

/**
 * The real folder of package `name` as Node finds it from the folder `from` (node_modules there and
```

In the same file, replace:

```js
  platform: process.platform,
  arch: process.arch,
  icon: join(desktop, 'assets', process.platform === 'win32' ? 'icon.ico' : process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
  // the CLI and the native modules whole (with their package.json files), so Node resolves them
  asar: { unpack: '**/{*.node,*.dll,cuttle-capture}', unpackDir: `{cli,${[...modules.keys()].map((name) => `node_modules/${name}`).join(',')}}` },
  prune: false,
```

with:

```js
  platform: process.platform,
  arch: process.arch,
  icon: join(desktop, 'assets', process.platform === 'win32' ? 'icon.ico' : process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
  extraResource: [updateFeed],
  // the CLI and the native modules whole (with their package.json files), so Node resolves them
  asar: { unpack: '**/{*.node,*.dll,cuttle-capture}', unpackDir: `{cli,${[...modules.keys()].map((name) => `node_modules/${name}`).join(',')}}` },
  prune: false,
```

`apps/desktop/scripts/installer.mjs`:

```js
// Makes the installers and the update files from the packaged app (package.mjs's
// build/Cuttle-<platform>-<arch>) with electron-builder, into build/installers:
// - Windows: an NSIS installer, one click, for this user only (into %LOCALAPPDATA%\Programs\Cuttle,
//   where package.mjs's app has always gone), with Start menu and desktop shortcuts. Not signed.
// - macOS: a DMG and the zip the updates use, the app inside as package.mjs signed and notarized it.
// Beside them latest.yml (latest-mac.yml), which the app's updates read (electron-updater). With
// --publish they go to this version's GitHub release, a draft until someone publishes it (GH_TOKEN).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Arch, Platform, build } from 'electron-builder';
import { RELEASES } from './releases.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(createRequire(join(desktop, '..', '..', 'package.json')).resolve('electron/package.json'), 'utf8')).version;
const mac = process.platform === 'darwin';
const packaged = join(desktop, 'build', `Cuttle-${process.platform}-${process.arch}`);
const publish = process.argv.includes('--publish');

const files = await build({
  projectDir: desktop,
  targets: mac ? Platform.MAC.createTarget(['dmg', 'zip'], Arch[process.arch]) : Platform.WINDOWS.createTarget(['nsis'], Arch[process.arch]),
  prepackaged: mac ? join(packaged, 'Cuttle.app') : packaged,
  publish: publish ? 'always' : 'never',
  config: {
    appId: 'app.cuttle.desktop',
    productName: 'Cuttle',
    executableName: 'Cuttle',
    copyright: 'Copyright © 2026 Lenny Enderle',
    electronVersion,
    // the name it installs under (%LOCALAPPDATA%\Programs\cuttle) and keeps its updates under (cuttle-updater)
    extraMetadata: { name: 'cuttle' },
    npmRebuild: false,
    directories: { output: join(desktop, 'build', 'installers') },
    artifactName: `Cuttle-\${version}-\${os}-\${arch}.\${ext}`,
    win: { icon: join(desktop, 'assets', 'icon.ico') },
    nsis: { oneClick: true, perMachine: false, deleteAppDataOnUninstall: false, shortcutName: 'Cuttle' },
    // package.mjs signed (and notarized) the app already
    mac: { identity: null, icon: join(desktop, 'assets', 'icon.icns'), category: 'public.app-category.video' },
    publish: [{ provider: 'github', ...RELEASES, releaseType: 'draft' }],
  },
});
console.log(`made Cuttle ${manifest.version}:\n${files.map((file) => `  ${file}`).join('\n')}`);
```

In `package.json`, replace:

```json
    "app": "pnpm app:build:js && electron apps/desktop/dist/main/index.mjs",
    "app:check": "pnpm app:build:js && pnpm cli:build && vitest run --mode app apps/desktop/test/app.check.test.ts",
    "app:build": "pnpm app:build:js && pnpm cli:build && node apps/desktop/scripts/package.mjs && vitest run --mode build apps/desktop/test/build.check.test.ts",
    "icons": "electron tools/icons.mjs",
    "skill:install": "node skill/install.mjs",
    "skill:uninstall": "node skill/install.mjs --uninstall"
```

with:

```json
    "app": "pnpm app:build:js && electron apps/desktop/dist/main/index.mjs",
    "app:check": "pnpm app:build:js && pnpm cli:build && vitest run --mode app apps/desktop/test/app.check.test.ts",
    "app:build": "pnpm app:build:js && pnpm cli:build && node apps/desktop/scripts/package.mjs && vitest run --mode build apps/desktop/test/build.check.test.ts",
    "app:installer": "node apps/desktop/scripts/installer.mjs",
    "icons": "electron tools/icons.mjs",
    "skill:install": "node skill/install.mjs",
    "skill:uninstall": "node skill/install.mjs --uninstall"
```

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `pnpm app:installer`
Expected: `made Cuttle 0.1.1:` with `Cuttle-0.1.1-win-x64.exe` and its `.blockmap`, and `latest.yml` beside them in `apps/desktop/build/installers`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/package.json apps/cli/src/main.ts pnpm-workspace.yaml pnpm-lock.yaml apps/desktop/scripts package.json apps/desktop/test/build.check.test.ts
git commit -m "release: version 0.1.1, the update feed in the app, the installers (pnpm app:installer)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Updates in the app

**Files:**
- Create: `apps/desktop/src/main/update-state.ts`, `apps/desktop/src/main/updates.ts`, `apps/desktop/test/updates.test.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/main/settings.ts`, `apps/desktop/src/main/settings-window.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/renderer/settings/Settings.tsx`
- Test: `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: Write the failing tests**

The updates with a fake updater, and the release's names kept alike:

`apps/desktop/test/updates.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createUpdates, failureOf, type Updater } from '../src/main/update-state';

/** An updater whose check and download do what the test says, and say it as electron-updater does. */
class FakeUpdater implements Updater {
  private readonly listeners = new Map<string, ((...args: never[]) => void)[]>();
  on(event: string, listener: (...args: never[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) (listener as (...values: unknown[]) => void)(...args);
  }
  check: () => void = () => this.emit('update-not-available', {});
  fetch: () => void = () => {};
  quitAndInstall = vi.fn();
  checkForUpdates() {
    return Promise.resolve().then(() => this.check());
  }
  downloadUpdate() {
    return Promise.resolve().then(() => this.fetch());
  }
}

const base = { version: '0.1.1', supported: true, autoDownload: true };
const at = () => 1_000;

describe('updates', () => {
  it('finds nothing newer: the newest version, when it looked', async () => {
    const updates = createUpdates(new FakeUpdater(), base, at);
    expect(updates.status()).toEqual({ version: '0.1.1', supported: true, state: 'idle' });
    expect(await updates.check()).toEqual({ version: '0.1.1', supported: true, state: 'current', checked: 1_000 });
  });

  it('finds a version, downloads it by itself with progress, and installs it when asked', async () => {
    const updater = new FakeUpdater();
    updater.check = () => updater.emit('update-available', { version: '0.1.2' });
    const updates = createUpdates(updater, base, at);
    const seen: string[] = [];
    updates.onStatus((status) => seen.push(status.state));
    expect(updates.install()).toBe(false);
    await updates.check();
    expect(updates.status()).toMatchObject({ state: 'downloading', next: '0.1.2' });
    updater.emit('download-progress', { transferred: 40, total: 100 });
    expect(updates.status()).toMatchObject({ state: 'downloading', download: { received: 40, total: 100 } });
    // no second check while it downloads
    expect(await updates.check()).toBe(updates.status());
    updater.emit('update-downloaded', { version: '0.1.2' });
    expect(updates.status()).toEqual({ version: '0.1.1', supported: true, state: 'ready', next: '0.1.2', checked: 1_000 });
    expect(updates.install()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(seen).toEqual(['checking', 'downloading', 'downloading', 'ready']);
  });

  it('downloads only when asked where the updater does not by itself, and can try again', async () => {
    const updater = new FakeUpdater();
    updater.check = () => updater.emit('update-available', { version: '0.2.0' });
    updater.fetch = () => updater.emit('error', new Error('net::ERR_CONNECTION_RESET\n    at …'));
    const updates = createUpdates(updater, { ...base, autoDownload: false }, at);
    await updates.check();
    expect(updates.status()).toMatchObject({ state: 'available', next: '0.2.0' });
    await updates.download();
    expect(updates.status()).toMatchObject({ state: 'failed', next: '0.2.0', failure: 'net::ERR_CONNECTION_RESET' });
    updater.fetch = () => updater.emit('update-downloaded', { version: '0.2.0' });
    await updates.download();
    expect(updates.status()).toMatchObject({ state: 'ready', next: '0.2.0' });
  });

  it('says why a check failed, in a line; a repository without a release yet has nothing newer', async () => {
    const updater = new FakeUpdater();
    updater.check = () => {
      updater.emit('error', new Error('getaddrinfo ENOTFOUND api.github.com'));
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    };
    const updates = createUpdates(updater, base, at);
    expect(await updates.check()).toMatchObject({ state: 'failed', failure: 'getaddrinfo ENOTFOUND api.github.com' });
    // a rejection without an event counts too
    updater.check = () => {
      throw new Error('Unable to find latest version on GitHub (https://github.com/o/r/releases/latest), please ensure a production release exists');
    };
    expect(await updates.check()).toMatchObject({ state: 'current', checked: 1_000 });
    expect(failureOf(new Error(`HttpError: 500\n${'x'.repeat(400)}`))).toEqual({ message: 'HttpError: 500' });
    // another server's 404 is a failure (its feed is missing), and says so
    expect(failureOf(new Error('HttpError: 404 \n"method: GET url: http://127.0.0.1/updates/latest.yml"'))).toEqual({ message: 'HttpError: 404' });
    expect(failureOf('a'.repeat(200))).toEqual({ message: `${'a'.repeat(157)}…` });
  });

  it('does nothing where the app cannot update (run from the repository)', async () => {
    const updater = new FakeUpdater();
    const check = vi.spyOn(updater, 'checkForUpdates');
    const updates = createUpdates(updater, { ...base, supported: false }, at);
    expect(await updates.check()).toEqual({ version: '0.1.1', supported: false, state: 'idle' });
    expect(check).not.toHaveBeenCalled();
  });
});

describe('the release', () => {
  it("names one version for the app and the cuttle command, and the releases' page of package.json's repository", async () => {
    const desktop = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const cli = readFileSync(new URL('../../cli/src/main.ts', import.meta.url), 'utf8');
    expect(cli).toContain(`export const VERSION = '${desktop.version}';`);
    const { RELEASES, APP_UPDATE_YML } = await import('../scripts/releases.mjs');
    expect(RELEASES).toEqual({ owner: 'lennystepn-hue', repo: 'cuttle-ai-screen-recorder' });
    expect(APP_UPDATE_YML).toBe('provider: github\nowner: lennystepn-hue\nrepo: cuttle-ai-screen-recorder\nupdaterCacheDirName: cuttle-updater\n');
    expect(readFileSync(new URL('../src/main/updates.ts', import.meta.url), 'utf8')).toContain(`'https://github.com/${RELEASES.owner}/${RELEASES.repo}/releases'`);
  });
});
```

The settings' Updates in the end-to-end check, with the check's own feed:

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
  });
}

describe.runIf(enabled)('the Cuttle app', () => {
  let root: string;
  let project: string;
```

with:

```ts
  });
}

/** The check's update feed (electron-updater's latest.yml, latest-mac.yml): a version far ahead of any. */
const UPDATE_FEED = [
  'version: 99.0.0',
  'files:',
  '  - url: Cuttle-99.0.0-win-x64.exe',
  '    sha512: AAAA',
  '    size: 1',
  '  - url: Cuttle-99.0.0-mac-arm64.zip',
  '    sha512: AAAA',
  '    size: 1',
  'path: Cuttle-99.0.0-win-x64.exe',
  'sha512: AAAA',
  "releaseDate: '2026-10-19T00:00:00.000Z'",
  '',
].join('\n');

describe.runIf(enabled)('the Cuttle app', () => {
  let root: string;
  let project: string;
```

In the same file, replace:

```ts
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    // New recordings go into a folder of the check's own.
    mkdirSync(join(root, 'user-data'));
    // The screen is read after a take's cut only where the check asks for it (it says so in the settings).
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects'), privacy: { read: false } }));
    // the desktop's wallpaper the check gives the app
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720', '-frames:v', '1', join(root, 'wallpaper.png')], { windowsHide: true });
    // the logo the brand's file dialog picks
```

with:

```ts
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    // New recordings go into a folder of the check's own.
    mkdirSync(join(root, 'user-data'));
    // The screen is read after a take's cut only where the check asks for it (it says so in the settings),
    // and updates are looked for only when the check asks.
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects'), privacy: { read: false }, updates: false }));
    // the desktop's wallpaper the check gives the app
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720', '-frames:v', '1', join(root, 'wallpaper.png')], { windowsHide: true });
    // the logo the brand's file dialog picks
```

In the same file, replace:

```ts
    models = createServer((request, response) => {
      if (request.url === '/ggml-base.bin' && BASE_MODEL) return void response.end(readFileSync(BASE_MODEL));
      if (request.url === '/ggml-small.bin') return void response.end('not a model');
      if (request.url === '/ggml-large-v3-turbo-q5_0.bin') {
        response.write(Buffer.alloc(1_000_000));
        return void hanging.push(response);
```

with:

```ts
    models = createServer((request, response) => {
      if (request.url === '/ggml-base.bin' && BASE_MODEL) return void response.end(readFileSync(BASE_MODEL));
      if (request.url === '/ggml-small.bin') return void response.end('not a model');
      // the update feed (asked with ?noCache=…): a version far ahead of this app's (run from the repository it reports Electron's)
      const path = request.url?.split('?')[0];
      if (path === '/updates/latest.yml' || path === '/updates/latest-mac.yml') return void response.end(UPDATE_FEED);
      if (request.url === '/ggml-large-v3-turbo-q5_0.bin') {
        response.write(Buffer.alloc(1_000_000));
        return void hanging.push(response);
```

In the same file, replace:

```ts
        CUTTLE_WALLPAPER: join(root, 'wallpaper.png'),
        // what the spoken test mic says
        CUTTLE_TEST_SPEECH: SPOKEN,
      },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
```

with:

```ts
        CUTTLE_WALLPAPER: join(root, 'wallpaper.png'),
        // what the spoken test mic says
        CUTTLE_TEST_SPEECH: SPOKEN,
        // the updates' feed, the check's own server (never GitHub)
        CUTTLE_UPDATE_FEED: `http://127.0.0.1:${(models.address() as { port: number }).port}/updates/`,
      },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
```

In the same file, replace:

```ts
    await settings.waitForSelector('[data-testid=launch-at-login][aria-checked=true]');
    await click(settings, '[data-testid=launch-at-login]');
    await expect.poll(() => saved().launchAtLogin).toBe(false);
    // demo is open in its editor: Rename is off there, and the main process refuses it too
    await click(settings, '[data-testid=settings-page-projects]');
    await settings.waitForSelector('.recent li');
```

with:

```ts
    await settings.waitForSelector('[data-testid=launch-at-login][aria-checked=true]');
    await click(settings, '[data-testid=launch-at-login]');
    await expect.poll(() => saved().launchAtLogin).toBe(false);
    // updates, from the check's feed: not looked for by itself (the settings say so), found when asked
    const updateLine = () => settings.locator('[data-testid=updates-line] .row-hint').textContent();
    expect(await updateLine()).toBe('Not looked for a new version yet.');
    expect(await settings.locator('[data-testid=updates-auto]').getAttribute('aria-checked')).toBe('false');
    await click(settings, '[data-testid=updates-check]');
    await expect.poll(updateLine, { timeout: 10_000 }).toBe('Version 99.0.0 is out.');
    expect(await settings.locator('[data-testid=updates-download]').textContent()).toBe('Download version 99.0.0');
    await settings.locator('[data-testid=updates-line]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('49-updates', '/settings.html');
    // demo is open in its editor: Rename is off there, and the main process refuses it too
    await click(settings, '[data-testid=settings-page-projects]');
    await settings.waitForSelector('.recent li');
```

Run: `pnpm exec vitest run --project node apps/desktop/test/updates.test.ts`
Expected: FAIL: `../src/main/update-state` does not exist.

- [ ] **Step 2: The updates**

`apps/desktop/src/main/update-state.ts`:

```ts
// The app's updates as the settings show them, from an updater's events (electron-updater's
// AppUpdater, or a test's): a check, a new version found and downloaded, ready to install when
// Cuttle quits. Pure: the updater and the clock come in (updates.ts gives electron-updater's).
import type { UpdateStatus } from '../shared/ipc';

/** What this needs of electron-updater's AppUpdater. */
export interface Updater {
  on(event: string, listener: (...args: never[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface Updates {
  status(): UpdateStatus;
  /** Calls `listener` with every new status; returns the function that stops it. */
  onStatus(listener: (status: UpdateStatus) => void): () => void;
  /** Asks for a newer version (not while one is checked, downloaded or ready). */
  check(): Promise<UpdateStatus>;
  /** Downloads the version found (where the updater does not by itself). */
  download(): Promise<UpdateStatus>;
  /** Quits and installs the version downloaded; false when none is ready. */
  install(): boolean;
}

/**
 * What a failure says, for people: its first line, short. GitHub without a release yet, or whose
 * latest release has no file for this platform, is no failure: there is nothing newer.
 */
export function failureOf(error: unknown): { none: true } | { message: string } {
  const text = error instanceof Error ? error.message : String(error);
  if (/ensure a production release exists|Cannot find latest/i.test(text)) return { none: true };
  const line = text.split(/\r?\n/).find((part) => part.trim() !== '')?.trim() ?? 'unknown error';
  return { message: line.length > 160 ? `${line.slice(0, 157)}…` : line };
}

/**
 * The updates of an app at `version`; `supported`: whether it can update at all (the packaged app);
 * `autoDownload`: whether the updater downloads a version it found by itself.
 */
export function createUpdates(updater: Updater, base: { version: string; supported: boolean; autoDownload: boolean }, now: () => number = Date.now): Updates {
  const { version, supported, autoDownload } = base;
  let current: UpdateStatus = { version, supported, state: 'idle' };
  const listeners = new Set<(status: UpdateStatus) => void>();
  const set = (next: Omit<UpdateStatus, 'version' | 'supported'>) => {
    current = { version, supported, ...next };
    for (const listener of listeners) listener(current);
  };
  const failed = (error: unknown) => {
    const failure = failureOf(error);
    if ('none' in failure) set({ state: 'current', checked: now() });
    else set({ state: 'failed', failure: failure.message, ...(current.next !== undefined && { next: current.next }), ...(current.checked !== undefined && { checked: current.checked }) });
  };

  updater.on('update-available', (info: { version: string }) => set({ state: autoDownload ? 'downloading' : 'available', next: info.version, checked: now() }));
  updater.on('update-not-available', () => set({ state: 'current', checked: now() }));
  updater.on('download-progress', (progress: { transferred: number; total: number }) => {
    if (current.next !== undefined) set({ state: 'downloading', next: current.next, download: { received: progress.transferred, total: progress.total }, ...(current.checked !== undefined && { checked: current.checked }) });
  });
  updater.on('update-downloaded', (info: { version: string }) => set({ state: 'ready', next: info.version, ...(current.checked !== undefined && { checked: current.checked }) }));
  updater.on('error', (error: unknown) => failed(error));

  const busy = () => current.state === 'checking' || current.state === 'downloading' || current.state === 'ready';
  return {
    status: () => current,
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async check() {
      if (!supported || busy()) return current;
      set({ state: 'checking', ...(current.checked !== undefined && { checked: current.checked }) });
      // the updater says what it found (and a failure) as events; a rejection without one still counts
      await updater.checkForUpdates().catch((error: unknown) => {
        if (current.state === 'checking') failed(error);
      });
      if (current.state === 'checking') set({ state: 'current', checked: now() });
      return current;
    },
    async download() {
      if (!supported || current.next === undefined || (current.state !== 'available' && current.state !== 'failed')) return current;
      set({ state: 'downloading', next: current.next, ...(current.checked !== undefined && { checked: current.checked }) });
      await updater.downloadUpdate().catch((error: unknown) => {
        if (current.state === 'downloading') failed(error);
      });
      return current;
    },
    install() {
      if (current.state !== 'ready') return false;
      // silent on Windows (the installer shows nothing), Cuttle starts again when it is done
      updater.quitAndInstall(true, true);
      return true;
    },
  };
}
```

`apps/desktop/src/main/updates.ts`:

```ts
// Updates from the project's GitHub releases (electron-updater): checked a little after the start
// and once a day while the setting says so, or with the settings' Check now; downloaded in the
// background, installed when Cuttle quits or at once with Restart and update (not while a take
// records). Only the packaged app updates: package.mjs puts its feed in its resources
// (app-update.yml, scripts/releases.mjs). The end-to-end check gives a feed of its own
// (CUTTLE_UPDATE_FEED) and downloads only when asked; without one it never looks.
import { app, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { CHECK } from './check';
import { recordingRuns } from './recording';
import { appVersion, loadSettings, onSettingsChange } from './settings';
import { createUpdates, type Updates } from './update-state';

/** The releases' page, which the settings link to (the repository of package.json, as scripts/releases.mjs reads it). */
export const RELEASES_PAGE = 'https://github.com/lennystepn-hue/cuttle-ai-screen-recorder/releases';
/** The first check waits this long after the start (it is no reason to start slower), then one a day. */
const FIRST_CHECK_MS = 30_000;
const EVERY_MS = 24 * 60 * 60 * 1000;

let service: Updates | undefined;

/** The app's updates (made once). */
export function updates(): Updates {
  if (service) return service;
  const feed = CHECK ? process.env.CUTTLE_UPDATE_FEED || undefined : undefined;
  const supported = CHECK ? feed !== undefined : app.isPackaged;
  const { autoUpdater } = electronUpdater;
  autoUpdater.logger = null;
  autoUpdater.autoDownload = !CHECK;
  autoUpdater.autoInstallOnAppQuit = true;
  if (feed) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  }
  service = createUpdates(autoUpdater, { version: appVersion(), supported, autoDownload: autoUpdater.autoDownload });
  return service;
}

/** Checks a little after the start and then once a day, while the setting says so. */
export async function startUpdates(): Promise<void> {
  const service = updates();
  if (!service.status().supported) return;
  let auto = (await loadSettings()).updates;
  onSettingsChange((settings) => {
    auto = settings.updates;
  });
  const look = () => {
    if (auto) void service.check();
  };
  setTimeout(look, FIRST_CHECK_MS);
  setInterval(look, EVERY_MS);
}

/** Restart and update: not while a take records (it is installed when Cuttle quits after it). */
export function installUpdate(): { problem?: string } {
  if (recordingRuns()) return { problem: 'Cuttle is recording. It updates after the stop, when it quits.' };
  return updates().install() ? {} : { problem: 'No update is ready yet.' };
}

/** The releases page, where every version can be downloaded by hand (the check opens no browser). */
export function openReleases(): Promise<void> {
  if (CHECK) {
    (globalThis as { __openedReleases?: number }).__openedReleases = ((globalThis as { __openedReleases?: number }).__openedReleases ?? 0) + 1;
    return Promise.resolve();
  }
  return shell.openExternal(RELEASES_PAGE);
}
```

- [ ] **Step 3: The setting, the requests, the settings' Updates**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
  failure?: { name: SpeechModelName; message: string };
}

/** The tools around the app: ffmpeg, and for Claude Code the cuttle command and the skill. */
export interface ToolsStatus {
  /** ffmpeg where the OS's PATH has it now (or WinGet's links folder), with its version. */
```

with:

```ts
  failure?: { name: SpeechModelName; message: string };
}

/** The app's updates (GitHub releases): what the last check found, a download, a version ready to install. */
export interface UpdateStatus {
  /** This app's version. */
  version: string;
  /** Whether it updates at all: the packaged app does (run from the repository it is updated with git). */
  supported: boolean;
  /**
   * `current`: nothing newer; `available`: `next` can be downloaded; `downloading`, then `ready`:
   * installed when Cuttle quits; `failed`: `failure` says why.
   */
  state: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'failed';
  next?: string;
  download?: { received: number; total: number };
  failure?: string;
  /** When the last check ended (ms since 1970). */
  checked?: number;
}

/** The tools around the app: ffmpeg, and for Claude Code the cuttle command and the skill. */
export interface ToolsStatus {
  /** ffmpeg where the OS's PATH has it now (or WinGet's links folder), with its version. */
```

In the same file, replace:

```ts
  /** `open`: the project is open in Cuttle, here (`here`) or on the computer named. */
  recent: { dir: string; name: string; opened: number; open?: string }[];
  version: string;
}

/** The params a motion page declares (its `cuttle-params`), and what is wrong with the declaration. */
```

with:

```ts
  /** `open`: the project is open in Cuttle, here (`here`) or on the computer named. */
  recent: { dir: string; name: string; opened: number; open?: string }[];
  version: string;
  /** Check for a new version once a day and download it. */
  updates: boolean;
}

/** The params a motion page declares (its `cuttle-params`), and what is wrong with the declaration. */
```

In the same file, replace:

```ts
    speechLive: z.boolean().optional(),
    privacyRead: z.boolean().optional(),
    privacyWords: z.array(z.string().trim().min(1).max(PRIVACY_WORD_MAX)).max(PRIVACY_WORDS_MAX).optional(),
  }),
  /** Asks for the projects folder (a folder dialog) and keeps it. */
  'settings:choose-folder': z.undefined(),
```

with:

```ts
    speechLive: z.boolean().optional(),
    privacyRead: z.boolean().optional(),
    privacyWords: z.array(z.string().trim().min(1).max(PRIVACY_WORD_MAX)).max(PRIVACY_WORDS_MAX).optional(),
    updates: z.boolean().optional(),
  }),
  /** Asks for the projects folder (a folder dialog) and keeps it. */
  'settings:choose-folder': z.undefined(),
```

In the same file, replace:

```ts
  'speech:download': z.enum(SPEECH_MODEL_NAMES),
  'speech:cancel': z.undefined(),
  'speech:remove': z.enum(SPEECH_MODEL_NAMES),
  /** Reads the screen's text of the project's take again and masks what it showed (the Auto tab, Try again). */
  'project:read-screen': z.undefined(),
  /** Fits the video to this many seconds where it rests, or takes the fit out (null). */
```

with:

```ts
  'speech:download': z.enum(SPEECH_MODEL_NAMES),
  'speech:cancel': z.undefined(),
  'speech:remove': z.enum(SPEECH_MODEL_NAMES),
  'updates:status': z.undefined(),
  /** Asks GitHub for a newer version now. */
  'updates:check': z.undefined(),
  /** Downloads the version found (the check downloads only when asked). */
  'updates:download': z.undefined(),
  /** Quits and installs the version downloaded (not while a take records). */
  'updates:install': z.undefined(),
  /** Opens the releases page in the browser. */
  'updates:releases': z.undefined(),
  /** Reads the screen's text of the project's take again and masks what it showed (the Auto tab, Try again). */
  'project:read-screen': z.undefined(),
  /** Fits the video to this many seconds where it rests, or takes the fit out (null). */
```

In the same file, replace:

```ts
  'speech:download': SpeechStatus;
  'speech:cancel': void;
  'speech:remove': SpeechStatus;
  /** Started (the title bar shows it), or why not. */
  'project:read-screen': { started: true } | { problem: string };
  /** What the fit did, once it is done, or why it could not. */
```

with:

```ts
  'speech:download': SpeechStatus;
  'speech:cancel': void;
  'speech:remove': SpeechStatus;
  'updates:status': UpdateStatus;
  'updates:check': UpdateStatus;
  'updates:download': UpdateStatus;
  /** Quitting to install, or why not. */
  'updates:install': { problem?: string };
  'updates:releases': void;
  /** Started (the title bar shows it), or why not. */
  'project:read-screen': { started: true } | { problem: string };
  /** What the fit did, once it is done, or why it could not. */
```

In the same file, replace:

```ts
  'settings:page': SettingsPage;
  /** The speech models changed, or a download moved on. */
  'speech:status': SpeechStatus;
  /** Every window: how motion is set now (`data-motion` on the page's root). */
  'app:motion': Motion;
  /** The motion items' pages in the editor's preview: loading, ready or failed, and what they said. */
```

with:

```ts
  'settings:page': SettingsPage;
  /** The speech models changed, or a download moved on. */
  'speech:status': SpeechStatus;
  /** An update was looked for, found, downloaded, or failed. */
  'updates:status': UpdateStatus;
  /** Every window: how motion is set now (`data-motion` on the page's root). */
  'app:motion': Motion;
  /** The motion items' pages in the editor's preview: loading, ready or failed, and what they said. */
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
      'speech:download',
      'speech:cancel',
      'speech:remove',
    ],
    events: ['settings:changed', 'settings:page', 'speech:status', 'app:motion'],
  },
} as const satisfies Record<string, { requests: readonly Request[]; events: readonly Event[] }>;
```

with:

```ts
      'speech:download',
      'speech:cancel',
      'speech:remove',
      'updates:status',
      'updates:check',
      'updates:download',
      'updates:install',
      'updates:releases',
    ],
    events: ['settings:changed', 'settings:page', 'speech:status', 'updates:status', 'app:motion'],
  },
} as const satisfies Record<string, { requests: readonly Request[]; events: readonly Event[] }>;
```

In `apps/desktop/src/main/settings.ts`, replace:

```ts
    })
    .catch({ read: true, words: [] })
    .default({ read: true, words: [] }),
  /** The picker bar's choices, kept between recordings (the camera and mic are the defaults in the settings). */
  record: z
    .object({ camera: z.string().optional(), mic: z.string().optional(), stop: z.enum(['none', 'claude', 'idle']).default('none'), claudeFolder: z.string().optional() })
```

with:

```ts
    })
    .catch({ read: true, words: [] })
    .default({ read: true, words: [] }),
  /** Check for a new version once a day and download it (updates.ts). */
  updates: z.boolean().catch(true).default(true),
  /** The picker bar's choices, kept between recordings (the camera and mic are the defaults in the settings). */
  record: z
    .object({ camera: z.string().optional(), mic: z.string().optional(), stop: z.enum(['none', 'claude', 'idle']).default('none'), claudeFolder: z.string().optional() })
```

In the same file, replace:

```ts
    privacy: { read: settings.privacy.read, words: [...settings.privacy.words] },
    recent: settings.recent,
    version: appVersion(),
  };
}
```

with:

```ts
    privacy: { read: settings.privacy.read, words: [...settings.privacy.words] },
    recent: settings.recent,
    version: appVersion(),
    updates: settings.updates,
  };
}
```

In `apps/desktop/src/main/settings-window.ts`, replace:

```ts
import { loadSettings, sameDir, settingsView, updateSettings } from './settings';
import { cancelSpeechDownload, downloadSpeechModel, onSpeechStatus, removeSpeechModel, speechStatus } from './speech';
import { installTools, skillFolder, toolsStatus } from './tools';
import { bringToFront, guard, lockDown, openEditorOrSay, showPill, titleBar, webPreferences } from './windows';

const BACKGROUND = '#0c0c0f';
```

with:

```ts
import { loadSettings, sameDir, settingsView, updateSettings } from './settings';
import { cancelSpeechDownload, downloadSpeechModel, onSpeechStatus, removeSpeechModel, speechStatus } from './speech';
import { installTools, skillFolder, toolsStatus } from './tools';
import { installUpdate, openReleases, updates } from './updates';
import { bringToFront, guard, lockDown, openEditorOrSay, showPill, titleBar, webPreferences } from './windows';

const BACKGROUND = '#0c0c0f';
```

In the same file, replace:

```ts
        if (change.privacyRead !== undefined) settings.privacy.read = change.privacyRead;
        // each word once, as it was first written
        if (change.privacyWords !== undefined) settings.privacy.words = change.privacyWords.filter((word, k, all) => all.findIndex((other) => other.toLowerCase() === word.toLowerCase()) === k);
      });
      if (change.launchAtLogin !== undefined) applyLoginItem(change.launchAtLogin);
      if (change.motion !== undefined) broadcastMotion(change.motion);
```

with:

```ts
        if (change.privacyRead !== undefined) settings.privacy.read = change.privacyRead;
        // each word once, as it was first written
        if (change.privacyWords !== undefined) settings.privacy.words = change.privacyWords.filter((word, k, all) => all.findIndex((other) => other.toLowerCase() === word.toLowerCase()) === k);
        if (change.updates !== undefined) settings.updates = change.updates;
      });
      if (change.launchAtLogin !== undefined) applyLoginItem(change.launchAtLogin);
      if (change.motion !== undefined) broadcastMotion(change.motion);
```

In the same file, replace:

```ts
    'speech:download': (name) => downloadSpeechModel(name),
    'speech:cancel': () => cancelSpeechDownload(),
    'speech:remove': (name) => removeSpeechModel(name),
  });
  // a download goes on while the window is closed; an open one follows it
  const offSpeech = onSpeechStatus((status) => {
    if (!contents.isDestroyed()) send(contents, 'speech:status', status);
```

with:

```ts
    'speech:download': (name) => downloadSpeechModel(name),
    'speech:cancel': () => cancelSpeechDownload(),
    'speech:remove': (name) => removeSpeechModel(name),
    'updates:status': () => updates().status(),
    'updates:check': () => updates().check(),
    'updates:download': () => updates().download(),
    'updates:install': () => installUpdate(),
    'updates:releases': () => openReleases(),
  });
  // a check or a download goes on while the window is closed; an open one follows it
  const offUpdates = updates().onStatus((status) => {
    if (!contents.isDestroyed()) send(contents, 'updates:status', status);
  });
  window.on('closed', offUpdates);
  // a download goes on while the window is closed; an open one follows it
  const offSpeech = onSpeechStatus((status) => {
    if (!contents.isDestroyed()) send(contents, 'speech:status', status);
```

In `apps/desktop/src/main/index.ts`, replace:

```ts
import { openSettings } from './settings-window';
import { findFfmpeg } from './tools';
import { createTray, updateTray, type TrayActions } from './tray';
import { chooseAndOpen, createPill, lockDown, openEditorOrSay, showPill } from './windows';

app.setName('Cuttle');
```

with:

```ts
import { openSettings } from './settings-window';
import { findFfmpeg } from './tools';
import { createTray, updateTray, type TrayActions } from './tray';
import { startUpdates } from './updates';
import { chooseAndOpen, createPill, lockDown, openEditorOrSay, showPill } from './windows';

app.setName('Cuttle');
```

In the same file, replace:

```ts
    else await showPill();
    // ffmpeg where the OS has it now (installed since the last login, say): the helpers start with it
    void findFfmpeg().catch(() => undefined);
    onSettingsChange((latest) => updateTray(latest.recent, actions));
  });
}
```

with:

```ts
    else await showPill();
    // ffmpeg where the OS has it now (installed since the last login, say): the helpers start with it
    void findFfmpeg().catch(() => undefined);
    // a newer version from GitHub's releases, a little after the start and once a day (the packaged app)
    void startUpdates();
    onSettingsChange((latest) => updateTray(latest.recent, actions));
  });
}
```

In `apps/desktop/src/renderer/settings/Settings.tsx`, replace:

```tsx
// The settings window, and the first run in the same window (#welcome): ffmpeg, the cuttle command
// and the Claude skill, then the pill. Every change is kept at once; there is no Save.
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import type { Motion, RequestArgument, SettingsPage, SettingsView, SpeechLanguage, SpeechModelName, SpeechStatus, ToolsStatus } from '../../shared/ipc';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, CopyIcon, FolderIcon, GearIcon, Mark, MaskIcon, MicIcon, RecordIcon, TerminalIcon, WarningIcon } from '../icons';
import { hotkeyKeys } from '../keys';
```

with:

```tsx
// The settings window, and the first run in the same window (#welcome): ffmpeg, the cuttle command
// and the Claude skill, then the pill. Every change is kept at once; there is no Save.
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import type { Motion, RequestArgument, SettingsPage, SettingsView, SpeechLanguage, SpeechModelName, SpeechStatus, ToolsStatus, UpdateStatus } from '../../shared/ipc';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, CopyIcon, FolderIcon, GearIcon, Mark, MaskIcon, MicIcon, RecordIcon, TerminalIcon, WarningIcon } from '../icons';
import { hotkeyKeys } from '../keys';
```

In the same file, replace:

```tsx
                      />
                    </Row>
                  </Section>
                </>
              )}
```

with:

```tsx
                      />
                    </Row>
                  </Section>
                  <Section title="Updates">
                    <Updates view={view} change={change} />
                  </Section>
                </>
              )}
```

In the same file, replace:

```tsx
  );
}

/** The command that installs ffmpeg, to copy into a terminal. */
function Winget() {
  const [copied, setCopied] = useState(false);
```

with:

```tsx
  );
}

/** "today at 14:05", or the date. */
function when(ms: number): string {
  const at = new Date(ms);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return at.toDateString() === new Date().toDateString() ? `today at ${time}` : `${at.toLocaleDateString()} at ${time}`;
}

/**
 * Updates from GitHub's releases: this version, what the last check found, the download, Restart
 * and update; and whether Cuttle looks by itself once a day.
 */
function Updates({ view, change }: { view: SettingsView | undefined; change: (next: RequestArgument<'settings:set'>) => void }) {
  const [status, setStatus] = useState<UpdateStatus>();
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    void bridge.invoke('updates:status').then(setStatus);
    return bridge.on('updates:status', setStatus);
  }, []);
  const version = status?.version ?? view?.version ?? '';
  const download = status?.download;
  const percent = download && download.total > 0 ? Math.floor((download.received / download.total) * 100) : 0;
  const checked = status?.checked !== undefined ? ` Looked ${when(status.checked)}.` : '';
  const detail = !status
    ? 'Looking…'
    : !status.supported
      ? 'Run from the repository: update it with git pull.'
      : status.state === 'checking'
        ? 'Looking for a new version…'
        : status.state === 'current'
          ? `This is the newest version.${checked}`
          : status.state === 'available'
            ? `Version ${status.next} is out.`
            : status.state === 'downloading'
              ? `Downloading version ${status.next}…${download ? ` ${percent} %` : ''}`
              : status.state === 'ready'
                ? `Version ${status.next} is downloaded. It is installed when Cuttle quits, or now.`
                : status.state === 'failed'
                  ? status.next !== undefined
                    ? `Downloading version ${status.next} failed: ${status.failure}`
                    : `Cuttle could not look for a new version: ${status.failure}`
                  : 'Not looked for a new version yet.';
  const look = () => {
    setProblem(undefined);
    void bridge.invoke('updates:check').then(setStatus);
  };
  return (
    <>
      <ToolLine
        state={!status ? 'unknown' : status.state === 'failed' ? 'failed' : status.state === 'current' || status.state === 'ready' ? 'ok' : 'off'}
        name={`Cuttle ${version}`}
        detail={problem ?? detail}
        testid="updates-line"
        busy={status?.state === 'checking' || status?.state === 'downloading'}
        plain
      >
        {status?.supported &&
          (status.state === 'downloading' ? (
            download && <progress className="download" max={download.total} value={download.received} aria-label={`Downloading version ${status.next}`} />
          ) : status.state === 'ready' ? (
            <button
              className="primary"
              onClick={() => void bridge.invoke('updates:install').then((answer) => setProblem(answer.problem))}
              data-testid="updates-install"
            >
              Restart and update
            </button>
          ) : status.state === 'available' ? (
            <button className="primary" onClick={() => void bridge.invoke('updates:download').then(setStatus)} data-testid="updates-download">
              Download version {status.next}
            </button>
          ) : (
            <>
              <button className="ghost" onClick={look} disabled={status.state === 'checking'} data-testid="updates-check">
                {status.state === 'failed' ? 'Try again' : 'Check now'}
              </button>
              {status.state === 'failed' && (
                <button className="ghost" onClick={() => void bridge.invoke('updates:releases')} data-testid="updates-releases">
                  Download page
                </button>
              )}
            </>
          ))}
      </ToolLine>
      <Row label="Check for updates" hint="Once a day Cuttle asks GitHub for a new version and downloads it; it is installed when Cuttle quits. Nothing about you or your recordings is sent.">
        <button
          className="toggle"
          role="switch"
          aria-checked={view?.updates ?? true}
          aria-label="Check for updates"
          disabled={!view || status?.supported === false}
          onClick={() => view && change({ updates: !view.updates })}
          data-testid="updates-auto"
        >
          <i />
        </button>
      </Row>
    </>
  );
}

/** The command that installs ffmpeg, to copy into a terminal. */
function Winget() {
  const [copied, setCopied] = useState(false);
```

Run: `pnpm exec vitest run --project node apps/desktop/test/updates.test.ts apps/desktop/test/contract.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop
git commit -m "app: updates from GitHub's releases, checked once a day, installed when Cuttle quits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The release workflow, the notes, the guide, and final verification

**Files:**
- Create: `.github/workflows/release.yml`, `docs/releases/0.1.1.md`
- Modify: `README.md`

- [ ] **Step 1: The workflow and the release notes**

`.github/workflows/release.yml`:

```
# Builds Cuttle's installers on Windows and macOS (Apple silicon) and puts them, with the files the
# app's updates read (latest.yml, latest-mac.yml), on the draft GitHub release of the app's version
# (apps/desktop/package.json), which it makes from docs/releases/<version>.md when there is none.
# Nothing is published: someone looks at the draft and publishes it. Started by hand (Actions,
# Release, Run workflow). macOS is signed and notarized with the repository's Apple secrets (the
# README's "Releases" names them); without them its build is only this run's artifact.
name: Release

on:
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  draft:
    name: draft release
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      - id: version
        run: echo "version=$(node -p "require('./apps/desktop/package.json').version")" >> "$GITHUB_OUTPUT"

      - name: the draft release (made once)
        env:
          GH_TOKEN: ${{ github.token }}
          VERSION: ${{ steps.version.outputs.version }}
        run: |
          if gh release view "v$VERSION" >/dev/null 2>&1; then
            echo "v$VERSION is there: the installers are added to it"
          else
            gh release create "v$VERSION" --draft --target "$GITHUB_SHA" --title "Cuttle $VERSION" --notes-file "docs/releases/$VERSION.md"
          fi

  installers:
    needs: draft
    name: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      # also downloads Electron and, on macOS, builds the screen capture helper with Xcode's Swift
      - run: pnpm install --frozen-lockfile

      # macOS: the Developer ID certificate in a keychain of this run, when the repository has it
      - name: signing identity (macOS)
        if: runner.os == 'macOS'
        env:
          APPLE_CERTIFICATE_P12: ${{ secrets.APPLE_CERTIFICATE_P12 }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
        run: |
          if [ -z "$APPLE_CERTIFICATE_P12" ]; then
            echo "::warning::no APPLE_CERTIFICATE_P12 secret: the macOS build is not signed and not released (it is this run's artifact)"
            exit 0
          fi
          keychain="$RUNNER_TEMP/cuttle.keychain-db"
          password="$(openssl rand -base64 24)"
          echo "$APPLE_CERTIFICATE_P12" | base64 --decode > "$RUNNER_TEMP/cuttle.p12"
          security create-keychain -p "$password" "$keychain"
          security set-keychain-settings -lut 21600 "$keychain"
          security unlock-keychain -p "$password" "$keychain"
          security import "$RUNNER_TEMP/cuttle.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
          rm "$RUNNER_TEMP/cuttle.p12"
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain"
          security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
          identity="$(security find-identity -v -p codesigning "$keychain" | grep -o '"Developer ID Application[^"]*"' | head -1 | tr -d '"')"
          if [ -z "$identity" ]; then
            echo "::error::APPLE_CERTIFICATE_P12 has no Developer ID Application identity"
            exit 1
          fi
          echo "CUTTLE_SIGN_IDENTITY=$identity" >> "$GITHUB_ENV"

      # package.mjs signs with CUTTLE_SIGN_IDENTITY and notarizes with the Apple ID's app-specific password
      - name: the app
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: |
          pnpm app:build:js
          pnpm cli:build
          node apps/desktop/scripts/package.mjs

      - name: the installers, on the draft release
        if: runner.os == 'Windows' || env.CUTTLE_SIGN_IDENTITY != ''
        env:
          GH_TOKEN: ${{ github.token }}
        run: node apps/desktop/scripts/installer.mjs --publish

      - name: the installers, unsigned (macOS without the Apple secrets)
        if: runner.os == 'macOS' && env.CUTTLE_SIGN_IDENTITY == ''
        run: node apps/desktop/scripts/installer.mjs

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: cuttle-${{ needs.draft.outputs.version }}-${{ runner.os }}
          path: |
            apps/desktop/build/installers/*.exe
            apps/desktop/build/installers/*.dmg
            apps/desktop/build/installers/*.zip
            apps/desktop/build/installers/*.yml
          if-no-files-found: ignore
```

`docs/releases/0.1.1.md`:

```markdown
The first release with installers. Cuttle records your screen, or Claude Code at work, and edits the take itself: it cuts the waiting, zooms on what matters, masks your secrets and frames it into a demo you can post. Everything runs on your computer.

## Download

- **Windows:** `Cuttle-0.1.1-win-x64.exe`. It installs for you alone, without admin rights, with Start menu and desktop shortcuts. It is not code-signed yet, so SmartScreen may not know it: choose *More info*, then *Run anyway*.
- **macOS (Apple silicon):** `Cuttle-0.1.1-mac-arm64.dmg`. Open it and drag Cuttle into Applications. The first recording asks for the screen, the microphone, input monitoring and accessibility.

Cuttle also needs ffmpeg: `winget install Gyan.FFmpeg` on Windows, `brew install ffmpeg` on a Mac. Its first start says what is missing.

From this version on, Cuttle updates itself. Once a day it asks GitHub for a new version, downloads it in the background and installs it when it quits, or at once with *Restart and update* (Settings, General). Nothing about you or your recordings is sent. You can turn the daily check off there.

## New in this version

- **A window take records the window by itself on Windows too**, also while another window lies over it. Closing the window ends the take. This needs ffmpeg 8 or newer.
- **Privacy:**
  - Random-looking strings (a key without a known prefix or a name beside it) are masked.
  - More key prefixes are known: Stripe, AWS temporary keys, Hugging Face, xAI, Groq, Replicate, npm, PyPI, Shopify, DigitalOcean, Linear, SendGrid and Google OAuth.
  - Secrets that showed for only a moment are read and masked.
  - The screen's text the project keeps holds no secret any more, only a mark where one was.
  - `cuttle preview --masks` shows every mask's edges, and new projects get a `.gitignore`.
- **Faster:** the screen's text is read by up to three OCR helpers at once, about twice as fast. An OCR helper that hangs is ended after 60 s instead of blocking.
- **Claude Code:** `--until-claude` waits for commands and agents Claude left running in the background.
```

- [ ] **Step 2: The README: downloads, updates, releases**

In `README.md`, replace:

```markdown

## Get started

Cuttle runs from this repository for now (no signed download yet).

| | Windows | macOS (Apple silicon or Intel) |
|---|---|---|
```

with:

```markdown

## Get started

### Download

The [latest release](https://github.com/lennystepn-hue/cuttle-ai-screen-recorder/releases/latest)
has an installer for Windows (`Cuttle-<version>-win-x64.exe`) and a DMG for Macs with Apple
silicon (`Cuttle-<version>-mac-arm64.dmg`). Cuttle needs ffmpeg as well (`winget install
Gyan.FFmpeg` on Windows, `brew install ffmpeg` on a Mac); its first start says what is missing.

- **Windows:** the installer puts Cuttle in `%LOCALAPPDATA%\Programs\cuttle` for you alone (no
  admin rights), with Start menu and desktop shortcuts; Settings > Apps uninstalls it. It is not
  code-signed yet, so SmartScreen may not know it: *More info*, then *Run anyway*.
- **macOS:** open the DMG and drag Cuttle into Applications. The permissions it asks for are below.
- **Updates:** once a day Cuttle asks GitHub for a new version, downloads it in the background and
  installs it when it quits, or at once with *Restart and update* (Settings > General). Nothing
  about you or your recordings is sent; the daily check can be turned off there.

### From this repository

To run Cuttle from its source, or to work on it:

| | Windows | macOS (Apple silicon or Intel) |
|---|---|---|
```

In the same file, replace:

```markdown
`pnpm exec vitest run -u` rewrites goldens after an intended change of look; that run fails once
for every rewritten PNG, so look at each one and run the tests again.

## Contributing

Issues and pull requests are welcome. Cuttle runs on Windows and macOS: a change made on one has to
```

with:

```markdown
`pnpm exec vitest run -u` rewrites goldens after an intended change of look; that run fails once
for every rewritten PNG, so look at each one and run the tests again.

### Releases

The app's version is `apps/desktop/package.json`'s (the `cuttle` command says the same; a test
keeps them alike). A release:

1. Raise both, and write what is new in `docs/releases/<version>.md`.
2. Run the *Release* workflow (Actions > Release > Run workflow). It makes a draft release from
   that file and adds the installers and the files the updates read (`latest.yml`,
   `latest-mac.yml`): Windows from `windows-latest`, macOS from `macos-latest` (Apple silicon).
3. Look at the draft, then publish it. Installed apps find it within a day.

macOS is signed and notarized only with these repository secrets (without them its build is the
run's artifact, not part of the release):

| Secret | What |
|---|---|
| `APPLE_CERTIFICATE_P12` | the *Developer ID Application* certificate with its private key, exported as .p12, in base64 (`base64 -i cert.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | the .p12's password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | for notarizing: the Apple ID, an app-specific password made for it (account.apple.com), the team's id |

On one computer, `pnpm app:build && pnpm app:installer` makes the installer of that platform in
`apps/desktop/build/installers` (on macOS signed with `CUTTLE_SIGN_IDENTITY`, see
`apps/desktop/scripts/package.mjs`).

## Contributing

Issues and pull requests are welcome. Cuttle runs on Windows and macOS: a change made on one has to
```

```bash
git add .github/workflows/release.yml docs/releases/0.1.1.md README.md
git commit -m "release: the Release workflow (a draft with both installers), the notes of 0.1.1, downloads in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 995 passed and 81 skipped (here, with a speech model and ffmpeg's whisper filter; without them the real transcriptions are skipped too, and off Windows and macOS the OCR tests).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 16 tests.

Run: `pnpm app:check`
Expected: PASS, 58 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 4: By hand (the user)**

1. In the repository's settings, add the five Apple secrets (README, Releases), then run the *Release* workflow and look at the draft: a Windows installer, a DMG and a zip, `latest.yml`, `latest-mac.yml`.
2. Install from the draft's Windows installer: Cuttle starts from the Start menu, and Settings, General, Updates says "Cuttle 0.1.1".
3. Publish the draft. When 0.1.2 is published later, Cuttle 0.1.1 finds it within a day, downloads it and installs it when it quits.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is on again with this PR: it runs on Windows and macOS for the PR, and the merge waits for it.

**Found while checking, and already in the plan above**
- **The first typecheck failed on the new test's types:** a fake updater built on Node's `EventEmitter` does not fit the updater's narrow type, and `releases.mjs` had no types. The fake keeps its own listeners now, and `releases.d.mts` declares the module.
- **The first app check failed its update step:** electron-updater asks for `latest.yml?noCache=…`. The check's server matched the whole address and answered 404, and the updates read every 404 as "no release yet", so the line said "This is the newest version." The server matches the path now. Only GitHub's own words for a missing release count as nothing newer; another 404 is a failure, and a test says so.

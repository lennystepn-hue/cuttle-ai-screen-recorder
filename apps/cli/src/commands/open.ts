// `cuttle open`: shows the project in the Cuttle app's editor, which then follows every change to
// its files (Claude's, the CLI's, a text editor's). Which app: CUTTLE_APP when set (Cuttle.exe,
// Cuttle.app, or a build's main script, which runs with the repository's Electron); the app whose
// shim runs this CLI (CUTTLE_ELECTRON); the app where its installer puts it; else, for a CLI built in
// this repository, the repository's app (`pnpm app`). A running app takes the project over from the
// second start (`--open`). macOS starts the app through Launch Services (`open`), so the app, not
// the terminal, is what macOS asks about the screen and the microphone.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProjectFile } from '@cuttle/core';
import { CliError } from '../errors';
import { electronBinary } from '../electron-runner';
import type { Output } from '../output';

/** Where the app is: an executable (Windows' Cuttle.exe), a bundle (Cuttle.app), or this repository's build. */
export type CuttleApp = { kind: 'exe'; path: string } | { kind: 'bundle'; path: string } | { kind: 'repository'; main: string };

/** The bundle a path inside one belongs to (`…/Cuttle.app/Contents/MacOS/Cuttle` → `…/Cuttle.app`). */
function bundleOf(path: string): string | undefined {
  return /^(.*?\.app)(?:[/\\]|$)/i.exec(path)?.[1];
}

/** An app given by its path: the main script of a build in a repository, a bundle on macOS, else the executable. */
function appAt(path: string, platform: NodeJS.Platform): CuttleApp {
  if (/\.m?js$/i.test(path)) return { kind: 'repository', main: path };
  const bundle = platform === 'darwin' ? bundleOf(path) : undefined;
  return bundle ? { kind: 'bundle', path: bundle } : { kind: 'exe', path };
}

/** The places the installers put the app: Windows' for one user (NSIS), macOS's Applications folders. */
export function installedPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[] {
  if (platform === 'win32') return [win32.join(env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local'), 'Programs', 'cuttle', 'Cuttle.exe')];
  if (platform === 'darwin') return ['/Applications/Cuttle.app', posix.join(home, 'Applications', 'Cuttle.app')];
  return [];
}

/** The app `cuttle open` starts, if there is one (`exists` checks a path; `cliDir` is the bundled CLI's folder). */
export function findApp(options: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; home: string; cliDir: string; exists: (path: string) => boolean }): CuttleApp | undefined {
  const { platform, env, exists } = options;
  if (env.CUTTLE_APP) return appAt((platform === 'win32' ? win32 : posix).resolve(env.CUTTLE_APP), platform);
  if (env.CUTTLE_ELECTRON) return appAt(env.CUTTLE_ELECTRON, platform);
  const installed = installedPaths(platform, env, options.home).find(exists);
  if (installed !== undefined) return appAt(installed, platform);
  // apps/cli/dist → the repository's app, as `pnpm app` builds it
  const main = join(options.cliDir, '..', '..', 'desktop', 'dist', 'main', 'index.mjs');
  return exists(main) ? { kind: 'repository', main } : undefined;
}

/** The command that shows `dir` in `app`. */
export function launchOf(app: CuttleApp, dir: string, electron = ''): { command: string; args: string[] } {
  switch (app.kind) {
    // -n: a second start even when Cuttle runs, which hands the project over and quits
    case 'bundle':
      return { command: 'open', args: ['-n', '-a', app.path, '--args', '--open', dir] };
    case 'exe':
      return { command: app.path, args: ['--open', dir] };
    case 'repository':
      return { command: electron, args: [app.main, '--open', dir] };
  }
}

export interface OpenResult {
  dir: string;
  /** The app's path (the repository's main script for its own build). */
  app: string;
}

/** Starts the app on the project, detached, and resolves once it started (macOS: once `open` handed it over). */
export async function openCommand(projectDir: string, output: Output): Promise<OpenResult> {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    throw new CliError('unsupported-platform', `the Cuttle app runs on Windows and macOS, not ${process.platform}: render here, and open the project on one of those`);
  }
  const dir = resolve(projectDir);
  await readProjectFile(dir); // says what is missing or wrong before the app does
  const app = findApp({ platform: process.platform, env: process.env, home: homedir(), cliDir: dirname(fileURLToPath(import.meta.url)), exists: existsSync });
  if (app === undefined) {
    throw new CliError(
      'app-missing',
      'the Cuttle app is not installed: get it from https://github.com/lennystepn-hue/cuttle-ai-screen-recorder/releases/latest, or set CUTTLE_APP to where it is',
    );
  }
  const { command, args } = launchOf(app, dir, app.kind === 'repository' ? electronBinary() : '');
  // the shim runs this CLI in the app as Node: the app itself must not
  const { ELECTRON_RUN_AS_NODE: _node, CUTTLE_ELECTRON: _electron, ...env } = process.env;
  await new Promise<void>((done, fail) => {
    const child = spawn(command, args, { detached: app.kind !== 'bundle', stdio: app.kind === 'bundle' ? ['ignore', 'ignore', 'pipe'] : 'ignore', env });
    let said = '';
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (said += chunk));
    child.on('error', (error) => fail(new CliError('app-missing', `the Cuttle app could not start (${command}): ${error.message}`, { cause: error })));
    if (app.kind === 'bundle') {
      child.on('close', (code) => (code === 0 ? done() : fail(new CliError('app-missing', `macOS could not open ${app.path}: ${said.trim() || `open exited with ${code}`}`))));
    } else {
      child.on('spawn', () => {
        child.unref();
        done();
      });
    }
  });
  const shown = app.kind === 'repository' ? app.main : app.path;
  output.result({ dir, app: shown }, () => `opened ${dir} in Cuttle (${shown}); the editor follows every change to its files`);
  return { dir, app: shown };
}

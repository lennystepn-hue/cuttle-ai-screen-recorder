// How the app was launched: the project folder to open (`--open`), or its settings (`--settings`),
// from the first launch's argv or a second launch's (which Electron hands the running app).
import { resolve } from 'node:path';

/**
 * The folder after `--open` (or in `--open=<folder>`) in `argv`, if any, resolved against the folder
 * that launch ran in. Chromium moves its own switches in between a second launch's `--open` and its
 * folder: the folder is the first argument after `--open` that is not a switch.
 */
export function openArgument(argv: readonly string[], cwd: string): string | undefined {
  const joined = argv.find((arg) => arg.startsWith('--open='));
  const at = argv.indexOf('--open');
  const dir = joined !== undefined ? joined.slice('--open='.length) : at >= 0 ? argv.slice(at + 1).find((arg) => !arg.startsWith('--')) : undefined;
  return dir === undefined || dir === '' ? undefined : resolve(cwd, dir);
}

/** What a second launch hands the running app as it was asked (Electron's additionalData): its argv comes reordered. */
export interface Launch {
  open?: string;
  settings?: boolean;
}

/** What a launch with `argv` (in `cwd`) asks for. */
export function launchOf(argv: readonly string[], cwd: string): Launch {
  return { open: openArgument(argv, cwd), settings: argv.includes('--settings') };
}

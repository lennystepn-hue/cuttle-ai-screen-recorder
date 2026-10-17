// The main process's entry: the app, or the Electron part of the cuttle command the app installed.
// That command runs the app's own copy of the CLI with the app as Node; its renders, previews and
// page captures need Electron, and a packaged app has only itself, so the CLI starts the app with
// CUTTLE_CLI_ELECTRON naming the CLI's Electron entry (only the app's own copy is run).
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { cliEntry } from './cli-path';

const cli = process.env.CUTTLE_CLI_ELECTRON;
const real = (path: string) => {
  try {
    return realpathSync(path).toLowerCase();
  } catch {
    return undefined;
  }
};

if (cli !== undefined) {
  const own = join(dirname(cliEntry()), 'electron.mjs');
  if (real(cli) === undefined || real(cli) !== real(own)) {
    process.stderr.write(`CUTTLE_CLI_ELECTRON must name ${own}\n`);
    app.exit(1);
  } else {
    // a profile of its own: the app itself may be running with its own
    app.setPath('userData', join(app.getPath('userData'), 'cli'));
    await import(pathToFileURL(cli).href);
  }
} else {
  await import('./index');
}

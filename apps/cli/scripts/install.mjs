// Puts `cuttle` on PATH: small shims that run the built CLI (dist/cuttle.mjs) with node, next to npm's
// global commands (Windows: %APPDATA%\npm, which every Node install puts on PATH; elsewhere
// ~/.local/bin). CUTTLE_BIN_DIR picks another folder. `--uninstall` removes them. The Cuttle app's
// own shims (Settings, Install) are replaced; those of other tools with the same name never are.
//   node apps/cli/scripts/install.mjs [--uninstall]
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARK = 'cuttle shim (pnpm cli:install)';
/** The mark of the shims the Cuttle app writes (apps/desktop/src/main/tools.ts). */
const APP_MARK = 'cuttle shim (Cuttle app)';
const entry = fileURLToPath(new URL('../dist/cuttle.mjs', import.meta.url));
const windows = process.platform === 'win32';
const dir = process.env.CUTTLE_BIN_DIR || (windows ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm') : join(homedir(), '.local', 'bin'));
const posixEntry = entry.replace(/\\/g, '/');

const shims = {
  // cmd.exe and PowerShell (which also runs .cmd files); Git Bash runs the file without extension.
  ...(windows && {
    'cuttle.cmd': `@rem ${MARK}\r\n@node "${entry}" %*\r\n`,
    'cuttle.ps1': `# ${MARK}\r\n& node "${entry}" @args\r\nexit $LASTEXITCODE\r\n`,
  }),
  cuttle: `#!/bin/sh\n# ${MARK}\nexec node "${posixEntry}" "$@"\n`,
};

const ours = (file) => !existsSync(file) || readFileSync(file, 'utf8').includes(MARK);
const theApps = (file) => existsSync(file) && readFileSync(file, 'utf8').includes(APP_MARK);

if (process.argv.includes('--uninstall')) {
  for (const name of Object.keys(shims)) {
    const file = join(dir, name);
    if (existsSync(file) && ours(file)) {
      rmSync(file);
      console.log(`removed ${file}`);
    }
  }
  process.exit(0);
}

if (!existsSync(entry)) {
  console.error(`${entry} is missing; run "pnpm cli:build" first`);
  process.exit(1);
}
const foreign = Object.keys(shims).map((name) => join(dir, name)).filter((file) => !ours(file) && !theApps(file));
if (foreign.length > 0) {
  console.error(`not overwriting files that belong to another tool:\n  ${foreign.join('\n  ')}\nset CUTTLE_BIN_DIR to install somewhere else`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(shims)) {
  const file = join(dir, name);
  const replaced = theApps(file);
  writeFileSync(file, text);
  if (!name.includes('.')) chmodSync(file, 0o755);
  console.log(replaced ? `wrote ${file} (in place of the Cuttle app's)` : `wrote ${file}`);
}
const onPath = (process.env.PATH ?? '').split(delimiter).some((part) => part.replace(/[\\/]+$/, '').toLowerCase() === dir.replace(/[\\/]+$/, '').toLowerCase());
console.log(onPath ? 'cuttle is on PATH: open a new terminal and run "cuttle --help"' : `${dir} is not on PATH; add it, or run node "${entry}"`);

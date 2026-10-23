// Builds cuttle-loopback.exe (Windows: what the computer plays, through WASAPI's loopback) from
// loopback.cs with the C# compiler of .NET Framework 4, which every Windows 10 and 11 has, when it is
// missing or older than its source or this script, and copies it into the folders given: next to the
// bundles that run the recorder. Elsewhere, or without the compiler, it does nothing: the recorder
// then records takes without the computer's sound, and says so.
//   node packages/recorder/native/build-windows.mjs [<folder>...]
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./windows/', import.meta.url));
const source = join(here, 'loopback.cs');
const binary = join(here, 'cuttle-loopback.exe');

if (process.platform !== 'win32') process.exit(0);

const changed = Math.max(statSync(source).mtimeMs, statSync(fileURLToPath(import.meta.url)).mtimeMs);
const stale = !existsSync(binary) || statSync(binary).mtimeMs < changed;
if (stale) {
  const windows = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
  const csc = ['Framework64', 'Framework'].map((folder) => join(windows, 'Microsoft.NET', folder, 'v4.0.30319', 'csc.exe')).find((file) => existsSync(file));
  if (!csc) {
    console.warn("cuttle-loopback not built: no C# compiler of .NET Framework 4. Recording works, but takes have no computer's sound.");
    process.exit(0);
  }
  const built = spawnSync(csc, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', `/out:${binary}`, source], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (built.status !== 0) {
    console.warn("cuttle-loopback could not be built. Recording works, but takes have no computer's sound.");
    process.exit(0);
  }
  console.log(`built ${binary}`);
}
for (const folder of process.argv.slice(2)) {
  const dir = resolve(folder);
  mkdirSync(dir, { recursive: true });
  copyFileSync(binary, join(dir, 'cuttle-loopback.exe'));
}

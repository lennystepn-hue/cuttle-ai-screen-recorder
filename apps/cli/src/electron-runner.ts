import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError, isKnownCode } from './errors';
import { encodeRequest, type CancelMessage, type ElectronRequest, type ElectronResponse, type ResponseMessage } from './electron/protocol';

/** After Ctrl+C, Electron gets this long to clean up before it is killed. */
const CANCEL_GRACE_MS = 15_000;

/** The Electron entry that sits next to the bundled CLI (dist/electron.mjs). */
function electronEntry(): string {
  const entry = fileURLToPath(new URL('./electron.mjs', import.meta.url));
  if (!existsSync(entry)) throw new CliError('internal', `the Electron part of the CLI is missing (${entry}); run "pnpm cli:build"`);
  return entry;
}

/**
 * The Electron binary. `require('electron')` would return its path, but Electron downloads the
 * binary on first use and announces that on stdout, which belongs to --json: so the CLI reads the
 * path itself (the package's path.txt names the executable inside dist/) and, when the binary is
 * missing, runs Electron's installer with its output on stderr.
 */
function electronBinary(): string {
  let dir: string;
  try {
    dir = dirname(createRequire(import.meta.url).resolve('electron/package.json'));
  } catch (error) {
    throw new CliError('internal', `Electron is not installed next to the CLI: ${(error as Error).message}`, { cause: error });
  }
  const binary = (): string | undefined => {
    const name = existsSync(join(dir, 'path.txt')) ? readFileSync(join(dir, 'path.txt'), 'utf8').trim() : '';
    return name !== '' && existsSync(join(dir, 'dist', name)) ? join(dir, 'dist', name) : undefined;
  };
  const found = binary();
  if (found !== undefined) return found;
  process.stderr.write('downloading Electron (once) …\n');
  const install = spawnSync(process.execPath, [join(dir, 'install.js')], { stdio: ['ignore', 2, 2], windowsHide: true });
  const installed = binary();
  if (install.status !== 0 || installed === undefined) {
    throw new CliError('internal', `Electron could not be downloaded; run "node ${join(dir, 'install.js')}" and try again`);
  }
  return installed;
}

/**
 * Runs a render, preview or page capture in Electron (Chromium: WebGL2, WebCodecs) and returns its
 * result. Electron's output (progress, warnings) goes to stderr, so stdout stays free for --json.
 * `signal` (Ctrl+C) sends a cancel over the IPC channel: Electron runs without a console, so the
 * console's Ctrl+C never reaches it on Windows. After a grace period Electron is killed.
 */
export function runInElectron<T>(request: ElectronRequest, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(electronBinary(), [electronEntry(), encodeRequest(request)], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'], windowsHide: true });
    child.stdout?.pipe(process.stderr);
    let response: ElectronResponse | undefined;
    child.on('message', (message: ResponseMessage) => {
      if (message?.type === 'response') response = message.response;
    });
    let grace: NodeJS.Timeout | undefined;
    const onAbort = () => {
      if (child.connected) child.send({ type: 'cancel' } satisfies CancelMessage, () => {});
      grace = setTimeout(() => child.kill(), CANCEL_GRACE_MS);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (error) => reject(new CliError('internal', `Electron could not start: ${error.message}`, { cause: error })));
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      clearTimeout(grace);
      if (response === undefined) {
        reject(new CliError(signal.aborted ? 'cancelled' : 'render', `Electron exited (code ${code}) without a result`));
      } else if (response.ok) {
        resolve(response.result as T);
      } else {
        // Electron's own failures (a module that did not load, a crash in Chromium) count as render errors.
        const { code, message } = response.error;
        reject(new CliError(isKnownCode(code) ? code : 'render', message));
      }
    });
  });
}

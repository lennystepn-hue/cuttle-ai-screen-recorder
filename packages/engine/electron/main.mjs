// Renders every golden scenario in a hidden Electron window and compares it with the committed
// goldens. SwiftShader makes Electron rasterize like headless Chromium in the vitest browser tests.
// Run from the repo root: pnpm engine:electron
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app } from 'electron';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const here = dirname(fileURLToPath(import.meta.url));
const goldens = join(here, '..', 'test', '__golden__', 'golden.browser.test.ts');
const diffs = join(here, '..', '..', '..', '.vitest', 'electron-diff');
// The same rule as the vitest goldens. Electron's SwiftShader output is byte-identical to Playwright's
// today; a looser limit (the plan had 0.2 % of the pixels) let two different cursor goldens match.
// If an Electron upgrade ever shifts text edges, raise this on purpose with the measured count.
const THRESHOLD = 0.05;
const ALLOWED_PIXELS = 0;
// The slowest scenario takes about 150 ms; a crashed or stuck page must not hang the run.
const STEP_TIMEOUT_MS = 30_000;

// Electron's macOS build has SwiftShader's library but gives no WebGL2 through it (tried with and
// without the GPU sandbox and ANGLE's switches); the GPU would not match the goldens' rasterizing.
// The browser goldens (pnpm test) cover the engine there.
if (process.platform === 'darwin') {
  console.log('engine:electron is skipped on macOS: Electron gives no WebGL2 through SwiftShader there; pnpm test checks the goldens in headless Chromium');
  process.exit(0);
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${STEP_TIMEOUT_MS} ms`)), STEP_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function writePng(path, width, height, data) {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width, height });
  png.data = Buffer.from(data);
  writeFileSync(path, PNG.sync.write(png));
}

async function check() {
  const win = new BrowserWindow({ show: false, width: 800, height: 600 });
  win.webContents.on('console-message', (event) => console.log(`[page] ${event.message}`));
  // A crashed renderer never settles a pending executeJavaScript: fail instead of hanging.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`FAIL the page's renderer is gone: ${details.reason} (exit code ${details.exitCode})`);
    app.exit(1);
  });
  rmSync(diffs, { recursive: true, force: true });
  await withTimeout(win.loadFile(join(here, 'index.html')), 'loading the page');
  const names = await withTimeout(win.webContents.executeJavaScript('window.cuttleCheck.names'), 'listing the scenarios');
  if (names.length === 0) throw new Error('the page lists no scenarios');
  const suffix = `.${process.platform}.png`;
  const orphans = existsSync(goldens)
    ? readdirSync(goldens).filter((file) => file.endsWith(suffix) && !names.includes(file.slice(0, -suffix.length)))
    : [];
  for (const file of orphans) console.log(`FAIL ${file}: a golden without a scenario`);
  let failed = orphans.length;
  for (let i = 0; i < names.length; i++) {
    const result = await withTimeout(win.webContents.executeJavaScript(`window.cuttleCheck.render(${i})`), `scenario ${names[i]}`);
    const file = join(goldens, `${result.name}.${process.platform}.png`);
    if (!existsSync(file)) {
      console.log(`FAIL ${result.name}: no golden at ${file}`);
      failed++;
      continue;
    }
    const golden = PNG.sync.read(readFileSync(file));
    if (golden.width !== result.width || golden.height !== result.height) {
      console.log(`FAIL ${result.name}: golden is ${golden.width}x${golden.height}, render is ${result.width}x${result.height}`);
      failed++;
      continue;
    }
    const actual = Buffer.from(result.rgba, 'base64');
    const diff = new Uint8Array(actual.length);
    const mismatched = pixelmatch(golden.data, actual, diff, result.width, result.height, { threshold: THRESHOLD });
    const ok = mismatched <= ALLOWED_PIXELS;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${result.name} (${mismatched} px differ)`);
    if (!ok) {
      failed++;
      writePng(join(diffs, `${result.name}.actual.png`), result.width, result.height, actual);
      writePng(join(diffs, `${result.name}.diff.png`), result.width, result.height, diff);
    }
  }
  console.log(failed === 0 ? `all ${names.length} scenarios match the goldens` : `${failed} checks failed, diff images (if any) in ${diffs}`);
  return failed === 0;
}

app.whenReady().then(async () => {
  let ok = false;
  try {
    ok = await check();
  } catch (error) {
    console.error(error);
  }
  app.exit(ok ? 0 : 1);
});

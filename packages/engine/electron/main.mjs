// Renders every golden scenario in a hidden Electron window and compares it with the committed
// goldens. SwiftShader makes Electron rasterize like headless Chromium in the vitest browser tests.
// Run from the repo root: pnpm engine:electron
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app } from 'electron';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const here = dirname(fileURLToPath(import.meta.url));
const goldens = join(here, '..', 'test', '__golden__', 'golden.browser.test.ts');
const diffs = join(here, '..', '..', '..', '.vitest', 'electron-diff');
// Electron ships an older Chromium than Playwright: allow tiny text rasterization differences.
const THRESHOLD = 0.1;
const ALLOWED_RATIO = 0.002;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

function writePng(path, width, height, data) {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width, height });
  png.data = Buffer.from(data);
  writeFileSync(path, PNG.sync.write(png));
}

async function check() {
  const win = new BrowserWindow({ show: false, width: 800, height: 600 });
  win.webContents.on('console-message', (event) => console.log(`[page] ${event.message}`));
  await win.loadFile(join(here, 'index.html'));
  const names = await win.webContents.executeJavaScript('window.cuttleCheck.names');
  let failed = 0;
  for (let i = 0; i < names.length; i++) {
    const result = await win.webContents.executeJavaScript(`window.cuttleCheck.render(${i})`);
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
    const ok = mismatched <= ALLOWED_RATIO * result.width * result.height;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${result.name} (${mismatched} px differ)`);
    if (!ok) {
      failed++;
      writePng(join(diffs, `${result.name}.actual.png`), result.width, result.height, actual);
      writePng(join(diffs, `${result.name}.diff.png`), result.width, result.height, diff);
    }
  }
  console.log(failed === 0 ? `all ${names.length} scenarios match the goldens` : `${failed} of ${names.length} scenarios differ, see ${diffs}`);
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

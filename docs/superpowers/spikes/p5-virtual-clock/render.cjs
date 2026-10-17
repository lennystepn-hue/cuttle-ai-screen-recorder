// Spike 2: the virtual clock injected before the page's scripts (CDP), frames from the offscreen
// window's paint events (with alpha). Usage: electron spike2.cjs <page.html> <out folder> [fps] [seconds]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const [page, out, fpsArg = '30', secondsArg = '2'] = process.argv.slice(2);
const fps = Number(fpsArg);
const seconds = Number(secondsArg);

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const trace = (text) => fs.appendFileSync(join(out, 'trace.txt'), `${text}\n`);
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 362,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  win.webContents.setFrameRate(60);
  let latest;
  let waiting;
  const sizes = new Map();
  win.webContents.on('paint', (_event, _dirty, image) => {
    // an invalidate answers at once with an empty paint; the frame comes after it
    if (image.isEmpty()) return;
    const k = JSON.stringify(image.getSize());
    sizes.set(k, (sizes.get(k) ?? 0) + 1);
    if (sizes.get(k) === 1) fs.appendFileSync(join(out, 'trace.txt'), 'paint ' + k + ' dirty ' + JSON.stringify(_dirty) + String.fromCharCode(10));
    latest = image;
    waiting?.();
  });
  trace('window');
  await win.loadURL('about:blank');
  trace('blank');
  const cdp = win.webContents.debugger;
  cdp.attach('1.3');
  trace('attached');
  await cdp.sendCommand('Page.enable');
  await cdp.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(join(__dirname, 'clock.js'), 'utf8') });
  trace('clock injected');
  await win.loadURL(pathToFileURL(page).href);
  trace('loaded');
  const nextPaint = () => new Promise((resolve) => (waiting = () => ((waiting = undefined), resolve())));
  const started = Date.now();
  const total = Math.round(fps * seconds);
  const log = [];
  const waits = [];
  for (let k = 0; k < total; k++) {
    const t = await win.webContents.executeJavaScript(`window.__cuttleAdvance(${k === 0 ? 0 : 1000 / fps})`);
    // wait for a paint that shows this frame (its marker pixel below the page)
    const frame = k + 1;
    const shows = (img) => {
      if (!img) return false;
      const { width, height } = img.getSize();
      if (height < 362) return false;
      const b = img.toBitmap();
      const i = (360 * width) * 4;
      return b[i + 2] === (frame & 255) && b[i + 1] === ((frame >> 8) & 255) && b[i] === 200;
    };
    let paints = 0;
    const deadline = Date.now() + 1000;
    while (!shows(latest) && Date.now() < deadline) {
      const painted = nextPaint();
      if (paints === 0) win.webContents.invalidate();
      await Promise.race([painted, new Promise((resolve) => setTimeout(resolve, 50))]);
      paints++;
    }
    trace('frame ' + frame + ' paints total ' + [...sizes.values()].reduce((a, b) => a + b, 0) + ' loops ' + paints);
    if (!shows(latest)) { const sz = latest.getSize(); const b = latest.toBitmap(); const row = sz.height - 1; const px = (x, y) => Array.from(b.slice((y * sz.width + x) * 4, (y * sz.width + x) * 4 + 4)).join(','); trace('frame ' + frame + ' never shown; size ' + sz.width + 'x' + sz.height + ' marker ' + px(0, 360) + ' card ' + px(100, 150) + ' paints ' + paints); if (frame > 3) { app.quit(); return; } }
    waits.push(paints);
    const image = latest.crop({ x: 0, y: 0, width: 640, height: 360 });
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const alphaAt = (x, y) => bitmap[(y * size.width + x) * 4 + 3];
    if (k % Math.round(fps / 4) === 0 || k === total - 1) fs.writeFileSync(join(out, `f${String(k).padStart(3, '0')}.png`), image.toPNG());
    log.push({ k, t, size, corner: alphaAt(2, 2), card: alphaAt(100, 150) });
  }
  const ms = Date.now() - started;
  fs.writeFileSync(join(out, 'log.json'), JSON.stringify({ total, ms, perFrame: ms / total, paintsPerFrame: waits.reduce((a, b) => a + b, 0) / waits.length, maxPaints: Math.max(...waits), log: log.filter((_, k) => k % 10 === 0 || k === log.length - 1) }, null, 1));
  trace(`done ${total} frames in ${ms} ms`);
  app.quit();
});

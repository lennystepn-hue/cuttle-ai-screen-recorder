// Draws Cuttle's macOS icons into apps/desktop/assets/: icon.icns (the app, 16–1024 px),
// icon-mac.png (1024 px, the Dock icon while developing) and trayTemplate.png / trayTemplate@2x.png
// (the menu bar; a template image, which macOS tints for light and dark menu bars).
//
// The mark is the Windows icon's dark arrow grown into a cuttlefish darting forward: the arrow is
// its mantle with a frilled fin, the arms trail behind, the eye has a cuttlefish's W-shaped pupil,
// and two dashed cut lines run across it. It sits on the brand's orange tile, shaped and lit like a
// macOS icon (a squircle on the 1024 grid with a glass highlight).
//
// The design is SVG, rendered in an offscreen Electron window; iconutil (macOS only) packs the icns.
// Run with `pnpm icons:mac`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const OUT = fileURLToPath(new URL('../apps/desktop/assets/', import.meta.url));
const INK = '#1b0f0a';
const CREAM = '#fff1e6';
const ORANGE = '#f0956f';

const f = (value) => Math.round(value * 10) / 10;
const pathOf = (points) => `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;

/** A superellipse (|x|^5 + |y|^5 = 1): the continuous corners of a macOS icon. */
function squircle(cx, cy, half, steps = 240) {
  const points = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    points.push([cx + half * Math.sign(c) * Math.abs(c) ** 0.4, cy + half * Math.sign(s) * Math.abs(s) ** 0.4]);
  }
  return pathOf(points);
}

/** Points along a cubic Bézier, without its first point. */
function cubic(p0, p1, p2, p3, steps) {
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push([0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]));
  }
  return points;
}

/** A tapered arm along a cubic Bézier, `from` wide at its root and `to` at its rounded tip. */
function arm([p0, p1, p2, p3], from, to, steps = 48) {
  const line = [p0, ...cubic(p0, p1, p2, p3, steps)];
  const left = [];
  const right = [];
  line.forEach(([x, y], i) => {
    const [ax, ay] = line[Math.max(i - 1, 0)];
    const [bx, by] = line[Math.min(i + 1, line.length - 1)];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const half = (from + (to - from) * (i / steps)) / 2;
    left.push([x - ((by - ay) / length) * half, y + ((bx - ax) / length) * half]);
    right.push([x + ((by - ay) / length) * half, y - ((bx - ax) / length) * half]);
  });
  const [tx, ty] = line.at(-1);
  return `<path d="${pathOf([...left, ...right.reverse()])}"/><circle cx="${f(tx)}" cy="${f(ty)}" r="${f(to / 2 + 2)}"/>`;
}

// The mantle: the brand arrow (M2 2h5l3 4-3 4H2z) grown round, a torpedo pointing right.
const TOP_BACK = [488, 392];
const TOP = [628, 392];
const TIP = [808, 512];
const BOTTOM = [628, 632];
const BOTTOM_BACK = [488, 632];
const MANTLE = `M476 392H628C712 392 776 452 808 512C776 572 712 632 628 632H476C446 632 424 610 424 580V444C424 414 446 392 476 392Z`;
/** The mantle's outline from the back of its top over the tip to the back of its bottom: where the fin grows. */
const FIN_LINE = [TOP_BACK, ...cubic(TOP_BACK, [560, 392], [580, 392], TOP, 12), ...cubic(TOP, [712, 392], [776, 452], TIP, 40), ...cubic(TIP, [776, 572], [712, 632], BOTTOM, 40), ...cubic(BOTTOM, [580, 632], [560, 632], BOTTOM_BACK, 12)];

/** The fin: a band along `line` that ripples outwards and fades in and out at its ends. */
function fin(line, { base, ripple, wave }) {
  const outer = [];
  const inner = [];
  let travelled = 0;
  const total = line.reduce((sum, point, i) => sum + (i === 0 ? 0 : Math.hypot(point[0] - line[i - 1][0], point[1] - line[i - 1][1])), 0);
  line.forEach(([x, y], i) => {
    if (i > 0) travelled += Math.hypot(x - line[i - 1][0], y - line[i - 1][1]);
    const [ax, ay] = line[Math.max(i - 1, 0)];
    const [bx, by] = line[Math.min(i + 1, line.length - 1)];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    // outwards: the outline runs clockwise, so the normal turns left of it
    const [nx, ny] = [(by - ay) / length, -(bx - ax) / length];
    const ends = Math.min(1, travelled / 60, (total - travelled) / 60);
    const reach = ends * (base + ripple * (0.5 + 0.5 * Math.sin((travelled / wave) * 2 * Math.PI)));
    outer.push([x + nx * reach, y + ny * reach]);
    inner.push([x - nx * 8, y - ny * 8]);
  });
  return pathOf([...outer, ...inner.reverse()]);
}

// Five arms trailing behind: the outer ones curl, the middle one streams straight back.
const ARMS = [
  [[[452, 420], [372, 396], [326, 324], [252, 334]], 42, 11],
  [[[448, 470], [360, 450], [302, 474], [226, 440]], 44, 11],
  [[[446, 512], [356, 522], [294, 498], [204, 524]], 46, 12],
  [[[448, 554], [360, 574], [302, 550], [226, 584]], 44, 11],
  [[[452, 604], [372, 628], [326, 700], [252, 690]], 42, 11],
];

function appIcon() {
  const tile = squircle(512, 512, 412);
  const cuttlefish = `
    <path d="${fin(FIN_LINE, { base: 15, ripple: 11, wave: 58 })}" fill="#6b2a16" opacity="0.78"/>
    <g fill="${INK}">${ARMS.map(([curve, from, to]) => arm(curve, from, to)).join('')}</g>
    <path d="${MANTLE}" fill="url(#mantle)"/>
    <path d="M488 410H626C690 410 742 452 772 500" fill="none" stroke="#fff" stroke-opacity="0.13" stroke-width="10" stroke-linecap="round"/>
    <g stroke="${ORANGE}" stroke-width="10" stroke-linecap="round" stroke-dasharray="20 22" opacity="0.9">
      <path d="M590 424V604"/><path d="M652 424V604"/>
    </g>
    <circle cx="500" cy="472" r="44" fill="${CREAM}"/>
    <path d="M474 464c6 22 19 22 26 6c7 16 20 16 26-6" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="484" cy="449" r="7" fill="#fff"/>`;
  const bubbles = `
    <g fill="none" stroke="${CREAM}" stroke-width="7" opacity="0.85">
      <circle cx="300" cy="262" r="19"/><circle cx="352" cy="210" r="12"/><circle cx="258" cy="200" r="8"/>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7a985"/><stop offset="0.5" stop-color="#e57b55"/><stop offset="1" stop-color="#b8492f"/>
    </linearGradient>
    <linearGradient id="mantle" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2e1c15"/><stop offset="1" stop-color="${INK}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.45" cy="0.5" r="0.55">
      <stop offset="0" stop-color="#ffd2b8" stop-opacity="0.5"/><stop offset="1" stop-color="#ffd2b8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.38"/><stop offset="0.46" stop-color="#fff" stop-opacity="0.04"/>
      <stop offset="0.75" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.16"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.08"/><stop offset="1" stop-color="#fff" stop-opacity="0.3"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.3"/>
    </filter>
    <filter id="lift" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#5a1d0c" flood-opacity="0.3"/>
    </filter>
    <clipPath id="clip"><path d="${tile}"/></clipPath>
  </defs>
  <path d="${tile}" fill="url(#tile)" filter="url(#shadow)"/>
  <g clip-path="url(#clip)">
    <rect width="1024" height="1024" fill="url(#glow)"/>
    ${bubbles}
    <g filter="url(#lift)" transform="translate(512 512) scale(1.08) translate(-506 -512)">${cuttlefish}</g>
    <rect width="1024" height="1024" fill="url(#gloss)"/>
  </g>
  <path d="${squircle(512, 512, 409)}" fill="none" stroke="url(#rim)" stroke-width="5"/>
</svg>`;
}

/** The menu bar's mark: the cuttlefish alone (mantle and three thicker arms), black, its eye cut out. */
function trayIcon() {
  const arms = [
    [[[452, 430], [372, 404], [330, 350], [262, 356]], 74, 34],
    [[[446, 512], [360, 518], [310, 500], [236, 516]], 78, 36],
    [[[452, 594], [372, 620], [330, 674], [262, 668]], 74, 34],
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="220 300 610 424">
  <defs><mask id="eye"><rect x="0" y="0" width="1024" height="1024" fill="#fff"/><circle cx="508" cy="474" r="46" fill="#000"/></mask></defs>
  <g fill="#000" mask="url(#eye)">
    <path d="${MANTLE}"/>
    ${arms.map(([curve, from, to]) => arm(curve, from, to)).join('')}
  </g>
</svg>`;
}

/** Renders SVGs at their sizes in one offscreen window, through a page in a temporary folder. */
function renderer(dir) {
  const window = new BrowserWindow({ width: 1024, height: 1024, useContentSize: true, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  let page = 0;
  return {
    async render(svg, size) {
      const file = join(dir, `page${page++}.html`);
      const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `);
      writeFileSync(file, `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${sized}</body></html>`);
      await window.loadFile(file);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const image = await window.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
      const { width } = image.getSize();
      return (width === size ? image : image.resize({ width: size, height: size, quality: 'best' })).toPNG();
    },
    close: () => window.destroy(),
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'cuttle-icons-'));
  const { render, close } = renderer(work);
  try {
    const icon = appIcon();
    const iconset = join(work, 'icon.iconset');
    mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      writeFileSync(join(iconset, `icon_${size}x${size}.png`), await render(icon, size));
      writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), await render(icon, size * 2));
    }
    writeFileSync(join(OUT, 'icon-mac.png'), await render(icon, 1024));
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(OUT, 'icon.icns')]);
    const tray = trayIcon();
    writeFileSync(join(OUT, 'trayTemplate.png'), await render(tray, 16));
    writeFileSync(join(OUT, 'trayTemplate@2x.png'), await render(tray, 32));
    console.log('wrote apps/desktop/assets: icon.icns, icon-mac.png, trayTemplate.png, trayTemplate@2x.png');
  } finally {
    close();
    rmSync(work, { recursive: true, force: true });
  }
}

app.disableHardwareAcceleration();
// Not awaited at the top: an ES module main script that waits for "ready" keeps it from coming.
void app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.quit());

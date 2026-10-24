// Draws Cuttle's icons for both platforms into apps/desktop/assets/, and the app's own mark into
// apps/desktop/src/renderer/mark.ts:
// - Windows: icon.ico (16–256 px), icon.png (256 px, the windows' icon), tray.png / tray@2x.png and
//   tray-recording.png / tray-recording@2x.png (the tray during a take: a red dot in its corner);
// - macOS: icon.icns (16–1024 px), icon-mac.png (1024 px, the Dock icon while developing) and
//   trayTemplate.png / trayTemplate@2x.png (a template image, tinted for light and dark menu bars).
//
// The mark is the brand's dark arrow grown into a cuttlefish darting forward: the arrow is its
// mantle with a frilled fin, the arms trail behind, the eye has a cuttlefish's W-shaped pupil, and
// two dashed cut lines run across it, on the brand's orange tile. macOS gets it shaped and lit like a
// macOS icon (a squircle on the 1024 grid with a glass highlight), Windows a full tile; at 32 px and
// below, where the details blur, the cuttlefish is a plain silhouette.
//
// The design is SVG, rendered in an offscreen Electron window; iconutil packs the icns (on macOS
// only: elsewhere the icns is left as it is). Run with `pnpm icons`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const OUT = fileURLToPath(new URL('../apps/desktop/assets/', import.meta.url));
const MARK = fileURLToPath(new URL('../apps/desktop/src/renderer/mark.ts', import.meta.url));
const INK = '#1b0f0a';
const CREAM = '#fff1e6';
const ORANGE = '#f0956f';
/** The recording dot's red: the HUD's (`--recording` in tokens.css). */
const RECORDING = '#ff4d4f';

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

/** The cuttlefish in full, on the 1024 grid: fin, arms, mantle, cut lines and eye. */
function cuttlefish() {
  return `
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
}

const BUBBLES = `
    <g fill="none" stroke="${CREAM}" stroke-width="7" opacity="0.85">
      <circle cx="300" cy="262" r="19"/><circle cx="352" cy="210" r="12"/><circle cx="258" cy="200" r="8"/>
    </g>`;

/** The gradients and shadows both platforms' tiles use. */
const DEFS = `
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
    </filter>`;

/** macOS: the squircle on the 1024 grid, its shadow, a glass highlight and rim. */
function appIcon() {
  const tile = squircle(512, 512, 412);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>${DEFS}
    <clipPath id="clip"><path d="${tile}"/></clipPath>
  </defs>
  <path d="${tile}" fill="url(#tile)" filter="url(#shadow)"/>
  <g clip-path="url(#clip)">
    <rect width="1024" height="1024" fill="url(#glow)"/>
    ${BUBBLES}
    <g filter="url(#lift)" transform="translate(512 512) scale(1.08) translate(-506 -512)">${cuttlefish()}</g>
    <rect width="1024" height="1024" fill="url(#gloss)"/>
  </g>
  <path d="${squircle(512, 512, 409)}" fill="none" stroke="url(#rim)" stroke-width="5"/>
</svg>`;
}

/** Windows: a full rounded tile (Windows draws no plate of its own), the cuttlefish larger in it. */
function tileIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>${DEFS}
    <clipPath id="clip"><rect x="16" y="16" width="992" height="992" rx="196"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect width="1024" height="1024" fill="url(#tile)"/>
    <rect width="1024" height="1024" fill="url(#glow)"/>
    <g transform="translate(-40 -40) scale(1.08)">${BUBBLES}</g>
    <g filter="url(#lift)" transform="translate(512 512) scale(1.18) translate(-506 -512)">${cuttlefish()}</g>
    <rect width="1024" height="1024" fill="url(#gloss)" opacity="0.6"/>
  </g>
</svg>`;
}

/** The silhouette's arms: three, thick enough for 16 px. */
const SILHOUETTE_ARMS = [
  [[[452, 430], [372, 404], [330, 350], [262, 356]], 74, 34],
  [[[446, 512], [360, 518], [310, 500], [236, 516]], 78, 36],
  [[[452, 594], [372, 620], [330, 674], [262, 668]], 74, 34],
];
/** The silhouette's box on the 1024 grid, and its eye. */
const SILHOUETTE_BOX = '220 300 610 424';
const SILHOUETTE_EYE = { cx: 508, cy: 474, r: 46 };
const silhouette = (fill) => `<path d="${MANTLE}" fill="${fill}"/><g fill="${fill}">${SILHOUETTE_ARMS.map(([curve, from, to]) => arm(curve, from, to, 12)).join('')}</g>`;

/** Windows at 32 px and below, and its tray: the silhouette on the orange tile, a cream eye. */
function smallTile() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>${DEFS}</defs>
  <rect width="1024" height="1024" rx="230" fill="url(#tile)"/>
  <g transform="translate(512 520) scale(1.38) translate(-525 -512)">${silhouette(INK)}<circle cx="${SILHOUETTE_EYE.cx}" cy="${SILHOUETTE_EYE.cy}" r="${SILHOUETTE_EYE.r}" fill="${CREAM}"/></g>
</svg>`;
}

/** Windows' tray during a take: the small tile with a red recording dot in its corner, ringed in white to stand off the tile. */
function recordingTile() {
  return smallTile().replace('</svg>', `<circle cx="780" cy="780" r="230" fill="${RECORDING}" stroke="#fff" stroke-width="64"/>\n</svg>`);
}

/** macOS's menu bar: the silhouette alone, black, its eye cut out. */
function trayIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SILHOUETTE_BOX}">
  <defs><mask id="eye"><rect x="0" y="0" width="1024" height="1024" fill="#fff"/><circle cx="${SILHOUETTE_EYE.cx}" cy="${SILHOUETTE_EYE.cy}" r="${SILHOUETTE_EYE.r}" fill="#000"/></mask></defs>
  <g mask="url(#eye)">${silhouette('#000')}</g>
</svg>`;
}

/** The app's own mark (titles, the pill, the settings): the silhouette's paths, for icons.tsx. */
function markModule() {
  const paths = SILHOUETTE_ARMS.map(([curve, from, to]) => arm(curve, from, to, 12)).join('');
  const d = [MANTLE, ...[...paths.matchAll(/d="([^"]+)"/g)].map((match) => match[1])];
  const circles = [...paths.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"\/>/g)].map((match) => `M${match[1] - match[3]} ${match[2]}a${match[3]} ${match[3]} 0 1 0 ${2 * match[3]} 0a${match[3]} ${match[3]} 0 1 0 ${-2 * match[3]} 0Z`);
  return `// Generated by tools/icons.mjs (pnpm icons): the cuttlefish of Cuttle's icons as the app's own mark.
export const MARK_VIEW_BOX = '${SILHOUETTE_BOX}';
export const MARK_PATH = '${[...d, ...circles].join('')}';
export const MARK_EYE = { cx: ${SILHOUETTE_EYE.cx}, cy: ${SILHOUETTE_EYE.cy}, r: ${SILHOUETTE_EYE.r} };
`;
}

/** An .ico of PNGs (each size its own image, as Windows picks them). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    header[entry] = size >= 256 ? 0 : size;
    header[entry + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
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
  const wrote = [];
  try {
    // Windows: the full tile, the silhouette at 32 px and below
    const tile = tileIcon();
    const small = smallTile();
    const images = [];
    for (const size of [16, 24, 32, 48, 64, 128, 256]) images.push({ size, png: await render(size <= 32 ? small : tile, size) });
    writeFileSync(join(OUT, 'icon.ico'), ico(images));
    writeFileSync(join(OUT, 'icon.png'), images.at(-1).png);
    writeFileSync(join(OUT, 'tray.png'), await render(small, 16));
    writeFileSync(join(OUT, 'tray@2x.png'), await render(small, 32));
    const recording = recordingTile();
    writeFileSync(join(OUT, 'tray-recording.png'), await render(recording, 16));
    writeFileSync(join(OUT, 'tray-recording@2x.png'), await render(recording, 32));
    wrote.push('icon.ico', 'icon.png', 'tray.png', 'tray@2x.png', 'tray-recording.png', 'tray-recording@2x.png');

    // macOS: the squircle, packed by iconutil where there is one
    const icon = appIcon();
    writeFileSync(join(OUT, 'icon-mac.png'), await render(icon, 1024));
    const tray = trayIcon();
    writeFileSync(join(OUT, 'trayTemplate.png'), await render(tray, 16));
    writeFileSync(join(OUT, 'trayTemplate@2x.png'), await render(tray, 32));
    wrote.push('icon-mac.png', 'trayTemplate.png', 'trayTemplate@2x.png');
    if (process.platform === 'darwin' && existsSync('/usr/bin/iconutil')) {
      const iconset = join(work, 'icon.iconset');
      mkdirSync(iconset);
      for (const size of [16, 32, 128, 256, 512]) {
        writeFileSync(join(iconset, `icon_${size}x${size}.png`), await render(icon, size));
        writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), await render(icon, size * 2));
      }
      execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(OUT, 'icon.icns')]);
      wrote.push('icon.icns');
    } else {
      console.log('icon.icns is left as it is: iconutil runs on macOS only');
    }
    writeFileSync(MARK, markModule());
    console.log(`wrote apps/desktop/assets: ${wrote.join(', ')}; and apps/desktop/src/renderer/mark.ts`);
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

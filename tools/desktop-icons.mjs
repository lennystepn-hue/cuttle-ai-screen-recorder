// Draws the app's icons (Cuttle's mark: an orange tile with a dark arrow) into apps/desktop/assets/:
// icon.png (256), icon.ico (16–256), tray.png (16) and tray@2x.png (32). No image library: a small
// rasterizer with 4×4 supersampling and a PNG encoder on zlib.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../apps/desktop/assets/', import.meta.url);
const TOP_LEFT = [0xf0, 0x95, 0x6f];
const BOTTOM_RIGHT = [0xc4, 0x5a, 0x3f];
const ARROW = [0x1b, 0x0f, 0x0a];
/** The arrow in a 12-unit box: M2 2h5l3 4-3 4H2z. */
const POLYGON = [[2, 2], [7, 2], [10, 6], [7, 10], [2, 10]];

function insideRoundedSquare(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function insidePolygon(x, y) {
  let inside = false;
  for (let i = 0, j = POLYGON.length - 1; i < POLYGON.length; j = i++) {
    const [xi, yi] = POLYGON[i];
    const [xj, yj] = POLYGON[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size * 0.24;
  const arrow = size * 0.58;
  const offset = (size - arrow) / 2;
  const samples = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tile = 0;
      let dark = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = px + (sx + 0.5) / samples;
          const y = py + (sy + 0.5) / samples;
          if (!insideRoundedSquare(x, y, size, radius)) continue;
          tile++;
          if (insidePolygon(((x - offset) / arrow) * 12, ((y - offset) / arrow) * 12)) dark++;
        }
      }
      const n = samples * samples;
      const g = (px + py) / (2 * size);
      const base = TOP_LEFT.map((c, i) => c + (BOTTOM_RIGHT[i] - c) * g);
      const mix = tile === 0 ? 0 : dark / tile;
      const color = base.map((c, i) => Math.round(c + (ARROW[i] - c) * mix));
      const at = (py * size + px) * 4;
      pixels[at] = color[0];
      pixels[at + 1] = color[1];
      pixels[at + 2] = color[2];
      pixels[at + 3] = Math.round((tile / n) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(size) {
  const pixels = draw(size);
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(sizes) {
  const images = sizes.map(png);
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i;
    header[entry] = size >= 256 ? 0 : size;
    header[entry + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('icon.png', OUT), png(256));
writeFileSync(new URL('icon.ico', OUT), ico([16, 24, 32, 48, 64, 128, 256]));
writeFileSync(new URL('tray.png', OUT), png(16));
writeFileSync(new URL('tray@2x.png', OUT), png(32));
console.log('wrote apps/desktop/assets: icon.png, icon.ico, tray.png, tray@2x.png');

import { PNG } from 'pngjs';

/** A PNG, with a pHYs chunk of `dpi` dots per inch when given (as a Mac writes a Retina screenshot's 144). */
export function pngWith(width: number, height: number, dpi?: number): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(200);
  const bytes = PNG.sync.write(png);
  if (dpi === undefined) return bytes;
  // pHYs goes before the first IDAT: right after IHDR (8 + 25 bytes)
  const data = Buffer.alloc(9);
  const perMetre = Math.round(dpi / 0.0254);
  data.writeUInt32BE(perMetre, 0);
  data.writeUInt32BE(perMetre, 4);
  data[8] = 1;
  const chunk = Buffer.concat([Buffer.alloc(4), Buffer.from('pHYs'), data, Buffer.alloc(4)]);
  chunk.writeUInt32BE(9, 0);
  chunk.writeUInt32BE(crc(chunk.subarray(4, 17)), 17);
  return Buffer.concat([bytes.subarray(0, 33), chunk, bytes.subarray(33)]);
}

function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A new screenshot's folder in `parent`, named by the local time as a screenshot is
 * (`2026-10-24 19.42.10`), with a number after it when that one is taken.
 */
export function newShotFolder(parent: string, now = new Date()): string {
  const two = (value: number) => String(value).padStart(2, '0');
  const name = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}.${two(now.getMinutes())}.${two(now.getSeconds())}`;
  for (let n = 1; ; n++) {
    const folder = join(parent, n === 1 ? name : `${name} ${n}`);
    if (!existsSync(folder)) return folder;
  }
}

/**
 * A screenshot's pixels per point from its PNG's resolution (pHYs): a Mac writes 144 dpi from a Retina
 * display; 72 and 96 dpi are 1. Undefined for another image or one that says nothing.
 */
export function pngScale(bytes: Uint8Array): number | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || signature.some((value, i) => bytes[i] !== value)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'pHYs' && length >= 9 && at + 17 <= bytes.length) {
      // pixels per metre, the unit 1 (metres); 0: an aspect ratio only
      if (bytes[at + 16] !== 1) return undefined;
      const dpi = view.getUint32(at + 8) * 0.0254;
      return dpi > 100 ? Math.min(4, Math.max(1, Math.round((dpi / 72) * 4) / 4)) : 1;
    }
    if (type === 'IDAT' || type === 'IEND') return undefined;
    at += 12 + length;
  }
  return undefined;
}

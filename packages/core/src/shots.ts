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

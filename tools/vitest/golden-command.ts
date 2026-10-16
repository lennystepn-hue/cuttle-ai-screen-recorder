import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { BrowserCommand } from 'vitest/node';
import type { GoldenOptions, GoldenResult } from './golden-types.ts';

/** Where the golden for `name` lives: next to the test file, one PNG per platform (text rasterizes differently per OS). */
export function goldenPath(testPath: string, name: string): string {
  return resolve(dirname(testPath), '__golden__', basename(testPath), `${name}.${process.platform}.png`);
}

function writePng(path: string, width: number, height: number, rgba: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  writeFileSync(path, PNG.sync.write(png));
}

/**
 * Compares top-down RGBA pixels from the browser with the golden PNG. Same rules as snapshots:
 * a missing golden is written and the test fails once ("review it"), `vitest -u` overwrites
 * mismatching goldens, and CI (`CI=true`) never writes one.
 */
export const matchGolden: BrowserCommand<
  [name: string, rgbaBase64: string, width: number, height: number, opts?: GoldenOptions],
  Promise<GoldenResult>
> = async (ctx, name, rgbaBase64, width, height, opts = {}) => {
  if (!ctx.testPath) throw new Error('matchGolden: no test path');
  const refPath = goldenPath(ctx.testPath, name);
  const actual = Buffer.from(rgbaBase64, 'base64');
  if (actual.length !== width * height * 4) {
    throw new Error(`matchGolden: expected ${width * height * 4} bytes, got ${actual.length}`);
  }
  // 'all' with -u, 'new' by default, 'none' on CI
  const mode = ctx.project.vitest.config.snapshotOptions.updateSnapshot;
  if (!existsSync(refPath)) {
    if (mode === 'none') throw new Error(`no golden at ${refPath} (CI does not create goldens)`);
    writePng(refPath, width, height, actual);
    throw new Error(`golden created, look at it and run the tests again: ${refPath}`);
  }
  const ref = PNG.sync.read(readFileSync(refPath));
  if (ref.width !== width || ref.height !== height) {
    if (mode === 'all') {
      writePng(refPath, width, height, actual);
      return { status: 'updated', mismatched: width * height };
    }
    throw new Error(`golden is ${ref.width}x${ref.height}, render is ${width}x${height}: ${refPath}`);
  }
  const diff = new Uint8Array(width * height * 4);
  const mismatched = pixelmatch(ref.data, actual, diff, width, height, { threshold: opts.threshold ?? 0.05 });
  if (mismatched <= (opts.allowedMismatchedPixels ?? 0)) return { status: 'match', mismatched };
  if (mode === 'all') {
    writePng(refPath, width, height, actual);
    return { status: 'updated', mismatched };
  }
  const outDir = resolve(ctx.project.config.root, '.vitest', 'golden-diff', basename(ctx.testPath));
  writePng(resolve(outDir, `${name}.actual.png`), width, height, actual);
  writePng(resolve(outDir, `${name}.diff.png`), width, height, diff);
  throw new Error(`${mismatched} pixels differ from ${refPath}\n  actual and diff images: ${outDir}`);
};

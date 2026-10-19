// Reading the screen's text for the privacy masks: the frames where the picture changed inside the
// clips (compared 10 times a second; read at most 2 a second while it keeps changing, at least one
// every 5 s, and once more where a change showed only a moment), each read with the system's OCR
// (ocr.ts), written as the take's screen-text.jsonl. Only the frames that are read are written to a
// temporary folder, one at a time, and removed once read.
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScreenTextFrame } from '@cuttle/project';
import { CoreError } from '../errors';
import { runFfmpeg } from '../ffmpeg';
import type { Span } from '../suggest/spans';
import { ScreenReader } from './ocr';

export const READ_RULES = {
  /** The picture is compared this many times a second, so a change that shows only a moment is seen… */
  detect: 10,
  /** …at most this many frames a second are read while it keeps changing (typing, scrolling)… */
  rate: 2,
  /** …and at least one every this many seconds while the clips run. */
  every: 5,
  /** Frames are compared this wide (in grey)… */
  width: 320,
  /** …a pixel changed when its grey moved more than this… */
  threshold: 24,
  /** …and a frame changed from this many changed pixels (a caret's blink is fewer). */
  minPixels: 24,
};

/** The take's file of what the screen read. */
export const SCREEN_TEXT_FILE = 'screen-text.jsonl';

/**
 * The source seconds to read inside `spans`: each span's first frame; a frame that changed since the
 * last one read, `rate` a second at most; one at least every `every` seconds. A change that came
 * too soon after a read and went before the next read was due (a token that flashed) is read as
 * well. The frames are compared `detect` times a second.
 */
export async function framesToRead(screen: string, spans: readonly Span[], size: { width: number; height: number }, rules = READ_RULES): Promise<number[]> {
  const width = rules.width;
  const height = 2 * Math.round((width * size.height) / size.width / 2);
  const area = width * height;
  const times: number[] = [];
  for (const span of spans) {
    if (!(span.to > span.from)) continue;
    /** The last frame read, and the first change since then that came too soon to be read. */
    let kept: { t: number; data: Buffer } | undefined;
    let waiting: number | undefined;
    const read = (t: number, data: Buffer) => {
      kept = { t, data };
      times.push(t);
    };
    let pending: Buffer = Buffer.alloc(0);
    let index = 0;
    await runFfmpeg(['-ss', span.from.toFixed(3), '-t', (span.to - span.from).toFixed(3), '-i', screen, '-map', '0:v:0', '-vf', `fps=${rules.detect},scale=${width}:${height},format=gray`, '-f', 'rawvideo', '-'], (chunk) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length >= area) {
        const data = pending.subarray(0, area);
        pending = pending.subarray(area);
        const t = Math.round((span.from + index++ / rules.detect) * 1000) / 1000;
        if (t >= span.to) continue;
        if (!kept || t - kept.t >= rules.every) {
          read(t, data);
          continue;
        }
        let changed = 0;
        for (let i = 0; i < area && changed < rules.minPixels; i++) if (Math.abs(data[i]! - kept.data[i]!) > rules.threshold) changed++;
        if (changed >= rules.minPixels && t - kept.t >= 1 / rules.rate) {
          waiting = undefined;
          read(t, data);
        } else if (changed >= rules.minPixels) waiting ??= t;
        else if (waiting !== undefined) {
          // back to what was read before the next read was due: the change showed only a moment
          times.push(waiting);
          waiting = undefined;
        }
      }
    });
    if (waiting !== undefined) times.push(waiting);
  }
  return times;
}

/**
 * Reads the screen's text of `screen` at `times` (source seconds) with the OCR helper, in order;
 * `onProgress` gets the share done. `ocr-missing` where the helper cannot run.
 */
export async function readFrames(
  screen: string,
  times: readonly number[],
  size: { width: number; height: number },
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<{ frames: ScreenTextFrame[]; language: string }> {
  const reader = await ScreenReader.start();
  const folder = mkdtempSync(join(tmpdir(), 'cuttle-screen-'));
  const extract = async (k: number) => {
    const path = join(folder, `${k}.png`);
    await runFfmpeg(['-ss', times[k]!.toFixed(3), '-i', screen, '-map', '0:v:0', '-frames:v', '1', '-y', path]);
    return path;
  };
  const frames: ScreenTextFrame[] = [];
  try {
    // the next frame is written while the OCR reads this one
    let next = times.length > 0 ? extract(0) : undefined;
    for (let k = 0; k < times.length; k++) {
      if (options.signal?.aborted) throw new CoreError('cancelled', 'reading the screen was cancelled');
      const path = await next!;
      next = k + 1 < times.length ? extract(k + 1) : undefined;
      next?.catch(() => {});
      const lines = await reader.read(path, size.width, size.height);
      rmSync(path, { force: true });
      frames.push({ t: times[k]!, lines });
      options.onProgress?.((k + 1) / times.length);
    }
    await next?.catch(() => {});
  } finally {
    reader.close();
    rmSync(folder, { recursive: true, force: true });
  }
  return { frames, language: reader.language };
}

/** Writes screen-text.jsonl (whole, or not at all). */
export function writeScreenText(path: string, frames: readonly ScreenTextFrame[]): void {
  writeFileSync(`${path}.part`, frames.map((frame) => `${JSON.stringify(frame)}\n`).join(''));
  renameSync(`${path}.part`, path);
}

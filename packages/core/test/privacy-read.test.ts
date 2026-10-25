import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runFfmpeg } from '../src/ffmpeg';
import { ScreenReader } from '../src/privacy/ocr';
import { READ_RULES, framesToRead, helpersFor, readFrames, readingNote } from '../src/privacy/read';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const size = { width: 640, height: 360 };

/** A screen video, 640×360 at 30 fps: white (or `source`), with dark boxes shown from `from` to `to` (seconds). */
async function screen(seconds: number, boxes: { from: number; to: number; x: number }[], source = 'color=c=white'): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-read-'));
  dirs.push(dir);
  const file = join(dir, 'screen.mp4');
  const draw = boxes.map((box) => `drawbox=x=${box.x}:y=150:w=200:h=40:color=black:t=fill:enable='between(t,${box.from},${box.to})'`).join(',');
  await runFfmpeg(['-f', 'lavfi', '-i', `${source}${source.includes('=') ? ':' : '='}s=640x360:r=30:d=${seconds}`, ...(draw ? ['-vf', draw] : []), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', file]);
  return file;
}

describe('framesToRead', () => {
  it('reads a change that showed only a moment, right after a read', async () => {
    // a box appears at 1 s (read), a token flashes from 1.15 to 1.35 s: too soon after that read,
    // and gone before the next one is due
    const file = await screen(3, [
      { from: 0.95, to: 3, x: 40 },
      { from: 1.15, to: 1.35, x: 360 },
    ]);
    expect(await framesToRead(file, [{ from: 0, to: 3 }], size)).toEqual([0, 1, 1.2]);
  });

  it('reads at most `rate` frames a second while the picture keeps changing, and one every `every` seconds of a still one', async () => {
    const moving = await screen(3, [], 'testsrc2');
    const times = await framesToRead(moving, [{ from: 0, to: 3 }], size);
    expect(times.slice(0, 3 * READ_RULES.rate)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    // and the change after the last read, before the clip ends
    expect(times.slice(3 * READ_RULES.rate)).toEqual([2.6]);
    const still = await screen(11, []);
    expect(await framesToRead(still, [{ from: 0, to: 11 }], size)).toEqual([0, 5, 10]);
  });

  it("reads the frame a change came in, at its start, in a take with a frame only when the screen changes (macOS's)", async () => {
    // white frames at 0 and 1.21 s, a box (a menu) from the frame at 1.2412 s, white again at 2.0687:
    // the box comes just after a 10th of a second, with a frame without it in between
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-read-'));
    dirs.push(dir);
    const file = join(dir, 'screen.mp4');
    const at = [0, 1.21, 1.2412, 2.0687, 3].map((t) => Math.round(t * 1e6));
    const pts = at.slice(0, -1).reduceRight((rest, t, k) => `if(eq(N\\,${k})\\,${t}\\,${rest})`, String(at.at(-1)));
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=white:s=640x360:r=30:d=0.1667', '-vf', `drawbox=x=40:y=150:w=200:h=40:color=black:t=fill:enable='eq(n\\,2)',settb=1/1000000,setpts='${pts}',format=yuv420p`, '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast', '-enc_time_base', '1/1000000', '-video_track_timescale', '1000000', '-y', file]);
    expect(await framesToRead(file, [{ from: 0, to: 3 }], size)).toEqual([0, 1.2412, 2.0687]);
  });

  it('reads each span from its first frame, in source seconds', async () => {
    const file = await screen(4, [{ from: 2.45, to: 4, x: 40 }]);
    expect(await framesToRead(file, [{ from: 0.5, to: 1.5 }, { from: 2, to: 4 }], size)).toEqual([0.5, 2, 2.5]);
  });
});

describe('helpersFor', () => {
  it('reads with one OCR helper for every four logical processors, three at most, and one for every four frames', () => {
    expect([helpersFor(1, 16), helpersFor(6, 16), helpersFor(15, 16), helpersFor(100, 32)]).toEqual([1, 2, 3, 3]);
    expect([helpersFor(15, 8), helpersFor(15, 4), helpersFor(15, 2)]).toEqual([2, 1, 1]);
    expect(helpersFor(0, 16)).toBe(1);
  });
});

/**
 * A pretend cuttle-capture (macOS's OCR helper, `CUTTLE_CAPTURE_HELPER`): a Node script that speaks
 * its protocol. `ready`: its first answer after preparing; `answer`: its answer to a picture's path.
 */
function pretendHelper(ready: Record<string, unknown>, answer: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-helper-'));
  dirs.push(dir);
  const file = join(dir, 'cuttle-capture');
  writeFileSync(
    file,
    `#!${process.execPath}
const say = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
say({ preparing: true });
say(${JSON.stringify(ready)});
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const path = JSON.parse(line).path;
  say((${answer})(path));
});
`,
  );
  chmodSync(file, 0o755);
  return file;
}

/** Runs `body` with `CUTTLE_CAPTURE_HELPER` set to `helper`, and the OCR on (the tests switch it off). */
async function withHelper<T>(helper: string, body: () => Promise<T>): Promise<T> {
  const before = { helper: process.env.CUTTLE_CAPTURE_HELPER, ocr: process.env.CUTTLE_OCR };
  process.env.CUTTLE_CAPTURE_HELPER = helper;
  delete process.env.CUTTLE_OCR;
  try {
    return await body();
  } finally {
    for (const [key, value] of [['CUTTLE_CAPTURE_HELPER', before.helper], ['CUTTLE_OCR', before.ocr]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('reading when macOS reads less well', () => {
  const fast = { ready: true, language: 'de-DE', max: 16384, level: 'fast', why: 'CRImageReaderError error 1' };

  it.runIf(process.platform === 'darwin')("reads on with macOS's fast recognition where its accurate one failed, and leaves out a picture the OCR rejects", async () => {
    const helper = pretendHelper(fast, `(path) => path.endsWith('/1.png') ? { error: 'rejected' } : { lines: [[{ t: 'hello', r: [1, 2, 30, 10] }]], level: 'fast', why: 'CRImageReaderError error 1' }`);
    const read = await withHelper(helper, async () => readFrames(await screen(3, []), [0, 1, 2], size, { helpers: 1 }));
    expect(read.frames.map((frame) => frame.t)).toEqual([0, 2]);
    expect(read.frames[0]!.lines[0]!.text).toBe('hello');
    expect([read.skipped, read.fast]).toEqual([1, 'CRImageReaderError error 1']);
    expect(readingNote(read)).toBe("macOS's accurate text recognition failed here (CRImageReaderError error 1), so its fast one read the screen, which misses more; 1 frame could not be read: look for private things yourself");
  });

  it.runIf(process.platform === 'darwin')('does not read when not one picture could be read', async () => {
    const helper = pretendHelper({ ready: true, language: 'de-DE', max: 16384 }, `() => ({ error: 'rejected' })`);
    await expect(withHelper(helper, async () => readFrames(await screen(2, []), [0, 1], size, { helpers: 1 }))).rejects.toThrow(/could not read .*rejected/);
  });

  it.runIf(process.platform === 'darwin')('says why where macOS reads no text at all, so the app only notes it', async () => {
    const helper = pretendHelper({ ready: false, error: "macOS's text recognition does not read here (broken)" }, `() => ({})`);
    await expect(withHelper(helper, () => ScreenReader.start())).rejects.toMatchObject({ code: 'ocr-missing', message: "macOS's text recognition does not read here (broken)" });
  });

  it('says nothing where it read as it should', () => {
    expect(readingNote({ skipped: 0 })).toBeUndefined();
    expect(readingNote({ skipped: 2 })).toBe('2 frames could not be read: look for private things yourself');
  });
});

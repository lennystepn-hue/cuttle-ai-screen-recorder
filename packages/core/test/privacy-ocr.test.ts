import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '@cuttle/project';
import { captureHelper } from '@cuttle/recorder';
import { activeMasks } from '@cuttle/timeline';
import { runFfmpeg } from '../src/ffmpeg';
import { followScreenText } from '../src/privacy/apply';
import { privacyMasks } from '../src/privacy/masks';
import { framesToRead, readFrames } from '../src/privacy/read';
import { redactFrames } from '../src/privacy/redact';
import { OCR_TIMEOUT, ScreenReader, answerWithin } from '../src/privacy/ocr';
import { SCROLL_TAKE, scrolledAt, writeScrollTake } from './scrolling';

describe('answerWithin', () => {
  it("ends a helper that does not answer in time, and passes an answer that comes", async () => {
    const hung = vi.fn();
    const never: AsyncIterator<string> = { next: () => new Promise(() => {}) };
    await expect(answerWithin(never, 0.05, 'reading a.png', hung)).rejects.toMatchObject({ code: 'ocr-missing', message: 'the OCR helper did not answer within 0.05 s (reading a.png)' });
    expect(hung).toHaveBeenCalledOnce();
    const soon: AsyncIterator<string> = { next: () => Promise.resolve({ done: false, value: '{"lines":[]}' }) };
    await expect(answerWithin(soon, 1, 'reading b.png', hung)).resolves.toEqual({ done: false, value: '{"lines":[]}' });
    expect(hung).toHaveBeenCalledOnce();
  });
});

/**
 * A stand-in for macOS's `cuttle-capture ocr` in `dir`: it says it prepares, prepares for `ms` (-1:
 * for good) until one of its runs was ready, then at once (as Vision's networks stay compiled once
 * compiled for it), and reads every picture as empty. It notes in `log` when it started and when it
 * was ready, each line "<pid> <what> <ms since 1970>".
 */
function preparingHelper(dir: string, ms: number, log: string): string {
  const file = join(dir, `ocr-${ms}.mjs`);
  writeFileSync(
    file,
    `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const prepared = ${JSON.stringify(join(dir, 'prepared'))};
const note = (what) => appendFileSync(${JSON.stringify(log)}, process.pid + ' ' + what + ' ' + Date.now() + '\\n');
note('started');
process.stdout.write('{"preparing":true}\\n');
if (${ms} < 0) setInterval(() => {}, 1000);
else setTimeout(() => {
  writeFileSync(prepared, '');
  note('ready');
  process.stdout.write('{"ready":true,"language":"en-US","max":16384}\\n');
  createInterface({ input: process.stdin }).on('line', () => process.stdout.write('{"lines":[]}\\n'));
}, existsSync(prepared) ? 0 : ${ms});
`,
  );
  chmodSync(file, 0o755);
  return file;
}

describe.runIf(process.platform === 'darwin')('an OCR helper that prepares Vision first (macOS)', () => {
  const withHelper = async (ms: number, run: (dir: string, log: string) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-ocr-'));
    const log = join(dir, 'helpers.log');
    const chosen = process.env.CUTTLE_CAPTURE_HELPER;
    const off = process.env.CUTTLE_OCR;
    delete process.env.CUTTLE_OCR;
    process.env.CUTTLE_CAPTURE_HELPER = preparingHelper(dir, ms, log);
    try {
      await run(dir, log);
    } finally {
      if (chosen === undefined) delete process.env.CUTTLE_CAPTURE_HELPER;
      else process.env.CUTTLE_CAPTURE_HELPER = chosen;
      if (off !== undefined) process.env.CUTTLE_OCR = off;
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("gives the preparing its own time, not a picture's, and ends a helper that does not get ready", async () => {
    // prepared in 0.5 s, longer than a picture may take here: the first picture is read all the same
    await withHelper(500, async (dir) => {
      const reader = await ScreenReader.start({ timeout: { start: 10, prepare: 10, read: 0.25 } });
      try {
        expect(await reader.read(join(dir, 'a.png'), 64, 36)).toEqual([]);
      } finally {
        reader.close();
      }
    });
    await withHelper(-1, async () => {
      await expect(ScreenReader.start({ timeout: { start: 10, prepare: 0.25, read: 10 } })).rejects.toMatchObject({ code: 'ocr-missing', message: "the OCR helper did not answer within 0.25 s (preparing macOS's text recognition)" });
    });
  });

  it('says once that the helper prepares when it takes long, and not when it was prepared before', async () => {
    await withHelper(600, async () => {
      const onPreparing = vi.fn();
      (await ScreenReader.start({ notice: 0.2, onPreparing })).close();
      expect(onPreparing).toHaveBeenCalledOnce();
      (await ScreenReader.start({ notice: 0.2, onPreparing })).close();
      expect(onPreparing).toHaveBeenCalledOnce();
    });
  });

  it('starts one helper alone and the others once it is ready, and says once that it prepares', async () => {
    // longer than PREPARING_NOTICE (2 s): the first helper is said to prepare, the others find it prepared
    await withHelper(2300, async (dir, log) => {
      const video = join(dir, 'still.mp4');
      expect(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=64x36:r=10:d=2', '-pix_fmt', 'yuv420p', '-y', video]).status).toBe(0);
      const times = [0, 0.5, 1, 1.5];
      const onPreparing = vi.fn();
      const { frames } = await readFrames(video, times, { width: 64, height: 36 }, { helpers: 3, onPreparing });
      expect(frames.map((frame) => frame.t)).toEqual(times);
      expect(onPreparing).toHaveBeenCalledOnce();
      const notes = readFileSync(log, 'utf8').trim().split('\n').map((line) => line.split(' '));
      const [lead] = notes[0]!;
      const ready = Number(notes.find(([pid, what]) => pid === lead && what === 'ready')![2]);
      const others = notes.filter(([pid, what]) => pid !== lead && what === 'started');
      expect(others).toHaveLength(2);
      for (const [, , at] of others) expect(Number(at)).toBeGreaterThanOrEqual(ready);
    });
  });

  it('is what cuttle-capture does: it says it prepares, then that it is ready', async () => {
    const helper = captureHelper('');
    expect(helper, 'cuttle-capture is built (pnpm install)').toBeDefined();
    const child = spawn(helper!, ['ocr']);
    try {
      const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
      expect(JSON.parse((await lines.next()).value as string)).toEqual({ preparing: true });
      expect(JSON.parse((await lines.next()).value as string)).toMatchObject({ ready: true });
    } finally {
      child.kill();
    }
  }, (OCR_TIMEOUT.prepare + 10) * 1000);
});

/**
 * The system's own OCR (Windows', macOS's Vision) on a page with planted fake secrets
 * (fixtures/privacy/secrets.html, rendered at 1920 × 1080 by `cuttle capture-page`): each secret it
 * reads gets a mask, the clean lines none. It runs where there is one; elsewhere it is skipped. Each
 * test has the time macOS may take to prepare Vision besides its own (a minute where it compiles).
 */
/**
 * These check what the accurate recognition reads: where macOS has it broken for the helper (it reads
 * with the fast one, `ScreenReader.fast`), they cannot, and say why instead of failing.
 */
function skipWhereFast(reader: ScreenReader, context: { skip: (note?: string) => never }): void {
  if (reader.fast === undefined) return;
  reader.close();
  context.skip(`macOS's accurate text recognition does not work for cuttle-capture on this Mac (${reader.fast})`);
}

describe.runIf(process.platform === 'win32' || process.platform === 'darwin')('reading the screen with the system OCR', () => {
  it('reads the page and masks what is private on it, and nothing on the clean lines', async (context) => {
    delete process.env.CUTTLE_OCR;
    const reader = await ScreenReader.start();
    skipWhereFast(reader, context);
    let lines;
    try {
      lines = await reader.read(join(import.meta.dirname, 'fixtures', 'privacy', 'secrets.png'), 1920, 1080);
    } finally {
      reader.close();
    }
    const text = lines.map((line) => line.text).join('\n');
    expect(text).toContain('lena.mueller@example.com');
    const masks = privacyMasks([{ t: 1, lines }, { t: 2, lines: [] }, { t: 3, lines: [] }], [], { width: 1920, height: 1080 });
    const kinds = new Set(masks.map((mask) => mask.kind));
    // Windows' OCR splits `NAME=value` lines at the = (a secret value); Vision reads them whole (a key)
    for (const kind of ['email', 'phone', 'iban', 'key', ...(process.platform === 'win32' ? ['value'] : [])]) expect(kinds, kind).toContain(kind);
    // each planted secret the OCR read is under a mask (the small grey card number and the wrapped
    // end of the curl line go unread, as in the spike); the clean lines are not
    const under = (rect: Rect) => masks.some((mask) => rect[0] < mask.rect[0] + mask.rect[2] && mask.rect[0] < rect[0] + rect[2] && rect[1] < mask.rect[1] + mask.rect[3] && mask.rect[1] < rect[1] + rect[3]);
    // the GitLab token's "glpat-" read as it is (Vision) or as "g1pat-" (Windows)
    for (const secret of ['lena.mueller@example.com', '+49', 'DE89', 'sk-ant-', 'ghp_', 'AKIA', 'SESSION=', 'pat-AbCd']) {
      const line = lines.find((one) => one.words.some((word) => word.text.includes(secret.split(' ')[0]!)));
      expect(line, secret).toBeDefined();
      expect(under(line!.words.find((word) => word.text.includes(secret.split(' ')[0]!))!.rect), secret).toBe(true);
    }
    for (const clean of ['Release', 'Order']) {
      const line = lines.find((one) => one.text.startsWith(clean));
      expect(line, clean).toBeDefined();
      expect(under(line!.rect), clean).toBe(false);
    }
    // as the text is kept: none of what it found is left, the clean lines are, the masks are the same
    const read = [{ t: 1, lines }, { t: 2, lines: [] }, { t: 3, lines: [] }];
    const kept = redactFrames(read, []).frames;
    const keptText = JSON.stringify(kept);
    for (const secret of ['lena.mueller@example.com', 'DE89', 'AbCdEf', 'AKIA', 'SESSION=']) expect(keptText, secret).not.toContain(secret);
    for (const clean of ['Release', 'Order']) expect(keptText, clean).toContain(clean);
    expect(privacyMasks(kept, [], { width: 1920, height: 1080 })).toEqual(masks);
  }, 60_000 + OCR_TIMEOUT.prepare * 1000);

  it('masks every email address it reads in an editor in a monospaced font, the spaces and long dashes the OCR reads in them too', async (context) => {
    delete process.env.CUTTLE_OCR;
    const reader = await ScreenReader.start();
    skipWhereFast(reader, context);
    let lines;
    try {
      // fixtures/privacy/emails.html, rendered at 1920 × 1080 by `cuttle capture-page`: lines of four
      // addresses each in Consolas, Cascadia Mono and Courier New, an editor's colours
      lines = await reader.read(join(import.meta.dirname, 'fixtures', 'privacy', 'emails.png'), 1920, 1080);
    } finally {
      reader.close();
    }
    const masks = privacyMasks([{ t: 1, lines }, { t: 2, lines: [] }, { t: 3, lines: [] }], [], { width: 1920, height: 1080 });
    const under = (rect: Rect) => masks.some((mask) => rect[0] < mask.rect[0] + mask.rect[2] && mask.rect[0] < rect[0] + rect[2] && rect[1] < mask.rect[1] + mask.rect[3] && mask.rect[1] < rect[1] + rect[3]);
    const read = lines.filter((line) => /contact/i.test(line.text));
    expect(read.length, lines.map((line) => line.text).join('\n')).toBeGreaterThanOrEqual(4);
    // after "contact:" a line holds addresses only: each word of it the OCR read is under a mask
    for (const line of read) {
      const start = line.words.findIndex((word) => /contact/i.test(word.text));
      for (const word of line.words.slice(start + 1).filter((one) => /[a-z]/i.test(one.text))) expect(under(word.rect), `"${word.text}" in: ${line.text}`).toBe(true);
    }
  }, 60_000 + OCR_TIMEOUT.prepare * 1000);

  it('reads frames with several helpers at once, each frame its own text, in order', async () => {
    delete process.env.CUTTLE_OCR;
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-ocr-'));
    try {
      // the page for 6 s, its upper half black in every odd second (lossless: each second's frames are the same)
      const video = join(dir, 'page.mp4');
      const made = spawnSync('ffmpeg', ['-v', 'error', '-loop', '1', '-i', join(import.meta.dirname, 'fixtures', 'privacy', 'secrets.png'), '-t', '6', '-r', '10', '-vf', "drawbox=x=0:y=0:w=1920:h=540:color=black:t=fill:enable='mod(floor(t),2)',format=yuv420p", '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-y', video]);
      expect(made.status).toBe(0);
      const times = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
      const size = { width: 1920, height: 1080 };
      const one = await readFrames(video, times, size, { helpers: 1 });
      const progress: number[] = [];
      const three = await readFrames(video, times, size, { helpers: 3, onProgress: (share) => progress.push(share) });
      expect(three).toEqual(one);
      expect(three.frames.map((frame) => frame.t)).toEqual(times);
      const counts = three.frames.map((frame) => frame.lines.length);
      expect(counts[0]).toBeGreaterThan(counts[1]!);
      expect([counts[2], counts[4]]).toEqual([counts[0], counts[0]]);
      expect([counts[3], counts[5]]).toEqual([counts[1], counts[1]]);
      expect(progress).toEqual([1, 2, 3, 4, 5, 6].map((done) => done / 6));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000 + OCR_TIMEOUT.prepare * 1000);

  it('keeps the key of a page that scrolls covered in every frame: read where the screen changed, followed from frame to frame', async () => {
    delete process.env.CUTTLE_OCR;
    const { width, height, header, rate, seconds } = SCROLL_TAKE;
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-scroll-'));
    try {
      // the page (fixtures/privacy/scroll.html, rendered 1280 px wide by `cuttle capture-page --scroll`), in grey;
      // its planted key's value at (197, 991), 354 × 13 px
      const png = join(import.meta.dirname, 'fixtures', 'privacy', 'scroll.png');
      const { stdout } = await runFfmpeg(['-i', png, '-vf', 'format=gray', '-f', 'rawvideo', '-']);
      const key: Rect = [197, 991, 354, 13];
      const video = join(dir, 'screen.mp4');
      await writeScrollTake(video, { height: stdout.length / width, data: new Uint8Array(stdout) });
      const size = { width, height };
      const { frames } = await readFrames(video, await framesToRead(video, [{ from: 0, to: seconds }], size), size);
      /** Frames where some of the key shows outside every mask, and frames with a mask where none of it shows. */
      const look = (masks: ReturnType<typeof privacyMasks>) => {
        let open = 0;
        let astray = 0;
        for (let n = 0; n < seconds * rate; n++) {
          const t = n / rate;
          const top = Math.max(header, key[1] - scrolledAt(t));
          const bottom = Math.min(height, key[1] - scrolledAt(t) + key[3]);
          const shown = activeMasks(masks.map((mask, k) => ({ ...mask, id: `m${k}`, style: 'fill' as const, enabled: true })), t).map((mask) => mask.rect);
          if (bottom <= top) astray += shown.length > 0 ? 1 : 0;
          else if (!shown.some((mask) => mask[0] <= key[0] && mask[0] + mask[2] >= key[0] + key[2] && mask[1] <= top && mask[1] + mask[3] >= bottom)) open++;
        }
        return { open, astray };
      };
      // the places the reads found leave it open as it comes in, goes up and back, and goes out
      expect(look(privacyMasks(frames, [], size, seconds)).open).toBeGreaterThan(10);
      const followed = await followScreenText(video, frames, [], { ...size, duration: seconds });
      const after = look(privacyMasks(frames, [], size, seconds, undefined, followed));
      expect(after.open).toBe(0);
      expect(after.astray).toBeLessThanOrEqual(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000 + OCR_TIMEOUT.prepare * 1000);
});

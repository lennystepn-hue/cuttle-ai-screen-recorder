import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';
import { readFrames } from '../src/privacy/read';
import { redactFrames } from '../src/privacy/redact';
import { ScreenReader, answerWithin } from '../src/privacy/ocr';

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
 * The system's own OCR (Windows', macOS's Vision) on a page with planted fake secrets
 * (fixtures/privacy/secrets.html, rendered at 1920 × 1080 by `cuttle capture-page`): each secret it
 * reads gets a mask, the clean lines none. It runs where there is one; elsewhere it is skipped.
 */
describe.runIf(process.platform === 'win32' || process.platform === 'darwin')('reading the screen with the system OCR', () => {
  it('reads the page and masks what is private on it, and nothing on the clean lines', async () => {
    delete process.env.CUTTLE_OCR;
    const reader = await ScreenReader.start();
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
  }, 60_000);

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
  }, 120_000);
});

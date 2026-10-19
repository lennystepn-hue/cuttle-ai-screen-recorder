import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Rect } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';
import { redactFrames } from '../src/privacy/redact';
import { ScreenReader } from '../src/privacy/ocr';

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
});

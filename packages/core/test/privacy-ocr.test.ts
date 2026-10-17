import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Rect } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';
import { ScreenReader } from '../src/privacy/ocr';

/**
 * Windows' own OCR on a page with planted fake secrets (fixtures/privacy/secrets.html, rendered at
 * 1920 × 1080 by `cuttle capture-page`): each secret it reads gets a mask, the clean lines none.
 * It runs on Windows, where the OCR is; elsewhere it is skipped.
 */
describe.runIf(process.platform === 'win32')('reading the screen with Windows OCR', () => {
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
    for (const kind of ['email', 'phone', 'iban', 'key', 'value']) expect(kinds, kind).toContain(kind);
    // each planted secret the OCR read is under a mask (the small grey card number and the wrapped
    // end of the curl line go unread, as in the spike); the clean lines are not
    const under = (rect: Rect) => masks.some((mask) => rect[0] < mask.rect[0] + mask.rect[2] && mask.rect[0] < rect[0] + rect[2] && rect[1] < mask.rect[1] + mask.rect[3] && mask.rect[1] < rect[1] + rect[3]);
    for (const secret of ['lena.mueller@example.com', '+49', 'DE89', 'sk-ant-', 'ghp_', 'AKIA', 'SESSION=', 'g1pat-']) {
      const line = lines.find((one) => one.words.some((word) => word.text.includes(secret.split(' ')[0]!)));
      expect(line, secret).toBeDefined();
      expect(under(line!.words.find((word) => word.text.includes(secret.split(' ')[0]!))!.rect), secret).toBe(true);
    }
    for (const clean of ['Release', 'Order']) {
      const line = lines.find((one) => one.text.startsWith(clean));
      expect(line, clean).toBeDefined();
      expect(under(line!.rect), clean).toBe(false);
    }
  }, 60_000);
});

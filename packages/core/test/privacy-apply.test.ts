import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { InputEvent } from '@cuttle/project';
import { runFfmpeg } from '../src/ffmpeg';
import { applyPrivacy } from '../src/privacy/apply';
import { notificationMasks } from '../src/privacy/notifications';

const screen = { width: 1920, height: 1080 };
const toast = (t: number, open: boolean, id = 9, rect: [number, number, number, number] = [1530, 980, 380, 110]): InputEvent => ({ t, type: 'window', id, kind: 'notification', rect, open });

describe('notificationMasks', () => {
  it('masks a notification from just before it was seen open to just after it was seen gone, padded and on the screen', () => {
    // 1530 + 380 + 6 runs past the screen's right edge: it ends at 1920
    expect(notificationMasks([toast(4, true), toast(9, false)], screen)).toEqual([{ from: 3.7, to: 9.3, rect: [1524, 974, 392, 106] }]);
  });

  it('lasts to the take\'s end when it never closed, and leaves out one off the screen and other windows', () => {
    expect(notificationMasks([toast(4, true)], screen, 12)).toEqual([{ from: 3.7, to: 12, rect: [1524, 974, 392, 106] }]);
    expect(notificationMasks([toast(4, true, 9, [2000, 100, 300, 100])], screen)).toEqual([]);
    expect(notificationMasks([{ t: 4, type: 'window', id: 3, kind: 'dialog', rect: [100, 100, 400, 300], open: true }], screen)).toEqual([]);
  });
});

describe('applyPrivacy', () => {
  const dirs: string[] = [];
  afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

  /** A project whose 6 s take had a notification from 2 to 4 s, and whose screen showed an email address at 1 s. */
  async function project(): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-privacy-'));
    dirs.push(dir);
    const take = join(dir, 'takes', '1');
    mkdirSync(take, { recursive: true });
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=1920x1080:r=30:d=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(take, 'screen.mp4')]);
    writeFileSync(join(take, 'events.jsonl'), [toast(2, true), toast(4, false)].map((event) => `${JSON.stringify(event)}\n`).join(''));
    const line = { text: 'lena@example.com', rect: [100, 200, 160, 20], words: [{ text: 'lena@example.com', rect: [100, 200, 160, 20] }] };
    writeFileSync(join(take, 'screen-text.jsonl'), [{ t: 1, lines: [line] }, { t: 3, lines: [] }, { t: 4, lines: [] }].map((frame) => `${JSON.stringify(frame)}\n`).join(''));
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', events: 'takes/1/events.jsonl' }, scenes: [{ type: 'clip', from: 0, to: 6 }], masks: [{ id: 'm1', from: 0, to: 1, rect: [0, 0, 50, 50] }] }));
    return dir;
  }
  const masksOf = (dir: string) => (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { masks: { label?: string; auto?: string }[] }).masks;

  it('links the screen text with the masks in one write, keeps the person\'s masks, and adds the app\'s words', async () => {
    const dir = await project();
    const result = await applyPrivacy(dir, { link: 'takes/1/screen-text.jsonl', words: ['Lena Müller'] });
    expect(result).toMatchObject({ written: true, made: 1, notifications: 1, kinds: { email: 1 } });
    const file = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { sources: { screenText?: string }; privacy: { words: string[] } };
    expect(file.sources.screenText).toBe('takes/1/screen-text.jsonl');
    expect(file.privacy.words).toEqual(['Lena Müller']);
    expect(masksOf(dir).map((mask) => [mask.label ?? 'mine', mask.auto ?? 'mine'])).toEqual([
      ['mine', 'mine'],
      ['Email address', 'privacy'],
      ['Notification', 'notification'],
    ]);
    // the screen text as it is kept: the address marked (an older version wrote it as it was)
    const kept = readFileSync(join(dir, 'takes', '1', 'screen-text.jsonl'), 'utf8');
    expect(kept).not.toContain('lena@example.com');
    expect(kept).toMatch(/⟦email-[a-z]{8}⟧/);
    // again, with nothing new: nothing is written, the screen text neither
    expect((await applyPrivacy(dir)).written).toBe(false);
    expect(readFileSync(join(dir, 'takes', '1', 'screen-text.jsonl'), 'utf8')).toBe(kept);
  }, 20_000);

  it('masks the notifications without the screen\'s text, and leaves the privacy masks there as they are', async () => {
    const dir = await project();
    expect(await applyPrivacy(dir)).toMatchObject({ written: true, made: 0, notifications: 1 });
    expect(masksOf(dir).map((mask) => mask.auto ?? 'mine')).toEqual(['mine', 'notification']);
  });
});

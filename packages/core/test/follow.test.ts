import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Rect, ScreenTextFrame } from '@cuttle/project';
import { activeMasks } from '@cuttle/timeline';
import { ffmpegPath } from '../src/ffmpeg';
import { followTracks, locate, templateOf, type Picture } from '../src/privacy/follow';
import { privacyMasks, trackName, trackSecrets } from '../src/privacy/masks';
import { framesToRead } from '../src/privacy/read';
import { SCROLL_TAKE, scrolledAt, writeScrollTake } from './scrolling';

/** A dark picture. */
function picture(width: number, height: number): Picture {
  return { width, height, data: new Uint8Array(width * height).fill(30) };
}
/** `count` "glyphs" (8 × 12 px of random bright dots) from (x, y), the same for the same seed. */
function glyphs(target: Picture, x: number, y: number, count: number, seed: number): void {
  let state = seed;
  const next = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let g = 0; g < count; g++) {
    for (let j = 0; j < 12; j++) {
      for (let i = 0; i < 7; i++) {
        const px = x + g * 8 + i;
        const py = y + j;
        if (px >= 0 && px < target.width && py >= 0 && py < target.height && next() < 0.35) target.data[py * target.width + px] = 210;
      }
    }
  }
}
const fill = (target: Picture, y: number, rows: number, value: number) => target.data.fill(value, Math.max(0, y) * target.width, Math.min(target.height, y + rows) * target.width);

describe('locate', () => {
  // the thing: 20 glyphs at (100, 200), its picture with 4 px around it
  const before = picture(400, 600);
  glyphs(before, 100, 200, 20, 7);
  const template = templateOf(before, 96, 196, 168, 20);
  const from = { x: 96, y: 196 };

  it('finds the thing where it moved, of two places that match the one it was heading for', () => {
    const after = picture(400, 600);
    glyphs(after, 100, 260, 20, 7);
    expect(locate(after, template, from, { x: 0, y: 0 }, 150, 8)).toMatchObject({ at: { x: 96, y: 256 } });
    // the same text twice: 60 px down, where it was heading, and 60 px up
    glyphs(after, 100, 140, 20, 7);
    expect(locate(after, template, from, { x: 0, y: 55 }, 150, 8)).toMatchObject({ at: { x: 96, y: 256 } });
    expect(locate(after, template, from, { x: 0, y: -55 }, 150, 8)).toMatchObject({ at: { x: 96, y: 136 } });
  });

  it('follows what shows of it as it goes up under a header, no fewer rows than it moved, and is gone once nothing shows', () => {
    const under = picture(400, 600);
    glyphs(under, 100, 196, 20, 7);
    fill(under, 0, 204, 80); // a header down to 204: 4 px up, its top 12 rows are under it (12 showed before)
    const part = locate(under, template, from, { x: 0, y: -4 }, 150, 8, undefined, 12);
    expect(part).toMatchObject({ at: { x: 96, y: 192 } });
    const { edge, share } = part as { edge: { rows: number }; share: number };
    // the 8 rows below the header, give or take the rows at its edge
    expect(edge.rows).toBeGreaterThanOrEqual(8);
    expect(edge.rows).toBeLessThan(12);
    expect(share).toBeLessThan(0.75);
    // only its last 3 rows would show 4 px on, after all 20 showed: not it (a jump took it away)
    expect(locate(under, template, { x: 96, y: 210 }, { x: 0, y: -2 }, 150, 8, undefined, 20)).toEqual({ gone: true });
  });

  it('holds a thing that stands where something covers a side of it, and is gone where the page jumped it away', () => {
    const covered = picture(400, 600);
    glyphs(covered, 100, 200, 20, 7);
    for (let y = 190; y < 230; y++) covered.data.fill(120, y * 400 + 200, y * 400 + 290); // a popup over its right half
    expect(locate(covered, template, from, { x: 0, y: 0 }, 150, 8)).toBeUndefined();
    // other text where it stood, and nowhere in its column
    const other = picture(400, 600);
    glyphs(other, 100, 200, 20, 99);
    expect(locate(other, template, from, { x: 0, y: 0 }, 150, 8)).toEqual({ gone: true });
    // the page jumped it 400 px down: further than it is looked for, but in its column
    const jumped = picture(400, 600);
    glyphs(jumped, 100, 560, 20, 7);
    expect(locate(jumped, template, from, { x: 0, y: 2 }, 150, 8)).toMatchObject({ at: { x: 96, y: 556 } });
  });
});

describe('followTracks', () => {
  const dirs: string[] = [];
  afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

  it('keeps a secret that scrolls covered in every frame, as it comes in, goes away and back between two reads and goes out under the header', async () => {
    const { width, height, header, rate, seconds } = SCROLL_TAKE;
    // a page of lines of glyphs, every 24 px; the secret is line 40's, at (197, 991)
    const page = picture(width, 1968);
    for (let line = 0; line < 80; line++) if (line !== 40) glyphs(page, 48, 29 + line * 24, 10 + ((line * 7) % 50), line + 1);
    glyphs(page, 48, 991, 18, 500);
    glyphs(page, 197, 991, 44, 501);
    const secret: Rect = [197, 991, 352, 12];
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-follow-'));
    dirs.push(dir);
    const video = join(dir, 'screen.mp4');
    await writeScrollTake(video, page);
    // what the OCR would read where the picture changed: the secret wherever it is whole on screen
    const size = { width, height };
    const at = (t: number): Rect => [secret[0], secret[1] - scrolledAt(t), secret[2], secret[3]];
    const frames: ScreenTextFrame[] = (await framesToRead(video, [{ from: 0, to: seconds }], size)).map((t) => {
      const rect = at(t);
      const whole = rect[1] >= header && rect[1] + rect[3] <= height;
      return { t, lines: whole ? [{ text: 'export ghp_1234567890abcdefghijklmnop', rect: [48, rect[1], 501, 12], words: [{ text: 'export', rect: [48, rect[1], 141, 12] }, { text: 'ghp_1234567890abcdefghijklmnop', rect }] }] : [] };
    });
    const { tracks } = trackSecrets(frames, []);
    const followed = await followTracks(video, tracks, frames.map((frame) => frame.t), size, seconds);
    const named = new Map([...followed].map(([track, stretches]) => [trackName(track), stretches]));
    /** Per frame: whether what shows of the secret lies outside every mask, and whether a mask shows with none of it on screen. */
    const look = (masks: ReturnType<typeof privacyMasks>) => {
      let open = 0;
      let astray = 0;
      for (let n = 0; n < seconds * rate; n++) {
        const t = n / rate;
        const rect = at(t);
        const top = Math.max(header, rect[1]);
        const bottom = Math.min(height, rect[1] + rect[3]);
        const shown = activeMasks(masks.map((mask, k) => ({ ...mask, id: `m${k}`, style: 'fill' as const, enabled: true })), t).map((mask) => mask.rect);
        if (bottom <= top) {
          if (shown.length > 0) astray++;
          continue;
        }
        if (!shown.some((mask) => mask[0] <= rect[0] && mask[0] + mask[2] >= rect[0] + rect[2] && mask[1] <= top && mask[1] + mask[3] >= bottom)) open++;
      }
      return { open, astray };
    };
    // the masks of the reads alone leave it open as it comes in, between the two reads around its
    // way up and back, and as it goes out
    expect(look(privacyMasks(frames, [], size, seconds)).open).toBeGreaterThan(20);
    const masks = privacyMasks(frames, [], size, seconds, undefined, named);
    expect(look(masks)).toEqual({ open: 0, astray: expect.any(Number) });
    expect(look(masks).astray).toBeLessThanOrEqual(2);
  }, 60_000);

  it("masks a secret from its first frame to its last in a take with a frame only when the screen changes (macOS's)", async () => {
    const { width, height } = SCROLL_TAKE;
    const blank = picture(width, height);
    for (let line = 0; line < 20; line++) glyphs(blank, 48, 40 + line * 30, 30, line + 1);
    const shown = { ...blank, data: blank.data.slice() };
    glyphs(shown, 197, 300, 44, 501);
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-follow-'));
    dirs.push(dir);
    // the secret comes at 1.2121 s, the screen stays still, it goes at 2.0137 s: just after a 30th of
    // a second, which ffmpeg's nearest frame would show already; no frame at the start of the range
    const [comes, goes, seconds] = [1.2121, 2.0137, 3];
    // four frames at these microseconds, as macOS's capture helper writes a take
    const at = [0, comes, goes, seconds].map((t) => Math.round(t * 1e6));
    const pts = at.slice(0, -1).reduceRight((rest, t, k) => `if(eq(N\\,${k})\\,${t}\\,${rest})`, String(at.at(-1)));
    const video = join(dir, 'screen.mp4');
    const made = spawnSync(ffmpegPath(), ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${width}x${height}`, '-r', '30', '-i', '-', '-vf', `settb=1/1000000,setpts='${pts}',scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`, '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-enc_time_base', '1/1000000', '-video_track_timescale', '1000000', '-y', video], { input: Buffer.concat([blank.data, shown.data, blank.data, blank.data]), maxBuffer: 1 << 26, encoding: 'utf8' });
    expect(made.status, made.stderr).toBe(0);
    const secret: Rect = [197, 300, 352, 12];
    const line = { text: 'export ghp_1234567890abcdefghijklmnop', rect: [48, 300, 501, 12] as Rect, words: [{ text: 'export', rect: [48, 300, 141, 12] as Rect }, { text: 'ghp_1234567890abcdefghijklmnop', rect: secret }] };
    const frames: ScreenTextFrame[] = [{ t: 0, lines: [] }, { t: 1.25, lines: [line] }, { t: 1.75, lines: [line] }, { t: 2.05, lines: [] }];
    const { tracks } = trackSecrets(frames, []);
    const followed = await followTracks(video, tracks, frames.map((frame) => frame.t), { width, height }, seconds);
    const [stretch] = [...followed.values()].flat();
    // from no later than its first frame and to no earlier than its last, a frame either side at most
    expect(stretch!.from).toBeLessThanOrEqual(comes);
    expect(stretch!.from).toBeGreaterThan(comes - 1 / 30 - 0.001);
    expect(stretch!.to).toBeGreaterThanOrEqual(goes);
    expect(stretch!.to).toBeLessThan(goes + 1 / 30 + 0.001);
  }, 60_000);

  it('holds still text whose reads draw its box a little larger or smaller (Vision): one place, grown to hold them', async () => {
    const { width, height } = SCROLL_TAKE;
    const page = picture(width, height);
    glyphs(page, 197, 300, 44, 501);
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-follow-'));
    dirs.push(dir);
    const video = join(dir, 'screen.mp4');
    await writeScrollTake(video, page, () => 0, 3);
    const boxes: Rect[] = [
      [197, 300, 352, 12],
      [195, 296, 356, 20],
      [197, 300, 352, 12],
      [196, 298, 354, 16],
      [197, 301, 352, 11],
    ];
    const frames: ScreenTextFrame[] = boxes.map((rect, k) => ({ t: k * 0.5, lines: [{ text: 'ghp_1234567890abcdefghijklmnop', rect, words: [{ text: 'ghp_1234567890abcdefghijklmnop', rect }] }] }));
    const size = { width, height };
    const { tracks } = trackSecrets(frames, []);
    const followed = await followTracks(video, tracks, frames.map((frame) => frame.t), size, 3);
    const masks = privacyMasks(frames, [], size, 3, undefined, new Map([...followed].map(([track, stretches]) => [trackName(track), stretches])));
    expect(masks.map((mask) => [mask.rect, mask.moves])).toEqual([[[189, 290, 368, 32], undefined]]);
  }, 60_000);
});

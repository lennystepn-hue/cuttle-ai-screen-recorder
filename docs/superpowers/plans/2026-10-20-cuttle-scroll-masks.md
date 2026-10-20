# Cuttle: Masks That Stay on Text That Scrolls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A privacy mask stays on its secret in every frame while the page scrolls (as the secret comes in, moves, goes away and back, and goes out), also under a zoom, and leaves no mask behind on text that is not secret.

The user tested 0.1.2: "maskierung wenn man scrollt funktioniert nicht zuverlässig, diese geht dann einfach mit aber bleibt nicht da wo es maskieren soll". Measured on takes whose page scrolls a fake key through the frame, read with Windows' own OCR as the app reads a take:
- The screen's text is read where the picture changed, twice a second at most while it keeps changing. A mask only knew the places the reads found the key at: between two of them it covered both.
- So the key was open as it came in before its first read (the mask waited where the key would be read, 10 frames), while it went down and back up between two reads (11 frames), and as it went out after its last read: the mask stayed where the key was last read, over other text, while the key scrolled away (14 frames). That is the report.
- Between two reads during a fast scroll the mask was a band hundreds of pixels tall over clean text.
- The render maps a mask through the zoom as it maps the screen: the zoom was not the cause.

**Architecture:**
- `packages/core/src/privacy/follow.ts` follows each private thing the reads found (a track of `trackSecrets`) in every frame of the take, 30 a second. Where a read found it, its own picture is taken (grey, half the width, the whole height); in each frame after that it is found again near where it was heading, and back from each read to where it came in. It knows a thing that goes out of the picture or under a header (what still shows of it, then on as it went), a thing something covers at a side (a popup), and one the page took away at once (a jump, another page). `followTracks` gives the stretches each track was on screen, with its place in each frame.
- `privacyMasks` (`masks.ts`) makes a mask for each stretch, with a place in each frame its text moved (a place the two around it hold within the mask's room is left out). Without stretches for a track it makes the mask from the reads as before.
- `followScreenText` (`apply.ts`) runs the following for the screen's text of a take; `applyPrivacy` (the app's step) and `suggest` pass its result to `withPrivacyMasks`.
- `joinCovering` joins two rules' masks over the same text by what each shows at each place: it grew the longer one by the other's place also where the other was not shown.
- The editor's source view draws the rects of a following zoom or mask where it rests, and the way through all its places.

**Tech Stack:** TypeScript, ffmpeg (the take's frames), vitest, Windows' OCR and macOS's Vision (the end-to-end test), Electron (the app check).

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `scroll-masks`, in Git Bash.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions made while planning

- **Follow by the take's own pixels, not by reading more often, and not by the scroll events.** The OCR takes 0.2 to 0.66 s a frame: reading every frame would take ten to twenty times the take's length. Scroll events say neither how far a page moved (smooth scrolling, a terminal's lines) nor which part of the screen; keys (Page Down) move pages too. A thing's picture is found again in a frame in a few milliseconds.
- **The whole height, half the width.** Text that scrolls moves a row at a time. At half the height every other place reads half a row off: the key's picture then differed by 0.42 of its ink where it was and 0.70 elsewhere. At the whole height it differs by under 0.1 where it is, in moving frames of a take written as the recorder writes them, and by over 0.6 elsewhere. A thing is where it differs by at most 0.35.
- **Partly hidden things.** What still shows of a thing at its end away from where it moves is followed (under a header, out of the picture), down to a tenth of its ink, as long as it loses no more rows than it moved: after a page jump, the bottom rows of another line matched by chance. Then it goes on as it went until it has moved its own height. Strips of it side by side that show as they are (a quarter of its ink) mean something covers a side of it: a still one holds where it was.
- **Gone at once ends the mask; a changed one holds.** A thing that is nowhere in its column (the page jumped, another page came) ends its mask there; the read after it, half a second later at most, starts a new one, followed back to where the thing showed first. A still thing that only a part of shows holds its mask until the read after, as before.
- **After the read that no longer found it, as long as the following does.** A key that is mostly under the header is not read any more, but a strip of it still shows: the following goes on up to 2.5 s past that read while it finds the thing.
- **Between two places a mask still covers both.** A take's frames carry the wall clock's times: the frame the render shows at a moment can be the one before the frame the following measured. So a mask covers its place and the next for the length of a frame. In a flick of 130 px a frame it is that much taller for a frame.
- **A place in each frame the text moved, not more.** A place is left out where the two around it hold it and are together at most `pad` (6 px) larger: a still mask has one place, a slow drift one every few frames. A place where it stood is kept before the one it moved to, else the mask would cover both all along. A mask over a key that scrolls for 12 s had 87 places (3 KB).
- **The editor shows where it rests.** A following mask has a place in each frame: the source view draws the rects of its first and last place and where it stays a quarter second or more, and the way through all of them. The timeline's diamonds at its places read as a band where it moves; they stay.
- **What it costs.** The frames of each track's time are decoded once, from a second before its first read: 60 s of a 1440p take decode in 4 s. The 14 s takes here were followed in 1.6 to 2.6 s.
- **Not changed here.** Windows' OCR reads "lena.mueller@example.com" in Consolas as "I ena .mueller@example . com", which no rule takes for an email address: that is the reading, the same before and after.
- Checked on the prototype, frame by frame against where the key was (its pixels, from the page rendered with and without it):
  - The test's page with Windows' OCR: before, the key was open in 27 of 195 frames and a mask stood where none of it showed in 10; after, open in none, 1 such frame.
  - A 1920 × 1080 take (wheel notches, a steady scroll, a flick up, down and back between two reads, out under a header): open in 34 of 420 frames before, none after; the mask's area away from the key 18 400 → 3 056 px² a frame on average.
  - A take with page jumps (Page Down, Home), a key and a token, a slow drift and the same key twice: open in 14 frames before, none after; the masks' area away from the secrets 218 063 → 4 581 px².
  - Rendered with two zooms over the scrolling (`suggest`, then `render`, the same project with a take without the key to compare): with the old masks the key showed in 21 frames (22 016 px), with the new ones in none (52 px in all, the encoder's noise: 26 at most in a frame, where the key was off screen).
  - The app check's screenshots of the following zoom and mask.
  - `pnpm test` (1025 passed, 87 skipped) and `pnpm typecheck`.

---

### Task 1: Following a private thing from frame to frame, and a mask for each stretch it was on screen

**Files:**
- Create: `packages/core/src/privacy/follow.ts`, `packages/core/test/follow.test.ts`, `packages/core/test/scrolling.ts`
- Modify: `packages/core/src/privacy/masks.ts`
- Test: `packages/core/test/privacy-masks.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `scroll-masks`; work there:

```bash
git switch scroll-masks
```

- [ ] **Step 2: Write the failing tests**

A take whose page scrolls, written as the recorder writes one:

`packages/core/test/scrolling.ts`:

```ts
// A take whose page scrolls, for the tests of masks that follow it: a page taller than the screen,
// moved up by `scrolledAt(t)` under a header that stays, written as the recorder writes a take
// (30 fps, H.264 at its quality, a key frame every 2 s, BT.709).
import { spawn } from 'node:child_process';
import { ffmpegPath } from '../src/ffmpeg';

export const SCROLL_TAKE = { width: 1280, height: 720, header: 40, rate: 30, seconds: 6.5 };

const ease = (x: number) => 1 - (1 - x) ** 3;
const both = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
const part = (t: number, from: number, length: number) => Math.max(0, Math.min(1, (t - from) / length));

/**
 * How far the page is scrolled at `t` (px): six wheel notches down from 0.5 s (100 px each, eased
 * over 0.2 s, 0.25 s apart), still, down 250 px and back up 240 within half a second from 3.5 s,
 * still, a flick of 700 px from 5 s to 5.7 s, still. A line at 991 px on the page comes in at the
 * bottom with the third notch, goes up and back between two reads, and goes out under the header in
 * the flick, between two reads.
 */
export function scrolledAt(t: number): number {
  let y = 0;
  for (let k = 0; k < 6; k++) y += 100 * ease(part(t, 0.5 + 0.25 * k, 0.2));
  y += 250 * both(part(t, 3.5, 0.25)) - 240 * both(part(t, 3.75, 0.25));
  y += 700 * both(part(t, 5, 0.7));
  return Math.round(y);
}

/** Writes the take of `page` (grey, a byte a pixel, `SCROLL_TAKE.width` wide) to `file`. */
export async function writeScrollTake(file: string, page: { height: number; data: Uint8Array }): Promise<void> {
  const { width, height, header, rate, seconds } = SCROLL_TAKE;
  const ffmpeg = spawn(ffmpegPath(), ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${width}x${height}`, '-r', String(rate), '-i', '-', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-force_key_frames', 'expr:gte(t,n_forced*2)', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-y', file], { stdio: ['pipe', 'ignore', 'pipe'] });
  let errors = '';
  ffmpeg.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
  const done = new Promise<void>((resolve, reject) => ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${errors}`)))));
  for (let n = 0; n < seconds * rate; n++) {
    const top = scrolledAt(n / rate);
    const frame = Buffer.alloc(width * height, 0x33);
    for (let y = header; y < height && y + top < page.height; y++) frame.set(page.data.subarray((y + top) * width, (y + top + 1) * width), y * width);
    if (!ffmpeg.stdin.write(frame)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
  }
  ffmpeg.stdin.end();
  await done;
}
```

Finding a thing in a frame, and a secret that scrolls kept covered in every frame (the masks of the reads alone leave it open in more than 20 frames):

`packages/core/test/follow.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Rect, ScreenTextFrame } from '@cuttle/project';
import { activeMasks } from '@cuttle/timeline';
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
});
```

A mask for each stretch, its places, and two rules' masks joined:

In `packages/core/test/privacy-masks.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import type { ScreenTextFrame, ScreenTextLine } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';

/** A line of text at (x, y): each character 10 px wide and 20 px high, words one character apart. */
function line(text: string, x: number, y: number): ScreenTextLine {
```

with:

```ts
import { describe, expect, it } from 'vitest';
import type { ScreenTextFrame, ScreenTextLine } from '@cuttle/project';
import type { Stretch } from '../src/privacy/follow';
import { privacyMasks, trackName, trackSecrets } from '../src/privacy/masks';

/** A line of text at (x, y): each character 10 px wide and 20 px high, words one character apart. */
function line(text: string, x: number, y: number): ScreenTextLine {
```

In the same file, replace:

```ts
    ]);
  });

  it('makes one mask of a key in a NAME=value line, named for the key, and masks the person\'s words', () => {
    const frames = [frame(1, line('GITHUB_TOKEN=ghp_1234567890abcdefghijklmnop', 100, 400), line('Thanks, Lena Müller', 100, 500)), frame(1.5), frame(2)];
    const masks = privacyMasks(frames, ['Lena Müller'], screen);
```

with:

```ts
    ]);
  });

  it('makes a mask for each stretch a track was followed on screen, with a place where it moved and the last one before', () => {
    const key = (y: number) => line('ghp_1234567890abcdefghijklmnop', 100, y);
    const frames = [frame(1, key(300)), frame(1.5, key(300)), frame(2, key(200)), frame(2.5), frame(3), frame(6, key(500)), frame(6.5), frame(7)];
    const [track] = trackSecrets(frames, []).tracks;
    const at = (t: number, y: number) => ({ at: t, rect: [100, y, 300, 20] as [number, number, number, number] });
    // still from 1 s, up 50 px a frame from 1.9 s, out at the top at 2.2 s; in again at the bottom at 5.8 s
    const stretches: Stretch[] = [
      { from: 0.5, to: 2.2, places: [at(1, 300), at(1.5, 300), at(1.833, 300), at(1.867, 300), at(1.9, 250), at(1.933, 200), at(1.967, 200), at(2, 200), at(2.033, 150), at(2.067, 100), at(2.1, 50), at(2.133, 0)] },
      { from: 5.8, to: 7, places: [at(5.833, 1060), at(5.867, 1010), at(5.9, 500), at(6, 500)] },
    ];
    expect(privacyMasks(frames, [], screen, 10, undefined, new Map([[trackName(track!), stretches]]))).toEqual([
      {
        from: 0.5,
        to: 2.2,
        rect: [94, 294, 312, 32],
        // still until 1.867 s (its last place there kept), then a place in each frame it moved
        moves: [
          { at: 1.867, rect: [94, 294, 312, 32] },
          { at: 1.9, rect: [94, 244, 312, 32] },
          { at: 1.933, rect: [94, 194, 312, 32] },
          { at: 2, rect: [94, 194, 312, 32] },
          { at: 2.033, rect: [94, 144, 312, 32] },
          { at: 2.067, rect: [94, 94, 312, 32] },
          { at: 2.1, rect: [94, 44, 312, 32] },
          { at: 2.133, rect: [94, 0, 312, 26] },
        ],
        kind: 'key',
        label: 'Key',
      },
      { from: 5.8, to: 7, rect: [94, 1054, 312, 26], moves: [{ at: 5.867, rect: [94, 1004, 312, 32] }, { at: 5.9, rect: [94, 494, 312, 32] }], kind: 'key', label: 'Key' },
    ]);
  });

  it('leaves out a place the two around it hold within its room', () => {
    const frames = [frame(1, line('ghp_1234567890abcdefghijklmnop', 100, 300)), frame(2), frame(2.5)];
    const [track] = trackSecrets(frames, []).tracks;
    // a slow drift, 2 px a frame: a place every third frame (6 px)
    const places = Array.from({ length: 10 }, (_, k) => ({ at: Math.round((1 + k / 30) * 1000) / 1000, rect: [100, 300 - 2 * k, 300, 20] as [number, number, number, number] }));
    const [mask] = privacyMasks(frames, [], screen, 10, undefined, new Map([[trackName(track!), [{ from: 0.5, to: 2, places }]]]));
    expect(mask!.moves!.map((move) => [move.at, move.rect[1]])).toEqual([
      [1.1, 288],
      [1.2, 282],
      [1.3, 276],
    ]);
  });

  it('joins the masks of two rules over the same text where both show it, and grows neither where the other does not', () => {
    // a key from 1 s on, up 100 px at 2.9 s; its text read as a random-looking string only at 3 s
    const key = (y: number, text = 'ghp_1234567890abcdefghijklmnop') => line(`token ${text}`, 100, y);
    const frames = [frame(1, key(300)), frame(2, key(300)), frame(3, key(200, 'Zx9Kq2Lm7Np4Rt8Vw3Yb6Cd1Fg5Hj0')), frame(3.5), frame(4), frame(5)];
    const { tracks } = trackSecrets(frames, []);
    expect(tracks.map((track) => track.kind)).toEqual(['key', 'random']);
    const places = (t: number, y: number) => ({ at: t, rect: [160, y, 300, 20] as [number, number, number, number] });
    const followed = new Map<string, Stretch[]>([
      [trackName(tracks[0]!), [{ from: 0.5, to: 3.5, places: [places(1, 300), places(2.867, 300), places(2.9, 200)] }]],
      [trackName(tracks[1]!), [{ from: 2.9, to: 3.5, places: [places(2.9, 200)] }]],
    ]);
    expect(privacyMasks(frames, [], screen, Infinity, undefined, followed)).toEqual([
      { from: 0.5, to: 3.5, rect: [154, 294, 312, 32], moves: [{ at: 2.867, rect: [154, 294, 312, 32] }, { at: 2.9, rect: [154, 194, 312, 32] }], kind: 'key', label: 'Key' },
    ]);
  });

  it('makes one mask of a key in a NAME=value line, named for the key, and masks the person\'s words', () => {
    const frames = [frame(1, line('GITHUB_TOKEN=ghp_1234567890abcdefghijklmnop', 100, 400), line('Thanks, Lena Müller', 100, 500)), frame(1.5), frame(2)];
    const masks = privacyMasks(frames, ['Lena Müller'], screen);
```

Run: `pnpm exec vitest run --project node packages/core/test/follow.test.ts packages/core/test/privacy-masks.test.ts`
Expected: FAIL: `../src/privacy/follow` cannot be found, and `trackName is not a function` in the 3 new tests of the masks.

- [ ] **Step 3: The following**

`packages/core/src/privacy/follow.ts`:

```ts
// Following each private thing from frame to frame, around and between the reads that found it. The
// screen's text is read at most twice a second, and text that scrolls moves on further in between:
// it comes in before it is first read, goes out after it was last read, and can go away and back
// between two reads. So the frames are compared 30 a second: where a read found the thing, its own
// picture is taken, and it is found again in each frame after that (and before, back to where it
// came in) near where it was. Where it cannot be told (it changed where it stood, or something
// covers it), its mask holds the places the reads found, as before.
import type { Rect } from '@cuttle/project';
import { runFfmpeg } from '../ffmpeg';
import { MASK_RULES, type Track } from './masks';

export const FOLLOW_RULES = {
  /** Frames a second the things are followed in (a take's rate). */
  rate: 30,
  /**
   * The frames are compared at this share of the screen's width and at its whole height: text that
   * scrolls moves a row at a time, and at half the height every other place reads half a row off.
   */
  scale: 0.5,
  /** From one frame to the next a thing is looked for this share of the screen's height up and down (a fast flick moves 130 px a frame)… */
  reach: 0.25,
  /** …and, where it is not in its column, this share of its width aside (a window dragged slowly). */
  side: 0.02,
  /** Room around the text in its picture (screen px). */
  pad: 4,
  /**
   * It is where the frame differs from its picture at most this much: the summed difference, a share
   * of the picture's ink (how far its pixels are from their mean). Text where it is reads under 0.1
   * in a take's frames, other text and the page around it over 0.6.
   */
  match: 0.35,
  /** Of two places that match, the nearer the one it was heading for: this much score for a whole `reach` farther. */
  nearer: 0.1,
  /** It is looked for where at least this share of its ink is on screen… */
  inside: 0.5,
  /**
   * …and, as it goes out or under something that covers it (a page's header it scrolls under), what
   * still shows of it at either end, down to this share of its ink. Then it goes on as it went until
   * it has moved its own height, or none of it is on screen.
   */
  part: 0.1,
  /** Where its strips side by side that show as they are hold this share of its ink, something covers the rest (a popup, a floating button). */
  covered: 0.25,
  /** It is followed back at most this long before a read that found it, where it was not followed before (s). */
  back: 1,
  /** A read that finds it at most this far from where it was followed to (screen px) agrees with the following. */
  agree: 12,
  /**
   * Where the read after its last no longer finds it but the following still does (only a part of it
   * shows, or the read missed it), it is followed on this long at most (s), as long as it is found.
   */
  beyond: 2.5,
};

/** Where a thing was at `at` (screen px). */
export interface Place {
  at: number;
  rect: Rect;
}

/** A stretch a thing was on screen: from, to (source s), and its places in between, in time order. */
export interface Stretch {
  from: number;
  to: number;
  places: Place[];
}

/** A grey frame, compared size. */
export interface Picture {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A thing's own picture, taken from a frame where it was. */
export interface Template {
  width: number;
  height: number;
  data: Uint8Array;
  /** Its pixels' mean. */
  mean: number;
  /** Each row's ink: how far its pixels are from the picture's mean, summed (what there is to tell it by). */
  ink: Float64Array;
  /** All rows' ink. */
  total: number;
}

type Point = { x: number; y: number };

/** The template of `picture` at (x, y), `width` × `height` (compared px, on screen). */
export function templateOf(picture: Picture, x: number, y: number, width: number, height: number): Template {
  const data = new Uint8Array(width * height);
  let sum = 0;
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) sum += data[j * width + i] = picture.data[(y + j) * picture.width + x + i]!;
  const mean = sum / data.length;
  const ink = new Float64Array(height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) ink[j]! += Math.abs(data[j * width + i]! - mean);
  return { width, height, data, mean, ink, total: ink.reduce((a, b) => a + b, 0) };
}

/** The share of the template's ink on screen at top `y`. */
export function inkOn(picture: Picture, template: Template, y: number): number {
  let on = 0;
  for (let j = Math.max(0, -y); j < Math.min(template.height, picture.height - y); j++) on += template.ink[j]!;
  return template.total > 0 ? on / template.total : 0;
}

/** The rows of the template on screen at (x, y), and the columns. */
const onScreen = (picture: Picture, template: Template, x: number, y: number) => ({
  top: Math.max(0, -y),
  bottom: Math.min(template.height, picture.height - y),
  left: Math.max(0, -x),
  right: Math.min(template.width, picture.width - x),
});

/** The summed difference of rows `top`…`bottom` at (x, y); stops once over `most`. */
function rowsDiffer(picture: Picture, template: Template, x: number, y: number, top: number, bottom: number, left: number, right: number, most = Infinity): number {
  let sum = 0;
  for (let j = top; j < bottom; j++) {
    const row = (y + j) * picture.width + x;
    const own = j * template.width;
    for (let i = left; i < right; i++) sum += Math.abs(picture.data[row + i]! - template.data[own + i]!);
    if (sum > most) return Infinity;
  }
  return sum;
}

/**
 * How much the picture at (x, y) differs from the template: the summed difference over the part on
 * screen, a share of that part's ink; Infinity where less than `inside` of its ink is on screen, or
 * once it is worse than `limit`.
 */
export function differs(picture: Picture, template: Template, x: number, y: number, inside: number, limit = Infinity): number {
  const { top, bottom, left, right } = onScreen(picture, template, x, y);
  if (bottom <= top || 2 * (right - left) < template.width) return Infinity;
  let on = 0;
  for (let j = top; j < bottom; j++) on += template.ink[j]!;
  if (on <= 0 || on < inside * template.total) return Infinity;
  const sum = rowsDiffer(picture, template, x, y, top, bottom, left, right, limit * on);
  return sum === Infinity ? Infinity : sum / on;
}

/**
 * The most of the template that shows at (x, y) as it is from one end (`top`: its top rows), the
 * rest covered or off screen: how many rows and their share of the ink, at least `rows` rows and
 * `part` of the ink, the rows differing at most `match`; undefined where none does.
 */
export function showing(picture: Picture, template: Template, x: number, y: number, end: 'top' | 'bottom', match: number, part: number, rows = 1): { rows: number; share: number } | undefined {
  const screen = onScreen(picture, template, x, y);
  if (screen.bottom <= screen.top || 2 * (screen.right - screen.left) < template.width) return undefined;
  const diff: number[] = [];
  for (let j = 0; j < template.height; j++) diff.push(j >= screen.top && j < screen.bottom ? rowsDiffer(picture, template, x, y, j, j + 1, screen.left, screen.right) : Infinity);
  let best: { rows: number; share: number } | undefined;
  // rows from that end on, as long as they match
  const [start, direction] = end === 'top' ? [0, 1] : [template.height - 1, -1];
  let sum = 0;
  let ink = 0;
  for (let j = start, count = 1; j >= 0 && j < template.height; j += direction, count++) {
    if (diff[j] === Infinity) break;
    sum += diff[j]!;
    ink += template.ink[j]!;
    if (count >= rows && ink >= part * template.total && sum <= match * ink) best = { rows: count, share: ink / template.total };
  }
  return best;
}

/**
 * The share of the template's ink in its strips (`strips` side by side) that show as they are at
 * (x, y), each strip with ink differing at most `match`: what shows of it where something covers a
 * part of it at a side (a popup, a floating button).
 */
export function stripsShowing(picture: Picture, template: Template, x: number, y: number, match: number, strips = 8): number {
  const { top, bottom, left, right } = onScreen(picture, template, x, y);
  if (bottom <= top) return 0;
  let shown = 0;
  for (let k = 0; k < strips; k++) {
    const from = Math.max(left, Math.floor((k * template.width) / strips));
    const to = Math.min(right, Math.floor(((k + 1) * template.width) / strips));
    let ink = 0;
    let diff = 0;
    for (let j = top; j < bottom; j++) {
      const row = (y + j) * picture.width + x;
      const own = j * template.width;
      for (let i = from; i < to; i++) {
        ink += Math.abs(template.data[own + i]! - template.mean);
        diff += Math.abs(picture.data[row + i]! - template.data[own + i]!);
      }
    }
    if (ink >= 0.04 * template.total && diff <= match * ink) shown += ink;
  }
  return template.total > 0 ? shown / template.total : 0;
}

/**
 * Where the template is in `picture`, from `from` (its top-left in the frame before) heading on by
 * `step`, looked for `reach` rows up and down (and, where it moves, `side` columns aside): `at`,
 * with the share of its ink that shows there (`edge`: only its end away from where it
 * moves, the rest out or under something); `gone` where it is nowhere in its column (none of it is
 * on screen where it was heading, or the page jumped and took it away, or another took its place);
 * undefined where no more than a part of it shows where it stood (something covers the rest).
 */
export type Found = { at: Point; share: number; edge?: { rows: number } } | { gone: true } | undefined;

/** `shown`: how many of its rows showed in the frame before (a part at an edge shows fewer, as many fewer at most as it moved). */
export function locate(picture: Picture, template: Template, from: Point, step: Point, reach: number, side: number, rules = FOLLOW_RULES, shown = template.height): Found {
  const ahead = { x: Math.round(from.x + step.x), y: Math.round(from.y + step.y) };
  const found = (at: Point) => ({ at, share: inkOn(picture, template, at.y) });
  if (differs(picture, template, ahead.x, ahead.y, rules.inside) <= rules.match / 4) return found(ahead);
  let best: { at: Point; total: number } | undefined;
  const consider = (x: number, y: number) => {
    const penalty = (rules.nearer * Math.hypot(x - ahead.x, y - ahead.y)) / Math.max(1, reach);
    const score = differs(picture, template, x, y, rules.inside, Math.min(rules.match, (best?.total ?? Infinity) - penalty));
    if (score !== Infinity && (!best || score + penalty < best.total)) best = { at: { x, y }, total: score + penalty };
  };
  const moving = Math.abs(step.x) >= 1 || Math.abs(step.y) >= 1;
  for (let dy = -reach; dy <= reach; dy++) consider(ahead.x, from.y + dy);
  if (!best && moving) for (let dx = -side; dx <= side; dx++) for (let dy = -reach; dy <= reach; dy++) if (dx !== 0) consider(ahead.x + dx, from.y + dy);
  if (best) return found(best.at);
  // where it moves up or down, the part of it that still shows as it goes out or under something
  // (its end away from where it goes), near where it was heading: it loses no more rows than it moved
  if (Math.abs(step.y) >= 1) {
    let part: { at: Point; share: number; rows: number } | undefined;
    const near = Math.max(3, Math.round(Math.abs(step.y) / 4));
    const rows = Math.max(1, shown - Math.ceil(Math.abs(step.y)) - near);
    for (let dy = -near; dy <= near; dy++) {
      const one = showing(picture, template, ahead.x, ahead.y + dy, step.y < 0 ? 'bottom' : 'top', rules.match, rules.part, rows);
      if (one && (!part || one.share > part.share || (one.share === part.share && Math.abs(dy) < Math.abs(part.at.y - ahead.y)))) part = { at: { x: ahead.x, y: ahead.y + dy }, ...one };
    }
    if (part) return { at: part.at, share: part.share, edge: { rows: part.rows } };
  }
  if (moving && inkOn(picture, template, ahead.y) === 0) return { gone: true };
  // something covers a part of it at a side: the strips that show, near where it was heading
  const near = moving ? Math.max(3, Math.round(Math.hypot(step.x, step.y) / 4)) : 0;
  let covered: { at: Point; share: number } | undefined;
  for (let dy = -near; dy <= near; dy++) {
    const share = stripsShowing(picture, template, ahead.x, ahead.y + dy, rules.match);
    if (share >= rules.covered && (!covered || share > covered.share)) covered = { at: { x: ahead.x, y: ahead.y + dy }, share };
  }
  if (covered) return moving ? covered : undefined;
  // it moved on further than it was looked for (a page jumped): anywhere in its column
  for (let y = -template.height; y < picture.height; y++) consider(ahead.x, y);
  return best ? found((best as { at: Point }).at) : { gone: true };
}

/** A track's time: from half a second before its first read to the read after its last (masks.ts's rule). */
export function spanOf(track: Track, reads: readonly number[], end: number, rules = MASK_RULES): { from: number; to: number } {
  const first = track.sightings[0]!.t;
  const last = track.sightings.at(-1)!.t;
  const next = reads.find((t) => t > last) ?? (Number.isFinite(end) ? end : last);
  return { from: Math.max(0, first - rules.margin), to: Math.max(last + rules.margin, next) };
}

const union = (a: Rect, b: Rect): Rect => {
  const left = Math.min(a[0], b[0]);
  const top = Math.min(a[1], b[1]);
  return [left, top, Math.max(a[0] + a[2], b[0] + b[2]) - left, Math.max(a[1] + a[3], b[1] + b[3]) - top];
};
const round1 = (value: number) => Math.round(value * 10) / 10;
const time = (value: number) => Math.round(value * 1000) / 1000;

interface Geometry {
  width: number;
  height: number;
  sx: number;
  sy: number;
  reach: number;
  side: number;
}

/** A thing followed: its picture, where it is, how it moves. */
interface Follower {
  template: Template;
  /** Where the template was taken (compared px) and the rect it stands for there (screen px). */
  origin: Point & { rect: Rect };
  at: Point;
  step: Point;
  /** How many of its rows showed in the frame before. */
  shown: number;
  /** Following it on as it went (out, or under something): frames left. */
  coast?: number;
}

/** How a following ended: it went out or under something, it was gone at once, it could not be told, or it was not followed further. */
type Ended = 'out' | 'gone' | 'lost' | 'limit';

/**
 * Follows `follower` one frame on (or back): its place there, or how it ended. Moves it.
 */
function advance(follower: Follower, picture: Picture, geometry: Geometry, rules: typeof FOLLOW_RULES): Point | Ended {
  if (follower.coast !== undefined) {
    const at = { x: Math.round(follower.at.x + follower.step.x), y: Math.round(follower.at.y + follower.step.y) };
    // where it shows again as it is, it is followed from there
    const back = differs(picture, follower.template, at.x, at.y, rules.inside) <= rules.match ? at : undefined;
    if (back) {
      follower.coast = undefined;
      follower.shown = follower.template.height;
      follower.at = back;
      return back;
    }
    if (follower.coast <= 0 || inkOn(picture, follower.template, at.y) === 0) return 'out';
    follower.coast--;
    follower.at = at;
    return at;
  }
  const found = locate(picture, follower.template, follower.at, follower.step, geometry.reach, geometry.side, rules, follower.shown);
  if (!found) return 'lost';
  if ('gone' in found) return 'gone';
  follower.step = { x: found.at.x - follower.at.x, y: found.at.y - follower.at.y };
  follower.at = found.at;
  follower.shown = found.edge ? found.edge.rows : follower.template.height;
  // little of it shows: it goes on as it went, until it has moved its own height
  if (found.edge && found.share < rules.inside && (follower.step.x !== 0 || follower.step.y !== 0)) follower.coast = Math.ceil(follower.template.height / Math.max(1, Math.abs(follower.step.y)));
  return found.at;
}

interface State {
  track: Track;
  span: { from: number; to: number };
  /** Its reads by frame index in the range. */
  reads: Map<number, Rect>;
  follower?: Follower;
  mode: 'none' | 'on' | 'lost' | 'out';
  stretches: Stretch[];
  /** The time of its last place followed, and of the last read it was followed from or to. */
  last?: number;
  read?: number;
}

/**
 * Each track followed in the frames of `screen` (its reads: `track.sightings`), as the stretches it
 * was on screen, with a place in each frame where it was followed. `reads`: the times of all frames
 * read, `end`: the take's length. Where it could not be told, a stretch has the reads' places.
 */
export async function followTracks(screen: string, tracks: readonly Track[], reads: readonly number[], size: { width: number; height: number }, end: number, rules = FOLLOW_RULES): Promise<Map<Track, Stretch[]>> {
  const result = new Map<Track, Stretch[]>();
  if (tracks.length === 0) return result;
  const width = 2 * Math.round((size.width * rules.scale) / 2);
  const height = size.height;
  const geometry: Geometry = { width, height, sx: width / size.width, sy: 1, reach: Math.round(rules.reach * height), side: Math.round(rules.side * width) };
  const sorted = [...reads].sort((a, b) => a - b);
  // the stretches of time to compare: each track's, from `back` before its first read; those that overlap, one
  const wanted = tracks
    .map((track) => {
      const span = spanOf(track, sorted, end);
      return { track, span, from: Math.max(0, track.sightings[0]!.t - rules.back), to: Math.min(span.to + rules.beyond, Number.isFinite(end) ? end : Infinity) };
    })
    .sort((a, b) => a.from - b.from);
  const ranges: { from: number; to: number; states: State[] }[] = [];
  for (const item of wanted) {
    const state: State = { track: item.track, span: item.span, reads: new Map(), mode: 'none', stretches: [] };
    const range = ranges.at(-1);
    if (range && item.from <= range.to) {
      range.to = Math.max(range.to, item.to);
      range.states.push(state);
    } else ranges.push({ from: item.from, to: item.to, states: [state] });
  }
  for (const range of ranges) {
    for (const state of range.states) {
      for (const sighting of state.track.sightings) state.reads.set(Math.round((sighting.t - range.from) * rules.rate), sighting.rect);
    }
    await followRange(screen, range, geometry, rules);
    for (const state of range.states) result.set(state.track, state.stretches);
  }
  return result;
}

async function followRange(screen: string, range: { from: number; to: number; states: State[] }, geometry: Geometry, rules: typeof FOLLOW_RULES): Promise<void> {
  const { width, height, sx, sy } = geometry;
  const area = width * height;
  const frame = 1 / rules.rate;
  /** The frames before, newest last, for following back. */
  const kept: { t: number; picture: Picture }[] = [];
  const keep = Math.ceil(rules.back * rules.rate) + 1;
  const rectAt = (follower: Follower, at: Point): Rect => {
    const { origin } = follower;
    return [round1(origin.rect[0] + (at.x - origin.x) / sx), round1(origin.rect[1] + (at.y - origin.y) / sy), origin.rect[2], origin.rect[3]];
  };
  const stretchOf = (state: State) => state.stretches.at(-1)!;
  const place = (state: State, t: number) => {
    stretchOf(state).places.push({ at: time(t), rect: rectAt(state.follower!, state.follower!.at) });
    state.last = t;
  };
  const end = (state: State, to: number) => {
    stretchOf(state).to = time(to);
    state.mode = 'out';
  };
  /** A follower from what a read found at `rect` (screen px), in `picture`: its part on screen. */
  const followerOf = (picture: Picture, rect: Rect): Follower | undefined => {
    const x = Math.max(0, Math.floor((rect[0] - rules.pad) * sx));
    const y = Math.max(0, Math.floor((rect[1] - rules.pad) * sy));
    const w = Math.min(picture.width, Math.ceil((rect[0] + rect[2] + rules.pad) * sx)) - x;
    const h = Math.min(picture.height, Math.ceil((rect[1] + rect[3] + rules.pad) * sy)) - y;
    if (w <= 0 || h <= 0) return undefined;
    const template = templateOf(picture, x, y, w, h);
    if (template.total < 4 * w * h) return undefined; // next to nothing to tell it by
    return { template, origin: { x, y, rect }, at: { x, y }, step: { x: 0, y: 0 }, shown: h };
  };
  /** Follows a new follower back from the frame at `t` through the frames kept, down to `stop`: its places, and how it came. */
  const followBack = (follower: Follower, t: number, stop: number): { places: Place[]; came: Ended } => {
    const places: Place[] = [];
    const back: Follower = { ...follower, at: { ...follower.at }, step: { x: 0, y: 0 } };
    for (let k = kept.length - 1; k >= 0; k--) {
      const { t: when, picture } = kept[k]!;
      if (when > t - frame / 2) continue;
      if (when <= stop + frame / 2 || t - when > rules.back + frame / 2) return { places, came: 'limit' };
      const moved = advance(back, picture, geometry, rules);
      if (typeof moved === 'string') return { places, came: moved };
      places.unshift({ at: time(when), rect: rectAt(back, moved) });
    }
    return { places, came: 'limit' };
  };
  const onFrame = (k: number, picture: Picture) => {
    const t = range.from + k * frame;
    for (const state of range.states) {
      const read = state.reads.get(k);
      if (state.mode === 'none' && !read) continue;
      // after the read that no longer found it, only as long as the following does
      const after = t > state.span.to + frame / 2;
      if (after && (state.mode === 'lost' || t > state.span.to + rules.beyond + frame / 2)) {
        if (state.mode === 'on' || state.mode === 'lost') end(state, Math.max(state.span.to, (state.last ?? 0) + frame));
        continue;
      }
      const open = state.mode === 'on' || state.mode === 'lost';
      // on to this frame: where the following has it now, or how it ended
      let here: Rect | undefined;
      let ended: Ended | undefined;
      if (open && state.follower) {
        if (state.mode === 'lost') state.follower.step = { x: 0, y: 0 };
        const moved = advance(state.follower, picture, geometry, rules);
        if (typeof moved === 'string') ended = moved;
        else here = rectAt(state.follower, moved);
      }
      if (!read) {
        if (here) {
          state.mode = 'on';
          place(state, t);
        } else if (ended === 'out' || ended === 'gone') end(state, after ? Math.max(state.span.to, t) : t);
        else if (ended === 'lost' && after) end(state, Math.max(state.span.to, (state.last ?? 0) + frame));
        else if (ended === 'lost') state.mode = 'lost';
        continue;
      }
      // a read: where the following has it too, it goes on, its picture taken again there (the text
      // may have changed a little) unless only a part of it shows, the rect grown to hold the read's
      const agrees = here && Math.abs(here[0] - read[0]) <= rules.agree && Math.abs(here[1] - read[1]) <= rules.agree && Math.abs(here[1] + here[3] - read[1] - read[3]) <= rules.agree;
      if (agrees) {
        const follower = state.follower!;
        const fresh = follower.coast === undefined ? followerOf(picture, union(here!, read)) : undefined;
        if (fresh) state.follower = { ...fresh, step: follower.step };
        state.mode = 'on';
        state.read = t;
        place(state, t);
        continue;
      }
      // else it is followed again from the read: back to the read before where this stretch goes on
      // (what was followed since then is not trusted), else as far as it came from
      if (open && state.read !== undefined) {
        const since = state.read;
        const stretch = stretchOf(state);
        stretch.places = stretch.places.filter((one) => one.at <= time(since));
      }
      const fresh = followerOf(picture, read);
      const stop = open ? (state.read ?? -Infinity) : (state.last ?? -Infinity);
      const back = fresh ? followBack(fresh, t, stop) : { places: [], came: 'limit' as Ended };
      if (!open) {
        const first = back.places[0]?.at ?? t;
        // it came in (from off screen or from under something) or was there at once as the page
        // moved: from then; else from half a second before the read, as before
        const came = back.came === 'out' || back.came === 'gone';
        state.stretches.push({ from: time(Math.max(0, came ? first - frame : Math.min(first, t - MASK_RULES.margin))), to: state.span.to, places: [] });
      }
      stretchOf(state).places.push(...back.places);
      state.read = t;
      if (fresh) {
        state.follower = fresh;
        state.mode = 'on';
        place(state, t);
      } else {
        state.follower = undefined;
        state.mode = 'lost';
        stretchOf(state).places.push({ at: time(t), rect: read });
        state.last = t;
      }
    }
  };
  let pending: Buffer = Buffer.alloc(0);
  let index = 0;
  await runFfmpeg(['-ss', range.from.toFixed(3), '-t', (range.to - range.from + frame).toFixed(3), '-i', screen, '-map', '0:v:0', '-vf', `fps=${rules.rate},scale=${width}:${height}:flags=area,format=gray`, '-f', 'rawvideo', '-'], (chunk) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    while (pending.length >= area) {
      const picture: Picture = { width, height, data: new Uint8Array(pending.subarray(0, area)) };
      pending = pending.subarray(area);
      onFrame(index, picture);
      kept.push({ t: range.from + index * frame, picture });
      if (kept.length > keep) kept.shift();
      index++;
    }
  });
  for (const state of range.states) if (state.mode === 'on' || state.mode === 'lost') end(state, Math.max(state.span.to, state.mode === 'on' ? (state.last ?? 0) + frame : 0));
}
```

- [ ] **Step 4: A mask for each stretch, and the join**

In `packages/core/src/privacy/masks.ts`, replace:

```ts
// The privacy masks: each private thing the screen showed, masked from just before it was first seen
// to just after it was last seen, following it where it moved (text that scrolls). Pure.
import type { Rect, ScreenTextFrame, ZoomMove } from '@cuttle/project';
import { maskRectAt } from '@cuttle/timeline';
import { SECRET_LABELS, SPECIFIC, isMarkKey, secretWords, type Secret, type SecretKind } from './patterns';

export const MASK_RULES = {
```

with:

```ts
// The privacy masks: each private thing the screen showed, masked from just before it was first seen
// to just after it was last seen, following it where it moved (text that scrolls): from read to
// read, or in each frame where it was followed in the take (follow.ts). Pure.
import type { Rect, ScreenTextFrame, ZoomMove } from '@cuttle/project';
import { maskRectAt } from '@cuttle/timeline';
import type { Stretch } from './follow';
import { SECRET_LABELS, SPECIFIC, isMarkKey, secretWords, type Secret, type SecretKind } from './patterns';

export const MASK_RULES = {
```

In the same file, replace:

```ts
  missed: number;
}

/** A secret of a frame (by its index in the frames given) and line, and the track it is part of. */
export interface Found {
  frame: number;
```

with:

```ts
  missed: number;
}

/** A track's name, the same in each run of `trackSecrets` on the same frames: its kind, first key and first time. */
export const trackName = (track: Track) => `${track.kind}:${track.key}@${track.sightings[0]!.t}`;

/** A secret of a frame (by its index in the frames given) and line, and the track it is part of. */
export interface Found {
  frame: number;
```

In the same file, replace:

```ts
/**
 * The masks for what the frames read show of private things, and of the person's `words`, one for
 * each track (`trackSecrets`); a mask moved when its rect did. `end`: the take's length (source
 * seconds), where a mask ends that no later frame showed gone.
 */
export function privacyMasks(frames: readonly ScreenTextFrame[], words: readonly string[], screen: { width: number; height: number }, end = Infinity, rules = MASK_RULES): PrivacyMask[] {
  const { tracks } = trackSecrets(frames, words, rules);
  // Frames are read where the picture changes: a secret stays on screen until a frame read shows it
  // gone, so a mask lasts until then (to the take's end when none does).
```

with:

```ts
/**
 * The masks for what the frames read show of private things, and of the person's `words`, one for
 * each track (`trackSecrets`); a mask moved when its rect did. `end`: the take's length (source
 * seconds), where a mask ends that no later frame showed gone. `followed`: where each track was
 * followed in the take's frames, by its name (follow.ts): one mask for each stretch it was on
 * screen, with a place in each frame it moved in.
 */
export function privacyMasks(
  frames: readonly ScreenTextFrame[],
  words: readonly string[],
  screen: { width: number; height: number },
  end = Infinity,
  rules = MASK_RULES,
  followed?: ReadonlyMap<string, readonly Stretch[]>,
): PrivacyMask[] {
  const { tracks } = trackSecrets(frames, words, rules);
  // Frames are read where the picture changes: a secret stays on screen until a frame read shows it
  // gone, so a mask lasts until then (to the take's end when none does).
```

In the same file, replace:

```ts
    return [Math.round(left), Math.round(top), Math.round(Math.min(screen.width, rect[0] + rect[2] + rules.pad) - left), Math.round(Math.min(screen.height, rect[1] + rect[3] + rules.pad) - top)];
  };
  const moved = (a: Rect, b: Rect) => a.some((value, k) => Math.abs(value - b[k]!) > rules.moved);
  const masks = tracks
    .map((group): PrivacyMask => {
      const [first, ...rest] = group.sightings as [Sighting, ...Sighting[]];
      const from = round(Math.max(0, first.t - rules.margin));
      const moves: { at: number; rect: Rect }[] = [];
```

with:

```ts
    return [Math.round(left), Math.round(top), Math.round(Math.min(screen.width, rect[0] + rect[2] + rules.pad) - left), Math.round(Math.min(screen.height, rect[1] + rect[3] + rules.pad) - top)];
  };
  const moved = (a: Rect, b: Rect) => a.some((value, k) => Math.abs(value - b[k]!) > rules.moved);
  /**
   * A mask for each stretch a track was followed on screen, through its places: one is left out
   * where the two around it hold it and are together at most `pad` larger than either (between two
   * places a mask covers both), so a mask that stands has one place and one that moves a place in
   * each frame it moved more than that.
   */
  const fromStretches = (group: Track, stretches: readonly Stretch[]): PrivacyMask[] =>
    stretches.flatMap((stretch) => {
      const places = stretch.places.filter((place) => place.at < stretch.to).map((place) => ({ at: place.at, rect: pad(place.rect) }));
      if (places.length === 0 || !(stretch.to > stretch.from)) return [];
      const kept = [places[0]!];
      let held: Rect | undefined; // the places since the last kept one, together
      for (let k = 1; k < places.length; k++) {
        const last = kept.at(-1)!.rect;
        const next = places[k]!.rect;
        const both = union(last, next);
        const fits = both[2] <= Math.max(last[2], next[2]) + rules.pad && both[3] <= Math.max(last[3], next[3]) + rules.pad && (!held || union(both, held).every((value, i) => value === both[i]));
        if (!fits && k > 1 && places[k - 1] !== kept.at(-1)) {
          kept.push(places[k - 1]!);
          held = undefined;
          k--;
          continue;
        }
        held = held ? union(held, next) : next;
      }
      const end = places.at(-1)!;
      if (end !== kept.at(-1)) kept.push(end);
      // a place where it still stood is kept before one where it moved (else it covered both all along)
      const same = (one: Rect, other: Rect) => one.every((value, i) => value === other[i]);
      const moves = kept.filter((place, k) => k > 0 && place.at > stretch.from && !(same(place.rect, kept[k - 1]!.rect) && (k === kept.length - 1 || same(place.rect, kept[k + 1]!.rect))));
      return [{ from: round(stretch.from), to: round(stretch.to), rect: kept[0]!.rect, ...(moves.length > 0 && { moves }), kind: group.kind, label: SECRET_LABELS[group.kind] }];
    });
  const masks = tracks
    .flatMap((group): PrivacyMask[] => {
      const stretches = followed?.get(trackName(group));
      if (stretches && stretches.length > 0) return fromStretches(group, stretches);
      const [first, ...rest] = group.sightings as [Sighting, ...Sighting[]];
      const from = round(Math.max(0, first.t - rules.margin));
      const moves: { at: number; rect: Rect }[] = [];
```

In the same file, replace:

```ts
        previous = sighting;
      }
      const path: ZoomMove[] = moves.map((move) => ({ at: move.at, rect: pad(move.rect) }));
      return { from, to: round(until(previous.t)), rect: pad(base), ...(path.length > 0 && { moves: path }), kind: group.kind, label: SECRET_LABELS[group.kind] };
    })
    .sort((a, b) => a.from - b.from);
  return joinCovering(masks);
```

with:

```ts
        previous = sighting;
      }
      const path: ZoomMove[] = moves.map((move) => ({ at: move.at, rect: pad(move.rect) }));
      return [{ from, to: round(until(previous.t)), rect: pad(base), ...(path.length > 0 && { moves: path }), kind: group.kind, label: SECRET_LABELS[group.kind] }];
    })
    .sort((a, b) => a.from - b.from);
  return joinCovering(masks);
```

In the same file, replace:

```ts
 * overlap in time and, place by place (their rect, then each move at the same time), one covers
 * most of the other. Masks whose places differ in time (one rule found its text in fewer frames)
 * are one when, at each place of either while both are shown, one covers most of the other as
 * they are drawn (between two places a mask covers both): the one with more places stays, each of
 * them grown to hold the other there.
 */
function joinCovering(masks: PrivacyMask[]): PrivacyMask[] {
  const covered = (a: Rect, b: Rect) => {
```

with:

```ts
 * overlap in time and, place by place (their rect, then each move at the same time), one covers
 * most of the other. Masks whose places differ in time (one rule found its text in fewer frames)
 * are one when, at each place of either while both are shown, one covers most of the other as
 * they are drawn (between two places a mask covers both): it has the places of both, each holding
 * what either shows then (a mask that is not shown then adds nothing).
 */
function joinCovering(masks: PrivacyMask[]): PrivacyMask[] {
  const covered = (a: Rect, b: Rect) => {
```

In the same file, replace:

```ts
      other.rect = both(other.rect, mask.rect);
      if (other.moves) other.moves = other.moves.map((move, k) => ({ at: move.at, rect: both(move.rect, mask.moves![k]!.rect) }));
    } else {
      const [kept, rest] = placesOf(mask).length > placesOf(other).length ? [mask, { ...other }] : [{ ...other }, mask];
      const there = (t: number) => maskRectAt(rest, Math.min(Math.max(t, rest.from), rest.to));
      other.rect = both(kept.rect, there(kept.from));
      other.moves = kept.moves?.map((move) => ({ at: move.at, rect: move.at < rest.to ? both(move.rect, there(move.at)) : move.rect }));
      if (!other.moves) delete other.moves;
    }
    other.from = Math.min(other.from, mask.from);
    other.to = Math.max(other.to, mask.to);
```

with:

```ts
      other.rect = both(other.rect, mask.rect);
      if (other.moves) other.moves = other.moves.map((move, k) => ({ at: move.at, rect: both(move.rect, mask.moves![k]!.rect) }));
    } else {
      const two = [{ ...other }, mask];
      const placeAt = (one: PrivacyMask, t: number) => (one.moves ?? []).filter((move) => move.at <= t).at(-1)?.rect ?? one.rect;
      const shownAt = (t: number) => two.filter((one) => one.from <= t && t < one.to).map((one) => placeAt(one, t)).reduce(both);
      const from = Math.min(other.from, mask.from);
      const to = Math.max(other.to, mask.to);
      const places = [...new Set([...placesOf(other), ...placesOf(mask)])].filter((t) => t >= from && t < to).sort((a, b) => a - b).map((t) => ({ at: t, rect: shownAt(t) }));
      // a place like the one before is left out unless the next one differs (it ends a still stretch)
      const same = (a: Rect, b: Rect) => a.every((value, i) => value === b[i]);
      const moves = places.filter((place, k) => k > 0 && !(same(place.rect, places[k - 1]!.rect) && (k === places.length - 1 || same(place.rect, places[k + 1]!.rect))));
      other.rect = places[0]!.rect;
      if (moves.length > 0) other.moves = moves;
      else delete other.moves;
    }
    other.from = Math.min(other.from, mask.from);
    other.to = Math.max(other.to, mask.to);
```

Run: `pnpm exec vitest run --project node packages/core/test/follow.test.ts packages/core/test/privacy-masks.test.ts packages/core/test/redact.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/privacy/follow.ts packages/core/src/privacy/masks.ts packages/core/test/follow.test.ts packages/core/test/scrolling.ts packages/core/test/privacy-masks.test.ts
git commit -m "privacy: each private thing followed from frame to frame; a mask for each stretch it was on screen, a place in each frame it moved

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The masks of a take's text follow it, in the app's step and in suggest

**Files:**
- Create: `packages/core/test/fixtures/privacy/scroll.html`, `packages/core/test/fixtures/privacy/scroll.png`
- Modify: `packages/core/src/privacy/apply.ts`, `packages/core/src/suggest.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/privacy-ocr.test.ts`, `packages/core/test/privacy-apply.test.ts`

- [ ] **Step 1: The page that scrolls**

An editor's page of 80 lines, a planted fake key on its 41st:

`packages/core/test/fixtures/privacy/scroll.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>A page that scrolls a planted key (fake)</title>
<style>
  body { margin: 0; background: #1e1e1e; color: #d4d4d4; font: 15px/24px Consolas, Menlo, monospace; padding: 24px 48px; }
  pre { margin: 0; font: inherit; }
  .s { color: #ce9178; }
</style>
<pre>config frames options config layout screen return {
frames const value const;
    window result return render items import screen;
const result result layout layout layout result const;
  value export window function {
items render value export layout render;
  value render import return render config items export;
    import return layout {
    import items value options options import import {
window window value;
export layout export render const screen {
layout export import items window function;
frames export render render screen {
import items value window config frames window config screen;
    items function result screen layout await import;
options layout import {
render options screen screen;
layout function export result return layout function;
  config screen items frames return render options;
    render const screen items value layout window;
return import return window window render const value layout;
await render render export {
    return frames await;
    value options const;
items const frames;
function items config frames {
export window window items return result result;
import export options {
  layout config await options config config window frames {
    function screen items screen frames screen layout {
    return render const {
    layout const items;
function import value window window screen;
  config await render config return export const await;
  frames config render screen screen {
    return await items screen options const;
    result window value const import options result items {
const screen frames return;
    screen return import return options;
    import options frames frames options options {
ANTHROPIC_API_KEY=<span class="s">sk-ant-api03-Zx9Kq2Lm7Np4Rt8Vw3Yb6Cd1Fg5Hj0</span>
  export frames options import {
window const const function result window;
  config await items function await options export;
    config layout screen {
    import items export render;
  await frames options {
  items import await {
  layout options render;
return const const render;
screen await function return frames window;
    await import screen frames items window {
    options function window await function frames screen export;
  result value options screen render {
  await screen value function await export window {
  window export screen config value const import {
    frames export const value const;
result await await {
  frames screen result function {
  result result const const const value export {
    screen function options import function {
  render config value export function frames const value {
    result result value;
  await items await export layout screen export;
result render options function {
  config function const {
value items function await function;
    options items export screen return await window config {
options export window {
config function screen window options screen function render;
const value result {
    window window export value render {
    value export config;
function value value;
  await function value;
    value import result frames window;
  layout options window const import return;
  window window value config items render;
await window items window {
const window export function import items;</pre>
```

It is rendered 1280 px wide, the whole page, by `cuttle capture-page packages/core/test/fixtures/privacy/scroll.html --scroll --width 1280 --height 720 --name scroll` in a scratch project (1280 × 1968). Rendered once more with the key hidden, the pixels that differ lie in (197, 991), 354 × 13 px: the test's rect. The render is given as `PAGE`:

```bash
PAGE="${PAGE:?the page rendered by cuttle capture-page}"
cp "$PAGE" packages/core/test/fixtures/privacy/scroll.png
```

- [ ] **Step 2: Write the failing test**

The take of that page read with the system's OCR where its picture changed, as the app reads it; where the system has an OCR (Windows, macOS):

In `packages/core/test/privacy-ocr.test.ts`, replace:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '@cuttle/project';
import { captureHelper } from '@cuttle/recorder';
import { privacyMasks } from '../src/privacy/masks';
import { readFrames } from '../src/privacy/read';
import { redactFrames } from '../src/privacy/redact';
import { OCR_TIMEOUT, ScreenReader, answerWithin } from '../src/privacy/ocr';

describe('answerWithin', () => {
  it("ends a helper that does not answer in time, and passes an answer that comes", async () => {
```

with:

```ts
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
```

In the same file, replace:

```ts
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000 + OCR_TIMEOUT.prepare * 1000);
});
```

with:

```ts
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
```

Run: `pnpm exec vitest run --project node packages/core/test/privacy-ocr.test.ts`
Expected: FAIL: `followScreenText is not a function` (`apply.ts` does not have it yet); the other tests pass.

- [ ] **Step 3: Following the take's text, in the app's step and in suggest**

In `packages/core/src/privacy/apply.ts`, replace:

```ts
// The privacy masks applied to a project: made from the screen's text (screen-text.jsonl), the
// person's words and the notifications the recorder saw, merged with the masks there by the tag
// rules: Cuttle's privacy and notification masks are made again, one the person switched off stays
// off, every other mask stays. The app runs this as steps of its own after the cut.
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { newId, parseEventsJsonl, parseScreenTextJsonl, usedIds, type CuttleProject, type InputEvent, type Rect, type ScreenTextFrame } from '@cuttle/project';
```

with:

```ts
// The privacy masks applied to a project: made from the screen's text (screen-text.jsonl), followed
// from frame to frame in the take (follow.ts), the person's words and the notifications the recorder
// saw, merged with the masks there by the tag rules: Cuttle's privacy and notification masks are
// made again, one the person switched off stays off, every other mask stays. The app runs this as
// steps of its own after the cut.
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { newId, parseEventsJsonl, parseScreenTextJsonl, usedIds, type CuttleProject, type InputEvent, type Rect, type ScreenTextFrame } from '@cuttle/project';
```

In the same file, replace:

```ts
import { readProjectFile, writeProjectFile } from '../project-file';
import { probeScreen } from '../suggest/media';
import { union } from '../suggest/spans';
import { privacyMasks, type PrivacyMask } from './masks';
import { notificationMasks } from './notifications';
import type { SecretKind } from './patterns';
import { SCREEN_TEXT_FILE, framesToRead, keepRedacted, readFrames, writeScreenText } from './read';
```

with:

```ts
import { readProjectFile, writeProjectFile } from '../project-file';
import { probeScreen } from '../suggest/media';
import { union } from '../suggest/spans';
import { followTracks, type Stretch } from './follow';
import { privacyMasks, trackName, trackSecrets, type PrivacyMask } from './masks';
import { notificationMasks } from './notifications';
import type { SecretKind } from './patterns';
import { SCREEN_TEXT_FILE, framesToRead, keepRedacted, readFrames, writeScreenText } from './read';
```

In the same file, replace:

```ts
  screen: { width: number; height: number; duration?: number };
  /** The words to mask (default the project's `privacy.words`). */
  words?: readonly string[];
}

export interface PrivacyMasksResult {
```

with:

```ts
  screen: { width: number; height: number; duration?: number };
  /** The words to mask (default the project's `privacy.words`). */
  words?: readonly string[];
  /** Where each private thing in `frames` was followed in the take's frames (`followScreenText`); without, the masks hold the places the frames read. */
  followed?: ReadonlyMap<string, readonly Stretch[]>;
}

export interface PrivacyMasksResult {
```

In the same file, replace:

```ts
    reused.add(same.id);
    return same.id as string;
  };
  const made: PrivacyMask[] = input.frames ? privacyMasks(input.frames, input.words ?? project.privacy.words, screen, screen.duration) : [];
  const shown = input.events ? notificationMasks(input.events, screen, screen.duration) : [];
  const fresh: RawMask[] = [
    ...made.map((mask) => ({
```

with:

```ts
    reused.add(same.id);
    return same.id as string;
  };
  const made: PrivacyMask[] = input.frames ? privacyMasks(input.frames, input.words ?? project.privacy.words, screen, screen.duration, undefined, input.followed) : [];
  const shown = input.events ? notificationMasks(input.events, screen, screen.duration) : [];
  const fresh: RawMask[] = [
    ...made.map((mask) => ({
```

In the same file, replace:

```ts
  return { masks: [...kept, ...fresh].sort((a, b) => a.from - b.from), made: made.length, kinds, notifications: shown.length, notes };
}

/** The source stretches the project's clips show. */
const clipSpans = (project: CuttleProject) => union(project.scenes.flatMap((scene) => (scene.type === 'clip' ? [{ from: scene.from, to: scene.to }] : [])));
```

with:

```ts
  return { masks: [...kept, ...fresh].sort((a, b) => a.from - b.from), made: made.length, kinds, notifications: shown.length, notes };
}

/**
 * Each private thing the screen's text shows (with the person's `words`), followed from frame to
 * frame in the take's `screen` video (`followTracks`), by its track's name (`trackName`).
 */
export async function followScreenText(screen: string, frames: readonly ScreenTextFrame[], words: readonly string[], size: { width: number; height: number; duration?: number }): Promise<Map<string, Stretch[]>> {
  const { tracks } = trackSecrets(frames, words);
  const followed = await followTracks(screen, tracks, frames.map((frame) => frame.t), size, size.duration ?? Infinity);
  return new Map([...followed].map(([track, stretches]) => [trackName(track), stretches]));
}

/** The source stretches the project's clips show. */
const clipSpans = (project: CuttleProject) => union(project.scenes.flatMap((scene) => (scene.type === 'clip' ? [{ from: scene.from, to: scene.to }] : [])));
```

In the same file, replace:

```ts
  if (options.link && !read) throw new CoreError('missing-file', `${options.link} cannot be read`);
  const text = sources.events ? await readFile(resolve(file.dir, sources.events), 'utf8').catch(() => undefined) : undefined;
  const events = text === undefined ? undefined : parseEventsJsonl(text).events;
  const size = await probeScreen(resolve(file.dir, sources.screen));
  const words = [...new Set([...file.project.privacy.words, ...(options.words ?? []).map((word) => word.trim()).filter(Boolean)])];
  // the file as it is kept: what an older version, or a word added since, left readable is marked now
  const frames = read && linked ? keepRedacted(resolve(file.dir, linked), read, words) : undefined;
  const result = withPrivacyMasks(file.raw, file.project, { ...(frames && { frames }), ...(events && { events }), screen: size, words });
  const { masks: _masks, ...counts } = result;
  const linking = options.link !== undefined && options.link !== sources.screenText;
  const wordsAdded = words.length > file.project.privacy.words.length;
```

with:

```ts
  if (options.link && !read) throw new CoreError('missing-file', `${options.link} cannot be read`);
  const text = sources.events ? await readFile(resolve(file.dir, sources.events), 'utf8').catch(() => undefined) : undefined;
  const events = text === undefined ? undefined : parseEventsJsonl(text).events;
  const screen = resolve(file.dir, sources.screen);
  const size = await probeScreen(screen);
  const words = [...new Set([...file.project.privacy.words, ...(options.words ?? []).map((word) => word.trim()).filter(Boolean)])];
  // the file as it is kept: what an older version, or a word added since, left readable is marked now
  const frames = read && linked ? keepRedacted(resolve(file.dir, linked), read, words) : undefined;
  const followed = frames ? await followScreenText(screen, frames, words, size) : undefined;
  const result = withPrivacyMasks(file.raw, file.project, { ...(frames && { frames, followed }), ...(events && { events }), screen: size, words });
  const { masks: _masks, ...counts } = result;
  const linking = options.link !== undefined && options.link !== sources.screenText;
  const wordsAdded = words.length > file.project.privacy.words.length;
```

In `packages/core/src/suggest.ts`, replace:

```ts
import { readProjectFile, writeProjectFile } from './project-file';
import { areaStretches, bandCrop, cropPieces, type CropStretch } from './suggest/crop';
import { dialogZooms } from './suggest/dialogs';
import { readScreenText, withPrivacyMasks, type RawMask } from './privacy/apply';
import { SCREEN_TEXT_FILE, framesToRead, keepRedacted, readFrames, writeScreenText } from './privacy/read';
import { cachedAnalysis, grabGray, grayFrames, screenBands } from './suggest/media';
import { withLengthFit } from './suggest/length';
```

with:

```ts
import { readProjectFile, writeProjectFile } from './project-file';
import { areaStretches, bandCrop, cropPieces, type CropStretch } from './suggest/crop';
import { dialogZooms } from './suggest/dialogs';
import { followScreenText, readScreenText, withPrivacyMasks, type RawMask } from './privacy/apply';
import { SCREEN_TEXT_FILE, framesToRead, keepRedacted, readFrames, writeScreenText } from './privacy/read';
import { cachedAnalysis, grabGray, grayFrames, screenBands } from './suggest/media';
import { withLengthFit } from './suggest/length';
```

In the same file, replace:

```ts
  let privacy = { read: false, masks: 0, notifications: 0 };
  if (args.privacy !== false && file.project.autoEdits.privacy) {
    const text = await screenTextFor(file.dir, screen, sources.screenText, clips, screenInfo, words, args, notes);
    const result = withPrivacyMasks(file.raw, file.project, { ...(text && { frames: text.frames }), events, screen: screenInfo, words }, taken);
    notes.push(...result.notes);
    masks = result.masks;
    privacy = { read: text !== undefined, masks: result.made, notifications: result.notifications };
```

with:

```ts
  let privacy = { read: false, masks: 0, notifications: 0 };
  if (args.privacy !== false && file.project.autoEdits.privacy) {
    const text = await screenTextFor(file.dir, screen, sources.screenText, clips, screenInfo, words, args, notes);
    const followed = text ? await followScreenText(screen, text.frames, words, screenInfo) : undefined;
    const result = withPrivacyMasks(file.raw, file.project, { ...(text && { frames: text.frames, followed }), events, screen: screenInfo, words }, taken);
    notes.push(...result.notes);
    masks = result.masks;
    privacy = { read: text !== undefined, masks: result.made, notifications: result.notifications };
```

In `packages/core/src/index.ts`, replace:

```ts
export { MARK, RANDOM_RULES, SECRET_KINDS, SECRET_LABELS, SPECIFIC, findSecrets, isMark, lineSecrets, randomLooking, secretWords, type Secret, type SecretKind } from './privacy/patterns';
export { redactFrames } from './privacy/redact';
export { MASK_RULES, privacyMasks, type PrivacyMask } from './privacy/masks';
export { OCR_TIMEOUT, ScreenReader } from './privacy/ocr';
export { READ_RULES, SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
export { applyPrivacy, readScreenTake, readScreenText, withPrivacyMasks, type PrivacyInput, type PrivacyMasksResult, type PrivacyResult, type RawMask } from './privacy/apply';
export { NOTIFICATION_RULES, notificationMasks, type NotificationMask } from './privacy/notifications';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
export { BRAND_FILE, PROJECT_BRAND_DIR, applyBrand, brandFields, brandSlug, brandsDir, findBrand, listBrands, removeBrand, saveBrand, type Brand, type BrandFields } from './brands';
```

with:

```ts
export { MARK, RANDOM_RULES, SECRET_KINDS, SECRET_LABELS, SPECIFIC, findSecrets, isMark, lineSecrets, randomLooking, secretWords, type Secret, type SecretKind } from './privacy/patterns';
export { redactFrames } from './privacy/redact';
export { MASK_RULES, privacyMasks, type PrivacyMask } from './privacy/masks';
export { FOLLOW_RULES, followTracks, type Place, type Stretch } from './privacy/follow';
export { OCR_TIMEOUT, ScreenReader } from './privacy/ocr';
export { READ_RULES, SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
export { applyPrivacy, followScreenText, readScreenTake, readScreenText, withPrivacyMasks, type PrivacyInput, type PrivacyMasksResult, type PrivacyResult, type RawMask } from './privacy/apply';
export { NOTIFICATION_RULES, notificationMasks, type NotificationMask } from './privacy/notifications';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
export { BRAND_FILE, PROJECT_BRAND_DIR, applyBrand, brandFields, brandSlug, brandsDir, findBrand, listBrands, removeBrand, saveBrand, type Brand, type BrandFields } from './brands';
```

The privacy step now decodes the take's frames too (half a second here): its test gets the time:

In `packages/core/test/privacy-apply.test.ts`, replace:

```ts
    // again, with nothing new: nothing is written, the screen text neither
    expect((await applyPrivacy(dir)).written).toBe(false);
    expect(readFileSync(join(dir, 'takes', '1', 'screen-text.jsonl'), 'utf8')).toBe(kept);
  });

  it('masks the notifications without the screen\'s text, and leaves the privacy masks there as they are', async () => {
    const dir = await project();
```

with:

```ts
    // again, with nothing new: nothing is written, the screen text neither
    expect((await applyPrivacy(dir)).written).toBe(false);
    expect(readFileSync(join(dir, 'takes', '1', 'screen-text.jsonl'), 'utf8')).toBe(kept);
  }, 20_000);

  it('masks the notifications without the screen\'s text, and leaves the privacy masks there as they are', async () => {
    const dir = await project();
```

Run: `pnpm exec vitest run --project node packages/core/test/privacy-ocr.test.ts packages/core/test/privacy-apply.test.ts packages/core/test/suggest.test.ts`
Expected: PASS, 20 tests (on Windows the macOS helper's 4 are skipped).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/privacy/apply.ts packages/core/src/suggest.ts packages/core/src/index.ts packages/core/test/privacy-ocr.test.ts packages/core/test/privacy-apply.test.ts packages/core/test/fixtures/privacy/scroll.html packages/core/test/fixtures/privacy/scroll.png
git commit -m "privacy: the app's step and suggest follow the screen's private things in every frame of the take

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The editor shows where a following mask rests

**Files:**
- Modify: `apps/desktop/src/renderer/editor/SourceView.tsx`
- Test: `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The check**

The privacy mask in the check is one as suggest makes it now: a place in each frame its token moved up:

In `apps/desktop/test/app.check.test.ts`, replace:

```ts

  it('shows a privacy mask that follows text up the screen: its path in the source view, the Auto tab row, Hold still', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    // suggest's mask over a token that scrolled up between 0.5 and 2.5 s
    const outside = onDisk() as unknown as { masks: unknown[] };
    outside.masks.push({ id: 'm8', label: 'Key', from: 0.2, to: 2.8, rect: [300, 500, 500, 40], moves: [{ at: 1, rect: [300, 500, 500, 40] }, { at: 1.5, rect: [300, 400, 500, 40] }, { at: 2, rect: [300, 300, 500, 40] }], style: 'fill', auto: 'privacy' });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.waitForSelector('.item.mask[data-id=m8] .move-mark');
    await click(editor, '#tab-auto');
    await click(editor, '[data-testid=auto-group-privacy] .auto-toggle');
    await click(editor, '[data-testid=auto-group-privacy] .auto-item');
    await editor.waitForSelector('[data-testid=mask-path]');
    // between two places it covers both: one place is 500 × 40, at 1.25 s it is 500 × 140
    const shape = async () => {
      const box = (await editor.locator('.source-box.mask.selected').boundingBox())!;
      return box.width / box.height;
    };
    await seek(1.25);
    await expect.poll(shape).toBeLessThan(5);
    await click(editor, '#tab-selection');
    await editor.waitForSelector('[data-testid=mask-hold]');
    await shot('33-privacy-mask');
```

with:

```ts

  it('shows a privacy mask that follows text up the screen: its path in the source view, the Auto tab row, Hold still', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    // suggest's mask over a token that scrolled up 200 px from 1 s, followed frame by frame: still at
    // y 500 until 1 s, then 10 px up in each frame
    const outside = onDisk() as unknown as { masks: unknown[] };
    const up = Array.from({ length: 20 }, (_, k) => ({ at: Math.round((1 + (k + 1) / 30) * 1000) / 1000, rect: [300, 490 - 10 * k, 500, 40] }));
    outside.masks.push({ id: 'm8', label: 'Key', from: 0.2, to: 2.8, rect: [300, 500, 500, 40], moves: [{ at: 1, rect: [300, 500, 500, 40] }, ...up], style: 'fill', auto: 'privacy' });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.waitForSelector('.item.mask[data-id=m8] .move-mark');
    await click(editor, '#tab-auto');
    await click(editor, '[data-testid=auto-group-privacy] .auto-toggle');
    await click(editor, '[data-testid=auto-group-privacy] .auto-item');
    await editor.waitForSelector('[data-testid=mask-path]');
    // at the playhead it is where the text was then: at 1.25 s, 80 px up (between two frames' places it covers both)
    const top = async () => {
      const [box, view] = await Promise.all([editor.locator('.source-box.mask.selected').boundingBox(), editor.locator('[data-testid=source-view]').boundingBox()]);
      return ((box!.y - view!.y) / view!.height) * 720;
    };
    await seek(1.25);
    await expect.poll(top).toBeGreaterThan(390);
    expect(await top()).toBeLessThan(440);
    await shot('33a-privacy-mask-path');
    await click(editor, '#tab-selection');
    await editor.waitForSelector('[data-testid=mask-hold]');
    await shot('33-privacy-mask');
```

- [ ] **Step 2: The path in the source view**

In `apps/desktop/src/renderer/editor/SourceView.tsx`, replace:

```tsx
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      {(selected?.kind === 'zoom' || selected?.kind === 'crop') && <ZoomDim fit={fit} rect={selected.rect} size={size} />}
      {selected?.kind === 'zoom' && <ZoomPath fit={fit} zoom={project.zooms.find((zoom) => zoom.id === selected.id)} />}
      {selected?.kind === 'mask' && <ZoomPath fit={fit} zoom={project.masks.find((mask) => mask.id === selected.id)} kind="mask" />}
      {!selected && tool === 'crop' && boxes.some((box) => box.kind === 'crop') && <ZoomDim fit={fit} rect={boxes.find((box) => box.kind === 'crop')!.rect} size={size} />}
      {boxes.map((box) => {
        const at = toStage(box.rect, fit);
```

with:

```tsx
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      {(selected?.kind === 'zoom' || selected?.kind === 'crop') && <ZoomDim fit={fit} rect={selected.rect} size={size} />}
      {selected?.kind === 'zoom' && <ZoomPath fit={fit} zoom={project.zooms.find((zoom) => zoom.id === selected.id)} />}
      {selected?.kind === 'mask' && <ZoomPath fit={fit} mask={project.masks.find((mask) => mask.id === selected.id)} />}
      {!selected && tool === 'crop' && boxes.some((box) => box.kind === 'crop') && <ZoomDim fit={fit} rect={boxes.find((box) => box.kind === 'crop')!.rect} size={size} />}
      {boxes.map((box) => {
        const at = toStage(box.rect, fit);
```

In the same file, replace:

```tsx
  );
}

/** A selected zoom or mask that follows: the rects it moves through, dashed, and the way from one to the next. */
function ZoomPath({ fit, zoom, kind = 'zoom' }: { fit: Fit; zoom?: { rect: Rect; moves?: { rect: Rect }[] }; kind?: 'zoom' | 'mask' }) {
  if (!zoom?.moves?.length) return null;
  const rects = [zoom.rect, ...zoom.moves.map((move) => move.rect)].map((rect) => toStage(rect, fit));
  const middles = rects.map((rect) => `${rect.x + rect.width / 2},${rect.y + rect.height / 2}`);
  return (
    <svg className={`zoom-path${kind === 'mask' ? ' mask' : ''}`} data-testid={`${kind}-path`}>
      {rects.map((rect, i) => (
```

with:

```tsx
  );
}

/** A place where a zoom or mask that follows stays this long (seconds) is one it rests at. */
const REST = 0.25;

type Following = { rect: Rect; moves?: { at: number; rect: Rect }[] };

/**
 * A selected zoom or mask that follows: the way through its places, and dashed, the rects where it
 * rests (its first and last place, and where it stays `REST` or longer). A privacy mask has a place
 * in each frame its text moved: those are on the way only.
 */
function ZoomPath({ fit, zoom, mask }: { fit: Fit; zoom?: Following & { at: number; duration: number }; mask?: Following & { from: number; to: number } }) {
  const item = zoom ?? mask;
  if (!item?.moves?.length) return null;
  const kind = zoom ? 'zoom' : 'mask';
  const [from, to] = zoom ? [zoom.at, zoom.at + zoom.duration] : [mask!.from, mask!.to];
  const places = [{ at: from, rect: item.rect }, ...item.moves];
  const rects = places.filter((place, i) => i === 0 || i === places.length - 1 || (places[i + 1]?.at ?? to) - place.at >= REST).map((place) => toStage(place.rect, fit));
  const middles = places.map((place) => toStage(place.rect, fit)).map((rect) => `${rect.x + rect.width / 2},${rect.y + rect.height / 2}`);
  return (
    <svg className={`zoom-path${kind === 'mask' ? ' mask' : ''}`} data-testid={`${kind}-path`}>
      {rects.map((rect, i) => (
```

Run: `pnpm app:build:js && pnpm exec vitest run --mode app apps/desktop/test/app.check.test.ts -t "follows"`
Expected: PASS, 2 tests (the typing zoom's path and the privacy mask's).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/editor/SourceView.tsx apps/desktop/test/app.check.test.ts
git commit -m "editor: a following zoom or mask shows its rects where it rests, and the way through all its places

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The docs

**Files:**
- Modify: `README.md`, `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`

- [ ] **Step 1: README and the skill**

In `README.md`, replace:

```markdown
Cuttle works on your computer. Recording, cutting, the screen's text (Windows' own OCR or macOS's
Vision), transcription (Whisper models, downloaded once) and the export all run locally; nothing is
uploaded. The screen is compared ten times a second, and its text is read where it changed (twice
a second at most while it keeps changing), also where something showed only a moment. Masks over
private things are suggestions to check, not a guarantee: look at the stills before you share a
video (`cuttle preview --masks` shows each mask's edges).
```

with:

```markdown
Cuttle works on your computer. Recording, cutting, the screen's text (Windows' own OCR or macOS's
Vision), transcription (Whisper models, downloaded once) and the export all run locally; nothing is
uploaded. The screen is compared ten times a second, and its text is read where it changed (twice
a second at most while it keeps changing), also where something showed only a moment. What it
finds is then followed in every frame of the take, so a mask stays on text that scrolls: as it
comes in, between two reads and as it goes out. Masks over
private things are suggestions to check, not a guarantee: look at the stills before you share a
video (`cuttle preview --masks` shows each mask's edges).
```

In `skill/cuttle/SKILL.md`, replace:

```markdown
  was open (`auto: "notification"`). It also reads the screen's text (Windows' own OCR or macOS's
  Vision, on this computer) and masks what it finds: email addresses, keys and tokens, the value of a `…KEY=`,
  `…TOKEN=` or `password:` line, IBANs, card and phone numbers, and random-looking strings (a key
  without a known prefix; masks tagged `auto: "privacy"`, following text that scrolls). The text it
  keeps (`takes/<n>/screen-text.jsonl`) has each find replaced by a mark such as `⟦key-qwhzbtrk⟧`. Pass the user's name and address once with
  `--mask "<word>"` (kept in cuttle.json). This is a help, not a guarantee: the OCR misses small
  grey text and some lines, so **still look** yourself. Look for names, email addresses, tokens and
```

with:

```markdown
  was open (`auto: "notification"`). It also reads the screen's text (Windows' own OCR or macOS's
  Vision, on this computer) and masks what it finds: email addresses, keys and tokens, the value of a `…KEY=`,
  `…TOKEN=` or `password:` line, IBANs, card and phone numbers, and random-looking strings (a key
  without a known prefix; masks tagged `auto: "privacy"`, following text that scrolls frame by frame). The text it
  keeps (`takes/<n>/screen-text.jsonl`) has each find replaced by a mark such as `⟦key-qwhzbtrk⟧`. Pass the user's name and address once with
  `--mask "<word>"` (kept in cuttle.json). This is a help, not a guarantee: the OCR misses small
  grey text and some lines, so **still look** yourself. Look for names, email addresses, tokens and
```

In `skill/cuttle/project.md`, replace:

```markdown
around it, safest for tokens and keys; `blur`) and `enabled` (`true`). Make the rect generous: a
few pixels too small leaves letters readable. Masks cover clips only, not still scenes (a captured
page). A mask over text that scrolls has `moves` (`[{ "at", "rect" }]`, as a zoom's): its places
are `rect` at `from`, then each move's; between two places it covers both. `privacy.words` are
words masked wherever the screen shows them (`suggest --mask` adds to them).

`texts`: `at` and `duration` (source seconds), `text`, `style` (`pill`, `lower-third`, `caption`),
```

with:

```markdown
around it, safest for tokens and keys; `blur`) and `enabled` (`true`). Make the rect generous: a
few pixels too small leaves letters readable. Masks cover clips only, not still scenes (a captured
page). A mask over text that scrolls has `moves` (`[{ "at", "rect" }]`, as a zoom's): its places
are `rect` at `from`, then each move's; between two places it covers both. `suggest` follows the
text in every frame: a place in each frame it moved, and the mask ends where the text left the
picture. `privacy.words` are
words masked wherever the screen shows them (`suggest --mask` adds to them).

`texts`: `at` and `duration` (source seconds), `text`, `style` (`pill`, `lower-third`, `caption`),
```

- [ ] **Step 2: Commit**

```bash
git add README.md skill/cuttle/SKILL.md skill/cuttle/project.md
git commit -m "docs: masks follow the text that scrolls in every frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: All tests, the typecheck and the checks

- [ ] **Step 1: Run them**

Run: `pnpm test`
Expected: PASS, 1025 passed, 87 skipped.

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS.

Run: `pnpm app:check`
Expected: PASS, 58 tests.

## Changes during execution

- It was written from the finished prototype and replayed on a fresh clone for its commits; the tree came out byte-identical to the prototype.

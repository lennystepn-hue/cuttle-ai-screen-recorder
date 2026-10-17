import { describe, expect, it } from 'vitest';
import type { InputEvent, Marker } from '@cuttle/project';
import { parseAnalysis } from '../src/suggest/media';
import { suggestClips } from '../src/suggest/plan';
import { changedRegion, zoomRect } from '../src/suggest/region';
import { gaps, union } from '../src/suggest/spans';

describe('spans', () => {
  it('merges overlapping and touching spans', () => {
    expect(union([{ from: 5, to: 6 }, { from: 1, to: 3 }, { from: 2, to: 4 }, { from: 4, to: 4.5 }])).toEqual([
      { from: 1, to: 4.5 },
      { from: 5, to: 6 },
    ]);
  });

  it('finds the gaps inside a range', () => {
    expect(gaps([{ from: 2, to: 3 }, { from: 5, to: 12 }], 0, 10)).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 },
    ]);
    expect(gaps([], 1, 2)).toEqual([{ from: 1, to: 2 }]);
  });
});

const keys = (...times: number[]): InputEvent[] => times.map((t) => ({ t, type: 'keys', count: 1 }));

describe('suggestClips', () => {
  it('trims the quiet start and end', () => {
    // Typing from 4 to 6 s; the screen changes only while typing.
    const result = suggestClips({ duration: 20, events: keys(4, 5, 6), markers: [], still: [{ from: 0, to: 3.8 }, { from: 6.5, to: 20 }] });
    expect(result.clips).toEqual([{ from: 3.2, to: 7.5, speed: 1 }]);
    expect(result.notes).toEqual(['trimmed the quiet start (0.0–3.2 s)', 'trimmed the quiet end (7.5–20.0 s)']);
  });

  it('cuts an idle stretch, keeping half a second on both sides', () => {
    const result = suggestClips({ duration: 14, events: keys(1, 2, 10, 11), markers: [], still: [{ from: 0, to: 14 }] });
    // Active 0.7–2.3 and 9.7–11.3; the idle 2.3–9.7 is cut to 2.8–9.2.
    expect(result.clips).toEqual([
      { from: 0.2, to: 2.8, speed: 1 },
      { from: 9.2, to: 12.3, speed: 1 },
    ]);
    expect(result.notes).toContain('cut 6.4 s of idle screen (2.8–9.2 s)');
  });

  it("speeds up waiting without input and keeps Claude's answer at 1×", () => {
    // A prompt at 3 s, Claude works (the screen changes) until the answer at 40 s.
    const markers: Marker[] = [
      { t: 3, kind: 'prompt' },
      { t: 40, kind: 'answer' },
    ];
    const result = suggestClips({ duration: 50, events: keys(2, 2.5, 3), markers, still: [{ from: 0, to: 1.5 }, { from: 41, to: 50 }] });
    // Start: 2 s before the prompt. Waiting: no input from 3.3 s; the speed-up ends 1.5 s before the answer.
    expect(result.clips).toEqual([
      { from: 1, to: 4.3, speed: 1 },
      { from: 4.3, to: 38.5, speed: 8 },
      { from: 38.5, to: 42.5, speed: 1 },
    ]);
    expect(result.answer).toBe(40);
    expect(result.notes).toContain('sped up 34.2 s without input 8× (4.3–38.5 s)');
  });

  it("speeds up Claude's whole turn instead of cutting its quiet stretches", () => {
    // The treg take: no input, tool calls now and then, the spinner too small to count as a change.
    const markers: Marker[] = [
      { t: 5.6, kind: 'tool', label: 'Bash' },
      { t: 64.7, kind: 'tool', label: 'Bash' },
      { t: 137.4, kind: 'tool', label: 'Write' },
      { t: 152.6, kind: 'answer' },
    ];
    const still = [{ from: 0, to: 5 }, { from: 6.1, to: 64 }, { from: 65.2, to: 137 }, { from: 138.1, to: 152 }];
    const result = suggestClips({ duration: 153.3, events: [], markers, still });
    // 145.6 s without input from 5.5 to 151.1 s: about a twelfth of it, so 12×.
    expect(result.clips).toEqual([
      { from: 4.5, to: 5.5, speed: 1 },
      { from: 5.5, to: 151.1, speed: 12 },
      { from: 151.1, to: 153.3, speed: 1 },
    ]);
    expect(result.notes.some((note) => note.startsWith('cut'))).toBe(false);
  });

  it('also speeds up waiting after the answer, which stays at 1×', () => {
    // A prompt at 3 s, the answer at 20 s, and the screen keeps changing until 60 s without input.
    const markers: Marker[] = [
      { t: 3, kind: 'prompt' },
      { t: 20, kind: 'answer' },
    ];
    const result = suggestClips({ duration: 62, events: keys(2, 2.5, 3), markers, still: [{ from: 0, to: 1.5 }, { from: 60, to: 62 }] });
    // Waiting 3.3–61 s without input: sped up before the answer (to 18.5 s) and after it (from 22.5 s).
    expect(result.clips).toEqual([
      { from: 1, to: 4.3, speed: 1 },
      { from: 4.3, to: 18.5, speed: 4 },
      { from: 18.5, to: 22.5, speed: 1 },
      { from: 22.5, to: 60, speed: 12 },
      { from: 60, to: 61, speed: 1 },
    ]);
  });

  it('keeps the whole take when nothing happened', () => {
    expect(suggestClips({ duration: 5, events: [], markers: [], still: [{ from: 0, to: 5 }] }).clips).toEqual([{ from: 0, to: 5, speed: 1 }]);
  });
});

describe('parseAnalysis', () => {
  it("reads the size, the length and the still stretches from ffmpeg's log", () => {
    const log = [
      '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 2560x1440, 30 fps',
      '[Parsed_freezedetect_2 @ 0000] lavfi.freezedetect.freeze_start: 0',
      '[Parsed_freezedetect_2 @ 0000] lavfi.freezedetect.freeze_duration: 3',
      '[Parsed_freezedetect_2 @ 0000] lavfi.freezedetect.freeze_end: 3',
      '[Parsed_freezedetect_2 @ 0000] lavfi.freezedetect.freeze_start: 9.5',
      'frame=  360 fps=0.0 q=-0.0 Lsize=N/A time=00:00:12.00 bitrate=N/A speed=40x',
    ].join('\n');
    expect(parseAnalysis(log)).toEqual({ duration: 12, width: 2560, height: 1440, still: [{ from: 0, to: 3 }, { from: 9.5, to: 12 }] });
  });
});

describe('changedRegion and zoomRect', () => {
  const gray = (width: number, height: number, box?: { x: number; y: number; w: number; h: number }) => {
    const data = new Uint8Array(width * height).fill(40);
    if (box) for (let y = box.y; y < box.y + box.h; y++) data.fill(220, y * width + box.x, y * width + box.x + box.w);
    return { width, height, data };
  };

  it('boxes what changed and ignores a few stray pixels', () => {
    const before = gray(480, 270);
    const after = gray(480, 270, { x: 100, y: 150, w: 120, h: 60 });
    after.data[5] = 255; // a caret
    // 2 % of the changed pixels are trimmed on each side, so stray ones cannot stretch the box.
    expect(changedRegion(before, after)).toEqual({ x: 102, y: 151, width: 116, height: 58 });
    expect(changedRegion(before, gray(480, 270))).toBeUndefined();
  });

  it('pads the box, keeps a minimum width and refuses a box that covers most of the screen', () => {
    const screen = { width: 1920, height: 1080 };
    // 4× scale: the box is 400..880 × 600..840 on the screen, padded by 115.2 px (already wider than 672 px).
    expect(zoomRect({ x: 100, y: 150, width: 120, height: 60 }, 480, screen)).toEqual([285, 485, 710, 470]);
    // A narrow box grows to 35 % of the screen's width around its centre.
    expect(zoomRect({ x: 200, y: 100, width: 10, height: 10 }, 480, screen)).toEqual([484, 285, 672, 270]);
    expect(zoomRect({ x: 0, y: 0, width: 470, height: 260 }, 480, screen)).toBeUndefined();
    // Tall and narrow: 830×1080 is 43 % of the screen, but the timeline widens it to 16:9, the whole screen.
    expect(zoomRect({ x: 200, y: 0, width: 150, height: 270 }, 480, screen)).toBeUndefined();
  });
});

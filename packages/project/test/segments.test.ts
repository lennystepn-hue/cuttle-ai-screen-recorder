import { describe, expect, it } from 'vitest';
import { parseSegmentsJson, segmentOffsets, takeTime, type Segment } from '../src/segments';

const segments: Segment[] = [
  { screen: { file: 'screen.1.mp4', start: 100 }, mic: { file: 'mic.1.m4a', start: 100.05 }, duration: 4 },
  // paused from 104 to 110
  { screen: { file: 'screen.2.mp4', start: 110 }, mic: { file: 'mic.2.m4a', start: 109.98 }, duration: 3 },
  // paused from 113 to 120; the third still records
  { screen: { file: 'screen.3.mp4', start: 120 } },
];

describe('takeTime', () => {
  it('counts only the time segments record, and nothing before, between or after them', () => {
    expect(takeTime(segments, 99)).toBeUndefined();
    expect(takeTime(segments, 100)).toBe(0);
    expect(takeTime(segments, 103.5)).toBe(3.5);
    expect(takeTime(segments, 104)).toBe(4);
    expect(takeTime(segments, 107)).toBeUndefined(); // paused
    expect(takeTime(segments, 110)).toBe(4);
    expect(takeTime(segments, 112.25)).toBe(6.25);
    expect(takeTime(segments, 116)).toBeUndefined(); // paused
    // the last segment has no length yet: it runs on
    expect(takeTime(segments, 130)).toBe(17);
    expect(takeTime(segments.slice(0, 2), 114)).toBeUndefined(); // after the end
  });

  it('puts a moment of a pause where the take paused, when asked to (a marker set while paused)', () => {
    expect(takeTime(segments, 107, true)).toBe(4);
    expect(takeTime(segments, 116, true)).toBe(7);
    expect(takeTime(segments.slice(0, 2), 114, true)).toBe(7);
    expect(takeTime(segments, 99, true)).toBeUndefined(); // before the take: nothing to put it on
  });

  it('places each segment after the ones before it', () => {
    expect(segmentOffsets(segments)).toEqual([0, 4, 7]);
  });

  it('reads segments.json, and says what is wrong with a broken one', () => {
    const text = JSON.stringify({ version: 1, segments, joined: false });
    expect(parseSegmentsJson(`\uFEFF${text}`)).toEqual({ ok: true, segments: { version: 1, segments, joined: false } });
    const broken = parseSegmentsJson(JSON.stringify({ version: 1, segments: [] }));
    expect(broken.ok).toBe(false);
    expect(parseSegmentsJson('{').ok).toBe(false);
  });
});

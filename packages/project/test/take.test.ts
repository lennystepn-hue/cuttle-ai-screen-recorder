import { describe, expect, it } from 'vitest';
import { parseTakeJson, trackOffset } from '../src/index';

const take = {
  version: 1,
  tracks: {
    screen: { file: 'screen.mp4', start: 100.25 },
    webcam: { file: 'webcam.mp4', start: 100.75 },
    mic: { file: 'mic.m4a', start: 100.05 },
  },
};

describe('parseTakeJson', () => {
  it('reads the per-track start times', () => {
    const result = parseTakeJson(JSON.stringify(take));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trackOffset(result.take, 'webcam')).toBeCloseTo(0.5);
    expect(trackOffset(result.take, 'mic')).toBeCloseTo(-0.2);
  });

  it('reads the display\'s scale when the take says one, and only a sensible one', () => {
    const scaled = parseTakeJson(JSON.stringify({ ...take, scale: 2 }));
    expect(scaled.ok && scaled.take.scale).toBe(2);
    expect(parseTakeJson(JSON.stringify(take)).ok && (parseTakeJson(JSON.stringify(take)) as { take: { scale?: number } }).take.scale).toBeUndefined();
    expect(parseTakeJson(JSON.stringify({ ...take, scale: 0 })).ok).toBe(false);
  });

  it('has no offset for a track it does not list', () => {
    const result = parseTakeJson(JSON.stringify({ version: 1, tracks: { screen: take.tracks.screen } }));
    expect(result.ok && trackOffset(result.take, 'mic')).toBeUndefined();
  });

  it('names the path of an invalid field', () => {
    const result = parseTakeJson(JSON.stringify({ ...take, tracks: { ...take.tracks, mic: { file: 'mic.m4a' } } }));
    expect(result).toEqual({ ok: false, issues: [{ path: 'tracks.mic.start', message: expect.any(String) }] });
  });

  it('reports invalid JSON', () => {
    const result = parseTakeJson('{');
    expect(result.ok).toBe(false);
  });

  it('accepts a byte order mark, as Windows editors write one', () => {
    expect(parseTakeJson(String.fromCharCode(0xfeff) + JSON.stringify(take)).ok).toBe(true);
  });
});

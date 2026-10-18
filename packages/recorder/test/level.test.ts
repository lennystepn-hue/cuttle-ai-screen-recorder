import { describe, expect, it } from 'vitest';
import { levelMeter, PCM_RATE, type MicLevel } from '../src/level';

/** `seconds` of a sine at `amplitude` (of full scale) as 16-bit little-endian samples. */
function sine(seconds: number, amplitude: number): Uint8Array {
  const count = Math.round(seconds * PCM_RATE);
  const bytes = new Uint8Array(count * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i++) view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / PCM_RATE) * amplitude * 32767), true);
  return bytes;
}

describe('levelMeter', () => {
  it('tells the RMS and the peak in dBFS for every tenth of a second', () => {
    const levels: MicLevel[] = [];
    const meter = levelMeter((level) => levels.push(level));
    // a sine at 1/8 of full scale: its RMS is 1/8 ÷ √2, about −21 dBFS; its peak −18 dBFS
    meter(sine(0.35, 1 / 8));
    expect(levels).toHaveLength(3);
    for (const level of levels) {
      expect(level.rms).toBeCloseTo(-21.1, 0);
      expect(level.peak).toBeCloseTo(-18.1, 0);
    }
  });

  it('takes chunks that end inside a sample, and tells digital silence as −90 dBFS', () => {
    const levels: MicLevel[] = [];
    const meter = levelMeter((level) => levels.push(level));
    const loud = sine(0.1, 1);
    // three bytes at a time: every other chunk ends inside a sample
    for (let i = 0; i < loud.length; i += 3) meter(loud.subarray(i, i + 3));
    meter(new Uint8Array(PCM_RATE * 0.1 * 2));
    expect(levels).toEqual([
      { rms: expect.closeTo(-3, 0), peak: expect.closeTo(0, 0) },
      { rms: -90, peak: -90 },
    ]);
  });
});

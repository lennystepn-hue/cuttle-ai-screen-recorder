import { describe, expect, it } from 'vitest';
import { maskRectAt, masksAt, ringColor, type Rect } from '../kit/take.js';

describe('the masks over a frame of the take', () => {
  const still = { from: 1, to: 3, rect: [100, 50, 200, 40] as Rect, style: 'fill' };
  const follows = { from: 0, to: 4, rect: [0, 400, 100, 20] as Rect, style: 'blur', moves: [{ at: 2, rect: [0, 300, 100, 20] as Rect }] };

  it('is on from its start until its end, where it is then', () => {
    expect(maskRectAt(still, 0.99)).toBeNull();
    expect(maskRectAt(still, 1)).toEqual([100, 50, 200, 40]);
    expect(maskRectAt(still, 3)).toBeNull();
  });

  it('covers both places of a mask that follows, until its move, then the new place', () => {
    expect(maskRectAt(follows, 1)).toEqual([0, 300, 100, 120]);
    expect(maskRectAt(follows, 2.5)).toEqual([0, 300, 100, 20]);
  });

  it('scales to the frame, grows to whole pixels and stays inside it', () => {
    expect(masksAt([still, follows], 1.5, 0.5, 640, 180)).toEqual([
      { style: 'fill', rect: [50, 25, 100, 20] },
      { style: 'blur', rect: [0, 150, 50, 30] },
    ]);
    expect(masksAt([{ ...still, rect: [-10.4, 1.2, 50, 5] as Rect }], 2, 1, 30, 4)).toEqual([{ style: 'fill', rect: [0, 1, 30, 3] }]);
    expect(masksAt([{ ...still, rect: [700, 0, 50, 5] as Rect }], 2, 1, 640, 360)).toEqual([]);
    // an unknown style is filled: hidden either way
    expect(masksAt([{ ...still, style: 'pixelate' }], 2, 1, 640, 360)[0]!.style).toBe('fill');
  });

  it('fills with the mean colour around it, or its own without room around it', () => {
    // a 4×3 region: the mask is the middle 2×1, the ring around it red and blue
    const data = new Uint8ClampedArray(4 * 3 * 4);
    for (let i = 0; i < 12; i++) data.set(i % 2 ? [0, 0, 255, 255] : [255, 0, 0, 255], i * 4);
    data.set([0, 255, 0, 255], (1 * 4 + 1) * 4);
    data.set([0, 255, 0, 255], (1 * 4 + 2) * 4);
    expect(ringColor(data, 4, [1, 1, 2, 1])).toEqual([128, 0, 128]);
    expect(ringColor(data, 4, [0, 0, 4, 3])).toEqual([106, 43, 106]);
  });
});

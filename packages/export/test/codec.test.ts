import { describe, expect, it } from 'vitest';
import { avcCodecString, videoBitrate } from '../src/codec';

describe('videoBitrate', () => {
  it('is about 10 Mbit/s at 1080p30 and scales with pixels and frame rate', () => {
    expect(videoBitrate(1920, 1080, 30)).toBe(9_953_280);
    expect(videoBitrate(1080, 1920, 30)).toBe(videoBitrate(1920, 1080, 30));
    expect(videoBitrate(1920, 1080, 60)).toBe(2 * videoBitrate(1920, 1080, 30));
  });
});

describe('avcCodecString', () => {
  const at = (w: number, h: number, fps: number) => avcCodecString(w, h, fps, videoBitrate(w, h, fps));

  it('uses High profile at level 4 for the 16:9 and 9:16 presets at 30 fps', () => {
    expect(at(1920, 1080, 30)).toBe('avc1.640028');
    expect(at(1080, 1920, 30)).toBe('avc1.640028');
  });

  it('picks the smallest level for the frame size, frame rate and bitrate', () => {
    expect(at(1080, 1080, 30)).toBe('avc1.640020'); // 3.2
    expect(at(1920, 1080, 60)).toBe('avc1.64002a'); // 4.2
    expect(at(3840, 2160, 30)).toBe('avc1.640033'); // 5.1
    expect(at(4096, 4096, 30)).toBe('avc1.64003c'); // 6
    expect(avcCodecString(1920, 1080, 30, 30_000_000)).toBe('avc1.640029'); // 4.1 for the bitrate
  });

  it('covers everything the project schema allows and refuses larger outputs', () => {
    expect(at(4096, 4096, 120)).toBe('avc1.64003d'); // 6.1
    expect(() => avcCodecString(8192, 8192, 30, 10_000_000)).toThrow(/level 6.2/);
  });
});

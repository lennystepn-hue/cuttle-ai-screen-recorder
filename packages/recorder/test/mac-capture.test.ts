import { describe, expect, it } from 'vitest';
import { helperArgs, helperInput } from '../src/mac-capture';
import { screenLatency } from '../src/sources';

const monitor = { index: 0, name: 'Built-in Display', bounds: { x: 0, y: 0, width: 2880, height: 1800 }, scale: 2, primary: true, displayId: 1 };

describe('the macOS capture helper', () => {
  it('captures the display by its id, cropped in its pixels, leaving out the given processes', () => {
    expect(helperArgs({ monitor }, false, [])).toEqual(['--display', '1', '--fps', '30']);
    expect(helperArgs({ monitor, crop: { x: 200, y: 240, width: 1400, height: 440 } }, true, [4242, 77])).toEqual([
      '--display', '1', '--fps', '30', '--crop', '200,240,1400,440', '--cursor', '--exclude-pid', '4242', '--exclude-pid', '77',
    ]);
  });

  it('feeds ffmpeg raw BGRA of the area on descriptor 3, not as a pipe (which would turn off its "q")', () => {
    expect(helperInput({ monitor })).toEqual(['-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', '2880x1800', '-framerate', '1000000', '-i', '/dev/fd/3']);
    expect(helperInput({ monitor, crop: { x: 2, y: 4, width: 640, height: 360 } })).toContain('640x360');
  });

  it('moves the screen start back by the measured capture latency on macOS only', () => {
    expect(screenLatency('macos', true)).toBe(0.037);
    expect(screenLatency('macos', false)).toBe(0.08);
    expect(screenLatency('windows', false)).toBe(0);
    expect(screenLatency('test', false)).toBe(0);
  });

  it('takes a window by itself, at its size', () => {
    expect(helperArgs({ monitor, crop: { x: 200, y: 240, width: 1400, height: 440 }, window: 7610 }, false, [4242])).toEqual([
      '--display', '1', '--window', '7610', '--size', '1400,440', '--fps', '30',
    ]);
  });
});

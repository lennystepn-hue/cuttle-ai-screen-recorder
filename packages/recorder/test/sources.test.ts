import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_DEVICES, areaGeometry, checkDevice, micInput, micLatency, pickCameraMode, platformFor, resolveArea, screenFilter, screenInput, webcamInput } from '../src/sources';
import type { Devices } from '../src/types';

const devices: Devices = {
  monitors: [
    { index: 0, name: 'DISPLAY1', bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scale: 1.25, primary: true },
    { index: 1, name: 'DISPLAY2', bounds: { x: 2560, y: 509, width: 1920, height: 1080 }, scale: 1, primary: false },
    { index: 2, name: 'DISPLAY3', bounds: { x: -1080, y: -335, width: 1080, height: 1920 }, scale: 1, primary: false },
  ],
  windows: [
    { id: 11, pid: 100, className: 'CASCADIA_HOSTING_WINDOW_CLASS', title: 'Claude Code - demo', bounds: { x: 2600, y: 600, width: 801, height: 501 }, monitor: 1 },
    { id: 12, pid: 200, className: 'Chrome_WidgetWin_1', title: 'Editor', bounds: { x: -1200, y: 100, width: 700, height: 400 }, monitor: 2 },
    { id: 13, pid: 300, className: 'Chrome_WidgetWin_1', title: 'Browser - docs', bounds: { x: 10, y: 10, width: 100, height: 100 }, monitor: 0 },
    { id: 14, pid: 300, className: 'Chrome_WidgetWin_1', title: 'Browser - mail', bounds: { x: 10, y: 10, width: 100, height: 100 }, monitor: 0 },
  ],
  cameras: ['Cam'],
  mics: ['Mic (USB)'],
};

afterEach(() => vi.unstubAllGlobals());

describe('platformFor', () => {
  it('uses the test backend anywhere and real capture on Windows and macOS', () => {
    expect(platformFor('test')).toBe('test');
    vi.stubGlobal('process', { ...process, platform: 'linux' });
    expect(() => platformFor('auto')).toThrow(expect.objectContaining({ code: 'unsupported-platform' }));
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    expect(platformFor()).toBe('macos');
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    expect(platformFor()).toBe('windows');
  });
});

describe('resolveArea', () => {
  it('captures a whole monitor', () => {
    const area = resolveArea({ kind: 'monitor', index: 1 }, devices);
    expect(area).toEqual({ monitor: devices.monitors[1] });
    expect(areaGeometry(area)).toEqual({ size: { width: 1920, height: 1080 }, origin: { x: 2560, y: 509 } });
  });

  it('names the monitors when the index does not exist', () => {
    expect(() => resolveArea({ kind: 'monitor', index: 5 }, devices)).toThrow(
      expect.objectContaining({ code: 'device-not-found', message: 'there is no monitor 5; monitors: 0 (2560×1440), 1 (1920×1080), 2 (1080×1920)' }),
    );
  });

  it('crops a region in monitor pixels, rounding the size down to even numbers', () => {
    const area = resolveArea({ kind: 'region', rect: [100, 50, 401, 301], monitor: 2 }, devices);
    expect(area.crop).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    expect(areaGeometry(area)).toEqual({ size: { width: 400, height: 300 }, origin: { x: -980, y: -285 } });
  });

  it('treats a region that covers the whole monitor as the monitor', () => {
    expect(resolveArea({ kind: 'region', rect: [0, 0, 1920, 1080], monitor: 1 }, devices).crop).toBeUndefined();
  });

  it('crops an odd-sized monitor to even numbers', () => {
    const odd = { ...devices, monitors: [{ ...devices.monitors[0]!, bounds: { x: 0, y: 0, width: 1365, height: 767 } }] };
    expect(resolveArea({ kind: 'monitor', index: 0 }, odd).crop).toEqual({ x: 0, y: 0, width: 1364, height: 766 });
  });

  it('refuses a region outside its monitor, and one that is not a number', () => {
    for (const rect of [[1800, 0, 200, 100], [-1, 0, 200, 100], [0, 0, 1, 100], [Number.NaN, 0, 200, 100], [0, 0, 200, Number.POSITIVE_INFINITY]] as const) {
      expect(() => resolveArea({ kind: 'region', rect: [...rect], monitor: 1 }, devices)).toThrow(expect.objectContaining({ code: 'invalid-options' }));
    }
  });

  it('captures a window as the region of its bounds', () => {
    const area = resolveArea({ kind: 'window', title: 'Claude Code - demo' }, devices);
    expect(area).toEqual({ monitor: devices.monitors[1], crop: { x: 40, y: 91, width: 800, height: 500 } });
    expect(areaGeometry(area).origin).toEqual({ x: 2600, y: 600 });
  });

  it('clips a window to the monitor that holds most of it', () => {
    expect(resolveArea({ kind: 'window', title: 'Editor' }, devices).crop).toEqual({ x: 0, y: 435, width: 580, height: 400 });
  });

  it('finds a window by a unique part of its title, ignoring case', () => {
    expect(resolveArea({ kind: 'window', title: 'claude code' }, devices).monitor.index).toBe(1);
    expect(() => resolveArea({ kind: 'window', title: 'browser' }, devices)).toThrow(
      expect.objectContaining({ code: 'invalid-options', message: '"browser" matches 2 windows: "Browser - docs", "Browser - mail"' }),
    );
    expect(() => resolveArea({ kind: 'window', title: 'Terminal' }, devices)).toThrow(expect.objectContaining({ code: 'device-not-found' }));
  });

  it('finds a window by its id, whatever its title, and says when it is gone', () => {
    expect(resolveArea({ kind: 'window', id: 14 }, devices)).toEqual(resolveArea({ kind: 'window', title: 'Browser - docs' }, devices));
    expect(() => resolveArea({ kind: 'window', id: 99 }, devices)).toThrow(expect.objectContaining({ code: 'device-not-found', message: 'the window 99 is gone (closed, minimized or on another desktop)' }));
  });

  it('refuses a title that two windows have exactly', () => {
    const twins = { ...devices, windows: [...devices.windows, { ...devices.windows[1]! }] };
    expect(() => resolveArea({ kind: 'window', title: 'Editor' }, twins)).toThrow(
      expect.objectContaining({ code: 'invalid-options', message: '"Editor" matches 2 windows: "Editor", "Editor"' }),
    );
  });
});

describe('checkDevice', () => {
  it('checks camera and mic names against the list', () => {
    expect(() => checkDevice('mic', 'Mic (USB)', devices)).not.toThrow();
    expect(() => checkDevice('camera', 'Webcam', devices)).toThrow(
      expect.objectContaining({ code: 'device-not-found', message: 'there is no camera "Webcam"; cameras: "Cam"' }),
    );
  });
});

describe('ffmpeg inputs', () => {
  it('grabs a monitor with ddagrab on Windows, cropped on the GPU for a region', () => {
    const monitor = devices.monitors[1]!;
    expect(screenInput('windows', { monitor }, false)).toEqual(['-f', 'lavfi', '-i', 'ddagrab=output_idx=1:framerate=30:draw_mouse=0,hwdownload,format=bgra,settb=1/1000000']);
    expect(screenInput('windows', { monitor, crop: { x: 40, y: 92, width: 800, height: 500 } }, true)[3]).toBe(
      'ddagrab=output_idx=1:framerate=30:draw_mouse=1:offset_x=40:offset_y=92:video_size=800x500,hwdownload,format=bgra,settb=1/1000000',
    );
  });

  it('paces the test patterns in real time', () => {
    const [moving, still] = TEST_DEVICES.monitors;
    expect(screenInput('test', { monitor: moving! }, false)[3]).toBe('testsrc2=s=1280x720:r=30,realtime,settb=1/1000000');
    expect(screenInput('test', { monitor: still! }, false)[3]).toBe('testsrc2=s=640x360:r=30:d=1,tpad=stop=-1:stop_mode=clone,realtime,settb=1/1000000');
    expect(screenInput('test', { monitor: moving!, crop: { x: 2, y: 4, width: 100, height: 50 } }, false)[3]).toBe(
      'testsrc2=s=1280x720:r=30,crop=100:50:2:4,realtime,settb=1/1000000',
    );
    expect(webcamInput('test', 'Failing Test Camera')[3]).toBe('testsrc=s=640x480:r=30:d=1,realtime,settb=1/1000000');
    expect(micInput('test', 'Silent Test Microphone')[3]).toBe('anullsrc=r=48000:cl=mono,arealtime');
  });

  it('plays the sound file CUTTLE_TEST_SPEECH names as the spoken test mic, looped in real time', () => {
    const saved = process.env.CUTTLE_TEST_SPEECH;
    try {
      process.env.CUTTLE_TEST_SPEECH = 'C:/speech/en.m4a';
      expect(micInput('test', 'Spoken Test Microphone')).toEqual(['-re', '-stream_loop', '-1', '-i', 'C:/speech/en.m4a']);
      delete process.env.CUTTLE_TEST_SPEECH;
      expect(() => micInput('test', 'Spoken Test Microphone')).toThrow(expect.objectContaining({ code: 'device-not-found' }));
    } finally {
      if (saved === undefined) delete process.env.CUTTLE_TEST_SPEECH;
      else process.env.CUTTLE_TEST_SPEECH = saved;
    }
  });

  it('opens DirectShow devices with a small mic buffer and corrects the mic start by it', () => {
    expect(webcamInput('windows', 'Cam')).toEqual(['-f', 'dshow', '-rtbufsize', '256M', '-i', 'video=Cam']);
    expect(micInput('windows', 'Mic (USB)')).toEqual(['-f', 'dshow', '-audio_buffer_size', '50', '-i', 'audio=Mic (USB)']);
    expect(micLatency('windows')).toBe(0.05);
    expect(micLatency('test')).toBe(0);
  });

  it('captures a whole display with avfoundation on macOS and crops it in the filter graph', () => {
    const monitor = { index: 1, name: 'Display 1', bounds: { x: 2880, y: 0, width: 3840, height: 2160 }, scale: 2, primary: false, displayId: 4 };
    expect(screenInput('macos', { monitor }, false)).toEqual(['-f', 'avfoundation', '-capture_cursor', '0', '-framerate', '30', '-pixel_format', 'bgr0', '-i', 'Capture screen 1:none']);
    expect(screenInput('macos', { monitor, crop: { x: 40, y: 92, width: 800, height: 500 } }, true)).toContain('1');
    expect(screenFilter('macos', { monitor })).toBeUndefined();
    expect(screenFilter('macos', { monitor, crop: { x: 40, y: 92, width: 800, height: 500 } })).toBe('crop=800:500:40:92');
    expect(screenFilter('windows', { monitor, crop: { x: 40, y: 92, width: 800, height: 500 } })).toBeUndefined();
  });

  it('opens avfoundation cameras at 30 fps in the mode asked for, and mics by name', () => {
    expect(webcamInput('macos', 'FaceTime HD Camera')).toEqual(['-f', 'avfoundation', '-framerate', '30', '-i', 'FaceTime HD Camera:none']);
    expect(webcamInput('macos', 'FaceTime HD Camera', { width: 1280, height: 720 })).toEqual(['-f', 'avfoundation', '-framerate', '30', '-video_size', '1280x720', '-i', 'FaceTime HD Camera:none']);
    expect(micInput('macos', 'MacBook Air Microphone')).toEqual(['-f', 'avfoundation', '-i', 'none:MacBook Air Microphone']);
    // macOS keeps avfoundation's capture stamps: nothing to subtract
    expect(micLatency('macos')).toBe(0);
  });
});

describe('pickCameraMode', () => {
  const listing = (...modes: string[]) =>
    ['[avfoundation @ 0x1] Selected video size (1x1) is not supported by the device.', '[avfoundation @ 0x1] Supported modes:', ...modes.map((mode) => `[avfoundation @ 0x1]   ${mode}`)].join('\n');

  it('takes 720p at 30 fps when the camera has it', () => {
    expect(pickCameraMode(listing('640x480@[1.000000 30.000000]fps', '1920x1080@[1.000000 30.000000]fps', '1280x720@[1.000000 30.000000]fps'))).toEqual({ width: 1280, height: 720 });
  });

  it('otherwise takes the largest mode up to 1080 lines that runs at 30 fps', () => {
    expect(pickCameraMode(listing('640x480@[15.000000 30.000000]fps', '1920x1080@[30.000000 30.000000]fps', '3840x2160@[1.000000 30.000000]fps', '1280x720@[60.000000 60.000000]fps'))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('leaves the size to the camera when no mode runs at 30 fps or none is listed', () => {
    expect(pickCameraMode(listing('1280x720@[60.000000 60.000000]fps'))).toBeUndefined();
    expect(pickCameraMode('')).toBeUndefined();
  });
});

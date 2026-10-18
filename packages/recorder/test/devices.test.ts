import { describe, expect, it } from 'vitest';
import { listDevices, parseAvfoundationDevices, parseDshowDevices } from '../src/devices';
import { TEST_DEVICES } from '../src/sources';

describe('parseDshowDevices', () => {
  it('reads camera and microphone names from the DirectShow listing', () => {
    const log = [
      '[in#0 @ 0000019655642000] "HD Pro Webcam C920" (video)',
      '[in#0 @ 0000019655642000]   Alternative name "@device_pnp_\\\\?\\usb#vid_046d"',
      '[in#0 @ 0000019655642000] "Microphone Array (AMD Audio Device)" (audio)',
      '[in#0 @ 0000019655642000]   Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{A1B2}"',
      '[in#0 @ 0000019655642000] "Capture Card" (audio, video)',
      'Error opening input file dummy.',
    ].join('\r\n');
    expect(parseDshowDevices(log)).toEqual({
      cameras: ['HD Pro Webcam C920', 'Capture Card'],
      mics: ['Microphone Array (AMD Audio Device)', 'Capture Card'],
    });
  });

  it('finds nothing when there are no devices', () => {
    expect(parseDshowDevices('[in#0 @ 0000] Could not enumerate video devices (or none found).')).toEqual({ cameras: [], mics: [] });
  });
});

describe('parseAvfoundationDevices', () => {
  it('reads cameras and microphones from the avfoundation listing, leaving out the screens', () => {
    const log = [
      '[AVFoundation indev @ 0x151614d20] AVFoundation video devices:',
      '[AVFoundation indev @ 0x151614d20] [0] FaceTime HD Camera',
      '[AVFoundation indev @ 0x151614d20] [1] Camera of „iPhone“',
      '[AVFoundation indev @ 0x151614d20] [2] Capture screen 0',
      '[AVFoundation indev @ 0x151614d20] [3] Capture screen 1',
      '[AVFoundation indev @ 0x151614d20] AVFoundation audio devices:',
      '[AVFoundation indev @ 0x151614d20] [0] MacBook Air Microphone',
      '[AVFoundation indev @ 0x151614d20] [1] Microphone of „iPhone“',
      '[in#0 @ 0x151614380] Error opening input: Input/output error',
    ].join('\n');
    expect(parseAvfoundationDevices(log)).toEqual({
      cameras: ['FaceTime HD Camera', 'Camera of „iPhone“'],
      mics: ['MacBook Air Microphone', 'Microphone of „iPhone“'],
    });
  });
});

describe('listDevices', () => {
  it('lists the test devices as a copy', async () => {
    const devices = await listDevices({ backend: 'test' });
    expect(devices).toEqual(TEST_DEVICES);
    devices.mics.push('changed');
    expect(TEST_DEVICES.mics).not.toContain('changed');
  });

  it.runIf(process.platform === 'win32')('lists the monitors in ddagrab order with their desktop bounds', async () => {
    const { monitors, windows, cameras, mics } = await listDevices();
    expect(monitors.map((monitor) => monitor.index)).toEqual(monitors.map((_, index) => index));
    for (const monitor of monitors) {
      expect(monitor.bounds.width).toBeGreaterThan(0);
      expect(monitor.scale).toBeGreaterThanOrEqual(1);
    }
    expect(monitors.filter((monitor) => monitor.primary).length).toBeLessThanOrEqual(1);
    for (const window of windows) expect(monitors.map((monitor) => monitor.index)).toContain(window.monitor);
    expect(Array.isArray(cameras) && Array.isArray(mics)).toBe(true);
    // ffmpeg lists the cameras and mics (DirectShow) in seconds on a cold runner, not in 5
  }, 30_000);

  it.runIf(process.platform === 'darwin')('lists the displays in avfoundation order with their backing pixels', async () => {
    const { monitors, windows } = await listDevices({ media: false });
    expect(monitors.map((monitor) => monitor.index)).toEqual(monitors.map((_, index) => index));
    for (const monitor of monitors) {
      expect(monitor.bounds.width).toBeGreaterThan(0);
      expect(monitor.displayId).toBeTypeOf('number');
    }
    expect(monitors.filter((monitor) => monitor.primary)).toHaveLength(1);
    for (const window of windows) expect(monitors.map((monitor) => monitor.index)).toContain(window.monitor);
  });
});

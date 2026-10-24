import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { shotGraph, takeShot } from '../src/shot';
import { TEST_DEVICES, resolveArea } from '../src/sources';
import type { Devices } from '../src/types';

const dir = mkdtempSync(join(tmpdir(), 'cuttle-shot-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

/** Width, height and resolution (dpi, from pHYs) of a PNG. */
function png(file: string): { width: number; height: number; dpi?: number } {
  const bytes = readFileSync(file);
  const at = bytes.indexOf('pHYs');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), ...(at > 0 && { dpi: Math.round(bytes.readUInt32BE(at + 4) * 0.0254) }) };
}

describe('takeShot (the test backend)', () => {
  it('takes a whole monitor', async () => {
    const out = join(dir, 'monitor.png');
    const shot = await takeShot({ source: { kind: 'monitor', index: 0 }, out, backend: 'test' });
    expect(shot).toEqual({ file: out, width: 1280, height: 720, scale: 1, monitor: 0, warnings: [] });
    expect(png(out)).toEqual({ width: 1280, height: 720, dpi: 72 });
  });

  it('takes a region at its exact size, an odd one too (a video needs even sizes, a picture does not)', async () => {
    const out = join(dir, 'region.png');
    const shot = await takeShot({ source: { kind: 'region', monitor: 0, rect: [10, 20, 301, 201] }, out, backend: 'test' });
    expect([shot.width, shot.height]).toEqual([301, 201]);
    expect(png(out)).toMatchObject({ width: 301, height: 201 });
  });

  it('takes a window by itself, and names it', async () => {
    const out = join(dir, 'window.png');
    const shot = await takeShot({ source: { kind: 'window', title: 'Test Window' }, out, backend: 'test' });
    expect(shot).toMatchObject({ width: 640, height: 360, window: 'Test Window', monitor: 0 });
    expect(png(out)).toMatchObject({ width: 640, height: 360 });
  });

  it('says what is wrong with the source before it takes anything', async () => {
    await expect(takeShot({ source: { kind: 'monitor', index: 7 }, out: join(dir, 'x.png'), backend: 'test' })).rejects.toMatchObject({ code: 'device-not-found' });
    await expect(takeShot({ source: { kind: 'region', monitor: 0, rect: [1200, 0, 300, 300] }, out: join(dir, 'x.png'), backend: 'test' })).rejects.toMatchObject({ code: 'invalid-options' });
  });
});

describe("a screenshot's ffmpeg graph on Windows", () => {
  const devices: Devices = {
    ...TEST_DEVICES,
    monitors: [{ index: 1, name: 'DISPLAY2', bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scale: 1.5, primary: true }],
    windows: [{ id: 4242, pid: 7, className: 'Chrome_WidgetWin_1', title: 'Docs', bounds: { x: 100, y: 50, width: 801, height: 601 }, monitor: 1 }],
  };

  it('takes the screen through ddagrab, a region of it at its exact size', () => {
    expect(shotGraph('windows', resolveArea({ kind: 'monitor', index: 1 }, devices, true), false, false)).toBe('ddagrab=output_idx=1:draw_mouse=0,hwdownload,format=bgra');
    expect(shotGraph('windows', resolveArea({ kind: 'region', monitor: 1, rect: [5, 6, 301, 201] }, devices, true), true, false)).toBe(
      'ddagrab=output_idx=1:draw_mouse=1:offset_x=5:offset_y=6:video_size=301x201,hwdownload,format=bgra',
    );
  });

  it('takes a window by itself through gfxcapture, and where it is on the screen without it', () => {
    const area = resolveArea({ kind: 'window', title: 'Docs' }, devices, true);
    expect(shotGraph('windows', area, false, true)).toBe('gfxcapture=hwnd=4242:capture_cursor=0:capture_border=1:display_border=0:width=801:height=601,hwdownload,format=bgra');
    expect(shotGraph('windows', area, false, false)).toBe('ddagrab=output_idx=1:draw_mouse=0:offset_x=100:offset_y=50:video_size=801x601,hwdownload,format=bgra');
  });
});

import { describe, expect, it } from 'vitest';
import { CURSOR_SHAPES } from '@cuttle/project';
import { loadWin32 } from '../src/win32';

describe.runIf(process.platform === 'win32')('win32', () => {
  it('loads once per module and reads the pointer', async () => {
    const win = await loadWin32();
    expect(await loadWin32()).toBe(win);
    const { x, y } = win.cursorPosition();
    expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
    expect(CURSOR_SHAPES).toContain(win.cursorShape());
  });

  it('puts the pointer on a monitor, in the same pixels as the monitor bounds', async () => {
    const win = await loadWin32();
    const monitors = win.monitors();
    if (monitors.length === 0) return; // a machine without a desktop session
    const { x, y } = win.cursorPosition();
    const inside = monitors.filter(({ bounds }) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height);
    expect(inside.length).toBe(1);
  });

  it('lists windows with a title and a size on a listed monitor', async () => {
    const win = await loadWin32();
    const monitors = win.monitors();
    for (const window of win.windows()) {
      expect(window.title).not.toBe('');
      expect(window.bounds.width).toBeGreaterThanOrEqual(2);
      expect(monitors.some((monitor) => monitor.index === window.monitor)).toBe(true);
    }
  });
});

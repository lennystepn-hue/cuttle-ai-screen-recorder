import { describe, expect, it } from 'vitest';
import { windowGate } from '../src/window-gate';
import type { RawInput } from '../src/types';

const move = (x: number, y: number): RawInput => ({ type: 'move', time: 1, x, y });
const click = (x: number, y: number): RawInput => ({ type: 'click', time: 1, x, y, button: 'left' });
const key: RawInput = { type: 'key', time: 1 };
const popup: RawInput = { type: 'window', time: 1, id: 9, kind: 'notification', rect: { x: 0, y: 0, width: 10, height: 10 }, open: true };

describe('windowGate', () => {
  const bounds = { x: 100, y: 200, width: 800, height: 600 };

  it('lets the input in while the window is in front, and none while another one is', () => {
    const gate = windowGate(7, bounds, () => {});
    expect(gate.allows(move(150, 250))).toBe(true);
    gate.look({ id: 3, bounds: { x: 0, y: 0, width: 400, height: 300 } });
    expect([move(150, 250), click(150, 250), key].map((input) => gate.allows(input))).toEqual([false, false, false]);
    gate.look({ id: 7, bounds });
    expect([move(150, 250), click(150, 250), key].map((input) => gate.allows(input))).toEqual([true, true, true]);
    gate.look(undefined);
    expect(gate.allows(key)).toBe(false);
  });

  it('never lets in what opens over the screen, nor a click beside the window', () => {
    const gate = windowGate(7, bounds, () => {});
    expect(gate.allows(popup)).toBe(false);
    expect(gate.allows(click(50, 250))).toBe(false);
    // the pointer may leave the window: it is drawn outside the picture
    expect(gate.allows(move(50, 250))).toBe(true);
  });

  it('moves the origin with the window', () => {
    const corners: { x: number; y: number }[] = [];
    const gate = windowGate(7, bounds, (corner) => corners.push(corner));
    gate.look({ id: 7, bounds });
    gate.look({ id: 7, bounds: { ...bounds, x: 300 } });
    expect(corners).toEqual([{ x: 300, y: 200 }]);
    expect(gate.allows(click(1050, 250))).toBe(true);
  });
});

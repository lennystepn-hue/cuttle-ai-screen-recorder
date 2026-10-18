// A window take on macOS, where the capture helper takes the window by itself: only what is done in
// that window is the take's input. While another window is in front, the pointer, the clicks, the
// keys and the content area are not logged (the take shows none of it), nor ever what opens over
// the screen (a dialog or notification of another window is not in the take), nor a click or a
// scroll beside the window. When the window has moved, the events' origin moves with it. Pure: the
// caller looks at the front window.
import type { Bounds, RawInput } from './types';

/** How often the front window is looked at (ms). */
export const WINDOW_GATE_MS = 250;

export interface WindowGate {
  /** The front window now (its id and frame in desktop pixels, as darwin.ts's `foreground()` gives it). */
  look(front: { id: number; bounds: Bounds } | undefined): void;
  /** Whether `input` is the take's. */
  allows(input: RawInput): boolean;
}

/**
 * The gate of the window `target`, at `bounds` (desktop pixels) when the take starts; `moved` gets
 * its new top-left corner when a look finds it elsewhere. Input passes until the first look: the
 * window was picked, so it is in front.
 */
export function windowGate(target: number, bounds: Bounds, moved: (origin: { x: number; y: number }) => void): WindowGate {
  let inFront = true;
  let frame = { ...bounds };
  const inside = (x: number, y: number) => x >= frame.x && y >= frame.y && x < frame.x + frame.width && y < frame.y + frame.height;
  return {
    look(front) {
      inFront = front?.id === target;
      if (!inFront || !front) return;
      const shifted = front.bounds.x !== frame.x || front.bounds.y !== frame.y;
      frame = { ...front.bounds };
      if (shifted) moved({ x: frame.x, y: frame.y });
    },
    allows(input) {
      if (input.type === 'window' || !inFront) return false;
      if (input.type === 'click' || input.type === 'scroll') return inside(input.x, input.y);
      return true;
    },
  };
}

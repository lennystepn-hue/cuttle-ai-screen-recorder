import type { InputEvent } from '@cuttle/project';
import type { RawInput } from './types';

/**
 * Moves are thinned to one per 1/60 s slot (a 125 Hz mouse would double the file for nothing). The
 * last move before a pause is kept, so the pointer rests where it stopped and does not creep towards
 * the next move.
 */
const MOVE_RATE = 60;
/**
 * Key presses are counted per half second: neither which keys nor the exact timing of each press is
 * stored. The `keys` event carries the start of its half second, so it can come after later events.
 */
export const KEY_WINDOW = 0.5;
/** Events kept while the screen track's start is not known yet; the oldest go first (about 2 s of input). */
const MAX_PENDING = 2_000;

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * Maps raw input (wall-clock seconds, desktop pixels) into events.jsonl lines (screen-track seconds,
 * screen-track pixels) and hands each line to `write`. Input before the screen track's first frame is
 * dropped. Call `close()` at the end: it writes the held-back move and key count.
 */
export class EventsWriter {
  private start: number | undefined;
  private pending: RawInput[] = [];
  private lastSlot = -1;
  private heldMove: InputEvent | undefined;
  private keys: { window: number; count: number } | undefined;
  private closed = false;

  constructor(
    private readonly write: (line: string) => void,
    private readonly origin: { x: number; y: number },
  ) {}

  /**
   * The screen track's start (wall-clock seconds). Writes `initial` (the pointer's position and shape
   * at that moment) first, then the input that came in while the start was not known.
   */
  setStart(start: number, initial: readonly RawInput[]): void {
    this.start = start;
    const pending = this.pending;
    this.pending = [];
    for (const input of [...initial, ...pending]) this.push(input);
  }

  push(input: RawInput): void {
    if (this.closed) return; // the hook can deliver a last event after it was stopped
    if (this.start === undefined) {
      this.pending.push(input);
      if (this.pending.length > MAX_PENDING) this.pending.shift();
      return;
    }
    const t = input.time - this.start;
    if (t < 0) return;
    const at = round(t);
    const x = 'x' in input ? input.x - this.origin.x : 0;
    const y = 'y' in input ? input.y - this.origin.y : 0;
    switch (input.type) {
      case 'move': {
        const slot = Math.floor(t * MOVE_RATE);
        if (slot === this.lastSlot) {
          this.heldMove = { t: at, type: 'move', x, y };
          return;
        }
        // After a pause the held move is where the pointer rested; in a continuous move the new one replaces it.
        if (slot > this.lastSlot + 1) this.flushMove();
        this.lastSlot = slot;
        this.heldMove = undefined;
        return this.emit({ t: at, type: 'move', x, y });
      }
      case 'click':
        this.flushMove();
        return this.emit({ t: at, type: 'click', x, y, button: input.button });
      case 'scroll':
        this.flushMove();
        return this.emit({ t: at, type: 'scroll', x, y, dx: input.dx, dy: input.dy });
      case 'shape':
        this.flushMove();
        return this.emit({ t: at, type: 'shape', shape: input.shape });
      case 'caret':
        this.flushMove();
        return this.emit({ t: at, type: 'caret', rect: [x, y, input.width, input.height] });
      case 'key': {
        const window = Math.floor(t / KEY_WINDOW);
        if (this.keys?.window === window) {
          this.keys.count++;
          return;
        }
        this.flushKeys();
        this.keys = { window, count: 1 };
        return;
      }
    }
  }

  close(): void {
    this.flushMove();
    this.flushKeys();
    this.closed = true;
  }

  private flushMove(): void {
    if (this.heldMove === undefined) return;
    this.emit(this.heldMove);
    this.heldMove = undefined;
  }

  private flushKeys(): void {
    if (this.keys === undefined) return;
    this.emit({ t: round(this.keys.window * KEY_WINDOW), type: 'keys', count: this.keys.count });
    this.keys = undefined;
  }

  private emit(event: InputEvent): void {
    this.write(`${JSON.stringify(event)}\n`);
  }
}

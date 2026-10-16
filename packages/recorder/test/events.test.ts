import { describe, expect, it } from 'vitest';
import { parseEventsJsonl, type InputEvent } from '@cuttle/project';
import { EventsWriter } from '../src/events';
import type { RawInput } from '../src/types';

/** A writer whose screen track started at wall-clock 1000 s, capturing from desktop (100, 50). */
function writer() {
  let text = '';
  const events = new EventsWriter((line) => (text += line), { x: 100, y: 50 });
  const read = (): InputEvent[] => {
    const parsed = parseEventsJsonl(text);
    expect(parsed.issues).toEqual([]);
    return parsed.events;
  };
  return { events, read };
}

describe('EventsWriter', () => {
  it('maps wall-clock seconds and desktop pixels into the screen track', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
    events.push({ type: 'click', time: 1001.2345, x: 150, y: 70, button: 'right' });
    events.push({ type: 'scroll', time: 1001.5, x: 90, y: 40, dx: 0, dy: -2 });
    events.push({ type: 'shape', time: 1002, shape: 'text' });
    expect(read()).toEqual([
      { t: 1.235, type: 'click', x: 50, y: 20, button: 'right' },
      { t: 1.5, type: 'scroll', x: -10, y: -10, dx: 0, dy: -2 },
      { t: 2, type: 'shape', shape: 'text' },
    ]);
  });

  it('writes the initial pointer first, then input from before the start was known, dropping what came before the first frame', () => {
    const { events, read } = writer();
    events.push({ type: 'click', time: 999.9, x: 100, y: 50, button: 'left' });
    events.push({ type: 'click', time: 1000.4, x: 110, y: 60, button: 'left' });
    events.setStart(1000, [
      { type: 'move', time: 1000, x: 300, y: 250 },
      { type: 'shape', time: 1000, shape: 'arrow' },
    ]);
    expect(read()).toEqual([
      { t: 0, type: 'move', x: 200, y: 200 },
      { t: 0, type: 'shape', shape: 'arrow' },
      { t: 0.4, type: 'click', x: 10, y: 10, button: 'left' },
    ]);
  });

  it('thins moves to one per 1/60 s slot and keeps the last move of a burst', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
    // A 125 Hz mouse: 8 ms apart, from (100, 50) to (164, 50).
    for (let i = 0; i <= 8; i++) events.push({ type: 'move', time: 1000 + i * 0.008, x: 100 + i * 8, y: 50 });
    events.close();
    const moves = read();
    expect(moves.map((move) => move.t)).toEqual([0, 0.024, 0.04, 0.056, 0.064]);
    expect(moves.at(-1)).toEqual({ t: 0.064, type: 'move', x: 64, y: 0 });
  });

  it('writes a held-back move before a click, so the click comes after the pointer got there', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
    events.push({ type: 'move', time: 1000.001, x: 110, y: 50 });
    events.push({ type: 'move', time: 1000.005, x: 120, y: 50 });
    events.push({ type: 'click', time: 1000.006, x: 120, y: 50, button: 'left' });
    expect(read().map((event) => [event.type, event.t])).toEqual([
      ['move', 0.001],
      ['move', 0.005],
      ['click', 0.006],
    ]);
  });

  it('counts key presses per half second without storing which keys', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
    const keys: RawInput[] = [1000.1, 1000.2, 1000.45, 1000.6, 1002.05].map((time) => ({ type: 'key', time }));
    keys.forEach((key) => events.push(key));
    events.close();
    expect(read()).toEqual([
      { t: 0, type: 'keys', count: 3 },
      { t: 0.5, type: 'keys', count: 1 },
      { t: 2, type: 'keys', count: 1 },
    ]);
  });

  it('ignores input after close (the hook can deliver one more event)', () => {
    const { events, read } = writer();
    events.setStart(1000, []);
    events.close();
    events.push({ type: 'click', time: 1003, x: 100, y: 50, button: 'left' });
    expect(read()).toEqual([]);
  });
});

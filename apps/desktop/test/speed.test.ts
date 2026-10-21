import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProject, type InputEvent } from '@cuttle/project';
import { clickZooms } from '@cuttle/timeline';
import { applyCommand, type Command, type Raw } from '../src/shared/document';
import { speedCommands } from '../src/shared/speed';

const screen = { width: 1280, height: 800 };
const limits = { sourceEnd: 30, screen, fps: 30 };
const click = (t: number, x: number, y: number): InputEvent => ({ t, type: 'click', x, y, button: 'left' });
// two clicks close together in the middle of a 20 s clip
const events = [click(8, 400, 300), click(9, 420, 320)];
const clip = { from: 0, to: 20, speed: 1, start: 0 };
const [suggested] = clickZooms(events, [clip], screen);

const raw = (zooms: Raw[]): Raw => ({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, scenes: [{ type: 'clip', id: 's1', from: 0, to: 20 }], zooms });
const parse = (file: Raw): CuttleProject => {
  const parsed = parseProject(file);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
};
/** The project after `commands`, as the editor would see it. */
const run = (file: Raw, commands: Command[]) => parse(commands.reduce((next, command) => applyCommand(next, command, limits), file));
const at = (file: Raw, speed: number) => {
  const project = parse(file);
  return run(file, speedCommands(project, 's1', speed, events, screen, (commands) => run(file, commands)));
};

describe('a clip\'s speed in the editor', () => {
  const zoom = { id: 'z1', label: 'Clicks', at: suggested!.at, duration: suggested!.duration, rect: suggested!.rect, auto: 'click' };

  it('places its zooms on clicks anew: their lead and tail are output seconds, the clicks stay where they are', () => {
    const [placed] = at(raw([zoom]), 2).zooms;
    // 0.7 output s before the first click and 2 after the last: at 2× that is twice as long in the take
    expect(placed).toMatchObject({ at: 8 - 0.7 * 2, auto: 'click', rect: zoom.rect });
    expect(placed!.at + placed!.duration).toBeCloseTo(9 + 2 * 2, 3);
    // waiting sped up past 2× gets no zoom on clicks
    expect(at(raw([zoom]), 4).zooms).toEqual([]);
  });

  it('leaves the zooms on clicks that were switched off, and every other zoom where it is in the take', () => {
    const off = { ...zoom, enabled: false };
    expect(at(raw([off]), 2).zooms).toMatchObject([{ at: zoom.at, duration: zoom.duration, enabled: false }]);
    const typing = { id: 'z2', label: 'Typing', at: 12, duration: 3, rect: [0, 0, 640, 400], auto: 'typing' };
    expect(at(raw([zoom, typing]), 2).zooms.find((item) => item.auto === 'typing')).toMatchObject({ at: 12, duration: 3 });
    // made by hand: its length as people see it stays
    const hand = { id: 'z3', at: 14, duration: 2, rect: [0, 0, 640, 400] };
    expect(at(raw([hand]), 2).zooms).toMatchObject([{ at: 14, duration: 4 }]);
  });
});

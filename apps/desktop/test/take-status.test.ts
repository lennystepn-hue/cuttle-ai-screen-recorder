import { describe, expect, it, vi } from 'vitest';
import { takeClock, takeMenu, takeSeconds, takeTitle, takeTooltip, type TakeActions, type TakeStatus } from '../src/shared/take-status';

const RED_DOT = '\u001b[31m●\u001b[0m';
const actions = (): TakeActions => ({ stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), retake: vi.fn(), marker: vi.fn(), shot: vi.fn(), nextStep: vi.fn(), previousStep: vi.fn() });
/** The menu's items with a label: each with whether it can be chosen now. */
const items = (status: TakeStatus) => takeMenu(status, actions()).flatMap((item) => (item.label === undefined ? [] : [[item.label, item.enabled !== false]]));

describe("a take's time", () => {
  it('counts what was recorded before and the running stretch, and stands still while paused', () => {
    expect(takeSeconds({ recorded: 10, startedAt: 1_000 }, 4_500)).toBe(13.5);
    expect(takeSeconds({ recorded: 10 }, 99_000)).toBe(10);
    expect(takeSeconds({}, 0)).toBe(0);
    expect([takeClock(0), takeClock(42.9), takeClock(605), takeClock(3_725)]).toEqual(['0:00', '0:42', '10:05', '62:05']);
  });
});

describe('the take in the menu bar', () => {
  it('says it records with a red dot and the time, paused with two bars, and the step it is at', () => {
    expect(takeTitle({ phase: 'recording', seconds: 42 })).toBe(`${RED_DOT} 0:42`);
    expect(takeTitle({ phase: 'paused', seconds: 42 })).toBe('❚❚ 0:42');
    expect(takeTitle({ phase: 'recording', seconds: 42, step: { index: 1, count: 5 } })).toBe(`${RED_DOT} 0:42  2/5`);
    expect(takeTitle({ phase: 'countdown', seconds: 0 })).toBe(RED_DOT);
    expect(takeTitle({ phase: 'stopping', seconds: 42 })).toBe('Saving…');
    expect(takeTooltip({ phase: 'recording', seconds: 42, step: { index: 1, count: 5 } })).toBe('Cuttle · Recording 0:42 · step 2 of 5');
    expect(takeTooltip({ phase: 'countdown', seconds: 0 })).toBe('Cuttle · Starting');
  });

  it("offers what the HUD's buttons do now, each with its key, and greys the rest", () => {
    expect(items({ phase: 'recording', seconds: 3 })).toEqual([
      ['Recording', false],
      ['Stop', true],
      ['Pause', true],
      ['Mark slip', true],
      ['Marker', true],
      ['Screenshot', true],
    ]);
    // paused: Resume instead of Pause, no marker or screenshot until it records again
    expect(items({ phase: 'paused', seconds: 3 })).toEqual([
      ['Paused', false],
      ['Stop', true],
      ['Resume', true],
      ['Mark slip', false],
      ['Marker', false],
      ['Screenshot', false],
    ]);
    expect(items({ phase: 'stopping', seconds: 3 }).filter(([, enabled]) => enabled)).toEqual([]);
    const keys = takeMenu({ phase: 'recording', seconds: 3 }, actions()).flatMap((item) => (item.accelerator ? [item.accelerator] : []));
    expect(keys).toEqual(['Control+Shift+Alt+S', 'Control+Shift+Alt+P', 'Control+Shift+Alt+X', 'Control+Shift+Alt+M', 'Control+Shift+Alt+C']);
  });

  it('moves through the script: no step back from the first, no next step after the last', () => {
    const steps = (index: number) => items({ phase: 'recording', seconds: 3, step: { index, count: 3 } }).filter(([label]) => label === 'Next step' || label === 'Step back');
    expect(steps(0)).toEqual([['Next step', true], ['Step back', false]]);
    expect(steps(1)).toEqual([['Next step', true], ['Step back', true]]);
    expect(steps(2)).toEqual([['Next step', false], ['Step back', true]]);
    expect(items({ phase: 'recording', seconds: 3, step: { index: 1, count: 3 } })[0]).toEqual(['Recording · step 2 of 3', false]);
  });

  it('does what its items say', () => {
    const done = actions();
    const click = (status: TakeStatus, label: string) => (takeMenu(status, done).find((item) => item.label === label)!.click as () => void)();
    click({ phase: 'recording', seconds: 1 }, 'Pause');
    click({ phase: 'paused', seconds: 1 }, 'Resume');
    click({ phase: 'recording', seconds: 1 }, 'Mark slip');
    click({ phase: 'recording', seconds: 1, step: { index: 0, count: 2 } }, 'Next step');
    click({ phase: 'recording', seconds: 1 }, 'Stop');
    expect([done.pause, done.resume, done.retake, done.nextStep, done.stop].map((action) => vi.mocked(action).mock.calls.length)).toEqual([1, 1, 1, 1, 1]);
    expect(vi.mocked(done.marker).mock.calls.length).toBe(0);
  });
});

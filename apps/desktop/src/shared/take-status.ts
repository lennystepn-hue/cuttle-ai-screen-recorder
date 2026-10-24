// A take as the menu bar (the tray on Windows) shows it: its time beside the icon on macOS, a
// tooltip, and a menu with what the HUD's buttons do. The HUD shows the same time.
import type { MenuItemConstructorOptions } from 'electron';
import type { HudState } from './ipc';

/** The take's seconds: what was recorded before, plus the running stretch (it stands still while paused). */
export const takeSeconds = (state: Pick<HudState, 'recorded' | 'startedAt'>, now: number): number => (state.recorded ?? 0) + (state.startedAt ? Math.max(0, (now - state.startedAt) / 1000) : 0);

/** A take's time as the HUD shows it: 0:42, 12:05. */
export const takeClock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export interface TakeStatus {
  phase: HudState['phase'];
  seconds: number;
  /** With a script: the step the take is at (from 0), of how many. */
  step?: { index: number; count: number };
}

/** A red recording dot in the menu bar's title (macOS draws a title's ANSI colours). */
const RED_DOT = '\u001b[31m●\u001b[0m';

/** What the take is doing, in a word or two. */
function doing(phase: TakeStatus['phase']): string {
  if (phase === 'countdown') return 'Starting';
  if (phase === 'paused') return 'Paused';
  if (phase === 'resuming') return 'Resuming';
  if (phase === 'stopping') return 'Stopping';
  return 'Recording';
}

/** The title beside the menu bar icon (macOS): `● 0:42` while it records, `❚❚ 0:42` while paused, the step after it. */
export function takeTitle(status: TakeStatus): string {
  const step = status.step ? `  ${status.step.index + 1}/${status.step.count}` : '';
  if (status.phase === 'countdown') return `${RED_DOT}${step}`;
  if (status.phase === 'stopping') return 'Saving…';
  const mark = status.phase === 'recording' ? RED_DOT : '❚❚';
  return `${mark} ${takeClock(status.seconds)}${step}`;
}

/** The tray's tooltip: "Cuttle · Recording 0:42 · step 2 of 5". */
export function takeTooltip(status: TakeStatus): string {
  const step = status.step ? ` · step ${status.step.index + 1} of ${status.step.count}` : '';
  return `Cuttle · ${doing(status.phase)}${status.phase === 'countdown' ? '' : ` ${takeClock(status.seconds)}`}${step}`;
}

/** What the take's menu does: the HUD's buttons, and the prompter's steps. */
export interface TakeActions {
  stop(): void;
  pause(): void;
  resume(): void;
  retake(): void;
  marker(): void;
  shot(): void;
  nextStep(): void;
  previousStep(): void;
}

/**
 * The tray's menu during a take: what it is doing, then Stop, Pause or Resume, the slip, a marker,
 * a screenshot and the steps, each with its key. What cannot be done now is greyed (a marker while
 * paused, anything while it stops). Its time is in the title and the tooltip, not here: a menu
 * rebuilt every second would close while it is open.
 */
export function takeMenu(status: TakeStatus, actions: TakeActions): MenuItemConstructorOptions[] {
  const recording = status.phase === 'recording';
  const paused = status.phase === 'paused';
  const step = status.step;
  return [
    { label: `${doing(status.phase)}${step ? ` · step ${step.index + 1} of ${step.count}` : ''}`, enabled: false },
    { type: 'separator' },
    { label: 'Stop', accelerator: 'Control+Shift+Alt+S', enabled: status.phase !== 'stopping', click: () => actions.stop() },
    paused
      ? { label: 'Resume', accelerator: 'Control+Shift+Alt+P', click: () => actions.resume() }
      : { label: 'Pause', accelerator: 'Control+Shift+Alt+P', enabled: recording, click: () => actions.pause() },
    { type: 'separator' },
    { label: 'Mark slip', accelerator: 'Control+Shift+Alt+X', enabled: recording, click: () => actions.retake() },
    { label: 'Marker', accelerator: 'Control+Shift+Alt+M', enabled: recording, click: () => actions.marker() },
    { label: 'Screenshot', accelerator: 'Control+Shift+Alt+C', enabled: recording, click: () => actions.shot() },
    ...(step
      ? ([
          { type: 'separator' },
          { label: 'Next step', accelerator: 'Control+Shift+Alt+N', enabled: recording && step.index < step.count - 1, click: () => actions.nextStep() },
          { label: 'Step back', accelerator: 'Control+Shift+Alt+B', enabled: recording && step.index > 0, click: () => actions.previousStep() },
        ] satisfies MenuItemConstructorOptions[])
      : []),
  ];
}

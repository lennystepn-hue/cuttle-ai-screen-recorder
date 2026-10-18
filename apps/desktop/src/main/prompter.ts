// The prompter's window during a take (Prompter.tsx): by the HUD, never in the video, never focused.
// It follows the take's `step` markers; its buttons ask the recorder for the next step or the one
// before, as the step keys do.
import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from 'electron';
import { prompterPosition, type PrompterState, type ScriptStep } from '../shared/recording';
import { HIDDEN } from './check';
import { bindRequests, send } from './ipc';
import { APP_ORIGIN } from './protocols';
import { recorderHost } from './recorder-host';

/** As wide as the HUD's window (its card and a margin for the shadow); as high as its content, within these. */
export const PROMPTER_WIDTH = 512;
const MIN_HEIGHT = 96;
const MAX_HEIGHT = 480;

export interface Prompter {
  readonly window: BrowserWindow;
  /** The take is at this step now (a `step` marker's label: the step's id). */
  reached(id: string): void;
  /** The take runs (the buttons work), or it stops. */
  setLive(live: boolean): void;
  destroy(): void;
}

/**
 * Opens the prompter by the HUD (`hud`, DIP) on the work area of its display; `onBounds` hears
 * every move and new height (its area is a dead zone). `open` makes the overlay window.
 */
export function openPrompter(
  open: (bounds: Rectangle, preload: string, options: BrowserWindowConstructorOptions) => BrowserWindow,
  hud: Rectangle,
  workArea: Rectangle,
  steps: readonly ScriptStep[],
  onBounds: () => void,
): Prompter {
  const size = { width: PROMPTER_WIDTH, height: 160 };
  const place = prompterPosition(hud, workArea, size);
  const window = open({ x: place.x, y: place.y, ...size }, 'prompter.cjs', { focusable: false, movable: true });
  const state: PrompterState = { steps: steps.map(({ title, note }) => ({ title, ...(note && { note }) })), index: 0, live: false };
  const show = () => send(window.webContents, 'prompter:state', { ...state });
  bindRequests(window.webContents, 'prompter', {
    'prompter:next': () => recorderHost.nextStep(),
    'prompter:previous': () => recorderHost.previousStep(),
    'prompter:size': ({ height }) => {
      if (window.isDestroyed()) return;
      const bounds = window.getContentBounds();
      const fitted = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)));
      if (fitted === bounds.height) return;
      // under the HUD it grows down; over it, up
      window.setContentBounds({ ...bounds, y: place.below ? bounds.y : bounds.y + bounds.height - fitted, height: fitted });
      onBounds();
    },
  });
  window.on('moved', onBounds);
  void window.loadURL(`${APP_ORIGIN}/prompter.html`).then(
    () => {
      if (window.isDestroyed()) return;
      show();
      if (!HIDDEN) window.showInactive();
    },
    () => {},
  );
  return {
    window,
    reached(id) {
      const index = steps.findIndex((step) => step.id === id);
      if (index < 0 || index === state.index) return;
      state.index = index;
      show();
    },
    setLive(live) {
      if (live === state.live) return;
      state.live = live;
      show();
    },
    destroy() {
      if (!window.isDestroyed()) window.destroy();
    },
  };
}

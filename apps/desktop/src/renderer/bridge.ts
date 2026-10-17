import type { Bridge } from '../shared/ipc';

declare global {
  interface Window {
    cuttle: Bridge;
  }
}

/** The preload's bridge to the main process (`window.cuttle`). */
export const bridge: Bridge = window.cuttle;

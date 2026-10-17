// The bridge a sandboxed preload exposes as `window.cuttle`: only its window's channels.
import { contextBridge, ipcRenderer } from 'electron';
import { STREAM_EVENTS, WINDOW_CHANNELS, type WindowKind } from '../shared/channels';

/**
 * How motion is set, as `data-motion` on the page's root: `reduce` turns animation off, `full`
 * keeps it when the OS asks for less, `system` follows the OS (the CSS's media query).
 */
function followMotion(): void {
  const apply = (motion: unknown) => {
    if (typeof motion === 'string' && document.documentElement) document.documentElement.dataset.motion = motion;
  };
  const initial = process.argv.find((arg) => arg.startsWith('--cuttle-motion='))?.slice('--cuttle-motion='.length);
  if (document.documentElement) apply(initial);
  else document.addEventListener('DOMContentLoaded', () => apply(initial), { once: true });
  ipcRenderer.on('app:motion', (_event, motion: unknown) => apply(motion));
}

/** The OS as `data-platform` on the page's root: macOS has its window buttons on the left of the title bar. */
function markPlatform(): void {
  const apply = () => (document.documentElement.dataset.platform = process.platform);
  if (document.documentElement) apply();
  else document.addEventListener('DOMContentLoaded', apply, { once: true });
}

export function exposeBridge(kind: WindowKind): void {
  followMotion();
  markPlatform();
  const requests: readonly string[] = WINDOW_CHANNELS[kind].requests;
  const events: readonly string[] = WINDOW_CHANNELS[kind].events;
  // An event that says a state (the HUD's, a status, the media) is kept, so a listener that
  // subscribes after it arrived (React sets up after the page loaded) starts from the newest. An
  // export's progress and end are news, not states: a late listener does not get an old one.
  const last = new Map<string, unknown>();
  for (const channel of events) if (!STREAM_EVENTS.has(channel)) ipcRenderer.on(channel, (_event, payload: unknown) => last.set(channel, payload));
  contextBridge.exposeInMainWorld('cuttle', {
    invoke(channel: string, argument?: unknown): Promise<unknown> {
      if (!requests.includes(channel)) return Promise.reject(new Error(`unknown request ${channel}`));
      return ipcRenderer.invoke(channel, argument);
    },
    on(channel: string, listener: (payload: unknown) => void): () => void {
      if (!events.includes(channel)) throw new Error(`unknown event ${channel}`);
      const wrapped = (_event: unknown, payload: unknown) => listener(payload);
      ipcRenderer.on(channel, wrapped);
      if (last.has(channel)) {
        const payload = last.get(channel);
        queueMicrotask(() => listener(payload));
      }
      return () => ipcRenderer.removeListener(channel, wrapped);
    },
  });
}

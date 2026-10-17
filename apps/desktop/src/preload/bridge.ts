// The bridge a sandboxed preload exposes as `window.cuttle`: only its window's channels.
import { contextBridge, ipcRenderer } from 'electron';
import { WINDOW_CHANNELS, type WindowKind } from '../shared/channels';

export function exposeBridge(kind: WindowKind): void {
  const requests: readonly string[] = WINDOW_CHANNELS[kind].requests;
  const events: readonly string[] = WINDOW_CHANNELS[kind].events;
  contextBridge.exposeInMainWorld('cuttle', {
    invoke(channel: string, argument?: unknown): Promise<unknown> {
      if (!requests.includes(channel)) return Promise.reject(new Error(`unknown request ${channel}`));
      return ipcRenderer.invoke(channel, argument);
    },
    on(channel: string, listener: (payload: unknown) => void): () => void {
      if (!events.includes(channel)) throw new Error(`unknown event ${channel}`);
      const wrapped = (_event: unknown, payload: unknown) => listener(payload);
      ipcRenderer.on(channel, wrapped);
      return () => ipcRenderer.removeListener(channel, wrapped);
    },
  });
}

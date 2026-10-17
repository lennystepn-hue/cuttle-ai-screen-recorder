import type { WebContents } from 'electron';
import { WINDOW_CHANNELS, type WindowKind } from '../shared/channels';
import { REQUESTS, type Events, type Request, type Responses } from '../shared/ipc';

type Channels<K extends WindowKind> = (typeof WINDOW_CHANNELS)[K]['requests'][number];

export type Handlers<K extends WindowKind> = {
  [R in Channels<K>]: (argument: ReturnType<(typeof REQUESTS)[R]['parse']>) => Promise<Responses[R]> | Responses[R];
};

/**
 * Registers the request handlers of one window on its own `webContents` (not globally), so a window
 * reaches only its kind's channels. Every argument is checked against the contract first.
 */
export function bindRequests<K extends WindowKind>(contents: WebContents, kind: K, handlers: Handlers<K>): void {
  for (const channel of WINDOW_CHANNELS[kind].requests as readonly Request[]) {
    const handler = (handlers as Record<string, (argument: unknown) => unknown>)[channel]!;
    contents.ipc.handle(channel, async (_event, argument: unknown) => {
      const parsed = REQUESTS[channel].safeParse(argument);
      if (!parsed.success) throw new Error(`${channel}: invalid request (${parsed.error.issues.map((issue) => issue.message).join('; ')})`);
      return handler(parsed.data);
    });
  }
}

/** Sends an event to a window, unless it is gone. */
export function send<E extends keyof Events>(contents: WebContents, channel: E, payload: Events[E]): void {
  if (!contents.isDestroyed()) contents.send(channel, payload);
}

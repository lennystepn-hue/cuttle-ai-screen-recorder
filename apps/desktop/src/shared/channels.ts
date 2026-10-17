// The channels each kind of window may use. No zod here: the preloads bundle this file.
import type { Event, Request } from './ipc';

export const WINDOW_CHANNELS = {
  editor: {
    requests: ['project:info', 'project:reveal', 'media:state', 'media:retry', 'export:targets', 'export:start', 'export:cancel'],
    events: ['media:state', 'export:progress', 'export:end'],
  },
  pill: {
    requests: ['pill:recent', 'pill:open', 'pill:hide', 'pill:menu'],
    events: ['pill:recent'],
  },
} as const satisfies Record<string, { requests: readonly Request[]; events: readonly Event[] }>;

export type WindowKind = keyof typeof WINDOW_CHANNELS;

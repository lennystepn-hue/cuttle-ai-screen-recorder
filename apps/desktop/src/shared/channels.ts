// The channels each kind of window may use. No zod here: the preloads bundle this file.
import type { Event, Request } from './ipc';

export const WINDOW_CHANNELS = {
  editor: {
    requests: ['project:info', 'project:reveal', 'media:state', 'media:retry', 'export:targets', 'export:start', 'export:cancel', 'project:record', 'project:takes'],
    events: ['media:state', 'export:progress', 'export:end', 'project:status'],
  },
  pill: {
    requests: ['pill:recent', 'pill:open', 'pill:hide', 'pill:menu', 'pill:record'],
    events: ['pill:recent'],
  },
  picker: {
    requests: ['picker:setup', 'picker:hover', 'picker:choices', 'picker:record', 'picker:cancel', 'picker:claude-folder'],
    events: ['picker:open', 'picker:active', 'picker:choices'],
  },
  hud: {
    requests: ['hud:stop', 'hud:marker'],
    events: ['hud:state'],
  },
  countdown: {
    requests: [],
    events: ['countdown:tick'],
  },
} as const satisfies Record<string, { requests: readonly Request[]; events: readonly Event[] }>;

export type WindowKind = keyof typeof WINDOW_CHANNELS;

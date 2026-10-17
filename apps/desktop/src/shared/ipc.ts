// The IPC contract between the main process and the windows: every channel with the zod schema of
// what a window may send. The main process checks each request against it; the preloads expose only
// their window's channels.
import { z } from 'zod';

export const EXPORT_FORMATS = ['16:9', '1:1', '9:16'] as const;
export const ENCODERS = ['auto', 'hardware', 'software'] as const;

/** The origin of the media protocol in an editor window: `cuttle-media://project/<path in the project>`. */
export const MEDIA_ORIGIN = 'cuttle-media://project';

/** What the editor needs to open its project; the rest it reads through the media protocol. */
export interface ProjectInfo {
  dir: string;
  name: string;
  /** cuttle.json as written (parse it with `parseProject`) and the SHA-256 of its bytes. */
  raw: Record<string, unknown>;
  hash: string;
  /** Seconds after the screen track that the webcam and mic started (take.json); 0 when unknown. */
  offsets: { webcam: number; mic: number };
}

/** The editor's background media: a 720p proxy of the screen track, a thumbnail strip, the mic's peaks. */
export interface MediaState {
  /** Counts the changes, so a window keeps the newest of an answer and an event that cross. */
  seq: number;
  proxy: { state: 'none' | 'working' | 'ready' | 'failed'; progress?: number; path?: string; message?: string };
  thumbnails: {
    state: 'none' | 'working' | 'ready' | 'failed';
    path?: string;
    interval?: number;
    width?: number;
    height?: number;
    count?: number;
    columns?: number;
    message?: string;
  };
  peaks: { state: 'none' | 'working' | 'ready' | 'failed'; path?: string; rate?: number; message?: string };
}

export interface ExportProgress {
  format: (typeof EXPORT_FORMATS)[number];
  /** 0-based position of this format in the job, and the job's number of formats. */
  position: number;
  formats: number;
  done: number;
  total: number;
  elapsed: number;
}

export interface ExportFile {
  format: (typeof EXPORT_FORMATS)[number];
  out: string;
  seconds: number;
  bytes: number;
}

export type ExportEnd =
  | { state: 'done'; files: ExportFile[] }
  | { state: 'cancelled'; files: ExportFile[] }
  | { state: 'failed'; files: ExportFile[]; format: (typeof EXPORT_FORMATS)[number]; code: string; message: string };

/** Requests (window → main), each with the schema of its argument. */
export const REQUESTS = {
  // editor
  'project:info': z.undefined(),
  'project:reveal': z.string().max(4096).optional(),
  'media:state': z.undefined(),
  'export:start': z.strictObject({
    formats: z.array(z.enum(EXPORT_FORMATS)).min(1).max(3),
    encoder: z.enum(ENCODERS),
  }),
  'export:cancel': z.undefined(),
  // pill
  'pill:recent': z.undefined(),
  'pill:open': z.strictObject({ dir: z.string().min(1).max(4096) }).optional(),
  'pill:hide': z.undefined(),
  'pill:menu': z.undefined(),
} as const;

export type Request = keyof typeof REQUESTS;

/** What each request answers. */
export interface Responses {
  'project:info': ProjectInfo;
  'project:reveal': void;
  'media:state': MediaState;
  'export:start': { out: string };
  'export:cancel': void;
  'pill:recent': { dir: string; name: string; opened: number }[];
  'pill:open': void;
  'pill:hide': void;
  'pill:menu': void;
}

/** Events (main → window). */
export interface Events {
  'media:state': MediaState;
  'export:progress': ExportProgress;
  'export:end': ExportEnd;
  'pill:recent': Responses['pill:recent'];
}

export type Event = keyof Events;

/** The bridge a preload exposes as `window.cuttle`. */
export interface Bridge {
  invoke<R extends Request>(channel: R, argument?: z.input<(typeof REQUESTS)[R]>): Promise<Responses[R]>;
  on<E extends Event>(channel: E, listener: (payload: Events[E]) => void): () => void;
}

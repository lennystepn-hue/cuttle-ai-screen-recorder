import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';

/** The take.json format version this build reads and the recorder writes. */
export const TAKE_VERSION = 1;

/**
 * When a track's first frame or sample was captured, in seconds on the take's one monotonic clock
 * (any origin). `file` is the track's file name inside the take folder.
 */
const TrackStartSchema = z.strictObject({
  file: z.string().min(1),
  start: z.number(),
});

/**
 * take.json, written by the recorder next to the take's tracks (e.g. `takes/1/take.json`). Export
 * reads it to line the webcam and the mic up with the screen track; events.jsonl is already in
 * screen-track seconds and needs no entry. (`TakeFile`, because `Take` is the recorder's result.)
 */
export const TakeFileSchema = z.strictObject({
  version: z.literal(TAKE_VERSION),
  tracks: z.strictObject({
    screen: TrackStartSchema,
    webcam: TrackStartSchema.optional(),
    mic: TrackStartSchema.optional(),
  }),
});

export type TakeFile = z.output<typeof TakeFileSchema>;
export type TakeFileTrack = keyof TakeFile['tracks'];

export type TakeFileParseResult = { ok: true; take: TakeFile } | { ok: false; issues: ProjectIssue[] };

export function parseTakeJson(text: string): TakeFileParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, '')); // a BOM, as Windows editors write one
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  const result = TakeFileSchema.safeParse(raw);
  if (result.success) return { ok: true, take: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}

/**
 * Seconds by which `track` started after the screen track (negative: before). A track time is
 * `sourceTime - offset`. Undefined when take.json does not list the track.
 */
export function trackOffset(take: TakeFile, track: Exclude<TakeFileTrack, 'screen'>): number | undefined {
  const entry = take.tracks[track];
  return entry === undefined ? undefined : entry.start - take.tracks.screen.start;
}

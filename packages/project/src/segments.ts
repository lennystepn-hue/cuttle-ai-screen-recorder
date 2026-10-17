import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';

/** The segments.json format version this build reads and the recorder writes. */
export const SEGMENTS_VERSION = 1;

const TrackSchema = z.strictObject({
  file: z.string().min(1),
  /** Wall-clock seconds of the track's first frame or sample, on take.json's clock. */
  start: z.number(),
});

/** One stretch of a paused take: each track's file and first-sample stamp, and its length once it ended. */
const SegmentSchema = z.strictObject({
  screen: TrackSchema,
  webcam: TrackSchema.optional(),
  mic: TrackSchema.optional(),
  /** Seconds of the screen file; missing while it records (after a crash, recover measures it). */
  duration: z.number().nonnegative().optional(),
});

/**
 * segments.json, next to a take's tracks when it was paused: written at every pause and resume (a
 * new file, then renamed over the old one). The take's time runs only while a segment records;
 * `takeTime` maps the wall clock onto it. `joined`: the segments were joined into the take's tracks.
 */
export const SegmentsFileSchema = z.strictObject({
  version: z.literal(SEGMENTS_VERSION),
  segments: z.array(SegmentSchema).min(1),
  joined: z.boolean().optional(),
});

export type SegmentsFile = z.output<typeof SegmentsFileSchema>;
export type Segment = SegmentsFile['segments'][number];

export type SegmentsFileParseResult = { ok: true; segments: SegmentsFile } | { ok: false; issues: ProjectIssue[] };

export function parseSegmentsJson(text: string): SegmentsFileParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  const result = SegmentsFileSchema.safeParse(raw);
  if (result.success) return { ok: true, segments: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}

/**
 * The take seconds of a wall-clock time: the length of the segments before it plus the time since
 * its segment's screen track started; a segment without a duration (still recording) runs on.
 * Undefined before the first segment, and during a pause or after the last segment unless
 * `atPause`: then the moment it paused (a marker set while paused lands where the take resumes).
 */
export function takeTime(segments: readonly Segment[], wall: number, atPause = false): number | undefined {
  let offset = 0;
  for (const [index, segment] of segments.entries()) {
    const into = wall - segment.screen.start;
    if (into < 0) return atPause && index > 0 ? offset : undefined;
    if (segment.duration === undefined || into <= segment.duration) return offset + into;
    offset += segment.duration;
  }
  return atPause && segments.length > 0 ? offset : undefined;
}

/** Where each segment starts in the take (seconds): 0, then the sum of the lengths before it. */
export function segmentOffsets(segments: readonly Segment[]): number[] {
  let offset = 0;
  return segments.map((segment) => {
    const at = offset;
    offset += segment.duration ?? 0;
    return at;
  });
}

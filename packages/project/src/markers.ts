import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';

/** The markers.json format version this build reads and the recorder writes. */
export const MARKERS_VERSION = 1;

/**
 * `manual`: the marker hotkey or the recorder API. From a Claude Code transcript: `prompt` (a prompt
 * was submitted), `tool` (a tool call, labelled with the tool's name) and `answer` (the final answer).
 */
export const MARKER_KINDS = ['manual', 'prompt', 'tool', 'answer'] as const;

/** One marker; `t` is in source seconds of the screen track, like events.jsonl. */
export const MarkerSchema = z.strictObject({
  t: z.number().nonnegative(),
  kind: z.enum(MARKER_KINDS),
  label: z.string().min(1).optional(),
});

/** markers.json, written by the recorder next to the take's tracks (it writes them sorted by `t`). */
export const MarkersFileSchema = z.strictObject({
  version: z.literal(MARKERS_VERSION),
  markers: z.array(MarkerSchema),
});

export type Marker = z.output<typeof MarkerSchema>;
export type MarkerKind = (typeof MARKER_KINDS)[number];
export type MarkersFile = z.output<typeof MarkersFileSchema>;

export type MarkersParseResult = { ok: true; markers: Marker[] } | { ok: false; issues: ProjectIssue[] };

export function parseMarkersJson(text: string): MarkersParseResult {
  let raw: unknown;
  try {
    // A UTF-8 byte order mark (U+FEFF), as Windows editors and PowerShell 5.1 write one, is not JSON.
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  const result = MarkersFileSchema.safeParse(raw);
  if (result.success) return { ok: true, markers: result.data.markers };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}

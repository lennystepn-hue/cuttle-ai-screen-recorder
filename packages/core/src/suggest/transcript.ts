// Markers for a take that has none from Claude Code (recorded without untilClaude, or before the
// recorder existed): read from the transcripts of the folder Claude ran in.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSegmentsJson, parseTakeJson, takeTime, type Marker } from '@cuttle/project';
import { claudeTranscriptDir, SessionReader, type ClaudeSignal } from '@cuttle/recorder';

/**
 * The prompt, tool-call and answer markers of the session that was most active while the take ran,
 * in source seconds. `clock` turns a wall-clock time into the take's seconds (undefined: not during
 * the take; `takeClock` gives it), `duration` is the take's length.
 */
export async function transcriptMarkers(cwd: string, clock: (wall: number) => number | undefined, duration: number): Promise<Marker[]> {
  const dir = claudeTranscriptDir(cwd);
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith('.jsonl'));
  let best: Marker[] = [];
  for (const name of names) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => '');
    const seen = new Set<string>();
    const reader = new SessionReader();
    const markers: Marker[] = [];
    for (const line of text.split('\n')) {
      for (const signal of reader.read(line)) {
        const t = clock(signal.time);
        if (t === undefined || t < 0 || t > duration || duplicate(signal, seen)) continue;
        markers.push({ t: Math.round(t * 1000) / 1000, kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) });
      }
    }
    if (markers.length > best.length) best = markers;
  }
  return best.sort((a, b) => a.t - b.t);
}

/**
 * The take's clock: the screen track's start from take.json, and for a paused take its segments
 * (segments.json), where a moment of a pause counts as the moment it paused. Undefined without a
 * readable take.json (or one rebuilt by recover without a start).
 */
export async function takeClock(takeDir: string): Promise<((wall: number) => number | undefined) | undefined> {
  const take = parseTakeJson(await readFile(join(takeDir, 'take.json'), 'utf8').catch(() => ''));
  if (!take.ok || take.take.tracks.screen.start === 0) return undefined;
  const start = take.take.tracks.screen.start;
  const manifest = parseSegmentsJson(await readFile(join(takeDir, 'segments.json'), 'utf8').catch(() => ''));
  if (manifest.ok) {
    const segments = manifest.segments.segments;
    const last = segments.at(-1);
    // after the take's end a signal is not in the take (during the last pause it is where it paused)
    const end = last ? last.screen.start + (last.duration ?? Infinity) : Infinity;
    return (wall) => (wall > end ? undefined : takeTime(segments, wall, true));
  }
  return (wall) => wall - start;
}

function duplicate(signal: ClaudeSignal, seen: Set<string>): boolean {
  if (signal.id === undefined) return false;
  const key = `${signal.kind}:${signal.id}`;
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}

// Markers for a take that has none from Claude Code (recorded without untilClaude, or before the
// recorder existed): read from the transcripts of the folder Claude ran in.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Marker } from '@cuttle/project';
import { claudeTranscriptDir, SessionReader, type ClaudeSignal } from '@cuttle/recorder';

/**
 * The prompt, tool-call and answer markers of the session that was most active while the take ran
 * (`start`: the screen track's start in wall-clock seconds, `duration` its length), in source seconds.
 */
export async function transcriptMarkers(cwd: string, start: number, duration: number): Promise<Marker[]> {
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
        const t = signal.time - start;
        if (t < 0 || t > duration || duplicate(signal, seen)) continue;
        markers.push({ t: Math.round(t * 1000) / 1000, kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) });
      }
    }
    if (markers.length > best.length) best = markers;
  }
  return best.sort((a, b) => a.t - b.t);
}

function duplicate(signal: ClaudeSignal, seen: Set<string>): boolean {
  if (signal.id === undefined) return false;
  const key = `${signal.kind}:${signal.id}`;
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}

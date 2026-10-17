/** A time for people: `0:42.5`, `12:03.0`, `1:02:03.0` (tenths, never rounded up past the time). */
export function formatTime(seconds: number): string {
  const tenths = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10 + 1e-6);
  const s = Math.floor(tenths / 10) % 60;
  const m = Math.floor(tenths / 600) % 60;
  const h = Math.floor(tenths / 36_000);
  const rest = `${String(s).padStart(2, '0')}.${tenths % 10}`;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** A source second for people, beside an output time: `src 54.4 s`, `src 2:32.4` past a minute. */
export function formatSource(seconds: number): string {
  return seconds < 60 ? `src ${(Math.floor(seconds * 10 + 1e-6) / 10).toFixed(1)} s` : `src ${formatTime(seconds)}`;
}

/**
 * A length for people: `0.4 s`, `10.7 s`, `12 s`, `2 min 5 s`, `1 h 2 min`. Below a minute in tenths
 * (none when whole), cut off as `formatTime` cuts, so a video of `0:10.7` is `10.7 s` long.
 */
export function formatDuration(seconds: number): string {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  if (value < 60) return `${(Math.floor(value * 10 + 1e-6) / 10).toString()} s`;
  const total = Math.round(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h} h ${m} min` : s > 0 ? `${m} min ${s} s` : `${m} min`;
}

/**
 * A line of a cuttle.json problem for people: JSON syntax errors say where (`It is not valid JSON at
 * line 1, column 43.`), and a problem with the whole file drops its `(root): ` path.
 */
export function plainIssue(line: string): string {
  const json = /Invalid JSON:.*\(line (\d+) column (\d+)\)/.exec(line);
  if (json) return `It is not valid JSON at line ${json[1]}, column ${json[2]}.`;
  return line.replace(/^\(root\):\s*/, '');
}

/** A speed for people: `12×`, `1.5×`. */
export function formatSpeed(speed: number): string {
  return `${Math.round(speed * 10) / 10}×`;
}

/** A file size for people: `840 KB`, `12.4 MB`, `1.2 GB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

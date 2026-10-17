/** A stretch of source time, `from` < `to`, in seconds. */
export interface Span {
  from: number;
  to: number;
}

/** The spans sorted and merged where they overlap or touch. */
export function union(spans: readonly Span[]): Span[] {
  const sorted = spans.filter((span) => span.to > span.from).sort((a, b) => a.from - b.from);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}

/** The parts of `[from, to)` that `spans` do not cover. */
export function gaps(spans: readonly Span[], from: number, to: number): Span[] {
  const result: Span[] = [];
  let at = from;
  for (const span of union(spans)) {
    if (span.to <= at) continue;
    if (span.from >= to) break;
    if (span.from > at) result.push({ from: at, to: Math.min(span.from, to) });
    at = Math.max(at, span.to);
  }
  if (at < to) result.push({ from: at, to });
  return result;
}

export const length = (span: Span): number => span.to - span.from;

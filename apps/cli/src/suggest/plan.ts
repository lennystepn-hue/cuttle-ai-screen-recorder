// Scenes from what happened in a take: trim the quiet start and end, cut idle stretches, speed up
// waiting. Pure: the inputs come from events.jsonl, markers.json and an ffmpeg pass over the screen.
import type { InputEvent, Marker } from '@cuttle/project';
import { gaps, length, union, type Span } from './spans';

/** The rules, in seconds of the take. */
export const RULES = {
  /** Kept before the first activity and after the last. */
  lead: 0.5,
  tail: 1,
  /** Kept after Claude's final answer, so it can be read. */
  answerTail: 2.5,
  /** Before a prompt marker: the prompt being sent is on screen. */
  promptLead: 2,
  /** An input event counts as activity this long before and after it. */
  inputPad: 0.3,
  /** No input and a still screen for this long is cut out, keeping `idleKeep` on both sides. */
  idleCut: 3,
  idleKeep: 0.5,
  /** No input for this long (the screen may change: Claude at work) is sped up, keeping `waitKeep` at 1× on both sides. */
  waitMin: 8,
  waitKeep: 1,
  /** A speed-up shows about this share of its stretch, but at least `waitShortest` and at most `waitLongest` seconds of video. */
  waitShare: 1 / 12,
  waitShortest: 3,
  waitLongest: 10,
  /** The final answer appears at 1× from this long before its marker. */
  answerLead: 1.5,
  /** Shorter 1× pieces next to a speed-up join it. */
  minClip: 0.6,
};

/** Speeds a speed-up may get (the badge shows them). */
const SPEEDS = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

export interface SuggestInput {
  /** Length of the screen track. */
  duration: number;
  events: readonly InputEvent[];
  markers: readonly Marker[];
  /** Where the screen did not change. */
  still: readonly Span[];
}

export interface SuggestedClip {
  from: number;
  to: number;
  speed: number;
}

export interface Suggestion {
  clips: SuggestedClip[];
  /** What was trimmed, cut and sped up, for people. */
  notes: string[];
  /** Source time of Claude's final answer, when the markers have one. */
  answer?: number;
}

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;
const range = (span: Span) => `${span.from.toFixed(1)}–${span.to.toFixed(1)} s`;

export function suggestClips(input: SuggestInput): Suggestion {
  const { duration } = input;
  const notes: string[] = [];
  const answer = input.markers.filter((marker) => marker.kind === 'answer').at(-1)?.t;
  const prompt = input.markers.find((marker) => marker.kind === 'prompt')?.t;
  const inputSpans = union(
    input.events
      .filter((event) => event.type !== 'shape')
      .map((event) => ({ from: Math.max(0, event.t - RULES.inputPad), to: Math.min(duration, event.t + RULES.inputPad) })),
  );
  // Claude's turn, from its first prompt or tool call to the answer, is never cut: it only waits on a
  // spinner now and then (a still screen), and the speed-up shows it working.
  const turnStart = answer === undefined ? undefined : input.markers.filter((marker) => marker.kind !== 'manual' && marker.t <= answer).at(0)?.t;
  const turn = turnStart !== undefined && answer !== undefined && answer > turnStart ? [{ from: turnStart, to: answer }] : [];
  const active = union([...inputSpans, ...gaps(input.still, 0, duration), ...turn]);
  if (active.length === 0 || duration <= 0) {
    return { clips: duration > 0 ? [{ from: 0, to: ms(duration), speed: 1 }] : [], notes: ['nothing happened on screen or at the keyboard: the whole take, unchanged'] };
  }

  let start = Math.max(0, active[0]!.from - RULES.lead);
  if (prompt !== undefined) start = Math.min(start, Math.max(0, prompt - RULES.promptLead));
  let end = Math.min(duration, active.at(-1)!.to + RULES.tail);
  if (answer !== undefined) end = Math.min(duration, Math.max(end, answer + RULES.answerTail));
  if (start > 0.05) notes.push(`trimmed the quiet start (${range({ from: 0, to: start })})`);
  if (end < duration - 0.05) notes.push(`trimmed the quiet end (${range({ from: end, to: duration })})`);

  const cuts = gaps(active, start, end)
    .filter((gap) => length(gap) >= RULES.idleCut)
    .map((gap) => ({ from: gap.from + RULES.idleKeep, to: gap.to - RULES.idleKeep }));
  for (const cut of cuts) notes.push(`cut ${length(cut).toFixed(1)} s of idle screen (${range(cut)})`);

  const clips: SuggestedClip[] = [];
  for (const kept of gaps(cuts, start, end)) clips.push(...withSpeedUps(kept, inputSpans, answer, notes));
  return { clips: clips.map((clip) => ({ from: ms(clip.from), to: ms(clip.to), speed: clip.speed })), notes, ...(answer !== undefined && { answer }) };
}

/** `kept` as 1× clips, with every long stretch without input sped up. */
function withSpeedUps(kept: Span, inputSpans: readonly Span[], answer: number | undefined, notes: string[]): SuggestedClip[] {
  const fast: SuggestedClip[] = [];
  for (const wait of gaps(inputSpans, kept.from, kept.to)) {
    if (length(wait) < RULES.waitMin) continue;
    const inner = { from: wait.from + RULES.waitKeep, to: wait.to - RULES.waitKeep };
    if (answer !== undefined && answer > inner.from && answer < wait.to) inner.to = Math.min(inner.to, answer - RULES.answerLead);
    const target = Math.min(RULES.waitLongest, Math.max(RULES.waitShortest, length(inner) * RULES.waitShare));
    const speed = SPEEDS.filter((candidate) => candidate <= length(inner) / target).at(-1);
    if (speed === undefined) continue;
    fast.push({ ...inner, speed });
    notes.push(`sped up ${length(inner).toFixed(1)} s without input ${speed}× (${range(inner)})`);
  }
  const clips: SuggestedClip[] = [];
  let at = kept.from;
  for (const piece of fast) {
    if (piece.from - at >= RULES.minClip) clips.push({ from: at, to: piece.from, speed: 1 });
    else piece.from = at; // a short 1× piece joins the speed-up
    clips.push(piece);
    at = piece.to;
  }
  if (kept.to - at >= RULES.minClip || clips.length === 0) clips.push({ from: at, to: kept.to, speed: 1 });
  else clips.at(-1)!.to = kept.to;
  return clips;
}

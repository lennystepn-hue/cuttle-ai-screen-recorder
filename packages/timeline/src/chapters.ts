// The video's chapters from the script: where the take reached each step (its `step` markers), in
// output seconds, named by the step's title. Pure: the export writes them into the video file, the
// CLI and the editor list them as YouTube reads them in a description.
import type { Marker, ScriptStep } from '@cuttle/project';
import { totalDuration, type SceneSpan } from './time';

/** A chapter: from `at` to `end` (output seconds), named after a step of the script (`step`, its id). */
export interface Chapter {
  at: number;
  end: number;
  title: string;
  step: string;
}

/** A move to a step undone within this many seconds (the step key pressed by mistake, then back) is no chapter. */
export const CHAPTER_SLIP_SECONDS = 2;

/**
 * What YouTube asks of a description's chapters: the first at 0:00 (the chapters here always start
 * there), at least three, each this long or longer.
 */
export const YOUTUBE_CHAPTERS = { least: 3, seconds: 10 } as const;

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * The first output second at which a clip shows source second `t`; for a moment the video leaves
 * out (trimmed or cut), where it goes on: the start of the clip that shows the take's next moment.
 */
function shownAt(spans: readonly SceneSpan[], t: number): number | undefined {
  let next: { from: number; start: number } | undefined;
  for (const span of spans) {
    if (span.scene.type !== 'clip') continue;
    const { from, to, speed } = span.scene;
    if (t >= from && t < to) return span.start + (t - from) / speed;
    if (from > t && (!next || from < next.from)) next = { from, start: span.start };
  }
  return next?.start;
}

/**
 * The chapters of a video from the take's `step` markers: one where the take reached each step,
 * named by the step's title. A move undone right away is left out; a step reached again later (after
 * another) starts a chapter again. The first chapter starts at 0, with what comes before the first
 * clip; each ends where the next begins, the last at the video's end. A step no longer in the
 * script makes none, nor does one shown no earlier than the chapter before it.
 */
export function stepChapters(script: readonly ScriptStep[], markers: readonly Marker[], spans: readonly SceneSpan[]): Chapter[] {
  const moves = markers.filter((marker) => marker.kind === 'step' && marker.label !== undefined).sort((a, b) => a.t - b.t);
  // a slip: a move that the next one undoes (back to the step before it) within the slip time
  for (let i = 1; i + 1 < moves.length; ) {
    if (moves[i + 1]!.label === moves[i - 1]!.label && moves[i + 1]!.t - moves[i]!.t < CHAPTER_SLIP_SECONDS) moves.splice(i, 2);
    else i++;
  }
  const starts: Omit<Chapter, 'end'>[] = [];
  for (const move of moves) {
    const step = script.find((item) => item.id === move.label);
    const at = step && shownAt(spans, move.t);
    if (!step || at === undefined) continue;
    const last = starts.at(-1);
    if (last?.step === step.id) continue;
    // steps reached in a stretch the video leaves out start where it goes on: the last of them is what it shows
    if (last && round(at) === last.at) starts.pop();
    else if (last && at < last.at) continue;
    starts.push({ at: starts.length === 0 ? 0 : round(at), title: step.title, step: step.id });
  }
  const duration = totalDuration(spans);
  return starts.map((start, i) => ({ ...start, end: starts[i + 1]?.at ?? round(duration) })).filter((chapter) => chapter.end > chapter.at);
}

/** A chapter's start as YouTube writes it: `0:00`, `12:05`, `1:02:03` (whole seconds, rounded down). */
export function chapterTime(seconds: number): string {
  const whole = Math.floor(seconds);
  const [h, m, s] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];
  const two = (value: number) => String(value).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** The chapters as lines for a YouTube description (`0:00 Open the settings`), and why YouTube would not show them. */
export function youtubeChapters(chapters: readonly Chapter[]): { text: string; problems: string[] } {
  const problems: string[] = [];
  if (chapters.length < YOUTUBE_CHAPTERS.least) problems.push(`YouTube shows chapters from ${YOUTUBE_CHAPTERS.least} on; this video has ${chapters.length}.`);
  const short = chapters.filter((chapter) => chapter.end - chapter.at < YOUTUBE_CHAPTERS.seconds);
  if (short.length > 0) {
    problems.push(`YouTube needs each chapter to last ${YOUTUBE_CHAPTERS.seconds} s or more; shorter: ${short.map((chapter) => `“${chapter.title}” (${Math.round((chapter.end - chapter.at) * 10) / 10} s)`).join(', ')}.`);
  }
  return { text: chapters.map((chapter) => `${chapterTime(chapter.at)} ${chapter.title}`).join('\n'), problems };
}

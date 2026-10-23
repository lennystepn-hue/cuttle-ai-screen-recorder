// The music (and the computer's sound) under speech: how far down it goes and when, the same for the
// export's mix and the editor's preview. Pure, so the editor imports it without the main process's code.
import type { CuttleProject, TranscriptWord } from '@cuttle/project';
import { applyCaptionFixes, captionWords, sceneSpans } from '@cuttle/timeline';

/** Words closer than this (seconds) are one stretch of speech. */
const SPEECH_GAP = 0.6;

/** The stretches with speech in words on the output timeline (any order): words closer than SPEECH_GAP joined. */
export function speechOf(words: readonly { t: number; end: number }[]): { start: number; end: number }[] {
  const speech: { start: number; end: number }[] = [];
  for (const word of [...words].sort((a, b) => a.t - b.t)) {
    const last = speech.at(-1);
    if (last && word.t - last.end < SPEECH_GAP) last.end = Math.max(last.end, word.end);
    else speech.push({ start: word.t, end: word.end });
  }
  return speech;
}

/**
 * The stretches of the video with speech, in output seconds: the take's words where the clips show
 * them (`captionWords`), and the narration's (`narration`, output seconds already).
 */
export function speechSpans(
  project: CuttleProject,
  words: readonly TranscriptWord[],
  spans = sceneSpans(project.scenes, project.cuts),
  narration: readonly { t: number; end: number }[] = [],
): { start: number; end: number }[] {
  return speechOf([...captionWords(applyCaptionFixes(words, project.captions.fixes), spans), ...narration]);
}

/** The music goes down this long before speech starts, and comes back over this long after it ends (seconds). */
export const DUCK_ATTACK = 0.25;
export const DUCK_RELEASE = 0.45;

/** The stretches the music is down for: speech, joined over a gap too short to come back up in. */
export function duckSpans(speech: readonly { start: number; end: number }[]): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const span of [...speech].sort((a, b) => a.start - b.start)) {
    const last = spans.at(-1);
    if (last && span.start - last.end < DUCK_ATTACK + DUCK_RELEASE) last.end = Math.max(last.end, span.end);
    else spans.push({ ...span });
  }
  return spans;
}

/**
 * The music's gain at each moment: 1, down to `duck` dB under speech (it starts going down before the
 * words, and stays down over a gap too short to come back up in).
 */
export function duckEnvelope(speech: readonly { start: number; end: number }[], duckDb: number): (t: number) => number {
  const low = 10 ** (-duckDb / 20);
  if (duckDb <= 0 || speech.length === 0) return () => 1;
  const spans = duckSpans(speech);
  return (t) => {
    let depth = 0;
    for (const span of spans) {
      if (t < span.start - DUCK_ATTACK) break;
      if (t > span.end + DUCK_RELEASE) continue;
      const k = t < span.start ? (t - (span.start - DUCK_ATTACK)) / DUCK_ATTACK : t > span.end ? 1 - (t - span.end) / DUCK_RELEASE : 1;
      depth = Math.max(depth, Math.min(1, Math.max(0, k)));
    }
    return 1 - (1 - low) * depth;
  };
}

/**
 * The same gain as an ffmpeg expression of the output's time `t`, for the `volume` filter that lowers
 * the take's system audio in the export; undefined where it stays up. The duck's spans do not
 * overlap, so their ramps add up to its depth.
 */
export function duckExpression(speech: readonly { start: number; end: number }[], duckDb: number): string | undefined {
  if (duckDb <= 0 || speech.length === 0) return undefined;
  const low = 10 ** (-duckDb / 20);
  const n = (value: number) => String(Math.round(value * 1000) / 1000);
  const spans = duckSpans(speech).map(
    ({ start, end }) => `min(clip((t-${n(start - DUCK_ATTACK)})/${DUCK_ATTACK},0,1),clip((${n(end + DUCK_RELEASE)}-t)/${DUCK_RELEASE},0,1))`,
  );
  return `1-${n(1 - low)}*(${spans.join('+')})`;
}

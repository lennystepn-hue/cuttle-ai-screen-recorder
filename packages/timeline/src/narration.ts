// Where the narration's lines play on the video: a line of a scene at its seconds into that scene,
// any other where the clips first show its source second (as a sound). The export and the editor
// place them alike; their words, in output seconds, join the captions.
import { speaks, type CuttleProject, type VoiceLine } from '@cuttle/project';
import type { CaptionWord } from './captions';
import { sceneSpans, type SceneSpan } from './time';

/** A line of the narration on the video: its index in `voiceover.lines`, and where it starts (output seconds). */
export interface NarrationCue {
  index: number;
  line: VoiceLine;
  at: number;
}

const milli = (value: number) => Math.round(value * 1000) / 1000;

/** The first output second the clips show source second `t`; undefined where no clip shows it. */
function firstShown(spans: readonly SceneSpan[], t: number): number | undefined {
  let first: number | undefined;
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'clip' || t < scene.from || t >= scene.to) continue;
    const at = span.start + (t - scene.from) / scene.speed;
    if (first === undefined || at < first) first = at;
  }
  return first;
}

/**
 * The narration's lines that play, in order of their start: each line that speaks in its scene (when it
 * starts inside it) or where a clip shows its second. Lines no clip shows, or past their scene's end,
 * are left out (`left` lists them, by index).
 */
export function narrationCues(project: Pick<CuttleProject, 'scenes' | 'cuts' | 'voiceover'>, spans: readonly SceneSpan[] = sceneSpans(project.scenes, project.cuts)): { cues: NarrationCue[]; left: number[] } {
  const cues: NarrationCue[] = [];
  const left: number[] = [];
  project.voiceover.lines.forEach((line, index) => {
    if (!speaks(line)) return;
    let at: number | undefined;
    if (line.scene !== undefined) {
      const sceneIndex = project.scenes.findIndex((scene) => scene.id === line.scene);
      const span = spans.find((candidate) => candidate.sceneIndex === sceneIndex);
      if (span && line.at < span.end - span.start) at = span.start + line.at;
    } else at = firstShown(spans, line.at);
    if (at === undefined) left.push(index);
    else cues.push({ index, line, at: milli(at) });
  });
  return { cues: cues.sort((a, b) => a.at - b.at), left };
}

/** The narration's words in output seconds, for the captions: each cue's words (seconds of its line) moved to where it plays. */
export function narrationWords(cues: readonly NarrationCue[], words: (cue: NarrationCue) => readonly { t: number; end: number; text: string }[] | undefined): CaptionWord[] {
  return cues
    .flatMap((cue) => (words(cue) ?? []).map((word) => ({ t: milli(cue.at + word.t), end: milli(cue.at + word.end), text: word.text })))
    .sort((a, b) => a.t - b.t);
}

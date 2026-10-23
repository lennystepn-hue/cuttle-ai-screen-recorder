import type { CuttleProject, InputEvent, Marker, TranscriptWord } from '@cuttle/project';
import { applyCaptionFixes, captionWords, keyPresses, occurrences, sceneSpans, totalDuration, type SceneSpan } from '@cuttle/timeline';
import { speechSpans } from './duck';
import type { SoundCue, VideoData } from './runtime';

/** Key presses closer than this are one (a page needs no more than 30 a second). */
const KEY_GAP = 1 / 30;

const milli = (value: number) => Math.round(value * 1000) / 1000;

/** What the take holds that the music can follow. */
export interface VideoInputs {
  events: readonly InputEvent[];
  words: readonly TranscriptWord[];
  markers: readonly Marker[];
  /** The narration's words, in output seconds (they are spoken where they are, not where clips show them). */
  narration?: readonly { t: number; end: number; text: string }[];
}

/** Each output second where the clips show source second `t` (once per showing). */
function shown(spans: readonly SceneSpan[], t: number): number[] {
  const out: number[] = [];
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'clip' || t < scene.from || t >= scene.to) continue;
    out.push(milli(span.start + (t - scene.from) / scene.speed));
  }
  return out;
}

/**
 * The video as its music sees it (`cuttle.video`): its scenes, the cuts between them, and what the
 * clips show of the take (clicks, typing, words, Claude's markers, zooms), all in output seconds.
 */
export function videoData(project: CuttleProject, inputs: VideoInputs): VideoData {
  const spans = sceneSpans(project.scenes, project.cuts);
  const duration = milli(totalDuration(spans));
  const scenes: VideoData['scenes'] = spans.map((span) => {
    const scene = span.scene;
    return {
      index: span.sceneIndex,
      ...(scene.id !== undefined && { id: scene.id }),
      ...(scene.label !== undefined && { label: scene.label }),
      type: scene.type,
      start: milli(span.start),
      end: milli(span.end),
      ...(scene.type === 'clip' && { speed: scene.speed, from: scene.from, to: scene.to }),
      ...(scene.type === 'motion' && { src: scene.src }),
    };
  });
  const cuts = spans.slice(1).map((span) => ({ t: milli(span.start), scene: span.sceneIndex, jump: span.cutBefore === true }));
  const clicks: number[] = [];
  for (const event of inputs.events) if (event.type === 'click') clicks.push(...shown(spans, event.t));
  const keys: number[] = [];
  for (const press of keyPresses(inputs.events)) keys.push(...shown(spans, press.t));
  keys.sort((a, b) => a - b);
  const sparse: number[] = [];
  for (const t of keys) if (sparse.length === 0 || t - sparse.at(-1)! >= KEY_GAP) sparse.push(t);
  const narrated = inputs.narration ?? [];
  const words = [...captionWords(applyCaptionFixes(inputs.words, project.captions.fixes), spans), ...narrated].map(({ t, end, text }) => ({ t, end, text })).sort((a, b) => a.t - b.t);
  const speech: VideoData['speech'] = speechSpans(project, inputs.words, spans, narrated);
  const markers: VideoData['markers'] = [];
  for (const marker of inputs.markers) {
    for (const t of shown(spans, marker.t)) markers.push({ t, kind: marker.kind, ...(marker.label !== undefined && { label: marker.label }) });
  }
  const zooms: VideoData['zooms'] = [];
  for (const zoom of project.zooms.filter((z) => z.enabled)) {
    const seen = new Set<object>();
    for (const occurrence of occurrences(spans, zoom.at, zoom.at + zoom.duration)) {
      if (!occurrence || seen.has(occurrence)) continue;
      seen.add(occurrence);
      zooms.push({ start: milli(occurrence.start), end: milli(occurrence.end), ...(zoom.label !== undefined && { label: zoom.label }) });
    }
  }
  return {
    duration,
    fps: project.output.fps,
    scenes,
    cuts,
    clicks: clicks.sort((a, b) => a - b),
    keys: sparse,
    words,
    speech,
    markers: markers.sort((a, b) => a.t - b.t),
    zooms: zooms.sort((a, b) => a.start - b.start),
  };
}

/** A sound of the project, by its name or file: `url` is set by the caller for files. */
export interface ProjectSound {
  sound: string;
  at: number;
  scene?: string;
  volume: number;
  enabled: boolean;
}

/**
 * The project's sounds on the output timeline: one at a source second plays wherever the clips show
 * it (once per showing, gone where it is cut); one with a `scene` plays that many seconds into it.
 */
export function soundCues(project: CuttleProject, sounds: readonly ProjectSound[]): SoundCue[] {
  const spans = sceneSpans(project.scenes, project.cuts);
  const cues: SoundCue[] = [];
  for (const sound of sounds) {
    if (!sound.enabled) continue;
    if (sound.scene !== undefined) {
      const index = project.scenes.findIndex((scene) => scene.id === sound.scene);
      const span = spans.find((s) => s.sceneIndex === index);
      if (span && sound.at <= span.end - span.start) cues.push({ at: milli(span.start + sound.at), sound: sound.sound, volume: sound.volume });
      continue;
    }
    for (const t of shown(spans, sound.at)) cues.push({ at: t, sound: sound.sound, volume: sound.volume });
  }
  return cues.sort((a, b) => a.at - b.at);
}

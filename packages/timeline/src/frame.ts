import type { Annotation, CameraLayout, CuttleProject, Mask, Rect } from '@cuttle/project';
import { applyCaptionFixes, captionAt, captionCues, captionWords, type ActiveCaption, type CaptionCue, type CaptionWord, type SpokenWord } from './captions';
import { cursorAt, type CursorFrame, type CursorTrack } from './cursor';
import { clamp, type Curve } from './easing';
import { keyBadgeAt, keyGroups, type KeyBadge, type Shortcut } from './keys';
import { occurrences, rampAmount, type Occurrence } from './occurrences';
import { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, textAnimationSeconds, type ActiveText } from './overlays';
import { crossfadeHalf, isContinuousCut, pageTransition, sceneSpans, sourceTimeAt, spanAt, totalDuration, type SceneSpan } from './time';
import { ZOOM_RAMP_SECONDS, zoomRectAt } from './zoom';

/** No motion blur in clips faster than this (waiting sped up: the pointer would streak across the screen). */
export const BLUR_MAX_SPEED = 2;

/** A motion overlay on a clip's frame: which one, and where its own clock is. */
export interface ActiveOverlay {
  /** Its place in the project's `overlays`. */
  index: number;
  /** One showing of it (a clip shown twice shows it twice): the overlay and where its stretch starts. */
  key: string;
  /** Where this showing starts (output seconds), how far into it the frame is, and how long it lasts. */
  start: number;
  local: number;
  duration: number;
}

export interface SceneFrame {
  /** The span it comes from (`Timeline.spans`); a clip with cuts in it has several. */
  index: number;
  /** The scene it shows, in the project's `scenes`. */
  sceneIndex: number;
  kind: 'clip' | 'still' | 'card' | 'motion';
  local: number;
  progress: number;
  opacity: number;
  /** Clip scenes: source seconds, always inside the clip's [from, to). */
  sourceTime?: number;
  /** Clip scenes: the part of the screen shown (source px), the crop or the zoom inside it. */
  zoom?: Rect;
  /**
   * Clip scenes with motion blur (`look.motionBlur`): where the zoom and the pointer were when the
   * frame's shutter opened, never before the clip's start; the frame smears from there to `zoom`
   * and `cursor`. None in waiting that is sped up, and none while the frame is held.
   */
  motion?: { zoom: Rect; cursor?: { x: number; y: number } };
  /** Clip scenes: the width / height the window shows, the crop's or else the screen's. */
  aspect?: number;
  masks: Mask[];
  texts: ActiveText[];
  /** Clip scenes: the annotations it shows (none: left out), in the project's order. */
  annotations?: ActiveAnnotation[];
  /** Clip scenes: the motion overlays it shows, in the project's order (drawn over the whole frame). */
  overlays: ActiveOverlay[];
  badge?: string;
  cursor?: CursorFrame;
  /** Clip scenes: the badge of the shortcut pressed now (`look.keys`). */
  keys?: KeyBadge;
  /** Clip scenes: the camera in another layout (`cameras`), and how far it has turned into it (0 to 1, eased). */
  camera?: { layout: CameraLayout; amount: number };
}

/** The camera turns into a layout, and back, over this long (output seconds). */
export const CAMERA_SWITCH_SECONDS = 0.5;

/** An annotation on a frame: how far it has drawn itself in (0 to 1, eased) and how faded it is. */
export interface ActiveAnnotation {
  annotation: Annotation;
  /** Its place in the project's `annotations`. */
  index: number;
  progress: number;
  opacity: number;
}

/** An annotation draws itself in over this long, and fades out over this long (output seconds). */
export const ANNOTATION_IN_SECONDS = 0.45;
export const ANNOTATION_OUT_SECONDS = 0.3;

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const withAnnotations = (annotations: ActiveAnnotation[]) => (annotations.length > 0 ? { annotations } : {});

/** A scene's transition page while it plays: the scene it goes into, and where its clock is. */
export interface ActiveTransition {
  /** The scene it goes into, its place in the project's `scenes`. */
  sceneIndex: number;
  /** `transition:<sceneIndex>`: a scene is gone into once. */
  key: string;
  /** Where it starts (output seconds), how far into it the frame is, and how long it lasts. */
  start: number;
  local: number;
  duration: number;
}

export interface RenderState {
  t: number;
  /** One layer, or two during a crossfade or a transition (the outgoing one first). */
  layers: SceneFrame[];
  /** The transition page that draws this frame from the two layers, instead of their crossfade. */
  transition?: ActiveTransition;
  /** The caption shown over the frame, when captions are on and someone speaks. */
  caption?: ActiveCaption;
  /** The shortcut's badge over the frame (the more visible layer's during a crossfade). */
  keys?: KeyBadge;
}

export interface Timeline {
  duration: number;
  spans: SceneSpan[];
  /** The captions of the transcript (output seconds), also when the project does not show them. */
  cues: CaptionCue[];
  frameAt(t: number): RenderState;
}

export interface TimelineOptions {
  screenSize: { width: number; height: number };
  cursor?: CursorTrack;
  /** The take's transcript (source seconds), for the captions. */
  transcript?: readonly SpokenWord[];
  /** The narration's words (output seconds, `narrationWords`), for the captions while `voiceover.captions` is on. */
  narration?: readonly CaptionWord[];
  /** Show the captions (default: `captions.enabled`); an export without them passes false. */
  captions?: boolean;
  /** The take's shortcuts (events.jsonl's `shortcut`, source seconds), for their badges. */
  shortcuts?: readonly Shortcut[];
}

export function createTimeline(project: CuttleProject, opts: TimelineOptions): Timeline {
  const { width, height } = opts.screenSize;
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    throw new Error('createTimeline: screenSize must have a positive, finite width and height');
  }
  const spans = sceneSpans(project.scenes, project.cuts);
  const duration = totalDuration(spans);
  // Source seconds where the video jumps (a clip's edge that is not a continuous cut): the smoothed
  // cursor keeps the two sides apart.
  const cuts: number[] = [];
  spans.forEach((span, i) => {
    const scene = span.scene;
    if (scene.type !== 'clip') return;
    const before = spans[i - 1]?.scene;
    const after = spans[i + 1]?.scene;
    if (!(before?.type === 'clip' && before.to === scene.from)) cuts.push(scene.from);
    if (!(after?.type === 'clip' && after.from === scene.to)) cuts.push(scene.to);
  });
  cuts.sort((a, b) => a - b);
  const full: Rect = [0, 0, opts.screenSize.width, opts.screenSize.height];
  const { captions } = project;
  const spoken = opts.transcript ? captionWords(applyCaptionFixes(opts.transcript, captions.fixes), spans) : [];
  const narrated = project.voiceover.captions ? (opts.narration ?? []) : [];
  const words = narrated.length > 0 ? [...spoken, ...narrated].sort((a, b) => a.t - b.t) : spoken;
  const cues = words.length > 0 ? captionCues(words, captions.style) : [];
  const showCaptions = (opts.captions ?? captions.enabled) && cues.length > 0;
  const keys = project.look.keys.enabled && opts.shortcuts ? keyGroups(opts.shortcuts, project.look.keys.show) : [];

  // Where each zoom and text shows in output time, per span: their ramps run in output seconds.
  const zoomShown = new Map(project.zooms.map((zoom) => [zoom, occurrences(spans, zoom.at, zoom.at + zoom.duration)]));
  const textShown = new Map(project.texts.map((text) => [text, occurrences(spans, text.at, text.at + text.duration)]));
  const overlayShown = project.overlays.map((overlay) => occurrences(spans, overlay.at, overlay.at + overlay.duration));
  const annotationShown = project.annotations.map((annotation) => occurrences(spans, annotation.at, annotation.at + annotation.duration));
  const cameraShown = project.cameras.map((camera) => occurrences(spans, camera.at, camera.at + camera.duration));
  const round = (seconds: number) => Math.round(seconds * 1e6) / 1e6;
  /** The camera's layout where the video shows output second `at` of span `index`: the one that started last, if any. */
  const cameraAt = (index: number, at: number): { camera?: { layout: CameraLayout; amount: number } } => {
    let found: { layout: CameraLayout; amount: number; start: number } | undefined;
    project.cameras.forEach((camera, i) => {
      const occurrence = camera.enabled ? cameraShown[i]?.[index] : undefined;
      if (!occurrence || at < occurrence.start - 1e-9 || at >= occurrence.end - 1e-9) return;
      if (found && found.start > occurrence.start) return;
      found = { layout: camera.layout, amount: rampAmount(occurrence, at, CAMERA_SWITCH_SECONDS, 'smooth'), start: occurrence.start };
    });
    return found ? { camera: { layout: found.layout, amount: found.amount } } : {};
  };
  /** How long a frame's shutter is open (output seconds): the motion blur's share of a frame. */
  const shutter = project.look.motionBlur / project.output.fps;

  const halfBetween = (a: SceneSpan, b: SceneSpan): number => crossfadeHalf(a, b, project.look.transition);

  /**
   * The last output frame (frame i at i / fps) that shows the clip inside its source range
   * [from, to). Uses the same strict comparisons as `spanAt`: span ends are rounded to the
   * microsecond, so a frame can fall inside the span while its source time is exactly `to`.
   */
  function lastFrameShown(span: SceneSpan, inside: (local: number) => boolean): number {
    const fps = project.output.fps;
    let frame = Math.ceil(span.end * fps);
    while (frame > 0 && frame / fps >= span.end) frame--;
    while (frame / fps > span.start && !inside(frame / fps - span.start)) frame--;
    return frame / fps;
  }

  function sceneFrame(span: SceneSpan, t: number, opacity: number): SceneFrame {
    const length = span.end - span.start;
    const local = clamp(t - span.start, 0, length);
    const base = { index: span.index, sceneIndex: span.sceneIndex, local, progress: length === 0 ? 1 : local / length, opacity };
    const scene = span.scene;
    if (scene.type !== 'clip') return { ...base, kind: scene.type, masks: [], texts: [], overlays: [] };
    // Past the end (or on a frame whose source time would be `to`), hold the last frame shown:
    // its source time lies inside [from, to), so masks that end with the clip stay on, and a
    // clip's source time never goes back during a crossfade.
    const inside = (l: number) => scene.from + l * scene.speed < scene.to;
    const pastEnd = t >= span.end || !inside(local);
    const sourceLocal = pastEnd ? clamp(lastFrameShown(span, inside) - span.start, 0, length) : local;
    const sourceTime = sourceTimeAt(scene, sourceLocal);
    let cursor = project.look.cursor.enabled && opts.cursor ? cursorAt(opts.cursor, sourceTime, scene.speed, project.look.cursor.smoothing, cuts) : undefined;
    if (cursor && project.look.cursor.clickEffect === 'none') cursor = { ...cursor, clicks: [] };
    // The output time this source frame belongs to (a held or frozen frame's, during a crossfade).
    const shownAt = span.start + (sourceTime - scene.from) / scene.speed;
    const amount = (shown: (Occurrence | undefined)[] | undefined, ramp: number, curve: Curve, at = shownAt): number => {
      const occurrence = shown?.[span.index];
      return occurrence ? rampAmount(occurrence, at, ramp, curve) : 1;
    };
    // the crop is the screen for this clip: zooms fit inside it, the window takes its shape
    const screen = scene.crop?.enabled ? scene.crop.rect : full;
    // a smooth zoom moves as a camera does: it settles
    const zoomAt = (source: number, at: number) =>
      zoomRectAt(project.zooms, source, (zoom) => amount(zoomShown.get(zoom), ZOOM_RAMP_SECONDS, zoom.ease === 'smooth' ? 'settle' : zoom.ease, at), screen, scene.speed);
    // where the camera and the pointer were when the shutter opened, within this clip
    const open = Math.max(scene.from, sourceTime - shutter * scene.speed);
    const blurred = shutter > 0 && !pastEnd && scene.speed <= BLUR_MAX_SPEED && open < sourceTime;
    const before = blurred && cursor && opts.cursor ? cursorAt(opts.cursor, open, scene.speed, project.look.cursor.smoothing, cuts) : undefined;
    const badge = keys.length > 0 ? keyBadgeAt(keys, sourceTime, scene.speed) : undefined;
    return {
      ...base,
      kind: 'clip',
      sourceTime,
      zoom: zoomAt(sourceTime, shownAt),
      ...(blurred && { motion: { zoom: zoomAt(open, shownAt - (sourceTime - open) / scene.speed), ...(before && { cursor: { x: before.x, y: before.y } }) } }),
      aspect: screen[2] / screen[3],
      masks: activeMasks(project.masks, sourceTime),
      texts: activeTexts(project.texts, sourceTime, (text) => {
        const opacity = amount(textShown.get(text), TEXT_FADE_SECONDS, 'linear');
        const occurrence = textShown.get(text)?.[span.index];
        if (!occurrence) return { opacity, enter: 1, exit: 0 };
        // in and out in output seconds where the video shows its start and its end, each at most half of it
        const half = (occurrence.end - occurrence.start) / 2;
        const enterSeconds = Math.min(textAnimationSeconds(text.enter ?? 'fade', text.text), half);
        const exitSeconds = Math.min(textAnimationSeconds(text.exit ?? 'fade', text.text, true), half);
        const enter = occurrence.rampIn && enterSeconds > 0 ? clamp((shownAt - occurrence.start) / enterSeconds, 0, 1) : 1;
        const exit = occurrence.rampOut && exitSeconds > 0 ? clamp(1 - (occurrence.end - shownAt) / exitSeconds, 0, 1) : 0;
        return { opacity, enter, exit };
      }),
      ...withAnnotations(
        project.annotations.flatMap((annotation, index) => {
          const occurrence = annotation.enabled ? annotationShown[index]?.[span.index] : undefined;
          if (!occurrence || shownAt < occurrence.start - 1e-9 || shownAt >= occurrence.end - 1e-9) return [];
          // it draws itself in where the video shows its start, and fades where it shows its end
          const progress = occurrence.rampIn ? easeOutCubic(clamp((shownAt - occurrence.start) / ANNOTATION_IN_SECONDS, 0, 1)) : 1;
          const opacity = occurrence.rampOut ? clamp((occurrence.end - shownAt) / ANNOTATION_OUT_SECONDS, 0, 1) : 1;
          return [{ annotation, index, progress, opacity }];
        }),
      ),
      // a motion overlay's clock runs in output seconds from where its stretch starts showing
      overlays: project.overlays.flatMap((overlay, index) => {
        const occurrence = overlay.enabled ? overlayShown[index]?.[span.index] : undefined;
        if (!occurrence || shownAt < occurrence.start - 1e-9 || shownAt >= occurrence.end - 1e-9) return [];
        const start = round(occurrence.start);
        return [{ index, key: `${index}@${start}`, start, local: round(shownAt - occurrence.start), duration: round(occurrence.end - occurrence.start) }];
      }),
      badge: badgeFor(scene),
      cursor,
      ...(badge && { keys: badge }),
      ...cameraAt(span.index, shownAt),
    };
  }

  function frameAt(t: number): RenderState {
    const time = Number.isNaN(t) ? 0 : clamp(t, 0, duration);
    const state = layersAt(time);
    const caption = showCaptions ? captionAt(cues, time) : undefined;
    // the badge of the layer that shows more (a crossfade fades it with its layer)
    const keyed = state.layers.filter((layer) => layer.keys).sort((a, b) => b.opacity - a.opacity)[0];
    const badge = keyed?.keys && { ...keyed.keys, opacity: keyed.keys.opacity * keyed.opacity };
    return { ...state, ...(caption && { caption }), ...(badge && badge.opacity > 0 && { keys: badge }) };
  }

  function layersAt(time: number): RenderState {
    let span = spanAt(spans, time);
    if (!span) return { t: time, layers: [] };
    // Span ends are rounded to the microsecond, so a frame can fall inside a clip while its source
    // time is already the clip's end. At a continuous cut that frame is the next clip's first, not a
    // held one.
    const following = spans[span.index + 1];
    const scene = span.scene;
    if (following && (following.cutBefore || isContinuousCut(scene, following.scene)) && scene.type === 'clip' && !(scene.from + (time - span.start) * scene.speed < scene.to)) {
      span = following;
    }

    /** The two layers between `a` and `b`, and the transition page that draws them when `b` has one. */
    const between = (a: SceneSpan, b: SceneSpan, half: number): RenderState => {
      const start = round(a.end - half);
      const mix = (time - (a.end - half)) / (2 * half);
      const state: RenderState = { t: time, layers: [sceneFrame(a, time, 1 - mix), sceneFrame(b, time, mix)] };
      if (pageTransition(a, b, project.look.transition)) {
        state.transition = { sceneIndex: b.sceneIndex, key: `transition:${b.sceneIndex}`, start, local: round(time - start), duration: round(2 * half) };
      }
      return state;
    };

    const next = spans[span.index + 1];
    if (next) {
      const half = halfBetween(span, next);
      if (half > 0 && time > span.end - half) return between(span, next, half);
    }

    const prev = spans[span.index - 1];
    if (prev) {
      const half = halfBetween(prev, span);
      if (half > 0 && time < span.start + half) return between(prev, span, half);
    }

    return { t: time, layers: [sceneFrame(span, time, 1)] };
  }

  return { duration, spans, cues, frameAt };
}

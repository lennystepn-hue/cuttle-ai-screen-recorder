import type { CuttleProject, Ease, Mask, Rect } from '@cuttle/project';
import { cursorAt, type CursorFrame, type CursorTrack } from './cursor';
import { clamp } from './easing';
import { occurrences, rampAmount, type Occurrence } from './occurrences';
import { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
import { crossfadeHalf, isContinuousCut, sceneSpans, sourceTimeAt, spanAt, totalDuration, type SceneSpan } from './time';
import { ZOOM_RAMP_SECONDS, zoomRectAt } from './zoom';

export interface SceneFrame {
  /** The span it comes from (`Timeline.spans`); a clip with cuts in it has several. */
  index: number;
  /** The scene it shows, in the project's `scenes`. */
  sceneIndex: number;
  kind: 'clip' | 'still' | 'card';
  local: number;
  progress: number;
  opacity: number;
  /** Clip scenes: source seconds, always inside the clip's [from, to). */
  sourceTime?: number;
  /** Clip scenes: the part of the screen shown (source px), the crop or the zoom inside it. */
  zoom?: Rect;
  /** Clip scenes: the width / height the window shows, the crop's or else the screen's. */
  aspect?: number;
  masks: Mask[];
  texts: ActiveText[];
  badge?: string;
  cursor?: CursorFrame;
}

export interface RenderState {
  t: number;
  layers: SceneFrame[];
}

export interface Timeline {
  duration: number;
  spans: SceneSpan[];
  frameAt(t: number): RenderState;
}

export interface TimelineOptions {
  screenSize: { width: number; height: number };
  cursor?: CursorTrack;
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

  // Where each zoom and text shows in output time, per span: their ramps run in output seconds.
  const zoomShown = new Map(project.zooms.map((zoom) => [zoom, occurrences(spans, zoom.at, zoom.at + zoom.duration)]));
  const textShown = new Map(project.texts.map((text) => [text, occurrences(spans, text.at, text.at + text.duration)]));

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
    if (scene.type !== 'clip') return { ...base, kind: scene.type, masks: [], texts: [] };
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
    const amount = (shown: (Occurrence | undefined)[] | undefined, ramp: number, curve: Ease): number => {
      const occurrence = shown?.[span.index];
      return occurrence ? rampAmount(occurrence, shownAt, ramp, curve) : 1;
    };
    // the crop is the screen for this clip: zooms fit inside it, the window takes its shape
    const screen = scene.crop?.enabled ? scene.crop.rect : full;
    return {
      ...base,
      kind: 'clip',
      sourceTime,
      zoom: zoomRectAt(project.zooms, sourceTime, (zoom) => amount(zoomShown.get(zoom), ZOOM_RAMP_SECONDS, zoom.ease), screen),
      aspect: screen[2] / screen[3],
      masks: activeMasks(project.masks, sourceTime),
      texts: activeTexts(project.texts, sourceTime, (text) => amount(textShown.get(text), TEXT_FADE_SECONDS, 'linear')),
      badge: badgeFor(scene),
      cursor,
    };
  }

  function frameAt(t: number): RenderState {
    const time = Number.isNaN(t) ? 0 : clamp(t, 0, duration);
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

    const next = spans[span.index + 1];
    if (next) {
      const half = halfBetween(span, next);
      if (half > 0 && time > span.end - half) {
        const mix = (time - (span.end - half)) / (2 * half);
        return { t: time, layers: [sceneFrame(span, time, 1 - mix), sceneFrame(next, time, mix)] };
      }
    }

    const prev = spans[span.index - 1];
    if (prev) {
      const half = halfBetween(prev, span);
      if (half > 0 && time < span.start + half) {
        const mix = (time - (span.start - half)) / (2 * half);
        return { t: time, layers: [sceneFrame(prev, time, 1 - mix), sceneFrame(span, time, mix)] };
      }
    }

    return { t: time, layers: [sceneFrame(span, time, 1)] };
  }

  return { duration, spans, frameAt };
}

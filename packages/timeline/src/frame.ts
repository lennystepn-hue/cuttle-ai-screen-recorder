import type { CuttleProject, Mask, Rect } from '@cuttle/project';
import { cursorAt, type CursorFrame, type CursorTrack } from './cursor';
import { clamp } from './easing';
import { activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
import { sceneSpans, sourceTimeAt, spanAt, totalDuration, type SceneSpan } from './time';
import { zoomRectAt } from './zoom';

export interface SceneFrame {
  index: number;
  kind: 'clip' | 'still' | 'card';
  local: number;
  progress: number;
  opacity: number;
  sourceTime?: number;
  zoom?: Rect;
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
  const spans = sceneSpans(project.scenes);
  const duration = totalDuration(spans);
  const full: Rect = [0, 0, opts.screenSize.width, opts.screenSize.height];
  const transition = project.look.transition;
  const maxHalf = transition.enabled ? transition.duration / 2 : 0;

  function halfBetween(a: SceneSpan, b: SceneSpan): number {
    return Math.min(maxHalf, (a.end - a.start) / 2, (b.end - b.start) / 2);
  }

  function sceneFrame(span: SceneSpan, t: number, opacity: number): SceneFrame {
    const length = span.end - span.start;
    const local = clamp(t - span.start, 0, length);
    const base = { index: span.index, local, progress: length === 0 ? 1 : local / length, opacity };
    const scene = span.scene;
    if (scene.type !== 'clip') return { ...base, kind: scene.type, masks: [], texts: [] };
    const sourceTime = sourceTimeAt(scene, local);
    return {
      ...base,
      kind: 'clip',
      sourceTime,
      zoom: zoomRectAt(project.zooms, sourceTime, scene.speed, full),
      masks: activeMasks(project.masks, sourceTime),
      texts: activeTexts(project.texts, sourceTime, scene.speed),
      badge: badgeFor(scene),
      cursor: project.look.cursor.enabled && opts.cursor ? cursorAt(opts.cursor, sourceTime, scene.speed) : undefined,
    };
  }

  function frameAt(t: number): RenderState {
    const time = Number.isFinite(t) ? clamp(t, 0, duration) : 0;
    const span = spanAt(spans, time);
    if (!span) return { t: time, layers: [] };

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

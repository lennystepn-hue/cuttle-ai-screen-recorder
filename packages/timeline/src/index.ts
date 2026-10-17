export { clamp, clamp01, ease, easeInOutCubic, lerp, lerpRect, type EaseKind } from './easing';
export {
  CONTINUOUS_CUT_SECONDS,
  MIN_PIECE_SECONDS,
  clipPieces,
  crossfadeHalf,
  isContinuousCut,
  sceneDuration,
  sceneSpans,
  sourceTimeAt,
  spanAt,
  totalDuration,
  type CutRange,
  type SceneSpan,
} from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { ZOOM_MOVE_SECONDS, ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt, zoomTargetAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, maskRectAt, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
export {
  CAPTION_RULES,
  applyCaptionFixes,
  captionAt,
  captionCues,
  captionWords,
  toSrt,
  toVtt,
  type ActiveCaption,
  type CaptionCue,
  type CaptionWord,
  type SpokenWord,
} from './captions';
export { clickZooms, shownClicks, zoomRectFor, type ClickZoom, type ClipSpan } from './click-zooms';

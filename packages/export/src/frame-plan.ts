import type { RenderState, Timeline } from '@cuttle/timeline';

/** Where one scene is visible in the export and which source times its clip frames come from. */
export interface ScenePlan {
  index: number;
  kind: 'clip' | 'still' | 'card' | 'motion';
  /** First and last output frame (inclusive) on which the scene is drawn, crossfades included. */
  firstFrame: number;
  lastFrame: number;
  /**
   * Clip scenes: every source time the frames ask for, in frame order, without repeats (seconds
   * of the screen track). Ascending: the timeline never goes back within a clip. Empty for still,
   * card and motion scenes.
   */
  sourceTimes: number[];
}

/** Where one showing of a motion overlay (`ActiveOverlay.key`) is visible in the export. */
export interface OverlayPlan {
  key: string;
  /** Its place in the project's `overlays`. */
  index: number;
  /** Where the showing starts and how long it lasts, in output seconds. */
  start: number;
  duration: number;
  firstFrame: number;
  lastFrame: number;
}

export interface FramePlan {
  fps: number;
  /** Output frames; frame i shows output time i / fps. */
  frames: number;
  /** Scenes in the order they first appear. */
  scenes: ScenePlan[];
  /** Motion overlays' showings, in the order they first appear. */
  overlays: OverlayPlan[];
}

/** Frames for `duration` output seconds: every started frame counts, so the video never ends early. */
export function frameCount(duration: number, fps: number): number {
  return Math.max(1, Math.ceil(duration * fps - 1e-6));
}

/** The output frame on screen at each of `times` (output seconds); a time past the end shows the last frame. */
export function stillFrames(duration: number, fps: number, times: readonly number[]): number[] {
  const last = frameCount(duration, fps) - 1;
  return times.map((t) => Math.min(last, Math.max(0, Math.floor(t * fps + 1e-6))));
}

/**
 * The source second a frame shows: that of its most visible layer (in the middle of a crossfade the
 * front one), to the millisecond; undefined when that layer is a still or a card.
 */
export function shownSourceTime(state: RenderState): number | undefined {
  const most = Math.max(...state.layers.map((layer) => layer.opacity));
  // Layers run back to front; equal opacities (up to rounding: 0.15 / 0.3 is 0.4999…) go to the front.
  const shown = state.layers.filter((layer) => layer.opacity >= most - 1e-9).at(-1);
  return shown?.sourceTime === undefined ? undefined : Math.round(shown.sourceTime * 1000) / 1000;
}

/**
 * Walks the timeline frame by frame and records, per scene, the frames it is visible on and the
 * source times it needs. Export opens each scene's decoder at `firstFrame`, closes it after
 * `lastFrame`, and decodes exactly `sourceTimes`.
 */
export function planFrames(timeline: Timeline, fps: number): FramePlan {
  if (timeline.spans.length === 0) throw new Error('planFrames: the project has no scenes');
  const frames = frameCount(timeline.duration, fps);
  return { fps, frames, ...planScenes(timeline, fps, Array.from({ length: frames }, (_, frame) => frame)) };
}

/**
 * The plan for single frames (stills of a preview): only `frames` (output frame numbers) are
 * visited, so each scene decodes just the source times those frames show. `frames` in the plan is
 * their count.
 */
export function planStills(timeline: Timeline, fps: number, frames: readonly number[]): FramePlan {
  if (timeline.spans.length === 0) throw new Error('planStills: the project has no scenes');
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  return { fps, frames: sorted.length, ...planScenes(timeline, fps, sorted) };
}

/**
 * The scenes visible on `frames` (ascending), with the source times they need. A clip with cuts
 * in it is one plan: its pieces follow each other and only jump forward in source time, so one
 * decoder reads them all.
 */
function planScenes(timeline: Timeline, fps: number, frames: readonly number[]): Pick<FramePlan, 'scenes' | 'overlays'> {
  const byIndex = new Map<number, ScenePlan>();
  const byKey = new Map<string, OverlayPlan>();
  for (const frame of frames) {
    for (const layer of timeline.frameAt(frame / fps).layers) {
      for (const overlay of layer.overlays) {
        const seen = byKey.get(overlay.key);
        if (seen) seen.lastFrame = frame;
        else byKey.set(overlay.key, { key: overlay.key, index: overlay.index, start: overlay.start, duration: overlay.duration, firstFrame: frame, lastFrame: frame });
      }
      let plan = byIndex.get(layer.sceneIndex);
      if (!plan) {
        plan = { index: layer.sceneIndex, kind: layer.kind, firstFrame: frame, lastFrame: frame, sourceTimes: [] };
        byIndex.set(layer.sceneIndex, plan);
      }
      plan.lastFrame = frame;
      if (layer.sourceTime === undefined) continue;
      const last = plan.sourceTimes.at(-1);
      if (last !== undefined && layer.sourceTime < last) {
        throw new Error(`planFrames: scene ${layer.sceneIndex} goes back in source time on frame ${frame}`);
      }
      if (layer.sourceTime !== last) plan.sourceTimes.push(layer.sourceTime);
    }
  }
  // Map order is first appearance: frame order, and within a frame the layers back to front.
  return { scenes: [...byIndex.values()], overlays: [...byKey.values()] };
}

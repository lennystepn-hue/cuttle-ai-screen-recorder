import type { Timeline } from '@cuttle/timeline';

/** Where one scene is visible in the export and which source times its clip frames come from. */
export interface ScenePlan {
  index: number;
  kind: 'clip' | 'still' | 'card';
  /** First and last output frame (inclusive) on which the scene is drawn, crossfades included. */
  firstFrame: number;
  lastFrame: number;
  /**
   * Clip scenes: every source time the frames ask for, in frame order, without repeats (seconds
   * of the screen track). Ascending: the timeline never goes back within a clip. Empty for still
   * and card scenes.
   */
  sourceTimes: number[];
}

export interface FramePlan {
  fps: number;
  /** Output frames; frame i shows output time i / fps. */
  frames: number;
  /** Scenes in the order they first appear. */
  scenes: ScenePlan[];
}

/** Frames for `duration` output seconds: every started frame counts, so the video never ends early. */
export function frameCount(duration: number, fps: number): number {
  return Math.max(1, Math.ceil(duration * fps - 1e-6));
}

/**
 * Walks the timeline frame by frame and records, per scene, the frames it is visible on and the
 * source times it needs. Export opens each scene's decoder at `firstFrame`, closes it after
 * `lastFrame`, and decodes exactly `sourceTimes`.
 */
export function planFrames(timeline: Timeline, fps: number): FramePlan {
  if (timeline.spans.length === 0) throw new Error('planFrames: the project has no scenes');
  const frames = frameCount(timeline.duration, fps);
  return { fps, frames, scenes: planScenes(timeline, fps, Array.from({ length: frames }, (_, frame) => frame)) };
}

/**
 * The plan for single frames (stills of a preview): only `frames` (output frame numbers) are
 * visited, so each scene decodes just the source times those frames show. `frames` in the plan is
 * their count.
 */
export function planStills(timeline: Timeline, fps: number, frames: readonly number[]): FramePlan {
  if (timeline.spans.length === 0) throw new Error('planStills: the project has no scenes');
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  return { fps, frames: sorted.length, scenes: planScenes(timeline, fps, sorted) };
}

/** The scenes visible on `frames` (ascending), with the source times they need. */
function planScenes(timeline: Timeline, fps: number, frames: readonly number[]): ScenePlan[] {
  const byIndex = new Map<number, ScenePlan>();
  for (const frame of frames) {
    for (const layer of timeline.frameAt(frame / fps).layers) {
      let plan = byIndex.get(layer.index);
      if (!plan) {
        plan = { index: layer.index, kind: layer.kind, firstFrame: frame, lastFrame: frame, sourceTimes: [] };
        byIndex.set(layer.index, plan);
      }
      plan.lastFrame = frame;
      if (layer.sourceTime === undefined) continue;
      const last = plan.sourceTimes.at(-1);
      if (last !== undefined && layer.sourceTime < last) {
        throw new Error(`planFrames: scene ${layer.index} goes back in source time on frame ${frame}`);
      }
      if (layer.sourceTime !== last) plan.sourceTimes.push(layer.sourceTime);
    }
  }
  // Map order is first appearance: frame order, and within a frame the layers back to front.
  return [...byIndex.values()];
}

// Which motion frames an output frame shows, and how to ask for each: the export page and the
// editor's player ask the same way, so they draw the same.
import { clipView } from '@cuttle/engine';
import type { CuttleProject } from '@cuttle/project';
import type { RenderState, SceneFrame, SceneSpan } from '@cuttle/timeline';
import type { MotionFrameRequest } from '../job';
import type { MotionView } from './runtime';

/** A motion frame a render needs: where it goes in the engine's sources, and the request for it. */
export interface MotionNeed {
  /** A scene's frame goes to `FrameSources.motion` by its layer, an overlay's to `overlays` by its showing. */
  target: { kind: 'scene'; layer: number } | { kind: 'overlay'; key: string };
  /** A scene's or an overlay's frame (a transition's is asked for with the frames it goes between). */
  request: Omit<MotionFrameRequest, 'kind' | 'between'> & { kind: 'scene' | 'overlay' };
}

/** Where a clip layer shows the take, for the overlays over it. `screen` is the screen recording's size. */
export function overlayView(project: Pick<CuttleProject, 'output' | 'look'>, layer: SceneFrame, screen: { width: number; height: number }): MotionView {
  const { zoom, content } = clipView(project.output, project.look, layer, screen);
  return { source: layer.sourceTime ?? null, zoom, content, cursor: layer.cursor ? { x: layer.cursor.x, y: layer.cursor.y } : null };
}

/** Every motion frame `state` shows: its scenes' and its overlays', in the order they are drawn. */
export function motionNeeds(project: CuttleProject, spans: readonly SceneSpan[], state: RenderState, screen: { width: number; height: number }): MotionNeed[] {
  const fps = project.output.fps;
  const needs: MotionNeed[] = [];
  for (const layer of state.layers) {
    const scene = project.scenes[layer.sceneIndex];
    if (scene?.type === 'motion') {
      needs.push({
        target: { kind: 'scene', layer: layer.index },
        request: {
          key: `scene:${layer.sceneIndex}`,
          kind: 'scene',
          index: layer.sceneIndex,
          frame: Math.round(layer.local * fps),
          start: spans[layer.index]?.start ?? 0,
          duration: scene.duration,
          screen,
        },
      });
    }
    if (layer.overlays.length === 0) continue;
    const view = overlayView(project, layer, screen);
    for (const overlay of layer.overlays) {
      needs.push({
        target: { kind: 'overlay', key: overlay.key },
        request: { key: `overlay:${overlay.key}`, kind: 'overlay', index: overlay.index, frame: Math.round(overlay.local * fps), start: overlay.start, duration: overlay.duration, screen, view },
      });
    }
  }
  return needs;
}

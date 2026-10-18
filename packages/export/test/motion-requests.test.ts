import { parseProject } from '@cuttle/project';
import { createTimeline } from '@cuttle/timeline';
import { describe, expect, it } from 'vitest';
import { motionNeeds } from '../src/motion/requests';

const SCREEN = { width: 1280, height: 720 };

function project(input: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

describe('the motion frames a frame of the video needs', () => {
  // a 1 s motion scene, then the take's 0–4 s; the overlay over source 1–3 s is output 2–4 s
  const p = project({
    output: { width: 1920, height: 1080, fps: 30 },
    look: { transition: { enabled: false }, frame: { enabled: false } },
    scenes: [
      { type: 'motion', src: 'motion/intro/index.html', duration: 1 },
      { type: 'clip', from: 0, to: 4 },
    ],
    overlays: [{ src: 'motion/bar/index.html', at: 1, duration: 2 }],
  });
  const timeline = createTimeline(p, { screenSize: SCREEN });
  const needsAt = (t: number) => motionNeeds(p, timeline.spans, timeline.frameAt(t), SCREEN);

  it("asks for a scene's frame by its layer, n / fps seconds into the scene", () => {
    expect(needsAt(0.5)).toEqual([
      { target: { kind: 'scene', layer: 0 }, request: { key: 'scene:0', kind: 'scene', index: 0, frame: 15, start: 0, duration: 1, screen: SCREEN } },
    ]);
  });

  it("asks for an overlay's frame by its showing, with where the take is in the frame", () => {
    const [need, ...rest] = needsAt(2.5);
    expect(rest).toEqual([]);
    expect(need).toMatchObject({ target: { kind: 'overlay', key: '0@2' }, request: { key: 'overlay:0@2', kind: 'overlay', index: 0, frame: 15, start: 2, duration: 2, screen: SCREEN } });
    // without a window frame the take fills the output: the whole screen recording in view
    expect(need!.request.view).toEqual({ source: 1.5, zoom: [0, 0, 1280, 720], content: [0, 0, 1920, 1080], cursor: null });
  });

  it('needs nothing where no motion shows', () => {
    expect(needsAt(1.5)).toEqual([]);
    expect(needsAt(4.5)).toEqual([]);
  });
});

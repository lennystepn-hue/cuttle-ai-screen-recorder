import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import { CAMERA_SWITCH_SECONDS, createTimeline } from '../src/index';

function timeline(cameras: CuttleProjectInput['cameras'], scenes: CuttleProjectInput['scenes'] = [{ type: 'clip', from: 0, to: 20 }]) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4', webcam: 'w.mp4' }, look: { transition: { enabled: false } }, scenes, cameras });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return createTimeline(parsed.project, { screenSize: { width: 1920, height: 1080 } });
}

describe('camera layouts on the video', () => {
  it('turn the camera into the layout over half a second, hold it, and turn back', () => {
    const video = timeline([{ id: 'k1', layout: 'full', at: 4, duration: 3 }]);
    const at = (t: number) => video.frameAt(t).layers[0]!.camera;
    expect(at(3.9)).toBeUndefined();
    expect(at(4)).toEqual({ layout: 'full', amount: 0 });
    expect(at(4 + CAMERA_SWITCH_SECONDS / 2)!.amount).toBeCloseTo(0.5, 2);
    expect(at(5.5)).toEqual({ layout: 'full', amount: 1 });
    expect(at(7 - CAMERA_SWITCH_SECONDS / 4)!.amount).toBeLessThan(0.5);
    expect(at(7)).toBeUndefined();
  });

  it('switch in output seconds on a sped-up clip; the later of two wins; one off shows nothing', () => {
    const video = timeline(
      [
        { id: 'k1', layout: 'side', at: 12, duration: 8 },
        { id: 'k2', layout: 'large', at: 16, duration: 2 },
        { id: 'k3', layout: 'full', at: 1, duration: 2, enabled: false },
      ],
      [
        { type: 'clip', from: 0, to: 10 },
        { type: 'clip', from: 10, to: 30, speed: 4 },
      ],
    );
    expect(video.frameAt(2).layers[0]!.camera).toBeUndefined();
    // 12 s of the take is 10.5 s of the video; its switch takes half a second of the video, not of the take
    expect(video.frameAt(10.5 + CAMERA_SWITCH_SECONDS).layers[0]!.camera).toEqual({ layout: 'side', amount: 1 });
    // 16 s of the take is 11.5 s of the video: the large one, which started later
    expect(video.frameAt(11.7).layers[0]!.camera?.layout).toBe('large');
  });
});

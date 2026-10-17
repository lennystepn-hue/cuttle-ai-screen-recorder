import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import { createTimeline } from '@cuttle/timeline';
import { describe, expect, it } from 'vitest';
import { frameCount, planFrames, planStills } from '../src/frame-plan';

function plan(input: Omit<CuttleProjectInput, 'version' | 'sources'>, fps = 30) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input, output: { fps } });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return planFrames(createTimeline(parsed.project, { screenSize: { width: 1920, height: 1080 } }), fps);
}

describe('frameCount', () => {
  it('counts every started frame', () => {
    expect(frameCount(10, 30)).toBe(300);
    expect(frameCount(7.01, 30)).toBe(211);
    expect(frameCount(1 / 3, 30)).toBe(10);
    expect(frameCount(0.001, 30)).toBe(1);
  });
});

describe('planFrames', () => {
  it('covers each scene with its crossfade and lists its source times once, ascending', () => {
    const result = plan({
      scenes: [
        { type: 'clip', from: 0, to: 2 },
        { type: 'clip', from: 10, to: 18, speed: 4 },
        { type: 'card', title: 'End', duration: 1 },
      ],
    });
    expect(result.frames).toBe(150);
    // 0.3 s transition: 0.15 s (4.5 frames) on each side of a cut.
    expect(result.scenes.map(({ index, kind, firstFrame, lastFrame }) => ({ index, kind, firstFrame, lastFrame }))).toEqual([
      { index: 0, kind: 'clip', firstFrame: 0, lastFrame: 64 },
      { index: 1, kind: 'clip', firstFrame: 56, lastFrame: 124 },
      { index: 2, kind: 'card', firstFrame: 116, lastFrame: 149 },
    ]);
    const second = result.scenes[1]!.sourceTimes;
    expect(second[0]).toBe(10);
    expect(second.at(-1)).toBeLessThan(18);
    expect(second.every((t, i) => i === 0 || t > second[i - 1]!)).toBe(true);
    // 4× speed at 30 fps: 2 output seconds of the clip need 60 distinct source times.
    expect(second).toHaveLength(60);
    expect(result.scenes[2]!.sourceTimes).toEqual([]);
  });

  it('ends a clip on the last frame shown when it ends between two frames', () => {
    const result = plan({ scenes: [{ type: 'clip', from: 0, to: 1.01 }, { type: 'card', title: 'End', duration: 1 }] });
    const clip = result.scenes[0]!;
    // Frames 0 to 30 (t = 0 … 1.0) are inside [0, 1.01); the crossfade until frame 34 holds frame 30.
    expect(clip.lastFrame).toBe(34);
    expect(clip.sourceTimes).toHaveLength(31);
    expect(clip.sourceTimes.at(-1)).toBe(1);
  });

  it('refuses a project without scenes', () => {
    expect(() => plan({ scenes: [] })).toThrow(/no scenes/);
  });
});

describe('planStills', () => {
  function stills(frames: number[]) {
    const parsed = parseProject({
      version: 1,
      sources: { screen: 's.mp4' },
      scenes: [
        { type: 'clip', from: 0, to: 2 },
        { type: 'clip', from: 10, to: 18, speed: 4 },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    return planStills(createTimeline(parsed.project, { screenSize: { width: 1920, height: 1080 } }), 30, frames);
  }

  it('plans only the frames asked for, so each scene decodes just their source times', () => {
    const result = stills([90, 10, 10, 60]);
    expect(result.frames).toBe(3); // three distinct frames
    expect(result.scenes.map(({ index, firstFrame, lastFrame, sourceTimes }) => ({ index, firstFrame, lastFrame, sourceTimes }))).toEqual([
      // Frame 60 is the middle of the crossfade: the first clip holds its last frame (59/30 s).
      { index: 0, firstFrame: 10, lastFrame: 60, sourceTimes: [10 / 30, 59 / 30] },
      { index: 1, firstFrame: 60, lastFrame: 90, sourceTimes: [10, 14] },
    ]);
  });
});

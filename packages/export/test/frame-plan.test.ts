import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import { createTimeline } from '@cuttle/timeline';
import { describe, expect, it } from 'vitest';
import { frameCount, planFrames, planStills, shownSourceTime, stillFrames } from '../src/frame-plan';

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

describe('stillFrames and shownSourceTime', () => {
  // 2 s at 1×, 48 source seconds at 12× (4 s), a 2 s card: 8 s at 30 fps.
  const parsed = parseProject({
    version: 1,
    sources: { screen: 's.mp4' },
    scenes: [
      { type: 'clip', from: 0, to: 2 },
      { type: 'clip', from: 10, to: 58, speed: 12 },
      { type: 'card', title: 'The end', duration: 2 },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const timeline = createTimeline(parsed.project, { screenSize: { width: 1920, height: 1080 } });
  const shown = (t: number) => {
    const [frame] = stillFrames(timeline.duration, 30, [t]);
    return [frame, shownSourceTime(timeline.frameAt(frame! / 30))];
  };

  it('snaps a time to the frame on screen, and a time past the end to the last frame', () => {
    expect(stillFrames(timeline.duration, 30, [0, 1 / 30 - 1e-9, 2.25, 100])).toEqual([0, 1, 67, 239]);
  });

  it('names the source second the frame shows, not the one at the raw time', () => {
    // 2.25 s shows frame 67 (2.2333 s): 0.2333 s into the 12× clip is source 12.8 s, not 13.0 s.
    expect(shown(2.25)).toEqual([67, 12.8]);
    // The middle of the crossfade: both clips at half opacity, the front one (the second) counts.
    expect(shown(2)).toEqual([60, 10]);
    // On the card no clip shows.
    expect(shown(7)).toEqual([210, undefined]);
  });
});

describe('planFrames with motion', () => {
  it('plans a motion scene like a card, and each showing of an overlay with its frames and length', () => {
    const result = plan(
      {
        look: { transition: { enabled: false } },
        scenes: [
          { type: 'motion', src: 'intro.html', duration: 1 },
          { type: 'clip', from: 0, to: 4 },
        ],
        overlays: [
          { src: 'callout.html', at: 1, duration: 2 },
          { src: 'off.html', at: 0, duration: 4, enabled: false },
        ],
      },
      10,
    );
    expect(result.scenes.map(({ index, kind, firstFrame, lastFrame, sourceTimes }) => ({ index, kind, firstFrame, lastFrame, times: sourceTimes.length }))).toEqual([
      { index: 0, kind: 'motion', firstFrame: 0, lastFrame: 9, times: 0 },
      { index: 1, kind: 'clip', firstFrame: 10, lastFrame: 49, times: 40 },
    ]);
    // source 1–3 shows at output 2–4: frames 20 to 39
    expect(result.overlays).toEqual([{ key: '0@2', index: 0, duration: 2, firstFrame: 20, lastFrame: 39 }]);
  });
});

describe('planFrames over cuts', () => {
  it('reads the pieces of a cut clip with one decoder: one plan, its source times jumping forward', () => {
    const result = plan({ scenes: [{ type: 'clip', from: 0, to: 2 }], cuts: [{ from: 0.5, to: 1.5 }] }, 10);
    expect(result.frames).toBe(10);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]).toMatchObject({ index: 0, firstFrame: 0, lastFrame: 9 });
    expect(result.scenes[0]!.sourceTimes).toEqual([0, 0.1, 0.2, 0.3, 0.4, 1.5, 1.6, 1.7, 1.8, 1.9]);
  });
});

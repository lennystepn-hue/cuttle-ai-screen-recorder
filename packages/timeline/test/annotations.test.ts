import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import { ANNOTATION_IN_SECONDS, ANNOTATION_OUT_SECONDS, createTimeline } from '../src/index';

const screenSize = { width: 1920, height: 1080 };

function timeline(annotations: CuttleProjectInput['annotations'], scenes: CuttleProjectInput['scenes'] = [{ type: 'clip', from: 0, to: 20 }]) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, look: { transition: { enabled: false } }, scenes, annotations });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return createTimeline(parsed.project, { screenSize });
}

describe('annotations on the video', () => {
  it('draw themselves in from where they start, hold, and fade out where they end', () => {
    const video = timeline([{ id: 'n1', kind: 'box', at: 4, duration: 3, rect: [100, 100, 300, 200] }]);
    const at = (t: number) => video.frameAt(t).layers[0]!.annotations;
    expect(at(3.9)).toBeUndefined();
    expect(at(4)).toMatchObject([{ index: 0, progress: 0, opacity: 1 }]);
    // half way in: eased, more than half drawn
    expect(at(4 + ANNOTATION_IN_SECONDS / 2)![0]!.progress).toBeGreaterThan(0.6);
    expect(at(5.5)).toMatchObject([{ progress: 1, opacity: 1 }]);
    expect(at(7 - ANNOTATION_OUT_SECONDS / 2)![0]!.opacity).toBeCloseTo(0.5, 2);
    expect(at(7)).toBeUndefined();
  });

  it('play in output time on a sped-up clip, and not at all where no clip shows them or while off', () => {
    const video = timeline(
      [
        { id: 'n1', kind: 'arrow', at: 12, duration: 8, from: [0, 0], to: [10, 10] },
        { id: 'n2', kind: 'spotlight', at: 30, duration: 2, rect: [0, 0, 10, 10] },
        { id: 'n3', kind: 'highlight', at: 1, duration: 2, rect: [0, 0, 10, 10], enabled: false },
      ],
      [
        { type: 'clip', from: 0, to: 10 },
        { type: 'clip', from: 10, to: 30, speed: 4 },
      ],
    );
    // 12 s of the take is 0.5 s into the 4× clip, at 10.5 s of the video; it draws in over output seconds
    expect(video.frameAt(10.5).layers[0]!.annotations).toMatchObject([{ index: 0, progress: 0 }]);
    expect(video.frameAt(10.5 + ANNOTATION_IN_SECONDS).layers[0]!.annotations![0]!.progress).toBe(1);
    expect(video.frameAt(2).layers[0]!.annotations).toBeUndefined();
  });

  it('need their shape: an arrow its two points, the others a rect', () => {
    const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, annotations: [{ kind: 'arrow', at: 0, duration: 1, rect: [0, 0, 1, 1] }, { kind: 'magnifier', at: 0, duration: 1, from: [0, 0], to: [1, 1] }] });
    expect(parsed.ok ? [] : parsed.issues.map((issue) => issue.path)).toEqual(['annotations[0].from', 'annotations[0].to', 'annotations[1].rect']);
    const magnifier = parseProject({ version: 1, sources: { screen: 's.mp4' }, annotations: [{ kind: 'magnifier', at: 0, duration: 1, rect: [0, 0, 10, 10] }] });
    expect(magnifier.ok && magnifier.project.annotations[0]).toMatchObject({ zoom: 2, enabled: true });
  });
});

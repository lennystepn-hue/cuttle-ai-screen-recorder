import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProject } from '@cuttle/project';
import { createCursorTrack, createTimeline } from '../src/index';

const screenSize = { width: 2560, height: 1440 };

function project(look: Record<string, unknown> = { transition: { enabled: false } }): CuttleProject {
  const result = parseProject({
    version: 1,
    sources: { screen: 's.mp4' },
    look,
    scenes: [
      { type: 'clip', from: 10, to: 20 },
      { type: 'clip', from: 20, to: 140, speed: 12 },
      { type: 'card', title: 'End', duration: 2 },
    ],
    zooms: [{ at: 12, duration: 4, rect: [0, 0, 1280, 720] }],
    masks: [{ from: 0, to: 15, rect: [0, 0, 50, 50] }],
    texts: [{ at: 11, duration: 2, text: 'Hi' }],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

describe('createTimeline', () => {
  const timeline = createTimeline(project(), { screenSize });

  it('knows the total duration and the spans', () => {
    expect(timeline.duration).toBe(22);
    expect(timeline.spans).toHaveLength(3);
  });

  it('maps output time into the first clip with masks and no badge', () => {
    const [layer] = timeline.frameAt(4).layers;
    expect(layer).toMatchObject({ index: 0, kind: 'clip', sourceTime: 14, opacity: 1, badge: undefined });
    expect(layer?.masks).toHaveLength(1);
    expect(layer?.zoom).toEqual([0, 0, 1280, 720]);
  });

  it('eases the zoom and fades the text in source time', () => {
    const zoom = timeline.frameAt(2.3).layers[0]?.zoom;
    expect(zoom?.[2]).toBeCloseTo(1920, 6);
    expect(zoom?.[3]).toBeCloseTo(1080, 6);
    expect(timeline.frameAt(1.125).layers[0]?.texts[0]?.opacity).toBe(0.5);
    expect(timeline.frameAt(6).layers[0]?.masks).toEqual([]);
  });

  it('maps the sped-up clip with its badge and a full-frame zoom', () => {
    const [layer] = timeline.frameAt(15).layers;
    expect(layer).toMatchObject({ index: 1, kind: 'clip', sourceTime: 80, badge: '12× speed' });
    expect(layer?.zoom).toEqual([0, 0, 2560, 1440]);
  });

  it('reports card scenes with progress and no clip fields', () => {
    const [layer] = timeline.frameAt(21).layers;
    expect(layer).toMatchObject({ index: 2, kind: 'card', progress: 0.5, masks: [], texts: [] });
    expect(layer?.sourceTime).toBeUndefined();
    expect(layer?.zoom).toBeUndefined();
  });

  it('clamps time to the timeline', () => {
    expect(timeline.frameAt(-5).t).toBe(0);
    const end = timeline.frameAt(100);
    expect(end.t).toBe(22);
    expect(end.layers[0]).toMatchObject({ index: 2, progress: 1 });
  });

  it('treats a non-finite time as the start', () => {
    expect(timeline.frameAt(NaN)).toEqual(timeline.frameAt(0));
  });

  it('returns no layers for a project without scenes', () => {
    const empty = parseProject({ version: 1, sources: { screen: 's.mp4' } });
    if (!empty.ok) throw new Error('fixture');
    const t = createTimeline(empty.project, { screenSize });
    expect(t.duration).toBe(0);
    expect(t.frameAt(1)).toEqual({ t: 0, layers: [] });
  });

  it('adds the cursor to clip layers when enabled and a track is given', () => {
    const cursor = createCursorTrack([
      { t: 13, type: 'move', x: 0, y: 0 },
      { t: 15, type: 'move', x: 200, y: 100 },
    ]);
    const withCursor = createTimeline(project(), { screenSize, cursor });
    expect(withCursor.frameAt(4).layers[0]?.cursor).toEqual({ x: 100, y: 50, shape: 'arrow', clicks: [] });
    expect(withCursor.frameAt(21).layers[0]?.cursor).toBeUndefined();
    expect(timeline.frameAt(4).layers[0]?.cursor).toBeUndefined();

    const hidden = createTimeline(project({ transition: { enabled: false }, cursor: { enabled: false } }), {
      screenSize,
      cursor,
    });
    expect(hidden.frameAt(4).layers[0]?.cursor).toBeUndefined();
  });
});

describe('crossfades', () => {
  const timeline = createTimeline(project({ transition: { enabled: true, duration: 0.4 } }), { screenSize });

  it('shows one layer away from boundaries', () => {
    expect(timeline.frameAt(5).layers).toHaveLength(1);
  });

  it('blends the outgoing and incoming scenes around a boundary', () => {
    const before = timeline.frameAt(9.9).layers;
    expect(before.map((l) => l.index)).toEqual([0, 1]);
    expect(before[0]?.opacity).toBeCloseTo(0.75, 6);
    expect(before[1]?.opacity).toBeCloseTo(0.25, 6);
    expect(before[1]?.sourceTime).toBe(20);

    const after = timeline.frameAt(10.1).layers;
    expect(after.map((l) => l.index)).toEqual([0, 1]);
    expect(after[0]?.opacity).toBeCloseTo(0.25, 6);
    expect(after[0]?.sourceTime).toBe(20);
    expect(after[1]?.opacity).toBeCloseTo(0.75, 6);
  });
});

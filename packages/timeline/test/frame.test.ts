import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProject } from '@cuttle/project';
import { createCursorTrack, createTimeline } from '../src/index';

const screenSize = { width: 2560, height: 1440 };

function project(
  look: Record<string, unknown> = { transition: { enabled: false } },
  overrides: Record<string, unknown> = {},
): CuttleProject {
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
    ...overrides,
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

  it('eases the zoom and fades the text in output time', () => {
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

  it('treats NaN as the start', () => {
    expect(timeline.frameAt(NaN)).toEqual(timeline.frameAt(0));
    expect(timeline.frameAt(Infinity).t).toBe(22);
    expect(timeline.frameAt(-Infinity).t).toBe(0);
  });

  it('rejects a screen size that is not positive and finite', () => {
    const message = 'createTimeline: screenSize must have a positive, finite width and height';
    expect(() => createTimeline(project(), { screenSize: { width: 0, height: 1440 } })).toThrow(message);
    expect(() => createTimeline(project(), { screenSize: { width: NaN, height: 1440 } })).toThrow(message);
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

  it('drops the click effects but keeps position and shape when clickEffect is none', () => {
    const cursor = createCursorTrack([
      { t: 13, type: 'move', x: 0, y: 0 },
      { t: 13.9, type: 'click', x: 100, y: 100, button: 'left' },
      { t: 15, type: 'move', x: 200, y: 100 },
    ]);
    // output 4 s is source 14 s, 0.1 s into the 0.4 s click effect
    const ripple = createTimeline(project(), { screenSize, cursor }).frameAt(4).layers[0]?.cursor;
    expect(ripple?.clicks).toHaveLength(1);

    const none = createTimeline(project({ transition: { enabled: false }, cursor: { clickEffect: 'none' } }), {
      screenSize,
      cursor,
    }).frameAt(4).layers[0]?.cursor;
    expect(none).toEqual({ x: ripple?.x, y: ripple?.y, shape: ripple?.shape, clicks: [] });
  });
});

describe('crossfades', () => {
  // The second clip starts a second after the first ends: a cut, not a continuous one.
  const JUMP = [
    { type: 'clip', from: 10, to: 20 },
    { type: 'clip', from: 21, to: 141, speed: 12 },
    { type: 'card', title: 'End', duration: 2 },
  ];
  const timeline = createTimeline(project({ transition: { enabled: true, duration: 0.4 } }, { scenes: JUMP }), { screenSize });

  it('shows one layer away from boundaries', () => {
    expect(timeline.frameAt(5).layers).toHaveLength(1);
  });

  it('blends the outgoing and incoming scenes around a boundary', () => {
    const before = timeline.frameAt(9.9).layers;
    expect(before.map((l) => l.index)).toEqual([0, 1]);
    expect(before[0]?.opacity).toBeCloseTo(0.75, 6);
    expect(before[1]?.opacity).toBeCloseTo(0.25, 6);
    expect(before[1]?.sourceTime).toBe(21);

    const after = timeline.frameAt(10.1).layers;
    expect(after.map((l) => l.index)).toEqual([0, 1]);
    expect(after[0]?.opacity).toBeCloseTo(0.25, 6);
    expect(after[0]?.sourceTime).toBeCloseTo(20 - 1 / 30, 9);
    expect(after[1]?.opacity).toBeCloseTo(0.75, 6);
  });

  it('keeps masks that end at the clip end active on the outgoing layer', () => {
    const masked = createTimeline(
      project(
        { transition: { enabled: true, duration: 0.4 } },
        {
          scenes: JUMP,
          masks: [
            { from: 0, to: 15, rect: [0, 0, 50, 50] },
            { from: 10, to: 20, rect: [0, 0, 50, 50] },
          ],
        },
      ),
      { screenSize },
    );
    for (const t of [9.9, 10.1]) {
      const outgoing = masked.frameAt(t).layers[0];
      expect(outgoing?.index).toBe(0);
      expect(outgoing?.masks.map((mask) => [mask.from, mask.to])).toEqual([[10, 20]]);
    }
  });

  it('holds a trailing clip inside its source range at the very end', () => {
    const clipLast = parseProject({
      version: 1,
      sources: { screen: 's.mp4' },
      scenes: [{ type: 'clip', from: 0, to: 5 }],
    });
    if (!clipLast.ok) throw new Error('fixture');
    const t = createTimeline(clipLast.project, { screenSize });
    const sourceTime = t.frameAt(t.duration).layers[0]?.sourceTime;
    expect(sourceTime).toBeLessThan(5);
    expect(sourceTime).toBeCloseTo(5 - 1 / 30, 9);
  });

  it('holds the last frame shown when the clip ends between two frames', () => {
    const offGrid = parseProject({
      version: 1,
      sources: { screen: 's.mp4' },
      scenes: [
        { type: 'clip', from: 0, to: 1.01 },
        { type: 'card', title: 'End', duration: 1 },
      ],
    });
    if (!offGrid.ok) throw new Error('fixture');
    const t = createTimeline(offGrid.project, { screenSize });
    // At 30 fps, frame 30 (t = 1.0) is the last one inside [0, 1.01); frames 31 to 34 crossfade.
    const times = [29, 30, 31, 32, 34].map((frame) => t.frameAt(frame / 30).layers.find((l) => l.index === 0)?.sourceTime);
    expect(times).toEqual([29 / 30, 1, 1, 1, 1]);
  });

  /** Source times of scene 0's layer on every output frame, and whether a mask was on in each. */
  function walkClip(scenes: unknown[], fps: number, masks: unknown[] = []) {
    const parsed = parseProject({ version: 1, output: { fps }, sources: { screen: 's.mp4' }, scenes, masks });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const t = createTimeline(parsed.project, { screenSize });
    const frames: { time: number; masked: boolean }[] = [];
    for (let i = 0; i < Math.ceil(t.duration * fps); i++) {
      const layer = t.frameAt(i / fps).layers.find((l) => l.index === 0);
      if (layer?.sourceTime !== undefined) frames.push({ time: layer.sourceTime, masked: layer.masks.length > 0 });
    }
    return frames;
  }

  it('never shows a sped-up clip at its end time, where a mask that ends with the clip is off', () => {
    // 2 s at 3× is 0.6666… s, rounded up to the microsecond: frame 20 at 0.6666… s still falls inside the span.
    for (const speed of [3, 6, 1.5]) {
      const frames = walkClip(
        [{ type: 'clip', from: 0, to: 2, speed }, { type: 'card', title: 'End', duration: 1 }],
        30,
        [{ from: 0, to: 2, rect: [0, 0, 50, 50] }],
      );
      expect(frames.every((frame) => frame.time < 2 && frame.masked), `speed ${speed}`).toBe(true);
    }
  });

  it('never goes back in source time at frame rates that do not divide a second evenly', () => {
    // At 29 fps the clip's end lands 1e-6 above frame 54 · 1/29, which is still drawn inside the clip.
    const frames = walkClip([{ type: 'clip', from: 10, to: 11.862069 }, { type: 'card', title: 'End', duration: 1 }], 29);
    for (let i = 1; i < frames.length; i++) expect(frames[i]!.time, `frame ${i}`).toBeGreaterThanOrEqual(frames[i - 1]!.time);
  });

  it('caps the crossfade by the shortest neighbouring scene', () => {
    const short = createTimeline(
      project(
        { transition: { enabled: true, duration: 2 } },
        { scenes: [{ type: 'clip', from: 0, to: 10 }, { type: 'card', title: 'End', duration: 0.2 }] },
      ),
      { screenSize },
    );
    // half = min(1, 5, 0.1) = 0.1
    expect(short.frameAt(10 - 0.05).layers).toHaveLength(2);
    expect(short.frameAt(10 - 0.15).layers).toHaveLength(1);
  });

  it('fades into a card without clip fields on the incoming layer', () => {
    const [outgoing, incoming] = timeline.frameAt(19.9).layers;
    expect(outgoing).toMatchObject({ index: 1, kind: 'clip' });
    expect(incoming).toMatchObject({ index: 2, kind: 'card', masks: [], texts: [] });
    expect(incoming?.sourceTime).toBeUndefined();
    expect(incoming?.zoom).toBeUndefined();
    expect((outgoing?.opacity ?? 0) + (incoming?.opacity ?? 0)).toBeCloseTo(1, 9);
  });
});

describe('continuous cuts', () => {
  const look = { transition: { enabled: true, duration: 0.4 } };
  // One piece of footage: 0–5 at 1×, 5–25 at 4× (output 5–10), 25–30 at 1× (output 10–15).
  const scenes = [
    { type: 'clip', from: 0, to: 5 },
    { type: 'clip', from: 5, to: 25, speed: 4 },
    { type: 'clip', from: 25, to: 30 },
  ];
  const timeline = createTimeline(project(look, { scenes, zooms: [], masks: [], texts: [] }), { screenSize });

  it('shows one layer at a continuous cut, without a crossfade', () => {
    for (const t of [4.9, 5, 5.1, 9.9, 10, 10.1]) expect(timeline.frameAt(t).layers, `t ${t}`).toHaveLength(1);
  });

  it('moves on in source time on every frame across the cuts: nothing held or frozen', () => {
    const times = Array.from({ length: 330 }, (_, i) => timeline.frameAt(4 + i / 30).layers[0]?.sourceTime ?? NaN);
    for (let i = 1; i < times.length; i++) expect(times[i], `frame ${i}`).toBeGreaterThan(times[i - 1]!);
  });

  it('still crossfades where the source jumps', () => {
    const jump = createTimeline(project(look, { scenes: [{ type: 'clip', from: 0, to: 5 }, { type: 'clip', from: 5.5, to: 10 }] }), { screenSize });
    expect(jump.frameAt(5).layers).toHaveLength(2);
  });
});

describe('overlay ramps in output time', () => {
  const look = { transition: { enabled: true, duration: 0.4 } };
  // 0–5 at 1×, then the same footage on at 4× (output 5–10).
  const scenes = [
    { type: 'clip', from: 0, to: 5 },
    { type: 'clip', from: 5, to: 25, speed: 4 },
  ];
  const zoomRect = [0, 0, 1280, 720];
  const width = (timeline: ReturnType<typeof createTimeline>, t: number): number => timeline.frameAt(t).layers[0]?.zoom?.[2] ?? NaN;

  it('runs a zoom across a speed change without a jump', () => {
    // source 4.7–8.7 shows at output 4.7–5.925: one occurrence, ramps of 0.6 output seconds
    const timeline = createTimeline(project(look, { scenes, zooms: [{ at: 4.7, duration: 4, rect: zoomRect }], masks: [], texts: [] }), { screenSize });
    expect(width(timeline, 5)).toBeCloseTo(1920, 6);
    const widths = Array.from({ length: 19 }, (_, i) => width(timeline, 4.7 + i / 30));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i], `frame ${i}`).toBeLessThanOrEqual(widths[i - 1]!);
      // no step is bigger than the ease's steepest (slope 3, halfway) over one frame of the 0.6 s ramp
      expect(widths[i - 1]! - widths[i]!, `frame ${i}`).toBeLessThanOrEqual((1280 * 3) / (30 * 0.6) + 1e-6);
    }
  });

  it('lands fully zoomed where a cut jumps into the middle of a zoom', () => {
    // the zoom is source 10–16; the second clip starts at 12, inside it
    const timeline = createTimeline(
      project(look, { scenes: [{ type: 'clip', from: 0, to: 5 }, { type: 'clip', from: 12, to: 20 }], zooms: [{ at: 10, duration: 6, rect: zoomRect }], masks: [], texts: [] }),
      { screenSize },
    );
    expect(timeline.frameAt(5).layers[1]?.zoom).toEqual(zoomRect);
    expect(width(timeline, 5.3)).toBe(1280);
    // and ramps out where its end shows: output 9, 0.3 s before it halfway
    expect(width(timeline, 8.7)).toBeCloseTo(1920, 6);
  });

  it('fades a text in output seconds across a speed change', () => {
    // source 4–5.4 shows at output 4–5.1: the fade-out starts at 4.85, on the 1× side
    const timeline = createTimeline(project(look, { scenes, zooms: [], masks: [], texts: [{ at: 4, duration: 1.4, text: 'Hi' }] }), { screenSize });
    const opacity = (t: number): number => timeline.frameAt(t).layers[0]?.texts[0]?.opacity ?? NaN;
    expect(opacity(4.8)).toBe(1);
    expect(opacity(4.95)).toBeCloseTo(0.6, 9);
    expect(opacity(5)).toBeCloseTo(0.4, 9);
    expect(opacity(5.05)).toBeCloseTo(0.2, 9);
  });

  it('ramps a zoom over a split exactly as over the unsplit clip', () => {
    const zooms = [{ at: 4.5, duration: 1, rect: zoomRect }];
    const whole = createTimeline(project(look, { scenes: [{ type: 'clip', from: 0, to: 10 }], zooms, masks: [], texts: [] }), { screenSize });
    const split = createTimeline(
      project(look, { scenes: [{ type: 'clip', from: 0, to: 5 }, { type: 'clip', from: 5, to: 10 }], zooms, masks: [], texts: [] }),
      { screenSize },
    );
    for (let frame = 120; frame < 180; frame++) {
      expect(split.frameAt(frame / 30).layers).toHaveLength(1);
      expect(width(split, frame / 30), `frame ${frame}`).toBeCloseTo(width(whole, frame / 30), 6);
    }
  });
});

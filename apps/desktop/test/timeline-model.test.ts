import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProjectInput, type InputEvent } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import { formatBytes, formatDuration, formatSpeed, formatTime } from '../src/shared/format';
import { activityColumns, groupPins, outputTimesOf, timelineModel, waveformColumns } from '../src/shared/timeline-model';

function project(input: Partial<CuttleProjectInput>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

// 0–3 at 1× (output 0–3), 3–8 at 4× (3–4.25), a jump to 8.5–11.5 (4.25–7.25), a still, a card.
const demo = project({
  scenes: [
    { type: 'clip', label: 'Prompt', from: 0, to: 3 },
    { type: 'clip', from: 3, to: 8, speed: 4 },
    { type: 'clip', from: 8.5, to: 11.5 },
    { type: 'still', image: 'stills/page.png', duration: 2, motion: 'scroll' },
    { type: 'card', title: 'The end', duration: 1.5 },
  ],
  zooms: [{ at: 8.8, duration: 2.5, rect: [0, 0, 100, 100], label: 'Answer' }],
  masks: [
    { from: 0, to: 9, rect: [0, 0, 10, 10] },
    { from: 8.1, to: 8.4, rect: [0, 0, 10, 10], enabled: false },
  ],
  texts: [{ at: 0.5, duration: 2, text: 'One prompt' }],
});
const spans = sceneSpans(demo.scenes);

describe('timelineModel', () => {
  const model = timelineModel(demo, spans, [
    { t: 2.5, kind: 'prompt' },
    { t: 4, kind: 'tool', label: 'Bash' },
    { t: 8.2, kind: 'tool', label: 'Read' },
    { t: 9, kind: 'answer' },
  ]);

  it('lays the scenes out in output seconds, named by label or by what they are', () => {
    expect(model.duration).toBe(10.75);
    expect(model.scenes.map((scene) => [scene.kind, scene.start, scene.end, scene.title, scene.detail])).toEqual([
      ['clip', 0, 3, 'Prompt', '3 s'],
      ['clip', 3, 4.25, 'Sped up', '4× · 5 s → 1.3 s'],
      ['clip', 4.25, 7.25, 'Clip', '3 s'],
      ['still', 7.25, 9.25, 'page.png', '2 s · scroll'],
      ['card', 9.25, 10.75, 'The end', '1.5 s'],
    ]);
  });

  it('draws an overlay once per stretch of output that shows it and counts what no clip shows', () => {
    expect(model.lanes.mask.blocks.map((block) => [block.start, block.end, block.enabled])).toEqual([
      [0, 4.25, true],
      [4.25, 4.75, true],
    ]);
    expect(model.lanes.mask.cutOut).toBe(1);
    const [zoom] = model.lanes.zoom.blocks;
    expect([zoom?.start, zoom?.end, zoom?.title]).toEqual([expect.closeTo(4.55, 9), expect.closeTo(7.05, 9), 'Answer']);
    expect(model.lanes.caption.blocks.map((block) => block.title)).toEqual(['One prompt']);
  });

  it('pins markers where a clip shows them; a cut-out marker has no pin', () => {
    expect(model.markers.map((pin) => [pin.t, pin.kind])).toEqual([
      [2.5, 'prompt'],
      [3.25, 'tool'],
      [4.75, 'answer'],
    ]);
  });
});

describe('outputTimesOf and groupPins', () => {
  it('finds a source second in every clip that shows it', () => {
    const repeated = sceneSpans(project({ scenes: [{ type: 'clip', from: 0, to: 4 }, { type: 'clip', from: 2, to: 6, speed: 2 }] }).scenes);
    expect(outputTimesOf(repeated, 3)).toEqual([3, 4.5]);
    expect(outputTimesOf(repeated, 7)).toEqual([]);
  });

  it('merges tool calls that crowd, never prompts or answers', () => {
    const groups = groupPins(
      [
        { t: 1, source: 1, kind: 'tool' },
        { t: 1.2, source: 1.2, kind: 'tool' },
        { t: 1.3, source: 1.3, kind: 'answer' },
        { t: 5, source: 5, kind: 'tool' },
      ],
      0.5,
    );
    expect(groups.map((group) => [group.t, group.kind, group.pins.length])).toEqual([
      [1, 'tool', 2],
      [1.3, 'answer', 1],
      [5, 'tool', 1],
    ]);
  });
});

describe('activity and waveform columns', () => {
  it('counts input in output time, sped-up input denser, and scales to the busiest column', () => {
    const events: InputEvent[] = [
      { t: 1, type: 'click', x: 0, y: 0, button: 'left' },
      { t: 4, type: 'keys', count: 3 },
      { t: 4.1, type: 'move', x: 1, y: 1 },
      { t: 8.2, type: 'click', x: 0, y: 0, button: 'left' },
      { t: 0.5, type: 'shape', shape: 'text' },
    ];
    // the click at 1 s in column 1; keys and a move in the 4× clip (output 3.25) in column 3; the
    // click at 8.2 s is cut out
    expect(activityColumns(events, spans, 0, 5, 5)).toEqual([0, 1 / 3.25, 0, 1, 0]);
    expect(activityColumns([], spans, 0, 5, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('takes the loudest peak of the source each column plays and leaves muted clips silent', () => {
    // one peak per 1/10 s of the mic, which started 1 s after the screen: peak i is source 1 + i / 10
    const data = new Uint8Array(120).map((_, i) => (i === 25 ? 255 : 51));
    const peaks = { rate: 10, offset: 1, data };
    const muted = (speed: number) => speed > 1;
    const columns = waveformColumns(peaks, spans, 0, 5, 5, muted);
    // output 0–1 is source 0–1, before the mic: silent; 3–4 is the muted 4× clip
    expect(columns).toEqual([0, 0.2, 0.2, 0, 0.2]);
    // source 3.5 (peak 25) plays in output 3–4 at 4×: heard when sped-up clips are not muted
    expect(waveformColumns(peaks, spans, 0, 5, 5, () => false)[3]).toBe(1);
  });
});

describe('format', () => {
  it('writes times, lengths, speeds and sizes for people', () => {
    expect([0, 9.99, 42.55, 754.2, 3723].map(formatTime)).toEqual(['0:00.0', '0:09.9', '0:42.5', '12:34.2', '1:02:03.0']);
    expect([0.42, 9.96, 12.4, 125, 3720].map(formatDuration)).toEqual(['0.4 s', '10 s', '12 s', '2 min 5 s', '1 h 2 min']);
    expect([12, 1.25, 1].map(formatSpeed)).toEqual(['12×', '1.3×', '1×']);
    expect([2048, 13_002_342, 2.5 * 1024 ** 3].map(formatBytes)).toEqual(['2 KB', '12.4 MB', '2.5 GB']);
  });
});

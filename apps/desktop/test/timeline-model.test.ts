import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProjectInput, type InputEvent } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import { formatBytes, formatDuration, formatSource, formatSpeed, formatTime, locateJsonIssue, plainIssue } from '../src/shared/format';
import { activityColumns, exportChecks, groupPins, outputTimesOf, pinGroupDetail, pinGroupName, timelineModel, waveformColumns } from '../src/shared/timeline-model';

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
      ['clip', 3, 4.25, '', '5 s → 1.2 s'],
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
    expect(model.lanes.mask.cutOutItems).toHaveLength(1);
    const [zoom] = model.lanes.zoom.blocks;
    expect([zoom?.start, zoom?.end, zoom?.title]).toEqual([expect.closeTo(4.55, 9), expect.closeTo(7.05, 9), 'Answer']);
    expect(model.lanes.caption.blocks.map((block) => block.title)).toEqual(['One prompt']);
  });

  it('lists what is worth a second look before an export', () => {
    expect(exportChecks(demo, spans)).toEqual(['1 mask is off: what it covers shows in the video.', '1 mask is cut out: no clip shows it.']);
    const quick = project({
      scenes: [
        { type: 'clip', from: 0, to: 4, speed: 4 },
        { type: 'clip', from: 4, to: 6 },
      ],
      texts: [
        { at: 0, duration: 2, text: 'Fast' },
        { at: 9, duration: 1, text: 'Gone', label: 'Late' },
      ],
      zooms: [{ at: 7, duration: 1, rect: [0, 0, 10, 10] }],
      look: { audio: { muteSpedUp: false } },
    });
    expect(exportChecks(quick, sceneSpans(quick.scenes))).toEqual([
      '1 zoom and 1 caption are cut out: no clip shows them.',
      'Caption "Fast" is on screen for only 0.5 s.',
      'Clips at another speed keep the pitch of their sound in the export; the preview plays them higher or lower.',
    ]);
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

  it('names a group after its tool, or counts the calls when the tools differ', () => {
    const tool = (t: number, label: string) => ({ t, source: t, kind: 'tool' as const, label });
    const [same] = groupPins([tool(1, 'Bash'), tool(1.1, 'Bash')], 1);
    const [mixed] = groupPins([tool(1, 'Read'), tool(1.1, 'Bash'), tool(1.2, 'Read')], 1);
    expect([pinGroupName(same!), pinGroupName(mixed!)]).toEqual(['Bash ×2', '3 tool calls']);
    expect(pinGroupDetail(mixed!)).toBe('Read 2 · Bash 1');
  });

  it('puts overlays that overlap in time on separate rows of their lane', () => {
    const packing = project({
      scenes: [{ type: 'clip', from: 0, to: 20 }],
      masks: [
        { from: 0, to: 20, rect: [0, 0, 1, 1] },
        { from: 2, to: 4, rect: [0, 0, 1, 1] },
        { from: 3, to: 5, rect: [0, 0, 1, 1] },
        { from: 4, to: 6, rect: [0, 0, 1, 1] },
        { from: 4.5, to: 6, rect: [0, 0, 1, 1] },
      ],
    });
    const lane = timelineModel(packing, sceneSpans(packing.scenes)).lanes.mask;
    expect(lane.blocks.map((block) => [block.start, block.row])).toEqual([
      [0, 0],
      [2, 1],
      [3, 2],
      [4, 1],
      [4.5, 2],
    ]);
    expect(lane.rows).toBe(3);
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
    // cut off at tenths as times are, so a video of 0:10.7 is 10.7 s long
    expect([0.42, 9.96, 10.75, 12, 59.97, 125, 3720].map(formatDuration)).toEqual(['0.4 s', '9.9 s', '10.7 s', '12 s', '59.9 s', '2 min 5 s', '1 h 2 min']);
    expect([54.47, 152.4].map(formatSource)).toEqual(['54.4 s into the take', '2:32.4 into the take']);
    expect([12, 1.25, 1].map(formatSpeed)).toEqual(['12×', '1.3×', '1×']);
    expect([2048, 13_002_342, 2.5 * 1024 ** 3].map(formatBytes)).toEqual(['2 KB', '12.4 MB', '2.5 GB']);
  });

  it('says what is wrong with a cuttle.json in plain lines', () => {
    expect(plainIssue("(root): Invalid JSON: Expected ',' or '}' after property value in JSON at position 42 (line 1 column 43)")).toBe('It is not valid JSON at line 1, column 43.');
    expect(plainIssue('(root): Unsupported version 2')).toBe('Unsupported version 2');
    // what this Electron's V8 says, with the line found in the file
    const text = '{\n  "version": 1,\n  "scenes": [ }';
    const message = locateJsonIssue(`Invalid JSON: Unexpected token '}', ..."cenes": [ }" is not valid JSON`, text);
    expect(plainIssue(`(root): ${message}`)).toBe('It is not valid JSON: "}" where it does not belong (line 3).');
    expect(plainIssue('(root): Invalid JSON: Unexpected end of JSON input')).toBe('It is not valid JSON: it ends too early (a closing bracket or quote is missing).');
    expect(plainIssue('scenes.2.to: Too small')).toBe('scenes.2.to: Too small');
  });
});

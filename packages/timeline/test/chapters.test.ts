import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProjectInput, type Marker } from '@cuttle/project';
import { chapterTime, stepChapters, youtubeChapters } from '../src/chapters';
import { sceneSpans } from '../src/time';

const script = [
  { id: 'step1', title: 'Open the settings' },
  { id: 'step2', title: 'Turn on dark mode' },
  { id: 'step3', title: 'Export the video' },
];
const project = (rest: Partial<CuttleProjectInput>) => {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, script, ...rest });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
};
const at = (...moves: [number, string][]): Marker[] => moves.map(([t, label]) => ({ t, kind: 'step', label }));
const chaptersOf = (rest: Partial<CuttleProjectInput>, markers: Marker[]) => {
  const p = project(rest);
  return stepChapters(p.script, markers, sceneSpans(p.scenes, p.cuts));
};

describe('stepChapters', () => {
  it('starts a chapter where the take reached each step, in output seconds, the first at 0 and the last to the end', () => {
    // an intro card, the take trimmed at the start and sped up in the middle
    const scenes = [
      { type: 'card' as const, title: 'Hi', duration: 2 },
      { type: 'clip' as const, from: 1, to: 20 },
      { type: 'clip' as const, from: 20, to: 50, speed: 3 },
    ];
    expect(chaptersOf({ scenes }, at([0, 'step1'], [12, 'step2'], [35, 'step3']))).toEqual([
      { at: 0, end: 13, title: 'Open the settings', step: 'step1' },
      { at: 13, end: 26, title: 'Turn on dark mode', step: 'step2' },
      { at: 26, end: 31, title: 'Export the video', step: 'step3' },
    ]);
  });

  it('leaves out a move undone right away, and starts a chapter again for a step reached again later', () => {
    const scenes = [{ type: 'clip' as const, from: 0, to: 60 }];
    // the key pressed too early at 20 and undone at 21 (step 3 begins at 22), and back to step 2 on purpose at 40
    const markers = at([0, 'step1'], [10, 'step2'], [20, 'step3'], [21, 'step2'], [22, 'step3'], [40, 'step2'], [50, 'step3']);
    expect(chaptersOf({ scenes }, markers).map((chapter) => [chapter.at, chapter.step])).toEqual([
      [0, 'step1'],
      [10, 'step2'],
      [22, 'step3'],
      [40, 'step2'],
      [50, 'step3'],
    ]);
  });

  it('starts a step the video leaves out where it goes on, the last of several there; a step the script lost makes none', () => {
    const scenes = [{ type: 'clip' as const, from: 0, to: 60 }];
    // 8 to 30 is cut: steps 2 and 3 both begin there, and the video shows step 3 from 8 on
    expect(chaptersOf({ scenes, cuts: [{ from: 8, to: 30 }] }, at([0, 'step1'], [10, 'step2'], [20, 'step3'], [45, 'step9'])).map((chapter) => [chapter.at, chapter.step])).toEqual([
      [0, 'step1'],
      [8, 'step3'],
    ]);
    expect(chaptersOf({ scenes }, [])).toEqual([]);
    // a script without the take's steps: no chapters
    expect(chaptersOf({ scenes, script: [] }, at([0, 'step1']))).toEqual([]);
  });
});

describe('youtubeChapters', () => {
  it('writes a line per chapter, and says when YouTube would not show them', () => {
    const chapters = [
      { at: 0, end: 12.5, title: 'Open the settings', step: 'step1' },
      { at: 12.5, end: 19, title: 'Turn on dark mode', step: 'step2' },
      { at: 19, end: 3725, title: 'Export the video', step: 'step3' },
    ];
    expect(youtubeChapters(chapters)).toEqual({
      text: '0:00 Open the settings\n0:12 Turn on dark mode\n0:19 Export the video',
      problems: ['YouTube needs each chapter to last 10 s or more; shorter: “Turn on dark mode” (6.5 s).'],
    });
    expect(youtubeChapters(chapters.slice(0, 1)).problems[0]).toBe('YouTube shows chapters from 3 on; this video has 1.');
    expect([chapterTime(0), chapterTime(65.9), chapterTime(3725)]).toEqual(['0:00', '1:05', '1:02:05']);
  });
});

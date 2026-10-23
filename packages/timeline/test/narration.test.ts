import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import { narrationCues, narrationWords } from '../src/narration';

function project(input: Pick<CuttleProjectInput, 'scenes' | 'voiceover'>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

const voice = { provider: 'local' as const, id: 'en_US-amy-medium' };

describe('the narration on the video', () => {
  it('places a line in its scene, or where the clips first show its second, in order; leaves out the ones nothing shows', () => {
    const narrated = project({
      scenes: [
        { type: 'card', id: 'intro', title: 'Hi', duration: 2 },
        { type: 'clip', id: 'c1', from: 10, to: 20 },
        { type: 'clip', id: 'c2', from: 12, to: 14, speed: 2 },
      ],
      voiceover: {
        voice,
        lines: [
          { id: 'v1', text: 'in the take', at: 13 },
          { id: 'v2', text: 'in the intro', at: 0.5, scene: 'intro' },
          { id: 'v3', text: 'cut away', at: 30 },
          { id: 'v4', text: 'past its scene', at: 3, scene: 'intro' },
          { id: 'v5', text: 'off', at: 11, enabled: false },
        ],
      },
    });
    const { cues, left } = narrationCues(narrated);
    // 13 s of the take shows first in c1 (2 + 3 = 5 s of the video), not in its sped-up repeat
    expect(cues.map((cue) => [cue.line.id, cue.at])).toEqual([
      ['v2', 0.5],
      ['v1', 5],
    ]);
    expect(left).toEqual([2, 3]);
  });

  it("moves each line's words to where it plays", () => {
    const narrated = project({ scenes: [{ type: 'card', id: 'a', title: 'A', duration: 5 }], voiceover: { voice, lines: [{ id: 'v1', text: 'one two', at: 1.5, scene: 'a' }] } });
    const { cues } = narrationCues(narrated);
    expect(narrationWords(cues, () => [{ t: 0.1, end: 0.4, text: 'one' }, { t: 0.5, end: 0.9, text: 'two' }])).toEqual([
      { t: 1.6, end: 1.9, text: 'one' },
      { t: 2, end: 2.4, text: 'two' },
    ]);
    expect(narrationWords(cues, () => undefined)).toEqual([]);
  });
});

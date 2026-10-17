import { describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import type { ProjectFile } from '../src/project-file';
import { useTake } from '../src/use-take';

/** A project file as read, with the edit of its first take. */
function fileWith(raw: Record<string, unknown>): ProjectFile {
  const parsed = parseProject(raw);
  if (!parsed.ok) throw new Error('invalid');
  return { dir: '/demo', path: '/demo/cuttle.json', raw: structuredClone(raw), project: parsed.project };
}

const first = {
  version: 1,
  sources: { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a', transcript: 'takes/1/transcript.json' },
  scenes: [{ type: 'clip', from: 0, to: 10 }],
  cuts: [{ id: 'c1', from: 2, to: 2.4, auto: 'filler' }],
};

describe('useTake', () => {
  it("drops the previous take's cuts (and its transcript) with its other edits", () => {
    const file = fileWith(first);
    const hadEdit = useTake(file, { screen: 'takes/2/screen.mp4', mic: 'takes/2/mic.m4a', seconds: 8 });
    expect(hadEdit).toBe(true);
    expect(file.raw).toEqual({ version: 1, sources: { screen: 'takes/2/screen.mp4', mic: 'takes/2/mic.m4a' }, scenes: [{ type: 'clip', from: 0, to: 8 }] });
  });

  it('counts cuts alone as an edit, and keeps them and the transcript for the same take (recover)', () => {
    const file = fileWith({ ...first, scenes: [] });
    expect(useTake(fileWith({ version: 1, sources: first.sources, cuts: first.cuts }), { screen: 'takes/1/screen.mp4', seconds: 10 })).toBe(true);
    useTake(file, { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a', transcript: 'takes/1/transcript.json', seconds: 10 }, true);
    expect(file.raw.cuts).toEqual(first.cuts);
    expect((file.raw.sources as { transcript?: string }).transcript).toBe('takes/1/transcript.json');
  });
});

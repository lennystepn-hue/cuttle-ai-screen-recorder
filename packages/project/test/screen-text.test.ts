import { describe, expect, it } from 'vitest';
import { parseScreenTextJsonl } from '../src/index';

describe('parseScreenTextJsonl', () => {
  it('reads a frame per line: its lines with their words and rects', () => {
    const frame = { t: 1.5, lines: [{ text: 'Signed in as a@b.de', rect: [40, 60, 220, 18], words: [{ text: 'Signed', rect: [40, 60, 50, 18] }, { text: 'a@b.de', rect: [200, 60, 60, 18] }] }] };
    expect(parseScreenTextJsonl(`${JSON.stringify(frame)}\n\n${JSON.stringify({ t: 2, lines: [] })}\n`)).toEqual({ frames: [frame, { t: 2, lines: [] }], issues: [] });
  });

  it('reports a broken line and an invalid frame by their line numbers', () => {
    const result = parseScreenTextJsonl('{"t":1,"lines":[]}\n{"t":2,"lin\n{"t":-1,"lines":[]}\n');
    expect(result.frames).toHaveLength(1);
    expect(result.issues.map((issue) => issue.path)).toEqual(['line 2', 'line 3.t']);
  });
});

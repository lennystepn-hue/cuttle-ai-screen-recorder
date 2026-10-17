import { describe, expect, it } from 'vitest';
import { parseEventsJsonl } from '../src/index';

describe('parseEventsJsonl', () => {
  it('parses one event per line and skips blank lines', () => {
    const text = '{"t":0,"type":"move","x":1,"y":2}\n\n{"t":0.5,"type":"click","x":3,"y":4,"button":"left"}\n';
    expect(parseEventsJsonl(text)).toEqual({
      events: [
        { t: 0, type: 'move', x: 1, y: 2 },
        { t: 0.5, type: 'click', x: 3, y: 4, button: 'left' },
      ],
      issues: [],
    });
  });

  it('drops a cut-off last line without an issue', () => {
    const text = '{"t":0,"type":"move","x":1,"y":2}\n{"t":0.1,"type":"mo';
    expect(parseEventsJsonl(text)).toEqual({ events: [{ t: 0, type: 'move', x: 1, y: 2 }], issues: [] });
  });

  it('reports broken lines in the middle and invalid events with their line number', () => {
    const text = '{"t":0,"type":"move","x":1,"y":2}\n{"t":0.1,"type":"mo\n{"t":-1,"type":"keys","count":2}\n';
    const result = parseEventsJsonl(text);
    expect(result.events).toHaveLength(1);
    expect(result.issues.map((issue) => issue.path)).toEqual(['line 2', 'line 3.t']);
  });

  it('reads where text is typed: the caret', () => {
    expect(parseEventsJsonl('{"t":1.5,"type":"caret","rect":[812,440,2,19]}\n').events).toEqual([{ t: 1.5, type: 'caret', rect: [812, 440, 2, 19] }]);
    expect(parseEventsJsonl('{"t":1.5,"type":"caret","x":812,"y":440}\n').issues.map((issue) => issue.path)).toEqual(['line 1.rect', 'line 1']);
  });

  it('accepts Windows line endings and a last line without a newline', () => {
    const text = '{"t":0,"type":"keys","count":1}\r\n{"t":1,"type":"shape","shape":"text"}';
    expect(parseEventsJsonl(text).events).toEqual([
      { t: 0, type: 'keys', count: 1 },
      { t: 1, type: 'shape', shape: 'text' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { isFact, parseEventsJsonl, type InputEvent } from '../src/index';

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

  it('reads the content area (or none) and the windows over the screen, facts like the shape and the caret', () => {
    const text = ['{"t":0.2,"type":"area","rect":[65,147,2495,1233]}', '{"t":4,"type":"area","rect":null}', '{"t":5,"type":"window","id":4242,"kind":"dialog","rect":[600,350,600,300],"open":true}'].join('\n');
    const { events, issues } = parseEventsJsonl(text);
    expect(issues).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(['area', 'area', 'window']);
    expect(parseEventsJsonl('{"t":5,"type":"window","id":1,"kind":"tooltip","rect":[0,0,9,9],"open":true}').issues.map((issue) => issue.path)).toEqual(['line 1.kind']);
    const others: InputEvent[] = [{ t: 1, type: 'shape', shape: 'text' }, { t: 1, type: 'caret', rect: [1, 1, 2, 9] }];
    expect([...events, ...others].every(isFact)).toBe(true);
    expect(isFact({ t: 1, type: 'keys', count: 2 })).toBe(false);
  });

  it('accepts Windows line endings and a last line without a newline', () => {
    const text = '{"t":0,"type":"keys","count":1}\r\n{"t":1,"type":"shape","shape":"text"}';
    expect(parseEventsJsonl(text).events).toEqual([
      { t: 0, type: 'keys', count: 1 },
      { t: 1, type: 'shape', shape: 'text' },
    ]);
  });
});

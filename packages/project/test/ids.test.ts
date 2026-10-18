import { describe, expect, it } from 'vitest';
import { newId, usedIds } from '../src/ids';

describe('usedIds', () => {
  it('collects the ids of scenes and overlays, written or parsed, and skips the rest', () => {
    const raw = {
      scenes: [{ type: 'clip', id: 's1' }, { type: 'card' }, null, 'junk'],
      zooms: [{ id: 'answer' }],
      masks: 'not a list',
      texts: [{ id: 7 }],
    };
    expect([...usedIds(raw)]).toEqual(['s1', 'answer']);
    expect([...usedIds({ ...raw, sounds: [{ id: 'a1' }, { sound: 'pop' }] })]).toEqual(['s1', 'answer', 'a1']);
    expect(usedIds({})).toEqual(new Set());
  });
});

describe('newId', () => {
  it('takes the smallest free number after the list prefix and marks it taken', () => {
    const taken = new Set(['s1', 's3', 'z1']);
    expect(newId('scenes', taken)).toBe('s2');
    expect(newId('scenes', taken)).toBe('s4');
    expect(newId('zooms', taken)).toBe('z2');
    expect(newId('masks', taken)).toBe('m1');
    expect(newId('texts', taken)).toBe('t1');
    expect(newId('sounds', taken)).toBe('a1');
    expect(taken).toEqual(new Set(['s1', 's2', 's3', 's4', 'z1', 'z2', 'm1', 't1', 'a1']));
  });
});

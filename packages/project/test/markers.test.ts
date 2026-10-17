import { describe, expect, it } from 'vitest';
import { parseMarkersJson } from '../src/index';

const file = {
  version: 1,
  markers: [
    { t: 0.5, kind: 'prompt' },
    { t: 2.25, kind: 'tool', label: 'Bash' },
    { t: 7, kind: 'answer' },
    { t: 8, kind: 'manual', label: 'nice bit' },
    { t: 9.5, kind: 'retake' },
  ],
};

describe('parseMarkersJson', () => {
  it('reads every marker kind', () => {
    expect(parseMarkersJson(JSON.stringify(file))).toEqual({ ok: true, markers: file.markers });
  });

  it('names the path of an invalid field', () => {
    const result = parseMarkersJson(JSON.stringify({ version: 1, markers: [{ t: -1, kind: 'tool' }] }));
    expect(result).toEqual({ ok: false, issues: [{ path: 'markers[0].t', message: expect.any(String) }] });
  });

  it('rejects an unknown kind and an unknown field', () => {
    const result = parseMarkersJson(JSON.stringify({ version: 1, markers: [{ t: 1, kind: 'note', text: 'x' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path).sort()).toEqual(['markers[0]', 'markers[0].kind']);
  });

  it('reports invalid JSON and accepts a byte order mark', () => {
    expect(parseMarkersJson('{').ok).toBe(false);
    expect(parseMarkersJson(String.fromCharCode(0xfeff) + JSON.stringify(file)).ok).toBe(true);
  });
});

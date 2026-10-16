import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, defaultProject, formatPath, parseProject, parseProjectJson } from '../src/index';

describe('formatPath', () => {
  it('formats paths like JavaScript property access', () => {
    expect(formatPath(['scenes', 1, 'to'])).toBe('scenes[1].to');
    expect(formatPath(['look', 'frame'])).toBe('look.frame');
    expect(formatPath([])).toBe('(root)');
  });
});

describe('parseProject', () => {
  it('returns the project when it is valid', () => {
    const r = parseProject({ version: 1, sources: { screen: 's.mp4' } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.sources.screen).toBe('s.mp4');
  });

  it('returns readable issues when it is invalid', () => {
    const r = parseProject({ version: 1, sources: { screen: 's.mp4' }, scenes: [{ type: 'clip', from: 5, to: 2 }] });
    expect(r).toEqual({ ok: false, issues: [{ path: 'scenes[0].to', message: '"to" must be greater than "from"' }] });
  });

  it('refuses files written by a newer Cuttle', () => {
    const r = parseProject({ version: CURRENT_VERSION + 1, sources: { screen: 's.mp4' } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.path).toBe('version');
      expect(r.issues[0]?.message).toContain(`version ${CURRENT_VERSION + 1}`);
    }
  });

  it('does not tell the user to update Cuttle for a fractional version', () => {
    const r = parseProject({ version: 1.5, sources: { screen: 's.mp4' } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.issues.find((i) => i.path === 'version');
      expect(issue).toBeDefined();
      expect(issue?.message).not.toContain('Update Cuttle');
    }
  });

  it('reports a missing version', () => {
    const r = parseProject({ sources: { screen: 's.mp4' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toContain('version');
  });
});

describe('parseProjectJson', () => {
  it('reports invalid JSON', () => {
    const r = parseProjectJson('{ nope');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.path).toBe('(root)');
      expect(r.issues[0]?.message).toMatch(/^Invalid JSON/);
    }
  });

  it('parses valid JSON', () => {
    const r = parseProjectJson('{"version":1,"sources":{"screen":"s.mp4"}}');
    expect(r.ok).toBe(true);
  });

  it('accepts a byte order mark, as Windows editors write one', () => {
    expect(parseProjectJson(`${String.fromCharCode(0xfeff)}{"version":1,"sources":{"screen":"s.mp4"}}`).ok).toBe(true);
  });
});

describe('defaultProject', () => {
  it('is valid, empty and uses the default screen path', () => {
    const p = defaultProject();
    expect(p.sources.screen).toBe('takes/1/screen.mp4');
    expect(p.scenes).toEqual([]);
    expect(p.look.background.preset).toBe('sunset-sky');
    expect(parseProject(p).ok).toBe(true);
  });
});

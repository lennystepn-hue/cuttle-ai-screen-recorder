import { describe, expect, it } from 'vitest';
import { parseShot, parseShotJson, shotRatio } from '../src/shot';

describe('shot.json', () => {
  it('fills in a framed shot from its image alone: rounded, with a shadow, on the default background, pixel for pixel', () => {
    const parsed = parseShot({ version: 1, source: 'source.png' });
    expect(parsed.ok && parsed.shot).toEqual({
      version: 1,
      source: 'source.png',
      scale: 1,
      padding: 64,
      size: 'auto',
      background: { preset: 'sunset-sky' },
      transparent: false,
      frame: { style: 'none', title: '', radius: 12, shadow: true },
    });
  });

  it('takes a size as auto, a ratio or pixels, and names what it cannot read', () => {
    for (const size of ['auto', '16:9', '1.91:1', { width: 1200, height: 630 }]) expect(parseShot({ version: 1, source: 's.png', size }).ok, JSON.stringify(size)).toBe(true);
    for (const size of ['big', '16:0', '0:9', { width: 8, height: 630 }, { width: 1200.5, height: 630 }]) {
      const parsed = parseShot({ version: 1, source: 's.png', size });
      expect(parsed.ok, JSON.stringify(size)).toBe(false);
      if (!parsed.ok) expect(parsed.issues[0]!.path).toMatch(/^size/);
    }
    expect(shotRatio('16:9')).toBeCloseTo(16 / 9);
    expect(shotRatio('auto')).toBeUndefined();
  });

  it('reads a file with a byte order mark, and says where its JSON breaks', () => {
    expect(parseShotJson('﻿{"version":1,"source":"source.png"}').ok).toBe(true);
    const broken = parseShotJson('{"version":1,');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.issues[0]!.message).toMatch(/Invalid JSON/);
    const unknown = parseShot({ version: 1, source: 's.png', frame: { style: 'tv' } });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.issues[0]!.path).toBe('frame.style');
  });
});

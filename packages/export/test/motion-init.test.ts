import { parseProject } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { formatName, motionInit, motionSeed, motionTheme } from '../src/motion/init';

function project(input: Record<string, unknown> = {}) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

describe('motion pages are told', () => {
  it('the look as CSS variables: the accent, a tone of the background, the fonts', () => {
    expect(motionTheme(project())).toEqual({
      '--cuttle-accent': '#D97757',
      '--cuttle-bg': '#1b1c4a',
      '--cuttle-fg': '#ffffff',
      '--cuttle-font': '"Inter", "Segoe UI", system-ui, sans-serif',
      '--cuttle-mono': '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    });
    const solid = motionTheme(project({ look: { background: { preset: 'solid', color: '#102030' }, cursor: { color: '#00ff88' } } }));
    expect(solid).toMatchObject({ '--cuttle-accent': '#00ff88', '--cuttle-bg': '#102030' });
  });

  it('the format by its shape, or its size', () => {
    expect(formatName({ width: 1920, height: 1080 })).toBe('16:9');
    expect(formatName({ width: 1080, height: 1920 })).toBe('9:16');
    expect(formatName({ width: 1080, height: 1080 })).toBe('1:1');
    expect(formatName({ width: 1440, height: 900 })).toBe('1440x900');
  });

  it('a seed of their own: the same for an item every time, another for another item', () => {
    expect(motionSeed('s1')).toBe(motionSeed('s1'));
    expect(motionSeed('s1')).not.toBe(motionSeed('s2'));
    expect(Number.isInteger(motionSeed('o1')) && motionSeed('o1') >= 0 && motionSeed('o1') < 2 ** 32).toBe(true);
  });

  it('their length, the output, their params, and a seed from their id (else their place)', () => {
    const p = project({ output: { width: 1080, height: 1920, fps: 60 }, scenes: [{ type: 'motion', src: 'a.html', duration: 2, params: { title: 'Hi' } }] });
    const scene = p.scenes[0]!;
    if (scene.type !== 'motion') throw new Error('not a motion scene');
    expect(motionInit(p, scene, 'scenes[0]', 2)).toEqual({
      duration: 2,
      fps: 60,
      width: 1080,
      height: 1920,
      format: '9:16',
      params: { title: 'Hi' },
      theme: motionTheme(p),
      seed: motionSeed('scenes[0]'),
    });
    expect(motionInit(p, { ...scene, id: 's7' }, 'scenes[0]', 2).seed).toBe(motionSeed('s7'));
  });
});

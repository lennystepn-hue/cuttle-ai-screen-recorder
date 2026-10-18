import { describe, expect, it } from 'vitest';
import { backgroundTone, parseBrandKitJson } from '../src/index';

const kit = {
  version: 1,
  name: 'Acme',
  theme: { name: 'Acme', logo: 'logo.png', accent: '#3366FF', font: 'Fraunces' },
  look: { background: { preset: 'solid', color: '#0A0A14' }, frame: { style: 'mac-light' }, cursor: { style: 'ring', color: '#3366FF' } },
};

describe('brand kits', () => {
  it('read a kit, its theme with the defaults filled in', () => {
    const parsed = parseBrandKitJson(`\uFEFF${JSON.stringify(kit)}`);
    expect(parsed).toEqual({ ok: true, kit: { ...kit, theme: { ...kit.theme, foreground: '#FFFFFF' } } });
  });

  it('refuse a kit without a name, with a kit of its own, or with a solid background without its colour', () => {
    const issues = (value: unknown) => {
      const parsed = parseBrandKitJson(JSON.stringify(value));
      return parsed.ok ? [] : parsed.issues.map((issue) => issue.path);
    };
    expect(issues({ ...kit, name: ' ' })).toEqual(['name']);
    expect(issues({ ...kit, theme: { ...kit.theme, kit: 'Acme' } })).toEqual(['theme']);
    expect(issues({ ...kit, look: { ...kit.look, background: { preset: 'solid' } } })).toEqual(['look.background.color']);
    expect(parseBrandKitJson('{')).toMatchObject({ ok: false, issues: [{ path: '(root)' }] });
  });

  it('give pages a tone of the background to draw on', () => {
    expect(backgroundTone({ preset: 'solid', color: '#102030' })).toBe('#102030');
    expect(backgroundTone({ preset: 'aurora' })).toBe('#050816');
  });
});

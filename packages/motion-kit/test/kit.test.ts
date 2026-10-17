import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KIT_FONTS, KIT_IMPORTS, KIT_ORIGIN, MOTION_TEMPLATES, importMapTag, withImportMap } from '../src/index';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));

describe('the motion kit', () => {
  it('maps the bare names a page imports to the kit', () => {
    expect(KIT_IMPORTS).toEqual({
      three: 'cuttle-motion://kit/three/three.module.js',
      'three/addons/': 'cuttle-motion://kit/three/addons/',
      cuttle: 'cuttle-motion://kit/motion.js',
      'lottie-web': 'cuttle-motion://kit/lottie/lottie.mjs',
    });
    expect(KIT_FONTS.every((font) => font.src.startsWith(`${KIT_ORIGIN}/fonts/`))).toBe(true);
    expect([...new Set(KIT_FONTS.map((font) => font.family))]).toEqual(['Inter', 'JetBrains Mono', 'Archivo', 'Space Grotesk', 'Bebas Neue', 'Fraunces', 'Instrument Serif']);
  });

  it('puts the import map first in a page, after its doctype', () => {
    const map = importMapTag();
    expect(map).toBe(`<script type="importmap">${JSON.stringify({ imports: KIT_IMPORTS })}</script>`);
    expect(withImportMap('<!doctype html>\n<h1>Hi</h1>')).toBe(`<!doctype html>${map}\n<h1>Hi</h1>`);
    expect(withImportMap('\uFEFF<!DOCTYPE html><p>')).toBe(`\uFEFF<!DOCTYPE html>${map}<p>`);
    expect(withImportMap('<h1>Hi</h1>')).toBe(`${map}<h1>Hi</h1>`);
  });

  it('has a page for every template, and each says when it is one (a scene or an overlay)', () => {
    expect(MOTION_TEMPLATES.map((template) => template.name)).toEqual(['title', 'end-card', 'code-typing', 'lower-third', 'click-callouts', 'kinetic-captions']);
    for (const template of MOTION_TEMPLATES) {
      const file = `${TEMPLATES}${template.name}/index.html`;
      expect(existsSync(file), template.name).toBe(true);
      expect(readFileSync(file, 'utf8'), template.name).toMatch(/^<!doctype html>/);
      expect(template.whole === true || template.duration > 0, template.name).toBe(true);
    }
  });
});

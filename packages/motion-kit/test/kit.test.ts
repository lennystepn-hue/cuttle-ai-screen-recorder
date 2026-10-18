import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copyTemplate, MissingTemplateError } from '../src/files';
import { KIT_FONTS, KIT_IMPORTS, KIT_ORIGIN, MOTION_TEMPLATES, MUSIC_TEMPLATES, importMapTag, withImportMap } from '../src/index';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));

describe('the motion kit', () => {
  it('maps the bare names a page imports to the kit', () => {
    expect(KIT_IMPORTS).toEqual({
      three: 'cuttle-motion://kit/three/three.module.js',
      'three/addons/': 'cuttle-motion://kit/three/addons/',
      cuttle: 'cuttle-motion://kit/motion.js',
      'cuttle/sound': 'cuttle-motion://kit/sound.js',
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

  it('has a page for every music template that composes with cuttle.music and declares its params', () => {
    expect(MUSIC_TEMPLATES.map((template) => template.name)).toEqual(['pulse', 'drift', 'lofi', 'bright', 'cinematic']);
    for (const template of MUSIC_TEMPLATES) {
      const html = readFileSync(`${TEMPLATES}music-${template.name}/index.html`, 'utf8');
      expect(html, template.name).toMatch(/^<!doctype html>/);
      expect(html, template.name).toContain('cuttle.music(');
      expect(html, template.name).toContain("from 'cuttle/sound'");
      const declared = html.split('id="cuttle-params">')[1]?.split('</' + 'script>')[0];
      const params = JSON.parse(declared ?? 'null') as { name: string; type: string }[];
      expect(params.map((param) => param.name), template.name).toContain('bpm');
    }
  });

  it('copies a music template into music/', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-kit-'));
    try {
      expect(await copyTemplate(dir, 'music-pulse', 'pulse', import.meta.url, 'music')).toBe('music/pulse/index.html');
      expect(await copyTemplate(dir, 'music-pulse', 'pulse', import.meta.url, 'music')).toBe('music/pulse-2/index.html');
      expect(existsSync(join(dir, 'motion'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('copies a template into the project, beside a folder of its name already there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-kit-'));
    try {
      // no kit next to this file: the package's own templates
      expect(await copyTemplate(dir, 'title', 'title', import.meta.url)).toBe('motion/title/index.html');
      expect(await copyTemplate(dir, 'title', 'title', import.meta.url)).toBe('motion/title-2/index.html');
      expect(readFileSync(join(dir, 'motion', 'title-2', 'index.html'), 'utf8')).toBe(readFileSync(`${TEMPLATES}title/index.html`, 'utf8'));
      await expect(copyTemplate(dir, 'nope', 'nope', import.meta.url)).rejects.toThrow(MissingTemplateError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

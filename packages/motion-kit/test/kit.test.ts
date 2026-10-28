import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copyTemplate, findIcons, iconWords, MissingTemplateError, templatePage } from '../src/files';
import { BUILT_IN_SOUNDS, KIT_FONTS, KIT_IMPORTS, KIT_ORIGIN, MOTION_TEMPLATES, MUSIC_TEMPLATES, importMapTag, withImportMap } from '../src/index';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));

describe('the motion kit', () => {
  it('maps the bare names a page imports to the kit', () => {
    expect(KIT_IMPORTS).toEqual({
      three: 'cuttle-motion://kit/three/three.module.js',
      'three/addons/': 'cuttle-motion://kit/three/addons/',
      cuttle: 'cuttle-motion://kit/motion.js',
      'cuttle/icons': 'cuttle-motion://kit/icons.js',
      'cuttle/sound': 'cuttle-motion://kit/sound.js',
      'lottie-web': 'cuttle-motion://kit/lottie/lottie.mjs',
      animejs: 'cuttle-motion://kit/anime/anime.esm.min.js',
    });
    expect(KIT_FONTS.every((font) => font.src.startsWith(`${KIT_ORIGIN}/fonts/`))).toBe(true);
    expect([...new Set(KIT_FONTS.map((font) => font.family))]).toEqual([
      'Inter', 'JetBrains Mono', 'Archivo', 'Space Grotesk', 'Bebas Neue', 'Fraunces', 'Instrument Serif',
      'Syne', 'Unbounded', 'Anton', 'Bricolage Grotesque', 'Big Shoulders Display', 'DM Serif Display', 'Playfair Display', 'Space Mono', 'Rubik Mono One', 'Caveat',
    ]);
  });

  it('builds the kit with every file a page reaches: each font, anime.js, the icons, and the licences', async () => {
    const out = mkdtempSync(join(tmpdir(), 'cuttle-kit-'));
    try {
      const built = spawnSync('node', [fileURLToPath(new URL('../scripts/copy.mjs', import.meta.url)), out], { encoding: 'utf8' });
      expect(built.status, built.stderr).toBe(0);
      for (const font of KIT_FONTS) expect(existsSync(join(out, font.src.slice(`${KIT_ORIGIN}/`.length))), font.src).toBe(true);
      for (const url of Object.values(KIT_IMPORTS)) if (!url.endsWith('/')) expect(existsSync(join(out, url.slice(`${KIT_ORIGIN}/`.length))), url).toBe(true);
      for (const licence of ['animejs', 'lucide', 'syne', 'caveat', 'three.js']) expect(existsSync(join(out, 'licenses', `${licence}.txt`)), licence).toBe(true);
      // the icons' shapes as a module that icons.js imports, and their words for motion icons
      const shapes = ((await import(pathToFileURL(join(out, 'icons', 'icons.js')).href)) as { default: Record<string, [string, Record<string, string>][]> }).default;
      expect(Object.keys(shapes).length).toBeGreaterThan(1500);
      expect(shapes.rocket![0]![0]).toBe('path');
      expect(Object.keys(JSON.parse(readFileSync(join(out, 'icons', 'tags.json'), 'utf8')) as object)).toContain('rocket');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);

  it('finds icons by what they show: a word in the name first, then a tag', async () => {
    const icons = { rocket: ['launch', 'space'], 'rocket-launch': ['start'], 'chart-bar': ['statistics', 'diagram'], sparkles: ['launch'] };
    expect(findIcons(icons, ['rocket']).map((icon) => icon.name)).toEqual(['rocket', 'rocket-launch']);
    expect(findIcons(icons, ['launch']).map((icon) => icon.name)).toEqual(['rocket-launch', 'rocket', 'sparkles']);
    // every word has to fit
    expect(findIcons(icons, ['rocket start']).map((icon) => icon.name)).toEqual(['rocket-launch']);
    expect(findIcons(icons, ['banana'])).toEqual([]);
    // the real set, from the dependency in a checkout
    const all = await iconWords(import.meta.url);
    expect(findIcons(all, ['rocket'])[0]!.name).toBe('rocket');
  });

  it('puts the import map first in a page, after its doctype', () => {
    const map = importMapTag();
    expect(map).toBe(`<script type="importmap">${JSON.stringify({ imports: KIT_IMPORTS })}</script>`);
    expect(withImportMap('<!doctype html>\n<h1>Hi</h1>')).toBe(`<!doctype html>${map}\n<h1>Hi</h1>`);
    expect(withImportMap('\uFEFF<!DOCTYPE html><p>')).toBe(`\uFEFF<!DOCTYPE html>${map}<p>`);
    expect(withImportMap('<h1>Hi</h1>')).toBe(`${map}<h1>Hi</h1>`);
  });

  it('has a page for every template, and each says when it is one (a scene, an overlay or a transition)', () => {
    expect(MOTION_TEMPLATES.map((template) => template.name)).toEqual(['title', 'end-card', 'code-typing', 'device-3d', 'fold', 'lower-third', 'click-callouts', 'kinetic-captions']);
    expect(MOTION_TEMPLATES.find((template) => template.name === 'fold')?.kind).toBe('transition');
    for (const template of MOTION_TEMPLATES) {
      const file = `${TEMPLATES}${template.name}/index.html`;
      expect(existsSync(file), template.name).toBe(true);
      expect(readFileSync(file, 'utf8'), template.name).toMatch(/^<!doctype html>/);
      expect(template.whole === true || template.duration > 0, template.name).toBe(true);
    }
  });

  it('makes sounds in the templates that move, built-in ones, behind a sounds param that is on', () => {
    const names = new Set(BUILT_IN_SOUNDS.map(([name]) => name));
    const making: string[] = [];
    for (const template of MOTION_TEMPLATES) {
      const html = readFileSync(`${TEMPLATES}${template.name}/index.html`, 'utf8');
      const asked = [...html.matchAll(/cuttle\.sound\('([^']+)'/g)].map((match) => match[1]!);
      if (asked.length === 0) continue;
      making.push(template.name);
      const declared = html.split('id="cuttle-params">')[1]?.split('</' + 'script>')[0];
      const params = JSON.parse(declared ?? 'null') as { name: string; type: string; default: unknown }[];
      expect(params.find((param) => param.name === 'sounds'), template.name).toMatchObject({ type: 'bool', default: true });
      expect(html, template.name).toContain('params.sounds !== false');
      for (const name of asked) expect(names.has(name), `${template.name}: ${name}`).toBe(true);
    }
    expect(making).toEqual(['title', 'end-card', 'code-typing', 'device-3d', 'fold', 'lower-third', 'click-callouts']);
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

  it("gives the project's page of a template for items that share one: the one there, else a copy", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-kit-'));
    try {
      expect(await templatePage(dir, 'lower-third', import.meta.url)).toBe('motion/lower-third/index.html');
      writeFileSync(join(dir, 'motion', 'lower-third', 'index.html'), 'changed by the person');
      expect(await templatePage(dir, 'lower-third', import.meta.url)).toBe('motion/lower-third/index.html');
      expect(readFileSync(join(dir, 'motion', 'lower-third', 'index.html'), 'utf8')).toBe('changed by the person');
      expect(existsSync(join(dir, 'motion', 'lower-third-2'))).toBe(false);
      expect(await templatePage(dir, 'nope', import.meta.url)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../src/main';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-brand-'));
  dirs.push(dir);
  return dir;
};
// the kits go into a folder of the test's own, never the user's app data
const before = process.env.CUTTLE_BRANDS_DIR;
let brands = '';
beforeAll(() => {
  brands = temp();
  process.env.CUTTLE_BRANDS_DIR = brands;
});
afterAll(async () => {
  if (before === undefined) delete process.env.CUTTLE_BRANDS_DIR;
  else process.env.CUTTLE_BRANDS_DIR = before;
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const projectWith = (fields: Record<string, unknown>) => {
  const dir = temp();
  writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, ...fields }));
  return dir;
};
const project = (dir: string) => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { theme?: Record<string, unknown>; look?: Record<string, unknown> };

async function cli(...argv: string[]) {
  let stdout = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: () => {} });
  return { code, json: JSON.parse(stdout) as Record<string, unknown> };
}

describe('cuttle brand', () => {
  it('saves a project\'s brand, lists it, applies it to another project and removes it', async () => {
    expect((await cli('--json', 'brand', 'list')).json).toEqual({ dir: brands, brands: [] });
    const source = projectWith({
      theme: { name: 'Nimbus', url: 'nimbus.app', logo: 'brand/nimbus.svg', accent: '#7C5CFF', font: 'Fraunces' },
      look: { background: { preset: 'solid', color: '#0E0B1F' }, frame: { style: 'none' }, cursor: { style: 'dot', color: '#7C5CFF' } },
    });
    mkdirSync(join(source, 'brand'));
    writeFileSync(join(source, 'brand', 'nimbus.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const saved = await cli('--json', '-C', source, 'brand', 'save', 'Nimbus');
    expect(saved.code).toBe(0);
    expect(saved.json.brand).toMatchObject({ name: 'Nimbus', dir: join(brands, 'nimbus'), logo: join(brands, 'nimbus', 'logo.svg') });
    const listed = await cli('--json', 'brand');
    expect(listed.json.brands).toEqual([saved.json.brand]);

    const target = projectWith({ look: { frame: { title: 'nimbus · ~/demo' } } });
    const applied = await cli('--json', '-C', target, 'brand', 'apply', 'nimbus');
    expect(applied.code).toBe(0);
    expect(applied.json).toMatchObject({ brand: 'Nimbus', backup: expect.stringContaining('cuttle.json.bak') });
    expect(project(target).theme).toEqual({ name: 'Nimbus', url: 'nimbus.app', logo: 'brand/nimbus-logo.svg', accent: '#7C5CFF', foreground: '#FFFFFF', font: 'Fraunces', kit: 'Nimbus' });
    expect(project(target).look).toEqual({ frame: { title: 'nimbus · ~/demo', style: 'none' }, background: { preset: 'solid', color: '#0E0B1F' }, cursor: { style: 'dot', color: '#7C5CFF' } });
    expect(existsSync(join(target, 'brand', 'nimbus-logo.svg'))).toBe(true);

    expect((await cli('--json', 'brand', 'remove', 'Nimbus')).json).toEqual({ removed: 'Nimbus', dir: join(brands, 'nimbus') });
    expect((await cli('--json', 'brand', 'list')).json.brands).toEqual([]);
  });

  it('refuses what it cannot do', async () => {
    const dir = projectWith({ theme: { logo: 'brand/gone.png' } });
    expect((await cli('--json', '-C', dir, 'brand', 'apply', 'Nope')).json).toMatchObject({ error: { code: 'missing-file' } });
    expect((await cli('--json', '-C', dir, 'brand', 'save', 'Gone')).json).toMatchObject({ error: { code: 'missing-file' } });
    expect((await cli('--json', '-C', dir, 'brand', 'save', ' ')).json).toMatchObject({ error: { code: 'usage' } });
  });
});

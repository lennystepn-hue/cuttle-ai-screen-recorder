import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LOOKS } from '@cuttle/motion-kit';
import { SOURCE_LOOKS } from '@cuttle/motion-kit/files';
import { runCli } from '../src/main';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-look-'));
  dirs.push(dir);
  return dir;
};

async function cli(...argv: string[]) {
  let stdout = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: () => {} });
  return { code, json: JSON.parse(stdout) as Record<string, unknown> };
}

const project = (dir: string) => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { look?: { background?: unknown; transition?: { enabled?: boolean } }; scenes?: { src?: string }[] };

describe('cuttle look', () => {
  it('lists the looks as examples of how a look is made, not a menu', async () => {
    const { code, json } = await cli('--json', 'look', 'list');
    expect(code).toBe(0);
    expect(json.looks).toEqual(LOOKS);
    expect(json.note).toMatch(/not a menu.*look new/s);
  });

  it("writes a look as the project's shared.css and shared.js, its ground around the pages and its hard cuts, and its sample first", async () => {
    const dir = join(temp(), 'reel');
    await cli('--json', 'init', dir);
    const { code, json } = await cli('--json', '-C', dir, 'look', 'apply', 'zine', '--sample');
    expect(code).toBe(0);
    expect(json).toMatchObject({ look: 'zine', files: ['motion/shared.css', 'motion/shared.js', 'motion/zine-sample/index.html'], suggest: { transition: 'glitch', music: 'lofi' } });
    expect(readFileSync(join(dir, 'motion', 'shared.js'), 'utf8')).toBe(readFileSync(join(SOURCE_LOOKS, 'zine', 'shared.js'), 'utf8'));
    expect(project(dir).look).toMatchObject({ background: { preset: 'solid', color: '#eeeae1' }, transition: { enabled: false } });
    expect(project(dir).scenes?.[0]?.src).toBe('motion/zine-sample/index.html');
    // a look that crossfades leaves the transitions as they are
    const calm = join(temp(), 'calm');
    await cli('--json', 'init', calm);
    expect((await cli('--json', '-C', calm, 'look', 'apply', 'editorial')).code).toBe(0);
    expect(project(calm).look?.transition).toBeUndefined();
  });

  it("never replaces the video's own look unasked, and starts one of its own from a frame with nothing decided", async () => {
    const dir = join(temp(), 'own');
    await cli('--json', 'init', dir);
    expect((await cli('--json', '-C', dir, 'look', 'new')).json).toEqual({ files: ['motion/shared.css', 'motion/shared.js'] });
    const own = readFileSync(join(dir, 'motion', 'shared.js'), 'utf8');
    expect(own).toMatch(/export function ground\(/);
    expect(own).toMatch(/export function enter\(/);
    expect(own).toMatch(/export function exit\(/);
    writeFileSync(join(dir, 'motion', 'shared.css'), ':root { --look-ground: #102030; }');
    const refused = await cli('--json', '-C', dir, 'look', 'apply', 'swiss');
    expect(refused.code).toBe(1);
    expect(refused.json).toMatchObject({ error: { code: 'usage' } });
    expect(readFileSync(join(dir, 'motion', 'shared.css'), 'utf8')).toBe(':root { --look-ground: #102030; }');
    expect((await cli('--json', '-C', dir, 'look', 'apply', 'swiss', '--force')).code).toBe(0);
    expect((await cli('--json', '-C', dir, 'look', 'apply', 'nope')).json).toMatchObject({ error: { code: 'usage' } });
  });

  it('has every look in the kit with the same functions for every page, and a sample that uses them', () => {
    for (const look of LOOKS) {
      const js = readFileSync(join(SOURCE_LOOKS, look.name, 'shared.js'), 'utf8');
      for (const name of ['look', 'ground', 'enter', 'exit']) expect(js, `${look.name}: ${name}`).toMatch(new RegExp(`export (const|function) ${name}\\b`));
      expect(existsSync(join(SOURCE_LOOKS, look.name, 'shared.css')), look.name).toBe(true);
      const sample = readFileSync(join(SOURCE_LOOKS, look.name, 'sample.html'), 'utf8');
      expect(sample, look.name).toContain("from '../shared.js'");
      expect(sample, look.name).toContain('href="../shared.css"');
      expect(look.ground, look.name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCommand } from '../src/mcp';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

describe('cuttle annotate', () => {
  it('adds an arrow and the kinds over a rect, each with an id, and refuses a shape that does not fit the kind', async () => {
    const project = join(mkdtempSync(join(tmpdir(), 'cuttle-annotate-')), 'demo');
    dirs.push(project);
    expect((await runCommand(['init', project])).code).toBe(0);
    const arrow = await runCommand(['-C', project, 'annotate', 'arrow', '--at', '2', '--from', '100,700', '--to', '640,400', '--text', 'Click here']);
    expect(arrow.code).toBe(0);
    expect((arrow.result as { annotation: unknown }).annotation).toEqual({ id: 'n1', kind: 'arrow', at: 2, duration: 3, from: [100, 700], to: [640, 400], text: 'Click here' });
    // PowerShell passes x,y,w,h split at the commas
    const lens = await runCommand(['-C', project, 'annotate', 'magnifier', '--at', '4', '--duration', '2', '--rect', '300', '200', '160', '90', '--zoom', '3']);
    expect((lens.result as { annotation: unknown }).annotation).toMatchObject({ id: 'n2', kind: 'magnifier', rect: [300, 200, 160, 90], zoom: 3 });
    expect(JSON.parse(readFileSync(join(project, 'cuttle.json'), 'utf8')).annotations).toHaveLength(2);
    const wrong = await Promise.all([
      runCommand(['-C', project, 'annotate', 'box', '--at', '1', '--from', '1,1', '--to', '2,2']),
      runCommand(['-C', project, 'annotate', 'arrow', '--at', '1', '--rect', '1,1,2,2']),
      runCommand(['-C', project, 'annotate', 'box', '--at', '1', '--rect', '1,1,2']),
      runCommand(['-C', project, 'annotate', 'circle', '--at', '1', '--rect', '1,1,2,2']),
      runCommand(['-C', project, 'annotate', 'box', '--at', '1', '--rect', '1,1,2,2', '--zoom', '2']),
    ]);
    expect(wrong.map((ran) => [ran.code, (ran.result as { error: { code: string } }).error.code])).toEqual(Array.from({ length: 5 }, () => [1, 'usage']));
  });
});

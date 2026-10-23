import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCommand } from '../src/mcp';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

type Zoom = { id: string; moves?: { at: number; rect: number[]; ease?: string }[]; auto?: string };
const zoomOf = (project: string) => (JSON.parse(readFileSync(join(project, 'cuttle.json'), 'utf8')) as { zooms: Zoom[] }).zooms[0]!;

describe('cuttle zoom-path', () => {
  it("lists a zoom's path, adds, places, eases and removes moves, and clears it", async () => {
    const project = join(mkdtempSync(join(tmpdir(), 'cuttle-zoom-path-')), 'demo');
    dirs.push(project);
    expect((await runCommand(['init', project])).code).toBe(0);
    const file = JSON.parse(readFileSync(join(project, 'cuttle.json'), 'utf8')) as Record<string, unknown>;
    file.zooms = [{ id: 'z1', at: 2, duration: 4, rect: [0, 0, 640, 360], moves: [{ at: 3, rect: [200, 0, 640, 360] }], auto: 'typing' }];
    writeFileSync(join(project, 'cuttle.json'), `${JSON.stringify(file, null, 2)}\n`);

    const listed = await runCommand(['-C', project, 'zoom-path', 'z1']);
    expect(listed.result).toEqual({ zoom: 'z1', start: { at: 2, rect: [0, 0, 640, 360] }, moves: [{ at: 3, rect: [200, 0, 640, 360] }] });
    // listing changes nothing: the zoom is still Cuttle's
    expect(zoomOf(project).auto).toBe('typing');

    // a new move, its rect split at the commas as PowerShell passes it
    await runCommand(['-C', project, 'zoom-path', 'z1', '--at', '4.5', '--rect', '400', '200', '640', '360', '--ease', 'jump']);
    expect(zoomOf(project).moves).toEqual([
      { at: 3, rect: [200, 0, 640, 360] },
      { at: 4.5, rect: [400, 200, 640, 360], ease: 'jump' },
    ]);
    expect(zoomOf(project).auto).toBeUndefined();
    // the one at 3 s placed anew and eased; settle again leaves out the field
    await runCommand(['-C', project, 'zoom-path', 'z1', '--at', '3', '--rect', '100,0,640,360', '--ease', 'linear']);
    expect(zoomOf(project).moves![0]).toEqual({ at: 3, rect: [100, 0, 640, 360], ease: 'linear' });
    await runCommand(['-C', project, 'zoom-path', 'z1', '--at', '3', '--ease', 'settle']);
    expect(zoomOf(project).moves![0]).toEqual({ at: 3, rect: [100, 0, 640, 360] });
    await runCommand(['-C', project, 'zoom-path', 'z1', '--at', '3', '--remove']);
    expect(zoomOf(project).moves!.map((move) => move.at)).toEqual([4.5]);

    const wrong = await Promise.all([
      runCommand(['-C', project, 'zoom-path', 'z9']),
      runCommand(['-C', project, 'zoom-path', 'z1', '--rect', '1,1,2,2']),
      runCommand(['-C', project, 'zoom-path', 'z1', '--at', '7', '--rect', '1,1,2,2']),
      runCommand(['-C', project, 'zoom-path', 'z1', '--at', '4', '--ease', 'linear']),
      runCommand(['-C', project, 'zoom-path', 'z1', '--at', '4.5', '--ease', 'bounce']),
      runCommand(['-C', project, 'zoom-path', 'z1', '--at', '3', '--remove']),
      runCommand(['-C', project, 'zoom-path', 'z1', '--clear', '--at', '3']),
    ]);
    expect(wrong.map((ran) => [ran.code, (ran.result as { error: { code: string } }).error.code])).toEqual(Array.from({ length: 7 }, () => [1, 'usage']));

    const cleared = await runCommand(['-C', project, 'zoom-path', 'z1', '--clear']);
    expect(cleared.result).toMatchObject({ changed: 'clear', moves: [] });
    expect(zoomOf(project)).not.toHaveProperty('moves');
  });
});

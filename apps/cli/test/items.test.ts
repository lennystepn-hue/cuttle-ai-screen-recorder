import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCommand } from '../src/mcp';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const read = (project: string) => JSON.parse(readFileSync(join(project, 'cuttle.json'), 'utf8')) as Record<string, { id: string; at?: number; from?: number; to?: number; enabled?: boolean }[]>;

describe('cuttle items', () => {
  it('lists items by kind, maker and stretch, and switches, moves and deletes many in one write', async () => {
    const project = join(mkdtempSync(join(tmpdir(), 'cuttle-items-')), 'demo');
    dirs.push(project);
    expect((await runCommand(['init', project])).code).toBe(0);
    const file = JSON.parse(readFileSync(join(project, 'cuttle.json'), 'utf8')) as Record<string, unknown>;
    const rect = [0, 0, 640, 360];
    Object.assign(file, {
      zooms: [
        { id: 'z1', at: 2, duration: 2, rect, auto: 'click' },
        { id: 'z2', at: 8, duration: 2, rect, auto: 'click' },
        { id: 'z3', at: 12, duration: 3, rect },
      ],
      masks: [{ id: 'm1', from: 5, to: 9, rect, auto: 'privacy' }],
      cuts: [{ id: 'c1', from: 20, to: 22 }],
    });
    writeFileSync(join(project, 'cuttle.json'), `${JSON.stringify(file, null, 2)}\n`);

    const all = await runCommand(['-C', project, 'items']);
    expect((all.result as { items: { id: string }[] }).items.map((item) => item.id)).toEqual(['z1', 'z2', 'z3', 'm1', 'c1']);
    const stretch = await runCommand(['-C', project, 'items', '--between', '7,10']);
    expect((stretch.result as { items: { id: string }[] }).items.map((item) => item.id)).toEqual(['z2', 'm1']);
    // PowerShell passes a list split at the commas
    const kinds = await runCommand(['-C', project, 'items', '--kind', 'zoom', 'cut', '--yours']);
    expect((kinds.result as { items: { id: string }[] }).items.map((item) => item.id)).toEqual(['z3', 'c1']);

    const off = await runCommand(['-C', project, 'items', '--made', 'click', '--off']);
    expect(off.result).toMatchObject({ changed: 'off', items: [{ id: 'z1', enabled: false }, { id: 'z2', enabled: false }] });
    expect(read(project).zooms!.map((zoom) => zoom.enabled)).toEqual([false, false, undefined]);
    await runCommand(['-C', project, 'items', '--ids', 'z2', '--on']);
    expect(read(project).zooms![1]!.enabled).toBeUndefined();

    const moved = await runCommand(['-C', project, 'items', '--kind', 'mask,cut', '--shift', '-1.5']);
    expect(moved.code).toBe(0);
    expect([read(project).masks![0], read(project).cuts![0]].map((item) => [item!.from, item!.to])).toEqual([
      [3.5, 7.5],
      [18.5, 20.5],
    ]);
    // moved, Cuttle's mask is the person's: the next suggest keeps it
    expect(read(project).masks![0]).not.toHaveProperty('auto');

    await runCommand(['-C', project, 'items', '--auto', '--kind', 'zoom', '--delete']);
    expect(read(project).zooms!.map((zoom) => zoom.id)).toEqual(['z3']);

    const wrong = await Promise.all([
      runCommand(['-C', project, 'items', '--delete']),
      runCommand(['-C', project, 'items', '--kind', 'zoom', '--on', '--off']),
      runCommand(['-C', project, 'items', '--kind', 'circle']),
      runCommand(['-C', project, 'items', '--between', '5']),
      runCommand(['-C', project, 'items', '--ids', 'z3', '--shift', '-20']),
      runCommand(['-C', project, 'items', '--ids', 'z9', '--off']),
      runCommand(['-C', project, 'items', '--auto', '--yours']),
    ]);
    expect(wrong.map((ran) => [ran.code, (ran.result as { error: { code: string } }).error.code])).toEqual(Array.from({ length: 7 }, () => [1, 'usage']));
    expect(read(project).zooms!.map((zoom) => zoom.id)).toEqual(['z3']);
  });
});

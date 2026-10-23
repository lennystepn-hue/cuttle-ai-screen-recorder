import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCommand } from '../src/mcp';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

describe('cuttle camera', () => {
  it('shows the camera in a layout for a while, with an id, and refuses a take without a webcam or an unknown layout', async () => {
    const project = join(mkdtempSync(join(tmpdir(), 'cuttle-camera-')), 'demo');
    dirs.push(project);
    expect((await runCommand(['init', project])).code).toBe(0);
    // no webcam in the take yet
    expect((await runCommand(['-C', project, 'camera', 'full', '--at', '0'])).result).toMatchObject({ error: { code: 'invalid-project' } });
    const file = join(project, 'cuttle.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { sources: Record<string, string> };
    writeFileSync(file, JSON.stringify({ ...raw, sources: { ...raw.sources, webcam: 'takes/1/webcam.mp4' } }));
    const intro = await runCommand(['-C', project, 'camera', 'full', '--at', '0', '--duration', '4', '--label', 'Hello']);
    expect(intro.code).toBe(0);
    expect((intro.result as { camera: unknown }).camera).toEqual({ id: 'k1', label: 'Hello', layout: 'full', at: 0, duration: 4 });
    const side = await runCommand(['-C', project, 'camera', 'side', '--at', '12.5']);
    expect((side.result as { camera: unknown }).camera).toEqual({ id: 'k2', layout: 'side', at: 12.5, duration: 3 });
    expect((JSON.parse(readFileSync(file, 'utf8')) as { cameras: unknown[] }).cameras).toHaveLength(2);
    expect((await runCommand(['-C', project, 'camera', 'split', '--at', '1'])).result).toMatchObject({ error: { code: 'usage' } });
  });
});

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCommand } from '../src/mcp';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

describe('cuttle webcam background', () => {
  it('sets what shows behind the person, a colour with color, and leaves the fields out for the room', async () => {
    const project = join(mkdtempSync(join(tmpdir(), 'cuttle-webcam-')), 'demo');
    dirs.push(project);
    expect((await runCommand(['init', project])).code).toBe(0);
    // no webcam in the take yet
    expect((await runCommand(['-C', project, 'webcam', 'background', 'blur'])).result).toMatchObject({ error: { code: 'invalid-project' } });
    const file = join(project, 'cuttle.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { sources: Record<string, string> };
    writeFileSync(file, JSON.stringify({ ...raw, sources: { ...raw.sources, webcam: 'takes/1/webcam.mp4' } }));
    const webcam = () => (JSON.parse(readFileSync(file, 'utf8')) as { look?: { webcam?: Record<string, unknown> } }).look?.webcam ?? {};
    expect((await runCommand(['-C', project, 'webcam', 'background', 'blur'])).result).toEqual({ background: 'blur' });
    expect(webcam()).toEqual({ background: 'blur' });
    expect((await runCommand(['-C', project, 'webcam', 'background', 'color', '--color', '#2a6f4e'])).result).toEqual({ background: 'color', backgroundColor: '#2A6F4E' });
    expect(webcam()).toEqual({ background: 'color', backgroundColor: '#2A6F4E' });
    expect((await runCommand(['-C', project, 'webcam', 'background', 'keep'])).code).toBe(0);
    expect(webcam()).toEqual({});
    expect((await runCommand(['-C', project, 'webcam', 'background', 'green'])).result).toMatchObject({ error: { code: 'usage' } });
    expect((await runCommand(['-C', project, 'webcam', 'background', 'blur', '--color', '#000000'])).result).toMatchObject({ error: { code: 'usage' } });
  });
});

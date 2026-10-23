import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUILT_IN_SOUNDS, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import { runCli } from '../src/main';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-music-'));
  dirs.push(dir);
  writeFileSync(
    join(dir, 'cuttle.json'),
    JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, scenes: [{ type: 'clip', id: 's1', from: 0, to: 10 }, { type: 'card', id: 's2', title: 'Hi', duration: 3 }] }),
  );
  return dir;
};

async function cli(...argv: string[]) {
  let stdout = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: () => {} });
  return { code, json: JSON.parse(stdout) as Record<string, unknown> };
}

const project = (dir: string) => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { music?: Record<string, unknown>; sounds?: Record<string, unknown>[] };

describe('cuttle music', () => {
  it('lists the music templates', async () => {
    const { code, json } = await cli('--json', 'music', 'templates');
    expect(code).toBe(0);
    expect(json.templates).toEqual(MUSIC_TEMPLATES);
  });

  it('copies a template into music/ and makes it the music, keeping the level of the music before', async () => {
    const dir = temp();
    const pulse = await cli('--json', '-C', dir, 'music', 'new', 'pulse');
    expect(pulse.code).toBe(0);
    expect(pulse.json).toEqual({ template: 'pulse', src: 'music/pulse/index.html', music: { src: 'music/pulse/index.html', params: {}, enabled: true } });
    expect(readFileSync(join(dir, 'music', 'pulse', 'index.html'), 'utf8')).toContain('cuttle.music(');
    expect((await cli('--json', '-C', dir, 'music', 'set', '--volume', '0.5', '--param', 'key=E', '--param', 'bpm=118', '--param', 'hits=false')).code).toBe(0);
    expect(project(dir).music).toEqual({ src: 'music/pulse/index.html', params: { key: 'E', bpm: 118, hits: false }, enabled: true, volume: 0.5 });
    // another template: a folder of its own, the level kept, the params its own
    const drift = await cli('--json', '-C', dir, 'music', 'new', 'drift', '--name', 'calm');
    expect(drift.json.src).toBe('music/calm/index.html');
    expect(project(dir).music).toEqual({ src: 'music/calm/index.html', params: {}, enabled: true, volume: 0.5 });
  });

  it('sets the duck, a param away, another page, and on and off', async () => {
    const dir = temp();
    await cli('--json', '-C', dir, 'music', 'new', 'lofi');
    await cli('--json', '-C', dir, 'music', 'set', '--param', 'swing=0.3', '--duck', '18', '--off');
    expect(project(dir).music).toMatchObject({ params: { swing: 0.3 }, duck: 18, enabled: false });
    mkdirSync(join(dir, 'music', 'mine'));
    writeFileSync(join(dir, 'music', 'mine', 'index.html'), '<!doctype html>');
    await cli('--json', '-C', dir, 'music', 'set', '--param', 'swing=', '--src', 'music/mine/index.html', '--on');
    expect(project(dir).music).toMatchObject({ src: 'music/mine/index.html', params: {}, enabled: true });
  });

  it("sets the stems' levels: one silent, one louder, back as composed; refuses a level out of range", async () => {
    const dir = temp();
    await cli('--json', '-C', dir, 'music', 'new', 'pulse');
    await cli('--json', '-C', dir, 'music', 'set', '--stem', 'drums=0', '--stem', 'bass=1.5');
    expect(project(dir).music).toMatchObject({ stems: { drums: 0, bass: 1.5 } });
    // as composed: left out, and with none left the field goes
    await cli('--json', '-C', dir, 'music', 'set', '--stem', 'drums=1', '--stem', 'bass=');
    expect(project(dir).music).not.toHaveProperty('stems');
    expect((await cli('--json', '-C', dir, 'music', 'set', '--stem', 'drums=3')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'music', 'set', '--stem', 'Drums=0.5')).json).toMatchObject({ error: { code: 'usage' } });
  });

  it('refuses what it cannot do', async () => {
    const dir = temp();
    expect((await cli('--json', '-C', dir, 'music', 'new', 'polka')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'music', 'set', '--volume', '0.4')).json).toMatchObject({ error: { code: 'invalid-project' } });
    expect((await cli('--json', '-C', dir, 'music', 'set', '--volume', '1.5')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'music', 'set', '--src', '../x.html')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'music', 'check', '--src', 'music/none.html')).json).toMatchObject({ error: { code: 'missing-file' } });
  });
});

describe('cuttle sound', () => {
  it('lists the built-in sounds', async () => {
    const { code, json } = await cli('--json', 'sound', 'list');
    expect(code).toBe(0);
    expect(json.sounds).toEqual(BUILT_IN_SOUNDS.map(([name, description]) => ({ name, description })));
  });

  it('adds a built-in sound at a source second, and a file of the project into a scene', async () => {
    const dir = temp();
    mkdirSync(join(dir, 'sounds'));
    writeFileSync(join(dir, 'sounds', 'ding.wav'), 'RIFF');
    expect((await cli('--json', '-C', dir, 'sound', 'add', 'whoosh', '--at', '4.5')).json).toEqual({ sound: { id: 'a1', sound: 'whoosh', at: 4.5 } });
    expect((await cli('--json', '-C', dir, 'sound', 'add', './sounds/ding.wav', '--at', '0.5', '--scene', 's2', '--volume', '0.6', '--label', 'Done')).json).toEqual({
      sound: { id: 'a2', label: 'Done', sound: 'sounds/ding.wav', at: 0.5, scene: 's2', volume: 0.6 },
    });
    expect(project(dir).sounds).toHaveLength(2);
  });

  it('refuses an unknown sound, a file outside the project or of another kind, and a scene that is not there', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect((await cli('--json', '-C', dir, 'sound', 'add', 'kazoo', '--at', '1')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'sound', 'add', 'notes.txt', '--at', '1')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'sound', 'add', '../x.wav', '--at', '1')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'sound', 'add', 'pop', '--at', '1', '--scene', 's9')).json).toMatchObject({ error: { code: 'usage' } });
    expect(project(dir).sounds).toBeUndefined();
  });
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadSources } from '../../src/main/sources';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const TAKE = {
  version: 1,
  tracks: {
    screen: { file: 'screen.mp4', start: 100 },
    webcam: { file: 'webcam.mp4', start: 100.5 },
    mic: { file: 'mic.m4a', start: 99.8 },
  },
};

const EVENTS = '{"t":0,"type":"move","x":1,"y":2}\n{"t":1,"type":"click","x":3,"y":4,"button":"left"}\n';

/** A project folder: cuttle.json from `project`, plus `files` (path → content, "" for an empty file). */
async function projectDir(project: Record<string, unknown>, files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cuttle-sources-'));
  dirs.push(dir);
  await writeFile(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, ...project }));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

const SOURCES = { screen: 'take/screen.mp4', webcam: 'take/webcam.mp4', mic: 'take/mic.m4a', events: 'take/events.jsonl' };
const MEDIA = { 'take/screen.mp4': 'v', 'take/webcam.mp4': 'w', 'take/mic.m4a': 'a', 'take/events.jsonl': EVENTS, 'page.png': 'p' };
const SCENES = [
  { type: 'clip', from: 0, to: 1 },
  { type: 'still', image: 'page.png', duration: 1 },
];

describe('loadSources', () => {
  it('resolves the files the look uses and lines the tracks up with take.json', async () => {
    const dir = await projectDir(
      { sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES },
      { ...MEDIA, 'take/take.json': JSON.stringify(TAKE) },
    );
    const sources = await loadSources(dir);
    expect(sources.screen).toBe(join(dir, 'take', 'screen.mp4'));
    expect(sources.webcam?.path).toBe(join(dir, 'take', 'webcam.mp4'));
    expect(sources.webcam?.offset).toBeCloseTo(0.5, 9);
    expect(sources.mic?.offset).toBeCloseTo(-0.2, 9);
    expect(sources.events).toHaveLength(2);
    expect(sources.stills).toEqual({ 1: join(dir, 'page.png') });
  });

  it('leaves out what the look switches off', async () => {
    const dir = await projectDir(
      { sources: SOURCES, look: { webcam: { enabled: false }, audio: { enabled: false }, cursor: { enabled: false } }, scenes: SCENES },
      MEDIA,
    );
    const sources = await loadSources(dir);
    expect(sources.webcam).toBeUndefined();
    expect(sources.mic).toBeUndefined();
    expect(sources.events).toBeUndefined();
  });

  it('takes the tracks as lined up without take.json and ignores entries for other files', async () => {
    const plain = await projectDir({ sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES }, MEDIA);
    expect((await loadSources(plain)).mic?.offset).toBe(0);
    const other = { ...TAKE, tracks: { ...TAKE.tracks, mic: { file: 'other.m4a', start: 99 } } };
    const swapped = await projectDir(
      { sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES },
      { ...MEDIA, 'take/take.json': JSON.stringify(other) },
    );
    const sources = await loadSources(swapped);
    expect(sources.mic?.offset).toBe(0);
    expect(sources.webcam?.offset).toBeCloseTo(0.5, 9);
  });

  it('names a missing or empty media file, but accepts empty events', async () => {
    const noWebcam = Object.fromEntries(Object.entries(MEDIA).filter(([path]) => path !== 'take/webcam.mp4'));
    const missing = await projectDir({ sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES }, noWebcam);
    await expect(loadSources(missing)).rejects.toMatchObject({ code: 'missing-file', message: expect.stringContaining('webcam recording (sources.webcam) not found') });
    const empty = await projectDir({ sources: SOURCES, scenes: SCENES }, { ...MEDIA, 'take/screen.mp4': '' });
    await expect(loadSources(empty)).rejects.toMatchObject({ code: 'invalid-media', message: expect.stringContaining('is empty (0 bytes)') });
    const quiet = await projectDir({ sources: SOURCES, scenes: SCENES }, { ...MEDIA, 'take/events.jsonl': '' });
    expect((await loadSources(quiet)).events).toEqual([]);
  });

  it('reports invalid cuttle.json, take.json and events.jsonl with their paths', async () => {
    const project = await projectDir({ sources: SOURCES, scenes: [{ type: 'clip', from: 2, to: 1 }] }, MEDIA);
    await expect(loadSources(project)).rejects.toMatchObject({ code: 'invalid-project', message: expect.stringContaining('scenes[0].to') });
    const take = await projectDir({ sources: SOURCES, scenes: SCENES }, { ...MEDIA, 'take/take.json': '{"version":1,"tracks":{}}' });
    await expect(loadSources(take)).rejects.toMatchObject({ code: 'invalid-project', message: expect.stringContaining('tracks.screen') });
    const events = await projectDir({ sources: SOURCES, scenes: SCENES }, { ...MEDIA, 'take/events.jsonl': '{"t":-1,"type":"keys","count":1}\n' });
    await expect(loadSources(events)).rejects.toMatchObject({ code: 'invalid-project', message: expect.stringContaining('line 1.t') });
  });

  it('refuses a folder without cuttle.json and a project without scenes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cuttle-sources-'));
    dirs.push(dir);
    await expect(loadSources(dir)).rejects.toMatchObject({ code: 'missing-file', message: expect.stringContaining('no cuttle.json') });
    const empty = await projectDir({ sources: SOURCES, scenes: [] }, MEDIA);
    await expect(loadSources(empty)).rejects.toMatchObject({ code: 'invalid-project', message: expect.stringContaining('has no scenes') });
  });
});

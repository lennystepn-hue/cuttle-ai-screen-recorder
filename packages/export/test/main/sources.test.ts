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

  it('reads the transcript for the captions, and goes on without one it cannot read', async () => {
    const transcript = { version: 1, language: 'de', model: 'small', words: [{ t: 0.2, end: 0.6, text: 'Hallo' }] };
    const dir = await projectDir({ sources: { ...SOURCES, transcript: 'take/transcript.json' }, scenes: SCENES }, { ...MEDIA, 'take/transcript.json': JSON.stringify(transcript) });
    const sources = await loadSources(dir);
    expect(sources.transcript).toEqual(transcript.words);
    // the transcript is one of the project's files: no output may replace it
    expect(sources.inputs).toContain(join(dir, 'take', 'transcript.json'));
    const broken = await projectDir({ sources: { ...SOURCES, transcript: 'take/transcript.json' }, scenes: SCENES }, { ...MEDIA, 'take/transcript.json': '{' });
    const without = await loadSources(broken);
    expect(without.transcript).toBeUndefined();
    expect(without.warnings).toEqual(['take/transcript.json is invalid: no captions']);
    const gone = await projectDir({ sources: { ...SOURCES, transcript: 'take/transcript.json' }, scenes: SCENES }, MEDIA);
    expect((await loadSources(gone)).warnings).toEqual(['take/transcript.json cannot be read: no captions']);
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

  it('lists at most 20 issues, so a broken events.jsonl does not make a huge message', async () => {
    const broken = '{"t":-1,"type":"keys","count":1}\n'.repeat(30);
    const dir = await projectDir({ sources: SOURCES, scenes: SCENES }, { ...MEDIA, 'take/events.jsonl': broken });
    const message = await loadSources(dir).then(
      () => 'no error',
      (error: Error) => error.message,
    );
    expect(message).toContain('line 20.t');
    expect(message).not.toContain('line 21.t');
    expect(message).toContain('… and 10 more');
  });

  it('matches take.json entries with the file system rules, and only for this screen recording', async () => {
    const upper = { ...TAKE, tracks: { ...TAKE.tracks, mic: { file: 'MIC.m4a', start: 99.8 } } };
    const caseDir = await projectDir({ sources: SOURCES, scenes: SCENES }, { ...MEDIA, 'take/take.json': JSON.stringify(upper) });
    const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
    expect((await loadSources(caseDir)).mic?.offset).toBeCloseTo(caseInsensitive ? -0.2 : 0, 9);
    const otherTake = { ...TAKE, tracks: { ...TAKE.tracks, screen: { file: 'older-screen.mp4', start: 100 } } };
    const otherDir = await projectDir(
      { sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES },
      { ...MEDIA, 'take/take.json': JSON.stringify(otherTake) },
    );
    const other = await loadSources(otherDir);
    expect([other.webcam?.offset, other.mic?.offset]).toEqual([0, 0]);
    expect(other.warnings).toEqual([expect.stringContaining('describes another screen recording (older-screen.mp4)')]);
    expect((await loadSources(caseDir)).warnings).toEqual([]);
  });

  it('refuses a folder where a file belongs', async () => {
    const noEvents = Object.fromEntries(Object.entries(MEDIA).filter(([path]) => path !== 'take/events.jsonl'));
    const dir = await projectDir({ sources: SOURCES, scenes: SCENES }, noEvents);
    await mkdir(join(dir, 'take', 'events.jsonl'));
    await expect(loadSources(dir)).rejects.toMatchObject({ code: 'missing-file', message: expect.stringContaining('is a folder, not a file') });
  });

  it('lists every file the export reads, so the output cannot replace one of them', async () => {
    const dir = await projectDir(
      { sources: SOURCES, look: { webcam: { enabled: true } }, scenes: SCENES },
      { ...MEDIA, 'take/take.json': JSON.stringify(TAKE) },
    );
    const { inputs } = await loadSources(dir);
    for (const file of ['cuttle.json', 'take/take.json', 'take/screen.mp4', 'take/webcam.mp4', 'take/mic.m4a', 'take/events.jsonl', 'page.png']) {
      expect(inputs, file).toContain(join(dir, file));
    }
  });

  it('also lists the sources the look switches off: the output must not replace those either', async () => {
    const off = { webcam: { enabled: false }, audio: { enabled: false }, cursor: { enabled: false }, background: { preset: 'sunset-sky', image: 'bg.png' } };
    const dir = await projectDir({ sources: SOURCES, look: off, scenes: SCENES }, MEDIA);
    const { inputs } = await loadSources(dir);
    for (const file of ['take/webcam.mp4', 'take/mic.m4a', 'take/events.jsonl', 'bg.png', 'take/take.json']) {
      expect(inputs, file).toContain(join(dir, file));
    }
  });

  it('refuses a folder without cuttle.json and a project without scenes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cuttle-sources-'));
    dirs.push(dir);
    await expect(loadSources(dir)).rejects.toMatchObject({ code: 'missing-file', message: expect.stringContaining('no cuttle.json') });
    const empty = await projectDir({ sources: SOURCES, scenes: [] }, MEDIA);
    await expect(loadSources(empty)).rejects.toMatchObject({ code: 'invalid-project', message: expect.stringContaining('has no scenes') });
  });
});

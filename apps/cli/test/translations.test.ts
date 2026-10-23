import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCommand } from '../src/mcp';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

type Translation = { language: string; sentences: { at: number; end: number; source: string; text: string }[] };

describe('subtitles in other languages', () => {
  it('writes the sentences to translate, keeps what was translated, takes the file in once it is all written, and puts it in the picture', async () => {
    const project = join(mkdtempSync(join(tmpdir(), 'cuttle-translate-')), 'demo');
    dirs.push(project);
    expect((await runCommand(['init', project])).code).toBe(0);
    mkdirSync(join(project, 'takes', '1'), { recursive: true });
    const words = [
      { t: 0.5, end: 0.8, text: 'Hallo' },
      { t: 0.8, end: 1.3, text: 'zusammen.' },
      { t: 2.6, end: 3.0, text: 'Das' },
      { t: 3.0, end: 3.2, text: 'ist' },
      { t: 3.2, end: 3.8, text: 'Cuttle' },
    ];
    writeFileSync(join(project, 'takes', '1', 'transcript.json'), JSON.stringify({ version: 1, language: 'de', model: 'small', words }));
    const file = join(project, 'cuttle.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { sources: Record<string, string> };
    writeFileSync(file, JSON.stringify({ ...raw, sources: { ...raw.sources, transcript: 'takes/1/transcript.json' } }));

    const started = await runCommand(['-C', project, 'transcript', '--translate', 'en']);
    expect(started.result).toMatchObject({ file: 'subtitles/en.json', language: 'en', sentences: 2, missing: 2 });
    const path = join(project, 'subtitles', 'en.json');
    const translation = JSON.parse(readFileSync(path, 'utf8')) as Translation;
    // a sentence at its end mark, the next after the pause
    expect(translation.sentences).toEqual([
      { at: 0.5, end: 1.3, source: 'Hallo zusammen.', text: '' },
      { at: 2.6, end: 3.8, source: 'Das ist Cuttle', text: '' },
    ]);
    // not all written yet: refused
    translation.sentences[0]!.text = 'Hello everyone.';
    writeFileSync(path, JSON.stringify(translation));
    expect((await runCommand(['-C', project, 'captions', 'set', '--translation', 'en'])).result).toMatchObject({ error: { code: 'invalid-project', message: expect.stringContaining('1 of 2 sentences') } });
    // written again: what was translated stays
    await runCommand(['-C', project, 'transcript', '--translate', 'en']);
    const again = JSON.parse(readFileSync(path, 'utf8')) as Translation;
    expect(again.sentences.map((sentence) => sentence.text)).toEqual(['Hello everyone.', '']);
    again.sentences[1]!.text = 'This is Cuttle';
    writeFileSync(path, JSON.stringify(again));
    const set = await runCommand(['-C', project, 'captions', 'set', '--translation', 'en', '--show', 'en']);
    expect(set.code).toBe(0);
    expect((JSON.parse(readFileSync(file, 'utf8')) as { captions: unknown }).captions).toEqual({ translations: { en: 'subtitles/en.json' }, language: 'en' });
    await runCommand(['-C', project, 'captions', 'set', '--show', 'spoken']);
    expect((JSON.parse(readFileSync(file, 'utf8')) as { captions: { language?: string } }).captions.language).toBeUndefined();
    const wrong = await Promise.all([
      runCommand(['-C', project, 'captions', 'set', '--show', 'fr']),
      runCommand(['-C', project, 'captions', 'set', '--translation', 'fr']),
      runCommand(['-C', project, 'transcript', '--translate', 'English']),
      runCommand(['-C', project, 'captions', 'set']),
    ]);
    expect(wrong.map((ran) => (ran.result as { error: { code: string } }).error.code)).toEqual(['usage', 'missing-file', 'usage', 'usage']);
  });
});

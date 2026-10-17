import { describe, expect, it } from 'vitest';
import { parseProject, parseTranscriptJson } from '../src/index';

const file = {
  version: 1,
  language: 'de',
  model: 'small',
  words: [
    { t: 0.1, end: 0.4, text: 'Das' },
    { t: 0.4, end: 0.79, text: '"Zitat"' },
  ],
  sounds: [{ t: 8.75, end: 8.99 }],
};

describe('parseTranscriptJson', () => {
  it('reads the words and the sounds, with a byte order mark too', () => {
    expect(parseTranscriptJson(JSON.stringify(file))).toEqual({ ok: true, transcript: file });
    expect(parseTranscriptJson(`﻿${JSON.stringify(file)}`).ok).toBe(true);
    const { sounds: _, ...without } = file;
    expect(parseTranscriptJson(JSON.stringify(without))).toEqual({ ok: true, transcript: { ...without, sounds: [] } });
  });

  it('names the path of a word that ends before it starts, and rejects another version', () => {
    const result = parseTranscriptJson(JSON.stringify({ ...file, words: [{ t: 2, end: 1, text: 'x' }] }));
    expect(result).toEqual({ ok: false, issues: [{ path: 'words[0].end', message: '"end" must not be before "t"' }] });
    expect(parseTranscriptJson(JSON.stringify({ ...file, version: 2 })).ok).toBe(false);
    expect(parseTranscriptJson('{').ok).toBe(false);
  });

  it('is linked from the project as a source', () => {
    const result = parseProject({ version: 1, sources: { screen: 'takes/1/screen.mp4', transcript: 'takes/1/transcript.json' } });
    expect(result.ok && result.project.sources.transcript).toBe('takes/1/transcript.json');
  });
});

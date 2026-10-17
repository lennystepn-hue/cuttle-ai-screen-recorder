import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseWhisperCliJson, parseWhisperLines, whisperCliPath } from '../src/speech/whisper';

describe('parseWhisperCliJson', () => {
  it("reads whisper-cli's segments as the filter's lines: words in seconds, notes and empty pieces left out", () => {
    const json = JSON.stringify({
      transcription: [
        { offsets: { from: 0, to: 40 }, text: '' },
        { offsets: { from: 40, to: 570 }, text: ' Hallo,' },
        { offsets: { from: 570, to: 700 }, text: ' das' },
        { offsets: { from: 700, to: 700 }, text: ' [BLANK_AUDIO]' },
        { offsets: { from: 2380, to: 2860 }, text: ' "Mac".' },
      ],
    });
    expect(parseWhisperCliJson(json)).toEqual([
      { t: 0.04, end: 0.57, text: 'Hallo,' },
      { t: 0.57, end: 0.7, text: 'das' },
      { t: 2.38, end: 2.86, text: '"Mac".' },
    ]);
  });

  it('gives the same words as the filter for the same speech', () => {
    const lines = ['{"start":40,"end":570,"text":" Hallo,"}', '{"start":570,"end":700,"text":" das"}'].join('\n');
    const json = JSON.stringify({ transcription: [{ offsets: { from: 40, to: 570 }, text: ' Hallo,' }, { offsets: { from: 570, to: 700 }, text: ' das' }] });
    expect(parseWhisperCliJson(json)).toEqual(parseWhisperLines(lines));
  });

  it('finds nothing in a file that is not its JSON', () => {
    expect(parseWhisperCliJson('')).toEqual([]);
    expect(parseWhisperCliJson('{"transcription": 5')).toEqual([]);
  });
});

describe('whisperCliPath', () => {
  const saved = { cli: process.env.CUTTLE_WHISPER_CLI, path: process.env.PATH };
  afterEach(() => {
    if (saved.cli === undefined) delete process.env.CUTTLE_WHISPER_CLI;
    else process.env.CUTTLE_WHISPER_CLI = saved.cli;
    process.env.PATH = saved.path;
  });

  it('takes CUTTLE_WHISPER_CLI when the file is there, and nothing when it is not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-whisper-cli-'));
    const cli = join(dir, 'my-whisper');
    writeFileSync(cli, '');
    process.env.CUTTLE_WHISPER_CLI = cli;
    expect(whisperCliPath()).toBe(cli);
    process.env.CUTTLE_WHISPER_CLI = join(dir, 'gone');
    expect(whisperCliPath()).toBeUndefined();
  });

  it('finds whisper-cli on PATH', () => {
    delete process.env.CUTTLE_WHISPER_CLI;
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-whisper-path-'));
    const name = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    writeFileSync(join(dir, name), '');
    chmodSync(join(dir, name), 0o755);
    process.env.PATH = dir;
    expect(whisperCliPath()).toBe(join(dir, name));
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { InputEvent, TranscriptWord } from '@cuttle/project';
import { runFfmpeg } from '../src/ffmpeg';
import { streamSeconds } from '../src/suggest/media';
import { suggestClips } from '../src/suggest/plan';
import { alignWords, guessLanguage } from '../src/speech/align';
import { cleanMic, cleanupFilter, denoiseLatency } from '../src/speech/cleanup';
import { likelyFiller, normWord } from '@cuttle/project';
import { fillerCuts, fillerWords, mergeCuts, pauseCuts, restingAt, speechCuts, type SpeechEditInput } from '../src/speech/edits';
import { LEVEL_SECONDS, micLevels, speechStretches } from '../src/speech/levels';
import { downloadFile } from '../src/speech/models';
import { filterValue, parseWhisperLines, type HeardWord } from '../src/speech/whisper';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = (prefix = 'cuttle-speech-') => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const fixtures = join(import.meta.dirname, 'fixtures', 'speech');

describe('the whisper filter', () => {
  it("escapes an option value for both of ffmpeg's levels", () => {
    expect(filterValue('C:\\Users\\me\\ggml-small.bin')).toBe('C\\\\:/Users/me/ggml-small.bin');
    expect(filterValue("D:\\it's [a],b;c")).toBe("D\\\\:/it\\\\\\'s \\[a\\]\\,b\\;c");
    expect(filterValue('de', false)).toBe('de');
  });

  it('takes a path with every special character in a real filter graph', async () => {
    const dir = join(temp(), "a b,c;d [e] it's");
    mkdirSync(dir);
    const out = join(dir, 'meta.txt');
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=duration=0.2', '-af', `ametadata=mode=print:file=${filterValue(out)}`, '-f', 'null', '-']);
    expect(existsSync(out)).toBe(true);
  });

  it('reads its lines by pattern: unescaped quotes, CRLF, notes and punctuation are handled', () => {
    const text = [
      '{"start":100,"end":400,"text":" Das"}',
      '{"start":400,"end":790,"text":""Zitat""}\r',
      '{"start":790,"end":900,"text":"."}',
      '{"start":900,"end":1000,"text":"[BLANK_AUDIO]"}',
      '{"start":1000,"end":1200,"text":"(Musik)"}',
      'not a line',
      '{"start":1200,"end":1100,"text":"Ende."}',
    ].join('\n');
    expect(parseWhisperLines(text)).toEqual([
      { t: 0.1, end: 0.4, text: 'Das' },
      { t: 0.4, end: 0.79, text: '"Zitat"' },
      { t: 1.2, end: 1.2, text: 'Ende.' },
    ]);
    expect(normWord(' Ähm,')).toBe('ähm');
  });
});

/** Loudness values: `floor` dB, with `loud` dB over the given stretches. */
function levels(seconds: number, loud: [number, number][], floor = -60, level = -20): Float32Array {
  const values = new Float32Array(Math.round(seconds / LEVEL_SECONDS)).fill(floor);
  for (const [from, to] of loud) for (let i = Math.round(from / LEVEL_SECONDS); i < Math.round(to / LEVEL_SECONDS); i++) values[i] = level;
  return values;
}

describe('speechStretches', () => {
  it('finds the loud stretches, bridging short gaps and dropping clicks', () => {
    const found = speechStretches(levels(10, [[1, 2], [2.1, 3], [5, 5.03], [6, 7.5]]));
    expect(found).toEqual([
      { from: 1, to: 3 },
      { from: 6, to: 7.5 },
    ]);
  });

  it('finds none in a muted or steady track', () => {
    expect(speechStretches(levels(5, []))).toEqual([]);
    expect(speechStretches(levels(5, [[0, 5]]))).toEqual([]);
    expect(speechStretches(new Float32Array())).toEqual([]);
  });

  it('adapts to the noise floor', () => {
    // a noisy room: floor −35 dB, speech −10 dB
    expect(speechStretches(levels(10, [[2, 4]], -35, -10))).toEqual([{ from: 2, to: 4 }]);
  });
});

const word = (t: number, end: number, text: string): HeardWord => ({ t, end, text });

describe('alignWords', () => {
  it('puts each run of words into the stretch it fits, leaving a short one empty', () => {
    // whisper's times drift by about half a second; the mic says where the speech is
    const heard = [word(0.5, 0.9, 'Das'), word(0.9, 1.6, 'ist'), word(1.6, 2.4, 'Holofish.'), word(4.2, 4.8, 'Die'), word(4.8, 5.6, 'App'), word(5.6, 6.6, 'erkennt')];
    const stretches = [
      { from: 1, to: 2.4 },
      { from: 3, to: 3.4 },
      { from: 4.6, to: 6.4 },
    ];
    const result = alignWords(heard, stretches);
    expect(result.aligned).toBe(true);
    expect(result.words.map((w) => [w.text, w.t])).toEqual([
      ['Das', 1],
      ['ist', 1.329],
      ['Holofish.', 1.659],
      ['Die', 4.6],
      ['App', 5.05],
      ['erkennt', 5.5],
    ]);
    expect(result.sounds).toEqual([{ from: 3, to: 3.4 }]);
    expect(result.dropped).toEqual([]);
  });

  it('gives a likely filler the short stretch of its own that whisper put it beside', () => {
    // the English fixture with the base model: "Um," heard at 7.0–7.54 s, spoken at 7.55–7.84 s
    const heard = parseWhisperLines(readFileSync(join(fixtures, 'en.base.txt'), 'utf8'));
    const stretches = [[0.11, 0.88], [2.02, 2.24], [2.62, 5.22], [7.55, 7.84], [8.22, 9.45], [10.29, 10.83], [11.65, 14], [15.65, 17.98]].map(([from, to]) => ({ from: from!, to: to! }));
    expect(alignWords(heard, stretches).words.find((w) => w.text === 'Um,')?.t).toBe(8.22);
    const result = alignWords(heard, stretches, { filler: (w) => w.text === 'Um,' });
    expect(result.words.find((w) => w.text === 'Um,')).toEqual({ text: 'Um,', t: 7.55, end: 7.84 });
    expect(result.sounds).toEqual([]);
  });

  it('leaves out words heard where the mic is quiet', () => {
    const heard = [word(1, 1.5, 'Hallo'), word(1.5, 2, 'zusammen'), word(30, 31, 'Vielen'), word(31, 32, 'Dank.')];
    const result = alignWords(heard, [{ from: 1, to: 2.2 }]);
    expect(result.words.map((w) => w.text)).toEqual(['Hallo', 'zusammen']);
    expect(result.dropped.map((w) => w.text)).toEqual(['Vielen', 'Dank.']);
  });

  it("keeps whisper's times when there is no stretch, and gives the stretches as sounds when there is no word", () => {
    const heard = [word(1, 2, 'Hallo')];
    expect(alignWords(heard, [])).toEqual({ words: heard, sounds: [], dropped: [], aligned: false });
    expect(alignWords([], [{ from: 1, to: 2 }]).sounds).toEqual([{ from: 1, to: 2 }]);
  });

  it('is fast on an hour of speech', () => {
    const heard: HeardWord[] = [];
    const stretches: { from: number; to: number }[] = [];
    for (let t = 0; t < 3600; t += 4) {
      stretches.push({ from: t, to: t + 3 });
      for (let i = 0; i < 8; i++) heard.push(word(t + 0.3 + i * 0.37, t + 0.6 + i * 0.37, 'wort'));
    }
    const started = performance.now();
    const result = alignWords(heard, stretches);
    expect(result.aligned).toBe(true);
    expect(result.words).toHaveLength(heard.length);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('guesses German or English from common words', () => {
    const says = (text: string) => text.split(' ').map((w, i) => word(i, i + 0.5, w));
    expect(guessLanguage(says('Das ist die App und sie erkennt den Fisch'))).toBe('de');
    expect(guessLanguage(says('This is the app and it zooms on clicks'))).toBe('en');
    expect(guessLanguage(says('Holofish Cuttle'))).toBe('auto');
  });
});

/** Line up whisper's words on the TTS fixtures by the mic, and compare the starts with the truth. */
function startErrors(truth: { t: number; text: string }[], words: { t: number; text: string }[]): number[] {
  const a = truth.filter((w) => normWord(w.text));
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: words.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  const same = (i: number, j: number) => normWord(a[i - 1]!.text) === normWord(words[j - 1]!.text);
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= words.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (same(i, j) ? 0 : 1));
  const errors: number[] = [];
  for (let i = a.length, j = words.length; i > 0 && j > 0; ) {
    if (same(i, j) && d[i]![j] === d[i - 1]![j - 1]) {
      errors.push(Math.abs(a[i - 1]!.t - words[j - 1]!.t));
      i--;
      j--;
    } else if (d[i]![j] === d[i - 1]![j - 1]! + 1) (i--, j--);
    else if (d[i]![j] === d[i - 1]![j]! + 1) i--;
    else j--;
  }
  return errors.sort((x, y) => x - y);
}

describe('the alignment on spoken fixtures', () => {
  for (const [language, filler] of [['de', 8.73], ['en', 7.555]] as const) {
    it(`lines up the small model's words in ${language} and finds the filler it left out`, async () => {
      const heard = parseWhisperLines(readFileSync(join(fixtures, `${language}.small.txt`), 'utf8'));
      const truth = JSON.parse(readFileSync(join(fixtures, `${language}.words.json`), 'utf8')) as { t: number; text: string }[];
      const result = alignWords(heard, speechStretches(await micLevels(join(fixtures, `${language}.m4a`))), { filler: (w) => likelyFiller(w.text, language) });
      const before = startErrors(truth, heard);
      const after = startErrors(truth, result.words);
      const median = (errors: number[]) => errors[Math.floor(errors.length / 2)]!;
      expect(median(before)).toBeGreaterThan(0.2);
      expect(median(after)).toBeLessThan(0.1);
      expect(after[Math.floor(after.length * 0.9)]).toBeLessThan(0.25);
      // the filler whisper did not write is a sound of its own
      expect(result.sounds.some((sound) => Math.abs(sound.from - filler) < 0.1 && sound.to - sound.from < 0.8)).toBe(true);
    });
  }
});

const tw = (t: number, end: number, text: string): TranscriptWord => ({ t, end, text });
const input = (over: Partial<SpeechEditInput>): SpeechEditInput => ({ words: [], sounds: [], language: 'de', still: [{ from: 0, to: 60 }], events: [], clips: [{ from: 0, to: 60 }], ...over });

describe('filler and pause cuts', () => {
  it('knows the fillers of each language, and short spellings only alone between pauses', () => {
    const words = [tw(1, 1.3, 'Das'), tw(1.35, 1.6, 'ist'), tw(2, 2.3, 'äh,'), tw(2.6, 2.8, 'um'), tw(3, 3.3, 'E.'), tw(3.6, 3.8, 'zwölf'), tw(3.85, 4, 'm')];
    expect(fillerWords(words, 'de')).toEqual([2, 4]);
    // in English, "um" is a filler, and "äh" one of whisper's short spellings, alone between pauses
    expect(fillerWords(words, 'en')).toEqual([2, 3, 4]);
    // "um" is a German word and "er" a German pronoun: unknown language takes neither
    expect(fillerWords([tw(1, 1.2, 'um'), tw(2, 2.2, 'er')], 'auto')).toEqual([]);
    expect(fillerWords([tw(1, 1.2, 'Uh,')], 'auto')).toEqual([0]);
  });

  it('cuts a filler alone between pauses with a little room, where the picture rests', () => {
    const words = [tw(1, 1.5, 'Das'), tw(1.55, 1.8, 'ist'), tw(2.05, 2.4, 'ähm'), tw(2.6, 3, 'Cuttle')];
    expect(fillerCuts(input({ words }))).toEqual([{ from: 2, to: 2.45, auto: 'filler', label: 'Filler: ähm' }]);
    // inside running speech it stays: its time there is an estimate
    expect(fillerCuts(input({ words: [tw(1, 1.5, 'Das'), tw(1.5, 1.8, 'ist'), tw(1.8, 2.1, 'ähm'), tw(2.1, 2.6, 'Cuttle')] }))).toEqual([]);
    // a key pressed, a click, a scroll or the pointer moving away: the picture does not rest
    const at = (event: InputEvent) => fillerCuts(input({ words, events: [event] }));
    expect(at({ t: 2.5, type: 'keys', count: 1 })).toEqual([]);
    expect(at({ t: 1.9, type: 'click', x: 1, y: 1, button: 'left' })).toEqual([]);
    expect(fillerCuts(input({ words, events: [{ t: 1, type: 'move', x: 100, y: 100 }, { t: 2.2, type: 'move', x: 160, y: 100 }] }))).toEqual([]);
    // a few pixels of jitter, or a move long before, are fine
    expect(fillerCuts(input({ words, events: [{ t: 1, type: 'move', x: 100, y: 100 }, { t: 2.2, type: 'move', x: 104, y: 101 }] }))).toHaveLength(1);
    // the screen changing, or the cut leaving the clip
    expect(fillerCuts(input({ words, still: [{ from: 0, to: 2.3 }] }))).toEqual([]);
    expect(fillerCuts(input({ words, clips: [{ from: 0, to: 2.2 }] }))).toEqual([]);
  });

  it('cuts a short sound without a word, and fillers in a row as one', () => {
    const words = [tw(1, 1.5, 'Karte'), tw(3, 3.3, 'Die'), tw(3.6, 3.75, 'äh'), tw(3.75, 3.9, 'ähm'), tw(4.2, 4.5, 'App')];
    const sounds = [{ from: 2, to: 2.4 }, { from: 5, to: 6 }];
    expect(fillerCuts(input({ words, sounds }))).toEqual([
      { from: 1.95, to: 2.45, auto: 'filler', label: 'Filler (a sound)' },
      { from: 3.55, to: 3.95, auto: 'filler', label: 'Filler: äh, ähm' },
    ]);
  });

  it('cuts a pause down to 0.4 s where the picture rests, around clicks and sounds', () => {
    const words = [tw(1, 2, 'Erstens'), tw(5, 6, 'zweitens')];
    expect(pauseCuts(input({ words }))).toEqual([{ from: 2.2, to: 4.8, auto: 'pause', label: 'Pause: 3.0 s' }]);
    // a click in the middle: the pause around it is cut on both sides of it
    expect(pauseCuts(input({ words, events: [{ t: 3.5, type: 'click', x: 1, y: 1, button: 'left' }] })).map((cut) => [cut.from, cut.to])).toEqual([
      [2.2, 3.3],
      [3.7, 4.8],
    ]);
    // the screen moves from 3 s to 4 s (a page loading): only the still parts go
    expect(pauseCuts(input({ words, still: [{ from: 0, to: 3 }, { from: 4, to: 60 }] })).map((cut) => [cut.from, cut.to])).toEqual([
      [2.2, 2.8],
      [4.2, 4.8],
    ]);
    // shorter than a second: no pause
    expect(pauseCuts(input({ words: [tw(1, 2, 'eins'), tw(2.9, 3.5, 'zwei')] }))).toEqual([]);
  });

  it('takes a short sound in a pause with the pause, and keeps a long one', () => {
    const words = [tw(1, 2, 'Erstens'), tw(5, 6, 'zweitens')];
    const cuts = speechCuts(input({ words, sounds: [{ from: 3.2, to: 3.5 }] }), { fillers: true, pauses: true });
    expect(cuts.map((cut) => [cut.auto, cut.from, cut.to])).toEqual([['pause', 2.2, 4.8]]);
    expect(pauseCuts(input({ words, sounds: [{ from: 3, to: 4 }] })).map((cut) => [cut.from, cut.to])).toEqual([
      [2.2, 2.9],
      [4.1, 4.8],
    ]);
    expect(speechCuts(input({ words, sounds: [{ from: 3.2, to: 3.5 }] }), { fillers: true, pauses: false }).map((cut) => cut.auto)).toEqual(['filler']);
    expect(restingAt({ from: 1, to: 2 }, { still: [], events: [] })).toBe(false);
  });
});

describe('mergeCuts', () => {
  it('replaces the tagged cuts of its kinds (keeping the ids and switches of the same cuts), keeps the others and stays clear of them', () => {
    const raw = [
      { id: 'c1', from: 1, to: 2, auto: 'filler', label: 'Filler: äh' },
      { id: 'c2', from: 4, to: 5, label: 'My cut' },
      { id: 'c3', from: 7, to: 8, auto: 'pause', enabled: false },
      { id: 'c4', from: 10, to: 11, auto: 'retake' },
    ];
    const made = [
      { from: 1.1, to: 1.9, auto: 'filler' as const, label: 'Filler: äh' },
      { from: 4.5, to: 4.8, auto: 'filler' as const, label: 'Filler: ähm' },
      { from: 7.2, to: 8, auto: 'pause' as const, label: 'Pause: 1.4 s' },
      { from: 12, to: 12.3, auto: 'filler' as const, label: 'Filler (a sound)' },
    ];
    const taken = new Set(['c1', 'c2', 'c3', 'c4', 's1']);
    const { cuts, added, kept } = mergeCuts(raw, made, ['filler', 'pause'], taken);
    expect(kept).toBe(2);
    expect(cuts).toEqual([
      { id: 'c1', label: 'Filler: äh', from: 1.1, to: 1.9, auto: 'filler' },
      { id: 'c2', from: 4, to: 5, label: 'My cut' },
      { id: 'c3', label: 'Pause: 1.4 s', from: 7.2, to: 8, enabled: false, auto: 'pause' },
      { id: 'c4', from: 10, to: 11, auto: 'retake' },
      { id: 'c5', label: 'Filler (a sound)', from: 12, to: 12.3, auto: 'filler' },
    ]);
    expect(added).toHaveLength(3);
  });
});

describe('suggestClips with speech', () => {
  it('keeps someone speaking over a still screen, and never speeds speech up', () => {
    const keys = (...times: number[]): InputEvent[] => times.map((t) => ({ t, type: 'keys', count: 1 }));
    // typing at 1–2 s and 30–31 s; the screen rests in between; someone talks from 10 to 16 s
    const without = suggestClips({ duration: 40, events: keys(1, 2, 30, 31), markers: [], still: [{ from: 0, to: 40 }] });
    expect(without.clips.map((clip) => [clip.from, clip.to])).toEqual([
      [0.2, 2.8],
      [29.2, 32.3],
    ]);
    const spoken = suggestClips({ duration: 40, events: keys(1, 2, 30, 31), markers: [], still: [{ from: 0, to: 40 }], speech: [{ from: 10, to: 16 }] });
    expect(spoken.clips.map((clip) => [clip.from, clip.to, clip.speed])).toEqual([
      [0.2, 2.8, 1],
      [9.2, 16.8, 1],
      [29.2, 32.3, 1],
    ]);
    // Claude at work (the screen changes, no input) is sped up around the speech, not over it
    const markers = [{ t: 3, kind: 'prompt' as const }, { t: 60, kind: 'answer' as const }];
    const working = suggestClips({ duration: 70, events: keys(2, 3), markers, still: [], speech: [{ from: 30, to: 34 }] });
    const over = working.clips.filter((clip) => clip.from < 34 && 30 < clip.to);
    expect(over.every((clip) => clip.speed === 1)).toBe(true);
    // before the speech, and before and after the answer
    expect(working.clips.filter((clip) => clip.speed > 1)).toHaveLength(3);
  });
});

describe('downloadFile', () => {
  const body = Buffer.from('a speech model, or rather a few bytes of one');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const serve = async (send: (res: import('node:http').ServerResponse) => void) => {
    const server = createServer((_req, res) => send(res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as { port: number };
    return { url: `http://127.0.0.1:${port}/ggml-test.bin`, close: () => new Promise((resolve) => server.close(resolve)) };
  };

  it('writes the file once its size and checksum match, with progress', async () => {
    const server = await serve((res) => res.end(body));
    const path = join(temp(), 'models', 'ggml-test.bin');
    const seen: number[] = [];
    await downloadFile(server.url, path, { bytes: body.length, sha256 }, { onProgress: (received) => seen.push(received) });
    await server.close();
    expect(readFileSync(path)).toEqual(body);
    expect(seen.at(-1)).toBe(body.length);
  });

  it('keeps nothing of a download that is cut short or does not match', async () => {
    const dir = temp();
    const short = await serve((res) => res.end(body.subarray(0, 10)));
    await expect(downloadFile(short.url, join(dir, 'a.bin'), { bytes: body.length, sha256 })).rejects.toThrow(/ended at 10 of/);
    await short.close();
    const wrong = await serve((res) => res.end(Buffer.from(body).fill(0x62, 0, 1)));
    await expect(downloadFile(wrong.url, join(dir, 'b.bin'), { bytes: body.length, sha256 })).rejects.toThrow(/checksum/);
    await wrong.close();
    const missing = await serve((res) => {
      res.statusCode = 404;
      res.end();
    });
    await expect(downloadFile(missing.url, join(dir, 'c.bin'), { bytes: body.length, sha256 })).rejects.toThrow(/HTTP 404/);
    await missing.close();
    expect(existsSync(join(dir, 'a.bin')) || existsSync(join(dir, 'a.bin.part')) || existsSync(join(dir, 'b.bin'))).toBe(false);
  });

  it('stops when cancelled', async () => {
    const server = await serve((res) => {
      res.write(body.subarray(0, 5)); // and never ends
    });
    const controller = new AbortController();
    const path = join(temp(), 'd.bin');
    const download = downloadFile(server.url, path, { bytes: body.length, sha256 }, { signal: controller.signal, onProgress: () => controller.abort() });
    await expect(download).rejects.toMatchObject({ code: 'cancelled' });
    await server.close();
    expect(existsSync(`${path}.part`)).toBe(false);
  });
});

describe('the cleaned-up mic', () => {
  it('takes the noise filter\'s delay out again and keeps the length', () => {
    expect(cleanupFilter(1200)).toBe('aresample=48000,highpass=f=80,afftdn=nr=12:nf=-50:tn=1,atrim=start_sample=1200,asetpts=PTS-STARTPTS,apad=pad_len=1200,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000');
    expect(cleanupFilter(0)).not.toContain('atrim');
  });

  it('is louder, as long as the mic, and in step with it', async () => {
    expect(await denoiseLatency()).toBeGreaterThan(0);
    const mic = join(fixtures, 'en.m4a');
    const out = join(temp(), 'mic.clean.m4a');
    await cleanMic(mic, out);
    expect(Math.abs((await streamSeconds(out, 'a')) - (await streamSeconds(mic, 'a')))).toBeLessThan(0.03);
    const [before, after] = [await micLevels(mic), await micLevels(out)];
    // the best lag between the two loudness curves, in 10 ms steps
    let best = 0;
    let bestScore = -Infinity;
    for (let lag = -10; lag <= 10; lag++) {
      let score = 0;
      for (let i = 100; i < before.length - 100; i++) score -= Math.abs(before[i]! - (after[i + lag] ?? -100));
      if (score > bestScore) [best, bestScore] = [lag, score];
    }
    expect(best).toBe(0);
    const loud = (levels: Float32Array) => Float32Array.from(levels).sort()[Math.floor(levels.length * 0.95)]!;
    expect(loud(after)).toBeGreaterThan(loud(before) + 3);
    expect(speechStretches(after)).toHaveLength(speechStretches(before).length);
  }, 30_000);
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProject, type InputEvent, type Marker, type TranscriptWord } from '@cuttle/project';
import { withSpeechCuts, wordStretches } from '../src/speech/apply';
import { retakeCuts, spokenCues, type RetakeInput } from '../src/speech/retakes';

const key = (t: number): Marker => ({ t, kind: 'retake' });
const said = (...items: [number, number, string][]): TranscriptWord[] => items.map(([t, end, text]) => ({ t, end, text }));
const input = (over: Partial<RetakeInput>): RetakeInput => ({ markers: [], speech: [], events: [], clips: [{ from: 0, to: 60 }], ...over });

describe('the mistake key', () => {
  // a sentence, a pause, the slip, the key, the slip said again
  const speech = [{ from: 1, to: 3 }, { from: 4, to: 6.5 }, { from: 7.5, to: 10 }];

  it('cuts back to the pause before the slip, and just past the key', () => {
    expect(retakeCuts(input({ markers: [key(6.8)], speech }))).toEqual([{ from: 3.85, to: 6.95, auto: 'retake', label: 'Retake' }]);
  });

  it('takes a pause only where the input rested, else the one before', () => {
    const events: InputEvent[] = [{ t: 3.8, type: 'click', x: 1, y: 1, button: 'left' }];
    expect(retakeCuts(input({ markers: [key(6.8)], speech, events }))[0]!.from).toBe(0.85);
    // a short gap between words is no pause
    expect(retakeCuts(input({ markers: [key(6.8)], speech: [{ from: 1, to: 3.8 }, { from: 4, to: 6.5 }] }))[0]!.from).toBe(0.85);
  });

  it('goes 5 s back without a pause in the last 20 s, and never past the clip\'s start', () => {
    expect(retakeCuts(input({ markers: [key(25)], speech: [{ from: 0, to: 30 }] }))[0]).toMatchObject({ from: 20, to: 25.15 });
    expect(retakeCuts(input({ markers: [key(6.8)], speech: [{ from: 1, to: 6.5 }], clips: [{ from: 3, to: 10 }] }))[0]).toMatchObject({ from: 3, to: 6.95 });
    // no speech at all (no mic): 5 s back
    expect(retakeCuts(input({ markers: [key(12)] }))[0]).toMatchObject({ from: 7, to: 12.15 });
    // a key outside every clip makes nothing
    expect(retakeCuts(input({ markers: [key(12)], clips: [{ from: 0, to: 10 }] }))).toEqual([]);
  });
});

/** The German fixture's words, as the text-to-speech said them (each until the next starts, at most 0.5 s). */
function germanWords(): TranscriptWord[] {
  const truth = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'speech', 'de.words.json'), 'utf8')) as { t: number; text: string }[];
  return truth.map((word, i) => ({ t: word.t, end: Math.min(truth[i + 1]?.t ?? word.t + 0.5, word.t + 0.5), text: word.text }));
}

describe('a spoken cue', () => {
  it('counts when what follows repeats what came before: "Nochmal" in the German fixture', () => {
    const words = germanWords();
    expect(spokenCues(words)).toEqual([{ at: 11.635, end: 12.135, text: 'Nochmal', slip: 9.495 }]);
    // the cut runs from the pause before the slip ("Ähm, die App erkennt die Art.") to just past the cue
    expect(retakeCuts(input({ words, speech: wordStretches({ version: 1, language: 'de', model: 'small', words, sounds: [] }) }))).toEqual([
      { from: 8.58, to: 12.285, auto: 'retake', label: 'Retake: “Nochmal”' },
    ]);
  });

  it('does not count in a sentence or without a repeat, and knows the English cues', () => {
    const plain = said([1, 1.3, 'Ich'], [1.3, 1.6, 'sag'], [1.6, 1.8, 'es'], [1.8, 2.1, 'noch'], [2.1, 2.3, 'mal'], [2.3, 2.8, 'anders:'], [3, 3.4, 'Cuttle'], [3.4, 3.8, 'schneidet']);
    expect(spokenCues(plain)).toEqual([]);
    // "again" inside a sentence is no cue, even when the words after it repeat
    const inSentence = said([1, 1.3, 'Click'], [1.3, 1.5, 'it'], [1.5, 1.9, 'again.'], [2.6, 2.9, 'Click'], [2.9, 3.1, 'it'], [3.1, 3.3, 'and'], [3.3, 3.7, 'save']);
    expect(spokenCues(inSentence)).toEqual([]);
    // a cue after a pause without a repeat is none either
    const noRepeat = said([1, 1.5, 'Fertig.'], [2.5, 3, 'Nochmal:'], [3.5, 4, 'Cuttle'], [4, 4.5, 'schneidet']);
    expect(spokenCues(noRepeat)).toEqual([]);
    // the English fixture: "Um, it zooms on clicks. Again. It zooms on every click"
    const english = said([0.5, 0.8, 'you.'], [1, 1.3, 'Um,'], [1.4, 1.6, 'it'], [1.6, 1.9, 'zooms'], [1.9, 2.1, 'on'], [2.1, 2.5, 'clicks.'], [3.5, 3.9, 'Again.'], [4.5, 4.7, 'It'], [4.7, 5.1, 'zooms'], [5.1, 5.4, 'on'], [5.4, 5.7, 'every'], [5.7, 6.1, 'click']);
    expect(spokenCues(english)).toEqual([{ at: 3.5, end: 3.9, text: 'Again', slip: 1.4 }]);
    const phrase = said([1, 1.3, 'Lass'], [1.3, 1.6, 'mich'], [2, 2.4, 'one'], [2.4, 2.7, 'more'], [2.7, 3, 'time'], [3.5, 3.8, 'Lass'], [3.8, 4.1, 'mich']);
    expect(spokenCues(phrase)).toEqual([{ at: 2, end: 3, text: 'one more time', slip: 1 }]);
  });

  it('skips a "sorry" or an "äh" around the cue, and takes "nochmal von vorne" whole', () => {
    const sorry = said([1, 1.3, 'Die'], [1.3, 1.6, 'App'], [1.6, 2, 'misst'], [2.6, 3, 'sorry,'], [3, 3.5, 'nochmal.'], [4, 4.2, 'Äh,'], [4.4, 4.6, 'die'], [4.6, 4.9, 'App'], [4.9, 5.4, 'erkennt']);
    expect(spokenCues(sorry)).toEqual([{ at: 3, end: 3.5, text: 'nochmal', slip: 1 }]);
    const fromTheTop = said([1, 1.3, 'Das'], [1.3, 1.6, 'ist'], [2.2, 2.6, 'nochmal'], [2.6, 2.8, 'von'], [2.8, 3.2, 'vorne.'], [3.8, 4, 'Das'], [4, 4.2, 'ist'], [4.2, 4.6, 'Cuttle']);
    expect(spokenCues(fromTheTop)).toEqual([{ at: 2.2, end: 3.2, text: 'nochmal von vorne', slip: 1 }]);
    // a slip of one word, said again
    const one = said([1, 1.5, 'Speichern.'], [2.2, 2.7, 'Nochmal.'], [3.2, 3.7, 'Speichern'], [3.7, 4, 'unter']);
    expect(spokenCues(one)).toEqual([{ at: 2.2, end: 2.7, text: 'Nochmal', slip: 1 }]);
  });

  it('joins the key and a cue at the same slip into one cut', () => {
    const words = germanWords();
    const cuts = retakeCuts(input({ words, markers: [key(12)], speech: wordStretches({ version: 1, language: 'de', model: 'small', words, sounds: [] }) }));
    expect(cuts).toEqual([{ from: 8.58, to: 12.285, auto: 'retake', label: 'Retake: “Nochmal”' }]);
  });
});

describe('retakes among the speech edits', () => {
  const project = (rest: Record<string, unknown> = {}) => {
    const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, scenes: [{ type: 'clip', from: 0, to: 30 }], ...rest });
    if (!parsed.ok) throw new Error('invalid');
    return parsed.project;
  };
  const words = said([1, 1.5, 'Erstens'], [2.5, 2.8, 'äh'], [3.5, 4, 'falsch'], [5.5, 6, 'zweitens']);
  const transcript = { version: 1 as const, language: 'de', model: 'small', words, sounds: [] };
  const base = { markers: [key(4.2)], speech: wordStretches(transcript), still: [{ from: 0, to: 30 }], events: [], clips: [{ from: 0, to: 30, speed: 1 }] };

  it('take in the pause after the key, and the key works without a transcript', () => {
    const raw = { cuts: [] };
    const result = withSpeechCuts(raw, project(), { ...base, transcript }, new Set());
    // "Erstens, äh, falsch [key] … zweitens": the slip and the pause after it go as one cut
    expect(result.cuts.map((cut) => [cut.auto, cut.from, cut.to])).toEqual([
      ['pause', 1.7, 2.3],
      ['filler', 2.45, 2.85],
      ['retake', 3.35, 5.3],
    ]);
    expect(result).toMatchObject({ retakes: 1, fillers: 1, pauses: 1 });
    expect(result.notes[0]).toMatch(/^cut 1 retake: back to the pause before each slip/);
    const keyOnly = withSpeechCuts({ cuts: [{ id: 'c1', from: 9, to: 9.5, auto: 'filler' }] }, project(), base, new Set(['c1']));
    // without a transcript the filler cut stays as it was
    expect(keyOnly.cuts.map((cut) => cut.auto)).toEqual(['retake', 'filler']);
  });

  it('are not made while switched off', () => {
    const result = withSpeechCuts({}, project({ autoEdits: { retakes: false } }), base, new Set());
    expect(result.cuts).toEqual([]);
    expect(result.notes).toContain('retake cuts are switched off (autoEdits.retakes)');
  });
});

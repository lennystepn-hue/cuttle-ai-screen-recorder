import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import { applyCaptionFixes, captionAt, captionCues, captionWords, sentencesOf, toSrt, toVtt, translatedWords, type CaptionWord, type SpokenWord } from '../src/captions';
import { createTimeline } from '../src/frame';
import { sceneSpans } from '../src/time';

const SCREEN = { width: 1280, height: 720 };
const said = (...items: [number, number, string][]): SpokenWord[] => items.map(([t, end, text]) => ({ t, end, text }));
const project = (rest: Partial<CuttleProjectInput> = {}) => {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4', transcript: 't.json' }, scenes: [{ type: 'clip', from: 0, to: 30 }], ...rest });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
};

describe('the caption words', () => {
  it('apply the fixes: the words in a fix read as its text, an empty fix takes them out', () => {
    const words = said([1, 1.4, 'Holo'], [1.4, 1.8, 'fisch'], [2, 2.3, 'ist'], [2.4, 2.6, 'äh'], [2.8, 3.2, 'toll']);
    expect(applyCaptionFixes(words, [{ at: 1, end: 1.8, text: 'Holofish' }, { at: 2.4, end: 2.6, text: '' }])).toEqual(said([1, 1.8, 'Holofish'], [2, 2.3, 'ist'], [2.8, 3.2, 'toll']));
  });

  it('are in output seconds: none in a cut or a sped-up clip, the end kept inside its piece', () => {
    const p = project({
      scenes: [
        { type: 'card', title: 'Hi', duration: 2 },
        { type: 'clip', from: 0, to: 10 },
        { type: 'clip', from: 10, to: 40, speed: 6 },
      ],
      cuts: [{ from: 3, to: 4 }],
    });
    const words = captionWords(said([1, 1.5, 'eins'], [3.2, 3.6, 'weg'], [4.5, 5, 'zwei'], [9.8, 10.4, 'drei'], [20, 20.5, 'schnell']), sceneSpans(p.scenes, p.cuts));
    expect(words).toEqual([
      { t: 3, end: 3.5, text: 'eins' },
      { t: 5.5, end: 6, text: 'zwei' },
      { t: 10.8, end: 11, text: 'drei' },
    ]);
  });
});

const w = (t: number, end: number, text: string): CaptionWord => ({ t, end, text });

describe('the cues', () => {
  const words = [w(0, 0.3, 'Das'), w(0.3, 0.5, 'ist'), w(0.5, 1.1, 'Cuttle.'), w(1.2, 1.4, 'Es'), w(1.4, 1.9, 'schneidet'), w(3, 3.4, 'Pausen'), w(3.4, 3.6, 'raus')];

  it('break after a sentence and at a pause, and show until shortly after the last word', () => {
    const cues = captionCues(words, 'subtitle');
    expect(cues.map((cue) => [cue.start, cue.end, cue.lines.map((line) => line.map((word) => word.text).join(' '))])).toEqual([
      [0, 1.2, ['Das ist Cuttle.']],
      [1.2, 2.5, ['Es schneidet']],
      [3, 4.2, ['Pausen raus']],
    ]);
  });

  it('wrap a long cue onto two balanced lines, and start a new one past two lines', () => {
    const long = 'Cuttle nimmt den Bildschirm auf und schneidet das Video dann ganz von selbst für dich zurecht damit es passt und gut aussieht'.split(' ').map((text, i) => w(i * 0.3, i * 0.3 + 0.25, text));
    const cues = captionCues(long, 'subtitle');
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) expect(line.map((word) => word.text).join(' ').length).toBeLessThanOrEqual(42);
    }
    const [a, b] = cues[0]!.lines.map((line) => line.map((word) => word.text).join(' ').length);
    expect(Math.abs(a! - b!)).toBeLessThan(12);
  });

  it('show a few words at a time in the bold style', () => {
    const cues = captionCues(words, 'bold');
    expect(cues.map((cue) => cue.lines[0]!.map((word) => word.text).join(' '))).toEqual(['Das ist Cuttle.', 'Es schneidet', 'Pausen raus']);
    const many = captionCues('eins zwei drei vier fünf sechs'.split(' ').map((text, i) => w(i * 0.3, i * 0.3 + 0.25, text)), 'bold');
    expect(many.map((cue) => cue.lines[0]!.length)).toEqual([3, 3]);
  });

  it('know the cue and the word spoken at a time', () => {
    const cues = captionCues(words, 'karaoke');
    expect(captionAt(cues, 0.4)).toEqual({ cue: cues[0], current: 1 });
    expect(captionAt(cues, 1.15)?.current).toBe(2);
    expect(captionAt(cues, 2.6)).toBeUndefined();
    expect(captionAt(cues, 3.5)?.cue).toBe(cues[2]);
  });

  it('write SubRip and WebVTT', () => {
    const cues = captionCues(words, 'subtitle');
    expect(toSrt(cues.slice(0, 2))).toBe('1\n00:00:00,000 --> 00:00:01,200\nDas ist Cuttle.\n\n2\n00:00:01,200 --> 00:00:02,500\nEs schneidet\n');
    expect(toVtt(cues.slice(2))).toBe('WEBVTT\n\n00:00:03.000 --> 00:00:04.200\nPausen raus\n');
  });
});

describe('captions in the timeline', () => {
  const transcript = said([1, 1.3, 'Hallo'], [1.3, 1.8, 'zusammen.'], [3, 3.5, 'Los']);

  it('come with the frames while they are on, and stay in the cues while they are off', () => {
    const on = createTimeline(project(), { screenSize: SCREEN, transcript });
    expect(on.cues).toHaveLength(2);
    expect(on.frameAt(1.5).caption).toEqual({ cue: on.cues[0], current: 1 });
    expect(on.frameAt(0.5).caption).toBeUndefined();
    const off = createTimeline(project({ captions: { enabled: false } }), { screenSize: SCREEN, transcript });
    expect(off.cues).toHaveLength(2);
    expect(off.frameAt(1.5).caption).toBeUndefined();
    expect(createTimeline(project(), { screenSize: SCREEN, transcript, captions: false }).frameAt(1.5).caption).toBeUndefined();
    expect(createTimeline(project(), { screenSize: SCREEN }).cues).toEqual([]);
  });
});

describe('subtitles in another language', () => {
  const spoken: SpokenWord[] = [
    { t: 0.5, end: 0.8, text: 'Hallo' },
    { t: 0.8, end: 1.3, text: 'zusammen.' },
    { t: 1.4, end: 1.7, text: 'Wie' },
    { t: 1.7, end: 2.0, text: 'geht’s?' },
    { t: 3.5, end: 3.9, text: 'Gut' },
  ];

  it('cuts the transcript into sentences at their end marks and at pauses', () => {
    expect(sentencesOf(spoken)).toEqual([
      { at: 0.5, end: 1.3, text: 'Hallo zusammen.' },
      { at: 1.4, end: 2.0, text: 'Wie geht’s?' },
      { at: 3.5, end: 3.9, text: 'Gut' },
    ]);
  });

  it('spreads each translated sentence over the time its original took, by the length of its words', () => {
    const words = translatedWords([
      { at: 0.5, end: 1.3, text: 'Hello everyone.' },
      { at: 1.4, end: 2.0, text: '' },
    ]);
    expect(words.map((word) => word.text)).toEqual(['Hello', 'everyone.']);
    expect(words[0]!.t).toBe(0.5);
    expect(words[1]!.end).toBeCloseTo(1.3, 9);
    // "Hello " is 6 of 16 letters
    expect(words[0]!.end).toBeCloseTo(0.5 + (6 / 16) * 0.8, 9);
  });

  it('shows the translation in the picture, without the fixes of the spoken words', () => {
    const parsed = parseProject({ version: 1, sources: { screen: 's.mp4', transcript: 't.json' }, scenes: [{ type: 'clip', from: 0, to: 5 }], captions: { fixes: [{ at: 0.5, end: 1.3, text: 'Servus' }] } });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const translated = translatedWords([{ at: 0.5, end: 1.3, text: 'Hello everyone.' }]);
    const shown = createTimeline(parsed.project, { screenSize: { width: 1920, height: 1080 }, transcript: spoken, translated }).frameAt(1).caption;
    expect(shown?.cue.lines.flat().map((word) => word.text)).toEqual(['Hello', 'everyone.']);
  });
});

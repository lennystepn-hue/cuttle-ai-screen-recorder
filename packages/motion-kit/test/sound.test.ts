import { describe, expect, it } from 'vitest';
import { BUILT_IN_SOUNDS } from '../src/index';
import { SOUND_LIST, SOUNDS, arp, chord, euclid, fitTempo, hz, midi, progression, scale, sections, steps, voiceLead, type Video } from '../kit/sound.js';

const video = (scenes: Video['scenes'], extra: Partial<Video> = {}): Video => ({
  duration: scenes.at(-1)!.end,
  fps: 30,
  scenes,
  cuts: scenes.slice(1).map((scene) => ({ t: scene.start, scene: scene.index, jump: false })),
  clicks: [],
  keys: [],
  words: [],
  speech: [],
  markers: [],
  zooms: [],
  ...extra,
});

describe('the sound kit: notes and harmony', () => {
  it('reads notes as MIDI numbers and frequencies', () => {
    expect([midi('C4'), midi('A4'), midi('F#3'), midi('Bb2'), midi('D'), midi(40)]).toEqual([60, 69, 54, 46, 62, 40]);
    expect(hz('A4')).toBe(440);
    expect(hz(81)).toBeCloseTo(880, 6);
    expect(() => midi('H2')).toThrow(/not a note/);
  });

  it('walks a scale by its degrees, across octaves both ways', () => {
    const d = scale('D', 'minor');
    expect(d.notes(4)).toEqual([62, 64, 65, 67, 69, 70, 72]);
    expect([d.degree(7, 4), d.degree(-1, 4), d.degree(9, 3)]).toEqual([74, 60, 65]);
    expect(scale('C', 'pentatonic').notes(4)).toEqual([60, 62, 64, 67, 69]);
  });

  it('spells chords, with a bass note under a slash', () => {
    expect(chord('Dm7', 3)).toEqual([50, 53, 57, 60]);
    expect(chord('Bbmaj7')).toEqual([70, 74, 77, 81]);
    expect(chord('F/A')).toEqual([57, 65, 69, 72]);
    expect(chord('Csus4', 3)).toEqual([48, 53, 55]);
    expect(() => chord('Cblah')).toThrow(/quality/);
  });

  it('turns roman numerals into the key\'s chords: case for major and minor, a suffix on top', () => {
    expect(progression('D', 'minor', 'i VI III VII', 3)).toEqual([
      [50, 53, 57],
      [58, 62, 65],
      [53, 57, 60],
      [60, 64, 67],
    ]);
    expect(progression('C', 'major', 'ii7 V7 Imaj7', 3)).toEqual([
      [50, 53, 57, 60],
      [55, 59, 62, 65],
      [48, 52, 55, 59],
    ]);
    expect(progression('A', 'minor', 'ii°', 3)).toEqual([[59, 62, 65]]);
  });

  it('voices each chord close to the one before, inside the range', () => {
    const plain = progression('C', 'major', 'I V vi IV', 3);
    const voiced = voiceLead(plain, { low: 'C3', high: 'C5' });
    for (const notes of voiced) {
      expect(Math.min(...notes)).toBeGreaterThanOrEqual(48);
      expect(Math.max(...notes)).toBeLessThanOrEqual(72);
    }
    // the chords' middles move less, all told, than in root position
    const centre = (notes: number[]) => notes.reduce((a, b) => a + b, 0) / notes.length;
    const travel = (chords: number[][]) => chords.slice(1).reduce((sum, notes, i) => sum + Math.abs(centre(notes) - centre(chords[i]!)), 0);
    expect(travel(voiced)).toBeLessThan(travel(plain));
  });

  it('writes rhythms as steps and spreads hits evenly', () => {
    expect(steps('x..X .o')).toEqual([0.75, 0, 0, 1, 0, 0.45]);
    const tresillo = euclid(3, 8);
    expect(tresillo.filter((v) => v > 0)).toHaveLength(3);
    expect(tresillo.length).toBe(8);
    expect(arp([67, 60, 64], { pattern: 'updown' })).toEqual([60, 64, 67, 64]);
    expect(arp([60, 64], { octaves: 2 })).toEqual([60, 64, 72, 76]);
  });
});

describe('the sound kit: the video', () => {
  const scenes: Video['scenes'] = [
    { index: 0, type: 'motion', start: 0, end: 3, label: 'Title' },
    { index: 1, type: 'clip', start: 3, end: 10, speed: 1, from: 0, to: 7 },
    { index: 2, type: 'clip', start: 10, end: 14, speed: 8, from: 7, to: 39 },
    { index: 3, type: 'clip', start: 14, end: 20, speed: 1, from: 39, to: 45, id: 's4' },
    { index: 4, type: 'clip', start: 20, end: 26, speed: 1, from: 45, to: 51 },
    { index: 5, type: 'card', start: 26, end: 30 },
  ];

  it('gives each part an energy from what it shows, and builds to the part before the outro', () => {
    const parts = sections(video(scenes, { markers: [{ t: 16, kind: 'answer' }] }));
    expect(parts.map((part) => [part.name, part.energy])).toEqual([
      ['intro', 1],
      ['main', 2],
      ['drive', 3],
      ['payoff', 3],
      ['climax', 3],
      ['outro', 1],
    ]);
  });

  it('takes a part\'s energy from its label or id, and leaves a part set so as it is', () => {
    const parts = sections(video(scenes), { energy: { Title: 0, s4: 1, 4: 2 } });
    expect(parts.map((part) => part.energy)).toEqual([0, 2, 3, 1, 2, 1]);
  });

  it('takes the scenes of a video without clips as its content, a card at the end as the outro', () => {
    const reel: Video['scenes'] = [
      { index: 0, type: 'motion', start: 0, end: 3 },
      { index: 1, type: 'motion', start: 3, end: 6 },
      { index: 2, type: 'motion', start: 6, end: 9 },
      { index: 3, type: 'card', start: 9, end: 11 },
    ];
    expect(sections(video(reel)).map((part) => [part.name, part.energy])).toEqual([
      ['main', 2],
      ['main', 2],
      ['climax', 3],
      ['outro', 1],
    ]);
    expect(sections(video(reel.slice(0, 2))).map((part) => part.energy)).toEqual([2, 2]);
  });

  it('keeps the pieces of a clip around a jump cut one part', () => {
    const cutUp: Video['scenes'] = [
      { index: 0, type: 'clip', start: 0, end: 4, speed: 1, from: 0, to: 4 },
      { index: 0, type: 'clip', start: 4, end: 9, speed: 1, from: 6, to: 11 },
    ];
    const parts = sections({ ...video(cutUp), cuts: [{ t: 4, scene: 0, jump: true }] });
    expect(parts.map((part) => [part.start, part.end])).toEqual([[0, 9]]);
  });

  it('finds a tempo whose beats meet the scene changes', () => {
    const cuts = [2, 5.5, 9, 13.5, 21];
    const { bpm, offset, error } = fitTempo(cuts, { min: 100, max: 128 });
    expect(bpm).toBeGreaterThanOrEqual(100);
    expect(bpm).toBeLessThanOrEqual(128);
    expect(error).toBeLessThan(0.01);
    const beat = 60 / bpm;
    for (const t of cuts) {
      const beats = (t - offset) / beat;
      expect(Math.abs(beats - Math.round(beats)) * beat).toBeLessThan(0.02);
    }
    // from a video: its scene changes, not its jump cuts
    const fromVideo = fitTempo({ ...video(scenes), cuts: [...video(scenes).cuts, { t: 4.1, scene: 1, jump: true }] }, { min: 100, max: 128 });
    expect(fromVideo.error).toBeLessThan(0.05);
  });
});

describe('the sound kit: the built-in sounds', () => {
  it('plays every built-in sound a project can name, as the CLI lists them', () => {
    expect(SOUND_LIST).toEqual(BUILT_IN_SOUNDS.map(([name, description]) => [name, description]));
    expect(Object.keys(SOUNDS).sort()).toEqual(BUILT_IN_SOUNDS.map(([name]) => name).sort());
  });
});

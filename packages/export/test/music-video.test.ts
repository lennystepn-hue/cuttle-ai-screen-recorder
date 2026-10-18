import { parseProject, type InputEvent } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { soundCues, videoData } from '../src/music/video';

function project(input: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

describe('the video as its music sees it', () => {
  const p = project({
    scenes: [
      { type: 'motion', id: 's1', label: 'Intro', src: 'motion/intro/index.html', duration: 2 },
      { type: 'clip', id: 's2', from: 10, to: 20 },
      { type: 'clip', id: 's3', label: 'Claude at work', from: 20, to: 60, speed: 8 },
      { type: 'card', id: 's4', title: 'Cuttle', duration: 3 },
    ],
    cuts: [{ from: 14, to: 15 }],
    zooms: [
      { at: 12, duration: 4, rect: [0, 0, 1280, 720], label: 'Answer' },
      { at: 30, duration: 3, rect: [0, 0, 1280, 720], enabled: false },
    ],
    captions: { fixes: [{ at: 18, end: 18.4, text: 'Cuttle' }] },
  });
  const events: InputEvent[] = [
    { t: 11, type: 'click', x: 5, y: 5, button: 'left' },
    { t: 14.5, type: 'click', x: 5, y: 5, button: 'left' },
    { t: 40, type: 'click', x: 5, y: 5, button: 'left' },
    { t: 12, type: 'keys', count: 3 },
  ];
  const words = [
    { t: 11, end: 11.3, text: 'Now' },
    { t: 11.5, end: 11.9, text: 'watch.' },
    { t: 13, end: 13.4, text: 'Done.' },
    { t: 18, end: 18.2, text: 'Kutl' },
  ];
  const markers = [
    { t: 12.5, kind: 'prompt' as const, label: 'Build it' },
    { t: 14.2, kind: 'tool' as const },
    { t: 44, kind: 'answer' as const },
  ];
  const video = videoData(p, { events, words, markers });

  it('lists the scenes and the cuts between them, a jump cut marked', () => {
    expect(video.duration).toBe(2 + 9 + 5 + 3);
    expect(video.scenes.map((scene) => [scene.id, scene.type, scene.start, scene.end])).toEqual([
      ['s1', 'motion', 0, 2],
      ['s2', 'clip', 2, 6],
      ['s2', 'clip', 6, 11],
      ['s3', 'clip', 11, 16],
      ['s4', 'card', 16, 19],
    ]);
    expect(video.scenes[0]).toMatchObject({ label: 'Intro', src: 'motion/intro/index.html' });
    expect(video.scenes[3]).toMatchObject({ speed: 8, from: 20, to: 60, label: 'Claude at work' });
    expect(video.cuts).toEqual([
      { t: 2, scene: 1, jump: false },
      { t: 6, scene: 1, jump: true },
      { t: 11, scene: 2, jump: false },
      { t: 16, scene: 3, jump: false },
    ]);
  });

  it('puts the take\'s clicks, keys, markers and zooms where the video shows them, and leaves out what is cut', () => {
    // 11 s at 1× from 2; 14.5 s is cut; 40 s at 8× from 11
    expect(video.clicks).toEqual([3, 13.5]);
    expect(video.keys.length).toBe(3);
    expect(video.keys.every((t) => t >= 4 && t < 4.5)).toBe(true);
    expect(video.markers).toEqual([
      { t: 4.5, kind: 'prompt', label: 'Build it' },
      { t: 14, kind: 'answer' },
    ]);
    // the zoom (12–16 s) shows on both pieces around the cut, one stretch
    expect(video.zooms).toEqual([{ start: 4, end: 7, label: 'Answer' }]);
  });

  it('gives the words with the fixes, and joins them into stretches of speech', () => {
    expect(video.words.map((word) => word.text)).toEqual(['Now', 'watch.', 'Done.', 'Cuttle']);
    expect(video.speech).toEqual([
      { start: 3, end: 3.9 },
      { start: 5, end: 5.4 },
      { start: 9, end: 9.4 },
    ]);
  });
});

describe('the project\'s sounds on the video', () => {
  const p = project({
    scenes: [
      { type: 'clip', id: 's1', from: 0, to: 10 },
      { type: 'motion', id: 's2', src: 'motion/x/index.html', duration: 4 },
      { type: 'clip', id: 's3', from: 5, to: 8, speed: 2 },
    ],
    cuts: [{ from: 3, to: 4 }],
  });

  it('plays a sound at a source second wherever the video shows it, and one in a scene that far in', () => {
    const cues = soundCues(p, [
      { sound: 'pop', at: 6, volume: 0.5, enabled: true },
      { sound: 'whoosh', at: 3.5, volume: 1, enabled: true },
      { sound: 'ding', at: 1, scene: 's2', volume: 0.8, enabled: true },
      { sound: 'sounds/x.wav', at: 9, volume: 0.8, enabled: false },
      { sound: 'tick', at: 9, scene: 's2', volume: 0.8, enabled: true },
    ]);
    expect(cues).toEqual([
      // 6 s: in the first clip (after the 1 s cut: 5 s in) and in the last at 2× (13 + 0.5)
      { at: 5, sound: 'pop', volume: 0.5 },
      { at: 10, sound: 'ding', volume: 0.8 },
      { at: 13.5, sound: 'pop', volume: 0.5 },
    ]);
  });
});

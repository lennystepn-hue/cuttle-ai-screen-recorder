import { parseProject } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { motionShowings, motionSoundCues, soundsOfShowings } from '../../src/main/motion-sounds';

function project(input: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

// output: s1 0–2, s2 2–12 (source 10–20), s3 12–22 (source 15–25), s4 22–25
const video = project({
  scenes: [
    { type: 'motion', id: 's1', label: 'Intro', src: 'motion/intro/index.html', duration: 2 },
    { type: 'clip', id: 's2', from: 10, to: 20 },
    { type: 'clip', id: 's3', from: 15, to: 25 },
    { type: 'card', id: 's4', title: 'Cuttle', duration: 3 },
  ],
  overlays: [
    { id: 'o1', src: 'motion/callouts/index.html', at: 16, duration: 2 },
    { id: 'o2', src: 'motion/late/index.html', at: 30, duration: 2 },
    { id: 'o3', src: 'motion/off/index.html', at: 11, duration: 1, enabled: false },
  ],
});

describe('the showings of motion items', () => {
  it('gives a scene its stretch and an overlay each stretch of clips that shows it, and skips the rest', () => {
    const showings = motionShowings(video);
    expect(showings.map(({ kind, index, showings }) => ({ kind, index, showings }))).toEqual([
      { kind: 'scene', index: 0, showings: [{ start: 0, duration: 2 }] },
      // source 16–18 plays in s2 (output 8–10) and again in s3 (output 13–15)
      { kind: 'overlay', index: 0, showings: [{ start: 8, duration: 2 }, { start: 13, duration: 2 }] },
    ]);
  });

  it('gives a transition the seconds around the cut into its scene, and none where there is no cut to go through', () => {
    const fold = { src: 'motion/fold/index.html', duration: 1 };
    const folded = project({
      scenes: [
        { type: 'motion', id: 's1', src: 'motion/intro/index.html', duration: 2 },
        { type: 'clip', id: 's2', from: 10, to: 20, transition: fold },
        { type: 'clip', id: 's3', from: 15, to: 25, transition: fold },
        { type: 'card', id: 's4', title: 'Cuttle', duration: 3, transition: fold },
      ],
    });
    // into s2 at 2 s, into s3 at 12 s (source 20 to 15: a jump, not a continuous cut) and into the card at 22 s
    const showings = motionShowings(folded).filter((shown) => shown.kind === 'transition');
    expect(showings.map(({ index, showings }) => ({ index, showings }))).toEqual([
      { index: 1, showings: [{ start: 1.5, duration: 1 }] },
      { index: 2, showings: [{ start: 11.5, duration: 1 }] },
      { index: 3, showings: [{ start: 21.5, duration: 1 }] },
    ]);
  });
});

describe('the sounds a page asked for, on the video', () => {
  const showings = [
    { start: 8, duration: 2 },
    { start: 13, duration: 2 },
  ];

  it('plays one asked for seconds into the item at every showing it fits in', () => {
    expect(
      soundsOfShowings(showings, [
        { sound: 'whoosh', at: 0.3, volume: 0.7 },
        { sound: 'ding', at: 2.5, volume: 0.8 },
      ]),
    ).toEqual([
      { at: 8.3, sound: 'whoosh', volume: 0.7 },
      { at: 13.3, sound: 'whoosh', volume: 0.7 },
    ]);
  });

  it('plays one asked for a second of the video there, when a showing covers it', () => {
    expect(
      soundsOfShowings(showings, [
        { sound: 'pop', video: 14.25, volume: 0.4 },
        { sound: 'pop', video: 9, volume: 0.4 },
        { sound: 'pop', video: 11, volume: 0.4 },
        { sound: 'pop', video: 15, volume: 0.4 },
      ]),
    ).toEqual([
      { at: 9, sound: 'pop', volume: 0.4 },
      { at: 14.25, sound: 'pop', volume: 0.4 },
    ]);
  });

  it('asks no page while the sound or the effects are off, or without pages', async () => {
    const pages = { root: '.', scenes: { 0: 'motion/intro/index.html' }, overlays: {}, transitions: {} };
    const take = { events: [], words: [], markers: [] };
    expect(await motionSoundCues(video, undefined, take)).toEqual({ cues: [], errors: [], items: [] });
    const off = { ...video, look: { ...video.look, audio: { ...video.look.audio, effects: false } } };
    expect(await motionSoundCues(off, pages, take)).toEqual({ cues: [], errors: [], items: [] });
    // a page that never calls cuttle.sound (here: none at all) is not opened
    expect(await motionSoundCues(video, { ...pages, scenes: { 0: 'no/such/page.html' } }, take)).toEqual({ cues: [], errors: [], items: [] });
  });
});

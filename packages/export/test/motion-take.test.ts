import { parseProject, type InputEvent } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { CURSOR_PATH_FPS, projectFileUrl, takeData } from '../src/motion/take';

function project(input: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

const SCREEN = { width: 2560, height: 1440 };

describe('the take as a motion page sees it', () => {
  const p = project({
    look: { cursor: { smoothing: 0 } },
    scenes: [
      { type: 'motion', src: 'intro.html', duration: 2 },
      { type: 'clip', from: 10, to: 20 },
      { type: 'clip', from: 20, to: 60, speed: 4 },
    ],
    cuts: [{ from: 14, to: 15 }],
    zooms: [
      { at: 12, duration: 3, rect: [0, 0, 1280, 720], label: 'Answer' },
      { at: 30, duration: 3, rect: [0, 0, 1280, 720], enabled: false },
    ],
    masks: [
      { from: 11, to: 13, rect: [10, 10, 100, 20] },
      { from: 12, to: 16, rect: [0, 400, 300, 30], style: 'blur', moves: [{ at: 14, rect: [0, 300, 300, 30] }] },
      { from: 20, to: 21, rect: [0, 0, 10, 10], enabled: false },
    ],
    captions: { fixes: [{ at: 12, end: 12.5, text: 'Cuttle' }] },
  });
  const events: InputEvent[] = [
    { t: 11, type: 'move', x: 100, y: 100 },
    { t: 11.01, type: 'move', x: 101, y: 100 },
    { t: 11.05, type: 'move', x: 110, y: 100 },
    { t: 12, type: 'click', x: 640, y: 360, button: 'left' },
    { t: 12.5, type: 'keys', count: 4 },
    { t: 13, type: 'scroll', x: 640, y: 360, dx: 0, dy: -120 },
    { t: 13.2, type: 'shape', shape: 'text' },
  ];
  const take = takeData(p, { events, words: [{ t: 12.1, end: 12.4, text: 'Kattel' }, { t: 13, end: 13.3, text: 'records' }], markers: [{ t: 11.5, kind: 'prompt' }] }, SCREEN, { from: 11, to: 16 });

  it('keeps the input a page acts on: clicks, key counts, scrolls, and moves at most 30 a second', () => {
    expect(take.events).toEqual([
      { t: 11, type: 'move', x: 100, y: 100 },
      { t: 11.05, type: 'move', x: 110, y: 100 },
      { t: 12, type: 'click', x: 640, y: 360, button: 'left' },
      { t: 12.5, type: 'keys', count: 4 },
      { t: 13, type: 'scroll', x: 640, y: 360, dx: 0, dy: -120 },
    ]);
  });

  it('has the words with the project\'s fixes, the markers, the zooms and masks that are on, and the recording', () => {
    expect(take.words).toEqual([
      { t: 12, end: 12.5, text: 'Cuttle' },
      { t: 13, end: 13.3, text: 'records' },
    ]);
    expect(take.markers).toEqual([{ t: 11.5, kind: 'prompt' }]);
    expect(take.zooms).toEqual([{ at: 12, duration: 3, rect: [0, 0, 1280, 720], label: 'Answer' }]);
    expect(take.masks).toEqual([
      { from: 11, to: 13, rect: [10, 10, 100, 20], style: 'fill' },
      { from: 12, to: 16, rect: [0, 400, 300, 30], style: 'blur', moves: [{ at: 14, rect: [0, 300, 300, 30] }] },
    ]);
    expect(take.recording).toBe('cuttle-motion://project/s.mp4');
    expect(take.screen).toEqual(SCREEN);
    expect(take.window).toEqual({ from: 11, to: 16 });
  });

  it('knows where each piece of a clip plays in the video, after the motion scene and around the cut', () => {
    expect(take.clips).toEqual([
      { start: 2, end: 6, from: 10, to: 14, speed: 1 },
      { start: 6, end: 11, from: 15, to: 20, speed: 1 },
      { start: 11, end: 21, from: 20, to: 60, speed: 4 },
    ]);
  });

  it('samples the pointer as the video draws it, from its first move to its last', () => {
    expect(take.cursor).toMatchObject({ fps: CURSOR_PATH_FPS, start: 11 });
    const points = take.cursor!.points;
    // 11 s to 12 s (the click is the last place) at 30 a second, x and y each
    expect(points.length).toBe(2 * 31);
    expect(points.slice(0, 2)).toEqual([100, 100]);
    expect(points.slice(-2)).toEqual([640, 360]);
  });

  it('reaches the recording at its URL in the page, only inside the project', () => {
    expect(projectFileUrl('takes/1/screen.mp4')).toBe('cuttle-motion://project/takes/1/screen.mp4');
    expect(projectFileUrl('takes\\2\\my screen#1.mp4')).toBe('cuttle-motion://project/takes/2/my%20screen%231.mp4');
    expect(projectFileUrl('./takes//1/screen.mp4')).toBe('cuttle-motion://project/takes/1/screen.mp4');
    for (const outside of ['../other/screen.mp4', '/home/me/screen.mp4', 'C:\\take\\screen.mp4', 'takes/../../screen.mp4', '']) expect(projectFileUrl(outside), outside).toBeNull();
  });

  it('has no pointer path without moves', () => {
    expect(takeData(p, { events: [], words: [], markers: [] }, SCREEN, null).cursor).toBeNull();
  });
});

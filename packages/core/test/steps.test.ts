import { describe, expect, it } from 'vitest';
import { parseProject, type Marker } from '@cuttle/project';
import { stepMoves } from '@cuttle/timeline';
import { withStepTitles } from '../src/suggest/steps';

const script = [
  { id: 'step1', title: 'Open the settings' },
  { id: 'step2', title: 'Turn on dark mode', motion: 'lower-third' as const },
  { id: 'step3', title: 'Export the video' },
];
const markers: Marker[] = [
  { t: 0, kind: 'step', label: 'step1' },
  { t: 10, kind: 'step', label: 'step2' },
  { t: 20, kind: 'step', label: 'step3' },
];
// the take from 1 s on; 15 to 30 s sped up 4×
const clips = [
  { from: 1, to: 15, speed: 1, start: 0 },
  { from: 15, to: 30, speed: 4, start: 14 },
];
const project = (raw: Record<string, unknown>) => {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, script, ...raw });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
};
const input = { moves: stepMoves(script, markers), clips, position: 'bottom' as const, make: true };

describe('withStepTitles', () => {
  it('puts a title where the video shows each step reached: a text, or an overlay of its motion template; 3 s of the video each', async () => {
    const raw = { texts: [{ id: 't1', at: 2, duration: 1, text: 'Mine' }] };
    const pages: string[] = [];
    const page = async (template: string) => (pages.push(template), `motion/${template}/index.html`);
    const titles = await withStepTitles(raw, project(raw), { ...input, page }, new Set(['t1']));
    expect(titles.texts).toEqual([
      { id: 't1', at: 2, duration: 1, text: 'Mine' },
      // the take was trimmed to 1 s: the first step's title starts there
      { id: 't2', label: 'Step 1', at: 1, duration: 3, auto: 'title', text: 'Open the settings', style: 'lower-third', position: 'bottom' },
      // sped up 4×: 3 s of the video are 12 s of the take
      { id: 't3', label: 'Step 3', at: 20, duration: 10, auto: 'title', text: 'Export the video', style: 'lower-third', position: 'bottom' },
    ]);
    expect(titles.overlays).toEqual([
      { id: 'o1', label: 'Step 2', at: 10, duration: 4, auto: 'title', src: 'motion/lower-third/index.html', params: { name: 'Turn on dark mode', role: 'Step 2 of 3' } },
    ]);
    expect(pages).toEqual(['lower-third']);
    expect(titles.made).toBe(3);
  });

  it('replaces the titles it made before, keeps one the person switched off off, and makes only texts without the kit', async () => {
    const raw = {
      texts: [
        { id: 't1', at: 1, duration: 3, text: 'Open the settings', auto: 'title', enabled: false },
        { id: 't2', at: 20, duration: 10, text: 'Export the video', auto: 'title' },
      ],
    };
    const titles = await withStepTitles(raw, project(raw), { ...input, page: async () => undefined }, new Set(['t1', 't2']));
    expect(titles.texts!.map((text) => [text.id, text.text, text.enabled])).toEqual([
      ['t3', 'Open the settings', false],
      ['t4', 'Turn on dark mode', undefined],
      ['t5', 'Export the video', undefined],
    ]);
    expect(titles.overlays).toBeUndefined();
    expect(titles.notes[0]).toBe('the motion template lower-third could not be added: those step titles are texts');
    // the kind switched off: the titles made before go, and none is made
    const off = await withStepTitles(raw, project(raw), { ...input, make: false }, new Set());
    expect([off.texts, off.made]).toEqual([[], 0]);
  });
});

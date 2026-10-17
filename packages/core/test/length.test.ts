import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseProject, type InputEvent } from '@cuttle/project';
import { runFfmpeg } from '../src/ffmpeg';
import { applyLengthFit, withLengthFit } from '../src/suggest/length';
import { ANALYSIS_DIR } from '../src/suggest/media';

const click = (t: number): InputEvent => ({ t, type: 'click', x: 10, y: 10, button: 'left' });

/** A parsed project and its raw form. */
function project(raw: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, ...raw });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return { raw: { version: 1, sources: { screen: 'takes/1/screen.mp4' }, ...raw }, project: parsed.project };
}

describe('withLengthFit', () => {
  // 20 s: speech from 2 to 5, a click at 15; the screen changes up to 5 and from 12 to 16
  const input = { speech: [{ from: 2, to: 5 }], events: [click(15)], still: [{ from: 5, to: 12 }, { from: 16, to: 20 }], duration: 20 };

  it('cuts where the video rests, tagged and labelled, and keeps the cuts made for something else', () => {
    const { raw, project: shaped } = project({
      scenes: [{ type: 'clip', id: 's1', from: 0, to: 20 }],
      cuts: [
        { id: 'c1', from: 0.4, to: 0.6, auto: 'filler', label: 'Filler: “uh”' },
        { id: 'c2', from: 17, to: 18, auto: 'length', label: 'Fit to 12 s' },
      ],
    });
    const fit = withLengthFit(raw, shaped, input, 14);
    // 19.8 s without the old fit; the run at rest from 5 to 12 gives 5.8 s from its middle
    expect(fit.before).toBeCloseTo(19.8, 6);
    expect(fit).toMatchObject({ target: 14, reached: true, made: 1 });
    expect(fit.length).toBeCloseTo(14, 1);
    expect(fit.cuts.map((cut) => [cut.auto, cut.label])).toEqual([
      ['filler', 'Filler: “uh”'],
      ['length', 'Fit to 14 s'],
    ]);
    const made = fit.cuts[1]!;
    expect(made.from).toBeGreaterThanOrEqual(5);
    expect(made.to).toBeLessThanOrEqual(12);
    expect(fit.notes).toEqual(['cut 5.8 s where the video rests (1 cut) to fit 14 s: 14 s now']);
  });

  it('keeps Claude’s answer and the texts on screen, and says how short it can get', () => {
    const { raw, project: shaped } = project({
      scenes: [{ type: 'clip', id: 's1', from: 0, to: 20 }],
      zooms: [{ id: 'z1', at: 6, duration: 5, rect: [0, 0, 800, 450], auto: 'answer' }],
      texts: [{ id: 't1', at: 17, duration: 2, text: 'Done' }],
    });
    const fit = withLengthFit(raw, shaped, input, 3);
    expect(fit.reached).toBe(false);
    for (const cut of fit.cuts) {
      expect(cut.to <= 6 || cut.from >= 11).toBe(true);
      expect(cut.to <= 17 || cut.from >= 19).toBe(true);
    }
    expect(fit.notes[0]).toMatch(/^shortest without cutting speech, clicks, typing, a zoom or a text: \d+(\.\d)? s \(3 s asked\)$/);
  });
});

describe('applyLengthFit', () => {
  const dirs: string[] = [];
  afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

  it('fits a take, keeps the screen’s analysis in the project, writes nothing when nothing changes, and takes the fit out again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-length-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'takes', '1'), { recursive: true });
    // 12 s of a still screen; clicks at 3 and 9
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=640x360:r=30:d=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(dir, 'takes', '1', 'screen.mp4')]);
    writeFileSync(join(dir, 'takes', '1', 'events.jsonl'), [click(3), click(9)].map((event) => `${JSON.stringify(event)}\n`).join(''));
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', events: 'takes/1/events.jsonl' }, scenes: [{ type: 'clip', id: 's1', from: 0, to: 12 }] }));
    const cuts = () => (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { cuts?: { from: number; to: number; auto?: string }[] }).cuts ?? [];
    const fit = await applyLengthFit(dir, 6);
    expect(fit).toMatchObject({ written: true, target: 6, before: 12, reached: true });
    expect(fit.length).toBeCloseTo(6, 0);
    expect(cuts().every((cut) => cut.auto === 'length')).toBe(true);
    // never near a click
    for (const cut of cuts()) for (const t of [3, 9]) expect(cut.to <= t - 0.3 || cut.from >= t + 0.3).toBe(true);
    // in the project's .cuttle folder, never in the take's (a restart moves it, the take menu deletes it)
    expect(existsSync(join(dir, ANALYSIS_DIR, 'takes_1_screen.mp4.json'))).toBe(true);
    expect(existsSync(join(dir, 'takes', '1', 'analysis.json'))).toBe(false);
    expect((await applyLengthFit(dir, 6)).written).toBe(false);
    // another length replaces it; none takes it out
    expect((await applyLengthFit(dir, 9)).written).toBe(true);
    expect(await applyLengthFit(dir)).toMatchObject({ written: true, length: 12, notes: ['the length fit is taken out'] });
    expect(cuts()).toEqual([]);
  });
});

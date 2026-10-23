import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseProject, voiceLineKey, voiceRenderFiles, type CuttleProjectInput } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import { audioFilterGraph, planAudio } from '../../src/audio';
import { ffmpegPath } from '../../src/main/ffmpeg';
import { loadNarration, placeNarration, renderSamples, writeNarrationTrack } from '../../src/main/narration';

const hasFfmpeg = spawnSync(ffmpegPath(), ['-version'], { windowsHide: true }).status === 0;
const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

function project(voiceover: CuttleProjectInput['voiceover']) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, scenes: [{ type: 'card', id: 'c1', title: 'A', duration: 3 }], voiceover });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

/** A project folder whose narration's line `text` is spoken as `seconds` of a 0.5 tone (a render as `cuttle voice render` writes it). */
function narrated(at: number, seconds: number, volume = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-narration-'));
  dirs.push(dir);
  const narration = project({ voice: { provider: 'local', id: 'en_US-amy-medium' }, volume: 0.5, lines: [{ id: 'v1', text: 'one two', at, scene: 'c1', volume }] });
  const files = voiceRenderFiles(voiceLineKey(narration.voiceover, narration.voiceover.lines[0]!));
  mkdirSync(join(dir, 'voiceover'));
  const made = spawnSync(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=0.5:s=48000:d=${seconds}`, '-ac', '1', '-c:a', 'pcm_f32le', '-y', join(dir, files.sound)], { windowsHide: true });
  if (made.status !== 0) throw new Error(made.stderr.toString());
  writeFileSync(join(dir, files.render), JSON.stringify({ version: 1, seconds, words: [{ t: 0, end: 0.4, text: 'one' }, { t: 0.5, end: 0.9, text: 'two' }], voice: 'local en_US-amy-medium' }));
  return { dir, narration };
}

describe.runIf(hasFfmpeg)('the narration in the export', () => {
  it('reads the rendered lines and says which are not spoken yet', async () => {
    const { dir, narration } = narrated(0.5, 1);
    const [line] = await loadNarration(dir, narration);
    expect(line).toMatchObject({ index: 0, render: { seconds: 1 } });
    expect((await renderSamples(line!.sound)).length).toBe(48_000);
    const changed = project({ ...narration.voiceover, lines: [{ ...narration.voiceover.lines[0]!, text: 'another text' }] });
    await expect(loadNarration(dir, changed)).rejects.toMatchObject({ code: 'missing-file', message: expect.stringContaining('cuttle voice render') });
    expect(await loadNarration(dir, changed, true)).toEqual([]);
  });

  it('mixes each line where it plays at its and the narration\'s volume, its words moved there', async () => {
    const { dir, narration } = narrated(0.5, 1, 0.8);
    const { placed, words } = placeNarration(narration, sceneSpans(narration.scenes), await loadNarration(dir, narration));
    expect(placed).toMatchObject([{ at: 0.5, volume: 0.4 }]);
    expect(words).toEqual([
      { t: 0.5, end: 0.9, text: 'one' },
      { t: 1, end: 1.4, text: 'two' },
    ]);
    const track = join(dir, 'narration.wav');
    await writeNarrationTrack(track, placed, 3);
    const bytes = readFileSync(track);
    const at = (seconds: number) => bytes.readInt16LE(44 + Math.round(seconds * 48_000) * 2) / 32767;
    expect(bytes.length).toBe(44 + 3 * 48_000 * 2);
    expect(at(0.25)).toBe(0);
    // 0.5 × 0.8 × 0.5
    expect(at(1)).toBeCloseTo(0.2, 3);
    expect(at(2)).toBe(0);
  });

  it('mixes the narration track with the take\'s sound through ffmpeg', async () => {
    const { dir, narration } = narrated(0.5, 1);
    const { placed } = placeNarration(narration, sceneSpans(narration.scenes), await loadNarration(dir, narration));
    const track = join(dir, 'narration.wav');
    await writeNarrationTrack(track, placed, 3);
    const segments = planAudio({ spans: sceneSpans(narration.scenes), look: narration.look, mic: false, seconds: 3 });
    const graph = audioFilterGraph(segments, { narration: 0 });
    const result = spawnSync(ffmpegPath(), ['-v', 'error', '-i', track, '-filter_complex', graph, '-map', '[aout]', '-f', 'f32le', '-'], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr.toString());
    const stereo = new Float32Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength / 4);
    expect(stereo.length).toBe(3 * 48_000 * 2);
    // both ears, at the narration's level (0.5 × 0.5), silence around it
    expect(stereo[48_000 * 2]).toBeCloseTo(0.25, 2);
    expect(stereo[48_000 * 2 + 1]).toBeCloseTo(0.25, 2);
    expect(Math.abs(stereo[Math.round(0.25 * 48_000) * 2]!)).toBeLessThan(0.001);
  });
});

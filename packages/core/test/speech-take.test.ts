import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseTranscriptJson } from '@cuttle/project';
import { ffmpegPath, runFfmpeg } from '../src/ffmpeg';
import { applySpeechEdits } from '../src/speech/apply';
import { transcribeTake } from '../src/speech/transcribe';
import { suggestProject } from '../src/suggest';

/**
 * The speech pipeline on a take spoken by Windows' text to speech (the English fixture: "Uh" and
 * "Um" as fillers, pauses between the sentences), muxed under a still screen. It runs where a speech
 * model is downloaded (`CUTTLE_TEST_MODELS`, else the user's models folder; `base` first, the
 * fastest) and ffmpeg has the whisper filter; it is skipped elsewhere.
 */
const modelsDir = process.env.CUTTLE_TEST_MODELS || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Cuttle', 'models') : join(homedir(), 'Library', 'Application Support', 'Cuttle', 'models'));
const model = ['base', 'small', 'large-v3-turbo-q5_0'].find((name) => existsSync(join(modelsDir, `ggml-${name}.bin`)));
const whisper = / whisper /.test(spawnSync(ffmpegPath(), ['-hide_banner', '-filters'], { encoding: 'utf8', windowsHide: true }).stdout ?? '');
const fixtures = join(import.meta.dirname, 'fixtures', 'speech');

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

/** A project whose take is a still screen and the English fixture as its mic, which started 0.2 s after the screen. */
async function spokenTake(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-spoken-'));
  dirs.push(dir);
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=640x360:r=30:d=19.5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(take, 'screen.mp4')]);
  copyFileSync(join(fixtures, 'en.m4a'), join(take, 'mic.m4a'));
  writeFileSync(join(take, 'events.jsonl'), '');
  writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 }, mic: { file: 'mic.m4a', start: 1000.2 } } }));
  writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a', events: 'takes/1/events.jsonl' } }));
  return dir;
}

describe.runIf(model !== undefined && whisper)(`speech on a spoken take (${model} model)`, () => {
  it('transcribes the mic in source seconds, and suggest keeps the speech and cuts the fillers and pauses', async () => {
    process.env.CUTTLE_MODELS_DIR = modelsDir;
    const dir = await spokenTake();
    const progress: number[] = [];
    const done = await transcribeTake(dir, { model, onProgress: (fraction) => progress.push(fraction) });
    expect(done).toMatchObject({ transcript: 'takes/1/transcript.json', cleanMic: 'takes/1/mic.clean.m4a', model, language: 'en', aligned: true });
    expect(progress.at(-1)).toBe(1);
    const parsed = parseTranscriptJson(readFileSync(join(dir, 'takes', '1', 'transcript.json'), 'utf8'));
    if (!parsed.ok) throw new Error('invalid transcript');
    // "records" starts at 2.745 s of the mic: 2.945 s of the screen
    const records = parsed.transcript.words.find((word) => /records/i.test(word.text));
    expect(records?.t).toBeCloseTo(2.945, 0);
    expect(Math.abs(records!.t - 2.945)).toBeLessThan(0.25);
    expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')).sources).toMatchObject({ transcript: 'takes/1/transcript.json', cleanMic: 'takes/1/mic.clean.m4a' });

    const result = await suggestProject(dir);
    expect(result.speech.from).toBe('transcript');
    // the screen never changes and nobody types: only the speech keeps the take from being cut away
    expect(result.scenes.length).toBeGreaterThan(0);
    const fillers = (result.cuts ?? []).filter((cut) => cut.auto === 'filler');
    const pauses = (result.cuts ?? []).filter((cut) => cut.auto === 'pause');
    // "Uh" at 2.22 s of the screen
    expect(fillers.some((cut) => cut.from - 0.15 <= 2.22 && 2.22 <= cut.to), 'a filler cut at 2.22').toBe(true);
    expect(pauses.length).toBeGreaterThan(0);
    expect(result.notes.some((note) => /^cut \d+ filler words? and \d+ pauses?/.test(note))).toBe(true);
    // "Um, it zooms on clicks. Again. It zooms on every click": the slip goes, from the pause before
    // "Um" (7.755 s of the screen) through "Again" (10.49 s) to the repeat ("It" at 11.85 s)
    const retakes = (result.cuts ?? []).filter((cut) => cut.auto === 'retake');
    expect(result.speech.retakes).toBe(1);
    expect(retakes).toEqual([expect.objectContaining({ label: 'Retake: “Again”' })]);
    expect(retakes[0]!.from).toBeLessThan(7.755);
    expect(retakes[0]!.to).toBeGreaterThan(10.49 + 0.3);
    expect(retakes[0]!.to).toBeLessThanOrEqual(11.85);

    // the app's step once the transcript arrives: the same cuts again, nothing else touched
    const before = readFileSync(join(dir, 'cuttle.json'), 'utf8');
    const again = await applySpeechEdits(dir);
    expect(again.written).toBe(false);
    expect(readFileSync(join(dir, 'cuttle.json'), 'utf8')).toBe(before);
  }, 120_000);
});

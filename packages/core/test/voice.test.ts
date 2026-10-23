import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseProject, voiceLineKey, voiceRenderFiles, type CuttleProject, type CuttleProjectInput } from '@cuttle/project';
import { runFfmpeg } from '../src/ffmpeg';
import { wordsFromCharacters } from '../src/voice/elevenlabs';
import { renderVoiceover } from '../src/voice/render';
import { downloadVoice, voiceInstalled } from '../src/voice/voices';
import { spreadWords } from '../src/voice/words';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
afterEach(() => vi.unstubAllEnvs());

function folder(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function project(voiceover: CuttleProjectInput['voiceover']): CuttleProject {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, scenes: [{ type: 'card', id: 'c1', title: 'A', duration: 10 }], voiceover });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

/** A render's sound as samples: 48 kHz mono float, after the WAV header. */
function samples(path: string): Float32Array {
  const bytes = readFileSync(path);
  const data = bytes.indexOf('data', 12);
  const start = data + 8;
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + start + ((bytes.length - start) & ~3)));
}

describe('the narration as sound', () => {
  it('spreads words over a stretch by their letters (and a letter of space each)', () => {
    expect(spreadWords('a bb ccc', 0, 1.8)).toEqual([
      { t: 0, end: 0.4, text: 'a' },
      { t: 0.4, end: 1, text: 'bb' },
      { t: 1, end: 1.8, text: 'ccc' },
    ]);
  });

  it("makes words of ElevenLabs' characters and their times", () => {
    const characters = [...'Hi there'];
    const starts = characters.map((_, i) => i * 0.1);
    expect(wordsFromCharacters({ characters, character_start_times_seconds: starts, character_end_times_seconds: starts.map((t) => t + 0.08) })).toEqual([
      { t: 0, end: 0.18, text: 'Hi' },
      { t: 0.3, end: 0.78, text: 'there' },
    ]);
  });

  it('keys a line by what its sound depends on', () => {
    const voiceover = { voice: { provider: 'local' as const, id: 'en_US-amy-medium', speed: 1 } };
    const line = { text: 'Hello', at: 0, volume: 1, enabled: true };
    const key = voiceLineKey(voiceover, line);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    // the volume and the time do not change the sound; the text and the voice do
    expect(voiceLineKey(voiceover, { ...line, at: 3, volume: 0.5 })).toBe(key);
    expect(voiceLineKey(voiceover, { ...line, text: 'Hello!' })).not.toBe(key);
    expect(voiceLineKey({ voice: { ...voiceover.voice, speed: 1.2 } }, line)).not.toBe(key);
    expect(voiceRenderFiles(key)).toEqual({ sound: `voiceover/${key}.wav`, render: `voiceover/${key}.json` });
  });

  describe('through ElevenLabs (a stand-in)', () => {
    let server: Server;
    let mp3: string;
    const asked: { path: string; key: string | undefined; body: Record<string, unknown> }[] = [];
    beforeAll(async () => {
      // a second of tone as the voice's MP3, with the time of each character of "Hi there"
      const dir = folder('cuttle-eleven-');
      const file = join(dir, 'tone.mp3');
      await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=1:sample_rate=44100', '-c:a', 'libmp3lame', '-y', file]);
      mp3 = readFileSync(file).toString('base64');
      server = createServer((request, response) => {
        let body = '';
        request.on('data', (chunk: Buffer) => (body += chunk));
        request.on('end', () => {
          asked.push({ path: request.url ?? '', key: request.headers['xi-api-key'] as string | undefined, body: JSON.parse(body || '{}') as Record<string, unknown> });
          if (request.headers['xi-api-key'] !== 'good') {
            response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } }));
            return;
          }
          const characters = [...'Hi there'];
          const starts = characters.map((_, i) => i * 0.1);
          response.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({ audio_base64: mp3, alignment: { characters, character_start_times_seconds: starts, character_end_times_seconds: starts.map((t) => t + 0.08) } }),
          );
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it('speaks a line in a voice by its ID, with its words from the characters, and keeps it for next time', async () => {
      vi.stubEnv('CUTTLE_ELEVENLABS_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      const dir = folder('cuttle-voice-');
      const narration = project({ voice: { provider: 'elevenlabs', id: 'voice123', stability: 0.3 }, lines: [{ id: 'v1', text: 'Hi there', at: 1, scene: 'c1' }] });
      const [line] = await renderVoiceover(dir, narration, { elevenLabsKey: 'good' });
      expect(line).toMatchObject({ index: 0, fresh: true, render: { version: 1, voice: 'elevenlabs voice123', words: [{ text: 'Hi' }, { text: 'there' }] } });
      expect(line!.render.seconds).toBeGreaterThan(0.9);
      // 48 kHz mono float: a second of the tone, about
      expect(samples(join(dir, line!.sound)).length).toBeGreaterThan(44_000);
      expect(asked.at(-1)).toMatchObject({ path: '/v1/text-to-speech/voice123/with-timestamps?output_format=mp3_44100_128', key: 'good', body: { text: 'Hi there', model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.3 } } });
      // spoken once: the second time it is read
      const count = asked.length;
      const [again] = await renderVoiceover(dir, narration, { elevenLabsKey: 'good' });
      expect(again).toMatchObject({ fresh: false, key: line!.key });
      expect(asked.length).toBe(count);
    });

    it('says when the key is missing or refused', async () => {
      vi.stubEnv('CUTTLE_ELEVENLABS_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      vi.stubEnv('ELEVENLABS_API_KEY', '');
      const narration = project({ voice: { provider: 'elevenlabs', id: 'voice123' }, lines: [{ text: 'Hi', at: 0 }] });
      await expect(renderVoiceover(folder('cuttle-voice-'), narration)).rejects.toMatchObject({ code: 'voice-key' });
      await expect(renderVoiceover(folder('cuttle-voice-'), narration, { elevenLabsKey: 'bad' })).rejects.toMatchObject({ code: 'voice-key', message: expect.stringContaining('Invalid API key') });
    });
  });

  it("converts a file's line and times its words in its sound, and reads it again when the file changes", async () => {
    const dir = folder('cuttle-voice-');
    mkdirSync(join(dir, 'audio'));
    // two bursts of tone with a pause: "one two" / "three"
    const file = join(dir, 'audio', 'line.wav');
    await runFfmpeg(['-f', 'lavfi', '-i', "aevalsrc='if(between(t,0.2,1.0)+between(t,1.6,2.0),0.5*sin(2*PI*200*t),0)':s=44100:d=2.4", '-y', file]);
    const narration = project({ lines: [{ text: 'one two three', at: 0, scene: 'c1', file: 'audio/line.wav' }] });
    const [line] = await renderVoiceover(dir, narration);
    expect(line!.render.voice).toBe('file audio/line.wav');
    expect(line!.render.seconds).toBeCloseTo(2.4, 1);
    const [one, two, three] = line!.render.words;
    // "one two" share the first burst, "three" has the second
    expect(one!.t).toBeCloseTo(0.2, 1);
    expect(two!.end).toBeLessThan(1.2);
    expect(three!.t).toBeGreaterThan(1.4);
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-y', file]);
    const [changed] = await renderVoiceover(dir, narration);
    expect(changed).toMatchObject({ fresh: true });
    expect(changed!.render.seconds).toBeCloseTo(1, 1);
  });
});

/**
 * A real local voice: sherpa-onnx speaks with Piper's Amy (21 MB, downloaded once into a folder kept
 * between runs), on Windows and macOS alike: the engine loads, the archive unpacks, the line is heard.
 */
describe('a local voice (sherpa-onnx)', () => {
  const voices = join(tmpdir(), 'cuttle-test-voices');
  it('downloads a voice, unpacks it and speaks a line with it', async () => {
    vi.stubEnv('CUTTLE_MODELS_DIR', voices);
    await downloadVoice('en_US-amy-medium');
    expect(voiceInstalled('en_US-amy-medium')).toBe(true);
    const dir = folder('cuttle-voice-');
    const [line] = await renderVoiceover(dir, project({ voice: { provider: 'local', id: 'en_US-amy-medium' }, lines: [{ text: 'Welcome to Cuttle. This voice runs on your computer.', at: 0, scene: 'c1' }] }));
    expect(line!.render.voice).toBe('local en_US-amy-medium');
    expect(line!.render.seconds).toBeGreaterThan(2);
    expect(line!.render.seconds).toBeLessThan(8);
    expect(line!.render.words.map((word) => word.text)).toEqual(['Welcome', 'to', 'Cuttle.', 'This', 'voice', 'runs', 'on', 'your', 'computer.']);
    // the words lie inside the sound, in order
    const words = line!.render.words;
    expect(words.every((word, i) => word.end >= word.t && (i === 0 || word.t >= words[i - 1]!.t))).toBe(true);
    expect(words.at(-1)!.end).toBeLessThanOrEqual(line!.render.seconds + 0.01);
    // it is heard: the sound is not silence
    const heard = samples(join(dir, line!.sound));
    let peak = 0;
    for (const sample of heard) peak = Math.max(peak, Math.abs(sample));
    expect(peak).toBeGreaterThan(0.1);
  }, 180_000);

  it('says which voice to download when it is missing', async () => {
    vi.stubEnv('CUTTLE_MODELS_DIR', folder('cuttle-no-voices-'));
    await expect(renderVoiceover(folder('cuttle-voice-'), project({ voice: { provider: 'local', id: 'de_DE-thorsten-medium' }, lines: [{ text: 'Hallo', at: 0 }] }))).rejects.toMatchObject({
      code: 'voice-missing',
      message: expect.stringContaining('cuttle voice download de_DE-thorsten-medium'),
    });
  });
});

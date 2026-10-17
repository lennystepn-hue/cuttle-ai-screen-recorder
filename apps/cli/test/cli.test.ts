import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION, runCli } from '../src/main';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-cli-'));
  dirs.push(dir);
  return dir;
};

/** Runs the CLI in-process; `json` is stdout parsed when it is JSON. */
async function cli(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: (text) => void (stderr += text) });
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = undefined;
  }
  return { code, stdout, stderr, json };
}

/** The project folder's path in a result as `<project>`, with forward slashes, so a snapshot holds on every platform. */
const stable = (value: unknown, dir: string) =>
  JSON.parse(JSON.stringify(value).split(JSON.stringify(dir).slice(1, -1)).join('<project>').replaceAll('\\\\', '/'));

describe('cuttle init and errors', () => {
  it('creates a project and refuses to overwrite one', async () => {
    const dir = join(temp(), 'demo');
    const first = await cli('--json', 'init', dir);
    expect(first.code).toBe(0);
    expect(stable(first.json, dir)).toMatchInlineSnapshot(`
      {
        "project": "<project>/cuttle.json",
      }
    `);
    expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'))).toEqual({ version: 1, sources: { screen: 'takes/1/screen.mp4' } });
    const again = await cli('--json', 'init', dir);
    expect(again.code).toBe(1);
    expect(stable(again.json, dir)).toMatchInlineSnapshot(`
      {
        "error": {
          "code": "usage",
          "message": "<project> already has a cuttle.json",
        },
      }
    `);
  });

  it('maps usage and project errors to exit code 1, with one JSON error on stdout', async () => {
    const dir = temp();
    expect((await cli('nonsense')).code).toBe(1);
    // commander's own usage errors (explained on stderr) still give one JSON document with --json
    for (const argv of [['--json', 'nonsense'], ['--json', 'record', '--monitor', 'x'], ['recover', '--json'], ['--json']]) {
      const usage = await cli(...argv);
      expect(usage.code, argv.join(' ')).toBe(1);
      expect((usage.json as { error: { code: string } }).error.code, argv.join(' ')).toBe('usage');
    }
    expect((await cli('--json')).json).toEqual({ error: { code: 'usage', message: 'no command given ("cuttle --help" lists them)' } });
    // --version and --help answer in JSON too
    expect((await cli('--json', '--version')).json).toEqual({ version: VERSION });
    const help = await cli('--json', 'render', '--help');
    expect(help.code).toBe(0);
    expect((help.json as { help: string }).help).toMatch(/^Usage: cuttle render/);
    const missing = await cli('--json', '-C', dir, 'suggest');
    expect(missing.code).toBe(1);
    expect((missing.json as { error: { code: string } }).error.code).toBe('invalid-project');
    await cli('init', join(dir, 'p'));
    const noScenes = await cli('--json', '-C', join(dir, 'p'), 'preview');
    expect(noScenes.code).toBe(1);
    expect((noScenes.json as { error: { message: string } }).error.message).toMatch(/has no scenes yet/);
    const region = await cli('--json', '-C', join(dir, 'p'), 'record', '--backend', 'test', '--region', '1,2');
    expect(region.code).toBe(1);
    expect((region.json as { error: { message: string } }).error.message).toMatch(/--region needs x,y,w,h/);
  });
});

describe('cuttle devices and record (test backend)', () => {
  it('lists the test devices', async () => {
    const { code, json } = await cli('--json', 'devices', '--backend', 'test');
    expect(code).toBe(0);
    expect(json).toMatchInlineSnapshot(`
      {
        "cameras": [
          "Test Camera",
          "Failing Test Camera",
        ],
        "mics": [
          "Test Microphone",
          "Silent Test Microphone",
        ],
        "monitors": [
          {
            "bounds": {
              "height": 720,
              "width": 1280,
              "x": 0,
              "y": 0,
            },
            "index": 0,
            "name": "Test Monitor",
            "primary": true,
            "scale": 1,
          },
          {
            "bounds": {
              "height": 360,
              "width": 640,
              "x": 1280,
              "y": 0,
            },
            "index": 1,
            "name": "Still Test Monitor",
            "primary": false,
            "scale": 1,
          },
        ],
        "windows": [
          {
            "bounds": {
              "height": 360,
              "width": 640,
              "x": 100,
              "y": 60,
            },
            "className": "TestWindow",
            "id": 1001,
            "monitor": 0,
            "pid": 4242,
            "title": "Test Window",
          },
        ],
      }
    `);
  });

  it('records a take into a new project and points the project at it', async () => {
    const dir = join(temp(), 'demo');
    const { code, json, stderr } = await cli('--json', '-C', dir, 'record', '--backend', 'test', '--mic', '--max', '2', '--countdown', '0');
    expect(code).toBe(0);
    expect(stderr).toBe(''); // --json: no status lines
    const result = json as { project: string; take: { dir: string; seconds: number; stopReason: string; mic?: string } };
    expect(result.take).toMatchObject({ dir: 'takes/1', mic: 'takes/1/mic.m4a', stopReason: 'max-seconds' });
    const project = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    expect(project.sources).toEqual({
      screen: 'takes/1/screen.mp4',
      mic: 'takes/1/mic.m4a',
      events: 'takes/1/events.jsonl',
      markers: 'takes/1/markers.json',
    });
    expect(project.scenes).toEqual([{ type: 'clip', from: 0, to: Math.floor(result.take.seconds * 1000) / 1000 }]);
  }, 20_000);

  it('refuses a project open in the Cuttle app, unless forced or its app is gone', async () => {
    const dir = join(temp(), 'demo');
    mkdirSync(join(dir, '.cuttle'), { recursive: true });
    // this process stands in for the app on this computer
    writeFileSync(join(dir, '.cuttle', 'editor.lock'), JSON.stringify({ host: hostname(), pid: process.pid }));
    const refused = await cli('--json', '-C', dir, 'record', '--backend', 'test', '--max', '1', '--countdown', '0');
    expect(refused.code).toBe(1);
    expect(refused.json).toMatchObject({ error: { code: 'project-open' } });
    expect(existsSync(join(dir, 'takes'))).toBe(false);
    const forced = await cli('--json', '-C', dir, 'record', '--backend', 'test', '--max', '1', '--countdown', '0', '--force');
    expect(forced.code).toBe(0);
    // an app that crashed left its lock: no process has its id any more
    const gone = spawnSync(process.execPath, ['-e', '']).pid!;
    writeFileSync(join(dir, '.cuttle', 'editor.lock'), JSON.stringify({ host: hostname(), pid: gone }));
    expect((await cli('--json', '-C', dir, 'record', '--backend', 'test', '--max', '1', '--countdown', '0')).code).toBe(0);
  }, 30_000);

  it('takes a region split at its commas (as PowerShell passes it) and hides the drawn cursor with --draw-mouse', async () => {
    const dir = join(temp(), 'demo');
    const { code, json } = await cli('--json', '-C', dir, 'record', '--backend', 'test', '--region', '0', '0', '640', '360', '--draw-mouse', '--max', '1', '--countdown', '0');
    expect(code).toBe(0);
    expect((json as { take: { screenSize: unknown } }).take.screenSize).toEqual({ width: 640, height: 360 });
    expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')).look).toEqual({ cursor: { enabled: false } });
  }, 20_000);

  it('keeps an edit made to cuttle.json during the take', async () => {
    const dir = join(temp(), 'demo');
    const path = join(dir, 'cuttle.json');
    let stderr = '';
    const code = await runCli(['-C', dir, 'record', '--backend', 'test', '--max', '1', '--countdown', '0'], {
      stdout: () => {},
      stderr: (chunk) => {
        // "recording takes/1 …": the take runs; edit the project as a person or the app would
        if (chunk.startsWith('recording takes/1')) {
          const project = JSON.parse(readFileSync(path, 'utf8'));
          writeFileSync(path, JSON.stringify({ ...project, look: { frame: { title: 'edited during the take' } } }));
        }
        stderr += chunk;
      },
    });
    expect(code, stderr).toBe(0);
    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.look).toEqual({ frame: { title: 'edited during the take' } });
    expect(written.sources.screen).toBe('takes/1/screen.mp4');
  }, 30_000);

  it('stops the recording on Ctrl+C, keeps the take and removes its handlers', async () => {
    const dir = join(temp(), 'demo');
    const listeners = process.listenerCount('SIGBREAK');
    const running = cli('--json', '-C', dir, 'record', '--backend', 'test', '--max', '20', '--countdown', '0');
    // take.json appears once every track runs; SIGBREAK is Ctrl+Break, handled like Ctrl+C.
    while (!existsSync(join(dir, 'takes', '1', 'take.json'))) await new Promise((done) => setTimeout(done, 50));
    process.emit('SIGBREAK');
    const { code, json } = await running;
    expect(code).toBe(0);
    expect((json as { take: { stopReason: string; seconds: number } }).take).toMatchObject({ stopReason: 'stop' });
    expect((json as { take: { seconds: number } }).take.seconds).toBeLessThan(10);
    expect(process.listenerCount('SIGBREAK')).toBe(listeners);
  }, 30_000);

  it('stops when the stop file appears and removes it, so the next take can use it again', async () => {
    const dir = join(temp(), 'demo');
    const stopFile = join(dir, 'stop');
    const running = cli('--json', '-C', dir, 'record', '--backend', 'test', '--until-file', stopFile, '--max', '20', '--countdown', '0');
    while (!existsSync(join(dir, 'takes', '1', 'take.json'))) await new Promise((done) => setTimeout(done, 50));
    writeFileSync(stopFile, '');
    const { code, json } = await running;
    expect(code).toBe(0);
    expect((json as { take: { stopReason: string } }).take.stopReason).toBe('file');
    expect(existsSync(stopFile)).toBe(false);
  }, 30_000);
});

/**
 * A 20 s screen recording where only a white box moves, from 3 to 17 s; typing at 3.2–3.8 s, a
 * prompt marker at 3.8 s and Claude's answer at 16 s.
 */
function takeFixture(projectDir: string, take = 'takes/1'): void {
  const dir = join(projectDir, take);
  mkdirSync(dir, { recursive: true });
  const graph = "color=c=0x202020:s=1280x720:r=30:d=20[bg];color=c=white:s=80x80:r=30:d=20[box];[bg][box]overlay=x='100+mod(t*200,300)':y=500:enable='between(t,3,17)'[out0]";
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', graph, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(dir, 'screen.mp4')]);
  if (result.status !== 0) throw new Error(String(result.stderr));
  writeFileSync(join(dir, 'events.jsonl'), [3.2, 3.5, 3.8].map((t) => `${JSON.stringify({ t, type: 'keys', count: 1 })}\n`).join(''));
  writeFileSync(join(dir, 'markers.json'), JSON.stringify({ version: 1, markers: [{ t: 3.8, kind: 'prompt' }, { t: 16, kind: 'answer' }] }));
  writeFileSync(join(dir, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 } } }));
  writeFileSync(
    join(projectDir, 'cuttle.json'),
    JSON.stringify({ version: 1, sources: { screen: `${take}/screen.mp4`, events: `${take}/events.jsonl`, markers: `${take}/markers.json` } }),
  );
}

describe('cuttle models and transcribe', () => {
  it('lists the speech models, none downloaded here', async () => {
    const { code, json } = await cli('--json', 'models');
    expect(code).toBe(0);
    const list = json as { dir: string; models: { name: string; installed: boolean; default: boolean; bytes: number }[] };
    // the tests' own empty folder (vitest.config.ts), never the user's
    expect(list.dir).toBe(process.env.CUTTLE_MODELS_DIR);
    expect(list.models.map((model) => [model.name, model.installed, model.default, Math.round(model.bytes / 1e6)])).toEqual([
      ['base', false, false, 148],
      ['small', false, true, 488],
      ['large-v3-turbo-q5_0', false, false, 574],
    ]);
    const text = await cli('models');
    expect(text.stdout).toContain('download one: cuttle models download small');
    expect((await cli('--json', 'models', 'download', 'huge')).json).toEqual({
      error: { code: 'usage', message: 'unknown speech model "huge" (one of base, small, large-v3-turbo-q5_0)' },
    });
  });

  it('says what transcribe needs (a mic, then a model), and suggest goes on without it', async () => {
    const dir = temp();
    takeFixture(dir);
    const noMic = await cli('--json', '-C', dir, 'transcribe');
    expect(noMic.code).toBe(1);
    expect(noMic.json).toEqual({ error: { code: 'usage', message: 'the take has no mic track: record with --mic to transcribe what was said' } });
    const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=20', '-c:a', 'aac', '-y', join(dir, 'takes', '1', 'mic.m4a')]);
    if (result.status !== 0) throw new Error(String(result.stderr));
    const path = join(dir, 'cuttle.json');
    const project = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...project, sources: { ...project.sources, mic: 'takes/1/mic.m4a' } }));
    const noModel = await cli('--json', '-C', dir, 'transcribe', '--language', 'de');
    expect(noModel.code).toBe(1);
    expect(noModel.json).toEqual({ error: { code: 'model-missing', message: 'no speech model is downloaded: run "cuttle models download small" (488 MB, once)' } });
    expect((await cli('--json', '-C', dir, 'transcribe', '--language', 'Deutsch')).json).toEqual({
      error: { code: 'usage', message: '--language takes "auto" or a language code such as "de" or "en", not "Deutsch"' },
    });
    const suggested = await cli('--json', '-C', dir, 'suggest');
    expect(suggested.code).toBe(0);
    const { notes, speech } = suggested.json as { notes: string[]; speech: unknown };
    expect(notes[0]).toBe('the mic was not transcribed: no speech model is downloaded ("cuttle models download small"), so filler words and pauses stay');
    // a steady tone is not speech
    expect(speech).toEqual({ from: 'mic', fillers: 0, pauses: 0, retakes: 0 });
    // --no-speech leaves the mic out altogether
    const without = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-speech');
    expect((without.json as { notes: string[]; speech: unknown }).speech).toEqual({ from: 'none', fillers: 0, pauses: 0, retakes: 0 });
  }, 30_000);
});

describe('cuttle transcript', () => {
  it('gives the words with the fixes, and the captions on the video\'s time as JSON, SRT, VTT or text', async () => {
    const dir = temp();
    takeFixture(dir);
    expect((await cli('--json', '-C', dir, 'transcript')).json).toEqual({ error: { code: 'usage', message: 'the project has no transcript: run "cuttle transcribe" first' } });
    writeFileSync(
      join(dir, 'takes', '1', 'transcript.json'),
      JSON.stringify({ version: 1, language: 'de', model: 'small', words: [{ t: 1, end: 1.4, text: 'Das' }, { t: 1.4, end: 1.8, text: 'ist' }, { t: 1.8, end: 2.4, text: 'Holofisch.' }, { t: 6, end: 6.5, text: 'Weg' }] }),
    );
    const path = join(dir, 'cuttle.json');
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(
      path,
      JSON.stringify({
        ...raw,
        sources: { ...raw.sources, transcript: 'takes/1/transcript.json' },
        // the second clip starts at 1 s of the video; "Weg" lies in the cut
        scenes: [{ type: 'clip', from: 0.5, to: 3 }, { type: 'clip', from: 5, to: 8 }],
        cuts: [{ from: 5.9, to: 6.6 }],
        captions: { fixes: [{ at: 1.8, end: 2.4, text: 'Holofish.' }] },
      }),
    );
    const { code, json } = await cli('--json', '-C', dir, 'transcript');
    expect(code).toBe(0);
    expect(json).toEqual({
      transcript: 'takes/1/transcript.json',
      language: 'de',
      model: 'small',
      words: [
        { t: 1, end: 1.4, text: 'Das' },
        { t: 1.4, end: 1.8, text: 'ist' },
        { t: 1.8, end: 2.4, text: 'Holofish.' },
        { t: 6, end: 6.5, text: 'Weg' },
      ],
      cues: [{ start: 0.5, end: 2.5, text: 'Das ist Holofish.' }],
    });
    expect((await cli('-C', dir, 'transcript', '--srt')).stdout).toBe('1\n00:00:00,500 --> 00:00:02,500\nDas ist Holofish.\n');
    expect((await cli('-C', dir, 'transcript', '--vtt')).stdout).toBe('WEBVTT\n\n00:00:00.500 --> 00:00:02.500\nDas ist Holofish.\n');
    expect((await cli('-C', dir, 'transcript', '--text')).stdout).toBe('Das ist Holofish. Weg\n');
    expect((await cli('--json', '-C', dir, 'transcript', '--srt')).json).toEqual({ format: 'srt', content: '1\n00:00:00,500 --> 00:00:02,500\nDas ist Holofish.\n' });
    expect((await cli('--json', '-C', dir, 'transcript', '--srt', '--vtt')).json).toEqual({ error: { code: 'usage', message: 'choose one of --srt, --vtt and --text' } });
  });
});

describe('cuttle suggest and recover', () => {
  let fixture: string;
  beforeAll(() => {
    fixture = temp();
    takeFixture(fixture);
  });

  it('trims, speeds up the wait and zooms on the answer', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const { code, json } = await cli('--json', '-C', dir, 'suggest');
    expect(code).toBe(0);
    expect(stable(json, dir)).toMatchInlineSnapshot(`
      {
        "backup": "<project>/cuttle.json.bak",
        "markers": {
          "count": 2,
          "from": "take",
        },
        "notes": [
          "trimmed the quiet start (0.0–1.8 s)",
          "trimmed the quiet end (18.5–20.0 s)",
          "sped up 9.4 s without input 3× (5.1–14.5 s)",
          "zoom on Claude's answer at 15.5 s (145, 422, 448, 236)",
        ],
        "project": "<project>/cuttle.json",
        "scenes": [
          {
            "from": 1.8,
            "id": "s1",
            "label": "Prompt",
            "to": 5.1,
            "type": "clip",
          },
          {
            "from": 5.1,
            "id": "s2",
            "label": "Claude at work",
            "speed": 3,
            "to": 14.5,
            "type": "clip",
          },
          {
            "from": 14.5,
            "id": "s3",
            "label": "Answer",
            "to": 18.5,
            "type": "clip",
          },
        ],
        "speech": {
          "fillers": 0,
          "from": "none",
          "pauses": 0,
          "retakes": 0,
        },
        "written": true,
        "zooms": [
          {
            "at": 15.5,
            "auto": "answer",
            "duration": 3,
            "id": "z1",
            "label": "Answer",
            "rect": [
              145,
              422,
              448,
              236,
            ],
          },
        ],
      }
    `);
    const project = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    expect(project.scenes).toEqual((json as { scenes: unknown }).scenes);
    expect(existsSync(join(dir, 'cuttle.json.bak'))).toBe(true);
  }, 30_000);

  it('zooms on clicks where the work happens at 1×, and leaves them out with --no-click-zooms', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    // typing from 3 to 12 s (no waiting to speed up) and two clicks at one spot
    const events = [
      ...Array.from({ length: 31 }, (_, i) => ({ t: 3 + i * 0.3, type: 'keys', count: 1 })),
      { t: 6, type: 'click', x: 400, y: 300, button: 'left' },
      { t: 6.6, type: 'click', x: 430, y: 320, button: 'left' },
    ].sort((a, b) => a.t - b.t);
    writeFileSync(join(dir, 'takes/1/events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    type Zooms = { zooms: { label: string; at: number; duration: number; rect: number[] }[]; notes: string[] };
    // the typing comes first: its zoom follows what the screen changes, over the clicks
    const typed = (await cli('--json', '-C', dir, 'suggest', '--dry-run')).json as Zooms;
    expect(typed.zooms.map((zoom) => zoom.label)).toEqual(['Typing', 'Answer']);
    const { code, json } = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-typing-zooms');
    expect(code).toBe(0);
    const zooms = (json as Zooms).zooms;
    expect(zooms.find((zoom) => zoom.label === 'Clicks')).toMatchObject({ at: 5.3, duration: 2.5, rect: [127, 148, 576, 324] });
    expect((json as Zooms).notes).toContain('1 zoom on clicks');
    const without = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-typing-zooms', '--no-click-zooms');
    expect((without.json as Zooms).zooms.map((zoom) => zoom.label)).not.toContain('Clicks');
  }, 30_000);

  it('replaces only the zooms it made: hand-made ones stay, one switched off stays off, a kind switched off is not made', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const events = [
      ...Array.from({ length: 31 }, (_, i) => ({ t: 3 + i * 0.3, type: 'keys', count: 1 })),
      { t: 6, type: 'click', x: 400, y: 300, button: 'left' },
      { t: 6.6, type: 'click', x: 430, y: 320, button: 'left' },
    ].sort((a, b) => a.t - b.t);
    writeFileSync(join(dir, 'takes/1/events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    // the click zooms' rules here: the typing over the clicks gets no zoom
    const first = await cli('--json', '-C', dir, 'suggest', '--no-typing-zooms');
    expect(first.code).toBe(0);
    type Zoom = { id: string; label?: string; at: number; duration: number; rect: number[]; auto?: string; enabled?: boolean };
    const made = (first.json as { zooms: Zoom[] }).zooms;
    expect(made.map((zoom) => zoom.auto)).toContain('click');
    const answer = made.find((zoom) => zoom.auto === 'answer');
    expect(answer).toBeDefined();
    // the person switches the click zoom off and puts a zoom of their own where the answer is
    const file = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    file.zooms = [
      ...file.zooms.filter((zoom: Zoom) => zoom.auto !== 'answer').map((zoom: Zoom) => (zoom.auto === 'click' ? { ...zoom, enabled: false } : zoom)),
      { id: 'z9', label: 'Mine', at: answer!.at, duration: 2, rect: [0, 0, 800, 450] },
    ];
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify(file, null, 2));
    const again = (await cli('--json', '-C', dir, 'suggest', '--no-typing-zooms')).json as { zooms: Zoom[]; notes: string[] };
    expect(again.zooms.find((zoom) => zoom.id === 'z9')).toMatchObject({ label: 'Mine', at: answer!.at });
    expect(again.zooms.find((zoom) => zoom.auto === 'click')).toMatchObject({ enabled: false });
    expect(again.notes).toContain('kept 1 zoom made or changed by hand');
    // the answer zoom keeps clear of the zoom made by hand there
    expect(again.zooms.filter((zoom) => zoom.auto === 'answer')).toEqual([]);
    expect(again.notes).toContain('no zoom on the answer: a zoom made by hand is there');
    // click zooms switched off as a kind: none made
    const off = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ ...off, autoEdits: { clickZooms: false } }, null, 2));
    const none = (await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-typing-zooms')).json as { zooms: Zoom[] };
    expect(none.zooms.map((zoom) => zoom.auto)).not.toContain('click');
  }, 60_000);

  it('zooms on typing and follows the text along the line, from the screen alone or from the caret', async () => {
    const dir = temp();
    mkdirSync(join(dir, 'takes', '1'), { recursive: true });
    // a 1280×720 screen where 50 letters are typed on a line at y 400, from x 80 to 1062, between 2 and 9.35 s
    const letters = Array.from({ length: 50 }, (_, k) => `drawbox=x=${80 + 20 * k}:y=400:w=14:h=22:color=white:t=fill:enable='gte(t,${(2 + 0.15 * k).toFixed(2)})'`);
    const made = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x202020:s=1280x720:r=30:d=14,${letters.join(',')}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(dir, 'takes', '1', 'screen.mp4')]);
    expect(made.status, String(made.stderr)).toBe(0);
    const keys = Array.from({ length: 15 }, (_, k) => ({ t: 2 + 0.5 * k, type: 'keys', count: 3 }));
    const write = (events: unknown[]) => writeFileSync(join(dir, 'takes', '1', 'events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    write(keys);
    writeFileSync(join(dir, 'takes', '1', 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 } } }));
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', events: 'takes/1/events.jsonl' } }));
    type Rect = [number, number, number, number];
    type Result = { zooms: { label: string; at: number; duration: number; rect: Rect; moves?: { at: number; rect: Rect }[]; auto: string }[]; notes: string[] };
    const fromScreen = (await cli('--json', '-C', dir, 'suggest', '--dry-run')).json as Result;
    const typing = fromScreen.zooms.find((zoom) => zoom.auto === 'typing')!;
    // the quiet start is trimmed (the clip starts at 1.2 s), and no zoom starts within 1 s of a clip's edge
    expect(typing).toMatchObject({ label: 'Typing', at: 2.2 });
    // the view (576 px wide) starts on the first letters and moves right along the line, with the letters in it
    const [x, y, width, height] = typing.rect;
    expect(x).toBeLessThanOrEqual(80);
    expect(y < 400 && y + height > 422 && width === 576).toBe(true);
    const moves = typing.moves ?? [];
    expect(moves.length).toBeGreaterThanOrEqual(2);
    for (const [i, move] of moves.entries()) {
      expect(move.rect[0]).toBeGreaterThan(i === 0 ? x : moves[i - 1]!.rect[0]);
      // the letter typed then lies in the view
      const letter = 80 + 20 * Math.floor((move.at - 2) / 0.15);
      expect(letter >= move.rect[0] && letter < move.rect[0] + width).toBe(true);
    }
    expect(fromScreen.notes.some((note) => /^1 zoom while typing, \d+ moves following the text \(what the screen changed\)$/.test(note))).toBe(true);
    // with the caret the zoom follows it instead (here it says the letters are 100 px lower)
    write([...keys, ...Array.from({ length: 25 }, (_, k) => ({ t: 2.1 + 0.3 * k, type: 'caret', rect: [80 + 40 * k, 500, 2, 22] }))].sort((a, b) => a.t - b.t));
    const fromCaret = (await cli('--json', '-C', dir, 'suggest', '--dry-run')).json as Result;
    const following = fromCaret.zooms.find((zoom) => zoom.auto === 'typing')!;
    expect(following.rect[1] + following.rect[3] / 2).toBeCloseTo(511, 0);
    expect(fromCaret.notes.some((note) => note.endsWith('following the text (the caret)'))).toBe(true);
    const none = (await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-typing-zooms')).json as Result;
    expect(none.zooms.filter((zoom) => zoom.auto === 'typing')).toEqual([]);
  }, 60_000);

  it('leaves cuttle.json alone with --dry-run', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const before = readFileSync(join(dir, 'cuttle.json'), 'utf8');
    const { code, json } = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-zoom');
    expect(code).toBe(0);
    expect(json).toMatchObject({ written: false, zooms: [] });
    expect(readFileSync(join(dir, 'cuttle.json'), 'utf8')).toBe(before);
  }, 30_000);

  it('keeps still and card scenes, and older versions of cuttle.json as rotating backups', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const path = join(dir, 'cuttle.json');
    const original = readFileSync(path, 'utf8');
    const title = { type: 'card', title: 'A demo', duration: 2 };
    const card = { type: 'card', title: 'The end', duration: 2 };
    writeFileSync(path, JSON.stringify({ ...JSON.parse(original), scenes: [title, { type: 'clip', from: 0, to: 5 }, card] }));
    const edited = readFileSync(path, 'utf8');
    const first = await cli('--json', '-C', dir, 'suggest', '--no-zoom');
    const scenes = (first.json as { scenes: unknown[] }).scenes;
    expect([scenes[0], scenes.at(-1)]).toEqual([title, card]); // a title card stays first, an end card last
    expect((first.json as { notes: string[] }).notes).toContain('kept 2 still or card scene(s), 1 before the clips');
    const suggested = readFileSync(path, 'utf8');
    await cli('--json', '-C', dir, 'suggest', '--no-zoom'); // the same suggestion again
    // .bak holds the version before the last run; the one before it moved to .bak.1
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe(suggested);
    expect(readFileSync(`${path}.bak.1`, 'utf8')).toBe(edited);
    expect(existsSync(`${path}.bak.2`)).toBe(false);
  }, 30_000);

  it('keeps the ids and labels of what it keeps, and gives its clips and zoom new ones', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const path = join(dir, 'cuttle.json');
    const card = { type: 'card', id: 's1', label: 'End', title: 'The end', duration: 2 };
    const mask = { id: 'm1', label: 'Token', from: 0, to: 20, rect: [0, 0, 100, 40] };
    const text = { id: 'z1', label: 'Hook', at: 4, duration: 2, text: 'One prompt' };
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), scenes: [{ type: 'clip', id: 's9', from: 0, to: 5 }, card], masks: [mask], texts: [text] }));
    const { code } = await cli('--json', '-C', dir, 'suggest');
    expect(code).toBe(0);
    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.scenes.map((scene: { id: string; label?: string }) => [scene.id, scene.label])).toEqual([
      ['s2', 'Prompt'],
      ['s3', 'Claude at work'],
      ['s4', 'Answer'],
      ['s1', 'End'],
    ]);
    expect(written.zooms.map((zoom: { id: string; label: string }) => [zoom.id, zoom.label])).toEqual([['z2', 'Answer']]);
    expect([written.masks, written.texts]).toEqual([[mask], [text]]);
  }, 30_000);

  it('never gives a new item the id of one it replaced', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const ids = async () => {
      expect((await cli('--json', '-C', dir, 'suggest')).code).toBe(0);
      const written = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
      return [...written.scenes, ...written.zooms].map((item: { id: string }) => item.id);
    };
    const first = await ids();
    const second = await ids();
    expect(first).toEqual(['s1', 's2', 's3', 'z1']);
    expect(second).toEqual(['s4', 's5', 's6', 'z2']);
  }, 30_000);

  it('refuses to overwrite cuttle.json saved by someone else while it ran', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const path = join(dir, 'cuttle.json');
    const theirs = JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), texts: [{ at: 1, duration: 2, text: 'saved meanwhile' }] });
    let stderr = '';
    const code = await runCli(['-C', dir, 'suggest'], {
      stdout: () => {},
      stderr: (chunk) => {
        // the first status line comes after suggest read cuttle.json: save it now, as the app would
        if (stderr === '') writeFileSync(path, theirs);
        stderr += chunk;
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain(`error: ${path} changed while suggest ran, so it was left as it is; run suggest again`);
    expect(readFileSync(path, 'utf8')).toBe(theirs);
  }, 30_000);

  it('repairs a crashed take and uses it', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const take = join(dir, 'takes', '1');
    rmSync(join(take, 'take.json'));
    rmSync(join(take, 'markers.json'));
    writeFileSync(join(take, 'events.jsonl'), '{"t":1,"type":"keys","count":1}\n{"t":2,"type":"ke'); // cut off by the crash
    const { code, json } = await cli('--json', '-C', dir, 'recover', 'takes/1');
    expect(code).toBe(0);
    expect(stable(json, dir)).toMatchInlineSnapshot(`
      {
        "keptEdit": false,
        "project": "<project>/cuttle.json",
        "repaired": [
          "events.jsonl: kept 1 events, dropped 1 broken or cut-off line(s) (old file: events.jsonl.bak)",
          "markers.json was missing: written empty",
          "take.json was missing: written with the tracks starting together at an unknown time",
        ],
        "seconds": 20,
        "take": "takes/1",
        "tracks": [
          "screen",
        ],
      }
    `);
    expect(readFileSync(join(take, 'events.jsonl'), 'utf8')).toBe('{"t":1,"type":"keys","count":1}\n');
    expect(JSON.parse(readFileSync(join(take, 'take.json'), 'utf8'))).toEqual({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 0 } } });
    // Recovering the take the project uses keeps the edit.
    const path = join(dir, 'cuttle.json');
    const text = { at: 2, duration: 2, text: 'hello' };
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), texts: [text] }));
    const recovered = await cli('--json', '-C', dir, 'recover', 'takes/1');
    expect(recovered.json).toMatchObject({ repaired: [], keptEdit: true }); // nothing left to repair
    expect(JSON.parse(readFileSync(path, 'utf8')).texts).toEqual([text]);
  }, 30_000);

  it('keeps readable start times of a broken take.json, and touches nothing when cuttle.json is broken', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const take = join(dir, 'takes', '1');
    const broken = JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1792189686.2 } }, note: 'unknown key' });
    writeFileSync(join(take, 'take.json'), broken);
    const { code, json } = await cli('--json', '-C', dir, 'recover', 'takes/1');
    expect(code).toBe(0);
    expect((json as { repaired: string[] }).repaired).toEqual(["take.json was broken (old file: take.json.bak): rewritten with the screen's start time"]);
    expect(JSON.parse(readFileSync(join(take, 'take.json'), 'utf8')).tracks.screen.start).toBe(1792189686.2);
    expect(readFileSync(join(take, 'take.json.bak'), 'utf8')).toBe(broken);

    writeFileSync(join(dir, 'cuttle.json'), '{ "version": 1 }');
    rmSync(join(take, 'markers.json'));
    const refused = await cli('--json', '-C', dir, 'recover', 'takes/1');
    expect((refused.json as { error: { code: string } }).error.code).toBe('invalid-project');
    expect(existsSync(join(take, 'markers.json'))).toBe(false);
  }, 30_000);

  it('refuses a take outside the project and one without video', async () => {
    const dir = temp();
    const outside = await cli('--json', '-C', dir, 'recover', '..');
    expect(outside.code).toBe(1);
    expect((outside.json as { error: { code: string } }).error.code).toBe('usage');
    mkdirSync(join(dir, 'takes', '9'), { recursive: true });
    const empty = await cli('--json', '-C', dir, 'recover', 'takes/9');
    expect(empty.code).toBe(1);
    expect((empty.json as { error: { code: string } }).error.code).toBe('invalid-media');
  });
});

/** Width and height of a PNG, from its IHDR chunk. */
const pngSize = (file: string) => {
  const bytes = readFileSync(file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

describe('cuttle frame', () => {
  it('writes a source frame at full size, with a numbered grid on request', async () => {
    const dir = temp();
    takeFixture(dir);
    const plain = await cli('--json', '-C', dir, 'frame', '10');
    expect(stable(plain.json, dir)).toEqual({ t: 10, file: '<project>/frames/10.00s.png', width: 1280, height: 720, grid: false, labels: false });
    expect(pngSize(join(dir, 'frames', '10.00s.png'))).toEqual([1280, 720]);
    // A path ffmpeg's image writer could read as a frame-number pattern (%d) is written as it is.
    const out = join(dir, 'pct 100%d', 'grid.png');
    const grid = await cli('--json', '-C', dir, 'frame', '10', '--grid', '-o', out);
    expect(grid.json).toMatchObject({ grid: true, labels: expect.any(Boolean) });
    if (process.platform === 'win32') expect((grid.json as { labels: boolean }).labels).toBe(true); // Windows always has Arial
    expect(pngSize(out)).toEqual([1280, 720]);
  });

  it('refuses a time without a frame instead of handing back an old file, and a missing screen track', async () => {
    const dir = temp();
    takeFixture(dir);
    const past = await cli('--json', '-C', dir, 'frame', '25');
    expect((past.json as { error: unknown }).error).toEqual({ code: 'usage', message: 'the screen track is 20.00 s long; 25 s is past its end' });
    // 19.99 s is inside the last frame (it starts at 19.967 s): ffmpeg writes nothing for it.
    const stale = join(dir, 'stale.png');
    writeFileSync(stale, 'an older frame');
    const inside = await cli('--json', '-C', dir, 'frame', '19.99', '-o', stale);
    expect((inside.json as { error: { code: string; message: string } }).error.message).toMatch(/^no frame starts at or after 19\.99 s/);
    expect(existsSync(stale)).toBe(false);
    rmSync(join(dir, 'takes', '1', 'screen.mp4'));
    const missing = await cli('--json', '-C', dir, 'frame', '1');
    expect((missing.json as { error: { code: string } }).error.code).toBe('missing-file');
  });
});

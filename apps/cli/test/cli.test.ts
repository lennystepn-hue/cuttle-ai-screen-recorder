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
        "written": true,
        "zooms": [
          {
            "at": 15.5,
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
    const { code, json } = await cli('--json', '-C', dir, 'suggest', '--dry-run');
    expect(code).toBe(0);
    const zooms = (json as { zooms: { label: string; at: number; duration: number; rect: number[] }[] }).zooms;
    expect(zooms.find((zoom) => zoom.label === 'Clicks')).toMatchObject({ at: 5.3, duration: 2.5, rect: [127, 148, 576, 324] });
    expect((json as { notes: string[] }).notes).toContain('1 zoom(s) on clicks');
    const without = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-click-zooms');
    expect((without.json as { zooms: { label: string }[] }).zooms.map((zoom) => zoom.label)).not.toContain('Clicks');
  }, 30_000);

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

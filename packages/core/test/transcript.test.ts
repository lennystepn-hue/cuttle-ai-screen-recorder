import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { claudeTranscriptDir } from '@cuttle/recorder';
import { takeClock, transcriptMarkers } from '../src/suggest/transcript';

const config = mkdtempSync(join(tmpdir(), 'cuttle-transcript-'));
afterAll(() => rm(config, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

/** A line at `start + t` seconds. */
const at = (t: number, value: object) => `${JSON.stringify({ timestamp: new Date((1000 + t) * 1000).toISOString(), ...value })}\n`;
const prompt = (t: number) => at(t, { type: 'user', message: { content: 'build it' } });
const tool = (t: number, id: string, name: string) => at(t, { type: 'assistant', message: { id: `m${id}`, stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name }] } });
const answer = (t: number, id: string) => at(t, { type: 'assistant', message: { id, stop_reason: 'end_turn', content: [{ type: 'text' }] } });

describe('transcriptMarkers', () => {
  it("takes the session that was busiest during the take, in the take's seconds", async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', config);
    const cwd = join(config, 'demo');
    const dir = claudeTranscriptDir(cwd);
    mkdirSync(dir, { recursive: true });
    // The demo session: a local /model before the prompt, a tool call, the answer split over two lines.
    writeFileSync(
      join(dir, 'demo.jsonl'),
      [
        prompt(-30), // before the take
        at(1, { type: 'user', message: { content: '<command-name>/model</command-name>' } }),
        at(1.1, { type: 'user', message: { content: '<local-command-stdout>Set model</local-command-stdout>' } }),
        prompt(2),
        tool(4, 't1', 'Bash'),
        answer(9, 'a1'),
        answer(9, 'a1'),
        prompt(70), // after the take
      ].join(''),
    );
    writeFileSync(join(dir, 'other.jsonl'), answer(5, 'o1'));
    expect(await transcriptMarkers(cwd, (wall) => wall - 1000, 60)).toEqual([
      { t: 2, kind: 'prompt' },
      { t: 4, kind: 'tool', label: 'Bash' },
      { t: 9, kind: 'answer' },
    ]);
  });

  it('finds nothing in a folder without transcripts', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', config);
    expect(await transcriptMarkers(join(config, 'nowhere'), (wall) => wall - 1000, 60)).toEqual([]);
  });

  it("follows a paused take's clock: a prompt during the pause lands where it paused", async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', config);
    const cwd = join(config, 'paused');
    const dir = claudeTranscriptDir(cwd);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'paused.jsonl'), [prompt(3), prompt(10), tool(22, 't1', 'Bash'), answer(23, 'a1')].join(''));
    const take = join(config, 'take');
    mkdirSync(take, { recursive: true });
    writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 } } }));
    // recorded 1000–1005, paused until 1020, then recording on
    writeFileSync(
      join(take, 'segments.json'),
      JSON.stringify({ version: 1, joined: true, segments: [{ screen: { file: 'screen.1.mp4', start: 1000 }, duration: 5 }, { screen: { file: 'screen.2.mp4', start: 1020 }, duration: 5 }] }),
    );
    const clock = (await takeClock(take))!;
    expect(await transcriptMarkers(cwd, clock, 10)).toEqual([
      { t: 3, kind: 'prompt' },
      { t: 5, kind: 'prompt' },
      { t: 7, kind: 'tool', label: 'Bash' },
      { t: 8, kind: 'answer' },
    ]);
  });
});

import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { claudeTranscriptDir, readTranscriptLine, watchClaude, type ClaudeSignal } from '../src/claude';

afterEach(() => vi.unstubAllEnvs());
const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const at = '2026-10-16T21:00:05.250Z';
const time = Date.parse(at) / 1000;
const line = (value: object) => JSON.stringify({ timestamp: at, ...value });

describe('claudeTranscriptDir', () => {
  it('replaces every character but letters and digits in the absolute folder', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '');
    const cwd = process.platform === 'win32' ? 'C:\\Users\\me\\Rufi v0.1' : '/home/me/Rufi v0.1';
    const slug = process.platform === 'win32' ? 'C--Users-me-Rufi-v0-1' : '-home-me-Rufi-v0-1';
    expect(claudeTranscriptDir(cwd)).toBe(join(homedir(), '.claude', 'projects', slug));
  });

  it('follows CLAUDE_CONFIG_DIR like Claude Code', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(tmpdir(), 'claude-config'));
    expect(claudeTranscriptDir(tmpdir()).startsWith(join(tmpdir(), 'claude-config', 'projects'))).toBe(true);
  });
});

describe('readTranscriptLine', () => {
  it('reads a submitted prompt, as text or as text blocks', () => {
    expect(readTranscriptLine(line({ type: 'user', message: { role: 'user', content: 'build it' } }))).toEqual([{ kind: 'prompt', time }]);
    expect(readTranscriptLine(line({ type: 'user', message: { content: [{ type: 'text', text: 'see image' }, { type: 'image' }] } }))).toEqual([{ kind: 'prompt', time }]);
  });

  it('skips tool results, meta lines, subagents and local command output', () => {
    expect(readTranscriptLine(line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } }))).toEqual([]);
    expect(readTranscriptLine(line({ type: 'user', isMeta: true, message: { content: 'caveat' } }))).toEqual([]);
    expect(readTranscriptLine(line({ type: 'user', isSidechain: true, message: { content: 'subagent task' } }))).toEqual([]);
    expect(readTranscriptLine(line({ type: 'user', message: { content: '<local-command-stdout>ok</local-command-stdout>' } }))).toEqual([]);
  });

  it('reads tool calls and the end of the turn', () => {
    expect(readTranscriptLine(line({ type: 'assistant', message: { id: 'm1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash' }, { type: 'tool_use', id: 't2', name: 'Read' }] } }))).toEqual([
      { kind: 'tool', time, label: 'Bash', id: 't1' },
      { kind: 'tool', time, label: 'Read', id: 't2' },
    ]);
    expect(readTranscriptLine(line({ type: 'assistant', message: { id: 'm2', stop_reason: 'end_turn', content: [{ type: 'thinking' }] } }))).toEqual([{ kind: 'answer', time, id: 'm2' }]);
    expect(readTranscriptLine(line({ type: 'assistant', isApiErrorMessage: true, message: { id: 'm3', stop_reason: 'stop_sequence', content: [] } }))).toEqual([{ kind: 'answer', time, id: 'm3' }]);
    expect(readTranscriptLine(line({ type: 'assistant', isSidechain: true, message: { id: 'm4', stop_reason: 'end_turn', content: [] } }))).toEqual([]);
  });

  it('ignores lines it cannot read', () => {
    expect(readTranscriptLine('{"type":"user"')).toEqual([]);
    expect(readTranscriptLine('null')).toEqual([]);
    expect(readTranscriptLine(JSON.stringify({ type: 'user', message: { content: 'no time' } }))).toEqual([]);
    expect(readTranscriptLine(line({ type: 'attachment' }))).toEqual([]);
  });
});

describe('watchClaude', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const now = () => new Date().toISOString();
  const entry = (value: object) => `${JSON.stringify({ timestamp: now(), ...value })}\n`;
  const prompt = () => entry({ type: 'user', message: { content: 'go' } });
  const end = (id: string) => entry({ type: 'assistant', message: { id, stop_reason: 'end_turn', content: [{ type: 'text' }] } });

  function setup() {
    const dir = temp('cuttle-transcripts-');
    const signals: ClaudeSignal[] = [];
    return { dir, signals, kinds: () => signals.map((signal) => signal.kind) };
  }

  it('follows the first session that submits a prompt and ignores the others', async () => {
    const { dir, signals, kinds } = setup();
    writeFileSync(join(dir, 'busy.jsonl'), entry({ type: 'user', message: { content: 'old prompt' } }));
    const watcher = watchClaude(dir, Date.now() / 1000 - 0.1, (signal) => signals.push(signal));
    await sleep(300);
    appendFileSync(join(dir, 'busy.jsonl'), end('b1')); // another session finishing its own turn
    await sleep(300);
    appendFileSync(join(dir, 'demo.jsonl'), prompt());
    appendFileSync(join(dir, 'demo.jsonl'), entry({ type: 'assistant', message: { id: 'a1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } }));
    await sleep(300);
    appendFileSync(join(dir, 'busy.jsonl'), prompt() + end('b2')); // the other session again: not followed
    appendFileSync(join(dir, 'demo.jsonl'), end('a2') + end('a2')); // one message, two lines
    await sleep(400);
    watcher.stop();
    expect(kinds()).toEqual(['prompt', 'tool', 'answer']);
    expect(signals[1]).toMatchObject({ label: 'Bash' });
  });

  it('reads a file that exists when watching starts from its end, and ignores lines from before `since`', async () => {
    const { dir, signals, kinds } = setup();
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, prompt() + end('x1'));
    const watcher = watchClaude(dir, Date.now() / 1000 + 0.2, (signal) => signals.push(signal));
    await sleep(100);
    appendFileSync(file, prompt()); // written before `since`
    await sleep(400);
    appendFileSync(file, prompt());
    await sleep(400);
    watcher.stop();
    expect(kinds()).toEqual(['prompt']);
  });

  it('waits for the transcript folder and for lines that are written in pieces', async () => {
    const { dir, signals, kinds } = setup();
    const folder = join(dir, 'not-yet');
    const watcher = watchClaude(folder, Date.now() / 1000 - 0.1, (signal) => signals.push(signal));
    await sleep(300);
    mkdirSync(folder);
    const text = entry({ type: 'user', message: { content: 'größer als 🐟' } });
    const bytes = Buffer.from(text);
    const cut = bytes.indexOf(Buffer.from('🐟')) + 2; // in the middle of a 4-byte character
    appendFileSync(join(folder, 's.jsonl'), bytes.subarray(0, cut));
    await sleep(400);
    expect(kinds()).toEqual([]);
    appendFileSync(join(folder, 's.jsonl'), bytes.subarray(cut));
    await sleep(400);
    watcher.stop();
    expect(kinds()).toEqual(['prompt']);
  });
});

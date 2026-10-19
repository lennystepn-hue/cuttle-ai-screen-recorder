import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { claudeTranscriptDir, readTranscriptLine, recentClaudeFolders, SessionReader, watchClaude, type ClaudeSignal } from '../src/claude';

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

  it('skips user lines with text that were not typed as a prompt', () => {
    const notPrompts = [
      { message: { content: '<task-notification>\n<task-id>b1</task-id>' } }, // a background task finished
      { message: { content: '<bash-input>ls</bash-input>' } }, // bash mode
      { message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
      { isCompactSummary: true, message: { content: 'This session is being continued …' } },
    ];
    for (const value of notPrompts) expect(readTranscriptLine(line({ type: 'user', ...value }))).toEqual([]);
    expect(readTranscriptLine(line({ type: 'user', message: { content: '<command-name>/review</command-name>' } }))).toEqual([{ kind: 'prompt', time, command: true }]);
  });

  it('gives a prompt its line uuid as id', () => {
    expect(readTranscriptLine(line({ type: 'user', uuid: 'u1', message: { content: 'go' } }))).toEqual([{ kind: 'prompt', time, id: 'u1' }]);
  });

  it('reads tool calls and the end of the turn', () => {
    expect(readTranscriptLine(line({ type: 'assistant', message: { id: 'm1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash' }, { type: 'tool_use', id: 't2', name: 'Read' }] } }))).toEqual([
      { kind: 'tool', time, label: 'Bash', id: 't1' },
      { kind: 'tool', time, label: 'Read', id: 't2' },
    ]);
    expect(readTranscriptLine(line({ type: 'assistant', message: { id: 'm2', stop_reason: 'end_turn', content: [{ type: 'thinking' }] } }))).toEqual([{ kind: 'answer', time, id: 'm2' }]);
    expect(readTranscriptLine(line({ type: 'assistant', isApiErrorMessage: true, message: { id: 'm3', stop_reason: 'stop_sequence', content: [] } }))).toEqual([{ kind: 'answer', time, id: 'm3' }]);
    expect(readTranscriptLine(line({ type: 'assistant', message: { id: 'm5', stop_reason: 'refusal', content: [] } }))).toEqual([{ kind: 'answer', time, id: 'm5' }]);
    expect(readTranscriptLine(line({ type: 'assistant', isSidechain: true, message: { id: 'm4', stop_reason: 'end_turn', content: [] } }))).toEqual([]);
  });

  it('reads work left running in the background (commands, agents, monitors): by its tool call or its result, and the notice that it ended', () => {
    // a command started with run_in_background: a tool call, and background work under its id
    const started = line({ type: 'assistant', message: { id: 'm1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', run_in_background: true } }] } });
    expect(readTranscriptLine(started)).toEqual([
      { kind: 'tool', time, label: 'Bash', id: 't1' },
      { kind: 'background', time, id: 't1' },
    ]);
    // a command, an agent (in the background unless told otherwise), a monitor, a resumed agent: by
    // their results, with the task id they name
    const result = (id: string, content: unknown) => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
    expect(readTranscriptLine(result('t3', 'Command running in background with ID: b1. Output is being written to: C:\\tasks\\b1.output'))).toEqual([{ kind: 'background', time, id: 't3', task: 'b1' }]);
    expect(readTranscriptLine(result('t2', [{ type: 'text', text: 'Async agent launched successfully. (internal)\nagentId: a1 (internal ID)' }]))).toEqual([{ kind: 'background', time, id: 't2', task: 'a1' }]);
    expect(readTranscriptLine(result('t5', 'Monitor started (task b2, expires in 15m unless the session ends)'))).toEqual([{ kind: 'background', time, id: 't5', task: 'b2' }]);
    expect(readTranscriptLine(result('t6', '{"success":true,"message":"Resuming agent a1","resumedAgent":"a1"}'))).toEqual([{ kind: 'background', time, id: 't6', task: 'a1' }]);
    expect(readTranscriptLine(result('t4', 'done'))).toEqual([]);
    // Claude stops one itself: no notice follows, its task id says which
    expect(readTranscriptLine(result('t7', '{"message":"Successfully stopped task: b1 (npm run dev)","task_id":"b1"}'))).toEqual([{ kind: 'finished', time, task: 'b1' }]);
    // its end, wherever Claude Code wrote the notice: queued, handed over during a turn, or as the line that starts one
    const notice = '<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>t3</tool-use-id>\n<output-file>C:\\tasks\\b1.output</output-file>\n<status>completed</status>\n<summary>Background command "npm test" completed (exit code 0)</summary>\n</task-notification>';
    const ended = [{ kind: 'finished', time, id: 't3', task: 'b1' }];
    expect(readTranscriptLine(line({ type: 'queue-operation', operation: 'enqueue', content: notice }))).toEqual(ended);
    expect(readTranscriptLine(line({ type: 'attachment', attachment: { type: 'queued_command', prompt: notice } }))).toEqual(ended);
    expect(readTranscriptLine(line({ type: 'user', message: { role: 'user', content: notice } }))).toEqual(ended);
    expect(readTranscriptLine(line({ type: 'user', isMeta: true, message: { content: [{ type: 'text', text: notice }] } }))).toEqual(ended);
    // a monitor's event has no status: nothing ended; a subagent's own notices are not the session's
    expect(readTranscriptLine(line({ type: 'user', message: { content: '<task-notification>\n<task-id>b2</task-id>\n<summary>Monitor event: "build"</summary>\n<event>ok</event>\n</task-notification>' } }))).toEqual([]);
    expect(readTranscriptLine(line({ type: 'user', isSidechain: true, message: { content: notice } }))).toEqual([]);
  });

  it('ignores lines it cannot read', () => {
    expect(readTranscriptLine('{"type":"user"')).toEqual([]);
    expect(readTranscriptLine('null')).toEqual([]);
    expect(readTranscriptLine(JSON.stringify({ type: 'user', message: { content: 'no time' } }))).toEqual([]);
    expect(readTranscriptLine(line({ type: 'attachment' }))).toEqual([]);
  });
});

describe('SessionReader', () => {
  const command = (name: string) => line({ type: 'user', message: { content: `<command-name>${name}</command-name>` } });
  const output = line({ type: 'user', message: { content: '<local-command-stdout>Set model to Opus</local-command-stdout>' } });
  const answer = line({ type: 'assistant', message: { id: 'm1', stop_reason: 'end_turn', content: [{ type: 'text' }] } });

  it('drops a local slash command, which only writes its output', () => {
    const reader = new SessionReader();
    expect([command('/model'), output, line({ type: 'user', message: { content: 'build it' } })].flatMap((text) => reader.read(text))).toEqual([{ kind: 'prompt', time }]);
  });

  it('does not take a background notice for Claude answering a slash command', () => {
    const reader = new SessionReader();
    const notice = line({ type: 'user', message: { content: '<task-notification>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n</task-notification>' } });
    expect([command('/model'), notice, line({ type: 'user', message: { content: 'build it' } })].flatMap((text) => reader.read(text)).map((signal) => signal.kind)).toEqual(['finished', 'prompt']);
  });

  it('keeps a slash command that Claude answers, before the answer', () => {
    const reader = new SessionReader();
    expect([command('/review'), answer].flatMap((text) => reader.read(text)).map((signal) => signal.kind)).toEqual(['prompt', 'answer']);
  });
});

describe('watchClaude', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const now = () => new Date().toISOString();
  const entry = (value: object, timestamp = now()) => `${JSON.stringify({ timestamp, ...value })}\n`;
  const prompt = () => entry({ type: 'user', message: { content: 'go' } });
  const end = (id: string) => entry({ type: 'assistant', message: { id, stop_reason: 'end_turn', content: [{ type: 'text' }] } });

  function setup() {
    const dir = temp('cuttle-transcripts-');
    const signals: ClaudeSignal[] = [];
    return { dir, signals, kinds: () => signals.map((signal) => signal.kind) };
  }

  it('follows the first session that submits a prompt and ignores the others', async () => {
    const { dir, signals, kinds } = setup();
    writeFileSync(join(dir, 'busy.jsonl'), entry({ type: 'user', message: { content: 'old prompt' } }, new Date(Date.now() - 60_000).toISOString()));
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

  it('reads a prompt written after `since` to a transcript that existed before watching started', async () => {
    // The user submits the prompt during the countdown, before the watcher's first look.
    const { dir, signals, kinds } = setup();
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, entry({ type: 'user', message: { content: 'earlier' } }, new Date(Date.now() - 60_000).toISOString()));
    const since = Date.now() / 1000;
    await sleep(50);
    appendFileSync(file, prompt());
    const watcher = watchClaude(dir, since, (signal) => signals.push(signal));
    await sleep(300);
    appendFileSync(file, end('e1'));
    await sleep(400);
    watcher.stop();
    expect(kinds()).toEqual(['prompt', 'answer']);
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

describe('recentClaudeFolders', () => {
  it('lists the folders Claude Code ran in, the most recently active first, skipping folders that are gone', async () => {
    const config = temp('claude-config-');
    const [older, newer, gone] = [temp('older-'), temp('newer-'), join(tmpdir(), 'cuttle-no-such-folder')];
    const transcript = (cwd: string, name: string, seconds: number) => {
      const dir = claudeTranscriptDir(cwd, config);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, name);
      writeFileSync(file, `${line({ type: 'user', cwd, message: { content: 'hi' } })}
not json
`);
      utimesSync(file, seconds, seconds);
    };
    transcript(older, 'a.jsonl', 1_000_000);
    transcript(newer, 'b.jsonl', 2_000_000);
    transcript(gone, 'c.jsonl', 3_000_000);
    expect(await recentClaudeFolders(5, config)).toEqual([
      { cwd: newer, active: 2_000_000 },
      { cwd: older, active: 1_000_000 },
    ]);
    expect(await recentClaudeFolders(1, config)).toHaveLength(1);
    expect(await recentClaudeFolders(5, join(config, 'nothing'))).toEqual([]);
  });
});

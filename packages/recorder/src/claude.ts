// Watches Claude Code transcripts for `untilClaude`: prompts, tool calls and the end of the turn.
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/** How often the transcript folder is read. */
const POLL_MS = 250;

/**
 * Where Claude Code keeps the transcripts (`<session id>.jsonl`) of sessions started in `cwd`:
 * `<config dir>/projects/<absolute cwd with every character but a-z, A-Z, 0-9 replaced by ->`.
 * The config dir is `CLAUDE_CONFIG_DIR` when set, like Claude Code itself.
 */
export function claudeTranscriptDir(cwd: string, configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')): string {
  return join(configDir, 'projects', resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'));
}

export interface ClaudeSignal {
  kind: 'prompt' | 'tool' | 'answer';
  /** Wall-clock seconds, from the line's `timestamp`. */
  time: number;
  /** The tool's name, for `tool`. */
  label?: string;
  /** For deduplication: the tool call's id, or the message id of an `answer`. */
  id?: string;
}

interface TranscriptLine {
  type?: unknown;
  timestamp?: unknown;
  isSidechain?: unknown;
  isMeta?: unknown;
  isApiErrorMessage?: unknown;
  message?: { id?: unknown; stop_reason?: unknown; content?: unknown };
}

/**
 * The signals in one transcript line. Subagent lines (`isSidechain`) and meta lines are skipped. A
 * prompt is a user line with text (tool results are user lines too); every line of an assistant
 * message carries the message's final `stop_reason`, so an `end_turn` (or an API error, which ends the
 * turn as well) shows up once per line and is deduplicated by message id.
 */
export function readTranscriptLine(text: string): ClaudeSignal[] {
  let line: TranscriptLine;
  try {
    line = JSON.parse(text) as TranscriptLine;
  } catch {
    return [];
  }
  if (typeof line !== 'object' || line === null || line.isSidechain === true || line.isMeta === true) return [];
  const time = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) / 1000 : Number.NaN;
  if (!Number.isFinite(time)) return [];
  const content = line.message?.content;
  if (line.type === 'user') return isPrompt(content) ? [{ kind: 'prompt', time }] : [];
  if (line.type !== 'assistant') return [];
  const signals: ClaudeSignal[] = [];
  for (const item of Array.isArray(content) ? (content as { type?: unknown; name?: unknown; id?: unknown }[]) : []) {
    if (item?.type === 'tool_use' && typeof item.name === 'string') {
      signals.push({ kind: 'tool', time, label: item.name, ...(typeof item.id === 'string' && { id: item.id }) });
    }
  }
  if (line.message?.stop_reason === 'end_turn' || line.isApiErrorMessage === true) {
    const id = line.message?.id;
    signals.push({ kind: 'answer', time, ...(typeof id === 'string' && { id }) });
  }
  return signals;
}

function isPrompt(content: unknown): boolean {
  // Output of a local slash command (`/model`, …) is written as a user line too.
  if (typeof content === 'string') return content.trim() !== '' && !content.startsWith('<local-command-');
  if (!Array.isArray(content)) return false;
  const types = content.map((item: { type?: unknown }) => item?.type);
  return types.includes('text') && !types.includes('tool_result');
}

export interface ClaudeWatcher {
  stop(): void;
}

/**
 * Polls the transcripts in `dir` and reports the signals of one session: the first one that submits
 * a prompt at or after `since` (wall-clock seconds). Other sessions in the same folder (another
 * Claude finishing its own turn) are ignored. Files that exist when watching starts are read from
 * their current end; files created later from the start.
 */
export function watchClaude(dir: string, since: number, onSignal: (signal: ClaudeSignal) => void): ClaudeWatcher {
  const files = new Map<string, { offset: number; partial: string; decoder: StringDecoder }>();
  const seen = new Set<string>();
  let session: string | undefined;
  let first = true;
  let busy = false;
  let stopped = false;

  const handle = (file: string, signal: ClaudeSignal) => {
    if (signal.time < since) return;
    if (session === undefined) {
      if (signal.kind !== 'prompt') return;
      session = file;
    }
    if (file !== session) return;
    if (signal.id !== undefined) {
      const key = `${signal.kind}:${signal.id}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
    onSignal(signal);
  };

  const poll = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const names = await readdir(dir).catch(() => [] as string[]);
      for (const name of names.filter((candidate) => candidate.endsWith('.jsonl'))) {
        const path = join(dir, name);
        const size = await stat(path).then((info) => info.size, () => undefined);
        if (size === undefined) continue;
        let state = files.get(name);
        if (state === undefined) {
          state = { offset: first ? size : 0, partial: '', decoder: new StringDecoder('utf8') };
          files.set(name, state);
        }
        if (size <= state.offset) continue;
        const text = state.decoder.write(await readRange(path, state.offset, size));
        state.offset = size;
        const lines = (state.partial + text).split('\n');
        state.partial = lines.pop() ?? '';
        for (const line of lines) for (const signal of readTranscriptLine(line)) if (!stopped) handle(name, signal);
      }
      first = false;
    } finally {
      busy = false;
    }
  };

  // A read that fails (a file locked for a moment) is retried on the next poll.
  const tick = () => void poll().catch(() => {});
  tick();
  const timer = setInterval(tick, POLL_MS);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function readRange(path: string, from: number, to: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(to - from);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, from);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

// Watches Claude Code transcripts for `untilClaude`: prompts, tool calls and the end of the turn.
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/** How often the transcript folder is read. */
const POLL_MS = 250;
/**
 * A transcript first seen after it changed at or after `since` is read from this far before its end:
 * far more than a session writes in the seconds before the first read, and a bound on reading a long
 * session's file. The first, cut-off line does not parse and is skipped.
 */
const CATCH_UP_BYTES = 4 * 1024 * 1024;

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
  /** For deduplication: the prompt line's uuid, the tool call's id, or the message id of an `answer`. */
  id?: string;
  /** A prompt that is a slash command: a real prompt only once Claude answers it (`SessionReader`). */
  command?: true;
}

interface TranscriptLine {
  type?: unknown;
  uuid?: unknown;
  timestamp?: unknown;
  isSidechain?: unknown;
  isMeta?: unknown;
  isCompactSummary?: unknown;
  isApiErrorMessage?: unknown;
  message?: { id?: unknown; stop_reason?: unknown; content?: unknown };
}

/** Stop reasons that end a turn (`tool_use` continues it); an API error ends it as well. */
const TURN_ENDS = new Set(['end_turn', 'refusal']);

/**
 * User lines with text that the user did not type as a prompt: local slash-command output, bash
 * mode, a background task's notice (which starts a turn in that session, not a demo) and the note an
 * interrupt leaves.
 */
const NOT_PROMPTS = ['<local-command-', '<bash-', '<task-notification>', '[Request interrupted'];

/**
 * The signals in one transcript line. Subagent lines (`isSidechain`), meta lines and compaction
 * summaries are skipped. A prompt is a user line with text (tool results are user lines too); every
 * line of an assistant message carries the message's final `stop_reason`, so the end of a turn shows
 * up once per line and is deduplicated by message id.
 */
export function readTranscriptLine(text: string): ClaudeSignal[] {
  let line: TranscriptLine;
  try {
    line = JSON.parse(text) as TranscriptLine;
  } catch {
    return [];
  }
  if (typeof line !== 'object' || line === null || line.isSidechain === true || line.isMeta === true || line.isCompactSummary === true) return [];
  const time = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) / 1000 : Number.NaN;
  if (!Number.isFinite(time)) return [];
  const content = line.message?.content;
  if (line.type === 'user') {
    const prompt = promptText(content);
    if (prompt === undefined) return [];
    const command = prompt.startsWith('<command-name>') || prompt.startsWith('<command-message>');
    return [{ kind: 'prompt', time, ...(typeof line.uuid === 'string' && { id: line.uuid }), ...(command && { command: true as const }) }];
  }
  if (line.type !== 'assistant') return [];
  const signals: ClaudeSignal[] = [];
  for (const item of Array.isArray(content) ? (content as { type?: unknown; name?: unknown; id?: unknown }[]) : []) {
    if (item?.type === 'tool_use' && typeof item.name === 'string') {
      signals.push({ kind: 'tool', time, label: item.name, ...(typeof item.id === 'string' && { id: item.id }) });
    }
  }
  if (TURN_ENDS.has(String(line.message?.stop_reason)) || line.isApiErrorMessage === true) {
    const id = line.message?.id;
    signals.push({ kind: 'answer', time, ...(typeof id === 'string' && { id }) });
  }
  return signals;
}

/** The text of a user line that is a prompt, or undefined. */
function promptText(content: unknown): string | undefined {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content) && !content.some((item: { type?: unknown }) => item?.type === 'tool_result')
        ? (content as { type?: unknown; text?: unknown }[]).find((item) => item?.type === 'text')?.text
        : undefined;
  if (typeof text !== 'string' || text.trim() === '' || NOT_PROMPTS.some((prefix) => text.startsWith(prefix))) return undefined;
  return text;
}

/**
 * One session's signals in order. A slash command is held back until Claude answers it: a prompt
 * command such as /review starts a turn, a local one such as /model or /clear only writes its output
 * and must neither lock the watcher onto its session nor become a marker.
 */
export class SessionReader {
  private command: ClaudeSignal | undefined;

  read(text: string): ClaudeSignal[] {
    const signals: ClaudeSignal[] = [];
    for (const signal of readTranscriptLine(text)) {
      if (signal.kind === 'prompt') {
        this.command = signal.command ? signal : undefined; // a command nobody answered was a local one
        if (!signal.command) signals.push(signal);
        continue;
      }
      if (this.command) signals.push(this.command);
      this.command = undefined;
      signals.push(signal);
    }
    return signals;
  }
}

export interface ClaudeWatcher {
  stop(): void;
}

/**
 * Polls the transcripts in `dir` and reports the signals of one session: the first one that submits
 * a prompt at or after `since` (wall-clock seconds). Other sessions in the same folder (another
 * Claude finishing its own turn) are ignored. A transcript that last changed before `since` is read
 * from its end; one that changed later (or appears later) from where its lines can be newer than
 * `since`. `onSignal` must not throw; if it does, the error is dropped and watching goes on.
 */
export function watchClaude(dir: string, since: number, onSignal: (signal: ClaudeSignal) => void): ClaudeWatcher {
  const files = new Map<string, { offset: number; partial: string; decoder: StringDecoder; reader: SessionReader }>();
  const seen = new Set<string>();
  let session: string | undefined;
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
    try {
      onSignal(signal);
    } catch {
      // A failing listener must not lose the lines after this one.
    }
  };

  const poll = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const names = await readdir(dir).catch(() => [] as string[]);
      for (const name of names.filter((candidate) => candidate.endsWith('.jsonl'))) {
        const path = join(dir, name);
        const info = await stat(path).catch(() => undefined);
        if (info === undefined) continue;
        let state = files.get(name);
        if (state === undefined) {
          const offset = info.mtimeMs / 1000 < since ? info.size : Math.max(0, info.size - CATCH_UP_BYTES);
          state = { offset, partial: '', decoder: new StringDecoder('utf8'), reader: new SessionReader() };
          files.set(name, state);
        }
        if (info.size < state.offset) {
          // Rewritten from the start: read it again; lines older than `since` are ignored anyway.
          state.offset = 0;
          state.partial = '';
          state.decoder = new StringDecoder('utf8');
          state.reader = new SessionReader();
        }
        if (info.size === state.offset) continue;
        const bytes = await readRange(path, state.offset, info.size);
        state.offset += bytes.length;
        const lines = (state.partial + state.decoder.write(bytes)).split('\n');
        state.partial = lines.pop() ?? '';
        for (const line of lines) for (const signal of state.reader.read(line)) if (!stopped) handle(name, signal);
      }
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

/** A folder Claude Code ran in, and when its newest transcript last changed (wall-clock seconds). */
export interface ClaudeFolder {
  cwd: string;
  active: number;
}

/** How much of a transcript's end is read to find the folder it ran in. */
const CWD_TAIL_BYTES = 256 * 1024;

/**
 * The folders Claude Code ran in, the most recently active first (at most `limit`), from the `cwd`
 * of the newest transcript in each project folder. Folders that no longer exist are left out.
 */
export async function recentClaudeFolders(limit = 5, configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')): Promise<ClaudeFolder[]> {
  const projects = join(configDir, 'projects');
  const newest: { path: string; mtime: number }[] = [];
  for (const name of await readdir(projects).catch(() => [] as string[])) {
    let best: { path: string; mtime: number } | undefined;
    for (const file of await readdir(join(projects, name)).catch(() => [] as string[])) {
      if (!file.endsWith('.jsonl')) continue;
      const info = await stat(join(projects, name, file)).catch(() => undefined);
      if (info?.isFile() && (!best || info.mtimeMs > best.mtime)) best = { path: join(projects, name, file), mtime: info.mtimeMs };
    }
    if (best) newest.push(best);
  }
  newest.sort((a, b) => b.mtime - a.mtime);
  const folders: ClaudeFolder[] = [];
  for (const transcript of newest) {
    if (folders.length >= limit) break;
    // a transcript deleted since the listing is skipped
    const size = (await stat(transcript.path).catch(() => undefined))?.size;
    if (size === undefined) continue;
    const text = (await readRange(transcript.path, Math.max(0, size - CWD_TAIL_BYTES), size).catch(() => Buffer.alloc(0))).toString('utf8');
    const cwd = text
      .split('\n')
      .reverse()
      .map((line) => {
        try {
          const value = (JSON.parse(line) as { cwd?: unknown }).cwd;
          return typeof value === 'string' ? value : undefined;
        } catch {
          return undefined;
        }
      })
      .find((value) => value !== undefined);
    if (cwd === undefined || folders.some((folder) => folder.cwd === cwd)) continue;
    if (!(await stat(cwd).then((info) => info.isDirectory(), () => false))) continue;
    folders.push({ cwd, active: transcript.mtime / 1000 });
  }
  return folders;
}

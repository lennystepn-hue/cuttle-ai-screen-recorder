# Cuttle Fix: a Take Ended Before Claude's Background Work Did Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `--until-claude` ends a take after Claude's answer, but only once the commands, agents and monitors Claude left running in the background are done. Their results come in a later answer, and the take now ends after that one. Until now the take stopped 2 s after the first turn's end ("the queries run in the background…"), before the result was on the screen.

**Architecture:**
- **`@cuttle/recorder`'s transcript reader** knows two more signals:
  - `background`: a tool call that left work running, with its task id.
  - `finished`: Claude Code's notice that the work ended, or Claude stopping it itself.
  - Neither becomes a marker.
- **`record`** keeps the background work that still runs. An answer while some runs is not the end: the take ends after Claude's answer once it is done.
- **A safety net for servers:** work that never ends (a dev server) ends the wait after `untilClaudeQuietSeconds` (60 s) without anything new in the session, with a warning.

**Tech Stack:** TypeScript strict, Claude Code's transcripts (JSONL), ffmpeg (the test backend).

Reported by the user on 2026-10-19. A demo recorded with the skill stopped before a table appeared in the terminal, because Claude ran its queries in the background; the table had to be a still of the screen from afterwards. Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m4b-live-captions.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `fix-claude-background`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The full `pnpm test` and the typecheck run in Task 3.

## Decisions made while planning

The transcript format was read from a real Claude Code session's transcript, with 227 background starts. Every start the reader now finds has its end, except work still running or stopped without a notice. The finished prototype passed the typecheck, `app:check` (58 tests) and `cli:check` (15), and `pnpm test` (962 tests, 79 skipped) in one of three full runs; the other two failed only tests that time out on a loaded machine, as listed at the end. Every screenshot was looked at.

- **Why the take ended early:**
  - `untilClaude` stopped on the first `end_turn` of the session.
  - A turn that starts commands in the background ends with "I'll be notified".
  - Claude Code later writes a `<task-notification>`, which starts a new turn, and that turn shows the result.
- **What counts as background work** (a tool result's first words, with the task id they name):
  - `Command running in background with ID: …`: Bash, PowerShell.
  - `Async agent launched … agentId: …`: an agent, in the background unless told otherwise.
  - `Monitor started (task …`: a monitor.
  - `{"success":true,"message":"Resuming agent …`: an agent resumed with a message.
  - A tool call with `run_in_background: true` counts as soon as it is made.
- **What counts as its end:**
  - A `<task-notification>` with a `<status>` (completed, failed, killed), matched by its `<tool-use-id>` (or its `<task-id>`).
  - Claude Code writes it as a queue line (`queue-operation`), as a `queued_command` attachment during a turn, or as the user line that starts a turn when Claude was idle. Each is read, and the same end twice changes nothing.
  - A monitor's events are notices without a status: nothing ended.
  - Claude stopping a task itself (`TaskStop`: `{"message":"Successfully stopped task: …`) ends it as well: no notice follows.
- **When the take ends:**
  - After an answer with no background work running, as before.
  - After an answer while some runs, the take waits for the work and for Claude's next answer.
  - Anything new in the session (a tool call, a notice, a prompt) restarts the wait.
  - After `untilClaudeQuietSeconds` without anything new (default `CLAUDE_BACKGROUND_SECONDS`, 60 s), the take ends anyway, with the warning `Claude Code left a command or agent running in the background (a server?): …`. A dev server never ends, and `suggest` trims the quiet tail.
- **Every answer is a marker.** `suggest` zooms on the last one: the answer with the result.
- **`suggest --claude`** (markers read afterwards) skips the new signals.
- **A slash command:** a background notice does not count as Claude answering one (`SessionReader`).

## File structure

| File | Responsibility |
|---|---|
| `packages/recorder/src/claude.ts`, `packages/recorder/src/index.ts` | the `background` and `finished` signals |
| `packages/recorder/src/record.ts`, `packages/recorder/src/types.ts` | the take waits for the background work |
| `packages/core/src/suggest/transcript.ts` | markers read afterwards skip them |
| `apps/cli/src/main.ts`, `README.md`, `skill/cuttle/SKILL.md` | the words for people and for Claude |

---

### Task 1: Background work in the transcript

**Files:**
- Modify: `packages/recorder/src/claude.ts`, `packages/recorder/src/index.ts`, `packages/core/src/suggest/transcript.ts`, `packages/recorder/test/claude.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `fix-claude-background`; work there:

```bash
git switch fix-claude-background
```

- [ ] **Step 2: Write the failing tests**

In `packages/recorder/test/claude.test.ts`, replace:

```ts
    expect(readTranscriptLine(line({ type: 'assistant', isSidechain: true, message: { id: 'm4', stop_reason: 'end_turn', content: [] } }))).toEqual([]);
  });

  it('ignores lines it cannot read', () => {
    expect(readTranscriptLine('{"type":"user"')).toEqual([]);
    expect(readTranscriptLine('null')).toEqual([]);
```

with:

```ts
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
```

In the same file, replace:

```ts
    expect([command('/model'), output, line({ type: 'user', message: { content: 'build it' } })].flatMap((text) => reader.read(text))).toEqual([{ kind: 'prompt', time }]);
  });

  it('keeps a slash command that Claude answers, before the answer', () => {
    const reader = new SessionReader();
    expect([command('/review'), answer].flatMap((text) => reader.read(text)).map((signal) => signal.kind)).toEqual(['prompt', 'answer']);
```

with:

```ts
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
```

Run: `pnpm exec vitest run --project node packages/recorder/test/claude.test.ts`
Expected: FAIL: no `background` or `finished` signals.

- [ ] **Step 3: The signals**

In `packages/recorder/src/claude.ts`, replace:

```ts
// Watches Claude Code transcripts for `untilClaude`: prompts, tool calls and the end of the turn.
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
```

with:

```ts
// Watches Claude Code transcripts for `untilClaude`: prompts, tool calls, the end of the turn, and
// the commands and agents Claude leaves running in the background until their notice says they ended.
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
```

In the same file, replace:

```ts
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
```

with:

```ts
}

export interface ClaudeSignal {
  /**
   * `prompt`, `tool` and `answer` become markers. `background`: a command, an agent or a monitor
   * Claude left running in the background (`id` is the tool call that started it); `finished`: one
   * of them ended (its notice, or Claude stopped it).
   */
  kind: 'prompt' | 'tool' | 'answer' | 'background' | 'finished';
  /** Wall-clock seconds, from the line's `timestamp`. */
  time: number;
  /** The tool's name, for `tool`. */
  label?: string;
  /**
   * For deduplication: the prompt line's uuid, the tool call's id, or the message id of an `answer`.
   * For background work, the tool call that started it (unknown when Claude stopped it).
   */
  id?: string;
  /** Background work's task id, where the transcript names it. */
  task?: string;
  /** A prompt that is a slash command: a real prompt only once Claude answers it (`SessionReader`). */
  command?: true;
}
```

In the same file, replace:

```ts
  isCompactSummary?: unknown;
  isApiErrorMessage?: unknown;
  message?: { id?: unknown; stop_reason?: unknown; content?: unknown };
}

/** Stop reasons that end a turn (`tool_use` continues it); an API error ends it as well. */
const TURN_ENDS = new Set(['end_turn', 'refusal']);
```

with:

```ts
  isCompactSummary?: unknown;
  isApiErrorMessage?: unknown;
  message?: { id?: unknown; stop_reason?: unknown; content?: unknown };
  /** A queue line's text (`queue-operation`). */
  content?: unknown;
  attachment?: { type?: unknown; prompt?: unknown };
}

/** The signals that become markers. */
export type MarkerSignal = ClaudeSignal & { kind: 'prompt' | 'tool' | 'answer' };
export const isMarkerSignal = (signal: ClaudeSignal): signal is MarkerSignal => signal.kind === 'prompt' || signal.kind === 'tool' || signal.kind === 'answer';

/** Stop reasons that end a turn (`tool_use` continues it); an API error ends it as well. */
const TURN_ENDS = new Set(['end_turn', 'refusal']);
```

In the same file, replace:

```ts
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
```

with:

```ts
 */
const NOT_PROMPTS = ['<local-command-', '<bash-', '<task-notification>', '[Request interrupted'];

/**
 * Tool results that say the work goes on in the background and reports back later, with its task
 * id: a command (Bash, PowerShell), an agent (started, or resumed with a message), a monitor.
 */
const BACKGROUND_RESULTS = [
  /^Command running in background with ID: ([\w-]+)/,
  /^Async agent launched[\s\S]*?agentId: ([\w-]+)/,
  /^Monitor started \(task ([\w-]+)/,
  /^\{"success":true,"message":"Resuming agent ([\w-]+)/,
];
/** Claude stopped a background task itself (TaskStop): no notice follows. */
const TASK_STOPPED = /^\{"message":"Successfully stopped task: ([\w-]+)/;
/** In a background task's notice: its task id, the tool call that started it, and a status once it ended. */
const NOTICE_TASK = /<task-id>([^<\s]+)<\/task-id>/;
const NOTICE_TOOL = /<tool-use-id>([^<\s]+)<\/tool-use-id>/;
/** A notice of a task that ended (completed, failed, killed); a monitor's events have no status. */
const NOTICE_ENDED = /<status>[a-z_]+<\/status>/;

/**
 * The text of a background task's notice, wherever Claude Code wrote it: queued (`queue-operation`),
 * handed to Claude during a turn (a `queued_command` attachment), or as the user line that starts
 * a turn when Claude was idle.
 */
function taskNotice(line: TranscriptLine): string | undefined {
  const text =
    line.type === 'queue-operation'
      ? line.content
      : line.type === 'attachment' && line.attachment?.type === 'queued_command'
        ? line.attachment.prompt
        : line.type === 'user'
          ? typeof line.message?.content === 'string'
            ? line.message.content
            : Array.isArray(line.message?.content)
              ? (line.message.content as { type?: unknown; text?: unknown }[]).find((item) => item?.type === 'text')?.text
              : undefined
          : undefined;
  return typeof text === 'string' && text.trimStart().startsWith('<task-notification>') ? text : undefined;
}

/** The text of a tool result (a string, or text blocks). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as { type?: unknown; text?: unknown }[]).map((item) => (item?.type === 'text' && typeof item.text === 'string' ? item.text : '')).join('');
}

/**
 * The signals in one transcript line. Subagent lines (`isSidechain`), meta lines and compaction
 * summaries are skipped. A prompt is a user line with text (tool results are user lines too); every
 * line of an assistant message carries the message's final `stop_reason`, so the end of a turn shows
 * up once per line and is deduplicated by message id. Work left running in the background shows as
 * a tool call with `run_in_background` or as its result's words, and its end as a notice.
 */
export function readTranscriptLine(text: string): ClaudeSignal[] {
  let line: TranscriptLine;
```

In the same file, replace:

```ts
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
```

with:

```ts
  } catch {
    return [];
  }
  if (typeof line !== 'object' || line === null || line.isSidechain === true) return [];
  const time = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) / 1000 : Number.NaN;
  if (!Number.isFinite(time)) return [];
  const notice = taskNotice(line);
  if (notice !== undefined) {
    if (!NOTICE_ENDED.test(notice)) return [];
    const id = NOTICE_TOOL.exec(notice)?.[1];
    const task = NOTICE_TASK.exec(notice)?.[1];
    return id === undefined && task === undefined ? [] : [{ kind: 'finished', time, ...(id !== undefined && { id }), ...(task !== undefined && { task }) }];
  }
  if (line.isMeta === true || line.isCompactSummary === true) return [];
  const content = line.message?.content;
  if (line.type === 'user' && Array.isArray(content) && content.some((item: { type?: unknown }) => item?.type === 'tool_result')) {
    const signals: ClaudeSignal[] = [];
    for (const item of content as { type?: unknown; tool_use_id?: unknown; content?: unknown }[]) {
      if (item?.type !== 'tool_result' || typeof item.tool_use_id !== 'string') continue;
      const said = resultText(item.content).trimStart();
      const task = BACKGROUND_RESULTS.map((pattern) => pattern.exec(said)?.[1]).find((match) => match !== undefined);
      if (task !== undefined) signals.push({ kind: 'background', time, id: item.tool_use_id, task });
      const stopped = TASK_STOPPED.exec(said)?.[1];
      if (stopped !== undefined) signals.push({ kind: 'finished', time, task: stopped });
    }
    return signals;
  }
  if (line.type === 'user') {
    const prompt = promptText(content);
    if (prompt === undefined) return [];
```

In the same file, replace:

```ts
  }
  if (line.type !== 'assistant') return [];
  const signals: ClaudeSignal[] = [];
  for (const item of Array.isArray(content) ? (content as { type?: unknown; name?: unknown; id?: unknown }[]) : []) {
    if (item?.type === 'tool_use' && typeof item.name === 'string') {
      signals.push({ kind: 'tool', time, label: item.name, ...(typeof item.id === 'string' && { id: item.id }) });
    }
  }
  if (TURN_ENDS.has(String(line.message?.stop_reason)) || line.isApiErrorMessage === true) {
```

with:

```ts
  }
  if (line.type !== 'assistant') return [];
  const signals: ClaudeSignal[] = [];
  for (const item of Array.isArray(content) ? (content as { type?: unknown; name?: unknown; id?: unknown; input?: { run_in_background?: unknown } }[]) : []) {
    if (item?.type === 'tool_use' && typeof item.name === 'string') {
      signals.push({ kind: 'tool', time, label: item.name, ...(typeof item.id === 'string' && { id: item.id }) });
      if (item.input?.run_in_background === true && typeof item.id === 'string') signals.push({ kind: 'background', time, id: item.id });
    }
  }
  if (TURN_ENDS.has(String(line.message?.stop_reason)) || line.isApiErrorMessage === true) {
```

In the same file, replace:

```ts
  read(text: string): ClaudeSignal[] {
    const signals: ClaudeSignal[] = [];
    for (const signal of readTranscriptLine(text)) {
      if (signal.kind === 'prompt') {
        this.command = signal.command ? signal : undefined; // a command nobody answered was a local one
        if (!signal.command) signals.push(signal);
```

with:

```ts
  read(text: string): ClaudeSignal[] {
    const signals: ClaudeSignal[] = [];
    for (const signal of readTranscriptLine(text)) {
      // background work says nothing about a slash command
      if (!isMarkerSignal(signal)) {
        signals.push(signal);
        continue;
      }
      if (signal.kind === 'prompt') {
        this.command = signal.command ? signal : undefined; // a command nobody answered was a local one
        if (!signal.command) signals.push(signal);
```

In the same file, replace:

```ts
      session = file;
    }
    if (file !== session) return;
    if (signal.id !== undefined) {
      const key = `${signal.kind}:${signal.id}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
```

with:

```ts
      session = file;
    }
    if (file !== session) return;
    // background work: its tool call alone, and then with its task id from the result, are two signals
    if (signal.id !== undefined || signal.task !== undefined) {
      const key = `${signal.kind}:${signal.id ?? ''}:${signal.task ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
```

In `packages/recorder/src/index.ts`, replace:

```ts
export { record, CLAUDE_TAIL_SECONDS } from './record';
export { joinSegments } from './join';
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
export { LEVEL_FLOOR, PCM_RATE, levelMeter, wholeSamples, type MicLevel } from './level';
export { claudeTranscriptDir, readTranscriptLine, recentClaudeFolders, SessionReader, type ClaudeFolder, type ClaudeSignal } from './claude';
export { focusWindow } from './devices';
/** macOS's helper (native/macos/capture.swift), which also reads pictures' text (`cuttle-capture ocr`). */
export { captureHelper } from './mac-capture';
```

with:

```ts
export { record, CLAUDE_BACKGROUND_SECONDS, CLAUDE_TAIL_SECONDS } from './record';
export { joinSegments } from './join';
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
export { LEVEL_FLOOR, PCM_RATE, levelMeter, wholeSamples, type MicLevel } from './level';
export { claudeTranscriptDir, isMarkerSignal, readTranscriptLine, recentClaudeFolders, SessionReader, type ClaudeFolder, type ClaudeSignal, type MarkerSignal } from './claude';
export { focusWindow } from './devices';
/** macOS's helper (native/macos/capture.swift), which also reads pictures' text (`cuttle-capture ocr`). */
export { captureHelper } from './mac-capture';
```

In `packages/core/src/suggest/transcript.ts`, replace:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSegmentsJson, parseTakeJson, takeTime, type Marker } from '@cuttle/project';
import { claudeTranscriptDir, SessionReader, type ClaudeSignal } from '@cuttle/recorder';

/**
 * The prompt, tool-call and answer markers of the session that was most active while the take ran,
```

with:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSegmentsJson, parseTakeJson, takeTime, type Marker } from '@cuttle/project';
import { claudeTranscriptDir, isMarkerSignal, SessionReader, type ClaudeSignal } from '@cuttle/recorder';

/**
 * The prompt, tool-call and answer markers of the session that was most active while the take ran,
```

In the same file, replace:

```ts
    const markers: Marker[] = [];
    for (const line of text.split('\n')) {
      for (const signal of reader.read(line)) {
        const t = clock(signal.time);
        if (t === undefined || t < 0 || t > duration || duplicate(signal, seen)) continue;
        markers.push({ t: Math.round(t * 1000) / 1000, kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) });
```

with:

```ts
    const markers: Marker[] = [];
    for (const line of text.split('\n')) {
      for (const signal of reader.read(line)) {
        if (!isMarkerSignal(signal)) continue;
        const t = clock(signal.time);
        if (t === undefined || t < 0 || t > duration || duplicate(signal, seen)) continue;
        markers.push({ t: Math.round(t * 1000) / 1000, kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) });
```

Run: `pnpm exec vitest run --project node packages/recorder/test/claude.test.ts packages/core/test/suggest.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/recorder packages/core
git commit -m "recorder: the background work in Claude Code's transcript, and its end

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The take waits for it

**Files:**
- Modify: `packages/recorder/src/record.ts`, `packages/recorder/src/types.ts`, `packages/recorder/test/record.test.ts`

- [ ] **Step 1: Write the failing tests**

Three takes from a transcript written as Claude Code writes it:
- A query in the background: the take goes on past the first answer, and ends after the answer with the table.
- A server that never ends: the take ends after 2 s of quiet (`untilClaudeQuietSeconds: 2`) following the answer, with the warning.
- A server Claude stopped itself (`TaskStop`): the take ends after the answer.

The mic test from P5-M4b compared its samples with the screen's file, which runs on while its capture ends; it compares with the time recorded now (it failed on a loaded machine).

In `packages/recorder/test/record.test.ts`, replace:

```ts
    expect(new Set(levels)).toEqual(new Set([-90]));
  }, SLOW);

  it("hands the mic's samples to onAudio while it records: whole samples, as long as the take", async () => {
    const projectDir = project();
    const chunks: Uint8Array[] = [];
    let recordingSeen = false;
```

with:

```ts
    expect(new Set(levels)).toEqual(new Set([-90]));
  }, SLOW);

  it("hands the mic's samples to onAudio while it records: whole samples, as long as the take recorded", async () => {
    const projectDir = project();
    const chunks: Uint8Array[] = [];
    let recordingSeen = false;
```

In the same file, replace:

```ts
    }).done;
    expect(early).toBe(0);
    expect(chunks.every((samples) => samples.length % 2 === 0)).toBe(true);
    const seconds = chunks.reduce((sum, samples) => sum + samples.length, 0) / 2 / 16_000;
    expect(seconds).toBeGreaterThan(take.seconds - 0.5);
    expect(seconds).toBeLessThan(take.seconds + 0.5);
  }, SLOW);

  it('stops handing samples to an onAudio that throws, with a warning, and keeps the take', async () => {
```

with:

```ts
    }).done;
    expect(early).toBe(0);
    expect(chunks.every((samples) => samples.length % 2 === 0)).toBe(true);
    // the 1.5 s recorded until the stop; the screen's file runs on while its capture ends (longer on a
    // loaded machine), the samples do not
    const seconds = chunks.reduce((sum, samples) => sum + samples.length, 0) / 2 / 16_000;
    expect(seconds).toBeGreaterThan(1.5 - 0.4);
    expect(seconds).toBeLessThan(Math.max(take.seconds, 1.5) + 0.3);
  }, SLOW);

  it('stops handing samples to an onAudio that throws, with a warning, and keeps the take', async () => {
```

In the same file, replace:

```ts
    });
  }, SLOW);

  it('follows a session whose prompt came during the countdown', async () => {
    const projectDir = project();
    const { config, cwd, write } = transcripts();
```

with:

```ts
    });
  }, SLOW);

  /** Claude Code's notice that the background work started by tool call `id` ended. */
  const notice = (id: string) => `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n<summary>Background command completed (exit code 0)</summary>\n</task-notification>`;
  const background = (write: (session: string, value: object) => void, id: string, command: string) => {
    write('demo', { type: 'assistant', message: { id: `m-${id}`, stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, run_in_background: true } }] } });
    write('demo', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: `Command running in background with ID: b-${id}. Output is being written to: b-${id}.output` }] } });
  };

  it('waits for what Claude left running in the background, and stops after its answer once that is done', async () => {
    const projectDir = project();
    const { config, cwd, write } = transcripts();
    await withConfig(config, async () => {
      const recording = record({ ...test, projectDir, stop: { untilClaude: cwd, maxSeconds: 20 } });
      let ended = false;
      recording.done.then(
        () => (ended = true),
        () => (ended = true),
      );
      await sleep(600);
      write('demo', { type: 'user', message: { content: 'show me the table' } });
      await sleep(300);
      background(write, 't1', 'sqlite3 shop.db "select * from orders"');
      write('demo', { type: 'assistant', message: { id: 'a1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'The query runs in the background; the table follows.' }] } });
      // past the tail of that answer: the take goes on
      await sleep((CLAUDE_TAIL_SECONDS + 1.5) * 1000);
      expect(ended).toBe(false);
      write('demo', { type: 'queue-operation', operation: 'enqueue', content: notice('t1') });
      write('demo', { type: 'user', message: { content: notice('t1') } });
      await sleep(300);
      write('demo', { type: 'assistant', message: { id: 'a2', stop_reason: 'end_turn', content: [{ type: 'text', text: '| order | total |' }] } });
      const take = await recording.done;

      expect(take.stopReason).toBe('claude');
      expect(take.warnings).toEqual([]);
      const markers = markersOf(projectDir, take.markers);
      expect(markers.map(({ kind, label }) => (label ? `${kind}:${label}` : kind))).toEqual(['prompt', 'tool:Bash', 'answer', 'answer']);
      // the table's answer, not the first one, ends the take
      expect(take.seconds).toBeGreaterThan(markers[3]!.t + CLAUDE_TAIL_SECONDS - 0.3);
      expect(take.seconds).toBeLessThan(markers[3]!.t + CLAUDE_TAIL_SECONDS + 1);
    });
  }, SLOW);

  it('stops anyway once the session has been quiet for untilClaudeQuietSeconds, and says why (a server never ends)', async () => {
    const projectDir = project();
    const { config, cwd, write } = transcripts();
    await withConfig(config, async () => {
      const recording = record({ ...test, projectDir, stop: { untilClaude: cwd, untilClaudeQuietSeconds: 2, maxSeconds: 20 } });
      await sleep(600);
      write('demo', { type: 'user', message: { content: 'start the app' } });
      await sleep(300);
      background(write, 't1', 'npm run dev');
      write('demo', { type: 'assistant', message: { id: 'a1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'It runs at http://localhost:3000.' }] } });
      const take = await recording.done;

      expect(take.stopReason).toBe('claude');
      expect(take.warnings).toEqual(['Claude Code left a command or agent running in the background (a server?): the take ended 2 s after the last step in its session']);
      const answer = markersOf(projectDir, take.markers).find((marker) => marker.kind === 'answer')!.t;
      expect(take.seconds).toBeGreaterThan(answer + 2 + CLAUDE_TAIL_SECONDS - 0.3);
      expect(take.seconds).toBeLessThan(answer + 2 + CLAUDE_TAIL_SECONDS + 1.5);
    });
  }, SLOW);

  it('counts work Claude stopped itself as done: the take ends after its answer', async () => {
    const projectDir = project();
    const { config, cwd, write } = transcripts();
    await withConfig(config, async () => {
      const recording = record({ ...test, projectDir, stop: { untilClaude: cwd, maxSeconds: 15 } });
      await sleep(600);
      write('demo', { type: 'user', message: { content: 'check the page, then stop the server' } });
      await sleep(300);
      background(write, 't1', 'npm run dev');
      write('demo', { type: 'assistant', message: { id: 'm-t2', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'TaskStop', input: { task_id: 'b-t1' } }] } });
      write('demo', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: '{"message":"Successfully stopped task: b-t1 (npm run dev)","task_id":"b-t1"}' }] } });
      write('demo', { type: 'assistant', message: { id: 'a1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'The page works; the server is stopped.' }] } });
      const take = await recording.done;

      expect(take.stopReason).toBe('claude');
      expect(take.warnings).toEqual([]);
      const answer = markersOf(projectDir, take.markers).find((marker) => marker.kind === 'answer')!.t;
      expect(take.seconds).toBeLessThan(answer + CLAUDE_TAIL_SECONDS + 1);
    });
  }, SLOW);

  it('follows a session whose prompt came during the countdown', async () => {
    const projectDir = project();
    const { config, cwd, write } = transcripts();
```

Run: `pnpm exec vitest run --project node packages/recorder/test/record.test.ts -t "Claude Code turn"`
Expected: FAIL: the take ends after the first answer.

- [ ] **Step 2: The wait**

In `packages/recorder/src/types.ts`, replace:

```ts
  /**
   * The folder Claude Code runs in. Stops `CLAUDE_TAIL_SECONDS` after the first session in that folder
   * that submits a prompt after `record()` was called (the countdown included) finishes its turn; its
   * prompts, tool calls and final answer become markers.
   */
  untilClaude?: string;
}

export interface RecordOptions {
```

with:

```ts
  /**
   * The folder Claude Code runs in. Stops `CLAUDE_TAIL_SECONDS` after the first session in that folder
   * that submits a prompt after `record()` was called (the countdown included) finishes its turn; its
   * prompts, tool calls and answers become markers. A turn that left commands or agents running in the
   * background is not the end: the take stops after Claude's answer once they are done, or after
   * `untilClaudeQuietSeconds` without anything new in the session (a server it started never ends).
   */
  untilClaude?: string;
  /** See `untilClaude` (default `CLAUDE_BACKGROUND_SECONDS`). */
  untilClaudeQuietSeconds?: number;
}

export interface RecordOptions {
```

In `packages/recorder/src/record.ts`, replace:

```ts
const DEFAULT_COUNTDOWN_SECONDS = 3;
/** Seconds kept after Claude's final answer, so the video shows it. */
export const CLAUDE_TAIL_SECONDS = 2;
/** Seconds a track may take to deliver its first frame or sample (a DirectShow device can be slow to open, macOS may ask for access first). */
const START_TIMEOUT_SECONDS = 20;
const FILE_POLL_MS = 200;
```

with:

```ts
const DEFAULT_COUNTDOWN_SECONDS = 3;
/** Seconds kept after Claude's final answer, so the video shows it. */
export const CLAUDE_TAIL_SECONDS = 2;
/**
 * When Claude answers while commands or agents it started still run in the background, the take
 * waits for them and for its answer after them, but not past this many seconds without anything new
 * in its transcript: a server it started never ends.
 */
export const CLAUDE_BACKGROUND_SECONDS = 60;
/** Seconds a track may take to deliver its first frame or sample (a DirectShow device can be slow to open, macOS may ask for access first). */
const START_TIMEOUT_SECONDS = 20;
const FILE_POLL_MS = 200;
```

In the same file, replace:

```ts
      claudeTimer = timer(() => control.request('claude'), CLAUDE_TAIL_SECONDS * 1000);
    };
    startTriggers(options.stop, recordedNow, control, () => capturing && tracks !== undefined && tracks.frozen && now() - lastInput >= (options.stop.untilIdleSeconds ?? Infinity), timer);
    claude?.attach((signal) => {
      addMarker({ kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) }, signal.time);
      if (signal.kind !== 'answer' || claudeStop) return;
      claudeStop = true;
      if (capturing) stopForClaude();
    });

    let reason: StopReason;
```

with:

```ts
      claudeTimer = timer(() => control.request('claude'), CLAUDE_TAIL_SECONDS * 1000);
    };
    startTriggers(options.stop, recordedNow, control, () => capturing && tracks !== undefined && tracks.frozen && now() - lastInput >= (options.stop.untilIdleSeconds ?? Infinity), timer);
    // An answer while commands or agents Claude started still run in the background is not the end:
    // their results come in a later answer. Anything new in the session restarts the wait for it.
    /** The tool calls that started background work still running, and their task ids (Claude stops a task by its id). */
    const background = new Set<string>();
    const tasks = new Map<string, string>();
    let waiting = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const quiet = options.stop.untilClaudeQuietSeconds ?? CLAUDE_BACKGROUND_SECONDS;
    const claudeDone = () => {
      claudeStop = true;
      clearTimeout(quietTimer);
      if (capturing) stopForClaude();
    };
    claude?.attach((signal) => {
      if (signal.kind === 'background' && signal.id !== undefined) {
        background.add(signal.id);
        if (signal.task !== undefined) tasks.set(signal.task, signal.id);
      } else if (signal.kind === 'finished') {
        const id = signal.id ?? (signal.task === undefined ? undefined : tasks.get(signal.task));
        if (id !== undefined) background.delete(id);
      } else if (signal.kind !== 'background') addMarker({ kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) }, signal.time);
      if (claudeStop) return;
      if (signal.kind === 'answer') {
        if (background.size === 0) return claudeDone();
        waiting = true;
      }
      if (!waiting) return;
      clearTimeout(quietTimer);
      quietTimer = timer(() => {
        if (claudeStop) return;
        reporter.warn(`Claude Code left ${background.size === 1 ? 'a command or agent' : `${background.size} commands or agents`} running in the background (a server?): the take ended ${quiet} s after the last step in its session`);
        claudeDone();
      }, quiet * 1000);
    });

    let reason: StopReason;
```

In the same file, replace:

```ts
  };
  positive('maxSeconds', options.stop.maxSeconds);
  positive('untilIdleSeconds', options.stop.untilIdleSeconds);
  const countdown = options.countdownSeconds;
  if (countdown !== undefined && !(Number.isFinite(countdown) && countdown >= 0)) throw invalid('countdownSeconds must be 0 or more');
  const flag = options.stop.untilFile === undefined ? undefined : resolve(options.stop.untilFile);
```

with:

```ts
  };
  positive('maxSeconds', options.stop.maxSeconds);
  positive('untilIdleSeconds', options.stop.untilIdleSeconds);
  positive('untilClaudeQuietSeconds', options.stop.untilClaudeQuietSeconds);
  const countdown = options.countdownSeconds;
  if (countdown !== undefined && !(Number.isFinite(countdown) && countdown >= 0)) throw invalid('countdownSeconds must be 0 or more');
  const flag = options.stop.untilFile === undefined ? undefined : resolve(options.stop.untilFile);
```

Run: `pnpm exec vitest run --project node packages/recorder`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/recorder
git commit -m "recorder: untilClaude waits for the background work Claude left running

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The words, and final verification

**Files:**
- Modify: `apps/cli/src/main.ts`, `README.md`, `skill/cuttle/SKILL.md`

- [ ] **Step 1: The CLI's help, the README and the skill**

In `apps/cli/src/main.ts`, replace:

```ts
    .option('--window <title>', 'a window, by (part of) its title')
    .option('--webcam [name]', 'record a webcam (default: the first one)')
    .option('--mic [name]', 'record a microphone (default: the first one)')
    .option('--until-claude [cwd]', 'stop when the Claude Code session in that folder (default: here) finishes its turn')
    .option('--until-file <path>', 'stop when this file appears')
    .option('--until-idle <seconds>', 'stop when the screen and the input rested this long', positive)
    .option('--max <seconds>', 'stop after this long', positive)
```

with:

```ts
    .option('--window <title>', 'a window, by (part of) its title')
    .option('--webcam [name]', 'record a webcam (default: the first one)')
    .option('--mic [name]', 'record a microphone (default: the first one)')
    .option('--until-claude [cwd]', 'stop when the Claude Code session in that folder (default: here) finishes its turn, after what it runs in the background')
    .option('--until-file <path>', 'stop when this file appears')
    .option('--until-idle <seconds>', 'stop when the screen and the input rested this long', positive)
    .option('--max <seconds>', 'stop after this long', positive)
```

In `README.md`, replace:

````markdown
```bash
cuttle init demo && cd demo
cuttle devices                       # monitors, windows, cameras, microphones
cuttle record --mic --until-claude   # stops when Claude Code in this folder ends its turn (or Ctrl+C)
cuttle suggest                       # scenes: quiet start and end trimmed, idle cut, waiting sped up, zooms on the answer and on clicks
cuttle preview                       # 12 stills and a contact sheet in preview/
cuttle frame 42.5 --grid             # a source frame with a numbered pixel grid, for masks and zooms
````

with:

````markdown
```bash
cuttle init demo && cd demo
cuttle devices                       # monitors, windows, cameras, microphones
cuttle record --mic --until-claude   # stops when Claude Code in this folder has answered, background work included (or Ctrl+C)
cuttle suggest                       # scenes: quiet start and end trimmed, idle cut, waiting sped up, zooms on the answer and on clicks
cuttle preview                       # 12 stills and a contact sheet in preview/
cuttle frame 42.5 --grid             # a source frame with a numbered pixel grid, for masks and zooms
````

In `skill/cuttle/SKILL.md`, replace:

```markdown
  `cuttle.json` still points at the previous take. After a stop by file, `record` removes the file
  again.
- `--until-claude "<folder>"`: also ends the take 2 s after the first Claude Code session in that
  folder that prompts after the start finishes its turn; its prompt, tool calls and answer become
  markers. If that folder is the one you run in, tell the user not to write to you until the
  recording has stopped: your own next turn would end it.
- `--until-idle 5`: also ends once the screen and the input have rested 5 s.
- `--max <seconds>` is the safety net (it counts recorded time, not pauses). The user can also stop
```

with:

```markdown
  `cuttle.json` still points at the previous take. After a stop by file, `record` removes the file
  again.
- `--until-claude "<folder>"`: also ends the take 2 s after the first Claude Code session in that
  folder that prompts after the start finishes its turn; its prompt, tool calls and answers become
  markers. A turn that leaves commands, agents or monitors running in the background does not end
  it: the take ends after Claude's answer once they are done (their results are in it), or 60 s
  after the last step in that session when one never ends (a server it started; the output then
  says so). If that folder is the one you run in, tell the user not to write to you until the
  recording has stopped: your own next turn would end it.
- `--until-idle 5`: also ends once the screen and the input have rested 5 s.
- `--max <seconds>` is the safety net (it counts recorded time, not pauses). The user can also stop
```

Run: `pnpm exec vitest run --project node skill apps/cli/test/cli.test.ts`
Expected: PASS.

```bash
git add apps/cli README.md skill
git commit -m "docs: --until-claude waits for Claude's background work

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 962 passed and 79 skipped (here, with a speech model and ffmpeg's whisper filter; without them the real transcriptions are skipped too, and off Windows and macOS the OCR tests).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 15 tests.

Run: `pnpm app:check`
Expected: PASS, 58 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 3: By hand (the user)**

1. Install the new version (the `cuttle` command is the app's own copy), and the skill again from the app's settings.
2. Record a demo in which Claude runs a query in the background, and ask for the result as a table. The take ends about 2 s after the table is on the screen, not after "I'll be notified".
3. Record one in which Claude starts a dev server and answers: the take ends a minute later, and `cuttle record` warns about it; `suggest` trims that quiet minute.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this is merged on the local checks: Windows only, macOS not run. The change is in transcript parsing and timers, the same on both.

**Found while checking, and already in the plan above**
- **Monitors and resumed agents** were missing from the first version (they report back later too): the real transcript showed their ends without a start.
- **`TaskStop`** leaves no notice: a server Claude stopped itself would have kept the take waiting a minute. It ends the work now, by its task id.
- **P5-M4b's mic test** failed once in three runs on a loaded machine (1.535 s of samples against a 2.06 s screen file): it compares with the time recorded now.

**Seen while checking, not changed**
- Tests that time out or count input on a loaded machine failed in two of three full `pnpm test` runs, as before this change: a random edit-sequence test of `document.test.ts` (its 5 s) in both, and in one of them the recorder's "stops when asked …" (its screen track had not started) and its dead-zone test (10 pointer events in 2 s, it wants more than 10). The third run passed whole; each passed alone.

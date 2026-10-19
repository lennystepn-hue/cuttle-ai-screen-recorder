# Cuttle Privacy 3: Random-Looking Strings, and the Screen's Text Kept Redacted Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two gaps closed.
- A key without a known prefix and without a name beside it (an AWS secret in a table, a bare token) is found because it looks random, and masked.
- The screen's text the project keeps (`takes/<n>/screen-text.jsonl`) holds no secret any more: each private thing in it is a mark such as `⟦key-qwhzbtrk⟧`.

**Architecture:** Both in `@cuttle/core`, `privacy/`:
- `patterns.ts` gets the kind `random` and `randomLooking(run, line)`, an entropy check on runs of key characters. `findSecrets` tries it last, on runs no other rule found.
- The new `redact.ts` replaces each word of a private thing with a mark of its kind and an id: the same text gets the same id in one file (an HMAC whose key is made for that file and never kept). `findSecrets` finds the marks again, so the masks read from the kept text are the masks read from the screen.
- `read.ts` writes the file through `redactFrames`, and `keepRedacted` marks what an older version, or a word added since, left readable when the file is read back (`applyPrivacy`, `suggest`).

**Tech Stack:** TypeScript strict, `node:crypto`.

The third of three PRs on gaps that questions under the launch post found. The first two: `docs/superpowers/plans/2026-10-19-cuttle-privacy-1-edges-keys.md` and `docs/superpowers/plans/2026-10-19-cuttle-privacy-2-flashes.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `privacy-random-redact`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- No key-like text stands in the source or the tests: the tests put keys together at run time or make them from a seeded generator (GitHub's push protection refuses such text).
- The full `pnpm test` and the typecheck run in Task 3.

## Decisions made while planning

The gaps were checked in the code first: `findSecrets` found a key only by a known prefix or by a name such as `API_KEY=` beside it, and `writeScreenText` wrote every word as the OCR read it. The finished prototype passed `pnpm test` (975 tests, 80 skipped, in two full runs), the typecheck, `cli:check` (16 tests) and `app:check` (58 tests, on its second run: see the end of this plan). Every screenshot was looked at.

- **What looks random** (`RANDOM_RULES`):
  - a run of key characters (letters, digits, `+ / = _ -`) of 24 or more;
  - with a stretch of 16 or more between its separators (words joined by dashes are not random);
  - with letters and digits that take turns often (30 % of neighbours of another class; `createUser2024Handler` changes seldom);
  - and as varied as random characters nearly are (80 % of the most bits a character a run that long can have).
  - A run of hex digits counts from 32 characters, and not on a line that names a hash (`commit`, `sha256`, `digest`, `integrity`).
  - Never a run that starts with `/` (a path) or with `sha512-` and the like.
- **Measured on 2000 random keys of each kind:** letters and digits 92 % at 24 characters, 97 % at 32, 99 % at 40; base64 at 40 (an AWS secret) 92 %; lower case and digits at 32 80 %; hex 99.5 % at 32 and all at 40 and 64. On 19 typical lines of a developer's screen (commits, image digests, `integrity` hashes, UUIDs, paths, `node_modules` folders, identifiers, versions, a link, a base64 PNG) it found nothing.
- **The random rule goes last:** a run that another rule found (a key with its prefix, the value of `API_KEY=`) keeps that kind and its label.
- **Marks, not blanks:**
  - The masks are made from the kept text again (`applyPrivacy` after a word was added, `suggest` after a new cut), so the text must still say where each private thing was and which ones are the same.
  - A mark keeps the word's rect, its kind (the mask's label) and an id that is the same for the same text in one file, so text that scrolls is followed as before.
  - The id is eight letters from an HMAC-SHA256 whose key is 16 random bytes made for the file and never kept: no one can test a guess against it. Letters only, so no rule reads a number in a mark.
- **Files written before:** `keepRedacted` marks them the first time they are read back (`applyPrivacy`, `suggest`), and writes them only when it marked something. A dry run writes nothing.
- **What stays:** the video in `takes/` still shows what the screen showed; the README says to share the exported video, never the project folder. A word taken out of `privacy.words` stays marked in the kept text, so its masks stay too (the safe side).

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/privacy/patterns.ts` | the `random` kind, the marks, the words a secret covers |
| `packages/core/src/privacy/redact.ts` | the screen's text with each private thing marked |
| `packages/core/src/privacy/read.ts`, `apply.ts`, `masks.ts`, `packages/core/src/suggest.ts`, `packages/core/src/index.ts` | the text written and read back redacted |
| `README.md`, `skill/cuttle/SKILL.md` | the guide and Claude's skill |

---

### Task 1: Random-looking strings

**Files:**
- Modify: `packages/core/src/privacy/patterns.ts`, `packages/core/src/privacy/masks.ts`
- Test: `packages/core/test/patterns.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `privacy-random-redact`; work there:

```bash
git switch privacy-random-redact
```

- [ ] **Step 2: Write the failing tests**

Random keys made from a fixed seed are found as `random`; hashes, UUIDs, paths, identifiers and versions are not; marks are found with their kind.

In `packages/core/test/patterns.test.ts`, replace:

```ts
    for (const clean of ['npm_config_cache C:\\npm-cache', 'TZ Asia/Tokyo', 'vite sg.config.ts', 'hf_hub_download(repo_id)', 'r8_model ready', 'see ya29.example']) expect(found(clean), clean).toEqual([]);
  });

  it('finds tokens in links, and the value of a private name', () => {
    expect(found('$ curl "https://api.examp1e.com/v1/items?access_token=abc123def456ghi789"')).toContainEqual(['token', 'abc123def456ghi789']);
    expect(found('Password: hunter2 (do not share)')).toEqual([['value', 'hunter2 (do not share)']]);
```

with:

```ts
    for (const clean of ['npm_config_cache C:\\npm-cache', 'TZ Asia/Tokyo', 'vite sg.config.ts', 'hf_hub_download(repo_id)', 'r8_model ready', 'see ya29.example']) expect(found(clean), clean).toEqual([]);
  });

  it('finds a random-looking string without a prefix or a name beside it', () => {
    // random keys, made here from a fixed seed (no key-like text stands in the source)
    let seed = 7;
    const pick = (alphabet: string, length: number) =>
      Array.from({ length }, () => alphabet[Math.floor(((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000) * alphabet.length)]).join('');
    const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let i = 0; i < 3; i++) {
      const secret = pick(base64, 40);
      expect(found(`| prod | ${secret} |`), secret).toEqual([['random', secret]]);
      const hex = pick('0123456789abcdef', 40);
      expect(found(`token ${hex}`), hex).toEqual([['random', hex]]);
    }
  });

  it("leaves hashes, ids, paths, identifiers and versions alone, and finds the kept text's marks", () => {
    for (const clean of [
      'commit 3f786850e387550fdab836ed7e6dc881de23001b',
      'docker pull node@sha256:9d4aeb2f8e0b6a3c71b2c5e4d3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4',
      '"integrity": "sha512-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvWxYz0123456789=="',
      'id 550e8400-e29b-41d4-a716-446655440000',
      'createUser2024Session1234Handler',
      'my-component-v2-final-2024-release-candidate',
      '/home/user/projects/app-2024/src/components/Button123.tsx',
      'node_modules/.pnpm/@vitest+browser-playwright@5.0.5_playwright@1.55.0',
      'ThisIsAVeryLongCamelCaseIdentifier42ForTesting',
      'TEST_DATABASE_CONNECTION_POOL_SIZE_2024_V2',
      'abcdefghijklmnopqrstuvwxyz0123456789',
    ]) expect(found(clean), clean).toEqual([]);
    expect(found('API_KEY=⟦key-abcdefgh⟧ sent to ⟦email-qwertyui⟧ ⟦email-qwertyui⟧')).toEqual([
      ['key', '⟦key-abcdefgh⟧'],
      ['email', '⟦email-qwertyui⟧ ⟦email-qwertyui⟧'],
      ['value', '⟦key-abcdefgh⟧ sent to ⟦email-qwertyui⟧ ⟦email-qwertyui⟧'],
    ]);
  });

  it('finds tokens in links, and the value of a private name', () => {
    expect(found('$ curl "https://api.examp1e.com/v1/items?access_token=abc123def456ghi789"')).toContainEqual(['token', 'abc123def456ghi789']);
    expect(found('Password: hunter2 (do not share)')).toEqual([['value', 'hunter2 (do not share)']]);
```

Run: `pnpm exec vitest run --project node packages/core/test/patterns.test.ts`
Expected: FAIL: the random keys and the marks are not found.

- [ ] **Step 3: The rule, the marks, and the words a secret covers**

`SPECIFIC` moves here from `masks.ts`, since `redact.ts` (Task 2) needs it too.

In `packages/core/src/privacy/patterns.ts`, replace:

```ts
// a slashed zero reads as ø, and a key's prefix may have one wrong letter. Pure.
import { normWord, type Rect, type ScreenTextLine } from '@cuttle/project';

export const SECRET_KINDS = ['email', 'key', 'token', 'value', 'iban', 'card', 'phone', 'word'] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** What to call a mask over each kind, for people. */
export const SECRET_LABELS: Record<SecretKind, string> = {
  email: 'Email address',
```

with:

```ts
// a slashed zero reads as ø, and a key's prefix may have one wrong letter. Pure.
import { normWord, type Rect, type ScreenTextLine } from '@cuttle/project';

export const SECRET_KINDS = ['email', 'key', 'token', 'value', 'iban', 'card', 'phone', 'word', 'random'] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** Which kind names what two rules found: the more specific first (a key in a NAME=value line is a key). */
export const SPECIFIC: readonly SecretKind[] = ['key', 'token', 'iban', 'card', 'email', 'phone', 'word', 'value', 'random'];

/** What to call a mask over each kind, for people. */
export const SECRET_LABELS: Record<SecretKind, string> = {
  email: 'Email address',
```

In the same file, replace:

```ts
  card: 'Card number',
  phone: 'Phone number',
  word: 'Always masked',
};

/** A private thing on a line: its kind, the words it covers (their rect), and its text, compared across frames. */
export interface Secret {
  kind: SecretKind;
```

with:

```ts
  card: 'Card number',
  phone: 'Phone number',
  word: 'Always masked',
  random: 'Random-looking string',
};

/**
 * A private thing in the screen's text as it is kept (redact.ts): a mark of its kind and an id,
 * word for word, `⟦key-qwhzbtrk⟧`.
 */
export const MARK = new RegExp(`⟦(${SECRET_KINDS.join('|')})-([a-z]{8})⟧`);
/** A word that is a mark. */
export const isMark = (text: string) => new RegExp(`^${MARK.source}$`).test(text);

/**
 * A random-looking string, a key without a known prefix or a name beside it (an AWS secret in a
 * table, a bare token): a run of key characters (letters, digits, `+ / = _ -`) at least `length`
 * long, with a stretch between its separators at least `stretch` long (words joined by dashes are
 * not random), letters and digits that take turns often (`changes`: the share of neighbours of
 * another class; an identifier like createUser2024Handler changes seldom), and as varied as random
 * characters nearly are (`varied`: the share of the most a run that long can be, in bits a
 * character). A run of hex digits counts from `hex` characters, and not on a line that names a
 * hash (a commit, a digest). Of random keys of letters and digits it finds 92 % at 24 characters,
 * 97 % at 32 and 99 % at 40; of base64 ones (an AWS secret, 40 characters) 92 %; of hex ones nearly
 * all from 32. On typical lines of a developer's screen (hashes, UUIDs, paths, identifiers,
 * versions) it finds nothing.
 */
export const RANDOM_RULES = { length: 24, stretch: 16, changes: 0.3, varied: 0.8, hex: 32 };
const HASH_NAMES = /\b(sha\d*|md5|commit|hash|digest|checksum|integrity)\b/i;

/** Whether `run` (a run of key characters on `line`) looks random (`RANDOM_RULES`). */
export function randomLooking(run: string, line: string, rules = RANDOM_RULES): boolean {
  if (run.length < rules.length) return false;
  // a path, or a hash with its algorithm in front (sha512-…)
  if (run.startsWith('/') || /^(sha\d+|md5)-/i.test(run)) return false;
  if (Math.max(...run.split(/[+/=_-]+/).map((part) => part.length)) < rules.stretch) return false;
  const counts = new Map<string, number>();
  for (const char of run) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) bits -= (n / run.length) * Math.log2(n / run.length);
  if (/^[0-9a-f]+$/i.test(run)) return run.length >= rules.hex && !HASH_NAMES.test(line) && bits >= rules.varied * Math.log2(Math.min(run.length, 16));
  if ((run.match(/\d/g) ?? []).length < 2 || (run.match(/[a-z]/gi) ?? []).length < 2) return false;
  const kind = (char: string) => (/\d/.test(char) ? 0 : /[a-z]/.test(char) ? 1 : /[A-Z]/.test(char) ? 2 : 3);
  let changes = 0;
  for (let i = 1; i < run.length; i++) if (kind(run[i]!) !== kind(run[i - 1]!)) changes++;
  return changes / (run.length - 1) >= rules.changes && bits >= rules.varied * Math.log2(Math.min(run.length, 64));
}

/** A private thing on a line: its kind, the words it covers (their rect), and its text, compared across frames. */
export interface Secret {
  kind: SecretKind;
```

In the same file, replace:

```ts
  const found: Match[] = [];
  const add = (kind: SecretKind, from: number, to: number) => found.push({ kind, from, to, text: text.slice(from, to) });

  // email addresses
  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) add('email', match.index, match.index + match[0].length);
  // a token in a link, and a password in one (https://user:password@host)
```

with:

```ts
  const found: Match[] = [];
  const add = (kind: SecretKind, from: number, to: number) => found.push({ kind, from, to, text: text.slice(from, to) });

  // what the kept text already marks (redact.ts): the mark, repeated word for word
  for (const match of text.matchAll(new RegExp(`${MARK.source}(?: ⟦\\1-\\2⟧)*`, 'g'))) add(match[1] as SecretKind, match.index, match.index + match[0].length);
  // email addresses
  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) add('email', match.index, match.index + match[0].length);
  // a token in a link, and a password in one (https://user:password@host)
```

In the same file, replace:

```ts
      if (same) add('word', tokens[i]!.index, tokens[i + parts.length - 1]!.index + tokens[i + parts.length - 1]![0].length);
    }
  }
  return found;
}
```

with:

```ts
      if (same) add('word', tokens[i]!.index, tokens[i + parts.length - 1]!.index + tokens[i + parts.length - 1]![0].length);
    }
  }
  // a random-looking string that no rule above found
  for (const match of text.matchAll(/[A-Za-z0-9+/=_-]{24,}/g)) {
    const from = match.index;
    const to = from + match[0].length;
    if (found.some((other) => other.from < to && from < other.to)) continue;
    if (randomLooking(match[0], text)) add('random', from, to);
  }
  return found;
}
```

In the same file, replace:

```ts
 * text is its words joined by spaces.
 */
export function lineSecrets(line: ScreenTextLine, words: readonly string[] = []): Secret[] {
  const spans: { from: number; to: number; rect: Rect }[] = [];
  let at = 0;
  for (const word of line.words) {
```

with:

```ts
 * text is its words joined by spaces.
 */
export function lineSecrets(line: ScreenTextLine, words: readonly string[] = []): Secret[] {
  return secretWords(line, words).map(({ kind, rect, key }) => ({ kind, rect, key }));
}

/** `lineSecrets`, with the indexes of the words each covers (to mark them, redact.ts). */
export function secretWords(line: ScreenTextLine, words: readonly string[] = []): (Secret & { words: number[] })[] {
  const spans: { from: number; to: number; rect: Rect }[] = [];
  let at = 0;
  for (const word of line.words) {
```

In the same file, replace:

```ts
  }
  const text = line.words.map((word) => word.text).join(' ');
  return findSecrets(text, words).flatMap((match) => {
    const covered = spans.filter((span) => span.from < match.to && match.from < span.to);
    if (covered.length === 0) return [];
    const left = Math.min(...covered.map((span) => span.rect[0]));
    const top = Math.min(...covered.map((span) => span.rect[1]));
    const right = Math.max(...covered.map((span) => span.rect[0] + span.rect[2]));
    const bottom = Math.max(...covered.map((span) => span.rect[1] + span.rect[3]));
    return [{ kind: match.kind, rect: [left, top, right - left, bottom - top] as Rect, key: `${match.kind}:${keyOf(match.text)}` }];
  });
}
```

with:

```ts
  }
  const text = line.words.map((word) => word.text).join(' ');
  return findSecrets(text, words).flatMap((match) => {
    const covered = spans.flatMap((span, index) => (span.from < match.to && match.from < span.to ? [index] : []));
    if (covered.length === 0) return [];
    const rects = covered.map((index) => spans[index]!.rect);
    const left = Math.min(...rects.map((rect) => rect[0]));
    const top = Math.min(...rects.map((rect) => rect[1]));
    const right = Math.max(...rects.map((rect) => rect[0] + rect[2]));
    const bottom = Math.max(...rects.map((rect) => rect[1] + rect[3]));
    return [{ kind: match.kind, rect: [left, top, right - left, bottom - top] as Rect, key: `${match.kind}:${keyOf(match.text)}`, words: covered }];
  });
}
```

In `packages/core/src/privacy/masks.ts`, replace:

```ts
// to just after it was last seen, following it where it moved (text that scrolls). Pure.
import type { Rect, ScreenTextFrame, ZoomMove } from '@cuttle/project';
import { maskRectAt } from '@cuttle/timeline';
import { SECRET_LABELS, lineSecrets, type SecretKind } from './patterns';

export const MASK_RULES = {
  /** A mask starts this long before the first sight and ends this long after the last (source s). */
```

with:

```ts
// to just after it was last seen, following it where it moved (text that scrolls). Pure.
import type { Rect, ScreenTextFrame, ZoomMove } from '@cuttle/project';
import { maskRectAt } from '@cuttle/timeline';
import { SECRET_LABELS, SPECIFIC, lineSecrets, type SecretKind } from './patterns';

export const MASK_RULES = {
  /** A mask starts this long before the first sight and ends this long after the last (source s). */
```

In the same file, replace:

```ts
  return joinCovering(masks);
}

/** Which kind names a mask that two rules found: the more specific. */
const SPECIFIC: readonly SecretKind[] = ['key', 'token', 'iban', 'card', 'email', 'phone', 'word', 'value'];

/**
 * Masks over the same text, found by two rules (a key in a `NAME=value` line), are one: those that
 * overlap in time and, place by place (their rect, then each move at the same time), one covers
```

with:

```ts
  return joinCovering(masks);
}

/**
 * Masks over the same text, found by two rules (a key in a `NAME=value` line), are one: those that
 * overlap in time and, place by place (their rect, then each move at the same time), one covers
```

Run: `pnpm exec vitest run --project node packages/core/test/patterns.test.ts packages/core/test/privacy-masks.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core
git commit -m "privacy: random-looking strings found and masked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The screen's text kept redacted

**Files:**
- Create: `packages/core/src/privacy/redact.ts`, `packages/core/test/redact.test.ts`
- Modify: `packages/core/src/privacy/read.ts`, `packages/core/src/privacy/apply.ts`, `packages/core/src/suggest.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/privacy-ocr.test.ts`, `packages/core/test/privacy-apply.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/redact.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ScreenTextFrame, ScreenTextLine } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';
import { redactFrames } from '../src/privacy/redact';

/** A line of text at (x, y): each character 10 px wide and 20 px high, words one character apart. */
function line(text: string, x: number, y: number): ScreenTextLine {
  let at = x;
  const words = text.split(' ').map((word) => {
    const rect: [number, number, number, number] = [at, y, word.length * 10, 20];
    at += (word.length + 1) * 10;
    return { text: word, rect };
  });
  return { text, rect: [x, y, at - x - 10, 20], words };
}
const frame = (t: number, ...lines: ScreenTextLine[]): ScreenTextFrame => ({ t, lines });
const screen = { width: 1920, height: 1080 };

// put together here, so no key-like text stands in the source
const KEY = 'sk-ant-api03-' + 'AbCdEf1234567890GhIjKlMn';
const RANDOM = 'wJ7r' + 'Xu9tnF2EMk/K7MDq5NG/bP3xRfi8CYk0p4LKQ1zH';
const WORDS = ['Lena Müller'];
const lines = (y: number) => [
  line(`ANTHROPIC_API_KEY=${KEY}`, 100, y),
  line('Signed in as lena.mueller@example.com', 100, 200),
  line('Thanks, Lena Müller', 100, 300),
  line(`| prod | ${RANDOM} |`, 100, 400),
  line('Release 2026-10-19, build 4.2.1', 100, 500),
];
// the key scrolls up at 2 s; all of it is gone at 2.5 s
const FRAMES = [frame(1, ...lines(100)), frame(1.5, ...lines(100)), frame(2, ...lines(60)), frame(2.5), frame(3), frame(4)];

describe('redactFrames', () => {
  it('marks each private thing word for word, keeps the rest, and the masks are the same', () => {
    const { frames, redacted } = redactFrames(FRAMES, WORDS);
    const kept = JSON.stringify(frames);
    for (const secret of [KEY, 'lena.mueller@example.com', 'Lena', 'Müller', RANDOM]) expect(kept, secret).not.toContain(secret);
    expect(kept).toContain('Signed in as');
    expect(kept).toContain('Release 2026-10-19, build 4.2.1');
    // 3 frames: the key, the email, the two words, the random string
    expect(redacted).toBe(3 * 5);
    expect(privacyMasks(frames, WORDS, screen)).toEqual(privacyMasks(FRAMES, WORDS, screen));
    expect(privacyMasks(frames, WORDS, screen).map((mask) => mask.label)).toEqual(['Key', 'Email address', 'Always masked', 'Random-looking string']);
  });

  it('gives the same text one mark in a file, other texts other marks, of letters only; the line reads as its words', () => {
    const { frames } = redactFrames(FRAMES, WORDS);
    const word = (t: number, line: number, index: number) => frames.find((one) => one.t === t)!.lines[line]!.words[index]!.text;
    expect(word(1, 0, 0)).toMatch(/^⟦key-[a-z]{8}⟧$/);
    // the key moved: the same mark
    expect(word(2, 0, 0)).toBe(word(1, 0, 0));
    expect(word(1, 1, 3)).toMatch(/^⟦email-[a-z]{8}⟧$/);
    expect(word(1, 2, 1)).toBe(word(1, 2, 2));
    expect(word(1, 2, 1)).toMatch(/^⟦word-[a-z]{8}⟧$/);
    expect(new Set([word(1, 0, 0), word(1, 1, 3), word(1, 2, 1), word(1, 3, 2)]).size).toBe(4);
    const signed = frames[0]!.lines[1]!;
    expect(signed.text).toBe(signed.words.map((one) => one.text).join(' '));
  });

  it('leaves frames marked already as they are, and a new file gets new ids', () => {
    const salt = Buffer.alloc(16, 1);
    const once = redactFrames(FRAMES, WORDS, salt).frames;
    expect(redactFrames(once, WORDS)).toEqual({ frames: once, redacted: 0 });
    const other = redactFrames(FRAMES, WORDS, Buffer.alloc(16, 2)).frames;
    expect(other[0]!.lines[0]!.words[0]!.text).not.toBe(once[0]!.lines[0]!.words[0]!.text);
  });
});
```

The text read by Windows' OCR keeps none of what it found, and the same masks; a file an older version wrote is marked when it is read back, once:

In `packages/core/test/privacy-ocr.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import type { Rect } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';
import { ScreenReader } from '../src/privacy/ocr';

/**
```

with:

```ts
import { describe, expect, it } from 'vitest';
import type { Rect } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';
import { redactFrames } from '../src/privacy/redact';
import { ScreenReader } from '../src/privacy/ocr';

/**
```

In the same file, replace:

```ts
      expect(line, clean).toBeDefined();
      expect(under(line!.rect), clean).toBe(false);
    }
  }, 60_000);
});
```

with:

```ts
      expect(line, clean).toBeDefined();
      expect(under(line!.rect), clean).toBe(false);
    }
    // as the text is kept: none of what it found is left, the clean lines are, the masks are the same
    const read = [{ t: 1, lines }, { t: 2, lines: [] }, { t: 3, lines: [] }];
    const kept = redactFrames(read, []).frames;
    const keptText = JSON.stringify(kept);
    for (const secret of ['lena.mueller@example.com', 'DE89', 'AbCdEf', 'AKIA', 'SESSION=']) expect(keptText, secret).not.toContain(secret);
    for (const clean of ['Release', 'Order']) expect(keptText, clean).toContain(clean);
    expect(privacyMasks(kept, [], { width: 1920, height: 1080 })).toEqual(masks);
  }, 60_000);
});
```

In `packages/core/test/privacy-apply.test.ts`, replace:

```ts
      ['Email address', 'privacy'],
      ['Notification', 'notification'],
    ]);
    // again, with nothing new: nothing is written
    expect((await applyPrivacy(dir)).written).toBe(false);
  });

  it('masks the notifications without the screen\'s text, and leaves the privacy masks there as they are', async () => {
```

with:

```ts
      ['Email address', 'privacy'],
      ['Notification', 'notification'],
    ]);
    // the screen text as it is kept: the address marked (an older version wrote it as it was)
    const kept = readFileSync(join(dir, 'takes', '1', 'screen-text.jsonl'), 'utf8');
    expect(kept).not.toContain('lena@example.com');
    expect(kept).toMatch(/⟦email-[a-z]{8}⟧/);
    // again, with nothing new: nothing is written, the screen text neither
    expect((await applyPrivacy(dir)).written).toBe(false);
    expect(readFileSync(join(dir, 'takes', '1', 'screen-text.jsonl'), 'utf8')).toBe(kept);
  });

  it('masks the notifications without the screen\'s text, and leaves the privacy masks there as they are', async () => {
```

Run: `pnpm exec vitest run --project node packages/core/test/redact.test.ts`
Expected: FAIL: `../src/privacy/redact` does not exist.

- [ ] **Step 2: The marks**

`packages/core/src/privacy/redact.ts`:

```ts
// The screen's text as it is kept (screen-text.jsonl): each private thing found in it (patterns.ts)
// replaced, word for word, by a mark of its kind and an id, ⟦key-qwhzbtrk⟧. The same text gets the
// same id in one file (a keyed hash whose key is made for that file and never kept), so the masks
// read from the file are the ones read from the text, and nothing private is left in it.
import { createHmac, randomBytes } from 'node:crypto';
import type { ScreenTextFrame } from '@cuttle/project';
import { SPECIFIC, isMark, secretWords, type SecretKind } from './patterns';

/**
 * The frames with each private thing marked (the person's `words` too); `redacted`: how many words
 * were marked now (a word that is a mark already stays as it is).
 */
export function redactFrames(frames: readonly ScreenTextFrame[], words: readonly string[], salt: Buffer = randomBytes(16)): { frames: ScreenTextFrame[]; redacted: number } {
  const ids = new Map<string, string>();
  const idOf = (key: string) => {
    let id = ids.get(key);
    if (id === undefined) {
      // eight letters: no digits, so no rule reads a number in a mark
      id = [...createHmac('sha256', salt).update(key).digest().subarray(0, 8)].map((byte) => String.fromCharCode(97 + (byte % 26))).join('');
      ids.set(key, id);
    }
    return id;
  };
  let redacted = 0;
  const kept = frames.map((frame) => ({
    ...frame,
    lines: frame.lines.map((line) => {
      // each word in a private thing gets the mark of the most specific kind it is in
      const marks = new Map<number, { kind: SecretKind; key: string }>();
      for (const secret of secretWords(line, words)) {
        for (const index of secret.words) {
          const before = marks.get(index);
          if (!before || SPECIFIC.indexOf(secret.kind) < SPECIFIC.indexOf(before.kind)) marks.set(index, secret);
        }
      }
      if (marks.size === 0) return line;
      const marked = line.words.map((word, index) => {
        const mark = marks.get(index);
        if (!mark || isMark(word.text)) return word;
        redacted++;
        return { ...word, text: `⟦${mark.kind}-${idOf(mark.key)}⟧` };
      });
      return { ...line, text: marked.map((word) => word.text).join(' '), words: marked };
    }),
  }));
  return { frames: kept, redacted };
}
```

- [ ] **Step 3: Written and read back redacted**

In `packages/core/src/privacy/read.ts`, replace:

```ts
// Reading the screen's text for the privacy masks: the frames where the picture changed inside the
// clips (compared 10 times a second; read at most 2 a second while it keeps changing, at least one
// every 5 s, and once more where a change showed only a moment), each read with the system's OCR
// (ocr.ts), written as the take's screen-text.jsonl. Only the frames that are read are written to a
// temporary folder, one at a time, and removed once read.
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

with:

```ts
// Reading the screen's text for the privacy masks: the frames where the picture changed inside the
// clips (compared 10 times a second; read at most 2 a second while it keeps changing, at least one
// every 5 s, and once more where a change showed only a moment), each read with the system's OCR
// (ocr.ts), written as the take's screen-text.jsonl with each private thing in it marked instead
// (redact.ts). Only the frames that are read are written to a temporary folder, one at a time, and
// removed once read.
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

In the same file, replace:

```ts
import { runFfmpeg } from '../ffmpeg';
import type { Span } from '../suggest/spans';
import { ScreenReader } from './ocr';

export const READ_RULES = {
  /** The picture is compared this many times a second, so a change that shows only a moment is seen… */
```

with:

```ts
import { runFfmpeg } from '../ffmpeg';
import type { Span } from '../suggest/spans';
import { ScreenReader } from './ocr';
import { redactFrames } from './redact';

export const READ_RULES = {
  /** The picture is compared this many times a second, so a change that shows only a moment is seen… */
```

In the same file, replace:

```ts
  return { frames, language: reader.language };
}

/** Writes screen-text.jsonl (whole, or not at all). */
export function writeScreenText(path: string, frames: readonly ScreenTextFrame[]): void {
  writeFileSync(`${path}.part`, frames.map((frame) => `${JSON.stringify(frame)}\n`).join(''));
  renameSync(`${path}.part`, path);
}
```

with:

```ts
  return { frames, language: reader.language };
}

/**
 * Writes screen-text.jsonl (whole, or not at all), each private thing in it marked (`redactFrames`,
 * with the person's `words`); returns the frames as written, which make the same masks.
 */
export function writeScreenText(path: string, frames: readonly ScreenTextFrame[], words: readonly string[] = []): ScreenTextFrame[] {
  const kept = redactFrames(frames, words).frames;
  writeFileSync(`${path}.part`, kept.map((frame) => `${JSON.stringify(frame)}\n`).join(''));
  renameSync(`${path}.part`, path);
  return kept;
}

/**
 * The frames of a screen-text.jsonl read back, with what is still readable in them marked (one an
 * older version wrote, or a word added since); the file is written again only then.
 */
export function keepRedacted(path: string, frames: readonly ScreenTextFrame[], words: readonly string[] = []): ScreenTextFrame[] {
  const { frames: kept, redacted } = redactFrames(frames, words);
  if (redacted === 0) return [...frames];
  writeFileSync(`${path}.part`, kept.map((frame) => `${JSON.stringify(frame)}\n`).join(''));
  renameSync(`${path}.part`, path);
  return kept;
}
```

In `packages/core/src/privacy/apply.ts`, replace:

```ts
import { privacyMasks, type PrivacyMask } from './masks';
import { notificationMasks } from './notifications';
import type { SecretKind } from './patterns';
import { SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './read';

/** A mask as written to cuttle.json. */
export type RawMask = Record<string, unknown> & { from: number; to: number; rect: Rect; auto?: string; enabled?: boolean; label?: string };
```

with:

```ts
import { privacyMasks, type PrivacyMask } from './masks';
import { notificationMasks } from './notifications';
import type { SecretKind } from './patterns';
import { SCREEN_TEXT_FILE, framesToRead, keepRedacted, readFrames, writeScreenText } from './read';

/** A mask as written to cuttle.json. */
export type RawMask = Record<string, unknown> & { from: number; to: number; rect: Rect; auto?: string; enabled?: boolean; label?: string };
```

In the same file, replace:

```ts
  card: ['card number', 'card numbers'],
  phone: ['phone number', 'phone numbers'],
  word: ['word you always mask', 'words you always mask'],
};

export interface PrivacyInput {
```

with:

```ts
  card: ['card number', 'card numbers'],
  phone: ['phone number', 'phone numbers'],
  word: ['word you always mask', 'words you always mask'],
  random: ['random-looking string', 'random-looking strings'],
};

export interface PrivacyInput {
```

In the same file, replace:

```ts
  const times = await framesToRead(screen, clipSpans(file.project), size);
  const { frames, language } = await readFrames(screen, times, size, options);
  const path = join(dirname(screen), SCREEN_TEXT_FILE);
  writeScreenText(path, frames);
  return { path: relative(file.dir, path).split(sep).join('/'), frames: frames.length, language };
}
```

with:

```ts
  const times = await framesToRead(screen, clipSpans(file.project), size);
  const { frames, language } = await readFrames(screen, times, size, options);
  const path = join(dirname(screen), SCREEN_TEXT_FILE);
  writeScreenText(path, frames, file.project.privacy.words);
  return { path: relative(file.dir, path).split(sep).join('/'), frames: frames.length, language };
}
```

In the same file, replace:

```ts
  const file = await readProjectFile(dir);
  const { sources } = file.project;
  const linked = options.link ?? sources.screenText;
  const frames = linked ? await readScreenText(resolve(file.dir, linked)) : undefined;
  if (options.link && !frames) throw new CoreError('missing-file', `${options.link} cannot be read`);
  const text = sources.events ? await readFile(resolve(file.dir, sources.events), 'utf8').catch(() => undefined) : undefined;
  const events = text === undefined ? undefined : parseEventsJsonl(text).events;
  const size = await probeScreen(resolve(file.dir, sources.screen));
  const words = [...new Set([...file.project.privacy.words, ...(options.words ?? []).map((word) => word.trim()).filter(Boolean)])];
  const result = withPrivacyMasks(file.raw, file.project, { ...(frames && { frames }), ...(events && { events }), screen: size, words });
  const { masks: _masks, ...counts } = result;
  const linking = options.link !== undefined && options.link !== sources.screenText;
```

with:

```ts
  const file = await readProjectFile(dir);
  const { sources } = file.project;
  const linked = options.link ?? sources.screenText;
  const read = linked ? await readScreenText(resolve(file.dir, linked)) : undefined;
  if (options.link && !read) throw new CoreError('missing-file', `${options.link} cannot be read`);
  const text = sources.events ? await readFile(resolve(file.dir, sources.events), 'utf8').catch(() => undefined) : undefined;
  const events = text === undefined ? undefined : parseEventsJsonl(text).events;
  const size = await probeScreen(resolve(file.dir, sources.screen));
  const words = [...new Set([...file.project.privacy.words, ...(options.words ?? []).map((word) => word.trim()).filter(Boolean)])];
  // the file as it is kept: what an older version, or a word added since, left readable is marked now
  const frames = read && linked ? keepRedacted(resolve(file.dir, linked), read, words) : undefined;
  const result = withPrivacyMasks(file.raw, file.project, { ...(frames && { frames }), ...(events && { events }), screen: size, words });
  const { masks: _masks, ...counts } = result;
  const linking = options.link !== undefined && options.link !== sources.screenText;
```

In `packages/core/src/suggest.ts`, replace:

```ts
import { areaStretches, bandCrop, cropPieces, type CropStretch } from './suggest/crop';
import { dialogZooms } from './suggest/dialogs';
import { readScreenText, withPrivacyMasks, type RawMask } from './privacy/apply';
import { SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
import { cachedAnalysis, grabGray, grayFrames, screenBands } from './suggest/media';
import { withLengthFit } from './suggest/length';
import { suggestClips } from './suggest/plan';
```

with:

```ts
import { areaStretches, bandCrop, cropPieces, type CropStretch } from './suggest/crop';
import { dialogZooms } from './suggest/dialogs';
import { readScreenText, withPrivacyMasks, type RawMask } from './privacy/apply';
import { SCREEN_TEXT_FILE, framesToRead, keepRedacted, readFrames, writeScreenText } from './privacy/read';
import { cachedAnalysis, grabGray, grayFrames, screenBands } from './suggest/media';
import { withLengthFit } from './suggest/length';
import { suggestClips } from './suggest/plan';
```

In the same file, replace:

```ts
  let masks: RawMask[] | undefined;
  let privacy = { read: false, masks: 0, notifications: 0 };
  if (args.privacy !== false && file.project.autoEdits.privacy) {
    const text = await screenTextFor(file.dir, screen, sources.screenText, clips, screenInfo, args, notes);
    const result = withPrivacyMasks(file.raw, file.project, { ...(text && { frames: text.frames }), events, screen: screenInfo, words }, taken);
    notes.push(...result.notes);
    masks = result.masks;
```

with:

```ts
  let masks: RawMask[] | undefined;
  let privacy = { read: false, masks: 0, notifications: 0 };
  if (args.privacy !== false && file.project.autoEdits.privacy) {
    const text = await screenTextFor(file.dir, screen, sources.screenText, clips, screenInfo, words, args, notes);
    const result = withPrivacyMasks(file.raw, file.project, { ...(text && { frames: text.frames }), events, screen: screenInfo, words }, taken);
    notes.push(...result.notes);
    masks = result.masks;
```

In the same file, replace:

```ts
  linked: string | undefined,
  clips: readonly { from: number; to: number }[],
  size: { width: number; height: number },
  args: SuggestOptions,
  notes: string[],
): Promise<{ frames: ScreenTextFrame[]; made?: string } | undefined> {
  if (linked) {
    const frames = await readScreenText(resolve(dir, linked));
    if (frames) return { frames };
    notes.push(`${linked} cannot be read: it is read again`);
  }
  if (args.dryRun) {
```

with:

```ts
  linked: string | undefined,
  clips: readonly { from: number; to: number }[],
  size: { width: number; height: number },
  words: readonly string[],
  args: SuggestOptions,
  notes: string[],
): Promise<{ frames: ScreenTextFrame[]; made?: string } | undefined> {
  if (linked) {
    const frames = await readScreenText(resolve(dir, linked));
    // what an older version, or a word added since, left readable in it is marked now (not in a dry run)
    if (frames) return { frames: args.dryRun ? frames : keepRedacted(resolve(dir, linked), frames, words) };
    notes.push(`${linked} cannot be read: it is read again`);
  }
  if (args.dryRun) {
```

In the same file, replace:

```ts
      },
    });
    const path = join(dirname(screen), SCREEN_TEXT_FILE);
    writeScreenText(path, frames);
    notes.push(`read the screen's text in ${frames.length} frame${frames.length === 1 ? '' : 's'} (${language}), into ${relative(dir, path).split(sep).join('/')}`);
    return { frames, made: relative(dir, path).split(sep).join('/') };
  } catch (error) {
    if (!(error instanceof CoreError) || error.code !== 'ocr-missing') throw error;
    notes.push(`the screen's text was not read: ${error.message}; no privacy masks from it, so look for private things yourself`);
```

with:

```ts
      },
    });
    const path = join(dirname(screen), SCREEN_TEXT_FILE);
    const kept = writeScreenText(path, frames, words);
    notes.push(`read the screen's text in ${frames.length} frame${frames.length === 1 ? '' : 's'} (${language}), into ${relative(dir, path).split(sep).join('/')}`);
    return { frames: kept, made: relative(dir, path).split(sep).join('/') };
  } catch (error) {
    if (!(error instanceof CoreError) || error.code !== 'ocr-missing') throw error;
    notes.push(`the screen's text was not read: ${error.message}; no privacy masks from it, so look for private things yourself`);
```

In `packages/core/src/index.ts`, replace:

```ts
export { TYPING_RULES, keyBursts, screenStretches, typingZooms, type Burst, type ScreenChange, type TypingInput, type TypingZoom } from './suggest/typing';
export { CROP_RULES, areaStretches, bandCrop, cropOf, cropPieces, type CropStretch, type ScreenBands } from './suggest/crop';
export { DIALOG_RULES, dialogZooms, type DialogZoom } from './suggest/dialogs';
export { SECRET_KINDS, SECRET_LABELS, findSecrets, lineSecrets, type Secret, type SecretKind } from './privacy/patterns';
export { MASK_RULES, privacyMasks, type PrivacyMask } from './privacy/masks';
export { ScreenReader } from './privacy/ocr';
export { READ_RULES, SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
```

with:

```ts
export { TYPING_RULES, keyBursts, screenStretches, typingZooms, type Burst, type ScreenChange, type TypingInput, type TypingZoom } from './suggest/typing';
export { CROP_RULES, areaStretches, bandCrop, cropOf, cropPieces, type CropStretch, type ScreenBands } from './suggest/crop';
export { DIALOG_RULES, dialogZooms, type DialogZoom } from './suggest/dialogs';
export { MARK, RANDOM_RULES, SECRET_KINDS, SECRET_LABELS, SPECIFIC, findSecrets, isMark, lineSecrets, randomLooking, secretWords, type Secret, type SecretKind } from './privacy/patterns';
export { redactFrames } from './privacy/redact';
export { MASK_RULES, privacyMasks, type PrivacyMask } from './privacy/masks';
export { ScreenReader } from './privacy/ocr';
export { READ_RULES, SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
```

Run: `pnpm exec vitest run --project node packages/core/test/redact.test.ts packages/core/test/privacy-ocr.test.ts packages/core/test/privacy-apply.test.ts packages/core/test/privacy-masks.test.ts packages/core/test/suggest.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core
git commit -m "privacy: the screen's text kept with each private thing marked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The guide, and final verification

**Files:**
- Modify: `README.md`, `skill/cuttle/SKILL.md`

- [ ] **Step 1: The README and the skill**

In `README.md`, replace:

```markdown
private things are suggestions to check, not a guarantee: look at the stills before you share a
video (`cuttle preview --masks` shows each mask's edges).

The masks are drawn only into what Cuttle renders (the export, previews). The project folder keeps
the take as it was recorded (`takes/`, with the text the screen showed) and the editor's copies of it
(`.cuttle/`): share the exported video, never the folder. New projects get a `.gitignore` that
keeps both out of git. The input log counts key presses; it never stores what was typed.

Reading the screen's text needs Windows' OCR or macOS's Vision: on other systems (Linux) `suggest`
```

with:

```markdown
private things are suggestions to check, not a guarantee: look at the stills before you share a
video (`cuttle preview --masks` shows each mask's edges).

The text it reads is checked for email addresses, keys and tokens (by their prefixes, by a name
such as `API_KEY=` beside them, or because they look random), IBANs, card and phone numbers and the
words you name. What it finds is kept in the project only as a mark (`⟦key-qwhzbtrk⟧`, the same
mark for the same text), never as it was.

The masks are drawn only into what Cuttle renders (the export, previews). The project folder keeps
the take as it was recorded (`takes/`, the video still shows what the screen showed) and the
editor's copies of it (`.cuttle/`): share the exported video, never the folder. New projects get a `.gitignore` that
keeps both out of git. The input log counts key presses; it never stores what was typed.

Reading the screen's text needs Windows' OCR or macOS's Vision: on other systems (Linux) `suggest`
```

In `skill/cuttle/SKILL.md`, replace:

```markdown
- **Privacy first.** `suggest` masks each notification (a toast, the notification centre) while it
  was open (`auto: "notification"`). It also reads the screen's text (Windows' own OCR or macOS's
  Vision, on this computer) and masks what it finds: email addresses, keys and tokens, the value of a `…KEY=`,
  `…TOKEN=` or `password:` line, IBANs, card and phone numbers (masks tagged `auto: "privacy"`,
  following text that scrolls). Pass the user's name and address once with
  `--mask "<word>"` (kept in cuttle.json). This is a help, not a guarantee: the OCR misses small
  grey text and some lines, so **still look** yourself. Look for names, email addresses, tokens and
  API keys, file paths with user names, hook or plugin errors, and notifications.
```

with:

```markdown
- **Privacy first.** `suggest` masks each notification (a toast, the notification centre) while it
  was open (`auto: "notification"`). It also reads the screen's text (Windows' own OCR or macOS's
  Vision, on this computer) and masks what it finds: email addresses, keys and tokens, the value of a `…KEY=`,
  `…TOKEN=` or `password:` line, IBANs, card and phone numbers, and random-looking strings (a key
  without a known prefix; masks tagged `auto: "privacy"`, following text that scrolls). The text it
  keeps (`takes/<n>/screen-text.jsonl`) has each find replaced by a mark such as `⟦key-qwhzbtrk⟧`. Pass the user's name and address once with
  `--mask "<word>"` (kept in cuttle.json). This is a help, not a guarantee: the OCR misses small
  grey text and some lines, so **still look** yourself. Look for names, email addresses, tokens and
  API keys, file paths with user names, hook or plugin errors, and notifications.
```

```bash
git add README.md skill/cuttle/SKILL.md
git commit -m "docs: random-looking strings, and the screen's text kept marked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 975 passed and 80 skipped (here, with a speech model and ffmpeg's whisper filter; without them the real transcriptions are skipped too, and off Windows and macOS the OCR tests).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 16 tests.

Run: `pnpm app:check`
Expected: PASS, 58 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 3: By hand (the user)**

1. Record a take that shows a key without a name beside it (a table cell), let Cuttle cut it, and look at the Auto tab: the key is masked as a "Random-looking string".
2. Open `takes/1/screen-text.jsonl` of that project: the key and any email address are marks such as `⟦random-…⟧`.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **A path rule** (three or more slashes in a run) left out about 13 % of base64 keys, which have slashes. Only a run that starts with `/` counts as a path now.
- **The first `app:check` failed 7 of its 58 tests:** the prompter's Next was checked with a poll of 1 s, which ran out under load, and the take it left running made the next six tests find no new window. The second run passed 58/58. The poll and the cascade are for a PR on the checks' robustness.
- **The tests' first random generator** took the low bits of a linear congruential generator, which repeat after a few steps, and made strings like `AAAA…`. It takes the high bits now.
